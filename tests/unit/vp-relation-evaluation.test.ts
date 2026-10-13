import { describe, expect, it } from 'vitest';

import {
  evaluateRelationObservations,
  measureVerifiedFrontierCoverage,
  relationArtifactDigest,
  relationInputDigest,
  relationReferenceDigest,
  RELATION_MEASUREMENT_VERSION,
  RELATION_TARGET_REVISIONS,
  validateRelationEvaluation,
} from '../../packages/vp-relation-evaluation/src/index.js';
import type {
  AllowedRelation,
  ExternalVerification,
  RelationEvaluationPlan,
  RelationObservation,
  RelationReference,
  RelationTuple,
} from '../../packages/vp-relation-evaluation/src/index.js';

const hash = (text: unknown) => relationArtifactDigest(text);
const supports: AllowedRelation = {
  alternativeId: 'supports-ltr',
  choice: 'SUPPORTS',
  direction: 'LEFT_TO_RIGHT',
  warrant: 'SYNTHETIC contract witness, not a human semantic approval',
  assumptionRules: [],
};
const negative: AllowedRelation = {
  alternativeId: 'negative',
  choice: 'NO_RELATION',
  direction: 'NONE',
  warrant: 'SYNTHETIC closed fixture negative',
  assumptionRules: [],
};
const unresolved: AllowedRelation = {
  alternativeId: 'insufficient',
  choice: 'UNRESOLVED',
  direction: 'NONE',
  warrant: 'SYNTHETIC missing condition',
  assumptionRules: [],
};
const seal = (reference: RelationReference): RelationReference => {
  const withInput = { ...reference, inputDigest: relationInputDigest(reference.input) };
  return { ...withInput, referenceDigest: relationReferenceDigest(withInput) };
};
const reference = (
  caseId = 'synthetic-case',
  allowed: readonly AllowedRelation[] = [supports],
): RelationReference =>
  seal({
    caseId,
    revision: 1,
    critical: true,
    disposition: 'DETERMINATE',
    allowed,
    input: {
      profile: 'EC_RUNTIME_2000_V1',
      target: 'V6',
      policyRevision: RELATION_TARGET_REVISIONS.V6,
      projectId: 'synthetic-project',
      projectorIdentity: 'synthetic-projector',
      adapterIdentity: 'synthetic-adapter',
      schemaIdentity: 'synthetic-schema',
      promptIdentity: 'synthetic-prompt',
      modelIdentity: 'synthetic-fake',
      provenance: 'STRUCTURED_REQUEST_CAPTURED',
      semanticRequestDigest: hash('synthetic-semantic'),
      structuredRequestDigest: hash('synthetic-structured'),
      wireDigest: null,
      left: {
        assertionId: 'a',
        sourceId: 'source-a',
        sourceVersionId: 'a1',
        evidenceId: 'ea',
        claim: 'A',
        context: 'A',
        truncated: false,
        rawQuoteDigest: hash('A'),
        crop: { start: 0, end: 1, rawCodePoints: 1 },
        accessScope: ['synthetic-scope'],
        sensitivity: 'public',
      },
      right: {
        assertionId: 'b',
        sourceId: 'source-b',
        sourceVersionId: 'b1',
        evidenceId: 'eb',
        claim: 'B',
        context: 'B',
        truncated: false,
        rawQuoteDigest: hash('B'),
        crop: { start: 0, end: 1, rawCodePoints: 1 },
        accessScope: ['synthetic-scope'],
        sensitivity: 'public',
      },
    },
    inputDigest: '',
    referenceDigest: '',
    assurance: { status: 'SYNTHETIC_CONTRACT', fixtureIdentity: 'synthetic-unit-only' },
  });
