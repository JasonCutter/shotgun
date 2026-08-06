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
 */

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
