export type ErrorCode =
  | 'AUTHENTICATION_REQUIRED'
  | 'AUTHENTICATION_INVALID'
  | 'AUTHORIZATION_DENIED'
  | 'PROJECT_CONTEXT_REQUIRED'
  | 'PROJECT_ACCESS_DENIED'
  | 'LEGACY_SECURITY_HEADER_FORBIDDEN'
  | 'REQUEST_ORIGIN_DENIED'
  | 'ACTION_SERVER_BINDING_REQUIRED'
  | 'ACTION_REFERENCE_NOT_FOUND'
  | 'STALE_ACTION_SNAPSHOT'
  | 'ACTION_AUTHORIZATION_DENIED'
  | 'ACTION_CONNECTOR_NOT_ALLOWED'
  | 'VALIDATION_ERROR'
  | 'POLICY_DENIED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'STALE_VERSION'
  | 'STALE_APPROVAL'
  | 'RETRYABLE_DEPENDENCY'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'OUTCOME_UNKNOWN'
  | 'TERMINAL_FAILURE'
  | 'UNSUPPORTED_SCHEMA'
  | 'FORMAT_CORRUPT'
  | 'FORMAT_ENCRYPTED'
  | 'FORMAT_UNSUPPORTED'
  | 'MULTIMODAL_VALIDATION_REQUIRED'
  | 'REPLAY_BLOCKED'
  | 'REVISION_CONFLICT'
  | 'DIGEST_MISMATCH'
  | 'RESOURCE_RETIRED'
  | 'RESOURCE_PROJECT_MISMATCH'
  | 'PRECONDITION_ACCESS_DENIED'
  | 'POLICY_CONTEXT_CHANGED'
  | 'IDEMPOTENCY_KEY_REUSE_MISMATCH'
  | 'SESSION_EXPIRED'
  | 'LOCAL_PROJECT_SELECTION_REQUIRED'
  | 'ZERO_PROJECT_PRECONDITION_FAILED'
  | 'PROJECT_ACCESS_REVISION_CONFLICT'
  | 'CLIENT_REQUEST_MEANING_MISMATCH'
  | 'PROJECT_BOOTSTRAP_ALREADY_COMPLETED'
  | 'PROJECT_BOOTSTRAP_OUTCOME_UNKNOWN'
  | 'CAPABILITY_DENIED'
  | 'OUTCOME_INDETERMINATE'
  | 'RESOURCE_ACCESS_REVOKED'
  | 'RETENTION_EXPIRED'
  | 'INVALID_REQUEST'
  | 'INTERNAL_UNCLASSIFIED'
  // FE-P3-S2 Knowledge Draft typed API failures.
  | 'FORBIDDEN'
  | 'PROJECT_BINDING_CONFLICT'
  | 'ACCESS_REVOKED'
  | 'BASE_UNAVAILABLE'
  | 'DRAFT_NOT_FOUND'
  | 'DRAFT_REVISION_CONFLICT'
  | 'VALIDATION_FAILED'
  | 'STALE'
  | 'IMPACT_PARTIAL'
  | 'ANALYZER_UNAVAILABLE'
  | 'NOT_READY_FOR_REVIEW'
  | 'OUTCOME_NOT_FOUND'
  | 'COMMAND_SCOPE_MISMATCH'
  | 'SEED_NOT_FOUND'
  | 'SEED_ALREADY_MATERIALIZED'
  | 'CANONICAL_SNAPSHOT_MISMATCH'
  | 'RESOURCE_REVISION_MISSING'
  | 'STALE_BASE'
  | 'UNSUPPORTED_OPERATION'
  | 'ARTIFACT_INCOMPLETE'
  // FE-P4-S1 Review Center typed failures.
  | 'REVIEW_CONTEXT_NOT_FOUND'
  | 'REVIEW_CONTEXT_STALE'
  | 'REVIEW_TARGET_CHANGED'
  | 'REVIEW_ITEM_NOT_FOUND'
  | 'REVIEW_DECISION_NOT_ALLOWED'
  | 'REVIEW_DEPENDENCY_UNSATISFIED'
  | 'REVIEW_ATOMIC_GROUP_SPLIT'
  | 'REVIEW_CONFLICTING_APPROVAL_SET'
  | 'REVIEW_DANGLING_REFERENCE'
  | 'REVIEW_EVIDENCE_CHANGED'
  | 'REVIEW_POLICY_CHANGED'
  | 'REVIEW_ACCESS_CHANGED'
  | 'REVIEW_APPROVAL_NOT_ISSUED'
  | 'REVIEW_APPROVAL_EXPIRED'
  | 'REVIEW_REVISION_ROUTE_UNAVAILABLE'
  | 'EXTERNAL_ACTION_REVIEW_REQUIRES_FE_P4_S2';

export type ShotgunErrorInput = {
  readonly code: ErrorCode;
  readonly safeMessage: string;
  readonly module: string;
  readonly operation: string;
  readonly correlationId?: string;
  readonly retryable?: boolean;
  readonly cause?: unknown;
};

export class ShotgunError extends Error {
  readonly code: ErrorCode;
  readonly safeMessage: string;
  readonly module: string;
  readonly operation: string;
  readonly correlationId?: string;
  readonly retryable: boolean;

  constructor(input: ShotgunErrorInput) {
    super(input.safeMessage, { cause: input.cause });
    this.name = 'ShotgunError';
    this.code = input.code;
    this.safeMessage = input.safeMessage;
    this.module = input.module;
    this.operation = input.operation;
    this.correlationId = input.correlationId;
    this.retryable = input.retryable ?? false;
  }
}

export const toShotgunError = (
  error: unknown,
  fallback: Omit<ShotgunErrorInput, 'cause'>,
): ShotgunError =>
  error instanceof ShotgunError
    ? error
    : new ShotgunError({
        ...fallback,
        cause: error,
      });
