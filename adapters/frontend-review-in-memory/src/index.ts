import {
  FrontendContractError,
  sha256Text,
  stableJson,
  type CanonicalHistoryEvent,
  type CanonicalRevision,
  type CanonicalSnapshot,
  type ReversalDraftChangeSetV1,
  type ReviewApprovalV1,
  type ReviewCommentRecordV1,
  type ReviewContextRevisionV1,
  type ReviewDecisionRecordV1,
  type ReviewDependencyV1,
  type ReviewEvidenceEntryV1,
  type ReviewImpactEntryV1,
  type ReviewItemV1,
} from '../../../packages/contracts/src/index.js';
import type {
  ReviewRepositoryBoundaryPort,
  ReviewTransactionHandleV1,
  ReviewTransactionRepositoriesV1,
  ReviewContextRecordV1,
} from '../../../modules/frontend-review/src/index.js';
import type {
  FrontendReviewScopeV1,
  ReviewContextMaterializationInputV1,
  ReviewMaterializedContextV1,
  ReviewSourceTargetV1,
  ReviewTargetAdapterPort,
} from '../../../modules/frontend-review/src/index.js';
import { reviewCapabilitiesFor } from '../../../modules/frontend-review/src/index.js';
import {
  computeReversalSnapshotImpact,
  type ReversalSnapshotImpact,
} from '../../../modules/change-set-review/src/index.js';
import type { InMemoryFrontendKnowledgeDraftRepository } from '../../frontend-knowledge-draft-in-memory/src/index.js';
import type { FrontendKnowledgeDraftChangeSetV1 } from '../../../packages/contracts/src/index.js';
import type { FrontendKnowledgeOperationV1 } from '../../../packages/contracts/src/index.js';

/**
 * FE-P4-S1 in-memory Review store and target adapters (ADR-128 parity
 * boundary). Context revisions are immutable, decisions and comments are
 * append-only, and Approval status changes preserve history.
 */

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

export class InMemoryFrontendReviewStore implements ReviewRepositoryBoundaryPort {
  /** reviewContextId -> current context record (updated by revalidation). */
  readonly contextsByResource = new Map<string, ReviewContextRecordV1>();
  /** `${reviewContextId}:${contextRevision}` -> immutable revision. */
  readonly revisions = new Map<string, ReviewContextRevisionV1>();
  readonly decisions: ReviewDecisionRecordV1[] = [];
  readonly comments: ReviewCommentRecordV1[] = [];
  readonly approvals = new Map<string, ReviewApprovalV1>();

  /** Fair FIFO queue serializing every transaction. */
  private tail: Promise<unknown> = Promise.resolve();

