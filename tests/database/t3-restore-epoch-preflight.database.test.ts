import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  authoritativeIntegrityTablesForMigrations,
  BACKUP_FORMAT_VERSION,
  restoreBackup,
  type BackupManifest,
} from '../../scripts/backup-restore.js';
import {
  appendSourceErasureJournalRecord,
  initializeSourceErasureJournal,
} from '../../scripts/source-erasure-journal.js';
import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';

const sha256 = (bytes: Uint8Array): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

describe('T3 restore knowledge epoch preflight', () => {
  let source: Awaited<ReturnType<typeof createIsolatedPostgresTestDatabase>>;
  let target: Awaited<ReturnType<typeof createIsolatedPostgresTestDatabase>>;
  let sourcePool: ReturnType<typeof source.createPool>;
  let temporaryRoot: string;
  let previousJournalRoot: string | undefined;
  let previousJournalKey: string | undefined;

  beforeAll(async () => {
    source = await createIsolatedPostgresTestDatabase();
    target = await createIsolatedPostgresTestDatabase({ migrate: async () => {} });
    sourcePool = source.createPool();
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'shotgun-t3-restore-epoch-'));
    previousJournalRoot = process.env.SHOTGUN_ERASURE_JOURNAL_ROOT;
    previousJournalKey = process.env.SHOTGUN_ERASURE_JOURNAL_HMAC_KEY;
  }, 60_000);

  afterAll(async () => {
    if (target) await target.dispose();
    if (source) await source.dispose();
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
    if (previousJournalRoot === undefined) delete process.env.SHOTGUN_ERASURE_JOURNAL_ROOT;
    else process.env.SHOTGUN_ERASURE_JOURNAL_ROOT = previousJournalRoot;
    if (previousJournalKey === undefined) delete process.env.SHOTGUN_ERASURE_JOURNAL_HMAC_KEY;
    else process.env.SHOTGUN_ERASURE_JOURNAL_HMAC_KEY = previousJournalKey;
  });

  it('rejects a pre-reset backup before touching the restore target', async () => {
    const projectId = `t3-restore-${randomUUID()}`;
    const requestId = randomUUID();
    const backupRoot = path.join(temporaryRoot, 'backups');
    const backupDirectory = path.join(backupRoot, 'pre-reset');
    const journalRoot = path.join(temporaryRoot, 'journal');
    const targetAssetRoot = path.join(temporaryRoot, 'restored-assets');
    const hmacKey = randomUUID() + randomUUID();
    await mkdir(backupDirectory, { recursive: true });
    process.env.SHOTGUN_ERASURE_JOURNAL_ROOT = journalRoot;
    process.env.SHOTGUN_ERASURE_JOURNAL_HMAC_KEY = hmacKey;
    const journal = { root: journalRoot, hmacKey };
    await initializeSourceErasureJournal(journal, backupRoot);

    await sourcePool.query(
      `INSERT INTO project_admin.projects (id, name, description, status, active)
       VALUES ($1, 'T3 stale backup fixture', 'restore preflight', 'ACTIVE', true)`,
      [projectId],
    );
    await sourcePool.query(
      `INSERT INTO project_admin.project_knowledge_epoch (project_id, epoch, state)
       VALUES ($1, 1, 'RESET_UNVERIFIED')`,
      [projectId],
    );
    const migrationsResult = await sourcePool.query<{ name: string }>(
      'SELECT name FROM runtime.schema_migrations ORDER BY name',
    );
    const migrations = migrationsResult.rows.map((row) => row.name);
    expect(migrations).toContain('078_t3_project_source_knowledge_reset.sql');

    const resetJournalRecord = {
      config: journal,
      backupRoot,
      projectId,
      knowledgeEpoch: 1,
      requestId,
    };
    await appendSourceErasureJournalRecord({ ...resetJournalRecord, phase: 'PREPARED' });
    await appendSourceErasureJournalRecord({ ...resetJournalRecord, phase: 'VERIFIED' });

    const dump = Buffer.alloc(0);
    await writeFile(path.join(backupDirectory, 'database.dump'), dump);
    const integrityTables = Object.fromEntries(
      authoritativeIntegrityTablesForMigrations(migrations).map((table) => [
        table,
        { rows: 0, digest: sha256(Buffer.from('[]')) },
      ]),
    );
    const manifest: BackupManifest = {
      formatVersion: BACKUP_FORMAT_VERSION,
      backupId: randomUUID(),
      createdAt: new Date().toISOString(),
      database: {
        engine: 'postgresql',
        majorVersion: 16,
        dumpFormat: 'custom',
        dumpFile: 'database.dump',
        dumpSha256: sha256(dump),
        migrations,
      },
      assets: { storage: 'local-content-addressed', files: [] },
      contracts: { files: [] },
      integrity: { tables: integrityTables },
      projectKnowledgeEpochs: { [projectId]: 0 },
      configuration: {
        secretsIncluded: false,
        projectionAuthority: 'rebuild-from-canonical',
      },
    };
    await writeFile(path.join(backupDirectory, 'manifest.json'), `${JSON.stringify(manifest)}\n`);

    await expect(
      restoreBackup({
        sourceDatabaseUrl: source.databaseUrl,
        targetDatabaseUrl: target.databaseUrl,
        targetAssetRoot,
        backupDirectory,
        backupRoot,
        toolMode: 'local',
      }),
    ).rejects.toThrow(/Backup knowledge epoch is older than the external reset journal/u);

    const targetPool = target.createPool();
    await expect(
      targetPool.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM information_schema.tables
          WHERE table_schema NOT IN ('pg_catalog', 'information_schema')`,
      ),
    ).resolves.toMatchObject({ rows: [{ count: '0' }] });
    await expect(readFile(path.join(backupDirectory, 'database.dump'))).resolves.toEqual(dump);
    await expect(readFile(path.join(backupDirectory, 'manifest.json'))).resolves.toBeDefined();
    await expect(access(targetAssetRoot)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  }, 60_000);
});
