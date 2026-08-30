import type {
  DiscoveryFindingEnvelopeV1,
  DiscoveryFollowUpQualificationProofV1,
  DiscoveryFindingReadyV1,
  DiscoveryAttemptV1,
  DiscoveryCanonicalTriggerLookupV1,
  DiscoveryJobV1,
  DiscoveryLogicalJobIdentityV1,
  DiscoveryProjectionWaitBindingV1,
  DiscoveryRunV1,
  DiscoveryRuntimeLifecycleStateV1,
  DiscoveryRuntimeStageStateV1,
  DiscoveryStageV1,
} from '../../../packages/contracts/src/index.js';
import type { DiscoveryRuntimeStageTypeV1 } from '../../../packages/contracts/src/index.js';

export type DiscoveryRuntimeBudgetSnapshotV1 = {
  readonly resources: number;
  readonly semanticNeighbors: number;
  readonly candidatePairs: number;
  readonly candidateGroups: number;
  readonly findings: number;
  readonly providerCalls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedCostMicros: number;
  readonly activeProviderCalls: number;
};

export type DiscoveryRuntimeJobLookupV1 = {
  readonly projectId: string;
  readonly jobId: string;
};

export type DiscoveryRuntimeLogicalJobLookupV1 = {
  readonly projectId: string;
  readonly logicalIdentity: DiscoveryLogicalJobIdentityV1;
};

export type DiscoveryRuntimeJobTransitionInputV1 = DiscoveryRuntimeJobLookupV1 & {
  readonly expectedLifecycleRevision: number;
  readonly targetState: DiscoveryRuntimeLifecycleStateV1;
  readonly projectionWait?: DiscoveryProjectionWaitBindingV1;
  readonly updatedAt: string;
};

export type DiscoveryRuntimeRunLookupV1 = DiscoveryRuntimeJobLookupV1 & {
  readonly runId: string;
};

export type DiscoveryRuntimeRunTransitionInputV1 = DiscoveryRuntimeRunLookupV1 & {
  readonly expectedLifecycleRevision: number;
  readonly targetState: DiscoveryRuntimeLifecycleStateV1;
  readonly projectionWait?: DiscoveryProjectionWaitBindingV1;
  readonly updatedAt: string;
  readonly completedAt?: string;
};

export type DiscoveryRuntimeStageLookupV1 = {
  readonly projectId: string;
  readonly runId: string;
  readonly attemptId: string;
};

export type DiscoveryRuntimeAttemptLookupV1 = DiscoveryRuntimeRunLookupV1 & {
  readonly attemptId: string;
};

export type DiscoveryRuntimeAttemptTransitionInputV1 = DiscoveryRuntimeAttemptLookupV1 & {
  readonly expectedLifecycleRevision: number;
  readonly targetState: DiscoveryRuntimeLifecycleStateV1;
  readonly updatedAt: string;
  readonly completedAt?: string;
};

export type DiscoveryRuntimeStageTransitionInputV1 = DiscoveryRuntimeStageLookupV1 & {
  readonly stageId: string;
  readonly expectedStageRevision: number;
  readonly targetState: DiscoveryRuntimeStageStateV1;
  readonly updatedAt: string;
  readonly completedAt?: string;
};

/**
 * The database-owned claim returned to a Discovery worker.  `fencingToken`
 * changes on every successful claim/reclaim, so it is part of every
 * authoritative write performed by the worker.
 */
export type DiscoveryRuntimeLeaseV1 = DiscoveryRuntimeAttemptLookupV1 & {
  readonly workerId: string;
  readonly fencingToken: number;
  readonly acquiredAt: string;
  readonly expiresAt: string;
};

export type DiscoveryRuntimeClaimV1 = DiscoveryRuntimeLeaseV1 & {
  readonly job: DiscoveryJobV1;
  readonly run: DiscoveryRunV1;
  readonly attempt: DiscoveryAttemptV1;
};

export type DiscoveryRuntimeFailureContextV1 = {
  readonly schemaVersion: '1.0.0';
  readonly code: string;
  readonly classification: 'RETRYABLE' | 'TERMINAL';
  readonly retryable: boolean;
  readonly safeMessage: string;
  readonly failedStage: string;
  readonly occurredAt: string;
  readonly retryNotBefore?: string;
};

