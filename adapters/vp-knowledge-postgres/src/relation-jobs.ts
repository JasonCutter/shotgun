import { createHash, randomUUID } from 'node:crypto';

import type { Pool, QueryResultRow } from 'pg';

import type {
  VPCurrentAssertion,
  VPRelationJob,
  VPRelationJobDecision,
  VPRelationJobStorePort,
} from '../../../modules/vp-knowledge-ledger/src/index.js';
import { withSafePostgresTransaction } from '../../../packages/postgres-transaction/src/index.js';

type PairRow = QueryResultRow & {
  readonly job_id: string;
  readonly lease_token: string;
  readonly project_id: string;
  readonly attempt_count: number;
  readonly left_assertion_id: string;
  readonly left_source_id: string;
  readonly left_source_version_id: string;
  readonly left_evidence_id: string;
  readonly left_claim_text: string;
  readonly left_access_scope: string[];
  readonly left_sensitivity: VPCurrentAssertion['sensitivity'];
  readonly right_assertion_id: string;
  readonly right_source_id: string;
  readonly right_source_version_id: string;
  readonly right_evidence_id: string;
  readonly right_claim_text: string;
  readonly right_access_scope: string[];
  readonly right_sensitivity: VPCurrentAssertion['sensitivity'];
};

const assertion = (row: PairRow, side: 'left' | 'right'): VPCurrentAssertion => ({
  assertionId: row[`${side}_assertion_id`],
  projectId: row.project_id,
  sourceId: row[`${side}_source_id`],
  sourceVersionId: row[`${side}_source_version_id`],
  evidenceId: row[`${side}_evidence_id`],
  claimText: row[`${side}_claim_text`],
  accessScope: row[`${side}_access_scope`],
  sensitivity: row[`${side}_sensitivity`],
});

const digest = (row: PairRow, policyRevision: string): string =>
  `sha256:${createHash('sha256')
    .update(
      JSON.stringify([
        row.project_id,
        row.left_assertion_id,
        row.left_source_version_id,
        row.left_evidence_id,
        row.left_claim_text,
        row.right_assertion_id,
        row.right_source_version_id,
        row.right_evidence_id,
        row.right_claim_text,
        policyRevision,
      ]),
    )
    .digest('hex')}`;

const pairProjection = `
  job.job_id::text, job.lease_token::text, job.project_id, job.attempt_count,
  left_claim.assertion_id::text AS left_assertion_id,
  left_claim.source_id::text AS left_source_id,
  left_claim.source_version_id::text AS left_source_version_id,
  left_claim.evidence_id::text AS left_evidence_id,
  left_claim.claim_text AS left_claim_text,
  left_claim.access_scope AS left_access_scope,
  left_claim.sensitivity AS left_sensitivity,
  right_claim.assertion_id::text AS right_assertion_id,
  right_claim.source_id::text AS right_source_id,
  right_claim.source_version_id::text AS right_source_version_id,
  right_claim.evidence_id::text AS right_evidence_id,
  right_claim.claim_text AS right_claim_text,
  right_claim.access_scope AS right_access_scope,
  right_claim.sensitivity AS right_sensitivity`;

const pairJoins = `
  JOIN vp.current_assertions AS left_claim
    ON left_claim.project_id = job.project_id
   AND left_claim.assertion_id = job.left_assertion_id
  JOIN vp.current_assertions AS right_claim
    ON right_claim.project_id = job.project_id
   AND right_claim.assertion_id = job.right_assertion_id
  LEFT JOIN project_admin.project_knowledge_epoch AS reset_epoch
    ON reset_epoch.project_id = job.project_id`;

/** All pair selection and writes are scoped to current, immutable Evidence. */
export class PostgresVPRelationJobs implements VPRelationJobStorePort {
  constructor(
    private readonly pool: Pool,
    private readonly maxDailyProviderAttempts = 100,
  ) {
    if (!Number.isSafeInteger(maxDailyProviderAttempts) || maxDailyProviderAttempts < 1) {
      throw new Error('VP daily provider attempt ceiling must be a positive integer.');
    }
  }

