import {
  decodeSurferRuleObservation,
  type SurferRuleUseState,
  type SurferRuleReviewAction,
} from '../../../packages/contracts/src/surfer-rule-review.js';
import type { SurferScopedRuleProof } from '../../../packages/contracts/src/surfer-rule-memory.js';
import {
  surferDigest,
  surferFailure,
  type SurferRuleCandidate,
  type SurferLearningCase,
} from '../../../packages/contracts/src/surfer-learning.js';
import { applySurferObservedRule } from './scoped-rule-application.js';
import { evaluateSurferRule } from './rule-interpreter.js';
/** A declared empirical observation is not a certified fact or a universal/normative rule refutation. */
export function diagnoseSurferRuleObservation(
  proof: SurferScopedRuleProof,
  input: unknown,
  action: SurferRuleReviewAction,
  previousState: SurferRuleUseState,
) {
  return diagnoseSurferEmpiricalRule(
    proof.candidate,
    proof.development.cases,
    proof.development.datasetId,
    input,
    action,
    previousState,
  );
}
export function diagnoseSurferEmpiricalRule(
  candidate: SurferRuleCandidate,
  cases: readonly SurferLearningCase[],
  datasetId: string,
  input: unknown,
  action: SurferRuleReviewAction,
  previousState: SurferRuleUseState,
) {
  const o = decodeSurferRuleObservation(input);
  if (
    !['ASSESS', 'RETRACT'].includes(action) ||
    !['ACTIVE', 'QUARANTINED', 'RETRACTED'].includes(previousState)
  )
    throw surferFailure('Invalid empirical review action/state.');
  const scoped = o.datasetId === datasetId && o.domain === candidate.domain,
    raw = scoped
      ? evaluateSurferRule(candidate.expression, o.features, { maxOperations: 512 })
      : null,
    unknownNames = Object.keys(o.features).filter((n) => !Object.hasOwn(cases[0]!.features, n)),
    declared = scoped
      ? unknownNames.length
        ? { outcome: 'UNKNOWN' as const, reasons: ['UNMODELED_FEATURES:' + unknownNames.join(',')] }
        : applySurferObservedRule(candidate, cases, o.features)
      : null,
    original = cases.find((c) => c.caseId === o.eventId || c.eventGroup === o.eventGroup),
    duplicate =
      !!original &&
      surferDigest(original.features) === surferDigest(o.features) &&
      original.observedOutcome === o.observedOutcome,
    sameEvent = !!original && scoped,
    mismatch =
      declared?.outcome !== 'UNKNOWN' &&
      declared !== null &&
      (declared.outcome === 'TRUE') !== o.observedOutcome;
  const classification = !scoped
    ? 'UNRESOLVED_OR_NOT_COMPARABLE'
    : sameEvent
      ? duplicate
        ? 'DUPLICATE_TRAINING_EVENT'
        : 'CONFLICTING_TRAINING_EVENT'
      : declared!.outcome === 'UNKNOWN'
        ? 'UNRESOLVED_OR_NOT_COMPARABLE'
        : mismatch
          ? 'EMPIRICAL_PREDICTION_MISS'
          : 'COMPATIBLE_OBSERVATION';
  const challenged =
    classification === 'EMPIRICAL_PREDICTION_MISS' ||
    classification === 'CONFLICTING_TRAINING_EVENT';
  if (action === 'RETRACT' && !challenged)
    throw surferFailure(
      'Retraction requires a comparable empirical miss or conflicting training event.',
    );
  if (previousState === 'RETRACTED')
    throw surferFailure('A retracted rule requires a separately evaluated replacement.');
  const nextState: SurferRuleUseState =
    action === 'RETRACT' ? 'RETRACTED' : challenged ? 'QUARANTINED' : previousState;
  return {
    revision: 'surfer.empirical-rule-review.v1' as const,
    classification,
    ruleKind: 'SCOPED_EMPIRICAL_PREDICTOR' as const,
    comparability: !scoped
      ? 'OTHER_DATASET_OR_DOMAIN'
      : sameEvent
        ? 'SAME_DECLARED_EVENT'
        : declared!.outcome === 'UNKNOWN'
          ? 'OUTSIDE_OBSERVED_SUPPORT'
          : 'SUPPORTED_FEATURE_SCENARIO',
    guardedPrediction: declared?.outcome ?? 'UNKNOWN',
    rawExpressionPrediction: raw?.outcome ?? 'UNKNOWN',
    reasons: !scoped
      ? ['OTHER_DATASET_OR_DOMAIN']
      : sameEvent
        ? [duplicate ? 'REPEATED_TRAINING_EVENT' : 'CONFLICTING_DECLARED_EVENT']
        : declared!.outcome === 'UNKNOWN'
          ? [...declared!.reasons]
          : mismatch
            ? ['DECLARED_OUTCOME_DISAGREES']
            : ['DECLARED_OUTCOME_AGREES'],
    previousState,
    nextState,
    action,
    impact: nextState === 'ACTIVE' ? 'RETAIN_SUPPORTED_SCOPE' : 'RESTRICT_RULE_USE',
    independentEvidence:
      !scoped || sameEvent ? 'NOT_AN_INDEPENDENT_SAMPLE' : 'DECLARED_EVENT_GROUP_ONLY_NOT_VERIFIED',
    observationAssessment: 'DECLARED_TYPED_OBSERVATION_NOT_VERIFIED_FACT' as const,
    semanticAssessment: 'NOT_EVALUATED' as const,
  };
}
