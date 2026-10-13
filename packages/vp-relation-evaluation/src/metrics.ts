import { ratio } from '../../quality-evaluation/src/metrics.js';

import { relationArtifactDigest } from './digest.js';
import type {
  PositiveMetrics,
  RelationEvaluationPlan,
  RelationEvaluationReport,
  RelationObservation,
  RelationReference,
  RelationTuple,
} from './types.js';
import {
  hasAssessedWarrant,
  isDirected,
  isPositive,
  referenceExclusions,
  validateRelationEvaluation,
} from './validation.js';

type Row = {
  readonly reference: RelationReference;
  readonly observation: RelationObservation | undefined;
};
const rawTuple = (row: Row): RelationTuple | null => row.observation?.raw ?? null;
const adoptedTuple = (row: Row): RelationTuple | null =>
  row.observation?.adoption.status === 'ADOPTED' ? rawTuple(row) : null;
const expectedPositive = (row: Row): boolean => row.reference.allowed.every(isPositive);
const sameTuple = (left: RelationTuple, right: RelationTuple): boolean =>
  left.choice === right.choice && left.direction === right.direction;
const matchesKind = (row: Row, tuple: RelationTuple): boolean =>
  row.reference.allowed.some((allowed) => allowed.choice === tuple.choice);
const matchesKindAndDirection = (row: Row, tuple: RelationTuple): boolean =>
  row.reference.allowed.some((allowed) => sameTuple(allowed, tuple));
const matchingWarrants = (row: Row, plan: RelationEvaluationPlan): readonly string[] => {
  const observation = row.observation;
  if (!observation || !hasAssessedWarrant(row.reference, observation, plan.lane)) return [];
  return 'matchesAlternativeIds' in observation.warrant
    ? observation.warrant.matchesAlternativeIds
    : [];
};
const correct = (row: Row, tuple: RelationTuple, plan: RelationEvaluationPlan): boolean => {
  const warrants = matchingWarrants(row, plan);
  return row.reference.allowed.some(
    (allowed) => sameTuple(allowed, tuple) && warrants.includes(allowed.alternativeId),
  );
};
const directionEligible = (
  row: Row,
  tuple: RelationTuple,
  plan: RelationEvaluationPlan,
): boolean => {
  const warrants = matchingWarrants(row, plan);
  return (
    isDirected(tuple) &&
    row.reference.allowed.some(
      (allowed) => allowed.choice === tuple.choice && warrants.includes(allowed.alternativeId),
    )
  );
};
const canScore = (row: Row, tuple: RelationTuple | null, plan: RelationEvaluationPlan): boolean =>
  tuple === null ||
  !isPositive(tuple) ||
  !expectedPositive(row) ||
  !matchesKindAndDirection(row, tuple) ||
  (row.observation !== undefined && hasAssessedWarrant(row.reference, row.observation, plan.lane));

const positiveMetrics = (
  rows: readonly Row[],
  plan: RelationEvaluationPlan,
  tupleFor: (row: Row) => RelationTuple | null,
): PositiveMetrics => {
  const scorable = rows.filter((row) => canScore(row, tupleFor(row), plan));
  const predicted = scorable.filter((row) => {
    const tuple = tupleFor(row);
    return tuple !== null && isPositive(tuple);
  });
  const positives = scorable.filter(expectedPositive);
  const hits = predicted.filter((row) => correct(row, tupleFor(row)!, plan));
  const tp = hits.length;
  const fp = predicted.length - tp;
  const fn = positives.length - tp;
  const critical = positives.filter((row) => row.reference.critical);
  const directed = rows.filter((row) => {
    const tuple = tupleFor(row);
    return tuple !== null && directionEligible(row, tuple, plan);
  });
  const negatives = rows.filter((row) => !expectedPositive(row));
  return {
    counts: { tp, fp, fn },
    precision: ratio(tp, predicted.length),
    recall: ratio(tp, positives.length),
    f1: ratio(2 * tp, 2 * tp + fp + fn),
    criticalRecall: ratio(hits.filter((row) => row.reference.critical).length, critical.length),
    conditionalDirectionAccuracy: ratio(
      directed.filter((row) => correct(row, tupleFor(row)!, plan)).length,
      directed.length,
    ),
    negativeFalseLinkRate: ratio(
      negatives.filter((row) => {
        const tuple = tupleFor(row);
        return tuple !== null && isPositive(tuple);
      }).length,
      negatives.length,
    ),
  };
};

