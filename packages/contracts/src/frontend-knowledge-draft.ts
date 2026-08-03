import type { ErrorCode } from './errors.js';
import { FrontendContractError } from './frontend-foundation.js';

export type DraftArtifactStatusV1 = 'COMPLETE' | 'PARTIAL' | 'FAILED' | 'UNAVAILABLE';

export type FrontendKnowledgeDraftLifecycleV1 =
  | 'DRAFT'
  | 'VALIDATING'
  | 'VALID'
  | 'INVALID'
  | 'STALE'
  | 'CONFLICT'
  | 'READY_FOR_REVIEW'
  | 'SUBMITTING'
  | 'SUBMITTED'
  | 'ABANDONED';

export type FrontendKnowledgeDraftCommandOutcomeV1 =
  'ACCEPTED' | 'COMPLETED' | 'REJECTED' | 'OUTCOME_UNKNOWN';

export const FRONTEND_KNOWLEDGE_DRAFT_COMMAND_TYPES = {
  materialize: 'knowledge.draft.materialize.v1',
  startSeedless: 'knowledge.draft.start-seedless.v1',
  save: 'knowledge.draft.save.v1',
  abandon: 'knowledge.draft.abandon.v1',
  resolveOutcome: 'knowledge.draft.resolve-outcome.v1',
} as const;

export type FrontendKnowledgeDraftCommandType =
  (typeof FRONTEND_KNOWLEDGE_DRAFT_COMMAND_TYPES)[keyof typeof FRONTEND_KNOWLEDGE_DRAFT_COMMAND_TYPES];

export type FrontendKnowledgeProjectPolicyContextV1 = {
  readonly activeProjectId: string;
  readonly resourceProjectId: string;
  readonly draftProjectId: string;
  readonly effectiveProjectId: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
};

export type FrontendKnowledgeEvidenceLineageV1 = {
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly evidenceSpanId: string;
};

export type DraftValidationArtifactRefV1 = {
  readonly artifactId: string;
  readonly artifactRevision: number;
  readonly digest: string;
  readonly status: DraftArtifactStatusV1;
  readonly projectPolicyContext: FrontendKnowledgeProjectPolicyContextV1;
};

export type DraftImpactArtifactRefV1 = DraftValidationArtifactRefV1;

export type ReviewResourceRefV1 = {
  readonly reviewResourceId: string;
  readonly draftId: string;
  readonly draftRevision: number;
  readonly resourceProjectId: string;
  readonly draftProjectId: string;
  readonly effectiveProjectId: string;
  readonly policyContextRevision: string;
  readonly digest: string;
};

export type ReviewSubmissionRefV1 = {
  readonly reviewSubmissionId: string;
  readonly draftId: string;
  readonly draftRevision: number;
  readonly operationDigest: string;
  readonly contentDigest: string;
  readonly validationArtifact: DraftValidationArtifactRefV1;
  readonly impactArtifact: DraftImpactArtifactRefV1;
  readonly evidenceLineage: readonly FrontendKnowledgeEvidenceLineageV1[];
  readonly projectPolicyContext: FrontendKnowledgeProjectPolicyContextV1;
  readonly reviewResource: ReviewResourceRefV1;
};

export type FrontendKnowledgeProjectionRefV1 = {
  readonly projectionKind: 'CANONICAL_SEARCH' | 'COMPILED_TRUTH';
  readonly projectionId: string;
  readonly projectionIdentity:
    | { readonly kind: 'REVISION'; readonly revision: string }
    | { readonly kind: 'VERSION'; readonly version: number };
  readonly projectionDigest: string;
  readonly readiness: 'READY' | 'STALE' | 'DEGRADED' | 'NOT_BUILT';
  readonly projectedCanonicalVersion: number;
  readonly sourceSnapshotDigest: string;
};

export type FrontendKnowledgeDraftSourceLineageV1 = {
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly evidenceSpanIds: readonly string[];
};

export type FrontendKnowledgeDraftBaseCommonV1 = {
  readonly resourceProjectId: string;
  readonly canonicalSnapshotId: string;
  readonly canonicalVersion: number;
  readonly canonicalSnapshotDigest: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly sourceLineage: readonly FrontendKnowledgeDraftSourceLineageV1[];
  readonly projection?: FrontendKnowledgeProjectionRefV1;
};

export type FrontendKnowledgeDraftBaseV1 = FrontendKnowledgeDraftBaseCommonV1 &
  (
    | {
        readonly revisionIdentityKind: 'RESOURCE_REVISION';
        readonly canonicalResourceId: string;
        readonly canonicalRevisionId: string;
      }
    | {
        readonly revisionIdentityKind: 'NEW_RESOURCE_SNAPSHOT';
        readonly canonicalResourceId?: never;
        readonly canonicalRevisionId?: never;
      }
  );

export type FactValueV1 = {
  readonly schemaVersion: 'fact.v1';
  readonly subjectRef: string;
  readonly predicate: string;
  readonly value: string | number | boolean;
  readonly unit?: string;
};

export type ClaimValueV1 = {
  readonly schemaVersion: 'claim.v1';
  readonly statement: string;
  readonly subjectRef?: string;
  readonly confidence?: number;
};

export type EntityValueV1 = {
  readonly schemaVersion: 'entity.v1';
  readonly entityType: string;
  readonly displayName: string;
  readonly aliases?: readonly string[];
};

export type RelationValueV1 = {
  readonly schemaVersion: 'relation.v1';
  readonly relationType: string;
  readonly fromEntityRef: string;
  readonly toEntityRef: string;
};

export type EventValueV1 = {
  readonly schemaVersion: 'event.v1';
  readonly eventType: string;
  readonly subjectRef: string;
  readonly occurredAt?: string;
};

export type DecisionValueV1 = {
  readonly schemaVersion: 'decision.v1';
  readonly decisionType: string;
  readonly decision: string;
};

export type EvidenceLinkValueV1 = {
  readonly schemaVersion: 'evidence-link.v1';
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly evidenceSpanId: string;
};

export type TemporalValidityValueV1 = {
  readonly schemaVersion: 'temporal-validity.v1';
  readonly validFrom?: string;
  readonly validTo?: string;
  readonly status: 'KNOWN' | 'OPEN' | 'UNKNOWN';
};

export type ConflictProposalValueV1 = {
  readonly schemaVersion: 'conflict-proposal.v1';
  readonly conflictType: string;
  readonly competingTargetIds: readonly string[];
  readonly summary: string;
};

export type KnowledgeGapProposalValueV1 = {
  readonly schemaVersion: 'knowledge-gap-proposal.v1';
  readonly gapType: string;
  readonly description: string;
  readonly requestedEvidence?: string;
};

export type NoOpReviewResultV1 = {
  readonly schemaVersion: 'no-op-review-result.v1';
  readonly result: 'REVIEWED' | 'NO_CHANGE_REQUIRED' | 'REJECTED_BY_AUTHOR';
  readonly reason: string;
};

export type KnowledgeOperationTargetV1<TTargetType extends string> = {
  readonly targetType: TTargetType;
  readonly targetId?: string;
  readonly resourceId: string;
};

export type KnowledgeOperationCommonV1 = {
  readonly operationId: string;
  readonly baseRevision: number;
  readonly rationale: string;
  readonly evidenceReferences: readonly FrontendKnowledgeEvidenceLineageV1[];
  readonly expectedImpact: {
    readonly summary: string;
    readonly targetIds?: readonly string[];
  };
  readonly operationRevision: number;
  readonly contentDigest: string;
};

export type KnowledgeAddOperationV1<
  TKind extends string,
  TTargetType extends string,
  TValue,
> = KnowledgeOperationCommonV1 & {
  readonly kind: TKind;
  readonly target: KnowledgeOperationTargetV1<TTargetType>;
  readonly before?: never;
  readonly after: TValue;
};

export type KnowledgeUpdateOperationV1<
  TKind extends string,
  TTargetType extends string,
  TValue,
> = KnowledgeOperationCommonV1 & {
  readonly kind: TKind;
  readonly target: KnowledgeOperationTargetV1<TTargetType>;
  readonly before: TValue;
  readonly after: TValue;
};

export type KnowledgeRemoveOperationV1<
  TKind extends string,
  TTargetType extends string,
  TValue,
> = KnowledgeOperationCommonV1 & {
  readonly kind: TKind;
  readonly target: KnowledgeOperationTargetV1<TTargetType>;
  readonly before: TValue;
  readonly after?: never;
};

export type FrontendKnowledgeOperationV1 =
  | KnowledgeAddOperationV1<'FACT_ADD', 'FACT', FactValueV1>
  | KnowledgeUpdateOperationV1<'FACT_UPDATE', 'FACT', FactValueV1>
  | KnowledgeRemoveOperationV1<'FACT_REMOVE', 'FACT', FactValueV1>
  | KnowledgeAddOperationV1<'CLAIM_ADD', 'CLAIM', ClaimValueV1>
  | KnowledgeUpdateOperationV1<'CLAIM_UPDATE', 'CLAIM', ClaimValueV1>
  | KnowledgeRemoveOperationV1<'CLAIM_REMOVE', 'CLAIM', ClaimValueV1>
  | KnowledgeAddOperationV1<'ENTITY_ADD', 'ENTITY', EntityValueV1>
  | KnowledgeUpdateOperationV1<'ENTITY_UPDATE', 'ENTITY', EntityValueV1>
  | KnowledgeAddOperationV1<'ENTITY_REFERENCE', 'ENTITY', EntityValueV1>
  | KnowledgeAddOperationV1<'RELATION_ADD', 'RELATION', RelationValueV1>
  | KnowledgeUpdateOperationV1<'RELATION_UPDATE', 'RELATION', RelationValueV1>
  | KnowledgeRemoveOperationV1<'RELATION_REMOVE', 'RELATION', RelationValueV1>
  | KnowledgeAddOperationV1<'EVENT_ADD', 'EVENT', EventValueV1>
  | KnowledgeUpdateOperationV1<'EVENT_UPDATE', 'EVENT', EventValueV1>
  | KnowledgeRemoveOperationV1<'EVENT_REMOVE', 'EVENT', EventValueV1>
  | KnowledgeAddOperationV1<'DECISION_ADD', 'DECISION', DecisionValueV1>
  | KnowledgeUpdateOperationV1<'DECISION_UPDATE', 'DECISION', DecisionValueV1>
  | KnowledgeRemoveOperationV1<'DECISION_REMOVE', 'DECISION', DecisionValueV1>
  | KnowledgeAddOperationV1<'EVIDENCE_ATTACH', 'EVIDENCE', EvidenceLinkValueV1>
  | KnowledgeRemoveOperationV1<'EVIDENCE_DETACH', 'EVIDENCE', EvidenceLinkValueV1>
  | KnowledgeUpdateOperationV1<'TEMPORAL_VALIDITY_CHANGE', 'TEMPORAL', TemporalValidityValueV1>
  | KnowledgeAddOperationV1<'CONFLICT_PROPOSAL_ADD', 'CONFLICT', ConflictProposalValueV1>
  | KnowledgeUpdateOperationV1<'CONFLICT_PROPOSAL_UPDATE', 'CONFLICT', ConflictProposalValueV1>
  | KnowledgeAddOperationV1<
      'KNOWLEDGE_GAP_PROPOSAL_ADD',
      'KNOWLEDGE_GAP',
      KnowledgeGapProposalValueV1
    >
  | KnowledgeUpdateOperationV1<
      'KNOWLEDGE_GAP_PROPOSAL_UPDATE',
      'KNOWLEDGE_GAP',
      KnowledgeGapProposalValueV1
    >
  | KnowledgeAddOperationV1<'NO_OP', 'REVIEW_RESULT', NoOpReviewResultV1>;

