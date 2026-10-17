import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import { PostgresProjectAdministrationRepository } from '../../adapters/postgres/src/index.js';
import { PostgresVPAskEvidenceSearch } from '../../adapters/vp-knowledge-postgres/src/ask-evidence-search.js';
import { PostgresVPKnowledgeLedger } from '../../adapters/vp-knowledge-postgres/src/index.js';
import { PostgresIsolatedNegativeKnowledgeJobs } from '../../adapters/vp-knowledge-postgres/src/negative-knowledge-isolated.js';
import { PostgresGlobalRelationBudget } from '../../adapters/vp-global-provider-budget-postgres/src/index.js';
import {
  executionBoundRelationLedger,
  executionBoundRelationResolver,
  ExecutionBoundVPRelationDispatcher,
} from '../../adapters/vp-global-provider-budget-postgres/src/execution-boundary.js';
import { DurableIsolatedExplicitNegativeRouter } from '../../adapters/vp-decision-general-ai/src/explicit-negative-durable-isolated.js';
import { IsolatedFakeExplicitNegativeProvider } from '../../assemblies/shotgun-app/src/isolated-negative-fake-provider.js';
import {
  EXPLICIT_NEGATIVE_CHOICES,
  type ExplicitNegativeChoice,
} from '../../modules/vp-decision/src/explicit-negative-isolated.js';
import { VPRelationJobWorker } from '../../modules/vp-knowledge-ledger/src/index.js';
import {
  createIsolatedPostgresTestDatabase,
  type IsolatedPostgresTestDatabase,
} from '../helpers/isolated-postgres-test-database.js';
import { seedAssertion } from '../helpers/vp05-p0-fixtures.js';

const r1 = 'vp-relation-v6-explicit-negative-product-fake-v1:r1';
const r2 = 'vp-relation-v6-explicit-negative-product-fake-v1:r2';
const r3 = 'vp-relation-v6-explicit-negative-product-fake-v1:r3';
const artifactRoot = path.join(
  process.env.VP_NEGATIVE_PRODUCT_TRACE_OUTPUT ??
    path.join(tmpdir(), `shotgun-negative-product-${process.pid}`),
  'schema-tests',
);
const traces: unknown[] = [];
let db: IsolatedPostgresTestDatabase;
let authorityDb: IsolatedPostgresTestDatabase;
const storeId = randomUUID();

beforeAll(async () => {
  db = await createIsolatedPostgresTestDatabase();
  authorityDb = await createIsolatedPostgresTestDatabase();
  await authorityDb
    .createPool()
    .query('INSERT INTO vp_global_budget.authority_store(store_id) VALUES($1)', [storeId]);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('LIVE_NETWORK_DENIED_IN_PRODUCT_FAKE_TEST');
    }),
  );
}, 120_000);

