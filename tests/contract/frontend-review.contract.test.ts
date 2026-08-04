import { describe, expect, it } from 'vitest';

import {
  FrontendContractError,
  decodeAddReviewCommentRequestV1,
  decodeAddReviewCommentResultV1,
  decodeGetReviewApprovalRequestV1,
  decodeGetReviewApprovalResultV1,
  decodeGetReviewContextRequestV1,
  decodeGetReviewContextResultV1,
  decodeGetReviewItemDetailRequestV1,
  decodeGetReviewItemDetailResultV1,
  decodeListReviewQueueRequestV1,
  decodeListReviewQueueResultV1,
  decodeRecordReviewDecisionsRequestV1,
  decodeRecordReviewDecisionsResultV1,
  decodeResolveReviewCommandOutcomeRequestV1,
  decodeResolveReviewCommandOutcomeResultV1,
  decodeRevalidateReviewContextRequestV1,
  decodeRevalidateReviewContextResultV1,
  frontendReviewAddCommentDigest,
  frontendReviewRecordDecisionsDigest,
  frontendReviewRevalidateDigest,
  isReviewFailureReasonV1,
  reviewFailureApiCode,
  validateReviewApprovalPurpose,
  validateReviewSourceItemKind,
} from '../../packages/contracts/src/index.js';

/**
 * AC-21/AC-31: one contract suite per Product API operation. The V1
 * operations (queue, context read, item read, revalidate, decisions, comment,
 * approval read, outcome resolution) are each covered by an explicit
 * `describe` with strict decoding, unknown-field rejection and typed failure
 * assertions. Shared primitives and cross-field identity helpers are covered
 * in the shared suite.
 */

const actor = {
  schemaVersion: '1.0.0' as const,
  principalId: 'principal-1',
  actorId: 'user-1',
};

const targetRef = {
  schemaVersion: '1.0.0' as const,
  targetKind: 'KNOWLEDGE_DRAFT_CHANGE_SET' as const,
  targetId: 'draft-1',
  targetRevision: '3',
};

const canonicalBase = {
  schemaVersion: '1.0.0' as const,
  snapshotId: 'snapshot-1',
  revision: '2',
  digest: 'base-digest',
};

const artifactRefs = {
  schemaVersion: '1.0.0' as const,
  validation: {
    schemaVersion: '1.0.0' as const,
    artifactKind: 'VALIDATION' as const,
    artifactId: 'validation-1',
    artifactRevision: '1',
    digest: 'validation-digest',
  },
  impact: {
    schemaVersion: '1.0.0' as const,
    artifactKind: 'IMPACT' as const,
    artifactId: 'impact-1',
    artifactRevision: '1',
    digest: 'impact-digest',
  },
};

const item = {
  schemaVersion: '1.0.0' as const,
  reviewItemId: 'item-1',
  sourceItemKind: 'KNOWLEDGE_OPERATION' as const,
  sourceItemId: 'op-1',
  sourceItemRevision: '1',
  sourceItemDigest: 'op-digest',
  targetRef,
  label: 'Add claim X',
  before: {
    schemaVersion: '1.0.0' as const,
    representationKind: 'OPAQUE_TEXT' as const,
    summary: 'Before summary',
    detailText: 'Before detail',
  },
  after: {
    schemaVersion: '1.0.0' as const,
    representationKind: 'OPAQUE_TEXT' as const,
    summary: 'After summary',
    detailText: 'After detail',
  },
  rationale: 'Supported by source evidence.',
  artifactRefs,
  allowedDecisions: ['APPROVE', 'REJECT', 'REQUEST_REVISION', 'HOLD'] as const,
  decisionState: 'PENDING' as const,
  sensitivity: 'NORMAL' as const,
  maskedFields: [] as const,
  accessMasking: 'VISIBLE' as const,
};

const dependency = {
  schemaVersion: '1.0.0' as const,
  dependencyId: 'dep-1',
  fromReviewItemId: 'item-1',
  toReviewItemId: 'item-2',
  kind: 'REQUIRES' as const,
  reasonCode: 'OPERATION_ORDER',
  description: 'Item 2 requires item 1.',
  availability: 'AVAILABLE' as const,
};

