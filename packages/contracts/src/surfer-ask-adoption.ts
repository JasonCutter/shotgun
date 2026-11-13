import { assertSurferAskScopeFrames, type SurferAskScopeFrames } from './surfer-ask-scope.js';
import type { SurferAskMeaningProposalReceipt } from './surfer-ask-discovery.js';
import type { SurferAskMemoryPacket } from './surfer-ask-memory.js';
import { assertSurferJson, surferDigest, surferFailure } from './surfer-learning.js';
export type SurferAskMeaningScopeInput = {
  sourceAssessment: SurferAskScopeFrames['assessment'] | 'NOT_RECORDED';
  hasRejections: boolean;
  frame: SurferAskScopeFrames['frames'][number] | null;
};
export type SurferAskCrossReviewPin = {
  state: 'ABSENT' | 'SUPPORTED' | 'WITHHELD';
  jobIds: string[];
  digest: string;
};
type ScopedReview = {
  scope: SurferAskMeaningScopeInput;
  scopeAssessment: 'TYPED_DECLARATIONS_ONLY' | 'UNVERIFIED_SCOPE';
};
export type SurferAskMeaningReview = (
  | {
      revision: 'surfer.ask-meaning-review.v1';
      profile: 'EXPLICIT_TYPED_DOMAIN_DECLARATION_V1';
    }
  | (ScopedReview & {
      revision: 'surfer.ask-meaning-review.v2';
      profile: 'EXPLICIT_TYPED_DOMAIN_AND_SCOPE_V1';
    })
  | (ScopedReview & {
      revision: 'surfer.ask-meaning-review.v3';
      profile: 'EXPLICIT_TYPED_DOMAIN_WITH_CROSS_REVIEW_V1';
      crossReview: SurferAskCrossReviewPin;
    })
) & {
  proposal: { attemptId: string; receiptDigest: string; candidateIndex: number };
  candidate: SurferAskMeaningProposalReceipt['candidates'][number];
  assessment:
    | 'SOURCE_CORROBORATED_DECLARATION_ONLY'
    | 'CONTRADICTED'
    | 'UNSUPPORTED'
    | 'INSUFFICIENT_EVIDENCE';
  sources: SurferAskMemoryPacket['items'][number]['citations'];
  digest: string;
};
export function assertSurferAskMeaningReview(
  value: unknown,
): asserts value is SurferAskMeaningReview {
  assertSurferJson(value);
  const r = value as SurferAskMeaningReview;
  if (
    !r ||
    Object.keys(r).sort().join(',') !==
      (r.revision === 'surfer.ask-meaning-review.v3'
        ? 'assessment,candidate,crossReview,digest,profile,proposal,revision,scope,scopeAssessment,sources'
        : r.revision === 'surfer.ask-meaning-review.v2'
          ? 'assessment,candidate,digest,profile,proposal,revision,scope,scopeAssessment,sources'
          : 'assessment,candidate,digest,profile,proposal,revision,sources') ||
    !(r.revision === 'surfer.ask-meaning-review.v1'
      ? r.profile === 'EXPLICIT_TYPED_DOMAIN_DECLARATION_V1'
      : r.revision === 'surfer.ask-meaning-review.v2'
        ? r.profile === 'EXPLICIT_TYPED_DOMAIN_AND_SCOPE_V1'
        : r.revision === 'surfer.ask-meaning-review.v3' &&
          r.profile === 'EXPLICIT_TYPED_DOMAIN_WITH_CROSS_REVIEW_V1') ||
    ![
      'SOURCE_CORROBORATED_DECLARATION_ONLY',
      'CONTRADICTED',
      'UNSUPPORTED',
      'INSUFFICIENT_EVIDENCE',
    ].includes(r.assessment) ||
    !r.proposal ||
    Object.keys(r.proposal).sort().join(',') !== 'attemptId,candidateIndex,receiptDigest' ||
    typeof r.proposal.attemptId !== 'string' ||
    !r.proposal.attemptId.length ||
    r.proposal.attemptId.length > 256 ||
    !/^sha256:[a-f0-9]{64}$/.test(r.proposal.receiptDigest) ||
    !Number.isSafeInteger(r.proposal.candidateIndex) ||
    r.proposal.candidateIndex < 0 ||
    r.proposal.candidateIndex > 7 ||
    !r.candidate ||
    !Array.isArray(r.sources) ||
    !r.sources.length ||
    r.sources.length > 12 ||
    JSON.stringify(r).length > 54000
  )
    throw surferFailure('Invalid bounded Ask meaning review.');
  if (r.revision !== 'surfer.ask-meaning-review.v1') {
    assertSurferAskMeaningScopeInput(r.scope, r.candidate, r.proposal.candidateIndex);
    if (
      !['TYPED_DECLARATIONS_ONLY', 'UNVERIFIED_SCOPE'].includes(r.scopeAssessment) ||
      (r.scopeAssessment === 'UNVERIFIED_SCOPE' &&
        r.assessment === 'SOURCE_CORROBORATED_DECLARATION_ONLY') ||
      (r.scopeAssessment === 'TYPED_DECLARATIONS_ONLY' &&
        r.assessment !== 'SOURCE_CORROBORATED_DECLARATION_ONLY')
    )
      throw surferFailure('Invalid scope review assessment.');
  }
  if (r.revision === 'surfer.ask-meaning-review.v3') {
    const pin = r.crossReview;
    if (
      !pin ||
      Object.keys(pin).sort().join(',') !== 'digest,jobIds,state' ||
      !['ABSENT', 'SUPPORTED', 'WITHHELD'].includes(pin.state) ||
      !/^sha256:[a-f0-9]{64}$/.test(pin.digest) ||
      !Array.isArray(pin.jobIds) ||
      pin.jobIds.length > 9 ||
      pin.jobIds.some(
        (id, i) => !/^meaning:[a-f0-9]{64}$/.test(id) || (i > 0 && pin.jobIds[i - 1]! >= id),
      ) ||
      (pin.state === 'ABSENT') !== (pin.jobIds.length === 0) ||
      (pin.state === 'WITHHELD' && r.assessment === 'SOURCE_CORROBORATED_DECLARATION_ONLY')
    )
      throw surferFailure('Invalid Ask cross-review pin.');
  }
  const { digest, ...body } = r;
  if (surferDigest(body) !== digest) throw surferFailure('Ask meaning review digest changed.');
}

