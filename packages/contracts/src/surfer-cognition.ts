import { ShotgunError } from './errors.js';
import type { SourceSelector, TextPositionSelector } from './document-evidence.js';
import type { SurferScope } from './surfer-learning.js';
import { assertSurferJson, surferDigest, surferFailure } from './surfer-learning.js';
import { SchemaRegistry } from './schema-registry.js';
import { assertSurferSourceBasisV2, type SurferSourceBasisV2 } from './surfer-source-binding-v2.js';
import type { SurferArtifactRef } from './surfer-knowledge.js';
import type { SurferUsage } from './surfer-execution.js';

export type SurferAnchorRef = { anchorId: string; revision: number; digest: string };
export type SurferObservationSelection = {
  sourceId: string;
  evidenceId: string;
  start: number;
  end: number;
  targetUnit: string | null;
};
export type SurferObservedLiteral =
  | {
      kind: 'NUMBER';
      decimal: string;
      unit: string | null;
      precision: {
        digits: number;
        scale: number;
        notation: 'PLAIN_DECIMAL';
        interpretation: 'LEXICAL_ONLY';
      };
    }
  | { kind: 'BOOLEAN'; value: boolean }
  | { kind: 'DATE'; value: string }
  | { kind: 'TEXT'; value: string }
  | { kind: 'UNMODELED'; reason: string };
export type SurferLiteralNormalization = {
  state: 'NOT_REQUIRED' | 'RESOLVED' | 'UNRESOLVED';
  targetUnit: string | null;
  normalizedValue: string | null;
  normalizedUnit: string | null;
  conversion: {
    revision: string;
    numerator: string;
    denominator: string;
    rounding: 'EXACT';
  } | null;
  reason: string | null;
};
export interface SurferLiteralNormalizationPort {
  readonly revision: string;
  normalize(observed: SurferObservedLiteral, targetUnit: string | null): SurferLiteralNormalization;
}
export type SurferObservationAnchor = {
  schemaVersion: '1.0.0';
  anchorId: string;
  revision: 1;
  scope: SurferScope;
  source: {
    originalAssetId: string;
    sourceId: string;
    sourceVersionId: string;
    revisionId: string;
    indexingResultId: string;
    sourceContentHash: string;
    documentHash: string;
    sourceMapHash: string;
    materialProof: string;
    evidenceId: string;
    evidenceDigest: string;
    pointer: string;
    sourceBindingContentDigest: string;
  };
  position: TextPositionSelector;
  selectors: SourceSelector[];
  rawLiteral: string;
  observed: SurferObservedLiteral;
  normalization: SurferLiteralNormalization;
  producer: { parserRevision: string; executionRef: string };
  contentRole: 'UNTRUSTED_SOURCE_DATA';
  groundingAssessment: 'SOURCE_BOUND_LITERAL';
  semanticAssessment: 'NOT_EVALUATED';
  digest: string;
};
export const SURFER_SEMANTIC_FIELDS = [
  'SUBJECT',
  'VALUE',
  'UNIT',
  'POLARITY',
  'QUANTIFIER',
  'TIME',
  'SCOPE',
  'CONDITIONS',
  'EXCEPTIONS',
  'DOCUMENT_ROLE',
] as const;
export type SurferSemanticFieldName = (typeof SURFER_SEMANTIC_FIELDS)[number];
export type SurferSemanticValue = string | number | boolean;
export type SurferSemanticField =
  | {
      name: SurferSemanticFieldName;
      state: 'RESOLVED';
      value: SurferSemanticValue;
      anchorRefs: SurferAnchorRef[];
    }
  | {
      name: SurferSemanticFieldName;
      state: 'MISSING' | 'UNMODELED';
      reason: string;
      anchorRefs: SurferAnchorRef[];
    }
  | {
      name: SurferSemanticFieldName;
      state: 'AMBIGUOUS';
      candidates: { value: SurferSemanticValue; anchorRefs: SurferAnchorRef[] }[];
    };
