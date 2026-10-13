import { unicodeLength } from '../../contracts/src/document-evidence.js';

import { relationArtifactDigest, relationInputDigest, relationReferenceDigest } from './digest.js';
import { RELATION_MEASUREMENT_VERSION, RELATION_TARGET_REVISIONS } from './types.js';
import type {
  ExternalVerification,
  RelationEvaluationPlan,
  RelationObservation,
  RelationReference,
  RelationTarget,
  RelationTuple,
} from './types.js';

const choices = ['EQUIVALENT', 'SUPPORTS', 'QUALIFIES', 'CONTRADICTS', 'RELATED', 'UNRESOLVED'];
export const isPositive = (tuple: RelationTuple): boolean =>
  tuple.choice !== 'UNRESOLVED' && tuple.choice !== 'NO_RELATION';
export const isDirected = (tuple: RelationTuple): boolean =>
  tuple.choice === 'SUPPORTS' || tuple.choice === 'QUALIFIES';
const fail = (message: string): never => {
  throw new Error(`VP relation evaluation: ${message}`);
};
const assert = (condition: unknown, message: string): void => {
  if (!condition) fail(message);
};
const isDigest = (value: string): boolean => /^sha256:[a-f0-9]{64}$/u.test(value);
const unique = (values: readonly string[], label: string): void =>
  assert(new Set(values).size === values.length, `duplicate ${label}`);

export const validateTuple = (tuple: RelationTuple, target: RelationTarget): void => {
  assert(
    choices.includes(tuple.choice) || (target === 'V11' && tuple.choice === 'NO_RELATION'),
    `choice ${tuple.choice} is not in ${target}`,
  );
  assert(
    isDirected(tuple)
      ? ['LEFT_TO_RIGHT', 'RIGHT_TO_LEFT'].includes(tuple.direction)
      : tuple.direction === 'NONE',
    `invalid direction for ${tuple.choice}`,
  );
};

export const externalVerificationErrors = (
  verification: ExternalVerification,
  subjectDigest: string,
  scopes: readonly ExternalVerification['verificationScope'][number][],
): readonly string[] => {
  const errors: string[] = [];
  if (!['EXTERNAL_HUMAN', 'EQUIVALENT_EXTERNAL_REFERENCE'].includes(verification.method))
    errors.push('EXTERNAL_METHOD_INVALID');
  for (const field of [
    'responsibleParty',
    'recordLocator',
    'checkedBy',
    'expertiseEvidence',
    'independenceEvidence',
    'compatibilityEvidence',
  ] as const) {
    if (!verification[field]?.trim()) errors.push(`MISSING_${field}`);
  }
  if (!isDigest(verification.recordDigest)) errors.push('EXTERNAL_RECORD_DIGEST_INVALID');
  if (!verification.checkedAt || !Number.isFinite(Date.parse(verification.checkedAt)))
    errors.push('EXTERNAL_CHECK_DATE_INVALID');
  if (verification.subjectDigest !== subjectDigest) errors.push('EXTERNAL_SUBJECT_MISMATCH');
  const verificationScopes = verification.verificationScope;
  const validScopes =
    Array.isArray(verificationScopes) &&
    verificationScopes.every((scope) =>
      ['KIND', 'DIRECTION', 'WARRANT', 'INPUT_SUFFICIENCY'].includes(scope),
    ) &&
    new Set(verificationScopes).size === verificationScopes.length;
  if (!validScopes) errors.push('EXTERNAL_SCOPE_INVALID');
  else if (scopes.some((scope) => !verificationScopes.includes(scope)))
    errors.push('EXTERNAL_SCOPE_INCOMPLETE');
  if (typeof verification.unresolvedMaterialDisagreement !== 'boolean')
    errors.push('EXTERNAL_DISAGREEMENT_STATUS_INVALID');
  else if (verification.unresolvedMaterialDisagreement)
    errors.push('UNRESOLVED_MATERIAL_DISAGREEMENT');
  return errors;
};

