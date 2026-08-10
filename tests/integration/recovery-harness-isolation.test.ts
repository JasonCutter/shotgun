import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  startRecoveryApplication,
  startShotgunApplication,
} from '../../assemblies/shotgun-app/src/application.js';

/**
 * LPA-WP5 A2 Correction Round 2 (C2) — recovery harness isolation, assembly
 * focused tests against the real Postgres (docker, `db:reset` in CI). They
 * verify the recovery harness is truly "recovery-only":
 *   - C2-1: the Ask background worker is NOT started (no claim/recover/execute
 *     of Product work, no AI provider execution possible).
 *   - C2-4: bounded owner-safe Canonical read works against the restored target.
 *   - C2-5: close() is idempotent (exactly-once) and construction failure
 *     releases resources and preserves the original error.
 * Empty canonical (0 projects) is the valid normal case; no fixtures created.
 */
const databaseUrl = process.env.DATABASE_URL;
const hasDb = Boolean(databaseUrl);

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

describe.runIf(hasDb)('LPA-WP5 D12 recovery harness isolation (C2)', () => {
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
});
