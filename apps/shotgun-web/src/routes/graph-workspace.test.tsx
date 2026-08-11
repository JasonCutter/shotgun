import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GlobalShellView, GraphSnapshotResultV1 } from '@shotgun/api-client';

import { createFrontendQueryClient } from '../app/query-client.js';
import { AppProviders, type AppRuntime } from '../app/providers.js';
import { createSessionCycleState } from '../session/session-query.js';
import { GraphWorkspace } from './graph-workspace.js';

// Cytoscape needs a real browser layout engine; in jsdom we substitute a
// no-op core so the canvas presentation adapter mounts without a layout run.
vi.mock('cytoscape', () => {
  const core = () => ({
    on: vi.fn(() => core()),
    removeListener: vi.fn(),
    elements: vi.fn(() => ({
      on: vi.fn(),
      addClass: vi.fn(),
      removeClass: vi.fn(),
    })),
    layout: vi.fn(() => ({ run: vi.fn(), stop: vi.fn() })),
    destroy: vi.fn(),
    resize: vi.fn(),
    fit: vi.fn(),
  });
  return { default: vi.fn(() => core()) };
});

const now = '2026-08-04T08:00:00.000Z';

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

const revisionBinding = {
  schemaVersion: '1.0.0' as const,
  projectionRevision: 'proj-1',
  policyContextRevision: 'policy-1',
  accessRevision: 'access-1',
};

