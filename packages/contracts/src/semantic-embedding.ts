import { type ErrorCode, ShotgunError } from './errors.js';
import type { SemanticResourceType } from './semantic-representation.js';

export const SEMANTIC_EMBEDDING_PROFILE_REVISION = 1;
export const SEMANTIC_EMBEDDING_CATALOG_REVISION = 'semantic-embedding-catalog:v1' as const;

export type SemanticEmbeddingProfileStatus = 'BUILDING' | 'ACTIVE' | 'RETIRED' | 'FAILED';
export type SemanticDistanceMetric = 'cosine' | 'dot_product' | 'euclidean';
export type SemanticNormalizationPolicy = 'unit_length' | 'none';

export type SemanticEmbeddingProfile = {
  readonly profileId: string;
  readonly projectId: string;
  readonly profileRevision: number;
  readonly providerId: string;
  readonly embeddingModelId: string;
  readonly credentialId: string;
  readonly credentialRevision: number;
  readonly representationVersion: string;
  readonly dimension: number;
  readonly distanceMetric: SemanticDistanceMetric;
  readonly normalizationPolicy: SemanticNormalizationPolicy;
  readonly status: SemanticEmbeddingProfileStatus;
  readonly createdAt: string;
  readonly activatedAt?: string;
  readonly updatedBy: string;
  readonly updatedAt: string;
};

export type ProviderStatusReaderPort = {
  getProvider(
    providerId: string,
  ): { readonly providerId: string; readonly status: string } | undefined;
};

export type EmbeddingCredentialMetadataReference = {
  readonly credentialId: string;
  readonly projectId: string;
  readonly providerId: string;
  readonly credentialRevision: number;
  readonly lifecycleState: 'active' | 'superseded' | 'revoked' | 'removed';
};

export type EmbeddingCredentialReaderPort = {
  getMetadata(scope: {
    readonly projectId: string;
    readonly providerId: string;
    readonly credentialId: string;
    readonly credentialRevision: number;
  }): Promise<EmbeddingCredentialMetadataReference | undefined>;
};

export type SemanticEmbeddingProfileRepositoryPort = {
  findActive(projectId: string): Promise<SemanticEmbeddingProfile | undefined>;
  findCurrent(projectId: string): Promise<SemanticEmbeddingProfile | undefined>;
  findByRevision(
    projectId: string,
    revision: number,
  ): Promise<SemanticEmbeddingProfile | undefined>;
  saveRevision(input: {
    readonly expectedRevision: number;
    readonly next: SemanticEmbeddingProfile;
  }): Promise<'CREATED' | 'UPDATED' | 'CONFLICT'>;
  updateStatus(input: {
    readonly projectId: string;
    readonly profileId: string;
    readonly profileRevision: number;
    readonly status: SemanticEmbeddingProfileStatus;
    readonly activatedAt?: string;
    readonly updatedBy: string;
    readonly updatedAt: string;
  }): Promise<SemanticEmbeddingProfile | 'NOT_FOUND' | 'CONFLICT'>;
};

export type SemanticEmbeddingProfilePort = {
  getActive(projectId: string): Promise<SemanticEmbeddingProfile | undefined>;
  getCurrent(projectId: string): Promise<SemanticEmbeddingProfile | undefined>;
  getRevision(projectId: string, revision: number): Promise<SemanticEmbeddingProfile | undefined>;
  createProfile(input: {
    readonly projectId: string;
    readonly expectedRevision: number;
    readonly providerId: string;
    readonly embeddingModelId: string;
    readonly credentialId: string;
    readonly credentialRevision: number;
    readonly representationVersion?: string;
    readonly dimension?: number;
    readonly distanceMetric?: SemanticDistanceMetric;
    readonly normalizationPolicy?: SemanticNormalizationPolicy;
    readonly updatedBy: string;
    readonly now?: string;
  }): Promise<SemanticEmbeddingProfile>;
  activateProfile(input: {
    readonly projectId: string;
    readonly profileId: string;
    readonly profileRevision: number;
    readonly updatedBy: string;
    readonly now?: string;
  }): Promise<SemanticEmbeddingProfile>;
};

