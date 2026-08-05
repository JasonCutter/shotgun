import {
  FRONTEND_EXTERNAL_ACTION_DOMAIN_VERSION,
  type ActionManifestV1,
  type ExecutionAttemptStatusV1,
  type ExternalActionAggregateStatusV1,
  type ExternalActionApprovalStatusV1,
  type ExternalActionApprovalV1,
  type ExternalActionBudgetViewV1,
  type ExternalActionCredentialViewV1,
  type ExternalActionResourceRefV1,
  type ExternalActionTargetRefV1,
  type PreflightV1,
  externalActionManifestDigest as externalActionManifestDigestFor,
} from '../../../packages/contracts/src/index.js';

/**
 * FE-P4-S2 External Action pure domain helpers. These functions never touch
 * persistence, the Command Ledger or the Stage 11 engine; they compute
 * Product-level values that the coordinator enforces. Server-authoritative:
 * the browser never asserts Actor, Project, Capability, Policy, Credential or
 * Budget here.
 */

export const externalActionResourceRef = (
  resourceKind: ExternalActionResourceRefV1['resourceKind'],
  resourceId: string,
  resourceRevision?: number,
): ExternalActionResourceRefV1 => ({
  schemaVersion: '1.0.0',
  resourceKind,
  resourceId,
  ...(resourceRevision === undefined ? {} : { resourceRevision }),
});

/** Mask a raw secret for a credential view (never the secret itself). */
export const maskCredential = (secret: string): string => {
  if (secret.length <= 8) return '•'.repeat(secret.length);
  return `${secret.slice(0, 2)}${'•'.repeat(Math.min(12, secret.length - 4))}${secret.slice(-2)}`;
};

export type CredentialStatusV1 = 'CONFIGURED' | 'MISSING' | 'REVOKED' | 'ROTATION_REQUIRED';

export const credentialViewFrom = (input: {
  readonly connectorId: string;
  readonly name: string;
  readonly status: CredentialStatusV1;
  readonly secret?: string;
  readonly capabilities: readonly ('TEST' | 'ROTATE' | 'REVOKE')[];
}): ExternalActionCredentialViewV1 => ({
  schemaVersion: '1.0.0',
  connectorId: input.connectorId,
  name: input.name,
  status: input.status,
  ...(input.secret === undefined ? {} : { maskedCredential: maskCredential(input.secret) }),
  capabilities: input.capabilities,
});

export const budgetViewFrom = (input: {
  readonly projectId: string;
  readonly usedExecutions: number;
  readonly remainingExecutions: number;
  readonly softLimit: number;
  readonly hardLimit: number;
}): ExternalActionBudgetViewV1 => {
  const exhausted = input.hardLimit > 0 && input.usedExecutions >= input.hardLimit;
  const status: ExternalActionBudgetViewV1['status'] =
    exhausted || input.remainingExecutions <= 0
      ? 'EXHAUSTED'
      : input.softLimit > 0 && input.usedExecutions >= input.softLimit
        ? 'WARNING'
        : 'OK';
  return {
    schemaVersion: '1.0.0',
    projectId: input.projectId,
    status,
    usedExecutions: input.usedExecutions,
    remainingExecutions: input.remainingExecutions,
    softLimit: input.softLimit,
    hardLimit: input.hardLimit,
    exhausted,
  };
};

/** Whether an attempt/execution status is terminal (frozen contract). */
export const isTerminalAttemptStatus = (status: ExecutionAttemptStatusV1): boolean =>
  status === 'SUCCEEDED' || status === 'FAILED' || status === 'CANCELLED';

/** An ACTIVE approval is valid only while its expiry is in the future. */
export const approvalIsActive = (approval: ExternalActionApprovalV1, nowIso: string): boolean =>
  approval.status === 'ACTIVE' && Date.parse(approval.expiresAt) > Date.parse(nowIso);

export const approvalStatusFor = (
  approval: ExternalActionApprovalV1,
  nowIso: string,
): ExternalActionApprovalStatusV1 => {
  if (approval.status !== 'ACTIVE') return approval.status;
  return Date.parse(approval.expiresAt) <= Date.parse(nowIso) ? 'EXPIRED' : 'ACTIVE';
};

/**
 * The six revalidation flags a READY Preflight requires (frozen contract):
 * permission, credential, budget, policy, target state, external revision.
 * Product-side flags (permission/credential/budget/policy) come from the
 * server-derived scope and repositories; target-state/external-revision come
 * from the engine adapter.
 */
