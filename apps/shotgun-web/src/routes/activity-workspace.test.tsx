import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import type { GlobalShellView, ShotgunApiClient } from '@shotgun/api-client';

import { createFrontendQueryClient } from '../app/query-client.js';
import { AppProviders, type AppRuntime } from '../app/providers.js';
import { createSessionCycleState } from '../session/session-query.js';
import { ActivityWorkspace } from './activity-workspace.js';

const now = '2026-08-06T12:00:00.000Z';

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
// Fixtures (valid against the strict Activity decoders)
// ---------------------------------------------------------------------------

const sourcesRoot = {
  schemaVersion: '1.0.0',
  rootKind: 'JOB',
  activityId: 'submission-1',
  domainKind: 'SOURCES',
  domainResourceKind: 'IntakeSubmission',
  domainResourceId: 'submission-1',
  resourceProjectId: 'project-1',
  resourceHref: '/product-api/frontend/sources/read?submissionId=submission-1',
  jobId: 'submission-1',
  runId: 'submission-1',
};

const askRoot = {
  schemaVersion: '1.0.0',
  rootKind: 'RUN',
  activityId: 'answer-run-1',
  domainKind: 'ASK',
  domainResourceKind: 'AnswerRun',
  domainResourceId: 'answer-run-1',
  resourceProjectId: 'project-1',
  resourceHref: '/product-api/frontend/ask/read?answerRunId=answer-run-1',
  runId: 'answer-run-1',
};

const metadata = {
  schemaVersion: '1.0.0',
  snapshotRevision: 3,
  generatedAt: now,
  sourceUpdatedAt: now,
  freshness: 'CURRENT',
  lagMilliseconds: 120,
  adapterStatus: 'AVAILABLE',
  partial: false,
};

const dimensions = {
  schemaVersion: '1.0.0',
  attention: 'NEEDS_ATTENTION',
  retryability: 'UNKNOWN',
  freshness: 'CURRENT',
  adapterStatus: 'AVAILABLE',
};

const externalActionRoot = {
  schemaVersion: '1.0.0',
  rootKind: 'JOB',
  activityId: 'activity-ea-1',
  domainKind: 'EXTERNAL_ACTION',
  domainResourceKind: 'ExternalAction',
  domainResourceId: 'action-ea-1',
  resourceProjectId: 'project-1',
  resourceHref: '/product-api/frontend/external-action/read?actionId=action-ea-1',
  jobId: 'action-ea-1',
  runId: 'execution-ea-1',
};

const queueResult = {
  schemaVersion: '1.0.0',
  items: [
    {
      root: sourcesRoot,
      summary: 'Sources intake submission submission-1',
      state: 'RUNNING',
      dimensions,
      updatedAt: now,
    },
    {
      root: askRoot,
      summary: 'Ask answer run answer-run-1',
      state: 'WAITING_FOR_USER',
      dimensions: { ...dimensions, attention: 'RESOLVED' },
      updatedAt: now,
    },
    {
      root: externalActionRoot,
      summary: 'External Action action-ea-1',
      state: 'SUCCEEDED',
      dimensions,
      updatedAt: now,
    },
  ],
  metadata,
  nextCursor: undefined,
};

