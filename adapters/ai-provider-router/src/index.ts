import { ShotgunError } from '../../../packages/contracts/src/index.js';
import type {
  AIProviderAdapterPort,
  StructuredGenerationRequest,
  StructuredGenerationResponse,
} from '../../../modules/ai-provider/src/index.js';
import type {
  AIProviderConnectivityAdapter,
  AIProviderConnectivityRegistry,
} from '../../../modules/ai-settings-backend/src/index.js';
import type {
  CredentialMetadata,
  CredentialVaultPort,
} from '../../../modules/credential-vault/src/index.js';
import type {
  AIExecutionPin,
  AskAnswerProviderPort,
  AskAnswerProviderRouterPort,
  AskExecutionScope,
} from '../../../modules/frontend-ask-execution/src/index.js';
import type { DiscoveryAIExecutionPinV1 } from '../../../packages/contracts/src/index.js';
import type { ProviderRegistryPort } from '../../../modules/ai-configuration/src/index.js';
import { StructuredAskAnswerProviderAdapter } from '../../ai-provider-ask/src/index.js';

export type AIProviderRouterOptions = {
  readonly legacyCredential?: () => string | undefined;
  readonly legacyCredentialId?: string;
};

const routerError = (message: string, operation: string): ShotgunError =>
  new ShotgunError({
    code: 'AI_CAPABILITY_UNAVAILABLE',
    safeMessage: message,
    module: 'ai-provider-router',
    operation,
  });

export class CredentialBackedAIProviderAdapter implements AIProviderAdapterPort {
  readonly identity: AIProviderAdapterPort['identity'];

  constructor(
    private readonly connectivity: AIProviderConnectivityAdapter,
    private readonly vault: CredentialVaultPort | undefined,
    private readonly scope: {
      readonly projectId: string;
      readonly providerId: string;
      readonly credentialId: string;
      readonly credentialRevision: number;
    },
    modelId: string,
    private readonly legacyCredential: (() => string | undefined) | undefined,
  ) {
    this.identity = {
      provider: scope.providerId,
      model: modelId,
      adapterVersion: 'a8-vault-routed-provider-v1',
      dataPolicyVersion: `a8-provider-policy:${scope.providerId}`,
      supportsOutputTokenLimit: connectivity.supportsOutputTokenLimit === true,
      supportsCancellation: connectivity.supportsCancellation === true,
    };
  }

  generateStructured(request: StructuredGenerationRequest): Promise<StructuredGenerationResponse> {
    return this.generateStructuredWithSignal(request, undefined);
  }

  generateStructuredWithSignal(
    request: StructuredGenerationRequest,
    signal?: AbortSignal,
  ): Promise<StructuredGenerationResponse> {
    return this.invoke(request, signal);
  }

  private async invoke(
    request: StructuredGenerationRequest,
    signal: AbortSignal | undefined,
  ): Promise<StructuredGenerationResponse> {
    let response: StructuredGenerationResponse | undefined;
    const execute = async (
      secret: Uint8Array,
      metadata?: CredentialMetadata,
    ): Promise<{ readonly status: 'SUCCEEDED' }> => {
      if (
        metadata &&
        (metadata.projectId !== this.scope.projectId ||
          metadata.providerId !== this.scope.providerId ||
          metadata.credentialId !== this.scope.credentialId ||
          metadata.credentialRevision !== this.scope.credentialRevision ||
          metadata.lifecycleState !== 'active')
      ) {
        throw routerError(
          'The exact pinned credential revision is unavailable.',
          'validate-vault-callback-scope',
        );
      }
      response = await this.connectivity.generateStructured({
        modelId: this.identity.model,
        apiKey: secret,
        request,
        ...(signal === undefined ? {} : { signal }),
      });
      return { status: 'SUCCEEDED' };
    };

    if (this.legacyCredential) {
      const value = this.legacyCredential();
      if (!value?.trim()) {
        throw routerError('The legacy Gemini credential is unavailable.', 'legacy-credential');
      }
      const secret = Buffer.from(value, 'utf8');
      try {
        await execute(secret);
      } finally {
        secret.fill(0);
      }
    } else if (this.vault) {
      const result = await this.vault.withCredential(this.scope, execute);
      if (result.status !== 'SUCCEEDED') {
        throw routerError('The pinned credential could not be used.', 'vault-callback');
      }
    } else {
      throw routerError('No bounded credential access path is configured.', 'resolve-credential');
    }
    if (!response)
      throw routerError('The provider returned no structured response.', 'provider-call');
    return response;
  }
}

/**
 * Shared secret-safe provider adapter factory. Ask and Discovery supply their
 * own domain adapter/prompt boundary while Vault callback and exact credential
 * validation remain one implementation.
 */
export const createCredentialBackedAIProviderAdapter = (input: {
  readonly connectivity: AIProviderConnectivityAdapter;
  readonly vault?: CredentialVaultPort;
  readonly projectId: string;
  readonly providerId: string;
  readonly credentialId: string;
  readonly credentialRevision: number;
  readonly modelId: string;
  readonly legacyCredential?: () => string | undefined;
}): AIProviderAdapterPort =>
  new CredentialBackedAIProviderAdapter(
    input.connectivity,
    input.vault,
    {
      projectId: input.projectId,
      providerId: input.providerId,
      credentialId: input.credentialId,
      credentialRevision: input.credentialRevision,
    },
    input.modelId,
    input.legacyCredential,
  );

