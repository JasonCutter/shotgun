import {
  createDiscoveryEffectiveStrategySetV1,
  utf16OrdinalCompare,
  type DiscoveryEffectiveStrategySetV1,
  type DiscoveryStrategySkipReasonV1,
} from '../../../packages/contracts/src/index.js';
import { DiscoveryAIGenerationError } from './index.js';

export type DiscoveryExecutionStrategyV1<T> = {
  readonly strategyId: string;
  readonly aiRequirement: 'NONE' | 'OPTIONAL' | 'REQUIRED';
  readonly execute: () => Promise<T>;
};

export type DiscoveryExecutionOutputV1<T> = {
  readonly strategyId: string;
  readonly value: T;
};

export type DiscoveryExecutionResultV1<T> = {
  readonly strategySet: DiscoveryEffectiveStrategySetV1;
  readonly outputs: readonly DiscoveryExecutionOutputV1<T>[];
};

const isSkippable = (error: unknown): error is DiscoveryAIGenerationError =>
  error instanceof DiscoveryAIGenerationError &&
  (error.code === 'PROFILE_UNAVAILABLE' ||
    error.code === 'POLICY_DENIED' ||
    error.code === 'AI_CAPABILITY_UNAVAILABLE' ||
    error.code === 'BUDGET_EXHAUSTED');

const skipReason = (error: DiscoveryAIGenerationError): DiscoveryStrategySkipReasonV1 => {
  switch (error.code) {
    case 'PROFILE_UNAVAILABLE':
    case 'POLICY_DENIED':
    case 'AI_CAPABILITY_UNAVAILABLE':
      return error.code;
    case 'BUDGET_EXHAUSTED':
      return 'BUDGET_EXHAUSTED';
    default:
      throw new TypeError(`Unsupported degraded reason: ${error.code}`);
  }
};

const uniqueStrategyIds = <T>(
  strategies: readonly DiscoveryExecutionStrategyV1<T>[],
): ReadonlyMap<string, DiscoveryExecutionStrategyV1<T>> => {
  const map = new Map<string, DiscoveryExecutionStrategyV1<T>>();
  for (const strategy of strategies) {
    const strategyId = strategy.strategyId.trim();
    if (!strategyId) throw new TypeError('strategyId must be non-empty');
    if (map.has(strategyId)) throw new TypeError(`Duplicate strategy ID: ${strategyId}`);
    map.set(strategyId, strategy);
  }
  return map;
};

/**
 * Server-owned WP5 execution policy. It records the exact effective strategy
 * set and catches only the typed pre-execution AI availability failures that
 * are safe to degrade. Invalid input, malformed output and programming
 * errors remain terminal instead of being disguised as degraded success.
 */
export const executeDiscoveryStrategiesV1 = async <T>(input: {
  readonly strategies: readonly DiscoveryExecutionStrategyV1<T>[];
  readonly requestedStrategies?: readonly string[];
}): Promise<DiscoveryExecutionResultV1<T>> => {
  const byId = uniqueStrategyIds(input.strategies);
  const requestedStrategies = input.requestedStrategies ?? [...byId.keys()];
  const requested = [...requestedStrategies].map((strategyId, index) => {
    const normalized = strategyId.trim();
    if (!normalized) throw new TypeError(`requestedStrategies[${index}] must be non-empty`);
    if (!byId.has(normalized)) throw new TypeError(`Unknown requested strategy: ${normalized}`);
    return normalized;
  });
  if (new Set(requested).size !== requested.length) {
    throw new TypeError('requestedStrategies must not contain duplicates');
  }

  const outputs: DiscoveryExecutionOutputV1<T>[] = [];
  const effectiveStrategies: string[] = [];
  const skippedStrategies: {
    readonly strategyId: string;
    readonly reason: DiscoveryStrategySkipReasonV1;
  }[] = [];
  for (const strategyId of [...requested].sort(utf16OrdinalCompare)) {
    const strategy = byId.get(strategyId)!;
    try {
      const value = await strategy.execute();
      effectiveStrategies.push(strategyId);
      outputs.push({ strategyId, value });
    } catch (error) {
      if (strategy.aiRequirement === 'NONE' || !isSkippable(error)) throw error;
      skippedStrategies.push({ strategyId, reason: skipReason(error) });
    }
  }

  const hasAiUnavailable = skippedStrategies.some(
    (entry) =>
      entry.reason === 'PROFILE_UNAVAILABLE' ||
      entry.reason === 'POLICY_DENIED' ||
      entry.reason === 'AI_CAPABILITY_UNAVAILABLE',
  );
  return {
    strategySet: createDiscoveryEffectiveStrategySetV1({
      mode: hasAiUnavailable ? 'DEGRADED' : 'FULL',
      completion: skippedStrategies.length === 0 ? 'COMPLETE' : 'PARTIAL',
      requestedStrategies: requested,
      effectiveStrategies,
      skippedStrategies,
    }),
    outputs,
  };
};
