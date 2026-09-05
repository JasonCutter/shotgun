import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { PostgresSourcesStage3ProgressRepository } from '../../adapters/postgres-stage3/src/runtime-data-integrity.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { STAGE3_RUNTIME_CONTRACT_ERROR_CODE } from '../../modules/frontend-sources-write/src/index.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

afterAll(async () => {
  await pool?.end();
});

const seedMaterialized = async (prefix: string) => {
  const projectId = `${prefix}-${randomUUID()}`;
  const sourceId = randomUUID();
  const sourceVersionId = randomUUID();
  const assetId = randomUUID();
  const now = '2026-09-05T20:00:00.000Z';
  const digest = `sha256:${'b'.repeat(64)}`;
  await pool!.query(
    `INSERT INTO asset.original_assets
       (asset_id, content_hash, size_bytes, storage_key, created_at)
     VALUES ($1, $2, 1, $3, $4)`,
    [assetId, digest, `${prefix}/${assetId}`, now],
  );
  await pool!.query(
    `INSERT INTO asset.sources (source_id, project_id, created_by_actor_id, created_at)
     VALUES ($1, $2, $3, $4)`,
    [sourceId, projectId, `${prefix}-test`, now],
  );
  await pool!.query(
    `INSERT INTO asset.source_versions (
       source_version_id, source_id, version_number, original_asset_id,
       media_type, access_scope, sensitivity, created_at
     ) VALUES ($1, $2, 1, $3, 'text/plain', '{owner}', 'public', $4)`,
    [sourceVersionId, sourceId, assetId, now],
  );
  await pool!.query(
    `INSERT INTO source_product.source_stage3_progress
       (project_id, source_id, source_version_id, state, created_at, updated_at)
     VALUES ($1, $2, $3, 'MATERIALIZED', $4, $4)`,
    [projectId, sourceId, sourceVersionId, now],
  );
  return { projectId, sourceId, sourceVersionId, assetId };
};

const cleanup = async (ids: Awaited<ReturnType<typeof seedMaterialized>>) => {
  await pool!.query('DELETE FROM source_product.source_stage3_progress WHERE project_id = $1', [
    ids.projectId,
  ]);
  await pool!.query('DELETE FROM asset.source_versions WHERE source_version_id = $1', [
    ids.sourceVersionId,
  ]);
  await pool!.query('DELETE FROM asset.sources WHERE source_id = $1', [ids.sourceId]);
  await pool!.query('DELETE FROM asset.original_assets WHERE asset_id = $1', [ids.assetId]);
};

