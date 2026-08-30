import type { DiscoveryFindingEnvelopeV1 } from '../../../packages/contracts/src/index.js';
import type {
  DiscoveryRuntimeBudgetCheckpointV1,
  DiscoveryRuntimeBudgetSnapshotV1,
  DiscoveryRuntimeClaimV1,
  DiscoveryRuntimeExecutionRepositoryPort,
  DiscoveryRuntimeLeaseV1,
} from './index.js';

export type DiscoveryExecutionContextV1 = {
  readonly claim: DiscoveryRuntimeClaimV1;
  readonly budgetSnapshot: DiscoveryRuntimeBudgetSnapshotV1;
  readonly checkpointRevision: number;
  readonly saveBudgetSnapshot: (
    snapshot: DiscoveryRuntimeBudgetSnapshotV1,
  ) => Promise<'SAVED' | 'CONFLICT' | 'STALE' | 'NOT_FOUND'>;
};

export type DiscoveryExecutionStageResultV1<T> = {
  readonly value: T;
  readonly completion?: 'COMPLETE' | 'PARTIAL';
  readonly budgetSnapshot?: DiscoveryRuntimeBudgetSnapshotV1;
};

export type DiscoveryExecutionPortV1 = {
  loadSignals(
    context: DiscoveryExecutionContextV1,
  ): Promise<DiscoveryExecutionStageResultV1<unknown>>;
  generateFindings(
    context: DiscoveryExecutionContextV1,
    signals: unknown,
  ): Promise<DiscoveryExecutionStageResultV1<readonly unknown[]>>;
  qualityGate(
    context: DiscoveryExecutionContextV1,
    candidates: readonly unknown[],
  ): Promise<DiscoveryExecutionStageResultV1<readonly DiscoveryFindingEnvelopeV1[]>>;
  persistFindings(
    context: DiscoveryExecutionContextV1,
    findings: readonly DiscoveryFindingEnvelopeV1[],
  ): Promise<DiscoveryExecutionStageResultV1<readonly DiscoveryFindingEnvelopeV1[]>>;
  /** Rehydrates durable findings after a process restart without re-running a
   * completed persistence stage. */
  loadPersistedFindings?(
    context: DiscoveryExecutionContextV1,
  ): Promise<readonly DiscoveryFindingEnvelopeV1[]>;
  publishFindingReady?(
    context: DiscoveryExecutionContextV1,
    finding: DiscoveryFindingEnvelopeV1,
  ): Promise<void>;
  reconcileFindings?(context: DiscoveryExecutionContextV1): Promise<void>;
};

export type PersistentDiscoveryWorkerOptionsV1 = {
  readonly workerId: string;
  readonly pollIntervalMs?: number;
  readonly leaseDurationMs?: number;
  readonly maxAttempts?: number;
  readonly retryBackoffMs?: number;
  readonly clock?: () => Date;
};

export type PersistentDiscoveryWorkerRunResultV1 =
  'IDLE' | 'COMPLETED' | 'PARTIAL' | 'FAILED_RETRYABLE' | 'FAILED_TERMINAL' | 'STALE';

export class DiscoveryWorkerFailureV1 extends Error {
  public readonly code: string;
  public readonly retryable: boolean;
  public readonly safeMessage: string;

  public constructor(input: {
    readonly code: string;
    readonly retryable: boolean;
    readonly safeMessage: string;
  }) {
    super(input.safeMessage);
    this.name = 'DiscoveryWorkerFailureV1';
    this.code = input.code;
    this.retryable = input.retryable;
    this.safeMessage = input.safeMessage;
  }
}

