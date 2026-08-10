import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  BackupOwnerFailure,
  collisionSafeName,
  defaultBackupRoot,
  listBackups,
  runOwnerCreate,
  runOwnerRestoreSafe,
  selectLatestBackup,
  type BackupManifest,
  type OwnerDeps,
} from '../../scripts/backup-owner-core.js';

/**
 * LPA-WP5 A2 focused tests (Frozen IR §5, GPT 19) — owner workflow delta only.
 * Existing Stage 12.1 core is NOT re-verified here. Deterministic DI fakes
 * cover: default/--root/--output, collision-safe naming, create→auto-verify,
 * discovery (ordering/metadata/--verify/corrupt surfaced), --latest fail-closed,
 * guided restore-safe (verify-before-prep, explicit/auto target, cleanup
 * ownership, no cutover), and the Frozen 13-kind failure taxonomy.
 */

const HOME = path.join('fake', 'home');
const BACKUP_ROOT = path.join(HOME, 'Shotgun Backups');

const makeManifest = (backupId = 'b1', createdAt = '2026-08-11T00:00:00.000Z'): BackupManifest => ({
  formatVersion: 'shotgun-backup-v1',
  backupId,
  createdAt,
  database: {
    engine: 'postgresql',
    majorVersion: 16,
    dumpFormat: 'custom',
    dumpFile: 'database.dump',
    dumpSha256: 'sha256:dump',
    migrations: [],
  },
  assets: { storage: 'local-content-addressed', files: [] },
  contracts: { files: [] },
  integrity: { tables: {} },
  configuration: { secretsIncluded: false, projectionAuthority: 'rebuild-from-canonical' },
});

const failure = async (promise: Promise<unknown>): Promise<BackupOwnerFailure> => {
  const caught = await promise.catch((value: unknown) => value);
  if (!(caught instanceof BackupOwnerFailure)) {
    throw new Error(`expected BackupOwnerFailure, got ${String(caught)}`);
  }
  return caught;
};

const makeDeps = (
  overrides: Partial<OwnerDeps> = {},
): {
  deps: OwnerDeps;
  calls: string[];
  manifestByDir: Map<string, BackupManifest>;
} => {
  const calls: string[] = [];
  const manifestByDir = new Map<string, BackupManifest>();
  const base: OwnerDeps = {
    homedir: () => HOME,
    now: () => new Date('2026-08-11T00:43:00.123Z'),
    randomSuffix: () => 'a1b2c3',
    createBackup: async ({ outputDirectory }) => {
      calls.push(`create:${outputDirectory}`);
      const manifest = makeManifest();
      manifestByDir.set(outputDirectory, manifest);
      return manifest;
    },
    verifyBackup: async (directory) => {
      calls.push(`verify:${directory}`);
      const manifest = manifestByDir.get(directory);
      if (!manifest) throw new Error('Backup Asset failed verification: missing');
      return manifest;
    },
    restoreBackup: async ({ targetDatabaseUrl, targetAssetRoot, backupDirectory }) => {
      calls.push(`restore:${targetDatabaseUrl}:${targetAssetRoot}:${backupDirectory}`);
      const manifest = manifestByDir.get(backupDirectory) ?? makeManifest();
      return manifest;
    },
    createIsolatedRestoreDatabase: async () => {
      calls.push('isolated');
      return {
        databaseName: 'shotgun_restore_00000000_abcdef12',
        databaseUrl: 'postgres://u:p@host:5432/shotgun_restore_00000000_abcdef12',
      };
    },
    dropIsolatedRestoreDatabase: async (_source, name) => {
      calls.push(`drop:${name}`);
    },
    readManifest: async (directory) => {
      calls.push(`read:${directory}`);
      const manifest = manifestByDir.get(directory);
      if (!manifest) throw new Error('no such backup');
      return manifest;
    },
    readdir: async (directory) => {
      calls.push(`readdir:${directory}`);
      return Array.from(manifestByDir.keys())
        .filter((dir) => dir.startsWith(`${directory}${path.sep}`))
        .map((dir) => dir.slice(directory.length + path.sep.length));
    },
    directorySize: async (directory) => {
      calls.push(`size:${directory}`);
      return 1234;
    },
    remove: async (directory) => {
      calls.push(`remove:${directory}`);
    },
    queryRows: async (_url, sql) => {
      calls.push(`query:${sql.slice(0, 40)}`);
      if (sql.includes('projection.')) return [{ count: '0' }];
      return [{ count: '1' }];
    },
  };
  return { deps: { ...base, ...overrides }, calls, manifestByDir };
};

