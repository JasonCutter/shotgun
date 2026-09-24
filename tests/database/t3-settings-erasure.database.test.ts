import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  PostgresKnowledgeResetPersistence,
  PostgresSettingsKnowledgeResetOwner,
} from '../../adapters/source-knowledge-reset-postgres/src/index.js';
import type { KnowledgeResetOwnerContext } from '../../modules/source-knowledge-reset/src/index.js';
import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';

const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const hash = (character: string): string => `sha256:${character.repeat(64)}`;

describe('ADR-171 Settings erasure owner', () => {
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

  const createProject = async (projectId: string) =>
    adminPool.query(
      `INSERT INTO project_admin.projects (id, name, status, active)
       VALUES ($1, 'T3 Settings fixture', 'ACTIVE', true)`,
      [projectId],
    );

  const addSource = async (projectId: string) => {
    const sourceId = randomUUID();
    const versionId = randomUUID();
    const assetId = randomUUID();
    const now = new Date().toISOString();
    const contentHash = `sha256:${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`;
    await adminPool.query(
      `INSERT INTO asset.original_assets (asset_id, content_hash, size_bytes, storage_key, created_at)
       VALUES ($1, $2, 10, $3, $4)`,
      [assetId, contentHash, `t3-settings/${assetId}`, now],
    );
    await adminPool.query(
      `INSERT INTO asset.sources (source_id, project_id, created_by_actor_id, created_at)
       VALUES ($1, $2, 't3-settings-test', $3)`,
      [sourceId, projectId, now],
    );
    await adminPool.query(
      `INSERT INTO asset.source_versions (
         source_version_id, source_id, version_number, original_asset_id,
         media_type, access_scope, sensitivity, created_at
       ) VALUES ($1, $2, 1, $3, 'text/plain', ARRAY['project:owner'], 'private', $4)`,
      [versionId, sourceId, assetId, now],
    );
    return { sourceId, versionId };
  };

  const createReset = async (projectId: string): Promise<KnowledgeResetOwnerContext> => {
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
       ) VALUES ($1, $2, $3, 't3-settings-test', 1, 0, 1, $4, $5, $6, $7,
                 'FENCING', '{}'::jsonb)`,
      [requestId, randomUUID(), projectId, hash('b'), hash('c'), hash('d'), randomUUID()],
    );
    return {
      projectId,
      requestId,
      knowledgeEpoch: 1,
      manifestDigest: hash('b') as `sha256:${string}`,
    };
  };

  const setState = async (context: KnowledgeResetOwnerContext, state: string) => {
    await executorPool.query(
      'SELECT project_admin.t3_set_reset_execution_state($1, $2::uuid, $3, $4::text[])',
      [context.projectId, context.requestId, state, []],
    );
  };

  it('removes Source resource settings while preserving Project settings and privacy proposals', async () => {
    const projectId = `t3-settings-${randomUUID()}`;
    const otherProjectId = `${projectId}-other`;
    await createProject(projectId);
    await createProject(otherProjectId);
    const selected = await addSource(projectId);
    const other = await addSource(otherProjectId);
    await adminPool.query(
      `INSERT INTO settings.resource_settings (resource_id, key, value, updated_at)
       VALUES ($1, 'private.notes', '{"canary":"T3_SOURCE_RESOURCE_SETTING"}'::jsonb, now()),
              ($2, 'private.notes', '{"note":"other project"}'::jsonb, now())`,
      [selected.sourceId, other.sourceId],
    );
    await adminPool.query(
      `INSERT INTO settings.project_settings (project_id, key, value, category)
       VALUES ($1, 'privacy.externalTransferAllowed', 'false'::jsonb, 'privacy')`,
      [projectId],
    );
    await adminPool.query(
      `INSERT INTO settings.settings_review_proposals (
         proposal_id, project_id, resource_id, directive_type, description, status, payload
       ) VALUES ($1, $2, 'setting/privacy.externalTransferAllowed',
         'PRIVACY_EXTERNAL_TRANSFER', 'Review provider transfer setting', 'PROPOSED',
         '{"settings":{"privacy.externalTransferAllowed":false}}'::jsonb)`,
      [`proposal-${randomUUID()}`, projectId],
    );
    const resetPersistence = new PostgresKnowledgeResetPersistence(adminPool);
    const preservedConfigurationBefore =
      await resetPersistence.fingerprintPreservedProjectConfiguration(projectId);
    const context = await createReset(projectId);
    const owner = new PostgresSettingsKnowledgeResetOwner(executorPool);
    const impact = await adminPool.query<{
      impact: { sourceDerivedRecordCount: number; unclassifiedRecordCount: number };
    }>('SELECT settings.t3_project_settings_impact($1) AS impact', [projectId]);
    expect(impact.rows[0]?.impact).toMatchObject({
      sourceDerivedRecordCount: 1,
      unclassifiedRecordCount: 0,
    });

    await owner.fence(context);
    await expect(
      adminPool.query(
        `UPDATE settings.resource_settings SET value = '{}'::jsonb
         WHERE resource_id = $1 AND key = 'private.notes'`,
        [selected.sourceId],
      ),
    ).rejects.toMatchObject({ constraint: 'project_knowledge_reset_write_fence' });
    await setState(context, 'PURGING');
    await adminPool.query('DELETE FROM asset.source_versions WHERE source_id = $1', [
      selected.sourceId,
    ]);
    await adminPool.query('DELETE FROM asset.sources WHERE source_id = $1', [selected.sourceId]);
    const persistedSnapshot = await adminPool.query<{ snapshot: { fingerprint: string } }>(
      `SELECT step_checkpoints->'t3SettingsFenceSnapshot' AS snapshot
       FROM project_admin.project_knowledge_reset_requests WHERE request_id = $1`,
      [context.requestId],
    );
    const currentImpact = await adminPool.query<{ impact: { fingerprint: string } }>(
      'SELECT settings.t3_project_settings_impact($1) AS impact',
      [projectId],
    );
    expect(currentImpact.rows[0]?.impact.fingerprint).toBe(
      persistedSnapshot.rows[0]?.snapshot.fingerprint,
    );
    expect(persistedSnapshot.rows[0]?.snapshot).toMatchObject({ recordCount: 1 });
    await owner.purge(context);
    await owner.purge(context);
    await setState(context, 'VERIFYING');
    await expect(owner.verify(context)).resolves.toEqual({ verified: true, blockerCodes: [] });

    const resourceRows = await adminPool.query<{ resource_id: string }>(
      'SELECT resource_id FROM settings.resource_settings ORDER BY resource_id',
    );
    expect(resourceRows.rows.map((row) => row.resource_id)).toEqual([other.sourceId]);
    await expect(
      adminPool.query('SELECT value FROM settings.project_settings WHERE project_id = $1', [
        projectId,
      ]),
    ).resolves.toMatchObject({ rows: [{ value: false }] });
    await expect(
      adminPool.query(
        `SELECT count(*)::text AS count FROM settings.settings_review_proposals
         WHERE project_id = $1 AND directive_type = 'PRIVACY_EXTERNAL_TRANSFER'`,
        [projectId],
      ),
    ).resolves.toMatchObject({ rows: [{ count: '1' }] });
    await expect(
      resetPersistence.fingerprintPreservedProjectConfiguration(projectId),
    ).resolves.toBe(preservedConfigurationBefore);
  });

  it('blocks unscoped Resource Settings and Source-linked policy proposals', async () => {
    const projectId = `t3-settings-unknown-${randomUUID()}`;
    await createProject(projectId);
    await addSource(projectId);
    await adminPool.query(
      `INSERT INTO settings.resource_settings (resource_id, key, value)
       VALUES ('unmapped-resource', 'key', '{"note":"unknown owner"}'::jsonb)`,
    );
    const context = await createReset(projectId);
    const owner = new PostgresSettingsKnowledgeResetOwner(executorPool);
    await expect(owner.fence(context)).rejects.toMatchObject({
      blockerCode: 'UNCLASSIFIED_CONTENT',
    });

    const proposalProjectId = `t3-settings-proposal-${randomUUID()}`;
    await createProject(proposalProjectId);
    const proposalSource = await addSource(proposalProjectId);
    await adminPool.query(
      `INSERT INTO settings.settings_review_proposals (
         proposal_id, project_id, resource_id, directive_type, description, status, payload
       ) VALUES ($1, $2, $3, 'PRIVACY_EXTERNAL_TRANSFER', 'Review', 'PROPOSED', $4::jsonb)`,
      [
        `proposal-${randomUUID()}`,
        proposalProjectId,
        'setting/privacy',
        JSON.stringify({ sourceId: proposalSource.sourceId }),
      ],
    );
    const proposalContext = await createReset(proposalProjectId);
    await expect(owner.fence(proposalContext)).rejects.toMatchObject({
      blockerCode: 'UNCLASSIFIED_CONTENT',
    });
  });
});
