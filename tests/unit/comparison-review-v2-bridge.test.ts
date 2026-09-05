import { describe, expect, it } from 'vitest';

import {
  COMPARISON_V2_CONTRACT_VERSION,
  analysisInputDigestV2,
  canonicalSnapshotDigest,
  claimCandidateDigest,
  createExactDuplicateComparisonResultV2,
  validateApprovedChangeSetManifestV2,
  semanticRelationshipMaterialDigestV2,
  sha256Text,
  shortlistAuditDigestV2,
  type ClaimCandidate,
  type ComparisonCompletedV2,
  type ComparisonFreshnessIdentityV2,
  type DraftChangeSetV2,
  type SecurityContext,
} from '../../packages/contracts/src/index.js';
import {
  createComparisonV2ReviewBridge,
  type ComparisonV2ReviewDecisionResult,
  type ComparisonV2ReviewDecisionWrite,
  type ComparisonV2AggregateForReview,
  type ComparisonV2ReviewBridgeDependencies,
} from '../../modules/change-set-review/src/review-v2.js';
import { authoritativeIntegrityTablesForMigrations } from '../../scripts/backup-restore.js';

const projectId = 'project-review-v2';
const now = '2026-09-05T12:00:00.000Z';
const security: SecurityContext = {
  accessScope: ['owner'],
  sensitivity: 'private',
  dataClassification: 'review.test',
};
const snapshot = {
  snapshotId: 'snapshot-1',
  projectId,
  version: 3,
  claims: [
    { claimId: 'claim-1', text: 'Existing claim.', revisionNumber: 1, evidenceIds: ['e-1'] },
  ],
  createdAt: now,
  digest: '',
};
snapshot.digest = canonicalSnapshotDigest(projectId, snapshot.version, snapshot.claims, undefined);

const candidate: ClaimCandidate = {
  candidateId: 'candidate-1',
  batchId: 'batch-1',
  revisionNumber: 1,
  projectId,
  sourceVersionId: 'source-1',
  claimText: 'Existing claim.',
  evidenceIds: ['evidence-1'],
  evidenceMode: 'DIRECT_EVIDENCE',
  extractionProfile: 'direct-only',
  status: 'READY',
  providerCall: {} as ClaimCandidate['providerCall'],
  accessScope: ['owner'],
  sensitivity: 'private',
  createdAt: now,
};
const candidateV2 = {
  id: candidate.candidateId,
  revision: 1 as const,
  digest: claimCandidateDigest(candidate),
  sourceVersionId: candidate.sourceVersionId,
  evidenceIds: [...candidate.evidenceIds],
};

const aggregate: ComparisonV2AggregateForReview = {
  comparison: createExactDuplicateComparisonResultV2({
    comparisonId: 'comparison-1',
    projectId,
    candidate: candidateV2,
    canonicalSnapshot: {
      id: snapshot.snapshotId,
      version: snapshot.version,
      digest: snapshot.digest,
    },
    exactDuplicateTarget: {
      resourceType: 'CLAIM',
      resourceId: 'claim-1',
      resourceRevision: 1,
      canonicalSnapshot: {
        id: snapshot.snapshotId,
        version: snapshot.version,
        digest: snapshot.digest,
      },
    },
    accessScope: ['owner'],
    sensitivity: 'private',
    createdAt: now,
  }),
  analyses: [],
  relationships: [],
};

const event: ComparisonCompletedV2 = {
  eventType: 'ComparisonCompletedV2',
  contractVersion: COMPARISON_V2_CONTRACT_VERSION,
  comparison: aggregate.comparison,
  analysisRevisionIds: [],
  emittedAt: now,
};

const authority = (rollout: 'V1_ONLY' | 'V2_SHADOW' | 'V2_ACTIVE') => ({
  projectId,
  candidateId: candidate.candidateId,
  candidateRevision: 1,
  rollout,
  candidates: [
    {
      projectId,
      candidateId: candidate.candidateId,
      candidateRevision: 1,
      contractVersion: rollout === 'V2_ACTIVE' ? ('2.0' as const) : ('1.0' as const),
      reviewAuthoritative: true,
    },
  ],
});