export type FrontendKnowledgeDraftChangeSetV1 = {
  readonly schemaVersion: '1.0.0';
  readonly draftId: string;
  readonly seedId?: string;
  readonly answerRunId?: string;
  readonly startMode: 'SEED_MATERIALIZATION' | 'KNOWLEDGE_PAGE';
  readonly status: FrontendKnowledgeDraftLifecycleV1;
  readonly revision: number;
  readonly activeProjectId: string;
  readonly resourceProjectId: string;
  readonly draftProjectId: string;
  readonly effectiveProjectId: string;
  readonly resourceId: string;
  readonly base: FrontendKnowledgeDraftBaseV1;
  readonly operations: readonly FrontendKnowledgeOperationV1[];
  readonly validation?: DraftValidationArtifactRefV1;
  readonly impactPreview?: DraftImpactArtifactRefV1;
  readonly reviewResource?: ReviewResourceRefV1;
  readonly reviewSubmission?: ReviewSubmissionRefV1;
  readonly contentDigest: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type DraftCommandEnvelopeV1 = {
  readonly schemaVersion: '1.0.0';
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly expectedDraftRevision?: number;
  readonly expectedCanonicalVersion?: number;
  readonly semanticDigest?: string;
};

export type RequiredDraftRevisionEnvelopeV1 = Omit<
  DraftCommandEnvelopeV1,
  'expectedDraftRevision'
> & {
  readonly expectedDraftRevision: number;
};

export type MaterializeDraftRequestV1 = DraftCommandEnvelopeV1 & {
  readonly seedId: string;
};

export type StartSeedlessDraftRequestV1 = DraftCommandEnvelopeV1 &
  (
    | { readonly resourceId: string; readonly pageId?: never }
    | { readonly pageId: string; readonly resourceId?: never }
  );

export type SaveKnowledgeDraftRequestV1 = RequiredDraftRevisionEnvelopeV1 & {
  readonly draftId: string;
  readonly operations: readonly FrontendKnowledgeOperationV1[];
  readonly expectedBaseRevision: number;
  readonly operationRevision: number;
  readonly contentDigest: string;
};

export type ValidateKnowledgeDraftRequestV1 = RequiredDraftRevisionEnvelopeV1 & {
  readonly draftId: string;
  readonly expectedBaseRevision: number;
};

export type GenerateKnowledgeDraftImpactRequestV1 = RequiredDraftRevisionEnvelopeV1 & {
  readonly draftId: string;
  readonly expectedBaseRevision: number;
  readonly options?: {
    readonly maxDepth?: number;
    readonly maxNodes?: number;
  };
};

export type SubmitKnowledgeDraftForReviewRequestV1 = RequiredDraftRevisionEnvelopeV1 & {
  readonly draftId: string;
  readonly expectedBaseRevision: number;
  readonly validationArtifact: DraftValidationArtifactRefV1;
  readonly impactArtifact: DraftImpactArtifactRefV1;
};

export type AbandonKnowledgeDraftRequestV1 = RequiredDraftRevisionEnvelopeV1 & {
  readonly draftId: string;
  readonly expectedBaseRevision: number;
};

export type ResolveKnowledgeDraftCommandOutcomeRequestV1 = {
  readonly schemaVersion: '1.0.0';
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly semanticDigest: string;
};

export type FrontendKnowledgeDraftCommandResultBaseV1 = {
  readonly schemaVersion: '1.0.0';
  readonly outcome: FrontendKnowledgeDraftCommandOutcomeV1;
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
};

export type MaterializeDraftResultV1 = FrontendKnowledgeDraftCommandResultBaseV1 & {
  readonly draft: FrontendKnowledgeDraftChangeSetV1;
};

export type StartSeedlessDraftResultV1 = MaterializeDraftResultV1;

export type SaveKnowledgeDraftResultV1 = MaterializeDraftResultV1;

export type ValidateKnowledgeDraftResultV1 = FrontendKnowledgeDraftCommandResultBaseV1 & {
  readonly draftStatus: FrontendKnowledgeDraftLifecycleV1;
  readonly validation: DraftValidationArtifactRefV1;
};

export type GenerateKnowledgeDraftImpactResultV1 = FrontendKnowledgeDraftCommandResultBaseV1 & {
  readonly draftStatus: FrontendKnowledgeDraftLifecycleV1;
  readonly impactPreview: DraftImpactArtifactRefV1;
};

export type SubmitKnowledgeDraftForReviewResultV1 = FrontendKnowledgeDraftCommandResultBaseV1 & {
  readonly reviewSubmission: ReviewSubmissionRefV1;
};

export type ResolveKnowledgeDraftCommandOutcomeResultV1 = {
  readonly schemaVersion: '1.0.0';
  readonly outcome: FrontendKnowledgeDraftCommandOutcomeV1;
  readonly originalClientRequestId: string;
  readonly originalIdempotencyKey: string;
  readonly draft?: FrontendKnowledgeDraftChangeSetV1;
  readonly reviewResource?: ReviewResourceRefV1;
  readonly reviewSubmission?: ReviewSubmissionRefV1;
};

export type FrontendKnowledgeDraftFailureCode =
  | 'INVALID_REQUEST'
  | 'PROJECT_BINDING_FAILURE'
  | 'ACCESS_DENIED'
  | 'SEED_NOT_FOUND'
  | 'DRAFT_NOT_FOUND'
  | 'SEED_ALREADY_MATERIALIZED'
  | 'CANONICAL_SNAPSHOT_MISMATCH'
  | 'RESOURCE_REVISION_MISSING'
  | 'STALE_BASE'
  | 'CONFLICT'
  | 'UNSUPPORTED_OPERATION'
  | 'ARTIFACT_INCOMPLETE'
  | 'OUTCOME_UNKNOWN';

export const FRONTEND_KNOWLEDGE_DRAFT_API_FAILURE_CODES = [
  'NOT_FOUND',
  'FORBIDDEN',
  'PROJECT_BINDING_CONFLICT',
  'ACCESS_REVOKED',
  'BASE_UNAVAILABLE',
  'DRAFT_NOT_FOUND',
  'DRAFT_REVISION_CONFLICT',
  'VALIDATION_FAILED',
  'STALE',
  'IMPACT_PARTIAL',
  'ANALYZER_UNAVAILABLE',
  'NOT_READY_FOR_REVIEW',
  'OUTCOME_NOT_FOUND',
  'DIGEST_MISMATCH',
  'COMMAND_SCOPE_MISMATCH',
  'OUTCOME_INDETERMINATE',
] as const;

export type FrontendKnowledgeDraftApiFailureCode =
  (typeof FRONTEND_KNOWLEDGE_DRAFT_API_FAILURE_CODES)[number];

export type FrontendKnowledgeDraftFailureMapping = {
  readonly category:
    'VALIDATION' | 'AUTHORIZATION' | 'NOT_FOUND' | 'CONFLICT' | 'DEPENDENCY' | 'OUTCOME_UNKNOWN';
  readonly httpStatus: number;
  readonly retryable: boolean;
};

export type FrontendKnowledgeDraftApiFailureMapping = FrontendKnowledgeDraftFailureMapping & {
  readonly normalizedCode: FrontendKnowledgeDraftFailureCode;
};

export const FRONTEND_KNOWLEDGE_DRAFT_FAILURES: Readonly<
  Record<FrontendKnowledgeDraftFailureCode, FrontendKnowledgeDraftFailureMapping>
> = {
  INVALID_REQUEST: { category: 'VALIDATION', httpStatus: 400, retryable: false },
  PROJECT_BINDING_FAILURE: { category: 'VALIDATION', httpStatus: 400, retryable: false },
  ACCESS_DENIED: { category: 'AUTHORIZATION', httpStatus: 403, retryable: false },
  SEED_NOT_FOUND: { category: 'NOT_FOUND', httpStatus: 404, retryable: false },
  DRAFT_NOT_FOUND: { category: 'NOT_FOUND', httpStatus: 404, retryable: false },
  SEED_ALREADY_MATERIALIZED: { category: 'CONFLICT', httpStatus: 409, retryable: false },
  CANONICAL_SNAPSHOT_MISMATCH: { category: 'CONFLICT', httpStatus: 409, retryable: false },
  RESOURCE_REVISION_MISSING: { category: 'VALIDATION', httpStatus: 400, retryable: false },
  STALE_BASE: { category: 'CONFLICT', httpStatus: 409, retryable: false },
  CONFLICT: { category: 'CONFLICT', httpStatus: 409, retryable: false },
  UNSUPPORTED_OPERATION: { category: 'VALIDATION', httpStatus: 422, retryable: false },
  ARTIFACT_INCOMPLETE: { category: 'DEPENDENCY', httpStatus: 409, retryable: false },
  OUTCOME_UNKNOWN: { category: 'OUTCOME_UNKNOWN', httpStatus: 503, retryable: false },
};

export const FRONTEND_KNOWLEDGE_DRAFT_API_FAILURES: Readonly<
  Record<FrontendKnowledgeDraftApiFailureCode, FrontendKnowledgeDraftApiFailureMapping>
> = {
  NOT_FOUND: {
    normalizedCode: 'SEED_NOT_FOUND',
    category: 'NOT_FOUND',
    httpStatus: 404,
    retryable: false,
  },
  FORBIDDEN: {
    normalizedCode: 'ACCESS_DENIED',
    category: 'AUTHORIZATION',
    httpStatus: 403,
    retryable: false,
  },
  PROJECT_BINDING_CONFLICT: {
    normalizedCode: 'PROJECT_BINDING_FAILURE',
    category: 'CONFLICT',
    httpStatus: 409,
    retryable: false,
  },
  ACCESS_REVOKED: {
    normalizedCode: 'ACCESS_DENIED',
    category: 'AUTHORIZATION',
    httpStatus: 403,
    retryable: false,
  },
  BASE_UNAVAILABLE: {
    normalizedCode: 'CANONICAL_SNAPSHOT_MISMATCH',
    category: 'DEPENDENCY',
    httpStatus: 503,
    retryable: false,
  },
  DRAFT_NOT_FOUND: {
    normalizedCode: 'DRAFT_NOT_FOUND',
    category: 'NOT_FOUND',
    httpStatus: 404,
    retryable: false,
  },
  DRAFT_REVISION_CONFLICT: {
    normalizedCode: 'CONFLICT',
    category: 'CONFLICT',
    httpStatus: 409,
    retryable: false,
  },
  VALIDATION_FAILED: {
    normalizedCode: 'INVALID_REQUEST',
    category: 'VALIDATION',
    httpStatus: 422,
    retryable: false,
  },
  STALE: {
    normalizedCode: 'STALE_BASE',
    category: 'CONFLICT',
    httpStatus: 409,
    retryable: false,
  },
  IMPACT_PARTIAL: {
    normalizedCode: 'ARTIFACT_INCOMPLETE',
    category: 'DEPENDENCY',
    httpStatus: 409,
    retryable: false,
  },
  ANALYZER_UNAVAILABLE: {
    normalizedCode: 'ARTIFACT_INCOMPLETE',
    category: 'DEPENDENCY',
    httpStatus: 503,
    retryable: false,
  },
  NOT_READY_FOR_REVIEW: {
    normalizedCode: 'ARTIFACT_INCOMPLETE',
    category: 'DEPENDENCY',
    httpStatus: 409,
    retryable: false,
  },
  OUTCOME_NOT_FOUND: {
    normalizedCode: 'OUTCOME_UNKNOWN',
    category: 'NOT_FOUND',
    httpStatus: 404,
    retryable: false,
  },
  DIGEST_MISMATCH: {
    normalizedCode: 'CONFLICT',
    category: 'CONFLICT',
    httpStatus: 409,
    retryable: false,
  },
  COMMAND_SCOPE_MISMATCH: {
    normalizedCode: 'PROJECT_BINDING_FAILURE',
    category: 'AUTHORIZATION',
    httpStatus: 403,
    retryable: false,
  },
  OUTCOME_INDETERMINATE: {
    normalizedCode: 'OUTCOME_UNKNOWN',
    category: 'OUTCOME_UNKNOWN',
    httpStatus: 503,
    retryable: false,
  },
};

const FAILURE_ALIASES: Readonly<Record<string, FrontendKnowledgeDraftFailureCode>> = {
  INVALID_REQUEST: 'INVALID_REQUEST',
  VALIDATION_ERROR: 'INVALID_REQUEST',
  UNSUPPORTED_SCHEMA: 'INVALID_REQUEST',
  NOT_FOUND: 'SEED_NOT_FOUND',
  FORBIDDEN: 'ACCESS_DENIED',
  PROJECT_BINDING_CONFLICT: 'PROJECT_BINDING_FAILURE',
  PROJECT_CONTEXT_REQUIRED: 'PROJECT_BINDING_FAILURE',
  RESOURCE_PROJECT_MISMATCH: 'PROJECT_BINDING_FAILURE',
  PROJECT_ACCESS_REVISION_CONFLICT: 'PROJECT_BINDING_FAILURE',
  POLICY_CONTEXT_CHANGED: 'PROJECT_BINDING_FAILURE',
  ACCESS_DENIED: 'ACCESS_DENIED',
  AUTHORIZATION_DENIED: 'ACCESS_DENIED',
  PROJECT_ACCESS_DENIED: 'ACCESS_DENIED',
  PRECONDITION_ACCESS_DENIED: 'ACCESS_DENIED',
  CAPABILITY_DENIED: 'ACCESS_DENIED',
  RESOURCE_ACCESS_REVOKED: 'ACCESS_DENIED',
  ACCESS_REVOKED: 'ACCESS_DENIED',
  SEED_NOT_FOUND: 'SEED_NOT_FOUND',
  DRAFT_NOT_FOUND: 'DRAFT_NOT_FOUND',
  SEED_ALREADY_MATERIALIZED: 'SEED_ALREADY_MATERIALIZED',
  CANONICAL_SNAPSHOT_MISMATCH: 'CANONICAL_SNAPSHOT_MISMATCH',
  BASE_UNAVAILABLE: 'CANONICAL_SNAPSHOT_MISMATCH',
  RESOURCE_REVISION_MISSING: 'RESOURCE_REVISION_MISSING',
  STALE_BASE: 'STALE_BASE',
  BASE_REVISION_STALE: 'STALE_BASE',
  STALE_VERSION: 'STALE_BASE',
  STALE_ACTION_SNAPSHOT: 'STALE_BASE',
  STALE: 'STALE_BASE',
  CONFLICT: 'CONFLICT',
  REVISION_CONFLICT: 'CONFLICT',
  DRAFT_REVISION_CONFLICT: 'CONFLICT',
  DIGEST_MISMATCH: 'CONFLICT',
  UNSUPPORTED_OPERATION: 'UNSUPPORTED_OPERATION',
  VALIDATION_FAILED: 'INVALID_REQUEST',
  ARTIFACT_INCOMPLETE: 'ARTIFACT_INCOMPLETE',
  IMPACT_PARTIAL: 'ARTIFACT_INCOMPLETE',
  ANALYZER_UNAVAILABLE: 'ARTIFACT_INCOMPLETE',
  NOT_READY_FOR_REVIEW: 'ARTIFACT_INCOMPLETE',
  OUTCOME_UNKNOWN: 'OUTCOME_UNKNOWN',
  OUTCOME_INDETERMINATE: 'OUTCOME_UNKNOWN',
  OUTCOME_NOT_FOUND: 'OUTCOME_UNKNOWN',
  COMMAND_SCOPE_MISMATCH: 'PROJECT_BINDING_FAILURE',
};

export const mapFrontendKnowledgeDraftFailure = (
  code: ErrorCode | string,
): FrontendKnowledgeDraftFailureCode | undefined => FAILURE_ALIASES[code];

export type FrontendKnowledgeDraftNormalizedFailure = {
  readonly apiCode: FrontendKnowledgeDraftApiFailureCode;
  readonly normalizedCode: FrontendKnowledgeDraftFailureCode;
  readonly mapping: FrontendKnowledgeDraftApiFailureMapping;
};

export type FrontendKnowledgeDraftFailureV1 = {
  readonly schemaVersion: '1.0.0';
  readonly code: FrontendKnowledgeDraftApiFailureCode;
  readonly normalizedCode: FrontendKnowledgeDraftFailureCode;
  readonly category: FrontendKnowledgeDraftFailureMapping['category'];
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly message: string;
};

export const normalizeFrontendKnowledgeDraftFailure = (
  code: ErrorCode | string,
): FrontendKnowledgeDraftNormalizedFailure | undefined => {
  if (
    !FRONTEND_KNOWLEDGE_DRAFT_API_FAILURE_CODES.includes(
      code as FrontendKnowledgeDraftApiFailureCode,
    )
  ) {
    return undefined;
  }
  const normalizedCode = mapFrontendKnowledgeDraftFailure(code);
  if (normalizedCode === undefined) return undefined;
  const mapping =
    FRONTEND_KNOWLEDGE_DRAFT_API_FAILURES[code as FrontendKnowledgeDraftApiFailureCode];
  return {
    apiCode: code as FrontendKnowledgeDraftApiFailureCode,
    normalizedCode,
    mapping,
  };
};

export class FrontendKnowledgeDraftCommandError extends Error {
  readonly apiCode: FrontendKnowledgeDraftApiFailureCode;
  readonly normalizedCode: FrontendKnowledgeDraftFailureCode;
  readonly mapping: FrontendKnowledgeDraftApiFailureMapping;

  constructor(apiCode: FrontendKnowledgeDraftApiFailureCode, message: string) {
    super(message);
    this.name = 'FrontendKnowledgeDraftCommandError';
    const normalized = normalizeFrontendKnowledgeDraftFailure(apiCode);
    if (normalized === undefined) {
      throw new Error(`No Frontend Knowledge Draft failure mapping for ${apiCode}`);
    }
    this.apiCode = apiCode;
    this.normalizedCode = normalized.normalizedCode;
    this.mapping = normalized.mapping;
  }
}

type ObjectValue = Record<string, unknown>;

const fail = (path: string, message: string, code: ErrorCode = 'INVALID_REQUEST'): never => {
  throw new FrontendContractError(code, `${path}: ${message}`);
};

const failWithApiCode = (
  path: string,
  message: string,
  code: FrontendKnowledgeDraftApiFailureCode,
): never => {
  throw new FrontendKnowledgeDraftCommandError(code, `${path}: ${message}`);
};

const asObject = (value: unknown, path: string): ObjectValue => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(path, 'must be a non-null object');
  }
  return value as ObjectValue;
};

