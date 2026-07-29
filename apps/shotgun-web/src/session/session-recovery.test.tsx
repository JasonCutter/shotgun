import { describe, expect, it, vi } from 'vitest';

import {
  ShotgunApiError,
  type ProductSessionView,
  type ShotgunApiClient,
} from '@shotgun/api-client';

import { productSessionQueryKey, sessionBoundaryQueryKey } from '../app/query-keys.js';
import { createFrontendQueryClient } from '../app/query-client.js';
import {
  createSessionCycleState,
  ensureSessionBoundary,
  reconnectSessionBoundary,
} from './session-query.js';

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

const api = (overrides: Partial<ShotgunApiClient> = {}): ShotgunApiClient =>
  ({
    bootstrapLocalOwner: vi.fn(async () => session),
    getSession: vi.fn(async () => session),
    switchActiveProject: vi.fn(async () => session),
    logout: vi.fn(async () => undefined),
    ...overrides,
  }) as unknown as ShotgunApiClient;

describe('Session Recovery State Machine', () => {
  it('treats a zero-project Product Session V2 as READY', async () => {
    const zeroProjectSession: ProductSessionView = {
      apiVersion: '2.0.0',
      principal: session.principal,
      activeProject: null,
      accessibleProjects: [],
      session: { expiresAt: null },
      sessionReady: true,
      projectReady: false,
      projectAccessRevision: '0',
    };
    const boundary = await ensureSessionBoundary(
      api({ getSession: vi.fn(async () => zeroProjectSession) }),
      undefined,
      createFrontendQueryClient(),
      createSessionCycleState(),
    );
    expect(boundary).toMatchObject({
      sessionState: 'READY',
      session: {
        apiVersion: '2.0.0',
        activeProject: null,
        accessibleProjects: [],
      },
    });
  });

  it('자동 401 Recovery Cache Purge', async () => {
    const queryClient = createFrontendQueryClient();
    queryClient.setQueryData(productSessionQueryKey, session);
    queryClient.setQueryData(['protected', 'data'], { secret: 123 });

    const getSession = vi.fn().mockRejectedValueOnce(
      new ShotgunApiError({
        status: 401,
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Session revoked',
      }),
    );
    const bootstrapLocalOwner = vi.fn().mockResolvedValueOnce(session);
    const client = api({ getSession, bootstrapLocalOwner });
    const cycleState = createSessionCycleState();

    const resultBoundary = await ensureSessionBoundary(client, undefined, queryClient, cycleState);
    expect(resultBoundary.sessionState).toBe('READY');
    expect(queryClient.getQueryData(['protected', 'data'])).toBeUndefined();
  });

  it('REVOKED → REESTABLISHING → READY', async () => {
    const queryClient = createFrontendQueryClient();
    const recordedStates: string[] = [];

    const getSession = vi.fn().mockRejectedValueOnce(
      new ShotgunApiError({
        status: 401,
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Session revoked',
      }),
    );

    const bootstrapLocalOwner = vi.fn().mockImplementation(async () => {
      const currentBoundary = queryClient.getQueryData<{ sessionState: string }>(
        sessionBoundaryQueryKey,
      );
      if (currentBoundary) {
        recordedStates.push(currentBoundary.sessionState);
      }
      return session;
    });

    const client = api({ getSession, bootstrapLocalOwner });
    const cycleState = createSessionCycleState();

    const boundary = await ensureSessionBoundary(client, undefined, queryClient, cycleState);
    expect(recordedStates).toContain('REESTABLISHING');
    expect(boundary.sessionState).toBe('READY');
  });

  it('자동 Recovery 실패', async () => {
    const queryClient = createFrontendQueryClient();
    queryClient.setQueryData(productSessionQueryKey, session);

    const getSession = vi.fn().mockRejectedValueOnce(
      new ShotgunApiError({
        status: 401,
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Session revoked',
      }),
    );
    const bootstrapLocalOwner = vi.fn().mockRejectedValueOnce(
      new ShotgunApiError({
        status: 500,
        code: 'LOCAL_SERVER_UNAVAILABLE',
        message: 'Server error',
      }),
    );

    const client = api({ getSession, bootstrapLocalOwner });
    const cycleState = createSessionCycleState();

    const resultBoundary = await ensureSessionBoundary(client, undefined, queryClient, cycleState);
    expect(resultBoundary.sessionState).toBe('UNAVAILABLE');
    expect(queryClient.getQueryData(productSessionQueryKey)).toBeUndefined();
  });

  it('Manual Reconnect 중복 클릭', async () => {
    const queryClient = createFrontendQueryClient();
    let resolveBootstrap!: (val: ProductSessionView) => void;
    const pendingBootstrap = new Promise<ProductSessionView>((resolve) => {
      resolveBootstrap = resolve;
    });
    const bootstrapLocalOwner = vi.fn(() => pendingBootstrap);
    const client = api({ bootstrapLocalOwner });
    const cycleState = createSessionCycleState();

    // Start first reconnect — it will await purgeProtectedSessionCaches then set activeBootstrapPromise
    const promise1 = reconnectSessionBoundary(client, queryClient, cycleState);

    // Yield microtasks so promise1 progresses past its await points and sets activeBootstrapPromise
    await new Promise((r) => setTimeout(r, 0));

    // Second reconnect should find activeBootstrapPromise already set and reuse it
    const promise2 = reconnectSessionBoundary(client, queryClient, cycleState);

    // Yield again so promise2 progresses past its await points and reaches the existing promise check
    await new Promise((r) => setTimeout(r, 0));

    expect(bootstrapLocalOwner).toHaveBeenCalledTimes(1);
    resolveBootstrap(session);

    const [b1, b2] = await Promise.all([promise1, promise2]);
    expect(b1.sessionState).toBe('READY');
    expect(b2.sessionState).toBe('READY');
  });
});
