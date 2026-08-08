import type {
  ActivityAdapterKindV1,
  ActivityCorrelationRefV1,
  ActivityDetailV1,
  ActivityDomainKindV1,
  ActivityEventContinuationV1,
  ActivityLifecycleStateV1,
  ActivityQueuePageV1,
  ActivityRootReferenceV1,
  ActivityStageContinuationV1,
} from '../../../packages/contracts/src/index.js';

// The browser-facing Activity Product API wire types are owned by Contracts
// (single source of truth); this module re-exports them so the Activity
// adapters and the module boundary surface stay stable.
export type {
  ActivityAdapterKindV1,
  ActivityDetailV1,
  ActivityEventContinuationV1,
  ActivityQueueItemV1,
  ActivityQueuePageV1,
  ActivityStageContinuationV1,
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
  /**
   * Non-disclosing access check for a concrete Activity resource. Used to
   * filter the Project-scoped Queue at response time so a Principal never sees
   * resources the owning Domain denies (project/principal/sensitivity/access).
   */
  canAccess(scope: ActivityAdapterScopeV1, root: ActivityRootReferenceV1): Promise<boolean>;
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
