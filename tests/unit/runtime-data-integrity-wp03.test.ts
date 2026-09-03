import { describe, expect, it, vi } from 'vitest';

import {
  AsyncCleanupStack,
  CleanupAggregateError,
} from '../../assemblies/shotgun-app/src/cleanup-stack.js';
import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import {
  PersistentDiscoveryWorker,
  type DiscoveryExecutionPortV1,
  type DiscoveryRuntimeClaimV1,
  type DiscoveryRuntimeExecutionRepositoryPort,
} from '../../modules/discovery-runtime/src/index.js';

const claim = {
  projectId: 'project',
  jobId: 'job',
  runId: 'run',
  attemptId: 'attempt',
  workerId: 'worker',
  fencingToken: 1,
  acquiredAt: '2026-09-03T00:00:00.000Z',
  expiresAt: '2099-01-01T00:00:00.000Z',
  job: {
    lifecycleState: 'RUNNING',
    lifecycleRevision: 1,
    budget: {
      maxProviderCalls: 1,
      maxConcurrentProviderCalls: 1,
      maxInputTokens: 100,
      maxOutputTokens: 100,
      maxEstimatedCostMicros: 100,
    },
  },
  run: { lifecycleState: 'RUNNING', lifecycleRevision: 1 },
  attempt: { lifecycleState: 'RUNNING', lifecycleRevision: 1, attemptNumber: 1 },
} as unknown as DiscoveryRuntimeClaimV1;

class RuntimeRepository {
  public claimed = false;
  public released = 0;
  public finalized = 0;
  public claimFailures = 0;

  async claimNext() {
    if (this.claimFailures > 0) {
      this.claimFailures -= 1;
      throw new Error('repository unavailable');
    }
    if (this.claimed) return undefined;
    this.claimed = true;
    return claim;
  }

  async readBudgetCheckpoint() {
    return undefined;
  }

  async listStages() {
    return ['WAIT_FOR_PROJECTION', 'LOAD_SIGNALS'].map((stageType, index) => ({
      schemaVersion: '1.0.0' as const,
      stageId: `stage-${index + 1}`,
      jobId: claim.jobId,
      runId: claim.runId,
      attemptId: claim.attemptId,
      projectId: claim.projectId,
      stageOrdinal: index + 1,
      stageType: stageType as 'WAIT_FOR_PROJECTION' | 'LOAD_SIGNALS',
      stageRevision: 1,
      state: 'QUEUED' as const,
      createdAt: claim.acquiredAt,
      updatedAt: claim.acquiredAt,
    }));
  }

  async renewLease(input: Parameters<DiscoveryRuntimeExecutionRepositoryPort['renewLease']>[0]) {
    return input;
  }

  async transitionStageWithLease(
    input: Parameters<DiscoveryRuntimeExecutionRepositoryPort['transitionStageWithLease']>[0],
  ) {
    return {
      schemaVersion: '1.0.0' as const,
      stageId: input.stageId,
      jobId: claim.jobId,
      runId: claim.runId,
      attemptId: claim.attemptId,
      projectId: claim.projectId,
      stageOrdinal: Number(input.stageId.replace('stage-', '')),
      stageType:
        input.stageId === 'stage-1' ? ('WAIT_FOR_PROJECTION' as const) : ('LOAD_SIGNALS' as const),
      stageRevision: input.expectedStageRevision + 1,
      state: input.targetState,
      createdAt: claim.acquiredAt,
      updatedAt: input.updatedAt,
    };
  }

  async finalizeClaimWithLease() {
    this.finalized += 1;
    return 'COMPLETED' as const;
  }

  async releaseLease() {
    this.released += 1;
    return 'RELEASED' as const;
  }
}

const execution = (
  loadSignals: DiscoveryExecutionPortV1['loadSignals'],
): DiscoveryExecutionPortV1 => ({
  loadSignals,
  generateFindings: async () => ({ value: [] }),
  qualityGate: async () => ({ value: [] }),
  persistFindings: async (_context, findings) => ({ value: findings }),
});

