import { createHash } from 'node:crypto';
import { decodeSurferAccessContext } from '../../../packages/contracts/src/surfer-experiment.js';
import {
  decodeSurferLearningCase,
  surferDigest,
  surferFailure,
  type SurferLearningCase,
  type SurferScope,
} from '../../../packages/contracts/src/surfer-learning.js';
import {
  decodeSurferInductionDevelopment,
  type SurferInductionDatasetPort,
} from '../../../packages/contracts/src/surfer-induction.js';

/** Synthetic oracle stays in this closure; never hand the factory or seed to the model. */
export function createSurferInductionF1(seed: string, scope: SurferScope) {
  if (typeof seed !== 'string' || seed.length < 16 || seed.length > 256)
    throw surferFailure('Invalid induction seed.');
  const bytes = createHash('sha256').update(seed).digest(),
    a = 50 + (bytes[0]! % 20),
    b = 40 + (bytes[1]! % 20);
  const datasetId = 'induction-f1-v2:' + surferDigest(seed).slice(7, 23),
    domain = 'surfer.induction-f1.v2';
  const data: Record<string, SurferLearningCase[]> = {};
  const row = (partition: string, i: number, x: number, y: number, grade: string) =>
    decodeSurferLearningCase({
      schemaVersion: '1.0.0',
      caseId: `${datasetId}:${partition}:${i}`,
      eventGroup: `${datasetId}:${partition}:device-${i}`,
      domain,
      scope,
      features: {
        temperature: { value: x, unit: 'Cel' },
        humidity: { value: y, unit: '%' },
        materialGrade: { value: grade },
      },
      observedOutcome: x >= a && y >= b && grade === 'A',
      witnesses: [
        {
          sourceId: `synthetic:${partition}:${i}`,
          sourceVersionId: 'v2',
          evidenceId: 'observation',
          materialDigest: surferDigest({ partition, i, x, y, grade }),
        },
      ],
    });
  // Separate event groups and feature pairs. Both partitions contain near-boundary positive/negative cases.
  data.development = Array.from({ length: 32 }, (_, i) => {
    const k = 1 + Math.floor(i / 4),
      phase = i % 4;
    return row(
      'development',
      i,
      a + (phase === 0 ? 0 : phase === 1 ? -1 : k),
      b + (phase === 2 ? -1 : phase === 3 ? 0 : k),
      'A',
    );
  });
  data.locked = Array.from({ length: 16 }, (_, i) => {
    const k = 12 + Math.floor(i / 4),
      phase = i % 4;
    return row(
      'locked',
      i,
      a + (phase === 0 ? 0 : phase === 1 ? -1 : k),
      b +
        (phase === 0
          ? i === 0
            ? 0
            : 24 + Math.floor(i / 4)
          : phase === 2
            ? 0
            : phase === 1
              ? k
              : -1),
      'A',
    );
  });
  data.counterexample = Array.from({ length: 8 }, (_, i) =>
    row('counterexample', i, a + i, b + i, 'B'),
  );
  data.future = Array.from({ length: 8 }, (_, i) =>
    row('future', i, a + 25 + i, b + (i % 4 === 1 ? -1 : 25 + i), i % 2 ? 'B' : 'A'),
  );
  const checkedScope = data.development[0]!.scope;
  const allow = (input: unknown) => {
    const c = decodeSurferAccessContext(input),
      rank = { public: 0, internal: 1, private: 2, restricted: 3 };
    if (
      c.spaceId !== checkedScope.spaceId ||
      !checkedScope.accessScope.every((s) => c.accessScope.includes(s)) ||
      rank[c.clearance] < rank[checkedScope.sensitivity]
    )
      throw surferFailure('Induction dataset scope denied.');
  };
  const manifest = {
    schema: 'surfer-induction-f1-v2',
    datasetId,
    revision: 2,
    domain,
    scope: checkedScope,
    kind: 'SYNTHETIC_AUTHORED_ORACLE_NOT_WORLD_TRUTH',
    partitions: Object.fromEntries(
      Object.entries(data).map(([p, rows]) => [
        p,
        { count: rows.length, digest: surferDigest(rows) },
      ]),
    ),
  };
  const evaluation: SurferInductionDatasetPort = {
    async describeDevelopment(context) {
      allow(context);
      return { datasetId, revision: 2, developmentDigest: surferDigest(data.development!) };
    },
    async describe(context) {
      allow(context);
      return {
        datasetId,
        revision: 2,
        domain,
        scope: structuredClone(checkedScope),
        developmentCaseIds: data.development!.map((c) => c.caseId),
        developmentEventGroups: data.development!.map((c) => c.eventGroup),
        partitions: { locked: manifest.partitions.locked!, future: manifest.partitions.future! },
      };
    },
    async read(context, partition) {
      allow(context);
      if (!['locked', 'future'].includes(partition))
        throw surferFailure('Invalid induction evaluation partition.');
      return {
        inputs: data[partition]!.map(({ observedOutcome: _outcome, ...c }) => structuredClone(c)),
        expected: data[partition]!.map((c) => ({ caseId: c.caseId, outcome: c.observedOutcome })),
      };
    },
  };
  return {
    get manifest() {
      return structuredClone(manifest);
    },
    development: {
      read(context: unknown) {
        allow(context);
        return decodeSurferInductionDevelopment({
          contract: 'surfer.induction-development.v1',
          datasetId,
          cases: structuredClone(data.development),
        });
      },
    },
    evaluation,
    counterexamples: {
      read(context: unknown) {
        allow(context);
        return structuredClone(data.counterexample!);
      },
    },
  };
}
