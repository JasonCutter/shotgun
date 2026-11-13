import { ShotgunError } from '../../../packages/contracts/src/errors.js';
import {
  decodeSurferAccessContext,
  type SurferAccessContext,
} from '../../../packages/contracts/src/surfer-experiment.js';
import {
  readSurferKnowledgeState,
  decodeSurferArtifactRef,
  decodeSurferKnowledgeCapture,
  decodeSurferKnowledgeCommand,
  type SurferArtifactRef,
  type SurferFootprintDependency,
  type SurferKnowledgeArtifact,
  type SurferKnowledgeBasis,
  type SurferKnowledgeCommand,
  type SurferKnowledgeCommit,
  type SurferKnowledgeCapture,
  type SurferKnowledgeSnapshot,
  type SurferKnowledgeState,
  type SurferKnowledgeStorePort,
  type SurferQueryFootprint,
} from '../../../packages/contracts/src/surfer-knowledge.js';
import {
  surferDigest,
  surferFailure,
  type SurferScope,
} from '../../../packages/contracts/src/surfer-learning.js';

import type {
  SurferKnowledgeLookupView,
  SurferKnowledgeTransition,
} from '../../../packages/contracts/src/surfer-knowledge-rows.js';

const sensitivities = { public: 0, internal: 1, private: 2, restricted: 3 };
const refOf = (a: SurferKnowledgeArtifact): SurferArtifactRef => ({
  artifactId: a.artifactId,
  revision: a.revision,
  digest: a.digest,
});
function denied(message = 'Current Surfer input/knowledge scope is not authorized.'): never {
  throw new ShotgunError({
    code: 'POLICY_DENIED',
    safeMessage: message,
    module: 'surfer.core',
    operation: 'authorize',
  });
}
function authorize(context: SurferAccessContext, scope: SurferScope): void {
  if (
    context.spaceId !== scope.spaceId ||
    !scope.accessScope.every((s) => context.accessScope.includes(s)) ||
    sensitivities[context.clearance] < sensitivities[scope.sensitivity]
  )
    denied();
}
function stale(reasons: readonly string[]): never {
  throw new ShotgunError({
    code: 'STALE_VERSION',
    safeMessage: `Surfer knowledge must be recomputed: ${[...new Set(reasons)].join(', ')}.`,
    module: 'surfer.core',
    operation: 'check-currentness',
  });
}
function conflict(message: string): never {
  throw new ShotgunError({
    code: 'REVISION_CONFLICT',
    safeMessage: message,
    module: 'surfer.core',
    operation: 'commit',
  });
}
function timestamp(value: string): void {
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)
    throw surferFailure('Invalid knowledge timestamp.');
}
function unique(values: readonly string[]): void {
  if (new Set(values).size !== values.length)
    throw surferFailure('Duplicate knowledge dependency/identity.');
}
function footprintKey(f: SurferQueryFootprint): string {
  return surferDigest({ domain: f.domain, predicate: f.predicate });
}
function epoch(state: SurferKnowledgeLookupView, domain: string, predicate: string): number {
  return state.epoch(domain, predicate);
}
function footprint(
  state: SurferKnowledgeLookupView,
  f: SurferQueryFootprint,
): SurferFootprintDependency {
  if (f.domain === '*' && f.predicate !== '*')
    throw surferFailure('Global footprint must use a wildcard predicate.');
  return {
    ...f,
    exactEpoch: epoch(state, f.domain, f.predicate),
    domainEpoch: epoch(state, f.domain, '*'),
    globalEpoch: epoch(state, '*', '*'),
  };
}
function currentInput(state: SurferKnowledgeLookupView, id: string, context: SurferAccessContext) {
  const input = state.input(id);
  if (!input || input.retired)
    denied('A required input is missing or retired; derived payload is unavailable.');
  authorize(context, input.scope);
  return input;
}
function head(state: SurferKnowledgeLookupView, id: string) {
  return state.head(id);
}
function storedArtifact(state: SurferKnowledgeLookupView, ref: SurferArtifactRef) {
  const artifact = state.artifact(ref);
  if (!artifact || artifact.digest !== ref.digest)
    throw surferFailure('Knowledge revision/digest does not exist.');
  const { digest, ...content } = artifact;
  if (surferDigest(content) !== digest)
    throw surferFailure('Stored knowledge artifact digest is corrupt.');
  return artifact;
}
function basisStatus(
  state: SurferKnowledgeLookupView,
  basis: SurferKnowledgeBasis,
  context: SurferAccessContext,
  allowRetired = false,
): string[] {
  if (basis.spaceId !== context.spaceId) denied();
  const reasons: string[] = [];
  if (basis.authorityEpoch !== state.authorityEpoch) reasons.push('AUTHORITY_CHANGED');
  for (const ref of basis.inputs) {
    const input = allowRetired
      ? state.input(ref.inputId)
      : currentInput(state, ref.inputId, context);
    if (!input) denied();
    authorize(context, input.scope);
    if (input.retired) reasons.push('INPUT_RETIRED');
    if (input.revision !== ref.revision || surferDigest(input) !== ref.digest)
      reasons.push('INPUT_CHANGED');
  }
  for (const dep of basis.footprints) {
    if (surferDigest(footprint(state, dep)) !== surferDigest(dep))
      reasons.push('QUERY_FOOTPRINT_CHANGED');
  }
  return reasons;
}
export function inspectKnowledgeView(
  state: SurferKnowledgeLookupView,
  refs: readonly SurferArtifactRef[],
  context: SurferAccessContext,
  allowRetired = false,
) {
  const artifacts: SurferKnowledgeArtifact[] = [],
    reasons: string[] = [],
    visited = new Set<string>(),
    visiting = new Set<string>();
  function visit(ref: SurferArtifactRef, depth: number) {
    if (depth > 128)
      throw surferFailure('Knowledge dependency traversal requires a larger execution profile.');
    const key = surferDigest(ref);
    if (visiting.has(key)) throw surferFailure('Knowledge dependency cycle detected.');
    if (visited.has(key)) return;
    visiting.add(key);
    const artifact = storedArtifact(state, ref);
    authorize(context, artifact.scope);
    if (head(state, artifact.artifactId)?.digest !== artifact.digest)
      reasons.push('ARTIFACT_HEAD_CHANGED');
    reasons.push(...basisStatus(state, artifact.basis, context, allowRetired));
    for (const dependency of artifact.basis.artifacts) visit(dependency, depth + 1);
    artifacts.push(artifact);
    visiting.delete(key);
    visited.add(key);
  }
  for (const ref of refs) visit(ref, 0);
  return { artifacts, reasons: [...new Set(reasons)] };
}
function scopeMustContain(scope: SurferScope, dependency: SurferScope): void {
  if (
    scope.spaceId !== dependency.spaceId ||
    !dependency.accessScope.every((p) => scope.accessScope.includes(p)) ||
    sensitivities[scope.sensitivity] < sensitivities[dependency.sensitivity]
  )
    denied('Derived knowledge cannot broaden its input access scope.');
}
function authorizeCommand(
  state: SurferKnowledgeLookupView,
  command: SurferKnowledgeCommand,
  context: SurferAccessContext,
): void {
  if (state.spaceId !== context.spaceId) denied();
  if (command.action === 'OBSERVE_INPUT') {
    authorize(context, command.input.scope);
    const existing = state.input(command.input.inputId);
    if (existing) authorize(context, existing.scope);
  } else if (command.action === 'APPEND_ARTIFACT') {
    authorize(context, command.draft.scope);
    basisStatus(state, command.draft.basis, context);
    inspectKnowledgeView(state, command.draft.basis.artifacts, context);
    const priorRef = head(state, command.draft.artifactId);
    const prior = priorRef ? storedArtifact(state, priorRef) : undefined;
    if (prior) {
      authorize(context, prior.scope);
      inspectKnowledgeView(state, [refOf(prior)], context, true);
    }
  } else inspectKnowledgeView(state, command.entries, context);
}
function validateDraft(
  state: SurferKnowledgeLookupView,
  command: Extract<SurferKnowledgeCommand, { action: 'APPEND_ARTIFACT' }>,
  context: SurferAccessContext,
) {
  const draft = command.draft;
  const origins = {
    INTERPRETATION: 'INTERPRETATION',
    CASE: 'INTERPRETATION',
    HYPOTHESIS: 'INDUCTION',
    RULE: 'INDUCTION',
    PROCEDURE: 'EXPERIENCE',
    EPISODE: 'EXPERIENCE',
    FAILURE: 'EXPERIENCE',
    DERIVATION: 'DERIVATION',
    ENGINE_CANDIDATE: 'ENGINE_CANDIDATE',
  };
  if (draft.origin !== origins[draft.kind])
    throw surferFailure('Artifact kind/origin mismatch; source authority cannot be injected.');
  timestamp(draft.createdAt);
  timestamp(draft.observedAt);
  if (draft.validTime) {
    timestamp(draft.validTime.from);
    if (draft.validTime.to) {
      timestamp(draft.validTime.to);
      if (draft.validTime.to < draft.validTime.from)
        throw surferFailure('Invalid knowledge valid-time interval.');
    }
  }
  unique(draft.basis.inputs.map((i) => i.inputId));
  unique(draft.basis.artifacts.map((a) => a.artifactId));
  unique(draft.basis.footprints.map(footprintKey));
  if (
    ['HYPOTHESIS', 'RULE'].includes(draft.kind) &&
    !draft.basis.footprints.some((f) => f.domain === draft.domain || f.domain === '*')
  )
    throw surferFailure('Learned hypotheses/rules require a scoped new-evidence footprint.');
  const dependencies = inspectKnowledgeView(state, draft.basis.artifacts, context);
  const reasons = [...basisStatus(state, draft.basis, context), ...dependencies.reasons];
  if (reasons.length) stale(reasons);
  if (dependencies.artifacts.some((a) => a.artifactId === draft.artifactId))
    throw surferFailure('Knowledge revision would form a dependency cycle.');
  const priorRef = head(state, draft.artifactId);
  const prior = priorRef ? storedArtifact(state, priorRef) : undefined;
  if (
    (prior?.revision ?? null) !== command.expectedRevision ||
    draft.revision !== (prior?.revision ?? 0) + 1
  )
    conflict('Artifact head changed or revision is not consecutive.');
  if (
    prior &&
    (prior.kind !== draft.kind || prior.origin !== draft.origin || prior.domain !== draft.domain)
  )
    throw surferFailure('Stable artifact identity cannot change kind/origin/domain.');
  // Revisions may strengthen their own scope, but cannot reopen an earlier private payload under the same identity.
  if (prior) scopeMustContain(draft.scope, prior.scope);
  const inputs = draft.basis.inputs.map((ref) => currentInput(state, ref.inputId, context));
  for (const dep of [...inputs, ...dependencies.artifacts])
    scopeMustContain(draft.scope, dep.scope);
  const witnesses = [
    ...inputs.flatMap((i) => i.witnesses),
    ...dependencies.artifacts.flatMap((a) => a.rootWitnesses),
  ];
  const rootWitnesses = [...new Map(witnesses.map((w) => [surferDigest(w), w])).entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, w]) => w);
  if (!rootWitnesses.length && draft.kind !== 'ENGINE_CANDIDATE')
    throw surferFailure('This document-learning slice requires a root source witness.');
  const content = { ...draft, rootWitnesses, semanticAssessment: 'NOT_EVALUATED' as const };
  return { ...content, digest: surferDigest(content) };
}

