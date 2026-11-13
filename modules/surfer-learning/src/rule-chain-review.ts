import { ShotgunError } from '../../../packages/contracts/src/errors.js';
import type { SurferScopedRuleMemorySession } from '../../../packages/contracts/src/surfer-rule-memory.js';
import type {
  SurferArtifactRef,
  SurferKnowledgeArtifact,
} from '../../../packages/contracts/src/surfer-knowledge.js';
import type { SurferSourceBasisV2 } from '../../../packages/contracts/src/surfer-source-binding-v2.js';
import type { SurferObservationSelection } from '../../../packages/contracts/src/surfer-cognition.js';
import {
  decodeSurferRuleObservation,
  type SurferRuleReviewAction,
} from '../../../packages/contracts/src/surfer-rule-review.js';
import { surferDigest, surferFailure } from '../../../packages/contracts/src/surfer-learning.js';
import { diagnoseSurferEmpiricalRule } from './rule-review-diagnosis.js';
import {
  CHAIN_BASE,
  CHAIN_OBSERVATION,
  chainRefs,
  readSurferChainState,
  type ChainManifest,
  type ChainObservation,
} from './rule-chain-state.js';
type Review = {
  operationId: string;
  expectedArtifact: SurferArtifactRef;
  expectedActiveSnapshotId: string;
  action: SurferRuleReviewAction;
  basis: SurferSourceBasisV2;
  selections: SurferObservationSelection[];
};
export const chainStale = () =>
  new ShotgunError({
    code: 'STALE_VERSION',
    safeMessage: 'The chain parent or active snapshot changed.',
    module: 'surfer.learning',
    operation: 'chain-currentness',
  });
