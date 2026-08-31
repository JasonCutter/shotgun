import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GlobalShellView } from '@shotgun/api-client';

import { AppProviders, type AppRuntime } from '../app/providers.js';
import { createFrontendQueryClient } from '../app/query-client.js';
import { createSessionCycleState } from '../session/session-query.js';
import { DiscoveryDetailWorkspace, DiscoveryInboxWorkspace } from './discovery-workspace.js';

const now = '2026-08-31T12:00:00.000Z';

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

const baseFinding = {
  schemaVersion: '1.0.0' as const,
  projectId: 'project-1',
  authority: 'DERIVED_INFERENCE' as const,
  generationMethod: 'DETERMINISTIC' as const,
  rationale: 'The server found a missing relationship in the current projection.',
  derivationSummary: 'A deterministic rule compared the available resource lineage.',
  safeSignals: {},
  governance: {
    schemaVersion: '1.0.0' as const,
    reentryState: 'NOT_REQUESTED' as const,
    validationState: 'VALIDATED' as const,
    reviewReadiness: 'NOT_ELIGIBLE' as const,
  },
  freshness: {
    schemaVersion: '1.0.0' as const,
    state: 'CURRENT' as const,
    canonicalBase: {
      schemaVersion: '1.0.0' as const,
      canonicalVersion: 4,
      snapshotDigest: 'sha256:canonical',
    },
    discoveryBase: {
      schemaVersion: '1.0.0' as const,
      projectionRevision: 'discovery-revision-1',
      projectionDigest: 'sha256:discovery',
    },
  },
  runId: 'run-hidden-from-owner',
  capabilities: {
    schemaVersion: '1.0.0' as const,
    canOpenReview: false,
    canInspectEvidence: false,
    canOpenGraph: false,
    canOpenActivity: false,
    canInvestigate: false,
    canDismiss: false,
  },
  createdAt: now,
};

const reviewReadyFinding = {
  ...baseFinding,
  findingId: 'finding-review-ready',
  findingRevision: 3,
  findingType: 'KNOWLEDGE_GAP' as const,
  lifecycleState: 'REVIEW_READY' as const,
  title: 'Review-ready gap',
  summary: 'A reviewable gap needs an owner decision.',
  governance: {
    ...baseFinding.governance,
    reviewReadiness: 'ELIGIBLE_AFTER_VALIDATION' as const,
    reviewResourceId: 'review-resource-1',
  },
  capabilities: {
    ...baseFinding.capabilities,
    canOpenReview: true,
    canInspectEvidence: true,
  },
};

const secondFinding = {
  ...baseFinding,
  findingId: 'finding-second',
  findingRevision: 1,
  findingType: 'ACTION_SUGGESTION' as const,
  lifecycleState: 'NEW' as const,
  title: 'Non-executable suggestion',
  summary: 'This suggestion is only a candidate for later governance.',
};

const detailFinding = {
  ...reviewReadyFinding,
  payload: {
    schemaVersion: '1.0.0' as const,
    payloadType: 'KNOWLEDGE_GAP' as const,
    gapKind: 'MISSING_FACT' as const,
    subject: 'Project One',
    missingFact: 'The source relationship is not documented.',
    question: 'Which source establishes this relationship?',
  },
  lineage: {
    schemaVersion: '1.0.0' as const,
    relatedResourceRefs: [
      {
        schemaVersion: '1.0.0' as const,
        resourceKind: 'CANONICAL_CLAIM' as const,
        resourceId: 'claim-1',
        projectId: 'project-1',
        resourceState: 'CURRENT' as const,
        resourceRevision: 'claim-revision-1',
      },
    ],
    evidence: [
      {
        schemaVersion: '1.0.0' as const,
        evidenceId: 'evidence-1',
        evidenceRevisionId: 'evidence-revision-1',
        sourceId: 'source-1',
        sourceVersionId: 'source-version-1',
      },
    ],
    sourceProjectionDigest: 'sha256:source-projection',
    canonicalBase: baseFinding.freshness.canonicalBase,
    discoveryBase: baseFinding.freshness.discoveryBase,
    provenance: {
      schemaVersion: '1.0.0' as const,
      kind: 'DETERMINISTIC' as const,
      ruleId: 'rule-hidden-from-owner',
      ruleVersion: '1',
    },
  },
};

