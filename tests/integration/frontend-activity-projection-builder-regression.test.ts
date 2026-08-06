import { describe, expect, it } from 'vitest';

import type { ActivityRootReferenceV1 } from '../../packages/contracts/src/index.js';
import { createInMemoryActivityReadModelStore } from '../../adapters/frontend-activity-in-memory/src/index.js';
import {
  ActivityProjectionBuilder,
  ACTIVITY_PROJECTION_PAGE_SIZE,
  type ActivityAdapterPort,
  type ActivityAdapterRegistryPort,
  type ActivityAdapterScopeV1,
  type ActivityIndexRecordV1,
  type ActivityQueueItemV1,
  type ActivityQueuePageV1,
  type ActivityReadModelStorePort,
  type ActivityWatermarkRecordV1,
} from '../../modules/frontend-activity/src/index.js';

/**
 * FE-P5-S1 WP3 — Projection Builder regression suite (CHANGES_REQUIRED round 1).
 * Covers the multi-page projection (nextCursor iteration + cycle detection),
 * per-adapter atomicity (a page-2 failure discards the adapter's earlier
 * pages), failed-adapter UNAVAILABLE watermarks across builds, and the atomic
 * Project-scoped commit (concurrent same-revision rejection).
 */

const SCOPE: ActivityAdapterScopeV1 = {
  principalId: 'principal-1',
  activeProjectId: 'project-1',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
};

const root = (input: {
  activityId: string;
  domainKind: ActivityRootReferenceV1['domainKind'];
  updatedAt: string;
}): ActivityRootReferenceV1 => ({
  schemaVersion: '1.0.0',
  rootKind: input.domainKind === 'ASK' ? 'RUN' : 'JOB',
  activityId: input.activityId,
  domainKind: input.domainKind,
  domainResourceKind: 'Resource',
  domainResourceId: input.activityId,
  resourceProjectId: SCOPE.activeProjectId,
  resourceHref: `/activity/${input.activityId}`,
  ...(input.domainKind === 'ASK' ? {} : { jobId: `job-${input.activityId}` }),
  runId: `run-${input.activityId}`,
});

const item = (input: {
  activityId: string;
  domainKind: ActivityRootReferenceV1['domainKind'];
  updatedAt: string;
}): ActivityQueueItemV1 => ({
  root: root(input),
  summary: `summary-${input.activityId}`,
  state: 'RUNNING',
  dimensions: {
    schemaVersion: '1.0.0',
    attention: 'NONE',
    retryability: 'UNKNOWN',
    freshness: 'CURRENT',
    adapterStatus: 'AVAILABLE',
  },
  updatedAt: input.updatedAt,
});

const pageMetadata = (cursor?: string): ActivityQueuePageV1['metadata'] => ({
  schemaVersion: '1.0.0',
  snapshotRevision: 1,
  generatedAt: '2026-08-06T00:00:00.000Z',
  sourceUpdatedAt: '2026-08-06T00:00:00.000Z',
  freshness: 'CURRENT',
  adapterStatus: 'AVAILABLE',
  partial: false,
  ...(cursor === undefined ? {} : { cursor }),
});

/**
 * A paged mock adapter: serves `items` in pages of `pageSize`, honoring the
 * cursor; can be told to fail on a specific page number, or to loop its cursor
 * forever (cycle detection).
 */
const makePagedAdapter = (input: {
  adapterId: string;
  domainKind: ActivityAdapterPort['domainKind'];
  items: readonly ActivityQueueItemV1[];
  pageSize?: number;
  failOnPage?: number;
  cycle?: boolean;
  counter?: { calls: number };
}): ActivityAdapterPort => {
  const pageSize = input.pageSize ?? 100;
  let calls = 0;
  return {
    adapterId: input.adapterId,
    domainKind: input.domainKind,
    domainKinds: [input.domainKind],
    async readQueue(_scope, filter) {
      calls += 1;
      if (input.counter) input.counter.calls = calls;
      const pageNumber = calls;
      if (input.failOnPage !== undefined && pageNumber === input.failOnPage) {
        throw new Error(`raw failure on page ${pageNumber}`);
      }
      let start = 0;
      if (filter.cursor !== undefined) {
        start = Number.parseInt(Buffer.from(filter.cursor, 'base64url').toString('utf8'), 10);
      }
      const page = input.items.slice(start, start + pageSize);
      const nextOffset = start + page.length;
      const hasMore = input.items.length > nextOffset || input.cycle === true;
      const nextCursor = hasMore
        ? Buffer.from(String(nextOffset)).toString('base64url')
        : undefined;
      return {
        items: page,
        metadata: pageMetadata(nextCursor),
        ...(nextCursor === undefined ? {} : { nextCursor }),
      };
    },
    async readDetail() {
      throw new Error('not used');
    },
    async readStages() {
      return { stages: [], metadata: pageMetadata() };
    },
    async readEvents() {
      return { events: [], metadata: pageMetadata() };
    },
    async canAccess() {
      return true;
    },
    health() {
      return { status: 'AVAILABLE' };
    },
  };
};

