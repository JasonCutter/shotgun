import { FrontendContractError } from './frontend-foundation.js';

/**
 * FE-P5-S1 Agent and Job Activity Workspace — exact V1 contracts.
 *
 * Frozen by FE-P5-S1 Contract Snapshot revision 1 (approved 2026-08-06) and
 * ADR-130 (accepted 2026-08-06). These are read-projection view contracts:
 * Activity never owns Domain execution authority, generic retry/cancel
 * commands, or the FE-P5-S2 immutable History ledger.
 *
 * Server-authoritative boundary:
 * - The browser never submits Actor, Principal, Project, Capability, Policy,
 *   Approval, Credential or Budget authority through Activity payloads.
 * - `activityId` is projection identity only; it never replaces the concrete
 *   Domain Resource identity (`domainResourceId`).
 * - Domain Attempt and Transport Attempt are distinct; a Transport Attempt is
 *   never returned as a Domain Attempt.
 * - Retry and Cancel are shown only as server-derived references to the owning
 *   Domain command routes; the server revalidates state and authority.
 * - Decoders are strict: unknown fields, empty/whitespace-only IDs and unknown
 *   discriminants are rejected. Decoders additionally reject any payload that
 *   carries browser-authored authority fields.
 */

export type FrontendActivitySchemaVersion = '1.0.0';

export const FRONTEND_ACTIVITY_API_VERSION = '1.0.0' as const;

/** Federated projection domain kinds (Contract Snapshot §3). */
export type ActivityDomainKindV1 =
  'SOURCES' | 'ASK' | 'EXTERNAL_ACTION' | 'DISCOVERY' | 'CONNECTOR_DIAGNOSTICS';

/** An Activity root is either a durable Job or a Run (ADR-130 §2). */
export type ActivityRootKindV1 = 'JOB' | 'RUN';

/** Common lifecycle states (Contract Snapshot §5). */
export type ActivityLifecycleStateV1 =
  | 'QUEUED'
  | 'RUNNING'
  | 'WAITING_FOR_USER'
  | 'PARTIAL'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCEL_REQUESTED'
  | 'CANCELLED'
  | 'OUTCOME_UNKNOWN';

/** Projection freshness is a separate dimension (never a Domain state). */
export type ActivityProjectionFreshnessV1 = 'CURRENT' | 'LAGGING' | 'STALE' | 'UNKNOWN';

/** Adapter availability is a separate dimension. */
export type ActivityAdapterStatusV1 = 'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE';

/** Safe failure classification (allow-listed, non-disclosing). */
export type ActivityFailureKindV1 = 'TRANSIENT' | 'PERMANENT' | 'OUTCOME_UNKNOWN' | 'CANCELLED';

export type ActivityRetryabilityV1 = 'RETRYABLE' | 'NOT_RETRYABLE' | 'UNKNOWN';

/**
 * Owning-Domain retry mode. Sources and Ask distinguish `RETRY_SAME_CONTEXT`
 * (re-run in the original context) from `RETRY_CURRENT_POLICY` (re-run under
 * the current policy). The server preserves this mode end-to-end so the
 * browser never arbitrarily picks a mode (WP5 Round 1 review).
 */
export type ActivityRetryModeV1 = 'SAME_CONTEXT' | 'CURRENT_POLICY';

export const ACTIVITY_RETRY_MODES: readonly ActivityRetryModeV1[] = [
  'SAME_CONTEXT',
  'CURRENT_POLICY',
] as const;

/**
 * Server-derived available action descriptor (WP5 — Existing Domain action
 * delegation). Activity never owns generic Retry/Cancel commands: the server
 * derives each executable action from the owning-Domain capabilities and
 * carries the command context the client needs to invoke the existing
 * owning-Domain command route (ADR-130 §3, Contract Snapshot §7, AC-13).
 *
 * - `CANCEL` (Sources/Ask) — plain cancel of the concrete Domain resource.
 * - `CANCEL` with `actionRevision` (External Action) — cancel needs the
 *   expected Action aggregate revision.
 * - `RETRY` with `retryMode` (Sources/Ask) — retry in the given mode.
 * - `RETRY` with `executionId`/`sourceAttemptId`/`causationId` (External
 *   Action) — retry of the source Execution Attempt with the causation link.
 */
export type ActivityAvailableActionV1 = {
  readonly schemaVersion: FrontendActivitySchemaVersion;
  readonly kind: 'CANCEL' | 'RETRY';
  /** Sources/Ask retry mode — present when the Domain distinguishes modes. */
  readonly retryMode?: ActivityRetryModeV1;
  /** External Action cancel command context (expected action revision). */
  readonly actionRevision?: number;
  /** External Action retry command context. */
  readonly executionId?: string;
  readonly sourceAttemptId?: string;
  readonly causationId?: string;
};

