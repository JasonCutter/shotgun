import { SurferKnowledgeService } from '../../../modules/surfer-core/src/index.js';
import { ShotgunError } from '../../../packages/contracts/src/errors.js';
import {
  decodeSurferKnowledgeCommand,
  type SurferKnowledgeInput,
  type SurferKnowledgeState,
} from '../../../packages/contracts/src/surfer-knowledge.js';
import {
  decodeSurferSourceRequest,
  type SurferSourceHead,
  type SurferSourceMaterial,
  type SurferSourceSession,
  type SurferSourceSessionPort,
} from '../../../packages/contracts/src/surfer-source.js';
import { surferDigest, surferFailure } from '../../../packages/contracts/src/surfer-learning.js';

const catalogueId = (s: SurferSourceSession) =>
  `shotgun-catalogue:${surferDigest({ projectId: s.snapshot.projectId, principalId: s.snapshot.principalId })}`;
const materialId = (s: SurferSourceSession, h: SurferSourceHead) =>
  `shotgun-material:${surferDigest({ projectId: s.snapshot.projectId, epoch: s.snapshot.knowledgeEpoch, sourceId: h.sourceId, sourceVersionId: h.sourceVersionId, revisionId: h.revisionId })}`;
const levels = { public: 0, internal: 1, private: 2, restricted: 3 };
function requireOwner(s: SurferSourceSession): void {
  if (!s.snapshot.canSynchronize)
    throw new ShotgunError({
      code: 'POLICY_DENIED',
      safeMessage: 'Source bridge synchronization requires the server-bound Project owner.',
      module: 'surfer.bridge',
      operation: 'synchronize',
    });
}
async function synchronize(s: SurferSourceSession) {
  requireOwner(s);
  const context = s.snapshot.context,
    core = new SurferKnowledgeService(s.store);
  async function upsert(input: Omit<SurferKnowledgeInput, 'revision'>) {
    const prior = await s.store.transaction(context.spaceId, (state) =>
      state.inputs.find((i) => i.inputId === input.inputId),
    );
    if (prior) {
      const { revision: _revision, ...content } = prior;
      const { observedAt: _seen, ...priorMeaning } = content;
      const { observedAt: _now, ...nextMeaning } = input;
      if (surferDigest(priorMeaning) === surferDigest(nextMeaning)) return;
    }
    const value = { ...input, revision: (prior?.revision ?? 0) + 1 };
    await core.execute(
      {
        action: 'OBSERVE_INPUT',
        operationId: `source-observe:${surferDigest(value)}`,
        expectedRevision: prior?.revision ?? null,
        input: value,
        affectedFootprints: [{ domain: '*', predicate: '*' }],
      },
      context,
    );
  }
  const materials = new Map<string, SurferSourceMaterial>();
  const activeIds = new Set<string>();
  for (const h of s.snapshot.heads) {
    if (h.readiness !== 'INDEXED') continue;
    const m = await s.readMaterial(h.sourceId);
    materials.set(h.sourceId, m);
    const inputId = materialId(s, h);
    activeIds.add(inputId);
    await upsert({
      inputId,
      kind: 'SOURCE',
      scope: m.scope,
      contentDigest: m.sourceContentHash,
      observedAt: h.observedAt,
      retired: false,
      witnesses: [
        {
          sourceId: m.sourceId,
          sourceVersionId: m.sourceVersionId,
          evidenceId: m.rootEvidenceId,
          materialDigest: m.sourceContentHash,
        },
      ],
    });
  }
  const previous = await s.store.transaction(context.spaceId, (state) =>
    state.inputs.filter(
      (i) => i.inputId.startsWith('shotgun-material:') && !i.retired && !activeIds.has(i.inputId),
    ),
  );
  for (const prior of previous) {
    // A caller that lost access cannot read/write the private old input; current source guards still deny its payload.
    if (
      !prior.scope.accessScope.every((p) => context.accessScope.includes(p)) ||
      levels[context.clearance] < levels[prior.scope.sensitivity]
    )
      continue;
    const { revision: _revision, ...content } = prior;
    await upsert({ ...content, retired: true });
  }
  await upsert({
    inputId: catalogueId(s),
    kind: 'DATASET',
    contentDigest: s.snapshot.digest,
    scope: {
      spaceId: context.spaceId,
      accessScope: context.accessScope,
      sensitivity: context.clearance,
    },
    observedAt: s.snapshot.observedAt,
    retired: false,
    witnesses: [],
  });
  const basisInputs = await s.store.transaction(context.spaceId, (state) =>
    state.inputs.filter((i) => i.inputId === catalogueId(s)),
  );
  const catalogue = basisInputs[0];
  if (!catalogue) throw surferFailure('Source catalogue was not committed.');
  return { core, context, materials, activeIds, catalogue };
}
function assertBound(
  state: SurferKnowledgeState,
  artifact: {
    basis: { inputs: readonly { inputId: string; revision: number; digest: string }[] };
    rootWitnesses: readonly {
      sourceId: string;
      sourceVersionId: string;
      evidenceId: string;
      materialDigest: string;
    }[];
  },
  s: SurferSourceSession,
  sync: Awaited<ReturnType<typeof synchronize>>,
): void {
  const catalogue = artifact.basis.inputs.find((i) => i.inputId === sync.catalogue.inputId);
  if (
    !catalogue ||
    catalogue.revision !== sync.catalogue.revision ||
    catalogue.digest !== surferDigest(sync.catalogue)
  )
    throw new ShotgunError({
      code: 'STALE_VERSION',
      safeMessage: 'Knowledge is not bound to the current Source catalogue.',
      module: 'surfer.bridge',
      operation: 'check-source-binding',
    });
  for (const ref of artifact.basis.inputs) {
    const input = state.inputs.find((i) => i.inputId === ref.inputId);
    if (input?.kind === 'SOURCE' && !sync.activeIds.has(ref.inputId))
      throw surferFailure('Knowledge source is outside the active Source generation.');
  }
  for (const witness of artifact.rootWitnesses) {
    const m = sync.materials.get(witness.sourceId);
    if (
      !m ||
      m.sourceVersionId !== witness.sourceVersionId ||
      m.sourceContentHash !== witness.materialDigest ||
      !m.evidence.some((e) => e.evidenceId === witness.evidenceId)
    )
      throw new ShotgunError({
        code: 'POLICY_DENIED',
        safeMessage: 'Current Source witness is unavailable or inaccessible.',
        module: 'surfer.bridge',
        operation: 'check-witness',
      });
  }
  if (state.spaceId !== s.snapshot.projectId)
    throw surferFailure('Source/knowledge space mismatch.');
}