export class AIProviderRouter implements AskAnswerProviderRouterPort {
  private readonly legacyCredentialId: string;

  constructor(
    private readonly registry: ProviderRegistryPort,
    private readonly connectivity: AIProviderConnectivityRegistry,
    private readonly vault: CredentialVaultPort,
    private readonly options: AIProviderRouterOptions = {},
  ) {
    this.legacyCredentialId = options.legacyCredentialId ?? 'legacy-gemini-compatibility';
  }

  /**
   * Resolve the neutral structured-output adapter used by Stage 4. This is
   * deliberately separate from the Ask answer adapter: Source candidate
   * extraction must use the same pinned Vault/provider route without inheriting
   * Ask answer/citation semantics.
   */
  async resolveStructured(input: {
    readonly projectId: string;
    readonly executionPin: AIExecutionPin;
  }): Promise<AIProviderAdapterPort> {
    if (input.projectId !== input.executionPin.projectId) {
      throw routerError(
        'The structured provider route is bound to another Project.',
        'validate-project-route',
      );
    }
    if (input.executionPin.credentialId === this.legacyCredentialId) {
      throw routerError(
        'Legacy provider credentials are not permitted for Stage 4 Source processing.',
        'reject-legacy-source-route',
      );
    }
    const provider = this.registry.getProvider(input.executionPin.providerId);
    const model = this.registry.getModel(input.executionPin.providerId, input.executionPin.modelId);
    const connectivity = this.connectivity.get(input.executionPin.providerId);
    if (
      !provider ||
      provider.status !== 'active' ||
      !model ||
      !model.shotgunUsableCapabilities.includes('structuredOutput') ||
      !connectivity
    ) {
      throw routerError(
        'The pinned structured provider route is unavailable.',
        'resolve-structured-provider-route',
      );
    }
    return createCredentialBackedAIProviderAdapter({
      connectivity,
      vault: this.vault,
      projectId: input.projectId,
      providerId: input.executionPin.providerId,
      credentialId: input.executionPin.credentialId,
      credentialRevision: input.executionPin.credentialRevision,
      modelId: model.modelId,
    });
  }

  async resolve(input: {
    readonly scope: AskExecutionScope;
    readonly executionPin: AIExecutionPin;
  }): Promise<AskAnswerProviderPort> {
    if (input.scope.projectId !== input.executionPin.projectId) {
      throw routerError(
        'The provider route is bound to another Project.',
        'validate-project-route',
      );
    }
    const provider = this.registry.getProvider(input.executionPin.providerId);
    const model = this.registry.getModel(input.executionPin.providerId, input.executionPin.modelId);
    const connectivity = this.connectivity.get(input.executionPin.providerId);
    if (!provider || provider.status !== 'active' || !model || !connectivity) {
      throw routerError('The pinned provider route is unavailable.', 'resolve-provider-route');
    }
    const legacy =
      input.executionPin.providerId === 'google-gemini' &&
      input.executionPin.credentialId === this.legacyCredentialId;
    const adapter = createCredentialBackedAIProviderAdapter({
      connectivity,
      vault: legacy ? undefined : this.vault,
      projectId: input.executionPin.projectId,
      providerId: input.executionPin.providerId,
      credentialId: input.executionPin.credentialId,
      credentialRevision: input.executionPin.credentialRevision,
      modelId: model.modelId,
      legacyCredential: legacy ? this.options.legacyCredential : undefined,
    });
    return new StructuredAskAnswerProviderAdapter(adapter, {
      allowPrivate: true,
      allowRestricted: false,
      dataPolicyVersion: `a8-provider-policy:${provider.providerId}`,
    });
  }

  /** Discovery receives the neutral structured adapter, never the Ask answer adapter. */
  async resolveDiscovery(input: {
    readonly projectId: string;
    readonly executionPin: DiscoveryAIExecutionPinV1;
  }): Promise<AIProviderAdapterPort> {
    if (input.projectId !== input.executionPin.projectId) {
      throw routerError(
        'The Discovery provider route is bound to another Project.',
        'validate-project-route',
      );
    }
    const provider = this.registry.getProvider(input.executionPin.providerId);
    const model = this.registry.getModel(input.executionPin.providerId, input.executionPin.modelId);
    const connectivity = this.connectivity.get(input.executionPin.providerId);
    if (!provider || provider.status !== 'active' || !model || !connectivity) {
      throw routerError(
        'The pinned Discovery provider route is unavailable.',
        'resolve-provider-route',
      );
    }
    if (input.executionPin.modelCapabilityRevision !== model.capabilityRevision) {
      throw routerError(
        'The pinned Discovery model capability revision is unavailable.',
        'resolve-capability-revision',
      );
    }
    return createCredentialBackedAIProviderAdapter({
      connectivity,
      vault: this.vault,
      projectId: input.projectId,
      providerId: input.executionPin.providerId,
      credentialId: input.executionPin.credentialId,
      credentialRevision: input.executionPin.credentialRevision,
      modelId: model.modelId,
    });
  }
}
