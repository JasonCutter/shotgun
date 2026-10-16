import type { MetricValue } from '../../quality-evaluation/src/types.js';

export const RELATION_MEASUREMENT_VERSION = 'VP05_RELATION_MEASUREMENT_0.2' as const;
export const RELATION_TARGET_REVISIONS = {
  V6: 'vp-deepseek-relation-v6-evidence-context',
  V11: 'vp-deepseek-relation-v11-contractual-protocol-and-physical-generalization',
} as const;
export type RelationTarget = keyof typeof RELATION_TARGET_REVISIONS;
export type RelationChoice =
  | 'EQUIVALENT'
  | 'SUPPORTS'
  | 'QUALIFIES'
  | 'CONTRADICTS'
  | 'RELATED'
  | 'NO_RELATION'
  | 'UNRESOLVED';
export type RelationDirection = 'NONE' | 'LEFT_TO_RIGHT' | 'RIGHT_TO_LEFT';
export type RelationTuple = {
  readonly choice: RelationChoice;
  readonly direction: RelationDirection;
};
export type InputProfile = 'EC_RUNTIME_2000_V1' | 'CLAIM_ONLY_V1';

export type EvaluationAssertion = {
  readonly assertionId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly evidenceId: string;
  readonly claim: string;
  readonly context: string | null;
  readonly truncated: boolean;
  readonly rawQuoteDigest: string;
  /** Source offsets exclude runtime ellipsis markers. */
  readonly crop: {
    readonly start: number;
    readonly end: number;
    readonly rawCodePoints: number;
  } | null;
  readonly accessScope: readonly string[];
  readonly sensitivity: 'public' | 'internal' | 'private' | 'restricted';
};
export type RelationInput = {
  readonly profile: InputProfile;
  readonly target: RelationTarget;
  readonly policyRevision: string;
  readonly projectId: string;
  readonly left: EvaluationAssertion;
  readonly right: EvaluationAssertion;
  readonly projectorIdentity: string;
  readonly adapterIdentity: string;
  readonly schemaIdentity: string;
  readonly promptIdentity: string;
  readonly modelIdentity: string;
  readonly provenance:
    | 'ACTUAL_WIRE_CAPTURED'
    | 'STRUCTURED_REQUEST_CAPTURED'
    | 'FROZEN_RECONSTRUCTION_MATCHES_DIGEST'
    | 'UNVERIFIED';
  readonly semanticRequestDigest: string;
  readonly structuredRequestDigest: string | null;
  readonly wireDigest: string | null;
};

/** These fields record externally checked evidence; validators cannot authenticate a person. */
export type ExternalVerification = {
  readonly method: 'EXTERNAL_HUMAN' | 'EQUIVALENT_EXTERNAL_REFERENCE';
  readonly responsibleParty: string;
  readonly recordLocator: string;
  readonly recordDigest: string;
  readonly checkedAt: string;
  readonly checkedBy: string;
  readonly expertiseEvidence: string;
  readonly independenceEvidence: string;
  readonly verificationScope: readonly ('KIND' | 'DIRECTION' | 'WARRANT' | 'INPUT_SUFFICIENCY')[];
  readonly subjectDigest: string;
  readonly compatibilityEvidence: string;
  readonly unresolvedMaterialDisagreement: boolean;
};
export type ReferenceAssurance =
  | { readonly status: 'CANDIDATE' | 'UNVERIFIED' }
  | { readonly status: 'EXTERNALLY_VERIFIED'; readonly verification: ExternalVerification }
  | { readonly status: 'SYNTHETIC_CONTRACT'; readonly fixtureIdentity: string };
export type AllowedRelation = RelationTuple & {
  readonly alternativeId: string;
  readonly warrant: string;
  readonly assumptionRules: readonly string[];
};
export type RelationReference = {
  readonly caseId: string;
  readonly revision: number;
  readonly input: RelationInput;
  readonly inputDigest: string;
  readonly referenceDigest: string;
  readonly disposition:
    | 'DETERMINATE'
    | 'CONTEXT_INSUFFICIENT'
    | 'DISPUTED'
    | 'INPUT_PROVENANCE_INVALID'
    | 'AUTHORITY_OR_ACCESS_FAILURE';
  readonly critical: boolean;
  readonly allowed: readonly AllowedRelation[];
  readonly assurance: ReferenceAssurance;
};
export type EvaluationTask = {
  readonly taskId: string;
  readonly caseId: string;
  readonly run: number;
};
export type RelationEvaluationPlan = {
  readonly version: typeof RELATION_MEASUREMENT_VERSION;
  readonly lane: 'CERTIFICATION' | 'DIAGNOSTIC' | 'SYNTHETIC_CONTRACT';
  readonly target: RelationTarget;
  readonly inputProfile: InputProfile;
  readonly references: readonly RelationReference[];
  readonly tasks: readonly EvaluationTask[];
};

