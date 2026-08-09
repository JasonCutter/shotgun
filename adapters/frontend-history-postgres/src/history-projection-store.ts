/**
 * FE-P5-S2 WP4 — PostgreSQL Federated History projection stores.
 *
 * `PostgresHistoryIndexStore` + `PostgresHistoryWatermarkStore` +
 * `createPostgresHistoryReadModelStore` implement the federated History read
 * model boundary over `frontend_history.history_projection_index` and
 * `frontend_history.projection_watermarks` (migration 030). The pattern mirrors
 * the FE-P5-S1 Activity stores (IR r1 §4): project-scoped advisory lock,
 * snapshot-revision CAS (a lower revision never replaces a newer one), and an
 * atomic `commitProjectProjection` that replaces the index AND every watermark
 * in one transaction so the index and watermarks never diverge.
 */

import type { Pool, PoolClient, QueryResultRow } from 'pg';

import type {
  HistoryIndexPageV1,
  HistoryIndexQueryV1,
  HistoryIndexRecordV1,
  HistoryIndexStorePort,
  HistoryReadModelStorePort,
  HistorySourceDomainKindV1,
  HistoryWatermarkRecordV1,
  HistoryWatermarkStorePort,
} from '../../../modules/frontend-history/src/index.js';
import {
  assertHistoryRebuildRevisionNotLower,
  isHistoryRecordAfter,
  validateHistoryRebuildBatch,
} from '../../../modules/frontend-history/src/index.js';
import type { HistoryCursorV1 } from '../../../packages/contracts/src/index.js';

// Re-exported so the adapter package surface mirrors the module boundary.
export type {
  HistoryIndexPageV1,
  HistoryIndexQueryV1,
  HistoryIndexRecordV1,
  HistoryIndexStorePort,
  HistoryReadModelStorePort,
  HistorySourceDomainKindV1,
  HistoryWatermarkRecordV1,
  HistoryWatermarkStorePort,
} from '../../../modules/frontend-history/src/index.js';

type HistoryIndexRow = QueryResultRow & {
  readonly history_entry_id: string;
  readonly resource_project_id: string;
  readonly domain_kind: string;
  readonly domain_resource_kind: string;
  readonly domain_resource_id: string;
  readonly source_event_kind: string;
  readonly source_event_id: string;
  readonly source_sequence: number | null;
  readonly occurred_at: Date;
  readonly payload_availability: string;
  readonly payload_snapshot: unknown;
  readonly projected_at: Date;
};

const historyIndexRecordFrom = (row: HistoryIndexRow): HistoryIndexRecordV1 => ({
  schemaVersion: '1.0.0',
  historyEntryId: row.history_entry_id,
  resourceProjectId: row.resource_project_id,
  domainKind: row.domain_kind as HistorySourceDomainKindV1,
  domainResourceKind: row.domain_resource_kind,
  domainResourceId: row.domain_resource_id,
  sourceEventKind: row.source_event_kind,
  sourceEventId: row.source_event_id,
  ...(row.source_sequence === null ? {} : { sourceSequence: Number(row.source_sequence) }),
  occurredAt: row.occurred_at.toISOString(),
  payloadAvailability: row.payload_availability as HistoryIndexRecordV1['payloadAvailability'],
  ...(row.payload_snapshot === null || row.payload_snapshot === undefined
    ? {}
    : { payloadSnapshot: row.payload_snapshot }),
  projectedAt: row.projected_at.toISOString(),
});

const historyRecordToParams = (record: HistoryIndexRecordV1): unknown[] => [
  record.resourceProjectId,
  record.historyEntryId,
  record.domainKind,
  record.domainResourceKind,
  record.domainResourceId,
  record.sourceEventKind,
  record.sourceEventId,
  record.sourceSequence ?? null,
  record.occurredAt,
  record.payloadAvailability,
  record.payloadSnapshot ?? null,
  record.projectedAt,
];

const HISTORY_INDEX_COLUMNS = `(
  resource_project_id, history_entry_id, domain_kind, domain_resource_kind,
  domain_resource_id, source_event_kind, source_event_id, source_sequence,
  occurred_at, payload_availability, payload_snapshot, projected_at
)`;

const HISTORY_INDEX_VALUES = `($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`;

const historyCursorParams = (cursor: HistoryCursorV1): unknown[] => [
  cursor.occurredAt,
  cursor.domainKind,
  cursor.sourceEventKind,
  cursor.sourceEventId,
  cursor.sourceSequence ?? 0,
];

/**
 * Serialize all History index writes for a Project with a PostgreSQL advisory
 * transaction lock (IR r1 §4 rule 5/6). A single project-level lock key avoids
 * deadlocks between full and per-domain rebuilds.
 */
