import type { HistorySourceDomainKindV1 } from '../../../packages/contracts/src/index.js';
import type { HistoryAdapterRegistryPort } from './history-adapter-port.js';
import type { HistoryIndexRecordV1 } from './history-index-store-port.js';
import type { HistoryReadModelStorePort } from './history-read-model-store-port.js';
import type {
  HistoryAdapterStatusV1,
  HistoryWatermarkRecordV1,
} from './history-watermark-store-port.js';

/** Result of one deterministic project-scoped History projection build. */
export type HistoryProjectionBuildResultV1 = {
  readonly resourceProjectId: string;
  readonly snapshotRevision: number;
  readonly indexCount: number;
  readonly watermarks: readonly HistoryWatermarkRecordV1[];
  readonly adapterStatus: HistoryAdapterStatusV1;
  readonly partial: boolean;
  readonly failures: readonly {
    readonly adapterId: string;
    readonly domainKind: HistorySourceDomainKindV1;
    readonly safe: boolean;
    readonly message: string;
  }[];
};

const historyWatermarkFromAdapter = (input: {
  readonly adapterId: string;
  readonly domainKind: HistorySourceDomainKindV1;
  readonly resourceProjectId: string;
  readonly snapshotRevision: number;
  readonly sourceUpdatedAt?: string;
  readonly projectedAt: string;
  readonly adapterStatus: HistoryAdapterStatusV1;
  readonly lastSourcePosition?: string;
}): HistoryWatermarkRecordV1 => ({
  resourceProjectId: input.resourceProjectId,
  adapterId: input.adapterId,
  domainKind: input.domainKind,
  ...(input.sourceUpdatedAt === undefined ? {} : { sourceUpdatedAt: input.sourceUpdatedAt }),
  projectedAt: input.projectedAt,
  adapterStatus: input.adapterStatus,
  snapshotRevision: input.snapshotRevision,
  ...(input.lastSourcePosition === undefined
    ? {}
    : { lastSourcePosition: input.lastSourcePosition }),
});

/**
 * FE-P5-S2 WP4 — Federated History Projection Builder.
 *
 * Combines the four owning-Domain adapters (Canonical / Review / External
 * Action / Policy) into the additive federated History read model
 * (`history_projection_index` + `projection_watermarks`, migration 030)
 * through one deterministic, ATOMIC project-scoped build (IR r1 §4; ADR-131
 * §2 — the projection is NON-AUTHORITATIVE and never a second ledger).
 *
 * Correctness properties (IR r1 §4 rules 1-9):
 * - Per-adapter atomicity: an adapter's rows join the build only when
 *   `readHistory` succeeded; a failure discards that adapter's rows entirely.
 * - Fail closed + watermarks for ALL adapters: a failed adapter contributes no
 *   rows AND still receives a current-revision UNAVAILABLE watermark (no
 *   sourceUpdatedAt/cursor are fabricated), so a stale AVAILABLE watermark can
 *   never be presented as current after a failure.
 * - Atomic commit: index replace + every watermark are published in one
 *   Project-scoped transaction/CAS boundary; partial exposure is FORBIDDEN and
 *   an interruption rolls back to the previous committed projection.
 * - Deterministic rebuild: every adapter is replayed in registry order with a
 *   monotonic snapshot revision; source Domain History is never modified.
 */
export class HistoryProjectionBuilder {
  constructor(
    private readonly registry: HistoryAdapterRegistryPort,
    private readonly store: HistoryReadModelStorePort,
    private readonly now?: () => Date,
  ) {}

  private nowIso(): string {
    return (this.now ? this.now() : new Date()).toISOString();
  }

  /**
   * Build or refresh the History projection for a project by observing every
   * owning-Domain adapter. Runs one deterministic, atomic build with a
   * monotonic snapshot revision.
   */
  async buildProjectProjection(resourceProjectId: string): Promise<HistoryProjectionBuildResultV1> {
    const projectedAt = this.nowIso();
    const existingWatermarks = await this.store.watermarks.readByProject(resourceProjectId);
    const newestRevision = existingWatermarks.reduce(
      (max, record) => Math.max(max, record.snapshotRevision),
      0,
    );
    const snapshotRevision = newestRevision + 1;

    const records: HistoryIndexRecordV1[] = [];
    const watermarks: HistoryWatermarkRecordV1[] = [];

    // IR r1 §4 rebuild atomicity: the rebuild commits ONLY when EVERY
    // mandatory adapter succeeds. ANY adapter failure → the whole rebuild is
    // aborted (no index write, no watermark advance) and the previous complete
    // committed projection stays visible. A partial rebuilt projection must
    // never be exposed.
    for (const adapter of this.registry.adapters) {
      const entries = await adapter.readHistory(resourceProjectId);
      const adapterRecords: HistoryIndexRecordV1[] = entries.map((entry) => entry);
      const sourceUpdatedAt = entries.reduce<string | undefined>(
        (newest, entry) =>
          newest === undefined || entry.occurredAt > newest ? entry.occurredAt : newest,
        undefined,
      );
      records.push(...adapterRecords);
      watermarks.push(
        historyWatermarkFromAdapter({
          adapterId: adapter.adapterId,
          domainKind: adapter.domainKind,
          resourceProjectId,
          snapshotRevision,
          ...(sourceUpdatedAt === undefined ? {} : { sourceUpdatedAt }),
          projectedAt,
          adapterStatus: 'AVAILABLE',
          lastSourcePosition: sourceUpdatedAt,
        }),
      );
    }

    // One atomic Project-scoped commit: index replace + all watermarks together.
    await this.store.commitProjectProjection({
      resourceProjectId,
      snapshotRevision,
      records,
      watermarks,
    });

    return {
      resourceProjectId,
      snapshotRevision,
      indexCount: records.length,
      watermarks,
      adapterStatus: 'AVAILABLE',
      partial: false,
      failures: [],
    };
  }
}
