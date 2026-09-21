import type { Pool, QueryResultRow } from 'pg';

import type {
  SemanticDistanceMetric,
  SemanticEmbeddingProfile,
  SemanticEmbeddingProfileRepositoryPort,
  SemanticEmbeddingProfileStatus,
  SemanticNormalizationPolicy,
} from '../../../packages/contracts/src/index.js';
import { ShotgunError, stableJson } from '../../../packages/contracts/src/index.js';
import { withSafePostgresTransaction } from '../../../packages/postgres-transaction/src/index.js';

type ProfileRow = QueryResultRow & {
  readonly project_id: string;
  readonly profile_id: string;
  readonly profile_revision: number;
  readonly provider_id: string;
  readonly embedding_model_id: string;
  readonly credential_id: string;
  readonly credential_revision: number;
  readonly representation_version: string;
  readonly dimension: number;
  readonly distance_metric: SemanticDistanceMetric;
  readonly normalization_policy: SemanticNormalizationPolicy;
  readonly status: SemanticEmbeddingProfileStatus;
  readonly created_at: Date;
  readonly created_by: string;
  readonly updated_at: Date;
  readonly updated_by: string;
  readonly activated_at: Date | null;
};

const toIso = (value: Date | string | null | undefined): string | undefined => {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
};

const mapRow = (row: ProfileRow): SemanticEmbeddingProfile => ({
  projectId: row.project_id,
  profileId: row.profile_id,
  profileRevision: row.profile_revision,
  providerId: row.provider_id,
  embeddingModelId: row.embedding_model_id,
  credentialId: row.credential_id,
  credentialRevision: row.credential_revision,
  representationVersion: row.representation_version,
  dimension: row.dimension,
  distanceMetric: row.distance_metric,
  normalizationPolicy: row.normalization_policy,
  status: row.status,
  createdAt: toIso(row.created_at)!,
  createdBy: row.created_by,
  updatedAt: toIso(row.updated_at)!,
  updatedBy: row.updated_by,
  ...(row.activated_at ? { activatedAt: toIso(row.activated_at) } : {}),
});

const sameProfileMaterial = (
  expected: SemanticEmbeddingProfile,
  actual: SemanticEmbeddingProfile,
): boolean =>
  stableJson({
    ...expected,
    projectId: expected.projectId.trim(),
    profileId: expected.profileId.trim(),
    providerId: expected.providerId.trim(),
    embeddingModelId: expected.embeddingModelId.trim(),
    credentialId: expected.credentialId.trim(),
    representationVersion: expected.representationVersion.trim(),
    createdBy: expected.createdBy ?? expected.updatedBy,
    updatedBy: expected.updatedBy,
    activatedAt: expected.activatedAt ?? undefined,
  }) ===
  stableJson({
    ...actual,
    projectId: actual.projectId.trim(),
    profileId: actual.profileId.trim(),
    providerId: actual.providerId.trim(),
    embeddingModelId: actual.embeddingModelId.trim(),
    credentialId: actual.credentialId.trim(),
    representationVersion: actual.representationVersion.trim(),
    createdBy: actual.createdBy,
    updatedBy: actual.updatedBy,
    activatedAt: actual.activatedAt ?? undefined,
  });

const isOutcomeUnknown = (error: unknown): error is ShotgunError =>
  error instanceof ShotgunError && error.code === 'OUTCOME_UNKNOWN';

