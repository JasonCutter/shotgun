import { createHash, randomUUID } from 'node:crypto';

import {
  SEMANTIC_EMBEDDING_CATALOG_REVISION,
  SEMANTIC_REPRESENTATION_VERSION,
  SemanticEmbeddingError,
  type EmbeddingCredentialReaderPort,
  type ProviderStatusReaderPort,
  type SemanticDistanceMetric,
  type SemanticEmbeddingExecutionPort,
  type SemanticEmbeddingModelDescriptor,
  type SemanticEmbeddingPayload,
  type SemanticEmbeddingProfile,
  type SemanticEmbeddingProfilePort,
  type SemanticEmbeddingProfileRepositoryPort,
  type SemanticEmbeddingRegistryPort,
  type SemanticEmbeddingResult,
  type SemanticNormalizationPolicy,
} from '../../../packages/contracts/src/index.js';

const initialEmbeddingModels: readonly SemanticEmbeddingModelDescriptor[] = [
  {
    providerId: 'openai',
    modelId: 'text-embedding-3-small',
    displayName: 'Text Embedding 3 Small',
    providerDefaultDimension: 1536,
    shotgunDefaultDimension: 1536,
    shotgunAllowedDimensions: [512, 1536],
    shotgunBatchLimit: 2048,
    capabilityRevision: SEMANTIC_EMBEDDING_CATALOG_REVISION,
    supportedDistanceMetrics: ['cosine', 'dot_product', 'euclidean'],
    defaultDistanceMetric: 'cosine',
    defaultNormalizationPolicy: 'unit_length',
  },
  {
    providerId: 'openai',
    modelId: 'text-embedding-3-large',
    displayName: 'Text Embedding 3 Large',
    providerDefaultDimension: 3072,
    shotgunDefaultDimension: 3072,
    shotgunAllowedDimensions: [256, 1024, 1536, 3072],
    shotgunBatchLimit: 2048,
    capabilityRevision: SEMANTIC_EMBEDDING_CATALOG_REVISION,
    supportedDistanceMetrics: ['cosine', 'dot_product', 'euclidean'],
    defaultDistanceMetric: 'cosine',
    defaultNormalizationPolicy: 'unit_length',
  },
  {
    providerId: 'google-gemini',
    modelId: 'gemini-embedding-001',
    displayName: 'Gemini Embedding 001',
    providerDefaultDimension: 3072,
    providerSupportedDimensionRange: { min: 128, max: 3072 },
    providerRecommendedDimensions: [768, 1536, 3072],
    shotgunDefaultDimension: 768,
    shotgunAllowedDimensions: [128, 256, 512, 768, 1536, 3072],
    shotgunBatchLimit: 100,
    capabilityRevision: SEMANTIC_EMBEDDING_CATALOG_REVISION,
    supportedDistanceMetrics: ['cosine', 'dot_product', 'euclidean'],
    defaultDistanceMetric: 'cosine',
    defaultNormalizationPolicy: 'unit_length',
  },
];

const copyModel = (model: SemanticEmbeddingModelDescriptor): SemanticEmbeddingModelDescriptor => ({
  ...model,
  providerRecommendedDimensions: model.providerRecommendedDimensions
    ? [...model.providerRecommendedDimensions]
    : undefined,
  shotgunAllowedDimensions: [...model.shotgunAllowedDimensions],
  supportedDistanceMetrics: [...model.supportedDistanceMetrics],
});

export class StaticSemanticEmbeddingRegistry implements SemanticEmbeddingRegistryPort {
  private readonly models: readonly SemanticEmbeddingModelDescriptor[];

  constructor(customModels: readonly SemanticEmbeddingModelDescriptor[] = initialEmbeddingModels) {
    this.models = customModels.map(copyModel);
  }

