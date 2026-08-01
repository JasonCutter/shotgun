import { describe, expect, it } from 'vitest';

import {
  decodeAskAnswerRunEventView,
  decodeAskAnswerRunRetryRequest,
  decodeAskAnswerRunSnapshot,
} from '../../packages/contracts/src/index.js';

const event = {
  schemaVersion: '1.0.0',
  eventId: 'event-1',
  answerRunId: 'run-1',
  projectId: 'project-1',
  ordinal: 0,
  kind: 'STATE',
  state: 'RUNNING',
  answerRevision: 'answer-1',
  createdAt: '2026-08-01T00:00:00.000Z',
};

describe('Ask Answer Execution contracts', () => {
  it('rejects unknown event fields and browser authority fields', () => {
    expect(() =>
      decodeAskAnswerRunEventView({ ...event, projectIdFromBrowser: 'project-2' }),
    ).toThrow();
    expect(() =>
      decodeAskAnswerRunRetryRequest({
        schemaVersion: '1.0.0',
        clientRequestId: 'request-1',
        idempotencyKey: 'idempotency-1',
        mode: 'SAME_CONTEXT',
        projectId: 'project-2',
      }),
    ).toThrow();
  });

  it('decodes explicit failure, provider, usage, and event metadata', () => {
    const snapshot = decodeAskAnswerRunSnapshot({
      schemaVersion: '1.0.0',
      answerRunId: 'run-1',
      conversationId: 'conversation-1',
      branchId: 'branch-1',
      turnId: 'turn-1',
      projectId: 'project-1',
      mode: 'CANONICAL_ONLY',
      state: 'FAILED',
      question: 'Question',
      statements: [],
      sourceSelections: [],
      capabilities: ['RETRY_SAME_CONTEXT', 'RETRY_CURRENT_POLICY'],
      answerRevision: 'answer-1',
      conversationRevision: 'conversation-1',
      accessRevision: 'access-1',
      policyContextRevision: 'policy-1',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:01.000Z',
      stale: false,
      attemptNumber: 2,
      eventRevision: 8,
      failure: {
        code: 'RATE_LIMITED',
        message: 'Try again later.',
        retryable: true,
        outcomeUnknown: false,
      },
      provider: { provider: 'test', model: 'model-1' },
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costMicros: 2 },
    });

    expect(snapshot.attemptNumber).toBe(2);
    expect(snapshot.failure?.retryable).toBe(true);
    expect(snapshot.usage?.costMicros).toBe(2);
  });
});
