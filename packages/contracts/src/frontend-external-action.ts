import { FrontendContractError } from './frontend-foundation.js';
import { sha256Text, stableJson } from './document-evidence.js';

/**
 * FE-P4-S2 External Action Governance and Execution — exact V1 contracts.
 *
 * Frozen by FE-P4-S2 Contract Snapshot revision 1 (approved 2026-08-05) and
 * ADR-129 (accepted 2026-08-05). Every type carries schemaVersion '1.0.0',
 * decoders reject unknown fields, empty/whitespace-only IDs, unknown
 * discriminants, and never use `any`.
 *
 * External Actions are server-authoritative. The Browser never submits Actor,
 * Project, Capability, Policy, Credential, Budget or risk authority. Governed
 * commands flow through the existing Frontend Command Ledger (ADR-101).
 * Connector or HTTP success alone never confirms verified success; a
 * Verification resource against the external Target State is required.
 */

export type ExternalActionSchemaVersion = '1.0.0';

export const FRONTEND_EXTERNAL_ACTION_API_VERSION = '1.0.0' as const;

export const FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES = {
  validateCandidate: 'frontend.external-action.validate-candidate.v1',
  prepareManifest: 'frontend.external-action.prepare-manifest.v1',
  approve: 'frontend.external-action.approve.v1',
  preflight: 'frontend.external-action.preflight.v1',
  execute: 'frontend.external-action.execute.v1',
  retryAttempt: 'frontend.external-action.retry-attempt.v1',
  verify: 'frontend.external-action.verify.v1',
  cancel: 'frontend.external-action.cancel.v1',
  rollback: 'frontend.external-action.rollback.v1',
  prepareCompensation: 'frontend.external-action.prepare-compensation.v1',
  resolveOutcome: 'frontend.external-action.resolve-outcome.v1',
} as const;

export type FrontendExternalActionCommandType =
  (typeof FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES)[keyof typeof FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES];

/** Domain version tag shared by server and browser digest computation. */
export const FRONTEND_EXTERNAL_ACTION_DOMAIN_VERSION = '1.0.0' as const;

/** Frozen bounded-contract maxima (Contract Snapshot §15). */
export const EXTERNAL_ACTION_QUEUE_PAGE_SIZE_CAP = 50;
export const EXTERNAL_ACTION_ATTEMPT_LIST_CAP = 50;
export const EXTERNAL_ACTION_MANIFEST_PARAMETER_MAX = 100;
export const EXTERNAL_ACTION_APPROVAL_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// V1 enums (exact, exhaustive)
// ---------------------------------------------------------------------------

export type ExternalActionTargetKindV1 = 'KNOWN_TARGET';

export type ExternalActionOperationV1 =
  | 'PREVIEW_ONLY'
  | 'CREATE_DRAFT'
  | 'UPDATE_REVERSIBLE'
  | 'PUBLISH_OR_DELETE'
  | 'FINANCIAL_OR_LEGAL';

export type ExternalActionAggregateStatusV1 =
  | 'CANDIDATE_VALIDATED'
  | 'MANIFEST_READY'
  | 'APPROVED'
  | 'PREFLIGHT_READY'
  | 'PREFLIGHT_FAILED'
  | 'READY_TO_EXECUTE'
  | 'EXECUTING'
  | 'OUTCOME_UNKNOWN'
  | 'FAILED'
  | 'CANCELLING'
  | 'CANCELLED'
  | 'VERIFYING'
  | 'VERIFIED'
  | 'VERIFICATION_FAILED'
  | 'ROLLBACK_AVAILABLE'
  | 'ROLLING_BACK'
  | 'ROLLED_BACK'
  | 'COMPENSATION_REQUIRED'
  | 'COMPENSATING'
  | 'COMPENSATED';

export type ExternalActionConcreteKindV1 =
  'PREFLIGHT' | 'EXECUTION' | 'VERIFICATION' | 'COMPENSATION';

export type ExecutionAttemptStatusV1 =
  'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'OUTCOME_UNKNOWN' | 'CANCELLED';

export type PreflightResultStatusV1 = 'READY' | 'ALREADY_APPLIED' | 'DENIED';

export type VerificationResultStatusV1 = 'APPLIED' | 'NOT_APPLIED' | 'MISMATCH';

export type ExternalActionApprovalPurposeV1 = 'EXTERNAL_ACTION';

export type ExternalActionApprovalStatusV1 =
  'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'CONSUMED' | 'INVALIDATED';

export type ExternalActionAccessMaskingStateV1 = 'VISIBLE' | 'MASKED' | 'HIDDEN';

export type ExternalActionCapabilityV1 =
  | 'LIST_EXTERNAL_ACTIONS'
  | 'READ_EXTERNAL_ACTION'
  | 'READ_MANIFEST'
  | 'READ_RISK_DECISION'
  | 'READ_PREFLIGHT'
  | 'READ_EXECUTION'
  | 'READ_EXECUTION_ATTEMPTS'
  | 'READ_VERIFICATION'
  | 'READ_RESULT'
  | 'READ_AUDIT'
  | 'READ_APPROVAL'
  | 'VALIDATE_CANDIDATE'
  | 'PREPARE_MANIFEST'
  | 'APPROVE_EXTERNAL_ACTION'
  | 'PREFLIGHT_EXTERNAL_ACTION'
  | 'EXECUTE_EXTERNAL_ACTION'
  | 'RETRY_EXECUTION_ATTEMPT'
  | 'VERIFY_EXTERNAL_ACTION'
  | 'CANCEL_EXTERNAL_ACTION'
  | 'ROLLBACK_EXTERNAL_ACTION'
  | 'PREPARE_COMPENSATING_ACTION'
  | 'RESOLVE_OUTCOME';

export type ExternalActionAuditCategoryV1 =
  | 'ACTION_CANDIDATE_VALIDATED'
  | 'RISK_DECIDED'
  | 'MANIFEST_PREPARED'
  | 'MANIFEST_CHANGED'
  | 'APPROVAL_ISSUED'
  | 'APPROVAL_EXPIRED'
  | 'PREFLIGHT_PASSED'
  | 'PREFLIGHT_FAILED'
  | 'EXECUTION_STARTED'
  | 'EXECUTION_ATTEMPT_RECORDED'
  | 'EXECUTION_VERIFIED'
  | 'EXECUTION_VERIFICATION_FAILED'
  | 'EXECUTION_FAILED'
  | 'EXECUTION_OUTCOME_UNKNOWN'
  | 'ACTION_CANCELLED'
  | 'ACTION_ROLLED_BACK'
  | 'COMPENSATION_REQUIRED'
  | 'COMPENSATION_PREPARED'
  | 'COMPENSATION_VERIFIED'
  | 'RESULT_RECORDED'
  | 'ACCESS_RESTRICTED';

export type ExternalActionFailureReasonV1 =
  | 'EXTERNAL_ACTION_NOT_FOUND'
  | 'EXTERNAL_ACTION_STALE'
  | 'ACTION_MANIFEST_CHANGED'
  | 'ACTION_MANIFEST_NOT_READY'
  | 'ACTION_APPROVAL_EXPIRED'
  | 'ACTION_APPROVAL_INVALID'
  | 'ACTION_APPROVAL_REQUIRED'
  | 'ACTION_PREFLIGHT_FAILED'
  | 'ACTION_PREFLIGHT_EXPIRED'
  | 'ACTION_BUDGET_EXCEEDED'
  | 'ACTION_CREDENTIAL_UNAVAILABLE'
  | 'ACTION_EXECUTION_NOT_ALLOWED'
  | 'ACTION_CANCEL_NOT_ALLOWED'
  | 'ACTION_ROLLBACK_NOT_AVAILABLE'
  | 'ACTION_VERIFICATION_MISMATCH'
  | 'ACTION_VERIFICATION_REQUIRED'
  | 'ACTION_OUTCOME_UNKNOWN'
  | 'ACTION_OUTCOME_NOT_FOUND'
  | 'ACTION_COMMAND_SCOPE_MISMATCH'
  | 'EXTERNAL_TARGET_CHANGED'
  | 'ACTION_COMPENSATION_REQUIRED'
  | 'ACTION_BUDGET_NOT_READABLE';