afterAll(async () => {
  await mkdir(artifactRoot, { recursive: true });
  await writeFile(
    path.join(artifactRoot, 'database-product-traces.json'),
    JSON.stringify(
      {
        scope: 'SYNTHETIC_ISOLATED_FAKE_NOT_MODEL_QUALITY',
        storeId,
        traces,
        liveProviderCalls: 0,
      },
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
      EXPLICIT_NEGATIVE_CHOICES.map((candidate) => [
        candidate,
        candidate === choice
          ? probability
          : (1 - probability) / (EXPLICIT_NEGATIVE_CHOICES.length - 1),
      ]),
    ),
  };
}

async function fixture() {
  const pool = db.createPool();
  const authorityPool = authorityDb.createPool();
  const fake = new IsolatedFakeExplicitNegativeProvider(`isolated-fake-${randomUUID()}`);
  const authorityId = randomUUID();
  await authorityPool.query(
    `INSERT INTO vp_global_budget.policies(authority_id,provider,account_fingerprint,workload_class,budget_timezone,daily_limit)
      VALUES($1,'isolated-fake',$2,'VP_RELATION','UTC',100)`,
    [authorityId, fake.accountFingerprint],
  );
  const budget = new PostgresGlobalRelationBudget(authorityPool, {
    storeId,
    authorityId,
    provider: 'isolated-fake',
    accountFingerprint: fake.accountFingerprint,
    dailyLimit: 100,
  });
  const projectId = `negative-product-${randomUUID()}`;
  const principal = await new PostgresAuthRepository(pool).bootstrapLocalOwnerPrincipal({
    accountId: projectId,
  });
  await new PostgresProjectAdministrationRepository(pool).createProject({
    commandId: randomUUID(),
    clientRequestId: randomUUID(),
    idempotencyKey: randomUUID(),
    projectId,
    name: 'Synthetic negative product',
    description: 'Fake only',
    actorPrincipalId: principal.principalId,
    expectedProjectRevision: 0,
  });
  for (const claim of [
    'The synthetic printer supports duplex printing.',
    'The synthetic lake covers 42 square units.',
  ]) {
    await seedAssertion(pool, {
      projectId,
      principalId: principal.principalId,
      assertionId: randomUUID(),
      text: claim,
      sourceText: `${claim}\nSynthetic fixture ${projectId}`,
    });
  }
  const pairIds = (
    await pool.query<{ assertion_id: string }>(
      'SELECT assertion_id::text FROM vp.assertions WHERE project_id=$1 ORDER BY assertion_id',
      [projectId],
    )
  ).rows;
  const pair = {
    left_assertion_id: pairIds[0]!.assertion_id,
    right_assertion_id: pairIds[1]!.assertion_id,
  };
  const resolve = vi.fn(async () => ({
    adapter: fake,
    executionIdentity: {
      providerId: fake.identity.provider,
      modelId: fake.identity.model,
      aiConfigurationRevision: 1,
      credentialId: 'synthetic-no-vault',
      credentialRevision: 1,
      policyContextRevision: 'synthetic-only',
      providerPolicyFingerprint: fake.accountFingerprint,
    },
  }));
  function store(revision: string) {
    return new PostgresIsolatedNegativeKnowledgeJobs(pool, 'ISOLATED_FAKE', revision, projectId);
  }
  function dispatcher(revision: string, jobs = store(revision)) {
    const resolver = executionBoundRelationResolver({ resolve }, jobs, budget, {
      requiredProvider: 'isolated-fake',
      verifyCredential: async () => {},
    });
    const router = new DurableIsolatedExplicitNegativeRouter(
      resolver,
      executionBoundRelationLedger(jobs),
      { mode: 'PRODUCT_FAKE', revision },
    );
    return new ExecutionBoundVPRelationDispatcher(
      new VPRelationJobWorker(jobs, router, async () => true, revision, 1_000, 1, 'FRONTIER'),
      budget,
      projectId,
      jobs,
    );
  }
  async function run(revision: string, choice: ExplicitNegativeChoice, probability = 1) {
    const jobs = store(revision);
    fake.enqueue({
      rawText: JSON.stringify(declaration(choice, probability)),
      modelVersion: fake.identity.model,
      providerResponseId: `fake-${randomUUID()}`,
      inputTokens: 100,
      outputTokens: 40,
    });
    await jobs.enqueueCurrentPairs(revision, 1000);
    const result = await dispatcher(revision, jobs).dispatchOnce();
    traces.push({ projectId, revision, choice, result, calls: fake.calls() });
    return result;
  }
  async function counts() {
    const row = (
      await pool.query<{
        receipts: string;
        negatives: string;
        edges: string;
        current_edges: string;
        events: string;
      }>(
        `SELECT
      (SELECT count(*) FROM vp.decision_receipts WHERE project_id=$1 AND task_kind='SEMANTIC_RELATION')::text AS receipts,
      (SELECT count(*) FROM vp.decision_receipts WHERE project_id=$1 AND outcome='NO_RELATION')::text AS negatives,
      (SELECT count(*) FROM vp.relations WHERE project_id=$1)::text AS edges,
      (SELECT count(*) FROM vp.current_relations WHERE project_id=$1)::text AS current_edges,
      (SELECT count(*) FROM vp.history_events WHERE project_id=$1)::text AS events`,
        [projectId],
      )
    ).rows[0]!;
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)])) as {
      receipts: number;
      negatives: number;
      edges: number;
      current_edges: number;
      events: number;
    };
  }
  return {
    pool,
    authorityPool,
    budget,
    fake,
    projectId,
    principalId: principal.principalId,
    pair,
    store,
    dispatcher,
    run,
    counts,
    resolve,
  };
}

let f: Awaited<ReturnType<typeof fixture>>;
// Migration and source/Evidence setup are outside each behavior assertion.
beforeEach(async () => {
  f = await fixture();
}, 30_000);

