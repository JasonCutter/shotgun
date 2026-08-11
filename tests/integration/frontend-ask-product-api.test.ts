import { beforeEach, describe, expect, it } from 'vitest';

import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import {
  InMemoryActionCenterProjection,
  InMemoryAskWorkspaceProjection,
  InMemoryBackgroundSummaryProjection,
  InMemoryGlobalSearch,
  InMemoryGlobalShellProjection,
  InMemoryNotificationSummaryProjection,
  InMemoryRouteGuardProjection,
} from '../../adapters/frontend-product-read-in-memory/src/index.js';
import {
  InMemoryProjectAdministrationRepository,
  InMemorySettingsRepository,
} from '../../adapters/settings-project-admin-in-memory/src/index.js';
import { FrontendProductReadCoordinator } from '../../modules/frontend-product-read/src/index.js';
import { InMemoryAuthRepository } from '../../packages/authentication/src/index.js';
import {
  ASK_SCHEMA_VERSION,
  type AskConversationView,
  type AskWorkspaceView,
} from '../../packages/contracts/src/index.js';

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
      availableAskModes: ['CANONICAL_ONLY', 'HYBRID'],
      capabilities: ['SUBMIT_QUESTION'],
    });

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

  it('reads only the Conversation Resource Project while the Active Project remains different', async () => {
    await auth.bootstrapOwner({
      accountId: 'cross-project-owner',
      projectId: 'project-a',
      scopes: ['owner'],
      sensitivityClearance: 'private',
    });
    const principal = await auth.findPrincipalByAccountId('cross-project-owner');
    if (!principal || !auth.createProjectOwnerMembership) throw new Error('Fixture setup failed.');
    await auth.createProjectOwnerMembership({
      principalId: principal.principalId,
      projectId: 'project-b',
      scopes: ['owner'],
      sensitivityClearance: 'private',
    });
    const session = await auth.createSession(
      principal.principalId,
      'project-b',
      new Date(Date.now() + 60_000).toISOString(),
    );
    const cookie = `shotgun_session=${session.sessionToken}`;
    const projects = new InMemoryProjectAdministrationRepository(undefined, false);
    for (const projectId of ['project-a', 'project-b']) {
      await projects.createProject({
        commandId: `create-${projectId}`,
        clientRequestId: `create-${projectId}`,
        idempotencyKey: `create-${projectId}`,
        projectId,
        name: projectId,
        actorPrincipalId: principal.principalId,
        expectedProjectRevision: 0,
      });
    }
    const conversation = (conversationId: string, projectId: string): AskConversationView => ({
      schemaVersion: '1.0.0',
      conversationId,
      projectId,
      title: `${projectId} conversation`,
      activeBranchId: `${conversationId}-branch`,
      branches: [
        {
          branchId: `${conversationId}-branch`,
          branchRevision: `${conversationId}-branch-r1`,
          label: 'Main Branch',
          turns: [],
        },
      ],
      conversationRevision: `${conversationId}-r1`,
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
    });
    const askProjection = new InMemoryAskWorkspaceProjection([
      'CANONICAL_ONLY',
      'SOURCE_EXPLORATION',
    ]);
    askProjection.addConversation(conversation('conversation-a', 'project-a'));
    askProjection.addConversation(conversation('conversation-b', 'project-b'));
    askProjection.addConversation(conversation('conversation-c', 'project-c'));
    const readCoordinator = new FrontendProductReadCoordinator(
      new InMemoryGlobalShellProjection(),
      new InMemoryActionCenterProjection(),
      new InMemoryBackgroundSummaryProjection(),
      new InMemoryNotificationSummaryProjection(),
      new InMemoryGlobalSearch(),
      new InMemoryRouteGuardProjection(),
      askProjection,
    );
    const record = (
      projectId: string,
      sourceId: string,
      sensitivity: 'private' | 'restricted' = 'private',
      accessScope: readonly string[] = ['owner'],
    ) => ({
      projectId,
      sourceId,
      sourceVersionId: `${sourceId}-v1`,
      versionNumber: 1,
      mediaType: 'text/plain',
      contentHash: `sha256:${sourceId.padEnd(64, '0').slice(0, 64)}`,
      sizeBytes: 10,
      originalFileName: `${sourceId}.txt`,
      storageKey: `storage/${sourceId}`,
      accessScope,
      sensitivity,
      createdAt: '2026-08-11T00:00:00.000Z',
    });
    const records = [
      record('project-a', 'source-a-1'),
      record('project-a', 'source-a-2'),
      record('project-a', 'source-a-restricted', 'restricted'),
      record('project-a', 'source-a-admin', 'private', ['admin']),
      record('project-b', 'source-b-1'),
    ];
    const settings = new InMemorySettingsRepository();
    const application = await createApplication({
      authRepository: auth,
      projectAdminRepository: projects,
      settingsRepository: settings,
      frontendProductReadCoordinator: readCoordinator,
      sourcesProjectionRepository: {
        async listProjectSourceVersions(projectId: string) {
          return records.filter((candidate) => candidate.projectId === projectId);
        },
      },
    });
    const csrf = (
      await application.server.inject({
        method: 'GET',
        url: '/api/v1/security/csrf',
        headers: { cookie },
      })
    ).json<{ csrfToken: string }>().csrfToken;
    const headers = { cookie, 'x-csrf-token': csrf };
    const query = {
      schemaVersion: '1.0.0',
      filters: {},
      sort: 'UPDATED_DESC',
      limit: 100,
    };

    const resourceResponse = await application.server.inject({
      method: 'POST',
      url: '/product-api/frontend/ask/conversations/conversation-a/source-context/query',
      headers,
      payload: query,
    });
    expect(resourceResponse.statusCode).toBe(200);
    expect(resourceResponse.json()).toMatchObject({
      sourceContext: {
        conversationId: 'conversation-a',
        resourceProjectId: 'project-a',
        accessRevision: 'project-a:owner',
        policyContextRevision: '1',
      },
    });
    expect(
      resourceResponse.json<{
        sourceContext: { items: { sourceId: string; projectId: string }[] };
      }>().sourceContext.items,
    ).toEqual([
      expect.objectContaining({ sourceId: 'source-a-1', projectId: 'project-a' }),
      expect.objectContaining({ sourceId: 'source-a-2', projectId: 'project-a' }),
    ]);

    const activeResponse = await application.server.inject({
      method: 'POST',
      url: '/product-api/frontend/sources/query',
      headers,
      payload: query,
    });
    expect(activeResponse.statusCode).toBe(200);
    expect(activeResponse.json()).toMatchObject({
      page: { projectId: 'project-b', items: [{ sourceId: 'source-b-1' }] },
    });

    const injectedAuthority = await application.server.inject({
      method: 'POST',
      url: '/product-api/frontend/ask/conversations/conversation-a/source-context/query',
      headers,
      payload: { ...query, resourceProjectId: 'project-b' },
    });
    expect(injectedAuthority.statusCode).toBe(400);

    const inaccessible = await application.server.inject({
      method: 'POST',
      url: '/product-api/frontend/ask/conversations/conversation-c/source-context/query',
      headers,
      payload: query,
    });
    expect(inaccessible.statusCode).toBe(404);
    expect(inaccessible.json()).toMatchObject({ code: 'NOT_FOUND' });

    const firstPage = await application.server.inject({
      method: 'POST',
      url: '/product-api/frontend/ask/conversations/conversation-a/source-context/query',
      headers,
      payload: { ...query, limit: 1 },
    });
    const cursor = firstPage.json<{ sourceContext: { nextCursor: string } }>().sourceContext
      .nextCursor;
    const crossProjectCursor = await application.server.inject({
      method: 'POST',
      url: '/product-api/frontend/ask/conversations/conversation-b/source-context/query',
      headers,
      payload: { ...query, limit: 1, cursor },
    });
    expect(crossProjectCursor.statusCode).toBe(409);
    expect(crossProjectCursor.json()).toMatchObject({ code: 'STALE_VERSION' });

    const originalFindMembership = auth.findMembership.bind(auth);
    auth.findMembership = async (principalId, projectId) =>
      projectId === 'project-a' ? undefined : originalFindMembership(principalId, projectId);
    const revokedResourceMembership = await application.server.inject({
      method: 'POST',
      url: '/product-api/frontend/ask/conversations/conversation-a/source-context/query',
      headers,
      payload: query,
    });
    expect(revokedResourceMembership.statusCode).toBe(404);
    expect(revokedResourceMembership.json()).toMatchObject({ code: 'NOT_FOUND' });
    expect((await auth.findSession(session.sessionToken))?.activeProjectId).toBe('project-b');

    await application.server.close();
  });
});
