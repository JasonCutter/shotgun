import { type AnyEnvelope, ShotgunError } from '../../contracts/src/index.js';
import type {
  ActionRiskDecision,
  ActionRiskInput,
  ActionRiskLevel,
} from '../../contracts/src/index.js';
import type { RequiredSecurityContext } from '../../module-sdk/src/index.js';

export const ACTION_RISK_POLICY_VERSION = 'stage11.action-risk.v1';

const operationRisk: Record<ActionRiskInput['operation'], ActionRiskLevel> = {
  PREVIEW_ONLY: 'R0',
  CREATE_DRAFT: 'R1',
  UPDATE_REVERSIBLE: 'R2',
  PUBLISH_OR_DELETE: 'R3',
  FINANCIAL_OR_LEGAL: 'R4',
};

const riskRank: Record<ActionRiskLevel, number> = { R0: 0, R1: 1, R2: 2, R3: 3, R4: 4 };

const higherRisk = (left: ActionRiskLevel, right: ActionRiskLevel): ActionRiskLevel =>
  riskRank[left] >= riskRank[right] ? left : right;

export const decideActionRisk = (input: ActionRiskInput): ActionRiskDecision => {
  const base = operationRisk[input.operation];
  const sensitivityFloor = input.sensitivity === 'restricted' ? 'R3' : base;
  const compensationFloor = input.compensation ? 'R2' : base;
  const level = higherRisk(higherRisk(base, sensitivityFloor), compensationFloor);
  const reasons = [`Operation ${input.operation} maps to ${base}.`];
  if (input.sensitivity === 'restricted') reasons.push('Restricted data requires at least R3.');
  if (input.compensation) reasons.push('Compensation is a separate action requiring at least R2.');
  return {
    level,
    policyVersion: ACTION_RISK_POLICY_VERSION,
    requiresUserApproval: level !== 'R0',
    reasons,
  };
};

export const assertSecurityContext = (
  envelope: AnyEnvelope,
  requiredContext: readonly RequiredSecurityContext[],
  requiredAccessScopes: readonly string[] = [],
): void => {
  const missing = requiredContext.filter((field) => {
    if (field === 'actor') {
      return !envelope.actor;
    }
    if (field === 'project') {
      return !envelope.projectId;
    }
    if (field === 'access_scope') {
      return !envelope.security?.accessScope.length;
    }
    return !envelope.security?.sensitivity;
  });

  if (missing.length > 0) {
    throw new ShotgunError({
      code: 'POLICY_DENIED',
      safeMessage: `Required security context is missing: ${missing.join(', ')}.`,
      module: 'policy',
      operation: 'authorize-message',
      correlationId: envelope.correlationId,
    });
  }

  const actualScopes = new Set(envelope.security?.accessScope ?? []);
  const deniedScopes = requiredAccessScopes.filter((scope) => !actualScopes.has(scope));
  if (deniedScopes.length > 0) {
    throw new ShotgunError({
      code: 'POLICY_DENIED',
      safeMessage: `Required access scope is missing: ${deniedScopes.join(', ')}.`,
      module: 'policy',
      operation: 'authorize-message',
      correlationId: envelope.correlationId,
    });
  }
};