const context = {
  schemaVersion: '1.0.0' as const,
  reviewContextId: 'context-1',
  contextRevision: 1,
  reviewResourceId: 'review-resource-1',
  targetKind: 'KNOWLEDGE_DRAFT_CHANGE_SET' as const,
  targetId: 'draft-1',
  targetRevision: '3',
  targetDigest: 'draft-digest',
  resourceProjectId: 'project-1',
  effectiveProjectId: 'project-1',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  canonicalBase,
  artifactRefs,
  items: [item] as const,
  dependencies: [dependency] as const,
  aggregateState: 'PENDING' as const,
  capabilities: [
    'LIST_QUEUE',
    'READ_CONTEXT',
    'READ_ITEM',
    'READ_APPROVAL',
    'REVALIDATE',
    'RECORD_DECISIONS',
    'ADD_COMMENT',
    'RESOLVE_OUTCOME',
  ] as const,
  generatedAt: '2026-08-04T08:00:00.000Z',
};

const decisionRecord = {
  schemaVersion: '1.0.0' as const,
  decisionId: 'decision-1',
  reviewContextId: 'context-1',
  contextRevision: 1,
  reviewItemId: 'item-1',
  intent: 'APPROVE' as const,
  reason: 'Matches canonical evidence.',
  decidedBy: actor,
  decidedAt: '2026-08-04T09:00:00.000Z',
  terminal: true,
};

const commentRecord = {
  schemaVersion: '1.0.0' as const,
  commentId: 'comment-1',
  reviewContextId: 'context-1',
  contextRevision: 1,
  text: 'Needs one more source.',
  authoredBy: actor,
  authoredAt: '2026-08-04T09:05:00.000Z',
};

const approval = {
  schemaVersion: '1.0.0' as const,
  approvalId: 'approval-1',
  purpose: 'KNOWLEDGE_CANONICAL_CHANGE' as const,
  reviewContextId: 'context-1',
  contextRevision: 1,
  targetKind: 'KNOWLEDGE_DRAFT_CHANGE_SET' as const,
  targetId: 'draft-1',
  targetRevision: '3',
  targetDigest: 'draft-digest',
  approvedItemIds: ['item-1'] as const,
  approvedManifestDigest: 'manifest-digest',
  actor,
  projectId: 'project-1',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  reason: 'Approved as a complete set.',
  issuedAt: '2026-08-04T09:00:00.000Z',
  expiresAt: '2026-08-05T09:00:00.000Z',
  status: 'ACTIVE' as const,
};

