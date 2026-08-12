import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import 'dotenv/config';
import { Client } from 'pg';

import {
  requireConfirmedDestructiveDatabaseTarget,
  requireTestDatabaseTarget,
} from './database-target-guard.js';

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

const withClient = async <T>(
  connectionString: string,
  action: (client: Client) => Promise<T>,
): Promise<T> => {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await action(client);
  } finally {
    await client.end();
  }
};

const migrationFiles = async (): Promise<string[]> =>
  (await readdir(migrationDirectory)).filter((file) => file.endsWith('.sql')).sort();

const managedSchemas = [
  'frontend_ask',
  'frontend_knowledge_draft',
  'frontend_knowledge_graph',
  'frontend_review',
  'frontend_external_action',
  'frontend_activity',
  'frontend_history',
  'project_audit',
  'source_product',
  'frontend_command',
  'settings',
  'project_admin',
  'auth',
  'action',
  'projection',
  'knowledge',
  'canonical',
  'intake',
  'asset',
  'evidence',
  'transformation',
  'validation',
  'candidate',
  'ai',
  'review',
  'comparison',
  'runtime',
] as const;

const dropManagedSchemas = async (client: Client): Promise<void> => {
  for (const schema of managedSchemas) {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
};

export const dropSchemas = async (connectionString: string): Promise<void> => {
  await withClient(connectionString, dropManagedSchemas);
};

export const migrateUpTo = async (
  targetFile?: string,
  connectionString = databaseUrl(),
): Promise<void> => {
  await withClient(connectionString, async (client) => {
    await client.query('CREATE SCHEMA IF NOT EXISTS runtime');
    await client.query(`
      CREATE TABLE IF NOT EXISTS runtime.schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    for (const file of await migrationFiles()) {
      if (targetFile && file > targetFile) break;
      const applied = await client.query<{ name: string }>(
        'SELECT name FROM runtime.schema_migrations WHERE name = $1',
        [file],
      );
      if ((applied.rowCount ?? 0) > 0) continue;

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
};

const migrate = async (connectionString = databaseUrl()): Promise<void> => {
  await migrateUpTo(undefined, connectionString);
  console.log('Database migrations applied.');
};

const reset = async (connectionString: string): Promise<void> => {
  await withClient(connectionString, dropManagedSchemas);
  await migrate(connectionString);
  console.log('Database schema recreated.');
};

const requiredTables = [
  'runtime.schema_migrations',
  'intake.submissions',
  'asset.source_versions',
  'transformation.revisions',
  'evidence.spans',
  'ai.provider_calls',
  'ai.provider_credentials',
  'candidate.claim_candidates',
  'validation.results',
  'comparison.results',
  'review.change_sets',
  'review.decisions',
  'canonical.project_state',
  'canonical.history_events',
  'canonical.outbox',
  'projection.search_documents',
  'projection.watermarks',
  'knowledge.review_groups',
  'knowledge.entity_vault_imports',
  'projection.compiled_truth',
  'projection.discovery_inferences',
  'action.executions',
  'action.approvals',
  'action.audit_events',
  'action.candidates',
  'action.preview_snapshots',
  'action.approval_records',
  'auth.principals',
  'auth.credentials',
  'auth.project_memberships',
  'auth.sessions',
  'auth.api_tokens',
  'auth.audit_events',
  'project_admin.projects',
  'settings.project_settings',
  'frontend_command.command_ledger',
  'source_product.intake_submissions',
  'source_product.intake_submission_items',
  'source_product.intake_attempts',
  'source_product.exact_duplicate_decisions',
  'source_product.exact_duplicate_dispositions',
  'source_product.url_acquisition_attempts',
  'source_product.url_provenance_receipts',
  'frontend_ask.conversations',
  'frontend_ask.branches',
  'frontend_ask.turns',
  'frontend_ask.answer_runs',
  'frontend_ask.source_selections',
  'frontend_ask.source_selection_evidence',
  'frontend_ask.statements',
  'frontend_ask.citations',
  'frontend_ask.answer_run_attempts',
  'frontend_ask.answer_attempt_evidence',
  'frontend_ask.answer_run_events',
  'frontend_ask.answer_exports',
  'frontend_ask.answer_feedback',
  'frontend_ask.transition_seeds',
  'frontend_knowledge_draft.drafts',
  'frontend_knowledge_draft.revisions',
  'frontend_knowledge_draft.operations',
  'frontend_knowledge_draft.materializations',
  'frontend_knowledge_draft.artifact_refs',
  'frontend_external_action.aggregates',
  'frontend_external_action.candidates',
  'frontend_external_action.risk_decisions',
  'frontend_external_action.manifests',
  'frontend_external_action.approvals',
  'frontend_external_action.preflights',
  'frontend_external_action.executions',
  'frontend_external_action.attempts',
  'frontend_external_action.verifications',
  'frontend_external_action.results',
  'frontend_external_action.audit_events',
  'frontend_external_action.compensations',
  'frontend_external_action.rollbacks',
  'frontend_external_action.credentials',
  'frontend_external_action.budgets',
  'frontend_review.context_revision',
  'frontend_review.item',
  'frontend_review.dependency',
  'frontend_review.decision',
  'frontend_review.comment',
  'frontend_review.approval',
  'frontend_activity.activity_index',
  'frontend_activity.projection_watermarks',
  'frontend_history.history_projection_index',
  'frontend_history.projection_watermarks',
] as const;

const verify = async (connectionString = databaseUrl()): Promise<void> => {
  const expectedMigrationCount = String((await migrationFiles()).length);
  await withClient(connectionString, async (client) => {
    const count = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM runtime.schema_migrations',
    );
    if (count.rows[0]?.count !== expectedMigrationCount) {
      throw new Error('Database bootstrap verification failed: migration count mismatch.');
    }

    const registrations = await client.query<{ name: string; relation: string | null }>(
      `SELECT name, to_regclass(name)::text AS relation
       FROM unnest($1::text[]) AS required(name)`,
      [requiredTables],
    );
    const missing = registrations.rows.filter((row) => row.relation !== row.name);
    if (missing.length > 0) {
      throw new Error(
        `Database bootstrap verification failed: missing ${missing.map((row) => row.name).join(', ')}.`,
      );
    }
  });
  console.log('Database bootstrap verified.');
};

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const command = process.argv[2];
  if (command === 'migrate') {
    await migrate();
  } else if (command === 'reset') {
    const connectionString = databaseUrl();
    await requireConfirmedDestructiveDatabaseTarget({
      databaseUrl: connectionString,
      confirmation: process.env.SHOTGUN_CONFIRM_DATABASE_RESET,
    });
    await reset(connectionString);
  } else if (command === 'test-reset') {
    await reset(await requireTestDatabaseTarget());
  } else if (command === 'verify') {
    await verify();
  } else if (command === 'test-verify') {
    await verify(await requireTestDatabaseTarget());
  } else {
    throw new Error('Use one of: migrate, reset, test-reset, verify, test-verify.');
  }
}
