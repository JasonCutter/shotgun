import { describe, expect, it } from 'vitest';

import {
  SourcesStage3TestPipeline,
  SourcesStage3RecoveryDispatcher,
  SourcesStage3RecoveryCircuitBreaker,
  SourcesStage4ContinuationDispatcher,
} from '../../adapters/sources-stage3-pipeline/src/index.js';
import { PostgresSourcesStage3ProgressRepository } from '../../adapters/postgres-stage3/src/runtime-data-integrity.js';
import type {
  SourcesStage3EvidenceIndexedInput,
  SourcesStage3PipelinePort,
  SourcesStage3ProgressPort,
  SourcesStage3RecoveryItem,
  SourcesStage4ContinuationPort,
  SourcesStage4ContinuationStorePort,
} from '../../modules/frontend-sources-write/src/index.js';
import { HISTORICAL_RECONCILIATION_REQUIRED_CODE } from '../../modules/frontend-sources-write/src/index.js';
import {
  STAGE3_RUNTIME_CONTRACT_ERROR_CODE,
  STAGE3_UNKNOWN_FAILURE_CODE,
  classifySourcesStage3Failure,
} from '../../modules/frontend-sources-write/src/index.js';
import { ShotgunError } from '../../packages/contracts/src/index.js';

const continuation: SourcesStage3EvidenceIndexedInput = {
  projectId: 'project-1',
  sourceId: 'source-1',
  sourceVersionId: 'version-1',
  revisionId: 'revision-1',
  evidenceCount: 1,
  reusedCount: 0,
  accessScope: ['owner'],
  sensitivity: 'public',
  dataClassification: 'source-content',
};

class MemoryContinuationStore implements SourcesStage4ContinuationStorePort {
  state: 'PENDING' | 'RETRYABLE_FAILED' | 'OUTCOME_UNKNOWN' | 'COMPLETED' = 'PENDING';
  attempts = 0;
  failures: Array<{ retryable: boolean; code: string }> = [];

  async claimNext() {
    if (this.state === 'COMPLETED' || this.state === 'OUTCOME_UNKNOWN') {
      return { status: 'EMPTY' as const };
    }
    this.state = 'PENDING';
    this.attempts += 1;
    return {
      status: 'CLAIMED' as const,
      continuation,
      continuationId: 'continuation-1',
      leaseToken: `lease-${this.attempts}`,
      fencingToken: this.attempts,
    };
  }

  async complete() {
    this.state = 'COMPLETED';
  }

  async fail(input: Parameters<SourcesStage4ContinuationStorePort['fail']>[0]) {
    this.failures.push({ retryable: input.retryable, code: input.code });
    this.state =
      input.code === 'OUTCOME_UNKNOWN'
        ? 'OUTCOME_UNKNOWN'
        : input.retryable
          ? 'RETRYABLE_FAILED'
          : 'COMPLETED';
  }

  async recoverExpired() {
    return 0;
  }
}

