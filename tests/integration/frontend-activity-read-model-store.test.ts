import { describe, expect, it } from 'vitest';

import { createInMemoryActivityReadModelStore } from '../../adapters/frontend-activity-in-memory/src/index.js';
import {
  createActivityReadModelStore,
  encodeActivityIndexCursor,
  validateActivityIndexRecord,
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

  it('returns an empty page for a cursor at the last row (past the end)', async () => {
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
    // The cursor at the only (last) row leaves nothing after it.
    const cursor = encodeActivityIndexCursor({
      updatedAt: '2026-08-06T00:00:00.000Z',
      domainKind: 'SOURCES',
      activityId: 'a1',
    });
    const page = await index.queryProject({ resourceProjectId: 'p1', limit: 10, cursor });
    expect(page.records).toHaveLength(0);
  });

  it('paginates correctly across same updatedAt ties (total order tie-break)', async () => {
    const { index } = store();
    const sameTime = '2026-08-06T00:00:00.000Z';
    // Same updated_at: tie-break by domain_kind ASC then activity_id ASC.
    await index.upsert(
      record({
        projectId: 'p1',
        activityId: 'a1',
        domainKind: 'SOURCES',
        state: 'QUEUED',
        updatedAt: sameTime,
      }),
    );
    await index.upsert(
      record({
        projectId: 'p1',
        activityId: 'a2',
        domainKind: 'ASK',
        state: 'QUEUED',
        updatedAt: sameTime,
      }),
    );
    await index.upsert(
      record({
        projectId: 'p1',
        activityId: 'a3',
        domainKind: 'EXTERNAL_ACTION',
        state: 'QUEUED',
        updatedAt: sameTime,
      }),
    );

    const first = await index.queryProject({ resourceProjectId: 'p1', limit: 2 });
    // Ordering for the same updated_at: domain_kind ASC (ASK, EXTERNAL_ACTION,
    // SOURCES alphabetically), then activity_id ASC.
    expect(first.records.map((r) => r.activityId)).toEqual(['a2', 'a3']);
    expect(first.nextCursor).toBeDefined();

    const second = await index.queryProject({
      resourceProjectId: 'p1',
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.records.map((r) => r.activityId)).toEqual(['a1']);
    expect(second.nextCursor).toBeUndefined();

    const all = [
      ...first.records.map((r) => r.activityId),
      ...second.records.map((r) => r.activityId),
    ];
    expect(all).toEqual(['a2', 'a3', 'a1']);
  });

  it('keeps returning rows after the cursor row is deleted (true keyset)', async () => {
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
        domainKind: 'SOURCES',
        state: 'QUEUED',
        updatedAt: '2026-08-06T00:00:01.000Z',
      }),
    );
    await index.upsert(
      record({
        projectId: 'p1',
        activityId: 'a3',
        domainKind: 'SOURCES',
        state: 'QUEUED',
        updatedAt: '2026-08-06T00:00:02.000Z',
      }),
    );

    const first = await index.queryProject({ resourceProjectId: 'p1', limit: 1 });
    expect(first.records.map((r) => r.activityId)).toEqual(['a3']);
    expect(first.nextCursor).toBeDefined();

    // The cursor row (a3) is deleted after the first page was issued.
    await index.deleteByProjectAndDomain('p1', 'SOURCES');
    await index.upsert(
      record({
        projectId: 'p1',
        activityId: 'a2',
        domainKind: 'SOURCES',
        state: 'QUEUED',
        updatedAt: '2026-08-06T00:00:01.000Z',
      }),
    );
    await index.upsert(
      record({
        projectId: 'p1',
        activityId: 'a1',
        domainKind: 'SOURCES',
        state: 'QUEUED',
        updatedAt: '2026-08-06T00:00:00.000Z',
      }),
    );

    const second = await index.queryProject({
      resourceProjectId: 'p1',
      limit: 10,
      cursor: first.nextCursor,
    });
    // Rows after the original cursor tuple must still be returned.
    expect(second.records.map((r) => r.activityId)).toEqual(['a2', 'a1']);
  });

  it('keeps returning rows when the cursor row updatedAt changes (true keyset)', async () => {
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
        domainKind: 'SOURCES',
        state: 'QUEUED',
        updatedAt: '2026-08-06T00:00:01.000Z',
      }),
    );

    const first = await index.queryProject({ resourceProjectId: 'p1', limit: 1 });
    expect(first.records.map((r) => r.activityId)).toEqual(['a2']);
    expect(first.nextCursor).toBeDefined();

    // The cursor row (a2) moves to the newest position after the cursor was issued.
    await index.upsert(
      record({
        projectId: 'p1',
        activityId: 'a2',
        domainKind: 'SOURCES',
        state: 'RUNNING',
        updatedAt: '2026-08-06T00:00:05.000Z',
      }),
    );

    const second = await index.queryProject({
      resourceProjectId: 'p1',
      limit: 10,
      cursor: first.nextCursor,
    });
    // Only rows after the ORIGINAL cursor tuple (a2@00:00:01) are returned.
    expect(second.records.map((r) => r.activityId)).toEqual(['a1']);
  });
});

