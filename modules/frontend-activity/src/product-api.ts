import {
  FRONTEND_ACTIVITY_API_VERSION,
  FrontendContractError,
  findBrowserAuthoredAuthorityFields,
  type ActivityAdapterStatusV1,
  type ActivityAttentionStateV1,
  type ActivityDimensionsV1,
  type ActivityDomainKindV1,
  type ActivityLifecycleStateV1,
  type ActivityProjectionFreshnessV1,
  type ActivityProjectionMetadataV1,
  type ActivityRootReferenceV1,
  type GetActivityDetailRequestV1,
  type ListActivityContinuationRequestV1,
  type ListActivityQueueRequestV1,
  type RefreshActivityProjectionRequestV1,
} from '../../../packages/contracts/src/index.js';

// The Activity Product API request types are owned by Contracts (single source
// of truth); this module re-exports them so the coordinator surface stays
// stable for adapters and the assembly boundary.
export type {
  GetActivityDetailRequestV1,
  ListActivityContinuationRequestV1,
  ListActivityQueueRequestV1,
  RefreshActivityProjectionRequestV1,
} from '../../../packages/contracts/src/index.js';
import {
  ACTIVITY_INDEX_ATTENTION,
  ACTIVITY_INDEX_DOMAIN_KINDS,
  ACTIVITY_INDEX_LIFECYCLE_STATES,
  combineAdapterAvailability,
  encodeActivityIndexCursor,
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
  /**
   * Required, allow-listed sensitivity clearance (server-derived). A missing,
   * empty or unknown value is rejected deny-by-default (Contract Snapshot §9).
   */
  readonly sensitivityClearance: 'public' | 'internal' | 'private' | 'restricted';
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

// --- strict runtime request decoders ---------------------------------------
//
// Every Activity Product API request is decoded at runtime: schemaVersion is
// enforced, required identity fields must be non-empty, enums are allow-listed,
// the page/continuation caps bound the read, and browser-authored authority
// fields (actor, principalId, activeProjectId, capability, policy, approval,
// credential, budget) are rejected. TypeScript types do not protect the server
// from browser input; these decoders do (Contract Snapshot §9, deny-by-default).

const requestFail = (message: string): never => {
  throw new FrontendContractError('INVALID_REQUEST', message);
};

const requestObject = (value: unknown, path: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return requestFail(`Activity request ${path} must be a non-null object`);
  }
  return value as Record<string, unknown>;
};

const strictRequestObject = (
  value: unknown,
  allowedKeys: readonly string[],
  path: string,
): Record<string, unknown> => {
  const object = requestObject(value, path);
  const unexpected = Object.keys(object).filter((key) => !allowedKeys.includes(key));
  if (unexpected.length > 0) {
    return requestFail(
      `Activity request ${path} contains unsupported fields: ${unexpected.join(', ')}`,
    );
  }
  const found = findBrowserAuthoredAuthorityFields(value);
  if (found.length > 0) {
    return requestFail(
      `Activity request ${path} must not carry browser-authored authority fields: ${found.join(', ')}`,
    );
  }
  return object;
};

const requestRequiredString = (object: Record<string, unknown>, key: string): string => {
  const value = object[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    return requestFail(`Activity request field ${key} must be a non-empty string`);
  }
  return value;
};

const requestOptionalString = (
  object: Record<string, unknown>,
  key: string,
): string | undefined => {
  if (object[key] === undefined) return undefined;
  return requestRequiredString(object, key);
};

const requestSchemaVersion = (object: Record<string, unknown>): void => {
  const schemaVersion = requestRequiredString(object, 'schemaVersion');
  if (schemaVersion !== FRONTEND_ACTIVITY_API_VERSION) {
    return requestFail('Activity request schemaVersion must be 1.0.0');
  }
};

const requestStringEnum = <T extends string>(
  object: Record<string, unknown>,
  key: string,
  values: readonly T[],
): T => {
  const value = requestRequiredString(object, key);
  if (!values.includes(value as T)) {
    return requestFail(`Activity request field ${key} must be one of ${values.join(', ')}`);
  }
  return value as T;
};