describe('WP-03 lifecycle and cancellation contracts', () => {
  it('runs cleanup in LIFO order, continues after failure, and is idempotent', async () => {
    const order: string[] = [];
    const stack = new AsyncCleanupStack();
    stack.add('first', () => {
      order.push('first');
    });
    stack.add('second', () => {
      order.push('second');
      throw new Error('protected detail must not escape');
    });
    stack.add('third', () => {
      order.push('third');
    });

    await expect(stack.close()).rejects.toBeInstanceOf(CleanupAggregateError);
    await expect(stack.close()).rejects.toBeInstanceOf(CleanupAggregateError);
    expect(order).toEqual(['third', 'second', 'first']);
  });

  it('aborts a claim on stop without consuming business failure state', async () => {
    const repository = new RuntimeRepository();
    let started: (() => void) | undefined;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    let observedSignal: AbortSignal | undefined;
    const worker = new PersistentDiscoveryWorker(
      repository as unknown as DiscoveryRuntimeExecutionRepositoryPort,
      execution(async (context) => {
        observedSignal = context.signal;
        started?.();
        await new Promise<void>((resolve) => {
          context.signal.addEventListener('abort', () => resolve(), { once: true });
        });
        return { value: { stopped: true } };
      }),
      { workerId: 'worker', pollIntervalMs: 1, leaseDurationMs: 1_000 },
    );

    worker.start();
    await startedPromise;
    await worker.stop({ graceMs: 500 });

    expect(observedSignal?.aborted).toBe(true);
    expect(repository.released).toBe(1);
    expect(repository.finalized).toBe(0);
  });

  it('bounds stop when an in-flight stage ignores cancellation and leaves lease authority intact', async () => {
    const repository = new RuntimeRepository();
    let started: (() => void) | undefined;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    let releaseStage: (() => void) | undefined;
    const worker = new PersistentDiscoveryWorker(
      repository as unknown as DiscoveryRuntimeExecutionRepositoryPort,
      execution(async () => {
        started?.();
        await new Promise<void>((resolve) => {
          releaseStage = resolve;
        });
        return { value: { late: true } };
      }),
      { workerId: 'worker', pollIntervalMs: 1, leaseDurationMs: 1_000 },
    );

    worker.start();
    await startedPromise;
    await worker.stop({ graceMs: 5 });
    expect(worker.status().state).toBe('STOPPING');
    expect(repository.finalized).toBe(0);
    releaseStage?.();
    await vi.waitFor(() => expect(repository.released).toBe(1));
    expect(repository.finalized).toBe(0);
  });

  it('observes loop infrastructure failures and applies bounded backoff', async () => {
    const repository = new RuntimeRepository();
    repository.claimFailures = 1;
    const errors: Array<{ code: string; backoffMs: number }> = [];
    let observed: (() => void) | undefined;
    const observedPromise = new Promise<void>((resolve) => {
      observed = resolve;
    });
    const sleep = vi.fn(() => new Promise<void>(() => {}));
    const worker = new PersistentDiscoveryWorker(
      repository as unknown as DiscoveryRuntimeExecutionRepositoryPort,
      execution(async () => ({ value: {} })),
      {
        workerId: 'worker',
        pollIntervalMs: 1,
        retryBackoffMs: 10,
        loopBackoffMaxMs: 15,
        sleep,
        observer: {
          onLoopError: (input) => {
            errors.push({ code: input.code, backoffMs: input.backoffMs });
            observed?.();
          },
        },
      },
    );

    worker.start();
    await observedPromise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(errors).toEqual([{ code: 'DISCOVERY_LOOP_UNEXPECTED', backoffMs: 10 }]);
    expect(worker.status()).toMatchObject({ health: 'DEGRADED', consecutiveLoopFailures: 1 });
    expect(sleep).toHaveBeenCalledWith(10);
    await worker.stop({ graceMs: 100 });
  });

  it('uses the same cleanup authority on createApplication startup failure', async () => {
    let closes = 0;
    await expect(
      createApplication({
        canonicalProjectionRecoveryIntervalMs: 0,
        closeResources: async () => {
          closes += 1;
        },
      }),
    ).rejects.toThrow('Canonical recovery interval must be at least one millisecond.');
    expect(closes).toBe(1);
  });
});
