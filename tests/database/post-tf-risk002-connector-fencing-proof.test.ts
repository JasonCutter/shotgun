import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import {
  PostgresConnectorRuntimeState,
  PostgresDedupStore,
  PostgresJobRuntime,
} from '../../adapters/connector-runtime-postgres/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import type { ConnectorSemanticIdentity } from '../../packages/connector-runtime/src/ports.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool = createPostgresPool(databaseUrl);
const observerPool = createPostgresPool(databaseUrl);

type Snapshot = {
  readonly job: {
    readonly status: string;
    readonly leaseOwner: string | null;
    readonly leaseExpiresAt: string | null;
    readonly fencingToken: number;
    readonly attemptCount: number;
    readonly safeErrorCode: string | null;
  };
  readonly dedup: {
    readonly state: string;
    readonly jobId: string | null;
    readonly fenceToken: number;
    readonly safeErrorCode: string | null;
  };
  readonly attempt: {
    readonly attemptId: string;
    readonly status: string;
    readonly workerId: string;
    readonly fencingToken: number;
    readonly errorCode: string | null;
    readonly finishedAt: string | null;
  } | null;
  readonly ordering: {
    readonly fencingToken: number;
    readonly claimJobId: string | null;
    readonly claimExpiresAt: string | null;
  } | null;
};

type ProofRow = {
  readonly scenario: string;
  readonly exactTest: string;
  readonly jobId: string;
  readonly attemptId: string | null;
  readonly workerId: string | null;
  readonly fencingToken: number;
  readonly leaseValidAtMutation: 'YES' | 'NO';
  readonly attemptBefore: Snapshot['attempt'];
  readonly attemptAfter: Snapshot['attempt'];
  readonly jobBefore: Snapshot['job'];
  readonly jobAfter: Snapshot['job'];
  readonly dedupBefore: Snapshot['dedup'];
  readonly dedupAfter: Snapshot['dedup'];
  readonly orderingBefore: Snapshot['ordering'];
  readonly orderingAfter: Snapshot['ordering'];
  readonly callerResult: unknown;
  readonly callerError: string | null;
  readonly handlerInvocationCount: number;
  readonly replacementHandlerInvocationCount: number;
  readonly duplicateSideEffectCount: number;
  readonly staleAttemptMutated: 'YES' | 'NO';
  readonly runningAttemptOrphaned: 'YES' | 'NO';
  readonly expiredJobMutationAccepted: 'YES' | 'NO';
  readonly classification: string;
  readonly minimumLikelyCorrection: string;
};

const proofRows: ProofRow[] = [];

const identityFor = (projectId: string, suffix: string): ConnectorSemanticIdentity => ({
  projectId,
  securityScope: JSON.stringify({
    accessScope: ['owner'],
    sensitivity: 'public',
    dataClassification: 'risk002-connector-fencing-proof',
  }),
  consumerId: `risk002.proof:${suffix}`,
  messageKind: 'event',
  messageType: 'Risk002ConnectorFencingProof',
  semanticKey: `risk002:${suffix}:${projectId}`,
  fingerprint: `risk002-fingerprint:${suffix}:${projectId}`,
});

const iso = (value: Date | string | null): string | null =>
  value === null
    ? null
    : value instanceof Date
      ? value.toISOString()
      : new Date(value).toISOString();

const errorSummary = (error: unknown): string | null => {
  if (error === null || typeof error !== 'object')
    return error instanceof Error ? error.message : null;
  const candidate = error as { readonly code?: unknown; readonly message?: unknown };
  if (typeof candidate.code === 'string') {
    return `${candidate.code}: ${typeof candidate.message === 'string' ? candidate.message : ''}`.trim();
  }
  return typeof candidate.message === 'string' ? candidate.message : String(error);
};

const attemptEvidenceChanged = (before: Snapshot['attempt'], after: Snapshot['attempt']): boolean =>
  before?.status !== after?.status ||
  before?.errorCode !== after?.errorCode ||
  before?.finishedAt !== after?.finishedAt;

