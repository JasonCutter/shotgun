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
  consumer_id: string;
  idempotency_key: string;
  correlation_id: string;
  status: JobRecord['status'] | 'queued' | 'dead-letter' | 'cancelled';
  attempt_count: number;
  created_at: Date;
  result: unknown;
  safe_error_code: string | null;
  safe_error_message: string | null;
};
type AttemptRow = QueryResultRow & {
  attempt_id: string;
  job_id: string;
  attempt_number: number;
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
    row.status === 'queued'
      ? 'running'
      : row.status === 'dead-letter' || row.status === 'cancelled'
        ? 'failed'
        : row.status,
  attempts: attempts.map((attempt) => ({
    attemptId: attempt.attempt_id,
    jobId: attempt.job_id,
    attemptNumber: attempt.attempt_number,
    startedAt: date(attempt.started_at),
    ...(attempt.finished_at ? { finishedAt: date(attempt.finished_at) } : {}),
    status: attempt.status,
    ...(attempt.error_code ? { errorCode: attempt.error_code } : {}),
    scheduledDelayMs: attempt.scheduled_delay_ms,
  })),
});

export class PostgresJobRuntime implements JobRuntimePort {
  constructor(
    private readonly pool: Pool,
    private readonly maxAttempts = 3,
    private readonly baseDelayMs = 1,
  ) {}

