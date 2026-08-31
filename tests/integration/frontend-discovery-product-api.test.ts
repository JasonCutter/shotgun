import { afterEach, describe, expect, it } from 'vitest';

import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import { InMemoryProjectAdministrationRepository } from '../../adapters/settings-project-admin-in-memory/src/index.js';
import { InMemoryAuthRepository } from '../../packages/authentication/src/index.js';
import {
  FrontendDiscoveryProductReadCoordinator,
  createEmptyDiscoveryProductReadSource,
} from '../../modules/frontend-discovery-product/src/index.js';

describe('Frontend Discovery Product API security boundary', () => {
  const applications: Awaited<ReturnType<typeof createApplication>>[] = [];

  afterEach(async () => {
    await Promise.all(applications.splice(0).map((application) => application.server.close()));
  });

  it('derives Project context from the session and rejects browser authority injection', async () => {
    const auth = new InMemoryAuthRepository();
    const projects = new InMemoryProjectAdministrationRepository(undefined, false);
    await auth.bootstrapOwner({
      accountId: 'discovery-api-owner',
      projectId: 'discovery-api-project',
      scopes: ['owner'],
      sensitivityClearance: 'private',
    });
    const principal = await auth.findPrincipalByAccountId('discovery-api-owner');
    if (!principal) throw new Error('Discovery API principal fixture was not created.');
    await projects.createProject({
      commandId: 'discovery-api-project-create',
      clientRequestId: 'discovery-api-project-create',
      idempotencyKey: 'discovery-api-project-create',
      projectId: 'discovery-api-project',
      name: 'Discovery API Project',
      actorPrincipalId: principal.principalId,
      expectedProjectRevision: 0,
    });
    projects.activateProjectForBootstrap('discovery-api-project');
    const session = await auth.createSession(
      principal.principalId,
      'discovery-api-project',
      new Date(Date.now() + 60_000).toISOString(),
    );
    const cookie = `shotgun_session=${session.sessionToken}`;
    const application = await createApplication({
      authRepository: auth,
      projectAdminRepository: projects,
      frontendDiscoveryProductReadCoordinator: new FrontendDiscoveryProductReadCoordinator(
        createEmptyDiscoveryProductReadSource(),
      ),
    });
    applications.push(application);

    const noCsrf = await application.server.inject({
      method: 'POST',
      url: '/product-api/frontend/knowledge/discoveries/list',
      headers: { cookie },
      payload: { schemaVersion: '1.0.0' },
    });
    expect(noCsrf.statusCode).toBe(403);

    const csrf = (
      await application.server.inject({
        method: 'GET',
        url: '/api/v1/security/csrf',
        headers: { cookie },
      })
    ).json<{ csrfToken: string }>().csrfToken;
    const headers = { cookie, 'x-csrf-token': csrf };
    const empty = await application.server.inject({
      method: 'POST',
      url: '/product-api/frontend/knowledge/discoveries/list',
      headers,
      payload: { schemaVersion: '1.0.0' },
    });
    expect(empty.statusCode, empty.body).toBe(200);
    expect(empty.json()).toMatchObject({
      result: { projectId: 'discovery-api-project', findings: [] },
    });

    const authorityInjection = await application.server.inject({
      method: 'POST',
      url: '/product-api/frontend/knowledge/discoveries/list',
      headers,
      payload: { schemaVersion: '1.0.0', projectId: 'attacker-project' },
    });
    expect(authorityInjection.statusCode).toBe(400);
  });
});
