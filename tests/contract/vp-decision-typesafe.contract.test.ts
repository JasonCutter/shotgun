import { describe, expect, it, vi } from 'vitest';

import { TypeSafeJevVPDecisionAdapter } from '../../adapters/vp-decision-typesafe/src/index.js';
import type { VPRelationDecisionRequest } from '../../modules/vp-decision/src/index.js';

const request: VPRelationDecisionRequest = {
  projectId: 'project-a',
  left: {
    assertionId: 'left',
    sourceVersionId: 'version-a',
    evidenceId: 'evidence-a',
    text: 'Output rose by 5% in 2024.',
    evidenceContext: 'Baseline is the prior year for the same output measure.',
    accessScope: ['owner'],
    sensitivity: 'internal',
  },
  right: {
    assertionId: 'right',
    sourceVersionId: 'version-b',
    evidenceId: 'evidence-b',
    text: 'In 2024 output increased by five percent.',
    accessScope: ['owner'],
    sensitivity: 'internal',
  },
  allowedAccessScope: ['owner'],
  authorizedSensitivities: ['public', 'internal'],
  externalEgressAllowed: true,
  policyRevision: 'vp-semantic-policy-1',
};

const response = () =>
  new Response(
    JSON.stringify({
      model: 'jev-1.13.0',
      answers: {
        relation: {
          type: 'choice',
          choice: 'EQUIVALENT',
          direction: 'NONE',
          confidence: 0.93,
          probabilities: {
            EQUIVALENT: 0.93,
            SUPPORTS: 0,
            QUALIFIES: 0.02,
            CONTRADICTS: 0.01,
            RELATED: 0.03,
            UNRESOLVED: 0.01,
          },
        },
        direction: { type: 'choice', choice: 'NONE' },
        needs_deep_analysis: { type: 'noul', noul: 0.1 },
      },
      usage: { input_tokens: 90, output_tokens: 18 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

describe('TypeSafe Jev VP DecisionProvider contract', () => {
  it('sends a bounded two assertion question and decodes a pinned model result', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response());
    const adapter = new TypeSafeJevVPDecisionAdapter({
      apiKey: 'test-only-key',
      model: 'jev-1.13.0',
      fetcher: fetcher as typeof fetch,
    });
    expect(await adapter.decideRelation(request)).toMatchObject({
      choice: 'EQUIVALENT',
      direction: 'NONE',
      deepAnalysisScore: 0.1,
      inputTokens: 90,
      outputTokens: 18,
    });
    expect(fetcher).toHaveBeenCalledOnce();
    const sent = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(sent.model).toBe('jev-1.13.0');
    expect(sent.state).toEqual({
      left: {
        claim: request.left.text,
        evidence_context: request.left.evidenceContext,
        evidence_context_truncated: false,
      },
      right: {
        claim: request.right.text,
        evidence_context: null,
        evidence_context_truncated: false,
      },
    });
    expect(Object.keys(sent.questions.relation.criteria)).toEqual([
      'EQUIVALENT',
      'SUPPORTS',
      'QUALIFIES',
      'CONTRADICTS',
      'RELATED',
      'UNRESOLVED',
    ]);
    expect(JSON.stringify(sent)).not.toContain('project-a');
  });

  it('preserves the orientation when an example supports a general assertion', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            model: 'jev-1.13.0',
            answers: {
              relation: {
                type: 'choice',
                choice: 'SUPPORTS',
                confidence: 0.94,
                probabilities: {
                  EQUIVALENT: 0.01,
                  SUPPORTS: 0.94,
                  QUALIFIES: 0.01,
                  CONTRADICTS: 0.01,
                  RELATED: 0.02,
                  UNRESOLVED: 0.01,
                },
              },
              direction: { type: 'choice', choice: 'RIGHT_TO_LEFT' },
              needs_deep_analysis: { type: 'noul', noul: 0.2 },
            },
            usage: { input_tokens: 90, output_tokens: 18 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    const adapter = new TypeSafeJevVPDecisionAdapter({
      apiKey: 'test-only-key',
      model: 'jev-1.13.0',
      fetcher: fetcher as typeof fetch,
    });
    expect(await adapter.decideRelation(request)).toMatchObject({
      choice: 'SUPPORTS',
      direction: 'RIGHT_TO_LEFT',
    });
  });

  it('denies unauthorized or restricted Evidence before any provider request', async () => {
    const fetcher = vi.fn(async () => response());
    const adapter = new TypeSafeJevVPDecisionAdapter({
      apiKey: 'test-only-key',
      model: 'jev-1.13.0',
      fetcher: fetcher as typeof fetch,
    });
    await expect(
      adapter.decideRelation({ ...request, externalEgressAllowed: false }),
    ).rejects.toThrow(/not allowed/);
    await expect(
      adapter.decideRelation({
        ...request,
        right: { ...request.right, sensitivity: 'restricted' },
      }),
    ).rejects.toThrow(/authorized evidence scope/);
    await expect(adapter.decideRelation({ ...request, allowedAccessScope: [] })).rejects.toThrow(
      /authorized evidence scope/,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects malformed distributions and unpinned model aliases', async () => {
    expect(
      () => new TypeSafeJevVPDecisionAdapter({ apiKey: 'test-only-key', model: 'jev-latest' }),
    ).toThrow(/pinned model/);
    const fetcher = vi.fn(async () => {
      const payload = await response().json();
      payload.answers.relation.probabilities.EQUIVALENT = 2;
      return new Response(JSON.stringify(payload), { status: 200 });
    });
    const adapter = new TypeSafeJevVPDecisionAdapter({
      apiKey: 'test-only-key',
      model: 'jev-1.13.0',
      fetcher: fetcher as typeof fetch,
    });
    await expect(adapter.decideRelation(request)).rejects.toThrow(/distribution/);
  });
});