  transaction<T>(
    action: (repositories: ReviewTransactionRepositoriesV1) => Promise<T>,
  ): Promise<T> {
    const run = this.tail.then(
      () => this.execute(action),
      () => this.execute(action),
    );
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  transactionWithHandle<T>(action: (handle: ReviewTransactionHandleV1) => Promise<T>): Promise<T> {
    const run = this.tail.then(
      () => this.executeHandle(action),
      () => this.executeHandle(action),
    );
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async execute<T>(
    action: (repositories: ReviewTransactionRepositoriesV1) => Promise<T>,
  ): Promise<T> {
    const contextsByResource = new Map(this.contextsByResource);
    const revisions = new Map(this.revisions);
    const decisions = [...this.decisions];
    const comments = [...this.comments];
    const approvals = new Map(this.approvals);
    try {
      return await action(this.repositories());
    } catch (error) {
      this.restore(contextsByResource, revisions, decisions, comments, approvals);
      throw error;
    }
  }

  private async executeHandle<T>(
    action: (handle: ReviewTransactionHandleV1) => Promise<T>,
  ): Promise<T> {
    const contextsByResource = new Map(this.contextsByResource);
    const revisions = new Map(this.revisions);
    const decisions = [...this.decisions];
    const comments = [...this.comments];
    const approvals = new Map(this.approvals);
    try {
      return await action({ repositories: this.repositories(), raw: undefined });
    } catch (error) {
      this.restore(contextsByResource, revisions, decisions, comments, approvals);
      throw error;
    }
  }

  private restore(
    contextsByResource: Map<string, ReviewContextRecordV1>,
    revisions: Map<string, ReviewContextRevisionV1>,
    decisions: readonly ReviewDecisionRecordV1[],
    comments: readonly ReviewCommentRecordV1[],
    approvals: Map<string, ReviewApprovalV1>,
  ): void {
    this.contextsByResource.clear();
    for (const [key, value] of contextsByResource) this.contextsByResource.set(key, value);
    this.revisions.clear();
    for (const [key, value] of revisions) this.revisions.set(key, value);
    this.decisions.splice(0, this.decisions.length, ...decisions);
    this.comments.splice(0, this.comments.length, ...comments);
    this.approvals.clear();
    for (const [key, value] of approvals) this.approvals.set(key, value);
  }

  private repositories(): ReviewTransactionRepositoriesV1 {
    return {
      contexts: {
        findCurrent: async (reviewContextId) => this.contextsByResource.get(reviewContextId),
        findRevision: async (reviewContextId, contextRevision) =>
          this.revisions.get(`${reviewContextId}:${contextRevision}`),
        insertContext: async (record) => {
          const key = `${record.context.reviewContextId}:${record.context.contextRevision}`;
          if (this.revisions.has(key)) {
            throw new FrontendContractError(
              'CONFLICT',
              `review context revision ${key} already exists`,
            );
          }
          this.revisions.set(key, record.context);
          this.contextsByResource.set(record.context.reviewContextId, record);
        },
        lockCurrent: async (reviewContextId) => this.contextsByResource.get(reviewContextId),
        listContexts: async () => [...this.contextsByResource.values()],
      },
      decisions: {
        findDecisions: async (reviewContextId) =>
          this.decisions.filter((decision) => decision.reviewContextId === reviewContextId),
        appendDecisions: async (newDecisions) => {
          this.decisions.push(...newDecisions);
        },
        findComments: async (reviewContextId) =>
          this.comments.filter((comment) => comment.reviewContextId === reviewContextId),
        appendComment: async (comment) => {
          this.comments.push(comment);
        },
      },
      approvals: {
        findById: async (approvalId) => this.approvals.get(approvalId),
        insert: async (approval) => {
          if (this.approvals.has(approval.approvalId)) {
            throw new FrontendContractError(
              'CONFLICT',
              `approval ${approval.approvalId} already exists`,
            );
          }
          this.approvals.set(approval.approvalId, approval);
        },
        listByProject: async (projectId) =>
          [...this.approvals.values()].filter((approval) => approval.projectId === projectId),
      },
    };
  }
}

// ---------------------------------------------------------------------------
// FE-P3-S2 Review Submission target adapter
// ---------------------------------------------------------------------------

export type ReviewDraftSourceReader = {
  listSubmitted(projectId: string): Promise<readonly FrontendKnowledgeDraftChangeSetV1[]>;
  findSubmitted(
    projectId: string,
    reviewResourceId: string,
  ): Promise<FrontendKnowledgeDraftChangeSetV1 | undefined>;
};

export const createEmptyReviewDraftSourceReader = (): ReviewDraftSourceReader => ({
  async listSubmitted() {
    return [];
  },
  async findSubmitted() {
    return undefined;
  },
});

export const createInMemoryReviewDraftSourceReader = (
  repository: InMemoryFrontendKnowledgeDraftRepository,
): ReviewDraftSourceReader => ({
  async listSubmitted(projectId) {
    return [...repository.drafts.values()].filter(
      (draft) => draft.resourceProjectId === projectId && draft.status === 'SUBMITTED',
    );
  },
  async findSubmitted(projectId, reviewResourceId) {
    return [...repository.drafts.values()].find(
      (draft) =>
        draft.resourceProjectId === projectId &&
        draft.status === 'SUBMITTED' &&
        draft.reviewResource?.reviewResourceId === reviewResourceId,
    );
  },
});

const operationLabel = (operation: FrontendKnowledgeOperationV1): string =>
  `${operation.kind} ${operation.target.targetType}${operation.target.targetId ? ` ${operation.target.targetId}` : ''} on ${operation.target.resourceId}`;

const operationDetail = (operation: FrontendKnowledgeOperationV1): string => {
  const value = operation.after ?? operation.before;
  return value === undefined ? '' : JSON.stringify(value);
};

export class DraftReviewTargetAdapter implements ReviewTargetAdapterPort {
  readonly targetKind = 'KNOWLEDGE_DRAFT_CHANGE_SET' as const;
  readonly sourceItemKind = 'KNOWLEDGE_OPERATION' as const;

  constructor(private readonly reader: ReviewDraftSourceReader) {}

  async listSourceTargets(projectId: string): Promise<readonly ReviewSourceTargetV1[]> {
    const drafts = await this.reader.listSubmitted(projectId);
    const targets: ReviewSourceTargetV1[] = [];
    for (const draft of drafts) {
      const submission = draft.reviewSubmission;
      const reviewResource = draft.reviewResource;
      if (!submission || !reviewResource) continue;
      targets.push({
        reviewResourceId: reviewResource.reviewResourceId,
        targetId: draft.draftId,
        targetRevision: String(draft.revision),
        targetDigest: submission.contentDigest,
        targetLabel: `Knowledge Draft ${draft.draftId} (revision ${draft.revision})`,
        resourceProjectId: draft.resourceProjectId,
        effectiveProjectId: draft.effectiveProjectId,
        updatedAt: draft.updatedAt,
        source: 'FE_P3_S2_SUBMISSION',
      });
    }
    return targets;
  }

  async findSourceTarget(
    projectId: string,
    reviewResourceId: string,
  ): Promise<ReviewSourceTargetV1 | undefined> {
    const targets = await this.listSourceTargets(projectId);
    return targets.find((target) => target.reviewResourceId === reviewResourceId);
  }

  async materializeContext(
    input: ReviewContextMaterializationInputV1,
  ): Promise<ReviewMaterializedContextV1> {
    const draft = await this.reader.findSubmitted(
      input.scope.activeProjectId,
      input.source.reviewResourceId,
    );
    if (!draft) {
      throw new FrontendContractError(
        'REVIEW_CONTEXT_NOT_FOUND',
        `Submitted Draft '${input.source.targetId}' was not found.`,
      );
    }
    const submission = draft.reviewSubmission;
    if (!submission) {
      throw new FrontendContractError(
        'REVIEW_CONTEXT_NOT_FOUND',
        `Draft '${draft.draftId}' has no Review Submission.`,
      );
    }
    const items: ReviewItemV1[] = draft.operations.map((operation, index) => {
      const reviewItemId = `item-${index + 1}`;
      const evidenceRefs = operation.evidenceReferences;
      const expectedImpact = operation.expectedImpact;
      return {
        schemaVersion: '1.0.0',
        reviewItemId,
        sourceItemKind: 'KNOWLEDGE_OPERATION',
        sourceItemId: operation.operationId,
        sourceItemRevision: String(operation.operationRevision),
        sourceItemDigest: operation.contentDigest,
        targetRef: {
          schemaVersion: '1.0.0',
          targetKind: 'KNOWLEDGE_DRAFT_CHANGE_SET',
          targetId: draft.draftId,
          targetRevision: String(draft.revision),
        },
        label: operationLabel(operation),
        before:
          operation.before === undefined
            ? undefined
            : {
                schemaVersion: '1.0.0',
                representationKind: 'OPAQUE_TEXT',
                summary: `Before: ${operationLabel(operation)}`,
                detailText: operationDetail(operation),
              },
        after: {
          schemaVersion: '1.0.0',
          representationKind: 'OPAQUE_TEXT',
          summary: `After: ${operationLabel(operation)}`,
          detailText: operationDetail(operation),
        },
        rationale: operation.rationale,
        expectedImpact: expectedImpact?.summary,
        artifactRefs: {
          schemaVersion: '1.0.0',
          ...(evidenceRefs.length > 0
            ? {
                evidence: {
                  schemaVersion: '1.0.0',
                  artifactKind: 'EVIDENCE',
                  artifactId: evidenceRefs[0]?.evidenceSpanId ?? 'evidence',
                  artifactRevision: '1',
                  digest: sha256Text(stableJson(evidenceRefs)),
                },
              }
            : {}),
          ...(expectedImpact
            ? {
                impact: {
                  schemaVersion: '1.0.0',
                  artifactKind: 'IMPACT',
                  artifactId: `impact-${operation.operationId}`,
                  artifactRevision: '1',
                  digest: sha256Text(stableJson(expectedImpact)),
                },
              }
            : {}),
        },
        allowedDecisions: ['APPROVE', 'REJECT', 'REQUEST_REVISION', 'HOLD'],
        decisionState: 'PENDING',
        sensitivity: 'NORMAL',
        maskedFields: [],
        accessMasking: 'VISIBLE',
      };
    });
    const dependencies = this.buildDraftDependencies(draft, items);
    const evidenceLineageDigest = sha256Text(stableJson(submission.evidenceLineage));
    const context: ReviewContextRevisionV1 = {
      schemaVersion: '1.0.0',
      reviewContextId: input.reviewContextId,
      contextRevision: input.contextRevision,
      reviewResourceId: input.source.reviewResourceId,
      targetKind: 'KNOWLEDGE_DRAFT_CHANGE_SET',
      targetId: draft.draftId,
      targetRevision: String(draft.revision),
      targetDigest: submission.contentDigest,
      resourceProjectId: draft.resourceProjectId,
      effectiveProjectId: draft.effectiveProjectId,
      accessRevision: input.scope.accessRevision,
      policyContextRevision: input.scope.policyContextRevision,
      canonicalBase: {
        schemaVersion: '1.0.0',
        snapshotId: draft.base.canonicalSnapshotId,
        revision: String(draft.base.canonicalVersion),
        digest: draft.base.canonicalSnapshotDigest,
      },
      artifactRefs: {
        schemaVersion: '1.0.0',
        validation: {
          schemaVersion: '1.0.0',
          artifactKind: 'VALIDATION',
          artifactId: submission.validationArtifact.artifactId,
          artifactRevision: String(submission.validationArtifact.artifactRevision),
          digest: submission.validationArtifact.digest,
        },
        evidence:
          submission.evidenceLineage.length > 0
            ? {
                schemaVersion: '1.0.0',
                artifactKind: 'EVIDENCE',
                artifactId: 'submission-evidence',
                artifactRevision: '1',
                digest: evidenceLineageDigest,
              }
            : undefined,
        impact: {
          schemaVersion: '1.0.0',
          artifactKind: 'IMPACT',
          artifactId: submission.impactArtifact.artifactId,
          artifactRevision: String(submission.impactArtifact.artifactRevision),
          digest: submission.impactArtifact.digest,
        },
      },
      items,
      dependencies,
      aggregateState: 'PENDING',
      capabilities: reviewCapabilitiesFor('KNOWLEDGE_DRAFT_CHANGE_SET'),
      generatedAt: input.generatedAt,
    };
    return { context };
  }

  private buildDraftDependencies(
    draft: FrontendKnowledgeDraftChangeSetV1,
    items: readonly ReviewItemV1[],
  ): readonly ReviewDependencyV1[] {
    // Deterministic REQUIRES chain: operations on the same target resource are
    // ordered, and later operations require earlier ones on the same target.
    const dependencies: ReviewDependencyV1[] = [];
    const byResource = new Map<string, readonly ReviewItemV1[]>();
    for (const item of items) {
      const operation = draft.operations.find(
        (candidate) => candidate.operationId === item.sourceItemId,
      );
      if (!operation) continue;
      const key = operation.target.resourceId;
      const group = byResource.get(key) ?? [];
      byResource.set(key, [...group, item]);
    }
    for (const group of byResource.values()) {
      for (let i = 1; i < group.length; i += 1) {
        const from = group[i - 1];
        const to = group[i];
        if (!from || !to) continue;
        dependencies.push({
          schemaVersion: '1.0.0',
          dependencyId: `dep-${from.reviewItemId}-${to.reviewItemId}`,
          fromReviewItemId: from.reviewItemId,
          toReviewItemId: to.reviewItemId,
          kind: 'REQUIRES',
          reasonCode: 'OPERATION_ORDER',
          description: `${to.label} requires ${from.label}.`,
          availability: 'AVAILABLE',
        });
      }
    }
    return dependencies;
  }

  async readEvidence(input: {
    scope: FrontendReviewScopeV1;
    source: ReviewSourceTargetV1;
    reviewItemId: string;
  }): Promise<readonly ReviewEvidenceEntryV1[]> {
    const draft = await this.reader.findSubmitted(
      input.scope.activeProjectId,
      input.source.reviewResourceId,
    );
    if (!draft) return [];
    const submission = draft.reviewSubmission;
    if (!submission) return [];
    return submission.evidenceLineage.map((lineage) => ({
      schemaVersion: '1.0.0',
      sourceId: lineage.sourceId,
      sourceVersionId: lineage.sourceVersionId,
      evidenceSpanId: lineage.evidenceSpanId,
      snippet: `Evidence span ${lineage.evidenceSpanId} in source ${lineage.sourceId}.`,
    }));
  }

  async readImpact(input: {
    scope: FrontendReviewScopeV1;
    source: ReviewSourceTargetV1;
    reviewItemId: string;
  }): Promise<readonly ReviewImpactEntryV1[]> {
    const draft = await this.reader.findSubmitted(
      input.scope.activeProjectId,
      input.source.reviewResourceId,
    );
    if (!draft) return [];
    const item = this.itemById(draft, input.reviewItemId);
    if (!item) return [];
    const operation = draft.operations.find(
      (candidate) => candidate.operationId === item.sourceItemId,
    );
    if (!operation?.expectedImpact) return [];
    return [
      {
        schemaVersion: '1.0.0',
        impactId: `impact-${operation.operationId}`,
        targetKind: operation.target.targetType,
        targetId: operation.target.resourceId,
        description: operation.expectedImpact.summary,
      },
    ];
  }

  async currentEvidenceDigest(input: {
    scope: FrontendReviewScopeV1;
    source: ReviewSourceTargetV1;
  }): Promise<string | undefined> {
    const draft = await this.reader.findSubmitted(
      input.scope.activeProjectId,
      input.source.reviewResourceId,
    );
    if (!draft?.reviewSubmission) return undefined;
    const lineage = draft.reviewSubmission.evidenceLineage;
    return lineage.length === 0 ? undefined : sha256Text(stableJson(lineage));
  }

  private itemById(
    draft: FrontendKnowledgeDraftChangeSetV1,
    reviewItemId: string,
  ): ReviewItemV1 | undefined {
    const index = Number(reviewItemId.replace(/^item-/, '')) - 1;
    const operation = draft.operations[index];
    if (!operation) return undefined;
    return {
      schemaVersion: '1.0.0',
      reviewItemId,
      sourceItemKind: 'KNOWLEDGE_OPERATION',
      sourceItemId: operation.operationId,
      sourceItemRevision: String(operation.operationRevision),
      sourceItemDigest: operation.contentDigest,
      targetRef: {
        schemaVersion: '1.0.0',
        targetKind: 'KNOWLEDGE_DRAFT_CHANGE_SET',
        targetId: draft.draftId,
        targetRevision: String(draft.revision),
      },
      label: operationLabel(operation),
      rationale: operation.rationale,
      artifactRefs: { schemaVersion: '1.0.0' },
      allowedDecisions: ['APPROVE', 'REJECT', 'REQUEST_REVISION', 'HOLD'],
      decisionState: 'PENDING',
      sensitivity: 'NORMAL',
      maskedFields: [],
      accessMasking: 'VISIBLE',
    };
  }
}

// ---------------------------------------------------------------------------
// Discovery Candidate target adapter
// ---------------------------------------------------------------------------

export type ReviewDiscoveryCandidateSourceV1 = {
  readonly candidateId: string;
  readonly resourceProjectId: string;
  readonly effectiveProjectId: string;
  readonly content: { readonly summary: string; readonly detail: string };
  readonly evidence: readonly {
    readonly sourceId: string;
    readonly sourceVersionId: string;
    readonly evidenceSpanId: string;
  }[];
  readonly impact: readonly {
    readonly impactId: string;
    readonly targetKind: string;
    readonly targetId: string;
    readonly description: string;
  }[];
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type ReviewDiscoveryCandidateReader = {
  list(projectId: string): Promise<readonly ReviewDiscoveryCandidateSourceV1[]>;
  find(
    projectId: string,
    candidateId: string,
  ): Promise<ReviewDiscoveryCandidateSourceV1 | undefined>;
};

export const createInMemoryReviewDiscoveryCandidateReader = (
  initial: readonly ReviewDiscoveryCandidateSourceV1[] = [],
): ReviewDiscoveryCandidateReader => {
  const byId = new Map<string, ReviewDiscoveryCandidateSourceV1>();
  for (const candidate of initial) byId.set(candidate.candidateId, candidate);
  return {
    async list(projectId) {
      return [...byId.values()].filter((candidate) => candidate.resourceProjectId === projectId);
    },
    async find(projectId, candidateId) {
      const candidate = byId.get(candidateId);
      if (!candidate || candidate.resourceProjectId !== projectId) return undefined;
      return candidate;
    },
  };
};

export class DiscoveryCandidateReviewTargetAdapter implements ReviewTargetAdapterPort {
  readonly targetKind = 'DISCOVERY_CANDIDATE' as const;
  readonly sourceItemKind = 'DISCOVERY_CANDIDATE' as const;

  constructor(private readonly reader: ReviewDiscoveryCandidateReader) {}

  async listSourceTargets(projectId: string): Promise<readonly ReviewSourceTargetV1[]> {
    const candidates = await this.reader.list(projectId);
    return candidates.map((candidate) => ({
      reviewResourceId: candidate.candidateId,
      targetId: candidate.candidateId,
      targetRevision: '1',
      targetDigest: this.candidateDigest(candidate),
      targetLabel: candidate.content.summary,
      resourceProjectId: candidate.resourceProjectId,
      effectiveProjectId: candidate.effectiveProjectId,
      updatedAt: candidate.updatedAt,
      source: 'DISCOVERY_CANDIDATE' as const,
    }));
  }

  async findSourceTarget(
    projectId: string,
    reviewResourceId: string,
  ): Promise<ReviewSourceTargetV1 | undefined> {
    const targets = await this.listSourceTargets(projectId);
    return targets.find((target) => target.reviewResourceId === reviewResourceId);
  }

  private candidateDigest(candidate: ReviewDiscoveryCandidateSourceV1): string {
    return sha256Text(stableJson({ content: candidate.content, evidence: candidate.evidence }));
  }

  async materializeContext(
    input: ReviewContextMaterializationInputV1,
  ): Promise<ReviewMaterializedContextV1> {
    const candidate = await this.reader.find(
      input.scope.activeProjectId,
      input.source.reviewResourceId,
    );
    if (!candidate) {
      throw new FrontendContractError(
        'REVIEW_CONTEXT_NOT_FOUND',
        `Discovery Candidate '${input.source.targetId}' was not found.`,
      );
    }
    const evidenceDigest = sha256Text(stableJson(candidate.evidence));
    const item: ReviewItemV1 = {
      schemaVersion: '1.0.0',
      reviewItemId: 'item-1',
      sourceItemKind: 'DISCOVERY_CANDIDATE',
      sourceItemId: candidate.candidateId,
      sourceItemRevision: '1',
      sourceItemDigest: this.candidateDigest(candidate),
      targetRef: {
        schemaVersion: '1.0.0',
        targetKind: 'DISCOVERY_CANDIDATE',
        targetId: candidate.candidateId,
        targetRevision: '1',
      },
      label: candidate.content.summary,
      before: undefined,
      after: {
        schemaVersion: '1.0.0',
        representationKind: 'OPAQUE_TEXT',
        summary: candidate.content.summary,
        detailText: candidate.content.detail,
      },
      rationale: 'Discovery Candidate generated from Evidence and proposed for authoring.',
      expectedImpact: undefined,
      artifactRefs: {
        schemaVersion: '1.0.0',
        evidence:
          candidate.evidence.length > 0
            ? {
                schemaVersion: '1.0.0',
                artifactKind: 'EVIDENCE',
                artifactId: 'candidate-evidence',
                artifactRevision: '1',
                digest: evidenceDigest,
              }
            : undefined,
      },
      allowedDecisions: ['APPROVE', 'REJECT', 'HOLD'],
      decisionState: 'PENDING',
      sensitivity: 'NORMAL',
      maskedFields: [],
      accessMasking: 'VISIBLE',
    };
    const context: ReviewContextRevisionV1 = {
      schemaVersion: '1.0.0',
      reviewContextId: input.reviewContextId,
      contextRevision: input.contextRevision,
      reviewResourceId: input.source.reviewResourceId,
      targetKind: 'DISCOVERY_CANDIDATE',
      targetId: candidate.candidateId,
      targetRevision: '1',
      targetDigest: this.candidateDigest(candidate),
      resourceProjectId: candidate.resourceProjectId,
      effectiveProjectId: candidate.effectiveProjectId,
      accessRevision: input.scope.accessRevision,
      policyContextRevision: input.scope.policyContextRevision,
      canonicalBase: undefined,
      artifactRefs: {
        schemaVersion: '1.0.0',
        evidence:
          candidate.evidence.length > 0
            ? {
                schemaVersion: '1.0.0',
                artifactKind: 'EVIDENCE',
                artifactId: 'candidate-evidence',
                artifactRevision: '1',
                digest: evidenceDigest,
              }
            : undefined,
      },
      items: [item],
      dependencies: [],
      aggregateState: 'PENDING',
      capabilities: reviewCapabilitiesFor('DISCOVERY_CANDIDATE'),
      generatedAt: input.generatedAt,
    };
    return { context };
  }

  async readEvidence(input: {
    scope: FrontendReviewScopeV1;
    source: ReviewSourceTargetV1;
    reviewItemId: string;
  }): Promise<readonly ReviewEvidenceEntryV1[]> {
    const candidate = await this.reader.find(
      input.scope.activeProjectId,
      input.source.reviewResourceId,
    );
    if (!candidate) return [];
    return candidate.evidence.map((entry) => ({
      schemaVersion: '1.0.0',
      sourceId: entry.sourceId,
      sourceVersionId: entry.sourceVersionId,
      evidenceSpanId: entry.evidenceSpanId,
      snippet: `Evidence span ${entry.evidenceSpanId} in source ${entry.sourceId}.`,
    }));
  }

  async readImpact(input: {
    scope: FrontendReviewScopeV1;
    source: ReviewSourceTargetV1;
    reviewItemId: string;
  }): Promise<readonly ReviewImpactEntryV1[]> {
    const candidate = await this.reader.find(
      input.scope.activeProjectId,
      input.source.reviewResourceId,
    );
    if (!candidate) return [];
    return candidate.impact.map((entry) => ({
      schemaVersion: '1.0.0',
      impactId: entry.impactId,
      targetKind: entry.targetKind,
      targetId: entry.targetId,
      description: entry.description,
    }));
  }

  async currentEvidenceDigest(input: {
    scope: FrontendReviewScopeV1;
    source: ReviewSourceTargetV1;
  }): Promise<string | undefined> {
    const candidate = await this.reader.find(
      input.scope.activeProjectId,
      input.source.reviewResourceId,
    );
    if (!candidate || candidate.evidence.length === 0) return undefined;
    return sha256Text(stableJson(candidate.evidence));
  }
}

// ---------------------------------------------------------------------------
// UserDirectiveProposal target adapter
// ---------------------------------------------------------------------------

export type ReviewUserDirectiveProposalSourceV1 = {
  readonly proposalId: string;
  readonly resourceProjectId: string;
  readonly effectiveProjectId: string;
  readonly title: string;
  readonly clauses: readonly {
    readonly clauseId: string;
    readonly text: string;
    readonly rationale: string;
  }[];
  readonly evidence: readonly {
    readonly sourceId: string;
    readonly sourceVersionId: string;
    readonly evidenceSpanId: string;
  }[];
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type ReviewUserDirectiveReader = {
  list(projectId: string): Promise<readonly ReviewUserDirectiveProposalSourceV1[]>;
  find(
    projectId: string,
    proposalId: string,
  ): Promise<ReviewUserDirectiveProposalSourceV1 | undefined>;
};

export const createInMemoryReviewUserDirectiveReader = (
  initial: readonly ReviewUserDirectiveProposalSourceV1[] = [],
): ReviewUserDirectiveReader => {
  const byId = new Map<string, ReviewUserDirectiveProposalSourceV1>();
  for (const proposal of initial) byId.set(proposal.proposalId, proposal);
  return {
    async list(projectId) {
      return [...byId.values()].filter((proposal) => proposal.resourceProjectId === projectId);
    },
    async find(projectId, proposalId) {
      const proposal = byId.get(proposalId);
      if (!proposal || proposal.resourceProjectId !== projectId) return undefined;
      return proposal;
    },
  };
};

export class UserDirectiveReviewTargetAdapter implements ReviewTargetAdapterPort {
  readonly targetKind = 'USER_DIRECTIVE_PROPOSAL' as const;
  readonly sourceItemKind = 'USER_DIRECTIVE_CLAUSE' as const;

  constructor(private readonly reader: ReviewUserDirectiveReader) {}

  async listSourceTargets(projectId: string): Promise<readonly ReviewSourceTargetV1[]> {
    const proposals = await this.reader.list(projectId);
    return proposals.map((proposal) => ({
      reviewResourceId: proposal.proposalId,
      targetId: proposal.proposalId,
      targetRevision: '1',
      targetDigest: this.proposalDigest(proposal),
      targetLabel: proposal.title,
      resourceProjectId: proposal.resourceProjectId,
      effectiveProjectId: proposal.effectiveProjectId,
      updatedAt: proposal.updatedAt,
      source: 'USER_DIRECTIVE_PROPOSAL' as const,
    }));
  }

  async findSourceTarget(
    projectId: string,
    reviewResourceId: string,
  ): Promise<ReviewSourceTargetV1 | undefined> {
    const targets = await this.listSourceTargets(projectId);
    return targets.find((target) => target.reviewResourceId === reviewResourceId);
  }

  private proposalDigest(proposal: ReviewUserDirectiveProposalSourceV1): string {
    return sha256Text(stableJson({ title: proposal.title, clauses: proposal.clauses }));
  }

  async materializeContext(
    input: ReviewContextMaterializationInputV1,
  ): Promise<ReviewMaterializedContextV1> {
    const proposal = await this.reader.find(
      input.scope.activeProjectId,
      input.source.reviewResourceId,
    );
    if (!proposal) {
      throw new FrontendContractError(
        'REVIEW_CONTEXT_NOT_FOUND',
        `UserDirectiveProposal '${input.source.targetId}' was not found.`,
      );
    }
    const items: ReviewItemV1[] = proposal.clauses.map((clause, index) => ({
      schemaVersion: '1.0.0',
      reviewItemId: `item-${index + 1}`,
      sourceItemKind: 'USER_DIRECTIVE_CLAUSE',
      sourceItemId: clause.clauseId,
      sourceItemRevision: '1',
      sourceItemDigest: sha256Text(stableJson({ clauseId: clause.clauseId, text: clause.text })),
      targetRef: {
        schemaVersion: '1.0.0',
        targetKind: 'USER_DIRECTIVE_PROPOSAL',
        targetId: proposal.proposalId,
        targetRevision: '1',
      },
      label: clause.text,
      before: undefined,
      after: {
        schemaVersion: '1.0.0',
        representationKind: 'OPAQUE_TEXT',
        summary: clause.text,
        detailText: clause.text,
      },
      rationale: clause.rationale,
      expectedImpact: undefined,
      artifactRefs: { schemaVersion: '1.0.0' },
      allowedDecisions: ['APPROVE', 'REJECT', 'REQUEST_REVISION', 'HOLD'],
      decisionState: 'PENDING',
      sensitivity: 'NORMAL',
      maskedFields: [],
      accessMasking: 'VISIBLE',
    }));
    const context: ReviewContextRevisionV1 = {
      schemaVersion: '1.0.0',
      reviewContextId: input.reviewContextId,
      contextRevision: input.contextRevision,
      reviewResourceId: input.source.reviewResourceId,
      targetKind: 'USER_DIRECTIVE_PROPOSAL',
      targetId: proposal.proposalId,
      targetRevision: '1',
      targetDigest: this.proposalDigest(proposal),
      resourceProjectId: proposal.resourceProjectId,
      effectiveProjectId: proposal.effectiveProjectId,
      accessRevision: input.scope.accessRevision,
      policyContextRevision: input.scope.policyContextRevision,
      canonicalBase: undefined,
      artifactRefs: { schemaVersion: '1.0.0' },
      items,
      dependencies: [],
      aggregateState: 'PENDING',
      capabilities: reviewCapabilitiesFor('USER_DIRECTIVE_PROPOSAL'),
      generatedAt: input.generatedAt,
    };
    return { context };
  }

  async readEvidence(): Promise<readonly ReviewEvidenceEntryV1[]> {
    return [];
  }

  async readImpact(): Promise<readonly ReviewImpactEntryV1[]> {
    return [];
  }

  async currentEvidenceDigest(): Promise<string | undefined> {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Reversal target adapter (FE-P5-S2 WP5 Round 2 B)
// ---------------------------------------------------------------------------
//
// The owning change-set-review store persists Reversal DraftChangeSets; this
// adapter surfaces them through the EXISTING `KNOWLEDGE_DRAFT_CHANGE_SET`
// Review target kind so a Reversal candidate appears in the current Review
// Context / Review queue (Review → Approval → Canonical Commit path). No new
// `ReviewTargetKind` is introduced (frozen browser contract preserved).

export type ReversalStoreReader = {
  findReversalById(
    projectId: string,
    reversalId: string,
  ): Promise<ReversalDraftChangeSetV1 | undefined>;
  listReversals(projectId: string): Promise<readonly ReversalDraftChangeSetV1[]>;
};

export type ReversalCanonicalSnapshotReader = {
  getSnapshot(projectId: string): Promise<CanonicalSnapshot>;
  findRevision(projectId: string, revisionId: string): Promise<CanonicalRevision | undefined>;
  listHistory(projectId: string): Promise<readonly CanonicalHistoryEvent[]>;
};

export class ReversalReviewTargetAdapter implements ReviewTargetAdapterPort {
  readonly targetKind = 'KNOWLEDGE_DRAFT_CHANGE_SET' as const;
  readonly sourceItemKind = 'KNOWLEDGE_OPERATION' as const;

  constructor(
    private readonly reversals: ReversalStoreReader,
    private readonly canonical: ReversalCanonicalSnapshotReader,
  ) {}

  async listSourceTargets(projectId: string): Promise<readonly ReviewSourceTargetV1[]> {
    const list = await this.reversals.listReversals(projectId);
    return list.map((reversal) => ({
      reviewResourceId: reversal.reversalId,
      targetId: reversal.reversalId,
      targetRevision: '1',
      targetDigest: this.reversalDigest(reversal),
      targetLabel: `Reversal ${reversal.reversalId} (revision ${reversal.sourceRevisionId})`,
      resourceProjectId: reversal.resourceProjectId,
      effectiveProjectId: reversal.resourceProjectId,
      updatedAt: reversal.createdAt,
      source: 'FE_P3_S2_SUBMISSION' as const,
    }));
  }

  async findSourceTarget(
    projectId: string,
    reviewResourceId: string,
  ): Promise<ReviewSourceTargetV1 | undefined> {
    const targets = await this.listSourceTargets(projectId);
    return targets.find((target) => target.reviewResourceId === reviewResourceId);
  }

  private reversalDigest(reversal: ReversalDraftChangeSetV1): string {
    return sha256Text(
      stableJson({
        reversalId: reversal.reversalId,
        sourceRevisionId: reversal.sourceRevisionId,
        sourceCommitId: reversal.sourceCommitId,
      }),
    );
  }

  private async impactFor(
    reversal: ReversalDraftChangeSetV1,
  ): Promise<ReversalSnapshotImpact | undefined> {
    const revision = await this.canonical.findRevision(
      reversal.resourceProjectId,
      reversal.sourceRevisionId,
    );
    if (!revision) return undefined;
    const snapshot = await this.canonical.getSnapshot(reversal.resourceProjectId);
    const history = await this.canonical.listHistory(reversal.resourceProjectId);
    return computeReversalSnapshotImpact(revision, snapshot, history);
  }

  async materializeContext(
    input: ReviewContextMaterializationInputV1,
  ): Promise<ReviewMaterializedContextV1> {
    const reversal = await this.reversals.findReversalById(
      input.scope.activeProjectId,
      input.source.reviewResourceId,
    );
    if (!reversal) {
      throw new FrontendContractError(
        'REVIEW_CONTEXT_NOT_FOUND',
        `Reversal '${input.source.targetId}' was not found.`,
      );
    }
    const impact = await this.impactFor(reversal);
    const removedClaimIds = impact?.removedClaimIds ?? [];
    const snapshot = await this.canonical.getSnapshot(reversal.resourceProjectId);
    const claimText = (claimId: string): string =>
      snapshot.claims.find((claim) => claim.claimId === claimId)?.text ?? '';
    const removedItems: ReviewItemV1[] = removedClaimIds.map((claimId, index) => ({
      schemaVersion: '1.0.0',
      reviewItemId: `item-${index + 1}`,
      sourceItemKind: 'KNOWLEDGE_OPERATION',
      sourceItemId: `reversal-remove:${claimId}`,
      sourceItemRevision: '1',
      sourceItemDigest: sha256Text(stableJson({ claimId, kind: 'CLAIM_REMOVE' })),
      targetRef: {
        schemaVersion: '1.0.0',
        targetKind: 'KNOWLEDGE_DRAFT_CHANGE_SET',
        targetId: reversal.reversalId,
        targetRevision: '1',
      },
      label: `Remove claim ${claimId}`,
      before: {
        schemaVersion: '1.0.0',
        representationKind: 'OPAQUE_TEXT',
        summary: `Claim ${claimId} present`,
        detailText: claimText(claimId),
      },
      after: {
        schemaVersion: '1.0.0',
        representationKind: 'OPAQUE_TEXT',
        summary: `Claim ${claimId} removed`,
        detailText: '',
      },
      rationale: `Reversal of ${reversal.sourceRevisionId}`,
      expectedImpact: impact
        ? `${impact.impactedClaimCount} claims retained (was ${impact.currentClaimCount})`
        : undefined,
      artifactRefs: {
        schemaVersion: '1.0.0',
        impact: {
          schemaVersion: '1.0.0',
          artifactKind: 'IMPACT',
          artifactId: `reversal-impact:${reversal.reversalId}`,
          artifactRevision: '1',
          digest: impact?.impactedDigest ?? this.reversalDigest(reversal),
        },
      },
      allowedDecisions: ['APPROVE', 'REJECT', 'REQUEST_REVISION', 'HOLD'],
      decisionState: 'PENDING',
      sensitivity: 'NORMAL',
      maskedFields: [],
      accessMasking: 'VISIBLE',
    }));
    const items: ReviewItemV1[] =
      removedItems.length > 0
        ? removedItems
        : [
            {
              schemaVersion: '1.0.0',
              reviewItemId: 'item-1',
              sourceItemKind: 'KNOWLEDGE_OPERATION',
              sourceItemId: `reversal:${reversal.reversalId}`,
              sourceItemRevision: '1',
              sourceItemDigest: this.reversalDigest(reversal),
              targetRef: {
                schemaVersion: '1.0.0',
                targetKind: 'KNOWLEDGE_DRAFT_CHANGE_SET',
                targetId: reversal.reversalId,
                targetRevision: '1',
              },
              label: `Reversal ${reversal.reversalId} (no claim removal)`,
              before: undefined,
              after: {
                schemaVersion: '1.0.0',
                representationKind: 'OPAQUE_TEXT',
                summary: `Reversal of ${reversal.sourceRevisionId}`,
                detailText: '',
              },
              rationale: `Reversal of ${reversal.sourceRevisionId}`,
              expectedImpact: undefined,
              artifactRefs: { schemaVersion: '1.0.0' },
              allowedDecisions: ['APPROVE', 'REJECT', 'REQUEST_REVISION', 'HOLD'],
              decisionState: 'PENDING',
              sensitivity: 'NORMAL',
              maskedFields: [],
              accessMasking: 'VISIBLE',
            },
          ];
    const context: ReviewContextRevisionV1 = {
      schemaVersion: '1.0.0',
      reviewContextId: input.reviewContextId,
      contextRevision: input.contextRevision,
      reviewResourceId: input.source.reviewResourceId,
      targetKind: 'KNOWLEDGE_DRAFT_CHANGE_SET',
      targetId: reversal.reversalId,
      targetRevision: '1',
      targetDigest: this.reversalDigest(reversal),
      resourceProjectId: reversal.resourceProjectId,
      effectiveProjectId: reversal.resourceProjectId,
      accessRevision: input.scope.accessRevision,
      policyContextRevision: input.scope.policyContextRevision,
      canonicalBase: impact
        ? {
            schemaVersion: '1.0.0',
            snapshotId: `revision:${reversal.sourceRevisionId}`,
            revision: String(impact.impactedVersion),
            digest: impact.impactedDigest,
          }
        : undefined,
      artifactRefs: {
        schemaVersion: '1.0.0',
        impact: {
          schemaVersion: '1.0.0',
          artifactKind: 'IMPACT',
          artifactId: `reversal-impact:${reversal.reversalId}`,
          artifactRevision: '1',
          digest: impact?.impactedDigest ?? this.reversalDigest(reversal),
        },
      },
      items,
      dependencies: [],
      aggregateState: 'PENDING',
      capabilities: reviewCapabilitiesFor('KNOWLEDGE_DRAFT_CHANGE_SET'),
      generatedAt: input.generatedAt,
    };
    return { context };
  }

  async readEvidence(input: {
    scope: FrontendReviewScopeV1;
    source: ReviewSourceTargetV1;
    reviewItemId: string;
  }): Promise<readonly ReviewEvidenceEntryV1[]> {
    const reversal = await this.reversals.findReversalById(
      input.scope.activeProjectId,
      input.source.reviewResourceId,
    );
    if (!reversal?.historicalApprovalRef) return [];
    return [
      {
        schemaVersion: '1.0.0',
        sourceId: reversal.sourceRevisionId,
        sourceVersionId: reversal.sourceCommitId,
        evidenceSpanId: reversal.historicalApprovalRef,
        snippet: `Historical approval ${reversal.historicalApprovalRef} (reference only, never authority).`,
      },
    ];
  }

  async readImpact(input: {
    scope: FrontendReviewScopeV1;
    source: ReviewSourceTargetV1;
    reviewItemId: string;
  }): Promise<readonly ReviewImpactEntryV1[]> {
    const reversal = await this.reversals.findReversalById(
      input.scope.activeProjectId,
      input.source.reviewResourceId,
    );
    if (!reversal) return [];
    const impact = await this.impactFor(reversal);
    if (!impact) return [];
    return impact.removedClaimIds.map((claimId) => ({
      schemaVersion: '1.0.0',
      impactId: `reversal-remove:${claimId}`,
      targetKind: 'CLAIM',
      targetId: claimId,
      description: `Removes claim ${claimId}; impacted version ${impact.impactedVersion} (was ${impact.currentVersion}).`,
    }));
  }

  async currentEvidenceDigest(input: {
    scope: FrontendReviewScopeV1;
    source: ReviewSourceTargetV1;
  }): Promise<string | undefined> {
    const reversal = await this.reversals.findReversalById(
      input.scope.activeProjectId,
      input.source.reviewResourceId,
    );
    if (!reversal?.historicalApprovalRef) return undefined;
    return sha256Text(stableJson({ historicalApprovalRef: reversal.historicalApprovalRef }));
  }
}
