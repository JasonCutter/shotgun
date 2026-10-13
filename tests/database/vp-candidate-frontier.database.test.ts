import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import { PostgresProjectAdministrationRepository } from '../../adapters/postgres/src/index.js';
import { PostgresVPRelationJobs } from '../../adapters/vp-knowledge-postgres/src/relation-jobs.js';
import { readCandidateFrontierStatus } from '../../adapters/vp-knowledge-postgres/src/frontier-store.js';
import { PostgresCandidateFrontier } from '../../adapters/vp-knowledge-postgres/src/frontier-store.js';
import {
  createIsolatedPostgresTestDatabase,
  type IsolatedPostgresTestDatabase,
} from '../helpers/isolated-postgres-test-database.js';
import { seedAssertion } from '../helpers/vp-frontier-assertion.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';
const target = await requireTestDatabaseTarget();
let db: IsolatedPostgresTestDatabase, pool: Pool, project: string, principal: string;
const policy = 'vp-deepseek-relation-v6-evidence-context';
describe.skipIf(!target)('persistent current Frontier with fake/no provider egress', () => {
  beforeAll(async () => {
    db = await createIsolatedPostgresTestDatabase();
    pool = db.createPool();
    project = 'frontier-' + randomUUID();
    principal = (
      await new PostgresAuthRepository(pool).bootstrapLocalOwnerPrincipal({
        accountId: 'frontier-' + randomUUID(),
      })
    ).principalId;
    await new PostgresProjectAdministrationRepository(pool).createProject({
      commandId: randomUUID(),
      clientRequestId: randomUUID(),
      idempotencyKey: randomUUID(),
      projectId: project,
      name: 'Frontier isolated',
      actorPrincipalId: principal,
      expectedProjectRevision: 0,
    });
  }, 60000);
  afterAll(async () => {
    await db?.dispose();
  });
  it('persists empty completeness instead of returning an unpersisted random identity', async () => {
    const jobs = new PostgresVPRelationJobs(pool, 100, 3, true, true);
    const frontier = new PostgresCandidateFrontier(pool, 3);
    expect((await frontier.status(project, policy)).generationComplete).toBe(false);
    await frontier.ensure(policy);
    const before = await frontier.status(project, policy);
    expect(before).toMatchObject({
      generationComplete: true,
      executionComplete: true,
      candidateCount: 0,
    });
    await new PostgresVPRelationJobs(pool, 100, 3, true, true).ensureCurrentFrontier(policy);
    expect((await jobs.readCurrentFrontierStatus(project, policy)).frontierId).toBe(
      before.frontierId,
    );
  });
  it('atomically creates one membership/job across independent connections without consuming local/global attempts', async () => {
    await seedAssertion(pool, {
      projectId: project,
      principalId: principal,
      assertionId: randomUUID(),
      text: 'At 300 K the pressure is 42 kPa.',
    });
    await seedAssertion(pool, {
      projectId: project,
      principalId: principal,
      assertionId: randomUUID(),
      text: 'At 300 K the pressure is 43 kPa.',
    });
    const jobs = new PostgresVPRelationJobs(pool, 100, 3, true, true);
    expect((await jobs.readCurrentFrontierStatus(project, policy)).current).toBe(false);
    const other = db.createPool();
    await Promise.all([
      jobs.ensureCurrentFrontier(policy),
      new PostgresVPRelationJobs(other, 100, 3, true, true).ensureCurrentFrontier(policy),
    ]);
    expect(await jobs.readCurrentFrontierStatus(project, policy)).toMatchObject({
      generationComplete: true,
      executionComplete: false,
      candidateCount: 1,
      pending: 1,
    });
    const rows = (
      await pool.query('SELECT attempt_count FROM vp.relation_jobs WHERE project_id=$1', [project])
    ).rows;
    expect(rows).toEqual([{ attempt_count: 0 }]);
    const claim = await jobs.claimNext(policy);
    expect(claim).toBeDefined();
    expect(claim!.attemptCount).toBe(0);
    expect(
      await jobs.completeUnresolved({
        jobId: claim!.jobId,
        leaseToken: claim!.leaseToken,
        code: 'INSUFFICIENT_EVIDENCE',
      }),
    ).toBe(true);
    expect(await jobs.readCurrentFrontierStatus(project, policy)).toMatchObject({
      executionComplete: true,
      pending: 0,
    });
    expect(
      (
        await pool.query(
          'SELECT count(*)::int n FROM vp.relation_provider_calls WHERE project_id=$1',
          [project],
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it('invalidates the old snapshot, preserves history and distinguishes FAILED/UNKNOWN from completion', async () => {
    const jobs = new PostgresVPRelationJobs(pool, 100, 3, true, true);
    const prior = await jobs.readCurrentFrontierStatus(project, policy);
    await seedAssertion(pool, {
      projectId: project,
      principalId: principal,
      assertionId: randomUUID(),
      text: 'Only licensed users may access the pressure archive.',
    });
    expect((await jobs.readCurrentFrontierStatus(project, policy)).generationComplete).toBe(false);
    await jobs.ensureCurrentFrontier(policy);
    const next = await jobs.readCurrentFrontierStatus(project, policy);
    expect(next.frontierId).not.toBe(prior.frontierId);
    expect(next.candidateCount).toBe(3);
    expect(next.pending).toBe(2);
    await pool.query(
      "UPDATE vp.relation_jobs SET status='OUTCOME_UNKNOWN' WHERE project_id=$1 AND status='PENDING'",
      [project],
    );
    expect(await jobs.readCurrentFrontierStatus(project, policy)).toMatchObject({
      generationComplete: true,
      executionComplete: false,
      unknown: 2,
      pending: 0,
    });
    expect(
      (
        await pool.query('SELECT count(*)::int n FROM vp.candidate_frontiers WHERE project_id=$1', [
          project,
        ])
      ).rows[0].n,
    ).toBe(3);
    expect(
      (
        await pool.query(
          'SELECT sum(attempt_count)::int n FROM vp.relation_jobs WHERE project_id=$1',
          [project],
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it('rejects same-count rank or membership-digest corruption instead of silently repairing it', async () => {
    const jobs = new PostgresVPRelationJobs(pool, 100, 3, true, true);
    const current = await jobs.readCurrentFrontierStatus(project, policy);
    expect(current.membershipIntegrity).toBe(true);
    const member = (
      await pool.query<{ job_id: string }>(
        'SELECT job_id::text FROM vp.candidate_frontier_members WHERE frontier_id=$1 AND rank=1',
        [current.frontierId],
      )
    ).rows[0]!;
    try {
      await pool.query(
        'UPDATE vp.candidate_frontier_members SET rank=10000 WHERE frontier_id=$1 AND job_id=$2',
        [current.frontierId, member.job_id],
      );
      expect(await jobs.readCurrentFrontierStatus(project, policy)).toMatchObject({
        current: true,
        candidateCount: current.candidateCount,
        membershipIntegrity: false,
        generationComplete: false,
        executionComplete: false,
      });
      await expect(jobs.ensureCurrentFrontier(policy)).rejects.toThrow(
        'FRONTIER_MEMBERSHIP_INTEGRITY_FAILED',
      );
    } finally {
      await pool.query(
        'UPDATE vp.candidate_frontier_members SET rank=1 WHERE frontier_id=$1 AND job_id=$2',
        [current.frontierId, member.job_id],
      );
    }
    const header = (
      await pool.query<{ membership_digest: string }>(
        'SELECT membership_digest FROM vp.candidate_frontiers WHERE frontier_id=$1',
        [current.frontierId],
      )
    ).rows[0]!;
    try {
      await pool.query(
        'UPDATE vp.candidate_frontiers SET membership_digest=$2 WHERE frontier_id=$1',
        [current.frontierId, 'sha256:' + '0'.repeat(64)],
      );
      expect((await jobs.readCurrentFrontierStatus(project, policy)).membershipIntegrity).toBe(
        false,
      );
      await expect(jobs.ensureCurrentFrontier(policy)).rejects.toThrow(
        'FRONTIER_MEMBERSHIP_INTEGRITY_FAILED',
      );
    } finally {
      await pool.query(
        'UPDATE vp.candidate_frontiers SET membership_digest=$2 WHERE frontier_id=$1',
        [current.frontierId, header.membership_digest],
      );
    }
    expect((await jobs.readCurrentFrontierStatus(project, policy)).membershipIntegrity).toBe(true);
  });
  it('rejects a same-count job binding from another policy', async () => {
    const jobs = new PostgresVPRelationJobs(pool, 100, 3, true, true);
    const current = await jobs.readCurrentFrontierStatus(project, policy);
    const member = (
      await pool.query<{ job_id: string }>(
        'SELECT job_id::text FROM vp.candidate_frontier_members WHERE frontier_id=$1 AND rank=1',
        [current.frontierId],
      )
    ).rows[0]!;
    const foreignJob = randomUUID();
    await pool.query(
      `INSERT INTO vp.relation_jobs(job_id,project_id,left_assertion_id,right_assertion_id,policy_revision,max_attempts)
      SELECT $1,project_id,left_assertion_id,right_assertion_id,'synthetic-foreign-policy',max_attempts FROM vp.relation_jobs WHERE job_id=$2`,
      [foreignJob, member.job_id],
    );
    try {
      await pool.query(
        'UPDATE vp.candidate_frontier_members SET job_id=$3 WHERE frontier_id=$1 AND job_id=$2',
        [current.frontierId, member.job_id, foreignJob],
      );
      expect(await jobs.readCurrentFrontierStatus(project, policy)).toMatchObject({
        candidateCount: current.candidateCount,
        membershipIntegrity: false,
        executionComplete: false,
      });
      await expect(jobs.ensureCurrentFrontier(policy)).rejects.toThrow(
        'FRONTIER_MEMBERSHIP_INTEGRITY_FAILED',
      );
    } finally {
      await pool.query(
        'UPDATE vp.candidate_frontier_members SET job_id=$3 WHERE frontier_id=$1 AND job_id=$2',
        [current.frontierId, foreignJob, member.job_id],
      );
      await pool.query('DELETE FROM vp.relation_jobs WHERE job_id=$1', [foreignJob]);
    }
  });
  it('does not report a retired or unknown project as an available empty completed frontier', async () => {
    const jobs = new PostgresVPRelationJobs(pool, 100, 3, true, true);
    expect(await jobs.readCurrentFrontierStatus('not-a-project', policy)).toMatchObject({
      available: false,
      current: false,
      generationComplete: false,
      executionComplete: false,
    });
    const job = (
      await pool.query<{ job_id: string; status: string }>(
        'SELECT job_id::text,status FROM vp.relation_jobs WHERE project_id=$1 ORDER BY job_id LIMIT 1',
        [project],
      )
    ).rows[0]!;
    try {
      await pool.query("UPDATE vp.relation_jobs SET status='PENDING' WHERE job_id=$1", [
        job.job_id,
      ]);
      await pool.query('UPDATE project_admin.projects SET active=false WHERE id=$1', [project]);
      expect(await jobs.readCurrentFrontierStatus(project, policy)).toMatchObject({
        available: false,
        current: false,
        generationComplete: false,
        membershipIntegrity: false,
        executionComplete: false,
      });
      expect(await jobs.claimNext(policy)).toBeUndefined();
    } finally {
      await pool.query('UPDATE project_admin.projects SET active=true WHERE id=$1', [project]);
      await pool.query('UPDATE vp.relation_jobs SET status=$2 WHERE job_id=$1', [
        job.job_id,
        job.status,
      ]);
    }
    expect((await jobs.readCurrentFrontierStatus(project, policy)).membershipIntegrity).toBe(true);
  });
  it('requires one explicit repeatable-read snapshot for direct status helper callers', async () => {
    const client = await pool.connect();
    try {
      await expect(readCandidateFrontierStatus(client, project, policy)).rejects.toThrow(
        'FRONTIER_STATUS_SNAPSHOT_REQUIRED',
      );
    } finally {
      client.release();
    }
  });
});
