import type { Actor, SecurityContext } from './types.js';
import { sha256Text, stableJson, type EvidenceSpan } from './document-evidence.js';
import type { ValidationResult } from './ai-candidate-validation.js';

export type ActionRiskLevel = 'R0' | 'R1' | 'R2' | 'R3' | 'R4';

export type ActionOperation =
  | 'PREVIEW_ONLY'
  | 'CREATE_DRAFT'
  | 'UPDATE_REVERSIBLE'
  | 'PUBLISH_OR_DELETE'
  | 'FINANCIAL_OR_LEGAL';

export type ValidatedActionCandidate = {
  readonly candidateId: string;
  readonly revisionNumber: number;
  readonly operation: ActionOperation;
  readonly target: {
    readonly connectorId: string;
    readonly accountRef: string;
    readonly destination: string;
  };
  readonly parameters: { readonly title: string; readonly body: string };
  readonly validation: {
    readonly status: 'VALIDATED';
    readonly validationId: string;
    readonly validatedAt: string;
    readonly evidenceIds: readonly string[];
  };
  readonly requestedAt: string;
  readonly compensationForActionId?: string;
};

export type ActionEvidenceReference = { readonly evidenceId: string; readonly digest: string };

/** An Action input that is staged by a trusted module, never by the HTTP client. */
export type ServerActionCandidate = {
  readonly projectId: string;
  readonly candidate: ValidatedActionCandidate;
  readonly allowedOperationKeys: readonly ActionOperation[];
  readonly validationDigest: string;
  readonly evidence: readonly ActionEvidenceReference[];
  readonly sourceSensitivity: SecurityContext['sensitivity'];
};

export type ActionRiskDecision = {
  readonly level: ActionRiskLevel;
  readonly policyVersion: string;
  readonly requiresUserApproval: boolean;
  readonly reasons: readonly string[];
};

export type ActionApprovalPolicy = {
  readonly approvalPolicyVersion: string;
  readonly requiredApproverRule: string;
  readonly selfApprovalAllowed: boolean;
  readonly requiredApprovalCount: 1;
  readonly requiredScope: 'action:approve';
};

/** Immutable server-generated Preview Snapshot. */
export type ActionPreview = {
  readonly actionId: string;
  readonly snapshotId: string;
  readonly snapshotSchemaVersion: 'action-preview-snapshot-v1';
  readonly canonicalSerializer: 'action-preview-canonical-v1';
  readonly hashAlgorithm: 'SHA-256';
  readonly projectId: string;
  readonly candidate: ValidatedActionCandidate;
  readonly candidateDigest: string;
  readonly validationDigest: string;
  readonly evidence: readonly ActionEvidenceReference[];
  readonly evidenceSetDigest: string;
  readonly sourceSensitivity: SecurityContext['sensitivity'];
  readonly targetDigest: string;
  readonly parameterDigest: string;
  readonly renderedPayload: { readonly title: string; readonly body: string };
  readonly payloadDigest: string;
  readonly connectorId: string;
  readonly operationKey: ActionOperation;
  readonly riskDecision: ActionRiskDecision;
  readonly approvalPolicy: ActionApprovalPolicy;
  readonly requesterPrincipalId: string;
  readonly expiryPolicyVersion: 'action-preview-expiry-v1';
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly previewDigest: string;
};

/** Server-stored approval. Its ID is the only value accepted by Execute. */
export type ActionApprovalRecord = {
  readonly approvalId: string;
  readonly actionId: string;
  readonly snapshotId: string;
  readonly snapshotDigest: string;
  readonly candidateRevision: number;
  readonly approvedBy: Actor;
  readonly approvalPolicy: ActionApprovalPolicy;
  readonly approvedAt: string;
  readonly expiresAt: string;
};

export type ProviderActionResult = {
  readonly provider: string;
  readonly externalId: string;
  readonly idempotencyKey: string;
  readonly observedDigest: string;
  readonly completedAt: string;
};

