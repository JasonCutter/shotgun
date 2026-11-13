import type { SurferSourceBasisV2, SurferBindingCaptureV2 } from './surfer-source-binding-v2.js';
import type { SurferScope } from './surfer-learning.js';
import type {
  SurferCognitiveSourcePort,
  SurferCognitiveReadReceipt,
  SurferObservationSelection,
} from './surfer-cognition.js';
import type {
  SurferKnowledgeCommand,
  SurferKnowledgeCommit,
  SurferKnowledgeArtifact,
  SurferKnowledgeSnapshot,
} from './surfer-knowledge.js';
import type { SurferDirectiveExtractionV2 } from './surfer-directive-v2.js';
import type { SurferArtifactRef } from './surfer-knowledge.js';
import type { SurferSemanticFrameProposal } from './surfer-cognition.js';
import type { SurferActionMode } from './surfer-directive.js';
import { SchemaRegistry } from './schema-registry.js';
import { assertSurferJson } from './surfer-learning.js';
export type SurferDirectiveMemoryPayload = {
  contract: 'surfer.directive-memory.v1';
  basis: SurferSourceBasisV2;
  selections: SurferObservationSelection[];
  packet: SurferDirectiveExtractionV2;
};
export interface SurferDirectiveMemorySession {
  source: SurferCognitiveSourcePort;
  priorCreatedAt(appendOperationId: string): Promise<string | null>;
  findCommit(operationId: string): Promise<SurferKnowledgeCommit | null>;
  capture(input: SurferBindingCaptureV2): Promise<{
    basis: SurferSourceBasisV2;
    knowledgeScope: SurferScope;
    readReceipt: SurferCognitiveReadReceipt;
  }>;
  readArtifact(ref: SurferArtifactRef): Promise<SurferKnowledgeArtifact>;
  commit(envelope: {
    schemaVersion: '2.0.0';
    command: SurferKnowledgeCommand;
    basis: SurferSourceBasisV2 | null;
  }): Promise<{ commit: SurferKnowledgeCommit; replayed: boolean }>;
  read(snapshotId: string | null): Promise<
    | {
        status: 'CURRENT';
        result: {
          snapshot: SurferKnowledgeSnapshot;
          artifacts: readonly SurferKnowledgeArtifact[];
          isActive: boolean;
        };
        readReceipt: SurferCognitiveReadReceipt;
      }
    | { status: 'UNAVAILABLE'; readReceipt: SurferCognitiveReadReceipt }
  >;
}
/** Trusted bounded backend composition, one Source/knowledge transaction. No provider dispatch in the callback. */
export interface SurferDirectiveMemorySessionPort {
  withReadSession?<T>(
    actor: unknown,
    apply: (session: SurferDirectiveMemorySession) => Promise<T>,
  ): Promise<T>;
  withSession<T>(
    actor: unknown,
    apply: (session: SurferDirectiveMemorySession) => Promise<T>,
  ): Promise<T>;
}
export function readSurferMemorySession<T>(
  port: SurferDirectiveMemorySessionPort,
  actor: unknown,
  apply: (session: SurferDirectiveMemorySession) => Promise<T>,
): Promise<T> {
  return port.withReadSession ? port.withReadSession(actor, apply) : port.withSession(actor, apply);
}
export interface SurferDirectiveScenarioEvaluationPort {
  readonly revision: string;
  evaluate(
    packet: SurferDirectiveExtractionV2,
    question: SurferMemoryQuestion,
  ): {
    outcome: string;
    reasons: string[];
    needed: { predicateId: string; quote: string; reason: string }[];
  };
}
export type SurferMemoryObservation = {
  predicateId: string;
  value:
    { type: 'BOOLEAN'; value: boolean } | { type: 'NUMBER'; decimal: string; unit: string | null };
};
export type SurferMemoryQuestion = {
  schemaVersion: '1.0.0';
  snapshotId: string | null;
  kind: 'RECALL' | 'APPLY';
  subject: string;
  operation: string;
  observations: SurferMemoryObservation[];
  atDate: string | null;
};
export type SurferMemoryAnswer = {
  memory: SurferArtifactRef;
  outcome: string;
  reasons: string[];
  needed: { predicateId: string; quote: string; reason: string }[];
  declaredMode: SurferActionMode;
  citations: {
    role: 'ACTION' | 'ACTION_CONTEXT' | 'CONDITION' | 'EXCEPTION';
    predicateId: string;
    sourceId: string;
    sourceVersionId: string;
    evidenceId: string;
    revisionId: string;
    start: number;
    end: number;
    quote: string;
  }[];
  producer: SurferSemanticFrameProposal['producer'];
  assessment: 'DECLARED_INTERPRETATION_NOT_VERIFIED_RULE';
};
const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});
const text = { type: 'string', minLength: 1, maxLength: 256 },
  nullable = (v: unknown) => ({ anyOf: [v, { type: 'null' }] });
const registry = new SchemaRegistry();
registry.register({
  name: 'surfer.memory-question',
  version: '1.0.0',
  kind: 'query',
  inputSchema: object({
    schemaVersion: { const: '1.0.0' },
    snapshotId: nullable(text),
    kind: { enum: ['RECALL', 'APPLY'] },
    subject: text,
    operation: text,
    observations: {
      type: 'array',
      maxItems: 8,
      items: object({
        predicateId: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
        value: {
          anyOf: [
            object({ type: { const: 'BOOLEAN' }, value: { type: 'boolean' } }),
            object({
              type: { const: 'NUMBER' },
              decimal: {
                type: 'string',
                maxLength: 40,
                pattern: '^-?(0|[1-9][0-9]*)([.][0-9]+)?$',
              },
              unit: nullable({ type: 'string', minLength: 1, maxLength: 64 }),
            }),
          ],
        },
      }),
    },
    atDate: nullable({ type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' }),
  }),
});
export function decodeSurferMemoryQuestion(input: unknown): SurferMemoryQuestion {
  assertSurferJson(input);
  registry.validateInput('surfer.memory-question', '1.0.0', input);
  return structuredClone(input) as SurferMemoryQuestion;
}
