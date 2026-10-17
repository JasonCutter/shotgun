import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import {
  isProductExplicitNegativeRevision,
  type DurableExplicitNegativeOutput,
} from '../../../modules/vp-decision/src/explicit-negative-isolated.js';
import { validProductExplicitNegativeOutput } from '../../vp-decision-general-ai/src/explicit-negative-durable-isolated.js';
import type {
  VPRecordedNoEdgeOutcome,
  VPRelationJobDecision,
} from '../../../modules/vp-knowledge-ledger/src/index.js';
import { stableJson } from '../../../packages/contracts/src/index.js';
import { withSafePostgresTransaction } from '../../../packages/postgres-transaction/src/index.js';
import { PostgresCandidateFrontier } from './frontier-store.js';
import { currentRelationPairReadModel, PostgresVPRelationJobs } from './relation-jobs.js';

type Job = QueryResultRow & {
  job_id: string;
  project_id: string;
  policy_revision: string;
  left_assertion_id: string;
  right_assertion_id: string;
  status: string;
  lease_token: string | null;
  lease_active: boolean;
  last_failure_code: string | null;
};
type Call = QueryResultRow & {
  call_id: string;
  request_digest: string;
  provider_identity: string;
  global_claim_id: string | null;
  semantic_attempt_id: string | null;
  output_json: DurableExplicitNegativeOutput;
};

/** Opt-in isolated knowledge writer; normal v6 and old execution-only results remain separate. */
export class PostgresIsolatedNegativeKnowledgeJobs extends PostgresVPRelationJobs<DurableExplicitNegativeOutput> {
  constructor(
    private readonly isolatedPool: Pool,
    mode: 'ISOLATED_FAKE',
    private readonly revision: string,
    private readonly projectId: string,
  ) {
    if (
      mode !== 'ISOLATED_FAKE' ||
      !isProductExplicitNegativeRevision(revision) ||
      !projectId.trim()
    )
      throw new Error('Explicit isolated negative product identity is required.');
    const database =
      isolatedPool.options.database ??
      (isolatedPool.options.connectionString
        ? decodeURIComponent(new URL(isolatedPool.options.connectionString).pathname.slice(1))
        : undefined);
    if (!database || !/^shotgun_test_[a-z0-9_]+$/.test(database))
      throw new Error('Negative product knowledge requires an isolated child test database.');
    super(isolatedPool, 100, 3, true, true, (value) =>
      validProductExplicitNegativeOutput(value, revision),
    );
  }

  async bindPolicy(input: {
    expectedPreviousRevision: string | null;
  }): Promise<{ revision: string; epoch: string }> {
    return withSafePostgresTransaction(
      this.isolatedPool,
      async (client) => {
        await client.query(
          'INSERT INTO vp.project_epochs(project_id,current_epoch) VALUES($1,0) ON CONFLICT DO NOTHING',
          [this.projectId],
        );
        const row = (
          await client.query<{ current_epoch: string; relation_policy_revision: string | null }>(
            'SELECT current_epoch::text,relation_policy_revision FROM vp.project_epochs WHERE project_id=$1 FOR UPDATE',
            [this.projectId],
          )
        ).rows[0]!;
        if (row.relation_policy_revision === this.revision)
          return { revision: this.revision, epoch: row.current_epoch };
        if (row.relation_policy_revision !== input.expectedPreviousRevision)
          throw new Error('Negative product policy binding compare-and-set mismatch.');
        const reused = await client.query(
          "SELECT 1 FROM vp.history_events WHERE project_id=$1 AND event_kind='RELATION_POLICY_BOUND' AND policy_revision=$2",
          [this.projectId, this.revision],
        );
        if (reused.rowCount)
          throw new Error('A previously admitted policy revision cannot be reused.');
        const updated = (
          await client.query<{ current_epoch: string }>(
            'UPDATE vp.project_epochs SET relation_policy_revision=$2,current_epoch=current_epoch+1,updated_at=clock_timestamp() WHERE project_id=$1 RETURNING current_epoch::text',
            [this.projectId, this.revision],
          )
        ).rows[0]!;
        await client.query(
          "INSERT INTO vp.history_events(event_id,project_id,epoch,event_kind,assertion_id,relation_ids,policy_revision) VALUES($1,$2,$3,'RELATION_POLICY_BOUND',NULL,'{}',$4)",
          [randomUUID(), this.projectId, updated.current_epoch, this.revision],
        );
        return { revision: this.revision, epoch: updated.current_epoch };
      },
      { module: 'vp-knowledge-postgres', operation: 'bind-isolated-relation-policy' },
    );
  }

