import {
  ShotgunError,
  isCanonicalGenerativeAIExecution,
  type AskContextSensitivity,
  type AIExecutionIdentity,
  type AskProviderPolicyResolverPort,
} from '../../../packages/contracts/src/index.js';
import {
  type AIModelDescriptor,
  type AIProviderDescriptor,
  type CredentialMetadataReference,
  type ProjectAIConfiguration,
  type ProjectAIConfigurationPort,
  type ProviderRegistryPort,
} from '../../../modules/ai-configuration/src/index.js';
import type {
  DiscoveryAIExecutionResolutionV1,
  DiscoveryAIExecutionResolverPort,
  DiscoveryModelProfileV1,
} from '../../../packages/contracts/src/index.js';
import type { CredentialVaultPort } from '../../../modules/credential-vault/src/index.js';
import type {
  AIProviderAdapterPort,
  StructuredGenerationResponse,
} from '../../../modules/ai-provider/src/index.js';
import {
  type AIExecutionPin,
  type AskExecutionIdentityResolverPort,
  type AskExecutionRunContext,
} from '../../../modules/frontend-ask-execution/src/index.js';

export type LegacyGeminiRuntimeAuthority = {
  readLegacyExternalTransferAllowed(projectId: string): Promise<boolean>;
  readGeminiApproval(
    projectId: string,
  ): Promise<
    | { readonly providerId: string; readonly approved: boolean; readonly approvalRevision: number }
    | undefined
  >;
};

export type EffectiveAIConfiguration = {
  readonly projectId: string;
  readonly provider: AIProviderDescriptor;
  readonly model: AIModelDescriptor;
  readonly aiConfigurationRevision: number;
  readonly credentialId: string;
  readonly credentialRevision: number;
  readonly providerPolicyFingerprint: string;
  readonly legacyGeminiCompatibility: boolean;
};

export type EffectiveAIConfigurationResolverOptions = {
  /** Product composition enables the DeepSeek-only policy for new generation. */
  readonly enforceDeepSeekOnly?: boolean;
  readonly policy?: AskProviderPolicyResolverPort;
  readonly legacyAuthority?: LegacyGeminiRuntimeAuthority;
  readonly legacyCredential?: () => string | undefined;
  readonly legacyModelId?: string;
  readonly legacyCredentialId?: string;
  /** Optional direct reader used to verify Standing Policy's exact config
   * revision for non-Ask structured processing. */
  readonly standingPolicyAuthority?: {
    getCurrent(projectId: string): Promise<
      | {
          readonly enabled: boolean;
          readonly providerId: string;
          readonly aiConfigurationRevision: number;
        }
      | undefined
    >;
  };
  readonly clock?: () => string;
};

export type SourceAIExecutionResolution = {
  readonly pin: AIExecutionPin;
  readonly executionIdentity: AIExecutionIdentity;
};

const resolutionError = (
  code: ConstructorParameters<typeof ShotgunError>[0]['code'],
  message: string,
  operation: string,
): ShotgunError =>
  new ShotgunError({
    code,
    safeMessage: message,
    module: 'ai-runtime-routing',
    operation,
  });

const nonEmpty = (value: string | undefined): value is string => Boolean(value?.trim());

const sameMetadata = (
  metadata: CredentialMetadataReference | undefined,
  expected: {
    readonly projectId: string;
    readonly providerId: string;
    readonly credentialId: string;
    readonly credentialRevision: number;
  },
): boolean =>
  Boolean(
    metadata &&
    metadata.projectId === expected.projectId &&
    metadata.providerId === expected.providerId &&
    metadata.credentialId === expected.credentialId &&
    metadata.credentialRevision === expected.credentialRevision &&
    metadata.lifecycleState === 'active',
  );

