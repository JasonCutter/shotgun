import { render, screen } from '@testing-library/react';
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
      id: 'settings',
      label: 'Settings',
      availability: 'AVAILABLE',
      targetRoute: { routeId: 'settings', href: '/settings' },
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

const runtime = (): AppRuntime => {
  const queryClient = createFrontendQueryClient();
  const sessionCycleState = createSessionCycleState();
  queryClient.setQueryData(productSessionQueryKey, session);
  const apiClient = {
    bootstrapLocalOwner: vi.fn(async () => session),
    getSession: vi.fn(async () => session),
    switchActiveProject: vi.fn(async () => session),
    logout: vi.fn(async () => undefined),
    getGlobalShell: vi.fn(async () => shell),
    getHomeActionCenter: vi.fn(async () => home),
  } as unknown as ShotgunApiClient;
  return { apiClient, queryClient, sessionCycleState };
};

const renderShell = () => {
  const appRuntime = runtime();
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
};

describe('ApplicationShell', () => {
  it('provides landmarks, skip navigation, current navigation, and project context', async () => {
    renderShell();
    expect(await screen.findByRole('banner')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeTruthy();
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('link', { name: /main content/i }).getAttribute('href')).toBe(
      '#main-content',
    );
    expect(screen.getAllByRole('link', { name: 'Home' })[0]?.getAttribute('aria-current')).toBe(
      'page',
    );
    expect(screen.getByText('Project A', { selector: 'strong' })).toBeTruthy();
  });

  it('exposes the implemented Sources workspace as a registered link', async () => {
    renderShell();
    expect((await screen.findAllByRole('link', { name: 'Sources' })).length).toBeGreaterThan(0);
  });

  it('opens the same owner-command registry from the persistent Commands entry', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('button', { name: 'Commands' }));
    expect(screen.getByRole('dialog', { name: 'Commands' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Navigation' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Open Knowledge/ })).toBeTruthy();
  });
});
