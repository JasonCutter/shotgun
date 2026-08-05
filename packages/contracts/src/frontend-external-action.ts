import { FrontendContractError } from './frontend-foundation.js';
import { sha256Text, stableJson } from './document-evidence.js';

/**
 * FE-P4-S2 External Action Governance and Execution — exact V1 contracts.
 *
 * Frozen by FE-P4-S2 Contract Snapshot revision 1 (approved 2026-08-05) and
 * ADR-129 (accepted 2026-08-05). Every type carries schemaVersion '1.0.0',
 * decoders reject unknown fields, empty/whitespace-only IDs, unknown
 * discriminants, and never use `any`. Cross-field invariants are enforced by
 * the decoders (Project binding, digest consistency, approval expiry/status,
 * READY preflight revalidation, execution/attempt ordering and terminal
 * timestamps, verification observed-digest rules, and the access-restricted
 * shell).
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

export type ExternalActionAggregateReadinessV1 =
  'AVAILABLE' | 'STALE' | 'ACCESS_RESTRICTED' | 'UNAVAILABLE';

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
  | 'READ_CREDENTIAL'
  | 'READ_BUDGET'
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

/** Frozen 12-category audit set (Contract Snapshot §2.10, Stage 11 parity). */
export type ExternalActionAuditCategoryV1 =
  | 'ACTION_CANDIDATE_VALIDATED'
  | 'ACTION_RISK_DECIDED'
  | 'ACTION_PREVIEW_READY'
  | 'ACTION_APPROVED'
  | 'ACTION_EXECUTION_CLAIMED'
  | 'ACTION_PREFLIGHT_PASSED'
  | 'ACTION_PREFLIGHT_FAILED'
  | 'ACTION_EXECUTED'
  | 'ACTION_OUTCOME_UNKNOWN'
  | 'ACTION_FAILED'
  | 'ACTION_VERIFIED'
  | 'ACTION_VERIFICATION_FAILED';

export const EXTERNAL_ACTION_AUDIT_CATEGORIES: readonly ExternalActionAuditCategoryV1[] = [
  'ACTION_CANDIDATE_VALIDATED',
  'ACTION_RISK_DECIDED',
  'ACTION_PREVIEW_READY',
  'ACTION_APPROVED',
  'ACTION_EXECUTION_CLAIMED',
  'ACTION_PREFLIGHT_PASSED',
  'ACTION_PREFLIGHT_FAILED',
  'ACTION_EXECUTED',
  'ACTION_OUTCOME_UNKNOWN',
  'ACTION_FAILED',
  'ACTION_VERIFIED',
  'ACTION_VERIFICATION_FAILED',
];

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

/** Target identity (the external target the action acts on). */
export type ExternalActionTargetRefV1 = {
  readonly schemaVersion: '1.0.0';
  readonly targetKind: ExternalActionTargetKindV1;
  readonly targetId: string;
  readonly targetRevision: string;
  readonly externalRevision: string;
};