/** Pure offline measurement. A successful call neither verifies a human nor grants a product authority. */
export const evaluateRelationObservations = (
  plan: RelationEvaluationPlan,
  observations: readonly RelationObservation[],
): RelationEvaluationReport => {
  validateRelationEvaluation(plan, observations);
  const exclusions = plan.references
    .map((reference) => ({
      caseId: reference.caseId,
      reasons: referenceExclusions(reference, plan.lane),
    }))
    .filter((entry) => entry.reasons.length > 0);
  const excluded = new Set(exclusions.map((entry) => entry.caseId));
  const byCase = new Map(plan.references.map((reference) => [reference.caseId, reference]));
  const byTask = new Map(observations.map((observation) => [observation.taskId, observation]));
  const allRows: readonly Row[] = plan.tasks.map((task) => ({
    reference: byCase.get(task.caseId)!,
    observation: byTask.get(task.taskId),
  }));
  const eligible = allRows.filter((row) => !excluded.has(row.reference.caseId));
  const determinate = eligible.filter((row) => row.reference.disposition === 'DETERMINATE');
  const insufficient = eligible.filter(
    (row) => row.reference.disposition === 'CONTEXT_INSUFFICIENT',
  );
  const validDeterminate = determinate.filter((row) => row.observation?.structure === 'VALID');
  const positive = determinate.filter(expectedPositive);
  const negative = determinate.filter((row) => !expectedPositive(row));
  const responses = observations.filter((observation) => observation.outcome === 'RESPONSE');
  const valid = responses.filter((observation) => observation.structure === 'VALID');
  const rawScorable = determinate.filter((row) => canScore(row, rawTuple(row), plan));
  const adoptionScorable = determinate.filter((row) => canScore(row, adoptedTuple(row), plan));
  const rawConfirmed = positive.filter((row) => {
    const tuple = rawTuple(row);
    return tuple !== null && correct(row, tuple, plan);
  });
  const adoptedConfirmed = positive.filter((row) => {
    const tuple = adoptedTuple(row);
    return tuple !== null && correct(row, tuple, plan);
  });
  const groups = plan.references
    .map((reference) => allRows.filter((row) => row.reference.caseId === reference.caseId))
    .filter((rows) => rows.length > 1);
  const rawComplete = groups.filter((rows) =>
    rows.every((row) => row.observation?.structure === 'VALID'),
  );
  const terminalComplete = groups.filter((rows) =>
    rows.every((row) => row.observation !== undefined),
  );
  const rawStable = rawComplete.filter(
    (rows) => new Set(rows.map((row) => relationArtifactDigest(rawTuple(row)))).size === 1,
  );
  const adoptionStable = terminalComplete.filter(
    (rows) =>
      new Set(
        rows.map((row) =>
          relationArtifactDigest({
            outcome: row.observation!.outcome,
            adoption: row.observation!.adoption,
            tuple: adoptedTuple(row),
          }),
        ),
      ).size === 1,
  );
  const counts = {
    submittedReferences: plan.references.length,
    externallyVerifiedReferences: plan.references.filter(
      (reference) =>
        reference.assurance.status === 'EXTERNALLY_VERIFIED' &&
        referenceExclusions(reference, 'CERTIFICATION').length === 0,
    ).length,
    eligibleReferences: plan.references.length - exclusions.length,
    scheduled: plan.tasks.length,
    terminal: observations.length,
    missing: plan.tasks.length - observations.length,
    response: responses.length,
    structureValid: valid.length,
    structureInvalid: responses.filter((observation) => observation.structure === 'INVALID').length,
    structureNotEvaluated: responses.filter(
      (observation) => observation.structure === 'NOT_EVALUATED',
    ).length,
    runtimeFailure: observations.filter((observation) => observation.outcome === 'RUNTIME_FAILURE')
      .length,
    outcomeUnknown: observations.filter((observation) => observation.outcome === 'OUTCOME_UNKNOWN')
      .length,
    voluntaryAbstention: valid.filter((observation) => observation.raw?.choice === 'UNRESOLVED')
      .length,
    explicitNegative: valid.filter((observation) => observation.raw?.choice === 'NO_RELATION')
      .length,
    adopted: observations.filter((observation) => observation.adoption.status === 'ADOPTED').length,
    withheld: observations.filter((observation) => observation.adoption.status === 'WITHHELD')
      .length,
    adoptionNotReached: observations.filter(
      (observation) => observation.adoption.status === 'NOT_REACHED',
    ).length,
    determinateTasks: determinate.length,
    insufficientTasks: insufficient.length,
    positiveTasks: positive.length,
    negativeTasks: negative.length,
    rawFullTupleScorable: rawScorable.length,
    rawWarrantUnassessed: determinate.length - rawScorable.length,
    adoptedFullTupleScorable: adoptionScorable.length,
    adoptedWarrantUnassessed: determinate.length - adoptionScorable.length,
    selectedLabelProbabilityObserved: observations.filter(
      (observation) => observation.selectedLabelProbability !== null,
    ).length,
    selfReportedConfidenceObserved: observations.filter(
      (observation) => observation.confidence !== null,
    ).length,
    repeatedCases: groups.length,
    rawCompleteRepeatedCases: rawComplete.length,
    terminalCompleteRepeatedCases: terminalComplete.length,
  };
  const result = {
    version: plan.version,
    lane: plan.lane,
    target: plan.target,
    inputProfile: plan.inputProfile,
    exclusions,
    counts,
    coverage: {
      referenceEligibility: ratio(counts.eligibleReferences, plan.references.length),
      referenceCertification: ratio(counts.externallyVerifiedReferences, plan.references.length),
      semanticTaskEligibility: ratio(eligible.length, plan.tasks.length),
      terminalCompletion: ratio(observations.length, plan.tasks.length),
      structureValidity: ratio(valid.length, responses.length),
      kindScorable: ratio(validDeterminate.length, determinate.length),
      rawFullTupleScorable: ratio(rawScorable.length, determinate.length),
      adoptedFullTupleScorable: ratio(adoptionScorable.length, determinate.length),
      // Operational confirmed yield is not correctness of unobserved/unassessed outputs.
      rawConfirmedPositiveYield: ratio(rawConfirmed.length, positive.length),
      adoptedConfirmedPositiveYield: ratio(adoptedConfirmed.length, positive.length),
      rawRepeatedRunComplete: ratio(rawComplete.length, groups.length),
      terminalRepeatedRunComplete: ratio(terminalComplete.length, groups.length),
    },
    raw: positiveMetrics(determinate, plan, rawTuple),
    adopted: positiveMetrics(determinate, plan, adoptedTuple),
    kindCorrectness: ratio(
      validDeterminate.filter((row) => matchesKind(row, rawTuple(row)!)).length,
      validDeterminate.length,
    ),
    explicitNegativeCorrectness: ratio(
      negative.filter((row) => rawTuple(row)?.choice === 'NO_RELATION').length,
      negative.length,
    ),
    modelAbstentionRate: ratio(counts.voluntaryAbstention, responses.length),
    abstentionAppropriateness: ratio(
      insufficient.filter((row) => rawTuple(row)?.choice === 'UNRESOLVED').length,
      insufficient.length,
    ),
    rawTupleStability: ratio(rawStable.length, rawComplete.length),
    strictAllRunStability: ratio(rawStable.length, groups.length),
    adoptionStateStability: ratio(adoptionStable.length, terminalComplete.length),
  };
  return {
    ...result,
    resultDigest: relationArtifactDigest({
      plan,
      observations: [...observations].sort((left, right) =>
        left.taskId.localeCompare(right.taskId),
      ),
      result,
    }),
  };
};
