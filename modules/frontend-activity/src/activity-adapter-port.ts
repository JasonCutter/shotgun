import type {
  ActivityCorrelationRefV1,
  ActivityDimensionsV1,
  ActivityDomainAttemptViewV1,
  ActivityDomainKindV1,
  ActivityEventViewV1,
  ActivityLifecycleStateV1,
  ActivityProjectionMetadataV1,
  ActivityRootReferenceV1,
  ActivityRunViewV1,
  ActivityStageViewV1,
  ActivityTransportAttemptViewV1,
} from '../../../packages/contracts/src/index.js';

/**
 * FE-P5-S1 Activity adapter ports.
 *
 * Each owning Domain (Sources, Ask, External Action) exposes a read-only
 * Activity adapter. Adapters produce the federated projection views but never
 * acquire execution authority: Retry and Cancel remain owning-Domain commands
 * and the browser never authors scope/authority.
 *
 * `ActivityAdapterScopeV1` is server-internal; it is never decoded from a
 * browser request. The concrete adapters are wired at the assembly boundary
 * and implemented in WP2/WP3 (read-model persistence and projection builder).
 */

export type ActivityAdapterKindV1 = 'SOURCES' | 'ASK' | 'EXTERNAL_ACTION';

/** Server-only scope used by adapter reads (never browser-authored). */
export type ActivityAdapterScopeV1 = {
  readonly principalId: string;
  readonly activeProjectId: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  /** Server-derived sensitivity clearance (owning Domain revalidates access). */
  readonly sensitivityClearance?: string;
  /** Server-derived access scopes (owning Domain revalidates capability). */
  readonly accessScope?: readonly string[];
};

export type ActivityQueueFilterV1 = {
  readonly domainKinds?: readonly ActivityDomainKindV1[];
  readonly states?: readonly ActivityLifecycleStateV1[];
  readonly attention?: 'NEEDS_ATTENTION' | 'RESOLVED' | 'NONE';
  readonly cursor?: string;
  readonly limit?: number;
};

/** One queue row in the federated Activity Queue. */
export type ActivityQueueItemV1 = {
  readonly root: ActivityRootReferenceV1;
  readonly summary: string;
  readonly state: ActivityLifecycleStateV1;
  readonly dimensions: ActivityDimensionsV1;
  readonly updatedAt: string;
};

export type ActivityQueuePageV1 = {
  readonly items: readonly ActivityQueueItemV1[];
  readonly metadata: ActivityProjectionMetadataV1;
  readonly nextCursor?: string;
};

/** Detail combines the read model with the current authoritative snapshot. */
export type ActivityDetailV1 = {
  readonly root: ActivityRootReferenceV1;
  readonly run: ActivityRunViewV1;
  readonly attempts: readonly ActivityDomainAttemptViewV1[];
  readonly stages: readonly ActivityStageViewV1[];
  readonly events: readonly ActivityEventViewV1[];
  readonly transportAttempts: readonly ActivityTransportAttemptViewV1[];
  readonly metadata: ActivityProjectionMetadataV1;
  readonly dimensions: ActivityDimensionsV1;
};

export type ActivityStageContinuationV1 = {
  readonly stages: readonly ActivityStageViewV1[];
  readonly metadata: ActivityProjectionMetadataV1;
  readonly nextCursor?: string;
};

export type ActivityEventContinuationV1 = {
  readonly events: readonly ActivityEventViewV1[];
  readonly metadata: ActivityProjectionMetadataV1;
  readonly nextCursor?: string;
};

export type ActivityAdapterHealthV1 = {
  readonly status: 'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE';
  readonly lastObservedAt?: string;
  readonly message?: string;
};

/**
 * Common Activity adapter surface. Implementations map Domain state into the
 * common lifecycle and separate projection dimensions; they never expose raw
 * provider payloads, secrets or inaccessible Resource details.
 */
export type ActivityAdapterPort = {
  readonly adapterId: string;
  readonly domainKind: ActivityAdapterKindV1;
  readonly domainKinds: readonly ActivityDomainKindV1[];
  /** Project-scoped queue read with stable ordering and cursor bounds. */
  readQueue(
    scope: ActivityAdapterScopeV1,
    filter: ActivityQueueFilterV1,
  ): Promise<ActivityQueuePageV1>;
  /** Detail read by projection identity plus concrete Domain reference. */
  readDetail(
    scope: ActivityAdapterScopeV1,
    root: ActivityRootReferenceV1,
  ): Promise<ActivityDetailV1>;
  /** Bounded Stage continuation. `limit` is the server-enforced cap (≤ 50). */
  readStages(
    scope: ActivityAdapterScopeV1,
    root: ActivityRootReferenceV1,
    cursor?: string,
    limit?: number,
  ): Promise<ActivityStageContinuationV1>;
  /**
   * Bounded Event continuation (operational evidence, not History).
   * `limit` is the server-enforced cap (≤ 50).
   */
  readEvents(
    scope: ActivityAdapterScopeV1,
    root: ActivityRootReferenceV1,
    cursor?: string,
    limit?: number,
  ): Promise<ActivityEventContinuationV1>;
  /** Adapter health for the Projection Metadata adapterStatus dimension. */
  health(): ActivityAdapterHealthV1;
};

/** Sources adapter port (Job = IntakeSubmission, Run = item processing). */
export type SourcesActivityAdapterPort = ActivityAdapterPort & {
  readonly domainKind: 'SOURCES';
};

/** Ask adapter port (no durable Job; Run = AnswerRun is the root). */
export type AskActivityAdapterPort = ActivityAdapterPort & {
  readonly domainKind: 'ASK';
};

/** External Action adapter port (Job = Action aggregate, Run = Execution). */
export type ExternalActionActivityAdapterPort = ActivityAdapterPort & {
  readonly domainKind: 'EXTERNAL_ACTION';
};

/**
 * Federated registry of Activity adapters. One adapter failure produces a
 * partial result with adapter health metadata and must not erase accessible
 * results from other adapters (Contract Snapshot §3, AC-10).
 */
export type ActivityAdapterRegistryPort = {
  readonly adapters: readonly ActivityAdapterPort[];
  adapterFor(domainKind: ActivityAdapterKindV1): ActivityAdapterPort | undefined;
  healthSummaries(): Readonly<Record<string, ActivityAdapterHealthV1>>;
};

/** Correlation/causation trace reference builder for adapter output. */
export const activityTraceRef = (
  refType: 'CORRELATION' | 'CAUSATION',
  refKind: string,
  refId: string,
): ActivityCorrelationRefV1 => ({
  schemaVersion: '1.0.0',
  refType,
  refKind,
  refId,
});
