import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryFrontendKnowledgeDraftRepository } from '../../adapters/frontend-knowledge-draft-in-memory/src/index.js';
import { InMemoryFrontendKnowledgeDraftTargetResolver } from '../../adapters/frontend-knowledge-draft-api-in-memory/src/index.js';
import { InMemoryFrontendCommandGateway } from '../../adapters/frontend-command-gateway-in-memory/src/index.js';
import { InMemoryFrontendReviewStore } from '../../adapters/frontend-review-in-memory/src/index.js';
import { InMemoryCanonicalKnowledgeRepository } from '../../adapters/stage6-in-memory/src/index.js';
import type { CompleteFrontendCommandInput } from '../../modules/frontend-command-gateway/src/index.js';
import {
  FrontendKnowledgeDraftProductCoordinator,
  type FrontendKnowledgeDraftCommitDependenciesV1,
} from '../../modules/frontend-knowledge-draft/src/product-api.js';
import { frontendKnowledgeDraftRevisionDigest } from '../../modules/frontend-knowledge-draft/src/index.js';
import {
  canonicalSnapshotDigest,
  reviewApprovalManifestDigest,
  type ApprovalPurposeV1,
  type FrontendKnowledgeDraftBaseV1,
  type FrontendKnowledgeDraftChangeSetV1,
  type FrontendKnowledgeOperationV1,
  type ReviewApprovalV1,
} from '../../packages/contracts/src/index.js';

const PROJECT_ID = 'project-1';

const base = (): FrontendKnowledgeDraftBaseV1 => ({
  resourceProjectId: PROJECT_ID,
  canonicalSnapshotId: 'snapshot-0',
  canonicalVersion: 0,
  canonicalSnapshotDigest: canonicalSnapshotDigest(PROJECT_ID, 0, []),
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  sourceLineage: [
    { sourceId: 'source-1', sourceVersionId: 'source-version-1', evidenceSpanIds: ['span-1'] },
  ],
  revisionIdentityKind: 'RESOURCE_REVISION',
  canonicalResourceId: 'canonical-resource-1',
  canonicalRevisionId: 'canonical-revision-0',
});

const claimOperation = (overrides: Partial<FrontendKnowledgeOperationV1> = {}): FrontendKnowledgeOperationV1 =>
  ({
    operationId: 'operation-claim-1',
    kind: 'CLAIM_ADD',
    target: { targetType: 'CLAIM', resourceId: 'resource-1' },
    baseRevision: 0,
    rationale: 'The reviewed answer claim.',
    evidenceReferences: [
      { sourceId: 'source-1', sourceVersionId: 'source-version-1', evidenceSpanId: 'span-1' },
    ],
    expectedImpact: { summary: 'One claim is added to Canonical.' },
    operationRevision: 1,
    contentDigest: 'sha256:operation-claim-1',
    after: { schemaVersion: 'claim.v1', statement: 'The reviewed claim is canonical.' },
    ...overrides,
  }) as FrontendKnowledgeOperationV1;

const noOpOperation = (): FrontendKnowledgeOperationV1 => ({
  operationId: 'operation-noop-1',
  kind: 'NO_OP',
  target: { targetType: 'REVIEW_RESULT', resourceId: 'resource-1' },
  baseRevision: 0,
  rationale: 'The reviewed change requires no Canonical mutation.',
  evidenceReferences: [],
  expectedImpact: { summary: 'No canonical mutation.' },
  operationRevision: 1,
  contentDigest: 'sha256:operation-noop-1',
  after: { schemaVersion: 'no-op-review-result.v1', result: 'NO_CHANGE_REQUIRED', reason: 'No change.' },
});

const factOperation = (): FrontendKnowledgeOperationV1 => ({
  operationId: 'operation-fact-1',
  kind: 'FACT_ADD',
  target: { targetType: 'FACT', resourceId: 'resource-1' },
  baseRevision: 0,
  rationale: 'A fact with no Canonical representation.',
  evidenceReferences: [
    { sourceId: 'source-1', sourceVersionId: 'source-version-1', evidenceSpanId: 'span-1' },
  ],
  expectedImpact: { summary: 'One fact is added.' },
  operationRevision: 1,
  contentDigest: 'sha256:operation-fact-1',
  after: {
    schemaVersion: 'fact.v1',
    subjectRef: 'entity-1',
    predicate: 'status',
    value: 'active',
  },
});

