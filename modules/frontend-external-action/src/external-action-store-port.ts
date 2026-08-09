import type {
  ActionAuditEventV1,
  ActionCandidateV1,
  ActionManifestV1,
  CompensatingActionV1,
  ExecutionAttemptV1,
  ExecutionV1,
  ExternalActionApprovalV1,
  ExternalActionBudgetViewV1,
  ExternalActionCredentialViewV1,
  ExternalActionV1,
  PreflightV1,
  ResultV1,
  RiskDecisionV1,
  RollbackV1,
  VerificationV1,
} from '../../../packages/contracts/src/index.js';

/**
 * FE-P4-S2 External Action persistence ports. Every Product resource is
 * project-bound and versioned; Attempts are ordered append-only; Audit events
 * are append-only. The existing Frontend Command Ledger remains the command
 * and outcome authority; no second ledger is created.
 */

export type ExternalActionAggregateRecordV1 = {
  readonly action: ExternalActionV1;
  readonly updatedAt: string;
};

export type ExternalActionAggregateStorePort = {
  find(actionId: string): Promise<ExternalActionV1 | undefined>;
  findById(actionId: string): Promise<ExternalActionV1 | undefined>;
  insert(action: ExternalActionV1): Promise<void>;
  update(action: ExternalActionV1): Promise<void>;
  lock(actionId: string): Promise<ExternalActionV1 | undefined>;
  listByProject(
    resourceProjectId: string,
    limit: number,
    offset: number,
  ): Promise<readonly ExternalActionV1[]>;
  /**
   * Serializes the initial creation of an action identity (advisory lock in
   * PostgreSQL; no-op in the FIFO-serialized in-memory store) so two
   * concurrent first validations cannot both create revision 1.
   */
  lockActionId(actionId: string): Promise<void>;
};

export type ExternalActionCandidateStorePort = {
  find(actionId: string, candidateId: string): Promise<ActionCandidateV1 | undefined>;
  findByActionId(actionId: string): Promise<ActionCandidateV1 | undefined>;
  insert(candidate: ActionCandidateV1): Promise<void>;
};

export type ExternalActionRiskDecisionStorePort = {
  find(actionId: string, riskDecisionId: string): Promise<RiskDecisionV1 | undefined>;
  insert(riskDecision: RiskDecisionV1): Promise<void>;
};

export type ExternalActionManifestStorePort = {
  findById(manifestId: string): Promise<ActionManifestV1 | undefined>;
  findCurrent(actionId: string): Promise<ActionManifestV1 | undefined>;
  insert(manifest: ActionManifestV1): Promise<void>;
  lockCurrent(actionId: string): Promise<ActionManifestV1 | undefined>;
};

export type ExternalActionApprovalStorePort = {
  findById(approvalId: string): Promise<ExternalActionApprovalV1 | undefined>;
  findActiveByAction(actionId: string): Promise<ExternalActionApprovalV1 | undefined>;
  insert(approval: ExternalActionApprovalV1): Promise<void>;
};

export type ExternalActionPreflightStorePort = {
  findById(preflightId: string): Promise<PreflightV1 | undefined>;
  findCurrent(actionId: string): Promise<PreflightV1 | undefined>;
  insert(preflight: PreflightV1): Promise<void>;
};

export type ExternalActionExecutionStorePort = {
  findById(executionId: string): Promise<ExecutionV1 | undefined>;
  findCurrent(actionId: string): Promise<ExecutionV1 | undefined>;
  insert(execution: ExecutionV1): Promise<void>;
  update(execution: ExecutionV1): Promise<void>;
};

export type ExternalActionAttemptStorePort = {
  findByExecution(executionId: string): Promise<readonly ExecutionAttemptV1[]>;
  findById(attemptId: string): Promise<ExecutionAttemptV1 | undefined>;
  insert(attempt: ExecutionAttemptV1): Promise<void>;
  lockByExecution(executionId: string): Promise<readonly ExecutionAttemptV1[]>;
};

export type ExternalActionVerificationStorePort = {
  findById(verificationId: string): Promise<VerificationV1 | undefined>;
  findCurrent(actionId: string): Promise<VerificationV1 | undefined>;
  insert(verification: VerificationV1): Promise<void>;
};

