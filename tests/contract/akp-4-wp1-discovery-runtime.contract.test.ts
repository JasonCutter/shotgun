import { describe, expect, it } from 'vitest';

import {
  assertDiscoveryRuntimeLifecycleTransitionV1,
  assertDiscoveryRuntimeStageTransitionV1,
  createDiscoveryLogicalJobIdentityV1,
  decodeDiscoveryAttemptV1,
  decodeDiscoveryJobV1,
  decodeDiscoveryRuntimeBudgetBindingV1,
  decodeDiscoveryTriggerV1,
  discoveryStageOrdinalV1,
  type DiscoveryRuntimeBudgetBindingV1,
  type DiscoveryCanonicalCommittedTriggerV1,
  type DiscoveryJobV1,
} from '../../packages/contracts/src/index.js';

const budget = (): DiscoveryRuntimeBudgetBindingV1 => ({
  schemaVersion: '1.0.0',
  budgetVersion: 'discovery-work-budget:v1',
  budgetId: 'budget-project-1',
  budgetRevision: 'budget-revision-3',
  maxResources: 100,
  maxSemanticNeighbors: 100,
  maxCandidatePairs: 40,
  maxCandidateGroups: 20,
  maxFindings: 20,
  maxProviderCalls: 10,
  maxInputTokens: 10_000,
  maxOutputTokens: 5_000,
  maxOutputTokensPerCall: 1_000,
  maxEstimatedCostMicros: 25_000,
  maxConcurrentProviderCalls: 2,
  deadlineAt: '2099-01-01T00:00:00.000Z',
});

const trigger = (
  overrides: Partial<DiscoveryCanonicalCommittedTriggerV1> = {},
): DiscoveryCanonicalCommittedTriggerV1 => ({
  schemaVersion: '1.0.0',
  triggerId: 'trigger-1',
  triggerClass: 'CANONICAL_COMMITTED',
  triggerIdentity: {
    kind: 'CANONICAL_COMMITTED',
    eventId: 'canonical-event-1',
    eventRevision: 'event-revision-4',
  },
  projectId: 'project-1',
  requestedScanMode: 'INCREMENTAL',
  effectiveScanMode: 'INCREMENTAL',
  requestedMode: 'FULL',
  effectiveMode: 'FULL',
  canonicalBase: {
    schemaVersion: '1.0.0',
    canonicalVersion: 12,
    snapshotDigest: 'sha256:canonical-12',
  },
  requiredDiscoveryBase: {
    schemaVersion: '1.0.0',
    projectionRevision: 'discovery-12',
    projectionDigest: 'sha256:discovery-12',
  },
  policyRevision: 'policy-7',
  strategyRevision: 'strategy-5',
  profileBinding: { profileId: 'profile-1', profileRevision: 3 },
  createdAt: '2026-08-30T00:00:00.000Z',
  observedAt: '2026-08-30T00:00:01.000Z',
  causationId: 'cause-1',
  correlationId: 'correlation-1',
  ...overrides,
});

const runtimeJob = (nextTrigger = trigger()): DiscoveryJobV1 => ({
  schemaVersion: '1.0.0',
  jobId: 'job-1',
  logicalIdentity: createDiscoveryLogicalJobIdentityV1(nextTrigger),
  projectId: nextTrigger.projectId,
  trigger: nextTrigger,
  requestedScanMode: nextTrigger.requestedScanMode,
  effectiveScanMode: nextTrigger.effectiveScanMode,
  requestedMode: nextTrigger.requestedMode,
  effectiveMode: nextTrigger.effectiveMode,
  canonicalBase: nextTrigger.canonicalBase,
  requiredDiscoveryBase: nextTrigger.requiredDiscoveryBase,
  policyRevision: nextTrigger.policyRevision,
  strategyRevision: nextTrigger.strategyRevision,
  profileBinding: nextTrigger.profileBinding,
  budget: budget(),
  lifecycleState: 'QUEUED',
  lifecycleRevision: 1,
  createdAt: '2026-08-30T00:00:00.000Z',
  updatedAt: '2026-08-30T00:00:00.000Z',
});

