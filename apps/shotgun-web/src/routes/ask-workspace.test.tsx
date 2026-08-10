import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import type {
  AskWorkspaceClient,
  AskWorkspaceView,
  GlobalShellView,
  ShotgunApiClient,
  SourceLibraryPageView,
} from '@shotgun/api-client';

import { createFrontendQueryClient } from '../app/query-client.js';
import { AppProviders, type AppRuntime } from '../app/providers.js';
import { useLeaveGuard } from '../session/leave-guard-context.js';
import { createSessionCycleState } from '../session/session-query.js';
import { AskWorkspace } from './ask-workspace.js';

const mockShell: GlobalShellView = {
  schemaVersion: '1.0.0',
  principalId: 'user-1',
  sessionId: 'sess-1',
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
  notifications: { unreadCount: 0, presentationRevision: 'p1' },
  accessRevision: '1',
  policyContextRevision: '1',
  projectionRevision: '1',
  fetchedAt: '2026-07-31T00:00:00.000Z',
};

const mockWorkspace: AskWorkspaceView = {
  schemaVersion: '1.0.0',
  principalId: 'user-1',
  sessionId: 'sess-1',
  projectId: 'project-1',
  defaultAskMode: 'CANONICAL_ONLY',
  availableAskModes: ['CANONICAL_ONLY', 'SOURCE_EXPLORATION', 'HYBRID'],
  conversations: [
    {
      conversationId: 'conv-1',
      projectId: 'project-1',
      title: 'Canonical Architecture Query',
      activeBranchId: 'branch-1',
      turnCount: 1,
      latestRunState: 'SUCCEEDED',
      updatedAt: '2026-07-31T00:00:00.000Z',
    },
  ],
  selectedConversation: {
    schemaVersion: '1.0.0',
    conversationId: 'conv-1',
    projectId: 'project-1',
    title: 'Canonical Architecture Query',
    activeBranchId: 'branch-1',
    branches: [
      {
        branchId: 'branch-1',
        label: 'Main Branch',
        turns: [
          {
            turnId: 'turn-1',
            ordinal: 1,
            userMessage: 'What is canonical?',
            createdAt: '2026-07-31T00:00:00.000Z',
            answerRun: {
              schemaVersion: '1.0.0',
              answerRunId: 'run-1',
              conversationId: 'conv-1',
              branchId: 'branch-1',
              turnId: 'turn-1',
              projectId: 'project-1',
              mode: 'CANONICAL_ONLY',
              state: 'SUCCEEDED',
              question: 'What is canonical?',
              statements: [
                {
                  statementId: 'stmt-1',
                  text: 'Canonical knowledge is authoritative.',
                  citations: [
                    {
                      citationId: 'cit-1',
                      sourceId: 'src-1',
                      sourceVersionId: 'ver-1',
                      evidenceId: 'ev-1',
                    },
                  ],
                },
              ],
              sourceSelections: [],
              capabilities: [],
              answerRevision: 'a-1',
              conversationRevision: 'c-1',
              accessRevision: '1',
              policyContextRevision: '1',
              createdAt: '2026-07-31T00:00:00.000Z',
              updatedAt: '2026-07-31T00:00:00.000Z',
              stale: false,
            },
          },
        ],
      },
    ],
    conversationRevision: 'c-1',
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
  },
  capabilities: [],
  projectionRevision: 'p-1',
  accessRevision: '1',
  policyContextRevision: '1',
  fetchedAt: '2026-07-31T00:00:00.000Z',
  stale: false,
};

