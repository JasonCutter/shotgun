import type { Pool, PoolClient, QueryResultRow } from 'pg';

import type {
  ProjectAIConfiguration,
  ProjectAIConfigurationRepositoryPort,
} from '../../../modules/ai-configuration/src/index.js';

type ConfigurationRow = QueryResultRow & {
  project_id: string;
  active_provider_id: string;
  active_model_id: string;
  credential_id: string;
  credential_revision: number;
  ai_configuration_revision: number;
  updated_by: string;
  updated_at: Date;
};

const columns = `
  project_id, active_provider_id, active_model_id, credential_id::text,
  credential_revision, ai_configuration_revision, updated_by, updated_at`;

const mapConfiguration = (row: ConfigurationRow): ProjectAIConfiguration => ({
  projectId: row.project_id,
  activeProviderId: row.active_provider_id,
  activeModelId: row.active_model_id,
  credentialId: row.credential_id,
  credentialRevision: row.credential_revision,
  aiConfigurationRevision: row.ai_configuration_revision,
  updatedBy: row.updated_by,
  updatedAt: row.updated_at.toISOString(),
});

const findCurrentSql = `
  SELECT ${columns}
  FROM ai.project_ai_configurations
  WHERE project_id = $1`;

const insertRevision = async (
  client: PoolClient,
  configuration: ProjectAIConfiguration,
): Promise<void> => {
  await client.query(
    `INSERT INTO ai.project_ai_configuration_revisions (
       project_id, active_provider_id, active_model_id, credential_id,
       credential_revision, ai_configuration_revision, updated_by, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      configuration.projectId,
      configuration.activeProviderId,
      configuration.activeModelId,
      configuration.credentialId,
      configuration.credentialRevision,
      configuration.aiConfigurationRevision,
      configuration.updatedBy,
      configuration.updatedAt,
    ],
  );
};

export class PostgresProjectAIConfigurationRepository implements ProjectAIConfigurationRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async findCurrent(projectId: string): Promise<ProjectAIConfiguration | undefined> {
    const result = await this.pool.query<ConfigurationRow>(findCurrentSql, [projectId]);
    return result.rows[0] ? mapConfiguration(result.rows[0]) : undefined;
  }

  async findRevision(
    projectId: string,
    revision: number,
  ): Promise<ProjectAIConfiguration | undefined> {
    const result = await this.pool.query<ConfigurationRow>(
      `SELECT ${columns}
       FROM ai.project_ai_configuration_revisions
       WHERE project_id = $1 AND ai_configuration_revision = $2`,
      [projectId, revision],
    );
    return result.rows[0] ? mapConfiguration(result.rows[0]) : undefined;
  }

  async saveRevision(input: {
    readonly expectedRevision: number;
    readonly next: ProjectAIConfiguration;
  }): Promise<'CREATED' | 'UPDATED' | 'CONFLICT'> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<ConfigurationRow>(`${findCurrentSql} FOR UPDATE`, [
        input.next.projectId,
      ]);
      const currentRow = current.rows[0];
      const currentRevision = currentRow?.ai_configuration_revision ?? 0;
      if (
        currentRevision !== input.expectedRevision ||
        input.next.aiConfigurationRevision !== input.expectedRevision + 1
      ) {
        await client.query('ROLLBACK');
        return 'CONFLICT';
      }

      await insertRevision(client, input.next);
      if (currentRow) {
        await client.query(
          `UPDATE ai.project_ai_configurations
           SET active_provider_id = $2,
               active_model_id = $3,
               credential_id = $4,
               credential_revision = $5,
               ai_configuration_revision = $6,
               updated_by = $7,
               updated_at = $8
           WHERE project_id = $1`,
          [
            input.next.projectId,
            input.next.activeProviderId,
            input.next.activeModelId,
            input.next.credentialId,
            input.next.credentialRevision,
            input.next.aiConfigurationRevision,
            input.next.updatedBy,
            input.next.updatedAt,
          ],
        );
      } else {
        await client.query(
          `INSERT INTO ai.project_ai_configurations (
             project_id, active_provider_id, active_model_id, credential_id,
             credential_revision, ai_configuration_revision, updated_by, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            input.next.projectId,
            input.next.activeProviderId,
            input.next.activeModelId,
            input.next.credentialId,
            input.next.credentialRevision,
            input.next.aiConfigurationRevision,
            input.next.updatedBy,
            input.next.updatedAt,
          ],
        );
      }
      await client.query('COMMIT');
      return currentRow ? 'UPDATED' : 'CREATED';
    } catch (error) {
      await client.query('ROLLBACK');
      if ((error as { code?: string }).code === '23505') return 'CONFLICT';
      throw error;
    } finally {
      client.release();
    }
  }
}
