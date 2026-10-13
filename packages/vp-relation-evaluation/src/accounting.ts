import { ratio } from '../../quality-evaluation/src/metrics.js';

import { relationArtifactDigest } from './digest.js';

export type AccountingBinding = {
  readonly taskId: string;
  readonly jobId: string;
  readonly semanticAttemptId: string;
  readonly executionKey: string;
  readonly inputDigest: string;
  readonly providerIdentity: string;
  readonly modelIdentity: string;
};
export type AccountingClaim = AccountingBinding & {
  readonly claimId: string;
  readonly storeId: string;
  readonly authorityId: string;
  readonly budgetDay: string;
  readonly state:
    | 'RESERVED'
    | 'RELEASED_UNUSED'
    | 'EXECUTION_AUTHORIZED'
    | 'PROVIDER_SUCCEEDED'
    | 'PROVIDER_FAILED';
};
export type AccountingCall = AccountingBinding & {
  readonly callId: string;
  readonly claimId: string;
  readonly state: 'AUTHORIZED_NOT_STARTED' | 'SUCCEEDED' | 'FAILED' | 'OUTCOME_UNKNOWN';
  readonly providerResponseId: string | null;
  readonly decisionDisposition: 'ADOPTED' | 'WITHHELD' | 'INVALID_OUTPUT' | 'NOT_EVALUATED';
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  /** Measured client adapter duration. Reservation/lease dwell time is not this boundary. */
  readonly latency: {
    readonly boundary: 'ADAPTER_INVOKE_TO_RESPONSE_OR_THROW';
    readonly milliseconds: number;
    readonly instrumentRevision: string;
    readonly observationDigest: string;
  } | null;
};
export type AccountingInvoiceLine = {
  readonly invoiceId: string;
  readonly lineId: string;
  readonly claimId: string;
  readonly callId: string;
  readonly providerIdentity: string;
  readonly modelIdentity: string;
  readonly providerResponseId: string;
  readonly currency: string;
  /** Exact nonnegative decimal. No floating point pricing or token-rate estimates. */
  readonly amount: string;
  readonly billingRecordLocator: string;
  readonly billingRecordDigest: string;
  readonly checkedBy: string;
};

const bindingKeys = [
  'taskId',
  'jobId',
  'semanticAttemptId',
  'executionKey',
  'inputDigest',
  'providerIdentity',
  'modelIdentity',
] as const;
const digestValid = (value: string): boolean => /^sha256:[0-9a-f]{64}$/u.test(value);
const require = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(`Relation accounting: ${message}`);
};
const unique = (ids: readonly string[], label: string): void =>
  require(new Set(ids).size === ids.length, `duplicate ${label}`);
const knownEgress = (call: AccountingCall): boolean => call.state !== 'AUTHORIZED_NOT_STARTED';
const sumTokens = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  require(Number.isSafeInteger(total), 'reported token sum exceeds exact integer range');
  return total;
};
const quantile = (values: readonly number[], fraction: number): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * fraction) - 1]!;
};
const sumExactDecimals = (amounts: readonly string[]): string => {
  const scale = Math.max(0, ...amounts.map((amount) => amount.split('.')[1]?.length ?? 0));
  const sum = amounts
    .reduce((total, amount) => {
      const [whole, fraction = ''] = amount.split('.');
      return total + BigInt(whole! + fraction.padEnd(scale, '0'));
    }, 0n)
    .toString()
    .padStart(scale + 1, '0');
  return scale === 0 ? sum : `${sum.slice(0, -scale)}.${sum.slice(-scale)}`;
};

