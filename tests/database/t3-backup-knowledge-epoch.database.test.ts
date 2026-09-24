import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';
import {
  authoritativeIntegrityTablesForMigrations,
  createBackup,
  restoreBackup,
  snapshotProjectKnowledgeEpochs,
} from '../../scripts/backup-restore.js';
import { migrateUpTo } from '../../scripts/database.js';
import { initializeSourceErasureJournal } from '../../scripts/source-erasure-journal.js';

const resetMigration = '078_t3_project_source_knowledge_reset.sql';
const canonicalErasureMigration = '101_t3_canonical_erasure.sql';

describe('T3 backup knowledge epoch inventory', () => {
  it('captures every Project epoch and includes reset control state in backup integrity', async () => {
    const database = await createIsolatedPostgresTestDatabase();
    const pool = database.createPool();
    const migrations = [
      '009_stage9_knowledge_model.sql',
      '029_frontend_activity_read_model.sql',
      '030_frontend_history_projection.sql',
      '077_ts5_asset_cas_lifecycle.sql',
      resetMigration,
      canonicalErasureMigration,
      '102_t3_activity_erasure.sql',
    ];
    try {
      await pool.query(
        `INSERT INTO project_admin.projects (id, name, description, status, active)
         VALUES
           ('t3-backup-epoch-zero', 'Epoch zero', 'fixture', 'ACTIVE', true),
           ('t3-backup-epoch-three', 'Epoch three', 'fixture', 'ACTIVE', true)`,
      );
      await pool.query(
        `INSERT INTO project_admin.project_knowledge_epoch (project_id, epoch, state)
         VALUES ('t3-backup-epoch-three', 3, 'RESET_UNVERIFIED')`,
      );

      await expect(
        snapshotProjectKnowledgeEpochs(database.databaseUrl, migrations),
      ).resolves.toEqual({
        't3-backup-epoch-three': 3,
        't3-backup-epoch-zero': 0,
      });
      expect(authoritativeIntegrityTablesForMigrations(migrations)).toEqual(
        expect.arrayContaining([
          'project_admin.project_knowledge_epoch',
          'project_admin.project_knowledge_reset_requests',
          'canonical.knowledge_reset_events',
          'canonical.t3_reset_owner_snapshots',
          'canonical.t3_reset_owner_snapshot_rows',
          'canonical.history_payload_state',
          'canonical.history_payload_audit_events',
          'frontend_activity.activity_index',
          'frontend_activity.projection_watermarks',
          'frontend_history.history_projection_index',
          'frontend_history.projection_watermarks',
          'knowledge.review_groups',
          'knowledge.entity_vault_imports',
        ]),
      );
      await expect(
        snapshotProjectKnowledgeEpochs(database.databaseUrl, ['077_ts5_asset_cas_lifecycle.sql']),
      ).resolves.toBeUndefined();
    } finally {
      await database.dispose();
    }
  });

  it.runIf(process.env.SHOTGUN_PG_TOOL_MODE === 'docker-compose')(
    'restores a pre-T3 backup as a controlled rollback before any reset epoch exists',
    async () => {
      const source = await createIsolatedPostgresTestDatabase({
        migrate: (databaseUrl) => migrateUpTo('077_ts5_asset_cas_lifecycle.sql', databaseUrl),
      });
      const target = await createIsolatedPostgresTestDatabase({ migrate: async () => {} });
      const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'shotgun-t3-rollback-'));
      const backupRoot = path.join(temporaryRoot, 'backups');
      const backupDirectory = path.join(backupRoot, 'pre-t3');
      const sourceAssetRoot = path.join(temporaryRoot, 'source-assets');
      const targetAssetRoot = path.join(temporaryRoot, 'restored-assets');
      const journalRoot = await mkdtemp(path.join(os.tmpdir(), 'shotgun-t3-journal-'));
      const journalKey = randomUUID() + randomUUID();
      const priorJournalRoot = process.env.SHOTGUN_ERASURE_JOURNAL_ROOT;
      const priorJournalKey = process.env.SHOTGUN_ERASURE_JOURNAL_HMAC_KEY;
      const projectId = `t3-rollback-${randomUUID()}`;

      try {
        await mkdir(backupRoot, { recursive: true });
        await mkdir(sourceAssetRoot, { recursive: true });
        const sourcePool = source.createPool();
        await sourcePool.query(
          `INSERT INTO project_admin.projects (id, name, description, status, active)
           VALUES ($1, 'Pre-T3 rollback fixture', 'backup restore drill', 'ACTIVE', true)`,
          [projectId],
        );

        const manifest = await createBackup({
          databaseUrl: source.databaseUrl,
          assetRoot: sourceAssetRoot,
          outputDirectory: backupDirectory,
          toolMode: 'docker-compose',
        });
        expect(manifest.database.migrations).toContain('077_ts5_asset_cas_lifecycle.sql');
        expect(manifest.database.migrations).not.toContain(resetMigration);
        expect(manifest.projectKnowledgeEpochs).toBeUndefined();

        await migrateUpTo(undefined, source.databaseUrl);
        process.env.SHOTGUN_ERASURE_JOURNAL_ROOT = journalRoot;
        process.env.SHOTGUN_ERASURE_JOURNAL_HMAC_KEY = journalKey;
        await initializeSourceErasureJournal(
          { root: journalRoot, hmacKey: journalKey },
          backupRoot,
        );

        await restoreBackup({
          sourceDatabaseUrl: source.databaseUrl,
          targetDatabaseUrl: target.databaseUrl,
          targetAssetRoot,
          backupDirectory,
          backupRoot,
          toolMode: 'docker-compose',
        });

        const targetPool = target.createPool();
        const restoredProject = await targetPool.query<{ id: string; name: string }>(
          'SELECT id, name FROM project_admin.projects WHERE id = $1',
          [projectId],
        );
        const restoredMigrations = await targetPool.query<{ name: string }>(
          'SELECT name FROM runtime.schema_migrations ORDER BY name',
        );
        expect(restoredProject.rows).toEqual([{ id: projectId, name: 'Pre-T3 rollback fixture' }]);
        expect(restoredMigrations.rows.at(-1)?.name).toBe('077_ts5_asset_cas_lifecycle.sql');
        expect(restoredMigrations.rows.some((row) => row.name === resetMigration)).toBe(false);
      } finally {
        if (priorJournalRoot === undefined) delete process.env.SHOTGUN_ERASURE_JOURNAL_ROOT;
        else process.env.SHOTGUN_ERASURE_JOURNAL_ROOT = priorJournalRoot;
        if (priorJournalKey === undefined) delete process.env.SHOTGUN_ERASURE_JOURNAL_HMAC_KEY;
        else process.env.SHOTGUN_ERASURE_JOURNAL_HMAC_KEY = priorJournalKey;
        await Promise.allSettled([source.dispose(), target.dispose()]);
        await Promise.allSettled([
          rm(temporaryRoot, { recursive: true, force: true }),
          rm(journalRoot, { recursive: true, force: true }),
        ]);
      }
    },
  );
});