const createEnv = () => ({
  databaseUrl: 'postgres://u:p@host:5432/shotgun',
  assetRoot: path.join('fake', 'data', 'assets'),
  toolMode: 'docker-compose' as const,
});

const seedBackup = (
  state: ReturnType<typeof makeDeps>,
  name: string,
  backupId = name,
  createdAt = '2026-08-11T00:00:00.000Z',
): string => {
  const directory = path.join(BACKUP_ROOT, name);
  state.manifestByDir.set(directory, makeManifest(backupId, createdAt));
  return directory;
};

describe('LPA-WP5 A2 — owner backup', () => {
  it('uses <USER_HOME>/Shotgun Backups/<collision-safe-name> when no args are given', async () => {
    const { deps } = makeDeps();
    const result = await runOwnerCreate({}, createEnv(), deps);
    expect(result.directory).toBe(path.join(BACKUP_ROOT, '20260811T004300123Z-a1b2c3'));
    expect(collisionSafeName(deps)).toMatch(/^[0-9]{8}T[0-9]{9}Z-[0-9a-f]{6}$/);
    expect(defaultBackupRoot(deps)).toBe(BACKUP_ROOT);
  });

  it('supports --root and legacy --output destinations', async () => {
    const { deps } = makeDeps();
    const rooted = await runOwnerCreate(
      { root: path.join('E:', 'External Backups') },
      createEnv(),
      deps,
    );
    expect(rooted.directory).toBe(
      path.join('E:', 'External Backups', '20260811T004300123Z-a1b2c3'),
    );
    const legacy = await runOwnerCreate(
      { output: path.join('C:', 'specific', 'backup-directory') },
      createEnv(),
      deps,
    );
    expect(legacy.directory).toBe(path.join('C:', 'specific', 'backup-directory'));
  });

  it('runs create → verify ordering and returns summary data', async () => {
    const { deps, calls } = makeDeps();
    const result = await runOwnerCreate({}, createEnv(), deps);
    const createIndex = calls.findIndex((call) => call.startsWith('create:'));
    const verifyIndex = calls.findIndex((call) => call.startsWith('verify:'));
    expect(createIndex).toBeGreaterThanOrEqual(0);
    expect(verifyIndex).toBeGreaterThan(createIndex);
    expect(calls.some((call) => call.startsWith('size:'))).toBe(true);
    expect(result.sizeBytes).toBe(1234);
    expect(result.manifest.backupId).toBeTruthy();
  });

  it('fails when auto verification fails (BACKUP_INTEGRITY_INVALID)', async () => {
    const { deps } = makeDeps({
      verifyBackup: async () => {
        throw new Error('Database dump digest does not match the Backup Manifest.');
      },
    });
    const caught = await failure(runOwnerCreate({}, createEnv(), deps));
    expect(caught.code).toBe('BACKUP_INTEGRITY_INVALID');
    expect(caught.check.length).toBeGreaterThan(0);
    expect(caught.action.length).toBeGreaterThan(0);
  });

  it('maps storage write failure to BACKUP_STORAGE_UNAVAILABLE (no fallback)', async () => {
    const { deps } = makeDeps({
      createBackup: async () => {
        const error = new Error('write failed') as NodeJS.ErrnoException;
        error.code = 'ENOSPC';
        throw error;
      },
    });
    const caught = await failure(runOwnerCreate({}, createEnv(), deps));
    expect(caught.code).toBe('BACKUP_STORAGE_UNAVAILABLE');
  });

  it('maps concurrent-write consistency change to BACKUP_CONSISTENCY_CHANGED', async () => {
    const { deps } = makeDeps({
      createBackup: async () => {
        throw new Error('Authoritative data changed while the backup was being created.');
      },
    });
    const caught = await failure(runOwnerCreate({}, createEnv(), deps));
    expect(caught.code).toBe('BACKUP_CONSISTENCY_CHANGED');
    expect(caught.action).toContain('Retry');
  });
});

