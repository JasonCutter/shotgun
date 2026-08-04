import { describe, expect, it } from 'vitest';

import { FrontendReviewProductCoordinator } from '../../modules/frontend-review/src/index.js';
import type {
  FrontendReviewScopeV1,
  ReviewContextRecordV1,
  ReviewTargetAdapterPort,
} from '../../modules/frontend-review/src/index.js';
import { InMemoryFrontendCommandGateway } from '../../adapters/frontend-command-gateway-in-memory/src/index.js';
import { InMemoryFrontendReviewStore } from '../../adapters/frontend-review-in-memory/src/index.js';
import type {
  ReviewApprovalV1,
  ReviewContextRevisionV1,
  ReviewItemV1,
} from '../../packages/contracts/src/index.js';

/**
 * FE-P4-S1 Review security fail-closed matrix (AC-21, AC-22, AC-26, AC-29).
 *
 * Proves that Review reads fail closed when the access or policy scope
 * changed, that insufficient Review scope is denied at the operation level,
 * that reduced sensitivity clearance hides Items, that historical reads are
 * revalidated, that Approval reads validate access/policy/status/expiry, and
 * that the frozen Context Item / dependency bounds are enforced.
 */

const PROJECT = 'project-1';

const scope: FrontendReviewScopeV1 = {
  principalId: 'principal-1',
  sessionId: 'session-1',
  activeProjectId: PROJECT,
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  sensitivityClearance: 'ALL',
  accessScope: ['review', 'action:approve'],
};

const fixedNow = (): Date => new Date('2026-08-04T12:00:00.000Z');

const makeItem = (index: number, sensitivity: ReviewItemV1['sensitivity']): ReviewItemV1 => ({
  schemaVersion: '1.0.0',
  reviewItemId: `item-${index}`,
  sourceItemKind: 'KNOWLEDGE_OPERATION',
  sourceItemId: `source-${index}`,
  sourceItemRevision: '1',
  sourceItemDigest: `digest-${index}`,
  targetRef: {
    schemaVersion: '1.0.0',
    targetKind: 'KNOWLEDGE_DRAFT_CHANGE_SET',
    targetId: 'draft-1',
    targetRevision: '3',
  },
  label: `Item ${index}`,
  rationale: 'Rationale.',
  artifactRefs: {
    schemaVersion: '1.0.0',
    validation: {
      schemaVersion: '1.0.0',
      artifactKind: 'VALIDATION',
      artifactId: 'v-1',
      artifactRevision: '1',
      digest: 'vd',
    },
  },
  allowedDecisions: ['APPROVE', 'REJECT', 'REQUEST_REVISION', 'HOLD'],
  decisionState: 'PENDING',
  sensitivity,
  maskedFields: [],
  accessMasking: 'VISIBLE',
});

const makeContext = (
  overrides: Partial<ReviewContextRevisionV1> = {},
): ReviewContextRevisionV1 => ({
  schemaVersion: '1.0.0',
  reviewContextId: 'context-1',
  contextRevision: 1,
  reviewResourceId: 'review-resource-1',
  targetKind: 'KNOWLEDGE_DRAFT_CHANGE_SET',
  targetId: 'draft-1',
  targetRevision: '3',
  targetDigest: 'draft-digest',
  resourceProjectId: PROJECT,
  effectiveProjectId: PROJECT,
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  artifactRefs: { schemaVersion: '1.0.0' },
  items: [makeItem(1, 'NORMAL')],
  dependencies: [],
  aggregateState: 'PENDING',
  capabilities: [
    'LIST_QUEUE',
    'READ_CONTEXT',
    'READ_ITEM',
    'READ_APPROVAL',
    'REVALIDATE',
    'RECORD_DECISIONS',
    'ADD_COMMENT',
    'RESOLVE_OUTCOME',
  ],
  generatedAt: '2026-08-04T10:00:00.000Z',
  ...overrides,
});

