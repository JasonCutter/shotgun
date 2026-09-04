import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Pool } from 'pg';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { PostgresActionExecutionRepository } from '../../adapters/postgres-stage11/src/index.js';
import { PostgresDiscoveryRuntimeRepository } from '../../adapters/discovery-runtime-postgres/src/index.js';
import { authoritativeIntegrityTablesForMigrations } from '../../scripts/backup-restore.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
  ? await requireTestDatabaseTarget()
  : undefined;
const pool: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;
const projectA = `wp10-db-a-${randomUUID()}`;
const projectB = `wp10-db-b-${randomUUID()}`;
const actionA = randomUUID();
const actionB = randomUUID();
const digest = (letter: string): string => `sha256:${letter.repeat(64)}`;

const seedAction = async (projectId: string, actionId: string): Promise<void> => {
  await pool!.query(
    `INSERT INTO action.executions
       (action_id, project_id, candidate_id, candidate_revision,
        candidate_digest, target_digest, parameter_digest, preview_digest,
        status, record_json, created_at, updated_at)
     VALUES ($1, $2, $3, 1, $4, $5, $6, $7, 'FAILED', '{}'::jsonb, now(), now())`,
    [
      actionId,
      projectId,
      `candidate-${actionId}`,
      digest('a'),
      digest('b'),
      digest('c'),
      digest('d'),
    ],
  );
};

describe('WP-10 durable persistence migration contract', () => {
  it('uses additive migration 065 with database idempotency and no JSON dump', () => {
    const migration = readFileSync(
      path.resolve(
        'db/migrations/065_runtime_data_integrity_wp10_action_review_discovery_diagnostics.sql',
      ),
      'utf8',
    );
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS action.action_review_work_items');
    expect(migration).toContain('UNIQUE (project_id, semantic_key)');
    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS discovery.semantic_essence_diagnostics',
    );
    expect(migration).toContain(
      'UNIQUE (project_id, run_id, attempt_id, finding_identity, reason_code)',
    );
    expect(migration).not.toContain('jsonb');
    expect(migration).not.toMatch(/prompt|provider_output|stack_trace|source_text/iu);
  });

  it('classifies both WP-10 tables as authoritative backup state', () => {
    const tables = authoritativeIntegrityTablesForMigrations([
      '062_runtime_data_integrity_wp04_source_evidence_continuation.sql',
      '063_runtime_data_integrity_wp04_recovery_invariants.sql',
      '064_runtime_data_integrity_wp05_connector_runtime.sql',
      '065_runtime_data_integrity_wp10_action_review_discovery_diagnostics.sql',
    ]);
    expect(tables).toContain('action.action_review_work_items');
    expect(tables).toContain('discovery.semantic_essence_diagnostics');
  });
});

describe.runIf(databaseUrl)('WP-10 PostgreSQL exact-once and isolation acceptance', () => {
  beforeAll(async () => {
    await migrateUpTo(undefined, databaseUrl!);
    await seedAction(projectA, actionA);
    await seedAction(projectB, actionB);
  });

  beforeEach(async () => {
    await pool!.query('DELETE FROM action.action_review_work_items WHERE project_id IN ($1, $2)', [
      projectA,
      projectB,
    ]);
    await pool!.query(
      'DELETE FROM discovery.semantic_essence_diagnostics WHERE project_id IN ($1, $2)',
      [projectA, projectB],
    );
  });

  afterAll(async () => {
    await pool!.query('DELETE FROM action.action_review_work_items WHERE project_id IN ($1, $2)', [
      projectA,
      projectB,
    ]);
    await pool!.query('DELETE FROM action.executions WHERE project_id IN ($1, $2)', [
      projectA,
      projectB,
    ]);
    await pool!.end();
  });

  it('persists one review item under concurrent duplicate delivery and rejects cross-project binding', async () => {
    const repository = new PostgresActionExecutionRepository(pool!);
    const input = {
      projectId: projectA,
      semanticKey: `action-feedback:${actionA}:FAILED`,
      actionId: actionA,
      outcome: 'FAILED' as const,
      phase: 'ACTION_REVIEW' as const,
      evidenceRef: `action-audit:${actionA}:FAILED`,
      feedbackOccurredAt: '2026-09-04T00:00:00.000Z',
      now: '2026-09-04T00:00:00.000Z',
    };
    const [first, second] = await Promise.all([
      repository.upsertFromFeedback(input),
      repository.upsertFromFeedback(input),
    ]);
    expect(first.workItemId).toBe(second.workItemId);
    expect(
      (await repository.listByAction({ projectId: projectA, actionId: actionA, limit: 100 }))
        .length,
    ).toBe(1);

    await expect(
      repository.upsertFromFeedback({ ...input, projectId: projectA, actionId: actionB }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const rows = await pool!.query<{ readonly count: number }>(
      'SELECT count(*)::int AS count FROM action.action_review_work_items WHERE semantic_key = $1',
      [input.semanticKey],
    );
    expect(rows.rows).toEqual([{ count: 1 }]);
  });

  it('stores digest-only diagnostics and aggregates retries by attempt denominator', async () => {
    const repository = new PostgresDiscoveryRuntimeRepository(pool!);
    const diagnostic = {
      projectId: projectA,
      jobId: 'job-wp10',
      runId: 'run-wp10',
      attemptId: 'attempt-1',
      findingIdentity: digest('e') as `sha256:${string}`,
      attemptNumber: 1,
      occurredAt: '2026-09-04T00:00:00.000Z',
      excludedCount: 2,
      candidateCount: 4,
    };
    const retry = {
      ...diagnostic,
      attemptId: 'attempt-2',
      attemptNumber: 2,
      findingIdentity: digest('f') as `sha256:${string}`,
      excludedCount: 1,
      candidateCount: 3,
    };
    expect(
      await Promise.all([
        repository.recordSemanticEssenceDiagnostic(diagnostic),
        repository.recordSemanticEssenceDiagnostic(diagnostic),
      ]),
    ).toEqual(expect.arrayContaining(['CREATED', 'ALREADY_EXISTS']));
    expect(await repository.recordSemanticEssenceDiagnostic(retry)).toBe('CREATED');
    const aggregate = await repository.getSemanticEssenceDiagnosticAggregate({
      projectId: projectA,
      jobId: diagnostic.jobId,
      runId: diagnostic.runId,
    });
    expect(aggregate).toMatchObject({
      diagnosticCount: 2,
      excludedCount: 3,
      candidateCount: 7,
      completion: 'PARTIAL',
    });
    const rows = await pool!.query<{ readonly raw: string }>(
      `SELECT concat_ws('|', project_id, job_id, run_id, attempt_id, finding_identity,
                       stage, reason_code, completion, excluded_count::text,
                       coalesce(candidate_count::text, '')) AS raw
       FROM discovery.semantic_essence_diagnostics
       WHERE project_id = $1 AND run_id = $2`,
      [projectA, diagnostic.runId],
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.map((row) => row.raw).join('\n')).not.toContain('HOSTILE_SENTINEL');
    expect(rows.rows.map((row) => row.raw).join('\n')).not.toMatch(
      /prompt|source_text|stack_trace/iu,
    );
  });
});