export const EXTERNAL_ACTION_FAILURE_REASONS: readonly ExternalActionFailureReasonV1[] = [
  'EXTERNAL_ACTION_NOT_FOUND',
  'EXTERNAL_ACTION_STALE',
  'ACTION_MANIFEST_CHANGED',
  'ACTION_MANIFEST_NOT_READY',
  'ACTION_APPROVAL_EXPIRED',
  'ACTION_APPROVAL_INVALID',
  'ACTION_APPROVAL_REQUIRED',
  'ACTION_PREFLIGHT_FAILED',
  'ACTION_PREFLIGHT_EXPIRED',
  'ACTION_BUDGET_EXCEEDED',
  'ACTION_CREDENTIAL_UNAVAILABLE',
  'ACTION_EXECUTION_NOT_ALLOWED',
  'ACTION_CANCEL_NOT_ALLOWED',
  'ACTION_ROLLBACK_NOT_AVAILABLE',
  'ACTION_VERIFICATION_MISMATCH',
  'ACTION_VERIFICATION_REQUIRED',
  'ACTION_OUTCOME_UNKNOWN',
  'ACTION_OUTCOME_NOT_FOUND',
  'ACTION_COMMAND_SCOPE_MISMATCH',
  'EXTERNAL_TARGET_CHANGED',
  'ACTION_COMPENSATION_REQUIRED',
  'ACTION_BUDGET_NOT_READABLE',
];

// ---------------------------------------------------------------------------
// V1 value objects
// ---------------------------------------------------------------------------

export type ExternalActionIdentityRefV1 = {
  readonly schemaVersion: '1.0.0';
  readonly targetKind: ExternalActionTargetKindV1;
  readonly targetId: string;
  readonly targetRevision: string;
  readonly externalRevision: string;
};

export type ExternalActionParameterRefV1 = {
  readonly schemaVersion: '1.0.0';
  readonly parameterId: string;
  readonly parameterRevision: string;
  readonly parameterDigest: string;
};

export type ExternalActionEvidenceSetRefV1 = {
  readonly schemaVersion: '1.0.0';
  readonly evidenceSetId: string;
  readonly evidenceSetDigest: string;
};

export type ExternalActionActorV1 = {
  readonly schemaVersion: '1.0.0';
  readonly principalId: string;
  readonly actorId: string;
};

// ---------------------------------------------------------------------------
// V1 resources
// ---------------------------------------------------------------------------

/** ExternalActionV1 — the `EXTERNAL_ACTION` Operational Resource aggregate. */
export type ExternalActionV1 = {
  readonly schemaVersion: '1.0.0';
  readonly actionId: string;
  readonly actionRevision: number;
  readonly targetKind: ExternalActionTargetKindV1;
  readonly targetId: string;
  readonly targetRevision: string;
  readonly externalRevision: string;
  readonly operation: ExternalActionOperationV1;
  readonly resourceProjectId: string;
  readonly effectiveProjectId: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly riskDecisionRef: ExternalActionIdentityRefV1;
  readonly manifestRef: ExternalActionIdentityRefV1;
  readonly approvalRef?: ExternalActionIdentityRefV1;
  readonly status: ExternalActionAggregateStatusV1;
  readonly capabilities: readonly ExternalActionCapabilityV1[];
  readonly aggregateState: 'AVAILABLE' | 'STALE' | 'ACCESS_RESTRICTED' | 'UNAVAILABLE';
  readonly staleReason?: string;
  readonly accessMasking: ExternalActionAccessMaskingStateV1;
  readonly maskedFields: readonly string[];
  readonly latestExecutionRef?: ExternalActionIdentityRefV1;
  readonly compensationForActionId?: string;
  readonly updatedAt: string;
  readonly createdAt: string;
};

export type ActionCandidateV1 = {
  readonly schemaVersion: '1.0.0';
  readonly candidateId: string;
  readonly candidateRevision: number;
  readonly actionId: string;
  readonly sourceRefs: readonly {
    readonly schemaVersion: '1.0.0';
    readonly sourceKind: string;
    readonly sourceId: string;
    readonly sourceRevision: string;
    readonly sourceDigest: string;
  }[];
  readonly operation: ExternalActionOperationV1;
  readonly targetRef: ExternalActionIdentityRefV1;
  readonly parameterRef: ExternalActionParameterRefV1;
  readonly evidenceRefs: readonly ExternalActionEvidenceSetRefV1[];
  readonly compensationForActionId?: string;
  readonly candidateDigest: string;
  readonly riskDecisionRef: ExternalActionIdentityRefV1;
  readonly generatedAt: string;
  readonly generatedBy: ExternalActionActorV1;
};

export type RiskDecisionV1 = {
  readonly schemaVersion: '1.0.0';
  readonly riskDecisionId: string;
  readonly actionId: string;
  readonly riskLevel: 'R0' | 'R1' | 'R2' | 'R3' | 'R4';
  readonly policyVersion: string;
  readonly requiresUserApproval: boolean;
  readonly reasons: readonly string[];
  readonly decidedAt: string;
};

export type ActionManifestV1 = {
  readonly schemaVersion: '1.0.0';
  readonly manifestId: string;
  readonly manifestRevision: number;
  readonly actionId: string;
  readonly targetId: string;
  readonly targetRevision: string;
  readonly targetDigest: string;
  readonly externalRevision: string;
  readonly parameterRef: ExternalActionParameterRefV1;
  readonly parameterDigest: string;
  readonly evidenceSetRef: ExternalActionEvidenceSetRefV1;
  readonly evidenceSetDigest: string;
  readonly payloadDigest: string;
  readonly manifestDigest: string;
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly createdBy: ExternalActionActorV1;
};

export type ExternalActionApprovalV1 = {
  readonly schemaVersion: '1.0.0';
  readonly approvalId: string;
  readonly purpose: ExternalActionApprovalPurposeV1;
  readonly actionId: string;
  readonly manifestId: string;
  readonly manifestRevision: number;
  readonly manifestDigest: string;
  readonly targetId: string;
  readonly targetRevision: string;
  readonly targetDigest: string;
  readonly externalRevision: string;
  readonly actor: ExternalActionActorV1;
  readonly projectId: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly reason: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly status: ExternalActionApprovalStatusV1;
  readonly invalidationReason?: string;
};

export type PreflightV1 = {
  readonly schemaVersion: '1.0.0';
  readonly preflightId: string;
  readonly concreteKind: 'PREFLIGHT';
  readonly actionId: string;
  readonly manifestRevision: number;
  readonly preflightDigest: string;
  readonly status: PreflightResultStatusV1;
  readonly reasons: readonly string[];
  readonly permissionRevalidated: boolean;
  readonly credentialRevalidated: boolean;
  readonly budgetRevalidated: boolean;
  readonly policyRevalidated: boolean;
  readonly targetStateRevalidated: boolean;
  readonly externalRevisionRevalidated: boolean;
  readonly runAt: string;
  readonly expiresAt: string;
};

export type ExecutionV1 = {
  readonly schemaVersion: '1.0.0';
  readonly executionId: string;
  readonly concreteKind: 'EXECUTION';
  readonly actionId: string;
  readonly manifestRevision: number;
  readonly status: ExecutionAttemptStatusV1;
  readonly attemptCount: number;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly latestAttemptRef?: ExternalActionIdentityRefV1;
};

export type ExecutionAttemptV1 = {
  readonly schemaVersion: '1.0.0';
  readonly attemptId: string;
  readonly attemptNumber: number;
  readonly executionId: string;
  readonly actionId: string;
  readonly idempotencyKey: string;
  readonly status: ExecutionAttemptStatusV1;
  readonly policyContextRevision: string;
  readonly externalRevision: string;
  readonly providerRef?: ExternalActionIdentityRefV1;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly startedAt: string;
  readonly completedAt?: string;
};

export type VerificationV1 = {
  readonly schemaVersion: '1.0.0';
  readonly verificationId: string;
  readonly concreteKind: 'VERIFICATION';
  readonly actionId: string;
  readonly executionId: string;
  readonly attemptId?: string;
  readonly targetRevision: string;
  readonly targetDigest: string;
  readonly externalRevision: string;
  readonly status: VerificationResultStatusV1;
  readonly observedDigest?: string;
  readonly verifiedAt: string;
};

export type ResultV1 = {
  readonly schemaVersion: '1.0.0';
  readonly resultId: string;
  readonly actionId: string;
  readonly executionId: string;
  readonly attemptId?: string;
  readonly externalId: string;
  readonly observedDigest: string;
  readonly completedAt: string;
  readonly verificationRef?: ExternalActionIdentityRefV1;
  readonly outputRefs: readonly {
    readonly schemaVersion: '1.0.0';
    readonly outputKind: string;
    readonly outputId: string;
    readonly outputDigest: string;
  }[];
};

