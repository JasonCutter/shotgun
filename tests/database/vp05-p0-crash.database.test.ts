import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { expect, it } from 'vitest';
import { PostgresVPRelationJobs } from '../../adapters/vp-knowledge-postgres/src/relation-jobs.js';
import { PostgresGlobalRelationBudget } from '../../adapters/vp-global-provider-budget-postgres/src/index.js';
import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import { PostgresProjectAdministrationRepository } from '../../adapters/postgres/src/index.js';
import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';
import { seedAssertion } from '../helpers/vp05-p0-fixtures.js';
it('preserves attempts across pre-activation crashes and fences an activated unknown egress', async () => {
  const database = await createIsolatedPostgresTestDatabase();
  const authorityDb = await createIsolatedPostgresTestDatabase();
  const pool = database.createPool();
  const authorityPool = authorityDb.createPool();
  try {
    const projectId = `vp-attempt-crash-${randomUUID()}`;
    const principal = await new PostgresAuthRepository(pool).bootstrapLocalOwnerPrincipal({
      accountId: `vp-attempt-crash-owner-${randomUUID()}`,
    });
    await new PostgresProjectAdministrationRepository(pool).createProject({
      commandId: randomUUID(),
      clientRequestId: randomUUID(),
      idempotencyKey: randomUUID(),
      projectId,
      name: 'VP execution boundary crash',
      description: 'bounded relation attempt',
      actorPrincipalId: principal.principalId,
      expectedProjectRevision: 0,
    });
    await seedAssertion(pool, {
      projectId,
      principalId: principal.principalId,
      assertionId: randomUUID(),
      text: '2025 income was 100.',
    });
    await seedAssertion(pool, {
      projectId,
      principalId: principal.principalId,
      assertionId: randomUUID(),
      text: '2025 income was 200.',
    });
    const storeId = randomUUID();
    const authorityId = randomUUID();
    await authorityPool.query(
      'INSERT INTO vp_global_budget.authority_store (store_id) VALUES ($1)',
      [storeId],
    );
    await authorityPool.query(
      `INSERT INTO vp_global_budget.policies
        (authority_id, provider, account_fingerprint, workload_class, budget_timezone, daily_limit)
       VALUES ($1, 'deepseek', $2, 'VP_RELATION', 'UTC', 100)`,
      [authorityId, 'f'.repeat(64)],
    );
    const budget = new PostgresGlobalRelationBudget(authorityPool, {
      storeId,
      authorityId,
      provider: 'deepseek',
      accountFingerprint: 'f'.repeat(64),
      dailyLimit: 100,
    });
    const jobs = new PostgresVPRelationJobs(pool, 100, 3, true);
    const policyRevision = 'vp-deepseek-relation-v6-evidence-context';
    expect(await jobs.enqueueCurrentPairs(policyRevision, 1)).toBe(1);
    const first = (await jobs.claimNext(policyRevision))!;
    expect(first.attemptCount).toBe(0);
    const executionKey = `sha256:${'a'.repeat(64)}`;
    const requestDigest = `sha256:${'b'.repeat(64)}`;
    const reservation = {
      workloadIdentity: 'shotgun-app',
      projectId,
      relationJobId: first.jobId,
      semanticAttemptId: first.leaseToken,
      executionKey,
      providerIdentity: 'deepseek/deepseek-flash',
    };
    const oldClaim = await budget.reserveAttempt(reservation);
    expect((await budget.status()).claimedCount).toBe(1);
    expect(
      await jobs.hasActivatedAttempt({
        jobId: first.jobId,
        semanticAttemptId: first.leaseToken,
        globalClaimId: oldClaim.claimId,
      }),
    ).toBe(false);
    expect(
      (
        await pool.query<{ attempt_count: number }>(
          'SELECT attempt_count FROM vp.relation_jobs WHERE job_id = $1',
          [first.jobId],
        )
      ).rows[0]?.attempt_count,
    ).toBe(0);
    await pool.query(
      "UPDATE vp.relation_jobs SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE job_id = $1",
      [first.jobId],
    );
    const resumed = (await new PostgresVPRelationJobs(pool, 100, 3, true).claimNext(
      policyRevision,
    ))!;
    expect(resumed.jobId).toBe(first.jobId);
    expect(resumed.attemptCount).toBe(0);
    await budget.releaseUnused(oldClaim);
    expect((await budget.status()).claimedCount).toBe(0);
    const claim = await budget.reserveAttempt({
      ...reservation,
      semanticAttemptId: resumed.leaseToken,
    });
    expect((await budget.status()).claimedCount).toBe(1);
    await budget.authorizeExecution({
      claim,
      ...reservation,
      semanticAttemptId: resumed.leaseToken,
    });
    const activation = await jobs.claim({
      projectId,
      jobId: resumed.jobId,
      leaseToken: resumed.leaseToken,
      executionKey,
      requestDigest,
      providerIdentity: reservation.providerIdentity,
      globalClaimId: claim.claimId,
      semanticAttemptId: resumed.leaseToken,
    });
    expect(activation.status).toBe('STARTED');
    expect(
      await jobs.hasActivatedAttempt({
        jobId: resumed.jobId,
        semanticAttemptId: resumed.leaseToken,
        globalClaimId: claim.claimId,
      }),
    ).toBe(true);
    const local = await pool.query<{
      attempt_count: number;
      claimed_count: number;
      global_claim_id: string;
      semantic_attempt_id: string;
    }>(
      `SELECT job.attempt_count, budget.claimed_count, call.global_claim_id::text,
              call.semantic_attempt_id::text
         FROM vp.relation_jobs AS job
         JOIN vp.relation_provider_calls AS call USING (project_id, job_id)
         JOIN vp.relation_call_budget AS budget ON budget.budget_day = CURRENT_DATE
        WHERE job.job_id = $1`,
      [resumed.jobId],
    );
    expect(local.rows).toEqual([
      {
        attempt_count: 1,
        claimed_count: 1,
        global_claim_id: claim.claimId,
        semantic_attempt_id: resumed.leaseToken,
      },
    ]);
    await pool.query(
      "UPDATE vp.relation_jobs SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE job_id = $1",
      [resumed.jobId],
    );
    expect(await jobs.claimNext(policyRevision)).toBeUndefined();
    const unknown = await pool.query<{ status: string; attempt_count: number; state: string }>(
      `SELECT job.status, job.attempt_count, call.state
         FROM vp.relation_jobs AS job JOIN vp.relation_provider_calls AS call USING (project_id, job_id)
        WHERE job.job_id = $1`,
      [resumed.jobId],
    );
    expect(unknown.rows).toEqual([
      { status: 'OUTCOME_UNKNOWN', attempt_count: 1, state: 'OUTCOME_UNKNOWN' },
    ]);
    expect((await budget.status()).claimedCount).toBe(1);
  } finally {
    await Promise.all([database.dispose(), authorityDb.dispose()]);
  }
}, 60_000);