const detailResult = {
  schemaVersion: '1.0.0',
  root: sourcesRoot,
  run: {
    schemaVersion: '1.0.0',
    runId: 'submission-1',
    jobId: 'submission-1',
    sequence: 1,
    state: 'RUNNING',
    startedAt: now,
    updatedAt: now,
    domainAttemptRefs: [],
    correlationRefs: [],
    causationRefs: [],
  },
  attempts: [
    {
      schemaVersion: '1.0.0',
      attemptId: 'attempt-1',
      runId: 'submission-1',
      attemptNumber: 1,
      attemptKind: 'SOURCES_INTAKE',
      state: 'RUNNING',
      retryability: 'NOT_RETRYABLE',
      startedAt: now,
      updatedAt: now,
      stageRefs: [],
    },
  ],
  stages: [
    {
      schemaVersion: '1.0.0',
      stageId: 'item-1',
      stageKey: 'intake-item-1',
      label: 'Item 1',
      sequence: 1,
      state: 'RUNNING',
      startedAt: now,
      updatedAt: now,
    },
  ],
  events: [
    {
      schemaVersion: '1.0.0',
      eventId: 'attempt-1',
      relatedRef: {
        schemaVersion: '1.0.0',
        resourceKind: 'IntakeSubmissionItem',
        resourceId: 'item-1',
      },
      category: 'STARTED',
      sequence: 1,
      occurredAt: now,
      summary: 'Sources intake attempt 1 RUNNING',
      domainResourceRef: {
        schemaVersion: '1.0.0',
        resourceKind: 'IntakeSubmission',
        resourceId: 'submission-1',
      },
    },
  ],
  transportAttempts: [
    {
      schemaVersion: '1.0.0',
      transportAttemptId: 'transport-1',
      transportKind: 'sources-command',
      commandOrMessageRef: {
        schemaVersion: '1.0.0',
        resourceKind: 'IntakeSubmissionItem',
        resourceId: 'item-1',
      },
      deliverySequence: 1,
      deliveryResult: 'DELIVERED',
      deliveredAt: now,
    },
    {
      schemaVersion: '1.0.0',
      transportAttemptId: 'transport-2',
      transportKind: 'sources-command',
      commandOrMessageRef: {
        schemaVersion: '1.0.0',
        resourceKind: 'IntakeSubmissionItem',
        resourceId: 'item-2',
      },
      deliverySequence: 2,
      deliveryResult: 'FAILED',
      deliveredAt: now,
      failure: {
        schemaVersion: '1.0.0',
        kind: 'TRANSIENT',
        code: 'delivery-timeout',
        message: '전달 시간 초과',
        occurredAt: now,
      },
    },
  ],
  metadata,
  dimensions,
};

const askDetailResult = {
  schemaVersion: '1.0.0',
  root: askRoot,
  run: {
    schemaVersion: '1.0.0',
    runId: 'answer-run-1',
    sequence: 1,
    state: 'WAITING_FOR_USER',
    startedAt: now,
    updatedAt: now,
    domainAttemptRefs: [],
    correlationRefs: [],
    causationRefs: [],
  },
  attempts: [],
  stages: [],
  events: [],
  transportAttempts: [],
  metadata,
  dimensions,
};

const externalActionDetailResult = {
  schemaVersion: '1.0.0',
  root: externalActionRoot,
  run: {
    schemaVersion: '1.0.0',
    runId: 'execution-ea-1',
    jobId: 'action-ea-1',
    sequence: 1,
    state: 'SUCCEEDED',
    startedAt: now,
    updatedAt: now,
    domainAttemptRefs: [],
    correlationRefs: [],
    causationRefs: [],
  },
  attempts: [],
  stages: [],
  events: [],
  transportAttempts: [],
  metadata,
  dimensions,
};

const stagesResult = {
  schemaVersion: '1.0.0',
  stages: [
    {
      schemaVersion: '1.0.0',
      stageId: 'item-2',
      stageKey: 'intake-item-2',
      label: 'Item 2',
      sequence: 2,
      state: 'SUCCEEDED',
      startedAt: now,
      updatedAt: now,
    },
  ],
  metadata,
  nextCursor: undefined,
};

const eventsResult = {
  schemaVersion: '1.0.0',
  events: [
    {
      schemaVersion: '1.0.0',
      eventId: 'attempt-2',
      relatedRef: {
        schemaVersion: '1.0.0',
        resourceKind: 'IntakeSubmissionItem',
        resourceId: 'item-2',
      },
      category: 'SUCCEEDED',
      sequence: 2,
      occurredAt: now,
      summary: 'Sources intake attempt 2 SUCCEEDED',
    },
  ],
  metadata,
  nextCursor: undefined,
};

const refreshResult = {
  schemaVersion: '1.0.0',
  resourceProjectId: 'project-1',
  snapshotRevision: 4,
  indexCount: 2,
  watermarks: [
    {
      resourceProjectId: 'project-1',
      adapterId: 'sources-activity-adapter',
      domainKind: 'SOURCES',
      projectedAt: now,
      adapterStatus: 'AVAILABLE',
      snapshotRevision: 4,
      updatedAt: now,
    },
  ],
  adapterStatus: 'AVAILABLE',
  partial: false,
  failures: [],
};