export type SurferSemanticFrameProposal = {
  schemaVersion: '1.0.0';
  frameId: string;
  viewDigest: string;
  anchorRefs: SurferAnchorRef[];
  fields: SurferSemanticField[];
  producer: { modelRevision: string; promptRevision: string; executionRef: string };
};
export type SurferCognitiveReadReceipt = SurferSourceBasisV2['authority'] & {
  contract: 'surfer.source-binding.v2';
  sourceSnapshotDigest: string;
  observedAt: string;
  consistency: 'SOURCE_KNOWLEDGE_AS_OF_SNAPSHOT';
};
export type SurferCognitiveView = {
  schemaVersion: '1.0.0';
  basis: SurferSourceBasisV2;
  anchors: SurferObservationAnchor[];
  viewDigest: string;
  readReceipt: SurferCognitiveReadReceipt;
};
/** Trusted backend Source capability. The callback must be synchronous, bounded, no provider/tool dispatch. */
export interface SurferCognitiveSourcePort {
  observe(sourceRequest: unknown, selectionInput: unknown): Promise<SurferCognitiveView>;
  withCurrent<T>(
    sourceRequest: unknown,
    basis: SurferSourceBasisV2,
    selections: SurferObservationSelection[],
    apply: (view: SurferCognitiveView) => T,
  ): Promise<T>;
}
export type SurferCognitiveIntent = 'SOURCE_QUOTE' | 'INTERPRET' | 'RULE_QUERY';
export type SurferCognitiveRouteRequest = {
  schemaVersion: '1.0.0';
  operationId: string;
  intent: SurferCognitiveIntent;
  basis: SurferSourceBasisV2;
  selections: SurferObservationSelection[];
  frame: SurferSemanticFrameProposal | null;
};
export type SurferCognitiveValidation = {
  level: 'NOT_EVALUATED' | 'ISOLATED_FIXTURE' | 'DOMAIN_VALIDATED';
  viewDigest: string;
  frameDigest: string;
  checkedFields: SurferSemanticFieldName[];
  validatorRevision: string;
  rule: {
    status: 'NO_RULE' | 'APPLICABLE' | 'OUT_OF_SCOPE' | 'CONFLICT' | 'UNSUPPORTED';
    ref: SurferArtifactRef | null;
    validationRef: string | null;
    impact: 'LOW' | 'HIGH';
  };
};
/** Model/browser JSON never supplies this receipt. Port owners must check semantic validity AND rule eligibility. */
export interface SurferCognitiveValidationPort {
  inspect(
    view: SurferCognitiveView,
    frame: SurferSemanticFrameProposal,
    intent: SurferCognitiveIntent,
  ): SurferCognitiveValidation;
}
export type SurferPlanningBudget = {
  status: 'AVAILABLE' | 'UNAVAILABLE';
  generation: string | null;
  allowedSpaceIds: string[];
  limits: SurferUsage;
  accounted: SurferUsage;
  active: number;
  maxConcurrent: number;
  deadlineAtMs: number;
};
export interface SurferPlanningBudgetPort {
  read(): Promise<SurferPlanningBudget>;
}
export type SurferCognitivePath =
  | 'BLOCKED_ACCESS_OR_REVOKED'
  | 'SOURCE_OR_CURRENTNESS_UNAVAILABLE'
  | 'YIELDED_OR_CANCELLED'
  | 'DIRECT_SOURCE'
  | 'VALIDATED_RULE_APPLY'
  | 'DEEP_INTERPRETATION'
  | 'ACTIVE_INQUIRY'
  | 'UNMODELED_OR_PARTIAL';
export type SurferCognitiveRoutingPolicy = {
  revision: string;
  mode: 'PRODUCT' | 'ISOLATED_CONTRACT';
  audit: {
    generation: string;
    seed: string;
    rateBasisPoints: number;
    timing: 'BEFORE_RESPONSE' | 'BACKGROUND';
    namespace: string;
    heldoutNamespace: string;
  };
  localMaximum: SurferUsage;
  deepMaximum: SurferUsage;
};
export type SurferCognitiveDecision = {
  schemaVersion: '1.0.0';
  decisionId: string;
  operationId: string;
  path: SurferCognitivePath;
  reasons: string[];
  policyRevision: string;
  mode: SurferCognitiveRoutingPolicy['mode'];
  viewDigest: string | null;
  frameDigest: string | null;
  sourceReceipt: SurferCognitiveReadReceipt | null;
  budgetGeneration: string | null;
  minimum: {
    missing: SurferSemanticFieldName[];
    ambiguous: SurferSemanticFieldName[];
    unmodeled: SurferSemanticFieldName[];
  };
  validationLevel: SurferCognitiveValidation['level'];
  ruleRef: SurferArtifactRef | null;
  audit: {
    selected: boolean;
    mandatory: boolean;
    generation: string;
    seedDigest: string;
    namespace: string;
    timing: 'BEFORE_RESPONSE' | 'BACKGROUND';
    status: 'NOT_SELECTED' | 'PENDING_INDEPENDENT_CHECK';
  };
  conclusionMode: 'SOURCE_QUOTE_ONLY' | 'RULE_DERIVATION_WITH_VALIDATION' | 'UNRESOLVED';
  inquiry: 'NONE' | 'INTERNAL_SEARCH_THEN_COMPUTE_THEN_NECESSARY_USER_QUESTION';
  learningScheduled: false;
  executionAuthority: 'PLAN_ONLY_NO_DISPATCH_PERMISSION';
};

