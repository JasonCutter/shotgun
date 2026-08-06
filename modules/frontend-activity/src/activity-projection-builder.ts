import type { ActivityAdapterStatusV1 } from '../../../packages/contracts/src/index.js';
import {
  combineAdapterAvailability,
  type ActivityAdapterPort,
  type ActivityAdapterRegistryPort,
  type ActivityAdapterScopeV1,
  type ActivityIndexRecordV1,
  type ActivityQueueItemV1,
  type ActivityReadModelStorePort,
  type ActivityWatermarkRecordV1,
  asActivityAdapterError,
} from './index.js';

/**
 * FE-P5-S1 WP3 — Federated Activity Projection Builder.
 *
 * Combines the owning-Domain adapters (Sources, Ask, External Action) into the
 * additive Activity read model (`activity_index` + `projection_watermarks`)
 * through one deterministic project-scoped rebuild. One adapter failure
 * produces a partial result with adapter health metadata and never erases the
 * accessible results of the other adapters (Contract Snapshot §3, AC-10). A
 * failed adapter contributes no rows for the build (fail closed: stale rows are
 * never presented as current) and its watermark is recorded as UNAVAILABLE.
 *
 * The builder never authors execution authority: it only observes the owning
 * Domains through their read adapters and writes the bounded projection.
 */

export type ActivityProjectionBuilderScopeV1 = ActivityAdapterScopeV1;

export type ActivityProjectionAdapterFailureV1 = {
  readonly adapterId: string;
  readonly domainKind: ActivityAdapterPort['domainKind'];
  readonly safe: boolean;
  readonly message: string;
};

export type ActivityProjectionBuildResultV1 = {
  readonly resourceProjectId: string;
  readonly snapshotRevision: number;
  readonly indexCount: number;
  readonly watermarks: readonly ActivityWatermarkRecordV1[];
  readonly adapterStatus: 'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE';
  readonly partial: boolean;
  readonly failures: readonly ActivityProjectionAdapterFailureV1[];
};

/** Convert an adapter queue item into an Activity index record for the build. */
export const activityIndexRecordFromQueueItem = (input: {
  readonly item: ActivityQueueItemV1;
  readonly snapshotRevision: number;
  readonly projectedAt: string;
}): ActivityIndexRecordV1 => {
  const { root } = input.item;
  return {
    resourceProjectId: root.resourceProjectId,
    activityId: root.activityId,
    domainKind: root.domainKind,
    rootKind: root.rootKind,
    domainResourceKind: root.domainResourceKind,
    domainResourceId: root.domainResourceId,
    resourceHref: root.resourceHref,
    ...(root.jobId === undefined ? {} : { jobId: root.jobId }),
    runId: root.runId,
    summary: input.item.summary,
    state: input.item.state,
    attention: input.item.dimensions.attention,
    retryability: input.item.dimensions.retryability,
    freshness: input.item.dimensions.freshness,
    adapterStatus: input.item.dimensions.adapterStatus,
    snapshotRevision: input.snapshotRevision,
    snapshot: input.item,
    projectedAt: input.projectedAt,
    updatedAt: input.item.updatedAt,
  };
};

/** Build a watermark record for one adapter observation. */
export const activityWatermarkFromAdapter = (input: {
  readonly adapter: ActivityAdapterPort;
  readonly resourceProjectId: string;
  readonly snapshotRevision: number;
  readonly sourceUpdatedAt?: string;
  readonly projectedAt: string;
  readonly adapterStatus: ActivityAdapterStatusV1;
  readonly lagMilliseconds?: number;
  readonly cursor?: string;
}): ActivityWatermarkRecordV1 => ({
  resourceProjectId: input.resourceProjectId,
  adapterId: input.adapter.adapterId,
  domainKind: input.adapter.domainKind,
  ...(input.sourceUpdatedAt === undefined ? {} : { sourceUpdatedAt: input.sourceUpdatedAt }),
  projectedAt: input.projectedAt,
  ...(input.lagMilliseconds === undefined ? {} : { lagMilliseconds: input.lagMilliseconds }),
  adapterStatus: input.adapterStatus,
  snapshotRevision: input.snapshotRevision,
  ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
  updatedAt: input.projectedAt,
});

export class ActivityProjectionBuilder {
  constructor(
    private readonly registry: ActivityAdapterRegistryPort,
    private readonly store: ActivityReadModelStorePort,
    private readonly now?: () => Date,
  ) {}

  private nowIso(): string {
    return (this.now ? this.now() : new Date()).toISOString();
  }

  /**
   * Build or refresh the Activity projection for a project by observing every
   * owning-Domain adapter. Runs one deterministic full-project rebuild with a
   * monotonic snapshot revision; a failed adapter contributes no rows and is
   * recorded as UNAVAILABLE.
   */
  async buildProjectProjection(
    scope: ActivityProjectionBuilderScopeV1,
  ): Promise<ActivityProjectionBuildResultV1> {
    const projectedAt = this.nowIso();
    const existingWatermarks = await this.store.watermarks.readByProject(scope.activeProjectId);
    const newestRevision = existingWatermarks.reduce(
      (max, record) => Math.max(max, record.snapshotRevision),
      0,
    );
    const snapshotRevision = newestRevision + 1;

    const records: ActivityIndexRecordV1[] = [];
    const watermarks: ActivityWatermarkRecordV1[] = [];
    const failures: ActivityProjectionAdapterFailureV1[] = [];
    const statuses: Array<'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE'> = [];

    for (const adapter of this.registry.adapters) {
      try {
        const page = await adapter.readQueue(scope, { limit: 100 });
        statuses.push(adapter.health().status);
        for (const item of page.items) {
          records.push(activityIndexRecordFromQueueItem({ item, snapshotRevision, projectedAt }));
        }
        watermarks.push(
          activityWatermarkFromAdapter({
            adapter,
            resourceProjectId: scope.activeProjectId,
            snapshotRevision,
            sourceUpdatedAt: page.metadata.sourceUpdatedAt,
            projectedAt,
            adapterStatus: page.metadata.adapterStatus,
            lagMilliseconds: page.metadata.lagMilliseconds,
            cursor: page.metadata.cursor,
          }),
        );
      } catch (error) {
        const converted = asActivityAdapterError({
          adapterId: adapter.adapterId,
          domainKind: adapter.domainKind,
          error,
        });
        statuses.push('UNAVAILABLE');
        failures.push({
          adapterId: adapter.adapterId,
          domainKind: adapter.domainKind,
          safe: converted.safe,
          message: converted.message,
        });
      }
    }

    await this.store.index.rebuildProject({
      resourceProjectId: scope.activeProjectId,
      snapshotRevision,
      records,
    });

    for (const watermark of watermarks) {
      await this.store.watermarks.upsert(watermark);
    }

    const adapterStatus = combineAdapterAvailability(statuses);
    return {
      resourceProjectId: scope.activeProjectId,
      snapshotRevision,
      indexCount: records.length,
      watermarks,
      adapterStatus,
      partial: failures.length > 0,
      failures,
    };
  }
}
