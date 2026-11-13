import { createHash } from 'node:crypto';
import {
  decodeSurferAccessContext,
  type SurferExperimentDatasetPort,
} from '../../../packages/contracts/src/surfer-experiment.js';
import {
  decodeSurferInductionDevelopment,
  type SurferInductionDatasetPort,
} from '../../../packages/contracts/src/surfer-induction.js';
import { decodeSurferRepairDevelopment } from '../../../packages/contracts/src/surfer-rule-replacement.js';
import { decodeSurferContinuationDevelopment } from '../../../packages/contracts/src/surfer-rule-continuation.js';
import {
  decodeSurferLearningCase,
  surferDigest,
  surferFailure,
  type SurferLearningCase,
  type SurferScope,
} from '../../../packages/contracts/src/surfer-learning.js';
/** Deliberately correlated commissioning observations;private authored oracle is not world truth. */
export function createSurferEmpiricalMiss(seed: string, scope: SurferScope) {
  if (typeof seed !== 'string' || seed.length < 16 || seed.length > 256)
    throw surferFailure('Invalid empirical-miss seed.');
  const bytes = createHash('sha256').update(seed).digest(),
    a = 50 + (bytes[0]! % 20),
    b = 40 + (bytes[1]! % 20),
    domain = 'surfer.empirical-miss.v1',
    datasetId = 'empirical-miss:' + surferDigest(seed).slice(7, 23);
  const truth = (x: number, y: number) => x >= a && y >= b;
  const row = (part: string, i: number, x: number, y: number): SurferLearningCase =>
    decodeSurferLearningCase({
      schemaVersion: '1.0.0',
      caseId: `${datasetId}:${part}:${i}`,
      eventGroup: `${datasetId}:${part}:event-${i}`,
      domain,
      scope,
      features: {
        temperature: { value: x, unit: 'Cel' },
        humidity: { value: y, unit: '%' },
        materialGrade: { value: 'A' },
      },
      observedOutcome: truth(x, y),
      witnesses: [
        {
          sourceId: 'authored:' + part + ':' + i,
          sourceVersionId: 'v1',
          evidenceId: 'observation',
          materialDigest: surferDigest([part, i, x, y]),
        },
      ],
    });
  const development = Array.from({ length: 32 }, (_, i) => {
      const j = i % 16,
        x = j % 8,
        y = (j * 3 + Math.floor(j / 8)) % 8;
      return row('development', i, i < 16 ? a + x : a - 1 - x, i < 16 ? b + y : b - 1 - y);
    }),
    reviews = Array.from({ length: 8 }, (_, i) => row('review', i, a + i, b - 1 - i)),
    locked = Array.from({ length: 16 }, (_, i) =>
      row('locked', i, i < 8 ? a + 32 + i : a - 32 - i, i < 8 ? b + 32 + i : b - 32 - i),
    ),
    challenge = row('challenge', 0, a - 1, b),
    checkedScope = development[0]!.scope;
  const authorize = (input: unknown) => {
    const c = decodeSurferAccessContext(input),
      rank = { public: 0, internal: 1, private: 2, restricted: 3 };
    if (
      c.spaceId !== checkedScope.spaceId ||
      !checkedScope.accessScope.every((x) => c.accessScope.includes(x)) ||
      rank[c.clearance] < rank[checkedScope.sensitivity]
    )
      throw surferFailure('Empirical-miss scope denied.');
  };
  const parts = { development, reviews, locked };
  const evaluation: SurferInductionDatasetPort = {
    describeDevelopment: async (c) => {
      authorize(c);
      return { datasetId, revision: 2, developmentDigest: surferDigest(development) };
    },
    describe: async (c) => {
      authorize(c);
      return {
        datasetId,
        revision: 2,
        domain,
        scope: structuredClone(checkedScope),
        developmentCaseIds: development.map((x) => x.caseId),
        developmentEventGroups: development.map((x) => x.eventGroup),
        partitions: {
          locked: { count: 16, digest: surferDigest(locked) },
          future: { count: 0, digest: surferDigest([]) },
        },
      };
    },
    read: async (c, p) => {
      authorize(c);
      if (p !== 'locked') throw surferFailure('Initial empirical-miss capability is locked-only.');
      return {
        inputs: locked.map(({ observedOutcome: _label, ...r }) => structuredClone(r)),
        expected: locked.map((r) => ({ caseId: r.caseId, outcome: r.observedOutcome })),
      };
    },
  };
  function future(
    input: unknown,
    generation: string,
    stage: 'COMMISSIONING' | 'DISCRIMINATING',
    previousFeatures: readonly string[] = [],
  ): SurferExperimentDatasetPort {
    if (typeof generation !== 'string' || generation.length < 16 || generation.length > 256)
      throw surferFailure('Invalid empirical future generation.');
    const dev =
      stage === 'COMMISSIONING'
        ? decodeSurferRepairDevelopment(input)
        : decodeSurferContinuationDevelopment(input);
    if (
      dev.cases.length !== (stage === 'COMMISSIONING' ? 40 : 41) ||
      dev.cases.some(
        (r) =>
          r.domain !== domain ||
          surferDigest(r.scope) !== surferDigest(checkedScope) ||
          typeof r.features.temperature?.value !== 'number' ||
          r.features.temperature.unit !== 'Cel' ||
          typeof r.features.humidity?.value !== 'number' ||
          r.features.humidity.unit !== '%' ||
          r.features.materialGrade?.value !== 'A' ||
          r.observedOutcome !== truth(r.features.temperature.value, r.features.humidity.value),
      )
    )
      throw surferFailure('Empirical future requires the unchanged authored observations/scope.');
    const seen = new Set([...previousFeatures, ...dev.cases.map((r) => surferDigest(r.features))]),
      values = (name: string) => [
        ...new Set(dev.cases.map((r) => Number(r.features[name]!.value))),
      ],
      all: SurferLearningCase[] = [];
    for (const x of values('temperature'))
      for (const y of values('humidity')) {
        const r = row('future:' + surferDigest(generation).slice(7, 23), all.length, x, y);
        if (seen.has(surferDigest(r.features))) continue;
        if (r.observedOutcome || (stage === 'COMMISSIONING' ? y < b : x < a && y >= b)) all.push(r);
      }
    all.sort((x, y) =>
      surferDigest([generation, x.features]).localeCompare(surferDigest([generation, y.features])),
    );
    const rows = [
      ...all.filter((r) => r.observedOutcome).slice(0, 8),
      ...all.filter((r) => !r.observedOutcome).slice(0, 8),
    ];
    if (rows.length !== 16) throw surferFailure('Insufficient disjoint empirical future.');
    return {
      describe: async (c) => {
        authorize(c);
        return {
          datasetId: dev.datasetId,
          revision: 1,
          domain,
          scope: structuredClone(checkedScope),
          developmentCaseIds: dev.cases.map((r) => r.caseId),
          developmentEventGroups: dev.cases.map((r) => r.eventGroup),
          partitions: {
            locked: { count: 0, digest: surferDigest([]) },
            future: { count: 16, digest: surferDigest(rows) },
          },
        };
      },
      read: async (c, p) => {
        authorize(c);
        if (p !== 'future') throw surferFailure('Fresh empirical future only.');
        return {
          inputs: rows.map(({ observedOutcome: _label, ...r }) => structuredClone(r)),
          expected: rows.map((r) => ({ caseId: r.caseId, outcome: r.observedOutcome })),
        };
      },
    };
  }
  return {
    get manifest() {
      return {
        schema: 'surfer-empirical-miss-v1',
        datasetId,
        revision: 2,
        domain,
        scope: structuredClone(checkedScope),
        kind: 'SYNTHETIC_UNDERIDENTIFIED_COMMISSIONING_NOT_WORLD_TRUTH',
        partitions: Object.fromEntries(
          Object.entries(parts).map(([p, rows]) => [
            p,
            { count: rows.length, digest: surferDigest(rows) },
          ]),
        ),
      };
    },
    development: {
      read: (c: unknown) => {
        authorize(c);
        return decodeSurferInductionDevelopment({
          contract: 'surfer.induction-development.v1',
          datasetId,
          cases: structuredClone(development),
        });
      },
    },
    evaluation,
    counterexamples: {
      read: (c: unknown) => {
        authorize(c);
        return structuredClone(reviews);
      },
    },
    challenge: (c: unknown) => {
      authorize(c);
      return structuredClone(challenge);
    },
    future,
  };
}