const semanticShortlist = {
  contractVersion: COMPARISON_V2_CONTRACT_VERSION,
  canonicalSnapshot: {
    id: snapshot.snapshotId,
    version: snapshot.version,
    digest: snapshot.digest,
  },
  lexicalProjectionWatermark: sha256Text('watermark'),
  lexicalProjectionBase: sha256Text('lexical-base'),
  semanticGenerationId: 'generation-1',
  semanticSourceProjectionDigest: sha256Text('semantic-source'),
  semanticCanonicalBaseVersion: snapshot.version,
  querySemanticReadiness: 'READY' as const,
  policyRevision: sha256Text('shortlist-policy'),
  k: 1,
  selectedTargetIdentities: [
    { resourceType: 'CLAIM' as const, resourceId: 'claim-1', resourceRevision: 1 },
  ],
  exclusionCounts: {},
  truncated: false,
  coverageStatus: 'COMPLETE' as const,
};
const semanticAnalysis = {
  analysisRevisionId: 'analysis-1',
  contractVersion: COMPARISON_V2_CONTRACT_VERSION,
  comparisonId: 'comparison-semantic-1',
  candidate: candidateV2,
  canonicalSnapshot: {
    id: snapshot.snapshotId,
    version: snapshot.version,
    digest: snapshot.digest,
  },
  inputDigest: analysisInputDigestV2({
    candidate: candidateV2,
    canonicalSnapshot: {
      id: snapshot.snapshotId,
      version: snapshot.version,
      digest: snapshot.digest,
    },
    shortlistDigest: shortlistAuditDigestV2(semanticShortlist),
    comparedResourceIdentities: [
      { resourceType: 'CLAIM' as const, resourceId: 'claim-1', resourceRevision: 1 },
    ],
    providerIdentity: { providerId: 'provider', modelId: 'model', capabilityId: 'capability' },
    credentialRevisionRef: 'credential:revision:1',
    promptTemplateRevision: 'prompt:v1',
    outputSchemaRevision: 'schema:v1',
    semanticPolicyRevision: 'policy:v1',
  }),
  shortlistDigest: shortlistAuditDigestV2(semanticShortlist),
  comparedResourceIdentities: [
    { resourceType: 'CLAIM' as const, resourceId: 'claim-1', resourceRevision: 1 },
  ],
  providerIdentity: { providerId: 'provider', modelId: 'model', capabilityId: 'capability' },
  credentialRevisionRef: 'credential:revision:1',
  promptTemplateRevision: 'prompt:v1',
  outputSchemaRevision: 'schema:v1',
  semanticPolicyRevision: 'policy:v1',
  attempt: 1,
  state: 'COMPLETED' as const,
  outcome: 'COMPLETED' as const,
  startedAt: now,
  completedAt: now,
  durationMs: 1,
  outputDigest: sha256Text('output'),
  materialDigest: sha256Text('material'),
  createdAt: now,
};
const semanticRelationshipBase = {
  relationshipId: 'relationship-1',
  contractVersion: COMPARISON_V2_CONTRACT_VERSION,
  comparisonId: 'comparison-semantic-1',
  candidateId: candidateV2.id,
  candidateRevision: candidateV2.revision,
  candidateDigest: candidateV2.digest,
  candidateEvidenceIds: [...candidateV2.evidenceIds],
  comparedResource: { resourceType: 'CLAIM' as const, resourceId: 'claim-1', resourceRevision: 1 },
  canonicalSnapshot: {
    snapshotId: snapshot.snapshotId,
    version: snapshot.version,
    digest: snapshot.digest,
  },
  type: 'UNRELATED' as const,
  analysisRevisionId: semanticAnalysis.analysisRevisionId,
  ruleIdentity: 'comparison-semantic-analysis-policy:v1',
  rationale: 'No semantic relationship.',
  accessScope: ['owner'],
  sensitivity: 'private' as const,
  revision: 1,
  createdAt: now,
};
const semanticAggregate: ComparisonV2AggregateForReview = {
  comparison: {
    comparisonId: 'comparison-semantic-1',
    contractVersion: COMPARISON_V2_CONTRACT_VERSION,
    projectId,
    candidate: candidateV2,
    canonicalSnapshot: {
      id: snapshot.snapshotId,
      version: snapshot.version,
      digest: snapshot.digest,
    },
    disposition: 'NEW',
    reviewRecommendation: 'ADD_CLAIM',
    shortlist: semanticShortlist,
    analysisRevisionIds: [semanticAnalysis.analysisRevisionId],
    relationshipIds: [semanticRelationshipBase.relationshipId],
    accessScope: ['owner'],
    sensitivity: 'private',
    createdAt: now,
  },
  analyses: [semanticAnalysis],
  relationships: [
    {
      ...semanticRelationshipBase,
      materialDigest: semanticRelationshipMaterialDigestV2(semanticRelationshipBase),
    },
  ],
};
const semanticEvent: ComparisonCompletedV2 = {
  eventType: 'ComparisonCompletedV2',
  contractVersion: COMPARISON_V2_CONTRACT_VERSION,
  comparison: semanticAggregate.comparison,
  analysisRevisionIds: [semanticAnalysis.analysisRevisionId],
  emittedAt: now,
};