describe.runIf(pool)('WP-05 Stage 3 durable recovery semantics', () => {
  it('T03/T04 allows exactly one concurrent claim and defers an active lease', async () => {
    const ids = await seedMaterialized('wp05-concurrency');
    try {
      const repository = new PostgresSourcesStage3ProgressRepository(pool!);
      const claims = await Promise.all([
        repository.claim({
          ...ids,
          workerId: 'wp05-worker-a',
          leaseDurationMs: 30_000,
          now: '2026-09-05T20:00:00.000Z',
        }),
        repository.claim({
          ...ids,
          workerId: 'wp05-worker-b',
          leaseDurationMs: 30_000,
          now: '2026-09-05T20:00:00.000Z',
        }),
      ]);
      expect(claims.filter((claim) => claim.status === 'CLAIMED')).toHaveLength(1);
      expect(claims.filter((claim) => claim.status === 'DEFERRED')).toEqual([
        { status: 'DEFERRED', reason: 'ACTIVE_LEASE' },
      ]);
    } finally {
      await cleanup(ids);
    }
  });

  it('T06/T08 persists post-claim retry state with bounded future backoff', async () => {
    const ids = await seedMaterialized('wp05-retry');
    try {
      const repository = new PostgresSourcesStage3ProgressRepository(pool!);
      const claim = await repository.claim({
        ...ids,
        workerId: 'wp05-retry-worker',
        leaseDurationMs: 30_000,
        now: '2026-09-05T20:00:00.000Z',
      });
      expect(claim.status).toBe('CLAIMED');
      if (claim.status !== 'CLAIMED') return;
      await repository.markFailure({
        lease: claim.lease,
        retryable: true,
        code: 'STAGE3_DB_TRANSIENT',
        message: 'serialization failure',
      });
      const row = await pool!.query<{
        state: string;
        attempt_count: number;
        next_attempt_at: Date | null;
        safe_failure_code: string | null;
      }>(
        `SELECT state, attempt_count, next_attempt_at, safe_failure_code
           FROM source_product.source_stage3_progress
          WHERE project_id = $1 AND source_version_id = $2`,
        [ids.projectId, ids.sourceVersionId],
      );
      expect(row.rows[0]?.state).toBe('STAGE3_RETRYABLE');
      expect(row.rows[0]?.attempt_count).toBe(1);
      expect(row.rows[0]?.next_attempt_at?.getTime()).toBeGreaterThan(
        Date.parse('2026-09-05T20:00:00Z'),
      );
      expect(row.rows[0]?.safe_failure_code).toBe('STAGE3_DB_TRANSIENT');
    } finally {
      await cleanup(ids);
    }
  });

  it('T07 records a pre-claim contract failure as blocked and excludes it from automatic recovery', async () => {
    const ids = await seedMaterialized('wp05-blocked');
    try {
      const repository = new PostgresSourcesStage3ProgressRepository(pool!);
      await repository.recordPreClaimFailure({
        ...ids,
        retryable: false,
        code: STAGE3_RUNTIME_CONTRACT_ERROR_CODE,
        message: 'PostgreSQL parameter contract is invalid.',
      });
      const row = await pool!.query<{
        state: string;
        attempt_count: number;
        next_attempt_at: Date | null;
        safe_failure_code: string | null;
      }>(
        `SELECT state, attempt_count, next_attempt_at, safe_failure_code
           FROM source_product.source_stage3_progress
          WHERE project_id = $1 AND source_version_id = $2`,
        [ids.projectId, ids.sourceVersionId],
      );
      expect(row.rows[0]).toMatchObject({
        state: 'RECONCILIATION_REQUIRED',
        attempt_count: 1,
        next_attempt_at: null,
        safe_failure_code: STAGE3_RUNTIME_CONTRACT_ERROR_CODE,
      });
      const recoverable = await repository.findRecoverable({ limit: 100 });
      expect(recoverable.some((item) => item.sourceVersionId === ids.sourceVersionId)).toBe(false);
    } finally {
      await cleanup(ids);
    }
  });

  it('T05 recovers an expired lease with a new fence and rejects the stale lease update', async () => {
    const ids = await seedMaterialized('wp05-fence');
    try {
      const repository = new PostgresSourcesStage3ProgressRepository(pool!);
      const first = await repository.claim({
        ...ids,
        workerId: 'wp05-fence-old',
        leaseDurationMs: 1_000,
        now: '2026-09-05T20:00:00.000Z',
      });
      expect(first.status).toBe('CLAIMED');
      if (first.status !== 'CLAIMED') return;
      const second = await repository.claim({
        ...ids,
        workerId: 'wp05-fence-new',
        leaseDurationMs: 30_000,
        now: '2026-09-05T20:00:02.000Z',
      });
      expect(second.status).toBe('CLAIMED');
      if (second.status !== 'CLAIMED') return;
      expect(second.lease.fencingToken).toBeGreaterThan(first.lease.fencingToken);
      await expect(
        repository.markFailure({
          lease: first.lease,
          retryable: true,
          code: 'STALE_WORKER',
          message: 'old worker must not update the row',
        }),
      ).rejects.toThrow('lost its lease');
    } finally {
      await cleanup(ids);
    }
  });
});
