import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { withSafePostgresTransaction } from '../../../packages/postgres-transaction/src/index.js';
import type {
  SurferIndexedSource,
  SurferIntakeIdentity,
  SurferIntakeClaim,
  SurferIntakeInboxPort,
  SurferIntakeResume,
  SurferIntakeCursor,
} from '../../../packages/contracts/src/surfer-intake.js';
import { decodeSurferIntakeResume } from '../../../packages/contracts/src/surfer-intake.js';
import type { SurferArtifactRef } from '../../../packages/contracts/src/surfer-knowledge.js';
import { decodeSurferArtifactRef } from '../../../packages/contracts/src/surfer-knowledge.js';
import type { SurferDocumentWorkReceipt } from '../../../packages/contracts/src/surfer-document-work.js';
import {
  assertSurferJson,
  surferDigest,
  surferFailure,
} from '../../../packages/contracts/src/surfer-learning.js';
import { ShotgunError } from '../../../packages/contracts/src/errors.js';
const uuid = /^[a-f0-9-]{36}$/;
/** Only Stage3/outbox-proven metadata enters this inbox. Source authority is rechecked by the worker. */
export class PostgresSurferIntakeInbox implements SurferIntakeInboxPort {
  constructor(private readonly pool: Pool) {}
  async enqueue(input: unknown) {
    assertSurferJson(input);
    const r = input as SurferIndexedSource;
    if (
      !r ||
      Object.keys(r).sort().join(',') !==
        'evidenceCount,projectId,revisionId,sourceId,sourceVersionId' ||
      typeof r.projectId !== 'string' ||
      !r.projectId.length ||
      r.projectId.length > 256 ||
      ![r.sourceId, r.sourceVersionId, r.revisionId].every(
        (x) => typeof x === 'string' && uuid.test(x),
      ) ||
      !Number.isSafeInteger(r.evidenceCount) ||
      r.evidenceCount < 1
    )
      throw surferFailure('Invalid indexed Source event.');
    const digest = surferDigest(r),
      jobId = 'intake:' + digest.slice(7),
      requestId = digest.slice(7);
    try {
      return await withSafePostgresTransaction(
        this.pool,
        async (c) => {
          const proof = await c.query(
            "SELECT p.state FROM evidence.stage4_continuations e JOIN source_product.source_stage3_progress p ON p.project_id=e.project_id AND p.source_id=e.source_id AND p.source_version_id=e.source_version_id AND p.indexing_result_id=e.indexing_result_id JOIN evidence.indexing_results i ON i.indexing_result_id=e.indexing_result_id WHERE e.project_id=$1 AND e.source_id=$2 AND e.source_version_id=$3 AND e.revision_id=$4 AND e.evidence_count=$5 AND i.project_id=e.project_id AND i.source_version_id=e.source_version_id AND i.source_id=e.source_id AND i.revision_id=e.revision_id AND i.evidence_count=e.evidence_count AND i.status='INDEXED'",
            [r.projectId, r.sourceId, r.sourceVersionId, r.revisionId, r.evidenceCount],
          );
          if (!proof.rows[0])
            throw surferFailure('Indexed Source event has no durable Stage3/outbox proof.');
          if (proof.rows[0].state === 'IMAGE_OBSERVATION_COMPLETED')
            return { jobId: null, replayed: false };
          if (proof.rows[0].state !== 'STAGE3_COMPLETED')
            throw surferFailure('Indexed Source event is not complete.');
          const old = await c.query('SELECT event_digest FROM surfer_intake.job WHERE job_id=$1', [
            jobId,
          ]);
          if (old.rows[0]) {
            if (old.rows[0].event_digest !== digest)
              throw surferFailure('Intake event identity differs.');
            return { jobId, replayed: true };
          }
          const row = await c.query(
            "INSERT INTO surfer_intake.job(job_id,request_id,project_id,source_id,source_version_id,revision_id,evidence_count,event_digest,revision,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,'READY') ON CONFLICT DO NOTHING RETURNING job_id",
            [
              jobId,
              requestId,
              r.projectId,
              r.sourceId,
              r.sourceVersionId,
              r.revisionId,
              r.evidenceCount,
              digest,
            ],
          );
          if (!row.rowCount) {
            const prior = await c.query(
              'SELECT job_id,event_digest FROM surfer_intake.job WHERE project_id=$1 AND source_version_id=$2 AND revision_id=$3',
              [r.projectId, r.sourceVersionId, r.revisionId],
            );
            if (prior.rows[0]?.job_id !== jobId || prior.rows[0]?.event_digest !== digest)
              throw surferFailure('Indexed Source identity differs.');
          }
          return { jobId, replayed: !row.rowCount };
        },
        { module: 'surfer.intake', operation: 'enqueue' },
      );
    } catch (error) {
      if (!(error instanceof ShotgunError) || error.code !== 'OUTCOME_UNKNOWN') throw error;
      const found = await this.pool.query(
        'SELECT event_digest FROM surfer_intake.job WHERE job_id=$1',
        [jobId],
      );
      if (found.rows[0]?.event_digest === digest) return { jobId, replayed: true };
      // Only an idempotent metadata transaction is retried. No provider is called here.
      throw new ShotgunError({
        code: 'RETRYABLE_DEPENDENCY',
        safeMessage: 'Intake metadata acknowledgement needs redelivery.',
        module: 'surfer.intake',
        operation: 'enqueue',
        retryable: true,
      });
    }
  }
  async list(projectId: string, sourceIds: readonly string[], cursor: SurferIntakeCursor | null) {
    return withSafePostgresTransaction(
      this.pool,
      async (c) => {
        await c.query('SET TRANSACTION READ ONLY');
        const result = await c.query<{
          job_id: string;
          source_id: string;
          source_version_id: string;
          revision_id: string;
          revision: string;
          state: 'READY' | 'RUNNING' | 'COMPLETED' | 'BLOCKED';
          safe_code: string | null;
          principal_id: string | null;
          run_id: string | null;
          profile_digest: string | null;
          cursor_created_at: string;
          updated_at: Date;
          expired: boolean | null;
        }>(
          `SELECT job_id,source_id,source_version_id,revision_id,revision::text,state,safe_code,principal_id,run_id,profile_digest,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at,updated_at,lease_until<=clock_timestamp() AS expired FROM surfer_intake.job WHERE project_id=$1 AND source_id=ANY($2::uuid[]) AND ($3::timestamptz IS NULL OR (created_at,job_id)<($3::timestamptz,$4::text)) ORDER BY created_at DESC,job_id DESC LIMIT 21`,
          [projectId, sourceIds, cursor?.createdAt ?? null, cursor?.jobId ?? null],
        );
        return result.rows;
      },
      { module: 'surfer.intake', operation: 'list' },
    );
  }
  async claim(
    i: SurferIntakeIdentity,
    resumeInput?: SurferIntakeResume,
  ): Promise<SurferIntakeClaim | null> {
    const resume = resumeInput === undefined ? undefined : decodeSurferIntakeResume(resumeInput);
    assertSurferJson(i);
    if (
      !i.projectId ||
      !uuid.test(i.principalId) ||
      !/^[A-Za-z0-9-]{1,40}$/.test(i.runId) ||
      !/^sha256:[a-f0-9]{64}$/.test(i.profileDigest) ||
      !Number.isSafeInteger(i.leaseMs) ||
      i.leaseMs < 1000
    )
      throw surferFailure('Invalid intake worker identity.');
    return withSafePostgresTransaction(
      this.pool,
      async (c) => {
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended('surfer-intake:'||$1,0))", [
          i.projectId,
        ]);
        const result = await c.query(
          "SELECT *,lease_until<=clock_timestamp() AS expired FROM surfer_intake.job WHERE project_id=$1 AND state IN ('READY','RUNNING') ORDER BY created_at,job_id LIMIT 1 FOR UPDATE",
          [i.projectId],
        );
        const r = result.rows[0];
        if (
          resume &&
          (!r ||
            r.job_id !== resume.jobId ||
            String(r.revision) !== resume.expectedRevision ||
            r.state !== 'RUNNING' ||
            !r.expired ||
            r.principal_id !== i.principalId ||
            r.run_id !== i.runId ||
            r.profile_digest !== i.profileDigest)
        )
          throw new ShotgunError({
            code: 'REVISION_CONFLICT',
            safeMessage: 'Intake work is not resumable with this revision and execution binding.',
            module: 'surfer.intake',
            operation: 'resume',
          });
        if (!r) return null;
        if (
          r.state === 'RUNNING' &&
          (!r.expired ||
            r.principal_id !== i.principalId ||
            r.run_id !== i.runId ||
            r.profile_digest !== i.profileDigest)
        )
          return null;
        const token = randomUUID();
        await c.query(
          "UPDATE surfer_intake.job SET state='RUNNING',revision=revision+1,principal_id=$2,run_id=$3,profile_digest=$4,lease_token=$5,lease_until=clock_timestamp()+($6::bigint*interval '1 millisecond'),updated_at=clock_timestamp() WHERE job_id=$1",
          [r.job_id, i.principalId, i.runId, i.profileDigest, token, i.leaseMs],
        );
        return {
          jobId: r.job_id,
          requestId: r.request_id,
          projectId: r.project_id,
          sourceId: r.source_id,
          sourceVersionId: r.source_version_id,
          revisionId: r.revision_id,
          evidenceCount: r.evidence_count,
          prepared: r.prepared ? decodeSurferArtifactRef(r.prepared) : null,
          token,
        };
      },
      { module: 'surfer.intake', operation: 'claim' },
    );
  }
  private async update(c: SurferIntakeClaim, set: string, args: unknown[]) {
    const r = await this.pool.query(
      `UPDATE surfer_intake.job SET ${set},revision=revision+1,updated_at=clock_timestamp() WHERE job_id=$1 AND project_id=$2 AND state='RUNNING' AND lease_token=$3`,
      [c.jobId, c.projectId, c.token, ...args],
    );
    if (r.rowCount !== 1)
      throw new ShotgunError({
        code: 'REVISION_CONFLICT',
        safeMessage: 'Intake lease changed.',
        module: 'surfer.intake',
        operation: 'ack',
      });
  }
  prepared(c: SurferIntakeClaim, ref: SurferArtifactRef) {
    const p = decodeSurferArtifactRef(ref);
    return this.update(c, 'prepared=$4::jsonb', [JSON.stringify(p)]);
  }
  complete(c: SurferIntakeClaim, receipt: SurferDocumentWorkReceipt) {
    assertSurferJson(receipt);
    if (!c.prepared || surferDigest(c.prepared) !== surferDigest(receipt.prepared))
      throw surferFailure('Intake receipt differs from the prepared job.');
    return this.update(c, "state='COMPLETED',receipt=$4::jsonb,lease_token=NULL,lease_until=NULL", [
      JSON.stringify(receipt),
    ]);
  }
  block(c: SurferIntakeClaim, code: 'WORK_UNAVAILABLE' | 'OUTCOME_UNKNOWN' | 'INCOMPLETE') {
    if (!['WORK_UNAVAILABLE', 'OUTCOME_UNKNOWN', 'INCOMPLETE'].includes(code))
      throw surferFailure('Invalid intake safe code.');
    return this.update(c, "state='BLOCKED',safe_code=$4,lease_token=NULL,lease_until=NULL", [code]);
  }
}
