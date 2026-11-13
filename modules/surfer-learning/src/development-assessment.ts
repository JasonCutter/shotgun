import { decodeSurferInductionDevelopment } from '../../../packages/contracts/src/surfer-induction.js';
import {
  decodeSurferRuleCandidate,
  surferDigest,
  surferFailure,
} from '../../../packages/contracts/src/surfer-learning.js';
import { evaluateSurferRule } from './rule-interpreter.js';

/** Training consistency only; never independent validation or publication authority. */
export function assessSurferInductionDevelopment(
  developmentInput: unknown,
  candidateInput: unknown,
) {
  const d = decodeSurferInductionDevelopment(developmentInput),
    c = decodeSurferRuleCandidate(candidateInput),
    first = d.cases[0]!;
  if (
    c.domain !== first.domain ||
    surferDigest(c.scope) !== surferDigest(first.scope) ||
    surferDigest(c.developmentCaseIds) !== surferDigest(d.cases.map((r) => r.caseId))
  )
    throw surferFailure('Development assessment candidate belongs to another cohort.');
  const rows = d.cases.map((r) => {
    const prediction = evaluateSurferRule(c.expression, r.features, { maxOperations: 512 });
    return {
      caseId: r.caseId,
      features: structuredClone(r.features),
      expected: r.observedOutcome,
      prediction: prediction.outcome,
      reasons: prediction.reasons,
      correct:
        prediction.outcome !== 'UNKNOWN' && (prediction.outcome === 'TRUE') === r.observedOutcome,
    };
  });
  const correct = rows.filter((r) => r.correct).length,
    unknown = rows.filter((r) => r.prediction === 'UNKNOWN').length;
  return {
    contract: 'surfer.induction-development-assessment.v1' as const,
    developmentDigest: surferDigest(d),
    candidateDigest: surferDigest(c),
    total: 32,
    correct,
    unknown,
    eligible: correct === 32 && unknown === 0,
    evidenceLevel: 'DEVELOPMENT_CONSISTENCY_ONLY' as const,
    mismatches: rows.filter((r) => !r.correct),
  };
}
