import { describe, expect, it } from 'vitest';
import {
  accountRelationExecutions,
  relationArtifactDigest,
} from '../../packages/vp-relation-evaluation/src/index.js';
import type {
  AccountingClaim,
  AccountingCall,
  AccountingInvoiceLine,
} from '../../packages/vp-relation-evaluation/src/index.js';

const digest = relationArtifactDigest('synthetic-accounting-only');
const claim = (
  id: string,
  state: AccountingClaim['state'] = 'PROVIDER_SUCCEEDED',
): AccountingClaim => ({
  claimId: id,
  taskId: `task-${id}`,
  jobId: `job-${id}`,
  semanticAttemptId: `attempt-${id}`,
  executionKey: `execution-${id}`,
  inputDigest: digest,
  providerIdentity: 'fake-provider',
  modelIdentity: 'fake-model',
  storeId: 'synthetic-store',
  authorityId: 'synthetic-authority',
  budgetDay: '2026-10-12',
  state,
});
const call = (c: AccountingClaim, overrides: Partial<AccountingCall> = {}): AccountingCall => ({
  ...c,
  callId: `call-${c.claimId}`,
  state: 'SUCCEEDED',
  providerResponseId: `synthetic-response-${c.claimId}`,
  decisionDisposition: 'ADOPTED',
  inputTokens: 100,
  outputTokens: 10,
  latency: {
    boundary: 'ADAPTER_INVOKE_TO_RESPONSE_OR_THROW',
    milliseconds: 100,
    instrumentRevision: 'synthetic-monotonic-clock',
    observationDigest: digest,
  },
  ...overrides,
});
const invoice = (c: AccountingCall, amount = '0.10', currency = 'USD'): AccountingInvoiceLine => ({
  claimId: c.claimId,
  callId: c.callId,
  providerIdentity: c.providerIdentity,
  modelIdentity: c.modelIdentity,
  providerResponseId: c.providerResponseId!,
  currency,
  amount,
  invoiceId: 'SYNTHETIC-NOT-A-REAL-INVOICE',
  lineId: c.callId,
  billingRecordLocator: 'synthetic://unit-only',
  billingRecordDigest: digest,
  checkedBy: 'synthetic-test-only',
});

