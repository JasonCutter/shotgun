import { describe, expect, it } from 'vitest';

import type { ActionFeedback, EventEnvelope } from '../../packages/contracts/src/index.js';
import {
  createActionFeedbackReviewModule,
  InMemoryActionFeedbackReviewRepository,
} from '../../modules/action-feedback-review/src/index.js';

const event = (
  overrides: Partial<EventEnvelope<ActionFeedback>> = {},
): EventEnvelope<ActionFeedback> => ({
  messageId: 'message-1',
  messageType: 'ActionFeedbackRecorded',
  messageKind: 'event',
  schemaVersion: '1.0.0',
  producerModule: 'stage11.action-execution',
  producerVersion: '1.1.0',
  correlationId: 'correlation-1',
  traceId: 'trace-1',
  projectId: 'project-a',
  actor: { type: 'service', id: 'action-runtime' },
  security: { accessScope: ['owner'], sensitivity: 'internal', dataClassification: 'ACTION' },
  idempotencyKey: 'action-feedback:action-1:FAILED',
  payload: {
    actionId: 'action-1',
    status: 'FAILED',
    reentryPhase: 'ACTION_REVIEW',
    occurredAt: '2026-09-04T00:00:00.000Z',
  },
  createdAt: '2026-09-04T00:00:00.000Z',
  ...overrides,
});

describe('WP-10 ActionFeedbackRecorded consumer contract', () => {
  it('materializes one pending item across duplicate delivery and module recreation', async () => {
    const repository = new InMemoryActionFeedbackReviewRepository();
    const first = createActionFeedbackReviewModule(repository);
    await first.handlers.events[0]!.handle(event(), {} as never);
    const recreated = createActionFeedbackReviewModule(repository);
    await recreated.handlers.events[0]!.handle(event({ messageId: 'message-2' }), {} as never);

    const rows = await repository.listByAction({
      projectId: 'project-a',
      actionId: 'action-1',
      limit: 100,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      projectId: 'project-a',
      semanticKey: 'action-feedback:action-1:FAILED',
      actionId: 'action-1',
      outcome: 'FAILED',
      phase: 'ACTION_REVIEW',
      status: 'PENDING',
    });
  });

  it('keeps different feedback identities distinct and rejects forged identity', async () => {
    const repository = new InMemoryActionFeedbackReviewRepository();
    const module = createActionFeedbackReviewModule(repository);
    await module.handlers.events[0]!.handle(event(), {} as never);
    await module.handlers.events[0]!.handle(
      event({
        messageId: 'message-2',
        idempotencyKey: 'action-feedback:action-1:VERIFIED',
        payload: { ...event().payload, status: 'VERIFIED' },
      }),
      {} as never,
    );
    await expect(
      module.handlers.events[0]!.handle(
        event({ idempotencyKey: 'action-feedback:other:FAILED' }),
        {} as never,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(
      await repository.listByAction({ projectId: 'project-a', actionId: 'action-1', limit: 100 }),
    ).toHaveLength(2);
  });
});
