import { beforeEach, describe, expect, it } from 'vitest';

import {
  InMemoryActionCenterProjection,
  InMemoryBackgroundSummaryProjection,
  InMemoryGlobalSearch,
  InMemoryGlobalShellProjection,
  InMemoryNotificationSummaryProjection,
  InMemoryRouteGuardProjection,
} from '../../adapters/frontend-product-read-in-memory/src/index.js';
import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import {
  FrontendProductReadCoordinator,
  type KnowledgeWorkspaceProjectionPort,
} from '../../modules/frontend-product-read/src/index.js';
import { InMemoryAuthRepository } from '../../packages/authentication/src/index.js';
import {
  KNOWLEDGE_SEARCH_RESULT_SCHEMA_VERSION,
  KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
  type KnowledgeCompareView,
  type KnowledgeDetailView,
  type KnowledgePageListView,
  type KnowledgePageView,
  type KnowledgeProjectionStatusView,
  type KnowledgeSearchResultViewVNext,
  type KnowledgeWorkspaceView,
} from '../../packages/contracts/src/index.js';

const now = '2026-08-02T12:00:00.000Z';

const projection: KnowledgeProjectionStatusView & { readonly projectionKind: 'CANONICAL_SEARCH' } =
  {
    projectionKind: 'CANONICAL_SEARCH',
    status: 'READY',
    canonicalVersion: 4,
    projectedCanonicalVersion: 4,
    lag: 0,
    projectionRevision: 'search-revision-4',
    updatedAt: now,
  };

const makePage = (projectId: string, pageId: string, resourceId: string): KnowledgePageView => ({
  schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
  pageId,
  projectId,
  resourceId,
  revision: `${resourceId}-revision-1`,
  focusId: `${pageId}-focus`,
  title: `Knowledge ${pageId}`,
  items: [],
  lineage: {
    projectId,
    productId: pageId,
    resourceRevision: `${resourceId}-revision-1`,
  },
  projection,
  capabilities: ['READ', 'COMPARE'],
  fetchedAt: now,
});

const createCoordinator = (calls: string[]): FrontendProductReadCoordinator => {
  const knowledgePort: KnowledgeWorkspaceProjectionPort = {
    async getWorkspace(input): Promise<KnowledgeWorkspaceView> {
      calls.push('workspace');
      const page = makePage(input.activeProject.id, 'page-1', 'resource-1');
      return {
        schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
        principalId: input.principalId,
        sessionId: input.sessionId,
        projectId: input.activeProject.id,
        accessRevision: input.accessRevision,
        policyContextRevision: input.policyContextRevision,
        pages: [
          {
            pageId: page.pageId,
            projectId: page.projectId,
            resourceId: page.resourceId,
            revision: page.revision,
            title: page.title,
            primaryAuthority: 'CANONICAL',
            primaryKind: 'CLAIM',
            projection,
          },
        ],
        projection,
        capabilities: ['READ', 'SEARCH'],
        fetchedAt: now,
      };
    },

    async listPages(input): Promise<KnowledgePageListView> {
      calls.push('pages');
      const page = makePage(input.activeProject.id, 'page-1', 'resource-1');
      return {
        schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
        projectId: input.activeProject.id,
        accessRevision: input.accessRevision,
        policyContextRevision: input.policyContextRevision,
        pages: [
          {
            pageId: page.pageId,
            projectId: page.projectId,
            resourceId: page.resourceId,
            revision: page.revision,
            title: page.title,
            primaryAuthority: 'CANONICAL',
            primaryKind: 'CLAIM',
            projection,
          },
        ],
        projection,
        fetchedAt: now,
      };
    },

    async search(input): Promise<KnowledgeSearchResultViewVNext> {
      calls.push('search');
      return {
        schemaVersion: KNOWLEDGE_SEARCH_RESULT_SCHEMA_VERSION,
        projectId: input.activeProject.id,
        accessRevision: input.accessRevision,
        policyContextRevision: input.policyContextRevision,
        query: input.request.query,
        matches: [],
        projection,
        readiness: {
          canonicalSearch: projection,
          sourceProjections: [
            {
              projectionKind: 'COMPILED_TRUTH',
              status: 'NOT_BUILT',
              canonicalVersion: 4,
              projectedCanonicalVersion: 0,
              lag: 4,
              reason: 'Compiled Truth is not built.',
            },
          ],
          partial: true,
        },
        fetchedAt: now,
      };
    },

    async getDetail(input): Promise<KnowledgeDetailView> {
      calls.push('detail');
      const page = makePage(input.activeProject.id, 'page-1', input.request.resourceId);
      return {
        schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
        resourceId: page.resourceId,
        revision: page.revision,
        accessRevision: input.accessRevision,
        policyContextRevision: input.policyContextRevision,
        focusId: page.focusId,
        page,
        fetchedAt: now,
      };
    },

    async compare(input): Promise<KnowledgeCompareView> {
      calls.push('compare');
      const [leftPageId, rightPageId] = input.request.pageIds;
      const left = makePage(input.activeProject.id, leftPageId, 'resource-1');
      const right = makePage(input.activeProject.id, rightPageId, 'resource-2');
      return {
        schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
        projectId: input.activeProject.id,
        accessRevision: input.accessRevision,
        policyContextRevision: input.policyContextRevision,
        left,
        right,
        differences: [],
        projection,
        capabilities: ['READ', 'COMPARE'],
        fetchedAt: now,
      };
    },
  };

  return new FrontendProductReadCoordinator(
    new InMemoryGlobalShellProjection(),
    new InMemoryActionCenterProjection(),
    new InMemoryBackgroundSummaryProjection(),
    new InMemoryNotificationSummaryProjection(),
    new InMemoryGlobalSearch(),
    new InMemoryRouteGuardProjection(),
    undefined,
    knowledgePort,
  );
};

