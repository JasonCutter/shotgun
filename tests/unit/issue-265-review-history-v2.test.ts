import { describe, expect, it } from 'vitest';

import {
  ReviewHistoryAdapter,
  type ReviewV2HistoryReader,
} from '../../adapters/frontend-history-review/src/index.js';
import { InMemoryPayloadStateStore } from '../../adapters/frontend-history-in-memory/src/index.js';
import { InMemoryFrontendReviewStore } from '../../adapters/frontend-review-in-memory/src/index.js';
import { createAdr163ReviewFixture } from '../helpers/adr163-review-fixture.js';
import type { ReviewContextRecordV1 } from '../../modules/frontend-review/src/index.js';
import type { ReviewDecisionRecordV1 } from '../../packages/contracts/src/index.js';
import type {
  ComparisonV2DecisionHistoryRecord,
  ComparisonV2PersistedDecision,
} from '../../modules/change-set-review/src/index.js';

const legacyContext = (projectId: string): ReviewContextRecordV1 => ({
  reviewResourceId: 'legacy-context',
  sourceRevision: '1',
  sourceDigest: 'sha256:legacy',
  sourceUpdatedAt: '2026-09-10T00:00:00.000Z',
  materializedAt: '2026-09-10T00:00:00.000Z',
  context: {
    schemaVersion: '1.0.0',
    reviewContextId: 'legacy-context',
    contextRevision: 1,
    reviewResourceId: 'legacy-context',
    targetKind: 'KNOWLEDGE_DRAFT_CHANGE_SET',
    targetId: 'legacy-target',
    targetRevision: '1',
    targetDigest: 'sha256:legacy-target',
    resourceProjectId: projectId,
    effectiveProjectId: projectId,
    accessRevision: 'access:legacy',
    policyContextRevision: 'policy:legacy',
    artifactRefs: { schemaVersion: '1.0.0' },
    items: [],
    dependencies: [],
    aggregateState: 'PENDING',
    capabilities: [],
    generatedAt: '2026-09-10T00:00:00.000Z',
  },
});

const legacyDecision: ReviewDecisionRecordV1 = {
  schemaVersion: '1.0.0',
  decisionId: 'legacy-decision',
  reviewContextId: 'legacy-context',
  contextRevision: 1,
  reviewItemId: 'legacy-item',
  intent: 'REJECT',
  reason: 'Legacy decision remains visible.',
  decidedBy: {
    schemaVersion: '1.0.0',
    principalId: 'owner-1',
    actorId: 'owner-1',
  },
  decidedAt: '2026-09-10T00:01:00.000Z',
  terminal: true,
};

const makeAuthority = (input: {
  readonly projectId: string;
  readonly draft: ReturnType<typeof createAdr163ReviewFixture>['draft'];
  readonly record: ComparisonV2DecisionHistoryRecord;
  readonly detailRecord?: ComparisonV2PersistedDecision;
}): ReviewV2HistoryReader => ({
  async listDrafts(projectId) {
    return projectId === input.projectId ? [input.draft] : [];
  },
  async listDecisions(projectId, changeSetId) {
    return projectId === input.projectId && changeSetId === input.draft.changeSetId
      ? [input.record]
      : [];
  },
  async findDecisionById(projectId, decisionId) {
    if (projectId !== input.projectId || decisionId !== input.record.decision.decisionId) {
      return undefined;
    }
    return (
      input.detailRecord ?? {
        projectId: input.record.projectId,
        changeSetId: input.record.changeSetId,
        expectedRevisionNumber: input.record.expectedRevisionNumber,
        expectedContentDigest: input.record.expectedContentDigest,
        draft: input.draft,
        decision: input.record.decision,
      }
    );
  },
});