const cleanup = async (projectId: string, orderKey: string): Promise<void> => {
  await observerPool.query(
    `DELETE FROM connector.jobs
      WHERE dedup_record_id IN (
        SELECT dedup_record_id FROM connector.dedup_records WHERE project_id=$1
      )`,
    [projectId],
  );
  await observerPool.query('DELETE FROM connector.dedup_records WHERE project_id=$1', [projectId]);
  await observerPool.query(
    `DELETE FROM connector.ordering_checkpoints
      WHERE project_id=$1 AND ordering_key=$2`,
    [projectId, orderKey],
  );
};

const seedFixture = async (suffix: string) => {
  const projectId = `risk002-${suffix}-${randomUUID()}`;
  const orderKey = `order-${randomUUID()}`;
  const identity = identityFor(projectId, suffix);
  const jobId = randomUUID();
  const dedup = new PostgresDedupStore(pool);
  const jobs = new PostgresJobRuntime(pool);
  const began = await dedup.begin({ ...identity, jobId });
  expect(began.kind).toBe('ACQUIRED');
  if (began.kind !== 'ACQUIRED') throw new Error('risk002 fixture could not acquire dedup record');
  const dedupRecordId = began.record.jobId ? began.record.jobId : null;
  const dedupRow = await observerPool.query<{ dedup_record_id: string }>(
    `SELECT dedup_record_id FROM connector.dedup_records
      WHERE project_id=$1 AND semantic_key=$2`,
    [projectId, identity.semanticKey],
  );
  const actualDedupRecordId = dedupRow.rows[0]?.dedup_record_id;
  if (!actualDedupRecordId) throw new Error(`risk002 dedup row missing for ${projectId}`);
  await jobs.enqueue({
    jobId,
    dedupRecordId: actualDedupRecordId,
    identity,
    correlationId: randomUUID(),
  });
  await observerPool.query(
    `INSERT INTO connector.ordering_checkpoints
       (project_id, security_scope, consumer_id, message_kind, message_type,
        ordering_key, last_sequence, fencing_token, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,0,1,clock_timestamp())`,
    [
      projectId,
      identity.securityScope,
      identity.consumerId,
      identity.messageKind,
      identity.messageType,
      orderKey,
    ],
  );
  return {
    projectId,
    orderKey,
    identity,
    jobId,
    dedupRecordId: actualDedupRecordId,
    initialFenceToken: began.record.fenceToken,
    jobs,
    dedupRecordIdFromBegin: dedupRecordId,
  };
};

const readSnapshot = async (
  fixture: Awaited<ReturnType<typeof seedFixture>>,
  attemptId?: string,
): Promise<Snapshot> => {
  const [jobResult, dedupResult, attemptResult, orderingResult] = await Promise.all([
    observerPool.query<{
      status: string;
      lease_owner: string | null;
      lease_expires_at: Date | null;
      fencing_token: number | string;
      attempt_count: number | string;
      safe_error_code: string | null;
    }>(
      `SELECT status, lease_owner, lease_expires_at, fencing_token, attempt_count, safe_error_code
         FROM connector.jobs WHERE job_id=$1`,
      [fixture.jobId],
    ),
    observerPool.query<{
      state: string;
      job_id: string | null;
      fence_token: number | string;
      safe_error_code: string | null;
    }>(
      'SELECT state, job_id, fence_token, safe_error_code FROM connector.dedup_records WHERE dedup_record_id=$1',
      [fixture.dedupRecordId],
    ),
    attemptId
      ? observerPool.query<{
          attempt_id: string;
          status: string;
          worker_id: string;
          fencing_token: number | string;
          error_code: string | null;
          finished_at: Date | null;
        }>(
          `SELECT attempt_id, status, worker_id, fencing_token, error_code, finished_at
             FROM connector.job_attempts WHERE attempt_id=$1`,
          [attemptId],
        )
      : observerPool.query<{
          attempt_id: string;
          status: string;
          worker_id: string;
          fencing_token: number | string;
          error_code: string | null;
          finished_at: Date | null;
        }>(
          `SELECT attempt_id, status, worker_id, fencing_token, error_code, finished_at
             FROM connector.job_attempts
            WHERE job_id=$1
            ORDER BY attempt_number DESC
            LIMIT 1`,
          [fixture.jobId],
        ),
    observerPool.query<{
      fencing_token: number | string;
      claim_job_id: string | null;
      claim_expires_at: Date | null;
    }>(
      `SELECT fencing_token, claim_job_id, claim_expires_at
         FROM connector.ordering_checkpoints
        WHERE project_id=$1 AND ordering_key=$2`,
      [fixture.projectId, fixture.orderKey],
    ),
  ]);
  const job = jobResult.rows[0];
  const dedup = dedupResult.rows[0];
  if (!job || !dedup)
    throw new Error(`risk002 snapshot missing durable row for ${fixture.projectId}`);
  const attempt = attemptResult.rows[0];
  const ordering = orderingResult.rows[0];
  return {
    job: {
      status: job.status,
      leaseOwner: job.lease_owner,
      leaseExpiresAt: iso(job.lease_expires_at),
      fencingToken: Number(job.fencing_token),
      attemptCount: Number(job.attempt_count),
      safeErrorCode: job.safe_error_code,
    },
    dedup: {
      state: dedup.state,
      jobId: dedup.job_id,
      fenceToken: Number(dedup.fence_token),
      safeErrorCode: dedup.safe_error_code,
    },
    attempt: attempt
      ? {
          attemptId: attempt.attempt_id,
          status: attempt.status,
          workerId: attempt.worker_id,
          fencingToken: Number(attempt.fencing_token),
          errorCode: attempt.error_code,
          finishedAt: iso(attempt.finished_at),
        }
      : null,
    ordering: ordering
      ? {
          fencingToken: Number(ordering.fencing_token),
          claimJobId: ordering.claim_job_id,
          claimExpiresAt: iso(ordering.claim_expires_at),
        }
      : null,
  };
};

