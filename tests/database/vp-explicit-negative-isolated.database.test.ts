import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import { PostgresProjectAdministrationRepository } from '../../adapters/postgres/src/index.js';
import { PostgresVPRelationJobs } from '../../adapters/vp-knowledge-postgres/src/relation-jobs.js';
import { PostgresIsolatedExplicitNegativeJobs } from '../../adapters/vp-knowledge-postgres/src/explicit-negative-isolated.js';
import {
  PostgresGlobalRelationBudget,
  GlobalRelationBudgetPausedError,
} from '../../adapters/vp-global-provider-budget-postgres/src/index.js';
import {
  executionBoundRelationLedger,
  executionBoundRelationResolver,
  ExecutionBoundVPRelationDispatcher,
} from '../../adapters/vp-global-provider-budget-postgres/src/execution-boundary.js';
import {
  DurableIsolatedExplicitNegativeRouter,
  validDurableExplicitNegativeOutput,
} from '../../adapters/vp-decision-general-ai/src/explicit-negative-durable-isolated.js';
import {
  EXPLICIT_NEGATIVE_CHOICES,
  EXPLICIT_NEGATIVE_ISOLATED_REVISION,
  type ExplicitNegativeChoice,
  type DurableExplicitNegativeOutput,
} from '../../modules/vp-decision/src/explicit-negative-isolated.js';
import { VPDecisionOutcomeUnknownError } from '../../modules/vp-decision/src/index.js';
import { VPRelationJobWorker } from '../../modules/vp-knowledge-ledger/src/index.js';
import {
  createIsolatedPostgresTestDatabase,
  type IsolatedPostgresTestDatabase,
} from '../helpers/isolated-postgres-test-database.js';
import { seedAssertion } from '../helpers/vp05-p0-fixtures.js';

let db: IsolatedPostgresTestDatabase;
let authorityDb: IsolatedPostgresTestDatabase;
const storeId = randomUUID();
const traces: unknown[] = [];
beforeAll(async () => {
  db = await createIsolatedPostgresTestDatabase();
  authorityDb = await createIsolatedPostgresTestDatabase();
  await authorityDb
    .createPool()
    .query('INSERT INTO vp_global_budget.authority_store(store_id) VALUES($1)', [storeId]);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('LIVE_NETWORK_DENIED_IN_ISOLATED_FAKE_TEST');
    }),
  );
}, 120_000);
afterAll(async () => {
  const output = path.join(
    process.env.VP_EXPLICIT_NEGATIVE_TRACE_OUTPUT ??
      path.join(os.tmpdir(), 'shotgun-explicit-negative'),
    randomUUID(),
  );
  await mkdir(output, { recursive: true });
  await writeFile(
    path.join(output, 'traces.json'),
    JSON.stringify(
      { scope: 'ISOLATED_FAKE_NOT_MODEL_QUALITY', storeId, traces, liveProviderCalls: 0 },
      null,
      2,
    ) + '\n',
  );
  vi.unstubAllGlobals();
  await Promise.all([db?.dispose(), authorityDb?.dispose()]);
}, 120_000);

function declaration(choice: ExplicitNegativeChoice, probability = 1) {
  return {
    choice,
    direction: choice === 'SUPPORTS' || choice === 'QUALIFIES' ? 'LEFT_TO_RIGHT' : 'NONE',
    confidence: 0.6,
    probabilities: Object.fromEntries(
      EXPLICIT_NEGATIVE_CHOICES.map((c) => [c, c === choice ? probability : (1 - probability) / 6]),
    ),
  };
}