const sourceLibraryPage: SourceLibraryPageView = {
  schemaVersion: '1.0.0',
  principalId: 'user-1',
  sessionId: 'sess-1',
  projectId: 'project-1',
  items: [
    {
      sourceId: 'source-ready',
      projectId: 'project-1',
      label: 'Ready source',
      mediaType: 'text/plain',
      lifecycle: 'ACTIVE',
      previewReadiness: 'READY',
      askUsageState: 'SOURCE_VERSION_READY',
      askUsageExplanation: 'The immutable SourceVersion is available for selection.',
      selectedSourceVersionId: 'version-ready-v1',
      versionCount: 1,
      capabilities: ['PREVIEW', 'SELECT_FOR_ASK'],
      sensitivity: 'private',
      updatedAt: '2026-08-11T00:00:00.000Z',
    },
    {
      sourceId: 'source-unavailable',
      projectId: 'project-1',
      label: 'Unavailable source',
      mediaType: 'text/plain',
      lifecycle: 'ACTION_REQUIRED',
      previewReadiness: 'NOT_READY',
      askUsageState: 'ACTION_REQUIRED',
      askUsageExplanation: 'Source processing requires attention.',
      selectedSourceVersionId: 'version-unavailable-v1',
      versionCount: 1,
      capabilities: [],
      sensitivity: 'private',
      updatedAt: '2026-08-11T00:00:00.000Z',
    },
    {
      sourceId: 'source-other-project',
      projectId: 'project-2',
      label: 'Other Project source',
      mediaType: 'text/plain',
      lifecycle: 'ACTIVE',
      previewReadiness: 'READY',
      askUsageState: 'SOURCE_VERSION_READY',
      askUsageExplanation: 'This item must not cross the Project boundary.',
      selectedSourceVersionId: 'version-other-v1',
      versionCount: 1,
      capabilities: ['SELECT_FOR_ASK'],
      sensitivity: 'private',
      updatedAt: '2026-08-11T00:00:00.000Z',
    },
  ],
  queryDigest: `sha256:${'a'.repeat(64)}`,
  projectionRevision: 'sources-1',
  accessRevision: '1',
  policyContextRevision: '1',
  fetchedAt: '2026-08-11T00:00:00.000Z',
  stale: false,
};

const createRuntime = (libraryPage = sourceLibraryPage): AppRuntime => ({
  apiClient: {
    listSources: vi.fn(async () => libraryPage),
  } as unknown as ShotgunApiClient,
  queryClient: createFrontendQueryClient(),
  sessionCycleState: createSessionCycleState(),
});

const LeaveGuardStatus = () => {
  const { getLeaveState } = useLeaveGuard();
  return (
    <div data-testid="leave-status">
      {getLeaveState().canLeaveCurrentContext ? 'ALLOWED' : 'BLOCKED'}
    </div>
  );
};

const ShellOutlet = () => <Outlet context={{ shell: mockShell }} />;

