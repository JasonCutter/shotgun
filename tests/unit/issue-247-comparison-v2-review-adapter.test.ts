import { describe, expect, it } from 'vitest';

import {
  ComparisonV2ReviewTargetAdapter,
  InMemoryFrontendReviewStore,
  type ComparisonV2ReviewSourceReader,
} from '../../adapters/frontend-review-in-memory/src/index.js';
import { InMemoryFrontendCommandGateway } from '../../adapters/frontend-command-gateway-in-memory/src/index.js';
import { FrontendReviewProductCoordinator } from '../../modules/frontend-review/src/index.js';
import { createAdr163ReviewFixture } from '../helpers/adr163-review-fixture.js';
import type { DraftChangeSetV2 } from '../../packages/contracts/src/index.js';

const scope = {
  principalId: 'owner-1',
  sessionId: 'session-1',
  activeProjectId: 'shotgun',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  sensitivityClearance: 'private' as const,
  accessScope: ['owner'],
};

const readerFor = (draft: DraftChangeSetV2): ComparisonV2ReviewSourceReader => ({
  async listDrafts(projectId) {
    return projectId === draft.projectId ? [draft] : [];
  },
  async findDraft(projectId, changeSetId) {
    return projectId === draft.projectId && changeSetId === draft.changeSetId ? draft : undefined;
  },
});