/** Offline reconciliation of supplied observations, not an authority or proof of invoice authenticity. */
export function accountRelationExecutions(
  claims: readonly AccountingClaim[],
  calls: readonly AccountingCall[],
  invoiceLines: readonly AccountingInvoiceLine[] = [],
) {
  unique(
    claims.map((claim) => claim.claimId),
    'claim ID',
  );
  unique(
    claims.map((claim) => relationArtifactDigest([claim.jobId, claim.semanticAttemptId])),
    'attempt binding',
  );
  unique(
    calls.map((call) => call.callId),
    'provider call ID',
  );
  unique(
    calls.map((call) => call.claimId),
    'provider-call claim binding',
  );
  unique(
    invoiceLines.map((line) => relationArtifactDigest([line.invoiceId, line.lineId])),
    'invoice line',
  );
  unique(
    invoiceLines.map((line) => line.callId),
    'billing call attribution',
  );
  const byClaim = new Map(claims.map((claim) => [claim.claimId, claim]));
  const byCall = new Map(calls.map((call) => [call.callId, call]));
  for (const claim of claims) {
    for (const key of [...bindingKeys, 'claimId', 'storeId', 'authorityId'] as const)
      require(claim[key].trim(), `missing claim ${key}`);
    require(digestValid(claim.inputDigest), 'claim input digest invalid');
    require(/^\d{4}-\d{2}-\d{2}$/u.test(claim.budgetDay) &&
      Number.isFinite(Date.parse(claim.budgetDay)) &&
      new Date(claim.budgetDay).toISOString().slice(0, 10) ===
        claim.budgetDay, 'UTC budget day invalid');
    require([
      'RESERVED',
      'RELEASED_UNUSED',
      'EXECUTION_AUTHORIZED',
      'PROVIDER_SUCCEEDED',
      'PROVIDER_FAILED',
    ].includes(claim.state), 'claim state invalid');
  }
  for (const call of calls) {
    const claim = byClaim.get(call.claimId);
    require(claim && call.callId.trim(), 'unbound provider call');
    require(bindingKeys.every(
      (key) => call[key] === claim![key],
    ), 'call/claim execution identity mismatch');
    require(claim!.state !== 'RELEASED_UNUSED' &&
      claim!.state !== 'RESERVED', 'provider call against unauthorized/released claim');
    require(['AUTHORIZED_NOT_STARTED', 'SUCCEEDED', 'FAILED', 'OUTCOME_UNKNOWN'].includes(
      call.state,
    ), 'call state invalid');
    require(['ADOPTED', 'WITHHELD', 'INVALID_OUTPUT', 'NOT_EVALUATED'].includes(
      call.decisionDisposition,
    ), 'decision disposition invalid');
    if (call.state !== 'SUCCEEDED')
      require(call.decisionDisposition ===
        'NOT_EVALUATED', 'non-success call has semantic disposition');
    if (claim!.state === 'PROVIDER_SUCCEEDED')
      require(call.state === 'SUCCEEDED' ||
        call.state === 'OUTCOME_UNKNOWN', 'succeeded claim/call disagreement');
    if (claim!.state === 'PROVIDER_FAILED')
      require(call.state === 'FAILED' ||
        call.state === 'OUTCOME_UNKNOWN', 'failed claim/call disagreement');
    for (const tokens of [call.inputTokens, call.outputTokens])
      require(tokens === null ||
        (Number.isSafeInteger(tokens) && tokens >= 0), 'reported tokens invalid');
    if (call.state === 'AUTHORIZED_NOT_STARTED')
      require(call.inputTokens === null &&
        call.outputTokens === null &&
        call.latency === null &&
        call.providerResponseId === null, 'pre-egress state carries provider measurements');
    if (call.latency !== null) {
      require((call.state === 'SUCCEEDED' || call.state === 'FAILED') &&
        call.latency.boundary ===
          'ADAPTER_INVOKE_TO_RESPONSE_OR_THROW', 'latency boundary/outcome invalid');
      require(Number.isFinite(call.latency.milliseconds) &&
        call.latency.milliseconds >= 0 &&
        call.latency.instrumentRevision.trim() &&
        digestValid(call.latency.observationDigest), 'latency evidence invalid');
    }
  }
  unique(
    calls
      .filter((call) => call.providerResponseId !== null)
      .map((call) =>
        relationArtifactDigest([
          byClaim.get(call.claimId)!.authorityId,
          call.providerIdentity,
          call.providerResponseId,
        ]),
      ),
    'provider response attribution',
  );
  for (const line of invoiceLines) {
    const call = byCall.get(line.callId);
    require(call && knownEgress(call), 'invoice lacks observed egress');
    require(line.claimId === call!.claimId &&
      line.providerIdentity === call!.providerIdentity &&
      line.modelIdentity === call!.modelIdentity &&
      line.providerResponseId === call!.providerResponseId &&
      line.providerResponseId.trim(), 'invoice execution/provenance mismatch');
    require(/^[A-Z]{3}$/u.test(line.currency) &&
      /^(0|[1-9]\d*)(\.\d+)?$/u.test(line.amount) &&
      line.amount.length <= 100, 'invoice currency/decimal invalid');
    require(line.invoiceId.trim() &&
      line.lineId.trim() &&
      line.billingRecordLocator.trim() &&
      line.checkedBy.trim() &&
      digestValid(line.billingRecordDigest), 'invoice record provenance missing');
  }
  const egress = calls.filter(knownEgress);
  const callClaims = new Set(calls.map((call) => call.claimId));
  const finalizedClaimsWithoutCall = claims.filter(
    (claim) =>
      !callClaims.has(claim.claimId) &&
      ['PROVIDER_SUCCEEDED', 'PROVIDER_FAILED'].includes(claim.state),
  );
  const authorizedWithoutCall = claims.filter(
    (claim) => !callClaims.has(claim.claimId) && claim.state === 'EXECUTION_AUTHORIZED',
  );
  const knownEgressCount = egress.length + finalizedClaimsWithoutCall.length;
  const reportedInput = egress.filter((call) => call.inputTokens !== null);
  const reportedOutput = egress.filter((call) => call.outputTokens !== null);
  const durations = egress.flatMap((call) =>
    call.latency === null ? [] : [call.latency.milliseconds],
  );
  const currencies = [...new Set(invoiceLines.map((line) => line.currency))].sort();
  const result = {
    version: 'VP05_EXECUTION_ACCOUNTING_0.1' as const,
    counts: {
      globalClaims: claims.length,
      providerCallRecords: calls.length,
      knownEgress: knownEgressCount,
      authorizedWithoutCallRecord: authorizedWithoutCall.length,
      finalizedClaimMissingCallRecord: finalizedClaimsWithoutCall.length,
      outcomeUnknown: egress.filter((call) => call.state === 'OUTCOME_UNKNOWN').length,
      possibleUnknownEgress: authorizedWithoutCall.length,
      releasedUnused: claims.filter((claim) => claim.state === 'RELEASED_UNUSED').length,
      reservedWithoutCall: claims.filter(
        (claim) => claim.state === 'RESERVED' && !callClaims.has(claim.claimId),
      ).length,
      authorizedNotStarted: calls.filter((call) => call.state === 'AUTHORIZED_NOT_STARTED').length,
      succeeded: egress.filter((call) => call.state === 'SUCCEEDED').length,
      failed: egress.filter((call) => call.state === 'FAILED').length,
      adopted: egress.filter((call) => call.decisionDisposition === 'ADOPTED').length,
      withheld: egress.filter((call) => call.decisionDisposition === 'WITHHELD').length,
      invalidOutput: egress.filter((call) => call.decisionDisposition === 'INVALID_OUTPUT').length,
    },
    usage: {
      reportedInputTokens: sumTokens(reportedInput.map((call) => call.inputTokens!)),
      reportedOutputTokens: sumTokens(reportedOutput.map((call) => call.outputTokens!)),
      inputCoverage: ratio(reportedInput.length, knownEgressCount),
      outputCoverage: ratio(reportedOutput.length, knownEgressCount),
      completeUsageCoverage: ratio(
        egress.filter((call) => call.inputTokens !== null && call.outputTokens !== null).length,
        knownEgressCount,
      ),
      inputMissing: knownEgressCount - reportedInput.length,
      outputMissing: knownEgressCount - reportedOutput.length,
    },
    latency: {
      boundary: 'ADAPTER_INVOKE_TO_RESPONSE_OR_THROW' as const,
      quantileMethod: 'NEAREST_RANK' as const,
      observed: durations.length,
      coverage: ratio(durations.length, knownEgressCount),
      p50Milliseconds: quantile(durations, 0.5),
      p95Milliseconds: quantile(durations, 0.95),
    },
    billing: {
      attributedCalls: invoiceLines.length,
      coverage: ratio(invoiceLines.length, knownEgressCount),
      scope: 'SUPPLIED_MATCHED_INVOICE_LINES_ONLY' as const,
      amountsByCurrency: currencies.map((currency) => ({
        currency,
        exactAmount: sumExactDecimals(
          invoiceLines.filter((line) => line.currency === currency).map((line) => line.amount),
        ),
      })),
      totalPaidCost:
        invoiceLines.length === 0 ||
        currencies.length !== 1 ||
        invoiceLines.length !== knownEgressCount ||
        authorizedWithoutCall.length > 0
          ? null
          : {
              currency: currencies[0]!,
              exactAmount: sumExactDecimals(invoiceLines.map((line) => line.amount)),
            },
    },
  };
  return {
    ...result,
    artifactDigest: relationArtifactDigest({ claims, calls, invoiceLines, result }),
  };
}
