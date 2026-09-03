import 'dotenv/config';

import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

import { createPostgresPool } from '../adapters/postgres/src/index.js';
import { sha256Text, stableJson } from '../packages/contracts/src/index.js';
import { HISTORICAL_RECONCILIATION_REQUIRED_CODE } from '../modules/frontend-sources-write/src/index.js';

type BackfillOptions = {
  readonly write: boolean;
};

export type RuntimeDataIntegrityWp04BackfillReport = {
  readonly indexingCandidates: number;
  readonly indexingInserted: number;
  readonly progressCandidates: number;
  readonly progressInserted: number;
};

/**
 * Deterministically records historical Evidence that already exists.  The
 * absence of spans is deliberately not converted to NO_EVIDENCE: those rows
 * remain reconciliation-required until an authoritative Stage 3 result exists.
 * The function never inserts Stage 4 continuations and never calls a provider.
 */
export const backfillRuntimeDataIntegrityWp04 = async (
  pool: Pool,
  options: BackfillOptions,
): Promise<RuntimeDataIntegrityWp04BackfillReport> => {
  const indexing = await pool.query<{
    project_id: string;
    source_id: string;
    source_version_id: string;
    revision_id: string;
    transformer_id: string;
    transformer_version: string;
    access_scope: string[];
    sensitivity: 'public' | 'internal' | 'private' | 'restricted';
    created_at: Date;
    evidence_ids: string[];
    evidence_count: string;
  }>(
    `SELECT revision.project_id, revision.source_id::text, revision.source_version_id::text,
            revision.revision_id::text, revision.transformer_id, revision.transformer_version,
            revision.access_scope, revision.sensitivity, revision.created_at,
            array_agg(span.evidence_id::text ORDER BY span.pointer) AS evidence_ids,
            count(span.evidence_id)::text AS evidence_count
       FROM transformation.revisions AS revision
       JOIN evidence.spans AS span ON span.revision_id = revision.revision_id
      GROUP BY revision.project_id, revision.source_id, revision.source_version_id,
               revision.revision_id, revision.transformer_id, revision.transformer_version,
               revision.access_scope, revision.sensitivity, revision.created_at
      ORDER BY revision.project_id, revision.source_version_id, revision.revision_id`,
  );

  let indexingInserted = 0;
  if (options.write) {
    await pool.query('BEGIN');
    try {
      for (const row of indexing.rows) {
        const evidenceCount = Number(row.evidence_count);
        const evidenceSetDigest = sha256Text(stableJson(row.evidence_ids));
        const securityScopeDigest = sha256Text(
          stableJson({ accessScope: row.access_scope, sensitivity: row.sensitivity }),
        );
        const result = await pool.query(
          `INSERT INTO evidence.indexing_results (
             indexing_result_id, project_id, source_id, source_version_id, revision_id,
             transformer_id, transformer_version, status, evidence_count, reused_count,
             evidence_set_digest, contract_version, security_scope_digest, created_at, updated_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, 'INDEXED', $8, $8,
             $9, 'stage3-evidence-index.v1', $10, $11, $11
           )
           ON CONFLICT (project_id, source_version_id, revision_id, transformer_id, transformer_version)
           DO NOTHING`,
          [
            randomUUID(),
            row.project_id,
            row.source_id,
            row.source_version_id,
            row.revision_id,
            row.transformer_id,
            row.transformer_version,
            evidenceCount,
            evidenceSetDigest,
            securityScopeDigest,
            row.created_at,
          ],
        );
        indexingInserted += result.rowCount ?? 0;
      }
      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }

  const progress = await pool.query<{
    project_id: string;
    source_id: string;
    source_version_id: string;
    result_count: string;
    indexing_result_id: string | null;
  }>(
    `SELECT item.project_id, item.produced_source_id::text AS source_id,
            item.produced_source_version_id::text AS source_version_id,
            count(result.indexing_result_id)::text AS result_count,
            CASE WHEN count(result.indexing_result_id) = 1
                 THEN min(result.indexing_result_id)::text END AS indexing_result_id
       FROM source_product.intake_submission_items AS item
       LEFT JOIN evidence.indexing_results AS result
         ON result.project_id = item.project_id
        AND result.source_id = item.produced_source_id
        AND result.source_version_id = item.produced_source_version_id
      WHERE item.produced_source_id IS NOT NULL
        AND item.produced_source_version_id IS NOT NULL
      GROUP BY item.project_id, item.produced_source_id, item.produced_source_version_id
      ORDER BY item.project_id, item.produced_source_version_id`,
  );

  let progressInserted = 0;
  if (options.write) {
    await pool.query('BEGIN');
    try {
      for (const row of progress.rows) {
        const resultCount = Number(row.result_count);
        const state = resultCount === 1 ? 'STAGE3_COMPLETED' : 'RECONCILIATION_REQUIRED';
        const result = await pool.query(
          `INSERT INTO source_product.source_stage3_progress (
             project_id, source_id, source_version_id, state, indexing_result_id,
             safe_failure_code, safe_failure_message, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
           ON CONFLICT (project_id, source_version_id) DO NOTHING`,
          [
            row.project_id,
            row.source_id,
            row.source_version_id,
            state,
            row.indexing_result_id,
            state === 'RECONCILIATION_REQUIRED' ? HISTORICAL_RECONCILIATION_REQUIRED_CODE : null,
            state === 'RECONCILIATION_REQUIRED'
              ? 'Historical Stage 3 outcome requires explicit reconciliation.'
              : null,
          ],
        );
        progressInserted += result.rowCount ?? 0;
      }
      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }

  return {
    indexingCandidates: indexing.rowCount ?? indexing.rows.length,
    indexingInserted,
    progressCandidates: progress.rowCount ?? progress.rows.length,
    progressInserted,
  };
};

const main = async (): Promise<void> => {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  const write = process.argv.includes('--write');
  const pool = createPostgresPool(databaseUrl);
  try {
    const report = await backfillRuntimeDataIntegrityWp04(pool, { write });
    console.log(JSON.stringify({ mode: write ? 'write' : 'dry-run', ...report }, null, 2));
  } finally {
    await pool.end();
  }
};

if (process.argv[1]?.endsWith('runtime-data-integrity-wp04-backfill.ts')) {
  await main();
}
