import { randomUUID } from 'node:crypto';
import { ShotgunError } from '../../../packages/contracts/src/errors.js';
import {
  assertSurferJson,
  surferDigest,
  surferFailure,
} from '../../../packages/contracts/src/surfer-learning.js';
import {
  decodeSurferExecutionPolicy,
  decodeSurferReservation,
  decodeSurferUsage,
  SURFER_USAGE_KEYS,
  zeroSurferUsage,
  type SurferExecutionPolicy,
  type SurferExecutionState,
  type SurferExecutionRecord,
  type SurferExecutionStorePort,
  type SurferUsage,
  type SurferWorkerResult,
} from '../../../packages/contracts/src/surfer-execution.js';

const held = (r: SurferExecutionRecord) =>
  ['RESERVED', 'DISPATCHED', 'OUTCOME_UNKNOWN'].includes(r.state);
const active = (r: SurferExecutionRecord) => ['DISPATCHED', 'OUTCOME_UNKNOWN'].includes(r.state);
const conflict = (message: string) =>
  new ShotgunError({
    code: 'CONFLICT',
    safeMessage: message,
    module: 'surfer.execution',
    operation: 'budget',
  });
export function executionUsage(state: SurferExecutionState, backgroundOnly = false): SurferUsage {
  const total = zeroSurferUsage();
  for (const r of state.records) {
    if (backgroundOnly && r.request.priority !== 'BACKGROUND') continue;
    const value = held(r) ? r.request.maximum : r.usage;
    if (value) for (const k of SURFER_USAGE_KEYS) total[k] += value[k];
  }
  return total;
}

/** Policy is injected by trusted composition, not by a browser/model command.
 * This ledger accounts for work; it does NOT grant provider credentials/egress. */
