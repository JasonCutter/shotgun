import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { lockAskCrossReviews } from './ask-cross-review.js';
import { withSafePostgresTransaction } from '../../../packages/postgres-transaction/src/index.js';
import { ShotgunError } from '../../../packages/contracts/src/errors.js';
import {
  assertSurferJson,
  surferDigest,
  surferFailure,
} from '../../../packages/contracts/src/surfer-learning.js';
import {
  decodeSurferMeaningVerificationWork,
  type SurferMeaningVerificationWork,
  type SurferMeaningVerificationResult,
} from '../../../packages/contracts/src/surfer-meaning-verification.js';
import {
  assertSurferMeaningQueueIdentity,
  surferMeaningQueueKey,
  type SurferMeaningQueueInput,
  type SurferMeaningQueueIdentity,
  type SurferMeaningQueueClaim,
  type SurferMeaningQueueMetadata,
  type SurferMeaningQueueCode,
  type SurferMeaningQueuePort,
} from '../../../packages/contracts/src/surfer-meaning-queue.js';
const metadata = (r: {
  job_id: string;
  revision: string;
  state: SurferMeaningQueueMetadata['state'];
  code: SurferMeaningQueueCode | null;
}): SurferMeaningQueueMetadata => ({
  jobId: r.job_id,
  revision: String(r.revision),
  state: r.state,
  code: r.code,
});
const conflict = () =>
  new ShotgunError({
    code: 'REVISION_CONFLICT',
    safeMessage: 'Meaning review claim or immutable pin changed.',
    module: 'surfer.meaning',
    operation: 'queue',
  });
