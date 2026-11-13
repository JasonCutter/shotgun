import { cognitiveFixture } from './surfer-cognitive-fixture.js';
import { providerFixture } from './surfer-provider-contracts.js';
import { InMemorySurferExecutionStore } from '../../adapters/surfer-execution-in-memory/src/index.js';
import {
  buildSurferObservationAnchor,
  cognitiveViewDigest,
} from '../../modules/surfer-core/src/cognition.js';
import { sourceBindingContentDigestV2 } from '../../packages/contracts/src/surfer-source-binding-v2.js';
import { surferDigest } from '../../packages/contracts/src/surfer-learning.js';
import { unicodeLength } from '../../packages/contracts/src/document-evidence.js';
import {
  SURFER_MEANING_VERIFIER_REVISION,
  decodeSurferMeaningVerificationWork,
} from '../../packages/contracts/src/surfer-meaning-verification.js';
import { SurferProviderExecutor } from '../../modules/surfer-execution/src/provider-executor.js';
import { SurferMeaningVerificationCodec } from '../../adapters/surfer-structure-extraction/src/meaning-verification.js';
import type { SurferCognitiveSourcePort } from '../../packages/contracts/src/surfer-cognition.js';

export const meaningOrigin =
  '😀 장치A에서는 2026년 가동 중이면 온도는 temperature를 뜻하며, 정비 중에는 제외한다.';
export const meaningWitness =
  '장치A의 기록에서는 temperature 항목을 온도라고 부른다. 2026년 가동 중에 사용하고 정비 때는 제외한다.';
export function meaningReviewWire(first = meaningOrigin, second = meaningWitness) {
  const quote = (passageRef: string, quote: string) => ({ passageRef, quote });
  return {
    relation: 'EQUIVALENT',
    typeAssessment: 'MATCH',
    unitAssessment: 'MATCH',
    documentRole: 'DEFINITION',
    roleCitations: [quote('P1', first)],
    facets: {
      subject: { state: 'STATED', reason: 'authored fixture', quotes: [quote('P1', '장치A')] },
      time: { state: 'STATED', reason: 'authored fixture', quotes: [quote('P1', '2026년')] },
      condition: {
        state: 'STATED',
        reason: 'authored fixture',
        quotes: [quote('P1', '가동 중이면')],
      },
      exception: {
        state: 'STATED',
        reason: 'authored fixture',
        quotes: [quote('P1', '정비 중에는 제외한다')],
      },
    },
    support: [quote('P1', first), quote('P2', second)],
    counter: [] as { passageRef: string; quote: string }[],
    reason: 'ISOLATED_AUTHORED_MODEL_OUTPUT_NOT_SEMANTIC_EVIDENCE',
  };
}
export function meaningReviewWireV2(first = meaningOrigin, second = meaningWitness) {
  return {
    ...meaningReviewWire(first, second),
    relationBasis: 'EXPLICIT_TERM_RELATION',
    typeAssessment: 'UNRESOLVED',
    unitAssessment: 'UNRESOLVED',
    typeCitations: [] as { passageRef: string; quote: string }[],
    unitCitations: [] as { passageRef: string; quote: string }[],
    counter: [] as { passageRef: string; quote: string; kind: string }[],
  };
}
export function meaningVerifierFixture(
  options: { revision?: string; origin?: string; witness?: string } = {},
) {
  const first = options.origin ?? meaningOrigin,
    second = options.witness ?? meaningWitness;
  const a = cognitiveFixture(first, first, null),
    b = cognitiveFixture(second, second, null),
    f = providerFixture(new InMemorySurferExecutionStore());
  const basis = { ...a.basis, sources: [...a.basis.sources, ...b.basis.sources] };
  basis.contentDigest = sourceBindingContentDigestV2(basis);
  const anchors = [
      buildSurferObservationAnchor(a.material, basis, a.selection),
      buildSurferObservationAnchor(b.material, basis, b.selection),
    ],
    view = { ...a.view, basis, anchors, viewDigest: cognitiveViewDigest(basis, anchors) };
  const profile = {
    ...f.profile,
    promptRevision: options.revision ?? SURFER_MEANING_VERIFIER_REVISION,
  };
  const body = {
    revision: 'surfer.meaning-verification-work.v1' as const,
    proposal: {
      attemptId: 'private-prior-attempt',
      receiptDigest: surferDigest('private-receipt'),
      contextDigest: surferDigest('private-context'),
      candidateIndex: 0,
    },
    candidate: {
      rule: { artifactId: 'private-rule', revision: 1, digest: surferDigest('private-rule') },
      field: 'temperature',
      label: '온도',
      source: {
        sourceId: a.material.sourceId,
        sourceVersionId: a.material.sourceVersionId,
        evidenceId: a.selection.evidenceId,
        revisionId: a.material.revisionId,
      },
      sourceSpan: { start: 0, end: unicodeLength(first), quote: first },
      questionSpan: { start: 0, end: 2, quote: '온도' },
      assessment: 'ANCHORED_UNVERIFIED' as const,
      uncertainties: ['SEMANTIC_EQUIVALENCE_UNVERIFIED', 'SUBJECT_TIME_UNVERIFIED'] as [
        'SEMANTIC_EQUIVALENCE_UNVERIFIED',
        'SUBJECT_TIME_UNVERIFIED',
      ],
    },
    target: {
      domain: 'thermal',
      description: 'scoped thermal observation',
      field: { name: 'temperature', type: 'NUMBER' as const, unit: 'Cel' },
    },
    proposer: { provider: profile.identity.providerId, model: profile.identity.modelId },
    basis,
    selections: [a.selection, b.selection],
    viewDigest: view.viewDigest,
    profileDigest: surferDigest(profile),
  };
  const work = decodeSurferMeaningVerificationWork({ ...body, digest: surferDigest(body) }),
    codec = new SurferMeaningVerificationCodec(work, profile.promptRevision),
    wire = meaningReviewWire(first, second);
  f.response.rawText = JSON.stringify(wire);
  const source: SurferCognitiveSourcePort = {
    observe: async () => view,
    withCurrent: async (_r, _b, _s, apply) => {
      if (!f.control.allowSource) throw Error('revoked');
      return apply(view);
    },
  };
  const task = { ...f.task, basis, selections: work.selections };
  const executor = () =>
    new SurferProviderExecutor(source, f.ledger, f.gateway, profile, codec, {
      minimumSensitivity: 'private',
    });
  return { ...f, profile, view, work, wire, codec, task, executor };
}
