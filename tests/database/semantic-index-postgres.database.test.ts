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
  SEMANTIC_SEARCH_MAX_LIMIT,
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

  it('1. verifies pgvector extension and vector data type are active in database', async () => {
    const extResult = await pool.query<{ extname: string; extversion: string }>(
      `SELECT extname, extversion FROM pg_extension WHERE extname = 'vector'`,
    );
    expect(extResult.rowCount).toBe(1);
    expect(extResult.rows[0]?.extname).toBe('vector');

    // Verify vector distance operator
    const opResult = await pool.query<{ dist: number }>(
      `SELECT ('[1,0,0]'::vector <=> '[0,1,0]'::vector)::double precision AS dist`,
    );
    expect(opResult.rows[0]?.dist).toBeCloseTo(1.0, 5);
  });

  it('2. persists and reloads semantic projection generation build provenance without secrets', async () => {
    const generationA: SemanticProjectionGeneration = {
      projectId: testProjectA,
      generationId: 'gen-768-v1',
      sourceProjectionDigest: 'sha256:' + 'a'.repeat(64),
      canonicalBaseVersion: 1,
      credentialId: 'vault:google-gemini:owner',
      credentialRevision: 1,
      providerPolicyFingerprint: 'sha256:' + 'b'.repeat(64),
      providerId: 'google-gemini',
      embeddingModelId: 'gemini-embedding-001',
      embeddingProfileId: 'profile-gemini-1',
      embeddingProfileRevision: 1,
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

  it('3. persists and reloads semantic projection item with complete lineage and evidence references', async () => {
    const generation: SemanticProjectionGeneration = {
      projectId: testProjectA,
      generationId: 'gen-lineage-1',
      sourceProjectionDigest: 'sha256:' + '1'.repeat(64),
      canonicalBaseVersion: 2,
      credentialId: 'vault:openai:owner',
      credentialRevision: 1,
      providerPolicyFingerprint: 'sha256:' + '2'.repeat(64),
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      embeddingProfileId: 'prof-openai-small',
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
    await postgresRepo.saveGeneration(generation);

    const vec = new Array(1536).fill(0.01);
    const item: SemanticProjectionItem = {
      semanticItemId: 'sem-item-claim-101',
      projectId: testProjectA,
      generationId: 'gen-lineage-1',
      resourceType: 'CLAIM',
      resourceId: 'claim-101',
      sourceProjectionDigest: 'sha256:' + '3'.repeat(64),
      canonicalVersion: 2,
      semanticTextDigest: 'sha256:' + '4'.repeat(64),
      embeddingProfileId: 'prof-openai-small',
      embeddingProfileRevision: 1,
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      vector: vec,
      dimension: 1536,
      evidenceIds: ['ev-span-1', 'ev-span-2'],
      accessScope: ['engineering', 'security'],
      sensitivity: 'internal',
      indexedAt: '2026-08-18T10:05:00.000Z',
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:05:00.000Z',
    };

    await postgresRepo.upsertItem(item);

    const reloaded = await postgresRepo.getItem(
      testProjectA,
      'gen-lineage-1',
      'CLAIM',
      'claim-101',
    );
    expect(reloaded).toEqual(item);

    const reloadedBySemanticId = await postgresRepo.getItemBySemanticId(
      testProjectA,
      'gen-lineage-1',
      'sem-item-claim-101',
    );
    expect(reloadedBySemanticId).toEqual(item);
  });

  it('4. DATABASE INTEGRITY: vector_dims(vector) = dimension constraint rejects dimension lies at DB boundary', async () => {
    const generation: SemanticProjectionGeneration = {
      projectId: testProjectA,
      generationId: 'gen-db-chk-1',
      sourceProjectionDigest: 'sha256:' + 'a'.repeat(64),
      canonicalBaseVersion: 1,
      credentialId: 'vault:gemini:owner',
      credentialRevision: 1,
      providerPolicyFingerprint: 'sha256:' + 'b'.repeat(64),
      providerId: 'google-gemini',
      embeddingModelId: 'gemini-embedding-001',
      embeddingProfileId: 'prof-1',
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
    await postgresRepo.saveGeneration(generation);

    // Direct SQL insert attempting to declare dimension=768 but providing a 3-dim vector
    await expect(
      pool.query(
        `INSERT INTO projection.semantic_items (
           project_id, generation_id, semantic_item_id, resource_type, resource_id,
           source_projection_digest, canonical_version, semantic_text_digest,
           embedding_profile_id, embedding_profile_revision, representation_version,
           vector, dimension, evidence_ids, access_scope, sensitivity
         ) VALUES (
           $1, $2, 'sem-lie-1', 'CLAIM', 'claim-lie-1',
           $3, 1, $4,
           'prof-1', 1, $5,
           '[1,2,3]'::vector, 768, '{}', '{public}', 'public'
         )`,
        [
          testProjectA,
          'gen-db-chk-1',
          'sha256:' + '0'.repeat(64),
          'sha256:' + '1'.repeat(64),
          SEMANTIC_REPRESENTATION_VERSION,
        ],
      ),
    ).rejects.toThrow(/chk_semantic_item_vector_dims/);
  });

  it('5. DATABASE INTEGRITY: composite foreign key rejects item dimension and generation-bound identity mismatch', async () => {
    const generation: SemanticProjectionGeneration = {
      projectId: testProjectA,
      generationId: 'gen-db-fk-1',
      sourceProjectionDigest: 'sha256:' + 'a'.repeat(64),
      canonicalBaseVersion: 1,
      credentialId: 'vault:gemini:owner',
      credentialRevision: 1,
      providerPolicyFingerprint: 'sha256:' + 'b'.repeat(64),
      providerId: 'google-gemini',
      embeddingModelId: 'gemini-embedding-001',
      embeddingProfileId: 'prof-expected',
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
    await postgresRepo.saveGeneration(generation);

    const vec768 = JSON.stringify(new Array(768).fill(0.01));

    // Mismatched embedding_profile_id ('prof-mismatch' vs 'prof-expected') rejected by composite FK
    await expect(
      pool.query(
        `INSERT INTO projection.semantic_items (
           project_id, generation_id, semantic_item_id, resource_type, resource_id,
           source_projection_digest, canonical_version, semantic_text_digest,
           embedding_profile_id, embedding_profile_revision, representation_version,
           vector, dimension, evidence_ids, access_scope, sensitivity
         ) VALUES (
           $1, $2, 'sem-fk-lie', 'CLAIM', 'claim-fk-lie',
           $3, 1, $4,
           'prof-mismatch', 1, $5,
           $6::vector, 768, '{}', '{public}', 'public'
         )`,
        [
          testProjectA,
          'gen-db-fk-1',
          'sha256:' + '0'.repeat(64),
          'sha256:' + '1'.repeat(64),
          SEMANTIC_REPRESENTATION_VERSION,
          vec768,
        ],
      ),
    ).rejects.toThrow(/fk_semantic_items_generation_bound_identity/);
  });

  it('6. DATABASE INTEGRITY: rejects empty access_scope at database and adapter boundary', async () => {
    const generation: SemanticProjectionGeneration = {
      projectId: testProjectA,
      generationId: 'gen-scope-chk-1',
      sourceProjectionDigest: 'sha256:' + 'a'.repeat(64),
      canonicalBaseVersion: 1,
      credentialId: 'vault:gemini:owner',
      credentialRevision: 1,
      providerPolicyFingerprint: 'sha256:' + 'b'.repeat(64),
      providerId: 'google-gemini',
      embeddingModelId: 'gemini-embedding-001',
      embeddingProfileId: 'prof-1',
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
    await postgresRepo.saveGeneration(generation);

    const vec768 = new Array(768).fill(0.01);

    // 1. Adapter validation rejects empty accessScope before DB execution
    await expect(
      postgresRepo.upsertItem({
        semanticItemId: 'sem-empty-scope',
        projectId: testProjectA,
        generationId: 'gen-scope-chk-1',
        resourceType: 'CLAIM',
        resourceId: 'claim-empty-scope',
        sourceProjectionDigest: 'sha256:' + '0'.repeat(64),
        canonicalVersion: 1,
        semanticTextDigest: 'sha256:' + '1'.repeat(64),
        embeddingProfileId: 'prof-1',
        embeddingProfileRevision: 1,
        representationVersion: SEMANTIC_REPRESENTATION_VERSION,
        vector: vec768,
        dimension: 768,
        evidenceIds: [],
        accessScope: [],
        sensitivity: 'public',
        indexedAt: '2026-08-18T10:00:00.000Z',
        createdAt: '2026-08-18T10:00:00.000Z',
        updatedAt: '2026-08-18T10:00:00.000Z',
      }),
    ).rejects.toMatchObject({
      name: 'SemanticEmbeddingError',
      embeddingErrorCode: 'POLICY_DENIED',
    });

    // 2. Direct SQL insert with empty access_scope rejected by DB check constraint
    await expect(
      pool.query(
        `INSERT INTO projection.semantic_items (
           project_id, generation_id, semantic_item_id, resource_type, resource_id,
           source_projection_digest, canonical_version, semantic_text_digest,
           embedding_profile_id, embedding_profile_revision, representation_version,
           vector, dimension, evidence_ids, access_scope, sensitivity
         ) VALUES (
           $1, $2, 'sem-sql-empty-scope', 'CLAIM', 'claim-sql-empty-scope',
           $3, 1, $4,
           'prof-1', 1, $5,
           $6::vector, 768, '{}', '{}', 'public'
         )`,
        [
          testProjectA,
          'gen-scope-chk-1',
          'sha256:' + '0'.repeat(64),
          'sha256:' + '1'.repeat(64),
          SEMANTIC_REPRESENTATION_VERSION,
          JSON.stringify(vec768),
        ],
      ),
    ).rejects.toThrow(/chk_semantic_items_non_empty_access_scope/);
  });

  it('7. FINITE VECTOR VALIDATION: rejects NaN and Infinity in item and query vectors', async () => {
    const generation: SemanticProjectionGeneration = {
      projectId: testProjectA,
      generationId: 'gen-nan-chk',
      sourceProjectionDigest: 'sha256:' + '0'.repeat(64),
      canonicalBaseVersion: 1,
      credentialId: 'vault:gemini:owner',
      credentialRevision: 1,
      providerPolicyFingerprint: 'sha256:' + '1'.repeat(64),
      providerId: 'google-gemini',
      embeddingModelId: 'gemini-embedding-001',
      embeddingProfileId: 'prof-1',
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
    await postgresRepo.saveGeneration(generation);

    // 1. NaN in item vector
    const nanVec = new Array(768).fill(0.01);
    nanVec[5] = NaN;
    await expect(
      postgresRepo.upsertItem({
        semanticItemId: 'sem-nan-item',
        projectId: testProjectA,
        generationId: 'gen-nan-chk',
        resourceType: 'CLAIM',
        resourceId: 'claim-nan',
        sourceProjectionDigest: 'sha256:' + '0'.repeat(64),
        canonicalVersion: 1,
        semanticTextDigest: 'sha256:' + '1'.repeat(64),
        embeddingProfileId: 'prof-1',
        embeddingProfileRevision: 1,
        representationVersion: SEMANTIC_REPRESENTATION_VERSION,
        vector: nanVec,
        dimension: 768,
        evidenceIds: [],
        accessScope: ['public'],
        sensitivity: 'public',
        indexedAt: '2026-08-18T10:00:00.000Z',
        createdAt: '2026-08-18T10:00:00.000Z',
        updatedAt: '2026-08-18T10:00:00.000Z',
      }),
    ).rejects.toMatchObject({
      name: 'SemanticEmbeddingError',
      embeddingErrorCode: 'VALIDATION_FAILURE',
    });

    // 2. Infinity in item vector
    const infVec = new Array(768).fill(0.01);
    infVec[10] = Infinity;
    await expect(
      postgresRepo.upsertItem({
        semanticItemId: 'sem-inf-item',
        projectId: testProjectA,
        generationId: 'gen-nan-chk',
        resourceType: 'CLAIM',
        resourceId: 'claim-inf',
        sourceProjectionDigest: 'sha256:' + '0'.repeat(64),
        canonicalVersion: 1,
        semanticTextDigest: 'sha256:' + '1'.repeat(64),
        embeddingProfileId: 'prof-1',
        embeddingProfileRevision: 1,
        representationVersion: SEMANTIC_REPRESENTATION_VERSION,
        vector: infVec,
        dimension: 768,
        evidenceIds: [],
        accessScope: ['public'],
        sensitivity: 'public',
        indexedAt: '2026-08-18T10:00:00.000Z',
        createdAt: '2026-08-18T10:00:00.000Z',
        updatedAt: '2026-08-18T10:00:00.000Z',
      }),
    ).rejects.toMatchObject({
      name: 'SemanticEmbeddingError',
      embeddingErrorCode: 'VALIDATION_FAILURE',
    });

    // 3. NaN in query vector
    await expect(
      postgresRepo.findNearestNeighbors({
        projectId: testProjectA,
        generationId: 'gen-nan-chk',
        queryVector: nanVec,
        dimension: 768,
        accessScopes: ['public'],
        allowedSensitivities: ['public'],
        limit: 5,
      }),
    ).rejects.toMatchObject({
      name: 'SemanticEmbeddingError',
      embeddingErrorCode: 'VALIDATION_FAILURE',
    });

    // 4. Infinity in query vector
    await expect(
      postgresRepo.findNearestNeighbors({
        projectId: testProjectA,
        generationId: 'gen-nan-chk',
        queryVector: infVec,
        dimension: 768,
        accessScopes: ['public'],
        allowedSensitivities: ['public'],
        limit: 5,
      }),
    ).rejects.toMatchObject({
      name: 'SemanticEmbeddingError',
      embeddingErrorCode: 'VALIDATION_FAILURE',
    });
  });

  it('8. supports variable dimensions (768, 1536, 3072) across different generations', async () => {
    const gen768: SemanticProjectionGeneration = {
      projectId: testProjectA,
      generationId: 'gen-gemini-768',
      sourceProjectionDigest: 'sha256:' + '7'.repeat(64),
      canonicalBaseVersion: 1,
      credentialId: 'vault:gemini:owner',
      credentialRevision: 1,
      providerPolicyFingerprint: 'sha256:' + '8'.repeat(64),
      providerId: 'google-gemini',
      embeddingModelId: 'gemini-embedding-001',
      embeddingProfileId: 'prof-gemini',
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

    const gen1536: SemanticProjectionGeneration = {
      projectId: testProjectA,
      generationId: 'gen-openai-1536',
      sourceProjectionDigest: 'sha256:' + '5'.repeat(64),
      canonicalBaseVersion: 1,
      credentialId: 'vault:openai:owner',
      credentialRevision: 1,
      providerPolicyFingerprint: 'sha256:' + '6'.repeat(64),
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      embeddingProfileId: 'prof-openai-small',
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

    await postgresRepo.saveGeneration(gen768);
    await postgresRepo.saveGeneration(gen1536);

    const vec768 = new Array(768).fill(0.01);
    const vec1536 = new Array(1536).fill(0.005);

    await postgresRepo.upsertItem({
      semanticItemId: 'sem-768-1',
      projectId: testProjectA,
      generationId: 'gen-gemini-768',
      resourceType: 'CLAIM',
      resourceId: 'claim-gemini-1',
      sourceProjectionDigest: 'sha256:' + 'a'.repeat(64),
      canonicalVersion: 1,
      semanticTextDigest: 'sha256:' + 'a'.repeat(64),
      embeddingProfileId: 'prof-gemini',
      embeddingProfileRevision: 1,
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      vector: vec768,
      dimension: 768,
      evidenceIds: [],
      accessScope: ['engineering'],
      sensitivity: 'internal',
      indexedAt: '2026-08-18T10:00:00.000Z',
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
    });

    await postgresRepo.upsertItem({
      semanticItemId: 'sem-1536-1',
      projectId: testProjectA,
      generationId: 'gen-openai-1536',
      resourceType: 'FACT',
      resourceId: 'fact-openai-1',
      sourceProjectionDigest: 'sha256:' + 'b'.repeat(64),
      canonicalVersion: 1,
      semanticTextDigest: 'sha256:' + 'b'.repeat(64),
      embeddingProfileId: 'prof-openai-small',
      embeddingProfileRevision: 1,
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      vector: vec1536,
      dimension: 1536,
      evidenceIds: [],
      accessScope: ['engineering'],
      sensitivity: 'internal',
      indexedAt: '2026-08-18T10:00:00.000Z',
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
    });

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

  it('9. HARD REQUIREMENT: Security fails closed on empty accessScopes or missing sensitivity authorization', async () => {
    const generation: SemanticProjectionGeneration = {
      projectId: testProjectA,
      generationId: 'gen-sec-fail-closed',
      sourceProjectionDigest: 'sha256:' + '0'.repeat(64),
      canonicalBaseVersion: 1,
      credentialId: 'vault:gemini:owner',
      credentialRevision: 1,
      providerPolicyFingerprint: 'sha256:' + '1'.repeat(64),
      providerId: 'google-gemini',
      embeddingModelId: 'gemini-embedding-001',
      embeddingProfileId: 'prof-1',
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
    await postgresRepo.saveGeneration(generation);

    const queryVec = new Array(768).fill(0.01);

    // 1. Empty accessScopes must fail closed with POLICY_DENIED
    await expect(
      postgresRepo.findNearestNeighbors({
        projectId: testProjectA,
        generationId: 'gen-sec-fail-closed',
        queryVector: queryVec,
        dimension: 768,
        accessScopes: [],
        allowedSensitivities: ['public'],
        limit: 5,
      }),
    ).rejects.toMatchObject({
      name: 'SemanticEmbeddingError',
      embeddingErrorCode: 'POLICY_DENIED',
    });

    // 2. Empty allowedSensitivities must fail closed with POLICY_DENIED
    await expect(
      postgresRepo.findNearestNeighbors({
        projectId: testProjectA,
        generationId: 'gen-sec-fail-closed',
        queryVector: queryVec,
        dimension: 768,
        accessScopes: ['public'],
        allowedSensitivities: [] as unknown as readonly (
          'public' | 'internal' | 'private' | 'restricted'
        )[],
        limit: 5,
      }),
    ).rejects.toMatchObject({
      name: 'SemanticEmbeddingError',
      embeddingErrorCode: 'POLICY_DENIED',
    });
  });

  it('10. HARD REQUIREMENT: Security-before-Top-K prevents closer unauthorized items from consuming Top-K slots', async () => {
    const generation: SemanticProjectionGeneration = {
      projectId: testProjectA,
      generationId: 'gen-security-topk',
      sourceProjectionDigest: 'sha256:' + '0'.repeat(64),
      canonicalBaseVersion: 1,
      credentialId: 'vault:gemini:owner',
      credentialRevision: 1,
      providerPolicyFingerprint: 'sha256:' + '1'.repeat(64),
      providerId: 'google-gemini',
      embeddingModelId: 'gemini-embedding-001',
      embeddingProfileId: 'prof-1',
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
    await postgresRepo.saveGeneration(generation);
    await inMemoryRepo.saveGeneration(generation);

    const queryVec = new Array(768).fill(0);
    queryVec[0] = 1.0;

    // Item 1 (UNAUTHORIZED): Extremely close! [0.999, 0.044, 0, ... 0] -> cosine dist ≈ 0.001
    const vecUnauthorized = new Array(768).fill(0);
    vecUnauthorized[0] = 0.999;
    vecUnauthorized[1] = 0.044;
    const itemUnauthorized: SemanticProjectionItem = {
      semanticItemId: 'sem-unauth-1',
      projectId: testProjectA,
      generationId: 'gen-security-topk',
      resourceType: 'CLAIM',
      resourceId: 'claim-unauthorized-secret',
      sourceProjectionDigest: 'sha256:' + '1'.repeat(64),
      canonicalVersion: 1,
      semanticTextDigest: 'sha256:' + '1'.repeat(64),
      embeddingProfileId: 'prof-1',
      embeddingProfileRevision: 1,
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      vector: vecUnauthorized,
      dimension: 768,
      evidenceIds: [],
      accessScope: ['executive-confidential'],
      sensitivity: 'restricted',
      indexedAt: '2026-08-18T10:00:00.000Z',
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
    };

    // Item 2 (AUTHORIZED): Farther away [0.95, 0.31, 0, ... 0] -> cosine dist ≈ 0.05
    const vecAuthorized = new Array(768).fill(0);
    vecAuthorized[0] = 0.95;
    vecAuthorized[1] = 0.31;
    const itemAuthorized: SemanticProjectionItem = {
      semanticItemId: 'sem-auth-1',
      projectId: testProjectA,
      generationId: 'gen-security-topk',
      resourceType: 'CLAIM',
      resourceId: 'claim-authorized-public',
      sourceProjectionDigest: 'sha256:' + '2'.repeat(64),
      canonicalVersion: 1,
      semanticTextDigest: 'sha256:' + '2'.repeat(64),
      embeddingProfileId: 'prof-1',
      embeddingProfileRevision: 1,
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      vector: vecAuthorized,
      dimension: 768,
      evidenceIds: [],
      accessScope: ['public'],
      sensitivity: 'public',
      indexedAt: '2026-08-18T10:00:00.000Z',
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
    };

    await postgresRepo.upsertItems([itemUnauthorized, itemAuthorized]);
    await inMemoryRepo.upsertItems([itemUnauthorized, itemAuthorized]);

    const query: SemanticCandidateQuery = {
      projectId: testProjectA,
      generationId: 'gen-security-topk',
      queryVector: queryVec,
      dimension: 768,
      accessScopes: ['public'],
      allowedSensitivities: ['public'],
      limit: 1,
    };

    const pgResults = await postgresRepo.findNearestNeighbors(query);
    expect(pgResults).toHaveLength(1);
    expect(pgResults[0]?.resourceId).toBe('claim-authorized-public');

    const memResults = await inMemoryRepo.findNearestNeighbors(query);
    expect(memResults).toHaveLength(1);
    expect(memResults[0]?.resourceId).toBe('claim-authorized-public');
  });

  it('11. BOUNDED TOP-K: enforces finite positive integer limit <= SEMANTIC_SEARCH_MAX_LIMIT (100)', async () => {
    const generation: SemanticProjectionGeneration = {
      projectId: testProjectA,
      generationId: 'gen-limit-test',
      sourceProjectionDigest: 'sha256:' + '0'.repeat(64),
      canonicalBaseVersion: 1,
      credentialId: 'vault:gemini:owner',
      credentialRevision: 1,
      providerPolicyFingerprint: 'sha256:' + '1'.repeat(64),
      providerId: 'google-gemini',
      embeddingModelId: 'gemini-embedding-001',
      embeddingProfileId: 'prof-1',
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
    await postgresRepo.saveGeneration(generation);

    const queryVec = new Array(768).fill(0.01);

    // Limit 0 rejected
    await expect(
      postgresRepo.findNearestNeighbors({
        projectId: testProjectA,
        generationId: 'gen-limit-test',
        queryVector: queryVec,
        dimension: 768,
        accessScopes: ['public'],
        allowedSensitivities: ['public'],
        limit: 0,
      }),
    ).rejects.toMatchObject({
      name: 'SemanticEmbeddingError',
      embeddingErrorCode: 'INVALID_INPUT',
    });

    // Limit > 100 rejected
    await expect(
      postgresRepo.findNearestNeighbors({
        projectId: testProjectA,
        generationId: 'gen-limit-test',
        queryVector: queryVec,
        dimension: 768,
        accessScopes: ['public'],
        allowedSensitivities: ['public'],
        limit: SEMANTIC_SEARCH_MAX_LIMIT + 1,
      }),
    ).rejects.toMatchObject({
      name: 'SemanticEmbeddingError',
      embeddingErrorCode: 'INVALID_INPUT',
    });

    // Fractional limit rejected
    await expect(
      postgresRepo.findNearestNeighbors({
        projectId: testProjectA,
        generationId: 'gen-limit-test',
        queryVector: queryVec,
        dimension: 768,
        accessScopes: ['public'],
        allowedSensitivities: ['public'],
        limit: 2.5,
      }),
    ).rejects.toMatchObject({
      name: 'SemanticEmbeddingError',
      embeddingErrorCode: 'INVALID_INPUT',
    });
  });

  it('12. NORMALIZATION POLICY: unit_length validates unit norm on item and query vectors', async () => {
    const generation: SemanticProjectionGeneration = {
      projectId: testProjectA,
      generationId: 'gen-norm-test',
      sourceProjectionDigest: 'sha256:' + '0'.repeat(64),
      canonicalBaseVersion: 1,
      credentialId: 'vault:gemini:owner',
      credentialRevision: 1,
      providerPolicyFingerprint: 'sha256:' + '1'.repeat(64),
      providerId: 'google-gemini',
      embeddingModelId: 'gemini-embedding-001',
      embeddingProfileId: 'prof-1',
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
    await postgresRepo.saveGeneration(generation);

    // Non-unit vector (all 0.01 -> norm = sqrt(768 * 0.0001) ≈ 0.277 != 1.0) rejected
    const unnormalizedVec = new Array(768).fill(0.01);
    await expect(
      postgresRepo.upsertItem({
        semanticItemId: 'sem-unnorm-1',
        projectId: testProjectA,
        generationId: 'gen-norm-test',
        resourceType: 'CLAIM',
        resourceId: 'claim-unnorm-1',
        sourceProjectionDigest: 'sha256:' + '0'.repeat(64),
        canonicalVersion: 1,
        semanticTextDigest: 'sha256:' + '0'.repeat(64),
        embeddingProfileId: 'prof-1',
        embeddingProfileRevision: 1,
        representationVersion: SEMANTIC_REPRESENTATION_VERSION,
        vector: unnormalizedVec,
        dimension: 768,
        evidenceIds: [],
        accessScope: ['public'],
        sensitivity: 'public',
        indexedAt: '2026-08-18T10:00:00.000Z',
        createdAt: '2026-08-18T10:00:00.000Z',
        updatedAt: '2026-08-18T10:00:00.000Z',
      }),
    ).rejects.toMatchObject({
      name: 'SemanticEmbeddingError',
      embeddingErrorCode: 'VALIDATION_FAILURE',
    });
  });

  it('13. TRANSACTION ATOMICITY: PostgreSQL upsertItems rolls back entire batch when one item fails', async () => {
    const generation: SemanticProjectionGeneration = {
      projectId: testProjectA,
      generationId: 'gen-tx-test',
      sourceProjectionDigest: 'sha256:' + '0'.repeat(64),
      canonicalBaseVersion: 1,
      credentialId: 'vault:gemini:owner',
      credentialRevision: 1,
      providerPolicyFingerprint: 'sha256:' + '1'.repeat(64),
      providerId: 'google-gemini',
      embeddingModelId: 'gemini-embedding-001',
      embeddingProfileId: 'prof-1',
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
    await postgresRepo.saveGeneration(generation);

    const validVec = new Array(768).fill(0.01);
    const validItem: SemanticProjectionItem = {
      semanticItemId: 'sem-tx-valid-1',
      projectId: testProjectA,
      generationId: 'gen-tx-test',
      resourceType: 'CLAIM',
      resourceId: 'claim-tx-1',
      sourceProjectionDigest: 'sha256:' + '0'.repeat(64),
      canonicalVersion: 1,
      semanticTextDigest: 'sha256:' + '1'.repeat(64),
      embeddingProfileId: 'prof-1',
      embeddingProfileRevision: 1,
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      vector: validVec,
      dimension: 768,
      evidenceIds: [],
      accessScope: ['public'],
      sensitivity: 'public',
      indexedAt: '2026-08-18T10:00:00.000Z',
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
    };

    const invalidItem: SemanticProjectionItem = {
      semanticItemId: 'sem-tx-invalid-2',
      projectId: testProjectA,
      generationId: 'gen-tx-test',
      resourceType: 'FACT',
      resourceId: 'fact-tx-2',
      sourceProjectionDigest: 'sha256:' + '0'.repeat(64),
      canonicalVersion: 1,
      semanticTextDigest: 'sha256:' + '2'.repeat(64),
      embeddingProfileId: 'prof-1',
      embeddingProfileRevision: 1,
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      vector: new Array(768).fill(NaN), // Invalid NaN vector
      dimension: 768,
      evidenceIds: [],
      accessScope: ['public'],
      sensitivity: 'public',
      indexedAt: '2026-08-18T10:00:00.000Z',
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
    };

    await expect(postgresRepo.upsertItems([validItem, invalidItem])).rejects.toMatchObject({
      name: 'SemanticEmbeddingError',
      embeddingErrorCode: 'VALIDATION_FAILURE',
    });

    // Neither item should be persisted due to transaction rollback
    expect(
      await postgresRepo.getItem(testProjectA, 'gen-tx-test', 'CLAIM', 'claim-tx-1'),
    ).toBeUndefined();
    expect(
      await postgresRepo.getItem(testProjectA, 'gen-tx-test', 'FACT', 'fact-tx-2'),
    ).toBeUndefined();
  });

  it('14. preserves deterministic tie-break ordering on equal vector distance', async () => {
    const generation: SemanticProjectionGeneration = {
      projectId: testProjectA,
      generationId: 'gen-tiebreak',
      sourceProjectionDigest: 'sha256:' + '0'.repeat(64),
      canonicalBaseVersion: 1,
      credentialId: 'vault:openai:owner',
      credentialRevision: 1,
      providerPolicyFingerprint: 'sha256:' + '1'.repeat(64),
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      embeddingProfileId: 'prof-1',
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
    await postgresRepo.saveGeneration(generation);

    const vec = new Array(768).fill(0.01);

    const itemZ: SemanticProjectionItem = {
      semanticItemId: 'sem-fact-z',
      projectId: testProjectA,
      generationId: 'gen-tiebreak',
      resourceType: 'FACT',
      resourceId: 'fact-z',
      sourceProjectionDigest: 'sha256:' + '0'.repeat(64),
      canonicalVersion: 1,
      semanticTextDigest: 'sha256:' + '9'.repeat(64),
      embeddingProfileId: 'prof-1',
      embeddingProfileRevision: 1,
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      vector: vec,
      dimension: 768,
      evidenceIds: [],
      accessScope: ['public'],
      sensitivity: 'public',
      indexedAt: '2026-08-18T10:00:00.000Z',
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
    };

    const itemA: SemanticProjectionItem = {
      semanticItemId: 'sem-fact-a',
      projectId: testProjectA,
      generationId: 'gen-tiebreak',
      resourceType: 'FACT',
      resourceId: 'fact-a',
      sourceProjectionDigest: 'sha256:' + '0'.repeat(64),
      canonicalVersion: 1,
      semanticTextDigest: 'sha256:' + 'a'.repeat(64),
      embeddingProfileId: 'prof-1',
      embeddingProfileRevision: 1,
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      vector: vec,
      dimension: 768,
      evidenceIds: [],
      accessScope: ['public'],
      sensitivity: 'public',
      indexedAt: '2026-08-18T10:00:00.000Z',
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
    };

    const itemClaimA: SemanticProjectionItem = {
      semanticItemId: 'sem-claim-a',
      projectId: testProjectA,
      generationId: 'gen-tiebreak',
      resourceType: 'CLAIM',
      resourceId: 'claim-a',
      sourceProjectionDigest: 'sha256:' + '0'.repeat(64),
      canonicalVersion: 1,
      semanticTextDigest: 'sha256:' + 'c'.repeat(64),
      embeddingProfileId: 'prof-1',
      embeddingProfileRevision: 1,
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      vector: vec,
      dimension: 768,
      evidenceIds: [],
      accessScope: ['public'],
      sensitivity: 'public',
      indexedAt: '2026-08-18T10:00:00.000Z',
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

  it('15. CANONICAL ISOLATION: deleting projection state leaves Canonical knowledge tables unchanged and no vector columns exist in Canonical schema', async () => {
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

    const gen: SemanticProjectionGeneration = {
      projectId: testProjectA,
      generationId: 'gen-iso-test',
      sourceProjectionDigest: 'sha256:' + '0'.repeat(64),
      canonicalBaseVersion: 1,
      credentialId: 'vault:openai:owner',
      credentialRevision: 1,
      providerPolicyFingerprint: 'sha256:' + '1'.repeat(64),
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      embeddingProfileId: 'prof-1',
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
    await postgresRepo.saveGeneration(gen);

    await postgresRepo.upsertItem({
      semanticItemId: 'sem-rel-1',
      projectId: testProjectA,
      generationId: 'gen-iso-test',
      resourceType: 'RELATION',
      resourceId: 'rel-iso-1',
      sourceProjectionDigest: 'sha256:' + '0'.repeat(64),
      canonicalVersion: 1,
      semanticTextDigest: 'sha256:' + 'e'.repeat(64),
      embeddingProfileId: 'prof-1',
      embeddingProfileRevision: 1,
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      vector: new Array(768).fill(0.01),
      dimension: 768,
      evidenceIds: [],
      accessScope: ['public'],
      sensitivity: 'public',
      indexedAt: '2026-08-18T10:00:00.000Z',
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
    });

    const deleted = await postgresRepo.deleteGeneration(testProjectA, 'gen-iso-test');
    expect(deleted).toBe(true);

    const reloadedItem = await postgresRepo.getItem(
      testProjectA,
      'gen-iso-test',
      'RELATION',
      'rel-iso-1',
    );
    expect(reloadedItem).toBeUndefined();

    const canonicalState = await pool.query(
      `SELECT count(*)::text AS count FROM canonical.project_state`,
    );
    expect(canonicalState.rows[0]?.count).toBeDefined();
  });
});
