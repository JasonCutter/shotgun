import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { PostgresFrontendReviewRepository } from '../../adapters/frontend-review-postgres/src/index.js';
import { InMemoryFrontendReviewStore } from '../../adapters/frontend-review-in-memory/src/index.js';
import type {
  ReviewRepositoryBoundaryPort,
  ReviewContextRecordV1,
} from '../../modules/frontend-review/src/index.js';
import type {
  ReviewApprovalV1,
  ReviewContextRevisionV1,
} from '../../packages/contracts/src/index.js';

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

const contextRecord = (revision: number): ReviewContextRecordV1 => {
  const context: ReviewContextRevisionV1 = {
    schemaVersion: '1.0.0',
    reviewContextId: 'context-1',
    contextRevision: revision,
    reviewResourceId: 'review-resource-1',
    targetKind: 'KNOWLEDGE_DRAFT_CHANGE_SET',
    targetId: 'draft-1',
    targetRevision: '3',
    targetDigest: 'draft-digest',
    resourceProjectId: 'project-1',
    effectiveProjectId: 'project-1',
    accessRevision: 'access-1',
    policyContextRevision: 'policy-1',
    canonicalBase: {
      schemaVersion: '1.0.0',
      snapshotId: 'snapshot-1',
      revision: '2',
      digest: 'base-digest',
    },
    artifactRefs: {
      schemaVersion: '1.0.0',
      validation: {
        schemaVersion: '1.0.0',
        artifactKind: 'VALIDATION',
        artifactId: 'validation-1',
        artifactRevision: '1',
        digest: 'validation-digest',
      },
    },
    items: [
      {
        schemaVersion: '1.0.0',
        reviewItemId: 'item-1',
        sourceItemKind: 'KNOWLEDGE_OPERATION',
        sourceItemId: 'op-1',
        sourceItemRevision: '1',
        sourceItemDigest: 'op-digest',
        targetRef: {
          schemaVersion: '1.0.0',
          targetKind: 'KNOWLEDGE_DRAFT_CHANGE_SET',
          targetId: 'draft-1',
          targetRevision: '3',
        },
        label: 'Add fact X',
        after: {
          schemaVersion: '1.0.0',
          representationKind: 'OPAQUE_TEXT',
          summary: 'After summary',
          detailText: 'After detail',
        },
        rationale: 'Supported.',
        artifactRefs: { schemaVersion: '1.0.0' },
        allowedDecisions: ['APPROVE', 'REJECT', 'REQUEST_REVISION', 'HOLD'],
        decisionState: 'PENDING',
        sensitivity: 'NORMAL',
        maskedFields: [],
        accessMasking: 'VISIBLE',
      },
      {
        schemaVersion: '1.0.0',
        reviewItemId: 'item-2',
        sourceItemKind: 'KNOWLEDGE_OPERATION',
        sourceItemId: 'op-2',
        sourceItemRevision: '1',
        sourceItemDigest: 'op-2-digest',
        targetRef: {
          schemaVersion: '1.0.0',
          targetKind: 'KNOWLEDGE_DRAFT_CHANGE_SET',
          targetId: 'draft-1',
          targetRevision: '3',
        },
        label: 'Add claim Y',
        rationale: 'Supported too.',
        artifactRefs: { schemaVersion: '1.0.0' },
        allowedDecisions: ['APPROVE', 'REJECT', 'REQUEST_REVISION', 'HOLD'],
        decisionState: 'PENDING',
        sensitivity: 'NORMAL',
        maskedFields: [],
        accessMasking: 'VISIBLE',
      },
    ],
    dependencies: [
      {
        schemaVersion: '1.0.0',
        dependencyId: 'dep-1',
        fromReviewItemId: 'item-1',
        toReviewItemId: 'item-2',
        kind: 'REQUIRES',
        reasonCode: 'OPERATION_ORDER',
        description: 'Item 2 requires item 1.',
        availability: 'AVAILABLE',
      },
    ],
    aggregateState: 'PENDING',
    capabilities: ['READ_CONTEXT'],
    generatedAt: '2026-08-04T08:00:00.000Z',
  };
  return {
    reviewResourceId: 'review-resource-1',
    context,
    sourceRevision: '3',
    sourceDigest: 'draft-digest',
    sourceUpdatedAt: '2026-08-04T08:00:00.000Z',
    materializedAt: '2026-08-04T08:00:00.000Z',
  };
};