describe('AskWorkspace', () => {
  it('renders Ask Workspace server data and conversation tree', async () => {
    const runtime = createRuntime();
    const mockClient: AskWorkspaceClient = {
      getWorkspace: vi.fn().mockResolvedValue(mockWorkspace),
      getConversation: vi.fn().mockResolvedValue(mockWorkspace.selectedConversation!),
      getBranch: vi.fn(),
      getAnswerRun: vi
        .fn()
        .mockResolvedValue(mockWorkspace.selectedConversation!.branches[0]!.turns[0]!.answerRun),
      getAnswerRunEvents: vi.fn().mockResolvedValue({
        schemaVersion: '1.0.0',
        answerRunId: 'run-1',
        events: [],
      }),
      submitQuestion: vi.fn(),
      getQuestionSubmissionByClientRequestId: vi.fn(),
    };

    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <ShellOutlet />,
          children: [
            {
              path: 'ask',
              element: (
                <div>
                  <LeaveGuardStatus />
                  <AskWorkspace client={mockClient} />
                </div>
              ),
            },
          ],
        },
      ],
      { initialEntries: ['/ask'] },
    );

    render(
      <AppProviders runtime={runtime}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    expect(screen.getByText('Loading Ask workspace…')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Ask' })).toBeTruthy();
    });

    expect((screen.getByLabelText('Ask mode') as HTMLSelectElement).value).toBe('CANONICAL_ONLY');
    expect(screen.getAllByText('Canonical Architecture Query').length).toBeGreaterThan(0);
    expect(screen.getByText('What is canonical?')).toBeTruthy();
    expect(screen.getByText('Canonical knowledge is authoritative.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open pinned Evidence' }).getAttribute('href')).toBe(
      '/sources/src-1?version=ver-1',
    );
    await waitFor(() => expect(mockClient.getAnswerRunEvents).toHaveBeenCalled());
    expect(mockClient.getAnswerRunEvents).toHaveBeenCalledWith(
      'run-1',
      undefined,
      expect.objectContaining({ signal: expect.any(Object) }),
    );
  });

  it('triggers Leave Guard when question text is typed and isolates draft per project owner', async () => {
    const user = userEvent.setup();
    const runtime = createRuntime();
    const mockClient: AskWorkspaceClient = {
      getWorkspace: vi.fn().mockResolvedValue(mockWorkspace),
      getConversation: vi.fn().mockResolvedValue(mockWorkspace.selectedConversation!),
      getBranch: vi.fn(),
      getAnswerRun: vi.fn(),
      submitQuestion: vi.fn(),
      getQuestionSubmissionByClientRequestId: vi.fn(),
    };

    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <ShellOutlet />,
          children: [
            {
              path: 'ask',
              element: (
                <div>
                  <LeaveGuardStatus />
                  <AskWorkspace client={mockClient} />
                </div>
              ),
            },
          ],
        },
      ],
      { initialEntries: ['/ask'] },
    );

    render(
      <AppProviders runtime={runtime}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('leave-status').textContent).toBe('ALLOWED');
    });

    const submitBtn = screen.getByRole('button', { name: 'Submit question' });
    expect((submitBtn as HTMLButtonElement).disabled).toBe(true);

    const textarea = screen.getByLabelText('Question');
    await user.type(textarea, 'Is this draft protected?');

    expect(screen.getByTestId('leave-status').textContent).toBe('BLOCKED');

    await user.clear(textarea);
    expect(screen.getByTestId('leave-status').textContent).toBe('ALLOWED');
  });

  it('uses the semantic form layout and keeps CANONICAL_ONLY submissions source-free', async () => {
    const user = userEvent.setup();
    const runtime = createRuntime();
    const submitQuestion = vi.fn(() => new Promise<never>(() => undefined));
    const workspace = { ...mockWorkspace, capabilities: ['SUBMIT_QUESTION'] as const };
    const mockClient: AskWorkspaceClient = {
      getWorkspace: vi.fn().mockResolvedValue(workspace),
      getConversation: vi.fn().mockResolvedValue(workspace.selectedConversation!),
      getBranch: vi.fn(),
      getAnswerRun: vi.fn(),
      submitQuestion,
      getQuestionSubmissionByClientRequestId: vi.fn(),
    };
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <ShellOutlet />,
          children: [{ path: 'ask', element: <AskWorkspace client={mockClient} /> }],
        },
      ],
      { initialEntries: ['/ask'] },
    );

    render(
      <AppProviders runtime={runtime}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    const questionInput = await screen.findByLabelText('Question');
    expect(questionInput.closest('form')?.classList.contains('ask-question-form')).toBe(true);
    await user.type(questionInput, 'What is canonical?');
    await user.click(screen.getByRole('button', { name: 'Submit question' }));

    await waitFor(() => expect(submitQuestion).toHaveBeenCalledTimes(1));
    expect(submitQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'CANONICAL_ONLY',
        question: 'What is canonical?',
        sourceSelections: [],
      }),
    );
    expect(runtime.apiClient.listSources).not.toHaveBeenCalled();
  });

  it('pins an authorized SourceVersion into SOURCE_EXPLORATION submissions', async () => {
    const user = userEvent.setup();
    const runtime = createRuntime();
    const submitQuestion = vi.fn(() => new Promise<never>(() => undefined));
    const workspace = { ...mockWorkspace, capabilities: ['SUBMIT_QUESTION'] as const };
    const mockClient: AskWorkspaceClient = {
      getWorkspace: vi.fn().mockResolvedValue(workspace),
      getConversation: vi.fn().mockResolvedValue(workspace.selectedConversation!),
      getBranch: vi.fn(),
      getAnswerRun: vi.fn(),
      submitQuestion,
      getQuestionSubmissionByClientRequestId: vi.fn(),
    };
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <ShellOutlet />,
          children: [{ path: 'ask', element: <AskWorkspace client={mockClient} /> }],
        },
      ],
      { initialEntries: ['/ask'] },
    );

    render(
      <AppProviders runtime={runtime}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    await user.selectOptions(await screen.findByLabelText('Ask mode'), 'SOURCE_EXPLORATION');
    const readySource = await screen.findByRole('checkbox', { name: /Ready source/ });
    const unavailableSource = screen.getByRole('checkbox', { name: /Unavailable source/ });
    expect((unavailableSource as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByText('Other Project source')).toBeNull();
    expect(screen.getByText(/Pinned SourceVersion: version-ready-v1/)).toBeTruthy();

    const questionInput = screen.getByLabelText('Question');
    await user.type(questionInput, 'What does this Source establish?');
    const submitButton = screen.getByRole('button', { name: 'Submit question' });
    expect((submitButton as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen.getByText('Select at least one Source before using SOURCE_EXPLORATION.'),
    ).toBeTruthy();

    await user.click(readySource);
    expect((submitButton as HTMLButtonElement).disabled).toBe(false);
    await user.click(submitButton);

    await waitFor(() => expect(submitQuestion).toHaveBeenCalledTimes(1));
    expect(submitQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'SOURCE_EXPLORATION',
        sourceSelections: [
          {
            sourceId: 'source-ready',
            sourceVersionId: 'version-ready-v1',
            evidenceIds: [],
          },
        ],
      }),
    );
  });
});
