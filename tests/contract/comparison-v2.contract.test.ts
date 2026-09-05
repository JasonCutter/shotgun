import { describe, expect, it } from 'vitest';

import {
  COMPARISON_V2_CONTRACT_VERSION,
  COMPARISON_FRESHNESS_REASONS_V2,
  ComparisonContractErrorV2,
  type ApprovedChangeSetManifestV2,
  type AnalysisRevisionV2,
  type ComparisonResultV2,
  type DraftChangeSetV2,
  type ComparisonFreshnessIdentityV2,
  type SemanticRelationshipV2,
  type ShortlistAuditV2,
  analysisInputDigestV2,
  analysisRevisionDigestV2,
  approvedChangeSetApprovalTokenDigestV2,
  assertAnalysisStateTransitionV2,
  assertComparisonEventV2,
  assertComparisonFreshForReviewV2,
  assertReviewAuthorityInvariantV2,
  candidateEvidenceDigestV2,
  comparisonFreshnessDigestV2,
  createExactDuplicateComparisonResultV2,
  draftChangeSetContentDigestV2,
  evaluateComparisonFreshnessV2,
  exactClaimIdentityDigestV2,
  isExactDuplicateV2,
  semanticRelationshipMaterialDigestV2,
  shortlistAuditDigestV2,
  validateAnalysisRevisionV2,
  validateApprovedChangeSetManifestV2,
  validateComparisonResultV2,
  validateComparisonChildrenV2,
  validateDraftChangeSetV2,
  validateComparisonFreshnessOutputV2,
  validateShortlistAuditV2,
  validateSemanticRelationshipV2,
} from '../../packages/contracts/src/index.js';
import type { ComparisonClassification } from '../../packages/contracts/src/comparison-review.js';

const candidate = {
  id: 'candidate-1',
  revision: 1,
  digest: 'sha256:candidate',
  sourceVersionId: 'source-version-1',
  evidenceIds: ['evidence-1'],
} as const;

const snapshot = { id: 'snapshot-1', version: 7, digest: 'sha256:snapshot' } as const;

const shortlist: ShortlistAuditV2 = {
  contractVersion: COMPARISON_V2_CONTRACT_VERSION,
  canonicalSnapshot: snapshot,
  lexicalProjectionWatermark: 'lexical:7',
  lexicalProjectionBase: 'lexical-base:7',
  semanticGenerationId: 'generation-1',
  semanticSourceProjectionDigest: 'sha256:projection',
  semanticCanonicalBaseVersion: 7,
  querySemanticReadiness: 'READY',
  policyRevision: 'policy:1',
  k: 3,
  selectedTargetIdentities: [{ resourceType: 'CLAIM', resourceId: 'claim-1', resourceRevision: 1 }],
  exclusionCounts: {},
  truncated: false,
  coverageStatus: 'COMPLETE',
};

const freshnessIdentity: ComparisonFreshnessIdentityV2 = {
  candidateId: candidate.id,
  candidateRevision: candidate.revision,
  candidateSourceVersionId: candidate.sourceVersionId,
  candidateDigest: candidate.digest,
  candidateEvidenceDigest: candidateEvidenceDigestV2(candidate),
  canonicalSnapshotId: snapshot.id,
  canonicalSnapshotDigest: snapshot.digest,
  canonicalSnapshotVersion: snapshot.version,
  shortlistDigest: 'sha256:shortlist',
  shortlistPolicyRevision: 'policy:1',
  semanticGenerationId: 'generation-1',
  semanticSourceProjectionDigest: 'sha256:projection',
  semanticCanonicalBaseVersion: snapshot.version,
  providerModelCapabilityIdentity: 'provider/model/capability',
  promptTemplateRevision: 'prompt:1',
  outputSchemaRevision: 'output-schema:1',
  semanticPolicyRevision: 'semantic-policy:1',
};
const freshnessDigest = comparisonFreshnessDigestV2(freshnessIdentity);
const approvalTokenMaterial = {
  tokenId: 'token-1',
  changeSetId: 'draft-1',
  changeSetRevisionNumber: 1,
  actorId: 'owner-1',
  contentDigest: 'sha256:draft',
  expectedCanonicalVersion: snapshot.version,
  snapshotDigest: snapshot.digest,
  issuedAt: '2026-09-05T00:00:00.000Z',
  expiresAt: '2026-09-06T00:00:00.000Z',
};
const approvalToken = {
  ...approvalTokenMaterial,
  tokenDigest: approvedChangeSetApprovalTokenDigestV2(approvalTokenMaterial),
};