const text = { type: 'string', minLength: 1, maxLength: 256 };
const unit = { type: 'string', minLength: 1, maxLength: 64 };
const nullable = (schema: object) => ({ anyOf: [schema, { type: 'null' }] });
const hash = { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' };
const integer = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});
const list = (items: object, minItems = 0) => ({
  type: 'array',
  items,
  minItems,
  maxItems: 64,
  uniqueItems: true,
});
const anchorRef = object({
  anchorId: text,
  revision: { type: 'integer', minimum: 1 },
  digest: hash,
});
const scalar = {
  anyOf: [
    { type: 'string', maxLength: 2048 },
    { type: 'number', minimum: -1e12, maximum: 1e12 },
    { type: 'boolean' },
  ],
};
const selection = object({
  sourceId: text,
  evidenceId: text,
  start: integer,
  end: integer,
  targetUnit: nullable(unit),
});
const field = {
  anyOf: [
    object({
      name: { enum: SURFER_SEMANTIC_FIELDS },
      state: { const: 'RESOLVED' },
      value: scalar,
      anchorRefs: list(anchorRef, 1),
    }),
    object({
      name: { enum: SURFER_SEMANTIC_FIELDS },
      state: { enum: ['MISSING', 'UNMODELED'] },
      reason: text,
      anchorRefs: list(anchorRef),
    }),
    object({
      name: { enum: SURFER_SEMANTIC_FIELDS },
      state: { const: 'AMBIGUOUS' },
      candidates: {
        type: 'array',
        minItems: 2,
        maxItems: 16,
        uniqueItems: true,
        items: object({ value: scalar, anchorRefs: list(anchorRef, 1) }),
      },
    }),
  ],
};
const frame = object({
  schemaVersion: { const: '1.0.0' },
  frameId: text,
  viewDigest: hash,
  anchorRefs: list(anchorRef, 1),
  fields: list(field),
  producer: object({ modelRevision: text, promptRevision: text, executionRef: text }),
});
const position = object({
  type: { const: 'TextPositionSelector' },
  start: integer,
  end: integer,
  unit: { const: 'unicode-code-point' },
});
const selector = {
  oneOf: [
    object({ type: { const: 'PageSelector' }, page: { type: 'integer', minimum: 1 } }),
    object(
      {
        type: { const: 'BoundingBoxSelector' },
        page: { type: 'integer', minimum: 1 },
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number', minimum: 0 },
        height: { type: 'number', minimum: 0 },
        unit: { enum: ['pt', 'px'] },
      },
      ['type', 'x', 'y', 'width', 'height', 'unit'],
    ),
    object({
      type: { const: 'CellSelector' },
      sheet: text,
      cell: text,
      row: { type: 'integer', minimum: 1 },
      column: { type: 'integer', minimum: 1 },
    }),
    object({
      type: { const: 'ShapeSelector' },
      slide: { type: 'integer', minimum: 1 },
      shapeId: text,
    }),
    object({ type: { enum: ['CssSelector', 'MarkdownHeadingContext'] }, value: text }),
  ],
};
const decimal = { type: 'string', pattern: '^-?(0|[1-9][0-9]*)(\\.[0-9]+)?$', maxLength: 80 };
const observed = {
  anyOf: [
    object({
      kind: { const: 'NUMBER' },
      decimal,
      unit: nullable(unit),
      precision: object({
        digits: { type: 'integer', minimum: 1, maximum: 38 },
        scale: { type: 'integer', minimum: 0, maximum: 18 },
        notation: { const: 'PLAIN_DECIMAL' },
        interpretation: { const: 'LEXICAL_ONLY' },
      }),
    }),
    object({ kind: { const: 'BOOLEAN' }, value: { type: 'boolean' } }),
    object({
      kind: { const: 'DATE' },
      value: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    }),
    object({ kind: { const: 'TEXT' }, value: { type: 'string', maxLength: 2048 } }),
    object({ kind: { const: 'UNMODELED' }, reason: text }),
  ],
};
const normalization = object({
  state: { enum: ['NOT_REQUIRED', 'RESOLVED', 'UNRESOLVED'] },
  targetUnit: nullable(unit),
  normalizedValue: nullable(decimal),
  normalizedUnit: nullable(unit),
  conversion: nullable(
    object({
      revision: text,
      numerator: { type: 'string', pattern: '^[0-9]+$', maxLength: 64 },
      denominator: { type: 'string', pattern: '^[1-9][0-9]*$', maxLength: 64 },
      rounding: { const: 'EXACT' },
    }),
  ),
  reason: nullable(text),
});
const scope = object({
  spaceId: text,
  accessScope: list(text, 1),
  sensitivity: { enum: ['public', 'internal', 'private', 'restricted'] },
});
const source = object({
  originalAssetId: text,
  sourceId: text,
  sourceVersionId: text,
  revisionId: text,
  indexingResultId: text,
  sourceContentHash: hash,
  documentHash: hash,
  sourceMapHash: hash,
  materialProof: hash,
  evidenceId: text,
  evidenceDigest: hash,
  pointer: { type: 'string', maxLength: 2048 },
  sourceBindingContentDigest: hash,
});
const anchor = object({
  schemaVersion: { const: '1.0.0' },
  anchorId: text,
  revision: { const: 1 },
  scope,
  source,
  position,
  selectors: list(selector),
  rawLiteral: { type: 'string', minLength: 1, maxLength: 2048 },
  observed,
  normalization,
  producer: object({ parserRevision: text, executionRef: text }),
  contentRole: { const: 'UNTRUSTED_SOURCE_DATA' },
  groundingAssessment: { const: 'SOURCE_BOUND_LITERAL' },
  semanticAssessment: { const: 'NOT_EVALUATED' },
  digest: hash,
});
const registry = new SchemaRegistry();
for (const [name, inputSchema] of Object.entries({
  'observation-selection': object({
    schemaVersion: { const: '1.0.0' },
    selections: list(selection, 1),
  }),
  'observation-anchor': anchor,
  'semantic-frame-proposal': frame,
  'cognitive-validation': object({
    level: { enum: ['NOT_EVALUATED', 'ISOLATED_FIXTURE', 'DOMAIN_VALIDATED'] },
    viewDigest: hash,
    frameDigest: hash,
    checkedFields: list({ enum: SURFER_SEMANTIC_FIELDS }),
    validatorRevision: text,
    rule: object({
      status: { enum: ['NO_RULE', 'APPLICABLE', 'OUT_OF_SCOPE', 'CONFLICT', 'UNSUPPORTED'] },
      ref: nullable(
        object({ artifactId: text, revision: { ...integer, minimum: 1 }, digest: hash }),
      ),
      validationRef: nullable(text),
      impact: { enum: ['LOW', 'HIGH'] },
    }),
  }),
  'observed-literal': observed,
  'literal-normalization': normalization,
  'cognitive-route-request': object({
    schemaVersion: { const: '1.0.0' },
    operationId: text,
    intent: { enum: ['SOURCE_QUOTE', 'INTERPRET', 'RULE_QUERY'] },
    basis: { type: 'object' },
    selections: list(selection, 1),
    frame: nullable(frame),
  }),
}))
  registry.register({ name: 'surfer.' + name, version: '1.0.0', kind: 'command', inputSchema });
