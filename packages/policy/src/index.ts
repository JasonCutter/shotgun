import {
  GENERATIVE_AI_PROVIDER_ID,
  type AnyEnvelope,
  ShotgunError,
} from '../../contracts/src/index.js';
import type {
  ActionRiskDecision,
  ActionRiskInput,
  ActionRiskLevel,
} from '../../contracts/src/index.js';
import type { RequiredSecurityContext } from '../../module-sdk/src/index.js';
import type { AIStandingProcessingPolicy } from '../../contracts/src/index.js';

export const STANDING_AI_PROCESSING_POLICY_VERSION = 'project-standing-ai-processing:v1';
export const STANDING_AI_SUPPORTED_PROVIDER_IDS = ['deepseek', 'openai', 'google-gemini'] as const;

export type StandingAIProcessingPolicy = AIStandingProcessingPolicy;

export type StandingAIProcessingPolicyReaderPort = {
  getCurrent(projectId: string): Promise<StandingAIProcessingPolicy | undefined>;
};

export type StandingAIProcessingPolicyRepositoryPort = StandingAIProcessingPolicyReaderPort & {
  saveRevision(input: {
    readonly expectedRevision: number;
    readonly next: StandingAIProcessingPolicy;
  }): Promise<'CREATED' | 'UPDATED' | 'CONFLICT'>;
};

export type StandingAIProcessingPolicyWriterPort = StandingAIProcessingPolicyReaderPort & {
  save(input: {
    readonly projectId: string;
    readonly expectedRevision: number;
    readonly enabled: boolean;
    readonly providerId: string;
    readonly aiConfigurationRevision: number;
    readonly changedBy: string;
    readonly now?: string;
  }): Promise<StandingAIProcessingPolicy>;
};

export type StandingAIProcessingDecision = {
  readonly eligible: boolean;
  readonly reason:
    | 'ELIGIBLE'
    | 'STANDING_POLICY_DISABLED'
    | 'STANDING_POLICY_PROVIDER_MISMATCH'
    | 'DEPLOYMENT_POLICY_BLOCKED'
    | 'RESTRICTED_CONTEXT_BLOCKED'
    | 'NOT_CONFIGURED';
};

const standingNormalize = (name: string, value: string, maxLength = 256): string => {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new ShotgunError({
      code: 'VALIDATION_ERROR',
      safeMessage: `${name} is invalid.`,
      module: 'standing-ai-processing-policy',
      operation: 'validate',
    });
  }
  return normalized;
};

export const evaluateStandingAIProcessingPolicy = (input: {
  readonly policy: StandingAIProcessingPolicy | undefined;
  readonly providerId: string;
  readonly sensitivity: 'public' | 'internal' | 'private' | 'restricted';
  readonly deploymentAllowsPrivate: boolean;
}): StandingAIProcessingDecision => {
  if (input.sensitivity === 'restricted') {
    return { eligible: false, reason: 'RESTRICTED_CONTEXT_BLOCKED' };
  }
  if (!input.policy) return { eligible: false, reason: 'NOT_CONFIGURED' };
  if (!input.policy.enabled) return { eligible: false, reason: 'STANDING_POLICY_DISABLED' };
  if (input.policy.providerId !== input.providerId.trim()) {
    return { eligible: false, reason: 'STANDING_POLICY_PROVIDER_MISMATCH' };
  }
  if (input.sensitivity === 'private' && !input.deploymentAllowsPrivate) {
    return { eligible: false, reason: 'DEPLOYMENT_POLICY_BLOCKED' };
  }
  return { eligible: true, reason: 'ELIGIBLE' };
};

export class StandingAIProcessingPolicyService implements StandingAIProcessingPolicyWriterPort {
  constructor(
    private readonly repository: StandingAIProcessingPolicyRepositoryPort,
    private readonly options: { readonly enforceDeepSeekOnly?: boolean } = {},
  ) {}

  getCurrent(projectId: string): Promise<StandingAIProcessingPolicy | undefined> {
    return this.repository.getCurrent(standingNormalize('Project ID', projectId));
  }

  async save(input: Parameters<StandingAIProcessingPolicyWriterPort['save']>[0]) {
    const projectId = standingNormalize('Project ID', input.projectId);
    const providerId = standingNormalize('Provider ID', input.providerId, 128);
    const changedBy = standingNormalize('Principal ID', input.changedBy);
    if (!(STANDING_AI_SUPPORTED_PROVIDER_IDS as readonly string[]).includes(providerId)) {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: 'Provider is not registered.',
        module: 'standing-ai-processing-policy',
        operation: 'save',
      });
    }
    if (this.options.enforceDeepSeekOnly === true && providerId !== GENERATIVE_AI_PROVIDER_ID) {
      throw new ShotgunError({
        code: 'POLICY_DENIED',
        safeMessage: 'New automatic AI processing must use the canonical DeepSeek provider.',
        module: 'standing-ai-processing-policy',
        operation: 'save',
      });
    }
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: 'Standing policy revision is invalid.',
        module: 'standing-ai-processing-policy',
        operation: 'save',
      });
    }
    if (!Number.isSafeInteger(input.aiConfigurationRevision) || input.aiConfigurationRevision < 0) {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: 'AI configuration revision is invalid.',
        module: 'standing-ai-processing-policy',
        operation: 'save',
      });
    }
    const next: StandingAIProcessingPolicy = Object.freeze({
      projectId,
      enabled: input.enabled,
      providerId,
      policyRevision: input.expectedRevision + 1,
      aiConfigurationRevision: input.aiConfigurationRevision,
      changedBy,
      changedAt: input.now ?? new Date().toISOString(),
    });
    const outcome = await this.repository.saveRevision({
      expectedRevision: input.expectedRevision,
      next,
    });
    if (outcome === 'CONFLICT') {
      throw new ShotgunError({
        code: 'CONFLICT',
        safeMessage: 'Standing AI processing policy changed; reload Project settings and retry.',
        module: 'standing-ai-processing-policy',
        operation: 'save',
      });
    }
    return next;
  }
}

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
