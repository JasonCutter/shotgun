import Ajv, { type ValidateFunction } from 'ajv';

import analysisRevisionSchema from '../schemas/analysis-revision-v2.schema.json';
import approvedManifestSchema from '../schemas/approved-change-set-manifest-v2.schema.json';
import comparisonResultSchema from '../schemas/comparison-result-v2.schema.json';
import comparisonFreshnessSchema from '../schemas/comparison-freshness-v2.schema.json';
import draftChangeSetSchema from '../schemas/draft-change-set-v2.schema.json';
import semanticRelationshipSchema from '../schemas/semantic-relationship-v2.schema.json';
import shortlistAuditSchema from '../schemas/shortlist-audit-v2.schema.json';
import comparisonFreshnessOutputSchema from '../schemas/check-comparison-freshness-output-v2.schema.json';
import { sha256Text, stableJson } from './document-evidence.js';
import type { SecurityContext } from './types.js';

/** Stage 5 semantic comparison v2 is additive. The v1 comparison types in
 * comparison-review.ts deliberately remain untouched and are not aliases. */
export const COMPARISON_V2_CONTRACT_VERSION = '2.0' as const;
export type ComparisonContractVersionV2 = typeof COMPARISON_V2_CONTRACT_VERSION;
export type SecuritySensitivity = SecurityContext['sensitivity'];
export type ComparisonDigestV2 = string;

export type ComparisonDispositionV2 =
  | 'NEW'
  | 'EXACT_DUPLICATE'
  | 'REVIEW_REQUIRED'
  | 'ANALYSIS_PENDING'
  | 'SEMANTIC_UNAVAILABLE'
  | 'POLICY_BLOCKED'
  | 'STALE';

export type SemanticRelationshipTypeV2 =
  | 'SEMANTIC_DUPLICATE'
  | 'SUPPORTS'
  | 'REFINES'
  | 'NARROWS'
  | 'BROADENS'
  | 'UPDATES'
  | 'SUPERSEDES'
  | 'CONTRADICTS'
  | 'TEMPORALLY_COEXISTS'
  | 'AMBIGUOUS'
  | 'UNRELATED'
  | 'POLICY_BLOCKED';

/** ADR-160 design names retained as aliases for adapter-neutral consumers. */
export type SemanticRelationshipType = SemanticRelationshipTypeV2;

export type SemanticConflictKindV2 =
  | 'DIRECT_NEGATION'
  | 'QUANTITATIVE_VALUE'
  | 'SCOPE'
  | 'TEMPORAL'
  | 'DEFINITION_TERM'
  | 'ENTITY_IDENTITY'
  | 'SOURCE_OBSERVATION'
  | 'POLICY';

export type SemanticResourceTypeV2 =
  'CLAIM' | 'FACT' | 'ENTITY' | 'RELATION' | 'EVENT' | 'DECISION';

export type ReviewRecommendationV2 = 'NO_OP' | 'ADD_CLAIM' | 'MODIFY_REVIEW' | 'HOLD';
export type ShortlistReadinessV2 = 'READY' | 'STALE' | 'DEGRADED' | 'UNAVAILABLE';
export type ShortlistCoverageStatusV2 = 'COMPLETE' | 'PARTIAL' | 'INSUFFICIENT' | 'UNAVAILABLE';

export type ComparisonCandidateV2 = {
  readonly id: string;
  readonly revision: number;
  readonly digest: ComparisonDigestV2;
  readonly sourceVersionId: string;
  readonly evidenceIds: readonly string[];
};

export type CanonicalSnapshotIdentityV2 = {
  readonly id: string;
  readonly version: number;
  readonly digest: ComparisonDigestV2;
};

export type ShortlistTargetIdentityV2 = {
  readonly resourceType: SemanticResourceTypeV2;
  readonly resourceId: string;
  readonly resourceRevision: number;
};

/** The deterministic path pins the exact Claim without requiring a semantic shortlist. */
export type ExactDuplicateTargetV2 = {
  readonly resourceType: 'CLAIM';
  readonly resourceId: string;
  readonly resourceRevision: number;
  readonly canonicalSnapshot: CanonicalSnapshotIdentityV2;
};

export type ShortlistAuditV2 = {
  readonly contractVersion: ComparisonContractVersionV2;
  readonly canonicalSnapshot: CanonicalSnapshotIdentityV2;
  readonly lexicalProjectionWatermark: string;
  readonly lexicalProjectionBase: string;
  readonly semanticGenerationId: string;
  readonly semanticSourceProjectionDigest: ComparisonDigestV2;
  readonly semanticCanonicalBaseVersion: number;
  readonly querySemanticReadiness: ShortlistReadinessV2;
  readonly policyRevision: string;
  readonly k: number;
  readonly selectedTargetIdentities: readonly ShortlistTargetIdentityV2[];
  readonly exclusionCounts: Readonly<Record<string, number>>;
  readonly truncated: boolean;
  readonly coverageStatus: ShortlistCoverageStatusV2;
};

export type ShortlistAudit = ShortlistAuditV2;

export type ComparisonResultV2 = {
  readonly comparisonId: string;
  readonly contractVersion: ComparisonContractVersionV2;
  readonly projectId: string;
  readonly candidate: ComparisonCandidateV2;
  readonly canonicalSnapshot: CanonicalSnapshotIdentityV2;
  readonly disposition: ComparisonDispositionV2;
  readonly reviewRecommendation: ReviewRecommendationV2;
  readonly shortlist?: ShortlistAuditV2;
  readonly exactDuplicateTarget?: ExactDuplicateTargetV2;
  readonly analysisRevisionIds: readonly string[];
  readonly relationshipIds: readonly string[];
  readonly accessScope: readonly string[];
  readonly sensitivity: SecuritySensitivity;
  readonly createdAt: string;
};

export type GetComparisonResultV2 = {
  readonly contractVersion: ComparisonContractVersionV2;
  readonly projectId: string;
  readonly comparisonId: string;
  readonly accessScope: readonly string[];
  readonly sensitivity: SecuritySensitivity;
};

export type CheckComparisonFreshnessV2 = {
  readonly contractVersion: ComparisonContractVersionV2;
  readonly projectId: string;
  readonly comparisonId: string;
  readonly expected: ComparisonFreshnessIdentityV2;
  readonly current: ComparisonFreshnessIdentityV2;
  readonly shortlist?: Pick<
    ShortlistAuditV2,
    'querySemanticReadiness' | 'coverageStatus' | 'truncated'
  >;
};

export type CheckComparisonFreshnessOutputV2 = ComparisonFreshnessV2;

export type ComparedResourceIdentityV2 = {
  readonly resourceType: SemanticResourceTypeV2;
  readonly resourceId: string;
  readonly resourceRevision: number;
};

export type SemanticRelationshipV2 = {
  readonly relationshipId: string;
  readonly contractVersion: ComparisonContractVersionV2;
  readonly comparisonId: string;
  readonly candidateId: string;
  readonly candidateRevision: number;
  readonly candidateDigest: ComparisonDigestV2;
  readonly candidateEvidenceIds: readonly string[];
  readonly comparedResource: ComparedResourceIdentityV2;
  readonly canonicalSnapshot: {
    readonly snapshotId: string;
    readonly version: number;
    readonly digest: ComparisonDigestV2;
  };
  readonly type: SemanticRelationshipTypeV2;
  readonly conflictKind?: SemanticConflictKindV2;
  readonly analysisRevisionId: string;
  readonly ruleIdentity: string;
  readonly rationale: string;
  readonly materialDigest: ComparisonDigestV2;
  readonly accessScope: readonly string[];
  readonly sensitivity: SecuritySensitivity;
  readonly revision: number;
  readonly createdAt: string;
};

