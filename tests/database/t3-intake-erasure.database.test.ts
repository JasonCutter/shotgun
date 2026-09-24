import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresIntakeKnowledgeResetOwner } from '../../adapters/source-knowledge-reset-postgres/src/intake-owner.js';
import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';

const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;

describe('ADR-171 Intake erasure owner', () => {
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

  it('deletes only the selected Project intake submissions via its security routines', async () => {
    const projectId = `t3-intake-${randomUUID()}`;
    const otherProjectId = `t3-intake-other-${randomUUID()}`;
    const principalId = randomUUID();
    const requestId = randomUUID();
    const now = new Date('2026-09-23T01:00:00.000Z');

    for (const id of [projectId, otherProjectId]) {
      await adminPool.query(
        `INSERT INTO project_admin.projects (id, name, status, active)
         VALUES ($1, 'T3 Intake fixture', 'ACTIVE', true)`,
        [id],
      );
    }
    await adminPool.query(
      `INSERT INTO intake.submissions (
         submission_key, submission_id, project_id, actor_id, requested_source_id,
         channel, material_kind, media_type, original_file_name, content_hash,
         size_bytes, access_scope, sensitivity, created_at
       ) VALUES
         ($1, $2, $3, 'test-owner', NULL, 'file_upload', 'plain_text', 'text/plain',
          'private-source.txt', $4, 7, ARRAY['owner'], 'private', $7),
         ($5, $6, $8, 'other-owner', NULL, 'direct_text', 'plain_text', 'text/plain',
          NULL, $9, 5, ARRAY['owner'], 'private', $7)`,
      [
        randomUUID(),
        `submission-${randomUUID()}`,
        projectId,
        `sha256:${'1'.repeat(64)}`,
        randomUUID(),
        `submission-${randomUUID()}`,
        now,
        otherProjectId,
        `sha256:${'2'.repeat(64)}`,
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
       ) VALUES ($1, $2, $3, $4, 1, 0, 1, $5, $6, $7, $8, 'FENCING', '{}'::jsonb)`,
      [
        requestId,
        randomUUID(),
        projectId,
        principalId,
        `sha256:${'a'.repeat(64)}`,
        `sha256:${'b'.repeat(64)}`,
        `sha256:${'c'.repeat(64)}`,
        randomUUID(),
      ],
    );

    await expect(
      executorPool.query('SELECT count(*) FROM intake.submissions'),
    ).rejects.toMatchObject({ code: '42501' });
    const owner = new PostgresIntakeKnowledgeResetOwner(executorPool);
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

    const rows = await adminPool.query<{ project_id: string; count: string }>(
      `SELECT project_id, count(*)::text AS count
       FROM intake.submissions WHERE project_id = ANY($1::text[])
       GROUP BY project_id ORDER BY project_id`,
      [[projectId, otherProjectId]],
    );
    expect(rows.rows).toEqual([{ project_id: otherProjectId, count: '1' }]);
  });
});
