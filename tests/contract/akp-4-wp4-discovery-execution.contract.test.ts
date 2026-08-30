import { describe, expect, it } from 'vitest';

import {
  PersistentDiscoveryWorker,
  type DiscoveryExecutionPortV1,
  type DiscoveryRuntimeClaimV1,
  type DiscoveryRuntimeExecutionRepositoryPort,
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
});