it('fences a global claim after an OS worker is killed following fake HTTP success', async () => {
  const database = await createIsolatedPostgresTestDatabase();
  const authorityDb = await createIsolatedPostgresTestDatabase();
  const pool = database.createPool(),
    authorityPool = authorityDb.createPool();
  let accepted = 0;
  const server = createServer((_request, response) => {
    accepted++;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"accepted":true}');
  });
  let child: ReturnType<typeof fork> | undefined;
  try {
    const projectId = 'process-' + randomUUID();
    const principal = await new PostgresAuthRepository(pool).bootstrapLocalOwnerPrincipal({
      accountId: projectId,
    });
    await new PostgresProjectAdministrationRepository(pool).createProject({
      commandId: randomUUID(),
      clientRequestId: randomUUID(),
      idempotencyKey: randomUUID(),
      projectId,
      name: 'Global process crash',
      description: 'loopback HTTP only',
      actorPrincipalId: principal.principalId,
      expectedProjectRevision: 0,
    });
    for (const text of ['The rate was 4 percent.', 'The rate was 2 percent.'])
      await seedAssertion(pool, {
        projectId,
        principalId: principal.principalId,
        assertionId: randomUUID(),
        text,
      });
    const storeId = randomUUID(),
      authorityId = randomUUID();
    await authorityPool.query('INSERT INTO vp_global_budget.authority_store(store_id) VALUES($1)', [
      storeId,
    ]);
    await authorityPool.query(
      `INSERT INTO vp_global_budget.policies(authority_id,provider,account_fingerprint,workload_class,budget_timezone,daily_limit) VALUES($1,'deepseek',$2,'VP_RELATION','UTC',100)`,
      [authorityId, '2'.repeat(64)],
    );
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing loopback port');
    child = fork('tests/helpers/vp05-p0-kill-after-egress.ts', [], {
      execArgv: ['--import', 'tsx'],
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      env: {
        ...process.env,
        DATABASE_URL: undefined,
        TEST_DATABASE_URL: database.databaseUrl,
        VP_GLOBAL_RELATION_BUDGET_DATABASE_URL: authorityDb.databaseUrl,
        VP_GLOBAL_RELATION_BUDGET_STORE_ID: storeId,
        VP_GLOBAL_RELATION_BUDGET_AUTHORITY_ID: authorityId,
        VP_GLOBAL_RELATION_BUDGET_ACCOUNT_FINGERPRINT: '2'.repeat(64),
        VP_P0_FAKE_HTTP_URL: `http://127.0.0.1:${address.port}/`,
      },
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Crash probe timed out')), 30000);
      child!.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child!.once('exit', () => {
        clearTimeout(timer);
        reject(new Error('Crash probe exited before egress'));
      });
      child!.once('message', (message) => {
        clearTimeout(timer);
        expect(message).toEqual({ type: 'fake-http-response-received' });
        resolve();
      });
    });
    const exited = once(child, 'exit');
    child.kill();
    await exited;
    expect(accepted).toBe(1);
    await pool.query(
      `UPDATE vp.relation_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE project_id=$1`,
      [projectId],
    );
    const restarted = new PostgresVPRelationJobs(pool);
    expect(await restarted.claimNext('vp-deepseek-relation-v6-evidence-context')).toBeUndefined();
    expect(await restarted.claimNext('vp-deepseek-relation-v6-evidence-context')).toBeUndefined();
    const local = (
      await pool.query(
        `SELECT job.status,job.attempt_count,call.state,call.global_claim_id::text,call.semantic_attempt_id::text FROM vp.relation_jobs job JOIN vp.relation_provider_calls call USING(project_id,job_id) WHERE job.project_id=$1`,
        [projectId],
      )
    ).rows;
    expect(local).toEqual([
      expect.objectContaining({
        status: 'OUTCOME_UNKNOWN',
        attempt_count: 1,
        state: 'OUTCOME_UNKNOWN',
      }),
    ]);
    const global = (
      await authorityPool.query(
        `SELECT claim_id::text,semantic_attempt_id::text,state,execution_authorized_at IS NOT NULL AS armed FROM vp_global_budget.claims`,
      )
    ).rows;
    expect(global).toEqual([
      {
        claim_id: local[0].global_claim_id,
        semantic_attempt_id: local[0].semantic_attempt_id,
        state: 'RESERVED',
        armed: true,
      },
    ]);
    const budget = new PostgresGlobalRelationBudget(authorityPool, {
      storeId,
      authorityId,
      provider: 'deepseek',
      accountFingerprint: '2'.repeat(64),
      dailyLimit: 100,
    });
    expect((await budget.status()).claimedCount).toBe(1);
    expect(accepted).toBe(1);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    await Promise.all([database.dispose(), authorityDb.dispose()]);
  }
}, 120000);
