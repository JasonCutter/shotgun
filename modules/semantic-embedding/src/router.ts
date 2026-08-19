import {
  type ExternalTransferSensitivity,
  type ProviderDeploymentCeiling,
  type ProviderExternalTransferApprovalPort,
  evaluateProviderExternalTransfer,
} from '../../../modules/provider-privacy-policy/src/index.js';
import type { CredentialVaultPort } from '../../../modules/credential-vault/src/index.js';
import {
  type ProviderStatusReaderPort,
  type SemanticEmbeddingExecutionPin,
  type SemanticEmbeddingPayload,
  type SemanticEmbeddingRegistryPort,
  type SemanticEmbeddingResult,
  type SemanticEmbeddingRouterPort,
  SemanticEmbeddingError,
  ShotgunError,
} from '../../../packages/contracts/src/index.js';

export type ProviderEmbeddingRequest = {
  readonly modelId: string;
  readonly input: string | readonly string[];
  readonly dimension: number;
  readonly secretBytes: Uint8Array;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
};

export type ProviderEmbeddingResponseItem = {
  readonly vector: readonly number[];
  readonly dimension: number;
  readonly tokenCount?: number;
};

export type ProviderEmbeddingResponse = {
  readonly providerId: string;
  readonly modelId: string;
  readonly items: readonly ProviderEmbeddingResponseItem[];
  readonly totalTokens?: number;
};

export type ProviderEmbeddingConnectivityPort = {
  readonly providerId: string;
  embed(request: ProviderEmbeddingRequest): Promise<ProviderEmbeddingResponse>;
};

export type SemanticEmbeddingRouterOptions = {
  readonly legacyExternalTransferAllowed?: (projectId: string) => Promise<boolean>;
  readonly timeoutMs?: number;
};

const mapToSemanticEmbeddingError = (error: unknown, operation: string): SemanticEmbeddingError => {
  if (error instanceof SemanticEmbeddingError) {
    return error;
  }
  if (error instanceof ShotgunError) {
    if (error.code === 'AUTHENTICATION_FAILED') {
      return new SemanticEmbeddingError({
        code: 'CONFIGURATION_REQUIRED',
        safeMessage: 'Provider authentication failed or credential was rejected.',
        operation,
        cause: error,
      });
    }
    if (error.code === 'RATE_LIMITED') {
      return new SemanticEmbeddingError({
        code: 'PROVIDER_FAILURE',
        safeMessage: 'Provider rate limit was reached.',
        operation,
        retryable: true,
        cause: error,
      });
    }
    if (error.code === 'TIMEOUT') {
      return new SemanticEmbeddingError({
        code: 'TIMEOUT',
        safeMessage: 'Embedding request timed out.',
        operation,
        retryable: true,
        cause: error,
      });
    }
    if (error.code === 'POLICY_DENIED') {
      return new SemanticEmbeddingError({
        code: 'POLICY_DENIED',
        safeMessage: error.safeMessage,
        operation,
        cause: error,
      });
    }
    if (error.code === 'VALIDATION_ERROR') {
      return new SemanticEmbeddingError({
        code: 'VALIDATION_FAILURE',
        safeMessage: error.safeMessage,
        operation,
        cause: error,
      });
    }
  }

  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('revoked') || message.includes('missing') || message.includes('not found')) {
    return new SemanticEmbeddingError({
      code: 'CONFIGURATION_REQUIRED',
      safeMessage: 'Pinned credential revision is unavailable or revoked.',
      operation,
      cause: error,
    });
  }

  return new SemanticEmbeddingError({
    code: 'PROVIDER_FAILURE',
    safeMessage: 'Embedding provider execution failed.',
    operation,
    cause: error,
  });
};

export class SemanticEmbeddingRouter implements SemanticEmbeddingRouterPort {
  private readonly connectivities: Map<string, ProviderEmbeddingConnectivityPort>;

  constructor(
    private readonly providerRegistry: ProviderStatusReaderPort,
    private readonly embeddingRegistry: SemanticEmbeddingRegistryPort,
    private readonly vault: CredentialVaultPort,
    private readonly approvalAuthority: ProviderExternalTransferApprovalPort,
    private readonly deploymentCeiling: ProviderDeploymentCeiling,
    connectivities:
      Map<string, ProviderEmbeddingConnectivityPort> | readonly ProviderEmbeddingConnectivityPort[],
    private readonly options: SemanticEmbeddingRouterOptions = {},
  ) {
    if (connectivities instanceof Map) {
      this.connectivities = new Map(connectivities);
    } else {
      this.connectivities = new Map(
        connectivities.map((connectivity) => [connectivity.providerId, connectivity]),
      );
    }
  }

