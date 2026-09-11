import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { ShotgunApiClient } from '@shotgun/api-client';

import { createFrontendQueryClient } from '../../app/query-client.js';
import { AppProviders, type AppRuntime } from '../../app/providers.js';
import { createSessionCycleState } from '../../session/session-query.js';
import { SettingsLayout } from './settings-layout.js';

const now = '2026-08-14T00:00:00.000Z';

const session = {
  apiVersion: '2.0.0' as const,
  principal: {
    id: 'principal-1',
    actor: { type: 'user' as const, id: 'user-1' },
    authenticationMethod: 'session' as const,
  },
  activeProject: { id: 'project-1' },
  accessibleProjects: [
    { id: 'project-1', isOwner: true },
    { id: 'project-2', isOwner: false },
  ],
  session: { expiresAt: now },
};

const renderLayout = (initialUrl = '/settings') => {
  const api = {
    getSession: vi.fn().mockResolvedValue(session),
  } as unknown as ShotgunApiClient;

  const runtime: AppRuntime = {
    apiClient: api,
    queryClient: createFrontendQueryClient(),
    sessionCycleState: createSessionCycleState(),
  };

  const router = createMemoryRouter(
    [
      {
        path: 'settings',
        element: <SettingsLayout />,
        children: [
          { path: '', element: <div>Settings Landing</div> },
          { path: 'ai', element: <div>AI Subpage</div> },
          { path: 'privacy', element: <div>Privacy Subpage</div> },
          { path: 'preferences', element: <div>Preferences Subpage</div> },
          { path: 'projects', element: <div>Projects Subpage</div> },
        ],
      },
    ],
    { initialEntries: [initialUrl] },
  );

  render(
    <AppProviders runtime={runtime}>
      <RouterProvider router={router} />
    </AppProviders>,
  );

  return { api, router };
};

describe('SettingsLayout (A7 Settings IA & Header)', () => {
  it('renders the preferences child while omitting the duplicate Settings Categories navigation', async () => {
    renderLayout('/settings/preferences');

    expect(await screen.findByRole('heading', { name: 'Settings & Preferences' })).toBeTruthy();
    expect(screen.getByText('Preferences Subpage')).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Settings Categories' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'AI' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Privacy' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Preferences' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Project' })).toBeNull();
  });

  it('does not render Settings-local ProjectSelector or project badges in header', async () => {
    renderLayout();

    expect(await screen.findByRole('heading', { name: 'Settings & Preferences' })).toBeTruthy();
    expect(screen.queryByLabelText('Switch project')).toBeNull();
    expect(screen.queryByText(/Current project:/i)).toBeNull();
    expect(screen.queryByText(/Settings for:/i)).toBeNull();
    expect(screen.queryByText(/Resource project:/i)).toBeNull();
  });
});
