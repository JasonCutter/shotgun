/**
 * LPA-WP5 A2 — owner-facing Backup/Restore CLI entry.
 *
 * Commands (canonical, D01/D04/D05/D06/D10):
 *   npm run backup:create                — default root, auto verify, summary
 *   npm run backup:create -- --root <r>  — custom root, auto timestamp child
 *   npm run backup:create -- --output <d>— legacy exact directory
 *   npm run backup:list                  — discovery under default root
 *   npm run backup:list -- --root <r>    — discovery under custom root
 *   npm run backup:list -- --verify      — full verifyBackup per entry
 *   npm run backup:verify -- --backup <d>— legacy exact verify
 *   npm run backup:verify -- --latest    — latest (fail closed on corrupt)
 *   npm run backup:restore-safe -- --backup <d> | --latest [--root <r>]
 *
 * The low-level `backup:restore` and `backup:drill` remain untouched.
 */
import path from 'node:path';

import 'dotenv/config';

import {
  BackupOwnerFailure,
  SENSITIVE_DATA_WARNING,
  createDefaultOwnerDeps,
  listBackups,
  runOwnerCreate,
  runOwnerRestoreSafe,
  selectLatestBackup,
  type BackupManifest,
  type BackupToolMode,
} from './backup-owner-core.js';

const argument = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const hasFlag = (name: string): boolean => process.argv.includes(name);

const toolMode = (): BackupToolMode => {
  const mode = (process.env.SHOTGUN_PG_TOOL_MODE ?? 'local') as BackupToolMode;
  if (!['local', 'docker-compose'].includes(mode)) {
    throw new BackupOwnerFailure(
      'POSTGRES_TOOL_UNAVAILABLE',
      `SHOTGUN_PG_TOOL_MODE must be local or docker-compose (got ${mode}).`,
      'Set SHOTGUN_PG_TOOL_MODE in .env.',
      'Set SHOTGUN_PG_TOOL_MODE=docker-compose (or local) in .env',
    );
  }
  return mode;
};

const requiredEnvironment = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new BackupOwnerFailure(
      'DATABASE_UNAVAILABLE',
      `${name} is required for this command.`,
      `Set ${name} in .env.`,
      `Set ${name} in .env`,
    );
  }
  return value;
};

const humanSize = (bytes: number): string => {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GiB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
};

const printCreate = (result: Awaited<ReturnType<typeof runOwnerCreate>>): void => {
  const manifest = result.manifest;
  console.log(`VERIFIED ${result.verifiedManifest.backupId}`);
  console.log(`  backupId:       ${manifest.backupId}`);
  console.log(`  createdAt:      ${manifest.createdAt}`);
  console.log(`  backup path:    ${result.directory}`);
  console.log(`  format version: ${manifest.formatVersion}`);
  console.log(`  database dump:  ${manifest.database.dumpFile}`);
  console.log(`  assets:         ${manifest.assets.files.length}`);
  console.log(`  contracts:      ${manifest.contracts.files.length}`);
  console.log(`  tables:         ${Object.keys(manifest.integrity.tables).length}`);
  console.log(`  total size:     ${humanSize(result.sizeBytes)}`);
  console.log(SENSITIVE_DATA_WARNING);
};

const printList = async (args: {
  readonly root?: string;
  readonly verify?: boolean;
}): Promise<void> => {
  const deps = createDefaultOwnerDeps();
  const result = await listBackups(args, deps);
  console.log(`Backup root: ${result.root}`);
  console.log(`Total backups: ${result.totalBackups}`);
  console.log(`Total storage usage: ${humanSize(result.totalSizeBytes)}`);
  console.log(
    'WARNING: backups are never deleted automatically (no retention). Scheduled backups keep consuming disk space.',
  );
  for (const entry of result.entries) {
    if (entry.status === 'ok' && entry.manifest) {
      const marker = entry.verified ? 'VERIFIED' : 'ok';
      console.log(
        `${marker.padEnd(8)} ${entry.name}  ${entry.manifest.createdAt}  ${entry.manifest.backupId}  ` +
          `size=${entry.sizeBytes !== undefined ? humanSize(entry.sizeBytes) : '?'}  ` +
          `assets=${entry.manifest.assets.files.length}  contracts=${entry.manifest.contracts.files.length}`,
      );
    } else {
      console.log(`ERROR    ${entry.name}  unreadable: ${entry.error ?? 'missing manifest'}`);
    }
  }
};

