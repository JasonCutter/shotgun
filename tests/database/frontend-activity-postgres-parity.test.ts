import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { createInMemoryActivityReadModelStore } from '../../adapters/frontend-activity-in-memory/src/index.js';
import { createPostgresActivityReadModelStore } from '../../adapters/frontend-activity-postgres/src/index.js';
import type {
  ActivityIndexRecordV1,
  ActivityReadModelStorePort,
  ActivityWatermarkRecordV1,
} from '../../modules/frontend-activity/src/index.js';

/**
 * FE-P5-S1 WP2 — in-memory vs PostgreSQL Activity read-model store parity
 * (migration 029). Every scenario runs the same deterministic operations
 * against both stores and returns a comparable record (project-scoped stable
 * ordering, keyset pagination, deterministic rebuild and revision guards,
 * watermark upsert/read).
 */

const record = (input: {
  activityId: string;
  domainKind: ActivityIndexRecordV1['domainKind'];
  state: ActivityIndexRecordV1['state'];
  updatedAt: string;
  revision?: number;
  projectId?: string;
}): ActivityIndexRecordV1 => ({
  resourceProjectId: input.projectId ?? 'project-1',
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
  snapshot: { activityId: input.activityId },
  projectedAt: input.updatedAt,
  updatedAt: input.updatedAt,
});

const watermark = (input: {
  adapterId: string;
  domainKind: ActivityWatermarkRecordV1['domainKind'];
  projectedAt: string;
}): ActivityWatermarkRecordV1 => ({
  resourceProjectId: 'project-1',
  adapterId: input.adapterId,
  domainKind: input.domainKind,
  projectedAt: input.projectedAt,
  adapterStatus: 'AVAILABLE',
  snapshotRevision: 1,
  updatedAt: input.projectedAt,
});

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

const pgStore = (): ActivityReadModelStorePort => createPostgresActivityReadModelStore(pool!);

const truncateAll = (): Promise<unknown> =>
  pool!.query(
    `TRUNCATE frontend_activity.activity_index,
              frontend_activity.projection_watermarks
     CASCADE`,
  );

const scenarioOrderingAndPagination = async (
  store: ActivityReadModelStorePort,
): Promise<Record<string, unknown>> => {
  const { index } = store;
  await index.upsert(
    record({
      activityId: 'a1',
      domainKind: 'SOURCES',
      state: 'RUNNING',
      updatedAt: '2026-08-06T00:00:03.000Z',
    }),
  );
  await index.upsert(
    record({
      activityId: 'a2',
      domainKind: 'ASK',
      state: 'SUCCEEDED',
      updatedAt: '2026-08-06T00:00:01.000Z',
    }),
  );
  await index.upsert(
    record({
      activityId: 'a3',
      domainKind: 'EXTERNAL_ACTION',
      state: 'QUEUED',
      updatedAt: '2026-08-06T00:00:02.000Z',
    }),
  );

  const first = await index.queryProject({ resourceProjectId: 'project-1', limit: 2 });
  const second = await index.queryProject({
    resourceProjectId: 'project-1',
    limit: 2,
    cursor: first.nextCursor,
  });
  return {
    firstIds: first.records.map((r) => r.activityId),
    firstHasMore: first.nextCursor !== undefined,
    secondIds: second.records.map((r) => r.activityId),
    secondHasMore: second.nextCursor !== undefined,
  };
};

const scenarioRebuildAndGuard = async (
  store: ActivityReadModelStorePort,
): Promise<Record<string, unknown>> => {
  const { index } = store;
  await index.upsert(
    record({
      activityId: 'a1',
      domainKind: 'SOURCES',
      state: 'QUEUED',
      updatedAt: '2026-08-06T00:00:00.000Z',
      revision: 5,
    }),
  );

  let staleError: string | undefined;
  try {
    await index.rebuildProject({
      resourceProjectId: 'project-1',
      snapshotRevision: 4,
      records: [],
    });
  } catch (error) {
    staleError = error instanceof Error ? error.message.split(':')[0] : undefined;
  }

  await index.rebuildProject({
    resourceProjectId: 'project-1',
    snapshotRevision: 6,
    records: [
      record({
        activityId: 'a1',
        domainKind: 'SOURCES',
        state: 'SUCCEEDED',
        updatedAt: '2026-08-06T00:00:01.000Z',
        revision: 6,
      }),
      record({
        activityId: 'a2',
        domainKind: 'ASK',
        state: 'QUEUED',
        updatedAt: '2026-08-06T00:00:01.000Z',
        revision: 6,
      }),
    ],
  });

  const page = await index.queryProject({ resourceProjectId: 'project-1', limit: 10 });
  return {
    staleError,
    ids: page.records.map((r) => r.activityId),
    states: page.records.map((r) => r.state),
    revisions: page.records.map((r) => r.snapshotRevision),
  };
};

const scenarioWatermarks = async (
  store: ActivityReadModelStorePort,
): Promise<Record<string, unknown>> => {
  const { watermarks } = store;
  await watermarks.upsert(
    watermark({
      adapterId: 'sources-adapter',
      domainKind: 'SOURCES',
      projectedAt: '2026-08-06T00:00:00.000Z',
    }),
  );
  await watermarks.upsert(
    watermark({
      adapterId: 'ask-adapter',
      domainKind: 'ASK',
      projectedAt: '2026-08-06T00:00:01.000Z',
    }),
  );
  const project = await watermarks.readByProject('project-1');
  const one = await watermarks.readByProjectAndAdapter('project-1', 'sources-adapter');
  return {
    adapterIds: project.map((w) => w.adapterId),
    oneKind: one?.domainKind,
  };
};

describe.runIf(pool)('FE-P5-S1 in-memory vs PostgreSQL Activity read-model parity', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('matches in-memory stable ordering and keyset pagination', async () => {
    const memory = await scenarioOrderingAndPagination(createInMemoryActivityReadModelStore());
    const postgres = await scenarioOrderingAndPagination(pgStore());
    expect(postgres).toEqual(memory);
  });

  it('matches in-memory deterministic rebuild and stale-revision guard', async () => {
    const memory = await scenarioRebuildAndGuard(createInMemoryActivityReadModelStore());
    const postgres = await scenarioRebuildAndGuard(pgStore());
    expect(postgres).toEqual(memory);
    expect(postgres.staleError).toBe('ACTIVITY_INDEX_STALE_REBUILD');
  });

  it('matches in-memory projection watermark upsert and read', async () => {
    const memory = await scenarioWatermarks(createInMemoryActivityReadModelStore());
    const postgres = await scenarioWatermarks(pgStore());
    expect(postgres).toEqual(memory);
  });
});
