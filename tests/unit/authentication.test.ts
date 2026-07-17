import { describe, expect, it } from 'vitest';

import {
  hashPassword,
  InMemoryAuthRepository,
  verifyPassword,
} from '../../packages/authentication/src/index.js';

describe('authentication primitives', () => {
  it('uses Argon2id credentials and revokes sessions after a password change or account disable', async () => {
    const repository = new InMemoryAuthRepository();
    const passwordHash = await hashPassword('initial-password');
    expect(passwordHash.startsWith('argon2id$v=1$')).toBe(true);
    expect(await verifyPassword('initial-password', passwordHash)).toBe(true);
    expect(await verifyPassword('wrong-password', passwordHash)).toBe(false);

    await repository.bootstrapOwner({
      accountId: 'owner',
      passwordHash,
      projectId: 'shotgun',
      scopes: ['owner'],
      sensitivityClearance: 'private',
    });
    const principal = await repository.authenticatePassword('owner', 'initial-password');
    if (!principal) throw new Error('Expected bootstrap owner.');
    const session = await repository.createSession(
      principal.principalId,
      'shotgun',
      new Date(Date.now() + 60_000).toISOString(),
    );
    expect(await repository.findSession(session.sessionToken)).toBeDefined();

    await repository.changePassword(principal.principalId, await hashPassword('changed-password'));
    expect(await repository.findSession(session.sessionToken)).toBeUndefined();
    expect(await repository.authenticatePassword('owner', 'initial-password')).toBeUndefined();
    expect(await repository.authenticatePassword('owner', 'changed-password')).toBeDefined();

    await repository.disablePrincipal(principal.principalId);
    expect(await repository.authenticatePassword('owner', 'changed-password')).toBeUndefined();
  });
});
