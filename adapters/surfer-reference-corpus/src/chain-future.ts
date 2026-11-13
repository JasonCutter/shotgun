import { createHash } from 'node:crypto';
import {
  decodeSurferAccessContext,
  type SurferExperimentDatasetPort,
} from '../../../packages/contracts/src/surfer-experiment.js';
import { decodeSurferContinuationDevelopment } from '../../../packages/contracts/src/surfer-rule-continuation.js';
import {
  decodeSurferLearningCase,
  surferDigest,
  surferFailure,
  type SurferLearningCase,
} from '../../../packages/contracts/src/surfer-learning.js';
import type { ChainState } from '../../../modules/surfer-learning/src/rule-chain-state.js';
import { chainNovelValues } from '../../../modules/surfer-learning/src/rule-chain-state.js';
/** Authored F1 diagnostic oracle. Excludes all recorded earlier future feature tuples. */
export function createSurferChainFuture(
  seed: string,
  generation: string,
  input: unknown,
  history: ChainState['history'],
  previous: SurferLearningCase[],
): SurferExperimentDatasetPort {
  const dev = decodeSurferContinuationDevelopment(input),
    scope = dev.cases[0]!.scope,
    bytes = createHash('sha256').update(seed).digest(),
    a = 50 + (bytes[0]! % 20),
    b = 40 + (bytes[1]! % 20);
  if (
    seed.length < 16 ||
    generation.length < 16 ||
    dev.cases.some((c) => c.domain !== 'surfer.induction-f1.v2')
  )
    throw surferFailure('Authored chain future requires F1 inputs.');
  const values = (name: string) => [...new Set(dev.cases.map((c) => c.features[name]!.value))],
    seen = new Set([...history.features, ...dev.cases.map((c) => surferDigest(c.features))]),
    all: SurferLearningCase[] = [];
  for (const x of values('temperature'))
    for (const y of values('humidity'))
      for (const grade of values('materialGrade')) {
        const features = {
          temperature: { value: x, unit: 'Cel' },
          humidity: { value: y, unit: '%' },
          materialGrade: { value: grade },
        };
        if (seen.has(surferDigest(features))) continue;
        all.push(
          decodeSurferLearningCase({
            schemaVersion: '1.0.0',
            caseId: 'chain-future:' + surferDigest([generation, features]).slice(7),
            eventGroup: 'chain-event:' + surferDigest([generation, features]).slice(7),
            domain: dev.cases[0]!.domain,
            scope,
            features,
            observedOutcome: Number(x) >= a && Number(y) >= b && grade === 'A',
            witnesses: [
              {
                sourceId: 'authored-chain:' + generation,
                sourceVersionId: 'v1',
                evidenceId: surferDigest(features),
                materialDigest: surferDigest([generation, features]),
              },
            ],
          }),
        );
      }
  all.sort((x, y) =>
    surferDigest([generation, x.features]).localeCompare(surferDigest([generation, y.features])),
  );
  const rows: SurferLearningCase[] = [];
  for (const v of chainNovelValues(previous, dev.cases)) {
    if (rows.some((c) => surferDigest(c.features[v.name]) === surferDigest(v.value))) continue;
    const next = all.find(
      (c) =>
        !rows.includes(c) &&
        surferDigest(c.features[v.name]) === surferDigest(v.value) &&
        rows.filter((r) => r.observedOutcome === c.observedOutcome).length < 8,
    );
    if (!next) throw surferFailure('Fresh chain future cannot cover the new support values.');
    rows.push(next);
  }
  for (const outcome of [true, false])
    for (const c of all)
      if (
        c.observedOutcome === outcome &&
        !rows.includes(c) &&
        rows.filter((r) => r.observedOutcome === outcome).length < 8
      )
        rows.push(c);
  if (rows.length !== 16 || rows.filter((c) => c.observedOutcome).length !== 8)
    throw surferFailure('Insufficient non-reused future combinations.');
  const authorize = (input: unknown) => {
    const c = decodeSurferAccessContext(input),
      rank = { public: 0, internal: 1, private: 2, restricted: 3 };
    if (
      c.spaceId !== scope.spaceId ||
      !scope.accessScope.every((s) => c.accessScope.includes(s)) ||
      rank[c.clearance] < rank[scope.sensitivity]
    )
      throw surferFailure('Chain future scope denied.');
  };
  return {
    describe: async (c) => {
      authorize(c);
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
    read: async (c, p) => {
      authorize(c);
      if (p !== 'future') throw surferFailure('Only the fresh chain future is exposed.');
      return {
        inputs: rows.map(({ observedOutcome: _label, ...row }) => structuredClone(row)),
        expected: rows.map((row) => ({ caseId: row.caseId, outcome: row.observedOutcome })),
      };
    },
  };
}
