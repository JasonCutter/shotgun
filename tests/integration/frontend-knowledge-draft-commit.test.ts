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
  type FrontendKnowledgeDraftEvidenceReaderPort,
} from '../../modules/frontend-knowledge-draft/src/product-api.js';
import {
  frontendKnowledgeDraftDiscoveryRelationSemanticV1,
  frontendKnowledgeDraftOperationDigestV1,
  frontendKnowledgeDraftRevisionDigest,
} from '../../modules/frontend-knowledge-draft/src/index.js';
import {
  canonicalSnapshotDigest,
  reviewApprovalManifestDigest,
  sha256Text,
  type ApprovalPurposeV1,
  type FrontendCanonicalCommitWrite,
  type EvidenceSpan,
  type FrontendKnowledgeDraftBaseV1,
  type FrontendKnowledgeDraftChangeSetV1,
  type FrontendKnowledgeOperationV1,
  type RelationDraftValueV2,
  type ReviewApprovalV1,
} from '../../packages/contracts/src/index.js';

const PROJECT_ID = 'project-1';

const evidenceSpan = (overrides: Partial<EvidenceSpan> = {}): EvidenceSpan => ({
  evidenceId: 'span-1',
  revisionId: 'revision-1',
  projectId: PROJECT_ID,
  sourceId: 'source-1',
  sourceVersionId: 'source-version-1',
  pointer: '/paragraphs/0',
  nodeKind: 'paragraph',
  origin: 'source',
  position: { type: 'TextPositionSelector', start: 0, end: 4, unit: 'unicode-code-point' },
  quote: { type: 'TextQuoteSelector', exact: 'claim' },
  exactHash: sha256Text('claim'),
  accessScope: ['owner'],
  sensitivity: 'private',
  createdAt: '2026-08-09T00:00:00.000Z',
  ...overrides,
});

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

const claimOperation = (
  overrides: Partial<FrontendKnowledgeOperationV1> = {},
): FrontendKnowledgeOperationV1 =>
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
  after: {
    schemaVersion: 'no-op-review-result.v1',
    result: 'NO_CHANGE_REQUIRED',
    reason: 'No change.',
  },
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

type RelationOperation = Extract<FrontendKnowledgeOperationV1, { readonly kind: 'RELATION_ADD' }>;

