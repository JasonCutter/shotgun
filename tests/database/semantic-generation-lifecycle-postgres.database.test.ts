import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { PostgresSemanticIndexRepository } from '../../adapters/semantic-index-postgres/src/index.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';
import {
  SEMANTIC_REPRESENTATION_VERSION_V2,
  semanticMembershipDigest,
  type SemanticProjectionGeneration,
  type SemanticProjectionItem,
} from '../../packages/contracts/src/index.js';

let databaseUrl: string | undefined;
if (process.env.TEST_DATABASE_URL?.trim()) {
  try {
    databaseUrl = await requireTestDatabaseTarget();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ECONNREFUSED|ENOTFOUND|timeout|connect/i.test(message)) {
      console.warn(`R3 PostgreSQL lifecycle tests skipped: ${message}`);
    } else {
      throw error;
    }
  }
}
const pool: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

const projectId = 'project-r3-postgres-lifecycle';
const digest = (value: string): string =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;

const generation = (
  generationId: string,
  sourceProjectionDigest: string,
  buildStatus: 'BUILDING' | 'READY' | 'FAILED' = 'READY',
  canonicalBaseVersion = 0,
): SemanticProjectionGeneration => ({
  projectId,
  generationId,
  sourceProjectionDigest,
  canonicalBaseVersion,
  credentialId: 'credential-r3',
  credentialRevision: 1,
  providerPolicyFingerprint: digest('policy'),
  providerId: 'provider-r3',
  embeddingModelId: 'model-r3',
  embeddingProfileId: 'profile-r3',
  embeddingProfileRevision: 1,
  providerRegistryRevision: 'providers:r3',
  capabilityCatalogRevision: 'catalog:r3',
  representationVersion: SEMANTIC_REPRESENTATION_VERSION_V2,
  dimension: 2,
  distanceMetric: 'cosine',
  normalizationPolicy: 'unit_length',
  buildStatus,
  createdAt: '2026-08-26T00:00:00.000Z',
});

const item = (generationId: string, sourceProjectionDigest: string): SemanticProjectionItem => ({
  semanticItemId: `semantic-item-${generationId}`,
  projectId,
  generationId,
  resourceType: 'CLAIM',
  resourceId: 'claim-r3',
  sourceProjectionDigest,
  canonicalVersion: 0,
  semanticTextDigest: digest('semantic-text'),
  embeddingProfileId: 'profile-r3',
  embeddingProfileRevision: 1,
  representationVersion: SEMANTIC_REPRESENTATION_VERSION_V2,
  vector: [1, 0],
  dimension: 2,
  evidenceIds: ['evidence-r3'],
  accessScope: ['project:r3'],
  sensitivity: 'internal',
  providerId: 'provider-r3',
  embeddingModelId: 'model-r3',
  normalizationPolicy: 'unit_length',
  authority: 'CANONICAL',
  provenance: {
    authority: 'CANONICAL',
    resourceBaseId: 'claim-r3',
    resourceRevision: 1,
    baseCanonicalVersion: 0,
    sourceVersionId: 'source-r3',
    evidenceIds: ['evidence-r3'],
    accessScope: ['project:r3'],
    sensitivity: 'internal',
  },
  indexedAt: '2026-08-26T00:00:00.000Z',
  createdAt: '2026-08-26T00:00:00.000Z',
  updatedAt: '2026-08-26T00:00:00.000Z',
});

