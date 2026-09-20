import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';
import { dropIsolatedPostgresDatabase } from '../../scripts/isolated-postgres-database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const parentDatabaseUrl = await requireTestDatabaseTarget();
const parentPool = new Pool({ connectionString: parentDatabaseUrl });
const parentClient = await parentPool.connect();

afterAll(async () => {
  parentClient.release();
  await parentPool.end();
});

describe('isolated PostgreSQL test database contract', () => {
  it('contains sentinels across databases and disposes the exact namespace', async () => {
    const first = await createIsolatedPostgresTestDatabase();
    const second = await createIsolatedPostgresTestDatabase();
    const firstPool = first.createPool();
    const firstSecondPool = first.createPool();
    const secondPool = second.createPool();
    const firstStorageKey = 'isolated-contract-first-' + randomUUID();
    const parentStorageKey = 'isolated-contract-parent-' + randomUUID();
    const digest = 'sha256:' + '1'.repeat(64);
    let testError: unknown;
    let bodyFailed = false;
    try {
      expect(first.databaseName).toMatch(/^shotgun_test_iso_[a-z0-9_]+$/u);
      expect(second.databaseName).toMatch(/^shotgun_test_iso_[a-z0-9_]+$/u);
      expect(first.databaseName).not.toBe(second.databaseName);

      const current = await firstSecondPool.query<{ database: string }>(
        'SELECT current_database() AS database',
      );
      expect(current.rows[0]?.database).toBe(first.databaseName);

      await firstPool.query(
        'INSERT INTO asset.original_assets ' +
          '(asset_id, content_hash, size_bytes, storage_key, created_at) ' +
          'VALUES ($1, $2, 1, $3, now())',
        [randomUUID(), digest, firstStorageKey],
      );
      const firstCount = await firstPool.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM asset.original_assets WHERE storage_key = $1',
        [firstStorageKey],
      );
      const secondCount = await secondPool.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM asset.original_assets WHERE storage_key = $1',
        [firstStorageKey],
      );
      const parentCount = await parentPool.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM asset.original_assets WHERE storage_key = $1',
        [firstStorageKey],
      );
      expect(firstCount.rows[0]?.count).toBe('1');
      expect(secondCount.rows[0]?.count).toBe('0');
      expect(parentCount.rows[0]?.count).toBe('0');

      const parentDatabase = await parentClient.query<{ database: string }>(
        'SELECT current_database() AS database',
      );
      expect(parentDatabase.rows[0]?.database).toBe('shotgun_test');
      await parentClient.query(
        'CREATE TEMP TABLE isolated_contract_parent_sentinel (storage_key text PRIMARY KEY)',
      );
      await parentClient.query(
        'INSERT INTO isolated_contract_parent_sentinel (storage_key) VALUES ($1)',
        [parentStorageKey],
      );
      await expect(
        firstPool.query(
          'SELECT count(*)::text AS count FROM isolated_contract_parent_sentinel WHERE storage_key = $1',
          [parentStorageKey],
        ),
      ).rejects.toMatchObject({ code: '42P01' });

      await expect(
        dropIsolatedPostgresDatabase(parentDatabaseUrl, 'test', 'shotgun_test'),
      ).rejects.toThrow();

      await first.dispose();
      await first.dispose();
      const firstDatabaseCount = await parentPool.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM pg_database WHERE datname = $1',
        [first.databaseName],
      );
      expect(firstDatabaseCount.rows[0]?.count).toBe('0');
    } catch (error) {
      testError = error;
      bodyFailed = true;
    }
    const disposeResults = await Promise.allSettled([first.dispose(), second.dispose()]);
    const disposeErrors = disposeResults
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason);
    if (bodyFailed) {
      if (disposeErrors.length > 0) {
        throw new AggregateError(
          [testError, ...disposeErrors],
          'Contract test and disposal failed.',
        );
      }
      throw testError;
    }
    if (disposeErrors.length > 0) {
      throw new AggregateError(disposeErrors, 'Failed to dispose contract test databases.');
    }
  });

  it('cleans an exact database when migration setup fails', async () => {
    const before = await parentPool.query<{ datname: string }>(
      'SELECT datname FROM pg_database ' +
        "WHERE datname LIKE 'shotgun_test_iso_%' ORDER BY datname",
    );
    await expect(
      createIsolatedPostgresTestDatabase({
        migrate: async () => {
          throw new Error('synthetic migration setup failure');
        },
      }),
    ).rejects.toThrow('synthetic migration setup failure');
    const after = await parentPool.query<{ datname: string }>(
      'SELECT datname FROM pg_database ' +
        "WHERE datname LIKE 'shotgun_test_iso_%' ORDER BY datname",
    );
    expect(after.rows.map((row) => row.datname)).toEqual(before.rows.map((row) => row.datname));
  });
});