async function fixture(choice: ExplicitNegativeChoice = 'NO_RELATION', probability = 1) {
  const pool = db.createPool();
  const authorityPool = authorityDb.createPool();
  const authorityId = randomUUID();
  const fingerprint = createHash('sha256')
    .update(`synthetic-credential:${authorityId}`)
    .digest('hex');
  await authorityPool.query(
    `INSERT INTO vp_global_budget.policies(authority_id,provider,account_fingerprint,workload_class,budget_timezone,daily_limit) VALUES($1,'isolated-fake',$2,'VP_RELATION','UTC',100)`,
    [authorityId, fingerprint],
  );
  const budget = new PostgresGlobalRelationBudget(authorityPool, {
    storeId,
    authorityId,
    provider: 'isolated-fake',
    accountFingerprint: fingerprint,
    dailyLimit: 100,
  });
  const projectId = `negative-fake-${randomUUID()}`;
  const principal = await new PostgresAuthRepository(pool).bootstrapLocalOwnerPrincipal({
    accountId: projectId,
  });
  await new PostgresProjectAdministrationRepository(pool).createProject({
    commandId: randomUUID(),
    clientRequestId: randomUUID(),
    idempotencyKey: randomUUID(),
    projectId,
    name: 'Synthetic negative protocol',
    description: 'Fake only, not semantic labels',
    actorPrincipalId: principal.principalId,
    expectedProjectRevision: 0,
  });
  for (const text of [
    'The synthetic printer supports duplex printing.',
    'The synthetic lake covers 42 square units.',
  ])
    await seedAssertion(pool, {
      projectId,
      principalId: principal.principalId,
      assertionId: randomUUID(),
      text,
      sourceText: text + '\nSynthetic fixture ID: ' + projectId,
    });
  const jobs = new PostgresIsolatedExplicitNegativeJobs(
    pool,
    'ISOLATED_FAKE',
    validDurableExplicitNegativeOutput,
    projectId,
  );
  // One project/pair per fixture. Real enqueue/lease/fencing and execution activation are used.
  await jobs.enqueueCurrentPairs(EXPLICIT_NEGATIVE_ISOLATED_REVISION, 1000);
  const jobId = (
    await pool.query(`SELECT job_id::text FROM vp.relation_jobs WHERE project_id=$1`, [projectId])
  ).rows[0]!.job_id as string;
  const rawText = JSON.stringify(declaration(choice, probability));
  const provider = vi.fn(async () => ({
    rawText,
    modelVersion: 'synthetic-no-network',
    providerResponseId: `fake-response-${randomUUID()}`,
    inputTokens: 100,
    outputTokens: 40,
  }));
  const adapter = {
    identity: {
      provider: 'isolated-fake',
      model: 'synthetic-no-network',
      adapterVersion: '1',
      dataPolicyVersion: 'fake-only',
    },
    generateStructured: provider,
  };
  const resolve = vi.fn(async () => ({
    adapter,
    executionIdentity: {
      providerId: 'isolated-fake',
      modelId: 'synthetic-no-network',
      aiConfigurationRevision: 1,
      credentialId: 'synthetic-no-vault',
      credentialRevision: 1,
      policyContextRevision: 'synthetic-only',
      providerPolicyFingerprint: fingerprint,
    },
  }));
  const verifyCredential = vi.fn(async () => {});
  const resolver = executionBoundRelationResolver({ resolve }, jobs, budget, {
    requiredProvider: 'isolated-fake',
    verifyCredential,
  });
  function dispatcher(store = jobs) {
    return new ExecutionBoundVPRelationDispatcher(
      new VPRelationJobWorker(
        store,
        new DurableIsolatedExplicitNegativeRouter(resolver, executionBoundRelationLedger(store)),
        async () => true,
        EXPLICIT_NEGATIVE_ISOLATED_REVISION,
      ),
      budget,
      projectId,
      store,
    );
  }
  async function state(label: string) {
    const rows = (
      await pool.query(
        `SELECT job.job_id::text,job.project_id,job.policy_revision,job.status,job.attempt_count,job.last_failure_code,call.call_id::text,call.state AS call_state,call.output_json,call.global_claim_id::text,call.semantic_attempt_id::text,call.request_digest,call.execution_key FROM vp.relation_jobs job LEFT JOIN vp.relation_provider_calls call USING(project_id,job_id) WHERE job.job_id=$1`,
        [jobId],
      )
    ).rows;
    const edges = Number(
      (await pool.query('SELECT count(*) AS n FROM vp.relations WHERE project_id=$1', [projectId]))
        .rows[0]!.n,
    );
    const receipts = Number(
      (
        await pool.query(
          "SELECT count(*) AS n FROM vp.decision_receipts WHERE project_id=$1 AND task_kind='SEMANTIC_RELATION'",
          [projectId],
        )
      ).rows[0]!.n,
    );
    const claims = (
      await authorityPool.query(
        'SELECT claim_id::text,state,relation_job_id::text,semantic_attempt_id::text,provider_identity FROM vp_global_budget.claims WHERE authority_id=$1',
        [authorityId],
      )
    ).rows;
    const snapshot = {
      label,
      storeId,
      authorityId,
      projectId,
      jobId,
      rows,
      claims,
      edges,
      receipts,
      claimedCount: (await budget.status()).claimedCount,
      fakeCalls: provider.mock.calls.length,
    };
    traces.push(snapshot);
    return snapshot;
  }
  async function expire() {
    await pool.query(
      "UPDATE vp.relation_jobs SET lease_expires_at=clock_timestamp()-interval '1 second',next_attempt_at=clock_timestamp()-interval '1 second' WHERE job_id=$1",
      [jobId],
    );
  }
  return {
    pool,
    authorityPool,
    budget,
    authorityId,
    fingerprint,
    projectId,
    jobId,
    jobs,
    provider,
    resolve,
    verifyCredential,
    dispatcher,
    state,
    expire,
    rawText,
  };
}

