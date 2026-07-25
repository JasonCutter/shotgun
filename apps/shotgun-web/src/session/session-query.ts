import type { QueryClient } from '@tanstack/react-query';
import { queryOptions } from '@tanstack/react-query';

import {
  FrontendContractError,
  ShotgunApiError,
  decodeSessionBoundaryView,
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

export const mapErrorToBoundaryView = (
  error: unknown,
  isReestablishing = false,
): SessionBoundaryView => {
  const isBrowserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;

  if (isBrowserOffline) {
    return decodeSessionBoundaryView({
      schemaVersion: '1.0.0',
      authenticationAdapter: 'local_owner',
      connectivityState: 'OFFLINE',
      authenticationState: 'authentication_unavailable',
      sessionState: 'UNAVAILABLE',
      backendReadiness: 'UNAVAILABLE',
      reasonCode: 'LOCAL_SERVER_UNAVAILABLE',
      recoveryActions: [
        { id: 'RECONNECT', label: '다시 연결', enabled: true },
        { id: 'CHECK_LOCAL_SERVER', label: '로컬 서버 상태 확인', enabled: true },
      ],
      session: null,
    });
  }

  if (error instanceof FrontendContractError) {
    return decodeSessionBoundaryView({
      schemaVersion: '1.0.0',
      authenticationAdapter: 'local_owner',
      connectivityState: 'ONLINE',
      authenticationState: 'authentication_unavailable',
      sessionState: 'UNAVAILABLE',
      backendReadiness: 'UNAVAILABLE',
      reasonCode: 'PROVISIONING_FAILED',
      recoveryActions: [
        { id: 'RECONNECT', label: '다시 연결', enabled: true },
        { id: 'CHECK_SETTINGS', label: '설정 확인', enabled: true },
      ],
      session: null,
    });
  }

  if (error instanceof Error && error.name === 'AbortError') {
    return decodeSessionBoundaryView({
      schemaVersion: '1.0.0',
      authenticationAdapter: 'local_owner',
      connectivityState: 'ONLINE',
      authenticationState: 'authentication_unavailable',
      sessionState: isReestablishing ? 'REESTABLISHING' : 'ESTABLISHING',
      backendReadiness: 'DEGRADED',
      reasonCode: isReestablishing ? 'LOCAL_SESSION_REESTABLISHING' : 'LOCAL_SESSION_ESTABLISHING',
      recoveryActions: [],
      session: null,
    });
  }

  if (error instanceof ShotgunApiError) {
    if (error.code === 'LOCAL_BOOTSTRAP_DISABLED') {
      return decodeSessionBoundaryView({
        schemaVersion: '1.0.0',
        authenticationAdapter: 'local_owner',
        connectivityState: 'ONLINE',
        authenticationState: 'authentication_unavailable',
        sessionState: 'UNAVAILABLE',
        backendReadiness: 'READY',
        reasonCode: 'LOCAL_OWNER_DISABLED',
        recoveryActions: [
          { id: 'CHECK_SETTINGS', label: '설정 확인', enabled: true },
          { id: 'RECONNECT', label: '다시 연결', enabled: true },
        ],
        session: null,
      });
    }

    if (error.code === 'LOCAL_BOOTSTRAP_FORBIDDEN') {
      return decodeSessionBoundaryView({
        schemaVersion: '1.0.0',
        authenticationAdapter: 'local_owner',
        connectivityState: 'ONLINE',
        authenticationState: 'authentication_unavailable',
        sessionState: 'UNAVAILABLE',
        backendReadiness: 'READY',
        reasonCode: 'ORIGIN_NOT_ALLOWED',
        recoveryActions: [{ id: 'CHECK_SETTINGS', label: '설정 확인', enabled: true }],
        session: null,
      });
    }

    if (error.code === 'LOCAL_BOOTSTRAP_FAILED') {
      return decodeSessionBoundaryView({
        schemaVersion: '1.0.0',
        authenticationAdapter: 'local_owner',
        connectivityState: 'ONLINE',
        authenticationState: 'authentication_unavailable',
        sessionState: 'UNAVAILABLE',
        backendReadiness: 'READY',
        reasonCode: 'PROVISIONING_FAILED',
        recoveryActions: [
          { id: 'RECONNECT', label: '다시 연결', enabled: true },
          { id: 'CHECK_SETTINGS', label: '설정 확인', enabled: true },
        ],
        session: null,
      });
    }

    if (error.status === 401) {
      return decodeSessionBoundaryView({
        schemaVersion: '1.0.0',
        authenticationAdapter: 'local_owner',
        connectivityState: 'ONLINE',
        authenticationState: 'authentication_required',
        sessionState: 'REVOKED',
        backendReadiness: 'READY',
        reasonCode: 'SESSION_REVOKED',
        recoveryActions: [{ id: 'RECONNECT', label: '다시 연결', enabled: true }],
        session: null,
      });
    }
  }

  return decodeSessionBoundaryView({
    schemaVersion: '1.0.0',
    authenticationAdapter: 'local_owner',
    connectivityState: 'ONLINE',
    authenticationState: 'authentication_unavailable',
    sessionState: 'UNAVAILABLE',
    backendReadiness: 'UNAVAILABLE',
    reasonCode: 'LOCAL_SERVER_UNAVAILABLE',
    recoveryActions: [
      { id: 'RECONNECT', label: '다시 연결', enabled: true },
      { id: 'CHECK_LOCAL_SERVER', label: '로컬 서버 상태 확인', enabled: true },
    ],
    session: null,
  });
};

export const ensureSession = async (
  apiClient: ShotgunApiClient,
  signal?: AbortSignal,
  state: SessionCycleState = createSessionCycleState(),
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
  state: SessionCycleState = createSessionCycleState(),
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
    const isReestablishing = state.hasHadReadySession;
    return mapErrorToBoundaryView(error, isReestablishing);
  }
};