const assertProviderAndModel = (
  registry: ProviderRegistryPort,
  providerId: string,
  modelId: string,
): { readonly provider: AIProviderDescriptor; readonly model: AIModelDescriptor } => {
  const provider = registry.getProvider(providerId);
  if (!provider || provider.status !== 'active') {
    throw resolutionError(
      'AI_CAPABILITY_UNAVAILABLE',
      'The configured AI provider is unavailable.',
      'resolve-provider',
    );
  }
  const model = registry.getModel(providerId, modelId);
  if (!model || !model.shotgunUsableCapabilities.includes('structuredOutput')) {
    throw resolutionError(
      'AI_CAPABILITY_UNAVAILABLE',
      'The configured AI model is unavailable for Ask execution.',
      'resolve-model',
    );
  }
  return { provider, model };
};

const sensitivitiesOf = (context: AskExecutionRunContext): readonly AskContextSensitivity[] =>
  context.context.map((item) => item.sensitivity);

export class EffectiveAIConfigurationResolver implements AskExecutionIdentityResolverPort {
  private readonly clock: () => string;
  private readonly legacyCredentialId: string;

  constructor(
    private readonly registry: ProviderRegistryPort,
    private readonly configuration: ProjectAIConfigurationPort,
    private readonly vault: CredentialVaultPort,
    private readonly options: EffectiveAIConfigurationResolverOptions = {},
  ) {
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.legacyCredentialId = options.legacyCredentialId ?? 'legacy-gemini-compatibility';
  }

  async resolveInitialAIExecutionIdentity(input: {
    readonly principalId: string;
    readonly projectId: string;
    readonly answerRunId: string;
    readonly authorizedContext: AskExecutionRunContext;
  }): Promise<AIExecutionPin> {
    void input.principalId;
    const current = await this.configuration.getCurrent(input.projectId);
    const effective = current
      ? await this.resolveManaged(input.projectId, current, input.authorizedContext)
      : await this.resolveLegacy(input.projectId, input.authorizedContext);
    return Object.freeze({
      answerRunId: input.answerRunId,
      projectId: effective.projectId,
      providerId: effective.provider.providerId,
      modelId: effective.model.modelId,
      aiConfigurationRevision: effective.aiConfigurationRevision,
      credentialId: effective.credentialId,
      credentialRevision: effective.credentialRevision,
      initialProviderPolicyFingerprint: effective.providerPolicyFingerprint,
      createdAt: this.clock(),
    });
  }

  async revalidatePinnedCredential(input: {
    readonly principalId: string;
    readonly projectId: string;
    readonly answerRunId: string;
    readonly executionPin: AIExecutionPin;
  }): Promise<boolean> {
    void input.principalId;
    if (
      input.executionPin.answerRunId !== input.answerRunId ||
      input.executionPin.projectId !== input.projectId
    ) {
      throw resolutionError(
        'PROJECT_ACCESS_DENIED',
        'The pinned AI execution identity is bound to another Project or AnswerRun.',
        'revalidate-pinned-identity',
      );
    }
    assertProviderAndModel(
      this.registry,
      input.executionPin.providerId,
      input.executionPin.modelId,
    );

    if (this.isLegacyPin(input.executionPin)) {
      if (await this.configuration.getCurrent(input.projectId)) return false;
      if (!this.options.legacyAuthority) return false;
      const legacyAllowed = await this.options.legacyAuthority.readLegacyExternalTransferAllowed(
        input.projectId,
      );
      return legacyAllowed && this.legacyAvailable(input.projectId, input.executionPin.modelId);
    }

    return sameMetadata(
      await this.vault.getMetadata({
        projectId: input.projectId,
        providerId: input.executionPin.providerId,
        credentialId: input.executionPin.credentialId,
        credentialRevision: input.executionPin.credentialRevision,
      }),
      {
        projectId: input.projectId,
        providerId: input.executionPin.providerId,
        credentialId: input.executionPin.credentialId,
        credentialRevision: input.executionPin.credentialRevision,
      },
    );
  }

