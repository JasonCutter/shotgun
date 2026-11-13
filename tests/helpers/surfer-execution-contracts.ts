import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SurferExecutionLedger } from '../../modules/surfer-execution/src/index.js';
import { surferDigest } from '../../packages/contracts/src/surfer-learning.js';
import {
  decodeSurferExecutionPolicy,
  decodeSurferReservation,
  zeroSurferUsage,
  type SurferExecutionPolicy,
  type SurferExecutionStorePort,
  type SurferReservationRequest,
} from '../../packages/contracts/src/surfer-execution.js';

export const executionPolicy = (
  changes: Partial<SurferExecutionPolicy> = {},
): SurferExecutionPolicy => ({
  schemaVersion: '1.0.0',
  budgetId: randomUUID(),
  generation: 'isolated-test-1',
  executionIdentity: 'fake-no-provider-authority',
  modelRevision: 'fake@1',
  egressPolicyRevision: 'DENY_NETWORK',
  pricingRevision: 'fixture@1',
  currency: 'USD',
  allowedSpaceIds: ['team-a', 'team-b'],
  limits: {
    calls: 10,
    inputTokens: 1000,
    outputTokens: 1000,
    moneyMicros: 10000,
    elapsedMs: 100000,
  },
  backgroundLimits: {
    calls: 5,
    inputTokens: 500,
    outputTokens: 500,
    moneyMicros: 5000,
    elapsedMs: 50000,
  },
  maxConcurrent: 2,
  maxBackgroundConcurrent: 1,
  maxQueued: 8,
  unitMaxMs: 2000,
  workerMemoryMb: 32,
  deadlineAtMs: Date.now() + 3600000,
  ...changes,
});
export const executionRequest = (
  changes: Partial<SurferReservationRequest> = {},
): SurferReservationRequest => ({
  schemaVersion: '1.0.0',
  operationId: randomUUID(),
  attempt: 1,
  runId: 'run-a',
  stepId: 'interpret',
  spaceId: 'team-a',
  inputDigest: surferDigest({ original: true }),
  priority: 'FOREGROUND',
  kind: 'INTERPRET',
  executionKind: 'PROVIDER',
  dependsOn: [],
  maximum: { calls: 1, inputTokens: 10, outputTokens: 10, moneyMicros: 20, elapsedMs: 1000 },
  ...changes,
});
export const successful = {
  outcome: 'SUCCEEDED' as const,
  checkpoint: null,
  resultRef: 'fixture-result',
};
export const actualUsage = {
  calls: 1,
  inputTokens: 4,
  outputTokens: 3,
  moneyMicros: 7,
  elapsedMs: 50,
};

