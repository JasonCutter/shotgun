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
import { createSessionCycleState, ensureSession } from './session-query.js';
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
  const sessionCycleState = createSessionCycleState();
  queryClient.setQueryData(productSessionQueryKey, session);
  const runtime: AppRuntime = { apiClient, queryClient, sessionCycleState };
  const router = createMemoryRouter([{ path: '/', element }], { initialEntries: ['/'] });
  render(
    <AppProviders runtime={runtime}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { queryClient, router, sessionCycleState };
};

const api = (overrides: Partial<ShotgunApiClient> = {}): ShotgunApiClient =>
  ({
    bootstrapLocalOwner: vi.fn(async () => session),
    getSession: vi.fn(async () => session),
    switchActiveProject: vi.fn(async () => session),
    logout: vi.fn(async () => undefined),
    ...overrides,
  }) as unknown as ShotgunApiClient;

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
    const cycleState = createSessionCycleState();
    const result = await ensureSession(client, undefined, cycleState);
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(bootstrapLocalOwner).toHaveBeenCalledTimes(1);
    expect(result).toEqual(session);
  });

  it('deduplicates concurrent 401 bootstrap calls to a single network invocation', async () => {
    const getSession = vi.fn().mockRejectedValue(
      new ShotgunApiError({
        status: 401,
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication required',
      }),
    );
    const bootstrapLocalOwner = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return session;
    });
    const client = api({ getSession, bootstrapLocalOwner });
    const cycleState = createSessionCycleState();

    const [res1, res2, res3] = await Promise.all([
      ensureSession(client, undefined, cycleState),
      ensureSession(client, undefined, cycleState),
      ensureSession(client, undefined, cycleState),
    ]);

    expect(bootstrapLocalOwner).toHaveBeenCalledTimes(1);
    expect(res1).toEqual(session);
    expect(res2).toEqual(session);
    expect(res3).toEqual(session);
  });

  it('enforces maximum 1 auto-rebootstrap per cycle without infinite loops', async () => {
    const getSession = vi.fn().mockRejectedValue(
      new ShotgunApiError({
        status: 401,
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication required',
      }),
    );
    const bootstrapLocalOwner = vi.fn().mockRejectedValue(
      new ShotgunApiError({
        status: 401,
        code: 'LOCAL_BOOTSTRAP_FAILED',
        message: 'Bootstrap failed',
      }),
    );
    const client = api({ getSession, bootstrapLocalOwner });
    const cycleState = createSessionCycleState();

    await expect(ensureSession(client, undefined, cycleState)).rejects.toThrow();
    await expect(ensureSession(client, undefined, cycleState)).rejects.toThrow();
    expect(bootstrapLocalOwner).toHaveBeenCalledTimes(1);
  });

  it('isolates cycleState between distinct runtime instances', async () => {
    const getSession = vi.fn().mockRejectedValue(
      new ShotgunApiError({
        status: 401,
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication required',
      }),
    );
    const bootstrapLocalOwner = vi.fn().mockRejectedValue(
      new ShotgunApiError({
        status: 401,
        code: 'LOCAL_BOOTSTRAP_FAILED',
        message: 'Bootstrap failed',
      }),
    );
    const client = api({ getSession, bootstrapLocalOwner });

    const runtimeAState = createSessionCycleState();
    const runtimeBState = createSessionCycleState();

    await expect(ensureSession(client, undefined, runtimeAState)).rejects.toThrow();
    expect(runtimeAState.autoRetryBudget).toBe(0);
    expect(runtimeBState.autoRetryBudget).toBe(1);

    await expect(ensureSession(client, undefined, runtimeBState)).rejects.toThrow();
    expect(runtimeBState.autoRetryBudget).toBe(0);
    expect(bootstrapLocalOwner).toHaveBeenCalledTimes(2);
  });

  it('maintains non-optimistic server-confirmed project in selector during pending mutation', async () => {
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
    expect((selector as HTMLSelectElement).value).toBe('project-a');

    await user.selectOptions(selector, 'project-b');
    expect((selector as HTMLSelectElement).value).toBe('project-a');
    expect((selector as HTMLSelectElement).disabled).toBe(true);

    rejectSwitch(new TypeError('network unavailable'));
    await waitFor(() => expect((selector as HTMLSelectElement).disabled).toBe(false));
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