export type ActionAuditEventV1 = {
  readonly schemaVersion: '1.0.0';
  readonly auditEventId: string;
  readonly actionId: string;
  readonly sequence: number;
  readonly category: ExternalActionAuditCategoryV1;
  readonly eventJson: string;
  readonly occurredAt: string;
};

export type CompensatingActionV1 = {
  readonly schemaVersion: '1.0.0';
  readonly compensationId: string;
  readonly actionId: string;
  readonly sourceActionId: string;
  readonly sourceExecutionId: string;
  readonly candidateRef: ExternalActionIdentityRefV1;
  readonly status: ExternalActionAggregateStatusV1;
  readonly preparedAt: string;
  readonly preparedBy: ExternalActionActorV1;
};

export type RollbackV1 = {
  readonly schemaVersion: '1.0.0';
  readonly rollbackId: string;
  readonly actionId: string;
  readonly status:
    | 'NOT_AVAILABLE'
    | 'PREPARED'
    | 'APPROVED'
    | 'EXECUTING'
    | 'ROLLED_BACK'
    | 'FAILED'
    | 'OUTCOME_UNKNOWN';
  readonly manifestRef?: ExternalActionIdentityRefV1;
  readonly approvalRef?: ExternalActionIdentityRefV1;
  readonly executionRef?: ExternalActionIdentityRefV1;
  readonly verificationRef?: ExternalActionIdentityRefV1;
  readonly updatedAt: string;
};

// ---------------------------------------------------------------------------
// Read operations
// ---------------------------------------------------------------------------

export type ListExternalActionsRequestV1 = {
  readonly schemaVersion: '1.0.0';
  readonly pageSize: number;
  readonly cursor?: string;
  readonly targetKinds?: readonly ExternalActionTargetKindV1[];
  readonly statuses?: readonly ExternalActionAggregateStatusV1[];
};

export type ExternalActionQueueItemV1 = {
  readonly schemaVersion: '1.0.0';
  readonly actionId: string;
  readonly actionRevision: number;
  readonly operation: ExternalActionOperationV1;
  readonly targetId: string;
  readonly targetRevision: string;
  readonly externalRevision: string;
  readonly status: ExternalActionAggregateStatusV1;
  readonly aggregateState: ExternalActionV1['aggregateState'];
  readonly capabilities: readonly ExternalActionCapabilityV1[];
  readonly riskLevel: 'R0' | 'R1' | 'R2' | 'R3' | 'R4';
  readonly updatedAt: string;
};

export type ListExternalActionsResultV1 = {
  readonly schemaVersion: '1.0.0';
  readonly items: readonly ExternalActionQueueItemV1[];
  readonly nextCursor?: string;
  readonly capabilities: readonly ExternalActionCapabilityV1[];
};

export type GetExternalActionRequestV1 = {
  readonly schemaVersion: '1.0.0';
  readonly actionId: string;
};

export type GetExternalActionResultV1 = {
  readonly schemaVersion: '1.0.0';
  readonly action: ExternalActionV1;
};

export type GetExternalActionDetailRequestV1 = {
  readonly schemaVersion: '1.0.0';
  readonly actionId: string;
};

export type GetExternalActionDetailResultV1 = {
  readonly schemaVersion: '1.0.0';
  readonly action: ExternalActionV1;
  readonly manifest?: ActionManifestV1;
  readonly riskDecision?: RiskDecisionV1;
  readonly approval?: ExternalActionApprovalV1;
  readonly preflight?: PreflightV1;
  readonly execution?: ExecutionV1;
  readonly attempts: readonly ExecutionAttemptV1[];
  readonly verification?: VerificationV1;
  readonly result?: ResultV1;
  readonly rollback?: RollbackV1;
  readonly compensation?: CompensatingActionV1;
};

export type ListExternalActionAuditRequestV1 = {
  readonly schemaVersion: '1.0.0';
  readonly actionId: string;
  readonly cursor?: string;
  readonly pageSize: number;
};

export type ListExternalActionAuditResultV1 = {
  readonly schemaVersion: '1.0.0';
  readonly events: readonly ActionAuditEventV1[];
  readonly nextCursor?: string;
};

// ---------------------------------------------------------------------------
// Governed write operations (Frontend Command Ledger)
// ---------------------------------------------------------------------------

export type ValidateActionCandidateRequestV1 = {
  readonly schemaVersion: '1.0.0';
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly actionId: string;
  readonly candidateId: string;
  readonly operation: ExternalActionOperationV1;
  readonly targetRef: ExternalActionIdentityRefV1;
  readonly parameterRef: ExternalActionParameterRefV1;
  readonly evidenceRefs: readonly ExternalActionEvidenceSetRefV1[];
  readonly compensationForActionId?: string;
  readonly reason?: string;
};

export type ValidateActionCandidateResultV1 = {
  readonly schemaVersion: '1.0.0';
  readonly outcome: 'COMPLETED';
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly commandSemanticDigest: string;
  readonly actionId: string;
  readonly riskDecision: RiskDecisionV1;
  readonly candidate: ActionCandidateV1;
};

export type PrepareActionManifestRequestV1 = {
  readonly schemaVersion: '1.0.0';
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly actionId: string;
  readonly expectedActionRevision: number;
  readonly reason: string;
};

export type PrepareActionManifestResultV1 = {
  readonly schemaVersion: '1.0.0';
  readonly outcome: 'COMPLETED';
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly commandSemanticDigest: string;
  readonly actionId: string;
  readonly manifest: ActionManifestV1;
};

export type ApproveExternalActionRequestV1 = {
  readonly schemaVersion: '1.0.0';
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly actionId: string;
  readonly manifestId: string;
  readonly manifestRevision: number;
  readonly expectedTargetRevision: string;
  readonly expectedExternalRevision: string;
  readonly reason: string;
};

export type ApproveExternalActionResultV1 = {
  readonly schemaVersion: '1.0.0';
  readonly outcome: 'COMPLETED';
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly commandSemanticDigest: string;
  readonly actionId: string;
  readonly approval: ExternalActionApprovalV1;
};

export type PreflightExternalActionRequestV1 = {
  readonly schemaVersion: '1.0.0';
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly actionId: string;
  readonly expectedActionRevision: number;
  readonly manifestRevision: number;
  readonly expectedExternalRevision: string;
  readonly reason: string;
};

export type PreflightExternalActionResultV1 = {
  readonly schemaVersion: '1.0.0';
  readonly outcome: 'COMPLETED';
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly commandSemanticDigest: string;
  readonly actionId: string;
  readonly preflight: PreflightV1;
};

export type ExecuteExternalActionRequestV1 = {
  readonly schemaVersion: '1.0.0';
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly actionId: string;
  readonly expectedActionRevision: number;
  readonly manifestRevision: number;
  readonly preflightId: string;
  readonly expectedExternalRevision: string;
  readonly reason: string;
};

export type ExecuteExternalActionResultV1 = {
  readonly schemaVersion: '1.0.0';
  readonly outcome: 'COMPLETED' | 'OUTCOME_UNKNOWN';
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly commandSemanticDigest: string;
  readonly actionId: string;
  readonly execution: ExecutionV1;
  readonly attempt: ExecutionAttemptV1;
};

export type RetryExecutionAttemptRequestV1 = {
  readonly schemaVersion: '1.0.0';
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly actionId: string;
  readonly executionId: string;
  readonly sourceAttemptId: string;
  readonly causationId: string;
  readonly reason: string;
};

export type RetryExecutionAttemptResultV1 = {
  readonly schemaVersion: '1.0.0';
  readonly outcome: 'COMPLETED' | 'OUTCOME_UNKNOWN';
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly commandSemanticDigest: string;
  readonly actionId: string;
  readonly attempt: ExecutionAttemptV1;
};

export type VerifyExternalActionRequestV1 = {
  readonly schemaVersion: '1.0.0';
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly actionId: string;
  readonly executionId: string;
  readonly attemptId?: string;
  readonly expectedTargetRevision: string;
  readonly expectedExternalRevision: string;
  readonly reason: string;
};

export type VerifyExternalActionResultV1 = {
  readonly schemaVersion: '1.0.0';
  readonly outcome: 'COMPLETED';
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly commandSemanticDigest: string;
  readonly actionId: string;
  readonly verification: VerificationV1;
};