describe('LPA-WP5 A2 — backup discovery', () => {
  it('lists newest-first with metadata and root totals', async () => {
    const seeded = makeDeps();
    seedBackup(seeded, '20260810T000000000Z-old', 'old', '2026-08-10T00:00:00.000Z');
    seedBackup(seeded, '20260811T000000000Z-new', 'new', '2026-08-11T00:00:00.000Z');
    const result = await listBackups({}, seeded.deps);
    expect(result.totalBackups).toBe(2);
    expect(result.totalSizeBytes).toBe(2468);
    expect(result.entries[0]?.name).toContain('new');
    expect(result.entries[1]?.name).toContain('old');
    expect(result.entries[0]?.manifest?.backupId).toBe('new');
  });

  it('surfaces corrupt/unreadable candidates instead of hiding them', async () => {
    const seeded = makeDeps({
      readManifest: async (directory) => {
        if (directory.endsWith('bad')) throw new Error('Unsupported Backup format: x');
        return makeManifest('ok');
      },
    });
    seedBackup(seeded, 'bad');
    seedBackup(seeded, 'ok', 'ok');
    const result = await listBackups({}, seeded.deps);
    // newest first: 'ok' sorts after 'bad' → first entry is ok, corrupt one surfaced after.
    expect(result.entries[0]?.status).toBe('ok');
    expect(result.entries[1]?.status).toBe('error');
    expect(result.entries[1]?.error).toContain('Unsupported Backup format');
  });

  it('--verify marks entries verified', async () => {
    const seeded = makeDeps();
    seedBackup(seeded, '20260811T000000000Z-a', 'a');
    const result = await listBackups({ verify: true }, seeded.deps);
    expect(result.entries[0]?.verified).toBe(true);
    expect(seeded.calls.some((call) => call.startsWith('verify:'))).toBe(true);
  });

  it('--latest fails closed when the newest candidate is corrupt (no silent fallback)', async () => {
    const seeded = makeDeps({
      readManifest: async (directory) => {
        if (directory.endsWith('bad-new')) throw new Error('malformed manifest');
        return makeManifest('ok');
      },
    });
    seedBackup(seeded, '20260811T000000000Z-bad-new', 'bad');
    seedBackup(seeded, '20260810T000000000Z-ok-old', 'ok');
    const caught = await failure(selectLatestBackup({}, seeded.deps));
    expect(caught.code).toBe('BACKUP_INTEGRITY_INVALID');
  });

  it('--latest reports BACKUP_NOT_FOUND when no backups exist', async () => {
    const { deps } = makeDeps();
    const caught = await failure(selectLatestBackup({}, deps));
    expect(caught.code).toBe('BACKUP_NOT_FOUND');
  });
});