export const decodeActivityAvailableActionV1 = (
  value: unknown,
  path = 'availableAction',
): ActivityAvailableActionV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'kind',
      'retryMode',
      'actionRevision',
      'executionId',
      'sourceAttemptId',
      'causationId',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  const kind = enumValue(required(object, 'kind', path), ['CANCEL', 'RETRY'], `${path}.kind`);
  return {
    schemaVersion: '1.0.0',
    kind,
    ...(object.retryMode === undefined
      ? {}
      : {
          retryMode: enumValue(object.retryMode, ACTIVITY_RETRY_MODES, `${path}.retryMode`),
        }),
    ...(object.actionRevision === undefined
      ? {}
      : {
          actionRevision: positiveInteger(object.actionRevision, `${path}.actionRevision`),
        }),
    ...(object.executionId === undefined
      ? {}
      : { executionId: text(required(object, 'executionId', path), `${path}.executionId`) }),
    ...(object.sourceAttemptId === undefined
      ? {}
      : {
          sourceAttemptId: text(
            required(object, 'sourceAttemptId', path),
            `${path}.sourceAttemptId`,
          ),
        }),
    ...(object.causationId === undefined
      ? {}
      : { causationId: text(required(object, 'causationId', path), `${path}.causationId`) }),
  };
};

export type ActivityAttentionStateV1 = 'NEEDS_ATTENTION' | 'RESOLVED' | 'NONE';

/** Domain Attempt kinds by owning Domain (ADR-130 §2 mapping). */
export type ActivityDomainAttemptKindV1 =
  'SOURCES_INTAKE' | 'ASK_ANSWER' | 'EXTERNAL_ACTION_EXECUTION' | 'DISCOVERY_EXECUTION';

export type ActivityStageStateV1 =
  'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED' | 'OUTCOME_UNKNOWN';

/** Bounded operational event categories (not FE-P5-S2 History). */
export type ActivityEventCategoryV1 =
  | 'QUEUED'
  | 'STARTED'
  | 'PROGRESS'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'RETRY_SCHEDULED'
  | 'CANCELLED'
  | 'OUTCOME_UNKNOWN'
  | 'USER_ATTENTION';

export type ActivityTransportResultV1 = 'DELIVERED' | 'FAILED' | 'TIMED_OUT' | 'OUTCOME_UNKNOWN';

// ---------------------------------------------------------------------------
// Typed references (identities remain separate)
// ---------------------------------------------------------------------------

/** A typed reference to a Domain resource. It is never an ID equivalence. */
export type ActivityResourceRefV1 = {
  readonly schemaVersion: FrontendActivitySchemaVersion;
  readonly resourceKind: string;
  readonly resourceId: string;
  readonly resourceRevision?: number;
};

/** Correlation or causation reference (ADR-130 §2 identity separation). */
export type ActivityCorrelationRefV1 = {
  readonly schemaVersion: FrontendActivitySchemaVersion;
  readonly refType: 'CORRELATION' | 'CAUSATION';
  readonly refKind: string;
  readonly refId: string;
};

/** Safe, allow-listed failure detail (Contract Snapshot §9). */
export type ActivitySafeFailureV1 = {
  readonly schemaVersion: FrontendActivitySchemaVersion;
  readonly kind: ActivityFailureKindV1;
  readonly code: string;
  readonly message: string;
  readonly occurredAt: string;
};

/** Bounded progress (separate dimension). */
export type ActivityBoundedProgressV1 = {
  readonly schemaVersion: FrontendActivitySchemaVersion;
  readonly current: number;
  readonly total: number;
  readonly percent?: number;
};

// ---------------------------------------------------------------------------
// Activity views (Contract Snapshot §4)
// ---------------------------------------------------------------------------

/** §4.1 — projection identity plus concrete Domain Resource identity. */
export type ActivityRootReferenceV1 = {
  readonly schemaVersion: FrontendActivitySchemaVersion;
  readonly rootKind: ActivityRootKindV1;
  readonly activityId: string;
  readonly domainKind: ActivityDomainKindV1;
  readonly domainResourceKind: string;
  readonly domainResourceId: string;
  readonly resourceProjectId: string;
  readonly resourceHref: string;
  readonly jobId?: string;
  readonly runId: string;
};

/** §4.2 — Run view. */
export type ActivityRunViewV1 = {
  readonly schemaVersion: FrontendActivitySchemaVersion;
  readonly runId: string;
  readonly jobId?: string;
  readonly sequence: number;
  readonly state: ActivityLifecycleStateV1;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
  readonly domainAttemptRefs: readonly ActivityResourceRefV1[];
  readonly correlationRefs: readonly ActivityCorrelationRefV1[];
  readonly causationRefs: readonly ActivityCorrelationRefV1[];
};

/** §4.3 — Domain Attempt view. */
export type ActivityDomainAttemptViewV1 = {
  readonly schemaVersion: FrontendActivitySchemaVersion;
  readonly attemptId: string;
  readonly runId: string;
  readonly attemptNumber: number;
  readonly attemptKind: ActivityDomainAttemptKindV1;
  readonly state: ActivityLifecycleStateV1;
  readonly retryability: ActivityRetryabilityV1;
  readonly failure?: ActivitySafeFailureV1;
  readonly accessRef?: ActivityResourceRefV1;
  readonly policyContextRef?: ActivityResourceRefV1;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
  readonly stageRefs: readonly ActivityResourceRefV1[];
};

/** §4.4 — Transport Attempt view (never a Domain Attempt). */
export type ActivityTransportAttemptViewV1 = {
  readonly schemaVersion: FrontendActivitySchemaVersion;
  readonly transportAttemptId: string;
  readonly transportKind: string;
  readonly commandOrMessageRef: ActivityResourceRefV1;
  readonly deliverySequence: number;
  readonly deliveryResult: ActivityTransportResultV1;
  readonly deliveredAt: string;
  readonly failure?: ActivitySafeFailureV1;
};

