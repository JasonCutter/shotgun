import type { QueryClient } from '@tanstack/react-query';
import { queryOptions } from '@tanstack/react-query';

import {
  ShotgunApiError,
  decodeSessionBoundaryView,
  mapErrorToSessionBoundaryView,
  type ProductSessionView,
  type SessionBoundaryView,
  type ShotgunApiClient,
} from '@shotgun/api-client';

import {
  productSessionQueryKey,
  purgeProtectedSessionCaches,
  sessionBoundaryQueryKey,
} from '../app/query-keys.js';

export type SessionCycleState = {
  activeBootstrapPromise: Promise<ProductSessionView> | null;
  autoRetryBudget: number;
  hasHadReadySession: boolean;
};

export const createSessionCycleState = (): SessionCycleState => ({
  activeBootstrapPromise: null,
  autoRetryBudget: 1,
  hasHadReadySession: false,
});

let globalCycleState = createSessionCycleState();

export const resetSessionBoundaryCycleState = (): void => {
  globalCycleState = createSessionCycleState();
};

export const ensureSession = async (
  apiClient: ShotgunApiClient,
  signal?: AbortSignal,
  state: SessionCycleState = globalCycleState,
): Promise<ProductSessionView> => {
  try {
    const session = await apiClient.getSession({ signal });
    state.autoRetryBudget = 1;
    state.hasHadReadySession = true;
    return session;
  } catch (error) {
    if (error instanceof ShotgunApiError && error.status === 401) {
      if (state.activeBootstrapPromise) {
        const session = await state.activeBootstrapPromise;
        state.autoRetryBudget = 1;
        state.hasHadReadySession = true;
        return session;
      }
      if (state.autoRetryBudget <= 0) {
        throw error;
      }
      state.autoRetryBudget -= 1;
      state.activeBootstrapPromise = apiClient.bootstrapLocalOwner().finally(() => {
        state.activeBootstrapPromise = null;
      });
      const session = await state.activeBootstrapPromise;
      state.autoRetryBudget = 1;
      state.hasHadReadySession = true;
      return session;
    }
    throw error;
  }
};

export const ensureSessionBoundary = async (
  apiClient: ShotgunApiClient,
  signal?: AbortSignal,
  queryClient?: QueryClient,
  state: SessionCycleState = globalCycleState,
): Promise<SessionBoundaryView> => {
  try {
    const session = await ensureSession(apiClient, signal, state);
    return decodeSessionBoundaryView({
      schemaVersion: '1.0.0',
      authenticationAdapter: 'local_owner',
      connectivityState: 'ONLINE',
      authenticationState: 'authenticated',
      sessionState: 'READY',
      backendReadiness: 'READY',
      reasonCode: 'LOCAL_SESSION_READY',
      recoveryActions: [],
      session,
    });
  } catch (error) {
    if (queryClient) {
      await purgeProtectedSessionCaches(queryClient);
    }
    return mapErrorToSessionBoundaryView(error);
  }
};

export const reconnectSessionBoundary = async (
  apiClient: ShotgunApiClient,
  queryClient: QueryClient,
  state: SessionCycleState = globalCycleState,
): Promise<SessionBoundaryView> => {
  state.autoRetryBudget = 1;
  state.activeBootstrapPromise = null;
  await purgeProtectedSessionCaches(queryClient);

  try {
    const session = await apiClient.bootstrapLocalOwner();
    state.autoRetryBudget = 1;
    state.hasHadReadySession = true;

    const nextBoundary = decodeSessionBoundaryView({
      schemaVersion: '1.0.0',
      authenticationAdapter: 'local_owner',
      connectivityState: 'ONLINE',
      authenticationState: 'authenticated',
      sessionState: 'READY',
      backendReadiness: 'READY',
      reasonCode: 'LOCAL_SESSION_READY',
      recoveryActions: [],
      session,
    });

    queryClient.setQueryData(productSessionQueryKey, session);
    queryClient.setQueryData(sessionBoundaryQueryKey, nextBoundary);
    return nextBoundary;
  } catch (error) {
    const errorBoundary = mapErrorToSessionBoundaryView(error);
    queryClient.setQueryData(sessionBoundaryQueryKey, errorBoundary);
    return errorBoundary;
  }
};

export const sessionQueryOptions = (apiClient: ShotgunApiClient) =>
  queryOptions({
    queryKey: productSessionQueryKey,
    queryFn: ({ signal }) => ensureSession(apiClient, signal),
    retry: false,
    staleTime: 30_000,
  });

export const sessionBoundaryQueryOptions = (
  apiClient: ShotgunApiClient,
  queryClient?: QueryClient,
) =>
  queryOptions({
    queryKey: sessionBoundaryQueryKey,
    queryFn: ({ signal }) => ensureSessionBoundary(apiClient, signal, queryClient),
    retry: false,
    staleTime: 30_000,
  });
