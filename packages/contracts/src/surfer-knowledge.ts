import { SchemaRegistry } from './schema-registry.js';
import { assertSurferJson, type SurferScope, type SurferWitness } from './surfer-learning.js';

export type SurferArtifactRef = {
  readonly artifactId: string;
  readonly revision: number;
  readonly digest: string;
};
export type SurferInputRef = {
  readonly inputId: string;
  readonly revision: number;
  readonly digest: string;
};
export type SurferQueryFootprint = { readonly domain: string; readonly predicate: string };
export type SurferFootprintDependency = SurferQueryFootprint & {
  readonly exactEpoch: number;
  readonly domainEpoch: number;
  readonly globalEpoch: number;
};
export type SurferKnowledgeInput = {
  readonly inputId: string;
  readonly revision: number;
  readonly kind: 'SOURCE' | 'POLICY' | 'ACCESS' | 'DATASET' | 'CONCEPT' | 'EVALUATOR';
  readonly scope: SurferScope;
  readonly contentDigest: string;
  readonly retired: boolean;
  readonly observedAt: string;
  readonly witnesses: readonly SurferWitness[];
};
export type SurferKnowledgeBasis = {
  readonly spaceId: string;
  readonly authorityEpoch: number;
  readonly inputs: readonly SurferInputRef[];
  readonly artifacts: readonly SurferArtifactRef[];
  readonly footprints: readonly SurferFootprintDependency[];
};
export type SurferArtifactKind =
  | 'INTERPRETATION'
  | 'CASE'
  | 'HYPOTHESIS'
  | 'RULE'
  | 'PROCEDURE'
  | 'EPISODE'
  | 'FAILURE'
  | 'DERIVATION'
  | 'ENGINE_CANDIDATE';
/** Opaque payloads are stored, never executed or certified by this envelope codec. */
export type SurferArtifactDraft = {
  readonly schemaVersion: '1.0.0';
  readonly artifactId: string;
  readonly revision: number;
  readonly kind: SurferArtifactKind;
  readonly origin:
    'INTERPRETATION' | 'INDUCTION' | 'EXPERIENCE' | 'DERIVATION' | 'ENGINE_CANDIDATE';
  readonly scope: SurferScope;
  readonly domain: string;
  readonly createdAt: string;
  readonly observedAt: string;
  readonly validTime?: { readonly from: string; readonly to?: string };
  readonly producer: {
    readonly engineRevision: string;
    readonly modelRevision: string;
    readonly policyRevision: string;
    readonly executionId: string;
  };
  readonly payloadSchema: 'surfer.opaque.v1';
  readonly payload: Readonly<Record<string, unknown>>;
  readonly basis: SurferKnowledgeBasis;
};
export type SurferKnowledgeArtifact = SurferArtifactDraft & {
  readonly digest: string;
  readonly rootWitnesses: readonly SurferWitness[];
  readonly semanticAssessment: 'NOT_EVALUATED';
};
export type SurferKnowledgeSnapshot = {
  readonly schemaVersion: '1.0.0';
  readonly snapshotId: string;
  readonly spaceId: string;
  readonly sequence: number;
  readonly createdAt: string;
  readonly engineRevision: string;
  readonly entries: readonly SurferArtifactRef[];
  readonly closure: readonly SurferArtifactRef[];
  readonly semanticAssessment: 'NOT_EVALUATED';
  readonly digest: string;
};
export type SurferKnowledgeCommand =
  | {
      readonly action: 'OBSERVE_INPUT';
      readonly operationId: string;
      readonly expectedRevision: number | null;
      readonly input: SurferKnowledgeInput;
      readonly affectedFootprints: readonly SurferQueryFootprint[];
    }
  | {
      readonly action: 'APPEND_ARTIFACT';
      readonly operationId: string;
      readonly expectedRevision: number | null;
      readonly draft: SurferArtifactDraft;
    }
  | {
      readonly action: 'PUBLISH_SNAPSHOT';
      readonly operationId: string;
      readonly snapshotId: string;
      readonly expectedActiveSnapshotId: string | null;
      readonly entries: readonly SurferArtifactRef[];
      readonly engineRevision: string;
      readonly createdAt: string;
    };
export type SurferKnowledgeCommit = {
  readonly operationId: string;
  readonly sequence: number;
  readonly subjectKind: 'INPUT' | 'ARTIFACT' | 'SNAPSHOT';
  readonly subjectId: string;
  readonly revision: number;
  readonly digest: string;
};
export type SurferKnowledgeCapture = {
  readonly inputIds: readonly string[];
  readonly artifacts: readonly SurferArtifactRef[];
  readonly footprints: readonly SurferQueryFootprint[];
};
/** Owner state is local to Surfer. Do not expose it as a public projection or Canonical DB. */
export type SurferKnowledgeState = {
  schemaVersion: '1.0.0';
  spaceId: string;
  sequence: number;
  authorityEpoch: number;
  inputs: SurferKnowledgeInput[];
  artifacts: SurferKnowledgeArtifact[];
  epochs: { domain: string; predicate: string; epoch: number }[];
  snapshots: SurferKnowledgeSnapshot[];
  activeSnapshotId: string | null;
  commands: { operationId: string; meaningDigest: string; commit: SurferKnowledgeCommit }[];
};
export const emptySurferKnowledgeState = (spaceId: string): SurferKnowledgeState => ({
  schemaVersion: '1.0.0',
  spaceId,
  sequence: 0,
  authorityEpoch: 0,
  inputs: [],
  artifacts: [],
  epochs: [],
  snapshots: [],
  activeSnapshotId: null,
  commands: [],
});
/** Synchronous owner callback: isolated copy, serializable per-space execution, atomic commit/rollback. */
export interface SurferKnowledgeStorePort {
  transaction<T>(spaceId: string, apply: (state: SurferKnowledgeState) => T): Promise<T>;
  /** Optional row-locked immutable read view;callback must not mutate,returned data is detached. */
  read?<T>(spaceId: string, apply: (state: SurferKnowledgeState) => T): Promise<T>;
}
export function readSurferKnowledgeState<T>(
  store: SurferKnowledgeStorePort,
  spaceId: string,
  apply: (state: SurferKnowledgeState) => T,
): Promise<T> {
  return store.read ? store.read(spaceId, apply) : store.transaction(spaceId, apply);
}

