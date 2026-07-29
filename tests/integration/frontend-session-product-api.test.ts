import { beforeEach, describe, expect, it } from 'vitest';

import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import {
  hashPassword,
  InMemoryAuthRepository,
  type ProjectMembership,
} from '../../packages/authentication/src/index.js';

const withSecondProject = async (): Promise<InMemoryAuthRepository> => {
  const repository = new InMemoryAuthRepository();
  await repository.bootstrapOwner({
    accountId: 'frontend-owner',
    passwordHash: await hashPassword('frontend-password'),
    projectId: 'project-a',
    scopes: ['owner'],
    sensitivityClearance: 'private',
  });
  const principal = await repository.authenticatePassword('frontend-owner', 'frontend-password');
  if (!principal) throw new Error('Fixture principal was not created.');
  const extra: ProjectMembership = {
    principalId: principal.principalId,
    projectId: 'project-b',
    scopes: ['owner'],
    sensitivityClearance: 'private',
    isOwner: false,
  };
  const findMembership = repository.findMembership.bind(repository);
  const listMemberships = repository.listMemberships.bind(repository);
  repository.findMembership = async (principalId, projectId) =>
    principalId === extra.principalId && projectId === extra.projectId
      ? extra
      : findMembership(principalId, projectId);
  repository.listMemberships = async (principalId) => [
    ...(await listMemberships(principalId)),
    ...(principalId === extra.principalId ? [extra] : []),
  ];
  return repository;
};

describe('Frontend Product Session API', () => {
  let authRepository: InMemoryAuthRepository;

  beforeEach(async () => {
    authRepository = await withSecondProject();
  });

  const login = async () => {
    const app = await createApplication({ authRepository });
    const membership = await authRepository.findOwnerMembership('frontend-owner', 'project-a');
    if (!membership) throw new Error('Fixture owner membership was not found.');
    const session = await authRepository.createSession(
      membership.principalId,
      'project-a',
      new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    );
    const cookie = `shotgun_session=${session.sessionToken}`;
    return { app, cookie };
  };

  it('rejects an unauthenticated session query', async () => {
    const app = await createApplication({ authRepository });
    const response = await app.server.inject({ method: 'GET', url: '/api/v1/session' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
    await app.server.close();
  });

  it('has disabled public product password login route (401 AUTHENTICATION_REQUIRED)', async () => {
    const app = await createApplication({ authRepository });
    const response = await app.server.inject({
      method: 'POST',
      url: '/api/v1/session/login',
      payload: { accountId: 'frontend-owner', password: 'password', projectId: 'project-a' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
    await app.server.close();
  });

  it('ignores requested projectId and establishes an authority-free zero-project Session', async () => {
    const app = await createApplication({ authRepository, production: false });

    // Send body with { projectId: 'other-project' }
    const response = await app.server.inject({
      method: 'POST',
      url: '/api/v1/session/local-bootstrap',
      payload: { projectId: 'other-project' },
      headers: { host: '127.0.0.1' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      session: {
        activeProject: null,
        accessibleProjects: [],
      },
    });

    // Verify other-project owner was NOT created
    const otherProjectOwner = await authRepository.findOwnerMembership(
      'local-owner',
      'other-project',
    );
    expect(otherProjectOwner).toBeUndefined();

    await app.server.close();
  });

  it('rejects missing and rotated CSRF tokens without changing the active project', async () => {
    const { app, cookie } = await login();
    const missing = await app.server.inject({
      method: 'POST',
      url: '/api/v1/session/active-project',
      headers: { cookie },
      payload: { projectId: 'project-b' },
    });
    expect(missing.statusCode).toBe(403);
    expect(missing.json()).toMatchObject({ code: 'REQUEST_ORIGIN_DENIED' });

    const tokenA = (
      await app.server.inject({ method: 'GET', url: '/api/v1/security/csrf', headers: { cookie } })
    ).json<{ csrfToken: string }>().csrfToken;
    await app.server.inject({ method: 'GET', url: '/api/v1/security/csrf', headers: { cookie } });
    const stale = await app.server.inject({
      method: 'POST',
      url: '/api/v1/session/active-project',
      headers: { cookie, 'x-csrf-token': tokenA },
      payload: { projectId: 'project-b' },
    });
    expect(stale.statusCode).toBe(403);
    expect(stale.json()).toMatchObject({ code: 'REQUEST_ORIGIN_DENIED' });
    const current = await app.server.inject({
      method: 'GET',
      url: '/api/v1/session',
      headers: { cookie },
    });
    expect(current.json()).toMatchObject({ session: { activeProject: { id: 'project-a' } } });
    await app.server.close();
  });

  it('rejects an inaccessible project and persists a successful project switch', async () => {
    const { app, cookie } = await login();
    const csrf = async () =>
      (
        await app.server.inject({
          method: 'GET',
          url: '/api/v1/security/csrf',
          headers: { cookie },
        })
      ).json<{ csrfToken: string }>().csrfToken;
    const denied = await app.server.inject({
      method: 'POST',
      url: '/api/v1/session/active-project',
      headers: { cookie, 'x-csrf-token': await csrf() },
      payload: { projectId: 'project-c' },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ code: 'PROJECT_ACCESS_DENIED' });

    const switched = await app.server.inject({
      method: 'POST',
      url: '/api/v1/session/active-project',
      headers: { cookie, 'x-csrf-token': await csrf() },
      payload: { projectId: 'project-b' },
    });
    expect(switched.statusCode).toBe(200);
    expect(switched.json()).toMatchObject({ session: { activeProject: { id: 'project-b' } } });
    const restored = await app.server.inject({
      method: 'GET',
      url: '/api/v1/session',
      headers: { cookie },
    });
    expect(restored.json()).toMatchObject({ session: { activeProject: { id: 'project-b' } } });
    await app.server.close();
  });

  it.each(['x-project-id', 'x-actor-id', 'x-access-scope', 'x-sensitivity'])(
    'rejects legacy authority header %s',
    async (header) => {
      const { app, cookie } = await login();
      const response = await app.server.inject({
        method: 'GET',
        url: '/api/v1/session',
        headers: { cookie, [header]: 'forbidden' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'LEGACY_SECURITY_HEADER_FORBIDDEN' });
      await app.server.close();
    },
  );

  it('logs out, clears the cookie, and rejects the revoked session', async () => {
    const { app, cookie } = await login();
    const csrfToken = (
      await app.server.inject({
        method: 'GET',
        url: '/api/v1/security/csrf',
        headers: { cookie },
      })
    ).json<{ csrfToken: string }>().csrfToken;
    const logout = await app.server.inject({
      method: 'POST',
      url: '/api/v1/session/logout',
      headers: { cookie, 'x-csrf-token': csrfToken },
    });
    expect(logout.statusCode).toBe(200);
    expect(logout.headers['set-cookie']).toContain('Max-Age=0');
    const after = await app.server.inject({
      method: 'GET',
      url: '/api/v1/session',
      headers: { cookie },
    });
    expect(after.statusCode).toBe(401);
    await app.server.close();
  });
});