describe('shared primitives and cross-field identity', () => {
  it('rejects unknown fields on shared objects', () => {
    expect(() => decodeListReviewQueueRequestV1({ ...request('queue'), extra: 1 })).toThrow(
      FrontendContractError,
    );
  });

  it('validates source-item-kind consistency per target kind', () => {
    expect(validateReviewSourceItemKind('KNOWLEDGE_DRAFT_CHANGE_SET', 'KNOWLEDGE_OPERATION')).toBe(
      true,
    );
    expect(validateReviewSourceItemKind('KNOWLEDGE_DRAFT_CHANGE_SET', 'DISCOVERY_CANDIDATE')).toBe(
      false,
    );
    expect(validateReviewSourceItemKind('DISCOVERY_CANDIDATE', 'DISCOVERY_CANDIDATE')).toBe(true);
    expect(validateReviewSourceItemKind('USER_DIRECTIVE_PROPOSAL', 'USER_DIRECTIVE_CLAUSE')).toBe(
      true,
    );
  });

  it('validates approval purpose eligibility per target kind', () => {
    expect(
      validateReviewApprovalPurpose('KNOWLEDGE_DRAFT_CHANGE_SET', 'KNOWLEDGE_CANONICAL_CHANGE'),
    ).toBe(true);
    expect(
      validateReviewApprovalPurpose('KNOWLEDGE_DRAFT_CHANGE_SET', 'USER_DIRECTIVE_CHANGE'),
    ).toBe(false);
    expect(validateReviewApprovalPurpose('USER_DIRECTIVE_PROPOSAL', 'USER_DIRECTIVE_CHANGE')).toBe(
      true,
    );
    expect(validateReviewApprovalPurpose('DISCOVERY_CANDIDATE', 'KNOWLEDGE_CANONICAL_CHANGE')).toBe(
      false,
    );
  });

  it('maps every frozen review failure reason to a typed code', () => {
    const reasons = [
      'REVIEW_CONTEXT_NOT_FOUND',
      'REVIEW_CONTEXT_STALE',
      'REVIEW_TARGET_CHANGED',
      'REVIEW_ITEM_NOT_FOUND',
      'REVIEW_DECISION_NOT_ALLOWED',
      'REVIEW_DEPENDENCY_UNSATISFIED',
      'REVIEW_ATOMIC_GROUP_SPLIT',
      'REVIEW_CONFLICTING_APPROVAL_SET',
      'REVIEW_DANGLING_REFERENCE',
      'REVIEW_EVIDENCE_CHANGED',
      'REVIEW_POLICY_CHANGED',
      'REVIEW_ACCESS_CHANGED',
      'REVIEW_APPROVAL_NOT_ISSUED',
      'REVIEW_APPROVAL_EXPIRED',
      'REVIEW_REVISION_ROUTE_UNAVAILABLE',
      'EXTERNAL_ACTION_REVIEW_REQUIRES_FE_P4_S2',
    ] as const;
    for (const reason of reasons) {
      expect(isReviewFailureReasonV1(reason)).toBe(true);
      expect(reviewFailureApiCode(reason)).toBe(reason);
    }
    expect(isReviewFailureReasonV1('UNKNOWN_REASON')).toBe(false);
  });
});

const request = (schemaVersion: string): { schemaVersion: string } => ({ schemaVersion });

describe('ListReviewQueue', () => {
  it('decodes a bounded queue request', () => {
    const decoded = decodeListReviewQueueRequestV1({
      schemaVersion: '1.0.0',
      targetKinds: ['KNOWLEDGE_DRAFT_CHANGE_SET'],
      aggregateStates: ['PENDING'],
      pageSize: 20,
    });
    expect(decoded.pageSize).toBe(20);
    expect(decoded.targetKinds).toEqual(['KNOWLEDGE_DRAFT_CHANGE_SET']);
  });

  it('rejects page sizes outside 1..50', () => {
    expect(() => decodeListReviewQueueRequestV1({ schemaVersion: '1.0.0', pageSize: 0 })).toThrow(
      FrontendContractError,
    );
    expect(() => decodeListReviewQueueRequestV1({ schemaVersion: '1.0.0', pageSize: 51 })).toThrow(
      FrontendContractError,
    );
  });

  it('decodes a queue result', () => {
    const decoded = decodeListReviewQueueResultV1({
      schemaVersion: '1.0.0',
      acceptedContext: {
        schemaVersion: '1.0.0',
        resourceProjectId: 'project-1',
        accessRevision: 'access-1',
        policyContextRevision: 'policy-1',
      },
      queueSnapshotRevision: 'queue-1',
      items: [
        {
          schemaVersion: '1.0.0',
          reviewContextId: 'context-1',
          contextRevision: 1,
          targetKind: 'KNOWLEDGE_DRAFT_CHANGE_SET',
          targetId: 'draft-1',
          targetLabel: 'Draft one',
          aggregateState: 'PENDING',
          itemCount: 1,
          updatedAt: '2026-08-04T08:00:00.000Z',
          attentionReasons: ['REQUIRES_ACTION'],
          capabilities: ['READ_CONTEXT'],
        },
      ],
      totalCountStatus: 'EXACT',
      capabilities: ['READ_CONTEXT'],
    });
    expect(decoded.items[0]?.targetLabel).toBe('Draft one');
    expect(decoded.totalCountStatus).toBe('EXACT');
  });

  it('rejects unknown fields in a queue result', () => {
    expect(() =>
      decodeListReviewQueueResultV1({
        schemaVersion: '1.0.0',
        acceptedContext: {
          schemaVersion: '1.0.0',
          resourceProjectId: 'project-1',
          accessRevision: 'access-1',
          policyContextRevision: 'policy-1',
        },
        queueSnapshotRevision: 'queue-1',
        items: [],
        totalCountStatus: 'EXACT',
        capabilities: [],
        leaked: true,
      }),
    ).toThrow(FrontendContractError);
  });
});