const nonEmpty = (value: string, field: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${field} must be non-empty`);
  return normalized;
};

const positiveBounded = (value: number, field: string, maximum: number): number => {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`${field} must be between 1 and ${maximum}`);
  }
  return value;
};

const emptySnapshot: DiscoveryRuntimeBudgetSnapshotV1 = {
  resources: 0,
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

const isSnapshot = (value: unknown): value is DiscoveryRuntimeBudgetSnapshotV1 => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.keys(emptySnapshot).every((key) => {
    const dimension = (value as Record<string, unknown>)[key];
    return typeof dimension === 'number' && Number.isSafeInteger(dimension) && dimension >= 0;
  });
};

const failureFrom = (error: unknown): DiscoveryWorkerFailureV1 => {
  if (error instanceof DiscoveryWorkerFailureV1) return error;
  return new DiscoveryWorkerFailureV1({
    code: 'DISCOVERY_EXECUTION_UNCLASSIFIED',
    retryable: false,
    safeMessage: 'Discovery execution failed closed.',
  });
};

const nowIso = (clock: () => Date): string => {
  const now = clock();
  if (!Number.isFinite(now.getTime())) throw new TypeError('clock must return a valid Date');
  return now.toISOString();
};

export class PersistentDiscoveryWorker {
  private readonly workerId: string;
  private readonly pollIntervalMs: number;
  private readonly leaseDurationMs: number;
  private readonly maxAttempts: number;
  private readonly retryBackoffMs: number;
  private readonly clock: () => Date;
  private running = false;
  private loopPromise: Promise<void> | undefined;
  private wakePoll: (() => void) | undefined;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;

  public constructor(
    private readonly repository: DiscoveryRuntimeExecutionRepositoryPort,
    private readonly execution: DiscoveryExecutionPortV1,
    options: PersistentDiscoveryWorkerOptionsV1,
  ) {
    this.workerId = nonEmpty(options.workerId, 'workerId');
    this.pollIntervalMs = positiveBounded(
      options.pollIntervalMs ?? 1_000,
      'pollIntervalMs',
      60_000,
    );
    this.leaseDurationMs = positiveBounded(
      options.leaseDurationMs ?? 30_000,
      'leaseDurationMs',
      300_000,
    );
    this.maxAttempts = positiveBounded(options.maxAttempts ?? 3, 'maxAttempts', 20);
    this.retryBackoffMs = positiveBounded(
      options.retryBackoffMs ?? 1_000,
      'retryBackoffMs',
      60_000,
    );
    this.clock = options.clock ?? (() => new Date());
  }

  public start(): void {
    if (this.running) return;
    this.running = true;
    this.loopPromise = this.runLoop();
  }

  public async stop(): Promise<void> {
    this.running = false;
    this.wakePoll?.();
    await this.loopPromise;
    this.loopPromise = undefined;
  }

  public async runOnce(): Promise<PersistentDiscoveryWorkerRunResultV1> {
    const now = nowIso(this.clock);
    const claim = await this.repository.claimNext({
      workerId: this.workerId,
      now,
      leaseDurationMs: this.leaseDurationMs,
    });
    if (!claim) return 'IDLE';

    let lease: DiscoveryRuntimeLeaseV1 = {
      projectId: claim.projectId,
      jobId: claim.jobId,
      runId: claim.runId,
      attemptId: claim.attemptId,
      workerId: claim.workerId,
      fencingToken: claim.fencingToken,
      acquiredAt: claim.acquiredAt,
      expiresAt: claim.expiresAt,
    };
    try {
      const checkpoint = await this.repository.readBudgetCheckpoint({
        projectId: claim.projectId,
        jobId: claim.jobId,
        runId: claim.runId,
      });
      let budgetSnapshot = checkpoint?.snapshot ?? emptySnapshot;
      let checkpointRevision = checkpoint?.revision ?? 0;
      const saveBudgetSnapshot = async (
        snapshot: DiscoveryRuntimeBudgetSnapshotV1,
      ): Promise<'SAVED' | 'CONFLICT' | 'STALE' | 'NOT_FOUND'> => {
        if (!isSnapshot(snapshot)) {
          throw new DiscoveryWorkerFailureV1({
            code: 'DISCOVERY_BUDGET_SNAPSHOT_INVALID',
            retryable: false,
            safeMessage: 'Discovery budget checkpoint was invalid.',
          });
        }
        const next: DiscoveryRuntimeBudgetCheckpointV1 = {
          schemaVersion: '1.0.0',
          projectId: claim.projectId,
          jobId: claim.jobId,
          runId: claim.runId,
          revision: checkpointRevision + 1,
          snapshot,
          updatedAt: nowIso(this.clock),
        };
        const result = await this.repository.writeBudgetCheckpoint({
          ...lease,
          checkpoint: next,
        });
        if (result === 'SAVED') {
          budgetSnapshot = snapshot;
          checkpointRevision = next.revision;
        }
        return result;
      };
      const context = (): DiscoveryExecutionContextV1 => ({
        claim,
        budgetSnapshot,
        checkpointRevision,
        saveBudgetSnapshot,
      });

      const stages = [
        ...(await this.repository.listStages({
          projectId: claim.projectId,
          runId: claim.runId,
          attemptId: claim.attemptId,
        })),
      ].sort((left, right) => left.stageOrdinal - right.stageOrdinal);
      let signals: unknown;
      let candidates: readonly unknown[] = [];
      let findings: readonly DiscoveryFindingEnvelopeV1[] = [];
      let completion: 'COMPLETE' | 'PARTIAL' =
        claim.job.lifecycleState === 'PARTIAL' ||
        claim.run.lifecycleState === 'PARTIAL' ||
        claim.attempt.lifecycleState === 'PARTIAL'
          ? 'PARTIAL'
          : 'COMPLETE';

      for (const stage of stages) {
        const renewed = await this.repository.renewLease({
          ...lease,
          now: nowIso(this.clock),
          leaseDurationMs: this.leaseDurationMs,
        });
        if (renewed === 'STALE' || renewed === 'NOT_FOUND') return 'STALE';
        lease = renewed;

        if (stage.state === 'SUCCEEDED') continue;
        let currentStage = stage;
        if (currentStage.state === 'FAILED_RETRYABLE') {
          const queued = await this.repository.transitionStageWithLease({
            ...lease,
            stageId: currentStage.stageId,
            expectedStageRevision: currentStage.stageRevision,
            targetState: 'QUEUED',
            updatedAt: nowIso(this.clock),
          });
          if (typeof queued === 'string') return queued === 'STALE' ? 'STALE' : 'FAILED_TERMINAL';
          currentStage = queued;
        }
        if (currentStage.state === 'QUEUED') {
          const started = await this.repository.transitionStageWithLease({
            ...lease,
            stageId: currentStage.stageId,
            expectedStageRevision: currentStage.stageRevision,
            targetState: 'RUNNING',
            updatedAt: nowIso(this.clock),
          });
          if (typeof started === 'string') return started === 'STALE' ? 'STALE' : 'FAILED_TERMINAL';
          currentStage = started;
        }
        if (currentStage.state !== 'RUNNING') continue;

        try {
          if (
            findings.length === 0 &&
            (currentStage.stageType === 'PUBLISH_REENTRY' ||
              currentStage.stageType === 'RECONCILE_FINDINGS') &&
            this.execution.loadPersistedFindings
          ) {
            findings = await this.execution.loadPersistedFindings(context());
          }
          let result: DiscoveryExecutionStageResultV1<unknown> = {
            value: undefined,
          };
          switch (currentStage.stageType) {
            case 'WAIT_FOR_PROJECTION':
              break;
            case 'LOAD_SIGNALS':
              result = await this.execution.loadSignals(context());
              signals = result.value;
              break;
            case 'GENERATE_FINDINGS':
              result = await this.execution.generateFindings(context(), signals);
              candidates = result.value as readonly unknown[];
              break;
            case 'QUALITY_GATE':
              result = await this.execution.qualityGate(context(), candidates);
              findings = result.value as readonly DiscoveryFindingEnvelopeV1[];
              break;
            case 'PERSIST_FINDINGS':
              result = await this.execution.persistFindings(context(), findings);
              findings = result.value as readonly DiscoveryFindingEnvelopeV1[];
              break;
            case 'PUBLISH_REENTRY':
              if (this.execution.publishFindingReady) {
                for (const finding of findings) {
                  await this.execution.publishFindingReady(context(), finding);
                }
              }
              break;
            case 'RECONCILE_FINDINGS':
              if (this.execution.reconcileFindings) {
                await this.execution.reconcileFindings(context());
              }
              break;
          }
          if (result.completion === 'PARTIAL') completion = 'PARTIAL';
          if (result.budgetSnapshot !== undefined) {
            const saved = await saveBudgetSnapshot(result.budgetSnapshot);
            if (saved === 'STALE' || saved === 'NOT_FOUND') return 'STALE';
            if (saved === 'CONFLICT') {
              throw new DiscoveryWorkerFailureV1({
                code: 'DISCOVERY_BUDGET_CHECKPOINT_CONFLICT',
                retryable: false,
                safeMessage: 'Discovery budget checkpoint conflicted during execution.',
              });
            }
          }
          const finished = await this.repository.transitionStageWithLease({
            ...lease,
            stageId: currentStage.stageId,
            expectedStageRevision: currentStage.stageRevision,
            targetState: 'SUCCEEDED',
            updatedAt: nowIso(this.clock),
          });
          if (typeof finished === 'string')
            return finished === 'STALE' ? 'STALE' : 'FAILED_TERMINAL';
        } catch (error) {
          return await this.failClaim(
            lease,
            currentStage.stageId,
            currentStage.stageRevision,
            error,
            claim.attempt.attemptNumber,
          );
        }
      }

      const target = completion === 'PARTIAL' ? 'PARTIAL' : 'SUCCEEDED';
      const finalized = await this.repository.finalizeClaimWithLease({
        ...lease,
        expectedAttemptLifecycleRevision: claim.attempt.lifecycleRevision,
        expectedRunLifecycleRevision: claim.run.lifecycleRevision,
        expectedJobLifecycleRevision: claim.job.lifecycleRevision,
        targetState: target,
        updatedAt: nowIso(this.clock),
      });
      if (finalized === 'STALE') return 'STALE';
      if (finalized === 'NOT_FOUND' || finalized === 'CONFLICT') return 'FAILED_TERMINAL';
      return completion === 'PARTIAL' ? 'PARTIAL' : 'COMPLETED';
    } catch (error) {
      return await this.failClaim(lease, undefined, undefined, error, claim.attempt.attemptNumber);
    } finally {
      await this.repository.releaseLease({ ...lease, now: nowIso(this.clock) });
    }
  }

  private async failClaim(
    lease: DiscoveryRuntimeLeaseV1,
    stageId: string | undefined,
    stageRevision: number | undefined,
    error: unknown,
    attemptNumber: number,
  ): Promise<'FAILED_RETRYABLE' | 'FAILED_TERMINAL' | 'STALE'> {
    const failure = failureFrom(error);
    const retryable = failure.retryable && attemptNumber < this.maxAttempts;
    const occurredAt = nowIso(this.clock);
    const retryNotBefore = retryable
      ? new Date(this.clock().getTime() + this.retryBackoffMs * attemptNumber).toISOString()
      : undefined;
    const contextResult = await this.repository.saveFailureContext({
      ...lease,
      failure: {
        schemaVersion: '1.0.0',
        code: failure.code,
        classification: retryable ? 'RETRYABLE' : 'TERMINAL',
        retryable,
        safeMessage: failure.safeMessage,
        failedStage: stageId ?? 'DISCOVERY_EXECUTION',
        occurredAt,
        ...(retryNotBefore === undefined ? {} : { retryNotBefore }),
      },
    });
    if (contextResult === 'STALE' || contextResult === 'NOT_FOUND') return 'STALE';
    const target = retryable ? 'FAILED_RETRYABLE' : 'FAILED_TERMINAL';
    if (stageId !== undefined && stageRevision !== undefined) {
      const stageResult = await this.repository.transitionStageWithLease({
        ...lease,
        stageId,
        expectedStageRevision: stageRevision,
        targetState: target,
        updatedAt: occurredAt,
      });
      if (typeof stageResult === 'string')
        return stageResult === 'STALE' ? 'STALE' : 'FAILED_TERMINAL';
    }
    const attemptResult = await this.repository.transitionAttemptWithLease({
      ...lease,
      expectedLifecycleRevision: await this.currentAttemptRevision(lease),
      targetState: target,
      updatedAt: occurredAt,
    });
    if (attemptResult === 'STALE') return 'STALE';
    if (typeof attemptResult === 'string') return 'FAILED_TERMINAL';
    const runResult = await this.repository.transitionRunWithLease({
      ...lease,
      expectedLifecycleRevision: await this.currentRunRevision(lease),
      targetState: target,
      updatedAt: occurredAt,
    });
    if (runResult === 'STALE') return 'STALE';
    if (typeof runResult === 'string') return 'FAILED_TERMINAL';
    const jobResult = await this.repository.transitionJobWithLease({
      ...lease,
      expectedLifecycleRevision: await this.currentJobRevision(lease),
      targetState: target,
      updatedAt: occurredAt,
    });
    if (typeof jobResult === 'string') return jobResult === 'STALE' ? 'STALE' : 'FAILED_TERMINAL';
    return retryable ? 'FAILED_RETRYABLE' : 'FAILED_TERMINAL';
  }

  private async currentAttemptRevision(lease: DiscoveryRuntimeLeaseV1): Promise<number> {
    const attempts = await this.repository.listAttempts({
      projectId: lease.projectId,
      jobId: lease.jobId,
      runId: lease.runId,
    });
    const attempt = attempts.find((candidate) => candidate.attemptId === lease.attemptId);
    if (!attempt)
      throw new DiscoveryWorkerFailureV1({
        code: 'DISCOVERY_ATTEMPT_MISSING',
        retryable: false,
        safeMessage: 'Discovery attempt disappeared during failure handling.',
      });
    return attempt.lifecycleRevision;
  }

  private async currentRunRevision(lease: DiscoveryRuntimeLeaseV1): Promise<number> {
    const run = await this.repository.findRun({
      projectId: lease.projectId,
      jobId: lease.jobId,
      runId: lease.runId,
    });
    if (!run)
      throw new DiscoveryWorkerFailureV1({
        code: 'DISCOVERY_RUN_MISSING',
        retryable: false,
        safeMessage: 'Discovery run disappeared during failure handling.',
      });
    return run.lifecycleRevision;
  }

  private async currentJobRevision(lease: DiscoveryRuntimeLeaseV1): Promise<number> {
    const job = await this.repository.findJob({ projectId: lease.projectId, jobId: lease.jobId });
    if (!job)
      throw new DiscoveryWorkerFailureV1({
        code: 'DISCOVERY_JOB_MISSING',
        retryable: false,
        safeMessage: 'Discovery job disappeared during failure handling.',
      });
    return job.lifecycleRevision;
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.runOnce();
      } catch {
        // The lease is finite and the next worker can recover the claim. An
        // unexpected repository error must not kill the worker loop.
      }
      if (this.running) await this.waitForPoll();
    }
  }

  private async waitForPoll(): Promise<void> {
    await new Promise<void>((resolve) => {
      let settled = false;
      const settle = (): void => {
        if (settled) return;
        settled = true;
        if (this.pollTimer !== undefined) clearTimeout(this.pollTimer);
        this.pollTimer = undefined;
        this.wakePoll = undefined;
        resolve();
      };
      this.wakePoll = settle;
      this.pollTimer = setTimeout(settle, this.pollIntervalMs);
    });
  }
}
