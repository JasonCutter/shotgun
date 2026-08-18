import type pg from 'pg';
import type {
  SemanticActiveGenerationReaderPort,
  SemanticProjectionGeneration,
} from '../../../packages/contracts/src/index.js';

type GenerationRow = {
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
  readonly distance_metric: 'cosine' | 'dot_product' | 'euclidean';
  readonly normalization_policy: 'unit_length' | 'none';
  readonly build_status: 'BUILDING' | 'READY' | 'FAILED';
  readonly created_at: Date;
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

export class PostgresSemanticActiveGenerationReader implements SemanticActiveGenerationReaderPort {
  constructor(private readonly pool: pg.Pool) {}

  async getActiveGeneration(projectId: string): Promise<SemanticProjectionGeneration | undefined> {
    const query = `
      SELECT
        project_id,
        generation_id,
        source_projection_digest,
        canonical_base_version,
        credential_id,
        credential_revision,
        provider_policy_fingerprint,
        provider_id,
        embedding_model_id,
        embedding_profile_id,
        embedding_profile_revision,
        provider_registry_revision,
        capability_catalog_revision,
        representation_version,
        dimension,
        distance_metric,
        normalization_policy,
        build_status,
        created_at
      FROM projection.semantic_generations
      WHERE project_id = $1
        AND build_status = 'READY'
      ORDER BY created_at DESC
      LIMIT 1;
    `;

    const result = await this.pool.query<GenerationRow>(query, [projectId]);
    if (result.rows.length === 0 || !result.rows[0]) {
      return undefined;
    }

    return mapGeneration(result.rows[0]);
  }
}
