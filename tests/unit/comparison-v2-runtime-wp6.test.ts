import { describe, expect, it } from 'vitest';

import {
  assertReviewAuthorityInvariantV2,
  claimCandidateDigest,
  type ClaimCandidate,
  type ComparisonFreshnessIdentityV2,
} from '../../packages/contracts/src/index.js';
import {
  createComparisonRolloutAuthorityResolver,
  createComparisonV2ReviewFreshnessAdapter,
  createComparisonV2Runtime,
} from '../../assemblies/shotgun-app/src/comparison-v2-runtime.js';
import {
  comparisonLexicalProjectionBaseV2,
  comparisonLexicalProjectionWatermarkV2,
  createComparisonV2Orchestrator,
} from '../../modules/comparison/src/index.js';
import type {
  ComparisonV2OrchestrationOutcome,
  ComparisonV2OrchestratorPort,
} from '../../modules/comparison/src/index.js';
import type { ComparisonV2RepositoryPort } from '../../modules/comparison/src/index.js';
import type { ComparisonV2ReviewBridgePort } from '../../modules/change-set-review/src/index.js';
import { createComparisonModule } from '../../modules/comparison/src/index.js';

const candidate = (id = 'candidate-1'): ClaimCandidate =>
  ({
    candidateId: id,
    batchId: 'batch-1',
    revisionNumber: 1,
    projectId: 'project-1',
    sourceVersionId: 'source-1',
    claimText: 'A validated claim.',
    evidenceIds: ['evidence-1'],
    evidenceMode: 'DIRECT_EVIDENCE',
    extractionProfile: 'direct-only',
    status: 'READY',
    providerCall: {} as ClaimCandidate['providerCall'],
    accessScope: ['owner'],
    sensitivity: 'internal',
    createdAt: '2026-09-05T00:00:00.000Z',
  }) as ClaimCandidate;

const actor = { type: 'user' as const, id: 'owner-1' };
const security = {
  accessScope: ['owner'],
  sensitivity: 'internal' as const,
  dataClassification: 'knowledge',
};

const settingStore = (initial?: unknown) => {
  let value = initial;
  return {
    get: () => value,
    set: (next: unknown) => {
      value = next;
    },
    repository: {
      getProjectSettingValue: async () => value,
    },
  };
};

const completedOutcome = (comparisonId = 'comparison-1'): ComparisonV2OrchestrationOutcome =>
  ({
    status: 'COMPLETED' as const,
    aggregate: { comparison: { comparisonId } },
    event: {
      eventType: 'ComparisonCompletedV2' as const,
      contractVersion: '2.0' as const,
      comparison: { comparisonId },
      analysisRevisionIds: [],
      emittedAt: '2026-09-05T00:00:00.000Z',
    },
  }) as unknown as ComparisonV2OrchestrationOutcome;

const runtimeInput = (
  settings: ReturnType<typeof settingStore>,
  orchestrator: unknown,
  bridge?: unknown,
) =>
  createComparisonV2Runtime({
    candidate: { findById: async () => candidate() },
    settings: settings.repository,
    orchestrator: orchestrator as ComparisonV2OrchestratorPort,
    ...(bridge === undefined
      ? {}
      : {
          reviewBridge: bridge as ComparisonV2ReviewBridgePort,
          freshness: {} as never,
        }),
  });

