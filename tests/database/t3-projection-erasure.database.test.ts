import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  PostgresKnowledgeResetPersistence,
  PostgresProjectionKnowledgeResetOwner,
  PostgresProjectionResetSnapshotWriter,
} from '../../adapters/source-knowledge-reset-postgres/src/index.js';
import { PostgresKnowledgeResetImpactInspector } from '../../adapters/source-knowledge-reset-postgres/src/impact-inspector.js';
import type { CompiledTruthProjection } from '../../packages/contracts/src/index.js';
import {
  approvedKnowledgeDigest,
  semanticCorpusSourceSnapshotDigest,
} from '../../packages/contracts/src/semantic-corpus.js';
import type { KnowledgeResetOwnerContext } from '../../modules/source-knowledge-reset/src/index.js';
import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';

const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const hash = (character: string): string => `sha256:${character.repeat(64)}`;

describe('ADR-171 Projection erasure owner', () => {
  let database: Awaited<ReturnType<typeof createIsolatedPostgresTestDatabase>>;
  let adminPool: Pool;
  let executorPool: Pool;

  beforeAll(async () => {
    database = await createIsolatedPostgresTestDatabase();
    adminPool = database.createPool();
    const password = randomUUID();
    await adminPool.query(
      `ALTER ROLE shotgun_erasure_executor LOGIN PASSWORD ${literal(password)}`,
    );
    const connection = new URL(database.databaseUrl);
    connection.username = 'shotgun_erasure_executor';
    connection.password = password;
    executorPool = new Pool({ connectionString: connection.toString(), max: 1 });
    await executorPool.query('SELECT 1');
  });

  afterAll(async () => {
    await executorPool?.end();
    await adminPool?.query('ALTER ROLE shotgun_erasure_executor NOLOGIN PASSWORD NULL');
    await database?.dispose();
  });

  const createProject = async (projectId: string) => {
    await adminPool.query(
      `INSERT INTO project_admin.projects (id, name, status, active)
       VALUES ($1, 'T3 Projection fixture', 'ACTIVE', true)`,
      [projectId],
    );
    await adminPool.query(
      `INSERT INTO canonical.project_state (project_id, version, snapshot_digest, updated_at)
       VALUES ($1, 3, $2, now())`,
      [projectId, hash('a')],
    );
  };

  const createReset = async (projectId: string): Promise<KnowledgeResetOwnerContext> => {
    const requestId = randomUUID();
    await adminPool.query(
      `INSERT INTO project_admin.project_knowledge_epoch (project_id, epoch, state)
       VALUES ($1, 1, 'RESET_PENDING')`,
      [projectId],
    );
    await adminPool.query(
      `INSERT INTO project_admin.project_knowledge_reset_requests (
         request_id, preview_id, project_id, actor_principal_id, project_revision,
         expected_knowledge_epoch, resulting_knowledge_epoch, manifest_digest,
         owner_manifest_digest, preserved_configuration_digest, idempotency_key,
         state, impact_counts
       ) VALUES ($1, $2, $3, 't3-projection-test', 1, 0, 1, $4, $5, $6, $7,
                 'FENCING', '{}'::jsonb)`,
      [requestId, randomUUID(), projectId, hash('b'), hash('c'), hash('d'), randomUUID()],
    );
    return {
      projectId,
      requestId,
      knowledgeEpoch: 1,
      manifestDigest: hash('b') as `sha256:${string}`,
    };
  };

  const beginPurge = async (context: KnowledgeResetOwnerContext) => {
    await executorPool.query(
      'SELECT project_admin.t3_set_reset_execution_state($1, $2::uuid, $3, $4::text[])',
      [context.projectId, context.requestId, 'PURGING', []],
    );
    await executorPool.query('SELECT set_config($1, $2, false)', [
      'shotgun.t3_reset_request_id',
      context.requestId,
    ]);
  };

  const addProjectionProfileAndGeneration = async (
    projectId: string,
    buildStatus: 'READY' | 'BUILDING' = 'READY',
  ) => {
    const generationId = `generation-${randomUUID()}`;
    const profileId = `profile-${randomUUID()}`;
    await adminPool.query(
      `INSERT INTO projection.semantic_embedding_profiles (
         project_id, profile_id, profile_revision, provider_id, embedding_model_id,
         credential_id, credential_revision, representation_version, dimension,
         distance_metric, normalization_policy, status, created_by, updated_by
       ) VALUES ($1, $2, 1, 'provider-fixture', 'embedding-fixture', 'credential-fixture',
                 1, 'representation-v1', 2, 'cosine', 'unit_length', 'ACTIVE', 'test', 'test')`,
      [projectId, profileId],
    );
    await adminPool.query(
      `INSERT INTO projection.semantic_generations (
         project_id, generation_id, source_projection_digest, canonical_base_version,
         credential_id, credential_revision, provider_policy_fingerprint, provider_id,
         embedding_model_id, embedding_profile_id, embedding_profile_revision,
         provider_registry_revision, capability_catalog_revision, representation_version,
         dimension, distance_metric, normalization_policy, build_status
       ) VALUES ($1, $2, $3, 3, 'credential-fixture', 1, $4, 'provider-fixture',
                 'embedding-fixture', $5, 1, 'provider-registry-v1', 'capability-v1',
                 'representation-v1', 2, 'cosine', 'unit_length', $6)`,
      [projectId, generationId, hash('e'), hash('f'), profileId, buildStatus],
    );
    if (buildStatus === 'READY') {
      await adminPool.query(
        `INSERT INTO projection.semantic_generation_pointers (
           project_id, active_generation_id, pointer_revision, source_projection_digest,
           canonical_base_version
         ) VALUES ($1, $2, 1, $3, 3)`,
        [projectId, generationId, hash('e')],
      );
      await adminPool.query(
        `INSERT INTO projection.semantic_items (
           project_id, generation_id, semantic_item_id, resource_type, resource_id,
           source_projection_digest, canonical_version, semantic_text_digest,
           embedding_profile_id, embedding_profile_revision, representation_version,
           vector, dimension, evidence_ids, access_scope, sensitivity, provider_id,
           embedding_model_id, normalization_policy, indexed_at
         ) VALUES ($1, $2, $3, 'CLAIM', 'old-source-claim', $4, 3, $5, $6, 1,
                   'representation-v1', '[0.1,0.2]'::vector, 2, ARRAY[]::text[],
                   ARRAY['project-member']::text[], 'private', 'provider-fixture',
                   'embedding-fixture', 'unit_length', now())`,
        [projectId, generationId, `semantic-${randomUUID()}`, hash('e'), hash('a'), profileId],
      );
    }
    return { generationId, profileId };
  };

  const addOldProjectProjections = async (projectId: string) => {
    await adminPool.query(
      `INSERT INTO projection.search_documents (
         project_id, claim_id, commit_id, revision_id, canonical_version, claim_text,
         source_version_id, evidence_ids, access_scope, sensitivity, projected_at
       ) VALUES ($1, 'old-source-claim', $2, 'old-source-revision', 3,
                 'SOURCE_CANARY_OLD_CLAIM', $3, ARRAY['evidence-old'],
                 ARRAY['project-member'], 'private', now())`,
      [projectId, randomUUID(), randomUUID()],
    );
    await adminPool.query(
      `INSERT INTO projection.watermarks (
         project_id, last_commit_id, canonical_version, snapshot_digest, status, updated_at
       ) VALUES ($1, $2, 3, $3, 'READY', now())`,
      [projectId, randomUUID(), hash('a')],
    );
    await adminPool.query(
      `INSERT INTO projection.compiled_truth (
         project_id, projector_version, source_snapshot_digest, logical_digest,
         canonical_version, build_mode, projection, status, updated_at
       ) VALUES ($1, 'fixture-v1', $2, $3, 3, 'FULL_REBUILD',
                 '{"sourceCanary":"SOURCE_CANARY_OLD_CLAIM"}'::jsonb, 'READY', now())`,
      [projectId, hash('a'), hash('b')],
    );
    await adminPool.query(
      `INSERT INTO projection.discovery_inferences (
         project_id, fingerprint, candidate_id, candidate, created_at
       ) VALUES ($1, $2, 'inference-old', '{"sourceCanary":"SOURCE_CANARY_OLD_CLAIM"}'::jsonb, now())`,
      [projectId, hash('c')],
    );
  };

  it('purges old projection payloads, preserves embedding settings and verifies rebuilt watermarks', async () => {
    const projectId = `t3-projection-${randomUUID()}`;
    await createProject(projectId);
    const { profileId } = await addProjectionProfileAndGeneration(projectId);
    await addOldProjectProjections(projectId);
    const persistence = new PostgresKnowledgeResetPersistence(adminPool);
    const preservedConfigurationBefore =
      await persistence.fingerprintPreservedProjectConfiguration(projectId);
    await adminPool.query(
      `UPDATE canonical.project_state SET version = 4, snapshot_digest = $2, updated_at = now()
       WHERE project_id = $1`,
      [projectId, hash('d')],
    );
    const context = await createReset(projectId);
    let rebuilt = false;
    const writer = new PostgresProjectionResetSnapshotWriter(executorPool);
    const sourceSnapshotDigest = semanticCorpusSourceSnapshotDigest({
      projectId,
      canonicalVersion: 4,
      canonicalSnapshotDigest: hash('d'),
      approvedKnowledgeDigest: approvedKnowledgeDigest([]),
    });
    expect(sourceSnapshotDigest).not.toBe(hash('d'));
    const compiledProjection: CompiledTruthProjection = {
      projectId,
      projectorVersion: 'fixture-v2',
      sourceSnapshotDigest,
      logicalDigest: hash('e'),
      canonicalVersion: 4,
      items: [],
      graph: {
        nodes: [],
        edges: [],
        fallback: { available: true, modes: ['LIST', 'TABLE'] },
      },
      projectedAt: new Date().toISOString(),
      buildMode: 'FULL_REBUILD',
    };
    const owner = new PostgresProjectionKnowledgeResetOwner(executorPool, {
      async rebuildProjectProjections(resetContext) {
        rebuilt = true;
        expect(resetContext).toEqual(context);
        await executorPool.query(
          'SELECT project_admin.t3_set_reset_execution_state($1, $2::uuid, $3, $4::text[])',
          [projectId, resetContext.requestId, 'REBUILDING', []],
        );
        await writer.persist({
          context: resetContext,
          searchDocuments: [],
          compiledProjection,
        });
      },
    });

    const preview = await new PostgresKnowledgeResetImpactInspector(
      adminPool,
      true,
    ).inspectProjectSourceKnowledge(projectId);
    expect(preview.counts.rebuildProjectionCount).toBeGreaterThanOrEqual(7);

    await owner.fence(context);
    await beginPurge(context);
    await owner.purge(context);
    expect(await owner.verify(context)).toEqual({
      verified: false,
      blockerCodes: ['UNCLASSIFIED_CONTENT'],
    });
    await owner.rebuild(context);
    expect(rebuilt).toBe(true);
    expect(await owner.verify(context)).toEqual({ verified: true, blockerCodes: [] });
    const persistedCompiledProjection = await adminPool.query<{
      source_snapshot_digest: string;
      projection: CompiledTruthProjection;
    }>(
      `SELECT source_snapshot_digest, projection
       FROM projection.compiled_truth WHERE project_id = $1`,
      [projectId],
    );
    expect(persistedCompiledProjection.rows[0]?.source_snapshot_digest).toBe(sourceSnapshotDigest);
    expect(persistedCompiledProjection.rows[0]?.projection.sourceSnapshotDigest).toBe(
      sourceSnapshotDigest,
    );
    expect(await persistence.fingerprintPreservedProjectConfiguration(projectId)).toBe(
      preservedConfigurationBefore,
    );

    const preservedProfile = await adminPool.query<{ profile_id: string }>(
      `SELECT profile_id FROM projection.semantic_embedding_profiles WHERE project_id = $1`,
      [projectId],
    );
    expect(preservedProfile.rows.map((row) => row.profile_id)).toEqual([profileId]);
    const stalePayloads = await adminPool.query<{ count: string }>(
      `SELECT (
         (SELECT count(*) FROM projection.search_documents
          WHERE project_id = $1 AND claim_text LIKE '%SOURCE_CANARY%')
         + (SELECT count(*) FROM projection.compiled_truth
            WHERE project_id = $1 AND projection::text LIKE '%SOURCE_CANARY%')
         + (SELECT count(*) FROM projection.discovery_inferences
            WHERE project_id = $1 AND candidate::text LIKE '%SOURCE_CANARY%')
         + (SELECT count(*) FROM projection.semantic_generations WHERE project_id = $1)
         + (SELECT count(*) FROM projection.semantic_items WHERE project_id = $1)
         + (SELECT count(*) FROM projection.semantic_generation_pointers WHERE project_id = $1)
       )::text AS count`,
      [projectId],
    );
    expect(stalePayloads.rows[0]?.count).toBe('0');
    await executorPool.query('SELECT set_config($1, $2, false)', [
      'shotgun.t3_reset_request_id',
      '',
    ]);
  }, 60_000);

  it('blocks active semantic generation work before deleting any projection rows', async () => {
    const projectId = `t3-projection-active-${randomUUID()}`;
    await createProject(projectId);
    await addProjectionProfileAndGeneration(projectId, 'BUILDING');
    await addOldProjectProjections(projectId);
    const context = await createReset(projectId);
    const owner = new PostgresProjectionKnowledgeResetOwner(executorPool, {
      async rebuildProjectProjections() {
        throw new Error('Rebuild must not run for blocked work.');
      },
    });

    await expect(owner.fence(context)).rejects.toMatchObject({
      blockerCode: 'ACTIVE_JOB_OUTCOME_UNKNOWN',
    });
    const before = await adminPool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM projection.search_documents WHERE project_id = $1',
      [projectId],
    );
    expect(before.rows[0]?.count).toBe('1');
  }, 60_000);

  it('rejects the ordinary database role from invoking projection erasure', async () => {
    const projectId = `t3-projection-role-${randomUUID()}`;
    await createProject(projectId);
    await addOldProjectProjections(projectId);
    const context = await createReset(projectId);
    await adminPool.query('SELECT set_config($1, $2, false)', [
      'shotgun.t3_reset_request_id',
      context.requestId,
    ]);

    await expect(
      adminPool.query('SELECT projection.t3_erase_project_projections($1, $2::uuid)', [
        projectId,
        context.requestId,
      ]),
    ).rejects.toMatchObject({ constraint: 't3_erasure_executor_required' });
    const remains = await adminPool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM projection.search_documents WHERE project_id = $1',
      [projectId],
    );
    expect(remains.rows[0]?.count).toBe('1');
    await adminPool.query('SELECT set_config($1, $2, false)', ['shotgun.t3_reset_request_id', '']);
  }, 60_000);
});
