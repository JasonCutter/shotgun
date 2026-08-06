import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { createInMemoryActivityReadModelStore } from '../../adapters/frontend-activity-in-memory/src/index.js';
import { createPostgresActivityReadModelStore } from '../../adapters/frontend-activity-postgres/src/index.js';
import { PostgresAskActivityRead } from '../../adapters/frontend-ask-execution-postgres/src/activity-read.js';
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

/** Same updated_at ties exercise the keyset tie-break (domain_kind, activity_id). */
const scenarioTiePagination = async (
  store: ActivityReadModelStorePort,
): Promise<Record<string, unknown>> => {
  const { index } = store;
  const sameTime = '2026-08-06T00:00:00.000Z';
  await index.upsert(
    record({ activityId: 'a1', domainKind: 'SOURCES', state: 'QUEUED', updatedAt: sameTime }),
  );
  await index.upsert(
    record({ activityId: 'a2', domainKind: 'ASK', state: 'QUEUED', updatedAt: sameTime }),
  );
  await index.upsert(
    record({
      activityId: 'a3',
      domainKind: 'EXTERNAL_ACTION',
      state: 'QUEUED',
      updatedAt: sameTime,
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
    secondIds: second.records.map((r) => r.activityId),
    all: [...first.records.map((r) => r.activityId), ...second.records.map((r) => r.activityId)],
  };
};

const scenarioStaleUpsert = async (
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
    await index.upsert(
      record({
        activityId: 'a1',
        domainKind: 'SOURCES',
        state: 'RUNNING',
        updatedAt: '2026-08-06T00:00:01.000Z',
        revision: 4,
      }),
    );
  } catch (error) {
    staleError = error instanceof Error ? error.message.split(':')[0] : undefined;
  }
  await index.upsert(
    record({
      activityId: 'a1',
      domainKind: 'SOURCES',
      state: 'SUCCEEDED',
      updatedAt: '2026-08-06T00:00:02.000Z',
      revision: 6,
    }),
  );
  const page = await index.queryProject({ resourceProjectId: 'project-1', limit: 10 });
  return {
    staleError,
    state: page.records[0]?.state,
    revision: page.records[0]?.snapshotRevision,
  };
};

const scenarioRebuildScope = async (
  store: ActivityReadModelStorePort,
): Promise<Record<string, unknown>> => {
  const { index } = store;
  await index.upsert(
    record({
      activityId: 'a1',
      domainKind: 'SOURCES',
      state: 'QUEUED',
      updatedAt: '2026-08-06T00:00:00.000Z',
      revision: 1,
    }),
  );
  let scopeError: string | undefined;
  try {
    await index.rebuildProject({
      resourceProjectId: 'project-1',
      snapshotRevision: 2,
      records: [
        record({
          activityId: 'x1',
          domainKind: 'SOURCES',
          state: 'QUEUED',
          updatedAt: '2026-08-06T00:00:00.000Z',
          revision: 2,
          projectId: 'project-other',
        }),
      ],
    });
  } catch (error) {
    scopeError = error instanceof Error ? error.message.split(':')[0] : undefined;
  }
  const page = await index.queryProject({ resourceProjectId: 'project-1', limit: 10 });
  return { scopeError, survivorIds: page.records.map((r) => r.activityId) };
};

/** True keyset: the cursor row is deleted after the first page was issued. */
const scenarioCursorRowDeleted = async (
  store: ActivityReadModelStorePort,
): Promise<Record<string, unknown>> => {
  const { index } = store;
  await index.upsert(
    record({
      activityId: 'a1',
      domainKind: 'SOURCES',
      state: 'QUEUED',
      updatedAt: '2026-08-06T00:00:00.000Z',
    }),
  );
  await index.upsert(
    record({
      activityId: 'a2',
      domainKind: 'SOURCES',
      state: 'QUEUED',
      updatedAt: '2026-08-06T00:00:01.000Z',
    }),
  );
  await index.upsert(
    record({
      activityId: 'a3',
      domainKind: 'SOURCES',
      state: 'QUEUED',
      updatedAt: '2026-08-06T00:00:02.000Z',
    }),
  );

  const first = await index.queryProject({ resourceProjectId: 'project-1', limit: 1 });
  // Delete the cursor row (a3) and re-add the rest.
  await index.deleteByProjectAndDomain('project-1', 'SOURCES');
  await index.upsert(
    record({
      activityId: 'a2',
      domainKind: 'SOURCES',
      state: 'QUEUED',
      updatedAt: '2026-08-06T00:00:01.000Z',
    }),
  );
  await index.upsert(
    record({
      activityId: 'a1',
      domainKind: 'SOURCES',
      state: 'QUEUED',
      updatedAt: '2026-08-06T00:00:00.000Z',
    }),
  );
  const second = await index.queryProject({
    resourceProjectId: 'project-1',
    limit: 10,
    cursor: first.nextCursor,
  });
  return { secondIds: second.records.map((r) => r.activityId) };
};

/** True keyset: the cursor row's updatedAt changes after the cursor was issued. */
const scenarioCursorRowUpdated = async (
  store: ActivityReadModelStorePort,
): Promise<Record<string, unknown>> => {
  const { index } = store;
  await index.upsert(
    record({
      activityId: 'a1',
      domainKind: 'SOURCES',
      state: 'QUEUED',
      updatedAt: '2026-08-06T00:00:00.000Z',
    }),
  );
  await index.upsert(
    record({
      activityId: 'a2',
      domainKind: 'SOURCES',
      state: 'QUEUED',
      updatedAt: '2026-08-06T00:00:01.000Z',
    }),
  );
  const first = await index.queryProject({ resourceProjectId: 'project-1', limit: 1 });
  await index.upsert(
    record({
      activityId: 'a2',
      domainKind: 'SOURCES',
      state: 'RUNNING',
      updatedAt: '2026-08-06T00:00:05.000Z',
    }),
  );
  const second = await index.queryProject({
    resourceProjectId: 'project-1',
    limit: 10,
    cursor: first.nextCursor,
  });
  return { secondIds: second.records.map((r) => r.activityId) };
};

const scenarioWatermarkStaleUpsert = async (
  store: ActivityReadModelStorePort,
): Promise<Record<string, unknown>> => {
  const { watermarks } = store;
  await watermarks.upsert({
    ...watermark({
      adapterId: 'sources-adapter',
      domainKind: 'SOURCES',
      projectedAt: '2026-08-06T00:00:00.000Z',
    }),
    snapshotRevision: 5,
  });
  let staleError: string | undefined;
  try {
    await watermarks.upsert({
      ...watermark({
        adapterId: 'sources-adapter',
        domainKind: 'SOURCES',
        projectedAt: '2026-08-06T00:00:01.000Z',
      }),
      snapshotRevision: 4,
    });
  } catch (error) {
    staleError = error instanceof Error ? error.message.split(':')[0] : undefined;
  }
  await watermarks.upsert({
    ...watermark({
      adapterId: 'sources-adapter',
      domainKind: 'SOURCES',
      projectedAt: '2026-08-06T00:00:02.000Z',
    }),
    snapshotRevision: 6,
    adapterStatus: 'DEGRADED',
  });
  const result = await watermarks.readByProjectAndAdapter('project-1', 'sources-adapter');
  return { staleError, revision: result?.snapshotRevision, status: result?.adapterStatus };
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

  it('matches in-memory same-updatedAt tie pagination (tie-break order)', async () => {
    const memory = await scenarioTiePagination(createInMemoryActivityReadModelStore());
    const postgres = await scenarioTiePagination(pgStore());
    expect(postgres).toEqual(memory);
    expect(postgres.all).toEqual(['a2', 'a3', 'a1']);
  });

  it('matches in-memory true keyset when the cursor row is deleted', async () => {
    const memory = await scenarioCursorRowDeleted(createInMemoryActivityReadModelStore());
    const postgres = await scenarioCursorRowDeleted(pgStore());
    expect(postgres).toEqual(memory);
    expect(postgres.secondIds).toEqual(['a2', 'a1']);
  });

  it('matches in-memory true keyset when the cursor row updatedAt changes', async () => {
    const memory = await scenarioCursorRowUpdated(createInMemoryActivityReadModelStore());
    const postgres = await scenarioCursorRowUpdated(pgStore());
    expect(postgres).toEqual(memory);
    expect(postgres.secondIds).toEqual(['a1']);
  });

  it('matches in-memory watermark stale-upsert monotonicity guard', async () => {
    const memory = await scenarioWatermarkStaleUpsert(createInMemoryActivityReadModelStore());
    const postgres = await scenarioWatermarkStaleUpsert(pgStore());
    expect(postgres).toEqual(memory);
    expect(postgres.staleError).toBe('ACTIVITY_WATERMARK_STALE_UPSERT');
    expect(postgres.revision).toBe(6);
    expect(postgres.status).toBe('DEGRADED');
  });

  it('serializes a concurrent upsert and rebuild so a lower revision never wins', async () => {
    const store = pgStore();
    const { index } = store;
    // Seed a revision 1 row, then race a revision-6 upsert against a
    // revision-5 rebuild. The project advisory lock serializes them; the final
    // stored revision must never be lower than the newest committed write.
    await index.upsert(
      record({
        activityId: 'a1',
        domainKind: 'SOURCES',
        state: 'QUEUED',
        updatedAt: '2026-08-06T00:00:00.000Z',
        revision: 1,
      }),
    );
    const results = await Promise.allSettled([
      index.upsert(
        record({
          activityId: 'a1',
          domainKind: 'SOURCES',
          state: 'RUNNING',
          updatedAt: '2026-08-06T00:00:01.000Z',
          revision: 6,
        }),
      ),
      index.rebuildProject({
        resourceProjectId: 'project-1',
        snapshotRevision: 5,
        records: [
          record({
            activityId: 'a1',
            domainKind: 'SOURCES',
            state: 'QUEUED',
            updatedAt: '2026-08-06T00:00:01.000Z',
            revision: 5,
          }),
        ],
      }),
    ]);
    const page = await index.queryProject({ resourceProjectId: 'project-1', limit: 10 });
    const storedRevision = page.records[0]?.snapshotRevision;
    // Either the rebuild was rejected as stale (upsert won first) or the
    // upsert landed after the rebuild; in every interleaving the newest
    // committed revision is 6.
    expect(storedRevision).toBe(6);
    if (results[1]?.status === 'rejected') {
      expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(Error);
    }
  });

  it('matches in-memory stale-upsert monotonicity guard', async () => {
    const memory = await scenarioStaleUpsert(createInMemoryActivityReadModelStore());
    const postgres = await scenarioStaleUpsert(pgStore());
    expect(postgres).toEqual(memory);
    expect(postgres.staleError).toBe('ACTIVITY_INDEX_STALE_UPSERT');
    expect(postgres.revision).toBe(6);
  });

  it('matches in-memory rebuild scope validation (validated before delete)', async () => {
    const memory = await scenarioRebuildScope(createInMemoryActivityReadModelStore());
    const postgres = await scenarioRebuildScope(pgStore());
    expect(postgres).toEqual(memory);
    expect(postgres.scopeError).toBe('ACTIVITY_INDEX_REBUILD_SCOPE');
    expect(postgres.survivorIds).toEqual(['a1']);
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

  it('rejects an invalid record at both the in-memory boundary and the database CHECK', async () => {
    // In-memory runtime validation rejects ASK with a JOB root.
    const invalid: ActivityIndexRecordV1 = {
      ...record({
        activityId: 'a1',
        domainKind: 'ASK',
        state: 'QUEUED',
        updatedAt: '2026-08-06T00:00:00.000Z',
      }),
      rootKind: 'JOB',
      jobId: 'job-x',
    };
    const memory = createInMemoryActivityReadModelStore();
    await expect(memory.index.upsert(invalid)).rejects.toThrow(/must use a RUN root/);

    // The database CHECK constraint rejects the same row.
    await expect(
      pool!.query(
        `INSERT INTO frontend_activity.activity_index (
           resource_project_id, activity_id, domain_kind, root_kind,
           domain_resource_kind, domain_resource_id, resource_href, job_id,
           run_id, summary, state, attention, retryability, freshness,
           adapter_status, snapshot_revision, snapshot, projected_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [
          'project-1',
          'a1',
          'ASK',
          'JOB',
          'Resource',
          'resource-a1',
          '/activity/a1',
          'job-x',
          'run-a1',
          'summary-a1',
          'QUEUED',
          'NONE',
          'UNKNOWN',
          'CURRENT',
          'AVAILABLE',
          1,
          JSON.stringify({ activityId: 'a1' }),
          '2026-08-06T00:00:00.000Z',
          '2026-08-06T00:00:00.000Z',
        ],
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it('matches in-memory direct identity lookup (findByIdentity)', async () => {
    const scenario = async (
      store: ActivityReadModelStorePort,
    ): Promise<Record<string, unknown>> => {
      await store.index.upsert(
        record({
          activityId: 'a1',
          domainKind: 'SOURCES',
          state: 'RUNNING',
          updatedAt: '2026-08-06T00:00:03.000Z',
        }),
      );
      await store.index.upsert(
        record({
          activityId: 'a1',
          domainKind: 'ASK',
          state: 'SUCCEEDED',
          updatedAt: '2026-08-06T00:00:01.000Z',
        }),
      );
      const found = await store.index.findByIdentity({
        resourceProjectId: 'project-1',
        domainKind: 'SOURCES',
        activityId: 'a1',
      });
      const ask = await store.index.findByIdentity({
        resourceProjectId: 'project-1',
        domainKind: 'ASK',
        activityId: 'a1',
      });
      const missing = await store.index.findByIdentity({
        resourceProjectId: 'project-1',
        domainKind: 'SOURCES',
        activityId: 'missing',
      });
      return {
        sourcesActivityId: found?.activityId,
        sourcesDomainKind: found?.domainKind,
        askActivityId: ask?.activityId,
        askDomainKind: ask?.domainKind,
        missing: missing === undefined,
      };
    };
    const memory = await scenario(createInMemoryActivityReadModelStore());
    const postgres = await scenario(pgStore());
    expect(postgres).toEqual(memory);
    expect(postgres.sourcesActivityId).toBe('a1');
    expect(postgres.askDomainKind).toBe('ASK');
    expect(postgres.missing).toBe(true);
  });

  it('matches in-memory atomic commitProjectProjection (index + watermarks in one CAS)', async () => {
    const scenario = async (
      store: ActivityReadModelStorePort,
    ): Promise<Record<string, unknown>> => {
      const records = [
        record({
          activityId: 'a1',
          domainKind: 'SOURCES',
          state: 'RUNNING',
          updatedAt: '2026-08-06T00:00:03.000Z',
          revision: 1,
        }),
        record({
          activityId: 'a2',
          domainKind: 'ASK',
          state: 'SUCCEEDED',
          updatedAt: '2026-08-06T00:00:01.000Z',
          revision: 1,
        }),
      ];
      const watermarks = [
        {
          ...watermark({
            adapterId: 'sources-adapter',
            domainKind: 'SOURCES',
            projectedAt: '2026-08-06T00:00:03.000Z',
          }),
          snapshotRevision: 1,
        },
        {
          ...watermark({
            adapterId: 'ask-adapter',
            domainKind: 'ASK',
            projectedAt: '2026-08-06T00:00:01.000Z',
          }),
          snapshotRevision: 1,
        },
      ];
      await store.commitProjectProjection({
        resourceProjectId: 'project-1',
        snapshotRevision: 1,
        records,
        watermarks,
      });
      const page = await store.index.queryProject({ resourceProjectId: 'project-1', limit: 10 });
      const storedWatermarks = await store.watermarks.readByProject('project-1');
      // A concurrent same-revision commit must fail closed (CAS).
      let staleError: string | undefined;
      try {
        await store.commitProjectProjection({
          resourceProjectId: 'project-1',
          snapshotRevision: 1,
          records: [
            record({
              activityId: 'a9',
              domainKind: 'SOURCES',
              state: 'QUEUED',
              updatedAt: '2026-08-06T00:00:04.000Z',
              revision: 1,
            }),
          ],
          watermarks: [
            {
              ...watermark({
                adapterId: 'sources-adapter',
                domainKind: 'SOURCES',
                projectedAt: '2026-08-06T00:00:04.000Z',
              }),
              snapshotRevision: 1,
            },
          ],
        });
      } catch (error) {
        staleError = error instanceof Error ? error.message.split(':')[0] : undefined;
      }
      const after = await store.index.queryProject({ resourceProjectId: 'project-1', limit: 10 });
      return {
        ids: page.records.map((r) => r.activityId),
        watermarkAdapterIds: storedWatermarks.map((w) => w.adapterId),
        staleError,
        afterIds: after.records.map((r) => r.activityId),
      };
    };
    const memory = await scenario(createInMemoryActivityReadModelStore());
    const postgres = await scenario(pgStore());
    expect(postgres).toEqual(memory);
    expect(postgres.ids).toEqual(['a1', 'a2']);
    expect(postgres.watermarkAdapterIds).toEqual(['ask-adapter', 'sources-adapter']);
    expect(postgres.staleError).toBe('ACTIVITY_INDEX_STALE_REBUILD');
    // The failed same-revision commit published nothing.
    expect(postgres.afterIds).toEqual(['a1', 'a2']);
  });

  it('Ask PostgreSQL read revalidates sensitivity and access/policy binding', async () => {
    // Clean up any leftover rows from an interrupted previous run (deleting
    // the conversation cascades its branches and turns).
    await pool!.query('DELETE FROM frontend_ask.answer_runs WHERE project_id = $1', [
      'activity-test-project',
    ]);
    await pool!.query('DELETE FROM frontend_command.command_ledger WHERE command_id = $1', [
      'cmd-activity-1',
    ]);
    await pool!.query('DELETE FROM frontend_ask.conversations WHERE conversation_id = $1', [
      'conv-activity-1',
    ]);
    await pool!.query('DELETE FROM project_admin.projects WHERE id = $1', [
      'activity-test-project',
    ]);
    // Seed the FK chain (conversation↔branch is a deferred FK) in ONE
    // transaction: project → conversation → branch → turn → command_ledger →
    // answer_run (sensitivity restricted, access-1/policy-1).
    const client = await pool!.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO project_admin.projects (id, name, active, created_at, updated_at)
         VALUES ('activity-test-project', 'Activity Test', true, now(), now())`,
      );
      await client.query(
        `INSERT INTO frontend_ask.conversations
           (conversation_id, project_id, title, active_branch_id, conversation_revision, created_at, updated_at)
         VALUES ('conv-activity-1', 'activity-test-project', 'conv', 'branch-activity-1', 'c1', now(), now())`,
      );
      await client.query(
        `INSERT INTO frontend_ask.branches
           (branch_id, conversation_id, label, branch_revision, created_at, updated_at)
         VALUES ('branch-activity-1', 'conv-activity-1', 'branch', 'b1', now(), now())`,
      );
      await client.query(
        `INSERT INTO frontend_ask.turns
           (turn_id, conversation_id, branch_id, ordinal, user_message, ask_mode, turn_revision, created_at)
         VALUES ('turn-activity-1', 'conv-activity-1', 'branch-activity-1', 1, 'q', 'CANONICAL_ONLY', 't1', now())`,
      );
      await client.query(
        `INSERT INTO frontend_command.command_ledger (
           command_id, command_revision, client_request_id, idempotency_key, principal_id,
           target_project_id, command_type, command_schema_version, command_semantic_digest,
           policy_binding, accepted_principal_context, accepted_project_context,
           accepted_policy_context, preconditions, command_payload, outcome_state,
           correlation_id, trace_id, received_at, last_updated_at
         ) VALUES (
           'cmd-activity-1', 1, 'client-activity-1', 'idem-activity-1', 'principal-1',
           'activity-test-project', 'ask.run.submit.v1', '1.0.0', 'digest',
           '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, '{}'::jsonb,
           'COMPLETED', 'corr-1', 'trace-1', now(), now()
         )`,
      );
      await client.query(
        `INSERT INTO frontend_ask.answer_runs (
           answer_run_id, conversation_id, branch_id, turn_id, project_id, create_command_id,
           mode, state, question, capabilities, answer_revision, conversation_revision,
           access_revision, policy_context_revision, created_at, updated_at,
           sensitivity_clearance, access_scope, attempt_number, event_revision
         ) VALUES (
           'run-activity-1', 'conv-activity-1', 'branch-activity-1', 'turn-activity-1',
           'activity-test-project', 'cmd-activity-1', 'CANONICAL_ONLY', 'RUNNING', 'q',
           '{}', 'a1', 'c1', 'access-1', 'policy-1', now(), now(),
           'restricted', ARRAY['owner'], 1, 0
         )`,
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      client.release();
      throw error;
    }
    try {
      const read = new PostgresAskActivityRead(pool!);
      // Inadequate sensitivity clearance → denied (undefined → adapter NOT_FOUND).
      const denied = await read.getAnswerRun({
        projectId: 'activity-test-project',
        answerRunId: 'run-activity-1',
        sensitivityClearance: 'public',
        accessRevision: 'access-1',
        policyContextRevision: 'policy-1',
      });
      // Adequate clearance + matching binding → found.
      const granted = await read.getAnswerRun({
        projectId: 'activity-test-project',
        answerRunId: 'run-activity-1',
        sensitivityClearance: 'restricted',
        accessRevision: 'access-1',
        policyContextRevision: 'policy-1',
      });
      // Adequate clearance but stale access revision → denied.
      const staleAccess = await read.getAnswerRun({
        projectId: 'activity-test-project',
        answerRunId: 'run-activity-1',
        sensitivityClearance: 'restricted',
        accessRevision: 'access-2',
        policyContextRevision: 'policy-1',
      });
      expect(denied).toBeUndefined();
      expect(granted?.answerRunId).toBe('run-activity-1');
      expect(granted?.attemptId).toBeUndefined();
      expect(staleAccess).toBeUndefined();
    } finally {
      client.release();
      await pool!.query('DELETE FROM frontend_ask.answer_runs WHERE project_id = $1', [
        'activity-test-project',
      ]);
      await pool!.query('DELETE FROM frontend_command.command_ledger WHERE command_id = $1', [
        'cmd-activity-1',
      ]);
      // Deleting the conversation cascades its branches and turns.
      await pool!.query('DELETE FROM frontend_ask.conversations WHERE conversation_id = $1', [
        'conv-activity-1',
      ]);
      await pool!.query('DELETE FROM project_admin.projects WHERE id = $1', [
        'activity-test-project',
      ]);
    }
  });
});
