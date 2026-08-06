import { queryOptions } from '@tanstack/react-query';

import {
  ShotgunApiError,
  type ActivityAttentionStateV1,
  type ActivityDomainKindV1,
  type ActivityLifecycleStateV1,
  type FrontendActivityClient,
  type GetActivityDetailRequestV1,
  type ListActivityContinuationRequestV1,
  type ListActivityQueueRequestV1,
  type RefreshActivityProjectionRequestV1,
} from '@shotgun/api-client';

import {
  activityDisabledQueryKey,
  activityQueueQueryKey,
  activityRefreshQueryKey,
  activityResourceQueryKey,
  type ActivityQueryScope,
} from '../app/query-keys.js';

/**
 * FE-P5-S1 WP4 — Activity Workspace read queries (ADR-130 ownership).
 *
 * React Query owns the server-state cache; keys are produced ONLY by the
 * scope-safe factories (Project/access/policy + Activity identity), never ad
 * hoc key arrays. Retry derives from ADR-118 Failure Descriptors; Activity is
 * read + explicit-refresh only (Retry/Cancel stay on the owning-Domain routes,
 * WP5). Polling is the baseline (Contract Snapshot §11) and never lets a lower
 * snapshot revision replace a newer one (the server enforces the revision
 * guard; the browser only re-reads).
 */

/** Activity queue polling interval (Contract Snapshot: Polling = BASELINE). */
export const ACTIVITY_QUEUE_POLL_INTERVAL_MS = 15_000;
/** Detail polling interval while an Activity is selected. */
export const ACTIVITY_DETAIL_POLL_INTERVAL_MS = 30_000;

export const activityCanManuallyRetry = (error: unknown): error is ShotgunApiError =>
  error instanceof ShotgunApiError && error.retryability === 'SAFE';

export const activityQueryRetry = (failureCount: number, error: unknown): boolean =>
  activityCanManuallyRetry(error) && failureCount < 2;

/** Concrete Activity identity (projection identity + exact Domain reference). */
export type ActivityIdentity = {
  readonly domainKind: ActivityDomainKindV1;
  readonly activityId: string;
  readonly domainResourceKind: string;
  readonly domainResourceId: string;
};

export type ActivityQueueRequest = {
  readonly domainKinds?: readonly ActivityDomainKindV1[];
  readonly states?: readonly ActivityLifecycleStateV1[];
  readonly attention?: ActivityAttentionStateV1;
  readonly cursor?: string;
  readonly limit?: number;
};

const queueRequestV1 = (request: ActivityQueueRequest): ListActivityQueueRequestV1 => ({
  schemaVersion: '1.0.0',
  ...(request.domainKinds === undefined ? {} : { domainKinds: request.domainKinds }),
  ...(request.states === undefined ? {} : { states: request.states }),
  ...(request.attention === undefined ? {} : { attention: request.attention }),
  ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
  ...(request.limit === undefined ? {} : { limit: request.limit }),
});

export const activityQueueQueryOptions = (
  client: FrontendActivityClient,
  scope: ActivityQueryScope | null,
  request: ActivityQueueRequest,
  options: { readonly pollingEnabled?: boolean } = {},
) => {
  const pollingEnabled = options.pollingEnabled ?? true;
  return queryOptions({
    queryKey: scope
      ? activityQueueQueryKey(scope, queueRequestV1(request))
      : activityDisabledQueryKey('queue'),
    queryFn: ({ signal }) => client.listActivityQueue(queueRequestV1(request), { signal }),
    enabled: scope !== null,
    retry: activityQueryRetry,
    staleTime: 10_000,
    // Polling-based authoritative refresh (baseline; Contract Snapshot §11).
    // The user can disable polling; manual refresh remains available.
    refetchInterval: (query) =>
      pollingEnabled && query.state.data ? ACTIVITY_QUEUE_POLL_INTERVAL_MS : false,
  });
};

const detailRequest = (identity: ActivityIdentity | null): GetActivityDetailRequestV1 => ({
  schemaVersion: '1.0.0',
  domainKind: identity?.domainKind ?? 'SOURCES',
  activityId: identity?.activityId ?? 'disabled',
  domainResourceKind: identity?.domainResourceKind ?? 'disabled',
  domainResourceId: identity?.domainResourceId ?? 'disabled',
});

export const activityDetailQueryOptions = (
  client: FrontendActivityClient,
  scope: ActivityQueryScope | null,
  identity: ActivityIdentity | null,
) => {
  const enabled = scope !== null && identity !== null;
  return queryOptions({
    queryKey:
      scope && identity
        ? activityResourceQueryKey(scope, identity, ['detail'])
        : activityDisabledQueryKey('detail'),
    queryFn: ({ signal }) => client.getActivityDetail(detailRequest(identity), { signal }),
    enabled,
    retry: activityQueryRetry,
    staleTime: 20_000,
    refetchInterval: (query) =>
      enabled && query.state.data ? ACTIVITY_DETAIL_POLL_INTERVAL_MS : false,
  });
};

const continuationRequest = (
  identity: ActivityIdentity | null,
  cursor: string | undefined,
  limit: number | undefined,
): ListActivityContinuationRequestV1 => ({
  schemaVersion: '1.0.0',
  domainKind: identity?.domainKind ?? 'SOURCES',
  activityId: identity?.activityId ?? 'disabled',
  domainResourceKind: identity?.domainResourceKind ?? 'disabled',
  domainResourceId: identity?.domainResourceId ?? 'disabled',
  ...(cursor === undefined ? {} : { cursor }),
  ...(limit === undefined ? {} : { limit }),
});

export const activityStagesQueryOptions = (
  client: FrontendActivityClient,
  scope: ActivityQueryScope | null,
  identity: ActivityIdentity | null,
  cursor?: string,
  limit?: number,
) => {
  const enabled = scope !== null && identity !== null;
  return queryOptions({
    queryKey:
      scope && identity
        ? activityResourceQueryKey(scope, identity, ['stages', cursor ?? 'first', limit ?? 'cap'])
        : activityDisabledQueryKey('stages'),
    queryFn: ({ signal }) =>
      client.listActivityStages(continuationRequest(identity, cursor, limit), { signal }),
    enabled,
    retry: activityQueryRetry,
    staleTime: 30_000,
  });
};

export const activityEventsQueryOptions = (
  client: FrontendActivityClient,
  scope: ActivityQueryScope | null,
  identity: ActivityIdentity | null,
  cursor?: string,
  limit?: number,
) => {
  const enabled = scope !== null && identity !== null;
  return queryOptions({
    queryKey:
      scope && identity
        ? activityResourceQueryKey(scope, identity, ['events', cursor ?? 'first', limit ?? 'cap'])
        : activityDisabledQueryKey('events'),
    queryFn: ({ signal }) =>
      client.listActivityEvents(continuationRequest(identity, cursor, limit), { signal }),
    enabled,
    retry: activityQueryRetry,
    staleTime: 30_000,
  });
};

export const refreshActivityProjectionRequest = (): RefreshActivityProjectionRequestV1 => ({
  schemaVersion: '1.0.0',
});

/** Refresh-phase key: the explicit authoritative refresh result for a scope. */
export const activityRefreshQueryKeyForScope = (scope: ActivityQueryScope) =>
  activityRefreshQueryKey(scope);