const makeRecord = (context: ReviewContextRevisionV1): ReviewContextRecordV1 => ({
  reviewResourceId: context.reviewResourceId,
  context,
  sourceRevision: context.targetRevision,
  sourceDigest: context.targetDigest,
  sourceUpdatedAt: '2026-08-04T10:00:00.000Z',
  materializedAt: '2026-08-04T10:00:00.000Z',
});

const seedRecord = (store: InMemoryFrontendReviewStore, record: ReviewContextRecordV1): void => {
  store.contextsByResource.set(record.context.reviewContextId, record);
  store.revisions.set(
    `${record.context.reviewContextId}:${record.context.contextRevision}`,
    record.context,
  );
};

const makeStubAdapter = (): ReviewTargetAdapterPort => ({
  targetKind: 'KNOWLEDGE_DRAFT_CHANGE_SET',
  sourceItemKind: 'KNOWLEDGE_OPERATION',
  async listSourceTargets() {
    return [];
  },
  async findSourceTarget() {
    return undefined;
  },
  async materializeContext() {
    throw new Error('unused in seeded tests');
  },
  async readEvidence() {
    return [];
  },
  async readImpact() {
    return [];
  },
  async currentEvidenceDigest() {
    return undefined;
  },
});

const buildCoordinator = (store = new InMemoryFrontendReviewStore()) => {
  const gateway = new InMemoryFrontendCommandGateway();
  const coordinator = new FrontendReviewProductCoordinator(
    store,
    gateway,
    [makeStubAdapter()],
    fixedNow,
  );
  return { store, coordinator };
};