export type DiscoveryRuntimeBudgetCheckpointV1 = {
  readonly schemaVersion: '1.0.0';
  readonly projectId: string;
  readonly jobId: string;
  readonly runId: string;
  readonly revision: number;
  readonly snapshot: DiscoveryRuntimeBudgetSnapshotV1;
  readonly updatedAt: string;
};

export type DiscoveryRuntimeClaimInputV1 = {
  readonly projectId?: string;
  readonly workerId: string;
  readonly now: string;
  readonly leaseDurationMs: number;
};

export type DiscoveryRuntimeLeaseMutationInputV1 = DiscoveryRuntimeLeaseV1 & {
  readonly now: string;
  readonly leaseDurationMs?: number;
};

export type DiscoveryRuntimeFencedStageTransitionInputV1 =
  DiscoveryRuntimeStageTransitionInputV1 & {
    readonly workerId: string;
    readonly fencingToken: number;
  };

export type DiscoveryRuntimeFencedAttemptTransitionInputV1 =
  DiscoveryRuntimeAttemptTransitionInputV1 & {
    readonly workerId: string;
    readonly fencingToken: number;
  };

export type DiscoveryRuntimeFencedRunTransitionInputV1 = DiscoveryRuntimeRunTransitionInputV1 & {
  readonly workerId: string;
  readonly fencingToken: number;
};

export type DiscoveryRuntimeFencedJobTransitionInputV1 = DiscoveryRuntimeJobTransitionInputV1 & {
  readonly workerId: string;
  readonly fencingToken: number;
};

export type DiscoveryRuntimeFinalizeInputV1 = DiscoveryRuntimeLeaseV1 & {
  readonly expectedAttemptLifecycleRevision: number;
  readonly expectedRunLifecycleRevision: number;
  readonly expectedJobLifecycleRevision: number;
  readonly targetState: DiscoveryRuntimeLifecycleStateV1;
  readonly updatedAt: string;
};

/** A bounded, normalized checkpoint for a completed stage.  Raw prompts,
 * credentials, provider payloads, and request headers are never accepted by
 * the Product adapter; only JSON-safe stage results cross this boundary. */
export type DiscoveryRuntimeStageOutputV1 = {
  readonly schemaVersion: '1.0.0';
  readonly projectId: string;
  readonly jobId: string;
  readonly runId: string;
  readonly attemptId: string;
  readonly stageId: string;
  readonly stageType: DiscoveryRuntimeStageTypeV1;
  readonly stageRevision: number;
  readonly output: unknown;
  readonly updatedAt: string;
};

/**
 * The Generate stage may carry a bounded, server-derived proof bundle next to
 * its Finding envelopes. It is not a Finding extension and must never contain
 * model response text, prompts, credentials, or provider payloads.
 */
export type DiscoveryRuntimeGeneratedFindingsStageValueV1 = {
  readonly schemaVersion: '1.0.0';
  readonly candidates: readonly DiscoveryRuntimeCandidateV1[];
};

/** The only server-owned proof fields allowed to cross the durable stage boundary. */
export type DiscoveryRuntimeCandidateProofV1 = {
  readonly selectionSignals?: readonly DiscoveryRuntimeConflictSelectionSignalV1[];
  readonly qualifiedFollowUp?: DiscoveryFollowUpQualificationProofV1;
};

export type DiscoveryRuntimeConflictSelectionSignalV1 = {
  readonly kind: 'EXPLICIT_INCOMPATIBILITY';
  readonly incompatibilityKind: 'FACTUAL' | 'TEMPORAL' | 'IDENTITY' | 'MODEL_DISAGREEMENT';
  readonly source:
    | 'TYPED_PROPOSITION'
    | 'TEMPORAL_QUALIFICATION'
    | 'IDENTITY_ASSIGNMENT'
    | 'EXPLICIT_CONFLICT_SIGNAL';
  readonly signalId: string;
};

export type DiscoveryRuntimeCandidateV1 = {
  readonly schemaVersion: '1.0.0';
  readonly finding: DiscoveryFindingEnvelopeV1;
  readonly proof?: DiscoveryRuntimeCandidateProofV1;
};

