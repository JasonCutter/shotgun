import { createHash } from 'node:crypto';
import { sha256Text } from '../../../packages/contracts/src/document-evidence.js';
import type { SurferExperimentDatasetPort } from '../../../packages/contracts/src/surfer-experiment.js';
import {
  decodeSurferLearningCase,
  surferDigest,
  surferFailure,
  type SurferLearningCase,
  type SurferObservation,
  type SurferScope,
} from '../../../packages/contracts/src/surfer-learning.js';

export type SurferReferenceFamily = 'F1' | 'F2' | 'F3';
export type SurferReferencePartition = 'development' | 'locked' | 'counterexample' | 'future';
export type SurferCaseInput = Omit<SurferLearningCase, 'observedOutcome'>;
export type SurferReferenceDocument = {
  readonly caseId: string;
  readonly content: string;
  readonly digest: string;
};
export type SurferReferenceAccess = {
  readonly spaceId: string;
  readonly accessScope: readonly string[];
  readonly clearance: SurferScope['sensitivity'];
};
const rank = { public: 0, internal: 1, private: 2, restricted: 3 };
const counts = { development: 32, locked: 16, counterexample: 8, future: 8 } as const;

function allow(context: SurferReferenceAccess, scope: SurferScope): void {
  if (
    context.spaceId !== scope.spaceId ||
    !scope.accessScope.every((s) => context.accessScope.includes(s)) ||
    rank[context.clearance] === undefined ||
    rank[context.clearance] < rank[scope.sensitivity]
  ) {
    throw surferFailure(
      'Reference corpus access is outside the authorized scope.',
      'read-reference-corpus',
    );
  }
}

