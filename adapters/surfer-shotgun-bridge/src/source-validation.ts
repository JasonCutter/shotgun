import { ShotgunError } from '../../../packages/contracts/src/errors.js';
import { surferDigest, surferFailure } from '../../../packages/contracts/src/surfer-learning.js';
import type {
  SurferArtifactRef,
  SurferKnowledgeBasis,
  SurferKnowledgeInput,
  SurferKnowledgeCapture,
} from '../../../packages/contracts/src/surfer-knowledge.js';
import type { SurferSourceMaterial } from '../../../packages/contracts/src/surfer-source.js';
import {
  assertSurferSourceBasisV2,
  decodeSurferBindingCaptureV2,
  type SurferSourceBasisV2,
  type SurferBindingRecordV2,
  type SurferSourceSessionV2,
  type SurferQuerySelectionV2,
} from '../../../packages/contracts/src/surfer-source-binding-v2.js';
export type SurferSourceValidationSession = Pick<
  SurferSourceSessionV2,
  'snapshot' | 'readMaterialV2' | 'readContentProofV2' | 'metrics'
>;
export type SurferSourceValidationBackend = {
  captureIssued(basis: SurferSourceBasisV2): Promise<boolean>;
  inputs(ids: string[]): Promise<readonly SurferKnowledgeInput[]>;
  binding(ref: SurferArtifactRef): Promise<SurferBindingRecordV2 | undefined>;
  captureBasis(request: SurferKnowledgeCapture): Promise<SurferKnowledgeBasis>;
  readCurrentArtifact(ref: SurferArtifactRef): Promise<unknown>;
};
/** Same Source-owned premise construction for aggregate-v2 and row profiles. */
export function sourceInputContent(
  s: SurferSourceValidationSession,
  m: SurferSourceMaterial,
): Omit<SurferKnowledgeInput, 'revision'> {
  const h = s.snapshot.heads.find((h) => h.sourceId === m.sourceId);
  if (!h || h.readiness !== 'INDEXED') unavailable('Current Source head is unavailable.');
  return {
    inputId: inputId(s, m.sourceId),
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
  };
}
export function sourceInputChanged(
  prior: SurferKnowledgeInput | undefined,
  content: Omit<SurferKnowledgeInput, 'revision'>,
): boolean {
  const { observedAt: _time, ...meaning } = content;
  const oldMeaning = prior ? (({ revision: _r, observedAt: _t, ...other }) => other)(prior) : null;
  return !prior || surferDigest(oldMeaning) !== surferDigest(meaning);
}
export const inputId = (s: SurferSourceValidationSession, sourceId: string) =>
  `shotgun-material-v2:${surferDigest({ projectId: s.snapshot.projectId, epoch: s.snapshot.knowledgeEpoch, sourceId })}`;