async function withHistoryProjectWriteLock<T>(
  clientOrPool: Pool | PoolClient,
  projectId: string,
  action: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = 'query' in clientOrPool ? await (clientOrPool as Pool).connect() : clientOrPool;
  const ownsClient = client === clientOrPool;
  try {
    if (ownsClient) await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [projectId]);
    const result = await action(client);
    if (ownsClient) await client.query('COMMIT');
    return result;
  } catch (error) {
    if (ownsClient) await client.query('ROLLBACK');
    throw error;
  } finally {
    if (ownsClient) client.release();
  }
}

export class PostgresHistoryIndexStore implements HistoryIndexStorePort {
  constructor(private readonly pool: Pool) {}

  async upsert(record: HistoryIndexRecordV1): Promise<void> {
    await withHistoryProjectWriteLock(this.pool, record.resourceProjectId, async (client) => {
      await client.query(
        `INSERT INTO frontend_history.history_projection_index ${HISTORY_INDEX_COLUMNS}
         VALUES ${HISTORY_INDEX_VALUES}
         ON CONFLICT (resource_project_id, history_entry_id) DO UPDATE SET
           domain_kind = EXCLUDED.domain_kind,
           domain_resource_kind = EXCLUDED.domain_resource_kind,
           domain_resource_id = EXCLUDED.domain_resource_id,
           source_event_kind = EXCLUDED.source_event_kind,
           source_event_id = EXCLUDED.source_event_id,
           source_sequence = EXCLUDED.source_sequence,
           occurred_at = EXCLUDED.occurred_at,
           payload_availability = EXCLUDED.payload_availability,
           payload_snapshot = EXCLUDED.payload_snapshot,
           projected_at = EXCLUDED.projected_at`,
        historyRecordToParams(record),
      );
    });
  }

  async findByIdentity(input: {
    readonly resourceProjectId: string;
    readonly historyEntryId: string;
  }): Promise<HistoryIndexRecordV1 | undefined> {
    const result = await this.pool.query<HistoryIndexRow>(
      `SELECT * FROM frontend_history.history_projection_index
       WHERE resource_project_id = $1 AND history_entry_id = $2`,
      [input.resourceProjectId, input.historyEntryId],
    );
    return result.rows[0] ? historyIndexRecordFrom(result.rows[0]) : undefined;
  }

  async queryProject(input: HistoryIndexQueryV1): Promise<HistoryIndexPageV1> {
    const params: unknown[] = [input.resourceProjectId];
    const conditions = ['resource_project_id = $1'];
    if (input.domainKinds && input.domainKinds.length > 0) {
      params.push(input.domainKinds);
      conditions.push(`domain_kind = ANY($${params.length})`);
    }
    if (input.cursor !== undefined) {
      params.push(...historyCursorParams(input.cursor));
      // Keyset predicate matching ORDER BY occurred_at DESC, domain_kind ASC,
      // source_event_kind ASC, source_event_id ASC, source_sequence ASC:
      // rows after the cursor have a smaller occurred_at, or the same
      // occurred_at with a LARGER (domain_kind, source_event_kind,
      // source_event_id, source_sequence) tie-break (frozen tuple).
      const occurredParam = params.length - 4;
      const kindParam = params.length - 3;
      const eventKindParam = params.length - 2;
      const idParam = params.length - 1;
      const seqParam = params.length;
      conditions.push(
        `(occurred_at < $${occurredParam}
          OR (occurred_at = $${occurredParam}
              AND (domain_kind, source_event_kind, source_event_id, COALESCE(source_sequence, 0))
                  > ($${kindParam}, $${eventKindParam}, $${idParam}, $${seqParam})))`,
      );
    }
    params.push(input.limit + 1);
    const result = await this.pool.query<HistoryIndexRow>(
      `SELECT * FROM frontend_history.history_projection_index
       WHERE ${conditions.join(' AND ')}
       ORDER BY occurred_at DESC, domain_kind ASC, source_event_kind ASC,
                source_event_id ASC, source_sequence ASC
       LIMIT $${params.length}`,
      params,
    );
    const rows = result.rows;
    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last !== undefined
        ? {
            schemaVersion: '1.0.0' as const,
            occurredAt: last.occurred_at.toISOString(),
            domainKind: last.domain_kind as HistorySourceDomainKindV1,
            sourceEventKind: last.source_event_kind,
            sourceEventId: last.source_event_id,
            ...(last.source_sequence === null
              ? {}
              : { sourceSequence: Number(last.source_sequence) }),
          }
        : undefined;
    return {
      records: page.map(historyIndexRecordFrom),
      ...(nextCursor === undefined ? {} : { nextCursor }),
    };
  }

  async deleteProject(resourceProjectId: string): Promise<void> {
    await withHistoryProjectWriteLock(this.pool, resourceProjectId, async (client) => {
      await client.query(
        'DELETE FROM frontend_history.history_projection_index WHERE resource_project_id = $1',
        [resourceProjectId],
      );
    });
  }