const plan = (references = [reference()], runs = 1): RelationEvaluationPlan => ({
  version: RELATION_MEASUREMENT_VERSION,
  lane: 'SYNTHETIC_CONTRACT',
  target: references[0]?.input.target ?? 'V6',
  inputProfile: references[0]?.input.profile ?? 'EC_RUNTIME_2000_V1',
  references,
  tasks: references.flatMap((entry) =>
    Array.from({ length: runs }, (_, index) => ({
      taskId: `${entry.caseId}:${index + 1}`,
      caseId: entry.caseId,
      run: index + 1,
    })),
  ),
});
const observation = (
  entry = reference(),
  raw: RelationTuple = supports,
  run = 1,
): RelationObservation => ({
  taskId: `${entry.caseId}:${run}`,
  inputDigest: entry.inputDigest,
  outcome: 'RESPONSE',
  outputDigest: hash({ raw, run }),
  structure: 'VALID',
  raw,
  warrant: {
    status: 'SYNTHETIC_CONTRACT',
    fixtureIdentity: 'synthetic-unit-only',
    matchesAlternativeIds: [entry.allowed[0]!.alternativeId],
  },
  selectedLabelProbability: 0.9,
  confidence: 0.95,
  adoption:
    raw.choice === 'UNRESOLVED' || raw.choice === 'NO_RELATION'
      ? { status: 'WITHHELD', reason: 'NO_POSITIVE_DECLARATION' }
      : { status: 'ADOPTED' },
});

// Deliberately fictional records test format rejection only. They are never emitted as Gold artifacts.
const externalFormatExample = (subjectDigest: string): ExternalVerification => ({
  method: 'EXTERNAL_HUMAN',
  responsibleParty: 'FICTIONAL_FORMAT_TEST_NOT_A_PERSON',
  recordLocator: 'synthetic://format-test-not-a-review',
  recordDigest: hash('not-real-review'),
  checkedAt: '2026-10-12T00:00:00Z',
  checkedBy: 'synthetic-format-test',
  expertiseEvidence: 'fictional-unit-format',
  independenceEvidence: 'fictional-unit-format',
  verificationScope: ['KIND', 'DIRECTION', 'WARRANT', 'INPUT_SUFFICIENCY'],
  subjectDigest,
  compatibilityEvidence: 'fictional-unit-format',
  unresolvedMaterialDisagreement: false,
});