/** Typed Product resource reference (resource kind + id + optional revision). */
export type ExternalActionResourceRefV1 = {
  readonly schemaVersion: '1.0.0';
  readonly resourceKind:
    | 'candidate'
    | 'riskDecision'
    | 'manifest'
    | 'approval'
    | 'preflight'
    | 'execution'
    | 'attempt'
    | 'verification'
    | 'result'
    | 'compensation'
    | 'rollback'
    | 'provider';
  readonly resourceId: string;
  readonly resourceRevision?: number;
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

/**
 * ExternalActionV1 — the `EXTERNAL_ACTION` Operational Resource aggregate.
 * When `aggregateState` is `ACCESS_RESTRICTED` or `accessMasking` is `HIDDEN`
 * the protected payload (target identity, revisions, manifest/risk/approval
 * refs) is absent: this is the discriminated restricted shell (AC-17) and no
 * hidden identity is carried.
 */
export type ExternalActionV1 = {
  readonly schemaVersion: '1.0.0';
  readonly actionId: string;
  readonly actionRevision: number;
  readonly operation: ExternalActionOperationV1;
  readonly resourceProjectId: string;
  readonly effectiveProjectId: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly status: ExternalActionAggregateStatusV1;
  readonly aggregateState: ExternalActionAggregateReadinessV1;
  readonly staleReason?: string;
  readonly accessMasking: ExternalActionAccessMaskingStateV1;
  readonly maskedFields: readonly string[];
  readonly capabilities: readonly ExternalActionCapabilityV1[];
  readonly updatedAt: string;
  readonly createdAt: string;
  // Protected payload (present only when not restricted/hidden).
  readonly targetRef?: ExternalActionTargetRefV1;
  readonly riskDecisionRef?: ExternalActionResourceRefV1;
  readonly manifestRef?: ExternalActionResourceRefV1;
  readonly approvalRef?: ExternalActionResourceRefV1;
  readonly latestExecutionRef?: ExternalActionResourceRefV1;
  readonly compensationForActionId?: string;
};

export type ActionCandidateV1 = {
  readonly schemaVersion: '1.0.0';
  readonly candidateId: string;
  readonly candidateRevision: number;
  readonly actionId: string;
  readonly resourceProjectId: string;
  readonly effectiveProjectId: string;
  readonly sourceRefs: readonly {
    readonly schemaVersion: '1.0.0';
    readonly sourceKind: string;
    readonly sourceId: string;
    readonly sourceRevision: string;
    readonly sourceDigest: string;
  }[];
  readonly operation: ExternalActionOperationV1;
  readonly targetRef: ExternalActionTargetRefV1;
  readonly parameterRef: ExternalActionParameterRefV1;
  readonly evidenceRefs: readonly ExternalActionEvidenceSetRefV1[];
  readonly compensationForActionId?: string;
  readonly candidateDigest: string;
  readonly riskDecisionRef: ExternalActionResourceRefV1;
  readonly generatedAt: string;
  readonly generatedBy: ExternalActionActorV1;
};

export type RiskDecisionV1 = {
  readonly schemaVersion: '1.0.0';
  readonly riskDecisionId: string;
  readonly actionId: string;
  readonly resourceProjectId: string;
  readonly effectiveProjectId: string;
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
  readonly resourceProjectId: string;
  readonly effectiveProjectId: string;
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
  readonly resourceProjectId: string;
  readonly effectiveProjectId: string;
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
  readonly resourceProjectId: string;
  readonly effectiveProjectId: string;
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
  readonly resourceProjectId: string;
  readonly effectiveProjectId: string;
  readonly manifestRevision: number;
  readonly status: ExecutionAttemptStatusV1;
  readonly attemptCount: number;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly latestAttemptRef?: ExternalActionResourceRefV1;
};

export type ExecutionAttemptV1 = {
  readonly schemaVersion: '1.0.0';
  readonly attemptId: string;
  readonly attemptNumber: number;
  readonly executionId: string;
  readonly actionId: string;
  readonly resourceProjectId: string;
  readonly effectiveProjectId: string;
  readonly idempotencyKey: string;
  readonly status: ExecutionAttemptStatusV1;
  readonly policyContextRevision: string;
  readonly externalRevision: string;
  readonly providerRef?: ExternalActionResourceRefV1;
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
  readonly resourceProjectId: string;
  readonly effectiveProjectId: string;
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
  readonly resourceProjectId: string;
  readonly effectiveProjectId: string;
  readonly executionId: string;
  readonly attemptId?: string;
  readonly externalId: string;
  readonly observedDigest: string;
  readonly completedAt: string;
  readonly verificationRef?: ExternalActionResourceRefV1;
  readonly outputRefs: readonly {
    readonly schemaVersion: '1.0.0';
    readonly outputKind: string;
    readonly outputId: string;
    readonly outputDigest: string;
  }[];
};

/** Structurally safe audit payload — allowlisted fields only (no raw payload). */
export type ActionAuditEventDataV1 = {
  readonly schemaVersion: '1.0.0';
  readonly message: string;
  readonly refs: readonly ExternalActionResourceRefV1[];
};

export type ActionAuditEventV1 = {
  readonly schemaVersion: '1.0.0';
  readonly auditEventId: string;
  readonly actionId: string;
  readonly resourceProjectId: string;
  readonly effectiveProjectId: string;
  readonly sequence: number;
  readonly category: ExternalActionAuditCategoryV1;
  readonly eventData: ActionAuditEventDataV1;
  readonly occurredAt: string;
};

export type CompensatingActionV1 = {
  readonly schemaVersion: '1.0.0';
  readonly compensationId: string;
  readonly actionId: string;
  readonly resourceProjectId: string;
  readonly effectiveProjectId: string;
  readonly sourceActionId: string;
  readonly sourceExecutionId: string;
  readonly candidateRef: ExternalActionResourceRefV1;
  readonly status: ExternalActionAggregateStatusV1;
  readonly preparedAt: string;
  readonly preparedBy: ExternalActionActorV1;
};

export type RollbackV1 = {
  readonly schemaVersion: '1.0.0';
  readonly rollbackId: string;
  readonly actionId: string;
  readonly resourceProjectId: string;
  readonly effectiveProjectId: string;
  readonly status:
    | 'NOT_AVAILABLE'
    | 'PREPARED'
    | 'APPROVED'
    | 'EXECUTING'
    | 'ROLLED_BACK'
    | 'FAILED'
    | 'OUTCOME_UNKNOWN';
  readonly manifestRef?: ExternalActionResourceRefV1;
  readonly approvalRef?: ExternalActionResourceRefV1;
  readonly executionRef?: ExternalActionResourceRefV1;
  readonly verificationRef?: ExternalActionResourceRefV1;
  readonly updatedAt: string;
};

// ---------------------------------------------------------------------------
// Credential and budget Product views (AC-13 / AC-14 contract layer)
// ---------------------------------------------------------------------------

export type ExternalActionCredentialViewV1 = {
  readonly schemaVersion: '1.0.0';
  readonly connectorId: string;
  readonly name: string;
  readonly status: 'CONFIGURED' | 'MISSING' | 'REVOKED' | 'ROTATION_REQUIRED';
  readonly maskedCredential?: string;
  readonly capabilities: readonly ('TEST' | 'ROTATE' | 'REVOKE')[];
};

export type ExternalActionBudgetViewV1 = {
  readonly schemaVersion: '1.0.0';
  readonly projectId: string;
  readonly status: 'OK' | 'WARNING' | 'EXHAUSTED';
  readonly usedExecutions: number;
  readonly remainingExecutions: number;
  readonly softLimit: number;
  readonly hardLimit: number;
  readonly exhausted: boolean;
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
  readonly resourceProjectId: string;
  readonly effectiveProjectId: string;
  readonly status: ExternalActionAggregateStatusV1;
  readonly aggregateState: ExternalActionAggregateReadinessV1;
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

// Frozen individual Read Operations (Contract Snapshot §9): each approved
// resource read is its own operation and cannot be replaced by the integrated
// detail endpoint.

export type GetActionManifestRequestV1 = {
  readonly schemaVersion: '1.0.0';
  readonly actionId: string;
};

export type GetActionManifestResultV1 = {
  readonly schemaVersion: '1.0.0';
  readonly manifest: ActionManifestV1;
};

export type GetRiskDecisionRequestV1 = {
  readonly schemaVersion: '1.0.0';
  readonly actionId: string;
};

export type GetRiskDecisionResultV1 = {
  readonly schemaVersion: '1.0.0';
  readonly riskDecision: RiskDecisionV1;
};

export type GetPreflightRequestV1 = {
  readonly schemaVersion: '1.0.0';
  readonly actionId: string;
};

export type GetPreflightResultV1 = {
  readonly schemaVersion: '1.0.0';
  readonly preflight: PreflightV1;
};

// FE-P4-S2 WP4 additive approval read (Implementation Request lists an
// approvals read under /product-api/frontend/external-action/*; Review
// 4863146027 resolution recorded in the report).
export type GetExternalActionApprovalRequestV1 = {
  readonly schemaVersion: '1.0.0';
  readonly actionId: string;
};

export type GetExternalActionApprovalResultV1 = {
  readonly schemaVersion: '1.0.0';
  readonly approval: ExternalActionApprovalV1;
};

export type GetExecutionRequestV1 = {
  readonly schemaVersion: '1.0.0';
  readonly actionId: string;
};

export type GetExecutionResultV1 = {
  readonly schemaVersion: '1.0.0';
  readonly execution: ExecutionV1;
};

export type GetExecutionAttemptsRequestV1 = {
  readonly schemaVersion: '1.0.0';
  readonly actionId: string;
  readonly cursor?: string;
  readonly pageSize: number;
};

export type GetExecutionAttemptsResultV1 = {
  readonly schemaVersion: '1.0.0';
  readonly attempts: readonly ExecutionAttemptV1[];
  readonly nextCursor?: string;
};

export type GetVerificationRequestV1 = {
  readonly schemaVersion: '1.0.0';
  readonly actionId: string;
};

export type GetVerificationResultV1 = {
  readonly schemaVersion: '1.0.0';
  readonly verification: VerificationV1;
};

export type GetActionResultRequestV1 = {
  readonly schemaVersion: '1.0.0';
  readonly actionId: string;
};

export type GetActionResultResultV1 = {
  readonly schemaVersion: '1.0.0';
  readonly result: ResultV1;
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
  readonly credential?: ExternalActionCredentialViewV1;
  readonly budget?: ExternalActionBudgetViewV1;
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
  readonly targetRef: ExternalActionTargetRefV1;
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

/** Resolved governed-command result, dispatched by commandType through the
 * corresponding strict result decoder. No raw/unknown payload passes. */
export type ResolvedCommandResultV1 =
  | {
      readonly commandType: 'frontend.external-action.validate-candidate.v1';
      readonly result: ValidateActionCandidateResultV1;
    }
  | {
      readonly commandType: 'frontend.external-action.prepare-manifest.v1';
      readonly result: PrepareActionManifestResultV1;
    }
  | {
      readonly commandType: 'frontend.external-action.approve.v1';
      readonly result: ApproveExternalActionResultV1;
    }
  | {
      readonly commandType: 'frontend.external-action.preflight.v1';
      readonly result: PreflightExternalActionResultV1;
    }
  | {
      readonly commandType: 'frontend.external-action.execute.v1';
      readonly result: ExecuteExternalActionResultV1;
    }
  | {
      readonly commandType: 'frontend.external-action.retry-attempt.v1';
      readonly result: RetryExecutionAttemptResultV1;
    }
  | {
      readonly commandType: 'frontend.external-action.verify.v1';
      readonly result: VerifyExternalActionResultV1;
    }
  | {
      readonly commandType: 'frontend.external-action.cancel.v1';
      readonly result: CancelExternalActionResultV1;
    }
  | {
      readonly commandType: 'frontend.external-action.rollback.v1';
      readonly result: RollbackExternalActionResultV1;
    }
  | {
      readonly commandType: 'frontend.external-action.prepare-compensation.v1';
      readonly result: PrepareCompensatingActionResultV1;
    };

export type ResolveExternalActionOutcomeResultV1 = {
  readonly schemaVersion: '1.0.0';
  readonly outcome: 'COMPLETED' | 'REJECTED' | 'OUTCOME_UNKNOWN';
  readonly originalClientRequestId: string;
  readonly originalIdempotencyKey: string;
  readonly completed?: ResolvedCommandResultV1;
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

const assertNotAfter = (earlier: string, later: string, path: string): void => {
  if (Date.parse(later) < Date.parse(earlier)) {
    return fail(path, 'timestamp ordering is violated');
  }
};

const decodeProjectBinding = (
  object: ObjectValue,
  path: string,
): { resourceProjectId: string; effectiveProjectId: string } => ({
  resourceProjectId: text(required(object, 'resourceProjectId', path), `${path}.resourceProjectId`),
  effectiveProjectId: text(
    required(object, 'effectiveProjectId', path),
    `${path}.effectiveProjectId`,
  ),
});

const EXTERNAL_ACTION_RESOURCE_KINDS = [
  'candidate',
  'riskDecision',
  'manifest',
  'approval',
  'preflight',
  'execution',
  'attempt',
  'verification',
  'result',
  'compensation',
  'rollback',
  'provider',
] as const;

const decodeResourceRef = (value: unknown, path: string): ExternalActionResourceRefV1 => {
  const object = strictObject(
    value,
    ['schemaVersion', 'resourceKind', 'resourceId', 'resourceRevision'],
    path,
  );
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    resourceKind: enumValue(
      required(object, 'resourceKind', path),
      EXTERNAL_ACTION_RESOURCE_KINDS,
      `${path}.resourceKind`,
    ),
    resourceId: text(required(object, 'resourceId', path), `${path}.resourceId`),
    resourceRevision:
      object.resourceRevision === undefined
        ? undefined
        : positiveInteger(object.resourceRevision, `${path}.resourceRevision`),
  };
};

const decodeTargetRef = (value: unknown, path: string): ExternalActionTargetRefV1 => {
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

const decodeOptionalResourceRef = (
  value: unknown,
  path: string,
): ExternalActionResourceRefV1 | undefined =>
  value === undefined ? undefined : decodeResourceRef(value, path);

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
  'READ_CREDENTIAL',
  'READ_BUDGET',
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

const TERMINAL_ATTEMPT_STATUSES: readonly ExecutionAttemptStatusV1[] = [
  'SUCCEEDED',
  'FAILED',
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

// ---------------------------------------------------------------------------
// Resource decoders with cross-field invariants
// ---------------------------------------------------------------------------

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
      'operation',
      'resourceProjectId',
      'effectiveProjectId',
      'accessRevision',
      'policyContextRevision',
      'status',
      'aggregateState',
      'staleReason',
      'accessMasking',
      'maskedFields',
      'capabilities',
      'updatedAt',
      'createdAt',
      'targetRef',
      'riskDecisionRef',
      'manifestRef',
      'approvalRef',
      'latestExecutionRef',
      'compensationForActionId',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  const binding = decodeProjectBinding(object, path);
  const aggregateState = enumValue(
    required(object, 'aggregateState', path),
    ['AVAILABLE', 'STALE', 'ACCESS_RESTRICTED', 'UNAVAILABLE'],
    `${path}.aggregateState`,
  );
  const accessMasking = enumValue(
    required(object, 'accessMasking', path),
    ['VISIBLE', 'MASKED', 'HIDDEN'],
    `${path}.accessMasking`,
  );
  const restricted = aggregateState === 'ACCESS_RESTRICTED' || accessMasking === 'HIDDEN';
  const common = {
    schemaVersion: '1.0.0' as const,
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
    actionRevision: positiveInteger(
      required(object, 'actionRevision', path),
      `${path}.actionRevision`,
    ),
    operation: enumValue(
      required(object, 'operation', path),
      EXTERNAL_ACTION_OPERATIONS,
      `${path}.operation`,
    ),
    ...binding,
    accessRevision: text(required(object, 'accessRevision', path), `${path}.accessRevision`),
    policyContextRevision: text(
      required(object, 'policyContextRevision', path),
      `${path}.policyContextRevision`,
    ),
    status: enumValue(
      required(object, 'status', path),
      EXTERNAL_ACTION_AGGREGATE_STATUSES,
      `${path}.status`,
    ),
    aggregateState,
    staleReason: optionalText(object.staleReason, `${path}.staleReason`),
    accessMasking,
    maskedFields: arrayValue(required(object, 'maskedFields', path), `${path}.maskedFields`).map(
      (entry, index) => text(entry, `${path}.maskedFields[${index}]`),
    ),
    capabilities: arrayValue(required(object, 'capabilities', path), `${path}.capabilities`).map(
      (entry, index) =>
        enumValue(entry, EXTERNAL_ACTION_CAPABILITIES, `${path}.capabilities[${index}]`),
    ),
    updatedAt: isoTimestamp(required(object, 'updatedAt', path), `${path}.updatedAt`),
    createdAt: isoTimestamp(required(object, 'createdAt', path), `${path}.createdAt`),
  };
  if (restricted) {
    // Discriminated restricted shell (AC-17): no protected identity is carried.
    for (const key of [
      'targetRef',
      'riskDecisionRef',
      'manifestRef',
      'approvalRef',
      'latestExecutionRef',
      'compensationForActionId',
    ]) {
      if (object[key] !== undefined) {
        return fail(`${path}.${key}`, 'must be absent in an access-restricted shell');
      }
    }
    return common;
  }
  return {
    ...common,
    targetRef: decodeTargetRef(required(object, 'targetRef', path), `${path}.targetRef`),
    riskDecisionRef: decodeResourceRef(
      required(object, 'riskDecisionRef', path),
      `${path}.riskDecisionRef`,
    ),
    manifestRef: decodeResourceRef(required(object, 'manifestRef', path), `${path}.manifestRef`),
    approvalRef: decodeOptionalResourceRef(object.approvalRef, `${path}.approvalRef`),
    latestExecutionRef: decodeOptionalResourceRef(
      object.latestExecutionRef,
      `${path}.latestExecutionRef`,
    ),
    compensationForActionId: optionalText(
      object.compensationForActionId,
      `${path}.compensationForActionId`,
    ),
  };
};

export const decodeRiskDecisionV1 = (value: unknown, path = 'riskDecision'): RiskDecisionV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'riskDecisionId',
      'actionId',
      'resourceProjectId',
      'effectiveProjectId',
      'riskLevel',
      'policyVersion',
      'requiresUserApproval',
      'reasons',
      'decidedAt',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  const binding = decodeProjectBinding(object, path);
  return {
    schemaVersion: '1.0.0',
    riskDecisionId: text(required(object, 'riskDecisionId', path), `${path}.riskDecisionId`),
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
    ...binding,
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
      'resourceProjectId',
      'effectiveProjectId',
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
  const binding = decodeProjectBinding(object, path);
  const parameterRef = decodeParameterRef(
    required(object, 'parameterRef', path),
    `${path}.parameterRef`,
  );
  const parameterDigest = digest(
    required(object, 'parameterDigest', path),
    `${path}.parameterDigest`,
  );
  const evidenceSetRef = decodeEvidenceSetRef(
    required(object, 'evidenceSetRef', path),
    `${path}.evidenceSetRef`,
  );
  const evidenceSetDigest = digest(
    required(object, 'evidenceSetDigest', path),
    `${path}.evidenceSetDigest`,
  );
  const createdAt = isoTimestamp(required(object, 'createdAt', path), `${path}.createdAt`);
  const expiresAt = isoTimestamp(required(object, 'expiresAt', path), `${path}.expiresAt`);
  assertNotAfter(createdAt, expiresAt, path);
  // Cross-field digest consistency.
  if (parameterDigest !== parameterRef.parameterDigest) {
    return fail(`${path}.parameterDigest`, 'does not match the parameter reference digest');
  }
  if (evidenceSetDigest !== evidenceSetRef.evidenceSetDigest) {
    return fail(`${path}.evidenceSetDigest`, 'does not match the evidence set reference digest');
  }
  const manifest: ActionManifestV1 = {
    schemaVersion: '1.0.0',
    manifestId: text(required(object, 'manifestId', path), `${path}.manifestId`),
    manifestRevision: positiveInteger(
      required(object, 'manifestRevision', path),
      `${path}.manifestRevision`,
    ),
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
    ...binding,
    targetId: text(required(object, 'targetId', path), `${path}.targetId`),
    targetRevision: text(required(object, 'targetRevision', path), `${path}.targetRevision`),
    targetDigest: digest(required(object, 'targetDigest', path), `${path}.targetDigest`),
    externalRevision: text(required(object, 'externalRevision', path), `${path}.externalRevision`),
    parameterRef,
    parameterDigest,
    evidenceSetRef,
    evidenceSetDigest,
    payloadDigest: digest(required(object, 'payloadDigest', path), `${path}.payloadDigest`),
    manifestDigest: digest(required(object, 'manifestDigest', path), `${path}.manifestDigest`),
    expiresAt,
    createdAt,
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
      'resourceProjectId',
      'effectiveProjectId',
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
  const binding = decodeProjectBinding(object, path);
  const status = enumValue(required(object, 'status', path), APPROVAL_STATUSES, `${path}.status`);
  const issuedAt = isoTimestamp(required(object, 'issuedAt', path), `${path}.issuedAt`);
  const expiresAt = isoTimestamp(required(object, 'expiresAt', path), `${path}.expiresAt`);
  assertNotAfter(issuedAt, expiresAt, path);
  if (status === 'ACTIVE' && Date.parse(expiresAt) <= Date.parse(issuedAt)) {
    return fail(`${path}.expiresAt`, 'an ACTIVE approval must have a future expiry');
  }
  return {
    schemaVersion: '1.0.0',
    approvalId: text(required(object, 'approvalId', path), `${path}.approvalId`),
    purpose: enumValue(required(object, 'purpose', path), ['EXTERNAL_ACTION'], `${path}.purpose`),
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
    ...binding,
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
    issuedAt,
    expiresAt,
    status,
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
      'resourceProjectId',
      'effectiveProjectId',
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
  const binding = decodeProjectBinding(object, path);
  const status = enumValue(required(object, 'status', path), PREFLIGHT_STATUSES, `${path}.status`);
  const runAt = isoTimestamp(required(object, 'runAt', path), `${path}.runAt`);
  const expiresAt = isoTimestamp(required(object, 'expiresAt', path), `${path}.expiresAt`);
  assertNotAfter(runAt, expiresAt, path);
  const permissionRevalidated = booleanValue(
    required(object, 'permissionRevalidated', path),
    `${path}.permissionRevalidated`,
  );
  const credentialRevalidated = booleanValue(
    required(object, 'credentialRevalidated', path),
    `${path}.credentialRevalidated`,
  );
  const budgetRevalidated = booleanValue(
    required(object, 'budgetRevalidated', path),
    `${path}.budgetRevalidated`,
  );
  const policyRevalidated = booleanValue(
    required(object, 'policyRevalidated', path),
    `${path}.policyRevalidated`,
  );
  const targetStateRevalidated = booleanValue(
    required(object, 'targetStateRevalidated', path),
    `${path}.targetStateRevalidated`,
  );
  const externalRevisionRevalidated = booleanValue(
    required(object, 'externalRevisionRevalidated', path),
    `${path}.externalRevisionRevalidated`,
  );
  if (
    status === 'READY' &&
    !(
      permissionRevalidated &&
      credentialRevalidated &&
      budgetRevalidated &&
      policyRevalidated &&
      targetStateRevalidated &&
      externalRevisionRevalidated
    )
  ) {
    return fail(`${path}.status`, 'a READY Preflight requires all six revalidations to pass');
  }
  if (status === 'READY' && Date.parse(expiresAt) <= Date.parse(runAt)) {
    return fail(`${path}.expiresAt`, 'a READY Preflight must have a future expiry');
  }
  return {
    schemaVersion: '1.0.0',
    preflightId: text(required(object, 'preflightId', path), `${path}.preflightId`),
    concreteKind: 'PREFLIGHT',
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
    ...binding,
    manifestRevision: positiveInteger(
      required(object, 'manifestRevision', path),
      `${path}.manifestRevision`,
    ),
    preflightDigest: digest(required(object, 'preflightDigest', path), `${path}.preflightDigest`),
    status,
    reasons: arrayValue(required(object, 'reasons', path), `${path}.reasons`).map((entry, index) =>
      text(entry, `${path}.reasons[${index}]`),
    ),
    permissionRevalidated,
    credentialRevalidated,
    budgetRevalidated,
    policyRevalidated,
    targetStateRevalidated,
    externalRevisionRevalidated,
    runAt,
    expiresAt,
  };
};

const decodeAttemptTimestamps = (
  object: ObjectValue,
  path: string,
  status: ExecutionAttemptStatusV1,
  startedAtValue: unknown,
  completedAtValue: unknown,
): { startedAt: string; completedAt?: string } => {
  const startedAt = isoTimestamp(startedAtValue, `${path}.startedAt`);
  const completedAt =
    completedAtValue === undefined
      ? undefined
      : isoTimestamp(completedAtValue, `${path}.completedAt`);
  const terminal = TERMINAL_ATTEMPT_STATUSES.includes(status);
  if (terminal && completedAt === undefined) {
    return fail(`${path}.completedAt`, 'a terminal attempt requires a completedAt timestamp');
  }
  if (!terminal && completedAt !== undefined) {
    return fail(`${path}.completedAt`, 'a non-terminal attempt must not have completedAt');
  }
  if (completedAt !== undefined) assertNotAfter(startedAt, completedAt, path);
  return { startedAt, completedAt };
};

export const decodeExecutionV1 = (value: unknown, path = 'execution'): ExecutionV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'executionId',
      'concreteKind',
      'actionId',
      'resourceProjectId',
      'effectiveProjectId',
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
  const binding = decodeProjectBinding(object, path);
  const status = enumValue(
    required(object, 'status', path),
    EXTERNAL_ACTION_ATTEMPT_STATUSES,
    `${path}.status`,
  );
  const attemptCount = integer(required(object, 'attemptCount', path), `${path}.attemptCount`);
  const { startedAt, completedAt } = decodeAttemptTimestamps(
    object,
    path,
    status,
    required(object, 'startedAt', path),
    object.completedAt,
  );
  return {
    schemaVersion: '1.0.0',
    executionId: text(required(object, 'executionId', path), `${path}.executionId`),
    concreteKind: 'EXECUTION',
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
    ...binding,
    manifestRevision: positiveInteger(
      required(object, 'manifestRevision', path),
      `${path}.manifestRevision`,
    ),
    status,
    attemptCount,
    startedAt,
    completedAt,
    latestAttemptRef: decodeOptionalResourceRef(
      object.latestAttemptRef,
      `${path}.latestAttemptRef`,
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
      'resourceProjectId',
      'effectiveProjectId',
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
  const binding = decodeProjectBinding(object, path);
  const status = enumValue(
    required(object, 'status', path),
    EXTERNAL_ACTION_ATTEMPT_STATUSES,
    `${path}.status`,
  );
  const attemptNumber = positiveInteger(
    required(object, 'attemptNumber', path),
    `${path}.attemptNumber`,
  );
  const { startedAt, completedAt } = decodeAttemptTimestamps(
    object,
    path,
    status,
    required(object, 'startedAt', path),
    object.completedAt,
  );
  return {
    schemaVersion: '1.0.0',
    attemptId: text(required(object, 'attemptId', path), `${path}.attemptId`),
    attemptNumber,
    executionId: text(required(object, 'executionId', path), `${path}.executionId`),
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
    ...binding,
    idempotencyKey: text(required(object, 'idempotencyKey', path), `${path}.idempotencyKey`),
    status,
    policyContextRevision: text(
      required(object, 'policyContextRevision', path),
      `${path}.policyContextRevision`,
    ),
    externalRevision: text(required(object, 'externalRevision', path), `${path}.externalRevision`),
    providerRef: decodeOptionalResourceRef(object.providerRef, `${path}.providerRef`),
    correlationId: text(required(object, 'correlationId', path), `${path}.correlationId`),
    causationId: optionalText(object.causationId, `${path}.causationId`),
    startedAt,
    completedAt,
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
      'resourceProjectId',
      'effectiveProjectId',
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
  const binding = decodeProjectBinding(object, path);
  const status = enumValue(
    required(object, 'status', path),
    VERIFICATION_STATUSES,
    `${path}.status`,
  );
  const observedDigest =
    object.observedDigest === undefined
      ? undefined
      : digest(object.observedDigest, `${path}.observedDigest`);
  // Verification status ↔ observed-digest rules.
  if ((status === 'APPLIED' || status === 'MISMATCH') && observedDigest === undefined) {
    return fail(`${path}.observedDigest`, 'is required for APPLIED or MISMATCH verification');
  }
  if (status === 'NOT_APPLIED' && observedDigest !== undefined) {
    return fail(`${path}.observedDigest`, 'must be absent for NOT_APPLIED verification');
  }
  return {
    schemaVersion: '1.0.0',
    verificationId: text(required(object, 'verificationId', path), `${path}.verificationId`),
    concreteKind: 'VERIFICATION',
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
    ...binding,
    executionId: text(required(object, 'executionId', path), `${path}.executionId`),
    attemptId: optionalText(object.attemptId, `${path}.attemptId`),
    targetRevision: text(required(object, 'targetRevision', path), `${path}.targetRevision`),
    targetDigest: digest(required(object, 'targetDigest', path), `${path}.targetDigest`),
    externalRevision: text(required(object, 'externalRevision', path), `${path}.externalRevision`),
    status,
    observedDigest,
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
      'resourceProjectId',
      'effectiveProjectId',
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
  const binding = decodeProjectBinding(object, path);
  return {
    schemaVersion: '1.0.0',
    resultId: text(required(object, 'resultId', path), `${path}.resultId`),
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
    ...binding,
    executionId: text(required(object, 'executionId', path), `${path}.executionId`),
    attemptId: optionalText(object.attemptId, `${path}.attemptId`),
    externalId: text(required(object, 'externalId', path), `${path}.externalId`),
    observedDigest: digest(required(object, 'observedDigest', path), `${path}.observedDigest`),
    completedAt: isoTimestamp(required(object, 'completedAt', path), `${path}.completedAt`),
    verificationRef: decodeOptionalResourceRef(object.verificationRef, `${path}.verificationRef`),
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

const decodeAuditEventData = (value: unknown, path: string): ActionAuditEventDataV1 => {
  const object = strictObject(value, ['schemaVersion', 'message', 'refs'], path);
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    message: text(required(object, 'message', path), `${path}.message`),
    refs: arrayValue(required(object, 'refs', path), `${path}.refs`).map((entry, index) =>
      decodeResourceRef(entry, `${path}.refs[${index}]`),
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
      'resourceProjectId',
      'effectiveProjectId',
      'sequence',
      'category',
      'eventData',
      'occurredAt',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  const binding = decodeProjectBinding(object, path);
  return {
    schemaVersion: '1.0.0',
    auditEventId: text(required(object, 'auditEventId', path), `${path}.auditEventId`),
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
    ...binding,
    sequence: positiveInteger(required(object, 'sequence', path), `${path}.sequence`),
    category: enumValue(
      required(object, 'category', path),
      EXTERNAL_ACTION_AUDIT_CATEGORIES,
      `${path}.category`,
    ),
    eventData: decodeAuditEventData(required(object, 'eventData', path), `${path}.eventData`),
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
      'resourceProjectId',
      'effectiveProjectId',
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
  const binding = decodeProjectBinding(object, path);
  return {
    schemaVersion: '1.0.0',
    compensationId: text(required(object, 'compensationId', path), `${path}.compensationId`),
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
    ...binding,
    sourceActionId: text(required(object, 'sourceActionId', path), `${path}.sourceActionId`),
    sourceExecutionId: text(
      required(object, 'sourceExecutionId', path),
      `${path}.sourceExecutionId`,
    ),
    candidateRef: decodeResourceRef(required(object, 'candidateRef', path), `${path}.candidateRef`),
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
      'resourceProjectId',
      'effectiveProjectId',
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
  const binding = decodeProjectBinding(object, path);
  return {
    schemaVersion: '1.0.0',
    rollbackId: text(required(object, 'rollbackId', path), `${path}.rollbackId`),
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
    ...binding,
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
    manifestRef: decodeOptionalResourceRef(object.manifestRef, `${path}.manifestRef`),
    approvalRef: decodeOptionalResourceRef(object.approvalRef, `${path}.approvalRef`),
    executionRef: decodeOptionalResourceRef(object.executionRef, `${path}.executionRef`),
    verificationRef: decodeOptionalResourceRef(object.verificationRef, `${path}.verificationRef`),
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
      'resourceProjectId',
      'effectiveProjectId',
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
  const binding = decodeProjectBinding(object, path);
  return {
    schemaVersion: '1.0.0',
    candidateId: text(required(object, 'candidateId', path), `${path}.candidateId`),
    candidateRevision: positiveInteger(
      required(object, 'candidateRevision', path),
      `${path}.candidateRevision`,
    ),
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
    ...binding,
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
    targetRef: decodeTargetRef(required(object, 'targetRef', path), `${path}.targetRef`),
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
    riskDecisionRef: decodeResourceRef(
      required(object, 'riskDecisionRef', path),
      `${path}.riskDecisionRef`,
    ),
    generatedAt: isoTimestamp(required(object, 'generatedAt', path), `${path}.generatedAt`),
    generatedBy: decodeActor(required(object, 'generatedBy', path), `${path}.generatedBy`),
  };
};

export const decodeExternalActionCredentialViewV1 = (
  value: unknown,
  path = 'credential',
): ExternalActionCredentialViewV1 => {
  const object = strictObject(
    value,
    ['schemaVersion', 'connectorId', 'name', 'status', 'maskedCredential', 'capabilities'],
    path,
  );
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    connectorId: text(required(object, 'connectorId', path), `${path}.connectorId`),
    name: text(required(object, 'name', path), `${path}.name`),
    status: enumValue(
      required(object, 'status', path),
      ['CONFIGURED', 'MISSING', 'REVOKED', 'ROTATION_REQUIRED'],
      `${path}.status`,
    ),
    maskedCredential:
      object.maskedCredential === undefined
        ? undefined
        : text(object.maskedCredential, `${path}.maskedCredential`),
    capabilities: arrayValue(required(object, 'capabilities', path), `${path}.capabilities`).map(
      (entry, index) =>
        enumValue(entry, ['TEST', 'ROTATE', 'REVOKE'], `${path}.capabilities[${index}]`),
    ),
  };
};

export const decodeExternalActionBudgetViewV1 = (
  value: unknown,
  path = 'budget',
): ExternalActionBudgetViewV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'projectId',
      'status',
      'usedExecutions',
      'remainingExecutions',
      'softLimit',
      'hardLimit',
      'exhausted',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  const used = integer(required(object, 'usedExecutions', path), `${path}.usedExecutions`);
  const remaining = integer(
    required(object, 'remainingExecutions', path),
    `${path}.remainingExecutions`,
  );
  const softLimit = integer(required(object, 'softLimit', path), `${path}.softLimit`);
  const hardLimit = integer(required(object, 'hardLimit', path), `${path}.hardLimit`);
  if (softLimit > hardLimit) {
    return fail(`${path}.softLimit`, 'must not exceed hardLimit');
  }
  return {
    schemaVersion: '1.0.0',
    projectId: text(required(object, 'projectId', path), `${path}.projectId`),
    status: enumValue(
      required(object, 'status', path),
      ['OK', 'WARNING', 'EXHAUSTED'],
      `${path}.status`,
    ),
    usedExecutions: used,
    remainingExecutions: remaining,
    softLimit,
    hardLimit,
    exhausted: booleanValue(required(object, 'exhausted', path), `${path}.exhausted`),
  };
};

// ---------------------------------------------------------------------------
// Operation request decoders (strict, per operation)
// ---------------------------------------------------------------------------

const decodeCommandIdentity = (
  object: ObjectValue,
  path: string,
): { clientRequestId: string; idempotencyKey: string } => ({
  clientRequestId: text(required(object, 'clientRequestId', path), `${path}.clientRequestId`),
  idempotencyKey: text(required(object, 'idempotencyKey', path), `${path}.idempotencyKey`),
});

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

export const decodeGetExternalActionRequestV1 = (
  value: unknown,
  path = 'request',
): GetExternalActionRequestV1 => {
  const object = strictObject(value, ['schemaVersion', 'actionId'], path);
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
  };
};

export const decodeGetActionManifestRequestV1 = (
  value: unknown,
  path = 'request',
): GetActionManifestRequestV1 => {
  const object = strictObject(value, ['schemaVersion', 'actionId'], path);
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
  };
};

export const decodeGetRiskDecisionRequestV1 = (
  value: unknown,
  path = 'request',
): GetRiskDecisionRequestV1 => {
  const object = strictObject(value, ['schemaVersion', 'actionId'], path);
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
  };
};

export const decodeGetPreflightRequestV1 = (
  value: unknown,
  path = 'request',
): GetPreflightRequestV1 => {
  const object = strictObject(value, ['schemaVersion', 'actionId'], path);
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
  };
};

export const decodeGetExternalActionApprovalRequestV1 = (
  value: unknown,
  path = 'request',
): GetExternalActionApprovalRequestV1 => {
  const object = strictObject(value, ['schemaVersion', 'actionId'], path);
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
  };
};

export const decodeGetExecutionRequestV1 = (
  value: unknown,
  path = 'request',
): GetExecutionRequestV1 => {
  const object = strictObject(value, ['schemaVersion', 'actionId'], path);
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
  };
};

export const decodeGetExecutionAttemptsRequestV1 = (
  value: unknown,
  path = 'request',
): GetExecutionAttemptsRequestV1 => {
  const object = strictObject(value, ['schemaVersion', 'actionId', 'cursor', 'pageSize'], path);
  decodeSchemaVersion(object, path);
  const pageSize = integer(required(object, 'pageSize', path), `${path}.pageSize`);
  if (pageSize > EXTERNAL_ACTION_QUEUE_PAGE_SIZE_CAP) {
    return fail(`${path}.pageSize`, `must not exceed ${EXTERNAL_ACTION_QUEUE_PAGE_SIZE_CAP}`);
  }
  return {
    schemaVersion: '1.0.0',
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
    cursor: optionalText(object.cursor, `${path}.cursor`),
    pageSize,
  };
};

export const decodeGetVerificationRequestV1 = (
  value: unknown,
  path = 'request',
): GetVerificationRequestV1 => {
  const object = strictObject(value, ['schemaVersion', 'actionId'], path);
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
  };
};

export const decodeGetActionResultRequestV1 = (
  value: unknown,
  path = 'request',
): GetActionResultRequestV1 => {
  const object = strictObject(value, ['schemaVersion', 'actionId'], path);
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
  };
};

export const decodeGetExternalActionDetailRequestV1 = (
  value: unknown,
  path = 'request',
): GetExternalActionDetailRequestV1 => {
  const object = strictObject(value, ['schemaVersion', 'actionId'], path);
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
  };
};

export const decodeListExternalActionAuditRequestV1 = (
  value: unknown,
  path = 'request',
): ListExternalActionAuditRequestV1 => {
  const object = strictObject(value, ['schemaVersion', 'actionId', 'cursor', 'pageSize'], path);
  decodeSchemaVersion(object, path);
  const pageSize = integer(required(object, 'pageSize', path), `${path}.pageSize`);
  if (pageSize > EXTERNAL_ACTION_QUEUE_PAGE_SIZE_CAP) {
    return fail(`${path}.pageSize`, `must not exceed ${EXTERNAL_ACTION_QUEUE_PAGE_SIZE_CAP}`);
  }
  return {
    schemaVersion: '1.0.0',
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
    cursor: optionalText(object.cursor, `${path}.cursor`),
    pageSize,
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
    ...decodeCommandIdentity(object, path),
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
    candidateId: text(required(object, 'candidateId', path), `${path}.candidateId`),
    operation: enumValue(
      required(object, 'operation', path),
      EXTERNAL_ACTION_OPERATIONS,
      `${path}.operation`,
    ),
    targetRef: decodeTargetRef(required(object, 'targetRef', path), `${path}.targetRef`),
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

export const decodePrepareActionManifestRequestV1 = (
  value: unknown,
  path = 'request',
): PrepareActionManifestRequestV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'clientRequestId',
      'idempotencyKey',
      'actionId',
      'expectedActionRevision',
      'reason',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    ...decodeCommandIdentity(object, path),
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
    expectedActionRevision: positiveInteger(
      required(object, 'expectedActionRevision', path),
      `${path}.expectedActionRevision`,
    ),
    reason: text(required(object, 'reason', path), `${path}.reason`),
  };
};

export const decodeApproveExternalActionRequestV1 = (
  value: unknown,
  path = 'request',
): ApproveExternalActionRequestV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'clientRequestId',
      'idempotencyKey',
      'actionId',
      'manifestId',
      'manifestRevision',
      'expectedTargetRevision',
      'expectedExternalRevision',
      'reason',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    ...decodeCommandIdentity(object, path),
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
    manifestId: text(required(object, 'manifestId', path), `${path}.manifestId`),
    manifestRevision: positiveInteger(
      required(object, 'manifestRevision', path),
      `${path}.manifestRevision`,
    ),
    expectedTargetRevision: text(
      required(object, 'expectedTargetRevision', path),
      `${path}.expectedTargetRevision`,
    ),
    expectedExternalRevision: text(
      required(object, 'expectedExternalRevision', path),
      `${path}.expectedExternalRevision`,
    ),
    reason: text(required(object, 'reason', path), `${path}.reason`),
  };
};

export const decodePreflightExternalActionRequestV1 = (
  value: unknown,
  path = 'request',
): PreflightExternalActionRequestV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'clientRequestId',
      'idempotencyKey',
      'actionId',
      'expectedActionRevision',
      'manifestRevision',
      'expectedExternalRevision',
      'reason',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    ...decodeCommandIdentity(object, path),
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
    expectedActionRevision: positiveInteger(
      required(object, 'expectedActionRevision', path),
      `${path}.expectedActionRevision`,
    ),
    manifestRevision: positiveInteger(
      required(object, 'manifestRevision', path),
      `${path}.manifestRevision`,
    ),
    expectedExternalRevision: text(
      required(object, 'expectedExternalRevision', path),
      `${path}.expectedExternalRevision`,
    ),
    reason: text(required(object, 'reason', path), `${path}.reason`),
  };
};

