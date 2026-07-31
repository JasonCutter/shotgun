import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import type { AskWorkspaceClient, AskWorkspaceView, GlobalShellView } from '@shotgun/api-client';

import { LeaveGuardProvider, useLeaveGuard } from '../session/leave-guard-context.js';
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
              capabilities: ['EXPORT'],
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
  capabilities: ['SUBMIT_QUESTION'],
  projectionRevision: 'p-1',
  accessRevision: '1',
  policyContextRevision: '1',
  fetchedAt: '2026-07-31T00:00:00.000Z',
  stale: false,
};

const LeaveGuardStatus = () => {
  const { getLeaveState } = useLeaveGuard();
  return <div data-testid="leave-status">{getLeaveState().canLeaveCurrentContext ? 'ALLOWED' : 'BLOCKED'}</div>;
};

const ShellOutlet = () => <Outlet context={{ shell: mockShell }} />;

describe('AskWorkspace', () => {
  it('renders Ask Workspace server data and conversation tree', async () => {
    const mockClient: AskWorkspaceClient = {
      getWorkspace: vi.fn().mockResolvedValue(mockWorkspace),
      getConversation: vi.fn().mockResolvedValue(mockWorkspace.selectedConversation!),
      getBranch: vi.fn(),
      getAnswerRun: vi.fn(),
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
      <LeaveGuardProvider>
        <RouterProvider router={router} />
      </LeaveGuardProvider>,
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
  });

  it('triggers Leave Guard when question text is typed', async () => {
    const user = userEvent.setup();
    const mockClient: AskWorkspaceClient = {
      getWorkspace: vi.fn().mockResolvedValue(mockWorkspace),
      getConversation: vi.fn().mockResolvedValue(mockWorkspace.selectedConversation!),
      getBranch: vi.fn(),
      getAnswerRun: vi.fn(),
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
      <LeaveGuardProvider>
        <RouterProvider router={router} />
      </LeaveGuardProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('leave-status').textContent).toBe('ALLOWED');
    });

    const textarea = screen.getByLabelText('Question');
    await user.type(textarea, 'Is this draft protected?');

    expect(screen.getByTestId('leave-status').textContent).toBe('BLOCKED');
  });
});
