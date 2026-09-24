import { randomUUID } from 'node:crypto';

import { Client, Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresKnowledgeResetMaintenanceBoundary } from '../../adapters/source-knowledge-reset-postgres/src/maintenance-boundary.js';
import {
  acquireMaintenanceLock,
  releaseMaintenanceLock,
} from '../../adapters/postgres-maintenance-lock/src/index.js';
import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';
import { assertNoUnresolvedProjectKnowledgeReset } from '../../assemblies/shotgun-app/src/runtime-knowledge-reset-readiness.js';

describe('ADR-171 maintenance database boundary', () => {
  let database: Awaited<ReturnType<typeof createIsolatedPostgresTestDatabase>>;
  let adminPool: Pool;
  let executorPool: Pool | undefined;
  let executorRole: string;

  beforeAll(async () => {
    database = await createIsolatedPostgresTestDatabase();
    adminPool = database.createPool();
    executorRole = `t3_executor_test_${randomUUID().replaceAll('-', '')}`;
    const password = randomUUID();
    await adminPool.query(
      `CREATE ROLE ${executorRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD ${literal(password)}`,
    );
    const connection = new URL(database.databaseUrl);
    connection.username = executorRole;
    connection.password = password;
    executorPool = new Pool({ connectionString: connection.toString() });
  });

  afterAll(async () => {
    await executorPool?.end();
    await adminPool.query(`DROP ROLE IF EXISTS ${executorRole}`);
    await database.dispose();
  });

  it('requires a dedicated non-superuser and fails when runtime still holds the shared lock', async () => {
    if (!executorPool) throw new Error('Executor test pool was not initialized.');
    const boundary = new PostgresKnowledgeResetMaintenanceBoundary(executorPool, executorRole);
    await expect(boundary.assertDedicatedExecutor()).resolves.toBeUndefined();

    await expect(
      new PostgresKnowledgeResetMaintenanceBoundary(
        adminPool,
        executorRole,
      ).assertDedicatedExecutor(),
    ).rejects.toMatchObject({ blockerCode: 'ERASURE_EXECUTOR_UNAVAILABLE' });

    let runtimeClient: PoolClient | undefined;
    try {
      runtimeClient = await adminPool.connect();
      await acquireMaintenanceLock(runtimeClient, 'shared');
      await expect(
        boundary.withExclusiveMaintenanceLock(async () => 'unsafe'),
      ).rejects.toMatchObject({
        blockerCode: 'RESET_IN_PROGRESS',
      });
    } finally {
      if (runtimeClient) {
        await releaseMaintenanceLock(runtimeClient, 'shared');
        runtimeClient.release();
      }
    }

    await expect(boundary.withExclusiveMaintenanceLock(async () => 'locked')).resolves.toBe(
      'locked',
    );
  });

  it('keeps product runtime stopped until an interrupted reset returns to READY', async () => {
    const projectId = `t3-runtime-readiness-${randomUUID()}`;
    const client = new Client({ connectionString: database.databaseUrl });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO project_admin.projects (id, name, status, active)
         VALUES ($1, 'T3 runtime readiness', 'ACTIVE', true)`,
        [projectId],
      );
      await client.query(
        `INSERT INTO project_admin.project_knowledge_epoch (project_id, epoch, state)
         VALUES ($1, 1, 'RESET_UNVERIFIED')`,
        [projectId],
      );
      await expect(assertNoUnresolvedProjectKnowledgeReset(client)).rejects.toThrow(
        /maintenance recovery/u,
      );
      await client.query(
        `UPDATE project_admin.project_knowledge_epoch SET state = 'READY' WHERE project_id = $1`,
        [projectId],
      );
      await expect(assertNoUnresolvedProjectKnowledgeReset(client)).resolves.toBeUndefined();
    } finally {
      await client.end();
    }
  });
});

const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;
