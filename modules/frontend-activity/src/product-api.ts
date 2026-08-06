import {
  FRONTEND_ACTIVITY_API_VERSION,
  FrontendContractError,
  type ActivityAdapterStatusV1,
  type ActivityAttentionStateV1,
  type ActivityDimensionsV1,
  type ActivityDomainKindV1,
  type ActivityLifecycleStateV1,
  type ActivityProjectionFreshnessV1,
  type ActivityProjectionMetadataV1,
  type ActivityRootReferenceV1,
} from '../../../packages/contracts/src/index.js';
import {
  combineAdapterAvailability,
  type ActivityAdapterPort,
  type ActivityAdapterRegistryPort,
  type ActivityAdapterScopeV1,
  type ActivityDetailV1,
  type ActivityEventContinuationV1,
  type ActivityIndexRecordV1,
  type ActivityProjectionBuilderScopeV1,
  type ActivityProjectionBuildResultV1,
  type ActivityQueueItemV1,
  type ActivityQueuePageV1,
  type ActivityReadModelStorePort,
  type ActivityStageContinuationV1,
  type ActivityWatermarkRecordV1,
} from './index.js';
import type { ActivityProjectionBuilder } from './activity-projection-builder.js';

/**
 * FE-P5-S1 WP3 — Activity Product API.
 *
 * Project-scoped, typed, cursor-bounded read surface (Contract Snapshot §7).
 * Reads are non-disclosing: a missing or cross-project resource produces the
 * same NOT_FOUND result and never leaks existence, counts, IDs or failure
 * details. Retry and Cancel are NOT generic Activity commands; Activity only
 * exposes read/refresh capabilities and delegates any action to the owning
 * Domain route (WP5).
 *
 * The coordinator derives an `ActivityAdapterScopeV1` (server-side) from the
 * product scope and revalidates Project/access at execution time through the
 * owning adapter.
 */

export type ActivityProductScopeV1 = {
  readonly principalId: string;
  readonly activeProjectId: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly accessScope: readonly string[];
};

export type ActivityCapabilityV1 =
  | 'LIST_ACTIVITY'
  | 'READ_ACTIVITY_DETAIL'
  | 'READ_ACTIVITY_STAGES'
  | 'READ_ACTIVITY_EVENTS'
  | 'REFRESH_ACTIVITY_PROJECTION';

const ACTIVITY_READ_SCOPES: ReadonlySet<string> = new Set(['owner', 'admin', 'activity:read']);
const ACTIVITY_REFRESH_SCOPES: ReadonlySet<string> = new Set([
  'owner',
  'admin',
  'activity:refresh',
]);

/** Least-privilege Scope → Capability matrix for Activity reads. */
export const activityCapabilitiesForScope = (
  scope: ActivityProductScopeV1,
): readonly ActivityCapabilityV1[] => {
  const granted = scope.accessScope ?? [];
  const has = (set: ReadonlySet<string>): boolean => granted.some((entry) => set.has(entry));
  const capabilities: ActivityCapabilityV1[] = [];
  if (has(ACTIVITY_READ_SCOPES)) {
    capabilities.push(
      'LIST_ACTIVITY',
      'READ_ACTIVITY_DETAIL',
      'READ_ACTIVITY_STAGES',
      'READ_ACTIVITY_EVENTS',
    );
  }
  if (has(ACTIVITY_REFRESH_SCOPES)) capabilities.push('REFRESH_ACTIVITY_PROJECTION');
  return capabilities;
};

export const ACTIVITY_QUEUE_PAGE_SIZE_CAP = 50;
export const ACTIVITY_STAGE_LIST_CAP = 50;
export const ACTIVITY_EVENT_LIST_CAP = 50;

// --- request types ----------------------------------------------------------

export type ListActivityQueueRequestV1 = {
  readonly schemaVersion: typeof FRONTEND_ACTIVITY_API_VERSION;
  readonly domainKinds?: readonly ActivityDomainKindV1[];
  readonly states?: readonly ActivityLifecycleStateV1[];
  readonly attention?: ActivityAttentionStateV1;
  readonly cursor?: string;
  readonly limit?: number;
};