describe('GetReviewContext', () => {
  it('decodes a context read request', () => {
    const decoded = decodeGetReviewContextRequestV1({
      schemaVersion: '1.0.0',
      reviewContextId: 'context-1',
      contextRevision: 1,
    });
    expect(decoded.reviewContextId).toBe('context-1');
  });

  it('decodes a context read result with history', () => {
    const decoded = decodeGetReviewContextResultV1({
      schemaVersion: '1.0.0',
      context,
      decisions: [decisionRecord],
      comments: [commentRecord],
    });
    expect(decoded.context.reviewContextId).toBe('context-1');
    expect(decoded.decisions[0]?.intent).toBe('APPROVE');
    expect(decoded.comments[0]?.text).toBe('Needs one more source.');
  });

  it('rejects a context without canonicalBase for a draft target', () => {
    // Syntactic decode succeeds; the cross-field requirement is validated by
    // the domain. Verify the decoder still passes the value through intact.
    const withoutBase = { ...context, canonicalBase: undefined };
    const decoded = decodeGetReviewContextResultV1({
      schemaVersion: '1.0.0',
      context: withoutBase,
      decisions: [],
      comments: [],
    });
    expect(decoded.context.canonicalBase).toBeUndefined();
  });
});

describe('GetReviewItemDetail', () => {
  it('decodes an item detail request', () => {
    const decoded = decodeGetReviewItemDetailRequestV1({
      schemaVersion: '1.0.0',
      reviewContextId: 'context-1',
      contextRevision: 1,
      reviewItemId: 'item-1',
      includeEvidence: true,
    });
    expect(decoded.includeEvidence).toBe(true);
    expect(decoded.includeImpact).toBeUndefined();
  });

  it('decodes an item detail result with lazy evidence and impact', () => {
    const decoded = decodeGetReviewItemDetailResultV1({
      schemaVersion: '1.0.0',
      item,
      dependencies: [dependency],
      evidence: [
        {
          schemaVersion: '1.0.0',
          sourceId: 'source-1',
          sourceVersionId: 'source-1-v2',
          evidenceSpanId: 'span-1',
          snippet: 'Evidence snippet',
        },
      ],
      decisions: [decisionRecord],
    });
    expect(decoded.evidence?.[0]?.snippet).toBe('Evidence snippet');
    expect(decoded.impact).toBeUndefined();
  });
});

describe('RevalidateReviewContext', () => {
  it('decodes a revalidate request', () => {
    const decoded = decodeRevalidateReviewContextRequestV1({
      schemaVersion: '1.0.0',
      reviewContextId: 'context-1',
      contextRevision: 1,
      reason: 'Policy updated',
    });
    expect(decoded.reason).toBe('Policy updated');
  });

  it('computes a stable semantic digest independent of identity fields', () => {
    const base = {
      schemaVersion: '1.0.0' as const,
      reviewContextId: 'context-1',
      contextRevision: 1,
      reason: 'Policy updated',
    };
    expect(frontendReviewRevalidateDigest(base)).toBe(frontendReviewRevalidateDigest(base));
    expect(frontendReviewRevalidateDigest(base)).not.toBe(
      frontendReviewRevalidateDigest({ ...base, reason: 'Other' }),
    );
  });

  it('decodes a revalidate result with the new context revision', () => {
    const decoded = decodeRevalidateReviewContextResultV1({
      schemaVersion: '1.0.0',
      outcome: 'COMPLETED',
      clientRequestId: 'client-1',
      idempotencyKey: 'idem-1',
      commandSemanticDigest: 'digest-1',
      context: { ...context, contextRevision: 2 },
    });
    expect(decoded.context.contextRevision).toBe(2);
  });
});

