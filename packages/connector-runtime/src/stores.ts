import { randomUUID } from 'node:crypto';

import { type AnyEnvelope, ShotgunError } from '../../contracts/src/index.js';
import type { JobRecord } from '../../job-runtime/src/index.js';
import type { ConnectorSemanticIdentity, ReplayAuthorization } from './ports.js';

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
  /** A timeout/ack-loss is terminal for this semantic key until an explicit
   * reconciliation occurs. Never delete this tombstone when the late handler
   * promise settles. */
  private readonly outcomeUnknown = new Map<string, string>();

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

    const unknown = this.outcomeUnknown.get(key);
    if (unknown) {
      this.assertSameFingerprint(key, unknown, fingerprint);
      throw new ShotgunError({
        code: 'OUTCOME_UNKNOWN',
        safeMessage: 'The previous delivery outcome is unknown and requires reconciliation.',
        module: 'connector-runtime',
        operation: 'deduplicate-message',
      });
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
    } catch (error) {
      if (error instanceof ShotgunError && error.code === 'OUTCOME_UNKNOWN') {
        this.outcomeUnknown.set(key, fingerprint);
      }
      throw error;
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
  private readonly reservations = new Map<
    string,
    { readonly jobId: string; readonly fencingToken: number; readonly sequence: number }
  >();
  private readonly fenceCounters = new Map<string, number>();

  private identityKey(identity: ConnectorSemanticIdentity, envelope: AnyEnvelope): string {
    return [
      identity.projectId,
      identity.securityScope,
      identity.consumerId,
      identity.messageKind,
      identity.messageType,
      envelope.orderingKey ?? '',
    ].join('\u0000');
  }

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

  commitLegacy(consumerId: string, envelope: AnyEnvelope): void {
    if (envelope.orderingKey === undefined || envelope.sequence === undefined) {
      return;
    }
    this.lastSequence.set(`${consumerId}:${envelope.orderingKey}`, envelope.sequence);
  }

  async acquireNext(
    identity: ConnectorSemanticIdentity,
    envelope: AnyEnvelope,
    jobId: string,
    leaseDurationMs: number,
  ): Promise<{ readonly fencingToken: number }> {
    void leaseDurationMs;
    const hasKey = envelope.orderingKey !== undefined;
    const hasSequence = envelope.sequence !== undefined;
    if (hasKey !== hasSequence) {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: 'orderingKey and sequence must be supplied together.',
        module: 'connector-runtime',
        operation: 'validate-partial-order',
        correlationId: envelope.correlationId,
      });
    }
    if (!hasKey || envelope.sequence === undefined) return { fencingToken: 0 };
    const key = this.identityKey(identity, envelope);
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
    const existing = this.reservations.get(key);
    if (existing) {
      throw new ShotgunError({
        code: 'RETRYABLE_DEPENDENCY',
        safeMessage: 'The ordering key is currently fenced by another delivery.',
        module: 'connector-runtime',
        operation: 'acquire-partial-order',
        correlationId: envelope.correlationId,
        retryable: true,
      });
    }
    const fencingToken = (this.fenceCounters.get(key) ?? 0) + 1;
    this.fenceCounters.set(key, fencingToken);
    this.reservations.set(key, { jobId, fencingToken, sequence: envelope.sequence });
    return { fencingToken };
  }

  async commit(
    identity: ConnectorSemanticIdentity,
    envelope: AnyEnvelope,
    fencingToken: number,
  ): Promise<void> {
    if (envelope.orderingKey === undefined || envelope.sequence === undefined) return;
    const key = this.identityKey(identity, envelope);
    const reservation = this.reservations.get(key);
    if (!reservation || reservation.fencingToken !== fencingToken) {
      throw new ShotgunError({
        code: 'OUTCOME_UNKNOWN',
        safeMessage: 'The ordering fence was lost before checkpoint commit.',
        module: 'connector-runtime',
        operation: 'commit-partial-order',
        correlationId: envelope.correlationId,
      });
    }
    this.lastSequence.set(key, envelope.sequence);
    this.reservations.delete(key);
  }

  async release(
    identity: ConnectorSemanticIdentity,
    envelope: AnyEnvelope,
    fencingToken: number,
  ): Promise<void> {
    if (envelope.orderingKey === undefined || envelope.sequence === undefined) return;
    const key = this.identityKey(identity, envelope);
    const reservation = this.reservations.get(key);
    if (reservation?.fencingToken === fencingToken) this.reservations.delete(key);
  }
}

export type DeadLetterKind = 'command' | 'event';

export type ReplayRecord = {
  readonly replayId: string;
  readonly attemptedAt: string;
  status: 'running' | 'succeeded' | 'failed';
  readonly reason?: string;
  readonly actorId?: string;
  readonly actorType?: 'user' | 'service' | 'system';
  readonly projectId?: string;
  readonly securityScope?: string;
  readonly originalFingerprint?: string;
};

export type DeadLetterEntry = {
  readonly deadLetterId: string;
  readonly projectId: string;
  readonly securityScope: string;
  readonly kind: DeadLetterKind;
  readonly consumerId: string;
  readonly identity: ConnectorSemanticIdentity;
  readonly messageType: string;
  readonly semanticKey: string;
  readonly fingerprint: string;
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
    if (
      input.projectId !== input.identity.projectId ||
      input.securityScope !== input.identity.securityScope ||
      input.messageType !== input.identity.messageType ||
      input.semanticKey !== input.identity.semanticKey ||
      input.fingerprint !== input.identity.fingerprint
    ) {
      throw new ShotgunError({
        code: 'CONFLICT',
        safeMessage: 'The dead-letter projection does not match its semantic identity.',
        module: 'connector-runtime',
        operation: 'dead-letter-add',
      });
    }
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

  authorizeReplay(deadLetterId: string, authorization: ReplayAuthorization): void {
    const entry = this.get(deadLetterId);
    if (!authorization.reason.trim() || !authorization.actor.id.trim()) {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: 'A replay actor and reason are required.',
        module: 'connector-runtime',
        operation: 'authorize-replay',
      });
    }
    if (
      entry.projectId !== authorization.projectId ||
      entry.securityScope !== authorization.securityScope
    ) {
      throw new ShotgunError({
        code: 'REPLAY_BLOCKED',
        safeMessage: 'The replay authorization is outside the original project/security scope.',
        module: 'connector-runtime',
        operation: 'authorize-replay',
      });
    }
    if (entry.status !== 'open') {
      throw new ShotgunError({
        code: 'REPLAY_BLOCKED',
        safeMessage: 'The dead-letter is already resolved.',
        module: 'connector-runtime',
        operation: 'authorize-replay',
      });
    }
  }

  list(): readonly DeadLetterEntry[] {
    return [...this.entries.values()];
  }
}