export type GetActivityDetailRequestV1 = {
  readonly schemaVersion: typeof FRONTEND_ACTIVITY_API_VERSION;
  readonly activityId: string;
  readonly domainResourceKind: string;
  readonly domainResourceId: string;
};

export type ListActivityContinuationRequestV1 = {
  readonly schemaVersion: typeof FRONTEND_ACTIVITY_API_VERSION;
  readonly activityId: string;
  readonly domainResourceKind: string;
  readonly domainResourceId: string;
  readonly cursor?: string;
};

export type RefreshActivityProjectionRequestV1 = {
  readonly schemaVersion: typeof FRONTEND_ACTIVITY_API_VERSION;
};

// --- helpers ----------------------------------------------------------------

const notFound = (): never => {
  throw new FrontendContractError('NOT_FOUND', 'The Activity resource was not found.');
};

const projectDenied = (): never => {
  throw new FrontendContractError(
    'PROJECT_ACCESS_DENIED',
    'The current scope does not grant Activity access.',
  );
};

/** Reconstruct the concrete Activity root reference from an index record. */
export const activityRootFromRecord = (record: ActivityIndexRecordV1): ActivityRootReferenceV1 => ({
  schemaVersion: '1.0.0',
  rootKind: record.rootKind,
  activityId: record.activityId,
  domainKind: record.domainKind,
  domainResourceKind: record.domainResourceKind,
  domainResourceId: record.domainResourceId,
  resourceProjectId: record.resourceProjectId,
  resourceHref: record.resourceHref,
  ...(record.jobId === undefined ? {} : { jobId: record.jobId }),
  runId: record.runId,
});

const dimensionsFromRecord = (
  record: ActivityIndexRecordV1,
  snapshot: unknown,
): ActivityDimensionsV1 => {
  const snapshotItem =
    typeof snapshot === 'object' && snapshot !== null
      ? (snapshot as Partial<ActivityQueueItemV1>)
      : undefined;
  return {
    schemaVersion: '1.0.0',
    ...(snapshotItem?.dimensions?.progress === undefined
      ? {}
      : { progress: snapshotItem.dimensions.progress }),
    attention: record.attention,
    ...(snapshotItem?.dimensions?.failure === undefined
      ? {}
      : { failure: snapshotItem.dimensions.failure }),
    retryability: record.retryability,
    freshness: record.freshness,
    adapterStatus: record.adapterStatus,
  };
};

/** Reconstruct a queue item from an index record (scalar mirrors authoritative). */
export const activityQueueItemFromRecord = (
  record: ActivityIndexRecordV1,
): ActivityQueueItemV1 => ({
  root: activityRootFromRecord(record),
  summary: record.summary,
  state: record.state,
  dimensions: dimensionsFromRecord(record, record.snapshot),
  updatedAt: record.updatedAt,
});

const combineFreshness = (
  freshnesses: readonly ActivityProjectionFreshnessV1[],
): ActivityProjectionFreshnessV1 => {
  if (freshnesses.some((value) => value === 'STALE')) return 'STALE';
  if (freshnesses.some((value) => value === 'LAGGING')) return 'LAGGING';
  if (freshnesses.some((value) => value === 'UNKNOWN')) return 'UNKNOWN';
  return 'CURRENT';
};

