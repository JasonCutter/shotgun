import {
  EXTERNAL_ACTION_ATTEMPT_LIST_CAP,
  EXTERNAL_ACTION_QUEUE_PAGE_SIZE_CAP,
  type ActionAuditEventV1,
  type ActionCandidateV1,
  type ActionManifestV1,
  type CompensatingActionV1,
  type ExecutionAttemptV1,
  type ExecutionV1,
  type ExternalActionApprovalV1,
  type ExternalActionBudgetViewV1,
  type ExternalActionCredentialViewV1,
  type ExternalActionV1,
  type PreflightV1,
  type ResultV1,
  type RiskDecisionV1,
  type RollbackV1,
  type VerificationV1,
} from '../../../packages/contracts/src/index.js';
import type {
  ExternalActionEnginePort,
  ExternalActionExecuteOutcomeV1,
  ExternalActionExecuteRequestV1,
  ExternalActionPreflightOutcomeV1,
  ExternalActionPreflightRequestV1,
  ExternalActionVerifyOutcomeV1,
  ExternalActionVerifyRequestV1,
} from '../../../modules/frontend-external-action/src/external-action-engine-port.js';
import type {
  ExternalActionAggregateStorePort,
  ExternalActionApprovalStorePort,
  ExternalActionAttemptStorePort,
  ExternalActionAuditStorePort,
  ExternalActionBudgetStorePort,
  ExternalActionCandidateStorePort,
  ExternalActionCompensationStorePort,
  ExternalActionCredentialStorePort,
  ExternalActionExecutionStorePort,
  ExternalActionManifestStorePort,
  ExternalActionPreflightStorePort,
  ExternalActionRepositoryBoundaryPort,
  ExternalActionResultStorePort,
  ExternalActionRiskDecisionStorePort,
  ExternalActionRollbackStorePort,
  ExternalActionTransactionHandleV1,
  ExternalActionTransactionRepositoriesV1,
  ExternalActionVerificationStorePort,
} from '../../../modules/frontend-external-action/src/external-action-store-port.js';

/**
 * FE-P4-S2 in-memory External Action repositories. Copy-on-write maps with
 * snapshot + rollback on error and a fair FIFO `tail` promise chain serializing
 * all transactions. `transactionWithHandle` passes `raw: undefined`.
 */

type MapSnapshot = {
  aggregates: Map<string, ExternalActionV1>;
  candidates: Map<string, ActionCandidateV1>;
  riskDecisions: Map<string, RiskDecisionV1>;
  manifests: Map<string, ActionManifestV1>;
  approvals: Map<string, ExternalActionApprovalV1>;
  preflights: Map<string, PreflightV1>;
  executions: Map<string, ExecutionV1>;
  attempts: Map<string, ExecutionAttemptV1>;
  verifications: Map<string, VerificationV1>;
  results: Map<string, ResultV1>;
  audit: Map<string, ActionAuditEventV1>;
  compensations: Map<string, CompensatingActionV1>;
  rollbacks: Map<string, RollbackV1>;
  credentials: Map<string, ExternalActionCredentialViewV1>;
  budgets: Map<string, ExternalActionBudgetViewV1>;
};

const snapshot = (maps: MapSnapshot): MapSnapshot => ({
  aggregates: new Map(maps.aggregates),
  candidates: new Map(maps.candidates),
  riskDecisions: new Map(maps.riskDecisions),
  manifests: new Map(maps.manifests),
  approvals: new Map(maps.approvals),
  preflights: new Map(maps.preflights),
  executions: new Map(maps.executions),
  attempts: new Map(maps.attempts),
  verifications: new Map(maps.verifications),
  results: new Map(maps.results),
  audit: new Map(maps.audit),
  compensations: new Map(maps.compensations),
  rollbacks: new Map(maps.rollbacks),
  credentials: new Map(maps.credentials),
  budgets: new Map(maps.budgets),
});

