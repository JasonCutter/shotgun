import { randomUUID } from 'node:crypto';

import {
  COMPARISON_V2_CONTRACT_VERSION,
  assertComparisonEventV2,
  assertComparisonFreshForReviewV2,
  assertReviewAuthorityInvariantV2,
  approvedChangeSetApprovalTokenDigestV2,
  approvedChangeSetManifestDigestV2,
  candidateEvidenceDigestV2,
  comparisonFreshnessDigestV2,
  comparisonResultDigestV2,
  draftChangeSetContentDigestV2,
  evaluateComparisonFreshnessV2,
  deriveAuthorizedSensitivities,
  validateComparisonChildrenV2,
  validateApprovedChangeSetManifestV2,
  validateDraftChangeSetV2,
  type Actor,
  type ComparisonCompletedV2,
  type ComparisonFreshnessIdentityV2,
  type ComparisonFreshnessV2,
  type ComparisonResultV2,
  type DraftChangeSetV2,
  type SecurityContext,
  type AnalysisRevisionV2,
  type ApprovedChangeSetApprovalTokenV2,
  type ApprovedChangeSetManifestV2,
  type SemanticRelationshipV2,
  type ReviewAuthoritySelectionV2,
  type ShortlistAuditV2,
} from '../../../packages/contracts/src/index.js';

export type ComparisonV2AggregateForReview = {
  readonly comparison: ComparisonResultV2;
  readonly relationships: readonly SemanticRelationshipV2[];
  readonly analyses: readonly AnalysisRevisionV2[];
};

/** Structural port: Review reads the durable Comparison aggregate through a port. */
export type ComparisonV2ReviewAggregatePort = {
  findComparisonById(
    projectId: string,
    comparisonId: string,
  ): Promise<ComparisonV2AggregateForReview | undefined>;
};

/** The adapter re-evaluates the current candidate/snapshot/provider/policy identity. */
export type ComparisonV2ReviewFreshnessPort = {
  getCurrent(input: {
    readonly aggregate: ComparisonV2AggregateForReview;
    readonly expected: ComparisonFreshnessIdentityV2;
    readonly authority: ReviewAuthoritySelectionV2;
    readonly security: SecurityContext;
  }): Promise<{
    readonly identity: ComparisonFreshnessIdentityV2;
    readonly shortlist?: Pick<
      ShortlistAuditV2,
      'querySemanticReadiness' | 'coverageStatus' | 'truncated'
    >;
  }>;
};

export type ReviewV2RepositoryPort = {
  saveDraft(draft: DraftChangeSetV2): Promise<DraftChangeSetV2>;
  findDraftById?: (projectId: string, changeSetId: string) => Promise<DraftChangeSetV2 | undefined>;
  findDraftByComparisonId(
    projectId: string,
    comparisonId: string,
  ): Promise<DraftChangeSetV2 | undefined>;
  /** Optional until the additive v2 decision store is wired by the adapter. */
  recordDecision?: (
    write: ComparisonV2ReviewDecisionWrite,
  ) => Promise<ComparisonV2ReviewDecisionResult>;
};

export type ComparisonV2ReviewDecision = {
  readonly decisionId: string;
  readonly decision: 'APPROVE' | 'REJECT' | 'HOLD';
  readonly actor: Actor;
  readonly reason: string;
  readonly decidedAt: string;
};

export type ComparisonV2ReviewDecisionWrite = {
  readonly projectId: string;
  readonly changeSetId: string;
  readonly expectedRevisionNumber: number;
  readonly expectedContentDigest: string;
  readonly decision: ComparisonV2ReviewDecision;
  readonly updated: DraftChangeSetV2;
  readonly manifest?: ApprovedChangeSetManifestV2;
};

export type ComparisonV2ReviewDecisionResult = {
  readonly draft: DraftChangeSetV2;
  readonly decision: ComparisonV2ReviewDecision;
  readonly manifest?: ApprovedChangeSetManifestV2;
};

