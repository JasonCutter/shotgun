import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresProjectAuditKnowledgeResetOwner } from '../../adapters/source-knowledge-reset-postgres/src/index.js';
import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';

const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const hash = (character: string): string => `sha256:${character.repeat(64)}`;

describe('ADR-171 Project audit retention guard owner', () => {
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
       VALUES ($1, 'T3 audit fixture', 'ACTIVE', true)`,
      [projectId],
    );
  };

  const createReset = async (projectId: string) => {
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
       ) VALUES ($1, $2, $3, 't3-audit-test', 1, 0, 1, $4, $5, $6, $7,
                 'FENCING', '{}'::jsonb)`,
      [requestId, randomUUID(), projectId, hash('a'), hash('b'), hash('c'), randomUUID()],
    );
    return {
      projectId,
      requestId,
      knowledgeEpoch: 1,
      manifestDigest: hash('a') as `sha256:${string}`,
    };
  };

  it('allows an empty audit scope and blocks tombstones without exposing their reason', async () => {
    const cleanProjectId = `t3-audit-clean-${randomUUID()}`;
    const blockedProjectId = `t3-audit-blocked-${randomUUID()}`;
    const reasonCanary = `private-tombstone-reason-${randomUUID()}`;
    await createProject(cleanProjectId);
    await createProject(blockedProjectId);
    await adminPool.query(
      `INSERT INTO project_audit.project_tombstones (
         project_id, deleted_at, deleted_by, reason, retention_class, lineage_digest
       ) VALUES ($1, now(), 't3-test', $2, 'retained', $3)`,
      [blockedProjectId, reasonCanary, hash('d')],
    );
    await adminPool.query(
      `INSERT INTO project_audit.deleted_project_audit_scopes (
         scope_id, project_id, granted_principal_ids, granted_at, granted_by, revoked_at
       ) VALUES ($1, $2, '[]'::jsonb, now(), 't3-test', NULL)`,
      [`scope-${randomUUID()}`, blockedProjectId],
    );
    const cleanContext = await createReset(cleanProjectId);
    const blockedContext = await createReset(blockedProjectId);

    const owner = new PostgresProjectAuditKnowledgeResetOwner(executorPool);
    await owner.fence(cleanContext);
    await owner.purge(cleanContext);
    await expect(owner.verify(cleanContext)).resolves.toEqual({ verified: true, blockerCodes: [] });
    const fenceError = await owner.fence(blockedContext).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(fenceError).toMatchObject({ blockerCode: 'UNCLASSIFIED_CONTENT' });
    expect(String(fenceError)).not.toContain(reasonCanary);
    await expect(owner.purge(blockedContext)).rejects.toMatchObject({
      blockerCode: 'UNCLASSIFIED_CONTENT',
    });
    await expect(
      adminPool.query(
        'SELECT count(*)::text FROM project_audit.project_tombstones WHERE project_id = $1',
        [blockedProjectId],
      ),
    ).resolves.toMatchObject({ rows: [{ count: '1' }] });
  });
});
