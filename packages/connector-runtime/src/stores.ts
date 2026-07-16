import { randomUUID } from 'node:crypto';

import { type AnyEnvelope, ShotgunError } from '../../contracts/src/index.js';
import type { JobRecord } from '../../job-runtime/src/index.js';

export type OnceResult<TResult> = {
  readonly duplicate: boolean;
  readonly result: TResult;
};

type DedupEntry<TResult> = {
  readonly fingerprint: string;
  readonly result: TResult;
};

type RunningDedupEntry<TResult> = {
  readonly fingerprint: string;
  readonly promise: Promise<TResult>;
};

export class InMemoryDedupStore {
  private readonly completed = new Map<string, DedupEntry<unknown>>();
  private readonly running = new Map<string, RunningDedupEntry<unknown>>();

  async runOnce<TResult>(
    key: string,
    fingerprint: string,
    operation: () => Promise<TResult>,
  ): Promise<OnceResult<TResult>> {
    const completed = this.completed.get(key);
    if (completed) {
      this.assertSameFingerprint(key, completed.fingerprint, fingerprint);
      return {
        duplicate: true,
        result: completed.result as TResult,
      };
    }

    const inProgress = this.running.get(key);
    if (inProgress) {
      this.assertSameFingerprint(key, inProgress.fingerprint, fingerprint);
      return {
        duplicate: true,
        result: (await inProgress.promise) as TResult,
      };
    }

    const promise = operation();
    this.running.set(key, { fingerprint, promise });
    try {
      const result = await promise;
      this.completed.set(key, { fingerprint, result });
      return { duplicate: false, result };
    } finally {
      this.running.delete(key);
    }
  }

  private assertSameFingerprint(key: string, expected: string, actual: string): void {
    if (expected !== actual) {
      throw new ShotgunError({
        code: 'CONFLICT',
        safeMessage: `Idempotency key '${key}' was reused for a different message.`,
        module: 'connector-runtime',
        operation: 'deduplicate-message',
      });
    }
  }
}

export class InMemoryOrderingStore {
  private readonly lastSequence = new Map<string, number>();

  assertNext(consumerId: string, envelope: AnyEnvelope): void {
    const hasOrderingKey = envelope.orderingKey !== undefined;
    const hasSequence = envelope.sequence !== undefined;
    if (hasOrderingKey !== hasSequence) {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: 'orderingKey and sequence must be supplied together.',
        module: 'connector-runtime',
        operation: 'validate-partial-order',
        correlationId: envelope.correlationId,
      });
    }
    if (!hasOrderingKey || envelope.sequence === undefined) {
      return;
    }

    const key = `${consumerId}:${envelope.orderingKey}`;
    const expected = (this.lastSequence.get(key) ?? 0) + 1;
    if (envelope.sequence !== expected) {
      throw new ShotgunError({
        code: 'STALE_VERSION',
        safeMessage: `Partial ordering violation: expected sequence ${expected}, received ${envelope.sequence}.`,
        module: 'connector-runtime',
        operation: 'validate-partial-order',
        correlationId: envelope.correlationId,
      });
    }
  }

  commit(consumerId: string, envelope: AnyEnvelope): void {
    if (envelope.orderingKey === undefined || envelope.sequence === undefined) {
      return;
    }
    this.lastSequence.set(`${consumerId}:${envelope.orderingKey}`, envelope.sequence);
  }
}

export type DeadLetterKind = 'command' | 'event';

export type ReplayRecord = {
  readonly replayId: string;
  readonly attemptedAt: string;
  status: 'running' | 'succeeded' | 'failed';
};

export type DeadLetterEntry = {
  readonly deadLetterId: string;
  readonly kind: DeadLetterKind;
  readonly consumerId: string;
  readonly envelope: AnyEnvelope;
  readonly error: ShotgunError;
  readonly job?: JobRecord;
  readonly createdAt: string;
  status: 'open' | 'resolved';
  readonly replays: ReplayRecord[];
};

export class InMemoryDeadLetterStore {
  private readonly entries = new Map<string, DeadLetterEntry>();

  add(
    input: Omit<DeadLetterEntry, 'deadLetterId' | 'createdAt' | 'status' | 'replays'>,
  ): DeadLetterEntry {
    const entry: DeadLetterEntry = {
      deadLetterId: randomUUID(),
      createdAt: new Date().toISOString(),
      status: 'open',
      replays: [],
      ...input,
    };
    this.entries.set(entry.deadLetterId, entry);
    return entry;
  }

  get(deadLetterId: string): DeadLetterEntry {
    const entry = this.entries.get(deadLetterId);
    if (!entry) {
      throw new ShotgunError({
        code: 'NOT_FOUND',
        safeMessage: `Dead-letter '${deadLetterId}' was not found.`,
        module: 'connector-runtime',
        operation: 'get-dead-letter',
      });
    }
    return entry;
  }

  list(): readonly DeadLetterEntry[] {
    return [...this.entries.values()];
  }
}