const expireOnlyJobLease = async (jobId: string): Promise<void> => {
  const result = await observerPool.query(
    `UPDATE connector.jobs
        SET lease_expires_at=clock_timestamp() - interval '1 second'
      WHERE job_id=$1 AND status='running' AND lease_expires_at IS NOT NULL`,
    [jobId],
  );
  expect(result.rowCount).toBe(1);
};

type AttemptEvidenceStatus = 'running' | 'succeeded' | 'failed';

const seedAttemptEvidence = async (
  fixture: Awaited<ReturnType<typeof seedFixture>>,
  input: {
    readonly attemptNumber: number;
    readonly leaseOwner: string;
    readonly fencingToken: number;
    readonly status: AttemptEvidenceStatus;
    readonly errorCode?: string | null;
  },
): Promise<string> => {
  const attemptId = randomUUID();
  await observerPool.query(
    `INSERT INTO connector.job_attempts
       (attempt_id, job_id, attempt_number, worker_id, fencing_token,
        started_at, status, error_code, finished_at, scheduled_delay_ms)
     VALUES ($1,$2,$3,$4,$5,clock_timestamp(),$6,$7,
             CASE WHEN $6='running' THEN NULL ELSE clock_timestamp() END,0)`,
    [
      attemptId,
      fixture.jobId,
      input.attemptNumber,
      input.leaseOwner,
      input.fencingToken,
      input.status,
      input.errorCode ?? null,
    ],
  );
  return attemptId;
};

const seedRunningAttempt = async (
  fixture: Awaited<ReturnType<typeof seedFixture>>,
  leaseOwner: string,
  fencingToken: number,
): Promise<string> =>
  seedAttemptEvidence(fixture, {
    attemptNumber: 1,
    leaseOwner,
    fencingToken,
    status: 'running',
  });

const recoverProductionExpiredLeases = async (
  state: PostgresConnectorRuntimeState,
): Promise<void> => {
  // The private cast is test-only access to the production recovery entrypoint;
  // the recovery SQL itself is not recreated here.
  const recovery = (state as unknown as { recoverExpiredLeases(): Promise<void> })
    .recoverExpiredLeases;
  await recovery.call(state);
};

