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

class CredentialBackedAIProviderAdapter implements AIProviderAdapterPort {
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
    const adapter = new CredentialBackedAIProviderAdapter(
      connectivity,
      legacy ? undefined : this.vault,
      {
        projectId: input.executionPin.projectId,
        providerId: input.executionPin.providerId,
        credentialId: input.executionPin.credentialId,
        credentialRevision: input.executionPin.credentialRevision,
      },
      model.modelId,
      legacy ? this.options.legacyCredential : undefined,
    );
    return new StructuredAskAnswerProviderAdapter(adapter, {
      allowPrivate: true,
      allowRestricted: false,
      dataPolicyVersion: `a8-provider-policy:${provider.providerId}`,
    });
  }
}