const strictObject = (
  value: unknown,
  allowedKeys: readonly string[],
  path: string,
): ObjectValue => {
  const object = asObject(value, path);
  const unexpected = Object.keys(object).filter((key) => !allowedKeys.includes(key));
  if (unexpected.length > 0) {
    const authorityFields = unexpected.filter((key) =>
      [
        'principalId',
        'sessionId',
        'accessScope',
        'capability',
        'capabilities',
        'policyContext',
        'commandId',
        'effectiveProjectId',
        'activeProjectId',
        'resourceProjectId',
        'draftProjectId',
        'accessRevision',
        'policyContextRevision',
        'canonicalSnapshotId',
        'canonicalVersion',
        'canonicalResourceId',
        'canonicalRevisionId',
      ].includes(key),
    );
    return fail(
      path,
      `contains unsupported fields: ${unexpected.join(', ')}`,
      authorityFields.length > 0 ? 'PRECONDITION_ACCESS_DENIED' : 'INVALID_REQUEST',
    );
  }
  return object;
};

const required = (object: ObjectValue, key: string, path: string): unknown => {
  if (!(key in object) || object[key] === undefined) return fail(`${path}.${key}`, 'is required');
  return object[key];
};

const text = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return fail(path, 'must be a non-empty string');
  }
  return value;
};

const integer = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return fail(path, 'must be a non-negative safe integer');
  }
  return value;
};

const finiteNumber = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fail(path, 'must be finite');
  return value;
};

