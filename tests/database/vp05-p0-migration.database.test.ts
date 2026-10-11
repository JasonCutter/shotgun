import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';
import { dropSchemas, migrateUpTo } from '../../scripts/database.js';
import { PostgresGlobalRelationBudget } from '../../adapters/vp-global-provider-budget-postgres/src/index.js';
import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import { PostgresProjectAdministrationRepository } from '../../adapters/postgres/src/index.js';
import { seedAssertion } from '../helpers/vp05-p0-fixtures.js';

it('upgrades main 128 additively, preserves a historical receipt, and resets an unprovisioned workload copy', async () => {
  const db = await createIsolatedPostgresTestDatabase({
    migrate: (url) => migrateUpTo('128_ask_external_source_freshness.sql', url),
  });
  const pool = db.createPool();
  try {
    const projectId = 'legacy-' + randomUUID();
    const principal = await new PostgresAuthRepository(pool).bootstrapLocalOwnerPrincipal({
      accountId: projectId,
    });
    await new PostgresProjectAdministrationRepository(pool).createProject({
      commandId: randomUUID(),
      clientRequestId: randomUUID(),
      idempotencyKey: randomUUID(),
      projectId,
      name: 'Legacy migration fixture',
      description: 'synthetic historical receipt',
      actorPrincipalId: principal.principalId,
      expectedProjectRevision: 0,
    });
    for (const text of ['Legacy archive has 42 records.', 'Legacy archive has 43 records.'])
      await seedAssertion(pool, {
        projectId,
        principalId: principal.principalId,
        assertionId: randomUUID(),
        text,
      });
    const jobId = randomUUID();
    await pool.query(
      `INSERT INTO vp.relation_jobs(job_id,project_id,left_assertion_id,right_assertion_id,policy_revision,attempt_count)
      SELECT $1,$2,ids[1],ids[2],'vp-deepseek-relation-v6-evidence-context',1 FROM
      (SELECT array_agg(assertion_id ORDER BY assertion_id) AS ids FROM vp.current_assertions WHERE project_id=$2) pair`,
      [jobId, projectId],
    );
    await pool.query(
      `INSERT INTO vp.relation_provider_calls(project_id,job_id,execution_key,request_digest,provider_identity,state,failure_code)
      VALUES($1,$2,$3,$4,'deepseek/legacy','OUTCOME_UNKNOWN','LEGACY_FROZEN_UNKNOWN')`,
      [projectId, jobId, 'sha256:' + '1'.repeat(64), 'sha256:' + '2'.repeat(64)],
    );
    const historical = (
      await pool.query(
        `SELECT job.attempt_count,call.call_id::text,call.state,call.request_digest,call.failure_code FROM vp.relation_jobs job JOIN vp.relation_provider_calls call USING(project_id,job_id) WHERE job.job_id=$1`,
        [jobId],
      )
    ).rows;
    const before = (await pool.query('SELECT count(*)::int AS n FROM runtime.schema_migrations'))
      .rows[0].n;
    await migrateUpTo(undefined, db.databaseUrl);
    await migrateUpTo(undefined, db.databaseUrl);
    expect(
      (await pool.query('SELECT count(*)::int AS n FROM runtime.schema_migrations')).rows[0].n,
    ).toBe(before + 2);
    const columns = (
      await pool.query(
        `SELECT column_name,is_nullable FROM information_schema.columns WHERE table_schema='vp' AND table_name='relation_provider_calls' AND column_name IN ('global_claim_id','semantic_attempt_id') ORDER BY column_name`,
      )
    ).rows;
    expect(columns).toEqual([
      { column_name: 'global_claim_id', is_nullable: 'YES' },
      { column_name: 'semantic_attempt_id', is_nullable: 'YES' },
    ]);
    expect(
      (
        await pool.query(
          `SELECT job.attempt_count,call.call_id::text,call.state,call.request_digest,call.failure_code FROM vp.relation_jobs job JOIN vp.relation_provider_calls call USING(project_id,job_id) WHERE job.job_id=$1`,
          [jobId],
        )
      ).rows,
    ).toEqual(historical);
    expect(
      (
        await pool.query(
          `SELECT global_claim_id,semantic_attempt_id FROM vp.relation_provider_calls WHERE job_id=$1`,
          [jobId],
        )
      ).rows,
    ).toEqual([{ global_claim_id: null, semantic_attempt_id: null }]);
    // Additive migration leaves legacy nullable receipts intact; no bulk replay/recount.
    expect(
      (await pool.query('SELECT count(*)::int AS n FROM vp_global_budget.authority_store')).rows[0]
        .n,
    ).toBe(0);
    await dropSchemas(db.databaseUrl);
    await migrateUpTo(undefined, db.databaseUrl);
    expect(
      (await pool.query('SELECT count(*)::int AS n FROM vp_global_budget.authority_store')).rows[0]
        .n,
    ).toBe(0);
  } finally {
    await db.dispose();
  }
}, 120000);