/** Full aggregate adapter, distinct from a bounded row lookup view. */
export function knowledgeStateView(state: SurferKnowledgeState): SurferKnowledgeLookupView {
  return {
    spaceId: state.spaceId,
    sequence: state.sequence,
    authorityEpoch: state.authorityEpoch,
    activeSnapshotId: state.activeSnapshotId,
    input: (id) => state.inputs.find((x) => x.inputId === id),
    artifact: (ref) =>
      state.artifacts.find((x) => x.artifactId === ref.artifactId && x.revision === ref.revision),
    head: (id) => {
      const a = state.artifacts
        .filter((x) => x.artifactId === id)
        .sort((a, b) => b.revision - a.revision)[0];
      return a ? refOf(a) : undefined;
    },
    epoch: (domain, predicate) =>
      state.epochs.find((x) => x.domain === domain && x.predicate === predicate)?.epoch ?? 0,
    receipt: (id) => state.commands.find((x) => x.operationId === id),
    snapshot: (id) => state.snapshots.find((x) => x.snapshotId === id),
  };
}
/** Pure transition shared by full-state and row owners. Does not mutate the lookup view. */
export function prepareKnowledgeTransition(
  state: SurferKnowledgeLookupView,
  command: SurferKnowledgeCommand,
  context: SurferAccessContext,
  detachedV2 = false,
): SurferKnowledgeTransition {
  authorizeCommand(state, command, context);
  const meaningDigest = surferDigest(
    detachedV2 ? { contract: 'detached-source-binding-v2', command } : command,
  );
  const existing = state.receipt(command.operationId);
  if (existing) {
    if (existing.meaningDigest !== meaningDigest)
      throw surferFailure('Knowledge operation ID was reused with different input.');
    return { result: { commit: existing.commit, replayed: true }, epochs: [] };
  }
  const sequence = state.sequence + 1;
  if (!Number.isSafeInteger(sequence))
    throw surferFailure('Knowledge sequence exhausted its storage profile.');
  const patch: Omit<SurferKnowledgeTransition, 'result'> = { epochs: [] };
  let commit: SurferKnowledgeCommit;
  if (command.action === 'OBSERVE_INPUT') {
    const input = command.input;
    timestamp(input.observedAt);
    const prior = state.input(input.inputId);
    if (
      (prior?.revision ?? null) !== command.expectedRevision ||
      input.revision !== (prior?.revision ?? 0) + 1
    )
      conflict('Input head changed or revision is not consecutive.');
    if (
      prior &&
      (prior.kind !== input.kind ||
        (prior.kind === 'SOURCE' && prior.witnesses[0]?.sourceId !== input.witnesses[0]?.sourceId))
    )
      throw surferFailure('Stable input identity changed.');
    if (prior?.retired && !input.retired)
      throw surferFailure(
        'Retired input identities cannot be resurrected; use a new input identity.',
      );
    if (input.kind === 'SOURCE') {
      if (
        !input.witnesses.length ||
        input.witnesses.some(
          (w) =>
            w.materialDigest !== input.contentDigest ||
            w.sourceId !== input.witnesses[0]!.sourceId ||
            w.sourceVersionId !== input.witnesses[0]!.sourceVersionId,
        )
      )
        throw surferFailure('Source input witness/version/material digest mismatch.');
    } else if (input.witnesses.length)
      throw surferFailure('Non-source inputs cannot inject source witnesses.');
    for (const f of command.affectedFootprints) {
      footprint(state, f);
      patch.epochs.push({ ...f, epoch: sequence });
    }
    patch.input = input;
    if (input.kind === 'ACCESS' || input.kind === 'POLICY') patch.authorityEpoch = sequence;
    commit = {
      operationId: command.operationId,
      sequence,
      subjectKind: 'INPUT',
      subjectId: input.inputId,
      revision: input.revision,
      digest: surferDigest(input),
    };
  } else if (command.action === 'APPEND_ARTIFACT') {
    const artifact = validateDraft(state, command, context);
    patch.artifact = artifact;
    commit = {
      operationId: command.operationId,
      sequence,
      subjectKind: 'ARTIFACT',
      subjectId: artifact.artifactId,
      revision: artifact.revision,
      digest: artifact.digest,
    };
  } else {
    timestamp(command.createdAt);
    unique(command.entries.map((ref) => ref.artifactId));
    if (!detachedV2 && state.activeSnapshotId !== command.expectedActiveSnapshotId)
      conflict('Active snapshot changed before publication.');
    if (state.snapshot(command.snapshotId)) conflict('Snapshot identity already exists.');
    const check = inspectKnowledgeView(state, command.entries, context);
    if (check.reasons.length) stale(check.reasons);
    const closure = check.artifacts
      .map(refOf)
      .sort((a, b) =>
        a.artifactId < b.artifactId
          ? -1
          : a.artifactId > b.artifactId
            ? 1
            : a.revision - b.revision,
      );
    const content = {
      schemaVersion: '1.0.0' as const,
      snapshotId: command.snapshotId,
      spaceId: context.spaceId,
      sequence,
      createdAt: command.createdAt,
      engineRevision: command.engineRevision,
      entries: command.entries,
      closure,
      semanticAssessment: 'NOT_EVALUATED' as const,
    };
    const snapshot = { ...content, digest: surferDigest(content) };
    patch.snapshot = snapshot;
    if (!detachedV2) patch.activeSnapshotId = snapshot.snapshotId;
    commit = {
      operationId: command.operationId,
      sequence,
      subjectKind: 'SNAPSHOT',
      subjectId: snapshot.snapshotId,
      revision: 1,
      digest: snapshot.digest,
    };
  }
  patch.command = { operationId: command.operationId, meaningDigest, commit };
  return { ...patch, result: { commit, replayed: false } };
}
export function applyKnowledgeTransition(
  state: SurferKnowledgeState,
  patch: SurferKnowledgeTransition,
): void {
  if (patch.result.replayed) return;
  if (patch.input)
    state.inputs = [...state.inputs.filter((x) => x.inputId !== patch.input!.inputId), patch.input];
  if (patch.artifact) state.artifacts.push(patch.artifact);
  if (patch.snapshot) state.snapshots.push(patch.snapshot);
  for (const e of patch.epochs) {
    const old = state.epochs.find((x) => x.domain === e.domain && x.predicate === e.predicate);
    if (old) old.epoch = e.epoch;
    else state.epochs.push(e);
  }
  if (patch.authorityEpoch !== undefined) state.authorityEpoch = patch.authorityEpoch;
  if (patch.activeSnapshotId !== undefined) state.activeSnapshotId = patch.activeSnapshotId;
  state.sequence = patch.result.commit.sequence;
  state.commands.push(patch.command!);
}