export type ActionVerification = {
  readonly status: 'APPLIED' | 'NOT_APPLIED' | 'MISMATCH';
  readonly provider: string;
  readonly observedDigest?: string;
  readonly verifiedAt: string;
};

export type ActionExecutionStatus =
  | 'PREVIEW_READY'
  | 'APPROVED'
  | 'EXECUTING'
  | 'PREFLIGHT_FAILED'
  | 'EXECUTED'
  | 'OUTCOME_UNKNOWN'
  | 'FAILED'
  | 'VERIFIED'
  | 'VERIFICATION_FAILED';

export type ActionExecutionRecord = {
  readonly actionId: string;
  readonly projectId: string;
  readonly status: ActionExecutionStatus;
  readonly preview: ActionPreview;
  readonly approval?: ActionApprovalRecord;
  readonly providerResult?: ProviderActionResult;
  readonly verification?: ActionVerification;
  readonly failureReason?: string;
  readonly canonicalWrite: false;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type ActionAuditCategory =
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

export type ActionAuditEvent = {
  readonly auditEventId: string;
  readonly actionId: string;
  readonly projectId: string;
  readonly sequence: number;
  readonly category: ActionAuditCategory;
  readonly actorId: string;
  readonly policyVersion: string;
  readonly details: Readonly<Record<string, string | number | boolean>>;
  readonly occurredAt: string;
};

export type ActionFeedback = {
  readonly actionId: string;
  readonly status: 'VERIFIED' | 'OUTCOME_UNKNOWN' | 'FAILED';
  readonly reentryPhase: 'ACTION_REVIEW';
  readonly occurredAt: string;
};

export const actionCandidateDigest = (candidate: ValidatedActionCandidate): string =>
  sha256Text(stableJson(candidate));
export const actionTargetDigest = (candidate: ValidatedActionCandidate): string =>
  sha256Text(stableJson(candidate.target));
export const actionParameterDigest = (candidate: ValidatedActionCandidate): string =>
  sha256Text(stableJson(candidate.parameters));
export const actionEvidenceSetDigest = (evidence: readonly ActionEvidenceReference[]): string =>
  sha256Text(
    stableJson(
      [...evidence].sort((left, right) => left.evidenceId.localeCompare(right.evidenceId)),
    ),
  );
export const actionPayloadDigest = (payload: ActionPreview['renderedPayload']): string =>
  sha256Text(stableJson(payload));

export const actionPreviewDigest = (
  preview: Omit<ActionPreview, 'previewDigest'> | ActionPreview,
): string => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { previewDigest, ...canonical } = preview as ActionPreview;
  return sha256Text(stableJson(canonical));
};

export const validationResultDigest = (
  validation: ValidationResult & { invalidatedAt?: string; expiresAt?: string },
): string =>
  sha256Text(
    stableJson({
      schemaVersion: '1.0',
      validationId: validation.validationId,
      candidateId: validation.candidateId,
      revisionNumber: validation.revisionNumber,
      projectId: validation.projectId,
      sourceVersionId: validation.sourceVersionId,
      status: validation.status,
      dimensions: validation.dimensions,
      createdAt: validation.createdAt,
      invalidatedAt: validation.invalidatedAt,
      expiresAt: validation.expiresAt,
    }),
  );

export const actionEvidenceRecordDigest = (span: EvidenceSpan): string =>
  sha256Text(
    stableJson({
      schemaVersion: '1.0',
      evidenceId: span.evidenceId,
      revisionId: span.revisionId,
      projectId: span.projectId,
      sourceId: span.sourceId,
      sourceVersionId: span.sourceVersionId,
      pointer: span.pointer,
      nodeKind: span.nodeKind,
      position: span.position,
      quote: span.quote,
      selectors: span.selectors,
      exactHash: span.exactHash,
      accessScope: span.accessScope,
      sensitivity: span.sensitivity,
      createdAt: span.createdAt,
    }),
  );

export type ActionRiskInput = {
  readonly operation: ActionOperation;
  readonly sensitivity: SecurityContext['sensitivity'];
  readonly compensation: boolean;
};
