import type { Pool, PoolClient, QueryResultRow } from 'pg';

import type { ActivityDomainKindV1 } from '../../../packages/contracts/src/index.js';
import {
  assertRebuildRevisionNotLower,
  decodeActivityIndexCursor,
  encodeActivityIndexCursor,
  validateActivityIndexRecord,
  validateRebuildBatch,
  type ActivityIndexPageV1,
  type ActivityIndexQueryV1,
  type ActivityIndexRecordV1,
  type ActivityIndexStorePort,
  type ActivityReadModelStorePort,
  type ActivityWatermarkRecordV1,
  type ActivityWatermarkStorePort,
} from '../../../modules/frontend-activity/src/index.js';

/**
 * FE-P5-S1 Activity read-model PostgreSQL adapter (migration 029). Mirrors the
 * in-memory adapter's observable semantics exactly over the `frontend_activity`
 * schema. `snapshot` is a jsonb round-trip; scalar columns mirror key fields
 * for project-scoped lookups, stable ordering and revision guards.
 */

const JSONB_SNAPSHOT = (value: unknown): string => JSON.stringify(value);

/** node-postgres deserializes jsonb into objects; only strings need parsing. */
const PARSE = (value: unknown): unknown => {
  if (typeof value === 'string') return JSON.parse(value);
  return value;
};

type IndexRow = QueryResultRow & {
  readonly snapshot: string | unknown;
  readonly updated_at: Date;
  readonly projected_at: Date;
};

