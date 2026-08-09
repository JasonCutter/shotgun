/**
 * FE-P5-S2 WP2-A — Policy History authoritative read capability.
 *
 * Owner: settings-policy (ADR-131 §7, IR r1 §5 WP2-A).
 *
 * The authoritative Policy Change History sources are the existing append-only
 * settings persistence — ALL THREE are exposed by this capability (IR r1 §4
 * Scope D / §5 WP2-A):
 *   - settings.settings_revisions        (snapshot history)
 *   - settings.policy_context_revisions  (policy binding history)
 *   - settings.settings_audit_events     (append-only audit, migration 032 guard)
 *
 * No new authoritative Policy History table is created (ADR-131 §7, IR r1
 * §4 Scope D). This module defines the authoritative read port that the
 * History adapter (WP4) will read through. The port is append-only safe:
 * entries are never edited or deleted by this capability, and the stable
 * source identity of each source row is preserved.
 */

/** Discriminated source kind over the three authoritative Policy History sources. */
export type PolicyHistorySourceKind =
  'SETTINGS_REVISION' | 'POLICY_CONTEXT_REVISION' | 'SETTINGS_AUDIT_EVENT';

/**
 * One authoritative Policy change entry (project-scoped). The stable source
 * identity is preserved per source row:
 *   - SETTINGS_REVISION        → sourceId = revision::text
 *   - POLICY_CONTEXT_REVISION  → sourceId = revision::text
 *   - SETTINGS_AUDIT_EVENT     → sourceId = event_id
 */
export type PolicyHistoryEntry = {
  readonly sourceKind: PolicyHistorySourceKind;
  readonly projectId: string;
  readonly sourceId: string;
  readonly actorId?: string;
  readonly actionName?: string;
  readonly riskLevel?: string;
  readonly details: Record<string, unknown>;
  readonly timestamp: string;
};

/** Keyset continuation cursor (timestamp + sourceKind + sourceId tie-breaker). */
export type PolicyHistoryCursor = {
  readonly timestamp: string;
  readonly sourceKind: PolicyHistorySourceKind;
  readonly sourceId: string;
};

export type ListPolicyHistoryInput = {
  readonly projectId: string;
  readonly cursor?: PolicyHistoryCursor;
  readonly limit: number;
};

export type ListPolicyHistoryResult = {
  readonly entries: readonly PolicyHistoryEntry[];
  readonly nextCursor?: PolicyHistoryCursor;
};

/**
 * Authoritative Policy History read capability owned by settings-policy.
 * Read-only: never mutates the append-only authoritative sources.
 */
export type PolicyHistoryReadPort = {
  listPolicyHistory(input: ListPolicyHistoryInput): Promise<ListPolicyHistoryResult>;
};

// SQL ORDER BY uses the literal source_kind text; keep the TS comparator
// consistent with the DB (sourceKind lexical order) so in-memory and
// PostgreSQL results agree exactly.

/** Stable ordering: timestamp ASC, then sourceKind ASC, then sourceId ASC. */
export const comparePolicyHistoryEntries = (
  a: PolicyHistoryEntry,
  b: PolicyHistoryEntry,
): number => {
  if (a.timestamp < b.timestamp) return -1;
  if (a.timestamp > b.timestamp) return 1;
  if (a.sourceKind < b.sourceKind) return -1;
  if (a.sourceKind > b.sourceKind) return 1;
  if (a.sourceId < b.sourceId) return -1;
  if (a.sourceId > b.sourceId) return 1;
  return 0;
};

/** True keyset predicate (strictly after the cursor, stable order). */
export const isPolicyHistoryAfter = (
  entry: PolicyHistoryEntry,
  cursor: PolicyHistoryCursor,
): boolean => {
  if (entry.timestamp !== cursor.timestamp) return entry.timestamp > cursor.timestamp;
  if (entry.sourceKind !== cursor.sourceKind) return entry.sourceKind > cursor.sourceKind;
  return entry.sourceId > cursor.sourceId;
};

/**
 * Deterministic page over a sorted entry list using the frozen keyset
 * semantics. Returns at most `limit` entries strictly after the cursor and the
 * next continuation cursor when more entries remain.
 */
export const paginatePolicyHistory = (
  sortedEntries: readonly PolicyHistoryEntry[],
  input: ListPolicyHistoryInput,
): ListPolicyHistoryResult => {
  if (!Number.isInteger(input.limit) || input.limit < 1) {
    throw new Error(`ListPolicyHistory limit must be a positive integer, got ${input.limit}`);
  }
  const cursor = input.cursor;
  const after = cursor
    ? sortedEntries.filter((entry) => isPolicyHistoryAfter(entry, cursor))
    : sortedEntries;
  const page = after.slice(0, input.limit);
  const nextCursor =
    after.length > input.limit && page.length > 0
      ? {
          timestamp: page[page.length - 1]!.timestamp,
          sourceKind: page[page.length - 1]!.sourceKind,
          sourceId: page[page.length - 1]!.sourceId,
        }
      : undefined;
  return { entries: Object.freeze([...page]), nextCursor };
};
