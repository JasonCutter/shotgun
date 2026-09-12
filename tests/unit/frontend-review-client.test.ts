import { describe, expect, it, vi } from 'vitest';

import { createFrontendReviewClient } from '../../packages/shotgun-api-client/src/index.js';

const responseJson = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('Frontend Review API client', () => {
  it('decodes a V2 freshness rejection as a typed actionable error', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      if (String(input) === '/api/v1/security/csrf') {
        return responseJson({ csrfToken: 'csrf-test-token' });
      }
      return responseJson(
        {
          schemaVersion: '1.0.0',
          code: 'REVIEW_CONTEXT_STALE',
          category: 'CONFLICT',
          retryability: 'CONDITIONAL',
          recovery: 'REFRESH_AND_REAPPLY',
          message:
            'This Review is no longer fresh. Refresh or recompare the Candidate before approving it.',
        },
        409,
      );
    });
    const client = createFrontendReviewClient({ fetch });

    await expect(
      client.recordComparisonV2Decision({
        changeSetId: 'comparison-v2:stale',
        expectedRevisionNumber: 1,
        expectedContentDigest: 'sha256:expected',
        decision: 'APPROVE',
        reason: 'Approve after review.',
        decisionId: 'decision-stale',
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'REVIEW_CONTEXT_STALE',
      category: 'CONFLICT',
      retryability: 'CONDITIONAL',
      recovery: 'REFRESH_AND_REAPPLY',
      message:
        'This Review is no longer fresh. Refresh or recompare the Candidate before approving it.',
    });
    await expect(
      client.recordComparisonV2Decision({
        changeSetId: 'comparison-v2:stale',
        expectedRevisionNumber: 1,
        expectedContentDigest: 'sha256:expected',
        decision: 'APPROVE',
        reason: 'Approve after review.',
        decisionId: 'decision-stale',
      }),
    ).rejects.not.toMatchObject({ code: 'REMOTE_UNCLASSIFIED' });
  });
});
