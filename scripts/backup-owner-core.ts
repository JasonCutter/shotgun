/**
 * LPA-WP5 A2 (LPA-BR-D01~D16) — owner-facing Backup/Restore workflow
 * orchestration. Deterministic + injectable so focused tests verify the
 * Frozen contract (default root, collision-safe naming, create→auto-verify,
 * discovery, --latest fail-closed, guided restore-safe, no cutover, failure
 * taxonomy 13종) without heavy OS/DB failure reproduction.
 *
 * The Stage 12.1 core (`scripts/backup-restore.ts`) is REUSED and never
 * reimplemented (D01). This module is a bounded owner workflow wrapper.
 */
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import {
  createBackup,
  createIsolatedRestoreDatabase,
  dropIsolatedRestoreDatabase,
  readManifest,
  restoreBackup,
  verifyBackup,
} from './backup-restore.js';

import type { BackupManifest, BackupToolMode } from './backup-restore.js';

export type { BackupManifest, BackupToolMode } from './backup-restore.js';

export const DEFAULT_BACKUP_ROOT_NAME = 'Shotgun Backups';
export const DEFAULT_RESTORE_ROOT_NAME = 'Shotgun Restores';
export const SENSITIVE_DATA_WARNING =
  'WARNING: This backup contains private Canonical knowledge and Original Asset data. ' +
  'Do NOT share it publicly, keep it off public cloud-sync folders unless you accept the ' +
  'provider privacy/security risk, and note that a same-disk backup is NOT disk-loss protection. ' +
  'Secrets are never included (secretsIncluded: false).';

export type BackupOwnerFailureCode =
  | 'BACKUP_OUTPUT_NOT_EMPTY'
  | 'DATABASE_UNAVAILABLE'
  | 'POSTGRES_TOOL_UNAVAILABLE'
  | 'POSTGRES_VERSION_MISMATCH'
  | 'ASSET_MISSING_OR_CORRUPT'
  | 'BACKUP_CONSISTENCY_CHANGED'
  | 'BACKUP_NOT_FOUND'
  | 'BACKUP_INTEGRITY_INVALID'
  | 'BACKUP_STORAGE_UNAVAILABLE'
  | 'RESTORE_TARGET_UNSAFE'
  | 'RESTORE_TARGET_PREPARATION_FAILED'
  | 'RESTORE_FAILED'
  | 'RESTORE_VERIFICATION_FAILED';

export class BackupOwnerFailure extends Error {
  constructor(
    readonly code: BackupOwnerFailureCode,
    message: string,
    readonly check: string,
    readonly action: string,
  ) {
    super(message);
    this.name = 'BackupOwnerFailure';
  }
}

/** Owner-facing env for the create/restore flows. */
export type OwnerBackupEnv = {
  readonly databaseUrl: string;
  readonly assetRoot: string;
  readonly toolMode: BackupToolMode;
};

export type OwnerRestoreEnv = {
  readonly sourceDatabaseUrl: string;
  readonly toolMode: BackupToolMode;
  readonly explicitTargetDatabaseUrl?: string;
  readonly explicitTargetAssetRoot?: string;
};

export interface OwnerDeps {
  readonly homedir: () => string;
  readonly now: () => Date;
  readonly randomSuffix: () => string;
  readonly createBackup: (opts: {
    databaseUrl: string;
    assetRoot: string;
    outputDirectory: string;
    toolMode?: BackupToolMode;
  }) => Promise<BackupManifest>;
  readonly verifyBackup: (directory: string) => Promise<BackupManifest>;
  readonly restoreBackup: (opts: {
    sourceDatabaseUrl: string;
    targetDatabaseUrl: string;
    targetAssetRoot: string;
    backupDirectory: string;
    toolMode?: BackupToolMode;
  }) => Promise<BackupManifest>;
  readonly createIsolatedRestoreDatabase: (
    sourceDatabaseUrl: string,
  ) => Promise<{ databaseName: string; databaseUrl: string }>;
  readonly dropIsolatedRestoreDatabase: (
    sourceDatabaseUrl: string,
    databaseName: string,
  ) => Promise<void>;
  readonly readManifest: (directory: string) => Promise<BackupManifest>;
  readonly readdir: (directory: string) => Promise<readonly string[]>;
  readonly directorySize: (directory: string) => Promise<number>;
  readonly remove: (directory: string) => Promise<void>;
  readonly queryRows: (databaseUrl: string, sql: string) => Promise<readonly unknown[]>;
}