export const artifactRef = (a: SurferKnowledgeArtifact) => ({
  artifactId: a.artifactId,
  revision: a.revision,
  digest: a.digest,
});
export async function appendChainCapsule(
  s: SurferScopedRuleMemorySession,
  operationId: string,
  id: string,
  domain: string,
  payload: Record<string, unknown>,
  basis: SurferSourceBasisV2,
  scope: SurferKnowledgeArtifact['scope'],
  producer: SurferKnowledgeArtifact['producer'],
  createdAt: string,
) {
  const result = await s.commit({
    schemaVersion: '2.0.0',
    basis,
    command: {
      action: 'APPEND_ARTIFACT',
      operationId,
      expectedRevision: null,
      draft: {
        schemaVersion: '1.0.0',
        artifactId: id,
        revision: 1,
        kind: 'EPISODE',
        origin: 'EXPERIENCE',
        scope,
        domain,
        createdAt,
        observedAt: basis.readWatermark.observedAt,
        producer: { ...producer, engineRevision: domain },
        payloadSchema: 'surfer.opaque.v1',
        payload,
        basis: basis.coreBasis,
      },
    },
  });
  return {
    artifactId: result.commit.subjectId,
    revision: result.commit.revision,
    digest: result.commit.digest,
  };
}
export async function reviewSurferChain(
  s: SurferScopedRuleMemorySession,
  actor: unknown,
  r: Review,
) {
  const prior = await s.findCommit(r.operationId + ':publish'),
    selected = prior?.subjectId ?? r.expectedActiveSnapshotId,
    read = await s.read(selected);
  if (read.status !== 'CURRENT' || (!prior && !read.result.isActive)) throw chainStale();
  const stored = read.result.artifacts.find((a) => a.artifactId === r.expectedArtifact.artifactId);
  if (!stored) throw chainStale();
  const state = await readSurferChainState(s, actor, stored),
    view = await s.source.withCurrent(actor, r.basis, r.selections, (v) => v);
  const observation = decodeSurferRuleObservation(JSON.parse(view.anchors[0]!.rawLiteral)),
    observationDigest = surferDigest(observation),
    known = state.observations.find(
      (e) =>
        e.observation.eventId === observation.eventId ||
        e.observation.eventGroup === observation.eventGroup,
    );
  if (prior) {
    const e = state.observations.at(-1);
    if (
      !state.manifest ||
      surferDigest(state.manifest.previous) !== surferDigest(r.expectedArtifact) ||
      !e ||
      e.observationDigest !== observationDigest ||
      e.action !== r.action ||
      surferDigest(e.basis) !== surferDigest(r.basis) ||
      surferDigest(e.selections) !== surferDigest(r.selections)
    )
      throw surferFailure('Chain review replay changed meaning.');
    await s.commit({
      schemaVersion: '2.0.0',
      basis: null,
      command: {
        action: 'PUBLISH_SNAPSHOT',
        operationId: r.operationId + ':publish',
        snapshotId: selected,
        expectedActiveSnapshotId: r.expectedActiveSnapshotId,
        entries: [...read.result.snapshot.entries],
        engineRevision: 'surfer.rule-chain-review.v1',
        createdAt: stored.createdAt,
      },
    });
    return {
      status: 'REPLAYED',
      artifact: artifactRef(stored),
      snapshotId: selected,
      state: state.state,
      generation: state.generation,
      diagnosis: state.diagnoses.at(-1),
      modelCalls: 0,
    } as const;
  }
  if (surferDigest(artifactRef(stored)) !== surferDigest(r.expectedArtifact)) throw chainStale();
  const duplicateOp = await s.findCommit(r.operationId + ':duplicate');
  if (duplicateOp) {
    const a = await s.readArtifact({
        artifactId: duplicateOp.subjectId,
        revision: duplicateOp.revision,
        digest: duplicateOp.digest,
      }),
      p = a.payload as {
        requestDigest: string;
        result: {
          status: 'DUPLICATE_EVENT';
          artifact: SurferArtifactRef;
          snapshotId: string;
          state: typeof state.state;
          generation: number;
          modelCalls: 0;
        };
      };
    if (a.domain !== 'surfer.chain-delivery.v1' || p.requestDigest !== surferDigest(r))
      throw surferFailure('Chain delivery changed meaning.');
    return { ...p.result, replayed: true };
  }
  const duplicate = async () => {
    const sourceIds = [
        ...new Set(
          [...state.views.flatMap((v) => v.basis.sources), ...r.basis.sources].map(
            (x) => x.sourceId,
          ),
        ),
      ].sort(),
      captured = await s.captureRule({
        schemaVersion: '2.0.0',
        sourceIds,
        artifacts: [],
        queries: [{ kind: 'EXPLICIT_SOURCE_SET', sourceIds }],
      }),
      result = {
        status: 'DUPLICATE_EVENT',
        artifact: r.expectedArtifact,
        snapshotId: selected,
        state: state.state,
        generation: state.generation,
        modelCalls: 0,
      } as const;
    await appendChainCapsule(
      s,
      r.operationId + ':duplicate',
      'chain-delivery:' + surferDigest(r.operationId).slice(7),
      'surfer.chain-delivery.v1',
      { requestDigest: surferDigest(r), result },
      captured.basis,
      captured.knowledgeScope,
      stored.producer,
      view.readReceipt.observedAt,
    );
    return result;
  };
  if (known) {
    const meaning = (o: typeof observation) => {
      const { eventId: _id, ...v } = o;
      return surferDigest(v);
    };
    if (
      (known.observation.eventId === observation.eventId &&
        known.observationDigest !== observationDigest) ||
      meaning(known.observation) !== meaning(observation) ||
      r.action !== 'ASSESS'
    )
      throw surferFailure('Declared chain event identity changed evidence/action.');
    return duplicate();
  }
  const diagnosis = diagnoseSurferEmpiricalRule(
    state.candidate,
    state.cases,
    state.datasetId,
    observation,
    r.action,
    state.state,
  );
  if (diagnosis.classification === 'DUPLICATE_TRAINING_EVENT') return duplicate();
  if (state.observations.length >= 16)
    throw surferFailure('Chain observation capacity reached;no history may be dropped.');
  let baseline = state.manifest?.baseline;
  if (!baseline)
    baseline = await appendChainCapsule(
      s,
      r.operationId + ':baseline',
      'chain-base:' + surferDigest(state.baseline).slice(7),
      CHAIN_BASE,
      { contract: CHAIN_BASE, memory: state.baseline },
      state.baseline.prepared.parent.knowledgeBasis,
      stored.scope,
      stored.producer,
      stored.createdAt,
    );
  const sourceIds = r.basis.sources.map((x) => x.sourceId).sort(),
    observationBinding = await s.captureRule({
      schemaVersion: '2.0.0',
      sourceIds,
      artifacts: [],
      queries: [{ kind: 'EXPLICIT_SOURCE_SET', sourceIds }],
    }),
    entry: ChainObservation = {
      contract: CHAIN_OBSERVATION,
      generation: state.generation,
      basis: r.basis,
      selections: r.selections,
      observation,
      observationDigest,
      action: r.action,
    },
    ref = await appendChainCapsule(
      s,
      r.operationId + ':observation',
      'chain-observation:' + surferDigest(r.operationId).slice(7),
      CHAIN_OBSERVATION,
      entry,
      observationBinding.basis,
      observationBinding.knowledgeScope,
      stored.producer,
      view.readReceipt.observedAt,
    ),
    refs = {
      baseline,
      observations: [...(state.manifest?.observations ?? []), ref],
      qualifications: state.manifest?.qualifications ?? [],
    },
    allSources = [
      ...new Set([...state.views, view].flatMap((v) => v.basis.sources.map((x) => x.sourceId))),
    ].sort(),
    captured = await s.captureChain({
      schemaVersion: '2.0.0',
      sourceIds: allSources,
      artifacts: chainRefs(refs),
      queries: [{ kind: 'EXPLICIT_SOURCE_SET', sourceIds: allSources }],
    }),
    payload: ChainManifest = {
      contract: 'surfer.rule-chain-memory.v1',
      ...refs,
      generation: state.generation,
      state: diagnosis.nextState,
      previous: r.expectedArtifact,
      transition: 'REVIEW',
      knowledgeBasis: captured.basis,
    },
    createdAt = view.readReceipt.observedAt,
    appended = await s.commit({
      schemaVersion: '2.0.0',
      basis: captured.basis,
      command: {
        action: 'APPEND_ARTIFACT',
        operationId: r.operationId + ':append',
        expectedRevision: stored.revision,
        draft: {
          schemaVersion: '1.0.0',
          artifactId: stored.artifactId,
          revision: stored.revision + 1,
          kind: 'RULE',
          origin: 'INDUCTION',
          scope: captured.knowledgeScope,
          domain: stored.domain,
          createdAt,
          observedAt: r.basis.readWatermark.observedAt,
          producer: { ...stored.producer, engineRevision: 'surfer.rule-chain-review.v1' },
          payloadSchema: 'surfer.opaque.v1',
          payload,
          basis: captured.basis.coreBasis,
        },
      },
    }),
    artifact = {
      artifactId: appended.commit.subjectId,
      revision: appended.commit.revision,
      digest: appended.commit.digest,
    },
    snapshotId = stored.artifactId + ':rule-snapshot:' + artifact.revision,
    entries = [
      ...read.result.snapshot.entries.filter((e) => e.artifactId !== stored.artifactId),
      artifact,
    ].sort((a, b) => (a.artifactId < b.artifactId ? -1 : a.artifactId > b.artifactId ? 1 : 0));
  await s.commit({
    schemaVersion: '2.0.0',
    basis: null,
    command: {
      action: 'PUBLISH_SNAPSHOT',
      operationId: r.operationId + ':publish',
      snapshotId,
      expectedActiveSnapshotId: r.expectedActiveSnapshotId,
      entries,
      engineRevision: 'surfer.rule-chain-review.v1',
      createdAt,
    },
  });
  return {
    status: 'REVIEWED',
    artifact,
    snapshotId,
    state: payload.state,
    generation: state.generation,
    diagnosis,
    modelCalls: 0,
  } as const;
}
