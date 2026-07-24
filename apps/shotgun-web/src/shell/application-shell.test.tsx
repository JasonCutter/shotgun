import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import type { ProductSessionView, ShotgunApiClient } from '@shotgun/api-client';

import { productSessionQueryKey } from '../app/query-keys.js';
import { AppProviders, type AppRuntime } from '../app/providers.js';
import { createFrontendQueryClient } from '../app/query-client.js';
import { render } from '@testing-library/react';
import { HomePage } from '../routes/home-page.js';
import { PlaceholderPage } from '../routes/placeholder-page.js';
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

const runtime = (): AppRuntime => {
  const queryClient = createFrontendQueryClient();
  queryClient.setQueryData(productSessionQueryKey, session);
  const apiClient: ShotgunApiClient = {
    bootstrapLocalOwner: vi.fn(async () => session),
    getSession: vi.fn(async () => session),
    getSessionBoundary: vi.fn(async () => ({
      schemaVersion: '1.0.0' as const,
      authenticationAdapter: 'local_owner' as const,
      connectivityState: 'ONLINE' as const,
      authenticationState: 'authenticated' as const,
      sessionState: 'READY' as const,
      backendReadiness: 'READY' as const,
      reasonCode: 'LOCAL_SESSION_READY' as const,
      recoveryActions: [],
      session,
    })),
    switchActiveProject: vi.fn(async () => session),
    logout: vi.fn(async () => undefined),
  };
  return { apiClient, queryClient };
};

describe('ApplicationShell', () => {
  it('provides landmarks, skip navigation, current navigation, and project context', async () => {
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
    expect(await screen.findByRole('banner')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: '주요 탐색' })).toBeTruthy();
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('link', { name: '본문으로 건너뛰기' }).getAttribute('href')).toBe(
      '#main-content',
    );
    expect(screen.getByRole('link', { name: 'Home' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByText('project-a', { selector: 'strong' })).toBeTruthy();
  });

  it('shows placeholder content and focuses the route heading after navigation', async () => {
    const user = userEvent.setup();
    const appRuntime = runtime();
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <ApplicationShell />,
          children: [
            { index: true, element: <HomePage /> },
            {
              path: 'sources',
              element: <PlaceholderPage heading="Sources" nextSection="Frontend Section 2" />,
            },
          ],
        },
      ],
      { initialEntries: ['/'] },
    );
    render(
      <AppProviders runtime={appRuntime}>
        <RouterProvider router={router} />
      </AppProviders>,
    );
    await user.click(await screen.findByRole('link', { name: 'Sources' }));
    const heading = await screen.findByRole('heading', { level: 1, name: 'Sources' });
    expect(
      screen.getByText('이 기능은 아직 Frontend Section 1에 연결되지 않았습니다.'),
    ).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });
});
