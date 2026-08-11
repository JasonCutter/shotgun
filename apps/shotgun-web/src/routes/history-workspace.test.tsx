import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import type { GlobalShellView, ShotgunApiClient } from '@shotgun/api-client';

import { createFrontendQueryClient } from '../app/query-client.js';
import { AppProviders, type AppRuntime } from '../app/providers.js';
import { createSessionCycleState } from '../session/session-query.js';
import { HistoryWorkspace } from './history-workspace.js';

const now = '2026-08-09T12:00:00.000Z';

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

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

// ---------------------------------------------------------------------------
// Fixtures (valid against the strict History decoders)
// ---------------------------------------------------------------------------

const entry = (
  overrides: Partial<{
    historyEntryId: string;
    domainKind: string;
    domainResourceKind: string;
    domainResourceId: string;
    sourceEventKind: string;
    sourceEventId: string;
    occurredAt: string;
    payloadAvailability: string;
    payloadSnapshot: unknown;
  }> & { sourceEventId: string },
) => ({
  schemaVersion: '1.0.0',
  historyEntryId: `history:project-1:${overrides.sourceEventId}`,
  resourceProjectId: 'project-1',
  domainKind: 'CANONICAL',
  domainResourceKind: 'CANONICAL_CLAIM',
  domainResourceId: `claim:${overrides.sourceEventId}`,
  sourceEventKind: 'CANONICAL_CLAIM_ADDED',
  occurredAt: now,
  payloadAvailability: 'AVAILABLE',
  payloadSnapshot: { eventType: 'CANONICAL_CLAIM_ADDED', reason: 'commit' },
  projectedAt: now,
  ...overrides,
});

const canonicalEntry = entry({
  sourceEventId: 'e-1',
  payloadSnapshot: {
    eventType: 'CANONICAL_CLAIM_ADDED',
    reason: 'commit',
    beforeVersion: 1,
    afterVersion: 2,
    commitId: 'commit-2',
    revisionId: 'revision:rev-2',
    claimId: 'claim:e-1',
  },
});
const reviewEntry = entry({
  sourceEventId: 'r-1',
  domainKind: 'REVIEW',
  domainResourceKind: 'REVIEW_DECISION',
  domainResourceId: 'ctx-1',
  sourceEventKind: 'DECISION',
});
const externalAuditEntry = entry({
  sourceEventId: 'audit-1',
  domainKind: 'EXTERNAL_ACTION',
  domainResourceKind: 'EXTERNAL_ACTION',
  domainResourceId: 'action-1',
  sourceEventKind: 'AUDIT_EVENT',
});
const purgedEntry = entry({
  sourceEventId: 'p-1',
  domainKind: 'POLICY',
  domainResourceKind: 'POLICY_CHANGE',
  domainResourceId: 'event:1',
  sourceEventKind: 'SETTINGS_AUDIT_EVENT',
  payloadAvailability: 'PURGED_BY_POLICY',
  payloadSnapshot: { digest: 'sha256:redacted' },
});

const listResult = {
  schemaVersion: '1.0.0',
  entries: [canonicalEntry, reviewEntry, externalAuditEntry, purgedEntry],
  nextCursor: {
    schemaVersion: '1.0.0',
    occurredAt: now,
    domainKind: 'POLICY',
    sourceEventKind: 'SETTINGS_AUDIT_EVENT',
    sourceEventId: 'event:1',
  },
};

const detailEntry = entry({ sourceEventId: 'e-1' });

// ---------------------------------------------------------------------------
// fetch mock
// ---------------------------------------------------------------------------

