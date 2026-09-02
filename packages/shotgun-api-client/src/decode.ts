import {
  decodeProductFailureEnvelope,
  decodeProductSessionView as decodeProductSessionViewV1,
  decodeProductSessionViewV2,
  decodeSessionBoundaryView as decodeLegacySessionBoundaryView,
} from '../../contracts/src/index.js';
import type {
  AICredentialMetadata,
  AIProviderPrivacyProposal,
  AISettingsApproval,
  AISettingsConfiguration,
  AISettingsCredentialStatus,
  AISettingsPrivacyStatus,
  AISettingsProvider,
  AISettingsProviderModel,
  AISettingsReadModel,
  AIStandingProcessingPolicy,
  AITestConnectionResult,
  ProductApiErrorBody,
  ProductSessionView,
  SessionBoundaryView,
} from './contracts.js';
import { invalidProductApiResponse } from './errors.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const nonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export const decodeProductSessionView = (value: unknown): ProductSessionView => {
  if (!isRecord(value)) throw invalidProductApiResponse();
  try {
    if (value.apiVersion === '2.0.0') return decodeProductSessionViewV2(value);
    if (value.apiVersion === '1.0.0') return decodeProductSessionViewV1(value);
  } catch {
    throw invalidProductApiResponse();
  }
  throw invalidProductApiResponse();
  /*
   * The explicit contract decoders above are the authority. This legacy block
   * remains unreachable only until the V1-shaped manual decoder is removed in
   * a separately approved compatibility cleanup.
   */
  /*
  const principal = value.principal;
  const activeProject = value.activeProject;
  const accessibleProjects = value.accessibleProjects;
  const session = value.session;
  if (
    !isRecord(principal) ||
    !nonEmptyString(principal.id) ||
    !isRecord(principal.actor) ||
    !['user', 'service'].includes(String(principal.actor.type)) ||
    !nonEmptyString(principal.actor.id) ||
    !['session', 'development'].includes(String(principal.authenticationMethod)) ||
    !isRecord(activeProject) ||
    !nonEmptyString(activeProject.id) ||
    !Array.isArray(accessibleProjects) ||
    !isRecord(session) ||
    !(session.expiresAt === null || typeof session.expiresAt === 'string')
  ) {
    throw invalidProductApiResponse();
  }

  const projects = accessibleProjects.map((project) => {
    if (!isRecord(project) || !nonEmptyString(project.id) || typeof project.isOwner !== 'boolean') {
      throw invalidProductApiResponse();
    }
    return { id: project.id, isOwner: project.isOwner };
  });
  if (!projects.some((project) => project.id === activeProject.id)) {
    throw invalidProductApiResponse();
  }

  return {
    apiVersion: '1.0.0',
    principal: {
      id: principal.id,
      actor: {
        type: principal.actor.type as 'user' | 'service',
        id: principal.actor.id,
      },
      authenticationMethod: principal.authenticationMethod as 'session' | 'development',
    },
    activeProject: { id: activeProject.id },
    accessibleProjects: projects,
    session: { expiresAt: session.expiresAt },
  };
  */
};

export const decodeSessionEnvelope = (value: unknown): ProductSessionView => {
  if (!isRecord(value)) throw invalidProductApiResponse();
  return decodeProductSessionView(value.session);
};

export const decodeSessionBoundaryView = (value: unknown): SessionBoundaryView => {
  if (!isRecord(value)) throw invalidProductApiResponse();
  const session =
    value.session === null || value.session === undefined
      ? null
      : decodeProductSessionView(value.session);
  const validationSession =
    session?.apiVersion === '2.0.0'
      ? {
          apiVersion: '1.0.0',
          principal: session.principal,
          activeProject: {
            id: session.activeProject?.id ?? 'boundary-validation-project',
          },
          accessibleProjects: session.activeProject
            ? session.accessibleProjects
            : [{ id: 'boundary-validation-project', isOwner: false }],
          session: session.session,
        }
      : session;
  try {
    const boundary = decodeLegacySessionBoundaryView({
      ...value,
      session: validationSession,
    });
    return { ...boundary, session };
  } catch {
    throw invalidProductApiResponse();
  }
};

export const decodeCsrfEnvelope = (value: unknown): string => {
  if (!isRecord(value) || !nonEmptyString(value.csrfToken)) throw invalidProductApiResponse();
  return value.csrfToken;
};

export const decodeProductApiErrorBody = (value: unknown): ProductApiErrorBody | undefined =>
  decodeProductFailureEnvelope(value);

export const decodeLogoutEnvelope = (value: unknown): void => {
  if (!isRecord(value) || value.message !== 'Logged out') throw invalidProductApiResponse();
};

const aiString = (value: unknown): string => {
  if (!nonEmptyString(value)) throw invalidProductApiResponse();
  return value;
};

const aiNumber = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw invalidProductApiResponse();
  }
  return value;
};

