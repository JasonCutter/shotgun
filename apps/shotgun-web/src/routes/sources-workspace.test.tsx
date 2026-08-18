import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import type {
  EvidenceListView,
  GlobalShellView,
  ShotgunApiClient,
  SourceDetailView,
  SourceLibraryPageView,
  SourcePreviewView,
  SourceVersionHistoryView,
} from '@shotgun/api-client';

import { createFrontendQueryClient } from '../app/query-client.js';
import { AppProviders, type AppRuntime } from '../app/providers.js';
import { ProductLocalizationProvider } from '../localization/product-localization.js';
import { createSessionCycleState } from '../session/session-query.js';
import { useLeaveGuard } from '../session/leave-guard-context.js';
import { SourceDetailWorkspace } from './source-detail-workspace.js';
import { SourcesWorkspace } from './sources-workspace.js';

const now = '2026-07-30T12:00:00.000Z';
const hash = `sha256:${'a'.repeat(64)}`;

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

const libraryPage: SourceLibraryPageView = {
  schemaVersion: '1.0.0',
  principalId: 'principal-1',
  sessionId: 'session-1',
  projectId: 'project-1',
  items: [
    {
      sourceId: 'source-1',
      projectId: 'project-1',
      label: 'Evidence notes',
      mediaType: 'text/markdown',
      lifecycle: 'ACTIVE',
      previewReadiness: 'READY',
      askUsageState: 'EVIDENCE_READY',
      askUsageExplanation: 'Evidence is ready.',
      selectedSourceVersionId: 'version-2',
      versionCount: 2,
      capabilities: ['PREVIEW', 'SELECT_FOR_ASK'],
      sensitivity: 'internal',
      updatedAt: now,
    },
  ],
  queryDigest: hash,
  projectionRevision: 'sources-1',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  fetchedAt: now,
  stale: false,
};

const detail: SourceDetailView = {
  schemaVersion: '1.0.0',
  sourceId: 'source-1',
  projectId: 'project-1',
  label: 'Evidence notes',
  lifecycle: 'ACTIVE',
  mediaType: 'text/markdown',
  sensitivity: 'internal',
  currentSourceVersionId: 'version-2',
  versionCount: 2,
  previewReadiness: 'READY',
  askUsageState: 'EVIDENCE_READY',
  askUsageExplanation: 'Evidence is ready.',
  capabilities: ['PREVIEW', 'SELECT_FOR_ASK'],
  sourceRevision: 'source-2',
  projectionRevision: 'sources-1',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  createdAt: now,
  updatedAt: now,
};

const history: SourceVersionHistoryView = {
  schemaVersion: '1.0.0',
  sourceId: 'source-1',
  projectId: 'project-1',
  selectedSourceVersionId: 'version-2',
  versions: [
    {
      sourceVersionId: 'version-2',
      versionNumber: 2,
      contentHash: hash,
      mediaType: 'text/markdown',
      sizeBytes: 12,
      createdAt: now,
      transformationState: 'READY',
      evidenceCount: 1,
    },
  ],
  projectionRevision: 'sources-1',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  fetchedAt: now,
};

const preview: SourcePreviewView = {
  schemaVersion: '1.0.0',
  sourceId: 'source-1',
  sourceVersionId: 'version-2',
  projectId: 'project-1',
  mediaType: 'text/markdown',
  contentHash: hash,
  mode: 'ORIGINAL',
  readiness: 'READY',
  text: 'Original evidence',
  locators: [],
  capabilities: ['PREVIEW'],
  projectionRevision: 'sources-1',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  fetchedAt: now,
};

const evidence: EvidenceListView = {
  schemaVersion: '1.0.0',
  projectId: 'project-1',
  sourceId: 'source-1',
  sourceVersionId: 'version-2',
  items: [
    {
      evidenceId: 'evidence-1',
      sourceId: 'source-1',
      sourceVersionId: 'version-2',
      revisionId: 'revision-1',
      label: 'Original evidence',
      origin: 'ORIGINAL',
      exactText: 'Original evidence',
      locators: [],
      createdAt: now,
    },
  ],
  projectionRevision: 'sources-1',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  fetchedAt: now,
};