  /**
   * Resolve a Source → Candidate structured call through the same Project AI
   * authority used by Ask and Discovery. The returned identity is immutable
   * for the durable request; a retry may only use the exact same revisions.
   */
  async resolveSourceAIExecutionIdentity(input: {
    readonly principalId: string;
    readonly projectId: string;
    readonly requestId: string;
    readonly sourceVersionId: string;
    readonly sensitivity: AskContextSensitivity;
    readonly accessScope: readonly string[];
    readonly dataClassification: string;
    readonly existingIdentity?: AIExecutionIdentity;
  }): Promise<SourceAIExecutionResolution> {
    void input.principalId;
    void input.sourceVersionId;
    void input.accessScope;
    void input.dataClassification;
    if (input.sensitivity === 'restricted') {
      throw resolutionError(
        'POLICY_DENIED',
        'Restricted Source context cannot be sent to an external AI provider.',
        'resolve-source-sensitivity',
      );
    }
    const current = await this.configuration.getCurrent(input.projectId);
    if (!current) {
      throw resolutionError(
        'CONFIGURATION_REQUIRED',
        'Project AI configuration is required before Source processing can run.',
        'resolve-source-configuration',
      );
    }
    const existing = input.existingIdentity;
    const historicalRetry = Boolean(
      existing && !isCanonicalGenerativeAIExecution(existing.providerId, existing.modelId),
    );
    if (
      this.options.enforceDeepSeekOnly === true &&
      !isCanonicalGenerativeAIExecution(current.activeProviderId, current.activeModelId) &&
      !historicalRetry
    ) {
      throw resolutionError(
        'CONFIGURATION_REQUIRED',
        'The current Project configuration is not authorized for new generative AI execution.',
        'resolve-source-generative-policy',
      );
    }
    if (
      existing &&
      (existing.providerId !== current.activeProviderId ||
        existing.modelId !== current.activeModelId ||
        existing.aiConfigurationRevision !== current.aiConfigurationRevision ||
        existing.credentialId !== current.credentialId ||
        existing.credentialRevision !== current.credentialRevision)
    ) {
      throw resolutionError(
        'CONFIGURATION_REQUIRED',
        'The durable Source AI request is no longer bound to the current Project configuration.',
        'verify-source-configuration-pin',
      );
    }

    const { provider, model } = assertProviderAndModel(
      this.registry,
      current.activeProviderId,
      current.activeModelId,
    );
    if (
      this.options.enforceDeepSeekOnly === true &&
      !isCanonicalGenerativeAIExecution(provider.providerId, model.modelId) &&
      !historicalRetry
    ) {
      throw resolutionError(
        'CONFIGURATION_REQUIRED',
        'The current Project configuration is not authorized for new generative AI execution.',
        'resolve-managed-generative-policy',
      );
    }
    const metadata = await this.vault.getMetadata({
      projectId: input.projectId,
      providerId: current.activeProviderId,
      credentialId: current.credentialId,
      credentialRevision: current.credentialRevision,
    });
    if (
      !sameMetadata(metadata, {
        projectId: input.projectId,
        providerId: current.activeProviderId,
        credentialId: current.credentialId,
        credentialRevision: current.credentialRevision,
      })
    ) {
      throw resolutionError(
        'AI_CAPABILITY_UNAVAILABLE',
        'The configured Project credential revision is unavailable.',
        'resolve-source-credential',
      );
    }
    if (!this.options.policy) {
      throw resolutionError(
        'POLICY_DENIED',
        'The Project AI provider policy authority is unavailable.',
        'resolve-source-policy',
      );
    }
    const policy = await this.options.policy.evaluateContext({
      projectId: input.projectId,
      providerId: current.activeProviderId,
      modelId: current.activeModelId,
      sensitivities: [input.sensitivity],
    });
    if (!policy.eligible) {
      throw resolutionError(
        'POLICY_DENIED',
        'The configured AI provider is not permitted for this Source context.',
        'resolve-source-policy',
      );
    }
    const standingAuthority = this.options.standingPolicyAuthority;
    if (!standingAuthority) {
      throw resolutionError(
        'POLICY_DENIED',
        'The Standing AI Processing Policy authority is unavailable for Source processing.',
        'resolve-source-standing-policy',
      );
    }
    const standing = await standingAuthority.getCurrent(input.projectId);
    if (
      !standing ||
      !standing.enabled ||
      standing.providerId !== current.activeProviderId ||
      standing.aiConfigurationRevision !== current.aiConfigurationRevision
    ) {
      throw resolutionError(
        'POLICY_DENIED',
        'The Standing AI Processing Policy is not bound to the current Project AI configuration.',
        'verify-source-standing-policy-pin',
      );
    }
    if (existing && existing.providerPolicyFingerprint !== policy.policyFingerprint) {
      throw resolutionError(
        'POLICY_DENIED',
        'The durable Source AI request is no longer bound to the same provider policy.',
        'verify-source-policy-pin',
      );
    }
    const pin: AIExecutionPin = Object.freeze({
      answerRunId: input.requestId,
      projectId: input.projectId,
      providerId: current.activeProviderId,
      modelId: current.activeModelId,
      aiConfigurationRevision: current.aiConfigurationRevision,
      credentialId: current.credentialId,
      credentialRevision: current.credentialRevision,
      initialProviderPolicyFingerprint: policy.policyFingerprint,
      createdAt: this.clock(),
    });
    return {
      pin,
      executionIdentity: Object.freeze({
        providerId: provider.providerId,
        modelId: model.modelId,
        aiConfigurationRevision: current.aiConfigurationRevision,
        credentialId: current.credentialId,
        credentialRevision: current.credentialRevision,
        policyContextRevision: policy.policyContextRevision,
        providerPolicyFingerprint: policy.policyFingerprint,
      }),
    };
  }

