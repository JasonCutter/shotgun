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
    await client.query('DROP SCHEMA IF EXISTS action CASCADE');
    await client.query('DROP SCHEMA IF EXISTS projection CASCADE');
    await client.query('DROP SCHEMA IF EXISTS knowledge CASCADE');
    await client.query('DROP SCHEMA IF EXISTS canonical CASCADE');
    await client.query('DROP SCHEMA IF EXISTS intake CASCADE');
    await client.query('DROP SCHEMA IF EXISTS asset CASCADE');
    await client.query('DROP SCHEMA IF EXISTS evidence CASCADE');
    await client.query('DROP SCHEMA IF EXISTS transformation CASCADE');
    await client.query('DROP SCHEMA IF EXISTS validation CASCADE');
    await client.query('DROP SCHEMA IF EXISTS candidate CASCADE');
    await client.query('DROP SCHEMA IF EXISTS ai CASCADE');
    await client.query('DROP SCHEMA IF EXISTS review CASCADE');
    await client.query('DROP SCHEMA IF EXISTS comparison CASCADE');
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
    const transformationTable = await client.query<{ table: string | null }>(
      "SELECT to_regclass('transformation.revisions') AS table",
    );
    const evidenceTable = await client.query<{ table: string | null }>(
      "SELECT to_regclass('evidence.spans') AS table",
    );
    const aiTable = await client.query<{ table: string | null }>(
      "SELECT to_regclass('ai.provider_calls') AS table",
    );
    const candidateTable = await client.query<{ table: string | null }>(
      "SELECT to_regclass('candidate.claim_candidates') AS table",
    );
    const validationTable = await client.query<{ table: string | null }>(
      "SELECT to_regclass('validation.results') AS table",
    );
    const comparisonTable = await client.query<{ table: string | null }>(
      "SELECT to_regclass('comparison.results') AS table",
    );
    const reviewTable = await client.query<{ table: string | null }>(
      "SELECT to_regclass('review.change_sets') AS table",
    );
    const decisionTable = await client.query<{ table: string | null }>(
      "SELECT to_regclass('review.decisions') AS table",
    );
    const canonicalStateTable = await client.query<{ table: string | null }>(
      "SELECT to_regclass('canonical.project_state') AS table",
    );
    const canonicalHistoryTable = await client.query<{ table: string | null }>(
      "SELECT to_regclass('canonical.history_events') AS table",
    );
    const canonicalOutboxTable = await client.query<{ table: string | null }>(
      "SELECT to_regclass('canonical.outbox') AS table",
    );
    const projectionDocumentsTable = await client.query<{ table: string | null }>(
      "SELECT to_regclass('projection.search_documents') AS table",
    );
    const projectionWatermarkTable = await client.query<{ table: string | null }>(
      "SELECT to_regclass('projection.watermarks') AS table",
    );
    const knowledgeGroupTable = await client.query<{ table: string | null }>(
      "SELECT to_regclass('knowledge.review_groups') AS table",
    );
    const entityVaultImportTable = await client.query<{ table: string | null }>(
      "SELECT to_regclass('knowledge.entity_vault_imports') AS table",
    );
    const compiledTruthTable = await client.query<{ table: string | null }>(
      "SELECT to_regclass('projection.compiled_truth') AS table",
    );
    const discoveryInferenceTable = await client.query<{ table: string | null }>(
      "SELECT to_regclass('projection.discovery_inferences') AS table",
    );
    const actionExecutionTable = await client.query<{ table: string | null }>(
      "SELECT to_regclass('action.executions') AS table",
    );
    const actionApprovalTable = await client.query<{ table: string | null }>(
      "SELECT to_regclass('action.approvals') AS table",
    );
    const actionAuditTable = await client.query<{ table: string | null }>(
      "SELECT to_regclass('action.audit_events') AS table",
    );
    if (
      table.rows[0]?.table !== 'runtime.schema_migrations' ||
      count.rows[0]?.count !== expectedMigrationCount ||
      intakeTable.rows[0]?.table !== 'intake.submissions' ||
      assetTable.rows[0]?.table !== 'asset.source_versions' ||
      transformationTable.rows[0]?.table !== 'transformation.revisions' ||
      evidenceTable.rows[0]?.table !== 'evidence.spans' ||
      aiTable.rows[0]?.table !== 'ai.provider_calls' ||
      candidateTable.rows[0]?.table !== 'candidate.claim_candidates' ||
      validationTable.rows[0]?.table !== 'validation.results' ||
      comparisonTable.rows[0]?.table !== 'comparison.results' ||
      reviewTable.rows[0]?.table !== 'review.change_sets' ||
      decisionTable.rows[0]?.table !== 'review.decisions' ||
      canonicalStateTable.rows[0]?.table !== 'canonical.project_state' ||
      canonicalHistoryTable.rows[0]?.table !== 'canonical.history_events' ||
      canonicalOutboxTable.rows[0]?.table !== 'canonical.outbox' ||
      projectionDocumentsTable.rows[0]?.table !== 'projection.search_documents' ||
      projectionWatermarkTable.rows[0]?.table !== 'projection.watermarks' ||
      knowledgeGroupTable.rows[0]?.table !== 'knowledge.review_groups' ||
      entityVaultImportTable.rows[0]?.table !== 'knowledge.entity_vault_imports' ||
      compiledTruthTable.rows[0]?.table !== 'projection.compiled_truth' ||
      discoveryInferenceTable.rows[0]?.table !== 'projection.discovery_inferences' ||
      actionExecutionTable.rows[0]?.table !== 'action.executions' ||
      actionApprovalTable.rows[0]?.table !== 'action.approvals' ||
      actionAuditTable.rows[0]?.table !== 'action.audit_events'
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
