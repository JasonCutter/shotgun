import { ShotgunError, type ErrorCode } from '../../../packages/contracts/src/index.js';

export type CredentialLifecycleState = 'active' | 'superseded' | 'revoked' | 'removed';
export type CredentialMetadata = {
  readonly credentialId: string;
  readonly projectId: string;
  readonly providerId: string;
  readonly encryptionVersion: string;
  readonly keyVersion: string;
  readonly credentialRevision: number;
  readonly lifecycleState: CredentialLifecycleState;
  readonly createdAt: string;
  readonly updatedAt: string;
};
export type CredentialScope = {
  readonly projectId: string;
  readonly providerId: string;
  readonly credentialId: string;
  readonly credentialRevision: number;
};
export type CredentialVaultAvailability =
  | { readonly state: 'AVAILABLE'; readonly keyVersion: string }
  | {
      readonly state: 'UNAVAILABLE';
      readonly reason:
        'MISSING_MASTER_KEY' | 'MALFORMED_MASTER_KEY' | 'UNSUPPORTED_MASTER_KEY_VERSION';
    };
export type CredentialVaultPort = {
  create(input: {
    readonly projectId: string;
    readonly providerId: string;
    readonly secret: string | Uint8Array;
    readonly now?: string;
  }): Promise<CredentialMetadata>;
  replace(input: {
    readonly projectId: string;
    readonly providerId: string;
    readonly credentialId: string;
    readonly expectedRevision: number;
    readonly secret: string | Uint8Array;
    readonly now?: string;
  }): Promise<CredentialMetadata>;
  revoke(scope: CredentialScope, now?: string): Promise<CredentialMetadata>;
  remove(scope: CredentialScope, now?: string): Promise<CredentialMetadata>;
  getMetadata(scope: CredentialScope): Promise<CredentialMetadata | undefined>;
  getWriteOutcome(input: {
    readonly projectId: string;
    readonly clientRequestId: string;
  }): Promise<CredentialMetadata | undefined>;
  listMetadata?(projectId: string): Promise<readonly CredentialMetadata[]>;
  getAvailability(): CredentialVaultAvailability;
  withCredential(
    scope: CredentialScope,
    callback: (
      secret: Uint8Array,
      metadata: CredentialMetadata,
    ) => Promise<{ readonly status: 'SUCCEEDED' | 'FAILED' }>,
  ): Promise<{ readonly status: 'SUCCEEDED' | 'FAILED' }>;
};

export type AIModelDescriptor = {
  readonly providerId: string;
  readonly modelId: string;
  readonly displayName: string;
  readonly shotgunUsableCapabilities: readonly string[];
  readonly capabilityRevision: string;
};
export type AIProviderDescriptor = {
  readonly providerId: string;
  readonly displayName: string;
  readonly status: 'active' | 'disabled';
  readonly models: readonly AIModelDescriptor[];
};
export type ProviderRegistryPort = {
  listProviders(): readonly AIProviderDescriptor[];
  getProvider(providerId: string): AIProviderDescriptor | undefined;
  getModel(providerId: string, modelId: string): AIModelDescriptor | undefined;
};
export type ProjectAIConfiguration = {
  readonly projectId: string;
  readonly activeProviderId: string;
  readonly activeModelId: string;
  readonly credentialId: string;
  readonly credentialRevision: number;
  readonly aiConfigurationRevision: number;
  readonly updatedBy: string;
  readonly updatedAt: string;
};
export type ProjectAIConfigurationPort = {
  getCurrent(projectId: string): Promise<ProjectAIConfiguration | undefined>;
  save(input: {
    readonly projectId: string;
    readonly expectedRevision: number;
    readonly activeProviderId: string;
    readonly activeModelId: string;
    readonly credentialId: string;
    readonly credentialRevision: number;
    readonly updatedBy: string;
    readonly now?: string;
  }): Promise<ProjectAIConfiguration>;
};
export type ProviderExternalTransferApproval = {
  readonly projectId: string;
  readonly providerId: string;
  readonly approved: boolean;
  readonly approvalRevision: number;
  readonly reviewedBy: string;
  readonly reviewedAt: string;
};
export type ProviderExternalTransferApprovalPort = {
  getCurrent(
    projectId: string,
    providerId: string,
  ): Promise<ProviderExternalTransferApproval | undefined>;
};
export type ProviderDeploymentCeiling = {
  readonly allows: (providerId: string) => boolean;
};
export type StructuredGenerationRequest = {
  readonly systemInstruction: string;
  readonly prompt: string;
  readonly responseSchema: Record<string, unknown>;
};
export type StructuredGenerationResponse = {
  readonly rawText: string;
  readonly providerResponseId?: string;
  readonly modelVersion?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
};

