import { createHash } from 'node:crypto';

import type { Pool } from 'pg';

import type {
  KnowledgeResetBlockerCodeV1,
  KnowledgeResetImpactCountsV1,
  KnowledgeResetImpactPort,
} from '../../../modules/source-knowledge-reset/src/index.js';

const EXPECTED_TABLE_COUNT = 195;
const EXPECTED_TABLE_DIGEST = 'b9aebe5dabead6bb1151d4a0e0fb57b372d15e6a3bee12be9ec84ae7ef43301a';
const EXPECTED_CONTENT_COLUMN_COUNT = 167;
const EXPECTED_CONTENT_COLUMN_DIGEST =
  '6e62325d2d2757c8c7c877ebd8b17faaeb67e856645363685a2313b695a309b2';

type ScopeRow = Readonly<{
  schema_name: string;
  table_name: string;
}>;

type TableClassification = 'SOURCE_DERIVED' | 'REDACT' | 'REBUILD' | 'CONDITIONAL' | 'PRESERVE';

type ScopeSnapshot = Readonly<{
  relation: string;
  classification: TableClassification;
  rowCount: number;
  fingerprint: string;
}>;

type ExternalActionSnapshot = Readonly<{
  actionCount: number;
  linkedActionCount: number;
  unclassifiedActionCount: number;
  activeActionCount: number;
  externalEffectActionCount: number;
  derivedRecords: number;
  redactedAuditRecords: number;
  fingerprint: string;
}>;

type ActionSnapshot = Readonly<{
  candidateCount: number;
  actionCount: number;
  linkedCandidateCount: number;
  linkedActionCount: number;
  unclassifiedCandidateCount: number;
  unclassifiedActionCount: number;
  unclassifiedWorkItemCount: number;
  activeActionCount: number;
  externalEffectActionCount: number;
  derivedRecords: number;
  redactedAuditRecords: number;
  fingerprint: string;
}>;

type DiscoverySnapshot = Readonly<{
  derivedRecordCount: number;
  activeJobCount: number;
  activeProviderReservationCount: number;
  pendingReentryCount: number;
  unclassifiedRecordCount: number;
  fingerprint: string;
}>;

type KnowledgeDraftSnapshot = Readonly<{
  sourceDerivedDraftCount: number;
  sourceDerivedRecordCount: number;
  preservedDraftCount: number;
  unclassifiedRecordCount: number;
  fingerprint: string;
}>;

type ReviewSnapshot = Readonly<{
  sourceDerivedRecordCount: number;
  preservedRecordCount: number;
  redactedIdentityCount: number;
  unclassifiedRecordCount: number;
  fingerprint: string;
}>;

type ProjectionSnapshot = Readonly<{
  projectionRecordCount: number;
  activeGenerationCount: number;
  fingerprint: string;
}>;

type CanonicalSnapshot = Readonly<{
  sourceDerivedRecordCount: number;
  unclassifiedRecordCount: number;
  redactedIdentityCount: number;
  activeOutboxCount: number;
  canonicalVersion: number;
  canonicalSnapshotDigest: string | null;
  fingerprint: string;
}>;

type ActivitySnapshot = Readonly<{
  activityRecordCount: number;
  watermarkCount: number;
  sourceDomainRecordCount: number;
  snapshotRevision: number;
  fingerprint: string;
}>;

type HistorySnapshot = Readonly<{
  historyRecordCount: number;
  watermarkCount: number;
  snapshotRevision: number;
  fingerprint: string;
}>;

type KnowledgeModelSnapshot = Readonly<{
  sourceDerivedRecordCount: number;
  unclassifiedRecordCount: number;
  fingerprint: string;
}>;

type ConnectorSnapshot = Readonly<{
  sourceDerivedRecordCount: number;
  unclassifiedRecordCount: number;
  activeJobCount: number;
  fingerprint: string;
}>;

type SettingsSnapshot = Readonly<{
  sourceDerivedRecordCount: number;
  unclassifiedRecordCount: number;
  fingerprint: string;
  proposalsFingerprint: string;
}>;

const OWNER_CLASSIFIED_TABLES = new Set([
  'knowledge.review_groups',
  'knowledge.entity_vault_imports',
]);

const OWNER_CLASSIFIED_SCHEMAS = new Set([
  'canonical',
  'connector',
  'frontend_review',
  'projection',
  'review',
  'settings',
]);

const MANAGED_SCHEMAS = new Set([
  'action',
  'ai',
  'asset',
  'auth',
  'candidate',
  'canonical',
  'comparison',
  'connector',
  'discovery',
  'evidence',
  'frontend_activity',
  'frontend_ask',
  'frontend_command',
  'frontend_external_action',
  'frontend_history',
  'frontend_knowledge_draft',
  'frontend_knowledge_graph',
  'frontend_review',
  'intake',
  'knowledge',
  'project_admin',
  'project_audit',
  'projection',
  'review',
  'runtime',
  'settings',
  'source_product',
  'transformation',
  'validation',
]);

const SOURCE_DERIVED_SCHEMAS = new Set([
  'candidate',
  'comparison',
  'discovery',
  'evidence',
  'intake',
  'source_product',
  'transformation',
  'validation',
]);

const CONDITIONAL_SCHEMAS = new Set([
  'action',
  'canonical',
  'connector',
  'frontend_ask',
  'frontend_external_action',
  'frontend_knowledge_draft',
  'frontend_knowledge_graph',
  'frontend_review',
  'review',
  'project_audit',
]);

// Reset request and epoch rows are mutable control-plane state created after
// preview approval. They are deliberately outside the knowledge manifest.
const RESET_CONTROL_TABLES = new Set([
  'project_admin.project_knowledge_epoch',
  'project_admin.project_knowledge_reset_requests',
]);

const PRESERVED_SCHEMAS = new Set(['ai', 'auth', 'frontend_ask', 'runtime']);

const REBUILD_SCHEMAS = new Set(['frontend_knowledge_graph']);

const SOURCE_DERIVED_TABLE_OVERRIDES = new Set([
  'ai.provider_calls',
  'ai.provider_outputs',
  'asset.sources',
  'asset.storage_receipts',
  'asset.staging_asset_leases',
  'frontend_knowledge_draft.drafts',
  'frontend_knowledge_draft.revisions',
  'frontend_knowledge_draft.operations',
  'frontend_knowledge_draft.materializations',
  'frontend_knowledge_draft.artifact_refs',
  'projection.search_documents',
]);

const REBUILD_TABLES = new Set([
  'frontend_activity.projection_watermarks',
  'frontend_history.history_projection_index',
  'frontend_history.projection_watermarks',
  'projection.compiled_truth',
  'projection.watermarks',
]);

