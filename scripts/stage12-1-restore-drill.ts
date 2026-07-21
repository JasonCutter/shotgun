import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import 'dotenv/config';
import { Client } from 'pg';

import { LocalAssetStorage } from '../adapters/asset-storage-local/src/index.js';
import { createPostgresPool } from '../adapters/postgres/src/index.js';
import { PostgresCanonicalKnowledgeRepository } from '../adapters/postgres-stage6/src/index.js';
import { PostgresSearchProjectionRepository } from '../adapters/postgres-stage7/src/index.js';
import { PostgresKnowledgeModelRepository } from '../adapters/postgres-stage9/src/index.js';
import { PostgresCompiledTruthRepository } from '../adapters/postgres-stage10/src/index.js';
import { createApplication } from '../assemblies/shotgun-app/src/server.js';
import {
  createBackup,
  createIsolatedRestoreDatabase,
  dropIsolatedRestoreDatabase,
  restoreBackup,
  type BackupToolMode,
} from './backup-restore.js';
import {
  canonicalSnapshotDigest,
  type CanonicalClaim,
  type CanonicalCommitResult,
  type CanonicalCommittedPayload,
  type CanonicalHistoryEvent,
} from '../packages/contracts/src/index.js';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationDirectory = path.join(rootDirectory, 'db', 'migrations');
const projectId = 'stage12-1-clean-restore-drill';
const createdAt = '2026-07-21T00:00:00.000Z';

const requiredEnvironment = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
};

const withClient = async <T>(
  databaseUrl: string,
  action: (client: Client) => Promise<T>,
): Promise<T> => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await action(client);
  } finally {
    await client.end();
  }
};

