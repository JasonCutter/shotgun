import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
  ? await requireTestDatabaseTarget()
  : undefined;
const pool: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

describe.runIf(databaseUrl)('WP5 v2 Review Draft PostgreSQL persistence', () => {
  beforeAll(async () => {
    await migrateUpTo(undefined, databaseUrl!);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('creates the additive project-scoped v2 Review Draft table', async () => {
    const result = await pool!.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'review' AND table_name = 'change_sets_v2'`,
    );
    expect(result.rows.map((row) => row.table_name)).toEqual(['change_sets_v2']);
    const constraints = await pool!.query<{ constraint_name: string }>(
      `SELECT constraint_name
       FROM information_schema.table_constraints
       WHERE table_schema = 'review' AND table_name = 'change_sets_v2'
         AND constraint_type = 'UNIQUE'`,
    );
    expect(constraints.rows.map((row) => row.constraint_name)).toContain(
      'change_sets_v2_project_id_comparison_id_key',
    );
  });
});