let currentFixture: Awaited<ReturnType<typeof fixture>>;
// Docker PG transport fixture construction is outside the standard five-second behavior checks.
beforeEach(async () => {
  currentFixture = await fixture();
}, 30_000);

it.each([
  ['NO_RELATION', 1, 'NO_RELATION'],
  ['UNRESOLVED', 1, 'MODEL_ABSTAINED'],
  ['NO_RELATION', 0.7, 'WITHHELD'],
  ['RELATED', 0.7, 'WITHHELD'],
  ['RELATED', 1, 'DECIDED'],
  ['QUALIFIES', 1, 'DECIDED'],
] as const)(
  'persists and replays %s at selected probability %s as %s',
  async (choice, probability, outcome) => {
    const f = currentFixture;
    const expectedRaw = JSON.stringify(declaration(choice, probability));
    f.provider.mockResolvedValue({
      rawText: expectedRaw,
      modelVersion: 'synthetic-no-network',
      providerResponseId: randomUUID(),
      inputTokens: 100,
      outputTokens: 40,
    });
    expect(await f.dispatcher().dispatchOnce()).toBe(outcome);
    const s = await f.state('terminal');
    expect(s.rows[0]).toMatchObject({
      status: 'COMPLETED',
      attempt_count: 1,
      call_state: 'OUTPUT_STORED',
    });
    expect(s.rows[0]!.output_json.record.rawResponse).toBe(expectedRaw);
    expect(s.rows[0]!.output_json.record.disposition.status).toBe(
      outcome === 'MODEL_ABSTAINED' ? 'UNRESOLVED' : outcome,
    );
    expect(s.claimedCount).toBe(1);
    expect(s.claims).toHaveLength(1);
    expect(s.claims[0]).toMatchObject({
      claim_id: s.rows[0]!.global_claim_id,
      relation_job_id: f.jobId,
      semantic_attempt_id: s.rows[0]!.semantic_attempt_id,
      state: 'PROVIDER_SUCCEEDED',
    });
    expect(s.edges).toBe(outcome === 'DECIDED' ? 1 : 0);
    expect(s.receipts).toBe(outcome === 'DECIDED' ? 1 : 0);
    expect(
      await f
        .dispatcher(
          new PostgresIsolatedExplicitNegativeJobs(
            f.pool,
            'ISOLATED_FAKE',
            validDurableExplicitNegativeOutput,
            f.projectId,
          ),
        )
        .dispatchOnce(),
    ).toBe('EMPTY');
    expect(f.provider).toHaveBeenCalledTimes(1);
    const after = await f.state('restart-no-repeat');
    expect(after.rows).toEqual(s.rows);
  },
);

it('preserves invalid JSON as INVALID, without a negative edge or retry', async () => {
  const f = currentFixture;
  f.provider.mockResolvedValue({
    rawText: 'broken JSON',
    modelVersion: 'synthetic-no-network',
    providerResponseId: 'fake-invalid',
    inputTokens: 100,
    outputTokens: 40,
  });
  expect(await f.dispatcher().dispatchOnce()).toBe('INVALID');
  const s = await f.state('invalid');
  expect(s.rows[0]!.output_json.record.rawResponse).toBe('broken JSON');
  expect(s.edges).toBe(0);
  expect(await f.dispatcher().dispatchOnce()).toBe('EMPTY');
  expect(f.provider).toHaveBeenCalledTimes(1);
});

