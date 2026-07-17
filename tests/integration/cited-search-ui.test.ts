import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createApplication } from '../../assemblies/shotgun-app/src/server.js';

describe('Stage 2-7 Walking Skeleton and cited Ask UI', () => {
  it('connects intake, approval, projection, answer and evidence navigation', async () => {
    const { server } = await createApplication();
    const submissionId = `walking-skeleton-${randomUUID()}`;
    const intake = await server.inject({
      method: 'POST',
      url: '/intake',
      payload: {
        submissionId,
        input: { kind: 'direct_text', text: 'Milo weighs 5 kg.' },
      },
    });
    expect(intake.statusCode).toBe(200);
    const draft = intake.json().reviews.items[0];

    const decision = await server.inject({
      method: 'POST',
      url: '/reviews/decision',
      payload: {
        changeSetId: draft.changeSetId,
        expectedRevisionNumber: 1,
        expectedContentDigest: draft.contentDigest,
        decision: 'APPROVE',
        reason: 'Walking Skeleton owner approval.',
      },
    });
    expect(decision.statusCode).toBe(200);

    const rebuild = await server.inject({
      method: 'POST',
      url: '/projection/rebuild',
      payload: {},
    });
    expect(rebuild.statusCode).toBe(200);
    expect(rebuild.json()).toMatchObject({
      commandStatus: 'processed',
      result: { rebuilt: 1, canonicalVersion: 1 },
    });

    const ask = await server.inject({
      method: 'POST',
      url: '/ask/query',
      payload: { question: 'Milo weighs' },
    });
    expect(ask.statusCode).toBe(200);
    const answer = ask.json().answer;
    expect(answer).toMatchObject({
      status: 'ANSWERED',
      readiness: { status: 'READY', lag: 0 },
      statements: [{ text: 'Milo weighs 5 kg.' }],
    });

    const page = await server.inject({ method: 'GET', url: '/ask' });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('승인된 Canonical Claim만 검색');

    const evidenceId = answer.statements[0].citations[0].evidenceId;
    const evidence = await server.inject({ method: 'GET', url: `/evidence/${evidenceId}` });
    expect(evidence.statusCode).toBe(200);
    expect(evidence.body).toContain('Milo weighs 5 kg.');
    await server.close();
  });
});
