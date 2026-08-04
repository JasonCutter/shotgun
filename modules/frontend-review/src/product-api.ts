import { randomUUID } from 'node:crypto';

import {
  FRONTEND_REVIEW_API_VERSION,
  FRONTEND_REVIEW_COMMAND_TYPES,
  frontendReviewAddCommentDigest,
  frontendReviewRecordDecisionsDigest,
  frontendReviewRevalidateDigest,
  type AcceptedPolicyContext,
  type AddReviewCommentRequestV1,
  type AddReviewCommentResultV1,
  type AnyFrontendCommandOutcomeView,
  type AnyFrontendCommandRequest,
  type ErrorCode,
  type GetReviewApprovalRequestV1,
  type GetReviewApprovalResultV1,
  type GetReviewContextRequestV1,
  type GetReviewContextResultV1,
  type GetReviewItemDetailRequestV1,
  type GetReviewItemDetailResultV1,
  type ListReviewQueueRequestV1,
  type ListReviewQueueResultV1,
  type ProducedResourceRef,
  type RecordReviewDecisionsRequestV1,
  type RecordReviewDecisionsResultV1,
  type ResolveReviewCommandOutcomeRequestV1,
  type ResolveReviewCommandOutcomeResultV1,
  type RevalidateReviewContextRequestV1,
  type RevalidateReviewContextResultV1,
  type ReviewApprovalV1,
  type ReviewCapabilityV1,
  type ReviewCommentRecordV1,
  type ReviewDecisionRecordV1,
  type ReviewQueueItemV1,
  type ReviewRevisionReturnTargetV1,
  type ReviewTargetKindV1,
  type TypedPrecondition,
} from '../../../packages/contracts/src/index.js';
import { reviewFailure, ReviewCommandError } from './review-error.js';
import {
  computeAggregateState,
  deriveAttentionReasons,
  deriveContextView,
  deriveItemDecisionState,
  isTerminalDecisionIntent,
  reviewApprovalManifestDigest,
  reviewContextIdForSource,
  validateProposedApprovalSet,
} from './review-domain.js';
import type {
  ReviewContextRecordV1,
  ReviewRepositoryBoundaryPort,
  ReviewTransactionRepositoriesV1,
} from './review-store-port.js';
import type {
  FrontendReviewScopeV1,
  ReviewSourceTargetV1,
  ReviewTargetAdapterPort,
} from './review-target-port.js';

const generatedIdentity = (prefix: string): string => `${prefix}-${randomUUID()}`;

/**
 * Structural subset of the Frontend command gateway used by the Review product.
 *
 * Declared locally (mirroring the ask-write module pattern) so that this domain
 * module does not import another domain module; the concrete gateway is wired at
 * the assembly boundary and satisfies this shape structurally.
 */
export type FrontendReviewCommandGatewayPort = {
  accept(input: {
    readonly commandId: string;
    readonly commandRevision: string;
    readonly principalId: string;
    readonly request: AnyFrontendCommandRequest;
    readonly commandSemanticDigest: string;
    readonly acceptedPolicyContext: AcceptedPolicyContext;
    readonly correlationId: string;
    readonly traceId: string;
    readonly receivedAt: string;
    readonly acceptedAt: string;
  }): Promise<{
    readonly outcome: AnyFrontendCommandOutcomeView;
    readonly replayed: boolean;
  }>;
  lockAcceptedForExecution(
    transaction: unknown,
    commandId: string,
  ): Promise<AnyFrontendCommandOutcomeView>;
  completeInTransaction(
    transaction: unknown,
    input: {
      readonly commandId: string;
      readonly producedResources: readonly ProducedResourceRef[];
      readonly completedAt: string;
    },
  ): Promise<AnyFrontendCommandOutcomeView>;
  reject(input: {
    readonly commandId: string;
    readonly code: ErrorCode;
    readonly message: string;
    readonly correlationId?: string;
    readonly completedAt: string;
  }): Promise<AnyFrontendCommandOutcomeView>;
  markOutcomeUnknown(input: {
    readonly commandId: string;
    readonly message: string;
    readonly completedAt: string;
  }): Promise<AnyFrontendCommandOutcomeView>;
  findByClientRequestId(
    principalId: string,
    clientRequestId: string,
  ): Promise<AnyFrontendCommandOutcomeView | null>;
};

export const FRONTEND_REVIEW_RESOURCE_KIND = {
  context: 'frontend.review.context',
  approval: 'frontend.review.approval',
  comment: 'frontend.review.comment',
} as const;

/** Shape returned by the record-decisions completion action. */
export type RecordReviewDecisionsWrittenV1 = {
  readonly reviewContextId: string;
  readonly contextRevision: number;
  readonly decisions: readonly ReviewDecisionRecordV1[];
  readonly aggregateState: RecordReviewDecisionsResultV1['aggregateState'];
  readonly approvals: readonly ReviewApprovalV1[];
  readonly acceptedForAuthoring?: boolean;
  readonly revisionRequestReturnTarget?: ReviewRevisionReturnTargetV1;
  readonly comment?: ReviewCommentRecordV1;
};

/** Approval resource lifetime (30 days). */
export const FRONTEND_REVIEW_APPROVAL_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Maximum Review queue page size (bounded contract). */
export const REVIEW_QUEUE_PAGE_SIZE_CAP = 50;

/** Defensive bound on the number of source targets enumerated per queue read. */
export const REVIEW_QUEUE_SOURCE_CAP = 500;

export const isReviewCommandType = (commandType: string): boolean =>
  commandType === FRONTEND_REVIEW_COMMAND_TYPES.recordDecisions ||
  commandType === FRONTEND_REVIEW_COMMAND_TYPES.addComment ||
  commandType === FRONTEND_REVIEW_COMMAND_TYPES.revalidateContext;

export const reviewCapabilitiesFor = (
  targetKind: ReviewTargetKindV1,
): readonly ReviewCapabilityV1[] => {
  const capabilities: ReviewCapabilityV1[] = [
    'LIST_QUEUE',
    'READ_CONTEXT',
    'READ_ITEM',
    'REVALIDATE',
    'RECORD_DECISIONS',
    'ADD_COMMENT',
    'RESOLVE_OUTCOME',
  ];
  if (targetKind !== 'DISCOVERY_CANDIDATE') capabilities.push('READ_APPROVAL');
  return capabilities;
};

