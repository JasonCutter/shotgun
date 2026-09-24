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

export const managedSchemas = [
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
  'connector',
  'discovery',
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
  'connector.dedup_records',
  'connector.jobs',
  'connector.job_attempts',
  'connector.dead_letters',
  'connector.replays',
  'connector.ordering_checkpoints',
  'intake.submissions',
  'asset.source_versions',
  'asset.staging_asset_leases',
  'transformation.revisions',
  'evidence.spans',
  'evidence.indexing_results',
  'evidence.stage4_continuations',
  'source_product.source_stage3_progress',
  'ai.provider_calls',
  'ai.provider_credentials',
  'ai.project_ai_configurations',
  'ai.project_ai_configuration_revisions',
  'ai.project_standing_ai_processing_policies',
  'ai.project_standing_ai_processing_policy_revisions',
  'settings.provider_external_transfer_approvals',
  'settings.provider_external_transfer_approval_revisions',
  'candidate.claim_candidates',
  'validation.results',
  'comparison.results',
  'comparison.results_v2',
  'comparison.analysis_revisions_v2',
  'comparison.relationships_v2',
  'comparison.blocked_outcomes_v2',
  'review.change_sets',
  'review.decisions',
  'canonical.project_state',
  'canonical.knowledge_reset_events',
  'canonical.relations',
  'canonical.relation_precursors',
  'canonical.history_events',
  'canonical.outbox',
  'canonical.t3_reset_owner_snapshots',
  'canonical.t3_reset_owner_snapshot_rows',
  'projection.search_documents',
  'projection.watermarks',
  'projection.semantic_generations',
  'projection.semantic_items',
  'knowledge.review_groups',
  'knowledge.entity_vault_imports',
  'projection.compiled_truth',
  'projection.discovery_inferences',
  'discovery.findings',
  'discovery.feedback_events',
  'discovery.suppression_directives',
  'discovery.suppression_semantic_family_projection',
  'discovery.ranking_policy_revisions',
  'discovery.finding_lifecycle_current',
  'discovery.finding_lifecycle_history',
  'discovery.jobs',
  'discovery.job_lifecycle_history',
  'discovery.runs',
  'discovery.run_lifecycle_history',
  'discovery.attempts',
  'discovery.attempt_lifecycle_history',
  'discovery.stages',
  'discovery.stage_history',
  'discovery.work_budget_checkpoints',
  'discovery.finding_ready',
  'discovery.reentry_manifests',
  'discovery.reentry_candidates',
  'discovery.reentry_review_roots',
  'discovery.reentry_review_resources',
  'discovery.reentry_consumption',
  'discovery.epistemic_reentry_triggers',
  'knowledge.typed_proposition_conflict_rules',
  'knowledge.typed_incompatibility_assertions',
  'action.executions',
  'action.approvals',
  'action.audit_events',
  'action.candidates',
  'action.preview_snapshots',
  'action.approval_records',
  'action.action_review_work_items',
  'action.action_feedback_outbox',
  'discovery.semantic_essence_diagnostics',
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
  'action.executions',
  'action.approvals',
  'action.audit_events',
  'action.candidates',
  'action.preview_snapshots',
  'action.approval_records',
  'action.action_feedback_outbox',
  'action.action_review_work_items',
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

const requiredColumns = [
  'project_admin.project_knowledge_reset_requests.owner_manifest_digest',
  'project_admin.project_knowledge_reset_requests.preserved_configuration_digest',
] as const;

const requiredFunctions = [
  'project_admin.t3_reset_write_authorized(text)',
  'project_admin.t3_guard_project_knowledge_write()',
  'source_product.t3_source_product_status(text,uuid)',
  'source_product.t3_erase_project_source_product(text,uuid)',
  'intake.t3_project_submission_status(text,uuid)',
  'intake.t3_erase_project_submissions(text,uuid)',
  'project_admin.t3_read_reset_execution_snapshot(text,uuid)',
  'project_admin.t3_set_reset_execution_state(text,uuid,text,text[])',
  'project_admin.t3_checkpoint_reset_execution_step(text,uuid,text)',
  'project_admin.t3_complete_reset_execution(text,uuid)',
  'evidence.t3_project_evidence_status(text,uuid)',
  'evidence.t3_erase_project_evidence(text,uuid)',
  'transformation.t3_project_transformation_status(text,uuid)',
  'transformation.t3_erase_project_transformation(text,uuid)',
  'frontend_ask.t3_project_ask_status(text,uuid)',
  'frontend_ask.t3_erase_project_ask(text,uuid)',
  'comparison.t3_project_comparison_status(text,uuid)',
  'comparison.t3_erase_project_comparison(text,uuid)',
  'validation.t3_project_validation_status(text,uuid)',
  'validation.t3_erase_project_validation(text,uuid)',
  'candidate.t3_project_candidate_status(text,uuid)',
  'candidate.t3_erase_project_candidate(text,uuid)',
  'ai.t3_project_provider_status(text,uuid)',
  'ai.t3_erase_project_provider_data(text,uuid)',
  'asset.t3_project_asset_status(text,uuid)',
  'asset.t3_erase_project_asset_data(text,uuid)',
  'frontend_knowledge_graph.t3_project_graph_status(text,uuid)',
  'frontend_knowledge_graph.t3_erase_project_graph_views(text,uuid)',
  'project_audit.t3_project_reset_guard_status(text,uuid)',
  'project_audit.t3_assert_project_reset_audit_empty(text,uuid)',
  'frontend_command.t3_project_source_command_impact(text)',
  'frontend_command.t3_snapshot_project_source_commands(text,uuid)',
  'frontend_command.t3_erase_project_source_commands(text,uuid)',
  'frontend_command.t3_verify_project_source_commands(text,uuid)',
  'frontend_external_action.t3_project_action_impact(text)',
  'frontend_external_action.t3_project_action_status(text,uuid)',
  'frontend_external_action.t3_snapshot_project_actions(text,uuid)',
  'frontend_external_action.t3_erase_project_actions(text,uuid)',
  'action.t3_project_action_impact(text)',
  'action.t3_project_action_status(text,uuid)',
  'action.t3_snapshot_project_actions(text,uuid)',
  'action.t3_erase_project_actions(text,uuid)',
  'discovery.t3_project_discovery_impact(text)',
  'discovery.t3_project_discovery_status(text,uuid)',
  'discovery.t3_erase_project_discovery(text,uuid)',
  'frontend_knowledge_draft.t3_jsonb_mentions_source_token(jsonb,text[])',
  'frontend_knowledge_draft.t3_jsonb_has_unknown_source_reference(jsonb,text)',
  'frontend_knowledge_draft.t3_classify_project_drafts(text)',
  'frontend_knowledge_draft.t3_project_draft_impact(text)',
  'frontend_knowledge_draft.t3_project_draft_status(text,uuid)',
  'frontend_knowledge_draft.t3_erase_project_drafts(text,uuid)',
  'frontend_knowledge_draft.t3_guard_project_draft_write()',
  'frontend_review.t3_guard_review_write()',
  'review.t3_classify_project_review(text)',
  'review.t3_project_review_impact(text)',
  'review.t3_project_review_status(text,uuid)',
  'review.t3_erase_project_review(text,uuid)',
  'frontend_review.t3_review_delete_authorized(text,text,integer)',
  'projection.t3_project_projection_impact(text)',
  'projection.t3_project_projection_status(text,uuid)',
  'projection.t3_erase_project_projections(text,uuid)',
  'projection.t3_rebuild_project_projection_snapshot(text,uuid,jsonb,jsonb)',
  'canonical.t3_classify_project_content(text)',
  'canonical.t3_project_canonical_impact(text)',
  'canonical.t3_project_canonical_status(text,uuid)',
  'canonical.t3_snapshot_project_canonical(text,uuid,text)',
  'canonical.t3_erase_project_canonical(text,uuid)',
  'canonical.t3_list_project_knowledge_reset_events(text)',
  'canonical.t3_publish_project_knowledge_reset_event(text,uuid)',
  'frontend_activity.t3_project_activity_impact(text)',
  'frontend_activity.t3_project_activity_status(text,uuid)',
  'frontend_activity.t3_snapshot_project_activity(text,uuid)',
  'frontend_activity.t3_erase_project_activity(text,uuid)',
  'frontend_activity.t3_rebuild_project_activity(text,uuid,jsonb,jsonb)',
  'frontend_activity.t3_guard_project_activity_write()',
  'frontend_activity.t3_discard_pre_purge_snapshot()',
  'frontend_history.t3_project_history_impact(text)',
  'frontend_history.t3_project_history_status(text,uuid)',
  'frontend_history.t3_snapshot_project_history(text,uuid)',
  'frontend_history.t3_erase_project_history(text,uuid)',
  'frontend_history.t3_rebuild_project_history(text,uuid,jsonb,jsonb)',
  'frontend_history.t3_guard_project_history_write()',
  'frontend_history.t3_discard_pre_purge_snapshot()',
  'knowledge.t3_project_knowledge_impact(text)',
  'knowledge.t3_project_knowledge_status(text,uuid)',
  'knowledge.t3_snapshot_project_knowledge(text,uuid)',
  'knowledge.t3_erase_project_knowledge(text,uuid)',
  'knowledge.t3_discard_pre_purge_snapshot()',
  'connector.t3_jsonb_mentions_source_token(jsonb,text[])',
  'connector.t3_project_connector_impact(text)',
  'connector.t3_guard_job_project_knowledge_write()',
  'connector.t3_reset_request_authorized(text,uuid,text[])',
  'connector.t3_snapshot_project_connector(text,uuid)',
  'connector.t3_erase_project_connector(text,uuid)',
  'connector.t3_project_connector_status(text,uuid)',
  'connector.t3_discard_pre_purge_snapshot()',
  'settings.t3_jsonb_mentions_source_token(jsonb,text[])',
  'settings.t3_project_settings_impact(text)',
  'settings.t3_reset_request_authorized(text,uuid,text[])',
  'settings.t3_guard_resource_setting_write()',
  'settings.t3_snapshot_project_settings(text,uuid)',
  'settings.t3_erase_project_settings(text,uuid)',
  'settings.t3_project_settings_status(text,uuid)',
  'settings.t3_discard_pre_purge_snapshot()',
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

    const columns = await client.query<{ name: string }>(
      `SELECT expected.name
       FROM unnest($1::text[]) AS expected(name)
       LEFT JOIN information_schema.columns AS actual
         ON actual.table_schema || '.' || actual.table_name || '.' || actual.column_name = expected.name
       WHERE actual.column_name IS NULL`,
      [requiredColumns],
    );
    if (columns.rows.length > 0) {
      throw new Error(
        `Database bootstrap verification failed: missing ${columns.rows.map((row) => row.name).join(', ')}.`,
      );
    }

    const functions = await client.query<{ name: string; function: string | null }>(
      `SELECT expected.name, to_regprocedure(expected.name)::text AS function
       FROM unnest($1::text[]) AS expected(name)`,
      [requiredFunctions],
    );
    const missingFunctions = functions.rows.filter((row) => row.function === null);
    if (missingFunctions.length > 0) {
      throw new Error(
        `Database bootstrap verification failed: missing ${missingFunctions.map((row) => row.name).join(', ')}.`,
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
