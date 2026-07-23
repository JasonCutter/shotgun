import { describe, expect, it } from 'vitest';

import {
  hashPassword,
  InMemoryAuthRepository,
  LocalOwnerAuthenticationAdapter,
  verifyPassword,
} from '../../packages/authentication/src/index.js';
import { isLoopbackIp, isSameOriginRequest } from '../../assemblies/shotgun-app/src/server.js';

describe('authentication primitives and local bootstrap security', () => {
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
  }, 15_000);

  it('supports Local Owner identity without password credentials (no passwordHash: "")', async () => {
    const repository = new InMemoryAuthRepository();
    await repository.bootstrapOwner({
      accountId: 'local-owner',
      projectId: 'shotgun',
      scopes: ['owner'],
      sensitivityClearance: 'private',
    });

    const membership = await repository.findOwnerMembership('shotgun');
    expect(membership).toBeDefined();
    expect(membership?.isOwner).toBe(true);
    expect(membership?.projectId).toBe('shotgun');

    // Password authentication must fail for identity without password credential
    const authenticated = await repository.authenticatePassword('local-owner', '');
    expect(authenticated).toBeUndefined();
  });

  it('implements AuthenticationPort.revokeSession via LocalOwnerAuthenticationAdapter', async () => {
    const repository = new InMemoryAuthRepository();
    const adapter = new LocalOwnerAuthenticationAdapter(repository);

    const established = await adapter.establishSession({
      isLoopbackBind: true,
      isRemoteLoopback: true,
      isSameOrigin: true,
      localOwnerEnabled: true,
    });

    expect(established.status).toBe('authenticated');
    if (established.status !== 'authenticated') return;

    const token = established.session.sessionToken;
    expect(await repository.findSession(token)).toBeDefined();

    await adapter.revokeSession(token);
    expect(await repository.findSession(token)).toBeUndefined();
  });

  describe('isLoopbackIp helper', () => {
    it('accurately identifies IPv4, IPv6, loopback subnets, and IPv4-mapped IPv6 without string includes', () => {
      expect(isLoopbackIp('127.0.0.1')).toBe(true);
      expect(isLoopbackIp('::1')).toBe(true);
      expect(isLoopbackIp('::ffff:127.0.0.1')).toBe(true);
      expect(isLoopbackIp('localhost')).toBe(true);
      expect(isLoopbackIp('127.0.0.50')).toBe(true); // 127.0.0.0/8 range
      expect(isLoopbackIp('[::1]:5173')).toBe(true);
      expect(isLoopbackIp('127.0.0.1:5173')).toBe(true);

      // Malicious or non-loopback addresses
      expect(isLoopbackIp('127.0.0.1.attacker.com')).toBe(false);
      expect(isLoopbackIp('localhost.evil.example')).toBe(false);
      expect(isLoopbackIp('192.168.1.10')).toBe(false);
      expect(isLoopbackIp('10.0.0.1')).toBe(false);
      expect(isLoopbackIp('::100')).toBe(false);
      expect(isLoopbackIp(undefined)).toBe(false);
    });
  });

  describe('isSameOriginRequest helper', () => {
    it('strictly compares protocol, hostname, port, rejects null origin and localhost.evil.example', () => {
      // Valid matching origin & host
      expect(isSameOriginRequest('http://localhost:5173', undefined, 'localhost:5173')).toBe(true);
      expect(isSameOriginRequest('http://127.0.0.1:5173', undefined, '127.0.0.1:5173')).toBe(true);
      expect(isSameOriginRequest('http://127.0.0.1:5173', undefined, 'localhost:5173')).toBe(true); // Equivalent loopback host

      // Missing origin/referer allowed for direct loopback calls
      expect(isSameOriginRequest(undefined, undefined, 'localhost:5173')).toBe(true);

      // Rejects Origin: null (opaque sandboxed origin)
      expect(isSameOriginRequest('null', undefined, 'localhost:5173')).toBe(false);

      // Rejects mismatched ports
      expect(isSameOriginRequest('http://localhost:8080', undefined, 'localhost:5173')).toBe(false);

      // Rejects host suffix attacks (localhost.evil.example)
      expect(isSameOriginRequest('http://localhost.evil.example', undefined, 'localhost')).toBe(
        false,
      );
      expect(
        isSameOriginRequest('http://127.0.0.1.evil.com:5173', undefined, '127.0.0.1:5173'),
      ).toBe(false);

      // Rejects non-HTTP(S) protocols
      expect(isSameOriginRequest('file:///etc/passwd', undefined, 'localhost')).toBe(false);
    });
  });
});
