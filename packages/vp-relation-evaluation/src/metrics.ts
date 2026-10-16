import { ratio } from '../../quality-evaluation/src/metrics.js';

import { relationArtifactDigest } from './digest.js';
import type {
  PositiveMetrics,
  RelationEvaluationPlan,
  RelationEvaluationReport,
  RelationObservation,
  RelationReference,
  RelationTuple,
  TupleMetrics,
  OperationalRelationMetrics,
} from './types.js';
import {
  hasAssessedWarrant,
  isDirected,
  isPositive,
  referenceExclusions,
  validateRelationEvaluation,
  externalVerificationErrors,
  warrantAssessmentSubject,
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
  const directed = rows.filter((row) => {
    const tuple = tupleFor(row);
    return tuple !== null && directionEligible(row, tuple, plan);
  });
  const negatives = rows.filter((row) => !expectedPositive(row));
  const allPredicted = rows.filter((row) => {
    const tuple = tupleFor(row);
    return tuple !== null && isPositive(tuple);
  });
  const allPositives = rows.filter(expectedPositive);
  const unknown = rows.filter((row) => !canScore(row, tupleFor(row), plan));
  const unknownCritical = unknown.filter((row) => row.reference.critical).length;
  const criticalHits = hits.filter((row) => row.reference.critical).length;
  const allCritical = allPositives.filter((row) => row.reference.critical).length;
  const point = (numerator: number, denominator: number, unresolved: number) =>
    unresolved > 0 ? { numerator: null, denominator, value: null } : ratio(numerator, denominator);
  const bounds = (lower: number, upper: number, denominator: number) => ({
    lower: ratio(lower, denominator).value,
    upper: ratio(upper, denominator).value,
  });
  const f1Denominator = 2 * tp + fp + fn + 2 * unknown.length;
  return {
    counts: { tp, fp, fn },
    assessment: {
      scope: 'ALL_ELIGIBLE_DETERMINATE_TASKS',
      complete: unknown.length === 0,
      unresolvedWarrants: unknown.length,
      assessedWarrantResponses: rows.filter(
        (row) => row.observation && hasAssessedWarrant(row.reference, row.observation, plan.lane),
      ).length,
      noPredictionPositiveMisses: allPositives.filter((row) => tupleFor(row) === null).length,
    },
    precision: point(tp, allPredicted.length, unknown.length),
    recall: point(tp, allPositives.length, unknown.length),
    f1: point(2 * tp, f1Denominator, unknown.length),
    criticalRecall: point(criticalHits, allCritical, unknownCritical),
    bounds: {
      precision: bounds(tp, tp + unknown.length, allPredicted.length),
      recall: bounds(tp, tp + unknown.length, allPositives.length),
      f1: bounds(2 * tp, 2 * (tp + unknown.length), f1Denominator),
      criticalRecall: bounds(criticalHits, criticalHits + unknownCritical, allCritical),
    },
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

const tupleMetrics = (
  rows: readonly Row[],
  tupleFor: (row: Row) => RelationTuple | null,
): TupleMetrics => {
  const predicted = rows.filter((row) => {
    const tuple = tupleFor(row);
    return tuple !== null && isPositive(tuple);
  });
  const positives = rows.filter(expectedPositive);
  const hits = predicted.filter((row) => matchesKindAndDirection(row, tupleFor(row)!));
  const tp = hits.length;
  const fp = predicted.length - tp;
  const fn = positives.length - tp;
  const directed = predicted.filter(
    (row) => isDirected(tupleFor(row)!) && matchesKind(row, tupleFor(row)!),
  );
  const negatives = rows.filter((row) => !expectedPositive(row));
  return {
    counts: { tp, fp, fn },
    precision: ratio(tp, predicted.length),
    recall: ratio(tp, positives.length),
    f1: ratio(2 * tp, 2 * tp + fp + fn),
    criticalRecall: ratio(
      hits.filter((row) => row.reference.critical).length,
      positives.filter((row) => row.reference.critical).length,
    ),
    conditionalDirectionAccuracy: ratio(
      directed.filter((row) => matchesKindAndDirection(row, tupleFor(row)!)).length,
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

const operationalMetrics = (rows: readonly Row[]): OperationalRelationMetrics => {
  const observed = rows.flatMap((row) => (row.observation ? [row.observation] : []));
  const responses = observed.filter((o) => o.outcome === 'RESPONSE');
  const valid = responses.filter((o) => o.structure === 'VALID');
  const grouped = new Map<string, Row[]>();
  for (const row of rows) {
    const group = grouped.get(row.reference.caseId) ?? [];
    group.push(row);
    grouped.set(row.reference.caseId, group);
  }
  const groups = [...grouped.values()].filter((group) => group.length > 1);
  const complete = groups.filter((group) =>
    group.every((row) => row.observation?.structure === 'VALID'),
  );
  const terminal = groups.filter((group) => group.every((row) => row.observation !== undefined));
  const stable = complete.filter(
    (group) => new Set(group.map((row) => relationArtifactDigest(rawTuple(row)))).size === 1,
  );
  const adoptedStable = terminal.filter(
    (group) =>
      new Set(
        group.map((row) =>
          relationArtifactDigest({
            outcome: row.observation!.outcome,
            adoption: row.observation!.adoption,
            tuple: adoptedTuple(row),
          }),
        ),
      ).size === 1,
  );
  return {
    scope: 'ALL_SCHEDULED_TASKS',
    scheduledTasks: rows.length,
    responseTasks: responses.length,
    structureValidity: ratio(valid.length, responses.length),
    modelAbstentionRate: ratio(
      valid.filter((o) => o.raw?.choice === 'UNRESOLVED').length,
      responses.length,
    ),
    rawTupleStability: ratio(stable.length, complete.length),
    strictAllRunStability: ratio(stable.length, groups.length),
    adoptionStateStability: ratio(adoptedStable.length, terminal.length),
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
  const eligibleResponses = eligible.flatMap((row) =>
    row.observation?.outcome === 'RESPONSE' ? [row.observation] : [],
  );
  const eligibleValid = eligibleResponses.filter(
    (observation) => observation.structure === 'VALID',
  );
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
    .filter((reference) => !excluded.has(reference.caseId))
    .map((reference) => eligible.filter((row) => row.reference.caseId === reference.caseId))
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
    rawOutcomeDecidable: rawScorable.length,
    rawOutcomeUndecidable: determinate.length - rawScorable.length,
    adoptedOutcomeDecidable: adoptionScorable.length,
    adoptedOutcomeUndecidable: determinate.length - adoptionScorable.length,
    assessedWarrantResponses: eligible.filter(
      (row) => row.observation && hasAssessedWarrant(row.reference, row.observation, plan.lane),
    ).length,
    eligibleResponse: eligibleResponses.length,
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
    semanticMetricScope: 'ELIGIBLE_REFERENCES_ONLY' as const,
    operational: operationalMetrics(allRows),
    warrantRejections: eligible.flatMap((row) => {
      const observation = row.observation;
      if (!observation || observation.warrant.status !== 'ASSESSED') return [];
      const reasons = externalVerificationErrors(
        observation.warrant.verification,
        warrantAssessmentSubject(row.reference, observation),
        ['WARRANT'],
      );
      return reasons.length ? [{ taskId: observation.taskId, reasons }] : [];
    }),
    counts,
    coverage: {
      referenceEligibility: ratio(counts.eligibleReferences, plan.references.length),
      referenceCertification: ratio(counts.externallyVerifiedReferences, plan.references.length),
      semanticTaskEligibility: ratio(eligible.length, plan.tasks.length),
      terminalCompletion: ratio(observations.length, plan.tasks.length),
      structureValidity: ratio(eligibleValid.length, eligibleResponses.length),
      kindScorable: ratio(validDeterminate.length, determinate.length),
      rawOutcomeDecidable: ratio(rawScorable.length, determinate.length),
      adoptedOutcomeDecidable: ratio(adoptionScorable.length, determinate.length),
      warrantAssessment: ratio(counts.assessedWarrantResponses, eligibleResponses.length),
      // Operational confirmed yield is not correctness of unobserved/unassessed outputs.
      rawConfirmedPositiveYield: ratio(rawConfirmed.length, positive.length),
      adoptedConfirmedPositiveYield: ratio(adoptedConfirmed.length, positive.length),
      rawRepeatedRunComplete: ratio(rawComplete.length, groups.length),
      terminalRepeatedRunComplete: ratio(terminalComplete.length, groups.length),
    },
    raw: positiveMetrics(determinate, plan, rawTuple),
    adopted: positiveMetrics(determinate, plan, adoptedTuple),
    tupleOnly: {
      raw: tupleMetrics(determinate, rawTuple),
      adopted: tupleMetrics(determinate, adoptedTuple),
    },
    kindCorrectness: ratio(
      validDeterminate.filter((row) => matchesKind(row, rawTuple(row)!)).length,
      validDeterminate.length,
    ),
    explicitNegativeCorrectness: ratio(
      negative.filter((row) => rawTuple(row)?.choice === 'NO_RELATION').length,
      negative.length,
    ),
    modelAbstentionRate: ratio(
      eligibleValid.filter((observation) => observation.raw?.choice === 'UNRESOLVED').length,
      eligibleResponses.length,
    ),
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
