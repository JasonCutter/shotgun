import { describe, expect, it, vi } from 'vitest';

import {
  PersistentDiscoveryWorker,
  type DiscoveryExecutionPortV1,
  type DiscoveryExecutionStageResultV1,
  type DiscoveryRuntimeClaimV1,
  type DiscoveryRuntimeExecutionRepositoryPort,
} from '../../modules/discovery-runtime/src/index.js';

const claim = {
  projectId: 'project-ts2',
  jobId: 'job-ts2',
  runId: 'run-ts2',
  attemptId: 'attempt-ts2',
  workerId: 'worker-ts2',
  fencingToken: 1,
  acquiredAt: '2026-09-19T00:00:00.000Z',
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

const stage = {
  schemaVersion: '1.0.0' as const,
  stageId: 'stage-ts2',
  jobId: claim.jobId,
  runId: claim.runId,
  attemptId: claim.attemptId,
  projectId: claim.projectId,
  stageOrdinal: 1,
  stageType: 'LOAD_SIGNALS' as const,
  stageRevision: 1,
  state: 'RUNNING' as const,
  createdAt: claim.acquiredAt,
  updatedAt: claim.acquiredAt,
};

type RenewalMode =
  'stale' | 'transient' | 'persistent-uncertainty' | 'in-flight-stale' | 'final-uncertain';

class LeaseLossRepository {
  public renewals = 0;
  public stageOutputs = 0;
  public stageCompletions = 0;
  public finalizations = 0;
  public failureFinalizations = 0;
  public releases = 0;
  private releaseInFlightRenewal!: () => void;

  public constructor(private readonly mode: RenewalMode = 'stale') {}

  async claimNext() {
    return claim;
  }

  async readBudgetCheckpoint() {
    return undefined;
  }

  async listStages() {
    return [stage];
  }

  async renewLease(input: Parameters<DiscoveryRuntimeExecutionRepositoryPort['renewLease']>[0]) {
    this.renewals += 1;
    if (this.mode === 'transient' && this.renewals === 2) {
      throw new Error('temporary heartbeat transport failure');
    }
    if (this.mode === 'in-flight-stale' && this.renewals === 2) {
      await new Promise<void>((resolve) => {
        this.releaseInFlightRenewal = resolve;
      });
      return 'STALE' as const;
    }
    if (this.mode === 'persistent-uncertainty' && this.renewals >= 2) {
      throw new Error('persistent heartbeat transport failure');
    }
    if (this.mode === 'final-uncertain' && this.renewals === 2) {
      throw new Error('final lease revalidation transport failure');
    }
    if (this.mode === 'transient' && this.renewals >= 3) {
      return input;
    }
    return this.renewals === 1 ? input : ('STALE' as const);
  }

  releaseRenewal() {
    this.releaseInFlightRenewal();
  }

  async writeStageOutput() {
    this.stageOutputs += 1;
    return 'SAVED' as const;
  }

  async transitionStageWithLease(
    input: Parameters<DiscoveryRuntimeExecutionRepositoryPort['transitionStageWithLease']>[0],
  ) {
    if (input.targetState === 'SUCCEEDED') this.stageCompletions += 1;
    return { ...stage, state: input.targetState, stageRevision: input.expectedStageRevision + 1 };
  }

  async finalizeClaimWithLease() {
    this.finalizations += 1;
    return 'COMPLETED' as const;
  }

  async finalizeFailureWithLease(
    _input: Parameters<
      NonNullable<DiscoveryRuntimeExecutionRepositoryPort['finalizeFailureWithLease']>
    >[0],
  ) {
    void _input;
    this.failureFinalizations += 1;
    return 'FAILED_TERMINAL' as const;
  }

  async releaseLease() {
    this.releases += 1;
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

const waitForLeaseLoss = async (repository: LeaseLossRepository): Promise<void> => {
  await vi.waitFor(() => expect(repository.renewals).toBeGreaterThanOrEqual(2), {
    timeout: 2_500,
    interval: 20,
  });
};

describe('TS-2 Phase B lease-loss cancellation proof', () => {
  it('authoritative STALE aborts the active stage/provider signal', async () => {
    const repository = new LeaseLossRepository();
    let releaseStage!: () => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    let observedSignal: AbortSignal | undefined;
    const runPromise = new PersistentDiscoveryWorker(
      repository as unknown as DiscoveryRuntimeExecutionRepositoryPort,
      execution(async (context) => {
        observedSignal = context.signal;
        started();
        await new Promise<void>((resolve) => {
          releaseStage = resolve;
        });
        return { value: { late: true } };
      }),
      { workerId: claim.workerId, pollIntervalMs: 1, leaseDurationMs: 3_000 },
    ).runOnce();

    await startedPromise;
    try {
      await waitForLeaseLoss(repository);
      expect(observedSignal?.aborted).toBe(true);
    } finally {
      releaseStage();
      await runPromise;
    }
  });

  it('does not call failClaim when lease-loss abort makes the active stage reject', async () => {
    const repository = new LeaseLossRepository();
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const runPromise = new PersistentDiscoveryWorker(
      repository as unknown as DiscoveryRuntimeExecutionRepositoryPort,
      execution(async (context) => {
        started();
        return await new Promise<DiscoveryExecutionStageResultV1<unknown>>((_resolve, reject) => {
          if (context.signal.aborted) {
            reject(new Error('stage observed lease-loss abort'));
            return;
          }
          context.signal.addEventListener(
            'abort',
            () => reject(new Error('stage observed lease-loss abort')),
            { once: true },
          );
        });
      }),
      { workerId: claim.workerId, pollIntervalMs: 1, leaseDurationMs: 3_000 },
    ).runOnce();

    await startedPromise;
    await expect(runPromise).resolves.toBe('STALE');
    expect(repository.failureFinalizations).toBe(0);
    expect(repository.stageOutputs).toBe(0);
    expect(repository.stageCompletions).toBe(0);
    expect(repository.finalizations).toBe(0);
  });

  it('discards final lease revalidation transport uncertainty without failClaim or success finalization', async () => {
    const repository = new LeaseLossRepository('final-uncertain');
    const runPromise = new PersistentDiscoveryWorker(
      repository as unknown as DiscoveryRuntimeExecutionRepositoryPort,
      execution(async () => ({ value: { final: true } })),
      { workerId: claim.workerId, pollIntervalMs: 1, leaseDurationMs: 3_000 },
    ).runOnce();

    await expect(runPromise).resolves.toBe('STALE');
    expect(repository.failureFinalizations).toBe(0);
    expect(repository.finalizations).toBe(0);
  });

  it('recovers from a transient heartbeat transport failure before accepting output', async () => {
    const repository = new LeaseLossRepository('transient');
    const runPromise = new PersistentDiscoveryWorker(
      repository as unknown as DiscoveryRuntimeExecutionRepositoryPort,
      execution(async () => {
        await vi.waitFor(() => expect(repository.renewals).toBeGreaterThanOrEqual(3), {
          timeout: 2_500,
          interval: 20,
        });
        return { value: { recovered: true } };
      }),
      { workerId: claim.workerId, pollIntervalMs: 1, leaseDurationMs: 3_000 },
    ).runOnce();

    await expect(runPromise).resolves.toBe('COMPLETED');
    expect(repository.stageCompletions).toBe(1);
    expect(repository.finalizations).toBe(1);
  });

  it('discards output at the safety boundary when heartbeat uncertainty persists', async () => {
    const repository = new LeaseLossRepository('persistent-uncertainty');
    const runPromise = new PersistentDiscoveryWorker(
      repository as unknown as DiscoveryRuntimeExecutionRepositoryPort,
      execution(async () => {
        await vi.waitFor(() => expect(repository.renewals).toBeGreaterThanOrEqual(2), {
          timeout: 2_500,
          interval: 20,
        });
        return { value: { uncertain: true } };
      }),
      { workerId: claim.workerId, pollIntervalMs: 1, leaseDurationMs: 3_000 },
    ).runOnce();

    await expect(runPromise).resolves.toBe('STALE');
    expect(repository.stageOutputs).toBe(0);
    expect(repository.stageCompletions).toBe(0);
    expect(repository.finalizations).toBe(0);
  });

  it('awaits an in-flight renewal before deciding whether a completed stage is authoritative', async () => {
    const repository = new LeaseLossRepository('in-flight-stale');
    let releaseStage!: () => void;
    const runPromise = new PersistentDiscoveryWorker(
      repository as unknown as DiscoveryRuntimeExecutionRepositoryPort,
      execution(async () => {
        await vi.waitFor(() => expect(repository.renewals).toBeGreaterThanOrEqual(2), {
          timeout: 2_500,
          interval: 20,
        });
        releaseStage = () => undefined;
        return { value: { raced: true } };
      }),
      { workerId: claim.workerId, pollIntervalMs: 1, leaseDurationMs: 3_000 },
    ).runOnce();

    await vi.waitFor(() => expect(repository.renewals).toBeGreaterThanOrEqual(2), {
      timeout: 2_500,
      interval: 20,
    });
    repository.releaseRenewal();
    await expect(runPromise).resolves.toBe('STALE');
    releaseStage();
    expect(repository.stageOutputs).toBe(0);
    expect(repository.stageCompletions).toBe(0);
    expect(repository.finalizations).toBe(0);
  });

  it('late stage output is rejected before fenced durable writes', async () => {
    const repository = new LeaseLossRepository();
    let releaseStage!: () => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const runPromise = new PersistentDiscoveryWorker(
      repository as unknown as DiscoveryRuntimeExecutionRepositoryPort,
      execution(async () => {
        started();
        await new Promise<void>((resolve) => {
          releaseStage = resolve;
        });
        return { value: { late: true } };
      }),
      { workerId: claim.workerId, pollIntervalMs: 1, leaseDurationMs: 3_000 },
    ).runOnce();

    await startedPromise;
    try {
      await waitForLeaseLoss(repository);
      releaseStage();
      await expect(runPromise).resolves.toBe('STALE');
    } finally {
      if (repository.releases === 0) releaseStage();
      await runPromise;
    }
    expect(repository.stageOutputs).toBe(0);
    expect(repository.stageCompletions).toBe(0);
    expect(repository.finalizations).toBe(0);
    expect(repository.releases).toBe(1);
  });
});