/** §4.5 — Stage view. */
export type ActivityStageViewV1 = {
  readonly schemaVersion: FrontendActivitySchemaVersion;
  readonly stageId: string;
  readonly stageKey: string;
  readonly label: string;
  readonly sequence: number;
  readonly state: ActivityStageStateV1;
  readonly progress?: ActivityBoundedProgressV1;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
  readonly failure?: ActivitySafeFailureV1;
};

/** §4.6 — bounded operational event view. */
export type ActivityEventViewV1 = {
  readonly schemaVersion: FrontendActivitySchemaVersion;
  readonly eventId: string;
  readonly relatedRef: ActivityResourceRefV1;
  readonly category: ActivityEventCategoryV1;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly summary: string;
  readonly domainResourceRef?: ActivityResourceRefV1;
};

/** §4.7 — projection metadata. */
export type ActivityProjectionMetadataV1 = {
  readonly schemaVersion: FrontendActivitySchemaVersion;
  readonly snapshotRevision: number;
  readonly generatedAt: string;
  readonly sourceUpdatedAt: string;
  readonly freshness: ActivityProjectionFreshnessV1;
  readonly lagMilliseconds?: number;
  readonly adapterStatus: ActivityAdapterStatusV1;
  readonly partial: boolean;
  readonly cursor?: string;
};

/** §5 — separate projection dimensions. */
export type ActivityDimensionsV1 = {
  readonly schemaVersion: FrontendActivitySchemaVersion;
  readonly progress?: ActivityBoundedProgressV1;
  readonly attention: ActivityAttentionStateV1;
  readonly failure?: ActivitySafeFailureV1;
  readonly retryability: ActivityRetryabilityV1;
  readonly freshness: ActivityProjectionFreshnessV1;
  readonly adapterStatus: ActivityAdapterStatusV1;
};

// ---------------------------------------------------------------------------
// Strict decoders
// ---------------------------------------------------------------------------

type ObjectValue = Record<string, unknown>;

const fail = (path: string, message: string): never => {
  throw new FrontendContractError('INVALID_REQUEST', `invalid ${path}: ${message}`);
};

const asObject = (value: unknown, path: string): ObjectValue => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(path, 'must be a non-null object');
  }
  return value as ObjectValue;
};

const strictObject = (
  value: unknown,
  allowedKeys: readonly string[],
  path: string,
): ObjectValue => {
  const object = asObject(value, path);
  const unexpected = Object.keys(object).filter((key) => !allowedKeys.includes(key));
  if (unexpected.length > 0) {
    return fail(path, `contains unsupported fields: ${unexpected.join(', ')}`);
  }
  return object;
};

const required = (object: ObjectValue, key: string, path: string): unknown => {
  if (!(key in object) || object[key] === undefined) return fail(`${path}.${key}`, 'is required');
  return object[key];
};

const text = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return fail(path, 'must be a non-empty string');
  }
  return value;
};

const optionalText = (value: unknown, path: string): string | undefined => {
  if (value === undefined) return undefined;
  return text(value, path);
};

const integer = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return fail(path, 'must be a non-negative safe integer');
  }
  return value;
};

const positiveInteger = (value: unknown, path: string): number => {
  const result = integer(value, path);
  if (result <= 0) return fail(path, 'must be a positive safe integer');
  return result;
};

const booleanValue = (value: unknown, path: string): boolean => {
  if (typeof value !== 'boolean') return fail(path, 'must be a boolean');
  return value;
};

const enumValue = <T extends string>(value: unknown, values: readonly T[], path: string): T => {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    return fail(path, `must be one of ${values.join(', ')}`);
  }
  return value as T;
};

const arrayValue = (value: unknown, path: string): readonly unknown[] => {
  if (!Array.isArray(value)) return fail(path, 'must be an array');
  return value;
};

const isoTimestamp = (value: unknown, path: string): string => {
  const result = text(value, path);
  if (Number.isNaN(Date.parse(result))) return fail(path, 'must be an ISO timestamp');
  return result;
};

const optionalIsoTimestamp = (value: unknown, path: string): string | undefined => {
  if (value === undefined) return undefined;
  return isoTimestamp(value, path);
};

const decodeSchemaVersion = (object: ObjectValue, path: string): void => {
  const schemaVersion = text(required(object, 'schemaVersion', path), `${path}.schemaVersion`);
  if (schemaVersion !== '1.0.0') return fail(`${path}.schemaVersion`, 'must be 1.0.0');
};

const assertNotAfter = (earlier: string, later: string, path: string): void => {
  if (Date.parse(later) < Date.parse(earlier)) {
    return fail(path, 'timestamp ordering is violated');
  }
};

