import { beforeEach, describe, expect, it } from 'vitest';

import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import { InMemoryAuthRepository } from '../../packages/authentication/src/index.js';

describe('Frontend Section 3 Product API', () => {
  let auth: InMemoryAuthRepository;

  beforeEach(async () => {
    auth = new InMemoryAuthRepository();
  });

  const projectSession = async () => {
    await auth.bootstrapOwner({
      accountId: 'section3-owner',
      projectId: 'shotgun',
      scopes: ['owner'],
      sensitivityClearance: 'private',
    });
    const principal = await auth.findPrincipalByAccountId('section3-owner');
    if (!principal) throw new Error('Fixture Principal was not created.');
    const session = await auth.createSession(
      principal.principalId,
      'shotgun',
      new Date(Date.now() + 60_000).toISOString(),
    );
    return {
      principal,
      session,
      cookie: `shotgun_session=${session.sessionToken}`,
    };
  };

  const csrf = async (application: Awaited<ReturnType<typeof createApplication>>, cookie: string) =>
    (
      await application.server.inject({
        method: 'GET',
        url: '/api/v1/security/csrf',
        headers: { cookie },
      })
    ).json<{ csrfToken: string }>().csrfToken;

  it('returns a server-authoritative Shell and six-area Home snapshot', async () => {
    const { cookie } = await projectSession();
    const application = await createApplication({ authRepository: auth });
    const shellResponse = await application.server.inject({
      method: 'GET',
      url: '/product-api/frontend/global-shell',
      headers: { cookie },
    });
    expect(shellResponse.statusCode).toBe(200);
    const shell = shellResponse.json<{
      shell: {
        navigation: readonly {
          id: string;
          availability: string;
          targetRoute?: unknown;
        }[];
        features: readonly { id: string; availability: string }[];
      };
    }>().shell;
    expect(shell.navigation.find((item) => item.id === 'home')).toMatchObject({
      availability: 'AVAILABLE',
    });
    expect(shell.navigation.find((item) => item.id === 'sources')).toEqual(
      expect.objectContaining({
        availability: 'COMING_LATER',
      }),
    );
    expect(shell.navigation.find((item) => item.id === 'sources')).not.toHaveProperty(
      'targetRoute',
    );
    expect(shell.features.map((feature) => feature.id)).toEqual([
      'global-search',
      'command-palette',
      'cross-project-search',
    ]);

    const homeResponse = await application.server.inject({
      method: 'GET',
      url: '/product-api/frontend/home',
      headers: { cookie },
    });
    expect(homeResponse.statusCode).toBe(200);
    expect(homeResponse.json()).toMatchObject({
      home: {
        projectState: { lifecycle: 'ACTIVE' },
        primaryActions: expect.any(Array),
        attention: [],
        continueWorking: [],
        recent: [],
        pinned: [],
        operationalSummary: {
          activeBackgroundCount: 0,
          failedBackgroundCount: 0,
          unreadNotificationCount: 0,
        },
      },
    });
    await application.server.close();
  });

  it('uses protected POST Search, denies inaccessible cross-project scope, and never puts query in URL', async () => {
    const { cookie } = await projectSession();
    const application = await createApplication({ authRepository: auth });
    const rawQuery = 'private search phrase';
    const payload = {
      schemaVersion: '1.0.0',
      query: rawQuery,
      scope: { kind: 'ACTIVE_PROJECT' },
      limit: 20,
    };
    const noCsrf = await application.server.inject({
      method: 'POST',
      url: '/product-api/frontend/search/query',
      headers: { cookie },
      payload,
    });
    expect(noCsrf.statusCode).toBe(403);
    const token = await csrf(application, cookie);
    const searched = await application.server.inject({
      method: 'POST',
      url: '/product-api/frontend/search/query',
      headers: { cookie, 'x-csrf-token': token },
      payload,
    });
    expect(searched.statusCode).toBe(200);
    expect(searched.json()).toMatchObject({
      result: { scope: 'ACTIVE_PROJECT', results: [] },
    });

    const denied = await application.server.inject({
      method: 'POST',
      url: '/product-api/frontend/search/query',
      headers: { cookie, 'x-csrf-token': token },
      payload: {
        ...payload,
        scope: { kind: 'CROSS_PROJECT', projectIds: ['inaccessible-project'] },
      },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ code: 'PROJECT_ACCESS_DENIED' });
    await application.server.close();
  });

  it('masks inaccessible deep-link resources without changing the active Project', async () => {
    const { cookie, session } = await projectSession();
    const application = await createApplication({ authRepository: auth });
    const token = await csrf(application, cookie);
    const response = await application.server.inject({
      method: 'POST',
      url: '/product-api/frontend/route-guard',
      headers: { cookie, 'x-csrf-token': token },
      payload: {
        targetRoute: {
          routeId: 'settings-projects',
          href: '/settings/projects',
        },
        resourceProjectId: 'secret-project',
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      decision: {
        decision: 'NOT_FOUND',
        masked: true,
        activeProjectId: 'shotgun',
      },
    });
    expect((await auth.findSession(session.sessionToken))?.activeProjectId).toBe('shotgun');
    await application.server.close();
  });

  it('treats zero-project as normal, omits Home, and exposes server onboarding navigation', async () => {
    const principal = await auth.bootstrapLocalOwnerPrincipal({
      accountId: 'zero-project-owner',
    });
    const session = await auth.createSession(
      principal.principalId,
      null,
      new Date(Date.now() + 60_000).toISOString(),
    );
    const cookie = `shotgun_session=${session.sessionToken}`;
    const application = await createApplication({ authRepository: auth });
    const shell = (
      await application.server.inject({
        method: 'GET',
        url: '/product-api/frontend/global-shell',
        headers: { cookie },
      })
    ).json<{
      shell: {
        activeProject: null;
        navigation: readonly {
          id: string;
          targetRoute?: { href: string };
        }[];
      };
    }>().shell;
    expect(shell.activeProject).toBeNull();
    expect(shell.navigation.find((item) => item.id === 'settings')).toMatchObject({
      targetRoute: { href: '/settings/projects' },
    });

    const home = await application.server.inject({
      method: 'GET',
      url: '/product-api/frontend/home',
      headers: { cookie },
    });
    expect(home.statusCode).toBe(400);
    expect(home.json()).toMatchObject({ code: 'PROJECT_CONTEXT_REQUIRED' });
    await application.server.close();
  });

  it('rejects legacy browser authority headers on Section 3 routes', async () => {
    const { cookie } = await projectSession();
    const application = await createApplication({ authRepository: auth });
    const response = await application.server.inject({
      method: 'GET',
      url: '/product-api/frontend/global-shell',
      headers: { cookie, 'x-project-id': 'browser-authority' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'LEGACY_SECURITY_HEADER_FORBIDDEN' });
    await application.server.close();
  });
});
