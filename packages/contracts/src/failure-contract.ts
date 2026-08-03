import type { ErrorCode } from './errors.js';

export type FailureCategory =
  | 'AUTHENTICATION'
  | 'AUTHORIZATION'
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DEPENDENCY'
  | 'RATE_LIMIT'
  | 'TIMEOUT'
  | 'OUTCOME_UNKNOWN'
  | 'TERMINAL';

export type FailureRetryability = 'NEVER' | 'CONDITIONAL' | 'SAFE' | 'UNKNOWN';

export type FailureRecovery =
  | 'NONE'
  | 'REAUTHENTICATE'
  | 'REQUEST_ACCESS'
  | 'FIX_REQUEST'
  | 'REFRESH_AND_REAPPLY'
  | 'RETRY'
  | 'RETRY_AFTER'
  | 'RESOLVE_EXISTING_OUTCOME'
  | 'CONTACT_SUPPORT';

export type ProductFailureDetailKey =
  | 'expectedRevision'
  | 'actualRevision'
  | 'expectedDigest'
  | 'actualDigest'
  | 'resourceKind'
  | 'resourceId'
  | 'retryAfterSeconds';

export type ProductFailureDetailValue = string | number | boolean;

export type ProductFailureDetails = {
  [Code in ErrorCode]: Readonly<
    { readonly code: Code } & Partial<Record<ProductFailureDetailKey, ProductFailureDetailValue>>
  >;
}[ErrorCode];

export type FailureDescriptor = {
  readonly category: FailureCategory;
  readonly retryability: FailureRetryability;
  readonly recovery: FailureRecovery;
  readonly httpStatus: number;
  readonly allowedDetailKeys: readonly ProductFailureDetailKey[];
};

const failure = (
  category: FailureCategory,
  retryability: FailureRetryability,
  recovery: FailureRecovery,
  httpStatus: number,
  allowedDetailKeys: readonly ProductFailureDetailKey[] = [],
): FailureDescriptor => ({ category, retryability, recovery, httpStatus, allowedDetailKeys });

