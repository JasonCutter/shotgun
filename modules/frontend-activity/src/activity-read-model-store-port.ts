import type { ActivityIndexRecordV1, ActivityIndexStorePort } from './activity-index-store-port.js';
import type {
  ActivityWatermarkRecordV1,
  ActivityWatermarkStorePort,
} from './activity-watermark-store-port.js';

/**
 * FE-P5-S1 Activity read-model store boundary.
 *
 * Combines the two frozen additive tables (`activity_index` and
 * `projection_watermarks`) into one project-scoped boundary. The projection
 * builder (WP3) uses this boundary for deterministic rebuilds and watermark
 * observations without owning any Domain execution store.
 *
 * `commitProjectProjection` is the atomic Project-scoped projection commit: it
 * publishes a new snapshot revision, the rebuilt index rows and every adapter
 * watermark (successful and failed) inside ONE transaction/CAS boundary. A
 * concurrent refresh can never confirm the same revision with a different
 * snapshot, and a mid-commit failure rolls the whole projection back so the
 * index and watermarks never diverge (Contract Snapshot §9 / ADR-130 §6).
 */

export type ActivityReadModelStorePort = {
  readonly index: ActivityIndexStorePort;
  readonly watermarks: ActivityWatermarkStorePort;
  /**
   * Atomically commit one full-project projection build. Implementations
   * serialize on the project, validate the batch, fail closed when any existing
   * row has a snapshot revision >= the incoming revision (a concurrent build
   * already won), then replace the project index and upsert ALL watermarks in
   * one transaction. On any error nothing is published.
   */
  readonly commitProjectProjection: (input: {
    readonly resourceProjectId: string;
    readonly snapshotRevision: number;
    readonly records: readonly ActivityIndexRecordV1[];
    readonly watermarks: readonly ActivityWatermarkRecordV1[];
  }) => Promise<void>;
};

export const createActivityReadModelStore = (
  input: ActivityReadModelStorePort,
): ActivityReadModelStorePort => input;