  private requireRevision(revision: string): void {
    if (revision !== this.revision) throw new Error('Negative product policy revision mismatch.');
  }

  private async admitted(): Promise<boolean> {
    return (
      (
        await this.isolatedPool.query(
          'SELECT 1 FROM vp.project_epochs WHERE project_id=$1 AND relation_policy_revision=$2',
          [this.projectId, this.revision],
        )
      ).rowCount === 1
    );
  }

  override async enqueueCurrentPairs(revision: string, limit = 32): Promise<number> {
    this.requireRevision(revision);
    return (await this.admitted()) ? super.enqueueCurrentPairs(revision, limit, this.projectId) : 0;
  }

  override async ensureCurrentFrontier(revision: string): Promise<void> {
    this.requireRevision(revision);
    if (!(await this.admitted())) return;
    await this.enqueueCurrentPairs(revision, 0);
    await new PostgresCandidateFrontier(this.isolatedPool, 3).ensure(revision, this.projectId);
  }

  override async claimNext(revision: string) {
    this.requireRevision(revision);
    return (await this.admitted()) ? super.claimNext(revision, this.projectId) : undefined;
  }

  override async recoverExpiredExecutions(): Promise<void> {
    return super.recoverExpiredExecutions(this.projectId);
  }

  override async completeDecision(input: VPRelationJobDecision): Promise<boolean> {
    return this.finish({ jobId: input.jobId, leaseToken: input.leaseToken, positive: input });
  }

  async completeRecordedNoEdge(input: {
    jobId: string;
    leaseToken: string;
    outcome: VPRecordedNoEdgeOutcome;
  }): Promise<boolean> {
    return this.finish(input);
  }

  private async storedCall(client: PoolClient, job: Job): Promise<Call | undefined> {
    const calls = (
      await client.query<Call>(
        "SELECT call_id::text,request_digest,provider_identity,global_claim_id::text,semantic_attempt_id::text,output_json FROM vp.relation_provider_calls WHERE project_id=$1 AND job_id=$2 AND state='OUTPUT_STORED'",
        [this.projectId, job.job_id],
      )
    ).rows;
    const call = calls[0];
    if (
      calls.length !== 1 ||
      !call ||
      !call.global_claim_id ||
      !call.semantic_attempt_id ||
      !validProductExplicitNegativeOutput(call.output_json, this.revision)
    )
      return undefined;
    const { input, record } = call.output_json;
    if (
      input.projectId !== job.project_id ||
      input.left.assertionId !== job.left_assertion_id ||
      input.right.assertionId !== job.right_assertion_id ||
      call.provider_identity !==
        `${record.providerIdentity.provider}/${record.providerIdentity.model}`
    )
      return undefined;
    return call;
  }

