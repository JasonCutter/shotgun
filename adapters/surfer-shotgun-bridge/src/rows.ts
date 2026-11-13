import { ShotgunError } from '../../../packages/contracts/src/errors.js';
import {
  surferDigest,
  surferFailure,
  assertSurferJson,
  type SurferScope,
} from '../../../packages/contracts/src/surfer-learning.js';
import { decodeSurferSourceRequest } from '../../../packages/contracts/src/surfer-source.js';
import {
  decodeSurferKnowledgeCommand,
  type SurferQueryFootprint,
} from '../../../packages/contracts/src/surfer-knowledge.js';
import {
  assertSurferSourceBasisV2,
  decodeSurferBindingCaptureV2,
  sourceBindingContentDigestV2,
  type SurferSourceBasisV2,
} from '../../../packages/contracts/src/surfer-source-binding-v2.js';
import type {
  SurferRowsSourceSession,
  SurferRowsSourceSessionsPort,
} from '../../../packages/contracts/src/surfer-source-rows.js';
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
async function start(s: SurferRowsSourceSession, write = false) {
  if (write) {
    owner(s);
    await s.core.initialize();
  }
  return sourceBindingValidator(s, {
    captureIssued: (b) => s.bindings.captureIssued(b),
    inputs: async (ids) => {
      const values = [];
      for (const id of ids) {
        const input = await s.core.lookupInput(id);
        if (input) values.push(input);
      }
      return values;
    },
    binding: (r) => s.bindings.binding(r),
    captureBasis: (r) => s.core.captureBasis(r),
    readCurrentArtifact: async (ref) => {
      const r = await s.core.readClosure({ artifacts: [ref] });
      if (!r.kernelCurrent) unavailable('Current row artifact premises changed.');
      return r;
    },
  });
}
/** Separate opt-in Source bridge. All proof/row/binding work shares the Source outer transaction. */
export class ShotgunSurferSourceRowsBridge {
  constructor(private readonly sessions: SurferRowsSourceSessionsPort) {}
  async capture(requestInput: unknown, captureInput: unknown) {
    return this.captureWithFootprints(requestInput, captureInput, []);
  }
  async captureRule(requestInput: unknown, captureInput: unknown) {
    const c = decodeSurferBindingCaptureV2(captureInput),
      ids = [...c.sourceIds].sort();
    if (
      !ids.length ||
      c.artifacts.length ||
      c.queries.length !== 1 ||
      c.queries[0]?.kind !== 'EXPLICIT_SOURCE_SET' ||
      surferDigest([...c.queries[0].sourceIds].sort()) !== surferDigest(ids)
    )
      throw surferFailure('A scoped row rule requires exactly its explicit training Source set.');
    return this.captureWithFootprints(requestInput, c, [
      { domain: 'surfer.scoped-rule-memory.v1', predicate: surferDigest({ sourceIds: ids }) },
    ]);
  }
  async captureChain(requestInput: unknown, captureInput: unknown) {
    const c = decodeSurferBindingCaptureV2(captureInput),
      ids = [...c.sourceIds].sort();
    if (
      !ids.length ||
      !c.artifacts.length ||
      c.artifacts.length > 32 ||
      c.queries.length !== 1 ||
      c.queries[0]?.kind !== 'EXPLICIT_SOURCE_SET' ||
      surferDigest([...c.queries[0].sourceIds].sort()) !== surferDigest(ids)
    )
      throw surferFailure(
        'Row chain capture requires explicit sources and bounded immutable capsules.',
      );
    return this.sessions.withRowsSnapshot(
      decodeSurferSourceRequest(requestInput),
      'WRITE',
      async (s) => {
        const state = await start(s, true);
        for (const ref of c.artifacts) {
          const record = await s.bindings.binding(ref);
          if (!record) unavailable('Row chain capsule is unregistered.');
          await state.checkRecord(record);
          const r = await s.core.readClosure({ artifacts: [ref] }),
            a = r.artifacts.find(
              (x) => x.artifactId === ref.artifactId && x.revision === ref.revision,
            );
          if (
            !r.kernelCurrent ||
            !a ||
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
        const bound: SurferRowsSourceSessionsPort = {
          withRowsSnapshot: async (r, _mode, apply) => {
            if (
              surferDigest(decodeSurferSourceRequest(r)) !==
              surferDigest(decodeSurferSourceRequest(requestInput))
            )
              throw surferFailure('Row chain actor changed.');
            return apply(s);
          },
        };
        return new ShotgunSurferSourceRowsBridge(bound).captureWithFootprints(requestInput, c, [
          { domain: 'surfer.scoped-rule-memory.v1', predicate: surferDigest({ sourceIds: ids }) },
        ]);
      },
    );
  }
  async withCurrentBasis<T>(
    requestInput: unknown,
    basisInput: unknown,
    apply: (view: {
      basis: SurferSourceBasisV2;
      materials: Awaited<ReturnType<SurferRowsSourceSession['readMaterialV2']>>['material'][];
      readReceipt: ReturnType<typeof receipt>;
    }) => T,
  ): Promise<T> {
    assertSurferSourceBasisV2(basisInput);
    const basis = structuredClone(basisInput);
    return this.sessions.withRowsSnapshot(
      decodeSurferSourceRequest(requestInput),
      'READ',
      async (s) => {
        const state = await start(s);
        await state.checkBasis(basis);
        const materials = [];
        for (const dep of basis.sources)
          materials.push((await state.material(dep.sourceId)).material);
        return structuredClone(apply({ basis, materials, readReceipt: receipt(s) }));
      },
    );
  }
  async readCurrentArtifact(
    requestInput: unknown,
    ref: Parameters<SurferRowsSourceSession['bindings']['binding']>[0],
  ) {
    return this.sessions.withRowsSnapshot(
      decodeSurferSourceRequest(requestInput),
      'READ',
      async (s) => {
        const state = await start(s),
          r = await s.core.readClosure({ artifacts: [ref] });
        if (!r.kernelCurrent) unavailable('Row memory is stale.');
        for (const a of r.artifacts) {
          const record = await s.bindings.binding({
            artifactId: a.artifactId,
            revision: a.revision,
            digest: a.digest,
          });
          if (!record) unavailable('Row memory lacks Source registration.');
          await state.checkRecord(record);
        }
        const artifact = r.artifacts.find(
          (a) => a.artifactId === ref.artifactId && a.revision === ref.revision,
        );
        if (!artifact) unavailable('Row artifact is unavailable.');
        return { artifact, readReceipt: receipt(s) };
      },
    );
  }
  private async captureWithFootprints(
    requestInput: unknown,
    captureInput: unknown,
    footprints: SurferQueryFootprint[],
  ) {
    const request = decodeSurferSourceRequest(requestInput),
      c = decodeSurferBindingCaptureV2(captureInput);
    return this.sessions.withRowsSnapshot(request, 'WRITE', async (s) => {
      const state = await start(s, true),
        sources = [],
        scopes: SurferScope[] = [];
      for (const sourceId of [...c.sourceIds].sort()) {
        const current = await state.material(sourceId),
          m = current.material,
          content = sourceInputContent(s, m),
          prior = await s.core.lookupInput(content.inputId);
        if (sourceInputChanged(prior, content)) {
          const input = { ...content, revision: (prior?.revision ?? 0) + 1 };
          await s.core.execute({
            action: 'OBSERVE_INPUT',
            operationId: `source-rows:${surferDigest(input)}`,
            expectedRevision: prior?.revision ?? null,
            input,
            affectedFootprints: [{ domain: 'surfer.source.v2', predicate: sourceId }],
          });
        }
        scopes.push(m.scope);
        sources.push({
          sourceId,
          fingerprint: s.snapshot.heads.find((h) => h.sourceId === sourceId)!.fingerprint,
          materialProof: current.proof,
        });
      }
      const dependencies = [];
      for (const ref of c.artifacts) {
        const record = await s.bindings.binding(ref);
        if (!record)
          throw surferFailure('Artifact requires explicit row Source capture/revalidation.');
        await state.checkRecord(record);
        dependencies.push({ artifact: ref, bindingDigest: record.digest });
        const current = await s.core.readClosure({ artifacts: [ref] });
        if (!current.kernelCurrent) unavailable('Row dependency is not current.');
        scopes.push(
          current.artifacts.find(
            (a) => a.artifactId === ref.artifactId && a.revision === ref.revision,
          )!.scope,
        );
      }
      const coreBasis = await s.core.captureBasis({
        inputIds: sources.map((x) => inputId(s, x.sourceId)),
        artifacts: c.artifacts,
        footprints,
      });
      const queries = [];
      for (const q of c.queries) queries.push({ ...q, membershipDigest: await queryDigest(s, q) });
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
      const issued = await s.bindings.issueCapture(basis);
      const knowledgeScope: SurferScope = {
        spaceId: s.snapshot.context.spaceId,
        accessScope: [...new Set(scopes.flatMap((x) => x.accessScope))].sort(),
        sensitivity: scopes.reduce(
          (a, x) => (levels[x.sensitivity] > levels[a] ? x.sensitivity : a),
          'public' as SurferScope['sensitivity'],
        ),
      };
      const materials = [];
      for (const x of sources) materials.push((await state.material(x.sourceId)).material);
      return {
        basis: issued,
        knowledgeScope,
        materials,
        readReceipt: { ...receipt(s), storageProfile: 'surfer.source-rows.v1' as const },
        metrics: structuredClone(s.metrics),
      };
    });
  }
  async execute(requestInput: unknown, envelopeInput: unknown) {
    assertSurferJson(envelopeInput);
    const e = structuredClone(envelopeInput) as {
      contract: string;
      schemaVersion: string;
      command: unknown;
      basis: SurferSourceBasisV2 | null;
    };
    if (
      !e ||
      e.contract !== 'surfer.source-rows.v1' ||
      e.schemaVersion !== '1.0.0' ||
      Object.keys(e).sort().join(',') !== 'basis,command,contract,schemaVersion'
    )
      throw surferFailure('Expected a separate row Source command envelope.');
    const c = decodeSurferKnowledgeCommand(e.command);
    if (c.action === 'OBSERVE_INPUT')
      throw surferFailure('Source inputs are owned by row capture.');
    return this.sessions.withRowsSnapshot(
      decodeSurferSourceRequest(requestInput),
      'WRITE',
      async (s) => {
        const state = await start(s, true);
        if (c.action === 'APPEND_ARTIFACT') {
          assertSurferSourceBasisV2(e.basis);
          await state.checkBasis(e.basis);
          if (surferDigest(c.draft.basis) !== surferDigest(e.basis.coreBasis))
            throw surferFailure('Draft must use issued row Source premises.');
          if (
            !['INTERPRETATION', 'CASE'].includes(c.draft.kind) &&
            !e.basis.queries.length &&
            !e.basis.dependencies.length
          )
            throw surferFailure('Derived row results require declared query/inherited scope.');
        } else {
          if (e.basis !== null)
            throw surferFailure('Row snapshots inherit registered Source bindings.');
          for (const ref of c.entries) {
            const r = await s.bindings.binding(ref);
            if (!r) unavailable('Snapshot contains unregistered row Source content.');
            await state.checkRecord(r);
          }
        }
        const result = await s.core.execute(c);
        if (c.action === 'APPEND_ARTIFACT') {
          const artifact = {
            artifactId: result.commit.subjectId,
            revision: result.commit.revision,
            digest: result.commit.digest,
          };
          await s.bindings.bind({
            artifact,
            basis: e.basis!,
            digest: surferDigest({ artifact, contentDigest: e.basis!.contentDigest }),
          });
        }
        return {
          ...result,
          readReceipt: { ...receipt(s), storageProfile: 'surfer.source-rows.v1' as const },
          metrics: structuredClone(s.metrics),
        };
      },
    );
  }
  async readCurrentSnapshot(requestInput: unknown, snapshotId: string | null = null) {
    return this.sessions.withRowsSnapshot(
      decodeSurferSourceRequest(requestInput),
      'READ',
      async (s) => {
        try {
          const state = await start(s),
            r = await s.core.readClosure({ snapshotId });
          if (!r.kernelCurrent || !r.snapshot) unavailable('Row snapshot premises changed.');
          for (const artifact of r.artifacts) {
            const record = await s.bindings.binding({
              artifactId: artifact.artifactId,
              revision: artifact.revision,
              digest: artifact.digest,
            });
            if (!record) unavailable('Current row snapshot lacks a Source binding.');
            await state.checkRecord(record);
          }
          return {
            status: 'CURRENT' as const,
            result: { ...r, sourceCurrentness: 'VERIFIED' as const },
            readReceipt: { ...receipt(s), storageProfile: 'surfer.source-rows.v1' as const },
            metrics: structuredClone(s.metrics),
          };
        } catch (error) {
          if (
            error instanceof ShotgunError &&
            ['STALE_VERSION', 'POLICY_DENIED', 'NOT_FOUND'].includes(error.code)
          )
            return {
              status: 'UNAVAILABLE' as const,
              reason: 'SOURCE_QUERY_OR_AUTHORITY_CHANGED' as const,
              readReceipt: { ...receipt(s), storageProfile: 'surfer.source-rows.v1' as const },
              metrics: structuredClone(s.metrics),
            };
          throw error;
        }
      },
    );
  }
}