// ---------------------------------------------------------------------------
// Fetch mock
// ---------------------------------------------------------------------------

type CapturedCall = { readonly url: string; readonly body: unknown };

const createFetchMock = () => {
  const calls: CapturedCall[] = [];
  let refreshCount = 0;
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const text = String(url);
    let body: unknown;
    try {
      body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
    } catch {
      body = String(init?.body ?? '');
    }
    calls.push({ url: text, body });
    if (text.endsWith('/api/v1/security/csrf')) {
      return jsonResponse(200, { csrfToken: 'csrf-activity' });
    }
    if (text.includes('/activity/queue')) {
      return jsonResponse(200, queueResult);
    }
    if (text.includes('/activity/detail')) {
      const requestBody = (body ?? {}) as { readonly activityId?: string };
      if (requestBody.activityId === 'answer-run-1') return jsonResponse(200, askDetailResult);
      if (requestBody.activityId === 'activity-ea-1') {
        return jsonResponse(200, externalActionDetailResult);
      }
      return jsonResponse(200, detailResult);
    }
    if (text.includes('/activity/stages')) {
      return jsonResponse(200, stagesResult);
    }
    if (text.includes('/activity/events')) {
      return jsonResponse(200, eventsResult);
    }
    if (text.includes('/activity/refresh')) {
      refreshCount += 1;
      return jsonResponse(200, refreshResult);
    }
    return jsonResponse(404, { code: 'NOT_FOUND', message: 'not found' });
  });
  return { fetchMock, calls, refreshCount: () => refreshCount };
};

const createRuntime = (): AppRuntime => ({
  apiClient: {} as unknown as ShotgunApiClient,
  queryClient: createFrontendQueryClient(),
  sessionCycleState: createSessionCycleState(),
});