describe('AKP-4 WP1 Discovery runtime contracts', () => {
  it('decodes all server-owned trigger classes and keeps manual actor identity scoped', () => {
    expect(decodeDiscoveryTriggerV1(trigger()).triggerClass).toBe('CANONICAL_COMMITTED');
    expect(
      decodeDiscoveryTriggerV1({
        ...trigger(),
        triggerClass: 'SCHEDULED_FULL_SCAN',
        requestedScanMode: 'FULL_SCAN',
        effectiveScanMode: 'FULL_SCAN',
        triggerIdentity: {
          kind: 'SCHEDULED_FULL_SCAN',
          scheduleId: 'weekly-scan',
          scheduleRevision: 'schedule-2',
          occurrenceKey: '2026-W35',
        },
      }).triggerIdentity,
    ).toMatchObject({ scheduleId: 'weekly-scan' });
    const manual = decodeDiscoveryTriggerV1({
      ...trigger(),
      triggerClass: 'MANUAL',
      triggerIdentity: { kind: 'MANUAL', commandId: 'command-1', requestId: 'request-1' },
      actor: { actorId: 'actor-1', principalId: 'principal-1' },
    });
    expect(manual).toMatchObject({
      actor: { actorId: 'actor-1', principalId: 'principal-1' },
    });
    expect(() => decodeDiscoveryTriggerV1({ ...trigger(), apiKey: 'secret' })).toThrow(
      /unknown field/i,
    );
    expect(() =>
      decodeDiscoveryTriggerV1({
        ...trigger(),
        actor: { actorId: 'actor-1', principalId: 'principal-1' },
      }),
    ).toThrow(/only for MANUAL/);
    expect(() =>
      decodeDiscoveryTriggerV1({ ...trigger(), requestedScanMode: 'FULL_SCAN' }),
    ).toThrow(/must use INCREMENTAL/);
    expect(() =>
      decodeDiscoveryTriggerV1({
        ...trigger(),
        triggerClass: 'SCHEDULED_FULL_SCAN',
        requestedScanMode: 'INCREMENTAL',
        effectiveScanMode: 'INCREMENTAL',
        triggerIdentity: {
          kind: 'SCHEDULED_FULL_SCAN',
          scheduleId: 'weekly-scan',
          scheduleRevision: 'schedule-2',
          occurrenceKey: '2026-W35',
        },
      }),
    ).toThrow(/must use FULL_SCAN/);
    expect(
      decodeDiscoveryTriggerV1({
        ...trigger(),
        triggerClass: 'MANUAL',
        triggerIdentity: { kind: 'MANUAL', commandId: 'command-2', requestId: 'request-2' },
        requestedScanMode: 'FULL_SCAN',
        effectiveScanMode: 'FULL_SCAN',
        actor: { actorId: 'actor-1', principalId: 'principal-1' },
      }).effectiveScanMode,
    ).toBe('FULL_SCAN');
  });

  it('derives a deterministic, versioned logical identity without physical timestamps', () => {
    const first = createDiscoveryLogicalJobIdentityV1(trigger());
    const second = createDiscoveryLogicalJobIdentityV1({
      ...trigger(),
      triggerId: 'different-physical-observation',
      createdAt: '2030-01-01T00:00:00.000Z',
      observedAt: '2030-01-01T00:00:01.000Z',
    });
    expect(first).toEqual(second);
    expect(first.identityVersion).toBe('discovery-job-logical:v1');
    expect(
      createDiscoveryLogicalJobIdentityV1({
        ...trigger(),
        triggerIdentity: {
          kind: 'CANONICAL_COMMITTED',
          eventId: 'canonical-event-2',
          eventRevision: 'event-revision-4',
        },
      }),
    ).not.toEqual(first);
  });

  it('recomputes Job identity and rejects top-level binding or projection-wait tampering', () => {
    const base = runtimeJob();
    expect(() =>
      decodeDiscoveryJobV1({
        ...base,
        logicalIdentity: { ...base.logicalIdentity, value: 'arbitrary-identity' },
      }),
    ).toThrow(/recomputed/);
    expect(() => decodeDiscoveryJobV1({ ...base, policyRevision: 'policy-tampered' })).toThrow(
      /must match trigger binding/,
    );
    expect(() =>
      decodeDiscoveryJobV1({
        ...base,
        lifecycleState: 'WAITING_FOR_PROJECTION',
        projectionWait: {
          requiredDiscoveryBase: {
            ...base.requiredDiscoveryBase!,
            projectionRevision: 'other-projection',
          },
          waitDeadlineAt: '2026-08-30T00:10:00.000Z',
          fallbackPolicyRevision: 'fallback-1',
        },
      }),
    ).toThrow(/must match requiredDiscoveryBase/);
  });

  it('separates Attempt sequence from lifecycle revision and freezes initial shape', () => {
    const initial = {
      schemaVersion: '1.0.0' as const,
      attemptId: 'attempt-1',
      jobId: 'job-1',
      runId: 'run-1',
      projectId: 'project-1',
      attemptNumber: 1,
      lifecycleRevision: 1,
      attemptKind: 'INITIAL' as const,
      lifecycleState: 'FAILED_RETRYABLE' as const,
      createdAt: '2026-08-30T00:00:00.000Z',
      updatedAt: '2026-08-30T00:00:01.000Z',
      completedAt: '2026-08-30T00:00:01.000Z',
    };
    expect(decodeDiscoveryAttemptV1(initial)).toEqual(initial);
    expect(() => decodeDiscoveryAttemptV1({ ...initial, attemptNumber: 2 })).toThrow(
      /INITIAL attempts must be numbered 1/,
    );
    expect(() =>
      decodeDiscoveryAttemptV1({
        ...initial,
        attemptId: 'attempt-2',
        attemptKind: 'DOMAIN_RETRY',
        attemptNumber: 3,
        previousAttemptId: 'attempt-1',
        lifecycleState: 'RUNNING',
        updatedAt: '2026-08-30T00:00:02.000Z',
        completedAt: undefined,
      }),
    ).not.toThrow();
  });

  it('preserves the existing AKP-3 work-budget binding and bounded dimensions', () => {
    expect(decodeDiscoveryRuntimeBudgetBindingV1(budget())).toEqual(budget());
    expect(() =>
      decodeDiscoveryRuntimeBudgetBindingV1({ ...budget(), budgetVersion: 'new-budget-engine:v1' }),
    ).toThrow(/existing AKP-3/);
  });

  it('fails closed for lifecycle and typed stage transitions', () => {
    expect(() => assertDiscoveryRuntimeLifecycleTransitionV1('RUNNING', 'SUCCEEDED')).not.toThrow();
    expect(() => assertDiscoveryRuntimeLifecycleTransitionV1('SUCCEEDED', 'RUNNING')).toThrow(
      /invalid transition/,
    );
    expect(() =>
      assertDiscoveryRuntimeStageTransitionV1('RUNNING', 'FAILED_TERMINAL'),
    ).not.toThrow();
    expect(() => assertDiscoveryRuntimeStageTransitionV1('SUCCEEDED', 'RUNNING')).toThrow(
      /invalid transition/,
    );
    expect(discoveryStageOrdinalV1('WAIT_FOR_PROJECTION')).toBe(1);
    expect(discoveryStageOrdinalV1('RECONCILE_FINDINGS')).toBe(7);
  });
});
