import type {
  ActivityActionKindV1,
  ActivityAdapterStatusV1,
  ActivityAttentionStateV1,
  ActivityFailureKindV1,
  ActivityLifecycleStateV1,
  ActivityProjectionFreshnessV1,
  ActivityRetryabilityV1,
  AskAnswerRunState,
  ExternalActionAggregateStatusV1,
  IntakeItemState,
  IntakeSubmissionState,
} from '../../../packages/contracts/src/index.js';

/**
 * FE-P5-S1 Domain-state mapping and separate projection dimensions.
 *
 * These pure functions map owning-Domain state into the common Activity
 * lifecycle and compute the separate dimensions (Progress, Attention,
 * Failure, Retryability, Projection Freshness, Adapter Availability) defined
 * by Contract Snapshot §5 and ADR-130 §4. They never touch persistence and
 * never author execution: the browser cannot infer authority from child rows.
 */

const SOURCES_ACTIVITY_STATES: Readonly<Record<IntakeSubmissionState, ActivityLifecycleStateV1>> = {
  VALIDATING: 'RUNNING',
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  PARTIAL: 'PARTIAL',
  ACTION_REQUIRED: 'WAITING_FOR_USER',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  CANCEL_REQUESTED: 'CANCEL_REQUESTED',
  CANCELLED: 'CANCELLED',
  OUTCOME_INDETERMINATE: 'OUTCOME_UNKNOWN',
};

const SOURCES_ITEM_ACTIVITY_STATES: Readonly<Record<IntakeItemState, ActivityLifecycleStateV1>> = {
  VALIDATING: 'RUNNING',
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  ACTION_REQUIRED: 'WAITING_FOR_USER',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  CANCEL_REQUESTED: 'CANCEL_REQUESTED',
  CANCELLED: 'CANCELLED',
  OUTCOME_INDETERMINATE: 'OUTCOME_UNKNOWN',
};

const ASK_ACTIVITY_STATES: Readonly<Record<AskAnswerRunState, ActivityLifecycleStateV1>> = {
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  STREAMING: 'RUNNING',
  ACTION_REQUIRED: 'WAITING_FOR_USER',
  PARTIAL: 'PARTIAL',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  CANCEL_REQUESTED: 'CANCEL_REQUESTED',
  CANCELLED: 'CANCELLED',
  OUTCOME_UNKNOWN: 'OUTCOME_UNKNOWN',
};

const EXTERNAL_ACTION_ACTIVITY_STATES: Readonly<
  Record<ExternalActionAggregateStatusV1, ActivityLifecycleStateV1>
> = {
  CANDIDATE_VALIDATED: 'QUEUED',
  MANIFEST_READY: 'QUEUED',
  APPROVED: 'QUEUED',
  PREFLIGHT_READY: 'QUEUED',
  PREFLIGHT_FAILED: 'FAILED',
  READY_TO_EXECUTE: 'QUEUED',
  EXECUTING: 'RUNNING',
  OUTCOME_UNKNOWN: 'OUTCOME_UNKNOWN',
  FAILED: 'FAILED',
  CANCELLING: 'CANCEL_REQUESTED',
  CANCELLED: 'CANCELLED',
  VERIFYING: 'RUNNING',
  VERIFIED: 'SUCCEEDED',
  VERIFICATION_FAILED: 'FAILED',
  ROLLBACK_AVAILABLE: 'WAITING_FOR_USER',
  ROLLING_BACK: 'RUNNING',
  ROLLED_BACK: 'SUCCEEDED',
  COMPENSATION_REQUIRED: 'WAITING_FOR_USER',
  COMPENSATING: 'RUNNING',
  COMPENSATED: 'SUCCEEDED',
};

/** Map a Sources IntakeSubmission state into the common Activity lifecycle. */
export const activityStateFromSourcesState = (
  state: IntakeSubmissionState,
): ActivityLifecycleStateV1 => SOURCES_ACTIVITY_STATES[state];

/** Map a Sources Intake item state into the common Activity lifecycle. */
export const activityStateFromSourcesItemState = (
  state: IntakeItemState,
): ActivityLifecycleStateV1 => SOURCES_ITEM_ACTIVITY_STATES[state];

/** Map an Ask AnswerRun state into the common Activity lifecycle. */
export const activityStateFromAskState = (state: AskAnswerRunState): ActivityLifecycleStateV1 =>
  ASK_ACTIVITY_STATES[state];

