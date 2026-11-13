import {
  assertSurferJson,
  decodeSurferLearningCase,
  decodeSurferExpression,
  surferDigest,
  surferFailure,
  type SurferLearningCase,
} from './surfer-learning.js';
import {
  decodeSurferBoundedLimits,
  SURFER_BOUNDED_LIMITS,
  type SurferBoundedProposal,
} from './surfer-bounded-induction.js';
import type { SurferExecutionRecord } from './surfer-execution.js';
export const SURFER_CONTINUATION_REVISION = 'surfer-continuation-comparison-v1' as const;
export type SurferContinuationDevelopment = {
  contract: 'surfer.continuation-development.v1';
  datasetId: string;
  cases: SurferLearningCase[];
};
export type SurferContinuationRequest = {
  contract: 'surfer.continuation-request.v1';
  runId: string;
  operationId: string;
  spaceId: string;
  sourceDigest: string;
  development: SurferContinuationDevelopment;
};
export type SurferContinuationProposal = Omit<SurferBoundedProposal, 'contract' | 'revision'> & {
  contract: 'surfer.continuation-proposal.v1';
  revision: typeof SURFER_CONTINUATION_REVISION;
};
export interface SurferContinuationProposerPort {
  propose(
    request: SurferContinuationRequest,
    signal?: AbortSignal,
  ): Promise<{ execution: SurferExecutionRecord; proposal: SurferContinuationProposal | null }>;
}
const exact = (v: object, keys: string) => Object.keys(v).sort().join(',') === keys;
export function decodeSurferContinuationDevelopment(input: unknown): SurferContinuationDevelopment {
  assertSurferJson(input);
  const p = structuredClone(input) as SurferContinuationDevelopment;
  if (
    !p ||
    !exact(p, 'cases,contract,datasetId') ||
    p.contract !== 'surfer.continuation-development.v1' ||
    typeof p.datasetId !== 'string' ||
    !/^[A-Za-z0-9:-]{1,128}$/.test(p.datasetId) ||
    !Array.isArray(p.cases) ||
    p.cases.length < 41 ||
    p.cases.length > 56
  )
    throw surferFailure('Invalid continuation development packet.');
  p.cases = p.cases.map(decodeSurferLearningCase);
  const first = p.cases[0]!;
  if (
    new Set(p.cases.map((c) => c.caseId)).size !== p.cases.length ||
    new Set(p.cases.map((c) => c.eventGroup)).size !== p.cases.length ||
    p.cases.some(
      (c) =>
        c.domain !== first.domain ||
        surferDigest(c.scope) !== surferDigest(first.scope) ||
        Object.keys(c.features).sort().join(',') !== Object.keys(first.features).sort().join(','),
    )
  )
    throw surferFailure('Continuation development scope/group/catalog differs.');
  return p;
}
export function decodeSurferContinuationRequest(input: unknown): SurferContinuationRequest {
  assertSurferJson(input);
  const p = structuredClone(input) as SurferContinuationRequest;
  if (
    !p ||
    !exact(p, 'contract,development,operationId,runId,sourceDigest,spaceId') ||
    p.contract !== 'surfer.continuation-request.v1' ||
    typeof p.runId !== 'string' ||
    !/^[A-Za-z0-9-]{1,40}$/.test(p.runId) ||
    p.operationId !== 'semantic:' + p.runId + ':chain:propose' ||
    typeof p.sourceDigest !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(p.sourceDigest)
  )
    throw surferFailure('Invalid continuation worker request.');
  p.development = decodeSurferContinuationDevelopment(p.development);
  if (p.spaceId !== p.development.cases[0]!.scope.spaceId)
    throw surferFailure('Continuation request space differs.');
  return p;
}
export function decodeSurferContinuationProposal(
  input: unknown,
  request: SurferContinuationRequest,
): SurferContinuationProposal {
  assertSurferJson(input);
  const p = structuredClone(input) as SurferContinuationProposal,
    limits = decodeSurferBoundedLimits(SURFER_BOUNDED_LIMITS);
  if (
    !p ||
    !exact(
      p,
      'contract,developmentDigest,expression,limitsDigest,reason,requestDigest,revision,statistics,status',
    ) ||
    p.contract !== 'surfer.continuation-proposal.v1' ||
    p.revision !== SURFER_CONTINUATION_REVISION ||
    p.requestDigest !== surferDigest(request) ||
    p.developmentDigest !== surferDigest(request.development) ||
    p.limitsDigest !== surferDigest(limits) ||
    !['PROPOSED', 'NO_FIT', 'LIMIT_REACHED', 'UNSUPPORTED_DATA', 'CONTRADICTORY_DATA'].includes(
      p.status,
    ) ||
    typeof p.reason !== 'string' ||
    !p.reason.length ||
    p.reason.length > 256 ||
    !p.statistics ||
    !exact(
      p.statistics,
      'distinctPredicates,expressionsChecked,generatedAtoms,primitiveEvaluations,selectedClauses',
    )
  )
    throw surferFailure('Invalid continuation proposal.');
  for (const [k, max] of Object.entries({
    generatedAtoms: limits.maxAtoms,
    distinctPredicates: limits.maxAtoms,
    expressionsChecked: limits.maxExpressions,
    primitiveEvaluations: limits.maxPrimitiveEvaluations,
    selectedClauses: limits.maxClauses,
  })) {
    const n = p.statistics[k as keyof typeof p.statistics];
    if (!Number.isSafeInteger(n) || n < 0 || n > max)
      throw surferFailure('Continuation search exceeded its fixed limits.');
  }
  if (p.status === 'PROPOSED') p.expression = decodeSurferExpression(p.expression);
  else if (p.expression !== null) throw surferFailure('Non-proposal contains an expression.');
  return p;
}
