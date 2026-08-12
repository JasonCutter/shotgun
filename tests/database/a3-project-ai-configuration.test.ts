import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PostgresProjectAIConfigurationRepository } from '../../adapters/ai-configuration-postgres/src/index.js';
import { PostgresCredentialVaultRepository } from '../../adapters/credential-vault-postgres/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import {
  CredentialVaultService,
  StaticCredentialMasterKeyAuthority,
} from '../../modules/credential-vault/src/index.js';
import {
  initialProviderRegistry,
  ProjectAIConfigurationService,
} from '../../modules/ai-configuration/src/index.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool = createPostgresPool(databaseUrl);
const authority = () =>
  new StaticCredentialMasterKeyAuthority({ key: Buffer.alloc(32, 7), keyVersion: 'v1' });
const ensureProject = async (projectId: string): Promise<void> => {
  await pool.query(
    `INSERT INTO project_admin.projects (id, name, status, active, created_at, updated_at, revision)
     VALUES ($1, $1, 'ACTIVE', true, now(), now(), 1)
     ON CONFLICT (id) DO NOTHING`,
    [projectId],
  );
};

describe('A3 project AI configuration PostgreSQL persistence', () => {
  let vault: CredentialVaultService;
  let preExistingCredentialId: string;

  beforeAll(async () => {
    await migrateUpTo('036_a2_credential_vault.sql', databaseUrl);
    vault = new CredentialVaultService(new PostgresCredentialVaultRepository(pool), authority());
    const preExisting = await vault.create({
      projectId: 'a3-pre-existing-project',
      providerId: 'openai',
      secret: 'a2-secret-before-a3-migration',
      now: '2026-08-12T00:00:00.000Z',
    });
    preExistingCredentialId = preExisting.credentialId;
    await migrateUpTo(undefined, databaseUrl);
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE ai.project_ai_configurations, ai.project_ai_configuration_revisions',
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it('applies additively, preserves A2 credentials, and persists exact configuration history', async () => {
    const projectId = 'a3-project-history';
    await ensureProject(projectId);
    const openai = await vault.create({ projectId, providerId: 'openai', secret: 'openai-secret' });
    const deepseek = await vault.create({
      projectId,
      providerId: 'deepseek',
      secret: 'deepseek-secret',
    });
    const repository = new PostgresProjectAIConfigurationRepository(pool);
    const service = new ProjectAIConfigurationService(initialProviderRegistry(), repository, vault);

    const first = await service.save({
      projectId,
      expectedRevision: 0,
      activeProviderId: 'openai',
      activeModelId: 'gpt-5.6-luna',
      credentialId: openai.credentialId,
      credentialRevision: openai.credentialRevision,
      updatedBy: 'owner',
      now: '2026-08-12T00:01:00.000Z',
    });
    const second = await service.save({
      projectId,
      expectedRevision: 1,
      activeProviderId: 'deepseek',
      activeModelId: 'deepseek-v4-flash',
      credentialId: deepseek.credentialId,
      credentialRevision: deepseek.credentialRevision,
      updatedBy: 'owner',
      now: '2026-08-12T00:02:00.000Z',
    });

    expect(await service.getRevision(projectId, 1)).toEqual(first);
    expect(await service.getCurrent(projectId)).toEqual(second);
    expect(
      await pool.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM ai.project_ai_configuration_revisions WHERE project_id = $1',
        [projectId],
      ),
    ).toMatchObject({ rows: [{ count: '2' }] });

    const encrypted = await pool.query<{ encrypted_secret: string }>(
      'SELECT encrypted_secret::text FROM ai.provider_credentials WHERE credential_id = $1',
      [openai.credentialId],
    );
    expect(encrypted.rows[0]?.encrypted_secret).not.toContain('openai-secret');
    expect(
      await pool.query<{ credential_id: string }>(
        'SELECT credential_id::text FROM ai.provider_credentials WHERE credential_id = $1 AND credential_revision = 1',
        [preExistingCredentialId],
      ),
    ).toMatchObject({ rows: [{ credential_id: preExistingCredentialId }] });
  });

  it('fails closed on concurrent stale writes and keeps one canonical current revision', async () => {
    const projectId = 'a3-project-cas';
    await ensureProject(projectId);
    const credential = await vault.create({
      projectId,
      providerId: 'openai',
      secret: 'cas-secret',
    });
    const service = new ProjectAIConfigurationService(
      initialProviderRegistry(),
      new PostgresProjectAIConfigurationRepository(pool),
      vault,
    );
    await service.save({
      projectId,
      expectedRevision: 0,
      activeProviderId: 'openai',
      activeModelId: 'gpt-5.6-luna',
      credentialId: credential.credentialId,
      credentialRevision: credential.credentialRevision,
      updatedBy: 'owner',
    });

    const writes = await Promise.allSettled([
      service.save({
        projectId,
        expectedRevision: 1,
        activeProviderId: 'openai',
        activeModelId: 'gpt-5.6-luna',
        credentialId: credential.credentialId,
        credentialRevision: credential.credentialRevision,
        updatedBy: 'owner-a',
      }),
      service.save({
        projectId,
        expectedRevision: 1,
        activeProviderId: 'openai',
        activeModelId: 'gpt-5.6-luna',
        credentialId: credential.credentialId,
        credentialRevision: credential.credentialRevision,
        updatedBy: 'owner-b',
      }),
    ]);

    expect(writes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(writes.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await service.getCurrent(projectId)).toMatchObject({
      projectId,
      aiConfigurationRevision: 2,
    });
  });

  it('rejects wrong ownership, wrong provider, and revoked credentials, and protects history', async () => {
    const projectId = 'a3-project-security';
    await ensureProject(projectId);
    const openai = await vault.create({
      projectId,
      providerId: 'openai',
      secret: 'security-secret',
    });
    const otherProject = await vault.create({
      projectId: 'a3-other-project',
      providerId: 'openai',
      secret: 'other-secret',
    });
    const revoked = await vault.create({
      projectId,
      providerId: 'openai',
      secret: 'revoked-secret',
    });
    await vault.revoke({ ...revoked });
    const repository = new PostgresProjectAIConfigurationRepository(pool);
    const service = new ProjectAIConfigurationService(initialProviderRegistry(), repository, vault);

    await expect(
      service.save({
        projectId,
        expectedRevision: 0,
        activeProviderId: 'openai',
        activeModelId: 'gpt-5.6-luna',
        credentialId: otherProject.credentialId,
        credentialRevision: otherProject.credentialRevision,
        updatedBy: 'owner',
      }),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_NOT_FOUND' });
    await expect(
      service.save({
        projectId,
        expectedRevision: 0,
        activeProviderId: 'deepseek',
        activeModelId: 'deepseek-v4-flash',
        credentialId: openai.credentialId,
        credentialRevision: openai.credentialRevision,
        updatedBy: 'owner',
      }),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_NOT_FOUND' });
    await expect(
      service.save({
        projectId,
        expectedRevision: 0,
        activeProviderId: 'openai',
        activeModelId: 'gpt-5.6-luna',
        credentialId: revoked.credentialId,
        credentialRevision: revoked.credentialRevision,
        updatedBy: 'owner',
      }),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_UNAVAILABLE' });

    await service.save({
      projectId,
      expectedRevision: 0,
      activeProviderId: 'openai',
      activeModelId: 'gpt-5.6-luna',
      credentialId: openai.credentialId,
      credentialRevision: openai.credentialRevision,
      updatedBy: 'owner',
    });
    await expect(
      pool.query(
        `UPDATE ai.project_ai_configuration_revisions
         SET updated_by = 'tampered'
         WHERE project_id = $1 AND ai_configuration_revision = 1`,
        [projectId],
      ),
    ).rejects.toThrow(/append-only|immutable/);
    await expect(
      pool.query(
        `UPDATE ai.project_ai_configurations
         SET ai_configuration_revision = 3
         WHERE project_id = $1`,
        [projectId],
      ),
    ).rejects.toThrow(/identity or revision is invalid/);
  });
});