const aiBoolean = (value: unknown): boolean => {
  if (typeof value !== 'boolean') throw invalidProductApiResponse();
  return value;
};

const decodeAIConfiguration = (value: unknown): AISettingsConfiguration => {
  if (!isRecord(value)) throw invalidProductApiResponse();
  return {
    projectId: aiString(value.projectId),
    activeProviderId: aiString(value.activeProviderId),
    activeModelId: aiString(value.activeModelId),
    credentialId: aiString(value.credentialId),
    credentialRevision: aiNumber(value.credentialRevision),
    aiConfigurationRevision: aiNumber(value.aiConfigurationRevision),
    updatedBy: aiString(value.updatedBy),
    updatedAt: aiString(value.updatedAt),
  };
};

const decodeAICredentialStatus = (value: unknown): AISettingsCredentialStatus => {
  if (!isRecord(value)) throw invalidProductApiResponse();
  const lifecycleState = aiString(value.lifecycleState);
  if (!['active', 'superseded', 'revoked', 'removed'].includes(lifecycleState)) {
    throw invalidProductApiResponse();
  }
  return {
    credentialId: aiString(value.credentialId),
    projectId: aiString(value.projectId),
    providerId: aiString(value.providerId),
    credentialRevision: aiNumber(value.credentialRevision),
    lifecycleState: lifecycleState as AISettingsCredentialStatus['lifecycleState'],
    createdAt: aiString(value.createdAt),
    updatedAt: aiString(value.updatedAt),
  };
};

const decodeAICredentialMetadata = (value: unknown): AICredentialMetadata => {
  if (!isRecord(value)) throw invalidProductApiResponse();
  const lifecycleState = aiString(value.lifecycleState);
  if (!['active', 'superseded', 'revoked', 'removed'].includes(lifecycleState)) {
    throw invalidProductApiResponse();
  }
  return {
    credentialId: aiString(value.credentialId),
    projectId: aiString(value.projectId),
    providerId: aiString(value.providerId),
    encryptionVersion: aiString(value.encryptionVersion),
    keyVersion: aiString(value.keyVersion),
    credentialRevision: aiNumber(value.credentialRevision),
    lifecycleState: lifecycleState as AICredentialMetadata['lifecycleState'],
    createdAt: aiString(value.createdAt),
    updatedAt: aiString(value.updatedAt),
  };
};

const decodeAIProviderModel = (value: unknown): AISettingsProviderModel => {
  if (!isRecord(value)) throw invalidProductApiResponse();
  return {
    providerId: aiString(value.providerId),
    modelId: aiString(value.modelId),
    displayName: aiString(value.displayName),
    shotgunUsableCapabilities: Array.isArray(value.shotgunUsableCapabilities)
      ? value.shotgunUsableCapabilities.map(aiString)
      : [],
    capabilityRevision: aiString(value.capabilityRevision),
  };
};

const decodeAIProvider = (value: unknown): AISettingsProvider => {
  if (!isRecord(value) || !Array.isArray(value.models)) throw invalidProductApiResponse();
  const status = aiString(value.status);
  if (status !== 'active' && status !== 'disabled') throw invalidProductApiResponse();
  return {
    providerId: aiString(value.providerId),
    displayName: aiString(value.displayName),
    status,
    models: value.models.map(decodeAIProviderModel),
  };
};

const decodeAIApproval = (value: unknown): AISettingsApproval => {
  if (!isRecord(value)) throw invalidProductApiResponse();
  return {
    projectId: aiString(value.projectId),
    providerId: aiString(value.providerId),
    approved: aiBoolean(value.approved),
    approvalRevision: aiNumber(value.approvalRevision),
    reviewedBy: aiString(value.reviewedBy),
    reviewedAt: aiString(value.reviewedAt),
  };
};

const decodeAIPrivacy = (value: unknown): AISettingsPrivacyStatus => {
  if (!isRecord(value)) throw invalidProductApiResponse();
  return {
    providerId: aiString(value.providerId),
    deploymentAllowed: aiBoolean(value.deploymentAllowed),
    ...(value.approval === undefined ? {} : { approval: decodeAIApproval(value.approval) }),
    legacyGeminiCompatibility: aiBoolean(value.legacyGeminiCompatibility),
  };
};

const decodeAIStandingPolicy = (value: unknown): AIStandingProcessingPolicy => {
  if (!isRecord(value)) throw invalidProductApiResponse();
  return {
    projectId: aiString(value.projectId),
    enabled: aiBoolean(value.enabled),
    providerId: aiString(value.providerId),
    policyRevision: aiNumber(value.policyRevision),
    aiConfigurationRevision: aiNumber(value.aiConfigurationRevision),
    changedBy: aiString(value.changedBy),
    changedAt: aiString(value.changedAt),
  };
};

