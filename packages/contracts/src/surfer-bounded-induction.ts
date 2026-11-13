import {
  assertSurferJson,
  decodeSurferExpression,
  surferDigest,
  surferFailure,
  type SurferExpression,
} from './surfer-learning.js';
import {
  decodeSurferInductionDevelopment,
  type SurferInductionDevelopment,
} from './surfer-induction.js';
import type { SurferExecutionRecord } from './surfer-execution.js';

export const SURFER_BOUNDED_REVISION = 'surfer-bounded-comparison-v1' as const;
export type SurferBoundedLimits = {
  maxFeatures: number;
  maxAtoms: number;
  maxExpressions: number;
  maxClauses: number;
  maxPrimitiveEvaluations: number;
};
export const SURFER_BOUNDED_LIMITS: Readonly<SurferBoundedLimits> = Object.freeze({
  maxFeatures: 8,
  maxAtoms: 256,
  maxExpressions: 20000,
  maxClauses: 3,
  maxPrimitiveEvaluations: 8192,
});
export type SurferBoundedRequest = {
  contract: 'surfer.bounded-induction-request.v1';
  runId: string;
  operationId: string;
  spaceId: string;
  sourceDigest: string;
  development: SurferInductionDevelopment;
};
export type SurferBoundedProposal = {
  contract: 'surfer.bounded-induction-proposal.v1';
  revision: typeof SURFER_BOUNDED_REVISION;
  requestDigest: string;
  limitsDigest: string;
  developmentDigest: string;
  status: 'PROPOSED' | 'NO_FIT' | 'LIMIT_REACHED' | 'UNSUPPORTED_DATA' | 'CONTRADICTORY_DATA';
  expression: SurferExpression | null;
  statistics: {
    generatedAtoms: number;
    distinctPredicates: number;
    expressionsChecked: number;
    primitiveEvaluations: number;
    selectedClauses: number;
  };
  reason: string;
};
export interface SurferBoundedProposerPort {
  propose(
    request: SurferBoundedRequest,
    signal?: AbortSignal,
  ): Promise<{ execution: SurferExecutionRecord; proposal: SurferBoundedProposal | null }>;
}
const exact = (value: object, keys: string[]) =>
  Object.keys(value).sort().join(',') === keys.sort().join(',');
const digestPattern = /^sha256:[a-f0-9]{64}$/;
export function decodeSurferBoundedLimits(input: unknown): SurferBoundedLimits {
  assertSurferJson(input);
  const p = structuredClone(input) as SurferBoundedLimits;
  if (
    !p ||
    !exact(p, Object.keys(SURFER_BOUNDED_LIMITS)) ||
    Object.entries(p).some(
      ([k, v]) =>
        !Number.isSafeInteger(v) ||
        v < 1 ||
        v > SURFER_BOUNDED_LIMITS[k as keyof SurferBoundedLimits],
    )
  )
    throw surferFailure('Invalid bounded search limits.');
  return p;
}
export function decodeSurferBoundedRequest(input: unknown): SurferBoundedRequest {
  assertSurferJson(input);
  const p = structuredClone(input) as SurferBoundedRequest;
  if (
    !p ||
    !exact(p, ['contract', 'runId', 'operationId', 'spaceId', 'sourceDigest', 'development']) ||
    p.contract !== 'surfer.bounded-induction-request.v1' ||
    typeof p.runId !== 'string' ||
    !/^[A-Za-z0-9-]{1,40}$/.test(p.runId) ||
    p.operationId !== 'semantic:' + p.runId + ':bounded-induction:propose' ||
    typeof p.sourceDigest !== 'string' ||
    !digestPattern.test(p.sourceDigest)
  )
    throw surferFailure('Invalid bounded proposal request.');
  p.development = decodeSurferInductionDevelopment(p.development);
  if (p.spaceId !== p.development.cases[0]!.scope.spaceId)
    throw surferFailure('Bounded proposal space differs.');
  return p;
}
export function decodeSurferBoundedProposal(
  input: unknown,
  request: SurferBoundedRequest,
  limitsInput: unknown,
): SurferBoundedProposal {
  const limits = decodeSurferBoundedLimits(limitsInput);
  assertSurferJson(input);
  const p = structuredClone(input) as SurferBoundedProposal;
  if (
    !p ||
    !exact(p, [
      'contract',
      'revision',
      'requestDigest',
      'limitsDigest',
      'developmentDigest',
      'status',
      'expression',
      'statistics',
      'reason',
    ]) ||
    p.contract !== 'surfer.bounded-induction-proposal.v1' ||
    p.revision !== SURFER_BOUNDED_REVISION ||
    p.requestDigest !== surferDigest(request) ||
    p.limitsDigest !== surferDigest(limits) ||
    p.developmentDigest !== surferDigest(request.development) ||
    !['PROPOSED', 'NO_FIT', 'LIMIT_REACHED', 'UNSUPPORTED_DATA', 'CONTRADICTORY_DATA'].includes(
      p.status,
    ) ||
    typeof p.reason !== 'string' ||
    p.reason.length > 512 ||
    !p.statistics ||
    !exact(p.statistics, [
      'generatedAtoms',
      'distinctPredicates',
      'expressionsChecked',
      'primitiveEvaluations',
      'selectedClauses',
    ]) ||
    Object.values(p.statistics).some((v) => !Number.isSafeInteger(v) || v < 0) ||
    p.statistics.generatedAtoms > limits.maxAtoms ||
    p.statistics.distinctPredicates > p.statistics.generatedAtoms ||
    p.statistics.expressionsChecked > limits.maxExpressions ||
    p.statistics.primitiveEvaluations > limits.maxPrimitiveEvaluations ||
    p.statistics.selectedClauses > limits.maxClauses
  )
    throw surferFailure('Invalid bounded proposal receipt.');
  if (p.status === 'PROPOSED') {
    if (!p.expression) throw surferFailure('Proposed expression missing.');
    p.expression = decodeSurferExpression(p.expression);
  } else if (p.expression !== null)
    throw surferFailure('Non-proposal cannot contain an expression.');
  return p;
}
