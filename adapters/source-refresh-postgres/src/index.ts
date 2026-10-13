import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { EXTERNAL_SOURCE_FRESHNESS_TTL_MS } from '../../../packages/contracts/src/index.js';
import type {
  SourceRefreshJob,
  SourceRefreshPhase,
  SourceRefreshStorePort,
} from '../../../modules/frontend-sources-write/src/source-refresh.js';
import { withSafePostgresTransaction } from '../../../packages/postgres-transaction/src/index.js';

type RefreshRow = {
  job_id: string;
  project_id: string;
  source_id: string;
  source_version_id: string;
  principal_id: string;
  session_id: string;
  requested_url: string;
  label: string;
  sensitivity: SourceRefreshJob['sensitivity'];
  access_scope: string[];
  phase: SourceRefreshPhase;
  staging_reference: string | null;
  submission_id: string;
  item_id: string;
  command_id: string;
  lease_token: string;
};

/** Bounded database-time scheduler, backed by original immutable URL receipts.
 * A job is unique for one Source + acquisition receipt, not URL/hash globally. */
export class PostgresSourceRefreshStore implements SourceRefreshStorePort {
  constructor(
    private readonly pool: Pool,
    private readonly leaseMs = 120_000,
  ) {
    if (!Number.isInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 900_000) {
      throw new Error('Source refresh lease is outside the bounded policy.');
    }
  }

  async claimNext(workerId: string): Promise<SourceRefreshJob | undefined> {
    if (!workerId.trim() || workerId.length > 200)
      throw new Error('Invalid refresh worker identity.');
    return withSafePostgresTransaction(
      this.pool,
      async (client) => {
        // An uncertain fetch is visible and held; restart never silently refetches it.
        await client.query(`UPDATE source_product.url_refresh_jobs SET
        phase = 'OUTCOME_UNKNOWN', safe_failure_code = 'URL_REFRESH_ACQUISITION_UNKNOWN',
        lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL,
        completed_at = clock_timestamp(), updated_at = clock_timestamp()
        WHERE phase = 'ACQUIRING' AND lease_expires_at <= clock_timestamp()
          AND NOT EXISTS (SELECT 1 FROM project_admin.project_knowledge_epoch reset WHERE reset.project_id=url_refresh_jobs.project_id AND reset.state <> 'READY')`);
        // Recover only phases which carry no repeat network acquisition.
        await client.query(`UPDATE source_product.url_refresh_jobs SET
        lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL
        WHERE phase IN ('READY','STAGED','SUBMITTING') AND lease_expires_at <= clock_timestamp()
          AND NOT EXISTS (SELECT 1 FROM project_admin.project_knowledge_epoch reset WHERE reset.project_id=url_refresh_jobs.project_id AND reset.state <> 'READY')`);
        const due = await client.query<{
          project_id: string;
          source_id: string;
          source_version_id: string;
          principal_id: string;
          session_id: string;
          receipt_id: string;
          requested_url: string;
          label: string;
          sensitivity: SourceRefreshJob['sensitivity'];
          access_scope: string[];
        }>(
          `SELECT source.project_id, source.source_id::text, version.source_version_id::text,
          submission.principal_id, submission.session_id::text, receipt.url_provenance_receipt_id::text AS receipt_id,
          attempt.normalized_requested_url AS requested_url, item.label,
          version.sensitivity, version.access_scope
        FROM asset.sources source
        JOIN LATERAL (SELECT * FROM asset.source_versions candidate
          WHERE candidate.source_id = source.source_id ORDER BY version_number DESC LIMIT 1) version ON true
        JOIN LATERAL (SELECT * FROM source_product.url_provenance_receipts candidate
          WHERE candidate.project_id = source.project_id AND candidate.source_version_id = version.source_version_id
            AND candidate.outcome = 'SUCCEEDED' AND candidate.retrieved_at IS NOT NULL
          ORDER BY retrieved_at DESC, created_at DESC, url_provenance_receipt_id DESC LIMIT 1) receipt ON true
        JOIN source_product.url_acquisition_attempts attempt ON attempt.url_acquisition_attempt_id = receipt.url_acquisition_attempt_id
        JOIN source_product.intake_submissions submission ON submission.submission_id = receipt.submission_id
        JOIN source_product.intake_submission_items item ON item.submission_item_id = receipt.submission_item_id
        WHERE receipt.retrieved_at + ($1::bigint * interval '1 millisecond') <= clock_timestamp()
          AND EXISTS (SELECT 1 FROM project_admin.projects project WHERE project.id=source.project_id AND project.active AND project.status='ACTIVE')
          AND NOT EXISTS (SELECT 1 FROM project_admin.project_knowledge_epoch reset WHERE reset.project_id=source.project_id AND reset.state <> 'READY')
          AND NOT EXISTS (SELECT 1 FROM source_product.url_refresh_jobs existing
            WHERE existing.source_id = source.source_id AND
              (existing.provenance_receipt_id = receipt.url_provenance_receipt_id OR
               existing.phase IN ('READY','ACQUIRING','STAGED','SUBMITTING','OUTCOME_UNKNOWN')))
        ORDER BY receipt.retrieved_at, source.source_id LIMIT 1`,
          [EXTERNAL_SOURCE_FRESHNESS_TTL_MS],
        );
        const candidate = due.rows[0];
        if (candidate)
          await client.query(
            `INSERT INTO source_product.url_refresh_jobs (
        job_id, project_id, source_id, source_version_id, principal_id, provenance_receipt_id,
        requested_url, label, sensitivity, access_scope, phase, submission_id, item_id, command_id, session_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'READY',$11,$12,$13,$14)
        ON CONFLICT (source_id, provenance_receipt_id) DO NOTHING`,
            [
              randomUUID(),
              candidate.project_id,
              candidate.source_id,
              candidate.source_version_id,
              candidate.principal_id,
              candidate.receipt_id,
              candidate.requested_url,
              candidate.label,
              candidate.sensitivity,
              candidate.access_scope,
              randomUUID(),
              randomUUID(),
              randomUUID(),
              candidate.session_id,
            ],
          );
        const claimed = await client.query<RefreshRow>(
          `UPDATE source_product.url_refresh_jobs job SET
        lease_token = $1, lease_owner = $2, lease_expires_at = clock_timestamp() + ($3::bigint * interval '1 millisecond'),
        phase = CASE WHEN phase = 'FAILED' AND staging_reference IS NOT NULL THEN 'STAGED'
          WHEN phase = 'FAILED' THEN 'READY' ELSE phase END,
        updated_at = clock_timestamp()
        WHERE job_id = (SELECT job_id FROM source_product.url_refresh_jobs
          WHERE lease_token IS NULL AND next_attempt_at <= clock_timestamp()
            AND NOT EXISTS (SELECT 1 FROM project_admin.project_knowledge_epoch reset WHERE reset.project_id=url_refresh_jobs.project_id AND reset.state <> 'READY')
            AND (phase IN ('READY','STAGED','SUBMITTING') OR (phase = 'FAILED' AND
              ((attempts < 3 AND safe_failure_code = 'URL_REFRESH_ACQUISITION_FAILED')
                OR safe_failure_code = 'REFRESH_AUTHORITY_DENIED')))
          ORDER BY next_attempt_at, created_at, job_id FOR UPDATE SKIP LOCKED LIMIT 1)
        RETURNING *`,
          [randomUUID(), workerId, this.leaseMs],
        );
        const row = claimed.rows[0];
        return row
          ? {
              jobId: row.job_id,
              projectId: row.project_id,
              sourceId: row.source_id,
              sourceVersionId: row.source_version_id,
              principalId: row.principal_id,
              sessionId: row.session_id,
              requestedUrl: row.requested_url,
              label: row.label,
              sensitivity: row.sensitivity,
              accessScope: row.access_scope,
              phase: row.phase,
              ...(row.staging_reference ? { stagingReference: row.staging_reference } : {}),
              submissionId: row.submission_id,
              itemId: row.item_id,
              commandId: row.command_id,
              leaseToken: row.lease_token,
            }
          : undefined;
      },
      { module: 'source-refresh-postgres', operation: 'claim-next' },
    );
  }