export type CancelExternalActionRequestV1 = {
  readonly schemaVersion: '1.0.0';
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly actionId: string;
  readonly expectedActionRevision: number;
  readonly reason: string;
};

export type CancelExternalActionResultV1 = {
  readonly schemaVersion: '1.0.0';
  readonly outcome: 'COMPLETED';
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly commandSemanticDigest: string;
  readonly actionId: string;
  readonly status: 'CANCELLING' | 'CANCELLED';
};

export type RollbackExternalActionRequestV1 = {
  readonly schemaVersion: '1.0.0';
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly actionId: string;
  readonly executionId: string;
  readonly reason: string;
};

export type RollbackExternalActionResultV1 = {
  readonly schemaVersion: '1.0.0';
  readonly outcome: 'COMPLETED' | 'OUTCOME_UNKNOWN';
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly commandSemanticDigest: string;
  readonly actionId: string;
  readonly rollback: RollbackV1;
};

export type PrepareCompensatingActionRequestV1 = {
  readonly schemaVersion: '1.0.0';
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly sourceActionId: string;
  readonly sourceExecutionId: string;
  readonly reason: string;
};

export type PrepareCompensatingActionResultV1 = {
  readonly schemaVersion: '1.0.0';
  readonly outcome: 'COMPLETED';
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly commandSemanticDigest: string;
  readonly compensation: CompensatingActionV1;
};

export type ResolveExternalActionOutcomeRequestV1 = {
  readonly schemaVersion: '1.0.0';
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly semanticDigest: string;
};

export type ResolveExternalActionOutcomeResultV1 = {
  readonly schemaVersion: '1.0.0';
  readonly outcome: 'COMPLETED' | 'REJECTED' | 'OUTCOME_UNKNOWN';
  readonly originalClientRequestId: string;
  readonly originalIdempotencyKey: string;
  readonly completed?: {
    readonly commandType: FrontendExternalActionCommandType;
    readonly result: unknown;
  };
  readonly rejection?: { readonly code: string; readonly message: string };
};

// ---------------------------------------------------------------------------
// Semantic digests (identity fields excluded; shared with browser client)
// ---------------------------------------------------------------------------

export const frontendExternalActionCandidateDigest = (
  request: ValidateActionCandidateRequestV1,
): string =>
  sha256Text(
    stableJson({
      actionId: request.actionId,
      candidateId: request.candidateId,
      operation: request.operation,
      targetRef: request.targetRef,
      parameterRef: request.parameterRef,
      evidenceRefs: request.evidenceRefs,
      compensationForActionId: request.compensationForActionId ?? null,
    }),
  );

export const frontendExternalActionManifestDigest = (
  request: PrepareActionManifestRequestV1,
): string =>
  sha256Text(
    stableJson({
      actionId: request.actionId,
      expectedActionRevision: request.expectedActionRevision,
      reason: request.reason,
    }),
  );

export const frontendExternalActionApproveDigest = (
  request: ApproveExternalActionRequestV1,
): string =>
  sha256Text(
    stableJson({
      actionId: request.actionId,
      manifestId: request.manifestId,
      manifestRevision: request.manifestRevision,
      expectedTargetRevision: request.expectedTargetRevision,
      expectedExternalRevision: request.expectedExternalRevision,
      reason: request.reason,
    }),
  );

export const frontendExternalActionPreflightDigest = (
  request: PreflightExternalActionRequestV1,
): string =>
  sha256Text(
    stableJson({
      actionId: request.actionId,
      expectedActionRevision: request.expectedActionRevision,
      manifestRevision: request.manifestRevision,
      expectedExternalRevision: request.expectedExternalRevision,
      reason: request.reason,
    }),
  );

export const frontendExternalActionExecuteDigest = (
  request: ExecuteExternalActionRequestV1,
): string =>
  sha256Text(
    stableJson({
      actionId: request.actionId,
      expectedActionRevision: request.expectedActionRevision,
      manifestRevision: request.manifestRevision,
      preflightId: request.preflightId,
      expectedExternalRevision: request.expectedExternalRevision,
      reason: request.reason,
    }),
  );

export const frontendExternalActionRetryDigest = (
  request: RetryExecutionAttemptRequestV1,
): string =>
  sha256Text(
    stableJson({
      actionId: request.actionId,
      executionId: request.executionId,
      sourceAttemptId: request.sourceAttemptId,
      causationId: request.causationId,
      reason: request.reason,
    }),
  );

export const frontendExternalActionVerifyDigest = (
  request: VerifyExternalActionRequestV1,
): string =>
  sha256Text(
    stableJson({
      actionId: request.actionId,
      executionId: request.executionId,
      attemptId: request.attemptId ?? null,
      expectedTargetRevision: request.expectedTargetRevision,
      expectedExternalRevision: request.expectedExternalRevision,
      reason: request.reason,
    }),
  );

export const frontendExternalActionCancelDigest = (
  request: CancelExternalActionRequestV1,
): string =>
  sha256Text(
    stableJson({
      actionId: request.actionId,
      expectedActionRevision: request.expectedActionRevision,
      reason: request.reason,
    }),
  );

export const frontendExternalActionRollbackDigest = (
  request: RollbackExternalActionRequestV1,
): string =>
  sha256Text(
    stableJson({
      actionId: request.actionId,
      executionId: request.executionId,
      reason: request.reason,
    }),
  );

export const frontendExternalActionCompensationDigest = (
  request: PrepareCompensatingActionRequestV1,
): string =>
  sha256Text(
    stableJson({
      sourceActionId: request.sourceActionId,
      sourceExecutionId: request.sourceExecutionId,
      reason: request.reason,
    }),
  );

/** Manifest digest over the exact manifest payload (server-computed). */
export const externalActionManifestDigest = (manifest: {
  readonly manifestId: string;
  readonly manifestRevision: number;
  readonly actionId: string;
  readonly targetId: string;
  readonly targetRevision: string;
  readonly targetDigest: string;
  readonly externalRevision: string;
  readonly parameterRef: ExternalActionParameterRefV1;
  readonly parameterDigest: string;
  readonly evidenceSetRef: ExternalActionEvidenceSetRefV1;
  readonly evidenceSetDigest: string;
  readonly payloadDigest: string;
}): string =>
  sha256Text(
    stableJson({
      manifestId: manifest.manifestId,
      manifestRevision: manifest.manifestRevision,
      actionId: manifest.actionId,
      targetId: manifest.targetId,
      targetRevision: manifest.targetRevision,
      targetDigest: manifest.targetDigest,
      externalRevision: manifest.externalRevision,
      parameterRef: manifest.parameterRef,
      parameterDigest: manifest.parameterDigest,
      evidenceSetRef: manifest.evidenceSetRef,
      evidenceSetDigest: manifest.evidenceSetDigest,
      payloadDigest: manifest.payloadDigest,
    }),
  );

// ---------------------------------------------------------------------------
// Strict decoders
// ---------------------------------------------------------------------------

type ObjectValue = Record<string, unknown>;

const fail = (path: string, message: string): never => {
  throw new FrontendContractError('INVALID_REQUEST', `invalid ${path}: ${message}`);
};

const asObject = (value: unknown, path: string): ObjectValue => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(path, 'must be a non-null object');
  }
  return value as ObjectValue;
};

const strictObject = (
  value: unknown,
  allowedKeys: readonly string[],
  path: string,
): ObjectValue => {
  const object = asObject(value, path);
  const unexpected = Object.keys(object).filter((key) => !allowedKeys.includes(key));
  if (unexpected.length > 0) {
    return fail(path, `contains unsupported fields: ${unexpected.join(', ')}`);
  }
  return object;
};

const required = (object: ObjectValue, key: string, path: string): unknown => {
  if (!(key in object) || object[key] === undefined) return fail(`${path}.${key}`, 'is required');
  return object[key];
};

const text = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return fail(path, 'must be a non-empty string');
  }
  return value;
};

const optionalText = (value: unknown, path: string): string | undefined => {
  if (value === undefined) return undefined;
  return text(value, path);
};

const integer = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return fail(path, 'must be a non-negative safe integer');
  }
  return value;
};

const positiveInteger = (value: unknown, path: string): number => {
  const result = integer(value, path);
  if (result <= 0) return fail(path, 'must be a positive safe integer');
  return result;
};

const booleanValue = (value: unknown, path: string): boolean => {
  if (typeof value !== 'boolean') return fail(path, 'must be a boolean');
  return value;
};

