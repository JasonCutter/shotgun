import { surferFailure } from './surfer-learning.js';

export const SURFER_PUMP_REVIEW_PROVIDER = {
  provider: 'shotgun-context-resolver',
  model: 'surfer-hypothesis-review',
  adapterVersion: '1.0.0',
} as const;

const reviewQuestion =
  /^\s*([\w가-힣-]{1,40})\s+(?:시험대(?:의)?\s+)?(?:주기\s+)?(\d{1,4})(?:번)?(?:\s*주기(?:의)?)?\s+펌프\s*누설(?:을)?\s*검토(?:해\s*(?:줘|주세요))?[.?!]?\s*$/iu;

export function readSurferPumpReviewQuestion(question: string) {
  const match = reviewQuestion.exec(question);
  if (!match || Number(match[2]) < 1) return undefined;
  return { rig: match[1]!.toLowerCase(), cycle: Number(match[2]) };
}

export type SurferPumpReviewEvidence = {
  kind: 'HYPOTHESIS' | 'MEASUREMENTS';
  evidenceId: string;
  source: {
    sourceId: string;
    sourceVersionId: string;
    revisionId: string;
    indexingResultId: string;
  };
};

export type SurferAskPumpReview = {
  revision: 'surfer.ask-pump-review.v1';
  cycle: number;
  evidence: SurferPumpReviewEvidence[];
} & (
  | { outcome: 'TRUE' | 'FALSE'; flowSpread: number; limit: number }
  | { outcome: 'UNKNOWN'; reason: 'RIG_OUT_OF_SCOPE' | 'MISSING_EVIDENCE' | 'CYCLE_OUT_OF_SCOPE' }
);

function nonempty(value: unknown) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

export function assertSurferAskPumpReview(review: SurferAskPumpReview) {
  if (
    !review ||
    review.revision !== 'surfer.ask-pump-review.v1' ||
    !Number.isSafeInteger(review.cycle) ||
    review.cycle < 1 ||
    review.cycle > 9999 ||
    !Array.isArray(review.evidence) ||
    review.evidence.length > 2 ||
    new Set(review.evidence.map((pin) => pin?.kind)).size !== review.evidence.length ||
    new Set(review.evidence.map((pin) => pin?.source?.sourceId)).size !== review.evidence.length ||
    review.evidence.some(
      (pin) =>
        !pin ||
        !['HYPOTHESIS', 'MEASUREMENTS'].includes(pin.kind) ||
        !nonempty(pin.evidenceId) ||
        !pin.source ||
        Object.keys(pin.source).length !== 4 ||
        !nonempty(pin.source.sourceId) ||
        !nonempty(pin.source.sourceVersionId) ||
        !nonempty(pin.source.revisionId) ||
        !nonempty(pin.source.indexingResultId),
    )
  )
    throw surferFailure('Invalid Ask pump hypothesis evidence.');

  const keys = Object.keys(review).sort().join(',');
  if (
    review.outcome === 'UNKNOWN'
      ? keys !== 'cycle,evidence,outcome,reason,revision' ||
        !['RIG_OUT_OF_SCOPE', 'MISSING_EVIDENCE', 'CYCLE_OUT_OF_SCOPE'].includes(review.reason)
      : keys !== 'cycle,evidence,flowSpread,limit,outcome,revision' ||
        review.evidence.length !== 2 ||
        !Number.isFinite(review.flowSpread) ||
        !Number.isFinite(review.limit) ||
        review.outcome !== (review.flowSpread <= review.limit ? 'TRUE' : 'FALSE')
  )
    throw surferFailure('Invalid Ask pump hypothesis result.');
}
