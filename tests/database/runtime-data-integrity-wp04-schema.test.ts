import { afterAll, describe, expect, it } from 'vitest';

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
          AND con.conname IN (
            'indexing_results_status_check',
            'evidence_stage4_continuations_evidence_count_check',
            'source_stage3_progress_state_check'
          )`,
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
});