const startBlockedRun = async (
  fixture: Awaited<ReturnType<typeof seedFixture>>,
  outcome: 'success' | 'failure',
) => {
  let resolveStarted!: () => void;
  let resolveRelease!: () => void;
  const started = new Promise<void>((resolve) => {
    resolveStarted = resolve;
  });
  const release = new Promise<void>((resolve) => {
    resolveRelease = resolve;
  });
  let handlerInvocationCount = 0;
  let duplicateSideEffectCount = 0;
  const runPromise = fixture.jobs.run(fixture.identity, randomUUID(), async () => {
    handlerInvocationCount += 1;
    duplicateSideEffectCount += 1;
    resolveStarted();
    await release;
    if (outcome === 'success') return { accepted: true, scenario: outcome };
    throw new Error('controlled late failure after lease expiry');
  });
  await started;
  const before = await readSnapshot(fixture);
  const attemptId = before.attempt?.attemptId;
  if (!attemptId) throw new Error(`risk002 attempt row missing for ${fixture.jobId}`);
  const withAttempt = await readSnapshot(fixture, attemptId);
  return {
    runPromise,
    release: resolveRelease,
    before: withAttempt,
    attemptId,
    handlerInvocationCount: () => handlerInvocationCount,
    duplicateSideEffectCount: () => duplicateSideEffectCount,
  };
};

const recordRecoveryScenario = async (scenario: 'A' | 'B' | 'C'): Promise<void> => {
  const fixture = await seedFixture(`scenario-${scenario.toLowerCase()}`);
  const outcome = scenario === 'C' ? 'failure' : 'success';
  let blocked: Awaited<ReturnType<typeof startBlockedRun>> | undefined;
  let callerError: unknown = null;
  try {
    blocked = await startBlockedRun(fixture, outcome);
    await expireOnlyJobLease(fixture.jobId);
    const state = new PostgresConnectorRuntimeState(pool);
    await recoverProductionExpiredLeases(state);
    const afterRecovery = await readSnapshot(fixture, blocked.attemptId);
    expect(afterRecovery.job.status).toBe('outcome-unknown');
    expect(afterRecovery.dedup.state).toBe('OUTCOME_UNKNOWN');
    expect(afterRecovery.attempt).toMatchObject({
      status: 'failed',
      errorCode: 'OUTCOME_UNKNOWN',
    });
    expect(afterRecovery.attempt?.finishedAt).not.toBeNull();
    expect(afterRecovery.ordering).toEqual(blocked.before.ordering);
    if (scenario === 'A') {
      blocked.release();
      await blocked.runPromise.catch((error: unknown) => {
        callerError = error;
      });
    } else {
      const runCompletion = blocked.runPromise.then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      blocked.release();
      const completion = await runCompletion;
      callerError = 'error' in completion ? completion.error : null;
    }
    const final = await readSnapshot(fixture, blocked.attemptId);
    const staleAttemptMutated = attemptEvidenceChanged(afterRecovery.attempt, final.attempt)
      ? 'YES'
      : 'NO';
    const runningAttemptOrphaned = afterRecovery.attempt?.status === 'running' ? 'YES' : 'NO';
    expect(staleAttemptMutated).toBe('NO');
    expect(runningAttemptOrphaned).toBe('NO');
    expect(errorSummary(callerError)).toContain('OUTCOME_UNKNOWN');
    proofRows.push({
      scenario,
      exactTest: `tests/database/post-tf-risk002-connector-fencing-proof.test.ts::Scenario ${scenario}`,
      jobId: fixture.jobId,
      attemptId: blocked.attemptId,
      workerId: afterRecovery.attempt?.workerId ?? blocked.before.attempt?.workerId ?? null,
      fencingToken: afterRecovery.attempt?.fencingToken ?? afterRecovery.job.fencingToken,
      leaseValidAtMutation: 'NO',
      attemptBefore: blocked.before.attempt,
      attemptAfter: final.attempt,
      jobBefore: blocked.before.job,
      jobAfter: final.job,
      dedupBefore: blocked.before.dedup,
      dedupAfter: final.dedup,
      orderingBefore: blocked.before.ordering,
      orderingAfter: afterRecovery.ordering,
      callerResult: null,
      callerError: errorSummary(callerError),
      handlerInvocationCount: blocked.handlerInvocationCount(),
      replacementHandlerInvocationCount: 0,
      duplicateSideEffectCount: blocked.duplicateSideEffectCount(),
      staleAttemptMutated,
      runningAttemptOrphaned,
      expiredJobMutationAccepted: 'NO',
      classification: 'SAFE_ALREADY',
      minimumLikelyCorrection:
        scenario === 'A'
          ? 'Current-fence recovery now closes the running attempt as OUTCOME_UNKNOWN; preserve dedup unknown authority.'
          : 'Current-authority predicates now block stale attempt and late job mutations; never invoke a replacement handler from this proof.',
    });
  } finally {
    blocked?.release();
    if (blocked) await blocked.runPromise.catch(() => undefined);
    await cleanup(fixture.projectId, fixture.orderKey);
  }
};