describe('Knowledge Product API A3 boundary', () => {
  let auth: InMemoryAuthRepository;

  beforeEach(() => {
    auth = new InMemoryAuthRepository();
  });

  const projectSession = async () => {
    await auth.bootstrapOwner({
      accountId: 'knowledge-api-owner',
      projectId: 'shotgun',
      scopes: ['owner'],
      sensitivityClearance: 'private',
    });
    const principal = await auth.findPrincipalByAccountId('knowledge-api-owner');
    if (!principal) throw new Error('Knowledge API fixture Principal was not created.');
    const session = await auth.createSession(
      principal.principalId,
      'shotgun',
      new Date(Date.now() + 60_000).toISOString(),
    );
    return `shotgun_session=${session.sessionToken}`;
  };

  const csrf = async (application: Awaited<ReturnType<typeof createApplication>>, cookie: string) =>
    (
      await application.server.inject({
        method: 'GET',
        url: '/api/v1/security/csrf',
        headers: { cookie },
      })
    ).json<{ csrfToken: string }>().csrfToken;

  it('exposes all five read methods through protected server-authoritative routes', async () => {
    const cookie = await projectSession();
    const calls: string[] = [];
    const application = await createApplication({
      authRepository: auth,
      frontendProductReadCoordinator: createCoordinator(calls),
    });
    const workspacePayload = {
      schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
      resourceId: 'resource-1',
    };
    const token = await csrf(application, cookie);
    const noCsrf = await application.server.inject({
      method: 'POST',
      url: '/product-api/frontend/knowledge/workspace',
      headers: { cookie },
      payload: workspacePayload,
    });
    expect(noCsrf.statusCode).toBe(403);

    const requests = [
      ['/product-api/frontend/knowledge/workspace', workspacePayload, 'workspace'],
      [
        '/product-api/frontend/knowledge/pages',
        { schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION, pageSize: 10 },
        'pages',
      ],
      [
        '/product-api/frontend/knowledge/search',
        { schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION, query: 'canonical' },
        'result',
      ],
      [
        '/product-api/frontend/knowledge/detail',
        { schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION, resourceId: 'resource-1' },
        'detail',
      ],
      [
        '/product-api/frontend/knowledge/compare',
        { schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION, pageIds: ['page-1', 'page-2'] },
        'compare',
      ],
    ] as const;

    for (const [url, payload, responseKey] of requests) {
      const response = await application.server.inject({
        method: 'POST',
        url,
        headers: { cookie, 'x-csrf-token': token },
        payload,
      });
      expect(response.statusCode, url).toBe(200);
      expect(response.json()).toHaveProperty(responseKey);
    }

    expect(calls).toEqual(['workspace', 'pages', 'search', 'detail', 'compare']);
    await application.server.close();
  });

  it('rejects browser authority fields and legacy authority headers', async () => {
    const cookie = await projectSession();
    const application = await createApplication({
      authRepository: auth,
      frontendProductReadCoordinator: createCoordinator([]),
    });
    const token = await csrf(application, cookie);
    const browserAuthority = await application.server.inject({
      method: 'POST',
      url: '/product-api/frontend/knowledge/workspace',
      headers: { cookie, 'x-csrf-token': token },
      payload: {
        schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
        principalId: 'browser-principal',
      },
    });
    expect(browserAuthority.statusCode).toBe(422);
    expect(browserAuthority.json()).toMatchObject({ code: 'UNSUPPORTED_SCHEMA' });

    const legacyHeader = await application.server.inject({
      method: 'POST',
      url: '/product-api/frontend/knowledge/workspace',
      headers: { cookie, 'x-csrf-token': token, 'x-project-id': 'browser-project' },
      payload: { schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION },
    });
    expect(legacyHeader.statusCode).toBe(400);
    expect(legacyHeader.json()).toMatchObject({ code: 'LEGACY_SECURITY_HEADER_FORBIDDEN' });
    await application.server.close();
  });

  it('keeps zero-project Knowledge queries disabled at the server boundary', async () => {
    const principal = await auth.bootstrapLocalOwnerPrincipal({
      accountId: 'knowledge-zero-owner',
    });
    const session = await auth.createSession(
      principal.principalId,
      null,
      new Date(Date.now() + 60_000).toISOString(),
    );
    const cookie = `shotgun_session=${session.sessionToken}`;
    const application = await createApplication({
      authRepository: auth,
      frontendProductReadCoordinator: createCoordinator([]),
    });
    const token = await csrf(application, cookie);
    const response = await application.server.inject({
      method: 'POST',
      url: '/product-api/frontend/knowledge/search',
      headers: { cookie, 'x-csrf-token': token },
      payload: { schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION, query: 'canonical' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'PROJECT_CONTEXT_REQUIRED' });
    await application.server.close();
  });
});