it.each(['UNAVAILABLE', 'EXHAUSTED', 'BIND_FAILURE', 'CREDENTIAL_MISMATCH'] as const)(
  'does not consume a local attempt or call Fake on pre-egress %s',
  async (reason) => {
    const f = currentFixture;
    if (reason === 'EXHAUSTED')
      await f.authorityPool.query(
        `INSERT INTO vp_global_budget.daily_usage(authority_id,budget_day,claimed_count) VALUES($1,vp_global_budget.current_budget_day(),100)`,
        [f.authorityId],
      );
    else if (reason === 'CREDENTIAL_MISMATCH')
      f.verifyCredential.mockRejectedValueOnce(
        new GlobalRelationBudgetPausedError('IDENTITY_UNVERIFIED'),
      );
    else
      vi.spyOn(
        f.budget,
        reason === 'BIND_FAILURE' ? 'authorizeExecution' : 'reserveAttempt',
      ).mockRejectedValueOnce(
        new GlobalRelationBudgetPausedError(
          reason === 'BIND_FAILURE' ? 'RECONCILIATION_REQUIRED' : 'AUTHORITY_UNAVAILABLE',
        ),
      );
    expect(await f.dispatcher().dispatchOnce()).toBe('RELATION_BUDGET_PAUSED');
    const s = await f.state(reason);
    expect(s.rows[0]!.attempt_count).toBe(0);
    expect(s.rows[0]!.status).toBe('RETRYABLE');
    expect(s.fakeCalls).toBe(0);
    expect(s.edges).toBe(0);
    expect(s.claimedCount).toBe(reason === 'EXHAUSTED' ? 100 : 0);
  },
);

it('finalizes a stored negative after worker restart without resolving a new configuration', async () => {
  const f = currentFixture;
  vi.spyOn(f.jobs, 'completeRecordedNoEdge').mockRejectedValueOnce(
    new Error('simulated worker failure after output persistence'),
  );
  expect(await f.dispatcher().dispatchOnce()).toBe('OUTCOME_UNKNOWN');
  const before = await f.state('stored-before-finalize');
  expect(before.rows[0]).toMatchObject({
    status: 'RUNNING',
    call_state: 'OUTPUT_STORED',
    attempt_count: 1,
  });
  await f.expire();
  f.resolve.mockRejectedValue(new Error('must not resolve for stored output'));
  const restarted = new PostgresIsolatedExplicitNegativeJobs(
    f.pool,
    'ISOLATED_FAKE',
    validDurableExplicitNegativeOutput,
    f.projectId,
  );
  expect(await f.dispatcher(restarted).dispatchOnce()).toBe('NO_RELATION');
  const after = await f.state('stored-recovered');
  expect(after.rows[0]!.status).toBe('COMPLETED');
  expect(after.rows[0]!.semantic_attempt_id).toBe(before.rows[0]!.semantic_attempt_id);
  expect(after.rows[0]!.output_json).toEqual(before.rows[0]!.output_json);
  expect(f.resolve).toHaveBeenCalledTimes(1);
  expect(f.provider).toHaveBeenCalledTimes(1);
  expect(after.claimedCount).toBe(1);
});

it('reads back a lost no-edge commit acknowledgement idempotently', async () => {
  const f = currentFixture;
  const finish = f.jobs.completeRecordedNoEdge.bind(f.jobs);
  vi.spyOn(f.jobs, 'completeRecordedNoEdge').mockImplementationOnce(async (input) => {
    await finish(input);
    throw Object.assign(new Error('lost commit ACK'), { code: 'OUTCOME_UNKNOWN' });
  });
  expect(await f.dispatcher().dispatchOnce()).toBe('NO_RELATION');
  const s = await f.state('commit-ack-readback');
  expect(s.rows[0]!.status).toBe('COMPLETED');
  expect(s.fakeCalls).toBe(1);
  expect(s.claimedCount).toBe(1);
});

it('keeps egress-before-persistence failure UNKNOWN and never automatically calls Fake again', async () => {
  const f = currentFixture;
  vi.spyOn(f.jobs, 'storeOutput').mockRejectedValueOnce(
    new Error('simulated response persistence failure'),
  );
  expect(await f.dispatcher().dispatchOnce()).toBe('OUTCOME_UNKNOWN');
  const before = await f.state('unknown-after-egress');
  expect(before.rows[0]).toMatchObject({
    status: 'OUTCOME_UNKNOWN',
    attempt_count: 1,
    call_state: 'OUTCOME_UNKNOWN',
    output_json: null,
  });
  await f.expire();
  expect(await f.dispatcher().dispatchOnce()).toBe('EMPTY');
  const after = await f.state('unknown-no-repeat');
  expect(after.fakeCalls).toBe(1);
  expect(after.claimedCount).toBe(1);
  expect(after.edges).toBe(0);
});

