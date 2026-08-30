import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { DiscoveryActivityAdapter } from '../../adapters/frontend-activity-discovery/src/index.js';
import { PostgresDiscoveryRuntimeRepository } from '../../adapters/discovery-runtime-postgres/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import {
  createDiscoveryLogicalJobIdentityV1,
  type DiscoveryAttemptV1,
  type DiscoveryJobV1,
  type DiscoveryRunV1,
  type DiscoveryStageV1,
  type DiscoveryTriggerV1,
} from '../../packages/contracts/src/index.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';
import type { ActivityAdapterScopeV1 } from '../../modules/frontend-activity/src/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
  ? await requireTestDatabaseTarget()
  : undefined;
const pool: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;
const projectId = 'akp-4-wp5-discovery-activity-project';

const budget = {
  schemaVersion: '1.0.0' as const,
  budgetVersion: 'discovery-work-budget:v1' as const,
  budgetId: 'wp5-budget',
  budgetRevision: 'wp5-budget-1',
  maxResources: 10,
  maxSemanticNeighbors: 10,
  maxCandidatePairs: 10,
  maxCandidateGroups: 10,
  maxFindings: 10,
  maxProviderCalls: 1,
  maxInputTokens: 100,
  maxOutputTokens: 100,
  maxOutputTokensPerCall: 100,
  maxEstimatedCostMicros: 100,
  maxConcurrentProviderCalls: 1,
  deadlineAt: '2099-01-01T00:00:00.000Z',
};

const trigger: DiscoveryTriggerV1 = {
  schemaVersion: '1.0.0',
  triggerId: 'wp5-trigger',
  triggerClass: 'MANUAL',
  triggerIdentity: { kind: 'MANUAL', commandId: 'wp5-command', requestId: 'wp5-request' },
  projectId,
  requestedScanMode: 'INCREMENTAL',
  effectiveScanMode: 'INCREMENTAL',
  canonicalBase: { schemaVersion: '1.0.0', canonicalVersion: 1, snapshotDigest: 'canonical' },
  requiredDiscoveryBase: {
    schemaVersion: '1.0.0',
    projectionRevision: 'projection-1',
    projectionDigest: 'projection',
  },
  policyRevision: 'policy-1',
  strategyRevision: 'strategy-1',
  createdAt: '2026-08-30T01:00:00.000Z',
  observedAt: '2026-08-30T01:00:00.000Z',
  actor: { actorId: 'wp5-actor', principalId: 'wp5-principal' },
};

const job: DiscoveryJobV1 = {
  schemaVersion: '1.0.0',
  jobId: 'wp5-job-1',
  logicalIdentity: createDiscoveryLogicalJobIdentityV1(trigger),
  projectId,
  trigger,
  requestedScanMode: 'INCREMENTAL',
  effectiveScanMode: 'INCREMENTAL',
  canonicalBase: trigger.canonicalBase,
  requiredDiscoveryBase: trigger.requiredDiscoveryBase,
  policyRevision: trigger.policyRevision,
  strategyRevision: trigger.strategyRevision,
  budget,
  lifecycleState: 'SUCCEEDED',
  lifecycleRevision: 1,
  createdAt: trigger.createdAt,
  updatedAt: '2026-08-30T01:00:09.000Z',
};

const run: DiscoveryRunV1 = {
  schemaVersion: '1.0.0',
  runId: 'wp5-run-1',
  jobId: job.jobId,
  projectId,
  requestedScanMode: job.requestedScanMode,
  effectiveScanMode: job.effectiveScanMode,
  runRevision: 1,
  canonicalBase: job.canonicalBase,
  requiredDiscoveryBase: job.requiredDiscoveryBase,
  policyRevision: job.policyRevision,
  strategyRevision: job.strategyRevision,
  budget: job.budget,
  lifecycleState: 'SUCCEEDED',
  lifecycleRevision: 1,
  createdAt: '2026-08-30T01:00:01.000Z',
  updatedAt: '2026-08-30T01:00:09.000Z',
  completedAt: '2026-08-30T01:00:09.000Z',
};