export type AIProviderConnectivityAdapter = {
  readonly providerId: string;
  testConnection(input: {
    readonly modelId: string;
    readonly apiKey: Uint8Array;
    readonly signal?: AbortSignal;
  }): Promise<{ readonly providerRequestId?: string }>;
  generateStructured(input: {
    readonly modelId: string;
    readonly apiKey: Uint8Array;
    readonly request: StructuredGenerationRequest;
    readonly signal?: AbortSignal;
  }): Promise<StructuredGenerationResponse>;
};

export type AIProviderConnectivityRegistry = {
  get(providerId: string): AIProviderConnectivityAdapter | undefined;
};

export class StaticAIProviderConnectivityRegistry implements AIProviderConnectivityRegistry {
  private readonly adapters: ReadonlyMap<string, AIProviderConnectivityAdapter>;

  constructor(adapters: readonly AIProviderConnectivityAdapter[]) {
    this.adapters = new Map(adapters.map((adapter) => [adapter.providerId, adapter]));
  }

  get(providerId: string): AIProviderConnectivityAdapter | undefined {
    return this.adapters.get(providerId.trim());
  }
}

export type LegacyPrivacyReaderPort = {
  getLegacyExternalTransferAllowed(projectId: string): Promise<boolean>;
};

export type LegacyCredentialReaderPort = {
  isGeminiCredentialConfigured(): boolean;
};

export type AISettingsMode = 'LEGACY_GEMINI_COMPATIBILITY' | 'PROJECT_MANAGED' | 'UNCONFIGURED';

export type AIProviderPrivacyStatus = {
  readonly providerId: string;
  readonly deploymentAllowed: boolean;
  readonly approval?: ProviderExternalTransferApproval;
  readonly legacyGeminiCompatibility: boolean;
};

export type AICredentialStatus = Pick<
  CredentialMetadata,
  | 'credentialId'
  | 'projectId'
  | 'providerId'
  | 'credentialRevision'
  | 'lifecycleState'
  | 'createdAt'
  | 'updatedAt'
>;

export type AISettingsReadModel = {
  readonly projectId: string;
  readonly mode: AISettingsMode;
  readonly defaultProviderId: 'deepseek';
  readonly currentConfiguration?: ProjectAIConfiguration;
  readonly providers: readonly AIProviderDescriptor[];
  readonly credentialStatuses: readonly AICredentialStatus[];
  readonly privacy: readonly AIProviderPrivacyStatus[];
  readonly vaultAvailability: ReturnType<CredentialVaultPort['getAvailability']>;
  readonly legacyGeminiCredentialConfigured: boolean;
};

export type TestConnectionStatus =
  | 'CONNECTED'
  | 'AUTHENTICATION_FAILED'
  | 'MODEL_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'TEMPORARILY_UNAVAILABLE'
  | 'FAILED';

export type TestConnectionResult = {
  readonly providerId: string;
  readonly modelId: string;
  readonly status: TestConnectionStatus;
  readonly checkedAt: string;
  readonly safeMessage: string;
  readonly errorCode?: ErrorCode;
  readonly providerRequestId?: string;
};

