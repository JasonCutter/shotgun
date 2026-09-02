export const A4_PROVIDER_PRIVACY_POLICY_REVISION = 'provider-external-transfer-policy:v1';

export const A4_SUPPORTED_PROVIDER_IDS = ['deepseek', 'openai', 'google-gemini'] as const;
export type A4ProviderId = (typeof A4_SUPPORTED_PROVIDER_IDS)[number];
export type ExternalTransferSensitivity = 'public' | 'internal' | 'private' | 'restricted';

export type ProviderExternalTransferApproval = {
  readonly projectId: string;
  readonly providerId: A4ProviderId;
  readonly approved: boolean;
  readonly approvalRevision: number;
  readonly reviewedBy: string;
  readonly reviewedAt: string;
};

export type ProviderExternalTransferApprovalHistoryEntry = ProviderExternalTransferApproval;

export type ProviderExternalTransferApprovalProposal = {
  readonly proposalId: string;
  readonly projectId: string;
  readonly providerId: A4ProviderId;
  readonly approved: boolean;
  readonly expectedApprovalRevision: number;
  readonly proposedBy: string;
  readonly status: 'PROPOSED' | 'APPROVED' | 'REJECTED';
  readonly createdAt: string;
};

export type ProviderRegistryAuthorityPort = {
  getProvider(
    providerId: string,
  ): { readonly providerId: string; readonly status: string } | undefined;
};

export type ProviderExternalTransferApprovalRepositoryPort = {
  getCurrent(input: {
    readonly projectId: string;
    readonly providerId: A4ProviderId;
  }): Promise<ProviderExternalTransferApproval | undefined>;
  listHistory(input: {
    readonly projectId: string;
    readonly providerId: A4ProviderId;
  }): Promise<readonly ProviderExternalTransferApprovalHistoryEntry[]>;
  createProposal(input: {
    readonly projectId: string;
    readonly providerId: A4ProviderId;
    readonly approved: boolean;
    readonly expectedApprovalRevision: number;
    readonly proposedBy: string;
  }): Promise<ProviderExternalTransferApprovalProposal>;
  approveProposal(input: {
    readonly proposalId: string;
    readonly projectId: string;
    readonly providerId: A4ProviderId;
    readonly reviewedBy: string;
    readonly expectedApprovalRevision: number;
  }): Promise<ProviderExternalTransferApproval>;
  isProjectOwner(input: {
    readonly projectId: string;
    readonly principalId: string;
  }): Promise<boolean>;
};

export type ProviderExternalTransferApprovalPort = {
  getCurrent(
    projectId: string,
    providerId: string,
  ): Promise<ProviderExternalTransferApproval | undefined>;
  listHistory(
    projectId: string,
    providerId: string,
  ): Promise<readonly ProviderExternalTransferApprovalHistoryEntry[]>;
  propose(input: {
    readonly projectId: string;
    readonly providerId: string;
    readonly approved: boolean;
    readonly expectedApprovalRevision: number;
    readonly proposedBy: string;
  }): Promise<ProviderExternalTransferApprovalProposal>;
  approve(input: {
    readonly proposalId: string;
    readonly projectId: string;
    readonly providerId: string;
    readonly reviewedBy: string;
    readonly expectedApprovalRevision: number;
  }): Promise<ProviderExternalTransferApproval>;
};

export type ProviderDeploymentCeiling = {
  readonly configured: boolean;
  readonly allowedProviders: ReadonlySet<string>;
  allows(providerId: string): boolean;
};

export type ProviderExternalTransferDecision = {
  readonly eligible: boolean;
  readonly reason:
    | 'ELIGIBLE'
    | 'DEPLOYMENT_POLICY_BLOCKED'
    | 'PROJECT_APPROVAL_REQUIRED'
    | 'RESTRICTED_CONTEXT_BLOCKED';
  readonly usedLegacyGeminiCompatibility: boolean;
};

export class ProviderExternalTransferPolicyError extends Error {
  constructor(
    readonly code:
      | 'INVALID_INPUT'
      | 'UNKNOWN_PROVIDER'
      | 'PROJECT_OWNER_REQUIRED'
      | 'REVISION_CONFLICT'
      | 'PROPOSAL_STALE',
    message: string,
  ) {
    super(message);
    this.name = 'ProviderExternalTransferPolicyError';
  }
}

const normalize = (name: string, value: string, maxLength = 256): string => {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new ProviderExternalTransferPolicyError('INVALID_INPUT', `${name} is invalid.`);
  }
  return normalized;
};

const providerId = (value: string): A4ProviderId => {
  const normalized = normalize('Provider ID', value, 128);
  if (!(A4_SUPPORTED_PROVIDER_IDS as readonly string[]).includes(normalized)) {
    throw new ProviderExternalTransferPolicyError(
      'UNKNOWN_PROVIDER',
      'Provider is not registered.',
    );
  }
  return normalized as A4ProviderId;
};

const nonNegativeRevision = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ProviderExternalTransferPolicyError('INVALID_INPUT', 'Approval revision is invalid.');
  }
  return value;
};

const owner = (value: string): string => normalize('Principal ID', value, 256);

