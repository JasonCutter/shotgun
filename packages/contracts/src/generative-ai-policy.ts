/**
 * Canonical authority for new Product generative AI execution.
 *
 * Embedding providers are intentionally outside this contract; they have a
 * separate capability registry and execution boundary.
 */
export const GENERATIVE_AI_PROVIDER_ID = 'deepseek' as const;
/**
 * Canonical model identity for all newly authored generative executions.
 *
 * The previous `deepseek-v4-flash` identity remains readable only as a
 * historical execution pin; it is intentionally not part of the current
 * provider catalog.
 */
export const GENERATIVE_AI_MODEL_ID = 'deepseek-flash' as const;
export const HISTORICAL_GENERATIVE_AI_MODEL_ID = 'deepseek-v4-flash' as const;

export const isHistoricalGenerativeAIExecution = (providerId: string, modelId: string): boolean =>
  providerId.trim() === GENERATIVE_AI_PROVIDER_ID &&
  modelId.trim() === HISTORICAL_GENERATIVE_AI_MODEL_ID;

export const isCanonicalGenerativeAIExecution = (providerId: string, modelId: string): boolean =>
  providerId.trim() === GENERATIVE_AI_PROVIDER_ID && modelId.trim() === GENERATIVE_AI_MODEL_ID;