export type ComparisonV2ReviewBridgeRequest = {
  readonly event: ComparisonCompletedV2;
  readonly actor: Actor;
  readonly security: SecurityContext;
  readonly authority: ReviewAuthoritySelectionV2;
  readonly rolloutAuthorityRevision: string;
  readonly accessSensitivityPolicyRevision?: string;
};

export type ComparisonV2ReviewBridgeDependencies = {
  readonly aggregate: ComparisonV2ReviewAggregatePort;
  readonly freshness: ComparisonV2ReviewFreshnessPort;
  readonly repository: ReviewV2RepositoryPort;
  readonly now?: () => string;
};

export type ComparisonV2ReviewBridgeBlockedReason =
  | 'INVALID_REQUEST'
  | 'AUTHORITY_NOT_ACTIVE'
  | 'AUTHORITY_CONFLICT'
  | 'AGGREGATE_NOT_FOUND'
  | 'AGGREGATE_INVALID'
  | 'EVENT_LINEAGE_MISMATCH'
  | 'ACCESS_DENIED'
  | 'FRESHNESS_UNAVAILABLE'
  | 'STALE_COMPARISON'
  | 'REVIEW_NOT_ELIGIBLE'
  | 'DECISION_UNAVAILABLE'
  | 'DECISION_CONFLICT'
  | 'DECISION_STALE';

export type ComparisonV2ReviewBridgeOutcome =
  | { readonly status: 'DRAFT_CREATED'; readonly draft: DraftChangeSetV2 }
  | { readonly status: 'BLOCKED'; readonly reason: ComparisonV2ReviewBridgeBlockedReason };

export type ComparisonV2ReviewDecisionRequest = {
  readonly projectId: string;
  readonly changeSetId: string;
  readonly actor: Actor;
  readonly security: SecurityContext;
  readonly authority: ReviewAuthoritySelectionV2;
  readonly rolloutAuthorityRevision: string;
  readonly accessSensitivityPolicyRevision?: string;
  readonly expectedRevisionNumber: number;
  readonly expectedContentDigest: string;
  readonly decision: ComparisonV2ReviewDecision['decision'];
  readonly reason: string;
  readonly decisionId?: string;
  readonly decidedAt?: string;
};

export type ComparisonV2ReviewDecisionOutcome =
  | {
      readonly status: 'DECISION_RECORDED';
      readonly draft: DraftChangeSetV2;
      readonly decision: ComparisonV2ReviewDecision;
      readonly manifest?: ApprovedChangeSetManifestV2;
    }
  | { readonly status: 'BLOCKED'; readonly reason: ComparisonV2ReviewBridgeBlockedReason };

const isNonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const sameStringArray = (left: readonly string[], right: readonly string[]): boolean => {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
};

const isAuthorized = (comparison: ComparisonResultV2, security: SecurityContext): boolean => {
  const allowed = deriveAuthorizedSensitivities(security.sensitivity);
  return (
    comparison.accessScope.length > 0 &&
    comparison.accessScope.every((scope) => security.accessScope.includes(scope)) &&
    allowed.includes(comparison.sensitivity)
  );
};

const assertCandidateLineage = (aggregate: ComparisonV2AggregateForReview): void => {
  const { comparison } = aggregate;
  for (const analysis of aggregate.analyses) {
    if (
      analysis.candidate.id !== comparison.candidate.id ||
      analysis.candidate.revision !== comparison.candidate.revision ||
      analysis.candidate.digest !== comparison.candidate.digest ||
      !sameStringArray(analysis.candidate.evidenceIds, comparison.candidate.evidenceIds)
    ) {
      throw new Error('Analysis Candidate lineage does not match Comparison Candidate.');
    }
  }
  for (const relationship of aggregate.relationships) {
    if (
      relationship.candidateId !== comparison.candidate.id ||
      relationship.candidateRevision !== comparison.candidate.revision ||
      relationship.candidateDigest !== comparison.candidate.digest ||
      !sameStringArray(relationship.candidateEvidenceIds, comparison.candidate.evidenceIds)
    ) {
      throw new Error('Relationship Candidate lineage does not match Comparison Candidate.');
    }
  }
};