describe('LPA-WP5 A2 — guided restore-safe', () => {
  it('verifies the backup BEFORE preparing any target', async () => {
    const seeded = makeDeps({
      verifyBackup: async () => {
        throw new Error('Database dump digest does not match the Backup Manifest.');
      },
    });
    seedBackup(seeded, '20260811T000000000Z-a', 'bk');
    const caught = await failure(
      runOwnerRestoreSafe(
        { latest: true },
        { sourceDatabaseUrl: 'postgres://u:p@h:5432/source', toolMode: 'docker-compose' },
        seeded.deps,
      ),
    );
    expect(caught.code).toBe('BACKUP_INTEGRITY_INVALID');
    expect(seeded.calls.some((call) => call.startsWith('isolated'))).toBe(false);
    expect(seeded.calls.some((call) => call.startsWith('restore:'))).toBe(false);
  });

  it('rejects a partial explicit restore target (RESTORE_TARGET_UNSAFE)', async () => {
    const seeded = makeDeps();
    seedBackup(seeded, '20260811T000000000Z-a', 'bk');
    const caught = await failure(
      runOwnerRestoreSafe(
        { latest: true },
        {
          sourceDatabaseUrl: 'postgres://u:p@h:5432/s',
          toolMode: 'docker-compose',
          explicitTargetDatabaseUrl: 'postgres://u:p@h:5432/t',
        },
        seeded.deps,
      ),
    );
    expect(caught.code).toBe('RESTORE_TARGET_UNSAFE');
  });

  it('uses an auto isolated target and keeps it on success (no cleanup, no cutover)', async () => {
    const seeded = makeDeps();
    seedBackup(seeded, '20260811T000000000Z-a', 'bk');
    const result = await runOwnerRestoreSafe(
      { latest: true },
      { sourceDatabaseUrl: 'postgres://u:p@h:5432/source', toolMode: 'docker-compose' },
      seeded.deps,
    );
    expect(result.target.autoCreated).toBe(true);
    expect(result.target.databaseName).toBe('shotgun_restore_00000000_abcdef12');
    expect(result.target.assetRoot).toContain('Shotgun Restores');
    expect(seeded.calls.some((call) => call.startsWith('restore:'))).toBe(true);
    // success target retained + no source mutation (no cutover)
    expect(seeded.calls.some((call) => call.startsWith('drop:'))).toBe(false);
    expect(seeded.calls.some((call) => call.startsWith('remove:'))).toBe(false);
  });

  it('cleans up only auto-created targets on failure', async () => {
    const seeded = makeDeps({
      restoreBackup: async () => {
        throw new Error('Restored authoritative data does not match the Backup Manifest.');
      },
    });
    seedBackup(seeded, '20260811T000000000Z-a', 'bk');
    const caught = await failure(
      runOwnerRestoreSafe(
        { latest: true },
        { sourceDatabaseUrl: 'postgres://u:p@h:5432/source', toolMode: 'docker-compose' },
        seeded.deps,
      ),
    );
    expect(caught.code).toBe('RESTORE_VERIFICATION_FAILED');
    expect(seeded.calls.some((call) => call.startsWith('drop:'))).toBe(true);
    expect(seeded.calls.some((call) => call.startsWith('remove:'))).toBe(true);
  });

  it('never deletes an owner-supplied target on failure', async () => {
    const seeded = makeDeps({
      restoreBackup: async () => {
        throw new Error('pg_restore failed with exit code 1. boom');
      },
    });
    seedBackup(seeded, '20260811T000000000Z-a', 'bk');
    const caught = await failure(
      runOwnerRestoreSafe(
        { latest: true },
        {
          sourceDatabaseUrl: 'postgres://u:p@h:5432/source',
          toolMode: 'docker-compose',
          explicitTargetDatabaseUrl: 'postgres://u:p@h:5432/owner-target',
          explicitTargetAssetRoot: path.join('owner', 'assets'),
        },
        seeded.deps,
      ),
    );
    expect(caught.code).toBe('RESTORE_FAILED');
    expect(seeded.calls.some((call) => call.startsWith('drop:'))).toBe(false);
    expect(seeded.calls.some((call) => call.startsWith('remove:'))).toBe(false);
  });

  it('maps source=target protection to RESTORE_TARGET_UNSAFE', async () => {
    const seeded = makeDeps({
      restoreBackup: async () => {
        throw new Error('Restore target must not be the source Database.');
      },
    });
    seedBackup(seeded, '20260811T000000000Z-a', 'bk');
    const caught = await failure(
      runOwnerRestoreSafe(
        { latest: true },
        { sourceDatabaseUrl: 'postgres://u:p@h:5432/source', toolMode: 'docker-compose' },
        seeded.deps,
      ),
    );
    expect(caught.code).toBe('RESTORE_TARGET_UNSAFE');
  });

  it('maps isolated target preparation failure', async () => {
    const seeded = makeDeps({
      createIsolatedRestoreDatabase: async () => {
        throw new Error('permission denied');
      },
    });
    seedBackup(seeded, '20260811T000000000Z-a', 'bk');
    const caught = await failure(
      runOwnerRestoreSafe(
        { latest: true },
        { sourceDatabaseUrl: 'postgres://u:p@h:5432/source', toolMode: 'docker-compose' },
        seeded.deps,
      ),
    );
    expect(caught.code).toBe('RESTORE_TARGET_PREPARATION_FAILED');
  });
});