const ACTIVITY_DOMAIN_KINDS = [
  'SOURCES',
  'ASK',
  'EXTERNAL_ACTION',
  'DISCOVERY',
  'CONNECTOR_DIAGNOSTICS',
] as const;
const ACTIVITY_ROOT_KINDS = ['JOB', 'RUN'] as const;
const ACTIVITY_LIFECYCLE_STATES = [
  'QUEUED',
  'RUNNING',
  'WAITING_FOR_USER',
  'PARTIAL',
  'SUCCEEDED',
  'FAILED',
  'CANCEL_REQUESTED',
  'CANCELLED',
  'OUTCOME_UNKNOWN',
] as const;
const ACTIVITY_FRESHNESS = ['CURRENT', 'LAGGING', 'STALE', 'UNKNOWN'] as const;
const ACTIVITY_ADAPTER_STATUS = ['AVAILABLE', 'DEGRADED', 'UNAVAILABLE'] as const;
const ACTIVITY_FAILURE_KINDS = ['TRANSIENT', 'PERMANENT', 'OUTCOME_UNKNOWN', 'CANCELLED'] as const;
const ACTIVITY_RETRYABILITY = ['RETRYABLE', 'NOT_RETRYABLE', 'UNKNOWN'] as const;
const ACTIVITY_ATTENTION = ['NEEDS_ATTENTION', 'RESOLVED', 'NONE'] as const;
const ACTIVITY_ATTEMPT_KINDS = [
  'SOURCES_INTAKE',
  'ASK_ANSWER',
  'EXTERNAL_ACTION_EXECUTION',
  'DISCOVERY_EXECUTION',
] as const;
const ACTIVITY_STAGE_STATES = [
  'PENDING',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'SKIPPED',
  'OUTCOME_UNKNOWN',
] as const;
const ACTIVITY_EVENT_CATEGORIES = [
  'QUEUED',
  'STARTED',
  'PROGRESS',
  'SUCCEEDED',
  'FAILED',
  'RETRY_SCHEDULED',
  'CANCELLED',
  'OUTCOME_UNKNOWN',
  'USER_ATTENTION',
] as const;
const ACTIVITY_TRANSPORT_RESULTS = ['DELIVERED', 'FAILED', 'TIMED_OUT', 'OUTCOME_UNKNOWN'] as const;

/**
 * Fields that carry execution or access authority. Activity view/request
 * decoders reject any payload that contains them: the browser never authors
 * Actor, Principal, Project, Capability, Policy, Approval, Credential or
 * Budget authority (Contract Snapshot §9, ADR-130 §7).
 */
export const ACTIVITY_BROWSER_AUTHORITY_FIELDS = [
  'actor',
  'principalId',
  'activeProjectId',
  'capability',
  'capabilities',
  'policyContext',
  'policyContextId',
  'approval',
  'credential',
  'budget',
] as const;

export type ActivityBrowserAuthorityField = (typeof ACTIVITY_BROWSER_AUTHORITY_FIELDS)[number];

/**
 * Reject any payload that attempts to carry browser-authored authority.
 * Returns the list of offending fields (empty when the payload is clean).
 */
export const findBrowserAuthoredAuthorityFields = (value: unknown): readonly string[] => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  const object = value as Record<string, unknown>;
  return ACTIVITY_BROWSER_AUTHORITY_FIELDS.filter((field) => Object.hasOwn(object, field));
};

const assertNoBrowserAuthoredAuthority = (value: unknown, path: string): void => {
  const found = findBrowserAuthoredAuthorityFields(value);
  if (found.length > 0) {
    return fail(path, `must not carry browser-authored authority fields: ${found.join(', ')}`);
  }
};

// --- typed references ------------------------------------------------------

export const decodeActivityResourceRefV1 = (
  value: unknown,
  path = 'resourceRef',
): ActivityResourceRefV1 => {
  const object = strictObject(
    value,
    ['schemaVersion', 'resourceKind', 'resourceId', 'resourceRevision'],
    path,
  );
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    resourceKind: text(required(object, 'resourceKind', path), `${path}.resourceKind`),
    resourceId: text(required(object, 'resourceId', path), `${path}.resourceId`),
    resourceRevision:
      object.resourceRevision === undefined
        ? undefined
        : positiveInteger(object.resourceRevision, `${path}.resourceRevision`),
  };
};

export const decodeActivityCorrelationRefV1 = (
  value: unknown,
  path = 'correlationRef',
): ActivityCorrelationRefV1 => {
  const object = strictObject(value, ['schemaVersion', 'refType', 'refKind', 'refId'], path);
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    refType: enumValue(
      required(object, 'refType', path),
      ['CORRELATION', 'CAUSATION'],
      `${path}.refType`,
    ),
    refKind: text(required(object, 'refKind', path), `${path}.refKind`),
    refId: text(required(object, 'refId', path), `${path}.refId`),
  };
};

export const decodeActivitySafeFailureV1 = (
  value: unknown,
  path = 'failure',
): ActivitySafeFailureV1 => {
  const object = strictObject(
    value,
    ['schemaVersion', 'kind', 'code', 'message', 'occurredAt'],
    path,
  );
  decodeSchemaVersion(object, path);
  const occurredAt = isoTimestamp(required(object, 'occurredAt', path), `${path}.occurredAt`);
  return {
    schemaVersion: '1.0.0',
    kind: enumValue(required(object, 'kind', path), ACTIVITY_FAILURE_KINDS, `${path}.kind`),
    code: text(required(object, 'code', path), `${path}.code`),
    message: text(required(object, 'message', path), `${path}.message`),
    occurredAt,
  };
};

