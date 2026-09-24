import { createHash, randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresAssetKnowledgeResetOwner } from '../../adapters/source-knowledge-reset-postgres/src/index.js';
import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';

const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const hash = (character: string): string => `sha256:${character.repeat(64)}`;

describe('ADR-171 Asset erasure owner', () => {
  let database: Awaited<ReturnType<typeof createIsolatedPostgresTestDatabase>>;
  let adminPool: Pool;
  let executorPool: Pool;

  beforeAll(async () => {
    database = await createIsolatedPostgresTestDatabase();
    adminPool = database.createPool();
    const password = randomUUID();
    await adminPool.query(
      `ALTER ROLE shotgun_erasure_executor LOGIN PASSWORD ${literal(password)}`,
    );
    const connection = new URL(database.databaseUrl);
    connection.username = 'shotgun_erasure_executor';
    connection.password = password;
    executorPool = new Pool({ connectionString: connection.toString(), max: 1 });
    await executorPool.query('SELECT 1');
  });

  afterAll(async () => {
    await executorPool?.end();
    await adminPool?.query('ALTER ROLE shotgun_erasure_executor NOLOGIN PASSWORD NULL');
    await database?.dispose();
  });

  const seedAsset = async (storageKey = `sha256/${randomUUID()}`) => {
    const assetId = randomUUID();
    const contentHash = `sha256:${createHash('sha256').update(storageKey).digest('hex')}`;
    await adminPool.query(
      `INSERT INTO asset.original_assets (asset_id, content_hash, size_bytes, storage_key, created_at)
       VALUES ($1, $2, 18, $3, now())`,
      [assetId, contentHash, storageKey],
    );
    return { assetId, storageKey, contentHash };
  };

  const seedSource = async (
    projectId: string,
    originalAssetId: string,
    options: { readonly receipt?: boolean } = {},
  ) => {
    const sourceId = randomUUID();
    const sourceVersionId = randomUUID();
    await adminPool.query(
      `INSERT INTO asset.sources (source_id, project_id, created_by_actor_id, created_at)
       VALUES ($1, $2, 't3-test', now())`,
      [sourceId, projectId],
    );
    await adminPool.query(
      `INSERT INTO asset.source_versions (
         source_version_id, source_id, version_number, original_asset_id, media_type,
         access_scope, sensitivity, created_at
       ) VALUES ($1, $2, 1, $3, 'text/plain', ARRAY['owner'], 'private', now())`,
      [sourceVersionId, sourceId, originalAssetId],
    );
    if (options.receipt) {
      await adminPool.query(
        `INSERT INTO asset.storage_receipts (
           receipt_id, submission_id, project_id, source_version_id, channel, material_kind,
           original_file_name, asset_reused, version_created, created_at
         ) VALUES ($1, $2, $3, $4, 'direct_text', 'plain_text', NULL, false, true, now())`,
        [randomUUID(), `submission-${randomUUID()}`, projectId, sourceVersionId],
      );
    }
    return { sourceId, sourceVersionId };
  };

  const seedLease = async (input: {
    projectId: string;
    storageKey: string;
    contentHash: string;
    active: boolean;
  }) => {
    const issuedAt = input.active
      ? new Date('2026-09-23T01:00:00.000Z')
      : new Date('2026-08-22T01:00:00.000Z');
    await adminPool.query(
      `INSERT INTO asset.staging_asset_leases (
         lease_id, reference_digest, project_id, draft_id, item_id, principal_id,
         input_kind, storage_key, content_hash, size_bytes, issued_at, expires_at, created_at
       ) VALUES ($1, $2, $3, $4, $5, 't3-test', 'FILE', $6, $7, 18,
                 $8::timestamptz, $8::timestamptz + interval '720 hours', $8::timestamptz)`,
      [
        randomUUID(),
        `sha256:${createHash('sha256').update(randomUUID()).digest('hex')}`,
        input.projectId,
        `draft-${randomUUID()}`,
        `item-${randomUUID()}`,
        input.storageKey,
        input.contentHash,
        issuedAt,
      ],
    );
  };

  const createProject = async (projectId: string) => {
    await adminPool.query(
      `INSERT INTO project_admin.projects (id, name, status, active)
       VALUES ($1, 'T3 Asset fixture', 'ACTIVE', true)`,
      [projectId],
    );
  };

  const beginReset = async (projectId: string) => {
    const requestId = randomUUID();
    await adminPool.query(
      `INSERT INTO project_admin.project_knowledge_epoch (project_id, epoch, state)
       VALUES ($1, 1, 'RESET_PENDING')`,
      [projectId],
    );
    await adminPool.query(
      `INSERT INTO project_admin.project_knowledge_reset_requests (
         request_id, preview_id, project_id, actor_principal_id, project_revision,
         expected_knowledge_epoch, resulting_knowledge_epoch, manifest_digest,
         owner_manifest_digest, preserved_configuration_digest, idempotency_key,
         state, impact_counts
       ) VALUES ($1, $2, $3, 't3-asset-test', 1, 0, 1, $4, $5, $6, $7,
                 'FENCING', '{}'::jsonb)`,
      [requestId, randomUUID(), projectId, hash('c'), hash('d'), hash('e'), randomUUID()],
    );
    return {
      projectId,
      requestId,
      knowledgeEpoch: 1,
      manifestDigest: hash('c') as `sha256:${string}`,
    };
  };

  it('removes selected Source rows and unreferenced CAS roots while retaining shared roots', async () => {
    const projectId = `t3-asset-${randomUUID()}`;
    const otherProjectId = `t3-asset-other-${randomUUID()}`;
    const shared = await seedAsset();
    const selectedOnly = await seedAsset();
    await createProject(projectId);
    await createProject(otherProjectId);
    const selectedSharedSource = await seedSource(projectId, shared.assetId, { receipt: true });
    const selectedOnlySource = await seedSource(projectId, selectedOnly.assetId);
    const otherSource = await seedSource(otherProjectId, shared.assetId);
    await seedLease({
      projectId,
      storageKey: selectedOnly.storageKey,
      contentHash: selectedOnly.contentHash,
      active: false,
    });
    await seedLease({
      projectId: otherProjectId,
      storageKey: shared.storageKey,
      contentHash: shared.contentHash,
      active: true,
    });

    const context = await beginReset(projectId);
    const owner = new PostgresAssetKnowledgeResetOwner(executorPool);
    await owner.fence(context);
    await adminPool.query(
      `UPDATE project_admin.project_knowledge_reset_requests SET state = 'PURGING'
       WHERE project_id = $1 AND request_id = $2`,
      [projectId, context.requestId],
    );
    await owner.purge(context);
    await expect(owner.verify(context)).resolves.toEqual({ verified: true, blockerCodes: [] });

    const selectedRows = await adminPool.query(
      `SELECT
         (SELECT count(*)::text FROM asset.sources WHERE project_id = $1) AS sources,
         (SELECT count(*)::text FROM asset.source_versions AS version
           JOIN asset.sources AS source USING (source_id) WHERE source.project_id = $1) AS versions,
         (SELECT count(*)::text FROM asset.storage_receipts WHERE project_id = $1) AS receipts,
         (SELECT count(*)::text FROM asset.staging_asset_leases WHERE project_id = $1) AS leases,
         (SELECT count(*)::text FROM asset.original_assets WHERE asset_id = $2) AS selected_only_asset,
         (SELECT count(*)::text FROM asset.original_assets WHERE asset_id = $3) AS shared_asset`,
      [projectId, selectedOnly.assetId, shared.assetId],
    );
    expect(selectedRows.rows[0]).toMatchObject({
      sources: '0',
      versions: '0',
      receipts: '0',
      leases: '0',
      selected_only_asset: '0',
      shared_asset: '1',
    });
    await expect(
      adminPool.query('SELECT source_id FROM asset.sources WHERE source_id = ANY($1::uuid[])', [
        [selectedSharedSource.sourceId, selectedOnlySource.sourceId],
      ]),
    ).resolves.toMatchObject({ rowCount: 0 });
    await expect(
      adminPool.query('SELECT source_id FROM asset.sources WHERE source_id = $1', [
        otherSource.sourceId,
      ]),
    ).resolves.toMatchObject({ rowCount: 1 });
  });

  it('blocks until the selected Project staging lease has expired', async () => {
    const projectId = `t3-asset-live-${randomUUID()}`;
    const asset = await seedAsset();
    await createProject(projectId);
    await seedSource(projectId, asset.assetId);
    await seedLease({ ...asset, projectId, active: true });
    const context = await beginReset(projectId);
    const owner = new PostgresAssetKnowledgeResetOwner(executorPool);
    await expect(owner.fence(context)).rejects.toMatchObject({
      blockerCode: 'ACTIVE_JOB_OUTCOME_UNKNOWN',
    });
    await expect(
      adminPool.query(
        'SELECT count(*)::text FROM asset.staging_asset_leases WHERE project_id = $1',
        [projectId],
      ),
    ).resolves.toMatchObject({ rows: [{ count: '1' }] });
  });
});