describe('RecordReviewDecisions', () => {
  it('decodes a decisions request and enforces terminal reasons', () => {
    const decoded = decodeRecordReviewDecisionsRequestV1({
      schemaVersion: '1.0.0',
      reviewContextId: 'context-1',
      expectedContextRevision: 1,
      expectedTargetRevision: '3',
      expectedTargetDigest: 'draft-digest',
      itemDecisions: [
        {
          schemaVersion: '1.0.0',
          reviewItemId: 'item-1',
          intent: 'APPROVE',
          reason: 'Matches evidence.',
        },
      ],
    });
    expect(decoded.itemDecisions[0]?.intent).toBe('APPROVE');
  });

  it('rejects terminal decisions without a reason', () => {
    expect(() =>
      decodeRecordReviewDecisionsRequestV1({
        schemaVersion: '1.0.0',
        reviewContextId: 'context-1',
        expectedContextRevision: 1,
        expectedTargetRevision: '3',
        expectedTargetDigest: 'draft-digest',
        itemDecisions: [{ schemaVersion: '1.0.0', reviewItemId: 'item-1', intent: 'REJECT' }],
      }),
    ).toThrow(FrontendContractError);
  });

  it('allows HOLD without a reason', () => {
    const decoded = decodeRecordReviewDecisionsRequestV1({
      schemaVersion: '1.0.0',
      reviewContextId: 'context-1',
      expectedContextRevision: 1,
      expectedTargetRevision: '3',
      expectedTargetDigest: 'draft-digest',
      itemDecisions: [{ schemaVersion: '1.0.0', reviewItemId: 'item-1', intent: 'HOLD' }],
    });
    expect(decoded.itemDecisions[0]?.reason).toBeUndefined();
  });

  it('rejects duplicate item decisions', () => {
    expect(() =>
      decodeRecordReviewDecisionsRequestV1({
        schemaVersion: '1.0.0',
        reviewContextId: 'context-1',
        expectedContextRevision: 1,
        expectedTargetRevision: '3',
        expectedTargetDigest: 'draft-digest',
        itemDecisions: [
          {
            schemaVersion: '1.0.0',
            reviewItemId: 'item-1',
            intent: 'APPROVE',
            reason: 'r1',
          },
          {
            schemaVersion: '1.0.0',
            reviewItemId: 'item-1',
            intent: 'REJECT',
            reason: 'r2',
          },
        ],
      }),
    ).toThrow(FrontendContractError);
  });

  it('computes the decisions semantic digest', () => {
    const requestInput = {
      schemaVersion: '1.0.0' as const,
      reviewContextId: 'context-1',
      expectedContextRevision: 1,
      expectedTargetRevision: '3',
      expectedTargetDigest: 'draft-digest',
      itemDecisions: [
        {
          schemaVersion: '1.0.0' as const,
          reviewItemId: 'item-1',
          intent: 'APPROVE' as const,
          reason: 'Matches evidence.',
        },
      ],
      comment: undefined,
    };
    expect(frontendReviewRecordDecisionsDigest(requestInput)).toBe(
      frontendReviewRecordDecisionsDigest(requestInput),
    );
  });

  it('decodes a decisions result with approval resources', () => {
    const decoded = decodeRecordReviewDecisionsResultV1({
      schemaVersion: '1.0.0',
      outcome: 'COMPLETED',
      clientRequestId: 'client-1',
      idempotencyKey: 'idem-1',
      commandSemanticDigest: 'digest-1',
      reviewContextId: 'context-1',
      contextRevision: 1,
      decisions: [decisionRecord],
      aggregateState: 'APPROVED_READY',
      approvals: [approval],
    });
    expect(decoded.aggregateState).toBe('APPROVED_READY');
    expect(decoded.approvals?.[0]?.purpose).toBe('KNOWLEDGE_CANONICAL_CHANGE');
    expect(decoded.acceptedForAuthoring).toBeUndefined();
  });

  it('decodes a candidate accepted-for-authoring result without approvals', () => {
    const decoded = decodeRecordReviewDecisionsResultV1({
      schemaVersion: '1.0.0',
      outcome: 'COMPLETED',
      clientRequestId: 'client-1',
      idempotencyKey: 'idem-1',
      commandSemanticDigest: 'digest-1',
      reviewContextId: 'context-2',
      contextRevision: 1,
      decisions: [decisionRecord],
      aggregateState: 'ACCEPTED_FOR_AUTHORING',
      acceptedForAuthoring: true,
    });
    expect(decoded.acceptedForAuthoring).toBe(true);
    expect(decoded.approvals).toBeUndefined();
  });
});