/** Map an External Action aggregate status into the common Activity lifecycle. */
export const activityStateFromExternalActionState = (
  state: ExternalActionAggregateStatusV1,
): ActivityLifecycleStateV1 => EXTERNAL_ACTION_ACTIVITY_STATES[state];

/** Retryability dimension from an owning-Domain retryable flag. */
export const activityRetryabilityFrom = (retryable: boolean | undefined): ActivityRetryabilityV1 =>
  retryable === undefined ? 'UNKNOWN' : retryable ? 'RETRYABLE' : 'NOT_RETRYABLE';

/**
 * Server-derived available actions (WP5 — Existing Domain action delegation).
 *
 * The owning Domain's capability flags decide which of Cancel/Retry may be
 * shown for an Activity; Activity never authors generic Retry/Cancel commands
 * (ADR-130 §3, Contract Snapshot §7, FE-P5-S1-AC-13). Deterministic order:
 * `CANCEL` before `RETRY`.
 */
export const activityAvailableActionsFrom = (input: {
  readonly cancel: boolean;
  readonly retry: boolean;
}): readonly ActivityActionKindV1[] => {
  const actions: ActivityActionKindV1[] = [];
  if (input.cancel) actions.push('CANCEL');
  if (input.retry) actions.push('RETRY');
  return actions;
};

/** Attention dimension from an owning-Domain attention reason. */
export const activityAttentionFrom = (
  attentionReason: string | undefined,
): ActivityAttentionStateV1 =>
  attentionReason === undefined || attentionReason.trim().length === 0 ? 'NONE' : 'NEEDS_ATTENTION';

export type ActivityFreshnessInput = {
  /** Owning-Domain last source update (undefined when the adapter has no observation). */
  readonly sourceUpdatedAt?: string;
  /** Time the projection snapshot was generated. */
  readonly projectedAt: string;
  /** Lag below which the projection is CURRENT (ms). */
  readonly currentWithinMs: number;
  /** Lag below which the projection is LAGGING (ms); beyond it is STALE. */
  readonly staleAfterMs: number;
};

/**
 * Projection Freshness dimension (Contract Snapshot §4.7 / ADR-130 §4).
 * Freshness is never a Domain lifecycle state.
 */
export const activityFreshnessFrom = (
  input: ActivityFreshnessInput,
): ActivityProjectionFreshnessV1 => {
  if (input.sourceUpdatedAt === undefined) return 'UNKNOWN';
  const sourceTime = Date.parse(input.sourceUpdatedAt);
  if (Number.isNaN(sourceTime)) return 'UNKNOWN';
  const projectedTime = Date.parse(input.projectedAt);
  if (Number.isNaN(projectedTime)) return 'UNKNOWN';
  const lag = Math.max(0, projectedTime - sourceTime);
  if (lag <= input.currentWithinMs) return 'CURRENT';
  if (lag <= input.staleAfterMs) return 'LAGGING';
  return 'STALE';
};

/** Adapter Availability dimension from adapter health. */
export const activityAdapterStatusFrom = (health: {
  readonly status: 'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE';
}): ActivityAdapterStatusV1 => health.status;

/**
 * Combine per-adapter availability for a partial federated result.
 * All available means AVAILABLE; all unavailable means UNAVAILABLE; any mix
 * (some accessible, some not) means DEGRADED — a partial result that never
 * erases the accessible adapters (Contract Snapshot §3, AC-10).
 */
export const combineAdapterAvailability = (
  statuses: readonly ActivityAdapterStatusV1[],
): ActivityAdapterStatusV1 => {
  if (statuses.length === 0) return 'UNAVAILABLE';
  if (statuses.every((status) => status === 'AVAILABLE')) return 'AVAILABLE';
  if (statuses.every((status) => status === 'UNAVAILABLE')) return 'UNAVAILABLE';
  return 'DEGRADED';
};

export type ActivityFailureInput = {
  readonly retryable: boolean;
  readonly outcomeUnknown: boolean;
  readonly cancelled: boolean;
};

/**
 * Safe failure kind classification. OUTCOME_UNKNOWN never auto-retries and is
 * distinct from a transient failure (ADR-130 §3, Contract Snapshot §9).
 */
export const activityFailureKindFrom = (input: ActivityFailureInput): ActivityFailureKindV1 => {
  if (input.cancelled) return 'CANCELLED';
  if (input.outcomeUnknown) return 'OUTCOME_UNKNOWN';
  return input.retryable ? 'TRANSIENT' : 'PERMANENT';
};
