import type { SurferScopedRuleProof } from '../../../packages/contracts/src/surfer-rule-memory.js';
import {
  assertSurferSourceBasisV2,
  type SurferSourceBasisV2,
} from '../../../packages/contracts/src/surfer-source-binding-v2.js';
import { decodeSurferObservationSelections } from '../../../packages/contracts/src/surfer-cognition.js';
import {
  assertSurferJson,
  surferDigest,
  surferFailure,
} from '../../../packages/contracts/src/surfer-learning.js';
import type { SurferArtifactRef } from '../../../packages/contracts/src/surfer-knowledge.js';
import {
  decodeSurferRuleObservation,
  type SurferRuleReviewEntry,
  type SurferRuleUseState,
} from '../../../packages/contracts/src/surfer-rule-review.js';
import { diagnoseSurferRuleObservation } from './rule-review-diagnosis.js';
import type { SurferCognitiveSourcePort } from '../../../packages/contracts/src/surfer-cognition.js';
export const SURFER_RULE_MEMORY_DOMAIN = 'surfer.scoped-rule-memory.v1';
type Base = { proof: SurferScopedRuleProof; knowledgeBasis: SurferSourceBasisV2 };
export type SurferRuleMemoryPayload = Base & { contract: typeof SURFER_RULE_MEMORY_DOMAIN };
export type SurferReviewedRuleMemoryPayload = Base & {
  contract: 'surfer.scoped-rule-memory.v2';
  previous: SurferArtifactRef;
  state: SurferRuleUseState;
  reviews: SurferRuleReviewEntry[];
};
export type SurferAnyRuleMemoryPayload = SurferRuleMemoryPayload | SurferReviewedRuleMemoryPayload;
const exact = (v: object, keys: string) => Object.keys(v).sort().join(',') === keys;
export function validateSurferRuleMemoryBinding(payload: SurferAnyRuleMemoryPayload) {
  assertSurferJson(payload);
  if (!payload || !payload.proof?.basis) throw surferFailure('Stored rule payload is corrupt.');
  const reviewed = payload.contract === 'surfer.scoped-rule-memory.v2';
  if (
    reviewed
      ? !exact(payload, 'contract,knowledgeBasis,previous,proof,reviews,state')
      : payload.contract !== SURFER_RULE_MEMORY_DOMAIN ||
        !exact(payload, 'contract,knowledgeBasis,proof')
  )
    throw surferFailure('Stored rule payload is corrupt.');
  const b = payload.knowledgeBasis,
    p = payload.proof;
  assertSurferSourceBasisV2(b);
  const bases = [p.basis];
  if (reviewed) {
    const q = payload;
    if (
      !q.previous ||
      !exact(q.previous, 'artifactId,digest,revision') ||
      typeof q.previous.artifactId !== 'string' ||
      !q.previous.artifactId.length ||
      !Number.isSafeInteger(q.previous.revision) ||
      q.previous.revision < 1 ||
      !/^sha256:[a-f0-9]{64}$/.test(q.previous.digest) ||
      !Array.isArray(q.reviews) ||
      q.reviews.length < 1 ||
      q.reviews.length > 8
    )
      throw surferFailure('Invalid rule revision lineage.');
    let state: SurferRuleUseState = 'ACTIVE';
    const events = new Set<string>(),
      groups = new Set<string>();
    for (const review of q.reviews) {
      if (!exact(review, 'action,basis,observation,observationDigest,selections'))
        throw surferFailure('Invalid stored review.');
      assertSurferSourceBasisV2(review.basis);
      const o = decodeSurferRuleObservation(review.observation);
      decodeSurferObservationSelections({ schemaVersion: '1.0.0', selections: review.selections });
      if (
        review.selections.length !== 1 ||
        surferDigest(o) !== review.observationDigest ||
        events.has(o.eventId) ||
        groups.has(o.eventGroup)
      )
        throw surferFailure('Duplicate or corrupt review event.');
      events.add(o.eventId);
      groups.add(o.eventGroup);
      state = diagnoseSurferRuleObservation(p, o, review.action, state).nextState;
      bases.push(review.basis);
    }
    if (q.state !== state) throw surferFailure('Stored review state differs from its history.');
  }
  const sources = [
      ...new Map(bases.flatMap((x) => x.sources).map((x) => [x.sourceId, x])).values(),
    ].sort((a, b) => a.sourceId.localeCompare(b.sourceId)),
    ids = sources.map((x) => x.sourceId);
  if (
    bases.some((x) => surferDigest(x.authority) !== surferDigest(p.basis.authority)) ||
    surferDigest(b.authority) !== surferDigest(p.basis.authority) ||
    surferDigest(b.sources) !== surferDigest(sources) ||
    b.dependencies.length ||
    b.queries.length !== 1 ||
    b.queries[0]?.kind !== 'EXPLICIT_SOURCE_SET' ||
    surferDigest(b.queries[0].sourceIds) !== surferDigest(ids) ||
    surferDigest(b.coreBasis.footprints.map(({ domain, predicate }) => ({ domain, predicate }))) !==
      surferDigest([
        { domain: SURFER_RULE_MEMORY_DOMAIN, predicate: surferDigest({ sourceIds: ids }) },
      ])
  )
    throw surferFailure('Rule query scope differs from its complete Source lineage.');
  return payload;
}
export const surferRuleUseState = (p: SurferAnyRuleMemoryPayload): SurferRuleUseState =>
  p.contract === 'surfer.scoped-rule-memory.v2' ? p.state : 'ACTIVE';
export function surferRuleReviewDiagnoses(p: SurferAnyRuleMemoryPayload) {
  let state: SurferRuleUseState = 'ACTIVE';
  return p.contract === 'surfer.scoped-rule-memory.v2'
    ? p.reviews.map((e) => {
        const diagnosis = diagnoseSurferRuleObservation(p.proof, e.observation, e.action, state);
        state = diagnosis.nextState;
        return {
          eventId: e.observation.eventId,
          eventGroup: e.observation.eventGroup,
          observationDigest: e.observationDigest,
          diagnosis,
        };
      })
    : [];
}
export async function readSurferRuleReviewViews(
  source: SurferCognitiveSourcePort,
  actor: unknown,
  p: SurferAnyRuleMemoryPayload,
) {
  const views = [];
  if (p.contract === 'surfer.scoped-rule-memory.v2')
    for (const review of p.reviews) {
      const view = await source.withCurrent(actor, review.basis, review.selections, (v) => v);
      if (
        view.anchors.length !== 1 ||
        surferDigest(decodeSurferRuleObservation(JSON.parse(view.anchors[0]!.rawLiteral))) !==
          review.observationDigest
      )
        throw surferFailure('Stored review differs from its current Source.');
      views.push(view);
    }
  return views;
}
