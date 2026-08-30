import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { PostgresDiscoveryRuntimeRepository } from '../../adapters/discovery-runtime-postgres/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import {
  createDiscoveryLogicalJobIdentityV1,
  type DiscoveryAttemptV1,
  type DiscoveryJobV1,
  type DiscoveryRuntimeBudgetBindingV1,
  type DiscoveryRunV1,
  type DiscoveryStageV1,
  type DiscoveryTriggerV1,
} from '../../packages/contracts/src/index.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
  ? await requireTestDatabaseTarget()
  : undefined;
const poolA: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;
const poolB: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;
const projectA = 'akp-4-wp1-runtime-project-a';
const projectB = 'akp-4-wp1-runtime-project-b';

const budget: DiscoveryRuntimeBudgetBindingV1 = {
  schemaVersion: '1.0.0',
  budgetVersion: 'discovery-work-budget:v1',
  budgetId: 'budget-runtime-1',
  budgetRevision: 'budget-revision-1',
  maxResources: 100,
  maxSemanticNeighbors: 100,
  maxCandidatePairs: 50,
  maxCandidateGroups: 20,
  maxFindings: 20,
  maxProviderCalls: 10,
  maxInputTokens: 10_000,
  maxOutputTokens: 5_000,
  maxOutputTokensPerCall: 1_000,
  maxEstimatedCostMicros: 20_000,
  maxConcurrentProviderCalls: 2,
  deadlineAt: '2099-01-01T00:00:00.000Z',
};

const trigger = (projectId: string, eventId: string): DiscoveryTriggerV1 => ({
  schemaVersion: '1.0.0',
  triggerId: `${projectId}-trigger-physical`,
  triggerClass: 'CANONICAL_COMMITTED',
  triggerIdentity: {
    kind: 'CANONICAL_COMMITTED',
    eventId,
    eventRevision: 'event-revision-1',
  },
  projectId,
  requestedScanMode: 'INCREMENTAL',
  effectiveScanMode: 'INCREMENTAL',
  canonicalBase: {
    schemaVersion: '1.0.0',
    canonicalVersion: 12,
    snapshotDigest: `sha256:${projectId}-canonical`,
  },
  requiredDiscoveryBase: {
    schemaVersion: '1.0.0',
    projectionRevision: 'discovery-12',
    projectionDigest: `sha256:${projectId}-discovery`,
  },
  policyRevision: 'policy-1',
  strategyRevision: 'strategy-1',
  profileBinding: { profileId: 'profile-1', profileRevision: 1 },
  createdAt: '2026-08-30T00:00:00.000Z',
  observedAt: '2026-08-30T00:00:01.000Z',
  correlationId: `${projectId}-correlation`,
});

const job = (projectId: string, jobId: string, eventId = `${projectId}-event`): DiscoveryJobV1 => {
  const nextTrigger = trigger(projectId, eventId);
  return {
    schemaVersion: '1.0.0',
    jobId,
    logicalIdentity: createDiscoveryLogicalJobIdentityV1(nextTrigger),
    projectId,
    trigger: nextTrigger,
    requestedScanMode: nextTrigger.requestedScanMode,
    effectiveScanMode: nextTrigger.effectiveScanMode,
    canonicalBase: nextTrigger.canonicalBase,
    requiredDiscoveryBase: nextTrigger.requiredDiscoveryBase,
    policyRevision: nextTrigger.policyRevision,
    strategyRevision: nextTrigger.strategyRevision,
    profileBinding: nextTrigger.profileBinding,
    budget,
    lifecycleState: 'QUEUED',
    lifecycleRevision: 1,
    createdAt: '2026-08-30T00:00:00.000Z',
    updatedAt: '2026-08-30T00:00:00.000Z',
  };
};