const comparison = (overrides: Partial<ComparisonResultV2> = {}): ComparisonResultV2 => ({
  comparisonId: 'comparison-1',
  contractVersion: COMPARISON_V2_CONTRACT_VERSION,
  projectId: 'project-1',
  candidate,
  canonicalSnapshot: snapshot,
  disposition: 'REVIEW_REQUIRED',
  reviewRecommendation: 'MODIFY_REVIEW',
  shortlist,
  analysisRevisionIds: ['analysis-1'],
  relationshipIds: ['relationship-1', 'relationship-2'],
  accessScope: ['owner'],
  sensitivity: 'private',
  createdAt: '2026-09-05T00:00:00.000Z',
  ...overrides,
});

const relationship = (overrides: Partial<SemanticRelationshipV2> = {}): SemanticRelationshipV2 => ({
  relationshipId: 'relationship-1',
  contractVersion: COMPARISON_V2_CONTRACT_VERSION,
  comparisonId: 'comparison-1',
  candidateId: candidate.id,
  candidateRevision: candidate.revision,
  candidateDigest: candidate.digest,
  candidateEvidenceIds: [...candidate.evidenceIds],
  comparedResource: { resourceType: 'CLAIM', resourceId: 'claim-1', resourceRevision: 1 },
  canonicalSnapshot: {
    snapshotId: snapshot.id,
    version: snapshot.version,
    digest: snapshot.digest,
  },
  type: 'SUPPORTS',
  analysisRevisionId: 'analysis-1',
  ruleIdentity: 'semantic-policy:1',
  rationale: 'The candidate supports the pinned claim in the same scope.',
  materialDigest: 'sha256:material',
  accessScope: ['owner'],
  sensitivity: 'private',
  revision: 1,
  createdAt: '2026-09-05T00:00:00.000Z',
  ...overrides,
});

const analysis = (overrides: Partial<AnalysisRevisionV2> = {}): AnalysisRevisionV2 => ({
  analysisRevisionId: 'analysis-1',
  contractVersion: COMPARISON_V2_CONTRACT_VERSION,
  comparisonId: 'comparison-1',
  candidate,
  canonicalSnapshot: snapshot,
  shortlistDigest: 'sha256:shortlist',
  comparedResourceIdentities: [
    { resourceType: 'CLAIM', resourceId: 'claim-1', resourceRevision: 1 },
  ],
  providerIdentity: {
    providerId: 'provider',
    modelId: 'model',
    capabilityId: 'semantic-comparison',
  },
  credentialRevisionRef: 'credential-revision:1',
  promptTemplateRevision: 'prompt:1',
  outputSchemaRevision: 'output-schema:1',
  semanticPolicyRevision: 'semantic-policy:1',
  attempt: 1,
  state: 'COMPLETED',
  outcome: 'COMPLETED',
  startedAt: '2026-09-05T00:00:00.000Z',
  completedAt: '2026-09-05T00:00:01.000Z',
  durationMs: 1000,
  outputDigest: 'sha256:output',
  materialDigest: 'sha256:material',
  createdAt: '2026-09-05T00:00:01.000Z',
  inputDigest: analysisInputDigestV2({
    comparisonId: 'comparison-1',
    candidate,
    canonicalSnapshot: snapshot,
    shortlistDigest: 'sha256:shortlist',
    comparedResourceIdentities: [
      { resourceType: 'CLAIM', resourceId: 'claim-1', resourceRevision: 1 },
    ],
    providerIdentity: {
      providerId: 'provider',
      modelId: 'model',
      capabilityId: 'semantic-comparison',
    },
    credentialRevisionRef: 'credential-revision:1',
    promptTemplateRevision: 'prompt:1',
    outputSchemaRevision: 'output-schema:1',
    semanticPolicyRevision: 'semantic-policy:1',
  }),
  ...overrides,
});