export const FAILURE_DESCRIPTORS = {
  AUTHENTICATION_REQUIRED: failure('AUTHENTICATION', 'NEVER', 'REAUTHENTICATE', 401),
  AUTHENTICATION_INVALID: failure('AUTHENTICATION', 'NEVER', 'REAUTHENTICATE', 401),
  AUTHORIZATION_DENIED: failure('AUTHORIZATION', 'NEVER', 'REQUEST_ACCESS', 403),
  PROJECT_CONTEXT_REQUIRED: failure('VALIDATION', 'NEVER', 'FIX_REQUEST', 400),
  PROJECT_ACCESS_DENIED: failure('AUTHORIZATION', 'NEVER', 'REQUEST_ACCESS', 403),
  LEGACY_SECURITY_HEADER_FORBIDDEN: failure('VALIDATION', 'NEVER', 'FIX_REQUEST', 400),
  REQUEST_ORIGIN_DENIED: failure('AUTHORIZATION', 'NEVER', 'NONE', 403),
  ACTION_SERVER_BINDING_REQUIRED: failure('VALIDATION', 'NEVER', 'FIX_REQUEST', 400),
  ACTION_REFERENCE_NOT_FOUND: failure('NOT_FOUND', 'NEVER', 'NONE', 404, [
    'resourceKind',
    'resourceId',
  ]),
  STALE_ACTION_SNAPSHOT: failure('CONFLICT', 'CONDITIONAL', 'REFRESH_AND_REAPPLY', 409, [
    'expectedRevision',
    'actualRevision',
  ]),
  ACTION_AUTHORIZATION_DENIED: failure('AUTHORIZATION', 'NEVER', 'REQUEST_ACCESS', 403),
  ACTION_CONNECTOR_NOT_ALLOWED: failure('AUTHORIZATION', 'NEVER', 'NONE', 403),
  VALIDATION_ERROR: failure('VALIDATION', 'NEVER', 'FIX_REQUEST', 400),
  POLICY_DENIED: failure('AUTHORIZATION', 'NEVER', 'REQUEST_ACCESS', 403),
  NOT_FOUND: failure('NOT_FOUND', 'NEVER', 'NONE', 404, ['resourceKind', 'resourceId']),
  CONFLICT: failure('CONFLICT', 'CONDITIONAL', 'REFRESH_AND_REAPPLY', 409),
  STALE_VERSION: failure('CONFLICT', 'CONDITIONAL', 'REFRESH_AND_REAPPLY', 409, [
    'expectedRevision',
    'actualRevision',
  ]),
  STALE_APPROVAL: failure('CONFLICT', 'CONDITIONAL', 'REFRESH_AND_REAPPLY', 409, [
    'expectedRevision',
    'actualRevision',
  ]),
  RETRYABLE_DEPENDENCY: failure('DEPENDENCY', 'SAFE', 'RETRY', 503),
  RATE_LIMITED: failure('RATE_LIMIT', 'SAFE', 'RETRY_AFTER', 429, ['retryAfterSeconds']),
  TIMEOUT: failure('TIMEOUT', 'CONDITIONAL', 'RETRY', 504),
  OUTCOME_UNKNOWN: failure('OUTCOME_UNKNOWN', 'UNKNOWN', 'RESOLVE_EXISTING_OUTCOME', 503),
  TERMINAL_FAILURE: failure('TERMINAL', 'UNKNOWN', 'CONTACT_SUPPORT', 500),
  UNSUPPORTED_SCHEMA: failure('VALIDATION', 'NEVER', 'FIX_REQUEST', 422),
  FORMAT_CORRUPT: failure('VALIDATION', 'NEVER', 'FIX_REQUEST', 422),
  FORMAT_ENCRYPTED: failure('VALIDATION', 'NEVER', 'FIX_REQUEST', 422),
  FORMAT_UNSUPPORTED: failure('VALIDATION', 'NEVER', 'FIX_REQUEST', 415),
  MULTIMODAL_VALIDATION_REQUIRED: failure('VALIDATION', 'CONDITIONAL', 'FIX_REQUEST', 422),
  REPLAY_BLOCKED: failure('CONFLICT', 'NEVER', 'NONE', 409),
  REVISION_CONFLICT: failure('CONFLICT', 'CONDITIONAL', 'REFRESH_AND_REAPPLY', 409, [
    'expectedRevision',
    'actualRevision',
  ]),
  DIGEST_MISMATCH: failure('CONFLICT', 'CONDITIONAL', 'REFRESH_AND_REAPPLY', 409, [
    'expectedDigest',
    'actualDigest',
  ]),
  RESOURCE_RETIRED: failure('NOT_FOUND', 'NEVER', 'NONE', 410, ['resourceKind', 'resourceId']),
  RESOURCE_PROJECT_MISMATCH: failure('VALIDATION', 'NEVER', 'FIX_REQUEST', 400, [
    'resourceKind',
    'resourceId',
  ]),
  PRECONDITION_ACCESS_DENIED: failure('AUTHORIZATION', 'NEVER', 'REQUEST_ACCESS', 403),
  POLICY_CONTEXT_CHANGED: failure('CONFLICT', 'CONDITIONAL', 'REFRESH_AND_REAPPLY', 409, [
    'expectedRevision',
    'actualRevision',
  ]),
  IDEMPOTENCY_KEY_REUSE_MISMATCH: failure('CONFLICT', 'NEVER', 'NONE', 409),
  SESSION_EXPIRED: failure('AUTHENTICATION', 'NEVER', 'REAUTHENTICATE', 401),
  LOCAL_PROJECT_SELECTION_REQUIRED: failure('CONFLICT', 'CONDITIONAL', 'REFRESH_AND_REAPPLY', 409),
  ZERO_PROJECT_PRECONDITION_FAILED: failure('CONFLICT', 'CONDITIONAL', 'REFRESH_AND_REAPPLY', 409),
  PROJECT_ACCESS_REVISION_CONFLICT: failure('CONFLICT', 'CONDITIONAL', 'REFRESH_AND_REAPPLY', 409, [
    'expectedRevision',
    'actualRevision',
  ]),
  CLIENT_REQUEST_MEANING_MISMATCH: failure('CONFLICT', 'NEVER', 'NONE', 409),
  PROJECT_BOOTSTRAP_ALREADY_COMPLETED: failure(
    'CONFLICT',
    'CONDITIONAL',
    'RESOLVE_EXISTING_OUTCOME',
    409,
  ),
  PROJECT_BOOTSTRAP_OUTCOME_UNKNOWN: failure(
    'OUTCOME_UNKNOWN',
    'UNKNOWN',
    'RESOLVE_EXISTING_OUTCOME',
    503,
  ),
  CAPABILITY_DENIED: failure('AUTHORIZATION', 'NEVER', 'REQUEST_ACCESS', 403),
  OUTCOME_INDETERMINATE: failure('OUTCOME_UNKNOWN', 'UNKNOWN', 'RESOLVE_EXISTING_OUTCOME', 503),
  RESOURCE_ACCESS_REVOKED: failure('AUTHORIZATION', 'NEVER', 'REQUEST_ACCESS', 403),
  RETENTION_EXPIRED: failure('NOT_FOUND', 'NEVER', 'NONE', 410),
  INVALID_REQUEST: failure('VALIDATION', 'NEVER', 'FIX_REQUEST', 400),
  INTERNAL_UNCLASSIFIED: failure('TERMINAL', 'UNKNOWN', 'CONTACT_SUPPORT', 500),
  // FE-P3-S2 Knowledge Draft typed API failures
  // (mirrors FRONTEND_KNOWLEDGE_DRAFT_API_FAILURES in frontend-knowledge-draft.ts).
  FORBIDDEN: failure('AUTHORIZATION', 'NEVER', 'REQUEST_ACCESS', 403),
  PROJECT_BINDING_CONFLICT: failure('CONFLICT', 'CONDITIONAL', 'REFRESH_AND_REAPPLY', 409),
  ACCESS_REVOKED: failure('AUTHORIZATION', 'NEVER', 'REQUEST_ACCESS', 403),
  BASE_UNAVAILABLE: failure('DEPENDENCY', 'NEVER', 'RETRY', 503),
  DRAFT_NOT_FOUND: failure('NOT_FOUND', 'NEVER', 'NONE', 404),
  DRAFT_REVISION_CONFLICT: failure('CONFLICT', 'CONDITIONAL', 'REFRESH_AND_REAPPLY', 409, [
    'expectedRevision',
    'actualRevision',
  ]),
  VALIDATION_FAILED: failure('VALIDATION', 'NEVER', 'FIX_REQUEST', 422),
  STALE: failure('CONFLICT', 'CONDITIONAL', 'REFRESH_AND_REAPPLY', 409),
  IMPACT_PARTIAL: failure('DEPENDENCY', 'NEVER', 'NONE', 409),
  ANALYZER_UNAVAILABLE: failure('DEPENDENCY', 'NEVER', 'RETRY', 503),
  NOT_READY_FOR_REVIEW: failure('DEPENDENCY', 'NEVER', 'NONE', 409),
  OUTCOME_NOT_FOUND: failure('NOT_FOUND', 'NEVER', 'NONE', 404),
  COMMAND_SCOPE_MISMATCH: failure('AUTHORIZATION', 'NEVER', 'REQUEST_ACCESS', 403),
  SEED_NOT_FOUND: failure('NOT_FOUND', 'NEVER', 'NONE', 404),
  SEED_ALREADY_MATERIALIZED: failure('CONFLICT', 'NEVER', 'NONE', 409),
  CANONICAL_SNAPSHOT_MISMATCH: failure('CONFLICT', 'CONDITIONAL', 'REFRESH_AND_REAPPLY', 409),
  RESOURCE_REVISION_MISSING: failure('VALIDATION', 'NEVER', 'FIX_REQUEST', 400),
  STALE_BASE: failure('CONFLICT', 'CONDITIONAL', 'REFRESH_AND_REAPPLY', 409),
  UNSUPPORTED_OPERATION: failure('VALIDATION', 'NEVER', 'FIX_REQUEST', 422),
  ARTIFACT_INCOMPLETE: failure('DEPENDENCY', 'NEVER', 'NONE', 409),
} satisfies Record<ErrorCode, FailureDescriptor>;

