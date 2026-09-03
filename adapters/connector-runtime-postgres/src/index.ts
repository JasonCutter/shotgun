import { createHash, randomUUID } from 'node:crypto';
import type { Pool, QueryResultRow } from 'pg';

import {
  type AnyEnvelope,
  type ErrorCode,
  ShotgunError,
  toShotgunError,
} from '../../../packages/contracts/src/index.js';
import type {
  AttemptRecord,
  JobRecord,
  JobRunResult,
} from '../../../packages/job-runtime/src/index.js';
import type {
  ConnectorRuntimeStatePort,
  ConnectorSemanticIdentity,
  DeadLetterStorePort,
  DedupBeginResult,
  DedupRecord,
  DedupStorePort,
  JobRuntimePort,
  OrderingStorePort,
  ReplayAuthorization,
} from '../../../packages/connector-runtime/src/ports.js';
import type {
  DeadLetterEntry,
  DeadLetterKind,
  ReplayRecord,
} from '../../../packages/connector-runtime/src/stores.js';
import { withSafePostgresTransaction } from '../../../packages/postgres-transaction/src/index.js';

const json = (value: unknown): string => JSON.stringify(value ?? null);
const parseJson = (value: unknown): unknown =>
  typeof value === 'string' ? JSON.parse(value) : value;
const date = (value: Date | string): string => new Date(value).toISOString();
const payloadDigest = (value: unknown): string =>
  `sha256:${createHash('sha256').update(json(value)).digest('hex')}`;

/** Do not copy protected payloads into the durable DLQ by default. Public
 * envelopes remain replayable; private/restricted data is represented by a
 * digest so an operator can bind an approved external resource reference. */
const safeEnvelopeForPersistence = (envelope: AnyEnvelope): AnyEnvelope => {
  if (
    envelope.security?.sensitivity === 'private' ||
    envelope.security?.sensitivity === 'restricted'
  ) {
    return {
      ...envelope,
      payload: {
        redacted: true,
        payloadDigest: payloadDigest(envelope.payload),
      },
    } as AnyEnvelope;
  }
  return envelope;
};

type DedupRow = QueryResultRow & {
  dedup_record_id: string;
  project_id: string;
  security_scope: string;
  consumer_id: string;
  message_kind: ConnectorSemanticIdentity['messageKind'];
  message_type: string;
  semantic_key: string;
  fingerprint: string;
  state: DedupRecord['state'];
  job_id: string | null;
  fence_token: number | string;
  result: unknown;
  safe_error_code: string | null;
  safe_error_message: string | null;
  created_at: Date;
  updated_at: Date;
};

const dedupFromRow = <TResult>(row: DedupRow): DedupRecord<TResult> => ({
  projectId: row.project_id,
  securityScope: row.security_scope,
  consumerId: row.consumer_id,
  messageKind: row.message_kind,
  messageType: row.message_type,
  semanticKey: row.semantic_key,
  fingerprint: row.fingerprint,
  state: row.state,
  ...(row.job_id ? { jobId: row.job_id } : {}),
  fenceToken: Number(row.fence_token),
  ...(row.result !== null && row.result !== undefined
    ? { result: parseJson(row.result) as TResult }
    : {}),
  ...(row.safe_error_code ? { safeErrorCode: row.safe_error_code } : {}),
  ...(row.safe_error_message ? { safeErrorMessage: row.safe_error_message } : {}),
  createdAt: date(row.created_at),
  updatedAt: date(row.updated_at),
});

const identityWhere = (identity: ConnectorSemanticIdentity): readonly unknown[] => [
  identity.projectId,
  identity.securityScope,
  identity.consumerId,
  identity.messageKind,
  identity.messageType,
  identity.semanticKey,
];

export class PostgresDedupStore implements DedupStorePort {
  constructor(private readonly pool: Pool) {}

  async begin<TResult>(
    input: ConnectorSemanticIdentity & { readonly jobId: string },
  ): Promise<DedupBeginResult<TResult>> {
    const inserted = await this.pool.query<DedupRow>(
      `INSERT INTO connector.dedup_records
       (dedup_record_id, project_id, security_scope, consumer_id, message_kind,
        message_type, semantic_key, fingerprint, state, job_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'IN_PROGRESS',$9,clock_timestamp(),clock_timestamp())
       ON CONFLICT (project_id, security_scope, consumer_id, message_kind, message_type, semantic_key)
       DO NOTHING
       RETURNING *`,
      [randomUUID(), ...identityWhere(input), input.fingerprint, input.jobId],
    );
    if (inserted.rows[0])
      return { kind: 'ACQUIRED', record: dedupFromRow<TResult>(inserted.rows[0]) };

    const existing = await this.pool.query<DedupRow>(
      `SELECT * FROM connector.dedup_records
       WHERE project_id=$1 AND security_scope=$2 AND consumer_id=$3
         AND message_kind=$4 AND message_type=$5 AND semantic_key=$6
       FOR UPDATE`,
      [...identityWhere(input)],
    );
    const row = existing.rows[0];
    if (!row)
      throw new ShotgunError({
        code: 'OUTCOME_UNKNOWN',
        safeMessage: 'The durable deduplication record could not be read.',
        module: 'connector-runtime-postgres',
        operation: 'dedup-begin',
      });
    const record = dedupFromRow<TResult>(row);
    if (row.fingerprint !== input.fingerprint) return { kind: 'CONFLICT', record };
    if (row.state === 'FAILED') {
      const updated = await this.pool.query<DedupRow>(
        `UPDATE connector.dedup_records
         SET state='IN_PROGRESS', job_id=$7, fence_token=fence_token+1,
             safe_error_code=NULL, safe_error_message=NULL, result=NULL,
             updated_at=clock_timestamp(), completed_at=NULL
         WHERE project_id=$1 AND security_scope=$2 AND consumer_id=$3
           AND message_kind=$4 AND message_type=$5 AND semantic_key=$6
         RETURNING *`,
        [...identityWhere(input), input.jobId],
      );
      return { kind: 'ACQUIRED', record: dedupFromRow<TResult>(updated.rows[0]!) };
    }
    return { kind: 'DUPLICATE', record };
  }

