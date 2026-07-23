import { queryOptions } from '@tanstack/react-query';

import {
  ShotgunApiError,
  type ProductSessionView,
  type ShotgunApiClient,
} from '@shotgun/api-client';

import { productSessionQueryKey } from '../app/query-keys.js';

export const ensureSession = async (
  apiClient: ShotgunApiClient,
  signal?: AbortSignal,
): Promise<ProductSessionView> => {
  try {
    return await apiClient.getSession({ signal });
  } catch (error) {
    if (error instanceof ShotgunApiError && error.status === 401) {
      return await apiClient.bootstrapLocalOwner({ signal });
    }
    throw error;
  }
};

export const sessionQueryOptions = (apiClient: ShotgunApiClient) =>
  queryOptions({
    queryKey: productSessionQueryKey,
    queryFn: ({ signal }) => ensureSession(apiClient, signal),
    retry: false,
    staleTime: 30_000,
  });
