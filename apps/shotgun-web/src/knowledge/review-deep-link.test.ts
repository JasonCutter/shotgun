import { describe, expect, it, vi } from 'vitest';

import type {
  FrontendReviewClient,
  ListReviewQueueRequestV1,
  ListReviewQueueResultV1,
  ReviewQueueItemV1,
} from '@shotgun/api-client';

import { REVIEW_DEEP_LINK_PAGE_SIZE, resolveReviewResource } from './review-queries.js';
import { reviewContextIdForResource } from './review-route-identity.js';

const queueItem = (
  reviewResourceId: string,
  overrides: Partial<ReviewQueueItemV1> = {},
): ReviewQueueItemV1 => ({
  schemaVersion: '1.0.0',
  reviewContextId: reviewContextIdForResource('DISCOVERY_CANDIDATE', reviewResourceId),
  contextRevision: 7,
  targetKind: 'DISCOVERY_CANDIDATE',
  targetId: reviewResourceId,
  targetLabel: 'Discovery candidate',
  aggregateState: 'PENDING',
  itemCount: 1,
  updatedAt: '2026-08-31T00:00:00.000Z',
  attentionReasons: [],
  capabilities: [],
  ...overrides,
});

const queuePage = (
  items: readonly ReviewQueueItemV1[],
  nextCursor?: string,
): ListReviewQueueResultV1 => ({
  schemaVersion: '1.0.0',
  acceptedContext: {
    schemaVersion: '1.0.0',
    resourceProjectId: 'project-1',
    accessRevision: 'access-1',
    policyContextRevision: 'policy-1',
  },
  queueSnapshotRevision: 'snapshot-1',
  items,
  ...(nextCursor ? { nextCursor } : {}),
  totalCountStatus: 'UNAVAILABLE',
  capabilities: [],
});

const clientWithPages = (pages: readonly ListReviewQueueResultV1[]) => {
  let index = 0;
  const listReviewQueue = vi.fn(async (request: ListReviewQueueRequestV1) => {
    if (request.pageSize !== REVIEW_DEEP_LINK_PAGE_SIZE) {
      throw new Error('unexpected deep-link page size');
    }
    return pages[index++];
  });
  return { client: { listReviewQueue } as unknown as FrontendReviewClient, listReviewQueue };
};

describe('Review resource deep-link resolver', () => {
  it('follows the server cursor and resolves a Discovery target on page 2', async () => {
    const { client, listReviewQueue } = clientWithPages([
      queuePage([queueItem('other-resource')], 'page-2'),
      queuePage([queueItem('target-resource', { contextRevision: 12 })]),
    ]);

    const result = await resolveReviewResource(client, 'DISCOVERY_CANDIDATE', 'target-resource');

    expect(result).toEqual({
      status: 'FOUND',
      reviewContextId: reviewContextIdForResource('DISCOVERY_CANDIDATE', 'target-resource'),
      contextRevision: 12,
    });
    expect(listReviewQueue).toHaveBeenNthCalledWith(
      1,
      {
        schemaVersion: '1.0.0',
        pageSize: REVIEW_DEEP_LINK_PAGE_SIZE,
        targetKinds: ['DISCOVERY_CANDIDATE'],
      },
      { signal: undefined },
    );
    expect(listReviewQueue).toHaveBeenNthCalledWith(
      2,
      {
        schemaVersion: '1.0.0',
        pageSize: REVIEW_DEEP_LINK_PAGE_SIZE,
        targetKinds: ['DISCOVERY_CANDIDATE'],
        cursor: 'page-2',
      },
      { signal: undefined },
    );
  });

  it('returns exhausted without fabricating a revision and ignores visual filters', async () => {
    const { client, listReviewQueue } = clientWithPages([
      queuePage([queueItem('other-resource')], 'page-2'),
      queuePage([queueItem('still-other-resource')]),
    ]);

    const result = await resolveReviewResource(client, 'DISCOVERY_CANDIDATE', 'missing-resource');

    expect(result).toEqual({
      status: 'EXHAUSTED',
      reviewContextId: reviewContextIdForResource('DISCOVERY_CANDIDATE', 'missing-resource'),
    });
    expect(result).not.toHaveProperty('contextRevision');
    expect(listReviewQueue).toHaveBeenCalledTimes(2);
    expect(listReviewQueue.mock.calls.flatMap(([request]) => Object.keys(request))).not.toEqual(
      expect.arrayContaining(['aggregateStates', 'attentionReasons', 'query']),
    );
  });

  it('stops safely if the server repeats a cursor', async () => {
    const { client, listReviewQueue } = clientWithPages([
      queuePage([], 'same-cursor'),
      queuePage([], 'same-cursor'),
    ]);

    const result = await resolveReviewResource(client, 'DISCOVERY_CANDIDATE', 'missing-resource');

    expect(result.status).toBe('EXHAUSTED');
    expect(listReviewQueue).toHaveBeenCalledTimes(2);
  });
});