export function captureKnowledgeView(
  view: SurferKnowledgeLookupView,
  request: SurferKnowledgeCapture,
  context: SurferAccessContext,
): SurferKnowledgeBasis {
  unique(request.artifacts.map((r) => r.artifactId));
  unique(request.footprints.map(footprintKey));
  const check = inspectKnowledgeView(view, request.artifacts, context);
  if (check.reasons.length) stale(check.reasons);
  return {
    spaceId: context.spaceId,
    authorityEpoch: view.authorityEpoch,
    inputs: request.inputIds.map((id) => {
      const input = currentInput(view, id, context);
      return { inputId: id, revision: input.revision, digest: surferDigest(input) };
    }),
    artifacts: request.artifacts,
    footprints: request.footprints.map((f) => footprint(view, f)),
  };
}
export function inspectKnowledgeSnapshot(
  view: SurferKnowledgeLookupView,
  snapshot: SurferKnowledgeSnapshot,
  context: SurferAccessContext,
) {
  const { digest, ...content } = snapshot;
  if (surferDigest(content) !== digest) throw surferFailure('Stored snapshot digest is corrupt.');
  const check = inspectKnowledgeView(view, snapshot.entries, context);
  if (
    surferDigest(
      check.artifacts
        .map(refOf)
        .sort((a, b) =>
          a.artifactId < b.artifactId
            ? -1
            : a.artifactId > b.artifactId
              ? 1
              : a.revision - b.revision,
        ),
    ) !== surferDigest(snapshot.closure)
  )
    throw surferFailure('Snapshot dependency closure changed.');

  return check;
}

