import type { DocumentIR, EvidenceSpan, SourceMap } from './document-evidence.js';
import type { SurferAccessContext } from './surfer-experiment.js';
import type { SurferKnowledgeStorePort } from './surfer-knowledge.js';
import { assertSurferJson, type SurferScope } from './surfer-learning.js';
import { SchemaRegistry } from './schema-registry.js';

/** Internal server credential. Never persist, log, or send this object to a model. */
export type SurferSessionSourceRequest = {
  readonly projectId: string;
  readonly sessionToken: string;
};
/** Internal read actor bound to a real claimed Ask attempt. Not a browser request or send grant. */
export type SurferAskSourceRequest = {
  readonly projectId: string;
  readonly ask: {
    readonly answerRunId: string;
    readonly attemptId: string;
    readonly leaseOwner: string;
  };
};
export type SurferSourceRequest = SurferSessionSourceRequest | SurferAskSourceRequest;
export type SurferSourceHead = {
  readonly sourceId: string;
  readonly originalAssetId: string;
  readonly sourceVersionId: string;
  readonly versionNumber: number;
  readonly sourceContentHash: string;
  readonly scope: SurferScope;
  readonly observedAt: string;
  readonly readiness: 'INDEXED' | 'NO_EVIDENCE' | 'UNAVAILABLE';
  readonly revisionId: string | null;
  readonly indexingResultId: string | null;
  readonly fingerprint: string;
};
export type SurferSourceMaterial = {
  readonly schemaVersion: '1.0.0';
  readonly originalAssetId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly revisionId: string;
  readonly indexingResultId: string;
  readonly sourceContentHash: string;
  readonly scope: SurferScope;
  readonly documentIR: DocumentIR;
  readonly sourceMap: SourceMap;
  readonly evidence: readonly EvidenceSpan[];
  readonly rootEvidenceId: string;
  readonly documentHash: string;
  readonly sourceMapHash: string;
  readonly transformer: { readonly id: string; readonly version: string };
  readonly contentRole: 'UNTRUSTED_SOURCE_DATA';
  readonly semanticAssessment: 'NOT_EVALUATED';
};
export type SurferSourceSnapshot = {
  readonly schemaVersion: '1.0.0';
  readonly projectId: string;
  readonly principalId: string;
  readonly context: SurferAccessContext;
  readonly canSynchronize: boolean;
  readonly knowledgeEpoch: string;
  readonly accessDigest: string;
  readonly policyRevision: string;
  readonly digest: string;
  readonly heads: readonly SurferSourceHead[];
  readonly observedAt: string;
  readonly coverage: {
    readonly accessibleSources: number;
    readonly indexedSources: number;
    readonly unavailableSources: number;
    readonly closedWorld: false;
  };
  readonly consistency: 'SOURCE_KNOWLEDGE_AS_OF_SNAPSHOT';
};
export type SurferSourceSession = {
  readonly snapshot: SurferSourceSnapshot;
  readonly store: SurferKnowledgeStorePort;
  readMaterial(sourceId: string): Promise<SurferSourceMaterial>;
};
/** Source reads and Surfer state commit share the same transaction/snapshot. Do not retain a session. */
export interface SurferSourceSessionPort {
  withSnapshot<T>(
    request: SurferSourceRequest,
    action: (session: SurferSourceSession) => Promise<T>,
  ): Promise<T>;
}
const registry = new SchemaRegistry();
registry.register({
  name: 'surfer.source-request',
  version: '1.0.0',
  kind: 'query',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['projectId', 'sessionToken'],
    properties: {
      projectId: { type: 'string', minLength: 1, maxLength: 256 },
      sessionToken: { type: 'string', minLength: 1, maxLength: 2048 },
    },
  },
});
export function decodeSurferSourceRequest(input: unknown): SurferSourceRequest {
  assertSurferJson(input);
  if (input && typeof input === 'object' && 'ask' in input) {
    const r = input as SurferAskSourceRequest;
    const text = (x: unknown, n: number) =>
      typeof x === 'string' && x.length > 0 && x.length <= n && x.trim() === x;
    if (
      Object.keys(r).sort().join(',') !== 'ask,projectId' ||
      !text(r.projectId, 256) ||
      !r.ask ||
      typeof r.ask !== 'object' ||
      Array.isArray(r.ask) ||
      Object.keys(r.ask).sort().join(',') !== 'answerRunId,attemptId,leaseOwner' ||
      !text(r.ask.answerRunId, 256) ||
      !text(r.ask.attemptId, 256) ||
      !text(r.ask.leaseOwner, 256)
    )
      throw new Error('Invalid exact Ask source-read actor.');
    return structuredClone(r);
  }
  registry.validateInput('surfer.source-request', '1.0.0', input);
  return structuredClone(input) as SurferSourceRequest;
}