const booleanValue = (value: unknown, path: string): boolean => {
  if (typeof value !== 'boolean') return fail(path, 'must be a boolean');
  return value;
};

const enumValue = <T extends string>(value: unknown, values: readonly T[], path: string): T => {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    return fail(path, `must be one of ${values.join(', ')}`);
  }
  return value as T;
};

const arrayValue = (value: unknown, path: string): readonly unknown[] => {
  if (!Array.isArray(value)) return fail(path, 'must be an array');
  return value;
};

const isoTimestamp = (value: unknown, path: string): string => {
  const result = text(value, path);
  if (Number.isNaN(Date.parse(result))) return fail(path, 'must be an ISO timestamp');
  return result;
};

const digest = (value: unknown, path: string): string => text(value, path);

const decodeEvidenceLineage = (
  value: unknown,
  path: string,
): FrontendKnowledgeEvidenceLineageV1 => {
  const object = strictObject(value, ['sourceId', 'sourceVersionId', 'evidenceSpanId'], path);
  return {
    sourceId: text(required(object, 'sourceId', path), `${path}.sourceId`),
    sourceVersionId: text(required(object, 'sourceVersionId', path), `${path}.sourceVersionId`),
    evidenceSpanId: text(required(object, 'evidenceSpanId', path), `${path}.evidenceSpanId`),
  };
};

const decodeProjectPolicyContext = (
  value: unknown,
  path: string,
): FrontendKnowledgeProjectPolicyContextV1 => {
  const object = strictObject(
    value,
    [
      'activeProjectId',
      'resourceProjectId',
      'draftProjectId',
      'effectiveProjectId',
      'accessRevision',
      'policyContextRevision',
    ],
    path,
  );
  return {
    activeProjectId: text(required(object, 'activeProjectId', path), `${path}.activeProjectId`),
    resourceProjectId: text(
      required(object, 'resourceProjectId', path),
      `${path}.resourceProjectId`,
    ),
    draftProjectId: text(required(object, 'draftProjectId', path), `${path}.draftProjectId`),
    effectiveProjectId: text(
      required(object, 'effectiveProjectId', path),
      `${path}.effectiveProjectId`,
    ),
    accessRevision: text(required(object, 'accessRevision', path), `${path}.accessRevision`),
    policyContextRevision: text(
      required(object, 'policyContextRevision', path),
      `${path}.policyContextRevision`,
    ),
  };
};

const decodeArtifact = <T extends DraftValidationArtifactRefV1>(
  value: unknown,
  path: string,
): T => {
  const object = strictObject(
    value,
    ['artifactId', 'artifactRevision', 'digest', 'status', 'projectPolicyContext'],
    path,
  );
  return {
    artifactId: text(required(object, 'artifactId', path), `${path}.artifactId`),
    artifactRevision: integer(
      required(object, 'artifactRevision', path),
      `${path}.artifactRevision`,
    ),
    digest: digest(required(object, 'digest', path), `${path}.digest`),
    status: enumValue(
      required(object, 'status', path),
      ['COMPLETE', 'PARTIAL', 'FAILED', 'UNAVAILABLE'] as const,
      `${path}.status`,
    ),
    projectPolicyContext: decodeProjectPolicyContext(
      required(object, 'projectPolicyContext', path),
      `${path}.projectPolicyContext`,
    ),
  } as T;
};

export const decodeDraftValidationArtifactRefV1 = (value: unknown): DraftValidationArtifactRefV1 =>
  decodeArtifact<DraftValidationArtifactRefV1>(value, 'validation');

export const decodeDraftImpactArtifactRefV1 = (value: unknown): DraftImpactArtifactRefV1 =>
  decodeArtifact<DraftImpactArtifactRefV1>(value, 'impactPreview');

export const decodeFrontendKnowledgeProjectionRefV1 = (
  value: unknown,
  path = 'projection',
): FrontendKnowledgeProjectionRefV1 => {
  const object = strictObject(
    value,
    [
      'projectionKind',
      'projectionId',
      'projectionIdentity',
      'projectionDigest',
      'readiness',
      'projectedCanonicalVersion',
      'sourceSnapshotDigest',
    ],
    path,
  );
  const identity = strictObject(
    required(object, 'projectionIdentity', path),
    ['kind', 'revision', 'version'],
    `${path}.projectionIdentity`,
  );
  const identityKind = enumValue(
    required(identity, 'kind', `${path}.projectionIdentity`),
    ['REVISION', 'VERSION'] as const,
    `${path}.projectionIdentity.kind`,
  );
  const projectionIdentity =
    identityKind === 'REVISION'
      ? {
          kind: identityKind,
          revision: text(
            required(identity, 'revision', `${path}.projectionIdentity`),
            `${path}.projectionIdentity.revision`,
          ),
        }
      : {
          kind: identityKind,
          version: integer(
            required(identity, 'version', `${path}.projectionIdentity`),
            `${path}.projectionIdentity.version`,
          ),
        };
  if (identityKind === 'REVISION' && identity.version !== undefined) {
    return fail(`${path}.projectionIdentity`, 'REVISION identity cannot include version');
  }
  if (identityKind === 'VERSION' && identity.revision !== undefined) {
    return fail(`${path}.projectionIdentity`, 'VERSION identity cannot include revision');
  }
  return {
    projectionKind: enumValue(
      required(object, 'projectionKind', path),
      ['CANONICAL_SEARCH', 'COMPILED_TRUTH'] as const,
      `${path}.projectionKind`,
    ),
    projectionId: text(required(object, 'projectionId', path), `${path}.projectionId`),
    projectionIdentity,
    projectionDigest: digest(
      required(object, 'projectionDigest', path),
      `${path}.projectionDigest`,
    ),
    readiness: enumValue(
      required(object, 'readiness', path),
      ['READY', 'STALE', 'DEGRADED', 'NOT_BUILT'] as const,
      `${path}.readiness`,
    ),
    projectedCanonicalVersion: integer(
      required(object, 'projectedCanonicalVersion', path),
      `${path}.projectedCanonicalVersion`,
    ),
    sourceSnapshotDigest: digest(
      required(object, 'sourceSnapshotDigest', path),
      `${path}.sourceSnapshotDigest`,
    ),
  };
};

export const decodeFrontendKnowledgeDraftBaseV1 = (
  value: unknown,
  options?: { readonly projectionRequired?: boolean },
): FrontendKnowledgeDraftBaseV1 => {
  const path = 'base';
  const object = strictObject(
    value,
    [
      'resourceProjectId',
      'canonicalSnapshotId',
      'canonicalVersion',
      'canonicalSnapshotDigest',
      'accessRevision',
      'policyContextRevision',
      'sourceLineage',
      'projection',
      'revisionIdentityKind',
      'canonicalResourceId',
      'canonicalRevisionId',
    ],
    path,
  );
  const projection =
    object.projection === undefined
      ? undefined
      : decodeFrontendKnowledgeProjectionRefV1(object.projection);
  if (options?.projectionRequired && projection === undefined) {
    return fail(path, 'projection is required for this authoring context');
  }
  const lineage = arrayValue(required(object, 'sourceLineage', path), `${path}.sourceLineage`).map(
    (entry, index) => {
      const lineageObject = strictObject(
        entry,
        ['sourceId', 'sourceVersionId', 'evidenceSpanIds'],
        `${path}.sourceLineage[${index}]`,
      );
      return {
        sourceId: text(
          required(lineageObject, 'sourceId', `${path}.sourceLineage[${index}]`),
          `${path}.sourceLineage[${index}].sourceId`,
        ),
        sourceVersionId: text(
          required(lineageObject, 'sourceVersionId', `${path}.sourceLineage[${index}]`),
          `${path}.sourceLineage[${index}].sourceVersionId`,
        ),
        evidenceSpanIds: arrayValue(
          required(lineageObject, 'evidenceSpanIds', `${path}.sourceLineage[${index}]`),
          `${path}.sourceLineage[${index}].evidenceSpanIds`,
        ).map((span, spanIndex) =>
          text(span, `${path}.sourceLineage[${index}].evidenceSpanIds[${spanIndex}]`),
        ),
      };
    },
  );
  const identityKind = enumValue(
    required(object, 'revisionIdentityKind', path),
    ['RESOURCE_REVISION', 'NEW_RESOURCE_SNAPSHOT'] as const,
    `${path}.revisionIdentityKind`,
  );
  const common = {
    resourceProjectId: text(
      required(object, 'resourceProjectId', path),
      `${path}.resourceProjectId`,
    ),
    canonicalSnapshotId: text(
      required(object, 'canonicalSnapshotId', path),
      `${path}.canonicalSnapshotId`,
    ),
    canonicalVersion: integer(
      required(object, 'canonicalVersion', path),
      `${path}.canonicalVersion`,
    ),
    canonicalSnapshotDigest: digest(
      required(object, 'canonicalSnapshotDigest', path),
      `${path}.canonicalSnapshotDigest`,
    ),
    accessRevision: text(required(object, 'accessRevision', path), `${path}.accessRevision`),
    policyContextRevision: text(
      required(object, 'policyContextRevision', path),
      `${path}.policyContextRevision`,
    ),
    sourceLineage: lineage,
    ...(projection === undefined ? {} : { projection }),
  };
  if (identityKind === 'RESOURCE_REVISION') {
    if (object.canonicalResourceId === undefined || object.canonicalRevisionId === undefined) {
      return fail(path, 'existing Resource requires canonicalResourceId and canonicalRevisionId');
    }
    return {
      ...common,
      revisionIdentityKind: identityKind,
      canonicalResourceId: text(object.canonicalResourceId, `${path}.canonicalResourceId`),
      canonicalRevisionId: text(object.canonicalRevisionId, `${path}.canonicalRevisionId`),
    };
  }
  if (object.canonicalResourceId !== undefined || object.canonicalRevisionId !== undefined) {
    return fail(path, 'NEW_RESOURCE_SNAPSHOT cannot include canonical Resource revision fields');
  }
  return { ...common, revisionIdentityKind: identityKind };
};

const decodeExpectedImpact = (
  value: unknown,
  path: string,
): KnowledgeOperationCommonV1['expectedImpact'] => {
  const object = strictObject(value, ['summary', 'targetIds'], path);
  const targetIds =
    object.targetIds === undefined
      ? undefined
      : arrayValue(object.targetIds, `${path}.targetIds`).map((target, index) =>
          text(target, `${path}.targetIds[${index}]`),
        );
  return {
    summary: text(required(object, 'summary', path), `${path}.summary`),
    ...(targetIds === undefined ? {} : { targetIds }),
  };
};