type FrontendReviewRunCommandInput<T> = {
  readonly scope: FrontendReviewScopeV1;
  readonly commandType: (typeof FRONTEND_REVIEW_COMMAND_TYPES)[keyof typeof FRONTEND_REVIEW_COMMAND_TYPES];
  readonly request: { readonly clientRequestId: string; readonly idempotencyKey: string };
  readonly commandSemanticDigest: string;
  readonly resourceProjectId: string;
  readonly preconditions?: readonly TypedPrecondition[];
  readonly actionOnRepositories: (repositories: ReviewTransactionRepositoriesV1) => Promise<T>;
  readonly onReplay?: () => Promise<T>;
  readonly producedResources: (result: T) => readonly {
    readonly resourceKind: string;
    readonly resourceId: string;
    readonly resourceRevision?: string;
  }[];
};

export class FrontendReviewProductCoordinator {
  constructor(
    private readonly boundary: ReviewRepositoryBoundaryPort,
    private readonly commandGateway: FrontendReviewCommandGatewayPort,
    private readonly targetAdapters: readonly ReviewTargetAdapterPort[],
    private readonly now?: () => Date,
  ) {}

  private nowIso(): string {
    return (this.now ? this.now() : new Date()).toISOString();
  }

  private adapterFor(targetKind: ReviewTargetKindV1): ReviewTargetAdapterPort {
    const adapter = this.targetAdapters.find((candidate) => candidate.targetKind === targetKind);
    if (!adapter) {
      reviewFailure(
        'EXTERNAL_ACTION_REVIEW_REQUIRES_FE_P4_S2',
        `Review target '${targetKind}' is not supported in FE-P4-S1.`,
      );
    }
    return adapter;
  }

  private async materializeContext(
    repositories: ReviewTransactionRepositoriesV1,
    adapter: ReviewTargetAdapterPort,
    scope: FrontendReviewScopeV1,
    source: ReviewSourceTargetV1,
    contextRevision: number,
    generatedAt: string,
  ): Promise<ReviewContextRecordV1> {
    const reviewContextId = reviewContextIdForSource(adapter.targetKind, source.reviewResourceId);
    const materialized = await adapter.materializeContext({
      scope,
      source,
      reviewContextId,
      contextRevision,
      generatedAt,
    });
    return {
      reviewResourceId: source.reviewResourceId,
      context: materialized.context,
      sourceRevision: source.targetRevision,
      sourceDigest: source.targetDigest,
      sourceUpdatedAt: source.updatedAt,
      materializedAt: generatedAt,
    };
  }

  // -------------------------------------------------------------------------
  // Read operations
  // -------------------------------------------------------------------------

  async listReviewQueue(
    scope: FrontendReviewScopeV1,
    request: ListReviewQueueRequestV1,
  ): Promise<ListReviewQueueResultV1> {
    return this.boundary.transaction(async (repositories) => {
      const items: ReviewQueueItemV1[] = [];
      let enumerated = 0;
      for (const adapter of this.targetAdapters) {
        if (request.targetKinds && !request.targetKinds.includes(adapter.targetKind)) continue;
        const sources = await adapter.listSourceTargets(scope.activeProjectId);
        for (const source of sources) {
          if (enumerated >= REVIEW_QUEUE_SOURCE_CAP) break;
          enumerated += 1;
          const reviewContextId = reviewContextIdForSource(
            adapter.targetKind,
            source.reviewResourceId,
          );
          let record = await repositories.contexts.findCurrent(reviewContextId);
          if (!record) {
            const generatedAt = this.nowIso();
            record = await this.materializeContext(
              repositories,
              adapter,
              scope,
              source,
              1,
              generatedAt,
            );
            await repositories.contexts.insertContext(record);
          }
          const decisions = await repositories.decisions.findDecisions(
            record.context.reviewContextId,
          );
          const view = deriveContextView({ record, currentSource: source, scope, decisions });
          if (request.aggregateStates && !request.aggregateStates.includes(view.aggregateState)) {
            continue;
          }
          const attention = deriveAttentionReasons(
            view.aggregateState,
            view.aggregateState === 'STALE',
          );
          if (
            request.attentionReasons &&
            !request.attentionReasons.some((reason) => attention.includes(reason))
          ) {
            continue;
          }
          if (request.query && !this.queueQueryMatches(source, request.query)) {
            continue;
          }
          items.push({
            schemaVersion: '1.0.0',
            reviewContextId: record.context.reviewContextId,
            contextRevision: record.context.contextRevision,
            targetKind: adapter.targetKind,
            targetId: source.targetId,
            targetLabel: source.targetLabel,
            aggregateState: view.aggregateState,
            itemCount: record.context.items.length,
            updatedAt: record.materializedAt,
            attentionReasons: attention,
            capabilities: record.context.capabilities,
          });
        }
      }
      items.sort(
        (a, b) =>
          Date.parse(b.updatedAt) - Date.parse(a.updatedAt) ||
          a.reviewContextId.localeCompare(b.reviewContextId),
      );
      const offset = this.queueOffset(request.cursor);
      const page = items.slice(offset, offset + request.pageSize);
      const nextOffset = offset + page.length;
      const queueSnapshotRevision = `${items.length}:${Date.parse(this.nowIso())}`;
      return {
        schemaVersion: '1.0.0',
        acceptedContext: {
          schemaVersion: '1.0.0',
          resourceProjectId: scope.activeProjectId,
          accessRevision: scope.accessRevision,
          policyContextRevision: scope.policyContextRevision,
        },
        queueSnapshotRevision,
        items: page,
        nextCursor: nextOffset < items.length ? this.queueCursor(nextOffset) : undefined,
        totalCountStatus: 'EXACT',
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
      };
    });
  }

  private queueQueryMatches(
    source: { targetLabel: string; targetId: string },
    query: string,
  ): boolean {
    const normalized = query.trim().toLowerCase();
    if (normalized.length === 0) return true;
    return (
      source.targetLabel.toLowerCase().includes(normalized) ||
      source.targetId.toLowerCase().includes(normalized)
    );
  }

  private queueCursor(offset: number): string {
    return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64');
  }

  private queueOffset(cursor: string | undefined): number {
    if (!cursor) return 0;
    try {
      const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as {
        offset?: unknown;
      };
      if (
        typeof decoded.offset === 'number' &&
        Number.isSafeInteger(decoded.offset) &&
        decoded.offset >= 0
      ) {
        return decoded.offset;
      }
    } catch {
      // opaque cursor that is not recognized is treated as the first page
    }
    return 0;
  }