export type WarrantAssessment =
  | { readonly status: 'NOT_OBSERVED' | 'UNVERIFIED' }
  | {
      readonly status: 'ASSESSED';
      readonly matchesAlternativeIds: readonly string[];
      readonly verification: ExternalVerification;
    }
  | {
      readonly status: 'SYNTHETIC_CONTRACT';
      readonly matchesAlternativeIds: readonly string[];
      readonly fixtureIdentity: string;
    };
export type RelationObservation = {
  readonly taskId: string;
  readonly inputDigest: string;
  readonly outcome: 'RESPONSE' | 'RUNTIME_FAILURE' | 'OUTCOME_UNKNOWN';
  readonly outputDigest: string | null;
  readonly structure: 'VALID' | 'INVALID' | 'NOT_EVALUATED';
  readonly raw: RelationTuple | null;
  readonly warrant: WarrantAssessment;
  /** Probability of the selected label, not probability of full semantic correctness. */
  readonly selectedLabelProbability: number | null;
  /** Self-report, retained separately; never used to assert correctness or change the gate. */
  readonly confidence: number | null;
  readonly adoption:
    | { readonly status: 'ADOPTED' }
    | { readonly status: 'WITHHELD'; readonly reason: string }
    | { readonly status: 'NOT_REACHED'; readonly reason: string };
};
export type TupleMetrics = {
  readonly counts: { readonly tp: number; readonly fp: number; readonly fn: number };
  readonly precision: MetricValue;
  readonly recall: MetricValue;
  readonly f1: MetricValue;
  readonly criticalRecall: MetricValue;
  readonly conditionalDirectionAccuracy: MetricValue;
  readonly negativeFalseLinkRate: MetricValue;
};
export type PartialAssessmentMetric = {
  /** Unknown TP count is not zero. */
  readonly numerator: number | null;
  readonly denominator: number;
  readonly value: number | null;
};
export type MetricBounds = { readonly lower: number | null; readonly upper: number | null };
export type PositiveMetrics = Omit<
  TupleMetrics,
  'precision' | 'recall' | 'f1' | 'criticalRecall'
> & {
  /** Counts cover confirmed outcomes only, not an imputed classification of unknown warrants. */
  readonly assessment: {
    readonly scope: 'ALL_ELIGIBLE_DETERMINATE_TASKS';
    readonly complete: boolean;
    readonly unresolvedWarrants: number;
    readonly assessedWarrantResponses: number;
    readonly noPredictionPositiveMisses: number;
  };
  readonly precision: PartialAssessmentMetric;
  readonly recall: PartialAssessmentMetric;
  readonly f1: PartialAssessmentMetric;
  readonly criticalRecall: PartialAssessmentMetric;
  readonly bounds: {
    readonly precision: MetricBounds;
    readonly recall: MetricBounds;
    readonly f1: MetricBounds;
    readonly criticalRecall: MetricBounds;
  };
};
export type OperationalRelationMetrics = {
  readonly scope: 'ALL_SCHEDULED_TASKS';
  readonly scheduledTasks: number;
  readonly responseTasks: number;
  readonly structureValidity: MetricValue;
  readonly modelAbstentionRate: MetricValue;
  readonly rawTupleStability: MetricValue;
  readonly strictAllRunStability: MetricValue;
  readonly adoptionStateStability: MetricValue;
};
export type RelationEvaluationReport = {
  readonly version: typeof RELATION_MEASUREMENT_VERSION;
  readonly lane: RelationEvaluationPlan['lane'];
  readonly target: RelationTarget;
  readonly inputProfile: InputProfile;
  readonly resultDigest: string;
  readonly exclusions: readonly { readonly caseId: string; readonly reasons: readonly string[] }[];
  readonly counts: Readonly<Record<string, number>>;
  readonly coverage: Readonly<Record<string, MetricValue>>;
  readonly raw: PositiveMetrics;
  readonly adopted: PositiveMetrics;
  /** Only kind/direction agreement with this lane's references, never warrant certification. */
  readonly tupleOnly: { readonly raw: TupleMetrics; readonly adopted: TupleMetrics };
  readonly semanticMetricScope: 'ELIGIBLE_REFERENCES_ONLY';
  readonly operational: OperationalRelationMetrics;
  readonly warrantRejections: readonly {
    readonly taskId: string;
    readonly reasons: readonly string[];
  }[];
  readonly kindCorrectness: MetricValue;
  readonly explicitNegativeCorrectness: MetricValue;
  readonly modelAbstentionRate: MetricValue;
  readonly abstentionAppropriateness: MetricValue;
  readonly rawTupleStability: MetricValue;
  readonly strictAllRunStability: MetricValue;
  readonly adoptionStateStability: MetricValue;
};