const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});
const id = { type: 'string', minLength: 1, maxLength: 256 };
const integer = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const revision = { ...integer, minimum: 1 };
const expectedRevision = { anyOf: [revision, { type: 'null' }] };
const digest = { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' };
const timestamp = {
  type: 'string',
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$',
};
const list = (items: object, minItems = 0) => ({
  type: 'array',
  items,
  minItems,
  maxItems: 1024,
  uniqueItems: true,
});
const scope = object({
  spaceId: id,
  accessScope: list(id, 1),
  sensitivity: { enum: ['public', 'internal', 'private', 'restricted'] },
});
const footprint = object({ domain: id, predicate: id });
const artifactRef = object({ artifactId: id, revision, digest });
const inputRef = object({ inputId: id, revision, digest });
const witness = object({
  sourceId: id,
  sourceVersionId: id,
  evidenceId: id,
  materialDigest: digest,
});
const basis = object({
  spaceId: id,
  authorityEpoch: integer,
  inputs: list(inputRef),
  artifacts: list(artifactRef),
  footprints: list(
    object({
      domain: id,
      predicate: id,
      exactEpoch: integer,
      domainEpoch: integer,
      globalEpoch: integer,
    }),
  ),
});
const input = object({
  inputId: id,
  revision,
  kind: { enum: ['SOURCE', 'POLICY', 'ACCESS', 'DATASET', 'CONCEPT', 'EVALUATOR'] },
  scope,
  contentDigest: digest,
  retired: { type: 'boolean' },
  observedAt: timestamp,
  witnesses: list(witness),
});
const draft = object(
  {
    schemaVersion: { const: '1.0.0' },
    artifactId: id,
    revision,
    kind: {
      enum: [
        'INTERPRETATION',
        'CASE',
        'HYPOTHESIS',
        'RULE',
        'PROCEDURE',
        'EPISODE',
        'FAILURE',
        'DERIVATION',
        'ENGINE_CANDIDATE',
      ],
    },
    origin: {
      enum: ['INTERPRETATION', 'INDUCTION', 'EXPERIENCE', 'DERIVATION', 'ENGINE_CANDIDATE'],
    },
    scope,
    domain: id,
    createdAt: timestamp,
    observedAt: timestamp,
    validTime: object({ from: timestamp, to: timestamp }, ['from']),
    producer: object({
      engineRevision: id,
      modelRevision: id,
      policyRevision: id,
      executionId: id,
    }),
    payloadSchema: { const: 'surfer.opaque.v1' },
    payload: { type: 'object', additionalProperties: true },
    basis,
  },
  [
    'schemaVersion',
    'artifactId',
    'revision',
    'kind',
    'origin',
    'scope',
    'domain',
    'createdAt',
    'observedAt',
    'producer',
    'payloadSchema',
    'payload',
    'basis',
  ],
);
const registry = new SchemaRegistry();
registry.register({
  name: 'surfer.knowledge-command',
  version: '1.0.0',
  kind: 'command',
  inputSchema: {
    anyOf: [
      object({
        action: { const: 'OBSERVE_INPUT' },
        operationId: id,
        expectedRevision,
        input,
        affectedFootprints: list(footprint, 1),
      }),
      object({ action: { const: 'APPEND_ARTIFACT' }, operationId: id, expectedRevision, draft }),
      object({
        action: { const: 'PUBLISH_SNAPSHOT' },
        operationId: id,
        snapshotId: id,
        expectedActiveSnapshotId: { anyOf: [id, { type: 'null' }] },
        entries: list(artifactRef, 1),
        engineRevision: id,
        createdAt: timestamp,
      }),
    ],
  },
});
registry.register({
  name: 'surfer.knowledge-capture',
  version: '1.0.0',
  kind: 'query',
  inputSchema: object({
    inputIds: list(id),
    artifacts: list(artifactRef),
    footprints: list(footprint),
  }),
});
registry.register({
  name: 'surfer.artifact-ref',
  version: '1.0.0',
  kind: 'query',
  inputSchema: artifactRef,
});
function decode<T>(name: string, value: unknown): T {
  assertSurferJson(value);
  registry.validateInput(name, '1.0.0', value);
  return structuredClone(value) as T;
}
export const decodeSurferKnowledgeCommand = (value: unknown): SurferKnowledgeCommand =>
  decode('surfer.knowledge-command', value);
export const decodeSurferKnowledgeCapture = (value: unknown): SurferKnowledgeCapture =>
  decode('surfer.knowledge-capture', value);
export const decodeSurferArtifactRef = (value: unknown): SurferArtifactRef =>
  decode('surfer.artifact-ref', value);
