export const A3_PROVIDER_REGISTRY_REVISION = 'provider-registry:v1';
export const A3_MODEL_CATALOG_REVISION = 'model-catalog:v1';

export type AIProviderStatus = 'active' | 'disabled';
export type AIProviderCapability = 'text' | 'image' | 'audio' | 'structuredOutput';

export type AIValidationContract = {
  readonly name: 'structured-json';
  readonly version: 'v1';
  readonly schema: 'shotgun-local-schema-and-semantic-validation';
};

export type AIModelDescriptor = {
  readonly providerId: string;
  readonly modelId: string;
  readonly displayName: string;
  readonly providerNativeCapabilities: readonly AIProviderCapability[];
  readonly shotgunUsableCapabilities: readonly AIProviderCapability[];
  readonly validationContract: AIValidationContract;
  readonly capabilityRevision: string;
};

export type AIProviderDescriptor = {
  readonly providerId: string;
  readonly displayName: string;
  readonly adapterKind: 'openai' | 'google-gemini' | 'deepseek';
  readonly credentialRequired: true;
  readonly providerPolicyId: string;
  readonly providerPolicyRevision: string;
  readonly status: AIProviderStatus;
  readonly nativeCapabilities: readonly AIProviderCapability[];
  readonly shotgunUsableCapabilities: readonly AIProviderCapability[];
  readonly models: readonly AIModelDescriptor[];
  readonly registryRevision: typeof A3_PROVIDER_REGISTRY_REVISION;
};

export type ProviderRegistryPort = {
  listProviders(): readonly AIProviderDescriptor[];
  getProvider(providerId: string): AIProviderDescriptor | undefined;
  getModel(providerId: string, modelId: string): AIModelDescriptor | undefined;
};

export type CredentialMetadataReference = {
  readonly credentialId: string;
  readonly projectId: string;
  readonly providerId: string;
  readonly credentialRevision: number;
  readonly lifecycleState: 'active' | 'superseded' | 'revoked' | 'removed';
};