/** Build the Projection Metadata for a queue page from records and watermarks. */
export const activityProjectionMetadataFrom = (input: {
  readonly records: readonly ActivityIndexRecordV1[];
  readonly watermarks: readonly ActivityWatermarkRecordV1[];
  readonly now: string;
  readonly expectedAdapterCount?: number;
}): ActivityProjectionMetadataV1 => {
  const revisionFromRecords = input.records.reduce(
    (max, record) => Math.max(max, record.snapshotRevision),
    0,
  );
  const revisionFromWatermarks = input.watermarks.reduce(
    (max, record) => Math.max(max, record.snapshotRevision),
    0,
  );
  const snapshotRevision = Math.max(revisionFromRecords, revisionFromWatermarks);
  const sourceUpdatedAts = input.watermarks
    .map((record) => record.sourceUpdatedAt)
    .filter((value): value is string => value !== undefined);
  const sourceUpdatedAt =
    sourceUpdatedAts.length > 0
      ? sourceUpdatedAts.reduce((max, value) => (value > max ? value : max))
      : input.now;
  const freshness = combineFreshness(
    input.records.length > 0
      ? input.records.map((record) => record.freshness)
      : input.watermarks.map((record) =>
          record.adapterStatus === 'AVAILABLE'
            ? 'CURRENT'
            : record.adapterStatus === 'DEGRADED'
              ? 'LAGGING'
              : 'UNKNOWN',
        ),
  );
  const lagValues = input.watermarks
    .map((record) => record.lagMilliseconds)
    .filter((value): value is number => value !== undefined);
  const lagMilliseconds = lagValues.length > 0 ? Math.max(...lagValues) : undefined;
  const statuses: ActivityAdapterStatusV1[] =
    input.watermarks.length > 0
      ? input.watermarks.map((record) => record.adapterStatus)
      : [...new Set(input.records.map((record) => record.adapterStatus))];
  const adapterStatus = combineAdapterAvailability(statuses);
  const observedAdapterCount =
    input.watermarks.length > 0
      ? input.watermarks.length
      : new Set(input.records.map((record) => record.domainKind)).size;
  const expectedAdapterCount = input.expectedAdapterCount ?? observedAdapterCount;
  const partial = adapterStatus !== 'AVAILABLE' || observedAdapterCount < expectedAdapterCount;
  return {
    schemaVersion: '1.0.0',
    snapshotRevision: Math.max(1, snapshotRevision),
    generatedAt: input.now,
    sourceUpdatedAt,
    freshness,
    ...(lagMilliseconds === undefined ? {} : { lagMilliseconds }),
    adapterStatus,
    partial,
  };
};

// --- coordinator ------------------------------------------------------------

export class ActivityProductCoordinator {
  constructor(
    private readonly registry: ActivityAdapterRegistryPort,
    private readonly store: ActivityReadModelStorePort,
    private readonly builder: ActivityProjectionBuilder,
    private readonly now?: () => Date,
  ) {}

  private nowIso(): string {
    return (this.now ? this.now() : new Date()).toISOString();
  }

  private adapterScope(scope: ActivityProductScopeV1): ActivityAdapterScopeV1 {
    return {
      principalId: scope.principalId,
      activeProjectId: scope.activeProjectId,
      accessRevision: scope.accessRevision,
      policyContextRevision: scope.policyContextRevision,
    };
  }

  private projectionScope(scope: ActivityProductScopeV1): ActivityProjectionBuilderScopeV1 {
    return this.adapterScope(scope);
  }

  private requireCapability(scope: ActivityProductScopeV1, capability: ActivityCapabilityV1): void {
    if (!activityCapabilitiesForScope(scope).includes(capability)) {
      projectDenied();
    }
  }

  private async lookupIndexRecord(
    scope: ActivityProductScopeV1,
    request: {
      readonly activityId: string;
      readonly domainResourceKind: string;
      readonly domainResourceId: string;
    },
  ): Promise<ActivityIndexRecordV1> {
    // Non-disclosing: a cross-project or missing resource produces the same
    // NOT_FOUND result and never leaks existence or identity. The lookup is
    // bounded per owning-Domain adapter within the queue page cap.
    const domainKinds: readonly ActivityDomainKindV1[] = [
      'SOURCES',
      'ASK',
      'EXTERNAL_ACTION',
      'CONNECTOR_DIAGNOSTICS',
    ];
    for (const domainKind of domainKinds) {
      const page = await this.store.index.queryProject({
        resourceProjectId: scope.activeProjectId,
        domainKinds: [domainKind],
        limit: ACTIVITY_QUEUE_PAGE_SIZE_CAP,
      });
      const record = page.records.find(
        (candidate) =>
          candidate.activityId === request.activityId &&
          candidate.domainResourceKind === request.domainResourceKind &&
          candidate.domainResourceId === request.domainResourceId,
      );
      if (record) return record;
    }
    return notFound();
  }

