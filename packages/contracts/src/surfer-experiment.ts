import { SchemaRegistry } from './schema-registry.js';
import { assertSurferJson, type SurferLearningCase, type SurferScope } from './surfer-learning.js';

export type SurferAccessContext = {
  readonly spaceId: string;
  readonly accessScope: readonly string[];
  readonly clearance: SurferScope['sensitivity'];
};
export type SurferCaseInput = Omit<SurferLearningCase, 'observedOutcome'>;
export type SurferEvaluationPartition = 'locked' | 'future';
export type SurferDatasetDescriptor = {
  readonly datasetId: string;
  readonly revision: number;
  readonly domain: string;
  readonly scope: SurferScope;
  readonly developmentCaseIds: readonly string[];
  readonly developmentEventGroups: readonly string[];
  readonly partitions: Readonly<
    Record<SurferEvaluationPartition, { readonly count: number; readonly digest: string }>
  >;
};
export type SurferEvaluationData = {
  readonly inputs: readonly SurferCaseInput[];
  readonly expected: readonly { readonly caseId: string; readonly outcome: boolean }[];
};
/** This capability belongs only to the experiment owner, never to a proposer. */
export interface SurferExperimentDatasetPort {
  describe(context: SurferAccessContext): Promise<SurferDatasetDescriptor>;
  read(
    context: SurferAccessContext,
    partition: SurferEvaluationPartition,
  ): Promise<SurferEvaluationData>;
}
export type SurferExperimentSpec = {
  readonly schemaVersion: '1.0.0';
  readonly experimentId: string;
  readonly datasetId: string;
  readonly datasetRevision: number;
  readonly partition: SurferEvaluationPartition;
  readonly selectedCandidateDigest: string;
  readonly validatorRevision: 'surfer-typed-rule-validator-v1';
  readonly policy: {
    readonly minimumCorrect: number;
    readonly minimumCoverage: number;
    readonly maxOperationsPerCase: number;
  };
};
export type SurferExperimentReceipt = {
  readonly experimentId: string;
  readonly candidateDigest: string;
  readonly specDigest: string;
  readonly datasetDigest: string;
  readonly validatorRevision: 'surfer-typed-rule-validator-v1';
  readonly scope: SurferScope;
  readonly status: 'SCOPE_VALIDATED' | 'REFUTED' | 'INSUFFICIENT';
  readonly total: number;
  readonly correct: number;
  readonly unknown: number;
  readonly accuracy: number | null;
  readonly coverage: number | null;
  readonly totalOperations: number;
  readonly evidenceLevel: 'CONTROLLED_DATASET_ONLY';
  readonly semanticAssessment: 'NOT_EVALUATED';
  readonly caseResults: readonly {
    readonly caseId: string;
    readonly prediction: 'TRUE' | 'FALSE' | 'UNKNOWN';
    readonly correct: boolean;
    readonly reasons: readonly string[];
  }[];
};
export type SurferExperimentReservation = {
  readonly experimentId: string;
  readonly selectionKey: string;
  readonly meaningDigest: string;
};
export type SurferExperimentClaim =
  | { readonly state: 'CLAIMED' }
  | { readonly state: 'COMPLETED'; readonly receipt: SurferExperimentReceipt }
  | { readonly state: 'RUNNING' | 'FAILED' | 'OUTCOME_UNKNOWN' };
/** claim/complete are atomic; failed/unknown reservations must not free a holdout. */
export interface SurferExperimentStorePort {
  claim(input: SurferExperimentReservation): Promise<SurferExperimentClaim>;
  complete(input: SurferExperimentReservation, receipt: SurferExperimentReceipt): Promise<void>;
  fail(input: SurferExperimentReservation, status: 'FAILED' | 'OUTCOME_UNKNOWN'): Promise<void>;
}

const text = { type: 'string', minLength: 1, maxLength: 256 };
const registry = new SchemaRegistry();
registry.register({
  name: 'surfer.access',
  version: '1.0.0',
  kind: 'query',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['spaceId', 'accessScope', 'clearance'],
    properties: {
      spaceId: text,
      accessScope: { type: 'array', items: text, maxItems: 64, uniqueItems: true },
      clearance: { enum: ['public', 'internal', 'private', 'restricted'] },
    },
  },
});
registry.register({
  name: 'surfer.experiment-spec',
  version: '1.0.0',
  kind: 'command',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'schemaVersion',
      'experimentId',
      'datasetId',
      'datasetRevision',
      'partition',
      'selectedCandidateDigest',
      'validatorRevision',
      'policy',
    ],
    properties: {
      schemaVersion: { const: '1.0.0' },
      experimentId: text,
      datasetId: text,
      datasetRevision: { type: 'integer', minimum: 1 },
      partition: { enum: ['locked', 'future'] },
      selectedCandidateDigest: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
      validatorRevision: { const: 'surfer-typed-rule-validator-v1' },
      policy: {
        type: 'object',
        additionalProperties: false,
        required: ['minimumCorrect', 'minimumCoverage', 'maxOperationsPerCase'],
        properties: {
          minimumCorrect: { type: 'integer', minimum: 1 },
          minimumCoverage: { type: 'number', minimum: 0, maximum: 1 },
          maxOperationsPerCase: { type: 'integer', minimum: 1, maximum: 50_000 },
        },
      },
    },
  },
});
function decode<T>(name: string, value: unknown): T {
  assertSurferJson(value);
  registry.validateInput(name, '1.0.0', value);
  return JSON.parse(JSON.stringify(value)) as T;
}
export const decodeSurferAccessContext = (input: unknown): SurferAccessContext =>
  decode('surfer.access', input);
export const decodeSurferExperimentSpec = (input: unknown): SurferExperimentSpec =>
  decode('surfer.experiment-spec', input);
