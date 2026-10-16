import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { PostgresVPRelationJobs } from '../../adapters/vp-knowledge-postgres/src/relation-jobs.js';
import {
  PostgresGlobalRelationBudget,
  GlobalRelationBudgetPausedError,
} from '../../adapters/vp-global-provider-budget-postgres/src/index.js';
import {
  ExecutionBoundVPRelationDispatcher,
  executionBoundRelationLedger,
  executionBoundRelationResolver,
} from '../../adapters/vp-global-provider-budget-postgres/src/execution-boundary.js';
import { GeneralAIVPDecisionAdapter } from '../../adapters/vp-decision-general-ai/src/index.js';
import { VPRelationDecisionRouter } from '../../modules/vp-decision/src/index.js';
import { VPRelationJobWorker } from '../../modules/vp-knowledge-ledger/src/index.js';
import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import { PostgresProjectAdministrationRepository } from '../../adapters/postgres/src/index.js';
import {
  createIsolatedPostgresTestDatabase,
  type IsolatedPostgresTestDatabase,
} from '../helpers/isolated-postgres-test-database.js';
import { seedAssertion } from '../helpers/vp05-p0-fixtures.js';

let db: IsolatedPostgresTestDatabase;
let authorityDb: IsolatedPostgresTestDatabase;
let secondDb: IsolatedPostgresTestDatabase;
const storeId = randomUUID();
const traces: unknown[] = [];
beforeAll(async () => {
  db = await createIsolatedPostgresTestDatabase();
  authorityDb = await createIsolatedPostgresTestDatabase();
  secondDb = await createIsolatedPostgresTestDatabase();
  await authorityDb
    .createPool()
    .query('INSERT INTO vp_global_budget.authority_store(store_id) VALUES($1)', [storeId]);
}, 120000);
afterAll(async () => {
  // Regression execution must not rewrite the accepted historical evidence.
  const output =
    process.env.VP05_P0_TRACE_OUTPUT ??
    path.join(os.tmpdir(), `shotgun-vp05-p0-boundary-${randomUUID()}`);
  await mkdir(output, { recursive: true });
  await writeFile(
    output + '/boundary-traces.json',
    JSON.stringify(
      { scope: 'ISOLATED_FAKE_EXECUTION_SAFETY_ONLY', liveProviderCalls: 0, traces },
      null,
      2,
    ) + '\n',
  );
  await Promise.all([db?.dispose(), authorityDb?.dispose(), secondDb?.dispose()]);
}, 120000);