const expectedFreshness = (input: {
  readonly comparison: ComparisonResultV2;
  readonly analyses: readonly AnalysisRevisionV2[];
  readonly rolloutAuthorityRevision: string;
  readonly accessSensitivityPolicyRevision?: string;
}): ComparisonFreshnessIdentityV2 => {
  const common = {
    candidateId: input.comparison.candidate.id,
    candidateRevision: input.comparison.candidate.revision,
    candidateSourceVersionId: input.comparison.candidate.sourceVersionId,
    candidateDigest: input.comparison.candidate.digest,
    candidateEvidenceDigest: candidateEvidenceDigestV2(input.comparison.candidate),
    canonicalSnapshotId: input.comparison.canonicalSnapshot.id,
    canonicalSnapshotDigest: input.comparison.canonicalSnapshot.digest,
    canonicalSnapshotVersion: input.comparison.canonicalSnapshot.version,
    ...(input.accessSensitivityPolicyRevision === undefined
      ? {}
      : { accessSensitivityPolicyRevision: input.accessSensitivityPolicyRevision }),
    rolloutAuthorityRevision: input.rolloutAuthorityRevision,
  } as const;
  if (input.comparison.disposition === 'EXACT_DUPLICATE') {
    if (!input.comparison.exactDuplicateTarget) {
      throw new Error('EXACT_DUPLICATE comparison has no exact target.');
    }
    return {
      ...common,
      mode: 'DETERMINISTIC_EXACT',
      exactDuplicateTarget: input.comparison.exactDuplicateTarget,
    };
  }
  const shortlist = input.comparison.shortlist;
  const analysis = input.analyses[0];
  if (!shortlist || !analysis || input.analyses.length !== 1) {
    throw new Error('Semantic comparison must contain exactly one AnalysisRevision.');
  }
  return {
    ...common,
    mode: 'SEMANTIC',
    shortlistDigest: analysis.shortlistDigest,
    shortlistPolicyRevision: shortlist.policyRevision,
    semanticGenerationId: shortlist.semanticGenerationId,
    semanticSourceProjectionDigest: shortlist.semanticSourceProjectionDigest,
    semanticCanonicalBaseVersion: shortlist.semanticCanonicalBaseVersion,
    providerModelCapabilityIdentity: [
      analysis.providerIdentity.providerId,
      analysis.providerIdentity.modelId,
      analysis.providerIdentity.capabilityId,
    ].join('/'),
    promptTemplateRevision: analysis.promptTemplateRevision,
    outputSchemaRevision: analysis.outputSchemaRevision,
    semanticPolicyRevision: analysis.semanticPolicyRevision,
  };
};

const draftOperation = (comparison: ComparisonResultV2): DraftChangeSetV2['operation'] => {
  if (comparison.disposition === 'EXACT_DUPLICATE') return 'NO_OP';
  if (comparison.disposition === 'NEW') return 'ADD_CLAIM';
  return 'MODIFY_REVIEW';
};

