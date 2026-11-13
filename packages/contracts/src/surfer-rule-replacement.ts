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
export const SURFER_REPLACEMENT_REVISION = 'surfer-replacement-comparison-v1' as const;
export type SurferRepairDevelopment = {
  contract: 'surfer.repair-development.v1';
  datasetId: string;
  cases: SurferLearningCase[];
};
export type SurferRepairRequest = {
  contract: 'surfer.replacement-request.v1';
  runId: string;
  operationId: string;
  spaceId: string;
  sourceDigest: string;
  development: SurferRepairDevelopment;
};
export type SurferRepairProposal = Omit<SurferBoundedProposal, 'contract' | 'revision'> & {
  contract: 'surfer.replacement-proposal.v1';
  revision: typeof SURFER_REPLACEMENT_REVISION;
};
export interface SurferRepairProposerPort {
  propose(
    request: SurferRepairRequest,
    signal?: AbortSignal,
  ): Promise<{ execution: SurferExecutionRecord; proposal: SurferRepairProposal | null }>;
}
const exact = (v: object, keys: string) => Object.keys(v).sort().join(',') === keys;
export function decodeSurferRepairDevelopment(input: unknown): SurferRepairDevelopment {
  assertSurferJson(input);
  const p = structuredClone(input) as SurferRepairDevelopment;
  if (
    !p ||
    !exact(p, 'cases,contract,datasetId') ||
    p.contract !== 'surfer.repair-development.v1' ||
    typeof p.datasetId !== 'string' ||
    !/^[A-Za-z0-9:-]{1,128}$/.test(p.datasetId) ||
    !Array.isArray(p.cases) ||
    p.cases.length < 33 ||
    p.cases.length > 40
  )
    throw surferFailure('Invalid replacement development packet.');
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
    throw surferFailure('Replacement development scope/group/catalog differs.');
  return p;
}
export function decodeSurferRepairRequest(input: unknown): SurferRepairRequest {
  assertSurferJson(input);
  const p = structuredClone(input) as SurferRepairRequest;
  if (
    !p ||
    !exact(p, 'contract,development,operationId,runId,sourceDigest,spaceId') ||
    p.contract !== 'surfer.replacement-request.v1' ||
    typeof p.runId !== 'string' ||
    !/^[A-Za-z0-9-]{1,40}$/.test(p.runId) ||
    p.operationId !== 'semantic:' + p.runId + ':replacement:propose' ||
    typeof p.sourceDigest !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(p.sourceDigest)
  )
    throw surferFailure('Invalid replacement worker request.');
  p.development = decodeSurferRepairDevelopment(p.development);
  if (p.spaceId !== p.development.cases[0]!.scope.spaceId)
    throw surferFailure('Replacement request space differs.');
  return p;
}
export function decodeSurferRepairProposal(
  input: unknown,
  request: SurferRepairRequest,
): SurferRepairProposal {
  assertSurferJson(input);
  const p = structuredClone(input) as SurferRepairProposal,
    limits = decodeSurferBoundedLimits(SURFER_BOUNDED_LIMITS);
  if (
    !p ||
    !exact(
      p,
      'contract,developmentDigest,expression,limitsDigest,reason,requestDigest,revision,statistics,status',
    ) ||
    p.contract !== 'surfer.replacement-proposal.v1' ||
    p.revision !== SURFER_REPLACEMENT_REVISION ||
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
    throw surferFailure('Invalid replacement proposal.');
  for (const [k, max] of Object.entries({
    generatedAtoms: limits.maxAtoms,
    distinctPredicates: limits.maxAtoms,
    expressionsChecked: limits.maxExpressions,
    primitiveEvaluations: limits.maxPrimitiveEvaluations,
    selectedClauses: limits.maxClauses,
  })) {
    const n = p.statistics[k as keyof typeof p.statistics];
    if (!Number.isSafeInteger(n) || n < 0 || n > max)
      throw surferFailure('Replacement search exceeded its fixed limits.');
  }
  if (p.status === 'PROPOSED') p.expression = decodeSurferExpression(p.expression);
  else if (p.expression !== null) throw surferFailure('Non-proposal contains an expression.');
  return p;
}
