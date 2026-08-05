import { randomUUID } from 'node:crypto';

import { sha256Text, stableJson } from '../../../packages/contracts/src/document-evidence.js';

import {
  EXTERNAL_ACTION_APPROVAL_TTL_MS,
  EXTERNAL_ACTION_ATTEMPT_LIST_CAP,
  EXTERNAL_ACTION_MANIFEST_PARAMETER_MAX,
  EXTERNAL_ACTION_QUEUE_PAGE_SIZE_CAP,
  FRONTEND_EXTERNAL_ACTION_API_VERSION,
  FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES,
  type AcceptedPolicyContext,
  type ActionCandidateV1,
  type ActionManifestV1,
  type AnyFrontendCommandOutcomeView,
  type AnyFrontendCommandRequest,
  type ApproveExternalActionRequestV1,
  type ApproveExternalActionResultV1,
  type CancelExternalActionRequestV1,
  type CancelExternalActionResultV1,
  type CompensatingActionV1,
  type ErrorCode,
  type ExecuteExternalActionRequestV1,
  type ExecuteExternalActionResultV1,
  type ExecutionAttemptV1,
  type ExecutionV1,
  type ExternalActionActorV1,
  type ExternalActionAggregateStatusV1,
  type ExternalActionApprovalV1,
  type ExternalActionAuditCategoryV1,
  type ExternalActionCapabilityV1,
  type ExternalActionQueueItemV1,
  type ExternalActionV1,
  type FrontendExternalActionCommandType,
  type GetActionManifestRequestV1,
  type GetActionManifestResultV1,
  type GetActionResultRequestV1,
  type GetActionResultResultV1,
  type GetExecutionAttemptsRequestV1,
  type GetExecutionAttemptsResultV1,
  type GetExecutionRequestV1,
  type GetExecutionResultV1,
  type GetExternalActionDetailRequestV1,
  type GetExternalActionDetailResultV1,
  type GetExternalActionRequestV1,
  type GetExternalActionResultV1,
  type GetPreflightRequestV1,
  type GetPreflightResultV1,
  type GetRiskDecisionRequestV1,
  type GetRiskDecisionResultV1,
  type GetVerificationRequestV1,
  type GetVerificationResultV1,
  type ListExternalActionAuditRequestV1,
  type ListExternalActionAuditResultV1,
  type ListExternalActionsRequestV1,
  type ListExternalActionsResultV1,
  type PreflightExternalActionRequestV1,
  type PreflightExternalActionResultV1,
  type PreflightV1,
  type PrepareActionManifestRequestV1,
  type PrepareActionManifestResultV1,
  type PrepareCompensatingActionRequestV1,
  type PrepareCompensatingActionResultV1,
  type ProducedResourceRef,
  type ResolveExternalActionOutcomeRequestV1,
  type ResolveExternalActionOutcomeResultV1,
  type ResolvedCommandResultV1,
  type ResultV1,
  type RetryExecutionAttemptRequestV1,
  type RetryExecutionAttemptResultV1,
  type RiskDecisionV1,
  type RollbackExternalActionRequestV1,
  type RollbackExternalActionResultV1,
  type RollbackV1,
  type TypedPrecondition,
  type ValidateActionCandidateRequestV1,
  type ValidateActionCandidateResultV1,
  type VerificationV1,
  type VerifyExternalActionRequestV1,
  type VerifyExternalActionResultV1,
  externalActionManifestDigest,
  frontendExternalActionApproveDigest,
  frontendExternalActionCancelDigest,
  frontendExternalActionCandidateDigest,
  frontendExternalActionCompensationDigest,
  frontendExternalActionExecuteDigest,
  frontendExternalActionManifestDigest,
  frontendExternalActionPreflightDigest,
  frontendExternalActionRetryDigest,
  frontendExternalActionRollbackDigest,
  frontendExternalActionVerifyDigest,
} from '../../../packages/contracts/src/index.js';
import { externalActionFailure, ExternalActionCommandError } from './external-action-error.js';
import {
  approvalIsActive,
  externalActionResourceRef,
  preflightIsReady,
  preflightRevalidationFlags,
} from './external-action-domain.js';
import type {
  ExternalActionEnginePort,
  ExternalActionExecuteOutcomeV1,
  ExternalActionExecuteRequestV1,
  ExternalActionPreflightOutcomeV1,
  ExternalActionPreflightRequestV1,
} from './external-action-engine-port.js';
import type {
  ExternalActionRepositoryBoundaryPort,
  ExternalActionTransactionRepositoriesV1,
} from './external-action-store-port.js';

const generatedIdentity = (prefix: string): string => `${prefix}-${randomUUID()}`;

/**
 * Structural subset of the Frontend command gateway used by the External
 * Action Product. Declared locally (mirroring the ask-write module pattern) so
 * that this domain module does not import another domain module; the concrete
 * gateway is wired at the assembly boundary and satisfies this shape
 * structurally.
 */
