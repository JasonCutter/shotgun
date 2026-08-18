import { describe, expect, it } from 'vitest';

import {
  initialSemanticEmbeddingRegistry,
  StaticSemanticEmbeddingRegistry,
} from '../../modules/semantic-embedding/src/index.js';
import { initialProviderRegistry } from '../../modules/ai-configuration/src/index.js';

describe('AKP-1 WP1: Semantic Embedding Registry & Capability Boundary', () => {
  it('registers supported embedding models with provider facts and Shotgun policy separation', () => {
    const registry = initialSemanticEmbeddingRegistry();
    const allModels = registry.listModels();

    expect(allModels.map((m) => `${m.providerId}:${m.modelId}`)).toEqual([
      'openai:text-embedding-3-small',
      'openai:text-embedding-3-large',
      'google-gemini:gemini-embedding-001',
    ]);

    // Retired model is removed
    expect(registry.getModel('google-gemini', 'text-embedding-004')).toBeUndefined();

    // Stable text-only Gemini embedding model with full separation of provider facts & Shotgun policy
    const gemini = registry.getModel('google-gemini', 'gemini-embedding-001');
    expect(gemini).toMatchObject({
      providerId: 'google-gemini',
      modelId: 'gemini-embedding-001',
      providerDefaultDimension: 3072,
      providerSupportedDimensionRange: { min: 128, max: 3072 },
      providerRecommendedDimensions: [768, 1536, 3072],
      shotgunDefaultDimension: 768,
      shotgunAllowedDimensions: [128, 256, 512, 768, 1536, 3072],
      shotgunBatchLimit: 100,
      supportedDistanceMetrics: ['cosine', 'dot_product', 'euclidean'],
      defaultDistanceMetric: 'cosine',
      defaultNormalizationPolicy: 'unit_length',
    });

    const small = registry.getModel('openai', 'text-embedding-3-small');
    expect(small).toMatchObject({
      providerId: 'openai',
      modelId: 'text-embedding-3-small',
      providerDefaultDimension: 1536,
      shotgunDefaultDimension: 1536,
      shotgunAllowedDimensions: [512, 1536],
      shotgunBatchLimit: 2048,
      supportedDistanceMetrics: ['cosine', 'dot_product', 'euclidean'],
      defaultDistanceMetric: 'cosine',
      defaultNormalizationPolicy: 'unit_length',
    });

    const large = registry.getModel('openai', 'text-embedding-3-large');
    expect(large).toMatchObject({
      providerId: 'openai',
      modelId: 'text-embedding-3-large',
      providerDefaultDimension: 3072,
      shotgunDefaultDimension: 3072,
      shotgunAllowedDimensions: [256, 1024, 1536, 3072],
      shotgunBatchLimit: 2048,
    });
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
    expect(askRegistry.getModel('google-gemini', 'gemini-embedding-001')).toBeUndefined();
    expect(askRegistry.getModel('google-gemini', 'text-embedding-004')).toBeUndefined();

    // 3. Ask provider models only expose structuredOutput capability
    const askModels = askRegistry.listProviders().flatMap((p) => p.models);
    for (const model of askModels) {
      expect(model.shotgunUsableCapabilities).toContain('structuredOutput');
    }
  });

  it('guarantees immutability of registered descriptors on clone', () => {
    const registry = new StaticSemanticEmbeddingRegistry();
    const models = registry.listModels('openai');
    const small = models.find((m) => m.modelId === 'text-embedding-3-small')!;

    (small.shotgunAllowedDimensions as number[]).length = 0;

    const freshSmall = registry.getModel('openai', 'text-embedding-3-small');
    expect(freshSmall?.shotgunAllowedDimensions).toEqual([512, 1536]);
  });
});
