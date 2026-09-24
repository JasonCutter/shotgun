import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresEvidenceKnowledgeResetOwner } from '../../adapters/source-knowledge-reset-postgres/src/evidence-owner.js';
import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';

const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;

describe('ADR-171 Evidence erasure owner', () => {
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

  it('erases terminal Source evidence through the owner routine', async () => {
    const projectId = `t3-evidence-${randomUUID()}`;
    const requestId = randomUUID();
    const sourceId = randomUUID();
    const sourceVersionId = randomUUID();
    const assetId = randomUUID();
    const revisionId = randomUUID();
    const resultId = randomUUID();
    const now = new Date('2026-09-23T01:00:00.000Z');
    await adminPool.query(
      `INSERT INTO project_admin.projects (id, name, status, active)
       VALUES ($1, 'T3 Evidence fixture', 'ACTIVE', true)`,
      [projectId],
    );
    await adminPool.query(
      `INSERT INTO asset.original_assets (asset_id, content_hash, size_bytes, storage_key, created_at)
       VALUES ($1, $2, 7, $3, $4)`,
      [assetId, `sha256:${'1'.repeat(64)}`, `original/sha256/11/${'1'.repeat(64)}.blob`, now],
    );
    await adminPool.query(
      `INSERT INTO asset.sources (source_id, project_id, created_by_actor_id, created_at)
       VALUES ($1, $2, 'test-owner', $3)`,
      [sourceId, projectId, now],
    );
    await adminPool.query(
      `INSERT INTO asset.source_versions (
         source_version_id, source_id, version_number, original_asset_id, media_type,
         access_scope, sensitivity, created_at
       ) VALUES ($1, $2, 1, $3, 'text/plain', ARRAY['owner'], 'private', $4)`,
      [sourceVersionId, sourceId, assetId, now],
    );
    await adminPool.query(
      `INSERT INTO transformation.revisions (
         revision_id, project_id, source_id, source_version_id, source_content_hash,
         transformer_id, transformer_version, document_ir, source_map, document_hash,
         source_map_hash, access_scope, sensitivity, created_at
       ) VALUES ($1, $2, $3, $4, $5, 't3-test', '1', '{"text":"source document"}',
                '{"pointer":"source map"}', $6, $7, ARRAY['owner'], 'private', $8)`,
      [
        revisionId,
        projectId,
        sourceId,
        sourceVersionId,
        `sha256:${'2'.repeat(64)}`,
        `sha256:${'3'.repeat(64)}`,
        `sha256:${'4'.repeat(64)}`,
        now,
      ],
    );
    await adminPool.query(
      `INSERT INTO evidence.indexing_results (
         indexing_result_id, project_id, source_id, source_version_id, revision_id,
         transformer_id, transformer_version, status, evidence_count, reused_count,
         evidence_set_digest, contract_version, security_scope_digest, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, 't3-test', '1', 'INDEXED', 1, 0, $6, '1', $7, $8, $8)`,
      [
        resultId,
        projectId,
        sourceId,
        sourceVersionId,
        revisionId,
        `sha256:${'5'.repeat(64)}`,
        `sha256:${'6'.repeat(64)}`,
        now,
      ],
    );
    await adminPool.query(
      `INSERT INTO evidence.spans (
         evidence_id, revision_id, project_id, source_id, source_version_id, pointer,
         node_kind, origin, position, quote, exact_hash, access_scope, sensitivity, created_at
       ) VALUES ($1, $2, $3, $4, $5, '/p/0', 'paragraph', 'source', '{"start":0}',
                '{"text":"source quote"}', $6, ARRAY['owner'], 'private', $7)`,
      [
        randomUUID(),
        revisionId,
        projectId,
        sourceId,
        sourceVersionId,
        `sha256:${'7'.repeat(64)}`,
        now,
      ],
    );
    await adminPool.query(
      `INSERT INTO evidence.stage4_continuations (
         continuation_id, project_id, source_id, source_version_id, revision_id,
         indexing_result_id, continuation_key, evidence_snapshot, evidence_set_digest,
         evidence_count, access_scope, sensitivity, data_classification, state,
         created_at, updated_at, completed_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 't3-continuation', '[{"quote":"source"}]',
                $7, 1, ARRAY['owner'], 'private', 'source-derived', 'TERMINAL_FAILED', $8, $8, $8)`,
      [
        randomUUID(),
        projectId,
        sourceId,
        sourceVersionId,
        revisionId,
        resultId,
        `sha256:${'8'.repeat(64)}`,
        now,
      ],
    );
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
       ) VALUES ($1, $2, $3, 't3-owner', 1, 0, 1, $4, $5, $6, $7, 'FENCING', '{}'::jsonb)`,
      [
        requestId,
        randomUUID(),
        projectId,
        `sha256:${'a'.repeat(64)}`,
        `sha256:${'b'.repeat(64)}`,
        `sha256:${'c'.repeat(64)}`,
        randomUUID(),
      ],
    );

    await expect(executorPool.query('SELECT count(*) FROM evidence.spans')).rejects.toMatchObject({
      code: '42501',
    });
    const owner = new PostgresEvidenceKnowledgeResetOwner(executorPool);
    const context = {
      projectId,
      requestId,
      knowledgeEpoch: 1,
      manifestDigest: `sha256:${'a'.repeat(64)}` as `sha256:${string}`,
    };
    await expect(owner.fence(context)).resolves.toBeUndefined();
    await adminPool.query(
      `UPDATE project_admin.project_knowledge_reset_requests
       SET state = 'PURGING' WHERE project_id = $1 AND request_id = $2`,
      [projectId, requestId],
    );
    await owner.purge(context);
    await adminPool.query(
      `UPDATE project_admin.project_knowledge_reset_requests
       SET state = 'VERIFYING' WHERE project_id = $1 AND request_id = $2`,
      [projectId, requestId],
    );
    await expect(owner.verify(context)).resolves.toEqual({ verified: true, blockerCodes: [] });
    const retainedSource = await adminPool.query(
      'SELECT count(*)::text AS count FROM asset.sources WHERE project_id = $1',
      [projectId],
    );
    expect(retainedSource.rows[0]?.count).toBe('1');
  });

  it('blocks a Project with a pending Evidence continuation', async () => {
    const projectId = `t3-evidence-active-${randomUUID()}`;
    const requestId = randomUUID();
    const sourceId = randomUUID();
    const sourceVersionId = randomUUID();
    const assetId = randomUUID();
    const revisionId = randomUUID();
    const resultId = randomUUID();
    const now = new Date('2026-09-23T01:00:00.000Z');
    await adminPool.query(
      `INSERT INTO project_admin.projects (id, name, status, active)
       VALUES ($1, 'T3 Evidence active fixture', 'ACTIVE', true)`,
      [projectId],
    );
    await adminPool.query(
      `INSERT INTO asset.original_assets (asset_id, content_hash, size_bytes, storage_key, created_at)
       VALUES ($1, $2, 7, $3, $4)`,
      [assetId, `sha256:${'a'.repeat(64)}`, `original/sha256/aa/${'a'.repeat(64)}.blob`, now],
    );
    await adminPool.query(
      `INSERT INTO asset.sources (source_id, project_id, created_by_actor_id, created_at)
       VALUES ($1, $2, 'test-owner', $3)`,
      [sourceId, projectId, now],
    );
    await adminPool.query(
      `INSERT INTO asset.source_versions (
         source_version_id, source_id, version_number, original_asset_id, media_type,
         access_scope, sensitivity, created_at
       ) VALUES ($1, $2, 1, $3, 'text/plain', ARRAY['owner'], 'private', $4)`,
      [sourceVersionId, sourceId, assetId, now],
    );
    await adminPool.query(
      `INSERT INTO transformation.revisions (
         revision_id, project_id, source_id, source_version_id, source_content_hash,
         transformer_id, transformer_version, document_ir, source_map, document_hash,
         source_map_hash, access_scope, sensitivity, created_at
       ) VALUES ($1, $2, $3, $4, $5, 't3-test', '1', '{"text":"source"}', '{}', $6, $7,
                ARRAY['owner'], 'private', $8)`,
      [
        revisionId,
        projectId,
        sourceId,
        sourceVersionId,
        `sha256:${'b'.repeat(64)}`,
        `sha256:${'c'.repeat(64)}`,
        `sha256:${'d'.repeat(64)}`,
        now,
      ],
    );
    await adminPool.query(
      `INSERT INTO evidence.indexing_results (
         indexing_result_id, project_id, source_id, source_version_id, revision_id,
         transformer_id, transformer_version, status, evidence_count, reused_count,
         evidence_set_digest, contract_version, security_scope_digest, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, 't3-test', '1', 'INDEXED', 1, 0, $6, '1', $7, $8, $8)`,
      [
        resultId,
        projectId,
        sourceId,
        sourceVersionId,
        revisionId,
        `sha256:${'e'.repeat(64)}`,
        `sha256:${'f'.repeat(64)}`,
        now,
      ],
    );
    await adminPool.query(
      `INSERT INTO evidence.stage4_continuations (
         continuation_id, project_id, source_id, source_version_id, revision_id,
         indexing_result_id, continuation_key, evidence_snapshot, evidence_set_digest,
         evidence_count, access_scope, sensitivity, data_classification, state,
         created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'pending-t3-continuation', '[{"quote":"x"}]', $7, 1,
                ARRAY['owner'], 'private', 'source-derived', 'PENDING', $8, $8)`,
      [
        randomUUID(),
        projectId,
        sourceId,
        sourceVersionId,
        revisionId,
        resultId,
        `sha256:${'9'.repeat(64)}`,
        now,
      ],
    );
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
       ) VALUES ($1, $2, $3, 't3-owner', 1, 0, 1, $4, $5, $6, $7, 'FENCING', '{}'::jsonb)`,
      [
        requestId,
        randomUUID(),
        projectId,
        `sha256:${'1'.repeat(64)}`,
        `sha256:${'2'.repeat(64)}`,
        `sha256:${'3'.repeat(64)}`,
        randomUUID(),
      ],
    );

    const owner = new PostgresEvidenceKnowledgeResetOwner(executorPool);
    await expect(
      owner.fence({
        projectId,
        requestId,
        knowledgeEpoch: 1,
        manifestDigest: `sha256:${'1'.repeat(64)}`,
      }),
    ).rejects.toMatchObject({ blockerCode: 'ACTIVE_JOB_OUTCOME_UNKNOWN' });
  });
});