const enumValue = <T extends string>(value: unknown, values: readonly T[], path: string): T => {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    return fail(path, `must be one of ${values.join(', ')}`);
  }
  return value as T;
};

const arrayValue = (value: unknown, path: string): readonly unknown[] => {
  if (!Array.isArray(value)) return fail(path, 'must be an array');
  return value;
};

const isoTimestamp = (value: unknown, path: string): string => {
  const result = text(value, path);
  if (Number.isNaN(Date.parse(result))) return fail(path, 'must be an ISO timestamp');
  return result;
};

const digest = (value: unknown, path: string): string => {
  const result = text(value, path);
  if (!/^sha256:[a-f0-9]{64}$/.test(result)) {
    return fail(path, 'must be a sha256 digest');
  }
  return result;
};

const decodeSchemaVersion = (object: ObjectValue, path: string): void => {
  const schemaVersion = text(required(object, 'schemaVersion', path), `${path}.schemaVersion`);
  if (schemaVersion !== '1.0.0') return fail(`${path}.schemaVersion`, 'must be 1.0.0');
};

const decodeIdentityRef = (value: unknown, path: string): ExternalActionIdentityRefV1 => {
  const object = strictObject(
    value,
    ['schemaVersion', 'targetKind', 'targetId', 'targetRevision', 'externalRevision'],
    path,
  );
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    targetKind: enumValue(
      required(object, 'targetKind', path),
      ['KNOWN_TARGET'],
      `${path}.targetKind`,
    ),
    targetId: text(required(object, 'targetId', path), `${path}.targetId`),
    targetRevision: text(required(object, 'targetRevision', path), `${path}.targetRevision`),
    externalRevision: text(required(object, 'externalRevision', path), `${path}.externalRevision`),
  };
};

const decodeParameterRef = (value: unknown, path: string): ExternalActionParameterRefV1 => {
  const object = strictObject(
    value,
    ['schemaVersion', 'parameterId', 'parameterRevision', 'parameterDigest'],
    path,
  );
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    parameterId: text(required(object, 'parameterId', path), `${path}.parameterId`),
    parameterRevision: text(
      required(object, 'parameterRevision', path),
      `${path}.parameterRevision`,
    ),
    parameterDigest: digest(required(object, 'parameterDigest', path), `${path}.parameterDigest`),
  };
};

const decodeEvidenceSetRef = (value: unknown, path: string): ExternalActionEvidenceSetRefV1 => {
  const object = strictObject(value, ['schemaVersion', 'evidenceSetId', 'evidenceSetDigest'], path);
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    evidenceSetId: text(required(object, 'evidenceSetId', path), `${path}.evidenceSetId`),
    evidenceSetDigest: digest(
      required(object, 'evidenceSetDigest', path),
      `${path}.evidenceSetDigest`,
    ),
  };
};

const decodeActor = (value: unknown, path: string): ExternalActionActorV1 => {
  const object = strictObject(value, ['schemaVersion', 'principalId', 'actorId'], path);
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    principalId: text(required(object, 'principalId', path), `${path}.principalId`),
    actorId: text(required(object, 'actorId', path), `${path}.actorId`),
  };
};

const decodeOptionalRef = <T>(
  value: unknown,
  path: string,
  decode: (value: unknown, path: string) => T,
): T | undefined => {
  if (value === undefined) return undefined;
  return decode(value, path);
};

const EXTERNAL_ACTION_OPERATIONS: readonly ExternalActionOperationV1[] = [
  'PREVIEW_ONLY',
  'CREATE_DRAFT',
  'UPDATE_REVERSIBLE',
  'PUBLISH_OR_DELETE',
  'FINANCIAL_OR_LEGAL',
];

const EXTERNAL_ACTION_AGGREGATE_STATUSES: readonly ExternalActionAggregateStatusV1[] = [
  'CANDIDATE_VALIDATED',
  'MANIFEST_READY',
  'APPROVED',
  'PREFLIGHT_READY',
  'PREFLIGHT_FAILED',
  'READY_TO_EXECUTE',
  'EXECUTING',
  'OUTCOME_UNKNOWN',
  'FAILED',
  'CANCELLING',
  'CANCELLED',
  'VERIFYING',
  'VERIFIED',
  'VERIFICATION_FAILED',
  'ROLLBACK_AVAILABLE',
  'ROLLING_BACK',
  'ROLLED_BACK',
  'COMPENSATION_REQUIRED',
  'COMPENSATING',
  'COMPENSATED',
];

const EXTERNAL_ACTION_CAPABILITIES: readonly ExternalActionCapabilityV1[] = [
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
  'VALIDATE_CANDIDATE',
  'PREPARE_MANIFEST',
  'APPROVE_EXTERNAL_ACTION',
  'PREFLIGHT_EXTERNAL_ACTION',
  'EXECUTE_EXTERNAL_ACTION',
  'RETRY_EXECUTION_ATTEMPT',
  'VERIFY_EXTERNAL_ACTION',
  'CANCEL_EXTERNAL_ACTION',
  'ROLLBACK_EXTERNAL_ACTION',
  'PREPARE_COMPENSATING_ACTION',
  'RESOLVE_OUTCOME',
];

const EXTERNAL_ACTION_ATTEMPT_STATUSES: readonly ExecutionAttemptStatusV1[] = [
  'PENDING',
  'IN_PROGRESS',
  'SUCCEEDED',
  'FAILED',
  'OUTCOME_UNKNOWN',
  'CANCELLED',
];

const PREFLIGHT_STATUSES: readonly PreflightResultStatusV1[] = [
  'READY',
  'ALREADY_APPLIED',
  'DENIED',
];

const VERIFICATION_STATUSES: readonly VerificationResultStatusV1[] = [
  'APPLIED',
  'NOT_APPLIED',
  'MISMATCH',
];

const APPROVAL_STATUSES: readonly ExternalActionApprovalStatusV1[] = [
  'ACTIVE',
  'EXPIRED',
  'REVOKED',
  'CONSUMED',
  'INVALIDATED',
];

export const decodeExternalActionV1 = (
  value: unknown,
  path = 'externalAction',
): ExternalActionV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'actionId',
      'actionRevision',
      'targetKind',
      'targetId',
      'targetRevision',
      'externalRevision',
      'operation',
      'resourceProjectId',
      'effectiveProjectId',
      'accessRevision',
      'policyContextRevision',
      'riskDecisionRef',
      'manifestRef',
      'approvalRef',
      'status',
      'capabilities',
      'aggregateState',
      'staleReason',
      'accessMasking',
      'maskedFields',
      'latestExecutionRef',
      'compensationForActionId',
      'updatedAt',
      'createdAt',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
    actionRevision: positiveInteger(
      required(object, 'actionRevision', path),
      `${path}.actionRevision`,
    ),
    targetKind: enumValue(
      required(object, 'targetKind', path),
      ['KNOWN_TARGET'],
      `${path}.targetKind`,
    ),
    targetId: text(required(object, 'targetId', path), `${path}.targetId`),
    targetRevision: text(required(object, 'targetRevision', path), `${path}.targetRevision`),
    externalRevision: text(required(object, 'externalRevision', path), `${path}.externalRevision`),
    operation: enumValue(
      required(object, 'operation', path),
      EXTERNAL_ACTION_OPERATIONS,
      `${path}.operation`,
    ),
    resourceProjectId: text(
      required(object, 'resourceProjectId', path),
      `${path}.resourceProjectId`,
    ),
    effectiveProjectId: text(
      required(object, 'effectiveProjectId', path),
      `${path}.effectiveProjectId`,
    ),
    accessRevision: text(required(object, 'accessRevision', path), `${path}.accessRevision`),
    policyContextRevision: text(
      required(object, 'policyContextRevision', path),
      `${path}.policyContextRevision`,
    ),
    riskDecisionRef: decodeIdentityRef(
      required(object, 'riskDecisionRef', path),
      `${path}.riskDecisionRef`,
    ),
    manifestRef: decodeIdentityRef(required(object, 'manifestRef', path), `${path}.manifestRef`),
    approvalRef: decodeOptionalRef(object.approvalRef, `${path}.approvalRef`, (v, p) =>
      decodeIdentityRef(v, p),
    ),
    status: enumValue(
      required(object, 'status', path),
      EXTERNAL_ACTION_AGGREGATE_STATUSES,
      `${path}.status`,
    ),
    capabilities: arrayValue(required(object, 'capabilities', path), `${path}.capabilities`).map(
      (entry, index) =>
        enumValue(entry, EXTERNAL_ACTION_CAPABILITIES, `${path}.capabilities[${index}]`),
    ),
    aggregateState: enumValue(
      required(object, 'aggregateState', path),
      ['AVAILABLE', 'STALE', 'ACCESS_RESTRICTED', 'UNAVAILABLE'],
      `${path}.aggregateState`,
    ),
    staleReason: optionalText(object.staleReason, `${path}.staleReason`),
    accessMasking: enumValue(
      required(object, 'accessMasking', path),
      ['VISIBLE', 'MASKED', 'HIDDEN'],
      `${path}.accessMasking`,
    ),
    maskedFields: arrayValue(required(object, 'maskedFields', path), `${path}.maskedFields`).map(
      (entry, index) => text(entry, `${path}.maskedFields[${index}]`),
    ),
    latestExecutionRef: decodeOptionalRef(
      object.latestExecutionRef,
      `${path}.latestExecutionRef`,
      (v, p) => decodeIdentityRef(v, p),
    ),
    compensationForActionId: optionalText(
      object.compensationForActionId,
      `${path}.compensationForActionId`,
    ),
    updatedAt: isoTimestamp(required(object, 'updatedAt', path), `${path}.updatedAt`),
    createdAt: isoTimestamp(required(object, 'createdAt', path), `${path}.createdAt`),
  };
};