export const preflightRevalidationFlags = (input: {
  readonly permissionRevalidated: boolean;
  readonly credentialRevalidated: boolean;
  readonly budgetRevalidated: boolean;
  readonly policyRevalidated: boolean;
  readonly targetStateRevalidated: boolean;
  readonly externalRevisionRevalidated: boolean;
}): PreflightV1['status'] => {
  const allPass =
    input.permissionRevalidated &&
    input.credentialRevalidated &&
    input.budgetRevalidated &&
    input.policyRevalidated &&
    input.targetStateRevalidated &&
    input.externalRevisionRevalidated;
  return allPass ? 'READY' : 'DENIED';
};

/**
 * A READY Preflight is valid only while its expiry is in the future and its
 * manifest revision matches the pinned manifest revision.
 */
export const preflightIsReady = (
  preflight: PreflightV1,
  manifestRevision: number,
  nowIso: string,
): boolean =>
  preflight.status === 'READY' &&
  preflight.manifestRevision === manifestRevision &&
  Date.parse(preflight.expiresAt) > Date.parse(nowIso);

/**
 * External Action aggregate status transition (frozen 20-value enum). The
 * coordinator drives these transitions through governed commands; helpers here
 * derive the next aggregate state from a lifecycle event.
 */
export const aggregateStatusAfter = (
  current: ExternalActionAggregateStatusV1,
  event:
    | 'CANDIDATE_VALIDATED'
    | 'MANIFEST_READY'
    | 'APPROVED'
    | 'PREFLIGHT_READY'
    | 'PREFLIGHT_FAILED'
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
    | 'COMPENSATED',
): ExternalActionAggregateStatusV1 => {
  switch (event) {
    case 'CANDIDATE_VALIDATED':
      return 'CANDIDATE_VALIDATED';
    case 'MANIFEST_READY':
      return 'MANIFEST_READY';
    case 'APPROVED':
      return 'APPROVED';
    case 'PREFLIGHT_READY':
      return current === 'APPROVED' || current === 'MANIFEST_READY'
        ? 'PREFLIGHT_READY'
        : 'PREFLIGHT_READY';
    case 'PREFLIGHT_FAILED':
      return 'PREFLIGHT_FAILED';
    case 'EXECUTING':
      return 'EXECUTING';
    case 'OUTCOME_UNKNOWN':
      return 'OUTCOME_UNKNOWN';
    case 'FAILED':
      return 'FAILED';
    case 'CANCELLING':
      return 'CANCELLING';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'VERIFYING':
      return 'VERIFYING';
    case 'VERIFIED':
      return 'VERIFIED';
    case 'VERIFICATION_FAILED':
      return 'VERIFICATION_FAILED';
    case 'ROLLBACK_AVAILABLE':
      return 'ROLLBACK_AVAILABLE';
    case 'ROLLING_BACK':
      return 'ROLLING_BACK';
    case 'ROLLED_BACK':
      return 'ROLLED_BACK';
    case 'COMPENSATION_REQUIRED':
      return 'COMPENSATION_REQUIRED';
    case 'COMPENSATING':
      return 'COMPENSATING';
    case 'COMPENSATED':
      return 'COMPENSATED';
  }
};

/** Server-side command digest for a manifest payload (contract helper). */
export const manifestDigestFor = (
  manifest: Pick<
    ActionManifestV1,
    | 'manifestId'
    | 'manifestRevision'
    | 'actionId'
    | 'targetId'
    | 'targetRevision'
    | 'targetDigest'
    | 'externalRevision'
    | 'parameterRef'
    | 'parameterDigest'
    | 'evidenceSetRef'
    | 'evidenceSetDigest'
    | 'payloadDigest'
  >,
): string => externalActionManifestDigestFor(manifest);

/** Target identity equality (used to detect target changes). */
export const targetRefsEqual = (
  a: ExternalActionTargetRefV1,
  b: ExternalActionTargetRefV1,
): boolean =>
  a.targetId === b.targetId &&
  a.targetRevision === b.targetRevision &&
  a.externalRevision === b.externalRevision &&
  a.targetKind === b.targetKind;

/** Shared domain version tag (must match the frozen contract). */
export const EXTERNAL_ACTION_DOMAIN_VERSION = FRONTEND_EXTERNAL_ACTION_DOMAIN_VERSION;

/** Re-export the frozen server manifest digest helper. */
export { externalActionManifestDigestFor };
