import {
  type SemanticDistanceMetric,
  type SemanticNormalizationPolicy,
  SemanticEmbeddingError,
} from './semantic-embedding.js';
import type { SemanticResourceType } from './semantic-representation.js';

export const SEMANTIC_PROJECTION_SCHEMA_VERSION = 'semantic-projection:v1' as const;
export const SEMANTIC_SEARCH_MAX_LIMIT = 100 as const;

export type SemanticProjectionGenerationStatus = 'BUILDING' | 'READY' | 'FAILED';

export type SemanticProjectionGeneration = {
  readonly projectId: string;
  readonly generationId: string;
  readonly sourceProjectionDigest: string;
  readonly canonicalBaseVersion: number;
  readonly credentialId: string;
  readonly credentialRevision: number;
  readonly providerPolicyFingerprint: string;
  readonly providerId: string;
  readonly embeddingModelId: string;
  readonly embeddingProfileId: string;
  readonly embeddingProfileRevision: number;
  readonly providerRegistryRevision: string;
  readonly capabilityCatalogRevision: string;
  readonly representationVersion: string;
  readonly dimension: number;
  readonly distanceMetric: SemanticDistanceMetric;
  readonly normalizationPolicy: SemanticNormalizationPolicy;
  readonly buildStatus: SemanticProjectionGenerationStatus;
  readonly createdAt: string;
};

export type SemanticProjectionItem = {
  readonly semanticItemId: string;
  readonly projectId: string;
  readonly generationId: string;
  readonly resourceType: SemanticResourceType;
  readonly resourceId: string;
  readonly sourceProjectionDigest: string;
  readonly canonicalVersion: number;
  readonly semanticTextDigest: string;
  readonly embeddingProfileId: string;
  readonly embeddingProfileRevision: number;
  readonly representationVersion: string;
  readonly vector: readonly number[];
  readonly dimension: number;
  readonly evidenceIds: readonly string[];
  readonly accessScope: readonly string[];
  readonly sensitivity: 'public' | 'internal' | 'private' | 'restricted';
  readonly indexedAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type SemanticCandidateQuery = {
  readonly projectId: string;
  readonly generationId: string;
  readonly queryVector: readonly number[];
  readonly dimension: number;
  readonly accessScopes: readonly string[];
  readonly allowedSensitivities: readonly ('public' | 'internal' | 'private' | 'restricted')[];
  readonly limit: number;
};

export type SemanticCandidateResult = {
  readonly semanticItemId: string;
  readonly projectId: string;
  readonly generationId: string;
  readonly resourceType: SemanticResourceType;
  readonly resourceId: string;
  readonly sourceProjectionDigest: string;
  readonly canonicalVersion: number;
  readonly semanticTextDigest: string;
  readonly embeddingProfileId: string;
  readonly embeddingProfileRevision: number;
  readonly representationVersion: string;
  readonly distance: number;
  readonly dimension: number;
  readonly evidenceIds: readonly string[];
  readonly accessScope: readonly string[];
  readonly sensitivity: 'public' | 'internal' | 'private' | 'restricted';
  readonly indexedAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export const validateUnitLength = (
  vector: readonly number[],
  operation: string,
  tolerance = 1e-3,
): void => {
  let normSq = 0;
  for (let i = 0; i < vector.length; i++) {
    normSq += vector[i]! * vector[i]!;
  }
  const norm = Math.sqrt(normSq);
  if (Math.abs(norm - 1.0) > tolerance) {
    throw new SemanticEmbeddingError({
      code: 'VALIDATION_FAILURE',
      safeMessage: `Vector norm ${norm.toFixed(6)} does not satisfy unit_length normalization policy (tolerance: ${tolerance}).`,
      operation,
    });
  }
};

export const validateSecurityInput = (query: SemanticCandidateQuery, operation: string): void => {
  const projectId = query.projectId?.trim();
  const generationId = query.generationId?.trim();
  if (!projectId || !generationId) {
    throw new SemanticEmbeddingError({
      code: 'INVALID_INPUT',
      safeMessage: 'Project ID and generation ID are required.',
      operation,
    });
  }
  if (!Array.isArray(query.accessScopes) || query.accessScopes.length === 0) {
    throw new SemanticEmbeddingError({
      code: 'POLICY_DENIED',
      safeMessage: 'Access scopes must be a non-empty array for authorized semantic retrieval.',
      operation,
    });
  }
  if (!Array.isArray(query.allowedSensitivities) || query.allowedSensitivities.length === 0) {
    throw new SemanticEmbeddingError({
      code: 'POLICY_DENIED',
      safeMessage: 'Allowed sensitivities must be explicitly provided and non-empty.',
      operation,
    });
  }
  const validSensitivities = new Set(['public', 'internal', 'private', 'restricted']);
  for (const s of query.allowedSensitivities) {
    if (!validSensitivities.has(s)) {
      throw new SemanticEmbeddingError({
        code: 'POLICY_DENIED',
        safeMessage: `Invalid sensitivity level '${s}'.`,
        operation,
      });
    }
  }
  if (
    !Number.isInteger(query.limit) ||
    query.limit <= 0 ||
    query.limit > SEMANTIC_SEARCH_MAX_LIMIT
  ) {
    throw new SemanticEmbeddingError({
      code: 'INVALID_INPUT',
      safeMessage: `Limit must be a positive integer <= ${SEMANTIC_SEARCH_MAX_LIMIT}. Received: ${query.limit}`,
      operation,
    });
  }
};

export type SemanticIndexRepositoryPort = {
  // Generation persistence
  saveGeneration(
    generation: SemanticProjectionGeneration,
  ): Promise<'CREATED' | 'EXISTS' | 'CONFLICT'>;
  getGeneration(
    projectId: string,
    generationId: string,
  ): Promise<SemanticProjectionGeneration | undefined>;
  listGenerations(projectId: string): Promise<readonly SemanticProjectionGeneration[]>;
  deleteGeneration(projectId: string, generationId: string): Promise<boolean>;

  // Item persistence
  upsertItem(item: SemanticProjectionItem): Promise<void>;
  upsertItems(items: readonly SemanticProjectionItem[]): Promise<void>;
  getItem(
    projectId: string,
    generationId: string,
    resourceType: SemanticResourceType,
    resourceId: string,
  ): Promise<SemanticProjectionItem | undefined>;
  getItemBySemanticId(
    projectId: string,
    generationId: string,
    semanticItemId: string,
  ): Promise<SemanticProjectionItem | undefined>;
  deleteItem(
    projectId: string,
    generationId: string,
    resourceType: SemanticResourceType,
    resourceId: string,
  ): Promise<boolean>;
  deleteItemsByGeneration(projectId: string, generationId: string): Promise<number>;

  // Security-before-Top-K Nearest Neighbor search
  findNearestNeighbors(query: SemanticCandidateQuery): Promise<readonly SemanticCandidateResult[]>;
};
