import { SurferKnowledgeService } from '../../../modules/surfer-core/src/index.js';
import { ShotgunError } from '../../../packages/contracts/src/errors.js';
import {
  readSurferKnowledgeState,
  decodeSurferKnowledgeCommand,
  type SurferQueryFootprint,
} from '../../../packages/contracts/src/surfer-knowledge.js';
import {
  decodeSurferSourceRequest,
  type SurferSourceMaterial,
} from '../../../packages/contracts/src/surfer-source.js';
import {
  assertSurferJson,
  surferDigest,
  surferFailure,
} from '../../../packages/contracts/src/surfer-learning.js';
import {
  readSurferBindingStateV2,
  assertSurferSourceBasisV2,
  decodeSurferBindingCaptureV2,
  sourceBindingContentDigestV2,
  type SurferSourceBasisV2,
  type SurferSourceSessionV2,
  type SurferSourceSessionPortV2,
  type SurferBindingRecordV2,
} from '../../../packages/contracts/src/surfer-source-binding-v2.js';

import {
  inputId,
  authority,
  receipt,
  owner,
  queryDigest,
  sourceBindingValidator,
  sourceInputContent,
  sourceInputChanged,
  unavailable,
} from './source-validation.js';
const levels = { public: 0, internal: 1, private: 2, restricted: 3 };
async function start(s: SurferSourceSessionV2) {
  // Consistent core -> sidecar lock order prevents capture/read publication deadlocks.
  await readSurferKnowledgeState(s.store, s.snapshot.context.spaceId, (state) => state.sequence);
  const stored = await readSurferBindingStateV2(
    s.bindingStore,
    s.snapshot.context.spaceId,
    (state) => ({
      bindings: state.bindings,
      captures: state.captures,
      activeSnapshotId: state.activeSnapshotId,
    }),
  );
  const core = new SurferKnowledgeService(s.store);
  const validator = sourceBindingValidator(s, {
    captureIssued: async (basis) =>
      stored.captures.some(
        (c) => c.receiptDigest === surferDigest(basis) && surferDigest(c.basis) === c.receiptDigest,
      ),
    inputs: async () =>
      readSurferKnowledgeState(s.store, s.snapshot.context.spaceId, (st) => st.inputs),
    binding: async (ref) =>
      stored.bindings.find((r) => surferDigest(r.artifact) === surferDigest(ref)),
    captureBasis: (request) => core.captureBasis(request, s.snapshot.context),
    readCurrentArtifact: (ref) => core.readArtifact(ref, 'CURRENT', s.snapshot.context),
  });
  return { core, stored, ...validator };
}

async function watermark(s: SurferSourceSessionV2): Promise<void> {
  if (s.readOnly) return;
  await s.bindingStore.transaction(s.snapshot.context.spaceId, (state) => {
    const p = state.watermarks.find((w) => w.principalId === s.snapshot.principalId);
    if (p?.sourceSnapshotDigest === s.snapshot.digest) return;
    const next = {
      principalId: s.snapshot.principalId,
      sourceSnapshotDigest: s.snapshot.digest,
      observedAt: s.snapshot.observedAt,
    };
    state.watermarks = [
      ...state.watermarks.filter((w) => w.principalId !== next.principalId),
      next,
    ];
    state.sequence++;
  });
}

