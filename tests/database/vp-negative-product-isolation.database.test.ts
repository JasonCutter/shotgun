import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import { PostgresProjectAdministrationRepository } from '../../adapters/postgres/src/index.js';
import { PostgresIsolatedNegativeKnowledgeJobs } from '../../adapters/vp-knowledge-postgres/src/negative-knowledge-isolated.js';
import { PostgresGlobalRelationBudget } from '../../adapters/vp-global-provider-budget-postgres/src/index.js';
import {
  executionBoundRelationLedger,
  executionBoundRelationResolver,
  ExecutionBoundVPRelationDispatcher,
} from '../../adapters/vp-global-provider-budget-postgres/src/execution-boundary.js';
import { DurableIsolatedExplicitNegativeRouter } from '../../adapters/vp-decision-general-ai/src/explicit-negative-durable-isolated.js';
import { IsolatedFakeExplicitNegativeProvider } from '../../assemblies/shotgun-app/src/isolated-negative-fake-provider.js';
import { EXPLICIT_NEGATIVE_CHOICES } from '../../modules/vp-decision/src/explicit-negative-isolated.js';
import { VPRelationJobWorker } from '../../modules/vp-knowledge-ledger/src/index.js';
import {
  createIsolatedPostgresTestDatabase,
  type IsolatedPostgresTestDatabase,
} from '../helpers/isolated-postgres-test-database.js';
import { seedAssertion } from '../helpers/vp05-p0-fixtures.js';

const revision = 'vp-relation-v6-explicit-negative-product-fake-v1:r1';
const sha256 = (value: string): string =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;
let db: IsolatedPostgresTestDatabase;
let authorityDb: IsolatedPostgresTestDatabase;
let pool: Pool;
let authorityPool: Pool;
const storeId = randomUUID();

beforeAll(async () => {
  db = await createIsolatedPostgresTestDatabase();
  authorityDb = await createIsolatedPostgresTestDatabase();
  pool = db.createPool();
  authorityPool = authorityDb.createPool();
  await authorityPool.query('INSERT INTO vp_global_budget.authority_store(store_id) VALUES($1)', [
    storeId,
  ]);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('LIVE_NETWORK_DENIED_IN_PRODUCT_FAKE_TEST');
    }),
  );
}, 120_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  await Promise.all([db?.dispose(), authorityDb?.dispose()]);
}, 120_000);

async function project() {
  const projectId = `negative-isolation-${randomUUID()}`;
  const principal = await new PostgresAuthRepository(pool).bootstrapLocalOwnerPrincipal({
    accountId: projectId,
  });
  await new PostgresProjectAdministrationRepository(pool).createProject({
    commandId: randomUUID(),
    clientRequestId: randomUUID(),
    idempotencyKey: randomUUID(),
    projectId,
    name: 'Isolated Fake safety regression',
    description: 'Synthetic only',
    actorPrincipalId: principal.principalId,
    expectedProjectRevision: 0,
  });
  for (const text of [
    'Synthetic orchard has a green gate.',
    'Synthetic observatory has a red dome.',
  ]) {
    await seedAssertion(pool, {
      projectId,
      principalId: principal.principalId,
      assertionId: randomUUID(),
      text,
      sourceText: `${text}\nUnique synthetic fixture ${projectId}`,
    });
  }
  const assertions = (
    await pool.query<{ assertion_id: string; source_id: string }>(
      'SELECT assertion_id::text,source_id::text FROM vp.assertions WHERE project_id=$1 ORDER BY assertion_id',
      [projectId],
    )
  ).rows;
  const jobs = new PostgresIsolatedNegativeKnowledgeJobs(
    pool,
    'ISOLATED_FAKE',
    revision,
    projectId,
  );
  await jobs.bindPolicy({ expectedPreviousRevision: null });
  return { projectId, assertions, jobs };
}

