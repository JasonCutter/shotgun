import { describe, expect, it } from 'vitest';

import { InMemoryCanonicalKnowledgeRepository } from '../../adapters/stage6-in-memory/src/index.js';
import { createStage6Harness } from '../helpers/stage-6.js';
import { createAdr163ReviewFixture } from '../helpers/adr163-review-fixture.js';
import {
  createChildEvent,
  createCommand,
  type DraftChangeSetV2,
  type SecurityContext,
} from '../../packages/contracts/src/index.js';
import {
  createComparisonV2ReviewBridge,
  createReviewOperationResolutionV2,
  InMemoryReviewOperationResolutionStore,
} from '../../modules/change-set-review/src/index.js';
import type {
  ComparisonV2ReviewFreshnessPort,
  ReviewV2RepositoryPort,
} from '../../modules/change-set-review/src/review-v2.js';

const security: SecurityContext = {
  accessScope: ['owner'],
  sensitivity: 'private',
  dataClassification: 'knowledge',
};

const approveResolvedDraft = async (input: {
  readonly fixture: ReturnType<typeof createAdr163ReviewFixture>;
  readonly operation: 'ADD_CLAIM' | 'NO_OP';
  readonly harness: Awaited<ReturnType<typeof createStage6Harness>>;
  readonly actorId: string;
}) => {
  const store = new InMemoryReviewOperationResolutionStore();
  store.seedDraft(input.fixture.draft);
  const freshness: ComparisonV2ReviewFreshnessPort = {
    async getCurrent(current) {
      return {
        identity: current.expected,
        shortlist: input.fixture.aggregate.comparison.shortlist,
      };
    },
  };
  const reviewRepository: ReviewV2RepositoryPort = {
    saveDraft: async (draft: DraftChangeSetV2) => {
      store.seedDraft(draft);
      return draft;
    },
    findDraftById: store.findDraftById.bind(store),
    findDraftByComparisonId: async (projectId: string, comparisonId: string) =>
      store
        .findDraftById(projectId, input.fixture.draft.changeSetId)
        .then((draft) => (draft?.comparisonId === comparisonId ? draft : undefined)),
    findOperationResolutionForDraft: store.findOperationResolutionForDraft.bind(store),
    async recordDecision(write) {
      return {
        draft: write.updated,
        decision: write.decision,
        ...(write.manifest ? { manifest: write.manifest } : {}),
      };
    },
  };
  const resolver = createReviewOperationResolutionV2({
    aggregate: { findComparisonById: async () => input.fixture.aggregate },
    freshness,
    repository: {
      ...reviewRepository,
      findOperationResolutionByRequest: store.findOperationResolutionByRequest.bind(store),
      findOperationResolutionByClientRequest:
        store.findOperationResolutionByClientRequest.bind(store),
      resolveOperation: store.resolveOperation.bind(store),
    } as Parameters<typeof createReviewOperationResolutionV2>[0]['repository'],
    accessRevision: 'access:adr163-integrated',
    policyContextRevision: 'policy:adr163-integrated',
  });
  const resolved = await resolver.resolve({
    projectId: input.fixture.draft.projectId,
    actor: { type: 'user', id: input.actorId },
    security,
    authority: input.fixture.authority,
    rolloutAuthorityRevision: 'rollout:adr163-fixture',
    request: {
      changeSetId: input.fixture.draft.changeSetId,
      expectedDraftRevision: 1,
      expectedDraftDigest: input.fixture.draft.contentDigest,
      chosenOperation: input.operation,
      clientRequestId: `client:${input.fixture.draft.changeSetId}`,
      idempotencyKey: `idempotency:${input.fixture.draft.changeSetId}`,
    },
  });
  expect(resolved.status).toBe('RESOLVED');
  const resolvedDraft = await store.findDraftById(
    input.fixture.draft.projectId,
    input.fixture.draft.changeSetId,
  );
  expect(resolvedDraft?.revisionNumber).toBe(2);
  const approved = await createComparisonV2ReviewBridge({
    aggregate: { findComparisonById: async () => input.fixture.aggregate },
    freshness,
    repository: reviewRepository,
  }).recordDecision({
    projectId: input.fixture.draft.projectId,
    changeSetId: input.fixture.draft.changeSetId,
    actor: { type: 'user', id: 'approver-user' },
    security,
    authority: input.fixture.authority,
    rolloutAuthorityRevision: 'rollout:adr163-fixture',
    expectedRevisionNumber: 2,
    expectedContentDigest: resolvedDraft!.contentDigest,
    decision: 'APPROVE',
    reason: `Approve resolved ${input.operation}.`,
    decisionId: `decision:${input.fixture.draft.changeSetId}`,
    decidedAt: '2026-09-08T12:01:00.000Z',
  });
  expect(approved.status).toBe('DECISION_RECORDED');
  if (approved.status !== 'DECISION_RECORDED' || !approved.manifest) {
    throw new Error('The resolved approval did not produce a v2 Manifest.');
  }
  const parent = createCommand({
    messageType: 'ADR163IntegratedStage6',
    schemaVersion: '1.0.0',
    producerModule: 'adr163-test',
    producerVersion: '1.0.0',
    projectId: input.fixture.draft.projectId,
    actor: { type: 'user', id: 'approver-user' },
    security,
    idempotencyKey: `parent:${input.fixture.draft.changeSetId}`,
    payload: {},
  });
  const event = createChildEvent(parent, {
    messageType: 'ChangeSetApprovedV2',
    schemaVersion: '2.0.0',
    producerModule: 'adr163-test',
    producerVersion: '1.0.0',
    idempotencyKey: `stage6:${input.fixture.draft.changeSetId}`,
    payload: {
      manifest: approved.manifest,
      rollout: 'V2_ACTIVE',
      rolloutAuthorityRevision: 'rollout:adr163-fixture',
    },
  });
  await input.harness.kernel.connector.publishEvent(event);
  const snapshot = await input.harness.canonicalRepository.getSnapshot(
    input.fixture.draft.projectId,
  );
  return { manifest: approved.manifest, snapshot };
};

