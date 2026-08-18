import {
  sha256Text,
  stableJson,
  SemanticEmbeddingError,
  type ProviderStatusReaderPort,
  type ResolvedSemanticEmbeddingExecution,
  type SemanticEmbeddingExecutionPin,
  type SemanticEmbeddingProfile,
  type SemanticEmbeddingProfilePort,
  type SemanticEmbeddingRegistryPort,
  type SemanticEmbeddingResolverPort,
} from '../../../packages/contracts/src/index.js';
import type { CredentialVaultPort } from '../../../modules/credential-vault/src/index.js';
import {
  A4_PROVIDER_PRIVACY_POLICY_REVISION,
  evaluateProviderExternalTransfer,
  type ExternalTransferSensitivity,
  type ProviderDeploymentCeiling,
  type ProviderExternalTransferApprovalPort,
} from '../../../modules/provider-privacy-policy/src/index.js';

export type SemanticEmbeddingAuthorityResolverOptions = {
  readonly deploymentCeiling?: ProviderDeploymentCeiling;
  readonly approvalAuthority?: ProviderExternalTransferApprovalPort;
  readonly legacyExternalTransferAllowed?: (projectId: string) => Promise<boolean>;
  readonly clock?: () => string;
};

export class SemanticEmbeddingAuthorityResolver implements SemanticEmbeddingResolverPort {
  private readonly clock: () => string;

  constructor(
    private readonly providerRegistry: ProviderStatusReaderPort,
    private readonly embeddingRegistry: SemanticEmbeddingRegistryPort,
    private readonly profileService: SemanticEmbeddingProfilePort,
    private readonly vault: CredentialVaultPort,
    private readonly options: SemanticEmbeddingAuthorityResolverOptions,
  ) {
    this.clock = options?.clock ?? (() => new Date().toISOString());
  }