  listModels(providerId?: string): readonly SemanticEmbeddingModelDescriptor[] {
    if (!providerId) {
      return this.models.map(copyModel);
    }
    const normalized = providerId.trim();
    return this.models.filter((model) => model.providerId === normalized).map(copyModel);
  }

  getModel(providerId: string, modelId: string): SemanticEmbeddingModelDescriptor | undefined {
    const normalizedProviderId = providerId.trim();
    const normalizedModelId = modelId.trim();
    const model = this.models.find(
      (item) => item.providerId === normalizedProviderId && item.modelId === normalizedModelId,
    );
    return model ? copyModel(model) : undefined;
  }
}

export const initialSemanticEmbeddingRegistry = (): SemanticEmbeddingRegistryPort =>
  new StaticSemanticEmbeddingRegistry();

const validateIdentifier = (name: string, value: string, maxLength = 256): string => {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new SemanticEmbeddingError({
      code: 'INVALID_INPUT',
      safeMessage: `${name} is invalid.`,
      operation: 'validate-input',
    });
  }
  return normalized;
};

const validateRevision = (name: string, value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new SemanticEmbeddingError({
      code: 'INVALID_INPUT',
      safeMessage: `${name} is invalid.`,
      operation: 'validate-revision',
    });
  }
  return value;
};

const validateExpectedRevision = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new SemanticEmbeddingError({
      code: 'INVALID_INPUT',
      safeMessage: 'Expected profile revision is invalid.',
      operation: 'validate-expected-revision',
    });
  }
  return value;
};