const buildDraft = (input: {
  readonly comparison: ComparisonResultV2;
  readonly freshnessIdentity: ComparisonFreshnessIdentityV2;
  readonly status: DraftChangeSetV2['status'];
  readonly now: string;
  readonly changeSetId: string;
}): DraftChangeSetV2 => {
  const operation = draftOperation(input.comparison);
  const semanticShortlistDigest =
    input.comparison.disposition === 'EXACT_DUPLICATE'
      ? undefined
      : input.freshnessIdentity.mode === 'SEMANTIC'
        ? input.freshnessIdentity.shortlistDigest
        : undefined;
  const draftWithoutDigest: Omit<DraftChangeSetV2, 'contentDigest'> = {
    changeSetId: input.changeSetId,
    contractVersion: COMPARISON_V2_CONTRACT_VERSION,
    revisionNumber: 1,
    projectId: input.comparison.projectId,
    candidate: input.comparison.candidate,
    comparisonId: input.comparison.comparisonId,
    comparisonDigest: comparisonResultDigestV2(input.comparison),
    canonicalSnapshot: input.comparison.canonicalSnapshot,
    analysisRevisionIds: [...input.comparison.analysisRevisionIds],
    disposition: input.comparison.disposition,
    relationshipIds: [...input.comparison.relationshipIds],
    evidenceIds: [...input.comparison.candidate.evidenceIds],
    operation,
    reviewRecommendation: input.comparison.reviewRecommendation,
    status: input.status,
    expectedCanonicalVersion: input.comparison.canonicalSnapshot.version,
    snapshotDigest: input.comparison.canonicalSnapshot.digest,
    ...(semanticShortlistDigest === undefined ? {} : { shortlistDigest: semanticShortlistDigest }),
    freshnessIdentity: input.freshnessIdentity,
    freshnessDigest: comparisonFreshnessDigestV2(input.freshnessIdentity),
    accessScope: [...input.comparison.accessScope],
    sensitivity: input.comparison.sensitivity,
    createdAt: input.now,
    updatedAt: input.now,
  };
  const draft = {
    ...draftWithoutDigest,
    contentDigest: draftChangeSetContentDigestV2(draftWithoutDigest),
  } satisfies DraftChangeSetV2;
  validateDraftChangeSetV2(draft);
  return draft;
};

const buildApprovalManifest = (input: {
  readonly draft: DraftChangeSetV2;
  readonly actor: { readonly type: 'user'; readonly id: string };
  readonly reason: string;
  readonly approvedAt: string;
  readonly manifestId: string;
  readonly tokenId: string;
  readonly expiresAt: string;
}): ApprovedChangeSetManifestV2 => {
  const unsignedToken: Omit<ApprovedChangeSetApprovalTokenV2, 'tokenDigest'> = {
    tokenId: input.tokenId,
    changeSetId: input.draft.changeSetId,
    changeSetRevisionNumber: input.draft.revisionNumber,
    actorId: input.actor.id,
    contentDigest: input.draft.contentDigest,
    expectedCanonicalVersion: input.draft.expectedCanonicalVersion,
    snapshotDigest: input.draft.snapshotDigest,
    issuedAt: input.approvedAt,
    expiresAt: input.expiresAt,
  };
  const approvalToken: ApprovedChangeSetApprovalTokenV2 = {
    ...unsignedToken,
    tokenDigest: approvedChangeSetApprovalTokenDigestV2(unsignedToken),
  };
  const manifestWithoutDigest: Omit<ApprovedChangeSetManifestV2, 'manifestDigest'> = {
    manifestId: input.manifestId,
    contractVersion: COMPARISON_V2_CONTRACT_VERSION,
    changeSetId: input.draft.changeSetId,
    changeSetRevisionNumber: input.draft.revisionNumber,
    projectId: input.draft.projectId,
    candidate: input.draft.candidate,
    comparisonId: input.draft.comparisonId,
    comparisonDigest: input.draft.comparisonDigest,
    canonicalSnapshot: input.draft.canonicalSnapshot,
    analysisRevisionIds: [...input.draft.analysisRevisionIds],
    disposition: input.draft.disposition,
    relationshipIds: [...input.draft.relationshipIds],
    evidenceIds: [...input.draft.evidenceIds],
    operation: input.draft.operation,
    expectedCanonicalVersion: input.draft.expectedCanonicalVersion,
    snapshotDigest: input.draft.snapshotDigest,
    ...(input.draft.shortlistDigest === undefined
      ? {}
      : { shortlistDigest: input.draft.shortlistDigest }),
    freshnessIdentity: input.draft.freshnessIdentity,
    freshnessDigest: input.draft.freshnessDigest,
    accessScope: [...input.draft.accessScope],
    sensitivity: input.draft.sensitivity,
    contentDigest: input.draft.contentDigest,
    userApproval: {
      actor: input.actor,
      reason: input.reason,
      approvalTokenId: approvalToken.tokenId,
      approvalToken,
      approvedAt: input.approvedAt,
    },
    createdAt: input.approvedAt,
  };
  const manifest: ApprovedChangeSetManifestV2 = {
    ...manifestWithoutDigest,
    manifestDigest: approvedChangeSetManifestDigestV2(manifestWithoutDigest),
  };
  validateApprovedChangeSetManifestV2(manifest);
  return manifest;
};

