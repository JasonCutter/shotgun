import { readFile } from 'node:fs/promises';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { managedSchemas } from '../../scripts/database.js';
import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';
import {
  parseT3ExpectedContentColumns,
  parseT3ExpectedTables,
} from '../../scripts/t3-storage-inventory.js';
import { KNOWLEDGE_RESET_OWNER_ORDER } from '../../modules/source-knowledge-reset/src/execution.js';

let database: Awaited<ReturnType<typeof createIsolatedPostgresTestDatabase>>;
let pool: Pool;

describe('T3 storage classification coverage', () => {
  beforeAll(async () => {
    database = await createIsolatedPostgresTestDatabase();
    pool = database.createPool();
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('matches every application table and registered schema against the owner register', async () => {
    const register = await readFile(
      'docs/implementation/t3-storage-classification-register.md',
      'utf8',
    );
    const expected = parseT3ExpectedTables(register);
    expect(expected.schemas).toEqual([...managedSchemas].sort());
    expect(expected.tables).toHaveLength(195);

    const actual = await pool.query<{ schema_name: string; table_name: string }>(
      `SELECT table_schema AS schema_name, table_name
       FROM information_schema.tables
       WHERE table_type = 'BASE TABLE' AND table_schema = ANY($1::text[])
       ORDER BY table_schema, table_name`,
      [[...managedSchemas]],
    );
    expect(actual.rows.map((row) => `${row.schema_name}.${row.table_name}`)).toEqual(
      expected.tables,
    );
  });

  it('matches every JSON, JSONB, and bytea column against the exact inventory', async () => {
    const inventory = await readFile('docs/implementation/t3-content-column-inventory.tsv', 'utf8');
    const expected = parseT3ExpectedContentColumns(inventory);
    expect(expected).toHaveLength(167);

    const actual = await pool.query<{ qualified_column: string; postgres_type: string }>(
      `SELECT c.table_schema || '.' || c.table_name || '.' || c.column_name AS qualified_column,
              format_type(a.atttypid, a.atttypmod) AS postgres_type
       FROM information_schema.columns AS c
       JOIN pg_namespace AS n ON n.nspname = c.table_schema
       JOIN pg_class AS t ON t.relnamespace = n.oid AND t.relname = c.table_name
       JOIN pg_attribute AS a ON a.attrelid = t.oid AND a.attname = c.column_name
       WHERE c.table_schema = ANY($1::text[])
         AND c.data_type IN ('json', 'jsonb', 'bytea')
         AND a.attnum > 0 AND NOT a.attisdropped
       ORDER BY qualified_column`,
      [[...managedSchemas]],
    );
    expect(actual.rows.map((row) => `${row.qualified_column}\t${row.postgres_type}`)).toEqual(
      expected,
    );
  });

  it('orders source cleanup owners against the installed RESTRICT foreign keys', async () => {
    const constraints = await pool.query<{
      child: string;
      parent: string;
      delete_action: string;
    }>(
      `SELECT conrelid::regclass::text AS child,
              confrelid::regclass::text AS parent,
              confdeltype::text AS delete_action
         FROM pg_constraint
        WHERE contype = 'f'
          AND (conname = ANY($1::text[]))
        ORDER BY conname`,
      [
        [
          'source_stage3_progress_result_fk',
          'intake_submission_items_project_id_stage2_submission_id_fkey',
          'spans_revision_id_fkey',
          'canonical_relation_precursor_resource_fk',
        ],
      ],
    );
    expect(constraints.rows).toEqual(
      expect.arrayContaining([
        {
          child: 'source_product.source_stage3_progress',
          parent: 'evidence.indexing_results',
          delete_action: 'r',
        },
        {
          child: 'source_product.intake_submission_items',
          parent: 'intake.submissions',
          delete_action: 'r',
        },
        {
          child: 'evidence.spans',
          parent: 'transformation.revisions',
          delete_action: 'a',
        },
        {
          child: 'canonical.relation_precursors',
          parent: 'discovery.reentry_review_resources',
          delete_action: 'r',
        },
      ]),
    );

    const ownerIndex = (owner: (typeof KNOWLEDGE_RESET_OWNER_ORDER)[number]): number =>
      KNOWLEDGE_RESET_OWNER_ORDER.indexOf(owner);
    expect(ownerIndex('source-product')).toBeLessThan(ownerIndex('intake'));
    expect(ownerIndex('source-product')).toBeLessThan(ownerIndex('evidence'));
    expect(ownerIndex('intake')).toBeLessThan(ownerIndex('asset'));
    expect(ownerIndex('evidence')).toBeLessThan(ownerIndex('transformation'));
    expect(ownerIndex('transformation')).toBeLessThan(ownerIndex('asset'));
    expect(ownerIndex('canonical')).toBeLessThan(ownerIndex('discovery'));
  });
});