  private async hasReceipt(client: PoolClient, job: Job, call: Call): Promise<boolean> {
    const disposition = call.output_json.record.disposition;
    if (disposition.status !== 'DECIDED' && disposition.status !== 'NO_RELATION')
      return (
        job.last_failure_code ===
        `PRODUCT_${disposition.status === 'UNRESOLVED' ? 'MODEL_ABSTAINED' : disposition.status}`
      );
    const outcome = disposition.declaration.choice;
    const { record } = call.output_json;
    const model = `${record.providerIdentity.provider}/${record.providerObservation!.modelVersion ?? record.providerIdentity.model}`;
    const result = await client.query(
      `SELECT 1 FROM vp.decision_receipts d JOIN vp.history_events h ON h.project_id=d.project_id AND h.decision_id=d.decision_id
       WHERE d.project_id=$1 AND d.provider_call_id=$2 AND d.policy_revision=$3 AND d.input_digest=$4
         AND d.left_assertion_id=$5 AND d.right_assertion_id=$6 AND d.outcome=$7
         AND d.method='GENERAL_AI' AND d.task_kind='SEMANTIC_RELATION'
         AND d.confidence=$8 AND d.provider_model=$9 AND d.input_tokens=$10 AND d.output_tokens=$11
         AND h.assertion_id=d.left_assertion_id
         AND (($7='NO_RELATION' AND h.event_kind='SEMANTIC_NO_RELATION_RECORDED' AND cardinality(h.relation_ids)=0)
           OR ($7<>'NO_RELATION' AND h.event_kind='SEMANTIC_RELATION_RECORDED' AND cardinality(h.relation_ids)=1 AND EXISTS(SELECT 1 FROM vp.relations r WHERE r.project_id=d.project_id AND r.decision_id=d.decision_id AND r.relation_kind=$7 AND r.left_assertion_id=$5 AND r.right_assertion_id=$6 AND r.relation_direction=$12 AND r.relation_id=ANY(h.relation_ids))))`,
      [
        this.projectId,
        call.call_id,
        this.revision,
        call.request_digest,
        job.left_assertion_id,
        job.right_assertion_id,
        outcome,
        disposition.declaration.confidence,
        model,
        record.providerObservation!.inputTokens,
        record.providerObservation!.outputTokens,
        disposition.declaration.direction === 'NONE'
          ? 'UNDIRECTED'
          : disposition.declaration.direction,
      ],
    );
    return result.rowCount === 1;
  }

  private async supersede(client: PoolClient, job: Job, code: string): Promise<false> {
    await client.query(
      "UPDATE vp.relation_jobs SET status='SUPERSEDED',lease_token=NULL,lease_expires_at=NULL,next_attempt_at=NULL,last_failure_code=$3,updated_at=clock_timestamp() WHERE job_id=$1 AND project_id=$2 AND status='RUNNING'",
      [job.job_id, this.projectId, code],
    );
    return false;
  }