const makeRegistry = (adapters: readonly ActivityAdapterPort[]): ActivityAdapterRegistryPort => ({
  adapters,
  adapterFor(domainKind) {
    return adapters.find((adapter) => adapter.domainKind === domainKind);
  },
  healthSummaries() {
    return Object.fromEntries(adapters.map((adapter) => [adapter.adapterId, adapter.health()]));
  },
});

const store = (): ActivityReadModelStorePort => createInMemoryActivityReadModelStore();

const manyItems = (
  count: number,
  domainKind: ActivityAdapterPort['domainKind'],
): ActivityQueueItemV1[] =>
  Array.from({ length: count }, (_, index) =>
    item({
      activityId: `${domainKind.toLowerCase()}-${String(index + 1).padStart(3, '0')}`,
      domainKind,
      updatedAt: new Date(Date.UTC(2026, 7, 6, 0, 0, count - index)).toISOString(),
    }),
  );

describe('FE-P5-S1 ActivityProjectionBuilder multi-page', () => {
  it('reads every bounded page (101+ items) and indexes them all', async () => {
    const readModel = store();
    const counter = { calls: 0 };
    const sources = makePagedAdapter({
      adapterId: 'sources-adapter',
      domainKind: 'SOURCES',
      items: manyItems(ACTIVITY_PROJECTION_PAGE_SIZE + 5, 'SOURCES'),
      pageSize: 20,
      counter,
    });
    const builder = new ActivityProjectionBuilder(makeRegistry([sources]), readModel);
    const result = await builder.buildProjectProjection(SCOPE);
    expect(result.indexCount).toBe(ACTIVITY_PROJECTION_PAGE_SIZE + 5);
    expect(result.partial).toBe(false);
    const page = await readModel.index.queryProject({
      resourceProjectId: 'project-1',
      limit: ACTIVITY_PROJECTION_PAGE_SIZE + 5,
    });
    expect(page.records).toHaveLength(ACTIVITY_PROJECTION_PAGE_SIZE + 5);
    // The adapter was called more than once (it paged).
    expect(counter.calls).toBeGreaterThan(1);
  });

  it('discards an adapter entirely when a later page fails (per-adapter atomicity)', async () => {
    const readModel = store();
    const sources = makePagedAdapter({
      adapterId: 'sources-adapter',
      domainKind: 'SOURCES',
      items: manyItems(50, 'SOURCES'),
      pageSize: 20,
      failOnPage: 2,
    });
    const ask = makePagedAdapter({
      adapterId: 'ask-adapter',
      domainKind: 'ASK',
      items: manyItems(3, 'ASK'),
      pageSize: 100,
    });
    const builder = new ActivityProjectionBuilder(makeRegistry([sources, ask]), readModel);
    const result = await builder.buildProjectProjection(SCOPE);
    // Sources page 2 failed → NONE of its 20 page-1 rows are presented.
    expect(result.partial).toBe(true);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.adapterId).toBe('sources-adapter');
    expect(result.indexCount).toBe(3);
    const page = await readModel.index.queryProject({ resourceProjectId: 'project-1', limit: 100 });
    expect(page.records.every((record) => record.domainKind === 'ASK')).toBe(true);
    // The failed adapter still receives a UNAVAILABLE watermark at this revision.
    const watermarks = await readModel.watermarks.readByProject('project-1');
    expect(watermarks.find((w) => w.adapterId === 'sources-adapter')?.adapterStatus).toBe(
      'UNAVAILABLE',
    );
  });

  it('rejects a repeating cursor (cycle detection)', async () => {
    const readModel = store();
    const sources = makePagedAdapter({
      adapterId: 'sources-adapter',
      domainKind: 'SOURCES',
      items: manyItems(5, 'SOURCES'),
      pageSize: 2,
      cycle: true,
    });
    const builder = new ActivityProjectionBuilder(makeRegistry([sources]), readModel);
    const result = await builder.buildProjectProjection(SCOPE);
    expect(result.partial).toBe(true);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.adapterId).toBe('sources-adapter');
    // No rows from the cycling adapter are presented; its watermark is UNAVAILABLE.
    expect(result.indexCount).toBe(0);
    const watermarks = await readModel.watermarks.readByProject('project-1');
    expect(watermarks.find((w) => w.adapterId === 'sources-adapter')?.adapterStatus).toBe(
      'UNAVAILABLE',
    );
  });
});

