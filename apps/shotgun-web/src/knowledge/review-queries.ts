import { queryOptions } from '@tanstack/react-query';

import {
  ShotgunApiError,
  type FrontendReviewClient,
  type GlobalShellView,
  type GetReviewApprovalRequestV1,
  type GetReviewContextRequestV1,
  type GetReviewItemDetailRequestV1,
  type ListReviewQueueRequestV1,
} from '@shotgun/api-client';

import {
  reviewContextPhaseQueryKey,
  reviewDisabledQueryKey,
  reviewQueueQueryKey,
  reviewScopeFromShell,
  type ReviewQueryScope,
} from '../app/query-keys.js';

export const reviewCanManuallyRetry = (error: unknown): error is ShotgunApiError =>
  error instanceof ShotgunApiError && error.retryability === 'SAFE';

export const reviewQueryRetry = (failureCount: number, error: unknown): boolean =>
  reviewCanManuallyRetry(error) && failureCount < 2;

export const reviewScopeFromShellOrNull = (
  shell: GlobalShellView | null,
): ReviewQueryScope | null => reviewScopeFromShell(shell);

export const reviewQueueQueryOptions = (
  client: FrontendReviewClient,
  scope: ReviewQueryScope | null,
  request: ListReviewQueueRequestV1,
) =>
  queryOptions({
    queryKey: scope ? reviewQueueQueryKey(scope, request) : reviewDisabledQueryKey('queue'),
    queryFn: ({ signal }) => client.listReviewQueue(request, { signal }),
    enabled: scope !== null,
    retry: reviewQueryRetry,
    staleTime: 15_000,
  });

export const reviewContextQueryOptions = (
  client: FrontendReviewClient,
  scope: ReviewQueryScope | null,
  request: GetReviewContextRequestV1,
) =>
  queryOptions({
    queryKey: scope
      ? reviewContextPhaseQueryKey(scope, request.reviewContextId, request.contextRevision, [
          'read',
        ])
      : reviewDisabledQueryKey('context'),
    queryFn: ({ signal }) => client.getReviewContext(request, { signal }),
    enabled: scope !== null,
    retry: reviewQueryRetry,
    staleTime: 15_000,
  });

export const reviewItemDetailQueryOptions = (
  client: FrontendReviewClient,
  scope: ReviewQueryScope | null,
  request: GetReviewItemDetailRequestV1,
) =>
  queryOptions({
    queryKey: scope
      ? reviewContextPhaseQueryKey(scope, request.reviewContextId, request.contextRevision, [
          'item',
          request.reviewItemId,
          request.includeEvidence === true,
          request.includeImpact === true,
        ])
      : reviewDisabledQueryKey('item'),
    queryFn: ({ signal }) => client.getReviewItemDetail(request, { signal }),
    enabled: scope !== null,
    retry: reviewQueryRetry,
    staleTime: 30_000,
  });

export const reviewApprovalQueryOptions = (
  client: FrontendReviewClient,
  scope: ReviewQueryScope | null,
  request: GetReviewApprovalRequestV1,
) =>
  queryOptions({
    queryKey: scope
      ? [...reviewContextPhaseQueryKey(scope, 'approval', 0, []), request.approvalId]
      : reviewDisabledQueryKey('approval'),
    queryFn: ({ signal }) => client.getReviewApproval(request, { signal }),
    enabled: scope !== null,
    retry: reviewQueryRetry,
    staleTime: 30_000,
  });