  async getReviewContext(
    scope: FrontendReviewScopeV1,
    request: GetReviewContextRequestV1,
  ): Promise<GetReviewContextResultV1> {
    return this.boundary.transaction(async (repositories) => {
      const record = await repositories.contexts.findCurrent(request.reviewContextId);
      if (!record) {
        reviewFailure('REVIEW_CONTEXT_NOT_FOUND', 'The Review Context was not found.');
      }
      if (record.context.resourceProjectId !== scope.activeProjectId) {
        reviewFailure('REVIEW_CONTEXT_NOT_FOUND', 'The Review Context was not found.');
      }
      const decisions = await repositories.decisions.findDecisions(request.reviewContextId);
      const comments = await repositories.decisions.findComments(request.reviewContextId);
      if (record.context.contextRevision !== request.contextRevision) {
        const historical = await repositories.contexts.findRevision(
          request.reviewContextId,
          request.contextRevision,
        );
        if (!historical) {
          reviewFailure('REVIEW_CONTEXT_NOT_FOUND', 'The Review Context revision was not found.');
        }
        return {
          schemaVersion: '1.0.0',
          context: historical,
          decisions: this.decisionsForRevision(decisions, request.contextRevision),
          comments: this.commentsForRevision(comments, request.contextRevision),
        };
      }
      const adapter = this.adapterFor(record.context.targetKind);
      const currentSource = await adapter.findSourceTarget(
        scope.activeProjectId,
        record.reviewResourceId,
      );
      const view = deriveContextView({ record, currentSource, scope, decisions });
      return {
        schemaVersion: '1.0.0',
        context: view.context,
        decisions,
        comments,
      };
    });
  }

  async getReviewItemDetail(
    scope: FrontendReviewScopeV1,
    request: GetReviewItemDetailRequestV1,
  ): Promise<GetReviewItemDetailResultV1> {
    return this.boundary.transaction(async (repositories) => {
      const record = await repositories.contexts.findCurrent(request.reviewContextId);
      if (!record || record.context.resourceProjectId !== scope.activeProjectId) {
        reviewFailure('REVIEW_CONTEXT_NOT_FOUND', 'The Review Context was not found.');
      }
      if (record.context.contextRevision !== request.contextRevision) {
        const historical = await repositories.contexts.findRevision(
          request.reviewContextId,
          request.contextRevision,
        );
        if (!historical) {
          reviewFailure('REVIEW_CONTEXT_NOT_FOUND', 'The Review Context revision was not found.');
        }
        return this.itemDetailFromContext(
          repositories,
          historical,
          request.reviewItemId,
          request.contextRevision,
        );
      }
      const item = record.context.items.find(
        (candidate) => candidate.reviewItemId === request.reviewItemId,
      );
      if (!item) {
        reviewFailure('REVIEW_ITEM_NOT_FOUND', 'The Review Item was not found.');
      }
      const adapter = this.adapterFor(record.context.targetKind);
      const source = await adapter.findSourceTarget(scope.activeProjectId, record.reviewResourceId);
      const evidence =
        request.includeEvidence && source
          ? await adapter.readEvidence({
              scope,
              source,
              reviewItemId: request.reviewItemId,
            })
          : undefined;
      const impact =
        request.includeImpact && source
          ? await adapter.readImpact({
              scope,
              source,
              reviewItemId: request.reviewItemId,
            })
          : undefined;
      const decisions = await repositories.decisions.findDecisions(request.reviewContextId);
      return {
        schemaVersion: '1.0.0',
        item,
        dependencies: this.dependenciesForItem(record.context.dependencies, request.reviewItemId),
        ...(evidence === undefined ? {} : { evidence }),
        ...(impact === undefined ? {} : { impact }),
        decisions: this.decisionsForRevision(decisions, request.contextRevision),
      };
    });
  }

  private async itemDetailFromContext(
    repositories: ReviewTransactionRepositoriesV1,
    context: ReviewContextRecordV1['context'],
    reviewItemId: string,
    contextRevision: number,
  ): Promise<GetReviewItemDetailResultV1> {
    const item = context.items.find((candidate) => candidate.reviewItemId === reviewItemId);
    if (!item) {
      reviewFailure('REVIEW_ITEM_NOT_FOUND', 'The Review Item was not found.');
    }
    const decisions = await repositories.decisions.findDecisions(context.reviewContextId);
    return {
      schemaVersion: '1.0.0',
      item,
      dependencies: this.dependenciesForItem(context.dependencies, reviewItemId),
      decisions: this.decisionsForRevision(decisions, contextRevision),
    };
  }

  private dependenciesForItem(
    dependencies: ReviewContextRecordV1['context']['dependencies'],
    reviewItemId: string,
  ): ReviewContextRecordV1['context']['dependencies'] {
    return dependencies.filter(
      (dependency) =>
        dependency.fromReviewItemId === reviewItemId || dependency.toReviewItemId === reviewItemId,
    );
  }

  async getReviewApproval(
    scope: FrontendReviewScopeV1,
    request: GetReviewApprovalRequestV1,
  ): Promise<GetReviewApprovalResultV1> {
    return this.boundary.transaction(async (repositories) => {
      const approval = await repositories.approvals.findById(request.approvalId);
      if (!approval || approval.projectId !== scope.activeProjectId) {
        reviewFailure(
          'REVIEW_APPROVAL_NOT_ISSUED',
          'No Approval Resource matches the requested identity.',
        );
      }
      return { schemaVersion: '1.0.0', approval };
    });
  }

  // -------------------------------------------------------------------------
  // Command operations
  // -------------------------------------------------------------------------