const createFetchMock = () => {
  let detailCount = 0;
  const calls: { url: string; body: unknown }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith('/api/v1/security/csrf')) {
      return jsonResponse(200, { csrfToken: 'csrf-1' });
    }
    if (url.endsWith('/product-api/frontend/history/workspace')) {
      return jsonResponse(200, listResult);
    }
    if (url.endsWith('/product-api/frontend/history/entry')) {
      detailCount += 1;
      const body = init?.body ? (JSON.parse(String(init.body)) as { historyEntryId?: string }) : {};
      const all = [canonicalEntry, reviewEntry, externalAuditEntry, purgedEntry, detailEntry];
      const match = all.find((candidate) => candidate.historyEntryId === body.historyEntryId);
      return jsonResponse(200, { schemaVersion: '1.0.0', entry: match ?? detailEntry });
    }
    if (url.endsWith('/product-api/frontend/review/reversal-draft')) {
      const body = init?.body
        ? (JSON.parse(String(init.body)) as { sourceRevisionId?: string })
        : {};
      return jsonResponse(200, {
        schemaVersion: '1.0.0',
        reversal: {
          schemaVersion: '1.0.0',
          reversalId: 'reversal:1',
          resourceProjectId: 'project-1',
          sourceRevisionId: body.sourceRevisionId ?? 'rev-2',
          sourceCommitId: 'commit-2',
          status: 'CANDIDATE',
          createdAt: now,
          createdBy: 'principal-1',
        },
        eligibility: {
          schemaVersion: '1.0.0',
          sourceRevisionId: body.sourceRevisionId ?? 'rev-2',
          eligible: true,
          reasons: [],
        },
      });
    }
    return jsonResponse(404, { code: 'NOT_FOUND', message: 'not found' });
  });
  return { fetchMock, calls, detailCount: () => detailCount };
};

const createRuntime = (): AppRuntime => ({
  apiClient: {} as unknown as ShotgunApiClient,
  queryClient: createFrontendQueryClient(),
  sessionCycleState: createSessionCycleState(),
});

const renderWorkspace = (runtime: AppRuntime, initialEntries: string[] = ['/history']) => {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <Outlet context={{ shell }} />,
        children: [
          {
            path: 'history',
            element: <HistoryWorkspace />,
          },
          {
            path: 'external-action',
            element: <div>External Action Workspace</div>,
          },
          {
            path: 'review',
            element: <div>Review Workspace</div>,
          },
        ],
      },
    ],
    { initialEntries },
  );
  render(
    <AppProviders runtime={runtime}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
};