const snapshot: GraphSnapshotResultV1 = {
  schemaVersion: '1.0.0',
  identity: {
    schemaVersion: '1.0.0',
    snapshotId: 'snapshot-1',
    projectId: 'project-1',
    viewKind: 'KNOWLEDGE_SEMANTIC',
    projectionRevision: 'proj-1',
    generatedAt: now,
  },
  health: 'COMPLETE',
  completeness: 'COMPLETE',
  nodes: [
    {
      schemaVersion: '1.0.0',
      nodeId: 'node-1',
      resourceRef: { schemaVersion: '1.0.0', resourceKind: 'ENTITY', resourceId: 'entity-1' },
      label: 'Entity One',
      nodeKind: 'ENTITY',
      authority: 'CANONICAL',
      baseViewMembership: 'KNOWLEDGE_SEMANTIC',
      overlayMemberships: [],
      revisionBinding,
      accessMasking: 'VISIBLE',
      payload: {
        schemaVersion: '1.0.0',
        nodeKind: 'ENTITY',
        entity: { schemaVersion: 'entity.v1', entityType: 'PERSON', displayName: 'Entity One' },
      },
    },
    {
      schemaVersion: '1.0.0',
      nodeId: 'node-2',
      resourceRef: { schemaVersion: '1.0.0', resourceKind: 'CLAIM', resourceId: 'claim-1' },
      label: 'Claim One',
      nodeKind: 'CLAIM',
      authority: 'DERIVED_INFERENCE',
      baseViewMembership: 'KNOWLEDGE_SEMANTIC',
      overlayMemberships: ['CONFLICT'],
      revisionBinding,
      accessMasking: 'VISIBLE',
      payload: {
        schemaVersion: '1.0.0',
        nodeKind: 'CLAIM',
        claim: { schemaVersion: 'claim.v1', statement: 'Claim One' },
      },
    },
  ],
  edges: [
    {
      schemaVersion: '1.0.0',
      edgeId: 'edge-1',
      from: { schemaVersion: '1.0.0', resourceKind: 'ENTITY', resourceId: 'entity-1' },
      to: { schemaVersion: '1.0.0', resourceKind: 'CLAIM', resourceId: 'claim-1' },
      edgeSemanticKind: 'CANONICAL_RELATION',
      authority: 'CANONICAL',
      baseViewMembership: 'KNOWLEDGE_SEMANTIC',
      overlayMemberships: [],
      revisionBinding,
      accessMasking: 'VISIBLE',
    },
  ],
  appliedLimits: {
    schemaVersion: '1.0.0',
    maxDepth: 3,
    maxNodes: 100,
    maxEdges: 200,
    traversalBudget: 1000,
    serverTimeoutBudgetMs: 5000,
    requestedMaxDepth: null,
    requestedMaxNodes: null,
    requestedMaxEdges: null,
    clamped: false,
  },
  overlays: [],
  capabilities: { schemaVersion: '1.0.0', capabilities: ['SNAPSHOT'] },
};

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const createRuntime = (): AppRuntime => {
  const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
    if (String(url).endsWith('/api/v1/security/csrf')) {
      return jsonResponse(200, { csrfToken: 'csrf-graph' });
    }
    if (String(url).includes('/knowledge/graph/snapshot')) {
      return jsonResponse(200, snapshot);
    }
    return jsonResponse(404, { code: 'NOT_FOUND' });
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    apiClient: {} as never,
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

const tupleKeyFromElement = (element: HTMLElement): string => {
  const kind = element.getAttribute('data-graph-kind') ?? '';
  const id = element.getAttribute('data-graph-id') ?? '';
  const label = element.getAttribute('data-graph-label') ?? '';
  const authority = element.getAttribute('data-graph-authority') ?? '';
  const baseView = element.getAttribute('data-graph-base-view') ?? '';
  const overlays = element.getAttribute('data-graph-overlays') ?? '';
  return `${kind}|${id}|${label}|${authority}|${baseView}|${overlays}`;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Graph Workspace UI (FE-P3-S3)', () => {
  it('renders the semantic graph snapshot and exposes equivalent list/table accessible tuples', async () => {
    const runtime = createRuntime();
    renderRoute(
      runtime,
      [{ path: 'knowledge/graph', element: <GraphWorkspace /> }],
      ['/knowledge/graph'],
    );

    expect(await screen.findByRole('heading', { name: 'Semantic Graph', level: 1 })).toBeTruthy();

    // Switch to the list view and read the accessible tuples from data attrs.
    await userEvent.keyboard('{Alt>}l{/Alt}');
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Semantic graph list' })).toBeTruthy(),
    );
    const listRegion = screen.getByRole('region', { name: 'Semantic graph list' });
    const listKeys = within(listRegion)
      .getAllByRole('listitem')
      .map((item) => tupleKeyFromElement(item))
      .sort();

    // Switch to the table view and read the accessible tuples from data attrs.
    await userEvent.keyboard('{Alt>}t{/Alt}');
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Semantic graph table' })).toBeTruthy(),
    );
    const tableRegion = screen.getByRole('region', { name: 'Semantic graph table' });
    const tableKeys = within(tableRegion)
      .getAllByRole('row')
      .slice(1)
      .map((row) => tupleKeyFromElement(row))
      .sort();

    expect(tableKeys).toEqual(listKeys);
    expect(tableKeys.length).toBe(3); // two nodes + one edge
    expect(within(tableRegion).getByText('Entity One')).toBeTruthy();
  });

  it('selects a node through the list view and announces the frozen selection string', async () => {
    const runtime = createRuntime();
    renderRoute(
      runtime,
      [{ path: 'knowledge/graph', element: <GraphWorkspace /> }],
      ['/knowledge/graph'],
    );
    await screen.findByRole('heading', { name: 'Semantic Graph', level: 1 });
    await userEvent.keyboard('{Alt>}l{/Alt}');
    const listRegion = await screen.findByRole('region', { name: 'Semantic graph list' });
    const selectButton = within(listRegion).getAllByRole('button', { name: 'Select' })[0];
    if (!selectButton) throw new Error('Expected a Select button in the graph list view.');
    await userEvent.click(selectButton);
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('선택됨: Entity One'),
    );
  });

  it('switches base view and toggles overlays via the frozen keyboard set', async () => {
    const runtime = createRuntime();
    renderRoute(
      runtime,
      [{ path: 'knowledge/graph', element: <GraphWorkspace /> }],
      ['/knowledge/graph'],
    );
    await screen.findByRole('heading', { name: 'Semantic Graph', level: 1 });

    await userEvent.keyboard('{Alt>}2{/Alt}');
    await waitFor(() =>
      expect(
        (screen.getByRole('radio', { name: /Governance impact/ }) as HTMLInputElement).checked,
      ).toBe(true),
    );

    await userEvent.keyboard('{Alt>}{Shift>}1{/Shift}{/Alt}');
    await waitFor(() =>
      expect(
        (screen.getByRole('checkbox', { name: /Conflicts/ }) as HTMLInputElement).checked,
      ).toBe(true),
    );
  });

  it('renders a blocked state when no active project is selected', async () => {
    const noProjectShell: GlobalShellView = { ...shell, activeProject: null };
    const runtime = createRuntime();
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: (
            <>
              <Outlet context={{ shell: noProjectShell }} />
            </>
          ),
          children: [{ path: 'knowledge/graph', element: <GraphWorkspace /> }],
        },
      ],
      { initialEntries: ['/knowledge/graph'] },
    );
    render(
      <AppProviders runtime={runtime}>
        <RouterProvider router={router} />
      </AppProviders>,
    );
    expect(await screen.findByText(/Create a Project before opening the Graph/)).toBeTruthy();
  });
});