  async revalidateReviewContext(
    scope: FrontendReviewScopeV1,
    request: RevalidateReviewContextRequestV1,
  ): Promise<RevalidateReviewContextResultV1> {
    const commandSemanticDigest = frontendReviewRevalidateDigest(request);
    const written = await this.runCommand<ReviewContextRecordV1>({
      scope,
      commandType: FRONTEND_REVIEW_COMMAND_TYPES.revalidateContext,
      request,
      commandSemanticDigest,
      resourceProjectId: scope.activeProjectId,
      actionOnRepositories: async (repositories) => {
        const record = await repositories.contexts.findCurrent(request.reviewContextId);
        if (!record) {
          reviewFailure('REVIEW_CONTEXT_NOT_FOUND', 'The Review Context was not found.');
        }
        if (record.context.resourceProjectId !== scope.activeProjectId) {
          reviewFailure('REVIEW_CONTEXT_NOT_FOUND', 'The Review Context was not found.');
        }
        if (record.context.contextRevision !== request.contextRevision) {
          reviewFailure(
            'REVIEW_CONTEXT_STALE',
            `Expected context revision ${request.contextRevision} but the current revision is ${record.context.contextRevision}.`,
          );
        }
        const adapter = this.adapterFor(record.context.targetKind);
        const source = await adapter.findSourceTarget(
          scope.activeProjectId,
          record.reviewResourceId,
        );
        if (!source) {
          reviewFailure(
            'REVIEW_TARGET_CHANGED',
            'The reviewed target is no longer available for revalidation.',
          );
        }
        const generatedAt = this.nowIso();
        const nextRevision = record.context.contextRevision + 1;
        const nextRecord = await this.materializeContext(
          repositories,
          adapter,
          scope,
          source,
          nextRevision,
          generatedAt,
        );
        await repositories.contexts.insertContext(nextRecord);
        return nextRecord;
      },
      onReplay: async () => {
        const record = await this.contextRecordAfterReplay(scope, request.reviewContextId);
        return record;
      },
      producedResources: (record) => [
        {
          resourceKind: FRONTEND_REVIEW_RESOURCE_KIND.context,
          resourceId: record.context.reviewContextId,
          resourceRevision: String(record.context.contextRevision),
        },
      ],
    });
    return {
      schemaVersion: '1.0.0',
      outcome: 'COMPLETED',
      clientRequestId: request.clientRequestId,
      idempotencyKey: request.idempotencyKey,
      commandSemanticDigest,
      context: written.context,
    };
  }

