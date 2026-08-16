import { render, screen, waitFor, within } from '@testing-library/react';
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
import { AnswerCommandContextProvider } from '../commands/answer-command-context.js';
import { OwnerCommandPalette } from '../commands/owner-command-palette.js';
import { TechnicalDetails } from '../components/technical-details.js';
import { TechnicalInspectionProvider } from '../components/technical-inspection-context.js';
import { ProductLocalizationProvider } from '../localization/product-localization.js';
import { GlobalTools, OwnerCommandControllerProvider } from '../section3/global-tools.js';
import { useLeaveGuard } from '../session/leave-guard-context.js';
import { createSessionCycleState } from '../session/session-query.js';
import {
  AskWorkspace,
  AskShellConversationPane,
  AskShellGlobalComposer,
  AskShellProvider,
} from './ask-workspace.js';

const ShellWithAskOutlet = ({
  shell = mockShell,
  client,
}: {
  readonly shell?: GlobalShellView;
  readonly client?: AskWorkspaceClient;
}) => (
  <AnswerCommandContextProvider>
    <GlobalTools shell={shell}>
      {(controller) => {
        const commandMode = controller.commandMode ?? {
          open: false,
          initialQuery: '',
          resetQuerySignal: 0,
          invoker: null,
        };
        return (
          <OwnerCommandControllerProvider controller={controller}>
            <AskShellProvider shell={shell} client={client}>
              <Outlet context={{ shell }} />
              <AskShellConversationPane />
              <AskShellGlobalComposer />
              <OwnerCommandPalette
                open={commandMode.open}
                presentation="CENTER"
                commands={controller.commands}
                initialQuery={commandMode.initialQuery}
                resetQuerySignal={commandMode.resetQuerySignal}
                invoker={commandMode.invoker}
                onClose={controller.closeCommandMode ?? (() => undefined)}
                onSelect={(command) => controller.executeCommand(command, commandMode.invoker)}
              />
            </AskShellProvider>
          </OwnerCommandControllerProvider>
        );
      }}
    </GlobalTools>
  </AnswerCommandContextProvider>
);

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

const workspaceWithRunState = (
  state: AskWorkspaceView['conversations'][number]['latestRunState'],
): AskWorkspaceView => {
  const selectedConversation = mockWorkspace.selectedConversation!;
  return {
    ...mockWorkspace,
    conversations: mockWorkspace.conversations.map((conversation) => ({
      ...conversation,
      latestRunState: state,
    })),
    selectedConversation: {
      ...selectedConversation,
      branches: selectedConversation.branches.map((branch) => ({
        ...branch,
        turns: branch.turns.map((turn) => ({
          ...turn,
          answerRun: {
            ...turn.answerRun,
            state,
            ...(state === 'FAILED'
              ? {
                  statements: [],
                  failure: {
                    code: 'INTERNAL_UNCLASSIFIED' as const,
                    message: 'The answer could not be completed.',
                    retryable: false,
                    outcomeUnknown: false,
                  },
                }
              : {}),
          },
        })),
      })),
    },
  };
};