const applyMigrations = async (databaseUrl: string): Promise<void> => {
  const files = (await readdir(migrationDirectory)).filter((file) => file.endsWith('.sql')).sort();
  await withClient(databaseUrl, async (client) => {
    await client.query('CREATE SCHEMA runtime');
    await client.query(`
      CREATE TABLE runtime.schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    for (const file of files) {
      await client.query('BEGIN');
      try {
        await client.query(await readFile(path.join(migrationDirectory, file), 'utf8'));
        await client.query('INSERT INTO runtime.schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  });
};

type DrillFixture = {
  readonly storageKey: string;
  readonly assetBytes: Buffer;
  readonly outboxId: string;
  readonly claimId: string;
  readonly snapshotDigest: string;
};

const seedAuthoritativeData = async (
  databaseUrl: string,
  assetRoot: string,
): Promise<DrillFixture> => {
  const assetBytes = Buffer.from('Stage 12.1 clean restore original asset.\n', 'utf8');
  const contentHash = `sha256:${createHash('sha256').update(assetBytes).digest('hex')}`;
  const storageKey = await new LocalAssetStorage(assetRoot).put(contentHash, assetBytes);
  const assetId = randomUUID();
  const sourceId = randomUUID();
  const sourceVersionId = randomUUID();
  const commitId = randomUUID();
  const manifestId = commitId;
  const changeSetId = randomUUID();
  const claimId = `claim:${manifestId}`;
  const revisionId = `revision:${manifestId}`;
  const historyEventId = `history:${manifestId}`;
  const outboxId = `outbox:${manifestId}`;
  const claim: CanonicalClaim = {
    claimId,
    projectId,
    revisionNumber: 1,
    claimText: 'Canonical truth survives a clean Backup and Restore drill.',
    sourceVersionId,
    evidenceIds: [`evidence:${projectId}`],
    createdFromManifestId: manifestId,
    accessScope: ['owner'],
    sensitivity: 'private',
    createdAt,
  };
  const snapshotDigest = canonicalSnapshotDigest(projectId, 1, [
    {
      claimId,
      text: claim.claimText,
      revisionNumber: 1,
      evidenceIds: claim.evidenceIds,
    },
  ]);
  const commit: CanonicalCommitResult = {
    commitId,
    projectId,
    manifestId,
    manifestDigest: `sha256:${'1'.repeat(64)}`,
    changeSetId,
    operation: 'ADD_CLAIM',
    status: 'COMMITTED',
    beforeVersion: 0,
    afterVersion: 1,
    snapshotDigest,
    claimId,
    revisionId,
    historyEventId,
    outboxId,
    committedAt: createdAt,
  };
  const history: CanonicalHistoryEvent = {
    historyEventId,
    projectId,
    commitId,
    manifestId,
    changeSetId,
    eventType: 'CANONICAL_CLAIM_ADDED',
    beforeVersion: 0,
    afterVersion: 1,
    claimId,
    reason: 'Stage 12.1 clean restore drill fixture.',
    actor: { type: 'user', id: 'owner' },
    createdAt,
  };
  const payload: CanonicalCommittedPayload = {
    commitId,
    manifestId,
    changeSetId,
    operation: 'ADD_CLAIM',
    status: 'COMMITTED',
    canonicalVersion: 1,
    snapshotDigest,
    claimId,
    actorId: 'owner',
    accessScope: ['owner'],
    sensitivity: 'private',
  };

  await withClient(databaseUrl, async (client) => {
    await client.query('BEGIN');
    try {
      await client.query(
        `INSERT INTO asset.original_assets
           (asset_id, content_hash, size_bytes, storage_key, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [assetId, contentHash, assetBytes.byteLength, storageKey, createdAt],
      );
      await client.query(
        `INSERT INTO asset.sources (source_id, project_id, created_by_actor_id, created_at)
         VALUES ($1, $2, 'owner', $3)`,
        [sourceId, projectId, createdAt],
      );
      await client.query(
        `INSERT INTO asset.source_versions (
           source_version_id, source_id, version_number, original_asset_id, media_type,
           access_scope, sensitivity, created_at
         ) VALUES ($1, $2, 1, $3, 'text/plain', ARRAY['owner'], 'private', $4)`,
        [sourceVersionId, sourceId, assetId, createdAt],
      );
      await client.query(
        `INSERT INTO asset.storage_receipts (
           receipt_id, submission_id, project_id, source_version_id, channel,
           material_kind, asset_reused, version_created, created_at
         ) VALUES ($1, 'restore-drill', $2, $3, 'direct_text', 'plain_text', false, true, $4)`,
        [randomUUID(), projectId, sourceVersionId, createdAt],
      );
      await client.query(
        `INSERT INTO canonical.project_state (project_id, version, snapshot_digest, updated_at)
         VALUES ($1, 1, $2, $3)`,
        [projectId, snapshotDigest, createdAt],
      );
      await client.query(
        `INSERT INTO canonical.claims (
           claim_id, project_id, source_version_id, manifest_id, claim_json, created_at
         ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
        [claimId, projectId, sourceVersionId, manifestId, JSON.stringify(claim), createdAt],
      );
      await client.query(
        `INSERT INTO canonical.commits (
           commit_id, project_id, manifest_id, manifest_digest, change_set_id,
           result_json, committed_at
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
        [
          commitId,
          projectId,
          manifestId,
          commit.manifestDigest,
          changeSetId,
          JSON.stringify(commit),
          createdAt,
        ],
      );
      await client.query(
        `INSERT INTO canonical.revisions (
           revision_id, project_id, commit_id, revision_json, created_at
         ) VALUES ($1, $2, $3, $4::jsonb, $5)`,
        [revisionId, projectId, commitId, JSON.stringify({ revisionId }), createdAt],
      );
      await client.query(
        `INSERT INTO canonical.history_events (
           history_event_id, project_id, commit_id, event_json, created_at
         ) VALUES ($1, $2, $3, $4::jsonb, $5)`,
        [historyEventId, projectId, commitId, JSON.stringify(history), createdAt],
      );
      await client.query(
        `INSERT INTO canonical.outbox (
           outbox_id, project_id, aggregate_id, event_type, payload_json, status,
           attempts, available_at
         ) VALUES ($1, $2, $3, 'CanonicalCommitted', $4::jsonb, 'pending', 0, $5)`,
        [outboxId, projectId, commitId, JSON.stringify(payload), createdAt],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
  return { storageKey, assetBytes, outboxId, claimId, snapshotDigest };
};

type ProjectionEvidence = {
  readonly outboxStatus: string | undefined;
  readonly searchStatus: string | undefined;
  readonly compiledVersion: number | undefined;
  readonly searchClaimIds: readonly string[];
};

const startAndVerifyRecovery = async (
  databaseUrl: string,
  fixture: DrillFixture,
): Promise<ProjectionEvidence> => {
  const pool = createPostgresPool(databaseUrl);
  const canonical = new PostgresCanonicalKnowledgeRepository(pool);
  const search = new PostgresSearchProjectionRepository(pool);
  const compiled = new PostgresCompiledTruthRepository(pool);
  let app: Awaited<ReturnType<typeof createApplication>> | undefined;
  try {
    app = await createApplication({
      canonicalKnowledgeRepository: canonical,
      searchProjectionRepository: search,
      knowledgeModelRepository: new PostgresKnowledgeModelRepository(pool),
      compiledTruthRepository: compiled,
      canonicalProjectionRecoveryIntervalMs: false,
      closeResources: async () => pool.end(),
    });
    const outbox = await canonical.findOutbox(projectId, fixture.outboxId);
    const watermark = await search.findWatermark(projectId);
    const projection = await compiled.findProjection(projectId);
    const results = await search.search(projectId, 'survives', 10, ['owner']);
    if (
      outbox?.status !== 'published' ||
      watermark?.status !== 'READY' ||
      watermark.snapshotDigest !== fixture.snapshotDigest ||
      projection?.canonicalVersion !== 1 ||
      results.map((result) => result.claimId).join(',') !== fixture.claimId
    ) {
      throw new Error('Canonical Projection recovery did not reach the expected READY state.');
    }
    return {
      outboxStatus: outbox.status,
      searchStatus: watermark.status,
      compiledVersion: projection.canonicalVersion,
      searchClaimIds: results.map((result) => result.claimId),
    };
  } finally {
    if (app) await app.server.close();
    else await pool.end();
  }
};

const assertRestoredAsset = async (assetRoot: string, fixture: DrillFixture): Promise<void> => {
  const restored = await new LocalAssetStorage(assetRoot).read(fixture.storageKey);
  if (!Buffer.from(restored).equals(fixture.assetBytes)) {
    throw new Error('Restored Original Asset bytes do not match the source bytes.');
  }
};

const main = async (): Promise<void> => {
  const startedAt = Date.now();
  const adminDatabaseUrl = requiredEnvironment('DATABASE_URL');
  const mode = (process.env.SHOTGUN_PG_TOOL_MODE ?? 'docker-compose') as BackupToolMode;
  if (!['local', 'docker-compose'].includes(mode)) {
    throw new Error('SHOTGUN_PG_TOOL_MODE must be local or docker-compose.');
  }
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'shotgun-restore-drill-'));
  const sourceAssetRoot = path.join(temporaryRoot, 'source-assets');
  const targetAssetRoot = path.join(temporaryRoot, 'target-assets');
  const backupDirectory = path.join(temporaryRoot, 'backup');
  await mkdir(sourceAssetRoot, { recursive: true });
  let sourceDatabase: Awaited<ReturnType<typeof createIsolatedRestoreDatabase>> | undefined;
  let targetDatabase: Awaited<ReturnType<typeof createIsolatedRestoreDatabase>> | undefined;
  let operationFailure: unknown;
  try {
    sourceDatabase = await createIsolatedRestoreDatabase(adminDatabaseUrl);
    targetDatabase = await createIsolatedRestoreDatabase(adminDatabaseUrl);
    await applyMigrations(sourceDatabase.databaseUrl);
    const fixture = await seedAuthoritativeData(sourceDatabase.databaseUrl, sourceAssetRoot);
    await startAndVerifyRecovery(sourceDatabase.databaseUrl, fixture);
    const manifest = await createBackup({
      databaseUrl: sourceDatabase.databaseUrl,
      assetRoot: sourceAssetRoot,
      outputDirectory: backupDirectory,
      toolMode: mode,
    });
    await restoreBackup({
      sourceDatabaseUrl: sourceDatabase.databaseUrl,
      targetDatabaseUrl: targetDatabase.databaseUrl,
      targetAssetRoot,
      backupDirectory,
      toolMode: mode,
    });
    await assertRestoredAsset(targetAssetRoot, fixture);
    await withClient(targetDatabase.databaseUrl, async (client) => {
      const result = await client.query<{ rows: string }>(`
        SELECT (
          (SELECT count(*) FROM projection.discovery_inferences) +
          (SELECT count(*) FROM projection.compiled_truth) +
          (SELECT count(*) FROM projection.search_documents) +
          (SELECT count(*) FROM projection.watermarks)
        )::text AS rows
      `);
      if (result.rows[0]?.rows !== '0') {
        throw new Error('Clean Restore retained non-authoritative Projection rows.');
      }
    });
    const recovered = await startAndVerifyRecovery(targetDatabase.databaseUrl, fixture);
    console.log(
      JSON.stringify({
        status: 'PASS',
        backupFormat: manifest.formatVersion,
        migrations: manifest.database.migrations.length,
        originalAssets: manifest.assets.files.length,
        contracts: manifest.contracts.files.length,
        canonicalProjects: manifest.integrity.tables['canonical.project_state']?.rows,
        recovered,
        durationMs: Date.now() - startedAt,
      }),
    );
  } catch (error) {
    operationFailure = error;
  }
  const cleanup = await Promise.allSettled([
    ...(targetDatabase
      ? [dropIsolatedRestoreDatabase(adminDatabaseUrl, targetDatabase.databaseName)]
      : []),
    ...(sourceDatabase
      ? [dropIsolatedRestoreDatabase(adminDatabaseUrl, sourceDatabase.databaseName)]
      : []),
    rm(temporaryRoot, { recursive: true, force: true }),
  ]);
  const cleanupFailures = cleanup.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (cleanupFailures.length > 0) {
    throw new AggregateError(
      [
        ...(operationFailure ? [operationFailure] : []),
        ...cleanupFailures.map((failure) => failure.reason),
      ],
      'Restore drill execution or cleanup failed.',
    );
  }
  if (operationFailure) throw operationFailure;
};

await main();
