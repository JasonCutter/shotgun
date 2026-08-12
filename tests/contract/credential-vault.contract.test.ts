import { describe, expect, it } from 'vitest';

import {
  CredentialVaultService,
  StaticCredentialMasterKeyAuthority,
} from '../../modules/credential-vault/src/index.js';
import { InMemoryCredentialVaultRepository } from '../../adapters/credential-vault-in-memory/src/index.js';

const authority = () =>
  new StaticCredentialMasterKeyAuthority({
    key: Buffer.alloc(32, 7),
    keyVersion: 'v1',
  });

describe('CredentialVaultPort contract', () => {
  it('keeps ownership and exact revision boundaries during create and replace', async () => {
    const repository = new InMemoryCredentialVaultRepository();
    const vault = new CredentialVaultService(repository, authority());
    const first = await vault.create({
      projectId: 'project-a',
      providerId: 'provider-a',
      secret: 'first-secret',
      now: '2026-08-12T00:00:00.000Z',
    });
    const second = await vault.replace({
      projectId: 'project-a',
      providerId: 'provider-a',
      credentialId: first.credentialId,
      expectedRevision: 1,
      secret: 'second-secret',
      now: '2026-08-12T00:01:00.000Z',
    });

    await expect(
      vault.withCredential(
        {
          projectId: 'project-a',
          providerId: 'provider-a',
          credentialId: first.credentialId,
          credentialRevision: 1,
        },
        async () => ({ status: 'FAILED' as const }),
      ),
    ).rejects.toMatchObject({ code: 'AI_CAPABILITY_UNAVAILABLE' });
    await expect(
      vault.withCredential(
        {
          projectId: 'project-a',
          providerId: 'provider-a',
          credentialId: second.credentialId,
          credentialRevision: second.credentialRevision,
        },
        async (secret) => {
          expect(Buffer.from(secret).toString('utf8')).toBe('second-secret');
          return { status: 'SUCCEEDED' };
        },
      ),
    ).resolves.toEqual({ status: 'SUCCEEDED' });
    await expect(
      vault.getMetadata({
        projectId: 'project-b',
        providerId: 'provider-a',
        credentialId: second.credentialId,
        credentialRevision: second.credentialRevision,
      }),
    ).resolves.toBeUndefined();
  });

  it('does not automatically substitute a current revision after revoke or remove', async () => {
    const vault = new CredentialVaultService(new InMemoryCredentialVaultRepository(), authority());
    const created = await vault.create({
      projectId: 'project-a',
      providerId: 'provider-a',
      secret: 'secret',
    });

    await vault.revoke({
      projectId: 'project-a',
      providerId: 'provider-a',
      credentialId: created.credentialId,
      credentialRevision: created.credentialRevision,
    });
    await expect(
      vault.withCredential(
        {
          projectId: 'project-a',
          providerId: 'provider-a',
          credentialId: created.credentialId,
          credentialRevision: created.credentialRevision,
        },
        async () => ({ status: 'FAILED' as const }),
      ),
    ).rejects.toMatchObject({ code: 'AI_CAPABILITY_UNAVAILABLE' });
    await expect(
      vault.remove({
        projectId: 'project-a',
        providerId: 'provider-a',
        credentialId: created.credentialId,
        credentialRevision: created.credentialRevision,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
