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
 * through one deterministic, ATOMIC project-scoped build (Contract Snapshot
 * §3, §9; AC-10).
 *
 * Correctness properties:
 * - Multi-page: every adapter is read page by page (nextCursor) until
 *   exhausted, with cursor cycle detection, so a Domain with more than one
 *   page is never truncated.
 * - Per-adapter atomicity: an adapter's rows join the build only when every
 *   page succeeded; a failure on page 2+ discards that adapter's earlier pages
 *   too (no partial adapter snapshot is ever presented).
 * - Fail closed + watermarks for ALL adapters: a failed adapter contributes no
 *   rows AND still gets a current-revision UNAVAILABLE watermark (no
 *   sourceUpdatedAt/cursor/lag are fabricated), so a stale AVAILABLE watermark
 *   can never be presented as current after a failure.
 * - Atomic commit: index replace + every watermark are published in one
 *   Project-scoped transaction/CAS boundary (see
 *   `ActivityReadModelStorePort.commitProjectProjection`); a concurrent refresh
 *   can never confirm the same revision with a different snapshot.
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

/** Per-adapter queue read budget used for multi-page iteration. */
export const ACTIVITY_PROJECTION_PAGE_SIZE = 100;

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
   * Observe one adapter across every bounded page. The returned records and
   * watermark are produced ONLY when every page succeeded (per-adapter
   * atomicity). `cursor` cycles are detected and rejected as an adapter fault.
   */
  private async observeAdapter(
    adapter: ActivityAdapterPort,
    scope: ActivityAdapterScopeV1,
    snapshotRevision: number,
    projectedAt: string,
  ): Promise<{
    readonly records: readonly ActivityIndexRecordV1[];
    readonly watermark: ActivityWatermarkRecordV1;
  }> {
    const records: ActivityIndexRecordV1[] = [];
    const seenCursors = new Set<string>();
    let status: ActivityAdapterStatusV1 | undefined;
    let cursor: string | undefined;
    let sourceUpdatedAt: string | undefined;
    let lagMilliseconds: number | undefined;

    const guardCursor = (next: string | undefined, current: string | undefined): void => {
      if (next === undefined) return;
      if (seenCursors.has(next)) {
        throw new Error(
          `ACTIVITY_ADAPTER_CURSOR_CYCLE: adapter ${adapter.adapterId} returned a repeating cursor`,
        );
      }
      seenCursors.add(next);
      if (current !== undefined) seenCursors.add(current);
    };

    for (;;) {
      const page = await adapter.readQueue(scope, {
        limit: ACTIVITY_PROJECTION_PAGE_SIZE,
        ...(cursor === undefined ? {} : { cursor }),
      });
      guardCursor(page.nextCursor, cursor);
      const pageStatus = page.metadata.adapterStatus;
      status = status === undefined ? pageStatus : combineAdapterAvailability([status, pageStatus]);
      // The last page's observation drives the freshness/lag/cursor watermark.
      sourceUpdatedAt = page.metadata.sourceUpdatedAt;
      lagMilliseconds = page.metadata.lagMilliseconds;
      cursor = page.metadata.cursor;
      for (const item of page.items) {
        records.push(activityIndexRecordFromQueueItem({ item, snapshotRevision, projectedAt }));
      }
      if (page.nextCursor === undefined) break;
      cursor = page.nextCursor;
    }

    return {
      records,
      watermark: activityWatermarkFromAdapter({
        adapter,
        resourceProjectId: scope.activeProjectId,
        snapshotRevision,
        ...(sourceUpdatedAt === undefined ? {} : { sourceUpdatedAt }),
        projectedAt,
        adapterStatus: status ?? 'UNAVAILABLE',
        ...(lagMilliseconds === undefined ? {} : { lagMilliseconds }),
        ...(cursor === undefined ? {} : { cursor }),
      }),
    };
  }

  /**
   * Build or refresh the Activity projection for a project by observing every
   * owning-Domain adapter. Runs one deterministic, atomic build with a
   * monotonic snapshot revision; a failed adapter contributes no rows, still
   * receives a current-revision UNAVAILABLE watermark, and is surfaced through
   * `partial`, `adapterStatus` and `failures`.
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
        const observed = await this.observeAdapter(adapter, scope, snapshotRevision, projectedAt);
        records.push(...observed.records);
        watermarks.push(observed.watermark);
        statuses.push(observed.watermark.adapterStatus);
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
        // Fail closed: every registry adapter still receives a current-revision
        // watermark so a stale AVAILABLE observation is never presented as
        // current. No sourceUpdatedAt/cursor/lag are fabricated.
        watermarks.push(
          activityWatermarkFromAdapter({
            adapter,
            resourceProjectId: scope.activeProjectId,
            snapshotRevision,
            projectedAt,
            adapterStatus: 'UNAVAILABLE',
          }),
        );
      }
    }

    // One atomic Project-scoped commit: index replace + all watermarks together.
    await this.store.commitProjectProjection({
      resourceProjectId: scope.activeProjectId,
      snapshotRevision,
      records,
      watermarks,
    });

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
