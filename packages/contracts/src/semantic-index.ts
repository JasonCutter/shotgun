import type { SemanticDistanceMetric, SemanticNormalizationPolicy } from './semantic-embedding.js';
import type { SemanticResourceType } from './semantic-representation.js';

export const SEMANTIC_PROJECTION_SCHEMA_VERSION = 'semantic-projection:v1' as const;

export type SemanticProjectionGenerationStatus = 'BUILDING' | 'READY' | 'FAILED';

export type SemanticProjectionGeneration = {
  readonly projectId: string;
  readonly generationId: string;
  readonly embeddingProfileId: string;
  readonly embeddingProfileRevision: number;
  readonly providerId: string;
  readonly embeddingModelId: string;
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
  readonly projectId: string;
  readonly generationId: string;
  readonly resourceType: SemanticResourceType;
  readonly resourceId: string;
  readonly representationVersion: string;
  readonly semanticTextDigest: string;
  readonly vector: readonly number[];
  readonly dimension: number;
  readonly accessScope: readonly string[];
  readonly sensitivity: 'public' | 'internal' | 'private' | 'restricted';
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type SemanticCandidateQuery = {
  readonly projectId: string;
  readonly generationId: string;
  readonly queryVector: readonly number[];
  readonly dimension: number;
  readonly accessScopes: readonly string[];
  readonly allowedSensitivities?: readonly ('public' | 'internal' | 'private' | 'restricted')[];
  readonly limit: number;
};

export type SemanticCandidateResult = {
  readonly projectId: string;
  readonly generationId: string;
  readonly resourceType: SemanticResourceType;
  readonly resourceId: string;
  readonly representationVersion: string;
  readonly semanticTextDigest: string;
  readonly distance: number;
  readonly dimension: number;
  readonly accessScope: readonly string[];
  readonly sensitivity: 'public' | 'internal' | 'private' | 'restricted';
  readonly createdAt: string;
  readonly updatedAt: string;
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
