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
  it('exposes exactly the four primary owner categories: AI, Privacy, Preferences, and Project', async () => {
    renderLayout();

    expect(await screen.findByRole('heading', { name: 'Settings & Preferences' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'AI' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Privacy' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Preferences' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Project' })).toBeTruthy();

    // Verify absence of legacy tabs
    expect(screen.queryByRole('link', { name: 'Audit' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Secrets' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Backup' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'System' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Capabilities' })).toBeNull();
  });

  it('does not render Settings-local ProjectSelector or project badges in header', async () => {
    renderLayout();

    expect(await screen.findByRole('heading', { name: 'Settings & Preferences' })).toBeTruthy();
    expect(screen.queryByLabelText('Switch project')).toBeNull();
    expect(screen.queryByText(/Current project:/i)).toBeNull();
    expect(screen.queryByText(/Settings for:/i)).toBeNull();
    expect(screen.queryByText(/Resource project:/i)).toBeNull();
  });

  it('renders clean canonical category links without targetProjectId query parameter', async () => {
    renderLayout('/settings');

    expect(await screen.findByRole('heading', { name: 'Settings & Preferences' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'AI' }).getAttribute('href')).toBe('/settings/ai');
    expect(screen.getByRole('link', { name: 'Privacy' }).getAttribute('href')).toBe(
      '/settings/privacy',
    );
    expect(screen.getByRole('link', { name: 'Preferences' }).getAttribute('href')).toBe(
      '/settings/preferences',
    );
    expect(screen.getByRole('link', { name: 'Project' }).getAttribute('href')).toBe(
      '/settings/projects',
    );
  });
});
