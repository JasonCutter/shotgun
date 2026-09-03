import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { PostgresSourcesStage4ContinuationStore } from '../../adapters/postgres-stage3/src/runtime-data-integrity.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

afterAll(async () => {
  await pool?.end();
});

describe.runIf(pool)('WP-04 runtime data-integrity schema', () => {
  it('creates the three additive authorities and their semantic uniqueness keys', async () => {
    const relations = await pool!.query<{ name: string; relation: string | null }>(
      `SELECT name, to_regclass(name)::text AS relation
         FROM unnest($1::text[]) AS required(name)`,
      [
        [
          'evidence.indexing_results',
          'evidence.stage4_continuations',
          'source_product.source_stage3_progress',
        ],
      ],
    );
    expect(relations.rows.every((row) => row.name === row.relation)).toBe(true);

    const constraints = await pool!.query<{ conname: string }>(
      `SELECT conname
         FROM pg_constraint
        WHERE conname IN (
          'evidence_indexing_results_source_fk',
          'evidence_indexing_results_version_fk',
          'evidence_indexing_results_revision_fk',
          'evidence_stage4_continuation_result_fk',
          'source_stage3_progress_result_fk'
        )`,
    );
    expect(new Set(constraints.rows.map((row) => row.conname))).toEqual(
      new Set([
        'evidence_indexing_results_source_fk',
        'evidence_indexing_results_version_fk',
        'evidence_indexing_results_revision_fk',
        'evidence_stage4_continuation_result_fk',
        'source_stage3_progress_result_fk',
      ]),
    );

    const uniqueKeys = await pool!.query<{ indexdef: string }>(
      `SELECT indexdef
         FROM pg_indexes
        WHERE schemaname = 'evidence'
          AND tablename IN ('indexing_results', 'stage4_continuations')
          AND indexdef ILIKE '%UNIQUE%'`,
    );
    expect(
      uniqueKeys.rows.some((row) =>
        row.indexdef.includes('project_id, source_version_id, revision_id'),
      ),
    ).toBe(true);
    expect(
      uniqueKeys.rows.some((row) => row.indexdef.includes('project_id, continuation_key')),
    ).toBe(true);
  });

  it('keeps NO_EVIDENCE and Stage 4 continuation cardinality mutually exclusive', async () => {
    const checks = await pool!.query<{ table_name: string; definition: string }>(
      `SELECT cls.relname AS table_name, pg_get_constraintdef(con.oid) AS definition
        FROM pg_constraint AS con
         JOIN pg_class AS cls ON cls.oid = con.conrelid
         JOIN pg_namespace AS ns ON ns.oid = cls.relnamespace
        WHERE ns.nspname IN ('evidence', 'source_product')
          AND cls.relname IN ('indexing_results', 'stage4_continuations', 'source_stage3_progress')
          AND con.contype = 'c'`,
    );
    expect(
      checks.rows.some(
        (row) => row.table_name === 'indexing_results' && row.definition.includes('NO_EVIDENCE'),
      ),
    ).toBe(true);
    expect(
      checks.rows.some(
        (row) => row.table_name === 'stage4_continuations' && row.definition.includes('> 0'),
      ),
    ).toBe(true);
  });

  it('moves an expired Stage 4 lease to OUTCOME_UNKNOWN before any reclaim', async () => {
    const projectId = `wp04-expiry-${randomUUID()}`;
    const sourceId = randomUUID();
    const sourceVersionId = randomUUID();
    const assetId = randomUUID();
    const revisionId = randomUUID();
    const indexingResultId = randomUUID();
    const continuationId = randomUUID();
    const now = new Date();
    const acquiredAt = new Date(now.getTime() - 120_000);
    const expiredAt = new Date(now.getTime() - 60_000);
    const digest = `sha256:${'a'.repeat(64)}`;
    try {
      await pool!.query(
        `INSERT INTO asset.original_assets
           (asset_id, content_hash, size_bytes, storage_key, created_at)
         VALUES ($1, $2, 1, $3, $4)`,
        [assetId, digest, `wp04-expiry/${assetId}`, acquiredAt],
      );
      await pool!.query(
        `INSERT INTO asset.sources
           (source_id, project_id, created_by_actor_id, created_at)
         VALUES ($1, $2, 'wp04-test', $3)`,
        [sourceId, projectId, acquiredAt],
      );
      await pool!.query(
        `INSERT INTO asset.source_versions
           (source_version_id, source_id, version_number, original_asset_id,
            media_type, access_scope, sensitivity, created_at)
         VALUES ($1, $2, 1, $3, 'text/plain', '{owner}', 'public', $4)`,
        [sourceVersionId, sourceId, assetId, acquiredAt],
      );
      await pool!.query(
        `INSERT INTO transformation.revisions
           (revision_id, project_id, source_id, source_version_id, source_content_hash,
            transformer_id, transformer_version, document_ir, source_map,
            document_hash, source_map_hash, access_scope, sensitivity, created_at)
         VALUES ($1, $2, $3, $4, $5, 'wp04-test', '1', '{}'::jsonb, '{}'::jsonb,
                 $5, $5, '{owner}', 'public', $6)`,
        [revisionId, projectId, sourceId, sourceVersionId, digest, acquiredAt],
      );
      await pool!.query(
        `INSERT INTO evidence.indexing_results
           (indexing_result_id, project_id, source_id, source_version_id, revision_id,
            transformer_id, transformer_version, status, evidence_count, reused_count,
            evidence_set_digest, contract_version, security_scope_digest, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'wp04-test', '1', 'INDEXED', 1, 0,
                 $6, 'stage3-evidence-index.v1', $6, $7, $7)`,
        [indexingResultId, projectId, sourceId, sourceVersionId, revisionId, digest, acquiredAt],
      );
      await pool!.query(
        `INSERT INTO evidence.stage4_continuations
           (continuation_id, project_id, source_id, source_version_id, revision_id,
            indexing_result_id, continuation_key, evidence_snapshot, evidence_set_digest,
            evidence_count, access_scope, sensitivity, data_classification, state,
            attempt_count, lease_owner, lease_token, lease_acquired_at, lease_expires_at,
            fencing_token, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'wp04-expiry', '[]'::jsonb, $7,
                 1, '{owner}', 'public', 'source-content', 'RUNNING', 1,
                 'worker-1', 'lease-1', $8, $9, 1, $10, $10)`,
        [
          continuationId,
          projectId,
          sourceId,
          sourceVersionId,
          revisionId,
          indexingResultId,
          digest,
          acquiredAt,
          expiredAt,
          acquiredAt,
        ],
      );

      const store = new PostgresSourcesStage4ContinuationStore(pool!);
      await expect(
        store.claimNext({ workerId: 'worker-2', leaseDurationMs: 30_000, now: now.toISOString() }),
      ).resolves.toEqual({ status: 'EMPTY' });
      await expect(store.recoverExpired({ now: now.toISOString() })).resolves.toBe(1);

      const result = await pool!.query<{
        state: string;
        completed_at: Date | null;
        safe_failure_code: string | null;
      }>(
        `SELECT state, completed_at, safe_failure_code
           FROM evidence.stage4_continuations
          WHERE continuation_id = $1`,
        [continuationId],
      );
      expect(result.rows[0]).toMatchObject({
        state: 'OUTCOME_UNKNOWN',
        safe_failure_code: 'LEASE_EXPIRED',
      });
      expect(result.rows[0]?.completed_at).not.toBeNull();
    } finally {
      await pool!.query('DELETE FROM evidence.stage4_continuations WHERE continuation_id = $1', [
        continuationId,
      ]);
      await pool!.query('DELETE FROM evidence.indexing_results WHERE indexing_result_id = $1', [
        indexingResultId,
      ]);
      await pool!.query('DELETE FROM transformation.revisions WHERE revision_id = $1', [
        revisionId,
      ]);
      await pool!.query('DELETE FROM asset.source_versions WHERE source_version_id = $1', [
        sourceVersionId,
      ]);
      await pool!.query('DELETE FROM asset.sources WHERE source_id = $1', [sourceId]);
      await pool!.query('DELETE FROM asset.original_assets WHERE asset_id = $1', [assetId]);
    }
  });
});