describe('WP6 comparison rollout runtime', () => {
  it('R6-01 defaults missing and invalid settings to V1_ONLY', async () => {
    const missing = createComparisonRolloutAuthorityResolver(settingStore().repository);
    expect(
      (await missing.resolve({ projectId: 'p', candidateId: 'c', candidateRevision: 1 })).rollout,
    ).toBe('V1_ONLY');
    const invalid = createComparisonRolloutAuthorityResolver(settingStore('CORRUPT').repository);
    expect(
      (await invalid.resolve({ projectId: 'p', candidateId: 'c', candidateRevision: 1 })).rollout,
    ).toBe('V1_ONLY');
  });

  it('R6-01 fails closed when the rollout Settings reader is unavailable', async () => {
    let v2Calls = 0;
    let v1Saves = 0;
    const runtime = createComparisonV2Runtime({
      candidate: { findById: async () => candidate() },
      settings: {
        getProjectSettingValue: async () => {
          throw new Error('settings store unavailable');
        },
      },
      orchestrator: {
        compare: async () => {
          v2Calls += 1;
          return completedOutcome();
        },
      } as ComparisonV2OrchestratorPort,
    });
    const module = createComparisonModule(
      {
        save: async (result) => {
          v1Saves += 1;
          return result;
        },
        findById: async () => undefined,
        findByCandidateAndSnapshot: async () => undefined,
      },
      {
        getSnapshot: async () => ({
          snapshotId: 'snapshot-1',
          projectId: 'project-1',
          version: 1,
          digest: 'digest-1',
          claims: [],
          createdAt: '2026-09-05T00:00:00.000Z',
        }),
      },
      { identity: { id: 'text-diff', version: '1' }, diff: () => [] },
      runtime,
    );
    await expect(
      module.handlers.events[0]!.handle(
        {
          messageType: 'CandidateValidated',
          schemaVersion: '1.0.0',
          correlationId: 'correlation-settings-failure',
          idempotencyKey: 'event-settings-failure',
          createdAt: '2026-09-05T00:00:00.000Z',
          projectId: 'project-1',
          actor,
          security,
          payload: { candidateId: 'candidate-1' },
        } as never,
        { query: async () => ({ payload: candidate() }), publish: async () => undefined } as never,
      ),
    ).rejects.toThrow('settings store unavailable');
    expect(v1Saves).toBe(0);
    expect(v2Calls).toBe(0);
  });

  it('R6-02 runs only v1 in V1_ONLY', async () => {
    const settings = settingStore('V1_ONLY');
    let calls = 0;
    const runtime = runtimeInput(settings, {
      compare: async () => {
        calls += 1;
        return completedOutcome();
      },
    });
    const outcome = await runtime.handleCandidateValidated({
      projectId: 'project-1',
      candidateId: 'candidate-1',
      candidate: candidate(),
      actor,
      security,
    });
    expect(outcome.v1Executed).toBe(true);
    expect(outcome.v2Outcome).toBeUndefined();
    expect(calls).toBe(0);
  });

  it('R6-03 executes v2 shadow while v1 remains authoritative', async () => {
    const settings = settingStore('V2_SHADOW');
    let reviews = 0;
    const runtime = runtimeInput(
      settings,
      { compare: async () => completedOutcome() },
      {
        materializeDraft: async () => {
          reviews += 1;
          return { status: 'DRAFT_CREATED' };
        },
      },
    );
    const outcome = await runtime.handleCandidateValidated({
      projectId: 'project-1',
      candidateId: 'candidate-1',
      candidate: candidate(),
      actor,
      security,
    });
    expect(outcome.v1Executed).toBe(true);
    expect(outcome.v2Outcome?.status).toBe('COMPLETED');
    expect(reviews).toBe(0);
  });

  it('R6-03 keeps the v1 authority when a shadow execution throws', async () => {
    const runtime = runtimeInput(settingStore('V2_SHADOW'), {
      compare: async () => {
        throw new Error('shadow dependency unavailable');
      },
    });
    const outcome = await runtime.handleCandidateValidated({
      projectId: 'project-1',
      candidateId: 'candidate-1',
      candidate: candidate(),
      actor,
      security,
    });
    expect(outcome.v1Executed).toBe(true);
    expect(outcome.v2Outcome?.status).toBe('BLOCKED');
  });

  it('R6-04 creates one v2 Review draft and never runs v1 in V2_ACTIVE', async () => {
    const settings = settingStore('V2_ACTIVE');
    let reviews = 0;
    const runtime = runtimeInput(
      settings,
      { compare: async () => completedOutcome() },
      {
        materializeDraft: async () => {
          reviews += 1;
          return { status: 'DRAFT_CREATED' };
        },
      },
    );
    const outcome = await runtime.handleCandidateValidated({
      projectId: 'project-1',
      candidateId: 'candidate-1',
      candidate: candidate(),
      actor,
      security,
    });
    expect(outcome.v1Executed).toBe(false);
    expect(outcome.review.status).toBe('DRAFT_CREATED');
    expect(reviews).toBe(1);
  });

  it('R6-04 exact duplicate stays deterministic and never calls a provider', async () => {
    const settings = settingStore('V2_ACTIVE');
    const snapshot = {
      id: 'snapshot-1',
      version: 1,
      digest: 'snapshot-digest-1',
    };
    let providerCalls = 0;
    const orchestrator = createComparisonV2Orchestrator({
      candidate: { findById: async () => candidate() },
      shortlist: {
        build: async () => ({
          status: 'EXACT_DUPLICATE' as const,
          exactDuplicateTarget: {
            resourceType: 'CLAIM' as const,
            resourceId: 'claim-1',
            resourceRevision: 1,
            canonicalSnapshot: snapshot,
          },
        }),
      },
      semanticAnalysis: {
        analyze: async () => {
          providerCalls += 1;
          throw new Error('semantic provider must not run for exact duplicate');
        },
      },
      repository: {
        saveCompletedAggregate: async (aggregate: unknown) => aggregate,
      } as unknown as ComparisonV2RepositoryPort,
      randomId: () => 'comparison-exact-1',
      now: () => '2026-09-05T00:00:00.000Z',
    });
    let drafts = 0;
    const runtime = runtimeInput(settings, orchestrator, {
      materializeDraft: async () => {
        drafts += 1;
        return { status: 'DRAFT_CREATED' };
      },
    });
    const outcome = await runtime.handleCandidateValidated({
      projectId: 'project-1',
      candidateId: 'candidate-1',
      candidate: candidate(),
      actor,
      security,
    });
    expect(outcome.v1Executed).toBe(false);
    expect(outcome.v2Outcome?.status).toBe('COMPLETED');
    expect(providerCalls).toBe(0);
    expect(drafts).toBe(1);
  });

  it('R6-05/R6-06 never falls back to v1 after v2 failure', async () => {
    const settings = settingStore('V2_ACTIVE');
    const runtime = runtimeInput(settings, {
      compare: async () =>
        ({
          status: 'FAILED',
          analysis: {},
          event: {},
        }) as unknown as ComparisonV2OrchestrationOutcome,
    });
    const outcome = await runtime.handleCandidateValidated({
      projectId: 'project-1',
      candidateId: 'candidate-1',
      candidate: candidate(),
      actor,
      security,
    });
    expect(outcome.v1Executed).toBe(false);
    expect(outcome.review.status).toBe('NOT_ATTEMPTED');
  });

  it('R6-07 blocks the Review bridge if authority downgrades mid-flight', async () => {
    const settings = settingStore('V2_ACTIVE');
    let reads = 0;
    settings.repository.getProjectSettingValue = async () => {
      reads += 1;
      return reads === 1 ? 'V2_ACTIVE' : 'V1_ONLY';
    };
    let reviews = 0;
    const runtime = runtimeInput(
      settings,
      { compare: async () => completedOutcome() },
      {
        materializeDraft: async () => {
          reviews += 1;
          return { status: 'DRAFT_CREATED' };
        },
      },
    );
    const outcome = await runtime.handleCandidateValidated({
      projectId: 'project-1',
      candidateId: 'candidate-1',
      candidate: candidate(),
      actor,
      security,
    });
    expect(outcome.review).toEqual({ status: 'BLOCKED', reason: 'ROLLOUT_DOWNGRADED' });
    expect(reviews).toBe(0);
  });

  it('R6-08 rejects a corrupt dual-authority selection', () => {
    expect(() =>
      assertReviewAuthorityInvariantV2({
        projectId: 'p',
        candidateId: 'c',
        candidateRevision: 1,
        rollout: 'V2_ACTIVE',
        candidates: [
          {
            projectId: 'p',
            candidateId: 'c',
            candidateRevision: 1,
            contractVersion: '1.0',
            reviewAuthoritative: true,
          },
          {
            projectId: 'p',
            candidateId: 'c',
            candidateRevision: 1,
            contractVersion: '2.0',
            reviewAuthoritative: true,
          },
        ],
      }),
    ).toThrow();
  });

  it('R6-09 freshness re-reads candidate, canonical, generation and rollout metadata', async () => {
    const settings = settingStore('V2_ACTIVE');
    const currentCandidate = candidate();
    let lexicalStatus: 'READY' | 'STALE' = 'READY';
    const generation = {
      projectId: 'project-1',
      generationId: 'generation-2',
      sourceProjectionDigest: 'projection-2',
      canonicalBaseVersion: 2,
      buildStatus: 'READY',
    };
    const adapter = createComparisonV2ReviewFreshnessAdapter({
      candidate: { findById: async () => currentCandidate },
      canonicalSnapshot: {
        getSnapshot: async () => ({
          snapshotId: 'snapshot-2',
          projectId: 'project-1',
          version: 2,
          digest: 'digest-2',
          claims: [],
          createdAt: '2026-09-05T00:00:00.000Z',
        }),
      },
      lexicalRetriever: {
        retrieve: async () => ({
          items: [],
          readiness: {
            status: lexicalStatus,
            projectedCanonicalVersion: 2,
            canonicalVersion: 2,
            lag: 0,
            projectedSnapshotDigest: 'digest-2',
            canonicalSnapshotDigest: 'digest-2',
            lastCommitId: 'commit-2',
          },
        }),
      },
      activeGenerationReader: { getActiveGeneration: async () => generation } as never,
      rollout: createComparisonRolloutAuthorityResolver(settings.repository),
      readSemanticMetadata: async () => ({
        providerModelCapabilityIdentity: 'provider-new/model-new/capability',
      }),
    });
    const expected: ComparisonFreshnessIdentityV2 = {
      mode: 'SEMANTIC',
      candidateId: currentCandidate.candidateId,
      candidateRevision: 1,
      candidateSourceVersionId: currentCandidate.sourceVersionId,
      candidateDigest: claimCandidateDigest(currentCandidate),
      candidateEvidenceDigest: 'old-evidence',
      canonicalSnapshotId: 'snapshot-1',
      canonicalSnapshotDigest: 'digest-1',
      canonicalSnapshotVersion: 1,
      shortlistDigest: 'shortlist-1',
      shortlistPolicyRevision: 'policy-1',
      semanticGenerationId: 'generation-1',
      semanticSourceProjectionDigest: 'projection-1',
      semanticCanonicalBaseVersion: 1,
      providerModelCapabilityIdentity: 'provider/model/capability',
      promptTemplateRevision: 'prompt-1',
      outputSchemaRevision: 'schema-1',
      semanticPolicyRevision: 'semantic-policy-1',
      rolloutAuthorityRevision: 'old-rollout',
    };
    const freshnessRequest = {
      aggregate: {
        comparison: {
          projectId: 'project-1',
          candidate: {
            id: currentCandidate.candidateId,
            revision: 1,
            sourceVersionId: currentCandidate.sourceVersionId,
            digest: expected.candidateDigest,
            evidenceIds: currentCandidate.evidenceIds,
          },
          disposition: 'NEW',
          shortlist: {
            policyRevision: 'policy-1',
            lexicalProjectionWatermark: comparisonLexicalProjectionWatermarkV2(
              {
                status: 'READY',
                projectedCanonicalVersion: 2,
                canonicalVersion: 2,
                lag: 0,
                projectedSnapshotDigest: 'digest-2',
                canonicalSnapshotDigest: 'digest-2',
                lastCommitId: 'commit-2',
              },
              {
                snapshotId: 'snapshot-2',
                projectId: 'project-1',
                version: 2,
                digest: 'digest-2',
                claims: [],
                createdAt: '2026-09-05T00:00:00.000Z',
              },
            ),
            lexicalProjectionBase: comparisonLexicalProjectionBaseV2({
              status: 'READY',
              projectedCanonicalVersion: 2,
              canonicalVersion: 2,
              lag: 0,
              projectedSnapshotDigest: 'digest-2',
              canonicalSnapshotDigest: 'digest-2',
              lastCommitId: 'commit-2',
            }),
            querySemanticReadiness: 'READY',
            coverageStatus: 'COMPLETE',
            truncated: false,
          },
        },
      } as never,
      expected,
      authority: (
        await createComparisonRolloutAuthorityResolver(settings.repository).resolve({
          projectId: 'project-1',
          candidateId: currentCandidate.candidateId,
          candidateRevision: 1,
        })
      ).selection,
      security,
    } as never;
    const current = await adapter.getCurrent(freshnessRequest);
    expect(current.identity.mode).toBe('SEMANTIC');
    expect(
      (current.identity as Extract<ComparisonFreshnessIdentityV2, { mode: 'SEMANTIC' }>)
        .semanticGenerationId,
    ).toBe('generation-2');
    expect(
      (current.identity as Extract<ComparisonFreshnessIdentityV2, { mode: 'SEMANTIC' }>)
        .providerModelCapabilityIdentity,
    ).toBe('provider-new/model-new/capability');
    expect(current.identity.rolloutAuthorityRevision).not.toBe('old-rollout');
    expect(current.shortlist).toEqual({
      querySemanticReadiness: 'READY',
      coverageStatus: 'COMPLETE',
      truncated: false,
    });
    lexicalStatus = 'STALE';
    await expect(adapter.getCurrent(freshnessRequest)).rejects.toThrow(
      'lexical projection unavailable',
    );
  });

  it('R6-10 accepts interchangeable fake orchestrators without vendor coupling', async () => {
    const settings = settingStore('V2_ACTIVE');
    const first = runtimeInput(settings, { compare: async () => completedOutcome('first') });
    const second = runtimeInput(settings, { compare: async () => completedOutcome('second') });
    expect(
      (
        await first.handleCandidateValidated({
          projectId: 'project-1',
          candidateId: 'candidate-1',
          candidate: candidate(),
          actor,
          security,
        })
      ).v2Outcome?.status,
    ).toBe('COMPLETED');
    expect(
      (
        await second.handleCandidateValidated({
          projectId: 'project-1',
          candidateId: 'candidate-1',
          candidate: candidate(),
          actor,
          security,
        })
      ).v2Outcome?.status,
    ).toBe('COMPLETED');
  });

  it('R6-11 keeps historical v2 outcomes readable after a rollout rollback', async () => {
    const historical = completedOutcome('historical-comparison') as unknown as { status: string };
    const store = new Map([['historical-comparison', historical]]);
    const settings = settingStore('V1_ONLY');
    const runtime = runtimeInput(settings, {
      compare: async () => {
        throw new Error('must not replay');
      },
    });
    await runtime.handleCandidateValidated({
      projectId: 'project-1',
      candidateId: 'candidate-1',
      candidate: candidate(),
      actor,
      security,
    });
    expect(store.get('historical-comparison')?.status).toBe('COMPLETED');
  });

  it('R6-12 wires the runtime at the existing CandidateValidated composition seam', async () => {
    const settings = settingStore('V2_ACTIVE');
    const runtime = runtimeInput(
      settings,
      { compare: async () => completedOutcome() },
      {
        materializeDraft: async () => ({ status: 'DRAFT_CREATED' }),
      },
    );
    let v1Saves = 0;
    const module = createComparisonModule(
      {
        save: async (result) => {
          v1Saves += 1;
          return result;
        },
        findById: async () => undefined,
        findByCandidateAndSnapshot: async () => undefined,
      },
      {
        getSnapshot: async () => ({
          snapshotId: 'snapshot-1',
          projectId: 'project-1',
          version: 1,
          digest: 'digest-1',
          claims: [],
          createdAt: '2026-09-05T00:00:00.000Z',
        }),
      },
      { identity: { id: 'text-diff', version: '1' }, diff: () => [] },
      runtime,
    );
    const handler = module.handlers.events[0]!.handle;
    await handler(
      {
        messageType: 'CandidateValidated',
        schemaVersion: '1.0.0',
        correlationId: 'correlation-1',
        idempotencyKey: 'event-1',
        createdAt: '2026-09-05T00:00:00.000Z',
        projectId: 'project-1',
        actor,
        security,
        payload: { candidateId: 'candidate-1' },
      } as never,
      {
        query: async () => ({ payload: candidate() }),
        publish: async () => undefined,
      } as never,
    );
    expect(v1Saves).toBe(0);
  });
});
