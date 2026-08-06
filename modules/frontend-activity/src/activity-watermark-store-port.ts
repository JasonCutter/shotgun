import type {
  ActivityAdapterStatusV1,
  ActivityDomainKindV1,
} from '../../../packages/contracts/src/index.js';

/**
 * FE-P5-S1 projection watermark store port.
 *
 * `frontend_activity.projection_watermarks` (migration 029) stores project- and
 * adapter-scoped source observation, projection time, lag, adapter status,
 * snapshot revision and cursor. Watermarks drive the Projection Freshness and
 * Adapter Availability dimensions; they are never Domain lifecycle state.
 */

export type ActivityWatermarkRecordV1 = {
  readonly resourceProjectId: string;
  readonly adapterId: string;
  readonly domainKind: ActivityDomainKindV1;
  readonly sourceUpdatedAt?: string;
  readonly projectedAt: string;
  readonly lagMilliseconds?: number;
  readonly adapterStatus: ActivityAdapterStatusV1;
  readonly snapshotRevision: number;
  readonly cursor?: string;
  readonly updatedAt: string;
};

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
