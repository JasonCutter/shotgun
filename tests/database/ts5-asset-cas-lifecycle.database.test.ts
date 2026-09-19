import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import {
  acquireMaintenanceLock,
  releaseMaintenanceLock,
} from '../../adapters/postgres-maintenance-lock/src/index.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';
import { isQuarantineRunId, runAssetCasGc } from '../../scripts/asset-cas-gc.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

describe.runIf(pool)('TS-5 migration and PostgreSQL maintenance barrier', () => {
  beforeAll(async () => {
    await migrateUpTo(undefined, databaseUrl!);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('creates migration 077 staging authority with an exact 30-day contract', async () => {
    const table = await pool!.query<{ relname: string | null }>(
      `SELECT to_regclass('asset.staging_asset_leases')::text AS relname`,
    );
    expect(table.rows[0]?.relname).toBe('asset.staging_asset_leases');
    const issuedAt = new Date('2026-09-19T00:00:00.000Z');
    const expiresAt = new Date('2026-10-19T00:00:00.000Z');
    const leaseId = randomUUID();
    const projectId = `ts5-migration-${leaseId}`;
    await pool!.query(
      `INSERT INTO asset.staging_asset_leases (
         lease_id, reference_digest, project_id, draft_id, item_id, principal_id,
         input_kind, storage_key, content_hash, size_bytes, issued_at, expires_at
       ) VALUES ($1, $2, $3, 'draft', 'item', 'principal', 'FILE',
         'original/sha256/aa/${'a'.repeat(64)}.blob', $4, 1, $5, $6)`,
      [
        leaseId,
        `sha256:${'b'.repeat(64)}`,
        projectId,
        `sha256:${'a'.repeat(64)}`,
        issuedAt.toISOString(),
        expiresAt.toISOString(),
      ],
    );
    const result = await pool!.query<{ days: string }>(
      `SELECT extract(epoch FROM (expires_at - issued_at)) / 86400 AS days
       FROM asset.staging_asset_leases WHERE lease_id = $1`,
      [leaseId],
    );
    expect(Number(result.rows[0]?.days)).toBe(30);
    await pool!.query('DELETE FROM asset.staging_asset_leases WHERE lease_id = $1', [leaseId]);
  });

  it('rejects unsupported input kinds and non-720-hour leases', async () => {
    const issuedAt = new Date('2026-09-19T00:00:00.000Z');
    const base = [
      randomUUID(),
      `sha256:${'c'.repeat(64)}`,
      `ts5-invalid-${randomUUID()}`,
      'original/sha256/aa/' + 'a'.repeat(64) + '.blob',
      `sha256:${'a'.repeat(64)}`,
      issuedAt.toISOString(),
    ];
    await expect(
      pool!.query(
        `INSERT INTO asset.staging_asset_leases (
           lease_id, reference_digest, project_id, draft_id, item_id, principal_id,
           input_kind, storage_key, content_hash, size_bytes, issued_at, expires_at
         ) VALUES ($1, $2, $3, 'draft', 'item', 'principal', 'UNSUPPORTED', $4, $5, 1, $6, $7)`,
        [...base, new Date(issuedAt.getTime() + 720 * 60 * 60 * 1_000).toISOString()],
      ),
    ).rejects.toThrow();
    await expect(
      pool!.query(
        `INSERT INTO asset.staging_asset_leases (
           lease_id, reference_digest, project_id, draft_id, item_id, principal_id,
           input_kind, storage_key, content_hash, size_bytes, issued_at, expires_at
         ) VALUES ($1, $2, $3, 'draft', 'item', 'principal', 'FILE', $4, $5, 1, $6, $7)`,
        [...base, new Date(issuedAt.getTime() + 719 * 60 * 60 * 1_000).toISOString()],
      ),
    ).rejects.toThrow();
  });

  it('enforces the runtime shared / maintenance exclusive lock graph', async () => {
    const runtime = await pool!.connect();
    const backup = await pool!.connect();
    const gc = await pool!.connect();
    try {
      expect(await acquireMaintenanceLock(runtime, 'shared')).toBe(true);
      expect(await acquireMaintenanceLock(gc, 'exclusive', true)).toBe(false);
      expect(await acquireMaintenanceLock(backup, 'shared', true)).toBe(true);
      await releaseMaintenanceLock(backup, 'shared');
      await releaseMaintenanceLock(runtime, 'shared');

      expect(await acquireMaintenanceLock(gc, 'exclusive')).toBe(true);
      expect(await acquireMaintenanceLock(runtime, 'shared', true)).toBe(false);
      expect(await acquireMaintenanceLock(backup, 'shared', true)).toBe(false);
      await releaseMaintenanceLock(gc, 'exclusive');

      expect(await acquireMaintenanceLock(runtime, 'shared')).toBe(true);
      runtime.release(true);
      expect(await acquireMaintenanceLock(gc, 'exclusive', true)).toBe(true);
      await releaseMaintenanceLock(gc, 'exclusive');
    } finally {
      try {
        await releaseMaintenanceLock(runtime, 'shared');
      } catch {
        // The connection-close crash proof intentionally releases runtime.
      }
      try {
        await releaseMaintenanceLock(backup, 'shared');
      } catch {
        // No-op when the shared lock was already released.
      }
      try {
        await releaseMaintenanceLock(gc, 'exclusive');
      } catch {
        // No-op when the exclusive lock was already released.
      }
      backup.release();
      gc.release();
    }
  });

  it('uses PostgreSQL time for active staging protection and legacy cutover', async () => {
    const leaseId = randomUUID();
    const projectId = `ts5-clock-${leaseId}`;
    const bytes = 'active staging clock skew';
    const contentHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const hash = contentHash.slice('sha256:'.length);
    const storageKey = `original/sha256/${hash.slice(0, 2)}/${hash}.blob`;
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'shotgun-ts5-clock-'));
    const assetPath = path.join(temporaryRoot, ...storageKey.split('/'));

    try {
      await mkdir(path.dirname(assetPath), { recursive: true });
      await writeFile(assetPath, bytes);
      const dbNow = await pool!.query<{ now: Date }>('SELECT clock_timestamp() AS now');
      const issuedAt = new Date(dbNow.rows[0]!.now.getTime() - 60 * 60 * 1_000);
      const expiresAt = new Date(issuedAt.getTime() + 720 * 60 * 60 * 1_000);
      await pool!.query(
        `INSERT INTO asset.staging_asset_leases (
           lease_id, reference_digest, project_id, draft_id, item_id, principal_id,
           input_kind, storage_key, content_hash, size_bytes, issued_at, expires_at
         ) VALUES ($1, $2, $3, 'draft', 'item', 'principal', 'FILE', $4, $5, $6, $7, $8)`,
        [
          leaseId,
          `sha256:${'d'.repeat(64)}`,
          projectId,
          storageKey,
          contentHash,
          Buffer.byteLength(bytes),
          issuedAt.toISOString(),
          expiresAt.toISOString(),
        ],
      );

      const report = await runAssetCasGc({
        databaseUrl: databaseUrl!,
        assetRoot: temporaryRoot,
        now: () => new Date('2040-01-01T00:00:00.000Z'),
      });
      expect(report.activeStagingProtectedCount).toBe(1);
      expect(report.candidateCount).toBe(0);
      expect(report.legacyCutover).toBe('WAITING');
    } finally {
      await pool!.query('DELETE FROM asset.staging_asset_leases WHERE lease_id = $1', [leaseId]);
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('reports an original asset without a SourceVersion graph without unprotecting its bytes', async () => {
    const assetId = randomUUID();
    const contentHash = `sha256:${'f'.repeat(64)}`;
    const storageKey = `original/sha256/ff/${'f'.repeat(64)}.blob`;
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'shotgun-ts5-anomaly-'));
    try {
      await pool!.query(
        `INSERT INTO asset.original_assets (asset_id, content_hash, size_bytes, storage_key, created_at)
         VALUES ($1, $2, 1, $3, clock_timestamp())`,
        [assetId, contentHash, storageKey],
      );
      const report = await runAssetCasGc({
        databaseUrl: databaseUrl!,
        assetRoot: temporaryRoot,
      });
      expect(report.dbAnomalyCount).toBe(1);
      expect(report.finalDbProtectedCount).toBeGreaterThanOrEqual(1);
    } finally {
      await pool!.query('DELETE FROM asset.original_assets WHERE asset_id = $1', [assetId]);
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('executes the real apply path with a valid generated run id and bounded batches', async () => {
    const migrationName = '077_ts5_asset_cas_lifecycle.sql';
    const migrationRow = await pool!.query<{ applied_at: Date }>(
      'SELECT applied_at FROM runtime.schema_migrations WHERE name = $1',
      [migrationName],
    );
    const originalAppliedAt = migrationRow.rows[0]?.applied_at;
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'shotgun-ts5-apply-'));
    const blobs = ['first bounded apply bytes', 'second bounded apply bytes'].map((value) => {
      const bytes = Buffer.from(value, 'utf8');
      const hash = createHash('sha256').update(bytes).digest('hex');
      return {
        bytes,
        storageKey: `original/sha256/${hash.slice(0, 2)}/${hash}.blob`,
        hash: `sha256:${hash}`,
      };
    });
    const sorted = [...blobs].sort((left, right) =>
      left.storageKey.localeCompare(right.storageKey),
    );

    try {
      await pool!.query(
        `UPDATE runtime.schema_migrations
         SET applied_at = clock_timestamp() - interval '31 days'
         WHERE name = $1`,
        [migrationName],
      );
      for (const blob of blobs) {
        const file = path.join(temporaryRoot, ...blob.storageKey.split('/'));
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, blob.bytes);
        await utimes(
          file,
          new Date('2026-01-01T00:00:00.000Z'),
          new Date('2026-01-01T00:00:00.000Z'),
        );
      }

      const first = await runAssetCasGc({
        databaseUrl: databaseUrl!,
        assetRoot: temporaryRoot,
        apply: true,
        minAgeMs: 1,
        quarantineAgeMs: 24 * 60 * 60 * 1_000,
        maxCandidates: 1,
      });
      expect(first.legacyCutover).toBe('OPEN');
      expect(first.candidateCount).toBe(2);
      expect(first.selectedMutationBatchCount).toBe(1);
      expect(first.quarantinedCount).toBe(1);
      expect(first.auditPath).toBeDefined();
      const firstRunId = path.basename(path.dirname(first.auditPath!));
      expect(isQuarantineRunId(firstRunId)).toBe(true);
      const firstManifest = JSON.parse(await readFile(first.auditPath!, 'utf8')) as {
        moved: readonly {
          storageKey: string;
          quarantinePath: string;
          contentHash: string;
          sizeBytes: number;
        }[];
      };
      expect(firstManifest.moved).toHaveLength(1);
      expect(firstManifest.moved[0]).toMatchObject({
        storageKey: sorted[0]!.storageKey,
        contentHash: sorted[0]!.hash,
        sizeBytes: sorted[0]!.bytes.byteLength,
      });
      await expect(
        access(path.join(temporaryRoot, ...sorted[0]!.storageKey.split('/'))),
      ).rejects.toThrow();
      await expect(
        readFile(path.join(temporaryRoot, ...firstManifest.moved[0]!.quarantinePath.split('/'))),
      ).resolves.toEqual(sorted[0]!.bytes);
      await expect(
        access(path.join(temporaryRoot, ...sorted[1]!.storageKey.split('/'))),
      ).resolves.toBeUndefined();

      const second = await runAssetCasGc({
        databaseUrl: databaseUrl!,
        assetRoot: temporaryRoot,
        apply: true,
        minAgeMs: 1,
        quarantineAgeMs: 24 * 60 * 60 * 1_000,
        maxCandidates: 1,
      });
      expect(second.candidateCount).toBe(1);
      expect(second.selectedMutationBatchCount).toBe(1);
      expect(second.quarantinedCount).toBe(1);
      const secondManifest = JSON.parse(await readFile(second.auditPath!, 'utf8')) as {
        moved: readonly { storageKey: string }[];
      };
      expect(secondManifest.moved[0]?.storageKey).toBe(sorted[1]!.storageKey);
      await expect(
        access(path.join(temporaryRoot, ...sorted[1]!.storageKey.split('/'))),
      ).rejects.toThrow();
    } finally {
      if (originalAppliedAt !== undefined) {
        await pool!.query('UPDATE runtime.schema_migrations SET applied_at = $1 WHERE name = $2', [
          originalAppliedAt,
          migrationName,
        ]);
      }
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});
