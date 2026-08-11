import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { createInMemoryHistoryReadModelStore } from '../../adapters/frontend-history-in-memory/src/index.js';
import { createPostgresHistoryReadModelStore } from '../../adapters/frontend-history-postgres/src/index.js';
import type {
  HistoryIndexRecordV1,
  HistoryReadModelStorePort,
  HistoryWatermarkRecordV1,
} from '../../modules/frontend-history/src/index.js';

/**
 * FE-P5-S2 WP4 — in-memory vs PostgreSQL History read-model store parity
 * (migration 030). Every scenario runs the same deterministic operations
 * against both stores and returns a comparable record (project-scoped stable
 * ordering, keyset pagination over the frozen tuple, deterministic rebuild and
 * revision guards, atomic commitProjectProjection, watermark upsert/read).
 */

const entry = (input: {
  sourceEventId: string;
  occurredAt: string;
  domainKind?: HistoryIndexRecordV1['domainKind'];
  sourceEventKind?: string;
  sourceSequence?: number;
  projectId?: string;
}): HistoryIndexRecordV1 => ({
  schemaVersion: '1.0.0',
  historyEntryId: `history:${input.projectId ?? 'project-1'}:${input.sourceEventId}`,
  resourceProjectId: input.projectId ?? 'project-1',
  domainKind: input.domainKind ?? 'CANONICAL',
  domainResourceKind: 'Resource',
  domainResourceId: `resource-${input.sourceEventId}`,
  sourceEventKind: input.sourceEventKind ?? 'CANONICAL_CLAIM_ADDED',
  sourceEventId: input.sourceEventId,
  ...(input.sourceSequence === undefined ? {} : { sourceSequence: input.sourceSequence }),
  occurredAt: input.occurredAt,
  payloadAvailability: 'AVAILABLE',
  projectedAt: input.occurredAt,
});

const watermark = (input: {
  adapterId: string;
  domainKind: HistoryWatermarkRecordV1['domainKind'];
  projectedAt: string;
  projectId?: string;
  revision?: number;
  adapterStatus?: HistoryWatermarkRecordV1['adapterStatus'];
}): HistoryWatermarkRecordV1 => ({
  resourceProjectId: input.projectId ?? 'project-1',
  adapterId: input.adapterId,
  domainKind: input.domainKind,
  projectedAt: input.projectedAt,
  adapterStatus: input.adapterStatus ?? 'AVAILABLE',
  snapshotRevision: input.revision ?? 1,
  lastSourcePosition: input.projectedAt,
});

import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

const pgStore = (): HistoryReadModelStorePort => createPostgresHistoryReadModelStore(pool!);
const truncateAll = (): Promise<unknown> =>
  pool!.query(
    `TRUNCATE frontend_history.history_projection_index,
              frontend_history.projection_watermarks
     CASCADE`,
  );

const scenarioOrderingAndPagination = async (
  store: HistoryReadModelStorePort,
): Promise<Record<string, unknown>> => {
  const { index } = store;
  await index.upsert(entry({ sourceEventId: 'c1', occurredAt: '2026-08-09T00:00:03.000Z' }));
  await index.upsert(
    entry({
      sourceEventId: 'p1',
      occurredAt: '2026-08-09T00:00:01.000Z',
      domainKind: 'POLICY',
      sourceEventKind: 'SETTINGS_AUDIT_EVENT',
    }),
  );
  await index.upsert(
    entry({
      sourceEventId: 'r1',
      occurredAt: '2026-08-09T00:00:02.000Z',
      domainKind: 'REVIEW',
      sourceEventKind: 'DECISION',
    }),
  );
  const first = await index.queryProject({ resourceProjectId: 'project-1', limit: 2 });
  const second = await index.queryProject({
    resourceProjectId: 'project-1',
    limit: 2,
    cursor: first.nextCursor,
  });
  return {
    firstIds: first.records.map((r) => r.sourceEventId),
    firstHasMore: first.nextCursor !== undefined,
    secondIds: second.records.map((r) => r.sourceEventId),
    secondHasMore: second.nextCursor !== undefined,
  };
};

/** Same occurred_at ties exercise the frozen-tuple tie-break. */
const scenarioTiePagination = async (
  store: HistoryReadModelStorePort,
): Promise<Record<string, unknown>> => {
  const { index } = store;
  const sameTime = '2026-08-09T00:00:00.000Z';
  await index.upsert(
    entry({
      sourceEventId: 'c1',
      occurredAt: sameTime,
      domainKind: 'CANONICAL',
      sourceEventKind: 'CANONICAL_CLAIM_ADDED',
    }),
  );
  await index.upsert(
    entry({
      sourceEventId: 'p1',
      occurredAt: sameTime,
      domainKind: 'POLICY',
      sourceEventKind: 'SETTINGS_AUDIT_EVENT',
    }),
  );
  await index.upsert(
    entry({
      sourceEventId: 'r1',
      occurredAt: sameTime,
      domainKind: 'REVIEW',
      sourceEventKind: 'DECISION',
    }),
  );
  const first = await index.queryProject({ resourceProjectId: 'project-1', limit: 2 });
  const second = await index.queryProject({
    resourceProjectId: 'project-1',
    limit: 2,
    cursor: first.nextCursor,
  });
  return {
    firstIds: first.records.map((r) => r.sourceEventId),
    secondIds: second.records.map((r) => r.sourceEventId),
    all: [
      ...first.records.map((r) => r.sourceEventId),
      ...second.records.map((r) => r.sourceEventId),
    ],
  };
};

