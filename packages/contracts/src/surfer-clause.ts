import { SchemaRegistry } from './schema-registry.js';
import { assertSurferJson } from './surfer-learning.js';
import type { SurferSemanticFrameProposal } from './surfer-cognition.js';
import type { SurferStructureMention, SurferStructureProposal } from './surfer-structure.js';

export type SurferClauseWire = {
  interpretation:
    | { state: 'MISSING' | 'UNMODELED'; reason: string }
    | {
        state: 'RESOLVED';
        action: { subject: string; quote: string; value: boolean };
        conditions: {
          join: 'ALL' | 'ANY';
          terms: (
            | { type: 'BOOLEAN'; subject: string; quote: string; value: boolean }
            | {
                type: 'NUMBER';
                subject: string;
                quote: string;
                comparison: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte';
                mention: string;
              }
          )[];
        } | null;
        direction: 'IF' | 'ONLY_IF' | 'IFF' | 'UNCONDITIONAL';
        quantifier: { kind: 'ALL' | 'SOME' | 'NONE'; domain: string } | null;
        exception: { subject: string; quote: string; value: boolean } | null;
        subjectScope: string[];
        time: {
          from: string | null;
          to: string | null;
          fromInclusive: boolean;
          toInclusive: boolean;
        } | null;
        documentRole: 'NORMATIVE' | 'OBSERVATION' | 'DEFINITION' | 'EXAMPLE';
      };
};
export type SurferClauseBinding = {
  predicateId: string;
  role: 'ACTION' | 'CONDITION' | 'EXCEPTION';
  mention: SurferStructureMention;
  quote: string;
};
/** A Source-clause binding is provenance for a proposed meaning, never a Fact or cross-source concept ID. */
export type SurferClauseExtraction = {
  schemaVersion: '1.0.0';
  contract: 'surfer.source-clauses.v1';
  frame: SurferSemanticFrameProposal;
  proposal: SurferStructureProposal;
  bindings: SurferClauseBinding[];
};
const obj = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});
const alias = { type: 'string', pattern: '^M[0-9]{1,2}$' },
  quote = { type: 'string', minLength: 2, maxLength: 256 },
  bool = { type: 'boolean' };
const action = obj({ subject: alias, quote, value: bool });
const nullable = (schema: unknown) => ({ anyOf: [schema, { type: 'null' }] });
const wireSchema = obj({
  interpretation: {
    anyOf: [
      obj({
        state: { enum: ['MISSING', 'UNMODELED'] },
        reason: { type: 'string', minLength: 1, maxLength: 256 },
      }),
      obj({
        state: { const: 'RESOLVED' },
        action,
        conditions: nullable(
          obj({
            join: { enum: ['ALL', 'ANY'] },
            terms: {
              type: 'array',
              minItems: 1,
              maxItems: 2,
              items: {
                anyOf: [
                  obj({ type: { const: 'BOOLEAN' }, subject: alias, quote, value: bool }),
                  obj({
                    type: { const: 'NUMBER' },
                    subject: alias,
                    quote,
                    comparison: { enum: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'] },
                    mention: alias,
                  }),
                ],
              },
            },
          }),
        ),
        direction: { enum: ['IF', 'ONLY_IF', 'IFF', 'UNCONDITIONAL'] },
        quantifier: nullable(obj({ kind: { enum: ['ALL', 'SOME', 'NONE'] }, domain: alias })),
        exception: nullable(action),
        subjectScope: { type: 'array', minItems: 1, maxItems: 1, uniqueItems: true, items: alias },
        time: nullable(
          obj({
            from: nullable(alias),
            to: nullable(alias),
            fromInclusive: bool,
            toInclusive: bool,
          }),
        ),
        documentRole: { enum: ['NORMATIVE', 'OBSERVATION', 'DEFINITION', 'EXAMPLE'] },
      }),
    ],
  },
});
const registry = new SchemaRegistry();
registry.register({
  name: 'surfer.clause-wire',
  version: '1.0.0',
  kind: 'command',
  inputSchema: wireSchema,
});
export function surferClauseResponseSchema(): Record<string, unknown> {
  return structuredClone(wireSchema);
}
export function decodeSurferClauseWire(input: unknown): SurferClauseWire {
  assertSurferJson(input);
  registry.validateInput('surfer.clause-wire', '1.0.0', input);
  return structuredClone(input) as SurferClauseWire;
}
