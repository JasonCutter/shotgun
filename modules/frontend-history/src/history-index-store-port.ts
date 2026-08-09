/**
 * FE-P5-S2 WP4 — Federated History projection index store boundary.
 *
 * `frontend_history.history_projection_index` (migration 030) is a
 * NON-AUTHORITATIVE, rebuildable federated read projection over the owning
 * Domain histories (Canonical / Review / External Action / Policy). This port
 * is the deterministic write/read boundary used by the History projection
 * builder and the History Product API (ADR-131 §2 / IR r1 §5 WP4).
 *
 * Identity/ordering contract (frozen, ADR-131 §2):
 * - `historyEntryId` is projection identity ONLY; it never replaces the source
 *   Domain event identity (`sourceEventId`).
 * - Ordering/cursor uses the frozen tuple
 *   `occurredAt + domainKind + sourceEventKind + sourceEventId + sourceSequence`.
 * - The projection never becomes a global chronology authority.
 */

import type {
  HistoryCursorV1,
  HistoryEntryV1,
  HistorySourceDomainKindV1,
} from '../../../packages/contracts/src/index.js';

/** One federated History projection row (index record). */
export type HistoryIndexRecordV1 = HistoryEntryV1;

/** Project-scoped query over the History projection index. */
export type HistoryIndexQueryV1 = {
  readonly resourceProjectId: string;
  readonly domainKinds?: readonly HistorySourceDomainKindV1[];
  /** Keyset continuation over the frozen ordering tuple. */
  readonly cursor?: HistoryCursorV1;
  readonly limit: number;
};

export type HistoryIndexPageV1 = {
  readonly records: readonly HistoryIndexRecordV1[];
  readonly nextCursor?: HistoryCursorV1;
};

/** Stable ordering comparator over the frozen tuple (occurredAt DESC, then ASC tie-break). */
export const compareHistoryRecords = (
  left: HistoryIndexRecordV1,
  right: HistoryIndexRecordV1,
): number => {
  const timeCompare = right.occurredAt.localeCompare(left.occurredAt);
  if (timeCompare !== 0) return timeCompare;
  const kindCompare = left.domainKind.localeCompare(right.domainKind);
  if (kindCompare !== 0) return kindCompare;
  const eventKindCompare = left.sourceEventKind.localeCompare(right.sourceEventKind);
  if (eventKindCompare !== 0) return eventKindCompare;
  const idCompare = left.sourceEventId.localeCompare(right.sourceEventId);
  if (idCompare !== 0) return idCompare;
  return (left.sourceSequence ?? 0) - (right.sourceSequence ?? 0);
};

/**
 * Keyset predicate matching ORDER BY occurred_at DESC, domain_kind ASC,
 * source_event_kind ASC, source_event_id ASC, source_sequence ASC (frozen
 * tuple): a record is strictly AFTER `cursor` when its occurred_at is
 * SMALLER (later page in DESC), or the same occurred_at with a LARGER
 * (domain_kind, source_event_kind, source_event_id, source_sequence) tie-break.
 */
export const isHistoryRecordAfter = (
  record: HistoryIndexRecordV1,
  cursor: HistoryCursorV1,
): boolean => {
  const timeCompare = record.occurredAt.localeCompare(cursor.occurredAt);
  if (timeCompare !== 0) return timeCompare < 0; // record occurred earlier (DESC: after)
  const kindCompare = record.domainKind.localeCompare(cursor.domainKind);
  if (kindCompare !== 0) return kindCompare > 0;
  const eventKindCompare = record.sourceEventKind.localeCompare(cursor.sourceEventKind);
  if (eventKindCompare !== 0) return eventKindCompare > 0;
  const idCompare = record.sourceEventId.localeCompare(cursor.sourceEventId);
  if (idCompare !== 0) return idCompare > 0;
  return (record.sourceSequence ?? 0) > (cursor.sourceSequence ?? 0);
};

/** History projection index store port. */
export type HistoryIndexStorePort = {
  /** Upsert by (resourceProjectId, historyEntryId). */
  readonly upsert: (record: HistoryIndexRecordV1) => Promise<void>;
  /** Direct lookup by projection identity (project-scoped). */
  readonly findByIdentity: (input: {
    readonly resourceProjectId: string;
    readonly historyEntryId: string;
  }) => Promise<HistoryIndexRecordV1 | undefined>;
  /** Project-scoped ordered read with frozen-tuple keyset cursor. */
  readonly queryProject: (input: HistoryIndexQueryV1) => Promise<HistoryIndexPageV1>;
  /** Remove the whole project index (deterministic full rebuild). */
  readonly deleteProject: (resourceProjectId: string) => Promise<void>;
  /** Remove one domain adapter's rows (deterministic per-domain rebuild). */
  readonly deleteByProjectAndDomain: (
    resourceProjectId: string,
    domainKind: HistorySourceDomainKindV1,
  ) => Promise<void>;
  /**
   * Deterministic rebuild: replace a project's (or one domain's) rows with the
   * given records. Fails closed when any existing row has a snapshot revision
   * newer than the incoming revision (lower revisions never replace newer).
   */
  readonly rebuildProject: (input: {
    readonly resourceProjectId: string;
    readonly snapshotRevision: number;
    readonly domainKind?: HistorySourceDomainKindV1;
    readonly records: readonly HistoryIndexRecordV1[];
  }) => Promise<void>;
};

/** Guard: an incoming rebuild revision must not be lower than observed newer rows. */
export const assertHistoryRebuildRevisionNotLower = (
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
      `HISTORY_INDEX_STALE_REBUILD: ${scope} has snapshot revision ${newestExisting} which is newer than incoming ${incomingRevision}`,
    );
  }
};

/** Validate a rebuild batch: project scope and unique projection identity. */
export const validateHistoryRebuildBatch = (input: {
  readonly resourceProjectId: string;
  readonly records: readonly HistoryIndexRecordV1[];
}): void => {
  const seen = new Set<string>();
  for (const record of input.records) {
    if (record.resourceProjectId !== input.resourceProjectId) {
      throw new Error(
        `HISTORY_INDEX_REBUILD_SCOPE: record ${record.historyEntryId} is bound to ${record.resourceProjectId}, expected ${input.resourceProjectId}`,
      );
    }
    const key = `${record.domainKind}:${record.sourceEventKind}:${record.sourceEventId}`;
    if (seen.has(key)) {
      throw new Error(
        `HISTORY_INDEX_REBUILD_DUPLICATE: duplicate source identity ${key} in rebuild batch`,
      );
    }
    seen.add(key);
  }
};
