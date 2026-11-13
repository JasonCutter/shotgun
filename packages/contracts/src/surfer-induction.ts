import {
  assertSurferJson,
  decodeSurferLearningCase,
  surferDigest,
  surferFailure,
  type SurferLearningCase,
} from './surfer-learning.js';
import type { SurferAccessContext, SurferExperimentDatasetPort } from './surfer-experiment.js';

export interface SurferInductionDatasetPort extends SurferExperimentDatasetPort {
  describeDevelopment(
    context: SurferAccessContext,
  ): Promise<{ datasetId: string; revision: number; developmentDigest: string }>;
}

export type SurferInductionDevelopment = {
  contract: 'surfer.induction-development.v1';
  datasetId: string;
  cases: SurferLearningCase[];
};
/** Only this finite development view crosses the proposal Port; no evaluator capability. */
export function decodeSurferInductionDevelopment(input: unknown): SurferInductionDevelopment {
  assertSurferJson(input);
  const p = structuredClone(input) as SurferInductionDevelopment;
  if (
    !p ||
    Object.keys(p).sort().join(',') !== 'cases,contract,datasetId' ||
    p.contract !== 'surfer.induction-development.v1' ||
    typeof p.datasetId !== 'string' ||
    !/^[A-Za-z0-9:-]{1,128}$/.test(p.datasetId) ||
    !Array.isArray(p.cases) ||
    p.cases.length !== 32
  )
    throw surferFailure('Invalid induction development packet.');
  p.cases = p.cases.map(decodeSurferLearningCase);
  const first = p.cases[0]!;
  if (
    new Set(p.cases.map((c) => c.caseId)).size !== 32 ||
    new Set(p.cases.map((c) => c.eventGroup)).size !== 32 ||
    p.cases.some(
      (c) =>
        c.domain !== first.domain ||
        surferDigest(c.scope) !== surferDigest(first.scope) ||
        !c.caseId.startsWith(p.datasetId + ':development:') ||
        Object.keys(c.features).sort().join(',') !== Object.keys(first.features).sort().join(','),
    )
  )
    throw surferFailure('Induction development scope/group/feature binding differs.');
  return p;
}
/** Sixteen two-case pages fit the existing Source selection/anchor bounds without widening them. */
export function surferInductionPages(input: unknown): string[] {
  const p = decodeSurferInductionDevelopment(input);
  return Array.from({ length: 16 }, (_, index) => {
    const page = JSON.stringify({
      contract: 'surfer.induction-page.v1',
      datasetId: p.datasetId,
      index,
      cases: p.cases.slice(index * 2, index * 2 + 2),
    });
    if (page.length > 2048) throw surferFailure('Induction Source page exceeds its anchor bound.');
    return page;
  });
}