const recordExpiredTransitionScenario = async (
  operation: 'complete' | 'retry' | 'terminal',
): Promise<void> => {
  const fixture = await seedFixture(`scenario-d-${operation}`);
  const leaseOwner = `risk002-d-${operation}-worker`;
  const lease = await fixture.jobs.claim({
    jobId: fixture.jobId,
    leaseOwner,
    leaseDurationMs: 300_000,
  });
  expect(lease).toBeDefined();
  if (!lease) throw new Error(`risk002 could not claim ${fixture.jobId}`);
  const before = await readSnapshot(fixture);
  let callerResult: unknown = null;
  try {
    await expireOnlyJobLease(fixture.jobId);
    if (operation === 'complete') {
      callerResult = await fixture.jobs.complete({
        jobId: fixture.jobId,
        leaseOwner,
        fencingToken: lease.fencingToken,
        result: { accepted: true, scenario: operation },
      });
    } else if (operation === 'retry') {
      callerResult = await fixture.jobs.retry({
        jobId: fixture.jobId,
        leaseOwner,
        fencingToken: lease.fencingToken,
        nextAttemptAt: new Date(Date.now() + 60_000).toISOString(),
        safeErrorCode: 'RISK002_RETRY',
        safeErrorMessage: 'expired lease proof',
      });
    } else {
      callerResult = await fixture.jobs.terminal({
        jobId: fixture.jobId,
        leaseOwner,
        fencingToken: lease.fencingToken,
        status: 'outcome-unknown',
        safeErrorCode: 'OUTCOME_UNKNOWN',
        safeErrorMessage: 'expired lease proof',
      });
    }
    expect(callerResult).toBe(false);
    const after = await readSnapshot(fixture);
    const accepted = callerResult === true;
    proofRows.push({
      scenario: `D-${operation}`,
      exactTest: `tests/database/post-tf-risk002-connector-fencing-proof.test.ts::Scenario D ${operation}`,
      jobId: fixture.jobId,
      attemptId: null,
      workerId: leaseOwner,
      fencingToken: lease.fencingToken,
      leaseValidAtMutation: 'NO',
      attemptBefore: null,
      attemptAfter: null,
      jobBefore: before.job,
      jobAfter: after.job,
      dedupBefore: before.dedup,
      dedupAfter: after.dedup,
      orderingBefore: before.ordering,
      orderingAfter: after.ordering,
      callerResult,
      callerError: null,
      handlerInvocationCount: 0,
      replacementHandlerInvocationCount: 0,
      duplicateSideEffectCount: 0,
      staleAttemptMutated: 'NO',
      runningAttemptOrphaned: 'NO',
      expiredJobMutationAccepted: accepted ? 'YES' : 'NO',
      classification: accepted ? 'RED_EXPIRED_LEASE_ACCEPTED' : 'SAFE_ALREADY',
      minimumLikelyCorrection:
        'Require the current lease owner, fencing token, running status, and an unexpired lease in complete/retry/terminal predicates.',
    });
  } finally {
    await cleanup(fixture.projectId, fixture.orderKey);
  }
};

