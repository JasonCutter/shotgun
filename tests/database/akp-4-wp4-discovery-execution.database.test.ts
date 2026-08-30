import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { PostgresDiscoveryRuntimeRepository } from '../../adapters/discovery-runtime-postgres/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import {
  createDiscoveryLogicalJobIdentityV1,
  type DiscoveryJobV1,
  type DiscoveryRuntimeBudgetBindingV1,
  type DiscoveryTriggerV1,
} from '../../packages/contracts/src/index.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
  ? await requireTestDatabaseTarget()
  : undefined;
const poolA: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;
const poolB: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;
const projectId = 'akp-4-wp4-execution-project';

const budget: DiscoveryRuntimeBudgetBindingV1 = {
  schemaVersion: '1.0.0',
  budgetVersion: 'discovery-work-budget:v1',
  budgetId: 'wp4-budget',
  budgetRevision: 'wp4-budget-revision',
  maxResources: 20,
  maxSemanticNeighbors: 20,
  maxCandidatePairs: 10,
  maxCandidateGroups: 10,
  maxFindings: 10,
  maxProviderCalls: 2,
  maxInputTokens: 100,
  maxOutputTokens: 100,
  maxOutputTokensPerCall: 50,
  maxEstimatedCostMicros: 100,
  maxConcurrentProviderCalls: 1,
  deadlineAt: '2099-01-01T00:00:00.000Z',
};

const job = (jobId: string): DiscoveryJobV1 => {
  const trigger: DiscoveryTriggerV1 = {
    schemaVersion: '1.0.0',
    triggerId: `${jobId}-trigger`,
    triggerClass: 'CANONICAL_COMMITTED',
    triggerIdentity: { kind: 'CANONICAL_COMMITTED', eventId: `${jobId}-event`, eventRevision: '1' },
    projectId,
    requestedScanMode: 'INCREMENTAL',
    effectiveScanMode: 'INCREMENTAL',
    canonicalBase: {
      schemaVersion: '1.0.0',
      canonicalVersion: 1,
      snapshotDigest: 'sha256:canonical',
    },
    requiredDiscoveryBase: {
      schemaVersion: '1.0.0',
      projectionRevision: 'projection:1',
      projectionDigest: 'sha256:projection',
    },
    policyRevision: 'policy:1',
    strategyRevision: 'strategy:1',
    profileBinding: { profileId: 'profile', profileRevision: 1 },
    createdAt: '2026-08-30T00:00:00.000Z',
    observedAt: '2026-08-30T00:00:00.000Z',
  };
  return {
    schemaVersion: '1.0.0',
    jobId,
    logicalIdentity: createDiscoveryLogicalJobIdentityV1(trigger),
    projectId,
    trigger,
    requestedScanMode: trigger.requestedScanMode,
    effectiveScanMode: trigger.effectiveScanMode,
    canonicalBase: trigger.canonicalBase,
    requiredDiscoveryBase: trigger.requiredDiscoveryBase,
    policyRevision: trigger.policyRevision,
    strategyRevision: trigger.strategyRevision,
    profileBinding: trigger.profileBinding,
    budget,
    lifecycleState: 'QUEUED',
    lifecycleRevision: 1,
    createdAt: trigger.createdAt,
    updatedAt: trigger.createdAt,
  };
};

const snapshot = {
  resources: 1,
  semanticNeighbors: 0,
  candidatePairs: 0,
  candidateGroups: 0,
  findings: 0,
  providerCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  estimatedCostMicros: 0,
  activeProviderCalls: 0,
};