  async resolveExecution(input: {
    readonly projectId: string;
    readonly sensitivity: ExternalTransferSensitivity;
    readonly profileRevision?: number;
    readonly credentialId?: string;
    readonly credentialRevision?: number;
  }): Promise<ResolvedSemanticEmbeddingExecution> {
    const projectId = input.projectId.trim();
    if (!projectId) {
      throw new SemanticEmbeddingError({
        code: 'INVALID_INPUT',
        safeMessage: 'Project ID is required.',
        operation: 'resolve-execution',
      });
    }

    // Fail closed if required privacy authorities are missing
    if (!this.options?.deploymentCeiling || !this.options?.approvalAuthority) {
      throw new SemanticEmbeddingError({
        code: 'CONFIGURATION_REQUIRED',
        safeMessage:
          'Provider privacy and deployment authority are required for embedding execution.',
        operation: 'resolve-privacy-authority',
      });
    }

    // 1. Resolve effective profile
    let profile: SemanticEmbeddingProfile | undefined;
    if (input.profileRevision !== undefined) {
      profile = await this.profileService.getRevision(projectId, input.profileRevision);
      if (!profile) {
        throw new SemanticEmbeddingError({
          code: 'CONFIGURATION_REQUIRED',
          safeMessage: `Semantic embedding profile revision ${input.profileRevision} was not found.`,
          operation: 'resolve-profile',
        });
      }
      if (profile.status === 'FAILED') {
        throw new SemanticEmbeddingError({
          code: 'CAPABILITY_UNAVAILABLE',
          safeMessage: 'Pinned embedding profile is marked as FAILED.',
          operation: 'resolve-profile',
        });
      }
    } else {
      profile = await this.profileService.getActive(projectId);
      if (!profile || profile.status !== 'ACTIVE') {
        throw new SemanticEmbeddingError({
          code: 'CONFIGURATION_REQUIRED',
          safeMessage: 'Active semantic embedding profile is required before embedding execution.',
          operation: 'resolve-active-profile',
        });
      }
    }

    // 2. Validate provider in existing provider authority
    const provider = this.providerRegistry.getProvider(profile.providerId);
    if (!provider || provider.status !== 'active') {
      throw new SemanticEmbeddingError({
        code: 'CAPABILITY_UNAVAILABLE',
        safeMessage: 'Configured embedding provider is unavailable or disabled.',
        operation: 'resolve-provider',
      });
    }

    // 3. Validate embedding model in semantic embedding registry
    const model = this.embeddingRegistry.getModel(profile.providerId, profile.embeddingModelId);
    if (!model) {
      throw new SemanticEmbeddingError({
        code: 'CAPABILITY_UNAVAILABLE',
        safeMessage: 'Configured embedding model is not registered for provider.',
        operation: 'resolve-model',
      });
    }

    // 4. Evaluate privacy & deployment policies via canonical evaluateProviderExternalTransfer
    const approval = await this.options.approvalAuthority.getCurrent(projectId, profile.providerId);
    const legacyExternalTransferAllowed = this.options.legacyExternalTransferAllowed
      ? await this.options.legacyExternalTransferAllowed(projectId)
      : false;

    const privacyDecision = evaluateProviderExternalTransfer({
      providerId: profile.providerId,
      sensitivity: input.sensitivity,
      deployment: this.options.deploymentCeiling,
      approval,
      legacyExternalTransferAllowed,
    });

    if (!privacyDecision.eligible) {
      let safeMessage = 'External transfer policy denied embedding execution.';
      if (privacyDecision.reason === 'RESTRICTED_CONTEXT_BLOCKED') {
        safeMessage =
          'Restricted sensitivity context cannot be sent to an external embedding provider.';
      } else if (privacyDecision.reason === 'DEPLOYMENT_POLICY_BLOCKED') {
        safeMessage = 'Deployment policy blocks private external transfer for this provider.';
      } else if (privacyDecision.reason === 'PROJECT_APPROVAL_REQUIRED') {
        safeMessage = 'Project owner approval is required for private external transfer.';
      }

      throw new SemanticEmbeddingError({
        code: 'POLICY_DENIED',
        safeMessage,
        operation: 'enforce-privacy-policy',
      });
    }

    // 5. Revalidate pinned credential from vault (no non-deterministic list scanning)
    const availability = this.vault.getAvailability();
    if (availability.state !== 'AVAILABLE') {
      throw new SemanticEmbeddingError({
        code: 'CONFIGURATION_REQUIRED',
        safeMessage: 'Credential vault is unavailable.',
        operation: 'resolve-credential-vault',
      });
    }

    const credentialId = input.credentialId ?? profile.credentialId;
    const credentialRevision = input.credentialRevision ?? profile.credentialRevision;

    if (
      credentialId !== profile.credentialId ||
      credentialRevision !== profile.credentialRevision
    ) {
      throw new SemanticEmbeddingError({
        code: 'CAPABILITY_UNAVAILABLE',
        safeMessage: 'Requested credential pin does not match profile authority.',
        operation: 'resolve-pinned-credential',
      });
    }

    const credentialMetadata = await this.vault.getMetadata({
      projectId,
      providerId: profile.providerId,
      credentialId,
      credentialRevision,
    });

    if (
      !credentialMetadata ||
      credentialMetadata.projectId !== projectId ||
      credentialMetadata.providerId !== profile.providerId ||
      credentialMetadata.credentialId !== credentialId ||
      credentialMetadata.credentialRevision !== credentialRevision ||
      credentialMetadata.lifecycleState !== 'active'
    ) {
      throw new SemanticEmbeddingError({
        code: 'CAPABILITY_UNAVAILABLE',
        safeMessage: 'Pinned credential revision is unavailable, revoked, or mismatched.',
        operation: 'resolve-pinned-credential',
      });
    }

    // 6. Compute provider policy fingerprint from canonical A4 inputs/decision
    const providerPolicyFingerprint = sha256Text(
      stableJson({
        a4PolicyRevision: A4_PROVIDER_PRIVACY_POLICY_REVISION,
        providerId: profile.providerId,
        modelId: model.modelId,
        profileRevision: profile.profileRevision,
        representationVersion: profile.representationVersion,
        sensitivity: input.sensitivity,
        deploymentCeilingAllowedProviders: [
          ...this.options.deploymentCeiling.allowedProviders,
        ].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
        approvalRevision: approval?.approvalRevision ?? null,
        approvalApproved: approval?.approved ?? null,
        usedLegacyGeminiCompatibility: privacyDecision.usedLegacyGeminiCompatibility,
        eligible: privacyDecision.eligible,
      }),
    );

    // 7. Build immutable execution pin (zero raw secrets)
    const pin: SemanticEmbeddingExecutionPin = Object.freeze({
      projectId,
      providerId: profile.providerId,
      embeddingModelId: model.modelId,
      embeddingProfileId: profile.profileId,
      embeddingProfileRevision: profile.profileRevision,
      credentialId: credentialMetadata.credentialId,
      credentialRevision: credentialMetadata.credentialRevision,
      providerRegistryRevision: provider.registryRevision ?? 'provider-registry:v1',
      capabilityCatalogRevision: model.capabilityRevision,
      providerPolicyFingerprint,
      representationVersion: profile.representationVersion,
      createdAt: this.clock(),
    });

    return {
      pin,
      profile,
      model,
    };
  }
}