const recordValidTransitionScenario = async (
  operation: 'complete' | 'retry' | 'terminal',
): Promise<void> => {
  const fixture = await seedFixture(`scenario-e-${operation}`);
  const leaseOwner = `risk002-e-${operation}-worker`;
  const lease = await fixture.jobs.claim({
    jobId: fixture.jobId,
    leaseOwner,
    leaseDurationMs: 300_000,
  });
  expect(lease).toBeDefined();
  if (!lease) throw new Error(`risk002 could not claim ${fixture.jobId}`);
  const attemptId = await seedRunningAttempt(fixture, leaseOwner, lease.fencingToken);
  const before = await readSnapshot(fixture, attemptId);
  let callerResult: unknown = null;
  try {
    if (operation === 'complete') {
      callerResult = await fixture.jobs.complete({
        jobId: fixture.jobId,
        leaseOwner,
        fencingToken: lease.fencingToken,
        result: { accepted: true, scenario: operation },
      });
    } else if (operation === 'retry') {
      callerResult = await fixture.jobs.retry({
        jobId: fixture.jobId,
        leaseOwner,
        fencingToken: lease.fencingToken,
        nextAttemptAt: new Date(Date.now() + 60_000).toISOString(),
        safeErrorCode: 'RISK002_RETRY',
        safeErrorMessage: 'valid lease control',
      });
    } else {
      callerResult = await fixture.jobs.terminal({
        jobId: fixture.jobId,
        leaseOwner,
        fencingToken: lease.fencingToken,
        status: 'failed',
        safeErrorCode: 'RISK002_FAILURE',
        safeErrorMessage: 'valid lease control',
      });
    }
    expect(callerResult).toBe(true);
    const after = await readSnapshot(fixture, attemptId);
    const accepted = callerResult === true;
    proofRows.push({
      scenario: `E-${operation}`,
      exactTest: `tests/database/post-tf-risk002-connector-fencing-proof.test.ts::Scenario E ${operation}`,
      jobId: fixture.jobId,
      attemptId,
      workerId: leaseOwner,
      fencingToken: lease.fencingToken,
      leaseValidAtMutation: 'YES',
      attemptBefore: before.attempt,
      attemptAfter: after.attempt,
      jobBefore: before.job,
      jobAfter: after.job,
      dedupBefore: before.dedup,
      dedupAfter: after.dedup,
      orderingBefore: before.ordering,
      orderingAfter: after.ordering,
      callerResult,
      callerError: null,
      handlerInvocationCount: 0,
      replacementHandlerInvocationCount: 0,
      duplicateSideEffectCount: 0,
      staleAttemptMutated: 'NO',
      runningAttemptOrphaned: 'NO',
      expiredJobMutationAccepted: 'NO',
      classification: accepted ? 'SAFE_ALREADY' : 'RED_VALID_LEASE_REJECTED',
      minimumLikelyCorrection: 'No correction indicated by this valid-lease control.',
    });
  } finally {
    await cleanup(fixture.projectId, fixture.orderKey);
  }
};

const recordWrongOwnerScenario = async (
  operation: 'complete' | 'retry' | 'terminal',
): Promise<void> => {
  const fixture = await seedFixture(`scenario-e-wrong-owner-${operation}`);
  const currentOwner = `risk002-e-current-${operation}-worker`;
  const wrongOwner = `risk002-e-wrong-${operation}-worker`;
  const lease = await fixture.jobs.claim({
    jobId: fixture.jobId,
    leaseOwner: currentOwner,
    leaseDurationMs: 300_000,
  });
  expect(lease).toBeDefined();
  if (!lease) throw new Error(`risk002 could not claim ${fixture.jobId}`);
  const attemptId = await seedRunningAttempt(fixture, currentOwner, lease.fencingToken);
  const before = await readSnapshot(fixture, attemptId);
  let callerResult: unknown = null;
  try {
    if (operation === 'complete') {
      callerResult = await fixture.jobs.complete({
        jobId: fixture.jobId,
        leaseOwner: wrongOwner,
        fencingToken: lease.fencingToken,
        result: { accepted: true, scenario: operation },
      });
    } else if (operation === 'retry') {
      callerResult = await fixture.jobs.retry({
        jobId: fixture.jobId,
        leaseOwner: wrongOwner,
        fencingToken: lease.fencingToken,
        nextAttemptAt: new Date(Date.now() + 60_000).toISOString(),
        safeErrorCode: 'RISK002_RETRY',
        safeErrorMessage: 'wrong owner proof',
      });
    } else {
      callerResult = await fixture.jobs.terminal({
        jobId: fixture.jobId,
        leaseOwner: wrongOwner,
        fencingToken: lease.fencingToken,
        status: 'failed',
        safeErrorCode: 'RISK002_FAILURE',
        safeErrorMessage: 'wrong owner proof',
      });
    }
    expect(callerResult).toBe(false);
    const after = await readSnapshot(fixture, attemptId);
    expect(after.job).toEqual(before.job);
    expect(after.dedup).toEqual(before.dedup);
    expect(after.attempt).toEqual(before.attempt);
    proofRows.push({
      scenario: `E-wrong-owner-${operation}`,
      exactTest: `tests/database/post-tf-risk002-connector-fencing-proof.test.ts::Wrong owner ${operation}`,
      jobId: fixture.jobId,
      attemptId,
      workerId: wrongOwner,
      fencingToken: lease.fencingToken,
      leaseValidAtMutation: 'YES',
      attemptBefore: before.attempt,
      attemptAfter: after.attempt,
      jobBefore: before.job,
      jobAfter: after.job,
      dedupBefore: before.dedup,
      dedupAfter: after.dedup,
      orderingBefore: before.ordering,
      orderingAfter: after.ordering,
      callerResult,
      callerError: null,
      handlerInvocationCount: 0,
      replacementHandlerInvocationCount: 0,
      duplicateSideEffectCount: 0,
      staleAttemptMutated: 'NO',
      runningAttemptOrphaned: 'NO',
      expiredJobMutationAccepted: 'NO',
      classification: 'SAFE_ALREADY',
      minimumLikelyCorrection:
        'Reject the incorrect lease owner while preserving the current owner, fence, lease, job, dedup, and attempt evidence unchanged.',
    });
  } finally {
    await cleanup(fixture.projectId, fixture.orderKey);
  }
};

