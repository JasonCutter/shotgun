import { sha256Text, stableJson } from '../../contracts/src/document-evidence.js';

import type { ResultGroup } from './types.js';

export type QualityGateMetricOperator = 'gte' | 'lte' | 'eq';

export type QualityGateMetricRule = {
  readonly operator: QualityGateMetricOperator;
  readonly threshold: number;
};

export type QualityGateDiagnosticRule = {
  readonly baseline: number;
  readonly blocking: false;
  readonly rationale: string;
};

export type QualityGatePolicySection = {
  readonly metrics: Readonly<Record<string, QualityGateMetricRule>>;
  readonly diagnostics: Readonly<Record<string, QualityGateDiagnosticRule>>;
};

export type QualityGatePolicy = {
  readonly policyVersion: '1.0.0';
  readonly policyKind: 'REGRESSION_FLOOR';
  readonly status: 'APPROVED';
  readonly corpusId: string;
  readonly corpusVersion: string;
  readonly corpusDigest: string;
  readonly labelSetRevision: number;
  readonly metricImplementationVersion: string;
  readonly comparisonPrecision: 6;
  readonly claim: QualityGatePolicySection;
  readonly search: QualityGatePolicySection;
  readonly rationale: string;
  readonly policyDigest: string;
};

export type QualityGateRunSummary = {
  readonly evaluationKind: 'CLAIM_EXTRACTION' | 'SEARCH';
  readonly corpusId: string;
  readonly corpusVersion: string;
  readonly corpusDigest: string;
  readonly labelSetRevision: number;
  readonly metricImplementationVersion: string;
  readonly runDigest: string;
  readonly aggregateResults: ResultGroup;
};

export type QualityGateComparison = {
  readonly evaluationKind: QualityGateRunSummary['evaluationKind'];
  readonly metric: string;
  readonly operator: QualityGateMetricOperator;
  readonly threshold: number;
  readonly observed: number | null;
  readonly comparedObserved: number | null;
  readonly passed: boolean;
};

export type QualityGateEvaluation = {
  readonly passed: boolean;
  readonly policyVersion: string;
  readonly policyDigest: string;
  readonly corpusDigest: string;
  readonly labelSetRevision: number;
  readonly claimRunDigest: string;
  readonly searchRunDigest: string;
  readonly comparisons: readonly QualityGateComparison[];
  readonly diagnostics: readonly {
    readonly evaluationKind: QualityGateRunSummary['evaluationKind'];
    readonly metric: string;
    readonly baseline: number;
    readonly observed: number | null;
    readonly blocking: false;
    readonly rationale: string;
  }[];
};

export const computeQualityGatePolicyDigest = (policy: QualityGatePolicy): string => {
  const { policyDigest: excludedPolicyDigest, ...digestible } = policy;
  void excludedPolicyDigest;
  return sha256Text(stableJson(digestible));
};

const roundForPolicy = (value: number, precision: number): number =>
  Number(value.toFixed(precision));

const assertRunIdentity = (
  policy: QualityGatePolicy,
  run: QualityGateRunSummary,
  expectedKind: QualityGateRunSummary['evaluationKind'],
): void => {
  if (run.evaluationKind !== expectedKind) {
    throw new Error(`Quality Gate expected a ${expectedKind} run.`);
  }
  const mismatches = [
    run.corpusId !== policy.corpusId ? 'corpusId' : undefined,
    run.corpusVersion !== policy.corpusVersion ? 'corpusVersion' : undefined,
    run.corpusDigest !== policy.corpusDigest ? 'corpusDigest' : undefined,
    run.labelSetRevision !== policy.labelSetRevision ? 'labelSetRevision' : undefined,
    run.metricImplementationVersion !== policy.metricImplementationVersion
      ? 'metricImplementationVersion'
      : undefined,
  ].filter((entry): entry is string => entry !== undefined);
  if (mismatches.length > 0) {
    throw new Error(`${expectedKind} run identity mismatch: ${mismatches.join(', ')}.`);
  }
};

const compareSection = (
  kind: QualityGateRunSummary['evaluationKind'],
  section: QualityGatePolicySection,
  results: ResultGroup,
  precision: number,
): readonly QualityGateComparison[] =>
  Object.entries(section.metrics)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([metric, rule]) => {
      const observed = results.metrics[metric]?.value ?? null;
      const comparedObserved = observed === null ? null : roundForPolicy(observed, precision);
      const passed =
        comparedObserved !== null &&
        (rule.operator === 'gte'
          ? comparedObserved >= rule.threshold
          : rule.operator === 'lte'
            ? comparedObserved <= rule.threshold
            : comparedObserved === rule.threshold);
      return {
        evaluationKind: kind,
        metric,
        operator: rule.operator,
        threshold: rule.threshold,
        observed,
        comparedObserved,
        passed,
      };
    });

export const evaluateQualityGate = (
  policy: QualityGatePolicy,
  claim: QualityGateRunSummary,
  search: QualityGateRunSummary,
): QualityGateEvaluation => {
  assertRunIdentity(policy, claim, 'CLAIM_EXTRACTION');
  assertRunIdentity(policy, search, 'SEARCH');
  const comparisons = [
    ...compareSection(
      'CLAIM_EXTRACTION',
      policy.claim,
      claim.aggregateResults,
      policy.comparisonPrecision,
    ),
    ...compareSection('SEARCH', policy.search, search.aggregateResults, policy.comparisonPrecision),
  ];
  const diagnostics = [
    ...Object.entries(policy.claim.diagnostics).map(([metric, rule]) => ({
      evaluationKind: 'CLAIM_EXTRACTION' as const,
      metric,
      baseline: rule.baseline,
      observed: claim.aggregateResults.metrics[metric]?.value ?? null,
      blocking: rule.blocking,
      rationale: rule.rationale,
    })),
    ...Object.entries(policy.search.diagnostics).map(([metric, rule]) => ({
      evaluationKind: 'SEARCH' as const,
      metric,
      baseline: rule.baseline,
      observed: search.aggregateResults.metrics[metric]?.value ?? null,
      blocking: rule.blocking,
      rationale: rule.rationale,
    })),
  ];
  return {
    passed: comparisons.every((entry) => entry.passed),
    policyVersion: policy.policyVersion,
    policyDigest: policy.policyDigest,
    corpusDigest: policy.corpusDigest,
    labelSetRevision: policy.labelSetRevision,
    claimRunDigest: claim.runDigest,
    searchRunDigest: search.runDigest,
    comparisons,
    diagnostics,
  };
};

export const assertQualityGate = (evaluation: QualityGateEvaluation): void => {
  if (evaluation.passed) return;
  const failures = evaluation.comparisons
    .filter((entry) => !entry.passed)
    .map(
      (entry) =>
        `${entry.evaluationKind}.${entry.metric}: ${entry.comparedObserved ?? 'missing'} ${entry.operator} ${entry.threshold}`,
    );
  throw new Error(`Quality Gate regression: ${failures.join('; ')}`);
};