/** Composition adapter: every public operation opens a new authoritative Source snapshot. */
export class ShotgunSurferSourceBridge {
  constructor(private readonly sessions: SurferSourceSessionPort) {}

  async synchronize(requestInput: unknown) {
    return this.sessions.withSnapshot(decodeSurferSourceRequest(requestInput), async (s) => {
      const sync = await synchronize(s);
      return {
        sourceSnapshotDigest: s.snapshot.digest,
        knowledgeEpoch: s.snapshot.knowledgeEpoch,
        coverage: s.snapshot.coverage,
        catalogueInputId: sync.catalogue.inputId,
        catalogueRevision: sync.catalogue.revision,
      };
    });
  }
  async captureMaterial(requestInput: unknown, sourceId: string) {
    return this.sessions.withSnapshot(decodeSurferSourceRequest(requestInput), async (s) => {
      const sync = await synchronize(s),
        h = s.snapshot.heads.find((h) => h.sourceId === sourceId),
        material = sync.materials.get(sourceId);
      if (!h || !material) throw surferFailure('Requested Source is not usable material.');
      const basis = await sync.core.captureBasis(
        {
          inputIds: [sync.catalogue.inputId, materialId(s, h)],
          artifacts: [],
          footprints: [{ domain: '*', predicate: '*' }],
        },
        sync.context,
      );
      const knowledgeScope = {
        spaceId: sync.context.spaceId,
        accessScope: [
          ...new Set([...material.scope.accessScope, ...sync.catalogue.scope.accessScope]),
        ].sort(),
        sensitivity:
          levels[material.scope.sensitivity] > levels[sync.catalogue.scope.sensitivity]
            ? material.scope.sensitivity
            : sync.catalogue.scope.sensitivity,
      };
      return {
        material,
        basis,
        knowledgeScope,
        sourceSnapshotDigest: s.snapshot.digest,
        sourceObservedAt: s.snapshot.observedAt,
        consistency: s.snapshot.consistency,
      };
    });
  }
  async execute(requestInput: unknown, commandInput: unknown) {
    const command = decodeSurferKnowledgeCommand(commandInput);
    if (command.action === 'OBSERVE_INPUT')
      throw surferFailure('Source heads are owned by the bridge, not its caller.');
    return this.sessions.withSnapshot(decodeSurferSourceRequest(requestInput), async (s) => {
      const sync = await synchronize(s);
      if (command.action === 'APPEND_ARTIFACT') {
        const ref = command.draft.basis.inputs.find((i) => i.inputId === sync.catalogue.inputId);
        if (
          !ref ||
          ref.revision !== sync.catalogue.revision ||
          ref.digest !== surferDigest(sync.catalogue)
        )
          throw new ShotgunError({
            code: 'STALE_VERSION',
            safeMessage: 'Draft was computed against a different Source snapshot.',
            module: 'surfer.bridge',
            operation: 'append',
          });
      }
      const result = await sync.core.execute(command, sync.context);
      if (command.action === 'APPEND_ARTIFACT') {
        const stored = await sync.core.readArtifact(
          {
            artifactId: result.commit.subjectId,
            revision: result.commit.revision,
            digest: result.commit.digest,
          },
          'CURRENT',
          sync.context,
        );
        await s.store.transaction(sync.context.spaceId, (state) =>
          assertBound(state, stored.artifact, s, sync),
        );
      } else {
        const stored = await sync.core.readSnapshot(command.snapshotId, 'CURRENT', sync.context);
        await s.store.transaction(sync.context.spaceId, (state) => {
          for (const a of stored.artifacts) assertBound(state, a, s, sync);
        });
      }
      return {
        ...result,
        sourceSnapshotDigest: s.snapshot.digest,
        sourceObservedAt: s.snapshot.observedAt,
        consistency: s.snapshot.consistency,
      };
    });
  }
  async readCurrentSnapshot(requestInput: unknown, snapshotId: string | null = null) {
    return this.sessions.withSnapshot(decodeSurferSourceRequest(requestInput), async (s) => {
      const sync = await synchronize(s);
      try {
        const result = await sync.core.readSnapshot(snapshotId, 'CURRENT', sync.context);
        await s.store.transaction(sync.context.spaceId, (state) => {
          for (const a of result.artifacts) assertBound(state, a, s, sync);
        });
        return {
          status: 'CURRENT' as const,
          result,
          sourceSnapshotDigest: s.snapshot.digest,
          sourceObservedAt: s.snapshot.observedAt,
          consistency: s.snapshot.consistency,
        };
      } catch (error) {
        if (
          error instanceof ShotgunError &&
          ['STALE_VERSION', 'POLICY_DENIED'].includes(error.code)
        )
          return {
            status: 'UNAVAILABLE' as const,
            reason: 'SOURCE_OR_ACCESS_CHANGED' as const,
            sourceSnapshotDigest: s.snapshot.digest,
            sourceObservedAt: s.snapshot.observedAt,
            consistency: s.snapshot.consistency,
          };
        throw error;
      }
    });
  }
}

export * from './v2.js';

export * from './cognition.js';
export * from './provider.js';
export * from './model-inspection.js';
