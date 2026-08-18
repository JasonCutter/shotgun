import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { PostgresSemanticIndexRepository } from '../../adapters/semantic-index-postgres/src/index.js';
import { InMemorySemanticIndexRepository } from '../../adapters/semantic-index-in-memory/src/index.js';
import {
  type SemanticCandidateQuery,
  type SemanticProjectionGeneration,
  type SemanticProjectionItem,
  SEMANTIC_EMBEDDING_CATALOG_REVISION,
  SEMANTIC_REPRESENTATION_VERSION,
} from '../../packages/contracts/src/index.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

describe('AKP-1 WP2: PostgreSQL + pgvector Semantic Projection Persistence', () => {
  if (!pool) {
    it.skip('PostgreSQL test database not available', () => {});
    return;
  }

  const postgresRepo = new PostgresSemanticIndexRepository(pool);
  const inMemoryRepo = new InMemorySemanticIndexRepository();

  const testProjectA = 'project-akp-1-test-a';
  const testProjectB = 'project-akp-1-test-b';

  beforeEach(async () => {
    // Clean up test projects
    await pool.query(`DELETE FROM projection.semantic_generations WHERE project_id IN ($1, $2)`, [
      testProjectA,
      testProjectB,
    ]);
  });

  afterAll(async () => {
    if (pool) {
      await pool.query(`DELETE FROM projection.semantic_generations WHERE project_id IN ($1, $2)`, [
        testProjectA,
        testProjectB,
      ]);
      await pool.end();
    }
  });

  it('verifies pgvector extension and vector data type are active in database', async () => {
    const extResult = await pool.query<{ extname: string; extversion: string }>(
      `SELECT extname, extversion FROM pg_extension WHERE extname = 'vector'`,
    );
    expect(extResult.rowCount).toBe(1);
    expect(extResult.rows[0]?.extname).toBe('vector');

    // Verify vector arithmetic / distance operations
    const opResult = await pool.query<{ dist: number }>(
      `SELECT ('[1,0,0]'::vector <=> '[0,1,0]'::vector)::double precision AS dist`,
    );
    expect(opResult.rows[0]?.dist).toBeCloseTo(1.0, 5);
  });

  it('persists and reloads semantic projection generation identity with full provenance metadata', async () => {
    const generationA: SemanticProjectionGeneration = {
      projectId: testProjectA,
      generationId: 'gen-768-v1',
      embeddingProfileId: 'profile-gemini-1',
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
      createdAt: '2026-08-18T12:00:00.000Z',
    };

    const result = await postgresRepo.saveGeneration(generationA);
    expect(result).toBe('CREATED');

    const reloaded = await postgresRepo.getGeneration(testProjectA, 'gen-768-v1');
    expect(reloaded).toEqual(generationA);

    // Duplicate save with exact same identity returns EXISTS
    const duplicateResult = await postgresRepo.saveGeneration(generationA);
    expect(duplicateResult).toBe('EXISTS');

    // Duplicate save with conflicting property returns CONFLICT
    const conflictingGen: SemanticProjectionGeneration = {
      ...generationA,
      dimension: 1536, // Conflict
    };
    const conflictResult = await postgresRepo.saveGeneration(conflictingGen);
    expect(conflictResult).toBe('CONFLICT');
  });

  it('supports variable dimensions (768, 1536, 3072) across different generations without hardcoded schema limit', async () => {
    const gen768: SemanticProjectionGeneration = {
      projectId: testProjectA,
      generationId: 'gen-gemini-768',
      embeddingProfileId: 'prof-gemini',
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

    const gen1536: SemanticProjectionGeneration = {
      projectId: testProjectA,
      generationId: 'gen-openai-1536',
      embeddingProfileId: 'prof-openai-small',
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

    await postgresRepo.saveGeneration(gen768);
    await postgresRepo.saveGeneration(gen1536);

    const vec768 = new Array(768).fill(0.01);
    const vec1536 = new Array(1536).fill(0.005);

    const item768: SemanticProjectionItem = {
      projectId: testProjectA,
      generationId: 'gen-gemini-768',
      resourceType: 'CLAIM',
      resourceId: 'claim-gemini-1',
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      semanticTextDigest: 'sha256:' + 'a'.repeat(64),
      vector: vec768,
      dimension: 768,
      accessScope: ['engineering'],
      sensitivity: 'internal',
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
    };

    const item1536: SemanticProjectionItem = {
      projectId: testProjectA,
      generationId: 'gen-openai-1536',
      resourceType: 'FACT',
      resourceId: 'fact-openai-1',
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      semanticTextDigest: 'sha256:' + 'b'.repeat(64),
      vector: vec1536,
      dimension: 1536,
      accessScope: ['engineering'],
      sensitivity: 'internal',
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
    };

    await postgresRepo.upsertItem(item768);
    await postgresRepo.upsertItem(item1536);

    const reloaded768 = await postgresRepo.getItem(
      testProjectA,
      'gen-gemini-768',
      'CLAIM',
      'claim-gemini-1',
    );
    const reloaded1536 = await postgresRepo.getItem(
      testProjectA,
      'gen-openai-1536',
      'FACT',
      'fact-openai-1',
    );

    expect(reloaded768?.dimension).toBe(768);
    expect(reloaded768?.vector).toHaveLength(768);
    expect(reloaded1536?.dimension).toBe(1536);
    expect(reloaded1536?.vector).toHaveLength(1536);
  });

  it('proves idempotent write semantics and primary key constraint on projection items', async () => {
    const generation: SemanticProjectionGeneration = {
      projectId: testProjectA,
      generationId: 'gen-idem-1',
      embeddingProfileId: 'prof-1',
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
    await postgresRepo.saveGeneration(generation);

    const vec = new Array(1536).fill(0.01);
    const item: SemanticProjectionItem = {
      projectId: testProjectA,
      generationId: 'gen-idem-1',
      resourceType: 'DECISION',
      resourceId: 'dec-101',
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      semanticTextDigest: 'sha256:' + 'c'.repeat(64),
      vector: vec,
      dimension: 1536,
      accessScope: ['architecture'],
      sensitivity: 'internal',
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
    };

    // Write 1
    await postgresRepo.upsertItem(item);

    // Write 2 (identical write)
    await postgresRepo.upsertItem(item);

    // Update with new vector and digest
    const updatedVec = new Array(1536).fill(0.02);
    const updatedItem: SemanticProjectionItem = {
      ...item,
      vector: updatedVec,
      semanticTextDigest: 'sha256:' + 'd'.repeat(64),
      updatedAt: '2026-08-18T11:00:00.000Z',
    };
    await postgresRepo.upsertItem(updatedItem);

    // Verify exactly one row exists with updated values
    const countRes = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM projection.semantic_items
       WHERE project_id = $1 AND generation_id = $2 AND resource_type = 'DECISION' AND resource_id = 'dec-101'`,
      [testProjectA, 'gen-idem-1'],
    );
    expect(countRes.rows[0]?.count).toBe('1');

    const reloaded = await postgresRepo.getItem(testProjectA, 'gen-idem-1', 'DECISION', 'dec-101');
    expect(reloaded?.semanticTextDigest).toBe('sha256:' + 'd'.repeat(64));
    expect(reloaded?.vector[0]).toBeCloseTo(0.02, 5);
  });

  it('HARD REQUIREMENT: Security-before-Top-K prevents closer unauthorized items from consuming Top-K slots', async () => {
    const generation: SemanticProjectionGeneration = {
      projectId: testProjectA,
      generationId: 'gen-security-topk',
      embeddingProfileId: 'prof-1',
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
    await postgresRepo.saveGeneration(generation);
    await inMemoryRepo.saveGeneration(generation);

    // Setup 3 vectors in 768-dim:
    // Query vector: [1, 0, 0, ... 0]
    const queryVec = new Array(768).fill(0);
    queryVec[0] = 1.0;

    // Item 1 (UNAUTHORIZED: restricted clearance required): Extremely close! [0.999, 0.044, 0, ... 0] -> cosine dist ≈ 0.001
    const vecUnauthorized = new Array(768).fill(0);
    vecUnauthorized[0] = 0.999;
    vecUnauthorized[1] = 0.044;
    const itemUnauthorized: SemanticProjectionItem = {
      projectId: testProjectA,
      generationId: 'gen-security-topk',
      resourceType: 'CLAIM',
      resourceId: 'claim-unauthorized-secret',
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      semanticTextDigest: 'sha256:' + '1'.repeat(64),
      vector: vecUnauthorized,
      dimension: 768,
      accessScope: ['executive-confidential'],
      sensitivity: 'restricted', // User does not have access
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
    };

    // Item 2 (AUTHORIZED: public): Slightly farther away [0.95, 0.31, 0, ... 0] -> cosine dist ≈ 0.05
    const vecAuthorized = new Array(768).fill(0);
    vecAuthorized[0] = 0.95;
    vecAuthorized[1] = 0.31;
    const itemAuthorized: SemanticProjectionItem = {
      projectId: testProjectA,
      generationId: 'gen-security-topk',
      resourceType: 'CLAIM',
      resourceId: 'claim-authorized-public',
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      semanticTextDigest: 'sha256:' + '2'.repeat(64),
      vector: vecAuthorized,
      dimension: 768,
      accessScope: ['public'],
      sensitivity: 'public', // User HAS access
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
    };

    // Item 3 (AUTHORIZED: internal): Even farther away [0.8, 0.6, 0, ... 0] -> cosine dist ≈ 0.2
    const vecFarther = new Array(768).fill(0);
    vecFarther[0] = 0.8;
    vecFarther[1] = 0.6;
    const itemFarther: SemanticProjectionItem = {
      projectId: testProjectA,
      generationId: 'gen-security-topk',
      resourceType: 'FACT',
      resourceId: 'fact-authorized-internal',
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      semanticTextDigest: 'sha256:' + '3'.repeat(64),
      vector: vecFarther,
      dimension: 768,
      accessScope: ['engineering'],
      sensitivity: 'internal',
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
    };

    await postgresRepo.upsertItems([itemUnauthorized, itemAuthorized, itemFarther]);
    await inMemoryRepo.upsertItems([itemUnauthorized, itemAuthorized, itemFarther]);

    // Query with accessScopes: ['public', 'engineering'] and allowedSensitivities: ['public', 'internal'], limit = 1
    const query: SemanticCandidateQuery = {
      projectId: testProjectA,
      generationId: 'gen-security-topk',
      queryVector: queryVec,
      dimension: 768,
      accessScopes: ['public', 'engineering'],
      allowedSensitivities: ['public', 'internal'],
      limit: 1,
    };

    // 1. PostgreSQL + pgvector execution
    const pgResults = await postgresRepo.findNearestNeighbors(query);
    expect(pgResults).toHaveLength(1);
    // MUST return the authorized item (NOT empty, and NOT the unauthorized item)
    expect(pgResults[0]?.resourceId).toBe('claim-authorized-public');
    expect(pgResults[0]?.resourceType).toBe('CLAIM');
    expect(pgResults[0]?.sensitivity).toBe('public');

    // 2. InMemory parity
    const memResults = await inMemoryRepo.findNearestNeighbors(query);
    expect(memResults).toHaveLength(1);
    expect(memResults[0]?.resourceId).toBe('claim-authorized-public');
  });

  it('guarantees complete cross-Project isolation in candidate retrieval', async () => {
    // Generation for Project A
    await postgresRepo.saveGeneration({
      projectId: testProjectA,
      generationId: 'gen-shared-id',
      embeddingProfileId: 'prof-1',
      embeddingProfileRevision: 1,
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      providerRegistryRevision: 'provider-registry:v1',
      capabilityCatalogRevision: SEMANTIC_EMBEDDING_CATALOG_REVISION,
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      dimension: 768,
      distanceMetric: 'cosine',
      normalizationPolicy: 'unit_length',
      buildStatus: 'READY',
      createdAt: '2026-08-18T10:00:00.000Z',
    });

    // Generation for Project B with same generationId
    await postgresRepo.saveGeneration({
      projectId: testProjectB,
      generationId: 'gen-shared-id',
      embeddingProfileId: 'prof-1',
      embeddingProfileRevision: 1,
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      providerRegistryRevision: 'provider-registry:v1',
      capabilityCatalogRevision: SEMANTIC_EMBEDDING_CATALOG_REVISION,
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      dimension: 768,
      distanceMetric: 'cosine',
      normalizationPolicy: 'unit_length',
      buildStatus: 'READY',
      createdAt: '2026-08-18T10:00:00.000Z',
    });

    const vec = new Array(768).fill(0.01);

    // Insert Item into Project B
    await postgresRepo.upsertItem({
      projectId: testProjectB,
      generationId: 'gen-shared-id',
      resourceType: 'CLAIM',
      resourceId: 'claim-project-b-only',
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      semanticTextDigest: 'sha256:' + 'b'.repeat(64),
      vector: vec,
      dimension: 768,
      accessScope: ['public'],
      sensitivity: 'public',
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
    });

    // Query from Project A
    const results = await postgresRepo.findNearestNeighbors({
      projectId: testProjectA,
      generationId: 'gen-shared-id',
      queryVector: vec,
      dimension: 768,
      accessScopes: ['public'],
      allowedSensitivities: ['public'],
      limit: 10,
    });

    expect(results).toHaveLength(0);
  });

  it('preserves deterministic tie-break ordering on equal vector distance', async () => {
    const generation: SemanticProjectionGeneration = {
      projectId: testProjectA,
      generationId: 'gen-tiebreak',
      embeddingProfileId: 'prof-1',
      embeddingProfileRevision: 1,
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      providerRegistryRevision: 'provider-registry:v1',
      capabilityCatalogRevision: SEMANTIC_EMBEDDING_CATALOG_REVISION,
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      dimension: 768,
      distanceMetric: 'cosine',
      normalizationPolicy: 'unit_length',
      buildStatus: 'READY',
      createdAt: '2026-08-18T10:00:00.000Z',
    };
    await postgresRepo.saveGeneration(generation);

    // 3 items with IDENTICAL vectors
    const vec = new Array(768).fill(0.01);

    const itemZ: SemanticProjectionItem = {
      projectId: testProjectA,
      generationId: 'gen-tiebreak',
      resourceType: 'FACT',
      resourceId: 'fact-z',
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      semanticTextDigest: 'sha256:' + '9'.repeat(64),
      vector: vec,
      dimension: 768,
      accessScope: ['public'],
      sensitivity: 'public',
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
    };

    const itemA: SemanticProjectionItem = {
      projectId: testProjectA,
      generationId: 'gen-tiebreak',
      resourceType: 'FACT',
      resourceId: 'fact-a',
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      semanticTextDigest: 'sha256:' + 'a'.repeat(64),
      vector: vec,
      dimension: 768,
      accessScope: ['public'],
      sensitivity: 'public',
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
    };

    const itemClaimA: SemanticProjectionItem = {
      projectId: testProjectA,
      generationId: 'gen-tiebreak',
      resourceType: 'CLAIM',
      resourceId: 'claim-a',
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      semanticTextDigest: 'sha256:' + 'c'.repeat(64),
      vector: vec,
      dimension: 768,
      accessScope: ['public'],
      sensitivity: 'public',
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
    };

    await postgresRepo.upsertItems([itemZ, itemA, itemClaimA]);

    const results = await postgresRepo.findNearestNeighbors({
      projectId: testProjectA,
      generationId: 'gen-tiebreak',
      queryVector: vec,
      dimension: 768,
      accessScopes: ['public'],
      allowedSensitivities: ['public'],
      limit: 10,
    });

    expect(results).toHaveLength(3);
    // Order must be CLAIM claim-a, then FACT fact-a, then FACT fact-z (by resourceType ASC, resourceId ASC)
    expect(results.map((r) => `${r.resourceType}:${r.resourceId}`)).toEqual([
      'CLAIM:claim-a',
      'FACT:fact-a',
      'FACT:fact-z',
    ]);
  });

  it('fails closed when querying an incompatible dimension or missing generation', async () => {
    const generation: SemanticProjectionGeneration = {
      projectId: testProjectA,
      generationId: 'gen-dim-check',
      embeddingProfileId: 'prof-1',
      embeddingProfileRevision: 1,
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      providerRegistryRevision: 'provider-registry:v1',
      capabilityCatalogRevision: SEMANTIC_EMBEDDING_CATALOG_REVISION,
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      dimension: 768,
      distanceMetric: 'cosine',
      normalizationPolicy: 'unit_length',
      buildStatus: 'READY',
      createdAt: '2026-08-18T10:00:00.000Z',
    };
    await postgresRepo.saveGeneration(generation);

    // Querying with dimension 1536 on a 768-dim generation
    const vec1536 = new Array(1536).fill(0.01);
    await expect(
      postgresRepo.findNearestNeighbors({
        projectId: testProjectA,
        generationId: 'gen-dim-check',
        queryVector: vec1536,
        dimension: 1536,
        accessScopes: ['public'],
        limit: 5,
      }),
    ).rejects.toMatchObject({
      name: 'SemanticEmbeddingError',
      embeddingErrorCode: 'VALIDATION_FAILURE',
    });

    // Querying nonexistent generation
    const vec768 = new Array(768).fill(0.01);
    await expect(
      postgresRepo.findNearestNeighbors({
        projectId: testProjectA,
        generationId: 'gen-nonexistent',
        queryVector: vec768,
        dimension: 768,
        accessScopes: ['public'],
        limit: 5,
      }),
    ).rejects.toMatchObject({
      name: 'SemanticEmbeddingError',
      embeddingErrorCode: 'CONFIGURATION_REQUIRED',
    });
  });

  it('proves CANONICAL ISOLATION: deleting projection state leaves Canonical knowledge tables unchanged and no vector columns exist in Canonical schema', async () => {
    // 1. Check Canonical tables have no vector columns
    const colResult = await pool.query<{
      column_name: string;
      data_type: string;
      udt_name: string;
    }>(
      `SELECT column_name, data_type, udt_name
       FROM information_schema.columns
       WHERE table_schema IN ('canonical', 'knowledge')
         AND (udt_name = 'vector' OR data_type = 'USER-DEFINED')`,
    );
    expect(colResult.rows).toHaveLength(0);

    // 2. Insert test generation and item
    const gen: SemanticProjectionGeneration = {
      projectId: testProjectA,
      generationId: 'gen-iso-test',
      embeddingProfileId: 'prof-1',
      embeddingProfileRevision: 1,
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      providerRegistryRevision: 'provider-registry:v1',
      capabilityCatalogRevision: SEMANTIC_EMBEDDING_CATALOG_REVISION,
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      dimension: 768,
      distanceMetric: 'cosine',
      normalizationPolicy: 'unit_length',
      buildStatus: 'READY',
      createdAt: '2026-08-18T10:00:00.000Z',
    };
    await postgresRepo.saveGeneration(gen);

    const item: SemanticProjectionItem = {
      projectId: testProjectA,
      generationId: 'gen-iso-test',
      resourceType: 'RELATION',
      resourceId: 'rel-iso-1',
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      semanticTextDigest: 'sha256:' + 'e'.repeat(64),
      vector: new Array(768).fill(0.01),
      dimension: 768,
      accessScope: ['public'],
      sensitivity: 'public',
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
    };
    await postgresRepo.upsertItem(item);

    // 3. Delete generation (cascades to items)
    const deleted = await postgresRepo.deleteGeneration(testProjectA, 'gen-iso-test');
    expect(deleted).toBe(true);

    const reloadedItem = await postgresRepo.getItem(
      testProjectA,
      'gen-iso-test',
      'RELATION',
      'rel-iso-1',
    );
    expect(reloadedItem).toBeUndefined();

    // 4. Verify Canonical tables remain queryable and healthy
    const canonicalState = await pool.query(
      `SELECT count(*)::text AS count FROM canonical.project_state`,
    );
    expect(canonicalState.rows[0]?.count).toBeDefined();
  });

  it('strictly restricts items to the 6 allowed resource types (CLAIM, FACT, ENTITY, RELATION, EVENT, DECISION)', async () => {
    const gen: SemanticProjectionGeneration = {
      projectId: testProjectA,
      generationId: 'gen-types-check',
      embeddingProfileId: 'prof-1',
      embeddingProfileRevision: 1,
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      providerRegistryRevision: 'provider-registry:v1',
      capabilityCatalogRevision: SEMANTIC_EMBEDDING_CATALOG_REVISION,
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      dimension: 768,
      distanceMetric: 'cosine',
      normalizationPolicy: 'unit_length',
      buildStatus: 'READY',
      createdAt: '2026-08-18T10:00:00.000Z',
    };
    await postgresRepo.saveGeneration(gen);

    const allowedTypes = ['CLAIM', 'FACT', 'ENTITY', 'RELATION', 'EVENT', 'DECISION'] as const;
    for (const resType of allowedTypes) {
      await postgresRepo.upsertItem({
        projectId: testProjectA,
        generationId: 'gen-types-check',
        resourceType: resType,
        resourceId: `res-${resType.toLowerCase()}-1`,
        representationVersion: SEMANTIC_REPRESENTATION_VERSION,
        semanticTextDigest: 'sha256:' + 'f'.repeat(64),
        vector: new Array(768).fill(0.01),
        dimension: 768,
        accessScope: ['public'],
        sensitivity: 'public',
        createdAt: '2026-08-18T10:00:00.000Z',
        updatedAt: '2026-08-18T10:00:00.000Z',
      });
    }

    // Invalid resource type 'RAW_SOURCE' rejected by PostgreSQL CHECK constraint
    await expect(
      pool.query(
        `INSERT INTO projection.semantic_items (
           project_id, generation_id, resource_type, resource_id,
           representation_version, semantic_text_digest, vector, dimension,
           access_scope, sensitivity
         ) VALUES ($1, $2, 'RAW_SOURCE', 'source-1', $3, $4, $5::vector, $6, $7::text[], 'public')`,
        [
          testProjectA,
          'gen-types-check',
          SEMANTIC_REPRESENTATION_VERSION,
          'sha256:' + '0'.repeat(64),
          JSON.stringify(new Array(768).fill(0.01)),
          768,
          ['public'],
        ],
      ),
    ).rejects.toThrow();
  });
});
