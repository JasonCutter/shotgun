import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresKnowledgeModelResetOwner } from '../../adapters/source-knowledge-reset-postgres/src/index.js';
import { PostgresKnowledgeResetImpactInspector } from '../../adapters/source-knowledge-reset-postgres/src/impact-inspector.js';
import type { KnowledgeResetOwnerContext } from '../../modules/source-knowledge-reset/src/index.js';
import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';

const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const hash = (character: string): string => `sha256:${character.repeat(64)}`;

describe('ADR-171 Knowledge Model erasure owner', () => {
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
       VALUES ($1, 'T3 Knowledge Model fixture', 'ACTIVE', true)`,
      [projectId],
    );
  };

  const addSourceVersion = async (projectId: string) => {
    const sourceId = randomUUID();
    const sourceVersionId = randomUUID();
    const assetId = randomUUID();
    const now = new Date().toISOString();
    const contentHash = `sha256:${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`;
    await adminPool.query(
      `INSERT INTO asset.original_assets (asset_id, content_hash, size_bytes, storage_key, created_at)
       VALUES ($1, $2, 12, $3, $4)`,
      [assetId, contentHash, `t3-knowledge/${assetId}`, now],
    );
    await adminPool.query(
      `INSERT INTO asset.sources (source_id, project_id, created_by_actor_id, created_at)
       VALUES ($1, $2, 't3-knowledge-test', $3)`,
      [sourceId, projectId, now],
    );
    await adminPool.query(
      `INSERT INTO asset.source_versions (
         source_version_id, source_id, version_number, original_asset_id,
         media_type, access_scope, sensitivity, created_at
       ) VALUES ($1, $2, 1, $3, 'text/plain', ARRAY['project:owner'], 'private', $4)`,
      [sourceVersionId, sourceId, assetId, now],
    );
    return sourceVersionId;
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
       ) VALUES ($1, $2, $3, 't3-knowledge-test', 1, 0, 1, $4, $5, $6, $7,
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

  const setState = async (context: KnowledgeResetOwnerContext, state: string) => {
    await executorPool.query(
      'SELECT project_admin.t3_set_reset_execution_state($1, $2::uuid, $3, $4::text[])',
      [context.projectId, context.requestId, state, []],
    );
  };

  it('removes source-bound review groups and imports while retaining other Projects', async () => {
    const projectId = `t3-knowledge-${randomUUID()}`;
    const otherProjectId = `${projectId}-other`;
    await createProject(projectId);
    await createProject(otherProjectId);
    const sourceVersionId = await addSourceVersion(projectId);
    const otherSourceVersionId = await addSourceVersion(otherProjectId);
    await adminPool.query(
      `INSERT INTO knowledge.review_groups (
         project_id, group_id, source_version_id, revision_number, status,
         content_digest, items, decisions, access_scope, sensitivity, created_at, updated_at
       ) VALUES ($1, 'selected-group', $2, 1, 'PENDING_REVIEW', $3,
                 '[{"canary":"T3_KNOWLEDGE_REVIEW_CANARY"}]'::jsonb, '[]'::jsonb,
                 ARRAY['project:owner'], 'private', now(), now())`,
      [projectId, sourceVersionId, hash('e')],
    );
    await adminPool.query(
      `INSERT INTO knowledge.entity_vault_imports (
         project_id, import_id, source_version_id, status, content_digest,
         entity_count, entities, canonical_write, next_action, created_at, updated_at
       ) VALUES ($1, 'selected-import', $2, 'PENDING_APPROVAL', $3, 1,
                 '[{"canary":"T3_KNOWLEDGE_IMPORT_CANARY"}]'::jsonb, false,
                 'REVIEW_AND_STAGE_KNOWLEDGE_GROUP', now(), now())`,
      [projectId, sourceVersionId, hash('f')],
    );
    await adminPool.query(
      `INSERT INTO knowledge.review_groups (
         project_id, group_id, source_version_id, revision_number, status,
         content_digest, items, decisions, access_scope, sensitivity, created_at, updated_at
       ) VALUES ($1, 'other-group', $2, 1, 'PENDING_REVIEW', $3,
                 '[{"safe":"other project"}]'::jsonb, '[]'::jsonb,
                 ARRAY['project:owner'], 'private', now(), now())`,
      [otherProjectId, otherSourceVersionId, hash('1')],
    );

    const preview = await new PostgresKnowledgeResetImpactInspector(
      adminPool,
      true,
    ).inspectProjectSourceKnowledge(projectId);
    expect(preview.counts.sourceDerivedRecordCount).toBe(2);
    expect(preview.blockers).not.toContain('UNCLASSIFIED_CONTENT');

    const context = await createReset(projectId);
    const owner = new PostgresKnowledgeModelResetOwner(executorPool);
    await owner.fence(context);
    await setState(context, 'PURGING');
    await owner.purge(context);
    await owner.purge(context);
    await expect(owner.verify(context)).resolves.toEqual({ verified: true, blockerCodes: [] });

    const selectedCount = await adminPool.query<{ count: string }>(
      `SELECT (
         (SELECT count(*) FROM knowledge.review_groups WHERE project_id = $1) +
         (SELECT count(*) FROM knowledge.entity_vault_imports WHERE project_id = $1)
       )::text AS count`,
      [projectId],
    );
    expect(selectedCount.rows[0]?.count).toBe('0');
    const otherCount = await adminPool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM knowledge.review_groups WHERE project_id = $1',
      [otherProjectId],
    );
    expect(otherCount.rows[0]?.count).toBe('1');
  });

  it('blocks a SourceVersion whose owning Project disagrees with the Knowledge row', async () => {
    const projectId = `t3-knowledge-mismatch-${randomUUID()}`;
    const ownerProjectId = `${projectId}-owner`;
    await createProject(projectId);
    await createProject(ownerProjectId);
    const foreignSourceVersionId = await addSourceVersion(ownerProjectId);
    await adminPool.query(
      `INSERT INTO knowledge.review_groups (
         project_id, group_id, source_version_id, revision_number, status,
         content_digest, items, decisions, access_scope, sensitivity, created_at, updated_at
       ) VALUES ($1, 'mismatched-group', $2, 1, 'PENDING_REVIEW', $3,
                 '[{"canary":"T3_KNOWLEDGE_MISMATCH_CANARY"}]'::jsonb, '[]'::jsonb,
                 ARRAY['project:owner'], 'private', now(), now())`,
      [projectId, foreignSourceVersionId, hash('9')],
    );
    const context = await createReset(projectId);
    const preview = await new PostgresKnowledgeResetImpactInspector(
      adminPool,
      true,
    ).inspectProjectSourceKnowledge(projectId);
    expect(preview.blockers).toContain('UNCLASSIFIED_CONTENT');
    const owner = new PostgresKnowledgeModelResetOwner(executorPool);
    await expect(owner.fence(context)).rejects.toMatchObject({
      blockerCode: 'UNCLASSIFIED_CONTENT',
    });
    const retained = await adminPool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM knowledge.review_groups WHERE project_id = $1',
      [projectId],
    );
    expect(retained.rows[0]?.count).toBe('1');
  });
});