export const decodeActivityBoundedProgressV1 = (
  value: unknown,
  path = 'progress',
): ActivityBoundedProgressV1 => {
  const object = strictObject(value, ['schemaVersion', 'current', 'total', 'percent'], path);
  decodeSchemaVersion(object, path);
  const current = integer(required(object, 'current', path), `${path}.current`);
  const total = positiveInteger(required(object, 'total', path), `${path}.total`);
  if (current > total) return fail(`${path}.current`, 'must not exceed total');
  const percent =
    object.percent === undefined
      ? undefined
      : (() => {
          const valueOf = required(object, 'percent', path);
          if (typeof valueOf !== 'number' || !Number.isFinite(valueOf)) {
            return fail(`${path}.percent`, 'must be a finite number');
          }
          if (valueOf < 0 || valueOf > 100) return fail(`${path}.percent`, 'must be within 0..100');
          return valueOf;
        })();
  return { schemaVersion: '1.0.0', current, total, ...(percent === undefined ? {} : { percent }) };
};

// --- Activity views --------------------------------------------------------

export const decodeActivityRootReferenceV1 = (
  value: unknown,
  path = 'root',
): ActivityRootReferenceV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'rootKind',
      'activityId',
      'domainKind',
      'domainResourceKind',
      'domainResourceId',
      'resourceProjectId',
      'resourceHref',
      'jobId',
      'runId',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  assertNoBrowserAuthoredAuthority(value, path);
  const domainKind = enumValue(
    required(object, 'domainKind', path),
    ACTIVITY_DOMAIN_KINDS,
    `${path}.domainKind`,
  );
  const rootKind = enumValue(
    required(object, 'rootKind', path),
    ACTIVITY_ROOT_KINDS,
    `${path}.rootKind`,
  );
  // ADR-130 §2 / Contract Snapshot §6: Ask has no durable Job and must use a
  // RUN root; Sources, External Action and Discovery use a JOB root
  // (Connector Runtime keeps its internal diagnostic Job).
  const expectedRootKind: ActivityRootKindV1 = domainKind === 'ASK' ? 'RUN' : 'JOB';
  if (rootKind !== expectedRootKind) {
    return fail(`${path}.rootKind`, `must be ${expectedRootKind} for domainKind ${domainKind}`);
  }
  const runId = text(required(object, 'runId', path), `${path}.runId`);
  const jobId = optionalText(object.jobId, `${path}.jobId`);
  if (rootKind === 'JOB' && jobId === undefined) {
    return fail(`${path}.jobId`, 'is required when rootKind is JOB');
  }
  if (rootKind === 'RUN' && jobId !== undefined) {
    return fail(`${path}.jobId`, 'must be absent when rootKind is RUN');
  }
  return {
    schemaVersion: '1.0.0',
    rootKind,
    activityId: text(required(object, 'activityId', path), `${path}.activityId`),
    domainKind,
    domainResourceKind: text(
      required(object, 'domainResourceKind', path),
      `${path}.domainResourceKind`,
    ),
    domainResourceId: text(required(object, 'domainResourceId', path), `${path}.domainResourceId`),
    resourceProjectId: text(
      required(object, 'resourceProjectId', path),
      `${path}.resourceProjectId`,
    ),
    resourceHref: text(required(object, 'resourceHref', path), `${path}.resourceHref`),
    ...(jobId === undefined ? {} : { jobId }),
    runId,
  };
};

export const decodeActivityRunViewV1 = (value: unknown, path = 'run'): ActivityRunViewV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'runId',
      'jobId',
      'sequence',
      'state',
      'startedAt',
      'updatedAt',
      'completedAt',
      'domainAttemptRefs',
      'correlationRefs',
      'causationRefs',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  assertNoBrowserAuthoredAuthority(value, path);
  const startedAt = isoTimestamp(required(object, 'startedAt', path), `${path}.startedAt`);
  const updatedAt = isoTimestamp(required(object, 'updatedAt', path), `${path}.updatedAt`);
  const completedAt = optionalIsoTimestamp(object.completedAt, `${path}.completedAt`);
  if (completedAt !== undefined) {
    assertNotAfter(startedAt, completedAt, path);
    assertNotAfter(updatedAt, completedAt, path);
  } else {
    assertNotAfter(startedAt, updatedAt, path);
  }
  return {
    schemaVersion: '1.0.0',
    runId: text(required(object, 'runId', path), `${path}.runId`),
    jobId: optionalText(object.jobId, `${path}.jobId`),
    sequence: positiveInteger(required(object, 'sequence', path), `${path}.sequence`),
    state: enumValue(required(object, 'state', path), ACTIVITY_LIFECYCLE_STATES, `${path}.state`),
    startedAt,
    updatedAt,
    ...(completedAt === undefined ? {} : { completedAt }),
    domainAttemptRefs: arrayValue(
      required(object, 'domainAttemptRefs', path),
      `${path}.domainAttemptRefs`,
    ).map((entry, index) =>
      decodeActivityResourceRefV1(entry, `${path}.domainAttemptRefs[${index}]`),
    ),
    correlationRefs: arrayValue(
      required(object, 'correlationRefs', path),
      `${path}.correlationRefs`,
    ).map((entry, index) =>
      decodeActivityCorrelationRefV1(entry, `${path}.correlationRefs[${index}]`),
    ),
    causationRefs: arrayValue(required(object, 'causationRefs', path), `${path}.causationRefs`).map(
      (entry, index) => decodeActivityCorrelationRefV1(entry, `${path}.causationRefs[${index}]`),
    ),
  };
};

