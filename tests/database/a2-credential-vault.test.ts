import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PostgresCredentialVaultRepository } from '../../adapters/credential-vault-postgres/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import {
  CredentialVaultService,
  StaticCredentialMasterKeyAuthority,
  type CredentialEnvelope,
  type StoredCredentialRevision,
} from '../../modules/credential-vault/src/index.js';
import { migrateUpTo } from '../../scripts/database.js';

import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool = createPostgresPool(databaseUrl);
const authority = () =>
  new StaticCredentialMasterKeyAuthority({ key: Buffer.alloc(32, 9), keyVersion: 'v1' });

describe.runIf(pool)('A2 credential vault PostgreSQL persistence', () => {
  beforeAll(async () => {
    await migrateUpTo(undefined, databaseUrl);
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE ai.provider_credentials');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('preserves encrypted revisions, ownership, and exact revision resolution', async () => {
    const vault = new CredentialVaultService(
      new PostgresCredentialVaultRepository(pool),
      authority(),
    );
    const first = await vault.create({
      projectId: 'project-a',
      providerId: 'openai',
      secret: 'postgres-secret',
      now: '2026-08-12T00:00:00.000Z',
    });
    const stored = await pool.query<{ encrypted_secret: string; lifecycle_state: string }>(
      'SELECT encrypted_secret::text, lifecycle_state FROM ai.provider_credentials WHERE credential_id = $1 AND credential_revision = 1',
      [first.credentialId],
    );
    expect(stored.rows[0]?.encrypted_secret).not.toContain('postgres-secret');
    expect(stored.rows[0]?.lifecycle_state).toBe('active');

    const second = await vault.replace({
      projectId: 'project-a',
      providerId: 'openai',
      credentialId: first.credentialId,
      expectedRevision: 1,
      secret: 'postgres-secret-rotated',
      now: '2026-08-12T00:01:00.000Z',
    });
    await expect(
      vault.withCredential({ ...first }, async () => ({ status: 'FAILED' as const })),
    ).rejects.toMatchObject({ code: 'AI_CAPABILITY_UNAVAILABLE' });
    await expect(
      vault.withCredential({ ...second }, async (secret) => {
        expect(Buffer.from(secret).toString('utf8')).toBe('postgres-secret-rotated');
        return { status: 'SUCCEEDED' };
      }),
    ).resolves.toEqual({ status: 'SUCCEEDED' });
    await expect(
      vault.withCredential({ ...second, projectId: 'project-b' }, async () => ({
        status: 'FAILED' as const,
      })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('recovers a credential write outcome by non-secret client request identity', async () => {
    const vault = new CredentialVaultService(
      new PostgresCredentialVaultRepository(pool),
      authority(),
    );
    const created = await vault.create({
      projectId: 'project-a',
      providerId: 'openai',
      secret: 'write-secret',
      clientRequestId: 'credential-write-create-1',
    });
    const replayed = await vault.create({
      projectId: 'project-a',
      providerId: 'openai',
      secret: 'must-not-be-persisted-or-written',
      clientRequestId: 'credential-write-create-1',
    });
    expect(replayed).toEqual(created);
    expect(
      await vault.getWriteOutcome({
        projectId: 'project-a',
        clientRequestId: 'credential-write-create-1',
        binding: { operation: 'CREATE', providerId: 'openai' },
      }),
    ).toEqual(created);

    const persisted = await pool.query<{ client_request_id: string; encrypted_secret: string }>(
      `SELECT client_request_id, encrypted_secret::text
       FROM ai.provider_credentials
       WHERE credential_id = $1 AND credential_revision = 1`,
      [created.credentialId],
    );
    expect(persisted.rows[0]?.client_request_id).toBe('credential-write-create-1');
    expect(persisted.rows[0]?.encrypted_secret).not.toContain('write-secret');
    expect(persisted.rows[0]?.encrypted_secret).not.toContain('must-not-be-persisted-or-written');
  });

  it('fails closed for a recovered request identity with another provider or operation', async () => {
    const vault = new CredentialVaultService(
      new PostgresCredentialVaultRepository(pool),
      authority(),
    );
    const created = await vault.create({
      projectId: 'project-a',
      providerId: 'deepseek',
      secret: 'deepseek-secret',
      clientRequestId: 'semantic-request-id',
    });
    await expect(
      vault.create({
        projectId: 'project-a',
        providerId: 'openai',
        secret: 'openai-secret',
        clientRequestId: 'semantic-request-id',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      vault.replace({
        projectId: 'project-a',
        providerId: 'deepseek',
        credentialId: created.credentialId,
        expectedRevision: created.credentialRevision,
        secret: 'replace-secret',
        clientRequestId: 'semantic-request-id',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const replaced = await vault.replace({
      projectId: 'project-a',
      providerId: 'deepseek',
      credentialId: created.credentialId,
      expectedRevision: created.credentialRevision,
      secret: 'replace-secret',
      clientRequestId: 'semantic-replace-id',
    });
    await expect(
      vault.replace({
        projectId: 'project-a',
        providerId: 'deepseek',
        credentialId: created.credentialId,
        expectedRevision: created.credentialRevision,
        secret: 'must-not-write-a-second-secret',
        clientRequestId: 'semantic-replace-id',
      }),
    ).resolves.toEqual(replaced);
  });

  it('rolls back replace when the next revision insert loses a request-identity conflict', async () => {
    const repository = new PostgresCredentialVaultRepository(pool);
    const vault = new CredentialVaultService(repository, authority());
    const active = await vault.create({
      projectId: 'project-a',
      providerId: 'deepseek',
      secret: 'active-secret',
    });
    const conflicting = await vault.create({
      projectId: 'project-a',
      providerId: 'openai',
      secret: 'conflicting-secret',
      clientRequestId: 'replace-race-request-id',
    });
    const source = await pool.query<{
      encrypted_secret: CredentialEnvelope;
      encryption_version: 'aes-256-gcm:v1';
      key_version: string;
    }>(
      `SELECT encrypted_secret, encryption_version, key_version
       FROM ai.provider_credentials
       WHERE credential_id = $1 AND credential_revision = 1`,
      [conflicting.credentialId],
    );
    const next: StoredCredentialRevision = {
      credentialId: active.credentialId,
      projectId: active.projectId,
      providerId: active.providerId,
      encryptedSecret: source.rows[0]!.encrypted_secret,
      encryptionVersion: source.rows[0]!.encryption_version,
      keyVersion: source.rows[0]!.key_version,
      credentialRevision: 2,
      lifecycleState: 'active',
      clientRequestId: 'replace-race-request-id',
      clientRequestOperation: 'REPLACE',
      clientRequestProviderId: active.providerId,
      clientRequestCredentialId: active.credentialId,
      clientRequestExpectedRevision: 1,
      createdAt: '2026-08-12T00:01:00.000Z',
      updatedAt: '2026-08-12T00:01:00.000Z',
    };

    await expect(
      repository.advanceRevision({
        projectId: active.projectId,
        providerId: active.providerId,
        credentialId: active.credentialId,
        expectedRevision: 1,
        next,
      }),
    ).resolves.toBe('CONFLICT');
    await expect(repository.findExact({ ...active })).resolves.toMatchObject({
      lifecycleState: 'active',
    });
    await expect(
      repository.findExact({ ...active, credentialRevision: 2 }),
    ).resolves.toBeUndefined();
  });

  it('keeps the revision history append-only and allows lifecycle state changes only', async () => {
    const vault = new CredentialVaultService(
      new PostgresCredentialVaultRepository(pool),
      authority(),
    );
    const created = await vault.create({
      projectId: 'project-a',
      providerId: 'gemini',
      secret: 'secret',
    });

    await expect(
      pool.query(
        `UPDATE ai.provider_credentials
         SET encrypted_secret = jsonb_set(encrypted_secret, '{ciphertext}', '"tampered"')
         WHERE credential_id = $1 AND credential_revision = 1`,
        [created.credentialId],
      ),
    ).rejects.toThrow(/immutable/);
    await expect(
      pool.query('DELETE FROM ai.provider_credentials WHERE credential_id = $1', [
        created.credentialId,
      ]),
    ).rejects.toThrow(/append-only/);

    await vault.remove({ ...created });
    expect(
      await pool.query<{ lifecycle_state: string }>(
        'SELECT lifecycle_state FROM ai.provider_credentials WHERE credential_id = $1 AND credential_revision = 1',
        [created.credentialId],
      ),
    ).toMatchObject({ rows: [{ lifecycle_state: 'removed' }] });
  });
});