export const reconnectSessionBoundary = async (
  apiClient: ShotgunApiClient,
  queryClient: QueryClient,
  state: SessionCycleState = createSessionCycleState(),
): Promise<SessionBoundaryView> => {
  const reestablishingBoundary = decodeSessionBoundaryView({
    schemaVersion: '1.0.0',
    authenticationAdapter: 'local_owner',
    connectivityState: 'ONLINE',
    authenticationState: 'authentication_unavailable',
    sessionState: 'REESTABLISHING',
    backendReadiness: 'DEGRADED',
    reasonCode: 'LOCAL_SESSION_REESTABLISHING',
    recoveryActions: [],
    session: null,
  });

  queryClient.setQueryData(sessionBoundaryQueryKey, reestablishingBoundary);
  await purgeProtectedSessionCaches(queryClient);

  if (state.activeBootstrapPromise) {
    try {
      const session = await state.activeBootstrapPromise;
      state.autoRetryBudget = 1;
      state.hasHadReadySession = true;
      const readyBoundary = decodeSessionBoundaryView({
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
      queryClient.setQueryData(sessionBoundaryQueryKey, readyBoundary);
      return readyBoundary;
    } catch (error) {
      const errorBoundary = mapErrorToBoundaryView(error, true);
      queryClient.setQueryData(sessionBoundaryQueryKey, errorBoundary);
      return errorBoundary;
    }
  }

  state.autoRetryBudget = 1;
  state.activeBootstrapPromise = apiClient.bootstrapLocalOwner().finally(() => {
    state.activeBootstrapPromise = null;
  });

  try {
    const session = await state.activeBootstrapPromise;
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
    const errorBoundary = mapErrorToBoundaryView(error, true);
    queryClient.setQueryData(sessionBoundaryQueryKey, errorBoundary);
    return errorBoundary;
  }
};

export const sessionQueryOptions = (apiClient: ShotgunApiClient, state?: SessionCycleState) =>
  queryOptions({
    queryKey: productSessionQueryKey,
    queryFn: ({ signal }) => ensureSession(apiClient, signal, state),
    retry: false,
    staleTime: 30_000,
  });

export const sessionBoundaryQueryOptions = (
  apiClient: ShotgunApiClient,
  queryClient?: QueryClient,
  state?: SessionCycleState,
) =>
  queryOptions({
    queryKey: sessionBoundaryQueryKey,
    queryFn: ({ signal }) => ensureSessionBoundary(apiClient, signal, queryClient, state),
    retry: false,
    staleTime: 30_000,
  });
