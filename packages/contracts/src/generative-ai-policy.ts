/**
 * Canonical authority for new Product generative AI execution.
 *
 * Embedding providers are intentionally outside this contract; they have a
 * separate capability registry and execution boundary.
 */
export const GENERATIVE_AI_PROVIDER_ID = 'deepseek' as const;
export const GENERATIVE_AI_MODEL_ID = 'deepseek-v4-flash' as const;

export const isCanonicalGenerativeAIExecution = (providerId: string, modelId: string): boolean =>
  providerId.trim() === GENERATIVE_AI_PROVIDER_ID && modelId.trim() === GENERATIVE_AI_MODEL_ID;