const decision = {
  choice: 'CONTRADICTS',
  direction: 'NONE',
  confidence: 0.99,
  probabilities: {
    EQUIVALENT: 0.002,
    SUPPORTS: 0.002,
    QUALIFIES: 0.002,
    CONTRADICTS: 0.99,
    RELATED: 0.002,
    UNRESOLVED: 0.002,
  },
};
async function fixture(
  workloadDb = db,
  shared?: {
    authorityPool: ReturnType<IsolatedPostgresTestDatabase['createPool']>;
    authorityId: string;
    budget: PostgresGlobalRelationBudget;
  },
) {
  const pool = workloadDb.createPool();
  const authorityPool = shared?.authorityPool ?? authorityDb.createPool();
  const authorityId = shared?.authorityId ?? randomUUID();
  const fingerprint = createHash('sha256').update(authorityId).digest('hex');
  if (!shared)
    await authorityPool.query(
      `INSERT INTO vp_global_budget.policies(authority_id,provider,account_fingerprint,workload_class,budget_timezone,daily_limit) VALUES($1,'deepseek',$2,'VP_RELATION','UTC',100)`,
      [authorityId, fingerprint],
    );
  const budget =
    shared?.budget ??
    new PostgresGlobalRelationBudget(authorityPool, {
      storeId,
      authorityId,
      provider: 'deepseek',
      accountFingerprint: fingerprint,
      dailyLimit: 100,
    });
  const projectId = 'p0-' + randomUUID();
  const principal = await new PostgresAuthRepository(pool).bootstrapLocalOwnerPrincipal({
    accountId: projectId,
  });
  await new PostgresProjectAdministrationRepository(pool).createProject({
    commandId: randomUUID(),
    clientRequestId: randomUUID(),
    idempotencyKey: randomUUID(),
    projectId,
    name: 'P0 boundary fixture',
    description: 'fake only',
    actorPrincipalId: principal.principalId,
    expectedProjectRevision: 0,
  });
  for (const text of ['The archive has 42 records.', 'The archive has 43 records.'])
    await seedAssertion(pool, {
      projectId,
      principalId: principal.principalId,
      assertionId: randomUUID(),
      text: `${projectId}: ${text}`,
    });
  const revision = 'p0-boundary-' + randomUUID();
  const jobs = new PostgresVPRelationJobs(pool, 100, 1, true);
  await pool.query(
    `INSERT INTO vp.relation_jobs(job_id,project_id,left_assertion_id,right_assertion_id,policy_revision,max_attempts)
    SELECT gen_random_uuid(),$1,ids[1],ids[2],$2,1 FROM
      (SELECT array_agg(assertion_id ORDER BY assertion_id) AS ids FROM vp.current_assertions WHERE project_id=$1) AS pair`,
    [projectId, revision],
  );
  // Queue membership is seeded once for this failure-window test. Normal app
  // discovery is exercised separately through startShotgunApplication.
  vi.spyOn(jobs, 'enqueueCurrentPairs').mockResolvedValue(0);
  const provider = vi.fn(async () => ({
    rawText: JSON.stringify(decision),
    modelVersion: 'fake',
    providerResponseId: randomUUID(),
    inputTokens: 20,
    outputTokens: 10,
  }));
  const resolver = executionBoundRelationResolver(
    {
      resolve: async () => ({
        adapter: {
          identity: {
            provider: 'deepseek',
            model: 'fake',
            adapterVersion: 'fixture',
            dataPolicyVersion: 'fixture',
          },
          generateStructured: provider,
        },
        executionIdentity: {
          providerId: 'deepseek',
          modelId: 'fake',
          aiConfigurationRevision: 1,
          credentialId: 'fake',
          credentialRevision: 1,
          policyContextRevision: 'fake',
          providerPolicyFingerprint: 'fake',
        },
      }),
    },
    jobs,
    budget,
    { requiredProvider: 'deepseek', verifyCredential: async () => {} },
  );
  function dispatcher() {
    return new ExecutionBoundVPRelationDispatcher(
      new VPRelationJobWorker(
        jobs,
        new VPRelationDecisionRouter(
          undefined,
          new GeneralAIVPDecisionAdapter(resolver, executionBoundRelationLedger(jobs)),
          {
            revision,
            minimumChoiceProbability: 0.9,
            maximumDeepAnalysisScore: 0,
            maximumInputTokens: 4000,
            maximumOutputTokens: 256,
          },
        ),
        async () => true,
        revision,
      ),
      budget,
      projectId,
      jobs,
    );
  }
  async function state(label: string) {
    const local = (
      await pool.query(
        `SELECT job.job_id::text,job.status,job.attempt_count,call.call_id::text,call.global_claim_id::text,call.semantic_attempt_id::text,call.state AS call_state FROM vp.relation_jobs job LEFT JOIN vp.relation_provider_calls call USING(project_id,job_id) WHERE job.project_id=$1 AND job.policy_revision=$2`,
        [projectId, revision],
      )
    ).rows;
    const global = (
      await authorityPool.query(
        `SELECT claim_id::text,state,execution_authorized_at IS NOT NULL AS execution_authorized FROM vp_global_budget.claims WHERE authority_id=$1`,
        [authorityId],
      )
    ).rows;
    const count = (await budget.status()).claimedCount;
    const result = {
      label,
      projectId,
      local,
      global,
      claimedCount: count,
      providerCalls: provider.mock.calls.length,
    };
    traces.push(result);
    return result;
  }
  async function expire() {
    await pool.query(
      `UPDATE vp.relation_jobs SET lease_expires_at=clock_timestamp()-interval '1 second',next_attempt_at=clock_timestamp()-interval '1 second' WHERE project_id=$1 AND policy_revision=$2`,
      [projectId, revision],
    );
  }
  return {
    pool,
    authorityPool,
    budget,
    authorityId,
    projectId,
    revision,
    jobs,
    provider,
    resolver,
    dispatcher,
    state,
    expire,
  };
}