export type SemanticEmbeddingModelDescriptor = {
  readonly providerId: string;
  readonly modelId: string;
  readonly displayName: string;
  readonly defaultDimension: number;
  readonly supportedDimensions: readonly number[];
  readonly maxBatchSize: number;
  readonly capabilityRevision: string;
  readonly supportedDistanceMetrics: readonly SemanticDistanceMetric[];
  readonly defaultDistanceMetric: SemanticDistanceMetric;
  readonly defaultNormalizationPolicy: SemanticNormalizationPolicy;
};

export type SemanticEmbeddingRegistryPort = {
  listModels(providerId?: string): readonly SemanticEmbeddingModelDescriptor[];
  getModel(providerId: string, modelId: string): SemanticEmbeddingModelDescriptor | undefined;
};

export type SemanticEmbeddingPayload = {
  readonly text: string;
  readonly resourceType?: SemanticResourceType | 'QUERY';
  readonly resourceId?: string;
};

export type SemanticEmbeddingResult = {
  readonly vector: readonly number[];
  readonly dimension: number;
  readonly modelId: string;
  readonly providerId: string;
  readonly tokenCount?: number;
};

export type SemanticEmbeddingExecutionPort = {
  readonly identity: {
    readonly providerId: string;
    readonly embeddingModelId: string;
    readonly dimension: number;
  };
  embed(payload: SemanticEmbeddingPayload): Promise<SemanticEmbeddingResult>;
  embedBatch(
    payloads: readonly SemanticEmbeddingPayload[],
  ): Promise<readonly SemanticEmbeddingResult[]>;
};

export type SemanticEmbeddingExecutionPin = {
  readonly projectId: string;
  readonly providerId: string;
  readonly embeddingModelId: string;
  readonly embeddingProfileId: string;
  readonly embeddingProfileRevision: number;
  readonly credentialId: string;
  readonly credentialRevision: number;
  readonly providerPolicyFingerprint: string;
  readonly representationVersion: string;
  readonly createdAt: string;
};

export type ResolvedSemanticEmbeddingExecution = {
  readonly pin: SemanticEmbeddingExecutionPin;
  readonly profile: SemanticEmbeddingProfile;
  readonly model: SemanticEmbeddingModelDescriptor;
};

export type SemanticEmbeddingResolverPort = {
  resolveExecution(input: {
    readonly projectId: string;
    readonly sensitivity: 'public' | 'internal' | 'private' | 'restricted';
    readonly profileRevision?: number;
    readonly credentialId?: string;
    readonly credentialRevision?: number;
  }): Promise<ResolvedSemanticEmbeddingExecution>;
};

export type SemanticEmbeddingErrorCode =
  | 'CONFIGURATION_REQUIRED'
  | 'CAPABILITY_UNAVAILABLE'
  | 'POLICY_DENIED'
  | 'PROVIDER_FAILURE'
  | 'VALIDATION_FAILURE'
  | 'TIMEOUT'
  | 'CONFLICT'
  | 'INVALID_INPUT';

const mapErrorCode = (code: SemanticEmbeddingErrorCode): ErrorCode => {
  switch (code) {
    case 'CONFIGURATION_REQUIRED':
      return 'CONFIGURATION_REQUIRED';
    case 'CAPABILITY_UNAVAILABLE':
      return 'AI_CAPABILITY_UNAVAILABLE';
    case 'POLICY_DENIED':
      return 'POLICY_DENIED';
    case 'PROVIDER_FAILURE':
      return 'TERMINAL_FAILURE';
    case 'VALIDATION_FAILURE':
      return 'VALIDATION_ERROR';
    case 'TIMEOUT':
      return 'TIMEOUT';
    case 'CONFLICT':
      return 'CONFLICT';
    case 'INVALID_INPUT':
      return 'INVALID_REQUEST';
    default:
      return 'TERMINAL_FAILURE';
  }
};

export class SemanticEmbeddingError extends ShotgunError {
  readonly embeddingErrorCode: SemanticEmbeddingErrorCode;

  constructor(input: {
    readonly code: SemanticEmbeddingErrorCode;
    readonly safeMessage: string;
    readonly operation: string;
    readonly correlationId?: string;
    readonly retryable?: boolean;
    readonly cause?: unknown;
  }) {
    super({
      code: mapErrorCode(input.code),
      safeMessage: input.safeMessage,
      module: 'semantic-embedding',
      operation: input.operation,
      correlationId: input.correlationId,
      retryable: input.retryable ?? false,
      cause: input.cause,
    });
    this.name = 'SemanticEmbeddingError';
    this.embeddingErrorCode = input.code;
  }
}
