import type { Pool, QueryResultRow } from 'pg';

import {
  type SemanticCandidateQuery,
  type SemanticCandidateResult,
  type SemanticDistanceMetric,
  type SemanticIndexRepositoryPort,
  type SemanticNormalizationPolicy,
  type SemanticProjectionGeneration,
  type SemanticProjectionGenerationStatus,
  type SemanticProjectionItem,
  type SemanticResourceType,
  SemanticEmbeddingError,
} from '../../../packages/contracts/src/index.js';

type GenerationRow = QueryResultRow & {
  readonly project_id: string;
  readonly generation_id: string;
  readonly embedding_profile_id: string;
  readonly embedding_profile_revision: number;
  readonly provider_id: string;
  readonly embedding_model_id: string;
  readonly provider_registry_revision: string;
  readonly capability_catalog_revision: string;
  readonly representation_version: string;
  readonly dimension: number;
  readonly distance_metric: SemanticDistanceMetric;
  readonly normalization_policy: SemanticNormalizationPolicy;
  readonly build_status: SemanticProjectionGenerationStatus;
  readonly created_at: Date;
};

type ItemRow = QueryResultRow & {
  readonly project_id: string;
  readonly generation_id: string;
  readonly resource_type: SemanticResourceType;
  readonly resource_id: string;
  readonly representation_version: string;
  readonly semantic_text_digest: string;
  readonly vector_text: string;
  readonly dimension: number;
  readonly access_scope: string[];
  readonly sensitivity: 'public' | 'internal' | 'private' | 'restricted';
  readonly created_at: Date;
  readonly updated_at: Date;
};

type CandidateRow = QueryResultRow & {
  readonly project_id: string;
  readonly generation_id: string;
  readonly resource_type: SemanticResourceType;
  readonly resource_id: string;
  readonly representation_version: string;
  readonly semantic_text_digest: string;
  readonly dimension: number;
  readonly access_scope: string[];
  readonly sensitivity: 'public' | 'internal' | 'private' | 'restricted';
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly distance: number;
};

const mapGeneration = (row: GenerationRow): SemanticProjectionGeneration => ({
  projectId: row.project_id,
  generationId: row.generation_id,
  embeddingProfileId: row.embedding_profile_id,
  embeddingProfileRevision: row.embedding_profile_revision,
  providerId: row.provider_id,
  embeddingModelId: row.embedding_model_id,
  providerRegistryRevision: row.provider_registry_revision,
  capabilityCatalogRevision: row.capability_catalog_revision,
  representationVersion: row.representation_version,
  dimension: row.dimension,
  distanceMetric: row.distance_metric,
  normalizationPolicy: row.normalization_policy,
  buildStatus: row.build_status,
  createdAt: row.created_at.toISOString(),
});