export const isErrorCode = (value: unknown): value is ErrorCode =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(FAILURE_DESCRIPTORS, value);

export const getFailureDescriptor = (code: ErrorCode): FailureDescriptor =>
  FAILURE_DESCRIPTORS[code];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isDetailValue = (value: unknown): value is ProductFailureDetailValue =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

export const sanitizeProductFailureDetails = (
  code: ErrorCode,
  value: unknown,
): ProductFailureDetails | undefined => {
  if (!isRecord(value)) return undefined;
  const allowedKeys = getFailureDescriptor(code).allowedDetailKeys;
  const safeDetails: Partial<Record<ProductFailureDetailKey, ProductFailureDetailValue>> = {};
  for (const key of allowedKeys) {
    const candidate = value[key];
    if (isDetailValue(candidate)) safeDetails[key] = candidate;
  }
  if (Object.keys(safeDetails).length === 0) return undefined;
  return { code, ...safeDetails } as ProductFailureDetails;
};

export type ProductFailureEnvelope = {
  readonly schemaVersion: '1.0.0';
  readonly code: ErrorCode;
  readonly category: FailureCategory;
  readonly retryability: FailureRetryability;
  readonly recovery: FailureRecovery;
  readonly message: string;
  readonly correlationId?: string;
  readonly details?: ProductFailureDetails;
};