it('ingests validated direct claims and deterministic exact equivalence under a product binding', async () => {
  await f.store(r1).bindPolicy({ expectedPreviousRevision: null });
  const text = `Synthetic exact code ${randomUUID()}`;
  for (let i = 0; i < 2; i++)
    await seedAssertion(f.pool, {
      projectId: f.projectId,
      principalId: f.principalId,
      assertionId: randomUUID(),
      text,
      sourceText: `${text}\nUnique document ${i}`,
      materialize: false,
    });
  expect(await new PostgresVPKnowledgeLedger(f.pool).ingestValidatedDirectClaims()).toBe(2);
  expect(
    (
      await f.pool.query(
        `SELECT r.relation_kind,d.policy_revision FROM vp.current_relations r
    JOIN vp.decision_receipts d USING(project_id,decision_id)
    WHERE r.project_id=$1 AND d.method='DETERMINISTIC' AND d.task_kind='EXACT_TEXT_EQUIVALENCE'`,
        [f.projectId],
      )
    ).rows,
  ).toEqual([{ relation_kind: 'EQUIVALENT', policy_revision: 'vp-normalized-exact-claim-v2' }]);
  expect((await f.counts()).receipts).toBe(0);
  expect(f.fake.calls()).toBe(0);
});

it('withdraws an earlier semantic Ask neighbor and restores it only with a new accepted revision', async () => {
  const search = new PostgresVPAskEvidenceSearch(f.pool);
  const question = {
    projectId: f.projectId,
    question: 'duplex',
    accessScope: ['owner'],
    authorizedSensitivities: ['public'] as const,
    limit: 12,
  };
  expect((await f.store(r1).bindPolicy({ expectedPreviousRevision: null })).epoch).toBe('1');
  expect(await f.run(r1, 'SUPPORTS')).toBe('DECIDED');
  expect((await f.counts()).current_edges).toBe(1);
  expect((await search.search(question)).evidenceIds).toHaveLength(2);
  await f.store(r2).bindPolicy({ expectedPreviousRevision: r1 });
  expect(await f.run(r2, 'NO_RELATION')).toBe('NO_RELATION');
  expect(await f.counts()).toMatchObject({ receipts: 2, negatives: 1, edges: 1, current_edges: 0 });
  expect((await search.search(question)).evidenceIds).toHaveLength(1);
  await f.store(r3).bindPolicy({ expectedPreviousRevision: r2 });
  expect(await f.run(r3, 'SUPPORTS')).toBe('DECIDED');
  expect(await f.counts()).toMatchObject({ receipts: 3, negatives: 1, edges: 2, current_edges: 1 });
  expect((await search.search(question)).evidenceIds).toHaveLength(2);
  expect(f.fake.calls()).toBe(3);
});

it('makes binding idempotent, compare-and-set, and non-reusable with one epoch/history per revision', async () => {
  const firstStore = new PostgresIsolatedNegativeKnowledgeJobs(
    f.pool,
    'ISOLATED_FAKE',
    r1,
    f.projectId,
  );
  const first = await firstStore.bindPolicy({ expectedPreviousRevision: null });
  expect(first.epoch).toBe('1');
  expect(await firstStore.bindPolicy({ expectedPreviousRevision: null })).toEqual(first);
  await expect(f.store(r2).bindPolicy({ expectedPreviousRevision: null })).rejects.toThrow(
    'compare-and-set',
  );
  expect((await f.store(r2).bindPolicy({ expectedPreviousRevision: r1 })).epoch).toBe('2');
  await expect(f.store(r1).bindPolicy({ expectedPreviousRevision: r2 })).rejects.toThrow(
    'cannot be reused',
  );
  const events = (
    await f.pool.query(
      "SELECT epoch::text,policy_revision FROM vp.history_events WHERE project_id=$1 AND event_kind='RELATION_POLICY_BOUND' ORDER BY epoch",
      [f.projectId],
    )
  ).rows;
  expect(events).toEqual([
    { epoch: '1', policy_revision: r1 },
    { epoch: '2', policy_revision: r2 },
  ]);
  expect((await f.counts()).events).toBe(2);
});