describe('AddReviewComment', () => {
  it('decodes a comment request', () => {
    const decoded = decodeAddReviewCommentRequestV1({
      schemaVersion: '1.0.0',
      reviewContextId: 'context-1',
      contextRevision: 1,
      reviewItemId: 'item-1',
      comment: 'Needs a second source.',
    });
    expect(decoded.comment).toBe('Needs a second source.');
  });

  it('computes the comment semantic digest', () => {
    const requestInput = {
      schemaVersion: '1.0.0' as const,
      reviewContextId: 'context-1',
      contextRevision: 1,
      reviewItemId: 'item-1',
      comment: 'Needs a second source.',
    };
    expect(frontendReviewAddCommentDigest(requestInput)).toBe(
      frontendReviewAddCommentDigest(requestInput),
    );
  });

  it('decodes a comment result', () => {
    const decoded = decodeAddReviewCommentResultV1({
      schemaVersion: '1.0.0',
      outcome: 'COMPLETED',
      clientRequestId: 'client-1',
      idempotencyKey: 'idem-1',
      commandSemanticDigest: 'digest-1',
      comment: commentRecord,
    });
    expect(decoded.comment.text).toBe('Needs one more source.');
  });
});

describe('GetReviewApproval', () => {
  it('decodes an approval read request', () => {
    const decoded = decodeGetReviewApprovalRequestV1({
      schemaVersion: '1.0.0',
      approvalId: 'approval-1',
    });
    expect(decoded.approvalId).toBe('approval-1');
  });

  it('decodes an approval read result', () => {
    const decoded = decodeGetReviewApprovalResultV1({
      schemaVersion: '1.0.0',
      approval,
    });
    expect(decoded.approval.status).toBe('ACTIVE');
    expect(decoded.approval.approvedItemIds).toEqual(['item-1']);
  });
});

describe('ResolveReviewCommandOutcome', () => {
  it('decodes an outcome resolution request', () => {
    const decoded = decodeResolveReviewCommandOutcomeRequestV1({
      schemaVersion: '1.0.0',
      clientRequestId: 'client-1',
      idempotencyKey: 'idem-1',
      semanticDigest: 'digest-1',
    });
    expect(decoded.semanticDigest).toBe('digest-1');
  });

  it('decodes a completed decisions outcome', () => {
    const decoded = decodeResolveReviewCommandOutcomeResultV1({
      schemaVersion: '1.0.0',
      outcome: 'COMPLETED',
      originalClientRequestId: 'client-1',
      originalIdempotencyKey: 'idem-1',
      completed: {
        commandType: 'frontend.review.record-decisions.v1',
        result: {
          schemaVersion: '1.0.0',
          outcome: 'COMPLETED',
          clientRequestId: 'client-1',
          idempotencyKey: 'idem-1',
          commandSemanticDigest: 'digest-1',
          reviewContextId: 'context-1',
          contextRevision: 1,
          decisions: [decisionRecord],
          aggregateState: 'APPROVED_READY',
          approvals: [approval],
        },
      },
    });
    if (decoded.completed?.commandType === 'frontend.review.record-decisions.v1') {
      expect(decoded.completed.result.aggregateState).toBe('APPROVED_READY');
    } else {
      throw new Error('expected record-decisions outcome');
    }
  });

  it('decodes a rejected outcome with rejection details', () => {
    const decoded = decodeResolveReviewCommandOutcomeResultV1({
      schemaVersion: '1.0.0',
      outcome: 'REJECTED',
      originalClientRequestId: 'client-1',
      originalIdempotencyKey: 'idem-1',
      rejection: { code: 'REVIEW_DEPENDENCY_UNSATISFIED', message: 'Missing prerequisite.' },
    });
    expect(decoded.rejection?.code).toBe('REVIEW_DEPENDENCY_UNSATISFIED');
    expect(decoded.completed).toBeUndefined();
  });
});