  /** Project-scoped Activity Queue read with filters and stable ordering. */
  async listActivityQueue(
    scope: ActivityProductScopeV1,
    request: ListActivityQueueRequestV1,
  ): Promise<ActivityQueuePageV1> {
    this.requireCapability(scope, 'LIST_ACTIVITY');
    const limit = Math.min(ACTIVITY_QUEUE_PAGE_SIZE_CAP, Math.max(1, request.limit ?? 20));
    const page = await this.store.index.queryProject({
      resourceProjectId: scope.activeProjectId,
      domainKinds: request.domainKinds,
      states: request.states,
      attention: request.attention,
      cursor: request.cursor,
      limit,
    });
    const watermarks = await this.store.watermarks.readByProject(scope.activeProjectId);
    const metadata = activityProjectionMetadataFrom({
      records: page.records,
      watermarks,
      now: this.nowIso(),
      expectedAdapterCount: this.registry.adapters.length,
    });
    return {
      items: page.records.map(activityQueueItemFromRecord),
      metadata,
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
    };
  }

  /**
   * Detail read by projection identity plus the concrete Domain reference.
   * The owning adapter re-resolves the current authoritative Domain Resource
   * snapshot and revalidates access at execution time.
   */
  async getActivityDetail(
    scope: ActivityProductScopeV1,
    request: GetActivityDetailRequestV1,
  ): Promise<ActivityDetailV1> {
    this.requireCapability(scope, 'READ_ACTIVITY_DETAIL');
    const record = await this.lookupIndexRecord(scope, request);
    const adapter = this.adapterFor(record.domainKind);
    return adapter.readDetail(this.adapterScope(scope), activityRootFromRecord(record));
  }

  /** Bounded Stage continuation for a concrete Activity resource. */
  async listActivityStages(
    scope: ActivityProductScopeV1,
    request: ListActivityContinuationRequestV1,
  ): Promise<ActivityStageContinuationV1> {
    this.requireCapability(scope, 'READ_ACTIVITY_STAGES');
    const record = await this.lookupIndexRecord(scope, request);
    const adapter = this.adapterFor(record.domainKind);
    return adapter.readStages(
      this.adapterScope(scope),
      activityRootFromRecord(record),
      request.cursor,
    );
  }

  /** Bounded Event continuation (bounded operational evidence, not History). */
  async listActivityEvents(
    scope: ActivityProductScopeV1,
    request: ListActivityContinuationRequestV1,
  ): Promise<ActivityEventContinuationV1> {
    this.requireCapability(scope, 'READ_ACTIVITY_EVENTS');
    const record = await this.lookupIndexRecord(scope, request);
    const adapter = this.adapterFor(record.domainKind);
    return adapter.readEvents(
      this.adapterScope(scope),
      activityRootFromRecord(record),
      request.cursor,
    );
  }

  /** Explicit authoritative refresh through the projection builder. */
  async refreshActivityProjection(
    scope: ActivityProductScopeV1,
    request: RefreshActivityProjectionRequestV1,
  ): Promise<ActivityProjectionBuildResultV1> {
    if (request.schemaVersion !== FRONTEND_ACTIVITY_API_VERSION) {
      throw new FrontendContractError('INVALID_REQUEST', 'Unsupported Activity refresh schema.');
    }
    this.requireCapability(scope, 'REFRESH_ACTIVITY_PROJECTION');
    return this.builder.buildProjectProjection(this.projectionScope(scope));
  }

  private adapterFor(domainKind: ActivityDomainKindV1): ActivityAdapterPort {
    const adapter = this.registry.adapterFor(domainKind as ActivityAdapterPort['domainKind']);
    if (adapter === undefined) return notFound();
    return adapter;
  }
}