it('rejects a metadata-only policy rotation at commit and keeps the active binding', async () => {
  await f.store(r1).bindPolicy({ expectedPreviousRevision: null });
  const client = await f.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE vp.project_epochs SET relation_policy_revision=$2,current_epoch=current_epoch+1 WHERE project_id=$1',
      [f.projectId, r2],
    );
    await expect(client.query('COMMIT')).rejects.toMatchObject({
      constraint: 'vp_relation_policy_history_required',
    });
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  const binding = (
    await f.pool.query(
      'SELECT current_epoch::text,relation_policy_revision FROM vp.project_epochs WHERE project_id=$1',
      [f.projectId],
    )
  ).rows[0];
  expect(binding).toEqual({ current_epoch: '1', relation_policy_revision: r1 });
});

it.each([
  ['UNRESOLVED', 1, 'MODEL_ABSTAINED'],
  ['NO_RELATION', 0.7, 'WITHHELD'],
] as const)(
  'keeps %s at probability %s out of negative knowledge',
  async (choice, probability, result) => {
    await f.store(r1).bindPolicy({ expectedPreviousRevision: null });
    expect(await f.run(r1, choice, probability)).toBe(result);
    expect(await f.counts()).toMatchObject({
      receipts: 0,
      negatives: 0,
      edges: 0,
      current_edges: 0,
    });
    expect(f.fake.calls()).toBe(1);
    expect(await f.dispatcher(r1).dispatchOnce()).toBe('EMPTY');
  },
);

it('keeps invalid Fake output in execution history without a negative receipt', async () => {
  const jobs = f.store(r1);
  await jobs.bindPolicy({ expectedPreviousRevision: null });
  f.fake.enqueue({
    rawText: 'broken JSON',
    modelVersion: f.fake.identity.model,
    inputTokens: 100,
    outputTokens: 40,
  });
  await jobs.enqueueCurrentPairs(r1, 1000);
  expect(await f.dispatcher(r1, jobs).dispatchOnce()).toBe('INVALID');
  expect(await f.counts()).toMatchObject({ receipts: 0, negatives: 0, edges: 0 });
  expect(f.fake.calls()).toBe(1);
});

it('reads the committed negative once and rejects a conflicting outcome replay', async () => {
  const jobs = f.store(r1);
  await jobs.bindPolicy({ expectedPreviousRevision: null });
  expect(await f.run(r1, 'NO_RELATION')).toBe('NO_RELATION');
  const identity = (
    await f.pool.query<{ job_id: string; semantic_attempt_id: string }>(
      `SELECT job.job_id::text,call.semantic_attempt_id::text
       FROM vp.relation_jobs job JOIN vp.relation_provider_calls call USING(project_id,job_id)
       WHERE job.project_id=$1 AND job.policy_revision=$2`,
      [f.projectId, r1],
    )
  ).rows[0]!;
  expect(
    await jobs.readDecisionOutcome({
      jobId: identity.job_id,
      leaseToken: identity.semantic_attempt_id,
    }),
  ).toBe('COMPLETED');
  await expect(
    jobs.completeRecordedNoEdge({
      jobId: identity.job_id,
      leaseToken: identity.semantic_attempt_id,
      outcome: 'WITHHELD',
    }),
  ).rejects.toThrow('does not match its stored output');
  expect(await f.dispatcher(r1).dispatchOnce()).toBe('EMPTY');
  expect(await f.counts()).toMatchObject({ receipts: 1, negatives: 1, edges: 0 });
  expect(f.fake.calls()).toBe(1);
});

it('commits concurrent negative finalizers once and reads back a lost commit acknowledgement', async () => {
  const jobs = f.store(r1);
  await jobs.bindPolicy({ expectedPreviousRevision: null });
  const finalize = jobs.completeRecordedNoEdge.bind(jobs);
  vi.spyOn(jobs, 'completeRecordedNoEdge').mockImplementationOnce(async (input) => {
    expect(await Promise.all([finalize(input), finalize(input)])).toEqual([true, true]);
    throw Object.assign(new Error('synthetic lost COMMIT acknowledgement'), {
      code: 'OUTCOME_UNKNOWN',
    });
  });
  f.fake.enqueue({
    rawText: JSON.stringify(declaration('NO_RELATION')),
    modelVersion: f.fake.identity.model,
    inputTokens: 100,
    outputTokens: 40,
  });
  expect(await f.dispatcher(r1, jobs).dispatchOnce()).toBe('NO_RELATION');
  expect(await f.counts()).toMatchObject({ receipts: 1, negatives: 1, edges: 0, events: 2 });
  expect((await f.budget.status()).claimedCount).toBe(1);
  expect(f.fake.calls()).toBe(1);
  expect(await f.dispatcher(r1, f.store(r1)).dispatchOnce()).toBe('EMPTY');
  expect(f.fake.calls()).toBe(1);
});

