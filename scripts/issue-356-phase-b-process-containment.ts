import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

import { createIsolatedPostgresTestDatabase } from '../tests/helpers/isolated-postgres-test-database.js';
import { requireTestDatabaseTarget } from './database-target-guard.js';

const parentDatabaseUrl = await requireTestDatabaseTarget();
const marker = 'phase-b-process-containment-' + randomUUID();

if (process.argv.includes('--child')) {
  const childPool = new Pool({
    connectionString: process.env.ISOLATED_DATABASE_URL,
  });
  try {
    const result = await childPool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM asset.original_assets WHERE storage_key = $1',
      [process.env.ISOLATED_MARKER],
    );
    if (result.rows[0]?.count !== '1') {
      throw new Error('Child did not observe the committed isolated fixture.');
    }
  } finally {
    await childPool.end();
  }
  process.kill(process.pid, 'SIGTERM');
} else {
  const parentPool = new Pool({ connectionString: parentDatabaseUrl });
  const isolated = await createIsolatedPostgresTestDatabase();
  const isolatedPool = isolated.createPool();
  try {
    await isolatedPool.query(
      'INSERT INTO asset.original_assets ' +
        '(asset_id, content_hash, size_bytes, storage_key, created_at) ' +
        'VALUES ($1, $2, 1, $3, now())',
      [randomUUID(), 'sha256:' + '4'.repeat(64), marker],
    );
    const child = await new Promise<{
      readonly code: number | null;
      readonly signal: string | null;
    }>((resolve, reject) => {
      const subprocess = spawn(
        process.execPath,
        ['node_modules/tsx/dist/cli.mjs', fileURLToPath(import.meta.url), '--child'],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            ISOLATED_DATABASE_URL: isolated.databaseUrl,
            ISOLATED_MARKER: marker,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      subprocess.once('error', reject);
      subprocess.once('exit', (code, signal) => resolve({ code, signal }));
    });
    const isolatedCount = await isolatedPool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM asset.original_assets WHERE storage_key = $1',
      [marker],
    );
    const parentCount = await parentPool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM asset.original_assets WHERE storage_key = $1',
      [marker],
    );
    if (isolatedCount.rows[0]?.count !== '1' || parentCount.rows[0]?.count !== '0') {
      throw new Error('Process containment counts were not preserved.');
    }
    await isolated.dispose();
    const databaseCount = await parentPool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM pg_database WHERE datname = $1',
      [isolated.databaseName],
    );
    if (databaseCount.rows[0]?.count !== '0') {
      throw new Error('Disposed isolated database still exists.');
    }
    process.stdout.write(
      JSON.stringify({
        child,
        isolatedDatabase: isolated.databaseName,
        isolatedFixtureCount: isolatedCount.rows[0]?.count,
        parentFixtureCount: parentCount.rows[0]?.count,
        disposedDatabaseCount: databaseCount.rows[0]?.count,
      }) + '\n',
    );
  } finally {
    await isolated.dispose();
    await parentPool.end();
  }
}