export const referenceExclusions = (
  reference: RelationReference,
  lane: RelationEvaluationPlan['lane'],
): readonly string[] => {
  const errors: string[] = [];
  if (reference.disposition !== 'DETERMINATE' && reference.disposition !== 'CONTEXT_INSUFFICIENT')
    errors.push(reference.disposition);
  if (reference.input.provenance === 'UNVERIFIED') errors.push('INPUT_UNVERIFIED');
  if (
    lane === 'CERTIFICATION' &&
    !['ACTUAL_WIRE_CAPTURED', 'STRUCTURED_REQUEST_CAPTURED'].includes(reference.input.provenance)
  )
    errors.push('PRODUCT_INPUT_CAPTURE_REQUIRED');
  if (lane === 'CERTIFICATION') {
    if (reference.assurance.status !== 'EXTERNALLY_VERIFIED')
      errors.push('REFERENCE_NOT_EXTERNALLY_VERIFIED');
    else
      errors.push(
        ...externalVerificationErrors(
          reference.assurance.verification,
          reference.referenceDigest,
          reference.disposition === 'CONTEXT_INSUFFICIENT'
            ? ['INPUT_SUFFICIENCY']
            : ['KIND', 'DIRECTION', 'WARRANT', 'INPUT_SUFFICIENCY'],
        ),
      );
  } else if (lane === 'SYNTHETIC_CONTRACT' && reference.assurance.status !== 'SYNTHETIC_CONTRACT')
    errors.push('NOT_SYNTHETIC_CONTRACT');
  return errors;
};

export const warrantAssessmentSubject = (
  reference: RelationReference,
  observation: RelationObservation,
): string =>
  relationArtifactDigest({
    referenceDigest: reference.referenceDigest,
    inputDigest: observation.inputDigest,
    outputDigest: observation.outputDigest,
    raw: observation.raw,
    matchesAlternativeIds:
      'matchesAlternativeIds' in observation.warrant
        ? observation.warrant.matchesAlternativeIds
        : [],
  });

export const hasAssessedWarrant = (
  reference: RelationReference,
  observation: RelationObservation,
  lane: RelationEvaluationPlan['lane'],
): boolean => {
  if (observation.warrant.status === 'ASSESSED')
    return (
      externalVerificationErrors(
        observation.warrant.verification,
        warrantAssessmentSubject(reference, observation),
        ['WARRANT'],
      ).length === 0
    );
  return lane === 'SYNTHETIC_CONTRACT' && observation.warrant.status === 'SYNTHETIC_CONTRACT';
};

