import { SchemaRegistry } from './schema-registry.js';
import { assertSurferJson, surferDigest, surferFailure } from './surfer-learning.js';
import type { SurferKnowledgeBasis, SurferArtifactRef } from './surfer-knowledge.js';
import type {
  SurferSourceSession,
  SurferSourceRequest,
  SurferSourceMaterial,
} from './surfer-source.js';

export type SurferQuerySelectionV2 =
  { kind: 'EXPLICIT_SOURCE_SET'; sourceIds: string[] } | { kind: 'OPEN_QUERY' };
export type SurferBindingCaptureV2 = {
  schemaVersion: '2.0.0';
  sourceIds: string[];
  artifacts: SurferArtifactRef[];
  queries: SurferQuerySelectionV2[];
};
export type SurferSourceBasisV2 = {
  schemaVersion: '2.0.0';
  contract: 'surfer.source-binding.v2';
  authority: {
    projectId: string;
    principalId: string;
    knowledgeEpoch: string;
    accessDigest: string;
    policyRevision: string;
  };
  coreBasis: SurferKnowledgeBasis;
  sources: { sourceId: string; fingerprint: string; materialProof: string }[];
  queries: (SurferQuerySelectionV2 & { membershipDigest: string })[];
  dependencies: { artifact: SurferArtifactRef; bindingDigest: string }[];
  contentDigest: string;
  readWatermark: { sourceSnapshotDigest: string; observedAt: string };
};
export type SurferBindingRecordV2 = {
  artifact: SurferArtifactRef;
  basis: SurferSourceBasisV2;
  digest: string;
};
export type SurferBindingStateV2 = {
  schemaVersion: '2.0.0';
  spaceId: string;
  sequence: number;
  bindings: SurferBindingRecordV2[];
  captures: { receiptDigest: string; basis: SurferSourceBasisV2 }[];
  activeSnapshotId: string | null;
  watermarks: { principalId: string; sourceSnapshotDigest: string; observedAt: string }[];
};
export const emptySurferBindingStateV2 = (spaceId: string): SurferBindingStateV2 => ({
  schemaVersion: '2.0.0',
  spaceId,
  sequence: 0,
  bindings: [],
  captures: [],
  watermarks: [],
  activeSnapshotId: null,
});
export interface SurferBindingStorePortV2 {
  transaction<T>(spaceId: string, apply: (state: SurferBindingStateV2) => T): Promise<T>;
  /** Optional row-locked immutable read view;legacy adapters retain transaction fallback. */
  read?<T>(spaceId: string, apply: (state: SurferBindingStateV2) => T): Promise<T>;
}
export function readSurferBindingStateV2<T>(
  store: SurferBindingStorePortV2,
  spaceId: string,
  apply: (state: SurferBindingStateV2) => T,
): Promise<T> {
  return store.read ? store.read(spaceId, apply) : store.transaction(spaceId, apply);
}
export type SurferSourceReadMetricsV2 = {
  metadataHeads: number;
  materialLoads: number;
  proofReads: number;
  cacheHits: number;
  materialBytes: number;
};
export type SurferSourceSessionV2 = SurferSourceSession & {
  /** Server-owned read view; validation must not persist observation watermarks. */
  readonly readOnly?: boolean;
  bindingStore: SurferBindingStorePortV2;
  metrics: SurferSourceReadMetricsV2;
  readMaterialV2(sourceId: string): Promise<{ material: SurferSourceMaterial; proof: string }>;
  readContentProofV2(sourceId: string): Promise<string>;
};
export interface SurferSourceSessionPortV2 {
  withSnapshotV2<T>(
    request: SurferSourceRequest,
    action: (session: SurferSourceSessionV2) => Promise<T>,
  ): Promise<T>;
}

const id = { type: 'string', minLength: 1, maxLength: 256 };
const digest = { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' };
const list = (items: object) => ({ type: 'array', maxItems: 64, uniqueItems: true, items });
const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const artifact = object({
  artifactId: id,
  revision: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
  digest,
});
const query = {
  anyOf: [
    object({ kind: { const: 'OPEN_QUERY' } }),
    object({ kind: { const: 'EXPLICIT_SOURCE_SET' }, sourceIds: list(id) }),
  ],
};
const registry = new SchemaRegistry();
registry.register({
  name: 'surfer.binding-capture',
  version: '2.0.0',
  kind: 'query',
  inputSchema: object({
    schemaVersion: { const: '2.0.0' },
    sourceIds: list(id),
    artifacts: list(artifact),
    queries: list(query),
  }),
});
export function decodeSurferBindingCaptureV2(input: unknown): SurferBindingCaptureV2 {
  assertSurferJson(input);
  registry.validateInput('surfer.binding-capture', '2.0.0', input);
  return structuredClone(input) as SurferBindingCaptureV2;
}
export function sourceBindingContentDigestV2(
  basis: Omit<SurferSourceBasisV2, 'contentDigest'> | SurferSourceBasisV2,
): string {
  const { readWatermark: _watermark, ...content } = basis;
  const { contentDigest: _digest, ...meaning } = content as Partial<SurferSourceBasisV2>;
  return surferDigest(meaning);
}
/** Core basis is decoded by the existing core capture/command codecs before use. */
export function assertSurferSourceBasisV2(input: unknown): asserts input is SurferSourceBasisV2 {
  assertSurferJson(input);
  if (!input || typeof input !== 'object') throw surferFailure('Expected Source binding v2.');
  const b = input as SurferSourceBasisV2;
  const keys = [
    'schemaVersion',
    'contract',
    'authority',
    'coreBasis',
    'sources',
    'queries',
    'dependencies',
    'contentDigest',
    'readWatermark',
  ];
  if (
    Object.keys(b).sort().join(',') !== keys.sort().join(',') ||
    b.schemaVersion !== '2.0.0' ||
    b.contract !== 'surfer.source-binding.v2' ||
    !b.authority ||
    !b.readWatermark ||
    !Array.isArray(b.sources) ||
    b.sources.length > 64 ||
    !Array.isArray(b.queries) ||
    b.queries.length > 64 ||
    !Array.isArray(b.dependencies) ||
    b.dependencies.length > 64 ||
    sourceBindingContentDigestV2(b) !== b.contentDigest
  )
    throw surferFailure('Source binding v2 version/shape/digest mismatch.');
}
export function assertSurferBindingTransitionV2(
  old: SurferBindingStateV2,
  next: SurferBindingStateV2,
): void {
  surferDigest(next);
  if (
    next.spaceId !== old.spaceId ||
    next.schemaVersion !== '2.0.0' ||
    !Number.isSafeInteger(next.sequence) ||
    next.sequence < old.sequence ||
    next.sequence > old.sequence + 1 ||
    next.bindings.length > 1024 ||
    next.captures.length > 1024 ||
    next.watermarks.length > 64 ||
    (next.sequence === old.sequence && surferDigest(next) !== surferDigest(old))
  )
    throw surferFailure('Source binding transaction identity/schema/sequence changed.');
}
