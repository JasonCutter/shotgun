import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { PostgresAIProviderCallRepository } from '../../adapters/postgres-stage4/src/index.js';
import {
  startRecoveryApplication,
  startShotgunApplication,
} from '../../assemblies/shotgun-app/src/application.js';
import { getSourcesWriteRuntime } from '../../assemblies/shotgun-app/src/product-api/sources-write-runtime.js';
import { runAIDurableMaterializationRecovery } from '../../assemblies/shotgun-app/src/server.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

/**
 * LPA-WP5 A2 Correction Round 2/3 — recovery harness isolation, assembly
 * focused tests against the isolated test Postgres (`db:test:reset` in CI). They
 * verify the recovery harness is truly "recovery-only":
 *   - C2-1: the Ask background worker is NOT started (no claim/recover/execute
 *     of Product work, no AI provider execution possible).
 *   - C2-4: bounded owner-safe Canonical read works against the restored target.
 *   - C2-5: close() is idempotent (exactly-once) and construction failure
 *     releases resources and preserves the original error.
 *   - R3-1: the AI Durable Materialization Recovery is NOT run in the
 *     recovery harness (only the Canonical Projection Recovery runs), while
 *     the normal path keeps it enabled.
 *   - R3-3: no process-global Sources write runtime registration leaks after
 *     construction failure; same-process reconstruction works.
 * Empty canonical (0 projects) is the valid normal case; no Product fixtures.
 */
const databaseUrl = await requireTestDatabaseTarget();
const hasDb = true;

let assetRoot = '';

beforeAll(async () => {
  if (hasDb) {
    assetRoot = await mkdtemp(path.join(tmpdir(), 'shotgun-recovery-harness-'));
  }
});

afterAll(async () => {
  if (hasDb) {
    await rm(assetRoot, { recursive: true, force: true }).catch(() => {});
  }
});

const seedExpiredRunningAttempt = async (pool: ReturnType<typeof createPostgresPool>) => {
  const callId = randomUUID();
  await pool.query(
    `INSERT INTO ai.provider_calls
      (call_id, project_id, request_id, provider, model, prompt_version, policy_version,
       schema_name, data_classification, input_evidence_ids, status, created_at, durable_state)
     VALUES ($1, $2, $3, 'fake', 'm', 'pv', 'pp', 's', 'private', ARRAY[]::uuid[], 'failed', now(), 'PROVIDER_RUNNING')`,
    [callId, `r3-${callId}`, `req-${callId}`],
  );
  const attemptId = randomUUID();
  await pool.query(
    `INSERT INTO ai.provider_attempts
      (attempt_id, call_id, attempt_number, status, latency_ms, started_at, lease_expires_at)
     VALUES ($1, $2, 1, 'running', 0, now() - interval '1 hour', now() - interval '1 minute')`,
    [attemptId, callId],
  );
  return { callId, attemptId };
};

describe.runIf(hasDb)('LPA-WP5 D12 recovery harness isolation (C2 + R3)', () => {
  it('does not start the Ask background worker and runs a bounded Canonical read', async () => {
    const application = await startRecoveryApplication({
      databaseUrl: databaseUrl as string,
      assetRoot,
    });
    try {
      // C2-1: recovery verification must never start the Ask worker (its
      // immediate tick() would claim/recover/execute Product work and could
      // call an AI provider on the restored target).
      expect(application.askWorkerStarted).toBe(false);
      // The existing STARTUP Canonical Projection Recovery actually ran.
      const report = application.recoveryState.latest();
      expect(report).toBeDefined();
      expect(report?.runStatus).toBe('COMPLETED');
      // C2-4: bounded owner-safe read against the restored target.
      const projectIds = await application.readCanonicalProjectIds();
      expect(Array.isArray(projectIds)).toBe(true);
    } finally {
      await application.close();
    }
  });

  it('closes exactly once (idempotent) on the success path', async () => {
    const application = await startRecoveryApplication({
      databaseUrl: databaseUrl as string,
      assetRoot,
    });
    await application.close();
    await application.close();
  });

  it('preserves the original error when construction fails (no leak/hang)', async () => {
    // Point at the same server but a non-existent database so the pool connect
    // fails fast during kernel start.
    const parsed = new URL(databaseUrl as string);
    parsed.pathname = '/shotgun_c2_does_not_exist';
    await expect(
      startShotgunApplication({
        databaseUrl: parsed.toString(),
        assetRoot,
        recoveryIntervalMs: false,
        noSignals: true,
      }),
    ).rejects.toThrow();
  });

  it('does NOT run AI Durable Materialization Recovery in the recovery harness (R3-1)', async () => {
    const pool = createPostgresPool(databaseUrl as string);
    const { callId, attemptId } = await seedExpiredRunningAttempt(pool);
    try {
      const application = await startRecoveryApplication({
        databaseUrl: databaseUrl as string,
        assetRoot,
      });
      await application.close();
      // The expired running attempt and PROVIDER_RUNNING call must be UNCHANGED
      // — the recovery harness never runs markExpiredRunningAttemptsOutcomeUnknown
      // or resume commands; only the Canonical Projection Recovery runs (R3-2).
      const attempt = await pool.query(
        'SELECT status FROM ai.provider_attempts WHERE attempt_id = $1',
        [attemptId],
      );
      expect(attempt.rows[0].status).toBe('running');
      const call = await pool.query(
        'SELECT durable_state FROM ai.provider_calls WHERE call_id = $1',
        [callId],
      );
      expect(call.rows[0].durable_state).toBe('PROVIDER_RUNNING');
    } finally {
      await pool.query('DELETE FROM ai.provider_calls WHERE call_id = $1', [callId]);
      await pool.end();
    }
  });

  it('keeps the AI Durable Materialization Recovery enabled for the normal path (R3-1 regression)', async () => {
    const pool = createPostgresPool(databaseUrl as string);
    const { callId, attemptId } = await seedExpiredRunningAttempt(pool);
    try {
      const connector = { sendCommand: vi.fn(async () => ({})) };
      // Same primitive createApplication runs when
      // aiDurableMaterializationRecoveryEnabled !== false (the default).
      await runAIDurableMaterializationRecovery(
        new PostgresAIProviderCallRepository(pool),
        connector,
      );
      const attempt = await pool.query(
        'SELECT status FROM ai.provider_attempts WHERE attempt_id = $1',
        [attemptId],
      );
      expect(attempt.rows[0].status).toBe('outcome_unknown');
    } finally {
      await pool.query('DELETE FROM ai.provider_calls WHERE call_id = $1', [callId]);
      await pool.end();
    }
  });

  it('leaves no process-global Sources runtime and allows same-process reconstruction (R3-3)', async () => {
    const parsed = new URL(databaseUrl as string);
    parsed.pathname = '/shotgun_r3_does_not_exist';
    await expect(
      startShotgunApplication({
        databaseUrl: parsed.toString(),
        assetRoot,
        recoveryIntervalMs: false,
        noSignals: true,
      }),
    ).rejects.toThrow();
    // No stale global Sources write runtime registration survives.
    expect(getSourcesWriteRuntime()).toBeUndefined();
    // The same process can immediately construct a recovery application again.
    const application = await startRecoveryApplication({
      databaseUrl: databaseUrl as string,
      assetRoot,
    });
    await application.close();
  });
});