describe('ADR-163 resolved operation direct Stage 6 acceptance', () => {
  it('runs resolved ADD_CLAIM through approval and Stage 6 Canonical +1', async () => {
    const canonicalRepository = new InMemoryCanonicalKnowledgeRepository();
    const harness = await createStage6Harness({ canonicalRepository });
    const fixture = createAdr163ReviewFixture({
      suffix: 'add-claim',
      claimText: 'Resolved ADD_CLAIM.',
    });
    await harness.candidateRepository.saveBatch({
      batchId: fixture.candidate.batchId,
      projectId: fixture.candidate.projectId,
      sourceVersionId: fixture.candidate.sourceVersionId,
      idempotencyKey: `batch:${fixture.candidate.batchId}`,
      providerCall: fixture.candidate.providerCall,
      candidates: [fixture.candidate],
      createdAt: fixture.candidate.createdAt,
    });
    const { manifest, snapshot } = await approveResolvedDraft({
      fixture,
      operation: 'ADD_CLAIM',
      harness,
      actorId: 'resolver-user',
    });
    expect(manifest.operation).toBe('ADD_CLAIM');
    expect(snapshot.version).toBe(1);
    expect(snapshot.claims).toMatchObject([{ text: fixture.candidate.claimText }]);
    expect(snapshot.claims[0]?.evidenceIds).toEqual([...fixture.candidate.evidenceIds]);
    expect(harness.canonicalRepository.counts()).toMatchObject({ claims: 1, facts: 0 });
    expect(harness.canonicalRepository.fingerprint()).toContain('"relations":[]');
  });

  it('runs resolved NO_OP through approval and Stage 6 Canonical +0', async () => {
    const canonicalRepository = new InMemoryCanonicalKnowledgeRepository();
    const harness = await createStage6Harness({ canonicalRepository });
    const fixture = createAdr163ReviewFixture({ suffix: 'no-op', claimText: 'Resolved NO_OP.' });
    await harness.candidateRepository.saveBatch({
      batchId: fixture.candidate.batchId,
      projectId: fixture.candidate.projectId,
      sourceVersionId: fixture.candidate.sourceVersionId,
      idempotencyKey: `batch:${fixture.candidate.batchId}`,
      providerCall: fixture.candidate.providerCall,
      candidates: [fixture.candidate],
      createdAt: fixture.candidate.createdAt,
    });
    const { manifest, snapshot } = await approveResolvedDraft({
      fixture,
      operation: 'NO_OP',
      harness,
      actorId: 'resolver-user',
    });
    expect(manifest.operation).toBe('NO_OP');
    expect(snapshot.version).toBe(0);
    expect(snapshot.claims).toEqual([]);
    expect(harness.canonicalRepository.counts()).toMatchObject({
      claims: 0,
      facts: 0,
      commits: 1,
    });
    expect(harness.canonicalRepository.fingerprint()).toContain('"relations":[]');
  });

  it('keeps both source-supported Tesla conflict Claims without Fact or Relation synthesis', async () => {
    const canonicalRepository = new InMemoryCanonicalKnowledgeRepository();
    const harness = await createStage6Harness({ canonicalRepository });
    for (const [index, claimText] of ['Tesla CEO was 2008.', 'Tesla CEO was 2009.'].entries()) {
      const snapshot = await canonicalRepository.getSnapshot('shotgun');
      const fixture = createAdr163ReviewFixture({
        suffix: `tesla-${index}`,
        claimText,
        snapshot,
      });
      await harness.candidateRepository.saveBatch({
        batchId: fixture.candidate.batchId,
        projectId: fixture.candidate.projectId,
        sourceVersionId: fixture.candidate.sourceVersionId,
        idempotencyKey: `batch:${fixture.candidate.batchId}`,
        providerCall: fixture.candidate.providerCall,
        candidates: [fixture.candidate],
        createdAt: fixture.candidate.createdAt,
      });
      await approveResolvedDraft({
        fixture,
        operation: 'ADD_CLAIM',
        harness,
        actorId: `resolver-${index}`,
      });
    }
    const snapshot = await canonicalRepository.getSnapshot('shotgun');
    expect(snapshot.version).toBe(2);
    expect(snapshot.claims.map((claim) => claim.text).sort()).toEqual([
      'Tesla CEO was 2008.',
      'Tesla CEO was 2009.',
    ]);
    expect(canonicalRepository.counts()).toMatchObject({ claims: 2, facts: 0 });
    expect(canonicalRepository.fingerprint()).toContain('"relations":[]');
  });
});
