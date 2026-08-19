import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import {
  PostgresSemanticActiveGenerationReader,
  PostgresSemanticIndexRepository,
} from '../../adapters/semantic-index-postgres/src/index.js';
import {
  type SemanticProjectionGeneration,
  type SemanticProjectionItem,
  SEMANTIC_EMBEDDING_CATALOG_REVISION,
  SEMANTIC_REPRESENTATION_VERSION,
  SemanticEmbeddingError,
} from '../../packages/contracts/src/index.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

describe('AKP-1 WP4: PostgreSQL Durable Semantic Lifecycle & Pointer Management', () => {
  if (!pool) {
    it.skip('PostgreSQL test database not available', () => {});
    return;
  }

  const postgresRepo = new PostgresSemanticIndexRepository(pool);
  const activeReader = new PostgresSemanticActiveGenerationReader(pool);

  const testProjectA = 'project-lifecycle-db-a';
  const testProjectB = 'project-lifecycle-db-b';

  const makeSampleGeneration = (
    projectId: string,
    generationId: string,
    opts?: { buildStatus?: 'BUILDING' | 'READY' | 'FAILED'; createdAt?: string },
  ): SemanticProjectionGeneration => ({
    projectId,
    generationId,
    sourceProjectionDigest: 'sha256:' + 'a'.repeat(64),
    canonicalBaseVersion: 1,
    credentialId: 'cred-1',
    credentialRevision: 1,
    providerPolicyFingerprint: 'sha256:' + 'b'.repeat(64),
    providerId: 'fake-provider',
    embeddingModelId: 'fake-model-1',
    embeddingProfileId: 'prof-1',
    embeddingProfileRevision: 1,
    providerRegistryRevision: 'prov-reg:v1',
    capabilityCatalogRevision: SEMANTIC_EMBEDDING_CATALOG_REVISION,
    representationVersion: SEMANTIC_REPRESENTATION_VERSION,
    dimension: 8,
    distanceMetric: 'cosine',
    normalizationPolicy: 'unit_length',
    buildStatus: opts?.buildStatus ?? 'READY',
    createdAt: opts?.createdAt ?? '2026-08-18T10:00:00.000Z',
  });

  const cleanup = async () => {
    if (!pool) return;
    await pool.query(
      `DELETE FROM projection.semantic_generation_pointers WHERE project_id IN ($1, $2)`,
      [testProjectA, testProjectB],
    );
    await pool.query(`DELETE FROM projection.semantic_generations WHERE project_id IN ($1, $2)`, [
      testProjectA,
      testProjectB,
    ]);
  };

  beforeEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    if (pool) {
      await cleanup();
      await pool.end();
    }
  });

  it('1. verifies migration 043 schema table projection.semantic_generation_pointers exists', async () => {
    const tableRes = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'projection' AND table_name = 'semantic_generation_pointers'`,
    );
    expect(tableRes.rowCount).toBe(1);
  });

  it('2. persists active pointer, enforces CAS concurrency guard, and survives repository recreation', async () => {
    const gen1 = makeSampleGeneration(testProjectA, 'gen-cas-1');
    const gen2 = makeSampleGeneration(testProjectA, 'gen-cas-2');
    await postgresRepo.saveGeneration(gen1);
    await postgresRepo.saveGeneration(gen2);

    // Initial activation
    const pointer1 = await postgresRepo.switchActiveGeneration({
      projectId: testProjectA,
      targetGenerationId: 'gen-cas-1',
    });
    expect(pointer1.activeGenerationId).toBe('gen-cas-1');
    expect(pointer1.pointerRevision).toBe(1);
    expect(pointer1.lastKnownGoodGenerationId).toBeUndefined();

    // Verify pointer survives new repository instance
    const newRepo = new PostgresSemanticIndexRepository(pool);
    const reloadedPointer = await newRepo.getActivePointer(testProjectA);
    expect(reloadedPointer?.activeGenerationId).toBe('gen-cas-1');
    expect(reloadedPointer?.pointerRevision).toBe(1);

    // Reader reads active generation
    const activeGen = await activeReader.getActiveGeneration(testProjectA);
    expect(activeGen?.generationId).toBe('gen-cas-1');

    // Competing CAS switch with wrong expectedActiveGenerationId fails closed
    await expect(
      postgresRepo.switchActiveGeneration({
        projectId: testProjectA,
        targetGenerationId: 'gen-cas-2',
        expectedCurrentActiveGenerationId: 'gen-wrong',
      }),
    ).rejects.toThrow(SemanticEmbeddingError);

    // Competing CAS switch with wrong expectedPointerRevision fails closed
    await expect(
      postgresRepo.switchActiveGeneration({
        projectId: testProjectA,
        targetGenerationId: 'gen-cas-2',
        expectedPointerRevision: 999,
      }),
    ).rejects.toThrow(SemanticEmbeddingError);

    // Correct CAS switch succeeds and increments revision
    const pointer2 = await postgresRepo.switchActiveGeneration({
      projectId: testProjectA,
      targetGenerationId: 'gen-cas-2',
      expectedCurrentActiveGenerationId: 'gen-cas-1',
      expectedPointerRevision: 1,
    });
    expect(pointer2.activeGenerationId).toBe('gen-cas-2');
    expect(pointer2.lastKnownGoodGenerationId).toBe('gen-cas-1');
    expect(pointer2.pointerRevision).toBe(2);
  });

  it('3. rejects activation of non-READY generation', async () => {
    const genBuilding = makeSampleGeneration(testProjectA, 'gen-build', {
      buildStatus: 'BUILDING',
    });
    await postgresRepo.saveGeneration(genBuilding);

    await expect(
      postgresRepo.switchActiveGeneration({
        projectId: testProjectA,
        targetGenerationId: 'gen-build',
      }),
    ).rejects.toThrow(/only READY generations may be activated/i);
  });

  it('4. enforces project isolation: Project A cannot activate or read Project B generation', async () => {
    const genB = makeSampleGeneration(testProjectB, 'gen-b-1');
    await postgresRepo.saveGeneration(genB);

    // Project A attempting to activate Project B's generation fails
    await expect(
      postgresRepo.switchActiveGeneration({
        projectId: testProjectA,
        targetGenerationId: 'gen-b-1',
      }),
    ).rejects.toThrow(/does not exist for project 'project-lifecycle-db-a'/i);

    // Project A reader returns undefined
    const activeA = await activeReader.getActiveGeneration(testProjectA);
    expect(activeA).toBeUndefined();
  });

  it('5. performs atomic rollback to last-known-good generation', async () => {
    const gen1 = makeSampleGeneration(testProjectA, 'gen-rb-1');
    const gen2 = makeSampleGeneration(testProjectA, 'gen-rb-2');
    await postgresRepo.saveGeneration(gen1);
    await postgresRepo.saveGeneration(gen2);

    await postgresRepo.switchActiveGeneration({
      projectId: testProjectA,
      targetGenerationId: 'gen-rb-1',
    });
    await postgresRepo.switchActiveGeneration({
      projectId: testProjectA,
      targetGenerationId: 'gen-rb-2',
    });

    // Rollback switches active pointer back to gen-rb-1
    const rolledBack = await postgresRepo.rollbackActiveGeneration({ projectId: testProjectA });
    expect(rolledBack.activeGenerationId).toBe('gen-rb-1');
    expect(rolledBack.lastKnownGoodGenerationId).toBeUndefined();
    expect(rolledBack.pointerRevision).toBe(3);

    const currentActive = await activeReader.getActiveGeneration(testProjectA);
    expect(currentActive?.generationId).toBe('gen-rb-1');

    // Attempting second rollback when no LKG exists fails closed
    await expect(
      postgresRepo.rollbackActiveGeneration({ projectId: testProjectA }),
    ).rejects.toThrow(/No rollback generation exists/i);
  });

  it('6. executes bounded pruning: preserves active, rollback, and building generations, deletes old items and generations', async () => {
    // Save 4 generations
    const gen1 = makeSampleGeneration(testProjectA, 'gen-prune-1', {
      createdAt: '2026-08-18T08:00:00.000Z',
    });
    const gen2 = makeSampleGeneration(testProjectA, 'gen-prune-2', {
      createdAt: '2026-08-18T09:00:00.000Z',
    });
    const genOld = makeSampleGeneration(testProjectA, 'gen-prune-old', {
      createdAt: '2026-08-18T07:00:00.000Z',
    });
    const genBuilding = makeSampleGeneration(testProjectA, 'gen-prune-building', {
      buildStatus: 'BUILDING',
      createdAt: '2026-08-18T10:00:00.000Z',
    });

    await postgresRepo.saveGeneration(gen1);
    await postgresRepo.saveGeneration(gen2);
    await postgresRepo.saveGeneration(genOld);
    await postgresRepo.saveGeneration(genBuilding);

    const vec = new Array(8).fill(1 / Math.sqrt(8));
    const item: SemanticProjectionItem = {
      semanticItemId: 'sem-old-1',
      projectId: testProjectA,
      generationId: 'gen-prune-old',
      resourceType: 'CLAIM',
      resourceId: 'claim-old-1',
      sourceProjectionDigest: genOld.sourceProjectionDigest,
      canonicalVersion: 1,
      semanticTextDigest: 'sha256:' + 'c'.repeat(64),
      embeddingProfileId: genOld.embeddingProfileId,
      embeddingProfileRevision: genOld.embeddingProfileRevision,
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      vector: vec,
      dimension: 8,
      evidenceIds: ['ev-1'],
      accessScope: ['engineering'],
      sensitivity: 'internal',
      indexedAt: '2026-08-18T07:05:00.000Z',
      createdAt: '2026-08-18T07:00:00.000Z',
      updatedAt: '2026-08-18T07:05:00.000Z',
    };
    await postgresRepo.upsertItem(item);

    // Setup pointers: gen-prune-1 = LKG, gen-prune-2 = ACTIVE
    await postgresRepo.switchActiveGeneration({
      projectId: testProjectA,
      targetGenerationId: 'gen-prune-1',
    });
    await postgresRepo.switchActiveGeneration({
      projectId: testProjectA,
      targetGenerationId: 'gen-prune-2',
    });

    // Prune with retainMaxCount: 2
    const pruneResult = await postgresRepo.pruneGenerations({
      projectId: testProjectA,
      retainMaxCount: 2,
    });
    expect(pruneResult.prunedGenerationIds).toContain('gen-prune-old');
    expect(pruneResult.retainedGenerationIds).toContain('gen-prune-2');
    expect(pruneResult.retainedGenerationIds).toContain('gen-prune-1');
    expect(pruneResult.retainedGenerationIds).toContain('gen-prune-building');

    // Verify gen-prune-old and its item were deleted from database
    const oldGen = await postgresRepo.getGeneration(testProjectA, 'gen-prune-old');
    expect(oldGen).toBeUndefined();

    const oldItem = await postgresRepo.getItem(
      testProjectA,
      'gen-prune-old',
      'CLAIM',
      'claim-old-1',
    );
    expect(oldItem).toBeUndefined();

    // Verify retained generations are still in database
    const retainedActive = await postgresRepo.getGeneration(testProjectA, 'gen-prune-2');
    const retainedLkg = await postgresRepo.getGeneration(testProjectA, 'gen-prune-1');
    const retainedBuilding = await postgresRepo.getGeneration(testProjectA, 'gen-prune-building');
    expect(retainedActive).toBeDefined();
    expect(retainedLkg).toBeDefined();
    expect(retainedBuilding).toBeDefined();
  });
});
