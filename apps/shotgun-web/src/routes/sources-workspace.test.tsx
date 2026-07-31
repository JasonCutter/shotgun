import { render, screen } from '@testing-library/react';
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

const createRuntime = (): AppRuntime => {
  const apiClient = {
    listSources: vi.fn(async () => libraryPage),
    getSourceDetail: vi.fn(async () => detail),
    getSourceVersionHistory: vi.fn(async () => history),
    getSourcePreview: vi.fn(async () => preview),
    getSourceEvidence: vi.fn(async () => evidence),
    getExactDuplicateDecision: vi.fn(),
  } as unknown as ShotgunApiClient;
  return {
    apiClient,
    queryClient: createFrontendQueryClient(),
    sessionCycleState: createSessionCycleState(),
  };
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

describe('Sources Workspace', () => {
  it('renders server state, keeps search private, and activates valid draft submission', async () => {
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
    await userEvent.type(screen.getByLabelText('Direct Text'), 'Local draft');
    await userEvent.click(screen.getByRole('button', { name: 'Add intake draft' }));
    expect(
      (screen.getByRole('button', { name: 'Submit drafts' }) as HTMLButtonElement).disabled,
    ).toBe(false);

    await userEvent.type(screen.getByLabelText('Search Sources'), 'private phrase');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(router.state.location.search).toBe('');
    expect(runtime.apiClient.listSources).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: 'private phrase' }),
      expect.any(Object),
    );
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
    expect(screen.getByText('EVIDENCE_READY')).toBeTruthy();
    expect(runtime.apiClient.getSourcePreview).toHaveBeenCalledWith(
      'source-1',
      'version-2',
      'ORIGINAL',
      expect.any(Object),
    );
  });

  it('focuses pinned Evidence and preserves typed Citation return identity', async () => {
    const runtime = createRuntime();
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

    const evidenceItem = await screen.findByText('Original evidence', { selector: 'strong' });
    expect(evidenceItem.parentElement).toBe(document.activeElement);
    await userEvent.click(screen.getByRole('link', { name: 'Return to cited resource' }));
    expect(await screen.findByText('Conversation restored')).toBeTruthy();
    expect(router.state.location.state).toMatchObject({
      citationReturn: {
        conversationId: 'conversation-1',
        branchId: 'branch-1',
        turnId: 'turn-1',
        answerRunId: 'answer-run-1',
        resourceRevision: 'conversation-7',
        citationId: 'citation-1',
      },
    });
  });
});
