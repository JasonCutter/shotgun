import { describe, expect, it } from 'vitest';

import { createInMemoryActivityReadModelStore } from '../../adapters/frontend-activity-in-memory/src/index.js';
import {
  createActivityReadModelStore,
  encodeActivityIndexCursor,
  type ActivityIndexRecordV1,
  type ActivityReadModelStorePort,
  type ActivityWatermarkRecordV1,
} from '../../modules/frontend-activity/src/index.js';

/**
 * FE-P5-S1 WP2 — Activity read-model store semantics over the in-memory
 * adapter (migration 029 mirror): project binding, stable total ordering,
 * keyset pagination, deterministic rebuild and revision guards.
 */

const record = (input: {
  projectId: string;
  activityId: string;
  domainKind: ActivityIndexRecordV1['domainKind'];
  state: ActivityIndexRecordV1['state'];
  updatedAt: string;
  revision?: number;
}): ActivityIndexRecordV1 => ({
  resourceProjectId: input.projectId,
  activityId: input.activityId,
  domainKind: input.domainKind,
  rootKind: input.domainKind === 'ASK' ? 'RUN' : 'JOB',
  domainResourceKind: 'Resource',
  domainResourceId: `resource-${input.activityId}`,
  resourceHref: `/activity/${input.activityId}`,
  ...(input.domainKind === 'ASK' ? {} : { jobId: `job-${input.activityId}` }),
  runId: `run-${input.activityId}`,
  summary: `summary-${input.activityId}`,
  state: input.state,
  attention: 'NONE',
  retryability: 'UNKNOWN',
  freshness: 'CURRENT',
  adapterStatus: 'AVAILABLE',
  snapshotRevision: input.revision ?? 1,
  snapshot: { activityId: input.activityId, summary: `summary-${input.activityId}` },
  projectedAt: input.updatedAt,
  updatedAt: input.updatedAt,
});

const watermark = (input: {
  projectId: string;
  adapterId: string;
  domainKind: ActivityWatermarkRecordV1['domainKind'];
  projectedAt: string;
  status?: ActivityWatermarkRecordV1['adapterStatus'];
}): ActivityWatermarkRecordV1 => ({
  resourceProjectId: input.projectId,
  adapterId: input.adapterId,
  domainKind: input.domainKind,
  projectedAt: input.projectedAt,
  adapterStatus: input.status ?? 'AVAILABLE',
  snapshotRevision: 1,
  updatedAt: input.projectedAt,
});

const store = (): ActivityReadModelStorePort =>
  createActivityReadModelStore(createInMemoryActivityReadModelStore());

describe('FE-P5-S1 activity_index project binding and ordering', () => {
  it('returns project-scoped records with stable total ordering', async () => {
    const { index } = store();
    await index.upsert(
      record({
        projectId: 'p1',
        activityId: 'a1',
        domainKind: 'SOURCES',
        state: 'RUNNING',
        updatedAt: '2026-08-06T00:00:03.000Z',
      }),
    );
    await index.upsert(
      record({
        projectId: 'p1',
        activityId: 'a2',
        domainKind: 'ASK',
        state: 'SUCCEEDED',
        updatedAt: '2026-08-06T00:00:01.000Z',
      }),
    );
    await index.upsert(
      record({
        projectId: 'p1',
        activityId: 'a3',
        domainKind: 'EXTERNAL_ACTION',
        state: 'QUEUED',
        updatedAt: '2026-08-06T00:00:02.000Z',
      }),
    );
    await index.upsert(
      record({
        projectId: 'p2',
        activityId: 'x1',
        domainKind: 'SOURCES',
        state: 'RUNNING',
        updatedAt: '2026-08-06T00:00:09.000Z',
      }),
    );

    const page = await index.queryProject({ resourceProjectId: 'p1', limit: 10 });
    expect(page.records.map((r) => r.activityId)).toEqual(['a1', 'a3', 'a2']);
    expect(page.nextCursor).toBeUndefined();
  });

  it('isolates projects (no cross-project disclosure)', async () => {
    const { index } = store();
    await index.upsert(
      record({
        projectId: 'p1',
        activityId: 'a1',
        domainKind: 'SOURCES',
        state: 'RUNNING',
        updatedAt: '2026-08-06T00:00:00.000Z',
      }),
    );
    await index.upsert(
      record({
        projectId: 'p2',
        activityId: 'x1',
        domainKind: 'SOURCES',
        state: 'FAILED',
        updatedAt: '2026-08-06T00:00:00.000Z',
      }),
    );
    const page = await index.queryProject({ resourceProjectId: 'p1', limit: 10 });
    expect(page.records).toHaveLength(1);
    expect(page.records[0]?.activityId).toBe('a1');
  });

  it('applies domain/state/attention filters', async () => {
    const { index } = store();
    await index.upsert(
      record({
        projectId: 'p1',
        activityId: 'a1',
        domainKind: 'SOURCES',
        state: 'RUNNING',
        updatedAt: '2026-08-06T00:00:00.000Z',
      }),
    );
    await index.upsert(
      record({
        projectId: 'p1',
        activityId: 'a2',
        domainKind: 'ASK',
        state: 'FAILED',
        updatedAt: '2026-08-06T00:00:00.000Z',
      }),
    );

    const sources = await index.queryProject({
      resourceProjectId: 'p1',
      domainKinds: ['SOURCES'],
      limit: 10,
    });
    expect(sources.records.map((r) => r.activityId)).toEqual(['a1']);

    const failed = await index.queryProject({
      resourceProjectId: 'p1',
      states: ['FAILED'],
      limit: 10,
    });
    expect(failed.records.map((r) => r.activityId)).toEqual(['a2']);
  });
});