export const decodeAISettingsReadModel = (value: unknown): AISettingsReadModel => {
  if (!isRecord(value) || !Array.isArray(value.providers)) throw invalidProductApiResponse();
  const mode = aiString(value.mode);
  if (!['LEGACY_GEMINI_COMPATIBILITY', 'PROJECT_MANAGED', 'UNCONFIGURED'].includes(mode)) {
    throw invalidProductApiResponse();
  }
  if (!Array.isArray(value.credentialStatuses) || !Array.isArray(value.privacy)) {
    throw invalidProductApiResponse();
  }
  if (!isRecord(value.vaultAvailability)) throw invalidProductApiResponse();
  const vaultState = aiString(value.vaultAvailability.state);
  if (vaultState === 'AVAILABLE') {
    aiString(value.vaultAvailability.keyVersion);
  } else if (vaultState === 'UNAVAILABLE') {
    const reason = aiString(value.vaultAvailability.reason);
    if (
      !['MISSING_MASTER_KEY', 'MALFORMED_MASTER_KEY', 'UNSUPPORTED_MASTER_KEY_VERSION'].includes(
        reason,
      )
    ) {
      throw invalidProductApiResponse();
    }
  } else {
    throw invalidProductApiResponse();
  }
  if (value.defaultProviderId !== 'deepseek') throw invalidProductApiResponse();
  return {
    projectId: aiString(value.projectId),
    mode: mode as AISettingsReadModel['mode'],
    defaultProviderId: 'deepseek',
    ...(value.currentConfiguration === undefined
      ? {}
      : { currentConfiguration: decodeAIConfiguration(value.currentConfiguration) }),
    providers: value.providers.map(decodeAIProvider),
    credentialStatuses: value.credentialStatuses.map(decodeAICredentialStatus),
    privacy: value.privacy.map(decodeAIPrivacy),
    ...(value.standingPolicy === undefined
      ? {}
      : { standingPolicy: decodeAIStandingPolicy(value.standingPolicy) }),
    vaultAvailability:
      vaultState === 'AVAILABLE'
        ? { state: 'AVAILABLE', keyVersion: aiString(value.vaultAvailability.keyVersion) }
        : {
            state: 'UNAVAILABLE',
            reason: aiString(value.vaultAvailability.reason) as
              'MISSING_MASTER_KEY' | 'MALFORMED_MASTER_KEY' | 'UNSUPPORTED_MASTER_KEY_VERSION',
          },
    legacyGeminiCredentialConfigured: aiBoolean(value.legacyGeminiCredentialConfigured),
  };
};

export const decodeAICredentialMetadataEnvelope = (value: unknown): AICredentialMetadata =>
  decodeAICredentialMetadata(value);

export const decodeAISettingsApprovalEnvelope = (value: unknown): AISettingsApproval =>
  decodeAIApproval(value);

export const decodeAIStandingPolicyEnvelope = (value: unknown): AIStandingProcessingPolicy =>
  decodeAIStandingPolicy(value);

export const decodeAIProviderPrivacyProposalEnvelope = (
  value: unknown,
): AIProviderPrivacyProposal => {
  if (!isRecord(value)) throw invalidProductApiResponse();
  const status = aiString(value.status);
  if (!['PROPOSED', 'APPROVED', 'REJECTED'].includes(status)) {
    throw invalidProductApiResponse();
  }
  return {
    proposalId: aiString(value.proposalId),
    projectId: aiString(value.projectId),
    providerId: aiString(value.providerId),
    approved: aiBoolean(value.approved),
    expectedApprovalRevision: aiNumber(value.expectedApprovalRevision),
    proposedBy: aiString(value.proposedBy),
    status: status as AIProviderPrivacyProposal['status'],
    createdAt: aiString(value.createdAt),
  };
};

export const decodeAIConfigurationEnvelope = (value: unknown): AISettingsConfiguration =>
  decodeAIConfiguration(value);

export const decodeAITestConnectionResult = (value: unknown): AITestConnectionResult => {
  if (!isRecord(value)) throw invalidProductApiResponse();
  const status = aiString(value.status);
  if (
    ![
      'CONNECTED',
      'AUTHENTICATION_FAILED',
      'MODEL_UNAVAILABLE',
      'RATE_LIMITED',
      'TEMPORARILY_UNAVAILABLE',
      'FAILED',
    ].includes(status)
  ) {
    throw invalidProductApiResponse();
  }
  return {
    providerId: aiString(value.providerId),
    modelId: aiString(value.modelId),
    status: status as AITestConnectionResult['status'],
    checkedAt: aiString(value.checkedAt),
    safeMessage: aiString(value.safeMessage),
    ...(typeof value.errorCode === 'string' ? { errorCode: value.errorCode } : {}),
    ...(typeof value.providerRequestId === 'string'
      ? { providerRequestId: value.providerRequestId }
      : {}),
  };
};