export const decodeActivityDomainAttemptViewV1 = (
  value: unknown,
  path = 'attempt',
): ActivityDomainAttemptViewV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'attemptId',
      'runId',
      'attemptNumber',
      'attemptKind',
      'state',
      'retryability',
      'failure',
      'accessRef',
      'policyContextRef',
      'startedAt',
      'updatedAt',
      'completedAt',
      'stageRefs',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  assertNoBrowserAuthoredAuthority(value, path);
  const startedAt = isoTimestamp(required(object, 'startedAt', path), `${path}.startedAt`);
  const updatedAt = isoTimestamp(required(object, 'updatedAt', path), `${path}.updatedAt`);
  const completedAt = optionalIsoTimestamp(object.completedAt, `${path}.completedAt`);
  if (completedAt !== undefined) {
    assertNotAfter(startedAt, completedAt, path);
    assertNotAfter(updatedAt, completedAt, path);
  } else {
    assertNotAfter(startedAt, updatedAt, path);
  }
  return {
    schemaVersion: '1.0.0',
    attemptId: text(required(object, 'attemptId', path), `${path}.attemptId`),
    runId: text(required(object, 'runId', path), `${path}.runId`),
    attemptNumber: positiveInteger(
      required(object, 'attemptNumber', path),
      `${path}.attemptNumber`,
    ),
    attemptKind: enumValue(
      required(object, 'attemptKind', path),
      ACTIVITY_ATTEMPT_KINDS,
      `${path}.attemptKind`,
    ),
    state: enumValue(required(object, 'state', path), ACTIVITY_LIFECYCLE_STATES, `${path}.state`),
    retryability: enumValue(
      required(object, 'retryability', path),
      ACTIVITY_RETRYABILITY,
      `${path}.retryability`,
    ),
    ...(object.failure === undefined
      ? {}
      : { failure: decodeActivitySafeFailureV1(object.failure, `${path}.failure`) }),
    ...(object.accessRef === undefined
      ? {}
      : { accessRef: decodeActivityResourceRefV1(object.accessRef, `${path}.accessRef`) }),
    ...(object.policyContextRef === undefined
      ? {}
      : {
          policyContextRef: decodeActivityResourceRefV1(
            object.policyContextRef,
            `${path}.policyContextRef`,
          ),
        }),
    startedAt,
    updatedAt,
    ...(completedAt === undefined ? {} : { completedAt }),
    stageRefs: arrayValue(required(object, 'stageRefs', path), `${path}.stageRefs`).map(
      (entry, index) => decodeActivityResourceRefV1(entry, `${path}.stageRefs[${index}]`),
    ),
  };
};

export const decodeActivityTransportAttemptViewV1 = (
  value: unknown,
  path = 'transportAttempt',
): ActivityTransportAttemptViewV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'transportAttemptId',
      'transportKind',
      'commandOrMessageRef',
      'deliverySequence',
      'deliveryResult',
      'deliveredAt',
      'failure',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  assertNoBrowserAuthoredAuthority(value, path);
  return {
    schemaVersion: '1.0.0',
    transportAttemptId: text(
      required(object, 'transportAttemptId', path),
      `${path}.transportAttemptId`,
    ),
    transportKind: text(required(object, 'transportKind', path), `${path}.transportKind`),
    commandOrMessageRef: decodeActivityResourceRefV1(
      required(object, 'commandOrMessageRef', path),
      `${path}.commandOrMessageRef`,
    ),
    deliverySequence: positiveInteger(
      required(object, 'deliverySequence', path),
      `${path}.deliverySequence`,
    ),
    deliveryResult: enumValue(
      required(object, 'deliveryResult', path),
      ACTIVITY_TRANSPORT_RESULTS,
      `${path}.deliveryResult`,
    ),
    deliveredAt: isoTimestamp(required(object, 'deliveredAt', path), `${path}.deliveredAt`),
    ...(object.failure === undefined
      ? {}
      : { failure: decodeActivitySafeFailureV1(object.failure, `${path}.failure`) }),
  };
};

export const decodeActivityStageViewV1 = (value: unknown, path = 'stage'): ActivityStageViewV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'stageId',
      'stageKey',
      'label',
      'sequence',
      'state',
      'progress',
      'startedAt',
      'updatedAt',
      'completedAt',
      'failure',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  assertNoBrowserAuthoredAuthority(value, path);
  const startedAt = isoTimestamp(required(object, 'startedAt', path), `${path}.startedAt`);
  const updatedAt = isoTimestamp(required(object, 'updatedAt', path), `${path}.updatedAt`);
  const completedAt = optionalIsoTimestamp(object.completedAt, `${path}.completedAt`);
  if (completedAt !== undefined) {
    assertNotAfter(startedAt, completedAt, path);
    assertNotAfter(updatedAt, completedAt, path);
  } else {
    assertNotAfter(startedAt, updatedAt, path);
  }
  return {
    schemaVersion: '1.0.0',
    stageId: text(required(object, 'stageId', path), `${path}.stageId`),
    stageKey: text(required(object, 'stageKey', path), `${path}.stageKey`),
    label: text(required(object, 'label', path), `${path}.label`),
    sequence: positiveInteger(required(object, 'sequence', path), `${path}.sequence`),
    state: enumValue(required(object, 'state', path), ACTIVITY_STAGE_STATES, `${path}.state`),
    ...(object.progress === undefined
      ? {}
      : { progress: decodeActivityBoundedProgressV1(object.progress, `${path}.progress`) }),
    startedAt,
    updatedAt,
    ...(completedAt === undefined ? {} : { completedAt }),
    ...(object.failure === undefined
      ? {}
      : { failure: decodeActivitySafeFailureV1(object.failure, `${path}.failure`) }),
  };
};