  async recordReviewDecisions(
    scope: FrontendReviewScopeV1,
    request: RecordReviewDecisionsRequestV1,
  ): Promise<RecordReviewDecisionsResultV1> {
    const commandSemanticDigest = frontendReviewRecordDecisionsDigest(request);
    const written = await this.runCommand<RecordReviewDecisionsWrittenV1>({
      scope,
      commandType: FRONTEND_REVIEW_COMMAND_TYPES.recordDecisions,
      request,
      commandSemanticDigest,
      resourceProjectId: scope.activeProjectId,
      actionOnRepositories: async (repositories) => {
        // 1. one authoritative boundary: lock the current context revision.
        const record = await repositories.contexts.lockCurrent(request.reviewContextId);
        if (!record) {
          reviewFailure('REVIEW_CONTEXT_NOT_FOUND', 'The Review Context was not found.');
        }
        if (record.context.resourceProjectId !== scope.activeProjectId) {
          reviewFailure('REVIEW_CONTEXT_NOT_FOUND', 'The Review Context was not found.');
        }
        // 2. expected context revision validation.
        if (record.context.contextRevision !== request.expectedContextRevision) {
          reviewFailure(
            'REVIEW_CONTEXT_STALE',
            `Expected context revision ${request.expectedContextRevision} but the current revision is ${record.context.contextRevision}.`,
          );
        }
        // 3. target revision and digest validation.
        if (
          record.context.targetRevision !== request.expectedTargetRevision ||
          record.context.targetDigest !== request.expectedTargetDigest
        ) {
          reviewFailure(
            'REVIEW_TARGET_CHANGED',
            'The reviewed target changed since this Review Context was generated.',
          );
        }
        // 4. access, policy and target revalidation against the live source.
        if (record.context.accessRevision !== scope.accessRevision) {
          reviewFailure(
            'REVIEW_ACCESS_CHANGED',
            'The access scope changed since this Review Context was generated.',
          );
        }
        if (record.context.policyContextRevision !== scope.policyContextRevision) {
          reviewFailure(
            'REVIEW_POLICY_CHANGED',
            'The policy context changed since this Review Context was generated.',
          );
        }
        const adapter = this.adapterFor(record.context.targetKind);
        const source = await adapter.findSourceTarget(
          scope.activeProjectId,
          record.reviewResourceId,
        );
        if (!source) {
          reviewFailure('REVIEW_TARGET_CHANGED', 'The reviewed target is no longer available.');
        }
        if (
          source.targetRevision !== record.sourceRevision ||
          source.targetDigest !== record.sourceDigest
        ) {
          reviewFailure(
            'REVIEW_TARGET_CHANGED',
            'The reviewed target changed since this Review Context was generated.',
          );
        }
        if (await this.evidenceChanged(adapter, scope, source, record.context)) {
          reviewFailure(
            'REVIEW_EVIDENCE_CHANGED',
            'The Evidence artifact changed since this Review Context was generated.',
          );
        }
        // 5. validate and append decisions.
        const existingDecisions = await repositories.decisions.findDecisions(
          request.reviewContextId,
        );
        const currentDecisions = this.decisionsForRevision(
          existingDecisions,
          request.expectedContextRevision,
        );
        const priorApproved = new Set(
          record.context.items
            .filter(
              (item) => deriveItemDecisionState(item.reviewItemId, currentDecisions) === 'APPROVED',
            )
            .map((item) => item.reviewItemId),
        );
        const now = this.nowIso();
        const newDecisions: ReviewDecisionRecordV1[] = [];
        for (const input of request.itemDecisions) {
          const item = record.context.items.find(
            (candidate) => candidate.reviewItemId === input.reviewItemId,
          );
          if (!item) {
            reviewFailure(
              'REVIEW_ITEM_NOT_FOUND',
              `Review Item '${input.reviewItemId}' was not found.`,
            );
          }
          if (!item.allowedDecisions.includes(input.intent)) {
            reviewFailure(
              'REVIEW_DECISION_NOT_ALLOWED',
              `Decision '${input.intent}' is not allowed for Review Item '${input.reviewItemId}'.`,
            );
          }
          const state = deriveItemDecisionState(input.reviewItemId, currentDecisions);
          if (state === 'APPROVED' || state === 'REJECTED' || state === 'REVISION_REQUESTED') {
            reviewFailure(
              'REVIEW_DECISION_NOT_ALLOWED',
              `Review Item '${input.reviewItemId}' already has a terminal decision on this context revision.`,
            );
          }
          if (
            input.intent !== 'HOLD' &&
            (input.reason === undefined || input.reason.trim().length === 0)
          ) {
            reviewFailure(
              'VALIDATION_FAILED',
              `Terminal decision '${input.intent}' requires a non-empty reason.`,
            );
          }
          newDecisions.push({
            schemaVersion: '1.0.0',
            decisionId: generatedIdentity('review-decision'),
            reviewContextId: request.reviewContextId,
            contextRevision: request.expectedContextRevision,
            reviewItemId: input.reviewItemId,
            intent: input.intent,
            ...(input.reason === undefined ? {} : { reason: input.reason }),
            decidedBy: {
              schemaVersion: '1.0.0',
              principalId: scope.principalId,
              actorId: scope.principalId,
            },
            decidedAt: now,
            terminal: isTerminalDecisionIntent(input.intent),
          });
        }
        await repositories.decisions.appendDecisions(newDecisions);
        let comment: ReviewCommentRecordV1 | undefined;
        if (request.comment !== undefined && request.comment.trim().length > 0) {
          comment = {
            schemaVersion: '1.0.0',
            commentId: generatedIdentity('review-comment'),
            reviewContextId: request.reviewContextId,
            contextRevision: request.expectedContextRevision,
            text: request.comment,
            authoredBy: {
              schemaVersion: '1.0.0',
              principalId: scope.principalId,
              actorId: scope.principalId,
            },
            authoredAt: now,
          };
          await repositories.decisions.appendComment(comment);
        }
        // 6. dependency-closure-safe partial approval / candidate authoring.
        const approvedItemIds = new Set(
          request.itemDecisions
            .filter((input) => input.intent === 'APPROVE')
            .map((input) => input.reviewItemId),
        );
        const approvals: ReviewApprovalV1[] = [];
        let acceptedForAuthoring: boolean | undefined;
        let revisionRequestReturnTarget: ReviewRevisionReturnTargetV1 | undefined;
        if (approvedItemIds.size > 0) {
          const closure = validateProposedApprovalSet({
            items: record.context.items,
            dependencies: record.context.dependencies,
            approvedItemIds,
            previouslyApproved: priorApproved,
          });
          if (record.context.targetKind === 'DISCOVERY_CANDIDATE') {
            acceptedForAuthoring = true;
          } else {
            const purpose =
              record.context.targetKind === 'KNOWLEDGE_DRAFT_CHANGE_SET'
                ? 'KNOWLEDGE_CANONICAL_CHANGE'
                : 'USER_DIRECTIVE_CHANGE';
            const approvalId = generatedIdentity('review-approval');
            const approval: ReviewApprovalV1 = {
              schemaVersion: '1.0.0',
              approvalId,
              purpose,
              reviewContextId: request.reviewContextId,
              contextRevision: request.expectedContextRevision,
              targetKind: record.context.targetKind,
              targetId: record.context.targetId,
              targetRevision: record.context.targetRevision,
              targetDigest: record.context.targetDigest,
              approvedItemIds: closure,
              approvedManifestDigest: reviewApprovalManifestDigest({
                approvedItemIds: closure,
                reviewContextId: request.reviewContextId,
                contextRevision: request.expectedContextRevision,
                targetRevision: record.context.targetRevision,
                targetDigest: record.context.targetDigest,
                purpose,
              }),
              actor: {
                schemaVersion: '1.0.0',
                principalId: scope.principalId,
                actorId: scope.principalId,
              },
              projectId: scope.activeProjectId,
              accessRevision: scope.accessRevision,
              policyContextRevision: scope.policyContextRevision,
              reason: 'Item-level Review approval issued without Commit or Apply.',
              issuedAt: now,
              expiresAt: new Date(Date.parse(now) + FRONTEND_REVIEW_APPROVAL_TTL_MS).toISOString(),
              status: 'ACTIVE',
            };
            await repositories.approvals.insert(approval);
            approvals.push(approval);
          }
        }
        if (request.itemDecisions.some((input) => input.intent === 'REQUEST_REVISION')) {
          if (record.context.targetKind === 'USER_DIRECTIVE_PROPOSAL') {
            reviewFailure(
              'REVIEW_REVISION_ROUTE_UNAVAILABLE',
              'Directive authoring is not available in FE-P4-S1.',
            );
          }
          revisionRequestReturnTarget = {
            schemaVersion: '1.0.0',
            workspace: 'KNOWLEDGE_EDITOR',
            resourceId: record.context.targetId,
            draftId: record.context.targetId,
            draftRevision: Number(record.context.targetRevision),
            reason: 'Return to the Knowledge Editor to revise the Draft before resubmission.',
          };
        }
        const allDecisions = [...currentDecisions, ...newDecisions];
        const aggregateState = computeAggregateState({
          items: record.context.items,
          decisions: allDecisions,
          contextRevision: request.expectedContextRevision,
          targetKind: record.context.targetKind,
        });
        return {
          reviewContextId: request.reviewContextId,
          contextRevision: request.expectedContextRevision,
          decisions: newDecisions,
          aggregateState,
          approvals,
          ...(acceptedForAuthoring === undefined ? {} : { acceptedForAuthoring }),
          ...(revisionRequestReturnTarget === undefined ? {} : { revisionRequestReturnTarget }),
          ...(comment === undefined ? {} : { comment }),
        };
      },
      onReplay: async () => {
        const completed = await this.completedDecisionsFromOutcome(scope, request);
        if (!completed) {
          reviewFailure(
            'OUTCOME_INDETERMINATE',
            'The previous command completed but its Review outcome is unavailable.',
          );
        }
        return completed;
      },
      producedResources: (written) => [
        {
          resourceKind: FRONTEND_REVIEW_RESOURCE_KIND.context,
          resourceId: written.reviewContextId,
          resourceRevision: String(written.contextRevision),
        },
        ...written.approvals.map((approval) => ({
          resourceKind: FRONTEND_REVIEW_RESOURCE_KIND.approval,
          resourceId: approval.approvalId,
        })),
        ...(written.comment === undefined
          ? []
          : [
              {
                resourceKind: FRONTEND_REVIEW_RESOURCE_KIND.comment,
                resourceId: written.comment.commentId,
              },
            ]),
      ],
    });
    return {
      schemaVersion: '1.0.0',
      outcome: 'COMPLETED',
      clientRequestId: request.clientRequestId,
      idempotencyKey: request.idempotencyKey,
      commandSemanticDigest,
      reviewContextId: written.reviewContextId,
      contextRevision: written.contextRevision,
      decisions: written.decisions,
      aggregateState: written.aggregateState,
      ...(written.approvals.length === 0 ? {} : { approvals: written.approvals }),
      ...(written.acceptedForAuthoring === undefined
        ? {}
        : { acceptedForAuthoring: written.acceptedForAuthoring }),
      ...(written.revisionRequestReturnTarget === undefined
        ? {}
        : { revisionRequestReturnTarget: written.revisionRequestReturnTarget }),
    };
  }