export function surferExecutionContracts(label: string, make: () => SurferExecutionStorePort) {
  describe(label, () => {
    it('rejects unknown authority fields, fractional/negative budgets and executable getters', () => {
      expect(() => decodeSurferReservation({ ...executionRequest(), authorized: true })).toThrow();
      expect(() =>
        decodeSurferExecutionPolicy(
          executionPolicy({ limits: { ...actualUsage, moneyMicros: -1 } }),
        ),
      ).toThrow();
      expect(() =>
        decodeSurferReservation(executionRequest({ maximum: { ...actualUsage, calls: 0.5 } })),
      ).toThrow();
      expect(() =>
        decodeSurferReservation({
          get schemaVersion() {
            throw new Error('must not run');
          },
        }),
      ).toThrow('accessors');
    });
    it('atomically shares root token and money allowance across spaces/runs', async () => {
      const p = executionPolicy();
      p.limits.inputTokens = 20;
      p.backgroundLimits.inputTokens = 20;
      const store = make(),
        a = new SurferExecutionLedger(store, p),
        b = new SurferExecutionLedger(store, p);
      const values = await Promise.allSettled([
        a.reserve(executionRequest()),
        b.reserve(executionRequest({ spaceId: 'team-b', runId: 'run-b' })),
        a.reserve(executionRequest()),
      ]);
      expect(values.filter((x) => x.status === 'fulfilled')).toHaveLength(2);
      expect((await a.snapshot()).accounted.inputTokens).toBe(20);
    });
    it('replays exact reservations without double charge and rejects changed operation meaning', async () => {
      const ledger = new SurferExecutionLedger(make(), executionPolicy()),
        req = executionRequest();
      const first = await ledger.reserve(req),
        again = await ledger.reserve(req);
      expect(again).toEqual({ record: first.record, replayed: true });
      await expect(
        ledger.reserve({ ...req, inputDigest: surferDigest('different') }),
      ).rejects.toThrow('changed meaning');
      first.record.request.maximum.calls = 100;
      expect((await ledger.snapshot()).accounted.calls).toBe(1);
    });
    it('prevents silent generation/limit resets and nested policy mutation', async () => {
      const store = make(),
        p = executionPolicy(),
        ledger = new SurferExecutionLedger(store, p);
      await ledger.reserve(executionRequest());
      await expect(
        new SurferExecutionLedger(store, { ...p, generation: 'new' }).snapshot(),
      ).rejects.toThrow('cannot be reset');
      expect(() => {
        ledger.policy.limits.calls = 999;
      }).toThrow();
      p.limits.calls = 999;
      expect(ledger.policy.limits.calls).toBe(10);
    });
    it('rejects cross-space read/settlement and unauthorized namespaces', async () => {
      const ledger = new SurferExecutionLedger(make(), executionPolicy());
      await expect(ledger.reserve(executionRequest({ spaceId: 'private-other' }))).rejects.toThrow(
        'outside',
      );
      const { record } = await ledger.reserve(executionRequest());
      await expect(ledger.read(record.reservationId, 'team-b')).rejects.toThrow('scope');
      await expect(ledger.dispatch(record.reservationId, 'team-b')).rejects.toThrow('scope');
    });
    it('grants one dispatch across concurrent callers and never grants replay', async () => {
      const ledger = new SurferExecutionLedger(make(), executionPolicy()),
        { record } = await ledger.reserve(executionRequest());
      const claims = await Promise.all(
        Array.from({ length: 4 }, () => ledger.dispatch(record.reservationId, 'team-a')),
      );
      expect(claims.filter((x) => x.granted)).toHaveLength(1);
      expect((await ledger.read(record.reservationId, 'team-a')).state).toBe('DISPATCHED');
    });
    it('enforces durable concurrency and frees slots only after settlement', async () => {
      const p = executionPolicy({ maxConcurrent: 1 }),
        ledger = new SurferExecutionLedger(make(), p);
      const a = (await ledger.reserve(executionRequest())).record,
        b = (await ledger.reserve(executionRequest())).record;
      const claim = await ledger.dispatch(a.reservationId, 'team-a');
      await expect(ledger.dispatch(b.reservationId, 'team-a')).rejects.toThrow('Concurrent');
      await ledger.settle(
        a.reservationId,
        'team-a',
        claim.record.dispatchToken!,
        actualUsage,
        successful,
      );
      expect((await ledger.dispatch(b.reservationId, 'team-a')).granted).toBe(true);
    });
    it('keeps unknown costs/slots reserved and prohibits release or retry before readback', async () => {
      const ledger = new SurferExecutionLedger(make(), executionPolicy()),
        req = executionRequest();
      const { record } = await ledger.reserve(req),
        claim = await ledger.dispatch(record.reservationId, 'team-a');
      await ledger.markUnknown(record.reservationId, 'team-a', claim.record.dispatchToken!);
      await expect(ledger.cancelBeforeDispatch(record.reservationId, 'team-a')).rejects.toThrow(
        'Cannot release',
      );
      await expect(ledger.reserve({ ...req, attempt: 2 })).rejects.toThrow('Retry');
      expect((await ledger.snapshot()).accounted).toEqual(req.maximum);
      await ledger.settle(
        record.reservationId,
        'team-a',
        claim.record.dispatchToken!,
        actualUsage,
        successful,
      );
      expect((await ledger.snapshot()).accounted).toEqual(actualUsage);
    });
    it('settles actual usage once and rejects changed settlement or a forged fence', async () => {
      const ledger = new SurferExecutionLedger(make(), executionPolicy());
      const r = (await ledger.reserve(executionRequest())).record,
        c = await ledger.dispatch(r.reservationId, 'team-a');
      await expect(
        ledger.settle(r.reservationId, 'team-a', 'forged', actualUsage, successful),
      ).rejects.toThrow('fence');
      const first = await ledger.settle(
        r.reservationId,
        'team-a',
        c.record.dispatchToken!,
        actualUsage,
        successful,
      );
      expect(
        await ledger.settle(
          r.reservationId,
          'team-a',
          c.record.dispatchToken!,
          actualUsage,
          successful,
        ),
      ).toEqual(first);
      await expect(
        ledger.settle(
          r.reservationId,
          'team-a',
          c.record.dispatchToken!,
          { ...actualUsage, calls: 2 },
          successful,
        ),
      ).rejects.toThrow('changed');
      expect((await ledger.snapshot()).accounted).toEqual(actualUsage);
    });
    it('releases only definitely unexecuted work, with idempotent cancellation', async () => {
      const ledger = new SurferExecutionLedger(make(), executionPolicy()),
        req = executionRequest();
      const r = (await ledger.reserve(req)).record;
      await ledger.cancelBeforeDispatch(r.reservationId, 'team-a');
      await ledger.cancelBeforeDispatch(r.reservationId, 'team-a');
      expect((await ledger.snapshot()).accounted).toEqual(zeroSurferUsage());
      expect((await ledger.dispatch(r.reservationId, 'team-a')).granted).toBe(false);
      expect((await ledger.reserve({ ...req, attempt: 2 })).replayed).toBe(false);
    });
    it('charges failed attempts before a bounded retry and rejects logical input changes', async () => {
      const ledger = new SurferExecutionLedger(make(), executionPolicy()),
        req = executionRequest();
      const r = (await ledger.reserve(req)).record,
        c = await ledger.dispatch(r.reservationId, 'team-a');
      await ledger.settle(r.reservationId, 'team-a', c.record.dispatchToken!, actualUsage, {
        ...successful,
        outcome: 'FAILED',
      });
      await expect(
        ledger.reserve({ ...req, attempt: 2, inputDigest: surferDigest('new') }),
      ).rejects.toThrow('same logical');
      await ledger.reserve({ ...req, attempt: 2 });
      expect((await ledger.snapshot()).accounted.calls).toBe(2);
    });
    it('requires successful same-run/scope predecessors and never reruns completed steps', async () => {
      const ledger = new SurferExecutionLedger(make(), executionPolicy()),
        req = executionRequest();
      const r = (await ledger.reserve(req)).record;
      await expect(
        ledger.reserve(executionRequest({ dependsOn: [r.reservationId] })),
      ).rejects.toThrow('predecessor');
      const c = await ledger.dispatch(r.reservationId, 'team-a');
      await ledger.settle(
        r.reservationId,
        'team-a',
        c.record.dispatchToken!,
        actualUsage,
        successful,
      );
      await expect(ledger.reserve({ ...req, attempt: 2 })).rejects.toThrow('Retry');
      await expect(
        ledger.reserve(executionRequest({ dependsOn: [r.reservationId], runId: 'other-run' })),
      ).rejects.toThrow('predecessor');
      expect(
        (await ledger.reserve(executionRequest({ dependsOn: [r.reservationId] }))).record.state,
      ).toBe('RESERVED');
    });
    it('bounds background allowance independently and applies intake backpressure', async () => {
      const p = executionPolicy({ maxQueued: 1 }),
        ledger = new SurferExecutionLedger(make(), p);
      p.backgroundLimits.calls = 0;
      const r = (await ledger.reserve(executionRequest())).record;
      await expect(ledger.reserve(executionRequest())).rejects.toThrow('backpressure');
      await ledger.cancelBeforeDispatch(r.reservationId, 'team-a');
      const q = executionPolicy();
      q.backgroundLimits.calls = 0;
      const bg = new SurferExecutionLedger(make(), q);
      await expect(bg.reserve(executionRequest({ priority: 'BACKGROUND' }))).rejects.toThrow(
        'allowance',
      );
      expect((await bg.reserve(executionRequest())).record.state).toBe('RESERVED');
    });
    it('records actual overage and stops further dispatch instead of hiding incurred usage', async () => {
      const ledger = new SurferExecutionLedger(make(), executionPolicy());
      const r = (await ledger.reserve(executionRequest())).record,
        c = await ledger.dispatch(r.reservationId, 'team-a');
      await ledger.settle(
        r.reservationId,
        'team-a',
        c.record.dispatchToken!,
        { ...actualUsage, moneyMicros: 21 },
        successful,
      );
      expect((await ledger.snapshot()).accounted.moneyMicros).toBe(21);
      await expect(ledger.reserve(executionRequest())).rejects.toThrow('exceeded');
    });
    it('rejects expired admission/dispatch but still allows truthful late reconciliation', async () => {
      let now = 1000;
      const ledger = new SurferExecutionLedger(
        make(),
        executionPolicy({ deadlineAtMs: 5000 }),
        () => now,
      );
      const a = (await ledger.reserve(executionRequest())).record,
        b = (await ledger.reserve(executionRequest())).record;
      const c = await ledger.dispatch(a.reservationId, 'team-a');
      now = 6000;
      await expect(ledger.reserve(executionRequest())).rejects.toThrow('expired');
      await expect(ledger.dispatch(b.reservationId, 'team-a')).rejects.toThrow('expired');
      expect(
        (
          await ledger.settle(
            a.reservationId,
            'team-a',
            c.record.dispatchToken!,
            actualUsage,
            successful,
          )
        ).state,
      ).toBe('SETTLED');
    });
    it('persists a yielded checkpoint for a new attempt without replaying a completed unit', async () => {
      const store = make(),
        p = executionPolicy(),
        a = new SurferExecutionLedger(store, p),
        req = executionRequest();
      const r = (await a.reserve(req)).record,
        c = await a.dispatch(r.reservationId, 'team-a');
      await a.settle(r.reservationId, 'team-a', c.record.dispatchToken!, actualUsage, {
        outcome: 'YIELDED',
        checkpoint: { cursor: 3, inputDigest: req.inputDigest },
        resultRef: null,
      });
      const b = new SurferExecutionLedger(store, p);
      expect((await b.reserve({ ...req, attempt: 2 })).record.checkpoint).toEqual({
        cursor: 3,
        inputDigest: req.inputDigest,
      });
    });
    it('rolls back asynchronous callbacks or changed storage identity', async () => {
      const store = make(),
        id = randomUUID();
      await expect(
        store.transaction(id, (s) => {
          s.budgetId = 'changed';
          s.sequence++;
          return null;
        }),
      ).rejects.toThrow();
      await expect(store.transaction(id, (() => Promise.resolve(null)) as never)).rejects.toThrow();
      expect(await store.transaction(id, (s) => s.budgetId)).toBe(id);
    });
    it('fences durable checkpoint writes and rejects regression, changed replay and post-unknown writes', async () => {
      const ledger = new SurferExecutionLedger(make(), executionPolicy());
      const r = (await ledger.reserve(executionRequest())).record,
        c = await ledger.dispatch(r.reservationId, 'team-a');
      const first = await ledger.saveCheckpoint(
        r.reservationId,
        'team-a',
        c.record.dispatchToken!,
        1,
        { cursor: 2 },
      );
      expect(
        await ledger.saveCheckpoint(r.reservationId, 'team-a', c.record.dispatchToken!, 1, {
          cursor: 2,
        }),
      ).toEqual(first);
      await expect(
        ledger.saveCheckpoint(r.reservationId, 'team-a', c.record.dispatchToken!, 1, { cursor: 9 }),
      ).rejects.toThrow('sequence');
      await expect(
        ledger.saveCheckpoint(r.reservationId, 'team-a', 'forged', 2, {}),
      ).rejects.toThrow('fence');
      await ledger.markUnknown(r.reservationId, 'team-a', c.record.dispatchToken!);
      await expect(
        ledger.saveCheckpoint(r.reservationId, 'team-a', c.record.dispatchToken!, 2, {}),
      ).rejects.toThrow('fence');
    });
    it('rejects paused background work and provider accounting on local deterministic units', async () => {
      const ledger = new SurferExecutionLedger(
        make(),
        executionPolicy({ maxBackgroundConcurrent: 0 }),
      );
      await expect(ledger.reserve(executionRequest({ priority: 'BACKGROUND' }))).rejects.toThrow(
        'paused',
      );
      const r = (
        await ledger.reserve(
          executionRequest({
            executionKind: 'LOCAL_DETERMINISTIC',
            maximum: { ...zeroSurferUsage(), elapsedMs: 500 },
          }),
        )
      ).record;
      const c = await ledger.dispatch(r.reservationId, 'team-a');
      await expect(
        ledger.settle(r.reservationId, 'team-a', c.record.dispatchToken!, actualUsage, successful),
      ).rejects.toThrow('manufacture');
    });
  });
}