export type AISettingsBackendPort = {
  getSettings(projectId: string): Promise<AISettingsReadModel>;
  createCredential(input: {
    readonly projectId: string;
    readonly providerId: string;
    readonly secret: string;
    readonly clientRequestId?: string;
    readonly now?: string;
  }): Promise<CredentialMetadata>;
  replaceCredential(input: {
    readonly projectId: string;
    readonly providerId: string;
    readonly credentialId: string;
    readonly expectedRevision: number;
    readonly secret: string;
    readonly clientRequestId?: string;
    readonly now?: string;
  }): Promise<CredentialMetadata>;
  getCredentialWriteOutcome(input: {
    readonly projectId: string;
    readonly clientRequestId: string;
  }): Promise<CredentialMetadata | undefined>;
  revokeCredential(input: CredentialScope & { readonly now?: string }): Promise<CredentialMetadata>;
  removeCredential(input: CredentialScope & { readonly now?: string }): Promise<CredentialMetadata>;
  saveConfiguration(
    input: Parameters<ProjectAIConfigurationPort['save']>[0],
  ): Promise<ProjectAIConfiguration>;
  testConnection(input: {
    readonly projectId: string;
    readonly providerId: string;
    readonly modelId: string;
    readonly credentialId?: string;
    readonly credentialRevision?: number;
    readonly draftSecret?: string;
    readonly signal?: AbortSignal;
    readonly now?: string;
  }): Promise<TestConnectionResult>;
};

export class AISettingsBackendError extends Error {
  constructor(
    readonly code:
      | 'INVALID_INPUT'
      | 'UNKNOWN_PROVIDER'
      | 'UNKNOWN_MODEL'
      | 'CREDENTIAL_REQUIRED'
      | 'CREDENTIAL_NOT_FOUND',
    message: string,
  ) {
    super(message);
    this.name = 'AISettingsBackendError';
  }
}

const normalize = (name: string, value: string, maxLength = 256): string => {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new AISettingsBackendError('INVALID_INPUT', `${name} is invalid.`);
  }
  return normalized;
};

const secretValue = (name: string, value: string): string => {
  if (!value || value.length > 16_384) {
    throw new AISettingsBackendError('INVALID_INPUT', `${name} is invalid.`);
  }
  return value;
};

const optionalRevision = (value: number | undefined): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new AISettingsBackendError('INVALID_INPUT', 'Credential revision is invalid.');
  }
  return value as number;
};

const safeCredentialStatus = (metadata: CredentialMetadata): AICredentialStatus => ({
  credentialId: metadata.credentialId,
  projectId: metadata.projectId,
  providerId: metadata.providerId,
  credentialRevision: metadata.credentialRevision,
  lifecycleState: metadata.lifecycleState,
  createdAt: metadata.createdAt,
  updatedAt: metadata.updatedAt,
});

const errorCodeOf = (error: unknown): ErrorCode | undefined =>
  error instanceof ShotgunError ? error.code : undefined;

const testStatusOf = (code: ErrorCode | undefined): TestConnectionStatus => {
  switch (code) {
    case 'AUTHENTICATION_FAILED':
    case 'AUTHENTICATION_INVALID':
      return 'AUTHENTICATION_FAILED';
    case 'RATE_LIMITED':
      return 'RATE_LIMITED';
    case 'RETRYABLE_DEPENDENCY':
    case 'TIMEOUT':
      return 'TEMPORARILY_UNAVAILABLE';
    case 'TERMINAL_FAILURE':
      return 'FAILED';
    default:
      return 'FAILED';
  }
};

const safeMessageOf = (error: unknown): string =>
  error instanceof ShotgunError ? error.safeMessage : 'Provider connectivity test failed.';

export class AISettingsBackendService implements AISettingsBackendPort {
  constructor(
    private readonly registry: ProviderRegistryPort,
    private readonly configuration: ProjectAIConfigurationPort,
    private readonly vault: CredentialVaultPort,
    private readonly connectivity: AIProviderConnectivityRegistry,
    private readonly deployment: ProviderDeploymentCeiling,
    private readonly legacyPrivacy?: LegacyPrivacyReaderPort,
    private readonly approvals?: ProviderExternalTransferApprovalPort,
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly legacyCredential?: LegacyCredentialReaderPort,
  ) {}

