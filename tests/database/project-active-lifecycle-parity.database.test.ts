import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

describe.runIf(pool)('RUS-2-C2 Project active lifecycle parity migration', () => {
  afterAll(async () => {
    await pool?.end();
  });

  it('repairs known legacy states, preserves unknown rows, and is repeat-safe', async () => {
    const prefix = `rus2-c2-migration-${randomUUID()}`;
    const migration = '075_project_active_lifecycle_parity.sql';
    const client = await pool!.connect();
    let clientReleased = false;
    try {
      const rows = [
        ['active-false', 'ACTIVE', false],
        ['archived-true', 'ARCHIVED', true],
        ['delete-requested-true', 'DELETE_REQUESTED', true],
        ['already-correct', 'ACTIVE', true],
        ['future-status', 'FUTURE_STATUS', true],
      ] as const;
      for (const [suffix, status, active] of rows) {
        await client.query(
          `INSERT INTO project_admin.projects
             (id, name, status, active, created_at, updated_at, revision)
           VALUES ($1, $2, $3, $4, '2026-09-15T00:00:00Z', '2026-09-15T00:00:00Z', 7)`,
          [`${prefix}-${suffix}`, suffix, status, active],
        );
      }

      const before = await client.query<{
        id: string;
        status: string;
        active: boolean;
        revision: number;
        created_at: Date;
        updated_at: Date;
      }>(
        `SELECT id, status, active, revision, created_at, updated_at
         FROM project_admin.projects WHERE id LIKE $1 ORDER BY id`,
        [`${prefix}-%`],
      );

      await client.query('DELETE FROM runtime.schema_migrations WHERE name = $1', [migration]);
      client.release();
      clientReleased = true;
      await migrateUpTo(undefined, databaseUrl);

      const repaired = await pool!.query<{
        id: string;
        status: string;
        active: boolean;
        revision: number;
        created_at: Date;
        updated_at: Date;
      }>(
        `SELECT id, status, active, revision, created_at, updated_at
         FROM project_admin.projects WHERE id LIKE $1 ORDER BY id`,
        [`${prefix}-%`],
      );
      expect(repaired.rows.map(({ id, status, active }) => ({ id, status, active }))).toEqual([
        { id: `${prefix}-active-false`, status: 'ACTIVE', active: true },
        { id: `${prefix}-already-correct`, status: 'ACTIVE', active: true },
        { id: `${prefix}-archived-true`, status: 'ARCHIVED', active: false },
        { id: `${prefix}-delete-requested-true`, status: 'DELETE_REQUESTED', active: false },
        { id: `${prefix}-future-status`, status: 'FUTURE_STATUS', active: true },
      ]);
      expect(
        repaired.rows.map(({ id, revision, created_at, updated_at }) => ({
          id,
          revision,
          created_at,
          updated_at,
        })),
      ).toEqual(
        before.rows.map(({ id, revision, created_at, updated_at }) => ({
          id,
          revision,
          created_at,
          updated_at,
        })),
      );

      await pool!.query('DELETE FROM runtime.schema_migrations WHERE name = $1', [migration]);
      await migrateUpTo(undefined, databaseUrl);
      const repeated = await pool!.query(
        `SELECT id, status, active, revision, created_at, updated_at
         FROM project_admin.projects WHERE id LIKE $1 ORDER BY id`,
        [`${prefix}-%`],
      );
      expect(repeated.rows).toEqual(repaired.rows);
    } finally {
      if (!clientReleased) client.release();
      await pool!.query('DELETE FROM project_admin.projects WHERE id LIKE $1', [`${prefix}-%`]);
    }
  });
});