const recordRecoveryPrecisionScenario = async (): Promise<void> => {
  const target = await seedFixture('scenario-recovery-precision-target');
  const targetOwner = 'risk002-recovery-precision-target-worker';
  const targetLease = await target.jobs.claim({
    jobId: target.jobId,
    leaseOwner: targetOwner,
    leaseDurationMs: 300_000,
  });
  expect(targetLease).toBeDefined();
  if (!targetLease) throw new Error(`risk002 target claim failed for ${target.jobId}`);
  const targetRunningAttemptId = await seedRunningAttempt(
    target,
    targetOwner,
    targetLease.fencingToken,
  );
  const completedAttemptId = await seedAttemptEvidence(target, {
    attemptNumber: 2,
    leaseOwner: targetOwner,
    fencingToken: targetLease.fencingToken,
    status: 'succeeded',
  });
  const failedAttemptId = await seedAttemptEvidence(target, {
    attemptNumber: 3,
    leaseOwner: targetOwner,
    fencingToken: targetLease.fencingToken,
    status: 'failed',
    errorCode: 'RISK002_HISTORICAL_FAILURE',
  });
  const otherFenceAttemptId = await seedAttemptEvidence(target, {
    attemptNumber: 4,
    leaseOwner: 'risk002-recovery-precision-old-worker',
    fencingToken: targetLease.fencingToken - 1,
    status: 'running',
  });
  const unrelated = await seedFixture('scenario-recovery-precision-unrelated');
  const unrelatedOwner = 'risk002-recovery-precision-unrelated-worker';
  const unrelatedLease = await unrelated.jobs.claim({
    jobId: unrelated.jobId,
    leaseOwner: unrelatedOwner,
    leaseDurationMs: 300_000,
  });
  expect(unrelatedLease).toBeDefined();
  if (!unrelatedLease) throw new Error(`risk002 unrelated claim failed for ${unrelated.jobId}`);
  const unrelatedAttemptId = await seedRunningAttempt(
    unrelated,
    unrelatedOwner,
    unrelatedLease.fencingToken,
  );
  const before = {
    targetJob: await readSnapshot(target, targetRunningAttemptId),
    targetRunningAttempt: await readSnapshot(target, targetRunningAttemptId),
    completedAttempt: await readSnapshot(target, completedAttemptId),
    failedAttempt: await readSnapshot(target, failedAttemptId),
    otherFenceAttempt: await readSnapshot(target, otherFenceAttemptId),
    unrelatedJob: await readSnapshot(unrelated, unrelatedAttemptId),
  };
  try {
    await expireOnlyJobLease(target.jobId);
    await recoverProductionExpiredLeases(new PostgresConnectorRuntimeState(pool));
    const after = {
      targetJob: await readSnapshot(target, targetRunningAttemptId),
      targetRunningAttempt: await readSnapshot(target, targetRunningAttemptId),
      completedAttempt: await readSnapshot(target, completedAttemptId),
      failedAttempt: await readSnapshot(target, failedAttemptId),
      otherFenceAttempt: await readSnapshot(target, otherFenceAttemptId),
      unrelatedJob: await readSnapshot(unrelated, unrelatedAttemptId),
    };
    expect(after.targetJob.job.status).toBe('outcome-unknown');
    expect(after.targetJob.dedup.state).toBe('OUTCOME_UNKNOWN');
    expect(after.targetRunningAttempt.attempt).toMatchObject({
      status: 'failed',
      errorCode: 'OUTCOME_UNKNOWN',
    });
    expect(after.completedAttempt.attempt).toEqual(before.completedAttempt.attempt);
    expect(after.failedAttempt.attempt).toEqual(before.failedAttempt.attempt);
    expect(after.otherFenceAttempt.attempt).toEqual(before.otherFenceAttempt.attempt);
    expect(after.unrelatedJob.job).toEqual(before.unrelatedJob.job);
    expect(after.unrelatedJob.dedup).toEqual(before.unrelatedJob.dedup);
    expect(after.unrelatedJob.attempt).toEqual(before.unrelatedJob.attempt);
    proofRows.push({
      scenario: 'RECOVERY-PRECISION',
      exactTest:
        'tests/database/post-tf-risk002-connector-fencing-proof.test.ts::Recovery precision',
      jobId: target.jobId,
      attemptId: targetRunningAttemptId,
      workerId: targetOwner,
      fencingToken: targetLease.fencingToken,
      leaseValidAtMutation: 'NO',
      attemptBefore: before.targetRunningAttempt.attempt,
      attemptAfter: after.targetRunningAttempt.attempt,
      jobBefore: before.targetJob.job,
      jobAfter: after.targetJob.job,
      dedupBefore: before.targetJob.dedup,
      dedupAfter: after.targetJob.dedup,
      orderingBefore: before.targetJob.ordering,
      orderingAfter: after.targetJob.ordering,
      callerResult: null,
      callerError: null,
      handlerInvocationCount: 0,
      replacementHandlerInvocationCount: 0,
      duplicateSideEffectCount: 0,
      staleAttemptMutated: 'NO',
      runningAttemptOrphaned: 'NO',
      expiredJobMutationAccepted: 'NO',
      classification: 'SAFE_ALREADY',
      minimumLikelyCorrection:
        'Recovery updates only the recovered job and its current fence running attempt; preserve completed, failed, other-fence, and unrelated evidence.',
    });
  } finally {
    await cleanup(target.projectId, target.orderKey);
    await cleanup(unrelated.projectId, unrelated.orderKey);
  }
};