export const decodeExecuteExternalActionRequestV1 = (
  value: unknown,
  path = 'request',
): ExecuteExternalActionRequestV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'clientRequestId',
      'idempotencyKey',
      'actionId',
      'expectedActionRevision',
      'manifestRevision',
      'preflightId',
      'expectedExternalRevision',
      'reason',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    ...decodeCommandIdentity(object, path),
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
    expectedActionRevision: positiveInteger(
      required(object, 'expectedActionRevision', path),
      `${path}.expectedActionRevision`,
    ),
    manifestRevision: positiveInteger(
      required(object, 'manifestRevision', path),
      `${path}.manifestRevision`,
    ),
    preflightId: text(required(object, 'preflightId', path), `${path}.preflightId`),
    expectedExternalRevision: text(
      required(object, 'expectedExternalRevision', path),
      `${path}.expectedExternalRevision`,
    ),
    reason: text(required(object, 'reason', path), `${path}.reason`),
  };
};

export const decodeRetryExecutionAttemptRequestV1 = (
  value: unknown,
  path = 'request',
): RetryExecutionAttemptRequestV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'clientRequestId',
      'idempotencyKey',
      'actionId',
      'executionId',
      'sourceAttemptId',
      'causationId',
      'reason',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    ...decodeCommandIdentity(object, path),
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
    executionId: text(required(object, 'executionId', path), `${path}.executionId`),
    sourceAttemptId: text(required(object, 'sourceAttemptId', path), `${path}.sourceAttemptId`),
    causationId: text(required(object, 'causationId', path), `${path}.causationId`),
    reason: text(required(object, 'reason', path), `${path}.reason`),
  };
};

