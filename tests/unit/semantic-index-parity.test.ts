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
      sourceProjectionDigest: 'sha256:' + '0'.repeat(64),
      canonicalBaseVersion: 1,
      credentialId: 'vault:openai:owner',
      credentialRevision: 1,
      providerPolicyFingerprint: 'sha256:' + '1'.repeat(64),
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      embeddingProfileId: 'profile-1',
      embeddingProfileRevision: 1,
      providerRegistryRevision: 'provider-registry:v1',
      capabilityCatalogRevision: SEMANTIC_EMBEDDING_CATALOG_REVISION,
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      dimension: 1536,
      distanceMetric: 'cosine',
      normalizationPolicy: 'none',
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

  it('SEMANTIC ITEM IDENTITY PARITY: enforces uniqueness, conflict rejection, and stale secondary-index removal', async () => {
    const { repo } = createRig();

    const gen: SemanticProjectionGeneration = {
      projectId: 'proj-1',
      generationId: 'gen-1',
      sourceProjectionDigest: 'sha256:' + '0'.repeat(64),
      canonicalBaseVersion: 1,
      credentialId: 'vault:openai:owner',
      credentialRevision: 1,
      providerPolicyFingerprint: 'sha256:' + '1'.repeat(64),
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      embeddingProfileId: 'profile-1',
      embeddingProfileRevision: 1,
      providerRegistryRevision: 'provider-registry:v1',
      capabilityCatalogRevision: SEMANTIC_EMBEDDING_CATALOG_REVISION,
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      dimension: 768,
      distanceMetric: 'cosine',
      normalizationPolicy: 'none',
      buildStatus: 'READY',
      createdAt: '2026-08-18T10:00:00.000Z',
    };
    await repo.saveGeneration(gen);

    const item1: SemanticProjectionItem = {
      semanticItemId: 'sem-unique-1',
      projectId: 'proj-1',
      generationId: 'gen-1',
      resourceType: 'CLAIM',
      resourceId: 'claim-1',
      sourceProjectionDigest: 'sha256:' + '0'.repeat(64),
      canonicalVersion: 1,
      semanticTextDigest: 'sha256:' + '1'.repeat(64),
      embeddingProfileId: 'profile-1',
      embeddingProfileRevision: 1,
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      vector: new Array(768).fill(0.01),
      dimension: 768,
      evidenceIds: [],
      accessScope: ['engineering'],
      sensitivity: 'internal',
      indexedAt: '2026-08-18T10:00:00.000Z',
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
    };
    await repo.upsertItem(item1);

    // 1. FACT is not persistable through the generic repository boundary.
    const itemConflict: SemanticProjectionItem = {
      semanticItemId: 'sem-unique-1',
      projectId: 'proj-1',
      generationId: 'gen-1',
      resourceType: 'FACT',
      resourceId: 'fact-2',
      sourceProjectionDigest: 'sha256:' + '0'.repeat(64),
      canonicalVersion: 1,
      semanticTextDigest: 'sha256:' + '2'.repeat(64),
      embeddingProfileId: 'profile-1',
      embeddingProfileRevision: 1,
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      vector: new Array(768).fill(0.01),
      dimension: 768,
      evidenceIds: [],
      accessScope: ['engineering'],
      sensitivity: 'internal',
      indexedAt: '2026-08-18T10:00:00.000Z',
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
    };
    await expect(repo.upsertItem(itemConflict)).rejects.toMatchObject({
      name: 'SemanticEmbeddingError',
      embeddingErrorCode: 'VALIDATION_FAILURE',
    });

    // 2. Same resource (CLAIM:claim-1) updates to a new semanticItemId 'sem-unique-new'
    const item1Updated: SemanticProjectionItem = {
      ...item1,
      semanticItemId: 'sem-unique-new',
      updatedAt: '2026-08-18T10:05:00.000Z',
    };
    await repo.upsertItem(item1Updated);

    // 3. Old semanticItemId lookup returns undefined
    expect(await repo.getItemBySemanticId('proj-1', 'gen-1', 'sem-unique-1')).toBeUndefined();

    // 4. New semanticItemId resolves to the updated item
    const resolvedNew = await repo.getItemBySemanticId('proj-1', 'gen-1', 'sem-unique-new');
    expect(resolvedNew?.semanticItemId).toBe('sem-unique-new');
    expect(resolvedNew?.resourceId).toBe('claim-1');
  });

  it('INMEMORY BATCH ATOMICITY: rolls back entire batch when one item in upsertItems fails', async () => {
    const { repo } = createRig();

    const gen: SemanticProjectionGeneration = {
      projectId: 'proj-1',
      generationId: 'gen-1',
      sourceProjectionDigest: 'sha256:' + '0'.repeat(64),
      canonicalBaseVersion: 1,
      credentialId: 'vault:openai:owner',
      credentialRevision: 1,
      providerPolicyFingerprint: 'sha256:' + '1'.repeat(64),
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      embeddingProfileId: 'profile-1',
      embeddingProfileRevision: 1,
      providerRegistryRevision: 'provider-registry:v1',
      capabilityCatalogRevision: SEMANTIC_EMBEDDING_CATALOG_REVISION,
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      dimension: 768,
      distanceMetric: 'cosine',
      normalizationPolicy: 'none',
      buildStatus: 'READY',
      createdAt: '2026-08-18T10:00:00.000Z',
    };
    await repo.saveGeneration(gen);

    const validItem: SemanticProjectionItem = {
      semanticItemId: 'sem-batch-valid',
      projectId: 'proj-1',
      generationId: 'gen-1',
      resourceType: 'CLAIM',
      resourceId: 'claim-batch-1',
      sourceProjectionDigest: 'sha256:' + '0'.repeat(64),
      canonicalVersion: 1,
      semanticTextDigest: 'sha256:' + '1'.repeat(64),
      embeddingProfileId: 'profile-1',
      embeddingProfileRevision: 1,
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      vector: new Array(768).fill(0.01),
      dimension: 768,
      evidenceIds: [],
      accessScope: ['engineering'],
      sensitivity: 'internal',
      indexedAt: '2026-08-18T10:00:00.000Z',
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
    };

    const invalidItem: SemanticProjectionItem = {
      semanticItemId: 'sem-batch-invalid',
      projectId: 'proj-1',
      generationId: 'gen-1',
      resourceType: 'ENTITY',
      resourceId: 'entity-batch-2',
      sourceProjectionDigest: 'sha256:' + '0'.repeat(64),
      canonicalVersion: 1,
      semanticTextDigest: 'sha256:' + '2'.repeat(64),
      embeddingProfileId: 'profile-1',
      embeddingProfileRevision: 1,
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      vector: new Array(768).fill(NaN), // Invalid NaN vector
      dimension: 768,
      evidenceIds: [],
      accessScope: ['engineering'],
      sensitivity: 'internal',
      indexedAt: '2026-08-18T10:00:00.000Z',
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
    };

    await expect(repo.upsertItems([validItem, invalidItem])).rejects.toMatchObject({
      name: 'SemanticEmbeddingError',
      embeddingErrorCode: 'VALIDATION_FAILURE',
    });

    // Neither item must be visible
    expect(await repo.getItem('proj-1', 'gen-1', 'CLAIM', 'claim-batch-1')).toBeUndefined();
    expect(await repo.getItem('proj-1', 'gen-1', 'ENTITY', 'entity-batch-2')).toBeUndefined();
    expect(await repo.getItemBySemanticId('proj-1', 'gen-1', 'sem-batch-valid')).toBeUndefined();
  });

  it('FINITE VECTOR VALIDATION: rejects NaN and Infinity on item vectors and query vectors', async () => {
    const { repo } = createRig();

    const gen: SemanticProjectionGeneration = {
      projectId: 'proj-1',
      generationId: 'gen-1',
      sourceProjectionDigest: 'sha256:' + '0'.repeat(64),
      canonicalBaseVersion: 1,
      credentialId: 'vault:openai:owner',
      credentialRevision: 1,
      providerPolicyFingerprint: 'sha256:' + '1'.repeat(64),
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      embeddingProfileId: 'profile-1',
      embeddingProfileRevision: 1,
      providerRegistryRevision: 'provider-registry:v1',
      capabilityCatalogRevision: SEMANTIC_EMBEDDING_CATALOG_REVISION,
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      dimension: 768,
      distanceMetric: 'cosine',
      normalizationPolicy: 'none',
      buildStatus: 'READY',
      createdAt: '2026-08-18T10:00:00.000Z',
    };
    await repo.saveGeneration(gen);

    const nanVec = new Array(768).fill(0.01);
    nanVec[3] = NaN;

    const infVec = new Array(768).fill(0.01);
    infVec[4] = Infinity;

    // 1. NaN item vector
    await expect(
      repo.upsertItem({
        semanticItemId: 'sem-nan',
        projectId: 'proj-1',
        generationId: 'gen-1',
        resourceType: 'CLAIM',
        resourceId: 'claim-nan',
        sourceProjectionDigest: 'sha256:' + '0'.repeat(64),
        canonicalVersion: 1,
        semanticTextDigest: 'sha256:' + '1'.repeat(64),
        embeddingProfileId: 'profile-1',
        embeddingProfileRevision: 1,
        representationVersion: SEMANTIC_REPRESENTATION_VERSION,
        vector: nanVec,
        dimension: 768,
        evidenceIds: [],
        accessScope: ['engineering'],
        sensitivity: 'internal',
        indexedAt: '2026-08-18T10:00:00.000Z',
        createdAt: '2026-08-18T10:00:00.000Z',
        updatedAt: '2026-08-18T10:00:00.000Z',
      }),
    ).rejects.toMatchObject({
      name: 'SemanticEmbeddingError',
      embeddingErrorCode: 'VALIDATION_FAILURE',
    });

    // 2. Infinity query vector
    await expect(
      repo.findNearestNeighbors({
        projectId: 'proj-1',
        generationId: 'gen-1',
        queryVector: infVec,
        dimension: 768,
        accessScopes: ['engineering'],
        allowedSensitivities: ['internal'],
        limit: 5,
      }),
    ).rejects.toMatchObject({
      name: 'SemanticEmbeddingError',
      embeddingErrorCode: 'VALIDATION_FAILURE',
    });
  });

  it('proves Security-before-Top-K and fail-closed security in InMemory adapter', async () => {
    const { repo } = createRig();

    const gen: SemanticProjectionGeneration = {
      projectId: 'proj-1',
      generationId: 'gen-1',
      sourceProjectionDigest: 'sha256:' + '0'.repeat(64),
      canonicalBaseVersion: 1,
      credentialId: 'vault:gemini:owner',
      credentialRevision: 1,
      providerPolicyFingerprint: 'sha256:' + '1'.repeat(64),
      providerId: 'google-gemini',
      embeddingModelId: 'gemini-embedding-001',
      embeddingProfileId: 'profile-1',
      embeddingProfileRevision: 1,
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
      semanticItemId: 'sem-unauth',
      projectId: 'proj-1',
      generationId: 'gen-1',
      resourceType: 'CLAIM',
      resourceId: 'claim-unauth',
      sourceProjectionDigest: 'sha256:' + '0'.repeat(64),
      canonicalVersion: 1,
      semanticTextDigest: 'sha256:' + '1'.repeat(64),
      embeddingProfileId: 'profile-1',
      embeddingProfileRevision: 1,
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      vector: vecUnauth,
      dimension: 768,
      evidenceIds: [],
      accessScope: ['secret-exec'],
      sensitivity: 'restricted',
      indexedAt: '2026-08-18T10:00:00.000Z',
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
    });

    // Item 2 (Authorized, farther: distance ≈ 0.05)
    const vecAuth = new Array(768).fill(0);
    vecAuth[0] = 0.95;
    vecAuth[1] = 0.31;
    await repo.upsertItem({
      semanticItemId: 'sem-auth',
      projectId: 'proj-1',
      generationId: 'gen-1',
      resourceType: 'CLAIM',
      resourceId: 'claim-auth',
      sourceProjectionDigest: 'sha256:' + '0'.repeat(64),
      canonicalVersion: 1,
      semanticTextDigest: 'sha256:' + '2'.repeat(64),
      embeddingProfileId: 'profile-1',
      embeddingProfileRevision: 1,
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      vector: vecAuth,
      dimension: 768,
      evidenceIds: [],
      accessScope: ['public'],
      sensitivity: 'public',
      indexedAt: '2026-08-18T10:00:00.000Z',
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
    });

    // Empty access scopes fails closed
    await expect(
      repo.findNearestNeighbors({
        projectId: 'proj-1',
        generationId: 'gen-1',
        queryVector: queryVec,
        dimension: 768,
        accessScopes: [],
        allowedSensitivities: ['public'],
        limit: 1,
      }),
    ).rejects.toMatchObject({
      name: 'SemanticEmbeddingError',
      embeddingErrorCode: 'POLICY_DENIED',
    });

    // Valid query returns authorized item
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
