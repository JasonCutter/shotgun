import { describe, expect, it } from 'vitest';

import {
  type ComparisonV2ReviewDecisionResult,
  type ComparisonV2ReviewDecisionWrite,
  type ComparisonV2AggregateForReview,
} from '../../modules/change-set-review/src/index.js';
import {
  createComparisonV2ReviewBridge,
  createReviewOperationResolutionV2,
  InMemoryReviewOperationResolutionStore,
  reviewOperationResolutionDigestV2,
  reviewOperationResolvedDraftMaterialDigestV2,
  type ComparisonV2ReviewBridgeDependencies,
} from '../../modules/change-set-review/src/index.js';
import {
  canonicalSnapshotDigest,
  claimCandidateDigest,
  draftChangeSetContentDigestV2,
  semanticRelationshipMaterialDigestV2,
  sha256Text,
  shortlistAuditDigestV2,
  analysisInputDigestV2,
  COMPARISON_V2_CONTRACT_VERSION,
  type DraftChangeSetV2,
  type SecurityContext,
} from '../../packages/contracts/src/index.js';

const projectId = 'adr163-review-operation-project';
const now = '2026-09-08T12:00:00.000Z';
const security: SecurityContext = {
  accessScope: ['owner'],
  sensitivity: 'private',
  dataClassification: 'review.test',
};
const canonicalSnapshot = {
  snapshotId: 'snapshot-adr163',
  projectId,
  version: 4,
  claims: [{ claimId: 'claim-adr163', text: 'Existing claim', revisionNumber: 1, evidenceIds: [] }],
  createdAt: now,
  digest: '',
};
canonicalSnapshot.digest = canonicalSnapshotDigest(
  projectId,
  canonicalSnapshot.version,
  canonicalSnapshot.claims,
  undefined,
);
const candidate = {
  id: 'candidate-adr163',
  revision: 1 as const,
  digest: claimCandidateDigest({
    candidateId: 'candidate-adr163',
    revisionNumber: 1,
    sourceVersionId: 'source-adr163',
    claimText: 'Candidate claim',
    evidenceIds: ['evidence-adr163'],
    status: 'READY',
  }),
  sourceVersionId: 'source-adr163',
  evidenceIds: ['evidence-adr163'] as readonly string[],
};
const shortlist = {
  contractVersion: COMPARISON_V2_CONTRACT_VERSION,
  canonicalSnapshot: {
    id: canonicalSnapshot.snapshotId,
    version: canonicalSnapshot.version,
    digest: canonicalSnapshot.digest,
  },
  lexicalProjectionWatermark:
    'sha256:1111111111111111111111111111111111111111111111111111111111111111',
  lexicalProjectionBase: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
  semanticGenerationId: 'generation-adr163',
  semanticSourceProjectionDigest:
    'sha256:3333333333333333333333333333333333333333333333333333333333333333',
  semanticCanonicalBaseVersion: canonicalSnapshot.version,
  querySemanticReadiness: 'READY' as const,
  policyRevision: 'sha256:4444444444444444444444444444444444444444444444444444444444444444',
  k: 1,
  selectedTargetIdentities: [
    { resourceType: 'CLAIM' as const, resourceId: 'claim-adr163', resourceRevision: 1 },
  ],
  exclusionCounts: {},
  truncated: false,
  coverageStatus: 'COMPLETE' as const,
};
const comparedResource = {
  resourceType: 'CLAIM' as const,
  resourceId: 'claim-adr163',
  resourceRevision: 1,
};
const providerIdentity = {
  providerId: 'provider-adr163',
  modelId: 'model-adr163',
  capabilityId: 'capability-adr163',
};
const analysisInput = {
  candidate,
  canonicalSnapshot: {
    id: canonicalSnapshot.snapshotId,
    version: canonicalSnapshot.version,
    digest: canonicalSnapshot.digest,
  },
  shortlistDigest: shortlistAuditDigestV2(shortlist),
  comparedResourceIdentities: [comparedResource],
  providerIdentity,
  credentialRevisionRef: 'credential:adr163',
  promptTemplateRevision: 'prompt:adr163',
  outputSchemaRevision: 'schema:adr163',
  semanticPolicyRevision: 'policy:adr163',
};
const analysis = {
  analysisRevisionId: 'analysis-adr163',
  contractVersion: COMPARISON_V2_CONTRACT_VERSION,
  comparisonId: 'comparison-adr163',
  candidate,
  canonicalSnapshot: {
    id: canonicalSnapshot.snapshotId,
    version: canonicalSnapshot.version,
    digest: canonicalSnapshot.digest,
  },
  inputDigest: analysisInputDigestV2(analysisInput),
  shortlistDigest: shortlistAuditDigestV2(shortlist),
  comparedResourceIdentities: [comparedResource],
  providerIdentity,
  credentialRevisionRef: analysisInput.credentialRevisionRef,
  promptTemplateRevision: analysisInput.promptTemplateRevision,
  outputSchemaRevision: analysisInput.outputSchemaRevision,
  semanticPolicyRevision: analysisInput.semanticPolicyRevision,
  attempt: 1,
  state: 'COMPLETED' as const,
  outcome: 'COMPLETED' as const,
  startedAt: now,
  completedAt: now,
  durationMs: 1,
  outputDigest: 'sha256:5555555555555555555555555555555555555555555555555555555555555555',
  materialDigest: 'sha256:6666666666666666666666666666666666666666666666666666666666666666',
  createdAt: now,
};
const relationshipWithoutDigest = {
  relationshipId: 'relationship-adr163',
  contractVersion: COMPARISON_V2_CONTRACT_VERSION,
  comparisonId: 'comparison-adr163',
  candidateId: candidate.id,
  candidateRevision: candidate.revision,
  candidateDigest: candidate.digest,
  candidateEvidenceIds: [...candidate.evidenceIds],
  comparedResource,
  canonicalSnapshot: {
    snapshotId: canonicalSnapshot.snapshotId,
    version: canonicalSnapshot.version,
    digest: canonicalSnapshot.digest,
  },
  type: 'UNRELATED' as const,
  analysisRevisionId: analysis.analysisRevisionId,
  ruleIdentity: 'rule-adr163',
  rationale: 'Review requires an explicit user operation choice.',
  accessScope: ['owner'],
  sensitivity: 'private' as const,
  revision: 1,
  createdAt: now,
};
const relationship = {
  ...relationshipWithoutDigest,
  materialDigest: semanticRelationshipMaterialDigestV2(relationshipWithoutDigest),
};
const comparison = {
  comparisonId: 'comparison-adr163',
  contractVersion: COMPARISON_V2_CONTRACT_VERSION,
  projectId,
  candidate,
  canonicalSnapshot: {
    id: canonicalSnapshot.snapshotId,
    version: canonicalSnapshot.version,
    digest: canonicalSnapshot.digest,
  },
  disposition: 'REVIEW_REQUIRED' as const,
  reviewRecommendation: 'MODIFY_REVIEW' as const,
  shortlist,
  analysisRevisionIds: [analysis.analysisRevisionId],
  relationshipIds: [relationship.relationshipId],
  accessScope: ['owner'],
  sensitivity: 'private' as const,
  createdAt: now,
};
const aggregate: ComparisonV2AggregateForReview = {
  comparison,
  analyses: [analysis],
  relationships: [relationship],
};
const authority = {
  projectId,
  candidateId: candidate.id,
  candidateRevision: candidate.revision,
  rollout: 'V2_ACTIVE' as const,
  candidates: [
    {
      projectId,
      candidateId: candidate.id,
      candidateRevision: candidate.revision,
      contractVersion: '2.0' as const,
      reviewAuthoritative: true,
    },
  ],
};

