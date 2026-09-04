import { randomUUID } from 'node:crypto';

import type { ActionFeedback, EventEnvelope } from '../../../packages/contracts/src/index.js';
import { ShotgunError } from '../../../packages/contracts/src/index.js';
import type { ShotgunModule } from '../../../packages/module-sdk/src/index.js';

export type ActionReviewWorkItem = {
  readonly workItemId: string;
  readonly projectId: string;
  readonly semanticKey: string;
  readonly actionId: string;
  readonly outcome: ActionFeedback['status'];
  readonly phase: 'ACTION_REVIEW';
  readonly status: 'PENDING';
  readonly evidenceRef: string;
  readonly feedbackOccurredAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type ActionFeedbackReviewRepositoryPort = {
  upsertFromFeedback(input: {
    readonly projectId: string;
    readonly semanticKey: string;
    readonly actionId: string;
    readonly outcome: ActionFeedback['status'];
    readonly phase: 'ACTION_REVIEW';
    readonly evidenceRef: string;
    readonly feedbackOccurredAt: string;
    readonly now: string;
  }): Promise<ActionReviewWorkItem>;
  listByAction(input: {
    readonly projectId: string;
    readonly actionId: string;
    readonly limit: number;
  }): Promise<readonly ActionReviewWorkItem[]>;
};

const actionFeedbackSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['actionId', 'status', 'reentryPhase', 'occurredAt'],
  properties: {
    actionId: { type: 'string', minLength: 1 },
    status: { enum: ['VERIFIED', 'OUTCOME_UNKNOWN', 'FAILED'] },
    reentryPhase: { const: 'ACTION_REVIEW' },
    occurredAt: { type: 'string', minLength: 1 },
  },
} as const;

const listSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['actionId'],
  properties: { actionId: { type: 'string', minLength: 1 } },
} as const;

const assertFeedback = (envelope: EventEnvelope<ActionFeedback>): ActionFeedback => {
  const feedback = envelope.payload;
  if (
    feedback === null ||
    typeof feedback !== 'object' ||
    typeof feedback.actionId !== 'string' ||
    feedback.actionId.trim().length === 0 ||
    !['VERIFIED', 'OUTCOME_UNKNOWN', 'FAILED'].includes(feedback.status) ||
    feedback.reentryPhase !== 'ACTION_REVIEW' ||
    typeof feedback.occurredAt !== 'string' ||
    Number.isNaN(Date.parse(feedback.occurredAt)) ||
    envelope.projectId === undefined ||
    envelope.projectId.trim().length === 0 ||
    envelope.idempotencyKey !== `action-feedback:${feedback.actionId}:${feedback.status}`
  ) {
    throw new ShotgunError({
      code: 'INVALID_REQUEST',
      safeMessage: 'Action feedback event is invalid.',
      module: 'stage11.action-feedback-review',
      operation: 'consume-action-feedback',
      correlationId: envelope.correlationId,
    });
  }
  return feedback;
};

export class InMemoryActionFeedbackReviewRepository implements ActionFeedbackReviewRepositoryPort {
  private readonly items = new Map<string, ActionReviewWorkItem>();

