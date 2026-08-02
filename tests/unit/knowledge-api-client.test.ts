import { describe, expect, it, vi } from 'vitest';

import {
  createShotgunApiClient,
  type KnowledgeCompareView,
  type KnowledgeDetailView,
  type KnowledgePageListView,
  type KnowledgePageView,
  type KnowledgeProjectionStatusView,
  type KnowledgeSearchResultViewVNext,
  type KnowledgeWorkspaceView,
} from '../../packages/shotgun-api-client/src/index.js';

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

const makePage = (pageId: string, resourceId: string): KnowledgePageView => ({
  schemaVersion: '1.0.0',
  pageId,
  projectId: 'project-a',
  resourceId,
  revision: `${resourceId}-revision-1`,
  focusId: `${pageId}-focus`,
  title: `Knowledge ${pageId}`,
  items: [],
  lineage: {
    projectId: 'project-a',
    productId: pageId,
    resourceRevision: `${resourceId}-revision-1`,
  },
  projection,
  capabilities: ['READ', 'COMPARE'],
  fetchedAt: now,
});

const pageOne = makePage('page-1', 'resource-1');
const pageTwo = makePage('page-2', 'resource-2');

const workspace: KnowledgeWorkspaceView = {
  schemaVersion: '1.0.0',
  principalId: 'principal-a',
  sessionId: 'session-a',
  projectId: 'project-a',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  pages: [
    {
      pageId: pageOne.pageId,
      projectId: pageOne.projectId,
      resourceId: pageOne.resourceId,
      revision: pageOne.revision,
      title: pageOne.title,
      primaryAuthority: 'CANONICAL',
      primaryKind: 'CLAIM',
      projection,
    },
  ],
  projection,
  capabilities: ['READ', 'SEARCH'],
  fetchedAt: now,
};

const pages: KnowledgePageListView = {
  schemaVersion: '1.0.0',
  projectId: 'project-a',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  pages: workspace.pages,
  nextCursor: 'cursor-next',
  projection,
  fetchedAt: now,
};

const search: KnowledgeSearchResultViewVNext = {
  schemaVersion: '1.1.0',
  projectId: 'project-a',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  query: 'canonical',
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

const detail: KnowledgeDetailView = {
  schemaVersion: '1.0.0',
  resourceId: pageOne.resourceId,
  revision: pageOne.revision,
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  focusId: pageOne.focusId,
  page: pageOne,
  fetchedAt: now,
};

const compare: KnowledgeCompareView = {
  schemaVersion: '1.0.0',
  projectId: 'project-a',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  left: pageOne,
  right: pageTwo,
  differences: [],
  projection,
  capabilities: ['READ', 'COMPARE'],
  fetchedAt: now,
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('Knowledge typed API client', () => {
  it('posts all five requests to protected body-only routes and strictly decodes responses', async () => {
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void init;
      const url = String(input);
      if (url.endsWith('/api/v1/security/csrf')) return json({ csrfToken: 'csrf-knowledge' });
      if (url.endsWith('/knowledge/workspace')) return json({ workspace });
      if (url.endsWith('/knowledge/pages')) return json({ pages });
      if (url.endsWith('/knowledge/search')) return json({ result: search });
      if (url.endsWith('/knowledge/detail')) return json({ detail });
      if (url.endsWith('/knowledge/compare')) return json({ compare });
      throw new Error(`Unexpected API client URL: ${url}`);
    });
    const client = createShotgunApiClient({ fetch });

    await expect(
      client.getKnowledgeWorkspace({ schemaVersion: '1.0.0', resourceId: 'resource-1' }),
    ).resolves.toEqual(workspace);
    await expect(
      client.listKnowledgePages({ schemaVersion: '1.0.0', pageSize: 10 }),
    ).resolves.toEqual(pages);
    await expect(
      client.searchKnowledge({ schemaVersion: '1.0.0', query: 'canonical' }),
    ).resolves.toEqual(search);
    await expect(
      client.getKnowledgeDetail({ schemaVersion: '1.0.0', resourceId: 'resource-1' }),
    ).resolves.toEqual(detail);
    await expect(
      client.compareKnowledgePages({ schemaVersion: '1.0.0', pageIds: ['page-1', 'page-2'] }),
    ).resolves.toEqual(compare);

    const protectedCalls = fetch.mock.calls.filter(([input]) =>
      String(input).includes('/product-api/frontend/knowledge/'),
    );
    expect(protectedCalls).toHaveLength(5);
    for (const [input, init] of protectedCalls) {
      expect(String(input)).not.toContain('canonical');
      expect(init?.method).toBe('POST');
      expect(init?.credentials).toBe('same-origin');
      const headers = new Headers(init?.headers);
      expect(headers.get('x-csrf-token')).toBe('csrf-knowledge');
      expect(headers.has('x-project-id')).toBe(false);
      expect(headers.has('authorization')).toBe(false);
      expect(JSON.parse(String(init?.body))).not.toHaveProperty('principalId');
    }
  });

  it('fails closed on an invalid Knowledge response or undecodable remote failure', async () => {
    const invalidResponse = createShotgunApiClient({
      fetch: vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        void init;
        if (String(input).endsWith('/api/v1/security/csrf')) {
          return json({ csrfToken: 'csrf-knowledge' });
        }
        return json({ workspace: { ...workspace, unexpected: true } });
      }),
    });
    await expect(
      invalidResponse.getKnowledgeWorkspace({ schemaVersion: '1.0.0' }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' });

    const undecodableFailure = createShotgunApiClient({
      fetch: vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        void init;
        if (String(input).endsWith('/api/v1/security/csrf')) {
          return json({ csrfToken: 'csrf-knowledge' });
        }
        return json({ message: 'not a ProductFailureEnvelope' }, 500);
      }),
    });
    await expect(
      undecodableFailure.getKnowledgeWorkspace({ schemaVersion: '1.0.0' }),
    ).rejects.toMatchObject({ code: 'REMOTE_UNCLASSIFIED', retryability: 'NEVER' });
  });
});