export type FrontendExternalActionCommandGatewayPort = {
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

export const FRONTEND_EXTERNAL_ACTION_RESOURCE_KIND = {
  action: 'frontend.external-action.action',
  candidate: 'frontend.external-action.candidate',
  riskDecision: 'frontend.external-action.risk-decision',
  manifest: 'frontend.external-action.manifest',
  approval: 'frontend.external-action.approval',
  preflight: 'frontend.external-action.preflight',
  execution: 'frontend.external-action.execution',
  attempt: 'frontend.external-action.attempt',
  verification: 'frontend.external-action.verification',
  result: 'frontend.external-action.result',
  compensation: 'frontend.external-action.compensation',
  rollback: 'frontend.external-action.rollback',
} as const;

/** Server-derived scope. The Browser never submits these values. */
export type FrontendExternalActionScopeV1 = {
  readonly principalId: string;
  readonly actor: ExternalActionActorV1;
  readonly activeProjectId: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly accessScope: readonly string[];
  readonly riskClearance?: 'R0' | 'R1' | 'R2' | 'R3' | 'R4';
};

const READ_SCOPES: ReadonlySet<string> = new Set(['owner', 'admin', 'action:read']);
const EXECUTE_SCOPES: ReadonlySet<string> = new Set(['owner', 'admin', 'action:execute']);
const APPROVE_SCOPES: ReadonlySet<string> = new Set(['owner', 'admin', 'action:approve']);
const GOVERN_SCOPES: ReadonlySet<string> = new Set(['owner', 'admin', 'action:govern']);

export const externalActionCapabilitiesForScope = (
  scope: FrontendExternalActionScopeV1,
): readonly ExternalActionCapabilityV1[] => {
  const granted = scope.accessScope ?? [];
  const hasRead = granted.some((entry) => READ_SCOPES.has(entry));
  if (!hasRead) return [];
  // Read scope grants reads and outcome resolution only — never write
  // capabilities (server-authoritative; the frozen contract separates them).
  const capabilities: ExternalActionCapabilityV1[] = [
    'LIST_EXTERNAL_ACTIONS',
    'READ_EXTERNAL_ACTION',
    'READ_MANIFEST',
    'READ_RISK_DECISION',
    'READ_PREFLIGHT',
    'READ_EXECUTION',
    'READ_EXECUTION_ATTEMPTS',
    'READ_VERIFICATION',
    'READ_RESULT',
    'READ_AUDIT',
    'READ_APPROVAL',
    'RESOLVE_OUTCOME',
  ];
  const canExecute = granted.some((entry) => EXECUTE_SCOPES.has(entry));
  const canApprove = granted.some((entry) => APPROVE_SCOPES.has(entry));
  const canGovern = granted.some((entry) => GOVERN_SCOPES.has(entry));
  if (canApprove) capabilities.push('APPROVE_EXTERNAL_ACTION');
  if (canExecute) {
    capabilities.push(
      'PREFLIGHT_EXTERNAL_ACTION',
      'EXECUTE_EXTERNAL_ACTION',
      'RETRY_EXECUTION_ATTEMPT',
      'VERIFY_EXTERNAL_ACTION',
    );
  }
  if (canGovern) {
    capabilities.push(
      'VALIDATE_CANDIDATE',
      'PREPARE_MANIFEST',
      'CANCEL_EXTERNAL_ACTION',
      'ROLLBACK_EXTERNAL_ACTION',
      'PREPARE_COMPENSATING_ACTION',
      'READ_CREDENTIAL',
      'READ_BUDGET',
    );
  }
  return capabilities;
};

export const isExternalActionProductCommandType = (commandType: string): boolean =>
  Object.values(FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES).includes(
    commandType as (typeof FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES)[keyof typeof FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES],
  );

type FrontendExternalActionRunCommandInput<T> = {
  readonly scope: FrontendExternalActionScopeV1;
  readonly commandType: (typeof FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES)[keyof typeof FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES];
  readonly request: { readonly clientRequestId: string; readonly idempotencyKey: string };
  readonly commandSemanticDigest: string;
  readonly resourceProjectId: string;
  readonly preconditions?: readonly TypedPrecondition[];
  readonly actionOnRepositories: (
    repositories: ExternalActionTransactionRepositoriesV1,
  ) => Promise<T>;
  readonly onReplay?: () => Promise<T>;
  readonly producedResources: (result: T) => readonly ProducedResourceRef[];
};

export class FrontendExternalActionProductCoordinator {
  constructor(
    private readonly boundary: ExternalActionRepositoryBoundaryPort,
    private readonly commandGateway: FrontendExternalActionCommandGatewayPort,
    private readonly engine: ExternalActionEnginePort,
    private readonly now?: () => Date,
  ) {}

  private nowIso(): string {
    return (this.now ? this.now() : new Date()).toISOString();
  }

  private requireCapability(
    scope: FrontendExternalActionScopeV1,
    capability: ExternalActionCapabilityV1,
  ): void {
    if (!externalActionCapabilitiesForScope(scope).includes(capability)) {
      externalActionFailure(
        'PROJECT_ACCESS_DENIED',
        `The current scope does not grant the '${capability}' External Action capability.`,
      );
    }
  }

  private assertProjectAndPolicy(
    action: ExternalActionV1,
    scope: FrontendExternalActionScopeV1,
  ): void {
    if (action.resourceProjectId !== scope.activeProjectId) {
      externalActionFailure('EXTERNAL_ACTION_NOT_FOUND', 'The External Action was not found.');
    }
    if (
      action.accessRevision !== scope.accessRevision ||
      action.policyContextRevision !== scope.policyContextRevision
    ) {
      externalActionFailure(
        'EXTERNAL_ACTION_NOT_FOUND',
        'The External Action is not available to the current scope.',
      );
    }
  }

  private assertStaleNotBlocking(action: ExternalActionV1): void {
    if (action.aggregateState === 'ACCESS_RESTRICTED') {
      externalActionFailure('EXTERNAL_ACTION_STALE', 'The External Action is access-restricted.');
    }
  }

  /**
   * Phase 3 ownership pinning (Review 4861145103): after the connector call
   * the finalizer re-locks the aggregate and verifies the EXACT Phase-1 state
   * before committing the terminal outcome — the action is still EXECUTING,
   * its revision is exactly expectedActionRevision + 1, the started execution
   * is still the latest, and the started execution/attempt are still
   * IN_PROGRESS. If ANY check fails, the finalizer fails closed instead of
   * overwriting a resource it does not own.
   */
  private async lockStartedActionForFinalize(
    repositories: ExternalActionTransactionRepositoriesV1,
    actionId: string,
    startedRefs: {
      readonly executionId: string;
      readonly attemptId: string;
      readonly expectedActionRevision: number;
    },
  ): Promise<{
    readonly action: ExternalActionV1;
    readonly executionId: string;
    readonly execution: ExecutionV1;
    readonly attempts: readonly ExecutionAttemptV1[];
    readonly attempt: ExecutionAttemptV1;
  }> {
    const action = await repositories.aggregates.lock(actionId);
    if (!action) {
      externalActionFailure('EXTERNAL_ACTION_NOT_FOUND', 'The External Action was not found.');
    }
    if (
      action.status !== 'EXECUTING' ||
      action.actionRevision !== startedRefs.expectedActionRevision + 1 ||
      action.latestExecutionRef?.resourceId !== startedRefs.executionId
    ) {
      externalActionFailure(
        'EXTERNAL_ACTION_STALE',
        'The External Action changed while the connector call was in flight.',
      );
    }
    const executionId = startedRefs.executionId;
    const execution = await repositories.executions.findById(executionId);
    if (!execution || execution.status !== 'IN_PROGRESS') {
      externalActionFailure(
        'EXTERNAL_ACTION_STALE',
        'The execution changed while the connector call was in flight.',
      );
    }
    const attempts = await repositories.attempts.lockByExecution(executionId);
    const attempt = attempts.find((entry) => entry.attemptId === startedRefs.attemptId);
    if (!attempt || attempt.status !== 'IN_PROGRESS') {
      externalActionFailure(
        'EXTERNAL_ACTION_STALE',
        'The execution attempt changed while the connector call was in flight.',
      );
    }
    return { action, executionId, execution, attempts, attempt };
  }

  /**
   * True when the action's CURRENT manifest is the rollback manifest of a
   * prepared/approved/executing rollback — i.e. the governed commands are
   * operating on the rollback (state reversal) lifecycle rather than the
   * forward operation.
   */
  private async rollbackContextFor(
    repositories: ExternalActionTransactionRepositoriesV1,
    action: ExternalActionV1,
  ): Promise<{ readonly active: boolean }> {
    const rollback = await repositories.rollbacks.find(action.actionId);
    if (!rollback || !rollback.manifestRef || !action.manifestRef) return { active: false };
    return {
      active:
        rollback.manifestRef.resourceId === action.manifestRef.resourceId &&
        (rollback.status === 'PREPARED' ||
          rollback.status === 'APPROVED' ||
          rollback.status === 'EXECUTING'),
    };
  }

  private async appendAudit(
    repositories: ExternalActionTransactionRepositoriesV1,
    action: ExternalActionV1,
    category: ExternalActionAuditCategoryV1,
    message: string,
    sequence: number,
  ): Promise<void> {
    // Append-only audit with safe structured payload (no raw provider data).
    await repositories.audit.append({
      schemaVersion: '1.0.0',
      auditEventId: generatedIdentity('audit'),
      actionId: action.actionId,
      resourceProjectId: action.resourceProjectId,
      effectiveProjectId: action.effectiveProjectId,
      sequence,
      category,
      eventData: {
        schemaVersion: '1.0.0',
        message,
        refs: [
          ...(action.manifestRef ? [action.manifestRef] : []),
          ...(action.latestExecutionRef ? [action.latestExecutionRef] : []),
        ],
      },
      occurredAt: this.nowIso(),
    });
  }

  /** Next audit sequence for an action (append-only authority, store-based). */
  private async nextAuditSequence(
    repositories: ExternalActionTransactionRepositoriesV1,
    actionId: string,
  ): Promise<number> {
    return repositories.audit.nextSequence(actionId);
  }

  /** Deterministic target digest pinning the exact external target state. */
  private targetDigestFor(targetRef: ExternalActionV1['targetRef']): string {
    if (!targetRef) return `sha256:${'c'.repeat(64)}`;
    return sha256Text(
      stableJson({
        targetKind: targetRef.targetKind,
        targetId: targetRef.targetId,
        targetRevision: targetRef.targetRevision,
        externalRevision: targetRef.externalRevision,
      }),
    );
  }

  /** Deterministic payload digest pinning the actual execution payload. */
  private payloadDigestFor(input: {
    readonly operation: string;
    readonly targetId: string;
    readonly targetRevision: string;
    readonly parameterId: string;
    readonly parameterRevision: string;
    readonly evidenceSetId: string;
  }): string {
    return sha256Text(
      stableJson({
        operation: input.operation,
        targetId: input.targetId,
        targetRevision: input.targetRevision,
        parameterId: input.parameterId,
        parameterRevision: input.parameterRevision,
        evidenceSetId: input.evidenceSetId,
      }),
    );
  }

  /** Exact-match approval revalidation (AC-05/AC-06): the ACTIVE approval must
   * bind the exact manifest, target, external revision and server context. */
  private assertApprovalMatchesExecutionContext(
    approval: ExternalActionApprovalV1,
    manifest: ActionManifestV1,
    scope: FrontendExternalActionScopeV1,
  ): void {
    if (!approvalIsActive(approval, this.nowIso())) {
      externalActionFailure('ACTION_APPROVAL_REQUIRED', 'An ACTIVE approval is required.');
    }
    if (
      approval.manifestId !== manifest.manifestId ||
      approval.manifestRevision !== manifest.manifestRevision ||
      approval.manifestDigest !== manifest.manifestDigest ||
      approval.targetId !== manifest.targetId ||
      approval.targetRevision !== manifest.targetRevision ||
      approval.targetDigest !== manifest.targetDigest ||
      approval.externalRevision !== manifest.externalRevision ||
      approval.projectId !== scope.activeProjectId ||
      approval.accessRevision !== scope.accessRevision ||
      approval.policyContextRevision !== scope.policyContextRevision
    ) {
      externalActionFailure(
        'ACTION_APPROVAL_INVALID',
        'The approval does not bind the exact manifest, target, external revision and server context.',
      );
    }
  }

  private async aggregateFor(
    repositories: ExternalActionTransactionRepositoriesV1,
    actionId: string,
  ): Promise<ExternalActionV1> {
    const action = await repositories.aggregates.lock(actionId);
    if (!action) {
      externalActionFailure('EXTERNAL_ACTION_NOT_FOUND', 'The External Action was not found.');
    }
    return action;
  }

  private queueItemFor(
    action: ExternalActionV1,
    riskLevel: RiskDecisionV1['riskLevel'],
  ): ExternalActionQueueItemV1 {
    return {
      schemaVersion: '1.0.0',
      actionId: action.actionId,
      actionRevision: action.actionRevision,
      operation: action.operation,
      resourceProjectId: action.resourceProjectId,
      effectiveProjectId: action.effectiveProjectId,
      status: action.status,
      aggregateState: action.aggregateState,
      capabilities: action.capabilities,
      riskLevel,
      updatedAt: action.updatedAt,
    };
  }

  private async riskLevelFor(
    repositories: ExternalActionTransactionRepositoriesV1,
    actionId: string,
  ): Promise<RiskDecisionV1['riskLevel']> {
    // The current risk level is derived from the stored risk decision.
    const candidate = await this.findCandidateForAction(repositories, actionId);
    if (candidate) {
      const decision = await repositories.riskDecisions.find(
        actionId,
        candidate.riskDecisionRef.resourceId,
      );
      if (decision) return decision.riskLevel;
    }
    return 'R0';
  }

  // -------------------------------------------------------------------------
  // Governed commands
  // -------------------------------------------------------------------------

  async validateActionCandidate(
    scope: FrontendExternalActionScopeV1,
    request: ValidateActionCandidateRequestV1,
  ): Promise<ValidateActionCandidateResultV1> {
    this.requireCapability(scope, 'VALIDATE_CANDIDATE');
    const commandSemanticDigest = frontendExternalActionCandidateDigest(request);
    return this.runCommand<ValidateActionCandidateResultV1>({
      scope,
      commandType: FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.validateCandidate,
      request,
      commandSemanticDigest,
      resourceProjectId: scope.activeProjectId,
      actionOnRepositories: async (repositories) => {
        // Serialize the initial action creation (advisory lock) and lock the
        // aggregate row when it already exists so concurrent first validations
        // can never both create action revision 1 (Review 4860863804).
        await repositories.aggregates.lockActionId(request.actionId);
        const existing = await repositories.aggregates.lock(request.actionId);
        if (
          existing &&
          existing.status !== 'CANDIDATE_VALIDATED' &&
          existing.status !== 'MANIFEST_READY'
        ) {
          externalActionFailure(
            'EXTERNAL_ACTION_STALE',
            'The External Action is already in a later lifecycle state.',
          );
        }
        if (request.parameterRef.parameterDigest === undefined) {
          externalActionFailure('VALIDATION_FAILED', 'The parameter digest is required.');
        }
        const now = this.nowIso();
        const existingCandidate = await repositories.candidates.findByActionId(request.actionId);
        // Risk decision reuse is bound to the candidate semantic digest (which
        // covers operation/target/parameter/evidence/compensation) AND the
        // policy context: the same candidate meaning under a changed policy
        // context requires a NEW risk decision (AC-02/ADR-129; Review
        // 4859910949).
        const semanticsUnchanged =
          existingCandidate !== undefined &&
          existingCandidate.candidateDigest === commandSemanticDigest &&
          (existing?.policyContextRevision ?? scope.policyContextRevision) ===
            scope.policyContextRevision;
        const riskDecisionId =
          semanticsUnchanged && existingCandidate
            ? existingCandidate.riskDecisionRef.resourceId
            : generatedIdentity('risk');
        const candidateId = request.candidateId;
        const existingRiskDecision =
          semanticsUnchanged && existingCandidate
            ? await repositories.riskDecisions.find(request.actionId, riskDecisionId)
            : undefined;
        const riskDecision: RiskDecisionV1 = existingRiskDecision ?? {
          schemaVersion: '1.0.0',
          riskDecisionId,
          actionId: request.actionId,
          resourceProjectId: scope.activeProjectId,
          effectiveProjectId: scope.activeProjectId,
          riskLevel: this.riskLevelForOperation(request.operation),
          policyVersion: 'stage11.action-risk.v1',
          requiresUserApproval: this.operationRequiresApproval(request.operation),
          reasons: [request.operation],
          decidedAt: now,
        };
        const candidate: ActionCandidateV1 = {
          schemaVersion: '1.0.0',
          candidateId,
          candidateRevision: (existingCandidate?.candidateRevision ?? 0) + 1,
          actionId: request.actionId,
          resourceProjectId: scope.activeProjectId,
          effectiveProjectId: scope.activeProjectId,
          sourceRefs: [],
          operation: request.operation,
          targetRef: request.targetRef,
          parameterRef: request.parameterRef,
          evidenceRefs: request.evidenceRefs,
          compensationForActionId: request.compensationForActionId,
          candidateDigest: commandSemanticDigest,
          riskDecisionRef: externalActionResourceRef('riskDecision', riskDecisionId, 1),
          generatedAt: now,
          generatedBy: scope.actor,
        };
        if (!existingRiskDecision) {
          await repositories.riskDecisions.insert(riskDecision);
        }
        await repositories.candidates.insert(candidate);
        const action: ExternalActionV1 = {
          schemaVersion: '1.0.0',
          actionId: request.actionId,
          actionRevision: existing ? existing.actionRevision + 1 : 1,
          operation: request.operation,
          resourceProjectId: scope.activeProjectId,
          effectiveProjectId: scope.activeProjectId,
          accessRevision: scope.accessRevision,
          policyContextRevision: scope.policyContextRevision,
          status: 'CANDIDATE_VALIDATED',
          aggregateState: 'AVAILABLE',
          accessMasking: 'VISIBLE',
          maskedFields: [],
          capabilities: externalActionCapabilitiesForScope(scope),
          updatedAt: now,
          createdAt: existing ? existing.createdAt : now,
          targetRef: request.targetRef,
          riskDecisionRef: externalActionResourceRef('riskDecision', riskDecisionId, 1),
          manifestRef: undefined,
          approvalRef: undefined,
          latestExecutionRef: undefined,
          compensationForActionId: request.compensationForActionId,
        };
        if (existing) {
          await repositories.aggregates.update(action);
        } else {
          await repositories.aggregates.insert(action);
        }
        await this.appendAudit(
          repositories,
          action,
          'ACTION_RISK_DECIDED',
          'Risk decision bound to the candidate semantic digest.',
          await this.nextAuditSequence(repositories, action.actionId),
        );
        await this.appendAudit(
          repositories,
          action,
          'ACTION_CANDIDATE_VALIDATED',
          'Candidate validated and staged.',
          await this.nextAuditSequence(repositories, action.actionId),
        );
        return {
          schemaVersion: '1.0.0',
          outcome: 'COMPLETED',
          clientRequestId: request.clientRequestId,
          idempotencyKey: request.idempotencyKey,
          commandSemanticDigest,
          actionId: request.actionId,
          riskDecision,
          candidate,
        };
      },
      producedResources: (result) => [
        {
          resourceKind: FRONTEND_EXTERNAL_ACTION_RESOURCE_KIND.action,
          resourceId: result.actionId,
        },
        {
          resourceKind: FRONTEND_EXTERNAL_ACTION_RESOURCE_KIND.riskDecision,
          resourceId: result.riskDecision.riskDecisionId,
        },
        {
          resourceKind: FRONTEND_EXTERNAL_ACTION_RESOURCE_KIND.candidate,
          resourceId: result.candidate.candidateId,
        },
      ],
    });
  }

  async prepareActionManifest(
    scope: FrontendExternalActionScopeV1,
    request: PrepareActionManifestRequestV1,
  ): Promise<PrepareActionManifestResultV1> {
    this.requireCapability(scope, 'PREPARE_MANIFEST');
    const commandSemanticDigest = frontendExternalActionManifestDigest(request);
    return this.runCommand<PrepareActionManifestResultV1>({
      scope,
      commandType: FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.prepareManifest,
      request,
      commandSemanticDigest,
      resourceProjectId: scope.activeProjectId,
      actionOnRepositories: async (repositories) => {
        const action = await this.aggregateFor(repositories, request.actionId);
        this.assertProjectAndPolicy(action, scope);
        if (action.actionRevision !== request.expectedActionRevision) {
          externalActionFailure(
            'EXTERNAL_ACTION_STALE',
            `Expected action revision ${request.expectedActionRevision} but the current revision is ${action.actionRevision}.`,
          );
        }
        const candidate = await this.findCandidateForAction(repositories, action.actionId);
        if (!candidate) {
          externalActionFailure(
            'ACTION_MANIFEST_NOT_READY',
            'No validated candidate exists for this External Action.',
          );
        }
        const now = this.nowIso();
        const manifestRevision =
          (await this.currentManifestRevision(repositories, action.actionId)) + 1;
        const manifestId = generatedIdentity('manifest');
        const parameterCount = candidate.evidenceRefs.length + 1;
        if (parameterCount > EXTERNAL_ACTION_MANIFEST_PARAMETER_MAX) {
          externalActionFailure(
            'VALIDATION_FAILED',
            `A Manifest cannot exceed ${EXTERNAL_ACTION_MANIFEST_PARAMETER_MAX} parameters.`,
          );
        }
        // Stable evidence set: reuse the candidate evidence, or a deterministic
        // fallback (never two different random IDs for manifest vs digest).
        const evidenceSetRef =
          candidate.evidenceRefs[0] ??
          ({
            schemaVersion: '1.0.0',
            evidenceSetId: `${action.actionId}:default-evidence`,
            evidenceSetDigest: sha256Text(stableJson({ actionId: action.actionId })),
          } as const);
        const targetDigest = this.targetDigestFor(candidate.targetRef);
        const payloadDigest = this.payloadDigestFor({
          operation: candidate.operation,
          targetId: candidate.targetRef.targetId,
          targetRevision: candidate.targetRef.targetRevision,
          parameterId: candidate.parameterRef.parameterId,
          parameterRevision: candidate.parameterRef.parameterRevision,
          evidenceSetId: evidenceSetRef.evidenceSetId,
        });
        const manifest: ActionManifestV1 = {
          schemaVersion: '1.0.0',
          manifestId,
          manifestRevision,
          actionId: action.actionId,
          resourceProjectId: action.resourceProjectId,
          effectiveProjectId: action.effectiveProjectId,
          targetId: candidate.targetRef.targetId,
          targetRevision: candidate.targetRef.targetRevision,
          targetDigest,
          externalRevision: candidate.targetRef.externalRevision,
          parameterRef: candidate.parameterRef,
          parameterDigest: candidate.parameterRef.parameterDigest,
          evidenceSetRef,
          evidenceSetDigest: evidenceSetRef.evidenceSetDigest,
          payloadDigest,
          manifestDigest: externalActionManifestDigest({
            manifestId,
            manifestRevision,
            actionId: action.actionId,
            targetId: candidate.targetRef.targetId,
            targetRevision: candidate.targetRef.targetRevision,
            targetDigest,
            externalRevision: candidate.targetRef.externalRevision,
            parameterRef: candidate.parameterRef,
            parameterDigest: candidate.parameterRef.parameterDigest,
            evidenceSetRef,
            evidenceSetDigest: evidenceSetRef.evidenceSetDigest,
            payloadDigest,
          }),
          expiresAt: new Date(Date.parse(now) + 7 * 24 * 60 * 60 * 1000).toISOString(),
          createdAt: now,
          createdBy: scope.actor,
        };
        await repositories.manifests.insert(manifest);
        const updated: ExternalActionV1 = {
          ...action,
          actionRevision: action.actionRevision + 1,
          status: 'MANIFEST_READY',
          manifestRef: externalActionResourceRef('manifest', manifestId, manifestRevision),
          updatedAt: now,
        };
        await repositories.aggregates.update(updated);
        return {
          schemaVersion: '1.0.0',
          outcome: 'COMPLETED',
          clientRequestId: request.clientRequestId,
          idempotencyKey: request.idempotencyKey,
          commandSemanticDigest,
          actionId: action.actionId,
          manifest,
        };
      },
      producedResources: (result) => [
        {
          resourceKind: FRONTEND_EXTERNAL_ACTION_RESOURCE_KIND.action,
          resourceId: result.actionId,
        },
        {
          resourceKind: FRONTEND_EXTERNAL_ACTION_RESOURCE_KIND.manifest,
          resourceId: result.manifest.manifestId,
          resourceRevision: String(result.manifest.manifestRevision),
        },
      ],
    });
  }

  async approveExternalAction(
    scope: FrontendExternalActionScopeV1,
    request: ApproveExternalActionRequestV1,
  ): Promise<ApproveExternalActionResultV1> {
    this.requireCapability(scope, 'APPROVE_EXTERNAL_ACTION');
    const commandSemanticDigest = frontendExternalActionApproveDigest(request);
    return this.runCommand<ApproveExternalActionResultV1>({
      scope,
      commandType: FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.approve,
      request,
      commandSemanticDigest,
      resourceProjectId: scope.activeProjectId,
      actionOnRepositories: async (repositories) => {
        const action = await this.aggregateFor(repositories, request.actionId);
        this.assertProjectAndPolicy(action, scope);
        const manifest = await repositories.manifests.findById(request.manifestId);
        if (
          !manifest ||
          manifest.actionId !== action.actionId ||
          manifest.manifestRevision !== request.manifestRevision
        ) {
          externalActionFailure(
            'ACTION_MANIFEST_CHANGED',
            'The manifest does not match the requested revision.',
          );
        }
        if (
          manifest.targetRevision !== request.expectedTargetRevision ||
          manifest.externalRevision !== request.expectedExternalRevision
        ) {
          externalActionFailure(
            'EXTERNAL_TARGET_CHANGED',
            'The external target revision changed since the manifest was prepared.',
          );
        }
        const now = this.nowIso();
        const approval: ExternalActionApprovalV1 = {
          schemaVersion: '1.0.0',
          approvalId: generatedIdentity('approval'),
          purpose: 'EXTERNAL_ACTION',
          actionId: action.actionId,
          resourceProjectId: action.resourceProjectId,
          effectiveProjectId: action.effectiveProjectId,
          manifestId: manifest.manifestId,
          manifestRevision: manifest.manifestRevision,
          manifestDigest: manifest.manifestDigest,
          targetId: manifest.targetId,
          targetRevision: manifest.targetRevision,
          targetDigest: manifest.targetDigest,
          externalRevision: manifest.externalRevision,
          actor: scope.actor,
          projectId: scope.activeProjectId,
          accessRevision: scope.accessRevision,
          policyContextRevision: scope.policyContextRevision,
          reason: request.reason,
          issuedAt: now,
          expiresAt: new Date(Date.parse(now) + EXTERNAL_ACTION_APPROVAL_TTL_MS).toISOString(),
          status: 'ACTIVE',
        };
        await repositories.approvals.insert(approval);
        const updated: ExternalActionV1 = {
          ...action,
          actionRevision: action.actionRevision + 1,
          status: 'APPROVED',
          approvalRef: externalActionResourceRef('approval', approval.approvalId),
          updatedAt: now,
        };
        await repositories.aggregates.update(updated);
        // An explicit approval of the rollback manifest transitions the
        // rollback resource PREPARED → APPROVED (rollback is never approved
        // implicitly — the user explicitly approves the reversal).
        if ((await this.rollbackContextFor(repositories, action)).active) {
          const rollback = await repositories.rollbacks.find(action.actionId);
          if (rollback && rollback.status === 'PREPARED') {
            await repositories.rollbacks.update({
              ...rollback,
              status: 'APPROVED',
              approvalRef: externalActionResourceRef('approval', approval.approvalId),
              updatedAt: now,
            });
          }
        }
        await this.appendAudit(
          repositories,
          updated,
          'ACTION_APPROVED',
          'External action approved.',
          await this.nextAuditSequence(repositories, action.actionId),
        );
        return {
          schemaVersion: '1.0.0',
          outcome: 'COMPLETED',
          clientRequestId: request.clientRequestId,
          idempotencyKey: request.idempotencyKey,
          commandSemanticDigest,
          actionId: action.actionId,
          approval,
        };
      },
      producedResources: (result) => [
        {
          resourceKind: FRONTEND_EXTERNAL_ACTION_RESOURCE_KIND.action,
          resourceId: result.actionId,
        },
        {
          resourceKind: FRONTEND_EXTERNAL_ACTION_RESOURCE_KIND.approval,
          resourceId: result.approval.approvalId,
        },
      ],
    });
  }

  async preflightExternalAction(
    scope: FrontendExternalActionScopeV1,
    request: PreflightExternalActionRequestV1,
  ): Promise<PreflightExternalActionResultV1> {
    this.requireCapability(scope, 'PREFLIGHT_EXTERNAL_ACTION');
    const commandSemanticDigest = frontendExternalActionPreflightDigest(request);
    return this.runCommand<PreflightExternalActionResultV1>({
      scope,
      commandType: FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.preflight,
      request,
      commandSemanticDigest,
      resourceProjectId: scope.activeProjectId,
      actionOnRepositories: async (repositories) => {
        const action = await this.aggregateFor(repositories, request.actionId);
        this.assertProjectAndPolicy(action, scope);
        if (action.actionRevision !== request.expectedActionRevision) {
          externalActionFailure(
            'EXTERNAL_ACTION_STALE',
            'The External Action revision changed since preflight was requested.',
          );
        }
        const manifest = await repositories.manifests.findCurrent(action.actionId);
        if (!manifest || manifest.manifestRevision !== request.manifestRevision) {
          externalActionFailure(
            'ACTION_MANIFEST_NOT_READY',
            'The requested manifest is not the current manifest.',
          );
        }
        if (manifest.externalRevision !== request.expectedExternalRevision) {
          externalActionFailure(
            'EXTERNAL_TARGET_CHANGED',
            'The external revision changed since the manifest was prepared.',
          );
        }
        const approval = await repositories.approvals.findActiveByAction(action.actionId);
        if (!approval) {
          externalActionFailure(
            'ACTION_APPROVAL_REQUIRED',
            'An ACTIVE External Action approval is required before preflight.',
          );
        }
        this.assertApprovalMatchesExecutionContext(approval, manifest, scope);
        const now = this.nowIso();
        const preflightId = generatedIdentity('preflight');
        const preflight: PreflightV1 = {
          schemaVersion: '1.0.0',
          preflightId,
          concreteKind: 'PREFLIGHT',
          actionId: action.actionId,
          resourceProjectId: action.resourceProjectId,
          effectiveProjectId: action.effectiveProjectId,
          manifestRevision: manifest.manifestRevision,
          preflightDigest: commandSemanticDigest,
          status: 'DENIED',
          reasons: [],
          permissionRevalidated: true,
          credentialRevalidated: await this.credentialAvailable(
            repositories,
            this.engine.identity.connectorId,
          ),
          budgetRevalidated: await this.budgetAvailable(repositories, scope.activeProjectId),
          policyRevalidated: true,
          targetStateRevalidated: false,
          externalRevisionRevalidated: false,
          runAt: now,
          expiresAt: new Date(Date.parse(now) + 30 * 60 * 1000).toISOString(),
        };
        // Engine revalidates target state + external revision. A rollback
        // preflight is flagged to the engine (rollback semantics), never
        // presented as the forward operation.
        const rollbackContext = await this.rollbackContextFor(repositories, action);
        const outcome = await this.engine.preflight({
          scope: this.engineScope(scope),
          actionId: action.actionId,
          actionRevision: action.actionRevision,
          operation: action.operation,
          targetRef:
            action.targetRef ??
            externalActionFailure(
              'EXTERNAL_ACTION_NOT_FOUND',
              'The External Action is access-restricted.',
            ),
          manifest,
          preflight,
          rollback: rollbackContext.active,
        });
        // ALREADY_APPLIED is preserved as a Product result (the operation is
        // already reflected externally; it blocks re-execution).
        const status =
          outcome.status === 'ALREADY_APPLIED'
            ? 'ALREADY_APPLIED'
            : preflightRevalidationFlags({
                permissionRevalidated: true,
                credentialRevalidated: preflight.credentialRevalidated,
                budgetRevalidated: preflight.budgetRevalidated,
                policyRevalidated: true,
                targetStateRevalidated: outcome.targetStateRevalidated,
                externalRevisionRevalidated: outcome.externalRevisionRevalidated,
              });
        const finalPreflight: PreflightV1 = {
          ...preflight,
          status,
          reasons: status === 'DENIED' ? [outcome.reason ?? 'preflight revalidation failed'] : [],
          targetStateRevalidated: outcome.targetStateRevalidated,
          externalRevisionRevalidated: outcome.externalRevisionRevalidated,
        };
        await repositories.preflights.insert(finalPreflight);
        const updated: ExternalActionV1 = {
          ...action,
          actionRevision: action.actionRevision + 1,
          status: status === 'READY' ? 'PREFLIGHT_READY' : 'PREFLIGHT_FAILED',
          updatedAt: now,
        };
        await repositories.aggregates.update(updated);
        await this.appendAudit(
          repositories,
          updated,
          status === 'READY' ? 'ACTION_PREFLIGHT_PASSED' : 'ACTION_PREFLIGHT_FAILED',
          status === 'READY'
            ? 'Preflight passed all six revalidations.'
            : 'Preflight did not pass all revalidations.',
          await this.nextAuditSequence(repositories, action.actionId),
        );
        return {
          schemaVersion: '1.0.0',
          outcome: 'COMPLETED',
          clientRequestId: request.clientRequestId,
          idempotencyKey: request.idempotencyKey,
          commandSemanticDigest,
          actionId: action.actionId,
          preflight: finalPreflight,
        };
      },
      producedResources: (result) => [
        {
          resourceKind: FRONTEND_EXTERNAL_ACTION_RESOURCE_KIND.action,
          resourceId: result.actionId,
        },
        {
          resourceKind: FRONTEND_EXTERNAL_ACTION_RESOURCE_KIND.preflight,
          resourceId: result.preflight.preflightId,
        },
      ],
    });
  }

  async executeExternalAction(
    scope: FrontendExternalActionScopeV1,
    request: ExecuteExternalActionRequestV1,
  ): Promise<ExecuteExternalActionResultV1> {
    this.requireCapability(scope, 'EXECUTE_EXTERNAL_ACTION');
    const commandSemanticDigest = frontendExternalActionExecuteDigest(request);
    return this.runConnectorCommand<ExecuteExternalActionResultV1>({
      scope,
      commandType: FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.execute,
      request,
      commandSemanticDigest,
      resourceProjectId: scope.activeProjectId,
      persistStarted: async (repositories) => {
        const action = await this.aggregateFor(repositories, request.actionId);
        this.assertProjectAndPolicy(action, scope);
        this.assertStaleNotBlocking(action);
        // A connector command is already in flight for this action: a second
        // execute must never start a parallel execution (Review 4861031725).
        if (action.status === 'EXECUTING') {
          externalActionFailure(
            'ACTION_EXECUTION_NOT_ALLOWED',
            'The External Action is already executing.',
          );
        }
        if (action.actionRevision !== request.expectedActionRevision) {
          externalActionFailure(
            'EXTERNAL_ACTION_STALE',
            'The External Action revision changed since execute was requested.',
          );
        }
        const manifest = await repositories.manifests.findCurrent(action.actionId);
        if (!manifest || manifest.manifestRevision !== request.manifestRevision) {
          externalActionFailure(
            'ACTION_MANIFEST_CHANGED',
            'The manifest changed since execute was requested.',
          );
        }
        const preflight = await repositories.preflights.findById(request.preflightId);
        if (
          !preflightIsReady(
            preflight ??
              externalActionFailure('ACTION_PREFLIGHT_EXPIRED', 'The preflight is unavailable.'),
            manifest.manifestRevision,
            this.nowIso(),
          )
        ) {
          externalActionFailure(
            'ACTION_PREFLIGHT_EXPIRED',
            'A READY preflight with a future expiry is required before execution.',
          );
        }
        if (!preflight) {
          externalActionFailure('ACTION_PREFLIGHT_EXPIRED', 'The preflight is unavailable.');
        }
        // The preflight must belong to this exact action (no cross-action reuse).
        if (
          preflight.actionId !== action.actionId ||
          preflight.resourceProjectId !== action.resourceProjectId ||
          preflight.effectiveProjectId !== action.effectiveProjectId
        ) {
          externalActionFailure(
            'ACTION_PREFLIGHT_EXPIRED',
            'The preflight does not belong to this External Action.',
          );
        }
        if (manifest.externalRevision !== request.expectedExternalRevision) {
          externalActionFailure(
            'EXTERNAL_TARGET_CHANGED',
            'The external revision changed since preflight.',
          );
        }
        const approval = await repositories.approvals.findActiveByAction(action.actionId);
        if (!approval) {
          externalActionFailure(
            'ACTION_APPROVAL_REQUIRED',
            'An ACTIVE approval is required before execution.',
          );
        }
        this.assertApprovalMatchesExecutionContext(approval, manifest, scope);
        // Atomic reservation BEFORE the connector call (never a plain check).
        await this.reserveBudget(repositories, scope.activeProjectId);
        if (!(await this.credentialAvailable(repositories, this.engine.identity.connectorId))) {
          externalActionFailure(
            'ACTION_CREDENTIAL_UNAVAILABLE',
            'The connector credential is not configured.',
          );
        }
        const now = this.nowIso();
        const executionId = generatedIdentity('execution');
        const attempt: ExecutionAttemptV1 = {
          schemaVersion: '1.0.0',
          attemptId: generatedIdentity('attempt'),
          attemptNumber: 1,
          executionId,
          actionId: action.actionId,
          resourceProjectId: action.resourceProjectId,
          effectiveProjectId: action.effectiveProjectId,
          idempotencyKey: request.idempotencyKey,
          status: 'IN_PROGRESS',
          policyContextRevision: action.policyContextRevision,
          externalRevision: manifest.externalRevision,
          correlationId: generatedIdentity('corr'),
          startedAt: now,
        };
        const execution: ExecutionV1 = {
          schemaVersion: '1.0.0',
          executionId,
          concreteKind: 'EXECUTION',
          actionId: action.actionId,
          resourceProjectId: action.resourceProjectId,
          effectiveProjectId: action.effectiveProjectId,
          manifestRevision: manifest.manifestRevision,
          status: 'IN_PROGRESS',
          attemptCount: 1,
          startedAt: now,
          latestAttemptRef: externalActionResourceRef('attempt', attempt.attemptId, 1),
        };
        // Phase 1 persists the started attempt/execution (recoverable).
        await repositories.attempts.insert(attempt);
        await repositories.executions.insert(execution);
        const executing: ExternalActionV1 = {
          ...action,
          actionRevision: action.actionRevision + 1,
          status: 'EXECUTING',
          latestExecutionRef: externalActionResourceRef('execution', executionId),
          updatedAt: now,
        };
        await repositories.aggregates.update(executing);
        // A rollback execution transitions the rollback resource to EXECUTING
        // and pins its execution ref to the rollback execution.
        const rollbackContext = await this.rollbackContextFor(repositories, action);
        if (rollbackContext.active) {
          const rollback = await repositories.rollbacks.find(action.actionId);
          if (rollback && (rollback.status === 'PREPARED' || rollback.status === 'APPROVED')) {
            await repositories.rollbacks.update({
              ...rollback,
              status: 'EXECUTING',
              executionRef: externalActionResourceRef('execution', executionId),
              updatedAt: now,
            });
          }
        }
        return {
          producedResources: [
            {
              resourceKind: FRONTEND_EXTERNAL_ACTION_RESOURCE_KIND.action,
              resourceId: action.actionId,
            },
            {
              resourceKind: FRONTEND_EXTERNAL_ACTION_RESOURCE_KIND.execution,
              resourceId: executionId,
            },
            {
              resourceKind: FRONTEND_EXTERNAL_ACTION_RESOURCE_KIND.attempt,
              resourceId: attempt.attemptId,
            },
          ],
          engineInput: {
            scope: this.engineScope(scope),
            actionId: action.actionId,
            actionRevision: action.actionRevision,
            operation: action.operation,
            targetRef:
              action.targetRef ??
              externalActionFailure(
                'EXTERNAL_ACTION_NOT_FOUND',
                'The External Action is access-restricted.',
              ),
            manifest,
            attempt,
            rollback: rollbackContext.active,
          },
          startedRefs: {
            executionId,
            attemptId: attempt.attemptId,
            expectedActionRevision: action.actionRevision,
          },
        };
      },
      executeEngine: async ({ engineInput }) => ({
        execute: await this.engine.execute(engineInput),
      }),
      finalize: async (repositories, outcome, startedRefs) => {
        const engineResult = outcome.execute;
        // Re-lock the action row (FOR UPDATE) at the terminal commit and PIN
        // the finalize to the EXACT Phase-1 state: action still EXECUTING,
        // revision exactly expectedActionRevision + 1, latest execution is the
        // started one, and execution/attempt still IN_PROGRESS. Any deviation
        // means a concurrent governed command changed the aggregate — fail
        // closed instead of finalizing a resource we no longer own
        // (Reviews 4861031725 / 4861145103).
        const { action, executionId, execution, attempt } = await this.lockStartedActionForFinalize(
          repositories,
          request.actionId,
          startedRefs,
        );
        const completedAt = this.nowIso();
        const finalAttempt: ExecutionAttemptV1 = {
          ...attempt,
          status: engineResult.status,
          completedAt,
          providerRef: engineResult.externalId
            ? externalActionResourceRef(
                'provider',
                `${this.engine.identity.connectorId}:${engineResult.externalId}`,
              )
            : undefined,
        };
        await repositories.attempts.insert(finalAttempt);
        const finalExecution: ExecutionV1 = {
          ...execution,
          status: engineResult.status,
          completedAt,
        };
        await repositories.executions.update(finalExecution);
        const updated: ExternalActionV1 = {
          ...action,
          actionRevision: action.actionRevision + 1,
          status:
            engineResult.status === 'SUCCEEDED'
              ? 'VERIFYING'
              : engineResult.status === 'FAILED'
                ? 'FAILED'
                : 'OUTCOME_UNKNOWN',
          latestExecutionRef: externalActionResourceRef('execution', executionId),
          updatedAt: completedAt,
        };
        await repositories.aggregates.update(updated);
        // A rollback execution reaches ROLLED_BACK only through verification;
        // a FAILED/OUTCOME_UNKNOWN rollback execution marks the rollback
        // resource accordingly (connector success alone never confirms the
        // reversal — AC-11/Review 4859910949).
        if ((await this.rollbackContextFor(repositories, action)).active) {
          const rollback = await repositories.rollbacks.find(action.actionId);
          if (rollback && rollback.status === 'EXECUTING') {
            if (engineResult.status === 'FAILED' || engineResult.status === 'OUTCOME_UNKNOWN') {
              await repositories.rollbacks.update({
                ...rollback,
                status: engineResult.status === 'FAILED' ? 'FAILED' : 'OUTCOME_UNKNOWN',
                updatedAt: completedAt,
              });
            }
          }
        }
        await this.appendAudit(
          repositories,
          updated,
          engineResult.status === 'OUTCOME_UNKNOWN' ? 'ACTION_OUTCOME_UNKNOWN' : 'ACTION_EXECUTED',
          engineResult.status === 'OUTCOME_UNKNOWN'
            ? 'Execution completed with an unknown outcome.'
            : 'External action executed.',
          await this.nextAuditSequence(repositories, action.actionId),
        );
        const result: ExecuteExternalActionResultV1 = {
          schemaVersion: '1.0.0',
          outcome: engineResult.status === 'OUTCOME_UNKNOWN' ? 'OUTCOME_UNKNOWN' : 'COMPLETED',
          clientRequestId: request.clientRequestId,
          idempotencyKey: request.idempotencyKey,
          commandSemanticDigest,
          actionId: action.actionId,
          execution: finalExecution,
          attempt: finalAttempt,
        };
        return result;
      },
    });
  }

  async retryExecutionAttempt(
    scope: FrontendExternalActionScopeV1,
    request: RetryExecutionAttemptRequestV1,
  ): Promise<RetryExecutionAttemptResultV1> {
    this.requireCapability(scope, 'RETRY_EXECUTION_ATTEMPT');
    const commandSemanticDigest = frontendExternalActionRetryDigest(request);
    return this.runConnectorCommand<RetryExecutionAttemptResultV1>({
      scope,
      commandType: FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.retryAttempt,
      request,
      commandSemanticDigest,
      resourceProjectId: scope.activeProjectId,
      persistStarted: async (repositories) => {
        const action = await this.aggregateFor(repositories, request.actionId);
        this.assertProjectAndPolicy(action, scope);
        // A connector command is already in flight: never start a parallel
        // retry execution (Review 4861031725).
        if (action.status === 'EXECUTING') {
          externalActionFailure(
            'ACTION_EXECUTION_NOT_ALLOWED',
            'The External Action is already executing.',
          );
        }
        const execution = await repositories.executions.findById(request.executionId);
        if (!execution || execution.actionId !== action.actionId) {
          externalActionFailure(
            'EXTERNAL_ACTION_NOT_FOUND',
            'The execution was not found for this External Action.',
          );
        }
        const attempts = await repositories.attempts.lockByExecution(execution.executionId);
        const source = attempts.find((entry) => entry.attemptId === request.sourceAttemptId);
        if (!source) {
          externalActionFailure('EXTERNAL_ACTION_NOT_FOUND', 'The source attempt was not found.');
        }
        if (!(
          source.status === 'FAILED' ||
          source.status === 'OUTCOME_UNKNOWN' ||
          source.status === 'CANCELLED'
        )) {
          externalActionFailure(
            'ACTION_EXECUTION_NOT_ALLOWED',
            'Only a failed, cancelled or unknown attempt can be retried.',
          );
        }
        if (attempts.length >= EXTERNAL_ACTION_ATTEMPT_LIST_CAP) {
          externalActionFailure(
            'VALIDATION_FAILED',
            `An Execution cannot exceed ${EXTERNAL_ACTION_ATTEMPT_LIST_CAP} attempts.`,
          );
        }
        const now = this.nowIso();
        const attemptNumber = attempts.length + 1;
        const attempt: ExecutionAttemptV1 = {
          schemaVersion: '1.0.0',
          attemptId: generatedIdentity('attempt'),
          attemptNumber,
          executionId: execution.executionId,
          actionId: action.actionId,
          resourceProjectId: action.resourceProjectId,
          effectiveProjectId: action.effectiveProjectId,
          idempotencyKey: request.idempotencyKey,
          status: 'IN_PROGRESS',
          policyContextRevision: action.policyContextRevision,
          externalRevision: source.externalRevision,
          correlationId: generatedIdentity('corr'),
          causationId: request.causationId,
          startedAt: now,
        };
        const manifest = await repositories.manifests.findCurrent(action.actionId);
        if (!manifest) {
          externalActionFailure(
            'ACTION_MANIFEST_NOT_READY',
            'No manifest is available for the retry.',
          );
        }
        // Domain retry revalidates the full server context (AC-05/AC-06):
        // ACTIVE approval bound to the exact manifest, external revision,
        // credential and budget. A change requires re-approval, never bypass.
        if (source.externalRevision !== manifest.externalRevision) {
          externalActionFailure(
            'EXTERNAL_TARGET_CHANGED',
            'The external revision changed since the source attempt.',
          );
        }
        const approval = await repositories.approvals.findActiveByAction(action.actionId);
        if (!approval) {
          externalActionFailure(
            'ACTION_APPROVAL_REQUIRED',
            'An ACTIVE approval is required before retrying an attempt.',
          );
        }
        this.assertApprovalMatchesExecutionContext(approval, manifest, scope);
        // Atomic reservation BEFORE the connector call (never a plain check).
        await this.reserveBudget(repositories, scope.activeProjectId);
        if (!(await this.credentialAvailable(repositories, this.engine.identity.connectorId))) {
          externalActionFailure(
            'ACTION_CREDENTIAL_UNAVAILABLE',
            'The connector credential is not configured.',
          );
        }
        // Retry runs a NEW target-state preflight before re-executing; the
        // stored external revision comparison alone is not enough (AC-08). The
        // started attempt/execution/aggregate and an initial DENIED preflight
        // record are made durable FIRST (Phase 1) so a preflight timeout or
        // exception can never leave the retry without a recoverable resource
        // (Review 4859910949).
        const preflight: PreflightV1 = {
          schemaVersion: '1.0.0',
          preflightId: generatedIdentity('preflight'),
          concreteKind: 'PREFLIGHT',
          actionId: action.actionId,
          resourceProjectId: action.resourceProjectId,
          effectiveProjectId: action.effectiveProjectId,
          manifestRevision: manifest.manifestRevision,
          preflightDigest: commandSemanticDigest,
          status: 'DENIED',
          reasons: [],
          permissionRevalidated: true,
          credentialRevalidated: true,
          budgetRevalidated: true,
          policyRevalidated: true,
          targetStateRevalidated: false,
          externalRevisionRevalidated: false,
          runAt: now,
          expiresAt: new Date(Date.parse(now) + 30 * 60 * 1000).toISOString(),
        };
        const retryTargetRef =
          action.targetRef ??
          externalActionFailure(
            'EXTERNAL_ACTION_NOT_FOUND',
            'The External Action is access-restricted.',
          );
        // Phase 1 persists the started retry attempt/execution (recoverable).
        await repositories.preflights.insert(preflight);
        await repositories.attempts.insert(attempt);
        const retryingExecution: ExecutionV1 = {
          ...execution,
          status: 'IN_PROGRESS',
          attemptCount: attemptNumber,
          latestAttemptRef: externalActionResourceRef('attempt', attempt.attemptId, attemptNumber),
        };
        await repositories.executions.update(retryingExecution);
        const retrying: ExternalActionV1 = {
          ...action,
          actionRevision: action.actionRevision + 1,
          status: 'EXECUTING',
          updatedAt: now,
        };
        await repositories.aggregates.update(retrying);
        return {
          producedResources: [
            {
              resourceKind: FRONTEND_EXTERNAL_ACTION_RESOURCE_KIND.action,
              resourceId: action.actionId,
            },
            {
              resourceKind: FRONTEND_EXTERNAL_ACTION_RESOURCE_KIND.execution,
              resourceId: execution.executionId,
            },
            {
              resourceKind: FRONTEND_EXTERNAL_ACTION_RESOURCE_KIND.attempt,
              resourceId: attempt.attemptId,
            },
          ],
          engineInput: {
            scope: this.engineScope(scope),
            actionId: action.actionId,
            actionRevision: action.actionRevision,
            operation: action.operation,
            targetRef: retryTargetRef,
            manifest,
            attempt,
          },
          preflightInput: {
            scope: this.engineScope(scope),
            actionId: action.actionId,
            actionRevision: action.actionRevision,
            operation: action.operation,
            targetRef: retryTargetRef,
            manifest,
            preflight,
          },
          startedRefs: {
            executionId: execution.executionId,
            attemptId: attempt.attemptId,
            expectedActionRevision: action.actionRevision,
          },
        };
      },
      // Retry preflight runs OUTSIDE the DB transaction (durable resources
      // were already committed). A READY preflight is stored as READY only
      // when BOTH revalidation flags are actually set.
      executeEngine: async ({ engineInput, preflightInput }) => {
        let preflight: ExternalActionPreflightOutcomeV1 | undefined;
        try {
          preflight = preflightInput ? await this.engine.preflight(preflightInput) : undefined;
        } catch {
          preflight = {
            status: 'DENIED',
            reason: 'retry preflight revalidation threw',
            targetStateRevalidated: false,
            externalRevisionRevalidated: false,
          };
        }
        if (preflight) {
          if (preflight.status !== 'READY') return { preflight };
          if (!preflight.targetStateRevalidated || !preflight.externalRevisionRevalidated) {
            return {
              preflight: {
                ...preflight,
                status: 'DENIED' as const,
                reason: 'retry preflight revalidation flags were not set',
              },
            };
          }
        }
        let execute: ExternalActionExecuteOutcomeV1;
        try {
          execute = await this.engine.execute(engineInput);
        } catch {
          execute = {
            status: 'OUTCOME_UNKNOWN',
            correlationId: engineInput.attempt.correlationId,
          };
        }
        return { preflight, execute };
      },
      finalizeDenied: async (repositories, preflight, startedRefs) => {
        // The same Phase-3 ownership pinning applies to the denied-preflight
        // path: only the EXACT Phase-1 started aggregate/execution/attempt may
        // be marked FAILED (Reviews 4861031725 / 4861145103).
        const { action, execution, attempt } = await this.lockStartedActionForFinalize(
          repositories,
          request.actionId,
          startedRefs,
        );
        await repositories.attempts.insert({
          ...attempt,
          status: 'FAILED',
          completedAt: this.nowIso(),
        });
        await repositories.executions.update({
          ...execution,
          status: 'FAILED',
          completedAt: this.nowIso(),
        });
        // The Phase-1 DENIED preflight is already the durable record of the
        // retry preflight. Per the preflight immutability rule (same status ⇒
        // exact replay only, Review 4861145103) it is NOT rewritten with the
        // connector's denial details — the reason is carried by the audit
        // event and the ledger REJECTION below.
        const failed: ExternalActionV1 = {
          ...action,
          actionRevision: action.actionRevision + 1,
          status: 'FAILED',
          updatedAt: this.nowIso(),
        };
        await repositories.aggregates.update(failed);
        await this.appendAudit(
          repositories,
          failed,
          'ACTION_FAILED',
          `Retry blocked by a denied preflight revalidation. ${preflight.reason ?? ''}`.trim(),
          await this.nextAuditSequence(repositories, action.actionId),
        );
      },
      finalize: async (repositories, outcome, startedRefs) => {
        const engineResult = outcome.execute;
        // Re-lock the action row (FOR UPDATE) at the terminal commit and PIN
        // the finalize to the EXACT Phase-1 state (action EXECUTING, revision
        // expectedActionRevision + 1, started execution/attempt still
        // IN_PROGRESS) — never finalize a resource a concurrent command has
        // taken ownership of (Reviews 4861031725 / 4861145103).
        const { action, execution, attempts, attempt } = await this.lockStartedActionForFinalize(
          repositories,
          request.actionId,
          startedRefs,
        );
        // The READY preflight is persisted only now, with the actual
        // revalidation flags from the connector (never assumed). The retry's
        // preflight is identified by its digest (commandSemanticDigest).
        const retryPreflight = outcome.preflight
          ? await repositories.preflights.findCurrent(action.actionId)
          : undefined;
        if (outcome.preflight && retryPreflight?.preflightDigest === commandSemanticDigest) {
          await repositories.preflights.insert({
            ...retryPreflight,
            status: 'READY',
            targetStateRevalidated: outcome.preflight.targetStateRevalidated,
            externalRevisionRevalidated: outcome.preflight.externalRevisionRevalidated,
          });
        }
        const completedAt = this.nowIso();
        const finalAttempt: ExecutionAttemptV1 = {
          ...attempt,
          status: engineResult.status,
          completedAt,
          providerRef: engineResult.externalId
            ? externalActionResourceRef(
                'provider',
                `${this.engine.identity.connectorId}:${engineResult.externalId}`,
              )
            : undefined,
        };
        await repositories.attempts.insert(finalAttempt);
        const finalExecution: ExecutionV1 = {
          ...execution,
          status: engineResult.status,
          attemptCount: attempts.length,
          latestAttemptRef: externalActionResourceRef(
            'attempt',
            attempt.attemptId,
            attempt.attemptNumber,
          ),
          completedAt,
        };
        await repositories.executions.update(finalExecution);
        const updated: ExternalActionV1 = {
          ...action,
          actionRevision: action.actionRevision + 1,
          status:
            engineResult.status === 'SUCCEEDED'
              ? 'VERIFYING'
              : engineResult.status === 'FAILED'
                ? 'FAILED'
                : 'OUTCOME_UNKNOWN',
          updatedAt: completedAt,
        };
        await repositories.aggregates.update(updated);
        await this.appendAudit(
          repositories,
          updated,
          engineResult.status === 'OUTCOME_UNKNOWN' ? 'ACTION_OUTCOME_UNKNOWN' : 'ACTION_EXECUTED',
          engineResult.status === 'OUTCOME_UNKNOWN'
            ? 'Retry completed with an unknown outcome.'
            : 'External action retried.',
          await this.nextAuditSequence(repositories, action.actionId),
        );
        return {
          schemaVersion: '1.0.0',
          outcome: engineResult.status === 'OUTCOME_UNKNOWN' ? 'OUTCOME_UNKNOWN' : 'COMPLETED',
          clientRequestId: request.clientRequestId,
          idempotencyKey: request.idempotencyKey,
          commandSemanticDigest,
          actionId: action.actionId,
          attempt: finalAttempt,
        };
      },
    });
  }

  async verifyExternalAction(
    scope: FrontendExternalActionScopeV1,
    request: VerifyExternalActionRequestV1,
  ): Promise<VerifyExternalActionResultV1> {
    this.requireCapability(scope, 'VERIFY_EXTERNAL_ACTION');
    const commandSemanticDigest = frontendExternalActionVerifyDigest(request);
    return this.runCommand<VerifyExternalActionResultV1>({
      scope,
      commandType: FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.verify,
      request,
      commandSemanticDigest,
      resourceProjectId: scope.activeProjectId,
      actionOnRepositories: async (repositories) => {
        const action = await this.aggregateFor(repositories, request.actionId);
        this.assertProjectAndPolicy(action, scope);
        const execution = await repositories.executions.findById(request.executionId);
        if (!execution || execution.actionId !== action.actionId) {
          externalActionFailure(
            'EXTERNAL_ACTION_NOT_FOUND',
            'The execution was not found for this External Action.',
          );
        }
        if (execution.status !== 'SUCCEEDED') {
          externalActionFailure(
            'ACTION_VERIFICATION_REQUIRED',
            'Only a SUCCEEDED execution can be verified against the external target state.',
          );
        }
        // Verification is pinned to the actual SUCCEEDED, latest attempt
        // (matching latestAttemptRef) with a real provider reference.
        const attempts = await repositories.attempts.lockByExecution(execution.executionId);
        const latestAttempt = attempts[attempts.length - 1];
        const latestAttemptRef = execution.latestAttemptRef;
        if (
          !latestAttempt ||
          latestAttempt.status !== 'SUCCEEDED' ||
          !latestAttempt.providerRef ||
          latestAttemptRef === undefined ||
          latestAttemptRef.resourceId !== latestAttempt.attemptId
        ) {
          externalActionFailure(
            'ACTION_VERIFICATION_REQUIRED',
            'Verification requires the latest SUCCEEDED attempt with a provider reference.',
          );
        }
        if (request.attemptId !== undefined) {
          const attempt = await repositories.attempts.findById(request.attemptId);
          if (
            !attempt ||
            attempt.executionId !== execution.executionId ||
            attempt.attemptId !== latestAttempt.attemptId
          ) {
            externalActionFailure(
              'EXTERNAL_ACTION_NOT_FOUND',
              'The requested attempt is not the latest SUCCEEDED attempt of this execution.',
            );
          }
        }
        const target =
          action.targetRef ??
          externalActionFailure(
            'EXTERNAL_ACTION_NOT_FOUND',
            'The External Action is access-restricted.',
          );
        if (
          target.targetRevision !== request.expectedTargetRevision ||
          target.externalRevision !== request.expectedExternalRevision
        ) {
          externalActionFailure(
            'EXTERNAL_TARGET_CHANGED',
            'The external target revision changed since execution.',
          );
        }
        const now = this.nowIso();
        const rollbackContext = await this.rollbackContextFor(repositories, action);
        const outcome = await this.engine.verify({
          scope: this.engineScope(scope),
          actionId: action.actionId,
          actionRevision: action.actionRevision,
          targetRef: target,
          expectedTargetRevision: request.expectedTargetRevision,
          expectedExternalRevision: request.expectedExternalRevision,
          executionId: execution.executionId,
          // The external verification call is pinned to the ACTUAL latest
          // SUCCEEDED attempt (never undefined / never an arbitrary attempt).
          attemptId: latestAttempt.attemptId,
          // A rollback verification confirms the state reversal (rollback
          // semantics), never the forward operation.
          rollback: rollbackContext.active,
        });
        // Target-state verification evidence: an APPLIED verification without a
        // real observed digest is never fabricated (AC-09/AC-20).
        if (outcome.status === 'APPLIED' && !outcome.observedDigest) {
          externalActionFailure(
            'ACTION_VERIFICATION_MISMATCH',
            'The engine returned APPLIED without an observed target digest.',
          );
        }
        const targetDigest = this.targetDigestFor(target);
        const verification: VerificationV1 = {
          schemaVersion: '1.0.0',
          verificationId: generatedIdentity('verification'),
          concreteKind: 'VERIFICATION',
          actionId: action.actionId,
          resourceProjectId: action.resourceProjectId,
          effectiveProjectId: action.effectiveProjectId,
          executionId: execution.executionId,
          attemptId: latestAttempt.attemptId,
          targetRevision: target.targetRevision,
          targetDigest,
          externalRevision: target.externalRevision,
          status: outcome.status,
          observedDigest: outcome.status === 'NOT_APPLIED' ? undefined : outcome.observedDigest,
          verifiedAt: now,
        };
        await repositories.verifications.insert(verification);
        if (outcome.status === 'APPLIED') {
          // Result external identity is derived ONLY from the connector
          // provider ref of the pinned attempt — never fabricated.
          const providerRef = latestAttempt.providerRef;
          if (!providerRef) {
            externalActionFailure(
              'ACTION_VERIFICATION_MISMATCH',
              'The verified attempt has no provider reference.',
            );
          }
          const externalId = providerRef.resourceId;
          const result: ResultV1 = {
            schemaVersion: '1.0.0',
            resultId: generatedIdentity('result'),
            actionId: action.actionId,
            resourceProjectId: action.resourceProjectId,
            effectiveProjectId: action.effectiveProjectId,
            executionId: execution.executionId,
            attemptId: latestAttempt.attemptId,
            externalId,
            observedDigest: outcome.observedDigest ?? targetDigest,
            completedAt: now,
            verificationRef: externalActionResourceRef('verification', verification.verificationId),
            outputRefs: [],
          };
          await repositories.results.insert(result);
        }
        const rollbackActive = rollbackContext.active && outcome.status === 'APPLIED';
        const updated: ExternalActionV1 = {
          ...action,
          actionRevision: action.actionRevision + 1,
          status:
            outcome.status === 'APPLIED'
              ? rollbackActive
                ? 'ROLLED_BACK'
                : 'VERIFIED'
              : 'VERIFICATION_FAILED',
          updatedAt: now,
        };
        await repositories.aggregates.update(updated);
        // An APPLIED rollback verification is what finally confirms the
        // reversal: the rollback resource transitions EXECUTING → ROLLED_BACK
        // with its verification ref (connector success alone never confirms
        // ROLLED_BACK — AC-11/Review 4859910949).
        if (rollbackActive) {
          const rollback = await repositories.rollbacks.find(action.actionId);
          if (rollback && rollback.status === 'EXECUTING') {
            await repositories.rollbacks.update({
              ...rollback,
              status: 'ROLLED_BACK',
              verificationRef: externalActionResourceRef(
                'verification',
                verification.verificationId,
              ),
              updatedAt: now,
            });
          }
        }
        await this.appendAudit(
          repositories,
          updated,
          outcome.status === 'APPLIED' ? 'ACTION_VERIFIED' : 'ACTION_VERIFICATION_FAILED',
          outcome.status === 'APPLIED'
            ? rollbackActive
              ? 'Rollback verified against the external target state.'
              : 'External action verified against the target state.'
            : 'External action verification failed against the target state.',
          await this.nextAuditSequence(repositories, action.actionId),
        );
        return {
          schemaVersion: '1.0.0',
          outcome: 'COMPLETED',
          clientRequestId: request.clientRequestId,
          idempotencyKey: request.idempotencyKey,
          commandSemanticDigest,
          actionId: action.actionId,
          verification,
        };
      },
      producedResources: (result) => [
        {
          resourceKind: FRONTEND_EXTERNAL_ACTION_RESOURCE_KIND.action,
          resourceId: result.actionId,
        },
        {
          resourceKind: FRONTEND_EXTERNAL_ACTION_RESOURCE_KIND.verification,
          resourceId: result.verification.verificationId,
        },
      ],
    });
  }

  async cancelExternalAction(
    scope: FrontendExternalActionScopeV1,
    request: CancelExternalActionRequestV1,
  ): Promise<CancelExternalActionResultV1> {
    this.requireCapability(scope, 'CANCEL_EXTERNAL_ACTION');
    const commandSemanticDigest = frontendExternalActionCancelDigest(request);
    return this.runCommand<CancelExternalActionResultV1>({
      scope,
      commandType: FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.cancel,
      request,
      commandSemanticDigest,
      resourceProjectId: scope.activeProjectId,
      actionOnRepositories: async (repositories) => {
        const action = await this.aggregateFor(repositories, request.actionId);
        this.assertProjectAndPolicy(action, scope);
        if (action.actionRevision !== request.expectedActionRevision) {
          externalActionFailure(
            'EXTERNAL_ACTION_STALE',
            'The External Action revision changed since cancel was requested.',
          );
        }
        const cancelable: readonly ExternalActionAggregateStatusV1[] = [
          'CANDIDATE_VALIDATED',
          'MANIFEST_READY',
          'APPROVED',
          'PREFLIGHT_READY',
          'READY_TO_EXECUTE',
        ];
        if (!cancelable.includes(action.status)) {
          externalActionFailure(
            'ACTION_CANCEL_NOT_ALLOWED',
            'This External Action cannot be cancelled in its current state.',
          );
        }
        const now = this.nowIso();
        const updated: ExternalActionV1 = {
          ...action,
          actionRevision: action.actionRevision + 1,
          status: 'CANCELLED',
          updatedAt: now,
        };
        await repositories.aggregates.update(updated);
        return {
          schemaVersion: '1.0.0',
          outcome: 'COMPLETED',
          clientRequestId: request.clientRequestId,
          idempotencyKey: request.idempotencyKey,
          commandSemanticDigest,
          actionId: action.actionId,
          status: 'CANCELLED',
        };
      },
      producedResources: (result) => [
        {
          resourceKind: FRONTEND_EXTERNAL_ACTION_RESOURCE_KIND.action,
          resourceId: result.actionId,
        },
      ],
    });
  }

  async rollbackExternalAction(
    scope: FrontendExternalActionScopeV1,
    request: RollbackExternalActionRequestV1,
  ): Promise<RollbackExternalActionResultV1> {
    this.requireCapability(scope, 'ROLLBACK_EXTERNAL_ACTION');
    const commandSemanticDigest = frontendExternalActionRollbackDigest(request);
    return this.runCommand<RollbackExternalActionResultV1>({
      scope,
      commandType: FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.rollback,
      request,
      commandSemanticDigest,
      resourceProjectId: scope.activeProjectId,
      actionOnRepositories: async (repositories) => {
        const action = await this.aggregateFor(repositories, request.actionId);
        this.assertProjectAndPolicy(action, scope);
        if (!(
          action.status === 'VERIFIED' ||
          action.status === 'VERIFICATION_FAILED' ||
          action.status === 'FAILED' ||
          action.status === 'OUTCOME_UNKNOWN' ||
          action.status === 'ROLLBACK_AVAILABLE'
        )) {
          externalActionFailure(
            'ACTION_ROLLBACK_NOT_AVAILABLE',
            'Rollback is not available in the current state.',
          );
        }
        const execution = await repositories.executions.findById(request.executionId);
        if (!execution || execution.actionId !== action.actionId) {
          externalActionFailure(
            'EXTERNAL_ACTION_NOT_FOUND',
            'The execution was not found for this External Action.',
          );
        }
        const sourceManifest = action.manifestRef
          ? await repositories.manifests.findById(action.manifestRef.resourceId)
          : undefined;
        if (!sourceManifest) {
          externalActionFailure(
            'ACTION_MANIFEST_NOT_READY',
            'No manifest exists for the rollback source.',
          );
        }
        const now = this.nowIso();
        // Rollback is a SEPARATE governed state reversal: this command only
        // PREPARES the reversal (own manifest, own risk decision, PREPARED
        // rollback resource, ROLLBACK_AVAILABLE aggregate). It never
        // auto-issues approval, never auto-preflights and never auto-executes
        // — the user explicitly approves the rollback manifest, then preflights
        // and executes/verifies it like any other governed action
        // (AC-11/ADR-129; Review 4859910949).
        const rollbackManifestRevision =
          (await this.currentManifestRevision(repositories, action.actionId)) + 1;
        const rollbackManifestId = generatedIdentity('manifest');
        const rollbackTargetDigest = this.targetDigestFor(action.targetRef);
        const rollbackPayloadDigest = sha256Text(
          stableJson({
            operation: 'ROLLBACK',
            sourceManifest: sourceManifest.manifestId,
            sourceExecution: execution.executionId,
          }),
        );
        const rollbackManifest: ActionManifestV1 = {
          schemaVersion: '1.0.0',
          manifestId: rollbackManifestId,
          manifestRevision: rollbackManifestRevision,
          actionId: action.actionId,
          resourceProjectId: action.resourceProjectId,
          effectiveProjectId: action.effectiveProjectId,
          targetId: sourceManifest.targetId,
          targetRevision: sourceManifest.targetRevision,
          targetDigest: rollbackTargetDigest,
          externalRevision: sourceManifest.externalRevision,
          parameterRef: sourceManifest.parameterRef,
          parameterDigest: sourceManifest.parameterDigest,
          evidenceSetRef: sourceManifest.evidenceSetRef,
          evidenceSetDigest: sourceManifest.evidenceSetDigest,
          payloadDigest: rollbackPayloadDigest,
          manifestDigest: externalActionManifestDigest({
            manifestId: rollbackManifestId,
            manifestRevision: rollbackManifestRevision,
            actionId: action.actionId,
            targetId: sourceManifest.targetId,
            targetRevision: sourceManifest.targetRevision,
            targetDigest: rollbackTargetDigest,
            externalRevision: sourceManifest.externalRevision,
            parameterRef: sourceManifest.parameterRef,
            parameterDigest: sourceManifest.parameterDigest,
            evidenceSetRef: sourceManifest.evidenceSetRef,
            evidenceSetDigest: sourceManifest.evidenceSetDigest,
            payloadDigest: rollbackPayloadDigest,
          }),
          expiresAt: new Date(Date.parse(now) + 7 * 24 * 60 * 60 * 1000).toISOString(),
          createdAt: now,
          createdBy: scope.actor,
        };
        await repositories.manifests.insert(rollbackManifest);
        // Rollback has its OWN risk decision (rollback semantics), never a
        // reuse of the forward-operation decision; it is bound to the
        // Aggregate authority via the aggregate riskDecisionRef (AC-11).
        const rollbackRiskDecision: RiskDecisionV1 = {
          schemaVersion: '1.0.0',
          riskDecisionId: generatedIdentity('risk'),
          actionId: action.actionId,
          resourceProjectId: action.resourceProjectId,
          effectiveProjectId: action.effectiveProjectId,
          riskLevel: 'R2',
          policyVersion: 'stage11.action-risk.v1',
          requiresUserApproval: true,
          reasons: ['ROLLBACK', 'REVERSAL'],
          decidedAt: now,
        };
        await repositories.riskDecisions.insert(rollbackRiskDecision);
        const rollbackId = generatedIdentity('rollback');
        const rollback: RollbackV1 = {
          schemaVersion: '1.0.0',
          rollbackId,
          actionId: action.actionId,
          resourceProjectId: action.resourceProjectId,
          effectiveProjectId: action.effectiveProjectId,
          status: 'PREPARED',
          manifestRef: externalActionResourceRef(
            'manifest',
            rollbackManifestId,
            rollbackManifestRevision,
          ),
          executionRef: externalActionResourceRef('execution', execution.executionId),
          updatedAt: now,
        };
        await repositories.rollbacks.insert(rollback);
        const prepared: ExternalActionV1 = {
          ...action,
          actionRevision: action.actionRevision + 1,
          status: 'ROLLBACK_AVAILABLE',
          manifestRef: externalActionResourceRef(
            'manifest',
            rollbackManifestId,
            rollbackManifestRevision,
          ),
          riskDecisionRef: externalActionResourceRef(
            'riskDecision',
            rollbackRiskDecision.riskDecisionId,
            1,
          ),
          updatedAt: now,
        };
        await repositories.aggregates.update(prepared);
        return {
          schemaVersion: '1.0.0',
          outcome: 'COMPLETED',
          clientRequestId: request.clientRequestId,
          idempotencyKey: request.idempotencyKey,
          commandSemanticDigest,
          actionId: action.actionId,
          rollback,
        };
      },
      producedResources: (result) => [
        {
          resourceKind: FRONTEND_EXTERNAL_ACTION_RESOURCE_KIND.action,
          resourceId: result.actionId,
        },
        {
          resourceKind: FRONTEND_EXTERNAL_ACTION_RESOURCE_KIND.rollback,
          resourceId: result.rollback.rollbackId,
        },
      ],
    });
  }

  async prepareCompensatingAction(
    scope: FrontendExternalActionScopeV1,
    request: PrepareCompensatingActionRequestV1,
  ): Promise<PrepareCompensatingActionResultV1> {
    this.requireCapability(scope, 'PREPARE_COMPENSATING_ACTION');
    const commandSemanticDigest = frontendExternalActionCompensationDigest(request);
    return this.runCommand<PrepareCompensatingActionResultV1>({
      scope,
      commandType: FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.prepareCompensation,
      request,
      commandSemanticDigest,
      resourceProjectId: scope.activeProjectId,
      actionOnRepositories: async (repositories) => {
        const sourceAction = await repositories.aggregates.findById(request.sourceActionId);
        if (!sourceAction || sourceAction.resourceProjectId !== scope.activeProjectId) {
          externalActionFailure(
            'EXTERNAL_ACTION_NOT_FOUND',
            'The source External Action was not found.',
          );
        }
        const sourceExecution = await repositories.executions.findById(request.sourceExecutionId);
        if (!sourceExecution || sourceExecution.actionId !== sourceAction.actionId) {
          externalActionFailure('EXTERNAL_ACTION_NOT_FOUND', 'The source execution was not found.');
        }
        const now = this.nowIso();
        const compensationActionId = generatedIdentity('action');
        const sourceTarget =
          sourceAction.targetRef ??
          externalActionFailure(
            'EXTERNAL_ACTION_NOT_FOUND',
            'The source External Action is access-restricted.',
          );
        // A compensating action is a new governed External Action with its own
        // candidate and risk decision (never a reuse of the source decision).
        const candidateId = generatedIdentity('candidate');
        const riskDecisionId = generatedIdentity('risk');
        const riskDecision: RiskDecisionV1 = {
          schemaVersion: '1.0.0',
          riskDecisionId,
          actionId: compensationActionId,
          resourceProjectId: scope.activeProjectId,
          effectiveProjectId: scope.activeProjectId,
          riskLevel: 'R1',
          policyVersion: 'stage11.action-risk.v1',
          requiresUserApproval: false,
          reasons: ['COMPENSATION'],
          decidedAt: now,
        };
        const candidate: ActionCandidateV1 = {
          schemaVersion: '1.0.0',
          candidateId,
          candidateRevision: 1,
          actionId: compensationActionId,
          resourceProjectId: scope.activeProjectId,
          effectiveProjectId: scope.activeProjectId,
          sourceRefs: [],
          operation: 'UPDATE_REVERSIBLE',
          targetRef: sourceTarget,
          parameterRef: {
            schemaVersion: '1.0.0',
            parameterId: `${compensationActionId}:param`,
            parameterRevision: '1',
            parameterDigest: sha256Text(stableJson({ actionId: compensationActionId })),
          },
          evidenceRefs: [],
          compensationForActionId: sourceAction.actionId,
          candidateDigest: commandSemanticDigest,
          riskDecisionRef: externalActionResourceRef('riskDecision', riskDecisionId, 1),
          generatedAt: now,
          generatedBy: scope.actor,
        };
        await repositories.riskDecisions.insert(riskDecision);
        await repositories.candidates.insert(candidate);
        const compensation: CompensatingActionV1 = {
          schemaVersion: '1.0.0',
          compensationId: generatedIdentity('compensation'),
          actionId: compensationActionId,
          resourceProjectId: scope.activeProjectId,
          effectiveProjectId: scope.activeProjectId,
          sourceActionId: sourceAction.actionId,
          sourceExecutionId: sourceExecution.executionId,
          candidateRef: externalActionResourceRef('candidate', candidateId, 1),
          status: 'CANDIDATE_VALIDATED',
          preparedAt: now,
          preparedBy: scope.actor,
        };
        await repositories.compensations.insert(compensation);
        const compensationAggregate: ExternalActionV1 = {
          schemaVersion: '1.0.0',
          actionId: compensationActionId,
          actionRevision: 1,
          operation: 'UPDATE_REVERSIBLE',
          resourceProjectId: scope.activeProjectId,
          effectiveProjectId: scope.activeProjectId,
          accessRevision: scope.accessRevision,
          policyContextRevision: scope.policyContextRevision,
          status: 'CANDIDATE_VALIDATED',
          aggregateState: 'AVAILABLE',
          accessMasking: 'VISIBLE',
          maskedFields: [],
          capabilities: externalActionCapabilitiesForScope(scope),
          updatedAt: now,
          createdAt: now,
          targetRef: sourceTarget,
          riskDecisionRef: externalActionResourceRef('riskDecision', riskDecisionId, 1),
          manifestRef: undefined,
          approvalRef: undefined,
          latestExecutionRef: undefined,
          compensationForActionId: sourceAction.actionId,
        };
        await repositories.aggregates.insert(compensationAggregate);
        return {
          schemaVersion: '1.0.0',
          outcome: 'COMPLETED',
          clientRequestId: request.clientRequestId,
          idempotencyKey: request.idempotencyKey,
          commandSemanticDigest,
          compensation,
        };
      },
      producedResources: (result) => [
        {
          resourceKind: FRONTEND_EXTERNAL_ACTION_RESOURCE_KIND.action,
          resourceId: result.compensation.actionId,
        },
        {
          resourceKind: FRONTEND_EXTERNAL_ACTION_RESOURCE_KIND.compensation,
          resourceId: result.compensation.compensationId,
        },
      ],
    });
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async listExternalActions(
    scope: FrontendExternalActionScopeV1,
    request: ListExternalActionsRequestV1,
  ): Promise<ListExternalActionsResultV1> {
    this.requireCapability(scope, 'LIST_EXTERNAL_ACTIONS');
    return this.boundary.transaction(async (repositories) => {
      const offset = this.queueOffset(request.cursor);
      const actions = await repositories.aggregates.listByProject(
        scope.activeProjectId,
        Math.min(request.pageSize, EXTERNAL_ACTION_QUEUE_PAGE_SIZE_CAP),
        offset,
      );
      const items: ExternalActionQueueItemV1[] = [];
      for (const action of actions) {
        const riskLevel = await this.riskLevelFor(repositories, action.actionId);
        items.push(this.queueItemFor(action, riskLevel));
      }
      const nextOffset = offset + items.length;
      return {
        schemaVersion: '1.0.0',
        items,
        nextCursor:
          nextOffset < offset + items.length || items.length === request.pageSize
            ? this.queueCursor(nextOffset)
            : undefined,
        capabilities: externalActionCapabilitiesForScope(scope),
      };
    });
  }

  async getExternalAction(
    scope: FrontendExternalActionScopeV1,
    request: GetExternalActionRequestV1,
  ): Promise<GetExternalActionResultV1> {
    this.requireCapability(scope, 'READ_EXTERNAL_ACTION');
    return this.boundary.transaction(async (repositories) => {
      const action = await repositories.aggregates.findById(request.actionId);
      if (!action || action.resourceProjectId !== scope.activeProjectId) {
        externalActionFailure('EXTERNAL_ACTION_NOT_FOUND', 'The External Action was not found.');
      }
      return { schemaVersion: '1.0.0', action: this.maybeRestricted(action, scope) };
    });
  }

  async getExternalActionDetail(
    scope: FrontendExternalActionScopeV1,
    request: GetExternalActionDetailRequestV1,
  ): Promise<GetExternalActionDetailResultV1> {
    this.requireCapability(scope, 'READ_EXTERNAL_ACTION');
    return this.boundary.transaction(async (repositories) => {
      const action = await repositories.aggregates.findById(request.actionId);
      if (!action || action.resourceProjectId !== scope.activeProjectId) {
        externalActionFailure('EXTERNAL_ACTION_NOT_FOUND', 'The External Action was not found.');
      }
      const restricted = this.maybeRestricted(action, scope);
      // Fail-closed restricted shell (AC-17): when access/policy changed, no
      // protected identity, count, edge, description, credential or budget is
      // exposed — only the restricted aggregate is returned.
      if (restricted.aggregateState === 'ACCESS_RESTRICTED') {
        return { schemaVersion: '1.0.0', action: restricted, attempts: [] };
      }
      const attempts = await repositories.attempts.findByExecution(
        action.latestExecutionRef?.resourceId ?? '',
      );
      return {
        schemaVersion: '1.0.0',
        action: restricted,
        manifest: action.manifestRef
          ? await repositories.manifests.findById(action.manifestRef.resourceId)
          : undefined,
        riskDecision: action.riskDecisionRef
          ? await repositories.riskDecisions.find(
              action.actionId,
              action.riskDecisionRef.resourceId,
            )
          : undefined,
        approval: action.approvalRef
          ? await repositories.approvals.findById(action.approvalRef.resourceId)
          : undefined,
        preflight: await repositories.preflights.findCurrent(action.actionId),
        execution: action.latestExecutionRef
          ? await repositories.executions.findById(action.latestExecutionRef.resourceId)
          : undefined,
        attempts,
        verification: await repositories.verifications.findCurrent(action.actionId),
        result: await repositories.results.findCurrent(action.actionId),
        rollback: await repositories.rollbacks.find(action.actionId),
        compensation: await repositories.compensations.find(action.actionId),
        credential: await repositories.credentials.findByConnector(
          this.engine.identity.connectorId,
        ),
        budget: await repositories.budgets.findByProject(scope.activeProjectId),
      };
    });
  }

  async getActionManifest(
    scope: FrontendExternalActionScopeV1,
    request: GetActionManifestRequestV1,
  ): Promise<GetActionManifestResultV1> {
    this.requireCapability(scope, 'READ_MANIFEST');
    return this.boundary.transaction(async (repositories) => {
      const action = await repositories.aggregates.findById(request.actionId);
      if (!action || action.resourceProjectId !== scope.activeProjectId) {
        externalActionFailure('EXTERNAL_ACTION_NOT_FOUND', 'The External Action was not found.');
      }
      this.assertProjectAndPolicy(action, scope);
      if (action.accessMasking === 'HIDDEN' || action.aggregateState === 'ACCESS_RESTRICTED') {
        externalActionFailure('EXTERNAL_ACTION_STALE', 'The External Action is access-restricted.');
      }
      const manifest = action.manifestRef
        ? await repositories.manifests.findById(action.manifestRef.resourceId)
        : undefined;
      if (!manifest) {
        externalActionFailure(
          'ACTION_MANIFEST_NOT_READY',
          'No manifest exists for this External Action.',
        );
      }
      return { schemaVersion: '1.0.0', manifest };
    });
  }

  async getRiskDecision(
    scope: FrontendExternalActionScopeV1,
    request: GetRiskDecisionRequestV1,
  ): Promise<GetRiskDecisionResultV1> {
    this.requireCapability(scope, 'READ_RISK_DECISION');
    return this.boundary.transaction(async (repositories) => {
      const action = await repositories.aggregates.findById(request.actionId);
      if (!action || action.resourceProjectId !== scope.activeProjectId) {
        externalActionFailure('EXTERNAL_ACTION_NOT_FOUND', 'The External Action was not found.');
      }
      this.assertProjectAndPolicy(action, scope);
      const riskDecision = action.riskDecisionRef
        ? await repositories.riskDecisions.find(action.actionId, action.riskDecisionRef.resourceId)
        : undefined;
      if (!riskDecision) {
        externalActionFailure(
          'EXTERNAL_ACTION_NOT_FOUND',
          'No risk decision exists for this External Action.',
        );
      }
      return { schemaVersion: '1.0.0', riskDecision };
    });
  }

  async getPreflight(
    scope: FrontendExternalActionScopeV1,
    request: GetPreflightRequestV1,
  ): Promise<GetPreflightResultV1> {
    this.requireCapability(scope, 'READ_PREFLIGHT');
    return this.boundary.transaction(async (repositories) => {
      const action = await repositories.aggregates.findById(request.actionId);
      if (!action || action.resourceProjectId !== scope.activeProjectId) {
        externalActionFailure('EXTERNAL_ACTION_NOT_FOUND', 'The External Action was not found.');
      }
      this.assertProjectAndPolicy(action, scope);
      const preflight = await repositories.preflights.findCurrent(action.actionId);
      if (!preflight) {
        externalActionFailure(
          'EXTERNAL_ACTION_NOT_FOUND',
          'No preflight exists for this External Action.',
        );
      }
      return { schemaVersion: '1.0.0', preflight };
    });
  }

  async getExecution(
    scope: FrontendExternalActionScopeV1,
    request: GetExecutionRequestV1,
  ): Promise<GetExecutionResultV1> {
    this.requireCapability(scope, 'READ_EXECUTION');
    return this.boundary.transaction(async (repositories) => {
      const action = await repositories.aggregates.findById(request.actionId);
      if (!action || action.resourceProjectId !== scope.activeProjectId) {
        externalActionFailure('EXTERNAL_ACTION_NOT_FOUND', 'The External Action was not found.');
      }
      this.assertProjectAndPolicy(action, scope);
      const execution = action.latestExecutionRef
        ? await repositories.executions.findById(action.latestExecutionRef.resourceId)
        : undefined;
      if (!execution) {
        externalActionFailure(
          'EXTERNAL_ACTION_NOT_FOUND',
          'No execution exists for this External Action.',
        );
      }
      return { schemaVersion: '1.0.0', execution };
    });
  }

  async getExecutionAttempts(
    scope: FrontendExternalActionScopeV1,
    request: GetExecutionAttemptsRequestV1,
  ): Promise<GetExecutionAttemptsResultV1> {
    this.requireCapability(scope, 'READ_EXECUTION_ATTEMPTS');
    return this.boundary.transaction(async (repositories) => {
      const action = await repositories.aggregates.findById(request.actionId);
      if (!action || action.resourceProjectId !== scope.activeProjectId) {
        externalActionFailure('EXTERNAL_ACTION_NOT_FOUND', 'The External Action was not found.');
      }
      this.assertProjectAndPolicy(action, scope);
      const executionId = action.latestExecutionRef?.resourceId ?? '';
      const attempts = (await repositories.attempts.findByExecution(executionId)).slice(
        0,
        EXTERNAL_ACTION_ATTEMPT_LIST_CAP,
      );
      return { schemaVersion: '1.0.0', attempts };
    });
  }

  async getVerification(
    scope: FrontendExternalActionScopeV1,
    request: GetVerificationRequestV1,
  ): Promise<GetVerificationResultV1> {
    this.requireCapability(scope, 'READ_VERIFICATION');
    return this.boundary.transaction(async (repositories) => {
      const action = await repositories.aggregates.findById(request.actionId);
      if (!action || action.resourceProjectId !== scope.activeProjectId) {
        externalActionFailure('EXTERNAL_ACTION_NOT_FOUND', 'The External Action was not found.');
      }
      this.assertProjectAndPolicy(action, scope);
      const verification = await repositories.verifications.findCurrent(action.actionId);
      if (!verification) {
        externalActionFailure(
          'EXTERNAL_ACTION_NOT_FOUND',
          'No verification exists for this External Action.',
        );
      }
      return { schemaVersion: '1.0.0', verification };
    });
  }

  async getActionResult(
    scope: FrontendExternalActionScopeV1,
    request: GetActionResultRequestV1,
  ): Promise<GetActionResultResultV1> {
    this.requireCapability(scope, 'READ_RESULT');
    return this.boundary.transaction(async (repositories) => {
      const action = await repositories.aggregates.findById(request.actionId);
      if (!action || action.resourceProjectId !== scope.activeProjectId) {
        externalActionFailure('EXTERNAL_ACTION_NOT_FOUND', 'The External Action was not found.');
      }
      this.assertProjectAndPolicy(action, scope);
      const result = await repositories.results.findCurrent(action.actionId);
      if (!result) {
        externalActionFailure(
          'EXTERNAL_ACTION_NOT_FOUND',
          'No result exists for this External Action.',
        );
      }
      return { schemaVersion: '1.0.0', result };
    });
  }

  async listExternalActionAudit(
    scope: FrontendExternalActionScopeV1,
    request: ListExternalActionAuditRequestV1,
  ): Promise<ListExternalActionAuditResultV1> {
    this.requireCapability(scope, 'READ_AUDIT');
    return this.boundary.transaction(async (repositories) => {
      const action = await repositories.aggregates.findById(request.actionId);
      if (!action || action.resourceProjectId !== scope.activeProjectId) {
        externalActionFailure('EXTERNAL_ACTION_NOT_FOUND', 'The External Action was not found.');
      }
      this.assertProjectAndPolicy(action, scope);
      const offset = this.queueOffset(request.cursor);
      const events = await repositories.audit.listByAction(
        action.actionId,
        Math.min(request.pageSize, EXTERNAL_ACTION_QUEUE_PAGE_SIZE_CAP),
        offset,
      );
      const nextOffset = offset + events.length;
      return {
        schemaVersion: '1.0.0',
        events,
        nextCursor: events.length === request.pageSize ? this.queueCursor(nextOffset) : undefined,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Outcome resolution
  // -------------------------------------------------------------------------

  async resolveExternalActionOutcome(
    scope: FrontendExternalActionScopeV1,
    request: ResolveExternalActionOutcomeRequestV1,
  ): Promise<ResolveExternalActionOutcomeResultV1> {
    this.requireCapability(scope, 'RESOLVE_OUTCOME');
    const outcome = await this.commandGateway.findByClientRequestId(
      scope.principalId,
      request.clientRequestId,
    );
    if (!outcome || outcome.idempotencyKey !== request.idempotencyKey) {
      externalActionFailure(
        'ACTION_OUTCOME_NOT_FOUND',
        'No External Action command outcome matches the requested identity.',
      );
    }
    if (outcome.commandSemanticDigest !== request.semanticDigest) {
      externalActionFailure(
        'ACTION_COMMAND_SCOPE_MISMATCH',
        'The command semantic digest does not match the stored outcome.',
      );
    }
    return this.boundary.transaction(async (repositories) => {
      if (outcome.outcomeState === 'COMPLETED') {
        const completed = await this.buildResolvedResult(outcome, repositories);
        return {
          schemaVersion: '1.0.0',
          outcome: 'COMPLETED',
          originalClientRequestId: request.clientRequestId,
          originalIdempotencyKey: request.idempotencyKey,
          completed,
        };
      }
      if (outcome.outcomeState === 'REJECTED') {
        return {
          schemaVersion: '1.0.0',
          outcome: 'REJECTED',
          originalClientRequestId: request.clientRequestId,
          originalIdempotencyKey: request.idempotencyKey,
          rejection: outcome.rejection
            ? { code: outcome.rejection.code, message: outcome.rejection.message }
            : { code: 'ACTION_OUTCOME_UNKNOWN', message: 'The command was rejected.' },
        };
      }
      return {
        schemaVersion: '1.0.0',
        outcome: 'OUTCOME_UNKNOWN',
        originalClientRequestId: request.clientRequestId,
        originalIdempotencyKey: request.idempotencyKey,
      };
    });
  }

  /**
   * Rebuilds the strict command result of a COMPLETED External Action command
   * from its produced resources (the Command Ledger stores resource refs, not
   * the full payload). Each commandType maps to its own strict result shape.
   */
  private async buildResolvedResult(
    outcome: AnyFrontendCommandOutcomeView,
    repositories: ExternalActionTransactionRepositoriesV1,
  ): Promise<ResolvedCommandResultV1> {
    const commandType = outcome.commandType as FrontendExternalActionCommandType;
    const resource = (
      kind: (typeof FRONTEND_EXTERNAL_ACTION_RESOURCE_KIND)[keyof typeof FRONTEND_EXTERNAL_ACTION_RESOURCE_KIND],
    ) => outcome.producedResources.find((ref) => ref.resourceKind === kind);
    const actionRef = resource(FRONTEND_EXTERNAL_ACTION_RESOURCE_KIND.action);
    const actionId = actionRef?.resourceId ?? '';
    const base = {
      schemaVersion: '1.0.0' as const,
      outcome: 'COMPLETED' as const,
      clientRequestId: outcome.clientRequestId,
      idempotencyKey: outcome.idempotencyKey,
      commandSemanticDigest: outcome.commandSemanticDigest,
    };
    switch (commandType) {
      case FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.validateCandidate: {
        const riskRef = resource(FRONTEND_EXTERNAL_ACTION_RESOURCE_KIND.riskDecision);
        const candidateRef = resource(FRONTEND_EXTERNAL_ACTION_RESOURCE_KIND.candidate);
        const riskDecision = riskRef
          ? await repositories.riskDecisions.find(actionId, riskRef.resourceId)
          : undefined;
        const candidate = candidateRef
          ? await repositories.candidates.find(actionId, candidateRef.resourceId)
          : undefined;
        if (!riskDecision || !candidate) {
          externalActionFailure(
            'ACTION_OUTCOME_NOT_FOUND',
            'The completed candidate outcome is unavailable.',
          );
        }
        return { commandType, result: { ...base, actionId, riskDecision, candidate } };
      }
      case FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.prepareManifest: {
        const manifestRef = resource(FRONTEND_EXTERNAL_ACTION_RESOURCE_KIND.manifest);
        const manifest = manifestRef
          ? await repositories.manifests.findById(manifestRef.resourceId)
          : undefined;
        if (!manifest) {
          externalActionFailure(
            'ACTION_OUTCOME_NOT_FOUND',
            'The completed manifest outcome is unavailable.',
          );
        }
        return { commandType, result: { ...base, actionId, manifest } };
      }
      case FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.approve: {
        const approvalRef = resource(FRONTEND_EXTERNAL_ACTION_RESOURCE_KIND.approval);
        const approval = approvalRef
          ? await repositories.approvals.findById(approvalRef.resourceId)
          : undefined;
        if (!approval) {
          externalActionFailure(
            'ACTION_OUTCOME_NOT_FOUND',
            'The completed approval outcome is unavailable.',
          );
        }
        return { commandType, result: { ...base, actionId, approval } };
      }
      case FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.preflight: {
        const preflightRef = resource(FRONTEND_EXTERNAL_ACTION_RESOURCE_KIND.preflight);
        const preflight = preflightRef
          ? await repositories.preflights.findById(preflightRef.resourceId)
          : undefined;
        if (!preflight) {
          externalActionFailure(
            'ACTION_OUTCOME_NOT_FOUND',
            'The completed preflight outcome is unavailable.',
          );
        }
        return { commandType, result: { ...base, actionId, preflight } };
      }
      case FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.execute: {
        const executionRef = resource(FRONTEND_EXTERNAL_ACTION_RESOURCE_KIND.execution);
        const attemptRef = resource(FRONTEND_EXTERNAL_ACTION_RESOURCE_KIND.attempt);
        const execution = executionRef
          ? await repositories.executions.findById(executionRef.resourceId)
          : undefined;
        const attempt = attemptRef
          ? await repositories.attempts.findById(attemptRef.resourceId)
          : undefined;
        if (!execution || !attempt) {
          externalActionFailure(
            'ACTION_OUTCOME_NOT_FOUND',
            'The completed execution outcome is unavailable.',
          );
        }
        // An in-flight (non-terminal) execution is never replayed as COMPLETED:
        // the ledger only reaches COMPLETED with a terminal domain state, but
        // this guard keeps the reconstruction honest (Review 4859910949).
        if (execution.status === 'IN_PROGRESS' || attempt.status === 'IN_PROGRESS') {
          externalActionFailure(
            'OUTCOME_INDETERMINATE',
            'The execution is still in progress; resolve it through the original command identity.',
          );
        }
        return {
          commandType,
          result: {
            ...base,
            actionId,
            execution,
            attempt,
            outcome: execution.status === 'OUTCOME_UNKNOWN' ? 'OUTCOME_UNKNOWN' : 'COMPLETED',
          },
        };
      }
      case FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.retryAttempt: {
        const attemptRef = resource(FRONTEND_EXTERNAL_ACTION_RESOURCE_KIND.attempt);
        const attempt = attemptRef
          ? await repositories.attempts.findById(attemptRef.resourceId)
          : undefined;
        if (!attempt) {
          externalActionFailure(
            'ACTION_OUTCOME_NOT_FOUND',
            'The completed retry outcome is unavailable.',
          );
        }
        // An in-flight retry attempt is never replayed as COMPLETED.
        if (attempt.status === 'IN_PROGRESS') {
          externalActionFailure(
            'OUTCOME_INDETERMINATE',
            'The retry attempt is still in progress; resolve it through the original command identity.',
          );
        }
        return {
          commandType,
          result: {
            ...base,
            actionId,
            attempt,
            outcome: attempt.status === 'OUTCOME_UNKNOWN' ? 'OUTCOME_UNKNOWN' : 'COMPLETED',
          },
        };
      }
      case FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.verify: {
        const verificationRef = resource(FRONTEND_EXTERNAL_ACTION_RESOURCE_KIND.verification);
        const verification = verificationRef
          ? await repositories.verifications.findById(verificationRef.resourceId)
          : undefined;
        if (!verification) {
          externalActionFailure(
            'ACTION_OUTCOME_NOT_FOUND',
            'The completed verification outcome is unavailable.',
          );
        }
        return { commandType, result: { ...base, actionId, verification } };
      }
      case FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.cancel: {
        const action = actionId ? await repositories.aggregates.findById(actionId) : undefined;
        return {
          commandType,
          result: {
            ...base,
            actionId,
            status: action?.status === 'CANCELLED' ? 'CANCELLED' : 'CANCELLING',
          },
        };
      }
      case FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.rollback: {
        const rollbackRef = resource(FRONTEND_EXTERNAL_ACTION_RESOURCE_KIND.rollback);
        const rollback = rollbackRef ? await repositories.rollbacks.find(actionId) : undefined;
        if (!rollback) {
          externalActionFailure(
            'ACTION_OUTCOME_NOT_FOUND',
            'The completed rollback outcome is unavailable.',
          );
        }
        return { commandType, result: { ...base, actionId, rollback } };
      }
      case FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.prepareCompensation: {
        const compensationRef = resource(FRONTEND_EXTERNAL_ACTION_RESOURCE_KIND.compensation);
        const compensation = compensationRef
          ? await repositories.compensations.find(actionId)
          : undefined;
        if (!compensation) {
          externalActionFailure(
            'ACTION_OUTCOME_NOT_FOUND',
            'The completed compensation outcome is unavailable.',
          );
        }
        return { commandType, result: { ...base, compensation } };
      }
      case FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.resolveOutcome:
        externalActionFailure(
          'ACTION_COMMAND_SCOPE_MISMATCH',
          'resolve-outcome is not a resolvable completed result.',
        );
    }
  }

  /**
   * Idempotent replay of an already-COMPLETED command: rebuilds the command
   * result from the ledger-produced resources so the same request returns the
   * same outcome instead of OUTCOME_INDETERMINATE.
   */
  private async reconstructReplay<T>(outcome: AnyFrontendCommandOutcomeView): Promise<T> {
    return this.boundary.transaction(async (repositories) => {
      const resolved = await this.buildResolvedResult(outcome, repositories);
      return resolved.result as unknown as T;
    });
  }

  // -------------------------------------------------------------------------
  // Command ledger plumbing (mirrors FE-P4-S1)
  // -------------------------------------------------------------------------

  /**
   * Two-phase governed command for connector-touching operations (execute,
   * retry, rollback): the PENDING/IN_PROGRESS attempt and execution are
   * persisted and the ledger command is COMPLETED inside transaction 1; the
   * connector call runs OUTSIDE the DB transaction; the terminal state is
   * committed in transaction 2. A connector crash/timeout therefore leaves the
   * attempt persisted and recoverable through the original command identity —
   * the ledger is never the only surviving record (ADR-129).
   */
  private async runConnectorCommand<T>(input: {
    readonly scope: FrontendExternalActionScopeV1;
    readonly commandType: FrontendExternalActionCommandType;
    readonly request: { readonly clientRequestId: string; readonly idempotencyKey: string };
    readonly commandSemanticDigest: string;
    readonly resourceProjectId: string;
    readonly persistStarted: (repositories: ExternalActionTransactionRepositoriesV1) => Promise<{
      readonly producedResources: readonly ProducedResourceRef[];
      readonly engineInput: ExternalActionExecuteRequestV1;
      readonly preflightInput?: ExternalActionPreflightRequestV1;
      readonly startedRefs: {
        readonly executionId: string;
        readonly attemptId: string;
        readonly expectedActionRevision: number;
      };
    }>;
    readonly executeEngine: (context: {
      readonly engineInput: ExternalActionExecuteRequestV1;
      readonly preflightInput?: ExternalActionPreflightRequestV1;
    }) => Promise<{
      readonly preflight?: ExternalActionPreflightOutcomeV1;
      readonly execute?: ExternalActionExecuteOutcomeV1;
    }>;
    readonly finalize: (
      repositories: ExternalActionTransactionRepositoriesV1,
      outcome: {
        readonly preflight?: ExternalActionPreflightOutcomeV1;
        readonly execute: ExternalActionExecuteOutcomeV1;
      },
      startedRefs: {
        readonly executionId: string;
        readonly attemptId: string;
        readonly expectedActionRevision: number;
      },
    ) => Promise<T>;
    readonly finalizeDenied?: (
      repositories: ExternalActionTransactionRepositoriesV1,
      preflight: ExternalActionPreflightOutcomeV1,
      startedRefs: {
        readonly executionId: string;
        readonly attemptId: string;
        readonly expectedActionRevision: number;
      },
    ) => Promise<void>;
  }): Promise<T> {
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
          commandSchemaVersion: FRONTEND_EXTERNAL_ACTION_API_VERSION,
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
          preconditions: [],
          clientIssuedAt: now,
          payload: input.request,
        },
        commandSemanticDigest: input.commandSemanticDigest,
        acceptedPolicyContext: {
          policyContextId: 'frontend-external-action-current-policy',
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
        externalActionFailure(
          'DIGEST_MISMATCH',
          'The request identity is already bound to different command meaning.',
        );
      }
      throw error;
    }
    const outcome = accepted.outcome;
    const onReplay = async (): Promise<T> =>
      this.boundary.transaction(async (repositories) => {
        const resolved = await this.buildResolvedResult(outcome, repositories);
        return resolved.result as unknown as T;
      });
    if (accepted.replayed) {
      if (outcome.outcomeState === 'COMPLETED') return onReplay();
      if (outcome.outcomeState === 'REJECTED') {
        throw new ExternalActionCommandError(
          (outcome.rejection?.code as ErrorCode) ?? 'ACTION_EXECUTION_NOT_ALLOWED',
          'The External Action command was rejected.',
        );
      }
      externalActionFailure(
        'OUTCOME_INDETERMINATE',
        'The previous command outcome is unresolved; resolve it through the original command identity before retrying.',
      );
    }

    // Phase 1: persist the started attempt/execution (recoverable). The ledger
    // command stays ACCEPTED here — it is completed ONLY after the terminal
    // domain state is committed (Phase 3), so an in-flight command can never
    // be misjudged as COMPLETED (ADR-129; Review 4859910949).
    const started = await this.boundary.transactionWithHandle(async (handle) => {
      const locked = await this.commandGateway.lockAcceptedForExecution(
        handle.raw,
        outcome.commandId,
      );
      if (locked.outcomeState === 'COMPLETED') {
        return { __replayed: true as const };
      }
      const persisted = await input.persistStarted(handle.repositories);
      return { __replayed: false as const, ...persisted };
    });
    if (started.__replayed) return onReplay();

    // Phase 2: connector work (optional preflight + execute) OUTSIDE the DB
    // transaction. A connector throw is mapped to OUTCOME_UNKNOWN; the started
    // attempt/execution survive as durable recoverable resources.
    let outcome2: {
      preflight?: ExternalActionPreflightOutcomeV1;
      execute?: ExternalActionExecuteOutcomeV1;
    };
    try {
      outcome2 = await input.executeEngine({
        engineInput: started.engineInput,
        preflightInput: started.preflightInput,
      });
    } catch {
      outcome2 = {
        execute: {
          status: 'OUTCOME_UNKNOWN',
          correlationId: started.engineInput.attempt.correlationId,
        },
      };
    }

    // A preflight that is not READY (DENIED / ALREADY_APPLIED / flags missing)
    // blocks the connector execution: the started resources are marked FAILED
    // and the ledger command is REJECTED — the domain resource is never lost.
    if (started.preflightInput && outcome2.preflight && outcome2.preflight.status !== 'READY') {
      if (input.finalizeDenied) {
        await this.boundary.transaction((repositories) =>
          input.finalizeDenied!(repositories, outcome2.preflight!, started.startedRefs),
        );
      }
      const reason = outcome2.preflight.reason ?? 'preflight revalidation failed';
      await this.commandGateway.reject({
        commandId: outcome.commandId,
        code: 'ACTION_PREFLIGHT_FAILED',
        message: reason,
        completedAt: this.nowIso(),
      });
      externalActionFailure('ACTION_PREFLIGHT_FAILED', reason);
    }

    // Phase 3: commit the terminal state AND complete the ledger command in one
    // transaction (atomic: the ledger never reports COMPLETED before the
    // terminal domain state is durable).
    const executeOutcome = outcome2.execute ?? {
      status: 'OUTCOME_UNKNOWN' as const,
      correlationId: started.engineInput.attempt.correlationId,
    };
    const finalOutcome: {
      readonly preflight?: ExternalActionPreflightOutcomeV1;
      readonly execute: ExternalActionExecuteOutcomeV1;
    } = { preflight: outcome2.preflight, execute: executeOutcome };
    try {
      return await this.boundary.transactionWithHandle(async (handle) => {
        const result = await input.finalize(handle.repositories, finalOutcome, started.startedRefs);
        await this.commandGateway.completeInTransaction(handle.raw, {
          commandId: outcome.commandId,
          producedResources: started.producedResources,
          completedAt: this.nowIso(),
        });
        return result;
      });
    } catch (error) {
      try {
        if (error instanceof ExternalActionCommandError) {
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
              error instanceof Error
                ? error.message
                : 'External Action command outcome is unresolved.',
            completedAt: this.nowIso(),
          });
        }
      } catch {
        // Preserve the original error when the ledger write is unavailable.
      }
      throw error;
    }
  }

  private async runCommand<T>(input: FrontendExternalActionRunCommandInput<T>): Promise<T> {
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
          commandSchemaVersion: FRONTEND_EXTERNAL_ACTION_API_VERSION,
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
          policyContextId: 'frontend-external-action-current-policy',
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
        externalActionFailure(
          'DIGEST_MISMATCH',
          'The request identity is already bound to different command meaning.',
        );
      }
      throw error;
    }

    const outcome = accepted.outcome;
    const onReplay = input.onReplay ?? (async () => this.reconstructReplay<T>(outcome));
    if (accepted.replayed) {
      if (outcome.outcomeState === 'COMPLETED') {
        return onReplay();
      }
      if (outcome.outcomeState === 'REJECTED') {
        throw new ExternalActionCommandError(
          (outcome.rejection?.code as ErrorCode) ?? 'ACTION_EXECUTION_NOT_ALLOWED',
          'The External Action command was rejected.',
        );
      }
      externalActionFailure(
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
          return onReplay();
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
        if (error instanceof ExternalActionCommandError) {
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
              error instanceof Error
                ? error.message
                : 'External Action command outcome is unresolved.',
            completedAt: this.nowIso(),
          });
        }
      } catch {
        // Preserve the original error when the ledger write is unavailable.
      }
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private engineScope(scope: FrontendExternalActionScopeV1) {
    return {
      principalId: scope.principalId,
      actor: scope.actor,
      activeProjectId: scope.activeProjectId,
      accessRevision: scope.accessRevision,
      policyContextRevision: scope.policyContextRevision,
    };
  }

  private riskLevelForOperation(
    operation: ValidateActionCandidateRequestV1['operation'],
  ): RiskDecisionV1['riskLevel'] {
    switch (operation) {
      case 'FINANCIAL_OR_LEGAL':
        return 'R3';
      case 'PUBLISH_OR_DELETE':
        return 'R2';
      case 'UPDATE_REVERSIBLE':
        return 'R1';
      case 'CREATE_DRAFT':
        return 'R1';
      case 'PREVIEW_ONLY':
        return 'R0';
    }
  }

  private operationRequiresApproval(
    operation: ValidateActionCandidateRequestV1['operation'],
  ): boolean {
    return operation === 'FINANCIAL_OR_LEGAL' || operation === 'PUBLISH_OR_DELETE';
  }

  private async credentialAvailable(
    repositories: ExternalActionTransactionRepositoriesV1,
    connectorId: string,
  ): Promise<boolean> {
    // Server-owned credential boundary: availability is derived from the
    // credential store, never from the browser.
    const credential = await repositories.credentials.findByConnector(connectorId);
    return credential !== undefined && credential.status === 'CONFIGURED';
  }

  private async budgetAvailable(
    repositories: ExternalActionTransactionRepositoriesV1,
    projectId: string,
  ): Promise<boolean> {
    // Project execution-budget boundary: exhaustion fails closed; the budget
    // store is authoritative and the coordinator never infers budget.
    const budget = await repositories.budgets.findByProject(projectId);
    if (!budget) return false;
    return !budget.exhausted && budget.remainingExecutions > 0;
  }

  private async reserveBudget(
    repositories: ExternalActionTransactionRepositoriesV1,
    projectId: string,
  ): Promise<void> {
    // Atomic reservation BEFORE the connector call (never a plain availability
    // check): the store decrements in one serialized step so two concurrent
    // executions cannot both pass with a single remaining execution. The
    // reservation is never released after the attempt ran. A successful
    // reservation that consumes the LAST remaining execution still succeeds —
    // only an unreservable (absent or already-exhausted) budget fails closed
    // (Review 4860735262).
    const reserved = await repositories.budgets.reserve(projectId);
    if (reserved === undefined) {
      externalActionFailure(
        'ACTION_BUDGET_EXCEEDED',
        'The project execution budget is exhausted or unreadable.',
      );
    }
  }

  private async currentManifestRevision(
    repositories: ExternalActionTransactionRepositoriesV1,
    actionId: string,
  ): Promise<number> {
    const current = await repositories.manifests.findCurrent(actionId);
    return current?.manifestRevision ?? 0;
  }

  private async findCandidateForAction(
    repositories: ExternalActionTransactionRepositoriesV1,
    actionId: string,
  ): Promise<ActionCandidateV1 | undefined> {
    return repositories.candidates.findByActionId(actionId);
  }

  private maybeRestricted(
    action: ExternalActionV1,
    scope: FrontendExternalActionScopeV1,
  ): ExternalActionV1 {
    const scopeChanged =
      action.accessRevision !== scope.accessRevision ||
      action.policyContextRevision !== scope.policyContextRevision;
    if (scopeChanged) {
      return {
        schemaVersion: '1.0.0',
        actionId: action.actionId,
        actionRevision: action.actionRevision,
        operation: action.operation,
        resourceProjectId: action.resourceProjectId,
        effectiveProjectId: action.effectiveProjectId,
        accessRevision: action.accessRevision,
        policyContextRevision: action.policyContextRevision,
        status: action.status,
        aggregateState: 'ACCESS_RESTRICTED',
        staleReason: 'the access or policy scope changed since this action was created',
        accessMasking: 'HIDDEN',
        maskedFields: [],
        capabilities: [],
        updatedAt: action.updatedAt,
        createdAt: action.createdAt,
      };
    }
    return action;
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
      // opaque cursor not recognized → first page
    }
    return 0;
  }
}