  async upsertFromFeedback(
    input: Parameters<ActionFeedbackReviewRepositoryPort['upsertFromFeedback']>[0],
  ): Promise<ActionReviewWorkItem> {
    const key = `${input.projectId}\u0000${input.semanticKey}`;
    const existing = this.items.get(key);
    if (existing !== undefined) return structuredClone(existing);
    const item: ActionReviewWorkItem = {
      workItemId: randomUUID(),
      projectId: input.projectId,
      semanticKey: input.semanticKey,
      actionId: input.actionId,
      outcome: input.outcome,
      phase: 'ACTION_REVIEW',
      status: 'PENDING',
      evidenceRef: input.evidenceRef,
      feedbackOccurredAt: input.feedbackOccurredAt,
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.items.set(key, item);
    return structuredClone(item);
  }

  async listByAction(input: {
    readonly projectId: string;
    readonly actionId: string;
    readonly limit: number;
  }): Promise<readonly ActionReviewWorkItem[]> {
    return [...this.items.values()]
      .filter((item) => item.projectId === input.projectId && item.actionId === input.actionId)
      .slice(0, Math.max(1, Math.min(100, input.limit)))
      .map((item) => structuredClone(item));
  }
}

const assertProject = (
  projectId: string | undefined,
  operation: string,
  correlationId: string,
): string => {
  if (projectId === undefined || projectId.trim().length === 0) {
    throw new ShotgunError({
      code: 'ACTION_AUTHORIZATION_DENIED',
      safeMessage: 'Action review requires a project-scoped event context.',
      module: 'stage11.action-feedback-review',
      operation,
      correlationId,
    });
  }
  return projectId;
};

export const createActionFeedbackReviewModule = (
  repository: ActionFeedbackReviewRepositoryPort = new InMemoryActionFeedbackReviewRepository(),
  clock: { now(): string } = { now: () => new Date().toISOString() },
): ShotgunModule => ({
  manifest: {
    id: 'stage11.action-feedback-review',
    version: '1.0.0',
    owner: 'Shotgun Governed Action Feedback Review',
    compatibility: {
      runtime: '>=1.0.0 <2.0.0',
      contracts: [
        { name: 'ActionFeedbackRecorded', range: '>=1.0.0 <2.0.0' },
        { name: 'ListActionReviewWorkItems', range: '>=1.0.0 <2.0.0' },
      ],
    },
    deployment: { modes: ['in_process', 'worker'] },
    dataOwnership: {
      owns: ['action.action_review_work_items'],
      readsViaPorts: ['action-feedback-review-repository'],
      directSchemaAccess: false,
    },
    consumes: {
      commands: [],
      events: [{ name: 'ActionFeedbackRecorded', range: '>=1.0.0 <2.0.0' }],
    },
    produces: { events: [], handoffs: [] },
    provides: {
      queries: [{ name: 'ListActionReviewWorkItems', range: '>=1.0.0 <2.0.0' }],
      capabilities: [{ name: 'governed-action-feedback-review', priority: 100 }],
    },
    requires: { capabilities: [] },
    security: {
      requiredContext: ['project', 'actor', 'access_scope', 'sensitivity'],
      defaultOnMissingContext: 'deny',
    },
    approvalPolicy: { canWriteCanonical: false, canExecuteExternalAction: false },
  },
  contracts: [
    {
      name: 'ActionFeedbackRecorded',
      version: '1.0.0',
      kind: 'event',
      inputSchema: actionFeedbackSchema,
    },
    {
      name: 'ListActionReviewWorkItems',
      version: '1.0.0',
      kind: 'query',
      inputSchema: listSchema,
    },
  ],
  handlers: {
    commands: [],
    events: [
      {
        messageType: 'ActionFeedbackRecorded',
        version: '1.0.0',
        requiredForPublisherAcknowledgement: true,
        async handle(envelope): Promise<void> {
          const feedback = assertFeedback(envelope as EventEnvelope<ActionFeedback>);
          const projectId = assertProject(
            envelope.projectId,
            'consume-action-feedback',
            envelope.correlationId,
          );
          await repository.upsertFromFeedback({
            projectId,
            semanticKey: envelope.idempotencyKey,
            actionId: feedback.actionId,
            outcome: feedback.status,
            phase: feedback.reentryPhase,
            evidenceRef: `action-audit:${feedback.actionId}:${feedback.status}`,
            feedbackOccurredAt: feedback.occurredAt,
            now: clock.now(),
          });
        },
      },
    ],
    queries: [
      {
        messageType: 'ListActionReviewWorkItems',
        version: '1.0.0',
        requiredAccessScopes: ['action:read'],
        async handle(envelope) {
          const projectId = assertProject(
            envelope.projectId,
            'list-action-review-work-items',
            envelope.correlationId,
          );
          const actionId = (envelope.payload as { actionId?: unknown }).actionId;
          if (typeof actionId !== 'string' || actionId.trim().length === 0) {
            throw new ShotgunError({
              code: 'INVALID_REQUEST',
              safeMessage: 'Action id is required.',
              module: 'stage11.action-feedback-review',
              operation: 'list-action-review-work-items',
              correlationId: envelope.correlationId,
            });
          }
          return repository.listByAction({ projectId, actionId, limit: 100 });
        },
      },
    ],
  },
});
