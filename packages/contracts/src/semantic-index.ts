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

export const validateFiniteVector = (vector: readonly number[], operation: string): void => {
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new SemanticEmbeddingError({
      code: 'VALIDATION_FAILURE',
      safeMessage: 'Vector must be a non-empty array of numbers.',
      operation,
    });
  }
  for (let i = 0; i < vector.length; i++) {
    const val = vector[i];
    if (typeof val !== 'number' || !Number.isFinite(val)) {
      throw new SemanticEmbeddingError({
        code: 'VALIDATION_FAILURE',
        safeMessage: `Vector element at index ${i} is not a finite number (received: ${val}).`,
        operation,
      });
    }
  }
};

export const validateUnitLength = (
  vector: readonly number[],
  operation: string,
  tolerance = 1e-3,
): void => {
  validateFiniteVector(vector, operation);
  let normSq = 0;
  for (let i = 0; i < vector.length; i++) {
    normSq += vector[i]! * vector[i]!;
  }
  const norm = Math.sqrt(normSq);
  if (!Number.isFinite(norm) || Math.abs(norm - 1.0) > tolerance) {
    throw new SemanticEmbeddingError({
      code: 'VALIDATION_FAILURE',
      safeMessage: `Vector norm ${Number.isFinite(norm) ? norm.toFixed(6) : norm} does not satisfy unit_length normalization policy (tolerance: ${tolerance}).`,
      operation,
    });
  }
};

export const validatePersistedItem = (item: SemanticProjectionItem, operation: string): void => {
  if (!item.semanticItemId || item.semanticItemId.trim().length === 0) {
    throw new SemanticEmbeddingError({
      code: 'VALIDATION_FAILURE',
      safeMessage: 'Item semanticItemId must be a non-empty string.',
      operation,
    });
  }
  if (!Array.isArray(item.accessScope) || item.accessScope.length === 0) {
    throw new SemanticEmbeddingError({
      code: 'POLICY_DENIED',
      safeMessage: 'Item accessScope must be a non-empty array of scope strings.',
      operation,
    });
  }
  for (const scope of item.accessScope) {
    if (typeof scope !== 'string' || scope.trim().length === 0) {
      throw new SemanticEmbeddingError({
        code: 'POLICY_DENIED',
        safeMessage: 'All accessScope entries must be non-empty strings.',
        operation,
      });
    }
  }
  const validSensitivities = new Set(['public', 'internal', 'private', 'restricted']);
  if (!validSensitivities.has(item.sensitivity)) {
    throw new SemanticEmbeddingError({
      code: 'VALIDATION_FAILURE',
      safeMessage: `Invalid sensitivity level '${item.sensitivity}'.`,
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
  for (const scope of query.accessScopes) {
    if (typeof scope !== 'string' || scope.trim().length === 0) {
      throw new SemanticEmbeddingError({
        code: 'POLICY_DENIED',
        safeMessage: 'All accessScope query entries must be non-empty strings.',
        operation,
      });
    }
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

export type SemanticActivePointer = {
  readonly projectId: string;
  readonly activeGenerationId: string;
  readonly lastKnownGoodGenerationId?: string;
  readonly pointerRevision: number;
  readonly updatedAt: string;
};

export type SwitchActiveGenerationInput = {
  readonly projectId: string;
  readonly targetGenerationId: string;
  readonly expectedCurrentActiveGenerationId?: string;
  readonly expectedPointerRevision?: number;
};

export type RollbackActiveGenerationInput = {
  readonly projectId: string;
  readonly expectedCurrentActiveGenerationId?: string;
};

export type PruneGenerationsInput = {
  readonly projectId: string;
  readonly retainMaxCount?: number;
};

export type PruneGenerationsResult = {
  readonly projectId: string;
  readonly prunedGenerationIds: readonly string[];
  readonly retainedGenerationIds: readonly string[];
};

export type SemanticLifecycleRepositoryPort = {
  getActivePointer(projectId: string): Promise<SemanticActivePointer | undefined>;
  switchActiveGeneration(input: SwitchActiveGenerationInput): Promise<SemanticActivePointer>;
  rollbackActiveGeneration(input: RollbackActiveGenerationInput): Promise<SemanticActivePointer>;
  updateGenerationStatus(
    projectId: string,
    generationId: string,
    status: SemanticProjectionGenerationStatus,
  ): Promise<void>;
  pruneGenerations(input: PruneGenerationsInput): Promise<PruneGenerationsResult>;
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
  updateGenerationStatus(
    projectId: string,
    generationId: string,
    status: SemanticProjectionGenerationStatus,
  ): Promise<void>;

  // Lifecycle pointer management
  getActivePointer?(projectId: string): Promise<SemanticActivePointer | undefined>;
  switchActiveGeneration?(input: SwitchActiveGenerationInput): Promise<SemanticActivePointer>;
  rollbackActiveGeneration?(input: RollbackActiveGenerationInput): Promise<SemanticActivePointer>;
  pruneGenerations?(input: PruneGenerationsInput): Promise<PruneGenerationsResult>;

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