describe('FE-P4-S1 Review fail-closed reads (AC-21, AC-22)', () => {
  it('denies operations when the membership scope has no Review capability', async () => {
    const { coordinator } = buildCoordinator();
    const noReviewScope: FrontendReviewScopeV1 = {
      ...scope,
      accessScope: ['read'],
    };
    await expect(
      coordinator.listReviewQueue(noReviewScope, { schemaVersion: '1.0.0', pageSize: 50 }),
    ).rejects.toMatchObject({ apiCode: 'PROJECT_ACCESS_DENIED' });
    await expect(
      coordinator.getReviewContext(noReviewScope, {
        schemaVersion: '1.0.0',
        reviewContextId: 'context-1',
        contextRevision: 1,
      }),
    ).rejects.toMatchObject({ apiCode: 'PROJECT_ACCESS_DENIED' });
  });

  it('does not advertise Approval reads without an approval scope', async () => {
    const { coordinator } = buildCoordinator();
    const noApprovalScope: FrontendReviewScopeV1 = { ...scope, accessScope: ['review'] };
    const queue = await coordinator.listReviewQueue(noApprovalScope, {
      schemaVersion: '1.0.0',
      pageSize: 50,
    });
    expect(queue.capabilities).not.toContain('READ_APPROVAL');
    expect(queue.capabilities).toContain('READ_CONTEXT');
    expect(queue.capabilities).toContain('RECORD_DECISIONS');
  });

  it('returns a restricted shell without the protected payload when the access revision changed', async () => {
    const { store, coordinator } = buildCoordinator();
    seedRecord(store, makeRecord(makeContext()));
    const changedScope: FrontendReviewScopeV1 = { ...scope, accessRevision: 'access-2' };
    const read = await coordinator.getReviewContext(changedScope, {
      schemaVersion: '1.0.0',
      reviewContextId: 'context-1',
      contextRevision: 1,
    });
    expect(read.context.aggregateState).toBe('ACCESS_RESTRICTED');
    expect(read.context.items).toHaveLength(0);
    expect(read.context.dependencies).toHaveLength(0);
    expect(read.context.capabilities).toHaveLength(0);
    expect(read.decisions).toHaveLength(0);
    expect(read.comments).toHaveLength(0);
  });

  it('returns a restricted shell when the policy revision changed', async () => {
    const { store, coordinator } = buildCoordinator();
    seedRecord(store, makeRecord(makeContext()));
    const changedScope: FrontendReviewScopeV1 = { ...scope, policyContextRevision: 'policy-2' };
    const read = await coordinator.getReviewContext(changedScope, {
      schemaVersion: '1.0.0',
      reviewContextId: 'context-1',
      contextRevision: 1,
    });
    expect(read.context.aggregateState).toBe('ACCESS_RESTRICTED');
    expect(read.context.items).toHaveLength(0);
  });

  it('fails closed on Item detail when the access revision changed', async () => {
    const { store, coordinator } = buildCoordinator();
    seedRecord(store, makeRecord(makeContext()));
    const changedScope: FrontendReviewScopeV1 = { ...scope, accessRevision: 'access-2' };
    await expect(
      coordinator.getReviewItemDetail(changedScope, {
        schemaVersion: '1.0.0',
        reviewContextId: 'context-1',
        contextRevision: 1,
        reviewItemId: 'item-1',
      }),
    ).rejects.toMatchObject({ apiCode: 'REVIEW_ITEM_NOT_FOUND' });
  });

  it('revalidates historical Context reads against the current scope', async () => {
    const { store, coordinator } = buildCoordinator();
    seedRecord(store, makeRecord(makeContext()));
    const historical = makeContext({
      contextRevision: 2,
      targetRevision: '4',
      targetDigest: 'new',
    });
    store.revisions.set('context-1:2', historical);
    const changedScope: FrontendReviewScopeV1 = { ...scope, accessRevision: 'access-2' };
    const read = await coordinator.getReviewContext(changedScope, {
      schemaVersion: '1.0.0',
      reviewContextId: 'context-1',
      contextRevision: 2,
    });
    expect(read.context.aggregateState).toBe('ACCESS_RESTRICTED');
    expect(read.context.items).toHaveLength(0);
    expect(read.decisions).toHaveLength(0);
    expect(read.comments).toHaveLength(0);
  });

  it('hides Items whose sensitivity exceeds the current clearance', async () => {
    const { store, coordinator } = buildCoordinator();
    seedRecord(
      store,
      makeRecord(
        makeContext({
          items: [makeItem(1, 'NORMAL'), makeItem(2, 'RESTRICTED')],
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
        }),
      ),
    );
    const lowClearanceScope: FrontendReviewScopeV1 = {
      ...scope,
      sensitivityClearance: 'public',
    };
    const read = await coordinator.getReviewContext(lowClearanceScope, {
      schemaVersion: '1.0.0',
      reviewContextId: 'context-1',
      contextRevision: 1,
    });
    expect(read.context.items.map((item) => item.reviewItemId)).toEqual(['item-1']);
    expect(read.context.dependencies).toHaveLength(0);
  });

  it('fails closed on Item detail when the sensitivity clearance is insufficient', async () => {
    const { store, coordinator } = buildCoordinator();
    seedRecord(
      store,
      makeRecord(
        makeContext({
          items: [makeItem(1, 'RESTRICTED')],
        }),
      ),
    );
    const lowClearanceScope: FrontendReviewScopeV1 = {
      ...scope,
      sensitivityClearance: 'public',
    };
    await expect(
      coordinator.getReviewItemDetail(lowClearanceScope, {
        schemaVersion: '1.0.0',
        reviewContextId: 'context-1',
        contextRevision: 1,
        reviewItemId: 'item-1',
      }),
    ).rejects.toMatchObject({ apiCode: 'REVIEW_ITEM_NOT_FOUND' });
  });

  it('denies an Approval read when access or policy changed', async () => {
    const { store, coordinator } = buildCoordinator();
    const approval: ReviewApprovalV1 = {
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
      projectId: PROJECT,
      accessRevision: 'access-1',
      policyContextRevision: 'policy-1',
      reason: 'Approved.',
      issuedAt: '2026-08-04T11:00:00.000Z',
      expiresAt: '2026-09-04T11:00:00.000Z',
      status: 'ACTIVE',
    };
    store.approvals.set(approval.approvalId, approval);
    const changedScope: FrontendReviewScopeV1 = { ...scope, accessRevision: 'access-2' };
    await expect(
      coordinator.getReviewApproval(changedScope, {
        schemaVersion: '1.0.0',
        approvalId: 'approval-1',
      }),
    ).rejects.toMatchObject({ apiCode: 'REVIEW_APPROVAL_NOT_ISSUED' });
  });

  it('denies an Approval read when the Approval has expired', async () => {
    const { store, coordinator } = buildCoordinator();
    const approval: ReviewApprovalV1 = {
      schemaVersion: '1.0.0',
      approvalId: 'approval-expired',
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
      projectId: PROJECT,
      accessRevision: 'access-1',
      policyContextRevision: 'policy-1',
      reason: 'Approved.',
      issuedAt: '2026-08-04T11:00:00.000Z',
      expiresAt: '2026-08-04T11:30:00.000Z',
      status: 'ACTIVE',
    };
    store.approvals.set(approval.approvalId, approval);
    await expect(
      coordinator.getReviewApproval(scope, {
        schemaVersion: '1.0.0',
        approvalId: 'approval-expired',
      }),
    ).rejects.toMatchObject({ apiCode: 'REVIEW_APPROVAL_EXPIRED' });
  });

  it('denies an Approval read when the Approval status is not ACTIVE', async () => {
    const { store, coordinator } = buildCoordinator();
    const approval: ReviewApprovalV1 = {
      schemaVersion: '1.0.0',
      approvalId: 'approval-revoked',
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
      projectId: PROJECT,
      accessRevision: 'access-1',
      policyContextRevision: 'policy-1',
      reason: 'Approved.',
      issuedAt: '2026-08-04T11:00:00.000Z',
      expiresAt: '2026-09-04T11:00:00.000Z',
      status: 'REVOKED',
    };
    store.approvals.set(approval.approvalId, approval);
    await expect(
      coordinator.getReviewApproval(scope, {
        schemaVersion: '1.0.0',
        approvalId: 'approval-revoked',
      }),
    ).rejects.toMatchObject({ apiCode: 'REVIEW_APPROVAL_NOT_ISSUED' });
  });
});