const runForJob = (
  parent: DiscoveryJobV1,
  runId: string,
  overrides: Partial<DiscoveryRunV1> = {},
): DiscoveryRunV1 => ({
  schemaVersion: '1.0.0',
  runId,
  jobId: parent.jobId,
  projectId: parent.projectId,
  requestedScanMode: parent.requestedScanMode,
  effectiveScanMode: parent.effectiveScanMode,
  runRevision: 1,
  canonicalBase: parent.canonicalBase,
  requiredDiscoveryBase: parent.requiredDiscoveryBase,
  policyRevision: parent.policyRevision,
  strategyRevision: parent.strategyRevision,
  profileBinding: parent.profileBinding,
  budget: parent.budget,
  lifecycleState: 'RUNNING',
  lifecycleRevision: 1,
  createdAt: '2026-08-30T00:00:03.000Z',
  updatedAt: '2026-08-30T00:00:03.000Z',
  ...overrides,
});

const attemptForRun = (
  parent: DiscoveryRunV1,
  attemptId: string,
  overrides: Partial<DiscoveryAttemptV1> = {},
): DiscoveryAttemptV1 => ({
  schemaVersion: '1.0.0',
  attemptId,
  jobId: parent.jobId,
  runId: parent.runId,
  projectId: parent.projectId,
  attemptNumber: 1,
  lifecycleRevision: 1,
  attemptKind: 'INITIAL',
  lifecycleState: 'FAILED_RETRYABLE',
  createdAt: '2026-08-30T00:00:04.000Z',
  updatedAt: '2026-08-30T00:00:05.000Z',
  completedAt: '2026-08-30T00:00:05.000Z',
  ...overrides,
});