export function assertSurferAskMeaningScopeInput(
  value: unknown,
  candidate: SurferAskMeaningReview['candidate'],
  candidateIndex: number,
): asserts value is SurferAskMeaningScopeInput {
  assertSurferJson(value);
  const s = value as SurferAskMeaningScopeInput;
  if (
    !s ||
    Object.keys(s).sort().join(',') !== 'frame,hasRejections,sourceAssessment' ||
    ![
      'NOT_RECORDED',
      'NO_FRAME',
      'INVALID_OUTPUT',
      'EVIDENCE_REJECTED',
      'ANCHORED_SCOPES_UNVERIFIED',
    ].includes(s.sourceAssessment) ||
    typeof s.hasRejections !== 'boolean' ||
    JSON.stringify(s).length > 4096 ||
    (s.sourceAssessment !== 'ANCHORED_SCOPES_UNVERIFIED' && s.frame !== null) ||
    (s.sourceAssessment === 'EVIDENCE_REJECTED' && !s.hasRejections) ||
    (['NOT_RECORDED', 'NO_FRAME', 'INVALID_OUTPUT'].includes(s.sourceAssessment) && s.hasRejections)
  )
    throw surferFailure('Invalid candidate scope review input.');
  if (s.frame !== null) {
    if (s.frame.candidateIndex !== candidateIndex)
      throw surferFailure('Scope frame belongs to another candidate.');
    assertSurferAskScopeFrames(
      {
        revision: 'surfer.ask-semantic-scopes.v1',
        assessment: 'ANCHORED_SCOPES_UNVERIFIED',
        frames: [{ ...s.frame, candidateIndex: 0 }],
        rejected: [],
      },
      [candidate],
    );
  }
}
export function selectSurferAskMeaningScope(
  receipt: SurferAskMeaningProposalReceipt,
  candidateIndex: number,
): SurferAskMeaningScopeInput {
  const s = receipt.semanticScopes;
  return {
    sourceAssessment: s?.assessment ?? 'NOT_RECORDED',
    hasRejections: !!s?.rejected.length,
    frame: s?.frames.find((f) => f.candidateIndex === candidateIndex) ?? null,
  };
}