  /**
   * Discovery uses the same ADR-133 configuration, Vault and provider-policy
   * authority as Ask, while pinning its own revisioned Discovery profile.
   * This method intentionally has no latest-config or latest-credential path.
   */
  async resolveDiscoveryAIExecution(input: {
    readonly projectId: string;
    readonly profile: DiscoveryModelProfileV1;
    readonly sensitivity: AskContextSensitivity;
  }): Promise<DiscoveryAIExecutionResolutionV1> {
    if (
      input.profile.schemaVersion !== '1.0.0' ||
      input.profile.projectId !== input.projectId ||
      input.profile.status !== 'ACTIVE'
    ) {
      throw resolutionError(
        'CONFIGURATION_REQUIRED',
        'The Discovery model profile is not active for this Project.',
        'resolve-discovery-profile',
      );
    }

    const configuration = await this.configuration.getRevision(
      input.projectId,
      input.profile.aiConfigurationRevision,
    );
    if (
      !configuration ||
      configuration.projectId !== input.projectId ||
      configuration.aiConfigurationRevision !== input.profile.aiConfigurationRevision ||
      configuration.activeProviderId !== input.profile.providerId ||
      configuration.activeModelId !== input.profile.modelId
    ) {
      throw resolutionError(
        'CONFIGURATION_REQUIRED',
        'The exact Project AI configuration revision is unavailable for Discovery.',
        'resolve-discovery-configuration',
      );
    }

    const { provider, model } = assertProviderAndModel(
      this.registry,
      input.profile.providerId,
      input.profile.modelId,
    );
    if (
      this.options.enforceDeepSeekOnly === true &&
      !isCanonicalGenerativeAIExecution(provider.providerId, model.modelId)
    ) {
      throw resolutionError(
        'CONFIGURATION_REQUIRED',
        'The active Discovery profile is not authorized for new generative AI execution.',
        'resolve-discovery-generative-policy',
      );
    }
    if (
      provider.registryRevision !== input.profile.providerRegistryRevision ||
      model.capabilityRevision !== input.profile.modelCapabilityRevision
    ) {
      throw resolutionError(
        'AI_CAPABILITY_UNAVAILABLE',
        'The pinned Discovery provider capability revision is unavailable.',
        'resolve-discovery-capability-revision',
      );
    }

    const metadata = await this.vault.getMetadata({
      projectId: input.projectId,
      providerId: input.profile.providerId,
      credentialId: configuration.credentialId,
      credentialRevision: configuration.credentialRevision,
    });
    if (
      !sameMetadata(metadata, {
        projectId: input.projectId,
        providerId: input.profile.providerId,
        credentialId: configuration.credentialId,
        credentialRevision: configuration.credentialRevision,
      })
    ) {
      throw resolutionError(
        'AI_CAPABILITY_UNAVAILABLE',
        'The exact Discovery credential revision is unavailable.',
        'resolve-discovery-credential',
      );
    }

    if (!this.options.policy) {
      throw resolutionError(
        'POLICY_DENIED',
        'Discovery provider policy authority is unavailable.',
        'resolve-discovery-policy',
      );
    }
    const policy = await this.options.policy.evaluateContext({
      projectId: input.projectId,
      sensitivities: [input.sensitivity],
      providerId: input.profile.providerId,
      modelId: input.profile.modelId,
    });
    if (!policy.eligible) {
      throw resolutionError(
        'POLICY_DENIED',
        'The Discovery provider is not permitted for this context.',
        'resolve-discovery-policy',
      );
    }

    return {
      pin: {
        projectId: input.projectId,
        profileId: input.profile.profileId,
        profileRevision: input.profile.profileRevision,
        providerId: input.profile.providerId,
        modelId: input.profile.modelId,
        modelCapabilityRevision: input.profile.modelCapabilityRevision,
        aiConfigurationRevision: input.profile.aiConfigurationRevision,
        credentialId: configuration.credentialId,
        credentialRevision: configuration.credentialRevision,
        providerPolicyFingerprint: policy.policyFingerprint,
        // ADR-133 exposes the policy-context revision as the immutable
        // privacy-policy revision available at this boundary.
        privacyPolicyRevision: policy.policyContextRevision,
        dataPolicyRevision: provider.providerPolicyRevision,
        promptVersion: input.profile.promptVersion,
        outputSchemaVersion: input.profile.outputSchemaVersion,
      },
      modelVersion: `catalog:${model.modelId}@${model.capabilityRevision}`,
    };
  }