  async getSettings(projectId: string): Promise<AISettingsReadModel> {
    const normalizedProjectId = normalize('Project ID', projectId);
    const currentConfiguration = await this.configuration.getCurrent(normalizedProjectId);
    const legacyExternalTransferAllowed =
      (await this.legacyPrivacy?.getLegacyExternalTransferAllowed(normalizedProjectId)) ?? false;
    const credentialStatuses = this.vault.listMetadata
      ? (await this.vault.listMetadata(normalizedProjectId)).map(safeCredentialStatus)
      : [];
    const privacy = await Promise.all(
      this.registry.listProviders().map(async (provider) => {
        const providerApproval = await this.approvals?.getCurrent(
          normalizedProjectId,
          provider.providerId,
        );
        return {
          providerId: provider.providerId,
          deploymentAllowed: this.deployment.allows(provider.providerId),
          ...(providerApproval ? { approval: providerApproval } : {}),
          legacyGeminiCompatibility:
            provider.providerId === 'google-gemini' &&
            !providerApproval &&
            legacyExternalTransferAllowed,
        } satisfies AIProviderPrivacyStatus;
      }),
    );
    const legacyGeminiCompatibility = privacy.some(
      (item) => item.providerId === 'google-gemini' && item.legacyGeminiCompatibility,
    );
    return {
      projectId: normalizedProjectId,
      defaultProviderId: 'deepseek',
      mode: currentConfiguration
        ? 'PROJECT_MANAGED'
        : legacyGeminiCompatibility
          ? 'LEGACY_GEMINI_COMPATIBILITY'
          : 'UNCONFIGURED',
      ...(currentConfiguration ? { currentConfiguration } : {}),
      providers: this.registry.listProviders(),
      credentialStatuses,
      privacy,
      vaultAvailability: this.vault.getAvailability(),
      legacyGeminiCredentialConfigured:
        this.legacyCredential?.isGeminiCredentialConfigured() ?? false,
    };
  }

  async createCredential(input: Parameters<AISettingsBackendPort['createCredential']>[0]) {
    this.assertProvider(input.providerId);
    const projectId = normalize('Project ID', input.projectId);
    const secret = secretValue('Credential secret', input.secret);
    return this.vault.create({
      projectId,
      providerId: input.providerId,
      secret,
      ...(input.clientRequestId ? { clientRequestId: input.clientRequestId } : {}),
      ...(input.now ? { now: input.now } : {}),
    });
  }

  async replaceCredential(input: Parameters<AISettingsBackendPort['replaceCredential']>[0]) {
    this.assertProvider(input.providerId);
    return this.vault.replace({
      projectId: normalize('Project ID', input.projectId),
      providerId: input.providerId,
      credentialId: normalize('Credential ID', input.credentialId),
      expectedRevision: optionalRevision(input.expectedRevision),
      secret: secretValue('Credential secret', input.secret),
      ...(input.clientRequestId ? { clientRequestId: input.clientRequestId } : {}),
      ...(input.now ? { now: input.now } : {}),
    });
  }

  async getCredentialWriteOutcome(input: {
    readonly projectId: string;
    readonly clientRequestId: string;
  }): Promise<CredentialMetadata | undefined> {
    return this.vault.getWriteOutcome({
      projectId: normalize('Project ID', input.projectId),
      clientRequestId: normalize('Client request ID', input.clientRequestId),
    });
  }

  async revokeCredential(input: Parameters<AISettingsBackendPort['revokeCredential']>[0]) {
    this.assertProvider(input.providerId);
    return this.vault.revoke(
      {
        projectId: normalize('Project ID', input.projectId),
        providerId: input.providerId,
        credentialId: normalize('Credential ID', input.credentialId),
        credentialRevision: optionalRevision(input.credentialRevision),
      },
      input.now,
    );
  }

  async removeCredential(input: Parameters<AISettingsBackendPort['removeCredential']>[0]) {
    this.assertProvider(input.providerId);
    return this.vault.remove(
      {
        projectId: normalize('Project ID', input.projectId),
        providerId: input.providerId,
        credentialId: normalize('Credential ID', input.credentialId),
        credentialRevision: optionalRevision(input.credentialRevision),
      },
      input.now,
    );
  }

  async saveConfiguration(
    input: Parameters<AISettingsBackendPort['saveConfiguration']>[0],
  ): Promise<ProjectAIConfiguration> {
    return this.configuration.save(input);
  }

