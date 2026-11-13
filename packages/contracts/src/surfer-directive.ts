import { SchemaRegistry } from './schema-registry.js';
import { assertSurferJson } from './surfer-learning.js';
import {
  surferClauseResponseSchema,
  type SurferClauseWire,
  type SurferClauseExtraction,
} from './surfer-clause.js';
import type { SurferStructureMention } from './surfer-structure.js';
export const SURFER_ACTION_MODES = ['REQUIRED', 'PROHIBITED', 'ASSERTED', 'DENIED'] as const;
export type SurferActionMode = (typeof SURFER_ACTION_MODES)[number];
export type SurferStateTruth = 'TRUE' | 'FALSE';
type OldResolved = Extract<SurferClauseWire['interpretation'], { state: 'RESOLVED' }>;
type NumberTerm = Extract<
  NonNullable<OldResolved['conditions']>['terms'][number],
  { type: 'NUMBER' }
>;
type StateClause = { subject: string; quote: string; truth: SurferStateTruth };
export type SurferDirectiveWire = {
  interpretation:
    | Exclude<SurferClauseWire['interpretation'], { state: 'RESOLVED' }>
    | (Omit<OldResolved, 'action' | 'conditions' | 'exception'> & {
        action: { subject: string; quote: string; operationQuote: string; mode: SurferActionMode };
        conditions: {
          join: 'ALL' | 'ANY';
          terms: (({ type: 'BOOLEAN' } & StateClause) | NumberTerm)[];
        } | null;
        exception: { when: StateClause } | null;
      });
};
export type SurferDirectiveExtraction = {
  schemaVersion: '1.0.0';
  contract: 'surfer.directive-meaning.v1';
  clauses: SurferClauseExtraction;
  meaning: {
    action: { mode: SurferActionMode; operationQuote: string; operation: SurferStructureMention };
    exceptionTruth: SurferStateTruth | null;
  } | null;
};
const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});
const alias = { type: 'string', pattern: '^M[0-9]{1,2}$' },
  quote = { type: 'string', minLength: 2, maxLength: 256 };
const state = { subject: alias, quote, truth: { enum: ['TRUE', 'FALSE'] } };
// Clone the existing closed grammar; no change to the old wire or its compiled validator.
const schema = surferClauseResponseSchema();
const resolved = (
  (schema.properties as Record<string, unknown>).interpretation as {
    anyOf: Record<string, unknown>[];
  }
).anyOf[1]!.properties as Record<string, unknown>;
resolved.action = object({
  subject: alias,
  quote,
  operationQuote: { type: 'string', minLength: 1, maxLength: 128 },
  mode: { enum: [...SURFER_ACTION_MODES] },
});
const oldConditions = (
  resolved.conditions as { anyOf: { properties: { terms: { items: { anyOf: unknown[] } } } }[] }
).anyOf[0]!;
const numberTerm = structuredClone(oldConditions.properties.terms.items.anyOf[1]);
resolved.conditions = {
  anyOf: [
    object({
      join: { enum: ['ALL', 'ANY'] },
      terms: {
        type: 'array',
        minItems: 1,
        maxItems: 2,
        items: { anyOf: [object({ type: { const: 'BOOLEAN' }, ...state }), numberTerm] },
      },
    }),
    { type: 'null' },
  ],
};
resolved.exception = { anyOf: [object({ when: object(state) }), { type: 'null' }] };
const registry = new SchemaRegistry();
registry.register({
  name: 'surfer.directive-wire',
  version: '1.0.0',
  kind: 'command',
  inputSchema: schema,
});
export const surferDirectiveResponseSchema = (): Record<string, unknown> => structuredClone(schema);
export function decodeSurferDirectiveWire(input: unknown): SurferDirectiveWire {
  assertSurferJson(input);
  registry.validateInput('surfer.directive-wire', '1.0.0', input);
  return structuredClone(input) as SurferDirectiveWire;
}
