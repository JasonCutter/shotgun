import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { PostgresDiscoveryFindingRepository } from '../../adapters/discovery-finding-postgres/src/index.js';
import { PostgresDiscoveryRuntimeRepository } from '../../adapters/discovery-runtime-postgres/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { DiscoveryFindingLifecycleService } from '../../modules/discovery-finding-lifecycle/src/index.js';
import {
  createDiscoveryFindingEnvelopeV1,
  createDiscoveryLogicalJobIdentityV1,
  type DiscoveryJobV1,
  type DiscoveryFindingEnvelopeInputV1,
  type DiscoveryResourceRefV1,
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

const findingRef = (resourceId: string): DiscoveryResourceRefV1 => ({
  schemaVersion: '1.0.0',
  resourceKind: 'CANONICAL_CLAIM',
  resourceId,
  projectId,
  resourceState: 'CURRENT',
});

const durableFinding = (
  findingId: string,
  relatedResourceRefs: readonly DiscoveryResourceRefV1[] = [],
  runId = 'finding-run',
) =>
  createDiscoveryFindingEnvelopeV1({
    schemaVersion: '1.0.0',
    findingId,
    findingRevision: 1,
    projectId,
    findingType: 'KNOWLEDGE_GAP',
    generationMethod: 'DETERMINISTIC',
    lifecycleState: 'NEW',
    payload: {
      schemaVersion: '1.0.0',
      payloadType: 'KNOWLEDGE_GAP',
      gapKind: 'MISSING_FACT',
      subject: findingId,
      missingFact: 'a current value',
      question: `What is the current value for ${findingId}?`,
    },
    relatedResourceRefs,
    evidenceIds: [],
    sourceProjectionDigest: 'sha256:source-projection',
    canonicalBase: {
      schemaVersion: '1.0.0',
      canonicalVersion: 1,
      snapshotDigest: 'sha256:canonical-snapshot',
    },
    discoveryBase: {
      schemaVersion: '1.0.0',
      projectionRevision: 'projection:1',
      projectionDigest: 'sha256:projection',
    },
    runId,
    signalSummary: {},
    rationale: 'A bounded durable finding.',
    derivationSummary: 'A PostgreSQL recovery fixture.',
    provenance: {
      schemaVersion: '1.0.0',
      kind: 'DETERMINISTIC',
      ruleId: 'wp4-test',
      ruleVersion: '1',
      inputDigest: 'sha256:wp4-test-input',
    },
    accessScope: ['owner'],
    sensitivity: 'private',
    fingerprint: `sha256:${'a'.repeat(63)}${findingId.length % 10}`,
    fingerprintVersion: 'discovery-fingerprint:v1',
    retentionClass: 'DURABLE_DERIVED_RECORD',
    createdAt: '2026-08-30T00:00:00.000Z',
  } as DiscoveryFindingEnvelopeInputV1);

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
    const client = await poolA!.connect();
    try {
      // The lifecycle history trigger is intentionally immutable in normal
      // operation; test cleanup is the one controlled administrative path.
      await client.query('SET session_replication_role = replica');
      await client.query('DELETE FROM discovery.finding_ready WHERE project_id = $1', [projectId]);
      await client.query(
        'DELETE FROM discovery.provider_budget_reservations WHERE project_id = $1',
        [projectId],
      );
      await client.query('DELETE FROM discovery.stage_outputs WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM discovery.work_budget_checkpoints WHERE project_id = $1', [
        projectId,
      ]);
      await client.query('DELETE FROM discovery.stage_history WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM discovery.stages WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM discovery.attempt_lifecycle_history WHERE project_id = $1', [
        projectId,
      ]);
      await client.query('DELETE FROM discovery.attempts WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM discovery.run_lifecycle_history WHERE project_id = $1', [
        projectId,
      ]);
      await client.query('DELETE FROM discovery.runs WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM discovery.job_lifecycle_history WHERE project_id = $1', [
        projectId,
      ]);
      await client.query('DELETE FROM discovery.jobs WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM discovery.finding_lifecycle_history WHERE project_id = $1', [
        projectId,
      ]);
      await client.query('DELETE FROM discovery.finding_lifecycle_current WHERE project_id = $1', [
        projectId,
      ]);
      await client.query('DELETE FROM discovery.findings WHERE project_id = $1', [projectId]);
    } finally {
      await client.query('SET session_replication_role = origin');
      client.release();
    }
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

  it('preserves retry failure context, creates DOMAIN_RETRY Attempt 2, and keeps the Job deadline', async () => {
    const repository = new PostgresDiscoveryRuntimeRepository(poolA!);
    const queued = job('wp4-retry-job');
    await repository.saveJob(queued);
    const first = (await repository.claimNext({
      projectId,
      workerId: 'worker-a',
      now: '2026-08-30T01:00:00.000Z',
      leaseDurationMs: 30_000,
    }))!;
    const stage = (await repository.listStages(first))[0]!;
    expect(
      await repository.transitionStageWithLease({
        ...first,
        stageId: stage.stageId,
        expectedStageRevision: stage.stageRevision,
        targetState: 'RUNNING',
        updatedAt: '2026-08-30T01:00:00.500Z',
      }),
    ).toMatchObject({ state: 'RUNNING', stageRevision: 2 });
    const retryFailure = {
      schemaVersion: '1.0.0' as const,
      code: 'TEST_RETRYABLE',
      classification: 'RETRYABLE' as const,
      retryable: true,
      safeMessage: 'A bounded retryable failure.',
      failedStage: stage.stageType,
      occurredAt: '2026-08-30T01:00:01.000Z',
      retryNotBefore: '2026-08-30T01:00:02.000Z',
    };
    expect(
      await repository.finalizeFailureWithLease({
        ...first,
        stageId: stage.stageId,
        expectedStageRevision: 2,
        expectedAttemptLifecycleRevision: first.attempt.lifecycleRevision,
        expectedRunLifecycleRevision: first.run.lifecycleRevision,
        expectedJobLifecycleRevision: first.job.lifecycleRevision,
        targetState: 'FAILED_RETRYABLE',
        failure: retryFailure,
      }),
    ).toBe('FAILED_RETRYABLE');
    const second = (await repository.claimNext({
      projectId,
      workerId: 'worker-b',
      now: '2026-08-30T01:00:02.000Z',
      leaseDurationMs: 30_000,
    }))!;
    expect(second.runId).toBe(first.runId);
    expect(second.attempt.attemptNumber).toBe(2);
    expect(second.attempt.attemptKind).toBe('DOMAIN_RETRY');
    expect(second.attempt.previousAttemptId).toBe(first.attemptId);
    expect(second.job.budget.deadlineAt).toBe(queued.budget.deadlineAt);
    expect(second.run.budget.deadlineAt).toBe(queued.budget.deadlineAt);
    await expect(
      poolA!.query(
        `SELECT failure_code, failure_classification, failure_retryable, failure_stage,
                retry_not_before::text
         FROM discovery.attempts WHERE project_id = $1 AND attempt_id = $2`,
        [projectId, first.attemptId],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          failure_code: 'TEST_RETRYABLE',
          failure_classification: 'RETRYABLE',
          failure_retryable: true,
          failure_stage: stage.stageType,
          retry_not_before: expect.stringContaining('2026-08-30 01:00:02'),
        },
      ],
    });

    const secondStage = (await repository.listStages(second))[0]!;
    expect(
      await repository.transitionStageWithLease({
        ...second,
        stageId: secondStage.stageId,
        expectedStageRevision: secondStage.stageRevision,
        targetState: 'RUNNING',
        updatedAt: '2026-08-30T01:00:02.500Z',
      }),
    ).toMatchObject({ state: 'RUNNING', stageRevision: 2 });
    expect(
      await repository.finalizeFailureWithLease({
        ...second,
        stageId: secondStage.stageId,
        expectedStageRevision: 2,
        expectedAttemptLifecycleRevision: second.attempt.lifecycleRevision,
        expectedRunLifecycleRevision: second.run.lifecycleRevision,
        expectedJobLifecycleRevision: second.job.lifecycleRevision,
        targetState: 'FAILED_TERMINAL',
        failure: {
          schemaVersion: '1.0.0',
          code: 'TEST_MAX_ATTEMPTS',
          classification: 'TERMINAL',
          retryable: false,
          safeMessage: 'The frozen maximum attempts was reached.',
          failedStage: secondStage.stageType,
          occurredAt: '2026-08-30T01:00:03.000Z',
        },
      }),
    ).toBe('FAILED_TERMINAL');
    await expect(
      poolA!.query(
        `SELECT j.lifecycle_state AS job_state, r.lifecycle_state AS run_state,
                a.lifecycle_state AS attempt_state
         FROM discovery.jobs j
         JOIN discovery.runs r USING (project_id, job_id)
         JOIN discovery.attempts a USING (project_id, job_id, run_id)
         WHERE j.project_id = $1 AND j.job_id = $2
         ORDER BY a.attempt_number DESC`,
        [projectId, queued.jobId],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          job_state: 'FAILED_TERMINAL',
          run_state: 'FAILED_TERMINAL',
          attempt_state: 'FAILED_TERMINAL',
        },
        {
          job_state: 'FAILED_TERMINAL',
          run_state: 'FAILED_TERMINAL',
          attempt_state: 'FAILED_RETRYABLE',
        },
      ],
    });
  });

  it('recovers durable stage output after reclaim without rerunning the stage', async () => {
    const repository = new PostgresDiscoveryRuntimeRepository(poolA!);
    const queued = job('wp4-output-recovery-job');
    await repository.saveJob(queued);
    const first = (await repository.claimNext({
      projectId,
      workerId: 'worker-a',
      now: '2026-08-30T01:00:00.000Z',
      leaseDurationMs: 1_000,
    }))!;
    const stage = (await repository.listStages(first))[2]!;
    expect(
      await repository.transitionStageWithLease({
        ...first,
        stageId: stage.stageId,
        expectedStageRevision: stage.stageRevision,
        targetState: 'RUNNING',
        updatedAt: '2026-08-30T01:00:00.100Z',
      }),
    ).toMatchObject({ state: 'RUNNING' });
    const stageOutput = {
      schemaVersion: '1.0.0' as const,
      projectId,
      jobId: queued.jobId,
      runId: first.runId,
      attemptId: first.attemptId,
      stageId: stage.stageId,
      stageType: 'GENERATE_FINDINGS' as const,
      stageRevision: 2,
      output: { schemaVersion: '1.0.0' as const, candidates: [] },
      updatedAt: '2026-08-30T01:00:00.200Z',
    };
    expect(await repository.writeStageOutput({ ...first, output: stageOutput })).toBe('SAVED');
    expect(
      await repository.readStageOutput({
        projectId,
        runId: first.runId,
        attemptId: first.attemptId,
        stageId: stage.stageId,
      }),
    ).toMatchObject({
      output: { schemaVersion: '1.0.0', candidates: [] },
      stageRevision: 2,
    });
    const reclaimed = (await repository.claimNext({
      projectId,
      workerId: 'worker-b',
      now: '2026-08-30T01:00:02.000Z',
      leaseDurationMs: 30_000,
    }))!;
    expect(reclaimed.runId).toBe(first.runId);
    expect(reclaimed.attemptId).toBe(first.attemptId);
    expect(reclaimed.fencingToken).toBeGreaterThan(first.fencingToken);
    expect(
      await repository.readStageOutput({
        projectId,
        runId: reclaimed.runId,
        attemptId: reclaimed.attemptId,
        stageId: stage.stageId,
      }),
    ).toMatchObject({
      output: { schemaVersion: '1.0.0', candidates: [] },
      stageRevision: 2,
    });
  });

  it('reclaims a PARTIAL reconciliation stage with its cursor under a new fence', async () => {
    const repository = new PostgresDiscoveryRuntimeRepository(poolA!);
    const queued = job('wp4-reconciliation-partial-job');
    await repository.saveJob(queued);
    const first = (await repository.claimNext({
      projectId,
      workerId: 'worker-a',
      now: '2026-08-30T01:00:00.000Z',
      leaseDurationMs: 1_000,
    }))!;
    const stage = (await repository.listStages(first))[6]!;
    const running = await repository.transitionStageWithLease({
      ...first,
      stageId: stage.stageId,
      expectedStageRevision: stage.stageRevision,
      targetState: 'RUNNING',
      updatedAt: '2026-08-30T01:00:00.100Z',
    });
    expect(running).toMatchObject({ state: 'RUNNING', stageRevision: 2 });
    expect(
      await repository.writeStageOutput({
        ...first,
        output: {
          schemaVersion: '1.0.0',
          projectId,
          jobId: queued.jobId,
          runId: first.runId,
          attemptId: first.attemptId,
          stageId: stage.stageId,
          stageType: 'RECONCILE_FINDINGS',
          stageRevision: 3,
          output: {
            schemaVersion: '1.0.0',
            completed: false,
            processed: 1,
            cursor: { findingId: 'reconciliation-cursor', findingRevision: 1 },
          },
          updatedAt: '2026-08-30T01:00:00.200Z',
        },
      }),
    ).toBe('SAVED');
    expect(
      await repository.transitionStageWithLease({
        ...first,
        stageId: stage.stageId,
        expectedStageRevision: 2,
        targetState: 'FAILED_RETRYABLE',
        updatedAt: '2026-08-30T01:00:00.300Z',
      }),
    ).toMatchObject({ state: 'FAILED_RETRYABLE', stageRevision: 3 });
    expect(
      await repository.finalizeClaimWithLease({
        ...first,
        expectedAttemptLifecycleRevision: first.attempt.lifecycleRevision,
        expectedRunLifecycleRevision: first.run.lifecycleRevision,
        expectedJobLifecycleRevision: first.job.lifecycleRevision,
        targetState: 'PARTIAL',
        updatedAt: '2026-08-30T01:00:00.400Z',
      }),
    ).toBe('PARTIAL');

    const reclaimed = (await repository.claimNext({
      projectId,
      workerId: 'worker-b',
      now: '2026-08-30T01:00:02.000Z',
      leaseDurationMs: 30_000,
    }))!;
    expect(reclaimed.runId).toBe(first.runId);
    expect(reclaimed.attemptId).toBe(first.attemptId);
    expect(reclaimed.fencingToken).toBeGreaterThan(first.fencingToken);
    expect((await repository.listStages(reclaimed))[6]).toMatchObject({
      state: 'FAILED_RETRYABLE',
      stageRevision: 3,
    });
    expect(
      await repository.readStageOutput({
        projectId,
        runId: reclaimed.runId,
        attemptId: reclaimed.attemptId,
        stageId: stage.stageId,
      }),
    ).toMatchObject({
      output: {
        completed: false,
        processed: 1,
        cursor: { findingId: 'reconciliation-cursor', findingRevision: 1 },
      },
    });
  });

  it('releases a crashed provider reservation slot after reclaim while retaining cumulative admission', async () => {
    const repository = new PostgresDiscoveryRuntimeRepository(poolA!);
    const queued = job('wp4-provider-recovery-job');
    await repository.saveJob(queued);
    const first = (await repository.claimNext({
      projectId,
      workerId: 'worker-a',
      now: '2026-08-30T01:00:00.000Z',
      leaseDurationMs: 1_000,
    }))!;
    const reservation = {
      schemaVersion: '1.0.0' as const,
      projectId,
      jobId: queued.jobId,
      runId: first.runId,
      attemptId: first.attemptId,
      reservationId: 'wp4-crashed-provider-call',
      providerId: 'fake-provider',
      modelId: 'fake-model',
      inputTokenUpperBound: 10,
      maxOutputTokens: 10,
      estimatedCostMicros: 20,
      state: 'RESERVED' as const,
      updatedAt: '2026-08-30T01:00:00.100Z',
    };
    expect(await repository.reserveProviderCall({ ...first, reservation })).toBe('RESERVED');
    await expect(
      repository.readProviderReservationUsage({
        projectId,
        jobId: queued.jobId,
        runId: first.runId,
      }),
    ).resolves.toMatchObject({
      providerCalls: 1,
      activeProviderCalls: 1,
      inputTokens: 10,
      outputTokens: 10,
      estimatedCostMicros: 20,
    });
    const reclaimed = (await repository.claimNext({
      projectId,
      workerId: 'worker-b',
      now: '2026-08-30T01:00:02.000Z',
      leaseDurationMs: 30_000,
    }))!;
    await expect(
      repository.readProviderReservationUsage({
        projectId,
        jobId: queued.jobId,
        runId: reclaimed.runId,
      }),
    ).resolves.toMatchObject({ providerCalls: 1, activeProviderCalls: 0, inputTokens: 10 });
    expect(
      await repository.finalizeProviderCall({
        ...first,
        reservationId: reservation.reservationId,
        state: 'CANCELLED',
        updatedAt: '2026-08-30T01:00:02.100Z',
      }),
    ).toBe('STALE');
    const secondReservation = { ...reservation, reservationId: 'wp4-retry-provider-call' };
    expect(
      await repository.reserveProviderCall({ ...reclaimed, reservation: secondReservation }),
    ).toBe('RESERVED');
    expect(
      await repository.finalizeProviderCall({
        ...reclaimed,
        reservationId: secondReservation.reservationId,
        state: 'FINALIZED',
        actualInputTokens: 4,
        actualOutputTokens: 3,
        actualCostMicros: 7,
        updatedAt: '2026-08-30T01:00:02.200Z',
      }),
    ).toBe('FINALIZED');
    await expect(
      repository.readProviderReservationUsage({
        projectId,
        jobId: queued.jobId,
        runId: reclaimed.runId,
      }),
    ).resolves.toMatchObject({ providerCalls: 2, activeProviderCalls: 0, inputTokens: 14 });
  });

  it('replays FindingReady after save/publication crashes and across DOMAIN_RETRY without duplication', async () => {
    const repository = new PostgresDiscoveryRuntimeRepository(poolA!);
    const findings = new PostgresDiscoveryFindingRepository(poolA!);
    const queued = job('wp4-finding-ready-job');
    await repository.saveJob(queued);
    const first = (await repository.claimNext({
      projectId,
      workerId: 'worker-a',
      now: '2026-08-30T01:00:00.000Z',
      leaseDurationMs: 1_000,
    }))!;
    const finding = durableFinding('finding-ready-replay', [], first.runId);
    expect(await findings.save(finding)).toBe('CREATED');
    const publication = (claim: typeof first, publicationId: string, occurredAt: string) => ({
      schemaVersion: '1.0.0' as const,
      publicationId,
      projectId,
      findingId: finding.findingId,
      findingRevision: finding.findingRevision,
      fingerprint: finding.fingerprint,
      fingerprintVersion: finding.fingerprintVersion,
      jobId: queued.jobId,
      runId: claim.runId,
      attemptId: claim.attemptId,
      canonicalBase: finding.canonicalBase,
      requiredDiscoveryBase: finding.discoveryBase,
      occurredAt,
    });
    expect(
      await repository.publishFindingReady({
        ...first,
        publication: publication(
          first,
          'finding-ready-before-stage-success',
          '2026-08-30T01:00:00.200Z',
        ),
      }),
    ).toBe('CREATED');
    expect(
      await repository.publishFindingReady({
        ...first,
        publication: publication(
          first,
          'finding-ready-same-attempt-replay',
          '2026-08-30T01:00:00.300Z',
        ),
      }),
    ).toBe('ALREADY_EXISTS');

    const reclaimed = (await repository.claimNext({
      projectId,
      workerId: 'worker-b',
      now: '2026-08-30T01:00:02.000Z',
      leaseDurationMs: 30_000,
    }))!;
    expect(
      await repository.publishFindingReady({
        ...first,
        publication: publication(first, 'finding-ready-stale-worker', '2026-08-30T01:00:02.100Z'),
      }),
    ).toBe('STALE');
    expect(
      await repository.publishFindingReady({
        ...reclaimed,
        publication: publication(
          reclaimed,
          'finding-ready-after-publication-crash',
          '2026-08-30T01:00:02.200Z',
        ),
      }),
    ).toBe('ALREADY_EXISTS');

    const retryJob = job('wp4-finding-ready-domain-retry-job');
    await repository.saveJob(retryJob);
    const retryFirst = (await repository.claimNext({
      projectId,
      workerId: 'worker-c',
      now: '2026-08-30T01:00:00.000Z',
      leaseDurationMs: 30_000,
    }))!;
    const retryFinding = durableFinding('finding-ready-domain-retry', [], retryFirst.runId);
    expect(await findings.save(retryFinding)).toBe('CREATED');
    const retryStage = (await repository.listStages(retryFirst))[0]!;
    expect(
      await repository.transitionStageWithLease({
        ...retryFirst,
        stageId: retryStage.stageId,
        expectedStageRevision: retryStage.stageRevision,
        targetState: 'RUNNING',
        updatedAt: '2026-08-30T01:00:00.500Z',
      }),
    ).toMatchObject({ state: 'RUNNING', stageRevision: 2 });
    expect(
      await repository.finalizeFailureWithLease({
        ...retryFirst,
        stageId: retryStage.stageId,
        expectedStageRevision: 2,
        expectedAttemptLifecycleRevision: retryFirst.attempt.lifecycleRevision,
        expectedRunLifecycleRevision: retryFirst.run.lifecycleRevision,
        expectedJobLifecycleRevision: retryFirst.job.lifecycleRevision,
        targetState: 'FAILED_RETRYABLE',
        failure: {
          schemaVersion: '1.0.0',
          code: 'TEST_FINDING_READY_RETRY',
          classification: 'RETRYABLE',
          retryable: true,
          safeMessage: 'Retry after FindingReady publication.',
          failedStage: retryStage.stageType,
          occurredAt: '2026-08-30T01:00:01.000Z',
          retryNotBefore: '2026-08-30T01:00:02.000Z',
        },
      }),
    ).toBe('FAILED_RETRYABLE');
    const retrySecond = (await repository.claimNext({
      projectId,
      workerId: 'worker-d',
      now: '2026-08-30T01:00:02.000Z',
      leaseDurationMs: 30_000,
    }))!;
    expect(retrySecond.attempt.attemptKind).toBe('DOMAIN_RETRY');
    expect(
      await repository.publishFindingReady({
        ...retrySecond,
        publication: {
          ...publication(retrySecond, 'finding-ready-domain-retry', '2026-08-30T01:00:02.200Z'),
          jobId: retryJob.jobId,
          findingId: retryFinding.findingId,
          findingRevision: retryFinding.findingRevision,
          fingerprint: retryFinding.fingerprint,
          fingerprintVersion: retryFinding.fingerprintVersion,
          canonicalBase: retryFinding.canonicalBase,
          requiredDiscoveryBase: retryFinding.discoveryBase,
        },
      }),
    ).toBe('CREATED');
    expect(
      await repository.publishFindingReady({
        ...retrySecond,
        publication: {
          ...publication(
            retrySecond,
            'finding-ready-domain-retry-replay',
            '2026-08-30T01:00:02.300Z',
          ),
          jobId: retryJob.jobId,
          findingId: retryFinding.findingId,
          findingRevision: retryFinding.findingRevision,
          fingerprint: retryFinding.fingerprint,
          fingerprintVersion: retryFinding.fingerprintVersion,
          canonicalBase: retryFinding.canonicalBase,
          requiredDiscoveryBase: retryFinding.discoveryBase,
        },
      }),
    ).toBe('ALREADY_EXISTS');
  });

  it('rejects a stale reconciliation fence and preserves lifecycle authority', async () => {
    const repository = new PostgresDiscoveryRuntimeRepository(poolA!);
    const findings = new PostgresDiscoveryFindingRepository(poolA!);
    const queued = job('wp4-reconciliation-fence-job');
    await repository.saveJob(queued);
    const claim = (await repository.claimNext({
      projectId,
      workerId: 'worker-a',
      now: '2026-08-30T01:00:00.000Z',
      leaseDurationMs: 1_000,
    }))!;
    const finding = durableFinding(
      'reconciliation-fence-finding',
      [findingRef('claim-a')],
      claim.runId,
    );
    expect(await findings.save(finding)).toBe('CREATED');
    const lifecycle = await findings.findLifecycle(finding);
    expect(lifecycle?.lifecycleState).toBe('NEW');
    const lifecycleInput = {
      projectId,
      findingId: finding.findingId,
      findingRevision: finding.findingRevision,
      expectedLifecycleRevision: lifecycle!.lifecycleRevision,
      targetState: 'STALE' as const,
      cause: 'SYSTEM_RECONCILIATION' as const,
      reasonCode: 'RELEVANT_INPUT_CHANGED' as const,
      occurredAt: '2026-08-30T01:00:00.500Z',
    };
    expect(
      await findings.transitionLifecycle(lifecycleInput, {
        ...claim,
        now: '2026-08-30T01:00:00.500Z',
      }),
    ).toMatchObject({ status: 'APPLIED', lifecycle: { lifecycleState: 'STALE' } });
    expect(
      await findings.transitionLifecycle(
        { ...lifecycleInput, expectedLifecycleRevision: lifecycle!.lifecycleRevision },
        {
          ...claim,
          fencingToken: claim.fencingToken - 1,
          now: '2026-08-30T01:00:00.600Z',
        },
      ),
    ).toMatchObject({ status: 'CONFLICT', current: { lifecycleState: 'STALE' } });
  });

  it('persists every reconciliation disposition and leaves unchanged findings untouched', async () => {
    const repository = new PostgresDiscoveryFindingRepository(poolA!);
    const service = new DiscoveryFindingLifecycleService(repository);
    const cases = [
      ['UNCHANGED', 'NEW'],
      ['CANONICAL_EQUIVALENT_ACCEPTED', 'RESOLVED'],
      ['RELEVANT_INPUT_CHANGED', 'STALE'],
      ['SOURCE_MATERIALLY_SUPERSEDED', 'SUPERSEDED'],
    ] as const;
    for (const [disposition, expectedState] of cases) {
      const finding = durableFinding(`reconciliation-${disposition.toLowerCase()}`);
      expect(await repository.save(finding)).toBe('CREATED');
      const result = await service.reconcile({
        finding,
        expectedLifecycleRevision: 1,
        observation: {
          projectId,
          findingId: finding.findingId,
          findingRevision: finding.findingRevision,
          disposition,
          canonicalBase: finding.canonicalBase,
          discoveryBase: finding.discoveryBase,
        },
        occurredAt: '2026-08-30T01:00:03.000Z',
      });
      expect(result.status).toBe(disposition === 'UNCHANGED' ? 'UNCHANGED' : 'TRANSITIONED');
      expect(await repository.findLifecycle(finding)).toMatchObject({
        lifecycleState: expectedState,
        lifecycleRevision: disposition === 'UNCHANGED' ? 1 : 2,
      });
    }
  });
});