export const decodeVerifyExternalActionRequestV1 = (
  value: unknown,
  path = 'request',
): VerifyExternalActionRequestV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'clientRequestId',
      'idempotencyKey',
      'actionId',
      'executionId',
      'attemptId',
      'expectedTargetRevision',
      'expectedExternalRevision',
      'reason',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    ...decodeCommandIdentity(object, path),
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
    executionId: text(required(object, 'executionId', path), `${path}.executionId`),
    attemptId: optionalText(object.attemptId, `${path}.attemptId`),
    expectedTargetRevision: text(
      required(object, 'expectedTargetRevision', path),
      `${path}.expectedTargetRevision`,
    ),
    expectedExternalRevision: text(
      required(object, 'expectedExternalRevision', path),
      `${path}.expectedExternalRevision`,
    ),
    reason: text(required(object, 'reason', path), `${path}.reason`),
  };
};

export const decodeCancelExternalActionRequestV1 = (
  value: unknown,
  path = 'request',
): CancelExternalActionRequestV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'clientRequestId',
      'idempotencyKey',
      'actionId',
      'expectedActionRevision',
      'reason',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    ...decodeCommandIdentity(object, path),
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
    expectedActionRevision: positiveInteger(
      required(object, 'expectedActionRevision', path),
      `${path}.expectedActionRevision`,
    ),
    reason: text(required(object, 'reason', path), `${path}.reason`),
  };
};