it('does not retry an adapter-declared unknown outcome', async () => {
  const f = currentFixture;
  f.provider.mockRejectedValueOnce(new VPDecisionOutcomeUnknownError());
  expect(await f.dispatcher().dispatchOnce()).toBe('OUTCOME_UNKNOWN');
  expect(await f.dispatcher().dispatchOnce()).toBe('EMPTY');
  const s = await f.state('provider-unknown');
  expect(s.fakeCalls).toBe(1);
  expect(s.rows[0]!.status).toBe('OUTCOME_UNKNOWN');
});

it('rejects a changed disposition and normal-v6 readback of the isolated output', async () => {
  const f = currentFixture;
  expect(await f.dispatcher().dispatchOnce()).toBe('NO_RELATION');
  const s = await f.state('integrity');
  const output = structuredClone(s.rows[0]!.output_json) as DurableExplicitNegativeOutput;
  expect(
    validDurableExplicitNegativeOutput({
      ...output,
      record: {
        ...output.record,
        disposition: { status: 'INVALID', reason: 'OUTPUT_SCHEMA_INVALID' },
      },
    }),
  ).toBe(false);
  await expect(
    new PostgresVPRelationJobs(f.pool).readExecution({
      projectId: f.projectId,
      jobId: f.jobId,
      leaseToken: randomUUID(),
      executionKey: s.rows[0]!.execution_key,
      requestDigest: s.rows[0]!.request_digest,
      providerIdentity: 'isolated-fake/synthetic-no-network',
    }),
  ).rejects.toThrow('integrity');
  const scopedStore = new PostgresIsolatedExplicitNegativeJobs(
    f.pool,
    'ISOLATED_FAKE',
    validDurableExplicitNegativeOutput,
    f.projectId,
  );
  expect(
    await scopedStore.completeRecordedNoEdge({
      jobId: f.jobId,
      leaseToken: randomUUID(),
      outcome: 'WITHHELD',
    }),
  ).toBe(false);
});

it('releases a stranded pre-activation reservation before executing once after restart', async () => {
  const f = currentFixture;
  const lease = (await f.jobs.claimNext(EXPLICIT_NEGATIVE_ISOLATED_REVISION))!;
  const old = await f.budget.reserveAttempt({
    workloadIdentity: f.projectId,
    projectId: f.projectId,
    relationJobId: f.jobId,
    semanticAttemptId: lease.leaseToken,
    executionKey: `sha256:${'a'.repeat(64)}`,
    providerIdentity: 'isolated-fake/synthetic-no-network',
  });
  expect(f.provider).not.toHaveBeenCalled();
  expect((await f.state('stranded-before-activation')).rows[0]!.attempt_count).toBe(0);
  await f.expire();
  expect(await f.dispatcher().dispatchOnce()).toBe('NO_RELATION');
  const s = await f.state('stranded-recovered');
  expect(s.claimedCount).toBe(1);
  expect(s.fakeCalls).toBe(1);
  expect(s.rows[0]!.attempt_count).toBe(1);
  expect(s.claims).toHaveLength(2);
  expect(s.claims.find((c) => c.claim_id === old.claimId)!.state).toBe('RELEASED');
});

it('fences activation-before-egress uncertainty without a second attempt or call', async () => {
  const f = currentFixture;
  const activate = f.jobs.claim.bind(f.jobs);
  vi.spyOn(f.jobs, 'claim').mockImplementationOnce(async (input) => {
    await activate(input);
    throw new Error('simulated activation ACK loss before Fake egress');
  });
  expect(await f.dispatcher().dispatchOnce()).toBe('RELATION_BUDGET_PAUSED');
  const s = await f.state('activation-before-egress-unknown');
  expect(s.rows[0]).toMatchObject({
    status: 'OUTCOME_UNKNOWN',
    call_state: 'OUTCOME_UNKNOWN',
    attempt_count: 1,
  });
  expect(s.fakeCalls).toBe(0);
  expect(s.claimedCount).toBe(1);
  await f.expire();
  expect(await f.dispatcher().dispatchOnce()).toBe('EMPTY');
  expect(f.provider).not.toHaveBeenCalled();
});

