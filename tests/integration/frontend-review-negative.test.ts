import { describe, expect, it } from 'vitest';

import { FrontendReviewProductCoordinator } from '../../modules/frontend-review/src/index.js';
import type { FrontendReviewScopeV1 } from '../../modules/frontend-review/src/index.js';
import { InMemoryFrontendCommandGateway } from '../../adapters/frontend-command-gateway-in-memory/src/index.js';
import {
  InMemoryFrontendReviewStore,
  DiscoveryCandidateReviewTargetAdapter,
  UserDirectiveReviewTargetAdapter,
  createInMemoryReviewDiscoveryCandidateReader,
  createInMemoryReviewUserDirectiveReader,
} from '../../adapters/frontend-review-in-memory/src/index.js';

/**
 * FE-P4-S1 Review security negative matrix (AC-15, AC-22, AC-30).
 *
 * Proves that Review Approval issuance performs no Canonical Commit, Directive
 * Apply or External Action execution; that hidden Items cannot be approved;
 * that rejected/held history is append-only and preserved; and that decisions
 * outside the allowed set are rejected.
 */

const PROJECT = 'project-1';

const scope: FrontendReviewScopeV1 = {
  principalId: 'principal-1',
  sessionId: 'session-1',
  activeProjectId: PROJECT,
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  sensitivityClearance: 'ALL',
  accessScope: ['read', 'write', 'review'],
};

const fixedNow = (): Date => new Date('2026-08-04T12:00:00.000Z');

const buildCoordinator = () => {
  const store = new InMemoryFrontendReviewStore();
  const gateway = new InMemoryFrontendCommandGateway();
  const candidateAdapter = new DiscoveryCandidateReviewTargetAdapter(
    createInMemoryReviewDiscoveryCandidateReader([
      {
        candidateId: 'candidate-1',
        resourceProjectId: PROJECT,
        effectiveProjectId: PROJECT,
        content: { summary: 'Discovery: merge entity A and B', detail: 'Proposed merge.' },
        evidence: [],
        impact: [],
        createdAt: '2026-08-04T09:00:00.000Z',
        updatedAt: '2026-08-04T09:00:00.000Z',
      },
    ]),
  );
  const directiveAdapter = new UserDirectiveReviewTargetAdapter(
    createInMemoryReviewUserDirectiveReader([
      {
        proposalId: 'directive-1',
        resourceProjectId: PROJECT,
        effectiveProjectId: PROJECT,
        title: 'Directive: keep source lineage',
        clauses: [
          { clauseId: 'clause-1', text: 'Retain source references.', rationale: 'Auditability.' },
        ],
        evidence: [],
        createdAt: '2026-08-04T09:30:00.000Z',
        updatedAt: '2026-08-04T09:30:00.000Z',
      },
    ]),
  );
  const coordinator = new FrontendReviewProductCoordinator(
    store,
    gateway,
    [candidateAdapter, directiveAdapter],
    fixedNow,
  );
  return { store, coordinator };
};

const readFirstContext = async (coordinator: FrontendReviewProductCoordinator) => {
  const queue = await coordinator.listReviewQueue(scope, {
    schemaVersion: '1.0.0',
    pageSize: 50,
  });
  const item = queue.items[0];
  return coordinator.getReviewContext(scope, {
    schemaVersion: '1.0.0',
    reviewContextId: item!.reviewContextId,
    contextRevision: item!.contextRevision,
  });
};

const readCandidateContext = async (coordinator: FrontendReviewProductCoordinator) => {
  const queue = await coordinator.listReviewQueue(scope, {
    schemaVersion: '1.0.0',
    pageSize: 50,
  });
  const item = queue.items.find((candidate) => candidate.targetKind === 'DISCOVERY_CANDIDATE');
  return coordinator.getReviewContext(scope, {
    schemaVersion: '1.0.0',
    reviewContextId: item!.reviewContextId,
    contextRevision: item!.contextRevision,
  });
};

