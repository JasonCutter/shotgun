import type { ComparisonV2ReviewBridgeBlockedReason } from '../../../../modules/change-set-review/src/index.js';
import type { ErrorCode } from '../../../../packages/contracts/src/index.js';

export type ComparisonV2ReviewProductFailure = {
  readonly code: ErrorCode;
  readonly message: string;
};

const STALE_REVIEW_MESSAGE =
  'This Review is no longer fresh. Refresh or recompare the Candidate before approving it.';

/**
 * Converts the domain-only V2 Review bridge outcome into the shared Product
 * failure contract. The bridge deliberately returns a small reason union so
 * the Product boundary must own the public error vocabulary and never expose
 * a raw `{ status, reason }` object to browser clients.
 */
const REVIEW_V2_FAILURES = {
  INVALID_REQUEST: {
    code: 'INVALID_REQUEST',
    message: 'The v2 Review decision request is invalid.',
  },
  AUTHORITY_NOT_ACTIVE: {
    code: 'REVIEW_DEPENDENCY_UNSATISFIED',
    message: 'The Comparison V2 Review authority is not active.',
  },
  AUTHORITY_CONFLICT: {
    code: 'REVIEW_POLICY_CHANGED',
    message: 'The Comparison V2 Review authority changed. Refresh before retrying.',
  },
  AGGREGATE_NOT_FOUND: {
    code: 'REVIEW_CONTEXT_NOT_FOUND',
    message: 'The Comparison V2 Review context was not found.',
  },
  AGGREGATE_INVALID: {
    code: 'VALIDATION_ERROR',
    message: 'The Comparison V2 Review data is invalid.',
  },
  EVENT_LINEAGE_MISMATCH: {
    code: 'REVIEW_TARGET_CHANGED',
    message: 'The reviewed target changed. Refresh before retrying.',
  },
  ACCESS_DENIED: {
    code: 'REVIEW_ACCESS_CHANGED',
    message: 'Review access changed. Refresh before retrying.',
  },
  FRESHNESS_UNAVAILABLE: {
    code: 'REVIEW_CONTEXT_STALE',
    message: STALE_REVIEW_MESSAGE,
  },
  STALE_COMPARISON: {
    code: 'REVIEW_CONTEXT_STALE',
    message: STALE_REVIEW_MESSAGE,
  },
  REVIEW_NOT_ELIGIBLE: {
    code: 'REVIEW_DECISION_NOT_ALLOWED',
    message: 'The decision is not allowed for this Review item.',
  },
  DECISION_UNAVAILABLE: {
    code: 'REVIEW_DEPENDENCY_UNSATISFIED',
    message: 'The Review decision dependency is unavailable. Refresh before retrying.',
  },
  DECISION_CONFLICT: {
    code: 'REVIEW_DECISION_NOT_ALLOWED',
    message: 'The decision conflicts with the current Review state.',
  },
  DECISION_STALE: {
    code: 'REVIEW_CONTEXT_STALE',
    message: STALE_REVIEW_MESSAGE,
  },
} satisfies Record<ComparisonV2ReviewBridgeBlockedReason, ComparisonV2ReviewProductFailure>;

export const comparisonV2ReviewProductFailure = (
  reason: ComparisonV2ReviewBridgeBlockedReason,
): ComparisonV2ReviewProductFailure => REVIEW_V2_FAILURES[reason];
