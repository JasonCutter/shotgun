import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type {
  GlobalShellView,
  KnowledgeCompareView,
  KnowledgeDetailView,
  KnowledgePageListView,
  KnowledgePageView,
  KnowledgeProjectionStatusView,
  KnowledgeSearchResultViewVNext,
  KnowledgeWorkspaceView,
  ShotgunApiClient,
} from '@shotgun/api-client';
import { ShotgunApiError } from '@shotgun/api-client';

import { createFrontendQueryClient } from '../app/query-client.js';
import { AppProviders, type AppRuntime } from '../app/providers.js';
import { createSessionCycleState } from '../session/session-query.js';
import { KnowledgeCompareWorkspace } from './knowledge-compare-workspace.js';
import { KnowledgeDetailWorkspace } from './knowledge-detail-workspace.js';
import { KnowledgeWorkspace } from './knowledge-workspace.js';

const now = '2026-08-02T12:00:00.000Z';

const shell: GlobalShellView = {
  schemaVersion: '1.0.0',
  principalId: 'principal-1',
  sessionId: 'session-1',
  activeProject: {
    id: 'project-1',
    label: 'Project One',
    sensitivityClearance: 'private',
  },
  accessibleProjects: [
    {
      id: 'project-1',
      label: 'Project One',
      isOwner: true,
      sensitivityClearance: 'private',
    },
  ],
  navigation: [],
  features: [],
  readiness: [],
  background: { activeCount: 0, failedCount: 0 },
  notifications: { unreadCount: 0, presentationRevision: '1' },
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  projectionRevision: 'projection-1',
  fetchedAt: now,
};

const canonicalProjection: KnowledgeProjectionStatusView = {
  projectionKind: 'CANONICAL_SEARCH',
  status: 'STALE',
  canonicalVersion: 4,
  projectedCanonicalVersion: 3,
  lag: 1,
  reason: 'Projection is waiting for the next server rebuild.',
};
const canonicalSearchProjection = {
  ...canonicalProjection,
  projectionKind: 'CANONICAL_SEARCH' as const,
};

const compiledProjection: KnowledgeProjectionStatusView = {
  projectionKind: 'COMPILED_TRUTH',
  status: 'DEGRADED',
  canonicalVersion: 4,
  projectedCanonicalVersion: 2,
  lag: 2,
  reason: 'Compiled item is incomplete.',
};

const lineage = {
  projectId: 'project-1',
  productId: 'knowledge-product',
  resourceRevision: 'resource-revision-2',
  sourceId: 'source-1',
  sourceVersionId: 'source-version-2',
  evidenceIds: ['evidence-1'],
  commitId: 'commit-1',
  manifestId: 'manifest-1',
  changeSetId: 'changeset-1',
};

const item = {
  productId: 'knowledge-product',
  projectId: 'project-1',
  resourceId: 'item-1',
  revision: 'item-revision-2',
  authority: 'CANONICAL' as const,
  kind: 'CLAIM' as const,
  temporalState: 'CURRENT' as const,
  label: 'Approved claim',
  summary: 'The server returned this claim.',
  content: 'The content remains read-only.',
  lineage,
  evidenceTargets: [
    {
      resourceId: 'resource-1',
      resourceRevision: 'resource-revision-2',
      focusId: 'item-1',
      sourceId: 'source-1',
      sourceVersionId: 'source-version-2',
      evidenceId: 'evidence-1',
    },
  ],
};

const leftPage: KnowledgePageView = {
  schemaVersion: '1.0.0',
  pageId: 'page-left',
  projectId: 'project-1',
  resourceId: 'resource-left',
  revision: 'left-revision-1',
  title: 'Left Knowledge Page',
  items: [item],
  lineage,
  projection: compiledProjection,
  capabilities: ['READ', 'SEARCH', 'FILTER', 'COMPARE', 'EVIDENCE_NAVIGATION'],
  fetchedAt: now,
};

const rightPage: KnowledgePageView = {
  ...leftPage,
  pageId: 'page-right',
  resourceId: 'resource-right',
  revision: 'right-revision-1',
  title: 'Right Knowledge Page',
};

const pageSummaries = [
  {
    pageId: 'page-left',
    projectId: 'project-1',
    resourceId: 'resource-left',
    revision: 'left-revision-1',
    title: 'Left Knowledge Page',
    primaryAuthority: 'CANONICAL' as const,
    primaryKind: 'CLAIM' as const,
    projection: canonicalProjection,
  },
  {
    pageId: 'page-right',
    projectId: 'project-1',
    resourceId: 'resource-right',
    revision: 'right-revision-1',
    title: 'Right Knowledge Page',
    primaryAuthority: 'COMPILED_TRUTH' as const,
    primaryKind: 'FACT' as const,
    projection: compiledProjection,
  },
];