const decodeOperationCommon = (object: ObjectValue, path: string): KnowledgeOperationCommonV1 => {
  const evidenceReferences = arrayValue(
    required(object, 'evidenceReferences', path),
    `${path}.evidenceReferences`,
  ).map((entry, index) => decodeEvidenceLineage(entry, `${path}.evidenceReferences[${index}]`));
  return {
    operationId: text(required(object, 'operationId', path), `${path}.operationId`),
    baseRevision: integer(required(object, 'baseRevision', path), `${path}.baseRevision`),
    rationale: text(required(object, 'rationale', path), `${path}.rationale`),
    evidenceReferences,
    expectedImpact: decodeExpectedImpact(
      required(object, 'expectedImpact', path),
      `${path}.expectedImpact`,
    ),
    operationRevision: integer(
      required(object, 'operationRevision', path),
      `${path}.operationRevision`,
    ),
    contentDigest: digest(required(object, 'contentDigest', path), `${path}.contentDigest`),
  };
};

const decodeTarget = (
  value: unknown,
  expectedTargetType: string,
  path: string,
): KnowledgeOperationTargetV1<string> => {
  const object = strictObject(value, ['targetType', 'targetId', 'resourceId'], path);
  const targetType = text(required(object, 'targetType', path), `${path}.targetType`);
  if (targetType !== expectedTargetType) {
    return fail(path, `targetType must be '${expectedTargetType}'`);
  }
  return {
    targetType,
    ...(object.targetId === undefined
      ? {}
      : { targetId: text(object.targetId, `${path}.targetId`) }),
    resourceId: text(required(object, 'resourceId', path), `${path}.resourceId`),
  };
};

type OperationDefinition = {
  readonly targetType: string;
  readonly schemaVersion: string;
  readonly mode: 'ADD' | 'UPDATE' | 'REMOVE';
};

export const FRONTEND_KNOWLEDGE_OPERATION_KINDS = [
  'FACT_ADD',
  'FACT_UPDATE',
  'FACT_REMOVE',
  'CLAIM_ADD',
  'CLAIM_UPDATE',
  'CLAIM_REMOVE',
  'ENTITY_ADD',
  'ENTITY_UPDATE',
  'ENTITY_REFERENCE',
  'RELATION_ADD',
  'RELATION_UPDATE',
  'RELATION_REMOVE',
  'EVENT_ADD',
  'EVENT_UPDATE',
  'EVENT_REMOVE',
  'DECISION_ADD',
  'DECISION_UPDATE',
  'DECISION_REMOVE',
  'EVIDENCE_ATTACH',
  'EVIDENCE_DETACH',
  'TEMPORAL_VALIDITY_CHANGE',
  'CONFLICT_PROPOSAL_ADD',
  'CONFLICT_PROPOSAL_UPDATE',
  'KNOWLEDGE_GAP_PROPOSAL_ADD',
  'KNOWLEDGE_GAP_PROPOSAL_UPDATE',
  'NO_OP',
] as const;

export type FrontendKnowledgeOperationKindV1 = (typeof FRONTEND_KNOWLEDGE_OPERATION_KINDS)[number];

const OPERATION_DEFINITIONS: Readonly<
  Record<FrontendKnowledgeOperationKindV1, OperationDefinition>
> = {
  FACT_ADD: { targetType: 'FACT', schemaVersion: 'fact.v1', mode: 'ADD' },
  FACT_UPDATE: { targetType: 'FACT', schemaVersion: 'fact.v1', mode: 'UPDATE' },
  FACT_REMOVE: { targetType: 'FACT', schemaVersion: 'fact.v1', mode: 'REMOVE' },
  CLAIM_ADD: { targetType: 'CLAIM', schemaVersion: 'claim.v1', mode: 'ADD' },
  CLAIM_UPDATE: { targetType: 'CLAIM', schemaVersion: 'claim.v1', mode: 'UPDATE' },
  CLAIM_REMOVE: { targetType: 'CLAIM', schemaVersion: 'claim.v1', mode: 'REMOVE' },
  ENTITY_ADD: { targetType: 'ENTITY', schemaVersion: 'entity.v1', mode: 'ADD' },
  ENTITY_UPDATE: { targetType: 'ENTITY', schemaVersion: 'entity.v1', mode: 'UPDATE' },
  ENTITY_REFERENCE: { targetType: 'ENTITY', schemaVersion: 'entity.v1', mode: 'ADD' },
  RELATION_ADD: { targetType: 'RELATION', schemaVersion: 'relation.v1', mode: 'ADD' },
  RELATION_UPDATE: { targetType: 'RELATION', schemaVersion: 'relation.v1', mode: 'UPDATE' },
  RELATION_REMOVE: { targetType: 'RELATION', schemaVersion: 'relation.v1', mode: 'REMOVE' },
  EVENT_ADD: { targetType: 'EVENT', schemaVersion: 'event.v1', mode: 'ADD' },
  EVENT_UPDATE: { targetType: 'EVENT', schemaVersion: 'event.v1', mode: 'UPDATE' },
  EVENT_REMOVE: { targetType: 'EVENT', schemaVersion: 'event.v1', mode: 'REMOVE' },
  DECISION_ADD: { targetType: 'DECISION', schemaVersion: 'decision.v1', mode: 'ADD' },
  DECISION_UPDATE: { targetType: 'DECISION', schemaVersion: 'decision.v1', mode: 'UPDATE' },
  DECISION_REMOVE: { targetType: 'DECISION', schemaVersion: 'decision.v1', mode: 'REMOVE' },
  EVIDENCE_ATTACH: { targetType: 'EVIDENCE', schemaVersion: 'evidence-link.v1', mode: 'ADD' },
  EVIDENCE_DETACH: { targetType: 'EVIDENCE', schemaVersion: 'evidence-link.v1', mode: 'REMOVE' },
  TEMPORAL_VALIDITY_CHANGE: {
    targetType: 'TEMPORAL',
    schemaVersion: 'temporal-validity.v1',
    mode: 'UPDATE',
  },
  CONFLICT_PROPOSAL_ADD: {
    targetType: 'CONFLICT',
    schemaVersion: 'conflict-proposal.v1',
    mode: 'ADD',
  },
  CONFLICT_PROPOSAL_UPDATE: {
    targetType: 'CONFLICT',
    schemaVersion: 'conflict-proposal.v1',
    mode: 'UPDATE',
  },
  KNOWLEDGE_GAP_PROPOSAL_ADD: {
    targetType: 'KNOWLEDGE_GAP',
    schemaVersion: 'knowledge-gap-proposal.v1',
    mode: 'ADD',
  },
  KNOWLEDGE_GAP_PROPOSAL_UPDATE: {
    targetType: 'KNOWLEDGE_GAP',
    schemaVersion: 'knowledge-gap-proposal.v1',
    mode: 'UPDATE',
  },
  NO_OP: { targetType: 'REVIEW_RESULT', schemaVersion: 'no-op-review-result.v1', mode: 'ADD' },
};

const decodePayload = (value: unknown, schemaVersion: string, path: string): ObjectValue => {
  const object = asObject(value, path);
  if (object.schemaVersion !== schemaVersion) {
    return fail(path, `schemaVersion must be '${schemaVersion}'`);
  }
  switch (schemaVersion) {
    case 'fact.v1': {
      const result = strictObject(
        object,
        ['schemaVersion', 'subjectRef', 'predicate', 'value', 'unit'],
        path,
      );
      if (
        typeof result.value !== 'string' &&
        typeof result.value !== 'number' &&
        typeof result.value !== 'boolean'
      ) {
        return fail(`${path}.value`, 'must be a string, number or boolean');
      }
      return {
        schemaVersion,
        subjectRef: text(required(result, 'subjectRef', path), `${path}.subjectRef`),
        predicate: text(required(result, 'predicate', path), `${path}.predicate`),
        value: result.value,
        ...(result.unit === undefined ? {} : { unit: text(result.unit, `${path}.unit`) }),
      };
    }
    case 'claim.v1': {
      const result = strictObject(
        object,
        ['schemaVersion', 'statement', 'subjectRef', 'confidence'],
        path,
      );
      return {
        schemaVersion,
        statement: text(required(result, 'statement', path), `${path}.statement`),
        ...(result.subjectRef === undefined
          ? {}
          : { subjectRef: text(result.subjectRef, `${path}.subjectRef`) }),
        ...(result.confidence === undefined
          ? {}
          : { confidence: finiteNumber(result.confidence, `${path}.confidence`) }),
      };
    }
    case 'entity.v1': {
      const result = strictObject(
        object,
        ['schemaVersion', 'entityType', 'displayName', 'aliases'],
        path,
      );
      const aliases =
        result.aliases === undefined
          ? undefined
          : arrayValue(result.aliases, `${path}.aliases`).map((alias, index) =>
              text(alias, `${path}.aliases[${index}]`),
            );
      return {
        schemaVersion,
        entityType: text(required(result, 'entityType', path), `${path}.entityType`),
        displayName: text(required(result, 'displayName', path), `${path}.displayName`),
        ...(aliases === undefined ? {} : { aliases }),
      };
    }
    case 'relation.v1': {
      const result = strictObject(
        object,
        ['schemaVersion', 'relationType', 'fromEntityRef', 'toEntityRef'],
        path,
      );
      return {
        schemaVersion,
        relationType: text(required(result, 'relationType', path), `${path}.relationType`),
        fromEntityRef: text(required(result, 'fromEntityRef', path), `${path}.fromEntityRef`),
        toEntityRef: text(required(result, 'toEntityRef', path), `${path}.toEntityRef`),
      };
    }
    case 'event.v1': {
      const result = strictObject(
        object,
        ['schemaVersion', 'eventType', 'subjectRef', 'occurredAt'],
        path,
      );
      return {
        schemaVersion,
        eventType: text(required(result, 'eventType', path), `${path}.eventType`),
        subjectRef: text(required(result, 'subjectRef', path), `${path}.subjectRef`),
        ...(result.occurredAt === undefined
          ? {}
          : { occurredAt: isoTimestamp(result.occurredAt, `${path}.occurredAt`) }),
      };
    }
    case 'decision.v1': {
      const result = strictObject(object, ['schemaVersion', 'decisionType', 'decision'], path);
      return {
        schemaVersion,
        decisionType: text(required(result, 'decisionType', path), `${path}.decisionType`),
        decision: text(required(result, 'decision', path), `${path}.decision`),
      };
    }
    case 'evidence-link.v1': {
      const result = strictObject(
        object,
        ['schemaVersion', 'sourceId', 'sourceVersionId', 'evidenceSpanId'],
        path,
      );
      return {
        schemaVersion,
        sourceId: text(required(result, 'sourceId', path), `${path}.sourceId`),
        sourceVersionId: text(required(result, 'sourceVersionId', path), `${path}.sourceVersionId`),
        evidenceSpanId: text(required(result, 'evidenceSpanId', path), `${path}.evidenceSpanId`),
      };
    }
    case 'temporal-validity.v1': {
      const result = strictObject(
        object,
        ['schemaVersion', 'validFrom', 'validTo', 'status'],
        path,
      );
      return {
        schemaVersion,
        ...(result.validFrom === undefined
          ? {}
          : { validFrom: isoTimestamp(result.validFrom, `${path}.validFrom`) }),
        ...(result.validTo === undefined
          ? {}
          : { validTo: isoTimestamp(result.validTo, `${path}.validTo`) }),
        status: enumValue(
          required(result, 'status', path),
          ['KNOWN', 'OPEN', 'UNKNOWN'] as const,
          `${path}.status`,
        ),
      };
    }
    case 'conflict-proposal.v1': {
      const result = strictObject(
        object,
        ['schemaVersion', 'conflictType', 'competingTargetIds', 'summary'],
        path,
      );
      return {
        schemaVersion,
        conflictType: text(required(result, 'conflictType', path), `${path}.conflictType`),
        competingTargetIds: arrayValue(
          required(result, 'competingTargetIds', path),
          `${path}.competingTargetIds`,
        ).map((id, index) => text(id, `${path}.competingTargetIds[${index}]`)),
        summary: text(required(result, 'summary', path), `${path}.summary`),
      };
    }
    case 'knowledge-gap-proposal.v1': {
      const result = strictObject(
        object,
        ['schemaVersion', 'gapType', 'description', 'requestedEvidence'],
        path,
      );
      return {
        schemaVersion,
        gapType: text(required(result, 'gapType', path), `${path}.gapType`),
        description: text(required(result, 'description', path), `${path}.description`),
        ...(result.requestedEvidence === undefined
          ? {}
          : { requestedEvidence: text(result.requestedEvidence, `${path}.requestedEvidence`) }),
      };
    }
    case 'no-op-review-result.v1': {
      const result = strictObject(object, ['schemaVersion', 'result', 'reason'], path);
      return {
        schemaVersion,
        result: enumValue(
          required(result, 'result', path),
          ['REVIEWED', 'NO_CHANGE_REQUIRED', 'REJECTED_BY_AUTHOR'] as const,
          `${path}.result`,
        ),
        reason: text(required(result, 'reason', path), `${path}.reason`),
      };
    }
    default:
      return fail(path, `unsupported schemaVersion '${schemaVersion}'`);
  }
};

