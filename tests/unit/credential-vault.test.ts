import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  CredentialVaultService,
  EnvironmentCredentialMasterKeyAuthority,
  StaticCredentialMasterKeyAuthority,
} from '../../modules/credential-vault/src/index.js';
import { InMemoryCredentialVaultRepository } from '../../adapters/credential-vault-in-memory/src/index.js';

const keyAuthority = (key = randomBytes(32), keyVersion = 'v1') =>
  new StaticCredentialMasterKeyAuthority({ key, keyVersion });

const scopeFor = (metadata: {
  readonly credentialId: string;
  readonly credentialRevision: number;
  readonly projectId: string;
  readonly providerId: string;
}) => ({
  credentialId: metadata.credentialId,
  credentialRevision: metadata.credentialRevision,
  projectId: metadata.projectId,
  providerId: metadata.providerId,
});

describe('A2 credential vault security boundary', () => {
  it('round-trips only inside a bounded callback and zeroes the callback buffer afterwards', async () => {
    const repository = new InMemoryCredentialVaultRepository();
    const vault = new CredentialVaultService(repository, keyAuthority());
    const created = await vault.create({
      projectId: 'project-a',
      providerId: 'deepseek',
      secret: 'super-secret-key',
    });
    const metadata = await vault.getMetadata(scopeFor(created));
    expect(metadata).toEqual(created);
    expect(JSON.stringify(metadata)).not.toContain('super-secret-key');

    let callbackBuffer: Uint8Array | undefined;
    await expect(
      vault.withCredential(scopeFor(created), async (secret) => {
        callbackBuffer = secret;
        return { status: 'SUCCEEDED' };
      }),
    ).resolves.toEqual({ status: 'SUCCEEDED' });
    expect(Buffer.from(callbackBuffer!).toString('utf8')).toBe(
      '\0'.repeat('super-secret-key'.length),
    );
  });

  it('uses a unique nonce for each encryption and never stores plaintext in the record', async () => {
    const repository = new InMemoryCredentialVaultRepository();
    const vault = new CredentialVaultService(repository, keyAuthority());
    const first = await vault.create({
      projectId: 'project-a',
      providerId: 'openai',
      secret: 'same',
    });
    const second = await vault.create({
      projectId: 'project-a',
      providerId: 'openai',
      secret: 'same',
    });
    const firstStored = await repository.findExact(scopeFor(first));
    const secondStored = await repository.findExact(scopeFor(second));
    expect(firstStored?.encryptedSecret.nonce).toBeTruthy();
    expect(secondStored?.encryptedSecret.nonce).toBeTruthy();
    expect(firstStored?.encryptedSecret.nonce).not.toBe(secondStored?.encryptedSecret.nonce);
    expect(JSON.stringify(firstStored)).not.toContain('same');
  });

  it('fails closed for missing, malformed, wrong-version, wrong-key, and tampered material', async () => {
    const empty = new CredentialVaultService(
      new InMemoryCredentialVaultRepository(),
      new EnvironmentCredentialMasterKeyAuthority({}),
    );
    expect(empty.getAvailability()).toEqual({ state: 'UNAVAILABLE', reason: 'MISSING_MASTER_KEY' });
    await expect(
      empty.create({ projectId: 'project-a', providerId: 'openai', secret: 'secret' }),
    ).rejects.toMatchObject({ code: 'CONFIGURATION_REQUIRED' });

    const malformed = new CredentialVaultService(
      new InMemoryCredentialVaultRepository(),
      new EnvironmentCredentialMasterKeyAuthority({ SHOTGUN_CREDENTIAL_MASTER_KEY: 'bad' }),
    );
    expect(malformed.getAvailability()).toEqual({
      state: 'UNAVAILABLE',
      reason: 'MALFORMED_MASTER_KEY',
    });

    const repository = new InMemoryCredentialVaultRepository();
    const created = await new CredentialVaultService(
      repository,
      keyAuthority(),
      () => '2026-08-12T00:00:00.000Z',
    ).create({
      projectId: 'project-a',
      providerId: 'openai',
      secret: 'secret',
    });
    const wrongKeyVault = new CredentialVaultService(repository, keyAuthority(Buffer.alloc(32, 4)));
    await expect(
      wrongKeyVault.withCredential(scopeFor(created), async () => ({ status: 'FAILED' as const })),
    ).rejects.toMatchObject({ code: 'AI_CAPABILITY_UNAVAILABLE' });

    const stored = await repository.findExact(scopeFor(created));
    if (!stored) throw new Error('Expected stored credential.');
    const tampered = {
      ...stored,
      encryptedSecret: {
        ...stored.encryptedSecret,
        ciphertext: `${stored.encryptedSecret.ciphertext}A`,
      },
    };
    await repository.insertRevision(tampered);
    await expect(
      new CredentialVaultService(repository, keyAuthority()).withCredential(
        scopeFor(created),
        async () => ({ status: 'FAILED' as const }),
      ),
    ).rejects.toMatchObject({ code: 'AI_CAPABILITY_UNAVAILABLE' });
  });

  it('rejects provider and project ownership mismatches without revealing whether a secret exists', async () => {
    const vault = new CredentialVaultService(
      new InMemoryCredentialVaultRepository(),
      keyAuthority(),
    );
    const created = await vault.create({
      projectId: 'project-a',
      providerId: 'openai',
      secret: 'secret',
    });
    await expect(
      vault.withCredential({ ...scopeFor(created), projectId: 'project-b' }, async () => ({
        status: 'FAILED' as const,
      })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      vault.withCredential({ ...scopeFor(created), providerId: 'deepseek' }, async () => ({
        status: 'FAILED' as const,
      })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