describe('FE-P5-S1 ActivityProjectionBuilder failed-adapter watermarks', () => {
  it('replaces a previous AVAILABLE watermark with UNAVAILABLE after a failure', async () => {
    const readModel = store();
    let fail = false;
    const sources: ActivityAdapterPort = {
      adapterId: 'sources-adapter',
      domainKind: 'SOURCES',
      domainKinds: ['SOURCES'],
      async readQueue() {
        if (fail) throw new Error('raw failure: secret-token');
        return {
          items: [
            item({
              activityId: 's1',
              domainKind: 'SOURCES',
              updatedAt: '2026-08-06T00:00:01.000Z',
            }),
          ],
          metadata: pageMetadata(),
        };
      },
      async readDetail() {
        throw new Error('not used');
      },
      async readStages() {
        return { stages: [], metadata: pageMetadata() };
      },
      async readEvents() {
        return { events: [], metadata: pageMetadata() };
      },
      async canAccess() {
        return true;
      },
      health() {
        return { status: 'AVAILABLE' };
      },
    };
    const builder = new ActivityProjectionBuilder(makeRegistry([sources]), readModel);

    const first = await builder.buildProjectProjection(SCOPE);
    expect(first.adapterStatus).toBe('AVAILABLE');
    let watermarks = await readModel.watermarks.readByProject('project-1');
    expect(watermarks.find((w) => w.adapterId === 'sources-adapter')?.adapterStatus).toBe(
      'AVAILABLE',
    );

    // The adapter now fails; the next build must NOT leave a stale AVAILABLE
    // watermark at the new revision.
    fail = true;
    const second = await builder.buildProjectProjection(SCOPE);
    expect(second.partial).toBe(true);
    expect(second.adapterStatus).toBe('UNAVAILABLE');
    expect(second.failures[0]?.message).not.toContain('secret-token');
    watermarks = await readModel.watermarks.readByProject('project-1');
    const sourceWatermark = watermarks.find((w) => w.adapterId === 'sources-adapter');
    expect(sourceWatermark?.adapterStatus).toBe('UNAVAILABLE');
    expect(sourceWatermark?.snapshotRevision).toBe(2);
    expect(sourceWatermark?.sourceUpdatedAt).toBeUndefined();
    expect(sourceWatermark?.cursor).toBeUndefined();
    // The index is empty (fail closed — stale rows are never presented).
    const page = await readModel.index.queryProject({ resourceProjectId: 'project-1', limit: 10 });
    expect(page.records).toHaveLength(0);
  });
});

