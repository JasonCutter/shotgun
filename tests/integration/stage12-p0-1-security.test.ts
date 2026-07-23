import { describe, expect, it } from 'vitest';

import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import { hashPassword, InMemoryAuthRepository } from '../../packages/authentication/src/index.js';

const allScopes = [
  'owner',
  'action:candidate:stage',
  'action:approve',
  'action:execute',
  'action:verify',
  'action:read',
  'action:audit:read',
];

const createAuthenticatedApplication = async () => {
  const authRepository = new InMemoryAuthRepository();
  await authRepository.bootstrapOwner({
    accountId: 'owner',
    passwordHash: await hashPassword('correct horse battery staple'),
    projectId: 'shotgun',
    scopes: allScopes,
    sensitivityClearance: 'private',
  });
  const app = await createApplication({ authRepository, production: true });
  return { app, authRepository };
};

describe('Stage 12.1 P0-1 HTTP identity and authorization boundary', () => {
  it('rejects unauthenticated requests and every legacy security header', async () => {
    const { app } = await createAuthenticatedApplication();

    const unauthenticated = await app.server.inject({
      method: 'POST',
      url: '/demo/ping',
      payload: { message: 'no fallback' },
    });
    expect(unauthenticated.statusCode).toBe(401);
    expect(unauthenticated.json()).toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });

    for (const [name, value] of Object.entries({
      'x-actor-id': 'forged-owner',
      'x-access-scope': 'owner',
      'x-sensitivity': 'public',
      'x-project-id': 'other-project',
    })) {
      const response = await app.server.inject({
        method: 'POST',
        url: '/demo/ping',
        headers: { [name]: value },
        payload: { message: 'forged' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'LEGACY_SECURITY_HEADER_FORBIDDEN' });
    }
    await app.server.close();
  });

  it('creates a production session with CSRF protection and does not honor a browser project header', async () => {
    const { app } = await createAuthenticatedApplication();
    const login = await app.server.inject({
      method: 'POST',
      url: '/api/v1/session/login',
      payload: {
        accountId: 'owner',
        password: 'correct horse battery staple',
        projectId: 'shotgun',
      },
    });
    expect(login.statusCode).toBe(200);
    expect(login.headers['set-cookie']).toContain('__Host-shotgun_session=');
    expect(login.headers['set-cookie']).toContain('HttpOnly');
    expect(login.headers['set-cookie']).toContain('Secure');
    const setCookie = login.headers['set-cookie'];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(';')[0] ?? '';

    const csrfRes = await app.server.inject({
      method: 'GET',
      url: '/api/v1/security/csrf',
      headers: { cookie },
    });
    const csrfToken = csrfRes.json<{ csrfToken: string }>().csrfToken;

    const rejectedCsrf = await app.server.inject({
      method: 'POST',
      url: '/demo/ping',
      headers: { cookie },
      payload: { message: 'no csrf' },
    });
    expect(rejectedCsrf.statusCode).toBe(403);
    expect(rejectedCsrf.json()).toMatchObject({ code: 'REQUEST_ORIGIN_DENIED' });

    const accepted = await app.server.inject({
      method: 'POST',
      url: '/demo/ping',
      headers: { cookie, 'x-csrf-token': csrfToken, 'x-shotgun-project': 'other-project' },
      payload: { message: 'session project stays server-side' },
    });
    expect(accepted.statusCode).toBe(200);
    await app.server.close();
  });

  it('requires an API project selector and verifies token scope and membership on every request', async () => {
    const { app, authRepository } = await createAuthenticatedApplication();
    const principal = await authRepository.authenticatePassword(
      'owner',
      'correct horse battery staple',
    );
    if (!principal) throw new Error('Expected bootstrap owner.');
    const token = await authRepository.issueApiToken({
      principalId: principal.principalId,
      scopes: ['action:read'],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const missingProject = await app.server.inject({
      method: 'POST',
      url: '/demo/ping',
      headers: { authorization: `Bearer ${token.token}` },
      payload: { message: 'missing project' },
    });
    expect(missingProject.statusCode).toBe(400);
    expect(missingProject.json()).toMatchObject({ code: 'PROJECT_CONTEXT_REQUIRED' });

    const wrongProject = await app.server.inject({
      method: 'POST',
      url: '/demo/ping',
      headers: { authorization: `Bearer ${token.token}`, 'x-shotgun-project': 'other-project' },
      payload: { message: 'wrong project' },
    });
    expect(wrongProject.statusCode).toBe(403);
    expect(wrongProject.json()).toMatchObject({ code: 'PROJECT_ACCESS_DENIED' });

    const scopeDenied = await app.server.inject({
      method: 'POST',
      url: '/demo/ping',
      headers: { authorization: `Bearer ${token.token}`, 'x-shotgun-project': 'shotgun' },
      payload: { message: 'limited token' },
    });
    expect(scopeDenied.statusCode).toBe(403);

    const ownerToken = await authRepository.issueApiToken({
      principalId: principal.principalId,
      scopes: ['owner'],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const validProject = await app.server.inject({
      method: 'POST',
      url: '/demo/ping',
      headers: { authorization: `Bearer ${ownerToken.token}`, 'x-shotgun-project': 'shotgun' },
      payload: { message: 'token request' },
    });
    expect(validProject.statusCode).toBe(200);

    await authRepository.revokeApiTokens(principal.principalId);
    const revoked = await app.server.inject({
      method: 'POST',
      url: '/demo/ping',
      headers: { authorization: `Bearer ${token.token}`, 'x-shotgun-project': 'shotgun' },
      payload: { message: 'revoked' },
    });
    expect(revoked.statusCode).toBe(401);
    expect(JSON.stringify(authRepository.audit)).not.toContain(token.token);
    expect(JSON.stringify(authRepository.audit)).not.toContain('correct horse battery staple');
    await app.server.close();
  });
});
