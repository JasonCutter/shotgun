import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresDiscoveryKnowledgeResetOwner } from '../../adapters/source-knowledge-reset-postgres/src/index.js';
import { PostgresKnowledgeResetImpactInspector } from '../../adapters/source-knowledge-reset-postgres/src/impact-inspector.js';
import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';

const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const hash = (character: string): string => `sha256:${character.repeat(64)}`;

describe('ADR-171 Discovery erasure owner', () => {
  let database: Awaited<ReturnType<typeof createIsolatedPostgresTestDatabase>>;
  let adminPool: Pool;
  let executorPool: Pool;
  let owner: PostgresDiscoveryKnowledgeResetOwner;

  beforeAll(async () => {
    database = await createIsolatedPostgresTestDatabase();
    adminPool = database.createPool();
    const password = randomUUID();
    await adminPool.query(
      `ALTER ROLE shotgun_erasure_executor LOGIN PASSWORD ${literal(password)}`,
    );
    const connection = new URL(database.databaseUrl);
    connection.username = 'shotgun_erasure_executor';
    connection.password = password;
    executorPool = new Pool({ connectionString: connection.toString(), max: 1 });
    await executorPool.query('SELECT 1');
    owner = new PostgresDiscoveryKnowledgeResetOwner(executorPool);
  });

  afterAll(async () => {
    await executorPool?.end();
    await adminPool?.query('ALTER ROLE shotgun_erasure_executor NOLOGIN PASSWORD NULL');
    await database?.dispose();
  });

  const createProject = async (projectId: string) => {
    await adminPool.query(
      `INSERT INTO project_admin.projects (id, name, status, active)
       VALUES ($1, 'T3 Discovery fixture', 'ACTIVE', true)`,
      [projectId],
    );
  };

  const addDiscoveryRun = async (projectId: string, withFinding = true) => {
    const now = new Date().toISOString();
    const jobId = `job-${randomUUID()}`;
    const runId = `run-${randomUUID()}`;
    const initialAttemptId = `attempt-${randomUUID()}`;
    const retryAttemptId = `attempt-${randomUUID()}`;
    const snapshot = hash('a');
    const budget = JSON.stringify({ maxStages: 7 });
    await adminPool.query(
      `INSERT INTO discovery.jobs (
         project_id, job_id, logical_job_identity, logical_job_identity_version,
         schema_version, trigger_id, trigger_class, trigger, requested_scan_mode,
         effective_scan_mode, canonical_base_version, canonical_snapshot_digest,
         required_projection_revision, required_projection_digest, policy_revision,
         strategy_revision, budget_version, budget_id, budget_revision, budget,
         lifecycle_state, lifecycle_revision, created_at, updated_at
       ) VALUES ($1, $2, $3, 'discovery-job-logical:v1', '1.0.0', $4, 'MANUAL', '{}'::jsonb,
                 'INCREMENTAL', 'INCREMENTAL', 0, $5, NULL, NULL, 'policy-v1',
                 'strategy-v1', 'discovery-work-budget:v1', 'budget-v1', '1', $6::jsonb,
                 'SUCCEEDED', 1, $7, $7)`,
      [projectId, jobId, jobId, jobId, snapshot, budget, now],
    );
    await adminPool.query(
      `INSERT INTO discovery.runs (
         project_id, run_id, job_id, run_revision, schema_version,
         requested_scan_mode, effective_scan_mode, canonical_base_version,
         canonical_snapshot_digest, required_projection_revision, required_projection_digest,
         policy_revision, strategy_revision, budget_version, budget_id, budget_revision,
         budget, lifecycle_state, lifecycle_revision, created_at, updated_at, completed_at
       ) VALUES ($1, $2, $3, 1, '1.0.0', 'INCREMENTAL', 'INCREMENTAL', 0, $4,
                 NULL, NULL, 'policy-v1', 'strategy-v1', 'discovery-work-budget:v1',
                 'budget-v1', '1', $5::jsonb, 'SUCCEEDED', 1, $6, $6, $6)`,
      [projectId, runId, jobId, snapshot, budget, now],
    );
    await adminPool.query(
      `INSERT INTO discovery.attempts (
         project_id, attempt_id, run_id, job_id, attempt_number, lifecycle_revision,
         attempt_kind, lifecycle_state, previous_attempt_id, schema_version,
         created_at, updated_at, completed_at
       ) VALUES ($1, $2, $3, $4, 1, 1, 'INITIAL', 'SUCCEEDED', NULL, '1.0.0', $5, $5, $5),
                ($1, $6, $3, $4, 2, 1, 'DOMAIN_RETRY', 'SUCCEEDED', $2, '1.0.0', $5, $5, $5)`,
      [projectId, initialAttemptId, runId, jobId, now, retryAttemptId],
    );
    if (!withFinding) return { jobId, runId };

    const findingId = `finding-${randomUUID()}`;
    await adminPool.query(
      `INSERT INTO discovery.findings (
         schema_version, finding_id, finding_revision, project_id, finding_type, status,
         generation_method, lifecycle_state, payload, related_resource_refs, evidence_ids,
         source_projection_digest, canonical_base_version, canonical_snapshot_digest,
         discovery_projection_revision, discovery_projection_digest, run_id, signal_summary,
         rationale, derivation_summary, provenance, access_scope, sensitivity, fingerprint,
         fingerprint_version, retention_class, created_at
       ) VALUES ('1.0.0', $1, 1, $2, 'KNOWLEDGE_GAP', 'DERIVED_INFERENCE', 'DETERMINISTIC',
                 'NEW', '{}'::jsonb, '[]'::jsonb, ARRAY[]::text[], $3, 0, $4, 'projection-v1',
                 $5, $6, '{}'::jsonb, 'derived rationale', 'derived summary', '{}'::jsonb,
                 ARRAY['project:owner'], 'private', $7, 'finding-fingerprint:v1',
                 'DURABLE_DERIVED_RECORD', $8)`,
      [findingId, projectId, hash('b'), snapshot, hash('c'), runId, hash('d'), now],
    );
    await adminPool.query(
      `INSERT INTO discovery.finding_lifecycle_current (
         project_id, finding_id, finding_revision, lifecycle_state, lifecycle_revision, updated_at
       ) VALUES ($1, $2, 1, 'NEW', 1, $3)`,
      [projectId, findingId, now],
    );
    await adminPool.query(
      `INSERT INTO discovery.finding_lifecycle_history (
         project_id, finding_id, finding_revision, lifecycle_revision, from_state,
         to_state, cause, reason_code, canonical_base_version, canonical_snapshot_digest,
         discovery_projection_revision, discovery_projection_digest, occurred_at
       ) VALUES ($1, $2, 1, 1, NULL, 'NEW', 'MATERIALIZATION', 'FINDING_MATERIALIZED',
                 0, $3, 'projection-v1', $4, $5)`,
      [projectId, findingId, snapshot, hash('c'), now],
    );
    const feedbackId = `feedback-${randomUUID()}`;
    await adminPool.query(
      `INSERT INTO discovery.feedback_events (
         schema_version, feedback_id, project_id, finding_id, finding_revision,
         actor_type, actor_id, feedback_class, feedback_kind, reason, scope_kind, created_at
       ) VALUES ('1.0.0', $1, $2, $3, 1, 'user', 't3-test', 'EPISTEMIC',
                 'INCORRECT_RELATION', 'private feedback canary', 'FINDING', $4)`,
      [feedbackId, projectId, findingId, now],
    );
    const suppressionId = `suppression-${randomUUID()}`;
    await adminPool.query(
      `INSERT INTO discovery.suppression_directives (
         schema_version, suppression_id, project_id, actor_type, actor_id, source_finding_id,
         source_finding_revision, suppression_kind, scope_kind, matcher_kind, expires_at,
         created_at
       ) VALUES ('1.0.0', $1, $2, 'user', 't3-test', $3, 1, 'SNOOZE', 'FINDING',
                 'NONE', now() + interval '1 day', $4)`,
      [suppressionId, projectId, findingId, now],
    );
    await adminPool.query(
      `INSERT INTO discovery.suppression_semantic_family_projection (
         project_id, suppression_id, source_finding_id, source_finding_revision,
         semantic_family_key, created_at
       ) VALUES ($1, $2, $3, 1, 'family-canary', $4)`,
      [projectId, suppressionId, findingId, now],
    );
    return { jobId, runId, findingId, feedbackId, suppressionId };
  };

  const addConfiguration = async (projectId: string) => {
    const now = new Date().toISOString();
    await adminPool.query(
      `INSERT INTO discovery.model_profiles (
         schema_version, project_id, profile_id, profile_revision, ai_configuration_revision,
         provider_id, model_id, provider_registry_revision, model_capability_revision,
         prompt_version, output_schema_version, status, created_by, created_at
       ) VALUES ('1.0.0', $1, 'profile-t3', 1, 1, 'openai', 'model-t3', 'registry-v1',
                 'capability-v1', 'prompt-v1', 'output-v1', 'ACTIVE', 't3-test', $2)`,
      [projectId, now],
    );
    await adminPool.query(
      `INSERT INTO discovery.schedules (
         project_id, schedule_id, schedule_revision, status, timezone, day_of_week,
         local_time, next_occurrence_at, next_occurrence_key, updated_at
       ) VALUES ($1, 'schedule-t3', 1, 'ENABLED', 'Asia/Seoul', 1, '09:00',
                 now() + interval '1 day', 'occurrence-t3', now())`,
      [projectId],
    );
  };

  const createReset = async (projectId: string) => {
    const requestId = randomUUID();
    await adminPool.query(
      `INSERT INTO project_admin.project_knowledge_epoch (project_id, epoch, state)
       VALUES ($1, 1, 'RESET_PENDING')`,
      [projectId],
    );
    await adminPool.query(
      `INSERT INTO project_admin.project_knowledge_reset_requests (
         request_id, preview_id, project_id, actor_principal_id, project_revision,
         expected_knowledge_epoch, resulting_knowledge_epoch, manifest_digest,
         owner_manifest_digest, preserved_configuration_digest, idempotency_key,
         state, impact_counts
       ) VALUES ($1, $2, $3, 't3-discovery-test', 1, 0, 1, $4, $5, $6, $7,
                 'FENCING', '{}'::jsonb)`,
      [requestId, randomUUID(), projectId, hash('a'), hash('b'), hash('c'), randomUUID()],
    );
    return {
      projectId,
      requestId,
      knowledgeEpoch: 1,
      manifestDigest: hash('a') as `sha256:${string}`,
    };
  };

  const beginPurge = async (projectId: string, requestId: string) => {
    await executorPool.query(
      'SELECT project_admin.t3_set_reset_execution_state($1, $2::uuid, $3, $4::text[])',
      [projectId, requestId, 'PURGING', []],
    );
    await executorPool.query(`SELECT set_config('shotgun.t3_reset_request_id', $1, false)`, [
      requestId,
    ]);
  };

  it('purges stale findings, feedback, lifecycle, and suppression rows while preserving configuration', async () => {
    const projectId = `t3-discovery-${randomUUID()}`;
    await createProject(projectId);
    const rows = await addDiscoveryRun(projectId);
    await addConfiguration(projectId);
    const context = await createReset(projectId);

    await expect(
      adminPool.query('DELETE FROM discovery.feedback_events WHERE project_id = $1', [projectId]),
    ).rejects.toThrow('append-only');

    const before = await executorPool.query<{ impact: Record<string, unknown> }>(
      'SELECT discovery.t3_project_discovery_impact($1) AS impact',
      [projectId],
    );
    expect(Number(before.rows[0]?.impact.derivedRecordCount)).toBeGreaterThan(0);
    expect(Number(before.rows[0]?.impact.unclassifiedRecordCount)).toBe(0);
    const preview = await new PostgresKnowledgeResetImpactInspector(
      adminPool,
      true,
    ).inspectProjectSourceKnowledge(projectId);
    expect(preview.counts.sourceDerivedRecordCount).toBeGreaterThan(0);
    expect(preview.blockers).not.toContain('UNCLASSIFIED_CONTENT');
    await owner.fence(context);
    await beginPurge(projectId, context.requestId);
    await owner.purge(context);
    const result = await owner.verify(context);
    expect(result).toEqual({ verified: true, blockerCodes: [] });

    const counts = await adminPool.query<{
      derived: string;
      profiles: string;
      schedules: string;
      finding: string;
      feedback: string;
      suppression: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM discovery.findings WHERE project_id = $1) AS finding,
         (SELECT count(*)::text FROM discovery.feedback_events WHERE project_id = $1) AS feedback,
         (SELECT count(*)::text FROM discovery.suppression_directives WHERE project_id = $1) AS suppression,
         (SELECT count(*)::text FROM discovery.model_profiles WHERE project_id = $1) AS profiles,
         (SELECT count(*)::text FROM discovery.schedules WHERE project_id = $1) AS schedules,
         (SELECT (discovery.t3_project_discovery_impact($1)->>'derivedRecordCount')) AS derived`,
      [projectId],
    );
    expect(counts.rows[0]).toEqual({
      finding: '0',
      feedback: '0',
      suppression: '0',
      profiles: '1',
      schedules: '1',
      derived: '0',
    });
    expect(rows.findingId).toContain('finding-');
    expect(rows.feedbackId).toContain('feedback-');
    expect(rows.suppressionId).toContain('suppression-');
    await executorPool.query(`SELECT set_config('shotgun.t3_reset_request_id', '', false)`);
  });

  it('blocks active jobs and unresolved Evidence lineage without deleting records', async () => {
    const activeProject = `t3-discovery-active-${randomUUID()}`;
    await createProject(activeProject);
    await addDiscoveryRun(activeProject, false);
    await adminPool.query(
      `UPDATE discovery.jobs SET lifecycle_state = 'QUEUED' WHERE project_id = $1`,
      [activeProject],
    );
    const activeContext = await createReset(activeProject);
    await expect(owner.fence(activeContext)).rejects.toMatchObject({
      blockerCode: 'ACTIVE_JOB_OUTCOME_UNKNOWN',
    });

    const unknownProject = `t3-discovery-unknown-${randomUUID()}`;
    await createProject(unknownProject);
    const rows = await addDiscoveryRun(unknownProject);
    await adminPool.query(
      `UPDATE discovery.findings SET evidence_ids = ARRAY['missing-evidence']::text[]
       WHERE project_id = $1 AND finding_id = $2`,
      [unknownProject, rows.findingId],
    );
    const unknownContext = await createReset(unknownProject);
    await expect(owner.fence(unknownContext)).rejects.toMatchObject({
      blockerCode: 'UNCLASSIFIED_CONTENT',
    });
    const stillPresent = await adminPool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM discovery.findings WHERE project_id = $1',
      [unknownProject],
    );
    expect(stillPresent.rows[0]?.count).toBe('1');

    const reservedProject = `t3-discovery-reserved-${randomUUID()}`;
    await createProject(reservedProject);
    const run = await addDiscoveryRun(reservedProject, false);
    const attempt = await adminPool.query<{ attempt_id: string }>(
      `SELECT attempt_id FROM discovery.attempts
       WHERE project_id = $1 AND run_id = $2 ORDER BY attempt_number LIMIT 1`,
      [reservedProject, run.runId],
    );
    await adminPool.query(
      `INSERT INTO discovery.provider_budget_reservations (
         project_id, job_id, run_id, attempt_id, reservation_id, provider_id, model_id,
         input_token_upper_bound, max_output_tokens, estimated_cost_micros, state,
         fencing_token, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, 'openai', 'model-t3', 10, 10, 0, 'RESERVED', 0, now(), now())`,
      [reservedProject, run.jobId, run.runId, attempt.rows[0]?.attempt_id, randomUUID()],
    );
    const reservedContext = await createReset(reservedProject);
    await expect(owner.fence(reservedContext)).rejects.toMatchObject({
      blockerCode: 'ACTIVE_JOB_OUTCOME_UNKNOWN',
    });
  });
});