export const decodeRollbackExternalActionRequestV1 = (
  value: unknown,
  path = 'request',
): RollbackExternalActionRequestV1 => {
  const object = strictObject(
    value,
    ['schemaVersion', 'clientRequestId', 'idempotencyKey', 'actionId', 'executionId', 'reason'],
    path,
  );
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    ...decodeCommandIdentity(object, path),
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
    executionId: text(required(object, 'executionId', path), `${path}.executionId`),
    reason: text(required(object, 'reason', path), `${path}.reason`),
  };
};

export const decodePrepareCompensatingActionRequestV1 = (
  value: unknown,
  path = 'request',
): PrepareCompensatingActionRequestV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'clientRequestId',
      'idempotencyKey',
      'sourceActionId',
      'sourceExecutionId',
      'reason',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    ...decodeCommandIdentity(object, path),
    sourceActionId: text(required(object, 'sourceActionId', path), `${path}.sourceActionId`),
    sourceExecutionId: text(
      required(object, 'sourceExecutionId', path),
      `${path}.sourceExecutionId`,
    ),
    reason: text(required(object, 'reason', path), `${path}.reason`),
  };
};

export const decodeResolveExternalActionOutcomeRequestV1 = (
  value: unknown,
  path = 'request',
): ResolveExternalActionOutcomeRequestV1 => {
  const object = strictObject(
    value,
    ['schemaVersion', 'clientRequestId', 'idempotencyKey', 'semanticDigest'],
    path,
  );
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    ...decodeCommandIdentity(object, path),
    semanticDigest: text(required(object, 'semanticDigest', path), `${path}.semanticDigest`),
  };
};

// ---------------------------------------------------------------------------
// Command result decoders
// ---------------------------------------------------------------------------

