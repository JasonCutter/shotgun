import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ApiClientModule from '@shotgun/api-client';

import type {
  GlobalShellView,
  HomeActionCenterView,
  ProductSessionView,
  ShotgunApiClient,
} from '@shotgun/api-client';

import { createFrontendQueryClient } from '../app/query-client.js';
import { productSessionQueryKey } from '../app/query-keys.js';
import { AppProviders, type AppRuntime } from '../app/providers.js';
import { HomePage } from '../routes/home-page.js';
import { AskConversationWorkspace } from '../routes/ask-workspace.js';
import { layoutEligibility, layoutWorkspace } from '../test/conversation-layout-fixture.js';
import { createSessionCycleState } from '../session/session-query.js';
import { ApplicationShell } from './application-shell.js';

vi.mock('@shotgun/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClientModule>()),
  createAskWorkspaceClient: () => ({
    getWorkspace: vi.fn(async (id?: string) => layoutWorkspace(id)),
    getProviderEligibility: vi.fn(async () => layoutEligibility),
  }),
}));

const session: ProductSessionView = {
  apiVersion: '1.0.0',
  principal: {
    id: 'principal-a',
    actor: { type: 'user', id: 'principal-a' },
    authenticationMethod: 'session',
  },
  activeProject: { id: 'project-a' },
  accessibleProjects: [{ id: 'project-a', isOwner: true }],
  session: { expiresAt: null },
};

const shell: GlobalShellView = {
  schemaVersion: '1.0.0',
  principalId: 'principal-a',
  sessionId: 'session-a',
  activeProject: {
    id: 'project-a',
    label: 'Project A',
    sensitivityClearance: 'private',
  },
  accessibleProjects: [
    {
      id: 'project-a',
      label: 'Project A',
      isOwner: true,
      sensitivityClearance: 'private',
    },
  ],
  navigation: [
    {
      id: 'home',
      label: 'Home',
      availability: 'AVAILABLE',
      targetRoute: { routeId: 'home', href: '/' },
    },
    {
      id: 'sources',
      label: 'Sources',
      availability: 'AVAILABLE',
      targetRoute: { routeId: 'sources', href: '/sources' },
    },
    {
      id: 'ask',
      label: 'Ask',
      availability: 'AVAILABLE',
      targetRoute: { routeId: 'ask', href: '/ask' },
    },
  ],
  features: [
    { id: 'vp-autonomous-knowledge', label: 'VP', availability: 'AVAILABLE' },
    { id: 'global-search', label: 'Global Search', availability: 'AVAILABLE' },
    { id: 'command-palette', label: 'Command Palette', availability: 'AVAILABLE' },
  ],
  readiness: [
    { kind: 'SESSION_READY', ready: true, required: true },
    { kind: 'PROJECT_READY', ready: true, required: true },
  ],
  background: { activeCount: 0, failedCount: 0 },
  notifications: { unreadCount: 0, presentationRevision: '1' },
  accessRevision: '1',
  policyContextRevision: '1',
  projectionRevision: 'shell-1',
  fetchedAt: '2026-07-29T00:00:00.000Z',
};

const home: HomeActionCenterView = {
  schemaVersion: '1.0.0',
  principalId: 'principal-a',
  sessionId: 'session-a',
  activeProject: { id: 'project-a', label: 'Project A' },
  projectState: { lifecycle: 'ACTIVE', message: 'Ready.' },
  primaryActions: [],
  attention: [],
  continueWorking: [],
  recent: [],
  pinned: [],
  operationalSummary: {
    activeBackgroundCount: 0,
    failedBackgroundCount: 0,
    unreadNotificationCount: 0,
  },
  stale: false,
  accessRevision: '1',
  policyContextRevision: '1',
  projectionRevision: 'home-1',
  fetchedAt: '2026-07-29T00:00:00.000Z',
};

