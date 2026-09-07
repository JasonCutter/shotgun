import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import {
  PostgresDedupStore,
  PostgresJobRuntime,
} from '../../adapters/connector-runtime-postgres/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { type ConnectorSemanticIdentity } from '../../packages/connector-runtime/src/ports.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool = createPostgresPool(databaseUrl);

afterAll(async () => {
  await pool.end();
});

const identityFor = (projectId: string): ConnectorSemanticIdentity => ({
  projectId,
  securityScope: JSON.stringify({
    accessScope: ['owner'],
    sensitivity: 'public',
    dataClassification: 'adr155-test',
  }),
  consumerId: 'adr155.test:event:PostHandlerOutcomeUnknown',
  messageKind: 'event',
  messageType: 'PostHandlerOutcomeUnknown',
  semanticKey: `adr155:${projectId}`,
  fingerprint: `fingerprint:${projectId}`,
});

const cleanup = async (projectId: string): Promise<void> => {
  await pool.query(
    `DELETE FROM connector.jobs
      WHERE dedup_record_id IN (
        SELECT dedup_record_id FROM connector.dedup_records WHERE project_id=$1
      )`,
    [projectId],
  );
  await pool.query('DELETE FROM connector.dedup_records WHERE project_id=$1', [projectId]);
};

const poolThatFailsAfterMatchingQuery = (base: Pool, matcher: (sql: string) => boolean): Pool => {
  let injected = false;
  return {
    query: async (...args: never[]) => {
      const result = await (base.query as (...input: never[]) => Promise<unknown>)(...args);
      const sql = typeof args[0] === 'string' ? args[0] : '';
      if (!injected && matcher(sql)) {
        injected = true;
        throw new Error('ADR-155 injected acknowledgement loss');
      }
      return result;
    },
    connect: base.connect.bind(base),
  } as unknown as Pool;
};

