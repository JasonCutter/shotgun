/**
 * FE-P5-S2 WP4 — Federated History adapter boundary.
 *
 * One adapter per owning authoritative Domain (Canonical / Review / External
 * Action / Policy). Each adapter maps authoritative Domain history into the
 * federated `HistoryEntryV1` projection rows for a project. Adapters NEVER
 * mutate the owning Domain; they only read. Source Domain identity is
 * preserved exactly (ADR-131 §2): `sourceEventId`/`domainResourceId` keep the
 * authoritative identity and `historyEntryId` is projection identity only.
 */

import type {
  HistoryEntryV1,
  HistorySourceDomainKindV1,
} from '../../../packages/contracts/src/index.js';

/**
 * Project-scoped History adapter read. Implementations return the complete
 * authoritative Domain history for a project mapped to projection rows
 * (deterministic order), or throw on an unrecoverable source failure (the
 * builder then marks the adapter UNAVAILABLE and advances no watermark).
 */
export type HistoryAdapterPort = {
  readonly adapterId: string;
  readonly domainKind: HistorySourceDomainKindV1;
  /** Project-scoped authoritative history → HistoryEntryV1 rows. */
  readHistory(projectId: string): Promise<readonly HistoryEntryV1[]>;
};

/** Federated registry of History adapters (one per mandatory family). */
export type HistoryAdapterRegistryPort = {
  readonly adapters: readonly HistoryAdapterPort[];
  adapterFor(domainKind: HistorySourceDomainKindV1): HistoryAdapterPort | undefined;
};

export const createHistoryAdapterRegistry = (
  adapters: readonly HistoryAdapterPort[],
): HistoryAdapterRegistryPort => ({
  adapters,
  adapterFor(domainKind) {
    return adapters.find((adapter) => adapter.domainKind === domainKind);
  },
});