let currentFixture: Awaited<ReturnType<typeof fixture>>;
let secondFixture: Awaited<ReturnType<typeof fixture>>;
// Keep Docker transport and database construction outside the unchanged 5s behavior gate.
beforeEach(async (context) => {
  currentFixture = await fixture();
  if (
    context.task.name ===
    'enforces the final daily slot across two independent workload databases and providers'
  ) {
    secondFixture = await fixture(secondDb, currentFixture);
  }
}, 30_000);

it.each(['AUTHORITY_UNAVAILABLE', 'EXHAUSTED', 'GLOBAL_BIND_FAILURE'] as const)(
  'preserves the leased job on %s before activation',
  async (reason) => {
    const f = currentFixture;
    const reserve = vi.spyOn(f.budget, 'reserveAttempt');
    if (reason === 'EXHAUSTED')
      await f.authorityPool.query(
        `INSERT INTO vp_global_budget.daily_usage(authority_id,budget_day,claimed_count) VALUES($1,vp_global_budget.current_budget_day(),100)`,
        [f.authorityId],
      );
    else
      reserve.mockRejectedValueOnce(
        new GlobalRelationBudgetPausedError(
          reason === 'GLOBAL_BIND_FAILURE' ? 'IDENTITY_UNVERIFIED' : reason,
        ),
      );
    expect(await f.dispatcher().dispatchOnce()).toBe('RELATION_BUDGET_PAUSED');
    const result = await f.state(reason);
    expect(result.local).toHaveLength(1);
    expect(result.local[0]).toMatchObject({ status: 'RETRYABLE', attempt_count: 0, call_id: null });
    expect(result.providerCalls).toBe(0);
    expect(result.global).toHaveLength(0);
    expect(result.claimedCount).toBe(reason === 'EXHAUSTED' ? 100 : 0);
    reserve.mockRestore();
  },
);

it('records an armed unused claim recoverably when local activation fails', async () => {
  const f = currentFixture;
  const activate = vi
    .spyOn(f.jobs, 'claim')
    .mockRejectedValueOnce(new Error('simulated transaction rejection'));
  expect(await f.dispatcher().dispatchOnce()).toBe('RELATION_BUDGET_PAUSED');
  activate.mockRestore();
  let result = await f.state('LOCAL_ACTIVATION_FAILED_AFTER_GLOBAL_ARM');
  expect(result.local[0]).toMatchObject({ status: 'RETRYABLE', attempt_count: 0, call_id: null });
  expect(result.global).toEqual([
    expect.objectContaining({ state: 'RESERVED', execution_authorized: true }),
  ]);
  expect(result.claimedCount).toBe(1);
  await f.expire();
  expect(await f.dispatcher().dispatchOnce()).toBe('RELATION_BUDGET_PAUSED');
  result = await f.state('ARMED_WITHOUT_LOCAL_RECEIPT_RESTART');
  expect(result.local[0]?.attempt_count).toBe(0);
  expect(result.providerCalls).toBe(0);
  expect(result.claimedCount).toBe(1);
  expect(result.global).toHaveLength(1);
});

it('recovers a crash before global reservation without spending either counter', async () => {
  const f = currentFixture;
  const lease = await f.jobs.claimNext(f.revision);
  expect(lease?.attemptCount).toBe(0);
  expect((await f.state('CRASH_BEFORE_RESERVATION')).claimedCount).toBe(0);
  await f.expire();
  expect(await f.dispatcher().dispatchOnce()).toBe('DECIDED');
  const result = await f.state('RESUMED_AFTER_LEASE_ONLY_CRASH');
  expect(result.local[0]).toMatchObject({
    status: 'COMPLETED',
    attempt_count: 1,
    call_state: 'OUTPUT_STORED',
  });
  expect(result.providerCalls).toBe(1);
  expect(result.claimedCount).toBe(1);
});

