/**
 * FE-P5-S2 WP4 — Federated History adapter boundary.
 *
 * One adapter per owning authoritative Domain (Canonical / Review / External
 * Action / Policy). Each adapter maps authoritative Domain history into the
 * federated `HistoryEntryV1` projection rows for a project. Adapters NEVER
 * mutate the owning Domain; they only read. Source Domain identity is
 * preserved exactly (ADR-131 §2): `sourceEventId`/`domainResourceId` keep the
 * authoritative identity and `historyEntryId` is projection identity only.
 *
 * `resolveHistoryEntry` re-resolves a single authoritative source event
 * (domainKind + sourceEventKind + sourceEventId) at read time so the Detail
 * Product API never serves a stale projection row (IR r1 §5 WP4 / GPT Round 1
 * C): it returns the CURRENT authoritative payload + availability, or
 * `undefined` (fail-closed) when the source can no longer be resolved.
 */

import type {
  HistoryEntryV1,
  HistorySourceDomainKindV1,
} from '../../../packages/contracts/src/index.js';

/**
 * Project-scoped History adapter read. Implementations return the complete
 * authoritative Domain history for a project mapped to projection rows
 * (deterministic order), or throw on an unrecoverable source failure (the
 * builder then aborts the whole rebuild — no partial projection is exposed).
 */
export type HistoryAdapterPort = {
  readonly adapterId: string;
  readonly domainKind: HistorySourceDomainKindV1;
  /** Project-scoped authoritative history → HistoryEntryV1 rows. */
  readHistory(projectId: string): Promise<readonly HistoryEntryV1[]>;
  /**
   * Authoritative detail re-resolution for one source event identity. Returns
   * `undefined` when the source is no longer authoritatively resolvable
   * (fail-closed: the projection payload is NOT trusted in that case).
   */
  resolveHistoryEntry(
    projectId: string,
    sourceEventKind: string,
    sourceEventId: string,
  ): Promise<HistoryEntryV1 | undefined>;
  /**
   * FE-P5-S2 WP4 Round 2 F — read-time payload redaction for one projection
   * row. Re-checks the CURRENT authoritative payload availability (owner-side
   * sidecar) and returns the entry with the raw payload redacted (tombstone
   * metadata only) whenever the availability is not AVAILABLE. A purge that
   * happened AFTER the projection was cached can therefore never leak the raw
   * payload through List/Detail. Never trusts the cached snapshot.
   */
  redactEntry(entry: HistoryEntryV1): Promise<HistoryEntryV1>;
};

/**
 * The four mandatory owning-Domain History adapter families (IR r1 §4 / §5
 * WP4). A federated rebuild commits ONLY after every mandatory family has
 * been observed exactly once (GPT Round 2 A).
 */
export const MANDATORY_HISTORY_ADAPTER_DOMAIN_KINDS: readonly HistorySourceDomainKindV1[] = [
  'CANONICAL',
  'REVIEW',
  'EXTERNAL_ACTION',
  'POLICY',
];

/** Federated registry of History adapters (one per mandatory family). */
export type HistoryAdapterRegistryPort = {
  readonly adapters: readonly HistoryAdapterPort[];
  adapterFor(domainKind: HistorySourceDomainKindV1): HistoryAdapterPort | undefined;
};

/**
 * Creates the federated adapter registry with an exact-set invariant
 * (GPT Round 2 A): the four mandatory families MUST each be present exactly
 * once. Missing / duplicate / unknown adapter kinds fail closed at wiring
 * time, so a wiring mistake can never produce a silently partial build that
 * is committed as if it were complete.
 */
export const createHistoryAdapterRegistry = (
  adapters: readonly HistoryAdapterPort[],
): HistoryAdapterRegistryPort => {
  const seen = new Set<HistorySourceDomainKindV1>();
  for (const adapter of adapters) {
    if (seen.has(adapter.domainKind)) {
      throw new Error(
        `HISTORY_ADAPTER_REGISTRY_DUPLICATE: duplicate adapter for domainKind ${adapter.domainKind}`,
      );
    }
    if (!MANDATORY_HISTORY_ADAPTER_DOMAIN_KINDS.includes(adapter.domainKind)) {
      throw new Error(
        `HISTORY_ADAPTER_REGISTRY_UNKNOWN: unsupported domainKind ${adapter.domainKind}`,
      );
    }
    seen.add(adapter.domainKind);
  }
  for (const mandatory of MANDATORY_HISTORY_ADAPTER_DOMAIN_KINDS) {
    if (!seen.has(mandatory)) {
      throw new Error(
        `HISTORY_ADAPTER_REGISTRY_MISSING: missing mandatory adapter for domainKind ${mandatory}`,
      );
    }
  }
  return {
    adapters,
    adapterFor(domainKind) {
      return adapters.find((adapter) => adapter.domainKind === domainKind);
    },
  };
};