function decode<T>(name: string, value: unknown): T {
  assertSurferJson(value);
  registry.validateInput('surfer.' + name, '1.0.0', value);
  return structuredClone(value) as T;
}
export function decodeSurferObservationSelections(input: unknown): {
  schemaVersion: '1.0.0';
  selections: SurferObservationSelection[];
} {
  const r = decode<{ schemaVersion: '1.0.0'; selections: SurferObservationSelection[] }>(
    'observation-selection',
    input,
  );
  for (const s of r.selections)
    if (s.end <= s.start || s.end - s.start > 2048)
      throw surferFailure('Observation selection must be a non-empty bounded Unicode interval.');
  return r;
}
export function decodeSurferObservationAnchor(input: unknown): SurferObservationAnchor {
  const a = decode<SurferObservationAnchor>('observation-anchor', input),
    { digest, ...content } = a;
  if (
    surferDigest(content) !== digest ||
    a.position.end - a.position.start !== Array.from(a.rawLiteral).length
  )
    throw surferFailure('Observation anchor digest/position mismatch.');
  decodeSurferLiteralNormalization(a.normalization);
  return a;
}
export const decodeSurferSemanticFrameProposal = (input: unknown): SurferSemanticFrameProposal =>
  decode('semantic-frame-proposal', input);