const requestStringArrayEnum = <T extends string>(
  object: Record<string, unknown>,
  key: string,
  values: readonly T[],
): readonly T[] | undefined => {
  if (object[key] === undefined) return undefined;
  const array = object[key];
  if (!Array.isArray(array)) {
    return requestFail(`Activity request field ${key} must be an array`);
  }
  return array.map((entry) => {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      return requestFail(`Activity request field ${key} must contain only non-empty strings`);
    }
    if (!values.includes(entry as T)) {
      return requestFail(`Activity request field ${key} must be one of ${values.join(', ')}`);
    }
    return entry as T;
  });
};

const requestBoundedLimit = (object: Record<string, unknown>, cap: number): number | undefined => {
  if (object.limit === undefined) return undefined;
  const value = object.limit;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    return requestFail('Activity request field limit must be a positive safe integer');
  }
  return Math.min(cap, value);
};

/** Decode a List Activity Queue request (schema + filters + bounded limit). */
export const decodeListActivityQueueRequestV1 = (value: unknown): ListActivityQueueRequestV1 => {
  const object = strictRequestObject(
    value,
    ['schemaVersion', 'domainKinds', 'states', 'attention', 'cursor', 'limit'],
    'listActivityQueue',
  );
  requestSchemaVersion(object);
  const domainKinds = requestStringArrayEnum(object, 'domainKinds', ACTIVITY_INDEX_DOMAIN_KINDS);
  const states = requestStringArrayEnum(object, 'states', ACTIVITY_INDEX_LIFECYCLE_STATES);
  const attention =
    object.attention === undefined
      ? undefined
      : requestStringEnum(object, 'attention', ACTIVITY_INDEX_ATTENTION);
  const cursor = requestOptionalString(object, 'cursor');
  const limit = requestBoundedLimit(object, ACTIVITY_QUEUE_PAGE_SIZE_CAP);
  return {
    schemaVersion: FRONTEND_ACTIVITY_API_VERSION,
    ...(domainKinds === undefined ? {} : { domainKinds }),
    ...(states === undefined ? {} : { states }),
    ...(attention === undefined ? {} : { attention }),
    ...(cursor === undefined ? {} : { cursor }),
    ...(limit === undefined ? {} : { limit }),
  };
};

const decodeIdentityRequest = (
  value: unknown,
  allowedKeys: readonly string[],
  path: string,
): {
  readonly domainKind: ActivityDomainKindV1;
  readonly activityId: string;
  readonly domainResourceKind: string;
  readonly domainResourceId: string;
  readonly cursor?: string;
  readonly limit?: number;
} => {
  const object = strictRequestObject(value, allowedKeys, path);
  requestSchemaVersion(object);
  const domainKind = requestStringEnum(object, 'domainKind', ACTIVITY_INDEX_DOMAIN_KINDS);
  const activityId = requestRequiredString(object, 'activityId');
  const domainResourceKind = requestRequiredString(object, 'domainResourceKind');
  const domainResourceId = requestRequiredString(object, 'domainResourceId');
  const cursor = requestOptionalString(object, 'cursor');
  const limit = requestBoundedLimit(object, ACTIVITY_STAGE_LIST_CAP);
  return {
    domainKind,
    activityId,
    domainResourceKind,
    domainResourceId,
    ...(cursor === undefined ? {} : { cursor }),
    ...(limit === undefined ? {} : { limit }),
  };
};

/** Decode a Get Activity Detail request. */
export const decodeGetActivityDetailRequestV1 = (value: unknown): GetActivityDetailRequestV1 => {
  const decoded = decodeIdentityRequest(
    value,
    ['schemaVersion', 'domainKind', 'activityId', 'domainResourceKind', 'domainResourceId'],
    'getActivityDetail',
  );
  return {
    schemaVersion: FRONTEND_ACTIVITY_API_VERSION,
    domainKind: decoded.domainKind,
    activityId: decoded.activityId,
    domainResourceKind: decoded.domainResourceKind,
    domainResourceId: decoded.domainResourceId,
  };
};