describe('durable Sources Stage 4 continuation dispatcher', () => {
  it('does not claim a historical reconciliation marker for provider recovery', async () => {
    const statements: string[] = [];
    const client = {
      query: async (sql: string) => {
        statements.push(sql);
        if (sql.includes('SELECT state, fencing_token')) {
          return {
            rows: [
              {
                state: 'RECONCILIATION_REQUIRED',
                fencing_token: '0',
                lease_expires_at: null,
                next_attempt_at: null,
                indexing_result_id: null,
                safe_failure_code: HISTORICAL_RECONCILIATION_REQUIRED_CODE,
              },
            ],
          };
        }
        return { rows: [], rowCount: 0 };
      },
      release: () => undefined,
    };
    const pool = {
      connect: async () => client,
    } as never;
    const repository = new PostgresSourcesStage3ProgressRepository(pool);

    await expect(
      repository.claim({
        projectId: 'project-1',
        sourceId: 'source-1',
        sourceVersionId: 'version-1',
        workerId: 'worker-1',
        leaseDurationMs: 30_000,
      }),
    ).resolves.toEqual({ status: 'BLOCKED', reason: 'HISTORICAL_RECONCILIATION' });
    expect(statements.some((sql) => sql.includes("SET state = 'STAGE3_RUNNING'"))).toBe(false);
  });

  it('does not reclaim a runtime-contract reconciliation row', async () => {
    const statements: string[] = [];
    const client = {
      query: async (sql: string) => {
        statements.push(sql);
        if (sql.includes('SELECT state, fencing_token')) {
          return {
            rows: [
              {
                state: 'RECONCILIATION_REQUIRED',
                fencing_token: '2',
                lease_expires_at: null,
                next_attempt_at: null,
                indexing_result_id: null,
                safe_failure_code: STAGE3_RUNTIME_CONTRACT_ERROR_CODE,
              },
            ],
          };
        }
        return { rows: [], rowCount: 0 };
      },
      release: () => undefined,
    };
    const repository = new PostgresSourcesStage3ProgressRepository({
      connect: async () => client,
    } as never);

    await expect(
      repository.claim({
        projectId: 'project-1',
        sourceId: 'source-1',
        sourceVersionId: 'version-1',
        workerId: 'worker-1',
        leaseDurationMs: 30_000,
      }),
    ).resolves.toEqual({ status: 'BLOCKED', reason: 'RUNTIME_CONTRACT' });
    expect(statements.some((sql) => sql.includes("SET state = 'STAGE3_RUNNING'"))).toBe(false);
  });

  it('fails closed for unknown failures and only retries known transient dependencies', () => {
    expect(classifySourcesStage3Failure(new Error('unclassified side effect'))).toMatchObject({
      retryable: false,
      code: STAGE3_UNKNOWN_FAILURE_CODE,
    });
    expect(
      classifySourcesStage3Failure(
        Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' }),
      ),
    ).toMatchObject({
      retryable: true,
      code: 'STAGE3_DB_TRANSIENT',
    });
  });

  it('rejects malformed Stage 3 input before invoking storage or transformation', async () => {
    let reads = 0;
    const pipeline = new SourcesStage3TestPipeline({
      storage: {
        put: async () => 'unused',
        read: async () => {
          reads += 1;
          return new Uint8Array();
        },
      },
      transformer: {
        identity: { id: 'test', version: '1' },
        transform: async () => {
          throw new Error('must not be called');
        },
      },
      locator: { locate: () => undefined },
      transformationRepository: {
        save: async () => {
          throw new Error('must not be called');
        },
        findTransformationRevisionSecurity: async () => undefined,
        findBySourceVersion: async () => undefined,
      },
      evidenceRepository: {
        index: async () => {
          throw new Error('must not be called');
        },
        listBySourceVersion: async () => [],
        findById: async () => undefined,
      },
    });

    await expect(
      pipeline.runForSourceVersion({
        projectId: 'project-1',
        sourceId: 'source-1',
        sourceVersionId: 'version-1',
        storageKey: 'asset/1',
        mediaType: 'text/plain',
        contentHash: 'not-a-sha256',
        accessScope: ['owner'],
        sensitivity: 'public',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(reads).toBe(0);
  });

  it('records a classified pre-claim contract failure without entering transformation', async () => {
    const recorded: Array<{ retryable: boolean; code: string }> = [];
    let transformed = false;
    const pipeline = new SourcesStage3TestPipeline({
      storage: {
        put: async () => 'unused',
        read: async () => new Uint8Array(),
      },
      transformer: {
        identity: { id: 'test', version: '1' },
        transform: async () => {
          transformed = true;
          throw new Error('must not be called');
        },
      },
      locator: { locate: () => undefined },
      transformationRepository: {
        save: async () => undefined as never,
        findTransformationRevisionSecurity: async () => undefined,
        findBySourceVersion: async () => undefined,
      },
      evidenceRepository: {
        index: async () => ({ items: [], reusedCount: 0 }),
        listBySourceVersion: async () => [],
        findById: async () => undefined,
      },
      progress: {
        ensureMaterialized: async () => undefined,
        claim: async () => {
          const error = new Error('operator does not exist: timestamptz = integer') as Error & {
            code: string;
          };
          error.code = '42804';
          throw error;
        },
        recordPreClaimFailure: async (input) => {
          recorded.push({ retryable: input.retryable, code: input.code });
        },
        finalize: async () => undefined,
        markRetryable: async () => undefined,
        markFailure: async () => undefined,
        findRecoverable: async () => [],
      },
      atomicPersistence: {
        persist: async () => {
          throw new Error('must not be called');
        },
      },
    });

    await expect(
      pipeline.runForSourceVersion({
        projectId: 'project-1',
        sourceId: 'source-1',
        sourceVersionId: 'version-1',
        storageKey: 'asset/1',
        mediaType: 'text/plain',
        contentHash: 'sha256:' + 'a'.repeat(64),
        accessScope: ['owner'],
        sensitivity: 'public',
      }),
    ).rejects.toThrow('timestamptz = integer');
    expect(recorded).toEqual([{ retryable: false, code: STAGE3_RUNTIME_CONTRACT_ERROR_CODE }]);
    expect(transformed).toBe(false);
  });

  it('returns DEFERRED without converting ordinary back-pressure into a failure', async () => {
    let transformed = false;
    const pipeline = new SourcesStage3TestPipeline({
      storage: { put: async () => 'unused', read: async () => new Uint8Array() },
      transformer: {
        identity: { id: 'test', version: '1' },
        transform: async () => {
          transformed = true;
          throw new Error('must not be called');
        },
      },
      locator: { locate: () => undefined },
      transformationRepository: {
        save: async () => undefined as never,
        findTransformationRevisionSecurity: async () => undefined,
        findBySourceVersion: async () => undefined,
      },
      evidenceRepository: {
        index: async () => ({ items: [], reusedCount: 0 }),
        listBySourceVersion: async () => [],
        findById: async () => undefined,
      },
      progress: {
        ensureMaterialized: async () => undefined,
        claim: async () => ({ status: 'DEFERRED' as const, reason: 'RETRY_NOT_DUE' as const }),
        recordPreClaimFailure: async () => undefined,
        finalize: async () => undefined,
        markRetryable: async () => undefined,
        markFailure: async () => undefined,
        findRecoverable: async () => [],
      },
      atomicPersistence: {
        persist: async () => {
          throw new Error('must not be called');
        },
      },
    });

    await expect(
      pipeline.runForSourceVersion({
        projectId: 'project-1',
        sourceId: 'source-1',
        sourceVersionId: 'version-1',
        storageKey: 'asset/1',
        mediaType: 'text/plain',
        contentHash: 'sha256:' + 'a'.repeat(64),
        accessScope: ['owner'],
        sensitivity: 'public',
      }),
    ).resolves.toEqual({ status: 'DEFERRED', reason: 'RETRY_NOT_DUE' });
    expect(transformed).toBe(false);
  });

  it('backs off DB outage polling and resets after a successful scan', () => {
    let now = 1_000;
    const breaker = new SourcesStage3RecoveryCircuitBreaker(100, 500, () => now);
    expect(breaker.isOpen()).toBe(false);
    breaker.recordFailure();
    expect(breaker.remainingMs()).toBe(100);
    expect(breaker.isOpen()).toBe(true);
    now += 100;
    expect(breaker.isOpen()).toBe(false);
    breaker.recordFailure();
    expect(breaker.remainingMs()).toBe(200);
    breaker.recordSuccess();
    expect(breaker.remainingMs()).toBe(0);
    expect(breaker.isOpen()).toBe(false);
  });

  it('does not hot-loop the recovery worker when the durable scan is unavailable', async () => {
    let scans = 0;
    const dispatcher = new SourcesStage3RecoveryDispatcher(
      {
        findRecoverable: async () => {
          scans += 1;
          throw Object.assign(new Error('database unavailable'), { code: 'ECONNREFUSED' });
        },
      } as unknown as SourcesStage3ProgressPort,
      {
        runForSourceVersion: async () => ({
          stage3: { revisionId: 'unused', evidenceCount: 0, reusedCount: 0 },
          stage4: { status: 'NOT_CONFIGURED' },
        }),
      },
      { intervalMs: 1, failureBackoffMs: 25, maxFailureBackoffMs: 25 },
    );
    const stop = await dispatcher.startWorker();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await stop();
    expect(scans).toBe(1);
  });

  it('retries a retryable failure and completes the same continuation', async () => {
    const store = new MemoryContinuationStore();
    let publishes = 0;
    const publisher: SourcesStage4ContinuationPort = {
      onEvidenceIndexed: async () => {
        publishes += 1;
        if (publishes === 1) throw new Error('provider unavailable');
      },
    };
    const dispatcher = new SourcesStage4ContinuationDispatcher(store, publisher);

    await expect(dispatcher.dispatchOnce()).resolves.toBe('FAILED');
    expect(store.failures).toEqual([{ retryable: true, code: 'STAGE4_RETRYABLE_FAILURE' }]);
    await expect(dispatcher.dispatchOnce()).resolves.toBe('SUCCEEDED');
    expect(store.state).toBe('COMPLETED');
    expect(store.attempts).toBe(2);
  });

  it('does not retry policy or validation failures', async () => {
    const store = new MemoryContinuationStore();
    const publisher: SourcesStage4ContinuationPort = {
      onEvidenceIndexed: async () => {
        throw new ShotgunError({
          code: 'POLICY_DENIED',
          safeMessage: 'policy denied',
          module: 'test',
          operation: 'publish',
        });
      },
    };
    const dispatcher = new SourcesStage4ContinuationDispatcher(store, publisher);

    await expect(dispatcher.dispatchOnce()).resolves.toBe('FAILED');
    expect(store.failures).toEqual([{ retryable: false, code: 'POLICY_DENIED' }]);
  });

  it('preserves timeout as OUTCOME_UNKNOWN instead of replaying a provider call', async () => {
    const store = new MemoryContinuationStore();
    const publisher: SourcesStage4ContinuationPort = {
      onEvidenceIndexed: async () => {
        throw new ShotgunError({
          code: 'TIMEOUT',
          safeMessage: 'provider timeout',
          module: 'test',
          operation: 'publish',
        });
      },
    };
    const dispatcher = new SourcesStage4ContinuationDispatcher(store, publisher);

    await expect(dispatcher.dispatchOnce()).resolves.toBe('FAILED');
    expect(store.failures).toEqual([{ retryable: false, code: 'OUTCOME_UNKNOWN' }]);
    expect(store.state).toBe('OUTCOME_UNKNOWN');
    await expect(dispatcher.dispatchOnce()).resolves.toBe('EMPTY');
  });

  it('starts Stage 3 recovery on startup and drains durable per-SourceVersion rows', async () => {
    const recoveryItem: SourcesStage3RecoveryItem = {
      projectId: 'project-1',
      sourceId: 'source-1',
      sourceVersionId: 'version-1',
      storageKey: 'asset/1',
      mediaType: 'text/plain',
      contentHash: 'sha256:' + 'a'.repeat(64),
      accessScope: ['owner'],
      sensitivity: 'public',
      state: 'STAGE3_RETRYABLE',
    };
    let listed = 0;
    let recovered: SourcesStage3RecoveryItem | undefined;
    const progress = {
      findRecoverable: async () => {
        listed += 1;
        return listed === 1 ? [recoveryItem] : [];
      },
    } as unknown as SourcesStage3ProgressPort;
    const pipeline: SourcesStage3PipelinePort = {
      runForSourceVersion: async (input) => {
        recovered = { ...recoveryItem, ...input };
        return {
          stage3: {
            revisionId: `revision-${input.sourceVersionId}`,
            evidenceCount: 0,
            reusedCount: 0,
          },
          stage4: { status: 'NOT_CONFIGURED' },
        };
      },
    };
    const dispatcher = new SourcesStage3RecoveryDispatcher(progress, pipeline);
    const stop = await dispatcher.startWorker();
    await stop();

    expect(recovered).toMatchObject({
      projectId: recoveryItem.projectId,
      sourceVersionId: recoveryItem.sourceVersionId,
      storageKey: recoveryItem.storageKey,
      contentHash: recoveryItem.contentHash,
    });
    expect(listed).toBe(2);
  });

  it('reports Stage 3 contract failures to readiness without retrying the tick', async () => {
    const observations: Array<{ status: string; code?: string }> = [];
    const progress = {
      findRecoverable: async () => [
        {
          projectId: 'project-1',
          sourceId: 'source-1',
          sourceVersionId: 'version-1',
          storageKey: 'asset/1',
          mediaType: 'text/plain',
          contentHash: 'sha256:' + 'a'.repeat(64),
          accessScope: ['owner'],
          sensitivity: 'public' as const,
          state: 'STAGE3_RETRYABLE' as const,
        },
      ],
    } as unknown as SourcesStage3ProgressPort;
    const pipeline: SourcesStage3PipelinePort = {
      runForSourceVersion: async () => {
        const error = new Error('inconsistent parameter types') as Error & { code: string };
        error.code = '42P08';
        throw error;
      },
    };
    const dispatcher = new SourcesStage3RecoveryDispatcher(progress, pipeline, {
      reporter: {
        report: (observation) => {
          observations.push(observation);
        },
      },
    });

    await expect(dispatcher.dispatchOnce()).resolves.toBe('FAILED');
    expect(observations).toEqual([{ status: 'FAILED', code: 'STAGE3_RUNTIME_CONTRACT_ERROR' }]);
  });
});