export const decodeRiskDecisionV1 = (value: unknown, path = 'riskDecision'): RiskDecisionV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'riskDecisionId',
      'actionId',
      'riskLevel',
      'policyVersion',
      'requiresUserApproval',
      'reasons',
      'decidedAt',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    riskDecisionId: text(required(object, 'riskDecisionId', path), `${path}.riskDecisionId`),
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
    riskLevel: enumValue(
      required(object, 'riskLevel', path),
      ['R0', 'R1', 'R2', 'R3', 'R4'],
      `${path}.riskLevel`,
    ),
    policyVersion: text(required(object, 'policyVersion', path), `${path}.policyVersion`),
    requiresUserApproval: booleanValue(
      required(object, 'requiresUserApproval', path),
      `${path}.requiresUserApproval`,
    ),
    reasons: arrayValue(required(object, 'reasons', path), `${path}.reasons`).map((entry, index) =>
      text(entry, `${path}.reasons[${index}]`),
    ),
    decidedAt: isoTimestamp(required(object, 'decidedAt', path), `${path}.decidedAt`),
  };
};

export const decodeActionManifestV1 = (value: unknown, path = 'manifest'): ActionManifestV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'manifestId',
      'manifestRevision',
      'actionId',
      'targetId',
      'targetRevision',
      'targetDigest',
      'externalRevision',
      'parameterRef',
      'parameterDigest',
      'evidenceSetRef',
      'evidenceSetDigest',
      'payloadDigest',
      'manifestDigest',
      'expiresAt',
      'createdAt',
      'createdBy',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  const manifest: ActionManifestV1 = {
    schemaVersion: '1.0.0',
    manifestId: text(required(object, 'manifestId', path), `${path}.manifestId`),
    manifestRevision: positiveInteger(
      required(object, 'manifestRevision', path),
      `${path}.manifestRevision`,
    ),
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
    targetId: text(required(object, 'targetId', path), `${path}.targetId`),
    targetRevision: text(required(object, 'targetRevision', path), `${path}.targetRevision`),
    targetDigest: digest(required(object, 'targetDigest', path), `${path}.targetDigest`),
    externalRevision: text(required(object, 'externalRevision', path), `${path}.externalRevision`),
    parameterRef: decodeParameterRef(
      required(object, 'parameterRef', path),
      `${path}.parameterRef`,
    ),
    parameterDigest: digest(required(object, 'parameterDigest', path), `${path}.parameterDigest`),
    evidenceSetRef: decodeEvidenceSetRef(
      required(object, 'evidenceSetRef', path),
      `${path}.evidenceSetRef`,
    ),
    evidenceSetDigest: digest(
      required(object, 'evidenceSetDigest', path),
      `${path}.evidenceSetDigest`,
    ),
    payloadDigest: digest(required(object, 'payloadDigest', path), `${path}.payloadDigest`),
    manifestDigest: digest(required(object, 'manifestDigest', path), `${path}.manifestDigest`),
    expiresAt: isoTimestamp(required(object, 'expiresAt', path), `${path}.expiresAt`),
    createdAt: isoTimestamp(required(object, 'createdAt', path), `${path}.createdAt`),
    createdBy: decodeActor(required(object, 'createdBy', path), `${path}.createdBy`),
  };
  if (externalActionManifestDigest(manifest) !== manifest.manifestDigest) {
    return fail(`${path}.manifestDigest`, 'does not match the manifest payload');
  }
  return manifest;
};

export const decodeExternalActionApprovalV1 = (
  value: unknown,
  path = 'approval',
): ExternalActionApprovalV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'approvalId',
      'purpose',
      'actionId',
      'manifestId',
      'manifestRevision',
      'manifestDigest',
      'targetId',
      'targetRevision',
      'targetDigest',
      'externalRevision',
      'actor',
      'projectId',
      'accessRevision',
      'policyContextRevision',
      'reason',
      'issuedAt',
      'expiresAt',
      'status',
      'invalidationReason',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    approvalId: text(required(object, 'approvalId', path), `${path}.approvalId`),
    purpose: enumValue(required(object, 'purpose', path), ['EXTERNAL_ACTION'], `${path}.purpose`),
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
    manifestId: text(required(object, 'manifestId', path), `${path}.manifestId`),
    manifestRevision: positiveInteger(
      required(object, 'manifestRevision', path),
      `${path}.manifestRevision`,
    ),
    manifestDigest: digest(required(object, 'manifestDigest', path), `${path}.manifestDigest`),
    targetId: text(required(object, 'targetId', path), `${path}.targetId`),
    targetRevision: text(required(object, 'targetRevision', path), `${path}.targetRevision`),
    targetDigest: digest(required(object, 'targetDigest', path), `${path}.targetDigest`),
    externalRevision: text(required(object, 'externalRevision', path), `${path}.externalRevision`),
    actor: decodeActor(required(object, 'actor', path), `${path}.actor`),
    projectId: text(required(object, 'projectId', path), `${path}.projectId`),
    accessRevision: text(required(object, 'accessRevision', path), `${path}.accessRevision`),
    policyContextRevision: text(
      required(object, 'policyContextRevision', path),
      `${path}.policyContextRevision`,
    ),
    reason: text(required(object, 'reason', path), `${path}.reason`),
    issuedAt: isoTimestamp(required(object, 'issuedAt', path), `${path}.issuedAt`),
    expiresAt: isoTimestamp(required(object, 'expiresAt', path), `${path}.expiresAt`),
    status: enumValue(required(object, 'status', path), APPROVAL_STATUSES, `${path}.status`),
    invalidationReason: optionalText(object.invalidationReason, `${path}.invalidationReason`),
  };
};

export const decodePreflightV1 = (value: unknown, path = 'preflight'): PreflightV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'preflightId',
      'concreteKind',
      'actionId',
      'manifestRevision',
      'preflightDigest',
      'status',
      'reasons',
      'permissionRevalidated',
      'credentialRevalidated',
      'budgetRevalidated',
      'policyRevalidated',
      'targetStateRevalidated',
      'externalRevisionRevalidated',
      'runAt',
      'expiresAt',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    preflightId: text(required(object, 'preflightId', path), `${path}.preflightId`),
    concreteKind: 'PREFLIGHT',
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
    manifestRevision: positiveInteger(
      required(object, 'manifestRevision', path),
      `${path}.manifestRevision`,
    ),
    preflightDigest: digest(required(object, 'preflightDigest', path), `${path}.preflightDigest`),
    status: enumValue(required(object, 'status', path), PREFLIGHT_STATUSES, `${path}.status`),
    reasons: arrayValue(required(object, 'reasons', path), `${path}.reasons`).map((entry, index) =>
      text(entry, `${path}.reasons[${index}]`),
    ),
    permissionRevalidated: booleanValue(
      required(object, 'permissionRevalidated', path),
      `${path}.permissionRevalidated`,
    ),
    credentialRevalidated: booleanValue(
      required(object, 'credentialRevalidated', path),
      `${path}.credentialRevalidated`,
    ),
    budgetRevalidated: booleanValue(
      required(object, 'budgetRevalidated', path),
      `${path}.budgetRevalidated`,
    ),
    policyRevalidated: booleanValue(
      required(object, 'policyRevalidated', path),
      `${path}.policyRevalidated`,
    ),
    targetStateRevalidated: booleanValue(
      required(object, 'targetStateRevalidated', path),
      `${path}.targetStateRevalidated`,
    ),
    externalRevisionRevalidated: booleanValue(
      required(object, 'externalRevisionRevalidated', path),
      `${path}.externalRevisionRevalidated`,
    ),
    runAt: isoTimestamp(required(object, 'runAt', path), `${path}.runAt`),
    expiresAt: isoTimestamp(required(object, 'expiresAt', path), `${path}.expiresAt`),
  };
};

