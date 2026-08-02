import { queryOptions } from '@tanstack/react-query';

import {
  ShotgunApiError,
  type GlobalShellView,
  type KnowledgeCompareRequest,
  type KnowledgeDetailRequest,
  type KnowledgePageListRequest,
  type KnowledgeSearchRequest,
  type KnowledgeWorkspaceRequest,
  type ShotgunApiClient,
} from '@shotgun/api-client';

import {
  knowledgeCompareQueryKey,
  knowledgeDetailQueryKey,
  knowledgeDisabledQueryKey,
  knowledgePageListQueryKey,
  knowledgeScopeFromShell,
  knowledgeSearchQueryKey,
  knowledgeWorkspaceQueryKey,
} from '../app/query-keys.js';

export const knowledgeCanManuallyRetry = (error: unknown): error is ShotgunApiError =>
  error instanceof ShotgunApiError && error.retryability === 'SAFE';

export const knowledgeQueryRetry = (failureCount: number, error: unknown): boolean =>
  knowledgeCanManuallyRetry(error) && failureCount < 2;

export const knowledgeWorkspaceQueryOptions = (
  apiClient: ShotgunApiClient,
  shell: GlobalShellView | null,
  request: KnowledgeWorkspaceRequest,
) => {
  const scope = knowledgeScopeFromShell(shell);
  return queryOptions({
    queryKey: scope
      ? knowledgeWorkspaceQueryKey(scope, request)
      : knowledgeDisabledQueryKey('workspace'),
    queryFn: ({ signal }) => apiClient.getKnowledgeWorkspace(request, { signal }),
    enabled: scope !== null,
    retry: knowledgeQueryRetry,
    staleTime: 15_000,
  });
};

export const knowledgePageListQueryOptions = (
  apiClient: ShotgunApiClient,
  shell: GlobalShellView | null,
  request: KnowledgePageListRequest,
) => {
  const scope = knowledgeScopeFromShell(shell);
  return queryOptions({
    queryKey: scope
      ? knowledgePageListQueryKey(scope, request)
      : knowledgeDisabledQueryKey('pages'),
    queryFn: ({ signal }) => apiClient.listKnowledgePages(request, { signal }),
    enabled: scope !== null,
    retry: knowledgeQueryRetry,
    staleTime: 15_000,
  });
};

export const knowledgeSearchQueryOptions = (
  apiClient: ShotgunApiClient,
  shell: GlobalShellView | null,
  request: KnowledgeSearchRequest,
) => {
  const scope = knowledgeScopeFromShell(shell);
  return queryOptions({
    queryKey: scope ? knowledgeSearchQueryKey(scope, request) : knowledgeDisabledQueryKey('search'),
    queryFn: ({ signal }) => apiClient.searchKnowledge(request, { signal }),
    enabled: scope !== null,
    retry: knowledgeQueryRetry,
    staleTime: 15_000,
  });
};

export const knowledgeDetailQueryOptions = (
  apiClient: ShotgunApiClient,
  shell: GlobalShellView | null,
  request: KnowledgeDetailRequest,
) => {
  const scope = knowledgeScopeFromShell(shell);
  return queryOptions({
    queryKey: scope ? knowledgeDetailQueryKey(scope, request) : knowledgeDisabledQueryKey('detail'),
    queryFn: ({ signal }) => apiClient.getKnowledgeDetail(request, { signal }),
    enabled: scope !== null,
    retry: knowledgeQueryRetry,
    staleTime: 15_000,
  });
};

export const knowledgeCompareQueryOptions = (
  apiClient: ShotgunApiClient,
  shell: GlobalShellView | null,
  request: KnowledgeCompareRequest,
) => {
  const scope = knowledgeScopeFromShell(shell);
  return queryOptions({
    queryKey: scope
      ? knowledgeCompareQueryKey(scope, request)
      : knowledgeDisabledQueryKey('compare'),
    queryFn: ({ signal }) => apiClient.compareKnowledgePages(request, { signal }),
    enabled: scope !== null,
    retry: knowledgeQueryRetry,
    staleTime: 15_000,
  });
};
