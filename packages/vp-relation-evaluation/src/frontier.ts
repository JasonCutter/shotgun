import { ratio } from '../../quality-evaluation/src/metrics.js';

import { relationArtifactDigest } from './digest.js';
import type { RelationEvaluationPlan } from './types.js';
import { isPositive, referenceExclusions, validateRelationEvaluation } from './validation.js';

/** Observed selection artifact against independently verified positive membership, not all N² pairs. */
export const measureVerifiedFrontierCoverage = (
  plan: RelationEvaluationPlan,
  selection: {
    readonly frontierRevision: string;
    readonly selectionEvidenceDigest: string;
    readonly referenceSetDigest: string;
    readonly selectedCaseIds: readonly string[];
  },
) => {
  validateRelationEvaluation(plan, []);
  if (
    !selection.frontierRevision.trim() ||
    !/^sha256:[a-f0-9]{64}$/u.test(selection.selectionEvidenceDigest)
  )
    throw new Error('Frontier selection evidence missing');
  if (selection.referenceSetDigest !== relationArtifactDigest(plan.references))
    throw new Error('Frontier reference set digest mismatch');
  const ids = new Set(plan.references.map((reference) => reference.caseId));
  const selected = new Set(selection.selectedCaseIds);
  if (
    selected.size !== selection.selectedCaseIds.length ||
    selection.selectedCaseIds.some((id) => !ids.has(id))
  )
    throw new Error('Frontier duplicate/unknown selected case');
  const exclusions = plan.references
    .map((reference) => ({
      caseId: reference.caseId,
      reasons: referenceExclusions(reference, 'CERTIFICATION'),
    }))
    .filter((entry) => entry.reasons.length > 0);
  const excluded = new Set(exclusions.map((entry) => entry.caseId));
  const positives = plan.references.filter(
    (reference) =>
      !excluded.has(reference.caseId) &&
      reference.disposition === 'DETERMINATE' &&
      reference.allowed.every(isPositive),
  );
  const critical = positives.filter((reference) => reference.critical);
  return {
    frontierRevision: selection.frontierRevision,
    selectionEvidenceDigest: selection.selectionEvidenceDigest,
    referenceSetDigest: selection.referenceSetDigest,
    submitted: plan.references.length,
    eligiblePositive: positives.length,
    eligibleCritical: critical.length,
    exclusions,
    overallRecall: ratio(
      positives.filter((reference) => selected.has(reference.caseId)).length,
      positives.length,
    ),
    criticalRecall: ratio(
      critical.filter((reference) => selected.has(reference.caseId)).length,
      critical.length,
    ),
  };
};