export const decodeExecutionV1 = (value: unknown, path = 'execution'): ExecutionV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'executionId',
      'concreteKind',
      'actionId',
      'manifestRevision',
      'status',
      'attemptCount',
      'startedAt',
      'completedAt',
      'latestAttemptRef',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    executionId: text(required(object, 'executionId', path), `${path}.executionId`),
    concreteKind: 'EXECUTION',
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
    manifestRevision: positiveInteger(
      required(object, 'manifestRevision', path),
      `${path}.manifestRevision`,
    ),
    status: enumValue(
      required(object, 'status', path),
      EXTERNAL_ACTION_ATTEMPT_STATUSES,
      `${path}.status`,
    ),
    attemptCount: integer(required(object, 'attemptCount', path), `${path}.attemptCount`),
    startedAt: isoTimestamp(required(object, 'startedAt', path), `${path}.startedAt`),
    completedAt:
      object.completedAt === undefined
        ? undefined
        : isoTimestamp(object.completedAt, `${path}.completedAt`),
    latestAttemptRef: decodeOptionalRef(
      object.latestAttemptRef,
      `${path}.latestAttemptRef`,
      (v, p) => decodeIdentityRef(v, p),
    ),
  };
};

export const decodeExecutionAttemptV1 = (value: unknown, path = 'attempt'): ExecutionAttemptV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'attemptId',
      'attemptNumber',
      'executionId',
      'actionId',
      'idempotencyKey',
      'status',
      'policyContextRevision',
      'externalRevision',
      'providerRef',
      'correlationId',
      'causationId',
      'startedAt',
      'completedAt',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    attemptId: text(required(object, 'attemptId', path), `${path}.attemptId`),
    attemptNumber: positiveInteger(
      required(object, 'attemptNumber', path),
      `${path}.attemptNumber`,
    ),
    executionId: text(required(object, 'executionId', path), `${path}.executionId`),
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
    idempotencyKey: text(required(object, 'idempotencyKey', path), `${path}.idempotencyKey`),
    status: enumValue(
      required(object, 'status', path),
      EXTERNAL_ACTION_ATTEMPT_STATUSES,
      `${path}.status`,
    ),
    policyContextRevision: text(
      required(object, 'policyContextRevision', path),
      `${path}.policyContextRevision`,
    ),
    externalRevision: text(required(object, 'externalRevision', path), `${path}.externalRevision`),
    providerRef: decodeOptionalRef(object.providerRef, `${path}.providerRef`, (v, p) =>
      decodeIdentityRef(v, p),
    ),
    correlationId: text(required(object, 'correlationId', path), `${path}.correlationId`),
    causationId: optionalText(object.causationId, `${path}.causationId`),
    startedAt: isoTimestamp(required(object, 'startedAt', path), `${path}.startedAt`),
    completedAt:
      object.completedAt === undefined
        ? undefined
        : isoTimestamp(object.completedAt, `${path}.completedAt`),
  };
};

export const decodeVerificationV1 = (value: unknown, path = 'verification'): VerificationV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'verificationId',
      'concreteKind',
      'actionId',
      'executionId',
      'attemptId',
      'targetRevision',
      'targetDigest',
      'externalRevision',
      'status',
      'observedDigest',
      'verifiedAt',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    verificationId: text(required(object, 'verificationId', path), `${path}.verificationId`),
    concreteKind: 'VERIFICATION',
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
    executionId: text(required(object, 'executionId', path), `${path}.executionId`),
    attemptId: optionalText(object.attemptId, `${path}.attemptId`),
    targetRevision: text(required(object, 'targetRevision', path), `${path}.targetRevision`),
    targetDigest: digest(required(object, 'targetDigest', path), `${path}.targetDigest`),
    externalRevision: text(required(object, 'externalRevision', path), `${path}.externalRevision`),
    status: enumValue(required(object, 'status', path), VERIFICATION_STATUSES, `${path}.status`),
    observedDigest:
      object.observedDigest === undefined
        ? undefined
        : digest(object.observedDigest, `${path}.observedDigest`),
    verifiedAt: isoTimestamp(required(object, 'verifiedAt', path), `${path}.verifiedAt`),
  };
};

export const decodeResultV1 = (value: unknown, path = 'result'): ResultV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'resultId',
      'actionId',
      'executionId',
      'attemptId',
      'externalId',
      'observedDigest',
      'completedAt',
      'verificationRef',
      'outputRefs',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    resultId: text(required(object, 'resultId', path), `${path}.resultId`),
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
    executionId: text(required(object, 'executionId', path), `${path}.executionId`),
    attemptId: optionalText(object.attemptId, `${path}.attemptId`),
    externalId: text(required(object, 'externalId', path), `${path}.externalId`),
    observedDigest: digest(required(object, 'observedDigest', path), `${path}.observedDigest`),
    completedAt: isoTimestamp(required(object, 'completedAt', path), `${path}.completedAt`),
    verificationRef: decodeOptionalRef(object.verificationRef, `${path}.verificationRef`, (v, p) =>
      decodeIdentityRef(v, p),
    ),
    outputRefs: arrayValue(required(object, 'outputRefs', path), `${path}.outputRefs`).map(
      (entry, index) => {
        const output = strictObject(
          entry,
          ['schemaVersion', 'outputKind', 'outputId', 'outputDigest'],
          `${path}.outputRefs[${index}]`,
        );
        decodeSchemaVersion(output, `${path}.outputRefs[${index}]`);
        return {
          schemaVersion: '1.0.0' as const,
          outputKind: text(
            required(output, 'outputKind', path),
            `${path}.outputRefs[${index}].outputKind`,
          ),
          outputId: text(
            required(output, 'outputId', path),
            `${path}.outputRefs[${index}].outputId`,
          ),
          outputDigest: digest(
            required(output, 'outputDigest', path),
            `${path}.outputRefs[${index}].outputDigest`,
          ),
        };
      },
    ),
  };
};

export const decodeActionAuditEventV1 = (
  value: unknown,
  path = 'auditEvent',
): ActionAuditEventV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'auditEventId',
      'actionId',
      'sequence',
      'category',
      'eventJson',
      'occurredAt',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    auditEventId: text(required(object, 'auditEventId', path), `${path}.auditEventId`),
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
    sequence: positiveInteger(required(object, 'sequence', path), `${path}.sequence`),
    category: enumValue(
      required(object, 'category', path),
      [
        'ACTION_CANDIDATE_VALIDATED',
        'RISK_DECIDED',
        'MANIFEST_PREPARED',
        'MANIFEST_CHANGED',
        'APPROVAL_ISSUED',
        'APPROVAL_EXPIRED',
        'PREFLIGHT_PASSED',
        'PREFLIGHT_FAILED',
        'EXECUTION_STARTED',
        'EXECUTION_ATTEMPT_RECORDED',
        'EXECUTION_VERIFIED',
        'EXECUTION_VERIFICATION_FAILED',
        'EXECUTION_FAILED',
        'EXECUTION_OUTCOME_UNKNOWN',
        'ACTION_CANCELLED',
        'ACTION_ROLLED_BACK',
        'COMPENSATION_REQUIRED',
        'COMPENSATION_PREPARED',
        'COMPENSATION_VERIFIED',
        'RESULT_RECORDED',
        'ACCESS_RESTRICTED',
      ],
      `${path}.category`,
    ),
    eventJson: text(required(object, 'eventJson', path), `${path}.eventJson`),
    occurredAt: isoTimestamp(required(object, 'occurredAt', path), `${path}.occurredAt`),
  };
};