describe('FE-P4-S1 Review bounded-contract enforcement (§18, AC-29)', () => {
  const makeOverLimitAdapter = (): ReviewTargetAdapterPort => ({
    targetKind: 'KNOWLEDGE_DRAFT_CHANGE_SET',
    sourceItemKind: 'KNOWLEDGE_OPERATION',
    async listSourceTargets() {
      return [
        {
          reviewResourceId: 'review-resource-1',
          targetId: 'draft-1',
          targetRevision: '3',
          targetDigest: 'draft-digest',
          targetLabel: 'Draft 1',
          resourceProjectId: PROJECT,
          effectiveProjectId: PROJECT,
          updatedAt: '2026-08-04T10:00:00.000Z',
          source: 'FE_P3_S2_SUBMISSION',
        },
      ];
    },
    async findSourceTarget() {
      return undefined;
    },
    async materializeContext() {
      return {
        context: makeContext({
          items: Array.from({ length: 201 }, (_, index) => makeItem(index, 'NORMAL')),
        }),
      };
    },
    async readEvidence() {
      return [];
    },
    async readImpact() {
      return [];
    },
    async currentEvidenceDigest() {
      return undefined;
    },
  });

  it('rejects materializing a Context with more than 200 Items', async () => {
    const store = new InMemoryFrontendReviewStore();
    const gateway = new InMemoryFrontendCommandGateway();
    const coordinator = new FrontendReviewProductCoordinator(
      store,
      gateway,
      [makeOverLimitAdapter()],
      fixedNow,
    );
    await expect(
      coordinator.listReviewQueue(scope, { schemaVersion: '1.0.0', pageSize: 50 }),
    ).rejects.toMatchObject({ apiCode: 'VALIDATION_FAILED' });
  });
});