const createRuntime = (
  page: SourceLibraryPageView = libraryPage,
  locale: 'en-US' | 'ko-KR' = 'en-US',
): AppRuntime => {
  const apiClient = {
    listSources: vi.fn(async () => page),
    getSourceDetail: vi.fn(async () => detail),
    getSourceVersionHistory: vi.fn(async () => history),
    getSourcePreview: vi.fn(async () => preview),
    getSourceEvidence: vi.fn(async () => evidence),
    getExactDuplicateDecision: vi.fn(),
    getPrincipalPreferences: vi.fn(async () => ({ preferences: { locale }, revision: 1 })),
  } as unknown as ShotgunApiClient;
  return {
    apiClient,
    queryClient: createFrontendQueryClient(),
    sessionCycleState: createSessionCycleState(),
  };
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const renderCitationDetail = (runtime: AppRuntime) => {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <ShellOutlet />,
        children: [
          { path: 'sources/:sourceId', element: <SourceDetailWorkspace /> },
          { path: 'ask/conversations/:conversationId', element: <p>Conversation restored</p> },
        ],
      },
    ],
    {
      initialEntries: [
        {
          pathname: '/sources/source-1',
          search: '?version=version-2',
          state: {
            citationReturnTarget: {
              schemaVersion: '1.0.0',
              originRoute: '/ask/conversations/conversation-1',
              resourceKind: 'conversation',
              resourceId: 'conversation-1',
              conversationId: 'conversation-1',
              branchId: 'branch-1',
              turnId: 'turn-1',
              answerRunId: 'answer-run-1',
              answerRevision: 'answer-revision-1',
              resourceRevision: 'conversation-7',
              citationId: 'citation-1',
              sourceId: 'source-1',
              sourceVersionId: 'version-2',
              evidenceId: 'evidence-1',
              scrollAnchor: 'citation-1',
              focusTarget: 'citation-1',
              panelId: 'evidence-panel',
            },
          },
        },
      ],
    },
  );
  render(
    <AppProviders runtime={runtime}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
};

const ShellOutlet = () => {
  const { getLeaveState } = useLeaveGuard();
  return (
    <>
      <button
        type="button"
        onClick={() =>
          document.body.setAttribute('data-leave-state', JSON.stringify(getLeaveState()))
        }
      >
        Inspect leave state
      </button>
      <Outlet context={{ shell }} />
    </>
  );
};

const LocalizedShellOutlet = () => (
  <ProductLocalizationProvider principalId={shell.principalId}>
    <ShellOutlet />
  </ProductLocalizationProvider>
);