  async enqueueCurrentPairs(policyRevision: string, limit = 32): Promise<number> {
    if (!policyRevision.trim()) throw new Error('VP relation policy revision is required.');
    // A newer SourceVersion can retire either assertion while a provider call is in flight.
    // Keep the old job for audit but prevent its result from becoming current knowledge.
    await this.pool.query(
      `UPDATE vp.relation_jobs AS job
          SET status = 'SUPERSEDED', lease_token = NULL,
              lease_expires_at = NULL, next_attempt_at = NULL,
              updated_at = clock_timestamp()
        WHERE job.status IN ('PENDING', 'RUNNING', 'RETRYABLE')
          AND NOT EXISTS (
            SELECT 1 FROM project_admin.project_knowledge_epoch AS reset_epoch
             WHERE reset_epoch.project_id = job.project_id
               AND reset_epoch.state <> 'READY'
          )
          AND (NOT EXISTS (
            SELECT 1 FROM vp.current_assertions AS current_left
             WHERE current_left.project_id = job.project_id
               AND current_left.assertion_id = job.left_assertion_id
          ) OR NOT EXISTS (
            SELECT 1 FROM vp.current_assertions AS current_right
             WHERE current_right.project_id = job.project_id
               AND current_right.assertion_id = job.right_assertion_id
          ))`,
    );
    const result = await this.pool.query<{ job_id: string }>(
      `INSERT INTO vp.relation_jobs (
         job_id, project_id, left_assertion_id, right_assertion_id, policy_revision
       )
       SELECT gen_random_uuid(), left_claim.project_id,
              left_claim.assertion_id, right_claim.assertion_id, $1
         FROM vp.current_assertions AS left_claim
         JOIN vp.current_assertions AS right_claim
           ON right_claim.project_id = left_claim.project_id
          AND left_claim.assertion_id < right_claim.assertion_id
          AND left_claim.claim_text <> right_claim.claim_text
          AND left_claim.access_scope = right_claim.access_scope
          AND left_claim.sensitivity = right_claim.sensitivity
         LEFT JOIN project_admin.project_knowledge_epoch AS reset_epoch
           ON reset_epoch.project_id = left_claim.project_id
        WHERE (reset_epoch.state IS NULL OR reset_epoch.state = 'READY')
          AND COALESCE(
            (SELECT claimed_count FROM vp.relation_call_budget
              WHERE budget_day = CURRENT_DATE), 0
          ) < $3
          AND NOT EXISTS (
            SELECT 1 FROM vp.relation_jobs AS existing
             WHERE existing.project_id = left_claim.project_id
               AND existing.left_assertion_id = left_claim.assertion_id
               AND existing.right_assertion_id = right_claim.assertion_id
               AND existing.policy_revision = $1
          )
        ORDER BY (left_claim.source_id <> right_claim.source_id) DESC, similarity(left_claim.claim_text, right_claim.claim_text) DESC,
                 GREATEST(left_claim.created_at, right_claim.created_at) DESC, left_claim.assertion_id, right_claim.assertion_id
        LIMIT $2
       ON CONFLICT DO NOTHING RETURNING job_id::text`,
      [
        policyRevision,
        Math.max(1, Math.min(128, Math.floor(limit))),
        this.maxDailyProviderAttempts,
      ],
    );
    return result.rowCount ?? 0;
  }