/** Separate v2 reader/writer. No catalogue/footprint check is removed from the v1 bridge. */
export class ShotgunSurferSourceBridgeV2 {
  constructor(private readonly sessions: SurferSourceSessionPortV2) {}
  /** Trusted bounded composition callback; no model/tool call or async callback may escape this view. */
  async withCurrentBasis<T>(
    requestInput: unknown,
    basisInput: unknown,
    apply: (view: {
      basis: SurferSourceBasisV2;
      materials: SurferSourceMaterial[];
      readReceipt: ReturnType<typeof receipt>;
    }) => T,
  ): Promise<T> {
    assertSurferSourceBasisV2(basisInput);
    const basis = structuredClone(basisInput),
      request = decodeSurferSourceRequest(requestInput);
    return this.sessions.withSnapshotV2(request, async (s) => {
      const state = await start(s);
      await state.checkBasis(basis);
      const materials = await Promise.all(
        basis.sources.map(async (dep) => (await state.material(dep.sourceId)).material),
      );
      const result = structuredClone(apply({ basis, materials, readReceipt: receipt(s) }));
      await watermark(s);
      return result;
    });
  }
  async capture(requestInput: unknown, captureInput: unknown) {
    return this.captureWithFootprints(requestInput, captureInput, []);
  }
  /** Trusted scoped-learning capture, separate from ordinary v2 capture. No open-world membership. */
  async captureRule(requestInput: unknown, captureInput: unknown) {
    const input = decodeSurferBindingCaptureV2(captureInput),
      ids = [...input.sourceIds].sort();
    if (
      !ids.length ||
      input.artifacts.length ||
      input.queries.length !== 1 ||
      input.queries[0]?.kind !== 'EXPLICIT_SOURCE_SET' ||
      surferDigest([...input.queries[0].sourceIds].sort()) !== surferDigest(ids)
    )
      throw surferFailure('A scoped rule requires exactly its explicit training Source set.');
    return this.captureWithFootprints(requestInput, input, [
      { domain: 'surfer.scoped-rule-memory.v1', predicate: surferDigest({ sourceIds: ids }) },
    ]);
  }
  /** Trusted immutable lineage only; mutable RULEs cannot become their own premises. */
  async captureChain(requestInput: unknown, captureInput: unknown) {
    const input = decodeSurferBindingCaptureV2(captureInput),
      ids = [...input.sourceIds].sort();
    if (
      !ids.length ||
      !input.artifacts.length ||
      input.artifacts.length > 32 ||
      input.queries.length !== 1 ||
      input.queries[0]?.kind !== 'EXPLICIT_SOURCE_SET' ||
      surferDigest([...input.queries[0].sourceIds].sort()) !== surferDigest(ids)
    )
      throw surferFailure(
        'Chain capture requires an explicit Source set and bounded immutable capsules.',
      );
    return this.captureWithFootprints(
      requestInput,
      input,
      [{ domain: 'surfer.scoped-rule-memory.v1', predicate: surferDigest({ sourceIds: ids }) }],
      true,
    );
  }
  private async captureWithFootprints(
    requestInput: unknown,
    captureInput: unknown,
    footprints: SurferQueryFootprint[],
    immutableChain = false,
  ) {
    const request = decodeSurferSourceRequest(requestInput),
      capture = decodeSurferBindingCaptureV2(captureInput);
    return this.sessions.withSnapshotV2(request, async (s) => {
      owner(s);
      const state = await start(s),
        sourceIds = [...capture.sourceIds].sort();
      const sources = [];
      for (const sourceId of sourceIds) {
        const current = await state.material(sourceId),
          m = current.material;
        const id = inputId(s, sourceId),
          h = s.snapshot.heads.find((h) => h.sourceId === sourceId)!;
        const prior = await readSurferKnowledgeState(s.store, s.snapshot.context.spaceId, (st) =>
          st.inputs.find((i) => i.inputId === id),
        );
        const content = sourceInputContent(s, m);
        if (sourceInputChanged(prior, content)) {
          const input = { ...content, revision: (prior?.revision ?? 0) + 1 };
          await state.core.execute(
            {
              action: 'OBSERVE_INPUT',
              operationId: `source-v2:${surferDigest(input)}`,
              expectedRevision: prior?.revision ?? null,
              input,
              affectedFootprints: [{ domain: 'surfer.source.v2', predicate: sourceId }],
            },
            s.snapshot.context,
          );
        }
        sources.push({ sourceId, fingerprint: h.fingerprint, materialProof: current.proof });
      }
      const dependencies = [];
      for (const ref of capture.artifacts) {
        const r = state.stored.bindings.find((r) => surferDigest(r.artifact) === surferDigest(ref));
        if (!r)
          throw surferFailure(
            'v1/unregistered artifacts require explicit v2 recapture/revalidation.',
          );
        await state.checkRecord(r);
        if (immutableChain) {
          const a = (await state.core.readArtifact(ref, 'CURRENT', s.snapshot.context)).artifact;
          if (
            a.revision !== 1 ||
            a.kind !== 'EPISODE' ||
            a.origin !== 'EXPERIENCE' ||
            ![
              'surfer.chain-baseline.v1',
              'surfer.chain-observation.v1',
              'surfer.chain-qualification.v1',
            ].includes(a.domain)
          )
            throw surferFailure('Only immutable chain capsule domains may be inherited.');
        }
        dependencies.push({ artifact: ref, bindingDigest: r.digest });
      }
      const coreBasis = await state.core.captureBasis(
        {
          inputIds: sourceIds.map((id) => inputId(s, id)),
          artifacts: capture.artifacts,
          footprints,
        },
        s.snapshot.context,
      );
      const queries = [];
      for (const q of capture.queries)
        queries.push({ ...q, membershipDigest: await queryDigest(s, q) });
      const content = {
        schemaVersion: '2.0.0' as const,
        contract: 'surfer.source-binding.v2' as const,
        authority: authority(s),
        coreBasis,
        sources,
        queries,
        dependencies,
        readWatermark: {
          sourceSnapshotDigest: s.snapshot.digest,
          observedAt: s.snapshot.observedAt,
        },
      };
      const basis: SurferSourceBasisV2 = {
        ...content,
        contentDigest: sourceBindingContentDigestV2(content),
      };
      const issued = await s.bindingStore.transaction(s.snapshot.context.spaceId, (st) => {
        const existing = st.captures.find((c) => c.basis.contentDigest === basis.contentDigest);
        if (existing) {
          if (surferDigest(existing.basis) !== existing.receiptDigest)
            throw surferFailure('Capture receipt digest mismatch.');
          return existing.basis;
        }
        st.captures.push({ receiptDigest: surferDigest(basis), basis });
        st.sequence++;
        return basis;
      });
      await watermark(s);
      const knowledgeScope = await readSurferKnowledgeState(
        s.store,
        s.snapshot.context.spaceId,
        (st) => {
          const direct = coreBasis.inputs.map(
            (i) => st.inputs.find((x) => x.inputId === i.inputId)!.scope,
          );
          const inherited = coreBasis.artifacts.map(
            (ref) =>
              st.artifacts.find(
                (a) =>
                  a.artifactId === ref.artifactId &&
                  a.revision === ref.revision &&
                  a.digest === ref.digest,
              )!.scope,
          );
          const all = [...direct, ...inherited];
          return {
            spaceId: s.snapshot.context.spaceId,
            accessScope: [...new Set(all.flatMap((x) => x.accessScope))].sort(),
            sensitivity: all.reduce(
              (a, x) => (levels[x.sensitivity] > levels[a] ? x.sensitivity : a),
              'public' as keyof typeof levels,
            ),
          };
        },
      );
      return {
        basis: issued,
        knowledgeScope,
        materials: await Promise.all(
          sourceIds.map(async (id) => (await state.material(id)).material),
        ),
        readReceipt: receipt(s),
        metrics: structuredClone(s.metrics),
      };
    });
  }
  async execute(requestInput: unknown, envelopeInput: unknown) {
    assertSurferJson(envelopeInput);
    const envelope = structuredClone(envelopeInput) as {
      schemaVersion: string;
      command: unknown;
      basis: SurferSourceBasisV2 | null;
    };
    if (
      !envelope ||
      envelope.schemaVersion !== '2.0.0' ||
      Object.keys(envelope).sort().join(',') !== 'basis,command,schemaVersion'
    )
      throw surferFailure('Expected a separate v2 command envelope.');
    const command = decodeSurferKnowledgeCommand(envelope.command);
    if (command.action === 'OBSERVE_INPUT')
      throw surferFailure('Source inputs are owned by v2 capture.');
    return this.sessions.withSnapshotV2(decodeSurferSourceRequest(requestInput), async (s) => {
      owner(s);
      const state = await start(s);
      if (command.action === 'APPEND_ARTIFACT') {
        assertSurferSourceBasisV2(envelope.basis);
        await state.checkBasis(envelope.basis);
        if (surferDigest(command.draft.basis) !== surferDigest(envelope.basis.coreBasis))
          throw surferFailure('Draft must use the issued v2 core premises.');
        if (
          !['INTERPRETATION', 'CASE'].includes(command.draft.kind) &&
          !envelope.basis.queries.length &&
          !envelope.basis.dependencies.length
        )
          throw surferFailure(
            'Rules/derived results require declared query or inherited dependency scope.',
          );
      } else {
        if (envelope.basis !== null)
          throw surferFailure('Snapshot scope is inherited from registered v2 artifact bindings.');
        const priorOperation = await readSurferKnowledgeState(
          s.store,
          s.snapshot.context.spaceId,
          (st) => st.commands.some((c) => c.operationId === command.operationId),
        );
        if (!priorOperation && state.stored.activeSnapshotId !== command.expectedActiveSnapshotId)
          throw surferFailure('Active v2 snapshot changed before publication.');
        for (const ref of command.entries) {
          const record = state.stored.bindings.find(
            (r) => surferDigest(r.artifact) === surferDigest(ref),
          );
          if (!record)
            throw surferFailure('Snapshot mixes v1/unregistered content without v2 revalidation.');
          await state.checkRecord(record);
        }
      }
      const result =
        command.action === 'PUBLISH_SNAPSHOT'
          ? await state.core.appendDetachedSnapshotV2(command, s.snapshot.context)
          : await state.core.execute(command, s.snapshot.context);
      if (command.action === 'APPEND_ARTIFACT') {
        const artifact = {
            artifactId: result.commit.subjectId,
            revision: result.commit.revision,
            digest: result.commit.digest,
          },
          basis = envelope.basis!;
        const record: SurferBindingRecordV2 = {
          artifact,
          basis,
          digest: surferDigest({ artifact, contentDigest: basis.contentDigest }),
        };
        await s.bindingStore.transaction(s.snapshot.context.spaceId, (st) => {
          const existing = st.bindings.find(
            (r) => surferDigest(r.artifact) === surferDigest(artifact),
          );
          if (existing) {
            if (existing.digest !== record.digest)
              throw surferFailure(
                'Artifact revision already has different Source binding semantics.',
              );
            return;
          }
          st.bindings.push(record);
          st.sequence++;
        });
      } else {
        await s.bindingStore.transaction(s.snapshot.context.spaceId, (st) => {
          if (result.replayed) return; // old replay cannot reactivate a superseded snapshot
          if (st.activeSnapshotId !== command.expectedActiveSnapshotId)
            throw surferFailure('Active v2 snapshot CAS failed.');
          st.activeSnapshotId = command.snapshotId;
          st.sequence++;
        });
      }
      await watermark(s);
      return { ...result, readReceipt: receipt(s), metrics: structuredClone(s.metrics) };
    });
  }
  async readCurrentSnapshot(requestInput: unknown, snapshotId: string | null = null) {
    return this.sessions.withSnapshotV2(decodeSurferSourceRequest(requestInput), async (s) => {
      const state = await start(s);
      try {
        const selected = snapshotId ?? state.stored.activeSnapshotId;
        if (!selected) unavailable('No active v2 snapshot is available.');
        const coreResult = await state.core.readSnapshot(selected, 'CURRENT', s.snapshot.context);
        const result = { ...coreResult, isActive: selected === state.stored.activeSnapshotId };
        for (const artifact of result.artifacts) {
          const record = state.stored.bindings.find(
            (r) =>
              surferDigest(r.artifact) ===
              surferDigest({
                artifactId: artifact.artifactId,
                revision: artifact.revision,
                digest: artifact.digest,
              }),
          );
          if (!record) unavailable('Active snapshot contains v1/unregistered Source bindings.');
          await state.checkRecord(record);
        }
        await watermark(s);
        return {
          status: 'CURRENT' as const,
          result,
          readReceipt: receipt(s),
          metrics: structuredClone(s.metrics),
        };
      } catch (error) {
        if (
          error instanceof ShotgunError &&
          ['STALE_VERSION', 'POLICY_DENIED'].includes(error.code)
        )
          return {
            status: 'UNAVAILABLE' as const,
            reason: 'SOURCE_QUERY_OR_AUTHORITY_CHANGED' as const,
            readReceipt: receipt(s),
            metrics: structuredClone(s.metrics),
          };
        throw error;
      }
    });
  }
}
