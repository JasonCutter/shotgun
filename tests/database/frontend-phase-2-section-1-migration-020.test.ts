import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { dropSchemas, migrateUpTo } from '../../scripts/database.js';

import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

afterAll(async () => {
  await pool?.end();
});

describe.runIf(pool)('Migration 019 to 020 compatibility', () => {
  afterEach(async () => {
    await dropSchemas(databaseUrl);
    await migrateUpTo(undefined, databaseUrl);
  });

  it('upgrades from 019, creates no Product history, and repeat apply is a no-op', async () => {
    await dropSchemas(databaseUrl);
    await migrateUpTo('019_frontend_section3_principal_bootstrap.sql', databaseUrl);
    await migrateUpTo('020_frontend_phase2_sources_product_persistence.sql', databaseUrl);
    await migrateUpTo('020_frontend_phase2_sources_product_persistence.sql', databaseUrl);

    expect(
      await pool!.query(
        `SELECT
           (SELECT count(*)::text FROM runtime.schema_migrations
             WHERE name = '020_frontend_phase2_sources_product_persistence.sql') AS migration_count,
           (SELECT count(*)::text FROM source_product.intake_submissions) AS product_rows,
           (SELECT to_regclass('source_product.url_provenance_receipts')::text) AS receipt_table`,
      ),
    ).toMatchObject({
      rows: [
        {
          migration_count: '1',
          product_rows: '0',
          receipt_table: 'source_product.url_provenance_receipts',
        },
      ],
    });
  });

  it('stops rather than overwriting an unknown Stage 2 channel constraint', async () => {
    await dropSchemas(databaseUrl);
    await migrateUpTo('019_frontend_section3_principal_bootstrap.sql', databaseUrl);
    await pool!.query(`
      ALTER TABLE intake.submissions DROP CONSTRAINT submissions_channel_check;
      ALTER TABLE intake.submissions ADD CONSTRAINT submissions_channel_check
        CHECK (channel IN ('direct_text', 'unexpected_channel'));
    `);

    await expect(
      migrateUpTo('020_frontend_phase2_sources_product_persistence.sql', databaseUrl),
    ).rejects.toThrow(/channel constraint differs from Migration 002/);
    expect(
      await pool!.query(
        `SELECT count(*)::text AS count
         FROM runtime.schema_migrations
         WHERE name = '020_frontend_phase2_sources_product_persistence.sql'`,
      ),
    ).toMatchObject({ rows: [{ count: '0' }] });
  });
});
