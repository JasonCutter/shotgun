import { utf16OrdinalCompare } from './semantic-representation.js';

export const DISCOVERY_EFFECTIVE_STRATEGY_SET_SCHEMA_VERSION_V1 = '1.0.0' as const;
export type DiscoveryEffectiveStrategySetSchemaVersionV1 =
  typeof DISCOVERY_EFFECTIVE_STRATEGY_SET_SCHEMA_VERSION_V1;

export const DISCOVERY_EFFECTIVE_STRATEGY_MODES_V1 = ['FULL', 'DEGRADED'] as const;
export type DiscoveryEffectiveStrategyModeV1 =
  (typeof DISCOVERY_EFFECTIVE_STRATEGY_MODES_V1)[number];

export const DISCOVERY_EFFECTIVE_STRATEGY_COMPLETIONS_V1 = ['COMPLETE', 'PARTIAL'] as const;
export type DiscoveryEffectiveStrategyCompletionV1 =
  (typeof DISCOVERY_EFFECTIVE_STRATEGY_COMPLETIONS_V1)[number];

export const DISCOVERY_STRATEGY_SKIP_REASONS_V1 = [
  'PROFILE_UNAVAILABLE',
  'POLICY_DENIED',
  'AI_CAPABILITY_UNAVAILABLE',
  'BUDGET_EXHAUSTED',
] as const;
export type DiscoveryStrategySkipReasonV1 = (typeof DISCOVERY_STRATEGY_SKIP_REASONS_V1)[number];

export type DiscoverySkippedStrategyV1 = {
  readonly strategyId: string;
  readonly reason: DiscoveryStrategySkipReasonV1;
};

export type DiscoveryEffectiveStrategySetV1 = {
  readonly schemaVersion: DiscoveryEffectiveStrategySetSchemaVersionV1;
  readonly mode: DiscoveryEffectiveStrategyModeV1;
  readonly completion: DiscoveryEffectiveStrategyCompletionV1;
  readonly requestedStrategies: readonly string[];
  readonly effectiveStrategies: readonly string[];
  readonly skippedStrategies: readonly DiscoverySkippedStrategyV1[];
};

const nonEmpty = (value: string, field: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${field} must be non-empty`);
  return normalized;
};

const orderedUnique = (values: readonly string[], field: string): readonly string[] => {
  const normalized = values.map((value, index) => nonEmpty(value, `${field}[${index}]`));
  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError(`${field} must not contain duplicates`);
  }
  return [...normalized].sort(utf16OrdinalCompare);
};

const assertSubset = (
  values: readonly string[],
  requested: ReadonlySet<string>,
  field: string,
): void => {
  if (values.some((value) => !requested.has(value))) {
    throw new TypeError(`${field} must be a subset of requestedStrategies`);
  }
};

const hasUnavailableReason = (reasons: readonly DiscoveryStrategySkipReasonV1[]): boolean =>
  reasons.some(
    (reason) =>
      reason === 'PROFILE_UNAVAILABLE' ||
      reason === 'POLICY_DENIED' ||
      reason === 'AI_CAPABILITY_UNAVAILABLE',
  );

export const createDiscoveryEffectiveStrategySetV1 = (input: {
  readonly mode: DiscoveryEffectiveStrategyModeV1;
  readonly completion: DiscoveryEffectiveStrategyCompletionV1;
  readonly requestedStrategies: readonly string[];
  readonly effectiveStrategies: readonly string[];
  readonly skippedStrategies: readonly DiscoverySkippedStrategyV1[];
}): DiscoveryEffectiveStrategySetV1 => {
  const requestedStrategies = orderedUnique(input.requestedStrategies, 'requestedStrategies');
  const effectiveStrategies = orderedUnique(input.effectiveStrategies, 'effectiveStrategies');
  const skippedStrategies = [...input.skippedStrategies]
    .map((entry, index) => ({
      strategyId: nonEmpty(entry.strategyId, `skippedStrategies[${index}].strategyId`),
      reason: entry.reason,
    }))
    .sort(
      (left, right) =>
        utf16OrdinalCompare(left.strategyId, right.strategyId) ||
        utf16OrdinalCompare(left.reason, right.reason),
    );
  if (
    skippedStrategies.some((entry) => !DISCOVERY_STRATEGY_SKIP_REASONS_V1.includes(entry.reason))
  ) {
    throw new TypeError('skippedStrategies contains an unsupported reason');
  }
  if (
    new Set(skippedStrategies.map((entry) => entry.strategyId)).size !== skippedStrategies.length
  ) {
    throw new TypeError('skippedStrategies must not contain duplicate strategy IDs');
  }

  const requested = new Set(requestedStrategies);
  assertSubset(effectiveStrategies, requested, 'effectiveStrategies');
  assertSubset(
    skippedStrategies.map((entry) => entry.strategyId),
    requested,
    'skippedStrategies',
  );
  const effective = new Set(effectiveStrategies);
  if (skippedStrategies.some((entry) => effective.has(entry.strategyId))) {
    throw new TypeError('a strategy cannot be both effective and skipped');
  }
  if (effective.size + skippedStrategies.length !== requested.size) {
    throw new TypeError('every requested strategy must be effective or skipped');
  }
  if (input.mode === 'DEGRADED' && input.completion !== 'PARTIAL') {
    throw new TypeError('DEGRADED execution must be PARTIAL');
  }
  if (input.completion === 'COMPLETE' && skippedStrategies.length > 0) {
    throw new TypeError('COMPLETE execution cannot skip a strategy');
  }
  const reasons = skippedStrategies.map((entry) => entry.reason);
  if (input.mode === 'DEGRADED' && !hasUnavailableReason(reasons)) {
    throw new TypeError('DEGRADED execution requires an AI-unavailable reason');
  }
  if (input.mode === 'FULL' && hasUnavailableReason(reasons)) {
    throw new TypeError('AI-unavailable strategies require DEGRADED mode');
  }

  return {
    schemaVersion: DISCOVERY_EFFECTIVE_STRATEGY_SET_SCHEMA_VERSION_V1,
    mode: input.mode,
    completion: input.completion,
    requestedStrategies,
    effectiveStrategies,
    skippedStrategies,
  };
};