  private async resolveManaged(
    projectId: string,
    current: ProjectAIConfiguration,
    authorizedContext: AskExecutionRunContext,
  ): Promise<EffectiveAIConfiguration> {
    const { provider, model } = assertProviderAndModel(
      this.registry,
      current.activeProviderId,
      current.activeModelId,
    );
    if (
      this.options.enforceDeepSeekOnly === true &&
      !isCanonicalGenerativeAIExecution(provider.providerId, model.modelId)
    ) {
      throw resolutionError(
        'CONFIGURATION_REQUIRED',
        'The current Project configuration is not authorized for new generative AI execution.',
        'resolve-managed-generative-policy',
      );
    }
    const metadata = await this.vault.getMetadata({
      projectId,
      providerId: current.activeProviderId,
      credentialId: current.credentialId,
      credentialRevision: current.credentialRevision,
    });
    if (
      !sameMetadata(metadata, {
        projectId,
        providerId: current.activeProviderId,
        credentialId: current.credentialId,
        credentialRevision: current.credentialRevision,
      })
    ) {
      throw resolutionError(
        'AI_CAPABILITY_UNAVAILABLE',
        'The configured credential revision is unavailable.',
        'resolve-managed-credential',
      );
    }
    return {
      projectId,
      provider,
      model,
      aiConfigurationRevision: current.aiConfigurationRevision,
      credentialId: current.credentialId,
      credentialRevision: current.credentialRevision,
      providerPolicyFingerprint: await this.policyFingerprint(
        projectId,
        provider.providerId,
        model.modelId,
        authorizedContext,
      ),
      legacyGeminiCompatibility: false,
    };
  }