describe('Issue #247 Comparison V2 Review presentation', () => {
  it('projects an authoritative pending V2 draft without a frontend draft shadow', async () => {
    const fixture = createAdr163ReviewFixture({
      suffix: 'issue-247-pending',
      claimText: 'A new claim for Review V2.',
    });
    const draft: DraftChangeSetV2 = {
      ...fixture.draft,
      operation: 'ADD_CLAIM',
      reviewRecommendation: 'ADD_CLAIM',
    };
    const adapter = new ComparisonV2ReviewTargetAdapter(readerFor(draft));
    const [source] = await adapter.listSourceTargets('shotgun', scope);
    expect(source?.targetId).toBe(fixture.draft.changeSetId);
    expect(source?.source).toBe('COMPARISON_V2_CHANGE_SET');

    const materialized = await adapter.materializeContext({
      scope,
      source: source!,
      reviewContextId: `review:${fixture.draft.changeSetId}`,
      contextRevision: 1,
      generatedAt: '2026-09-09T00:00:00.000Z',
    });
    expect(materialized.context.targetKind).toBe('COMPARISON_V2_CHANGE_SET');
    expect(materialized.context.targetDigest).toBe(fixture.draft.contentDigest);
    expect(materialized.context.canonicalBase?.digest).toBe(fixture.draft.canonicalSnapshot.digest);
    expect(materialized.context.items[0]?.sourceItemKind).toBe('COMPARISON_V2_CHANGE_SET');
    expect(materialized.context.items[0]?.allowedDecisions).toEqual(['APPROVE', 'REJECT', 'HOLD']);
  });

  it('fails closed for raw MODIFY_REVIEW approval and exposes operation resolution kind', async () => {
    const fixture = createAdr163ReviewFixture({
      suffix: 'issue-247-modify',
      claimText: 'A claim requiring an operation decision.',
    });
    const draft: DraftChangeSetV2 = {
      ...fixture.draft,
      operation: 'MODIFY_REVIEW',
      reviewRecommendation: 'MODIFY_REVIEW',
    };
    const adapter = new ComparisonV2ReviewTargetAdapter(readerFor(draft));
    const [source] = await adapter.listSourceTargets('shotgun', scope);
    const materialized = await adapter.materializeContext({
      scope,
      source: source!,
      reviewContextId: `review:${draft.changeSetId}`,
      contextRevision: 1,
      generatedAt: '2026-09-09T00:00:00.000Z',
    });
    const item = materialized.context.items[0]!;
    expect(item.sourceItemKind).toBe('COMPARISON_V2_OPERATION_RESOLUTION');
    expect(item.allowedDecisions).not.toContain('APPROVE');
  });

  it('rejects V2 decisions before the generic V1 approval path can append anything', async () => {
    const fixture = createAdr163ReviewFixture({
      suffix: 'issue-247-generic-rejection',
      claimText: 'A claim that must use the authoritative V2 route.',
    });
    const draft: DraftChangeSetV2 = {
      ...fixture.draft,
      operation: 'ADD_CLAIM',
      reviewRecommendation: 'ADD_CLAIM',
    };
    const adapter = new ComparisonV2ReviewTargetAdapter(readerFor(draft));
    const coordinator = new FrontendReviewProductCoordinator(
      new InMemoryFrontendReviewStore(),
      new InMemoryFrontendCommandGateway(),
      [adapter],
    );
    const queue = await coordinator.listReviewQueue(scope, {
      schemaVersion: '1.0.0',
      pageSize: 10,
    });
    const queueItem = queue.items[0];
    expect(queueItem?.targetKind).toBe('COMPARISON_V2_CHANGE_SET');
    const context = await coordinator.getReviewContext(scope, {
      schemaVersion: '1.0.0',
      reviewContextId: queueItem!.reviewContextId,
      contextRevision: queueItem!.contextRevision,
    });
    const item = context.context.items[0]!;

    await expect(
      coordinator.recordReviewDecisions(scope, {
        schemaVersion: '1.0.0',
        clientRequestId: 'issue-247-generic-v1-attempt',
        idempotencyKey: 'issue-247-generic-v1-attempt',
        reviewContextId: context.context.reviewContextId,
        expectedContextRevision: context.context.contextRevision,
        expectedTargetRevision: context.context.targetRevision,
        expectedTargetDigest: context.context.targetDigest,
        itemDecisions: [
          {
            schemaVersion: '1.0.0',
            reviewItemId: item.reviewItemId,
            intent: 'APPROVE',
            reason: 'Must be rejected by the generic V1 endpoint.',
          },
        ],
      }),
    ).rejects.toMatchObject({ apiCode: 'REVIEW_DECISION_NOT_ALLOWED' });
  });

  it('keeps an authoritative V2 HOLD visible and actionable without a FE decision shadow', async () => {
    const fixture = createAdr163ReviewFixture({
      suffix: 'issue-247-hold',
      claimText: 'A V2 draft explicitly placed on hold.',
    });
    let draft: DraftChangeSetV2 = {
      ...fixture.draft,
      operation: 'ADD_CLAIM',
      reviewRecommendation: 'ADD_CLAIM',
      status: 'ON_HOLD',
    };
    const reader: ComparisonV2ReviewSourceReader = {
      async listDrafts(projectId) {
        return projectId === draft.projectId ? [draft] : [];
      },
      async findDraft(projectId, changeSetId) {
        return projectId === draft.projectId && changeSetId === draft.changeSetId
          ? draft
          : undefined;
      },
    };
    const coordinator = new FrontendReviewProductCoordinator(
      new InMemoryFrontendReviewStore(),
      new InMemoryFrontendCommandGateway(),
      [new ComparisonV2ReviewTargetAdapter(reader)],
    );
    const queue = await coordinator.listReviewQueue(scope, {
      schemaVersion: '1.0.0',
      pageSize: 10,
      attentionReasons: ['REQUIRES_ACTION'],
    });
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]?.aggregateState).toBe('ON_HOLD');

    const context = await coordinator.getReviewContext(scope, {
      schemaVersion: '1.0.0',
      reviewContextId: queue.items[0]!.reviewContextId,
      contextRevision: queue.items[0]!.contextRevision,
    });
    expect(context.context.aggregateState).toBe('ON_HOLD');
    expect(context.decisions).toEqual([]);

    draft = { ...draft, status: 'APPROVED' };
    const approvedQueue = await coordinator.listReviewQueue(scope, {
      schemaVersion: '1.0.0',
      pageSize: 10,
      attentionReasons: ['REQUIRES_ACTION'],
    });
    expect(approvedQueue.items).toEqual([]);
  });
});
