import type { SurferSourceSessionPortV2 } from '../../../packages/contracts/src/surfer-source-binding-v2.js';
import { assertSurferSourceBasisV2 } from '../../../packages/contracts/src/surfer-source-binding-v2.js';
import { decodeSurferSourceRequest } from '../../../packages/contracts/src/surfer-source.js';
import { decodeSurferArtifactRef } from '../../../packages/contracts/src/surfer-knowledge.js';
import type {
  SurferMemoryBatchRefreshSessionPort,
  SurferMemoryBatchRefreshSession,
} from '../../../packages/contracts/src/surfer-memory-batch-refresh.js';
import { surferDigest, surferFailure } from '../../../packages/contracts/src/surfer-learning.js';
import { ShotgunError } from '../../../packages/contracts/src/errors.js';
import { SurferKnowledgeService } from '../../../modules/surfer-core/src/index.js';
import { ShotgunSurferDirectiveMemorySession } from './directive-memory.js';
function stale(): never {
  throw new ShotgunError({
    code: 'STALE_VERSION',
    safeMessage: 'The selected memory cannot be refreshed under the current Source authority.',
    module: 'surfer.bridge',
    operation: 'memory-batch-refresh',
  });
}
/** Historical access stays inside this trusted adapter; only validated replacement metadata escapes. */
export class ShotgunSurferMemoryBatchRefreshSession implements SurferMemoryBatchRefreshSessionPort {
  constructor(private readonly sessions: SurferSourceSessionPortV2) {}
  async withBatchRefreshSession<T>(
    actor: unknown,
    apply: (session: SurferMemoryBatchRefreshSession) => Promise<T>,
  ): Promise<T> {
    const request = decodeSurferSourceRequest(actor);
    return this.sessions.withSnapshotV2(request, async (raw) => {
      let active = true;
      const bound: SurferSourceSessionPortV2 = {
        withSnapshotV2: async (r, action) => {
          if (!active || surferDigest(decodeSurferSourceRequest(r)) !== surferDigest(request))
            throw surferFailure('Refresh session escaped its Source actor/transaction.');
          return action(raw);
        },
      };
      try {
        return await new ShotgunSurferDirectiveMemorySession(bound).withSession(request, (s) =>
          apply({
            ...s,
            planReplacements: async (input) => {
              // The ordinary capture owner verifies write authority, session lifetime and core->binding lock order first.
              const empty = await s.capture({
                schemaVersion: '2.0.0',
                sourceIds: [],
                artifacts: [],
                queries: [],
              });
              const bindings = await raw.bindingStore.transaction(
                raw.snapshot.context.spaceId,
                (st) => structuredClone(st),
              );
              if (bindings.activeSnapshotId !== input.snapshotId) return stale();
              const historical = await new SurferKnowledgeService(raw.store).readSnapshot(
                input.snapshotId,
                'HISTORICAL',
                raw.snapshot.context,
              );
              const entries = historical.snapshot.entries;
              if (
                !entries.length ||
                entries.length > 16 ||
                input.targets.length < 2 ||
                input.targets.length > 8
              )
                return stale();
              const targetIds = new Set(input.targets.map((t) => t.replaces.artifactId));
              if (targetIds.size !== input.targets.length) return stale();
              for (const item of input.targets) {
                const target = decodeSurferArtifactRef(item.replaces);
                assertSurferSourceBasisV2(item.basis);
                if (entries.filter((e) => surferDigest(e) === surferDigest(target)).length !== 1)
                  return stale();
                const artifact = historical.artifacts.find(
                  (a) =>
                    surferDigest({
                      artifactId: a.artifactId,
                      revision: a.revision,
                      digest: a.digest,
                    }) === surferDigest(target),
                );
                if (
                  !artifact ||
                  artifact.kind !== 'INTERPRETATION' ||
                  artifact.domain !== 'surfer.directive-memory.v1'
                )
                  throw surferFailure('Refresh target is not a directive memory.');
                const head = await raw.store.transaction(
                  raw.snapshot.context.spaceId,
                  (st) =>
                    st.artifacts
                      .filter((a) => a.artifactId === target.artifactId)
                      .sort((a, b) => b.revision - a.revision)[0],
                );
                if (!head || head.digest !== target.digest) return stale();
                const record = bindings.bindings.find(
                  (r) => surferDigest(r.artifact) === surferDigest(target),
                );
                if (!record) throw surferFailure('Refresh target has no registered v2 binding.');
                const old = record.basis,
                  newBasis = item.basis;
                assertSurferSourceBasisV2(old);
                if (
                  record.digest !==
                    surferDigest({ artifact: target, contentDigest: old.contentDigest }) ||
                  !bindings.captures.some(
                    (c) =>
                      c.receiptDigest === surferDigest(old) &&
                      surferDigest(c.basis) === c.receiptDigest,
                  ) ||
                  surferDigest(old.coreBasis) !== surferDigest(artifact.basis)
                )
                  throw surferFailure('Refresh target provenance is corrupt.');
                const direct = (b: typeof old) =>
                  b.sources.length === 1 &&
                  !b.dependencies.length &&
                  !b.queries.length &&
                  !b.coreBasis.artifacts.length &&
                  !b.coreBasis.footprints.length &&
                  b.coreBasis.inputs.length === 1;
                if (
                  !direct(old) ||
                  old.coreBasis.authorityEpoch !== newBasis.coreBasis.authorityEpoch ||
                  !direct(newBasis) ||
                  old.sources[0]!.sourceId !== newBasis.sources[0]!.sourceId
                )
                  return stale();
                if (
                  surferDigest(old.authority) !== surferDigest(empty.basis.authority) ||
                  surferDigest(newBasis.authority) !== surferDigest(empty.basis.authority)
                )
                  return stale();
                const sourceId = newBasis.sources[0]!.sourceId,
                  current = await s.capture({
                    schemaVersion: '2.0.0',
                    sourceIds: [sourceId],
                    artifacts: [],
                    queries: [],
                  });
                if (
                  current.basis.contentDigest !== newBasis.contentDigest ||
                  newBasis.coreBasis.inputs[0]!.inputId !== old.coreBasis.inputs[0]!.inputId ||
                  newBasis.coreBasis.inputs[0]!.revision <= old.coreBasis.inputs[0]!.revision
                )
                  return stale();
                const rank = { public: 0, internal: 1, private: 2, restricted: 3 };
                if (
                  rank[current.knowledgeScope.sensitivity] < rank[artifact.scope.sensitivity] ||
                  !artifact.scope.accessScope.every((v) =>
                    current.knowledgeScope.accessScope.includes(v),
                  )
                )
                  return stale();
                if (
                  old.sources[0]!.fingerprint === newBasis.sources[0]!.fingerprint &&
                  old.sources[0]!.materialProof === newBasis.sources[0]!.materialProof
                )
                  return stale();
              }
              const retained = [];
              for (const ref of entries) {
                if (targetIds.has(ref.artifactId)) continue;
                const a = await s.readArtifact(ref);
                if (a.kind !== 'INTERPRETATION' || a.domain !== 'surfer.directive-memory.v1')
                  throw surferFailure('Refresh collection contains unrelated content.');
                retained.push({ ...ref });
              }
              return {
                snapshotId: historical.snapshot.snapshotId,
                snapshotDigest: historical.snapshot.digest,
                targets: input.targets.map((t) => ({ ...t.replaces })),
                retained,
                sourceIds: [
                  ...new Set(input.targets.map((t) => t.basis.sources[0]!.sourceId)),
                ].sort(),
              };
            },
          }),
        );
      } finally {
        active = false;
      }
    });
  }
}