const CONDITIONAL_TABLES = new Set([
  'canonical.history_payload_audit_events',
  'canonical.history_payload_state',
  'canonical.knowledge_reset_events',
  'canonical.project_state',
  'frontend_review.history_payload_audit_events',
  'frontend_review.history_payload_state',
  'knowledge.entity_vault_imports',
  'knowledge.review_groups',
  'project_admin.project_commands',
  'projection.discovery_inferences',
  'projection.semantic_generation_pointers',
  'projection.semantic_generations',
  'projection.semantic_items',
  'settings.settings_commands',
  'settings.settings_review_proposals',
]);

const PRESERVED_TABLES = new Set([
  'action.action_feedback_outbox',
  'action.action_review_work_items',
  'action.approval_records',
  'action.approvals',
  'action.audit_events',
  'action.candidates',
  'action.executions',
  'action.preview_snapshots',
  'canonical.knowledge_reset_events',
  'discovery.model_profiles',
  'discovery.ranking_policy_revisions',
  'discovery.schedules',
  'frontend_external_action.budgets',
  'frontend_external_action.credentials',
  'projection.semantic_embedding_profiles',
]);

const quoteIdentifier = (identifier: string): string => `"${identifier.replaceAll('"', '""')}"`;

const classifyTable = (schemaName: string, tableName: string): TableClassification | null => {
  const relation = `${schemaName}.${tableName}`;
  if (PRESERVED_TABLES.has(relation)) return 'PRESERVE';
  if (REBUILD_TABLES.has(relation)) return 'REBUILD';
  if (CONDITIONAL_TABLES.has(relation)) return 'CONDITIONAL';
  if (SOURCE_DERIVED_TABLE_OVERRIDES.has(relation)) return 'SOURCE_DERIVED';
  if (REBUILD_SCHEMAS.has(schemaName)) return 'REBUILD';
  if (PRESERVED_SCHEMAS.has(schemaName)) return 'PRESERVE';
  if (SOURCE_DERIVED_SCHEMAS.has(schemaName)) return 'SOURCE_DERIVED';
  if (CONDITIONAL_SCHEMAS.has(schemaName)) return 'CONDITIONAL';
  if (schemaName === 'asset') return 'PRESERVE';
  if (schemaName === 'ai') return 'PRESERVE';
  if (schemaName === 'project_admin') return 'PRESERVE';
  if (schemaName === 'settings') return 'PRESERVE';
  if (schemaName === 'projection') return 'CONDITIONAL';
  if (schemaName === 'frontend_activity' || schemaName === 'frontend_history') return 'REBUILD';
  if (schemaName === 'knowledge') return 'CONDITIONAL';
  return null;
};