export type SemanticRelationship = SemanticRelationshipV2;

export type AnalysisLifecycleStateV2 =
  | 'PENDING'
  | 'ANALYZING'
  | 'COMPLETED'
  | 'SEMANTIC_UNAVAILABLE'
  | 'FAILED_RETRYABLE'
  | 'FAILED_TERMINAL'
  | 'POLICY_BLOCKED';

export type AnalysisOutcomeV2 = Exclude<AnalysisLifecycleStateV2, 'PENDING' | 'ANALYZING'>;

export type ComparisonSafeFailureCodeV2 =
  | 'SEMANTIC_UNAVAILABLE'
  | 'POLICY_DENIED'
  | 'RETRYABLE_DEPENDENCY'
  | 'TERMINAL_FAILURE'
  | 'OUTCOME_UNKNOWN'
  | 'CONTRACT_FAILURE'
  | 'STALE_COMPARISON'
  | 'SHORTLIST_COVERAGE_FAILURE'
  | 'RESOURCE_SCOPE_LEAK'
  | 'PROVIDER_UNAVAILABLE'
  | 'CAPABILITY_UNAVAILABLE'
  | 'ANALYSIS_TIMEOUT';

export type AnalysisRevisionV2 = {
  readonly analysisRevisionId: string;
  readonly contractVersion: ComparisonContractVersionV2;
  readonly comparisonId: string;
  readonly candidate: ComparisonCandidateV2;
  readonly canonicalSnapshot: CanonicalSnapshotIdentityV2;
  readonly inputDigest: ComparisonDigestV2;
  readonly shortlistDigest: ComparisonDigestV2;
  readonly comparedResourceIdentities: readonly ComparedResourceIdentityV2[];
  readonly providerIdentity: {
    readonly providerId: string;
    readonly modelId: string;
    readonly capabilityId: string;
  };
  readonly credentialRevisionRef: string;
  readonly promptTemplateRevision: string;
  readonly outputSchemaRevision: string;
  readonly semanticPolicyRevision: string;
  readonly attempt: number;
  readonly state: AnalysisLifecycleStateV2;
  readonly outcome?: AnalysisOutcomeV2;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly durationMs?: number;
  readonly outputDigest?: ComparisonDigestV2;
  readonly materialDigest?: ComparisonDigestV2;
  readonly safeFailureCode?: ComparisonSafeFailureCodeV2;
  readonly createdAt: string;
};

export type ComparisonCompletedV2 = {
  readonly eventType: 'ComparisonCompletedV2';
  readonly contractVersion: ComparisonContractVersionV2;
  readonly comparison: ComparisonResultV2;
  readonly analysisRevisionIds: readonly string[];
  readonly emittedAt: string;
};

export type ComparisonIncompleteV2 = {
  readonly eventType: 'ComparisonIncompleteV2';
  readonly contractVersion: ComparisonContractVersionV2;
  readonly comparisonId: string;
  readonly state: 'ANALYSIS_PENDING' | 'SEMANTIC_UNAVAILABLE' | 'POLICY_BLOCKED';
  readonly analysisRevisionId: string;
  readonly safeFailureCode: ComparisonSafeFailureCodeV2;
  readonly coverageStatus?: ShortlistCoverageStatusV2;
  readonly emittedAt: string;
};

export type ComparisonFailedV2 = {
  readonly eventType: 'ComparisonFailedV2';
  readonly contractVersion: ComparisonContractVersionV2;
  readonly comparisonId: string;
  readonly state: 'FAILED_RETRYABLE' | 'FAILED_TERMINAL';
  readonly analysisRevisionId: string;
  readonly safeFailureCode: ComparisonSafeFailureCodeV2;
  readonly emittedAt: string;
};

export const COMPARISON_FRESHNESS_REASONS_V2 = [
  'CANDIDATE_CHANGED',
  'CANDIDATE_EVIDENCE_CHANGED',
  'CANONICAL_SNAPSHOT_CHANGED',
  'SHORTLIST_POLICY_CHANGED',
  'ACCESS_SENSITIVITY_POLICY_CHANGED',
  'SEMANTIC_GENERATION_CHANGED',
  'SEMANTIC_BASE_CHANGED',
  'PROVIDER_MODEL_CAPABILITY_CHANGED',
  'PROMPT_TEMPLATE_CHANGED',
  'OUTPUT_SCHEMA_CHANGED',
  'SEMANTIC_POLICY_CHANGED',
  'ROLLOUT_AUTHORITY_CHANGED',
  'SHORTLIST_STALE',
  'SHORTLIST_DEGRADED',
  'SHORTLIST_UNAVAILABLE',
  'SHORTLIST_INSUFFICIENT',
  'SHORTLIST_TRUNCATED',
] as const;

export type ComparisonFreshnessReasonV2 = (typeof COMPARISON_FRESHNESS_REASONS_V2)[number];

export type ComparisonFreshnessStatusV2 = 'FRESH' | 'STALE';
export type ComparisonFreshnessV2 = {
  readonly status: ComparisonFreshnessStatusV2;
  readonly reasons: readonly ComparisonFreshnessReasonV2[];
};

export type ComparisonFreshnessIdentityV2 = {
  readonly candidateId: string;
  readonly candidateRevision: number;
  readonly candidateSourceVersionId: string;
  readonly candidateDigest: string;
  readonly candidateEvidenceDigest: string;
  readonly canonicalSnapshotId: string;
  readonly canonicalSnapshotDigest: string;
  readonly canonicalSnapshotVersion: number;
  readonly shortlistDigest: ComparisonDigestV2;
  readonly shortlistPolicyRevision: string;
  readonly accessSensitivityPolicyRevision?: string;
  readonly semanticGenerationId: string;
  readonly semanticSourceProjectionDigest: string;
  readonly semanticCanonicalBaseVersion: number;
  readonly providerModelCapabilityIdentity: string;
  readonly promptTemplateRevision: string;
  readonly outputSchemaRevision: string;
  readonly semanticPolicyRevision: string;
  readonly rolloutAuthorityRevision?: string;
};

export type DraftChangeSetV2Status =
  'PENDING_REVIEW' | 'ON_HOLD' | 'APPROVED' | 'REJECTED' | 'STALE';