it('releases only an unarmed reservation after crash and restarts once', async () => {
  const f = currentFixture;
  const lease = (await f.jobs.claimNext(f.revision))!;
  const claim = await f.budget.reserveAttempt({
    workloadIdentity: f.projectId,
    projectId: f.projectId,
    relationJobId: lease.jobId,
    semanticAttemptId: lease.leaseToken,
    executionKey: 'sha256:' + 'a'.repeat(64),
    providerIdentity: 'deepseek/fake',
  });
  expect((await f.state('CRASH_AFTER_RESERVE_BEFORE_ARM')).local[0]?.attempt_count).toBe(0);
  await f.expire();
  expect(await f.dispatcher().dispatchOnce()).toBe('DECIDED');
  const result = await f.state('UNARMED_RESERVATION_RECLAIMED');
  expect(result.global).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        claim_id: claim.claimId,
        state: 'RELEASED',
        execution_authorized: false,
      }),
    ]),
  );
  expect(result.providerCalls).toBe(1);
  expect(result.claimedCount).toBe(1);
});

it('never resends after actual fake egress and lost response persistence', async () => {
  const f = currentFixture;
  const save = vi
    .spyOn(f.jobs, 'storeOutput')
    .mockRejectedValueOnce(new Error('response commit unavailable'));
  expect(await f.dispatcher().dispatchOnce()).toBe('OUTCOME_UNKNOWN');
  save.mockRestore();
  await f.expire();
  expect(await f.dispatcher().dispatchOnce()).toBe('EMPTY');
  const result = await f.state('EGRESS_BEFORE_PERSISTENCE_LOSS');
  expect(result.local[0]).toMatchObject({
    status: 'OUTCOME_UNKNOWN',
    attempt_count: 1,
    call_state: 'OUTCOME_UNKNOWN',
  });
  expect(result.providerCalls).toBe(1);
  expect(result.claimedCount).toBe(1);
});

it('replays persisted output after worker loss even with a now-unavailable credential', async () => {
  const f = currentFixture;
  const complete = vi
    .spyOn(f.jobs, 'completeDecision')
    .mockRejectedValueOnce(new Error('worker terminated before finalization'));
  expect(await f.dispatcher().dispatchOnce()).toBe('OUTCOME_UNKNOWN');
  complete.mockRestore();
  vi.spyOn(f.resolver, 'resolve').mockRejectedValue(new Error('credential rotated away'));
  await f.expire();
  expect(await f.dispatcher().dispatchOnce()).toBe('DECIDED');
  expect(await f.dispatcher().dispatchOnce()).toBe('EMPTY');
  const result = await f.state('OUTPUT_STORED_BEFORE_FINALIZATION_CRASH');
  expect(result.local[0]).toMatchObject({
    status: 'COMPLETED',
    attempt_count: 1,
    call_state: 'OUTPUT_STORED',
  });
  expect(result.providerCalls).toBe(1);
  expect(result.claimedCount).toBe(1);
});

it('keeps a global execution arm one-use across independent workload ledgers', async () => {
  const f = currentFixture;
  const lease = (await f.jobs.claimNext(f.revision))!;
  const binding = {
    projectId: f.projectId,
    relationJobId: lease.jobId,
    semanticAttemptId: lease.leaseToken,
    executionKey: 'sha256:' + 'b'.repeat(64),
    providerIdentity: 'deepseek/fake',
  };
  const claim = await f.budget.reserveAttempt({ workloadIdentity: f.projectId, ...binding });
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, () => f.budget.authorizeExecution({ claim, ...binding })),
  );
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((r) => r.status === 'rejected')).toHaveLength(7);
  await expect(f.budget.releaseUnused(claim)).rejects.toMatchObject({
    reason: 'RECONCILIATION_REQUIRED',
  });
  // A restore / other ledger may not contain the activation receipt. The global
  // arm itself prevents it from reclaiming or reauthorizing this claim.
  expect(
    await f.jobs.hasActivatedAttempt({
      jobId: lease.jobId,
      semanticAttemptId: lease.leaseToken,
      globalClaimId: claim.claimId,
    }),
  ).toBe(false);
  await f.expire();
  expect(await f.dispatcher().dispatchOnce()).toBe('RELATION_BUDGET_PAUSED');
  const result = await f.state('GLOBAL_ARM_SURVIVES_MISSING_LOCAL_RECEIPT');
  expect(result.providerCalls).toBe(0);
  expect(result.local[0]?.attempt_count).toBe(0);
  expect(result.claimedCount).toBe(1);
});