it('fails closed on an old authority schema, upgrades the same identity, and refuses authority reset', async () => {
  const db = await createIsolatedPostgresTestDatabase();
  const pool = db.createPool();
  const storeId = randomUUID(),
    authorityId = randomUUID();
  try {
    await pool.query('INSERT INTO vp_global_budget.authority_store(store_id) VALUES($1)', [
      storeId,
    ]);
    await pool.query(
      `INSERT INTO vp_global_budget.policies(authority_id,provider,account_fingerprint,workload_class,budget_timezone,daily_limit) VALUES($1,'deepseek',$2,'VP_RELATION','UTC',100)`,
      [authorityId, '7'.repeat(64)],
    );
    await pool.query('ALTER TABLE vp_global_budget.claims DROP COLUMN execution_authorized_at');
    const budget = new PostgresGlobalRelationBudget(pool, {
      storeId,
      authorityId,
      provider: 'deepseek',
      accountFingerprint: '7'.repeat(64),
      dailyLimit: 100,
    });
    await expect(budget.status()).rejects.toMatchObject({ reason: 'IDENTITY_UNVERIFIED' });
    await expect(budget.claim('old-schema')).rejects.toMatchObject({
      reason: 'IDENTITY_UNVERIFIED',
    });
    expect(
      (await pool.query('SELECT count(*)::int AS n FROM vp_global_budget.claims')).rows[0].n,
    ).toBe(0);
    const upgrade = await readFile(
      'db/authority-migrations/001_relation_execution_fence.sql',
      'utf8',
    );
    await pool.query(upgrade);
    await pool.query(upgrade);
    expect(await budget.status()).toMatchObject({
      storeId,
      authorityId,
      claimedCount: 0,
      dailyLimit: 100,
    });
    await expect(dropSchemas(db.databaseUrl)).rejects.toThrow(
      'Refusing to reset a provisioned global authority store',
    );
    expect(await budget.status()).toMatchObject({ storeId, authorityId, claimedCount: 0 });
  } finally {
    await db.dispose();
  }
}, 120000);

it('refuses an old-schema upgrade with an unresolved reservation instead of reclassifying it as unused', async () => {
  const db = await createIsolatedPostgresTestDatabase();
  const pool = db.createPool();
  const storeId = randomUUID(),
    authorityId = randomUUID();
  try {
    await pool.query('INSERT INTO vp_global_budget.authority_store(store_id) VALUES($1)', [
      storeId,
    ]);
    await pool.query(
      `INSERT INTO vp_global_budget.policies(authority_id,provider,account_fingerprint,workload_class,budget_timezone,daily_limit) VALUES($1,'deepseek',$2,'VP_RELATION','UTC',100)`,
      [authorityId, '4'.repeat(64)],
    );
    const budget = new PostgresGlobalRelationBudget(pool, {
      storeId,
      authorityId,
      provider: 'deepseek',
      accountFingerprint: '4'.repeat(64),
      dailyLimit: 100,
    });
    const claim = await budget.claim('synthetic-legacy-reservation');
    await pool.query('ALTER TABLE vp_global_budget.claims DROP COLUMN execution_authorized_at');
    const upgrade = await readFile(
      'db/authority-migrations/001_relation_execution_fence.sql',
      'utf8',
    );
    await expect(pool.query(upgrade)).rejects.toThrow('Reconcile existing RESERVED claims');
    await pool.query('ROLLBACK');
    expect(
      (
        await pool.query('SELECT state FROM vp_global_budget.claims WHERE claim_id=$1', [
          claim.claimId,
        ])
      ).rows,
    ).toEqual([{ state: 'RESERVED' }]);
    expect(
      (
        await pool.query(
          'SELECT claimed_count FROM vp_global_budget.daily_usage WHERE authority_id=$1',
          [authorityId],
        )
      ).rows,
    ).toEqual([{ claimed_count: 1 }]);
  } finally {
    await db.dispose();
  }
}, 120000);