describe.runIf(databaseUrl)('AKP-4 WP1 Discovery runtime PostgreSQL authority', () => {
  beforeAll(async () => {
    await migrateUpTo(undefined, databaseUrl!);
    await poolA!.query(
      `INSERT INTO project_admin.projects (id, name, status, active)
       VALUES ($1, $2, 'ACTIVE', true), ($3, $4, 'ACTIVE', true)
       ON CONFLICT (id) DO NOTHING`,
      [projectA, 'AKP-4 runtime project A', projectB, 'AKP-4 runtime project B'],
    );
  });

  beforeEach(async () => {
    await poolA!.query(
      'DELETE FROM discovery.attempt_lifecycle_history WHERE project_id IN ($1, $2)',
      [projectA, projectB],
    );
    await poolA!.query('DELETE FROM discovery.stage_history WHERE project_id IN ($1, $2)', [
      projectA,
      projectB,
    ]);
    await poolA!.query('DELETE FROM discovery.stages WHERE project_id IN ($1, $2)', [
      projectA,
      projectB,
    ]);
    await poolA!.query('DELETE FROM discovery.attempts WHERE project_id IN ($1, $2)', [
      projectA,
      projectB,
    ]);
    await poolA!.query('DELETE FROM discovery.run_lifecycle_history WHERE project_id IN ($1, $2)', [
      projectA,
      projectB,
    ]);
    await poolA!.query('DELETE FROM discovery.runs WHERE project_id IN ($1, $2)', [
      projectA,
      projectB,
    ]);
    await poolA!.query('DELETE FROM discovery.job_lifecycle_history WHERE project_id IN ($1, $2)', [
      projectA,
      projectB,
    ]);
    await poolA!.query('DELETE FROM discovery.jobs WHERE project_id IN ($1, $2)', [
      projectA,
      projectB,
    ]);
  });

  afterAll(async () => {
    await poolA!.query(
      'DELETE FROM discovery.attempt_lifecycle_history WHERE project_id IN ($1, $2)',
      [projectA, projectB],
    );
    await poolA!.query('DELETE FROM discovery.stage_history WHERE project_id IN ($1, $2)', [
      projectA,
      projectB,
    ]);
    await poolA!.query('DELETE FROM discovery.stages WHERE project_id IN ($1, $2)', [
      projectA,
      projectB,
    ]);
    await poolA!.query('DELETE FROM discovery.attempts WHERE project_id IN ($1, $2)', [
      projectA,
      projectB,
    ]);
    await poolA!.query('DELETE FROM discovery.run_lifecycle_history WHERE project_id IN ($1, $2)', [
      projectA,
      projectB,
    ]);
    await poolA!.query('DELETE FROM discovery.runs WHERE project_id IN ($1, $2)', [
      projectA,
      projectB,
    ]);
    await poolA!.query('DELETE FROM discovery.job_lifecycle_history WHERE project_id IN ($1, $2)', [
      projectA,
      projectB,
    ]);
    await poolA!.query('DELETE FROM discovery.jobs WHERE project_id IN ($1, $2)', [
      projectA,
      projectB,
    ]);
    await poolA!.query('DELETE FROM project_admin.projects WHERE id IN ($1, $2)', [
      projectA,
      projectB,
    ]);
    await poolA!.end();
    await poolB!.end();
  });

  it('persists the full trigger/job binding and prevents duplicate logical jobs across instances', async () => {
    const repositoryA = new PostgresDiscoveryRuntimeRepository(poolA!);
    const repositoryB = new PostgresDiscoveryRuntimeRepository(poolB!);
    const first = job(projectA, 'job-1');

    expect(await repositoryA.saveJob(first)).toBe('CREATED');
    expect(await repositoryB.findJob({ projectId: projectA, jobId: first.jobId })).toEqual(first);
    expect(
      await repositoryB.findJobByLogicalIdentity({
        projectId: projectA,
        logicalIdentity: first.logicalIdentity,
      }),
    ).toEqual(first);
    expect(
      await repositoryB.findJobByTriggerIdentity({
        projectId: projectA,
        triggerClass: 'CANONICAL_COMMITTED',
        eventId: `${projectA}-event`,
        eventRevision: 'event-revision-1',
      }),
    ).toEqual(first);
    expect(await repositoryB.saveJob({ ...first, jobId: 'job-duplicate-physical' })).toBe(
      'CONFLICT',
    );
    await expect(
      repositoryA.saveJob({
        ...first,
        jobId: 'job-arbitrary-identity',
        logicalIdentity: { ...first.logicalIdentity, value: 'arbitrary' },
      }),
    ).rejects.toThrow(/recomputed/);
    await expect(
      repositoryA.saveJob({
        ...first,
        jobId: 'job-mismatched-policy',
        policyRevision: 'policy-tampered',
      }),
    ).rejects.toThrow(/must match trigger binding/);
    const identityIndex = await poolA!.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
       WHERE schemaname = 'discovery' AND tablename = 'jobs'
         AND indexdef LIKE '%logical_job_identity_version%'`,
    );
    expect(identityIndex.rows.length).toBeGreaterThan(0);
  });

  it('persists projection waiting, clears it on transition, and retains run/attempt history', async () => {
    const repositoryA = new PostgresDiscoveryRuntimeRepository(poolA!);
    const repositoryB = new PostgresDiscoveryRuntimeRepository(poolB!);
    const first = job(projectA, 'job-waiting');
    await repositoryA.saveJob(first);

    const waiting = await repositoryA.transitionJob({
      projectId: projectA,
      jobId: first.jobId,
      expectedLifecycleRevision: 1,
      targetState: 'WAITING_FOR_PROJECTION',
      projectionWait: {
        requiredDiscoveryBase: first.requiredDiscoveryBase!,
        waitDeadlineAt: '2026-08-30T00:10:00.000Z',
        fallbackPolicyRevision: 'fallback-policy-1',
      },
      updatedAt: '2026-08-30T00:00:02.000Z',
    });
    expect(waiting).toMatchObject({ lifecycleState: 'WAITING_FOR_PROJECTION' });
    expect(
      (await repositoryB.findJob({ projectId: projectA, jobId: first.jobId }))?.projectionWait,
    ).toEqual({
      requiredDiscoveryBase: first.requiredDiscoveryBase,
      waitDeadlineAt: '2026-08-30T00:10:00.000Z',
      fallbackPolicyRevision: 'fallback-policy-1',
    });

    const running = await repositoryA.transitionJob({
      projectId: projectA,
      jobId: first.jobId,
      expectedLifecycleRevision: 2,
      targetState: 'RUNNING',
      updatedAt: '2026-08-30T00:00:03.000Z',
    });
    expect(running).toMatchObject({ lifecycleState: 'RUNNING', lifecycleRevision: 3 });
    expect(
      (await repositoryB.findJob({ projectId: projectA, jobId: first.jobId }))?.projectionWait,
    ).toBeUndefined();

    const run: DiscoveryRunV1 = {
      schemaVersion: '1.0.0',
      runId: 'run-1',
      jobId: first.jobId,
      projectId: projectA,
      requestedScanMode: first.requestedScanMode,
      effectiveScanMode: first.effectiveScanMode,
      runRevision: 1,
      canonicalBase: first.canonicalBase,
      requiredDiscoveryBase: first.requiredDiscoveryBase,
      policyRevision: first.policyRevision,
      strategyRevision: first.strategyRevision,
      profileBinding: first.profileBinding,
      budget: first.budget,
      lifecycleState: 'RUNNING',
      lifecycleRevision: 1,
      createdAt: '2026-08-30T00:00:03.000Z',
      updatedAt: '2026-08-30T00:00:03.000Z',
    };
    expect(await repositoryA.saveRun(run)).toBe('CREATED');
    expect(
      await repositoryB.findRun({ projectId: projectA, jobId: first.jobId, runId: run.runId }),
    ).toEqual(run);
    const completedRun = await repositoryA.transitionRun({
      projectId: projectA,
      jobId: first.jobId,
      runId: run.runId,
      expectedLifecycleRevision: 1,
      targetState: 'SUCCEEDED',
      updatedAt: '2026-08-30T00:00:07.000Z',
    });
    expect(completedRun).toMatchObject({
      lifecycleState: 'SUCCEEDED',
      lifecycleRevision: 2,
      completedAt: '2026-08-30T00:00:07.000Z',
    });
    expect(
      await repositoryB.transitionRun({
        projectId: projectA,
        jobId: first.jobId,
        runId: run.runId,
        expectedLifecycleRevision: 1,
        targetState: 'RUNNING',
        updatedAt: '2026-08-30T00:00:08.000Z',
      }),
    ).toBe('CONFLICT');
    const runHistory = await poolA!.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM discovery.run_lifecycle_history WHERE project_id = $1 AND run_id = $2',
      [projectA, run.runId],
    );
    expect(runHistory.rows[0]?.count).toBe('2');

    const failedAttempt: DiscoveryAttemptV1 = {
      schemaVersion: '1.0.0',
      attemptId: 'attempt-1',
      jobId: first.jobId,
      runId: run.runId,
      projectId: projectA,
      attemptNumber: 1,
      lifecycleRevision: 1,
      attemptKind: 'INITIAL',
      lifecycleState: 'FAILED_RETRYABLE',
      createdAt: '2026-08-30T00:00:04.000Z',
      updatedAt: '2026-08-30T00:00:05.000Z',
      completedAt: '2026-08-30T00:00:05.000Z',
    };
    const retryAttempt: DiscoveryAttemptV1 = {
      ...failedAttempt,
      attemptId: 'attempt-2',
      attemptNumber: 2,
      lifecycleRevision: 1,
      attemptKind: 'DOMAIN_RETRY',
      lifecycleState: 'RUNNING',
      previousAttemptId: failedAttempt.attemptId,
      createdAt: '2026-08-30T00:00:06.000Z',
      updatedAt: '2026-08-30T00:00:06.000Z',
      completedAt: undefined,
    };
    expect(await repositoryA.saveAttempt(failedAttempt)).toBe('CREATED');
    expect(await repositoryA.saveAttempt(retryAttempt)).toBe('CREATED');
    expect(
      await repositoryB.listAttempts({ projectId: projectA, jobId: first.jobId, runId: run.runId }),
    ).toEqual([failedAttempt, retryAttempt]);
    const completedAttempt = await repositoryA.transitionAttempt({
      projectId: projectA,
      jobId: first.jobId,
      runId: run.runId,
      attemptId: retryAttempt.attemptId,
      expectedLifecycleRevision: 1,
      targetState: 'SUCCEEDED',
      updatedAt: '2026-08-30T00:00:07.000Z',
    });
    expect(completedAttempt).toMatchObject({
      lifecycleState: 'SUCCEEDED',
      lifecycleRevision: 2,
      completedAt: '2026-08-30T00:00:07.000Z',
    });
    expect(
      await repositoryB.transitionAttempt({
        projectId: projectA,
        jobId: first.jobId,
        runId: run.runId,
        attemptId: retryAttempt.attemptId,
        expectedLifecycleRevision: 1,
        targetState: 'RUNNING',
        updatedAt: '2026-08-30T00:00:08.000Z',
      }),
    ).toBe('CONFLICT');
    expect(
      await repositoryB.listAttempts({ projectId: projectA, jobId: first.jobId, runId: run.runId }),
    ).toEqual([failedAttempt, completedAttempt]);
    const attemptHistory = await poolA!.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM discovery.attempt_lifecycle_history WHERE project_id = $1 AND run_id = $2',
      [projectA, run.runId],
    );
    expect(attemptHistory.rows[0]?.count).toBe('3');
  });

  it('retains typed stage history and rejects cross-project job/run/attempt attachment', async () => {
    const repositoryA = new PostgresDiscoveryRuntimeRepository(poolA!);
    const repositoryB = new PostgresDiscoveryRuntimeRepository(poolB!);
    const first = job(projectA, 'job-stage');
    const other = job(projectB, 'job-other');
    await repositoryA.saveJob(first);
    await repositoryA.saveJob(other);
    await expect(
      repositoryA.saveRun(
        runForJob(first, 'run-mismatched-canonical', {
          canonicalBase: { ...first.canonicalBase, canonicalVersion: 99 },
        }),
      ),
    ).rejects.toThrow(/must match its parent Job binding/);
    await expect(
      repositoryA.saveRun(
        runForJob(first, 'run-mismatched-budget', {
          budget: { ...first.budget, budgetRevision: 'budget-tampered' },
        }),
      ),
    ).rejects.toThrow(/must match its parent Job binding/);
    const run: DiscoveryRunV1 = {
      schemaVersion: '1.0.0',
      runId: 'run-stage',
      jobId: first.jobId,
      projectId: projectA,
      requestedScanMode: first.requestedScanMode,
      effectiveScanMode: first.effectiveScanMode,
      runRevision: 1,
      canonicalBase: first.canonicalBase,
      requiredDiscoveryBase: first.requiredDiscoveryBase,
      policyRevision: first.policyRevision,
      strategyRevision: first.strategyRevision,
      profileBinding: first.profileBinding,
      budget: first.budget,
      lifecycleState: 'RUNNING',
      lifecycleRevision: 1,
      createdAt: '2026-08-30T00:00:00.000Z',
      updatedAt: '2026-08-30T00:00:00.000Z',
    };
    await repositoryA.saveRun(run);
    const attempt: DiscoveryAttemptV1 = {
      schemaVersion: '1.0.0',
      attemptId: 'attempt-stage',
      jobId: first.jobId,
      runId: run.runId,
      projectId: projectA,
      attemptNumber: 1,
      lifecycleRevision: 1,
      attemptKind: 'INITIAL',
      lifecycleState: 'RUNNING',
      createdAt: '2026-08-30T00:00:00.000Z',
      updatedAt: '2026-08-30T00:00:00.000Z',
    };
    await repositoryA.saveAttempt(attempt);
    const stage: DiscoveryStageV1 = {
      schemaVersion: '1.0.0',
      stageId: 'stage-1',
      jobId: first.jobId,
      runId: run.runId,
      attemptId: attempt.attemptId,
      projectId: projectA,
      stageOrdinal: 1,
      stageType: 'WAIT_FOR_PROJECTION',
      stageRevision: 1,
      state: 'QUEUED',
      createdAt: '2026-08-30T00:00:01.000Z',
      updatedAt: '2026-08-30T00:00:01.000Z',
    };
    await repositoryA.saveStage(stage);
    await repositoryA.transitionStage({
      projectId: projectA,
      runId: run.runId,
      attemptId: attempt.attemptId,
      stageId: stage.stageId,
      expectedStageRevision: 1,
      targetState: 'RUNNING',
      updatedAt: '2026-08-30T00:00:02.000Z',
    });
    const completed = await repositoryA.transitionStage({
      projectId: projectA,
      runId: run.runId,
      attemptId: attempt.attemptId,
      stageId: stage.stageId,
      expectedStageRevision: 2,
      targetState: 'SUCCEEDED',
      updatedAt: '2026-08-30T00:00:03.000Z',
    });
    expect(completed).toMatchObject({
      stageType: 'WAIT_FOR_PROJECTION',
      state: 'SUCCEEDED',
      stageRevision: 3,
    });
    expect(
      await repositoryA.listStages({
        projectId: projectA,
        runId: run.runId,
        attemptId: attempt.attemptId,
      }),
    ).toEqual([
      {
        ...stage,
        state: 'SUCCEEDED',
        stageRevision: 3,
        updatedAt: '2026-08-30T00:00:03.000Z',
        completedAt: '2026-08-30T00:00:03.000Z',
      },
    ]);
    const history = await poolA!.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM discovery.stage_history WHERE project_id = $1 AND stage_id = $2',
      [projectA, stage.stageId],
    );
    expect(history.rows[0]?.count).toBe('3');

    await expect(
      repositoryA.saveRun({ ...run, runId: 'run-cross-project', projectId: projectB }),
    ).rejects.toThrow(/parent Job was not found/);
    await expect(
      repositoryA.saveAttempt({
        ...attempt,
        attemptId: 'attempt-cross-project',
        projectId: projectB,
      }),
    ).rejects.toThrow(/parent Run was not found/);
    await expect(
      repositoryA.saveStage({ ...stage, stageId: 'stage-cross-project', projectId: projectB }),
    ).rejects.toMatchObject({ code: '23503' });

    await repositoryA.transitionAttempt({
      projectId: projectA,
      jobId: first.jobId,
      runId: run.runId,
      attemptId: attempt.attemptId,
      expectedLifecycleRevision: 1,
      targetState: 'FAILED_RETRYABLE',
      updatedAt: '2026-08-30T00:00:02.000Z',
    });
    const failedAttemptSnapshot: DiscoveryAttemptV1 = {
      ...attempt,
      lifecycleState: 'FAILED_RETRYABLE',
      lifecycleRevision: 2,
      updatedAt: '2026-08-30T00:00:02.000Z',
      completedAt: '2026-08-30T00:00:02.000Z',
    };
    expect(
      (
        await repositoryB.listAttempts({
          projectId: projectA,
          jobId: first.jobId,
          runId: run.runId,
        })
      )[0],
    ).toEqual(failedAttemptSnapshot);
    await expect(
      repositoryA.transitionAttempt({
        projectId: projectA,
        jobId: first.jobId,
        runId: run.runId,
        attemptId: attempt.attemptId,
        expectedLifecycleRevision: 2,
        targetState: 'RUNNING',
        updatedAt: '2026-08-30T00:00:03.000Z',
      }),
    ).rejects.toThrow(/invalid transition/);
    await expect(
      repositoryB.transitionAttempt({
        projectId: projectA,
        jobId: first.jobId,
        runId: run.runId,
        attemptId: attempt.attemptId,
        expectedLifecycleRevision: 2,
        targetState: 'QUEUED',
        updatedAt: '2026-08-30T00:00:03.000Z',
      }),
    ).rejects.toThrow(/invalid transition/);
    expect(
      await repositoryA.saveAttempt(
        attemptForRun(run, 'attempt-stage-retry', {
          attemptNumber: 2,
          attemptKind: 'DOMAIN_RETRY',
          lifecycleState: 'RUNNING',
          previousAttemptId: attempt.attemptId,
          updatedAt: '2026-08-30T00:00:04.000Z',
          completedAt: undefined,
        }),
      ),
    ).toBe('CREATED');
    expect(
      (
        await repositoryB.listAttempts({
          projectId: projectA,
          jobId: first.jobId,
          runId: run.runId,
        })
      )[0],
    ).toEqual(failedAttemptSnapshot);
    const retryRun = runForJob(first, 'run-retry');
    const otherRun = runForJob(first, 'run-other');
    await repositoryA.saveRun(retryRun);
    await repositoryA.saveRun(otherRun);
    const retryBase = attemptForRun(retryRun, 'attempt-retry-base');
    await repositoryA.saveAttempt(retryBase);
    await repositoryA.saveAttempt(attemptForRun(otherRun, 'attempt-other-base'));
    await expect(
      repositoryA.saveAttempt(
        attemptForRun(otherRun, 'attempt-cross-run-retry', {
          attemptNumber: 2,
          attemptKind: 'DOMAIN_RETRY',
          lifecycleState: 'RUNNING',
          previousAttemptId: retryBase.attemptId,
          completedAt: undefined,
        }),
      ),
    ).rejects.toThrow(/same Run/);
    const duplicateRetry = (attemptId: string): DiscoveryAttemptV1 =>
      attemptForRun(retryRun, attemptId, {
        attemptNumber: 2,
        attemptKind: 'DOMAIN_RETRY',
        lifecycleState: 'RUNNING',
        previousAttemptId: retryBase.attemptId,
        updatedAt: '2026-08-30T00:00:06.000Z',
        completedAt: undefined,
      });
    const concurrentResults = await Promise.all([
      repositoryA.saveAttempt(duplicateRetry('attempt-retry-a')),
      repositoryB.saveAttempt(duplicateRetry('attempt-retry-b')),
    ]);
    expect(concurrentResults.sort()).toEqual(['CONFLICT', 'CREATED']);
    expect(
      (
        await repositoryB.listAttempts({
          projectId: projectA,
          jobId: first.jobId,
          runId: retryRun.runId,
        })
      )[0],
    ).toEqual(retryBase);
    await expect(
      repositoryA.saveAttempt(
        attemptForRun(retryRun, 'attempt-skipped-number', {
          attemptNumber: 3,
          attemptKind: 'DOMAIN_RETRY',
          lifecycleState: 'RUNNING',
          previousAttemptId: retryBase.attemptId,
          completedAt: undefined,
        }),
      ),
    ).rejects.toThrow(/immediate predecessor/);

    for (const [runId, state] of [
      ['run-succeeded', 'SUCCEEDED'],
      ['run-terminal', 'FAILED_TERMINAL'],
      ['run-cancelled', 'CANCELLED'],
    ] as const) {
      const terminalRun = runForJob(first, runId);
      await repositoryA.saveRun(terminalRun);
      const terminalAttempt = attemptForRun(terminalRun, `${runId}-attempt`, {
        lifecycleState: state,
        completedAt: '2026-08-30T00:00:05.000Z',
      });
      await repositoryA.saveAttempt(terminalAttempt);
      await expect(
        repositoryA.saveAttempt(
          attemptForRun(terminalRun, `${runId}-retry`, {
            attemptNumber: 2,
            attemptKind: 'DOMAIN_RETRY',
            lifecycleState: 'RUNNING',
            previousAttemptId: terminalAttempt.attemptId,
            completedAt: undefined,
          }),
        ),
      ).rejects.toThrow(/predecessor must be FAILED_RETRYABLE/);
    }
  });
});