it('preserves a stored old-revision outcome but refuses late publication after policy rotation', async () => {
  const old = f.store(r1);
  await old.bindPolicy({ expectedPreviousRevision: null });
  const finalize = old.completeRecordedNoEdge.bind(old);
  vi.spyOn(old, 'completeRecordedNoEdge').mockImplementationOnce(async () => {
    throw new Error('synthetic crash after durable output, before knowledge commit');
  });
  f.fake.enqueue({
    rawText: JSON.stringify(declaration('NO_RELATION')),
    modelVersion: f.fake.identity.model,
    inputTokens: 100,
    outputTokens: 40,
  });
  await old.enqueueCurrentPairs(r1, 1000);
  expect(await f.dispatcher(r1, old).dispatchOnce()).toBe('OUTCOME_UNKNOWN');
  const job = (
    await f.pool.query<{ job_id: string; lease_token: string; output_json: unknown }>(
      `SELECT job.job_id::text,job.lease_token::text,call.output_json FROM vp.relation_jobs job
      JOIN vp.relation_provider_calls call USING(project_id,job_id)
      WHERE job.project_id=$1 AND job.policy_revision=$2`,
      [f.projectId, r1],
    )
  ).rows[0]!;
  expect(job.output_json).not.toBeNull();
  await f.store(r2).bindPolicy({ expectedPreviousRevision: r1 });
  expect(
    await finalize({ jobId: job.job_id, leaseToken: job.lease_token, outcome: 'NO_RELATION' }),
  ).toBe(false);
  const status = (
    await f.pool.query('SELECT status,last_failure_code FROM vp.relation_jobs WHERE job_id=$1', [
      job.job_id,
    ])
  ).rows[0];
  expect(status).toMatchObject({
    status: 'SUPERSEDED',
    last_failure_code: 'RELATION_POLICY_SUPERSEDED',
  });
  expect(await f.counts()).toMatchObject({ receipts: 0, negatives: 0, edges: 0 });
  expect(f.fake.calls()).toBe(1);
});

it('finalizes a stored Fake response after lease recovery without a second call or attempt', async () => {
  const old = f.store(r1);
  await old.bindPolicy({ expectedPreviousRevision: null });
  vi.spyOn(old, 'completeRecordedNoEdge').mockRejectedValueOnce(
    new Error('synthetic crash after durable output, before knowledge commit'),
  );
  f.fake.enqueue({
    rawText: JSON.stringify(declaration('NO_RELATION')),
    modelVersion: f.fake.identity.model,
    inputTokens: 100,
    outputTokens: 40,
  });
  await old.enqueueCurrentPairs(r1, 1000);
  expect(await f.dispatcher(r1, old).dispatchOnce()).toBe('OUTCOME_UNKNOWN');
  const before = (
    await f.pool.query<{
      job_id: string;
      status: string;
      attempt_count: number;
      call_id: string;
      semantic_attempt_id: string;
    }>(
      `SELECT job.job_id::text,job.status,job.attempt_count,
         call.call_id::text,call.semantic_attempt_id::text
       FROM vp.relation_jobs job JOIN vp.relation_provider_calls call USING(project_id,job_id)
       WHERE job.project_id=$1 AND job.policy_revision=$2`,
      [f.projectId, r1],
    )
  ).rows[0]!;
  expect(before.status).toBe('RUNNING');
  await f.pool.query(
    "UPDATE vp.relation_jobs SET lease_expires_at=clock_timestamp()-interval '1 second',next_attempt_at=clock_timestamp()-interval '1 second' WHERE job_id=$1",
    [before.job_id],
  );
  f.resolve.mockRejectedValue(new Error('stored output must not re-resolve configuration'));
  expect(await f.dispatcher(r1, f.store(r1)).dispatchOnce()).toBe('NO_RELATION');
  const after = (
    await f.pool.query<{
      status: string;
      attempt_count: number;
      call_id: string;
      semantic_attempt_id: string;
    }>(
      `SELECT job.status,job.attempt_count,call.call_id::text,call.semantic_attempt_id::text
       FROM vp.relation_jobs job JOIN vp.relation_provider_calls call USING(project_id,job_id)
       WHERE job.job_id=$1`,
      [before.job_id],
    )
  ).rows[0]!;
  expect(after).toMatchObject({
    status: 'COMPLETED',
    attempt_count: 1,
    call_id: before.call_id,
    semantic_attempt_id: before.semantic_attempt_id,
  });
  expect(await f.counts()).toMatchObject({ receipts: 1, negatives: 1, edges: 0 });
  expect((await f.budget.status()).claimedCount).toBe(1);
  expect(f.resolve).toHaveBeenCalledTimes(1);
  expect(f.fake.calls()).toBe(1);
});

