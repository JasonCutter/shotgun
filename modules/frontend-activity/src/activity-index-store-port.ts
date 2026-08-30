import type {
  ActivityAdapterStatusV1,
  ActivityAttentionStateV1,
  ActivityDomainKindV1,
  ActivityLifecycleStateV1,
  ActivityProjectionFreshnessV1,
  ActivityRetryabilityV1,
  ActivityRootKindV1,
} from '../../../packages/contracts/src/index.js';

/**
 * FE-P5-S1 Activity index store port.
 *
 * `frontend_activity.activity_index` (migration 029) stores only the
 * Project-scoped searchable current projection summary and the concrete Domain
 * identity. `activityId` is projection identity; `domainResourceId` keeps the
 * concrete Domain Resource identity. The store never interprets the bounded
 * `snapshot` payload and never duplicates a full Domain execution history.
 *
 * Deterministic rebuild: `rebuildProject` and `deleteByProjectAndDomain` are
 * idempotent, and a rebuild never lets a lower `snapshotRevision` replace a
 * newer one (Contract Snapshot §9 / ADR-130 §6).
 *
 * In-memory and PostgreSQL stores enforce the same record invariants as the
 * migration CHECK constraints (domain/root binding, root/job binding, state
 * lifecycle and enum dimensions) plus upsert and rebuild revision guards.
 */

export const ACTIVITY_INDEX_DOMAIN_KINDS = [
  'SOURCES',
  'ASK',
  'EXTERNAL_ACTION',
  'DISCOVERY',
  'CONNECTOR_DIAGNOSTICS',
] as const;

export const ACTIVITY_INDEX_ROOT_KINDS = ['JOB', 'RUN'] as const;