const attempt1: DiscoveryAttemptV1 = {
  schemaVersion: '1.0.0',
  attemptId: 'wp5-attempt-1',
  jobId: job.jobId,
  runId: run.runId,
  projectId,
  attemptNumber: 1,
  lifecycleRevision: 1,
  attemptKind: 'INITIAL',
  lifecycleState: 'FAILED_RETRYABLE',
  createdAt: '2026-08-30T01:00:02.000Z',
  updatedAt: '2026-08-30T01:00:04.000Z',
  completedAt: '2026-08-30T01:00:04.000Z',
};

const attempt2: DiscoveryAttemptV1 = {
  ...attempt1,
  attemptId: 'wp5-attempt-2',
  attemptNumber: 2,
  attemptKind: 'DOMAIN_RETRY',
  lifecycleState: 'SUCCEEDED',
  previousAttemptId: attempt1.attemptId,
  createdAt: '2026-08-30T01:00:05.000Z',
  updatedAt: '2026-08-30T01:00:09.000Z',
  completedAt: '2026-08-30T01:00:09.000Z',
};

const stage: DiscoveryStageV1 = {
  schemaVersion: '1.0.0',
  stageId: 'wp5-stage-1',
  jobId: job.jobId,
  runId: run.runId,
  attemptId: attempt2.attemptId,
  projectId,
  stageOrdinal: 7,
  stageType: 'RECONCILE_FINDINGS',
  stageRevision: 1,
  state: 'SUCCEEDED',
  createdAt: '2026-08-30T01:00:06.000Z',
  updatedAt: '2026-08-30T01:00:09.000Z',
  completedAt: '2026-08-30T01:00:09.000Z',
};

const scope: ActivityAdapterScopeV1 = {
  principalId: 'wp5-principal',
  activeProjectId: projectId,
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  accessScope: ['activity:read'],
  sensitivityClearance: 'internal',
};