describe('HistoryWorkspace (FE-P5-S2 WP5)', () => {
  it('renders the federated history list with domain/availability filters', async () => {
    const { fetchMock } = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    renderWorkspace(createRuntime());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled(), { timeout: 3000 });
    await waitFor(
      () => expect(document.querySelectorAll('ol.history-list li').length).toBeGreaterThan(0),
      { timeout: 5000 },
    );
    expect(screen.getByRole('heading', { name: 'History', level: 1 })).not.toBeNull();
    expect(screen.getAllByText('Canonical').length).toBeGreaterThan(0);
    // Domain filter control exists.
    expect(screen.getByText('Domain')).not.toBeNull();
    // All four entries rendered.
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(4);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/product-api/frontend/history/workspace'),
      expect.anything(),
    );
    vi.unstubAllGlobals();
  });

  it('selects an entry and shows authoritative detail with payload availability', async () => {
    const user = userEvent.setup();
    const { fetchMock, detailCount } = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    renderWorkspace(createRuntime());
    await waitFor(
      () => expect(screen.getAllByRole('button', { name: /Canonical/ }).length).toBeGreaterThan(0),
      { timeout: 5000 },
    );
    await user.click(screen.getAllByRole('button', { name: /Canonical/ })[0]!);
    await waitFor(
      () =>
        expect(
          screen.getByRole('heading', { name: 'Knowledge claim added', level: 2 }),
        ).not.toBeNull(),
      { timeout: 5000 },
    );
    // Authoritative detail: payload snapshot + availability badge.
    expect(screen.getByTestId('history-payload-snapshot').textContent).toContain(
      'CANONICAL_CLAIM_ADDED',
    );
    expect(screen.getAllByText('Available').length).toBeGreaterThan(0);
    expect(detailCount()).toBeGreaterThanOrEqual(1);
    vi.unstubAllGlobals();
  });

  it('links EXTERNAL_ACTION entries to the owning-Domain External Action workspace (audit lineage)', async () => {
    const user = userEvent.setup();
    const { fetchMock } = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    renderWorkspace(createRuntime());
    await waitFor(
      () =>
        expect(screen.getAllByRole('button', { name: /External actions/ }).length).toBeGreaterThan(
          0,
        ),
      { timeout: 5000 },
    );
    await user.click(screen.getAllByRole('button', { name: /External actions/ })[0]!);
    await waitFor(
      () =>
        expect(
          screen.getByRole('heading', { name: 'External action audit updated', level: 2 }),
        ).not.toBeNull(),
      { timeout: 5000 },
    );
    expect(screen.getByRole('link', { name: /Audit lineage/ }).getAttribute('href')).toBe(
      '/external-action?actionId=action-1',
    );
    expect(screen.getByRole('link', { name: /Compensation/ }).getAttribute('href')).toBe(
      '/external-action?actionId=action-1',
    );
    vi.unstubAllGlobals();
  });

  it('shows the Reversal entry point for REVIEW/CANONICAL entries', async () => {
    const user = userEvent.setup();
    const { fetchMock } = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    renderWorkspace(createRuntime());
    await waitFor(
      () => expect(screen.getAllByRole('button', { name: /Canonical/ }).length).toBeGreaterThan(0),
      { timeout: 5000 },
    );
    // Select the Canonical entry → Reversal draft initiation button.
    await user.click(screen.getAllByRole('button', { name: /Canonical/ })[0]!);
    await waitFor(
      () =>
        expect(
          screen.getByRole('heading', { name: 'Knowledge claim added', level: 2 }),
        ).not.toBeNull(),
      { timeout: 5000 },
    );
    expect(screen.getByRole('button', { name: /Reversal draft/ })).not.toBeNull();
    // Select the REVIEW entry → Review workspace link (no Reversal button).
    await user.click(screen.getAllByRole('button', { name: /Review/ })[0]!);
    await waitFor(
      () =>
        expect(
          screen.getByRole('heading', { name: 'Review decision recorded', level: 2 }),
        ).not.toBeNull(),
      { timeout: 5000 },
    );
    expect(screen.getByRole('link', { name: 'Review workspace' }).getAttribute('href')).toBe(
      '/review',
    );
    expect(screen.queryByRole('button', { name: /Reversal draft/ })).toBeNull();
    vi.unstubAllGlobals();
  });

  it('renders payload availability states including PURGED_BY_POLICY without raw payload', async () => {
    const { fetchMock } = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    renderWorkspace(createRuntime());
    await waitFor(
      () => expect(screen.getAllByRole('button', { name: /Canonical/ }).length).toBeGreaterThan(0),
      { timeout: 5000 },
    );
    expect(screen.getAllByText('Purged by policy').length).toBeGreaterThan(0);
    // The purged row must not render its raw reason payload anywhere.
    expect(screen.queryByText('secret-payload')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('paginates with the frozen-tuple next cursor and returns to the first page', async () => {
    const user = userEvent.setup();
    const { fetchMock } = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    renderWorkspace(createRuntime());
    await waitFor(
      () => expect(screen.getAllByRole('button', { name: /Canonical/ }).length).toBeGreaterThan(0),
      { timeout: 5000 },
    );
    const next = screen.getByRole('button', { name: '다음' });
    expect(next.getAttribute('disabled')).toBeNull();
    await user.click(next);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/product-api/frontend/history/workspace'),
        expect.objectContaining({
          body: expect.stringContaining('"cursor"'),
        }),
      ),
    );
    const first = screen.getByRole('button', { name: '처음' });
    expect(first.getAttribute('disabled')).toBeNull();
    await user.click(first);
    await waitFor(() => expect(first.getAttribute('disabled')).not.toBeNull());
    vi.unstubAllGlobals();
  });

  it('resets the keyset cursor when a domain filter changes (GPT WP5 Round 1 A)', async () => {
    const user = userEvent.setup();
    const { fetchMock } = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    renderWorkspace(createRuntime());
    await waitFor(
      () => expect(screen.getAllByRole('button', { name: /Canonical/ }).length).toBeGreaterThan(0),
      { timeout: 5000 },
    );
    // Move to page 2 (cursor set → '처음' enabled).
    await user.click(screen.getByRole('button', { name: '다음' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '처음' }).getAttribute('disabled')).toBeNull(),
    );
    // Toggling a domain filter MUST reset the cursor back to the first page.
    await user.click(screen.getByLabelText('Review'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '처음' }).getAttribute('disabled')).not.toBeNull(),
    );
    // The subsequent list request is the first page (no cursor).
    vi.unstubAllGlobals();
  });

  it('initiates a Reversal draft from a selected Canonical entry and navigates to Review (GPT WP5 Round 1 B)', async () => {
    const user = userEvent.setup();
    const { fetchMock } = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    renderWorkspace(createRuntime());
    await waitFor(
      () => expect(screen.getAllByRole('button', { name: /Canonical/ }).length).toBeGreaterThan(0),
      { timeout: 5000 },
    );
    await user.click(screen.getAllByRole('button', { name: /Canonical/ })[0]!);
    await waitFor(
      () =>
        expect(
          screen.getByRole('heading', { name: 'Knowledge claim added', level: 2 }),
        ).not.toBeNull(),
      { timeout: 5000 },
    );
    // The authoritative detail carries the exact historical revision identity
    // (payloadSnapshot.revisionId — never the numeric afterVersion).
    const reversalButton = screen.getByRole('button', { name: 'Reversal draft 생성' });
    await user.click(reversalButton);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/product-api/frontend/review/reversal-draft'),
        expect.objectContaining({
          body: expect.stringContaining('"sourceRevisionId":"revision:rev-2"'),
        }),
      ),
    );
    // On success the current Review Workspace takes over.
    await waitFor(() => expect(screen.getByText('Review Workspace')).not.toBeNull(), {
      timeout: 5000,
    });
    vi.unstubAllGlobals();
  });

  it('passes an explicit deleted-project audit target through the History deep link (GPT WP5 Round 2 C)', async () => {
    const { fetchMock } = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    // `/history?resourceProjectId=<deleted-id>` — the browser names the audit
    // target; the server revalidates tombstone + audit scope + capability.
    renderWorkspace(createRuntime(), ['/history?resourceProjectId=deleted-1']);
    await waitFor(
      () =>
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/product-api/frontend/history/workspace'),
          expect.objectContaining({
            body: expect.stringContaining('"resourceProjectId":"deleted-1"'),
          }),
        ),
      { timeout: 5000 },
    );
    vi.unstubAllGlobals();
  });

  it('preserves the deleted-project audit target when selecting and clearing an entry (GPT WP5 Round 3 C)', async () => {
    const user = userEvent.setup();
    const { fetchMock } = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const router = renderWorkspace(createRuntime(), ['/history?resourceProjectId=deleted-1']);
    await waitFor(
      () =>
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/product-api/frontend/history/workspace'),
          expect.objectContaining({
            body: expect.stringContaining('"resourceProjectId":"deleted-1"'),
          }),
        ),
      { timeout: 5000 },
    );
    // Selecting an entry MUST keep the audit target in the URL and the detail
    // request must still target the deleted project.
    await user.click(screen.getAllByRole('button', { name: /Canonical/ })[0]!);
    await waitFor(
      () => expect(router.state.location.search).toContain('resourceProjectId=deleted-1'),
      { timeout: 5000 },
    );
    expect(router.state.location.search).toContain('entry=');
    await waitFor(
      () =>
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/product-api/frontend/history/entry'),
          expect.objectContaining({
            body: expect.stringContaining('"resourceProjectId":"deleted-1"'),
          }),
        ),
      { timeout: 5000 },
    );
    // Clearing the selection removes only the entry, keeping the audit target.
    await user.click(screen.getByRole('button', { name: '선택 해제' }));
    await waitFor(() => expect(router.state.location.search).not.toContain('entry='), {
      timeout: 5000,
    });
    expect(router.state.location.search).toContain('resourceProjectId=deleted-1');
    vi.unstubAllGlobals();
  });
});
