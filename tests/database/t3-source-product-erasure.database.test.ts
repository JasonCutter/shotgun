import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresKnowledgeResetMaintenanceBoundary } from '../../adapters/source-knowledge-reset-postgres/src/maintenance-boundary.js';
import { PostgresSourceProductKnowledgeResetOwner } from '../../adapters/source-knowledge-reset-postgres/src/source-product-owner.js';
import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';

const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;

describe('ADR-171 Source Product erasure owner', () => {
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

  it('purges its intake lineage through its security routine and proves empty readback', async () => {
    const projectId = `t3-source-product-${randomUUID()}`;
    const principalId = randomUUID();
    const sessionId = randomUUID();
    const commandId = `t3-command-${randomUUID()}`;
    const submissionId = randomUUID();
    const itemId = randomUUID();
    const requestId = randomUUID();
    const now = new Date('2026-09-23T01:00:00.000Z');

    await adminPool.query(
      `INSERT INTO project_admin.projects (id, name, status, active)
       VALUES ($1, 'T3 Source Product fixture', 'ACTIVE', true)`,
      [projectId],
    );
    await adminPool.query(
      `INSERT INTO auth.principals (principal_id, actor_type, status, created_at)
       VALUES ($1, 'user', 'active', $2)`,
      [principalId, now],
    );
    await adminPool.query(
      `INSERT INTO auth.sessions (
         session_id, token_hash, csrf_hash, principal_id, active_project_id,
         expires_at, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        sessionId,
        `sha256:${'1'.repeat(64)}`,
        `sha256:${'2'.repeat(64)}`,
        principalId,
        projectId,
        new Date(now.getTime() + 86_400_000),
        now,
      ],
    );
    await adminPool.query(
      `INSERT INTO frontend_command.command_ledger (
         command_id, command_revision, client_request_id, idempotency_key, principal_id,
         target_project_id, command_type, command_schema_version, command_semantic_digest,
         policy_binding, accepted_principal_context, accepted_project_context,
         accepted_policy_context, preconditions, command_payload, outcome_state,
         correlation_id, trace_id, received_at, last_updated_at
       ) VALUES (
         $1, 1, $2, $3, $4, $5, 'SOURCE_SUBMIT', '1.0.0', $6,
         '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
         '{"text":"source command payload"}'::jsonb, 'ACCEPTED', $7, $8, $9, $9
       )`,
      [
        commandId,
        `request-${randomUUID()}`,
        randomUUID(),
        principalId,
        projectId,
        `sha256:${'3'.repeat(64)}`,
        `correlation-${randomUUID()}`,
        `trace-${randomUUID()}`,
        now,
      ],
    );
    await adminPool.query(
      `INSERT INTO source_product.intake_submissions (
         submission_id, project_id, principal_id, session_id, create_command_id,
         state, accepted_policy_context_id, accepted_policy_binding, access_revision,
         policy_context_revision, created_at, updated_at, completed_at
       ) VALUES ($1, $2, $3, $4, $5, 'FAILED', 'policy-1', '{}'::jsonb,
                 'access-1', 'policy-revision-1', $6, $6, $6)`,
      [submissionId, projectId, principalId, sessionId, commandId, now],
    );
    await adminPool.query(
      `INSERT INTO source_product.intake_submission_items (
         submission_item_id, project_id, submission_id, client_item_id, ordinal,
         input_kind, label, input_manifest, state, created_at, updated_at, completed_at
       ) VALUES ($1, $2, $3, 'item-1', 0, 'DIRECT_TEXT', 'Source label',
                 '{"text":"private source text"}'::jsonb, 'FAILED', $4, $4, $4)`,
      [itemId, projectId, submissionId, now],
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

    const boundary = new PostgresKnowledgeResetMaintenanceBoundary(executorPool);
    await expect(boundary.assertDedicatedExecutor()).resolves.toBeUndefined();
    await expect(
      executorPool.query('SELECT count(*) FROM source_product.intake_submissions'),
    ).rejects.toMatchObject({ code: '42501' });

    const owner = new PostgresSourceProductKnowledgeResetOwner(executorPool);
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
      submission_count: string;
      item_count: string;
      command_count: string;
      project_count: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM source_product.intake_submissions WHERE project_id = $1) AS submission_count,
         (SELECT count(*)::text FROM source_product.intake_submission_items WHERE project_id = $1) AS item_count,
         (SELECT count(*)::text FROM frontend_command.command_ledger WHERE command_id = $2) AS command_count,
         (SELECT count(*)::text FROM project_admin.projects WHERE id = $1) AS project_count`,
      [projectId, commandId],
    );
    expect(counts.rows[0]).toEqual({
      submission_count: '0',
      item_count: '0',
      command_count: '1',
      project_count: '1',
    });
  });
});
