import { describe, expect, it } from 'vitest';

import {
  activityAdapterStatusFrom,
  activityAttentionFrom,
  activityFailureKindFrom,
  activityFreshnessFrom,
  activityRetryabilityFrom,
  activityStateFromAskState,
  activityStateFromExternalActionState,
  activityStateFromSourcesItemState,
  activityStateFromSourcesState,
  combineAdapterAvailability,
} from '../../modules/frontend-activity/src/index.js';

/**
 * FE-P5-S1 WP1 — Domain-state mapping and separate projection dimensions.
 * Maps owning-Domain states into the common lifecycle without inventing
 * execution authority (Contract Snapshot §5, ADR-130 §4).
 */

describe('FE-P5-S1 Sources state mapping', () => {
  it('maps every IntakeSubmission state into the common lifecycle', () => {
    expect(activityStateFromSourcesState('VALIDATING')).toBe('RUNNING');
    expect(activityStateFromSourcesState('QUEUED')).toBe('QUEUED');
    expect(activityStateFromSourcesState('RUNNING')).toBe('RUNNING');
    expect(activityStateFromSourcesState('PARTIAL')).toBe('PARTIAL');
    expect(activityStateFromSourcesState('ACTION_REQUIRED')).toBe('WAITING_FOR_USER');
    expect(activityStateFromSourcesState('SUCCEEDED')).toBe('SUCCEEDED');
    expect(activityStateFromSourcesState('FAILED')).toBe('FAILED');
    expect(activityStateFromSourcesState('CANCEL_REQUESTED')).toBe('CANCEL_REQUESTED');
    expect(activityStateFromSourcesState('CANCELLED')).toBe('CANCELLED');
    expect(activityStateFromSourcesState('OUTCOME_INDETERMINATE')).toBe('OUTCOME_UNKNOWN');
  });

  it('maps Intake item states without a partial state', () => {
    expect(activityStateFromSourcesItemState('VALIDATING')).toBe('RUNNING');
    expect(activityStateFromSourcesItemState('ACTION_REQUIRED')).toBe('WAITING_FOR_USER');
    expect(activityStateFromSourcesItemState('OUTCOME_INDETERMINATE')).toBe('OUTCOME_UNKNOWN');
  });
});

describe('FE-P5-S1 Ask state mapping', () => {
  it('maps every AnswerRun state into the common lifecycle', () => {
    expect(activityStateFromAskState('QUEUED')).toBe('QUEUED');
    expect(activityStateFromAskState('RUNNING')).toBe('RUNNING');
    expect(activityStateFromAskState('STREAMING')).toBe('RUNNING');
    expect(activityStateFromAskState('ACTION_REQUIRED')).toBe('WAITING_FOR_USER');
    expect(activityStateFromAskState('PARTIAL')).toBe('PARTIAL');
    expect(activityStateFromAskState('SUCCEEDED')).toBe('SUCCEEDED');
    expect(activityStateFromAskState('FAILED')).toBe('FAILED');
    expect(activityStateFromAskState('CANCEL_REQUESTED')).toBe('CANCEL_REQUESTED');
    expect(activityStateFromAskState('CANCELLED')).toBe('CANCELLED');
    expect(activityStateFromAskState('OUTCOME_UNKNOWN')).toBe('OUTCOME_UNKNOWN');
  });

  it('never invents a Job for Ask (Run remains the root)', () => {
    expect(activityStateFromAskState('SUCCEEDED')).toBe('SUCCEEDED');
  });
});

describe('FE-P5-S1 External Action state mapping', () => {
  it('maps pre-execution aggregate states to QUEUED', () => {
    expect(activityStateFromExternalActionState('CANDIDATE_VALIDATED')).toBe('QUEUED');
    expect(activityStateFromExternalActionState('MANIFEST_READY')).toBe('QUEUED');
    expect(activityStateFromExternalActionState('APPROVED')).toBe('QUEUED');
    expect(activityStateFromExternalActionState('PREFLIGHT_READY')).toBe('QUEUED');
    expect(activityStateFromExternalActionState('READY_TO_EXECUTE')).toBe('QUEUED');
  });

  it('maps executing and verifying to RUNNING', () => {
    expect(activityStateFromExternalActionState('EXECUTING')).toBe('RUNNING');
    expect(activityStateFromExternalActionState('VERIFYING')).toBe('RUNNING');
    expect(activityStateFromExternalActionState('ROLLING_BACK')).toBe('RUNNING');
    expect(activityStateFromExternalActionState('COMPENSATING')).toBe('RUNNING');
  });

  it('maps user-decision aggregates to WAITING_FOR_USER', () => {
    expect(activityStateFromExternalActionState('ROLLBACK_AVAILABLE')).toBe('WAITING_FOR_USER');
    expect(activityStateFromExternalActionState('COMPENSATION_REQUIRED')).toBe('WAITING_FOR_USER');
  });

  it('maps terminal aggregates to SUCCEEDED or FAILED', () => {
    expect(activityStateFromExternalActionState('VERIFIED')).toBe('SUCCEEDED');
    expect(activityStateFromExternalActionState('ROLLED_BACK')).toBe('SUCCEEDED');
    expect(activityStateFromExternalActionState('COMPENSATED')).toBe('SUCCEEDED');
    expect(activityStateFromExternalActionState('FAILED')).toBe('FAILED');
    expect(activityStateFromExternalActionState('PREFLIGHT_FAILED')).toBe('FAILED');
    expect(activityStateFromExternalActionState('VERIFICATION_FAILED')).toBe('FAILED');
  });

  it('maps cancel and outcome states distinctly', () => {
    expect(activityStateFromExternalActionState('CANCELLING')).toBe('CANCEL_REQUESTED');
    expect(activityStateFromExternalActionState('CANCELLED')).toBe('CANCELLED');
    expect(activityStateFromExternalActionState('OUTCOME_UNKNOWN')).toBe('OUTCOME_UNKNOWN');
  });
});

