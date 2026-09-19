import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import {
  copyAssets,
  copyRestoredAssets,
  listReferencedAssets,
  type BackupManifest,
} from '../../scripts/backup-restore.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;
const stagingMigration = '077_ts5_asset_cas_lifecycle.sql';

const digest = (value: string): string =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;

describe.runIf(pool)('TS-5 backup and restore asset authority', () => {
  beforeAll(async () => {
    await migrateUpTo(undefined, databaseUrl!);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('includes active staging-only bytes, deduplicates final and staging authority, and restores them', async () => {
    const leaseId = randomUUID();
    const assetId = randomUUID();
    const projectId = `ts5-backup-${leaseId}`;
    const bytes = 'staging-only backup bytes';
    const contentHash = digest(bytes);
    const hash = contentHash.slice('sha256:'.length);
    const storageKey = `original/sha256/${hash.slice(0, 2)}/${hash}.blob`;
    const issuedAt = new Date(Date.now() - 60 * 60 * 1_000);
    const expiresAt = new Date(issuedAt.getTime() + 720 * 60 * 60 * 1_000);
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'shotgun-ts5-backup-'));
    const assetRoot = path.join(temporaryRoot, 'assets');
    const backupRoot = path.join(temporaryRoot, 'backup');
    const restoredRoot = path.join(temporaryRoot, 'restored');
    const assetPath = path.join(assetRoot, ...storageKey.split('/'));

    try {
      await mkdir(path.dirname(assetPath), { recursive: true });
      await writeFile(assetPath, bytes);
      await pool!.query(
        `INSERT INTO asset.staging_asset_leases (
           lease_id, reference_digest, project_id, draft_id, item_id, principal_id,
           input_kind, storage_key, content_hash, size_bytes, issued_at, expires_at
         ) VALUES ($1, $2, $3, 'draft', 'item', 'principal', 'FILE', $4, $5, $6, $7, $8)`,
        [
          leaseId,
          `sha256:${'e'.repeat(64)}`,
          projectId,
          storageKey,
          contentHash,
          Buffer.byteLength(bytes),
          issuedAt.toISOString(),
          expiresAt.toISOString(),
        ],
      );

      const stagingOnly = await listReferencedAssets(databaseUrl!, [stagingMigration]);
      expect(stagingOnly).toContainEqual({
        storageKey,
        contentHash,
        sizeBytes: Buffer.byteLength(bytes),
      });

      const copied = await copyAssets(databaseUrl!, assetRoot, backupRoot, [stagingMigration]);
      expect(copied).toHaveLength(1);
      expect(copied[0]).toMatchObject({ storageKey, contentHash });

      await pool!.query(
        `INSERT INTO asset.original_assets (asset_id, content_hash, size_bytes, storage_key, created_at)
         VALUES ($1, $2, $3, $4, clock_timestamp())`,
        [assetId, contentHash, Buffer.byteLength(bytes), storageKey],
      );
      const deduplicated = await listReferencedAssets(databaseUrl!, [stagingMigration]);
      expect(deduplicated.filter((asset) => asset.storageKey === storageKey)).toHaveLength(1);

      const manifest = {
        assets: { files: copied },
      } as unknown as BackupManifest;
      await copyRestoredAssets(manifest, backupRoot, restoredRoot);
      expect(await readFile(path.join(restoredRoot, ...storageKey.split('/')), 'utf8')).toBe(bytes);
    } finally {
      await pool!.query('DELETE FROM asset.staging_asset_leases WHERE lease_id = $1', [leaseId]);
      await pool!.query('DELETE FROM asset.original_assets WHERE asset_id = $1', [assetId]);
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('fails closed when final and active staging authority disagree for one storage key', async () => {
    const leaseId = randomUUID();
    const assetId = randomUUID();
    const projectId = `ts5-backup-conflict-${leaseId}`;
    const contentHash = `sha256:${'a'.repeat(64)}`;
    const conflictingHash = `sha256:${'b'.repeat(64)}`;
    const storageKey = `original/sha256/aa/${'a'.repeat(64)}.blob`;
    const issuedAt = new Date(Date.now() - 60 * 60 * 1_000);
    const expiresAt = new Date(issuedAt.getTime() + 720 * 60 * 60 * 1_000);

    try {
      await pool!.query(
        `INSERT INTO asset.original_assets (asset_id, content_hash, size_bytes, storage_key, created_at)
         VALUES ($1, $2, 1, $3, clock_timestamp())`,
        [assetId, contentHash, storageKey],
      );
      await pool!.query(
        `INSERT INTO asset.staging_asset_leases (
           lease_id, reference_digest, project_id, draft_id, item_id, principal_id,
           input_kind, storage_key, content_hash, size_bytes, issued_at, expires_at
         ) VALUES ($1, $2, $3, 'draft', 'item', 'principal', 'FILE', $4, $5, 1, $6, $7)`,
        [
          leaseId,
          `sha256:${'c'.repeat(64)}`,
          projectId,
          storageKey,
          conflictingHash,
          issuedAt.toISOString(),
          expiresAt.toISOString(),
        ],
      );
      await expect(listReferencedAssets(databaseUrl!, [stagingMigration])).rejects.toThrow(
        `Backup asset authority disagrees for storage key: ${storageKey}`,
      );
    } finally {
      await pool!.query('DELETE FROM asset.staging_asset_leases WHERE lease_id = $1', [leaseId]);
      await pool!.query('DELETE FROM asset.original_assets WHERE asset_id = $1', [assetId]);
    }
  });
});