/** This owner stores revisions and selects snapshots; it does not certify opaque content as Fact. */
export class SurferKnowledgeService {
  constructor(private readonly store: SurferKnowledgeStorePort) {}

  async execute(
    commandInput: unknown,
    contextInput: unknown,
  ): Promise<{ commit: SurferKnowledgeCommit; replayed: boolean }> {
    return this.executeInternal(commandInput, contextInput, false);
  }
  /** New trusted-owner path: v2 sidecar owns its own active pointer/CAS. v1 semantics remain unchanged. */
  async appendDetachedSnapshotV2(commandInput: unknown, contextInput: unknown) {
    if (decodeSurferKnowledgeCommand(commandInput).action !== 'PUBLISH_SNAPSHOT')
      throw surferFailure('Detached v2 publication requires a snapshot command.');
    return this.executeInternal(commandInput, contextInput, true);
  }
  private async executeInternal(
    commandInput: unknown,
    contextInput: unknown,
    detachedV2: boolean,
  ): Promise<{ commit: SurferKnowledgeCommit; replayed: boolean }> {
    const command = decodeSurferKnowledgeCommand(commandInput),
      context = decodeSurferAccessContext(contextInput);
    return this.store.transaction(context.spaceId, (state) => {
      const patch = prepareKnowledgeTransition(
        knowledgeStateView(state),
        command,
        context,
        detachedV2,
      );
      applyKnowledgeTransition(state, patch);
      return patch.result;
    });
  }