export type DiscoveryRuntimeProviderReservationV1 = {
  readonly schemaVersion: '1.0.0';
  readonly projectId: string;
  readonly jobId: string;
  readonly runId: string;
  readonly attemptId: string;
  readonly reservationId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly inputTokenUpperBound: number;
  readonly maxOutputTokens: number;
  readonly estimatedCostMicros: number;
  readonly actualInputTokens?: number;
  readonly actualOutputTokens?: number;
  readonly actualCostMicros?: number;
  readonly state: 'RESERVED' | 'FINALIZED' | 'CANCELLED';
  readonly updatedAt: string;
};

export type DiscoveryRuntimeFailureFinalizationInputV1 = DiscoveryRuntimeLeaseV1 & {
  readonly stageId?: string;
  readonly expectedStageRevision?: number;
  readonly expectedAttemptLifecycleRevision: number;
  readonly expectedRunLifecycleRevision: number;
  readonly expectedJobLifecycleRevision: number;
  readonly targetState: Extract<
    DiscoveryRuntimeLifecycleStateV1,
    'FAILED_RETRYABLE' | 'FAILED_TERMINAL'
  >;
  readonly failure: DiscoveryRuntimeFailureContextV1;
};

export type DiscoveryRuntimeExecutionRepositoryPort = DiscoveryRuntimeRepositoryPort & {
  claimNext(input: DiscoveryRuntimeClaimInputV1): Promise<DiscoveryRuntimeClaimV1 | undefined>;
  renewLease(
    input: DiscoveryRuntimeLeaseMutationInputV1,
  ): Promise<DiscoveryRuntimeLeaseV1 | 'STALE' | 'NOT_FOUND'>;
  releaseLease(
    input: DiscoveryRuntimeLeaseV1 & { readonly now: string },
  ): Promise<'RELEASED' | 'STALE' | 'NOT_FOUND'>;
  transitionStageWithLease(
    input: DiscoveryRuntimeFencedStageTransitionInputV1,
  ): Promise<DiscoveryStageV1 | 'NOT_FOUND' | 'CONFLICT' | 'STALE'>;
  transitionAttemptWithLease(
    input: DiscoveryRuntimeFencedAttemptTransitionInputV1,
  ): Promise<DiscoveryAttemptV1 | 'NOT_FOUND' | 'CONFLICT' | 'STALE'>;
  transitionRunWithLease(
    input: DiscoveryRuntimeFencedRunTransitionInputV1,
  ): Promise<DiscoveryRunV1 | 'NOT_FOUND' | 'CONFLICT' | 'STALE'>;
  transitionJobWithLease(
    input: DiscoveryRuntimeFencedJobTransitionInputV1,
  ): Promise<DiscoveryJobV1 | 'NOT_FOUND' | 'CONFLICT' | 'STALE'>;
  finalizeClaimWithLease(
    input: DiscoveryRuntimeFinalizeInputV1,
  ): Promise<'COMPLETED' | 'PARTIAL' | 'NOT_FOUND' | 'CONFLICT' | 'STALE'>;
  /** Atomic failure finalization.  The optional shape preserves compatibility
   * with in-memory contract fixtures; the PostgreSQL adapter is required to
   * implement it for production execution. */
  finalizeFailureWithLease?(
    input: DiscoveryRuntimeFailureFinalizationInputV1,
  ): Promise<'FAILED_RETRYABLE' | 'FAILED_TERMINAL' | 'NOT_FOUND' | 'CONFLICT' | 'STALE'>;
  saveFailureContext(
    input: DiscoveryRuntimeLeaseV1 & {
      readonly failure: DiscoveryRuntimeFailureContextV1;
    },
  ): Promise<'SAVED' | 'STALE' | 'NOT_FOUND'>;
  readBudgetCheckpoint(
    lookup: DiscoveryRuntimeRunLookupV1,
  ): Promise<DiscoveryRuntimeBudgetCheckpointV1 | undefined>;
  writeBudgetCheckpoint(
    input: DiscoveryRuntimeLeaseV1 & {
      readonly checkpoint: DiscoveryRuntimeBudgetCheckpointV1;
    },
  ): Promise<'SAVED' | 'CONFLICT' | 'STALE' | 'NOT_FOUND'>;
  readStageOutput?(
    lookup: DiscoveryRuntimeStageLookupV1 & { readonly stageId: string },
  ): Promise<DiscoveryRuntimeStageOutputV1 | undefined>;
  writeStageOutput?(
    input: DiscoveryRuntimeLeaseV1 & { readonly output: DiscoveryRuntimeStageOutputV1 },
  ): Promise<'SAVED' | 'CONFLICT' | 'STALE' | 'NOT_FOUND'>;
  reserveProviderCall?(
    input: DiscoveryRuntimeLeaseV1 & {
      readonly reservation: DiscoveryRuntimeProviderReservationV1;
    },
  ): Promise<'RESERVED' | 'CONFLICT' | 'STALE' | 'NOT_FOUND'>;
  finalizeProviderCall?(
    input: DiscoveryRuntimeLeaseV1 & {
      readonly reservationId: string;
      readonly state: 'FINALIZED' | 'CANCELLED';
      readonly actualInputTokens?: number;
      readonly actualOutputTokens?: number;
      readonly actualCostMicros?: number;
      readonly updatedAt: string;
    },
  ): Promise<'FINALIZED' | 'CANCELLED' | 'STALE' | 'NOT_FOUND'>;
  readProviderReservationUsage?(lookup: DiscoveryRuntimeRunLookupV1): Promise<{
    readonly providerCalls: number;
    readonly activeProviderCalls: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly estimatedCostMicros: number;
  }>;
  publishFindingReady(
    input: DiscoveryRuntimeLeaseV1 & { readonly publication: DiscoveryFindingReadyV1 },
  ): Promise<'CREATED' | 'ALREADY_EXISTS' | 'STALE' | 'NOT_FOUND'>;
  findFindingReady(
    lookup: Pick<DiscoveryFindingReadyV1, 'projectId' | 'findingId' | 'findingRevision'>,
  ): Promise<DiscoveryFindingReadyV1 | undefined>;
};