const restore = (maps: MapSnapshot, target: MapSnapshot): void => {
  maps.aggregates = target.aggregates;
  maps.candidates = target.candidates;
  maps.riskDecisions = target.riskDecisions;
  maps.manifests = target.manifests;
  maps.approvals = target.approvals;
  maps.preflights = target.preflights;
  maps.executions = target.executions;
  maps.attempts = target.attempts;
  maps.verifications = target.verifications;
  maps.results = target.results;
  maps.audit = target.audit;
  maps.compensations = target.compensations;
  maps.rollbacks = target.rollbacks;
  maps.credentials = target.credentials;
  maps.budgets = target.budgets;
};

export class InMemoryExternalActionStore implements ExternalActionRepositoryBoundaryPort {
  private readonly maps: MapSnapshot = {
    aggregates: new Map(),
    candidates: new Map(),
    riskDecisions: new Map(),
    manifests: new Map(),
    approvals: new Map(),
    preflights: new Map(),
    executions: new Map(),
    attempts: new Map(),
    verifications: new Map(),
    results: new Map(),
    audit: new Map(),
    compensations: new Map(),
    rollbacks: new Map(),
    credentials: new Map(),
    budgets: new Map(),
  };

  /** Fair FIFO tail: all transactions are serialized. */
  private tail: Promise<unknown> = Promise.resolve();

  private repositoriesFor(maps: MapSnapshot): ExternalActionTransactionRepositoriesV1 {
    return {
      aggregates: this.aggregatesFor(maps),
      candidates: this.candidatesFor(maps),
      riskDecisions: this.riskDecisionsFor(maps),
      manifests: this.manifestsFor(maps),
      approvals: this.approvalsFor(maps),
      preflights: this.preflightsFor(maps),
      executions: this.executionsFor(maps),
      attempts: this.attemptsFor(maps),
      verifications: this.verificationsFor(maps),
      results: this.resultsFor(maps),
      audit: this.auditFor(maps),
      compensations: this.compensationsFor(maps),
      rollbacks: this.rollbacksFor(maps),
      credentials: this.credentialsFor(maps),
      budgets: this.budgetsFor(maps),
    };
  }

  private aggregatesFor(maps: MapSnapshot): ExternalActionAggregateStorePort {
    return {
      find: async (actionId) => maps.aggregates.get(actionId),
      findById: async (actionId) => maps.aggregates.get(actionId),
      insert: async (action) => {
        maps.aggregates.set(action.actionId, action);
      },
      update: async (action) => {
        maps.aggregates.set(action.actionId, action);
      },
      lock: async (actionId) => maps.aggregates.get(actionId),
      listByProject: async (resourceProjectId, limit, offset) => {
        const all = [...maps.aggregates.values()]
          .filter((action) => action.resourceProjectId === resourceProjectId)
          .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
        return all.slice(offset, offset + Math.min(limit, EXTERNAL_ACTION_QUEUE_PAGE_SIZE_CAP));
      },
    };
  }

  private candidatesFor(maps: MapSnapshot): ExternalActionCandidateStorePort {
    return {
      find: async (actionId, candidateId) =>
        [...maps.candidates.values()].find(
          (candidate) => candidate.actionId === actionId && candidate.candidateId === candidateId,
        ),
      findByActionId: async (actionId) =>
        [...maps.candidates.values()].find((candidate) => candidate.actionId === actionId),
      insert: async (candidate) => {
        maps.candidates.set(`${candidate.actionId}:${candidate.candidateId}`, candidate);
      },
    };
  }

  private riskDecisionsFor(maps: MapSnapshot): ExternalActionRiskDecisionStorePort {
    return {
      find: async (actionId, riskDecisionId) =>
        [...maps.riskDecisions.values()].find(
          (decision) =>
            decision.actionId === actionId && decision.riskDecisionId === riskDecisionId,
        ),
      insert: async (decision) => {
        maps.riskDecisions.set(`${decision.actionId}:${decision.riskDecisionId}`, decision);
      },
    };
  }

  private manifestsFor(maps: MapSnapshot): ExternalActionManifestStorePort {
    return {
      findById: async (manifestId) => maps.manifests.get(manifestId),
      findCurrent: async (actionId) =>
        [...maps.manifests.values()]
          .filter((manifest) => manifest.actionId === actionId)
          .sort((a, b) => b.manifestRevision - a.manifestRevision)[0],
      insert: async (manifest) => {
        maps.manifests.set(manifest.manifestId, manifest);
      },
      lockCurrent: async (actionId) =>
        [...maps.manifests.values()]
          .filter((manifest) => manifest.actionId === actionId)
          .sort((a, b) => b.manifestRevision - a.manifestRevision)[0],
    };
  }