describe('AKP-1R R3: PostgreSQL semantic generation lifecycle', () => {
  if (!pool) {
    it.skip('PostgreSQL test database not available; local DB test is reported as skipped.', () => {});
    return;
  }

  beforeEach(async () => {
    await pool.query(`DELETE FROM projection.semantic_generation_pointers WHERE project_id = $1`, [
      projectId,
    ]);
    await pool.query(`DELETE FROM projection.semantic_generations WHERE project_id = $1`, [
      projectId,
    ]);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM projection.semantic_generation_pointers WHERE project_id = $1`, [
      projectId,
    ]);
    await pool.query(`DELETE FROM projection.semantic_generations WHERE project_id = $1`, [
      projectId,
    ]);
    await pool.end();
  });

  it('persists base canonical version 0, R3 membership metadata, and the persisted summary', async () => {
    const repository = new PostgresSemanticIndexRepository(pool);
    const generationA = generation('generation-a', digest('source-a'), 'BUILDING', 0);
    const itemA = item(generationA.generationId, generationA.sourceProjectionDigest);
    for (const fixtureDigest of [
      generationA.sourceProjectionDigest,
      generationA.providerPolicyFingerprint,
      itemA.semanticTextDigest,
    ]) {
      expect(fixtureDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    }
    expect(await repository.saveGeneration(generationA)).toBe('CREATED');
    expect(
      await repository.transitionGenerationStatus({
        projectId,
        generationId: generationA.generationId,
        expectedStatus: 'BUILDING',
        nextStatus: 'READY',
      }),
    ).toBe('UPDATED');
    await repository.upsertGenerationItems([itemA]);

    expect(await repository.getGeneration(projectId, generationA.generationId)).toMatchObject({
      canonicalBaseVersion: 0,
      buildStatus: 'READY',
    });
    expect(
      await repository.getItem(projectId, generationA.generationId, 'CLAIM', 'claim-r3'),
    ).toEqual(itemA);
    expect(
      await repository.readGenerationMembershipSummary(projectId, generationA.generationId),
    ).toEqual({
      projectId,
      generationId: generationA.generationId,
      itemCount: 1,
      membershipDigest: semanticMembershipDigest([itemA]),
    });

    await repository.upsertGenerationItems([
      { ...itemA, vector: [0, 1], indexedAt: '2027-01-01T00:00:00.000Z' },
    ]);
    expect(
      await repository.readGenerationMembershipSummary(projectId, generationA.generationId),
    ).toEqual({
      projectId,
      generationId: generationA.generationId,
      itemCount: 1,
      membershipDigest: semanticMembershipDigest([itemA]),
    });
  });

  it('performs real concurrent first activation CAS with one winner and one typed conflict', async () => {
    const repositoryA = new PostgresSemanticIndexRepository(pool);
    const repositoryB = new PostgresSemanticIndexRepository(pool);
    const generationA = generation('generation-a', digest('source-a'));
    const generationB = generation('generation-b', digest('source-b'));
    await repositoryA.saveGeneration(generationA);
    await repositoryA.saveGeneration(generationB);

    const results = await Promise.all([
      repositoryA.activateGeneration({
        projectId,
        generationId: generationA.generationId,
        expectedPointer: { kind: 'NONE' },
        sourceProjectionDigest: generationA.sourceProjectionDigest,
        canonicalBaseVersion: generationA.canonicalBaseVersion,
        updatedAt: '2026-08-26T00:00:00.000Z',
      }),
      repositoryB.activateGeneration({
        projectId,
        generationId: generationB.generationId,
        expectedPointer: { kind: 'NONE' },
        sourceProjectionDigest: generationB.sourceProjectionDigest,
        canonicalBaseVersion: generationB.canonicalBaseVersion,
        updatedAt: '2026-08-26T00:00:01.000Z',
      }),
    ]);

    expect(results.filter((result) => result.status === 'ACTIVATED')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'CONFLICT')).toHaveLength(1);
    expect(await repositoryA.getActiveGenerationPointer(projectId)).toBeDefined();
    expect(
      (await repositoryA.getGeneration(projectId, generationA.generationId))?.buildStatus,
    ).toBe('READY');
    expect(
      (await repositoryA.getGeneration(projectId, generationB.generationId))?.buildStatus,
    ).toBe('READY');
  });

  it('rejects generation-bound source/provider/model/normalization mismatches and FACT', async () => {
    const repository = new PostgresSemanticIndexRepository(pool);
    const generationA = generation('generation-a', digest('source-a'));
    await repository.saveGeneration(generationA);

    await expect(
      repository.upsertGenerationItems([
        { ...item(generationA.generationId, digest('wrong-source')) },
      ]),
    ).rejects.toMatchObject({ embeddingErrorCode: 'VALIDATION_FAILURE' });
    await expect(
      repository.upsertGenerationItems([
        {
          ...item(generationA.generationId, generationA.sourceProjectionDigest),
          providerId: 'wrong',
        },
      ]),
    ).rejects.toMatchObject({ embeddingErrorCode: 'VALIDATION_FAILURE' });
    await expect(
      repository.upsertGenerationItems([
        {
          ...item(generationA.generationId, generationA.sourceProjectionDigest),
          resourceType: 'FACT',
        },
      ]),
    ).rejects.toMatchObject({ embeddingErrorCode: 'VALIDATION_FAILURE' });
    await expect(
      repository.upsertItem({
        ...item(generationA.generationId, generationA.sourceProjectionDigest),
        resourceType: 'FACT',
      }),
    ).rejects.toMatchObject({ embeddingErrorCode: 'VALIDATION_FAILURE' });

    await expect(
      pool.query(
        `INSERT INTO projection.semantic_items (
           project_id, generation_id, semantic_item_id, resource_type, resource_id,
           source_projection_digest, canonical_version, semantic_text_digest,
           embedding_profile_id, embedding_profile_revision, representation_version,
           vector, dimension, evidence_ids, access_scope, sensitivity,
           provider_id, embedding_model_id, normalization_policy, authority, provenance,
           indexed_at, created_at, updated_at
         ) VALUES (
           $1, $2, 'sem-fact-direct', 'FACT', 'fact-direct',
           $3, 0, $4,
           'profile-r3', 1, $5,
           '[1,0]'::vector, 2, '{evidence-r3}', '{project:r3}', 'internal',
           'provider-r3', 'model-r3', 'unit_length', 'CANONICAL', '{}'::jsonb,
           now(), now(), now()
         )`,
        [
          projectId,
          generationA.generationId,
          generationA.sourceProjectionDigest,
          digest('semantic-text-direct'),
          SEMANTIC_REPRESENTATION_VERSION_V2,
        ],
      ),
    ).rejects.toThrow(/chk_semantic_items_product_resource_type/);
    expect(
      await repository.getItem(projectId, generationA.generationId, 'CLAIM', 'claim-r3'),
    ).toBeUndefined();
  });
});
