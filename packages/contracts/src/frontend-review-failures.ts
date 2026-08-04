import { FrontendContractError } from './frontend-foundation.js';
import type { ReviewFailureReasonV1 } from './frontend-review.js';
import { REVIEW_FAILURE_REASONS } from './frontend-review.js';

/**
 * FE-P4-S1 Review Center typed failure mapping. Every `ReviewFailureReasonV1`
 * maps to a typed failure with a normalized code, an HTTP status,
 * retryability and a human message. Inaccessible resources fail closed
 * without confirming existence.
 */

export type ReviewFailureKind = 'REVIEW';

export type ReviewFailureMapping = {
  readonly reason: ReviewFailureReasonV1;
  readonly normalizedCode: string;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly message: string;
};

export const REVIEW_FAILURE_MAPPINGS: readonly ReviewFailureMapping[] = [
  {
    reason: 'REVIEW_CONTEXT_NOT_FOUND',
    normalizedCode: 'REVIEW_CONTEXT_NOT_FOUND',
    httpStatus: 404,
    retryable: false,
    message: 'The Review Context was not found.',
  },
  {
    reason: 'REVIEW_CONTEXT_STALE',
    normalizedCode: 'REVIEW_CONTEXT_STALE',
    httpStatus: 409,
    retryable: true,
    message: 'The Review Context revision no longer matches the server revision.',
  },
  {
    reason: 'REVIEW_TARGET_CHANGED',
    normalizedCode: 'REVIEW_TARGET_CHANGED',
    httpStatus: 409,
    retryable: true,
    message: 'The reviewed target changed since this Review Context was generated.',
  },
  {
    reason: 'REVIEW_ITEM_NOT_FOUND',
    normalizedCode: 'REVIEW_ITEM_NOT_FOUND',
    httpStatus: 404,
    retryable: false,
    message: 'The Review Item was not found in this Context revision.',
  },
  {
    reason: 'REVIEW_DECISION_NOT_ALLOWED',
    normalizedCode: 'REVIEW_DECISION_NOT_ALLOWED',
    httpStatus: 409,
    retryable: false,
    message: 'The decision is not allowed for the requested Review Item.',
  },
  {
    reason: 'REVIEW_DEPENDENCY_UNSATISFIED',
    normalizedCode: 'REVIEW_DEPENDENCY_UNSATISFIED',
    httpStatus: 409,
    retryable: false,
    message: 'A REQUIRES prerequisite is missing from the proposed approval set.',
  },
  {
    reason: 'REVIEW_ATOMIC_GROUP_SPLIT',
    normalizedCode: 'REVIEW_ATOMIC_GROUP_SPLIT',
    httpStatus: 409,
    retryable: false,
    message: 'An ATOMIC_WITH group cannot be split.',
  },
  {
    reason: 'REVIEW_CONFLICTING_APPROVAL_SET',
    normalizedCode: 'REVIEW_CONFLICTING_APPROVAL_SET',
    httpStatus: 409,
    retryable: false,
    message: 'The proposed approval set includes a CONFLICTS_WITH pair.',
  },
  {
    reason: 'REVIEW_DANGLING_REFERENCE',
    normalizedCode: 'REVIEW_DANGLING_REFERENCE',
    httpStatus: 409,
    retryable: false,
    message: 'The proposed approval set would leave a dangling reference.',
  },
  {
    reason: 'REVIEW_EVIDENCE_CHANGED',
    normalizedCode: 'REVIEW_EVIDENCE_CHANGED',
    httpStatus: 409,
    retryable: true,
    message: 'The Evidence artifact changed since this Review Context was generated.',
  },
  {
    reason: 'REVIEW_POLICY_CHANGED',
    normalizedCode: 'REVIEW_POLICY_CHANGED',
    httpStatus: 409,
    retryable: true,
    message: 'The policy context changed since this Review Context was generated.',
  },
  {
    reason: 'REVIEW_ACCESS_CHANGED',
    normalizedCode: 'REVIEW_ACCESS_CHANGED',
    httpStatus: 403,
    retryable: false,
    message: 'The access scope changed since this Review Context was generated.',
  },
  {
    reason: 'REVIEW_APPROVAL_NOT_ISSUED',
    normalizedCode: 'REVIEW_APPROVAL_NOT_ISSUED',
    httpStatus: 409,
    retryable: false,
    message: 'The approval eligibility was not satisfied for the approved Item set.',
  },
  {
    reason: 'REVIEW_APPROVAL_EXPIRED',
    normalizedCode: 'REVIEW_APPROVAL_EXPIRED',
    httpStatus: 410,
    retryable: false,
    message: 'The Approval Resource has expired.',
  },
  {
    reason: 'REVIEW_REVISION_ROUTE_UNAVAILABLE',
    normalizedCode: 'REVIEW_REVISION_ROUTE_UNAVAILABLE',
    httpStatus: 409,
    retryable: false,
    message: 'The revision-request return route is not available for this target.',
  },
  {
    reason: 'EXTERNAL_ACTION_REVIEW_REQUIRES_FE_P4_S2',
    normalizedCode: 'EXTERNAL_ACTION_REVIEW_REQUIRES_FE_P4_S2',
    httpStatus: 422,
    retryable: false,
    message: 'External Action review requires FE-P4-S2.',
  },
];

export const reviewFailureForReason = (reason: ReviewFailureReasonV1): ReviewFailureMapping => {
  const mapping = REVIEW_FAILURE_MAPPINGS.find((entry) => entry.reason === reason);
  if (!mapping) {
    throw new FrontendContractError('INVALID_REQUEST', `No review failure mapping for ${reason}`);
  }
  return mapping;
};

export const reviewFailureApiCode = (reason: ReviewFailureReasonV1): string =>
  reviewFailureForReason(reason).normalizedCode;

export const isReviewFailureReason = (value: unknown): value is ReviewFailureReasonV1 =>
  typeof value === 'string' && REVIEW_FAILURE_REASONS.includes(value as ReviewFailureReasonV1);