export class PostgresSemanticEmbeddingProfileRepository implements SemanticEmbeddingProfileRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async findActive(projectId: string): Promise<SemanticEmbeddingProfile | undefined> {
    const res = await this.pool.query<ProfileRow>(
      `SELECT * FROM projection.semantic_embedding_profiles
       WHERE project_id = $1 AND status = 'ACTIVE'
       ORDER BY profile_revision DESC
       LIMIT 1`,
      [projectId.trim()],
    );
    return res.rows[0] ? mapRow(res.rows[0]) : undefined;
  }

  async findCurrent(projectId: string): Promise<SemanticEmbeddingProfile | undefined> {
    const res = await this.pool.query<ProfileRow>(
      `SELECT * FROM projection.semantic_embedding_profiles
       WHERE project_id = $1
       ORDER BY profile_revision DESC
       LIMIT 1`,
      [projectId.trim()],
    );
    return res.rows[0] ? mapRow(res.rows[0]) : undefined;
  }

  async findByRevision(
    projectId: string,
    revision: number,
  ): Promise<SemanticEmbeddingProfile | undefined> {
    const res = await this.pool.query<ProfileRow>(
      `SELECT * FROM projection.semantic_embedding_profiles
       WHERE project_id = $1 AND profile_revision = $2`,
      [projectId.trim(), revision],
    );
    return res.rows[0] ? mapRow(res.rows[0]) : undefined;
  }

  async saveRevision(input: {
    readonly expectedRevision: number;
    readonly next: SemanticEmbeddingProfile;
  }): Promise<'CREATED' | 'UPDATED' | 'CONFLICT'> {
    try {
      return await withSafePostgresTransaction(
        this.pool,
        async (client) => {
          const currentRes = await client.query<{ max_rev: number | null }>(
            `SELECT MAX(profile_revision) AS max_rev
             FROM projection.semantic_embedding_profiles
             WHERE project_id = $1`,
            [input.next.projectId.trim()],
          );
          const currentMax = currentRes.rows[0]?.max_rev ?? 0;
          if (
            currentMax !== input.expectedRevision ||
            input.next.profileRevision !== input.expectedRevision + 1
          ) {
            throw new ShotgunError({
              code: 'CONFLICT',
              safeMessage: 'The semantic embedding profile revision changed.',
              module: 'semantic-embedding-postgres',
              operation: 'save-semantic-embedding-profile-revision',
            });
          }
          await client.query(
            `INSERT INTO projection.semantic_embedding_profiles (
              project_id, profile_id, profile_revision, provider_id, embedding_model_id,
              credential_id, credential_revision, representation_version, dimension,
              distance_metric, normalization_policy, status, created_at, created_by,
              updated_at, updated_by, activated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
            [
              input.next.projectId.trim(),
              input.next.profileId.trim(),
              input.next.profileRevision,
              input.next.providerId.trim(),
              input.next.embeddingModelId.trim(),
              input.next.credentialId.trim(),
              input.next.credentialRevision,
              input.next.representationVersion.trim(),
              input.next.dimension,
              input.next.distanceMetric,
              input.next.normalizationPolicy,
              input.next.status,
              input.next.createdAt,
              input.next.createdBy ?? input.next.updatedBy,
              input.next.updatedAt,
              input.next.updatedBy,
              input.next.activatedAt ?? null,
            ],
          );
          return input.expectedRevision === 0 ? 'CREATED' : 'UPDATED';
        },
        {
          module: 'semantic-embedding-postgres',
          operation: 'save-semantic-embedding-profile-revision',
        },
      );
    } catch (error) {
      const pgError = error as { code?: string };
      if (pgError.code === '23505') {
        return 'CONFLICT';
      }
      if (isOutcomeUnknown(error)) {
        const durable = await this.findByRevision(
          input.next.projectId.trim(),
          input.next.profileRevision,
        );
        if (!durable) throw error;
        if (sameProfileMaterial(input.next, durable)) {
          return input.expectedRevision === 0 ? 'CREATED' : 'UPDATED';
        }
        return 'CONFLICT';
      }
      if (error instanceof ShotgunError && error.code === 'CONFLICT') return 'CONFLICT';
      throw error;
    }
  }

  async updateStatus(input: {
    readonly projectId: string;
    readonly profileId: string;
    readonly profileRevision: number;
    readonly status: SemanticEmbeddingProfileStatus;
    readonly activatedAt?: string;
    readonly updatedBy: string;
    readonly updatedAt: string;
  }): Promise<SemanticEmbeddingProfile | 'NOT_FOUND' | 'CONFLICT'> {
    const res = await this.pool.query<ProfileRow>(
      `UPDATE projection.semantic_embedding_profiles
       SET status = $1,
           activated_at = COALESCE($2, activated_at),
           updated_by = $3,
           updated_at = $4
       WHERE project_id = $5 AND profile_id = $6 AND profile_revision = $7
       RETURNING *`,
      [
        input.status,
        input.activatedAt ?? null,
        input.updatedBy,
        input.updatedAt,
        input.projectId.trim(),
        input.profileId.trim(),
        input.profileRevision,
      ],
    );
    if (!res.rows[0]) {
      const check = await this.pool.query(
        `SELECT 1 FROM projection.semantic_embedding_profiles
         WHERE project_id = $1 AND profile_revision = $2`,
        [input.projectId.trim(), input.profileRevision],
      );
      return check.rowCount ? 'CONFLICT' : 'NOT_FOUND';
    }
    return mapRow(res.rows[0]);
  }
}