  private async resolveLegacy(
    projectId: string,
    authorizedContext: AskExecutionRunContext,
  ): Promise<EffectiveAIConfiguration> {
    const providerId = 'google-gemini';
    const provider = this.registry.getProvider(providerId);
    const modelId = this.options.legacyModelId ?? provider?.models[0]?.modelId;
    if (!provider || !modelId || !this.options.legacyAuthority) {
      throw resolutionError(
        'CONFIGURATION_REQUIRED',
        'Project AI configuration is required before Ask can run.',
        'resolve-unconfigured-project',
      );
    }
    const legacyAllowed =
      await this.options.legacyAuthority.readLegacyExternalTransferAllowed(projectId);
    if (!legacyAllowed || !this.legacyAvailable(projectId, modelId)) {
      throw resolutionError(
        'CONFIGURATION_REQUIRED',
        'Project AI configuration is required before Ask can run.',
        'resolve-unconfigured-project',
      );
    }
    const selected = assertProviderAndModel(this.registry, providerId, modelId);
    return {
      projectId,
      provider: selected.provider,
      model: selected.model,
      // Legacy compatibility has no Project-managed revision. The positive
      // sentinel keeps the existing A5 persistence shape valid while the
      // credential id marks the bounded compatibility path explicitly.
      aiConfigurationRevision: 1,
      credentialId: this.legacyCredentialId,
      credentialRevision: 1,
      providerPolicyFingerprint: await this.policyFingerprint(
        projectId,
        providerId,
        modelId,
        authorizedContext,
      ),
      legacyGeminiCompatibility: true,
    };
  }

  private async policyFingerprint(
    projectId: string,
    providerId: string,
    modelId: string,
    context: AskExecutionRunContext,
  ): Promise<string> {
    if (!this.options.policy) return `unbound-a8-policy:${providerId}:${modelId}`;
    const result = await this.options.policy.evaluateContext({
      projectId,
      providerId,
      modelId,
      sensitivities: sensitivitiesOf(context),
    });
    return result.policyFingerprint;
  }

  private isLegacyPin(pin: AIExecutionPin): boolean {
    return pin.providerId === 'google-gemini' && pin.credentialId === this.legacyCredentialId;
  }

  private legacyAvailable(projectId: string, modelId: string): boolean {
    void projectId;
    const provider = this.registry.getProvider('google-gemini');
    return Boolean(
      provider?.status === 'active' &&
      provider.models.some((model) => model.modelId === modelId) &&
      nonEmpty(this.options.legacyCredential?.()),
    );
  }
}

/** Adapter-shaped facade for the Discovery domain Port. */
export class DiscoveryAIExecutionResolver implements DiscoveryAIExecutionResolverPort {
  constructor(private readonly authority: EffectiveAIConfigurationResolver) {}

  resolve(input: {
    readonly projectId: string;
    readonly profile: DiscoveryModelProfileV1;
    readonly sensitivity: AskContextSensitivity;
  }): Promise<DiscoveryAIExecutionResolutionV1> {
    return this.authority.resolveDiscoveryAIExecution(input);
  }
}

/** Keeps non-AI Product startup healthy when no legacy key is configured. */
export class UnavailableAIProviderAdapter implements AIProviderAdapterPort {
  readonly identity = {
    provider: 'unconfigured',
    model: 'unconfigured',
    adapterVersion: 'a8-unavailable-provider-v1',
    dataPolicyVersion: 'a8-unavailable-provider-policy-v1',
  } as const;

  generateStructured(): Promise<StructuredGenerationResponse> {
    throw resolutionError(
      'AI_CAPABILITY_UNAVAILABLE',
      'AI provider configuration is unavailable.',
      'unconfigured-provider',
    );
  }
}
