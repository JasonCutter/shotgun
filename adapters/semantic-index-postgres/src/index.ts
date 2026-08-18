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
  validateFiniteVector,
  validatePersistedItem,
  validateSecurityInput,
  validateUnitLength,
} from '../../../packages/contracts/src/index.js';

type GenerationRow = QueryResultRow & {
  readonly project_id: string;
  readonly generation_id: string;
  readonly source_projection_digest: string;
  readonly canonical_base_version: number;
  readonly credential_id: string;
  readonly credential_revision: number;
  readonly provider_policy_fingerprint: string;
  readonly provider_id: string;
  readonly embedding_model_id: string;
  readonly embedding_profile_id: string;
  readonly embedding_profile_revision: number;
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
  readonly semantic_item_id: string;
  readonly resource_type: SemanticResourceType;
  readonly resource_id: string;
  readonly source_projection_digest: string;
  readonly canonical_version: number;
  readonly semantic_text_digest: string;
  readonly embedding_profile_id: string;
  readonly embedding_profile_revision: number;
  readonly representation_version: string;
  readonly vector_text: string;
  readonly dimension: number;
  readonly evidence_ids: string[];
  readonly access_scope: string[];
  readonly sensitivity: 'public' | 'internal' | 'private' | 'restricted';
  readonly indexed_at: Date;
  readonly created_at: Date;
  readonly updated_at: Date;
};

type CandidateRow = QueryResultRow & {
  readonly project_id: string;
  readonly generation_id: string;
  readonly semantic_item_id: string;
  readonly resource_type: SemanticResourceType;
  readonly resource_id: string;
  readonly source_projection_digest: string;
  readonly canonical_version: number;
  readonly semantic_text_digest: string;
  readonly embedding_profile_id: string;
  readonly embedding_profile_revision: number;
  readonly representation_version: string;
  readonly dimension: number;
  readonly evidence_ids: string[];
  readonly access_scope: string[];
  readonly sensitivity: 'public' | 'internal' | 'private' | 'restricted';
  readonly indexed_at: Date;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly distance: number;
};

