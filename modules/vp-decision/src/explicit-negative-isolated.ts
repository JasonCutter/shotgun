import { assertJsonSchema } from '../../../packages/contracts/src/index.js';
import { VP_RELATION_CHOICES, VP_RELATION_DIRECTIONS } from './index.js';

/** Opt-in isolated contract. The production v6 choice set and policy are unchanged. */
export const EXPLICIT_NEGATIVE_ISOLATED_REVISION = 'vp-relation-v6-explicit-negative-isolated-v1';
export const EXPLICIT_NEGATIVE_CHOICES = [...VP_RELATION_CHOICES, 'NO_RELATION'] as const;
export type ExplicitNegativeChoice = (typeof EXPLICIT_NEGATIVE_CHOICES)[number];
export type ExplicitNegativeDeclaration = {
  readonly choice: ExplicitNegativeChoice;
  readonly direction: (typeof VP_RELATION_DIRECTIONS)[number];
  readonly confidence: number;
  readonly probabilities: Readonly<Record<ExplicitNegativeChoice, number>>;
};

export const EXPLICIT_NEGATIVE_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['choice', 'direction', 'confidence', 'probabilities'],
  properties: {
    choice: { type: 'string', enum: [...EXPLICIT_NEGATIVE_CHOICES] },
    direction: { type: 'string', enum: [...VP_RELATION_DIRECTIONS] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    probabilities: {
      type: 'object',
      additionalProperties: false,
      required: [...EXPLICIT_NEGATIVE_CHOICES],
      properties: Object.fromEntries(
        EXPLICIT_NEGATIVE_CHOICES.map((choice) => [
          choice,
          { type: 'number', minimum: 0, maximum: 1 },
        ]),
      ),
    },
  },
};

export const parseExplicitNegativeDeclaration = (value: unknown): ExplicitNegativeDeclaration => {
  assertJsonSchema(
    EXPLICIT_NEGATIVE_RESPONSE_SCHEMA,
    value,
    'isolated explicit-negative declaration',
  );
  const declaration = value as ExplicitNegativeDeclaration;
  const directed = declaration.choice === 'SUPPORTS' || declaration.choice === 'QUALIFIES';
  if (directed ? declaration.direction === 'NONE' : declaration.direction !== 'NONE') {
    throw new Error('Explicit-negative direction does not match its choice.');
  }
  if (
    Math.abs(Object.values(declaration.probabilities).reduce((sum, p) => sum + p, 0) - 1) > 0.02
  ) {
    throw new Error('Explicit-negative probabilities must sum to one.');
  }
  return declaration;
};

export type ExplicitNegativeDisposition =
  | { readonly status: 'DECIDED'; readonly declaration: ExplicitNegativeDeclaration }
  | { readonly status: 'NO_RELATION'; readonly declaration: ExplicitNegativeDeclaration }
  | {
      readonly status: 'UNRESOLVED';
      readonly reason: 'MODEL_ABSTAINED';
      readonly declaration: ExplicitNegativeDeclaration;
    }
  | {
      readonly status: 'WITHHELD';
      readonly reason: 'CHOICE_PROBABILITY_BELOW_THRESHOLD' | 'USAGE_LIMIT_EXCEEDED';
      readonly declaration: ExplicitNegativeDeclaration;
    };

/** This function classifies a recorded Fake response; it grants no execution or write authority. */
export const classifyExplicitNegativeDeclaration = (
  declaration: ExplicitNegativeDeclaration,
  usage: { readonly inputTokens: number; readonly outputTokens: number },
): ExplicitNegativeDisposition => {
  parseExplicitNegativeDeclaration(declaration);
  if (![usage.inputTokens, usage.outputTokens].every((n) => Number.isSafeInteger(n) && n >= 0)) {
    throw new Error('Invalid isolated token usage.');
  }
  if (usage.inputTokens > 4_000 || usage.outputTokens > 256) {
    return { status: 'WITHHELD', reason: 'USAGE_LIMIT_EXCEEDED', declaration };
  }
  if (declaration.choice === 'UNRESOLVED') {
    return { status: 'UNRESOLVED', reason: 'MODEL_ABSTAINED', declaration };
  }
  if (declaration.probabilities[declaration.choice] < 0.9) {
    return { status: 'WITHHELD', reason: 'CHOICE_PROBABILITY_BELOW_THRESHOLD', declaration };
  }
  return { status: declaration.choice === 'NO_RELATION' ? 'NO_RELATION' : 'DECIDED', declaration };
};