const printVerify = (manifest: BackupManifest, directory: string): void => {
  console.log(`VERIFIED ${manifest.backupId}`);
  console.log(`  backup path: ${directory}`);
  console.log(`  createdAt:   ${manifest.createdAt}`);
  console.log(`  assets:      ${manifest.assets.files.length}`);
  console.log(`  contracts:   ${manifest.contracts.files.length}`);
};

const redactUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    parsed.password = '***';
    return parsed.toString();
  } catch {
    return '(unparseable)';
  }
};

const printRestoreSafe = (result: Awaited<ReturnType<typeof runOwnerRestoreSafe>>): void => {
  console.log(`RESTORED_AND_VERIFIED ${result.manifest.backupId}`);
  console.log(`  backup:            ${result.backupDirectory}`);
  console.log(`  target database:   ${redactUrl(result.target.databaseUrl)}`);
  console.log(`  target asset root: ${result.target.assetRoot}`);
  console.log(`  restored assets:   ${result.manifest.assets.files.length}`);
  console.log(`  integrity:         matches manifest (authoritative + assets)`);
  console.log(
    `  recovery:           canonical readable=${result.recovery.canonicalReadable} projectionsRebuildable=${result.recovery.projectionsRebuildable}`,
  );
  console.log('  target retained:   the restored target is kept for inspection.');
  console.log(
    '  NO CUTOVER: the active environment was NOT modified (.env, source DB, source assets untouched).',
  );
  console.log(
    '  To inspect the restored Shotgun, point DATABASE_URL and ASSET_STORAGE_ROOT at the restored target (owner action).',
  );
  console.log(SENSITIVE_DATA_WARNING);
};

const main = async (): Promise<void> => {
  const command = process.argv[2];
  const deps = createDefaultOwnerDeps();
  const mode = toolMode();

  if (command === 'create') {
    const result = await runOwnerCreate(
      { output: argument('--output'), root: argument('--root') },
      {
        databaseUrl: requiredEnvironment('DATABASE_URL'),
        assetRoot: requiredEnvironment('ASSET_STORAGE_ROOT'),
        toolMode: mode,
      },
      deps,
    );
    printCreate(result);
    return;
  }

  if (command === 'list') {
    await printList({ root: argument('--root'), verify: hasFlag('--verify') });
    return;
  }

  if (command === 'verify') {
    const latest = hasFlag('--latest');
    const backup = argument('--backup');
    const root = argument('--root');
    let directory: string;
    if (latest) {
      directory = await selectLatestBackup({ root }, deps);
    } else if (backup) {
      directory = path.resolve(backup);
    } else {
      throw new BackupOwnerFailure(
        'BACKUP_NOT_FOUND',
        'verify requires --backup <directory> or --latest.',
        'Select a backup to verify.',
        'npm run backup:list',
      );
    }
    let manifest: BackupManifest;
    try {
      manifest = await deps.verifyBackup(directory);
    } catch (error) {
      throw new BackupOwnerFailure(
        'BACKUP_INTEGRITY_INVALID',
        error instanceof Error ? error.message : String(error),
        'The backup fails integrity verification.',
        'Inspect the newest backup or select an explicit backup path.',
      );
    }
    printVerify(manifest, directory);
    return;
  }

  if (command === 'restore-safe') {
    const result = await runOwnerRestoreSafe(
      {
        backup: argument('--backup'),
        latest: hasFlag('--latest'),
        root: argument('--root'),
      },
      {
        sourceDatabaseUrl: requiredEnvironment('DATABASE_URL'),
        toolMode: mode,
        explicitTargetDatabaseUrl: process.env.RESTORE_DATABASE_URL,
        explicitTargetAssetRoot: process.env.RESTORE_ASSET_STORAGE_ROOT,
      },
      deps,
    );
    printRestoreSafe(result);
    return;
  }

  throw new BackupOwnerFailure(
    'BACKUP_NOT_FOUND',
    `Unknown command: ${String(command)}.`,
    'Use one of: create, list, verify, restore-safe.',
    'npm run backup:create',
  );
};

void main().catch((error) => {
  if (error instanceof BackupOwnerFailure) {
    console.error(`[backup] FAILURE ${error.code}: ${error.message}`);
    console.error(`[backup]   check:  ${error.check}`);
    console.error(`[backup]   action: ${error.action}`);
  } else {
    console.error('[backup] UNEXPECTED', error);
  }
  process.exitCode = 1;
});