const submittedDraft = (
  operations: readonly FrontendKnowledgeOperationV1[],
): FrontendKnowledgeDraftChangeSetV1 => {
  const draftBase = base();
  const contentDigest = frontendKnowledgeDraftRevisionDigest({
    draftId: 'draft-1',
    revision: 1,
    base: draftBase,
    operations,
  });
  const reviewResourceId = 'review-resource-1';
  return {
    schemaVersion: '1.0.0',
    draftId: 'draft-1',
    startMode: 'SEED_MATERIALIZATION',
    status: 'SUBMITTED',
    revision: 1,
    activeProjectId: PROJECT_ID,
    resourceProjectId: PROJECT_ID,
    draftProjectId: PROJECT_ID,
    effectiveProjectId: PROJECT_ID,
    resourceId: 'resource-1',
    base: draftBase,
    operations,
    contentDigest,
    reviewSubmission: {
      reviewSubmissionId: 'review-submission-1',
      draftId: 'draft-1',
      draftRevision: 1,
      operationDigest: contentDigest,
      contentDigest,
      validationArtifact: {
        artifactId: 'validation-1',
        artifactRevision: 1,
        digest: 'sha256:validation',
        status: 'COMPLETE',
        projectPolicyContext: {
          activeProjectId: PROJECT_ID,
          resourceProjectId: PROJECT_ID,
          draftProjectId: PROJECT_ID,
          effectiveProjectId: PROJECT_ID,
          accessRevision: 'access-1',
          policyContextRevision: 'policy-1',
        },
      },
      impactArtifact: {
        artifactId: 'impact-1',
        artifactRevision: 1,
        digest: 'sha256:impact',
        status: 'COMPLETE',
        projectPolicyContext: {
          activeProjectId: PROJECT_ID,
          resourceProjectId: PROJECT_ID,
          draftProjectId: PROJECT_ID,
          effectiveProjectId: PROJECT_ID,
          accessRevision: 'access-1',
          policyContextRevision: 'policy-1',
        },
      },
      evidenceLineage: [],
      projectPolicyContext: {
        activeProjectId: PROJECT_ID,
        resourceProjectId: PROJECT_ID,
        draftProjectId: PROJECT_ID,
        effectiveProjectId: PROJECT_ID,
        accessRevision: 'access-1',
        policyContextRevision: 'policy-1',
      },
      reviewResource: {
        reviewResourceId,
        draftId: 'draft-1',
        draftRevision: 1,
        resourceProjectId: PROJECT_ID,
        draftProjectId: PROJECT_ID,
        effectiveProjectId: PROJECT_ID,
        policyContextRevision: 'policy-1',
        digest: contentDigest,
      },
    },
    createdAt: '2026-08-09T00:00:00.000Z',
    updatedAt: '2026-08-09T00:00:00.000Z',
  };
};

const approvalFor = (input: {
  readonly draft: FrontendKnowledgeDraftChangeSetV1;
  readonly approvedItemIds: readonly string[];
  readonly status?: ReviewApprovalV1['status'];
  readonly purpose?: ApprovalPurposeV1;
  readonly expiresAt?: string;
}): ReviewApprovalV1 => {
  const purpose = input.purpose ?? 'KNOWLEDGE_CANONICAL_CHANGE';
  const targetRevision = String(input.draft.revision);
  const targetDigest = input.draft.reviewSubmission!.contentDigest;
  return {
    schemaVersion: '1.0.0',
    approvalId: 'approval-1',
    purpose,
    reviewContextId: 'context-1',
    contextRevision: 1,
    targetKind: 'KNOWLEDGE_DRAFT_CHANGE_SET',
    targetId: input.draft.draftId,
    targetRevision,
    targetDigest,
    approvedItemIds: [...input.approvedItemIds],
    approvedManifestDigest: reviewApprovalManifestDigest({
      approvedItemIds: input.approvedItemIds,
      reviewContextId: 'context-1',
      contextRevision: 1,
      targetRevision,
      targetDigest,
      purpose,
    }),
    actor: { schemaVersion: '1.0.0', principalId: 'reviewer-1', actorId: 'reviewer-1' },
    projectId: PROJECT_ID,
    accessRevision: 'access-1',
    policyContextRevision: 'policy-1',
    reason: 'Review approval for Canonical commit.',
    issuedAt: '2026-08-09T00:00:00.000Z',
    expiresAt: input.expiresAt ?? '2099-01-01T00:00:00.000Z',
    status: input.status ?? 'ACTIVE',
  };
};

