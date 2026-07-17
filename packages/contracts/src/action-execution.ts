import type { Actor, SecurityContext } from './types.js';
import { sha256Text, stableJson } from './document-evidence.js';

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
  readonly parameters: {
    readonly title: string;
    readonly body: string;
  };
  readonly validation: {
    readonly status: 'VALIDATED';
    readonly validationId: string;
    readonly validatedAt: string;
    readonly evidenceIds: readonly string[];
  };
  readonly requestedAt: string;
  readonly compensationForActionId?: string;
};

export type ActionRiskDecision = {
  readonly level: ActionRiskLevel;
  readonly policyVersion: string;
  readonly requiresUserApproval: boolean;
  readonly reasons: readonly string[];
};

export type ActionPreview = {
  readonly actionId: string;
  readonly projectId: string;
  readonly candidate: ValidatedActionCandidate;
  readonly candidateDigest: string;
  readonly targetDigest: string;
  readonly parameterDigest: string;
  readonly previewDigest: string;
  readonly riskDecision: ActionRiskDecision;
  readonly createdAt: string;
};

export type ActionApprovalToken = {
  readonly tokenId: string;
  readonly actionId: string;
  readonly candidateRevision: number;
  readonly targetDigest: string;
  readonly parameterDigest: string;
  readonly previewDigest: string;
  readonly approvedBy: Actor;
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
  readonly approval?: ActionApprovalToken;
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

export const actionPreviewDigest = (
  candidate: ValidatedActionCandidate,
  riskDecision: ActionRiskDecision,
): string =>
  sha256Text(
    stableJson({
      candidateDigest: actionCandidateDigest(candidate),
      targetDigest: actionTargetDigest(candidate),
      parameterDigest: actionParameterDigest(candidate),
      riskDecision,
    }),
  );

export type ActionRiskInput = {
  readonly operation: ActionOperation;
  readonly sensitivity: SecurityContext['sensitivity'];
  readonly compensation: boolean;
};
