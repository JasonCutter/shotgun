import {
  assertSurferJson,
  surferFailure,
  type SurferObservation,
  type SurferRuleCandidate,
  type SurferLearningCase,
} from '../../../packages/contracts/src/surfer-learning.js';
import type { SurferScopedRuleProof } from '../../../packages/contracts/src/surfer-rule-memory.js';
import { evaluateSurferRule } from './rule-interpreter.js';

/** Only observed marginal values are supported; finite evidence does not identify unseen thresholds. */
export function applySurferScopedRule(
  proof: SurferScopedRuleProof,
  features: Record<string, SurferObservation>,
) {
  return applySurferObservedRule(proof.candidate, proof.development.cases, features);
}
export function applySurferObservedRule(
  candidate: SurferRuleCandidate,
  observed: readonly SurferLearningCase[],
  features: Record<string, SurferObservation>,
) {
  assertSurferJson(features);
  if (!features || Array.isArray(features) || Object.keys(features).length > 8)
    throw surferFailure('Invalid bounded rule scenario.');
  const names = Object.keys(observed[0]!.features),
    reasons: string[] = [];
  if (Object.keys(features).some((n) => !names.includes(n)))
    throw surferFailure('Unexpected rule scenario feature.');
  for (const name of names) {
    const value = features[name];
    if (value === undefined) {
      reasons.push('MISSING_PREMISE:' + name);
      continue;
    }
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !Object.hasOwn(value, 'value') ||
      Object.keys(value).some((k) => !['value', 'unit'].includes(k)) ||
      (value.value !== null && !['number', 'string', 'boolean'].includes(typeof value.value)) ||
      (value.unit !== undefined &&
        (typeof value.unit !== 'string' ||
          !value.unit.length ||
          value.unit.length > 64 ||
          typeof value.value !== 'number'))
    )
      throw surferFailure('Invalid rule observation.');
    if (value.value === null) {
      reasons.push('MISSING_PREMISE:' + name);
      continue;
    }
    const examples = observed.map((c) => c.features[name]!);
    if (
      examples.some(
        (e) => e.value === null || typeof e.value !== typeof value.value || e.unit !== value.unit,
      )
    ) {
      reasons.push('TYPE_OR_UNIT_MISMATCH:' + name);
      continue;
    }
    if (!examples.some((e) => e.value === value.value)) {
      const range = examples.map((e) => e.value as number);
      reasons.push(
        (typeof value.value === 'number' &&
        (value.value < Math.min(...range) || value.value > Math.max(...range))
          ? 'OUT_OF_OBSERVED_RANGE:'
          : 'UNOBSERVED_VALUE:') + name,
      );
    }
  }
  if (reasons.length)
    return { outcome: 'UNKNOWN' as const, reasons, usedFeatures: [], operations: 0 };
  return evaluateSurferRule(candidate.expression, features, { maxOperations: 512 });
}
