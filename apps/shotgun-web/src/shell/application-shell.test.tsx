import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

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
import { createSessionCycleState } from '../session/session-query.js';
import { ApplicationShell } from './application-shell.js';

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
    getHomeActionCenter: vi.fn(async () => home),
    getProjects: vi.fn(async () => []),
    getAISettings: vi.fn(async () => ({
      projectId: 'project-a',
      defaultProviderId: 'provider-a',
      currentConfiguration: { activeProviderId: 'provider-a', activeModelId: 'model-a' },
      providers: [
        {
          providerId: 'provider-a',
          displayName: 'Provider A',
          status: 'active',
          models: [{ modelId: 'model-a', displayName: 'Model A' }],
        },
      ],
      privacy: [],
      credentialStatuses: [],
      vaultAvailability: { state: 'AVAILABLE' },
    })),
    testAIConnection: vi.fn(),
    getPrincipalPreferences: vi.fn(async () => ({
      preferences: { locale },
      revision: 1,
    })),
  } as unknown as ShotgunApiClient;
  return { apiClient, queryClient, sessionCycleState };
};

const renderShell = (locale: 'en-US' | 'ko-KR' = 'en-US', shellView: GlobalShellView = shell) => {
  const appRuntime = runtime(locale, shellView);
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <ApplicationShell />,
        children: [{ index: true, element: <HomePage /> }],
      },
    ],
    { initialEntries: ['/'] },
  );
  render(
    <AppProviders runtime={appRuntime}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return appRuntime;
};

describe('ApplicationShell', () => {
  it('preserves the leading-warning wrapper within the PC global shell', async () => {
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
    expect(screen.queryByText(/additional states/)).toBeNull();
    expect(document.querySelector('[data-global-shell-region="instrument"]')).toBeTruthy();
  });

  it('preserves the owner-visible offline recovery state within the PC global shell', async () => {
    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      renderShell();
      expect(await screen.findByRole('alert')).toBeTruthy();
      expect(document.querySelector('[data-global-shell-region="instrument"]')).toBeTruthy();
      expect(document.querySelector('[data-global-shell-region="center"]')).toBeTruthy();
    } finally {
      online.mockRestore();
    }
  });

  it('provides one five-region PC global shell with an Instrument Panel and C2 Tree', async () => {
    renderShell();
    expect(await screen.findByRole('banner')).toBeTruthy();

    for (const region of ['instrument', 'tree', 'center', 'conversation', 'composer']) {
      expect(document.querySelectorAll(`[data-global-shell-region="${region}"]`)).toHaveLength(1);
    }

    const treeRegion = document.querySelector('[data-global-shell-region="tree"]');
    const centerRegion = document.querySelector('[data-global-shell-region="center"]');
    const conversationRegion = document.querySelector('[data-global-shell-region="conversation"]');
    const composerRegion = document.querySelector('[data-global-shell-region="composer"]');
    const navigation = screen.getByRole('navigation', { name: 'Primary navigation' });

    expect(treeRegion?.contains(navigation)).toBe(true);
    expect(screen.getByRole('main')).toBe(centerRegion);
    expect(screen.getByRole('link', { name: /main content/i }).getAttribute('href')).toBe(
      '#main-content',
    );
    expect(screen.getAllByRole('link', { name: 'Home' })[0]?.getAttribute('aria-current')).toBe(
      'page',
    );
    const projectSelector = screen.getByRole('combobox', { name: 'Current project' });
    expect((projectSelector as HTMLSelectElement).value).toBe('project-a');
    expect(screen.getByLabelText('Workspace breadcrumb').textContent).toBe('Home');
    expect(await screen.findByText('Provider A / Model A')).toBeTruthy();
    expect(within(navigation).getByRole('link', { name: 'Home' })).toBeTruthy();
    expect(within(navigation).getByRole('link', { name: 'Library' })).toBeTruthy();
    expect(within(navigation).getByRole('link', { name: 'Add Source' })).toBeTruthy();
    expect(within(navigation).getByRole('link', { name: 'Conversations' })).toBeTruthy();
    expect(within(navigation).getByText('Settings', { selector: 'summary' })).toBeTruthy();
    expect(within(navigation).queryByText('Knowledge', { exact: true })).toBeNull();
    expect(within(navigation).queryByText('Review', { exact: true })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Mobile navigation' })).toBeNull();
    expect(
      conversationRegion?.querySelector('button, input, textarea, [role="textbox"]'),
    ).toBeNull();
    expect(composerRegion?.querySelector('button, input, textarea, [role="textbox"]')).toBeNull();
    expect(screen.queryByText('More', { exact: true })).toBeNull();
  });

  it('exposes the implemented Sources Library workspace as a registered Tree link', async () => {
    renderShell();
    expect((await screen.findAllByRole('link', { name: 'Library' })).length).toBeGreaterThan(0);
  });

  it('shares the owner-command registry between the C2 Tree and Ctrl/Cmd+K without an AI connection test', async () => {
    const user = userEvent.setup();
    const appRuntime = renderShell();

    await screen.findByRole('heading', { name: 'Home' });
    expect(screen.getByRole('button', { name: 'Search' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Commands' })).toBeNull();
    await user.keyboard('{Control>}k{/Control}');
    expect(screen.getByRole('dialog', { name: 'Commands' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Navigation' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Open Knowledge/ })).toBeTruthy();
    expect(
      (appRuntime.apiClient as unknown as { testAIConnection: { mock: { calls: unknown[] } } })
        .testAIConnection.mock.calls,
    ).toHaveLength(0);
  });
});