export type ExternalActionResultStorePort = {
  findById(resultId: string): Promise<ResultV1 | undefined>;
  findCurrent(actionId: string): Promise<ResultV1 | undefined>;
  /**
   * Authoritative Result history enumeration for one action (insertion order).
   * Used by the FE-P5-S2 WP4 External Action History adapter to project the
   * complete mandatory RESULT family (GPT Round 1 B).
   */
  listByAction(actionId: string, limit: number, offset: number): Promise<readonly ResultV1[]>;
  insert(result: ResultV1): Promise<void>;
};

export type ExternalActionAuditStorePort = {
  append(event: ActionAuditEventV1): Promise<void>;
  listByAction(
    actionId: string,
    limit: number,
    offset: number,
  ): Promise<readonly ActionAuditEventV1[]>;
  /** Monotonic next sequence for an action (append-only authority). */
  nextSequence(actionId: string): Promise<number>;
};

export type ExternalActionCompensationStorePort = {
  find(actionId: string): Promise<CompensatingActionV1 | undefined>;
  insert(compensation: CompensatingActionV1): Promise<void>;
};

export type ExternalActionRollbackStorePort = {
  find(actionId: string): Promise<RollbackV1 | undefined>;
  insert(rollback: RollbackV1): Promise<void>;
  update(rollback: RollbackV1): Promise<void>;
};

export type ExternalActionCredentialStorePort = {
  findByConnector(connectorId: string): Promise<ExternalActionCredentialViewV1 | undefined>;
  insert(credential: ExternalActionCredentialViewV1): Promise<void>;
};

export type ExternalActionBudgetStorePort = {
  findByProject(projectId: string): Promise<ExternalActionBudgetViewV1 | undefined>;
  insert(budget: ExternalActionBudgetViewV1): Promise<void>;
  update(budget: ExternalActionBudgetViewV1): Promise<void>;
  /**
   * Atomically reserves one execution from the project budget (check +
   * decrement in a single serialized/transactional step). Returns the
   * post-reservation view, or undefined when the budget is absent. The caller
   * fails closed when the result is exhausted/unavailable. Reservation is made
   * BEFORE the connector call; it is never released after the attempt ran.
   */
  reserve(projectId: string): Promise<ExternalActionBudgetViewV1 | undefined>;
};

export type ExternalActionTransactionRepositoriesV1 = {
  readonly aggregates: ExternalActionAggregateStorePort;
  readonly candidates: ExternalActionCandidateStorePort;
  readonly riskDecisions: ExternalActionRiskDecisionStorePort;
  readonly manifests: ExternalActionManifestStorePort;
  readonly approvals: ExternalActionApprovalStorePort;
  readonly preflights: ExternalActionPreflightStorePort;
  readonly executions: ExternalActionExecutionStorePort;
  readonly attempts: ExternalActionAttemptStorePort;
  readonly verifications: ExternalActionVerificationStorePort;
  readonly results: ExternalActionResultStorePort;
  readonly audit: ExternalActionAuditStorePort;
  readonly compensations: ExternalActionCompensationStorePort;
  readonly rollbacks: ExternalActionRollbackStorePort;
  readonly credentials: ExternalActionCredentialStorePort;
  readonly budgets: ExternalActionBudgetStorePort;
};

export type ExternalActionTransactionHandleV1 = {
  readonly repositories: ExternalActionTransactionRepositoriesV1;
  /** Raw transaction handle (PostgreSQL PoolClient); undefined for in-memory. */
  readonly raw: unknown;
};

export type ExternalActionRepositoryBoundaryPort = {
  transaction<T>(
    action: (repositories: ExternalActionTransactionRepositoriesV1) => Promise<T>,
  ): Promise<T>;
  /**
   * Runs a unit of work inside one transaction that also exposes the raw
   * transaction handle, so the coordinator can join the Command Gateway's
   * `lockAcceptedForExecution` / `completeInTransaction` into the same
   * transaction as the External Action write (atomic Product + Ledger).
   */
  transactionWithHandle<T>(
    action: (handle: ExternalActionTransactionHandleV1) => Promise<T>,
  ): Promise<T>;
};
