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
  type ComparisonV2ReviewBridgeDependencies,
} from '../../modules/change-set-review/src/index.js';
import {
  canonicalSnapshotDigest,
  claimCandidateDigest,
  semanticRelationshipMaterialDigestV2,
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

const createHarness = () => {
  const store = new InMemoryReviewOperationResolutionStore();
  let draft: DraftChangeSetV2 | undefined;
  const repository = {
    async saveDraft(value: DraftChangeSetV2) {
      draft = value;
      store.seedDraft(value);
      return value;
    },
    async findDraftById() {
      return store.findDraftById(projectId, draft?.changeSetId ?? 'missing');
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
        return { identity: input.expected, shortlist };
      },
    },
    repository,
    now: () => now,
  };
  return {
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
    const approved = await harness.bridge.recordDecision({
      projectId,
      changeSetId: source.changeSetId,
      actor: { type: 'user', id: 'owner-1' },
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
});