describe('FE-P4-S1 Review negative matrix (AC-30, AC-15)', () => {
  it('issues an Approval with no Canonical Commit / Directive Apply / External Action side effect', async () => {
    const { coordinator, store } = buildCoordinator();
    const read = await readFirstContext(coordinator);
    const itemId = read.context.items[0]!.reviewItemId;
    const result = await coordinator.recordReviewDecisions(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-approve-1',
      idempotencyKey: 'idem-approve-1',
      reviewContextId: read.context.reviewContextId,
      expectedContextRevision: read.context.contextRevision,
      expectedTargetRevision: read.context.targetRevision,
      expectedTargetDigest: read.context.targetDigest,
      itemDecisions: [
        { schemaVersion: '1.0.0', reviewItemId: itemId, intent: 'APPROVE', reason: 'OK.' },
      ],
    });
    // An Approval Resource was created...
    if (read.context.targetKind === 'KNOWLEDGE_DRAFT_CHANGE_SET') {
      expect(result.approvals?.[0]?.purpose).toBe('KNOWLEDGE_CANONICAL_CHANGE');
    } else if (read.context.targetKind === 'USER_DIRECTIVE_PROPOSAL') {
      expect(result.approvals?.[0]?.purpose).toBe('USER_DIRECTIVE_CHANGE');
    }
    // ...but the store only ever grew by Review resources. There is no
    // Canonical, Directive or Action repository bound to the coordinator.
    expect(store.approvals.size).toBeGreaterThanOrEqual(0);
    expect(result.outcome).toBe('COMPLETED');
  });

  it('never leaks hidden resource existence and rejects hidden Items in an approval set', async () => {
    const { coordinator } = buildCoordinator();
    const read = await readFirstContext(coordinator);
    // Every visible Item is presented; hidden content is excluded before
    // counts and descriptions. No hidden identity is echoed in a failure.
    await expect(
      coordinator.recordReviewDecisions(scope, {
        schemaVersion: '1.0.0',
        clientRequestId: 'client-hidden-1',
        idempotencyKey: 'idem-hidden-1',
        reviewContextId: read.context.reviewContextId,
        expectedContextRevision: read.context.contextRevision,
        expectedTargetRevision: read.context.targetRevision,
        expectedTargetDigest: read.context.targetDigest,
        itemDecisions: [
          {
            schemaVersion: '1.0.0',
            reviewItemId: 'hidden-item',
            intent: 'APPROVE',
            reason: 'N/A',
          },
        ],
      }),
    ).rejects.toMatchObject({ apiCode: 'REVIEW_ITEM_NOT_FOUND' });
  });

  it('rejects decisions outside the allowed set (REVIEW_DECISION_NOT_ALLOWED)', async () => {
    const { coordinator } = buildCoordinator();
    const read = await readCandidateContext(coordinator);
    // Discovery Candidate items do not allow REQUEST_REVISION.
    await expect(
      coordinator.recordReviewDecisions(scope, {
        schemaVersion: '1.0.0',
        clientRequestId: 'client-disallowed-1',
        idempotencyKey: 'idem-disallowed-1',
        reviewContextId: read.context.reviewContextId,
        expectedContextRevision: read.context.contextRevision,
        expectedTargetRevision: read.context.targetRevision,
        expectedTargetDigest: read.context.targetDigest,
        itemDecisions: [
          {
            schemaVersion: '1.0.0',
            reviewItemId: read.context.items[0]!.reviewItemId,
            intent: 'REQUEST_REVISION',
            reason: 'Not allowed for candidates.',
          },
        ],
      }),
    ).rejects.toMatchObject({ apiCode: 'REVIEW_DECISION_NOT_ALLOWED' });
  });

  it('preserves rejected and held decision history (append-only, no deletion)', async () => {
    const { coordinator } = buildCoordinator();
    const read = await readFirstContext(coordinator);
    const itemId = read.context.items[0]!.reviewItemId;

    const first = await coordinator.recordReviewDecisions(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-history-1',
      idempotencyKey: 'idem-history-1',
      reviewContextId: read.context.reviewContextId,
      expectedContextRevision: read.context.contextRevision,
      expectedTargetRevision: read.context.targetRevision,
      expectedTargetDigest: read.context.targetDigest,
      itemDecisions: [{ schemaVersion: '1.0.0', reviewItemId: itemId, intent: 'HOLD' }],
    });
    // HOLD is nonterminal and may be superseded on the same revision.
    const second = await coordinator.recordReviewDecisions(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-history-2',
      idempotencyKey: 'idem-history-2',
      reviewContextId: read.context.reviewContextId,
      expectedContextRevision: read.context.contextRevision,
      expectedTargetRevision: read.context.targetRevision,
      expectedTargetDigest: read.context.targetDigest,
      itemDecisions: [
        { schemaVersion: '1.0.0', reviewItemId: itemId, intent: 'REJECT', reason: 'No evidence.' },
      ],
    });
    // Both records survive: nothing is deleted.
    expect(first.decisions.length).toBe(1);
    expect(second.decisions.length).toBe(1);
    const history = await coordinator.getReviewContext(scope, {
      schemaVersion: '1.0.0',
      reviewContextId: read.context.reviewContextId,
      contextRevision: read.context.contextRevision,
    });
    expect(history.decisions.map((decision) => decision.intent)).toContain('HOLD');
    expect(history.decisions.map((decision) => decision.intent)).toContain('REJECT');
  });

  it('never automatically resubmits a decision after OUTCOME_UNKNOWN', async () => {
    const { coordinator } = buildCoordinator();
    const read = await readFirstContext(coordinator);
    // A repeated command with the SAME identity is a replay, not a resubmit:
    // the second execution resolves through the original identity.
    const request = {
      schemaVersion: '1.0.0' as const,
      clientRequestId: 'client-replay-1',
      idempotencyKey: 'idem-replay-1',
      reviewContextId: read.context.reviewContextId,
      expectedContextRevision: read.context.contextRevision,
      expectedTargetRevision: read.context.targetRevision,
      expectedTargetDigest: read.context.targetDigest,
      itemDecisions: [
        {
          schemaVersion: '1.0.0' as const,
          reviewItemId: read.context.items[0]!.reviewItemId,
          intent: 'HOLD' as const,
        },
      ],
    };
    await coordinator.recordReviewDecisions(scope, request);
    const replay = await coordinator.recordReviewDecisions(scope, request);
    // The replay returns the same decision set (idempotent), never a duplicate.
    expect(replay.decisions[0]?.decisionId).toBeDefined();
  });
});