describe('FE-P5-S1 separate projection dimensions', () => {
  it('computes retryability from the owning-Domain flag', () => {
    expect(activityRetryabilityFrom(true)).toBe('RETRYABLE');
    expect(activityRetryabilityFrom(false)).toBe('NOT_RETRYABLE');
    expect(activityRetryabilityFrom(undefined)).toBe('UNKNOWN');
  });

  it('computes attention from an attention reason', () => {
    expect(activityAttentionFrom('needs review')).toBe('NEEDS_ATTENTION');
    expect(activityAttentionFrom(undefined)).toBe('NONE');
    expect(activityAttentionFrom('   ')).toBe('NONE');
  });

  it('computes projection freshness with thresholds', () => {
    const projectedAt = '2026-08-06T00:10:00.000Z';
    expect(
      activityFreshnessFrom({
        sourceUpdatedAt: '2026-08-06T00:09:55.000Z',
        projectedAt,
        currentWithinMs: 10_000,
        staleAfterMs: 60_000,
      }),
    ).toBe('CURRENT');
    expect(
      activityFreshnessFrom({
        sourceUpdatedAt: '2026-08-06T00:09:30.000Z',
        projectedAt,
        currentWithinMs: 10_000,
        staleAfterMs: 60_000,
      }),
    ).toBe('LAGGING');
    expect(
      activityFreshnessFrom({
        sourceUpdatedAt: '2026-08-06T00:08:00.000Z',
        projectedAt,
        currentWithinMs: 10_000,
        staleAfterMs: 60_000,
      }),
    ).toBe('STALE');
  });

  it('returns UNKNOWN freshness when the source observation is missing', () => {
    expect(
      activityFreshnessFrom({
        sourceUpdatedAt: undefined,
        projectedAt: '2026-08-06T00:10:00.000Z',
        currentWithinMs: 10_000,
        staleAfterMs: 60_000,
      }),
    ).toBe('UNKNOWN');
  });

  it('maps adapter health to the availability dimension', () => {
    expect(activityAdapterStatusFrom({ status: 'AVAILABLE' })).toBe('AVAILABLE');
    expect(activityAdapterStatusFrom({ status: 'DEGRADED' })).toBe('DEGRADED');
    expect(activityAdapterStatusFrom({ status: 'UNAVAILABLE' })).toBe('UNAVAILABLE');
  });

  it('combines partial adapter availability without erasing accessible results', () => {
    expect(combineAdapterAvailability(['AVAILABLE', 'DEGRADED', 'AVAILABLE'])).toBe('DEGRADED');
    expect(combineAdapterAvailability(['AVAILABLE', 'UNAVAILABLE'])).toBe('DEGRADED');
    expect(combineAdapterAvailability(['UNAVAILABLE', 'UNAVAILABLE'])).toBe('UNAVAILABLE');
    expect(combineAdapterAvailability(['AVAILABLE', 'AVAILABLE'])).toBe('AVAILABLE');
    expect(combineAdapterAvailability([])).toBe('UNAVAILABLE');
  });

  it('classifies safe failure kinds distinctly', () => {
    expect(
      activityFailureKindFrom({ retryable: true, outcomeUnknown: false, cancelled: false }),
    ).toBe('TRANSIENT');
    expect(
      activityFailureKindFrom({ retryable: false, outcomeUnknown: false, cancelled: false }),
    ).toBe('PERMANENT');
    expect(
      activityFailureKindFrom({ retryable: false, outcomeUnknown: true, cancelled: false }),
    ).toBe('OUTCOME_UNKNOWN');
    expect(
      activityFailureKindFrom({ retryable: true, outcomeUnknown: false, cancelled: true }),
    ).toBe('CANCELLED');
  });
});