const createHarness = (options: { readonly staleAtCommit?: boolean } = {}) => {
  const store = new InMemoryReviewOperationResolutionStore();
  let draft: DraftChangeSetV2 | undefined;
  let freshnessCalls = 0;
  const repository = {
    async saveDraft(value: DraftChangeSetV2) {
      draft = value;
      store.seedDraft(value);
      return value;
    },
    async findDraftById(requestProjectId: string, changeSetId: string) {
      return store.findDraftById(requestProjectId, changeSetId);
    },
    async findDraftByComparisonId() {
      return draft;
    },
    async recordDecision(
      write: ComparisonV2ReviewDecisionWrite,
    ): Promise<ComparisonV2ReviewDecisionResult> {
      draft = write.updated;
      store.seedDraft(write.updated);
      return {
        draft: write.updated,
        decision: write.decision,
        ...(write.manifest === undefined ? {} : { manifest: write.manifest }),
      };
    },
    findOperationResolutionByRequest: store.findOperationResolutionByRequest.bind(store),
    findOperationResolutionByClientRequest:
      store.findOperationResolutionByClientRequest.bind(store),
    findOperationResolutionForDraft: store.findOperationResolutionForDraft.bind(store),
    async resolveOperation(write: Parameters<typeof store.resolveOperation>[0]) {
      const result = await store.resolveOperation(write);
      draft = result.draft;
      return result;
    },
  };
  const bridgeDependencies: ComparisonV2ReviewBridgeDependencies = {
    aggregate: {
      async findComparisonById() {
        return aggregate;
      },
    },
    freshness: {
      async getCurrent(input) {
        freshnessCalls += 1;
        if (options.staleAtCommit && freshnessCalls > 2) {
          return {
            identity: {
              ...input.expected,
              canonicalSnapshotVersion: input.expected.canonicalSnapshotVersion + 1,
            },
            shortlist,
          };
        }
        return { identity: input.expected, shortlist };
      },
    },
    repository,
    now: () => now,
  };
  return {
    store,
    repository,
    bridge: createComparisonV2ReviewBridge(bridgeDependencies),
    resolver: createReviewOperationResolutionV2({
      aggregate: bridgeDependencies.aggregate,
      freshness: bridgeDependencies.freshness,
      repository,
      now: () => now,
      accessRevision: 'access-r1',
      policyContextRevision: 'policy-r1',
    }),
    getDraft: () => draft!,
  };
};

