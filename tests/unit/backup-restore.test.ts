import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  BACKUP_FORMAT_VERSION,
  authoritativeIntegrityTablesForMigrations,
  type BackupManifest,
  readManifest,
  restoreBackup,
  verifyBackup,
} from '../../scripts/backup-restore.js';

const temporaryDirectories: string[] = [];
const sha256 = (bytes: Uint8Array): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const fixture = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'shotgun-backup-unit-'));
  temporaryDirectories.push(directory);
  const dump = Buffer.from('custom-dump-fixture');
  const asset = Buffer.from('original-asset-fixture');
  const contract = Buffer.from('{"type":"object"}\n');
  await mkdir(path.join(directory, 'assets', 'original'), { recursive: true });
  await mkdir(path.join(directory, 'contracts', 'packages'), { recursive: true });
  await writeFile(path.join(directory, 'database.dump'), dump);
  await writeFile(path.join(directory, 'assets', 'original', 'asset.blob'), asset);
  await writeFile(path.join(directory, 'contracts', 'packages', 'contract.json'), contract);
  const manifest: BackupManifest = {
    formatVersion: BACKUP_FORMAT_VERSION,
    backupId: '00000000-0000-4000-8000-000000000001',
    createdAt: '2026-07-21T00:00:00.000Z',
    database: {
      engine: 'postgresql',
      majorVersion: 16,
      dumpFormat: 'custom',
      dumpFile: 'database.dump',
      dumpSha256: sha256(dump),
      migrations: ['001_runtime.sql'],
    },
    assets: {
      storage: 'local-content-addressed',
      files: [
        {
          storageKey: 'original/asset.blob',
          contentHash: sha256(asset),
          sizeBytes: asset.byteLength,
          backupPath: 'assets/original/asset.blob',
          backupDigest: sha256(asset),
        },
      ],
    },
    contracts: {
      files: [
        {
          repositoryPath: 'packages/contract.json',
          backupPath: 'contracts/packages/contract.json',
          sizeBytes: contract.byteLength,
          sha256: sha256(contract),
        },
      ],
    },
    integrity: { tables: {} },
    configuration: {
      secretsIncluded: false,
      projectionAuthority: 'rebuild-from-canonical',
    },
  };
  await writeFile(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
  return { directory, manifest };
};

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('Backup Bundle verification', () => {
  it('verifies the Bundle and fails closed after Database dump tampering', async () => {
    const { directory, manifest } = await fixture();
    await expect(verifyBackup(directory)).resolves.toEqual(manifest);

    await writeFile(path.join(directory, 'database.dump'), 'tampered-dump');
    await expect(verifyBackup(directory)).rejects.toThrow(
      'Database dump digest does not match the Backup Manifest.',
    );
  });

  it('accepts historical shotgun-backup-v1 manifests without newer Discovery tables', async () => {
    const { directory, manifest } = await fixture();
    expect(manifest.formatVersion).toBe('shotgun-backup-v1');
    expect(manifest.integrity.tables).not.toHaveProperty('discovery.findings');
    await expect(readManifest(directory)).resolves.toEqual(manifest);
    await expect(verifyBackup(directory)).resolves.toEqual(manifest);
  });

  it('selects Discovery integrity tables from migration identity and fails closed', () => {
    const discoveryTables = (migrations: readonly string[]) =>
      authoritativeIntegrityTablesForMigrations(migrations).filter((table) =>
        table.startsWith('discovery.'),
      );

    expect(discoveryTables(['044_akp_1r_semantic_generation_lifecycle.sql'])).toEqual([]);
    expect(
      discoveryTables([
        '044_akp_1r_semantic_generation_lifecycle.sql',
        '045_akp_2_wp2_discovery_finding_persistence.sql',
      ]),
    ).toEqual(['discovery.findings']);
    expect(
      discoveryTables([
        '044_akp_1r_semantic_generation_lifecycle.sql',
        '045_akp_2_wp2_discovery_finding_persistence.sql',
        '046_akp_2_wp3_discovery_finding_lifecycle.sql',
        '047_akp_3_wp3_discovery_model_profiles.sql',
      ]),
    ).toEqual([
      'discovery.findings',
      'discovery.finding_lifecycle_current',
      'discovery.finding_lifecycle_history',
      'discovery.model_profiles',
    ]);
    expect(
      discoveryTables([
        '044_akp_1r_semantic_generation_lifecycle.sql',
        '045_akp_2_wp2_discovery_finding_persistence.sql',
        '055_akp_7_wp1_feedback_suppression_ranking_storage.sql',
      ]),
    ).toEqual([
      'discovery.findings',
      'discovery.feedback_events',
      'discovery.suppression_directives',
      'discovery.ranking_policy_revisions',
    ]);
    expect(() =>
      authoritativeIntegrityTablesForMigrations(['046_akp_2_wp3_discovery_finding_lifecycle.sql']),
    ).toThrow('requires 045_akp_2_wp2_discovery_finding_persistence.sql');
    expect(() =>
      authoritativeIntegrityTablesForMigrations([
        '055_akp_7_wp1_feedback_suppression_ranking_storage.sql',
      ]),
    ).toThrow('requires 045_akp_2_wp2_discovery_finding_persistence.sql');
  });

  it('fails closed when a referenced Original Asset is corrupt or missing', async () => {
    const corrupt = await fixture();
    const corruptAsset = path.join(corrupt.directory, corrupt.manifest.assets.files[0]!.backupPath);
    await writeFile(corruptAsset, 'tampered-asset');
    await expect(verifyBackup(corrupt.directory)).rejects.toThrow(
      'Backup Asset failed verification: original/asset.blob',
    );

    const missing = await fixture();
    const missingAsset = path.join(missing.directory, missing.manifest.assets.files[0]!.backupPath);
    await rm(missingAsset);
    await expect(verifyBackup(missing.directory)).rejects.toThrow();
  });

  it('refuses an in-place restore before touching the Backup or target Asset root', async () => {
    const databaseUrl = 'postgres://shotgun:secret@localhost:5432/shotgun';
    await expect(
      restoreBackup({
        sourceDatabaseUrl: databaseUrl,
        targetDatabaseUrl: databaseUrl,
        targetAssetRoot: path.join(os.tmpdir(), 'must-not-be-created'),
        backupDirectory: path.join(os.tmpdir(), 'missing-backup'),
      }),
    ).rejects.toThrow('Restore target must not be the source Database.');
  });
});