  async captureBasis(requestInput: unknown, contextInput: unknown): Promise<SurferKnowledgeBasis> {
    const request = decodeSurferKnowledgeCapture(requestInput),
      context = decodeSurferAccessContext(contextInput);
    return readSurferKnowledgeState(this.store, context.spaceId, (state) => {
      return captureKnowledgeView(knowledgeStateView(state), request, context);
    });
  }

  async readArtifact(refInput: unknown, mode: 'CURRENT' | 'HISTORICAL', contextInput: unknown) {
    const ref = decodeSurferArtifactRef(refInput),
      context = decodeSurferAccessContext(contextInput);
    if (!['CURRENT', 'HISTORICAL'].includes(mode))
      throw surferFailure('Unknown knowledge read mode.');
    return readSurferKnowledgeState(this.store, context.spaceId, (state) => {
      const check = inspectKnowledgeView(knowledgeStateView(state), [ref], context);
      if (mode === 'CURRENT' && check.reasons.length) stale(check.reasons);
      return {
        artifact: storedArtifact(knowledgeStateView(state), ref),
        isCurrent: check.reasons.length === 0,
        staleReasons: check.reasons,
      };
    });
  }

  async readSnapshot(
    snapshotId: string | null,
    mode: 'CURRENT' | 'HISTORICAL',
    contextInput: unknown,
  ) {
    const context = decodeSurferAccessContext(contextInput);
    if (
      !['CURRENT', 'HISTORICAL'].includes(mode) ||
      (snapshotId !== null && (typeof snapshotId !== 'string' || !snapshotId.length))
    )
      throw surferFailure('Unknown snapshot read request.');
    return readSurferKnowledgeState(this.store, context.spaceId, (state) => {
      const snapshot = state.snapshots.find(
        (s) => s.snapshotId === (snapshotId ?? state.activeSnapshotId),
      );
      if (!snapshot)
        throw new ShotgunError({
          code: 'NOT_FOUND',
          safeMessage: 'Surfer snapshot is not available.',
          module: 'surfer.core',
          operation: 'read-snapshot',
        });
      const check = inspectKnowledgeSnapshot(knowledgeStateView(state), snapshot, context);
      if (mode === 'CURRENT' && check.reasons.length) stale(check.reasons);
      return {
        snapshot,
        artifacts: check.artifacts,
        isCurrent: check.reasons.length === 0,
        isActive: state.activeSnapshotId === snapshot.snapshotId,
        staleReasons: check.reasons,
      };
    });
  }
}

export * from './cognition.js';
export * from './structure.js';
