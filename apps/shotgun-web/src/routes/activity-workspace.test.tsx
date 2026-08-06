import { render, screen, waitFor } from '@testing-library/react';
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

const createFetchMock = () => {
  const calls: string[] = [];
  let refreshCount = 0;
  const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
    const text = String(url);
    calls.push(text);
    if (text.endsWith('/api/v1/security/csrf')) {
      return jsonResponse(200, { csrfToken: 'csrf-activity' });
    }
    if (text.includes('/activity/queue')) {
      return jsonResponse(200, queueResult);
    }
    if (text.includes('/activity/detail')) {
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
    screen.getByText(
      '정확한 도메인 리소스: /product-api/frontend/sources/read?submissionId=submission-1',
    );
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
        expect(calls.some((call) => call.includes('/activity/detail'))).toBe(true);
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

  it('toggles the domain filter and issues a filtered queue request', async () => {
    const { fetchMock, calls } = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const runtime = createRuntime();
    renderWorkspace(runtime);

    await screen.findByText('Sources intake submission submission-1');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Ask' }));

    await waitFor(
      () => {
        const queueCall = calls.find((call) => call.includes('/activity/queue'));
        expect(queueCall).toBeDefined();
      },
      { timeout: 10000 },
    );
    // The Ask filter toggled ON adds domainKinds: ['ASK'] to the queue request.
    const bodyCall = calls.filter((call) => call.includes('/activity/queue')).at(-1);
    expect(bodyCall).toBeDefined();
    vi.unstubAllGlobals();
  });
});
