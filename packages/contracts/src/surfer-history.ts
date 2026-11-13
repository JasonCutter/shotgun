import type { SurferKnowledgeState } from './surfer-knowledge.js';
import type { SurferBindingStateV2 } from './surfer-source-binding-v2.js';
import { assertSurferSourceBasisV2 } from './surfer-source-binding-v2.js';
import { surferDigest, surferFailure } from './surfer-learning.js';

/** Explicit archive contract; deliberately does not implement the full State callback Port. */
export type SurferHistoryPin = { revision: number; digest: string };
export type SurferHistoryPins = { knowledge: SurferHistoryPin; binding: SurferHistoryPin };
export type SurferHistoryRecord = {
  kind:
    'INPUT' | 'ARTIFACT' | 'EPOCH' | 'SNAPSHOT' | 'COMMAND' | 'BINDING' | 'CAPTURE' | 'WATERMARK';
  key: string;
  value: unknown;
  digest: string;
};
export type SurferHistoryManifest = {
  contract: 'surfer.history-archive.v1';
  purpose: 'HISTORICAL_ONLY';
  spaceId: string;
  pins: SurferHistoryPins;
  knowledge: Omit<
    SurferKnowledgeState,
    'inputs' | 'artifacts' | 'epochs' | 'snapshots' | 'commands'
  >;
  binding: Omit<SurferBindingStateV2, 'bindings' | 'captures' | 'watermarks'>;
  counts: number[];
  total: number;
};
export type SurferHistoryProgress = {
  generationId: string;
  mode: 'SHADOW_ONLY';
  status: 'COPYING' | 'SEALED' | 'SUSPENDED';
  verified: boolean;
  cursor: number;
  total: number;
  manifestDigest: string;
};
export interface SurferHistoryArchivePort {
  begin(pins: SurferHistoryPins): Promise<SurferHistoryProgress>;
  copyBatch(
    generationId: string,
    expectedCursor: number,
    limit: number,
  ): Promise<SurferHistoryProgress>;
  seal(generationId: string): Promise<SurferHistoryProgress>;
  suspend(generationId: string, expectedCursor: number): Promise<SurferHistoryProgress>;
  page(
    generationId: string,
    after: number,
    limit: number,
  ): Promise<{
    purpose: 'HISTORICAL_ONLY';
    status: 'SEALED' | 'SUSPENDED';
    verified: boolean;
    copied: number;
    manifest: SurferHistoryManifest;
    records: { ordinal: number; record: SurferHistoryRecord }[];
    next: number;
  }>;
}
export function assertHistoryLimit(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 16)
    throw surferFailure('History batch/page limit must be 1..16.');
}
function historyRecord(
  kind: SurferHistoryRecord['kind'],
  key: unknown,
  value: unknown,
): SurferHistoryRecord {
  const body = { kind, key: surferDigest(key), value };
  return { ...body, digest: surferDigest(body) };
}
export function assertHistoryRecord(record: SurferHistoryRecord): void {
  const { digest, ...body } = record;
  if (surferDigest(body) !== digest) throw surferFailure('History record digest mismatch.');
}
/** Pure lossless projection of validated legacy aggregates; no semantic/currentness promotion. */
export function projectSurferHistory(
  knowledge: SurferKnowledgeState,
  binding: SurferBindingStateV2,
): {
  manifest: SurferHistoryManifest;
  records: SurferHistoryRecord[];
} {
  if (
    knowledge.schemaVersion !== '1.0.0' ||
    binding.schemaVersion !== '2.0.0' ||
    knowledge.spaceId !== binding.spaceId
  )
    throw surferFailure('History source identity/schema mismatch.');
  const { inputs, artifacts, epochs, snapshots, commands, ...kh } = knowledge;
  const { bindings, captures, watermarks, ...bh } = binding;
  const records: SurferHistoryRecord[] = [];
  const counts: number[] = [];
  const add = (
    kind: SurferHistoryRecord['kind'],
    values: readonly unknown[],
    key: (value: never) => unknown,
  ) => {
    if (!Array.isArray(values)) throw surferFailure('History source collection is missing.');
    counts.push(values.length);
    const keys = new Set<string>();
    for (const value of values) {
      const r = historyRecord(kind, key(value as never), value);
      if (keys.has(r.key)) throw surferFailure('History source contains duplicate identities.');
      keys.add(r.key);
      records.push(r);
    }
  };
  // Validate preexisting envelope digests without rewriting any field or receipt.
  for (const x of [...artifacts, ...snapshots]) {
    const { digest, ...body } = x;
    if (surferDigest(body) !== digest || x.semanticAssessment !== 'NOT_EVALUATED')
      throw surferFailure('History source envelope digest mismatch.');
  }
  for (const x of [...inputs, ...artifacts]) {
    if (x.scope.spaceId !== knowledge.spaceId)
      throw surferFailure('History source scope mismatch.');
  }
  for (const x of snapshots)
    if (x.spaceId !== knowledge.spaceId) throw surferFailure('History snapshot scope mismatch.');
  for (const x of [...bindings, ...captures]) {
    assertSurferSourceBasisV2(x.basis);
    if (x.basis.coreBasis.spaceId !== knowledge.spaceId)
      throw surferFailure('History binding scope mismatch.');
    const expected =
      'artifact' in x
        ? surferDigest({ artifact: x.artifact, contentDigest: x.basis.contentDigest })
        : surferDigest(x.basis);
    if (expected !== ('digest' in x ? x.digest : x.receiptDigest))
      throw surferFailure('History binding receipt mismatch.');
  }
  add('INPUT', inputs, (x: (typeof inputs)[number]) => [x.inputId, x.revision]);
  add('ARTIFACT', artifacts, (x: (typeof artifacts)[number]) => [x.artifactId, x.revision]);
  add('EPOCH', epochs, (x: (typeof epochs)[number]) => [x.domain, x.predicate]);
  add('SNAPSHOT', snapshots, (x: (typeof snapshots)[number]) => x.snapshotId);
  add('COMMAND', commands, (x: (typeof commands)[number]) => x.operationId);
  add('BINDING', bindings, (x: (typeof bindings)[number]) => x.artifact);
  add('CAPTURE', captures, (x: (typeof captures)[number]) => x.receiptDigest);
  add('WATERMARK', watermarks, (x: (typeof watermarks)[number]) => x.principalId);
  const pins = {
    knowledge: { revision: knowledge.sequence, digest: surferDigest(knowledge) },
    binding: { revision: binding.sequence, digest: surferDigest(binding) },
  };
  const manifest: SurferHistoryManifest = {
    contract: 'surfer.history-archive.v1',
    purpose: 'HISTORICAL_ONLY',
    spaceId: knowledge.spaceId,
    pins,
    knowledge: kh,
    binding: bh,
    counts,
    total: records.length,
  };
  surferDigest(manifest);
  return { manifest, records };
}