const digest = (value: string): `sha256:${string}` =>
  `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;

const relationScopeSnapshot = async (
  pool: Pool,
  input: ScopeRow & { readonly projectId: string; readonly classification: TableClassification },
): Promise<ScopeSnapshot> => {
  const relation = `${quoteIdentifier(input.schema_name)}.${quoteIdentifier(input.table_name)}`;
  const result = await pool.query<{ row_count: string; fingerprint: string }>(
    `SELECT count(*)::text AS row_count,
            encode(pg_catalog.sha256(convert_to(
              COALESCE(string_agg(
                encode(pg_catalog.sha256(convert_to(to_jsonb(scoped)::text, 'UTF8')), 'hex'),
                '' ORDER BY to_jsonb(scoped)::text
              ), ''), 'UTF8')), 'hex') AS fingerprint
       FROM ${relation} AS scoped
      WHERE scoped.project_id = $1`,
    [input.projectId],
  );
  const row = result.rows[0];
  if (!row)
    throw new Error(
      `T3 impact query returned no aggregate for ${input.schema_name}.${input.table_name}.`,
    );
  return {
    relation: `${input.schema_name}.${input.table_name}`,
    classification: input.classification,
    rowCount: Number(row.row_count),
    fingerprint: row.fingerprint,
  };
};

const sourceAiSnapshot = async (pool: Pool, projectId: string) => {
  const result = await pool.query<{
    provider_calls: string;
    provider_attempts: string;
    provider_outputs: string;
    active_work: string;
    unresolved_records: string;
    derived_records: string;
    fingerprint: string;
  }>(
    `WITH valid_calls AS MATERIALIZED (
       SELECT call.*
       FROM ai.provider_calls AS call
       JOIN asset.source_versions AS version
         ON version.source_version_id = call.source_version_id
       JOIN asset.sources AS source
         ON source.source_id = version.source_id AND source.project_id = $1
       JOIN transformation.revisions AS revision
         ON revision.project_id = $1
        AND revision.source_version_id = version.source_version_id
        AND revision.revision_id = call.revision_id
       WHERE call.project_id = $1
         AND call.schema_name = 'ClaimCandidateBatch.v1'
         AND call.source_version_id IS NOT NULL
         AND call.revision_id IS NOT NULL
         AND cardinality(call.input_evidence_ids) > 0
         AND NOT EXISTS (
           SELECT 1
           FROM unnest(call.input_evidence_ids) AS input(evidence_id)
           LEFT JOIN evidence.spans AS span
             ON span.evidence_id = input.evidence_id
            AND span.project_id = $1
            AND span.source_version_id = version.source_version_id
            AND span.revision_id = revision.revision_id
           WHERE span.evidence_id IS NULL
         )
     ), source_attempts AS MATERIALIZED (
       SELECT attempt.*
       FROM ai.provider_attempts AS attempt
       JOIN valid_calls AS call USING (call_id)
     ), source_outputs AS MATERIALIZED (
       SELECT output.*
       FROM ai.provider_outputs AS output
       JOIN valid_calls AS call USING (call_id)
       JOIN ai.provider_attempts AS attempt
         ON attempt.attempt_id = output.attempt_id AND attempt.call_id = call.call_id
       WHERE output.project_id = $1
     ), scope_rows AS (
       SELECT 'provider_calls'::text AS table_name, to_jsonb(call)::text AS row_data
       FROM valid_calls AS call
       UNION ALL
       SELECT 'provider_attempts', to_jsonb(attempt)::text FROM source_attempts AS attempt
       UNION ALL
       SELECT 'provider_outputs', to_jsonb(output)::text FROM source_outputs AS output
     )
     SELECT
       (SELECT count(*)::text FROM valid_calls) AS provider_calls,
       (SELECT count(*)::text FROM source_attempts) AS provider_attempts,
       (SELECT count(*)::text FROM source_outputs) AS provider_outputs,
       (SELECT count(*) FROM valid_calls
          WHERE durable_state IN (
            'REQUESTED', 'PROVIDER_RUNNING', 'OUTPUT_MATERIALIZED',
            'MATERIALIZATION_FAILED', 'OUTCOME_UNKNOWN'
          ))
        + (SELECT count(*) FROM source_attempts
          WHERE status IN ('running', 'outcome_unknown')
             OR lease_expires_at > clock_timestamp()) AS active_work,
       (SELECT count(*) FROM ai.provider_calls AS call
          WHERE call.project_id = $1
            AND NOT EXISTS (SELECT 1 FROM valid_calls AS valid WHERE valid.call_id = call.call_id))
        + (SELECT count(*) FROM ai.provider_attempts AS attempt
          JOIN ai.provider_calls AS call USING (call_id)
          WHERE call.project_id = $1
            AND NOT EXISTS (SELECT 1 FROM valid_calls AS valid WHERE valid.call_id = call.call_id))
        + (SELECT count(*) FROM ai.provider_outputs AS output
         WHERE output.project_id = $1
            AND NOT EXISTS (
              SELECT 1
              FROM valid_calls AS valid
              JOIN ai.provider_attempts AS attempt
                ON attempt.attempt_id = output.attempt_id AND attempt.call_id = valid.call_id
              WHERE valid.call_id = output.call_id
            )) AS unresolved_records,
       (SELECT count(*)::text FROM scope_rows) AS derived_records,
       encode(pg_catalog.sha256(convert_to(COALESCE((
         SELECT string_agg(
           encode(pg_catalog.sha256(convert_to(table_name || E'\\t' || row_data, 'UTF8')), 'hex'),
           '' ORDER BY table_name, row_data
         ) FROM scope_rows
       ), ''), 'UTF8')), 'hex') AS fingerprint`,
    [projectId],
  );
  const row = result.rows[0];
  if (!row) throw new Error('T3 AI provider impact query returned no aggregate.');
  return {
    providerCallCount: Number(row.provider_calls),
    providerAttemptCount: Number(row.provider_attempts),
    providerOutputCount: Number(row.provider_outputs),
    activeWorkCount: Number(row.active_work),
    unresolvedRecordCount: Number(row.unresolved_records),
    derivedRecordCount: Number(row.derived_records),
    fingerprint: row.fingerprint,
  };
};

const sourceAskSnapshot = async (pool: Pool, projectId: string) => {
  const result = await pool.query<{
    affected_conversations: string;
    answer_runs: string;
    active_answer_runs: string;
    active_attempts: string;
    unresolved_evidence: string;
    derived_records: string;
    fingerprint: string;
  }>(
    `WITH affected_conversations AS MATERIALIZED (
       SELECT DISTINCT answer_run.conversation_id
       FROM frontend_ask.source_selections AS selection
       JOIN frontend_ask.answer_runs AS answer_run
         ON answer_run.answer_run_id = selection.answer_run_id
        AND answer_run.project_id = selection.project_id
       WHERE selection.project_id = $1
         AND EXISTS (
           SELECT 1 FROM asset.sources AS source
           WHERE source.project_id = $1 AND source.source_id = selection.source_id
         )
       UNION
       SELECT DISTINCT answer_run.conversation_id
       FROM frontend_ask.citations AS citation
       JOIN frontend_ask.statements AS statement
         ON statement.statement_id = citation.statement_id
       JOIN frontend_ask.answer_runs AS answer_run
         ON answer_run.answer_run_id = statement.answer_run_id
       JOIN asset.source_versions AS version
         ON version.source_id = citation.source_id
        AND version.source_version_id = citation.source_version_id
       JOIN asset.sources AS source
         ON source.source_id = version.source_id AND source.project_id = $1
       WHERE answer_run.project_id = $1
       UNION
       SELECT DISTINCT answer_run.conversation_id
       FROM frontend_ask.answer_attempt_evidence AS evidence
       JOIN frontend_ask.answer_run_attempts AS attempt
         ON attempt.attempt_id = evidence.attempt_id
       JOIN frontend_ask.answer_runs AS answer_run
         ON answer_run.project_id = attempt.project_id
        AND answer_run.answer_run_id = attempt.answer_run_id
       JOIN asset.sources AS source
         ON source.project_id = $1 AND source.source_id::text = evidence.source_id
       JOIN asset.source_versions AS version
         ON version.source_id = source.source_id
        AND version.source_version_id::text = evidence.source_version_id
       WHERE answer_run.project_id = $1
     ), affected_runs AS MATERIALIZED (
       SELECT answer_run.*
       FROM frontend_ask.answer_runs AS answer_run
       JOIN affected_conversations AS affected USING (conversation_id)
       WHERE answer_run.project_id = $1
     ), scope_rows AS (
       SELECT 'conversations'::text AS table_name, to_jsonb(row_data)::text AS row_data
       FROM frontend_ask.conversations AS row_data
       JOIN affected_conversations AS affected USING (conversation_id)
       UNION ALL
       SELECT 'branches', to_jsonb(row_data)::text
       FROM frontend_ask.branches AS row_data
       JOIN affected_conversations AS affected USING (conversation_id)
       UNION ALL
       SELECT 'turns', to_jsonb(row_data)::text
       FROM frontend_ask.turns AS row_data
       JOIN affected_conversations AS affected USING (conversation_id)
       UNION ALL
       SELECT 'answer_runs', to_jsonb(row_data)::text FROM affected_runs AS row_data
       UNION ALL
       SELECT 'source_selections', to_jsonb(row_data)::text
       FROM frontend_ask.source_selections AS row_data
       JOIN affected_runs AS answer_run USING (answer_run_id)
       UNION ALL
       SELECT 'source_selection_evidence', to_jsonb(row_data)::text
       FROM frontend_ask.source_selection_evidence AS row_data
       JOIN frontend_ask.source_selections AS selection USING (selection_id)
       JOIN affected_runs AS answer_run USING (answer_run_id)
       UNION ALL
       SELECT 'statements', to_jsonb(row_data)::text
       FROM frontend_ask.statements AS row_data
       JOIN affected_runs AS answer_run USING (answer_run_id)
       UNION ALL
       SELECT 'citations', to_jsonb(row_data)::text
       FROM frontend_ask.citations AS row_data
       JOIN frontend_ask.statements AS statement USING (statement_id)
       JOIN affected_runs AS answer_run USING (answer_run_id)
       UNION ALL
       SELECT 'answer_run_attempts', to_jsonb(row_data)::text
       FROM frontend_ask.answer_run_attempts AS row_data
       JOIN affected_runs AS answer_run USING (answer_run_id, project_id)
       UNION ALL
       SELECT 'answer_attempt_evidence', to_jsonb(row_data)::text
       FROM frontend_ask.answer_attempt_evidence AS row_data
       JOIN frontend_ask.answer_run_attempts AS attempt USING (attempt_id)
       JOIN affected_runs AS answer_run USING (answer_run_id, project_id)
       UNION ALL
       SELECT 'answer_run_events', to_jsonb(row_data)::text
       FROM frontend_ask.answer_run_events AS row_data
       JOIN affected_runs AS answer_run USING (answer_run_id, project_id)
       UNION ALL
       SELECT 'answer_exports', to_jsonb(row_data)::text
       FROM frontend_ask.answer_exports AS row_data
       JOIN affected_runs AS answer_run USING (answer_run_id, project_id)
       UNION ALL
       SELECT 'answer_feedback', to_jsonb(row_data)::text
       FROM frontend_ask.answer_feedback AS row_data
       JOIN affected_runs AS answer_run USING (answer_run_id, project_id)
       UNION ALL
       SELECT 'transition_seeds', to_jsonb(row_data)::text
       FROM frontend_ask.transition_seeds AS row_data
       JOIN affected_runs AS answer_run USING (answer_run_id, project_id)
     )
     SELECT
       (SELECT count(*)::text FROM affected_conversations) AS affected_conversations,
       (SELECT count(*)::text FROM affected_runs) AS answer_runs,
       (SELECT count(*)::text FROM affected_runs
         WHERE state IN (
           'QUEUED', 'RUNNING', 'STREAMING', 'ACTION_REQUIRED', 'PARTIAL',
           'CANCEL_REQUESTED', 'OUTCOME_UNKNOWN'
         )) AS active_answer_runs,
       (SELECT count(*)::text
          FROM frontend_ask.answer_run_attempts AS attempt
          JOIN affected_runs AS answer_run
            ON answer_run.answer_run_id = attempt.answer_run_id
           AND answer_run.project_id = attempt.project_id
         WHERE attempt.state IN ('RUNNING', 'CANCEL_REQUESTED', 'OUTCOME_UNKNOWN')
            OR attempt.lease_expires_at > clock_timestamp()) AS active_attempts,
       (SELECT count(*)::text
          FROM frontend_ask.answer_attempt_evidence AS evidence
          JOIN frontend_ask.answer_run_attempts AS attempt
            ON attempt.attempt_id = evidence.attempt_id
          JOIN frontend_ask.answer_runs AS answer_run
            ON answer_run.project_id = attempt.project_id
           AND answer_run.answer_run_id = attempt.answer_run_id
         WHERE answer_run.project_id = $1
           AND NOT EXISTS (
             SELECT 1
             FROM asset.sources AS source
             JOIN asset.source_versions AS version USING (source_id)
             WHERE source.project_id = $1
               AND source.source_id::text = evidence.source_id
               AND version.source_version_id::text = evidence.source_version_id
           )) AS unresolved_evidence,
       (SELECT count(*)::text FROM scope_rows) AS derived_records,
       encode(pg_catalog.sha256(convert_to(COALESCE((
         SELECT string_agg(
           encode(pg_catalog.sha256(convert_to(table_name || E'\\t' || row_data, 'UTF8')), 'hex'),
           '' ORDER BY table_name, row_data
         ) FROM scope_rows
       ), ''), 'UTF8')), 'hex') AS fingerprint`,
    [projectId],
  );
  const row = result.rows[0];
  if (!row) throw new Error('T3 Ask impact query returned no aggregate.');
  return {
    affectedConversationCount: Number(row.affected_conversations),
    answerRunCount: Number(row.answer_runs),
    activeAnswerRunCount: Number(row.active_answer_runs),
    activeAttemptCount: Number(row.active_attempts),
    unresolvedEvidenceCount: Number(row.unresolved_evidence),
    derivedRecordCount: Number(row.derived_records),
    fingerprint: row.fingerprint,
  };
};

const sourceCommandSnapshot = async (pool: Pool, projectId: string) => {
  const result = await pool.query<{ impact: unknown }>(
    'SELECT frontend_command.t3_project_source_command_impact($1) AS impact',
    [projectId],
  );
  let value = result.rows[0]?.impact;
  if (typeof value === 'string') value = JSON.parse(value) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('T3 command impact query returned a malformed object.');
  }
  const snapshot = value as Record<string, unknown>;
  const numericKeys = [
    'sourceCommands',
    'askCommands',
    'activeCommands',
    'unclassifiedCommands',
    'derivedRecords',
  ] as const;
  if (
    Object.keys(snapshot).length !== numericKeys.length + 1 ||
    numericKeys.some(
      (key) =>
        typeof snapshot[key] !== 'number' ||
        !Number.isSafeInteger(snapshot[key]) ||
        (snapshot[key] as number) < 0,
    ) ||
    typeof snapshot.fingerprint !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(snapshot.fingerprint)
  ) {
    throw new Error('T3 command impact query returned malformed counts.');
  }
  return snapshot as Readonly<{
    sourceCommands: number;
    askCommands: number;
    activeCommands: number;
    unclassifiedCommands: number;
    derivedRecords: number;
    fingerprint: string;
  }>;
};

const sourceExternalActionSnapshot = async (
  pool: Pool,
  projectId: string,
): Promise<ExternalActionSnapshot> => {
  const result = await pool.query<{ impact: unknown }>(
    'SELECT frontend_external_action.t3_project_action_impact($1) AS impact',
    [projectId],
  );
  let value = result.rows[0]?.impact;
  if (typeof value === 'string') value = JSON.parse(value) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('T3 External Action impact query returned a malformed object.');
  }
  const impact = value as Record<string, unknown>;
  const numericKeys = [
    'actionCount',
    'linkedActionCount',
    'unclassifiedActionCount',
    'activeActionCount',
    'externalEffectActionCount',
    'derivedRecords',
    'redactedAuditRecords',
  ] as const;
  if (
    Object.keys(impact).length !== numericKeys.length + 1 ||
    numericKeys.some(
      (key) =>
        typeof impact[key] !== 'number' ||
        !Number.isSafeInteger(impact[key]) ||
        (impact[key] as number) < 0,
    ) ||
    typeof impact.fingerprint !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(impact.fingerprint)
  ) {
    throw new Error('T3 External Action impact query returned malformed counts.');
  }
  return impact as ExternalActionSnapshot;
};

const sourceActionSnapshot = async (pool: Pool, projectId: string): Promise<ActionSnapshot> => {
  const result = await pool.query<{ impact: unknown }>(
    'SELECT action.t3_project_action_impact($1) AS impact',
    [projectId],
  );
  let value = result.rows[0]?.impact;
  if (typeof value === 'string') value = JSON.parse(value) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('T3 Action impact query returned a malformed object.');
  }
  const impact = value as Record<string, unknown>;
  const numericKeys = [
    'candidateCount',
    'actionCount',
    'linkedCandidateCount',
    'linkedActionCount',
    'unclassifiedCandidateCount',
    'unclassifiedActionCount',
    'unclassifiedWorkItemCount',
    'activeActionCount',
    'externalEffectActionCount',
    'derivedRecords',
    'redactedAuditRecords',
  ] as const;
  if (
    Object.keys(impact).length !== numericKeys.length + 1 ||
    numericKeys.some(
      (key) =>
        typeof impact[key] !== 'number' ||
        !Number.isSafeInteger(impact[key]) ||
        (impact[key] as number) < 0,
    ) ||
    typeof impact.fingerprint !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(impact.fingerprint)
  ) {
    throw new Error('T3 Action impact query returned malformed counts.');
  }
  return impact as ActionSnapshot;
};

const sourceDiscoverySnapshot = async (
  pool: Pool,
  projectId: string,
): Promise<DiscoverySnapshot> => {
  const result = await pool.query<{ impact: unknown }>(
    'SELECT discovery.t3_project_discovery_impact($1) AS impact',
    [projectId],
  );
  let value = result.rows[0]?.impact;
  if (typeof value === 'string') value = JSON.parse(value) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('T3 Discovery impact query returned a malformed object.');
  }
  const impact = value as Record<string, unknown>;
  const numericKeys = [
    'derivedRecordCount',
    'activeJobCount',
    'activeProviderReservationCount',
    'pendingReentryCount',
    'unclassifiedRecordCount',
  ] as const;
  if (
    Object.keys(impact).length !== numericKeys.length + 1 ||
    numericKeys.some(
      (key) =>
        typeof impact[key] !== 'number' ||
        !Number.isSafeInteger(impact[key]) ||
        (impact[key] as number) < 0,
    ) ||
    typeof impact.fingerprint !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(impact.fingerprint)
  ) {
    throw new Error('T3 Discovery impact query returned malformed counts.');
  }
  return impact as DiscoverySnapshot;
};

const sourceKnowledgeDraftSnapshot = async (
  pool: Pool,
  projectId: string,
): Promise<KnowledgeDraftSnapshot> => {
  const result = await pool.query<{ impact: unknown }>(
    'SELECT frontend_knowledge_draft.t3_project_draft_impact($1) AS impact',
    [projectId],
  );
  let value = result.rows[0]?.impact;
  if (typeof value === 'string') value = JSON.parse(value) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('T3 Knowledge Draft impact query returned a malformed object.');
  }
  const impact = value as Record<string, unknown>;
  const numericKeys = [
    'sourceDerivedDraftCount',
    'sourceDerivedRecordCount',
    'preservedDraftCount',
    'unclassifiedRecordCount',
  ] as const;
  if (
    Object.keys(impact).length !== numericKeys.length + 1 ||
    numericKeys.some(
      (key) =>
        typeof impact[key] !== 'number' ||
        !Number.isSafeInteger(impact[key]) ||
        (impact[key] as number) < 0,
    ) ||
    typeof impact.fingerprint !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(impact.fingerprint)
  ) {
    throw new Error('T3 Knowledge Draft impact query returned malformed counts.');
  }
  return impact as KnowledgeDraftSnapshot;
};

const sourceReviewSnapshot = async (pool: Pool, projectId: string): Promise<ReviewSnapshot> => {
  const result = await pool.query<{ impact: unknown }>(
    'SELECT review.t3_project_review_impact($1) AS impact',
    [projectId],
  );
  let value = result.rows[0]?.impact;
  if (typeof value === 'string') value = JSON.parse(value) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('T3 Review impact query returned a malformed object.');
  }
  const impact = value as Record<string, unknown>;
  const numericKeys = [
    'sourceDerivedRecordCount',
    'preservedRecordCount',
    'redactedIdentityCount',
    'unclassifiedRecordCount',
  ] as const;
  if (
    Object.keys(impact).length !== numericKeys.length + 1 ||
    numericKeys.some(
      (key) =>
        typeof impact[key] !== 'number' ||
        !Number.isSafeInteger(impact[key]) ||
        (impact[key] as number) < 0,
    ) ||
    typeof impact.fingerprint !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(impact.fingerprint)
  ) {
    throw new Error('T3 Review impact query returned malformed counts.');
  }
  return impact as ReviewSnapshot;
};

const sourceProjectionSnapshot = async (
  pool: Pool,
  projectId: string,
): Promise<ProjectionSnapshot> => {
  const result = await pool.query<{ impact: unknown }>(
    'SELECT projection.t3_project_projection_impact($1) AS impact',
    [projectId],
  );
  let value = result.rows[0]?.impact;
  if (typeof value === 'string') value = JSON.parse(value) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('T3 projection impact query returned a malformed object.');
  }
  const impact = value as Record<string, unknown>;
  if (
    typeof impact.projectionRecordCount !== 'number' ||
    !Number.isSafeInteger(impact.projectionRecordCount) ||
    impact.projectionRecordCount < 0 ||
    typeof impact.activeGenerationCount !== 'number' ||
    !Number.isSafeInteger(impact.activeGenerationCount) ||
    impact.activeGenerationCount < 0 ||
    typeof impact.fingerprint !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(impact.fingerprint)
  ) {
    throw new Error('T3 projection impact query returned malformed counts.');
  }
  return {
    projectionRecordCount: impact.projectionRecordCount,
    activeGenerationCount: impact.activeGenerationCount,
    fingerprint: impact.fingerprint,
  };
};

const sourceCanonicalSnapshot = async (
  pool: Pool,
  projectId: string,
): Promise<CanonicalSnapshot> => {
  const result = await pool.query<{ impact: unknown }>(
    'SELECT canonical.t3_project_canonical_impact($1) AS impact',
    [projectId],
  );
  let value = result.rows[0]?.impact;
  if (typeof value === 'string') value = JSON.parse(value) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('T3 Canonical impact query returned a malformed object.');
  }
  const impact = value as Record<string, unknown>;
  const numericKeys = [
    'sourceDerivedRecordCount',
    'unclassifiedRecordCount',
    'redactedIdentityCount',
    'activeOutboxCount',
    'canonicalVersion',
  ] as const;
  if (
    Object.keys(impact).length !== numericKeys.length + 2 ||
    numericKeys.some(
      (key) =>
        typeof impact[key] !== 'number' ||
        !Number.isSafeInteger(impact[key]) ||
        (impact[key] as number) < 0,
    ) ||
    typeof impact.fingerprint !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(impact.fingerprint) ||
    (impact.canonicalSnapshotDigest !== null &&
      (typeof impact.canonicalSnapshotDigest !== 'string' ||
        !/^sha256:[0-9a-f]{64}$/u.test(impact.canonicalSnapshotDigest)))
  ) {
    throw new Error('T3 Canonical impact query returned malformed counts or digests.');
  }
  return impact as CanonicalSnapshot;
};

const sourceActivitySnapshot = async (pool: Pool, projectId: string): Promise<ActivitySnapshot> => {
  const result = await pool.query<{ impact: unknown }>(
    'SELECT frontend_activity.t3_project_activity_impact($1) AS impact',
    [projectId],
  );
  let value = result.rows[0]?.impact;
  if (typeof value === 'string') value = JSON.parse(value) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('T3 Activity impact query returned a malformed object.');
  }
  const impact = value as Record<string, unknown>;
  const numericKeys = [
    'activityRecordCount',
    'watermarkCount',
    'sourceDomainRecordCount',
    'snapshotRevision',
  ] as const;
  if (
    Object.keys(impact).length !== numericKeys.length + 1 ||
    numericKeys.some(
      (key) =>
        typeof impact[key] !== 'number' ||
        !Number.isSafeInteger(impact[key]) ||
        (impact[key] as number) < 0,
    ) ||
    typeof impact.fingerprint !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(impact.fingerprint)
  ) {
    throw new Error('T3 Activity impact query returned malformed counts or fingerprint.');
  }
  return impact as ActivitySnapshot;
};

const sourceHistorySnapshot = async (pool: Pool, projectId: string): Promise<HistorySnapshot> => {
  const result = await pool.query<{ impact: unknown }>(
    'SELECT frontend_history.t3_project_history_impact($1) AS impact',
    [projectId],
  );
  let value = result.rows[0]?.impact;
  if (typeof value === 'string') value = JSON.parse(value) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('T3 History impact query returned a malformed object.');
  }
  const impact = value as Record<string, unknown>;
  const numericKeys = ['historyRecordCount', 'watermarkCount', 'snapshotRevision'] as const;
  if (
    Object.keys(impact).length !== numericKeys.length + 1 ||
    numericKeys.some(
      (key) =>
        typeof impact[key] !== 'number' ||
        !Number.isSafeInteger(impact[key]) ||
        (impact[key] as number) < 0,
    ) ||
    typeof impact.fingerprint !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(impact.fingerprint)
  ) {
    throw new Error('T3 History impact query returned malformed counts or fingerprint.');
  }
  return impact as HistorySnapshot;
};

const sourceKnowledgeModelSnapshot = async (
  pool: Pool,
  projectId: string,
): Promise<KnowledgeModelSnapshot> => {
  const result = await pool.query<{ impact: unknown }>(
    'SELECT knowledge.t3_project_knowledge_impact($1) AS impact',
    [projectId],
  );
  let value = result.rows[0]?.impact;
  if (typeof value === 'string') value = JSON.parse(value) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('T3 Knowledge Model impact query returned a malformed object.');
  }
  const impact = value as Record<string, unknown>;
  if (
    Object.keys(impact).length !== 3 ||
    ['sourceDerivedRecordCount', 'unclassifiedRecordCount'].some(
      (key) =>
        typeof impact[key] !== 'number' ||
        !Number.isSafeInteger(impact[key]) ||
        (impact[key] as number) < 0,
    ) ||
    typeof impact.fingerprint !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(impact.fingerprint)
  ) {
    throw new Error('T3 Knowledge Model impact query returned malformed counts or fingerprint.');
  }
  return impact as KnowledgeModelSnapshot;
};

const sourceConnectorSnapshot = async (
  pool: Pool,
  projectId: string,
): Promise<ConnectorSnapshot> => {
  const result = await pool.query<{ impact: unknown }>(
    'SELECT connector.t3_project_connector_impact($1) AS impact',
    [projectId],
  );
  let value = result.rows[0]?.impact;
  if (typeof value === 'string') value = JSON.parse(value) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('T3 Connector impact query returned a malformed object.');
  }
  const impact = value as Record<string, unknown>;
  const numericKeys = [
    'sourceDerivedRecordCount',
    'unclassifiedRecordCount',
    'activeJobCount',
  ] as const;
  if (
    Object.keys(impact).length !== numericKeys.length + 1 ||
    numericKeys.some(
      (key) =>
        typeof impact[key] !== 'number' ||
        !Number.isSafeInteger(impact[key]) ||
        (impact[key] as number) < 0,
    ) ||
    typeof impact.fingerprint !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(impact.fingerprint)
  ) {
    throw new Error('T3 Connector impact query returned malformed counts.');
  }
  return impact as ConnectorSnapshot;
};

const sourceSettingsSnapshot = async (pool: Pool, projectId: string): Promise<SettingsSnapshot> => {
  const result = await pool.query<{ impact: unknown }>(
    'SELECT settings.t3_project_settings_impact($1) AS impact',
    [projectId],
  );
  let value = result.rows[0]?.impact;
  if (typeof value === 'string') value = JSON.parse(value) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('T3 Settings impact query returned a malformed object.');
  }
  const impact = value as Record<string, unknown>;
  if (
    Object.keys(impact).length !== 4 ||
    ['sourceDerivedRecordCount', 'unclassifiedRecordCount'].some(
      (key) =>
        typeof impact[key] !== 'number' ||
        !Number.isSafeInteger(impact[key]) ||
        (impact[key] as number) < 0,
    ) ||
    typeof impact.fingerprint !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(impact.fingerprint) ||
    typeof impact.proposalsFingerprint !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(impact.proposalsFingerprint)
  ) {
    throw new Error('T3 Settings impact query returned malformed counts.');
  }
  return impact as SettingsSnapshot;
};

const sourceAssetSnapshot = async (pool: Pool, projectId: string) => {
  const result = await pool.query<{
    source_count: string;
    version_count: string;
    shared_asset_count: string;
    version_fingerprint: string;
    active_lease_count: string;
    active_intake_count: string;
  }>(
    `WITH selected_sources AS (
       SELECT source_id FROM asset.sources WHERE project_id = $1
     ), selected_versions AS (
       SELECT version.*
       FROM asset.source_versions AS version
       JOIN selected_sources AS source USING (source_id)
     )
     SELECT
       (SELECT count(*) FROM selected_sources)::text AS source_count,
       (SELECT count(*) FROM selected_versions)::text AS version_count,
       (SELECT count(DISTINCT version.original_asset_id)
          FROM selected_versions AS version
         WHERE EXISTS (
           SELECT 1
           FROM asset.source_versions AS other_version
           JOIN asset.sources AS other_source USING (source_id)
           WHERE other_version.original_asset_id = version.original_asset_id
             AND other_source.project_id <> $1
         ))::text AS shared_asset_count,
       (SELECT encode(pg_catalog.sha256(convert_to(
          COALESCE(string_agg(
            encode(pg_catalog.sha256(convert_to(to_jsonb(version)::text, 'UTF8')), 'hex'),
            '' ORDER BY to_jsonb(version)::text
          ), ''), 'UTF8')), 'hex')
          FROM selected_versions AS version) AS version_fingerprint,
       (SELECT count(*) FROM asset.staging_asset_leases
         WHERE project_id = $1 AND expires_at > clock_timestamp())::text AS active_lease_count,
       (SELECT count(*) FROM source_product.intake_submissions
         WHERE project_id = $1
           AND state NOT IN ('SUCCEEDED', 'FAILED', 'CANCELLED'))::text AS active_intake_count`,
    [projectId],
  );
  const row = result.rows[0];
  if (!row) throw new Error('T3 source asset impact query returned no aggregate.');
  return {
    sourceCount: Number(row.source_count),
    sourceVersionCount: Number(row.version_count),
    sharedAssetCount: Number(row.shared_asset_count),
    versionFingerprint: row.version_fingerprint,
    activeLeaseCount: Number(row.active_lease_count),
    activeIntakeCount: Number(row.active_intake_count),
  };
};

/**
 * Read-only T3 preview classifier. It hashes row snapshots in PostgreSQL so
 * source text, filenames, URLs, credentials, and payloads never cross this
 * adapter boundary. Conditional rows stay blockers until their owner-specific
 * lineage and purge/readback implementation is installed.
 */
export class PostgresKnowledgeResetImpactInspector implements KnowledgeResetImpactPort {
  constructor(
    private readonly pool: Pool,
    private readonly ownerExecutionReady = false,
  ) {}

  async inspectProjectSourceKnowledge(projectId: string): Promise<{
    counts: KnowledgeResetImpactCountsV1;
    blockers: readonly KnowledgeResetBlockerCodeV1[];
    manifestDigest: `sha256:${string}`;
  }> {
    const blockers = new Set<KnowledgeResetBlockerCodeV1>();
    const tableResult = await this.pool.query<ScopeRow>(
      `SELECT namespace.nspname AS schema_name, relation.relname AS table_name
         FROM pg_class AS relation
         JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE relation.relkind IN ('r', 'p')
          AND namespace.nspname = ANY($1::text[])
        ORDER BY namespace.nspname, relation.relname`,
      [[...MANAGED_SCHEMAS].sort()],
    );
    const tableIdentities = tableResult.rows.map((row) => `${row.schema_name}.${row.table_name}`);
    const tableDigest = digest(tableIdentities.join('\n')).slice('sha256:'.length);
    if (tableIdentities.length !== EXPECTED_TABLE_COUNT || tableDigest !== EXPECTED_TABLE_DIGEST) {
      blockers.add('UNCLASSIFIED_CONTENT');
    }

    const columnResult = await this.pool.query<{ identity: string }>(
      `SELECT namespace.nspname || '.' || relation.relname || '.' || attribute.attname || E'\t' ||
              format_type(attribute.atttypid, attribute.atttypmod) AS identity
         FROM pg_attribute AS attribute
         JOIN pg_class AS relation ON relation.oid = attribute.attrelid
         JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = ANY($1::text[])
          AND attribute.atttypid IN ('json'::regtype, 'jsonb'::regtype, 'bytea'::regtype)
          AND attribute.attnum > 0 AND NOT attribute.attisdropped
        ORDER BY identity`,
      [[...MANAGED_SCHEMAS].sort()],
    );
    const contentColumnDigest = digest(
      columnResult.rows.map((row) => row.identity).join('\n'),
    ).slice('sha256:'.length);
    if (
      columnResult.rows.length !== EXPECTED_CONTENT_COLUMN_COUNT ||
      contentColumnDigest !== EXPECTED_CONTENT_COLUMN_DIGEST
    ) {
      blockers.add('UNCLASSIFIED_CONTENT');
    }

    const projectIdRelations = await this.pool.query<ScopeRow>(
      `SELECT namespace.nspname AS schema_name, relation.relname AS table_name
         FROM pg_attribute AS attribute
         JOIN pg_class AS relation ON relation.oid = attribute.attrelid
         JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = ANY($1::text[])
          AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND attribute.attname = 'project_id'
          AND attribute.attnum > 0 AND NOT attribute.attisdropped
        ORDER BY namespace.nspname, relation.relname`,
      [[...MANAGED_SCHEMAS].sort()],
    );
    const scopedSnapshots: ScopeSnapshot[] = [];
    for (const relation of projectIdRelations.rows) {
      if (RESET_CONTROL_TABLES.has(`${relation.schema_name}.${relation.table_name}`)) continue;
      if (OWNER_CLASSIFIED_SCHEMAS.has(relation.schema_name)) continue;
      if (OWNER_CLASSIFIED_TABLES.has(`${relation.schema_name}.${relation.table_name}`)) continue;
      // Every authenticated Product API request appends REQUEST_AUTHORIZED before
      // its route runs. Auth audit history is preserved and carries no Source
      // knowledge, so including it would make Preview stale on its own Confirm
      // request. Membership and credential state remain covered by the preserved
      // configuration fingerprint.
      if (relation.schema_name === 'auth' && relation.table_name === 'audit_events') continue;
      if (!MANAGED_SCHEMAS.has(relation.schema_name)) {
        blockers.add('UNCLASSIFIED_CONTENT');
        continue;
      }
      const classification = classifyTable(relation.schema_name, relation.table_name);
      if (classification === null) {
        blockers.add('UNCLASSIFIED_CONTENT');
        continue;
      }
      const snapshot = await relationScopeSnapshot(this.pool, {
        ...relation,
        projectId,
        classification,
      });
      scopedSnapshots.push(snapshot);
      if (snapshot.rowCount === 0 || snapshot.classification === 'PRESERVE') continue;
      if (snapshot.classification === 'CONDITIONAL') {
        blockers.add('UNCLASSIFIED_CONTENT');
      }
      if (
        !this.ownerExecutionReady &&
        (snapshot.classification === 'REDACT' || snapshot.classification === 'REBUILD')
      ) {
        blockers.add('ERASURE_EXECUTOR_UNAVAILABLE');
      }
    }

    const assets = await sourceAssetSnapshot(this.pool, projectId);
    const ask = await sourceAskSnapshot(this.pool, projectId);
    const ai = await sourceAiSnapshot(this.pool, projectId);
    const commands = await sourceCommandSnapshot(this.pool, projectId);
    const externalAction = await sourceExternalActionSnapshot(this.pool, projectId);
    const action = await sourceActionSnapshot(this.pool, projectId);
    const discovery = await sourceDiscoverySnapshot(this.pool, projectId);
    const knowledgeDrafts = await sourceKnowledgeDraftSnapshot(this.pool, projectId);
    const review = await sourceReviewSnapshot(this.pool, projectId);
    const projection = await sourceProjectionSnapshot(this.pool, projectId);
    const canonical = await sourceCanonicalSnapshot(this.pool, projectId);
    const activity = await sourceActivitySnapshot(this.pool, projectId);
    const history = await sourceHistorySnapshot(this.pool, projectId);
    const knowledgeModel = await sourceKnowledgeModelSnapshot(this.pool, projectId);
    const connector = await sourceConnectorSnapshot(this.pool, projectId);
    const settings = await sourceSettingsSnapshot(this.pool, projectId);
    if (
      assets.activeLeaseCount > 0 ||
      assets.activeIntakeCount > 0 ||
      ask.activeAnswerRunCount > 0 ||
      ask.activeAttemptCount > 0 ||
      ai.activeWorkCount > 0 ||
      commands.activeCommands > 0 ||
      externalAction.activeActionCount > 0 ||
      action.activeActionCount > 0 ||
      discovery.activeJobCount > 0 ||
      discovery.activeProviderReservationCount > 0 ||
      discovery.pendingReentryCount > 0 ||
      projection.activeGenerationCount > 0 ||
      canonical.activeOutboxCount > 0 ||
      connector.activeJobCount > 0
    ) {
      blockers.add('ACTIVE_JOB_OUTCOME_UNKNOWN');
    }
    if (externalAction.externalEffectActionCount > 0) {
      blockers.add('EXTERNAL_ACTION_DEPENDENCY');
    }
    if (action.externalEffectActionCount > 0) {
      blockers.add('EXTERNAL_ACTION_DEPENDENCY');
    }
    if (
      ask.unresolvedEvidenceCount > 0 ||
      ai.unresolvedRecordCount > 0 ||
      commands.unclassifiedCommands > 0 ||
      externalAction.unclassifiedActionCount > 0 ||
      action.unclassifiedCandidateCount > 0 ||
      action.unclassifiedActionCount > 0 ||
      action.unclassifiedWorkItemCount > 0 ||
      discovery.unclassifiedRecordCount > 0 ||
      knowledgeDrafts.unclassifiedRecordCount > 0 ||
      review.unclassifiedRecordCount > 0 ||
      canonical.unclassifiedRecordCount > 0 ||
      knowledgeModel.unclassifiedRecordCount > 0 ||
      connector.unclassifiedRecordCount > 0 ||
      settings.unclassifiedRecordCount > 0
    ) {
      blockers.add('UNCLASSIFIED_CONTENT');
    }
    if (!this.ownerExecutionReady) blockers.add('ERASURE_EXECUTOR_UNAVAILABLE');

    const sourceDerivedRecordCount =
      scopedSnapshots.reduce(
        (count, snapshot) =>
          snapshot.classification === 'SOURCE_DERIVED' &&
          snapshot.relation !== 'ai.provider_calls' &&
          snapshot.relation !== 'ai.provider_outputs' &&
          snapshot.relation !== 'asset.sources' &&
          snapshot.relation !== 'asset.source_versions'
            ? count + snapshot.rowCount
            : count,
        0,
      ) +
      ask.derivedRecordCount +
      ai.derivedRecordCount +
      commands.derivedRecords +
      externalAction.derivedRecords +
      action.derivedRecords +
      knowledgeDrafts.sourceDerivedRecordCount +
      review.sourceDerivedRecordCount +
      canonical.sourceDerivedRecordCount +
      knowledgeModel.sourceDerivedRecordCount +
      connector.sourceDerivedRecordCount +
      settings.sourceDerivedRecordCount;
    const redactedHistoryRecordCount =
      scopedSnapshots
        .filter((snapshot) => snapshot.classification === 'REDACT')
        .reduce((count, snapshot) => count + snapshot.rowCount, 0) +
      action.redactedAuditRecords +
      review.redactedIdentityCount +
      canonical.redactedIdentityCount;
    const rebuildProjectionCount =
      scopedSnapshots
        .filter((snapshot) => snapshot.classification === 'REBUILD')
        .reduce((count, snapshot) => count + snapshot.rowCount, 0) +
      projection.projectionRecordCount +
      activity.activityRecordCount +
      activity.watermarkCount +
      history.historyRecordCount +
      history.watermarkCount;
    const counts: KnowledgeResetImpactCountsV1 = {
      sourceCount: assets.sourceCount,
      sourceVersionCount: assets.sourceVersionCount,
      sourceDerivedRecordCount,
      redactedHistoryRecordCount,
      rebuildProjectionCount,
      sharedAssetCount: assets.sharedAssetCount,
      blockedRecordCount:
        scopedSnapshots
          .filter((snapshot) => snapshot.classification === 'CONDITIONAL')
          .reduce((count, snapshot) => count + snapshot.rowCount, 0) +
        assets.activeLeaseCount +
        assets.activeIntakeCount +
        ask.activeAnswerRunCount +
        ask.activeAttemptCount +
        ask.unresolvedEvidenceCount +
        ai.activeWorkCount +
        ai.unresolvedRecordCount +
        commands.activeCommands +
        commands.unclassifiedCommands +
        externalAction.activeActionCount +
        externalAction.externalEffectActionCount +
        externalAction.unclassifiedActionCount +
        action.activeActionCount +
        action.externalEffectActionCount +
        action.unclassifiedCandidateCount +
        action.unclassifiedActionCount +
        action.unclassifiedWorkItemCount +
        discovery.activeJobCount +
        discovery.activeProviderReservationCount +
        discovery.pendingReentryCount +
        discovery.unclassifiedRecordCount +
        projection.activeGenerationCount +
        knowledgeDrafts.unclassifiedRecordCount +
        review.unclassifiedRecordCount +
        canonical.unclassifiedRecordCount +
        canonical.activeOutboxCount +
        knowledgeModel.unclassifiedRecordCount +
        connector.unclassifiedRecordCount +
        connector.activeJobCount +
        settings.unclassifiedRecordCount,
    };
    const manifest = {
      schemaVersion: 't3-impact-manifest-v1',
      projectId,
      tableDigest,
      contentColumnDigest,
      assets,
      ask,
      ai,
      commands,
      externalAction,
      action,
      discovery,
      knowledgeDrafts,
      review,
      projection,
      canonical,
      activity,
      history,
      knowledgeModel,
      connector,
      settings,
      scopes: scopedSnapshots.map(({ relation, classification, rowCount, fingerprint }) => ({
        relation,
        classification,
        rowCount,
        fingerprint,
      })),
      counts,
      blockers: [...blockers].sort(),
    };
    return {
      counts,
      blockers: [...blockers].sort(),
      manifestDigest: digest(JSON.stringify(manifest)),
    };
  }
}