const indexRecordFrom = (row: IndexRow): ActivityIndexRecordV1 => ({
  resourceProjectId: row.resource_project_id,
  activityId: row.activity_id,
  domainKind: row.domain_kind,
  rootKind: row.root_kind,
  domainResourceKind: row.domain_resource_kind,
  domainResourceId: row.domain_resource_id,
  ...(row.domain_resource_revision === null || row.domain_resource_revision === undefined
    ? {}
    : { domainResourceRevision: row.domain_resource_revision }),
  resourceHref: row.resource_href,
  ...(row.job_id === null || row.job_id === undefined ? {} : { jobId: row.job_id }),
  runId: row.run_id,
  summary: row.summary,
  state: row.state,
  attention: row.attention,
  retryability: row.retryability,
  freshness: row.freshness,
  adapterStatus: row.adapter_status,
  snapshotRevision: Number(row.snapshot_revision),
  snapshot: PARSE(row.snapshot),
  projectedAt: row.projected_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

export class PostgresActivityIndexStore implements ActivityIndexStorePort {
  constructor(private readonly pool: Pool) {}

  private async withClient<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await action(client);
    } finally {
      client.release();
    }
  }

  /**
   * Serialize all Activity index writes for a Project with a PostgreSQL
   * advisory transaction lock. Both regular upserts and (full or per-domain)
   * rebuilds take this project-scoped lock, so a rebuild's DELETE → INSERT
   * window can never interleave with a concurrent upsert and end with a lower
   * snapshot revision winning (ADR-130 §6 / Contract Snapshot §9). A single
   * project-level lock key avoids deadlocks between full and per-domain
   * rebuilds.
   */
  private async withProjectWriteLock<T>(
    projectId: string,
    action: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    return this.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [projectId]);
        const result = await action(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }

  async upsert(record: ActivityIndexRecordV1): Promise<void> {
    validateActivityIndexRecord(record);
    await this.withProjectWriteLock(record.resourceProjectId, async (client) => {
      const result = await client.query(
        `INSERT INTO frontend_activity.activity_index (
           resource_project_id, activity_id, domain_kind, root_kind,
           domain_resource_kind, domain_resource_id, domain_resource_revision,
           resource_href, job_id, run_id, summary, state, attention, retryability,
           freshness, adapter_status, snapshot_revision, snapshot, projected_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         ON CONFLICT (resource_project_id, domain_kind, activity_id) DO UPDATE SET
           root_kind = EXCLUDED.root_kind,
           domain_resource_kind = EXCLUDED.domain_resource_kind,
           domain_resource_id = EXCLUDED.domain_resource_id,
           domain_resource_revision = EXCLUDED.domain_resource_revision,
           resource_href = EXCLUDED.resource_href,
           job_id = EXCLUDED.job_id,
           run_id = EXCLUDED.run_id,
           summary = EXCLUDED.summary,
           state = EXCLUDED.state,
           attention = EXCLUDED.attention,
           retryability = EXCLUDED.retryability,
           freshness = EXCLUDED.freshness,
           adapter_status = EXCLUDED.adapter_status,
           snapshot_revision = EXCLUDED.snapshot_revision,
           snapshot = EXCLUDED.snapshot,
           projected_at = EXCLUDED.projected_at,
           updated_at = EXCLUDED.updated_at
         WHERE frontend_activity.activity_index.snapshot_revision <= EXCLUDED.snapshot_revision`,
        [
          record.resourceProjectId,
          record.activityId,
          record.domainKind,
          record.rootKind,
          record.domainResourceKind,
          record.domainResourceId,
          record.domainResourceRevision ?? null,
          record.resourceHref,
          record.jobId ?? null,
          record.runId,
          record.summary,
          record.state,
          record.attention,
          record.retryability,
          record.freshness,
          record.adapterStatus,
          record.snapshotRevision,
          JSONB_SNAPSHOT(record.snapshot),
          record.projectedAt,
          record.updatedAt,
        ],
      );
      // A conflicting row with a newer snapshot revision is not updated
      // (rowCount 0) — a lower revision never replaces a newer one.
      if ((result.rowCount ?? 0) === 0) {
        throw new Error(
          `ACTIVITY_INDEX_STALE_UPSERT: ${record.resourceProjectId}/${record.domainKind}/${record.activityId} has a newer snapshot revision than ${record.snapshotRevision}`,
        );
      }
    });
  }

  async queryProject(input: ActivityIndexQueryV1): Promise<ActivityIndexPageV1> {
    const params: unknown[] = [input.resourceProjectId];
    const conditions = ['resource_project_id = $1'];
    if (input.domainKinds && input.domainKinds.length > 0) {
      params.push(input.domainKinds);
      conditions.push(`domain_kind = ANY($${params.length})`);
    }
    if (input.states && input.states.length > 0) {
      params.push(input.states);
      conditions.push(`state = ANY($${params.length})`);
    }
    if (input.attention !== undefined) {
      params.push(input.attention);
      conditions.push(`attention = $${params.length}`);
    }
    if (input.cursor !== undefined) {
      const cursor = decodeActivityIndexCursor(input.cursor);
      params.push(cursor.updatedAt, cursor.domainKind, cursor.activityId);
      // Keyset predicate matching ORDER BY updated_at DESC, domain_kind ASC,
      // activity_id ASC: rows after the cursor have a smaller updated_at, or
      // the same updated_at with a LARGER (domain_kind, activity_id) tie-break.
      const updatedParam = params.length - 2;
      const kindParam = params.length - 1;
      const idParam = params.length;
      conditions.push(
        `(updated_at < $${updatedParam}
          OR (updated_at = $${updatedParam} AND (domain_kind, activity_id) > ($${kindParam}, $${idParam})))`,
      );
    }
    params.push(Math.max(0, input.limit) + 1);
    const result = await this.pool.query<IndexRow>(
      `SELECT * FROM frontend_activity.activity_index
       WHERE ${conditions.join(' AND ')}
       ORDER BY updated_at DESC, domain_kind ASC, activity_id ASC
       LIMIT $${params.length}`,
      params,
    );
    const rows = result.rows;
    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last !== undefined
        ? encodeActivityIndexCursor({
            updatedAt: last.updated_at.toISOString(),
            domainKind: last.domain_kind as ActivityDomainKindV1,
            activityId: last.activity_id,
          })
        : undefined;
    return {
      records: page.map(indexRecordFrom),
      ...(nextCursor === undefined ? {} : { nextCursor }),
    };
  }

  async findByIdentity(input: {
    readonly resourceProjectId: string;
    readonly domainKind: ActivityDomainKindV1;
    readonly activityId: string;
  }): Promise<ActivityIndexRecordV1 | undefined> {
    const result = await this.pool.query<IndexRow>(
      `SELECT * FROM frontend_activity.activity_index
       WHERE resource_project_id = $1 AND domain_kind = $2 AND activity_id = $3`,
      [input.resourceProjectId, input.domainKind, input.activityId],
    );
    return result.rows[0] ? indexRecordFrom(result.rows[0]) : undefined;
  }

  async deleteProject(resourceProjectId: string): Promise<void> {
    await this.withProjectWriteLock(resourceProjectId, async (client) => {
      await client.query(
        'DELETE FROM frontend_activity.activity_index WHERE resource_project_id = $1',
        [resourceProjectId],
      );
    });
  }

  async deleteByProjectAndDomain(
    resourceProjectId: string,
    domainKind: ActivityDomainKindV1,
  ): Promise<void> {
    await this.withProjectWriteLock(resourceProjectId, async (client) => {
      await client.query(
        'DELETE FROM frontend_activity.activity_index WHERE resource_project_id = $1 AND domain_kind = $2',
        [resourceProjectId, domainKind],
      );
    });
  }

  async rebuildProject(input: {
    readonly resourceProjectId: string;
    readonly snapshotRevision: number;
    readonly domainKind?: ActivityDomainKindV1;
    readonly records: readonly ActivityIndexRecordV1[];
  }): Promise<void> {
    // Validate the whole batch BEFORE any delete or write.
    validateRebuildBatch(input);
    await this.withProjectWriteLock(input.resourceProjectId, async (client) => {
      const existing = await client.query<{ snapshot_revision: string }>(
        `SELECT snapshot_revision::text AS snapshot_revision
         FROM frontend_activity.activity_index
         WHERE resource_project_id = $1
           AND ($2::text IS NULL OR domain_kind = $2)`,
        [input.resourceProjectId, input.domainKind ?? null],
      );
      assertRebuildRevisionNotLower(
        existing.rows.map((row) => ({ snapshotRevision: Number(row.snapshot_revision) })),
        input.snapshotRevision,
        `${input.resourceProjectId}/${input.domainKind ?? 'ALL'}`,
      );
      await client.query(
        input.domainKind === undefined
          ? 'DELETE FROM frontend_activity.activity_index WHERE resource_project_id = $1'
          : 'DELETE FROM frontend_activity.activity_index WHERE resource_project_id = $1 AND domain_kind = $2',
        input.domainKind === undefined
          ? [input.resourceProjectId]
          : [input.resourceProjectId, input.domainKind],
      );
      for (const record of input.records) {
        await client.query(
          `INSERT INTO frontend_activity.activity_index (
             resource_project_id, activity_id, domain_kind, root_kind,
             domain_resource_kind, domain_resource_id, domain_resource_revision,
             resource_href, job_id, run_id, summary, state, attention, retryability,
             freshness, adapter_status, snapshot_revision, snapshot, projected_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
          [
            record.resourceProjectId,
            record.activityId,
            record.domainKind,
            record.rootKind,
            record.domainResourceKind,
            record.domainResourceId,
            record.domainResourceRevision ?? null,
            record.resourceHref,
            record.jobId ?? null,
            record.runId,
            record.summary,
            record.state,
            record.attention,
            record.retryability,
            record.freshness,
            record.adapterStatus,
            record.snapshotRevision,
            JSONB_SNAPSHOT(record.snapshot),
            record.projectedAt,
            record.updatedAt,
          ],
        );
      }
    });
  }
}

type WatermarkRow = QueryResultRow & {
  readonly projected_at: Date;
  readonly updated_at: Date;
};

const watermarkFrom = (row: WatermarkRow): ActivityWatermarkRecordV1 => ({
  resourceProjectId: row.resource_project_id,
  adapterId: row.adapter_id,
  domainKind: row.domain_kind,
  ...(row.source_updated_at === null || row.source_updated_at === undefined
    ? {}
    : { sourceUpdatedAt: (row.source_updated_at as Date).toISOString() }),
  projectedAt: row.projected_at.toISOString(),
  ...(row.lag_milliseconds === null || row.lag_milliseconds === undefined
    ? {}
    : { lagMilliseconds: Number(row.lag_milliseconds) }),
  adapterStatus: row.adapter_status,
  snapshotRevision: Number(row.snapshot_revision),
  ...(row.cursor === null || row.cursor === undefined ? {} : { cursor: row.cursor }),
  updatedAt: row.updated_at.toISOString(),
});

export class PostgresActivityWatermarkStore implements ActivityWatermarkStorePort {
  constructor(private readonly pool: Pool) {}

  async upsert(record: ActivityWatermarkRecordV1): Promise<void> {
    const result = await this.pool.query(
      `INSERT INTO frontend_activity.projection_watermarks (
         resource_project_id, adapter_id, domain_kind, source_updated_at,
         projected_at, lag_milliseconds, adapter_status, snapshot_revision,
         cursor, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (resource_project_id, adapter_id) DO UPDATE SET
         domain_kind = EXCLUDED.domain_kind,
         source_updated_at = EXCLUDED.source_updated_at,
         projected_at = EXCLUDED.projected_at,
         lag_milliseconds = EXCLUDED.lag_milliseconds,
         adapter_status = EXCLUDED.adapter_status,
         snapshot_revision = EXCLUDED.snapshot_revision,
         cursor = EXCLUDED.cursor,
         updated_at = EXCLUDED.updated_at
       WHERE frontend_activity.projection_watermarks.snapshot_revision <= EXCLUDED.snapshot_revision`,
      [
        record.resourceProjectId,
        record.adapterId,
        record.domainKind,
        record.sourceUpdatedAt ?? null,
        record.projectedAt,
        record.lagMilliseconds ?? null,
        record.adapterStatus,
        record.snapshotRevision,
        record.cursor ?? null,
        record.updatedAt,
      ],
    );
    // A conflicting row with a newer snapshot revision is not updated.
    if ((result.rowCount ?? 0) === 0) {
      throw new Error(
        `ACTIVITY_WATERMARK_STALE_UPSERT: ${record.resourceProjectId}/${record.adapterId} has a newer snapshot revision than ${record.snapshotRevision}`,
      );
    }
  }

  async readByProject(resourceProjectId: string): Promise<readonly ActivityWatermarkRecordV1[]> {
    const result = await this.pool.query<WatermarkRow>(
      `SELECT * FROM frontend_activity.projection_watermarks
       WHERE resource_project_id = $1
       ORDER BY adapter_id ASC`,
      [resourceProjectId],
    );
    return result.rows.map(watermarkFrom);
  }

  async readByProjectAndAdapter(
    resourceProjectId: string,
    adapterId: string,
  ): Promise<ActivityWatermarkRecordV1 | undefined> {
    const result = await this.pool.query<WatermarkRow>(
      `SELECT * FROM frontend_activity.projection_watermarks
       WHERE resource_project_id = $1 AND adapter_id = $2`,
      [resourceProjectId, adapterId],
    );
    return result.rows[0] ? watermarkFrom(result.rows[0]) : undefined;
  }

  async deleteByProject(resourceProjectId: string): Promise<void> {
    await this.pool.query(
      'DELETE FROM frontend_activity.projection_watermarks WHERE resource_project_id = $1',
      [resourceProjectId],
    );
  }
}

export const createPostgresActivityReadModelStore = (pool: Pool): ActivityReadModelStorePort => {
  const index = new PostgresActivityIndexStore(pool);
  const watermarks = new PostgresActivityWatermarkStore(pool);
  return {
    index,
    watermarks,
    async commitProjectProjection(input) {
      // Atomic full-project commit in ONE transaction under the project-scoped
      // advisory lock: revision CAS check, index replace and every watermark
      // upsert publish together or not at all. A concurrent refresh either
      // serializes behind the lock (and then fails the revision guard) or is
      // fully visible after commit — the index and watermarks never diverge.
      validateRebuildBatch({
        resourceProjectId: input.resourceProjectId,
        snapshotRevision: input.snapshotRevision,
        records: input.records,
      });
      for (const watermark of input.watermarks) {
        if (watermark.resourceProjectId !== input.resourceProjectId) {
          throw new Error(
            `ACTIVITY_WATERMARK_SCOPE: watermark ${watermark.adapterId} is bound to another project`,
          );
        }
        if (watermark.snapshotRevision !== input.snapshotRevision) {
          throw new Error(
            `ACTIVITY_WATERMARK_REVISION: watermark ${watermark.adapterId} snapshotRevision ${watermark.snapshotRevision} must equal commit revision ${input.snapshotRevision}`,
          );
        }
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
          input.resourceProjectId,
        ]);
        const existing = await client.query<{ snapshot_revision: string }>(
          `SELECT snapshot_revision::text AS snapshot_revision
           FROM frontend_activity.activity_index
           WHERE resource_project_id = $1`,
          [input.resourceProjectId],
        );
        const existingRevisions = existing.rows.map((row) => Number(row.snapshot_revision));
        assertRebuildRevisionNotLower(
          existingRevisions.map((snapshotRevision) => ({ snapshotRevision })),
          input.snapshotRevision,
          `${input.resourceProjectId}/ALL`,
        );
        if (existingRevisions.some((revision) => revision >= input.snapshotRevision)) {
          throw new Error(
            `ACTIVITY_INDEX_STALE_REBUILD: ${input.resourceProjectId}/ALL already has snapshot revision >= ${input.snapshotRevision}`,
          );
        }
        await client.query(
          'DELETE FROM frontend_activity.activity_index WHERE resource_project_id = $1',
          [input.resourceProjectId],
        );
        for (const record of input.records) {
          await client.query(
            `INSERT INTO frontend_activity.activity_index (
               resource_project_id, activity_id, domain_kind, root_kind,
               domain_resource_kind, domain_resource_id, domain_resource_revision,
               resource_href, job_id, run_id, summary, state, attention, retryability,
               freshness, adapter_status, snapshot_revision, snapshot, projected_at, updated_at
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
            [
              record.resourceProjectId,
              record.activityId,
              record.domainKind,
              record.rootKind,
              record.domainResourceKind,
              record.domainResourceId,
              record.domainResourceRevision ?? null,
              record.resourceHref,
              record.jobId ?? null,
              record.runId,
              record.summary,
              record.state,
              record.attention,
              record.retryability,
              record.freshness,
              record.adapterStatus,
              record.snapshotRevision,
              JSONB_SNAPSHOT(record.snapshot),
              record.projectedAt,
              record.updatedAt,
            ],
          );
        }
        for (const watermark of input.watermarks) {
          await client.query(
            `INSERT INTO frontend_activity.projection_watermarks (
               resource_project_id, adapter_id, domain_kind, source_updated_at,
               projected_at, lag_milliseconds, adapter_status, snapshot_revision,
               cursor, updated_at
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT (resource_project_id, adapter_id) DO UPDATE SET
               domain_kind = EXCLUDED.domain_kind,
               source_updated_at = EXCLUDED.source_updated_at,
               projected_at = EXCLUDED.projected_at,
               lag_milliseconds = EXCLUDED.lag_milliseconds,
               adapter_status = EXCLUDED.adapter_status,
               snapshot_revision = EXCLUDED.snapshot_revision,
               cursor = EXCLUDED.cursor,
               updated_at = EXCLUDED.updated_at
             WHERE frontend_activity.projection_watermarks.snapshot_revision <= EXCLUDED.snapshot_revision`,
            [
              watermark.resourceProjectId,
              watermark.adapterId,
              watermark.domainKind,
              watermark.sourceUpdatedAt ?? null,
              watermark.projectedAt,
              watermark.lagMilliseconds ?? null,
              watermark.adapterStatus,
              watermark.snapshotRevision,
              watermark.cursor ?? null,
              watermark.updatedAt,
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
