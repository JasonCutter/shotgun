import type { SurferSourceSessionPortV2 } from '../../../packages/contracts/src/surfer-source-binding-v2.js';
import { assertSurferSourceBasisV2 } from '../../../packages/contracts/src/surfer-source-binding-v2.js';
import { decodeSurferSourceRequest } from '../../../packages/contracts/src/surfer-source.js';
import type {
  SurferMemoryRefreshDiscoveryPort,
  SurferMemoryRefreshDiscoverySession,
  SurferMemoryRefreshDiscoveryPlan,
} from '../../../packages/contracts/src/surfer-memory-refresh-discovery.js';
import { surferDigest, surferFailure } from '../../../packages/contracts/src/surfer-learning.js';
import { ShotgunError } from '../../../packages/contracts/src/errors.js';
import { SurferKnowledgeService } from '../../../modules/surfer-core/src/index.js';
import { ShotgunSurferDirectiveMemorySession } from './directive-memory.js';

const levels = { public: 0, internal: 1, private: 2, restricted: 3 };
/** On-demand reconciliation in one Source transaction. No historical content escapes. */
export class ShotgunSurferMemoryRefreshDiscoverySession implements SurferMemoryRefreshDiscoveryPort {
  constructor(private readonly sessions: SurferSourceSessionPortV2) {}
  async withDiscoverySession<T>(
    actor: unknown,
    apply: (session: SurferMemoryRefreshDiscoverySession) => Promise<T>,
  ): Promise<T> {
    const request = decodeSurferSourceRequest(actor);
    return this.sessions.withSnapshotV2(request, async (raw) => {
      let active = true;
      const bound: SurferSourceSessionPortV2 = {
        withSnapshotV2: async (r, action) => {
          if (!active || surferDigest(decodeSurferSourceRequest(r)) !== surferDigest(request))
            throw surferFailure('Discovery session escaped its Source actor/transaction.');
          return action(raw);
        },
      };
      try {
        return await new ShotgunSurferDirectiveMemorySession(bound).withSession(request, (s) =>
          apply({
            ...s,
            discoverActive: async () => {
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
              const plan: SurferMemoryRefreshDiscoveryPlan = {
                schemaVersion: '1.0.0',
                contract: 'surfer.memory-refresh-plan.v1',
                status: 'EMPTY',
                snapshot: null,
                authorityDigest: surferDigest(empty.basis.authority),
                targets: [],
                retained: [],
                blocked: [],
              };
              if (!bindings.activeSnapshotId) return { plan, basis: null, scope: null };
              const history = await new SurferKnowledgeService(raw.store).readSnapshot(
                bindings.activeSnapshotId,
                'HISTORICAL',
                raw.snapshot.context,
              );
              plan.snapshot = {
                snapshotId: history.snapshot.snapshotId,
                digest: history.snapshot.digest,
              };
              if (history.snapshot.entries.length > 16)
                throw surferFailure('Discovery exceeds the active memory profile.');
              for (const ref of history.snapshot.entries) {
                const block = (
                  reason: SurferMemoryRefreshDiscoveryPlan['blocked'][number]['reason'],
                ) => plan.blocked.push({ memory: { ...ref }, reason });
                const artifact = history.artifacts.find(
                  (a) =>
                    a.artifactId === ref.artifactId &&
                    a.revision === ref.revision &&
                    a.digest === ref.digest,
                );
                if (
                  !artifact ||
                  artifact.kind !== 'INTERPRETATION' ||
                  artifact.domain !== 'surfer.directive-memory.v1'
                ) {
                  block('UNSUPPORTED_MEMBER');
                  continue;
                }
                const record = bindings.bindings.find(
                  (r) => surferDigest(r.artifact) === surferDigest(ref),
                );
                if (!record) throw surferFailure('Discovery memory has no v2 binding.');
                const old = record.basis;
                assertSurferSourceBasisV2(old);
                if (
                  record.digest !==
                    surferDigest({ artifact: ref, contentDigest: old.contentDigest }) ||
                  !bindings.captures.some(
                    (c) =>
                      c.receiptDigest === surferDigest(old) &&
                      surferDigest(c.basis) === c.receiptDigest,
                  ) ||
                  surferDigest(old.coreBasis) !== surferDigest(artifact.basis)
                )
                  throw surferFailure('Discovery provenance is corrupt.');
                if (
                  surferDigest(old.authority) !== plan.authorityDigest ||
                  old.coreBasis.authorityEpoch !== empty.basis.coreBasis.authorityEpoch
                ) {
                  block('AUTHORITY_CHANGED');
                  continue;
                }
                try {
                  await s.readArtifact(ref);
                  plan.retained.push({ ...ref });
                  continue;
                } catch (error) {
                  if (
                    !(error instanceof ShotgunError) ||
                    !['STALE_VERSION', 'POLICY_DENIED'].includes(error.code)
                  )
                    throw error;
                }
                if (
                  old.sources.length !== 1 ||
                  old.dependencies.length ||
                  old.queries.length ||
                  old.coreBasis.artifacts.length ||
                  old.coreBasis.footprints.length ||
                  old.coreBasis.inputs.length !== 1
                ) {
                  block('UNSUPPORTED_DEPENDENCIES');
                  continue;
                }
                const previous = old.sources[0]!,
                  head = raw.snapshot.heads.find((h) => h.sourceId === previous.sourceId);
                if (!head || head.readiness !== 'INDEXED' || !head.revisionId) {
                  block('SOURCE_UNAVAILABLE');
                  continue;
                }
                const proof = await raw.readContentProofV2(head.sourceId);
                if (head.fingerprint === previous.fingerprint && proof === previous.materialProof) {
                  block('NON_SOURCE_STALENESS');
                  continue;
                }
                if (
                  levels[head.scope.sensitivity] < levels[artifact.scope.sensitivity] ||
                  !artifact.scope.accessScope.every((v) => head.scope.accessScope.includes(v))
                ) {
                  block('SCOPE_WEAKENED');
                  continue;
                }
                const latest = await raw.store.transaction(
                  raw.snapshot.context.spaceId,
                  (st) =>
                    st.artifacts
                      .filter((a) => a.artifactId === ref.artifactId)
                      .sort((a, b) => b.revision - a.revision)[0],
                );
                if (!latest || latest.digest !== ref.digest) {
                  block('HEAD_CHANGED');
                  continue;
                }
                const next = await s.capture({
                  schemaVersion: '2.0.0',
                  sourceIds: [head.sourceId],
                  artifacts: [],
                  queries: [],
                });
                if (
                  next.basis.coreBasis.inputs[0]?.inputId !== old.coreBasis.inputs[0]!.inputId ||
                  next.basis.coreBasis.inputs[0]!.revision <= old.coreBasis.inputs[0]!.revision
                ) {
                  block('NOT_NEWER_SOURCE');
                  continue;
                }
                plan.targets.push({
                  memory: { ...ref },
                  sourceId: head.sourceId,
                  previousFingerprint: previous.fingerprint,
                  previousMaterialProof: previous.materialProof,
                  currentFingerprint: head.fingerprint,
                  currentMaterialProof: proof,
                  sourceVersionId: head.sourceVersionId,
                  revisionId: head.revisionId,
                });
              }
              plan.targets.sort((a, b) => (a.memory.artifactId < b.memory.artifactId ? -1 : 1));
              plan.retained.sort((a, b) => (a.artifactId < b.artifactId ? -1 : 1));
              plan.blocked.sort((a, b) =>
                (a.memory?.artifactId ?? '') < (b.memory?.artifactId ?? '') ? -1 : 1,
              );
              if (plan.targets.length > 8)
                plan.blocked.push({ memory: null, reason: 'BATCH_CAPACITY' });
              plan.status = plan.blocked.length
                ? 'BLOCKED'
                : plan.targets.length
                  ? 'REFRESH_REQUIRED'
                  : 'UNCHANGED';
              if (plan.status !== 'REFRESH_REQUIRED') return { plan, basis: null, scope: null };
              const capture = await s.capture({
                schemaVersion: '2.0.0',
                sourceIds: [...new Set(plan.targets.map((t) => t.sourceId))].sort(),
                artifacts: plan.retained,
                queries: [],
              });
              return { plan, basis: capture.basis, scope: capture.knowledgeScope };
            },
          }),
        );
      } finally {
        active = false;
      }
    });
  }
}