export const ACTIVITY_INDEX_LIFECYCLE_STATES = [
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

export const ACTIVITY_INDEX_ATTENTION = ['NEEDS_ATTENTION', 'RESOLVED', 'NONE'] as const;

export const ACTIVITY_INDEX_RETRYABILITY = ['RETRYABLE', 'NOT_RETRYABLE', 'UNKNOWN'] as const;

export const ACTIVITY_INDEX_FRESHNESS = ['CURRENT', 'LAGGING', 'STALE', 'UNKNOWN'] as const;

export const ACTIVITY_INDEX_ADAPTER_STATUS = ['AVAILABLE', 'DEGRADED', 'UNAVAILABLE'] as const;

/**
 * Validate an Activity index record against the same invariants the migration
 * CHECK constraints enforce (Contract Snapshot §5–§6, ADR-130 §2 and §4).
 */
export const validateActivityIndexRecord = (record: ActivityIndexRecordV1): void => {
  const fail = (message: string): never => {
    throw new Error(`ACTIVITY_INDEX_INVALID_RECORD: ${message}`);
  };
  if (
    typeof record.resourceProjectId !== 'string' ||
    record.resourceProjectId.trim().length === 0
  ) {
    return fail('resourceProjectId must be a non-empty string');
  }
  if (typeof record.activityId !== 'string' || record.activityId.trim().length === 0) {
    return fail('activityId must be a non-empty string');
  }
  if (!ACTIVITY_INDEX_DOMAIN_KINDS.includes(record.domainKind)) {
    return fail(`unsupported domainKind ${record.domainKind}`);
  }
  if (!ACTIVITY_INDEX_ROOT_KINDS.includes(record.rootKind)) {
    return fail(`unsupported rootKind ${record.rootKind}`);
  }
  // ADR-130 §2 / Contract Snapshot §6: Ask uses a RUN root; other domains use a JOB root.
  if (record.domainKind === 'ASK' && record.rootKind !== 'RUN') {
    return fail('ASK must use a RUN root (Ask never invents a Job)');
  }
  if (record.domainKind !== 'ASK' && record.rootKind !== 'JOB') {
    return fail(`${record.domainKind} must use a JOB root`);
  }
  if (record.rootKind === 'RUN' && record.jobId !== undefined) {
    return fail('jobId must be absent when rootKind is RUN');
  }
  if (record.rootKind === 'JOB' && record.jobId === undefined) {
    return fail('jobId is required when rootKind is JOB');
  }
  if (
    typeof record.domainResourceKind !== 'string' ||
    record.domainResourceKind.trim().length === 0
  ) {
    return fail('domainResourceKind must be a non-empty string');
  }
  if (typeof record.domainResourceId !== 'string' || record.domainResourceId.trim().length === 0) {
    return fail('domainResourceId must be a non-empty string');
  }
  if (typeof record.runId !== 'string' || record.runId.trim().length === 0) {
    return fail('runId must be a non-empty string');
  }
  if (typeof record.resourceHref !== 'string' || record.resourceHref.trim().length === 0) {
    return fail('resourceHref must be a non-empty string');
  }
  if (typeof record.summary !== 'string' || record.summary.trim().length === 0) {
    return fail('summary must be a non-empty string');
  }
  if (!ACTIVITY_INDEX_LIFECYCLE_STATES.includes(record.state)) {
    return fail(`unsupported lifecycle state ${record.state}`);
  }
  if (!ACTIVITY_INDEX_ATTENTION.includes(record.attention)) {
    return fail(`unsupported attention ${record.attention}`);
  }
  if (!ACTIVITY_INDEX_RETRYABILITY.includes(record.retryability)) {
    return fail(`unsupported retryability ${record.retryability}`);
  }
  if (!ACTIVITY_INDEX_FRESHNESS.includes(record.freshness)) {
    return fail(`unsupported freshness ${record.freshness}`);
  }
  if (!ACTIVITY_INDEX_ADAPTER_STATUS.includes(record.adapterStatus)) {
    return fail(`unsupported adapterStatus ${record.adapterStatus}`);
  }
  if (!Number.isSafeInteger(record.snapshotRevision) || record.snapshotRevision <= 0) {
    return fail('snapshotRevision must be a positive safe integer');
  }
  if (record.updatedAt.trim().length === 0 || record.projectedAt.trim().length === 0) {
    return fail('projectedAt and updatedAt must be non-empty timestamps');
  }
};

/**
 * Validate a rebuild batch BEFORE any delete or write. Every record must belong
 * to the rebuild project (and domain when scoped), carry exactly the rebuild
 * snapshot revision, and be unique by (project, domain, activity identity).
 */
export const validateRebuildBatch = (input: {
  readonly resourceProjectId: string;
  readonly snapshotRevision: number;
  readonly domainKind?: ActivityDomainKindV1;
  readonly records: readonly ActivityIndexRecordV1[];
}): void => {
  const seen = new Set<string>();
  for (const record of input.records) {
    if (record.resourceProjectId !== input.resourceProjectId) {
      throw new Error(
        `ACTIVITY_INDEX_REBUILD_SCOPE: record ${record.activityId} is bound to another project`,
      );
    }
    if (input.domainKind !== undefined && record.domainKind !== input.domainKind) {
      throw new Error(
        `ACTIVITY_INDEX_REBUILD_SCOPE: record ${record.activityId} domainKind is outside rebuild scope ${input.domainKind}`,
      );
    }
    if (record.snapshotRevision !== input.snapshotRevision) {
      throw new Error(
        `ACTIVITY_INDEX_REBUILD_REVISION: record ${record.activityId} snapshotRevision ${record.snapshotRevision} must equal rebuild revision ${input.snapshotRevision}`,
      );
    }
    validateActivityIndexRecord(record);
    const key = `${record.resourceProjectId}\u0000${record.domainKind}\u0000${record.activityId}`;
    if (seen.has(key)) {
      throw new Error(
        `ACTIVITY_INDEX_REBUILD_DUPLICATE: duplicate activity identity ${record.activityId} in rebuild batch`,
      );
    }
    seen.add(key);
  }
};

export type ActivityIndexRecordV1 = {
  readonly resourceProjectId: string;
  readonly activityId: string;
  readonly domainKind: ActivityDomainKindV1;
  readonly rootKind: ActivityRootKindV1;
  readonly domainResourceKind: string;
  readonly domainResourceId: string;
  readonly domainResourceRevision?: string;
  readonly resourceHref: string;
  readonly jobId?: string;
  readonly runId: string;
  readonly summary: string;
  readonly state: ActivityLifecycleStateV1;
  readonly attention: ActivityAttentionStateV1;
  readonly retryability: ActivityRetryabilityV1;
  readonly freshness: ActivityProjectionFreshnessV1;
  readonly adapterStatus: ActivityAdapterStatusV1;
  readonly snapshotRevision: number;
  /** Bounded current projection summary (jsonb round-trip; opaque to the store). */
  readonly snapshot: unknown;
  readonly projectedAt: string;
  readonly updatedAt: string;
};

export type ActivityIndexQueryV1 = {
  readonly resourceProjectId: string;
  readonly domainKinds?: readonly ActivityDomainKindV1[];
  readonly states?: readonly ActivityLifecycleStateV1[];
  readonly attention?: ActivityAttentionStateV1;
  readonly cursor?: string;
  readonly limit: number;
};

export type ActivityIndexPageV1 = {
  readonly records: readonly ActivityIndexRecordV1[];
  readonly nextCursor?: string;
};

/** Keyset cursor encoding (updatedAt, domainKind, activityId) for stable ordering. */
export type ActivityIndexCursorV1 = {
  readonly updatedAt: string;
  readonly domainKind: ActivityDomainKindV1;
  readonly activityId: string;
};

export const encodeActivityIndexCursor = (cursor: ActivityIndexCursorV1): string =>
  Buffer.from(
    JSON.stringify({
      updatedAt: cursor.updatedAt,
      domainKind: cursor.domainKind,
      activityId: cursor.activityId,
    }),
    'utf8',
  ).toString('base64url');

export const decodeActivityIndexCursor = (value: string): ActivityIndexCursorV1 => {
  const parsed = JSON.parse(
    Buffer.from(value, 'base64url').toString('utf8'),
  ) as Partial<ActivityIndexCursorV1>;
  if (
    typeof parsed.updatedAt !== 'string' ||
    typeof parsed.domainKind !== 'string' ||
    typeof parsed.activityId !== 'string'
  ) {
    throw new Error('ACTIVITY_INDEX_INVALID_CURSOR: malformed cursor');
  }
  return {
    updatedAt: parsed.updatedAt,
    domainKind: parsed.domainKind as ActivityDomainKindV1,
    activityId: parsed.activityId,
  };
};

export type ActivityIndexStorePort = {
  /** Upsert by (resourceProjectId, domainKind, activityId). */
  readonly upsert: (record: ActivityIndexRecordV1) => Promise<void>;
  /**
   * Direct identity lookup by the projection identity plus the owning Domain.
   * This is the Queue→Detail lineage guarantee (AC-05): any Activity that is
   * visible on a queue page must resolve through its concrete Domain reference
   * without depending on a queue page cap. Returns undefined when the identity
   * is absent (never throws for a missing row).
   */
  readonly findByIdentity: (input: {
    readonly resourceProjectId: string;
    readonly domainKind: ActivityDomainKindV1;
    readonly activityId: string;
  }) => Promise<ActivityIndexRecordV1 | undefined>;
  /** Project-scoped queue read with stable total ordering and keyset cursor. */
  readonly queryProject: (input: ActivityIndexQueryV1) => Promise<ActivityIndexPageV1>;
  /** Remove the whole project index (deterministic full rebuild). */
  readonly deleteProject: (resourceProjectId: string) => Promise<void>;
  /** Remove one domain adapter's rows (deterministic per-adapter rebuild). */
  readonly deleteByProjectAndDomain: (
    resourceProjectId: string,
    domainKind: ActivityDomainKindV1,
  ) => Promise<void>;
  /**
   * Deterministic rebuild: replace a project's (or one domain's) rows with the
   * given records. Fails closed when any existing row has a snapshot revision
   * newer than the incoming revision (lower revisions never replace newer ones).
   */
  readonly rebuildProject: (input: {
    readonly resourceProjectId: string;
    readonly snapshotRevision: number;
    readonly domainKind?: ActivityDomainKindV1;
    readonly records: readonly ActivityIndexRecordV1[];
  }) => Promise<void>;
};

/**
 * Guard used by rebuild implementations: an incoming revision must not be lower
 * than an already-observed newer revision for the same project/domain.
 */
export const assertRebuildRevisionNotLower = (
  existing: readonly { readonly snapshotRevision: number }[],
  incomingRevision: number,
  scope: string,
): void => {
  const newestExisting = existing.reduce(
    (max, record) => Math.max(max, record.snapshotRevision),
    0,
  );
  if (newestExisting > incomingRevision) {
    throw new Error(
      `ACTIVITY_INDEX_STALE_REBUILD: ${scope} has snapshot revision ${newestExisting} which is newer than incoming ${incomingRevision}`,
    );
  }
};