  async claimNext(policyRevision: string): Promise<VPRelationJob | undefined> {
    return withSafePostgresTransaction(
      this.pool,
      async (client) => {
        await client.query(
          `INSERT INTO vp.relation_call_budget (budget_day, claimed_count)
           VALUES (CURRENT_DATE, 0) ON CONFLICT DO NOTHING`,
        );
        const budget = await client.query<{ claimed_count: number }>(
          `SELECT claimed_count FROM vp.relation_call_budget
            WHERE budget_day = CURRENT_DATE FOR UPDATE`,
        );
        if (
          (budget.rows[0]?.claimed_count ?? this.maxDailyProviderAttempts) >=
          this.maxDailyProviderAttempts
        ) {
          return undefined;
        }
        const selected = await client.query<PairRow>(
          `SELECT ${pairProjection}
             FROM vp.relation_jobs AS job
             ${pairJoins}
            WHERE job.policy_revision = $1
              AND (reset_epoch.state IS NULL OR reset_epoch.state = 'READY')
              AND (job.status = 'PENDING'
                OR (job.status = 'RETRYABLE' AND job.next_attempt_at <= clock_timestamp())
                OR (job.status = 'RUNNING' AND job.lease_expires_at <= clock_timestamp()))
            ORDER BY job.created_at, job.job_id
            LIMIT 1 FOR UPDATE OF job SKIP LOCKED`,
          [policyRevision],
        );
        const row = selected.rows[0];
        if (!row) return undefined;
        const leaseToken = randomUUID();
        await client.query(
          `UPDATE vp.relation_call_budget SET claimed_count = claimed_count + 1
            WHERE budget_day = CURRENT_DATE`,
        );
        await client.query(
          `UPDATE vp.relation_jobs
              SET status = 'RUNNING', lease_token = $2,
                  lease_expires_at = clock_timestamp() + interval '2 minutes',
                  next_attempt_at = NULL, attempt_count = attempt_count + 1,
                  updated_at = clock_timestamp()
            WHERE job_id = $1`,
          [row.job_id, leaseToken],
        );
        return {
          jobId: row.job_id,
          leaseToken,
          projectId: row.project_id,
          left: assertion(row, 'left'),
          right: assertion(row, 'right'),
          attemptCount: row.attempt_count + 1,
        };
      },
      { module: 'vp-knowledge-postgres', operation: 'claim-relation-job' },
    );
  }