describe('FE-P5-S1 upsert monotonicity', () => {
  it('rejects a lower snapshot revision on the same identity', async () => {
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
      index.upsert(
        record({
          projectId: 'p1',
          activityId: 'a1',
          domainKind: 'SOURCES',
          state: 'RUNNING',
          updatedAt: '2026-08-06T00:00:01.000Z',
          revision: 4,
        }),
      ),
    ).rejects.toThrow(/ACTIVITY_INDEX_STALE_UPSERT/);
    // The newer row survives.
    const page = await index.queryProject({ resourceProjectId: 'p1', limit: 10 });
    expect(page.records[0]?.snapshotRevision).toBe(5);
    expect(page.records[0]?.state).toBe('QUEUED');
  });

  it('accepts an equal or higher snapshot revision', async () => {
    const { index } = store();
    await index.upsert(
      record({
        projectId: 'p1',
        activityId: 'a1',
        domainKind: 'SOURCES',
        state: 'QUEUED',
        updatedAt: '2026-08-06T00:00:00.000Z',
        revision: 3,
      }),
    );
    await index.upsert(
      record({
        projectId: 'p1',
        activityId: 'a1',
        domainKind: 'SOURCES',
        state: 'RUNNING',
        updatedAt: '2026-08-06T00:00:01.000Z',
        revision: 3,
      }),
    );
    await index.upsert(
      record({
        projectId: 'p1',
        activityId: 'a1',
        domainKind: 'SOURCES',
        state: 'SUCCEEDED',
        updatedAt: '2026-08-06T00:00:02.000Z',
        revision: 4,
      }),
    );
    const page = await index.queryProject({ resourceProjectId: 'p1', limit: 10 });
    expect(page.records[0]?.snapshotRevision).toBe(4);
    expect(page.records[0]?.state).toBe('SUCCEEDED');
  });
});