const mapItem = (row: ItemRow): SemanticProjectionItem => ({
  projectId: row.project_id,
  generationId: row.generation_id,
  resourceType: row.resource_type,
  resourceId: row.resource_id,
  representationVersion: row.representation_version,
  semanticTextDigest: row.semantic_text_digest,
  vector: JSON.parse(row.vector_text) as number[],
  dimension: row.dimension,
  accessScope: row.access_scope,
  sensitivity: row.sensitivity,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

const defaultAllowedSensitivities = ['public', 'internal', 'private', 'restricted'] as const;

export class PostgresSemanticIndexRepository implements SemanticIndexRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async saveGeneration(
    generation: SemanticProjectionGeneration,
  ): Promise<'CREATED' | 'EXISTS' | 'CONFLICT'> {
    const result = await this.pool.query<GenerationRow>(
      `INSERT INTO projection.semantic_generations (
         project_id, generation_id, embedding_profile_id, embedding_profile_revision,
         provider_id, embedding_model_id, provider_registry_revision, capability_catalog_revision,
         representation_version, dimension, distance_metric, normalization_policy,
         build_status, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (project_id, generation_id) DO NOTHING
       RETURNING *`,
      [
        generation.projectId,
        generation.generationId,
        generation.embeddingProfileId,
        generation.embeddingProfileRevision,
        generation.providerId,
        generation.embeddingModelId,
        generation.providerRegistryRevision,
        generation.capabilityCatalogRevision,
        generation.representationVersion,
        generation.dimension,
        generation.distanceMetric,
        generation.normalizationPolicy,
        generation.buildStatus,
        generation.createdAt,
      ],
    );

    if ((result.rowCount ?? 0) > 0) {
      return 'CREATED';
    }

    const existing = await this.getGeneration(generation.projectId, generation.generationId);
    if (!existing) {
      return 'CONFLICT';
    }

    if (
      existing.embeddingProfileId === generation.embeddingProfileId &&
      existing.embeddingProfileRevision === generation.embeddingProfileRevision &&
      existing.providerId === generation.providerId &&
      existing.embeddingModelId === generation.embeddingModelId &&
      existing.providerRegistryRevision === generation.providerRegistryRevision &&
      existing.capabilityCatalogRevision === generation.capabilityCatalogRevision &&
      existing.representationVersion === generation.representationVersion &&
      existing.dimension === generation.dimension &&
      existing.distanceMetric === generation.distanceMetric &&
      existing.normalizationPolicy === generation.normalizationPolicy
    ) {
      return 'EXISTS';
    }

    return 'CONFLICT';
  }

  async getGeneration(
    projectId: string,
    generationId: string,
  ): Promise<SemanticProjectionGeneration | undefined> {
    const result = await this.pool.query<GenerationRow>(
      `SELECT project_id, generation_id, embedding_profile_id, embedding_profile_revision,
              provider_id, embedding_model_id, provider_registry_revision, capability_catalog_revision,
              representation_version, dimension, distance_metric, normalization_policy,
              build_status, created_at
       FROM projection.semantic_generations
       WHERE project_id = $1 AND generation_id = $2`,
      [projectId, generationId],
    );

    return result.rows[0] ? mapGeneration(result.rows[0]) : undefined;
  }

  async listGenerations(projectId: string): Promise<readonly SemanticProjectionGeneration[]> {
    const result = await this.pool.query<GenerationRow>(
      `SELECT project_id, generation_id, embedding_profile_id, embedding_profile_revision,
              provider_id, embedding_model_id, provider_registry_revision, capability_catalog_revision,
              representation_version, dimension, distance_metric, normalization_policy,
              build_status, created_at
       FROM projection.semantic_generations
       WHERE project_id = $1
       ORDER BY created_at ASC, generation_id ASC`,
      [projectId],
    );

    return result.rows.map(mapGeneration);
  }

  async deleteGeneration(projectId: string, generationId: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM projection.semantic_generations
       WHERE project_id = $1 AND generation_id = $2`,
      [projectId, generationId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async upsertItem(item: SemanticProjectionItem): Promise<void> {
    const gen = await this.getGeneration(item.projectId, item.generationId);
    if (!gen) {
      throw new SemanticEmbeddingError({
        code: 'CONFIGURATION_REQUIRED',
        safeMessage: 'Referenced projection generation does not exist.',
        operation: 'upsert-item',
      });
    }
    if (item.dimension !== gen.dimension || item.vector.length !== gen.dimension) {
      throw new SemanticEmbeddingError({
        code: 'VALIDATION_FAILURE',
        safeMessage: `Item dimension ${item.dimension} (vector length ${item.vector.length}) does not match generation dimension ${gen.dimension}.`,
        operation: 'upsert-item',
      });
    }

    const vectorString = JSON.stringify(item.vector);

    await this.pool.query(
      `INSERT INTO projection.semantic_items (
         project_id, generation_id, resource_type, resource_id,
         representation_version, semantic_text_digest, vector, dimension,
         access_scope, sensitivity, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4,
         $5, $6, $7::vector, $8,
         $9::text[], $10, $11, $12
       )
       ON CONFLICT (project_id, generation_id, resource_type, resource_id)
       DO UPDATE SET
         representation_version = EXCLUDED.representation_version,
         semantic_text_digest = EXCLUDED.semantic_text_digest,
         vector = EXCLUDED.vector,
         dimension = EXCLUDED.dimension,
         access_scope = EXCLUDED.access_scope,
         sensitivity = EXCLUDED.sensitivity,
         updated_at = EXCLUDED.updated_at`,
      [
        item.projectId,
        item.generationId,
        item.resourceType,
        item.resourceId,
        item.representationVersion,
        item.semanticTextDigest,
        vectorString,
        item.dimension,
        item.accessScope,
        item.sensitivity,
        item.createdAt,
        item.updatedAt,
      ],
    );
  }

  async upsertItems(items: readonly SemanticProjectionItem[]): Promise<void> {
    if (items.length === 0) return;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const item of items) {
        const gen = await this.getGeneration(item.projectId, item.generationId);
        if (!gen) {
          throw new SemanticEmbeddingError({
            code: 'CONFIGURATION_REQUIRED',
            safeMessage: 'Referenced projection generation does not exist.',
            operation: 'upsert-items',
          });
        }
        if (item.dimension !== gen.dimension || item.vector.length !== gen.dimension) {
          throw new SemanticEmbeddingError({
            code: 'VALIDATION_FAILURE',
            safeMessage: `Item dimension ${item.dimension} does not match generation dimension ${gen.dimension}.`,
            operation: 'upsert-items',
          });
        }

        const vectorString = JSON.stringify(item.vector);
        await client.query(
          `INSERT INTO projection.semantic_items (
             project_id, generation_id, resource_type, resource_id,
             representation_version, semantic_text_digest, vector, dimension,
             access_scope, sensitivity, created_at, updated_at
           ) VALUES (
             $1, $2, $3, $4,
             $5, $6, $7::vector, $8,
             $9::text[], $10, $11, $12
           )
           ON CONFLICT (project_id, generation_id, resource_type, resource_id)
           DO UPDATE SET
             representation_version = EXCLUDED.representation_version,
             semantic_text_digest = EXCLUDED.semantic_text_digest,
             vector = EXCLUDED.vector,
             dimension = EXCLUDED.dimension,
             access_scope = EXCLUDED.access_scope,
             sensitivity = EXCLUDED.sensitivity,
             updated_at = EXCLUDED.updated_at`,
          [
            item.projectId,
            item.generationId,
            item.resourceType,
            item.resourceId,
            item.representationVersion,
            item.semanticTextDigest,
            vectorString,
            item.dimension,
            item.accessScope,
            item.sensitivity,
            item.createdAt,
            item.updatedAt,
          ],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getItem(
    projectId: string,
    generationId: string,
    resourceType: SemanticResourceType,
    resourceId: string,
  ): Promise<SemanticProjectionItem | undefined> {
    const result = await this.pool.query<ItemRow>(
      `SELECT project_id, generation_id, resource_type, resource_id,
              representation_version, semantic_text_digest,
              vector::text AS vector_text, dimension, access_scope, sensitivity,
              created_at, updated_at
       FROM projection.semantic_items
       WHERE project_id = $1 AND generation_id = $2 AND resource_type = $3 AND resource_id = $4`,
      [projectId, generationId, resourceType, resourceId],
    );

    return result.rows[0] ? mapItem(result.rows[0]) : undefined;
  }

  async deleteItem(
    projectId: string,
    generationId: string,
    resourceType: SemanticResourceType,
    resourceId: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM projection.semantic_items
       WHERE project_id = $1 AND generation_id = $2 AND resource_type = $3 AND resource_id = $4`,
      [projectId, generationId, resourceType, resourceId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async deleteItemsByGeneration(projectId: string, generationId: string): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM projection.semantic_items
       WHERE project_id = $1 AND generation_id = $2`,
      [projectId, generationId],
    );
    return result.rowCount ?? 0;
  }

  async findNearestNeighbors(
    query: SemanticCandidateQuery,
  ): Promise<readonly SemanticCandidateResult[]> {
    const projectId = query.projectId.trim();
    const generationId = query.generationId.trim();
    if (!projectId || !generationId) {
      throw new SemanticEmbeddingError({
        code: 'INVALID_INPUT',
        safeMessage: 'Project ID and generation ID are required.',
        operation: 'find-nearest-neighbors',
      });
    }

    const gen = await this.getGeneration(projectId, generationId);
    if (!gen) {
      throw new SemanticEmbeddingError({
        code: 'CONFIGURATION_REQUIRED',
        safeMessage: 'Requested projection generation was not found.',
        operation: 'find-nearest-neighbors',
      });
    }

    if (query.dimension !== gen.dimension || query.queryVector.length !== gen.dimension) {
      throw new SemanticEmbeddingError({
        code: 'VALIDATION_FAILURE',
        safeMessage: `Query vector dimension ${query.queryVector.length} does not match generation dimension ${gen.dimension}.`,
        operation: 'find-nearest-neighbors',
      });
    }

    let distanceOp: string;
    switch (gen.distanceMetric) {
      case 'cosine':
        distanceOp = '<=>';
        break;
      case 'dot_product':
        distanceOp = '<#>';
        break;
      case 'euclidean':
        distanceOp = '<->';
        break;
      default:
        throw new SemanticEmbeddingError({
          code: 'VALIDATION_FAILURE',
          safeMessage: `Unsupported distance metric '${gen.distanceMetric}'.`,
          operation: 'find-nearest-neighbors',
        });
    }

    const allowedSensitivities = query.allowedSensitivities ?? defaultAllowedSensitivities;
    const vectorString = JSON.stringify(query.queryVector);

    // SECURITY BEFORE TOP-K:
    // Candidate filtering (project_id, generation_id, dimension, access_scope, sensitivity)
    // is applied strictly in the WHERE clause BEFORE ORDER BY distance and LIMIT.
    const result = await this.pool.query<CandidateRow>(
      `SELECT
         project_id,
         generation_id,
         resource_type,
         resource_id,
         representation_version,
         semantic_text_digest,
         dimension,
         access_scope,
         sensitivity,
         created_at,
         updated_at,
         (vector ${distanceOp} $3::vector)::double precision AS distance
       FROM projection.semantic_items
       WHERE project_id = $1
         AND generation_id = $2
         AND dimension = $4
         AND access_scope <@ $5::text[]
         AND sensitivity = ANY($6::text[])
       ORDER BY distance ASC, resource_type ASC, resource_id ASC
       LIMIT $7`,
      [
        projectId,
        generationId,
        vectorString,
        gen.dimension,
        query.accessScopes,
        allowedSensitivities,
        Math.max(0, query.limit),
      ],
    );

    return result.rows.map((row) => ({
      projectId: row.project_id,
      generationId: row.generation_id,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      representationVersion: row.representation_version,
      semanticTextDigest: row.semantic_text_digest,
      distance: row.distance,
      dimension: row.dimension,
      accessScope: row.access_scope,
      sensitivity: row.sensitivity,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    }));
  }
}