export const decodeFrontendKnowledgeOperationV1 = (
  value: unknown,
): FrontendKnowledgeOperationV1 => {
  const path = 'operation';
  const object = strictObject(
    value,
    [
      'kind',
      'target',
      'before',
      'after',
      'operationId',
      'baseRevision',
      'rationale',
      'evidenceReferences',
      'expectedImpact',
      'operationRevision',
      'contentDigest',
    ],
    path,
  );
  const kindValue = text(required(object, 'kind', path), `${path}.kind`);
  if (!FRONTEND_KNOWLEDGE_OPERATION_KINDS.includes(kindValue as FrontendKnowledgeOperationKindV1)) {
    return fail(`${path}.kind`, `unsupported operation '${kindValue}'`);
  }
  const kind = kindValue as FrontendKnowledgeOperationKindV1;
  const definition = OPERATION_DEFINITIONS[kind];
  const common = decodeOperationCommon(object, path);
  const target = decodeTarget(object.target, definition.targetType, `${path}.target`);
  const before =
    object.before === undefined
      ? undefined
      : decodePayload(object.before, definition.schemaVersion, `${path}.before`);
  const after =
    object.after === undefined
      ? undefined
      : decodePayload(object.after, definition.schemaVersion, `${path}.after`);
  if (definition.mode === 'ADD' && (before !== undefined || after === undefined)) {
    return fail(path, 'add operations require after and forbid before');
  }
  if (definition.mode === 'UPDATE' && (before === undefined || after === undefined)) {
    return fail(path, 'update operations require both before and after');
  }
  if (definition.mode === 'REMOVE' && (before === undefined || after !== undefined)) {
    return fail(path, 'remove operations require before and forbid after');
  }
  return {
    ...common,
    kind,
    target,
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after }),
  } as FrontendKnowledgeOperationV1;
};

export const decodeReviewResourceRefV1 = (value: unknown): ReviewResourceRefV1 => {
  const path = 'reviewResource';
  const object = strictObject(
    value,
    [
      'reviewResourceId',
      'draftId',
      'draftRevision',
      'resourceProjectId',
      'draftProjectId',
      'effectiveProjectId',
      'policyContextRevision',
      'digest',
    ],
    path,
  );
  return {
    reviewResourceId: text(required(object, 'reviewResourceId', path), `${path}.reviewResourceId`),
    draftId: text(required(object, 'draftId', path), `${path}.draftId`),
    draftRevision: integer(required(object, 'draftRevision', path), `${path}.draftRevision`),
    resourceProjectId: text(
      required(object, 'resourceProjectId', path),
      `${path}.resourceProjectId`,
    ),
    draftProjectId: text(required(object, 'draftProjectId', path), `${path}.draftProjectId`),
    effectiveProjectId: text(
      required(object, 'effectiveProjectId', path),
      `${path}.effectiveProjectId`,
    ),
    policyContextRevision: text(
      required(object, 'policyContextRevision', path),
      `${path}.policyContextRevision`,
    ),
    digest: digest(required(object, 'digest', path), `${path}.digest`),
  };
};

export const decodeReviewSubmissionRefV1 = (value: unknown): ReviewSubmissionRefV1 => {
  const path = 'reviewSubmission';
  const object = strictObject(
    value,
    [
      'reviewSubmissionId',
      'draftId',
      'draftRevision',
      'operationDigest',
      'contentDigest',
      'validationArtifact',
      'impactArtifact',
      'evidenceLineage',
      'projectPolicyContext',
      'reviewResource',
    ],
    path,
  );
  return {
    reviewSubmissionId: text(
      required(object, 'reviewSubmissionId', path),
      `${path}.reviewSubmissionId`,
    ),
    draftId: text(required(object, 'draftId', path), `${path}.draftId`),
    draftRevision: integer(required(object, 'draftRevision', path), `${path}.draftRevision`),
    operationDigest: digest(required(object, 'operationDigest', path), `${path}.operationDigest`),
    contentDigest: digest(required(object, 'contentDigest', path), `${path}.contentDigest`),
    validationArtifact: decodeArtifact(
      required(object, 'validationArtifact', path),
      `${path}.validationArtifact`,
    ),
    impactArtifact: decodeArtifact(
      required(object, 'impactArtifact', path),
      `${path}.impactArtifact`,
    ),
    evidenceLineage: arrayValue(
      required(object, 'evidenceLineage', path),
      `${path}.evidenceLineage`,
    ).map((entry, index) => decodeEvidenceLineage(entry, `${path}.evidenceLineage[${index}]`)),
    projectPolicyContext: decodeProjectPolicyContext(
      required(object, 'projectPolicyContext', path),
      `${path}.projectPolicyContext`,
    ),
    reviewResource: decodeReviewResourceRefV1(required(object, 'reviewResource', path)),
  };
};

export const decodeFrontendKnowledgeDraftChangeSetV1 = (
  value: unknown,
  options?: { readonly projectionRequired?: boolean },
): FrontendKnowledgeDraftChangeSetV1 => {
  const path = 'draft';
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'draftId',
      'seedId',
      'answerRunId',
      'startMode',
      'status',
      'revision',
      'activeProjectId',
      'resourceProjectId',
      'draftProjectId',
      'effectiveProjectId',
      'resourceId',
      'base',
      'operations',
      'validation',
      'impactPreview',
      'reviewResource',
      'reviewSubmission',
      'contentDigest',
      'createdAt',
      'updatedAt',
    ],
    path,
  );
  if (required(object, 'schemaVersion', path) !== '1.0.0') {
    return fail(`${path}.schemaVersion`, "must be '1.0.0'");
  }
  const operations = arrayValue(required(object, 'operations', path), `${path}.operations`).map(
    (operation, index) => decodeFrontendKnowledgeOperationV1At(operation, index),
  );
  const base = decodeFrontendKnowledgeDraftBaseV1(required(object, 'base', path), options);
  const resourceProjectId = text(
    required(object, 'resourceProjectId', path),
    `${path}.resourceProjectId`,
  );
  if (base.resourceProjectId !== resourceProjectId) {
    return fail(`${path}.resourceProjectId`, 'must match base.resourceProjectId');
  }
  const draftId = text(required(object, 'draftId', path), `${path}.draftId`);
  const revision = integer(required(object, 'revision', path), `${path}.revision`);
  const resourceId = text(required(object, 'resourceId', path), `${path}.resourceId`);
  for (const [index, operation] of operations.entries()) {
    if (operation.target.resourceId !== resourceId) {
      return fail(`${path}.operations[${index}].target.resourceId`, 'must match draft.resourceId');
    }
  }
  const reviewResource =
    object.reviewResource === undefined
      ? undefined
      : decodeReviewResourceRefV1(object.reviewResource);
  const reviewSubmission =
    object.reviewSubmission === undefined
      ? undefined
      : decodeReviewSubmissionRefV1(object.reviewSubmission);
  if (reviewResource !== undefined && reviewResource.draftId !== draftId) {
    return fail(`${path}.reviewResource.draftId`, 'must match draft.draftId');
  }
  if (reviewResource !== undefined && reviewResource.draftRevision !== revision) {
    return fail(`${path}.reviewResource.draftRevision`, 'must match draft.revision');
  }
  if (reviewSubmission !== undefined && reviewSubmission.draftId !== draftId) {
    return fail(`${path}.reviewSubmission.draftId`, 'must match draft.draftId');
  }
  if (reviewSubmission !== undefined && reviewSubmission.draftRevision !== revision) {
    return fail(`${path}.reviewSubmission.draftRevision`, 'must match draft.revision');
  }
  const status = enumValue(
    required(object, 'status', path),
    [
      'DRAFT',
      'VALIDATING',
      'VALID',
      'INVALID',
      'STALE',
      'CONFLICT',
      'READY_FOR_REVIEW',
      'SUBMITTING',
      'SUBMITTED',
      'ABANDONED',
    ] as const,
    `${path}.status`,
  );
  const validation =
    object.validation === undefined
      ? undefined
      : decodeDraftValidationArtifactRefV1(object.validation);
  const impactPreview =
    object.impactPreview === undefined
      ? undefined
      : decodeDraftImpactArtifactRefV1(object.impactPreview);
  if (['READY_FOR_REVIEW', 'SUBMITTING', 'SUBMITTED'].includes(status)) {
    if (validation?.status !== 'COMPLETE' || impactPreview?.status !== 'COMPLETE') {
      return fail(path, 'review-ready lifecycle requires complete validation and impact artifacts');
    }
  }
  return {
    schemaVersion: '1.0.0',
    draftId,
    ...(object.seedId === undefined ? {} : { seedId: text(object.seedId, `${path}.seedId`) }),
    ...(object.answerRunId === undefined
      ? {}
      : { answerRunId: text(object.answerRunId, `${path}.answerRunId`) }),
    startMode: enumValue(
      required(object, 'startMode', path),
      ['SEED_MATERIALIZATION', 'KNOWLEDGE_PAGE'] as const,
      `${path}.startMode`,
    ),
    status,
    revision,
    activeProjectId: text(required(object, 'activeProjectId', path), `${path}.activeProjectId`),
    resourceProjectId,
    draftProjectId: text(required(object, 'draftProjectId', path), `${path}.draftProjectId`),
    effectiveProjectId: text(
      required(object, 'effectiveProjectId', path),
      `${path}.effectiveProjectId`,
    ),
    resourceId,
    base,
    operations,
    ...(validation === undefined ? {} : { validation }),
    ...(impactPreview === undefined ? {} : { impactPreview }),
    ...(reviewResource === undefined ? {} : { reviewResource }),
    ...(reviewSubmission === undefined ? {} : { reviewSubmission }),
    contentDigest: digest(required(object, 'contentDigest', path), `${path}.contentDigest`),
    createdAt: isoTimestamp(required(object, 'createdAt', path), `${path}.createdAt`),
    updatedAt: isoTimestamp(required(object, 'updatedAt', path), `${path}.updatedAt`),
  };
};