/** Decode a List Activity Stage/Event continuation request. */
export const decodeListActivityContinuationRequestV1 = (
  value: unknown,
): ListActivityContinuationRequestV1 => {
  const decoded = decodeIdentityRequest(
    value,
    [
      'schemaVersion',
      'domainKind',
      'activityId',
      'domainResourceKind',
      'domainResourceId',
      'cursor',
      'limit',
    ],
    'listActivityContinuation',
  );
  return {
    schemaVersion: FRONTEND_ACTIVITY_API_VERSION,
    domainKind: decoded.domainKind,
    activityId: decoded.activityId,
    domainResourceKind: decoded.domainResourceKind,
    domainResourceId: decoded.domainResourceId,
    ...(decoded.cursor === undefined ? {} : { cursor: decoded.cursor }),
    ...(decoded.limit === undefined ? {} : { limit: decoded.limit }),
  };
};

/** Decode a Refresh Activity Projection request. */
export const decodeRefreshActivityProjectionRequestV1 = (
  value: unknown,
): RefreshActivityProjectionRequestV1 => {
  const object = strictRequestObject(value, ['schemaVersion'], 'refreshActivityProjection');
  requestSchemaVersion(object);
  return { schemaVersion: FRONTEND_ACTIVITY_API_VERSION };
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
      sensitivityClearance: scope.sensitivityClearance,
      accessScope: scope.accessScope,
    };
  }

  private projectionScope(scope: ActivityProductScopeV1): ActivityProjectionBuilderScopeV1 {
    return this.adapterScope(scope);
  }

  private requireCapability(scope: ActivityProductScopeV1, capability: ActivityCapabilityV1): void {
    this.assertValidProductScope(scope);
    if (!activityCapabilitiesForScope(scope).includes(capability)) {
      projectDenied();
    }
  }

  /**
   * Deny-by-default scope validation: a server-derived Product scope must carry
   * a Principal, an active Project, both revision bindings and an allow-listed
   * sensitivity clearance. The browser never authors these; an empty/missing/
   * unknown binding is rejected as a denial (Contract Snapshot §9).
   */
  private assertValidProductScope(scope: ActivityProductScopeV1): void {
    if (
      typeof scope.principalId !== 'string' ||
      scope.principalId.trim().length === 0 ||
      typeof scope.activeProjectId !== 'string' ||
      scope.activeProjectId.trim().length === 0 ||
      typeof scope.accessRevision !== 'string' ||
      scope.accessRevision.trim().length === 0 ||
      typeof scope.policyContextRevision !== 'string' ||
      scope.policyContextRevision.trim().length === 0 ||
      !Array.isArray(scope.accessScope) ||
      !['public', 'internal', 'private', 'restricted'].includes(scope.sensitivityClearance)
    ) {
      projectDenied();
    }
  }

  private async lookupIndexRecord(
    scope: ActivityProductScopeV1,
    request: {
      readonly domainKind: ActivityDomainKindV1;
      readonly activityId: string;
      readonly domainResourceKind: string;
      readonly domainResourceId: string;
    },
  ): Promise<ActivityIndexRecordV1> {
    // Queue→Detail lineage (AC-05): a direct identity lookup resolves ANY
    // queue-visible Activity through its concrete Domain reference without a
    // queue page cap. Non-disclosing: a missing, cross-project or reference-
    // mismatched resource produces the same NOT_FOUND and never leaks
    // existence or identity.
    const record = await this.store.index.findByIdentity({
      resourceProjectId: scope.activeProjectId,
      domainKind: request.domainKind,
      activityId: request.activityId,
    });
    if (
      record === undefined ||
      record.domainResourceKind !== request.domainResourceKind ||
      record.domainResourceId !== request.domainResourceId
    ) {
      return notFound();
    }
    return record;
  }

  /**
   * Read one page of QUEUE-ACCESSIBLE records in raw Project index order.
   *
   * Audience-safe pagination (R4-1): the page is filled up to `limit` with
   * rows that pass the owning adapter's non-disclosing `canAccess`
   * revalidation, and a continuation cursor is returned ONLY when a further
   * accessible row is confirmed to exist behind the last displayed row. An
   * empty page never carries a cursor, and a cursor is never issued for a
   * page that only has inaccessible rows behind it, so the existence or count
   * of inaccessible rows is never inferable from page density, an empty page
   * or cursor presence. When a cursor is present the page is full (limit rows).
   */
  private async readAccessibleQueuePage(input: {
    readonly scope: ActivityProductScopeV1;
    readonly domainKinds?: readonly ActivityDomainKindV1[];
    readonly states?: readonly ActivityLifecycleStateV1[];
    readonly attention?: ActivityAttentionStateV1;
    readonly cursor?: string;
    readonly limit: number;
  }): Promise<{ readonly records: ActivityIndexRecordV1[]; readonly nextCursor?: string }> {
    const adapterScope = this.adapterScope(input.scope);
    const records: ActivityIndexRecordV1[] = [];
    let rawCursor: string | undefined = input.cursor;
    let lastDisplayed: ActivityIndexRecordV1 | undefined;

    // Phase 1 — collect accessible rows in raw index order until the requested
    // page is full or the raw index is exhausted.
    while (records.length < input.limit) {
      const page = await this.store.index.queryProject({
        resourceProjectId: input.scope.activeProjectId,
        domainKinds: input.domainKinds,
        states: input.states,
        attention: input.attention,
        cursor: rawCursor,
        limit: input.limit,
      });
      if (page.records.length === 0) break;
      for (const record of page.records) {
        const adapter = this.registry.adapterFor(
          record.domainKind as ActivityAdapterPort['domainKind'],
        );
        if (adapter === undefined) continue;
        if (await adapter.canAccess(adapterScope, activityRootFromRecord(record))) {
          records.push(record);
          lastDisplayed = record;
          if (records.length >= input.limit) break;
        }
      }
      if (page.nextCursor === undefined) break;
      rawCursor = page.nextCursor;
    }

    // Phase 2 — a cursor is issued only when the page is full AND a further
    // accessible row is confirmed behind the last displayed row. The cursor is
    // the keyset position of the last displayed row, so the next page resumes
    // exactly after it (no duplicate, no gap) regardless of how many
    // inaccessible rows sat between raw pages.
    if (records.length < input.limit || lastDisplayed === undefined) {
      return { records };
    }
    const resumeCursor = encodeActivityIndexCursor({
      updatedAt: lastDisplayed.updatedAt,
      domainKind: lastDisplayed.domainKind,
      activityId: lastDisplayed.activityId,
    });
    if (await this.hasAccessibleRecordAfter(input, adapterScope, resumeCursor)) {
      return { records, nextCursor: resumeCursor };
    }
    return { records };
  }

  /** Confirm an accessible row exists strictly after the given keyset cursor. */
  private async hasAccessibleRecordAfter(
    input: {
      readonly scope: ActivityProductScopeV1;
      readonly domainKinds?: readonly ActivityDomainKindV1[];
      readonly states?: readonly ActivityLifecycleStateV1[];
      readonly attention?: ActivityAttentionStateV1;
    },
    adapterScope: ActivityAdapterScopeV1,
    cursor: string,
  ): Promise<boolean> {
    let rawCursor: string | undefined = cursor;
    for (;;) {
      const page = await this.store.index.queryProject({
        resourceProjectId: input.scope.activeProjectId,
        domainKinds: input.domainKinds,
        states: input.states,
        attention: input.attention,
        cursor: rawCursor,
        limit: 1,
      });
      if (page.records.length === 0) return false;
      for (const record of page.records) {
        const adapter = this.registry.adapterFor(
          record.domainKind as ActivityAdapterPort['domainKind'],
        );
        if (adapter === undefined) continue;
        if (await adapter.canAccess(adapterScope, activityRootFromRecord(record))) return true;
      }
      if (page.nextCursor === undefined) return false;
      rawCursor = page.nextCursor;
    }
  }

  /** Project-scoped Activity Queue read with filters and stable ordering. */
  async listActivityQueue(
    scope: ActivityProductScopeV1,
    request: ListActivityQueueRequestV1,
  ): Promise<ActivityQueuePageV1> {
    this.requireCapability(scope, 'LIST_ACTIVITY');
    const decoded = decodeListActivityQueueRequestV1(request);
    const limit = Math.min(ACTIVITY_QUEUE_PAGE_SIZE_CAP, Math.max(1, decoded.limit ?? 20));
    // Audience isolation: the Projection is Project-shared, so each queue row
    // is revalidated through the owning adapter's non-disclosing `canAccess`
    // (principal ownership, sensitivity, access/policy revisions). Pagination
    // is audience-safe (R4-1): the page is filled with accessible rows and the
    // cursor never leaks the existence or count of inaccessible rows.
    const { records: accessibleRecords, nextCursor } = await this.readAccessibleQueuePage({
      scope,
      domainKinds: decoded.domainKinds,
      states: decoded.states,
      attention: decoded.attention,
      cursor: decoded.cursor,
      limit,
    });
    const watermarks = await this.store.watermarks.readByProject(scope.activeProjectId);
    const metadata = activityProjectionMetadataFrom({
      records: accessibleRecords,
      watermarks,
      now: this.nowIso(),
      expectedAdapterCount: this.registry.adapters.length,
    });
    return {
      items: accessibleRecords.map(activityQueueItemFromRecord),
      metadata,
      ...(nextCursor === undefined ? {} : { nextCursor }),
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
    const decoded = decodeGetActivityDetailRequestV1(request);
    const record = await this.lookupIndexRecord(scope, decoded);
    const adapter = this.adapterFor(record.domainKind);
    return adapter.readDetail(this.adapterScope(scope), activityRootFromRecord(record));
  }

  /** Bounded Stage continuation for a concrete Activity resource. */
  async listActivityStages(
    scope: ActivityProductScopeV1,
    request: ListActivityContinuationRequestV1,
  ): Promise<ActivityStageContinuationV1> {
    this.requireCapability(scope, 'READ_ACTIVITY_STAGES');
    const decoded = decodeListActivityContinuationRequestV1(request);
    const record = await this.lookupIndexRecord(scope, decoded);
    const adapter = this.adapterFor(record.domainKind);
    const limit = Math.min(
      ACTIVITY_STAGE_LIST_CAP,
      Math.max(1, decoded.limit ?? ACTIVITY_STAGE_LIST_CAP),
    );
    const continuation = await adapter.readStages(
      this.adapterScope(scope),
      activityRootFromRecord(record),
      decoded.cursor,
      limit,
    );
    // The server-enforced cap is authoritative: an adapter can never return
    // more stages than the resolved (requested, capped) bound.
    return {
      ...continuation,
      stages: continuation.stages.slice(0, limit),
    };
  }

  /** Bounded Event continuation (bounded operational evidence, not History). */
  async listActivityEvents(
    scope: ActivityProductScopeV1,
    request: ListActivityContinuationRequestV1,
  ): Promise<ActivityEventContinuationV1> {
    this.requireCapability(scope, 'READ_ACTIVITY_EVENTS');
    const decoded = decodeListActivityContinuationRequestV1(request);
    const record = await this.lookupIndexRecord(scope, decoded);
    const adapter = this.adapterFor(record.domainKind);
    const limit = Math.min(
      ACTIVITY_EVENT_LIST_CAP,
      Math.max(1, decoded.limit ?? ACTIVITY_EVENT_LIST_CAP),
    );
    const continuation = await adapter.readEvents(
      this.adapterScope(scope),
      activityRootFromRecord(record),
      decoded.cursor,
      limit,
    );
    // The server-enforced cap is authoritative.
    return {
      ...continuation,
      events: continuation.events.slice(0, limit),
    };
  }

  /** Explicit authoritative refresh through the projection builder. */
  async refreshActivityProjection(
    scope: ActivityProductScopeV1,
    request: RefreshActivityProjectionRequestV1,
  ): Promise<ActivityProjectionBuildResultV1> {
    decodeRefreshActivityProjectionRequestV1(request);
    this.requireCapability(scope, 'REFRESH_ACTIVITY_PROJECTION');
    return this.builder.buildProjectProjection(this.projectionScope(scope));
  }

  private adapterFor(domainKind: ActivityDomainKindV1): ActivityAdapterPort {
    const adapter = this.registry.adapterFor(domainKind as ActivityAdapterPort['domainKind']);
    if (adapter === undefined) return notFound();
    return adapter;
  }
}