describe.runIf(databaseUrl)('AKP-4 WP5 Discovery Activity PostgreSQL read boundary', () => {
  beforeAll(async () => {
    await migrateUpTo(undefined, databaseUrl!);
    await pool!.query(
      `INSERT INTO project_admin.projects (id, name, status, active)
       VALUES ($1, 'AKP-4 WP5 Discovery Activity', 'ACTIVE', true)
       ON CONFLICT (id) DO NOTHING`,
      [projectId],
    );
  });

  beforeEach(async () => {
    await pool!.query('DELETE FROM discovery.finding_ready WHERE project_id = $1', [projectId]);
    await pool!.query('DELETE FROM discovery.provider_budget_reservations WHERE project_id = $1', [
      projectId,
    ]);
    await pool!.query('DELETE FROM discovery.stage_outputs WHERE project_id = $1', [projectId]);
    await pool!.query('DELETE FROM discovery.stage_history WHERE project_id = $1', [projectId]);
    await pool!.query('DELETE FROM discovery.stages WHERE project_id = $1', [projectId]);
    await pool!.query('DELETE FROM discovery.attempt_lifecycle_history WHERE project_id = $1', [
      projectId,
    ]);
    await pool!.query('DELETE FROM discovery.attempts WHERE project_id = $1', [projectId]);
    await pool!.query('DELETE FROM discovery.run_lifecycle_history WHERE project_id = $1', [
      projectId,
    ]);
    await pool!.query('DELETE FROM discovery.runs WHERE project_id = $1', [projectId]);
    await pool!.query('DELETE FROM discovery.job_lifecycle_history WHERE project_id = $1', [
      projectId,
    ]);
    await pool!.query('DELETE FROM discovery.jobs WHERE project_id = $1', [projectId]);
    await pool!.query(
      'DELETE FROM frontend_activity.activity_index WHERE resource_project_id = $1',
      [projectId],
    );
    await pool!.query(
      'DELETE FROM frontend_activity.projection_watermarks WHERE resource_project_id = $1',
      [projectId],
    );

    const runtime = new PostgresDiscoveryRuntimeRepository(pool!);
    expect(await runtime.saveJob(job)).toBe('CREATED');
    expect(await runtime.saveRun(run)).toBe('CREATED');
    expect(await runtime.saveAttempt(attempt1)).toBe('CREATED');
    expect(await runtime.saveAttempt(attempt2)).toBe('CREATED');
    expect(await runtime.saveStage(stage)).toBe('CREATED');
    await pool!.query(
      `UPDATE discovery.attempts
       SET failure_code = 'PROVIDER_TIMEOUT', failure_classification = 'RETRYABLE',
           failure_retryable = true, failure_safe_message = 'The provider timed out.',
           failure_stage = 'GENERATE_FINDINGS', failure_occurred_at = $2,
           retry_not_before = $3
       WHERE project_id = $1 AND attempt_id = $4`,
      [projectId, '2026-08-30T01:00:04.000Z', '2026-08-30T01:00:05.000Z', attempt1.attemptId],
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('keeps one deterministic Job-root identity across repeated reads and preserves retry history', async () => {
    const runtime = new PostgresDiscoveryRuntimeRepository(pool!);
    const adapter = new DiscoveryActivityAdapter(runtime);
    const first = await adapter.readQueue(scope, { limit: 10 });
    const second = await adapter.readQueue(scope, { limit: 10 });
    expect(first.items).toHaveLength(1);
    expect(second.items[0]!.root).toEqual(first.items[0]!.root);
    expect(first.items[0]!.root.activityId).toBe(job.jobId);

    const before = await pool!.query(
      `SELECT lifecycle_state, failure_code, fencing_token, lease_owner
       FROM discovery.attempts WHERE project_id = $1 ORDER BY attempt_number`,
      [projectId],
    );
    const detail = await adapter.readDetail(scope, first.items[0]!.root);
    const after = await pool!.query(
      `SELECT lifecycle_state, failure_code, fencing_token, lease_owner
       FROM discovery.attempts WHERE project_id = $1 ORDER BY attempt_number`,
      [projectId],
    );
    expect(after.rows).toEqual(before.rows);
    expect(detail.attempts.map((attempt) => attempt.attemptId)).toEqual([
      attempt1.attemptId,
      attempt2.attemptId,
    ]);
    expect(detail.attempts[0]!.failure).toMatchObject({
      code: 'PROVIDER_TIMEOUT',
      kind: 'TRANSIENT',
    });
    expect(detail.events.some((event) => event.category === 'RETRY_SCHEDULED')).toBe(true);
    expect(detail.stages.some((stage) => stage.stageKey.includes('reconcile_findings'))).toBe(true);
  });

  it('rejects duplicate logical Job identity without creating a second Activity root', async () => {
    const runtime = new PostgresDiscoveryRuntimeRepository(pool!);
    expect(await runtime.saveJob({ ...job, jobId: 'wp5-job-duplicate' })).toBe('CONFLICT');
    const roots = await new DiscoveryActivityAdapter(runtime).readQueue(scope, { limit: 10 });
    expect(roots.items.map((item) => item.root.activityId)).toEqual([job.jobId]);
  });

  it('enforces project binding and keeps adapter reads side-effect free', async () => {
    const runtime = new PostgresDiscoveryRuntimeRepository(pool!);
    const adapter = new DiscoveryActivityAdapter(runtime);
    const root = (await adapter.readQueue(scope, { limit: 10 })).items[0]!.root;
    expect(await adapter.canAccess(scope, root)).toBe(true);
    expect(await adapter.canAccess({ ...scope, activeProjectId: 'other-project' }, root)).toBe(
      false,
    );
  });
});
