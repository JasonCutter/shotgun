import { randomUUID } from 'node:crypto';

import { type AnyEnvelope, ShotgunError } from '../../contracts/src/index.js';
import type { JobRecord } from '../../job-runtime/src/index.js';

export type OnceResult<TResult> = {
  readonly duplicate: boolean;
  readonly result: TResult;
};

export class InMemoryDedupStore {
  private readonly completed = new Map<string, unknown>();
  private readonly running = new Map<string, Promise<unknown>>();

  async runOnce<TResult>(
    key: string,
    operation: () => Promise<TResult>,
  ): Promise<OnceResult<TResult>> {
    if (this.completed.has(key)) {
      return {
        duplicate: true,
        result: this.completed.get(key) as TResult,
      };
    }

    const inProgress = this.running.get(key);
    if (inProgress) {
      return {
        duplicate: true,
        result: (await inProgress) as TResult,
      };
    }

    const promise = operation();
    this.running.set(key, promise);
    try {
      const result = await promise;
      this.completed.set(key, result);
      return { duplicate: false, result };
    } finally {
      this.running.delete(key);
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
