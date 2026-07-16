import { randomUUID } from 'node:crypto';

import { type ErrorCode, ShotgunError, toShotgunError } from '../../contracts/src/index.js';

export type AttemptRecord = {
  readonly attemptId: string;
  readonly jobId: string;
  readonly attemptNumber: number;
  readonly startedAt: string;
  finishedAt?: string;
  status: 'running' | 'succeeded' | 'failed';
  errorCode?: ErrorCode;
  scheduledDelayMs: number;
};

export type JobRecord = {
  readonly jobId: string;
  readonly idempotencyKey: string;
  readonly consumerId: string;
  readonly createdAt: string;
  status: 'running' | 'succeeded' | 'failed' | 'outcome-unknown';
  readonly attempts: AttemptRecord[];
};

export type RetryPolicy = {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
};

export type JobRunResult<TResult> = {
  readonly result: TResult;
  readonly job: JobRecord;
};

type JobRuntimeOptions = {
  readonly retryPolicy?: RetryPolicy;
  readonly delay?: (milliseconds: number) => Promise<void>;
};

export class InMemoryJobRuntime {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly retryPolicy: RetryPolicy;
  private readonly delay: (milliseconds: number) => Promise<void>;

  constructor(options: JobRuntimeOptions = {}) {
    this.retryPolicy = options.retryPolicy ?? {
      maxAttempts: 3,
      baseDelayMs: 1,
    };
    this.delay =
      options.delay ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async run<TResult>(
    idempotencyKey: string,
    consumerId: string,
    correlationId: string,
    operation: (attempt: AttemptRecord) => Promise<TResult>,
  ): Promise<JobRunResult<TResult>> {
    const key = `${consumerId}:${idempotencyKey}`;
    const job =
      this.jobs.get(key) ??
      ({
        jobId: randomUUID(),
        idempotencyKey,
        consumerId,
        createdAt: new Date().toISOString(),
        status: 'running',
        attempts: [],
      } satisfies JobRecord);
    this.jobs.set(key, job);
    job.status = 'running';

    for (let index = 0; index < this.retryPolicy.maxAttempts; index += 1) {
      const delayMs = index === 0 ? 0 : this.retryPolicy.baseDelayMs * 2 ** (index - 1);
      if (delayMs > 0) {
        await this.delay(delayMs);
      }

      const attempt: AttemptRecord = {
        attemptId: randomUUID(),
        jobId: job.jobId,
        attemptNumber: job.attempts.length + 1,
        startedAt: new Date().toISOString(),
        status: 'running',
        scheduledDelayMs: delayMs,
      };
      job.attempts.push(attempt);

      try {
        const result = await operation(attempt);
        attempt.status = 'succeeded';
        attempt.finishedAt = new Date().toISOString();
        job.status = 'succeeded';
        return { result, job };
      } catch (error) {
        const shotgunError = toShotgunError(error, {
          code: 'TERMINAL_FAILURE',
          safeMessage: 'The connector handler failed.',
          module: consumerId,
          operation: 'execute-handler',
          correlationId,
        });
        attempt.status = 'failed';
        attempt.errorCode = shotgunError.code;
        attempt.finishedAt = new Date().toISOString();

        const canRetry = shotgunError.retryable && index + 1 < this.retryPolicy.maxAttempts;
        if (!canRetry) {
          job.status = shotgunError.code === 'OUTCOME_UNKNOWN' ? 'outcome-unknown' : 'failed';
          throw shotgunError;
        }
      }
    }

    throw new ShotgunError({
      code: 'TERMINAL_FAILURE',
      safeMessage: 'The retry policy ended without a result.',
      module: consumerId,
      operation: 'execute-handler',
      correlationId,
    });
  }

  list(): readonly JobRecord[] {
    return [...this.jobs.values()];
  }

  find(consumerId: string, idempotencyKey: string): JobRecord | undefined {
    return this.jobs.get(`${consumerId}:${idempotencyKey}`);
  }
}
