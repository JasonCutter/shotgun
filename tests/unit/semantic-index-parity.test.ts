import { describe, expect, it } from 'vitest';

import { InMemorySemanticIndexRepository } from '../../adapters/semantic-index-in-memory/src/index.js';
import {
  SEMANTIC_EMBEDDING_CATALOG_REVISION,
  SEMANTIC_REPRESENTATION_VERSION,
  type SemanticCandidateQuery,
  type SemanticProjectionGeneration,
  type SemanticProjectionItem,
} from '../../packages/contracts/src/index.js';

describe('AKP-1 WP2: InMemorySemanticIndexRepository Unit & Parity Tests', () => {
  const createRig = () => {
    const repo = new InMemorySemanticIndexRepository();
    return { repo };
  };

  it('persists and retrieves generation and prevents conflicting duplicate identities', async () => {
    const { repo } = createRig();

    const gen: SemanticProjectionGeneration = {
      projectId: 'proj-1',
      generationId: 'gen-1',
      embeddingProfileId: 'profile-1',
      embeddingProfileRevision: 1,
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      providerRegistryRevision: 'provider-registry:v1',
      capabilityCatalogRevision: SEMANTIC_EMBEDDING_CATALOG_REVISION,
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      dimension: 1536,
      distanceMetric: 'cosine',
      normalizationPolicy: 'unit_length',
      buildStatus: 'READY',
      createdAt: '2026-08-18T10:00:00.000Z',
    };

    const status1 = await repo.saveGeneration(gen);
    expect(status1).toBe('CREATED');

    const status2 = await repo.saveGeneration(gen);
    expect(status2).toBe('EXISTS');

    const status3 = await repo.saveGeneration({
      ...gen,
      dimension: 768,
    });
    expect(status3).toBe('CONFLICT');

    const loaded = await repo.getGeneration('proj-1', 'gen-1');
    expect(loaded).toEqual(gen);
  });

  it('upserts and deletes items with dimension consistency validation', async () => {
    const { repo } = createRig();

    const gen: SemanticProjectionGeneration = {
      projectId: 'proj-1',
      generationId: 'gen-1',
      embeddingProfileId: 'profile-1',
      embeddingProfileRevision: 1,
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      providerRegistryRevision: 'provider-registry:v1',
      capabilityCatalogRevision: SEMANTIC_EMBEDDING_CATALOG_REVISION,
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      dimension: 1536,
      distanceMetric: 'cosine',
      normalizationPolicy: 'unit_length',
      buildStatus: 'READY',
      createdAt: '2026-08-18T10:00:00.000Z',
    };
    await repo.saveGeneration(gen);

    const item: SemanticProjectionItem = {
      projectId: 'proj-1',
      generationId: 'gen-1',
      resourceType: 'FACT',
      resourceId: 'fact-1',
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      semanticTextDigest: 'sha256:' + 'a'.repeat(64),
      vector: new Array(1536).fill(0.01),
      dimension: 1536,
      accessScope: ['engineering'],
      sensitivity: 'internal',
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
    };

    await repo.upsertItem(item);
    const loaded = await repo.getItem('proj-1', 'gen-1', 'FACT', 'fact-1');
    expect(loaded).toEqual(item);

    // Mismatched dimension fails closed
    await expect(
      repo.upsertItem({
        ...item,
        dimension: 768,
        vector: new Array(768).fill(0.01),
      }),
    ).rejects.toMatchObject({
      name: 'SemanticEmbeddingError',
      embeddingErrorCode: 'VALIDATION_FAILURE',
    });

    const deleted = await repo.deleteItem('proj-1', 'gen-1', 'FACT', 'fact-1');
    expect(deleted).toBe(true);
    expect(await repo.getItem('proj-1', 'gen-1', 'FACT', 'fact-1')).toBeUndefined();
  });

  it('proves Security-before-Top-K candidate filtering in InMemory adapter', async () => {
    const { repo } = createRig();

    const gen: SemanticProjectionGeneration = {
      projectId: 'proj-1',
      generationId: 'gen-1',
      embeddingProfileId: 'profile-1',
      embeddingProfileRevision: 1,
      providerId: 'google-gemini',
      embeddingModelId: 'gemini-embedding-001',
      providerRegistryRevision: 'provider-registry:v1',
      capabilityCatalogRevision: SEMANTIC_EMBEDDING_CATALOG_REVISION,
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      dimension: 768,
      distanceMetric: 'cosine',
      normalizationPolicy: 'unit_length',
      buildStatus: 'READY',
      createdAt: '2026-08-18T10:00:00.000Z',
    };
    await repo.saveGeneration(gen);

    const queryVec = new Array(768).fill(0);
    queryVec[0] = 1.0;

    // Item 1 (Unauthorized, closest: distance ≈ 0.001)
    const vecUnauth = new Array(768).fill(0);
    vecUnauth[0] = 0.999;
    vecUnauth[1] = 0.044;
    await repo.upsertItem({
      projectId: 'proj-1',
      generationId: 'gen-1',
      resourceType: 'CLAIM',
      resourceId: 'claim-unauth',
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      semanticTextDigest: 'sha256:' + '1'.repeat(64),
      vector: vecUnauth,
      dimension: 768,
      accessScope: ['secret-exec'],
      sensitivity: 'restricted',
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
    });

    // Item 2 (Authorized, farther: distance ≈ 0.05)
    const vecAuth = new Array(768).fill(0);
    vecAuth[0] = 0.95;
    vecAuth[1] = 0.31;
    await repo.upsertItem({
      projectId: 'proj-1',
      generationId: 'gen-1',
      resourceType: 'CLAIM',
      resourceId: 'claim-auth',
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      semanticTextDigest: 'sha256:' + '2'.repeat(64),
      vector: vecAuth,
      dimension: 768,
      accessScope: ['public'],
      sensitivity: 'public',
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
    });

    const query: SemanticCandidateQuery = {
      projectId: 'proj-1',
      generationId: 'gen-1',
      queryVector: queryVec,
      dimension: 768,
      accessScopes: ['public'],
      allowedSensitivities: ['public'],
      limit: 1,
    };

    const results = await repo.findNearestNeighbors(query);
    expect(results).toHaveLength(1);
    expect(results[0]?.resourceId).toBe('claim-auth');
  });
});
