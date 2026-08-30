import { describe, expect, it } from 'vitest';

import {
  PersistentDiscoveryWorker,
  DiscoveryWorkerFailureV1,
  type DiscoveryExecutionPortV1,
  type DiscoveryRuntimeClaimV1,
  type DiscoveryRuntimeExecutionRepositoryPort,
  type DiscoveryRuntimeStageOutputV1,
} from '../../modules/discovery-runtime/src/index.js';
import { DiscoveryWorkBudgetLedgerV1 } from '../../modules/discovery-quality-gate/src/index.js';
import type {
  DiscoveryAttemptV1,
  DiscoveryJobV1,
  DiscoveryRunV1,
  DiscoveryStageV1,
  DiscoveryTriggerV1,
} from '../../packages/contracts/src/index.js';

const budget = {
  schemaVersion: '1.0.0' as const,
  budgetVersion: 'discovery-work-budget:v1' as const,
  budgetId: 'budget',
  budgetRevision: '1',
  maxResources: 10,
  maxSemanticNeighbors: 10,
  maxCandidatePairs: 10,
  maxCandidateGroups: 10,
  maxFindings: 10,
  maxProviderCalls: 1,
  maxInputTokens: 100,
  maxOutputTokens: 100,
  maxOutputTokensPerCall: 50,
  maxEstimatedCostMicros: 100,
  maxConcurrentProviderCalls: 1,
  deadlineAt: '2099-01-01T00:00:00.000Z',
};

const trigger: DiscoveryTriggerV1 = {
  schemaVersion: '1.0.0',
  triggerId: 'trigger',
  triggerClass: 'MANUAL',
  triggerIdentity: { kind: 'MANUAL', commandId: 'command', requestId: 'request' },
  projectId: 'project',
  requestedScanMode: 'INCREMENTAL',
  effectiveScanMode: 'INCREMENTAL',
  canonicalBase: { schemaVersion: '1.0.0', canonicalVersion: 1, snapshotDigest: 'canonical' },
  requiredDiscoveryBase: {
    schemaVersion: '1.0.0',
    projectionRevision: 'projection:1',
    projectionDigest: 'projection',
  },
  policyRevision: 'policy',
  strategyRevision: 'strategy',
  createdAt: '2026-08-30T00:00:00.000Z',
  observedAt: '2026-08-30T00:00:00.000Z',
  actor: { actorId: 'test', principalId: 'test' },
};

const job: DiscoveryJobV1 = {
  schemaVersion: '1.0.0',
  jobId: 'job',
  logicalIdentity: {
    schemaVersion: '1.0.0',
    identityVersion: 'discovery-job-logical:v1',
    value: 'logical',
  },
  projectId: 'project',
  trigger,
  requestedScanMode: trigger.requestedScanMode,
  effectiveScanMode: trigger.effectiveScanMode,
  canonicalBase: trigger.canonicalBase,
  requiredDiscoveryBase: trigger.requiredDiscoveryBase,
  policyRevision: trigger.policyRevision,
  strategyRevision: trigger.strategyRevision,
  budget,
  lifecycleState: 'RUNNING',
  lifecycleRevision: 1,
  createdAt: trigger.createdAt,
  updatedAt: trigger.createdAt,
};

const run: DiscoveryRunV1 = {
  schemaVersion: '1.0.0',
  runId: 'run',
  jobId: job.jobId,
  projectId: job.projectId,
  requestedScanMode: job.requestedScanMode,
  effectiveScanMode: job.effectiveScanMode,
  runRevision: 1,
  canonicalBase: job.canonicalBase,
  requiredDiscoveryBase: job.requiredDiscoveryBase,
  policyRevision: job.policyRevision,
  strategyRevision: job.strategyRevision,
  budget,
  lifecycleState: 'RUNNING',
  lifecycleRevision: 1,
  createdAt: trigger.createdAt,
  updatedAt: trigger.createdAt,
};