const eligibleProvider = {
  schemaVersion: '1.0.0' as const,
  eligible: true,
  reason: 'ELIGIBLE' as const,
  requiredAction: 'NONE' as const,
  policyFingerprint: 'test-policy',
  policyContextRevision: '1',
  provider: { displayName: 'Test provider', model: 'test-model' },
  message: 'Eligible.',
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
    getPrincipalPreferences: vi.fn(async () => ({
      preferences: {
        locale: 'ko-KR',
        timezone: 'Asia/Seoul',
        dateDisplay: 'YYYY-MM-DD',
        screenDensity: 'COMFORTABLE',
        reducedMotion: false,
      },
      revision: 1,
    })),
    getPrivacyRetention: vi.fn(async () => ({
      availability: 'UNAVAILABLE',
      disabledReason: 'Privacy review data is unavailable in this test.',
    })),
    getSettingsSnapshot: vi.fn(async () => ({
      settingsRevision: 1,
      policyContextRevision: 1,
    })),
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

const commandShell: GlobalShellView = {
  ...mockShell,
  navigation: [
    {
      id: 'sources',
      label: 'Sources',
      availability: 'AVAILABLE',
      targetRoute: { routeId: 'sources', href: '/sources' },
    },
  ],
  features: [{ id: 'global-search', label: 'Search', availability: 'AVAILABLE' }],
};

const ShellOutlet = ({ shell = mockShell }: { readonly shell?: GlobalShellView }) => (
  <AnswerCommandContextProvider>
    <GlobalTools shell={shell}>
      {(controller) => {
        const commandMode = controller.commandMode ?? {
          open: false,
          initialQuery: '',
          resetQuerySignal: 0,
          invoker: null,
        };
        return (
          <OwnerCommandControllerProvider controller={controller}>
            <Outlet context={{ shell }} />
            <OwnerCommandPalette
              open={commandMode.open}
              presentation="CENTER"
              commands={controller.commands}
              initialQuery={commandMode.initialQuery}
              resetQuerySignal={commandMode.resetQuerySignal}
              invoker={commandMode.invoker}
              onClose={controller.closeCommandMode ?? (() => undefined)}
              onSelect={(command) => controller.executeCommand(command, commandMode.invoker)}
            />
          </OwnerCommandControllerProvider>
        );
      }}
    </GlobalTools>
  </AnswerCommandContextProvider>
);

const LocalizedShellOutlet = () => (
  <ProductLocalizationProvider principalId={mockShell.principalId}>
    <ShellOutlet />
  </ProductLocalizationProvider>
);

describe('AskWorkspace', () => {
  it('renders ko-KR owner controls while preserving Source and answer content', async () => {
    const runtime = createRuntime();
    const mockClient: AskWorkspaceClient = {
      getProviderEligibility: vi.fn().mockResolvedValue(eligibleProvider),
      getWorkspace: vi.fn().mockResolvedValue(mockWorkspace),
      getConversation: vi.fn().mockResolvedValue(mockWorkspace.selectedConversation!),
      getConversationSourceContext: vi.fn(),
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
          element: <LocalizedShellOutlet />,
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

    expect(await screen.findByRole('heading', { name: '질문', level: 1 })).toBeTruthy();
    const askMode = screen.getByLabelText('질문 방식');
    expect(within(askMode).getByRole('option', { name: '검증된 지식만 사용' })).toBeTruthy();
    expect(within(askMode).getByRole('option', { name: '선택한 소스 사용' })).toBeTruthy();
    await userEvent.selectOptions(askMode, 'SOURCE_EXPLORATION');
    expect((await screen.findAllByText('소스 범위')).length).toBeGreaterThan(0);
    expect(await screen.findByText('질문에 사용 가능')).toBeTruthy();
    expect(screen.getAllByText('버전 1').length).toBeGreaterThan(0);
    expect(screen.getByText('Canonical knowledge is authoritative.')).toBeTruthy();
    expect(screen.getByText('(현재 대화)')).toBeTruthy();
    expect(screen.queryByText('Ask mode')).toBeNull();
    expect(screen.queryByText('Source context')).toBeNull();
    expect(screen.queryByText('Available for questions')).toBeNull();
  });

  it('shows server-authoritative ACTION_REQUIRED and blocks predictable policy denial', async () => {
    const runtime = createRuntime();
    const workspace = { ...mockWorkspace, capabilities: ['SUBMIT_QUESTION'] as const };
    const mockClient: AskWorkspaceClient = {
      getProviderEligibility: vi.fn().mockResolvedValue({
        schemaVersion: '1.0.0',
        eligible: false,
        reason: 'PROJECT_APPROVAL_REQUIRED',
        requiredAction: 'REVIEW_PROJECT_PRIVACY_SETTINGS',
        policyFingerprint: 'test-policy-denied',
        policyContextRevision: '2',
        provider: { displayName: 'Test provider', model: 'test-model' },
        message: 'A Project Owner must complete the privacy review.',
      }),
      getWorkspace: vi.fn().mockResolvedValue(workspace),
      getConversation: vi.fn().mockResolvedValue(workspace.selectedConversation!),
      getConversationSourceContext: vi.fn(),
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
    expect(
      await screen.findByText(/A Project Owner must complete the privacy review/),
    ).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Submit question' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(mockClient.submitQuestion).not.toHaveBeenCalled();
  });

  it('renders Ask Workspace server data and conversation tree', async () => {
    const runtime = createRuntime();
    const mockClient: AskWorkspaceClient = {
      getProviderEligibility: vi.fn().mockResolvedValue({
        schemaVersion: '1.0.0',
        eligible: true,
        reason: 'ELIGIBLE',
        requiredAction: 'NONE',
        policyFingerprint: 'test-policy',
        policyContextRevision: '1',
        provider: { displayName: 'Test provider', model: 'test-model' },
        message: 'Eligible.',
      }),
      getWorkspace: vi.fn().mockResolvedValue(mockWorkspace),
      getConversation: vi.fn().mockResolvedValue(mockWorkspace.selectedConversation!),
      getConversationSourceContext: vi.fn(),
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
    expect(screen.queryByText('Completed')).toBeNull();
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

  it('keeps conversation titles and current indication without routine run metadata', async () => {
    const runtime = createRuntime();
    const workspace: AskWorkspaceView = {
      ...mockWorkspace,
      conversations: [
        mockWorkspace.conversations[0]!,
        {
          ...mockWorkspace.conversations[0]!,
          conversationId: 'conv-2',
          title: 'Second Conversation',
          turnCount: 2,
        },
      ],
    };
    const mockClient: AskWorkspaceClient = {
      getProviderEligibility: vi.fn().mockResolvedValue(eligibleProvider),
      getWorkspace: vi.fn().mockResolvedValue(workspace),
      getConversation: vi.fn().mockResolvedValue(workspace.selectedConversation!),
      getConversationSourceContext: vi.fn(),
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
              path: 'ask/conversations/:conversationId',
              element: <AskWorkspace client={mockClient} />,
            },
          ],
        },
      ],
      { initialEntries: ['/ask/conversations/conv-1'] },
    );

    render(
      <AppProviders runtime={runtime}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    const conversations = await screen.findByRole('list', { name: 'Conversations' });
    const current = within(conversations).getByText('Canonical Architecture Query').closest('span');
    expect(current?.getAttribute('aria-current')).toBe('page');
    expect(
      within(conversations).queryByRole('link', { name: /Canonical Architecture Query/ }),
    ).toBeNull();
    expect(within(conversations).getByRole('link', { name: 'Second Conversation' })).toBeTruthy();
    expect(within(conversations).queryByText(/\bturns?\b/)).toBeNull();
    expect(within(conversations).queryByText('Completed')).toBeNull();
  });

  it.each([
    ['SUCCEEDED', null],
    ['FAILED', 'Failed'],
  ] as const)(
    'refetches one authoritative workspace when polling reaches %s',
    async (terminalState, expectedLabel) => {
      const runtime = createRuntime();
      const queuedWorkspace = workspaceWithRunState('QUEUED');
      const terminalWorkspace = workspaceWithRunState(terminalState);
      const getWorkspace = vi
        .fn()
        .mockResolvedValueOnce(queuedWorkspace)
        .mockResolvedValue(terminalWorkspace);
      const mockClient: AskWorkspaceClient = {
        getProviderEligibility: vi.fn().mockResolvedValue(eligibleProvider),
        getWorkspace,
        getConversation: vi.fn().mockResolvedValue(terminalWorkspace.selectedConversation!),
        getConversationSourceContext: vi.fn(),
        getBranch: vi.fn(),
        getAnswerRun: vi
          .fn()
          .mockResolvedValue(
            terminalWorkspace.selectedConversation!.branches[0]!.turns[0]!.answerRun,
          ),
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
                path: 'ask/conversations/:conversationId',
                element: <AskWorkspace client={mockClient} />,
              },
            ],
          },
        ],
        { initialEntries: ['/ask/conversations/conv-1'] },
      );

      render(
        <AppProviders runtime={runtime}>
          <RouterProvider router={router} />
        </AppProviders>,
      );

      const conversations = await screen.findByRole('list', { name: 'Conversations' });
      await waitFor(() => expect(getWorkspace).toHaveBeenCalledTimes(2));
      if (expectedLabel) {
        expect(conversations.textContent).toContain(expectedLabel);
      } else {
        expect(within(conversations).queryByText('Completed')).toBeNull();
      }
      expect(getWorkspace).toHaveBeenCalledTimes(2);
      expect(getWorkspace).toHaveBeenLastCalledWith(
        'conv-1',
        expect.objectContaining({ signal: expect.any(Object) }),
      );
      await new Promise((resolve) => window.setTimeout(resolve, 20));
      expect(getWorkspace).toHaveBeenCalledTimes(2);
    },
  );

  it('opens exact per-turn Answer commands after answer content without feedback controls', async () => {
    const user = userEvent.setup();
    const runtime = createRuntime();
    const selectedConversation = mockWorkspace.selectedConversation!;
    const workspace: AskWorkspaceView = {
      ...mockWorkspace,
      selectedConversation: {
        ...selectedConversation,
        branches: selectedConversation.branches.map((branch) => ({
          ...branch,
          turns: branch.turns.map((turn) => ({
            ...turn,
            answerRun: {
              ...turn.answerRun,
              capabilities: [
                'EXPORT',
                'CREATE_INTAKE_DRAFT',
                'CREATE_DRAFT_CHANGE_SET',
                'PROPOSE_DIRECTIVE',
              ],
            },
          })),
        })),
      },
    };
    const exportAnswerRun = vi.fn().mockResolvedValue({
      schemaVersion: '1.0.0',
      answerRunId: 'run-1',
      format: 'MARKDOWN',
      content: 'exported answer',
    });
    const mockClient: AskWorkspaceClient = {
      getProviderEligibility: vi.fn().mockResolvedValue(eligibleProvider),
      getWorkspace: vi.fn().mockResolvedValue(workspace),
      getConversation: vi.fn().mockResolvedValue(workspace.selectedConversation!),
      getConversationSourceContext: vi.fn(),
      getBranch: vi.fn(),
      getAnswerRun: vi.fn(),
      submitQuestion: vi.fn(),
      getQuestionSubmissionByClientRequestId: vi.fn(),
      exportAnswerRun,
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

    const actions = await screen.findByRole('button', { name: 'Answer actions' });
    const question = screen.getByText('What is canonical?').closest('p');
    const answer = screen.getByRole('heading', { name: 'Answer' });
    const evidence = screen.getByRole('link', { name: 'Open pinned Evidence' });
    expect(question?.compareDocumentPosition(answer)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(answer.compareDocumentPosition(evidence)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(evidence.compareDocumentPosition(actions)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.queryByRole('button', { name: 'Helpful' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Not helpful' })).toBeNull();
    for (const label of [
      'Export answer',
      'Propose Intake Draft',
      'Propose Draft ChangeSet',
      'Propose Directive',
    ]) {
      expect(screen.queryByRole('button', { name: label })).toBeNull();
    }

    await user.click(actions);
    const palette = screen.getByRole('region', { name: 'Commands' });
    await user.click(within(palette).getByRole('button', { name: /^Export answer/ }));
    const exportDialog = screen.getByRole('dialog', { name: 'Export answer' });
    await user.click(within(exportDialog).getByRole('button', { name: 'Export answer' }));

    expect(exportAnswerRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ format: 'MARKDOWN' }),
    );
    expect(await screen.findByText('exported answer')).toBeTruthy();
  });

  it('targets the active-branch latest answer for default Ask slash discovery', async () => {
    const user = userEvent.setup();
    const runtime = createRuntime();
    const selectedConversation = mockWorkspace.selectedConversation!;
    const activeTurn = {
      ...selectedConversation.branches[0]!.turns[0]!,
      answerRun: {
        ...selectedConversation.branches[0]!.turns[0]!.answerRun,
        capabilities: ['EXPORT'] as const,
      },
    };
    const inactiveTurn = {
      ...activeTurn,
      turnId: 'turn-inactive-latest',
      ordinal: 99,
      answerRun: {
        ...activeTurn.answerRun,
        answerRunId: 'run-inactive-latest',
        branchId: 'branch-2',
        turnId: 'turn-inactive-latest',
        answerRevision: 'answer-inactive-latest',
      },
    };
    const workspace: AskWorkspaceView = {
      ...mockWorkspace,
      selectedConversation: {
        ...selectedConversation,
        activeBranchId: 'branch-1',
        branches: [
          { ...selectedConversation.branches[0]!, turns: [activeTurn] },
          { branchId: 'branch-2', label: 'Inactive Branch', turns: [inactiveTurn] },
        ],
      },
    };
    const exportAnswerRun = vi.fn(async (answerRunId: string) => ({
      schemaVersion: '1.0.0' as const,
      exportId: `export-${answerRunId}`,
      answerRunId,
      projectId: 'project-1',
      format: 'MARKDOWN' as const,
      content: `exported:${answerRunId}`,
      createdAt: '2026-08-15T00:00:00.000Z',
    }));
    const mockClient: AskWorkspaceClient = {
      getProviderEligibility: vi.fn().mockResolvedValue(eligibleProvider),
      getWorkspace: vi.fn().mockResolvedValue(workspace),
      getConversation: vi.fn().mockResolvedValue(workspace.selectedConversation!),
      getConversationSourceContext: vi.fn(),
      getBranch: vi.fn(),
      getAnswerRun: vi.fn(),
      submitQuestion: vi.fn(),
      getQuestionSubmissionByClientRequestId: vi.fn(),
      exportAnswerRun,
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

    await user.type(await screen.findByLabelText('Question'), '/');
    const palette = screen.getByRole('region', { name: 'Commands' });
    await user.type(within(palette).getByRole('textbox', { name: 'Command search' }), 'export');
    await user.click(within(palette).getByRole('button', { name: /^Export answer/ }));
    const exportDialog = screen.getByRole('dialog', { name: 'Export answer' });
    await user.click(within(exportDialog).getByRole('button', { name: 'Export answer' }));

    expect(exportAnswerRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ format: 'MARKDOWN' }),
    );
    expect(exportAnswerRun).not.toHaveBeenCalledWith('run-inactive-latest', expect.anything());
  });

  it('triggers Leave Guard when question text is typed and isolates draft per project owner', async () => {
    const user = userEvent.setup();
    const runtime = createRuntime();
    const mockClient: AskWorkspaceClient = {
      getProviderEligibility: vi.fn().mockResolvedValue({
        schemaVersion: '1.0.0',
        eligible: true,
        reason: 'ELIGIBLE',
        requiredAction: 'NONE',
        policyFingerprint: 'test-policy',
        policyContextRevision: '1',
        provider: { displayName: 'Test provider', model: 'test-model' },
        message: 'Eligible.',
      }),
      getWorkspace: vi.fn().mockResolvedValue(mockWorkspace),
      getConversation: vi.fn().mockResolvedValue(mockWorkspace.selectedConversation!),
      getConversationSourceContext: vi.fn(),
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

  it('opens the shared slash palette only at the trigger position and does not submit a command as Ask text', async () => {
    const user = userEvent.setup();
    const runtime = createRuntime();
    const submitQuestion = vi.fn();
    const mockClient: AskWorkspaceClient = {
      getProviderEligibility: vi.fn().mockResolvedValue(eligibleProvider),
      getWorkspace: vi.fn().mockResolvedValue(mockWorkspace),
      getConversation: vi.fn().mockResolvedValue(mockWorkspace.selectedConversation!),
      getConversationSourceContext: vi.fn(),
      getBranch: vi.fn(),
      getAnswerRun: vi.fn(),
      submitQuestion,
      getQuestionSubmissionByClientRequestId: vi.fn(),
    };
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <ShellOutlet shell={commandShell} />,
          children: [
            { path: 'ask', element: <AskWorkspace client={mockClient} /> },
            { path: 'history', element: <p>History destination</p> },
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

    const questionInput = await screen.findByLabelText('Question');
    await user.type(questionInput, 'ratio / 2');
    expect(screen.queryByRole('region', { name: 'Commands' })).toBeNull();

    await user.clear(questionInput);
    await user.type(questionInput, '/');
    expect(screen.getByRole('region', { name: 'Commands' })).toBeTruthy();
    const commandSearch = screen.getByRole('textbox', { name: 'Command search' });
    await user.type(commandSearch, 'help');
    await user.keyboard('{Enter}');

    expect(screen.getByRole('region', { name: 'Commands' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Help' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Navigation' })).toBeTruthy();

    const reopenedCommandSearch = screen.getByRole('textbox', { name: 'Command search' });
    await user.type(reopenedCommandSearch, 'history');
    await user.keyboard('{Enter}');

    expect(submitQuestion).not.toHaveBeenCalled();
    expect(await screen.findByText('History destination')).toBeTruthy();
  });

  it('opens the shared Preferences surface from an Ask slash command', async () => {
    const user = userEvent.setup();
    const runtime = createRuntime();
    const mockClient: AskWorkspaceClient = {
      getProviderEligibility: vi.fn().mockResolvedValue(eligibleProvider),
      getWorkspace: vi.fn().mockResolvedValue(mockWorkspace),
      getConversation: vi.fn().mockResolvedValue(mockWorkspace.selectedConversation!),
      getConversationSourceContext: vi.fn(),
      getBranch: vi.fn(),
      getAnswerRun: vi.fn(),
      submitQuestion: vi.fn(),
      getQuestionSubmissionByClientRequestId: vi.fn(),
    };
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <ShellOutlet shell={commandShell} />,
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
    await user.type(questionInput, '/locale');
    await user.click(await screen.findByRole('button', { name: /^Set Locale/ }));

    expect(await screen.findByRole('dialog', { name: 'Locale Preferences' })).toBeTruthy();
    expect((screen.getByRole('combobox', { name: 'Locale' }) as HTMLSelectElement).value).toBe(
      'ko-KR',
    );
  });

  it('opens the shared AI surface from an Ask slash command', async () => {
    const user = userEvent.setup();
    const runtime = createRuntime();
    runtime.apiClient.getAISettings = vi.fn(
      async () =>
        ({
          projectId: 'project-1',
          mode: 'UNCONFIGURED',
          defaultProviderId: 'deepseek',
          providers: [
            {
              providerId: 'deepseek',
              displayName: 'DeepSeek',
              status: 'active',
              models: [
                {
                  providerId: 'deepseek',
                  modelId: 'deepseek-test',
                  displayName: 'DeepSeek Test',
                  shotgunUsableCapabilities: ['ASK'],
                  capabilityRevision: 'cap-1',
                },
              ],
            },
          ],
          credentialStatuses: [],
          privacy: [],
          vaultAvailability: { state: 'UNAVAILABLE', reason: 'MISSING_MASTER_KEY' },
          legacyGeminiCredentialConfigured: false,
        }) as never,
    );
    const mockClient: AskWorkspaceClient = {
      getProviderEligibility: vi.fn().mockResolvedValue(eligibleProvider),
      getWorkspace: vi.fn().mockResolvedValue(mockWorkspace),
      getConversation: vi.fn().mockResolvedValue(mockWorkspace.selectedConversation!),
      getConversationSourceContext: vi.fn(),
      getBranch: vi.fn(),
      getAnswerRun: vi.fn(),
      submitQuestion: vi.fn(),
      getQuestionSubmissionByClientRequestId: vi.fn(),
    };
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <ShellOutlet shell={commandShell} />,
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
    await user.type(questionInput, '/ai');
    await user.click(await screen.findByRole('button', { name: /^Configure AI/ }));

    expect(await screen.findByRole('dialog', { name: 'Configure AI' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /settings/i })).toBeNull();
  });

  it('opens current technical information from slash without submitting Ask text', async () => {
    const user = userEvent.setup();
    const runtime = createRuntime();
    const submitQuestion = vi.fn();
    const mockClient: AskWorkspaceClient = {
      getProviderEligibility: vi.fn().mockResolvedValue(eligibleProvider),
      getWorkspace: vi.fn().mockResolvedValue(mockWorkspace),
      getConversation: vi.fn().mockResolvedValue(mockWorkspace.selectedConversation!),
      getConversationSourceContext: vi.fn(),
      getBranch: vi.fn(),
      getAnswerRun: vi.fn(),
      submitQuestion,
      getQuestionSubmissionByClientRequestId: vi.fn(),
    };
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <ShellOutlet shell={commandShell} />,
          children: [{ path: 'ask', element: <AskWorkspace client={mockClient} /> }],
        },
      ],
      { initialEntries: ['/ask'] },
    );

    render(
      <AppProviders runtime={runtime}>
        <TechnicalInspectionProvider>
          <TechnicalDetails items={[{ label: 'Source ID', value: 'source-current' }]} />
          <RouterProvider router={router} />
        </TechnicalInspectionProvider>
      </AppProviders>,
    );

    const questionInput = await screen.findByLabelText('Question');
    await user.type(questionInput, '/technical');
    await user.click(await screen.findByRole('button', { name: /^Technical information/ }));

    const dialog = await screen.findByRole('dialog', { name: 'Technical information' });
    expect(within(dialog).getByText('source-current')).toBeTruthy();
    expect((questionInput as HTMLTextAreaElement).value).toBe('');
    expect(submitQuestion).not.toHaveBeenCalled();
  });

  it('uses the semantic form layout and keeps CANONICAL_ONLY submissions source-free', async () => {
    const user = userEvent.setup();
    const runtime = createRuntime();
    const submitQuestion = vi.fn(() => new Promise<never>(() => undefined));
    const workspace = { ...mockWorkspace, capabilities: ['SUBMIT_QUESTION'] as const };
    const mockClient: AskWorkspaceClient = {
      getProviderEligibility: vi.fn().mockResolvedValue({
        schemaVersion: '1.0.0',
        eligible: true,
        reason: 'ELIGIBLE',
        requiredAction: 'NONE',
        policyFingerprint: 'test-policy',
        policyContextRevision: '1',
        provider: { displayName: 'Test provider', model: 'test-model' },
        message: 'Eligible.',
      }),
      getWorkspace: vi.fn().mockResolvedValue(workspace),
      getConversation: vi.fn().mockResolvedValue(workspace.selectedConversation!),
      getConversationSourceContext: vi.fn(),
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
    expect(questionInput.closest('form')?.classList.contains('global-composer')).toBe(true);
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
      getProviderEligibility: vi.fn().mockResolvedValue({
        schemaVersion: '1.0.0',
        eligible: true,
        reason: 'ELIGIBLE',
        requiredAction: 'NONE',
        policyFingerprint: 'test-policy',
        policyContextRevision: '1',
        provider: { displayName: 'Test provider', model: 'test-model' },
        message: 'Eligible.',
      }),
      getWorkspace: vi.fn().mockResolvedValue(workspace),
      getConversation: vi.fn().mockResolvedValue(workspace.selectedConversation!),
      getConversationSourceContext: vi.fn(),
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
    expect(screen.getAllByText('Version 1')).toHaveLength(2);
    expect(screen.queryByText('version-ready-v1')).toBeNull();

    const questionInput = screen.getByLabelText('Question');
    await user.type(questionInput, 'What does this Source establish?');
    const submitButton = screen.getByRole('button', { name: 'Submit question' });
    expect((submitButton as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen.getByText('Select at least one Source before using selected sources.'),
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

  it('handles workspace pending state: allows draft typing, disables submit, queries no eligibility, advertises no invented modes', async () => {
    const user = userEvent.setup();
    const runtime = createRuntime();
    let resolveWorkspace: (ws: AskWorkspaceView) => void = () => {};
    const getWorkspacePromise = new Promise<AskWorkspaceView>((resolve) => {
      resolveWorkspace = resolve;
    });
    const getProviderEligibility = vi.fn().mockResolvedValue({
      schemaVersion: '1.0.0',
      eligible: true,
      reasons: [],
      message: 'Eligible.',
    });
    const submitQuestion = vi.fn();

    const mockClient: AskWorkspaceClient = {
      getProviderEligibility,
      getWorkspace: vi.fn().mockReturnValue(getWorkspacePromise),
      getConversation: vi.fn(),
      getConversationSourceContext: vi.fn(),
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

    // 1. Question draft can be entered while workspace is loading
    const questionInput = screen.getByLabelText('Question');
    await user.type(questionInput, 'Pending draft query');
    expect((questionInput as HTMLTextAreaElement).value).toBe('Pending draft query');

    // 2. Submit is disabled
    const submitButton = screen.getByRole('button', { name: 'Submit question' });
    expect((submitButton as HTMLButtonElement).disabled).toBe(true);

    // 3. No provider eligibility request occurred
    expect(getProviderEligibility).not.toHaveBeenCalled();

    // 4. No invented modes are advertised
    const modeSelect = screen.getByLabelText('Ask mode') as HTMLSelectElement;
    expect(modeSelect.options.length).toBe(1); // Only disabled placeholder
    expect(modeSelect.disabled).toBe(true);

    // Now resolve the workspace with custom modes
    resolveWorkspace({
      ...mockWorkspace,
      defaultAskMode: 'HYBRID',
      availableAskModes: ['HYBRID', 'CANONICAL_ONLY'],
    });

    // 5. Authoritative modes and default mode are applied
    await waitFor(() => expect(modeSelect.disabled).toBe(false));
    expect(modeSelect.value).toBe('HYBRID');
    const optionValues = Array.from(modeSelect.options).map((opt) => opt.value);
    expect(optionValues).toEqual(['HYBRID', 'CANONICAL_ONLY']);
  });

  it('preserves active Conversation A, workspace, draft, and explicit mode when Center navigates away from Ask', async () => {
    const user = userEvent.setup();
    const runtime = createRuntime();
    const getWorkspace = vi.fn().mockResolvedValue({
      ...mockWorkspace,
      defaultAskMode: 'CANONICAL_ONLY',
      availableAskModes: ['CANONICAL_ONLY', 'SOURCE_EXPLORATION'],
    });
    const mockClient: AskWorkspaceClient = {
      getProviderEligibility: vi.fn().mockResolvedValue({
        schemaVersion: '1.0.0',
        eligible: true,
        reasons: [],
        message: 'Eligible.',
      }),
      getWorkspace,
      getConversation: vi.fn().mockResolvedValue(mockWorkspace.selectedConversation!),
      getConversationSourceContext: vi.fn().mockResolvedValue({
        schemaVersion: '1.0.0',
        resourceProjectId: 'project-1',
        items: [],
      }),
      getBranch: vi.fn(),
      getAnswerRun: vi.fn(),
      submitQuestion: vi.fn(),
      getQuestionSubmissionByClientRequestId: vi.fn(),
    };

    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <ShellWithAskOutlet client={mockClient} />,
          children: [
            { path: 'ask', element: <AskWorkspace client={mockClient} /> },
            {
              path: 'ask/conversations/:conversationId',
              element: <AskWorkspace client={mockClient} />,
            },
            { path: 'sources', element: <div data-testid="sources-center">Sources Center</div> },
          ],
        },
      ],
      { initialEntries: ['/ask/conversations/conv-1'] },
    );

    render(
      <AppProviders runtime={runtime}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    // Initial Conversation A is loaded and visible
    expect(
      await screen.findByRole('heading', { name: 'Canonical Architecture Query' }),
    ).toBeTruthy();
    expect(getWorkspace).toHaveBeenCalledTimes(1);
    expect(getWorkspace).toHaveBeenCalledWith('conv-1', expect.anything());

    await user.selectOptions(await screen.findByLabelText('Ask mode'), 'SOURCE_EXPLORATION');
    const questionInput = screen.getByLabelText('Question');
    await user.type(questionInput, 'Draft while viewing Conversation A');

    // Navigate to /sources
    router.navigate('/sources');
    expect(await screen.findByTestId('sources-center')).toBeTruthy();

    // Persistent Right Pane still displays Conversation A
    expect(screen.getByRole('heading', { name: 'Canonical Architecture Query' })).toBeTruthy();

    // Global Composer still retains draft and explicit mode
    expect((screen.getByLabelText('Question') as HTMLTextAreaElement).value).toBe(
      'Draft while viewing Conversation A',
    );
    expect((screen.getByLabelText('Ask mode') as HTMLSelectElement).value).toBe(
      'SOURCE_EXPLORATION',
    );

    // getWorkspace was not called again for project scope
    expect(getWorkspace).toHaveBeenCalledTimes(1);
  });

  it('resets to B defaultAskMode when explicitly transitioning from Conversation A to Conversation B', async () => {
    const user = userEvent.setup();
    const runtime = createRuntime();
    const conv2Workspace: AskWorkspaceView = {
      ...mockWorkspace,
      defaultAskMode: 'HYBRID',
      availableAskModes: ['CANONICAL_ONLY', 'SOURCE_EXPLORATION', 'HYBRID'],
      selectedConversation: {
        ...mockWorkspace.selectedConversation!,
        conversationId: 'conv-2',
        title: 'Conversation Two Title',
      },
    };
    const getWorkspace = vi.fn().mockImplementation(async (convId?: string) => {
      if (convId === 'conv-2') return conv2Workspace;
      return mockWorkspace;
    });

    const mockClient: AskWorkspaceClient = {
      getProviderEligibility: vi.fn().mockResolvedValue({
        schemaVersion: '1.0.0',
        eligible: true,
        reasons: [],
        message: 'Eligible.',
      }),
      getWorkspace,
      getConversation: vi.fn().mockImplementation(async (convId: string) => {
        if (convId === 'conv-2') return conv2Workspace.selectedConversation!;
        return mockWorkspace.selectedConversation!;
      }),
      getConversationSourceContext: vi.fn().mockResolvedValue({
        schemaVersion: '1.0.0',
        resourceProjectId: 'project-1',
        items: [],
      }),
      getBranch: vi.fn(),
      getAnswerRun: vi.fn(),
      submitQuestion: vi.fn(),
      getQuestionSubmissionByClientRequestId: vi.fn(),
    };

    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <ShellWithAskOutlet client={mockClient} />,
          children: [
            {
              path: 'ask/conversations/:conversationId',
              element: <AskWorkspace client={mockClient} />,
            },
          ],
        },
      ],
      { initialEntries: ['/ask/conversations/conv-1'] },
    );

    render(
      <AppProviders runtime={runtime}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    expect(
      await screen.findByRole('heading', { name: 'Canonical Architecture Query' }),
    ).toBeTruthy();
    // User explicitly changes mode on Conversation A
    await user.selectOptions(await screen.findByLabelText('Ask mode'), 'SOURCE_EXPLORATION');
    expect((screen.getByLabelText('Ask mode') as HTMLSelectElement).value).toBe(
      'SOURCE_EXPLORATION',
    );

    // Deep link transition to Conversation B
    router.navigate('/ask/conversations/conv-2');
    expect(await screen.findByRole('heading', { name: 'Conversation Two Title' })).toBeTruthy();

    // Conversation B authoritative default is applied, not leaked from Conversation A
    expect((screen.getByLabelText('Ask mode') as HTMLSelectElement).value).toBe('HYBRID');
    expect(getWorkspace).toHaveBeenCalledWith('conv-2', expect.anything());
  });

  it('keeps Conversation A as Ask authority when Active Project changes', async () => {
    const runtime = createRuntime();
    const getWorkspace = vi.fn().mockResolvedValue(mockWorkspace);
    const mockClient: AskWorkspaceClient = {
      getProviderEligibility: vi.fn().mockResolvedValue({
        schemaVersion: '1.0.0',
        eligible: true,
        reasons: [],
        message: 'Eligible.',
      }),
      getWorkspace,
      getConversation: vi.fn().mockResolvedValue(mockWorkspace.selectedConversation!),
      getConversationSourceContext: vi.fn().mockResolvedValue({
        schemaVersion: '1.0.0',
        resourceProjectId: 'project-1',
        items: [],
      }),
      getBranch: vi.fn(),
      getAnswerRun: vi.fn(),
      submitQuestion: vi.fn(),
      getQuestionSubmissionByClientRequestId: vi.fn(),
    };

    const ShellHarness = ({ currentShell }: { readonly currentShell: GlobalShellView }) => (
      <ShellWithAskOutlet shell={currentShell} client={mockClient} />
    );

    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <ShellHarness currentShell={mockShell} />,
          children: [
            {
              path: 'ask/conversations/:conversationId',
              element: <AskWorkspace client={mockClient} />,
            },
          ],
        },
      ],
      { initialEntries: ['/ask/conversations/conv-1'] },
    );

    const { rerender } = render(
      <AppProviders runtime={runtime}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    expect(
      await screen.findByRole('heading', { name: 'Canonical Architecture Query' }),
    ).toBeTruthy();
    expect(getWorkspace).toHaveBeenCalledTimes(1);

    // Project switches from project-1 to project-2 in Global Shell
    const updatedShell: GlobalShellView = {
      ...mockShell,
      activeProject: {
        id: 'project-2',
        label: 'Project Two',
        sensitivityClearance: 'private',
      },
    };

    const updatedRouter = createMemoryRouter(
      [
        {
          path: '/',
          element: <ShellHarness currentShell={updatedShell} />,
          children: [
            {
              path: 'ask/conversations/:conversationId',
              element: <AskWorkspace client={mockClient} />,
            },
          ],
        },
      ],
      { initialEntries: ['/ask/conversations/conv-1'] },
    );

    rerender(
      <AppProviders runtime={runtime}>
        <RouterProvider router={updatedRouter} />
      </AppProviders>,
    );

    // Conversation A remains active in the Right Pane
    expect(
      await screen.findByRole('heading', { name: 'Canonical Architecture Query' }),
    ).toBeTruthy();
    // No project-2 workspace substitution occurred
    expect(getWorkspace).toHaveBeenCalledTimes(1);
  });

  it('clears active conversation and loads project workspace when navigating from Conversation A to exact /ask with empty draft', async () => {
    const user = userEvent.setup();
    const runtime = createRuntime();
    const projectWorkspace: AskWorkspaceView = {
      ...mockWorkspace,
      selectedConversation: undefined,
      defaultAskMode: 'CANONICAL_ONLY',
      availableAskModes: ['CANONICAL_ONLY', 'SOURCE_EXPLORATION'],
    };
    const getWorkspace = vi.fn().mockImplementation(async (convId?: string) => {
      if (convId === 'conv-1') return mockWorkspace;
      return projectWorkspace;
    });

    const mockClient: AskWorkspaceClient = {
      getProviderEligibility: vi.fn().mockResolvedValue({
        schemaVersion: '1.0.0',
        eligible: true,
        reasons: [],
        message: 'Eligible.',
      }),
      getWorkspace,
      getConversation: vi.fn().mockResolvedValue(mockWorkspace.selectedConversation!),
      getConversationSourceContext: vi.fn().mockResolvedValue({
        schemaVersion: '1.0.0',
        resourceProjectId: 'project-1',
        items: [],
      }),
      getBranch: vi.fn(),
      getAnswerRun: vi.fn(),
      submitQuestion: vi.fn(),
      getQuestionSubmissionByClientRequestId: vi.fn(),
    };

    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <ShellWithAskOutlet client={mockClient} />,
          children: [
            { path: 'ask', element: <AskWorkspace client={mockClient} /> },
            {
              path: 'ask/conversations/:conversationId',
              element: <AskWorkspace client={mockClient} />,
            },
          ],
        },
      ],
      { initialEntries: ['/ask/conversations/conv-1'] },
    );

    render(
      <AppProviders runtime={runtime}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    expect(
      await screen.findByRole('heading', { name: 'Canonical Architecture Query' }),
    ).toBeTruthy();
    expect(getWorkspace).toHaveBeenCalledWith('conv-1', expect.anything());

    // Explicitly select SOURCE_EXPLORATION in Conversation A
    await user.selectOptions(await screen.findByLabelText('Ask mode'), 'SOURCE_EXPLORATION');
    expect((screen.getByLabelText('Ask mode') as HTMLSelectElement).value).toBe(
      'SOURCE_EXPLORATION',
    );

    // Navigate to exact /ask with empty draft
    router.navigate('/ask');

    // Conversation A is cleared from selected conversation view
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Canonical Architecture Query' })).toBeNull(),
    );

    // Project workspace defaultAskMode is applied
    expect((screen.getByLabelText('Ask mode') as HTMLSelectElement).value).toBe('CANONICAL_ONLY');
    expect(getWorkspace).toHaveBeenCalledWith(undefined, expect.anything());
  });

  it('preserves Conversation A authority when navigating to exact /ask with an unsaved draft', async () => {
    const user = userEvent.setup();
    const runtime = createRuntime();
    const getWorkspace = vi.fn().mockResolvedValue(mockWorkspace);

    const mockClient: AskWorkspaceClient = {
      getProviderEligibility: vi.fn().mockResolvedValue({
        schemaVersion: '1.0.0',
        eligible: true,
        reasons: [],
        message: 'Eligible.',
      }),
      getWorkspace,
      getConversation: vi.fn().mockResolvedValue(mockWorkspace.selectedConversation!),
      getConversationSourceContext: vi.fn().mockResolvedValue({
        schemaVersion: '1.0.0',
        resourceProjectId: 'project-1',
        items: [],
      }),
      getBranch: vi.fn(),
      getAnswerRun: vi.fn(),
      submitQuestion: vi.fn(),
      getQuestionSubmissionByClientRequestId: vi.fn(),
    };

    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <ShellWithAskOutlet client={mockClient} />,
          children: [
            { path: 'ask', element: <AskWorkspace client={mockClient} /> },
            {
              path: 'ask/conversations/:conversationId',
              element: <AskWorkspace client={mockClient} />,
            },
          ],
        },
      ],
      { initialEntries: ['/ask/conversations/conv-1'] },
    );

    render(
      <AppProviders runtime={runtime}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    expect(
      await screen.findByRole('heading', { name: 'Canonical Architecture Query' }),
    ).toBeTruthy();

    // Type an unsaved draft in Conversation A
    const questionInput = screen.getByLabelText('Question');
    await user.type(questionInput, 'Unsaved follow-up question for Conversation A');

    // Attempt to navigate to exact /ask
    router.navigate('/ask');

    // Conversation A remains active in the Right Pane
    expect(screen.getByRole('heading', { name: 'Canonical Architecture Query' })).toBeTruthy();
    // Draft is preserved and NOT rebound as a new project question
    expect((screen.getByLabelText('Question') as HTMLTextAreaElement).value).toBe(
      'Unsaved follow-up question for Conversation A',
    );
    // getWorkspace was NOT called for project scope
    expect(getWorkspace).toHaveBeenCalledTimes(1);
  });

  it('submits a new question without conversationId after safe /ask transition', async () => {
    const user = userEvent.setup();
    const runtime = createRuntime();
    const projectWorkspace: AskWorkspaceView = {
      ...mockWorkspace,
      capabilities: ['SUBMIT_QUESTION'],
      selectedConversation: undefined,
      defaultAskMode: 'CANONICAL_ONLY',
      availableAskModes: ['CANONICAL_ONLY', 'SOURCE_EXPLORATION'],
    };
    const submitQuestion = vi.fn().mockResolvedValue({
      schemaVersion: '1.0.0',
      answerRun: {
        ...mockWorkspace.selectedConversation!.branches[0]!.turns[0]!.answerRun,
        conversationId: 'new-conv-1',
      },
      workspace: {
        ...mockWorkspace,
        selectedConversation: {
          ...mockWorkspace.selectedConversation!,
          conversationId: 'new-conv-1',
          title: 'Brand New Conversation',
        },
      },
    });

    const mockClient: AskWorkspaceClient = {
      getProviderEligibility: vi.fn().mockResolvedValue({
        schemaVersion: '1.0.0',
        eligible: true,
        reasons: [],
        message: 'Eligible.',
      }),
      getWorkspace: vi.fn().mockImplementation(async (convId?: string) => {
        if (convId === 'conv-1') return mockWorkspace;
        return projectWorkspace;
      }),
      getConversation: vi.fn().mockResolvedValue(mockWorkspace.selectedConversation!),
      getConversationSourceContext: vi.fn().mockResolvedValue({
        schemaVersion: '1.0.0',
        resourceProjectId: 'project-1',
        items: [],
      }),
      getBranch: vi.fn(),
      getAnswerRun: vi.fn(),
      submitQuestion,
      getQuestionSubmissionByClientRequestId: vi.fn(),
    };

    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <ShellWithAskOutlet client={mockClient} />,
          children: [
            { path: 'ask', element: <AskWorkspace client={mockClient} /> },
            {
              path: 'ask/conversations/:conversationId',
              element: <AskWorkspace client={mockClient} />,
            },
          ],
        },
      ],
      { initialEntries: ['/ask/conversations/conv-1'] },
    );

    render(
      <AppProviders runtime={runtime}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    expect(
      await screen.findByRole('heading', { name: 'Canonical Architecture Query' }),
    ).toBeTruthy();

    // Safe transition to /ask (empty draft)
    router.navigate('/ask');
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Canonical Architecture Query' })).toBeNull(),
    );

    // Type and submit a new project question
    const questionInput = screen.getByLabelText('Question');
    await user.type(questionInput, 'Brand new question for active project');
    const submitButton = screen.getByRole('button', { name: 'Submit question' });
    await user.click(submitButton);

    await waitFor(() => expect(submitQuestion).toHaveBeenCalledTimes(1));
    // Verify conversationId was NOT included in request payload
    expect(submitQuestion).toHaveBeenCalledWith(
      expect.not.objectContaining({ conversationId: expect.anything() }),
    );
    expect(submitQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        question: 'Brand new question for active project',
        mode: 'CANONICAL_ONLY',
      }),
    );
  });
});
