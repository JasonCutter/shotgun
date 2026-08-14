import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import type {
  GlobalSearchResultView,
  GlobalShellView,
  ProjectListItemView,
  ShotgunApiClient,
} from '@shotgun/api-client';

import { createFrontendQueryClient } from '../app/query-client.js';
import { AppProviders, type AppRuntime } from '../app/providers.js';
import {
  AnswerCommandContextProvider,
  useOptionalAnswerCommandContext,
  type RegisteredAnswerCommandContext,
} from '../commands/answer-command-context.js';
import { createSessionCycleState } from '../session/session-query.js';
import { TechnicalDetails } from '../components/technical-details.js';
import { TechnicalInspectionProvider } from '../components/technical-inspection-context.js';
import { GlobalSearchDialog } from './global-search-dialog.js';
import { GlobalTools } from './global-tools.js';

const shell: GlobalShellView = {
  schemaVersion: '1.0.0',
  principalId: 'principal-1',
  sessionId: 'session-1',
  activeProject: {
    id: 'project-1',
    label: 'Current Project',
    sensitivityClearance: 'private',
  },
  accessibleProjects: [
    {
      id: 'project-1',
      label: 'Current Project',
      isOwner: true,
      sensitivityClearance: 'private',
    },
    {
      id: 'project-2',
      label: 'Research Project',
      isOwner: true,
      sensitivityClearance: 'private',
    },
  ],
  navigation: [],
  features: [{ id: 'global-search', label: 'Search', availability: 'AVAILABLE' }],
  readiness: [],
  background: { activeCount: 0, failedCount: 0 },
  notifications: { unreadCount: 0, presentationRevision: '1' },
  accessRevision: '1',
  policyContextRevision: '1',
  projectionRevision: '1',
  fetchedAt: '2026-08-14T00:00:00.000Z',
};

const searchResult: GlobalSearchResultView = {
  schemaVersion: '1.0.0',
  scope: 'ACTIVE_PROJECT',
  results: [
    {
      stableId: 'result-1',
      kind: 'SOURCE',
      label: 'Matching source',
      projectId: 'project-1',
      projectLabel: 'Current Project',
      targetRoute: { routeId: 'sources', href: '/sources' },
    },
  ],
  projectionRevision: 'projection-1',
  fetchedAt: '2026-08-14T00:00:00.000Z',
};

const project: ProjectListItemView = {
  id: 'project-1',
  name: 'Current Project',
  description: '',
  isOwner: true,
  status: 'ACTIVE',
  active: true,
  createdAt: '2026-08-14T00:00:00.000Z',
  updatedAt: '2026-08-14T00:00:00.000Z',
  revision: 3,
  capability: {
    canRename: true,
    canArchive: true,
    canRestore: false,
    canDelete: true,
    canManagePolicies: true,
  },
};

const runtime = (apiClient: Partial<ShotgunApiClient>): AppRuntime => ({
  apiClient: apiClient as ShotgunApiClient,
  queryClient: createFrontendQueryClient(),
  sessionCycleState: createSessionCycleState(),
});

const openCommandsWithKeyboard = async (user: ReturnType<typeof userEvent.setup>) => {
  expect(screen.queryByRole('button', { name: 'Commands' })).toBeNull();
  await user.keyboard('{Control>}k{/Control}');
  return await screen.findByRole('dialog', { name: 'Commands' });
};

const AnswerContextRegistration = ({
  registration,
}: {
  readonly registration: RegisteredAnswerCommandContext;
}) => {
  const bridge = useOptionalAnswerCommandContext();
  const register = bridge?.register;
  useEffect(() => register?.(registration), [register, registration]);
  return null;
};

