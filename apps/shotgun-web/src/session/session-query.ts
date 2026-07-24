import { queryOptions } from '@tanstack/react-query';

import {
  ShotgunApiError,
  decodeSessionBoundaryView,
  mapErrorToSessionBoundaryView,
  type ProductSessionView,
  type SessionBoundaryView,
  type ShotgunApiClient,
} from '@shotgun/api-client';

import { productSessionQueryKey, sessionBoundaryQueryKey } from '../app/query-keys.js';

let activeBootstrapPromise: Promise<ProductSessionView> | null = null;
let hasAutoReestablishedInCycle = false;

export const resetSessionBoundaryCycleState = (): void => {
  hasAutoReestablishedInCycle = false;
  activeBootstrapPromise = null;
};

export const ensureSession = async (
  apiClient: ShotgunApiClient,
  signal?: AbortSignal,
): Promise<ProductSessionView> => {
  try {
    const session = await apiClient.getSession({ signal });
    hasAutoReestablishedInCycle = false;
    return session;
  } catch (error) {
    if (error instanceof ShotgunApiError && error.status === 401) {
      if (hasAutoReestablishedInCycle) {
        throw error;
      }
      if (!activeBootstrapPromise) {
        hasAutoReestablishedInCycle = true;
        activeBootstrapPromise = apiClient.bootstrapLocalOwner({ signal }).finally(() => {
          activeBootstrapPromise = null;
        });
      }
      return await activeBootstrapPromise;
    }
    throw error;
  }
};

export const ensureSessionBoundary = async (
  apiClient: ShotgunApiClient,
  signal?: AbortSignal,
): Promise<SessionBoundaryView> => {
  try {
    const session = await ensureSession(apiClient, signal);
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
    return mapErrorToSessionBoundaryView(error);
  }
};

export const sessionQueryOptions = (apiClient: ShotgunApiClient) =>
  queryOptions({
    queryKey: productSessionQueryKey,
    queryFn: ({ signal }) => ensureSession(apiClient, signal),
    retry: false,
    staleTime: 30_000,
  });

export const sessionBoundaryQueryOptions = (apiClient: ShotgunApiClient) =>
  queryOptions({
    queryKey: sessionBoundaryQueryKey,
    queryFn: ({ signal }) => ensureSessionBoundary(apiClient, signal),
    retry: false,
    staleTime: 30_000,
  });