async function storedFakeOutput(choice: 'NO_RELATION' | 'SUPPORTS') {
  const fixture = await project();
  const fake = new IsolatedFakeExplicitNegativeProvider(`isolated-fake-${randomUUID()}`);
  const authorityId = randomUUID();
  await authorityPool.query(
    `INSERT INTO vp_global_budget.policies
       (authority_id,provider,account_fingerprint,workload_class,budget_timezone,daily_limit)
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
  const resolver = executionBoundRelationResolver({ resolve }, fixture.jobs, budget, {
    requiredProvider: 'isolated-fake',
    verifyCredential: async () => {},
  });
  const router = new DurableIsolatedExplicitNegativeRouter(
    resolver,
    executionBoundRelationLedger(fixture.jobs),
    { mode: 'PRODUCT_FAKE', revision },
  );
  fake.enqueue({
    rawText: JSON.stringify({
      choice,
      direction: choice === 'SUPPORTS' ? 'LEFT_TO_RIGHT' : 'NONE',
      confidence: 0.6,
      probabilities: Object.fromEntries(
        EXPLICIT_NEGATIVE_CHOICES.map((candidate) => [candidate, candidate === choice ? 1 : 0]),
      ),
    }),
    modelVersion: fake.identity.model,
    providerResponseId: `fake-${randomUUID()}`,
    inputTokens: 100,
    outputTokens: 40,
  });
  // Stop after the single counted Fake call is stored, before a knowledge write.
  if (choice === 'NO_RELATION') {
    vi.spyOn(fixture.jobs, 'completeRecordedNoEdge').mockRejectedValueOnce(
      new Error('synthetic cutoff before knowledge commit'),
    );
  } else {
    vi.spyOn(fixture.jobs, 'completeDecision').mockRejectedValueOnce(
      new Error('synthetic cutoff before knowledge commit'),
    );
  }
  const dispatcher = new ExecutionBoundVPRelationDispatcher(
    new VPRelationJobWorker(fixture.jobs, router, async () => true, revision, 5_000, 4, 'FRONTIER'),
    budget,
    fixture.projectId,
    fixture.jobs,
  );
  await dispatcher.dispatchOnce();
  expect(fake.calls()).toBe(1);
  const call = (
    await pool.query<{
      job_id: string;
      call_id: string;
      request_digest: string;
      output_json: {
        record: {
          disposition: { declaration: { confidence: number; direction: string } };
          providerIdentity: { provider: string; model: string };
          providerObservation: {
            modelVersion: string | null;
            inputTokens: number;
            outputTokens: number;
          };
        };
      };
    }>(
      `SELECT job.job_id::text,call.call_id::text,call.request_digest,call.output_json
       FROM vp.relation_jobs job JOIN vp.relation_provider_calls call USING(project_id,job_id)
       WHERE job.project_id=$1 AND call.state='OUTPUT_STORED'`,
      [fixture.projectId],
    )
  ).rows[0];
  expect(call).toBeDefined();
  // A fresh completion lease is valid after recovery; the original provider
  // call, global claim and semantic attempt remain immutable.
  const leaseToken = randomUUID();
  await pool.query(
    `UPDATE vp.relation_jobs SET status='RUNNING',lease_token=$2,
       lease_expires_at=clock_timestamp()+interval '5 minutes',next_attempt_at=NULL
     WHERE job_id=$1`,
    [call!.job_id, leaseToken],
  );
  return { ...fixture, call: call!, leaseToken };
}

it('limits expired execution recovery to the admitted product Project', async () => {
  const first = await project();
  const second = await project();
  const jobIds: string[] = [];
  for (const fixture of [first, second]) {
    const jobId = randomUUID();
    await pool.query(
      `INSERT INTO vp.relation_jobs
       (job_id,project_id,left_assertion_id,right_assertion_id,policy_revision,
        max_attempts,attempt_count,status,lease_token,lease_expires_at)
       VALUES($1,$2,$3,$4,$5,3,3,'RUNNING',$6,clock_timestamp()-interval '1 second')`,
      [
        jobId,
        fixture.projectId,
        fixture.assertions[0]!.assertion_id,
        fixture.assertions[1]!.assertion_id,
        revision,
        randomUUID(),
      ],
    );
    jobIds.push(jobId);
  }
  await first.jobs.claimNext(revision);
  const statuses = (
    await pool.query<{ job_id: string; status: string }>(
      'SELECT job_id::text,status FROM vp.relation_jobs WHERE job_id=ANY($1::uuid[])',
      [jobIds],
    )
  ).rows;
  expect(statuses.find((row) => row.job_id === jobIds[0])?.status).toBe('FAILED');
  expect(statuses.find((row) => row.job_id === jobIds[1])?.status).toBe('RUNNING');
});

async function waitForSourceLockWait(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const waiting = await pool.query(
      `SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
       AND pid<>pg_backend_pid() AND wait_event_type='Lock'
       AND query LIKE $1 LIMIT 1`,
      ['%SELECT source.source_id FROM asset.sources AS source%'],
    );
    if (waiting.rowCount) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Product completion did not wait on the Source row lock.');
}

it('waits for a concurrent SourceVersion writer and rejects its stale stored pair', async () => {
  const fixture = await storedFakeOutput('NO_RELATION');
  const sourceId = fixture.assertions[0]!.source_id;
  const writer: PoolClient = await pool.connect();
  let committed = false;
  try {
    await writer.query('BEGIN');
    await writer.query('SELECT source_id FROM asset.sources WHERE source_id=$1 FOR UPDATE', [
      sourceId,
    ]);
    const finish = fixture.jobs.completeRecordedNoEdge({
      jobId: fixture.call.job_id,
      leaseToken: fixture.leaseToken,
      outcome: 'NO_RELATION',
    });
    await waitForSourceLockWait();
    const assetId = randomUUID();
    const newText = `synthetic replacement ${assetId}`;
    await writer.query(
      `INSERT INTO asset.original_assets(asset_id,content_hash,size_bytes,storage_key,created_at)
       VALUES($1,$2,$3,$4,clock_timestamp())`,
      [assetId, sha256(newText), Buffer.byteLength(newText), `negative-isolation-${assetId}`],
    );
    await writer.query(
      `INSERT INTO asset.source_versions
       (source_version_id,source_id,version_number,original_asset_id,media_type,access_scope,sensitivity,created_at)
       VALUES($1,$2,2,$3,'text/plain','{owner}','public',clock_timestamp())`,
      [randomUUID(), sourceId, assetId],
    );
    await writer.query('COMMIT');
    committed = true;
    expect(await finish).toBe(false);
  } finally {
    if (!committed) await writer.query('ROLLBACK');
    writer.release();
  }
  const outcome = (
    await pool.query<{ status: string; last_failure_code: string }>(
      'SELECT status,last_failure_code FROM vp.relation_jobs WHERE job_id=$1',
      [fixture.call.job_id],
    )
  ).rows[0];
  expect(outcome).toMatchObject({
    status: 'SUPERSEDED',
    last_failure_code: 'SOURCE_VERSION_SUPERSEDED',
  });
  expect(
    (
      await pool.query('SELECT 1 FROM vp.decision_receipts WHERE project_id=$1', [
        fixture.projectId,
      ])
    ).rowCount,
  ).toBe(0);
});

it('rejects a malformed product receipt and an edge direction unlike the stored declaration', async () => {
  const fixture = await storedFakeOutput('SUPPORTS');
  const { record } = fixture.call.output_json;
  const left = fixture.assertions[0]!.assertion_id;
  const right = fixture.assertions[1]!.assertion_id;
  const model = `${record.providerIdentity.provider}/${record.providerObservation.modelVersion ?? record.providerIdentity.model}`;
  const decisionId = randomUUID();
  const receiptValues = [
    decisionId,
    fixture.projectId,
    revision,
    fixture.call.request_digest,
    left,
    right,
    record.disposition.declaration.confidence,
    model,
    record.providerObservation.inputTokens,
    record.providerObservation.outputTokens,
    fixture.call.call_id,
  ];
  const insertReceipt = `INSERT INTO vp.decision_receipts
    (decision_id,project_id,method,task_kind,policy_revision,input_digest,outcome,
     left_assertion_id,right_assertion_id,confidence,provider_model,input_tokens,output_tokens,provider_call_id)
    VALUES($1,$2,'GENERAL_AI','SEMANTIC_RELATION',$3,$4,'SUPPORTS',$5,$6,$7,$8,$9,$10,$11)`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await expect(
      client.query(insertReceipt, receiptValues.with(3, sha256('wrong digest'))),
    ).rejects.toMatchObject({
      constraint: 'vp_product_provider_call_mismatch',
    });
    await client.query('ROLLBACK');
    await client.query('BEGIN');
    await client.query(insertReceipt, receiptValues);
    await expect(
      client.query(
        `INSERT INTO vp.relations
         (relation_id,project_id,left_assertion_id,right_assertion_id,relation_kind,relation_direction,decision_id)
         VALUES($1,$2,$3,$4,'SUPPORTS','RIGHT_TO_LEFT',$5)`,
        [randomUUID(), fixture.projectId, left, right, decisionId],
      ),
    ).rejects.toMatchObject({ constraint: 'vp_product_edge_output_mismatch' });
    await client.query('ROLLBACK');
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  expect(
    (
      await pool.query('SELECT 1 FROM vp.decision_receipts WHERE project_id=$1', [
        fixture.projectId,
      ])
    ).rowCount,
  ).toBe(0);
});