export const createDefaultOwnerDeps = (): OwnerDeps => ({
  homedir: () => os.homedir(),
  now: () => new Date(),
  randomSuffix: () => randomUUID().replaceAll('-', ''),
  createBackup,
  verifyBackup,
  restoreBackup,
  createIsolatedRestoreDatabase,
  dropIsolatedRestoreDatabase,
  readManifest,
  readdir: async (directory) => {
    const { readdir } = await import('node:fs/promises');
    return readdir(directory);
  },
  directorySize: async (directory) => {
    const { readdir, stat } = await import('node:fs/promises');
    const entries = await readdir(directory, { withFileTypes: true });
    let total = 0;
    for (const entry of entries) {
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        total += await totalDirectorySize(child);
      } else if (entry.isFile()) {
        total += (await stat(child)).size;
      }
    }
    return total;
  },
  remove: async (directory) => {
    const { rm } = await import('node:fs/promises');
    await rm(directory, { recursive: true, force: true });
  },
  queryRows: async (databaseUrl, sql) => {
    const { default: pg } = await import('pg');
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const result = await client.query(sql);
      return result.rows;
    } finally {
      await client.end();
    }
  },
});

export const defaultBackupRoot = (deps: OwnerDeps): string =>
  path.join(deps.homedir(), DEFAULT_BACKUP_ROOT_NAME);

export const defaultRestoreRoot = (deps: OwnerDeps): string =>
  path.join(deps.homedir(), DEFAULT_RESTORE_ROOT_NAME);

const totalDirectorySize = async (directory: string): Promise<number> => {
  const { readdir, stat } = await import('node:fs/promises');
  const entries = await readdir(directory, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      total += await totalDirectorySize(child);
    } else if (entry.isFile()) {
      total += (await stat(child)).size;
    }
  }
  return total;
};

/**
 * D03 — collision-safe, Windows-safe, sortable backup directory name.
 * Example: `20260811T004300123Z-a1b2c3` (UTC sortable, no colon, suffix).
 */
export const collisionSafeName = (deps: OwnerDeps): string => {
  const iso = deps.now().toISOString();
  const compact = `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}${iso.slice(20, 23)}Z`;
  return `${compact}-${deps.randomSuffix().slice(0, 6)}`;
};

export type BackupDestination = {
  readonly directory: string;
  readonly mode: 'output' | 'root';
};

export const resolveBackupDestination = (
  args: { readonly output?: string; readonly root?: string },
  deps: OwnerDeps,
): BackupDestination => {
  if (args.output) return { directory: path.resolve(args.output), mode: 'output' };
  const root = args.root ? path.resolve(args.root) : defaultBackupRoot(deps);
  return { directory: path.join(root, collisionSafeName(deps)), mode: 'root' };
};

export type OwnerCreateResult = {
  readonly directory: string;
  readonly manifest: BackupManifest;
  readonly verifiedManifest: BackupManifest;
  readonly sizeBytes: number;
};

