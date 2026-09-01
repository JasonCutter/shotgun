import { describe, expect, it } from 'vitest';

import {
  frontendReviewAddCommentDigest,
  sha256Text,
  stableJson,
  type FrontendKnowledgeDraftChangeSetV1,
  type ReviewContextRevisionV1,
} from '../../packages/contracts/src/index.js';
import { FrontendReviewProductCoordinator } from '../../modules/frontend-review/src/index.js';
import type {
  FrontendReviewAcceptedForAuthoringBridgeV1,
  FrontendReviewScopeV1,
} from '../../modules/frontend-review/src/index.js';
import { InMemoryFrontendCommandGateway } from '../../adapters/frontend-command-gateway-in-memory/src/index.js';
import { InMemoryFrontendKnowledgeDraftRepository } from '../../adapters/frontend-knowledge-draft-in-memory/src/index.js';
import {
  InMemoryFrontendReviewStore,
  DraftReviewTargetAdapter,
  DiscoveryCandidateReviewTargetAdapter,
  UserDirectiveReviewTargetAdapter,
  createInMemoryReviewDraftSourceReader,
  createInMemoryReviewDiscoveryCandidateReader,
  createInMemoryReviewUserDirectiveReader,
} from '../../adapters/frontend-review-in-memory/src/index.js';