export const decodeValidateActionCandidateResultV1 = (
  value: unknown,
  path = 'result',
): ValidateActionCandidateResultV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'outcome',
      'clientRequestId',
      'idempotencyKey',
      'commandSemanticDigest',
      'actionId',
      'riskDecision',
      'candidate',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  const actionId = text(required(object, 'actionId', path), `${path}.actionId`);
  const riskDecision = decodeRiskDecisionV1(
    required(object, 'riskDecision', path),
    `${path}.riskDecision`,
  );
  const candidate = decodeActionCandidateV1(
    required(object, 'candidate', path),
    `${path}.candidate`,
  );
  // Nested binding: candidate and risk decision belong to the same Action with
  // a consistent project binding, and the candidate references the decision.
  assertSameAction(candidate, actionId, `${path}.candidate`);
  assertSameAction(riskDecision, actionId, `${path}.riskDecision`);
  assertSameProjectBinding(candidate, riskDecision, `${path}.candidate`);
  if (candidate.riskDecisionRef.resourceKind !== 'riskDecision') {
    return fail(`${path}.candidate.riskDecisionRef.resourceKind`, 'must reference a riskDecision');
  }
  if (candidate.riskDecisionRef.resourceId !== riskDecision.riskDecisionId) {
    return fail(`${path}.candidate.riskDecisionRef.resourceId`, 'must match the risk decision');
  }
  return {
    schemaVersion: '1.0.0',
    outcome: enumValue(required(object, 'outcome', path), ['COMPLETED'], `${path}.outcome`),
    clientRequestId: text(required(object, 'clientRequestId', path), `${path}.clientRequestId`),
    idempotencyKey: text(required(object, 'idempotencyKey', path), `${path}.idempotencyKey`),
    commandSemanticDigest: text(
      required(object, 'commandSemanticDigest', path),
      `${path}.commandSemanticDigest`,
    ),
    actionId,
    riskDecision,
    candidate,
  };
};

export const decodePrepareActionManifestResultV1 = (
  value: unknown,
  path = 'result',
): PrepareActionManifestResultV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'outcome',
      'clientRequestId',
      'idempotencyKey',
      'commandSemanticDigest',
      'actionId',
      'manifest',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  const actionId = text(required(object, 'actionId', path), `${path}.actionId`);
  const manifest = decodeActionManifestV1(required(object, 'manifest', path), `${path}.manifest`);
  assertSameAction(manifest, actionId, `${path}.manifest`);
  return {
    schemaVersion: '1.0.0',
    outcome: enumValue(required(object, 'outcome', path), ['COMPLETED'], `${path}.outcome`),
    clientRequestId: text(required(object, 'clientRequestId', path), `${path}.clientRequestId`),
    idempotencyKey: text(required(object, 'idempotencyKey', path), `${path}.idempotencyKey`),
    commandSemanticDigest: text(
      required(object, 'commandSemanticDigest', path),
      `${path}.commandSemanticDigest`,
    ),
    actionId,
    manifest,
  };
};

export const decodeApproveExternalActionResultV1 = (
  value: unknown,
  path = 'result',
): ApproveExternalActionResultV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'outcome',
      'clientRequestId',
      'idempotencyKey',
      'commandSemanticDigest',
      'actionId',
      'approval',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  const actionId = text(required(object, 'actionId', path), `${path}.actionId`);
  const approval = decodeExternalActionApprovalV1(
    required(object, 'approval', path),
    `${path}.approval`,
  );
  assertSameAction(approval, actionId, `${path}.approval`);
  return {
    schemaVersion: '1.0.0',
    outcome: enumValue(required(object, 'outcome', path), ['COMPLETED'], `${path}.outcome`),
    clientRequestId: text(required(object, 'clientRequestId', path), `${path}.clientRequestId`),
    idempotencyKey: text(required(object, 'idempotencyKey', path), `${path}.idempotencyKey`),
    commandSemanticDigest: text(
      required(object, 'commandSemanticDigest', path),
      `${path}.commandSemanticDigest`,
    ),
    actionId,
    approval,
  };
};

export const decodePreflightExternalActionResultV1 = (
  value: unknown,
  path = 'result',
): PreflightExternalActionResultV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'outcome',
      'clientRequestId',
      'idempotencyKey',
      'commandSemanticDigest',
      'actionId',
      'preflight',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  const actionId = text(required(object, 'actionId', path), `${path}.actionId`);
  const preflight = decodePreflightV1(required(object, 'preflight', path), `${path}.preflight`);
  assertSameAction(preflight, actionId, `${path}.preflight`);
  return {
    schemaVersion: '1.0.0',
    outcome: enumValue(required(object, 'outcome', path), ['COMPLETED'], `${path}.outcome`),
    clientRequestId: text(required(object, 'clientRequestId', path), `${path}.clientRequestId`),
    idempotencyKey: text(required(object, 'idempotencyKey', path), `${path}.idempotencyKey`),
    commandSemanticDigest: text(
      required(object, 'commandSemanticDigest', path),
      `${path}.commandSemanticDigest`,
    ),
    actionId,
    preflight,
  };
};

const assertSameAction = (
  resource: { readonly actionId: string },
  actionId: string,
  path: string,
): void => {
  if (resource.actionId !== actionId) {
    return fail(`${path}.actionId`, 'must match the enclosing action');
  }
};

const assertSameProjectBinding = (
  resource: { readonly resourceProjectId: string; readonly effectiveProjectId: string },
  project: { readonly resourceProjectId: string; readonly effectiveProjectId: string },
  path: string,
): void => {
  if (resource.resourceProjectId !== project.resourceProjectId) {
    return fail(`${path}.resourceProjectId`, 'must match the enclosing action project binding');
  }
  if (resource.effectiveProjectId !== project.effectiveProjectId) {
    return fail(`${path}.effectiveProjectId`, 'must match the enclosing action project binding');
  }
};

export const decodeExecuteExternalActionResultV1 = (
  value: unknown,
  path = 'result',
): ExecuteExternalActionResultV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'outcome',
      'clientRequestId',
      'idempotencyKey',
      'commandSemanticDigest',
      'actionId',
      'execution',
      'attempt',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  const actionId = text(required(object, 'actionId', path), `${path}.actionId`);
  const execution = decodeExecutionV1(required(object, 'execution', path), `${path}.execution`);
  const attempt = decodeExecutionAttemptV1(required(object, 'attempt', path), `${path}.attempt`);
  // Nested binding: execution and attempt must belong to the same Action and
  // Execution with a consistent project binding.
  assertSameAction(execution, actionId, `${path}.execution`);
  assertSameAction(attempt, actionId, `${path}.attempt`);
  if (attempt.executionId !== execution.executionId) {
    return fail(`${path}.attempt.executionId`, 'must match the execution executionId');
  }
  assertSameProjectBinding(attempt, execution, `${path}.attempt`);
  return {
    schemaVersion: '1.0.0',
    outcome: enumValue(
      required(object, 'outcome', path),
      ['COMPLETED', 'OUTCOME_UNKNOWN'],
      `${path}.outcome`,
    ),
    clientRequestId: text(required(object, 'clientRequestId', path), `${path}.clientRequestId`),
    idempotencyKey: text(required(object, 'idempotencyKey', path), `${path}.idempotencyKey`),
    commandSemanticDigest: text(
      required(object, 'commandSemanticDigest', path),
      `${path}.commandSemanticDigest`,
    ),
    actionId,
    execution,
    attempt,
  };
};

export const decodeRetryExecutionAttemptResultV1 = (
  value: unknown,
  path = 'result',
): RetryExecutionAttemptResultV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'outcome',
      'clientRequestId',
      'idempotencyKey',
      'commandSemanticDigest',
      'actionId',
      'attempt',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  const actionId = text(required(object, 'actionId', path), `${path}.actionId`);
  const attempt = decodeExecutionAttemptV1(required(object, 'attempt', path), `${path}.attempt`);
  assertSameAction(attempt, actionId, `${path}.attempt`);
  return {
    schemaVersion: '1.0.0',
    outcome: enumValue(
      required(object, 'outcome', path),
      ['COMPLETED', 'OUTCOME_UNKNOWN'],
      `${path}.outcome`,
    ),
    clientRequestId: text(required(object, 'clientRequestId', path), `${path}.clientRequestId`),
    idempotencyKey: text(required(object, 'idempotencyKey', path), `${path}.idempotencyKey`),
    commandSemanticDigest: text(
      required(object, 'commandSemanticDigest', path),
      `${path}.commandSemanticDigest`,
    ),
    actionId,
    attempt,
  };
};

export const decodeVerifyExternalActionResultV1 = (
  value: unknown,
  path = 'result',
): VerifyExternalActionResultV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'outcome',
      'clientRequestId',
      'idempotencyKey',
      'commandSemanticDigest',
      'actionId',
      'verification',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  const actionId = text(required(object, 'actionId', path), `${path}.actionId`);
  const verification = decodeVerificationV1(
    required(object, 'verification', path),
    `${path}.verification`,
  );
  assertSameAction(verification, actionId, `${path}.verification`);
  return {
    schemaVersion: '1.0.0',
    outcome: enumValue(required(object, 'outcome', path), ['COMPLETED'], `${path}.outcome`),
    clientRequestId: text(required(object, 'clientRequestId', path), `${path}.clientRequestId`),
    idempotencyKey: text(required(object, 'idempotencyKey', path), `${path}.idempotencyKey`),
    commandSemanticDigest: text(
      required(object, 'commandSemanticDigest', path),
      `${path}.commandSemanticDigest`,
    ),
    actionId,
    verification,
  };
};

export const decodeCancelExternalActionResultV1 = (
  value: unknown,
  path = 'result',
): CancelExternalActionResultV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'outcome',
      'clientRequestId',
      'idempotencyKey',
      'commandSemanticDigest',
      'actionId',
      'status',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    outcome: enumValue(required(object, 'outcome', path), ['COMPLETED'], `${path}.outcome`),
    clientRequestId: text(required(object, 'clientRequestId', path), `${path}.clientRequestId`),
    idempotencyKey: text(required(object, 'idempotencyKey', path), `${path}.idempotencyKey`),
    commandSemanticDigest: text(
      required(object, 'commandSemanticDigest', path),
      `${path}.commandSemanticDigest`,
    ),
    actionId: text(required(object, 'actionId', path), `${path}.actionId`),
    status: enumValue(
      required(object, 'status', path),
      ['CANCELLING', 'CANCELLED'],
      `${path}.status`,
    ),
  };
};