const relationOperation = (): RelationOperation => {
  const after = {
    schemaVersion: 'relation.v2' as const,
    relationType: 'RELATED_TO',
    fromEndpoint: {
      projectId: PROJECT_ID,
      authority: 'APPROVED_KNOWLEDGE' as const,
      resourceType: 'ENTITY' as const,
      resourceId: 'entity:a',
      resourceRevision: 1,
    },
    toEndpoint: {
      projectId: PROJECT_ID,
      authority: 'APPROVED_KNOWLEDGE' as const,
      resourceType: 'ENTITY' as const,
      resourceId: 'entity:b',
      resourceRevision: 1,
    },
    direction: 'DIRECTED' as const,
    rationale: 'The reviewed Discovery relation.',
  };
  const operation = {
    operationId: 'operation-relation-1',
    kind: 'RELATION_ADD' as const,
    target: { targetType: 'RELATION' as const, resourceId: 'review-resource-1' },
    baseRevision: 0,
    rationale: after.rationale,
    evidenceReferences: [
      { sourceId: 'source-1', sourceVersionId: 'source-version-1', evidenceSpanId: 'span-1' },
    ],
    expectedImpact: { summary: 'One relation is added.' },
    operationRevision: 1,
    contentDigest: '',
    after,
  } satisfies RelationOperation;
  return { ...operation, contentDigest: frontendKnowledgeDraftOperationDigestV1(operation) };
};

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
  let evidenceReader: FrontendKnowledgeDraftEvidenceReaderPort;
  let coordinator: FrontendKnowledgeDraftProductCoordinator;

  const approvalPort = (): FrontendKnowledgeDraftCommitDependenciesV1['approvals'] => ({
    findByIdWithRevision: async (approvalId) =>
      reviewStore.transaction((repositories) =>
        repositories.approvals.findByIdWithRevision(approvalId),
      ),
    consumeApproval: async (approvalId, canonicalCommitId, consumedAt, consumedBy) =>
      reviewStore.transaction((repositories) =>
        repositories.approvals.consumeApproval(
          approvalId,
          canonicalCommitId,
          consumedAt,
          consumedBy,
        ),
      ),
  });

  const makeCoordinator = (
    input: {
      readonly gateway?: InMemoryFrontendCommandGateway;
      readonly approvals?: FrontendKnowledgeDraftCommitDependenciesV1['approvals'];
      readonly canonical?: FrontendKnowledgeDraftCommitDependenciesV1['canonical'];
      readonly evidence?: FrontendKnowledgeDraftCommitDependenciesV1['evidence'];
    } = {},
  ): FrontendKnowledgeDraftProductCoordinator =>
    new FrontendKnowledgeDraftProductCoordinator(
      draftRepository,
      input.gateway ?? new InMemoryFrontendCommandGateway(),
      new InMemoryFrontendKnowledgeDraftTargetResolver(),
      {
        approvals: input.approvals ?? approvalPort(),
        canonical: input.canonical ?? canonicalRepository,
        evidence: input.evidence ?? evidenceReader,
      },
    );

  beforeEach(() => {
    draftRepository = new InMemoryFrontendKnowledgeDraftRepository();
    canonicalRepository = new InMemoryCanonicalKnowledgeRepository();
    reviewStore = new InMemoryFrontendReviewStore();
    evidenceReader = {
      findById: async (projectId, evidenceId) =>
        projectId === PROJECT_ID && evidenceId === 'span-1' ? evidenceSpan() : undefined,
    };
    coordinator = new FrontendKnowledgeDraftProductCoordinator(
      draftRepository,
      new InMemoryFrontendCommandGateway(),
      new InMemoryFrontendKnowledgeDraftTargetResolver(),
      {
        approvals: approvalPort(),
        canonical: canonicalRepository,
        evidence: evidenceReader,
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

  it('inherits Evidence visibility when the caller has broader capabilities', async () => {
    const draft = submittedDraft([claimOperation()]);
    await seed({ draft, approval: approvalFor({ draft, approvedItemIds: ['item-1'] }) });

    const broadScope = { ...scope, accessScope: ['owner', 'project:action:rollback'] };
    const writes: FrontendCanonicalCommitWrite[] = [];
    const broadCoordinator = makeCoordinator({
      canonical: {
        getSnapshot: (projectId) => canonicalRepository.getSnapshot(projectId),
        commitFrontendDraft: async (write) => {
          writes.push(write);
          return canonicalRepository.commitFrontendDraft(write);
        },
        findCommit: (projectId, commitId) => canonicalRepository.findCommit(projectId, commitId),
      },
    });
    const result = await broadCoordinator.commitFrontendDraft(broadScope, request());

    expect(result.outcome).toBe('COMPLETED');
    const claimWrite = writes[0];
    expect(claimWrite?.operation).toBe('ADD_CLAIM');
    if (claimWrite?.operation !== 'ADD_CLAIM') throw new Error('Expected an ADD_CLAIM write.');
    expect(claimWrite.accessScope).toEqual(['owner']);
    expect(claimWrite.sensitivity).toBe('private');
    expect(claimWrite.accessScope).not.toContain('project:action:rollback');
  });

  it('fails closed when the caller lacks a referenced Evidence scope', async () => {
    const draft = submittedDraft([claimOperation()]);
    await seed({ draft, approval: approvalFor({ draft, approvedItemIds: ['item-1'] }) });
    const inaccessibleEvidenceReader: FrontendKnowledgeDraftEvidenceReaderPort = {
      findById: async () => evidenceSpan({ accessScope: ['restricted-scope'] }),
    };

    const failingCoordinator = makeCoordinator({ evidence: inaccessibleEvidenceReader });
    await expect(failingCoordinator.commitFrontendDraft(scope, request())).rejects.toMatchObject({
      apiCode: 'FORBIDDEN',
    });
    expect((await canonicalRepository.getSnapshot(PROJECT_ID)).claims).toHaveLength(0);
  });

  it('fails closed when referenced Evidence scopes or sensitivities are mixed', async () => {
    const operation = claimOperation({
      evidenceReferences: [
        { sourceId: 'source-1', sourceVersionId: 'source-version-1', evidenceSpanId: 'span-1' },
        { sourceId: 'source-1', sourceVersionId: 'source-version-1', evidenceSpanId: 'span-2' },
      ],
    });
    const draft = submittedDraft([operation]);
    await seed({ draft, approval: approvalFor({ draft, approvedItemIds: ['item-1'] }) });
    const mixedEvidenceReader: FrontendKnowledgeDraftEvidenceReaderPort = {
      findById: async (_projectId, evidenceId) =>
        evidenceId === 'span-1'
          ? evidenceSpan()
          : evidenceSpan({ evidenceId: 'span-2', accessScope: ['owner'], sensitivity: 'internal' }),
    };

    const failingCoordinator = makeCoordinator({ evidence: mixedEvidenceReader });
    await expect(failingCoordinator.commitFrontendDraft(scope, request())).rejects.toMatchObject({
      apiCode: 'VALIDATION_FAILED',
    });
    expect((await canonicalRepository.getSnapshot(PROJECT_ID)).claims).toHaveLength(0);
  });

  it('fails closed when Evidence crosses the active Project or source identity', async () => {
    const draft = submittedDraft([claimOperation()]);
    await seed({ draft, approval: approvalFor({ draft, approvedItemIds: ['item-1'] }) });
    const mismatchedEvidenceReader: FrontendKnowledgeDraftEvidenceReaderPort = {
      findById: async () => evidenceSpan({ projectId: 'project-2' }),
    };

    const failingCoordinator = makeCoordinator({ evidence: mismatchedEvidenceReader });
    await expect(failingCoordinator.commitFrontendDraft(scope, request())).rejects.toMatchObject({
      apiCode: 'VALIDATION_FAILED',
    });
    expect((await canonicalRepository.getSnapshot(PROJECT_ID)).claims).toHaveLength(0);
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

  it('rejects a browser-injected relation.v2 Save without server Discovery provenance', async () => {
    const draft = submittedDraft([]);
    await seed({ draft, approval: approvalFor({ draft, approvedItemIds: [] }) });
    const operation = {
      ...relationOperation(),
      operationRevision: 2,
    } satisfies RelationOperation;
    const contentDigest = frontendKnowledgeDraftRevisionDigest({
      draftId: draft.draftId,
      revision: 2,
      base: draft.base,
      operations: [operation],
    });

    await expect(
      coordinator.saveDraft(scope, {
        schemaVersion: '1.0.0',
        clientRequestId: 'save-relation-injection',
        idempotencyKey: 'save-relation-injection-key',
        draftId: draft.draftId,
        expectedDraftRevision: draft.revision,
        expectedBaseRevision: draft.base.canonicalVersion,
        operationRevision: 2,
        operations: [operation],
        contentDigest,
      }),
    ).rejects.toMatchObject({ apiCode: 'UNSUPPORTED_OPERATION' });
    await expect(
      draftRepository.transaction((repositories) =>
        repositories.drafts.findById(PROJECT_ID, draft.draftId),
      ),
    ).resolves.toMatchObject({ revision: 1, operations: [] });
  });

  it('does not let a browser mutate an already materialized Discovery relation', async () => {
    const operation = relationOperation();
    const provenance = {
      schemaVersion: 'discovery-draft-provenance.v1' as const,
      finding: { projectId: PROJECT_ID, findingId: 'finding-1', findingRevision: 1 },
      reentry: { manifestId: 'manifest-1', candidateId: 'candidate-1', candidateRevision: 1 },
      review: {
        reviewContextId: 'context-1',
        contextRevision: 1,
        reviewResourceId: 'review-resource-1',
        reviewResourceRevision: 1,
        resourceDigest: 'sha256:review-resource',
      },
      validation: {
        artifactId: 'validation-1',
        artifactRevision: '1',
        digest: 'sha256:validation',
      },
      canonicalBase: { canonicalVersion: 0, snapshotDigest: base().canonicalSnapshotDigest },
      sourceProjectionDigest: 'sha256:source-projection',
      evidenceLineage: [
        {
          evidenceId: 'evidence-1',
          sourceId: 'source-1',
          sourceVersionId: 'source-version-1',
          evidenceSpanId: 'span-1',
        },
      ],
      approvedEntityRefs: [
        (operation.after as RelationDraftValueV2).fromEndpoint,
        (operation.after as RelationDraftValueV2).toEndpoint,
      ],
      derivationProvenance: { schemaVersion: '1.0.0', kind: 'DETERMINISTIC' },
      bridgeVersion: 'adr-152.wp2a.v1' as const,
      materializationId: 'materialization-1',
    };
    const materialized = {
      ...submittedDraft([operation]),
      discoveryProvenance: provenance,
    };
    await draftRepository.transaction((repositories) => repositories.drafts.insert(materialized));
    expect(frontendKnowledgeDraftDiscoveryRelationSemanticV1(materialized.operations[0]!)).toEqual(
      frontendKnowledgeDraftDiscoveryRelationSemanticV1(operation),
    );
    const mutated = {
      ...operation,
      operationRevision: materialized.revision + 1,
      after: {
        ...(operation.after as RelationDraftValueV2),
        toEndpoint: {
          ...(operation.after as RelationDraftValueV2).toEndpoint,
          resourceId: 'entity:c',
        },
      },
      contentDigest: 'sha256:browser-forged',
    };
    await expect(
      coordinator.saveDraft(scope, {
        schemaVersion: '1.0.0',
        clientRequestId: 'save-relation-mutation',
        idempotencyKey: 'save-relation-mutation-key',
        draftId: materialized.draftId,
        expectedDraftRevision: materialized.revision,
        expectedBaseRevision: materialized.base.canonicalVersion,
        operationRevision: materialized.revision + 1,
        operations: [mutated],
        contentDigest: frontendKnowledgeDraftRevisionDigest({
          draftId: materialized.draftId,
          revision: materialized.revision + 1,
          base: materialized.base,
          operations: [mutated],
        }),
      }),
    ).rejects.toMatchObject({ apiCode: 'VALIDATION_FAILED' });
  });

  it('rejects fail-closed when the Approval covers multiple CLAIM_ADD operations', async () => {
    const draft = submittedDraft([
      claimOperation(),
      claimOperation({
        operationId: 'operation-claim-2',
        after: { schemaVersion: 'claim.v1', statement: 'Second claim.' },
      }),
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
      commitFrontendDraft: async (
        write: Parameters<typeof canonicalRepository.commitFrontendDraft>[0],
      ) => {
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