const setup = (
  current?: ComparisonFreshnessIdentityV2,
  aggregateInput: ComparisonV2AggregateForReview = aggregate,
) => {
  let saved: DraftChangeSetV2 | undefined;
  let savedDecision: ComparisonV2ReviewDecisionWrite['decision'] | undefined;
  let savedManifest: ComparisonV2ReviewDecisionResult['manifest'];
  const repository = {
    async saveDraft(
      draft: Parameters<ComparisonV2ReviewBridgeDependencies['repository']['saveDraft']>[0],
    ) {
      saved = draft;
      return draft;
    },
    async findDraftByComparisonId(_projectId: string, comparisonId: string) {
      return saved?.comparisonId === comparisonId ? saved : undefined;
    },
    async recordDecision(
      write: ComparisonV2ReviewDecisionWrite,
    ): Promise<ComparisonV2ReviewDecisionResult> {
      if (
        savedDecision &&
        savedDecision.decisionId === write.decision.decisionId &&
        JSON.stringify(savedDecision) !== JSON.stringify(write.decision)
      ) {
        throw Object.assign(new Error('decision conflict'), { code: 'CONFLICT' });
      }
      if (savedDecision?.decisionId === write.decision.decisionId) {
        return {
          draft: saved!,
          decision: savedDecision,
          ...(savedManifest === undefined ? {} : { manifest: savedManifest }),
        };
      }
      savedDecision = write.decision;
      savedManifest = write.manifest;
      saved = write.updated;
      return {
        draft: write.updated,
        decision: write.decision,
        ...(write.manifest === undefined ? {} : { manifest: write.manifest }),
      };
    },
  };
  const dependencies: ComparisonV2ReviewBridgeDependencies = {
    aggregate: {
      async findComparisonById() {
        return aggregateInput;
      },
    },
    freshness: {
      async getCurrent(input) {
        return {
          identity: current ?? input.expected,
          ...(aggregateInput.comparison.shortlist === undefined
            ? {}
            : { shortlist: aggregateInput.comparison.shortlist }),
        };
      },
    },
    repository,
    now: () => now,
  };
  return { bridge: createComparisonV2ReviewBridge(dependencies), getSaved: () => saved };
};

const request = {
  event,
  actor: { type: 'service' as const, id: 'review-bridge' },
  security,
  authority: authority('V2_ACTIVE'),
  rolloutAuthorityRevision: 'rollout-revision-1',
};

