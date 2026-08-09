import { queryOptions } from '@tanstack/react-query';

import {
  ShotgunApiError,
  type FrontendHistoryClient,
  type GetHistoryEntryRequestV1,
  type HistoryCursorV1,
  type HistorySourceDomainKindV1,
  type ListHistoryWorkspaceRequestV1,
} from '@shotgun/api-client';

import {
  historyDisabledQueryKey,
  historyEntryQueryKey,
  historyListQueryKey,
  type HistoryQueryScope,
} from '../app/query-keys.js';

/**
 * FE-P5-S2 WP5 — History Workspace read queries.
 *
 * React Query owns the server-state cache; keys are produced ONLY by the
 * scope-safe factories (Project/access/policy + request/identity), never ad
 * hoc key arrays. Retry derives from ADR-118 Failure Descriptors; History is
 * read-only (Reversal creation stays on the change-set-review owning route,
 * WP3). The browser sends the frozen cursor object; the server derives the
 * active project binding and capability gate (AC-13).
 */

export const HISTORY_LIST_LIMIT = 50;

export const historyCanManuallyRetry = (error: unknown): error is ShotgunApiError =>
  error instanceof ShotgunApiError && error.retryability === 'SAFE';

export const historyQueryRetry = (failureCount: number, error: unknown): boolean =>
  historyCanManuallyRetry(error) && failureCount < 2;

export type HistoryListRequest = {
  readonly domainKinds?: readonly HistorySourceDomainKindV1[];
  readonly cursor?: HistoryCursorV1;
  readonly limit?: number;
};

const listRequestV1 = (
  resourceProjectId: string,
  request: HistoryListRequest,
): ListHistoryWorkspaceRequestV1 => ({
  schemaVersion: '1.0.0',
  resourceProjectId,
  ...(request.domainKinds === undefined ? {} : { domainKinds: request.domainKinds }),
  ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
  limit: request.limit ?? HISTORY_LIST_LIMIT,
});

export const historyListQueryOptions = (
  client: FrontendHistoryClient,
  scope: HistoryQueryScope | null,
  request: HistoryListRequest,
) => {
  const requestV1 = listRequestV1(scope?.resourceProjectId ?? 'disabled', request);
  return queryOptions({
    queryKey: scope ? historyListQueryKey(scope, requestV1) : historyDisabledQueryKey('list'),
    queryFn: ({ signal }) => client.listHistoryWorkspace(requestV1, { signal }),
    enabled: scope !== null,
    retry: historyQueryRetry,
    staleTime: 10_000,
  });
};

export const historyEntryQueryOptions = (
  client: FrontendHistoryClient,
  scope: HistoryQueryScope | null,
  historyEntryId: string | null,
) => {
  const enabled = scope !== null && historyEntryId !== null;
  const request: GetHistoryEntryRequestV1 = {
    schemaVersion: '1.0.0',
    resourceProjectId: scope?.resourceProjectId ?? 'disabled',
    historyEntryId: historyEntryId ?? 'disabled',
  };
  return queryOptions({
    queryKey:
      scope && historyEntryId
        ? historyEntryQueryKey(scope, historyEntryId)
        : historyDisabledQueryKey('entry'),
    queryFn: ({ signal }) => client.getHistoryEntry(request, { signal }),
    enabled,
    retry: historyQueryRetry,
    staleTime: 20_000,
  });
};
