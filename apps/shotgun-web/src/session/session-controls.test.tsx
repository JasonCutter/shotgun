import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import {
  ShotgunApiError,
  type ProductSessionView,
  type ShotgunApiClient,
} from '@shotgun/api-client';

import { productSessionQueryKey } from '../app/query-keys.js';
import { AppProviders, type AppRuntime } from '../app/providers.js';
import { createFrontendQueryClient } from '../app/query-client.js';
import { ensureSession } from './session-query.js';
import { LogoutButton } from './logout-button.js';
import { ProjectSelector } from './project-selector.js';

const session: ProductSessionView = {
  apiVersion: '1.0.0',
  principal: {
    id: 'principal-a',
    actor: { type: 'user', id: 'principal-a' },
    authenticationMethod: 'session',
  },
  activeProject: { id: 'project-a' },
  accessibleProjects: [
    { id: 'project-a', isOwner: true },
    { id: 'project-b', isOwner: false },
  ],
  session: { expiresAt: null },
};

const renderRoute = (element: React.ReactNode, apiClient: ShotgunApiClient) => {
  const queryClient = createFrontendQueryClient();
  queryClient.setQueryData(productSessionQueryKey, session);
  const runtime: AppRuntime = { apiClient, queryClient };
  const router = createMemoryRouter([{ path: '/', element }], { initialEntries: ['/'] });
  render(
    <AppProviders runtime={runtime}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { queryClient, router };
};

const api = (overrides: Partial<ShotgunApiClient> = {}): ShotgunApiClient => ({
  bootstrapLocalOwner: vi.fn(async () => session),
  getSession: vi.fn(async () => session),
  switchActiveProject: vi.fn(async () => session),
  logout: vi.fn(async () => undefined),
  ...overrides,
});

describe('Session controls', () => {
  it('authenticates local owner when session is missing without showing login screen', async () => {
    const getSession = vi.fn().mockRejectedValueOnce(
      new ShotgunApiError({
        status: 401,
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication required',
      }),
    );
    const bootstrapLocalOwner = vi.fn().mockResolvedValueOnce(session);
    const client = api({ getSession, bootstrapLocalOwner });
    const result = await ensureSession(client);
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(bootstrapLocalOwner).toHaveBeenCalledTimes(1);
    expect(result).toEqual(session);
  });

  it('keeps the current project selected and reports an error when switching fails', async () => {
    const user = userEvent.setup();
    let rejectSwitch!: (error: Error) => void;
    const pending = new Promise<ProductSessionView>((_resolve, reject) => {
      rejectSwitch = reject;
    });
    renderRoute(
      <ProjectSelector session={session} />,
      api({ switchActiveProject: vi.fn(() => pending) }),
    );
    const selector = screen.getByRole('combobox', { name: 'Active Project' });
    await user.selectOptions(selector, 'project-b');
    expect((selector as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toContain('Project 전환 중');
    rejectSwitch(new TypeError('network unavailable'));
    expect((await screen.findByRole('alert')).textContent).toContain('네트워크 연결');
    expect((selector as HTMLSelectElement).value).toBe('project-a');
  });

  it('shows logout pending and resets session cache on logout', async () => {
    const user = userEvent.setup();
    let resolveLogout = (): void => undefined;
    const pending = new Promise<void>((resolve) => {
      resolveLogout = resolve;
    });
    const { queryClient } = renderRoute(<LogoutButton />, api({ logout: vi.fn(() => pending) }));
    await user.click(screen.getByRole('button', { name: '로그아웃' }));
    expect((screen.getByRole('button', { name: '로그아웃' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(queryClient.getQueryData(productSessionQueryKey)).toEqual(session);
    resolveLogout();
    await waitFor(() => expect(queryClient.getQueryData(productSessionQueryKey)).toEqual(session));
  });
});