describe('Issue #265 authoritative V2 Review History projection', () => {
  it('projects an authoritative V2 REJECT exactly once without a frontend shadow', async () => {
    const fixture = createAdr163ReviewFixture({
      suffix: 'issue-265-v2-reject',
      claimText: 'An authoritative V2 decision for federated History.',
    });
    const record: ComparisonV2DecisionHistoryRecord = {
      projectId: fixture.draft.projectId,
      changeSetId: fixture.draft.changeSetId,
      expectedRevisionNumber: fixture.draft.revisionNumber,
      expectedContentDigest: fixture.draft.contentDigest,
      decision: {
        decisionId: 'issue-265-v2-reject',
        decision: 'REJECT',
        actor: { type: 'user', id: 'owner-1' },
        reason: 'The owner rejected the authoritative comparison.',
        decidedAt: '2026-09-10T00:02:00.000Z',
      },
    };
    const review = new InMemoryFrontendReviewStore();
    review.contextsByResource.set('legacy-context', legacyContext(fixture.draft.projectId));
    review.decisions.push(legacyDecision);
    const persisted: ComparisonV2PersistedDecision = {
      projectId: record.projectId,
      changeSetId: record.changeSetId,
      expectedRevisionNumber: record.expectedRevisionNumber,
      expectedContentDigest: record.expectedContentDigest,
      draft: fixture.draft,
      decision: record.decision,
    };
    const adapter = new ReviewHistoryAdapter(
      review,
      new InMemoryPayloadStateStore('REVIEW'),
      () => new Date('2026-09-10T00:03:00.000Z'),
      makeAuthority({
        projectId: fixture.draft.projectId,
        draft: fixture.draft,
        record,
        detailRecord: persisted,
      }),
    );

    const entries = await adapter.readHistory(fixture.draft.projectId);
    const v2 = entries.filter((entry) => entry.sourceEventId === record.decision.decisionId);
    expect(v2).toHaveLength(1);
    expect(v2[0]).toMatchObject({
      domainKind: 'REVIEW',
      sourceEventKind: 'DECISION',
      sourceEventId: record.decision.decisionId,
      occurredAt: record.decision.decidedAt,
      domainResourceId: fixture.draft.changeSetId,
    });
    expect(v2[0]!.historyEntryId).toBe(
      `history:${fixture.draft.projectId}:v2-decision:${record.decision.decisionId}`,
    );
    expect(v2[0]!.payloadSnapshot).toMatchObject({
      changeSetId: fixture.draft.changeSetId,
      expectedRevisionNumber: fixture.draft.revisionNumber,
      expectedContentDigest: fixture.draft.contentDigest,
      intent: 'REJECT',
      actor: { type: 'user', id: 'owner-1' },
      reason: record.decision.reason,
      owningV2Target: {
        comparisonId: fixture.draft.comparisonId,
        candidateId: fixture.draft.candidate.id,
      },
    });
    expect(entries.some((entry) => entry.sourceEventId === legacyDecision.decisionId)).toBe(true);
    expect(review.decisions).toEqual([legacyDecision]);
    expect(persisted.manifest).toBeUndefined();
  });

  it('re-resolves V2 detail and fails closed for wrong project or binding', async () => {
    const fixture = createAdr163ReviewFixture({
      suffix: 'issue-265-detail',
      claimText: 'A V2 detail that must be re-resolved authoritatively.',
    });
    const record: ComparisonV2DecisionHistoryRecord = {
      projectId: fixture.draft.projectId,
      changeSetId: fixture.draft.changeSetId,
      expectedRevisionNumber: fixture.draft.revisionNumber,
      expectedContentDigest: fixture.draft.contentDigest,
      decision: {
        decisionId: 'issue-265-v2-detail',
        decision: 'REJECT',
        actor: { type: 'user', id: 'owner-1' },
        reason: 'Detail must come from the owner authority.',
        decidedAt: '2026-09-10T00:04:00.000Z',
      },
    };
    const payloadState = new InMemoryPayloadStateStore('REVIEW');
    const adapter = new ReviewHistoryAdapter(
      new InMemoryFrontendReviewStore(),
      payloadState,
      () => new Date('2026-09-10T00:05:00.000Z'),
      makeAuthority({ projectId: fixture.draft.projectId, draft: fixture.draft, record }),
    );
    const resolved = await adapter.resolveHistoryEntry(
      fixture.draft.projectId,
      'DECISION',
      record.decision.decisionId,
    );
    expect(resolved?.sourceEventId).toBe(record.decision.decisionId);
    expect(resolved?.payloadSnapshot).toMatchObject({ reason: record.decision.reason });
    await expect(
      adapter.resolveHistoryEntry('another-project', 'DECISION', record.decision.decisionId),
    ).resolves.toBeUndefined();

    const mismatched = {
      ...record,
      expectedRevisionNumber: record.expectedRevisionNumber + 1,
    };
    const mismatchAdapter = new ReviewHistoryAdapter(
      new InMemoryFrontendReviewStore(),
      new InMemoryPayloadStateStore('REVIEW'),
      undefined,
      makeAuthority({
        projectId: fixture.draft.projectId,
        draft: fixture.draft,
        record: mismatched,
      }),
    );
    await expect(
      mismatchAdapter.resolveHistoryEntry(
        fixture.draft.projectId,
        'DECISION',
        mismatched.decision.decisionId,
      ),
    ).resolves.toBeUndefined();
  });
});