const dismissibleDetailFinding = {
  ...detailFinding,
  capabilities: { ...detailFinding.capabilities, canDismiss: true },
};

const dismissedDetailFinding = {
  ...dismissibleDetailFinding,
  lifecycleState: 'DISMISSED' as const,
  capabilities: { ...dismissibleDetailFinding.capabilities, canDismiss: false },
};

const actionDetailFinding = {
  ...secondFinding,
  payload: {
    schemaVersion: '1.0.0' as const,
    payloadType: 'ACTION_SUGGESTION' as const,
    suggestedAction: 'Ask an owner to confirm the missing relationship.',
    rationale: 'The candidate may need a governed follow-up.',
    affectedResourceRefs: [],
    executionStatus: 'CANDIDATE_ONLY' as const,
  },
  lineage: {
    schemaVersion: '1.0.0' as const,
    relatedResourceRefs: [],
    evidence: [],
    sourceProjectionDigest: 'sha256:source-projection',
    canonicalBase: baseFinding.freshness.canonicalBase,
    discoveryBase: baseFinding.freshness.discoveryBase,
    provenance: {
      schemaVersion: '1.0.0' as const,
      kind: 'DETERMINISTIC' as const,
    },
  },
};

const graphDetailFinding = {
  ...detailFinding,
  findingId: 'finding-relation',
  findingRevision: 5,
  findingType: 'RELATION_HYPOTHESIS' as const,
  title: 'Candidate relation',
  summary: 'A current relation candidate.',
  capabilities: { ...detailFinding.capabilities, canOpenGraph: true },
  payload: {
    schemaVersion: '1.0.0' as const,
    payloadType: 'RELATION_HYPOTHESIS' as const,
    sourceEndpoint: detailFinding.lineage.relatedResourceRefs[0]!,
    targetEndpoint: {
      schemaVersion: '1.0.0' as const,
      resourceKind: 'CANONICAL_ENTITY' as const,
      resourceId: 'entity-1',
      projectId: 'project-1',
      resourceState: 'CURRENT' as const,
    },
    proposedRelationType: 'RELATED_TO',
    direction: 'DIRECTED' as const,
  },
  lineage: {
    ...detailFinding.lineage,
    relatedResourceRefs: [
      detailFinding.lineage.relatedResourceRefs[0]!,
      {
        schemaVersion: '1.0.0' as const,
        resourceKind: 'CANONICAL_ENTITY' as const,
        resourceId: 'entity-1',
        projectId: 'project-1',
        resourceState: 'CURRENT' as const,
      },
    ],
  },
};