/**
 * FE-P4-S1 Review domain behavior (ADR-128). Uses the in-memory store, the
 * shared in-memory Command Gateway, and the in-memory target adapters so the
 * coordinator exercises the real idempotency, dependency-closure and Approval
 * issuance paths without a database.
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

const createSubmittedDraft = (): FrontendKnowledgeDraftChangeSetV1 => {
  const draftId = 'draft-1';
  const now = '2026-08-04T10:00:00.000Z';
  const contentDigest = sha256Text(stableJson({ draftId, revision: 1 }));
  return {
    schemaVersion: '1.0.0',
    draftId,
    seedId: 'seed-1',
    startMode: 'SEED_MATERIALIZATION',
    status: 'SUBMITTED',
    revision: 1,
    activeProjectId: PROJECT,
    resourceProjectId: PROJECT,
    draftProjectId: PROJECT,
    effectiveProjectId: PROJECT,
    resourceId: 'resource-1',
    base: {
      resourceProjectId: PROJECT,
      canonicalSnapshotId: 'canonical-snapshot-1',
      canonicalVersion: 3,
      canonicalSnapshotDigest: 'canonical-digest',
      accessRevision: 'access-1',
      policyContextRevision: 'policy-1',
      sourceLineage: [],
      revisionIdentityKind: 'RESOURCE_REVISION',
      canonicalResourceId: 'resource-1',
      canonicalRevisionId: 'canonical-revision-1',
    },
    operations: [
      {
        operationId: 'op-1',
        kind: 'FACT_ADD',
        baseRevision: 3,
        rationale: 'Add the founding fact.',
        evidenceReferences: [
          { sourceId: 'source-1', sourceVersionId: 'source-1-v2', evidenceSpanId: 'span-1' },
        ],
        expectedImpact: { summary: 'Introduces one canonical fact.' },
        operationRevision: 1,
        contentDigest: 'op-1-digest',
        target: { targetType: 'FACT', resourceId: 'resource-1' },
        after: {
          schemaVersion: 'fact.v1',
          subjectRef: 'resource-1',
          predicate: 'foundedIn',
          value: 2020,
        },
      },
      {
        operationId: 'op-2',
        kind: 'CLAIM_ADD',
        baseRevision: 3,
        rationale: 'Add a related claim.',
        evidenceReferences: [
          { sourceId: 'source-1', sourceVersionId: 'source-1-v2', evidenceSpanId: 'span-2' },
        ],
        expectedImpact: { summary: 'Introduces one claim.' },
        operationRevision: 1,
        contentDigest: 'op-2-digest',
        target: { targetType: 'CLAIM', resourceId: 'resource-1' },
        after: { schemaVersion: 'claim.v1', statement: 'The entity was founded in 2020.' },
      },
    ],
    validation: {
      artifactId: 'validation-1',
      artifactRevision: 1,
      digest: 'validation-digest',
      status: 'COMPLETE',
      projectPolicyContext: {
        activeProjectId: PROJECT,
        resourceProjectId: PROJECT,
        draftProjectId: PROJECT,
        effectiveProjectId: PROJECT,
        accessRevision: 'access-1',
        policyContextRevision: 'policy-1',
      },
    },
    impactPreview: {
      artifactId: 'impact-1',
      artifactRevision: 1,
      digest: 'impact-digest',
      status: 'COMPLETE',
      projectPolicyContext: {
        activeProjectId: PROJECT,
        resourceProjectId: PROJECT,
        draftProjectId: PROJECT,
        effectiveProjectId: PROJECT,
        accessRevision: 'access-1',
        policyContextRevision: 'policy-1',
      },
    },
    reviewResource: {
      reviewResourceId: 'review-resource-1',
      draftId,
      draftRevision: 1,
      resourceProjectId: PROJECT,
      draftProjectId: PROJECT,
      effectiveProjectId: PROJECT,
      policyContextRevision: 'policy-1',
      digest: contentDigest,
    },
    reviewSubmission: {
      reviewSubmissionId: 'review-submission-1',
      draftId,
      draftRevision: 1,
      operationDigest: 'operation-digest',
      contentDigest,
      validationArtifact: {
        artifactId: 'validation-1',
        artifactRevision: 1,
        digest: 'validation-digest',
        status: 'COMPLETE',
        projectPolicyContext: {
          activeProjectId: PROJECT,
          resourceProjectId: PROJECT,
          draftProjectId: PROJECT,
          effectiveProjectId: PROJECT,
          accessRevision: 'access-1',
          policyContextRevision: 'policy-1',
        },
      },
      impactArtifact: {
        artifactId: 'impact-1',
        artifactRevision: 1,
        digest: 'impact-digest',
        status: 'COMPLETE',
        projectPolicyContext: {
          activeProjectId: PROJECT,
          resourceProjectId: PROJECT,
          draftProjectId: PROJECT,
          effectiveProjectId: PROJECT,
          accessRevision: 'access-1',
          policyContextRevision: 'policy-1',
        },
      },
      evidenceLineage: [
        { sourceId: 'source-1', sourceVersionId: 'source-1-v2', evidenceSpanId: 'span-1' },
        { sourceId: 'source-1', sourceVersionId: 'source-1-v2', evidenceSpanId: 'span-2' },
      ],
      projectPolicyContext: {
        activeProjectId: PROJECT,
        resourceProjectId: PROJECT,
        draftProjectId: PROJECT,
        effectiveProjectId: PROJECT,
        accessRevision: 'access-1',
        policyContextRevision: 'policy-1',
      },
      reviewResource: {
        reviewResourceId: 'review-resource-1',
        draftId,
        draftRevision: 1,
        resourceProjectId: PROJECT,
        draftProjectId: PROJECT,
        effectiveProjectId: PROJECT,
        policyContextRevision: 'policy-1',
        digest: contentDigest,
      },
    },
    contentDigest,
    createdAt: now,
    updatedAt: now,
  };
};

const buildCoordinator = (overrides?: {
  readonly drafts?: InMemoryFrontendKnowledgeDraftRepository;
  readonly acceptedForAuthoringBridge?: FrontendReviewAcceptedForAuthoringBridgeV1;
}) => {
  const draftRepository = overrides?.drafts ?? new InMemoryFrontendKnowledgeDraftRepository();
  const store = new InMemoryFrontendReviewStore();
  const gateway = new InMemoryFrontendCommandGateway();
  const draftAdapter = new DraftReviewTargetAdapter(
    createInMemoryReviewDraftSourceReader(draftRepository),
  );
  const candidateAdapter = new DiscoveryCandidateReviewTargetAdapter(
    createInMemoryReviewDiscoveryCandidateReader([
      {
        candidateId: 'candidate-1',
        resourceProjectId: PROJECT,
        effectiveProjectId: PROJECT,
        content: {
          summary: 'Discovery: merge entity A and B',
          detail: 'Proposed merge with evidence.',
        },
        evidence: [
          { sourceId: 'source-2', sourceVersionId: 'source-2-v1', evidenceSpanId: 'span-9' },
        ],
        impact: [
          {
            impactId: 'impact-c-1',
            targetKind: 'ENTITY',
            targetId: 'entity-b',
            description: 'May rename entity B.',
          },
        ],
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
          {
            clauseId: 'clause-1',
            text: 'Retain source version references.',
            rationale: 'Auditability.',
          },
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
    [draftAdapter, candidateAdapter, directiveAdapter],
    fixedNow,
    overrides?.acceptedForAuthoringBridge,
  );
  return { store, gateway, coordinator, draftRepository };
};

const decisionRequest = (
  context: ReviewContextRevisionV1,
  itemId: string,
  intent: 'APPROVE' | 'REJECT' | 'HOLD' | 'REQUEST_REVISION',
  reason?: string,
) => ({
  schemaVersion: '1.0.0' as const,
  clientRequestId: `client-${itemId}-${intent}`,
  idempotencyKey: `idem-${itemId}-${intent}`,
  reviewContextId: context.reviewContextId,
  expectedContextRevision: context.contextRevision,
  expectedTargetRevision: context.targetRevision,
  expectedTargetDigest: context.targetDigest,
  itemDecisions: [
    {
      schemaVersion: '1.0.0' as const,
      reviewItemId: itemId,
      intent,
      ...(reason === undefined ? {} : { reason }),
    },
  ],
});

describe('FE-P4-S1 Review domain — queue and materialization (AC-03, AC-05)', () => {
  it('materializes a submitted Draft into an immutable Review Context idempotently', async () => {
    const { coordinator, draftRepository } = buildCoordinator();
    draftRepository.drafts.set('project-1:draft-1', createSubmittedDraft());

    const first = await coordinator.listReviewQueue(scope, {
      schemaVersion: '1.0.0',
      pageSize: 50,
    });
    const firstItem = first.items.find((item) => item.targetKind === 'KNOWLEDGE_DRAFT_CHANGE_SET');
    expect(firstItem).toBeDefined();
    expect(firstItem?.aggregateState).toBe('PENDING');
    expect(firstItem?.itemCount).toBe(2);

    const second = await coordinator.listReviewQueue(scope, {
      schemaVersion: '1.0.0',
      pageSize: 50,
    });
    const secondItem = second.items.find(
      (item) => item.targetKind === 'KNOWLEDGE_DRAFT_CHANGE_SET',
    );
    // Idempotent: same reviewContextId, no duplicate materialization.
    expect(secondItem?.reviewContextId).toBe(firstItem?.reviewContextId);
    expect(secondItem?.contextRevision).toBe(1);
  });

  it('binds project, access, policy, canonical base and artifacts to the context (AC-05)', async () => {
    const { coordinator, draftRepository } = buildCoordinator();
    draftRepository.drafts.set('project-1:draft-1', createSubmittedDraft());
    const queue = await coordinator.listReviewQueue(scope, {
      schemaVersion: '1.0.0',
      pageSize: 50,
    });
    const item = queue.items.find(
      (candidate) => candidate.targetKind === 'KNOWLEDGE_DRAFT_CHANGE_SET',
    );
    const context = await coordinator.getReviewContext(scope, {
      schemaVersion: '1.0.0',
      reviewContextId: item!.reviewContextId,
      contextRevision: item!.contextRevision,
    });
    expect(context.context.resourceProjectId).toBe(PROJECT);
    expect(context.context.accessRevision).toBe('access-1');
    expect(context.context.policyContextRevision).toBe('policy-1');
    expect(context.context.canonicalBase?.snapshotId).toBe('canonical-snapshot-1');
    expect(context.context.artifactRefs.validation?.digest).toBe('validation-digest');
    expect(context.context.artifactRefs.impact?.digest).toBe('impact-digest');
    expect(context.context.artifactRefs.evidence?.digest).toBeDefined();
  });
});

describe('FE-P4-S1 Review domain — decisions and approvals (AC-08, AC-10, AC-14, AC-15)', () => {
  it('issues a KNOWLEDGE_CANONICAL_CHANGE approval without Commit side effects', async () => {
    const { coordinator, draftRepository, store } = buildCoordinator();
    draftRepository.drafts.set('project-1:draft-1', createSubmittedDraft());
    const queue = await coordinator.listReviewQueue(scope, {
      schemaVersion: '1.0.0',
      pageSize: 50,
    });
    const item = queue.items.find(
      (candidate) => candidate.targetKind === 'KNOWLEDGE_DRAFT_CHANGE_SET',
    );
    const read = await coordinator.getReviewContext(scope, {
      schemaVersion: '1.0.0',
      reviewContextId: item!.reviewContextId,
      contextRevision: item!.contextRevision,
    });
    const itemIds = read.context.items.map((reviewItem) => reviewItem.reviewItemId);

    const result = await coordinator.recordReviewDecisions(
      scope,
      decisionRequest(read.context, itemIds[0]!, 'APPROVE', 'Matches canonical evidence.'),
    );
    expect(result.outcome).toBe('COMPLETED');
    expect(result.decisions[0]?.intent).toBe('APPROVE');
    expect(result.decisions[0]?.terminal).toBe(true);
    expect(result.aggregateState).toBe('PARTIALLY_DECIDED');
    expect(result.approvals?.[0]?.purpose).toBe('KNOWLEDGE_CANONICAL_CHANGE');
    expect(result.approvals?.[0]?.approvedItemIds).toEqual([itemIds[0]]);
    expect(result.approvals?.[0]?.status).toBe('ACTIVE');
    // Approval is a Review resource only — no Canonical write path exists.
    expect(store.approvals.size).toBe(1);
  });

  it('rejects an approval that omits a REQUIRES prerequisite (AC-10)', async () => {
    const { coordinator, draftRepository } = buildCoordinator();
    draftRepository.drafts.set('project-1:draft-1', createSubmittedDraft());
    const queue = await coordinator.listReviewQueue(scope, {
      schemaVersion: '1.0.0',
      pageSize: 50,
    });
    const item = queue.items.find(
      (candidate) => candidate.targetKind === 'KNOWLEDGE_DRAFT_CHANGE_SET',
    );
    const read = await coordinator.getReviewContext(scope, {
      schemaVersion: '1.0.0',
      reviewContextId: item!.reviewContextId,
      contextRevision: item!.contextRevision,
    });
    const itemIds = read.context.items.map((reviewItem) => reviewItem.reviewItemId);
    // The draft adapter builds a REQUIRES chain item-1 -> item-2; approving
    // item-2 alone must fail.
    await expect(
      coordinator.recordReviewDecisions(
        scope,
        decisionRequest(read.context, itemIds[1]!, 'APPROVE', 'Approve the later operation.'),
      ),
    ).rejects.toMatchObject({ apiCode: 'REVIEW_DEPENDENCY_UNSATISFIED' });
  });

  it('rejects a second terminal decision on the same revision (AC-09)', async () => {
    const { coordinator, draftRepository } = buildCoordinator();
    draftRepository.drafts.set('project-1:draft-1', createSubmittedDraft());
    const queue = await coordinator.listReviewQueue(scope, {
      schemaVersion: '1.0.0',
      pageSize: 50,
    });
    const item = queue.items.find(
      (candidate) => candidate.targetKind === 'KNOWLEDGE_DRAFT_CHANGE_SET',
    );
    const read = await coordinator.getReviewContext(scope, {
      schemaVersion: '1.0.0',
      reviewContextId: item!.reviewContextId,
      contextRevision: item!.contextRevision,
    });
    const itemId = read.context.items[0]!.reviewItemId;
    await coordinator.recordReviewDecisions(
      scope,
      decisionRequest(read.context, itemId, 'REJECT', 'Rejected by reviewer.'),
    );
    await expect(
      coordinator.recordReviewDecisions(
        scope,
        decisionRequest(read.context, itemId, 'APPROVE', 'Change of mind is not allowed.'),
      ),
    ).rejects.toMatchObject({ apiCode: 'REVIEW_DECISION_NOT_ALLOWED' });
  });
});

describe('FE-P4-S1 Review domain — candidate and directive (AC-12, AC-13)', () => {
  it('records candidate accepted-for-authoring without an Approval Resource', async () => {
    const { coordinator, store } = buildCoordinator();
    const queue = await coordinator.listReviewQueue(scope, {
      schemaVersion: '1.0.0',
      pageSize: 50,
    });
    const item = queue.items.find((candidate) => candidate.targetKind === 'DISCOVERY_CANDIDATE');
    const read = await coordinator.getReviewContext(scope, {
      schemaVersion: '1.0.0',
      reviewContextId: item!.reviewContextId,
      contextRevision: item!.contextRevision,
    });
    const itemId = read.context.items[0]!.reviewItemId;
    const result = await coordinator.recordReviewDecisions(
      scope,
      decisionRequest(read.context, itemId, 'APPROVE', 'Accepted for authoring.'),
    );
    expect(result.acceptedForAuthoring).toBe(true);
    expect(result.approvals).toBeUndefined();
    expect(store.approvals.size).toBe(0);
  });

  it('joins the accepted Discovery decision to the server-owned Draft bridge', async () => {
    const calls: Array<{ transaction: unknown; targetKind: string; approvedItemIds: string[] }> =
      [];
    const { coordinator } = buildCoordinator({
      acceptedForAuthoringBridge: {
        materialize: async (input) => {
          calls.push({
            transaction: input.transaction,
            targetKind: input.context.targetKind,
            approvedItemIds: [...input.approvedItemIds],
          });
          return {
            draftId: 'discovery-draft-1',
            draftRevision: 1,
            resourceProjectId: PROJECT,
            effectiveProjectId: PROJECT,
          };
        },
      },
    });
    const queue = await coordinator.listReviewQueue(scope, {
      schemaVersion: '1.0.0',
      pageSize: 50,
    });
    const item = queue.items.find((candidate) => candidate.targetKind === 'DISCOVERY_CANDIDATE');
    const read = await coordinator.getReviewContext(scope, {
      schemaVersion: '1.0.0',
      reviewContextId: item!.reviewContextId,
      contextRevision: item!.contextRevision,
    });
    const itemId = read.context.items[0]!.reviewItemId;
    const result = await coordinator.recordReviewDecisions(
      scope,
      decisionRequest(read.context, itemId, 'APPROVE', 'Accepted for authoring.'),
    );

    expect(result.acceptedForAuthoring).toBe(true);
    expect(result.draft).toEqual({
      draftId: 'discovery-draft-1',
      draftRevision: 1,
      resourceProjectId: PROJECT,
      effectiveProjectId: PROJECT,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      targetKind: 'DISCOVERY_CANDIDATE',
      approvedItemIds: [itemId],
    });
    // The in-memory boundary has no raw database handle; production supplies
    // the PostgreSQL PoolClient through this same callback.
    expect(calls[0]?.transaction).toBeUndefined();
  });

  it('issues a USER_DIRECTIVE_CHANGE approval for a directive clause', async () => {
    const { coordinator } = buildCoordinator();
    const queue = await coordinator.listReviewQueue(scope, {
      schemaVersion: '1.0.0',
      pageSize: 50,
    });
    const item = queue.items.find(
      (candidate) => candidate.targetKind === 'USER_DIRECTIVE_PROPOSAL',
    );
    const read = await coordinator.getReviewContext(scope, {
      schemaVersion: '1.0.0',
      reviewContextId: item!.reviewContextId,
      contextRevision: item!.contextRevision,
    });
    const itemId = read.context.items[0]!.reviewItemId;
    const result = await coordinator.recordReviewDecisions(
      scope,
      decisionRequest(read.context, itemId, 'APPROVE', 'Directive approved.'),
    );
    expect(result.approvals?.[0]?.purpose).toBe('USER_DIRECTIVE_CHANGE');
  });

  it('returns a DIRECTIVE_AUTHORING return target for a directive revision request (AC-26)', async () => {
    const { coordinator } = buildCoordinator();
    const queue = await coordinator.listReviewQueue(scope, {
      schemaVersion: '1.0.0',
      pageSize: 50,
    });
    const item = queue.items.find(
      (candidate) => candidate.targetKind === 'USER_DIRECTIVE_PROPOSAL',
    );
    const read = await coordinator.getReviewContext(scope, {
      schemaVersion: '1.0.0',
      reviewContextId: item!.reviewContextId,
      contextRevision: item!.contextRevision,
    });
    const itemId = read.context.items[0]!.reviewItemId;
    const result = await coordinator.recordReviewDecisions(
      scope,
      decisionRequest(read.context, itemId, 'REQUEST_REVISION', 'Please rework.'),
    );
    expect(result.revisionRequestReturnTarget?.workspace).toBe('DIRECTIVE_AUTHORING');
    expect(result.revisionRequestReturnTarget?.resourceId).toBe('directive-1');
    expect(result.revisionRequestReturnTarget?.draftId).toBe('directive-1');
  });
});

describe('FE-P4-S1 Review domain — revalidation and staleness (AC-04)', () => {
  it('creates a new immutable context revision on revalidate', async () => {
    const { coordinator, draftRepository } = buildCoordinator();
    draftRepository.drafts.set('project-1:draft-1', createSubmittedDraft());
    const queue = await coordinator.listReviewQueue(scope, {
      schemaVersion: '1.0.0',
      pageSize: 50,
    });
    const item = queue.items.find(
      (candidate) => candidate.targetKind === 'KNOWLEDGE_DRAFT_CHANGE_SET',
    );
    const revalidated = await coordinator.revalidateReviewContext(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-revalidate-1',
      idempotencyKey: 'idem-revalidate-1',
      reviewContextId: item!.reviewContextId,
      contextRevision: item!.contextRevision,
      reason: 'Re-review after source change.',
    });
    expect(revalidated.context.contextRevision).toBe(2);
    expect(revalidated.context.reviewContextId).toBe(item!.reviewContextId);
  });

  it('marks a context stale when the source target changes', async () => {
    const { coordinator, draftRepository } = buildCoordinator();
    const draft = createSubmittedDraft();
    draftRepository.drafts.set('project-1:draft-1', draft);
    const queue = await coordinator.listReviewQueue(scope, {
      schemaVersion: '1.0.0',
      pageSize: 50,
    });
    const item = queue.items.find(
      (candidate) => candidate.targetKind === 'KNOWLEDGE_DRAFT_CHANGE_SET',
    );
    // Simulate a source change: new revision with a new digest.
    const changedDraft = { ...draft, revision: 2, updatedAt: '2026-08-04T11:00:00.000Z' };
    changedDraft.reviewResource = { ...draft.reviewResource!, draftRevision: 2, digest: 'changed' };
    changedDraft.reviewSubmission = {
      ...draft.reviewSubmission!,
      contentDigest: 'changed',
      reviewResource: { ...draft.reviewResource!, draftRevision: 2, digest: 'changed' },
    };
    draftRepository.drafts.set('project-1:draft-1', changedDraft);
    const read = await coordinator.getReviewContext(scope, {
      schemaVersion: '1.0.0',
      reviewContextId: item!.reviewContextId,
      contextRevision: item!.contextRevision,
    });
    expect(read.context.aggregateState).toBe('STALE');
    expect(read.context.staleReason).toBeDefined();
  });

  it('fails closed when the policy context changed', async () => {
    const { coordinator, draftRepository } = buildCoordinator();
    draftRepository.drafts.set('project-1:draft-1', createSubmittedDraft());
    const queue = await coordinator.listReviewQueue(scope, {
      schemaVersion: '1.0.0',
      pageSize: 50,
    });
    const item = queue.items.find(
      (candidate) => candidate.targetKind === 'KNOWLEDGE_DRAFT_CHANGE_SET',
    );
    const read = await coordinator.getReviewContext(scope, {
      schemaVersion: '1.0.0',
      reviewContextId: item!.reviewContextId,
      contextRevision: item!.contextRevision,
    });
    const itemId = read.context.items[0]!.reviewItemId;
    const changedScope = { ...scope, policyContextRevision: 'policy-2' };
    await expect(
      coordinator.recordReviewDecisions(
        changedScope,
        decisionRequest(read.context, itemId, 'APPROVE', 'Approved.'),
      ),
    ).rejects.toMatchObject({ apiCode: 'REVIEW_POLICY_CHANGED' });
  });

  it('fails closed when the access scope changed', async () => {
    const { coordinator, draftRepository } = buildCoordinator();
    draftRepository.drafts.set('project-1:draft-1', createSubmittedDraft());
    const queue = await coordinator.listReviewQueue(scope, {
      schemaVersion: '1.0.0',
      pageSize: 50,
    });
    const item = queue.items.find(
      (candidate) => candidate.targetKind === 'KNOWLEDGE_DRAFT_CHANGE_SET',
    );
    const read = await coordinator.getReviewContext(scope, {
      schemaVersion: '1.0.0',
      reviewContextId: item!.reviewContextId,
      contextRevision: item!.contextRevision,
    });
    const itemId = read.context.items[0]!.reviewItemId;
    const changedScope = { ...scope, accessRevision: 'access-2' };
    await expect(
      coordinator.recordReviewDecisions(
        changedScope,
        decisionRequest(read.context, itemId, 'APPROVE', 'Approved.'),
      ),
    ).rejects.toMatchObject({ apiCode: 'REVIEW_ACCESS_CHANGED' });
  });
});

describe('FE-P4-S1 Review domain — comments and outcome recovery (AC-20)', () => {
  it('appends comments and resolves an unknown outcome by original identity', async () => {
    const { coordinator, draftRepository } = buildCoordinator();
    draftRepository.drafts.set('project-1:draft-1', createSubmittedDraft());
    const queue = await coordinator.listReviewQueue(scope, {
      schemaVersion: '1.0.0',
      pageSize: 50,
    });
    const item = queue.items.find(
      (candidate) => candidate.targetKind === 'KNOWLEDGE_DRAFT_CHANGE_SET',
    );
    const read = await coordinator.getReviewContext(scope, {
      schemaVersion: '1.0.0',
      reviewContextId: item!.reviewContextId,
      contextRevision: item!.contextRevision,
    });
    const itemId = read.context.items[0]!.reviewItemId;

    const comment = await coordinator.addReviewComment(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-comment-1',
      idempotencyKey: 'idem-comment-1',
      reviewContextId: read.context.reviewContextId,
      contextRevision: read.context.contextRevision,
      reviewItemId: itemId,
      comment: 'Please add a second source.',
    });
    expect(comment.comment.text).toBe('Please add a second source.');

    // Replay the same comment command must return the original outcome.
    const replay = await coordinator.addReviewComment(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-comment-1',
      idempotencyKey: 'idem-comment-1',
      reviewContextId: read.context.reviewContextId,
      contextRevision: read.context.contextRevision,
      reviewItemId: itemId,
      comment: 'Please add a second source.',
    });
    expect(replay.comment.commentId).toBe(comment.comment.commentId);

    // Resolve by the original command identity (real semantic digest).
    const digest = frontendReviewAddCommentDigest({
      schemaVersion: '1.0.0',
      clientRequestId: 'client-comment-1',
      idempotencyKey: 'idem-comment-1',
      reviewContextId: read.context.reviewContextId,
      contextRevision: read.context.contextRevision,
      reviewItemId: itemId,
      comment: 'Please add a second source.',
    });
    const resolved = await coordinator.resolveCommandOutcome(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-comment-1',
      idempotencyKey: 'idem-comment-1',
      semanticDigest: digest,
    });
    expect(resolved.outcome).toBe('COMPLETED');
    if (resolved.completed?.commandType === 'frontend.review.add-comment.v1') {
      expect(resolved.completed.result.comment.commentId).toBe(comment.comment.commentId);
    } else {
      throw new Error('expected add-comment outcome');
    }
  });

  it('returns a revision-request return target for a Draft target', async () => {
    const { coordinator, draftRepository } = buildCoordinator();
    draftRepository.drafts.set('project-1:draft-1', createSubmittedDraft());
    const queue = await coordinator.listReviewQueue(scope, {
      schemaVersion: '1.0.0',
      pageSize: 50,
    });
    const item = queue.items.find(
      (candidate) => candidate.targetKind === 'KNOWLEDGE_DRAFT_CHANGE_SET',
    );
    const read = await coordinator.getReviewContext(scope, {
      schemaVersion: '1.0.0',
      reviewContextId: item!.reviewContextId,
      contextRevision: item!.contextRevision,
    });
    const itemId = read.context.items[0]!.reviewItemId;
    const result = await coordinator.recordReviewDecisions(
      scope,
      decisionRequest(read.context, itemId, 'REQUEST_REVISION', 'Please rework.'),
    );
    expect(result.revisionRequestReturnTarget?.workspace).toBe('KNOWLEDGE_EDITOR');
    expect(result.revisionRequestReturnTarget?.draftId).toBe('draft-1');
  });
});