describe('FE-P5-S1 record invariants', () => {
  it('rejects ASK with a JOB root at the store boundary', () => {
    expect(() =>
      validateActivityIndexRecord(
        record({
          projectId: 'p1',
          activityId: 'a1',
          domainKind: 'ASK',
          state: 'QUEUED',
          updatedAt: '2026-08-06T00:00:00.000Z',
        }),
      ),
    ).not.toThrow();
    const askWithJob: ActivityIndexRecordV1 = {
      ...record({
        projectId: 'p1',
        activityId: 'a1',
        domainKind: 'ASK',
        state: 'QUEUED',
        updatedAt: '2026-08-06T00:00:00.000Z',
      }),
      rootKind: 'JOB',
      jobId: 'job-x',
    };
    expect(() => validateActivityIndexRecord(askWithJob)).toThrow(/must use a RUN root/);
  });

  it('rejects SOURCES with a RUN root and a RUN root carrying jobId', () => {
    const sourcesRun: ActivityIndexRecordV1 = {
      ...record({
        projectId: 'p1',
        activityId: 'a1',
        domainKind: 'SOURCES',
        state: 'QUEUED',
        updatedAt: '2026-08-06T00:00:00.000Z',
      }),
      rootKind: 'RUN',
      jobId: undefined,
    };
    expect(() => validateActivityIndexRecord(sourcesRun)).toThrow(/must use a JOB root/);

    const runWithJob: ActivityIndexRecordV1 = {
      ...record({
        projectId: 'p1',
        activityId: 'a1',
        domainKind: 'ASK',
        state: 'QUEUED',
        updatedAt: '2026-08-06T00:00:00.000Z',
      }),
      jobId: 'job-x',
    };
    expect(() => validateActivityIndexRecord(runWithJob)).toThrow(/jobId must be absent/);
  });

  it('rejects an unsupported lifecycle state', () => {
    expect(() =>
      validateActivityIndexRecord({
        ...record({
          projectId: 'p1',
          activityId: 'a1',
          domainKind: 'SOURCES',
          state: 'QUEUED',
          updatedAt: '2026-08-06T00:00:00.000Z',
        }),
        state: 'PERSISTED' as ActivityIndexRecordV1['state'],
      }),
    ).toThrow(/unsupported lifecycle state/);
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

  it('rejects a rebuild record bound to another project (validated before delete)', async () => {
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
    await expect(
      index.rebuildProject({
        resourceProjectId: 'p1',
        snapshotRevision: 2,
        records: [
          record({
            projectId: 'p2',
            activityId: 'x1',
            domainKind: 'SOURCES',
            state: 'QUEUED',
            updatedAt: '2026-08-06T00:00:00.000Z',
            revision: 2,
          }),
        ],
      }),
    ).rejects.toThrow(/ACTIVITY_INDEX_REBUILD_SCOPE/);
    // Nothing was deleted: the failed rebuild leaves the project intact.
    const page = await index.queryProject({ resourceProjectId: 'p1', limit: 10 });
    expect(page.records.map((r) => r.activityId)).toEqual(['a1']);
  });

  it('rejects a rebuild record outside the scoped domain', async () => {
    const { index } = store();
    await expect(
      index.rebuildProject({
        resourceProjectId: 'p1',
        snapshotRevision: 2,
        domainKind: 'SOURCES',
        records: [
          record({
            projectId: 'p1',
            activityId: 'a2',
            domainKind: 'ASK',
            state: 'QUEUED',
            updatedAt: '2026-08-06T00:00:00.000Z',
            revision: 2,
          }),
        ],
      }),
    ).rejects.toThrow(/ACTIVITY_INDEX_REBUILD_SCOPE/);
  });

  it('rejects a rebuild record whose revision differs from the rebuild revision', async () => {
    const { index } = store();
    await expect(
      index.rebuildProject({
        resourceProjectId: 'p1',
        snapshotRevision: 2,
        records: [
          record({
            projectId: 'p1',
            activityId: 'a1',
            domainKind: 'SOURCES',
            state: 'QUEUED',
            updatedAt: '2026-08-06T00:00:00.000Z',
            revision: 3,
          }),
        ],
      }),
    ).rejects.toThrow(/ACTIVITY_INDEX_REBUILD_REVISION/);
  });

  it('rejects duplicate activity identities in a rebuild batch', async () => {
    const { index } = store();
    const r = record({
      projectId: 'p1',
      activityId: 'a1',
      domainKind: 'SOURCES',
      state: 'QUEUED',
      updatedAt: '2026-08-06T00:00:00.000Z',
      revision: 2,
    });
    await expect(
      index.rebuildProject({ resourceProjectId: 'p1', snapshotRevision: 2, records: [r, r] }),
    ).rejects.toThrow(/ACTIVITY_INDEX_REBUILD_DUPLICATE/);
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

  it('rejects a lower snapshot revision on the same (project, adapter) watermark', async () => {
    const { watermarks } = store();
    await watermarks.upsert({
      ...watermark({
        projectId: 'p1',
        adapterId: 'sources-adapter',
        domainKind: 'SOURCES',
        projectedAt: '2026-08-06T00:00:00.000Z',
      }),
      snapshotRevision: 5,
    });
    await expect(
      watermarks.upsert({
        ...watermark({
          projectId: 'p1',
          adapterId: 'sources-adapter',
          domainKind: 'SOURCES',
          projectedAt: '2026-08-06T00:00:01.000Z',
        }),
        snapshotRevision: 4,
      }),
    ).rejects.toThrow(/ACTIVITY_WATERMARK_STALE_UPSERT/);
    // The newer watermark survives.
    const result = await watermarks.readByProjectAndAdapter('p1', 'sources-adapter');
    expect(result?.snapshotRevision).toBe(5);
  });

  it('accepts an equal or higher watermark snapshot revision', async () => {
    const { watermarks } = store();
    await watermarks.upsert({
      ...watermark({
        projectId: 'p1',
        adapterId: 'sources-adapter',
        domainKind: 'SOURCES',
        projectedAt: '2026-08-06T00:00:00.000Z',
      }),
      snapshotRevision: 5,
    });
    await watermarks.upsert({
      ...watermark({
        projectId: 'p1',
        adapterId: 'sources-adapter',
        domainKind: 'SOURCES',
        projectedAt: '2026-08-06T00:00:01.000Z',
      }),
      snapshotRevision: 6,
      adapterStatus: 'DEGRADED',
    });
    const result = await watermarks.readByProjectAndAdapter('p1', 'sources-adapter');
    expect(result?.snapshotRevision).toBe(6);
    expect(result?.adapterStatus).toBe('DEGRADED');
  });
});