const attempt: DiscoveryAttemptV1 = {
  schemaVersion: '1.0.0',
  attemptId: 'attempt',
  jobId: job.jobId,
  runId: run.runId,
  projectId: job.projectId,
  attemptNumber: 1,
  lifecycleRevision: 1,
  attemptKind: 'INITIAL',
  lifecycleState: 'RUNNING',
  createdAt: trigger.createdAt,
  updatedAt: trigger.createdAt,
};

const claim: DiscoveryRuntimeClaimV1 = {
  projectId: job.projectId,
  jobId: job.jobId,
  runId: run.runId,
  attemptId: attempt.attemptId,
  workerId: 'worker',
  fencingToken: 1,
  acquiredAt: '2026-08-30T00:00:01.000Z',
  expiresAt: '2099-01-01T00:00:00.000Z',
  job,
  run,
  attempt,
};

class ContractRuntimeRepository {
  public readonly stageTransitions: string[] = [];
  public readonly lifecycleTransitions: string[] = [];
  private claimed = false;

  public constructor(private readonly succeededStageOrdinals: readonly number[] = []) {}

  async claimNext(): Promise<DiscoveryRuntimeClaimV1 | undefined> {
    if (this.claimed) return undefined;
    this.claimed = true;
    return claim;
  }

  async readBudgetCheckpoint() {
    return undefined;
  }

  async listStages(): Promise<readonly DiscoveryStageV1[]> {
    const stageTypes = [
      'WAIT_FOR_PROJECTION',
      'LOAD_SIGNALS',
      'GENERATE_FINDINGS',
      'QUALITY_GATE',
      'PERSIST_FINDINGS',
      'PUBLISH_REENTRY',
      'RECONCILE_FINDINGS',
    ] as const;
    return [...stageTypes].map((stageType, index) => ({
      schemaVersion: '1.0.0',
      stageId: `stage-${index + 1}`,
      jobId: job.jobId,
      runId: run.runId,
      attemptId: attempt.attemptId,
      projectId: job.projectId,
      stageOrdinal: index + 1,
      stageType,
      stageRevision: 1,
      state: this.succeededStageOrdinals.includes(index + 1) ? 'SUCCEEDED' : 'QUEUED',
      createdAt: trigger.createdAt,
      updatedAt: trigger.createdAt,
    }));
  }

  async renewLease(input: Parameters<DiscoveryRuntimeExecutionRepositoryPort['renewLease']>[0]) {
    return input;
  }

  async transitionStageWithLease(
    input: Parameters<DiscoveryRuntimeExecutionRepositoryPort['transitionStageWithLease']>[0],
  ) {
    this.stageTransitions.push(`${input.stageId}:${input.targetState}`);
    return {
      schemaVersion: '1.0.0' as const,
      stageId: input.stageId,
      jobId: job.jobId,
      runId: input.runId,
      attemptId: input.attemptId,
      projectId: input.projectId,
      stageOrdinal: Number(input.stageId.split('-')[1]),
      stageType: [
        'WAIT_FOR_PROJECTION',
        'LOAD_SIGNALS',
        'GENERATE_FINDINGS',
        'QUALITY_GATE',
        'PERSIST_FINDINGS',
        'PUBLISH_REENTRY',
        'RECONCILE_FINDINGS',
      ][Number(input.stageId.split('-')[1]) - 1] as DiscoveryStageV1['stageType'],
      stageRevision: input.expectedStageRevision + 1,
      state: input.targetState,
      createdAt: trigger.createdAt,
      updatedAt: input.updatedAt,
    } satisfies DiscoveryStageV1;
  }

  async transitionAttemptWithLease(
    input: Parameters<DiscoveryRuntimeExecutionRepositoryPort['transitionAttemptWithLease']>[0],
  ) {
    this.lifecycleTransitions.push(`attempt:${input.targetState}`);
    return { ...attempt, lifecycleState: input.targetState, lifecycleRevision: 2 };
  }

  async transitionRunWithLease(
    input: Parameters<DiscoveryRuntimeExecutionRepositoryPort['transitionRunWithLease']>[0],
  ) {
    this.lifecycleTransitions.push(`run:${input.targetState}`);
    return { ...run, lifecycleState: input.targetState, lifecycleRevision: 2 };
  }