  private approvalsFor(maps: MapSnapshot): ExternalActionApprovalStorePort {
    return {
      findById: async (approvalId) => maps.approvals.get(approvalId),
      findActiveByAction: async (actionId) =>
        [...maps.approvals.values()].find(
          (approval) => approval.actionId === actionId && approval.status === 'ACTIVE',
        ),
      insert: async (approval) => {
        maps.approvals.set(approval.approvalId, approval);
      },
    };
  }

  private preflightsFor(maps: MapSnapshot): ExternalActionPreflightStorePort {
    return {
      findById: async (preflightId) => maps.preflights.get(preflightId),
      findCurrent: async (actionId) =>
        [...maps.preflights.values()]
          .filter((preflight) => preflight.actionId === actionId)
          .sort((a, b) => Date.parse(b.runAt) - Date.parse(a.runAt))[0],
      insert: async (preflight) => {
        maps.preflights.set(preflight.preflightId, preflight);
      },
    };
  }

  private executionsFor(maps: MapSnapshot): ExternalActionExecutionStorePort {
    return {
      findById: async (executionId) => maps.executions.get(executionId),
      findCurrent: async (actionId) =>
        [...maps.executions.values()].find((execution) => execution.actionId === actionId),
      insert: async (execution) => {
        maps.executions.set(execution.executionId, execution);
      },
      update: async (execution) => {
        maps.executions.set(execution.executionId, execution);
      },
    };
  }

  private attemptsFor(maps: MapSnapshot): ExternalActionAttemptStorePort {
    return {
      findByExecution: async (executionId) =>
        [...maps.attempts.values()]
          .filter((attempt) => attempt.executionId === executionId)
          .sort((a, b) => a.attemptNumber - b.attemptNumber)
          .slice(0, EXTERNAL_ACTION_ATTEMPT_LIST_CAP),
      findById: async (attemptId) => maps.attempts.get(attemptId),
      insert: async (attempt) => {
        maps.attempts.set(attempt.attemptId, attempt);
      },
      lockByExecution: async (executionId) =>
        [...maps.attempts.values()]
          .filter((attempt) => attempt.executionId === executionId)
          .sort((a, b) => a.attemptNumber - b.attemptNumber),
    };
  }

  private verificationsFor(maps: MapSnapshot): ExternalActionVerificationStorePort {
    return {
      findById: async (verificationId) => maps.verifications.get(verificationId),
      findCurrent: async (actionId) =>
        [...maps.verifications.values()].find((verification) => verification.actionId === actionId),
      insert: async (verification) => {
        maps.verifications.set(verification.verificationId, verification);
      },
    };
  }

  private resultsFor(maps: MapSnapshot): ExternalActionResultStorePort {
    return {
      findById: async (resultId) => maps.results.get(resultId),
      findCurrent: async (actionId) =>
        [...maps.results.values()].find((result) => result.actionId === actionId),
      insert: async (result) => {
        maps.results.set(result.resultId, result);
      },
    };
  }

  private auditFor(maps: MapSnapshot): ExternalActionAuditStorePort {
    return {
      append: async (event) => {
        maps.audit.set(event.auditEventId, event);
      },
      listByAction: async (actionId, limit, offset) =>
        [...maps.audit.values()]
          .filter((event) => event.actionId === actionId)
          .sort((a, b) => a.sequence - b.sequence)
          .slice(offset, offset + Math.min(limit, EXTERNAL_ACTION_QUEUE_PAGE_SIZE_CAP)),
    };
  }

  private compensationsFor(maps: MapSnapshot): ExternalActionCompensationStorePort {
    return {
      find: async (actionId) =>
        [...maps.compensations.values()].find((compensation) => compensation.actionId === actionId),
      insert: async (compensation) => {
        maps.compensations.set(compensation.compensationId, compensation);
      },
    };
  }

