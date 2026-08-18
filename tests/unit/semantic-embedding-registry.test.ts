import { describe, expect, it } from 'vitest';

import {
  initialSemanticEmbeddingRegistry,
  StaticSemanticEmbeddingRegistry,
} from '../../modules/semantic-embedding/src/index.js';
import { initialProviderRegistry } from '../../modules/ai-configuration/src/index.js';

describe('AKP-1 WP1: Semantic Embedding Registry & Capability Boundary', () => {
  it('registers server-owned embedding providers and model descriptors with dimension metadata', () => {
    const registry = initialSemanticEmbeddingRegistry();
    const providers = registry.listProviders();

    expect(providers.map((p) => p.providerId)).toEqual(['openai', 'google-gemini', 'deepseek']);

    const openai = registry.getProvider('openai');
    expect(openai?.status).toBe('active');
    expect(openai?.models).toHaveLength(2);

    const small = registry.getModel('openai', 'text-embedding-3-small');
    expect(small).toMatchObject({
      providerId: 'openai',
      modelId: 'text-embedding-3-small',
      dimension: 1536,
      maxBatchSize: 2048,
      supportedDistanceMetrics: ['cosine', 'dot_product', 'euclidean'],
      defaultDistanceMetric: 'cosine',
      defaultNormalizationPolicy: 'unit_length',
    });

    const large = registry.getModel('openai', 'text-embedding-3-large');
    expect(large?.dimension).toBe(3072);

    const gemini = registry.getModel('google-gemini', 'text-embedding-004');
    expect(gemini).toMatchObject({
      providerId: 'google-gemini',
      modelId: 'text-embedding-004',
      dimension: 768,
      maxBatchSize: 100,
    });

    const deepseek = registry.getProvider('deepseek');
    expect(deepseek?.status).toBe('disabled');
    expect(deepseek?.models).toHaveLength(0);
  });

  it('proves embedding models are distinct from Ask generation models and cannot be used for structured generation', () => {
    const embeddingRegistry = initialSemanticEmbeddingRegistry();
    const askRegistry = initialProviderRegistry();

    // 1. Ask generation models are not in the embedding registry
    expect(embeddingRegistry.getModel('openai', 'gpt-5.6-luna')).toBeUndefined();
    expect(embeddingRegistry.getModel('google-gemini', 'gemini-3.6-flash')).toBeUndefined();
    expect(embeddingRegistry.getModel('deepseek', 'deepseek-v4-flash')).toBeUndefined();

    // 2. Embedding models are not in the Ask generation registry
    expect(askRegistry.getModel('openai', 'text-embedding-3-small')).toBeUndefined();
    expect(askRegistry.getModel('openai', 'text-embedding-3-large')).toBeUndefined();
    expect(askRegistry.getModel('google-gemini', 'text-embedding-004')).toBeUndefined();

    // 3. Ask provider models only expose structuredOutput capability
    const askModels = askRegistry.listProviders().flatMap((p) => p.models);
    for (const model of askModels) {
      expect(model.shotgunUsableCapabilities).toContain('structuredOutput');
    }
  });

  it('guarantees immutability of registered descriptors on clone', () => {
    const registry = new StaticSemanticEmbeddingRegistry();
    const providers = registry.listProviders();
    const openai = providers.find((p) => p.providerId === 'openai')!;

    (openai.models as Array<unknown>).length = 0;

    const freshOpenai = registry.getProvider('openai');
    expect(freshOpenai?.models).toHaveLength(2);
  });
});