describe('FE-P5-S1 keyset cursor pagination', () => {
  it('paginates without duplicates or omissions across a stable total order', async () => {
    const { index } = store();
    for (let i = 1; i <= 5; i += 1) {
      const iso = `2026-08-06T00:00:0${i}.000Z`;
      await index.upsert(
        record({
          projectId: 'p1',
          activityId: `a${i}`,
          domainKind: 'SOURCES',
          state: 'QUEUED',
          updatedAt: iso,
        }),
      );
    }

    const first = await index.queryProject({ resourceProjectId: 'p1', limit: 2 });
    expect(first.records.map((r) => r.activityId)).toEqual(['a5', 'a4']);
    expect(first.nextCursor).toBeDefined();

    const second = await index.queryProject({
      resourceProjectId: 'p1',
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.records.map((r) => r.activityId)).toEqual(['a3', 'a2']);
    expect(second.nextCursor).toBeDefined();

    const third = await index.queryProject({
      resourceProjectId: 'p1',
      limit: 2,
      cursor: second.nextCursor,
    });
    expect(third.records.map((r) => r.activityId)).toEqual(['a1']);
    expect(third.nextCursor).toBeUndefined();
  });

  it('returns an empty page for a cursor past the end', async () => {
    const { index } = store();
    await index.upsert(
      record({
        projectId: 'p1',
        activityId: 'a1',
        domainKind: 'SOURCES',
        state: 'QUEUED',
        updatedAt: '2026-08-06T00:00:00.000Z',
      }),
    );
    const cursor = encodeActivityIndexCursor({
      updatedAt: '2026-08-06T00:00:01.000Z',
      domainKind: 'SOURCES',
      activityId: 'a1',
    });
    const page = await index.queryProject({ resourceProjectId: 'p1', limit: 10, cursor });
    expect(page.records).toHaveLength(0);
  });
});

describe('FE-P5-S1 deterministic rebuild', () => {
  it('rebuilds a project index deterministically and idempotently', async () => {
    const { index } = store();
    const r1 = record({
      projectId: 'p1',
      activityId: 'a1',
      domainKind: 'SOURCES',
      state: 'QUEUED',
      updatedAt: '2026-08-06T00:00:00.000Z',
      revision: 2,
    });
    const r2 = record({
      projectId: 'p1',
      activityId: 'a2',
      domainKind: 'SOURCES',
      state: 'RUNNING',
      updatedAt: '2026-08-06T00:00:01.000Z',
      revision: 2,
    });
    await index.upsert(r1);
    await index.upsert(r2);

    await index.rebuildProject({
      resourceProjectId: 'p1',
      snapshotRevision: 2,
      records: [r1, r2],
    });
    const page = await index.queryProject({ resourceProjectId: 'p1', limit: 10 });
    expect(page.records.map((r) => r.activityId)).toEqual(['a2', 'a1']);
  });

  it('refuses a rebuild whose revision is lower than an existing row', async () => {
    const { index } = store();
    await index.upsert(
      record({
        projectId: 'p1',
        activityId: 'a1',
        domainKind: 'SOURCES',
        state: 'QUEUED',
        updatedAt: '2026-08-06T00:00:00.000Z',
        revision: 5,
      }),
    );
    await expect(
      index.rebuildProject({ resourceProjectId: 'p1', snapshotRevision: 4, records: [] }),
    ).rejects.toThrow(/ACTIVITY_INDEX_STALE_REBUILD/);
    // The existing row survives the failed rebuild.
    const page = await index.queryProject({ resourceProjectId: 'p1', limit: 10 });
    expect(page.records).toHaveLength(1);
    expect(page.records[0]?.snapshotRevision).toBe(5);
  });

  it('rebuilds a single domain without touching other domains', async () => {
    const { index } = store();
    await index.upsert(
      record({
        projectId: 'p1',
        activityId: 'a1',
        domainKind: 'SOURCES',
        state: 'QUEUED',
        updatedAt: '2026-08-06T00:00:00.000Z',
        revision: 1,
      }),
    );
    await index.upsert(
      record({
        projectId: 'p1',
        activityId: 'a2',
        domainKind: 'ASK',
        state: 'QUEUED',
        updatedAt: '2026-08-06T00:00:00.000Z',
        revision: 1,
      }),
    );

    await index.rebuildProject({
      resourceProjectId: 'p1',
      snapshotRevision: 2,
      domainKind: 'SOURCES',
      records: [
        record({
          projectId: 'p1',
          activityId: 'a1',
          domainKind: 'SOURCES',
          state: 'SUCCEEDED',
          updatedAt: '2026-08-06T00:00:01.000Z',
          revision: 2,
        }),
      ],
    });
    const page = await index.queryProject({ resourceProjectId: 'p1', limit: 10 });
    expect(page.records).toHaveLength(2);
    const sources = page.records.find((r) => r.activityId === 'a1');
    expect(sources?.state).toBe('SUCCEEDED');
    expect(page.records.find((r) => r.activityId === 'a2')?.state).toBe('QUEUED');
  });

  it('deletes a whole project or one domain', async () => {
    const { index } = store();
    await index.upsert(
      record({
        projectId: 'p1',
        activityId: 'a1',
        domainKind: 'SOURCES',
        state: 'QUEUED',
        updatedAt: '2026-08-06T00:00:00.000Z',
      }),
    );
    await index.upsert(
      record({
        projectId: 'p1',
        activityId: 'a2',
        domainKind: 'ASK',
        state: 'QUEUED',
        updatedAt: '2026-08-06T00:00:00.000Z',
      }),
    );

    await index.deleteByProjectAndDomain('p1', 'SOURCES');
    expect((await index.queryProject({ resourceProjectId: 'p1', limit: 10 })).records).toHaveLength(
      1,
    );

    await index.deleteProject('p1');
    expect((await index.queryProject({ resourceProjectId: 'p1', limit: 10 })).records).toHaveLength(
      0,
    );
  });
});

describe('FE-P5-S1 projection watermarks', () => {
  it('upserts, reads by project and by adapter, and deletes by project', async () => {
    const { watermarks } = store();
    await watermarks.upsert(
      watermark({
        projectId: 'p1',
        adapterId: 'sources-adapter',
        domainKind: 'SOURCES',
        projectedAt: '2026-08-06T00:00:00.000Z',
      }),
    );
    await watermarks.upsert(
      watermark({
        projectId: 'p1',
        adapterId: 'ask-adapter',
        domainKind: 'ASK',
        projectedAt: '2026-08-06T00:00:01.000Z',
      }),
    );
    await watermarks.upsert(
      watermark({
        projectId: 'p2',
        adapterId: 'sources-adapter',
        domainKind: 'SOURCES',
        projectedAt: '2026-08-06T00:00:02.000Z',
      }),
    );

    const project = await watermarks.readByProject('p1');
    expect(project.map((w) => w.adapterId)).toEqual(['ask-adapter', 'sources-adapter']);

    const one = await watermarks.readByProjectAndAdapter('p1', 'sources-adapter');
    expect(one?.domainKind).toBe('SOURCES');
    expect(await watermarks.readByProjectAndAdapter('p2', 'ask-adapter')).toBeUndefined();

    await watermarks.deleteByProject('p1');
    expect(await watermarks.readByProject('p1')).toHaveLength(0);
    expect(await watermarks.readByProject('p2')).toHaveLength(1);
  });

  it('upsert by (project, adapter) is idempotent', async () => {
    const { watermarks } = store();
    const first = watermark({
      projectId: 'p1',
      adapterId: 'ask-adapter',
      domainKind: 'ASK',
      projectedAt: '2026-08-06T00:00:00.000Z',
    });
    await watermarks.upsert(first);
    await watermarks.upsert({
      ...first,
      projectedAt: '2026-08-06T00:00:05.000Z',
      adapterStatus: 'DEGRADED',
    });
    const result = await watermarks.readByProjectAndAdapter('p1', 'ask-adapter');
    expect(result?.projectedAt).toBe('2026-08-06T00:00:05.000Z');
    expect(result?.adapterStatus).toBe('DEGRADED');
  });
});