export type CredentialMetadataReaderPort = {
  getMetadata(scope: {
    readonly projectId: string;
    readonly providerId: string;
    readonly credentialId: string;
    readonly credentialRevision: number;
  }): Promise<CredentialMetadataReference | undefined>;
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

export type ProjectAIConfigurationRepositoryPort = {
  findCurrent(projectId: string): Promise<ProjectAIConfiguration | undefined>;
  findRevision(projectId: string, revision: number): Promise<ProjectAIConfiguration | undefined>;
  saveRevision(input: {
    readonly expectedRevision: number;
    readonly next: ProjectAIConfiguration;
  }): Promise<'CREATED' | 'UPDATED' | 'CONFLICT'>;
};

export type ProjectAIConfigurationPort = {
  listProviders(): readonly AIProviderDescriptor[];
  listModels(providerId: string): readonly AIModelDescriptor[];
  getCurrent(projectId: string): Promise<ProjectAIConfiguration | undefined>;
  getRevision(projectId: string, revision: number): Promise<ProjectAIConfiguration | undefined>;
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

export class AIConfigurationError extends Error {
  constructor(
    readonly code:
      | 'INVALID_INPUT'
      | 'UNKNOWN_PROVIDER'
      | 'UNKNOWN_MODEL'
      | 'CREDENTIAL_NOT_FOUND'
      | 'CREDENTIAL_OWNERSHIP_DENIED'
      | 'CREDENTIAL_UNAVAILABLE'
      | 'CONFLICT',
    message: string,
  ) {
    super(message);
    this.name = 'AIConfigurationError';
  }
}

const descriptor = (
  providerId: string,
  displayName: string,
  adapterKind: AIProviderDescriptor['adapterKind'],
  providerPolicyId: string,
  nativeCapabilities: readonly AIProviderCapability[],
  shotgunUsableCapabilities: readonly AIProviderCapability[],
  modelId: string,
  modelDisplayName: string,
  modelNativeCapabilities: readonly AIProviderCapability[],
  modelUsableCapabilities: readonly AIProviderCapability[],
): AIProviderDescriptor => ({
  providerId,
  displayName,
  adapterKind,
  credentialRequired: true,
  providerPolicyId,
  providerPolicyRevision: 'v1',
  status: 'active',
  nativeCapabilities,
  shotgunUsableCapabilities,
  models: [
    {
      providerId,
      modelId,
      displayName: modelDisplayName,
      providerNativeCapabilities: modelNativeCapabilities,
      shotgunUsableCapabilities: modelUsableCapabilities,
      validationContract: {
        name: 'structured-json',
        version: 'v1',
        schema: 'shotgun-local-schema-and-semantic-validation',
      },
      capabilityRevision: A3_MODEL_CATALOG_REVISION,
    },
  ],
  registryRevision: A3_PROVIDER_REGISTRY_REVISION,
});

const initialProviders: readonly AIProviderDescriptor[] = [
  descriptor(
    'openai',
    'OpenAI',
    'openai',
    'openai-data-policy',
    ['text', 'image', 'structuredOutput'],
    ['text', 'image', 'structuredOutput'],
    'gpt-5.6-luna',
    'GPT-5.6 Luna',
    ['text', 'image', 'structuredOutput'],
    ['text', 'image', 'structuredOutput'],
  ),
  descriptor(
    'google-gemini',
    'Google Gemini',
    'google-gemini',
    'google-gemini-data-policy',
    ['text', 'image', 'audio', 'structuredOutput'],
    ['text', 'structuredOutput'],
    'gemini-3.6-flash',
    'Gemini 3.6 Flash',
    ['text', 'image', 'audio', 'structuredOutput'],
    ['text', 'structuredOutput'],
  ),
  descriptor(
    'deepseek',
    'DeepSeek',
    'deepseek',
    'deepseek-data-policy',
    ['text', 'structuredOutput'],
    ['text', 'structuredOutput'],
    'deepseek-v4-flash',
    'DeepSeek V4 Flash',
    ['text', 'structuredOutput'],
    ['text', 'structuredOutput'],
  ),
];

const copyModel = (model: AIModelDescriptor): AIModelDescriptor => ({
  ...model,
  providerNativeCapabilities: [...model.providerNativeCapabilities],
  shotgunUsableCapabilities: [...model.shotgunUsableCapabilities],
  validationContract: { ...model.validationContract },
});

const copyProvider = (provider: AIProviderDescriptor): AIProviderDescriptor => ({
  ...provider,
  nativeCapabilities: [...provider.nativeCapabilities],
  shotgunUsableCapabilities: [...provider.shotgunUsableCapabilities],
  models: provider.models.map(copyModel),
});

export class StaticProviderRegistry implements ProviderRegistryPort {
  private readonly providers: readonly AIProviderDescriptor[];

  constructor() {
    this.providers = initialProviders.map(copyProvider);
  }

  listProviders(): readonly AIProviderDescriptor[] {
    return this.providers.map(copyProvider);
  }

  getProvider(providerId: string): AIProviderDescriptor | undefined {
    const provider = this.providers.find((item) => item.providerId === providerId.trim());
    return provider ? copyProvider(provider) : undefined;
  }

  getModel(providerId: string, modelId: string): AIModelDescriptor | undefined {
    const provider = this.providers.find((item) => item.providerId === providerId.trim());
    const model = provider?.models.find((item) => item.modelId === modelId.trim());
    return model ? copyModel(model) : undefined;
  }
}

const identifier = (name: string, value: string, maxLength = 256): string => {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new AIConfigurationError('INVALID_INPUT', `${name} is invalid.`);
  }
  return normalized;
};

const positiveRevision = (name: string, value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new AIConfigurationError('INVALID_INPUT', `${name} is invalid.`);
  }
  return value;
};

const expectedRevision = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AIConfigurationError('INVALID_INPUT', 'Expected configuration revision is invalid.');
  }
  return value;
};

