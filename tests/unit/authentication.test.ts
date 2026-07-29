import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PROJECT_ID,
  hashPassword,
  InMemoryAuthRepository,
  LOCAL_OWNER_ACCOUNT_ID,
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
      accountId: LOCAL_OWNER_ACCOUNT_ID,
      projectId: DEFAULT_PROJECT_ID,
      scopes: ['owner'],
      sensitivityClearance: 'private',
    });

    const membership = await repository.findOwnerMembership(
      LOCAL_OWNER_ACCOUNT_ID,
      DEFAULT_PROJECT_ID,
    );
    expect(membership).toBeDefined();
    expect(membership?.isOwner).toBe(true);
    expect(membership?.projectId).toBe(DEFAULT_PROJECT_ID);

    // Verify stored principal passwordHash is undefined (NOT empty string '')
    expect(repository.getStoredPasswordHash(membership!.principalId)).toBeUndefined();

    // Password authentication must fail for identity without password credential
    const authenticated = await repository.authenticatePassword(LOCAL_OWNER_ACCOUNT_ID, '');
    expect(authenticated).toBeUndefined();
  });

  it('handles active vs expired owner membership in InMemoryAuthRepository', async () => {
    const repository = new InMemoryAuthRepository();

    // 1. Unexpired owner -> rejects new owner creation
    await repository.bootstrapOwner({
      accountId: 'active-owner',
      passwordHash: await hashPassword('password123'),
      projectId: DEFAULT_PROJECT_ID,
      scopes: ['owner'],
      sensitivityClearance: 'private',
    });

    await expect(
      repository.bootstrapOwner({
        accountId: LOCAL_OWNER_ACCOUNT_ID,
        projectId: DEFAULT_PROJECT_ID,
        scopes: ['owner'],
        sensitivityClearance: 'private',
      }),
    ).rejects.toThrow('An active Owner already exists.');

    // 2. Expired owner only -> allows new owner creation
    const expiredRepo = new InMemoryAuthRepository();
    expiredRepo.seedExpiredOwner('expired-owner', DEFAULT_PROJECT_ID);

    // Expired owner membership should NOT be returned by findOwnerMembership
    const expiredMembership = await expiredRepo.findOwnerMembership(
      'expired-owner',
      DEFAULT_PROJECT_ID,
    );
    expect(expiredMembership).toBeUndefined();

    // Expired owner allows bootstrapping new active owner
    await expiredRepo.bootstrapOwner({
      accountId: LOCAL_OWNER_ACCOUNT_ID,
      projectId: DEFAULT_PROJECT_ID,
      scopes: ['owner'],
      sensitivityClearance: 'private',
    });
    const newOwner = await expiredRepo.findOwnerMembership(
      LOCAL_OWNER_ACCOUNT_ID,
      DEFAULT_PROJECT_ID,
    );
    expect(newOwner).toBeDefined();
    expect(newOwner?.isOwner).toBe(true);
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

  describe('Local Owner isolation — findOwnerMembership regression tests', () => {
    it('does not use an owner from a different project for local bootstrap', async () => {
      const repository = new InMemoryAuthRepository();

      // Create a regular owner in a different project
      await repository.bootstrapOwner({
        accountId: 'other-project-owner',
        passwordHash: await hashPassword('password123'),
        projectId: 'other-project',
        scopes: ['owner'],
        sensitivityClearance: 'private',
      });

      // Verify that owner exists in 'other-project'
      const otherMembership = await repository.findOwnerMembership(
        'other-project-owner',
        'other-project',
      );
      expect(otherMembership).toBeDefined();
      expect(otherMembership?.isOwner).toBe(true);

      // Local Owner lookup for DEFAULT_PROJECT_ID must NOT find the other-project owner
      const localMembership = await repository.findOwnerMembership(
        LOCAL_OWNER_ACCOUNT_ID,
        DEFAULT_PROJECT_ID,
      );
      expect(localMembership).toBeUndefined();
    }, 15_000);

    it('does not confuse a regular password owner in shotgun project with the Local Owner', async () => {
      const repository = new InMemoryAuthRepository();

      // Create a regular password-based owner in the shotgun project
      await repository.bootstrapOwner({
        accountId: 'regular-admin',
        passwordHash: await hashPassword('admin-password'),
        projectId: DEFAULT_PROJECT_ID,
        scopes: ['owner'],
        sensitivityClearance: 'private',
      });

      // Verify the regular owner exists
      const regularMembership = await repository.findOwnerMembership(
        'regular-admin',
        DEFAULT_PROJECT_ID,
      );
      expect(regularMembership).toBeDefined();
      expect(regularMembership?.isOwner).toBe(true);

      // Local Owner lookup must NOT return the regular admin
      const localMembership = await repository.findOwnerMembership(
        LOCAL_OWNER_ACCOUNT_ID,
        DEFAULT_PROJECT_ID,
      );
      expect(localMembership).toBeUndefined();
    }, 15_000);

    it('creates an explicit Local Owner Principal without a hidden Project', async () => {
      const repository = new InMemoryAuthRepository();
      const adapter = new LocalOwnerAuthenticationAdapter(repository);

      // Before bootstrap, no Local Owner exists
      const before = await repository.findOwnerMembership(
        LOCAL_OWNER_ACCOUNT_ID,
        DEFAULT_PROJECT_ID,
      );
      expect(before).toBeUndefined();

      // Trigger local bootstrap
      const result = await adapter.establishSession({
        isLoopbackBind: true,
        isRemoteLoopback: true,
        isSameOrigin: true,
        localOwnerEnabled: true,
      });

      expect(result.status).toBe('authenticated');

      // Fresh bootstrap creates only the Principal and a zero-project Session.
      const after = await repository.findOwnerMembership(
        LOCAL_OWNER_ACCOUNT_ID,
        DEFAULT_PROJECT_ID,
      );
      expect(after).toBeUndefined();
      if (result.status === 'authenticated') {
        expect(result.principalContext.principalId).toBeTruthy();
        expect(result.session.activeProjectId).toBeNull();
        expect(result.context).toBeUndefined();
      }
    });

    it('reuses the same Local Owner principal and membership on repeated bootstrap', async () => {
      const repository = new InMemoryAuthRepository();
      const adapter = new LocalOwnerAuthenticationAdapter(repository);

      const first = await adapter.establishSession({
        isLoopbackBind: true,
        isRemoteLoopback: true,
        isSameOrigin: true,
        localOwnerEnabled: true,
      });

      const second = await adapter.establishSession({
        isLoopbackBind: true,
        isRemoteLoopback: true,
        isSameOrigin: true,
        localOwnerEnabled: true,
      });

      expect(first.status).toBe('authenticated');
      expect(second.status).toBe('authenticated');
      if (first.status !== 'authenticated' || second.status !== 'authenticated') return;

      expect(first.principalContext.principalId).toBe(second.principalContext.principalId);
      expect(first.context).toBeUndefined();
      expect(second.context).toBeUndefined();
      expect(first.session.activeProjectId).toBeNull();
    });

    it('does not alter other principals, projects, or memberships during local bootstrap', async () => {
      const repository = new InMemoryAuthRepository();

      // Set up existing principals in different projects
      await repository.bootstrapOwner({
        accountId: 'team-lead',
        passwordHash: await hashPassword('team-pwd'),
        projectId: 'project-alpha',
        scopes: ['owner'],
        sensitivityClearance: 'private',
      });

      // Capture the team-lead membership before local bootstrap
      const teamLeadBefore = await repository.findOwnerMembership('team-lead', 'project-alpha');
      expect(teamLeadBefore).toBeDefined();

      // Trigger local bootstrap
      const adapter = new LocalOwnerAuthenticationAdapter(repository);
      const result = await adapter.establishSession({
        isLoopbackBind: true,
        isRemoteLoopback: true,
        isSameOrigin: true,
        localOwnerEnabled: true,
      });
      expect(result.status).toBe('authenticated');

      // The team-lead's membership must be unchanged
      const teamLeadAfter = await repository.findOwnerMembership('team-lead', 'project-alpha');
      expect(teamLeadAfter).toBeDefined();
      expect(teamLeadAfter?.principalId).toBe(teamLeadBefore?.principalId);
      expect(teamLeadAfter?.projectId).toBe('project-alpha');
      expect(teamLeadAfter?.isOwner).toBe(true);

      // The zero-project Local Owner Principal must not create a hidden Project membership.
      const localOwner = await repository.findPrincipalByAccountId(LOCAL_OWNER_ACCOUNT_ID);
      const localOwnerMemberships = await repository.listMemberships(localOwner!.principalId);
      expect(localOwner).toBeDefined();
      expect(localOwner?.principalId).not.toBe(teamLeadBefore?.principalId);
      expect(localOwnerMemberships).toEqual([]);
    }, 15_000);
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