export const createProductFailureEnvelope = (input: {
  readonly code: ErrorCode;
  readonly message: string;
  readonly correlationId?: string;
  readonly details?: unknown;
}): ProductFailureEnvelope => {
  const descriptor = getFailureDescriptor(input.code);
  const details = sanitizeProductFailureDetails(input.code, input.details);
  return {
    schemaVersion: '1.0.0',
    code: input.code,
    category: descriptor.category,
    retryability: descriptor.retryability,
    recovery: descriptor.recovery,
    message: input.message,
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    ...(details === undefined ? {} : { details }),
  };
};

export const decodeProductFailureEnvelope = (
  value: unknown,
): ProductFailureEnvelope | undefined => {
  if (!isRecord(value) || !isErrorCode(value.code) || typeof value.message !== 'string') {
    return undefined;
  }
  if (value.message.trim().length === 0) return undefined;
  if (value.correlationId !== undefined && typeof value.correlationId !== 'string') {
    return undefined;
  }

  const descriptor = getFailureDescriptor(value.code);
  if (value.schemaVersion !== undefined) {
    if (
      value.schemaVersion !== '1.0.0' ||
      value.category !== descriptor.category ||
      value.retryability !== descriptor.retryability ||
      value.recovery !== descriptor.recovery
    ) {
      return undefined;
    }
  }

  const details = sanitizeProductFailureDetails(value.code, value.details);
  if (value.details !== undefined && details === undefined) return undefined;
  return createProductFailureEnvelope({
    code: value.code,
    message: value.message,
    ...(value.correlationId === undefined ? {} : { correlationId: value.correlationId }),
    ...(details === undefined ? {} : { details }),
  });
};

export type FrontendFailureState =
  | 'STALE'
  | 'OUTCOME_UNKNOWN'
  | 'AUTHENTICATION_REQUIRED'
  | 'ACCESS_DENIED'
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'RETRYABLE_FAILURE'
  | 'APPLY_FAILED'
  | 'TERMINAL_FAILURE';

export type TypedFrontendFailure = {
  readonly code: ErrorCode;
  readonly category: FailureCategory;
  readonly retryability: FailureRetryability;
  readonly recovery: FailureRecovery;
  readonly state: FrontendFailureState;
};

export const deriveFrontendFailure = (code: ErrorCode): TypedFrontendFailure => {
  const descriptor = getFailureDescriptor(code);
  let state: FrontendFailureState;
  switch (descriptor.recovery) {
    case 'REFRESH_AND_REAPPLY':
      state = 'STALE';
      break;
    case 'RESOLVE_EXISTING_OUTCOME':
      state = 'OUTCOME_UNKNOWN';
      break;
    case 'REAUTHENTICATE':
      state = 'AUTHENTICATION_REQUIRED';
      break;
    case 'REQUEST_ACCESS':
      state = 'ACCESS_DENIED';
      break;
    case 'FIX_REQUEST':
      state = 'VALIDATION_FAILED';
      break;
    case 'RETRY':
    case 'RETRY_AFTER':
      state = 'RETRYABLE_FAILURE';
      break;
    case 'CONTACT_SUPPORT':
      state = 'TERMINAL_FAILURE';
      break;
    case 'NONE':
      state = descriptor.category === 'NOT_FOUND' ? 'NOT_FOUND' : 'APPLY_FAILED';
      break;
  }
  return {
    code,
    category: descriptor.category,
    retryability: descriptor.retryability,
    recovery: descriptor.recovery,
    state,
  };
};
