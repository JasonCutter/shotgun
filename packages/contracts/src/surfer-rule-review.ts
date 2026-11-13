import { SchemaRegistry } from './schema-registry.js';
import { assertSurferJson, surferFailure, type SurferObservation } from './surfer-learning.js';
import type { SurferSourceBasisV2 } from './surfer-source-binding-v2.js';
import type { SurferObservationSelection } from './surfer-cognition.js';
export type SurferRuleUseState = 'ACTIVE' | 'QUARANTINED' | 'RETRACTED';
export type SurferRuleReviewAction = 'ASSESS' | 'RETRACT';
export type SurferRuleObservation = {
  schemaVersion: '1.0.0';
  contract: 'surfer.rule-observation.v1';
  datasetId: string;
  domain: string;
  eventId: string;
  eventGroup: string;
  features: Record<string, SurferObservation>;
  observedOutcome: boolean;
};
export type SurferRuleReviewEntry = {
  basis: SurferSourceBasisV2;
  selections: SurferObservationSelection[];
  observation: SurferRuleObservation;
  observationDigest: string;
  action: SurferRuleReviewAction;
};
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});
const text = { type: 'string', minLength: 1, maxLength: 256 };
const registry = new SchemaRegistry();
registry.register({
  name: 'surfer.rule-observation',
  version: '1.0.0',
  kind: 'event',
  inputSchema: object({
    schemaVersion: { const: '1.0.0' },
    contract: { const: 'surfer.rule-observation.v1' },
    datasetId: text,
    domain: text,
    eventId: text,
    eventGroup: text,
    features: {
      type: 'object',
      minProperties: 1,
      maxProperties: 8,
      propertyNames: {
        pattern: '^[A-Za-z][A-Za-z0-9_]{0,63}$',
        not: { enum: ['constructor', 'prototype'] },
      },
      additionalProperties: object(
        {
          value: {
            anyOf: [
              { type: 'number' },
              { type: 'boolean' },
              { type: 'string', maxLength: 2048 },
              { type: 'null' },
            ],
          },
          unit: { type: 'string', minLength: 1, maxLength: 64 },
        },
        ['value'],
      ),
    },
    observedOutcome: { type: 'boolean' },
  }),
});
export function decodeSurferRuleObservation(input: unknown): SurferRuleObservation {
  assertSurferJson(input);
  registry.validateInput('surfer.rule-observation', '1.0.0', input);
  const value = structuredClone(input) as SurferRuleObservation;
  if (
    Object.values(value.features).some((v) => v.unit !== undefined && typeof v.value !== 'number')
  )
    throw surferFailure('Typed observation units require numeric values.');
  return value;
}
