import type { ErrorCode } from './errors.js';
import type { ExternalActionFailureReasonV1 } from './frontend-external-action.js';
import { EXTERNAL_ACTION_FAILURE_REASONS } from './frontend-external-action.js';

/**
 * FE-P4-S2 External Action typed failure mapping. Every
 * `ExternalActionFailureReasonV1` maps to a typed failure with a normalized
 * code, an HTTP status, retryability and a human message. Inaccessible
 * resources fail closed without confirming existence.
 */

export type ExternalActionFailureKind = 'EXTERNAL_ACTION';

export type ExternalActionFailureMapping = {
  readonly reason: ExternalActionFailureReasonV1;
  readonly normalizedCode: ErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly message: string;
};

export const EXTERNAL_ACTION_FAILURE_MAPPINGS: readonly ExternalActionFailureMapping[] = [
  {
    reason: 'EXTERNAL_ACTION_NOT_FOUND',
    normalizedCode: 'EXTERNAL_ACTION_NOT_FOUND',
    httpStatus: 404,
    retryable: false,
    message: 'The External Action was not found.',
  },
  {
    reason: 'EXTERNAL_ACTION_STALE',
    normalizedCode: 'EXTERNAL_ACTION_STALE',
    httpStatus: 409,
    retryable: true,
    message: 'The External Action revision no longer matches the server revision.',
  },
  {
    reason: 'ACTION_MANIFEST_CHANGED',
    normalizedCode: 'ACTION_MANIFEST_CHANGED',
    httpStatus: 409,
    retryable: true,
    message: 'The Action Manifest changed and re-approval is required.',
  },
  {
    reason: 'ACTION_MANIFEST_NOT_READY',
    normalizedCode: 'ACTION_MANIFEST_NOT_READY',
    httpStatus: 409,
    retryable: false,
    message: 'The Action Manifest is not ready for the requested operation.',
  },
  {
    reason: 'ACTION_APPROVAL_EXPIRED',
    normalizedCode: 'ACTION_APPROVAL_EXPIRED',
    httpStatus: 410,
    retryable: false,
    message: 'The External Action approval has expired.',
  },
  {
    reason: 'ACTION_APPROVAL_INVALID',
    normalizedCode: 'ACTION_APPROVAL_INVALID',
    httpStatus: 409,
    retryable: false,
    message: 'The External Action approval is no longer valid.',
  },
  {
    reason: 'ACTION_APPROVAL_REQUIRED',
    normalizedCode: 'ACTION_APPROVAL_REQUIRED',
    httpStatus: 403,
    retryable: false,
    message: 'Approval is required before this External Action can proceed.',
  },
  {
    reason: 'ACTION_PREFLIGHT_FAILED',
    normalizedCode: 'ACTION_PREFLIGHT_FAILED',
    httpStatus: 409,
    retryable: false,
    message: 'The External Action Preflight did not pass.',
  },
  {
    reason: 'ACTION_PREFLIGHT_EXPIRED',
    normalizedCode: 'ACTION_PREFLIGHT_EXPIRED',
    httpStatus: 410,
    retryable: false,
    message: 'The External Action Preflight has expired.',
  },
  {
    reason: 'ACTION_BUDGET_EXCEEDED',
    normalizedCode: 'ACTION_BUDGET_EXCEEDED',
    httpStatus: 409,
    retryable: false,
    message: 'The External Action execution budget is exhausted.',
  },
  {
    reason: 'ACTION_CREDENTIAL_UNAVAILABLE',
    normalizedCode: 'ACTION_CREDENTIAL_UNAVAILABLE',
    httpStatus: 403,
    retryable: false,
    message: 'The External Action credential is unavailable for the current scope.',
  },
  {
    reason: 'ACTION_EXECUTION_NOT_ALLOWED',
    normalizedCode: 'ACTION_EXECUTION_NOT_ALLOWED',
    httpStatus: 403,
    retryable: false,
    message: 'The current scope does not allow this External Action execution.',
  },
  {
    reason: 'ACTION_CANCEL_NOT_ALLOWED',
    normalizedCode: 'ACTION_CANCEL_NOT_ALLOWED',
    httpStatus: 409,
    retryable: false,
    message: 'The External Action cannot be cancelled in its current state.',
  },
  {
    reason: 'ACTION_ROLLBACK_NOT_AVAILABLE',
    normalizedCode: 'ACTION_ROLLBACK_NOT_AVAILABLE',
    httpStatus: 409,
    retryable: false,
    message: 'Rollback is not available for this External Action.',
  },
  {
    reason: 'ACTION_VERIFICATION_MISMATCH',
    normalizedCode: 'ACTION_VERIFICATION_MISMATCH',
    httpStatus: 409,
    retryable: false,
    message: 'The external Target State did not match the expected state.',
  },
  {
    reason: 'ACTION_VERIFICATION_REQUIRED',
    normalizedCode: 'ACTION_VERIFICATION_REQUIRED',
    httpStatus: 409,
    retryable: false,
    message: 'Verification of the external Target State is required.',
  },
  {
    reason: 'ACTION_OUTCOME_UNKNOWN',
    normalizedCode: 'ACTION_OUTCOME_UNKNOWN',
    httpStatus: 503,
    retryable: false,
    message:
      'The External Action outcome is unknown; resolve it through the original command identity.',
  },
  {
    reason: 'ACTION_OUTCOME_NOT_FOUND',
    normalizedCode: 'ACTION_OUTCOME_NOT_FOUND',
    httpStatus: 404,
    retryable: false,
    message: 'The External Action command outcome was not found.',
  },
  {
    reason: 'ACTION_COMMAND_SCOPE_MISMATCH',
    normalizedCode: 'ACTION_COMMAND_SCOPE_MISMATCH',
    httpStatus: 400,
    retryable: false,
    message: 'The External Action command belongs to another Project scope.',
  },
  {
    reason: 'EXTERNAL_TARGET_CHANGED',
    normalizedCode: 'EXTERNAL_TARGET_CHANGED',
    httpStatus: 409,
    retryable: true,
    message: 'The external target changed since this External Action was prepared.',
  },
  {
    reason: 'ACTION_COMPENSATION_REQUIRED',
    normalizedCode: 'ACTION_COMPENSATION_REQUIRED',
    httpStatus: 409,
    retryable: false,
    message: 'A Compensating Action is required to recover this External Action.',
  },
  {
    reason: 'ACTION_BUDGET_NOT_READABLE',
    normalizedCode: 'ACTION_BUDGET_NOT_READABLE',
    httpStatus: 403,
    retryable: false,
    message: 'The current scope cannot read the External Action execution budget.',
  },
];

const byReason = new Map(
  EXTERNAL_ACTION_FAILURE_MAPPINGS.map((mapping) => [mapping.reason, mapping]),
);

export const externalActionFailureMappingFor = (
  reason: ExternalActionFailureReasonV1,
): ExternalActionFailureMapping | undefined => byReason.get(reason);

export { EXTERNAL_ACTION_FAILURE_REASONS };