  async completeDecision(input: VPRelationJobDecision): Promise<boolean> {
    if (
      !['EQUIVALENT', 'QUALIFIES', 'CONTRADICTS', 'RELATED'].includes(input.choice) ||
      !Number.isFinite(input.confidence) ||
      input.confidence < 0 ||
      input.confidence > 1 ||
      !input.model.trim() ||
      !Number.isSafeInteger(input.inputTokens) ||
      input.inputTokens < 0 ||
      !Number.isSafeInteger(input.outputTokens) ||
      input.outputTokens < 0
    ) {
      throw new Error('VP relation decision is invalid.');
    }
    return withSafePostgresTransaction(
      this.pool,
      async (client) => {
        const selected = await client.query<PairRow & { policy_revision: string }>(
          `SELECT ${pairProjection}, job.policy_revision
             FROM vp.relation_jobs AS job
             ${pairJoins}
            WHERE job.job_id = $1 AND job.lease_token = $2
              AND job.status = 'RUNNING' AND job.lease_expires_at > clock_timestamp()
              AND (reset_epoch.state IS NULL OR reset_epoch.state = 'READY')
            FOR UPDATE OF job`,
          [input.jobId, input.leaseToken],
        );
        const row = selected.rows[0];
        if (!row) return false;
        const decisionId = randomUUID();
        const inserted = await client.query<{ decision_id: string }>(
          `INSERT INTO vp.decision_receipts (
             decision_id, project_id, method, task_kind, policy_revision,
             input_digest, outcome, left_assertion_id, right_assertion_id,
             confidence, provider_model, input_tokens, output_tokens
           ) VALUES ($1, $2, $3, 'SEMANTIC_RELATION', $4, $5, $6,
                     $7, $8, $9, $10, $11, $12)
           ON CONFLICT DO NOTHING RETURNING decision_id::text`,
          [
            decisionId,
            row.project_id,
            input.provider,
            row.policy_revision,
            digest(row, row.policy_revision),
            input.choice,
            row.left_assertion_id,
            row.right_assertion_id,
            input.confidence,
            input.model,
            input.inputTokens,
            input.outputTokens,
          ],
        );
        if (!inserted.rowCount) {
          await client.query(
            `UPDATE vp.relation_jobs
                SET status = 'COMPLETED', lease_token = NULL,
                    lease_expires_at = NULL, updated_at = clock_timestamp()
              WHERE job_id = $1`,
            [input.jobId],
          );
          return false;
        }
        const relationId = randomUUID();
        const relation = await client.query<{ relation_id: string }>(
          `INSERT INTO vp.relations (
             relation_id, project_id, left_assertion_id, right_assertion_id,
             relation_kind, decision_id
           ) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT DO NOTHING RETURNING relation_id::text`,
          [
            relationId,
            row.project_id,
            row.left_assertion_id,
            row.right_assertion_id,
            input.choice,
            decisionId,
          ],
        );
        if (relation.rowCount) {
          const epoch = await client.query<{ current_epoch: string }>(
            `INSERT INTO vp.project_epochs (project_id, current_epoch)
             VALUES ($1, 1)
             ON CONFLICT (project_id) DO UPDATE
               SET current_epoch = vp.project_epochs.current_epoch + 1,
                   updated_at = clock_timestamp()
             RETURNING current_epoch::text`,
            [row.project_id],
          );
          await client.query(
            `INSERT INTO vp.history_events (
               event_id, project_id, epoch, event_kind, assertion_id, relation_ids
             ) VALUES ($1, $2, $3, 'SEMANTIC_RELATION_RECORDED', $4, $5::uuid[])`,
            [
              randomUUID(),
              row.project_id,
              epoch.rows[0]?.current_epoch,
              row.left_assertion_id,
              [relationId],
            ],
          );
        }
        await client.query(
          `UPDATE vp.relation_jobs
              SET status = 'COMPLETED', lease_token = NULL,
                  lease_expires_at = NULL, updated_at = clock_timestamp()
            WHERE job_id = $1`,
          [input.jobId],
        );
        return Boolean(relation.rowCount);
      },
      { module: 'vp-knowledge-postgres', operation: 'complete-relation-job' },
    );
  }

  async retry(input: {
    readonly jobId: string;
    readonly leaseToken: string;
    readonly code: string;
    readonly nextAttemptAt: string;
  }): Promise<void> {
    if (
      !/^[A-Z][A-Z0-9_]{0,99}$/.test(input.code) ||
      Number.isNaN(Date.parse(input.nextAttemptAt))
    ) {
      throw new Error('VP retry requires a bounded code and date.');
    }
    await this.pool.query(
      `UPDATE vp.relation_jobs
          SET status = 'RETRYABLE', lease_token = NULL,
              lease_expires_at = NULL, next_attempt_at = $3,
              last_failure_code = $4, updated_at = clock_timestamp()
        WHERE job_id = $1 AND lease_token = $2 AND status = 'RUNNING'`,
      [input.jobId, input.leaseToken, input.nextAttemptAt, input.code],
    );
  }

  async completeUnresolved(input: {
    readonly jobId: string;
    readonly leaseToken: string;
    readonly code: 'INSUFFICIENT_EVIDENCE' | 'QUALIFIER_NOT_MODELED';
  }): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE vp.relation_jobs
          SET status = 'COMPLETED', lease_token = NULL,
              lease_expires_at = NULL, next_attempt_at = NULL,
              last_failure_code = $3, updated_at = clock_timestamp()
        WHERE job_id = $1 AND lease_token = $2 AND status = 'RUNNING'`,
      [input.jobId, input.leaseToken, input.code],
    );
    return Boolean(result.rowCount);
  }
}