describe('prospective offline relation execution accounting, synthetic only', () => {
  it('uses N/A for missing usage, latency, invoice and empty execution denominators', () => {
    const empty = accountRelationExecutions([], []);
    expect(empty.usage.reportedInputTokens).toBeNull();
    expect(empty.latency.p50Milliseconds).toBeNull();
    expect(empty.billing.coverage.value).toBeNull();
    expect(empty.billing.totalPaidCost).toBeNull();
    const c = claim('one');
    const report = accountRelationExecutions(
      [c],
      [call(c, { inputTokens: null, outputTokens: null, latency: null })],
    );
    expect(report.usage.inputMissing).toBe(1);
    expect(report.latency.coverage.value).toBe(0);
    expect(report.billing.totalPaidCost).toBeNull();
  });
  it('counts successful withheld/invalid outputs and failure/UNKNOWN egress independently of adoption', () => {
    const cs = [
      claim('withheld'),
      claim('invalid'),
      claim('failed', 'PROVIDER_FAILED'),
      claim('unknown', 'EXECUTION_AUTHORIZED'),
      claim('released', 'RELEASED_UNUSED'),
    ];
    const calls = [
      call(cs[0]!, { decisionDisposition: 'WITHHELD' }),
      call(cs[1]!, { decisionDisposition: 'INVALID_OUTPUT' }),
      call(cs[2]!, {
        state: 'FAILED',
        decisionDisposition: 'NOT_EVALUATED',
        inputTokens: null,
        outputTokens: null,
      }),
      call(cs[3]!, {
        state: 'OUTCOME_UNKNOWN',
        decisionDisposition: 'NOT_EVALUATED',
        inputTokens: null,
        outputTokens: null,
        latency: null,
      }),
    ];
    const report = accountRelationExecutions(cs, calls);
    expect(report.counts).toMatchObject({
      knownEgress: 4,
      succeeded: 2,
      failed: 1,
      outcomeUnknown: 1,
      withheld: 1,
      invalidOutput: 1,
      adopted: 0,
      releasedUnused: 1,
    });
    expect(report.usage.inputCoverage).toEqual({ numerator: 2, denominator: 4, value: 0.5 });
  });
  it('distinguishes authorized missing records, finalized missing calls and unused reservations', () => {
    const report = accountRelationExecutions(
      [
        claim('reserved', 'RESERVED'),
        claim('authorized', 'EXECUTION_AUTHORIZED'),
        claim('known-no-record'),
      ],
      [],
    );
    expect(report.counts).toMatchObject({
      knownEgress: 1,
      possibleUnknownEgress: 1,
      authorizedWithoutCallRecord: 1,
      finalizedClaimMissingCallRecord: 1,
      reservedWithoutCall: 1,
    });
    expect(report.usage.inputMissing).toBe(1);
    expect(report.billing.totalPaidCost).toBeNull();
  });
  it('rejects duplicate claim/attempt/call/response bindings and released or mismatched execution', () => {
    const c = claim('one'),
      p = call(c);
    expect(() => accountRelationExecutions([c, c], [])).toThrow('duplicate claim');
    expect(() => accountRelationExecutions([c, { ...c, claimId: 'two' }], [])).toThrow(
      'duplicate attempt',
    );
    expect(() =>
      accountRelationExecutions([c, { ...c, claimId: 'two', executionKey: 'another-context' }], []),
    ).toThrow('duplicate attempt');
    expect(() => accountRelationExecutions([c], [p, { ...p, callId: 'two' }])).toThrow(
      'provider-call claim',
    );
    expect(() => accountRelationExecutions([c], [{ ...p, jobId: 'different' }])).toThrow(
      'identity mismatch',
    );
    expect(() => accountRelationExecutions([{ ...c, state: 'RELEASED_UNUSED' }], [p])).toThrow(
      'unauthorized/released',
    );
    const second = claim('two');
    expect(() =>
      accountRelationExecutions(
        [c, second],
        [p, call(second, { providerResponseId: p.providerResponseId })],
      ),
    ).toThrow('response attribution');
  });
  it('computes observed adapter duration nearest-rank quantiles and never uses claim dwell', () => {
    const cs = [claim('one'), claim('two'), claim('three')];
    const ps = cs.map((c, index) =>
      call(c, {
        latency: {
          boundary: 'ADAPTER_INVOKE_TO_RESPONSE_OR_THROW',
          milliseconds: [10, 20, 90][index]!,
          instrumentRevision: 'synthetic',
          observationDigest: digest,
        },
      }),
    );
    expect(accountRelationExecutions(cs, ps).latency).toMatchObject({
      p50Milliseconds: 20,
      p95Milliseconds: 90,
      observed: 3,
    });
    expect(() =>
      accountRelationExecutions(
        [cs[0]!],
        [{ ...ps[0]!, latency: { ...ps[0]!.latency!, boundary: 'CLAIM_DWELL' as never } }],
      ),
    ).toThrow('latency boundary');
  });
  it('adds invoice decimals exactly by currency, with complete attribution required for total paid cost', () => {
    const cs = [claim('one'), claim('two')],
      ps = cs.map((c) => call(c));
    const complete = accountRelationExecutions(cs, ps, [
      invoice(ps[0]!, '0.10'),
      invoice(ps[1]!, '0.20'),
    ]);
    expect(complete.billing.totalPaidCost).toEqual({ currency: 'USD', exactAmount: '0.30' });
    expect(accountRelationExecutions(cs, ps, [invoice(ps[0]!)]).billing.totalPaidCost).toBeNull();
    const mixed = accountRelationExecutions(cs, ps, [invoice(ps[0]!), invoice(ps[1]!, '2', 'KRW')]);
    expect(mixed.billing.totalPaidCost).toBeNull();
    expect(mixed.billing.amountsByCurrency).toHaveLength(2);
  });
  it('rejects fabricated attribution, missing invoice provenance, duplicate lines and floating scientific amounts', () => {
    const c = claim('one'),
      p = call(c),
      i = invoice(p);
    expect(() =>
      accountRelationExecutions([c], [p], [{ ...i, providerResponseId: 'wrong' }]),
    ).toThrow('invoice execution');
    expect(() => accountRelationExecutions([c], [p], [{ ...i, billingRecordLocator: '' }])).toThrow(
      'provenance missing',
    );
    expect(() => accountRelationExecutions([c], [p], [i, i])).toThrow('duplicate invoice');
    expect(() => accountRelationExecutions([c], [p], [{ ...i, amount: '1e-4' }])).toThrow(
      'currency/decimal',
    );
  });
  it('rejects invented usage in an explicitly unstarted attempt and invalid exact-token sums', () => {
    const c = claim('one', 'EXECUTION_AUTHORIZED');
    expect(() =>
      accountRelationExecutions(
        [c],
        [call(c, { state: 'AUTHORIZED_NOT_STARTED', decisionDisposition: 'NOT_EVALUATED' })],
      ),
    ).toThrow('pre-egress');
    const other = claim('two');
    expect(() =>
      accountRelationExecutions(
        [c, other],
        [call(c, { inputTokens: Number.MAX_SAFE_INTEGER }), call(other)],
      ),
    ).toThrow('token sum');
  });
});