it('supersedes stored negative output when its SourceVersion is no longer current', async () => {
  const jobs = f.store(r1);
  await jobs.bindPolicy({ expectedPreviousRevision: null });
  const finish = jobs.completeRecordedNoEdge.bind(jobs);
  vi.spyOn(jobs, 'completeRecordedNoEdge').mockRejectedValueOnce(
    new Error('synthetic interruption before product knowledge commit'),
  );
  f.fake.enqueue({
    rawText: JSON.stringify(declaration('NO_RELATION')),
    modelVersion: f.fake.identity.model,
    inputTokens: 100,
    outputTokens: 40,
  });
  expect(await f.dispatcher(r1, jobs).dispatchOnce()).toBe('OUTCOME_UNKNOWN');
  const pending = (
    await f.pool.query<{ job_id: string; lease_token: string }>(
      'SELECT job_id::text,lease_token::text FROM vp.relation_jobs WHERE project_id=$1 AND policy_revision=$2',
      [f.projectId, r1],
    )
  ).rows[0]!;
  const newerText = `newer synthetic version ${randomUUID()}`;
  const newAssetId = randomUUID();
  await f.pool.query(
    `INSERT INTO asset.original_assets(asset_id,content_hash,size_bytes,storage_key,created_at)
     VALUES($1,$2,$3,$4,clock_timestamp())`,
    [
      newAssetId,
      `sha256:${createHash('sha256').update(newerText).digest('hex')}`,
      Buffer.byteLength(newerText),
      `product-source-revision-${newAssetId}`,
    ],
  );
  await f.pool.query(
    `INSERT INTO asset.source_versions(source_version_id,source_id,version_number,original_asset_id,
       media_type,access_scope,sensitivity,created_at)
     SELECT gen_random_uuid(),source_id,version_number+1,$3,media_type,
       access_scope,sensitivity,clock_timestamp()
     FROM asset.source_versions WHERE source_version_id=(
       SELECT source_version_id FROM vp.assertions WHERE project_id=$1 AND assertion_id=$2)`,
    [f.projectId, f.pair.left_assertion_id, newAssetId],
  );
  expect(
    await finish({
      jobId: pending.job_id,
      leaseToken: pending.lease_token,
      outcome: 'NO_RELATION',
    }),
  ).toBe(false);
  expect(
    (
      await f.pool.query('SELECT status,last_failure_code FROM vp.relation_jobs WHERE job_id=$1', [
        pending.job_id,
      ])
    ).rows[0],
  ).toMatchObject({ status: 'SUPERSEDED', last_failure_code: 'SOURCE_VERSION_SUPERSEDED' });
  expect(await f.counts()).toMatchObject({ receipts: 0, negatives: 0, edges: 0 });
  expect(f.fake.calls()).toBe(1);
});