  async enqueue(input: {
    readonly jobId: string;
    readonly dedupRecordId: string;
    readonly consumerId: string;
    readonly idempotencyKey: string;
    readonly correlationId: string;
  }): Promise<JobRecord> {
    const result = await this.pool.query<JobRow>(
      `INSERT INTO connector.jobs
       (job_id,dedup_record_id,correlation_id,status,created_at,updated_at)
       VALUES ($1,$2,$3,'queued',clock_timestamp(),clock_timestamp())
       ON CONFLICT (job_id) DO UPDATE SET updated_at=clock_timestamp()
       RETURNING *`,
      [input.jobId, input.dedupRecordId, input.correlationId],
    );
    const job = await this.find(input.consumerId, input.idempotencyKey);
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
           fencing_token=fencing_token+1, updated_at=clock_timestamp()
       WHERE job_id=$1 AND status IN ('queued','running')
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
      `UPDATE connector.jobs SET status='running', next_attempt_at=$3,
       attempt_count=attempt_count+1,
       safe_error_code=$4, safe_error_message=$5, lease_owner=NULL,
       lease_expires_at=NULL, updated_at=clock_timestamp()
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
    idempotencyKey: string,
    consumerId: string,
    correlationId: string,
    operation: (attempt: AttemptRecord) => Promise<TResult>,
  ): Promise<JobRunResult<TResult>> {
    const dedup = await this.pool.query<{ dedup_record_id: string; job_id: string }>(
      `SELECT dedup_record_id, job_id FROM connector.dedup_records
       WHERE consumer_id=$1 AND semantic_key=$2 ORDER BY created_at DESC LIMIT 1`,
      [consumerId, idempotencyKey],
    );
    if (!dedup.rows[0])
      throw new ShotgunError({
        code: 'OUTCOME_UNKNOWN',
        safeMessage: 'The job is missing its semantic deduplication record.',
        module: 'connector-runtime-postgres',
        operation: 'job-run',
        correlationId,
      });
    const created = await this.pool.query<JobRow>(
      `INSERT INTO connector.jobs
       (job_id,dedup_record_id,correlation_id,status,created_at,updated_at)
       VALUES ($1,$2,$3,'running',clock_timestamp(),clock_timestamp())
       ON CONFLICT (job_id)
       DO UPDATE SET status='running', lease_owner=NULL, lease_expires_at=NULL,
         next_attempt_at=NULL, updated_at=clock_timestamp()
       RETURNING *`,
      [dedup.rows[0].job_id, dedup.rows[0].dedup_record_id, correlationId],
    );
    const jobId = created.rows[0]!.job_id;
    const priorAttempts = Number(created.rows[0]!.attempt_count ?? 0);
    const lease = await this.claim({
      jobId,
      leaseOwner: `connector-runtime:${process.pid}`,
      leaseDurationMs: 300_000,
    });
    if (!lease) {
      throw new ShotgunError({
        code: 'RETRYABLE_DEPENDENCY',
        safeMessage: 'The durable job is currently leased by another worker.',
        module: 'connector-runtime-postgres',
        operation: 'job-claim',
        correlationId,
        retryable: true,
      });
    }
    const fencingToken = lease.fencingToken;
    for (let index = 0; index < this.maxAttempts; index += 1) {
      const delayMs = index === 0 ? 0 : this.baseDelayMs * 2 ** (index - 1);
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
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
         (attempt_id,job_id,attempt_number,started_at,status,scheduled_delay_ms)
         VALUES ($1,$2,$3,$4,'running',$5)`,
        [attempt.attemptId, jobId, attempt.attemptNumber, attempt.startedAt, delayMs],
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
        const job = await this.find(consumerId, idempotencyKey);
        return { result, job: job! };
      } catch (error) {
        const shotgunError = toShotgunError(error, {
          code: 'TERMINAL_FAILURE',
          safeMessage: 'The connector handler failed.',
          module: consumerId,
          operation: 'execute-handler',
          correlationId,
        });
        await this.pool.query(
          `UPDATE connector.job_attempts SET status='failed', error_code=$2,
           finished_at=clock_timestamp() WHERE attempt_id=$1`,
          [attempt.attemptId, shotgunError.code],
        );
        const canRetry = shotgunError.retryable && index + 1 < this.maxAttempts;
        if (canRetry) {
          const retained = await this.retry({
            jobId,
            fencingToken,
            nextAttemptAt: new Date(Date.now() + delayMs).toISOString(),
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
      module: consumerId,
      operation: 'execute-handler',
      correlationId,
    });
  }

  async list(): Promise<readonly JobRecord[]> {
    const result = await this.pool.query<JobRow>(
      `SELECT j.*, d.consumer_id, d.semantic_key AS idempotency_key
       FROM connector.jobs j
       JOIN connector.dedup_records d ON d.dedup_record_id=j.dedup_record_id
       ORDER BY j.created_at`,
    );
    return Promise.all(
      result.rows.map(async (row) => mapJob(row, await this.attempts(row.job_id))),
    );
  }

  async find(consumerId: string, idempotencyKey: string): Promise<JobRecord | undefined> {
    const result = await this.pool.query<JobRow>(
      `SELECT j.*, d.consumer_id, d.semantic_key AS idempotency_key
       FROM connector.jobs j
       JOIN connector.dedup_records d ON d.dedup_record_id=j.dedup_record_id
       WHERE d.consumer_id=$1 AND d.semantic_key=$2`,
      [consumerId, idempotencyKey],
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
}

type DeadLetterRow = QueryResultRow & {
  dead_letter_id: string;
  project_id: string;
  consumer_id: string;
  kind: DeadLetterKind;
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
    consumerId: row.consumer_id,
    kind: row.kind,
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
    const semanticKey = input.envelope.idempotencyKey;
    const identity = await this.pool.query<{ dedup_record_id: string; fingerprint: string }>(
      `SELECT dedup_record_id, fingerprint FROM connector.dedup_records
       WHERE consumer_id=$1 AND semantic_key=$2 ORDER BY created_at DESC LIMIT 1`,
      [`${input.consumerId}:${input.kind}:${input.envelope.messageType}`, semanticKey],
    );
    const dedupRecord = identity.rows[0];
    if (!dedupRecord)
      throw new ShotgunError({
        code: 'OUTCOME_UNKNOWN',
        safeMessage: 'The dead-letter could not be bound to its semantic delivery identity.',
        module: 'connector-runtime-postgres',
        operation: 'dead-letter-add',
      });
    await this.pool.query(
      `INSERT INTO connector.dead_letters
       (dead_letter_id,dedup_record_id,project_id,consumer_id,kind,semantic_key,fingerprint,
        envelope,safe_error,job,status,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,'open',clock_timestamp())`,
      [
        id,
        dedupRecord.dedup_record_id,
        input.projectId,
        input.consumerId,
        input.kind,
        semanticKey,
        dedupRecord.fingerprint,
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
      'SELECT replay_id AS "replayId", attempted_at AS "attemptedAt", status, reason FROM connector.replays WHERE dead_letter_id=$1 ORDER BY attempted_at',
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

  async appendReplay(deadLetterId: string, replay: ReplayRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO connector.replays (replay_id,dead_letter_id,attempted_at,status,reason)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        replay.replayId,
        deadLetterId,
        replay.attemptedAt,
        replay.status,
        replay.reason ?? 'governed-replay',
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

  async assertNext(consumerId: string, envelope: AnyEnvelope): Promise<void> {
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
    if (!hasKey || envelope.sequence === undefined) return;
    const result = await this.pool.query<{ last_sequence: number }>(
      'SELECT last_sequence FROM connector.ordering_checkpoints WHERE consumer_id=$1 AND ordering_key=$2',
      [consumerId, envelope.orderingKey],
    );
    const expected = (result.rows[0]?.last_sequence ?? 0) + 1;
    if (envelope.sequence !== expected)
      throw new ShotgunError({
        code: 'STALE_VERSION',
        safeMessage: `Partial ordering violation: expected sequence ${expected}, received ${envelope.sequence}.`,
        module: 'connector-runtime-postgres',
        operation: 'validate-partial-order',
        correlationId: envelope.correlationId,
      });
  }

  async commit(consumerId: string, envelope: AnyEnvelope): Promise<void> {
    if (envelope.orderingKey === undefined || envelope.sequence === undefined) return;
    await withSafePostgresTransaction(
      this.pool,
      async (client) => {
        const current = await client.query<{ last_sequence: number }>(
          'SELECT last_sequence FROM connector.ordering_checkpoints WHERE consumer_id=$1 AND ordering_key=$2 FOR UPDATE',
          [consumerId, envelope.orderingKey],
        );
        const expected = (current.rows[0]?.last_sequence ?? 0) + 1;
        if (envelope.sequence !== expected)
          throw new ShotgunError({
            code: 'STALE_VERSION',
            safeMessage: `Partial ordering violation: expected sequence ${expected}, received ${envelope.sequence}.`,
            module: 'connector-runtime-postgres',
            operation: 'commit-partial-order',
            correlationId: envelope.correlationId,
          });
        await client.query(
          `INSERT INTO connector.ordering_checkpoints (consumer_id,ordering_key,last_sequence,updated_at)
         VALUES ($1,$2,$3,clock_timestamp())
         ON CONFLICT (consumer_id,ordering_key) DO UPDATE SET last_sequence=EXCLUDED.last_sequence, fencing_token=connector.ordering_checkpoints.fencing_token+1, updated_at=clock_timestamp()`,
          [consumerId, envelope.orderingKey, envelope.sequence],
        );
      },
      { module: 'connector-runtime-postgres', operation: 'commit-partial-order' },
    );
  }
}

export class PostgresConnectorRuntimeState implements ConnectorRuntimeStatePort {
  readonly dedup: DedupStorePort;
  readonly jobs: JobRuntimePort;
  readonly deadLetters: DeadLetterStorePort;
  readonly ordering: OrderingStorePort;
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
    },
    stop: async (_options?: { readonly graceMs?: number }): Promise<void> => {
      // The application-owned PostgreSQL pool is closed by AsyncCleanupStack;
      // this adapter owns no independent timer or worker process.
    },
  };

  constructor(private readonly pool: Pool) {
    this.dedup = new PostgresDedupStore(pool);
    this.jobs = new PostgresJobRuntime(pool);
    this.deadLetters = new PostgresDeadLetterStore(pool);
    this.ordering = new PostgresOrderingStore(pool);
  }
}
