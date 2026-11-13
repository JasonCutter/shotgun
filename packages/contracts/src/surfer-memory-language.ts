import type { SurferArtifactRef } from './surfer-knowledge.js';
import type { SurferSourceBasisV2 } from './surfer-source-binding-v2.js';
import type {
  SurferObservationSelection,
  SurferSemanticFrameProposal,
} from './surfer-cognition.js';
import type { SurferDirectiveExtractionV2 } from './surfer-directive-v2.js';
import type { SurferMemoryQuestion } from './surfer-directive-memory.js';
import { SchemaRegistry } from './schema-registry.js';
import { assertSurferJson, surferDigest } from './surfer-learning.js';
export type SurferNaturalQuestionRequest = {
  schemaVersion: '1.0.0';
  requestId: string;
  snapshotId: string | null;
  question: string;
};
export type SurferMemoryLanguageCandidate = {
  candidateId: string;
  memory: SurferArtifactRef;
  subject: string;
  operation: string;
  packet: SurferDirectiveExtractionV2;
};
export type SurferMemoryLanguageContext = {
  schemaVersion: '1.0.0';
  request: SurferNaturalQuestionRequest;
  snapshot: { snapshotId: string; digest: string };
  basis: SurferSourceBasisV2;
  selections: SurferObservationSelection[];
  candidates: SurferMemoryLanguageCandidate[];
  digest: string;
};
export type SurferNaturalQuestionProposal = {
  schemaVersion: '1.0.0';
  contract: 'surfer.memory-question-proposal.v1';
  contextDigest: string;
  questionDigest: string;
  producer: SurferSemanticFrameProposal['producer'];
  interpretation:
    | {
        state: 'RESOLVED';
        candidateId: string;
        question: SurferMemoryQuestion;
        quotes: { predicateId: string; quote: string; start: number; end: number }[];
      }
    | { state: 'AMBIGUOUS' | 'UNMODELED' | 'MISSING'; reason: string };
};
export type SurferInquiryValue =
  | { type: 'BOOLEAN'; value: boolean }
  | { type: 'NUMBER'; decimal: string; unit: string | null }
  | { type: 'DATE'; value: string };
export type SurferInquiryField = {
  predicateId: string;
  type: 'BOOLEAN' | 'NUMBER' | 'DATE';
  unit: string | null;
  quote: string;
  prompt: string;
  valueSemantics: 'UNDERLYING_STATE_NOT_PREDICATE_RESULT';
};
export type SurferInquiryPayload = {
  contract: 'surfer.memory-inquiry.v1';
  requestId: string;
  questionText: string;
  proposal: SurferNaturalQuestionProposal;
  request: SurferNaturalQuestionRequest;
  snapshot: { snapshotId: string; digest: string };
  catalogDigest: string;
  catalogMemories: SurferArtifactRef[];
  question: SurferMemoryQuestion;
  memory: SurferArtifactRef;
  requested: SurferInquiryField | null;
  previous: SurferArtifactRef | null;
  turnId: string;
  answerDigest: string | null;
  result: unknown;
};
const obj = (properties: Record<string, unknown>) => ({
    type: 'object',
    additionalProperties: false,
    properties,
    required: Object.keys(properties),
  }),
  text = { type: 'string', minLength: 1, maxLength: 256 },
  nullable = (s: unknown) => ({ anyOf: [s, { type: 'null' }] });
export const surferNaturalQuestionResponseSchema = () =>
  obj({
    interpretation: {
      anyOf: [
        obj({ state: { enum: ['AMBIGUOUS', 'UNMODELED', 'MISSING'] }, reason: text }),
        obj({
          state: { const: 'RESOLVED' },
          candidate: { type: 'string', pattern: '^C[0-9]{1,2}$' },
          kind: { enum: ['RECALL', 'APPLY'] },
          observations: {
            type: 'array',
            maxItems: 8,
            items: {
              anyOf: [
                obj({
                  predicate: text,
                  type: { const: 'BOOLEAN' },
                  truth: { enum: ['TRUE', 'FALSE'] },
                  quote: text,
                }),
                obj({ predicate: text, type: { const: 'NUMBER' }, quote: text }),
              ],
            },
          },
          dateQuote: nullable(text),
        }),
      ],
    },
  });
export type SurferNaturalQuestionWire = {
  interpretation:
    | { state: 'AMBIGUOUS' | 'UNMODELED' | 'MISSING'; reason: string }
    | {
        state: 'RESOLVED';
        candidate: string;
        kind: 'RECALL' | 'APPLY';
        observations: (
          | { predicate: string; type: 'BOOLEAN'; truth: 'TRUE' | 'FALSE'; quote: string }
          | { predicate: string; type: 'NUMBER'; quote: string }
        )[];
        dateQuote: string | null;
      };
};
const registry = new SchemaRegistry();
registry.register({
  name: 'surfer.natural-question',
  version: '1.0.0',
  kind: 'query',
  inputSchema: obj({
    schemaVersion: { const: '1.0.0' },
    requestId: { type: 'string', minLength: 1, maxLength: 96 },
    snapshotId: nullable(text),
    question: { type: 'string', minLength: 1, maxLength: 2048 },
  }),
});
registry.register({
  name: 'surfer.natural-question-wire',
  version: '1.0.0',
  kind: 'query',
  inputSchema: surferNaturalQuestionResponseSchema(),
});
registry.register({
  name: 'surfer.inquiry-value',
  version: '1.0.0',
  kind: 'query',
  inputSchema: {
    anyOf: [
      obj({ type: { const: 'BOOLEAN' }, value: { type: 'boolean' } }),
      obj({
        type: { const: 'NUMBER' },
        decimal: { type: 'string', maxLength: 40, pattern: '^-?(0|[1-9][0-9]*)([.][0-9]+)?$' },
        unit: nullable({ type: 'string', minLength: 1, maxLength: 64 }),
      }),
      obj({
        type: { const: 'DATE' },
        value: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' },
      }),
    ],
  },
});
export function decodeSurferNaturalQuestion(input: unknown) {
  assertSurferJson(input);
  registry.validateInput('surfer.natural-question', '1.0.0', input);
  return structuredClone(input) as SurferNaturalQuestionRequest;
}
export function decodeSurferNaturalQuestionWire(input: unknown) {
  assertSurferJson(input);
  registry.validateInput('surfer.natural-question-wire', '1.0.0', input);
  return structuredClone(input) as SurferNaturalQuestionWire;
}
export function decodeSurferInquiryValue(input: unknown) {
  assertSurferJson(input);
  registry.validateInput('surfer.inquiry-value', '1.0.0', input);
  return structuredClone(input) as SurferInquiryValue;
}
export function surferMemoryLanguageContextDigest(
  c: Omit<SurferMemoryLanguageContext, 'digest'> | SurferMemoryLanguageContext,
) {
  return surferDigest({
    request: c.request,
    snapshot: c.snapshot,
    basis: c.basis.contentDigest,
    selections: c.selections,
    candidates: c.candidates,
  });
}