const decodeFrontendKnowledgeOperationV1At = (
  value: unknown,
  index: number,
): FrontendKnowledgeOperationV1 => {
  const decoded = decodeFrontendKnowledgeOperationV1(value);
  if (decoded.target.resourceId.trim().length === 0) {
    return fail(`draft.operations[${index}].target.resourceId`, 'must be non-empty');
  }
  return decoded;
};

export const decodeFrontendKnowledgeDraftCommandOutcomeV1 = (
  value: unknown,
  path = 'commandOutcome',
): FrontendKnowledgeDraftCommandOutcomeV1 =>
  enumValue(value, ['ACCEPTED', 'COMPLETED', 'REJECTED', 'OUTCOME_UNKNOWN'] as const, path);

export const decodeDraftCommandEnvelopeV1 = (value: unknown): DraftCommandEnvelopeV1 => {
  const path = 'commandEnvelope';
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'clientRequestId',
      'idempotencyKey',
      'expectedDraftRevision',
      'expectedCanonicalVersion',
      'semanticDigest',
    ],
    path,
  );
  if (required(object, 'schemaVersion', path) !== '1.0.0') {
    return fail(`${path}.schemaVersion`, "must be '1.0.0'");
  }
  return {
    schemaVersion: '1.0.0',
    clientRequestId: text(required(object, 'clientRequestId', path), `${path}.clientRequestId`),
    idempotencyKey: text(required(object, 'idempotencyKey', path), `${path}.idempotencyKey`),
    ...(object.expectedDraftRevision === undefined
      ? {}
      : {
          expectedDraftRevision: integer(
            object.expectedDraftRevision,
            `${path}.expectedDraftRevision`,
          ),
        }),
    ...(object.expectedCanonicalVersion === undefined
      ? {}
      : {
          expectedCanonicalVersion: integer(
            object.expectedCanonicalVersion,
            `${path}.expectedCanonicalVersion`,
          ),
        }),
    ...(object.semanticDigest === undefined
      ? {}
      : { semanticDigest: digest(object.semanticDigest, `${path}.semanticDigest`) }),
  };
};

const COMMAND_ENVELOPE_KEYS = [
  'schemaVersion',
  'clientRequestId',
  'idempotencyKey',
  'expectedDraftRevision',
  'expectedCanonicalVersion',
  'semanticDigest',
] as const;

const decodeCommandRequestObject = (
  value: unknown,
  commandKeys: readonly string[],
  path: string,
): { readonly object: ObjectValue; readonly envelope: DraftCommandEnvelopeV1 } => {
  const object = strictObject(value, [...COMMAND_ENVELOPE_KEYS, ...commandKeys], path);
  const envelopeObject = Object.fromEntries(
    COMMAND_ENVELOPE_KEYS.filter((key) => object[key] !== undefined).map((key) => [
      key,
      object[key],
    ]),
  );
  return { object, envelope: decodeDraftCommandEnvelopeV1(envelopeObject) };
};

const requiredExpectedDraftRevision = (envelope: DraftCommandEnvelopeV1, path: string): number => {
  if (envelope.expectedDraftRevision === undefined) {
    return fail(path, 'expectedDraftRevision is required');
  }
  return envelope.expectedDraftRevision;
};

const positiveInteger = (value: unknown, path: string): number => {
  const result = integer(value, path);
  if (result < 1) return fail(path, 'must be a positive safe integer');
  return result;
};

export const decodeMaterializeDraftRequestV1 = (value: unknown): MaterializeDraftRequestV1 => {
  const { object, envelope } = decodeCommandRequestObject(value, ['seedId'], 'materializeDraft');
  return {
    ...envelope,
    seedId: text(required(object, 'seedId', 'materializeDraft'), 'materializeDraft.seedId'),
  };
};

export const decodeStartSeedlessDraftRequestV1 = (value: unknown): StartSeedlessDraftRequestV1 => {
  const { object, envelope } = decodeCommandRequestObject(
    value,
    ['resourceId', 'pageId'],
    'startSeedlessDraft',
  );
  const resourceId = optionalTextValue(object, 'resourceId', 'startSeedlessDraft');
  const pageId = optionalTextValue(object, 'pageId', 'startSeedlessDraft');
  if (resourceId === undefined && pageId === undefined) {
    return fail('startSeedlessDraft', 'resourceId or pageId is required');
  }
  if (resourceId !== undefined && pageId !== undefined) {
    return fail('startSeedlessDraft', 'resourceId and pageId are mutually exclusive');
  }
  if (resourceId !== undefined) return { ...envelope, resourceId };
  return { ...envelope, pageId: pageId as string };
};

const optionalTextValue = (object: ObjectValue, key: string, path: string): string | undefined =>
  object[key] === undefined ? undefined : text(object[key], `${path}.${key}`);

export const decodeSaveKnowledgeDraftRequestV1 = (value: unknown): SaveKnowledgeDraftRequestV1 => {
  const { object, envelope } = decodeCommandRequestObject(
    value,
    ['draftId', 'operations', 'expectedBaseRevision', 'operationRevision', 'contentDigest'],
    'saveDraft',
  );
  const expectedDraftRevision = requiredExpectedDraftRevision(envelope, 'saveDraft');
  const operations = arrayValue(
    required(object, 'operations', 'saveDraft'),
    'saveDraft.operations',
  ).map((operation, index) => decodeFrontendKnowledgeOperationV1At(operation, index));
  return {
    ...envelope,
    expectedDraftRevision,
    draftId: text(required(object, 'draftId', 'saveDraft'), 'saveDraft.draftId'),
    operations,
    expectedBaseRevision: integer(
      required(object, 'expectedBaseRevision', 'saveDraft'),
      'saveDraft.expectedBaseRevision',
    ),
    operationRevision: integer(
      required(object, 'operationRevision', 'saveDraft'),
      'saveDraft.operationRevision',
    ),
    contentDigest: digest(
      required(object, 'contentDigest', 'saveDraft'),
      'saveDraft.contentDigest',
    ),
  };
};

export const decodeValidateKnowledgeDraftRequestV1 = (
  value: unknown,
): ValidateKnowledgeDraftRequestV1 => {
  const { object, envelope } = decodeCommandRequestObject(
    value,
    ['draftId', 'expectedBaseRevision'],
    'validateDraft',
  );
  const expectedDraftRevision = requiredExpectedDraftRevision(envelope, 'validateDraft');
  return {
    ...envelope,
    expectedDraftRevision,
    draftId: text(required(object, 'draftId', 'validateDraft'), 'validateDraft.draftId'),
    expectedBaseRevision: integer(
      required(object, 'expectedBaseRevision', 'validateDraft'),
      'validateDraft.expectedBaseRevision',
    ),
  };
};

const decodeImpactOptions = (
  value: unknown,
  path: string,
): GenerateKnowledgeDraftImpactRequestV1['options'] => {
  if (value === undefined) return undefined;
  const object = strictObject(value, ['maxDepth', 'maxNodes'], path);
  const maxDepth =
    object.maxDepth === undefined
      ? undefined
      : positiveInteger(object.maxDepth, `${path}.maxDepth`);
  const maxNodes =
    object.maxNodes === undefined
      ? undefined
      : positiveInteger(object.maxNodes, `${path}.maxNodes`);
  if (maxDepth === undefined && maxNodes === undefined) {
    return fail(path, 'maxDepth or maxNodes is required when options is provided');
  }
  return {
    ...(maxDepth === undefined ? {} : { maxDepth }),
    ...(maxNodes === undefined ? {} : { maxNodes }),
  };
};

export const decodeGenerateKnowledgeDraftImpactRequestV1 = (
  value: unknown,
): GenerateKnowledgeDraftImpactRequestV1 => {
  const { object, envelope } = decodeCommandRequestObject(
    value,
    ['draftId', 'expectedBaseRevision', 'options'],
    'generateImpactPreview',
  );
  const expectedDraftRevision = requiredExpectedDraftRevision(envelope, 'generateImpactPreview');
  const options = decodeImpactOptions(object.options, 'generateImpactPreview.options');
  return {
    ...envelope,
    expectedDraftRevision,
    draftId: text(
      required(object, 'draftId', 'generateImpactPreview'),
      'generateImpactPreview.draftId',
    ),
    expectedBaseRevision: integer(
      required(object, 'expectedBaseRevision', 'generateImpactPreview'),
      'generateImpactPreview.expectedBaseRevision',
    ),
    ...(options === undefined ? {} : { options }),
  };
};

