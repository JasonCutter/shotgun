import type { Pool, QueryResultRow } from 'pg';

import type {
  DiscoveryModelProfileRepositoryPort,
  DiscoveryModelProfileStatus,
  DiscoveryModelProfileV1,
} from '../../../packages/contracts/src/index.js';

type ProfileRow = QueryResultRow & {
  readonly schema_version: string;
  readonly project_id: string;
  readonly profile_id: string;
  readonly profile_revision: number;
  readonly ai_configuration_revision: number;
  readonly provider_id: string;
  readonly model_id: string;
  readonly provider_registry_revision: string;
  readonly model_capability_revision: string;
  readonly prompt_version: string;
  readonly output_schema_version: string;
  readonly status: DiscoveryModelProfileStatus;
  readonly created_by: string;
  readonly created_at: Date | string;
  readonly activated_at: Date | string | null;
  readonly retired_at: Date | string | null;
};

const iso = (value: Date | string | null): string | undefined => {
  if (value === null) return undefined;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
};

const mapRow = (row: ProfileRow): DiscoveryModelProfileV1 => ({
  schemaVersion: '1.0.0',
  profileId: row.profile_id,
  projectId: row.project_id,
  profileRevision: Number(row.profile_revision),
  aiConfigurationRevision: Number(row.ai_configuration_revision),
  providerId: row.provider_id,
  modelId: row.model_id,
  providerRegistryRevision: row.provider_registry_revision,
  modelCapabilityRevision: row.model_capability_revision,
  promptVersion: row.prompt_version,
  outputSchemaVersion: row.output_schema_version,
  status: row.status,
  createdBy: row.created_by,
  createdAt: iso(row.created_at)!,
  ...(row.activated_at === null ? {} : { activatedAt: iso(row.activated_at) }),
  ...(row.retired_at === null ? {} : { retiredAt: iso(row.retired_at) }),
});

const project = (projectId: string): string => projectId.trim();

export class PostgresDiscoveryModelProfileRepository implements DiscoveryModelProfileRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async findActive(projectId: string): Promise<DiscoveryModelProfileV1 | undefined> {
    const result = await this.pool.query<ProfileRow>(
      `SELECT * FROM discovery.model_profiles
       WHERE project_id = $1 AND status = 'ACTIVE'
       ORDER BY profile_revision DESC
       LIMIT 1`,
      [project(projectId)],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : undefined;
  }

  async findCurrent(projectId: string): Promise<DiscoveryModelProfileV1 | undefined> {
    const result = await this.pool.query<ProfileRow>(
      `SELECT * FROM discovery.model_profiles
       WHERE project_id = $1
       ORDER BY profile_revision DESC
       LIMIT 1`,
      [project(projectId)],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : undefined;
  }

  async findRevision(
    projectId: string,
    profileRevision: number,
  ): Promise<DiscoveryModelProfileV1 | undefined> {
    const result = await this.pool.query<ProfileRow>(
      `SELECT * FROM discovery.model_profiles
       WHERE project_id = $1 AND profile_revision = $2`,
      [project(projectId), profileRevision],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : undefined;
  }

  async saveRevision(input: {
    readonly expectedRevision: number;
    readonly next: DiscoveryModelProfileV1;
  }): Promise<'CREATED' | 'UPDATED' | 'CONFLICT'> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<{ profile_revision: number }>(
        `SELECT profile_revision
         FROM discovery.model_profiles
         WHERE project_id = $1
         ORDER BY profile_revision DESC
         LIMIT 1
         FOR UPDATE`,
        [input.next.projectId],
      );
      const currentRevision = Number(current.rows[0]?.profile_revision ?? 0);
      if (
        currentRevision !== input.expectedRevision ||
        input.next.profileRevision !== input.expectedRevision + 1
      ) {
        await client.query('ROLLBACK');
        return 'CONFLICT';
      }
      await client.query(
        `INSERT INTO discovery.model_profiles (
           schema_version, project_id, profile_id, profile_revision,
           ai_configuration_revision, provider_id, model_id,
           provider_registry_revision, model_capability_revision,
           prompt_version, output_schema_version, status, created_by,
           created_at, activated_at, retired_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          input.next.schemaVersion,
          input.next.projectId,
          input.next.profileId,
          input.next.profileRevision,
          input.next.aiConfigurationRevision,
          input.next.providerId,
          input.next.modelId,
          input.next.providerRegistryRevision,
          input.next.modelCapabilityRevision,
          input.next.promptVersion,
          input.next.outputSchemaVersion,
          input.next.status,
          input.next.createdBy,
          input.next.createdAt,
          input.next.activatedAt ?? null,
          input.next.retiredAt ?? null,
        ],
      );
      await client.query('COMMIT');
      return input.expectedRevision === 0 ? 'CREATED' : 'UPDATED';
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) return 'CONFLICT';
      throw error;
    } finally {
      client.release();
    }
  }

  async updateStatus(input: {
    readonly projectId: string;
    readonly profileId: string;
    readonly profileRevision: number;
    readonly expectedStatus: DiscoveryModelProfileStatus;
    readonly status: DiscoveryModelProfileStatus;
    readonly updatedAt: string;
  }): Promise<DiscoveryModelProfileV1 | 'NOT_FOUND' | 'CONFLICT'> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const target = await client.query<ProfileRow>(
        `SELECT * FROM discovery.model_profiles
         WHERE project_id = $1 AND profile_id = $2 AND profile_revision = $3
         FOR UPDATE`,
        [input.projectId, input.profileId, input.profileRevision],
      );
      const row = target.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return 'NOT_FOUND';
      }
      if (row.status !== input.expectedStatus) {
        await client.query('ROLLBACK');
        return 'CONFLICT';
      }

      if (input.status === 'ACTIVE') {
        await client.query(
          `UPDATE discovery.model_profiles
           SET status = 'RETIRED', retired_at = $2
           WHERE project_id = $1 AND status = 'ACTIVE' AND profile_id <> $3`,
          [input.projectId, input.updatedAt, input.profileId],
        );
        await client.query(
          `UPDATE discovery.model_profiles
           SET status = 'ACTIVE', activated_at = $4, retired_at = NULL
           WHERE project_id = $1 AND profile_id = $2 AND profile_revision = $3`,
          [input.projectId, input.profileId, input.profileRevision, input.updatedAt],
        );
      } else if (input.status === 'RETIRED') {
        await client.query(
          `UPDATE discovery.model_profiles
           SET status = 'RETIRED', retired_at = $4
           WHERE project_id = $1 AND profile_id = $2 AND profile_revision = $3`,
          [input.projectId, input.profileId, input.profileRevision, input.updatedAt],
        );
      } else {
        await client.query('ROLLBACK');
        return 'CONFLICT';
      }

      const updated = await client.query<ProfileRow>(
        `SELECT * FROM discovery.model_profiles
         WHERE project_id = $1 AND profile_id = $2 AND profile_revision = $3`,
        [input.projectId, input.profileId, input.profileRevision],
      );
      await client.query('COMMIT');
      return updated.rows[0] ? mapRow(updated.rows[0]) : 'NOT_FOUND';
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) return 'CONFLICT';
      throw error;
    } finally {
      client.release();
    }
  }
}

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