describe('FE-P5-S1 ActivityProjectionBuilder atomic commit', () => {
  it('rejects a concurrent build that already committed the same revision', async () => {
    const readModel = store();
    const sources = makePagedAdapter({
      adapterId: 'sources-adapter',
      domainKind: 'SOURCES',
      items: manyItems(1, 'SOURCES'),
      pageSize: 100,
    });
    const builder = new ActivityProjectionBuilder(makeRegistry([sources]), readModel);
    const first = await builder.buildProjectProjection(SCOPE);
    expect(first.snapshotRevision).toBe(1);

    const recordAt = (input: { activityId: string; revision: number }): ActivityIndexRecordV1 => ({
      resourceProjectId: 'project-1',
      activityId: input.activityId,
      domainKind: 'SOURCES',
      rootKind: 'JOB',
      domainResourceKind: 'Resource',
      domainResourceId: input.activityId,
      resourceHref: `/activity/${input.activityId}`,
      jobId: `job-${input.activityId}`,
      runId: `run-${input.activityId}`,
      summary: input.activityId,
      state: 'RUNNING',
      attention: 'NONE',
      retryability: 'UNKNOWN',
      freshness: 'CURRENT',
      adapterStatus: 'AVAILABLE',
      snapshotRevision: input.revision,
      snapshot: {},
      projectedAt: '2026-08-06T00:00:02.000Z',
      updatedAt: '2026-08-06T00:00:02.000Z',
    });
    const watermarkAt = (revision: number): ActivityWatermarkRecordV1 => ({
      resourceProjectId: 'project-1',
      adapterId: 'sources-adapter',
      domainKind: 'SOURCES',
      projectedAt: '2026-08-06T00:00:02.000Z',
      adapterStatus: 'AVAILABLE',
      snapshotRevision: revision,
      updatedAt: '2026-08-06T00:00:02.000Z',
    });

    // A concurrent refresh observed the same base (revision 1) and committed
    // revision 2 with a DIFFERENT snapshot.
    await readModel.commitProjectProjection({
      resourceProjectId: 'project-1',
      snapshotRevision: 2,
      records: [recordAt({ activityId: 'concurrent', revision: 2 })],
      watermarks: [watermarkAt(2)],
    });

    // Our build also computed revision 2 (it read the revision-1 watermark
    // before the concurrent commit). The atomic commit must fail closed — the
    // same revision is already committed with a different snapshot.
    await expect(
      readModel.commitProjectProjection({
        resourceProjectId: 'project-1',
        snapshotRevision: 2,
        records: [recordAt({ activityId: 'ours', revision: 2 })],
        watermarks: [watermarkAt(2)],
      }),
    ).rejects.toThrow(/ACTIVITY_INDEX_STALE_REBUILD/);

    // The concurrent snapshot is left untouched (no partial publish).
    const page = await readModel.index.queryProject({ resourceProjectId: 'project-1', limit: 10 });
    expect(page.records.map((record) => record.activityId)).toEqual(['concurrent']);
  });

  it('rolls back the whole projection when a mid-commit watermark write fails', async () => {
    const readModel = createInMemoryActivityReadModelStore();
    // Seed a previous successful build (revision 1).
    const sources = makePagedAdapter({
      adapterId: 'sources-adapter',
      domainKind: 'SOURCES',
      items: manyItems(1, 'SOURCES'),
      pageSize: 100,
    });
    const builder = new ActivityProjectionBuilder(makeRegistry([sources]), readModel);
    await builder.buildProjectProjection(SCOPE);
    const beforeIndex = await readModel.index.queryProject({
      resourceProjectId: 'project-1',
      limit: 10,
    });
    const beforeWatermarks = await readModel.watermarks.readByProject('project-1');

    // A commit whose watermark list is invalid (wrong revision) must publish
    // NOTHING — the index and watermarks remain at revision 1.
    await expect(
      readModel.commitProjectProjection({
        resourceProjectId: 'project-1',
        snapshotRevision: 2,
        records: [
          {
            resourceProjectId: 'project-1',
            activityId: 's1',
            domainKind: 'SOURCES',
            rootKind: 'JOB',
            domainResourceKind: 'Resource',
            domainResourceId: 'submission-1',
            resourceHref: '/activity/s1',
            jobId: 'job-s1',
            runId: 'run-s1',
            summary: 'summary-s1',
            state: 'RUNNING',
            attention: 'NONE',
            retryability: 'UNKNOWN',
            freshness: 'CURRENT',
            adapterStatus: 'AVAILABLE',
            snapshotRevision: 2,
            snapshot: {},
            projectedAt: '2026-08-06T00:00:02.000Z',
            updatedAt: '2026-08-06T00:00:02.000Z',
          },
        ],
        watermarks: [
          {
            resourceProjectId: 'project-1',
            adapterId: 'sources-adapter',
            domainKind: 'SOURCES',
            projectedAt: '2026-08-06T00:00:02.000Z',
            adapterStatus: 'AVAILABLE',
            snapshotRevision: 1, // wrong revision — must fail the whole commit
            updatedAt: '2026-08-06T00:00:02.000Z',
          },
        ],
      }),
    ).rejects.toThrow(/ACTIVITY_WATERMARK_REVISION/);

    const afterIndex = await readModel.index.queryProject({
      resourceProjectId: 'project-1',
      limit: 10,
    });
    const afterWatermarks = await readModel.watermarks.readByProject('project-1');
    expect(afterIndex.records).toEqual(beforeIndex.records);
    expect(afterWatermarks).toEqual(beforeWatermarks);
  });
});