const runtime = (
  locale: 'en-US' | 'ko-KR' = 'en-US',
  shellView: GlobalShellView = shell,
  homeView: HomeActionCenterView = home,
): AppRuntime => {
  const queryClient = createFrontendQueryClient();
  const sessionCycleState = createSessionCycleState();
  queryClient.setQueryData(productSessionQueryKey, session);
  const apiClient = {
    bootstrapLocalOwner: vi.fn(async () => session),
    getSession: vi.fn(async () => session),
    switchActiveProject: vi.fn(async () => session),
    logout: vi.fn(async () => undefined),
    getGlobalShell: vi.fn(async () => shellView),
    getHomeActionCenter: vi.fn(async () => homeView),
    getProjects: vi.fn(async () => []),
    getAISettings: vi.fn(async () => ({
      projectId: 'project-a',
      mode: 'PROJECT_MANAGED',
      defaultProviderId: 'deepseek',
      currentConfiguration: {
        projectId: 'project-a',
        activeProviderId: 'provider-a',
        activeModelId: 'model-a',
        credentialId: 'credential-a',
        credentialRevision: 1,
        aiConfigurationRevision: 1,
        updatedBy: 'principal-a',
        updatedAt: '2026-08-15T00:00:00.000Z',
      },
      providers: [
        {
          providerId: 'provider-a',
          displayName: 'Provider A',
          status: 'active',
          models: [
            {
              modelId: 'model-a',
              displayName: 'Model A',
              shotgunUsableCapabilities: [],
              capabilityRevision: '1',
            },
          ],
        },
      ],
      privacy: [],
      credentialStatuses: [],
      vaultAvailability: { state: 'AVAILABLE', keyVersion: '1' },
      legacyGeminiCredentialConfigured: false,
    })),
    testAIConnection: vi.fn(),
    getPrincipalPreferences: vi.fn(async () => ({
      preferences: { locale },
      revision: 1,
    })),
  } as unknown as ShotgunApiClient;
  return { apiClient, queryClient, sessionCycleState };
};

const renderShell = (
  locale: 'en-US' | 'ko-KR' = 'en-US',
  shellView: GlobalShellView = shell,
  homeView: HomeActionCenterView = home,
  entry = '/ask',
) => {
  const appRuntime = runtime(locale, shellView, homeView);
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <ApplicationShell />,
        children: [
          { path: 'home', element: <HomePage /> },
          { path: 'ask', element: <AskConversationWorkspace /> },
          { path: 'ask/conversations/:conversationId', element: <AskConversationWorkspace /> },
          { path: 'sources', element: <h1>Library workspace</h1> },
          { path: 'sources/:sourceId', element: <h1>Source detail</h1> },
          { path: 'settings/preferences', element: <h1>Preferences</h1> },
        ],
      },
    ],
    { initialEntries: [entry] },
  );
  render(
    <AppProviders runtime={appRuntime}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { ...appRuntime, router };
};

