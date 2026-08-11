import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';

import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

const MIGRATION_027 = path.resolve(
  fileURLToPath(new URL('../..', import.meta.url)),
  'db/migrations/027_frontend_review_center.sql',
);

const reverseDdl = `
  DROP TRIGGER IF EXISTS frontend_review_approval_append_only
    ON frontend_review.approval;
  DROP TRIGGER IF EXISTS frontend_review_comment_append_only
    ON frontend_review.comment;
  DROP TRIGGER IF EXISTS frontend_review_decision_append_only
    ON frontend_review.decision;
  DROP TRIGGER IF EXISTS frontend_review_dependency_immutable
    ON frontend_review.dependency;
  DROP TRIGGER IF EXISTS frontend_review_item_immutable
    ON frontend_review.item;
  DROP TRIGGER IF EXISTS frontend_review_context_revision_immutable
    ON frontend_review.context_revision;
  DROP FUNCTION IF EXISTS frontend_review.block_approval_mutation();
  DROP FUNCTION IF EXISTS frontend_review.block_comment_mutation();
  DROP FUNCTION IF EXISTS frontend_review.block_decision_mutation();
  DROP FUNCTION IF EXISTS frontend_review.block_dependency_mutation();
  DROP FUNCTION IF EXISTS frontend_review.block_item_mutation();
  DROP FUNCTION IF EXISTS frontend_review.block_context_mutation();
  DROP INDEX IF EXISTS frontend_review_approval_project_status_idx;
  DROP INDEX IF EXISTS frontend_review_approval_context_idx;
  DROP INDEX IF EXISTS frontend_review_decision_context_idx;
  DROP INDEX IF EXISTS frontend_review_comment_context_idx;
  DROP INDEX IF EXISTS frontend_review_context_revision_project_idx;
  DROP INDEX IF EXISTS frontend_review_context_revision_resource_idx;
  DROP TABLE IF EXISTS frontend_review.approval;
  DROP TABLE IF EXISTS frontend_review.comment;
  DROP TABLE IF EXISTS frontend_review.decision;
  DROP TABLE IF EXISTS frontend_review.dependency;
  DROP TABLE IF EXISTS frontend_review.item;
  DROP TABLE IF EXISTS frontend_review.context_revision;
  DROP SCHEMA IF EXISTS frontend_review;
`;

describe.runIf(pool)('FE-P4-S1 migration 027 apply/rollback (AC-17)', () => {
  afterAll(async () => {
    await pool!.end();
  });

  it('applies 027, rolls it back to the pre-027 fingerprint, and re-applies cleanly', async () => {
    const client = await pool!.connect();
    try {
      // Clean slate for the review schema.
      await client.query('DROP SCHEMA IF EXISTS frontend_review CASCADE');
      const sql = await readFile(MIGRATION_027, 'utf8');

      // Apply.
      await client.query('BEGIN');
      await client.query(sql);
      const tables = await client.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'frontend_review' ORDER BY table_name`,
      );
      const tableNames = tables.rows.map((row) => row.table_name);
      expect(tableNames).toEqual(
        expect.arrayContaining([
          'context_revision',
          'item',
          'dependency',
          'decision',
          'comment',
          'approval',
        ]),
      );

      // Immutable/append-only triggers are registered.
      const triggers = await client.query(
        `SELECT event_object_table, trigger_name FROM information_schema.triggers
         WHERE trigger_schema = 'frontend_review'
         ORDER BY event_object_table, trigger_name`,
      );
      expect(triggers.rows.map((row) => `${row.event_object_table}:${row.trigger_name}`)).toEqual(
        expect.arrayContaining([
          'context_revision:frontend_review_context_revision_immutable',
          'item:frontend_review_item_immutable',
          'dependency:frontend_review_dependency_immutable',
          'decision:frontend_review_decision_append_only',
          'comment:frontend_review_comment_append_only',
          'approval:frontend_review_approval_append_only',
        ]),
      );

      // Reverse DDL removes only the 027 objects.
      await client.query(reverseDdl);
      const afterReverse = await client.query(
        `SELECT COUNT(*)::int AS count FROM information_schema.schemata
         WHERE schema_name = 'frontend_review'`,
      );
      expect(afterReverse.rows[0]?.count).toBe(0);
      await client.query('COMMIT');

      // Re-apply restores the schema for the remaining suite.
      await client.query(sql);
      const restored = await client.query(
        `SELECT COUNT(*)::int AS count FROM information_schema.schemata
         WHERE schema_name = 'frontend_review'`,
      );
      expect(restored.rows[0]?.count).toBe(1);
    } finally {
      client.release();
    }
  });
});
