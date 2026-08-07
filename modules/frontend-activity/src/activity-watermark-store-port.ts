import type { ActivityWatermarkRecordV1 } from '../../../packages/contracts/src/index.js';

// The watermark wire type is owned by Contracts (single source of truth).
export type { ActivityWatermarkRecordV1 } from '../../../packages/contracts/src/index.js';

/**
 * FE-P5-S1 projection watermark store port.
 *
 * `frontend_activity.projection_watermarks` (migration 029) stores project- and
 * adapter-scoped source observation, projection time, lag, adapter status,
 * snapshot revision and cursor. Watermarks drive the Projection Freshness and
 * Adapter Availability dimensions; they are never Domain lifecycle state.
 */

export type ActivityWatermarkStorePort = {
  /** Upsert by (resourceProjectId, adapterId). */
  readonly upsert: (record: ActivityWatermarkRecordV1) => Promise<void>;
  /** Read all watermarks for a project. */
  readonly readByProject: (
    resourceProjectId: string,
  ) => Promise<readonly ActivityWatermarkRecordV1[]>;
  /** Read one adapter's watermark for a project. */
  readonly readByProjectAndAdapter: (
    resourceProjectId: string,
    adapterId: string,
  ) => Promise<ActivityWatermarkRecordV1 | undefined>;
  /** Remove a project's watermarks (deterministic rebuild). */
  readonly deleteByProject: (resourceProjectId: string) => Promise<void>;
};