  async complete<TResult>(input: {
    readonly identity: ConnectorSemanticIdentity;
    readonly fenceToken: number;
    readonly jobId: string;
    readonly result: TResult;
  }): Promise<void> {
    await this.pool.query(
      `UPDATE connector.dedup_records
       SET state='COMPLETED', result=$7::jsonb, updated_at=clock_timestamp(),
           completed_at=clock_timestamp()
       WHERE project_id=$1 AND security_scope=$2 AND consumer_id=$3
         AND message_kind=$4 AND message_type=$5 AND semantic_key=$6
         AND fence_token=$8 AND job_id=$9 AND state='IN_PROGRESS'`,
      [...identityWhere(input.identity), json(input.result), input.fenceToken, input.jobId],
    );
  }

  async fail(input: {
    readonly identity: ConnectorSemanticIdentity;
    readonly fenceToken: number;
    readonly jobId: string;
    readonly safeErrorCode: string;
    readonly safeErrorMessage: string;
  }): Promise<void> {
    await this.pool.query(
      `UPDATE connector.dedup_records
       SET state='FAILED', safe_error_code=$7, safe_error_message=$8,
           updated_at=clock_timestamp(), completed_at=clock_timestamp()
       WHERE project_id=$1 AND security_scope=$2 AND consumer_id=$3
         AND message_kind=$4 AND message_type=$5 AND semantic_key=$6
         AND fence_token=$9 AND job_id=$10 AND state='IN_PROGRESS'`,
      [
        ...identityWhere(input.identity),
        input.safeErrorCode,
        input.safeErrorMessage,
        input.fenceToken,
        input.jobId,
      ],
    );
  }

  async markOutcomeUnknown(input: {
    readonly identity: ConnectorSemanticIdentity;
    readonly fenceToken: number;
    readonly jobId: string;
    readonly safeErrorMessage: string;
  }): Promise<void> {
    await this.pool.query(
      `UPDATE connector.dedup_records
       SET state='OUTCOME_UNKNOWN', safe_error_code='OUTCOME_UNKNOWN',
           safe_error_message=$7, updated_at=clock_timestamp(), completed_at=clock_timestamp()
       WHERE project_id=$1 AND security_scope=$2 AND consumer_id=$3
         AND message_kind=$4 AND message_type=$5 AND semantic_key=$6
         AND fence_token=$8 AND job_id=$9 AND state='IN_PROGRESS'`,
      [...identityWhere(input.identity), input.safeErrorMessage, input.fenceToken, input.jobId],
    );
  }

  async reconcile<TResult>(input: {
    readonly identity: ConnectorSemanticIdentity;
    readonly result?: TResult;
    readonly safeErrorCode?: string;
    readonly safeErrorMessage?: string;
  }): Promise<DedupRecord<TResult> | undefined> {
    const updated = await this.pool.query<DedupRow>(
      `UPDATE connector.dedup_records
       SET state=CASE WHEN $7::jsonb IS NULL THEN 'FAILED' ELSE 'COMPLETED' END,
           result=$7::jsonb, safe_error_code=$8, safe_error_message=$9,
           updated_at=clock_timestamp(), completed_at=clock_timestamp()
       WHERE project_id=$1 AND security_scope=$2 AND consumer_id=$3
         AND message_kind=$4 AND message_type=$5 AND semantic_key=$6
         AND state='OUTCOME_UNKNOWN'
       RETURNING *`,
      [
        ...identityWhere(input.identity),
        input.result === undefined ? null : json(input.result),
        input.safeErrorCode ?? null,
        input.safeErrorMessage ?? null,
      ],
    );
    return updated.rows[0] ? dedupFromRow<TResult>(updated.rows[0]) : undefined;
  }

  async get<TResult>(
    identity: ConnectorSemanticIdentity,
  ): Promise<DedupRecord<TResult> | undefined> {
    const result = await this.pool.query<DedupRow>(
      `SELECT * FROM connector.dedup_records
       WHERE project_id=$1 AND security_scope=$2 AND consumer_id=$3
         AND message_kind=$4 AND message_type=$5 AND semantic_key=$6`,
      [...identityWhere(identity)],
    );
    return result.rows[0] ? dedupFromRow<TResult>(result.rows[0]) : undefined;
  }
}

type JobRow = QueryResultRow & {
  job_id: string;
  project_id: string;
  security_scope: string;
  consumer_id: string;
  message_kind: ConnectorSemanticIdentity['messageKind'];
  message_type: string;
  idempotency_key: string;
  fingerprint: string;
  correlation_id: string;
  status: JobRecord['status'] | 'queued' | 'retryable' | 'dead-letter' | 'cancelled';
  attempt_count: number;
  next_attempt_at: Date | null;
  created_at: Date;
  result: unknown;
  safe_error_code: string | null;
  safe_error_message: string | null;
};
type AttemptRow = QueryResultRow & {
  attempt_id: string;
  job_id: string;
  attempt_number: number;
  worker_id: string;
  fencing_token: number | string;
  started_at: Date;
  finished_at: Date | null;
  status: AttemptRecord['status'];
  error_code: ErrorCode | null;
  scheduled_delay_ms: number;
};