const isSameDraftLineage = (
  draft: DraftChangeSetV2,
  aggregate: ComparisonV2AggregateForReview,
): boolean =>
  draft.projectId === aggregate.comparison.projectId &&
  draft.comparisonId === aggregate.comparison.comparisonId &&
  draft.comparisonDigest === comparisonResultDigestV2(aggregate.comparison) &&
  draft.candidate.id === aggregate.comparison.candidate.id &&
  draft.candidate.revision === aggregate.comparison.candidate.revision &&
  draft.candidate.digest === aggregate.comparison.candidate.digest &&
  sameStringArray(draft.candidate.evidenceIds, aggregate.comparison.candidate.evidenceIds) &&
  sameStringArray(draft.evidenceIds, aggregate.comparison.candidate.evidenceIds) &&
  draft.canonicalSnapshot.id === aggregate.comparison.canonicalSnapshot.id &&
  draft.canonicalSnapshot.version === aggregate.comparison.canonicalSnapshot.version &&
  draft.canonicalSnapshot.digest === aggregate.comparison.canonicalSnapshot.digest &&
  draft.disposition === aggregate.comparison.disposition &&
  draft.reviewRecommendation === aggregate.comparison.reviewRecommendation &&
  sameStringArray(draft.analysisRevisionIds, aggregate.comparison.analysisRevisionIds) &&
  sameStringArray(draft.relationshipIds, aggregate.comparison.relationshipIds);