  private rollbacksFor(maps: MapSnapshot): ExternalActionRollbackStorePort {
    return {
      find: async (actionId) =>
        [...maps.rollbacks.values()].find((rollback) => rollback.actionId === actionId),
      insert: async (rollback) => {
        maps.rollbacks.set(rollback.rollbackId, rollback);
      },
      update: async (rollback) => {
        maps.rollbacks.set(rollback.rollbackId, rollback);
      },
    };
  }

  private credentialsFor(maps: MapSnapshot): ExternalActionCredentialStorePort {
    return {
      findByConnector: async (connectorId) => maps.credentials.get(connectorId),
      insert: async (credential) => {
        maps.credentials.set(credential.connectorId, credential);
      },
    };
  }

  private budgetsFor(maps: MapSnapshot): ExternalActionBudgetStorePort {
    return {
      findByProject: async (projectId) => maps.budgets.get(projectId),
      insert: async (budget) => {
        maps.budgets.set(budget.projectId, budget);
      },
      update: async (budget) => {
        maps.budgets.set(budget.projectId, budget);
      },
    };
  }

  transaction<T>(
    action: (repositories: ExternalActionTransactionRepositoriesV1) => Promise<T>,
  ): Promise<T> {
    const run = async (): Promise<T> => {
      const before = snapshot(this.maps);
      try {
        return await action(this.repositoriesFor(this.maps));
      } catch (error) {
        restore(this.maps, before);
        throw error;
      }
    };
    const next = this.tail.then(run, run);
    this.tail = next.catch(() => undefined);
    return next;
  }

  transactionWithHandle<T>(
    action: (handle: ExternalActionTransactionHandleV1) => Promise<T>,
  ): Promise<T> {
    return this.transaction((repositories) => action({ repositories, raw: undefined }));
  }

  /** Test/setup: seed server-owned state (credential/budget). */
  seedCredential(credential: ExternalActionCredentialViewV1): void {
    this.maps.credentials.set(credential.connectorId, credential);
  }

  seedBudget(budget: ExternalActionBudgetViewV1): void {
    this.maps.budgets.set(budget.projectId, budget);
  }
}

/**
 * FE-P4-S2 fake connector behind the engine port. Provider payloads and
 * secrets never cross this boundary; only safe Product statuses and digests
 * are returned. Success here is NEVER verified success — a Verification
 * resource is required before an action is VERIFIED.
 */
export class FakeExternalActionEngine implements ExternalActionEnginePort {
  readonly identity = {
    connectorId: 'fake-connector',
    name: 'Fake Connector',
    provider: 'fake',
    secretBoundary: 'ADAPTER_INTERNAL' as const,
  };

  constructor(
    private readonly behavior: {
      readonly preflightStatus?: 'READY' | 'ALREADY_APPLIED' | 'DENIED';
      readonly executeStatus?: 'SUCCEEDED' | 'FAILED' | 'OUTCOME_UNKNOWN';
      readonly verifyStatus?: 'APPLIED' | 'NOT_APPLIED' | 'MISMATCH';
    } = {},
  ) {}

  async preflight(
    request: ExternalActionPreflightRequestV1,
  ): Promise<ExternalActionPreflightOutcomeV1> {
    void request;
    const status = this.behavior.preflightStatus ?? 'READY';
    return {
      status,
      reason: status === 'DENIED' ? 'target state denies the operation' : undefined,
      targetStateRevalidated: status === 'READY',
      externalRevisionRevalidated: status === 'READY',
    };
  }

  async execute(request: ExternalActionExecuteRequestV1): Promise<ExternalActionExecuteOutcomeV1> {
    const status = this.behavior.executeStatus ?? 'SUCCEEDED';
    return {
      status,
      externalId: status === 'SUCCEEDED' ? `external-${request.attempt.attemptId}` : undefined,
      observedDigest: status === 'SUCCEEDED' ? `sha256:${'c'.repeat(64)}` : undefined,
      correlationId: request.attempt.correlationId,
    };
  }

  async verify(request: ExternalActionVerifyRequestV1): Promise<ExternalActionVerifyOutcomeV1> {
    void request;
    const status = this.behavior.verifyStatus ?? 'APPLIED';
    return {
      status,
      observedDigest: status === 'NOT_APPLIED' ? undefined : `sha256:${'c'.repeat(64)}`,
    };
  }
}