export const runOwnerCreate = async (
  args: { readonly output?: string; readonly root?: string },
  env: OwnerBackupEnv,
  deps: OwnerDeps,
): Promise<OwnerCreateResult> => {
  const { directory } = resolveBackupDestination(args, deps);
  let manifest: BackupManifest;
  try {
    manifest = await deps.createBackup({
      databaseUrl: env.databaseUrl,
      assetRoot: env.assetRoot,
      outputDirectory: directory,
      toolMode: env.toolMode,
    });
  } catch (error) {
    throw classifyCreateError(error);
  }
  let verifiedManifest: BackupManifest;
  try {
    verifiedManifest = await deps.verifyBackup(directory);
  } catch (error) {
    throw classifyVerifyError(error);
  }
  let sizeBytes: number;
  try {
    sizeBytes = await deps.directorySize(directory);
  } catch (error) {
    throw classifyStorageError(error);
  }
  return { directory, manifest, verifiedManifest, sizeBytes };
};

export type BackupEntry = {
  readonly directory: string;
  readonly name: string;
  readonly status: 'ok' | 'error';
  readonly manifest?: BackupManifest;
  readonly sizeBytes?: number;
  readonly verified?: boolean;
  readonly error?: string;
};

export type BackupListResult = {
  readonly root: string;
  readonly entries: readonly BackupEntry[];
  readonly totalBackups: number;
  readonly totalSizeBytes: number;
};