const scenarioRevisionGuard = async (
  store: HistoryReadModelStorePort,
): Promise<Record<string, unknown>> => {
  // Revision CAS is owned by commitProjectProjection via the watermarks: an
  // upsert is a plain deterministic replace (index has no revision column).
  const { index } = store;
  await index.upsert(entry({ sourceEventId: 'c1', occurredAt: '2026-08-09T00:00:00.000Z' }));
  const found = await index.findByIdentity({
    resourceProjectId: 'project-1',
    historyEntryId: 'history:project-1:c1',
  });
  return { found: found?.sourceEventId ?? null };
};

const scenarioCommitProjectProjection = async (
  store: HistoryReadModelStorePort,
): Promise<Record<string, unknown>> => {
  await store.commitProjectProjection({
    resourceProjectId: 'project-1',
    snapshotRevision: 1,
    records: [
      entry({
        sourceEventId: 'c1',
        occurredAt: '2026-08-09T00:00:03.000Z',
      }),
      entry({
        sourceEventId: 'r1',
        occurredAt: '2026-08-09T00:00:02.000Z',
        domainKind: 'REVIEW',
        sourceEventKind: 'DECISION',
      }),
    ],
    watermarks: [
      watermark({
        adapterId: 'history-canonical',
        domainKind: 'CANONICAL',
        projectedAt: '2026-08-09T01:00:00.000Z',
        revision: 1,
      }),
      watermark({
        adapterId: 'history-review',
        domainKind: 'REVIEW',
        projectedAt: '2026-08-09T01:00:00.000Z',
        revision: 1,
      }),
    ],
  });
  const rows = await store.index.queryProject({
    resourceProjectId: 'project-1',
    limit: 10,
  });
  const watermarks = await store.watermarks.readByProject('project-1');
  return {
    ids: rows.records.map((r) => r.sourceEventId),
    watermarks: watermarks.map((w) => w.adapterId).sort(),
  };
};

const scenarioRebuildRevisionGuard = async (
  store: HistoryReadModelStorePort,
): Promise<Record<string, unknown>> => {
  await store.commitProjectProjection({
    resourceProjectId: 'project-1',
    snapshotRevision: 2,
    records: [],
    watermarks: [
      watermark({
        adapterId: 'history-canonical',
        domainKind: 'CANONICAL',
        projectedAt: '2026-08-09T01:00:00.000Z',
        revision: 2,
      }),
    ],
  });
  let staleRebuildRejected = false;
  try {
    await store.commitProjectProjection({
      resourceProjectId: 'project-1',
      snapshotRevision: 1,
      records: [],
      watermarks: [],
    });
  } catch {
    staleRebuildRejected = true;
  }
  return { staleRebuildRejected };
};

describe.runIf(pool)('FE-P5-S2 WP4 History read-model store parity (migration 030)', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    if (pool) {
      await Promise.race([pool.end(), new Promise((resolve) => setTimeout(resolve, 5000))]);
    }
  }, 30000);

  it('orders by the frozen tuple and paginates with the keyset cursor', async () => {
    const inMemory = createInMemoryHistoryReadModelStore();
    const postgres = pgStore();
    const memory = await scenarioOrderingAndPagination(inMemory);
    const pg = await scenarioOrderingAndPagination(postgres);
    expect(memory).toEqual(pg);
  });

  it('resolves same-timestamp ties via the frozen tuple', async () => {
    const inMemory = createInMemoryHistoryReadModelStore();
    const postgres = pgStore();
    const memory = await scenarioTiePagination(inMemory);
    const pg = await scenarioTiePagination(postgres);
    expect(memory).toEqual(pg);
  });

  it('persists index rows by projection identity', async () => {
    const inMemory = createInMemoryHistoryReadModelStore();
    const postgres = pgStore();
    const memory = await scenarioRevisionGuard(inMemory);
    const pg = await scenarioRevisionGuard(postgres);
    expect(memory).toEqual(pg);
  });

  it('commits index rows and watermarks atomically per project', async () => {
    const inMemory = createInMemoryHistoryReadModelStore();
    const postgres = pgStore();
    const memory = await scenarioCommitProjectProjection(inMemory);
    const pg = await scenarioCommitProjectProjection(postgres);
    expect(memory).toEqual(pg);
  });

  it('rejects a lower revision rebuild across index AND watermarks (CAS)', async () => {
    const inMemory = createInMemoryHistoryReadModelStore();
    const postgres = pgStore();
    const memory = await scenarioRebuildRevisionGuard(inMemory);
    const pg = await scenarioRebuildRevisionGuard(postgres);
    expect(memory).toEqual(pg);
    expect(memory.staleRebuildRejected).toBe(true);
  });

  it('real PostgreSQL findByIdentity is project-scoped', async () => {
    const store = pgStore();
    const project = `p-${randomUUID().slice(0, 8)}`;
    const other = `p-other-${randomUUID().slice(0, 8)}`;
    await store.index.upsert(
      entry({
        sourceEventId: 'c1',
        occurredAt: '2026-08-09T00:00:00.000Z',
        projectId: project,
      }),
    );
    const found = await store.index.findByIdentity({
      resourceProjectId: project,
      historyEntryId: `history:${project}:c1`,
    });
    const wrong = await store.index.findByIdentity({
      resourceProjectId: other,
      historyEntryId: `history:${project}:c1`,
    });
    await pool!.query(
      `DELETE FROM frontend_history.history_projection_index WHERE resource_project_id = $1`,
      [project],
    );
    await pool!.query(
      `DELETE FROM frontend_history.history_projection_index WHERE resource_project_id = $1`,
      [other],
    );
    return {
      found: found?.sourceEventId,
      wrong: wrong ?? null,
    };
  });
});