export const decodeRollbackExternalActionResultV1 = (
  value: unknown,
  path = 'result',
): RollbackExternalActionResultV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'outcome',
      'clientRequestId',
      'idempotencyKey',
      'commandSemanticDigest',
      'actionId',
      'rollback',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  const actionId = text(required(object, 'actionId', path), `${path}.actionId`);
  const rollback = decodeRollbackV1(required(object, 'rollback', path), `${path}.rollback`);
  assertSameAction(rollback, actionId, `${path}.rollback`);
  return {
    schemaVersion: '1.0.0',
    outcome: enumValue(
      required(object, 'outcome', path),
      ['COMPLETED', 'OUTCOME_UNKNOWN'],
      `${path}.outcome`,
    ),
    clientRequestId: text(required(object, 'clientRequestId', path), `${path}.clientRequestId`),
    idempotencyKey: text(required(object, 'idempotencyKey', path), `${path}.idempotencyKey`),
    commandSemanticDigest: text(
      required(object, 'commandSemanticDigest', path),
      `${path}.commandSemanticDigest`,
    ),
    actionId,
    rollback,
  };
};

export const decodePrepareCompensatingActionResultV1 = (
  value: unknown,
  path = 'result',
): PrepareCompensatingActionResultV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'outcome',
      'clientRequestId',
      'idempotencyKey',
      'commandSemanticDigest',
      'compensation',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    outcome: enumValue(required(object, 'outcome', path), ['COMPLETED'], `${path}.outcome`),
    clientRequestId: text(required(object, 'clientRequestId', path), `${path}.clientRequestId`),
    idempotencyKey: text(required(object, 'idempotencyKey', path), `${path}.idempotencyKey`),
    commandSemanticDigest: text(
      required(object, 'commandSemanticDigest', path),
      `${path}.commandSemanticDigest`,
    ),
    compensation: decodeCompensatingActionV1(
      required(object, 'compensation', path),
      `${path}.compensation`,
    ),
  };
};

export const decodeResolveExternalActionOutcomeResultV1 = (
  value: unknown,
  path = 'result',
): ResolveExternalActionOutcomeResultV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'outcome',
      'originalClientRequestId',
      'originalIdempotencyKey',
      'completed',
      'rejection',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  const outcome = enumValue(
    required(object, 'outcome', path),
    ['COMPLETED', 'REJECTED', 'OUTCOME_UNKNOWN'],
    `${path}.outcome`,
  );
  const completed =
    object.completed === undefined
      ? undefined
      : decodeCompletedOutcome(object.completed, `${path}.completed`);
  const rejection =
    object.rejection === undefined
      ? undefined
      : (() => {
          const rejection = strictObject(
            object.rejection,
            ['code', 'message'],
            `${path}.rejection`,
          );
          return {
            code: text(required(rejection, 'code', path), `${path}.rejection.code`),
            message: text(required(rejection, 'message', path), `${path}.rejection.message`),
          };
        })();
  // Exclusive outcome contract: each outcome carries exactly its own shape.
  if (outcome === 'COMPLETED' && completed === undefined) {
    return fail(`${path}.completed`, 'is required when outcome is COMPLETED');
  }
  if (outcome === 'COMPLETED' && rejection !== undefined) {
    return fail(`${path}.rejection`, 'must be absent when outcome is COMPLETED');
  }
  if (outcome === 'REJECTED' && rejection === undefined) {
    return fail(`${path}.rejection`, 'is required when outcome is REJECTED');
  }
  if (outcome === 'REJECTED' && completed !== undefined) {
    return fail(`${path}.completed`, 'must be absent when outcome is REJECTED');
  }
  if (outcome === 'OUTCOME_UNKNOWN' && (completed !== undefined || rejection !== undefined)) {
    return fail(path, 'OUTCOME_UNKNOWN must carry neither completed nor rejection');
  }
  return {
    schemaVersion: '1.0.0',
    outcome,
    originalClientRequestId: text(
      required(object, 'originalClientRequestId', path),
      `${path}.originalClientRequestId`,
    ),
    originalIdempotencyKey: text(
      required(object, 'originalIdempotencyKey', path),
      `${path}.originalIdempotencyKey`,
    ),
    completed,
    rejection,
  };
};

const decodeCompletedOutcome = (value: unknown, path: string): ResolvedCommandResultV1 => {
  const object = strictObject(value, ['commandType', 'result'], path);
  const commandType = enumValue(
    required(object, 'commandType', path),
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
    ],
    `${path}.commandType`,
  );
  const result = required(object, 'result', path);
  switch (commandType) {
    case FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.validateCandidate:
      return {
        commandType,
        result: decodeValidateActionCandidateResultV1(result, `${path}.result`),
      };
    case FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.prepareManifest:
      return {
        commandType,
        result: decodePrepareActionManifestResultV1(result, `${path}.result`),
      };
    case FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.approve:
      return {
        commandType,
        result: decodeApproveExternalActionResultV1(result, `${path}.result`),
      };
    case FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.preflight:
      return {
        commandType,
        result: decodePreflightExternalActionResultV1(result, `${path}.result`),
      };
    case FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.execute:
      return {
        commandType,
        result: decodeExecuteExternalActionResultV1(result, `${path}.result`),
      };
    case FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.retryAttempt:
      return {
        commandType,
        result: decodeRetryExecutionAttemptResultV1(result, `${path}.result`),
      };
    case FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.verify:
      return {
        commandType,
        result: decodeVerifyExternalActionResultV1(result, `${path}.result`),
      };
    case FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.cancel:
      return {
        commandType,
        result: decodeCancelExternalActionResultV1(result, `${path}.result`),
      };
    case FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.rollback:
      return {
        commandType,
        result: decodeRollbackExternalActionResultV1(result, `${path}.result`),
      };
    case FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.prepareCompensation:
      return {
        commandType,
        result: decodePrepareCompensatingActionResultV1(result, `${path}.result`),
      };
  }
  return fail(
    `${path}.commandType`,
    'resolve-outcome is not a resolvable completed command result',
  );
};

/**
 * Ordered, append-only Attempt list (AC-07): bounded (≤50), consecutive
 * attemptNumber starting at 1, unique attemptId/idempotencyKey, single
 * Action/Execution, optional project binding, and optional match against
 * ExecutionV1.attemptCount and latestAttemptRef.
 */
const decodeAttemptList = (
  value: unknown,
  path: string,
  context: {
    readonly actionId?: string;
    readonly executionId?: string;
    readonly project?: {
      readonly resourceProjectId: string;
      readonly effectiveProjectId: string;
    };
    readonly expectedCount?: number;
    readonly latestAttemptRef?: ExternalActionResourceRefV1;
  },
): readonly ExecutionAttemptV1[] => {
  const raw = arrayValue(value, path);
  if (raw.length > EXTERNAL_ACTION_ATTEMPT_LIST_CAP) {
    return fail(path, `must not exceed ${EXTERNAL_ACTION_ATTEMPT_LIST_CAP} attempts`);
  }
  const attempts = raw.map((entry, index) => decodeExecutionAttemptV1(entry, `${path}[${index}]`));
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  let sharedExecutionId: string | undefined;
  attempts.forEach((attempt, index) => {
    if (context.actionId !== undefined) {
      assertSameAction(attempt, context.actionId, `${path}[${index}]`);
    }
    if (context.executionId !== undefined && attempt.executionId !== context.executionId) {
      return fail(`${path}[${index}].executionId`, 'must match the enclosing execution');
    }
    if (sharedExecutionId === undefined) {
      sharedExecutionId = attempt.executionId;
    } else if (attempt.executionId !== sharedExecutionId) {
      return fail(`${path}[${index}].executionId`, 'must be consistent across attempts');
    }
    if (context.project !== undefined) {
      assertSameProjectBinding(attempt, context.project, `${path}[${index}]`);
    }
    if (attempt.attemptNumber !== index + 1) {
      return fail(`${path}[${index}].attemptNumber`, 'must be consecutive starting at 1');
    }
    if (seenIds.has(attempt.attemptId)) {
      return fail(`${path}[${index}].attemptId`, 'must be unique');
    }
    seenIds.add(attempt.attemptId);
    if (seenKeys.has(attempt.idempotencyKey)) {
      return fail(`${path}[${index}].idempotencyKey`, 'must be unique');
    }
    seenKeys.add(attempt.idempotencyKey);
  });
  if (context.expectedCount !== undefined && attempts.length !== context.expectedCount) {
    return fail(path, 'length must match the execution attemptCount');
  }
  if (context.latestAttemptRef !== undefined) {
    const last = attempts[attempts.length - 1];
    if (
      last === undefined ||
      context.latestAttemptRef.resourceKind !== 'attempt' ||
      context.latestAttemptRef.resourceId !== last.attemptId ||
      (context.latestAttemptRef.resourceRevision !== undefined &&
        context.latestAttemptRef.resourceRevision !== last.attemptNumber)
    ) {
      return fail(path, 'latestAttemptRef must reference the last attempt');
    }
  }
  return attempts;
};

export const decodeGetActionManifestResultV1 = (
  value: unknown,
  path = 'result',
): GetActionManifestResultV1 => {
  const object = strictObject(value, ['schemaVersion', 'manifest'], path);
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    manifest: decodeActionManifestV1(required(object, 'manifest', path), `${path}.manifest`),
  };
};

export const decodeGetRiskDecisionResultV1 = (
  value: unknown,
  path = 'result',
): GetRiskDecisionResultV1 => {
  const object = strictObject(value, ['schemaVersion', 'riskDecision'], path);
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    riskDecision: decodeRiskDecisionV1(
      required(object, 'riskDecision', path),
      `${path}.riskDecision`,
    ),
  };
};

export const decodeGetPreflightResultV1 = (
  value: unknown,
  path = 'result',
): GetPreflightResultV1 => {
  const object = strictObject(value, ['schemaVersion', 'preflight'], path);
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    preflight: decodePreflightV1(required(object, 'preflight', path), `${path}.preflight`),
  };
};

export const decodeGetExternalActionApprovalResultV1 = (
  value: unknown,
  path = 'result',
): GetExternalActionApprovalResultV1 => {
  const object = strictObject(value, ['schemaVersion', 'approval'], path);
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    approval: decodeExternalActionApprovalV1(
      required(object, 'approval', path),
      `${path}.approval`,
    ),
  };
};

