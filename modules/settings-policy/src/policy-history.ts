/**
 * FE-P5-S2 WP2-A — Policy History authoritative read capability.
 *
 * Owner: settings-policy (ADR-131 §7, IR r1 §5 WP2-A).
 *
 * The authoritative Policy Change History source is the existing append-only
 * settings persistence:
 *   - settings.settings_audit_events  (append-only audit, migration 032 guard)
 *   - settings.settings_revisions     (snapshot history)
 *   - settings.policy_context_revisions (policy binding history)
 *
 * No new authoritative Policy History table is created (ADR-131 §7, IR r1
 * §4 Scope D). This module defines the authoritative read port that the
 * History adapter (WP4) will read through. The port is append-only safe:
 * entries are never edited or deleted by this capability.
 */

/**
 * One authoritative Policy change event (project-scoped).
 * Mirrors settings.settings_audit_events exactly (identity preserved).
 */
export type PolicyHistoryEntry = {
  readonly eventId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly actionName: string;
  readonly riskLevel: string;
  readonly details: Record<string, unknown>;
  readonly timestamp: string;
};

/** Keyset continuation cursor (timestamp + eventId stable tie-breaker). */
export type PolicyHistoryCursor = {
  readonly timestamp: string;
  readonly eventId: string;
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
 * Read-only: never mutates the append-only authoritative source.
 */
export type PolicyHistoryReadPort = {
  listPolicyHistory(input: ListPolicyHistoryInput): Promise<ListPolicyHistoryResult>;
};

/** Stable ordering: timestamp ASC, then eventId ASC (deterministic tie-break). */
export const comparePolicyHistoryEntries = (
  a: PolicyHistoryEntry,
  b: PolicyHistoryEntry,
): number => {
  if (a.timestamp < b.timestamp) return -1;
  if (a.timestamp > b.timestamp) return 1;
  if (a.eventId < b.eventId) return -1;
  if (a.eventId > b.eventId) return 1;
  return 0;
};

/** True keyset predicate (strictly after the cursor, stable order). */
export const isPolicyHistoryAfter = (
  entry: PolicyHistoryEntry,
  cursor: PolicyHistoryCursor,
): boolean =>
  entry.timestamp > cursor.timestamp ||
  (entry.timestamp === cursor.timestamp && entry.eventId > cursor.eventId);

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
      ? { timestamp: page[page.length - 1]!.timestamp, eventId: page[page.length - 1]!.eventId }
      : undefined;
  return { entries: Object.freeze([...page]), nextCursor };
};