describe('Stage 5 semantic comparison v2 contract (C-Contract-01..14)', () => {
  it('C-Contract-02 rejects missing Candidate or Canonical snapshot identity', () => {
    expect(() => validateComparisonResultV2({})).toThrow(ComparisonContractErrorV2);
    expect(() => validateComparisonResultV2({ ...comparison(), candidate: undefined })).toThrow();
    expect(() =>
      validateComparisonResultV2({ ...comparison(), canonicalSnapshot: undefined }),
    ).toThrow();
  });

  it('C-Contract-01 accepts zero, one and multiple semantic relationships', () => {
    expect(() =>
      validateComparisonResultV2(
        comparison({ disposition: 'NEW', reviewRecommendation: 'ADD_CLAIM', relationshipIds: [] }),
      ),
    ).not.toThrow();
    expect(() =>
      validateComparisonResultV2(comparison({ relationshipIds: ['relationship-1'] })),
    ).not.toThrow();
    expect(() => validateComparisonResultV2(comparison())).not.toThrow();
    expect(comparison().relationshipIds).toHaveLength(2);
  });

  it('C-Contract-03 rejects a relationship without exact compared Claim identity', () => {
    expect(() =>
      validateSemanticRelationshipV2(
        relationship({
          comparedResource: { resourceType: 'CLAIM', resourceId: '', resourceRevision: 0 },
        }),
      ),
    ).toThrow();
    expect(() => validateSemanticRelationshipV2(relationship())).not.toThrow();
  });

  it('exact duplicate is deterministic and has no semantic analysis revision', () => {
    expect(isExactDuplicateV2('  Milo\u00a0 weighs 5 kg. ', 'Milo weighs 5 kg.')).toBe(true);
    expect(exactClaimIdentityDigestV2('Milo weighs 5 kg.')).toMatch(/^sha256:/);
    const result = createExactDuplicateComparisonResultV2({
      comparisonId: 'comparison-exact',
      projectId: 'project-1',
      candidate,
      canonicalSnapshot: snapshot,
      exactDuplicateTarget: {
        resourceType: 'CLAIM',
        resourceId: 'claim-1',
        resourceRevision: 1,
        canonicalSnapshot: snapshot,
      },
      accessScope: ['owner'],
      sensitivity: 'private',
      createdAt: '2026-09-05T00:00:00.000Z',
    });
    expect(result.disposition).toBe('EXACT_DUPLICATE');
    expect(result.reviewRecommendation).toBe('NO_OP');
    expect(result.analysisRevisionIds).toEqual([]);
    expect(result.shortlist).toBeUndefined();
    expect(result.exactDuplicateTarget?.resourceId).toBe('claim-1');
  });

  it('analysis state transitions are explicit and illegal transitions fail', () => {
    expect(() => assertAnalysisStateTransitionV2('PENDING', 'COMPLETED')).toThrow(
      /Illegal analysis transition/,
    );
    expect(() => assertAnalysisStateTransitionV2('FAILED_RETRYABLE', 'ANALYZING')).not.toThrow();
    expect(() => assertAnalysisStateTransitionV2('COMPLETED', 'ANALYZING')).toThrow();
  });

  it('C-Contract-07 keeps unavailable/failure explicit and prevents successful completion', () => {
    const incomplete = {
      eventType: 'ComparisonIncompleteV2' as const,
      contractVersion: COMPARISON_V2_CONTRACT_VERSION,
      comparisonId: 'comparison-1',
      state: 'SEMANTIC_UNAVAILABLE' as const,
      analysisRevisionId: 'analysis-1',
      safeFailureCode: 'SEMANTIC_UNAVAILABLE' as const,
      emittedAt: '2026-09-05T00:00:00.000Z',
    };
    expect(() => assertComparisonEventV2(incomplete)).not.toThrow();
    expect(() =>
      assertComparisonEventV2({
        eventType: 'ComparisonCompletedV2',
        contractVersion: COMPARISON_V2_CONTRACT_VERSION,
        comparison: comparison({
          disposition: 'SEMANTIC_UNAVAILABLE',
          reviewRecommendation: 'HOLD',
          relationshipIds: [],
          analysisRevisionIds: ['analysis-1'],
        }),
        analysisRevisionIds: [],
        emittedAt: 'now',
      }),
    ).toThrow();
    expect(() =>
      validateComparisonResultV2(
        comparison({
          disposition: 'SEMANTIC_UNAVAILABLE',
          reviewRecommendation: 'HOLD',
          relationshipIds: [],
          analysisRevisionIds: ['analysis-1'],
        }),
      ),
    ).not.toThrow();
    expect(() => validateDraftChangeSetV2({})).toThrow();
  });

  it('C-Contract-05 requires a conflict subtype and never infers conflict from similarity', () => {
    expect(() => validateSemanticRelationshipV2(relationship({ type: 'CONTRADICTS' }))).toThrow(
      /conflictKind/,
    );
    expect(() =>
      validateSemanticRelationshipV2(relationship({ type: 'CONTRADICTS', conflictKind: 'SCOPE' })),
    ).not.toThrow();
    expect(() =>
      validateSemanticRelationshipV2(relationship({ type: 'SUPPORTS', conflictKind: 'SCOPE' })),
    ).toThrow();
  });

  it('C-Contract-06 rejects conflict subtypes on non-conflict relationships', () => {
    expect(() =>
      validateSemanticRelationshipV2(relationship({ type: 'SUPPORTS', conflictKind: 'SCOPE' })),
    ).toThrow();
  });

  it('C-Contract-10 fails closed for non-Claim active resource types', () => {
    expect(() =>
      validateSemanticRelationshipV2(
        relationship({
          comparedResource: { resourceType: 'FACT', resourceId: 'fact-1', resourceRevision: 1 },
        }),
      ),
    ).toThrow(/Claim-only/);
    expect(() =>
      validateAnalysisRevisionV2(
        analysis({
          comparedResourceIdentities: [
            { resourceType: 'ENTITY', resourceId: 'entity-1', resourceRevision: 1 },
          ],
        }),
      ),
    ).toThrow(/Claim resources/);
  });

  it('freshness returns typed reasons and blocks stale review', () => {
    const identity = { ...freshnessIdentity };
    const stale = evaluateComparisonFreshnessV2(
      identity,
      { ...identity, canonicalSnapshotVersion: 2 },
      { querySemanticReadiness: 'READY', coverageStatus: 'COMPLETE', truncated: false },
    );
    expect(stale).toEqual({ status: 'STALE', reasons: ['CANONICAL_SNAPSHOT_CHANGED'] });
    expect(() => assertComparisonFreshForReviewV2(stale, comparison())).toThrow();
  });

  it('allows a valid NEW + ADD_CLAIM comparison into Review', () => {
    const fresh = { status: 'FRESH' as const, reasons: [] as const };
    const newComparison = comparison({
      disposition: 'NEW',
      reviewRecommendation: 'ADD_CLAIM',
      relationshipIds: [],
    });
    expect(() => assertComparisonFreshForReviewV2(fresh, newComparison)).not.toThrow();
  });

  it('C-Contract-11 rejects a shortlist whose semantic Canonical base mismatches the pinned snapshot', () => {
    expect(() =>
      validateComparisonResultV2(
        comparison({
          shortlist: { ...shortlist, semanticCanonicalBaseVersion: snapshot.version + 1 },
        }),
      ),
    ).toThrow(/Canonical snapshot version/);
  });

  it('rejects every ComparisonResult/Shortlist snapshot identity mismatch', () => {
    for (const canonicalSnapshot of [
      { ...snapshot, id: 'snapshot-other' },
      { ...snapshot, version: snapshot.version + 1 },
      { ...snapshot, digest: 'sha256:other' },
    ]) {
      expect(() =>
        validateComparisonResultV2(comparison({ shortlist: { ...shortlist, canonicalSnapshot } })),
      ).toThrow();
    }
  });

  it('rejects non-Claim shortlist targets before NEW can be concluded', () => {
    const nonClaim = {
      ...shortlist,
      selectedTargetIdentities: [
        { resourceType: 'FACT' as const, resourceId: 'fact-1', resourceRevision: 1 },
      ],
    };
    expect(() => validateShortlistAuditV2(nonClaim)).toThrow(/Claim-only/);
  });

  it('C-Contract-04 blocks NEW when shortlist coverage is partial, stale, excluded or truncated', () => {
    expect(() =>
      validateComparisonResultV2(
        comparison({
          disposition: 'NEW',
          reviewRecommendation: 'ADD_CLAIM',
          relationshipIds: [],
          shortlist: { ...shortlist, truncated: true, coverageStatus: 'PARTIAL' },
        }),
      ),
    ).toThrow(/coverage/);
    expect(() =>
      validateComparisonResultV2(
        comparison({
          disposition: 'NEW',
          reviewRecommendation: 'ADD_CLAIM',
          relationshipIds: [],
          shortlist: { ...shortlist, exclusionCounts: { POLICY: 1 } },
        }),
      ),
    ).toThrow(/coverage/);
  });

  it('C-Contract-08 retains identities and blocks unavailable/stale/incomplete Draft handoff', () => {
    const draft: DraftChangeSetV2 = {
      changeSetId: 'draft-1',
      contractVersion: COMPARISON_V2_CONTRACT_VERSION,
      revisionNumber: 1,
      projectId: 'project-1',
      candidate,
      comparisonId: 'comparison-1',
      comparisonDigest: 'sha256:comparison',
      canonicalSnapshot: snapshot,
      analysisRevisionIds: ['analysis-1'],
      disposition: 'REVIEW_REQUIRED',
      relationshipIds: ['relationship-1'],
      evidenceIds: ['evidence-1'],
      operation: 'MODIFY_REVIEW',
      reviewRecommendation: 'MODIFY_REVIEW',
      status: 'PENDING_REVIEW',
      expectedCanonicalVersion: 7,
      snapshotDigest: snapshot.digest,
      shortlistDigest: 'sha256:shortlist',
      freshnessIdentity,
      freshnessDigest,
      accessScope: ['owner'],
      sensitivity: 'private',
      contentDigest: 'sha256:draft',
      createdAt: '2026-09-05T00:00:00.000Z',
      updatedAt: '2026-09-05T00:00:00.000Z',
    };
    expect(() => validateDraftChangeSetV2(draft)).not.toThrow();
    for (const disposition of [
      'SEMANTIC_UNAVAILABLE',
      'POLICY_BLOCKED',
      'ANALYSIS_PENDING',
      'STALE',
    ] as const) {
      expect(() => validateDraftChangeSetV2({ ...draft, disposition })).toThrow();
    }
    expect(() => validateDraftChangeSetV2({ ...draft, status: 'STALE' })).toThrow();
    const manifest: ApprovedChangeSetManifestV2 = {
      manifestId: 'manifest-1',
      contractVersion: COMPARISON_V2_CONTRACT_VERSION,
      changeSetId: draft.changeSetId,
      changeSetRevisionNumber: 1,
      projectId: draft.projectId,
      candidate,
      comparisonId: draft.comparisonId,
      comparisonDigest: draft.comparisonDigest,
      canonicalSnapshot: snapshot,
      analysisRevisionIds: draft.analysisRevisionIds,
      disposition: draft.disposition,
      relationshipIds: draft.relationshipIds,
      evidenceIds: draft.evidenceIds,
      operation: draft.operation,
      expectedCanonicalVersion: 7,
      snapshotDigest: draft.snapshotDigest,
      shortlistDigest: draft.shortlistDigest,
      freshnessIdentity,
      freshnessDigest,
      accessScope: ['owner'],
      sensitivity: 'private',
      contentDigest: draft.contentDigest,
      userApproval: {
        actor: { type: 'user', id: 'owner-1' },
        reason: 'Reviewed',
        approvalTokenId: 'token-1',
        approvalToken,
        approvedAt: draft.updatedAt,
      },
      createdAt: draft.updatedAt,
      manifestDigest: 'sha256:manifest',
    };
    expect(() => validateApprovedChangeSetManifestV2(manifest)).not.toThrow();
    expect(() =>
      validateApprovedChangeSetManifestV2({ ...manifest, snapshotDigest: 'sha256:other' }),
    ).toThrow();
    expect(() =>
      validateApprovedChangeSetManifestV2({
        ...manifest,
        userApproval: {
          ...manifest.userApproval,
          approvalToken: { ...manifest.userApproval.approvalToken, contentDigest: 'sha256:other' },
        },
      }),
    ).toThrow();
  });

  it('C-Contract-13 uses stable SHA-256 digests for immutable material', () => {
    expect(analysisRevisionDigestV2(analysis())).toBe(analysisRevisionDigestV2(analysis()));
    expect(
      shortlistAuditDigestV2({
        ...shortlist,
        selectedTargetIdentities: [...shortlist.selectedTargetIdentities].reverse(),
      }),
    ).toBe(shortlistAuditDigestV2(shortlist));
    expect(semanticRelationshipMaterialDigestV2({ ...relationship() })).toMatch(/^sha256:/);
    const draft: DraftChangeSetV2 = {
      changeSetId: 'draft-1',
      contractVersion: COMPARISON_V2_CONTRACT_VERSION,
      revisionNumber: 1,
      projectId: 'project-1',
      candidate,
      comparisonId: 'comparison-1',
      comparisonDigest: 'sha256:comparison',
      canonicalSnapshot: snapshot,
      analysisRevisionIds: ['analysis-1'],
      disposition: 'REVIEW_REQUIRED',
      relationshipIds: ['relationship-1'],
      evidenceIds: ['evidence-1'],
      operation: 'MODIFY_REVIEW',
      reviewRecommendation: 'MODIFY_REVIEW',
      status: 'PENDING_REVIEW',
      expectedCanonicalVersion: 7,
      snapshotDigest: snapshot.digest,
      shortlistDigest: 'sha256:shortlist',
      freshnessIdentity,
      freshnessDigest,
      accessScope: ['owner'],
      sensitivity: 'private',
      contentDigest: 'sha256:draft',
      createdAt: '2026-09-05T00:00:00.000Z',
      updatedAt: '2026-09-05T00:00:00.000Z',
    };
    const draftWithoutDigest = Object.fromEntries(
      Object.entries(draft).filter(([key]) => key !== 'contentDigest'),
    ) as Omit<DraftChangeSetV2, 'contentDigest'>;
    expect(draftChangeSetContentDigestV2(draftWithoutDigest)).toMatch(/^sha256:/);
    expect(
      analysisInputDigestV2({
        ...analysis(),
        candidate: { ...candidate, evidenceIds: [...candidate.evidenceIds].reverse() },
        comparedResourceIdentities: [
          { resourceType: 'CLAIM', resourceId: 'claim-1', resourceRevision: 1 },
          { resourceType: 'CLAIM', resourceId: 'claim-0', resourceRevision: 1 },
        ],
      }),
    ).toBe(
      analysisInputDigestV2({
        ...analysis(),
        comparedResourceIdentities: [
          { resourceType: 'CLAIM', resourceId: 'claim-0', resourceRevision: 1 },
          { resourceType: 'CLAIM', resourceId: 'claim-1', resourceRevision: 1 },
        ],
      }),
    );
  });

  it('freshness output schema accepts every typed reason and rejects unknown reasons', () => {
    for (const reason of COMPARISON_FRESHNESS_REASONS_V2) {
      expect(() =>
        validateComparisonFreshnessOutputV2({ status: 'STALE', reasons: [reason] }),
      ).not.toThrow();
    }
    expect(() =>
      validateComparisonFreshnessOutputV2({ status: 'STALE', reasons: ['UNKNOWN_REASON'] }),
    ).toThrow();
  });

  it('C-Contract-09 enforces one mutually exclusive Review authority per rollout state', () => {
    const authority = (contractVersion: '1.0' | '2.0', reviewAuthoritative: boolean) => ({
      projectId: 'project-1',
      candidateId: 'candidate-1',
      candidateRevision: 1,
      contractVersion,
      reviewAuthoritative,
    });
    expect(() =>
      assertReviewAuthorityInvariantV2({
        projectId: 'project-1',
        candidateId: 'candidate-1',
        candidateRevision: 1,
        rollout: 'V1_ONLY',
        candidates: [authority('1.0', true)],
      }),
    ).not.toThrow();
    expect(() =>
      assertReviewAuthorityInvariantV2({
        projectId: 'project-1',
        candidateId: 'candidate-1',
        candidateRevision: 1,
        rollout: 'V2_SHADOW',
        candidates: [authority('1.0', true), authority('2.0', true)],
      }),
    ).toThrow();
    expect(() =>
      assertReviewAuthorityInvariantV2({
        projectId: 'project-1',
        candidateId: 'candidate-1',
        candidateRevision: 1,
        rollout: 'V2_ACTIVE',
        candidates: [authority('1.0', true)],
      }),
    ).toThrow();
    expect(() =>
      assertReviewAuthorityInvariantV2({
        projectId: 'project-1',
        candidateId: 'candidate-1',
        candidateRevision: 1,
        rollout: 'V2_ACTIVE',
        candidates: [authority('2.0', true)],
      }),
    ).not.toThrow();
    expect(() =>
      assertReviewAuthorityInvariantV2({
        projectId: 'project-1',
        candidateId: 'candidate-1',
        candidateRevision: 1,
        rollout: 'V2_ACTIVE',
        candidates: [authority('2.0', true), { ...authority('1.0', false), projectId: 'other' }],
      }),
    ).toThrow();
  });

  it('rejects relationship and analysis children whose parent identity drifts', () => {
    const parent = comparison();
    const children = [relationship(), relationship({ relationshipId: 'relationship-2' })];
    expect(() => validateComparisonChildrenV2(parent, children, [analysis()])).not.toThrow();
    expect(() =>
      validateComparisonChildrenV2(
        parent,
        [relationship({ comparisonId: 'comparison-other' }), children[1]!],
        [analysis()],
      ),
    ).toThrow(/parent identity/);
    expect(() =>
      validateComparisonChildrenV2(parent, children, [
        analysis({
          comparisonId: 'comparison-other',
          inputDigest: analysisInputDigestV2({ ...analysis(), comparisonId: 'comparison-other' }),
        }),
      ]),
    ).toThrow(/parent identity/);
  });

  it('C-Contract-12 leaves the v1 classification vocabulary intact', () => {
    const legacy: ComparisonClassification = 'NEW_CLAIM';
    expect(['NEW_CLAIM', 'EXACT_DUPLICATE', 'POSSIBLE_CONFLICT']).toContain(legacy);
    expect(COMPARISON_V2_CONTRACT_VERSION).toBe('2.0');
  });

  it('C-Contract-14 rejects unknown fields, malformed identities and unsupported versions', () => {
    expect(() =>
      validateComparisonResultV2({ ...comparison(), unexpectedAuthorityField: true }),
    ).toThrow();
    expect(() =>
      validateSemanticRelationshipV2({
        ...relationship(),
        comparedResource: { resourceType: 'CLAIM', resourceId: '', resourceRevision: 0 },
      }),
    ).toThrow();
    expect(() => validateComparisonResultV2({ ...comparison(), contractVersion: '1.0' })).toThrow(
      /2\.0/,
    );
    expect(() =>
      assertComparisonEventV2({
        eventType: 'ComparisonCompletedV2',
        contractVersion: '2.0',
        comparison: comparison(),
        analysisRevisionIds: [],
        emittedAt: 'now',
      }),
    ).not.toThrow();
  });
});
