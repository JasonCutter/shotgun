import type {
  ReviewApprovalV1,
  ReviewCommentRecordV1,
  ReviewContextRevisionV1,
  ReviewDecisionRecordV1,
  ReviewQueueItemV1,
  ReviewTargetKindV1,
  ReviewAggregateStateV1,
  ReviewAttentionReasonV1,
} from '../../../packages/contracts/src/index.js';

/**
 * FE-P4-S1 Review persistence ports. Context revisions, Items and dependency
 * edges are immutable. Decisions and comments are append-only. Approval status
 * changes preserve history. The existing Frontend Command Ledger remains the
 * command and outcome authority; no second ledger is created.
 */

export type ReviewQueueFilterV1 = {
  readonly targetKinds?: readonly ReviewTargetKindV1[];
  readonly aggregateStates?: readonly ReviewAggregateStateV1[];
  readonly attentionReasons?: readonly ReviewAttentionReasonV1[];
  readonly query?: string;
};

export type ReviewQueuePageV1 = {
  readonly items: readonly ReviewQueueItemV1[];
  readonly nextCursor?: string;
  readonly totalCountStatus: 'EXACT' | 'LOWER_BOUND' | 'UNAVAILABLE';
};

/** Durable context record: immutable revision plus the source identity that
 * materialized it (used to derive staleness without mutating the revision). */
export type ReviewContextRecordV1 = {
  readonly reviewResourceId: string;
  readonly context: ReviewContextRevisionV1;
  readonly sourceRevision: string;
  readonly sourceDigest: string;
  readonly sourceUpdatedAt: string;
  readonly materializedAt: string;
};

export type ReviewContextStorePort = {
  findCurrent(reviewContextId: string): Promise<ReviewContextRecordV1 | undefined>;
  findRevision(
    reviewContextId: string,
    contextRevision: number,
  ): Promise<ReviewContextRevisionV1 | undefined>;
  insertContext(record: ReviewContextRecordV1): Promise<void>;
  listContexts(resourceProjectId: string): Promise<readonly ReviewContextRecordV1[]>;
  /** Locks the current context revision for one authoritative completion
   * transaction (PostgreSQL SELECT FOR UPDATE; serialized in-memory). */
  lockCurrent(reviewContextId: string): Promise<ReviewContextRecordV1 | undefined>;
};

export type ReviewDecisionStorePort = {
  findDecisions(reviewContextId: string): Promise<readonly ReviewDecisionRecordV1[]>;
  appendDecisions(decisions: readonly ReviewDecisionRecordV1[]): Promise<void>;
  findComments(reviewContextId: string): Promise<readonly ReviewCommentRecordV1[]>;
  appendComment(comment: ReviewCommentRecordV1): Promise<void>;
};

export type ReviewApprovalStorePort = {
  findById(approvalId: string): Promise<ReviewApprovalV1 | undefined>;
  insert(approval: ReviewApprovalV1): Promise<void>;
  /** Project-scoped approval history read (FE-P5-S2 WP4 Review adapter). */
  listByProject(projectId: string): Promise<readonly ReviewApprovalV1[]>;
  /** Cross-Phase Correction B: transition an ACTIVE Approval to CONSUMED on a
   *  successful Canonical commit (append-only status history preserved; the
   *  stored approval is never mutated in place). The consuming canonical
   *  commit identity is preserved for audit/history lineage. Idempotent when
   *  the same canonicalCommitId already consumed it; rejected when a different
   *  commit consumed it or the approval is not ACTIVE. */
  consumeApproval(
    approvalId: string,
    canonicalCommitId: string,
    consumedAt: string,
    consumedBy: string,
  ): Promise<void>;
};

export type ReviewTransactionRepositoriesV1 = {
  readonly contexts: ReviewContextStorePort;
  readonly decisions: ReviewDecisionStorePort;
  readonly approvals: ReviewApprovalStorePort;
};

export type ReviewTransactionHandleV1 = {
  readonly repositories: ReviewTransactionRepositoriesV1;
  /** Raw transaction handle (PostgreSQL PoolClient); undefined for in-memory. */
  readonly raw: unknown;
};

export type ReviewRepositoryBoundaryPort = {
  transaction<T>(action: (repositories: ReviewTransactionRepositoriesV1) => Promise<T>): Promise<T>;
  /**
   * Runs a unit of work inside one transaction that also exposes the raw
   * transaction handle, so the Product API coordinator can join the Command
   * Gateway's `lockAcceptedForExecution` / `completeInTransaction` into the
   * same transaction as the Review write (atomic Review + Ledger).
   */
  transactionWithHandle<T>(action: (handle: ReviewTransactionHandleV1) => Promise<T>): Promise<T>;
};