  async deleteByProjectAndDomain(
    resourceProjectId: string,
    domainKind: HistorySourceDomainKindV1,
  ): Promise<void> {
    await withHistoryProjectWriteLock(this.pool, resourceProjectId, async (client) => {
      await client.query(
        'DELETE FROM frontend_history.history_projection_index WHERE resource_project_id = $1 AND domain_kind = $2',
        [resourceProjectId, domainKind],
      );
    });
  }

  async rebuildProject(input: {
    readonly resourceProjectId: string;
    readonly snapshotRevision: number;
    readonly domainKind?: HistorySourceDomainKindV1;
    readonly records: readonly HistoryIndexRecordV1[];
  }): Promise<void> {
    validateHistoryRebuildBatch(input);
    await withHistoryProjectWriteLock(this.pool, input.resourceProjectId, async (client) => {
      const existingWatermarks = await client.query<{ snapshot_revision: string }>(
        `SELECT snapshot_revision::text AS snapshot_revision
         FROM frontend_history.projection_watermarks
         WHERE resource_project_id = $1`,
        [input.resourceProjectId],
      );
      assertHistoryRebuildRevisionNotLower(
        existingWatermarks.rows.map((row) => ({
          snapshotRevision: Number(row.snapshot_revision),
        })),
        input.snapshotRevision,
        `${input.resourceProjectId}/${input.domainKind ?? 'ALL'}`,
      );
      await client.query(
        input.domainKind === undefined
          ? 'DELETE FROM frontend_history.history_projection_index WHERE resource_project_id = $1'
          : 'DELETE FROM frontend_history.history_projection_index WHERE resource_project_id = $1 AND domain_kind = $2',
        input.domainKind === undefined
          ? [input.resourceProjectId]
          : [input.resourceProjectId, input.domainKind],
      );
      for (const record of input.records) {
        await client.query(
          `INSERT INTO frontend_history.history_projection_index ${HISTORY_INDEX_COLUMNS}
           VALUES ${HISTORY_INDEX_VALUES}`,
          historyRecordToParams(record),
        );
      }
    });
  }
}

type HistoryWatermarkRow = QueryResultRow & {
  readonly projected_at: Date;
};

const historyWatermarkFrom = (row: HistoryWatermarkRow): HistoryWatermarkRecordV1 => ({
  resourceProjectId: row.resource_project_id,
  adapterId: row.adapter_id,
  domainKind: row.domain_kind as HistorySourceDomainKindV1,
  ...(row.source_updated_at === null || row.source_updated_at === undefined
    ? {}
    : { sourceUpdatedAt: (row.source_updated_at as Date).toISOString() }),
  projectedAt: row.projected_at.toISOString(),
  adapterStatus: row.adapter_status,
  snapshotRevision: Number(row.snapshot_revision),
  ...(row.last_source_position === null || row.last_source_position === undefined
    ? {}
    : { lastSourcePosition: row.last_source_position }),
});

export class PostgresHistoryWatermarkStore implements HistoryWatermarkStorePort {
  constructor(private readonly pool: Pool) {}

  async upsert(record: HistoryWatermarkRecordV1): Promise<void> {
    const result = await this.pool.query(
      `INSERT INTO frontend_history.projection_watermarks (
         resource_project_id, adapter_id, domain_kind, source_updated_at,
         projected_at, adapter_status, snapshot_revision, last_source_position
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (resource_project_id, adapter_id) DO UPDATE SET
         domain_kind = EXCLUDED.domain_kind,
         source_updated_at = EXCLUDED.source_updated_at,
         projected_at = EXCLUDED.projected_at,
         adapter_status = EXCLUDED.adapter_status,
         snapshot_revision = EXCLUDED.snapshot_revision,
         last_source_position = EXCLUDED.last_source_position
       WHERE frontend_history.projection_watermarks.snapshot_revision <= EXCLUDED.snapshot_revision`,
      [
        record.resourceProjectId,
        record.adapterId,
        record.domainKind,
        record.sourceUpdatedAt ?? null,
        record.projectedAt,
        record.adapterStatus,
        record.snapshotRevision,
        record.lastSourcePosition ?? null,
      ],
    );
    if ((result.rowCount ?? 0) === 0) {
      throw new Error(
        `HISTORY_WATERMARK_STALE_UPSERT: ${record.resourceProjectId}/${record.adapterId} has a newer snapshot revision than ${record.snapshotRevision}`,
      );
    }
  }

  async readByProject(resourceProjectId: string): Promise<readonly HistoryWatermarkRecordV1[]> {
    const result = await this.pool.query<HistoryWatermarkRow>(
      `SELECT * FROM frontend_history.projection_watermarks
       WHERE resource_project_id = $1
       ORDER BY adapter_id ASC`,
      [resourceProjectId],
    );
    return result.rows.map(historyWatermarkFrom);
  }