  async transitionJobWithLease(
    input: Parameters<DiscoveryRuntimeExecutionRepositoryPort['transitionJobWithLease']>[0],
  ) {
    this.lifecycleTransitions.push(`job:${input.targetState}`);
    return { ...job, lifecycleState: input.targetState, lifecycleRevision: 2 };
  }

  async finalizeClaimWithLease(
    input: Parameters<DiscoveryRuntimeExecutionRepositoryPort['finalizeClaimWithLease']>[0],
  ) {
    this.lifecycleTransitions.push(`attempt:${input.targetState}`);
    this.lifecycleTransitions.push(`run:${input.targetState}`);
    this.lifecycleTransitions.push(`job:${input.targetState}`);
    return input.targetState === 'PARTIAL' ? ('PARTIAL' as const) : ('COMPLETED' as const);
  }

  async releaseLease() {
    return 'RELEASED' as const;
  }
}

class DurableRuntimeRepository extends ContractRuntimeRepository {
  public readonly stageOutputs = new Map<string, unknown>();

  public constructor(private readonly recoveredStageTypes: readonly string[] = []) {
    super();
  }

  async readStageOutput(
    input: Parameters<NonNullable<DiscoveryRuntimeExecutionRepositoryPort['readStageOutput']>>[0],
  ): Promise<DiscoveryRuntimeStageOutputV1 | undefined> {
    const stageType =
      [
        'WAIT_FOR_PROJECTION',
        'LOAD_SIGNALS',
        'GENERATE_FINDINGS',
        'QUALITY_GATE',
        'PERSIST_FINDINGS',
        'PUBLISH_REENTRY',
        'RECONCILE_FINDINGS',
      ][Number(input.stageId.split('-')[1]) - 1] ?? '';
    return this.recoveredStageTypes.includes(stageType)
      ? {
          schemaVersion: '1.0.0',
          projectId: claim.projectId,
          jobId: claim.jobId,
          runId: claim.runId,
          attemptId: claim.attemptId,
          stageId: input.stageId,
          stageType: stageType as DiscoveryRuntimeStageOutputV1['stageType'],
          stageRevision: 1,
          output:
            stageType === 'GENERATE_FINDINGS' ? { schemaVersion: '1.0.0', candidates: [] } : [],
          updatedAt: trigger.createdAt,
        }
      : undefined;
  }

  async writeStageOutput(
    input: Parameters<NonNullable<DiscoveryRuntimeExecutionRepositoryPort['writeStageOutput']>>[0],
  ) {
    this.stageOutputs.set(input.output.stageType, input.output.output);
    return 'SAVED' as const;
  }
}

class AtomicFailureRuntimeRepository extends ContractRuntimeRepository {
  public readonly failureFinalizations: string[] = [];

  async finalizeFailureWithLease(
    input: Parameters<
      NonNullable<DiscoveryRuntimeExecutionRepositoryPort['finalizeFailureWithLease']>
    >[0],
  ) {
    this.failureFinalizations.push(`${input.targetState}:${input.failure.failedStage}`);
    return input.targetState;
  }
}

const execution: DiscoveryExecutionPortV1 = {
  loadSignals: async () => ({ value: { loaded: true } }),
  generateFindings: async () => ({ value: [] }),
  qualityGate: async () => ({ value: [] }),
  persistFindings: async (_context, findings) => ({ value: findings }),
};

