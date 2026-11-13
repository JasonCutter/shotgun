import { ShotgunError } from './errors.js';
import { SchemaRegistry } from './schema-registry.js';
import { semanticStableJson } from './semantic-representation.js';
import { sha256Text } from './document-evidence.js';

export const SURFER_CONTRACT_VERSION = '1.0.0' as const;
export type SurferScalar = number | string | boolean;
export type SurferObservation = { readonly value: SurferScalar | null; readonly unit?: string };
export type SurferExpression =
  | { readonly op: 'literal'; readonly value: SurferScalar; readonly unit?: string }
  | { readonly op: 'field'; readonly name: string }
  | { readonly op: 'all' | 'any'; readonly args: readonly SurferExpression[] }
  | { readonly op: 'not'; readonly arg: SurferExpression }
  | {
      readonly op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'add' | 'sub' | 'mul' | 'div';
      readonly left: SurferExpression;
      readonly right: SurferExpression;
    };
export type SurferScope = {
  readonly spaceId: string;
  readonly accessScope: readonly string[];
  readonly sensitivity: 'public' | 'internal' | 'private' | 'restricted';
};
export type SurferWitness = {
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly evidenceId: string;
  readonly materialDigest: string;
};
export type SurferLearningCase = {
  readonly schemaVersion: typeof SURFER_CONTRACT_VERSION;
  readonly caseId: string;
  readonly eventGroup: string;
  readonly domain: string;
  readonly scope: SurferScope;
  readonly features: Readonly<Record<string, SurferObservation>>;
  readonly observedOutcome: boolean;
  readonly witnesses: readonly SurferWitness[];
};
export type SurferRuleCandidate = {
  readonly schemaVersion: typeof SURFER_CONTRACT_VERSION;
  readonly candidateId: string;
  readonly domain: string;
  readonly scope: SurferScope;
  readonly origin: 'INDUCTION';
  readonly description: string;
  readonly conclusionKey: string;
  readonly expression: SurferExpression;
  readonly developmentCaseIds: readonly string[];
  readonly assumptions: readonly string[];
  readonly proposer: {
    readonly provider: string;
    readonly model: string;
    readonly executionId: string;
  };
};

const id = { type: 'string', minLength: 1, maxLength: 256 };
const unit = { type: 'string', minLength: 1, maxLength: 64 };
const scalar = {
  anyOf: [{ type: 'number' }, { type: 'boolean' }, { type: 'string', maxLength: 2048 }],
};
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});
const scopeSchema = object({
  spaceId: id,
  accessScope: { type: 'array', items: id, minItems: 1, maxItems: 64, uniqueItems: true },
  sensitivity: { enum: ['public', 'internal', 'private', 'restricted'] },
});
const expressionRef = { $ref: '#/definitions/expression' };
const expressionSchema = {
  anyOf: [
    object({ op: { const: 'literal' }, value: scalar, unit }, ['op', 'value']),
    object({ op: { const: 'field' }, name: { ...id, pattern: '^[A-Za-z][A-Za-z0-9_]{0,63}$' } }),
    object({
      op: { enum: ['all', 'any'] },
      args: { type: 'array', items: expressionRef, minItems: 1, maxItems: 64 },
    }),
    object({ op: { const: 'not' }, arg: expressionRef }),
    object({
      op: { enum: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'add', 'sub', 'mul', 'div'] },
      left: expressionRef,
      right: expressionRef,
    }),
  ],
};
/** A detached generation schema from the same grammar used by the canonical decoder.
 * Optional feature narrowing is proposal-local and never changes the registered contract. */