/** Synthetic authored oracle only. No rule/model is supplied to the learning view. */
export function createSurferReferenceCorpus(seed: string, scope: SurferScope) {
  if (!seed.trim() || seed.length > 256) throw surferFailure('Invalid reference corpus seed.');
  // Decode a representative record first so caller scope is validated and detached.
  const checkedScope = decodeSurferLearningCase({
    schemaVersion: '1.0.0',
    caseId: 'scope-check',
    eventGroup: 'scope-check',
    domain: 'scope-check',
    scope,
    features: { check: { value: true } },
    observedOutcome: true,
    witnesses: [
      { sourceId: 's', sourceVersionId: 'v', evidenceId: 'e', materialDigest: surferDigest(seed) },
    ],
  }).scope;
  const datasetId = `surfer-reference-v1:${createHash('sha256').update(seed).digest('hex').slice(0, 16)}`;
  const data = new Map<
    string,
    { cases: SurferLearningCase[]; documents: SurferReferenceDocument[] }
  >();
  const publicPartitions: {
    family: SurferReferenceFamily;
    partition: SurferReferencePartition;
    count: number;
    digest: string;
  }[] = [];
  for (const family of ['F1', 'F2', 'F3'] as const) {
    const bytes = createHash('sha256').update(`${seed}:${family}`).digest();
    const a = 50 + (bytes[0]! % 20),
      b = 40 + (bytes[1]! % 20);
    const expectedSupplier = `S${1 + (bytes[2]! % 8)}`;
    const otherSupplier = `X${1 + (bytes[3]! % 8)}`;
    for (const partition of ['development', 'locked', 'counterexample', 'future'] as const) {
      const cases: SurferLearningCase[] = [],
        documents: SurferReferenceDocument[] = [];
      for (let i = 0; i < counts[partition]; i++) {
        const caseId = `${datasetId}:${family}:${partition}:${i}`;
        const isCounter = partition === 'counterexample';
        const revisedContext = isCounter || (partition === 'future' && i % 2 === 0);
        const phase = i % 4;
        // Distinct event/device/time groups, not shuffled copies of training rows.
        const offset =
          1 + Math.floor(i / 4) + (partition === 'locked' ? 11 : partition === 'future' ? 23 : 0);
        const features: Record<string, SurferObservation> = {};
        let observedOutcome: boolean;
        if (family === 'F1') {
          const temperature = a + (phase === 1 ? -offset : offset);
          const humidity = b + (phase === 2 ? -offset : offset);
          features.temperature = { value: temperature, unit: 'Cel' };
          features.humidity = { value: humidity, unit: '%' };
          features.materialGrade = { value: revisedContext ? 'B' : 'A' };
          observedOutcome = temperature >= a && humidity >= b && !revisedContext;
        } else if (family === 'F2') {
          const inspection = offset,
            approval = offset + (phase === 1 ? -1 : 2);
          const dispatch = approval + (phase === 2 ? b + 1 : 3);
          features.inspectionHour = { value: inspection, unit: 'h' };
          features.approvalHour = { value: approval, unit: 'h' };
          features.dispatchHour = { value: dispatch, unit: 'h' };
          features.permitValid = { value: !revisedContext };
          observedOutcome =
            inspection <= approval &&
            dispatch > approval &&
            dispatch - approval <= b &&
            !revisedContext;
        } else {
          const supplier = phase === 1 ? otherSupplier : expectedSupplier;
          const inspectionComplete = phase !== 2;
          features.supplierCode = { value: supplier };
          features.inspectionComplete = { value: inspectionComplete };
          features.specialBatch = { value: revisedContext };
          observedOutcome = supplier === expectedSupplier && inspectionComplete && !revisedContext;
        }
        const openOutcome = partition === 'development' || partition === 'counterexample';
        const prefix =
          partition === 'development'
            ? '운영 관측 보고서'
            : partition === 'counterexample'
              ? '새 배치 관측 보고서'
              : '신규 대상 측정 기록';
        const content = [
          prefix,
          `사건: ${caseId}`,
          `독립 대상군: ${family}-${partition}-${i}`,
          ...Object.entries(features).map(
            ([key, item]) => `${key}: ${String(item.value)}${item.unit ? ` ${item.unit}` : ''}`,
          ),
          `관측 결과: ${openOutcome ? (observedOutcome ? '이상 발생' : '정상') : '아직 공개되지 않음'}`,
        ].join('\n');
        const digest = sha256Text(content);
        const record = decodeSurferLearningCase({
          schemaVersion: '1.0.0',
          caseId,
          eventGroup: `${family}:${partition}:event:${i}`,
          domain: `operations-quality:${family}`,
          scope: checkedScope,
          features,
          observedOutcome,
          witnesses: [
            {
              sourceId: caseId,
              sourceVersionId: `${caseId}:v1`,
              evidenceId: `${caseId}:e1`,
              materialDigest: digest,
            },
          ],
        });
        cases.push(record);
        documents.push({ caseId, content, digest });
      }
      data.set(`${family}:${partition}`, { cases, documents });
      publicPartitions.push({
        family,
        partition,
        count: cases.length,
        digest: surferDigest(cases),
      });
    }
  }
  const read = (
    context: SurferReferenceAccess,
    family: SurferReferenceFamily,
    partition: SurferReferencePartition,
  ) => {
    allow(context, checkedScope);
    const value = data.get(`${family}:${partition}`);
    if (!value) throw surferFailure('Unknown reference family or partition.');
    return structuredClone(value);
  };
  const manifest = Object.freeze({
    schema: 'surfer-reference-corpus-v1',
    datasetId,
    revision: 1,
    kind: 'SYNTHETIC_AUTHORED_ORACLE_NOT_WORLD_TRUTH',
    count: 192,
    partitions: publicPartitions,
    scope: structuredClone(checkedScope),
    limitations: [
      'No actual document semantic/model quality certified.',
      'No generated target rule supplied to proposer.',
      'Observation labels in locked/future rows are evaluator-only; query documents omit outcomes.',
      'Feature meanings are authored; genuine semantic encoding must be measured separately.',
    ],
  });
  return {
    get manifest() {
      return structuredClone(manifest);
    },
    development: Object.freeze({
      read: (context: SurferReferenceAccess, family: SurferReferenceFamily) =>
        read(context, family, 'development'),
    }),
    counterexamples: Object.freeze({
      read: (context: SurferReferenceAccess, family: SurferReferenceFamily) =>
        read(context, family, 'counterexample'),
    }),
    evaluation: Object.freeze({
      read: (
        context: SurferReferenceAccess,
        family: SurferReferenceFamily,
        partition: 'locked' | 'future',
      ) => {
        if (partition !== 'locked' && partition !== 'future')
          throw surferFailure('Invalid evaluation partition.');
        const value = read(context, family, partition);
        return {
          inputs: value.cases.map(({ observedOutcome: _outcome, ...input }) => input),
          expected: value.cases.map((row) => ({
            caseId: row.caseId,
            outcome: row.observedOutcome,
          })),
          documents: value.documents,
        };
      },
    }),
  };
}

/** Pass this capability only to the independent experiment owner. */
export function createSurferReferenceDatasetPort(
  corpus: ReturnType<typeof createSurferReferenceCorpus>,
  family: SurferReferenceFamily,
): SurferExperimentDatasetPort {
  return {
    async describe(context) {
      const development = corpus.development.read(context, family).cases;
      const manifest = corpus.manifest;
      const partition = (name: 'locked' | 'future') => {
        const record = manifest.partitions.find(
          (item) => item.family === family && item.partition === name,
        );
        if (!record) throw surferFailure('Missing corpus partition.');
        return { count: record.count, digest: record.digest };
      };
      return {
        datasetId: `${manifest.datasetId}:${family}`,
        revision: manifest.revision,
        domain: `operations-quality:${family}`,
        scope: manifest.scope,
        developmentCaseIds: development.map((row) => row.caseId),
        developmentEventGroups: development.map((row) => row.eventGroup),
        partitions: { locked: partition('locked'), future: partition('future') },
      };
    },
    async read(context, partition) {
      const { inputs, expected } = corpus.evaluation.read(context, family, partition);
      return { inputs, expected };
    },
  };
}