describe('AKP-4 WP4 durable execution contract', () => {
  it('runs the seven durable stages, finalizes lineage, and does not reclaim a completed claim', async () => {
    const fake = new ContractRuntimeRepository();
    const worker = new PersistentDiscoveryWorker(
      fake as unknown as DiscoveryRuntimeExecutionRepositoryPort,
      execution,
      { workerId: 'worker', clock: () => new Date('2026-08-30T00:00:02.000Z') },
    );

    expect(await worker.runOnce()).toBe('COMPLETED');
    expect(fake.stageTransitions.filter((entry) => entry.endsWith(':RUNNING'))).toHaveLength(7);
    expect(fake.stageTransitions.filter((entry) => entry.endsWith(':SUCCEEDED'))).toHaveLength(7);
    expect(fake.lifecycleTransitions).toEqual([
      'attempt:SUCCEEDED',
      'run:SUCCEEDED',
      'job:SUCCEEDED',
    ]);
    expect(await worker.runOnce()).toBe('IDLE');
  });

  it('does not re-execute completed stages and rehydrates persisted findings for later stages', async () => {
    const fake = new ContractRuntimeRepository([1, 2, 3, 4, 5]);
    let rehydrations = 0;
    const worker = new PersistentDiscoveryWorker(
      fake as unknown as DiscoveryRuntimeExecutionRepositoryPort,
      {
        ...execution,
        loadPersistedFindings: async () => {
          rehydrations += 1;
          return [];
        },
      },
      { workerId: 'worker', clock: () => new Date('2026-08-30T00:00:02.000Z') },
    );

    expect(await worker.runOnce()).toBe('COMPLETED');
    expect(fake.stageTransitions.filter((entry) => entry.endsWith(':RUNNING'))).toEqual([
      'stage-6:RUNNING',
      'stage-7:RUNNING',
    ]);
    expect(rehydrations).toBe(2);
  });

  it('restores cumulative budget usage without extending the frozen budget', () => {
    const ledger = new DiscoveryWorkBudgetLedgerV1(budget);
    expect(ledger.consume('resources', 3)).toBe(true);
    ledger.restore({ ...ledger.snapshot(), resources: 8 });
    expect(ledger.snapshot().resources).toBe(8);
    expect(ledger.remainingWork('resources')).toBe(2);
    expect(() => ledger.restore({ ...ledger.snapshot(), resources: 11 })).toThrow(
      'outside the frozen budget',
    );
  });

  it('writes normalized generation, quality, and persistence outputs before stage success', async () => {
    const fake = new DurableRuntimeRepository();
    const worker = new PersistentDiscoveryWorker(
      fake as unknown as DiscoveryRuntimeExecutionRepositoryPort,
      execution,
      { workerId: 'worker', clock: () => new Date('2026-08-30T00:00:02.000Z') },
    );

    expect(await worker.runOnce()).toBe('COMPLETED');
    expect([...fake.stageOutputs.keys()]).toEqual([
      'GENERATE_FINDINGS',
      'QUALITY_GATE',
      'PERSIST_FINDINGS',
    ]);
  });

  it('uses atomic failure finalization for a retryable stage error', async () => {
    const fake = new AtomicFailureRuntimeRepository();
    const worker = new PersistentDiscoveryWorker(
      fake as unknown as DiscoveryRuntimeExecutionRepositoryPort,
      {
        ...execution,
        loadSignals: async () => {
          throw new DiscoveryWorkerFailureV1({
            code: 'TEST_RETRYABLE',
            retryable: true,
            safeMessage: 'test retryable failure',
          });
        },
      },
      { workerId: 'worker', clock: () => new Date('2026-08-30T00:00:02.000Z') },
    );

    expect(await worker.runOnce()).toBe('FAILED_RETRYABLE');
    expect(fake.failureFinalizations).toEqual(['FAILED_RETRYABLE:stage-2']);
  });

  it('reuses durable stage values after reclaim without rerunning completed stages', async () => {
    const fake = new DurableRuntimeRepository([
      'GENERATE_FINDINGS',
      'QUALITY_GATE',
      'PERSIST_FINDINGS',
    ]);
    const rerunCalls: string[] = [];
    const worker = new PersistentDiscoveryWorker(
      fake as unknown as DiscoveryRuntimeExecutionRepositoryPort,
      {
        ...execution,
        generateFindings: async () => {
          rerunCalls.push('generate');
          return { value: [] };
        },
        qualityGate: async () => {
          rerunCalls.push('quality');
          return { value: [] };
        },
        persistFindings: async () => {
          rerunCalls.push('persist');
          return { value: [] };
        },
      },
      { workerId: 'worker', clock: () => new Date('2026-08-30T00:00:02.000Z') },
    );

    expect(await worker.runOnce()).toBe('COMPLETED');
    expect(rerunCalls).toEqual([]);
  });
});