it('allows only one call/claim/attempt under concurrent isolated workers', async () => {
  const f = currentFixture;
  expect(
    (await Promise.all([f.dispatcher().dispatchOnce(), f.dispatcher().dispatchOnce()])).sort(),
  ).toEqual(['EMPTY', 'NO_RELATION']);
  const s = await f.state('concurrent-workers');
  expect(s.fakeCalls).toBe(1);
  expect(s.claimedCount).toBe(1);
  expect(s.claims).toHaveLength(1);
  expect(s.rows[0]!.attempt_count).toBe(1);
});

it('documents the execution-only boundary: a recorded negative does not withdraw an older Ask edge', async () => {
  const f = currentFixture;
  const pair = (
    await f.pool.query<{
      left_assertion_id: string;
      right_assertion_id: string;
    }>(
      'SELECT left_assertion_id::text,right_assertion_id::text FROM vp.relation_jobs WHERE job_id=$1',
      [f.jobId],
    )
  ).rows[0]!;
  const decisionId = randomUUID();
  const relationId = randomUUID();
  // Synthetic prior positive history, not an adjudicated semantic reference.
  await f.pool.query(
    `INSERT INTO vp.decision_receipts(decision_id,project_id,method,task_kind,policy_revision,input_digest,outcome,left_assertion_id,right_assertion_id,confidence,provider_model,input_tokens,output_tokens,created_at)
     VALUES($1,$2,'GENERAL_AI','SEMANTIC_RELATION','synthetic-prior-positive-v1',$3,'SUPPORTS',$4,$5,1,'synthetic-no-network',100,40,clock_timestamp()-interval '1 hour')`,
    [
      decisionId,
      f.projectId,
      `sha256:${'a'.repeat(64)}`,
      pair.left_assertion_id,
      pair.right_assertion_id,
    ],
  );
  await f.pool.query(
    `INSERT INTO vp.relations(relation_id,project_id,left_assertion_id,right_assertion_id,relation_kind,relation_direction,decision_id)
     VALUES($1,$2,$3,$4,'SUPPORTS','LEFT_TO_RIGHT',$5)`,
    [relationId, f.projectId, pair.left_assertion_id, pair.right_assertion_id, decisionId],
  );
  const { PostgresVPAskEvidenceSearch } =
    await import('../../adapters/vp-knowledge-postgres/src/ask-evidence-search.js');
  const search = new PostgresVPAskEvidenceSearch(f.pool);
  const query = {
    projectId: f.projectId,
    question: 'duplex',
    accessScope: ['owner'],
    authorizedSensitivities: ['public'] as const,
    limit: 12,
  };
  const before = await search.search(query);
  expect(before.evidenceIds).toHaveLength(2);
  const savedPositive = (
    await f.pool.query('SELECT * FROM vp.relations WHERE relation_id=$1', [relationId])
  ).rows;
  expect(await f.dispatcher().dispatchOnce()).toBe('NO_RELATION');
  const after = await f.state('documented-product-projection-gap');
  expect(after.rows[0]).toMatchObject({
    status: 'COMPLETED',
    last_failure_code: 'ISOLATED_NO_RELATION',
  });
  expect(after.claimedCount).toBe(1);
  expect(after.receipts).toBe(1);
  expect(after.edges).toBe(1);
  expect(f.provider).toHaveBeenCalledTimes(1);
  expect(
    (await f.pool.query('SELECT * FROM vp.relations WHERE relation_id=$1', [relationId])).rows,
  ).toEqual(savedPositive);
  expect(
    (
      await f.pool.query('SELECT relation_id::text FROM vp.current_relations WHERE project_id=$1', [
        f.projectId,
      ])
    ).rows,
  ).toEqual([{ relation_id: relationId }]);
  const afterAsk = await search.search(query);
  expect(afterAsk.evidenceIds).toEqual(before.evidenceIds);
  expect(afterAsk.knowledgeEpoch).toBe(before.knowledgeEpoch);
  traces.push({
    scope: 'DOCUMENTED_UNIMPLEMENTED_PRODUCT_BOUNDARY',
    decisionId,
    relationId,
    before,
    afterAsk,
  });
  // These assertions document an UNIMPLEMENTED product boundary, not a product acceptance PASS.
});