export function surferExpressionJsonSchema(featureNames?: readonly string[]) {
  const expression = structuredClone(expressionSchema);
  if (featureNames !== undefined) {
    if (
      !Array.isArray(featureNames) ||
      featureNames.length < 1 ||
      featureNames.length > 128 ||
      new Set(featureNames).size !== featureNames.length ||
      featureNames.some(
        (name) =>
          typeof name !== 'string' ||
          !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) ||
          ['constructor', 'prototype'].includes(name),
      )
    )
      throw surferFailure('Invalid expression generation feature catalog.');
    expression.anyOf[1]!.properties.name = {
      ...id,
      pattern: '^[A-Za-z][A-Za-z0-9_]{0,63}$',
      enum: [...featureNames],
    };
  }
  return { ...expressionRef, definitions: { expression } };
}
const observationSchema = object(
  {
    value: { anyOf: [...scalar.anyOf, { type: 'null' }] },
    unit,
  },
  ['value'],
);
const registry = new SchemaRegistry();
registry.register({
  name: 'surfer.expression',
  version: SURFER_CONTRACT_VERSION,
  kind: 'query',
  inputSchema: { ...expressionRef, definitions: { expression: expressionSchema } },
});
registry.register({
  name: 'surfer.learning-case',
  version: SURFER_CONTRACT_VERSION,
  kind: 'event',
  inputSchema: object({
    schemaVersion: { const: SURFER_CONTRACT_VERSION },
    caseId: id,
    eventGroup: id,
    domain: id,
    scope: scopeSchema,
    features: {
      type: 'object',
      minProperties: 1,
      maxProperties: 128,
      propertyNames: {
        pattern: '^[A-Za-z][A-Za-z0-9_]{0,63}$',
        not: { enum: ['constructor', 'prototype'] },
      },
      additionalProperties: observationSchema,
    },
    observedOutcome: { type: 'boolean' },
    witnesses: {
      type: 'array',
      minItems: 1,
      maxItems: 128,
      items: object({
        sourceId: id,
        sourceVersionId: id,
        evidenceId: id,
        materialDigest: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
      }),
    },
  }),
});
registry.register({
  name: 'surfer.rule-candidate',
  version: SURFER_CONTRACT_VERSION,
  kind: 'command',
  inputSchema: {
    ...object({
      schemaVersion: { const: SURFER_CONTRACT_VERSION },
      candidateId: id,
      domain: id,
      scope: scopeSchema,
      origin: { const: 'INDUCTION' },
      description: { type: 'string', minLength: 1, maxLength: 8192 },
      conclusionKey: id,
      expression: expressionRef,
      developmentCaseIds: {
        type: 'array',
        minItems: 1,
        maxItems: 4096,
        uniqueItems: true,
        items: id,
      },
      assumptions: { type: 'array', maxItems: 64, items: { type: 'string', maxLength: 2048 } },
      proposer: object({ provider: id, model: id, executionId: id }),
    }),
    definitions: { expression: expressionSchema },
  },
});

export const surferFailure = (message: string, operation = 'validate-contract'): ShotgunError =>
  new ShotgunError({ code: 'VALIDATION_ERROR', safeMessage: message, module: 'surfer', operation });

/** Bound before recursive AJV validation/hash; reject getters, cycles and non-JSON values. */
export function assertSurferJson(value: unknown): void {
  const active = new WeakSet<object>();
  let entries = 0;
  let characters = 0;
  const visit = (v: unknown, depth: number): void => {
    if (++entries > 50_000 || depth > 32)
      throw surferFailure('Surfer payload exceeds its structural budget.');
    if (v === null || typeof v === 'boolean') return;
    if (typeof v === 'number' && Number.isFinite(v)) return;
    if (typeof v === 'string') {
      characters += v.length;
      if (characters > 2_000_000) throw surferFailure('Surfer payload exceeds its text budget.');
      return;
    }
    if (typeof v !== 'object' || active.has(v))
      throw surferFailure('Surfer payload must be finite acyclic JSON.');
    if (!Array.isArray(v) && ![null, Object.prototype].includes(Object.getPrototypeOf(v))) {
      throw surferFailure('Surfer payload must use plain JSON objects.');
    }
    active.add(v);
    if (
      Array.isArray(v) &&
      (Object.keys(v).length !== v.length ||
        Object.keys(v).some((key) => !/^(0|[1-9][0-9]*)$/.test(key)))
    ) {
      throw surferFailure('Surfer payload arrays must be dense JSON arrays.');
    }
    for (const key of Reflect.ownKeys(v)) {
      if (Array.isArray(v) && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(v, key);
      if (
        typeof key !== 'string' ||
        !descriptor ||
        !('value' in descriptor) ||
        !descriptor.enumerable
      ) {
        throw surferFailure('Surfer payload must not contain accessors or hidden fields.');
      }
      characters += key.length;
      if (characters > 2_000_000) throw surferFailure('Surfer payload exceeds its text budget.');
      visit(descriptor.value, depth + 1);
    }
    active.delete(v);
  };
  visit(value, 0);
}

function decode<T>(name: string, value: unknown): T {
  assertSurferJson(value);
  registry.validateInput(name, SURFER_CONTRACT_VERSION, value);
  return JSON.parse(JSON.stringify(value)) as T;
}
export const decodeSurferExpression = (value: unknown): SurferExpression =>
  decode('surfer.expression', value);
export const decodeSurferLearningCase = (value: unknown): SurferLearningCase =>
  decode('surfer.learning-case', value);
export const decodeSurferRuleCandidate = (value: unknown): SurferRuleCandidate =>
  decode('surfer.rule-candidate', value);
export function surferDigest(value: unknown): string {
  assertSurferJson(value);
  return sha256Text(semanticStableJson(value));
}