  async addReviewComment(
    scope: FrontendReviewScopeV1,
    request: AddReviewCommentRequestV1,
  ): Promise<AddReviewCommentResultV1> {
    const commandSemanticDigest = frontendReviewAddCommentDigest(request);
    const written = await this.runCommand<ReviewCommentRecordV1>({
      scope,
      commandType: FRONTEND_REVIEW_COMMAND_TYPES.addComment,
      request,
      commandSemanticDigest,
      resourceProjectId: scope.activeProjectId,
      actionOnRepositories: async (repositories) => {
        const record = await repositories.contexts.findCurrent(request.reviewContextId);
        if (!record) {
          reviewFailure('REVIEW_CONTEXT_NOT_FOUND', 'The Review Context was not found.');
        }
        if (record.context.resourceProjectId !== scope.activeProjectId) {
          reviewFailure('REVIEW_CONTEXT_NOT_FOUND', 'The Review Context was not found.');
        }
        if (record.context.contextRevision !== request.contextRevision) {
          reviewFailure(
            'REVIEW_CONTEXT_STALE',
            `Expected context revision ${request.contextRevision} but the current revision is ${record.context.contextRevision}.`,
          );
        }
        if (
          request.reviewItemId !== undefined &&
          !record.context.items.some((item) => item.reviewItemId === request.reviewItemId)
        ) {
          reviewFailure('REVIEW_ITEM_NOT_FOUND', 'The Review Item was not found.');
        }
        const comment: ReviewCommentRecordV1 = {
          schemaVersion: '1.0.0',
          commentId: generatedIdentity('review-comment'),
          reviewContextId: request.reviewContextId,
          contextRevision: request.contextRevision,
          ...(request.reviewItemId === undefined ? {} : { reviewItemId: request.reviewItemId }),
          text: request.comment,
          authoredBy: {
            schemaVersion: '1.0.0',
            principalId: scope.principalId,
            actorId: scope.principalId,
          },
          authoredAt: this.nowIso(),
        };
        await repositories.decisions.appendComment(comment);
        return comment;
      },
      onReplay: async () => {
        const comment = await this.commentFromOutcome(scope, request);
        if (!comment) {
          reviewFailure(
            'OUTCOME_INDETERMINATE',
            'The previous command completed but its comment is unavailable.',
          );
        }
        return comment;
      },
      producedResources: (comment) => [
        {
          resourceKind: FRONTEND_REVIEW_RESOURCE_KIND.context,
          resourceId: request.reviewContextId,
          resourceRevision: String(request.contextRevision),
        },
        {
          resourceKind: FRONTEND_REVIEW_RESOURCE_KIND.comment,
          resourceId: comment.commentId,
        },
      ],
    });
    return {
      schemaVersion: '1.0.0',
      outcome: 'COMPLETED',
      clientRequestId: request.clientRequestId,
      idempotencyKey: request.idempotencyKey,
      commandSemanticDigest,
      comment: written,
    };
  }

  // -------------------------------------------------------------------------
  // Outcome recovery
  // -------------------------------------------------------------------------

  async resolveCommandOutcome(
    scope: FrontendReviewScopeV1,
    request: ResolveReviewCommandOutcomeRequestV1,
  ): Promise<ResolveReviewCommandOutcomeResultV1> {
    const outcome = await this.commandGateway.findByClientRequestId(
      scope.principalId,
      request.clientRequestId,
    );
    if (!outcome) {
      reviewFailure(
        'OUTCOME_NOT_FOUND',
        'No command outcome matches the original request identity.',
      );
    }
    if (!isReviewCommandType(outcome.commandType)) {
      reviewFailure('OUTCOME_NOT_FOUND', 'The command outcome is not a Review command.');
    }
    if (outcome.idempotencyKey !== request.idempotencyKey) {
      reviewFailure(
        'OUTCOME_NOT_FOUND',
        'The command outcome does not match the requested idempotency key.',
      );
    }
    if (outcome.commandSemanticDigest !== request.semanticDigest) {
      reviewFailure(
        'DIGEST_MISMATCH',
        'The command semantic digest does not match the original request.',
      );
    }
    if (this.outcomeTargetProjectId(outcome) !== scope.activeProjectId) {
      reviewFailure(
        'COMMAND_SCOPE_MISMATCH',
        'The command outcome belongs to another Project scope.',
      );
    }
    if (outcome.outcomeState === 'COMPLETED') {
      const completed = await this.completedFromOutcome(outcome);
      return {
        schemaVersion: '1.0.0',
        outcome: 'COMPLETED',
        originalClientRequestId: outcome.clientRequestId,
        originalIdempotencyKey: outcome.idempotencyKey,
        completed,
      };
    }
    if (outcome.outcomeState === 'REJECTED') {
      return {
        schemaVersion: '1.0.0',
        outcome: 'REJECTED',
        originalClientRequestId: outcome.clientRequestId,
        originalIdempotencyKey: outcome.idempotencyKey,
        rejection: {
          code: outcome.rejection?.code ?? 'INTERNAL_UNCLASSIFIED',
          message: outcome.rejection?.message ?? 'The Review command was rejected.',
        },
      };
    }
    return {
      schemaVersion: '1.0.0',
      outcome: 'OUTCOME_UNKNOWN',
      originalClientRequestId: outcome.clientRequestId,
      originalIdempotencyKey: outcome.idempotencyKey,
    };
  }