export const decodeGetExecutionResultV1 = (
  value: unknown,
  path = 'result',
): GetExecutionResultV1 => {
  const object = strictObject(value, ['schemaVersion', 'execution'], path);
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    execution: decodeExecutionV1(required(object, 'execution', path), `${path}.execution`),
  };
};

export const decodeGetExecutionAttemptsResultV1 = (
  value: unknown,
  path = 'result',
): GetExecutionAttemptsResultV1 => {
  const object = strictObject(value, ['schemaVersion', 'attempts', 'nextCursor'], path);
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    attempts: decodeAttemptList(required(object, 'attempts', path), `${path}.attempts`, {}),
    nextCursor: optionalText(object.nextCursor, `${path}.nextCursor`),
  };
};

export const decodeGetVerificationResultV1 = (
  value: unknown,
  path = 'result',
): GetVerificationResultV1 => {
  const object = strictObject(value, ['schemaVersion', 'verification'], path);
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    verification: decodeVerificationV1(
      required(object, 'verification', path),
      `${path}.verification`,
    ),
  };
};

export const decodeGetActionResultResultV1 = (
  value: unknown,
  path = 'result',
): GetActionResultResultV1 => {
  const object = strictObject(value, ['schemaVersion', 'result'], path);
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    result: decodeResultV1(required(object, 'result', path), `${path}.result`),
  };
};

export const decodeListExternalActionsResultV1 = (
  value: unknown,
  path = 'result',
): ListExternalActionsResultV1 => {
  const object = strictObject(
    value,
    ['schemaVersion', 'items', 'nextCursor', 'capabilities'],
    path,
  );
  decodeSchemaVersion(object, path);
  const items = arrayValue(required(object, 'items', path), `${path}.items`);
  if (items.length > EXTERNAL_ACTION_QUEUE_PAGE_SIZE_CAP) {
    return fail(
      `${path}.items`,
      `must not exceed ${EXTERNAL_ACTION_QUEUE_PAGE_SIZE_CAP} queue items`,
    );
  }
  return {
    schemaVersion: '1.0.0',
    items: items.map((entry, index) => {
      const item = strictObject(
        entry,
        [
          'schemaVersion',
          'actionId',
          'actionRevision',
          'operation',
          'resourceProjectId',
          'effectiveProjectId',
          'status',
          'aggregateState',
          'capabilities',
          'riskLevel',
          'updatedAt',
        ],
        `${path}.items[${index}]`,
      );
      decodeSchemaVersion(item, `${path}.items[${index}]`);
      return {
        schemaVersion: '1.0.0' as const,
        actionId: text(required(item, 'actionId', path), `${path}.items[${index}].actionId`),
        actionRevision: positiveInteger(
          required(item, 'actionRevision', path),
          `${path}.items[${index}].actionRevision`,
        ),
        operation: enumValue(
          required(item, 'operation', path),
          EXTERNAL_ACTION_OPERATIONS,
          `${path}.items[${index}].operation`,
        ),
        resourceProjectId: text(
          required(item, 'resourceProjectId', path),
          `${path}.items[${index}].resourceProjectId`,
        ),
        effectiveProjectId: text(
          required(item, 'effectiveProjectId', path),
          `${path}.items[${index}].effectiveProjectId`,
        ),
        status: enumValue(
          required(item, 'status', path),
          EXTERNAL_ACTION_AGGREGATE_STATUSES,
          `${path}.items[${index}].status`,
        ),
        aggregateState: enumValue(
          required(item, 'aggregateState', path),
          ['AVAILABLE', 'STALE', 'ACCESS_RESTRICTED', 'UNAVAILABLE'],
          `${path}.items[${index}].aggregateState`,
        ),
        capabilities: arrayValue(
          required(item, 'capabilities', path),
          `${path}.items[${index}].capabilities`,
        ).map((cap, capIndex) =>
          enumValue(
            cap,
            EXTERNAL_ACTION_CAPABILITIES,
            `${path}.items[${index}].capabilities[${capIndex}]`,
          ),
        ),
        riskLevel: enumValue(
          required(item, 'riskLevel', path),
          ['R0', 'R1', 'R2', 'R3', 'R4'],
          `${path}.items[${index}].riskLevel`,
        ),
        updatedAt: isoTimestamp(
          required(item, 'updatedAt', path),
          `${path}.items[${index}].updatedAt`,
        ),
      };
    }),
    nextCursor: optionalText(object.nextCursor, `${path}.nextCursor`),
    capabilities: arrayValue(required(object, 'capabilities', path), `${path}.capabilities`).map(
      (entry, index) =>
        enumValue(entry, EXTERNAL_ACTION_CAPABILITIES, `${path}.capabilities[${index}]`),
    ),
  };
};

export const decodeGetExternalActionResultV1 = (
  value: unknown,
  path = 'result',
): GetExternalActionResultV1 => {
  const object = strictObject(value, ['schemaVersion', 'action'], path);
  decodeSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    action: decodeExternalActionV1(required(object, 'action', path), `${path}.action`),
  };
};

export const decodeListExternalActionAuditResultV1 = (
  value: unknown,
  path = 'result',
): ListExternalActionAuditResultV1 => {
  const object = strictObject(value, ['schemaVersion', 'events', 'nextCursor'], path);
  decodeSchemaVersion(object, path);
  const events = arrayValue(required(object, 'events', path), `${path}.events`);
  if (events.length > EXTERNAL_ACTION_QUEUE_PAGE_SIZE_CAP) {
    return fail(
      `${path}.events`,
      `must not exceed ${EXTERNAL_ACTION_QUEUE_PAGE_SIZE_CAP} audit events`,
    );
  }
  return {
    schemaVersion: '1.0.0',
    events: events.map((entry, index) =>
      decodeActionAuditEventV1(entry, `${path}.events[${index}]`),
    ),
    nextCursor: optionalText(object.nextCursor, `${path}.nextCursor`),
  };
};

export const decodeGetExternalActionDetailResultV1 = (
  value: unknown,
  path = 'result',
): GetExternalActionDetailResultV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'action',
      'manifest',
      'riskDecision',
      'approval',
      'preflight',
      'execution',
      'attempts',
      'verification',
      'result',
      'rollback',
      'compensation',
      'credential',
      'budget',
    ],
    path,
  );
  decodeSchemaVersion(object, path);
  const action = decodeExternalActionV1(required(object, 'action', path), `${path}.action`);
  const manifest =
    object.manifest === undefined
      ? undefined
      : decodeActionManifestV1(object.manifest, `${path}.manifest`);
  const riskDecision =
    object.riskDecision === undefined
      ? undefined
      : decodeRiskDecisionV1(object.riskDecision, `${path}.riskDecision`);
  const approval =
    object.approval === undefined
      ? undefined
      : decodeExternalActionApprovalV1(object.approval, `${path}.approval`);
  const preflight =
    object.preflight === undefined
      ? undefined
      : decodePreflightV1(object.preflight, `${path}.preflight`);
  const execution =
    object.execution === undefined
      ? undefined
      : decodeExecutionV1(object.execution, `${path}.execution`);
  const verification =
    object.verification === undefined
      ? undefined
      : decodeVerificationV1(object.verification, `${path}.verification`);
  const result =
    object.result === undefined ? undefined : decodeResultV1(object.result, `${path}.result`);
  const rollback =
    object.rollback === undefined
      ? undefined
      : decodeRollbackV1(object.rollback, `${path}.rollback`);
  const compensation =
    object.compensation === undefined
      ? undefined
      : decodeCompensatingActionV1(object.compensation, `${path}.compensation`);
  // Nested binding: every embedded resource must belong to the same Action and
  // Project (fail-closed cross-project boundary).
  if (manifest !== undefined) {
    assertSameAction(manifest, action.actionId, `${path}.manifest`);
    assertSameProjectBinding(manifest, action, `${path}.manifest`);
  }
  if (riskDecision !== undefined) {
    assertSameAction(riskDecision, action.actionId, `${path}.riskDecision`);
    assertSameProjectBinding(riskDecision, action, `${path}.riskDecision`);
  }
  if (approval !== undefined) {
    assertSameAction(approval, action.actionId, `${path}.approval`);
    assertSameProjectBinding(approval, action, `${path}.approval`);
  }
  if (preflight !== undefined) {
    assertSameAction(preflight, action.actionId, `${path}.preflight`);
    assertSameProjectBinding(preflight, action, `${path}.preflight`);
  }
  if (execution !== undefined) {
    assertSameAction(execution, action.actionId, `${path}.execution`);
    assertSameProjectBinding(execution, action, `${path}.execution`);
  }
  if (verification !== undefined) {
    assertSameAction(verification, action.actionId, `${path}.verification`);
    assertSameProjectBinding(verification, action, `${path}.verification`);
  }
  if (result !== undefined) {
    assertSameAction(result, action.actionId, `${path}.result`);
    assertSameProjectBinding(result, action, `${path}.result`);
  }
  if (rollback !== undefined) {
    assertSameAction(rollback, action.actionId, `${path}.rollback`);
    assertSameProjectBinding(rollback, action, `${path}.rollback`);
  }
  if (compensation !== undefined) {
    // The Compensating Action is a new External Action; it binds to the
    // detailed action through sourceActionId, not its own actionId.
    if (compensation.sourceActionId !== action.actionId) {
      return fail(`${path}.compensation.sourceActionId`, 'must match the enclosing action');
    }
    assertSameProjectBinding(compensation, action, `${path}.compensation`);
  }
  const attempts = decodeAttemptList(required(object, 'attempts', path), `${path}.attempts`, {
    actionId: action.actionId,
    executionId: execution?.executionId,
    project: {
      resourceProjectId: action.resourceProjectId,
      effectiveProjectId: action.effectiveProjectId,
    },
    expectedCount: execution?.attemptCount,
    latestAttemptRef: execution?.latestAttemptRef,
  });
  return {
    schemaVersion: '1.0.0',
    action,
    manifest,
    riskDecision,
    approval,
    preflight,
    execution,
    attempts,
    verification,
    result,
    rollback,
    compensation,
    credential:
      object.credential === undefined
        ? undefined
        : decodeExternalActionCredentialViewV1(object.credential, `${path}.credential`),
    budget:
      object.budget === undefined
        ? undefined
        : decodeExternalActionBudgetViewV1(object.budget, `${path}.budget`),
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
