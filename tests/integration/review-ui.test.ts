import { describe, expect, it } from 'vitest';

import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import type { DraftChangeSet } from '../../packages/contracts/src/index.js';

describe('Stage 5 review UI', () => {
  it('shows Candidate, Evidence, and Diff without treating page state as approval', async () => {
    const { server } = await createApplication();
    const intake = await server.inject({
      method: 'POST',
      url: '/intake',
      payload: {
        submissionId: 'stage5-review-ui',
        input: { kind: 'direct_text', text: 'Milo weighs 5 kg.' },
      },
    });
    expect(intake.statusCode).toBe(200);
    const draft = intake.json().reviews.items[0] as DraftChangeSet;

    const page = await server.inject({
      method: 'GET',
      url: `/reviews/${draft.changeSetId}`,
    });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.body).toContain('후보 Claim');
    expect(page.body).toContain('Machine Diff');
    expect(page.body).toContain('Evidence');
    expect(page.body).toContain('data-decision="APPROVE"');

    const unchanged = await server.inject({
      method: 'POST',
      url: '/reviews/resolve',
      payload: { changeSetId: draft.changeSetId },
    });
    expect(unchanged.json().review.changeSet.status).toBe('PENDING_REVIEW');

    const approved = await server.inject({
      method: 'POST',
      url: '/reviews/decision',
      payload: {
        changeSetId: draft.changeSetId,
        expectedRevisionNumber: 1,
        expectedContentDigest: draft.contentDigest,
        decision: 'APPROVE',
        reason: 'Reviewed in the Stage 5 UI.',
      },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({
      changeSet: { status: 'APPROVED' },
      manifest: {
        contentDigest: draft.contentDigest,
        reason: 'Reviewed in the Stage 5 UI.',
      },
    });

    await server.close();
  });
});