export const decodeCompensatingActionV1 = (
  value: unknown,
  path = 'compensation',
): CompensatingActionV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'compensationId',
      'actionId',
      'sourceActionId',
      'sourceExecutionId',
      'candidateRef',
      'status',
      'preparedAt',
      'preparedBy',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    compensationId: text(required(object, 'compensationId', path), `${path}.compensationId`),
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
    sourceActionId: text(required(object, 'sourceActionId', path), `${path}.sourceActionId`),
    sourceExecutionId: text(
      required(object, 'sourceExecutionId', path),
      `${path}.sourceExecutionId`,
    ),
    candidateRef: decodeIdentityRef(required(object, 'candidateRef', path), `${path}.candidateRef`),
    status: enumValue(
      required(object, 'status', path),
      EXTERNAL_ACTION_AGGREGATE_STATUSES,
      `${path}.status`,
    ),
    preparedAt: isoTimestamp(required(object, 'preparedAt', path), `${path}.preparedAt`),
    preparedBy: decodeActor(required(object, 'preparedBy', path), `${path}.preparedBy`),
  };
};

export const decodeRollbackV1 = (value: unknown, path = 'rollback'): RollbackV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'rollbackId',
      'actionId',
      'status',
      'manifestRef',
      'approvalRef',
      'executionRef',
      'verificationRef',
      'updatedAt',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    rollbackId: text(required(object, 'rollbackId', path), `${path}.rollbackId`),
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
    status: enumValue(
      required(object, 'status', path),
      [
        'NOT_AVAILABLE',
        'PREPARED',
        'APPROVED',
        'EXECUTING',
        'ROLLED_BACK',
        'FAILED',
        'OUTCOME_UNKNOWN',
      ],
      `${path}.status`,
    ),
    manifestRef: decodeOptionalRef(object.manifestRef, `${path}.manifestRef`, (v, p) =>
      decodeIdentityRef(v, p),
    ),
    approvalRef: decodeOptionalRef(object.approvalRef, `${path}.approvalRef`, (v, p) =>
      decodeIdentityRef(v, p),
    ),
    executionRef: decodeOptionalRef(object.executionRef, `${path}.executionRef`, (v, p) =>
      decodeIdentityRef(v, p),
    ),
    verificationRef: decodeOptionalRef(object.verificationRef, `${path}.verificationRef`, (v, p) =>
      decodeIdentityRef(v, p),
    ),
    updatedAt: isoTimestamp(required(object, 'updatedAt', path), `${path}.updatedAt`),
  };
};

export const decodeActionCandidateV1 = (value: unknown, path = 'candidate'): ActionCandidateV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'candidateId',
      'candidateRevision',
      'actionId',
      'sourceRefs',
      'operation',
      'targetRef',
      'parameterRef',
      'evidenceRefs',
      'compensationForActionId',
      'candidateDigest',
      'riskDecisionRef',
      'generatedAt',
      'generatedBy',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    candidateId: text(required(object, 'candidateId', path), `${path}.candidateId`),
    candidateRevision: positiveInteger(
      required(object, 'candidateRevision', path),
      `${path}.candidateRevision`,
    ),
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
    sourceRefs: arrayValue(required(object, 'sourceRefs', path), `${path}.sourceRefs`).map(
      (entry, index) => {
        const source = strictObject(
          entry,
          ['schemaVersion', 'sourceKind', 'sourceId', 'sourceRevision', 'sourceDigest'],
          `${path}.sourceRefs[${index}]`,
        );
        decodeSchemaVersion(source, `${path}.sourceRefs[${index}]`);
        return {
          schemaVersion: '1.0.0' as const,
          sourceKind: text(
            required(source, 'sourceKind', path),
            `${path}.sourceRefs[${index}].sourceKind`,
          ),
          sourceId: text(
            required(source, 'sourceId', path),
            `${path}.sourceRefs[${index}].sourceId`,
          ),
          sourceRevision: text(
            required(source, 'sourceRevision', path),
            `${path}.sourceRefs[${index}].sourceRevision`,
          ),
          sourceDigest: digest(
            required(source, 'sourceDigest', path),
            `${path}.sourceRefs[${index}].sourceDigest`,
          ),
        };
      },
    ),
    operation: enumValue(
      required(object, 'operation', path),
      EXTERNAL_ACTION_OPERATIONS,
      `${path}.operation`,
    ),
    targetRef: decodeIdentityRef(required(object, 'targetRef', path), `${path}.targetRef`),
    parameterRef: decodeParameterRef(
      required(object, 'parameterRef', path),
      `${path}.parameterRef`,
    ),
    evidenceRefs: arrayValue(required(object, 'evidenceRefs', path), `${path}.evidenceRefs`).map(
      (entry, index) => decodeEvidenceSetRef(entry, `${path}.evidenceRefs[${index}]`),
    ),
    compensationForActionId: optionalText(
      object.compensationForActionId,
      `${path}.compensationForActionId`,
    ),
    candidateDigest: digest(required(object, 'candidateDigest', path), `${path}.candidateDigest`),
    riskDecisionRef: decodeIdentityRef(
      required(object, 'riskDecisionRef', path),
      `${path}.riskDecisionRef`,
    ),
    generatedAt: isoTimestamp(required(object, 'generatedAt', path), `${path}.generatedAt`),
    generatedBy: decodeActor(required(object, 'generatedBy', path), `${path}.generatedBy`),
  };
};

export const decodeListExternalActionsRequestV1 = (
  value: unknown,
  path = 'request',
): ListExternalActionsRequestV1 => {
  const object = strictObject(
    value,
    ['schemaVersion', 'pageSize', 'cursor', 'targetKinds', 'statuses'],
    path,
  );
  decodeSchemaVersion(object, path);
  const pageSize = integer(required(object, 'pageSize', path), `${path}.pageSize`);
  if (pageSize > EXTERNAL_ACTION_QUEUE_PAGE_SIZE_CAP) {
    return fail(`${path}.pageSize`, `must not exceed ${EXTERNAL_ACTION_QUEUE_PAGE_SIZE_CAP}`);
  }
  return {
    schemaVersion: '1.0.0',
    pageSize,
    cursor: optionalText(object.cursor, `${path}.cursor`),
    targetKinds:
      object.targetKinds === undefined
        ? undefined
        : arrayValue(object.targetKinds, `${path}.targetKinds`).map((entry, index) =>
            enumValue(entry, ['KNOWN_TARGET'], `${path}.targetKinds[${index}]`),
          ),
    statuses:
      object.statuses === undefined
        ? undefined
        : arrayValue(object.statuses, `${path}.statuses`).map((entry, index) =>
            enumValue(entry, EXTERNAL_ACTION_AGGREGATE_STATUSES, `${path}.statuses[${index}]`),
          ),
  };
};

export const decodeValidateActionCandidateRequestV1 = (
  value: unknown,
  path = 'request',
): ValidateActionCandidateRequestV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'clientRequestId',
      'idempotencyKey',
      'actionId',
      'candidateId',
      'operation',
      'targetRef',
      'parameterRef',
      'evidenceRefs',
      'compensationForActionId',
      'reason',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    clientRequestId: text(required(object, 'clientRequestId', path), `${path}.clientRequestId`),
    idempotencyKey: text(required(object, 'idempotencyKey', path), `${path}.idempotencyKey`),
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
    candidateId: text(required(object, 'candidateId', path), `${path}.candidateId`),
    operation: enumValue(
      required(object, 'operation', path),
      EXTERNAL_ACTION_OPERATIONS,
      `${path}.operation`,
    ),
    targetRef: decodeIdentityRef(required(object, 'targetRef', path), `${path}.targetRef`),
    parameterRef: decodeParameterRef(
      required(object, 'parameterRef', path),
      `${path}.parameterRef`,
    ),
    evidenceRefs: arrayValue(required(object, 'evidenceRefs', path), `${path}.evidenceRefs`).map(
      (entry, index) => decodeEvidenceSetRef(entry, `${path}.evidenceRefs[${index}]`),
    ),
    compensationForActionId: optionalText(
      object.compensationForActionId,
      `${path}.compensationForActionId`,
    ),
    reason: optionalText(object.reason, `${path}.reason`),
  };
};

/** All FE-P4-S2 command types (shared with the failure registry). */
export const FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES_ALL: readonly FrontendExternalActionCommandType[] =
  [
    FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.validateCandidate,
    FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.prepareManifest,
    FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.approve,
    FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.preflight,
    FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.execute,
    FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.retryAttempt,
    FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.verify,
    FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.cancel,
    FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.rollback,
    FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.prepareCompensation,
    FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.resolveOutcome,
  ];

/** Widen helper so FE-P4-S2 command types can be typed as generic commands. */
export const isExternalActionCommandType = (commandType: string): boolean =>
  (FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES_ALL as readonly string[]).includes(commandType);