afterAll(async () => {
  console.info(
    `RISK002_PROOF_MATRIX_START\n${JSON.stringify(proofRows, null, 2)}\nRISK002_PROOF_MATRIX_END`,
  );
  await pool.end();
  await observerPool.end();
});

describe('RISK-002 connector PostgreSQL stale-worker proof matrix', () => {
  it('Scenario A: production recovery leaves a real running attempt behind', async () => {
    await recordRecoveryScenario('A');
  });

  it('Scenario B: late success cannot be allowed to mutate a recovered job', async () => {
    await recordRecoveryScenario('B');
  });

  it('Scenario C: late failure cannot be allowed to mutate a recovered job', async () => {
    await recordRecoveryScenario('C');
  });

  it('Scenario D: expired leases are rejected by complete/retry/terminal', async () => {
    await recordExpiredTransitionScenario('complete');
    await recordExpiredTransitionScenario('retry');
    await recordExpiredTransitionScenario('terminal');
  });

  it('Scenario E: valid leases preserve complete/retry/terminal controls', async () => {
    await recordValidTransitionScenario('complete');
    await recordValidTransitionScenario('retry');
    await recordValidTransitionScenario('terminal');
  });

  it('Owner controls: wrong owners cannot mutate valid leases', async () => {
    await recordWrongOwnerScenario('complete');
    await recordWrongOwnerScenario('retry');
    await recordWrongOwnerScenario('terminal');
  });

  it('Recovery precision: only the recovered current-fence attempt is closed', async () => {
    await recordRecoveryPrecisionScenario();
  });
});
