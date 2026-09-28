import type { Pool, QueryResultRow } from 'pg';

import type {
  VPCandidatePolicyRefreshStorePort,
  VPCandidatePolicyRefreshTarget,
} from '../../../modules/vp-candidate-policy-refresh/src/index.js';

type TargetRow = QueryResultRow & {
  readonly project_id: string;
  readonly source_version_id: string;
  readonly revision_id: string;
  readonly access_scope: string[];
  readonly sensitivity: VPCandidatePolicyRefreshTarget['sensitivity'];
};

export class PostgresVPCandidatePolicyRefresh implements VPCandidatePolicyRefreshStorePort {
  constructor(private readonly pool: Pool) {}

  async nextOutdated(promptVersion: string): Promise<VPCandidatePolicyRefreshTarget | undefined> {
    const result = await this.pool.query<TargetRow>(
      `SELECT progress.project_id, progress.source_version_id::text,
              indexing.revision_id::text, version.access_scope, version.sensitivity
         FROM source_product.source_stage3_progress AS progress
         JOIN asset.source_versions AS version
           ON version.source_version_id = progress.source_version_id
          AND version.source_id = progress.source_id
         JOIN evidence.indexing_results AS indexing
           ON indexing.indexing_result_id = progress.indexing_result_id
          AND indexing.project_id = progress.project_id
          AND indexing.source_version_id = progress.source_version_id
          AND indexing.status = 'INDEXED'
         LEFT JOIN project_admin.project_knowledge_epoch AS reset_epoch
           ON reset_epoch.project_id = progress.project_id
        WHERE progress.state = 'STAGE3_COMPLETED'
          AND (reset_epoch.state IS NULL OR reset_epoch.state = 'READY')
          AND version.access_scope @> ARRAY['owner']::text[]
          AND NOT EXISTS (
            SELECT 1 FROM asset.source_versions AS newer
             WHERE newer.source_id = version.source_id
               AND newer.version_number > version.version_number
          )
          AND EXISTS (
            SELECT 1 FROM candidate.batches AS previous
             WHERE previous.project_id = progress.project_id
               AND previous.source_version_id = progress.source_version_id
               AND previous.revision_id = indexing.revision_id
               AND previous.provider_call->>'promptVersion' <> $1
          )
          AND NOT EXISTS (
            SELECT 1 FROM candidate.batches AS current_batch
             WHERE current_batch.project_id = progress.project_id
               AND current_batch.source_version_id = progress.source_version_id
               AND current_batch.revision_id = indexing.revision_id
               AND current_batch.provider_call->>'promptVersion' = $1
          )
        ORDER BY progress.updated_at, progress.source_version_id
        LIMIT 1`,
      [promptVersion],
    );
    const row = result.rows[0];
    return row
      ? {
          projectId: row.project_id,
          sourceVersionId: row.source_version_id,
          revisionId: row.revision_id,
          accessScope: row.access_scope,
          sensitivity: row.sensitivity,
        }
      : undefined;
  }
}