  private async finish(input: {
    jobId: string;
    leaseToken: string;
    outcome?: VPRecordedNoEdgeOutcome;
    positive?: VPRelationJobDecision;
  }): Promise<boolean> {
    return withSafePostgresTransaction(
      this.isolatedPool,
      async (client) => {
        const binding = (
          await client.query<{ relation_policy_revision: string | null }>(
            'SELECT relation_policy_revision FROM vp.project_epochs WHERE project_id=$1 FOR UPDATE',
            [this.projectId],
          )
        ).rows[0];
        const job = (
          await client.query<Job>(
            'SELECT job.*,lease_expires_at>clock_timestamp() AS lease_active FROM vp.relation_jobs job WHERE job_id=$1 AND project_id=$2 FOR UPDATE',
            [input.jobId, this.projectId],
          )
        ).rows[0];
        if (!job || job.policy_revision !== this.revision) return false;
        const call = await this.storedCall(client, job);
        if (!call) return false;
        const { record } = call.output_json;
        const d = record.disposition;
        if (d.status === 'OUTCOME_UNKNOWN') return false;
        const outcome = d.status === 'UNRESOLVED' ? 'MODEL_ABSTAINED' : d.status;
        const model = `${record.providerIdentity.provider}/${record.providerObservation!.modelVersion ?? record.providerIdentity.model}`;
        if (input.positive) {
          if (
            d.status !== 'DECIDED' ||
            stableJson(input.positive) !==
              stableJson({
                jobId: input.jobId,
                leaseToken: input.leaseToken,
                provider: 'GENERAL_AI',
                choice: d.declaration.choice,
                direction:
                  d.declaration.direction === 'NONE' ? 'UNDIRECTED' : d.declaration.direction,
                confidence: d.declaration.confidence,
                model,
                inputTokens: record.providerObservation!.inputTokens,
                outputTokens: record.providerObservation!.outputTokens,
              })
          )
            throw new Error('Product positive decision does not match its stored output.');
        } else if (input.outcome !== outcome)
          throw new Error('Product no-edge disposition does not match its stored output.');
        if (job.status === 'COMPLETED') return this.hasReceipt(client, job, call);
        if (job.status !== 'RUNNING' || job.lease_token !== input.leaseToken || !job.lease_active)
          return false;
        if (binding?.relation_policy_revision !== this.revision)
          return this.supersede(client, job, 'RELATION_POLICY_SUPERSEDED');
        // Existing intake/version writers lock these same Source rows. Hold them
        // through commit so the authoritative current-pair read cannot race v2.
        await client.query(
          `SELECT source.source_id FROM asset.sources AS source
           WHERE source.project_id=$1 AND source.source_id IN (
             SELECT source_id FROM vp.assertions WHERE project_id=$1 AND assertion_id IN ($2,$3))
           ORDER BY source.source_id FOR UPDATE`,
          [this.projectId, job.left_assertion_id, job.right_assertion_id],
        );
        const snapshot = (
          await client.query<Parameters<typeof currentRelationPairReadModel.assertion>[0]>(
            `SELECT ${currentRelationPairReadModel.projection} FROM vp.relation_jobs job ${currentRelationPairReadModel.joins} WHERE job.job_id=$1 AND (reset_epoch.state IS NULL OR reset_epoch.state='READY')`,
            [job.job_id],
          )
        ).rows[0];
        if (!snapshot) return this.supersede(client, job, 'SOURCE_VERSION_SUPERSEDED');
        for (const side of ['left', 'right'] as const) {
          const current = currentRelationPairReadModel.assertion(snapshot, side),
            captured = call.output_json.input[side];
          const expected = {
            assertionId: current.assertionId,
            sourceVersionId: current.sourceVersionId,
            evidenceId: current.evidenceId,
            text: current.claimText,
            accessScope: current.accessScope,
            sensitivity: current.sensitivity,
            ...(current.evidenceContext === undefined
              ? {}
              : {
                  evidenceContext: current.evidenceContext,
                  evidenceContextTruncated: current.evidenceContextTruncated ?? false,
                }),
          };
          if (stableJson(captured) !== stableJson(expected))
            throw new Error('Product stored input differs from current authoritative Evidence.');
        }
        if (d.status !== 'DECIDED' && d.status !== 'NO_RELATION') {
          await client.query(
            "UPDATE vp.relation_jobs SET status='COMPLETED',lease_token=NULL,lease_expires_at=NULL,next_attempt_at=NULL,last_failure_code=$3,updated_at=clock_timestamp() WHERE job_id=$1 AND project_id=$2",
            [job.job_id, this.projectId, `PRODUCT_${outcome}`],
          );
          return true;
        }
        const exact = await client.query(
          "SELECT 1 FROM vp.relations r JOIN vp.decision_receipts d USING(project_id,decision_id) WHERE r.project_id=$1 AND r.left_assertion_id=$2 AND r.right_assertion_id=$3 AND r.relation_kind='EQUIVALENT' AND d.method='DETERMINISTIC' AND d.task_kind='EXACT_TEXT_EQUIVALENCE'",
          [this.projectId, job.left_assertion_id, job.right_assertion_id],
        );
        if (exact.rowCount)
          return this.supersede(client, job, 'DETERMINISTIC_EQUIVALENCE_PRESERVED');
        const conflict = await client.query(
          "SELECT 1 FROM vp.decision_receipts WHERE project_id=$1 AND left_assertion_id=$2 AND right_assertion_id=$3 AND policy_revision=$4 AND task_kind='SEMANTIC_RELATION'",
          [this.projectId, job.left_assertion_id, job.right_assertion_id, this.revision],
        );
        if (conflict.rowCount)
          throw new Error('Product receipt conflict requires exact authoritative readback.');
        const decisionId = randomUUID(),
          relationIds: string[] = [];
        await client.query(
          "INSERT INTO vp.decision_receipts(decision_id,project_id,method,task_kind,policy_revision,input_digest,outcome,left_assertion_id,right_assertion_id,confidence,provider_model,input_tokens,output_tokens,provider_call_id) VALUES($1,$2,'GENERAL_AI','SEMANTIC_RELATION',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
          [
            decisionId,
            this.projectId,
            this.revision,
            call.request_digest,
            d.declaration.choice,
            job.left_assertion_id,
            job.right_assertion_id,
            d.declaration.confidence,
            model,
            record.providerObservation!.inputTokens,
            record.providerObservation!.outputTokens,
            call.call_id,
          ],
        );
        if (d.status === 'DECIDED') {
          const relationId = randomUUID();
          await client.query(
            'INSERT INTO vp.relations(relation_id,project_id,left_assertion_id,right_assertion_id,relation_kind,relation_direction,decision_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
            [
              relationId,
              this.projectId,
              job.left_assertion_id,
              job.right_assertion_id,
              d.declaration.choice,
              d.declaration.direction === 'NONE' ? 'UNDIRECTED' : d.declaration.direction,
              decisionId,
            ],
          );
          relationIds.push(relationId);
        }
        const epoch = (
          await client.query<{ current_epoch: string }>(
            'UPDATE vp.project_epochs SET current_epoch=current_epoch+1,updated_at=clock_timestamp() WHERE project_id=$1 RETURNING current_epoch::text',
            [this.projectId],
          )
        ).rows[0]!.current_epoch;
        await client.query(
          'INSERT INTO vp.history_events(event_id,project_id,epoch,event_kind,assertion_id,relation_ids,decision_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [
            randomUUID(),
            this.projectId,
            epoch,
            d.status === 'NO_RELATION'
              ? 'SEMANTIC_NO_RELATION_RECORDED'
              : 'SEMANTIC_RELATION_RECORDED',
            job.left_assertion_id,
            relationIds,
            decisionId,
          ],
        );
        await client.query(
          "UPDATE vp.relation_jobs SET status='COMPLETED',lease_token=NULL,lease_expires_at=NULL,next_attempt_at=NULL,last_failure_code=$3,updated_at=clock_timestamp() WHERE job_id=$1 AND project_id=$2",
          [job.job_id, this.projectId, d.status === 'NO_RELATION' ? 'PRODUCT_NO_RELATION' : null],
        );
        return true;
      },
      { module: 'vp-knowledge-postgres', operation: 'publish-isolated-relation-knowledge' },
    );
  }

  override async readDecisionOutcome(input: {
    jobId: string;
    leaseToken: string;
  }): Promise<'COMPLETED' | 'SUPERSEDED' | 'LEASE_ACTIVE' | 'NOT_ACTIVE'> {
    const client = await this.isolatedPool.connect();
    try {
      const job = (
        await client.query<Job>(
          'SELECT job.*,lease_expires_at>clock_timestamp() AS lease_active FROM vp.relation_jobs job WHERE job_id=$1 AND project_id=$2 AND policy_revision=$3',
          [input.jobId, this.projectId, this.revision],
        )
      ).rows[0];
      if (!job) return 'NOT_ACTIVE';
      if (job.status === 'SUPERSEDED') return 'SUPERSEDED';
      if (job.status === 'COMPLETED') {
        const call = await this.storedCall(client, job);
        return call && (await this.hasReceipt(client, job, call)) ? 'COMPLETED' : 'NOT_ACTIVE';
      }
      return job.status === 'RUNNING' && job.lease_token === input.leaseToken && job.lease_active
        ? 'LEASE_ACTIVE'
        : 'NOT_ACTIVE';
    } finally {
      client.release();
    }
  }
}