const workspace: KnowledgeWorkspaceView = {
  schemaVersion: '1.0.0',
  principalId: 'principal-1',
  sessionId: 'session-1',
  projectId: 'project-1',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  pages: pageSummaries,
  projection: canonicalProjection,
  capabilities: ['READ', 'SEARCH', 'FILTER', 'COMPARE', 'EVIDENCE_NAVIGATION'],
  fetchedAt: now,
};

const pageList: KnowledgePageListView = {
  schemaVersion: '1.0.0',
  projectId: 'project-1',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  pages: pageSummaries,
  projection: canonicalProjection,
  fetchedAt: now,
};

const searchResult: KnowledgeSearchResultViewVNext = {
  schemaVersion: '1.1.0',
  projectId: 'project-1',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  query: 'canonical',
  matches: [
    {
      matchId: 'match-1',
      projectId: 'project-1',
      resourceId: 'resource-1',
      item,
      score: 0.92,
      matchAuthority: 'CANONICAL',
      matchType: 'FULL_TEXT',
      snippet: 'The server-provided snippet.',
    },
  ],
  projection: canonicalSearchProjection,
  readiness: {
    canonicalSearch: canonicalSearchProjection,
    sourceProjections: [],
    partial: true,
  },
  fetchedAt: now,
};

const detail: KnowledgeDetailView = {
  schemaVersion: '1.0.0',
  resourceId: 'resource-1',
  revision: 'resource-revision-2',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  focusId: 'item-1',
  page: {
    ...leftPage,
    pageId: 'page-detail',
    resourceId: 'resource-1',
    revision: 'resource-revision-2',
    title: 'Knowledge Detail',
  },
  fetchedAt: now,
};

const comparison: KnowledgeCompareView = {
  schemaVersion: '1.0.0',
  projectId: 'project-1',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  left: leftPage,
  right: rightPage,
  differences: [
    {
      differenceId: 'difference-1',
      path: '/items/0/summary',
      kind: 'CHANGED',
      leftValue: 'left value',
      rightValue: 'right value',
    },
  ],
  projection: compiledProjection,
  capabilities: ['READ', 'COMPARE'],
  fetchedAt: now,
};

const createRuntime = (): AppRuntime => {
  const apiClient = {
    getKnowledgeWorkspace: vi.fn(async () => workspace),
    listKnowledgePages: vi.fn(async () => pageList),
    searchKnowledge: vi.fn(async () => searchResult),
    getKnowledgeDetail: vi.fn(async () => detail),
    compareKnowledgePages: vi.fn(async () => comparison),
  } as unknown as ShotgunApiClient;
  return {
    apiClient,
    queryClient: createFrontendQueryClient(),
    sessionCycleState: createSessionCycleState(),
  };
};

const ShellOutlet = () => (
  <>
    <Outlet context={{ shell }} />
  </>
);