export const parseProviderDeploymentCeiling = (input: {
  readonly providerAllowlist?: string;
  readonly legacyGeminiAllowed?: boolean;
  /**
   * Local-owner default only. Managed deployments must pass an explicit
   * allowlist (or remain fail-closed); this never overrides a non-empty
   * operator allowlist.
   */
  readonly localOwnerDefault?: boolean;
}): ProviderDeploymentCeiling => {
  const hasExplicitAllowlist =
    typeof input.providerAllowlist === 'string' && input.providerAllowlist.trim().length > 0;
  const configured = input.localOwnerDefault
    ? hasExplicitAllowlist
    : input.providerAllowlist !== undefined;
  const allowedProviders = new Set<string>();
  if (hasExplicitAllowlist) {
    for (const candidate of input.providerAllowlist!.split(',')) {
      const normalized = candidate.trim();
      if ((A4_SUPPORTED_PROVIDER_IDS as readonly string[]).includes(normalized)) {
        allowedProviders.add(normalized);
      }
    }
  } else if (input.localOwnerDefault) {
    for (const provider of A4_SUPPORTED_PROVIDER_IDS) allowedProviders.add(provider);
  } else if (input.legacyGeminiAllowed === true) {
    allowedProviders.add('google-gemini');
  }
  return Object.freeze({
    configured,
    allowedProviders,
    allows: (candidate: string) => allowedProviders.has(candidate.trim()),
  });
};

export const evaluateProviderExternalTransfer = (input: {
  readonly providerId: string;
  readonly sensitivity: ExternalTransferSensitivity;
  readonly deployment: ProviderDeploymentCeiling;
  readonly approval?: ProviderExternalTransferApproval;
  readonly legacyExternalTransferAllowed: boolean;
}): ProviderExternalTransferDecision => {
  const selectedProvider = providerId(input.providerId);
  if (input.sensitivity === 'restricted') {
    return {
      eligible: false,
      reason: 'RESTRICTED_CONTEXT_BLOCKED',
      usedLegacyGeminiCompatibility: false,
    };
  }
  if (input.sensitivity !== 'private') {
    return { eligible: true, reason: 'ELIGIBLE', usedLegacyGeminiCompatibility: false };
  }
  if (!input.deployment.allows(selectedProvider)) {
    return {
      eligible: false,
      reason: 'DEPLOYMENT_POLICY_BLOCKED',
      usedLegacyGeminiCompatibility: false,
    };
  }
  const matchingApproval =
    input.approval?.providerId === selectedProvider ? input.approval : undefined;
  const legacyGemini =
    selectedProvider === 'google-gemini' &&
    matchingApproval === undefined &&
    input.legacyExternalTransferAllowed;
  if (!legacyGemini && matchingApproval?.approved !== true) {
    return {
      eligible: false,
      reason: 'PROJECT_APPROVAL_REQUIRED',
      usedLegacyGeminiCompatibility: false,
    };
  }
  return { eligible: true, reason: 'ELIGIBLE', usedLegacyGeminiCompatibility: legacyGemini };
};

export class ProviderExternalTransferApprovalService implements ProviderExternalTransferApprovalPort {
  constructor(
    private readonly repository: ProviderExternalTransferApprovalRepositoryPort,
    private readonly registry: ProviderRegistryAuthorityPort,
  ) {}

  async getCurrent(
    projectId: string,
    provider: string,
  ): Promise<ProviderExternalTransferApproval | undefined> {
    return this.repository.getCurrent({
      projectId: normalize('Project ID', projectId),
      providerId: this.registeredProvider(provider),
    });
  }

  async listHistory(
    projectId: string,
    provider: string,
  ): Promise<readonly ProviderExternalTransferApprovalHistoryEntry[]> {
    return this.repository.listHistory({
      projectId: normalize('Project ID', projectId),
      providerId: this.registeredProvider(provider),
    });
  }

  async propose(
    input: Parameters<ProviderExternalTransferApprovalPort['propose']>[0],
  ): Promise<ProviderExternalTransferApprovalProposal> {
    const projectId = normalize('Project ID', input.projectId);
    const providerId = this.registeredProvider(input.providerId);
    const proposedBy = owner(input.proposedBy);
    const expectedApprovalRevision = nonNegativeRevision(input.expectedApprovalRevision);
    if (typeof input.approved !== 'boolean') {
      throw new ProviderExternalTransferPolicyError('INVALID_INPUT', 'Approval value is invalid.');
    }
    if (!(await this.repository.isProjectOwner({ projectId, principalId: proposedBy }))) {
      throw new ProviderExternalTransferPolicyError(
        'PROJECT_OWNER_REQUIRED',
        'Project Owner review is required.',
      );
    }
    return this.repository.createProposal({
      projectId,
      providerId,
      approved: input.approved,
      expectedApprovalRevision,
      proposedBy,
    });
  }

  async approve(
    input: Parameters<ProviderExternalTransferApprovalPort['approve']>[0],
  ): Promise<ProviderExternalTransferApproval> {
    const projectId = normalize('Project ID', input.projectId);
    const providerId = this.registeredProvider(input.providerId);
    const reviewedBy = owner(input.reviewedBy);
    const expectedApprovalRevision = nonNegativeRevision(input.expectedApprovalRevision);
    if (!(await this.repository.isProjectOwner({ projectId, principalId: reviewedBy }))) {
      throw new ProviderExternalTransferPolicyError(
        'PROJECT_OWNER_REQUIRED',
        'Project Owner approval is required.',
      );
    }
    return this.repository.approveProposal({
      proposalId: normalize('Proposal ID', input.proposalId),
      projectId,
      providerId,
      reviewedBy,
      expectedApprovalRevision,
    });
  }

  private registeredProvider(candidate: string): A4ProviderId {
    const normalized = providerId(candidate);
    const descriptor = this.registry.getProvider(normalized);
    if (!descriptor || descriptor.status !== 'active' || descriptor.providerId !== normalized) {
      throw new ProviderExternalTransferPolicyError(
        'UNKNOWN_PROVIDER',
        'Provider is not registered.',
      );
    }
    return normalized;
  }
}