export type DraftChangeSetV2 = {
  readonly changeSetId: string;
  readonly contractVersion: ComparisonContractVersionV2;
  readonly revisionNumber: number;
  readonly projectId: string;
  readonly candidate: ComparisonCandidateV2;
  readonly comparisonId: string;
  readonly comparisonDigest: ComparisonDigestV2;
  readonly canonicalSnapshot: CanonicalSnapshotIdentityV2;
  readonly analysisRevisionIds: readonly string[];
  readonly disposition: ComparisonDispositionV2;
  readonly relationshipIds: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly operation: 'ADD_CLAIM' | 'NO_OP' | 'MODIFY_REVIEW';
  readonly reviewRecommendation: ReviewRecommendationV2;
  readonly status: DraftChangeSetV2Status;
  readonly expectedCanonicalVersion: number;
  readonly snapshotDigest: ComparisonDigestV2;
  readonly shortlistDigest: ComparisonDigestV2;
  readonly freshnessIdentity: ComparisonFreshnessIdentityV2;
  readonly freshnessDigest: ComparisonDigestV2;
  readonly accessScope: readonly string[];
  readonly sensitivity: SecuritySensitivity;
  readonly contentDigest: ComparisonDigestV2;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type ApprovedChangeSetManifestV2 = {
  readonly manifestId: string;
  readonly contractVersion: ComparisonContractVersionV2;
  readonly changeSetId: string;
  readonly changeSetRevisionNumber: number;
  readonly projectId: string;
  readonly candidate: ComparisonCandidateV2;
  readonly comparisonId: string;
  readonly comparisonDigest: ComparisonDigestV2;
  readonly canonicalSnapshot: CanonicalSnapshotIdentityV2;
  readonly analysisRevisionIds: readonly string[];
  readonly disposition: ComparisonDispositionV2;
  readonly relationshipIds: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly operation: DraftChangeSetV2['operation'];
  readonly expectedCanonicalVersion: number;
  readonly snapshotDigest: ComparisonDigestV2;
  readonly shortlistDigest: ComparisonDigestV2;
  readonly freshnessIdentity: ComparisonFreshnessIdentityV2;
  readonly freshnessDigest: ComparisonDigestV2;
  readonly accessScope: readonly string[];
  readonly sensitivity: SecuritySensitivity;
  readonly contentDigest: ComparisonDigestV2;
  readonly userApproval: {
    readonly actor: { readonly type: 'user'; readonly id: string };
    readonly reason: string;
    readonly approvalTokenId: string;
    readonly approvalToken: ApprovedChangeSetApprovalTokenV2;
    readonly approvedAt: string;
  };
  readonly createdAt: string;
  readonly manifestDigest: ComparisonDigestV2;
};

export type ApprovedChangeSetApprovalTokenV2 = {
  readonly tokenId: string;
  readonly changeSetId: string;
  readonly changeSetRevisionNumber: number;
  readonly actorId: string;
  readonly contentDigest: ComparisonDigestV2;
  readonly expectedCanonicalVersion: number;
  readonly snapshotDigest: ComparisonDigestV2;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly tokenDigest: ComparisonDigestV2;
};

export type ComparisonRolloutStateV2 = 'V1_ONLY' | 'V2_SHADOW' | 'V2_ACTIVE';
export type ReviewContractVersionV2 = '1.0' | '2.0';
export type ReviewAuthorityCandidateV2 = {
  readonly projectId: string;
  readonly candidateId: string;
  readonly candidateRevision: number;
  readonly contractVersion: ReviewContractVersionV2;
  readonly reviewAuthoritative: boolean;
};

export type ReviewAuthoritySelectionV2 = {
  readonly projectId: string;
  readonly candidateId: string;
  readonly candidateRevision: number;
  readonly rollout: ComparisonRolloutStateV2;
  readonly candidates: readonly ReviewAuthorityCandidateV2[];
};

export type ComparisonContractErrorCodeV2 =
  | 'INVALID_CONTRACT'
  | 'UNSUPPORTED_VERSION'
  | 'INVALID_TRANSITION'
  | 'RESOURCE_SCOPE_LEAK'
  | 'SHORTLIST_COVERAGE_FAILURE'
  | 'REVIEW_AUTHORITY_FAILURE'
  | 'REVIEW_NOT_ELIGIBLE'
  | 'FRESHNESS_FAILURE';

export class ComparisonContractErrorV2 extends Error {
  readonly code: ComparisonContractErrorCodeV2;
  readonly path?: string;

  constructor(code: ComparisonContractErrorCodeV2, message: string, path?: string) {
    super(message);
    this.name = 'ComparisonContractErrorV2';
    this.code = code;
    this.path = path;
  }
}

const ajv = new Ajv({ allErrors: true, strict: true });
ajv.addSchema(shortlistAuditSchema, 'shortlist-audit-v2.schema.json');
const validateComparisonSchema: ValidateFunction = ajv.compile(comparisonResultSchema);
const validateShortlistSchema: ValidateFunction = ajv.compile(shortlistAuditSchema);
const validateRelationshipSchema: ValidateFunction = ajv.compile(semanticRelationshipSchema);
const validateAnalysisSchema: ValidateFunction = ajv.compile(analysisRevisionSchema);
const validateDraftSchema: ValidateFunction = ajv.compile(draftChangeSetSchema);
const validateManifestSchema: ValidateFunction = ajv.compile(approvedManifestSchema);
const validateFreshnessSchema: ValidateFunction = ajv.compile(comparisonFreshnessSchema);
const validateFreshnessOutputSchema: ValidateFunction = ajv.compile(
  comparisonFreshnessOutputSchema,
);

const fail = (message: string, path?: string): never => {
  throw new ComparisonContractErrorV2('INVALID_CONTRACT', message, path);
};

const nonEmpty = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${path} must be non-empty`, path);
    return '';
  }
  return value;
};

const nonEmptyArray = (value: unknown, path: string): readonly string[] => {
  if (!Array.isArray(value) || value.length === 0)
    fail(`${path} must contain at least one item`, path);
  const items = value as readonly unknown[];
  for (const [index, item] of items.entries()) nonEmpty(item, `${path}[${index}]`);
  return items as readonly string[];
};

const unique = (values: readonly string[], path: string): void => {
  if (new Set(values).size !== values.length) fail(`${path} must contain unique identities`, path);
};

const ensureVersion = (value: unknown, path: string): void => {
  if (value !== COMPARISON_V2_CONTRACT_VERSION) {
    throw new ComparisonContractErrorV2(
      'UNSUPPORTED_VERSION',
      `${path} must be ${COMPARISON_V2_CONTRACT_VERSION}`,
      path,
    );
  }
};

const assertAjv = (valid: boolean, errors: unknown, path: string): void => {
  if (!valid) fail(`${path} schema validation failed: ${JSON.stringify(errors)}`, path);
};

const assertSnapshotEqual = (
  left: CanonicalSnapshotIdentityV2,
  right: CanonicalSnapshotIdentityV2,
  path: string,
): void => {
  if (left.id !== right.id || left.version !== right.version || left.digest !== right.digest) {
    throw new ComparisonContractErrorV2(
      'SHORTLIST_COVERAGE_FAILURE',
      'Canonical snapshot identities must match exactly',
      path,
    );
  }
};

const validateShortlistTargetIdentityV2 = (
  target: ShortlistTargetIdentityV2,
  path: string,
): void => {
  nonEmpty(target.resourceId, `${path}.resourceId`);
  if (!Number.isInteger(target.resourceRevision) || target.resourceRevision < 1) {
    fail(`${path}.resourceRevision must be positive`, `${path}.resourceRevision`);
  }
  if (target.resourceType !== 'CLAIM') {
    throw new ComparisonContractErrorV2(
      'RESOURCE_SCOPE_LEAK',
      'Issue #203 active shortlist targets are Claim-only',
      `${path}.resourceType`,
    );
  }
};

export const validateShortlistAuditV2: (value: unknown) => asserts value is ShortlistAuditV2 = (
  value,
) => {
  assertAjv(validateShortlistSchema(value), validateShortlistSchema.errors, 'shortlist');
  const shortlist = value as ShortlistAuditV2;
  ensureVersion(shortlist.contractVersion, 'shortlist.contractVersion');
  if (shortlist.semanticCanonicalBaseVersion !== shortlist.canonicalSnapshot.version) {
    throw new ComparisonContractErrorV2(
      'SHORTLIST_COVERAGE_FAILURE',
      'Semantic generation canonical base must match the pinned Canonical snapshot version',
      'shortlist.semanticCanonicalBaseVersion',
    );
  }
  if (shortlist.k < 1) fail('shortlist.k must be positive', 'shortlist.k');
  if (shortlist.selectedTargetIdentities.length > shortlist.k) {
    fail('selectedTargetIdentities cannot exceed k', 'shortlist.selectedTargetIdentities');
  }
  const targetKeys = shortlist.selectedTargetIdentities.map((target) => {
    validateShortlistTargetIdentityV2(target, 'shortlist.selectedTargetIdentities');
    return `${target.resourceType}:${target.resourceId}:${target.resourceRevision}`;
  });
  unique(targetKeys, 'shortlist.selectedTargetIdentities');
  if (shortlist.truncated && shortlist.coverageStatus === 'COMPLETE') {
    fail('truncated shortlist cannot claim COMPLETE coverage', 'shortlist.coverageStatus');
  }
  if (
    shortlist.querySemanticReadiness === 'UNAVAILABLE' &&
    shortlist.coverageStatus !== 'UNAVAILABLE'
  ) {
    fail('UNAVAILABLE readiness requires UNAVAILABLE coverage', 'shortlist.coverageStatus');
  }
  for (const [key, count] of Object.entries(shortlist.exclusionCounts)) {
    if (!Number.isInteger(count) || count < 0)
      fail(`${key} exclusion count must be non-negative`, key);
  }
};

export const validateSemanticRelationshipV2: (
  value: unknown,
) => asserts value is SemanticRelationshipV2 = (value: unknown) => {
  assertAjv(validateRelationshipSchema(value), validateRelationshipSchema.errors, 'relationship');
  const relationship = value as SemanticRelationshipV2;
  ensureVersion(relationship.contractVersion, 'relationship.contractVersion');
  nonEmptyArray(relationship.candidateEvidenceIds, 'relationship.candidateEvidenceIds');
  nonEmptyArray(relationship.accessScope, 'relationship.accessScope');
  unique(relationship.candidateEvidenceIds, 'relationship.candidateEvidenceIds');
  if (relationship.comparedResource.resourceType !== 'CLAIM') {
    throw new ComparisonContractErrorV2(
      'RESOURCE_SCOPE_LEAK',
      'Issue #203 v2 activation is Claim-only',
      'relationship.comparedResource.resourceType',
    );
  }
  if (relationship.type === 'CONTRADICTS' && relationship.conflictKind === undefined) {
    fail('CONTRADICTS requires an explicit conflictKind', 'relationship.conflictKind');
  }
  if (relationship.type === 'POLICY_BLOCKED' && relationship.conflictKind !== 'POLICY') {
    fail('POLICY_BLOCKED requires conflictKind POLICY', 'relationship.conflictKind');
  }
  if (
    relationship.conflictKind !== undefined &&
    relationship.type !== 'CONTRADICTS' &&
    relationship.type !== 'POLICY_BLOCKED'
  ) {
    fail(
      'conflictKind is only valid for CONTRADICTS or POLICY_BLOCKED',
      'relationship.conflictKind',
    );
  }
};

export const validateAnalysisRevisionV2: (value: unknown) => asserts value is AnalysisRevisionV2 = (
  value,
) => {
  assertAjv(validateAnalysisSchema(value), validateAnalysisSchema.errors, 'analysisRevision');
  const revision = value as AnalysisRevisionV2;
  ensureVersion(revision.contractVersion, 'analysisRevision.contractVersion');
  nonEmptyArray(revision.candidate.evidenceIds, 'analysisRevision.candidate.evidenceIds');
  if (revision.candidate.revision < 1 || revision.attempt < 1)
    fail('revision and attempt must be positive');
  if (revision.comparedResourceIdentities.some((resource) => resource.resourceType !== 'CLAIM')) {
    throw new ComparisonContractErrorV2(
      'RESOURCE_SCOPE_LEAK',
      'AnalysisRevisionV2 may only compare Claim resources during initial activation',
      'analysisRevision.comparedResourceIdentities',
    );
  }
  if (revision.inputDigest !== analysisInputDigestV2(revision)) {
    fail(
      'AnalysisRevisionV2 inputDigest does not match immutable analysis input',
      'analysisRevision.inputDigest',
    );
  }
  const terminal = revision.state !== 'PENDING' && revision.state !== 'ANALYZING';
  if (terminal && revision.outcome !== revision.state)
    fail('terminal state must equal outcome', 'analysisRevision.outcome');
  if (!terminal && revision.outcome !== undefined)
    fail('non-terminal analysis cannot declare a terminal outcome', 'analysisRevision.outcome');
  if (revision.state === 'COMPLETED' && (!revision.outputDigest || !revision.materialDigest)) {
    fail('COMPLETED analysis requires outputDigest and materialDigest');
  }
  if (revision.state !== 'COMPLETED' && terminal && !revision.safeFailureCode) {
    fail('failed/unavailable analysis requires safeFailureCode');
  }
};

export const validateComparisonResultV2: (value: unknown) => asserts value is ComparisonResultV2 = (
  value,
) => {
  assertAjv(validateComparisonSchema(value), validateComparisonSchema.errors, 'comparison');
  const comparison = value as ComparisonResultV2;
  ensureVersion(comparison.contractVersion, 'comparison.contractVersion');
  nonEmptyArray(comparison.candidate.evidenceIds, 'comparison.candidate.evidenceIds');
  nonEmptyArray(comparison.accessScope, 'comparison.accessScope');
  unique(comparison.relationshipIds, 'comparison.relationshipIds');
  unique(comparison.analysisRevisionIds, 'comparison.analysisRevisionIds');
  if (comparison.candidate.revision < 1) fail('candidate.revision must be positive');
  if (comparison.disposition === 'EXACT_DUPLICATE') {
    if (comparison.reviewRecommendation !== 'NO_OP') {
      fail('EXACT_DUPLICATE must recommend NO_OP', 'comparison.reviewRecommendation');
    }
    if (comparison.relationshipIds.length > 0 || comparison.analysisRevisionIds.length > 0) {
      fail('EXACT_DUPLICATE cannot contain semantic analysis', 'comparison');
    }
    if (comparison.shortlist !== undefined) {
      fail('EXACT_DUPLICATE must not depend on a semantic shortlist', 'comparison.shortlist');
    }
    const target = comparison.exactDuplicateTarget;
    if (target === undefined) {
      fail('EXACT_DUPLICATE requires an exact Canonical Claim target');
      return;
    }
    if (target.resourceType !== 'CLAIM') fail('Exact duplicate target must be a Claim');
    nonEmpty(target.resourceId, 'comparison.exactDuplicateTarget.resourceId');
    if (target.resourceRevision < 1) fail('Exact duplicate target revision must be positive');
    assertSnapshotEqual(
      target.canonicalSnapshot,
      comparison.canonicalSnapshot,
      'comparison.exactDuplicateTarget',
    );
  } else {
    if (comparison.exactDuplicateTarget !== undefined) {
      fail(
        'exactDuplicateTarget is only valid for EXACT_DUPLICATE',
        'comparison.exactDuplicateTarget',
      );
    }
    if (comparison.shortlist === undefined) {
      fail('Non-exact v2 comparisons require a semantic shortlist', 'comparison.shortlist');
    }
    validateShortlistAuditV2(comparison.shortlist);
    assertSnapshotEqual(
      comparison.shortlist.canonicalSnapshot,
      comparison.canonicalSnapshot,
      'comparison.shortlist.canonicalSnapshot',
    );
  }
  if (comparison.disposition === 'NEW') {
    if (comparison.reviewRecommendation !== 'ADD_CLAIM') {
      fail('NEW comparisons must recommend ADD_CLAIM', 'comparison.reviewRecommendation');
    }
    if (
      comparison.shortlist!.coverageStatus !== 'COMPLETE' ||
      comparison.shortlist!.querySemanticReadiness !== 'READY' ||
      comparison.shortlist!.truncated ||
      Object.values(comparison.shortlist!.exclusionCounts).some((count) => count > 0)
    ) {
      throw new ComparisonContractErrorV2(
        'SHORTLIST_COVERAGE_FAILURE',
        'NEW requires complete, ready, non-truncated, non-excluded comparison coverage',
        'comparison.shortlist',
      );
    }
    if (comparison.relationshipIds.length > 0 || comparison.analysisRevisionIds.length === 0) {
      fail('NEW requires completed analysis and no material relationship', 'comparison');
    }
  }
  if (
    comparison.disposition === 'SEMANTIC_UNAVAILABLE' ||
    comparison.disposition === 'ANALYSIS_PENDING' ||
    comparison.disposition === 'POLICY_BLOCKED' ||
    comparison.disposition === 'STALE'
  ) {
    if (comparison.reviewRecommendation !== 'HOLD')
      fail(`${comparison.disposition} must recommend HOLD`);
    if (comparison.relationshipIds.length > 0)
      fail(`${comparison.disposition} cannot contain relationships`);
  }
  if (comparison.disposition === 'REVIEW_REQUIRED' && comparison.relationshipIds.length === 0) {
    fail('REVIEW_REQUIRED must reference at least one relationship', 'comparison.relationshipIds');
  }
  if (comparison.disposition === 'REVIEW_REQUIRED' && comparison.analysisRevisionIds.length === 0) {
    fail(
      'REVIEW_REQUIRED requires a completed analysis revision',
      'comparison.analysisRevisionIds',
    );
  }
};

export const validateDraftChangeSetV2: (value: unknown) => asserts value is DraftChangeSetV2 = (
  value,
) => {
  assertAjv(validateDraftSchema(value), validateDraftSchema.errors, 'draftChangeSet');
  const draft = value as DraftChangeSetV2;
  ensureVersion(draft.contractVersion, 'draftChangeSet.contractVersion');
  nonEmptyArray(draft.accessScope, 'draftChangeSet.accessScope');
  nonEmptyArray(draft.candidate.evidenceIds, 'draftChangeSet.candidate.evidenceIds');
  nonEmptyArray(draft.evidenceIds, 'draftChangeSet.evidenceIds');
  unique(draft.analysisRevisionIds, 'draftChangeSet.analysisRevisionIds');
  unique(draft.relationshipIds, 'draftChangeSet.relationshipIds');
  validateComparisonFreshnessIdentityV2(draft.freshnessIdentity);
  if (draft.freshnessDigest !== comparisonFreshnessDigestV2(draft.freshnessIdentity)) {
    fail(
      'Draft freshnessDigest does not match freshnessIdentity',
      'draftChangeSet.freshnessDigest',
    );
  }
  assertDraftFreshnessBindingsV2(draft);
  if (
    ['SEMANTIC_UNAVAILABLE', 'POLICY_BLOCKED', 'ANALYSIS_PENDING', 'STALE'].includes(
      draft.disposition,
    ) ||
    draft.status === 'STALE'
  ) {
    throw new ComparisonContractErrorV2(
      'REVIEW_NOT_ELIGIBLE',
      `${draft.disposition} cannot produce DraftChangeSetV2`,
      'draftChangeSet.disposition',
    );
  }
  if (draft.status === 'APPROVED' && draft.reviewRecommendation === 'HOLD') {
    fail('HOLD DraftChangeSetV2 cannot be APPROVED', 'draftChangeSet.status');
  }
};

export const validateApprovedChangeSetManifestV2: (
  value: unknown,
) => asserts value is ApprovedChangeSetManifestV2 = (value) => {
  assertAjv(validateManifestSchema(value), validateManifestSchema.errors, 'manifest');
  const manifest = value as ApprovedChangeSetManifestV2;
  nonEmptyArray(manifest.candidate.evidenceIds, 'manifest.candidate.evidenceIds');
  nonEmptyArray(manifest.evidenceIds, 'manifest.evidenceIds');
  nonEmptyArray(manifest.accessScope, 'manifest.accessScope');
  unique(manifest.analysisRevisionIds, 'manifest.analysisRevisionIds');
  unique(manifest.relationshipIds, 'manifest.relationshipIds');
  ensureVersion(manifest.contractVersion, 'manifest.contractVersion');
  validateComparisonFreshnessIdentityV2(manifest.freshnessIdentity);
  if (manifest.freshnessDigest !== comparisonFreshnessDigestV2(manifest.freshnessIdentity)) {
    fail('Manifest freshnessDigest does not match freshnessIdentity', 'manifest.freshnessDigest');
  }
  assertManifestFreshnessBindingsV2(manifest);
  if (manifest.userApproval.actor.type !== 'user') {
    throw new ComparisonContractErrorV2(
      'REVIEW_NOT_ELIGIBLE',
      'Only a user may approve a v2 manifest',
    );
  }
  if (
    ['SEMANTIC_UNAVAILABLE', 'POLICY_BLOCKED', 'ANALYSIS_PENDING', 'STALE'].includes(
      manifest.disposition,
    )
  ) {
    throw new ComparisonContractErrorV2(
      'REVIEW_NOT_ELIGIBLE',
      'Manifest cannot be created from an unavailable comparison',
    );
  }
  const token = manifest.userApproval.approvalToken;
  if (manifest.userApproval.approvalTokenId !== token.tokenId) {
    fail(
      'approvalTokenId must match the immutable approval token reference',
      'manifest.userApproval',
    );
  }
  if (
    token.changeSetId !== manifest.changeSetId ||
    token.changeSetRevisionNumber !== manifest.changeSetRevisionNumber ||
    token.actorId !== manifest.userApproval.actor.id ||
    token.contentDigest !== manifest.contentDigest ||
    token.expectedCanonicalVersion !== manifest.expectedCanonicalVersion ||
    token.snapshotDigest !== manifest.snapshotDigest ||
    (() => {
      const { tokenDigest, ...tokenMaterial } = token;
      return tokenDigest !== approvedChangeSetApprovalTokenDigestV2(tokenMaterial);
    })()
  ) {
    fail(
      'Approval token is not bound to the exact approved change set',
      'manifest.userApproval.approvalToken',
    );
  }
};

const validateComparisonFreshnessIdentityV2 = (identity: ComparisonFreshnessIdentityV2): void => {
  nonEmpty(identity.candidateId, 'freshnessIdentity.candidateId');
  nonEmpty(identity.candidateSourceVersionId, 'freshnessIdentity.candidateSourceVersionId');
  nonEmpty(identity.candidateDigest, 'freshnessIdentity.candidateDigest');
  nonEmpty(identity.candidateEvidenceDigest, 'freshnessIdentity.candidateEvidenceDigest');
  nonEmpty(identity.canonicalSnapshotId, 'freshnessIdentity.canonicalSnapshotId');
  nonEmpty(identity.canonicalSnapshotDigest, 'freshnessIdentity.canonicalSnapshotDigest');
  nonEmpty(identity.shortlistDigest, 'freshnessIdentity.shortlistDigest');
  if (identity.candidateRevision < 1 || identity.canonicalSnapshotVersion < 0) {
    fail('freshness identity versions must be valid');
  }
};

const assertDraftFreshnessBindingsV2 = (draft: DraftChangeSetV2): void => {
  const freshness = draft.freshnessIdentity;
  if (
    freshness.candidateId !== draft.candidate.id ||
    freshness.candidateRevision !== draft.candidate.revision ||
    freshness.candidateSourceVersionId !== draft.candidate.sourceVersionId ||
    freshness.candidateDigest !== draft.candidate.digest ||
    freshness.candidateEvidenceDigest !== candidateEvidenceDigestV2(draft.candidate) ||
    freshness.canonicalSnapshotId !== draft.canonicalSnapshot.id ||
    freshness.canonicalSnapshotVersion !== draft.canonicalSnapshot.version ||
    freshness.canonicalSnapshotDigest !== draft.canonicalSnapshot.digest ||
    freshness.shortlistDigest !== draft.shortlistDigest ||
    draft.snapshotDigest !== draft.canonicalSnapshot.digest ||
    draft.expectedCanonicalVersion !== draft.canonicalSnapshot.version
  ) {
    fail(
      'Draft freshness identity is inconsistent with its pinned review identities',
      'draftChangeSet.freshnessIdentity',
    );
  }
};

const assertManifestFreshnessBindingsV2 = (manifest: ApprovedChangeSetManifestV2): void => {
  const freshness = manifest.freshnessIdentity;
  if (
    freshness.candidateId !== manifest.candidate.id ||
    freshness.candidateRevision !== manifest.candidate.revision ||
    freshness.candidateSourceVersionId !== manifest.candidate.sourceVersionId ||
    freshness.candidateDigest !== manifest.candidate.digest ||
    freshness.candidateEvidenceDigest !== candidateEvidenceDigestV2(manifest.candidate) ||
    freshness.canonicalSnapshotId !== manifest.canonicalSnapshot.id ||
    freshness.canonicalSnapshotVersion !== manifest.canonicalSnapshot.version ||
    freshness.canonicalSnapshotDigest !== manifest.canonicalSnapshot.digest ||
    freshness.shortlistDigest !== manifest.shortlistDigest ||
    manifest.snapshotDigest !== manifest.canonicalSnapshot.digest ||
    manifest.expectedCanonicalVersion !== manifest.canonicalSnapshot.version
  ) {
    fail(
      'Manifest freshness identity is inconsistent with its pinned approval identities',
      'manifest.freshnessIdentity',
    );
  }
};

const allowedTransitions: Readonly<
  Record<AnalysisLifecycleStateV2, readonly AnalysisLifecycleStateV2[]>
> = {
  PENDING: ['ANALYZING'],
  ANALYZING: [
    'COMPLETED',
    'SEMANTIC_UNAVAILABLE',
    'FAILED_RETRYABLE',
    'FAILED_TERMINAL',
    'POLICY_BLOCKED',
  ],
  COMPLETED: [],
  SEMANTIC_UNAVAILABLE: [],
  FAILED_RETRYABLE: ['ANALYZING'],
  FAILED_TERMINAL: [],
  POLICY_BLOCKED: [],
};

export const canTransitionAnalysisStateV2 = (
  from: AnalysisLifecycleStateV2,
  to: AnalysisLifecycleStateV2,
): boolean => allowedTransitions[from].includes(to);

export const assertAnalysisStateTransitionV2 = (
  from: AnalysisLifecycleStateV2,
  to: AnalysisLifecycleStateV2,
): void => {
  if (!canTransitionAnalysisStateV2(from, to)) {
    throw new ComparisonContractErrorV2(
      'INVALID_TRANSITION',
      `Illegal analysis transition ${from} -> ${to}`,
    );
  }
};

const sorted = (values: readonly string[]): readonly string[] =>
  [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const digest = (value: unknown): ComparisonDigestV2 => sha256Text(stableJson(value));
const sortedTargets = (
  values: readonly ShortlistTargetIdentityV2[],
): readonly ShortlistTargetIdentityV2[] =>
  [...values].sort((left, right) => {
    const a = `${left.resourceType}:${left.resourceId}:${left.resourceRevision}`;
    const b = `${right.resourceType}:${right.resourceId}:${right.resourceRevision}`;
    return a < b ? -1 : a > b ? 1 : 0;
  });

/** Provider-free exact identity used before any semantic shortlist/provider path. */
export const normalizeExactClaimIdentityV2 = (text: string): string =>
  text.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');

export const exactClaimIdentityDigestV2 = (text: string): ComparisonDigestV2 =>
  digest({
    identityVersion: 'comparison-exact-claim:v2',
    normalizedText: normalizeExactClaimIdentityV2(text),
  });

export const isExactDuplicateV2 = (candidateText: string, canonicalText: string): boolean =>
  normalizeExactClaimIdentityV2(candidateText) === normalizeExactClaimIdentityV2(canonicalText);

export const shortlistAuditDigestV2 = (audit: ShortlistAuditV2): ComparisonDigestV2 =>
  digest({ ...audit, selectedTargetIdentities: sortedTargets(audit.selectedTargetIdentities) });

export const candidateEvidenceDigestV2 = (
  candidate: Pick<ComparisonCandidateV2, 'evidenceIds'>,
): ComparisonDigestV2 => digest({ evidenceIds: sorted(candidate.evidenceIds) });

export const comparisonFreshnessDigestV2 = (
  identity: ComparisonFreshnessIdentityV2,
): ComparisonDigestV2 => digest(identity);

export const analysisInputDigestV2 = (
  input: Pick<
    AnalysisRevisionV2,
    | 'comparisonId'
    | 'candidate'
    | 'canonicalSnapshot'
    | 'shortlistDigest'
    | 'comparedResourceIdentities'
    | 'providerIdentity'
    | 'credentialRevisionRef'
    | 'promptTemplateRevision'
    | 'outputSchemaRevision'
    | 'semanticPolicyRevision'
  >,
): ComparisonDigestV2 =>
  digest({
    comparisonId: input.comparisonId,
    candidate: {
      ...input.candidate,
      evidenceIds: sorted(input.candidate.evidenceIds),
    },
    canonicalSnapshot: input.canonicalSnapshot,
    shortlistDigest: input.shortlistDigest,
    comparedResourceIdentities: [...input.comparedResourceIdentities].sort((left, right) => {
      const a = `${left.resourceType}:${left.resourceId}:${left.resourceRevision}`;
      const b = `${right.resourceType}:${right.resourceId}:${right.resourceRevision}`;
      return a < b ? -1 : a > b ? 1 : 0;
    }),
    providerIdentity: input.providerIdentity,
    credentialRevisionRef: input.credentialRevisionRef,
    promptTemplateRevision: input.promptTemplateRevision,
    outputSchemaRevision: input.outputSchemaRevision,
    semanticPolicyRevision: input.semanticPolicyRevision,
  });

export const approvedChangeSetApprovalTokenDigestV2 = (
  token: Omit<ApprovedChangeSetApprovalTokenV2, 'tokenDigest'>,
): ComparisonDigestV2 => digest(token);

export const analysisRevisionDigestV2 = (
  revision: Omit<AnalysisRevisionV2, 'outputDigest' | 'materialDigest'> &
    Partial<Pick<AnalysisRevisionV2, 'outputDigest' | 'materialDigest'>>,
): ComparisonDigestV2 => digest(revision);

export const semanticRelationshipMaterialDigestV2 = (
  relationship: Omit<SemanticRelationshipV2, 'materialDigest'>,
): ComparisonDigestV2 => digest(relationship);

export const comparisonResultDigestV2 = (comparison: ComparisonResultV2): ComparisonDigestV2 =>
  digest({
    ...comparison,
    analysisRevisionIds: sorted(comparison.analysisRevisionIds),
    relationshipIds: sorted(comparison.relationshipIds),
  });

export const draftChangeSetContentDigestV2 = (
  draft: Omit<DraftChangeSetV2, 'contentDigest'>,
): ComparisonDigestV2 => digest({ ...draft, relationshipIds: sorted(draft.relationshipIds) });

export const approvedChangeSetManifestDigestV2 = (
  manifest: Omit<ApprovedChangeSetManifestV2, 'manifestDigest'>,
): ComparisonDigestV2 => digest({ ...manifest, relationshipIds: sorted(manifest.relationshipIds) });

export const evaluateComparisonFreshnessV2 = (
  expected: ComparisonFreshnessIdentityV2,
  current: ComparisonFreshnessIdentityV2,
  shortlist?: Pick<ShortlistAuditV2, 'querySemanticReadiness' | 'coverageStatus' | 'truncated'>,
): ComparisonFreshnessV2 => {
  const reasons: ComparisonFreshnessReasonV2[] = [];
  if (
    expected.candidateId !== current.candidateId ||
    expected.candidateRevision !== current.candidateRevision ||
    expected.candidateSourceVersionId !== current.candidateSourceVersionId ||
    expected.candidateDigest !== current.candidateDigest
  )
    reasons.push('CANDIDATE_CHANGED');
  if (expected.candidateEvidenceDigest !== current.candidateEvidenceDigest) {
    reasons.push('CANDIDATE_EVIDENCE_CHANGED');
  }
  if (
    expected.canonicalSnapshotId !== current.canonicalSnapshotId ||
    expected.canonicalSnapshotDigest !== current.canonicalSnapshotDigest ||
    expected.canonicalSnapshotVersion !== current.canonicalSnapshotVersion
  )
    reasons.push('CANONICAL_SNAPSHOT_CHANGED');
  if (expected.shortlistPolicyRevision !== current.shortlistPolicyRevision)
    reasons.push('SHORTLIST_POLICY_CHANGED');
  if (expected.shortlistDigest !== current.shortlistDigest)
    reasons.push('SHORTLIST_POLICY_CHANGED');
  if (expected.accessSensitivityPolicyRevision !== current.accessSensitivityPolicyRevision) {
    reasons.push('ACCESS_SENSITIVITY_POLICY_CHANGED');
  }
  if (expected.semanticGenerationId !== current.semanticGenerationId)
    reasons.push('SEMANTIC_GENERATION_CHANGED');
  if (expected.semanticSourceProjectionDigest !== current.semanticSourceProjectionDigest)
    reasons.push('SEMANTIC_BASE_CHANGED');
  if (expected.semanticCanonicalBaseVersion !== current.semanticCanonicalBaseVersion)
    reasons.push('SEMANTIC_BASE_CHANGED');
  if (expected.providerModelCapabilityIdentity !== current.providerModelCapabilityIdentity) {
    reasons.push('PROVIDER_MODEL_CAPABILITY_CHANGED');
  }
  if (expected.promptTemplateRevision !== current.promptTemplateRevision)
    reasons.push('PROMPT_TEMPLATE_CHANGED');
  if (expected.outputSchemaRevision !== current.outputSchemaRevision)
    reasons.push('OUTPUT_SCHEMA_CHANGED');
  if (expected.semanticPolicyRevision !== current.semanticPolicyRevision)
    reasons.push('SEMANTIC_POLICY_CHANGED');
  if (expected.rolloutAuthorityRevision !== current.rolloutAuthorityRevision)
    reasons.push('ROLLOUT_AUTHORITY_CHANGED');
  if (shortlist?.querySemanticReadiness === 'STALE') reasons.push('SHORTLIST_STALE');
  if (shortlist?.querySemanticReadiness === 'DEGRADED') reasons.push('SHORTLIST_DEGRADED');
  if (shortlist?.querySemanticReadiness === 'UNAVAILABLE') reasons.push('SHORTLIST_UNAVAILABLE');
  if (shortlist?.coverageStatus === 'INSUFFICIENT') reasons.push('SHORTLIST_INSUFFICIENT');
  if (shortlist?.truncated) reasons.push('SHORTLIST_TRUNCATED');
  return { status: reasons.length === 0 ? 'FRESH' : 'STALE', reasons: [...new Set(reasons)] };
};

export const validateComparisonFreshnessV2: (
  value: unknown,
) => asserts value is ComparisonFreshnessV2 = (value) => {
  assertAjv(validateFreshnessSchema(value), validateFreshnessSchema.errors, 'freshness');
  const freshness = value as ComparisonFreshnessV2;
  if (freshness.status === 'FRESH' && freshness.reasons.length > 0) {
    fail('FRESH freshness cannot contain stale reasons', 'freshness.reasons');
  }
  if (freshness.status === 'STALE' && freshness.reasons.length === 0) {
    fail('STALE freshness requires a typed reason', 'freshness.reasons');
  }
};

export const validateComparisonFreshnessOutputV2: (
  value: unknown,
) => asserts value is CheckComparisonFreshnessOutputV2 = (value) => {
  assertAjv(
    validateFreshnessOutputSchema(value),
    validateFreshnessOutputSchema.errors,
    'freshnessOutput',
  );
  validateComparisonFreshnessV2(value);
};

export const assertComparisonFreshForReviewV2 = (
  freshness: ComparisonFreshnessV2,
  comparison: Pick<ComparisonResultV2, 'disposition' | 'shortlist' | 'reviewRecommendation'>,
): void => {
  if (
    freshness.status !== 'FRESH' ||
    !['REVIEW_REQUIRED', 'NEW'].includes(comparison.disposition) ||
    (comparison.disposition === 'NEW' && comparison.reviewRecommendation !== 'ADD_CLAIM') ||
    comparison.shortlist === undefined ||
    comparison.shortlist.coverageStatus !== 'COMPLETE' ||
    comparison.shortlist.querySemanticReadiness !== 'READY' ||
    comparison.shortlist.truncated ||
    Object.values(comparison.shortlist.exclusionCounts).some((count) => count > 0)
  ) {
    throw new ComparisonContractErrorV2(
      'FRESHNESS_FAILURE',
      'Comparison is not eligible for Review approval',
    );
  }
};

export const assertReviewAuthorityInvariantV2 = (selection: ReviewAuthoritySelectionV2): void => {
  const { rollout, candidates } = selection;
  if (selection.candidateRevision < 1) {
    fail('candidateRevision must be positive', 'rollout.candidateRevision');
  }
  for (const [index, candidate] of candidates.entries()) {
    if (
      candidate.projectId !== selection.projectId ||
      candidate.candidateId !== selection.candidateId ||
      candidate.candidateRevision !== selection.candidateRevision
    ) {
      throw new ComparisonContractErrorV2(
        'REVIEW_AUTHORITY_FAILURE',
        'Rollout authority candidates must share one project and Candidate revision',
        `rollout.candidates[${index}]`,
      );
    }
  }
  const authoritative = candidates.filter((candidate) => candidate.reviewAuthoritative);
  const expected: ReviewContractVersionV2 = rollout === 'V2_ACTIVE' ? '2.0' : '1.0';
  if (authoritative.length !== 1 || authoritative[0]!.contractVersion !== expected) {
    throw new ComparisonContractErrorV2(
      'REVIEW_AUTHORITY_FAILURE',
      `Rollout ${rollout} requires exactly one ${expected} Review-authoritative contract`,
    );
  }
  if (
    rollout === 'V2_SHADOW' &&
    candidates.some(
      (candidate) => candidate.contractVersion === '2.0' && candidate.reviewAuthoritative,
    )
  ) {
    throw new ComparisonContractErrorV2(
      'REVIEW_AUTHORITY_FAILURE',
      'V2_SHADOW cannot be Review-authoritative',
    );
  }
};

export const createExactDuplicateComparisonResultV2 = (input: {
  readonly comparisonId: string;
  readonly projectId: string;
  readonly candidate: ComparisonCandidateV2;
  readonly canonicalSnapshot: CanonicalSnapshotIdentityV2;
  readonly exactDuplicateTarget: ExactDuplicateTargetV2;
  readonly accessScope: readonly string[];
  readonly sensitivity: SecuritySensitivity;
  readonly createdAt: string;
}): ComparisonResultV2 => {
  const result: ComparisonResultV2 = {
    comparisonId: input.comparisonId,
    contractVersion: COMPARISON_V2_CONTRACT_VERSION,
    projectId: input.projectId,
    candidate: input.candidate,
    canonicalSnapshot: input.canonicalSnapshot,
    disposition: 'EXACT_DUPLICATE',
    reviewRecommendation: 'NO_OP',
    exactDuplicateTarget: input.exactDuplicateTarget,
    analysisRevisionIds: [],
    relationshipIds: [],
    accessScope: input.accessScope,
    sensitivity: input.sensitivity,
    createdAt: input.createdAt,
  };
  validateComparisonResultV2(result);
  return result;
};

export const validateComparisonChildrenV2 = (
  comparison: ComparisonResultV2,
  relationships: readonly SemanticRelationshipV2[],
  analyses: readonly AnalysisRevisionV2[],
): void => {
  validateComparisonResultV2(comparison);
  if (
    new Set(relationships.map((relationship) => relationship.relationshipId)).size !==
    relationships.length
  ) {
    fail('Relationship identities must be unique', 'relationships');
  }
  if (new Set(analyses.map((analysis) => analysis.analysisRevisionId)).size !== analyses.length) {
    fail('Analysis revision identities must be unique', 'analyses');
  }
  const relationshipIds = relationships.map((relationship) => relationship.relationshipId).sort();
  const analysisIds = analyses.map((analysis) => analysis.analysisRevisionId).sort();
  if (stableJson(relationshipIds) !== stableJson([...comparison.relationshipIds].sort())) {
    fail('Relationship children do not match ComparisonResult relationshipIds', 'relationships');
  }
  if (stableJson(analysisIds) !== stableJson([...comparison.analysisRevisionIds].sort())) {
    fail('Analysis children do not match ComparisonResult analysisRevisionIds', 'analyses');
  }
  for (const relationship of relationships) {
    validateSemanticRelationshipV2(relationship);
    if (
      relationship.comparisonId !== comparison.comparisonId ||
      relationship.candidateId !== comparison.candidate.id ||
      relationship.candidateRevision !== comparison.candidate.revision ||
      relationship.candidateDigest !== comparison.candidate.digest ||
      stableJson([...relationship.candidateEvidenceIds].sort()) !==
        stableJson([...comparison.candidate.evidenceIds].sort()) ||
      relationship.canonicalSnapshot.snapshotId !== comparison.canonicalSnapshot.id ||
      relationship.canonicalSnapshot.version !== comparison.canonicalSnapshot.version ||
      relationship.canonicalSnapshot.digest !== comparison.canonicalSnapshot.digest
    ) {
      fail(
        'Relationship parent identity does not match ComparisonResult',
        relationship.relationshipId,
      );
    }
  }
  for (const analysis of analyses) {
    validateAnalysisRevisionV2(analysis);
    if (
      analysis.comparisonId !== comparison.comparisonId ||
      analysis.candidate.id !== comparison.candidate.id ||
      analysis.candidate.revision !== comparison.candidate.revision ||
      analysis.candidate.digest !== comparison.candidate.digest ||
      analysis.canonicalSnapshot.id !== comparison.canonicalSnapshot.id ||
      analysis.canonicalSnapshot.version !== comparison.canonicalSnapshot.version ||
      analysis.canonicalSnapshot.digest !== comparison.canonicalSnapshot.digest
    ) {
      fail('Analysis parent identity does not match ComparisonResult', analysis.analysisRevisionId);
    }
  }
};

export const assertComparisonEventV2 = (
  event: ComparisonCompletedV2 | ComparisonIncompleteV2 | ComparisonFailedV2,
): void => {
  ensureVersion(event.contractVersion, 'event.contractVersion');
  if (event.eventType === 'ComparisonCompletedV2') {
    validateComparisonResultV2(event.comparison);
    if (
      ['ANALYSIS_PENDING', 'SEMANTIC_UNAVAILABLE', 'POLICY_BLOCKED', 'STALE'].includes(
        event.comparison.disposition,
      )
    ) {
      fail(
        'incomplete dispositions cannot emit ComparisonCompletedV2',
        'event.comparison.disposition',
      );
    }
    if (
      event.analysisRevisionIds.some((id) => !event.comparison.analysisRevisionIds.includes(id))
    ) {
      fail(
        'completed event analysisRevisionIds must be present on the comparison',
        'event.analysisRevisionIds',
      );
    }
    return;
  }
  nonEmpty(event.comparisonId, 'event.comparisonId');
  nonEmpty(event.analysisRevisionId, 'event.analysisRevisionId');
  nonEmpty(event.safeFailureCode, 'event.safeFailureCode');
};