const scope = {
  principalId: 'principal-1',
  sessionId: 'session-1',
  activeProjectId: PROJECT_ID,
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  sensitivityClearance: 'private' as const,
  accessScope: ['owner'],
};

describe('FE-P5-XP Correction B: Approval -> Canonical commit consumer', () => {
  let draftRepository: InMemoryFrontendKnowledgeDraftRepository;
  let canonicalRepository: InMemoryCanonicalKnowledgeRepository;
  let reviewStore: InMemoryFrontendReviewStore;
  let coordinator: FrontendKnowledgeDraftProductCoordinator;

  const approvalPort = (): FrontendKnowledgeDraftCommitDependenciesV1['approvals'] => ({
    findByIdWithRevision: async (approvalId) =>
      reviewStore.transaction((repositories) => repositories.approvals.findByIdWithRevision(approvalId)),
    consumeApproval: async (approvalId, canonicalCommitId, consumedAt, consumedBy) =>
      reviewStore.transaction((repositories) =>
        repositories.approvals.consumeApproval(approvalId, canonicalCommitId, consumedAt, consumedBy),
      ),
  });

  const makeCoordinator = (input: {
    readonly gateway?: InMemoryFrontendCommandGateway;
    readonly approvals?: FrontendKnowledgeDraftCommitDependenciesV1['approvals'];
    readonly canonical?: FrontendKnowledgeDraftCommitDependenciesV1['canonical'];
  } = {}): FrontendKnowledgeDraftProductCoordinator =>
    new FrontendKnowledgeDraftProductCoordinator(
      draftRepository,
      input.gateway ?? new InMemoryFrontendCommandGateway(),
      new InMemoryFrontendKnowledgeDraftTargetResolver(),
      {
        approvals: input.approvals ?? approvalPort(),
        canonical: input.canonical ?? canonicalRepository,
      },
    );

  beforeEach(() => {
    draftRepository = new InMemoryFrontendKnowledgeDraftRepository();
    canonicalRepository = new InMemoryCanonicalKnowledgeRepository();
    reviewStore = new InMemoryFrontendReviewStore();
    coordinator = new FrontendKnowledgeDraftProductCoordinator(
      draftRepository,
      new InMemoryFrontendCommandGateway(),
      new InMemoryFrontendKnowledgeDraftTargetResolver(),
      {
        approvals: approvalPort(),
        canonical: canonicalRepository,
      },
    );
  });

  const seed = async (input: {
    readonly draft: FrontendKnowledgeDraftChangeSetV1;
    readonly approval: ReviewApprovalV1;
  }) => {
    await draftRepository.transaction((repositories) => repositories.drafts.insert(input.draft));
    await reviewStore.transaction((repositories) => repositories.approvals.insert(input.approval));
  };

  const request = (overrides: Partial<Record<string, unknown>> = {}) => ({
    schemaVersion: '1.0.0' as const,
    clientRequestId: 'client-1',
    idempotencyKey: 'idem-1',
    draftId: 'draft-1',
    approvalId: 'approval-1',
    expectedApprovalRevision: 1,
    ...overrides,
  });

  it('commits a CLAIM_ADD approval to Canonical and consumes the Approval', async () => {
    const draft = submittedDraft([claimOperation()]);
    await seed({ draft, approval: approvalFor({ draft, approvedItemIds: ['item-1'] }) });

    const result = await coordinator.commitFrontendDraft(scope, request());
    expect(result.outcome).toBe('COMPLETED');
    expect(result.commitIds).toHaveLength(1);

    const snapshot = await canonicalRepository.getSnapshot(PROJECT_ID);
    expect(snapshot.version).toBe(1);
    expect(snapshot.claims[0]?.claimId).toBe('claim:operation-claim-1');
    expect(snapshot.claims[0]?.text).toBe('The reviewed claim is canonical.');

    const approval = await reviewStore.transaction((repositories) =>
      repositories.approvals.findById('approval-1'),
    );
    expect(approval?.status).toBe('CONSUMED');
    expect(approval?.invalidationReason).toContain(result.commitIds[0]);
  });

  it('is idempotent on replay: same request returns the same commit identity', async () => {
    const draft = submittedDraft([claimOperation()]);
    await seed({ draft, approval: approvalFor({ draft, approvedItemIds: ['item-1'] }) });

    const first = await coordinator.commitFrontendDraft(scope, request());
    const replay = await coordinator.commitFrontendDraft(scope, request());
    expect(replay.outcome).toBe('COMPLETED');
    expect(replay.commitIds).toEqual(first.commitIds);
    const snapshot = await canonicalRepository.getSnapshot(PROJECT_ID);
    expect(snapshot.claims).toHaveLength(1);
  });

  it('commits a NO_OP approval without a canonical claim', async () => {
    const draft = submittedDraft([noOpOperation()]);
    await seed({ draft, approval: approvalFor({ draft, approvedItemIds: ['item-1'] }) });

    const result = await coordinator.commitFrontendDraft(scope, request());
    expect(result.outcome).toBe('COMPLETED');
    const snapshot = await canonicalRepository.getSnapshot(PROJECT_ID);
    expect(snapshot.version).toBe(0);
    expect(snapshot.claims).toHaveLength(0);
    const approval = await reviewStore.transaction((repositories) =>
      repositories.approvals.findById('approval-1'),
    );
    expect(approval?.status).toBe('CONSUMED');
  });

  it('rejects fail-closed when the Approval is not ACTIVE and leaves it unconsumed', async () => {
    const draft = submittedDraft([claimOperation()]);
    await seed({
      draft,
      approval: approvalFor({ draft, approvedItemIds: ['item-1'], status: 'CONSUMED' }),
    });
    await expect(coordinator.commitFrontendDraft(scope, request())).rejects.toMatchObject({
      apiCode: 'REVIEW_APPROVAL_EXPIRED',
    });
    const snapshot = await canonicalRepository.getSnapshot(PROJECT_ID);
    expect(snapshot.version).toBe(0);
  });

  it('rejects fail-closed on an unmappable approved operation (FACT_ADD)', async () => {
    const draft = submittedDraft([factOperation()]);
    await seed({ draft, approval: approvalFor({ draft, approvedItemIds: ['item-1'] }) });
    await expect(coordinator.commitFrontendDraft(scope, request())).rejects.toMatchObject({
      apiCode: 'UNSUPPORTED_OPERATION',
    });
    const snapshot = await canonicalRepository.getSnapshot(PROJECT_ID);
    expect(snapshot.version).toBe(0);
    const approval = await reviewStore.transaction((repositories) =>
      repositories.approvals.findById('approval-1'),
    );
    expect(approval?.status).toBe('ACTIVE');
  });

  it('rejects fail-closed when the Approval covers multiple CLAIM_ADD operations', async () => {
    const draft = submittedDraft([
      claimOperation(),
      claimOperation({ operationId: 'operation-claim-2', after: { schemaVersion: 'claim.v1', statement: 'Second claim.' } }),
    ]);
    await seed({ draft, approval: approvalFor({ draft, approvedItemIds: ['item-1', 'item-2'] }) });
    await expect(coordinator.commitFrontendDraft(scope, request())).rejects.toMatchObject({
      apiCode: 'UNSUPPORTED_OPERATION',
    });
    const snapshot = await canonicalRepository.getSnapshot(PROJECT_ID);
    expect(snapshot.version).toBe(0);
  });

  it('rejects fail-closed with STALE_APPROVAL when the Canonical snapshot moved', async () => {
    const draft = submittedDraft([claimOperation()]);
    await seed({ draft, approval: approvalFor({ draft, approvedItemIds: ['item-1'] }) });
    // Advance canonical independently of the draft base (a real claim changes
    // the snapshot version and digest).
    await canonicalRepository.commitFrontendDraft({
      commitId: crypto.randomUUID(),
      revisionId: `revision:${crypto.randomUUID()}`,
      historyEventId: `history:${crypto.randomUUID()}`,
      outboxId: `outbox:${crypto.randomUUID()}`,
      projectId: PROJECT_ID,
      operation: 'ADD_CLAIM',
      claimId: 'claim-other',
      claimText: 'An independent canonical claim.',
      sourceVersionId: 'source-version-other',
      evidenceIds: ['evidence-other'],
      accessScope: ['owner'],
      sensitivity: 'private',
      expectedCanonicalVersion: 0,
      snapshotDigest: canonicalSnapshotDigest(PROJECT_ID, 0, []),
      authority: {
        kind: 'FRONTEND_REVIEW_APPROVAL',
        approvalId: 'approval-other',
        approvalBindingDigest: 'sha256:other',
        reviewContextId: 'context-other',
        contextRevision: 1,
        draftId: 'draft-other',
        draftRevision: 1,
        draftContentDigest: 'sha256:other',
        approvedItemIds: [],
      },
      reason: 'independent change',
      actor: { type: 'user', id: 'other' },
      committedAt: '2026-08-09T00:00:00.000Z',
    });
    await expect(coordinator.commitFrontendDraft(scope, request())).rejects.toMatchObject({
      apiCode: 'STALE_APPROVAL',
    });
  });

  it('rejects fail-closed on an Approval binding digest mismatch', async () => {
    const draft = submittedDraft([claimOperation()]);
    const approval = approvalFor({ draft, approvedItemIds: ['item-1'] });
    await seed({
      draft,
      approval: { ...approval, approvedManifestDigest: 'sha256:forged' },
    });
    await expect(coordinator.commitFrontendDraft(scope, request())).rejects.toMatchObject({
      apiCode: 'DIGEST_MISMATCH',
    });
    const snapshot = await canonicalRepository.getSnapshot(PROJECT_ID);
    expect(snapshot.version).toBe(0);
  });

  it('recovers a commit→consume crash without a duplicate commit (GPT Round 2 #1-A)', async () => {
    const draft = submittedDraft([claimOperation()]);
    await seed({ draft, approval: approvalFor({ draft, approvedItemIds: ['item-1'] }) });
    let consumeFails = true;
    const coordinatorA = makeCoordinator({
      approvals: {
        findByIdWithRevision: approvalPort().findByIdWithRevision,
        consumeApproval: async (approvalId, canonicalCommitId, consumedAt, consumedBy) => {
          if (consumeFails) {
            consumeFails = false;
            throw new Error('simulated crash after durable canonical commit');
          }
          return reviewStore.transaction((repositories) =>
            repositories.approvals.consumeApproval(
              approvalId,
              canonicalCommitId,
              consumedAt,
              consumedBy,
            ),
          );
        },
      },
    });
    // First attempt: durable commit succeeds, consume crashes.
    await expect(coordinatorA.commitFrontendDraft(scope, request())).rejects.toThrow();
    const historyAfterCrash = await canonicalRepository.listHistory(PROJECT_ID);
    expect(historyAfterCrash).toHaveLength(1);
    const firstCommitId = historyAfterCrash[0]!.commitId;
    const approvalAfterCrash = await reviewStore.transaction((repositories) =>
      repositories.approvals.findById('approval-1'),
    );
    expect(approvalAfterCrash?.status).toBe('ACTIVE');
    // Retry with the SAME request: recovery completes the original command with
    // the SAME commit only, then consumes the Approval.
    const recovered = await coordinatorA.commitFrontendDraft(scope, request());
    expect(recovered.outcome).toBe('COMPLETED');
    expect(recovered.commitIds).toEqual([firstCommitId]);
    expect(await canonicalRepository.listHistory(PROJECT_ID)).toHaveLength(1);
    expect((await canonicalRepository.getSnapshot(PROJECT_ID)).claims).toHaveLength(1);
    const approval = await reviewStore.transaction((repositories) =>
      repositories.approvals.findById('approval-1'),
    );
    expect(approval?.status).toBe('CONSUMED');
  });

  it('recovers a consume→ledger-complete crash accepting an already-CONSUMED approval (GPT Round 2 #1-B)', async () => {
    const draft = submittedDraft([claimOperation()]);
    await seed({ draft, approval: approvalFor({ draft, approvedItemIds: ['item-1'] }) });
    class FailingCompleteGateway extends InMemoryFrontendCommandGateway {
      failOnce = true;
      override async completeInTransaction(
        transaction: unknown,
        input: CompleteFrontendCommandInput,
      ) {
        if (this.failOnce) {
          this.failOnce = false;
          throw new Error('simulated crash before ledger COMPLETED');
        }
        return super.completeInTransaction(transaction, input);
      }
    }
    const coordinatorB = makeCoordinator({ gateway: new FailingCompleteGateway() });
    // First attempt: commit + consume durable, ledger COMPLETED crashes.
    await expect(coordinatorB.commitFrontendDraft(scope, request())).rejects.toThrow();
    const history = await canonicalRepository.listHistory(PROJECT_ID);
    expect(history).toHaveLength(1);
    const firstCommitId = history[0]!.commitId;
    const approvalAfterCrash = await reviewStore.transaction((repositories) =>
      repositories.approvals.findById('approval-1'),
    );
    expect(approvalAfterCrash?.status).toBe('CONSUMED');
    // Retry: recovery accepts the already-CONSUMED (same commit) approval.
    const recovered = await coordinatorB.commitFrontendDraft(scope, request());
    expect(recovered.outcome).toBe('COMPLETED');
    expect(recovered.commitIds).toEqual([firstCommitId]);
    expect(await canonicalRepository.listHistory(PROJECT_ID)).toHaveLength(1);
  });

  it('rejects fail-closed when expectedApprovalRevision does not match the current approval status revision (GPT Round 2 #2)', async () => {
    const draft = submittedDraft([claimOperation()]);
    await seed({ draft, approval: approvalFor({ draft, approvedItemIds: ['item-1'] }) });
    await expect(
      coordinator.commitFrontendDraft(scope, request({ expectedApprovalRevision: 2 })),
    ).rejects.toMatchObject({ apiCode: 'STALE' });
    const snapshot = await canonicalRepository.getSnapshot(PROJECT_ID);
    expect(snapshot.version).toBe(0);
    const approval = await reviewStore.transaction((repositories) =>
      repositories.approvals.findById('approval-1'),
    );
    expect(approval?.status).toBe('ACTIVE');
  });

  it('rejects a CLAIM_ADD without evidence instead of fabricating a sourceVersionId (GPT Round 2 #3)', async () => {
    const draft = submittedDraft([claimOperation({ evidenceReferences: [] })]);
    await seed({ draft, approval: approvalFor({ draft, approvedItemIds: ['item-1'] }) });
    await expect(coordinator.commitFrontendDraft(scope, request())).rejects.toMatchObject({
      apiCode: 'VALIDATION_FAILED',
    });
    const snapshot = await canonicalRepository.getSnapshot(PROJECT_ID);
    expect(snapshot.version).toBe(0);
    const approval = await reviewStore.transaction((repositories) =>
      repositories.approvals.findById('approval-1'),
    );
    expect(approval?.status).toBe('ACTIVE');
  });

  it('rejects multiple evidence source versions in the single-source Canonical model (GPT Round 2 #3)', async () => {
    const draft = submittedDraft([
      claimOperation({
        evidenceReferences: [
          { sourceId: 'source-1', sourceVersionId: 'source-version-1', evidenceSpanId: 'span-1' },
          { sourceId: 'source-2', sourceVersionId: 'source-version-2', evidenceSpanId: 'span-2' },
        ],
      }),
    ]);
    await seed({ draft, approval: approvalFor({ draft, approvedItemIds: ['item-1'] }) });
    await expect(coordinator.commitFrontendDraft(scope, request())).rejects.toMatchObject({
      apiCode: 'UNSUPPORTED_OPERATION',
    });
    const snapshot = await canonicalRepository.getSnapshot(PROJECT_ID);
    expect(snapshot.version).toBe(0);
    const approval = await reviewStore.transaction((repositories) =>
      repositories.approvals.findById('approval-1'),
    );
    expect(approval?.status).toBe('ACTIVE');
  });

  it('fails closed with STALE_APPROVAL when recovery has NO existing commit and Canonical advanced (GPT Round 3 #1)', async () => {
    const draft = submittedDraft([claimOperation()]);
    await seed({ draft, approval: approvalFor({ draft, approvedItemIds: ['item-1'] }) });
    // Canonical dep whose commitFrontendDraft crashes BEFORE any write: the
    // ledger command is left ACCEPTED/OUTCOME_UNKNOWN with NO durable commit.
    let commitFails = true;
    const crashingCanonical = {
      getSnapshot: (projectId: string) => canonicalRepository.getSnapshot(projectId),
      findCommit: (projectId: string, commitId: string) =>
        canonicalRepository.findCommit(projectId, commitId),
      commitFrontendDraft: async (write: Parameters<typeof canonicalRepository.commitFrontendDraft>[0]) => {
        if (commitFails) {
          commitFails = false;
          throw new Error('simulated crash before canonical commit');
        }
        return canonicalRepository.commitFrontendDraft(write);
      },
    };
    const coordinatorC = makeCoordinator({ canonical: crashingCanonical });
    await expect(coordinatorC.commitFrontendDraft(scope, request())).rejects.toThrow();
    // No durable commit for the original approval; Approval still ACTIVE.
    expect(await canonicalRepository.listHistory(PROJECT_ID)).toHaveLength(0);
    // Canonical advances independently of the Draft base.
    await canonicalRepository.commitFrontendDraft({
      commitId: crypto.randomUUID(),
      revisionId: `revision:${crypto.randomUUID()}`,
      historyEventId: `history:${crypto.randomUUID()}`,
      outboxId: `outbox:${crypto.randomUUID()}`,
      projectId: PROJECT_ID,
      operation: 'ADD_CLAIM',
      claimId: 'claim-independent',
      claimText: 'An independent canonical claim.',
      sourceVersionId: 'source-version-independent',
      evidenceIds: ['evidence-independent'],
      accessScope: ['owner'],
      sensitivity: 'private',
      expectedCanonicalVersion: 0,
      snapshotDigest: canonicalSnapshotDigest(PROJECT_ID, 0, []),
      authority: {
        kind: 'FRONTEND_REVIEW_APPROVAL',
        approvalId: 'approval-independent',
        approvalBindingDigest: 'sha256:independent',
        reviewContextId: 'context-independent',
        contextRevision: 1,
        draftId: 'draft-independent',
        draftRevision: 1,
        draftContentDigest: 'sha256:independent',
        approvedItemIds: [],
      },
      reason: 'independent change',
      actor: { type: 'user', id: 'other' },
      committedAt: '2026-08-10T00:00:00.000Z',
    });
    // Retry: recovery finds NO existing commit → full REVALIDATE → the Draft
    // base is stale → STALE_APPROVAL (never a silent rebase onto current).
    await expect(coordinatorC.commitFrontendDraft(scope, request())).rejects.toMatchObject({
      apiCode: 'STALE_APPROVAL',
    });
    expect(await canonicalRepository.listHistory(PROJECT_ID)).toHaveLength(1);
    const approval = await reviewStore.transaction((repositories) =>
      repositories.approvals.findById('approval-1'),
    );
    expect(approval?.status).toBe('ACTIVE');
  });
});
