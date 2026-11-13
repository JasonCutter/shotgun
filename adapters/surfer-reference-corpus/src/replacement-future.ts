import { createHash } from 'node:crypto';
import {
  decodeSurferAccessContext,
  type SurferExperimentDatasetPort,
} from '../../../packages/contracts/src/surfer-experiment.js';
import { decodeSurferRepairDevelopment } from '../../../packages/contracts/src/surfer-rule-replacement.js';
import {
  decodeSurferLearningCase,
  surferDigest,
  surferFailure,
  type SurferLearningCase,
} from '../../../packages/contracts/src/surfer-learning.js';
/** Authored F1 diagnostic only. The closed oracle/generation seed never crosses the proposer Port. */
export function createSurferReplacementFuture(
  originalSeed: string,
  generation: string,
  development: unknown,
): SurferExperimentDatasetPort {
  const dev = decodeSurferRepairDevelopment(development),
    scope = dev.cases[0]!.scope,
    bytes = createHash('sha256').update(originalSeed).digest(),
    a = 50 + (bytes[0]! % 20),
    b = 40 + (bytes[1]! % 20);
  if (
    originalSeed.length < 16 ||
    generation.length < 16 ||
    dev.cases.some((c) => c.domain !== 'surfer.induction-f1.v2')
  )
    throw surferFailure('Authored replacement future requires F1 inputs.');
  const values = (name: string) => [...new Set(dev.cases.map((c) => c.features[name]!.value))],
    seen = new Set(dev.cases.map((c) => surferDigest(c.features))),
    combinations: SurferLearningCase[] = [];
  for (const x of values('temperature'))
    for (const y of values('humidity'))
      for (const grade of values('materialGrade')) {
        const features = {
          temperature: { value: x, unit: 'Cel' },
          humidity: { value: y, unit: '%' },
          materialGrade: { value: grade },
        };
        if (seen.has(surferDigest(features))) continue;
        combinations.push(
          decodeSurferLearningCase({
            schemaVersion: '1.0.0',
            caseId: 'future:' + surferDigest([generation, features]).slice(7),
            eventGroup: 'event:' + surferDigest([generation, features]).slice(7),
            domain: dev.cases[0]!.domain,
            scope,
            features,
            observedOutcome: Number(x) >= a && Number(y) >= b && grade === 'A',
            witnesses: [
              {
                sourceId: 'authored-future:' + generation,
                sourceVersionId: 'v1',
                evidenceId: surferDigest(features),
                materialDigest: surferDigest([generation, features]),
              },
            ],
          }),
        );
      }
  combinations.sort((x, y) =>
    surferDigest([generation, x.features]).localeCompare(surferDigest([generation, y.features])),
  );
  const positive = combinations.filter((c) => c.observedOutcome).slice(0, 8),
    negative = combinations.filter((c) => !c.observedOutcome).slice(0, 8),
    rows = [...positive, ...negative];
  if (rows.length !== 16 || positive.length !== 8 || negative.length !== 8)
    throw surferFailure('Insufficient fresh supported future combinations.');
  const authorize = (input: unknown) => {
    const c = decodeSurferAccessContext(input),
      r = { public: 0, internal: 1, private: 2, restricted: 3 };
    if (
      c.spaceId !== scope.spaceId ||
      !scope.accessScope.every((s) => c.accessScope.includes(s)) ||
      r[c.clearance] < r[scope.sensitivity]
    )
      throw surferFailure('Replacement future scope denied.');
  };
  return {
    describe: async (context) => {
      authorize(context);
      return {
        datasetId: dev.datasetId,
        revision: 1,
        domain: dev.cases[0]!.domain,
        scope: structuredClone(scope),
        developmentCaseIds: dev.cases.map((c) => c.caseId),
        developmentEventGroups: dev.cases.map((c) => c.eventGroup),
        partitions: {
          locked: { count: 0, digest: surferDigest([]) },
          future: { count: 16, digest: surferDigest(rows) },
        },
      };
    },
    read: async (context, partition) => {
      authorize(context);
      if (partition !== 'future')
        throw surferFailure('Only the fresh replacement future partition is exposed.');
      return {
        inputs: rows.map(({ observedOutcome: _outcome, ...row }) => structuredClone(row)),
        expected: rows.map((c) => ({ caseId: c.caseId, outcome: c.observedOutcome })),
      };
    },
  };
}