it('enforces the final daily slot across two independent workload databases and providers', async () => {
  const first = currentFixture;
  {
    const second = secondFixture;
    expect(secondDb.databaseName).not.toBe(db.databaseName);
    await first.authorityPool.query(
      `INSERT INTO vp_global_budget.daily_usage(authority_id,budget_day,claimed_count) VALUES($1,vp_global_budget.current_budget_day(),99)`,
      [first.authorityId],
    );
    const outcomes = await Promise.all([
      first.dispatcher().dispatchOnce(),
      second.dispatcher().dispatchOnce(),
    ]);
    expect(outcomes.sort()).toEqual(['DECIDED', 'RELATION_BUDGET_PAUSED']);
    const states = await Promise.all([
      first.state('CROSS_WORKLOAD_A'),
      second.state('CROSS_WORKLOAD_B'),
    ]);
    expect(states.reduce((n, s) => n + s.providerCalls, 0)).toBe(1);
    expect(states.map((s) => s.local[0]?.attempt_count).sort()).toEqual([0, 1]);
    expect(states.map((s) => s.claimedCount)).toEqual([100, 100]);
    expect(states.map((s) => s.local[0]?.status).sort()).toEqual(['COMPLETED', 'RETRYABLE']);
  }
});

it('does not activate or call after a lost global execution-authorization acknowledgement', async () => {
  const f = currentFixture;
  const authorize = f.budget.authorizeExecution.bind(f.budget);
  const acknowledgement = vi
    .spyOn(f.budget, 'authorizeExecution')
    .mockImplementationOnce(async (input) => {
      await authorize(input);
      throw new GlobalRelationBudgetPausedError('AUTHORITY_UNAVAILABLE');
    });
  expect(await f.dispatcher().dispatchOnce()).toBe('RELATION_BUDGET_PAUSED');
  acknowledgement.mockRestore();
  await f.expire();
  expect(await f.dispatcher().dispatchOnce()).toBe('RELATION_BUDGET_PAUSED');
  const result = await f.state('LOST_GLOBAL_ARM_ACKNOWLEDGEMENT');
  expect(result.local[0]).toMatchObject({ status: 'RETRYABLE', attempt_count: 0, call_id: null });
  expect(result.global).toEqual([
    expect.objectContaining({ state: 'RESERVED', execution_authorized: true }),
  ]);
  expect(result.claimedCount).toBe(1);
  expect(result.providerCalls).toBe(0);
});

it('fences a durably activated attempt when the local activation acknowledgement is lost', async () => {
  const f = currentFixture;
  const activate = f.jobs.claim.bind(f.jobs);
  const acknowledgement = vi.spyOn(f.jobs, 'claim').mockImplementationOnce(async (input) => {
    await activate(input);
    throw new Error('lost local commit acknowledgement');
  });
  expect(await f.dispatcher().dispatchOnce()).toBe('RELATION_BUDGET_PAUSED');
  acknowledgement.mockRestore();
  await f.expire();
  expect(await f.dispatcher().dispatchOnce()).toBe('EMPTY');
  const result = await f.state('LOST_LOCAL_ACTIVATION_ACKNOWLEDGEMENT');
  expect(result.local[0]).toMatchObject({
    status: 'OUTCOME_UNKNOWN',
    attempt_count: 1,
    call_state: 'OUTCOME_UNKNOWN',
  });
  expect(result.claimedCount).toBe(1);
  expect(result.providerCalls).toBe(0);
  expect(result.global).toHaveLength(1);
});