  async transition(input: Parameters<SourceRefreshStorePort['transition']>[0]): Promise<void> {
    const allowed: Readonly<Record<SourceRefreshPhase, readonly SourceRefreshPhase[]>> = {
      READY: ['ACQUIRING', 'FAILED'],
      ACQUIRING: ['STAGED', 'FAILED', 'OUTCOME_UNKNOWN'],
      STAGED: ['SUBMITTING', 'FAILED'],
      SUBMITTING: ['SUBMITTING', 'SUCCEEDED', 'FAILED', 'OUTCOME_UNKNOWN'],
      SUCCEEDED: [],
      FAILED: [],
      OUTCOME_UNKNOWN: [],
    };
    if (!allowed[input.job.phase].includes(input.phase))
      throw new Error('Invalid source refresh phase transition.');
    const result = await this.pool.query(
      `UPDATE source_product.url_refresh_jobs SET
      phase = $5, staging_reference = COALESCE($6, staging_reference),
      attempts = attempts + CASE WHEN $5 = 'ACQUIRING' THEN 1 ELSE 0 END,
      produced_source_version_id = COALESCE($7::uuid, produced_source_version_id),
      safe_failure_code = $8, updated_at = clock_timestamp(),
      completed_at = CASE WHEN $5 IN ('FAILED','SUCCEEDED','OUTCOME_UNKNOWN') THEN clock_timestamp() ELSE NULL END,
      next_attempt_at = clock_timestamp() + interval '5 minutes',
      lease_token = CASE WHEN $9 THEN NULL ELSE lease_token END,
      lease_owner = CASE WHEN $9 THEN NULL ELSE lease_owner END,
      lease_expires_at = CASE WHEN $9 THEN NULL ELSE lease_expires_at END
      WHERE job_id = $1 AND project_id = $2 AND lease_token = $3 AND phase = $4
        AND lease_expires_at > clock_timestamp() RETURNING job_id`,
      [
        input.job.jobId,
        input.job.projectId,
        input.job.leaseToken,
        input.job.phase,
        input.phase,
        input.stagingReference ?? null,
        input.producedSourceVersionId ?? null,
        input.safeFailureCode ?? null,
        input.release ?? false,
      ],
    );
    if (result.rowCount !== 1) throw new Error('Source refresh lease or phase no longer matches.');
  }
}