describe('GlobalTools HFM-S1 preservation', () => {
  it('discovers the mounted active-answer context through Ctrl/Cmd+K', async () => {
    const user = userEvent.setup();
    const openCommand = vi.fn();
    const registration: RegisteredAnswerCommandContext = {
      context: {
        projectId: 'project-1',
        conversationId: 'conversation-1',
        branchId: 'branch-1',
        turnId: 'turn-1',
        answerRunId: 'answer-run-1',
        answerRevision: 'answer-revision-1',
        state: 'SUCCEEDED',
        capabilities: ['EXPORT'],
      },
      commandPending: false,
      openCommand,
    };
    render(
      <AppProviders runtime={runtime({ getProjects: vi.fn(async () => [project]) })}>
        <MemoryRouter>
          <AnswerCommandContextProvider>
            <AnswerContextRegistration registration={registration} />
            <GlobalTools shell={shell} />
          </AnswerCommandContextProvider>
        </MemoryRouter>
      </AppProviders>,
    );

    const palette = await openCommandsWithKeyboard(user);
    await user.click(within(palette).getByRole('button', { name: /^Export answer/ }));

    expect(openCommand).toHaveBeenCalledWith('answer.export', expect.any(HTMLElement));
  });

  it('announces the result count after a successful global search', async () => {
    const user = userEvent.setup();
    const searchGlobal = vi.fn(async () => searchResult);

    render(
      <AppProviders runtime={runtime({ searchGlobal })}>
        <MemoryRouter>
          <GlobalSearchDialog shell={shell} open invoker={null} onClose={vi.fn()} />
        </MemoryRouter>
      </AppProviders>,
    );

    await user.type(screen.getByRole('textbox', { name: 'Search query' }), 'matching');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('1 search results.')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Search results' })).toBeTruthy();
  });

  it('uses search.global from Ctrl/Cmd+K and has no permanent top Search button', async () => {
    const user = userEvent.setup();
    render(
      <AppProviders runtime={runtime({ getProjects: vi.fn(async () => [project]) })}>
        <MemoryRouter>
          <GlobalTools shell={shell} />
        </MemoryRouter>
      </AppProviders>,
    );

    expect(screen.queryByRole('button', { name: 'Search' })).toBeNull();
    const commands = await openCommandsWithKeyboard(user);
    await user.click(within(commands).getByRole('button', { name: /^Search/ }));

    expect(screen.getByRole('dialog', { name: 'Search' })).toBeTruthy();
    const searchQuery = screen.getByRole('textbox', { name: 'Search query' });
    await waitFor(() => expect(document.activeElement).toBe(searchQuery));
  });

  it('shows an explicit no-results state', async () => {
    const user = userEvent.setup();
    render(
      <AppProviders
        runtime={runtime({ searchGlobal: vi.fn(async () => ({ ...searchResult, results: [] })) })}
      >
        <MemoryRouter>
          <GlobalSearchDialog shell={shell} open invoker={null} onClose={vi.fn()} />
        </MemoryRouter>
      </AppProviders>,
    );

    await user.type(screen.getByRole('textbox', { name: 'Search query' }), 'missing');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('No results in the selected Project scope.')).toBeTruthy();
  });

  it('shows explicit loading and safe error states', async () => {
    const user = userEvent.setup();
    const searchGlobal = vi
      .fn<ShotgunApiClient['searchGlobal']>()
      .mockImplementationOnce(() => new Promise<GlobalSearchResultView>(() => undefined))
      .mockRejectedValueOnce(new Error('Search is temporarily unavailable.'));
    const appRuntime = runtime({ searchGlobal });
    const view = render(
      <AppProviders runtime={appRuntime}>
        <MemoryRouter>
          <GlobalSearchDialog shell={shell} open invoker={null} onClose={vi.fn()} />
        </MemoryRouter>
      </AppProviders>,
    );

    await user.type(screen.getByRole('textbox', { name: 'Search query' }), 'loading');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('Searching the selected Project scope...')).toBeTruthy();

    view.unmount();
    render(
      <AppProviders runtime={appRuntime}>
        <MemoryRouter>
          <GlobalSearchDialog shell={shell} open invoker={null} onClose={vi.fn()} />
        </MemoryRouter>
      </AppProviders>,
    );
    await user.type(screen.getByRole('textbox', { name: 'Search query' }), 'failure');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Search is temporarily unavailable.',
    );
  });

  it('keeps Project switch mutation errors visible to the owner', async () => {
    const user = userEvent.setup();
    const switchActiveProject = vi.fn(async () => {
      throw new Error('Project switch failed');
    });

    render(
      <AppProviders
        runtime={runtime({ switchActiveProject, getProjects: vi.fn(async () => [project]) })}
      >
        <MemoryRouter>
          <GlobalTools shell={shell} />
        </MemoryRouter>
      </AppProviders>,
    );

    await openCommandsWithKeyboard(user);
    await user.click(screen.getByRole('button', { name: /Switch to Research Project/ }));

    expect((await screen.findByRole('alert')).textContent).toContain('Project switch failed');
  });

  it('opens Project management as a focused surface from the shared registry', async () => {
    const user = userEvent.setup();
    render(
      <AppProviders runtime={runtime({ getProjects: vi.fn(async () => [project]) })}>
        <MemoryRouter>
          <GlobalTools shell={shell} />
        </MemoryRouter>
      </AppProviders>,
    );

    await openCommandsWithKeyboard(user);
    await user.click(await screen.findByRole('button', { name: /^Manage Projects/ }));

    expect(await screen.findByRole('dialog', { name: 'Manage Projects' })).toBeTruthy();
    expect(screen.getByText('Current Project')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /settings/i })).toBeNull();
  });

  it('opens Preferences through the same owner command registry as other focused flows', async () => {
    const user = userEvent.setup();
    render(
      <AppProviders
        runtime={runtime({
          getProjects: vi.fn(async () => [project]),
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
        })}
      >
        <MemoryRouter>
          <GlobalTools shell={shell} />
        </MemoryRouter>
      </AppProviders>,
    );

    await openCommandsWithKeyboard(user);
    await user.click(await screen.findByRole('button', { name: /^Set Locale/ }));

    expect(await screen.findByRole('dialog', { name: 'Locale Preferences' })).toBeTruthy();
    expect((screen.getByRole('combobox', { name: 'Locale' }) as HTMLSelectElement).value).toBe(
      'ko-KR',
    );
  });

  it('opens the shared AI surface from Ctrl/Cmd+K without navigating to Settings', async () => {
    const user = userEvent.setup();
    render(
      <AppProviders
        runtime={runtime({
          getProjects: vi.fn(async () => [project]),
          getAISettings: vi.fn(
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
          ),
        })}
      >
        <MemoryRouter>
          <GlobalTools shell={shell} />
        </MemoryRouter>
      </AppProviders>,
    );

    await openCommandsWithKeyboard(user);
    await user.click(await screen.findByRole('button', { name: /^Configure AI/ }));

    expect(await screen.findByRole('dialog', { name: 'Configure AI' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /settings/i })).toBeNull();
  });

  it('opens current technical information without a Product mutation', async () => {
    const user = userEvent.setup();
    const switchActiveProject = vi.fn();
    render(
      <AppProviders
        runtime={runtime({
          getProjects: vi.fn(async () => [project]),
          switchActiveProject,
        })}
      >
        <MemoryRouter>
          <TechnicalInspectionProvider>
            <GlobalTools shell={shell} />
            <TechnicalDetails items={[{ label: 'Projection revision', value: 'revision-9' }]} />
          </TechnicalInspectionProvider>
        </MemoryRouter>
      </AppProviders>,
    );

    await openCommandsWithKeyboard(user);
    await user.click(await screen.findByRole('button', { name: /^Technical information/ }));

    const dialog = await screen.findByRole('dialog', { name: 'Technical information' });
    expect(within(dialog).getByText('revision-9')).toBeTruthy();
    expect(switchActiveProject).not.toHaveBeenCalled();
  });
});
