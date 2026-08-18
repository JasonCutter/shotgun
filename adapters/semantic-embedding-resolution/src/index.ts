import {
  sha256Text,
  stableJson,
  SemanticEmbeddingError,
  type ResolvedSemanticEmbeddingExecution,
  type SemanticEmbeddingExecutionPin,
  type SemanticEmbeddingProfile,
  type SemanticEmbeddingProfilePort,
  type SemanticEmbeddingRegistryPort,
  type SemanticEmbeddingResolverPort,
} from '../../../packages/contracts/src/index.js';
import type {
  CredentialMetadata,
  CredentialVaultPort,
} from '../../../modules/credential-vault/src/index.js';
import type {
  ProviderDeploymentCeiling,
  ProviderExternalTransferApprovalPort,
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
    private readonly registry: SemanticEmbeddingRegistryPort,
    private readonly profileService: SemanticEmbeddingProfilePort,
    private readonly vault: CredentialVaultPort,
    private readonly options: SemanticEmbeddingAuthorityResolverOptions = {},
  ) {
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  async resolveExecution(input: {
    readonly projectId: string;
    readonly sensitivity: 'public' | 'internal' | 'private' | 'restricted';
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

    if (input.sensitivity === 'restricted') {
      throw new SemanticEmbeddingError({
        code: 'POLICY_DENIED',
        safeMessage:
          'Restricted sensitivity context cannot be sent to an external embedding provider.',
        operation: 'enforce-sensitivity-policy',
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

    // 2. Validate provider & model in registry
    const provider = this.registry.getProvider(profile.providerId);
    if (!provider || provider.status !== 'active') {
      throw new SemanticEmbeddingError({
        code: 'CAPABILITY_UNAVAILABLE',
        safeMessage: 'Configured embedding provider is unavailable or disabled.',
        operation: 'resolve-provider',
      });
    }

    const model = this.registry.getModel(profile.providerId, profile.embeddingModelId);
    if (!model) {
      throw new SemanticEmbeddingError({
        code: 'CAPABILITY_UNAVAILABLE',
        safeMessage: 'Configured embedding model is not registered for provider.',
        operation: 'resolve-model',
      });
    }

    // 3. Evaluate privacy & deployment policies for private sensitivity
    if (input.sensitivity === 'private') {
      if (
        this.options.deploymentCeiling &&
        !this.options.deploymentCeiling.allows(provider.providerId)
      ) {
        throw new SemanticEmbeddingError({
          code: 'POLICY_DENIED',
          safeMessage: 'Deployment policy blocks private external transfer for this provider.',
          operation: 'evaluate-deployment-policy',
        });
      }

      if (this.options.approvalAuthority) {
        const approval = await this.options.approvalAuthority.getCurrent(
          projectId,
          provider.providerId,
        );
        let approved = approval?.approved === true;

        if (
          !approved &&
          provider.providerId === 'google-gemini' &&
          approval === undefined &&
          this.options.legacyExternalTransferAllowed
        ) {
          approved = await this.options.legacyExternalTransferAllowed(projectId);
        }

        if (!approved) {
          throw new SemanticEmbeddingError({
            code: 'POLICY_DENIED',
            safeMessage: 'Project owner approval is required for private external transfer.',
            operation: 'evaluate-project-approval',
          });
        }
      }
    }

    // 4. Resolve credential from vault
    const availability = this.vault.getAvailability();
    if (availability.state !== 'AVAILABLE') {
      throw new SemanticEmbeddingError({
        code: 'CONFIGURATION_REQUIRED',
        safeMessage: 'Credential vault is unavailable.',
        operation: 'resolve-credential-vault',
      });
    }

    let credentialMetadata: CredentialMetadata | undefined;

    if (input.credentialId && input.credentialRevision) {
      const metadata = await this.vault.getMetadata({
        projectId,
        providerId: provider.providerId,
        credentialId: input.credentialId,
        credentialRevision: input.credentialRevision,
      });
      if (
        !metadata ||
        metadata.projectId !== projectId ||
        metadata.providerId !== provider.providerId ||
        metadata.credentialId !== input.credentialId ||
        metadata.credentialRevision !== input.credentialRevision ||
        metadata.lifecycleState !== 'active'
      ) {
        throw new SemanticEmbeddingError({
          code: 'CAPABILITY_UNAVAILABLE',
          safeMessage: 'Pinned credential revision is unavailable or revoked.',
          operation: 'resolve-pinned-credential',
        });
      }
      credentialMetadata = metadata;
    } else {
      const metadataList = this.vault.listMetadata ? await this.vault.listMetadata(projectId) : [];
      const matching = metadataList.find(
        (item) => item.providerId === provider.providerId && item.lifecycleState === 'active',
      );
      if (!matching) {
        throw new SemanticEmbeddingError({
          code: 'CONFIGURATION_REQUIRED',
          safeMessage: `Active credential is required for provider '${provider.providerId}'.`,
          operation: 'resolve-active-credential',
        });
      }
      credentialMetadata = matching;
    }

    // 5. Compute provider policy fingerprint
    const providerPolicyFingerprint = sha256Text(
      stableJson({
        providerId: provider.providerId,
        modelId: model.modelId,
        profileRevision: profile.profileRevision,
        representationVersion: profile.representationVersion,
        sensitivity: input.sensitivity,
        policyRevision: 'v1',
      }),
    );

    // 6. Build immutable execution pin
    const pin: SemanticEmbeddingExecutionPin = Object.freeze({
      projectId,
      providerId: provider.providerId,
      embeddingModelId: model.modelId,
      embeddingProfileId: profile.profileId,
      embeddingProfileRevision: profile.profileRevision,
      credentialId: credentialMetadata.credentialId,
      credentialRevision: credentialMetadata.credentialRevision,
      providerPolicyFingerprint,
      representationVersion: profile.representationVersion,
      createdAt: this.clock(),
    });

    return {
      pin,
      profile,
      model,
      provider,
    };
  }
}