describe('ADR-155 post-handler outcome-unknown conformance', () => {
  it('converges a committed dedup completion when its acknowledgement is lost', async () => {
    const projectId = `adr155-dedup-ack-${randomUUID()}`;
    const identity = identityFor(projectId);
    const jobId = randomUUID();
    const result = { accepted: true, execution: 1 };
    const base = new PostgresDedupStore(pool);
    const faultPool = poolThatFailsAfterMatchingQuery(
      pool,
      (sql) => sql.includes("SET state='COMPLETED'") && sql.includes('connector.dedup_records'),
    );
    const faulted = new PostgresDedupStore(faultPool);

    try {
      const began = await base.begin({ ...identity, jobId });
      expect(began.kind).toBe('ACQUIRED');
      if (began.kind !== 'ACQUIRED') return;

      await expect(
        faulted.complete({
          identity,
          fenceToken: began.record.fenceToken,
          jobId,
          result,
        }),
      ).resolves.toBeUndefined();

      const duplicate = await base.begin({ ...identity, jobId: randomUUID() });
      expect(duplicate).toMatchObject({
        kind: 'DUPLICATE',
        record: { state: 'COMPLETED', jobId, result },
      });
    } finally {
      await cleanup(projectId);
    }
  });

  it('does not treat an unproven zero-row completion as successful', async () => {
    const projectId = `adr155-dedup-zero-row-${randomUUID()}`;
    const identity = identityFor(projectId);
    const base = new PostgresDedupStore(pool);

    try {
      const began = await base.begin({ ...identity, jobId: randomUUID() });
      expect(began.kind).toBe('ACQUIRED');
      if (began.kind !== 'ACQUIRED' || !began.record.jobId) return;
      await base.complete({
        identity,
        fenceToken: began.record.fenceToken,
        jobId: began.record.jobId,
        result: { accepted: true },
      });

      await expect(
        base.complete({
          identity,
          fenceToken: began.record.fenceToken + 1,
          jobId: randomUUID(),
          result: { accepted: false },
        }),
      ).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    } finally {
      await cleanup(projectId);
    }
  });

  it('converges a committed job completion acknowledgement without a second operation', async () => {
    const projectId = `adr155-job-ack-${randomUUID()}`;
    const identity = identityFor(projectId);
    const dedup = new PostgresDedupStore(pool);
    const jobId = randomUUID();
    const faultPool = poolThatFailsAfterMatchingQuery(
      pool,
      (sql) => sql.includes("SET status='succeeded'") && sql.includes('connector.jobs'),
    );
    const jobs = new PostgresJobRuntime(faultPool);
    let invocations = 0;

    try {
      const began = await dedup.begin({ ...identity, jobId });
      expect(began.kind).toBe('ACQUIRED');
      if (began.kind !== 'ACQUIRED') return;

      const execution = await jobs.run(identity, randomUUID(), async () => {
        invocations += 1;
        return undefined;
      });
      expect(invocations).toBe(1);
      expect(execution.result).toBeUndefined();
      await dedup.complete({
        identity,
        fenceToken: began.record.fenceToken,
        jobId,
        result: execution.result,
      });

      const duplicate = await dedup.begin({ ...identity, jobId: randomUUID() });
      expect(duplicate).toMatchObject({ kind: 'DUPLICATE', record: { state: 'COMPLETED' } });
      expect(invocations).toBe(1);
    } finally {
      await cleanup(projectId);
    }
  });

  it('does not converge a stale job completion from a successor fence', async () => {
    const projectId = `adr155-job-stale-fence-${randomUUID()}`;
    const identity = identityFor(projectId);
    const dedup = new PostgresDedupStore(pool);
    const began = await dedup.begin({ ...identity, jobId: randomUUID() });
    expect(began.kind).toBe('ACQUIRED');
    if (began.kind !== 'ACQUIRED') return;
    const jobs = new PostgresJobRuntime(pool);

    try {
      const execution = await jobs.run(identity, randomUUID(), async () => undefined);
      const fencingToken = execution.job.attempts.at(-1)?.fencingToken;
      expect(fencingToken).toBeDefined();
      expect(execution.result).toBeUndefined();

      await expect(
        jobs.complete({
          jobId: execution.job.jobId,
          fencingToken: fencingToken! + 1,
          result: execution.result,
        }),
      ).resolves.toBe(false);
    } finally {
      await cleanup(projectId);
    }
  });

  it('blocks replacement execution when post-operation job persistence is ambiguous', async () => {
    const projectId = `adr155-job-unknown-${randomUUID()}`;
    const identity = identityFor(projectId);
    const dedup = new PostgresDedupStore(pool);
    const jobId = randomUUID();
    const faultPool = poolThatFailsAfterMatchingQuery(
      pool,
      (sql) => sql.includes("SET status='succeeded'") && sql.includes('connector.job_attempts'),
    );
    const jobs = new PostgresJobRuntime(faultPool);
    let invocations = 0;

    try {
      const began = await dedup.begin({ ...identity, jobId });
      expect(began.kind).toBe('ACQUIRED');
      if (began.kind !== 'ACQUIRED') return;

      await expect(
        jobs.run(identity, randomUUID(), async () => {
          invocations += 1;
          return { accepted: true };
        }),
      ).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
      expect(invocations).toBe(1);

      const job = await jobs.find(identity);
      expect(job?.status).toBe('outcome-unknown');
      await dedup.markOutcomeUnknown({
        identity,
        fenceToken: began.kind === 'ACQUIRED' ? began.record.fenceToken : 0,
        jobId,
        safeErrorMessage: 'post-operation persistence was ambiguous',
      });
      const duplicate = await dedup.begin({ ...identity, jobId: randomUUID() });
      expect(duplicate).toMatchObject({ kind: 'DUPLICATE', record: { state: 'OUTCOME_UNKNOWN' } });
      expect(invocations).toBe(1);
    } finally {
      await cleanup(projectId);
    }
  });
});