describe('LPA-WP5 A2 — Frozen failure taxonomy (13 kinds)', () => {
  it('produces each category with actionable check/action fields', async () => {
    const cases: readonly { expected: string; createError: unknown; verifyError?: unknown }[] = [
      {
        expected: 'BACKUP_OUTPUT_NOT_EMPTY',
        createError: new Error('Backup output directory must be empty: /x'),
      },
      {
        expected: 'DATABASE_UNAVAILABLE',
        createError: new Error('connect ECONNREFUSED 127.0.0.1:5432'),
      },
      {
        expected: 'POSTGRES_TOOL_UNAVAILABLE',
        createError: new Error('pg_dump failed with exit code 127.'),
      },
      {
        expected: 'POSTGRES_VERSION_MISMATCH',
        createError: new Error('PostgreSQL major version 16 is required; found 15.'),
      },
      {
        expected: 'ASSET_MISSING_OR_CORRUPT',
        createError: new Error('Original Asset failed hash or size verification: x'),
      },
      {
        expected: 'BACKUP_CONSISTENCY_CHANGED',
        createError: new Error('Authoritative data changed while the backup was being created.'),
      },
      {
        expected: 'BACKUP_STORAGE_UNAVAILABLE',
        createError: Object.assign(new Error('disk full'), { code: 'ENOSPC' }),
      },
      {
        expected: 'BACKUP_INTEGRITY_INVALID',
        createError: undefined,
        verifyError: new Error('Backup Asset failed verification: x'),
      },
    ];

    for (const entry of cases) {
      const { deps } = makeDeps({
        createBackup: async () => {
          if (entry.createError) throw entry.createError;
          return makeManifest();
        },
        verifyBackup: async () => {
          if (entry.verifyError) throw entry.verifyError;
          return makeManifest();
        },
      });
      const caught = await failure(runOwnerCreate({}, createEnv(), deps));
      expect(caught.code).toBe(entry.expected);
      expect(caught.check.length).toBeGreaterThan(0);
      expect(caught.action.length).toBeGreaterThan(0);
    }
  });

  it('covers BACKUP_NOT_FOUND and RESTORE_* categories via restore-safe', async () => {
    const notFound = await failure(
      runOwnerRestoreSafe(
        {},
        { sourceDatabaseUrl: 'postgres://u:p@h:5432/source', toolMode: 'docker-compose' },
        makeDeps().deps,
      ),
    );
    expect(notFound.code).toBe('BACKUP_NOT_FOUND');

    // BACKUP_NOT_FOUND also fires when --latest finds nothing.
    const latestEmpty = await failure(
      runOwnerRestoreSafe(
        { latest: true },
        { sourceDatabaseUrl: 'postgres://u:p@h:5432/source', toolMode: 'docker-compose' },
        makeDeps().deps,
      ),
    );
    expect(latestEmpty.code).toBe('BACKUP_NOT_FOUND');

    // RESTORE_TARGET_UNSAFE (partial explicit target) with a seeded backup.
    const seededPartial = makeDeps();
    seedBackup(seededPartial, '20260811T000000000Z-a', 'bk');
    const targetUnsafe = await failure(
      runOwnerRestoreSafe(
        { latest: true },
        {
          sourceDatabaseUrl: 'postgres://u:p@h:5432/source',
          toolMode: 'docker-compose',
          explicitTargetDatabaseUrl: 'postgres://u:p@h:5432/t',
        },
        seededPartial.deps,
      ),
    );
    expect(targetUnsafe.code).toBe('RESTORE_TARGET_UNSAFE');

    // RESTORE_TARGET_PREPARATION_FAILED (isolated creation failure).
    const seededPrep = makeDeps({
      createIsolatedRestoreDatabase: async () => {
        throw new Error('no permission');
      },
    });
    seedBackup(seededPrep, '20260811T000000000Z-a', 'bk');
    const prepFailed = await failure(
      runOwnerRestoreSafe(
        { latest: true },
        { sourceDatabaseUrl: 'postgres://u:p@h:5432/source', toolMode: 'docker-compose' },
        seededPrep.deps,
      ),
    );
    expect(prepFailed.code).toBe('RESTORE_TARGET_PREPARATION_FAILED');

    // RESTORE_FAILED (pg_restore failure).
    const seededRestore = makeDeps({
      restoreBackup: async () => {
        throw new Error('pg_restore failed with exit code 1.');
      },
    });
    seedBackup(seededRestore, '20260811T000000000Z-a', 'bk');
    const restoreFailed = await failure(
      runOwnerRestoreSafe(
        { latest: true },
        { sourceDatabaseUrl: 'postgres://u:p@h:5432/source', toolMode: 'docker-compose' },
        seededRestore.deps,
      ),
    );
    expect(restoreFailed.code).toBe('RESTORE_FAILED');

    // RESTORE_VERIFICATION_FAILED (integrity mismatch).
    const seededVerify = makeDeps({
      restoreBackup: async () => {
        throw new Error('Restored authoritative data does not match the Backup Manifest.');
      },
    });
    seedBackup(seededVerify, '20260811T000000000Z-a', 'bk');
    const verifyFailed = await failure(
      runOwnerRestoreSafe(
        { latest: true },
        { sourceDatabaseUrl: 'postgres://u:p@h:5432/source', toolMode: 'docker-compose' },
        seededVerify.deps,
      ),
    );
    expect(verifyFailed.code).toBe('RESTORE_VERIFICATION_FAILED');

    // RESTORE_TARGET_UNSAFE via source=target protection.
    const seededUnsafe = makeDeps({
      restoreBackup: async () => {
        throw new Error('Restore target must not be the source Database.');
      },
    });
    seedBackup(seededUnsafe, '20260811T000000000Z-a', 'bk');
    const unsafe = await failure(
      runOwnerRestoreSafe(
        { latest: true },
        { sourceDatabaseUrl: 'postgres://u:p@h:5432/source', toolMode: 'docker-compose' },
        seededUnsafe.deps,
      ),
    );
    expect(unsafe.code).toBe('RESTORE_TARGET_UNSAFE');
  });
});