export const decodeActivityEventViewV1 = (value: unknown, path = 'event'): ActivityEventViewV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'eventId',
      'relatedRef',
      'category',
      'sequence',
      'occurredAt',
      'summary',
      'domainResourceRef',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  assertNoBrowserAuthoredAuthority(value, path);
  return {
    schemaVersion: '1.0.0',
    eventId: text(required(object, 'eventId', path), `${path}.eventId`),
    relatedRef: decodeActivityResourceRefV1(
      required(object, 'relatedRef', path),
      `${path}.relatedRef`,
    ),
    category: enumValue(
      required(object, 'category', path),
      ACTIVITY_EVENT_CATEGORIES,
      `${path}.category`,
    ),
    sequence: positiveInteger(required(object, 'sequence', path), `${path}.sequence`),
    occurredAt: isoTimestamp(required(object, 'occurredAt', path), `${path}.occurredAt`),
    summary: text(required(object, 'summary', path), `${path}.summary`),
    ...(object.domainResourceRef === undefined
      ? {}
      : {
          domainResourceRef: decodeActivityResourceRefV1(
            object.domainResourceRef,
            `${path}.domainResourceRef`,
          ),
        }),
  };
};

export const decodeActivityProjectionMetadataV1 = (
  value: unknown,
  path = 'metadata',
): ActivityProjectionMetadataV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'snapshotRevision',
      'generatedAt',
      'sourceUpdatedAt',
      'freshness',
      'lagMilliseconds',
      'adapterStatus',
      'partial',
      'cursor',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  const generatedAt = isoTimestamp(required(object, 'generatedAt', path), `${path}.generatedAt`);
  const sourceUpdatedAt = isoTimestamp(
    required(object, 'sourceUpdatedAt', path),
    `${path}.sourceUpdatedAt`,
  );
  const lagMilliseconds =
    object.lagMilliseconds === undefined
      ? undefined
      : (() => {
          const valueOf = required(object, 'lagMilliseconds', path);
          if (typeof valueOf !== 'number' || !Number.isFinite(valueOf) || valueOf < 0) {
            return fail(`${path}.lagMilliseconds`, 'must be a non-negative finite number');
          }
          return valueOf;
        })();
  return {
    schemaVersion: '1.0.0',
    snapshotRevision: positiveInteger(
      required(object, 'snapshotRevision', path),
      `${path}.snapshotRevision`,
    ),
    generatedAt,
    sourceUpdatedAt,
    freshness: enumValue(
      required(object, 'freshness', path),
      ACTIVITY_FRESHNESS,
      `${path}.freshness`,
    ),
    ...(lagMilliseconds === undefined ? {} : { lagMilliseconds }),
    adapterStatus: enumValue(
      required(object, 'adapterStatus', path),
      ACTIVITY_ADAPTER_STATUS,
      `${path}.adapterStatus`,
    ),
    partial: booleanValue(required(object, 'partial', path), `${path}.partial`),
    cursor: optionalText(object.cursor, `${path}.cursor`),
  };
};

export const decodeActivityDimensionsV1 = (
  value: unknown,
  path = 'dimensions',
): ActivityDimensionsV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'progress',
      'attention',
      'failure',
      'retryability',
      'freshness',
      'adapterStatus',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  assertNoBrowserAuthoredAuthority(value, path);
  return {
    schemaVersion: '1.0.0',
    ...(object.progress === undefined
      ? {}
      : { progress: decodeActivityBoundedProgressV1(object.progress, `${path}.progress`) }),
    attention: enumValue(
      required(object, 'attention', path),
      ACTIVITY_ATTENTION,
      `${path}.attention`,
    ),
    ...(object.failure === undefined
      ? {}
      : { failure: decodeActivitySafeFailureV1(object.failure, `${path}.failure`) }),
    retryability: enumValue(
      required(object, 'retryability', path),
      ACTIVITY_RETRYABILITY,
      `${path}.retryability`,
    ),
    freshness: enumValue(
      required(object, 'freshness', path),
      ACTIVITY_FRESHNESS,
      `${path}.freshness`,
    ),
    adapterStatus: enumValue(
      required(object, 'adapterStatus', path),
      ACTIVITY_ADAPTER_STATUS,
      `${path}.adapterStatus`,
    ),
  };
};

// ---------------------------------------------------------------------------
// Composite snapshot decoder
// ---------------------------------------------------------------------------

export type ActivitySnapshotV1 = {
  readonly schemaVersion: FrontendActivitySchemaVersion;
  readonly root: ActivityRootReferenceV1;
  readonly run: ActivityRunViewV1;
  readonly attempts: readonly ActivityDomainAttemptViewV1[];
  readonly stages: readonly ActivityStageViewV1[];
  readonly events: readonly ActivityEventViewV1[];
  readonly transportAttempts: readonly ActivityTransportAttemptViewV1[];
  readonly metadata: ActivityProjectionMetadataV1;
  readonly dimensions: ActivityDimensionsV1;
  /**
   * Server-derived available action descriptors (WP5). Empty when the owning
   * Domain does not allow Retry/Cancel for this Activity. The browser never
   * authors these; it only renders what the server returns and delegates
   * execution to the existing owning-Domain command route (FE-P5-S1-AC-13).
   */
  readonly availableActions: readonly ActivityAvailableActionV1[];
};

