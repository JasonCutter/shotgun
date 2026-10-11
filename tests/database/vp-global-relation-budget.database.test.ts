import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  GlobalRelationBudgetPausedError,
  PostgresGlobalRelationBudget,
} from '../../adapters/vp-global-provider-budget-postgres/src/index.js';
import { globalRelationBudgetFromEnvironment } from '../../adapters/vp-global-provider-budget-postgres/src/config.js';
import {
  createIsolatedPostgresTestDatabase,
  type IsolatedPostgresTestDatabase,
} from '../helpers/isolated-postgres-test-database.js';

const execFileAsync = promisify(execFile);

describe('global relation provider budget authority', () => {
  let authorityDb: IsolatedPostgresTestDatabase;
  let workloadA: IsolatedPostgresTestDatabase;
  let workloadB: IsolatedPostgresTestDatabase;
  const storeId = randomUUID();

  beforeAll(async () => {
    authorityDb = await createIsolatedPostgresTestDatabase();
    await authorityDb
      .createPool()
      .query(`INSERT INTO vp_global_budget.authority_store (store_id) VALUES ($1)`, [storeId]);
    workloadA = await createIsolatedPostgresTestDatabase({ migrate: async () => {} });
    workloadB = await createIsolatedPostgresTestDatabase({ migrate: async () => {} });
  }, 120_000);

  afterAll(async () => {
    await Promise.all([workloadA?.dispose(), workloadB?.dispose(), authorityDb?.dispose()]);
  }, 120_000);

  async function policy(fingerprint: string) {
    const authorityId = randomUUID();
    const pool = authorityDb.createPool();
    await pool.query(
      `INSERT INTO vp_global_budget.policies
         (authority_id, provider, account_fingerprint, workload_class, budget_timezone, daily_limit)
       VALUES ($1, 'deepseek', $2, 'VP_RELATION', 'UTC', 10)`,
      [authorityId, fingerprint],
    );
    return {
      pool,
      authorityId,
      budget: new PostgresGlobalRelationBudget(pool, {
        storeId,
        authorityId,
        provider: 'deepseek',
        accountFingerprint: fingerprint,
        dailyLimit: 10,
      }),
    };
  }

  it('limits simultaneous claims from two isolated workload DBs to ten total', async () => {
    const account = await policy('a'.repeat(64));
    const [a, b] = await Promise.all([
      workloadA.createPool().query('SELECT current_database() AS name'),
      workloadB.createPool().query('SELECT current_database() AS name'),
    ]);
    expect(a.rows[0].name).not.toBe(b.rows[0].name);
    const results = await Promise.allSettled(
      Array.from({ length: 16 }, (_, index) =>
        account.budget.claim(`${index % 2 ? a.rows[0].name : b.rows[0].name}:${index}`),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(10);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(6);
    expect((await account.budget.status()).claimedCount).toBe(10);
  });

  it('reserves and binds one exact semantic attempt idempotently across a lost acknowledgement', async () => {
    const account = await policy('f'.repeat(64));
    const relationJobId = randomUUID();
    const semanticAttemptId = randomUUID();
    const input = {
      workloadIdentity: 'shotgun-app',
      projectId: 'project',
      relationJobId,
      semanticAttemptId,
      executionKey: `sha256:${'a'.repeat(64)}`,
      providerIdentity: 'deepseek/fake-model',
    };
    const first = await account.budget.reserveAttempt(input);
    const repeated = await account.budget.reserveAttempt(input);
    expect(repeated.claimId).toBe(first.claimId);
    const simultaneous = await Promise.all(
      Array.from({ length: 6 }, () => account.budget.reserveAttempt(input)),
    );
    expect(new Set(simultaneous.map((item) => item.claimId))).toEqual(new Set([first.claimId]));
    expect((await account.budget.status()).claimedCount).toBe(1);
    await expect(
      account.budget.reserveAttempt({ ...input, executionKey: `sha256:${'b'.repeat(64)}` }),
    ).rejects.toMatchObject({ reason: 'RECONCILIATION_REQUIRED' });
    await expect(
      account.budget.reserveAttempt({ ...input, semanticAttemptId: randomUUID() }),
    ).rejects.toMatchObject({ reason: 'RECONCILIATION_REQUIRED' });
    expect((await account.budget.reservedForJob(relationJobId))?.claim.claimId).toBe(first.claimId);
    await account.budget.releaseUnused(first);
    expect((await account.budget.status()).claimedCount).toBe(0);
    expect(await account.budget.reservedForJob(relationJobId)).toBeUndefined();
  });

  it('resolves the same provisioned store and counter from two independent runtime contexts', async () => {
    const fingerprint = '5'.repeat(64);
    const authorityId = randomUUID();
    const pool = authorityDb.createPool();
    await pool.query(
      `INSERT INTO vp_global_budget.policies
         (authority_id, provider, account_fingerprint, workload_class, budget_timezone, daily_limit)
       VALUES ($1, 'deepseek', $2, 'VP_RELATION', 'UTC', 100)`,
      [authorityId, fingerprint],
    );
    const environment = {
      VP_GLOBAL_RELATION_BUDGET_DATABASE_URL: authorityDb.databaseUrl,
      VP_GLOBAL_RELATION_BUDGET_STORE_ID: storeId,
      VP_GLOBAL_RELATION_BUDGET_AUTHORITY_ID: authorityId,
    };
    const first = globalRelationBudgetFromEnvironment(
      workloadA.databaseUrl,
      fingerprint,
      environment,
    );
    const second = globalRelationBudgetFromEnvironment(
      workloadB.databaseUrl,
      fingerprint,
      environment,
    );
    try {
      const before = await Promise.all([first.budget.status(), second.budget.status()]);
      expect(before[0]).toEqual(before[1]);
      expect(before[0]).toMatchObject({ storeId, authorityId, claimedCount: 0, dailyLimit: 100 });
      const [a, b] = await Promise.all([
        first.budget.claim('runtime-a:fake-provider'),
        second.budget.claim('runtime-b:fake-provider'),
      ]);
      expect(a.authorityId).toBe(b.authorityId);
      expect(a.budgetDay).toBe(b.budgetDay);
      const after = await Promise.all([first.budget.status(), second.budget.status()]);
      expect(after[0]).toEqual(after[1]);
      expect(after[0]?.claimedCount).toBe(2);
      const rows = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM vp_global_budget.claims WHERE authority_id = $1`,
        [authorityId],
      );
      expect(Number(rows.rows[0]!.count)).toBe(2);
      const spawn = (workloadUrl: string) =>
        execFileAsync(
          process.execPath,
          [
            '--import',
            'tsx',
            'tests/helpers/vp-global-budget-runtime-child.ts',
            workloadUrl,
            fingerprint,
          ],
          { cwd: process.cwd(), env: { ...process.env, ...environment } },
        );
      const children = await Promise.all([
        spawn(workloadA.databaseUrl),
        spawn(workloadB.databaseUrl),
      ]);
      for (const child of children) {
        const observed = JSON.parse(child.stdout) as {
          before: { storeId: string; authorityId: string; budgetDay: string };
          after: { storeId: string; authorityId: string; budgetDay: string };
        };
        expect(observed.before).toMatchObject({ storeId, authorityId, budgetDay: a.budgetDay });
        expect(observed.after).toMatchObject({ storeId, authorityId, budgetDay: a.budgetDay });
      }
      expect((await first.budget.status()).claimedCount).toBe(4);
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
  });

  it('enforces the same ten slots across two OS processes', async () => {
    const account = await policy('b'.repeat(64));
    const spawn = () =>
      execFileAsync(
        process.execPath,
        [
          '--import',
          'tsx',
          'tests/helpers/vp-global-budget-claim-child.ts',
          storeId,
          account.authorityId,
          'b'.repeat(64),
          '7',
        ],
        {
          cwd: process.cwd(),
          env: { ...process.env, VP_TEST_AUTHORITY_DATABASE_URL: authorityDb.databaseUrl },
        },
      );
    const [first, second] = await Promise.all([spawn(), spawn()]);
    const total = [first, second].reduce(
      (sum, result) => sum + (JSON.parse(result.stdout) as { claimed: number }).claimed,
      0,
    );
    expect(total).toBe(10);
    expect((await account.budget.status()).claimedCount).toBe(10);
  });

  it('binds one global claim to one durable relation job attempt before egress', async () => {
    const account = await policy('9'.repeat(64));
    const projectId = 'binding-project';
    const relationJobId = randomUUID();
    const semanticAttemptId = randomUUID();
    const binding = {
      projectId,
      relationJobId,
      semanticAttemptId,
      executionKey: `sha256:${'a'.repeat(64)}`,
      providerIdentity: 'deepseek/fake-model',
    };
    const first = await account.budget.claim('binding-worker-a');
    await account.budget.bindAttempt({ claim: first, ...binding });
    const second = await account.budget.claim('binding-worker-b');
    await expect(account.budget.bindAttempt({ claim: second, ...binding })).rejects.toMatchObject({
      reason: 'IDENTITY_UNVERIFIED',
    });
    await expect(account.budget.bindAttempt({ claim: first, ...binding })).rejects.toMatchObject({
      reason: 'IDENTITY_UNVERIFIED',
    });
    await account.budget.releaseUnused(second);
    await account.budget.authorizeExecution({ claim: first, ...binding });
    await expect(
      account.budget.settle({ claim: first, state: 'PROVIDER_SUCCEEDED', projectId: 'other' }),
    ).rejects.toMatchObject({ reason: 'AUTHORITY_UNAVAILABLE' });
    await account.budget.settle({
      claim: first,
      state: 'PROVIDER_SUCCEEDED',
      projectId,
      relationRequestId: 'relation-pair',
      model: 'fake-model',
    });
    const row = await account.pool.query<{
      project_id: string;
      relation_job_id: string;
      semantic_attempt_id: string;
      execution_key: string;
      provider_identity: string;
      state: string;
    }>(
      `SELECT project_id, relation_job_id::text, semantic_attempt_id::text,
              execution_key, provider_identity, state
         FROM vp_global_budget.claims WHERE claim_id = $1`,
      [first.claimId],
    );
    expect(row.rows[0]).toEqual({
      project_id: projectId,
      relation_job_id: relationJobId,
      semantic_attempt_id: semanticAttemptId,
      execution_key: binding.executionKey,
      provider_identity: binding.providerIdentity,
      state: 'PROVIDER_SUCCEEDED',
    });
  });

  it('refuses mismatched policy identity and preserves the authority day in UTC', async () => {
    const account = await policy('e'.repeat(64));
    const wrong = new PostgresGlobalRelationBudget(account.pool, {
      storeId,
      authorityId: account.authorityId,
      provider: 'deepseek',
      accountFingerprint: 'f'.repeat(64),
      dailyLimit: 10,
    });
    await expect(wrong.claim('wrong')).rejects.toMatchObject({ reason: 'IDENTITY_UNVERIFIED' });
    const wrongStore = new PostgresGlobalRelationBudget(account.pool, {
      storeId: randomUUID(),
      authorityId: account.authorityId,
      provider: 'deepseek',
      accountFingerprint: 'e'.repeat(64),
      dailyLimit: 10,
    });
    await expect(wrongStore.claim('wrong-store')).rejects.toMatchObject({
      reason: 'IDENTITY_UNVERIFIED',
    });
    const claim = await account.budget.claim('day-contract');
    const utcDay = (
      await account.pool.query<{ day: string }>(
        `SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date::text AS day`,
      )
    ).rows[0]!.day;
    expect(claim.budgetDay).toBe(utcDay);
    await expect(account.budget.claim('next')).resolves.toBeDefined();
    expect(GlobalRelationBudgetPausedError).toBeDefined();
  });

  it('authorizes one global execution across two OS processes and rejects release or replay', async () => {
    const account = await policy('8'.repeat(64));
    const binding = {
      projectId: 'isolated-project',
      relationJobId: randomUUID(),
      semanticAttemptId: randomUUID(),
      executionKey: 'sha256:' + '8'.repeat(64),
      providerIdentity: 'deepseek/fake-model',
    };
    const claim = await account.budget.reserveAttempt({
      workloadIdentity: 'cross-process-test',
      ...binding,
    });
    const payload = JSON.stringify({
      identity: {
        storeId,
        authorityId: account.authorityId,
        provider: 'deepseek',
        accountFingerprint: '8'.repeat(64),
        dailyLimit: 10,
      },
      input: { claim, ...binding },
    });
    const spawn = () =>
      execFileAsync(
        process.execPath,
        ['--import', 'tsx', 'tests/helpers/vp-global-budget-authorize-child.ts', payload],
        {
          cwd: process.cwd(),
          windowsHide: true,
          env: {
            ...process.env,
            DATABASE_URL: undefined,
            TEST_DATABASE_URL: authorityDb.databaseUrl,
          },
        },
      );
    const children = await Promise.all([spawn(), spawn()]);
    expect(children.map((r) => JSON.parse(r.stdout).authorized).sort()).toEqual([false, true]);
    await expect(account.budget.authorizeExecution({ claim, ...binding })).rejects.toMatchObject({
      reason: 'RECONCILIATION_REQUIRED',
    });
    await expect(account.budget.releaseUnused(claim)).rejects.toMatchObject({
      reason: 'RECONCILIATION_REQUIRED',
    });
    expect((await account.budget.status()).claimedCount).toBe(1);
    const settlement = {
      claim,
      state: 'PROVIDER_SUCCEEDED' as const,
      projectId: binding.projectId,
      providerRequestId: 'fake-once',
      model: 'fake-model',
    };
    await account.budget.settle(settlement);
    await account.budget.settle(settlement);
    expect((await account.budget.status()).claimedCount).toBe(1);
    await expect(
      account.budget.settle({ ...settlement, providerRequestId: 'different-call' }),
    ).rejects.toMatchObject({ reason: 'AUTHORITY_UNAVAILABLE' });
  });

  it('cannot refund a reservation against a forged budget day', async () => {
    const account = await policy('6'.repeat(64));
    const claim = await account.budget.claim('wrong-day-refund');
    await expect(
      account.budget.releaseUnused({ ...claim, budgetDay: '2000-01-01' }),
    ).rejects.toMatchObject({ reason: 'IDENTITY_UNVERIFIED' });
    expect((await account.budget.status()).claimedCount).toBe(1);
    await account.budget.releaseUnused(claim);
    await account.budget.releaseUnused(claim);
    expect((await account.budget.status()).claimedCount).toBe(0);
  });

  it('enforces reservation, execution and settlement with the runtime database role', async () => {
    const account = await policy('0'.repeat(64));
    const pool = new pg.Pool({ connectionString: authorityDb.databaseUrl, max: 1 });
    try {
      await pool.query('SET ROLE shotgun_runtime');
      const budget = new PostgresGlobalRelationBudget(pool, {
        storeId,
        authorityId: account.authorityId,
        provider: 'deepseek',
        accountFingerprint: '0'.repeat(64),
        dailyLimit: 10,
      });
      const binding = {
        projectId: 'runtime-project',
        relationJobId: randomUUID(),
        semanticAttemptId: randomUUID(),
        executionKey: 'sha256:' + '0'.repeat(64),
        providerIdentity: 'deepseek/runtime-fake',
      };
      const claim = await budget.reserveAttempt({ workloadIdentity: 'runtime-role', ...binding });
      await budget.authorizeExecution({ claim, ...binding });
      await budget.settle({
        claim,
        state: 'PROVIDER_SUCCEEDED',
        projectId: binding.projectId,
        providerRequestId: 'runtime-fake-once',
      });
      expect(await budget.status()).toMatchObject({
        storeId,
        authorityId: account.authorityId,
        claimedCount: 1,
      });
      await expect(
        pool.query('DELETE FROM vp_global_budget.policies WHERE authority_id=$1', [
          account.authorityId,
        ]),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await pool.end();
    }
  });

  it('rolls over only from the authority UTC day and releases the original day correctly', async () => {
    const account = await policy('3'.repeat(64));
    const before = await account.budget.claim('utc-day-before');
    const tomorrow = (
      await account.pool.query(`SELECT (vp_global_budget.current_budget_day()+1)::text AS day`)
    ).rows[0].day as string;
    try {
      await account.pool.query(
        `CREATE OR REPLACE FUNCTION vp_global_budget.current_budget_day() RETURNS date LANGUAGE sql VOLATILE AS $$ SELECT '${tomorrow}'::date $$`,
      );
      expect(await account.budget.status()).toMatchObject({ budgetDay: tomorrow, claimedCount: 0 });
      const after = await account.budget.claim('utc-day-after');
      expect(after).toMatchObject({ budgetDay: tomorrow, claimedCount: 1 });
      await account.budget.releaseUnused(before);
      expect(await account.budget.status()).toMatchObject({ budgetDay: tomorrow, claimedCount: 1 });
      await account.budget.releaseUnused(after);
      expect((await account.budget.status()).claimedCount).toBe(0);
    } finally {
      await account.pool.query(
        `CREATE OR REPLACE FUNCTION vp_global_budget.current_budget_day() RETURNS date LANGUAGE sql VOLATILE AS $$ SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date $$`,
      );
    }
  });
});