  private async completedFromOutcome(
    outcome: Awaited<ReturnType<FrontendReviewCommandGatewayPort['findByClientRequestId']>>,
  ): Promise<NonNullable<ResolveReviewCommandOutcomeResultV1['completed']>> {
    if (!outcome) {
      reviewFailure('OUTCOME_NOT_FOUND', 'The command outcome is unavailable.');
    }
    if (outcome.commandType === FRONTEND_REVIEW_COMMAND_TYPES.recordDecisions) {
      const result = await this.boundary.transaction(async (repositories) => {
        const contextRef = this.producedResource(outcome, FRONTEND_REVIEW_RESOURCE_KIND.context);
        if (!contextRef) {
          reviewFailure(
            'OUTCOME_NOT_FOUND',
            'The Review context resource is missing from the outcome.',
          );
        }
        const record = await repositories.contexts.findCurrent(contextRef.resourceId);
        if (!record) {
          reviewFailure('OUTCOME_NOT_FOUND', 'The Review context is missing.');
        }
        const approvalIds = outcome.producedResources
          .filter((resource) => resource.resourceKind === FRONTEND_REVIEW_RESOURCE_KIND.approval)
          .map((resource) => resource.resourceId);
        const approvals: ReviewApprovalV1[] = [];
        for (const approvalId of approvalIds) {
          const approval = await repositories.approvals.findById(approvalId);
          if (approval) approvals.push(approval);
        }
        const decisions = await repositories.decisions.findDecisions(
          record.context.reviewContextId,
        );
        const aggregateState = computeAggregateState({
          items: record.context.items,
          decisions,
          contextRevision: record.context.contextRevision,
          targetKind: record.context.targetKind,
        });
        const acceptedForAuthoring =
          record.context.targetKind === 'DISCOVERY_CANDIDATE' &&
          aggregateState === 'ACCEPTED_FOR_AUTHORING'
            ? true
            : undefined;
        return {
          schemaVersion: '1.0.0' as const,
          outcome: 'COMPLETED' as const,
          clientRequestId: outcome.clientRequestId,
          idempotencyKey: outcome.idempotencyKey,
          commandSemanticDigest: outcome.commandSemanticDigest,
          reviewContextId: record.context.reviewContextId,
          contextRevision: record.context.contextRevision,
          decisions: this.decisionsForRevision(decisions, record.context.contextRevision),
          aggregateState,
          ...(approvals.length === 0 ? {} : { approvals }),
          ...(acceptedForAuthoring === undefined ? {} : { acceptedForAuthoring }),
        } satisfies RecordReviewDecisionsResultV1;
      });
      return { commandType: FRONTEND_REVIEW_COMMAND_TYPES.recordDecisions, result };
    }
    if (outcome.commandType === FRONTEND_REVIEW_COMMAND_TYPES.addComment) {
      const result = await this.boundary.transaction(async (repositories) => {
        const contextRef = this.producedResource(outcome, FRONTEND_REVIEW_RESOURCE_KIND.context);
        if (!contextRef) {
          reviewFailure(
            'OUTCOME_NOT_FOUND',
            'The Review context resource is missing from the outcome.',
          );
        }
        const commentRef = this.producedResource(outcome, FRONTEND_REVIEW_RESOURCE_KIND.comment);
        if (!commentRef) {
          reviewFailure('OUTCOME_NOT_FOUND', 'The comment resource is missing from the outcome.');
        }
        const record = await repositories.contexts.findCurrent(contextRef.resourceId);
        if (!record) {
          reviewFailure('OUTCOME_NOT_FOUND', 'The Review context is missing.');
        }
        const comments = await repositories.decisions.findComments(contextRef.resourceId);
        const comment = comments.find((candidate) => candidate.commentId === commentRef.resourceId);
        if (!comment) {
          reviewFailure('OUTCOME_NOT_FOUND', 'The comment is missing.');
        }
        return {
          schemaVersion: '1.0.0' as const,
          outcome: 'COMPLETED' as const,
          clientRequestId: outcome.clientRequestId,
          idempotencyKey: outcome.idempotencyKey,
          commandSemanticDigest: outcome.commandSemanticDigest,
          comment,
        } satisfies AddReviewCommentResultV1;
      });
      return { commandType: FRONTEND_REVIEW_COMMAND_TYPES.addComment, result };
    }
    if (outcome.commandType === FRONTEND_REVIEW_COMMAND_TYPES.revalidateContext) {
      const result = await this.boundary.transaction(async (repositories) => {
        const contextRef = this.producedResource(outcome, FRONTEND_REVIEW_RESOURCE_KIND.context);
        if (!contextRef) {
          reviewFailure(
            'OUTCOME_NOT_FOUND',
            'The Review context resource is missing from the outcome.',
          );
        }
        const record = await repositories.contexts.findCurrent(contextRef.resourceId);
        if (!record) {
          reviewFailure('OUTCOME_NOT_FOUND', 'The Review context is missing.');
        }
        return {
          schemaVersion: '1.0.0' as const,
          outcome: 'COMPLETED' as const,
          clientRequestId: outcome.clientRequestId,
          idempotencyKey: outcome.idempotencyKey,
          commandSemanticDigest: outcome.commandSemanticDigest,
          context: record.context,
        } satisfies RevalidateReviewContextResultV1;
      });
      return { commandType: FRONTEND_REVIEW_COMMAND_TYPES.revalidateContext, result };
    }
    reviewFailure('OUTCOME_NOT_FOUND', 'The command outcome is not a Review command.');
  }

  private async completedDecisionsFromOutcome(
    scope: FrontendReviewScopeV1,
    request: RecordReviewDecisionsRequestV1,
  ): Promise<RecordReviewDecisionsWrittenV1 | undefined> {
    const outcome = await this.commandGateway.findByClientRequestId(
      scope.principalId,
      request.clientRequestId,
    );
    if (!outcome || outcome.outcomeState !== 'COMPLETED') return undefined;
    if (
      outcome.commandType !== FRONTEND_REVIEW_COMMAND_TYPES.recordDecisions ||
      outcome.idempotencyKey !== request.idempotencyKey ||
      outcome.commandSemanticDigest !== frontendReviewRecordDecisionsDigest(request)
    ) {
      return undefined;
    }
    const completed = await this.completedFromOutcome(outcome);
    if (completed.commandType !== FRONTEND_REVIEW_COMMAND_TYPES.recordDecisions) return undefined;
    const result = completed.result;
    return {
      reviewContextId: result.reviewContextId,
      contextRevision: result.contextRevision,
      decisions: result.decisions,
      aggregateState: result.aggregateState,
      approvals: result.approvals ?? [],
      ...(result.acceptedForAuthoring === undefined
        ? {}
        : { acceptedForAuthoring: result.acceptedForAuthoring }),
      ...(result.revisionRequestReturnTarget === undefined
        ? {}
        : { revisionRequestReturnTarget: result.revisionRequestReturnTarget }),
    };
  }

  private async commentFromOutcome(
    scope: FrontendReviewScopeV1,
    request: AddReviewCommentRequestV1,
  ): Promise<ReviewCommentRecordV1 | undefined> {
    const outcome = await this.commandGateway.findByClientRequestId(
      scope.principalId,
      request.clientRequestId,
    );
    if (!outcome || outcome.outcomeState !== 'COMPLETED') return undefined;
    if (
      outcome.commandType !== FRONTEND_REVIEW_COMMAND_TYPES.addComment ||
      outcome.idempotencyKey !== request.idempotencyKey ||
      outcome.commandSemanticDigest !== frontendReviewAddCommentDigest(request)
    ) {
      return undefined;
    }
    const completed = await this.completedFromOutcome(outcome);
    if (completed.commandType !== FRONTEND_REVIEW_COMMAND_TYPES.addComment) return undefined;
    return completed.result.comment;
  }

