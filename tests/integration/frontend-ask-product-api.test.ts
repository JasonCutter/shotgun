import { beforeEach, describe, expect, it } from 'vitest';

import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import { InMemoryAuthRepository } from '../../packages/authentication/src/index.js';
import { ASK_SCHEMA_VERSION, type AskWorkspaceView } from '../../packages/contracts/src/index.js';

describe('Frontend Ask Product API Integration', () => {
  let auth: InMemoryAuthRepository;

  beforeEach(async () => {
    auth = new InMemoryAuthRepository();
  });

  const projectSession = async () => {
    await auth.bootstrapOwner({
      accountId: 'ask-owner',
      projectId: 'shotgun',
      scopes: ['owner'],
      sensitivityClearance: 'private',
    });
    const principal = await auth.findPrincipalByAccountId('ask-owner');
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

  it('serves server-authoritative Ask Workspace snapshot and route guard decision', async () => {
    const { cookie } = await projectSession();
    const application = await createApplication({ authRepository: auth });

    const askResponse = await application.server.inject({
      method: 'GET',
      url: '/product-api/frontend/ask',
      headers: { cookie },
    });
    expect(askResponse.statusCode).toBe(200);
    const workspace = askResponse.json<{ workspace: AskWorkspaceView }>().workspace;
    expect(workspace).toMatchObject({
      schemaVersion: ASK_SCHEMA_VERSION,
      projectId: 'shotgun',
      defaultAskMode: 'CANONICAL_ONLY',
      availableAskModes: ['CANONICAL_ONLY', 'SOURCE_EXPLORATION', 'HYBRID'],
    });
    expect(workspace.capabilities).toEqual([]);

    const csrfToken = (
      await application.server.inject({
        method: 'GET',
        url: '/api/v1/security/csrf',
        headers: { cookie },
      })
    ).json<{ csrfToken: string }>().csrfToken;

    const guardResponse = await application.server.inject({
      method: 'POST',
      url: '/product-api/frontend/route-guard',
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: {
        targetRoute: {
          routeId: 'ask',
          href: '/ask',
        },
      },
    });
    expect(guardResponse.statusCode).toBe(200);
    expect(guardResponse.json()).toMatchObject({
      decision: {
        decision: 'ALLOW',
        targetRoute: { routeId: 'ask', href: '/ask' },
      },
    });

    await application.server.close();
  });
});
