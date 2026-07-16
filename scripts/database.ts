import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import 'dotenv/config';
import { Client } from 'pg';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationDirectory = path.join(rootDirectory, 'db', 'migrations');

const databaseUrl = (): string => {
  const value = process.env.DATABASE_URL;
  if (!value) {
    throw new Error(
      'DATABASE_URL is required. Copy .env.example and export its value before using database commands.',
    );
  }
  return value;
};

const withClient = async <T>(action: (client: Client) => Promise<T>): Promise<T> => {
  const client = new Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    return await action(client);
  } finally {
    await client.end();
  }
};

const migrationFiles = async (): Promise<string[]> =>
  (await readdir(migrationDirectory)).filter((file) => file.endsWith('.sql')).sort();

const migrate = async (): Promise<void> => {
  await withClient(async (client) => {
    await client.query('CREATE SCHEMA IF NOT EXISTS runtime');
    await client.query(`
      CREATE TABLE IF NOT EXISTS runtime.schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    for (const file of await migrationFiles()) {
      const applied = await client.query<{ name: string }>(
        'SELECT name FROM runtime.schema_migrations WHERE name = $1',
        [file],
      );
      if (applied.rowCount && applied.rowCount > 0) {
        continue;
      }

      const sql = await readFile(path.join(migrationDirectory, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO runtime.schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  });
  console.log('Database migrations applied.');
};

const reset = async (): Promise<void> => {
  await withClient(async (client) => {
    await client.query('DROP SCHEMA IF EXISTS intake CASCADE');
    await client.query('DROP SCHEMA IF EXISTS asset CASCADE');
    await client.query('DROP SCHEMA IF EXISTS runtime CASCADE');
  });
  await migrate();
  console.log('Database schema recreated.');
};

const verify = async (): Promise<void> => {
  const expectedMigrationCount = String((await migrationFiles()).length);
  await withClient(async (client) => {
    const table = await client.query<{ table: string | null }>(
      "SELECT to_regclass('runtime.schema_migrations') AS table",
    );
    const count = await client.query<{ count: string }>(
      'SELECT count(*) AS count FROM runtime.schema_migrations',
    );
    const intakeTable = await client.query<{ table: string | null }>(
      "SELECT to_regclass('intake.submissions') AS table",
    );
    const assetTable = await client.query<{ table: string | null }>(
      "SELECT to_regclass('asset.source_versions') AS table",
    );
    if (
      table.rows[0]?.table !== 'runtime.schema_migrations' ||
      count.rows[0]?.count !== expectedMigrationCount ||
      intakeTable.rows[0]?.table !== 'intake.submissions' ||
      assetTable.rows[0]?.table !== 'asset.source_versions'
    ) {
      throw new Error('Database bootstrap verification failed.');
    }
  });
  console.log('Database bootstrap verified.');
};

const command = process.argv[2];
if (command === 'migrate') {
  await migrate();
} else if (command === 'reset') {
  await reset();
} else if (command === 'verify') {
  await verify();
} else {
  throw new Error('Use one of: migrate, reset, verify.');
}