  private async contextRecordAfterReplay(
    scope: FrontendReviewScopeV1,
    reviewContextId: string,
  ): Promise<ReviewContextRecordV1> {
    return this.boundary.transaction(async (repositories) => {
      const record = await repositories.contexts.findCurrent(reviewContextId);
      if (!record) {
        reviewFailure('REVIEW_CONTEXT_NOT_FOUND', 'The Review Context was not found.');
      }
      if (record.context.resourceProjectId !== scope.activeProjectId) {
        reviewFailure('REVIEW_CONTEXT_NOT_FOUND', 'The Review Context was not found.');
      }
      return record;
    });
  }

  // -------------------------------------------------------------------------
  // Evidence revalidation
  // -------------------------------------------------------------------------

  private async evidenceChanged(
    adapter: ReviewTargetAdapterPort,
    scope: FrontendReviewScopeV1,
    source: ReviewSourceTargetV1,
    context: ReviewContextRecordV1['context'],
  ): Promise<boolean> {
    const evidenceRef = context.artifactRefs.evidence;
    if (evidenceRef === undefined) return false;
    const currentDigest = await adapter.currentEvidenceDigest({ scope, source });
    return currentDigest !== evidenceRef.digest;
  }

  // -------------------------------------------------------------------------
  // Command ledger lifecycle
  // -------------------------------------------------------------------------

  private async runCommand<T>(input: FrontendReviewRunCommandInput<T>): Promise<T> {
    const now = this.nowIso();
    const commandId = generatedIdentity('cmd');
    let accepted;
    try {
      accepted = await this.commandGateway.accept({
        commandId,
        commandRevision: '1',
        principalId: input.scope.principalId,
        request: {
          envelopeVersion: '1.0.0',
          commandType: input.commandType,
          commandSchemaVersion: FRONTEND_REVIEW_API_VERSION,
          clientRequestId: input.request.clientRequestId,
          idempotencyKey: input.request.idempotencyKey,
          projectContext: {
            activeProjectId: input.scope.activeProjectId,
            targetProjectId: input.resourceProjectId,
            resourceProjectId: input.resourceProjectId,
            observedProjectAccessRevision: input.scope.accessRevision,
          },
          policyBinding: {
            mode: 'CURRENT',
            observedPolicyContextRevision: input.scope.policyContextRevision,
          },
          preconditions: input.preconditions ?? [],
          clientIssuedAt: now,
          payload: input.request,
        },
        commandSemanticDigest: input.commandSemanticDigest,
        acceptedPolicyContext: {
          policyContextId: 'frontend-review-current-policy',
          policyContextRevision: input.scope.policyContextRevision,
          acceptedAt: now,
        },
        correlationId: generatedIdentity('corr'),
        traceId: generatedIdentity('trace'),
        receivedAt: now,
        acceptedAt: now,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error.code === 'IDEMPOTENCY_KEY_REUSE_MISMATCH' ||
          error.code === 'CLIENT_REQUEST_MEANING_MISMATCH')
      ) {
        reviewFailure(
          'DIGEST_MISMATCH',
          'The request identity is already bound to different command meaning.',
        );
      }
      throw error;
    }

    const outcome = accepted.outcome;
    if (accepted.replayed) {
      if (outcome.outcomeState === 'COMPLETED') {
        if (input.onReplay) return input.onReplay();
        reviewFailure(
          'OUTCOME_INDETERMINATE',
          'The command completed but its outcome is unavailable.',
        );
      }
      if (outcome.outcomeState === 'REJECTED') {
        throw new ReviewCommandError(
          (outcome.rejection?.code as ErrorCode) ?? 'REVIEW_CONTEXT_STALE',
          outcome.rejection?.message ?? 'The Review command was rejected.',
        );
      }
      reviewFailure(
        'OUTCOME_INDETERMINATE',
        'The previous command outcome is unresolved; resolve it through the original command identity before retrying.',
      );
    }

    try {
      return await this.boundary.transactionWithHandle(async (handle) => {
        const locked = await this.commandGateway.lockAcceptedForExecution(
          handle.raw,
          outcome.commandId,
        );
        if (locked.outcomeState === 'COMPLETED') {
          if (input.onReplay) return input.onReplay();
          reviewFailure(
            'OUTCOME_INDETERMINATE',
            'The command completed concurrently but its outcome is unavailable.',
          );
        }
        const written = await input.actionOnRepositories(handle.repositories);
        await this.commandGateway.completeInTransaction(handle.raw, {
          commandId: outcome.commandId,
          producedResources: input.producedResources(written),
          completedAt: this.nowIso(),
        });
        return written;
      });
    } catch (error) {
      try {
        if (error instanceof ReviewCommandError) {
          await this.commandGateway.reject({
            commandId: outcome.commandId,
            code: error.apiCode,
            message: error.message,
            completedAt: this.nowIso(),
          });
        } else {
          await this.commandGateway.markOutcomeUnknown({
            commandId: outcome.commandId,
            message:
              error instanceof Error ? error.message : 'Review command outcome is unresolved.',
            completedAt: this.nowIso(),
          });
        }
      } catch {
        // Preserve the original error when the ledger write is unavailable.
      }
      throw error;
    }
  }

  private producedResource(
    outcome: Awaited<ReturnType<FrontendReviewCommandGatewayPort['findByClientRequestId']>>,
    resourceKind: string,
  ): { readonly resourceId: string; readonly resourceRevision?: string } | undefined {
    if (!outcome) return undefined;
    return outcome.producedResources.find((resource) => resource.resourceKind === resourceKind);
  }

  private outcomeTargetProjectId(
    outcome: Awaited<ReturnType<FrontendReviewCommandGatewayPort['findByClientRequestId']>>,
  ): string {
    if (!outcome) {
      reviewFailure('COMMAND_SCOPE_MISMATCH', 'The command outcome is missing.');
    }
    const context = outcome.acceptedProjectContext;
    if ('targetProjectId' in context && typeof context.targetProjectId === 'string') {
      return context.targetProjectId;
    }
    reviewFailure('COMMAND_SCOPE_MISMATCH', 'The command outcome is missing its Project binding.');
  }

  private decisionsForRevision(
    decisions: readonly ReviewDecisionRecordV1[],
    contextRevision: number,
  ): readonly ReviewDecisionRecordV1[] {
    return decisions.filter((decision) => decision.contextRevision === contextRevision);
  }

  private commentsForRevision(
    comments: readonly ReviewCommentRecordV1[],
    contextRevision: number,
  ): readonly ReviewCommentRecordV1[] {
    return comments.filter((comment) => comment.contextRevision === contextRevision);
  }
}
