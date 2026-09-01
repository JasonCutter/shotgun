import { randomUUID } from 'node:crypto';

import {
  FRONTEND_REVIEW_API_VERSION,
  FRONTEND_REVIEW_COMMAND_TYPES,
  REVIEW_CONTEXT_ITEM_MAX,
  REVIEW_DEPENDENCY_EDGE_MAX,
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
  type ReviewContextRevisionV1,
  type ReviewDecisionRecordV1,
  type ReviewQueueItemV1,
  type ReviewRevisionReturnTargetV1,
  type ReviewTargetKindV1,
  type TypedPrecondition,
} from '../../../packages/contracts/src/index.js';
import { reviewFailure, ReviewCommandError } from './review-error.js';
import {
  applySensitivityMasking,
  canReadSensitivity,
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
  draft: 'frontend.knowledge.draft',
} as const;

export type FrontendReviewAcceptedForAuthoringBridgeV1 = {
  materialize(input: {
    readonly transaction: unknown;
    readonly repositories: ReviewTransactionRepositoriesV1;
    readonly scope: FrontendReviewScopeV1;
    readonly context: ReviewContextRevisionV1;
    readonly source: ReviewSourceTargetV1;
    readonly approvedItemIds: readonly string[];
    readonly now: string;
  }): Promise<{
    readonly draftId: string;
    readonly draftRevision: number;
    readonly resourceProjectId: string;
    readonly effectiveProjectId: string;
  }>;
};