export const listBackups = async (
  args: { readonly root?: string; readonly verify?: boolean },
  deps: OwnerDeps,
): Promise<BackupListResult> => {
  const root = args.root ? path.resolve(args.root) : defaultBackupRoot(deps);
  let names: readonly string[];
  try {
    names = await deps.readdir(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { root, entries: [], totalBackups: 0, totalSizeBytes: 0 };
    }
    throw classifyStorageError(error);
  }
  // Newest first: names are lexicographically sortable timestamps.
  const ordered = [...names].sort().reverse();
  const entries: BackupEntry[] = [];
  let totalSizeBytes = 0;
  for (const name of ordered) {
    const directory = path.join(root, name);
    let entry: BackupEntry = { directory, name, status: 'ok' };
    try {
      const manifest = await deps.readManifest(directory);
      const size = await deps.directorySize(directory);
      totalSizeBytes += size;
      if (args.verify) {
        await deps.verifyBackup(directory);
        entry = { directory, name, status: 'ok', manifest, sizeBytes: size, verified: true };
      } else {
        entry = { directory, name, status: 'ok', manifest, sizeBytes: size };
      }
    } catch (error) {
      entry = {
        directory,
        name,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
    entries.push(entry);
  }
  return { root, entries, totalBackups: entries.length, totalSizeBytes };
};

/**
 * D06 — `--latest` selection is FAIL CLOSED: if the newest candidate is
 * unreadable/malformed/incomplete/integrity-invalid, we never silently fall
 * back to an older backup.
 */
export const selectLatestBackup = async (
  args: { readonly root?: string },
  deps: OwnerDeps,
): Promise<string> => {
  const result = await listBackups({ root: args.root }, deps);
  if (result.entries.length === 0) {
    throw new BackupOwnerFailure(
      'BACKUP_NOT_FOUND',
      `No backups were found under ${result.root}.`,
      'Create a backup first, or pass an explicit --backup <directory>.',
      'npm run backup:create',
    );
  }
  const newest = result.entries[0];
  if (!newest) {
    throw new BackupOwnerFailure(
      'BACKUP_NOT_FOUND',
      `No backups were found under ${result.root}.`,
      'Create a backup first, or pass an explicit --backup <directory>.',
      'npm run backup:create',
    );
  }
  if (newest.status === 'error' || !newest.manifest) {
    throw new BackupOwnerFailure(
      'BACKUP_INTEGRITY_INVALID',
      `The most recent backup candidate is unreadable or invalid: ${newest.directory} (${newest.error ?? 'missing manifest'}).`,
      'Inspect or repair the newest backup, or explicitly select an older backup path.',
      'npm run backup:verify -- --backup <directory>',
    );
  }
  return newest.directory;
};

export type RestoreTarget = {
  readonly databaseUrl: string;
  readonly assetRoot: string;
  readonly autoCreated: boolean;
  readonly databaseName?: string;
};

export type RecoveryVerificationResult = {
  readonly canonicalReadable: boolean;
  readonly projectionsRebuildable: boolean;
};

export type OwnerRestoreSafeResult = {
  readonly backupDirectory: string;
  readonly manifest: BackupManifest;
  readonly target: RestoreTarget;
  readonly recovery: RecoveryVerificationResult;
};

const PROJECTION_TABLES = [
  'projection.discovery_inferences',
  'projection.compiled_truth',
  'projection.search_documents',
  'projection.watermarks',
] as const;

/** D12 — bounded Product recovery verification on the restored target. */
export const verifyBoundedRecovery = async (
  targetDatabaseUrl: string,
  deps: OwnerDeps,
): Promise<RecoveryVerificationResult> => {
  try {
    await deps.queryRows(
      targetDatabaseUrl,
      'SELECT count(*)::text AS count FROM canonical.project_state',
    );
    let projectionsRebuildable = true;
    for (const table of PROJECTION_TABLES) {
      const rows = await deps.queryRows(
        targetDatabaseUrl,
        `SELECT count(*)::text AS count FROM ${table}`,
      );
      const count = rows[0] ? Number((rows[0] as { count: string }).count) : -1;
      if (count !== 0) projectionsRebuildable = false;
    }
    return { canonicalReadable: true, projectionsRebuildable };
  } catch (error) {
    throw classifyRestoreError(error);
  }
};

export const runOwnerRestoreSafe = async (
  args: { readonly backup?: string; readonly latest?: boolean; readonly root?: string },
  env: OwnerRestoreEnv,
  deps: OwnerDeps,
): Promise<OwnerRestoreSafeResult> => {
  // 1. Select the backup.
  let backupDirectory: string;
  if (args.latest) {
    backupDirectory = await selectLatestBackup({ root: args.root }, deps);
  } else if (args.backup) {
    backupDirectory = path.resolve(args.backup);
    try {
      await deps.readManifest(backupDirectory);
    } catch (error) {
      if (error instanceof BackupOwnerFailure) throw error;
      throw new BackupOwnerFailure(
        'BACKUP_NOT_FOUND',
        `No readable backup manifest was found at ${backupDirectory}.`,
        'Check the path or use --latest to select from the default root.',
        'npm run backup:list',
      );
    }
  } else {
    throw new BackupOwnerFailure(
      'BACKUP_NOT_FOUND',
      'restore-safe requires --backup <directory> or --latest.',
      'Select a backup first.',
      'npm run backup:list',
    );
  }

  // 2. FULL verify BEFORE any target preparation (D10 ordering).
  try {
    await deps.verifyBackup(backupDirectory);
  } catch (error) {
    throw classifyVerifyError(error);
  }

  // 3. Safe target selection.
  const explicitDb = env.explicitTargetDatabaseUrl;
  const explicitRoot = env.explicitTargetAssetRoot;
  let target: RestoreTarget;
  if (explicitDb || explicitRoot) {
    if (!explicitDb || !explicitRoot) {
      throw new BackupOwnerFailure(
        'RESTORE_TARGET_UNSAFE',
        'Ambiguous partial restore target: provide BOTH RESTORE_DATABASE_URL and RESTORE_ASSET_STORAGE_ROOT, or neither (an isolated target will be created).',
        'Set both restore target env vars or remove both.',
        'Set RESTORE_DATABASE_URL and RESTORE_ASSET_STORAGE_ROOT in .env',
      );
    }
    target = { databaseUrl: explicitDb, assetRoot: explicitRoot, autoCreated: false };
  } else {
    try {
      const isolated = await deps.createIsolatedRestoreDatabase(env.sourceDatabaseUrl);
      const assetRoot = path.join(defaultRestoreRoot(deps), collisionSafeName(deps), 'assets');
      target = {
        databaseUrl: isolated.databaseUrl,
        assetRoot,
        autoCreated: true,
        databaseName: isolated.databaseName,
      };
    } catch {
      throw new BackupOwnerFailure(
        'RESTORE_TARGET_PREPARATION_FAILED',
        'Could not prepare an isolated restore target.',
        'Check that the PostgreSQL server allows creating databases and that disk space is available.',
        'npm run backup:restore-safe -- --backup <directory>',
      );
    }
  }

  // 4. Restore + verification + bounded recovery; cleanup only auto-created
  //    targets on failure (D10/D11 ownership contract).
  try {
    const manifest = await deps.restoreBackup({
      sourceDatabaseUrl: env.sourceDatabaseUrl,
      targetDatabaseUrl: target.databaseUrl,
      targetAssetRoot: target.assetRoot,
      backupDirectory,
      toolMode: env.toolMode,
    });
    const recovery = await verifyBoundedRecovery(target.databaseUrl, deps);
    return { backupDirectory, manifest, target, recovery };
  } catch (error) {
    const failure = classifyRestoreError(error);
    if (target.autoCreated) {
      try {
        await cleanupAutoCreatedTarget(target, env.sourceDatabaseUrl, deps);
      } catch (cleanupError) {
        throw new BackupOwnerFailure(
          failure.code,
          `${failure.message} (cleanup of the auto-created target also failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)})`,
          failure.check,
          failure.action,
        );
      }
    }
    throw failure;
  }
};

const cleanupAutoCreatedTarget = async (
  target: RestoreTarget,
  sourceDatabaseUrl: string,
  deps: OwnerDeps,
): Promise<void> => {
  if (target.databaseName) {
    await deps.dropIsolatedRestoreDatabase(sourceDatabaseUrl, target.databaseName);
  }
  await deps.remove(target.assetRoot);
};

const isErrno = (error: unknown, code: string): boolean =>
  error instanceof Error && (error as NodeJS.ErrnoException).code === code;

const classifyStorageError = (error: unknown): BackupOwnerFailure =>
  new BackupOwnerFailure(
    'BACKUP_STORAGE_UNAVAILABLE',
    `The backup storage location could not be written: ${error instanceof Error ? error.message : String(error)}.`,
    'Check permissions, path creation and free disk space on the backup root (no automatic fallback to another root).',
    'Choose a writable --root or free disk space, then retry npm run backup:create',
  );

const classifyCreateError = (error: unknown): BackupOwnerFailure => {
  if (error instanceof BackupOwnerFailure) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('must be empty')) {
    return new BackupOwnerFailure(
      'BACKUP_OUTPUT_NOT_EMPTY',
      `The backup output directory must be empty: ${message}`,
      'Choose an empty directory for the backup output.',
      'Use a new --root/--output directory, then retry npm run backup:create',
    );
  }
  if (message.includes('PostgreSQL major version')) {
    return new BackupOwnerFailure(
      'POSTGRES_VERSION_MISMATCH',
      message,
      'Backup requires PostgreSQL 16 for both server and client utilities.',
      'Use the pinned PostgreSQL 16 Docker image or a matching local client.',
    );
  }
  if (message.includes('Original Asset failed hash or size')) {
    return new BackupOwnerFailure(
      'ASSET_MISSING_OR_CORRUPT',
      message,
      'An Original Asset referenced by the database is missing or corrupted on disk.',
      'Repair the asset root and retry npm run backup:create',
    );
  }
  if (message.includes('Authoritative data changed')) {
    return new BackupOwnerFailure(
      'BACKUP_CONSISTENCY_CHANGED',
      message,
      'Shotgun wrote authoritative data while the backup was being created.',
      'Retry the backup; if it keeps failing, quit Shotgun gracefully and run npm run backup:create again',
    );
  }
  if (message.includes('pg_dump failed') || message.includes('pg_restore failed')) {
    return new BackupOwnerFailure(
      'POSTGRES_TOOL_UNAVAILABLE',
      message,
      'The PostgreSQL dump/restore tool failed.',
      'Confirm pg_dump/pg_restore (or the Docker service) is available and matches PostgreSQL 16.',
    );
  }
  // spawn ENOENT (pg_dump/pg_restore executable missing) vs asset-read ENOENT.
  if (message.includes('spawn')) {
    return new BackupOwnerFailure(
      'POSTGRES_TOOL_UNAVAILABLE',
      message,
      'A required PostgreSQL tool could not be spawned.',
      'Confirm pg_dump/pg_restore (or the Docker service) is available.',
    );
  }
  if (isErrno(error, 'ENOENT')) {
    return new BackupOwnerFailure(
      'ASSET_MISSING_OR_CORRUPT',
      message,
      'An Original Asset referenced by the database is missing or corrupted on disk.',
      'Repair the asset root and retry npm run backup:create',
    );
  }
  if (
    isErrno(error, 'ENOSPC') ||
    isErrno(error, 'EPERM') ||
    isErrno(error, 'EACCES') ||
    isErrno(error, 'EEXIST')
  ) {
    return classifyStorageError(error);
  }
  if (
    isErrno(error, 'ECONNREFUSED') ||
    isErrno(error, 'ENOTFOUND') ||
    message.includes('connect')
  ) {
    return new BackupOwnerFailure(
      'DATABASE_UNAVAILABLE',
      message,
      'PostgreSQL is not reachable.',
      'Start the DB container or local PostgreSQL and retry.',
    );
  }
  return new BackupOwnerFailure(
    'BACKUP_INTEGRITY_INVALID',
    message,
    'The backup could not be created/verified.',
    'Inspect the error and retry npm run backup:create',
  );
};

const classifyVerifyError = (error: unknown): BackupOwnerFailure => {
  if (error instanceof BackupOwnerFailure) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('digest does not match') || message.includes('failed verification')) {
    return new BackupOwnerFailure(
      'BACKUP_INTEGRITY_INVALID',
      message,
      'The backup fails integrity verification (dump/asset/contract digest mismatch).',
      'Inspect the newest backup or select an explicit older backup path.',
    );
  }
  return classifyCreateError(error);
};

