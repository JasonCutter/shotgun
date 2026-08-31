import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';

import {
  ShotgunApiError,
  type DiscoveryFindingLifecycleState,
  type DiscoveryFindingType,
  type FrontendDiscoveryClient,
  type GlobalShellView,
} from '@shotgun/api-client';

import {
  discoveryDisabledQueryKey,
  discoveryFindingDetailQueryKey,
  discoveryFeedbackStateQueryKey,
  discoveryFindingsQueryKey,
  knowledgeScopeFromShell,
  type DiscoveryQueryScope,
} from '../app/query-keys.js';

export type DiscoveryInboxRequest = {
  readonly limit: number;
  readonly findingTypes?: readonly DiscoveryFindingType[];
  readonly lifecycleStates?: readonly DiscoveryFindingLifecycleState[];
};

export const discoveryScopeFromShell = (
  shell: GlobalShellView | null,
): DiscoveryQueryScope | null => knowledgeScopeFromShell(shell);

export const discoveryCanManuallyRetry = (error: unknown): error is ShotgunApiError =>
  error instanceof ShotgunApiError && error.retryability === 'SAFE';

export const discoveryQueryRetry = (failureCount: number, error: unknown): boolean =>
  discoveryCanManuallyRetry(error) && failureCount < 2;

export const discoveryInboxQueryOptions = (
  client: FrontendDiscoveryClient,
  shell: GlobalShellView | null,
  request: DiscoveryInboxRequest,
) => {
  const scope = discoveryScopeFromShell(shell);
  return infiniteQueryOptions({
    queryKey: scope
      ? discoveryFindingsQueryKey(scope, request)
      : discoveryDisabledQueryKey('inbox'),
    queryFn: ({ pageParam, signal }) =>
      client.listDiscoveryFindings(
        {
          schemaVersion: '1.0.0',
          limit: request.limit,
          ...(pageParam === undefined ? {} : { cursor: pageParam }),
          ...(request.findingTypes === undefined ? {} : { findingTypes: request.findingTypes }),
          ...(request.lifecycleStates === undefined
            ? {}
            : { lifecycleStates: request.lifecycleStates }),
        },
        { signal },
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor,
    enabled: scope !== null,
    retry: discoveryQueryRetry,
    staleTime: 15_000,
  });
};

export const discoveryDetailQueryOptions = (
  client: FrontendDiscoveryClient,
  shell: GlobalShellView | null,
  findingId: string,
  findingRevision: number,
) => {
  const scope = discoveryScopeFromShell(shell);
  const enabled = scope !== null && findingId.trim().length > 0 && findingRevision > 0;
  return queryOptions({
    queryKey:
      scope && enabled
        ? discoveryFindingDetailQueryKey(scope, findingId, findingRevision)
        : discoveryDisabledQueryKey('detail'),
    queryFn: ({ signal }) =>
      client.readDiscoveryFinding(
        { schemaVersion: '1.0.0', findingId, findingRevision },
        { signal },
      ),
    enabled,
    retry: discoveryQueryRetry,
    staleTime: 15_000,
  });
};

export const discoveryFeedbackStateQueryOptions = (
  client: FrontendDiscoveryClient,
  shell: GlobalShellView | null,
  findingId: string,
  findingRevision: number,
) => {
  const scope = discoveryScopeFromShell(shell);
  const enabled = scope !== null && findingId.trim().length > 0 && findingRevision > 0;
  return queryOptions({
    queryKey:
      scope && enabled
        ? discoveryFeedbackStateQueryKey(scope, findingId, findingRevision)
        : discoveryDisabledQueryKey('feedback-state'),
    queryFn: ({ signal }) =>
      client.readDiscoveryFeedbackState(
        { schemaVersion: '1.0.0', findingId, findingRevision },
        { signal },
      ),
    enabled,
    retry: discoveryQueryRetry,
    staleTime: 15_000,
  });
};