const mapJob = (row: JobRow, attempts: readonly AttemptRow[]): JobRecord => ({
  jobId: row.job_id,
  idempotencyKey: row.idempotency_key,
  consumerId: row.consumer_id,
  createdAt: date(row.created_at),
  status:
    row.status === 'queued' || row.status === 'retryable'
      ? 'running'
      : row.status === 'dead-letter' || row.status === 'cancelled'
        ? 'failed'
        : row.status,
  attempts: attempts.map((attempt) => ({
    attemptId: attempt.attempt_id,
    jobId: attempt.job_id,
    attemptNumber: attempt.attempt_number,
    workerId: attempt.worker_id,
    fencingToken: Number(attempt.fencing_token),
    startedAt: date(attempt.started_at),
    ...(attempt.finished_at ? { finishedAt: date(attempt.finished_at) } : {}),
    status: attempt.status,
    ...(attempt.error_code ? { errorCode: attempt.error_code } : {}),
    scheduledDelayMs: attempt.scheduled_delay_ms,
  })),
});

export class PostgresJobRuntime implements JobRuntimePort {
  private readonly workerId = `connector-runtime:${process.pid}:${randomUUID()}`;

  constructor(
    private readonly pool: Pool,
    private readonly maxAttempts = 3,
    private readonly baseDelayMs = 1,
  ) {}

  async enqueue(input: {
    readonly jobId: string;
    readonly dedupRecordId: string;
    readonly identity: ConnectorSemanticIdentity;
    readonly correlationId: string;
  }): Promise<JobRecord> {
    await this.pool.query<JobRow>(
      `INSERT INTO connector.jobs
       (job_id,dedup_record_id,correlation_id,status,created_at,updated_at)
       VALUES ($1,$2,$3,'queued',clock_timestamp(),clock_timestamp())
       ON CONFLICT (job_id) DO UPDATE SET updated_at=clock_timestamp()
       RETURNING *`,
      [input.jobId, input.dedupRecordId, input.correlationId],
    );
    const job = await this.find(input.identity);
    if (!job)
      throw new ShotgunError({
        code: 'OUTCOME_UNKNOWN',
        safeMessage: 'The enqueued job could not be read back.',
        module: 'connector-runtime-postgres',
        operation: 'job-enqueue',
      });
    return job;
  }

  async claim(input: {
    readonly jobId: string;
    readonly leaseOwner: string;
    readonly leaseDurationMs: number;
  }): Promise<{ readonly fencingToken: number; readonly leaseExpiresAt: string } | undefined> {
    const result = await this.pool.query<{
      fencing_token: number | string;
      lease_expires_at: Date;
    }>(
      `UPDATE connector.jobs
       SET status='running', lease_owner=$2,
            lease_expires_at=clock_timestamp() + ($3 * interval '1 millisecond'),
            fencing_token=fencing_token+1, next_attempt_at=NULL, updated_at=clock_timestamp()
        WHERE job_id=$1 AND status IN ('queued','retryable')
          AND (next_attempt_at IS NULL OR next_attempt_at <= clock_timestamp())
          AND (lease_expires_at IS NULL OR lease_expires_at < clock_timestamp())
       RETURNING fencing_token, lease_expires_at`,
      [input.jobId, input.leaseOwner, input.leaseDurationMs],
    );
    const row = result.rows[0];
    return row
      ? { fencingToken: Number(row.fencing_token), leaseExpiresAt: date(row.lease_expires_at) }
      : undefined;
  }