const classifyRestoreError = (error: unknown): BackupOwnerFailure => {
  if (error instanceof BackupOwnerFailure) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('must not be the source Database') || message.includes('must be empty')) {
    return new BackupOwnerFailure(
      'RESTORE_TARGET_UNSAFE',
      message,
      'The restore target is unsafe (same as source, or not empty).',
      'Use a new empty database and empty asset root, or remove RESTORE_* to auto-create an isolated target.',
    );
  }
  if (
    message.includes('Restored authoritative data does not match') ||
    message.includes('Restored Asset failed verification')
  ) {
    return new BackupOwnerFailure(
      'RESTORE_VERIFICATION_FAILED',
      message,
      'The restored data does not match the Backup Manifest.',
      'Do not use this restored target; inspect and retry with another backup.',
    );
  }
  if (message.includes('pg_restore failed')) {
    return new BackupOwnerFailure(
      'RESTORE_FAILED',
      message,
      'pg_restore failed while restoring the backup.',
      'Check the target database/asset root and retry restore-safe.',
    );
  }
  if (isErrno(error, 'ECONNREFUSED') || message.includes('connect')) {
    return new BackupOwnerFailure(
      'DATABASE_UNAVAILABLE',
      message,
      'PostgreSQL is not reachable.',
      'Start the DB container or local PostgreSQL and retry.',
    );
  }
  return new BackupOwnerFailure(
    'RESTORE_FAILED',
    message,
    'The restore operation failed.',
    'Inspect the error and retry npm run backup:restore-safe',
  );
};
