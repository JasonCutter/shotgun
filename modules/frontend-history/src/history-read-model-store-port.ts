import type { HistoryIndexRecordV1, HistoryIndexStorePort } from './history-index-store-port.js';
import type {
  HistoryWatermarkRecordV1,
  HistoryWatermarkStorePort,
} from './history-watermark-store-port.js';

/**
 * FE-P5-S2 WP4 — History federated read-model store boundary.
 *
 * Combines the two frozen additive tables (`history_projection_index` and
 * `projection_watermarks`) into one project-scoped boundary. The History
 * projection builder uses this boundary for deterministic atomic rebuilds and
 * watermark observations without owning any Domain history store.
 *
 * `commitProjectProjection` atomically publishes a new snapshot revision, the
 * rebuilt index rows and every adapter watermark (successful and failed)
 * inside ONE transaction/CAS boundary (IR r1 §4): a failed adapter contributes
 * no rows AND gets a current-revision UNAVAILABLE watermark; index replace and
 * watermark advance never diverge; partial projection exposure is FORBIDDEN.
 */

export type HistoryReadModelStorePort = {
  readonly index: HistoryIndexStorePort;
  readonly watermarks: HistoryWatermarkStorePort;
  /**
   * Atomically commit one full-project History projection build.
   * Implementations serialize on the project, validate the batch, fail closed
   * when any existing row has a snapshot revision >= the incoming revision (a
   * concurrent build already won), then replace the project index and upsert
   * ALL watermarks in one transaction. On any error nothing is published.
   */
  readonly commitProjectProjection: (input: {
    readonly resourceProjectId: string;
    readonly snapshotRevision: number;
    readonly records: readonly HistoryIndexRecordV1[];
    readonly watermarks: readonly HistoryWatermarkRecordV1[];
  }) => Promise<void>;
};

export const createHistoryReadModelStore = (
  input: HistoryReadModelStorePort,
): HistoryReadModelStorePort => input;
