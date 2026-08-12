import {
  ShotgunError,
  type AskContextSensitivity,
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
  readonly policy?: AskProviderPolicyResolverPort;
  readonly legacyAuthority?: LegacyGeminiRuntimeAuthority;
  readonly legacyCredential?: () => string | undefined;
  readonly legacyModelId?: string;
  readonly legacyCredentialId?: string;
  readonly clock?: () => string;
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
      const approval = await this.options.legacyAuthority.readGeminiApproval(input.projectId);
      const legacyAllowed = await this.options.legacyAuthority.readLegacyExternalTransferAllowed(
        input.projectId,
      );
      return (
        !approval &&
        legacyAllowed &&
        this.legacyAvailable(input.projectId, input.executionPin.modelId)
      );
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
    const approval = await this.options.legacyAuthority.readGeminiApproval(projectId);
    const legacyAllowed =
      await this.options.legacyAuthority.readLegacyExternalTransferAllowed(projectId);
    if (approval || !legacyAllowed || !this.legacyAvailable(projectId, modelId)) {
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