it('erases linked negative receipt, history, and provider call through authorized VP T3 owner', async () => {
  await f.store(r1).bindPolicy({ expectedPreviousRevision: null });
  expect(await f.run(r1, 'NO_RELATION')).toBe('NO_RELATION');
  expect(await f.counts()).toMatchObject({ receipts: 1, negatives: 1, events: 2 });
  const requestId = randomUUID();
  const manifest = `sha256:${'a'.repeat(64)}`;
  await f.pool.query(
    "INSERT INTO project_admin.project_knowledge_epoch(project_id,epoch,state) VALUES($1,1,'RESET_PENDING')",
    [f.projectId],
  );
  await f.pool.query(
    `INSERT INTO project_admin.project_knowledge_reset_requests
       (request_id,preview_id,project_id,actor_principal_id,project_revision,
        expected_knowledge_epoch,resulting_knowledge_epoch,manifest_digest,
        owner_manifest_digest,idempotency_key,state)
     SELECT $1,$2,$3,$4,project.revision,0,1,$5,$5,$6,'PURGING'
       FROM project_admin.projects AS project WHERE project.id=$3`,
    [requestId, randomUUID(), f.projectId, f.principalId, manifest, randomUUID()],
  );
  await expect(
    f.pool.query('SELECT vp.t3_erase_project($1,$2)', [f.projectId, requestId]),
  ).rejects.toMatchObject({ constraint: 't3_erasure_executor_required' });
  const client = await f.pool.connect();
  try {
    await client.query('SET SESSION AUTHORIZATION shotgun_erasure_executor');
    const before = (
      await client.query<{ status: Record<string, number> }>(
        'SELECT vp.t3_project_status($1,$2) AS status',
        [f.projectId, requestId],
      )
    ).rows[0]!.status;
    expect(before).toMatchObject({ provider_calls: 1, decisions: 1, events: 2 });
    await client.query('SELECT vp.t3_erase_project($1,$2)', [f.projectId, requestId]);
    const after = (
      await client.query<{ status: Record<string, number> }>(
        'SELECT vp.t3_project_status($1,$2) AS status',
        [f.projectId, requestId],
      )
    ).rows[0]!.status;
    expect(after).toMatchObject({ provider_calls: 0, decisions: 0, events: 0, jobs: 0, epochs: 0 });
  } finally {
    await client.query('RESET SESSION AUTHORIZATION');
    client.release();
  }
});

it('retains deterministic exact equivalence through a late Fake negative and unresolved veto', async () => {
  const jobs = f.store(r1);
  await jobs.bindPolicy({ expectedPreviousRevision: null });
  const finish = jobs.completeRecordedNoEdge.bind(jobs);
  vi.spyOn(jobs, 'completeRecordedNoEdge').mockImplementationOnce(async (input) => {
    const decisionId = randomUUID();
    await f.pool.query(
      `INSERT INTO vp.decision_receipts(decision_id,project_id,method,task_kind,policy_revision,input_digest,outcome)
       VALUES($1,$2,'DETERMINISTIC','EXACT_TEXT_EQUIVALENCE','synthetic-exact-v1',$3,'EQUIVALENT')`,
      [decisionId, f.projectId, `sha256:${'a'.repeat(64)}`],
    );
    await f.pool.query(
      `INSERT INTO vp.relations(relation_id,project_id,left_assertion_id,right_assertion_id,relation_kind,relation_direction,decision_id)
       VALUES($1,$2,$3,$4,'EQUIVALENT','UNDIRECTED',$5)`,
      [randomUUID(), f.projectId, f.pair.left_assertion_id, f.pair.right_assertion_id, decisionId],
    );
    return finish(input);
  });
  f.fake.enqueue({
    rawText: JSON.stringify(declaration('NO_RELATION')),
    modelVersion: f.fake.identity.model,
    inputTokens: 100,
    outputTokens: 40,
  });
  expect(await f.dispatcher(r1, jobs).dispatchOnce()).toBe('SUPERSEDED');
  expect(await f.counts()).toMatchObject({ receipts: 0, negatives: 0, current_edges: 1 });
  const job = (
    await f.pool.query(
      'SELECT status,last_failure_code FROM vp.relation_jobs WHERE project_id=$1',
      [f.projectId],
    )
  ).rows[0];
  expect(job).toMatchObject({
    status: 'SUPERSEDED',
    last_failure_code: 'DETERMINISTIC_EQUIVALENCE_PRESERVED',
  });
  await f.store(r2).bindPolicy({ expectedPreviousRevision: r1 });
  await f.pool.query(
    `INSERT INTO vp.relation_jobs(job_id,project_id,left_assertion_id,right_assertion_id,
      policy_revision,status,last_failure_code,updated_at)
     VALUES($1,$2,$3,$4,$5,'COMPLETED','INSUFFICIENT_EVIDENCE',clock_timestamp())`,
    [randomUUID(), f.projectId, f.pair.left_assertion_id, f.pair.right_assertion_id, r2],
  );
  expect((await f.counts()).current_edges).toBe(1);
});