  async renew(input: {
    readonly jobId: string;
    readonly leaseOwner: string;
    readonly fencingToken: number;
    readonly leaseDurationMs: number;
  }): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE connector.jobs
       SET lease_expires_at=clock_timestamp() + ($4 * interval '1 millisecond'), updated_at=clock_timestamp()
       WHERE job_id=$1 AND lease_owner=$2 AND fencing_token=$3 AND status='running'`,
      [input.jobId, input.leaseOwner, input.fencingToken, input.leaseDurationMs],
    );
    return result.rowCount === 1;
  }

  async complete(input: {
    readonly jobId: string;
    readonly fencingToken: number;
    readonly result: unknown;
  }): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE connector.jobs SET status='succeeded', result=$3::jsonb,
       attempt_count=attempt_count+1, safe_error_code=NULL, safe_error_message=NULL,
       lease_owner=NULL, lease_expires_at=NULL, updated_at=clock_timestamp()
       WHERE job_id=$1 AND fencing_token=$2 AND status='running'`,
      [input.jobId, input.fencingToken, json(input.result)],
    );
    return result.rowCount === 1;
  }

  async retry(input: {
    readonly jobId: string;
    readonly fencingToken: number;
    readonly nextAttemptAt: string;
    readonly safeErrorCode: string;
    readonly safeErrorMessage: string;
  }): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE connector.jobs SET status='retryable', next_attempt_at=$3,
       attempt_count=attempt_count+1,
       safe_error_code=$4, safe_error_message=$5,
       lease_owner=NULL, lease_expires_at=NULL, updated_at=clock_timestamp()
       WHERE job_id=$1 AND fencing_token=$2 AND status='running'`,
      [
        input.jobId,
        input.fencingToken,
        input.nextAttemptAt,
        input.safeErrorCode,
        input.safeErrorMessage,
      ],
    );
    return result.rowCount === 1;
  }

  async terminal(input: {
    readonly jobId: string;
    readonly fencingToken: number;
    readonly status: 'failed' | 'outcome-unknown' | 'dead-letter';
    readonly safeErrorCode: string;
    readonly safeErrorMessage: string;
  }): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE connector.jobs SET status=$3, attempt_count=attempt_count+1,
       safe_error_code=$4,
       safe_error_message=$5, lease_owner=NULL, lease_expires_at=NULL,
       updated_at=clock_timestamp()
       WHERE job_id=$1 AND fencing_token=$2 AND status='running'`,
      [input.jobId, input.fencingToken, input.status, input.safeErrorCode, input.safeErrorMessage],
    );
    return result.rowCount === 1;
  }

  async cancel(input: { readonly jobId: string; readonly fencingToken: number }): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE connector.jobs SET status='cancelled', lease_owner=NULL,
       lease_expires_at=NULL, updated_at=clock_timestamp()
       WHERE job_id=$1 AND fencing_token=$2 AND status IN ('queued','running')`,
      [input.jobId, input.fencingToken],
    );
    return result.rowCount === 1;
  }

  async run<TResult>(
    identity: ConnectorSemanticIdentity,
    correlationId: string,
    operation: (attempt: AttemptRecord) => Promise<TResult>,
  ): Promise<JobRunResult<TResult>> {
    const dedup = await this.pool.query<{ dedup_record_id: string; job_id: string }>(
      `SELECT dedup_record_id, job_id FROM connector.dedup_records
       WHERE project_id=$1 AND security_scope=$2 AND consumer_id=$3
         AND message_kind=$4 AND message_type=$5 AND semantic_key=$6
         AND fingerprint=$7`,
      [
        identity.projectId,
        identity.securityScope,
        identity.consumerId,
        identity.messageKind,
        identity.messageType,
        identity.semanticKey,
        identity.fingerprint,
      ],
    );
    if (!dedup.rows[0])
      throw new ShotgunError({
        code: 'OUTCOME_UNKNOWN',
        safeMessage: 'The job is missing its semantic deduplication record.',
        module: 'connector-runtime-postgres',
        operation: 'job-run',
        correlationId,
      });
    await this.pool.query(
      `INSERT INTO connector.jobs
       (job_id,dedup_record_id,correlation_id,status,created_at,updated_at)
       VALUES ($1,$2,$3,'queued',clock_timestamp(),clock_timestamp())
       ON CONFLICT (job_id) DO NOTHING`,
      [dedup.rows[0].job_id, dedup.rows[0].dedup_record_id, correlationId],
    );
    const current = await this.findJobRow(identity);
    if (!current) {
      throw new ShotgunError({
        code: 'OUTCOME_UNKNOWN',
        safeMessage: 'The durable job could not be read back.',
        module: 'connector-runtime-postgres',
        operation: 'job-run',
        correlationId,
      });
    }
    const jobId = current.job_id;
    const priorAttempts = Number(current.attempt_count ?? 0);
    const remainingAttempts = Math.max(0, this.maxAttempts - priorAttempts);
    if (remainingAttempts === 0) {
      throw new ShotgunError({
        code: 'TERMINAL_FAILURE',
        safeMessage: 'The durable retry policy has been exhausted.',
        module: identity.consumerId,
        operation: 'job-run',
        correlationId,
      });
    }
    for (let index = 0; index < remainingAttempts; index += 1) {
      const delayMs = index === 0 ? 0 : this.baseDelayMs * 2 ** (index - 1);
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (index === 0 && current.next_attempt_at) {
        const persistedDelay = new Date(current.next_attempt_at).getTime() - Date.now();
        if (persistedDelay > 0) await new Promise((resolve) => setTimeout(resolve, persistedDelay));
      }
      const lease = await this.claim({
        jobId,
        leaseOwner: this.workerId,
        leaseDurationMs: 300_000,
      });
      if (!lease) {
        throw new ShotgunError({
          code: 'RETRYABLE_DEPENDENCY',
          safeMessage: 'The durable job is currently leased or not yet retryable.',
          module: 'connector-runtime-postgres',
          operation: 'job-claim',
          correlationId,
          retryable: true,
        });
      }
      const fencingToken = lease.fencingToken;
      const attempt: AttemptRecord = {
        attemptId: randomUUID(),
        jobId,
        attemptNumber: priorAttempts + index + 1,
        startedAt: new Date().toISOString(),
        status: 'running',
        scheduledDelayMs: delayMs,
      };
      await this.pool.query(
        `INSERT INTO connector.job_attempts
         (attempt_id,job_id,attempt_number,worker_id,fencing_token,started_at,status,scheduled_delay_ms)
         VALUES ($1,$2,$3,$4,$5,$6,'running',$7)`,
        [
          attempt.attemptId,
          jobId,
          attempt.attemptNumber,
          this.workerId,
          fencingToken,
          attempt.startedAt,
          delayMs,
        ],
      );
      try {
        const result = await operation(attempt);
        await this.pool.query(
          `UPDATE connector.job_attempts SET status='succeeded', finished_at=clock_timestamp()
           WHERE attempt_id=$1`,
          [attempt.attemptId],
        );
        if (!(await this.complete({ jobId, fencingToken, result }))) {
          throw new ShotgunError({
            code: 'OUTCOME_UNKNOWN',
            safeMessage: 'The job lease was lost before completion was acknowledged.',
            module: 'connector-runtime-postgres',
            operation: 'job-complete',
            correlationId,
          });
        }
        const job = await this.find(identity);
        return { result, job: job! };
      } catch (error) {
        const shotgunError = toShotgunError(error, {
          code: 'TERMINAL_FAILURE',
          safeMessage: 'The connector handler failed.',
          module: identity.consumerId,
          operation: 'execute-handler',
          correlationId,
        });
        await this.pool.query(
          `UPDATE connector.job_attempts SET status='failed', error_code=$2,
           finished_at=clock_timestamp() WHERE attempt_id=$1`,
          [attempt.attemptId, shotgunError.code],
        );
        const canRetry = shotgunError.retryable && priorAttempts + index + 1 < this.maxAttempts;
        if (canRetry) {
          const nextDelayMs = this.baseDelayMs * 2 ** index;
          const retained = await this.retry({
            jobId,
            fencingToken,
            nextAttemptAt: new Date(Date.now() + nextDelayMs).toISOString(),
            safeErrorCode: shotgunError.code,
            safeErrorMessage: shotgunError.safeMessage,
          });
          if (!retained) {
            throw new ShotgunError({
              code: 'OUTCOME_UNKNOWN',
              safeMessage: 'The job lease was lost while scheduling a retry.',
              module: 'connector-runtime-postgres',
              operation: 'job-retry',
              correlationId,
            });
          }
          continue;
        }
        const terminal = await this.terminal({
          jobId,
          fencingToken,
          status: shotgunError.code === 'OUTCOME_UNKNOWN' ? 'outcome-unknown' : 'failed',
          safeErrorCode: shotgunError.code,
          safeErrorMessage: shotgunError.safeMessage,
        });
        if (!terminal) {
          throw new ShotgunError({
            code: 'OUTCOME_UNKNOWN',
            safeMessage: 'The job lease was lost while recording its terminal outcome.',
            module: 'connector-runtime-postgres',
            operation: 'job-terminal',
            correlationId,
          });
        }
        throw shotgunError;
      }
    }
    throw new ShotgunError({
      code: 'TERMINAL_FAILURE',
      safeMessage: 'The retry policy ended without a result.',
      module: identity.consumerId,
      operation: 'execute-handler',
      correlationId,
    });
  }

  async list(): Promise<readonly JobRecord[]> {
    const result = await this.pool.query<JobRow>(
      `SELECT j.*, d.project_id, d.security_scope, d.consumer_id,
              d.message_kind, d.message_type, d.semantic_key AS idempotency_key,
              d.fingerprint
       FROM connector.jobs j
       JOIN connector.dedup_records d ON d.dedup_record_id=j.dedup_record_id
       ORDER BY j.created_at`,
    );
    return Promise.all(
      result.rows.map(async (row) => mapJob(row, await this.attempts(row.job_id))),
    );
  }

  async find(identity: ConnectorSemanticIdentity): Promise<JobRecord | undefined> {
    const result = await this.pool.query<JobRow>(
      `SELECT j.*, d.project_id, d.security_scope, d.consumer_id,
              d.message_kind, d.message_type, d.semantic_key AS idempotency_key,
              d.fingerprint
       FROM connector.jobs j
       JOIN connector.dedup_records d ON d.dedup_record_id=j.dedup_record_id
       WHERE d.project_id=$1 AND d.security_scope=$2 AND d.consumer_id=$3
         AND d.message_kind=$4 AND d.message_type=$5 AND d.semantic_key=$6
         AND d.fingerprint=$7`,
      [
        identity.projectId,
        identity.securityScope,
        identity.consumerId,
        identity.messageKind,
        identity.messageType,
        identity.semanticKey,
        identity.fingerprint,
      ],
    );
    const row = result.rows[0];
    return row ? mapJob(row, await this.attempts(row.job_id)) : undefined;
  }

  private async attempts(jobId: string): Promise<readonly AttemptRow[]> {
    const result = await this.pool.query<AttemptRow>(
      'SELECT * FROM connector.job_attempts WHERE job_id=$1 ORDER BY attempt_number',
      [jobId],
    );
    return result.rows;
  }

  private async findJobRow(identity: ConnectorSemanticIdentity): Promise<JobRow | undefined> {
    const result = await this.pool.query<JobRow>(
      `SELECT j.*, d.project_id, d.security_scope, d.consumer_id,
              d.message_kind, d.message_type, d.semantic_key AS idempotency_key,
              d.fingerprint
       FROM connector.jobs j
       JOIN connector.dedup_records d ON d.dedup_record_id=j.dedup_record_id
       WHERE d.project_id=$1 AND d.security_scope=$2 AND d.consumer_id=$3
         AND d.message_kind=$4 AND d.message_type=$5 AND d.semantic_key=$6
         AND d.fingerprint=$7`,
      [
        identity.projectId,
        identity.securityScope,
        identity.consumerId,
        identity.messageKind,
        identity.messageType,
        identity.semanticKey,
        identity.fingerprint,
      ],
    );
    return result.rows[0];
  }
}

type DeadLetterRow = QueryResultRow & {
  dead_letter_id: string;
  project_id: string;
  security_scope: string;
  consumer_id: string;
  kind: DeadLetterKind;
  identity_consumer_id: string;
  message_kind: ConnectorSemanticIdentity['messageKind'];
  message_type: string;
  semantic_key: string;
  fingerprint: string;
  envelope: unknown;
  safe_error: {
    code: ErrorCode;
    safeMessage: string;
    module: string;
    operation: string;
    correlationId?: string;
    retryable?: boolean;
  };
  job: unknown;
  status: 'open' | 'resolved';
  created_at: Date;
};

const mapDeadLetter = (row: DeadLetterRow, replays: ReplayRecord[]): DeadLetterEntry => {
  const safe = parseJson(row.safe_error) as {
    code: ErrorCode;
    safeMessage: string;
    module: string;
    operation: string;
    correlationId?: string;
    retryable?: boolean;
  };
  const error = new ShotgunError({
    code: safe.code,
    safeMessage: safe.safeMessage,
    module: safe.module,
    operation: safe.operation,
    correlationId: safe.correlationId,
    retryable: safe.retryable,
  });
  return {
    deadLetterId: row.dead_letter_id,
    projectId: row.project_id,
    securityScope: row.security_scope,
    consumerId: row.consumer_id,
    kind: row.kind,
    identity: {
      projectId: row.project_id,
      securityScope: row.security_scope,
      consumerId: row.identity_consumer_id,
      messageKind: row.message_kind,
      messageType: row.message_type,
      semanticKey: row.semantic_key,
      fingerprint: row.fingerprint,
    },
    messageType: row.message_type,
    semanticKey: row.semantic_key,
    fingerprint: row.fingerprint,
    envelope: parseJson(row.envelope) as AnyEnvelope,
    error,
    ...(row.job ? { job: parseJson(row.job) as JobRecord } : {}),
    createdAt: date(row.created_at),
    status: row.status,
    replays,
  };
};

export class PostgresDeadLetterStore implements DeadLetterStorePort {
  constructor(private readonly pool: Pool) {}

  async add(
    input: Omit<DeadLetterEntry, 'deadLetterId' | 'createdAt' | 'status' | 'replays'>,
  ): Promise<DeadLetterEntry> {
    const id = randomUUID();
    if (!('idempotencyKey' in input.envelope))
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: 'Only command/event envelopes can be dead-lettered.',
        module: 'connector-runtime-postgres',
        operation: 'dead-letter-add',
      });
    if (input.envelope.idempotencyKey !== input.identity.semanticKey) {
      throw new ShotgunError({
        code: 'CONFLICT',
        safeMessage: 'The dead-letter envelope does not match its semantic identity.',
        module: 'connector-runtime-postgres',
        operation: 'dead-letter-add',
      });
    }
    if (
      input.projectId !== input.identity.projectId ||
      input.securityScope !== input.identity.securityScope ||
      input.messageType !== input.identity.messageType ||
      input.semanticKey !== input.identity.semanticKey ||
      input.fingerprint !== input.identity.fingerprint
    ) {
      throw new ShotgunError({
        code: 'CONFLICT',
        safeMessage: 'The dead-letter projection does not match its semantic identity.',
        module: 'connector-runtime-postgres',
        operation: 'dead-letter-add',
      });
    }
    const dedup = await this.pool.query<{ dedup_record_id: string; fingerprint: string }>(
      `SELECT dedup_record_id, fingerprint FROM connector.dedup_records
       WHERE project_id=$1 AND security_scope=$2 AND consumer_id=$3
         AND message_kind=$4 AND message_type=$5 AND semantic_key=$6
         AND fingerprint=$7`,
      [
        input.identity.projectId,
        input.identity.securityScope,
        input.identity.consumerId,
        input.identity.messageKind,
        input.identity.messageType,
        input.identity.semanticKey,
        input.identity.fingerprint,
      ],
    );
    const dedupRecord = dedup.rows[0];
    if (!dedupRecord)
      throw new ShotgunError({
        code: 'OUTCOME_UNKNOWN',
        safeMessage: 'The dead-letter could not be bound to its semantic delivery identity.',
        module: 'connector-runtime-postgres',
        operation: 'dead-letter-add',
      });
    await this.pool.query(
      `INSERT INTO connector.dead_letters
       (dead_letter_id,dedup_record_id,project_id,security_scope,consumer_id,identity_consumer_id,
        kind,message_kind,message_type,semantic_key,fingerprint,
        envelope,safe_error,job,status,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,'open',clock_timestamp())`,
      [
        id,
        dedupRecord.dedup_record_id,
        input.identity.projectId,
        input.identity.securityScope,
        input.consumerId,
        input.identity.consumerId,
        input.kind,
        input.identity.messageKind,
        input.identity.messageType,
        input.identity.semanticKey,
        input.identity.fingerprint,
        json(safeEnvelopeForPersistence(input.envelope)),
        json({
          code: input.error.code,
          safeMessage: input.error.safeMessage,
          module: input.error.module,
          operation: input.error.operation,
          correlationId: input.error.correlationId,
          retryable: input.error.retryable,
        }),
        input.job ? json(input.job) : null,
      ],
    );
    return this.get(id);
  }

  async get(deadLetterId: string): Promise<DeadLetterEntry> {
    const result = await this.pool.query<DeadLetterRow>(
      'SELECT * FROM connector.dead_letters WHERE dead_letter_id=$1',
      [deadLetterId],
    );
    if (!result.rows[0])
      throw new ShotgunError({
        code: 'NOT_FOUND',
        safeMessage: `Dead-letter '${deadLetterId}' was not found.`,
        module: 'connector-runtime-postgres',
        operation: 'get-dead-letter',
      });
    const replayResult = await this.pool.query<ReplayRecord>(
      'SELECT replay_id AS "replayId", attempted_at AS "attemptedAt", status, reason, actor_id AS "actorId", actor_type AS "actorType", project_id AS "projectId", security_scope AS "securityScope", original_fingerprint AS "originalFingerprint" FROM connector.replays WHERE dead_letter_id=$1 ORDER BY attempted_at',
      [deadLetterId],
    );
    return mapDeadLetter(result.rows[0], replayResult.rows);
  }

  async list(): Promise<readonly DeadLetterEntry[]> {
    const result = await this.pool.query<DeadLetterRow>(
      'SELECT * FROM connector.dead_letters ORDER BY created_at',
    );
    return Promise.all(result.rows.map((row) => this.get(row.dead_letter_id)));
  }

  async authorizeReplay(deadLetterId: string, authorization: ReplayAuthorization): Promise<void> {
    if (!authorization.reason.trim() || !authorization.actor.id.trim()) {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: 'A replay actor and reason are required.',
        module: 'connector-runtime-postgres',
        operation: 'authorize-replay',
      });
    }
    const result = await this.pool.query<{ status: string; dedup_state: string }>(
      `SELECT dl.status, d.state AS dedup_state
       FROM connector.dead_letters dl
       JOIN connector.dedup_records d ON d.dedup_record_id=dl.dedup_record_id
       WHERE dl.dead_letter_id=$1 AND dl.project_id=$2 AND dl.security_scope=$3
         AND dl.fingerprint=d.fingerprint`,
      [deadLetterId, authorization.projectId, authorization.securityScope],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ShotgunError({
        code: 'REPLAY_BLOCKED',
        safeMessage: 'The replay authorization is outside the original project/security scope.',
        module: 'connector-runtime-postgres',
        operation: 'authorize-replay',
      });
    }
    if (row.status !== 'open' || row.dedup_state === 'OUTCOME_UNKNOWN') {
      throw new ShotgunError({
        code: 'REPLAY_BLOCKED',
        safeMessage:
          row.dedup_state === 'OUTCOME_UNKNOWN'
            ? 'OUTCOME_UNKNOWN must be reconciled before replay.'
            : 'The dead-letter is not open for replay.',
        module: 'connector-runtime-postgres',
        operation: 'authorize-replay',
      });
    }
  }

  async appendReplay(deadLetterId: string, replay: ReplayRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO connector.replays
       (replay_id,dead_letter_id,attempted_at,status,reason,actor_id,actor_type,
        project_id,security_scope,original_fingerprint)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        replay.replayId,
        deadLetterId,
        replay.attemptedAt,
        replay.status,
        replay.reason ?? 'governed-replay',
        replay.actorId ?? 'system',
        replay.actorType ?? 'system',
        replay.projectId ?? 'global',
        replay.securityScope ?? '[]',
        replay.originalFingerprint ?? '',
      ],
    );
  }

  async updateReplay(replayId: string, status: ReplayRecord['status']): Promise<void> {
    await this.pool.query('UPDATE connector.replays SET status=$2 WHERE replay_id=$1', [
      replayId,
      status,
    ]);
  }

  async resolve(deadLetterId: string): Promise<void> {
    await this.pool.query(
      "UPDATE connector.dead_letters SET status='resolved' WHERE dead_letter_id=$1",
      [deadLetterId],
    );
  }
}

export class PostgresOrderingStore implements OrderingStorePort {
  constructor(private readonly pool: Pool) {}

  async acquireNext(
    identity: ConnectorSemanticIdentity,
    envelope: AnyEnvelope,
    jobId: string,
    leaseDurationMs: number,
  ): Promise<{ readonly fencingToken: number }> {
    const hasKey = envelope.orderingKey !== undefined;
    const hasSequence = envelope.sequence !== undefined;
    if (hasKey !== hasSequence)
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: 'orderingKey and sequence must be supplied together.',
        module: 'connector-runtime-postgres',
        operation: 'validate-partial-order',
        correlationId: envelope.correlationId,
      });
    if (!hasKey || envelope.sequence === undefined) return { fencingToken: 0 };
    return withSafePostgresTransaction(
      this.pool,
      async (client) => {
        const key = [
          identity.projectId,
          identity.securityScope,
          identity.consumerId,
          identity.messageKind,
          identity.messageType,
          envelope.orderingKey,
        ];
        await client.query(
          `INSERT INTO connector.ordering_checkpoints
           (project_id,security_scope,consumer_id,message_kind,message_type,ordering_key,
            last_sequence,fencing_token,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,0,1,clock_timestamp())
           ON CONFLICT (project_id,security_scope,consumer_id,message_kind,message_type,ordering_key)
           DO NOTHING`,
          key,
        );
        const current = await client.query<{
          last_sequence: number;
          fencing_token: number | string;
          claim_sequence: number | null;
          claim_expires_at: Date | null;
        }>(
          `SELECT last_sequence,fencing_token,claim_sequence,claim_expires_at
           FROM connector.ordering_checkpoints
           WHERE project_id=$1 AND security_scope=$2 AND consumer_id=$3
             AND message_kind=$4 AND message_type=$5 AND ordering_key=$6
           FOR UPDATE`,
          key,
        );
        const row = current.rows[0];
        if (!row)
          throw new ShotgunError({
            code: 'OUTCOME_UNKNOWN',
            safeMessage: 'The ordering checkpoint could not be read.',
            module: 'connector-runtime-postgres',
            operation: 'acquire-partial-order',
          });
        const expected = Number(row.last_sequence) + 1;
        if (envelope.sequence !== expected)
          throw new ShotgunError({
            code: 'STALE_VERSION',
            safeMessage: `Partial ordering violation: expected sequence ${expected}, received ${envelope.sequence}.`,
            module: 'connector-runtime-postgres',
            operation: 'validate-partial-order',
            correlationId: envelope.correlationId,
          });
        if (
          row.claim_sequence !== null &&
          row.claim_expires_at &&
          row.claim_expires_at > new Date()
        )
          throw new ShotgunError({
            code: 'RETRYABLE_DEPENDENCY',
            safeMessage: 'The ordering key is currently fenced by another delivery.',
            module: 'connector-runtime-postgres',
            operation: 'acquire-partial-order',
            correlationId: envelope.correlationId,
            retryable: true,
          });
        const updated = await client.query<{ fencing_token: number | string }>(
          `UPDATE connector.ordering_checkpoints
           SET claim_sequence=$7, claim_job_id=$8, claim_fence_token=fencing_token+1,
               claim_expires_at=clock_timestamp() + ($9 * interval '1 millisecond'),
               fencing_token=fencing_token+1, updated_at=clock_timestamp()
           WHERE project_id=$1 AND security_scope=$2 AND consumer_id=$3
             AND message_kind=$4 AND message_type=$5 AND ordering_key=$6
           RETURNING fencing_token`,
          [...key, envelope.sequence, jobId, leaseDurationMs],
        );
        return { fencingToken: Number(updated.rows[0]!.fencing_token) };
      },
      { module: 'connector-runtime-postgres', operation: 'acquire-partial-order' },
    );
  }

  async commit(
    identity: ConnectorSemanticIdentity,
    envelope: AnyEnvelope,
    fencingToken: number,
  ): Promise<void> {
    if (envelope.orderingKey === undefined || envelope.sequence === undefined) return;
    await withSafePostgresTransaction(
      this.pool,
      async (client) => {
        const result = await client.query(
          `UPDATE connector.ordering_checkpoints
           SET last_sequence=claim_sequence, claim_sequence=NULL, claim_job_id=NULL,
               claim_fence_token=NULL, claim_expires_at=NULL,
               updated_at=clock_timestamp()
           WHERE project_id=$1 AND security_scope=$2 AND consumer_id=$3
             AND message_kind=$4 AND message_type=$5 AND ordering_key=$6
             AND claim_sequence=$7 AND claim_fence_token=$8`,
          [
            identity.projectId,
            identity.securityScope,
            identity.consumerId,
            identity.messageKind,
            identity.messageType,
            envelope.orderingKey,
            envelope.sequence,
            fencingToken,
          ],
        );
        if (result.rowCount !== 1)
          throw new ShotgunError({
            code: 'OUTCOME_UNKNOWN',
            safeMessage: 'The ordering fence was lost before checkpoint commit.',
            module: 'connector-runtime-postgres',
            operation: 'commit-partial-order',
            correlationId: envelope.correlationId,
          });
      },
      { module: 'connector-runtime-postgres', operation: 'commit-partial-order' },
    );
  }

  async release(
    identity: ConnectorSemanticIdentity,
    envelope: AnyEnvelope,
    fencingToken: number,
  ): Promise<void> {
    if (envelope.orderingKey === undefined || envelope.sequence === undefined) return;
    await this.pool.query(
      `UPDATE connector.ordering_checkpoints
       SET claim_sequence=NULL, claim_job_id=NULL, claim_fence_token=NULL,
           claim_expires_at=NULL, updated_at=clock_timestamp()
       WHERE project_id=$1 AND security_scope=$2 AND consumer_id=$3
         AND message_kind=$4 AND message_type=$5 AND ordering_key=$6
         AND claim_sequence=$7 AND claim_fence_token=$8`,
      [
        identity.projectId,
        identity.securityScope,
        identity.consumerId,
        identity.messageKind,
        identity.messageType,
        envelope.orderingKey,
        envelope.sequence,
        fencingToken,
      ],
    );
  }
}

export class PostgresConnectorRuntimeState implements ConnectorRuntimeStatePort {
  readonly dedup: DedupStorePort;
  readonly jobs: JobRuntimePort;
  readonly deadLetters: DeadLetterStorePort;
  readonly ordering: OrderingStorePort;
  private recoveryTimer: NodeJS.Timeout | undefined;
  readonly lifecycle = {
    start: async (): Promise<void> => {
      const result = await this.pool.query<{ relation: string | null }>(
        `SELECT to_regclass('connector.dedup_records')::text AS relation`,
      );
      if (result.rows[0]?.relation !== 'connector.dedup_records') {
        throw new ShotgunError({
          code: 'CONFIGURATION_REQUIRED',
          safeMessage: 'Connector durable schema migration 064 is not applied.',
          module: 'connector-runtime-postgres',
          operation: 'start',
        });
      }
      if (!this.recoveryTimer) {
        this.recoveryTimer = setInterval(() => {
          void this.recoverExpiredLeases();
        }, 5_000);
        this.recoveryTimer.unref();
      }
    },
    stop: async (): Promise<void> => {
      if (this.recoveryTimer) {
        clearInterval(this.recoveryTimer);
        this.recoveryTimer = undefined;
      }
    },
  };

  constructor(private readonly pool: Pool) {
    this.dedup = new PostgresDedupStore(pool);
    this.jobs = new PostgresJobRuntime(pool);
    this.deadLetters = new PostgresDeadLetterStore(pool);
    this.ordering = new PostgresOrderingStore(pool);
  }

  private async recoverExpiredLeases(): Promise<void> {
    try {
      await withSafePostgresTransaction(
        this.pool,
        async (client) => {
          const result = await client.query<{ dedup_record_id: string }>(
            `UPDATE connector.jobs
             SET status='outcome-unknown', safe_error_code='OUTCOME_UNKNOWN',
                 safe_error_message='Worker lease expired before completion was acknowledged.',
                 lease_owner=NULL, lease_expires_at=NULL, updated_at=clock_timestamp()
             WHERE status='running' AND lease_expires_at IS NOT NULL
               AND lease_expires_at < clock_timestamp()
             RETURNING dedup_record_id`,
          );
          if (result.rows.length > 0) {
            await client.query(
              `UPDATE connector.dedup_records
               SET state='OUTCOME_UNKNOWN', safe_error_code='OUTCOME_UNKNOWN',
                   safe_error_message='Worker lease expired before completion was acknowledged.',
                   updated_at=clock_timestamp(), completed_at=clock_timestamp()
               WHERE dedup_record_id = ANY($1::uuid[]) AND state='IN_PROGRESS'`,
              [result.rows.map((row) => row.dedup_record_id)],
            );
          }
          await client.query(
            `UPDATE connector.ordering_checkpoints
             SET claim_sequence=NULL, claim_job_id=NULL, claim_fence_token=NULL,
                 claim_expires_at=NULL, fencing_token=fencing_token+1,
                 updated_at=clock_timestamp()
             WHERE claim_expires_at IS NOT NULL AND claim_expires_at < clock_timestamp()`,
          );
        },
        { module: 'connector-runtime-postgres', operation: 'recover-expired-leases' },
      );
    } catch {
      // Recovery is retried on the next tick; failure is observable through
      // the existing application health/logging surface without exposing data.
    }
  }
}