export type DiscoveryRuntimeRepositoryPort = {
  saveJob(job: DiscoveryJobV1): Promise<'CREATED' | 'CONFLICT'>;
  findJob(lookup: DiscoveryRuntimeJobLookupV1): Promise<DiscoveryJobV1 | undefined>;
  findJobByTriggerIdentity(
    lookup: DiscoveryCanonicalTriggerLookupV1,
  ): Promise<DiscoveryJobV1 | undefined>;
  findJobByLogicalIdentity(
    lookup: DiscoveryRuntimeLogicalJobLookupV1,
  ): Promise<DiscoveryJobV1 | undefined>;
  transitionJob(
    input: DiscoveryRuntimeJobTransitionInputV1,
  ): Promise<DiscoveryJobV1 | 'NOT_FOUND' | 'CONFLICT'>;

  saveRun(run: DiscoveryRunV1): Promise<'CREATED' | 'CONFLICT'>;
  findRun(lookup: DiscoveryRuntimeRunLookupV1): Promise<DiscoveryRunV1 | undefined>;
  transitionRun(
    input: DiscoveryRuntimeRunTransitionInputV1,
  ): Promise<DiscoveryRunV1 | 'NOT_FOUND' | 'CONFLICT'>;

  saveAttempt(attempt: DiscoveryAttemptV1): Promise<'CREATED' | 'CONFLICT'>;
  listAttempts(lookup: DiscoveryRuntimeRunLookupV1): Promise<readonly DiscoveryAttemptV1[]>;
  transitionAttempt(
    input: DiscoveryRuntimeAttemptTransitionInputV1,
  ): Promise<DiscoveryAttemptV1 | 'NOT_FOUND' | 'CONFLICT'>;

  saveStage(stage: DiscoveryStageV1): Promise<'CREATED' | 'CONFLICT'>;
  listStages(lookup: DiscoveryRuntimeStageLookupV1): Promise<readonly DiscoveryStageV1[]>;
  transitionStage(
    input: DiscoveryRuntimeStageTransitionInputV1,
  ): Promise<DiscoveryStageV1 | 'NOT_FOUND' | 'CONFLICT'>;
};

export * from './worker.js';