  async readByProjectAndAdapter(
    resourceProjectId: string,
    adapterId: string,
  ): Promise<HistoryWatermarkRecordV1 | undefined> {
    const result = await this.pool.query<HistoryWatermarkRow>(
      `SELECT * FROM frontend_history.projection_watermarks
       WHERE resource_project_id = $1 AND adapter_id = $2`,
      [resourceProjectId, adapterId],
    );
    return result.rows[0] ? historyWatermarkFrom(result.rows[0]) : undefined;
  }

  async deleteByProject(resourceProjectId: string): Promise<void> {
    await this.pool.query(
      'DELETE FROM frontend_history.projection_watermarks WHERE resource_project_id = $1',
      [resourceProjectId],
    );
  }
}

export const createPostgresHistoryReadModelStore = (pool: Pool): HistoryReadModelStorePort => {
  const index = new PostgresHistoryIndexStore(pool);
  const watermarks = new PostgresHistoryWatermarkStore(pool);
  return {
    index,
    watermarks,
    async commitProjectProjection(input) {
      validateHistoryRebuildBatch(input);
      for (const watermark of input.watermarks) {
        if (watermark.resourceProjectId !== input.resourceProjectId) {
          throw new Error(
            `HISTORY_WATERMARK_SCOPE: watermark ${watermark.adapterId} is bound to another project`,
          );
        }
        if (watermark.snapshotRevision !== input.snapshotRevision) {
          throw new Error(
            `HISTORY_WATERMARK_REVISION: watermark ${watermark.adapterId} snapshotRevision ${watermark.snapshotRevision} must equal commit revision ${input.snapshotRevision}`,
          );
        }
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
          input.resourceProjectId,
        ]);
        // Revision CAS lives on the WATERMARKS (migration 030 design): the
        // projection index has no snapshot_revision column, so a concurrent
        // build that already committed this revision — even with an empty
        // index — is rejected by the watermark revision guard.
        const existingWatermarks = await client.query<{ snapshot_revision: string }>(
          `SELECT snapshot_revision::text AS snapshot_revision
           FROM frontend_history.projection_watermarks
           WHERE resource_project_id = $1`,
          [input.resourceProjectId],
        );
        const existingWatermarkRevisions = existingWatermarks.rows.map((row) =>
          Number(row.snapshot_revision),
        );
        const committedMax = Math.max(...existingWatermarkRevisions, 0);
        if (committedMax >= input.snapshotRevision) {
          throw new Error(
            `HISTORY_INDEX_STALE_REBUILD: ${input.resourceProjectId}/ALL already has snapshot revision >= ${input.snapshotRevision}`,
          );
        }
        assertHistoryRebuildRevisionNotLower(
          existingWatermarkRevisions.map((snapshotRevision) => ({ snapshotRevision })),
          input.snapshotRevision,
          `${input.resourceProjectId}/ALL`,
        );
        await client.query(
          'DELETE FROM frontend_history.history_projection_index WHERE resource_project_id = $1',
          [input.resourceProjectId],
        );
        for (const record of input.records) {
          await client.query(
            `INSERT INTO frontend_history.history_projection_index ${HISTORY_INDEX_COLUMNS}
             VALUES ${HISTORY_INDEX_VALUES}`,
            historyRecordToParams(record),
          );
        }
        await client.query(
          'DELETE FROM frontend_history.projection_watermarks WHERE resource_project_id = $1',
          [input.resourceProjectId],
        );
        for (const watermark of input.watermarks) {
          await client.query(
            `INSERT INTO frontend_history.projection_watermarks (
               resource_project_id, adapter_id, domain_kind, source_updated_at,
               projected_at, adapter_status, snapshot_revision, last_source_position
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             ON CONFLICT (resource_project_id, adapter_id) DO UPDATE SET
               domain_kind = EXCLUDED.domain_kind,
               source_updated_at = EXCLUDED.source_updated_at,
               projected_at = EXCLUDED.projected_at,
               adapter_status = EXCLUDED.adapter_status,
               snapshot_revision = EXCLUDED.snapshot_revision,
               last_source_position = EXCLUDED.last_source_position
             WHERE frontend_history.projection_watermarks.snapshot_revision <= EXCLUDED.snapshot_revision`,
            [
              watermark.resourceProjectId,
              watermark.adapterId,
              watermark.domainKind,
              watermark.sourceUpdatedAt ?? null,
              watermark.projectedAt,
              watermark.adapterStatus,
              watermark.snapshotRevision,
              watermark.lastSourcePosition ?? null,
            ],
          );
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
};

// Re-exported predicate for parity/unit tests.
export { isHistoryRecordAfter };