const mapGeneration = (row: GenerationRow): SemanticProjectionGeneration => ({
  projectId: row.project_id,
  generationId: row.generation_id,
  sourceProjectionDigest: row.source_projection_digest,
  canonicalBaseVersion: row.canonical_base_version,
  credentialId: row.credential_id,
  credentialRevision: row.credential_revision,
  providerPolicyFingerprint: row.provider_policy_fingerprint,
  providerId: row.provider_id,
  embeddingModelId: row.embedding_model_id,
  embeddingProfileId: row.embedding_profile_id,
  embeddingProfileRevision: row.embedding_profile_revision,
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
  semanticItemId: row.semantic_item_id,
  projectId: row.project_id,
  generationId: row.generation_id,
  resourceType: row.resource_type,
  resourceId: row.resource_id,
  sourceProjectionDigest: row.source_projection_digest,
  canonicalVersion: row.canonical_version,
  semanticTextDigest: row.semantic_text_digest,
  embeddingProfileId: row.embedding_profile_id,
  embeddingProfileRevision: row.embedding_profile_revision,
  representationVersion: row.representation_version,
  vector: JSON.parse(row.vector_text) as number[],
  dimension: row.dimension,
  evidenceIds: row.evidence_ids,
  accessScope: row.access_scope,
  sensitivity: row.sensitivity,
  indexedAt: row.indexed_at.toISOString(),
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

const handlePostgresError = (error: unknown, operation: string): never => {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === '23505' &&
    'constraint' in error &&
    (error as { constraint?: string }).constraint === 'unq_semantic_item_id'
  ) {
    throw new SemanticEmbeddingError({
      code: 'CONFLICT',
      safeMessage: 'Semantic item ID already exists on a different resource in this generation.',
      operation,
      cause: error,
    });
  }
  throw error;
};

export class PostgresSemanticIndexRepository implements SemanticIndexRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async saveGeneration(
    generation: SemanticProjectionGeneration,
  ): Promise<'CREATED' | 'EXISTS' | 'CONFLICT'> {
    const result = await this.pool.query<GenerationRow>(
      `INSERT INTO projection.semantic_generations (
         project_id, generation_id, source_projection_digest, canonical_base_version,
         credential_id, credential_revision, provider_policy_fingerprint,
         provider_id, embedding_model_id, embedding_profile_id, embedding_profile_revision,
         provider_registry_revision, capability_catalog_revision, representation_version,
         dimension, distance_metric, normalization_policy,
         build_status, created_at
       ) VALUES (
         $1, $2, $3, $4,
         $5, $6, $7,
         $8, $9, $10, $11,
         $12, $13, $14,
         $15, $16, $17,
         $18, $19
       )
       ON CONFLICT (project_id, generation_id) DO NOTHING
       RETURNING *`,
      [
        generation.projectId,
        generation.generationId,
        generation.sourceProjectionDigest,
        generation.canonicalBaseVersion,
        generation.credentialId,
        generation.credentialRevision,
        generation.providerPolicyFingerprint,
        generation.providerId,
        generation.embeddingModelId,
        generation.embeddingProfileId,
        generation.embeddingProfileRevision,
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
      existing.sourceProjectionDigest === generation.sourceProjectionDigest &&
      existing.canonicalBaseVersion === generation.canonicalBaseVersion &&
      existing.credentialId === generation.credentialId &&
      existing.credentialRevision === generation.credentialRevision &&
      existing.providerPolicyFingerprint === generation.providerPolicyFingerprint &&
      existing.providerId === generation.providerId &&
      existing.embeddingModelId === generation.embeddingModelId &&
      existing.embeddingProfileId === generation.embeddingProfileId &&
      existing.embeddingProfileRevision === generation.embeddingProfileRevision &&
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
      `SELECT project_id, generation_id, source_projection_digest, canonical_base_version,
              credential_id, credential_revision, provider_policy_fingerprint,
              provider_id, embedding_model_id, embedding_profile_id, embedding_profile_revision,
              provider_registry_revision, capability_catalog_revision,
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
      `SELECT project_id, generation_id, source_projection_digest, canonical_base_version,
              credential_id, credential_revision, provider_policy_fingerprint,
              provider_id, embedding_model_id, embedding_profile_id, embedding_profile_revision,
              provider_registry_revision, capability_catalog_revision,
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
    validatePersistedItem(item, 'upsert-item');
    if (
      item.dimension !== gen.dimension ||
      item.embeddingProfileId !== gen.embeddingProfileId ||
      item.embeddingProfileRevision !== gen.embeddingProfileRevision ||
      item.representationVersion !== gen.representationVersion
    ) {
      throw new SemanticEmbeddingError({
        code: 'VALIDATION_FAILURE',
        safeMessage: `Item metadata does not match referenced generation.`,
        operation: 'upsert-item',
      });
    }
    if (item.vector.length !== gen.dimension) {
      throw new SemanticEmbeddingError({
        code: 'VALIDATION_FAILURE',
        safeMessage: `Item dimension ${item.dimension} (vector length ${item.vector.length}) does not match generation dimension ${gen.dimension}.`,
        operation: 'upsert-item',
      });
    }
    if (gen.normalizationPolicy === 'unit_length') {
      validateUnitLength(item.vector, 'upsert-item');
    } else {
      validateFiniteVector(item.vector, 'upsert-item');
    }

    const vectorString = JSON.stringify(item.vector);

    try {
      await this.pool.query(
        `INSERT INTO projection.semantic_items (
           project_id, generation_id, semantic_item_id, resource_type, resource_id,
           source_projection_digest, canonical_version, semantic_text_digest,
           embedding_profile_id, embedding_profile_revision, representation_version,
           vector, dimension, evidence_ids, access_scope, sensitivity,
           indexed_at, created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5,
           $6, $7, $8,
           $9, $10, $11,
           $12::vector, $13, $14::text[], $15::text[], $16,
           $17, $18, $19
         )
         ON CONFLICT (project_id, generation_id, resource_type, resource_id)
         DO UPDATE SET
           semantic_item_id = EXCLUDED.semantic_item_id,
           source_projection_digest = EXCLUDED.source_projection_digest,
           canonical_version = EXCLUDED.canonical_version,
           semantic_text_digest = EXCLUDED.semantic_text_digest,
           embedding_profile_id = EXCLUDED.embedding_profile_id,
           embedding_profile_revision = EXCLUDED.embedding_profile_revision,
           representation_version = EXCLUDED.representation_version,
           vector = EXCLUDED.vector,
           dimension = EXCLUDED.dimension,
           evidence_ids = EXCLUDED.evidence_ids,
           access_scope = EXCLUDED.access_scope,
           sensitivity = EXCLUDED.sensitivity,
           indexed_at = EXCLUDED.indexed_at,
           updated_at = EXCLUDED.updated_at`,
        [
          item.projectId,
          item.generationId,
          item.semanticItemId,
          item.resourceType,
          item.resourceId,
          item.sourceProjectionDigest,
          item.canonicalVersion,
          item.semanticTextDigest,
          item.embeddingProfileId,
          item.embeddingProfileRevision,
          item.representationVersion,
          vectorString,
          item.dimension,
          item.evidenceIds,
          item.accessScope,
          item.sensitivity,
          item.indexedAt,
          item.createdAt,
          item.updatedAt,
        ],
      );
    } catch (error) {
      handlePostgresError(error, 'upsert-item');
    }
  }

  async upsertItems(items: readonly SemanticProjectionItem[]): Promise<void> {
    if (items.length === 0) return;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const item of items) {
        // Validate generation using the SAME connected transaction client
        const genRes = await client.query<GenerationRow>(
          `SELECT project_id, generation_id, dimension, embedding_profile_id, embedding_profile_revision, representation_version, normalization_policy
           FROM projection.semantic_generations
           WHERE project_id = $1 AND generation_id = $2`,
          [item.projectId, item.generationId],
        );
        const gen = genRes.rows[0];
        if (!gen) {
          throw new SemanticEmbeddingError({
            code: 'CONFIGURATION_REQUIRED',
            safeMessage: 'Referenced projection generation does not exist.',
            operation: 'upsert-items',
          });
        }
        validatePersistedItem(item, 'upsert-items');
        if (
          item.dimension !== gen.dimension ||
          item.embeddingProfileId !== gen.embedding_profile_id ||
          item.embeddingProfileRevision !== gen.embedding_profile_revision ||
          item.representationVersion !== gen.representation_version
        ) {
          throw new SemanticEmbeddingError({
            code: 'VALIDATION_FAILURE',
            safeMessage: `Item metadata does not match generation.`,
            operation: 'upsert-items',
          });
        }
        if (item.vector.length !== gen.dimension) {
          throw new SemanticEmbeddingError({
            code: 'VALIDATION_FAILURE',
            safeMessage: `Item dimension ${item.dimension} (vector length ${item.vector.length}) does not match generation dimension ${gen.dimension}.`,
            operation: 'upsert-items',
          });
        }
        if (gen.normalization_policy === 'unit_length') {
          validateUnitLength(item.vector, 'upsert-items');
        } else {
          validateFiniteVector(item.vector, 'upsert-items');
        }

        const vectorString = JSON.stringify(item.vector);
        await client.query(
          `INSERT INTO projection.semantic_items (
             project_id, generation_id, semantic_item_id, resource_type, resource_id,
             source_projection_digest, canonical_version, semantic_text_digest,
             embedding_profile_id, embedding_profile_revision, representation_version,
             vector, dimension, evidence_ids, access_scope, sensitivity,
             indexed_at, created_at, updated_at
           ) VALUES (
             $1, $2, $3, $4, $5,
             $6, $7, $8,
             $9, $10, $11,
             $12::vector, $13, $14::text[], $15::text[], $16,
             $17, $18, $19
           )
           ON CONFLICT (project_id, generation_id, resource_type, resource_id)
           DO UPDATE SET
             semantic_item_id = EXCLUDED.semantic_item_id,
             source_projection_digest = EXCLUDED.source_projection_digest,
             canonical_version = EXCLUDED.canonical_version,
             semantic_text_digest = EXCLUDED.semantic_text_digest,
             embedding_profile_id = EXCLUDED.embedding_profile_id,
             embedding_profile_revision = EXCLUDED.embedding_profile_revision,
             representation_version = EXCLUDED.representation_version,
             vector = EXCLUDED.vector,
             dimension = EXCLUDED.dimension,
             evidence_ids = EXCLUDED.evidence_ids,
             access_scope = EXCLUDED.access_scope,
             sensitivity = EXCLUDED.sensitivity,
             indexed_at = EXCLUDED.indexed_at,
             updated_at = EXCLUDED.updated_at`,
          [
            item.projectId,
            item.generationId,
            item.semanticItemId,
            item.resourceType,
            item.resourceId,
            item.sourceProjectionDigest,
            item.canonicalVersion,
            item.semanticTextDigest,
            item.embeddingProfileId,
            item.embeddingProfileRevision,
            item.representationVersion,
            vectorString,
            item.dimension,
            item.evidenceIds,
            item.accessScope,
            item.sensitivity,
            item.indexedAt,
            item.createdAt,
            item.updatedAt,
          ],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      handlePostgresError(error, 'upsert-items');
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
      `SELECT project_id, generation_id, semantic_item_id, resource_type, resource_id,
              source_projection_digest, canonical_version, semantic_text_digest,
              embedding_profile_id, embedding_profile_revision, representation_version,
              vector::text AS vector_text, dimension, evidence_ids, access_scope, sensitivity,
              indexed_at, created_at, updated_at
       FROM projection.semantic_items
       WHERE project_id = $1 AND generation_id = $2 AND resource_type = $3 AND resource_id = $4`,
      [projectId, generationId, resourceType, resourceId],
    );

    return result.rows[0] ? mapItem(result.rows[0]) : undefined;
  }

  async getItemBySemanticId(
    projectId: string,
    generationId: string,
    semanticItemId: string,
  ): Promise<SemanticProjectionItem | undefined> {
    const result = await this.pool.query<ItemRow>(
      `SELECT project_id, generation_id, semantic_item_id, resource_type, resource_id,
              source_projection_digest, canonical_version, semantic_text_digest,
              embedding_profile_id, embedding_profile_revision, representation_version,
              vector::text AS vector_text, dimension, evidence_ids, access_scope, sensitivity,
              indexed_at, created_at, updated_at
       FROM projection.semantic_items
       WHERE project_id = $1 AND generation_id = $2 AND semantic_item_id = $3`,
      [projectId, generationId, semanticItemId],
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
    validateSecurityInput(query, 'find-nearest-neighbors');

    const projectId = query.projectId.trim();
    const generationId = query.generationId.trim();

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

    if (gen.normalizationPolicy === 'unit_length') {
      validateUnitLength(query.queryVector, 'find-nearest-neighbors');
    } else {
      validateFiniteVector(query.queryVector, 'find-nearest-neighbors');
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

    const vectorString = JSON.stringify(query.queryVector);

    // SECURITY BEFORE TOP-K:
    // Candidate filtering (project_id, generation_id, dimension, access_scope, sensitivity)
    // is applied strictly in the WHERE clause BEFORE ORDER BY distance and LIMIT.
    const result = await this.pool.query<CandidateRow>(
      `SELECT
         project_id,
         generation_id,
         semantic_item_id,
         resource_type,
         resource_id,
         source_projection_digest,
         canonical_version,
         semantic_text_digest,
         embedding_profile_id,
         embedding_profile_revision,
         representation_version,
         dimension,
         evidence_ids,
         access_scope,
         sensitivity,
         indexed_at,
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
        query.allowedSensitivities,
        query.limit,
      ],
    );

    return result.rows.map((row) => ({
      semanticItemId: row.semantic_item_id,
      projectId: row.project_id,
      generationId: row.generation_id,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      sourceProjectionDigest: row.source_projection_digest,
      canonicalVersion: row.canonical_version,
      semanticTextDigest: row.semantic_text_digest,
      embeddingProfileId: row.embedding_profile_id,
      embeddingProfileRevision: row.embedding_profile_revision,
      representationVersion: row.representation_version,
      distance: row.distance,
      dimension: row.dimension,
      evidenceIds: row.evidence_ids,
      accessScope: row.access_scope,
      sensitivity: row.sensitivity,
      indexedAt: row.indexed_at.toISOString(),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    }));
  }
}