export class SurferExecutionLedger {
  readonly policy: Readonly<SurferExecutionPolicy>;
  private readonly policyDigest: string;
  constructor(
    private readonly store: SurferExecutionStorePort,
    policy: unknown,
    private readonly clock = Date.now,
  ) {
    const decoded = decodeSurferExecutionPolicy(policy);
    Object.freeze(decoded.limits);
    Object.freeze(decoded.backgroundLimits);
    Object.freeze(decoded.allowedSpaceIds);
    this.policy = Object.freeze(decoded);
    this.policyDigest = surferDigest(this.policy);
  }
  private transact<T>(apply: (s: SurferExecutionState) => T): Promise<T> {
    return this.store.transaction(this.policy.budgetId, (s) => {
      if (s.policyDigest && s.policyDigest !== this.policyDigest)
        throw conflict('Budget generation/policy changed; existing usage cannot be reset.');
      if (!s.policyDigest) {
        s.policyDigest = this.policyDigest;
        s.sequence++;
      }
      return apply(s);
    });
  }
  private live(s: SurferExecutionState): void {
    if (!Number.isSafeInteger(this.clock()) || this.clock() >= this.policy.deadlineAtMs)
      throw conflict('Execution policy expired.');
    const used = executionUsage(s),
      bg = executionUsage(s, true);
    if (
      SURFER_USAGE_KEYS.some(
        (k) => used[k] > this.policy.limits[k] || bg[k] > this.policy.backgroundLimits[k],
      ) ||
      s.records.some(
        (r) => r.usage && SURFER_USAGE_KEYS.some((k) => r.usage![k] > r.request.maximum[k]),
      )
    )
      throw conflict(
        'Recorded usage exceeded the frozen budget; reconcile before further execution.',
      );
  }
  async reserve(input: unknown): Promise<{ record: SurferExecutionRecord; replayed: boolean }> {
    const request = decodeSurferReservation(input),
      requestDigest = surferDigest(request);
    const reservationId = surferDigest([request.operationId, request.attempt]);
    return this.transact((s) => {
      if (!this.policy.allowedSpaceIds.includes(request.spaceId))
        throw conflict('Space is outside the execution allowance.');
      const existing = s.records.find((r) => r.reservationId === reservationId);
      if (existing) {
        if (existing.requestDigest !== requestDigest)
          throw conflict('Reservation operation changed meaning.');
        return { record: existing, replayed: true };
      }
      this.live(s);
      if (request.priority === 'BACKGROUND' && this.policy.maxBackgroundConcurrent === 0)
        throw conflict('Background work is paused by policy.');
      if (
        s.records.length >= 1024 ||
        s.records.filter((r) => r.state === 'RESERVED').length >= this.policy.maxQueued
      )
        throw conflict('Execution queue/backpressure limit reached.');
      if (
        request.maximum.elapsedMs > this.policy.unitMaxMs ||
        this.clock() + request.maximum.elapsedMs > this.policy.deadlineAtMs
      )
        throw conflict('Unit exceeds the execution deadline/profile.');
      for (const id of request.dependsOn) {
        const dep = s.records.find((r) => r.reservationId === id);
        if (
          !dep ||
          dep.request.spaceId !== request.spaceId ||
          dep.request.runId !== request.runId ||
          dep.state !== 'SETTLED' ||
          dep.outcome !== 'SUCCEEDED'
        )
          throw conflict('DAG predecessor is missing, unresolved or unsuccessful.');
      }
      const prior = s.records.filter((r) => r.request.operationId === request.operationId).at(-1);
      if (
        (!prior && request.attempt !== 1) ||
        (prior &&
          (request.attempt !== prior.request.attempt + 1 ||
            (!['FAILED_KNOWN', 'CANCELLED_BEFORE_DISPATCH'].includes(prior.state) &&
              prior.outcome !== 'YIELDED') ||
            surferDigest({ ...prior.request, attempt: 0, maximum: null }) !==
              surferDigest({ ...request, attempt: 0, maximum: null })))
      )
        throw conflict(
          'Retry requires the same logical step and a known failed/yielded/unexecuted predecessor.',
        );
      for (const background of [false, true]) {
        if (background && request.priority !== 'BACKGROUND') continue;
        const total = executionUsage(s, background),
          limits = background ? this.policy.backgroundLimits : this.policy.limits;
        if (SURFER_USAGE_KEYS.some((k) => total[k] + request.maximum[k] > limits[k]))
          throw conflict('Reservation exceeds token/money/time/call allowance.');
      }
      const record: SurferExecutionRecord = {
        reservationId,
        requestDigest,
        request,
        state: 'RESERVED',
        dispatchToken: null,
        usage: null,
        outcome: null,
        checkpoint: prior?.checkpoint ?? null,
        checkpointSequence: 0,
        resultRef: null,
        settlementDigest: null,
      };
      s.records.push(record);
      s.sequence++;
      return { record, replayed: false };
    });
  }
  async dispatch(
    reservationId: string,
    spaceId: string,
  ): Promise<{ granted: boolean; record: SurferExecutionRecord }> {
    const token = randomUUID();
    return this.transact((s) => {
      const r = this.find(s, reservationId, spaceId);
      if (r.state !== 'RESERVED') return { granted: false, record: r };
      this.live(s);
      if (this.clock() + r.request.maximum.elapsedMs > this.policy.deadlineAtMs)
        throw conflict('Insufficient time remaining for bounded dispatch.');
      if (
        s.records.filter(active).length >= this.policy.maxConcurrent ||
        (r.request.priority === 'BACKGROUND' &&
          s.records.filter((x) => active(x) && x.request.priority === 'BACKGROUND').length >=
            this.policy.maxBackgroundConcurrent)
      )
        throw conflict('Concurrent execution limit reached.');
      r.state = 'DISPATCHED';
      r.dispatchToken = token;
      s.sequence++;
      return { granted: true, record: r };
    });
  }
  private find(s: SurferExecutionState, id: string, spaceId: string): SurferExecutionRecord {
    const r = s.records.find((r) => r.reservationId === id);
    if (!r || !this.policy.allowedSpaceIds.includes(spaceId) || r.request.spaceId !== spaceId)
      throw conflict('Reservation unavailable in this scope.');
    return r;
  }
  read(id: string, spaceId: string): Promise<SurferExecutionRecord> {
    return this.transact((s) => this.find(s, id, spaceId));
  }
  snapshot(): Promise<{ state: SurferExecutionState; accounted: SurferUsage }> {
    return this.transact((s) => ({ state: s, accounted: executionUsage(s) }));
  }
  cancelBeforeDispatch(id: string, spaceId: string): Promise<SurferExecutionRecord> {
    return this.transact((s) => {
      const r = this.find(s, id, spaceId);
      if (r.state === 'CANCELLED_BEFORE_DISPATCH') return r;
      if (r.state !== 'RESERVED') throw conflict('Cannot release dispatched/unknown execution.');
      r.state = 'CANCELLED_BEFORE_DISPATCH';
      s.sequence++;
      return r;
    });
  }
  markUnknown(id: string, spaceId: string, dispatchToken: string): Promise<SurferExecutionRecord> {
    return this.transact((s) => {
      const r = this.find(s, id, spaceId);
      if (r.dispatchToken !== dispatchToken || !active(r))
        throw conflict('Unknown outcome requires the original dispatch fence.');
      if (r.state !== 'OUTCOME_UNKNOWN') {
        r.state = 'OUTCOME_UNKNOWN';
        s.sequence++;
      }
      return r;
    });
  }
  saveCheckpoint(
    id: string,
    spaceId: string,
    token: string,
    sequence: number,
    value: unknown,
  ): Promise<SurferExecutionRecord> {
    assertSurferJson(value);
    if (
      !Number.isSafeInteger(sequence) ||
      sequence < 1 ||
      sequence > 1024 ||
      Buffer.byteLength(JSON.stringify(value)) > 65536
    )
      throw surferFailure('Checkpoint exceeds bounded protocol.');
    const checkpoint = structuredClone(value);
    return this.transact((s) => {
      const r = this.find(s, id, spaceId);
      if (r.state !== 'DISPATCHED' || r.dispatchToken !== token)
        throw conflict('Checkpoint dispatch fence mismatch.');
      if (
        sequence === r.checkpointSequence &&
        surferDigest(checkpoint) === surferDigest(r.checkpoint)
      )
        return r;
      if (sequence !== r.checkpointSequence + 1)
        throw conflict('Checkpoint sequence changed or regressed.');
      r.checkpoint = checkpoint;
      r.checkpointSequence = sequence;
      s.sequence++;
      return r;
    });
  }
  async settle(
    id: string,
    spaceId: string,
    token: string,
    usageInput: unknown,
    result: SurferWorkerResult,
  ): Promise<SurferExecutionRecord> {
    const usage = decodeSurferUsage(usageInput);
    assertSurferJson(result);
    if (
      !result ||
      Object.keys(result).sort().join(',') !== 'checkpoint,outcome,resultRef' ||
      !['SUCCEEDED', 'FAILED', 'YIELDED'].includes(result.outcome) ||
      (result.resultRef !== null &&
        (typeof result.resultRef !== 'string' || result.resultRef.length > 256))
    )
      throw surferFailure('Invalid execution result.');
    const copied = structuredClone(result),
      settlementDigest = surferDigest({ usage, result: copied });
    return this.transact((s) => {
      const r = this.find(s, id, spaceId);
      if (r.dispatchToken !== token || !token)
        throw conflict('Settlement dispatch fence mismatch.');
      if (r.settlementDigest) {
        if (r.settlementDigest !== settlementDigest)
          throw conflict('Settlement replay changed usage/result.');
        return r;
      }
      if (!active(r)) throw conflict('Only dispatched or unknown work can be reconciled.');
      if (
        r.request.executionKind === 'LOCAL_DETERMINISTIC' &&
        (usage.calls || usage.inputTokens || usage.outputTokens || usage.moneyMicros)
      )
        throw conflict('Local work cannot manufacture provider usage.');
      r.state = copied.outcome === 'FAILED' ? 'FAILED_KNOWN' : 'SETTLED';
      r.usage = usage;
      r.outcome = copied.outcome;
      r.checkpoint = copied.checkpoint;
      r.resultRef = copied.resultRef;
      r.settlementDigest = settlementDigest;
      s.sequence++;
      // Record actual overages rather than erasing incurred cost. live() blocks further work.
      return r;
    });
  }
}

export * from './local-scheduler.js';

export * from './cognitive-router.js';
export * from './provider-executor.js';
export * from './semantic-runner.js';
export * from './runtime-controls.js';