const mapCredentialScope = (input: {
  readonly projectId: string;
  readonly providerId: string;
  readonly credentialId: string;
  readonly credentialRevision: number;
}) => ({
  projectId: input.projectId,
  providerId: input.providerId,
  credentialId: input.credentialId,
  credentialRevision: input.credentialRevision,
});

export class ProjectAIConfigurationService implements ProjectAIConfigurationPort {
  constructor(
    private readonly registry: ProviderRegistryPort,
    private readonly repository: ProjectAIConfigurationRepositoryPort,
    private readonly credentials: CredentialMetadataReaderPort,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {}

  listProviders(): readonly AIProviderDescriptor[] {
    return this.registry.listProviders();
  }

  listModels(providerId: string): readonly AIModelDescriptor[] {
    const normalizedProviderId = identifier('Provider ID', providerId, 128);
    const provider = this.registry.getProvider(normalizedProviderId);
    if (!provider)
      throw new AIConfigurationError('UNKNOWN_PROVIDER', 'Provider is not registered.');
    return provider.models;
  }

  async getCurrent(projectId: string): Promise<ProjectAIConfiguration | undefined> {
    return this.repository.findCurrent(identifier('Project ID', projectId));
  }

  async getRevision(
    projectId: string,
    revision: number,
  ): Promise<ProjectAIConfiguration | undefined> {
    return this.repository.findRevision(
      identifier('Project ID', projectId),
      positiveRevision('Configuration revision', revision),
    );
  }

  async save(input: Parameters<ProjectAIConfigurationPort['save']>[0]) {
    const projectId = identifier('Project ID', input.projectId);
    const providerId = identifier('Provider ID', input.activeProviderId, 128);
    const modelId = identifier('Model ID', input.activeModelId, 256);
    const credentialId = identifier('Credential ID', input.credentialId, 256);
    const credentialRevision = positiveRevision('Credential revision', input.credentialRevision);
    const expected = expectedRevision(input.expectedRevision);
    const updatedBy = identifier('Updated by', input.updatedBy, 256);

    const provider = this.registry.getProvider(providerId);
    if (!provider || provider.status !== 'active') {
      throw new AIConfigurationError('UNKNOWN_PROVIDER', 'Provider is not registered.');
    }
    const model = this.registry.getModel(providerId, modelId);
    if (!model)
      throw new AIConfigurationError('UNKNOWN_MODEL', 'Model is not registered for provider.');

    const metadata = await this.credentials.getMetadata(
      mapCredentialScope({
        projectId,
        providerId,
        credentialId,
        credentialRevision,
      }),
    );
    if (!metadata)
      throw new AIConfigurationError('CREDENTIAL_NOT_FOUND', 'Credential is not available.');
    if (
      metadata.projectId !== projectId ||
      metadata.providerId !== providerId ||
      metadata.credentialId !== credentialId ||
      metadata.credentialRevision !== credentialRevision
    ) {
      throw new AIConfigurationError(
        'CREDENTIAL_OWNERSHIP_DENIED',
        'Credential ownership is invalid.',
      );
    }
    if (metadata.lifecycleState !== 'active') {
      throw new AIConfigurationError('CREDENTIAL_UNAVAILABLE', 'Credential is not active.');
    }

    const current = await this.repository.findCurrent(projectId);
    if ((current?.aiConfigurationRevision ?? 0) !== expected) {
      throw new AIConfigurationError('CONFLICT', 'Configuration revision is stale.');
    }

    const next: ProjectAIConfiguration = {
      projectId,
      activeProviderId: providerId,
      activeModelId: modelId,
      credentialId,
      credentialRevision,
      aiConfigurationRevision: expected + 1,
      updatedBy,
      updatedAt: input.now ?? this.clock(),
    };
    const result = await this.repository.saveRevision({ expectedRevision: expected, next });
    if (result === 'CONFLICT') {
      throw new AIConfigurationError('CONFLICT', 'Configuration revision changed concurrently.');
    }
    return next;
  }
}

export const initialProviderRegistry = (): ProviderRegistryPort => new StaticProviderRegistry();
