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
  reviewResourceResolutionQueryKey,
  reviewQueueQueryKey,
  reviewScopeFromShell,
  type ReviewQueryScope,
} from '../app/query-keys.js';
import { reviewContextIdForResource } from './review-route-identity.js';

export const REVIEW_DEEP_LINK_PAGE_SIZE = 50;

export type ReviewResourceResolution =
  | {
      readonly status: 'FOUND';
      readonly reviewContextId: string;
      readonly contextRevision: number;
    }
  | {
      readonly status: 'EXHAUSTED';
      readonly reviewContextId: string;
    };

/**
 * Resolve a resource deep link against the server-owned Review queue. The
 * resolver deliberately omits visual queue filters and follows only the
 * server cursor until the exact context is found or the queue is exhausted.
 * It never derives or fabricates a context revision.
 */
export const resolveReviewResource = async (
  client: FrontendReviewClient,
  targetKind: 'DISCOVERY_CANDIDATE',
  resourceId: string,
  signal?: AbortSignal,
): Promise<ReviewResourceResolution> => {
  const reviewContextId = reviewContextIdForResource(targetKind, resourceId);
  let cursor: string | undefined;
  const seenCursors = new Set<string>();

  while (true) {
    const page = await client.listReviewQueue(
      {
        schemaVersion: '1.0.0',
        pageSize: REVIEW_DEEP_LINK_PAGE_SIZE,
        targetKinds: [targetKind],
        ...(cursor ? { cursor } : {}),
      },
      { signal },
    );
    const matchedItem = page.items.find(
      (item) => item.targetKind === targetKind && item.reviewContextId === reviewContextId,
    );
    if (matchedItem) {
      return {
        status: 'FOUND',
        reviewContextId: matchedItem.reviewContextId,
        contextRevision: matchedItem.contextRevision,
      };
    }

    const nextCursor = page.nextCursor;
    if (!nextCursor || seenCursors.has(nextCursor)) {
      return { status: 'EXHAUSTED', reviewContextId };
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
};

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

export const reviewResourceResolutionQueryOptions = (
  client: FrontendReviewClient,
  scope: ReviewQueryScope | null,
  resourceId: string | null,
) =>
  queryOptions({
    queryKey:
      scope && resourceId
        ? reviewResourceResolutionQueryKey(scope, 'DISCOVERY_CANDIDATE', resourceId)
        : reviewDisabledQueryKey('resource-resolution'),
    queryFn: ({ signal }) =>
      resolveReviewResource(client, 'DISCOVERY_CANDIDATE', resourceId!, signal),
    enabled: scope !== null && resourceId !== null,
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