const responseFor = (result: unknown, status = 200) =>
  new Response(JSON.stringify({ result }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const csrfResponse = () =>
  new Response(JSON.stringify({ csrfToken: 'csrf-test-token' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const listResult = (findings: readonly unknown[], nextCursor?: string) => ({
  schemaVersion: '1.0.0',
  projectId: 'project-1',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  findings,
  ...(nextCursor ? { nextCursor } : {}),
});

const createFetchMock = (options?: {
  readonly failList?: boolean;
  readonly dismissResponse?: (request: unknown) => Response | Promise<Response>;
  readonly detailCanDismiss?: boolean;
}) => {
  const requests: unknown[] = [];
  const dismissCalls: unknown[] = [];
  let dismissed = false;
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const path = String(input);
      if (path === '/api/v1/security/csrf') return csrfResponse();
      const request = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push(request);
      if (path.endsWith('/discoveries/list')) {
        if (options?.failList) return responseFor({ error: 'failed' }, 503);
        return responseFor(
          listResult(
            request?.cursor ? [secondFinding] : [reviewReadyFinding],
            request?.cursor ? undefined : 'cursor-2',
          ),
        );
      }
      if (path.endsWith('/discoveries/dismiss')) {
        dismissCalls.push(request);
        dismissed = true;
        return options?.dismissResponse
          ? options.dismissResponse(request)
          : responseFor({
              schemaVersion: '1.0.0',
              projectId: 'project-1',
              accessRevision: 'access-1',
              policyContextRevision: 'policy-1',
              finding: dismissedDetailFinding,
            });
      }
      if (path.endsWith('/discoveries/read')) {
        return responseFor({
          schemaVersion: '1.0.0',
          projectId: 'project-1',
          accessRevision: 'access-1',
          policyContextRevision: 'policy-1',
          finding:
            request?.findingId === 'finding-second'
              ? actionDetailFinding
              : request?.findingId === 'finding-relation'
                ? graphDetailFinding
                : dismissed
                  ? dismissedDetailFinding
                  : options?.detailCanDismiss
                    ? dismissibleDetailFinding
                    : detailFinding,
        });
      }
      throw new Error(`Unexpected fetch path: ${path}`);
    },
  );
  return { dismissCalls, fetchMock, requests };
};

const createRuntime = (): AppRuntime =>
  ({
    apiClient: {},
    queryClient: createFrontendQueryClient(),
    sessionCycleState: createSessionCycleState(),
  }) as AppRuntime;

const ShellOutlet = () => <Outlet context={{ shell }} />;

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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Discovery Inbox and Detail Workspace', () => {
  it('renders the server inbox, all owner-readable tags, and explicit cursor pagination', async () => {
    const { fetchMock, requests } = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    renderRoute(
      createRuntime(),
      [{ path: 'knowledge/discoveries', element: <DiscoveryInboxWorkspace /> }],
      ['/knowledge/discoveries'],
    );

    expect(await screen.findByRole('heading', { name: 'Discovery Inbox', level: 1 })).toBeTruthy();
    expect(await screen.findByText('Review-ready gap')).toBeTruthy();
    expect(screen.getAllByText('Knowledge gap').length).toBeGreaterThan(1);
    expect(screen.getAllByText('Ready for Review').length).toBeGreaterThan(1);
    expect(screen.getAllByText('Derived finding · not Canonical').length).toBeGreaterThan(1);
    expect(screen.queryByText('run-hidden-from-owner')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Load more findings' }));
    expect(await screen.findByText('Non-executable suggestion')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalled();
    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ schemaVersion: '1.0.0', limit: 25 }),
        expect.objectContaining({ cursor: 'cursor-2', limit: 25 }),
      ]),
    );
  });

  it('sends only the exposed finding type and lifecycle filters to the server', async () => {
    const { fetchMock, requests } = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const router = renderRoute(
      createRuntime(),
      [{ path: 'knowledge/discoveries', element: <DiscoveryInboxWorkspace /> }],
      ['/knowledge/discoveries'],
    );

    await screen.findByText('Review-ready gap');
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Finding type' }),
      'KNOWLEDGE_GAP',
    );
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Lifecycle' }),
      'REVIEW_READY',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

    await waitFor(() =>
      expect(router.state.location.search).toBe(
        '?findingType=KNOWLEDGE_GAP&lifecycleState=REVIEW_READY',
      ),
    );
    await waitFor(() =>
      expect(requests).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            findingTypes: ['KNOWLEDGE_GAP'],
            lifecycleStates: ['REVIEW_READY'],
          }),
        ]),
      ),
    );
  });

  it('renders exact detail identity, governance, lineage, and only a positive Review deep link', async () => {
    const { fetchMock, requests } = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    renderRoute(
      createRuntime(),
      [{ path: 'knowledge/discoveries/:findingId', element: <DiscoveryDetailWorkspace /> }],
      ['/knowledge/discoveries/finding-review-ready?revision=3'],
    );

    expect(await screen.findByRole('heading', { name: 'Review-ready gap', level: 1 })).toBeTruthy();
    expect(
      screen.getByText('The server found a missing relationship in the current projection.'),
    ).toBeTruthy();
    expect(
      screen.getByText('A deterministic rule compared the available resource lineage.'),
    ).toBeTruthy();
    expect(screen.getByText('Validated')).toBeTruthy();
    expect(screen.getByText('Current')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open in Review' }).getAttribute('href')).toMatch(
      /^\/review\?reviewResourceId=review-resource-1$/,
    );
    expect(screen.getByRole('link', { name: /Open source evidence 1/ }).getAttribute('href')).toBe(
      '/sources/source-1?version=source-version-1&view=evidence',
    );
    expect(screen.getByRole('link', { name: /Open related resource/ })).toBeTruthy();
    expect(screen.queryByText('run-hidden-from-owner')).toBeNull();
    expect(screen.queryByText('rule-hidden-from-owner')).toBeNull();
    expect(screen.queryByRole('button', { name: /canonical|execute|run|apply/i })).toBeNull();
    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          schemaVersion: '1.0.0',
          findingId: 'finding-review-ready',
          findingRevision: 3,
        }),
      ]),
    );
  });

  it('shows only server-authorized dismiss, prevents duplicate submit, and restores focus', async () => {
    let resolveDismiss!: (response: Response) => void;
    const dismissPending = new Promise<Response>((resolve) => {
      resolveDismiss = resolve;
    });
    const { dismissCalls, fetchMock } = createFetchMock({
      detailCanDismiss: true,
      dismissResponse: () => dismissPending,
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderRoute(
      createRuntime(),
      [{ path: 'knowledge/discoveries/:findingId', element: <DiscoveryDetailWorkspace /> }],
      ['/knowledge/discoveries/finding-review-ready?revision=3'],
    );

    const heading = await screen.findByRole('heading', { name: 'Review-ready gap', level: 1 });
    const dismissButton = screen.getByRole('button', { name: 'Dismiss finding' });
    await user.click(dismissButton);
    expect((dismissButton as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        'The Discovery finding action is still processing.',
      ),
    );
    await user.click(dismissButton);
    expect(dismissCalls).toHaveLength(1);

    resolveDismiss(
      responseFor({
        schemaVersion: '1.0.0',
        projectId: 'project-1',
        accessRevision: 'access-1',
        policyContextRevision: 'policy-1',
        finding: dismissedDetailFinding,
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        'This derived finding was dismissed by the Project owner.',
      ),
    );
    expect(screen.queryByRole('button', { name: 'Dismiss finding' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it('does not render a dismiss control when the server capability is false', async () => {
    const { fetchMock } = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    renderRoute(
      createRuntime(),
      [{ path: 'knowledge/discoveries/:findingId', element: <DiscoveryDetailWorkspace /> }],
      ['/knowledge/discoveries/finding-review-ready?revision=3'],
    );

    await screen.findByRole('heading', { name: 'Review-ready gap', level: 1 });
    expect(screen.queryByRole('button', { name: 'Dismiss finding' })).toBeNull();
  });

  it('does not create a Review or execution action for non-ready findings and preserves exact-revision safety', async () => {
    const { fetchMock } = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    renderRoute(
      createRuntime(),
      [{ path: 'knowledge/discoveries/:findingId', element: <DiscoveryDetailWorkspace /> }],
      ['/knowledge/discoveries/finding-review-ready'],
    );

    expect(await screen.findByText('Discovery finding unavailable')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open in Review' })).toBeNull();
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).endsWith('/discoveries/read')),
    ).toBe(false);
  });

  it('shows Open in Graph only for a server-authorized graph-eligible Finding', async () => {
    const { fetchMock } = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    renderRoute(
      createRuntime(),
      [{ path: 'knowledge/discoveries/:findingId', element: <DiscoveryDetailWorkspace /> }],
      ['/knowledge/discoveries/finding-relation?revision=5'],
    );

    expect(
      await screen.findByRole('heading', { name: 'Candidate relation', level: 1 }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open in Graph' }).getAttribute('href')).toBe(
      '/knowledge/graph?discoveryFinding=finding-relation&discoveryRevision=5',
    );
  });

  it('keeps ACTION_SUGGESTION informational and omits Review for a NEW finding', async () => {
    const { fetchMock } = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    renderRoute(
      createRuntime(),
      [{ path: 'knowledge/discoveries/:findingId', element: <DiscoveryDetailWorkspace /> }],
      ['/knowledge/discoveries/finding-second?revision=1'],
    );

    expect(
      await screen.findByRole('heading', { name: 'Non-executable suggestion', level: 1 }),
    ).toBeTruthy();
    expect(screen.getByText('Candidate only · no execution is available')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open in Review' })).toBeNull();
    expect(screen.queryByRole('button', { name: /run|execute|send|apply/i })).toBeNull();
  });

  it('shows a calm empty state and no manual retry for an unsafe list failure', async () => {
    const { fetchMock } = createFetchMock({ failList: true });
    vi.stubGlobal('fetch', fetchMock);
    renderRoute(
      createRuntime(),
      [{ path: 'knowledge/discoveries', element: <DiscoveryInboxWorkspace /> }],
      ['/knowledge/discoveries'],
    );

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.queryByText('No Discovery findings')).toBeNull();
  });
});