describe('ADR-163 V2 review operation resolution', () => {
  it('resolves MODIFY_REVIEW to an immutable N+1 Draft and is idempotent', async () => {
    const harness = createHarness();
    const materialized = await harness.bridge.materializeDraft({
      event: {
        eventType: 'ComparisonCompletedV2',
        contractVersion: COMPARISON_V2_CONTRACT_VERSION,
        comparison,
        analysisRevisionIds: [analysis.analysisRevisionId],
        emittedAt: now,
      },
      actor: { type: 'service', id: 'comparison-worker' },
      security,
      authority,
      rolloutAuthorityRevision: 'rollout-r1',
    });
    expect(materialized.status).toBe('DRAFT_CREATED');
    const source = harness.getDraft();
    const command = {
      projectId,
      actor: { type: 'user' as const, id: 'owner-1' },
      security,
      authority,
      rolloutAuthorityRevision: 'rollout-r1',
      request: {
        changeSetId: source.changeSetId,
        expectedDraftRevision: source.revisionNumber,
        expectedDraftDigest: source.contentDigest,
        chosenOperation: 'ADD_CLAIM' as const,
        clientRequestId: 'client-adr163-1',
        idempotencyKey: 'idem-adr163-1',
      },
    };
    const resolved = await harness.resolver.resolve(command);
    expect(resolved.status).toBe('RESOLVED');
    expect(harness.getDraft()).toMatchObject({
      revisionNumber: 2,
      operation: 'ADD_CLAIM',
      disposition: 'REVIEW_REQUIRED',
      reviewRecommendation: 'MODIFY_REVIEW',
    });
    const replay = await harness.resolver.resolve(command);
    expect(replay.status).toBe('IDEMPOTENT_REPLAY');
    expect(harness.store.listResolutions()[0]?.resolverActorId).toBe('owner-1');
    const approved = await harness.bridge.recordDecision({
      projectId,
      changeSetId: source.changeSetId,
      actor: { type: 'user', id: 'owner-approver' },
      security,
      authority,
      rolloutAuthorityRevision: 'rollout-r1',
      expectedRevisionNumber: 2,
      expectedContentDigest: harness.getDraft().contentDigest,
      decision: 'APPROVE',
      reason: 'approve the explicitly resolved native operation',
      decisionId: 'decision-adr163-1',
      decidedAt: now,
    });
    expect(approved.status).toBe('DECISION_RECORDED');
    if (approved.status === 'DECISION_RECORDED') {
      expect(approved.decision.actor.id).toBe('owner-approver');
      expect(approved.decision.actor.id).not.toBe(
        harness.store.listResolutions()[0]?.resolverActorId,
      );
    }
  });

  it('keeps the native NO_OP approval contract after explicit resolution', async () => {
    const harness = createHarness();
    const materialized = await harness.bridge.materializeDraft({
      event: {
        eventType: 'ComparisonCompletedV2',
        contractVersion: COMPARISON_V2_CONTRACT_VERSION,
        comparison,
        analysisRevisionIds: [analysis.analysisRevisionId],
        emittedAt: now,
      },
      actor: { type: 'service', id: 'comparison-worker' },
      security,
      authority,
      rolloutAuthorityRevision: 'rollout-r1',
    });
    expect(materialized.status).toBe('DRAFT_CREATED');
    const source = harness.getDraft();
    const resolved = await harness.resolver.resolve({
      projectId,
      actor: { type: 'user', id: 'owner-no-op' },
      security,
      authority,
      rolloutAuthorityRevision: 'rollout-r1',
      request: {
        changeSetId: source.changeSetId,
        expectedDraftRevision: source.revisionNumber,
        expectedDraftDigest: source.contentDigest,
        chosenOperation: 'NO_OP',
        clientRequestId: 'client-adr163-no-op-approval',
        idempotencyKey: 'idem-adr163-no-op-approval',
      },
    });
    expect(resolved.status).toBe('RESOLVED');
    const approved = await harness.bridge.recordDecision({
      projectId,
      changeSetId: source.changeSetId,
      actor: { type: 'user', id: 'owner-approver' },
      security,
      authority,
      rolloutAuthorityRevision: 'rollout-r1',
      expectedRevisionNumber: 2,
      expectedContentDigest: harness.getDraft().contentDigest,
      decision: 'APPROVE',
      reason: 'the existing Canonical representation is sufficient',
      decisionId: 'decision-adr163-no-op-approval',
      decidedAt: now,
    });
    expect(approved.status).toBe('DECISION_RECORDED');
    if (approved.status === 'DECISION_RECORDED') {
      expect(approved.draft.operation).toBe('NO_OP');
      expect(approved.manifest?.operation).toBe('NO_OP');
    }
  });

  it('fails closed on stale revision and idempotency-key reuse', async () => {
    const harness = createHarness();
    await harness.bridge.materializeDraft({
      event: {
        eventType: 'ComparisonCompletedV2',
        contractVersion: COMPARISON_V2_CONTRACT_VERSION,
        comparison,
        analysisRevisionIds: [analysis.analysisRevisionId],
        emittedAt: now,
      },
      actor: { type: 'service', id: 'comparison-worker' },
      security,
      authority,
      rolloutAuthorityRevision: 'rollout-r1',
    });
    const source = harness.getDraft();
    const base = {
      projectId,
      actor: { type: 'user' as const, id: 'owner-1' },
      security,
      authority,
      rolloutAuthorityRevision: 'rollout-r1',
    };
    const first = await harness.resolver.resolve({
      ...base,
      request: {
        changeSetId: source.changeSetId,
        expectedDraftRevision: 1,
        expectedDraftDigest: source.contentDigest,
        chosenOperation: 'NO_OP' as const,
        clientRequestId: 'client-adr163-2',
        idempotencyKey: 'idem-adr163-2',
      },
    });
    expect(first.status).toBe('RESOLVED');
    const stale = await harness.resolver.resolve({
      ...base,
      request: {
        changeSetId: source.changeSetId,
        expectedDraftRevision: 1,
        expectedDraftDigest: source.contentDigest,
        chosenOperation: 'ADD_CLAIM' as const,
        clientRequestId: 'client-adr163-3',
        idempotencyKey: 'idem-adr163-3',
      },
    });
    expect(stale).toEqual({ status: 'BLOCKED', code: 'DRAFT_REVISION_CONFLICT' });
    const reused = await harness.resolver.resolve({
      ...base,
      request: {
        changeSetId: source.changeSetId,
        expectedDraftRevision: 1,
        expectedDraftDigest: source.contentDigest,
        chosenOperation: 'ADD_CLAIM' as const,
        clientRequestId: 'client-adr163-2',
        idempotencyKey: 'idem-adr163-2',
      },
    });
    expect(reused).toEqual({ status: 'BLOCKED', code: 'IDEMPOTENCY_KEY_REUSE' });
  });

  it('keeps ADR-163 material digests stable across wall-clock changes', async () => {
    const harness = createHarness();
    await harness.bridge.materializeDraft({
      event: {
        eventType: 'ComparisonCompletedV2',
        contractVersion: COMPARISON_V2_CONTRACT_VERSION,
        comparison,
        analysisRevisionIds: [analysis.analysisRevisionId],
        emittedAt: now,
      },
      actor: { type: 'service', id: 'comparison-worker' },
      security,
      authority,
      rolloutAuthorityRevision: 'rollout-r1',
    });
    const source = harness.getDraft();
    const command = {
      projectId,
      actor: { type: 'user' as const, id: 'owner-1' },
      security,
      authority,
      rolloutAuthorityRevision: 'rollout-r1',
      request: {
        changeSetId: source.changeSetId,
        expectedDraftRevision: source.revisionNumber,
        expectedDraftDigest: source.contentDigest,
        chosenOperation: 'ADD_CLAIM' as const,
        clientRequestId: 'client-adr163-digest',
        idempotencyKey: 'idem-adr163-digest',
      },
    };
    const resolved = await harness.resolver.resolve(command);
    expect(resolved.status).toBe('RESOLVED');
    const resolution = harness.store.listResolutions()[0]!;
    const materialAtLaterTime = {
      ...harness.getDraft(),
      updatedAt: '2030-01-01T00:00:00.000Z',
      createdAt: '2030-01-01T00:00:00.000Z',
    };
    expect(reviewOperationResolvedDraftMaterialDigestV2(harness.getDraft())).toBe(
      reviewOperationResolvedDraftMaterialDigestV2(materialAtLaterTime),
    );
    const { resolutionDigest: _digest, ...withoutDigest } = resolution;
    const laterRuntimeResolution = {
      ...withoutDigest,
      resolutionId: 'different-resolution-id',
      clientRequestId: 'different-client-request-id',
      idempotencyKey: 'different-idempotency-key',
      semanticCommandIdentity: 'different-runtime-identity',
      createdAt: '2030-01-01T00:00:00.000Z',
    };
    expect(reviewOperationResolutionDigestV2(laterRuntimeResolution)).toBe(_digest);
    expect(
      reviewOperationResolutionDigestV2({
        ...laterRuntimeResolution,
        chosenOperation: 'NO_OP',
      }),
    ).not.toBe(_digest);
    expect(
      reviewOperationResolutionDigestV2({
        ...withoutDigest,
        relationshipMaterialDigests: [
          {
            relationshipId: relationship.relationshipId,
            materialDigest: sha256Text('relationship-material-changed'),
          },
        ],
      }),
    ).not.toBe(_digest);
    expect(
      reviewOperationResolutionDigestV2({
        ...withoutDigest,
        relationshipMaterialDigests: [...resolution.relationshipMaterialDigests].reverse(),
      }),
    ).toBe(_digest);
  });

  it('rejects the same semantic command identity across different change sets', async () => {
    const harness = createHarness();
    await harness.bridge.materializeDraft({
      event: {
        eventType: 'ComparisonCompletedV2',
        contractVersion: COMPARISON_V2_CONTRACT_VERSION,
        comparison,
        analysisRevisionIds: [analysis.analysisRevisionId],
        emittedAt: now,
      },
      actor: { type: 'service', id: 'comparison-worker' },
      security,
      authority,
      rolloutAuthorityRevision: 'rollout-r1',
    });
    const firstDraft = harness.getDraft();
    const semanticCommandIdentity = 'connector:semantic-domain-identity';
    const first = await harness.resolver.resolve({
      projectId,
      actor: { type: 'user', id: 'owner-identity' },
      security,
      authority,
      rolloutAuthorityRevision: 'rollout-r1',
      semanticCommandIdentity,
      request: {
        changeSetId: firstDraft.changeSetId,
        expectedDraftRevision: 1,
        expectedDraftDigest: firstDraft.contentDigest,
        chosenOperation: 'ADD_CLAIM',
        clientRequestId: 'client-semantic-identity-a',
        idempotencyKey: 'idem-semantic-identity-a',
      },
    });
    expect(first.status).toBe('RESOLVED');

    const secondChangeSetId = `${firstDraft.changeSetId}:other`;
    const secondWithoutDigest: Omit<DraftChangeSetV2, 'contentDigest'> = {
      ...firstDraft,
      changeSetId: secondChangeSetId,
      revisionNumber: 1,
      operation: 'MODIFY_REVIEW',
      status: 'PENDING_REVIEW',
      updatedAt: now,
    };
    const secondDraft: DraftChangeSetV2 = {
      ...secondWithoutDigest,
      contentDigest: draftChangeSetContentDigestV2(secondWithoutDigest),
    };
    harness.store.seedDraft(secondDraft);
    const second = await harness.resolver.resolve({
      projectId,
      actor: { type: 'user', id: 'owner-identity' },
      security,
      authority,
      rolloutAuthorityRevision: 'rollout-r1',
      semanticCommandIdentity,
      request: {
        changeSetId: secondChangeSetId,
        expectedDraftRevision: 1,
        expectedDraftDigest: secondDraft.contentDigest,
        chosenOperation: 'NO_OP',
        clientRequestId: 'client-semantic-identity-b',
        idempotencyKey: 'idem-semantic-identity-b',
      },
    });
    expect(second).toEqual({ status: 'BLOCKED', code: 'IDEMPOTENCY_KEY_REUSE' });
    expect(harness.store.listResolutions()).toHaveLength(1);
    expect(await harness.store.findDraftById(projectId, secondChangeSetId)).toMatchObject({
      revisionNumber: 1,
    });
  });

  it('fails closed when access authority changes at the commit boundary', async () => {
    const harness = createHarness();
    await harness.bridge.materializeDraft({
      event: {
        eventType: 'ComparisonCompletedV2',
        contractVersion: COMPARISON_V2_CONTRACT_VERSION,
        comparison,
        analysisRevisionIds: [analysis.analysisRevisionId],
        emittedAt: now,
      },
      actor: { type: 'service', id: 'comparison-worker' },
      security,
      authority,
      rolloutAuthorityRevision: 'rollout-r1',
    });
    const source = harness.getDraft();
    let accessRevision = 'access-authority-1';
    const guardedRepository = {
      ...harness.repository,
      async resolveOperation(write: Parameters<typeof harness.store.resolveOperation>[0]) {
        accessRevision = 'access-authority-2';
        return harness.store.resolveOperation(write);
      },
    };
    const resolver = createReviewOperationResolutionV2({
      aggregate: {
        async findComparisonById() {
          return aggregate;
        },
      },
      freshness: {
        async getCurrent(input) {
          return { identity: input.expected, shortlist };
        },
      },
      repository: guardedRepository,
      securityAuthority: {
        async resolve() {
          return { accessRevision, policyContextRevision: 'policy-authority-1' };
        },
      },
      now: () => now,
    });
    const blocked = await resolver.resolve({
      projectId,
      actor: { type: 'user', id: 'owner-authority' },
      security,
      authority,
      rolloutAuthorityRevision: 'rollout-r1',
      request: {
        changeSetId: source.changeSetId,
        expectedDraftRevision: source.revisionNumber,
        expectedDraftDigest: source.contentDigest,
        chosenOperation: 'ADD_CLAIM',
        clientRequestId: 'client-access-authority-race',
        idempotencyKey: 'idem-access-authority-race',
      },
    });
    expect(blocked).toEqual({ status: 'BLOCKED', code: 'ACCESS_REVOKED' });
    expect(harness.store.listResolutions()).toHaveLength(0);
    expect(await harness.store.findDraftById(projectId, source.changeSetId)).toMatchObject({
      revisionNumber: 1,
    });
  });

  it('enforces project-scoped idempotency parity across different change sets', async () => {
    const firstHarness = createHarness();
    const first = await firstHarness.bridge.materializeDraft({
      event: {
        eventType: 'ComparisonCompletedV2',
        contractVersion: COMPARISON_V2_CONTRACT_VERSION,
        comparison,
        analysisRevisionIds: [analysis.analysisRevisionId],
        emittedAt: now,
      },
      actor: { type: 'service', id: 'comparison-worker' },
      security,
      authority,
      rolloutAuthorityRevision: 'rollout-r1',
    });
    expect(first.status).toBe('DRAFT_CREATED');
    const source = firstHarness.getDraft();
    const command = {
      projectId,
      actor: { type: 'user' as const, id: 'owner-1' },
      security,
      authority,
      rolloutAuthorityRevision: 'rollout-r1',
      request: {
        changeSetId: source.changeSetId,
        expectedDraftRevision: source.revisionNumber,
        expectedDraftDigest: source.contentDigest,
        chosenOperation: 'ADD_CLAIM' as const,
        clientRequestId: 'client-adr163-cross-set',
        idempotencyKey: 'idem-adr163-cross-set',
      },
    };
    expect((await firstHarness.resolver.resolve(command)).status).toBe('RESOLVED');
    expect(
      await firstHarness.store.findOperationResolutionByRequest(
        projectId,
        'other-change-set',
        'client-adr163-cross-set',
        'idem-adr163-cross-set',
      ),
    ).toMatchObject({ changeSetId: source.changeSetId });
  });

  it('rechecks freshness after the current head is locked and writes nothing on a race', async () => {
    const harness = createHarness({ staleAtCommit: true });
    const materialized = await harness.bridge.materializeDraft({
      event: {
        eventType: 'ComparisonCompletedV2',
        contractVersion: COMPARISON_V2_CONTRACT_VERSION,
        comparison,
        analysisRevisionIds: [analysis.analysisRevisionId],
        emittedAt: now,
      },
      actor: { type: 'service', id: 'comparison-worker' },
      security,
      authority,
      rolloutAuthorityRevision: 'rollout-r1',
    });
    expect(materialized.status).toBe('DRAFT_CREATED');
    const source = harness.getDraft();
    const result = await harness.resolver.resolve({
      projectId,
      actor: { type: 'user', id: 'owner-1' },
      security,
      authority,
      rolloutAuthorityRevision: 'rollout-r1',
      request: {
        changeSetId: source.changeSetId,
        expectedDraftRevision: source.revisionNumber,
        expectedDraftDigest: source.contentDigest,
        chosenOperation: 'NO_OP',
        clientRequestId: 'client-adr163-race',
        idempotencyKey: 'idem-adr163-race',
      },
    });
    expect(result).toEqual({ status: 'BLOCKED', code: 'STALE_REVIEW_INPUT' });
    expect(harness.getDraft()).toEqual(source);
  });

  it('serializes conflicting ADD_CLAIM and NO_OP choices to one winner', async () => {
    const harness = createHarness();
    await harness.bridge.materializeDraft({
      event: {
        eventType: 'ComparisonCompletedV2',
        contractVersion: COMPARISON_V2_CONTRACT_VERSION,
        comparison,
        analysisRevisionIds: [analysis.analysisRevisionId],
        emittedAt: now,
      },
      actor: { type: 'service', id: 'comparison-worker' },
      security,
      authority,
      rolloutAuthorityRevision: 'rollout-r1',
    });
    const source = harness.getDraft();
    const base = {
      projectId,
      actor: { type: 'user' as const, id: 'owner-1' },
      security,
      authority,
      rolloutAuthorityRevision: 'rollout-r1',
    };
    const [addClaim, noOp] = await Promise.all([
      harness.resolver.resolve({
        ...base,
        request: {
          changeSetId: source.changeSetId,
          expectedDraftRevision: source.revisionNumber,
          expectedDraftDigest: source.contentDigest,
          chosenOperation: 'ADD_CLAIM',
          clientRequestId: 'client-adr163-concurrent-add',
          idempotencyKey: 'idem-adr163-concurrent-add',
        },
      }),
      harness.resolver.resolve({
        ...base,
        request: {
          changeSetId: source.changeSetId,
          expectedDraftRevision: source.revisionNumber,
          expectedDraftDigest: source.contentDigest,
          chosenOperation: 'NO_OP',
          clientRequestId: 'client-adr163-concurrent-noop',
          idempotencyKey: 'idem-adr163-concurrent-noop',
        },
      }),
    ]);
    expect([addClaim.status, noOp.status].filter((status) => status === 'RESOLVED')).toHaveLength(
      1,
    );
    expect([addClaim, noOp].filter((outcome) => outcome.status === 'BLOCKED')).toHaveLength(1);
    expect(harness.store.listResolutions()).toHaveLength(1);
    expect(harness.getDraft().revisionNumber).toBe(2);
  });

  it('replays the exact committed result after a resolver restart', async () => {
    const harness = createHarness();
    await harness.bridge.materializeDraft({
      event: {
        eventType: 'ComparisonCompletedV2',
        contractVersion: COMPARISON_V2_CONTRACT_VERSION,
        comparison,
        analysisRevisionIds: [analysis.analysisRevisionId],
        emittedAt: now,
      },
      actor: { type: 'service', id: 'comparison-worker' },
      security,
      authority,
      rolloutAuthorityRevision: 'rollout-r1',
    });
    const source = harness.getDraft();
    const request = {
      changeSetId: source.changeSetId,
      expectedDraftRevision: source.revisionNumber,
      expectedDraftDigest: source.contentDigest,
      chosenOperation: 'NO_OP' as const,
      clientRequestId: 'client-adr163-restart',
      idempotencyKey: 'idem-adr163-restart',
    };
    const first = await harness.resolver.resolve({
      projectId,
      actor: { type: 'user', id: 'owner-1' },
      security,
      authority,
      rolloutAuthorityRevision: 'rollout-r1',
      request,
    });
    const restartedResolver = createReviewOperationResolutionV2({
      aggregate: {
        async findComparisonById() {
          return aggregate;
        },
      },
      freshness: {
        async getCurrent(input) {
          return { identity: input.expected, shortlist };
        },
      },
      repository: harness.repository,
      now: () => '2030-01-01T00:00:00.000Z',
    });
    const replay = await restartedResolver.resolve({
      projectId,
      actor: { type: 'user', id: 'owner-1' },
      security,
      authority,
      rolloutAuthorityRevision: 'rollout-r1',
      request,
    });
    expect(first.status).toBe('RESOLVED');
    expect(replay).toEqual({ ...first, status: 'IDEMPOTENT_REPLAY' });
    expect(harness.store.listResolutions()).toHaveLength(1);
  });
});