describe('ApplicationShell conversation layout', () => {
  beforeEach(() => window.localStorage.clear());

  it('preserves the server leading warning and localized additional count', async () => {
    renderShell('ko-KR', {
      ...shell,
      leadingWarning: {
        code: 'TEST_WARNING',
        severity: 'WARNING',
        message: 'Server-owned warning text',
        additionalCount: 2,
      },
    });
    expect((await screen.findByText(/Server-owned warning text/)).textContent).toContain(
      'Server-owned warning text (2 추가 상태)',
    );
  });

  it('keeps offline recovery visible', async () => {
    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      renderShell();
      expect(await screen.findByRole('alert')).toBeTruthy();
    } finally {
      online.mockRestore();
    }
  });

  it('places one conversation and composer in the center with contextual evidence closed', async () => {
    renderShell();
    await screen.findByRole('heading', { name: 'What would you like to know?' });
    const main = screen.getByRole('main');
    expect(main.querySelector('[data-global-shell-region="conversation"]')).toBeTruthy();
    expect(document.querySelector('[data-global-shell-region="evidence"]')).toBeNull();
    expect(screen.getAllByRole('form', { name: 'Global Composer' })).toHaveLength(1);
    const navigation = screen.getByRole('navigation', { name: 'Primary navigation' });
    expect(within(navigation).getByRole('link', { name: 'New conversation' })).toBeTruthy();
    expect(within(navigation).getByRole('link', { name: 'Sources library' })).toBeTruthy();
    expect(within(navigation).getByRole('button', { name: 'Search' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Add source' }).getAttribute('href')).toBe(
      '/sources?view=add',
    );
    expect(screen.queryByRole('combobox', { name: 'Current project' })).toBeNull();
    expect(screen.queryByText('Review', { exact: true })).toBeNull();
  });

  it('collapses and expands the sidebar without losing keyboard access to its toggle', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(await screen.findByRole('button', { name: 'Collapse sidebar' }));
    expect(screen.queryByRole('link', { name: 'New conversation' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(screen.getByRole('link', { name: 'New conversation' })).toBeTruthy();
  });

  it('keeps principal-scoped pinned conversations separate from recent conversations', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(
      await screen.findByRole('button', { name: 'Pin conversation: 자료의 차이와 공통점' }),
    );
    const pinned = screen.getByRole('region', { name: 'Pinned conversations' });
    expect(within(pinned).getByRole('link', { name: '자료의 차이와 공통점' })).toBeTruthy();
    await user.click(
      within(pinned).getByRole('button', { name: 'Unpin conversation: 자료의 차이와 공통점' }),
    );
    expect(screen.queryByRole('region', { name: 'Pinned conversations' })).toBeNull();
  });

  it('preserves per-conversation drafts across a new conversation and library navigation', async () => {
    const user = userEvent.setup();
    const { router } = renderShell('en-US', shell, home, '/ask/conversations/conversation-a');
    const question = await screen.findByRole('textbox', { name: 'Question' });
    await screen.findByText(/두 자료는 원문 근거를/);
    await user.type(question, 'Follow-up draft');
    await user.click(screen.getByRole('link', { name: 'New conversation' }));
    await screen.findByRole('heading', { name: 'What would you like to know?' });
    expect(screen.getByRole('textbox', { name: 'Question' })).toHaveValue('');
    await user.type(screen.getByRole('textbox', { name: 'Question' }), 'New draft');
    await user.click(screen.getByRole('link', { name: 'Sources library' }));
    await screen.findByRole('heading', { name: 'Library workspace' });
    expect(screen.getByRole('textbox', { name: 'Question' })).toHaveValue('New draft');
    await router.navigate('/ask/conversations/conversation-a');
    await screen.findByText(/두 자료는 원문 근거를/);
    expect(screen.getByRole('textbox', { name: 'Question' })).toHaveValue('Follow-up draft');
  });

  it('opens matching citation evidence beside the conversation and returns to the citation', async () => {
    const user = userEvent.setup();
    const { router } = renderShell('en-US', shell, home, '/ask/conversations/conversation-a');
    await user.click(await screen.findByRole('link', { name: /Open pinned Evidence/ }));
    const evidence = screen.getByRole('complementary', { name: 'Source evidence' });
    expect(within(evidence).getByRole('heading', { name: 'Source detail' })).toBeTruthy();
    expect(screen.getByText(/두 자료는 원문 근거를/)).toBeTruthy();
    expect(router.state.location.search).toBe('?version=version-a');
    await user.click(within(evidence).getByRole('link', { name: 'Close' }));
    expect(router.state.location.pathname).toBe('/ask/conversations/conversation-a');
    expect(router.state.location.state.citationReturn.citationId).toBe('citation-a');
    expect(screen.queryByRole('complementary', { name: 'Source evidence' })).toBeNull();
  });

  it('uses the source workspace for a direct source URL without a citation return target', async () => {
    renderShell('en-US', shell, home, '/sources/source-a?version=version-a');
    expect(await screen.findByRole('heading', { name: 'Source detail' })).toBeTruthy();
    expect(screen.queryByRole('complementary', { name: 'Source evidence' })).toBeNull();
  });

  it('preserves the exact server Activity destination in the accessible Home attention workspace', async () => {
    const href =
      '/activity?domain=SOURCES&activity=submission-1&resource=IntakeSubmission&resourceId=submission-1' as const;
    renderShell(
      'en-US',
      shell,
      {
        ...home,
        attention: [
          {
            stableId: 'activity:SOURCES:submission-1',
            kind: 'FAILED_OR_BLOCKED_WORK',
            label: 'Intake needs attention',
            priority: 70,
            reason: 'Processing is blocked.',
            projectId: 'project-a',
            resourceId: 'submission-1',
            targetRoute: { routeId: 'activity', href },
            createdAt: '2026-07-29T00:00:00.000Z',
          },
        ],
      },
      '/home',
    );
    expect(
      (await screen.findByRole('link', { name: 'Intake needs attention' })).getAttribute('href'),
    ).toBe(href);
  });

  it('shares GUI and Ctrl+K commands without testing the AI connection', async () => {
    const user = userEvent.setup();
    const appRuntime = renderShell();
    await screen.findByRole('heading', { name: 'What would you like to know?' });
    await user.keyboard('{Control>}k{/Control}');
    expect(screen.getByRole('region', { name: 'Commands' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Open Review/ })).toBeNull();
    expect(vi.mocked(appRuntime.apiClient.testAIConnection)).not.toHaveBeenCalled();
  });
});
