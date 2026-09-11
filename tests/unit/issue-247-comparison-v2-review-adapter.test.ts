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
import type { ComparisonV2DecisionHistoryRecord } from '../../modules/change-set-review/src/index.js';

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

  it('projects authoritative V2 decision history without appending a frontend shadow', async () => {
    const fixture = createAdr163ReviewFixture({
      suffix: 'issue-251-history',
      claimText: 'A V2 decision whose history must remain authoritative.',
    });
    const persisted: ComparisonV2DecisionHistoryRecord = {
      projectId: fixture.draft.projectId,
      changeSetId: fixture.draft.changeSetId,
      expectedRevisionNumber: fixture.draft.revisionNumber,
      expectedContentDigest: fixture.draft.contentDigest,
      decision: {
        decisionId: 'issue-251-v2-decision',
        decision: 'REJECT',
        actor: { type: 'user', id: 'owner-1' },
        reason: 'Authoritative V2 rejection reason.',
        decidedAt: '2026-09-10T00:00:00.000Z',
      },
    };
    const reader: ComparisonV2ReviewSourceReader = {
      ...readerFor(fixture.draft),
      async listDecisions(projectId, changeSetId) {
        return projectId === fixture.draft.projectId && changeSetId === fixture.draft.changeSetId
          ? [persisted]
          : [];
      },
    };
    const store = new InMemoryFrontendReviewStore();
    const coordinator = new FrontendReviewProductCoordinator(
      store,
      new InMemoryFrontendCommandGateway(),
      [new ComparisonV2ReviewTargetAdapter(reader)],
    );
    const queue = await coordinator.listReviewQueue(scope, {
      schemaVersion: '1.0.0',
      pageSize: 10,
    });
    const context = await coordinator.getReviewContext(scope, {
      schemaVersion: '1.0.0',
      reviewContextId: queue.items[0]!.reviewContextId,
      contextRevision: queue.items[0]!.contextRevision,
    });

    expect(store.decisions).toHaveLength(0);
    expect(context.decisions).toEqual([
      expect.objectContaining({
        decisionId: 'issue-251-v2-decision',
        intent: 'REJECT',
        reason: 'Authoritative V2 rejection reason.',
        reviewItemId: `comparison-v2:${fixture.draft.changeSetId}`,
      }),
    ]);
    const itemDetail = await coordinator.getReviewItemDetail(scope, {
      schemaVersion: '1.0.0',
      reviewContextId: context.context.reviewContextId,
      contextRevision: context.context.contextRevision,
      reviewItemId: `comparison-v2:${fixture.draft.changeSetId}`,
    });
    expect(itemDetail.decisions).toEqual(context.decisions);
  });

  it('does not project a V2 decision from a different Draft revision', async () => {
    const fixture = createAdr163ReviewFixture({
      suffix: 'issue-251-history-revision-mismatch',
      claimText: 'A V2 decision bound to an older Draft revision.',
    });
    const reader: ComparisonV2ReviewSourceReader = {
      ...readerFor(fixture.draft),
      async listDecisions(projectId, changeSetId) {
        return projectId === fixture.draft.projectId && changeSetId === fixture.draft.changeSetId
          ? [
              {
                projectId,
                changeSetId,
                expectedRevisionNumber: fixture.draft.revisionNumber + 1,
                expectedContentDigest: 'sha256:next-revision',
                decision: {
                  decisionId: 'issue-251-old-revision-decision',
                  decision: 'REJECT',
                  actor: { type: 'user', id: 'owner-1' },
                  reason: 'This decision belongs to another Draft revision.',
                  decidedAt: '2026-09-10T00:00:00.000Z',
                },
              },
            ]
          : [];
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
    });
    const context = await coordinator.getReviewContext(scope, {
      schemaVersion: '1.0.0',
      reviewContextId: queue.items[0]!.reviewContextId,
      contextRevision: queue.items[0]!.contextRevision,
    });

    expect(context.decisions).toEqual([]);
  });

  it('fails closed when a V2 context contains an unexpected frontend decision shadow', async () => {
    const fixture = createAdr163ReviewFixture({
      suffix: 'issue-251-history-authority-conflict',
      claimText: 'A V2 context with an unexpected frontend shadow decision.',
    });
    const persisted: ComparisonV2DecisionHistoryRecord = {
      projectId: fixture.draft.projectId,
      changeSetId: fixture.draft.changeSetId,
      expectedRevisionNumber: fixture.draft.revisionNumber,
      expectedContentDigest: fixture.draft.contentDigest,
      decision: {
        decisionId: 'issue-251-authoritative-decision',
        decision: 'REJECT',
        actor: { type: 'user', id: 'owner-1' },
        reason: 'The owning domain is authoritative.',
        decidedAt: '2026-09-10T00:00:00.000Z',
      },
    };
    const reader: ComparisonV2ReviewSourceReader = {
      ...readerFor(fixture.draft),
      async listDecisions() {
        return [persisted];
      },
    };
    const store = new InMemoryFrontendReviewStore();
    const coordinator = new FrontendReviewProductCoordinator(
      store,
      new InMemoryFrontendCommandGateway(),
      [new ComparisonV2ReviewTargetAdapter(reader)],
    );
    const queue = await coordinator.listReviewQueue(scope, {
      schemaVersion: '1.0.0',
      pageSize: 10,
    });
    const context = await coordinator.getReviewContext(scope, {
      schemaVersion: '1.0.0',
      reviewContextId: queue.items[0]!.reviewContextId,
      contextRevision: queue.items[0]!.contextRevision,
    });
    store.decisions.push({
      schemaVersion: '1.0.0',
      decisionId: 'issue-251-frontend-shadow',
      reviewContextId: context.context.reviewContextId,
      contextRevision: context.context.contextRevision,
      reviewItemId: context.context.items[0]!.reviewItemId,
      intent: 'REJECT',
      reason: 'Unexpected frontend shadow.',
      decidedBy: { schemaVersion: '1.0.0', principalId: 'owner-1', actorId: 'owner-1' },
      decidedAt: '2026-09-10T00:00:01.000Z',
      terminal: true,
    });

    await expect(
      coordinator.getReviewContext(scope, {
        schemaVersion: '1.0.0',
        reviewContextId: context.context.reviewContextId,
        contextRevision: context.context.contextRevision,
      }),
    ).rejects.toMatchObject({ apiCode: 'CONFLICT' });
  });

  it('does not fall back to a frontend shadow when the V2 source is unavailable', async () => {
    const fixture = createAdr163ReviewFixture({
      suffix: 'issue-251-history-source-unavailable',
      claimText: 'A V2 context whose owning source becomes unavailable.',
    });
    let sourceAvailable = true;
    const reader: ComparisonV2ReviewSourceReader = {
      ...readerFor(fixture.draft),
      async findDraft(projectId, changeSetId) {
        return sourceAvailable
          ? projectId === fixture.draft.projectId && changeSetId === fixture.draft.changeSetId
            ? fixture.draft
            : undefined
          : undefined;
      },
      async listDecisions() {
        return [];
      },
    };
    const store = new InMemoryFrontendReviewStore();
    const coordinator = new FrontendReviewProductCoordinator(
      store,
      new InMemoryFrontendCommandGateway(),
      [new ComparisonV2ReviewTargetAdapter(reader)],
    );
    const queue = await coordinator.listReviewQueue(scope, {
      schemaVersion: '1.0.0',
      pageSize: 10,
    });
    const context = await coordinator.getReviewContext(scope, {
      schemaVersion: '1.0.0',
      reviewContextId: queue.items[0]!.reviewContextId,
      contextRevision: queue.items[0]!.contextRevision,
    });
    store.decisions.push({
      schemaVersion: '1.0.0',
      decisionId: 'issue-251-source-unavailable-shadow',
      reviewContextId: context.context.reviewContextId,
      contextRevision: context.context.contextRevision,
      reviewItemId: context.context.items[0]!.reviewItemId,
      intent: 'REJECT',
      reason: 'Must never be used as V2 fallback history.',
      decidedBy: { schemaVersion: '1.0.0', principalId: 'owner-1', actorId: 'owner-1' },
      decidedAt: '2026-09-10T00:00:01.000Z',
      terminal: true,
    });
    sourceAvailable = false;

    await expect(
      coordinator.getReviewContext(scope, {
        schemaVersion: '1.0.0',
        reviewContextId: context.context.reviewContextId,
        contextRevision: context.context.contextRevision,
      }),
    ).rejects.toMatchObject({ apiCode: 'CONFLICT' });
  });
});