const approval = (): ReviewApprovalV1 => ({
  schemaVersion: '1.0.0',
  approvalId: 'approval-1',
  purpose: 'KNOWLEDGE_CANONICAL_CHANGE',
  reviewContextId: 'context-1',
  contextRevision: 1,
  targetKind: 'KNOWLEDGE_DRAFT_CHANGE_SET',
  targetId: 'draft-1',
  targetRevision: '3',
  targetDigest: 'draft-digest',
  approvedItemIds: ['item-1'],
  approvedManifestDigest: 'manifest-digest',
  actor: { schemaVersion: '1.0.0', principalId: 'principal-1', actorId: 'principal-1' },
  projectId: 'project-1',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  reason: 'Approved.',
  issuedAt: '2026-08-04T09:00:00.000Z',
  expiresAt: '2026-09-03T09:00:00.000Z',
  status: 'ACTIVE',
});

const runScenario = async (store: ReviewRepositoryBoundaryPort): Promise<unknown> => {
  return store.transaction(async (repositories) => {
    await repositories.contexts.insertContext(contextRecord(1));
    const current = await repositories.contexts.findCurrent('context-1');
    await repositories.contexts.insertContext(contextRecord(2));
    const revision2 = await repositories.contexts.findRevision('context-1', 2);
    const locked = await repositories.contexts.lockCurrent('context-1');
    await repositories.decisions.appendDecisions([
      {
        schemaVersion: '1.0.0',
        decisionId: 'decision-1',
        reviewContextId: 'context-1',
        contextRevision: 1,
        reviewItemId: 'item-1',
        intent: 'APPROVE',
        reason: 'Matches evidence.',
        decidedBy: {
          schemaVersion: '1.0.0',
          principalId: 'principal-1',
          actorId: 'principal-1',
        },
        decidedAt: '2026-08-04T09:00:00.000Z',
        terminal: true,
      },
    ]);
    const decisions = await repositories.decisions.findDecisions('context-1');
    await repositories.decisions.appendComment({
      schemaVersion: '1.0.0',
      commentId: 'comment-1',
      reviewContextId: 'context-1',
      contextRevision: 1,
      reviewItemId: 'item-1',
      text: 'Please add a source.',
      authoredBy: { schemaVersion: '1.0.0', principalId: 'principal-1', actorId: 'principal-1' },
      authoredAt: '2026-08-04T09:05:00.000Z',
    });
    const comments = await repositories.decisions.findComments('context-1');
    await repositories.approvals.insert(approval());
    const foundApproval = await repositories.approvals.findById('approval-1');
    return {
      currentRevision: current?.context.contextRevision,
      revision2Items: revision2?.items.length,
      lockedRevision: locked?.context.contextRevision,
      decisionCount: decisions.length,
      commentCount: comments.length,
      approvalStatus: foundApproval?.status,
      approvalItems: foundApproval?.approvedItemIds,
      dependencyCount: current?.context.dependencies.length,
    };
  });
};

describe.runIf(pool)('FE-P4-S1 in-memory vs PostgreSQL review store parity (AC-18)', () => {
  beforeEach(async () => {
    await pool!.query(
      `TRUNCATE frontend_review.context_revision,
                frontend_review.item,
                frontend_review.dependency,
                frontend_review.decision,
                frontend_review.comment,
                frontend_review.approval
       CASCADE`,
    );
  });

  afterAll(async () => {
    await pool!.end();
  });

  it('produces identical results for both stores', async () => {
    const inMemory = await runScenario(new InMemoryFrontendReviewStore());
    const postgres = await runScenario(new PostgresFrontendReviewRepository(pool!));
    expect(postgres).toEqual(inMemory);
    expect(postgres).toMatchObject({
      currentRevision: 1,
      revision2Items: 2,
      lockedRevision: 2,
      decisionCount: 1,
      commentCount: 1,
      approvalStatus: 'ACTIVE',
      approvalItems: ['item-1'],
      dependencyCount: 1,
    });
  });

  it('rejects duplicate immutable context revisions in both stores', async () => {
    const expectConflict = async (store: ReviewRepositoryBoundaryPort) => {
      await store.transaction(async (repositories) => {
        await repositories.contexts.insertContext(contextRecord(1));
        await expect(repositories.contexts.insertContext(contextRecord(1))).rejects.toThrow();
      });
    };
    await expectConflict(new InMemoryFrontendReviewStore());
    await expectConflict(new PostgresFrontendReviewRepository(pool!));
  });
});