export class SemanticEmbeddingProfileService implements SemanticEmbeddingProfilePort {
  constructor(
    private readonly providerStatus: ProviderStatusReaderPort,
    private readonly embeddingRegistry: SemanticEmbeddingRegistryPort,
    private readonly repository: SemanticEmbeddingProfileRepositoryPort,
    private readonly credentials: EmbeddingCredentialReaderPort,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {}

  async getActive(projectId: string): Promise<SemanticEmbeddingProfile | undefined> {
    return this.repository.findActive(validateIdentifier('Project ID', projectId));
  }

  async getCurrent(projectId: string): Promise<SemanticEmbeddingProfile | undefined> {
    return this.repository.findCurrent(validateIdentifier('Project ID', projectId));
  }

  async getRevision(
    projectId: string,
    revision: number,
  ): Promise<SemanticEmbeddingProfile | undefined> {
    return this.repository.findByRevision(
      validateIdentifier('Project ID', projectId),
      validateRevision('Profile revision', revision),
    );
  }

  async createProfile(
    input: Parameters<SemanticEmbeddingProfilePort['createProfile']>[0],
  ): Promise<SemanticEmbeddingProfile> {
    const projectId = validateIdentifier('Project ID', input.projectId);
    const providerId = validateIdentifier('Provider ID', input.providerId, 128);
    const embeddingModelId = validateIdentifier('Embedding Model ID', input.embeddingModelId, 256);
    const credentialId = validateIdentifier('Credential ID', input.credentialId, 256);
    const credentialRevision = validateRevision('Credential revision', input.credentialRevision);
    const expected = validateExpectedRevision(input.expectedRevision);
    const updatedBy = validateIdentifier('Updated by', input.updatedBy, 256);
    const representationVersion =
      input.representationVersion?.trim() || SEMANTIC_REPRESENTATION_VERSION;

    // 1. Verify provider in authoritative provider registry
    const provider = this.providerStatus.getProvider(providerId);
    if (!provider || provider.status !== 'active') {
      throw new SemanticEmbeddingError({
        code: 'CAPABILITY_UNAVAILABLE',
        safeMessage: 'Provider is not registered or active.',
        operation: 'create-profile',
      });
    }

    // 2. Verify embedding model in embedding catalog
    const model = this.embeddingRegistry.getModel(providerId, embeddingModelId);
    if (!model) {
      throw new SemanticEmbeddingError({
        code: 'CAPABILITY_UNAVAILABLE',
        safeMessage: 'Embedding model is not registered for provider.',
        operation: 'create-profile',
      });
    }

    // 3. Verify credential metadata
    const credential = await this.credentials.getMetadata({
      projectId,
      providerId,
      credentialId,
      credentialRevision,
    });
    if (!credential) {
      throw new SemanticEmbeddingError({
        code: 'CONFIGURATION_REQUIRED',
        safeMessage: 'Referenced credential revision was not found.',
        operation: 'create-profile',
      });
    }
    if (
      credential.projectId !== projectId ||
      credential.providerId !== providerId ||
      credential.credentialId !== credentialId ||
      credential.credentialRevision !== credentialRevision
    ) {
      throw new SemanticEmbeddingError({
        code: 'CONFIGURATION_REQUIRED',
        safeMessage: 'Credential ownership or revision mismatch.',
        operation: 'create-profile',
      });
    }
    if (credential.lifecycleState !== 'active') {
      throw new SemanticEmbeddingError({
        code: 'CONFIGURATION_REQUIRED',
        safeMessage: 'Referenced credential is not active.',
        operation: 'create-profile',
      });
    }

    // 4. Validate dimension and distance metric against Shotgun allowed policy
    const dimension = input.dimension ?? model.shotgunDefaultDimension;
    const isDimensionValid = model.shotgunAllowedDimensions.includes(dimension);

    if (!isDimensionValid) {
      throw new SemanticEmbeddingError({
        code: 'INVALID_INPUT',
        safeMessage: `Dimension ${dimension} is not supported by Shotgun policy for model '${embeddingModelId}'.`,
        operation: 'create-profile',
      });
    }

    const distanceMetric: SemanticDistanceMetric =
      input.distanceMetric ?? model.defaultDistanceMetric;
    if (!model.supportedDistanceMetrics.includes(distanceMetric)) {
      throw new SemanticEmbeddingError({
        code: 'INVALID_INPUT',
        safeMessage: `Distance metric ${distanceMetric} is not supported by model.`,
        operation: 'create-profile',
      });
    }

    const normalizationPolicy: SemanticNormalizationPolicy =
      input.normalizationPolicy ?? model.defaultNormalizationPolicy;

    // 5. Verify expected revision
    const current = await this.repository.findCurrent(projectId);
    if ((current?.profileRevision ?? 0) !== expected) {
      throw new SemanticEmbeddingError({
        code: 'CONFLICT',
        safeMessage: 'Profile revision is stale.',
        operation: 'create-profile',
      });
    }

    const now = input.now ?? this.clock();
    const profile: SemanticEmbeddingProfile = {
      profileId: randomUUID(),
      projectId,
      profileRevision: expected + 1,
      providerId,
      embeddingModelId,
      credentialId,
      credentialRevision,
      representationVersion,
      dimension,
      distanceMetric,
      normalizationPolicy,
      status: input.status ?? 'PREPARED',
      createdAt: now,
      createdBy: updatedBy,
      updatedBy,
      updatedAt: now,
    };

    const result = await this.repository.saveRevision({
      expectedRevision: expected,
      next: profile,
    });
    if (result === 'CONFLICT') {
      throw new SemanticEmbeddingError({
        code: 'CONFLICT',
        safeMessage: 'Profile revision changed concurrently.',
        operation: 'create-profile',
      });
    }

    return profile;
  }

  async activateProfile(
    input: Parameters<SemanticEmbeddingProfilePort['activateProfile']>[0],
  ): Promise<SemanticEmbeddingProfile> {
    const projectId = validateIdentifier('Project ID', input.projectId);
    const profileId = validateIdentifier('Profile ID', input.profileId);
    const profileRevision = validateRevision('Profile revision', input.profileRevision);
    const updatedBy = validateIdentifier('Updated by', input.updatedBy, 256);
    const now = input.now ?? this.clock();

    const existing = await this.repository.findByRevision(projectId, profileRevision);
    if (!existing || existing.profileId !== profileId) {
      throw new SemanticEmbeddingError({
        code: 'CONFIGURATION_REQUIRED',
        safeMessage: 'Semantic embedding profile revision was not found.',
        operation: 'activate-profile',
      });
    }

    if (existing.status === 'ACTIVE') {
      return existing;
    }

    if (existing.status === 'FAILED') {
      throw new SemanticEmbeddingError({
        code: 'CONFLICT',
        safeMessage: 'Failed embedding profile cannot be activated.',
        operation: 'activate-profile',
      });
    }

    const updated = await this.repository.updateStatus({
      projectId,
      profileId,
      profileRevision,
      status: 'ACTIVE',
      activatedAt: now,
      updatedBy,
      updatedAt: now,
    });

    if (updated === 'NOT_FOUND') {
      throw new SemanticEmbeddingError({
        code: 'CONFIGURATION_REQUIRED',
        safeMessage: 'Semantic embedding profile was not found.',
        operation: 'activate-profile',
      });
    }

    if (updated === 'CONFLICT') {
      throw new SemanticEmbeddingError({
        code: 'CONFLICT',
        safeMessage: 'Embedding profile status changed concurrently.',
        operation: 'activate-profile',
      });
    }

    return updated;
  }
}

export class DeterministicFakeEmbeddingAdapter implements SemanticEmbeddingExecutionPort {
  readonly identity: {
    readonly providerId: string;
    readonly embeddingModelId: string;
    readonly dimension: number;
  };

