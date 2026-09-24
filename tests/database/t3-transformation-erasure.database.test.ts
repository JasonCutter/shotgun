import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresTransformationKnowledgeResetOwner } from '../../adapters/source-knowledge-reset-postgres/src/transformation-owner.js';
import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';

const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;

describe('ADR-171 Transformation erasure owner', () => {
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

  it('removes selected Project attempts and revisions while retaining another Project', async () => {
    const projectId = `t3-transform-${randomUUID()}`;
    const otherProjectId = `t3-transform-other-${randomUUID()}`;
    const requestId = randomUUID();
    const sourceVersionId = randomUUID();
    const otherSourceVersionId = randomUUID();
    const revisionId = randomUUID();
    const otherRevisionId = randomUUID();
    const now = new Date('2026-09-23T01:00:00.000Z');
    for (const id of [projectId, otherProjectId]) {
      await adminPool.query(
        `INSERT INTO project_admin.projects (id, name, status, active)
         VALUES ($1, 'T3 Transformation fixture', 'ACTIVE', true)`,
        [id],
      );
    }
    await adminPool.query(
      `INSERT INTO transformation.revisions (
         revision_id, project_id, source_id, source_version_id, source_content_hash,
         transformer_id, transformer_version, document_ir, source_map, document_hash,
         source_map_hash, access_scope, sensitivity, created_at
       ) VALUES
         ($1, $2, $3, $4, $5, 't3-test', '1', '{"text":"selected source document"}',
          '{"quote":"selected source map"}', $6, $7, ARRAY['owner'], 'private', $8),
         ($9, $10, $11, $12, $13, 't3-test', '1', '{"text":"other source document"}',
          '{"quote":"other source map"}', $14, $15, ARRAY['owner'], 'private', $8)`,
      [
        revisionId,
        projectId,
        randomUUID(),
        sourceVersionId,
        `sha256:${'1'.repeat(64)}`,
        `sha256:${'2'.repeat(64)}`,
        `sha256:${'3'.repeat(64)}`,
        now,
        otherRevisionId,
        otherProjectId,
        randomUUID(),
        otherSourceVersionId,
        `sha256:${'4'.repeat(64)}`,
        `sha256:${'5'.repeat(64)}`,
        `sha256:${'6'.repeat(64)}`,
      ],
    );
    await adminPool.query(
      `INSERT INTO transformation.attempts (
         attempt_id, project_id, source_version_id, transformer_id,
         transformer_version, revision_id, reused_revision, created_at
       ) VALUES
         ($1, $2, $3, 't3-test', '1', $4, false, $5),
         ($6, $7, $8, 't3-test', '1', $9, false, $5)`,
      [
        randomUUID(),
        projectId,
        sourceVersionId,
        revisionId,
        now,
        randomUUID(),
        otherProjectId,
        otherSourceVersionId,
        otherRevisionId,
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

    await expect(
      executorPool.query('SELECT count(*) FROM transformation.revisions'),
    ).rejects.toMatchObject({ code: '42501' });
    const owner = new PostgresTransformationKnowledgeResetOwner(executorPool);
    const context = {
      projectId,
      requestId,
      knowledgeEpoch: 1,
      manifestDigest: `sha256:${'a'.repeat(64)}` as `sha256:${string}`,
    };
    await owner.fence(context);
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

    const counts = await adminPool.query<{
      project_id: string;
      attempts: string;
      revisions: string;
    }>(
      `SELECT project_id,
              (SELECT count(*)::text FROM transformation.attempts WHERE project_id = target.project_id) AS attempts,
              (SELECT count(*)::text FROM transformation.revisions WHERE project_id = target.project_id) AS revisions
       FROM (VALUES ($1::text), ($2::text)) AS target(project_id)
       ORDER BY project_id`,
      [projectId, otherProjectId],
    );
    expect(counts.rows.find((row) => row.project_id === projectId)).toMatchObject({
      attempts: '0',
      revisions: '0',
    });
    expect(counts.rows.find((row) => row.project_id === otherProjectId)).toMatchObject({
      attempts: '1',
      revisions: '1',
    });
  });
});