export const decodeSubmitKnowledgeDraftForReviewRequestV1 = (
  value: unknown,
): SubmitKnowledgeDraftForReviewRequestV1 => {
  const { object, envelope } = decodeCommandRequestObject(
    value,
    ['draftId', 'expectedBaseRevision', 'validationArtifact', 'impactArtifact'],
    'submitDraftForReview',
  );
  const expectedDraftRevision = requiredExpectedDraftRevision(envelope, 'submitDraftForReview');
  const validationArtifact = decodeDraftValidationArtifactRefV1(
    required(object, 'validationArtifact', 'submitDraftForReview'),
  );
  const impactArtifact = decodeDraftImpactArtifactRefV1(
    required(object, 'impactArtifact', 'submitDraftForReview'),
  );
  if (validationArtifact.status !== 'COMPLETE' || impactArtifact.status !== 'COMPLETE') {
    return failWithApiCode(
      'submitDraftForReview',
      'validation and impact artifacts must be COMPLETE',
      'NOT_READY_FOR_REVIEW',
    );
  }
  return {
    ...envelope,
    expectedDraftRevision,
    draftId: text(
      required(object, 'draftId', 'submitDraftForReview'),
      'submitDraftForReview.draftId',
    ),
    expectedBaseRevision: integer(
      required(object, 'expectedBaseRevision', 'submitDraftForReview'),
      'submitDraftForReview.expectedBaseRevision',
    ),
    validationArtifact,
    impactArtifact,
  };
};

export const decodeAbandonKnowledgeDraftRequestV1 = (
  value: unknown,
): AbandonKnowledgeDraftRequestV1 => {
  const { object, envelope } = decodeCommandRequestObject(
    value,
    ['draftId', 'expectedBaseRevision'],
    'abandonDraft',
  );
  const expectedDraftRevision = requiredExpectedDraftRevision(envelope, 'abandonDraft');
  return {
    ...envelope,
    expectedDraftRevision,
    draftId: text(required(object, 'draftId', 'abandonDraft'), 'abandonDraft.draftId'),
    expectedBaseRevision: integer(
      required(object, 'expectedBaseRevision', 'abandonDraft'),
      'abandonDraft.expectedBaseRevision',
    ),
  };
};

export const decodeResolveKnowledgeDraftCommandOutcomeRequestV1 = (
  value: unknown,
): ResolveKnowledgeDraftCommandOutcomeRequestV1 => {
  const object = strictObject(
    value,
    ['schemaVersion', 'clientRequestId', 'idempotencyKey', 'semanticDigest'],
    'resolveCommandOutcome',
  );
  const envelope = decodeDraftCommandEnvelopeV1(object);
  return {
    schemaVersion: envelope.schemaVersion,
    clientRequestId: envelope.clientRequestId,
    idempotencyKey: envelope.idempotencyKey,
    semanticDigest: digest(
      required(object, 'semanticDigest', 'resolveCommandOutcome'),
      'resolveCommandOutcome.semanticDigest',
    ),
  };
};

const decodeCommandResultBase = (
  value: unknown,
  resultKeys: readonly string[],
  path: string,
): { readonly object: ObjectValue; readonly base: FrontendKnowledgeDraftCommandResultBaseV1 } => {
  const object = strictObject(
    value,
    ['schemaVersion', 'outcome', 'clientRequestId', 'idempotencyKey', ...resultKeys],
    path,
  );
  if (required(object, 'schemaVersion', path) !== '1.0.0') {
    return fail(`${path}.schemaVersion`, "must be '1.0.0'");
  }
  return {
    object,
    base: {
      schemaVersion: '1.0.0',
      outcome: decodeFrontendKnowledgeDraftCommandOutcomeV1(
        required(object, 'outcome', path),
        `${path}.outcome`,
      ),
      clientRequestId: text(required(object, 'clientRequestId', path), `${path}.clientRequestId`),
      idempotencyKey: text(required(object, 'idempotencyKey', path), `${path}.idempotencyKey`),
    },
  };
};

export const decodeMaterializeDraftResultV1 = (value: unknown): MaterializeDraftResultV1 => {
  const { object, base } = decodeCommandResultBase(value, ['draft'], 'materializeDraftResult');
  return {
    ...base,
    draft: decodeFrontendKnowledgeDraftChangeSetV1(
      required(object, 'draft', 'materializeDraftResult'),
    ),
  };
};

export const decodeStartSeedlessDraftResultV1 = (value: unknown): StartSeedlessDraftResultV1 =>
  decodeMaterializeDraftResultV1(value);

export const decodeSaveKnowledgeDraftResultV1 = (value: unknown): SaveKnowledgeDraftResultV1 =>
  decodeMaterializeDraftResultV1(value);

export const decodeValidateKnowledgeDraftResultV1 = (
  value: unknown,
): ValidateKnowledgeDraftResultV1 => {
  const { object, base } = decodeCommandResultBase(
    value,
    ['draftStatus', 'validation'],
    'validateDraftResult',
  );
  return {
    ...base,
    draftStatus: enumValue(
      required(object, 'draftStatus', 'validateDraftResult'),
      [
        'DRAFT',
        'VALIDATING',
        'VALID',
        'INVALID',
        'STALE',
        'CONFLICT',
        'READY_FOR_REVIEW',
        'SUBMITTING',
        'SUBMITTED',
        'ABANDONED',
      ] as const,
      'validateDraftResult.draftStatus',
    ),
    validation: decodeDraftValidationArtifactRefV1(
      required(object, 'validation', 'validateDraftResult'),
    ),
  };
};

export const decodeGenerateKnowledgeDraftImpactResultV1 = (
  value: unknown,
): GenerateKnowledgeDraftImpactResultV1 => {
  const { object, base } = decodeCommandResultBase(
    value,
    ['draftStatus', 'impactPreview'],
    'generateImpactPreviewResult',
  );
  return {
    ...base,
    draftStatus: enumValue(
      required(object, 'draftStatus', 'generateImpactPreviewResult'),
      [
        'DRAFT',
        'VALIDATING',
        'VALID',
        'INVALID',
        'STALE',
        'CONFLICT',
        'READY_FOR_REVIEW',
        'SUBMITTING',
        'SUBMITTED',
        'ABANDONED',
      ] as const,
      'generateImpactPreviewResult.draftStatus',
    ),
    impactPreview: decodeDraftImpactArtifactRefV1(
      required(object, 'impactPreview', 'generateImpactPreviewResult'),
    ),
  };
};

export const decodeSubmitKnowledgeDraftForReviewResultV1 = (
  value: unknown,
): SubmitKnowledgeDraftForReviewResultV1 => {
  const { object, base } = decodeCommandResultBase(
    value,
    ['reviewSubmission'],
    'submitDraftForReviewResult',
  );
  return {
    ...base,
    reviewSubmission: decodeReviewSubmissionRefV1(
      required(object, 'reviewSubmission', 'submitDraftForReviewResult'),
    ),
  };
};

export const decodeResolveKnowledgeDraftCommandOutcomeResultV1 = (
  value: unknown,
): ResolveKnowledgeDraftCommandOutcomeResultV1 => {
  const path = 'resolveCommandOutcomeResult';
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'outcome',
      'originalClientRequestId',
      'originalIdempotencyKey',
      'draft',
      'reviewResource',
      'reviewSubmission',
    ],
    path,
  );
  if (required(object, 'schemaVersion', path) !== '1.0.0') {
    return fail(`${path}.schemaVersion`, "must be '1.0.0'");
  }
  const outcome = decodeFrontendKnowledgeDraftCommandOutcomeV1(
    required(object, 'outcome', path),
    `${path}.outcome`,
  );
  const draft =
    object.draft === undefined ? undefined : decodeFrontendKnowledgeDraftChangeSetV1(object.draft);
  const reviewResource =
    object.reviewResource === undefined
      ? undefined
      : decodeReviewResourceRefV1(object.reviewResource);
  const reviewSubmission =
    object.reviewSubmission === undefined
      ? undefined
      : decodeReviewSubmissionRefV1(object.reviewSubmission);
  if (
    outcome === 'COMPLETED' &&
    draft === undefined &&
    reviewResource === undefined &&
    reviewSubmission === undefined
  ) {
    return fail(path, 'COMPLETED outcome requires an existing resource');
  }
  return {
    schemaVersion: '1.0.0',
    outcome,
    originalClientRequestId: text(
      required(object, 'originalClientRequestId', path),
      `${path}.originalClientRequestId`,
    ),
    originalIdempotencyKey: text(
      required(object, 'originalIdempotencyKey', path),
      `${path}.originalIdempotencyKey`,
    ),
    ...(draft === undefined ? {} : { draft }),
    ...(reviewResource === undefined ? {} : { reviewResource }),
    ...(reviewSubmission === undefined ? {} : { reviewSubmission }),
  };
};

export const decodeFrontendKnowledgeDraftFailureV1 = (
  value: unknown,
): FrontendKnowledgeDraftFailureV1 => {
  const path = 'draftFailure';
  const object = strictObject(
    value,
    ['schemaVersion', 'code', 'normalizedCode', 'category', 'httpStatus', 'retryable', 'message'],
    path,
  );
  if (required(object, 'schemaVersion', path) !== '1.0.0') {
    return fail(`${path}.schemaVersion`, "must be '1.0.0'");
  }
  const code = enumValue(
    required(object, 'code', path),
    FRONTEND_KNOWLEDGE_DRAFT_API_FAILURE_CODES,
    `${path}.code`,
  );
  const normalized = normalizeFrontendKnowledgeDraftFailure(code);
  if (normalized === undefined) return fail(`${path}.code`, 'has no typed mapping');
  const normalizedCode = text(required(object, 'normalizedCode', path), `${path}.normalizedCode`);
  if (normalizedCode !== normalized.normalizedCode) {
    return fail(`${path}.normalizedCode`, 'does not match the external failure code mapping');
  }
  const category = enumValue(
    required(object, 'category', path),
    [
      'VALIDATION',
      'AUTHORIZATION',
      'NOT_FOUND',
      'CONFLICT',
      'DEPENDENCY',
      'OUTCOME_UNKNOWN',
    ] as const,
    `${path}.category`,
  );
  const httpStatus = integer(required(object, 'httpStatus', path), `${path}.httpStatus`);
  const retryable = booleanValue(required(object, 'retryable', path), `${path}.retryable`);
  if (
    category !== normalized.mapping.category ||
    httpStatus !== normalized.mapping.httpStatus ||
    retryable !== normalized.mapping.retryable
  ) {
    return fail(path, 'failure mapping metadata does not match the typed code');
  }
  return {
    schemaVersion: '1.0.0',
    code,
    normalizedCode: normalized.normalizedCode,
    category,
    httpStatus,
    retryable,
    message: text(required(object, 'message', path), `${path}.message`),
  };
};
