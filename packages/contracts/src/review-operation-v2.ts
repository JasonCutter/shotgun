import { sha256Text, stableJson } from './document-evidence.js';

/** ADR-163 Product command contract.  This is deliberately independent from
 * the strict DraftChangeSetV2/ApprovedChangeSetManifestV2 schemas. */
export const RESOLVE_REVIEW_OPERATION_V2_CONTRACT_VERSION = '1.0.0' as const;

export type ResolveReviewOperationV2Operation = 'ADD_CLAIM' | 'NO_OP';

export type ResolveReviewOperationV2Request = {
  readonly changeSetId: string;
  readonly expectedDraftRevision: number;
  readonly expectedDraftDigest: string;
  readonly chosenOperation: ResolveReviewOperationV2Operation;
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
};

export type ResolveReviewOperationV2Result = {
  readonly status: 'RESOLVED' | 'IDEMPOTENT_REPLAY';
  readonly resolutionId: string;
  readonly changeSetId: string;
  readonly sourceDraftRevision: number;
  readonly resolvedDraftRevision: number;
  readonly resolvedDraftDigest: string;
  readonly chosenOperation: ResolveReviewOperationV2Operation;
  readonly reviewResourceId?: string;
};

export type ResolveReviewOperationV2FailureCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'PROJECT_SCOPE_MISMATCH'
  | 'INVALID_OPERATION'
  | 'DRAFT_NOT_ELIGIBLE'
  | 'DRAFT_REVISION_CONFLICT'
  | 'STALE_REVIEW_INPUT'
  | 'ACCESS_REVOKED'
  | 'POLICY_CHANGED'
  | 'RESOLUTION_CONFLICT'
  | 'IDEMPOTENCY_KEY_REUSE'
  | 'OUTCOME_UNKNOWN';

export type ResolveReviewOperationV2Outcome =
  | ResolveReviewOperationV2Result
  | { readonly status: 'BLOCKED'; readonly code: ResolveReviewOperationV2FailureCode };

/** Canonical command identity used by Review and by ConnectorRuntime
 * reconciliation.  It excludes timestamps and UI-only values. */
export const resolveReviewOperationV2CommandDigest = (
  request: ResolveReviewOperationV2Request,
): string =>
  sha256Text(
    stableJson({
      contractVersion: RESOLVE_REVIEW_OPERATION_V2_CONTRACT_VERSION,
      changeSetId: request.changeSetId,
      expectedDraftRevision: request.expectedDraftRevision,
      expectedDraftDigest: request.expectedDraftDigest,
      chosenOperation: request.chosenOperation,
      clientRequestId: request.clientRequestId,
      idempotencyKey: request.idempotencyKey,
    }),
  );

export const validateResolveReviewOperationV2Request = (
  value: unknown,
): asserts value is ResolveReviewOperationV2Request => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('ResolveReviewOperationV2 request must be an object.');
  }
  const request = value as Record<string, unknown>;
  const allowedKeys = new Set([
    'changeSetId',
    'expectedDraftRevision',
    'expectedDraftDigest',
    'chosenOperation',
    'clientRequestId',
    'idempotencyKey',
  ]);
  if (Object.keys(request).some((key) => !allowedKeys.has(key))) {
    throw new Error('ResolveReviewOperationV2 request contains an unknown field.');
  }
  const requiredStrings = [
    'changeSetId',
    'expectedDraftDigest',
    'clientRequestId',
    'idempotencyKey',
  ];
  for (const key of requiredStrings) {
    if (typeof request[key] !== 'string' || request[key].trim().length === 0) {
      throw new Error(`ResolveReviewOperationV2 ${key} must be non-empty.`);
    }
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(request.expectedDraftDigest as string)) {
    throw new Error('ResolveReviewOperationV2 expectedDraftDigest must be a SHA-256 digest.');
  }
  if (
    !Number.isInteger(request.expectedDraftRevision) ||
    (request.expectedDraftRevision as number) < 1
  ) {
    throw new Error('ResolveReviewOperationV2 expectedDraftRevision must be positive.');
  }
  if (request.chosenOperation !== 'ADD_CLAIM' && request.chosenOperation !== 'NO_OP') {
    throw new Error('ResolveReviewOperationV2 chosenOperation is invalid.');
  }
};