describe.runIf(databaseUrl)('AKP-4 WP4 durable execution PostgreSQL authority', () => {
  const cleanupProject = async (): Promise<void> => {
    await poolA!.query('DELETE FROM discovery.finding_ready WHERE project_id = $1', [projectId]);
    await poolA!.query('DELETE FROM discovery.work_budget_checkpoints WHERE project_id = $1', [
      projectId,
    ]);
    await poolA!.query('DELETE FROM discovery.stage_history WHERE project_id = $1', [projectId]);
    await poolA!.query('DELETE FROM discovery.stages WHERE project_id = $1', [projectId]);
    await poolA!.query('DELETE FROM discovery.attempt_lifecycle_history WHERE project_id = $1', [
      projectId,
    ]);
    await poolA!.query('DELETE FROM discovery.attempts WHERE project_id = $1', [projectId]);
    await poolA!.query('DELETE FROM discovery.run_lifecycle_history WHERE project_id = $1', [
      projectId,
    ]);
    await poolA!.query('DELETE FROM discovery.runs WHERE project_id = $1', [projectId]);
    await poolA!.query('DELETE FROM discovery.job_lifecycle_history WHERE project_id = $1', [
      projectId,
    ]);
    await poolA!.query('DELETE FROM discovery.jobs WHERE project_id = $1', [projectId]);
  };

  beforeAll(async () => {
    await migrateUpTo(undefined, databaseUrl!);
    await poolA!.query(
      `INSERT INTO project_admin.projects (id, name, status, active)
       VALUES ($1, 'AKP-4 WP4 execution project', 'ACTIVE', true)
       ON CONFLICT (id) DO NOTHING`,
      [projectId],
    );
  });

  beforeEach(async () => {
    await cleanupProject();
  });

  afterAll(async () => {
    await cleanupProject();
    await poolA!.query('DELETE FROM project_admin.projects WHERE id = $1', [projectId]);
    await poolA!.end();
    await poolB!.end();
  });

  it('converges concurrent claimers to one Run and seven durable stages', async () => {
    const repositoryA = new PostgresDiscoveryRuntimeRepository(poolA!);
    const repositoryB = new PostgresDiscoveryRuntimeRepository(poolB!);
    const queued = job('wp4-concurrent-job');
    await repositoryA.saveJob(queued);

    const [first, second] = await Promise.all([
      repositoryA.claimNext({
        projectId,
        workerId: 'worker-a',
        now: '2026-08-30T01:00:00.000Z',
        leaseDurationMs: 30_000,
      }),
      repositoryB.claimNext({
        projectId,
        workerId: 'worker-b',
        now: '2026-08-30T01:00:00.000Z',
        leaseDurationMs: 30_000,
      }),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    const claim = first ?? second!;
    expect(claim.attempt.attemptNumber).toBe(1);
    expect(claim.run.jobId).toBe(queued.jobId);
    expect(claim.run.canonicalBase).toEqual(queued.canonicalBase);
    expect(claim.run.requiredDiscoveryBase).toEqual(queued.requiredDiscoveryBase);
    expect(claim.run.policyRevision).toBe(queued.policyRevision);
    expect(claim.run.strategyRevision).toBe(queued.strategyRevision);
    expect(claim.run.budget).toEqual(queued.budget);
    expect(await repositoryA.listStages(claim)).toHaveLength(7);
    await expect(
      poolA!.query(
        'SELECT count(*)::int AS count FROM discovery.runs WHERE project_id = $1 AND job_id = $2',
        [projectId, queued.jobId],
      ),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it('does not claim WAITING_FOR_PROJECTION and rejects stale fences after reclaim', async () => {
    const repositoryA = new PostgresDiscoveryRuntimeRepository(poolA!);
    const waiting = job('wp4-waiting-job');
    await repositoryA.saveJob(waiting);
    await repositoryA.transitionJob({
      projectId,
      jobId: waiting.jobId,
      expectedLifecycleRevision: 1,
      targetState: 'WAITING_FOR_PROJECTION',
      projectionWait: {
        requiredDiscoveryBase: waiting.requiredDiscoveryBase!,
        waitDeadlineAt: '2099-01-01T00:00:00.000Z',
        fallbackPolicyRevision: 'fallback:1',
      },
      updatedAt: '2026-08-30T00:00:01.000Z',
    });
    expect(
      await repositoryA.claimNext({
        projectId,
        workerId: 'worker-a',
        now: '2026-08-30T01:00:00.000Z',
        leaseDurationMs: 30_000,
      }),
    ).toBeUndefined();

    const queued = job('wp4-reclaim-job');
    await repositoryA.saveJob(queued);
    const first = (await repositoryA.claimNext({
      projectId,
      workerId: 'worker-a',
      now: '2026-08-30T01:00:00.000Z',
      leaseDurationMs: 1_000,
    }))!;
    const reclaimed = (await repositoryA.claimNext({
      projectId,
      workerId: 'worker-b',
      now: '2026-08-30T01:00:02.000Z',
      leaseDurationMs: 30_000,
    }))!;
    expect(reclaimed.fencingToken).toBeGreaterThan(first.fencingToken);
    expect(
      await repositoryA.renewLease({
        ...first,
        now: '2026-08-30T01:00:02.000Z',
        leaseDurationMs: 30_000,
      }),
    ).toBe('STALE');
    expect(
      await repositoryA.transitionStageWithLease({
        ...first,
        stageId: (await repositoryA.listStages(first))[0]!.stageId,
        expectedStageRevision: 1,
        targetState: 'RUNNING',
        updatedAt: '2026-08-30T01:00:02.000Z',
      }),
    ).toBe('STALE');
  });

  it('continues budget checkpoints under the active fence', async () => {
    const repository = new PostgresDiscoveryRuntimeRepository(poolA!);
    const queued = job('wp4-budget-job');
    await repository.saveJob(queued);
    const claim = (await repository.claimNext({
      projectId,
      workerId: 'worker-a',
      now: '2026-08-30T01:00:00.000Z',
      leaseDurationMs: 30_000,
    }))!;
    expect(
      await repository.writeBudgetCheckpoint({
        ...claim,
        checkpoint: {
          schemaVersion: '1.0.0',
          projectId,
          jobId: queued.jobId,
          runId: claim.runId,
          revision: 1,
          snapshot,
          updatedAt: '2026-08-30T01:00:01.000Z',
        },
      }),
    ).toBe('SAVED');
    expect(
      await repository.readBudgetCheckpoint({ projectId, jobId: queued.jobId, runId: claim.runId }),
    ).toMatchObject({
      revision: 1,
      snapshot,
    });
    expect(
      await repository.writeBudgetCheckpoint({
        ...claim,
        fencingToken: claim.fencingToken - 1,
        checkpoint: {
          schemaVersion: '1.0.0',
          projectId,
          jobId: queued.jobId,
          runId: claim.runId,
          revision: 2,
          snapshot: { ...snapshot, findings: 1 },
          updatedAt: '2026-08-30T01:00:02.000Z',
        },
      }),
    ).toBe('STALE');
  });

  it('atomically finalizes Attempt, Run and Job and never reclaims completed work', async () => {
    const repository = new PostgresDiscoveryRuntimeRepository(poolA!);
    const queued = job('wp4-finalize-job');
    await repository.saveJob(queued);
    const claim = (await repository.claimNext({
      projectId,
      workerId: 'worker-a',
      now: '2026-08-30T01:00:00.000Z',
      leaseDurationMs: 30_000,
    }))!;

    expect(
      await repository.finalizeClaimWithLease({
        ...claim,
        expectedAttemptLifecycleRevision: claim.attempt.lifecycleRevision,
        expectedRunLifecycleRevision: claim.run.lifecycleRevision,
        expectedJobLifecycleRevision: claim.job.lifecycleRevision,
        targetState: 'SUCCEEDED',
        updatedAt: '2026-08-30T01:00:01.000Z',
      }),
    ).toBe('COMPLETED');
    expect((await repository.findJob({ projectId, jobId: queued.jobId }))?.lifecycleState).toBe(
      'SUCCEEDED',
    );
    expect(
      (await repository.findRun({ projectId, jobId: queued.jobId, runId: claim.runId }))
        ?.lifecycleState,
    ).toBe('SUCCEEDED');
    expect(
      (await repository.listAttempts({ projectId, jobId: queued.jobId, runId: claim.runId }))[0]
        ?.lifecycleState,
    ).toBe('SUCCEEDED');
    expect(
      await repository.claimNext({
        projectId,
        workerId: 'worker-b',
        now: '2026-08-30T01:00:02.000Z',
        leaseDurationMs: 30_000,
      }),
    ).toBeUndefined();
  });
});
