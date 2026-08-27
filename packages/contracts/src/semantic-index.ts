import {
  type SemanticDistanceMetric,
  type SemanticNormalizationPolicy,
  SemanticEmbeddingError,
} from './semantic-embedding.js';
import type {
  SemanticCorpusAuthority,
  SemanticCorpusResourceProvenance,
} from './semantic-corpus.js';
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
  /** R3 execution identity. Legacy callers may omit these fields. */
  readonly providerId?: string;
  readonly embeddingModelId?: string;
  readonly normalizationPolicy?: SemanticNormalizationPolicy;
  /** R3 membership authority/provenance. Legacy index rows may omit these fields. */
  readonly authority?: SemanticCorpusAuthority;
  readonly provenance?: SemanticCorpusResourceProvenance;
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
  /** R3 membership authority/provenance. Legacy query rows may omit these. */
  readonly authority?: SemanticCorpusAuthority;
  readonly provenance?: SemanticCorpusResourceProvenance;
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

export type SemanticGenerationMembershipSummary = {
  readonly projectId: string;
  readonly generationId: string;
  readonly itemCount: number;
  readonly membershipDigest: string;
};

export type SemanticGenerationPointer = {
  readonly projectId: string;
  readonly activeGenerationId: string;
  readonly pointerRevision: number;
  readonly sourceProjectionDigest: string;
  readonly canonicalBaseVersion: number;
  readonly updatedAt: string;
};

export type SemanticGenerationPointerExpectation =
  | { readonly kind: 'NONE' }
  | {
      readonly kind: 'EXISTING';
      readonly activeGenerationId: string;
      readonly pointerRevision: number;
    };

export type SemanticGenerationActivationResult =
  | { readonly status: 'ACTIVATED'; readonly pointer: SemanticGenerationPointer }
  | { readonly status: 'CONFLICT'; readonly pointer?: SemanticGenerationPointer };

export type SemanticGenerationLifecycleRepositoryPort = {
  transitionGenerationStatus(input: {
    readonly projectId: string;
    readonly generationId: string;
    readonly expectedStatus: SemanticProjectionGenerationStatus;
    readonly nextStatus: Exclude<SemanticProjectionGenerationStatus, 'BUILDING'>;
  }): Promise<'UPDATED' | 'NOT_FOUND' | 'CONFLICT'>;
  readGenerationMembershipSummary(
    projectId: string,
    generationId: string,
  ): Promise<SemanticGenerationMembershipSummary | undefined>;
  getActiveGenerationPointer(projectId: string): Promise<SemanticGenerationPointer | undefined>;
  activateGeneration(input: {
    readonly projectId: string;
    readonly generationId: string;
    readonly expectedPointer: SemanticGenerationPointerExpectation;
    readonly sourceProjectionDigest: string;
    readonly canonicalBaseVersion: number;
    readonly updatedAt: string;
  }): Promise<SemanticGenerationActivationResult>;
  /** R3 Product corpus write boundary; FACT is rejected by implementations. */
  upsertGenerationItems(items: readonly SemanticProjectionItem[]): Promise<void>;
};

export const semanticProductResourceTypes = [
  'CLAIM',
  'ENTITY',
  'RELATION',
  'EVENT',
  'DECISION',
] as const;

export const isSemanticGenerationResourceType = (
  value: SemanticResourceType,
): value is Exclude<SemanticResourceType, 'FACT'> =>
  (semanticProductResourceTypes as readonly string[]).includes(value);
