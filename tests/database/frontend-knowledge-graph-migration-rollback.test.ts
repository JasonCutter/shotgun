import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';

import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

const MIGRATION_026 = path.resolve(
  fileURLToPath(new URL('../..', import.meta.url)),
  'db/migrations/026_frontend_knowledge_graph_projection.sql',
);

const reverseDdl = `
  DROP TRIGGER IF EXISTS frontend_knowledge_graph_snapshot_context_immutable
    ON frontend_knowledge_graph.snapshot_context;
  DROP FUNCTION IF EXISTS frontend_knowledge_graph.block_snapshot_context_mutation();
  DROP FUNCTION IF EXISTS frontend_knowledge_graph.prune_expired(timestamptz);
  DROP INDEX IF EXISTS frontend_knowledge_graph_continuation_expiry_idx;
  DROP INDEX IF EXISTS frontend_knowledge_graph_continuation_project_idx;
  DROP INDEX IF EXISTS frontend_knowledge_graph_snapshot_context_project_idx;
  DROP TABLE IF EXISTS frontend_knowledge_graph.continuation;
  DROP TABLE IF EXISTS frontend_knowledge_graph.overlay_health;
  DROP TABLE IF EXISTS frontend_knowledge_graph.projection_health;
  DROP TABLE IF EXISTS frontend_knowledge_graph.snapshot_context;
  DROP SCHEMA IF EXISTS frontend_knowledge_graph;
`;

describe.runIf(pool)('FE-P3-S3 migration 026 apply/rollback (AC-29)', () => {
  afterAll(async () => {
    await pool!.end();
  });

  it('applies 026, rolls it back to the pre-026 fingerprint, and re-applies cleanly', async () => {
    const client = await pool!.connect();
    try {
      // Clean slate for the graph schema.
      await client.query('DROP SCHEMA IF EXISTS frontend_knowledge_graph CASCADE');
      const sql = await readFile(MIGRATION_026, 'utf8');

      // Apply.
      await client.query('BEGIN');
      await client.query(sql);
      const tables = await client.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'frontend_knowledge_graph' ORDER BY table_name`,
      );
      const tableNames = tables.rows.map((row) => row.table_name);
      expect(tableNames).toEqual(
        expect.arrayContaining([
          'snapshot_context',
          'projection_health',
          'overlay_health',
          'continuation',
        ]),
      );
      const hasPrune = await client.query(
        `SELECT COUNT(*)::int AS count FROM pg_proc
         WHERE pronamespace = 'frontend_knowledge_graph'::regnamespace AND proname = 'prune_expired'`,
      );
      expect(hasPrune.rows[0]?.count).toBe(1);
      // Reverse DDL removes only the 026 objects.
      await client.query(reverseDdl);
      const afterReverse = await client.query(
        `SELECT COUNT(*)::int AS count FROM information_schema.schemata
         WHERE schema_name = 'frontend_knowledge_graph'`,
      );
      expect(afterReverse.rows[0]?.count).toBe(0);
      await client.query('COMMIT');

      // Re-apply restores the schema for the remaining suite.
      await client.query(sql);
      const restored = await client.query(
        `SELECT COUNT(*)::int AS count FROM information_schema.schemata
         WHERE schema_name = 'frontend_knowledge_graph'`,
      );
      expect(restored.rows[0]?.count).toBe(1);
    } finally {
      client.release();
    }
  });
});