export const authority = (s: SurferSourceValidationSession) => ({
  projectId: s.snapshot.projectId,
  principalId: s.snapshot.principalId,
  knowledgeEpoch: s.snapshot.knowledgeEpoch,
  accessDigest: s.snapshot.accessDigest,
  policyRevision: s.snapshot.policyRevision,
});
export const receipt = (s: SurferSourceValidationSession) => ({
  contract: 'surfer.source-binding.v2' as const,
  ...authority(s),
  sourceSnapshotDigest: s.snapshot.digest,
  observedAt: s.snapshot.observedAt,
  consistency: s.snapshot.consistency,
});
export function unavailable(message: string): never {
  throw new ShotgunError({
    code: 'STALE_VERSION',
    safeMessage: message,
    module: 'surfer.bridge.v2',
    operation: 'currentness',
  });
}
export function owner(s: SurferSourceValidationSession): void {
  if (!s.snapshot.canSynchronize)
    throw new ShotgunError({
      code: 'POLICY_DENIED',
      safeMessage: 'Source binding writes require the server-bound Project owner.',
      module: 'surfer.bridge.v2',
      operation: 'authorize',
    });
}
export async function queryDigest(
  s: SurferSourceValidationSession,
  q: SurferQuerySelectionV2,
): Promise<string> {
  if (!['OPEN_QUERY', 'EXPLICIT_SOURCE_SET'].includes(q.kind))
    throw surferFailure('Unknown Source query scope.');
  const ids =
    q.kind === 'OPEN_QUERY'
      ? s.snapshot.heads.filter((h) => h.readiness === 'INDEXED').map((h) => h.sourceId)
      : q.sourceIds;
  const members = [];
  for (const sourceId of [...ids].sort()) {
    const h = s.snapshot.heads.find((h) => h.sourceId === sourceId);
    if (!h || h.readiness !== 'INDEXED')
      unavailable(
        'An explicitly selected Source is inaccessible/unready; absence cannot be inferred.',
      );
    members.push({
      sourceId,
      fingerprint: h.fingerprint,
      proof: await s.readContentProofV2(sourceId),
    });
  }
  return surferDigest({ catalogue: q.kind === 'OPEN_QUERY' ? s.snapshot.digest : null, members });
}
export function sourceBindingValidator(
  s: SurferSourceValidationSession,
  backend: SurferSourceValidationBackend,
) {
  const materials = new Map<
    string,
    Awaited<ReturnType<SurferSourceValidationSession['readMaterialV2']>>
  >();
  async function material(sourceId: string) {
    let m = materials.get(sourceId);
    if (!m) {
      m = await s.readMaterialV2(sourceId);
      materials.set(sourceId, m);
    }
    return m;
  }
  const checked = new Set<string>(),
    checking = new Set<string>();
  async function checkBasis(basis: SurferSourceBasisV2) {
    assertSurferSourceBasisV2(basis);
    if (!(await backend.captureIssued(basis)))
      throw surferFailure('Source basis was not issued by the trusted v2 capture owner.');
    if (surferDigest(basis.authority) !== surferDigest(authority(s)))
      unavailable('Source access/policy/reset authority changed.');
    const capture = decodeSurferBindingCaptureV2({
      schemaVersion: '2.0.0',
      sourceIds: basis.sources.map((x) => x.sourceId),
      artifacts: basis.dependencies.map((x) => x.artifact),
      queries: basis.queries.map(({ membershipDigest: _m, ...q }) => q),
    });
    for (const q of basis.queries)
      if (q.membershipDigest !== (await queryDigest(s, q)))
        unavailable('Source query membership changed or relevance is UNKNOWN.');
    const currentInputs = await backend.inputs(
      basis.sources.map((dep) => inputId(s, dep.sourceId)),
    );
    for (const dep of basis.sources) {
      const h = s.snapshot.heads.find((h) => h.sourceId === dep.sourceId);
      if (!h || h.readiness !== 'INDEXED' || h.fingerprint !== dep.fingerprint)
        unavailable('A direct Source head changed, was removed or became unavailable.');
      const current = await material(dep.sourceId),
        input = currentInputs.find((i) => i.inputId === inputId(s, dep.sourceId));
      if (current.proof !== dep.materialProof)
        unavailable('Direct Source material/Evidence content changed.');
      const m = current.material;
      if (
        !input ||
        input.retired ||
        surferDigest(input.scope) !== surferDigest(m.scope) ||
        input.contentDigest !== m.sourceContentHash ||
        input.witnesses.length !== 1 ||
        input.witnesses[0]!.sourceId !== m.sourceId ||
        input.witnesses[0]!.sourceVersionId !== m.sourceVersionId ||
        input.witnesses[0]!.evidenceId !== m.rootEvidenceId ||
        input.witnesses[0]!.materialDigest !== m.sourceContentHash
      )
        unavailable('Core premise does not match the currently validated Source.');
    }
    for (const dep of basis.dependencies) {
      const record = await backend.binding(dep.artifact);
      if (!record || record.digest !== dep.bindingDigest)
        unavailable('A transitive Source binding is missing or changed.');
      await checkRecord(record);
    }
    const current = await backend.captureBasis({
      inputIds: capture.sourceIds.map((id) => inputId(s, id)),
      artifacts: capture.artifacts,
      footprints: basis.coreBasis.footprints.map(({ domain, predicate }) => ({
        domain,
        predicate,
      })),
    });
    if (surferDigest(current) !== surferDigest(basis.coreBasis))
      unavailable('Core content premises changed.');
  }
  async function checkRecord(record: SurferBindingRecordV2): Promise<void> {
    if (
      record.digest !==
      surferDigest({ artifact: record.artifact, contentDigest: record.basis.contentDigest })
    )
      throw surferFailure('Stored v2 binding digest mismatch.');
    if (checked.has(record.digest)) return;
    if (checking.has(record.digest) || checking.size >= 128)
      throw surferFailure('Source binding cycle/traversal budget exceeded.');
    checking.add(record.digest);
    await checkBasis(record.basis);
    await backend.readCurrentArtifact(record.artifact);
    checking.delete(record.digest);
    checked.add(record.digest);
  }
  return { material, checkBasis, checkRecord };
}
