import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresKnowledgeResetExecutorPersistence } from '../../adapters/source-knowledge-reset-postgres/src/execution-persistence.js';
import { PostgresKnowledgeResetMaintenanceBoundary } from '../../adapters/source-knowledge-reset-postgres/src/maintenance-boundary.js';
import { KNOWLEDGE_RESET_OWNER_ORDER } from '../../modules/source-knowledge-reset/src/execution.js';
import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';

const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const PHASES = ['fence', 'purge', 'rebuild', 'verify'] as const;

describe('ADR-171 dedicated executor control-plane persistence', () => {
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

  it('restricts execution state to reviewed routines and requires every owner checkpoint', async () => {
    const projectId = `t3-executor-${randomUUID()}`;
    const requestId = randomUUID();
    const now = new Date('2026-09-23T01:00:00.000Z');
    const manifestDigest = `sha256:${'a'.repeat(64)}`;
    await adminPool.query(
      `INSERT INTO project_admin.projects (id, name, status, active)
       VALUES ($1, 'T3 executor fixture', 'ACTIVE', true)`,
      [projectId],
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
         state, impact_counts, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, 1, 0, 1, $5, $6, $7, $8, 'APPROVED', $9::jsonb, $10, $10)`,
      [
        requestId,
        randomUUID(),
        projectId,
        randomUUID(),
        manifestDigest,
        `sha256:${'b'.repeat(64)}`,
        `sha256:${'c'.repeat(64)}`,
        randomUUID(),
        JSON.stringify({
          sourceCount: 0,
          sourceVersionCount: 0,
          sourceDerivedRecordCount: 0,
          redactedHistoryRecordCount: 0,
          rebuildProjectionCount: 0,
          sharedAssetCount: 0,
          blockedRecordCount: 0,
        }),
        now,
      ],
    );

    await expect(
      adminPool.query('SELECT project_admin.t3_read_reset_execution_snapshot($1, $2::uuid)', [
        projectId,
        requestId,
      ]),
    ).rejects.toMatchObject({ constraint: 't3_erasure_executor_required' });
    await expect(
      executorPool.query('SELECT * FROM project_admin.project_knowledge_reset_requests'),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      new PostgresKnowledgeResetMaintenanceBoundary(executorPool).assertDedicatedExecutor(),
    ).resolves.toBeUndefined();

    const persistence = new PostgresKnowledgeResetExecutorPersistence(executorPool);
    const identity = { projectId, requestId };
    const initial = await persistence.readForExecution(identity);
    expect(initial?.request).toMatchObject({
      state: 'APPROVED',
      manifestDigest,
      preservedConfigurationDigest: `sha256:${'c'.repeat(64)}`,
    });
    await persistence.setExecutionState({ ...identity, state: 'FENCING', blockerCodes: [] });
    await persistence.markExecutionStepComplete({
      ...identity,
      step: 'manifest:approved-impact',
    });
    await persistence.markExecutionStepComplete({ ...identity, step: 'fence:source-product' });
    await expect(
      persistence.markExecutionStepComplete({ ...identity, step: 'fence:unknown-owner' }),
    ).rejects.toMatchObject({ constraint: 't3_reset_checkpoint_invalid' });
    await expect(persistence.markExecutionComplete(identity)).rejects.toMatchObject({
      constraint: 't3_reset_verification_incomplete',
    });

    for (const phase of PHASES) {
      if (phase !== 'fence') {
        await persistence.setExecutionState({
          ...identity,
          state: phase === 'purge' ? 'PURGING' : phase === 'rebuild' ? 'REBUILDING' : 'VERIFYING',
          blockerCodes: [],
        });
      }
      for (const ownerId of KNOWLEDGE_RESET_OWNER_ORDER) {
        await persistence.markExecutionStepComplete({ ...identity, step: `${phase}:${ownerId}` });
      }
    }

    const completed = await persistence.markExecutionComplete(identity);
    expect(completed).toMatchObject({
      projectId,
      requestId,
      state: 'COMPLETE',
      knowledgeEpoch: 1,
      completedSteps: expect.arrayContaining(['manifest:approved-impact', 'verify:settings']),
    });
    await expect(persistence.markExecutionComplete(identity)).resolves.toMatchObject({
      requestId,
      state: 'COMPLETE',
    });
    const epoch = await adminPool.query<{ state: string; epoch: string }>(
      `SELECT state, epoch::text FROM project_admin.project_knowledge_epoch WHERE project_id = $1`,
      [projectId],
    );
    expect(epoch.rows[0]).toEqual({ state: 'READY', epoch: '1' });
  });
});