export const decodeSurferObservedLiteral = (input: unknown): SurferObservedLiteral =>
  decode('observed-literal', input);
export function decodeSurferLiteralNormalization(input: unknown): SurferLiteralNormalization {
  const n = decode<SurferLiteralNormalization>('literal-normalization', input);
  if (
    n.state === 'NOT_REQUIRED' &&
    (n.targetUnit !== null ||
      n.normalizedValue !== null ||
      n.normalizedUnit !== null ||
      n.conversion !== null ||
      n.reason !== null)
  )
    throw surferFailure('Normalization NOT_REQUIRED cannot invent a conversion.');
  if (
    n.state === 'RESOLVED' &&
    (n.targetUnit === null ||
      n.normalizedUnit !== n.targetUnit ||
      n.normalizedValue === null ||
      n.conversion === null ||
      n.reason !== null)
  )
    throw surferFailure('Resolved normalization needs exact value/unit and conversion evidence.');
  if (
    n.state === 'UNRESOLVED' &&
    (n.targetUnit === null ||
      n.normalizedValue !== null ||
      n.normalizedUnit !== null ||
      n.reason === null)
  )
    throw surferFailure('Unresolved normalization cannot emit a guessed normalized value.');
  return n;
}
export function decodeSurferCognitiveRouteRequest(input: unknown): SurferCognitiveRouteRequest {
  const r = decode<SurferCognitiveRouteRequest>('cognitive-route-request', input);
  assertSurferSourceBasisV2(r.basis);
  decodeSurferObservationSelections({ schemaVersion: r.schemaVersion, selections: r.selections });
  return r;
}

export const cognitiveFailure = (message: string) =>
  new ShotgunError({
    code: 'VALIDATION_ERROR',
    safeMessage: message,
    module: 'surfer.cognition',
    operation: 'validate-grounding',
  });
export function validateSurferFrameGrounding(
  input: unknown,
  anchors: SurferObservationAnchor[],
  viewDigest: string,
) {
  const frame = decodeSurferSemanticFrameProposal(input),
    refs = anchors.map((a) => ({ anchorId: a.anchorId, revision: a.revision, digest: a.digest })),
    allowed = new Set(refs.map(surferDigest));
  if (
    frame.viewDigest !== viewDigest ||
    surferDigest([...frame.anchorRefs].sort((a, b) => a.anchorId.localeCompare(b.anchorId))) !==
      surferDigest([...refs].sort((a, b) => a.anchorId.localeCompare(b.anchorId)))
  )
    throw cognitiveFailure('Frame must bind every current observation anchor/view.');
  if (new Set(frame.fields.map((f) => f.name)).size !== frame.fields.length)
    throw cognitiveFailure('Duplicate semantic field.');
  for (const f of frame.fields) {
    const used = f.state === 'AMBIGUOUS' ? f.candidates.flatMap((c) => c.anchorRefs) : f.anchorRefs;
    if (used.some((r) => !allowed.has(surferDigest(r))))
      throw cognitiveFailure('Semantic field points outside the current anchors.');
    if (f.state === 'AMBIGUOUS' && new Set(f.candidates.map((c) => surferDigest(c.value))).size < 2)
      throw cognitiveFailure('Ambiguity requires distinct candidate meanings.');
  }
  return frame; // Grounding only; no promotion of proposed meaning to a validated Fact.
}

export const decodeSurferCognitiveValidation = (input: unknown): SurferCognitiveValidation =>
  decode('cognitive-validation', input);

/** Detached response shape only; producer/current Source identity is supplied by the execution owner. */
export function surferSemanticResponseSchema(): Record<string, unknown> {
  return structuredClone(
    object({
      fields: {
        ...(frame.properties.fields as Record<string, unknown>),
        minItems: 10,
        maxItems: 10,
      },
    }),
  );
}
