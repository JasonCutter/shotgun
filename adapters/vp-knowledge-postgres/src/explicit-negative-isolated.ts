import type { Pool } from 'pg';
import {
  EXPLICIT_NEGATIVE_ISOLATED_REVISION,
  type DurableExplicitNegativeOutput,
} from '../../../modules/vp-decision/src/explicit-negative-isolated.js';
import type { VPRecordedNoEdgeOutcome } from '../../../modules/vp-knowledge-ledger/src/index.js';
import { withSafePostgresTransaction } from '../../../packages/postgres-transaction/src/index.js';
import { PostgresVPRelationJobs } from './relation-jobs.js';

/** Uses the existing call ledger, not a new negative knowledge/Fact authority. */
export class PostgresIsolatedExplicitNegativeJobs extends PostgresVPRelationJobs<DurableExplicitNegativeOutput> {
  constructor(
    private readonly isolatedPool: Pool,
    mode: 'ISOLATED_FAKE',
    private readonly validateOutput: (output: DurableExplicitNegativeOutput) => boolean,
    private readonly projectId: string,
  ) {
    if (mode !== 'ISOLATED_FAKE') throw new Error('Isolated Fake mode is required.');
    if (!projectId.trim()) throw new Error('An isolated project identity is required.');
    const database =
      isolatedPool.options.database ??
      (isolatedPool.options.connectionString
        ? new URL(isolatedPool.options.connectionString).pathname.slice(1)
        : undefined);
    if (!database || !/^shotgun_test_[a-z0-9_]+$/.test(database))
      throw new Error('An isolated child test database is required.');
    super(isolatedPool, 100, 3, true, false, validateOutput);
  }

  override async enqueueCurrentPairs(revision: string, limit = 32): Promise<number> {
    if (revision !== EXPLICIT_NEGATIVE_ISOLATED_REVISION)
      throw new Error('Isolated policy revision mismatch.');
    return super.enqueueCurrentPairs(revision, limit);
  }

  override async claimNext(revision: string) {
    if (revision !== EXPLICIT_NEGATIVE_ISOLATED_REVISION)
      throw new Error('Isolated policy revision mismatch.');
    return super.claimNext(revision, this.projectId);
  }

  async completeRecordedNoEdge(input: {
    readonly jobId: string;
    readonly leaseToken: string;
    readonly outcome: VPRecordedNoEdgeOutcome;
  }): Promise<boolean> {
    return withSafePostgresTransaction(
      this.isolatedPool,
      async (client) => {
        const result = await client.query<{
          project_id: string;
          policy_revision: string;
          status: string;
          lease_token: string | null;
          lease_active: boolean;
          last_failure_code: string | null;
          left_assertion_id: string;
          right_assertion_id: string;
          current_pair: boolean;
        }>(
          `SELECT job.*, lease_expires_at > clock_timestamp() AS lease_active,
          EXISTS(SELECT 1 FROM vp.current_assertions l JOIN vp.current_assertions r ON r.project_id=l.project_id
            WHERE l.project_id=job.project_id AND l.assertion_id=job.left_assertion_id AND r.assertion_id=job.right_assertion_id) AS current_pair
          FROM vp.relation_jobs job WHERE job.job_id=$1 FOR UPDATE`,
          [input.jobId],
        );
        const job = result.rows[0];
        if (
          !job ||
          job.project_id !== this.projectId ||
          job.policy_revision !== EXPLICIT_NEGATIVE_ISOLATED_REVISION
        )
          return false;
        const calls = await client.query<{
          output_json: DurableExplicitNegativeOutput;
          global_claim_id: string | null;
          semantic_attempt_id: string | null;
          provider_identity: string;
        }>(
          `SELECT output_json,global_claim_id::text,semantic_attempt_id::text,provider_identity FROM vp.relation_provider_calls WHERE project_id=$1 AND job_id=$2 AND state='OUTPUT_STORED'`,
          [job.project_id, input.jobId],
        );
        if (calls.rows.length !== 1) return false;
        const call = calls.rows[0]!;
        const output = call.output_json;
        if (
          !call.global_claim_id ||
          !call.semantic_attempt_id ||
          !this.validateOutput(output) ||
          call.provider_identity !==
            `${output.record.providerIdentity.provider}/${output.record.providerIdentity.model}` ||
          output.input.projectId !== job.project_id ||
          output.input.left.assertionId !== job.left_assertion_id ||
          output.input.right.assertionId !== job.right_assertion_id
        )
          return false;
        const disposition = output.record.disposition;
        if (disposition.status === 'DECIDED' || disposition.status === 'OUTCOME_UNKNOWN')
          return false;
        const outcome =
          disposition.status === 'UNRESOLVED' ? 'MODEL_ABSTAINED' : disposition.status;
        if (input.outcome !== outcome) return false;
        const code = `ISOLATED_${outcome}`;
        if (job.status === 'COMPLETED') return job.last_failure_code === code;
        if (
          job.status !== 'RUNNING' ||
          job.lease_token !== input.leaseToken ||
          !job.lease_active ||
          !job.current_pair
        )
          return false;
        // No decision_receipts row with a fabricated UNRESOLVED label; no positive edge.
        // storeOutput preserves the first stored output; call_id retains the exact semantic outcome.
        const saved = await client.query(
          `UPDATE vp.relation_jobs SET status='COMPLETED',lease_token=NULL,lease_expires_at=NULL,next_attempt_at=NULL,last_failure_code=$3,updated_at=clock_timestamp() WHERE job_id=$1 AND lease_token=$2 AND status='RUNNING' RETURNING job_id`,
          [input.jobId, input.leaseToken, code],
        );
        return saved.rowCount === 1;
      },
      { module: 'vp-knowledge-postgres', operation: 'complete-isolated-no-edge' },
    );
  }
}