  async embed(
    pin: SemanticEmbeddingExecutionPin,
    payload: SemanticEmbeddingPayload,
    sensitivity: ExternalTransferSensitivity = 'internal',
  ): Promise<SemanticEmbeddingResult> {
    const results = await this.embedBatch(pin, [payload], sensitivity);
    const result = results[0];
    if (!result) {
      throw new SemanticEmbeddingError({
        code: 'VALIDATION_FAILURE',
        safeMessage: 'Expected 1 embedding result from provider.',
        operation: 'embed',
      });
    }
    return result;
  }

  async embedBatch(
    pin: SemanticEmbeddingExecutionPin,
    payloads: readonly SemanticEmbeddingPayload[],
    sensitivity: ExternalTransferSensitivity = 'internal',
  ): Promise<readonly SemanticEmbeddingResult[]> {
    const projectId = pin?.projectId?.trim();
    if (!projectId) {
      throw new SemanticEmbeddingError({
        code: 'INVALID_INPUT',
        safeMessage: 'Project ID is required in execution pin.',
        operation: 'embed-batch',
      });
    }

    if (!payloads || payloads.length === 0) {
      throw new SemanticEmbeddingError({
        code: 'INVALID_INPUT',
        safeMessage: 'Payloads array cannot be empty.',
        operation: 'embed-batch',
      });
    }

    if (!pin.dimension || !Number.isSafeInteger(pin.dimension) || pin.dimension <= 0) {
      throw new SemanticEmbeddingError({
        code: 'INVALID_INPUT',
        safeMessage: 'Pinned dimension must be a positive integer.',
        operation: 'embed-batch',
      });
    }

    // 1. Validate payload texts
    for (let i = 0; i < payloads.length; i++) {
      const p = payloads[i]!;
      if (!p.text || !p.text.trim()) {
        throw new SemanticEmbeddingError({
          code: 'VALIDATION_FAILURE',
          safeMessage: `Embedding payload text at index ${i} cannot be empty.`,
          operation: 'embed-batch',
        });
      }
    }

    // 2. Validate provider in registry
    const provider = this.providerRegistry.getProvider(pin.providerId);
    if (!provider || provider.status !== 'active') {
      throw new SemanticEmbeddingError({
        code: 'CAPABILITY_UNAVAILABLE',
        safeMessage: `Embedding provider '${pin.providerId}' is not registered or active.`,
        operation: 'embed-batch',
      });
    }

    // 3. Validate model in registry
    const model = this.embeddingRegistry.getModel(pin.providerId, pin.embeddingModelId);
    if (!model) {
      throw new SemanticEmbeddingError({
        code: 'CAPABILITY_UNAVAILABLE',
        safeMessage: `Embedding model '${pin.embeddingModelId}' is not registered for provider '${pin.providerId}'.`,
        operation: 'embed-batch',
      });
    }

    // 4. Validate batch size bound
    if (payloads.length > model.shotgunBatchLimit) {
      throw new SemanticEmbeddingError({
        code: 'INVALID_INPUT',
        safeMessage: `Batch size ${payloads.length} exceeds model batch limit ${model.shotgunBatchLimit}.`,
        operation: 'embed-batch',
      });
    }

    // 5. Enforce privacy & deployment eligibility before network/credential access
    const approval = await this.approvalAuthority.getCurrent(projectId, pin.providerId);
    const legacyAllowed = this.options.legacyExternalTransferAllowed
      ? await this.options.legacyExternalTransferAllowed(projectId)
      : false;

    const privacyDecision = evaluateProviderExternalTransfer({
      providerId: pin.providerId,
      sensitivity,
      deployment: this.deploymentCeiling,
      approval,
      legacyExternalTransferAllowed: legacyAllowed,
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

    // 6. Check credential vault availability
    const vaultAvailability = this.vault.getAvailability();
    if (vaultAvailability.state !== 'AVAILABLE') {
      throw new SemanticEmbeddingError({
        code: 'CONFIGURATION_REQUIRED',
        safeMessage: 'Credential vault is unavailable.',
        operation: 'embed-batch',
      });
    }

    // 7. Resolve provider connectivity adapter
    const connectivity = this.connectivities.get(pin.providerId);
    if (!connectivity) {
      throw new SemanticEmbeddingError({
        code: 'CAPABILITY_UNAVAILABLE',
        safeMessage: `No embedding connectivity registered for provider '${pin.providerId}'.`,
        operation: 'embed-batch',
      });
    }

    // 8. Execute via CredentialVault.withCredential() with exact pinned revision
    let response: ProviderEmbeddingResponse | undefined;
    try {
      const result = await this.vault.withCredential(
        {
          projectId,
          providerId: pin.providerId,
          credentialId: pin.credentialId,
          credentialRevision: pin.credentialRevision,
        },
        async (secret, metadata) => {
          if (
            metadata &&
            (metadata.projectId !== projectId ||
              metadata.providerId !== pin.providerId ||
              metadata.credentialId !== pin.credentialId ||
              metadata.credentialRevision !== pin.credentialRevision ||
              metadata.lifecycleState !== 'active')
          ) {
            throw new SemanticEmbeddingError({
              code: 'CONFIGURATION_REQUIRED',
              safeMessage: 'Pinned credential revision is unavailable or revoked.',
              operation: 'embed-batch',
            });
          }
          response = await connectivity.embed({
            modelId: pin.embeddingModelId,
            input: payloads.map((p) => p.text),
            dimension: pin.dimension,
            secretBytes: secret,
            ...(this.options.timeoutMs ? { timeoutMs: this.options.timeoutMs } : {}),
          });
          return { status: 'SUCCEEDED' };
        },
      );
      if (result.status !== 'SUCCEEDED') {
        throw new SemanticEmbeddingError({
          code: 'PROVIDER_FAILURE',
          safeMessage: 'Credential execution failed in vault.',
          operation: 'embed-batch',
        });
      }
    } catch (error) {
      throw mapToSemanticEmbeddingError(error, 'embed-batch');
    }

    // 9. Validate response items against contract strictly
    if (!response || !Array.isArray(response.items)) {
      throw new SemanticEmbeddingError({
        code: 'VALIDATION_FAILURE',
        safeMessage: 'Malformed embedding response from provider connectivity.',
        operation: 'embed-batch',
      });
    }

    if (response.providerId !== pin.providerId) {
      throw new SemanticEmbeddingError({
        code: 'VALIDATION_FAILURE',
        safeMessage: `Provider response providerId '${response.providerId}' does not match pinned providerId '${pin.providerId}'.`,
        operation: 'embed-batch',
      });
    }

    if (response.modelId !== pin.embeddingModelId) {
      throw new SemanticEmbeddingError({
        code: 'VALIDATION_FAILURE',
        safeMessage: `Provider response modelId '${response.modelId}' does not match pinned modelId '${pin.embeddingModelId}'.`,
        operation: 'embed-batch',
      });
    }

    if (response.items.length !== payloads.length) {
      throw new SemanticEmbeddingError({
        code: 'VALIDATION_FAILURE',
        safeMessage: `Expected ${payloads.length} embeddings from provider, received ${response.items.length}.`,
        operation: 'embed-batch',
      });
    }

    const results: SemanticEmbeddingResult[] = [];
    for (let i = 0; i < response.items.length; i++) {
      const item = response.items[i]!;
      if (
        !item ||
        typeof item !== 'object' ||
        !Array.isArray(item.vector) ||
        item.vector.length === 0
      ) {
        throw new SemanticEmbeddingError({
          code: 'VALIDATION_FAILURE',
          safeMessage: `Provider returned invalid or empty vector at index ${i}.`,
          operation: 'embed-batch',
        });
      }

      if (item.dimension !== pin.dimension) {
        throw new SemanticEmbeddingError({
          code: 'VALIDATION_FAILURE',
          safeMessage: `Item dimension ${item.dimension} at index ${i} does not match pinned dimension ${pin.dimension}.`,
          operation: 'embed-batch',
        });
      }

      if (item.vector.length !== pin.dimension) {
        throw new SemanticEmbeddingError({
          code: 'VALIDATION_FAILURE',
          safeMessage: `Vector length ${item.vector.length} at index ${i} does not match pinned dimension ${pin.dimension}.`,
          operation: 'embed-batch',
        });
      }

      if (item.dimension !== item.vector.length) {
        throw new SemanticEmbeddingError({
          code: 'VALIDATION_FAILURE',
          safeMessage: `Item dimension ${item.dimension} does not match vector length ${item.vector.length} at index ${i}.`,
          operation: 'embed-batch',
        });
      }

      for (let j = 0; j < item.vector.length; j++) {
        if (typeof item.vector[j] !== 'number' || !Number.isFinite(item.vector[j])) {
          throw new SemanticEmbeddingError({
            code: 'VALIDATION_FAILURE',
            safeMessage: `Provider vector at index ${i} contains non-finite values.`,
            operation: 'embed-batch',
          });
        }
      }

      results.push({
        vector: item.vector,
        dimension: pin.dimension,
        modelId: pin.embeddingModelId,
        providerId: pin.providerId,
        ...(item.tokenCount !== undefined ? { tokenCount: item.tokenCount } : {}),
      });
    }

    return results;
  }
}