const renderRoute = (
  runtime: AppRuntime,
  children: readonly { path: string; element: ReactElement }[],
  initialEntries: readonly string[],
) => {
  const router = createMemoryRouter(
    [{ path: '/', element: <ShellOutlet />, children: [...children] }],
    { initialEntries: [...initialEntries] },
  );
  render(
    <AppProviders runtime={runtime}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
};

describe('Knowledge Workspace UI', () => {
  it('renders server pages, sends URL filters to the server, and preserves search readiness', async () => {
    const runtime = createRuntime();
    const router = renderRoute(
      runtime,
      [{ path: 'knowledge', element: <KnowledgeWorkspace /> }],
      ['/knowledge'],
    );

    expect(await screen.findByRole('heading', { name: 'Knowledge', level: 1 })).toBeTruthy();
    expect(await screen.findByRole('link', { name: 'Left Knowledge Page' })).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Search Knowledge'), 'canonical');
    await userEvent.selectOptions(screen.getByLabelText('Authority'), 'CANONICAL');
    await userEvent.click(screen.getByRole('button', { name: 'Search Knowledge' }));

    expect(router.state.location.search).toContain('q=canonical');
    expect(router.state.location.search).toContain('authority=CANONICAL');
    expect(await screen.findByText('The server-provided snippet.')).toBeTruthy();
    expect(screen.getByText(/Search readiness is partial/)).toBeTruthy();
    expect(runtime.apiClient.searchKnowledge).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query: 'canonical',
        filters: { authorities: ['CANONICAL'] },
      }),
      expect.any(Object),
    );
  });

  it('uses stable detail identity and carries a typed pinned Evidence return envelope', async () => {
    const runtime = createRuntime();
    const router = renderRoute(
      runtime,
      [
        { path: 'knowledge/:resourceId', element: <KnowledgeDetailWorkspace /> },
        { path: 'sources/:sourceId', element: <p>Source detail route</p> },
      ],
      ['/knowledge/resource-1?revision=resource-revision-2&focus=item-1'],
    );

    expect(await screen.findByRole('heading', { name: 'Knowledge Detail', level: 1 })).toBeTruthy();
    expect(await screen.findByText('The content remains read-only.')).toBeTruthy();
    const evidenceLink = await screen.findByRole('link', {
      name: /Open pinned SourceVersion and Evidence evidence-1/,
    });
    await userEvent.click(evidenceLink);

    expect(router.state.location.pathname).toBe('/sources/source-1');
    expect(router.state.location.search).toBe('?version=source-version-2');
    expect(router.state.location.state).toMatchObject({
      knowledgeReturnTarget: {
        originRoute: '/knowledge/resource-1?revision=resource-revision-2&focus=item-1',
        target: {
          resourceId: 'resource-1',
          resourceRevision: 'resource-revision-2',
          focusId: 'item-1',
          sourceId: 'source-1',
          sourceVersionId: 'source-version-2',
          evidenceId: 'evidence-1',
        },
      },
    });
    expect(runtime.apiClient.getKnowledgeDetail).toHaveBeenCalledWith(
      {
        schemaVersion: '1.0.0',
        resourceId: 'resource-1',
        requestedRevision: 'resource-revision-2',
        focusId: 'item-1',
      },
      expect.any(Object),
    );
  });

  it('keeps draft filters out of the committed search request until submit', async () => {
    const runtime = createRuntime();
    const router = renderRoute(
      runtime,
      [{ path: 'knowledge', element: <KnowledgeWorkspace /> }],
      ['/knowledge?q=canonical&authority=CANONICAL'],
    );

    expect(await screen.findByText('The server-provided snippet.')).toBeTruthy();
    const searchKnowledgeMock = vi.mocked(runtime.apiClient.searchKnowledge);
    const committedCallCount = searchKnowledgeMock.mock.calls.length;

    await userEvent.selectOptions(screen.getByLabelText('Authority'), 'COMPILED_TRUTH');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(router.state.location.search).toBe('?q=canonical&authority=CANONICAL');
    expect(searchKnowledgeMock).toHaveBeenCalledTimes(committedCallCount);

    await userEvent.click(screen.getByRole('button', { name: 'Search Knowledge' }));
    await waitFor(() =>
      expect(router.state.location.search).toBe('?q=canonical&authority=COMPILED_TRUTH'),
    );
    await waitFor(() =>
      expect(searchKnowledgeMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          filters: { authorities: ['COMPILED_TRUTH'] },
        }),
        expect.any(Object),
      ),
    );
  });

  it('does not expose manual retry for non-safe Knowledge read failures', async () => {
    const runtime = createRuntime();
    vi.spyOn(runtime.apiClient, 'searchKnowledge').mockRejectedValue(
      new ShotgunApiError({
        status: 400,
        code: 'INVALID_REQUEST',
        message: 'The Knowledge request is invalid.',
      }),
    );
    renderRoute(
      runtime,
      [{ path: 'knowledge', element: <KnowledgeWorkspace /> }],
      ['/knowledge?q=canonical'],
    );

    expect((await screen.findByRole('alert')).textContent).toContain(
      'The Knowledge request is invalid.',
    );
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('renders the server compare response in left/right order without client diff or write controls', async () => {
    const runtime = createRuntime();
    renderRoute(
      runtime,
      [{ path: 'knowledge/compare', element: <KnowledgeCompareWorkspace /> }],
      ['/knowledge/compare?left=page-left&right=page-right'],
    );

    expect(await screen.findByRole('heading', { name: 'Left Page', level: 2 })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Right Page', level: 2 })).toBeTruthy();
    expect(await screen.findByText('/items/0/summary')).toBeTruthy();
    expect(screen.getByText('left value')).toBeTruthy();
    expect(screen.getByText('right value')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /merge|write|approve/i })).toBeNull();
    expect(runtime.apiClient.compareKnowledgePages).toHaveBeenCalledWith(
      {
        schemaVersion: '1.0.0',
        pageIds: ['page-left', 'page-right'],
      },
      expect.any(Object),
    );
  });
});