  async testConnection(
    input: Parameters<AISettingsBackendPort['testConnection']>[0],
  ): Promise<TestConnectionResult> {
    const projectId = normalize('Project ID', input.projectId);
    const providerId = normalize('Provider ID', input.providerId, 128);
    const modelId = normalize('Model ID', input.modelId);
    const adapter = this.connectivity.get(providerId);
    this.assertProvider(providerId);
    this.assertModel(providerId, modelId);
    if (!adapter) {
      throw new ShotgunError({
        code: 'AI_CAPABILITY_UNAVAILABLE',
        safeMessage: 'The selected provider is not operational.',
        module: 'ai-settings-backend',
        operation: 'test-connection',
      });
    }

    if (input.draftSecret !== undefined && input.credentialId !== undefined) {
      throw new AISettingsBackendError(
        'INVALID_INPUT',
        'Choose either a draft credential or a stored credential revision.',
      );
    }

    const checkedAt = input.now ?? this.clock();
    const execute = async (apiKey: Uint8Array): Promise<TestConnectionResult> => {
      try {
        const result = await adapter.testConnection({
          modelId,
          apiKey,
          ...(input.signal ? { signal: input.signal } : {}),
        });
        return {
          providerId,
          modelId,
          status: 'CONNECTED',
          checkedAt,
          safeMessage: 'Provider connection succeeded.',
          ...(result.providerRequestId ? { providerRequestId: result.providerRequestId } : {}),
        };
      } catch (error) {
        const code = errorCodeOf(error);
        return {
          providerId,
          modelId,
          status: testStatusOf(code),
          checkedAt,
          safeMessage: safeMessageOf(error),
          ...(code ? { errorCode: code } : {}),
        };
      }
    };

    if (input.draftSecret !== undefined) {
      const secret = secretValue('Draft credential secret', input.draftSecret);
      const bytes = Buffer.from(secret, 'utf8');
      try {
        return await execute(bytes);
      } finally {
        bytes.fill(0);
      }
    }

    if (input.credentialId === undefined || input.credentialRevision === undefined) {
      throw new AISettingsBackendError(
        'CREDENTIAL_REQUIRED',
        'A stored credential or draft credential is required.',
      );
    }
    const scope: CredentialScope = {
      projectId,
      providerId,
      credentialId: normalize('Credential ID', input.credentialId),
      credentialRevision: optionalRevision(input.credentialRevision),
    };
    const metadata = await this.vault.getMetadata(scope);
    if (!metadata) {
      throw new AISettingsBackendError(
        'CREDENTIAL_NOT_FOUND',
        'Credential revision was not found.',
      );
    }
    if (metadata.lifecycleState !== 'active') {
      throw new ShotgunError({
        code: 'AI_CAPABILITY_UNAVAILABLE',
        safeMessage: 'The selected credential revision is unavailable.',
        module: 'ai-settings-backend',
        operation: 'test-connection',
      });
    }
    let result: TestConnectionResult | undefined;
    const execution = await this.vault.withCredential(scope, async (apiKey) => {
      result = await execute(apiKey);
      return { status: 'SUCCEEDED' };
    });
    if (execution.status !== 'SUCCEEDED' || !result) {
      throw new ShotgunError({
        code: 'AI_CAPABILITY_UNAVAILABLE',
        safeMessage: 'The selected credential could not be used.',
        module: 'ai-settings-backend',
        operation: 'test-connection',
      });
    }
    return result;
  }

  private assertProvider(providerId: string): AIProviderDescriptor {
    const provider = this.registry.getProvider(providerId.trim());
    if (!provider || provider.status !== 'active') {
      throw new AISettingsBackendError('UNKNOWN_PROVIDER', 'Provider is not registered.');
    }
    return provider;
  }

  private assertModel(providerId: string, modelId: string): AIModelDescriptor {
    const model = this.registry.getModel(providerId.trim(), modelId.trim());
    if (!model) {
      throw new AISettingsBackendError('UNKNOWN_MODEL', 'Model is not registered for provider.');
    }
    return model;
  }
}