describe('VP relation measurement synthetic contract only', () => {
  it('uses null for empty precision, recall, direction and stability denominators', () => {
    const report = evaluateRelationObservations(plan([]), []);
    expect(report.raw.precision).toEqual({ numerator: 0, denominator: 0, value: null });
    expect(report.raw.recall.value).toBeNull();
    expect(report.adopted.conditionalDirectionAccuracy.value).toBeNull();
    expect(report.rawTupleStability.value).toBeNull();
  });
  it('counts wrong direction as FP plus FN and retains it in conditional direction denominator', () => {
    const entry = reference();
    const report = evaluateRelationObservations(plan([entry]), [
      observation(entry, { choice: 'SUPPORTS', direction: 'RIGHT_TO_LEFT' }),
    ]);
    expect(report.raw.counts).toEqual({ tp: 0, fp: 1, fn: 1 });
    expect(report.adopted.conditionalDirectionAccuracy).toEqual({
      numerator: 0,
      denominator: 1,
      value: 0,
    });
  });
  it('does not credit undirected wrong kinds as correct directed predictions', () => {
    const entry = reference();
    const report = evaluateRelationObservations(plan([entry]), [
      observation(entry, { choice: 'EQUIVALENT', direction: 'NONE' }),
    ]);
    expect(report.adopted.conditionalDirectionAccuracy.value).toBeNull();
    expect(report.raw.counts).toEqual({ tp: 0, fp: 1, fn: 1 });
  });
  it('separates raw correct declaration from withheld adoption', () => {
    const entry = reference();
    const withheld = {
      ...observation(entry),
      adoption: { status: 'WITHHELD', reason: 'CHOICE_PROBABILITY_BELOW_THRESHOLD' },
    } as const;
    const report = evaluateRelationObservations(plan([entry]), [withheld]);
    expect(report.raw.counts.tp).toBe(1);
    expect(report.adopted.counts).toEqual({ tp: 0, fp: 0, fn: 1 });
    expect(report.adopted.conditionalDirectionAccuracy.value).toBeNull();
  });
  it('does not turn unobserved warrant into certified accuracy or an automatic semantic FN', () => {
    const entry = reference();
    const report = evaluateRelationObservations(plan([entry]), [
      { ...observation(entry), warrant: { status: 'NOT_OBSERVED' } },
    ]);
    expect(report.kindCorrectness.value).toBe(1);
    expect(report.raw.precision.value).toBeNull();
    expect(report.raw.recall.value).toBeNull();
    expect(report.raw.counts.fn).toBe(0);
    expect(report.coverage.rawFullTupleScorable!.value).toBe(0);
    expect(report.coverage.rawConfirmedPositiveYield!.value).toBe(0);
    expect(report.raw.conditionalDirectionAccuracy.value).toBeNull();
  });
  it('accepts one complete alternative without combining another alternative direction/warrant', () => {
    const alternative: AllowedRelation = {
      ...supports,
      alternativeId: 'qualifies-rtl',
      choice: 'QUALIFIES',
      direction: 'RIGHT_TO_LEFT',
    };
    const entry = reference('alternatives', [supports, alternative]);
    const complete = {
      ...observation(entry, alternative),
      warrant: {
        status: 'SYNTHETIC_CONTRACT',
        fixtureIdentity: 'test',
        matchesAlternativeIds: [alternative.alternativeId],
      },
    } as const;
    expect(evaluateRelationObservations(plan([entry]), [complete]).raw.counts.tp).toBe(1);
    const wrongWitness = {
      ...complete,
      warrant: { ...complete.warrant, matchesAlternativeIds: [supports.alternativeId] },
    };
    expect(evaluateRelationObservations(plan([entry]), [wrongWitness]).raw.counts).toEqual({
      tp: 0,
      fp: 1,
      fn: 1,
    });
  });
  it('preserves missing, runtime failure, outcome unknown, invalid and model abstention as separate counts', () => {
    const entry = reference();
    const response = observation(entry);
    const invalid = {
      ...response,
      taskId: `${entry.caseId}:2`,
      structure: 'INVALID',
      raw: null,
      warrant: { status: 'NOT_OBSERVED' },
      adoption: { status: 'NOT_REACHED', reason: 'OUTPUT_SCHEMA_INVALID' },
    } as const;
    const unknown = {
      ...response,
      taskId: `${entry.caseId}:3`,
      outcome: 'OUTCOME_UNKNOWN',
      outputDigest: null,
      structure: 'NOT_EVALUATED',
      raw: null,
      warrant: { status: 'NOT_OBSERVED' },
      adoption: { status: 'NOT_REACHED', reason: 'OUTCOME_UNKNOWN' },
    } as const;
    const failure = {
      ...unknown,
      taskId: `${entry.caseId}:4`,
      outcome: 'RUNTIME_FAILURE',
    } as const;
    const abstention = observation(entry, { choice: 'UNRESOLVED', direction: 'NONE' }, 5);
    const report = evaluateRelationObservations(plan([entry], 6), [
      response,
      invalid,
      unknown,
      failure,
      abstention,
    ]);
    expect(report.counts).toMatchObject({
      scheduled: 6,
      terminal: 5,
      missing: 1,
      response: 3,
      structureValid: 2,
      structureInvalid: 1,
      outcomeUnknown: 1,
      runtimeFailure: 1,
      voluntaryAbstention: 1,
    });
    expect(report.modelAbstentionRate).toEqual({
      numerator: 1,
      denominator: 3,
      value: 0.333333333333,
    });
    expect(report.raw.counts).toEqual({ tp: 1, fp: 0, fn: 5 });
  });
  it('supports explicit negative only in v11 and never treats abstention as a true negative', () => {
    const original = reference('negative', [negative]);
    const entry = seal({
      ...original,
      critical: false,
      input: { ...original.input, target: 'V11', policyRevision: RELATION_TARGET_REVISIONS.V11 },
    });
    expect(
      evaluateRelationObservations(plan([entry]), [observation(entry, negative)])
        .explicitNegativeCorrectness.value,
    ).toBe(1);
    const abstention = evaluateRelationObservations(plan([entry]), [
      observation(entry, { choice: 'UNRESOLVED', direction: 'NONE' }),
    ]);
    expect(abstention.explicitNegativeCorrectness.value).toBe(0);
    expect(abstention.raw.negativeFalseLinkRate.value).toBe(0);
    const positive = evaluateRelationObservations(plan([entry]), [observation(entry, supports)]);
    expect(positive.raw.counts.fp).toBe(1);
    expect(positive.raw.negativeFalseLinkRate.value).toBe(1);
    expect(() => validateRelationEvaluation(plan([original]), [])).toThrow('not in V6');
  });
  it('isolates independently classified insufficient-input abstention diagnostics', () => {
    const entry = seal({
      ...reference('insufficient', [unresolved]),
      disposition: 'CONTEXT_INSUFFICIENT',
      critical: false,
    });
    const report = evaluateRelationObservations(plan([entry]), [observation(entry, unresolved)]);
    expect(report.abstentionAppropriateness.value).toBe(1);
    expect(report.raw.recall.value).toBeNull();
    expect(report.counts.insufficientTasks).toBe(1);
  });
  it('separates changing raw kinds from stable withholding', () => {
    const entry = reference();
    const choices: RelationTuple[] = [
      supports,
      { choice: 'QUALIFIES', direction: 'LEFT_TO_RIGHT' },
      { choice: 'CONTRADICTS', direction: 'NONE' },
    ];
    const observations = choices.map(
      (raw, index) =>
        ({
          ...observation(entry, raw, index + 1),
          adoption: { status: 'WITHHELD', reason: 'GATE_REJECTION' },
        }) as const,
    );
    const report = evaluateRelationObservations(plan([entry], 3), observations);
    expect(report.rawTupleStability.value).toBe(0);
    expect(report.adoptionStateStability.value).toBe(1);
  });
  it('never counts incomplete or invalid repetitions as stable success', () => {
    const entry = reference();
    const report = evaluateRelationObservations(plan([entry], 3), [observation(entry)]);
    expect(report.rawTupleStability.value).toBeNull();
    expect(report.strictAllRunStability.value).toBe(0);
    expect(report.adoptionStateStability.value).toBeNull();
    expect(report.coverage.rawRepeatedRunComplete!.value).toBe(0);
  });
  it('excludes unapproved candidates from certification while allowing explicitly diagnostic kind results', () => {
    const entry = { ...reference(), assurance: { status: 'CANDIDATE' } } as const;
    const result = observation(entry);
    const native = { ...result, warrant: { status: 'NOT_OBSERVED' } } as const;
    const base = plan([entry]);
    const certificate = evaluateRelationObservations({ ...base, lane: 'CERTIFICATION' }, [native]);
    expect(certificate.exclusions[0]?.reasons).toContain('REFERENCE_NOT_EXTERNALLY_VERIFIED');
    expect(certificate.kindCorrectness.value).toBeNull();
    expect(certificate.coverage.referenceCertification!.value).toBe(0);
    expect(
      evaluateRelationObservations({ ...base, lane: 'DIAGNOSTIC' }, [native]).kindCorrectness.value,
    ).toBe(1);
  });
  it('checks external verification subject, scope and disagreement without authenticating human records', () => {
    const original = reference();
    const verification = {
      ...externalFormatExample(hash('wrong')),
      verificationScope: ['KIND'],
      unresolvedMaterialDisagreement: true,
    } as const;
    const entry: RelationReference = {
      ...original,
      assurance: { status: 'EXTERNALLY_VERIFIED', verification },
    };
    const report = evaluateRelationObservations({ ...plan([entry]), lane: 'CERTIFICATION' }, []);
    expect(report.exclusions[0]?.reasons).toEqual(
      expect.arrayContaining([
        'EXTERNAL_SUBJECT_MISMATCH',
        'EXTERNAL_SCOPE_INCOMPLETE',
        'UNRESOLVED_MATERIAL_DISAGREEMENT',
      ]),
    );
  });
  it.each([
    [
      'missing disagreement status',
      { unresolvedMaterialDisagreement: undefined },
      'EXTERNAL_DISAGREEMENT_STATUS_INVALID',
    ],
    [
      'null disagreement status',
      { unresolvedMaterialDisagreement: null },
      'EXTERNAL_DISAGREEMENT_STATUS_INVALID',
    ],
    [
      'string disagreement status',
      { unresolvedMaterialDisagreement: 'false' },
      'EXTERNAL_DISAGREEMENT_STATUS_INVALID',
    ],
    [
      'string scope',
      { verificationScope: 'KIND DIRECTION WARRANT INPUT_SUFFICIENCY' },
      'EXTERNAL_SCOPE_INVALID',
    ],
    [
      'unknown scope role',
      {
        verificationScope: ['KIND', 'DIRECTION', 'WARRANT', 'INPUT_SUFFICIENCY', 'CANONICAL_OWNER'],
      },
      'EXTERNAL_SCOPE_INVALID',
    ],
    [
      'duplicate scope',
      { verificationScope: ['KIND', 'DIRECTION', 'WARRANT', 'INPUT_SUFFICIENCY', 'KIND'] },
      'EXTERNAL_SCOPE_INVALID',
    ],
    ['invalid external method', { method: 'AI_CONSENSUS' }, 'EXTERNAL_METHOD_INVALID'],
    [
      'material disagreement',
      { unresolvedMaterialDisagreement: true },
      'UNRESOLVED_MATERIAL_DISAGREEMENT',
    ],
  ] as const)(
    'excludes %s provenance from certification and Frontier membership',
    (_label, malformed, reason) => {
      const original = reference();
      // Round-trip represents supplied JSON artifacts, including an absent mandatory field.
      const verification = JSON.parse(
        JSON.stringify({
          ...externalFormatExample(original.referenceDigest),
          ...malformed,
        }),
      ) as ExternalVerification;
      const entry: RelationReference = {
        ...original,
        assurance: { status: 'EXTERNALLY_VERIFIED', verification },
      };
      const base: RelationEvaluationPlan = { ...plan([entry]), lane: 'CERTIFICATION' };
      const report = evaluateRelationObservations(base, []);
      expect(report.exclusions[0]?.reasons).toContain(reason);
      expect(report.counts.externallyVerifiedReferences).toBe(0);
      expect(report.coverage.referenceCertification!.value).toBe(0);
      const frontier = measureVerifiedFrontierCoverage(base, {
        frontierRevision: 'synthetic-format-only',
        selectionEvidenceDigest: hash('synthetic-format-only'),
        referenceSetDigest: relationArtifactDigest(base.references),
        selectedCaseIds: [entry.caseId],
      });
      expect(frontier.exclusions[0]?.reasons).toContain(reason);
      expect(frontier.eligiblePositive).toBe(0);
      expect(frontier.overallRecall.value).toBeNull();
      expect(frontier.criticalRecall.value).toBeNull();
    },
  );
  it('keeps frozen reconstruction below actual product-input capture certification', () => {
    const original = reference();
    const withInput = seal({
      ...original,
      input: { ...original.input, provenance: 'FROZEN_RECONSTRUCTION_MATCHES_DIGEST' },
    });
    const entry: RelationReference = {
      ...withInput,
      assurance: {
        status: 'EXTERNALLY_VERIFIED',
        verification: externalFormatExample(withInput.referenceDigest),
      },
    };
    const report = evaluateRelationObservations({ ...plan([entry]), lane: 'CERTIFICATION' }, []);
    expect(report.exclusions[0]?.reasons).toContain('PRODUCT_INPUT_CAPTURE_REQUIRED');
  });
  it('never allows synthetic contracts to masquerade as actual certification', () => {
    expect(() => evaluateRelationObservations({ ...plan(), lane: 'CERTIFICATION' }, [])).toThrow(
      'synthetic reference outside synthetic lane',
    );
  });
  it.each(['DISPUTED', 'INPUT_PROVENANCE_INVALID', 'AUTHORITY_OR_ACCESS_FAILURE'] as const)(
    'discloses excluded %s references rather than assigning NO_RELATION',
    (disposition) => {
      const entry = seal({ ...reference(), disposition, critical: false });
      const report = evaluateRelationObservations(plan([entry]), [observation(entry)]);
      expect(report.exclusions).toEqual([{ caseId: entry.caseId, reasons: [disposition] }]);
      expect(report.raw.recall.value).toBeNull();
    },
  );
  it('rejects duplicated, unscheduled or mismatched observations', () => {
    const entry = reference();
    const result = observation(entry);
    expect(() => evaluateRelationObservations(plan([entry]), [result, result])).toThrow(
      'duplicate observation',
    );
    expect(() =>
      evaluateRelationObservations(plan([entry]), [{ ...result, taskId: 'not-scheduled' }]),
    ).toThrow('unscheduled');
    expect(() =>
      evaluateRelationObservations(plan([entry]), [{ ...result, inputDigest: hash('different') }]),
    ).toThrow('input mismatch');
  });
  it('rejects stale reference/input bytes and policy/profile mixing', () => {
    const entry = reference();
    expect(() => evaluateRelationObservations(plan([{ ...entry, revision: 2 }]), [])).toThrow(
      'reference digest mismatch',
    );
    expect(() =>
      evaluateRelationObservations(
        plan([
          { ...entry, input: { ...entry.input, left: { ...entry.input.left, claim: 'changed' } } },
        ]),
        [],
      ),
    ).toThrow('input digest mismatch');
    const wrongPolicy = seal({
      ...entry,
      input: { ...entry.input, policyRevision: RELATION_TARGET_REVISIONS.V11 },
    });
    expect(() => evaluateRelationObservations(plan([wrongPolicy]), [])).toThrow(
      'policy revision mismatch',
    );
    expect(() =>
      evaluateRelationObservations({ ...plan([entry]), inputProfile: 'CLAIM_ONLY_V1' }, []),
    ).toThrow('mixed target/input profile');
  });
  it('enforces claim-only separation and Unicode context/crop constraints without rewriting inputs', () => {
    const entry = reference();
    const claimOnly = seal({ ...entry, input: { ...entry.input, profile: 'CLAIM_ONLY_V1' } });
    expect(() => evaluateRelationObservations(plan([claimOnly]), [])).toThrow(
      'claim-only context supplied',
    );
    const long = seal({
      ...entry,
      input: { ...entry.input, left: { ...entry.input.left, context: '😀'.repeat(2001) } },
    });
    expect(() => evaluateRelationObservations(plan([long]), [])).toThrow('context limit');
    const crop = seal({
      ...entry,
      input: {
        ...entry.input,
        left: { ...entry.input.left, crop: { start: 1, end: 2, rawCodePoints: 1 } },
      },
    });
    expect(() => evaluateRelationObservations(plan([crop]), [])).toThrow('crop coordinate invalid');
  });
  it('rejects schema/runtime/adoption contradictions and malformed confidence', () => {
    const entry = reference();
    const result = observation(entry);
    expect(() =>
      evaluateRelationObservations(plan([entry]), [{ ...result, outcome: 'OUTCOME_UNKNOWN' }]),
    ).toThrow('runtime outcome');
    expect(() =>
      evaluateRelationObservations(plan([entry]), [
        { ...result, raw: { choice: 'UNRESOLVED', direction: 'NONE' } },
      ]),
    ).toThrow('adoption without positive');
    expect(() =>
      evaluateRelationObservations(plan([entry]), [{ ...result, confidence: Number.NaN }]),
    ).toThrow('probability outside');
    expect(() =>
      evaluateRelationObservations(plan([entry]), [
        {
          ...result,
          warrant: {
            status: 'SYNTHETIC_CONTRACT',
            fixtureIdentity: 'test',
            matchesAlternativeIds: ['missing'],
          },
        },
      ]),
    ).toThrow('unknown warrant');
  });
  it('binds report digest to task/input/reference/output while tolerating observation order', () => {
    const entry = reference();
    const first = observation(entry, supports, 1);
    const second = observation(entry, supports, 2);
    const base = plan([entry], 2);
    expect(evaluateRelationObservations(base, [first, second]).resultDigest).toBe(
      evaluateRelationObservations(base, [second, first]).resultDigest,
    );
    expect(
      evaluateRelationObservations(base, [first, { ...second, outputDigest: hash('different') }])
        .resultDigest,
    ).not.toBe(evaluateRelationObservations(base, [first, second]).resultDigest);
  });
  it('does not turn synthetic/candidate Frontier membership into certified recall', () => {
    const base = plan();
    const result = measureVerifiedFrontierCoverage(base, {
      frontierRevision: 'synthetic-selection',
      selectionEvidenceDigest: hash('selected'),
      referenceSetDigest: relationArtifactDigest(base.references),
      selectedCaseIds: [base.references[0]!.caseId],
    });
    expect(result.overallRecall.value).toBeNull();
    expect(result.criticalRecall.value).toBeNull();
    expect(result.exclusions[0]?.reasons).toContain('REFERENCE_NOT_EXTERNALLY_VERIFIED');
  });
});