export const createComparisonV2ReviewBridge = (
  dependencies: ComparisonV2ReviewBridgeDependencies,
) => {
  const now = dependencies.now ?? (() => new Date().toISOString());

  return {
    async materializeDraft(
      request: ComparisonV2ReviewBridgeRequest,
    ): Promise<ComparisonV2ReviewBridgeOutcome> {
      const invalidRequest =
        !isNonEmpty(request.event.comparison.comparisonId) ||
        request.event.contractVersion !== COMPARISON_V2_CONTRACT_VERSION ||
        !isNonEmpty(request.authority.projectId) ||
        !isNonEmpty(request.authority.candidateId) ||
        !isNonEmpty(request.rolloutAuthorityRevision) ||
        !isNonEmpty(request.actor.id) ||
        request.security.accessScope.length === 0;
      if (invalidRequest) {
        return { status: 'BLOCKED', reason: 'INVALID_REQUEST' };
      }

      try {
        assertComparisonEventV2(request.event);
        assertReviewAuthorityInvariantV2(request.authority);
      } catch {
        return { status: 'BLOCKED', reason: 'AUTHORITY_CONFLICT' };
      }
      if (request.authority.rollout !== 'V2_ACTIVE') {
        return { status: 'BLOCKED', reason: 'AUTHORITY_NOT_ACTIVE' };
      }

      const aggregate = await dependencies.aggregate.findComparisonById(
        request.authority.projectId,
        request.event.comparison.comparisonId,
      );
      if (!aggregate) return { status: 'BLOCKED', reason: 'AGGREGATE_NOT_FOUND' };
      if (
        aggregate.comparison.projectId !== request.authority.projectId ||
        aggregate.comparison.comparisonId !== request.event.comparison.comparisonId ||
        request.event.comparison.projectId !== aggregate.comparison.projectId ||
        request.event.comparison.candidate.id !== aggregate.comparison.candidate.id ||
        comparisonResultDigestV2(request.event.comparison) !==
          comparisonResultDigestV2(aggregate.comparison) ||
        !sameStringArray(
          request.event.analysisRevisionIds,
          aggregate.comparison.analysisRevisionIds,
        )
      ) {
        return { status: 'BLOCKED', reason: 'EVENT_LINEAGE_MISMATCH' };
      }
      try {
        validateComparisonChildrenV2(
          aggregate.comparison,
          aggregate.relationships,
          aggregate.analyses,
        );
        assertCandidateLineage(aggregate);
      } catch {
        return { status: 'BLOCKED', reason: 'AGGREGATE_INVALID' };
      }
      if (
        aggregate.comparison.candidate.id !== request.authority.candidateId ||
        aggregate.comparison.candidate.revision !== request.authority.candidateRevision ||
        !isAuthorized(aggregate.comparison, request.security)
      ) {
        return { status: 'BLOCKED', reason: 'ACCESS_DENIED' };
      }

      let expected: ComparisonFreshnessIdentityV2;
      try {
        expected = expectedFreshness({
          comparison: aggregate.comparison,
          analyses: aggregate.analyses,
          rolloutAuthorityRevision: request.rolloutAuthorityRevision,
          accessSensitivityPolicyRevision: request.accessSensitivityPolicyRevision,
        });
      } catch {
        return { status: 'BLOCKED', reason: 'AGGREGATE_INVALID' };
      }
      let current: Awaited<ReturnType<ComparisonV2ReviewFreshnessPort['getCurrent']>>;
      try {
        current = await dependencies.freshness.getCurrent({
          aggregate,
          expected,
          authority: request.authority,
          security: request.security,
        });
      } catch {
        return { status: 'BLOCKED', reason: 'FRESHNESS_UNAVAILABLE' };
      }
      if (expected.mode === 'SEMANTIC' && current.shortlist === undefined) {
        return { status: 'BLOCKED', reason: 'FRESHNESS_UNAVAILABLE' };
      }
      const freshness: ComparisonFreshnessV2 = evaluateComparisonFreshnessV2(
        expected,
        current.identity,
        current.shortlist ?? aggregate.comparison.shortlist,
      );
      try {
        assertComparisonFreshForReviewV2(freshness, aggregate.comparison);
      } catch {
        return {
          status: 'BLOCKED',
          reason: freshness.status === 'STALE' ? 'STALE_COMPARISON' : 'REVIEW_NOT_ELIGIBLE',
        };
      }

      const draft = buildDraft({
        comparison: aggregate.comparison,
        freshnessIdentity: expected,
        status: aggregate.comparison.reviewRecommendation === 'HOLD' ? 'ON_HOLD' : 'PENDING_REVIEW',
        now: now(),
        // ComparisonId is the durable v2 identity.  Replays of the same
        // Comparison event therefore converge on one Review Draft row.
        changeSetId: `comparison-v2:${aggregate.comparison.comparisonId}`,
      });
      const stored = await dependencies.repository.saveDraft(draft);
      return { status: 'DRAFT_CREATED', draft: stored };
    },

    async recordDecision(
      request: ComparisonV2ReviewDecisionRequest,
    ): Promise<ComparisonV2ReviewDecisionOutcome> {
      const invalidRequest =
        !isNonEmpty(request.projectId) ||
        !isNonEmpty(request.changeSetId) ||
        !isNonEmpty(request.authority.projectId) ||
        !isNonEmpty(request.authority.candidateId) ||
        !isNonEmpty(request.rolloutAuthorityRevision) ||
        !isNonEmpty(request.actor.id) ||
        !['user', 'service', 'system'].includes(request.actor.type) ||
        !isNonEmpty(request.reason) ||
        !['APPROVE', 'REJECT', 'HOLD'].includes(request.decision) ||
        !Number.isInteger(request.expectedRevisionNumber) ||
        request.expectedRevisionNumber < 1 ||
        !isNonEmpty(request.expectedContentDigest) ||
        !Array.isArray(request.security.accessScope) ||
        request.security.accessScope.length === 0 ||
        (request.decidedAt !== undefined && !Number.isFinite(Date.parse(request.decidedAt)));
      if (invalidRequest) return { status: 'BLOCKED', reason: 'INVALID_REQUEST' };
      if (request.projectId !== request.authority.projectId) {
        return { status: 'BLOCKED', reason: 'AUTHORITY_CONFLICT' };
      }
      try {
        assertReviewAuthorityInvariantV2(request.authority);
      } catch {
        return { status: 'BLOCKED', reason: 'AUTHORITY_CONFLICT' };
      }
      if (request.authority.rollout !== 'V2_ACTIVE') {
        return { status: 'BLOCKED', reason: 'AUTHORITY_NOT_ACTIVE' };
      }
      if (request.decision === 'APPROVE' && request.actor.type !== 'user') {
        return { status: 'BLOCKED', reason: 'REVIEW_NOT_ELIGIBLE' };
      }
      if (!dependencies.repository.recordDecision) {
        return { status: 'BLOCKED', reason: 'DECISION_UNAVAILABLE' };
      }

      const draft = dependencies.repository.findDraftById
        ? await dependencies.repository.findDraftById(request.projectId, request.changeSetId)
        : await dependencies.repository.findDraftByComparisonId(
            request.projectId,
            request.changeSetId.startsWith('comparison-v2:')
              ? request.changeSetId.slice('comparison-v2:'.length)
              : request.changeSetId,
          );
      if (!draft) return { status: 'BLOCKED', reason: 'AGGREGATE_NOT_FOUND' };
      if (draft.changeSetId !== request.changeSetId) {
        return { status: 'BLOCKED', reason: 'EVENT_LINEAGE_MISMATCH' };
      }
      if (
        draft.revisionNumber !== request.expectedRevisionNumber ||
        draft.contentDigest !== request.expectedContentDigest
      ) {
        return { status: 'BLOCKED', reason: 'DECISION_STALE' };
      }
      try {
        validateDraftChangeSetV2(draft);
      } catch {
        return { status: 'BLOCKED', reason: 'AGGREGATE_INVALID' };
      }

      const aggregate = await dependencies.aggregate.findComparisonById(
        request.projectId,
        draft.comparisonId,
      );
      if (!aggregate) return { status: 'BLOCKED', reason: 'AGGREGATE_NOT_FOUND' };
      if (!isSameDraftLineage(draft, aggregate)) {
        return { status: 'BLOCKED', reason: 'EVENT_LINEAGE_MISMATCH' };
      }
      try {
        validateComparisonChildrenV2(
          aggregate.comparison,
          aggregate.relationships,
          aggregate.analyses,
        );
        assertCandidateLineage(aggregate);
      } catch {
        return { status: 'BLOCKED', reason: 'AGGREGATE_INVALID' };
      }
      if (
        aggregate.comparison.candidate.id !== request.authority.candidateId ||
        aggregate.comparison.candidate.revision !== request.authority.candidateRevision ||
        !isAuthorized(aggregate.comparison, request.security)
      ) {
        return { status: 'BLOCKED', reason: 'ACCESS_DENIED' };
      }

      let expected: ComparisonFreshnessIdentityV2;
      try {
        expected = expectedFreshness({
          comparison: aggregate.comparison,
          analyses: aggregate.analyses,
          rolloutAuthorityRevision: request.rolloutAuthorityRevision,
          accessSensitivityPolicyRevision: request.accessSensitivityPolicyRevision,
        });
      } catch {
        return { status: 'BLOCKED', reason: 'AGGREGATE_INVALID' };
      }
      if (draft.freshnessDigest !== comparisonFreshnessDigestV2(expected)) {
        return { status: 'BLOCKED', reason: 'STALE_COMPARISON' };
      }
      let current: Awaited<ReturnType<ComparisonV2ReviewFreshnessPort['getCurrent']>>;
      try {
        current = await dependencies.freshness.getCurrent({
          aggregate,
          expected,
          authority: request.authority,
          security: request.security,
        });
      } catch {
        return { status: 'BLOCKED', reason: 'FRESHNESS_UNAVAILABLE' };
      }
      if (expected.mode === 'SEMANTIC' && current.shortlist === undefined) {
        return { status: 'BLOCKED', reason: 'FRESHNESS_UNAVAILABLE' };
      }
      const freshness = evaluateComparisonFreshnessV2(
        expected,
        current.identity,
        current.shortlist ?? aggregate.comparison.shortlist,
      );
      try {
        assertComparisonFreshForReviewV2(freshness, aggregate.comparison);
      } catch {
        return {
          status: 'BLOCKED',
          reason: freshness.status === 'STALE' ? 'STALE_COMPARISON' : 'REVIEW_NOT_ELIGIBLE',
        };
      }
      if (request.decision === 'APPROVE') {
        if (
          (draft.status !== 'PENDING_REVIEW' && draft.status !== 'APPROVED') ||
          draft.reviewRecommendation === 'HOLD'
        ) {
          return { status: 'BLOCKED', reason: 'REVIEW_NOT_ELIGIBLE' };
        }
      } else if (draft.status === 'APPROVED' || draft.status === 'REJECTED') {
        return { status: 'BLOCKED', reason: 'DECISION_CONFLICT' };
      }

      const decidedAt = request.decidedAt ?? now();
      const decision: ComparisonV2ReviewDecision = {
        decisionId: request.decisionId ?? randomUUID(),
        decision: request.decision,
        actor: request.actor,
        reason: request.reason.trim(),
        decidedAt,
      };
      const updated: DraftChangeSetV2 = {
        ...draft,
        status:
          request.decision === 'APPROVE'
            ? 'APPROVED'
            : request.decision === 'REJECT'
              ? 'REJECTED'
              : 'ON_HOLD',
        updatedAt: decidedAt,
      };
      const manifest =
        request.decision === 'APPROVE'
          ? buildApprovalManifest({
              draft,
              actor: request.actor as { readonly type: 'user'; readonly id: string },
              reason: request.reason.trim(),
              approvedAt: decidedAt,
              manifestId: `manifest-v2:${draft.changeSetId}:${decision.decisionId}`,
              tokenId: `approval-token-v2:${draft.changeSetId}:${decision.decisionId}`,
              expiresAt: new Date(Date.parse(decidedAt) + 15 * 60 * 1000).toISOString(),
            })
          : undefined;
      try {
        const stored = await dependencies.repository.recordDecision({
          projectId: request.projectId,
          changeSetId: request.changeSetId,
          expectedRevisionNumber: request.expectedRevisionNumber,
          expectedContentDigest: request.expectedContentDigest,
          decision,
          updated,
          ...(manifest === undefined ? {} : { manifest }),
        });
        return {
          status: 'DECISION_RECORDED',
          draft: stored.draft,
          decision: stored.decision,
          ...(stored.manifest === undefined ? {} : { manifest: stored.manifest }),
        };
      } catch (error) {
        const code = (error as { readonly code?: string }).code;
        return {
          status: 'BLOCKED',
          reason: code === 'STALE_VERSION' ? 'DECISION_STALE' : 'DECISION_CONFLICT',
        };
      }
    },
  };
};

export type ComparisonV2ReviewBridgePort = ReturnType<typeof createComparisonV2ReviewBridge>;