  constructor(
    options: {
      readonly providerId?: string;
      readonly embeddingModelId?: string;
      readonly dimension?: number;
    } = {},
  ) {
    this.identity = {
      providerId: options.providerId ?? 'fake-embedding-provider',
      embeddingModelId: options.embeddingModelId ?? 'fake-embedding-model',
      dimension: options.dimension ?? 768,
    };
  }

  async embed(payload: SemanticEmbeddingPayload): Promise<SemanticEmbeddingResult> {
    const text = payload.text.trim();
    if (!text) {
      throw new SemanticEmbeddingError({
        code: 'VALIDATION_FAILURE',
        safeMessage: 'Embedding payload text cannot be empty.',
        operation: 'embed',
      });
    }

    const rawFloats: number[] = [];
    const dimension = this.identity.dimension;

    // Deterministically generate floats from sha256 chunks
    let chunkIndex = 0;
    while (rawFloats.length < dimension) {
      const hash = createHash('sha256').update(`${text}:${chunkIndex}`).digest();
      for (let i = 0; i < hash.length - 4 && rawFloats.length < dimension; i += 4) {
        const intVal = hash.readInt32LE(i);
        rawFloats.push(intVal / 2147483648); // Normalize to [-1, 1]
      }
      chunkIndex++;
    }

    // Normalize to unit length (L2 norm)
    let sumSq = 0;
    for (const val of rawFloats) {
      sumSq += val * val;
    }
    const norm = Math.sqrt(sumSq) || 1;
    const vector = rawFloats.map((val) => Number((val / norm).toFixed(8)));

    if (vector.length !== dimension) {
      throw new SemanticEmbeddingError({
        code: 'VALIDATION_FAILURE',
        safeMessage: `Generated embedding dimension ${vector.length} does not match expected ${dimension}.`,
        operation: 'embed',
      });
    }

    return {
      vector,
      dimension,
      modelId: this.identity.embeddingModelId,
      providerId: this.identity.providerId,
      tokenCount: Math.max(1, Math.ceil(text.length / 4)),
    };
  }

  async embedBatch(
    payloads: readonly SemanticEmbeddingPayload[],
  ): Promise<readonly SemanticEmbeddingResult[]> {
    return Promise.all(payloads.map((payload) => this.embed(payload)));
  }
}

export * from './router.js';