export const validateRelationEvaluation = (
  plan: RelationEvaluationPlan,
  observations: readonly RelationObservation[],
): void => {
  assert(plan.version === RELATION_MEASUREMENT_VERSION, 'measurement revision mismatch');
  assert(plan.target === 'V6' || plan.target === 'V11', 'target invalid');
  assert(['CERTIFICATION', 'DIAGNOSTIC', 'SYNTHETIC_CONTRACT'].includes(plan.lane), 'lane invalid');
  assert(['EC_RUNTIME_2000_V1', 'CLAIM_ONLY_V1'].includes(plan.inputProfile), 'profile invalid');
  unique(
    plan.references.map((reference) => reference.caseId),
    'reference case ID',
  );
  unique(
    plan.tasks.map((task) => task.taskId),
    'scheduled task ID',
  );
  unique(
    plan.tasks.map((task) => `${task.caseId}:${task.run}`),
    'case/run identity',
  );
  unique(
    observations.map((observation) => observation.taskId),
    'observation task ID',
  );
  const references = new Map(plan.references.map((reference) => [reference.caseId, reference]));
  const tasks = new Map(plan.tasks.map((task) => [task.taskId, task]));
  for (const reference of plan.references) {
    assert(
      reference.caseId.trim() && Number.isInteger(reference.revision) && reference.revision > 0,
      'reference identity invalid',
    );
    assert(
      reference.input.target === plan.target && reference.input.profile === plan.inputProfile,
      'mixed target/input profile',
    );
    assert(
      reference.input.policyRevision === RELATION_TARGET_REVISIONS[plan.target],
      'policy revision mismatch',
    );
    assert(relationInputDigest(reference.input) === reference.inputDigest, 'input digest mismatch');
    assert(
      relationReferenceDigest(reference) === reference.referenceDigest,
      'reference digest mismatch',
    );
    assert(
      [
        'DETERMINATE',
        'CONTEXT_INSUFFICIENT',
        'DISPUTED',
        'INPUT_PROVENANCE_INVALID',
        'AUTHORITY_OR_ACCESS_FAILURE',
      ].includes(reference.disposition),
      'reference disposition invalid',
    );
    assert(
      ['CANDIDATE', 'UNVERIFIED', 'EXTERNALLY_VERIFIED', 'SYNTHETIC_CONTRACT'].includes(
        reference.assurance.status,
      ),
      'reference assurance invalid',
    );
    const input = reference.input;
    assert(
      [
        'ACTUAL_WIRE_CAPTURED',
        'STRUCTURED_REQUEST_CAPTURED',
        'FROZEN_RECONSTRUCTION_MATCHES_DIGEST',
        'UNVERIFIED',
      ].includes(input.provenance),
      'input provenance invalid',
    );
    for (const field of [
      'projectId',
      'projectorIdentity',
      'adapterIdentity',
      'schemaIdentity',
      'promptIdentity',
      'modelIdentity',
    ] as const)
      assert(input[field].trim(), `input ${field} missing`);
    assert(isDigest(input.semanticRequestDigest), 'semantic request digest invalid');
    if (input.structuredRequestDigest !== null)
      assert(isDigest(input.structuredRequestDigest), 'structured request digest invalid');
    if (input.wireDigest !== null) assert(isDigest(input.wireDigest), 'wire digest invalid');
    if (input.provenance === 'ACTUAL_WIRE_CAPTURED')
      assert(
        input.wireDigest !== null && input.structuredRequestDigest !== null,
        'wire/structured capture missing',
      );
    if (input.provenance === 'STRUCTURED_REQUEST_CAPTURED')
      assert(input.structuredRequestDigest !== null, 'structured capture missing');
    assert(input.left.assertionId !== input.right.assertionId, 'same assertion on both sides');
    for (const assertion of [input.left, input.right]) {
      for (const field of [
        'assertionId',
        'sourceId',
        'sourceVersionId',
        'evidenceId',
        'claim',
      ] as const)
        assert(assertion[field].trim(), `assertion ${field} missing`);
      assert(isDigest(assertion.rawQuoteDigest), 'raw quote digest invalid');
      assert(
        ['public', 'internal', 'private', 'restricted'].includes(assertion.sensitivity),
        'assertion sensitivity invalid',
      );
      assert(
        assertion.accessScope.every((scope) => scope.trim()),
        'assertion access scope invalid',
      );
      unique(assertion.accessScope, 'assertion access scope');
      if (input.profile === 'CLAIM_ONLY_V1')
        assert(
          assertion.context === null && !assertion.truncated && assertion.crop === null,
          'claim-only context supplied',
        );
      if (assertion.context !== null)
        assert(unicodeLength(assertion.context) <= 2_000, 'context limit exceeded');
      if (assertion.truncated)
        assert(
          assertion.context !== null && assertion.crop !== null,
          'truncated context/crop missing',
        );
      if (assertion.crop !== null) {
        assert(assertion.context !== null, 'crop without context');
        const { start, end, rawCodePoints } = assertion.crop;
        assert(
          [start, end, rawCodePoints].every(Number.isInteger) &&
            start >= 0 &&
            start < end &&
            end <= rawCodePoints,
          'crop coordinate invalid',
        );
      }
    }
    unique(
      reference.allowed.map((alternative) => alternative.alternativeId),
      'alternative ID',
    );
    for (const alternative of reference.allowed) {
      validateTuple(alternative, plan.target);
      assert(
        alternative.alternativeId.trim() && alternative.warrant.trim(),
        'alternative/warrant missing',
      );
    }
    if (reference.disposition === 'DETERMINATE') {
      assert(
        reference.allowed.length > 0 &&
          reference.allowed.every((alternative) => alternative.choice !== 'UNRESOLVED'),
        'determinate reference includes abstention',
      );
      assert(
        reference.allowed.every(isPositive) ||
          reference.allowed.every((alternative) => alternative.choice === 'NO_RELATION'),
        'mixed positive/negative reference',
      );
    }
    if (reference.disposition === 'CONTEXT_INSUFFICIENT')
      assert(
        reference.allowed.length === 1 && reference.allowed[0]?.choice === 'UNRESOLVED',
        'insufficient reference must only abstain',
      );
    if (reference.critical)
      assert(
        reference.disposition === 'DETERMINATE' && reference.allowed.every(isPositive),
        'critical reference must be determinate positive',
      );
    if (reference.assurance.status === 'SYNTHETIC_CONTRACT')
      assert(reference.assurance.fixtureIdentity.trim(), 'synthetic identity missing');
    if (reference.assurance.status === 'SYNTHETIC_CONTRACT')
      assert(plan.lane === 'SYNTHETIC_CONTRACT', 'synthetic reference outside synthetic lane');
  }
  for (const task of plan.tasks)
    assert(
      references.has(task.caseId) &&
        Number.isInteger(task.run) &&
        task.run > 0 &&
        task.taskId.trim(),
      'unknown case/invalid run',
    );
  for (const observation of observations) {
    const task = tasks.get(observation.taskId);
    assert(task, 'unscheduled observation');
    const reference = references.get(task!.caseId)!;
    assert(observation.inputDigest === reference.inputDigest, 'observation input mismatch');
    assert(
      ['RESPONSE', 'RUNTIME_FAILURE', 'OUTCOME_UNKNOWN'].includes(observation.outcome),
      'outcome invalid',
    );
    assert(
      ['VALID', 'INVALID', 'NOT_EVALUATED'].includes(observation.structure),
      'structure invalid',
    );
    assert(
      ['NOT_OBSERVED', 'UNVERIFIED', 'ASSESSED', 'SYNTHETIC_CONTRACT'].includes(
        observation.warrant.status,
      ),
      'warrant status invalid',
    );
    if (observation.outcome === 'RESPONSE')
      assert(
        observation.outputDigest !== null && isDigest(observation.outputDigest),
        'response output digest missing',
      );
    else
      assert(
        observation.raw === null &&
          observation.structure === 'NOT_EVALUATED' &&
          observation.outputDigest === null,
        'runtime outcome masquerades as response',
      );
    if (observation.structure === 'VALID') {
      assert(
        observation.outcome === 'RESPONSE' && observation.raw !== null,
        'valid output missing raw declaration',
      );
      validateTuple(observation.raw!, plan.target);
    } else assert(observation.raw === null, 'invalid output cannot be a semantic declaration');
    for (const probability of [observation.selectedLabelProbability, observation.confidence])
      assert(
        probability === null ||
          (Number.isFinite(probability) && probability >= 0 && probability <= 1),
        'probability outside range',
      );
    if (observation.adoption.status === 'ADOPTED')
      assert(
        observation.structure === 'VALID' &&
          observation.raw !== null &&
          isPositive(observation.raw),
        'adoption without positive raw output',
      );
    else
      assert(
        ['WITHHELD', 'NOT_REACHED'].includes(observation.adoption.status) &&
          observation.adoption.reason.trim(),
        'adoption disposition/reason invalid',
      );
    if ('matchesAlternativeIds' in observation.warrant) {
      assert(observation.structure === 'VALID', 'warrant assessment without valid output');
      unique(observation.warrant.matchesAlternativeIds, 'matched alternative ID');
      assert(
        observation.warrant.matchesAlternativeIds.every((id) =>
          reference.allowed.some((alternative) => alternative.alternativeId === id),
        ),
        'unknown warrant alternative',
      );
    }
    if (observation.warrant.status === 'SYNTHETIC_CONTRACT')
      assert(
        plan.lane === 'SYNTHETIC_CONTRACT' && observation.warrant.fixtureIdentity.trim(),
        'synthetic warrant outside synthetic lane',
      );
  }
};
