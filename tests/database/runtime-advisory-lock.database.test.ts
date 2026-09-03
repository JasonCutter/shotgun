import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';
import type { Pool, PoolClient } from 'pg';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

let databaseUrl: string | undefined;
if (process.env.TEST_DATABASE_URL?.trim()) {
  try {
    databaseUrl = await requireTestDatabaseTarget();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ECONNREFUSED|ENOTFOUND|timeout|connect/i.test(message)) {
      console.warn(`Advisory-lock PostgreSQL proof skipped: ${message}`);
    } else {
      throw error;
    }
  }
}

const pool: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;
const describeDatabase = pool ? describe : describe.skip;

const begin = (client: PoolClient): Promise<unknown> => client.query('BEGIN');

const lock = (client: PoolClient, key: string): Promise<unknown> =>
  client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);

const tryLock = async (client: PoolClient, key: string): Promise<boolean> => {
  const result = await client.query<{ locked: boolean }>(
    'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS locked',
    [key],
  );
  return result.rows[0]?.locked === true;
};

const rollback = async (client: PoolClient): Promise<void> => {
  await client.query('ROLLBACK').catch(() => undefined);
};

describeDatabase('PostgreSQL advisory lock 64-bit derivation', () => {
  afterAll(async () => {
    await pool?.end();
  });

  it('serializes the same logical key and releases it on commit', async () => {
    const first = await pool!.connect();
    const second = await pool!.connect();
    const key = `wp02-commit-${randomUUID()}`;
    try {
      await begin(first);
      await lock(first, key);
      await begin(second);
      expect(await tryLock(second, key)).toBe(false);

      await first.query('COMMIT');
      expect(await tryLock(second, key)).toBe(true);
      await second.query('COMMIT');
    } finally {
      await rollback(first);
      await rollback(second);
      first.release();
      second.release();
    }
  });

  it('releases the transaction advisory lock on rollback', async () => {
    const first = await pool!.connect();
    const second = await pool!.connect();
    const key = `wp02-rollback-${randomUUID()}`;
    try {
      await begin(first);
      await lock(first, key);
      await begin(second);
      expect(await tryLock(second, key)).toBe(false);

      await first.query('ROLLBACK');
      expect(await tryLock(second, key)).toBe(true);
      await second.query('COMMIT');
    } finally {
      await rollback(first);
      await rollback(second);
      first.release();
      second.release();
    }
  });

  it('allows different logical keys to proceed independently', async () => {
    const first = await pool!.connect();
    const second = await pool!.connect();
    const key = `wp02-independent-${randomUUID()}`;
    try {
      await begin(first);
      await lock(first, `${key}:a`);
      await begin(second);
      expect(await tryLock(second, `${key}:b`)).toBe(true);
      await second.query('COMMIT');
      await first.query('COMMIT');
    } finally {
      await rollback(first);
      await rollback(second);
      first.release();
      second.release();
    }
  });
});