/**
 * Decode a full Activity snapshot and reject browser-authored authority.
 * This is the read boundary used by Queue and Detail adapters.
 */
export const decodeActivitySnapshotV1 = (value: unknown, path = 'activity'): ActivitySnapshotV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'root',
      'run',
      'attempts',
      'stages',
      'events',
      'transportAttempts',
      'metadata',
      'dimensions',
      'availableActions',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  assertNoBrowserAuthoredAuthority(value, path);
  const root = decodeActivityRootReferenceV1(required(object, 'root', path), `${path}.root`);
  const run = decodeActivityRunViewV1(required(object, 'run', path), `${path}.run`);
  if (run.runId !== root.runId) {
    return fail(`${path}.run.runId`, 'must match root.runId');
  }
  if (run.jobId !== root.jobId) {
    return fail(`${path}.run.jobId`, 'must match root.jobId');
  }
  const attempts = arrayValue(required(object, 'attempts', path), `${path}.attempts`).map(
    (entry, index) => decodeActivityDomainAttemptViewV1(entry, `${path}.attempts[${index}]`),
  );
  for (const attempt of attempts) {
    if (attempt.runId !== root.runId) {
      return fail(`${path}.attempts`, `attempt ${attempt.attemptId} is bound to another run`);
    }
  }
  const stages = arrayValue(required(object, 'stages', path), `${path}.stages`).map(
    (entry, index) => decodeActivityStageViewV1(entry, `${path}.stages[${index}]`),
  );
  const events = arrayValue(required(object, 'events', path), `${path}.events`).map(
    (entry, index) => decodeActivityEventViewV1(entry, `${path}.events[${index}]`),
  );
  const transportAttempts = arrayValue(
    required(object, 'transportAttempts', path),
    `${path}.transportAttempts`,
  ).map((entry, index) =>
    decodeActivityTransportAttemptViewV1(entry, `${path}.transportAttempts[${index}]`),
  );
  const metadata = decodeActivityProjectionMetadataV1(
    required(object, 'metadata', path),
    `${path}.metadata`,
  );
  const dimensions = decodeActivityDimensionsV1(
    required(object, 'dimensions', path),
    `${path}.dimensions`,
  );
  const availableActions = arrayValue(
    required(object, 'availableActions', path),
    `${path}.availableActions`,
  ).map((entry, index) =>
    decodeActivityAvailableActionV1(entry, `${path}.availableActions[${index}]`),
  );
  return {
    schemaVersion: '1.0.0',
    root,
    run,
    attempts,
    stages,
    events,
    transportAttempts,
    metadata,
    dimensions,
    availableActions,
  };
};

// ---------------------------------------------------------------------------
// Activity Product API wire types (queue/detail/continuation/refresh)
// ---------------------------------------------------------------------------
//
// These are the browser-facing wire shapes of the Activity Product API. They
// live in Contracts so the frontend client (`@shotgun/api-client`) never
// crosses into the domain module layer; the module re-exports them from here.

/** Owning-Domain adapter kind exposed by the federated Activity projection. */
export type ActivityAdapterKindV1 = 'SOURCES' | 'ASK' | 'EXTERNAL_ACTION' | 'DISCOVERY';

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
  /**
   * Server-derived available action descriptors (WP5). Empty when the owning
   * Domain does not allow Retry/Cancel for this Activity; the client only
   * renders what the server returns and delegates execution to the
   * owning-Domain command route.
   */
  readonly availableActions: readonly ActivityAvailableActionV1[];
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

export type ActivityProjectionAdapterFailureV1 = {
  readonly adapterId: string;
  readonly domainKind: ActivityAdapterKindV1;
  readonly safe: boolean;
  readonly message: string;
};

export type ActivityProjectionBuildResultV1 = {
  readonly resourceProjectId: string;
  readonly snapshotRevision: number;
  readonly indexCount: number;
  readonly watermarks: readonly ActivityWatermarkRecordV1[];
  readonly adapterStatus: 'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE';
  readonly partial: boolean;
  readonly failures: readonly ActivityProjectionAdapterFailureV1[];
};

/** Project-scoped watermark for one owning-Domain adapter (frontend_activity.projection_watermarks). */
export type ActivityWatermarkRecordV1 = {
  readonly resourceProjectId: string;
  readonly adapterId: string;
  readonly domainKind: ActivityDomainKindV1;
  readonly sourceUpdatedAt?: string;
  readonly projectedAt: string;
  readonly lagMilliseconds?: number;
  readonly adapterStatus: ActivityAdapterStatusV1;
  readonly snapshotRevision: number;
  readonly cursor?: string;
  readonly updatedAt: string;
};

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
  readonly domainKind: ActivityDomainKindV1;
  readonly activityId: string;
  readonly domainResourceKind: string;
  readonly domainResourceId: string;
};

export type ListActivityContinuationRequestV1 = {
  readonly schemaVersion: typeof FRONTEND_ACTIVITY_API_VERSION;
  readonly domainKind: ActivityDomainKindV1;
  readonly activityId: string;
  readonly domainResourceKind: string;
  readonly domainResourceId: string;
  readonly cursor?: string;
  readonly limit?: number;
};

export type RefreshActivityProjectionRequestV1 = {
  readonly schemaVersion: typeof FRONTEND_ACTIVITY_API_VERSION;
};
