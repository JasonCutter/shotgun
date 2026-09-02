import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient, QueryResultRow } from 'pg';

import type {
  StandingAIProcessingPolicy,
  StandingAIProcessingPolicyRepositoryPort,
} from '../../../packages/policy/src/index.js';

type StandingPolicyRow = QueryResultRow & {
  project_id: string;
  enabled: boolean;
  provider_id: string;
  policy_revision: number;
  ai_configuration_revision: number;
  changed_by: string;
  changed_at: Date;
};

const columns = `
  project_id, enabled, provider_id, policy_revision,
  ai_configuration_revision, changed_by, changed_at`;

const mapPolicy = (row: StandingPolicyRow): StandingAIProcessingPolicy =>
  Object.freeze({
    projectId: row.project_id,
    enabled: row.enabled,
    providerId: row.provider_id,
    policyRevision: Number(row.policy_revision),
    aiConfigurationRevision: Number(row.ai_configuration_revision),
    changedBy: row.changed_by,
    changedAt: row.changed_at.toISOString(),
  });

const currentSql = `
  SELECT ${columns}
  FROM ai.project_standing_ai_processing_policies
  WHERE project_id = $1`;

const insertRevision = async (
  client: PoolClient,
  policy: StandingAIProcessingPolicy,
): Promise<void> => {
  await client.query(
    `INSERT INTO ai.project_standing_ai_processing_policy_revisions (
       project_id, enabled, provider_id, policy_revision,
       ai_configuration_revision, changed_by, changed_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      policy.projectId,
      policy.enabled,
      policy.providerId,
      policy.policyRevision,
      policy.aiConfigurationRevision,
      policy.changedBy,
      policy.changedAt,
    ],
  );
};

export class PostgresStandingAIProcessingPolicyRepository implements StandingAIProcessingPolicyRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async getCurrent(projectId: string): Promise<StandingAIProcessingPolicy | undefined> {
    const result = await this.pool.query<StandingPolicyRow>(currentSql, [projectId]);
    return result.rows[0] ? mapPolicy(result.rows[0]) : undefined;
  }

  async saveRevision(input: {
    readonly expectedRevision: number;
    readonly next: StandingAIProcessingPolicy;
  }): Promise<'CREATED' | 'UPDATED' | 'CONFLICT'> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<StandingPolicyRow>(`${currentSql} FOR UPDATE`, [
        input.next.projectId,
      ]);
      const currentRow = current.rows[0];
      const currentRevision = currentRow ? Number(currentRow.policy_revision) : 0;
      if (
        currentRevision !== input.expectedRevision ||
        input.next.policyRevision !== input.expectedRevision + 1
      ) {
        await client.query('ROLLBACK');
        return 'CONFLICT';
      }

      await insertRevision(client, input.next);
      if (currentRow) {
        await client.query(
          `UPDATE ai.project_standing_ai_processing_policies
           SET enabled = $2,
               provider_id = $3,
               policy_revision = $4,
               ai_configuration_revision = $5,
               changed_by = $6,
               changed_at = $7
           WHERE project_id = $1`,
          [
            input.next.projectId,
            input.next.enabled,
            input.next.providerId,
            input.next.policyRevision,
            input.next.aiConfigurationRevision,
            input.next.changedBy,
            input.next.changedAt,
          ],
        );
      } else {
        await client.query(
          `INSERT INTO ai.project_standing_ai_processing_policies (
             project_id, enabled, provider_id, policy_revision,
             ai_configuration_revision, changed_by, changed_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            input.next.projectId,
            input.next.enabled,
            input.next.providerId,
            input.next.policyRevision,
            input.next.aiConfigurationRevision,
            input.next.changedBy,
            input.next.changedAt,
          ],
        );
      }
      await client.query(
        `INSERT INTO settings.settings_audit_events
           (event_id, project_id, actor_id, action_name, risk_level, details, timestamp)
         VALUES ($1, $2, $3, 'PROJECT_STANDING_AI_PROCESSING_POLICY_CHANGED', 'HIGH', $4, $5)`,
        [
          randomUUID(),
          input.next.projectId,
          input.next.changedBy,
          JSON.stringify({
            enabled: input.next.enabled,
            providerId: input.next.providerId,
            policyRevision: input.next.policyRevision,
            aiConfigurationRevision: input.next.aiConfigurationRevision,
          }),
          input.next.changedAt,
        ],
      );
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
