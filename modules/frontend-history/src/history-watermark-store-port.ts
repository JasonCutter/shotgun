/**
 * FE-P5-S2 WP4 — History projection watermark store boundary.
 *
 * `frontend_history.projection_watermarks` (migration 030) stores project- and
 * adapter-scoped source observation (last source position, projected time,
 * adapter status, snapshot revision). Watermarks drive rebuild/resume
 * correctness (IR r1 §4: a failed adapter never advances its watermark) and
 * are never Domain lifecycle state.
 */

import type { HistorySourceDomainKindV1 } from '../../../packages/contracts/src/index.js';

export type HistoryAdapterStatusV1 = 'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE';

/** Project-scoped watermark for one History adapter. */
export type HistoryWatermarkRecordV1 = {
  readonly resourceProjectId: string;
  readonly adapterId: string;
  readonly domainKind: HistorySourceDomainKindV1;
  readonly sourceUpdatedAt?: string;
  readonly projectedAt: string;
  readonly adapterStatus: HistoryAdapterStatusV1;
  readonly snapshotRevision: number;
  /** Last observed source position (deterministic resume). */
  readonly lastSourcePosition?: string;
};

/** History projection watermark store port. */
export type HistoryWatermarkStorePort = {
  /** Upsert by (resourceProjectId, adapterId) with snapshot revision CAS. */
  readonly upsert: (record: HistoryWatermarkRecordV1) => Promise<void>;
  /** Read all watermarks for a project. */
  readonly readByProject: (
    resourceProjectId: string,
  ) => Promise<readonly HistoryWatermarkRecordV1[]>;
  /** Read one adapter's watermark for a project. */
  readonly readByProjectAndAdapter: (
    resourceProjectId: string,
    adapterId: string,
  ) => Promise<HistoryWatermarkRecordV1 | undefined>;
  /** Remove a project's watermarks (deterministic rebuild). */
  readonly deleteByProject: (resourceProjectId: string) => Promise<void>;
};