describe('Comparison v2 Review bridge', () => {
  it('classifies the additive v2 Draft table as authoritative backup state', () => {
    expect(
      authoritativeIntegrityTablesForMigrations([
        '066_stage5_semantic_comparison_v2_persistence.sql',
        '067_stage5_comparison_review_v2_persistence.sql',
      ]),
    ).toContain('review.change_sets_v2');
  });

  it('materializes an exact provider-free NO_OP Draft with deterministic freshness', async () => {
    const setupValue = setup();
    const result = await setupValue.bridge.materializeDraft(request);
    expect(result.status).toBe('DRAFT_CREATED');
    if (result.status === 'DRAFT_CREATED') {
      expect(result.draft.operation).toBe('NO_OP');
      expect(result.draft.disposition).toBe('EXACT_DUPLICATE');
      expect(result.draft.analysisRevisionIds).toEqual([]);
      expect(result.draft.freshnessIdentity.mode).toBe('DETERMINISTIC_EXACT');
    }
  });

  it('materializes NEW + ADD_CLAIM while retaining the semantic UNRELATED evidence', async () => {
    const setupValue = setup(undefined, semanticAggregate);
    const result = await setupValue.bridge.materializeDraft({
      ...request,
      event: semanticEvent,
      authority: authority('V2_ACTIVE'),
    });
    expect(result.status).toBe('DRAFT_CREATED');
    if (result.status === 'DRAFT_CREATED') {
      expect(result.draft.operation).toBe('ADD_CLAIM');
      expect(result.draft.disposition).toBe('NEW');
      expect(result.draft.relationshipIds).toEqual(['relationship-1']);
      expect(result.draft.shortlistDigest).toBe(shortlistAuditDigestV2(semanticShortlist));
    }
  });

  it('does not create an authoritative v2 Draft before V2_ACTIVE', async () => {
    const setupValue = setup();
    const result = await setupValue.bridge.materializeDraft({
      ...request,
      authority: authority('V2_SHADOW'),
    });
    expect(result).toEqual({ status: 'BLOCKED', reason: 'AUTHORITY_NOT_ACTIVE' });
  });

  it('rejects a rollout freshness change before Draft persistence', async () => {
    const stale = {
      mode: 'DETERMINISTIC_EXACT' as const,
      candidateId: candidateV2.id,
      candidateRevision: candidateV2.revision,
      candidateSourceVersionId: candidateV2.sourceVersionId,
      candidateDigest: candidateV2.digest,
      candidateEvidenceDigest:
        'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      canonicalSnapshotId: snapshot.snapshotId,
      canonicalSnapshotDigest: snapshot.digest,
      canonicalSnapshotVersion: snapshot.version,
      exactDuplicateTarget: aggregate.comparison.exactDuplicateTarget!,
      rolloutAuthorityRevision: 'rollout-revision-old',
    };
    const setupValue = setup(stale);
    const result = await setupValue.bridge.materializeDraft(request);
    expect(result).toEqual({ status: 'BLOCKED', reason: 'STALE_COMPARISON' });
  });

  it('rejects non-user approval before any decision write', async () => {
    const setupValue = setup();
    await setupValue.bridge.materializeDraft(request);
    const draft = setupValue.getSaved()!;
    const result = await setupValue.bridge.recordDecision({
      projectId,
      changeSetId: draft.changeSetId,
      actor: { type: 'service', id: 'worker' },
      security,
      authority: authority('V2_ACTIVE'),
      rolloutAuthorityRevision: 'rollout-revision-1',
      expectedRevisionNumber: draft.revisionNumber,
      expectedContentDigest: draft.contentDigest,
      decision: 'APPROVE',
      reason: 'automated approval is forbidden',
      decisionId: 'decision-service-1',
      decidedAt: now,
    });
    expect(result).toEqual({ status: 'BLOCKED', reason: 'REVIEW_NOT_ELIGIBLE' });
  });

  it('creates a token-bound immutable manifest for a valid user approval', async () => {
    const setupValue = setup();
    await setupValue.bridge.materializeDraft(request);
    const draft = setupValue.getSaved()!;
    const result = await setupValue.bridge.recordDecision({
      projectId,
      changeSetId: draft.changeSetId,
      actor: { type: 'user', id: 'owner-1' },
      security,
      authority: authority('V2_ACTIVE'),
      rolloutAuthorityRevision: 'rollout-revision-1',
      expectedRevisionNumber: draft.revisionNumber,
      expectedContentDigest: draft.contentDigest,
      decision: 'APPROVE',
      reason: 'reviewed by owner',
      decisionId: 'decision-user-1',
      decidedAt: now,
    });
    expect(result.status).toBe('DECISION_RECORDED');
    if (result.status === 'DECISION_RECORDED') {
      expect(result.draft.status).toBe('APPROVED');
      expect(result.manifest?.userApproval.actor).toEqual({ type: 'user', id: 'owner-1' });
      expect(result.manifest?.userApproval.approvalToken.contentDigest).toBe(draft.contentDigest);
      expect(() => validateApprovedChangeSetManifestV2(result.manifest)).not.toThrow();
    }
  });

  it('rejects approval for an ON_HOLD Draft', async () => {
    const setupValue = setup();
    await setupValue.bridge.materializeDraft(request);
    const draft = setupValue.getSaved()!;
    const held = await setupValue.bridge.recordDecision({
      projectId,
      changeSetId: draft.changeSetId,
      actor: { type: 'user', id: 'owner-1' },
      security,
      authority: authority('V2_ACTIVE'),
      rolloutAuthorityRevision: 'rollout-revision-1',
      expectedRevisionNumber: draft.revisionNumber,
      expectedContentDigest: draft.contentDigest,
      decision: 'HOLD',
      reason: 'needs more evidence',
      decisionId: 'decision-hold-1',
      decidedAt: now,
    });
    expect(held.status).toBe('DECISION_RECORDED');
    const approval = await setupValue.bridge.recordDecision({
      projectId,
      changeSetId: draft.changeSetId,
      actor: { type: 'user', id: 'owner-1' },
      security,
      authority: authority('V2_ACTIVE'),
      rolloutAuthorityRevision: 'rollout-revision-1',
      expectedRevisionNumber: draft.revisionNumber,
      expectedContentDigest: draft.contentDigest,
      decision: 'APPROVE',
      reason: 'approve without clearing hold',
      decisionId: 'decision-approve-held-1',
      decidedAt: now,
    });
    expect(approval).toEqual({ status: 'BLOCKED', reason: 'REVIEW_NOT_ELIGIBLE' });
  });

  it('records REJECT and HOLD without creating a manifest', async () => {
    for (const decision of ['REJECT', 'HOLD'] as const) {
      const setupValue = setup();
      await setupValue.bridge.materializeDraft(request);
      const draft = setupValue.getSaved()!;
      const result = await setupValue.bridge.recordDecision({
        projectId,
        changeSetId: draft.changeSetId,
        actor: { type: 'user', id: 'owner-1' },
        security,
        authority: authority('V2_ACTIVE'),
        rolloutAuthorityRevision: 'rollout-revision-1',
        expectedRevisionNumber: draft.revisionNumber,
        expectedContentDigest: draft.contentDigest,
        decision,
        reason: `decision ${decision}`,
        decisionId: `decision-${decision.toLowerCase()}-1`,
        decidedAt: now,
      });
      expect(result.status).toBe('DECISION_RECORDED');
      if (result.status === 'DECISION_RECORDED') {
        expect(result.draft.status).toBe(decision === 'REJECT' ? 'REJECTED' : 'ON_HOLD');
        expect(result.manifest).toBeUndefined();
      }
    }
  });

  it('rejects stale approval and token-bound manifest tampering', async () => {
    const setupValue = setup();
    await setupValue.bridge.materializeDraft(request);
    const draft = setupValue.getSaved()!;
    const stale = await setupValue.bridge.recordDecision({
      projectId,
      changeSetId: draft.changeSetId,
      actor: { type: 'user', id: 'owner-1' },
      security,
      authority: authority('V2_ACTIVE'),
      rolloutAuthorityRevision: 'rollout-revision-1',
      expectedRevisionNumber: draft.revisionNumber,
      expectedContentDigest: sha256Text('stale'),
      decision: 'APPROVE',
      reason: 'stale approval',
      decisionId: 'decision-stale-1',
      decidedAt: now,
    });
    expect(stale).toEqual({ status: 'BLOCKED', reason: 'DECISION_STALE' });

    const approved = await setupValue.bridge.recordDecision({
      projectId,
      changeSetId: draft.changeSetId,
      actor: { type: 'user', id: 'owner-1' },
      security,
      authority: authority('V2_ACTIVE'),
      rolloutAuthorityRevision: 'rollout-revision-1',
      expectedRevisionNumber: draft.revisionNumber,
      expectedContentDigest: draft.contentDigest,
      decision: 'APPROVE',
      reason: 'valid approval',
      decisionId: 'decision-valid-1',
      decidedAt: now,
    });
    expect(approved.status).toBe('DECISION_RECORDED');
    if (approved.status === 'DECISION_RECORDED' && approved.manifest) {
      const manifest = approved.manifest;
      expect(() =>
        validateApprovedChangeSetManifestV2({
          ...manifest,
          userApproval: {
            ...manifest.userApproval,
            approvalToken: {
              ...manifest.userApproval.approvalToken,
              tokenDigest: sha256Text('tampered'),
            },
          },
        }),
      ).toThrow();
    }
  });

  it('converges a repeated approval decision by decision identity', async () => {
    const setupValue = setup();
    await setupValue.bridge.materializeDraft(request);
    const draft = setupValue.getSaved()!;
    const decision = {
      projectId,
      changeSetId: draft.changeSetId,
      actor: { type: 'user' as const, id: 'owner-1' },
      security,
      authority: authority('V2_ACTIVE'),
      rolloutAuthorityRevision: 'rollout-revision-1',
      expectedRevisionNumber: draft.revisionNumber,
      expectedContentDigest: draft.contentDigest,
      decision: 'APPROVE' as const,
      reason: 'replayed approval',
      decisionId: 'decision-replay-1',
      decidedAt: now,
    };
    const first = await setupValue.bridge.recordDecision(decision);
    const second = await setupValue.bridge.recordDecision(decision);
    expect(first.status).toBe('DECISION_RECORDED');
    expect(second.status).toBe('DECISION_RECORDED');
    if (first.status === 'DECISION_RECORDED' && second.status === 'DECISION_RECORDED') {
      expect(second.decision).toEqual(first.decision);
      expect(second.manifest).toEqual(first.manifest);
    }
  });
});