/** Shape returned by the record-decisions completion action. */
export type RecordReviewDecisionsWrittenV1 = {
  readonly reviewContextId: string;
  readonly contextRevision: number;
  readonly decisions: readonly ReviewDecisionRecordV1[];
  readonly aggregateState: RecordReviewDecisionsResultV1['aggregateState'];
  readonly approvals: readonly ReviewApprovalV1[];
  readonly acceptedForAuthoring?: boolean;
  readonly draft?: {
    readonly draftId: string;
    readonly draftRevision: number;
    readonly resourceProjectId: string;
    readonly effectiveProjectId: string;
  };
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

/**
 * Membership scopes that grant Review access. The Browser never submits these;
 * they come from the server-derived membership `accessScope`. `review` grants
 * reviewing (queue, context, item, decisions, comments, revalidation and
 * outcome resolution); Approval-resource reads additionally require an
 * approval-granting scope (`owner`, `admin` or `action:approve`).
 */
export const REVIEW_ACCESS_SCOPES: ReadonlySet<string> = new Set(['owner', 'admin', 'review']);
export const REVIEW_APPROVAL_SCOPES: ReadonlySet<string> = new Set([
  'owner',
  'admin',
  'action:approve',
]);

/**
 * Review capabilities granted by a server-derived scope. Approval reads are
 * gated by an approval-granting scope and are never advertised otherwise.
 */
export const reviewCapabilitiesForScope = (
  scope: FrontendReviewScopeV1,
): readonly ReviewCapabilityV1[] => {
  const granted = scope.accessScope ?? [];
  const hasReviewAccess = granted.some((entry) => REVIEW_ACCESS_SCOPES.has(entry));
  if (!hasReviewAccess) return [];
  const capabilities: ReviewCapabilityV1[] = [
    'LIST_QUEUE',
    'READ_CONTEXT',
    'READ_ITEM',
    'REVALIDATE',
    'RECORD_DECISIONS',
    'ADD_COMMENT',
    'RESOLVE_OUTCOME',
  ];
  const canApprove = granted.some((entry) => REVIEW_APPROVAL_SCOPES.has(entry));
  if (canApprove) {
    capabilities.push('READ_APPROVAL');
  }
  return capabilities;
};

type FrontendReviewRunCommandInput<T> = {
  readonly scope: FrontendReviewScopeV1;
  readonly commandType: (typeof FRONTEND_REVIEW_COMMAND_TYPES)[keyof typeof FRONTEND_REVIEW_COMMAND_TYPES];
  readonly request: { readonly clientRequestId: string; readonly idempotencyKey: string };
  readonly commandSemanticDigest: string;
  readonly resourceProjectId: string;
  readonly preconditions?: readonly TypedPrecondition[];
  readonly actionOnRepositories: (
    repositories: ReviewTransactionRepositoriesV1,
    transaction?: unknown,
  ) => Promise<T>;
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
    private readonly acceptedForAuthoringBridge?: FrontendReviewAcceptedForAuthoringBridgeV1,
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

  /**
   * Operation-level capability enforcement against the server-derived scope.
   * The Browser never declares its own capability; only membership scopes do.
   */
  private requireReviewCapability(
    scope: FrontendReviewScopeV1,
    capability: ReviewCapabilityV1,
  ): void {
    if (!reviewCapabilitiesForScope(scope).includes(capability)) {
      reviewFailure(
        'PROJECT_ACCESS_DENIED',
        `The current scope does not grant the '${capability}' Review capability.`,
      );
    }
  }

  /**
   * Fail-closed restricted shell for a Context whose access or policy scope
   * no longer matches the current scope. The protected payload is never
   * returned; only the restricted aggregate state is exposed.
   */
  private contextRestrictedView(
    context: ReviewContextRevisionV1,
    reason: string,
  ): ReviewContextRevisionV1 {
    return {
      ...context,
      items: [],
      dependencies: [],
      capabilities: [],
      aggregateState: 'ACCESS_RESTRICTED',
      staleReason: reason,
    };
  }

  /** Server-side read-time bound assertion for any stored Context (§18). */
  private assertContextBounds(context: ReviewContextRevisionV1): void {
    if (context.items.length > REVIEW_CONTEXT_ITEM_MAX) {
      reviewFailure(
        'VALIDATION_FAILED',
        `A Review Context cannot contain more than ${REVIEW_CONTEXT_ITEM_MAX} Items.`,
      );
    }
    if (context.dependencies.length > REVIEW_DEPENDENCY_EDGE_MAX) {
      reviewFailure(
        'VALIDATION_FAILED',
        `A Review Context cannot contain more than ${REVIEW_DEPENDENCY_EDGE_MAX} dependency edges.`,
      );
    }
  }

  /** Fail-closed access/policy revalidation for outcome/replay paths. */
  private assertContextReadableForScope(
    context: ReviewContextRevisionV1,
    scope: FrontendReviewScopeV1,
  ): void {
    if (context.resourceProjectId !== scope.activeProjectId) {
      reviewFailure('REVIEW_CONTEXT_NOT_FOUND', 'The Review Context was not found.');
    }
    if (
      context.accessRevision !== scope.accessRevision ||
      context.policyContextRevision !== scope.policyContextRevision
    ) {
      reviewFailure(
        'REVIEW_CONTEXT_NOT_FOUND',
        'The Review Context is not available to the current scope.',
      );
    }
  }

  /** Item IDs visible under the current sensitivity clearance. */
  private visibleItemIds(
    context: ReviewContextRevisionV1,
    scope: FrontendReviewScopeV1,
  ): ReadonlySet<string> {
    return new Set(applySensitivityMasking(context, scope).items.map((item) => item.reviewItemId));
  }

  /** Decision history filtered to the visible Item set (fail-closed). */
  private filterDecisionsByVisibility(
    decisions: readonly ReviewDecisionRecordV1[],
    visible: ReadonlySet<string>,
  ): ReviewDecisionRecordV1[] {
    return decisions.filter((decision) => visible.has(decision.reviewItemId));
  }

  /**
   * Comment history filtered to the visible Item set. Context-wide comments
   * (no `reviewItemId`) are treated as potentially referencing hidden content
   * and are omitted from transmission (fail-closed).
   */
  private filterCommentsByVisibility(
    comments: readonly ReviewCommentRecordV1[],
    visible: ReadonlySet<string>,
  ): ReviewCommentRecordV1[] {
    return comments.filter(
      (comment) => comment.reviewItemId !== undefined && visible.has(comment.reviewItemId),
    );
  }

  /** Fail-closed Approval read revalidation shared by read and outcome paths. */
  private assertApprovalReadable(approval: ReviewApprovalV1, scope: FrontendReviewScopeV1): void {
    if (
      approval.projectId !== scope.activeProjectId ||
      approval.accessRevision !== scope.accessRevision ||
      approval.policyContextRevision !== scope.policyContextRevision ||
      approval.status !== 'ACTIVE'
    ) {
      reviewFailure(
        'REVIEW_APPROVAL_NOT_ISSUED',
        'No Approval Resource matches the requested identity.',
      );
    }
    if (Date.parse(approval.expiresAt) <= Date.parse(this.nowIso())) {
      reviewFailure('REVIEW_APPROVAL_EXPIRED', 'The Approval Resource has expired.');
    }
  }

  private async materializeContext(
    repositories: ReviewTransactionRepositoriesV1,
    adapter: ReviewTargetAdapterPort,
    scope: FrontendReviewScopeV1,
    source: ReviewSourceTargetV1,
    contextRevision: number,
    generatedAt: string,
  ): Promise<ReviewContextRecordV1> {
    await this.assertDiscoveryFreshness(
      adapter,
      scope,
      source,
      'REVIEW_CONTEXT_MATERIALIZATION',
      generatedAt,
    );
    const reviewContextId = reviewContextIdForSource(adapter.targetKind, source.reviewResourceId);
    const materialized = await adapter.materializeContext({
      scope,
      source,
      reviewContextId,
      contextRevision,
      generatedAt,
    });
    // Frozen bounded-contract enforcement (Contract Snapshot §18): an
    // unbounded Item array or dependency graph must never be materialized.
    if (materialized.context.items.length > REVIEW_CONTEXT_ITEM_MAX) {
      reviewFailure(
        'VALIDATION_FAILED',
        `A Review Context cannot contain more than ${REVIEW_CONTEXT_ITEM_MAX} Items.`,
      );
    }
    if (materialized.context.dependencies.length > REVIEW_DEPENDENCY_EDGE_MAX) {
      reviewFailure(
        'VALIDATION_FAILED',
        `A Review Context cannot contain more than ${REVIEW_DEPENDENCY_EDGE_MAX} dependency edges.`,
      );
    }
    return {
      reviewResourceId: source.reviewResourceId,
      context: materialized.context,
      sourceRevision: source.targetRevision,
      sourceDigest: source.targetDigest,
      sourceUpdatedAt: source.updatedAt,
      materializedAt: generatedAt,
    };
  }

  private async assertDiscoveryFreshness(
    adapter: ReviewTargetAdapterPort,
    scope: FrontendReviewScopeV1,
    source: ReviewSourceTargetV1,
    stage: 'REVIEW_CONTEXT_MATERIALIZATION' | 'REVIEW_DECISION',
    assessedAt: string,
  ): Promise<void> {
    if (adapter.targetKind !== 'DISCOVERY_CANDIDATE' || adapter.assessFreshness === undefined) {
      return;
    }
    const assessment = await adapter.assessFreshness({ scope, source, stage, assessedAt });
    if (assessment.state === 'FRESH') return;
    if (assessment.state === 'AUTHORIZATION_DENIED') {
      reviewFailure('REVIEW_CONTEXT_NOT_FOUND', 'The Review Context was not found.');
    }
    if (assessment.state === 'PERSISTENCE_FAILURE') {
      reviewFailure(
        'REVIEW_TARGET_CHANGED',
        'The Discovery Review target could not be revalidated.',
      );
    }
    if (
      assessment.reasonCodes.includes('EVIDENCE_LINEAGE_CHANGED') ||
      assessment.reasonCodes.includes('EVIDENCE_UNAVAILABLE')
    ) {
      reviewFailure(
        'REVIEW_EVIDENCE_CHANGED',
        'The Discovery Evidence lineage changed since this Review Context was generated.',
      );
    }
    reviewFailure(
      'REVIEW_TARGET_CHANGED',
      'The Discovery Review target is stale and must be revalidated before review.',
    );
  }

  // -------------------------------------------------------------------------
  // Read operations
  // -------------------------------------------------------------------------

  async listReviewQueue(
    scope: FrontendReviewScopeV1,
    request: ListReviewQueueRequestV1,
  ): Promise<ListReviewQueueResultV1> {
    this.requireReviewCapability(scope, 'LIST_QUEUE');
    return this.boundary.transaction(async (repositories) => {
      const items: ReviewQueueItemV1[] = [];
      let enumerated = 0;
      for (const adapter of this.targetAdapters) {
        if (request.targetKinds && !request.targetKinds.includes(adapter.targetKind)) continue;
        const sources = await adapter.listSourceTargets(scope.activeProjectId, scope);
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
          this.assertContextBounds(record.context);
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
            itemCount: view.context.items.length,
            updatedAt: record.materializedAt,
            attentionReasons: attention,
            capabilities: reviewCapabilitiesForScope(scope),
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
        capabilities: reviewCapabilitiesForScope(scope),
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
    this.requireReviewCapability(scope, 'READ_CONTEXT');
    return this.boundary.transaction(async (repositories) => {
      const record = await repositories.contexts.findCurrent(request.reviewContextId);
      if (!record) {
        reviewFailure('REVIEW_CONTEXT_NOT_FOUND', 'The Review Context was not found.');
      }
      if (record.context.resourceProjectId !== scope.activeProjectId) {
        reviewFailure('REVIEW_CONTEXT_NOT_FOUND', 'The Review Context was not found.');
      }
      this.assertContextBounds(record.context);
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
        this.assertContextBounds(historical);
        // Historical reads are revalidated against the current access/policy
        // scope; a changed scope returns a restricted shell without the
        // protected payload (fail-closed, Contract Snapshot §10/§13).
        const scopeChanged =
          historical.accessRevision !== scope.accessRevision ||
          historical.policyContextRevision !== scope.policyContextRevision;
        if (scopeChanged) {
          return {
            schemaVersion: '1.0.0',
            context: this.contextRestrictedView(
              historical,
              'the access or policy scope changed since this context was generated',
            ),
            decisions: [],
            comments: [],
          };
        }
        const visible = this.visibleItemIds(historical, scope);
        return {
          schemaVersion: '1.0.0',
          context: applySensitivityMasking(historical, scope),
          decisions: this.filterDecisionsByVisibility(
            this.decisionsForRevision(decisions, request.contextRevision),
            visible,
          ),
          comments: this.filterCommentsByVisibility(
            this.commentsForRevision(comments, request.contextRevision),
            visible,
          ),
        };
      }
      // Fail closed before touching any source adapter: when the access or
      // policy scope changed, the protected payload is never resolved (§13).
      const scopeChanged =
        record.context.accessRevision !== scope.accessRevision ||
        record.context.policyContextRevision !== scope.policyContextRevision;
      if (scopeChanged) {
        return {
          schemaVersion: '1.0.0',
          context: this.contextRestrictedView(
            record.context,
            'the access or policy scope changed since this context was generated',
          ),
          decisions: [],
          comments: [],
        };
      }
      const adapter = this.adapterFor(record.context.targetKind);
      const currentSource = await adapter.findSourceTarget(
        scope.activeProjectId,
        record.reviewResourceId,
        scope,
      );
      const view = deriveContextView({ record, currentSource, scope, decisions });
      const visible = this.visibleItemIds(view.context, scope);
      return {
        schemaVersion: '1.0.0',
        context: view.context,
        decisions: this.filterDecisionsByVisibility(decisions, visible),
        comments: this.filterCommentsByVisibility(comments, visible),
      };
    });
  }

  async getReviewItemDetail(
    scope: FrontendReviewScopeV1,
    request: GetReviewItemDetailRequestV1,
  ): Promise<GetReviewItemDetailResultV1> {
    this.requireReviewCapability(scope, 'READ_ITEM');
    return this.boundary.transaction(async (repositories) => {
      const record = await repositories.contexts.findCurrent(request.reviewContextId);
      if (!record || record.context.resourceProjectId !== scope.activeProjectId) {
        reviewFailure('REVIEW_CONTEXT_NOT_FOUND', 'The Review Context was not found.');
      }
      this.assertContextBounds(record.context);
      if (record.context.contextRevision !== request.contextRevision) {
        const historical = await repositories.contexts.findRevision(
          request.reviewContextId,
          request.contextRevision,
        );
        if (!historical) {
          reviewFailure('REVIEW_CONTEXT_NOT_FOUND', 'The Review Context revision was not found.');
        }
        this.assertContextBounds(historical);
        // Historical Item detail is fail-closed when access/policy changed.
        const scopeChanged =
          historical.accessRevision !== scope.accessRevision ||
          historical.policyContextRevision !== scope.policyContextRevision;
        if (scopeChanged) {
          reviewFailure('REVIEW_ITEM_NOT_FOUND', 'The Review Item was not found.');
        }
        return this.itemDetailFromContext(
          repositories,
          historical,
          request.reviewItemId,
          request.contextRevision,
          scope,
        );
      }
      // Item detail is fail-closed when access/policy changed: returning any
      // Item content would confirm protected resource existence (§13).
      const scopeChanged =
        record.context.accessRevision !== scope.accessRevision ||
        record.context.policyContextRevision !== scope.policyContextRevision;
      if (scopeChanged) {
        reviewFailure('REVIEW_ITEM_NOT_FOUND', 'The Review Item was not found.');
      }
      const item = record.context.items.find(
        (candidate) => candidate.reviewItemId === request.reviewItemId,
      );
      if (!item) {
        reviewFailure('REVIEW_ITEM_NOT_FOUND', 'The Review Item was not found.');
      }
      if (!canReadSensitivity(scope.sensitivityClearance, item.sensitivity)) {
        reviewFailure('REVIEW_ITEM_NOT_FOUND', 'The Review Item was not found.');
      }
      const visible = this.visibleItemIds(record.context, scope);
      // Item detail projection: a visible Item that depends on hidden content
      // is returned as unavailable (MASKED) without leaking the hidden
      // identity (Contract Snapshot §5).
      const maskedItem =
        applySensitivityMasking(record.context, scope).items.find(
          (candidate) => candidate.reviewItemId === request.reviewItemId,
        ) ?? item;
      const adapter = this.adapterFor(record.context.targetKind);
      const source = await adapter.findSourceTarget(
        scope.activeProjectId,
        record.reviewResourceId,
        scope,
      );
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
        item: maskedItem,
        dependencies: this.dependenciesForItem(
          record.context.dependencies,
          request.reviewItemId,
        ).filter(
          (dependency) =>
            visible.has(dependency.fromReviewItemId) && visible.has(dependency.toReviewItemId),
        ),
        ...(evidence === undefined ? {} : { evidence }),
        ...(impact === undefined ? {} : { impact }),
        decisions: this.filterDecisionsByVisibility(
          this.decisionsForRevision(decisions, request.contextRevision),
          visible,
        ),
      };
    });
  }

  private async itemDetailFromContext(
    repositories: ReviewTransactionRepositoriesV1,
    context: ReviewContextRecordV1['context'],
    reviewItemId: string,
    contextRevision: number,
    scope: FrontendReviewScopeV1,
  ): Promise<GetReviewItemDetailResultV1> {
    const item = context.items.find((candidate) => candidate.reviewItemId === reviewItemId);
    if (!item) {
      reviewFailure('REVIEW_ITEM_NOT_FOUND', 'The Review Item was not found.');
    }
    if (!canReadSensitivity(scope.sensitivityClearance, item.sensitivity)) {
      reviewFailure('REVIEW_ITEM_NOT_FOUND', 'The Review Item was not found.');
    }
    const visible = new Set(
      context.items
        .filter((candidate) =>
          canReadSensitivity(scope.sensitivityClearance, candidate.sensitivity),
        )
        .map((candidate) => candidate.reviewItemId),
    );
    // Historical Item detail projection: a visible Item that depends on
    // hidden content is returned as unavailable (MASKED) without leaking the
    // hidden identity (Contract Snapshot §5).
    const maskedItem =
      applySensitivityMasking(context, scope).items.find(
        (candidate) => candidate.reviewItemId === reviewItemId,
      ) ?? item;
    const dependencies = this.dependenciesForItem(context.dependencies, reviewItemId).filter(
      (dependency) =>
        visible.has(dependency.fromReviewItemId) && visible.has(dependency.toReviewItemId),
    );
    const decisions = await repositories.decisions.findDecisions(context.reviewContextId);
    return {
      schemaVersion: '1.0.0',
      item: maskedItem,
      dependencies,
      decisions: this.filterDecisionsByVisibility(
        this.decisionsForRevision(decisions, contextRevision),
        visible,
      ),
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
    this.requireReviewCapability(scope, 'READ_APPROVAL');
    return this.boundary.transaction(async (repositories) => {
      const approvalRead = await repositories.approvals.findByIdWithRevision(request.approvalId);
      if (!approvalRead) {
        reviewFailure(
          'REVIEW_APPROVAL_NOT_ISSUED',
          'No Approval Resource matches the requested identity.',
        );
      }
      const { approval, approvalStatusRevision } = approvalRead;
      // Fail-closed revalidation: the Approval binds the access and policy
      // revisions that were current when it was issued (Contract Snapshot §8),
      // and remains ACTIVE and unexpired.
      this.assertApprovalReadable(approval, scope);
      return { schemaVersion: '1.0.0', approval, approvalStatusRevision };
    });
  }

  // -------------------------------------------------------------------------
  // Command operations
  // -------------------------------------------------------------------------

  async revalidateReviewContext(
    scope: FrontendReviewScopeV1,
    request: RevalidateReviewContextRequestV1,
  ): Promise<RevalidateReviewContextResultV1> {
    this.requireReviewCapability(scope, 'REVALIDATE');
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
          scope,
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
    this.requireReviewCapability(scope, 'RECORD_DECISIONS');
    const commandSemanticDigest = frontendReviewRecordDecisionsDigest(request);
    const written = await this.runCommand<RecordReviewDecisionsWrittenV1>({
      scope,
      commandType: FRONTEND_REVIEW_COMMAND_TYPES.recordDecisions,
      request,
      commandSemanticDigest,
      resourceProjectId: scope.activeProjectId,
      actionOnRepositories: async (repositories, transaction) => {
        // 1. one authoritative boundary: lock the current context revision.
        const record = await repositories.contexts.lockCurrent(request.reviewContextId);
        if (!record) {
          reviewFailure('REVIEW_CONTEXT_NOT_FOUND', 'The Review Context was not found.');
        }
        if (record.context.resourceProjectId !== scope.activeProjectId) {
          reviewFailure('REVIEW_CONTEXT_NOT_FOUND', 'The Review Context was not found.');
        }
        this.assertContextBounds(record.context);
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
          scope,
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
        await this.assertDiscoveryFreshness(
          adapter,
          scope,
          source,
          'REVIEW_DECISION',
          this.nowIso(),
        );
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
        // Fail-closed decision eligibility: an Item that is hidden by the
        // current sensitivity clearance, or that is projected unavailable
        // (MASKED) because it depends on hidden content, cannot be decided.
        const maskedWriteView = applySensitivityMasking(record.context, scope);
        const availableItemIds = new Set(
          maskedWriteView.items
            .filter((item) => item.accessMasking === 'VISIBLE')
            .map((item) => item.reviewItemId),
        );
        const newDecisions: ReviewDecisionRecordV1[] = [];
        for (const input of request.itemDecisions) {
          const item = record.context.items.find(
            (candidate) => candidate.reviewItemId === input.reviewItemId,
          );
          if (!item || !availableItemIds.has(input.reviewItemId)) {
            // Identity-free: never echo the submitted Item ID (it may be
            // hidden or projected unavailable).
            reviewFailure('REVIEW_ITEM_NOT_FOUND', 'The Review Item was not found.');
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
          // Typed return target per Contract Snapshot §11: Knowledge Draft
          // revision returns to the Knowledge Editor, User Directive revision
          // returns to the Directive authoring Workspace (AC-26).
          revisionRequestReturnTarget =
            record.context.targetKind === 'USER_DIRECTIVE_PROPOSAL'
              ? {
                  schemaVersion: '1.0.0',
                  workspace: 'DIRECTIVE_AUTHORING',
                  resourceId: record.context.targetId,
                  draftId: record.context.targetId,
                  draftRevision: Number(record.context.targetRevision),
                  reason:
                    'Return to Directive authoring to revise the Proposal before resubmission.',
                }
              : {
                  schemaVersion: '1.0.0',
                  workspace: 'KNOWLEDGE_EDITOR',
                  resourceId: record.context.targetId,
                  draftId: record.context.targetId,
                  draftRevision: Number(record.context.targetRevision),
                  reason: 'Return to the Knowledge Editor to revise the Draft before resubmission.',
                };
        }
        const allDecisions = [...currentDecisions, ...newDecisions];
        // Aggregate state is computed from the scope-visible Items and
        // Decisions only; hidden Item state never shapes the response.
        const aggregateState = computeAggregateState({
          items: maskedWriteView.items,
          decisions: allDecisions.filter((decision) => availableItemIds.has(decision.reviewItemId)),
          contextRevision: request.expectedContextRevision,
          targetKind: record.context.targetKind,
        });
        const draft =
          acceptedForAuthoring === true && this.acceptedForAuthoringBridge !== undefined
            ? await this.acceptedForAuthoringBridge.materialize({
                transaction,
                repositories,
                scope,
                context: record.context,
                source,
                approvedItemIds: [...approvedItemIds],
                now,
              })
            : undefined;
        return {
          reviewContextId: request.reviewContextId,
          contextRevision: request.expectedContextRevision,
          decisions: newDecisions,
          aggregateState,
          approvals,
          ...(acceptedForAuthoring === undefined ? {} : { acceptedForAuthoring }),
          ...(draft === undefined ? {} : { draft }),
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
        ...(written.draft === undefined
          ? []
          : [
              {
                resourceKind: FRONTEND_REVIEW_RESOURCE_KIND.draft,
                resourceId: written.draft.draftId,
                resourceRevision: String(written.draft.draftRevision),
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
      ...(written.draft === undefined ? {} : { draft: written.draft }),
      ...(written.revisionRequestReturnTarget === undefined
        ? {}
        : { revisionRequestReturnTarget: written.revisionRequestReturnTarget }),
    };
  }

  async addReviewComment(
    scope: FrontendReviewScopeV1,
    request: AddReviewCommentRequestV1,
  ): Promise<AddReviewCommentResultV1> {
    this.requireReviewCapability(scope, 'ADD_COMMENT');
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
        this.assertContextBounds(record.context);
        if (record.context.contextRevision !== request.contextRevision) {
          reviewFailure(
            'REVIEW_CONTEXT_STALE',
            `Expected context revision ${request.contextRevision} but the current revision is ${record.context.contextRevision}.`,
          );
        }
        if (request.reviewItemId !== undefined) {
          const commentItem = record.context.items.find(
            (item) => item.reviewItemId === request.reviewItemId,
          );
          if (!commentItem) {
            reviewFailure('REVIEW_ITEM_NOT_FOUND', 'The Review Item was not found.');
          }
          if (!canReadSensitivity(scope.sensitivityClearance, commentItem.sensitivity)) {
            reviewFailure('REVIEW_ITEM_NOT_FOUND', 'The Review Item was not found.');
          }
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
    this.requireReviewCapability(scope, 'RESOLVE_OUTCOME');
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
      const completed = await this.completedFromOutcome(scope, outcome);
      return {
        schemaVersion: '1.0.0',
        outcome: 'COMPLETED',
        originalClientRequestId: outcome.clientRequestId,
        originalIdempotencyKey: outcome.idempotencyKey,
        completed,
      };
    }
    if (outcome.outcomeState === 'REJECTED') {
      // A REJECTED outcome produced no Context to revalidate access/policy
      // against, so the stored rejection detail is never transmitted; only
      // the generic code is exposed (fail-closed). An identity-bearing
      // message must never reach a scope that can no longer read it.
      return {
        schemaVersion: '1.0.0',
        outcome: 'REJECTED',
        originalClientRequestId: outcome.clientRequestId,
        originalIdempotencyKey: outcome.idempotencyKey,
        rejection: {
          code: outcome.rejection?.code ?? 'INTERNAL_UNCLASSIFIED',
          message: 'The Review command was rejected.',
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
    scope: FrontendReviewScopeV1,
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
        // Exact produced-revision recovery: resolve the immutable Context
        // revision the original command wrote against, never the current one,
        // so a later revalidate/decision cannot change what is recovered. The
        // produced revision is required recovery evidence; a completed
        // outcome without a valid positive revision is never recoverable.
        const revisionNumber = Number(contextRef.resourceRevision);
        const context =
          Number.isSafeInteger(revisionNumber) && revisionNumber > 0
            ? await repositories.contexts.findRevision(contextRef.resourceId, revisionNumber)
            : undefined;
        if (!context) {
          reviewFailure('OUTCOME_NOT_FOUND', 'The Review context revision is missing.');
        }
        // Outcome recovery is not a read-API bypass: revalidate the current
        // access/policy scope and the frozen bounds before reconstructing
        // protected results (fail-closed).
        this.assertContextReadableForScope(context, scope);
        this.assertContextBounds(context);
        const approvalIds = outcome.producedResources
          .filter((resource) => resource.resourceKind === FRONTEND_REVIEW_RESOURCE_KIND.approval)
          .map((resource) => resource.resourceId);
        const approvals: ReviewApprovalV1[] = [];
        for (const approvalId of approvalIds) {
          const approval = await repositories.approvals.findById(approvalId);
          if (!approval) continue;
          // Approval lifecycle is revalidated on recovery; an expired or
          // non-ACTIVE Approval is not surfaced.
          try {
            this.assertApprovalReadable(approval, scope);
            approvals.push(approval);
          } catch {
            // skip approvals that are no longer readable
          }
        }
        const decisions = await repositories.decisions.findDecisions(context.reviewContextId);
        const visible = this.visibleItemIds(context, scope);
        const maskedContext = applySensitivityMasking(context, scope);
        const visibleDecisions = this.decisionsForRevision(
          decisions,
          context.contextRevision,
        ).filter((decision) => visible.has(decision.reviewItemId));
        // Aggregate state and authoring flags are computed from the
        // scope-visible Items and Decisions only; hidden Item state never
        // shapes the recovery response.
        const aggregateState = computeAggregateState({
          items: maskedContext.items,
          decisions: visibleDecisions,
          contextRevision: context.contextRevision,
          targetKind: context.targetKind,
        });
        const acceptedForAuthoring =
          context.targetKind === 'DISCOVERY_CANDIDATE' &&
          aggregateState === 'ACCEPTED_FOR_AUTHORING'
            ? true
            : undefined;
        // Reconstruct the typed revision return target for REQUEST_REVISION
        // outcomes (Contract Snapshot §11 / AC-26).
        const revisionRequestReturnTarget: ReviewRevisionReturnTargetV1 | undefined =
          aggregateState === 'REVISION_REQUESTED'
            ? context.targetKind === 'USER_DIRECTIVE_PROPOSAL'
              ? {
                  schemaVersion: '1.0.0',
                  workspace: 'DIRECTIVE_AUTHORING',
                  resourceId: context.targetId,
                  draftId: context.targetId,
                  draftRevision: Number(context.targetRevision),
                  reason:
                    'Return to Directive authoring to revise the Proposal before resubmission.',
                }
              : {
                  schemaVersion: '1.0.0',
                  workspace: 'KNOWLEDGE_EDITOR',
                  resourceId: context.targetId,
                  draftId: context.targetId,
                  draftRevision: Number(context.targetRevision),
                  reason: 'Return to the Knowledge Editor to revise the Draft before resubmission.',
                }
            : undefined;
        return {
          schemaVersion: '1.0.0' as const,
          outcome: 'COMPLETED' as const,
          clientRequestId: outcome.clientRequestId,
          idempotencyKey: outcome.idempotencyKey,
          commandSemanticDigest: outcome.commandSemanticDigest,
          reviewContextId: context.reviewContextId,
          contextRevision: context.contextRevision,
          decisions: this.filterDecisionsByVisibility(
            this.decisionsForRevision(decisions, context.contextRevision),
            visible,
          ),
          aggregateState,
          ...(approvals.length === 0 ? {} : { approvals }),
          ...(acceptedForAuthoring === undefined ? {} : { acceptedForAuthoring }),
          ...(revisionRequestReturnTarget === undefined ? {} : { revisionRequestReturnTarget }),
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
        // Exact produced-revision recovery (see recordDecisions path). The
        // produced revision is required evidence; never fall back to current.
        const revisionNumber = Number(contextRef.resourceRevision);
        const context =
          Number.isSafeInteger(revisionNumber) && revisionNumber > 0
            ? await repositories.contexts.findRevision(contextRef.resourceId, revisionNumber)
            : undefined;
        if (!context) {
          reviewFailure('OUTCOME_NOT_FOUND', 'The Review context revision is missing.');
        }
        // Outcome recovery is not a read-API bypass: revalidate access/policy
        // and the frozen bounds before reconstructing protected results.
        this.assertContextReadableForScope(context, scope);
        this.assertContextBounds(context);
        const comments = await repositories.decisions.findComments(contextRef.resourceId);
        const comment = comments.find((candidate) => candidate.commentId === commentRef.resourceId);
        if (!comment) {
          reviewFailure('OUTCOME_NOT_FOUND', 'The comment is missing.');
        }
        if (comment.reviewItemId === undefined) {
          // Context-wide comments are omitted from History and are likewise
          // never transmitted through Comment outcome/replay (fail-closed).
          reviewFailure('OUTCOME_NOT_FOUND', 'The comment is not available to the current scope.');
        }
        if (!this.visibleItemIds(context, scope).has(comment.reviewItemId)) {
          reviewFailure('OUTCOME_NOT_FOUND', 'The comment is not available to the current scope.');
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
        // Exact produced-revision recovery (see recordDecisions path). The
        // produced revision is required evidence; never fall back to current.
        const revisionNumber = Number(contextRef.resourceRevision);
        const context =
          Number.isSafeInteger(revisionNumber) && revisionNumber > 0
            ? await repositories.contexts.findRevision(contextRef.resourceId, revisionNumber)
            : undefined;
        if (!context) {
          reviewFailure('OUTCOME_NOT_FOUND', 'The Review context revision is missing.');
        }
        // Outcome recovery is not a read-API bypass: revalidate access/policy
        // and the frozen bounds, and mask the returned Context for the scope.
        this.assertContextReadableForScope(context, scope);
        this.assertContextBounds(context);
        return {
          schemaVersion: '1.0.0' as const,
          outcome: 'COMPLETED' as const,
          clientRequestId: outcome.clientRequestId,
          idempotencyKey: outcome.idempotencyKey,
          commandSemanticDigest: outcome.commandSemanticDigest,
          context: applySensitivityMasking(context, scope),
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
    const completed = await this.completedFromOutcome(scope, outcome);
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
      ...(result.draft === undefined ? {} : { draft: result.draft }),
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
    const completed = await this.completedFromOutcome(scope, outcome);
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
      // Idempotent replay is not a read-API bypass: revalidate the current
      // access/policy scope and the frozen bounds before returning the record.
      this.assertContextReadableForScope(record.context, scope);
      this.assertContextBounds(record.context);
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
        // Idempotent replay of a rejected Review command must never re-expose
        // the stored rejection detail (it may reference content from a scope
        // that can no longer read it): only the generic code and a fixed safe
        // message are surfaced (fail-closed).
        throw new ReviewCommandError(
          (outcome.rejection?.code as ErrorCode) ?? 'REVIEW_CONTEXT_STALE',
          'The Review command was rejected.',
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
        const written = await input.actionOnRepositories(handle.repositories, handle.raw);
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