const renderWorkspace = (runtime: AppRuntime, initialEntries: string[] = ['/activity']) => {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <Outlet context={{ shell }} />,
        children: [
          {
            path: 'activity',
            element: <ActivityWorkspace />,
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

describe('ActivityWorkspace (FE-P5-S1 WP4)', () => {
  it('renders the queue with items, projection metadata and filters', async () => {
    const { fetchMock } = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const runtime = createRuntime();
    renderWorkspace(runtime);

    await screen.findByText('Sources intake submission submission-1');
    screen.getByText('Ask answer run answer-run-1');
    screen.getByText(/전체 결과|부분 결과/);
    screen.getByText(/rev 3/);
    screen.getByText(/120 ms/);
    screen.getByRole('checkbox', { name: /자동 새로고침/ });
    vi.unstubAllGlobals();
  });

  it('loads Detail with Run, Attempt, Stage and Event lineage on selection', async () => {
    const { fetchMock } = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const runtime = createRuntime();
    renderWorkspace(runtime);

    await screen.findByText('Sources intake submission submission-1');
    await userEvent.click(screen.getByText('Sources intake submission submission-1'));

    await waitFor(
      () => {
        screen.getByText(/Domain Attempts/);
      },
      { timeout: 10000 },
    );
    screen.getByText('attempt-1');
    screen.getByText('Item 1');
    screen.getByText(/Sources intake attempt 1 RUNNING/);
    // The server-returned resourceHref is rendered as a real link.
    expect(
      screen.getByRole('link', {
        name: '/product-api/frontend/sources/read?submissionId=submission-1',
      }),
    ).not.toBeNull();
    vi.unstubAllGlobals();
  });

  it('restores a selected Activity from the deep link and revalidates on Detail read', async () => {
    const { fetchMock, calls } = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const runtime = createRuntime();
    renderWorkspace(runtime, [
      '/activity?domain=SOURCES&activity=submission-1&resource=IntakeSubmission&resourceId=submission-1',
    ]);

    await waitFor(
      () => {
        expect(calls.some((call) => call.url.includes('/activity/detail'))).toBe(true);
      },
      { timeout: 10000 },
    );
    await screen.findByText('attempt-1');
    vi.unstubAllGlobals();
  });

  it('runs an explicit authoritative refresh and announces the result', async () => {
    const { fetchMock, refreshCount } = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const runtime = createRuntime();
    renderWorkspace(runtime);

    await screen.findByText('Sources intake submission submission-1');
    await userEvent.click(screen.getByRole('button', { name: '새로고침' }));

    await waitFor(
      () => {
        expect(refreshCount()).toBeGreaterThanOrEqual(1);
      },
      { timeout: 10000 },
    );
    await screen.findByText('활동 큐를 새로고침했습니다.');
    vi.unstubAllGlobals();
  });

  it('shows an empty state when the queue has no items', async () => {
    const { fetchMock } = createFetchMock();
    const emptyQueue = { ...queueResult, items: [], metadata: { ...metadata, partial: false } };
    fetchMock.mockImplementation(async (url: RequestInfo | URL) => {
      const text = String(url);
      if (text.endsWith('/api/v1/security/csrf')) {
        return jsonResponse(200, { csrfToken: 'csrf-activity' });
      }
      if (text.includes('/activity/queue')) {
        return jsonResponse(200, emptyQueue);
      }
      return jsonResponse(404, { code: 'NOT_FOUND', message: 'not found' });
    });
    vi.stubGlobal('fetch', fetchMock);
    const runtime = createRuntime();
    renderWorkspace(runtime);

    await screen.findByText('활동 없음');
    vi.unstubAllGlobals();
  });

  it('toggles the domain filter and sends the exact filter payload in the queue request body', async () => {
    const { fetchMock, calls } = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const runtime = createRuntime();
    renderWorkspace(runtime);

    await screen.findByText('Sources intake submission submission-1');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Ask' }));

    await waitFor(
      () => {
        // The Ask filter toggled ON must reach the server: the POST body of a
        // queue request must carry `domainKinds: ['ASK']` — the URL alone is
        // not enough (the verdict requires the exact request payload).
        const queueCalls = calls.filter((call) => call.url.includes('/activity/queue'));
        const withAskPayload = queueCalls.some((call) => {
          const body = call.body as { readonly domainKinds?: readonly string[] } | undefined;
          return Array.isArray(body?.domainKinds) && body.domainKinds.includes('ASK');
        });
        expect(withAskPayload).toBe(true);
      },
      { timeout: 10000 },
    );

    const queueCalls = calls.filter((call) => call.url.includes('/activity/queue'));
    const lastQueueCall = queueCalls.at(-1);
    const parsed = lastQueueCall?.body as { readonly domainKinds?: readonly string[] };
    expect(parsed?.domainKinds).toEqual(['ASK']);
    vi.unstubAllGlobals();
  });

  it('builds exact Domain Resource deep links from domainResourceKind + domainResourceId, not activityId (AC-04)', async () => {
    const { fetchMock } = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const runtime = createRuntime();
    renderWorkspace(runtime);

    await screen.findByText('Sources intake submission submission-1');

    // Sources → /sources/:domainResourceId
    await userEvent.click(screen.getByText('Sources intake submission submission-1'));
    await waitFor(() => screen.getByRole('link', { name: '도메인 워크스페이스에서 열기' }), {
      timeout: 10000,
    });
    expect(
      screen.getByRole('link', { name: '도메인 워크스페이스에서 열기' }).getAttribute('href'),
    ).toBe('/sources/submission-1');
    // Server-returned resourceHref is rendered as a real link.
    expect(
      screen
        .getByRole('link', {
          name: '/product-api/frontend/sources/read?submissionId=submission-1',
        })
        .getAttribute('href'),
    ).toBe('/product-api/frontend/sources/read?submissionId=submission-1');

    // Ask → /ask/conversations/:domainResourceId
    await userEvent.click(screen.getByText('Ask answer run answer-run-1'));
    await waitFor(() => {
      expect(
        screen.getByRole('link', { name: '도메인 워크스페이스에서 열기' }).getAttribute('href'),
      ).toBe('/ask/conversations/answer-run-1');
    });

    // External Action → /external-action?action=:domainResourceId
    await userEvent.click(screen.getByText('External Action action-ea-1'));
    await waitFor(() => {
      expect(
        screen.getByRole('link', { name: '도메인 워크스페이스에서 열기' }).getAttribute('href'),
      ).toBe('/external-action?action=action-ea-1');
    });
    vi.unstubAllGlobals();
  });

  it('renders Transport Attempts in a separate table distinct from Domain Attempts (AC-03/AC-07)', async () => {
    const { fetchMock } = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const runtime = createRuntime();
    renderWorkspace(runtime);

    await screen.findByText('Sources intake submission submission-1');
    await userEvent.click(screen.getByText('Sources intake submission submission-1'));
    await waitFor(() => screen.getByRole('table', { name: 'Transport Attempts' }), {
      timeout: 10000,
    });

    // Transport Attempt rows are shown with their own identity fields.
    const transportTable = screen.getByRole('table', { name: 'Transport Attempts' });
    const transportText = transportTable.textContent ?? '';
    expect(transportText).toContain('transport-1');
    expect(transportText).toContain('transport-2');
    expect(transportText).toContain('sources-command');
    expect(transportText).toContain('DELIVERED');
    expect(transportText).toContain('FAILED');
    expect(transportText).toContain('전달 시간 초과');

    // The two tables are distinct: Domain Attempts and Transport Attempts.
    const domainTable = screen.getByRole('table', { name: 'Domain Attempts' });
    expect(domainTable).not.toBe(transportTable);
    expect(domainTable.textContent ?? '').not.toContain('transport-1');
    expect(domainTable.textContent ?? '').not.toContain('sources-command');
    vi.unstubAllGlobals();
  });

  it('moves focus to the Detail heading once after selection (deterministic focus, AC-15)', async () => {
    const { fetchMock } = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const runtime = createRuntime();
    renderWorkspace(runtime);

    await screen.findByText('Sources intake submission submission-1');
    await userEvent.click(screen.getByText('Sources intake submission submission-1'));

    await waitFor(
      () => {
        const heading = screen.getByRole('heading', { level: 2, name: 'submission-1' });
        expect(document.activeElement).toBe(heading);
      },
      { timeout: 10000 },
    );
    vi.unstubAllGlobals();
  });

  it('stops Detail polling when automatic refresh is disabled', async () => {
    vi.useFakeTimers();
    const { fetchMock, calls } = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const runtime = createRuntime();
    renderWorkspace(runtime, [
      '/activity?domain=SOURCES&activity=submission-1&resource=IntakeSubmission&resourceId=submission-1',
    ]);

    // Flush the initial queue + detail loads (microtasks resolve under fake timers).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(
      calls.filter((call) => call.url.includes('/activity/detail')).length,
    ).toBeGreaterThanOrEqual(1);

    // Disable automatic refresh (the checkbox controls Queue AND Detail polling).
    fireEvent.click(screen.getByRole('checkbox', { name: /자동 새로고침/ }));

    const detailCountAfterDisable = calls.filter((call) =>
      call.url.includes('/activity/detail'),
    ).length;
    // Advance well past the 30s Detail interval (and the 15s Queue interval).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(70_000);
    });
    const detailCountLater = calls.filter((call) => call.url.includes('/activity/detail')).length;
    expect(detailCountLater).toBe(detailCountAfterDisable);

    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps polling the Detail at the detail interval while automatic refresh is enabled', async () => {
    vi.useFakeTimers();
    const { fetchMock, calls } = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const runtime = createRuntime();
    renderWorkspace(runtime, [
      '/activity?domain=SOURCES&activity=submission-1&resource=IntakeSubmission&resourceId=submission-1',
    ]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(
      calls.filter((call) => call.url.includes('/activity/detail')).length,
    ).toBeGreaterThanOrEqual(1);

    const detailCountBefore = calls.filter((call) => call.url.includes('/activity/detail')).length;
    // Advance past the 30s Detail interval: polling ON must re-read the Detail.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(70_000);
    });
    const detailCountAfter = calls.filter((call) => call.url.includes('/activity/detail')).length;
    expect(detailCountAfter).toBeGreaterThan(detailCountBefore);

    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});