export class PostgresSurferMeaningQueue implements SurferMeaningQueuePort {
  constructor(private readonly pool: Pool) {}
  async inspect(i: SurferMeaningQueueIdentity, input: SurferMeaningQueueInput) {
    const key = surferMeaningQueueKey(i, input),
      r = (
        await this.pool.query(
          'SELECT job_id,revision::text,state,code,request_digest FROM surfer_meaning.job WHERE job_id=$1 AND project_id=$2 AND principal_id=$3 AND run_id=$4 AND profile_digest=$5',
          [key.jobId, i.projectId, i.principalId, i.runId, i.profileDigest],
        )
      ).rows[0];
    if (r && r.request_digest !== key.requestDigest) throw conflict();
    return r ? metadata(r) : null;
  }
  async enqueue(i: SurferMeaningQueueIdentity, input: SurferMeaningVerificationWork) {
    assertSurferMeaningQueueIdentity(i);
    const work = decodeSurferMeaningVerificationWork(input);
    if (
      work.basis.authority.projectId !== i.projectId ||
      work.basis.authority.principalId !== i.principalId ||
      work.profileDigest !== i.profileDigest
    )
      throw conflict();
    const request = {
        reference: {
          attemptId: work.proposal.attemptId,
          candidateIndex: work.proposal.candidateIndex,
        },
        selections: work.selections,
      },
      key = surferMeaningQueueKey(i, request);
    try {
      return await withSafePostgresTransaction(
        this.pool,
        async (c) => {
          await lockAskCrossReviews(c, i.projectId);
          const added = await c.query(
            "INSERT INTO surfer_meaning.job(job_id,request_digest,project_id,principal_id,run_id,profile_digest,proposal_attempt_id,proposal_digest,candidate_index,work,work_digest,revision,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,1,'READY') ON CONFLICT(job_id) DO NOTHING RETURNING job_id",
            [
              key.jobId,
              key.requestDigest,
              i.projectId,
              i.principalId,
              i.runId,
              i.profileDigest,
              work.proposal.attemptId,
              work.proposal.receiptDigest,
              work.proposal.candidateIndex,
              JSON.stringify(work),
              work.digest,
            ],
          );
          const row = (
            await c.query('SELECT * FROM surfer_meaning.job WHERE job_id=$1', [key.jobId])
          ).rows[0];
          if (
            !row ||
            row.request_digest !== key.requestDigest ||
            row.proposal_digest !== work.proposal.receiptDigest
          )
            throw conflict();
          return { ...metadata(row), replayed: !added.rowCount };
        },
        { module: 'surfer.meaning', operation: 'enqueue' },
      );
    } catch (e) {
      if (!(e instanceof ShotgunError) || e.code !== 'OUTCOME_UNKNOWN') throw e;
      const prior = await this.inspect(i, request);
      if (prior) return { ...prior, replayed: true };
      throw e;
    }
  }
  async claim(i: SurferMeaningQueueIdentity): Promise<SurferMeaningQueueClaim | null> {
    assertSurferMeaningQueueIdentity(i);
    return withSafePostgresTransaction(
      this.pool,
      async (c) => {
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended('surfer-meaning:'||$1,0))", [
          i.projectId,
        ]);
        const row = (
          await c.query(
            "SELECT *,lease_until<=clock_timestamp() AS expired FROM surfer_meaning.job WHERE project_id=$1 AND principal_id=$2 AND run_id=$3 AND profile_digest=$4 AND state IN ('READY','RUNNING') ORDER BY created_at,job_id LIMIT 1 FOR UPDATE",
            [i.projectId, i.principalId, i.runId, i.profileDigest],
          )
        ).rows[0];
        if (!row || (row.state === 'RUNNING' && !row.expired)) return null;
        const token = randomUUID(),
          claimed = (
            await c.query(
              "UPDATE surfer_meaning.job SET state='RUNNING',revision=revision+1,lease_token=$2,lease_until=clock_timestamp()+($3::bigint*interval '1 millisecond') WHERE job_id=$1 RETURNING revision::text",
              [row.job_id, token, i.leaseMs],
            )
          ).rows[0];
        const work = decodeSurferMeaningVerificationWork(row.work);
        if (work.digest !== row.work_digest) throw conflict();
        return { jobId: row.job_id, revision: claimed.revision, token, work };
      },
      { module: 'surfer.meaning', operation: 'claim' },
    );
  }
  private async finish(
    claim: SurferMeaningQueueClaim,
    code: SurferMeaningQueueCode | null,
    result: SurferMeaningVerificationResult | null,
  ) {
    assertSurferJson(claim);
    if (
      !/^meaning:[a-f0-9]{64}$/.test(claim.jobId) ||
      !/^[1-9][0-9]{0,18}$/.test(claim.revision) ||
      !/^[-a-f0-9]{36}$/.test(claim.token)
    )
      throw conflict();
    const work = decodeSurferMeaningVerificationWork(claim.work),
      state = code ? 'BLOCKED' : 'COMPLETED';
    if (result) {
      assertSurferJson(result);
      const { digest: _digest, ...body } = result;
      if (
        result.workDigest !== work.digest ||
        result.digest !== surferDigest(body) ||
        surferDigest(result.proposal) !== surferDigest(work.proposal) ||
        result.effect !== 'NO_RULE_OR_KNOWLEDGE_CHANGE' ||
        result.semanticAssessment !== 'MODEL_REVIEW_NOT_TRUTH_VALIDATED' ||
        JSON.stringify(result).length > 60000
      )
        throw surferFailure('Invalid unverified meaning queue result.');
    }
    const matches = (r: {
      state: string;
      code: string | null;
      work_digest: string;
      result_digest: string | null;
    }) =>
      r.state === state &&
      r.code === code &&
      r.work_digest === work.digest &&
      r.result_digest === (result?.digest ?? null);
    try {
      await withSafePostgresTransaction(
        this.pool,
        async (c) => {
          await lockAskCrossReviews(c, work.basis.authority.projectId);
          const old = (
            await c.query('SELECT * FROM surfer_meaning.job WHERE job_id=$1 FOR UPDATE', [
              claim.jobId,
            ])
          ).rows[0];
          if (old && matches(old)) return;
          const row = await c.query(
            "UPDATE surfer_meaning.job SET revision=revision+1,state=$5,lease_token=NULL,lease_until=NULL,code=$6,result=$7::jsonb,result_digest=$8 WHERE job_id=$1 AND revision=$2::bigint AND lease_token=$3::uuid AND work_digest=$4 AND state='RUNNING' AND lease_until>clock_timestamp() RETURNING job_id",
            [
              claim.jobId,
              claim.revision,
              claim.token,
              work.digest,
              state,
              code,
              result ? JSON.stringify(result) : null,
              result?.digest ?? null,
            ],
          );
          if (!row.rowCount) throw conflict();
        },
        { module: 'surfer.meaning', operation: code ? 'block' : 'complete' },
      );
    } catch (e) {
      if (!(e instanceof ShotgunError) || e.code !== 'OUTCOME_UNKNOWN') throw e;
      const r = (
        await this.pool.query(
          'SELECT state,code,work_digest,result_digest FROM surfer_meaning.job WHERE job_id=$1',
          [claim.jobId],
        )
      ).rows[0];
      if (r && matches(r)) return;
      throw e;
    }
  }
  complete(c: SurferMeaningQueueClaim, r: SurferMeaningVerificationResult) {
    return this.finish(c, null, r);
  }
  block(c: SurferMeaningQueueClaim, code: SurferMeaningQueueCode) {
    if (!['WORK_UNAVAILABLE', 'OUTCOME_UNKNOWN', 'INCOMPLETE'].includes(code)) throw conflict();
    return this.finish(c, code, null);
  }
}