describe('Sources Workspace', () => {
  it('localizes ko-KR Sources controls and readiness without changing Source content', async () => {
    const blockedSource: SourceLibraryPageView = {
      ...libraryPage,
      items: [
        {
          ...libraryPage.items[0]!,
          lifecycle: 'ACTION_REQUIRED',
          previewReadiness: 'NOT_READY',
          askUsageState: 'ACTION_REQUIRED',
          capabilities: [],
        },
      ],
    };
    const runtime = createRuntime(blockedSource, 'ko-KR');
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <LocalizedShellOutlet />,
          children: [{ path: 'sources', element: <SourcesWorkspace /> }],
        },
      ],
      { initialEntries: ['/sources'] },
    );
    render(
      <AppProviders runtime={runtime}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    expect(await screen.findByRole('heading', { name: '소스', level: 1 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '소스 라이브러리', level: 2 })).toBeTruthy();
    expect(screen.getByRole('link', { name: '소스 추가' })).toBeTruthy();
    expect(screen.queryByLabelText('입력 유형')).toBeNull();
    expect(screen.queryByLabelText('소스 분류')).toBeNull();
    expect(screen.getByText('이 소스를 사용하려면 확인이 필요합니다.')).toBeTruthy();
    expect(screen.getByText('Evidence notes')).toBeTruthy();
    expect(screen.getByText(/마크다운.*소스 분류.*내부/)).toBeTruthy();
    expect(screen.queryByText('This source needs attention before it can be used.')).toBeNull();
    expect(screen.queryByText('Input type')).toBeNull();
  });

  it('localizes ko-KR Source Detail enum labels and preserves source bytes', async () => {
    const user = userEvent.setup();
    const runtime = createRuntime(libraryPage, 'ko-KR');
    vi.mocked(runtime.apiClient.getSourceDetail).mockResolvedValue({
      ...detail,
      previewReadiness: 'FAILED',
      askUsageState: 'ACTION_REQUIRED',
    });
    vi.mocked(runtime.apiClient.getSourceVersionHistory).mockResolvedValue({
      ...history,
      versions: history.versions.map((version) => ({
        ...version,
        transformationState: 'RUNNING',
      })),
    });
    vi.mocked(runtime.apiClient.getSourceEvidence).mockResolvedValue({
      ...evidence,
      items: evidence.items.map((item) => ({ ...item, origin: 'SUMMARY' })),
    });
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <LocalizedShellOutlet />,
          children: [{ path: 'sources/:sourceId', element: <SourceDetailWorkspace /> }],
        },
      ],
      { initialEntries: ['/sources/source-1?version=version-2'] },
    );
    render(
      <AppProviders runtime={runtime}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    expect(await screen.findByRole('heading', { name: 'Evidence notes', level: 1 })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: '소스 상세 보기' })).toBeTruthy();
    expect(await screen.findByText('Original evidence', { selector: 'pre' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '원본 미리보기' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(screen.getByRole('button', { name: '근거' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '버전 기록' })).toBeTruthy();
    expect(screen.getByText(/미리보기.*미리보기 사용 불가/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '근거' }));
    expect(await screen.findByText('요약')).toBeTruthy();
    expect(router.state.location.search).toBe('?version=version-2&view=evidence');
    await user.click(screen.getByRole('button', { name: '버전 기록' }));
    expect(await screen.findByRole('button', { name: /버전 2.*마크다운.*처리 중/ })).toBeTruthy();
    expect(router.state.location.search).toBe('?version=version-2&view=versions');
    const askReadiness = screen.getByText(/질문 사용.*사용 전 확인 필요/);
    expect(askReadiness.textContent).toContain('Evidence is ready.');
    expect(screen.queryByText('Processing')).toBeNull();
    expect(screen.queryByText('Summary')).toBeNull();
  });

  it('renders server state, keeps search private, and activates valid draft submission', async () => {
    const user = userEvent.setup();
    const runtime = createRuntime();
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <ShellOutlet />,
          children: [{ path: 'sources', element: <SourcesWorkspace /> }],
        },
      ],
      { initialEntries: ['/sources'] },
    );
    render(
      <AppProviders runtime={runtime}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    expect(await screen.findByRole('heading', { name: 'Sources', level: 1 })).toBeTruthy();
    expect(await screen.findByText('Evidence notes')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open source' })).toBeTruthy();
    expect(screen.queryByText('Active')).toBeNull();
    expect(screen.queryByText('Preview ready')).toBeNull();
    expect(screen.queryByText('Available with indexed evidence')).toBeNull();
    expect(screen.queryByText('Evidence is ready.')).toBeNull();
    await user.type(screen.getByLabelText('Search Sources'), 'private phrase');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(router.state.location.search).toBe('');
    expect(runtime.apiClient.listSources).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: 'private phrase' }),
      expect.any(Object),
    );

    await user.click(screen.getByRole('link', { name: 'Add Source' }));
    expect(router.state.location.search).toBe('?view=add');
    expect(await screen.findByLabelText('Direct Text')).toBeTruthy();
    expect(screen.queryByLabelText('Source classification')).toBeNull();
    await user.type(screen.getByLabelText('Direct Text'), 'Local draft');
    await user.click(screen.getByRole('button', { name: 'Add intake draft' }));
    expect(
      (screen.getByRole('button', { name: 'Submit drafts' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('shows a concise problem only when Source readiness changes owner action', async () => {
    const blockedSource: SourceLibraryPageView = {
      ...libraryPage,
      items: [
        {
          ...libraryPage.items[0]!,
          sourceId: 'source-needs-attention',
          label: 'Source needing attention',
          lifecycle: 'ACTION_REQUIRED',
          previewReadiness: 'NOT_READY',
          askUsageState: 'ACTION_REQUIRED',
          askUsageExplanation: 'Internal processing detail that should not be shown.',
          capabilities: [],
        },
      ],
    };
    const runtime = createRuntime(blockedSource);
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <ShellOutlet />,
          children: [{ path: 'sources', element: <SourcesWorkspace /> }],
        },
      ],
      { initialEntries: ['/sources'] },
    );
    render(
      <AppProviders runtime={runtime}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    expect(await screen.findByText('Source needing attention')).toBeTruthy();
    expect(screen.getByText('This source needs attention before it can be used.')).toBeTruthy();
    expect(screen.queryByText('Internal processing detail that should not be shown.')).toBeNull();
    expect(screen.queryByText('Preview not ready')).toBeNull();
    expect(screen.queryByText('Needs attention before use')).toBeNull();
  });

  it('keeps route drafts project-fixed, validates advisory inputs, and registers Leave Guard', async () => {
    const runtime = createRuntime();
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <ShellOutlet />,
          children: [{ path: 'sources', element: <SourcesWorkspace /> }],
        },
      ],
      {
        initialEntries: [
          {
            pathname: '/sources',
            state: {
              intakeDraftSeed: {
                schemaVersion: '1.0.0',
                seedId: 'seed-1',
                projectId: 'project-seed',
                originatingWorkspace: 'ask',
                input: {
                  kind: 'FILE_METADATA',
                  label: 'Seeded file',
                  fileName: 'notes.md',
                  mediaType: 'text/markdown',
                  sizeBytes: 12,
                },
              },
            },
          },
        ],
      },
    );
    render(
      <AppProviders runtime={runtime}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    expect(await screen.findByText(/active Project changed/)).toBeTruthy();
    expect(screen.getByText(/Choose the file again/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Inspect leave state' }));
    expect(document.body.getAttribute('data-leave-state')).toContain('"hasUnsavedDraft":true');
    await userEvent.click(screen.getByRole('button', { name: 'Discard all drafts' }));
    await userEvent.selectOptions(screen.getByLabelText('Input type'), 'URL');
    await userEvent.type(screen.getByLabelText('URL'), 'file:///etc/passwd');
    await userEvent.click(screen.getByRole('button', { name: 'Add intake draft' }));
    expect(screen.getByText('Enter an absolute HTTP(S) URL.')).toBeTruthy();
  });

  it('pins detail, history, Preview and Evidence to the requested SourceVersion', async () => {
    const runtime = createRuntime();
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <ShellOutlet />,
          children: [{ path: 'sources/:sourceId', element: <SourceDetailWorkspace /> }],
        },
      ],
      { initialEntries: ['/sources/source-1?version=version-2'] },
    );
    render(
      <AppProviders runtime={runtime}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    expect(await screen.findByRole('heading', { name: 'Evidence notes', level: 1 })).toBeTruthy();
    expect(await screen.findByText('Original evidence', { selector: 'pre' })).toBeTruthy();
    expect(screen.queryByText('Available with indexed evidence')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Original Preview' }).getAttribute('aria-current'),
    ).toBe('page');
    expect(screen.getByRole('button', { name: 'Evidence' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    expect(
      screen.getByRole('button', { name: 'Version history' }).getAttribute('aria-pressed'),
    ).toBe('false');
    expect(screen.getByRole('heading', { name: 'Original Preview' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Evidence' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Version history' })).toBeNull();
    expect(runtime.apiClient.getSourcePreview).toHaveBeenCalledWith(
      'source-1',
      'version-2',
      'ORIGINAL',
      expect.any(Object),
    );
  });

  it('preserves typed Citation return identity across Source-local view navigation', async () => {
    const user = userEvent.setup();
    const runtime = createRuntime();
    const router = renderCitationDetail(runtime);

    const evidenceItem = await screen.findByText('Original evidence', { selector: 'p' });
    expect(evidenceItem.parentElement).toBe(document.activeElement);
    await user.click(screen.getByRole('button', { name: 'Original Preview' }));
    expect(screen.getByRole('link', { name: 'Return to cited resource' })).toBeTruthy();
    expect(router.state.location.state).toMatchObject({
      citationReturnTarget: {
        sourceId: 'source-1',
        sourceVersionId: 'version-2',
        citationId: 'citation-1',
      },
    });
    await user.click(screen.getByRole('button', { name: 'Evidence' }));
    const restoredEvidenceItem = await screen.findByText('Original evidence', {
      selector: 'p',
    });
    expect(restoredEvidenceItem.parentElement).toBe(document.activeElement);
    await user.click(screen.getByRole('link', { name: 'Return to cited resource' }));
    expect(await screen.findByText('Conversation restored')).toBeTruthy();
    expect(router.state.location.state).toMatchObject({
      citationReturn: {
        conversationId: 'conversation-1',
        branchId: 'branch-1',
        turnId: 'turn-1',
        answerRunId: 'answer-run-1',
        resourceRevision: 'conversation-7',
        citationId: 'citation-1',
        scrollAnchor: 'citation-1',
        focusTarget: 'citation-1',
        panelId: 'evidence-panel',
      },
    });
  });

  it('focuses the exact citation Evidence when Evidence resolves before detail', async () => {
    const runtime = createRuntime();
    const detailRequest = deferred<SourceDetailView>();
    const evidenceRequest = deferred<EvidenceListView>();
    runtime.apiClient.getSourceDetail = vi.fn(async () => detailRequest.promise);
    runtime.apiClient.getSourceEvidence = vi.fn(async () => evidenceRequest.promise);
    renderCitationDetail(runtime);

    await act(async () => {
      evidenceRequest.resolve(evidence);
      await evidenceRequest.promise;
    });
    expect(screen.queryByRole('listitem', { name: /Original evidence/ })).toBeNull();

    await act(async () => {
      detailRequest.resolve(detail);
      await detailRequest.promise;
    });
    await waitFor(() =>
      expect(document.activeElement).toBe(document.getElementById('evidence-evidence-1')),
    );
  });

  it('focuses the exact citation Evidence when detail resolves before Evidence', async () => {
    const runtime = createRuntime();
    const detailRequest = deferred<SourceDetailView>();
    const evidenceRequest = deferred<EvidenceListView>();
    runtime.apiClient.getSourceDetail = vi.fn(async () => detailRequest.promise);
    runtime.apiClient.getSourceEvidence = vi.fn(async () => evidenceRequest.promise);
    renderCitationDetail(runtime);

    await act(async () => {
      detailRequest.resolve(detail);
      await detailRequest.promise;
    });
    expect(await screen.findByRole('heading', { name: 'Evidence notes', level: 1 })).toBeTruthy();
    expect(document.getElementById('evidence-evidence-1')).toBeNull();

    await act(async () => {
      evidenceRequest.resolve(evidence);
      await evidenceRequest.promise;
    });
    await waitFor(() =>
      expect(document.activeElement).toBe(document.getElementById('evidence-evidence-1')),
    );
  });
});
