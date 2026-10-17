import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import { PostgresProjectAdministrationRepository } from '../../adapters/postgres/src/index.js';
import { migrateUpTo } from '../../scripts/database.js';
import {
  createIsolatedPostgresTestDatabase,
  type IsolatedPostgresTestDatabase,
} from '../helpers/isolated-postgres-test-database.js';
import { seedAssertion } from '../helpers/vp05-p0-fixtures.js';

let db: IsolatedPostgresTestDatabase;
beforeAll(async () => {
  db = await createIsolatedPostgresTestDatabase({
    migrate: (url) => migrateUpTo('139_isolated_image_live_transport_identity.sql', url),
  });
}, 120_000);
afterAll(async () => {
  await db?.dispose();
});

it('rolls back migration 140 atomically and preserves a legacy current edge on upgrade', async () => {
  const pool = db.createPool(),
    projectId = `migration-negative-${randomUUID()}`;
  const principal = await new PostgresAuthRepository(pool).bootstrapLocalOwnerPrincipal({
    accountId: projectId,
  });
  await new PostgresProjectAdministrationRepository(pool).createProject({
    commandId: randomUUID(),
    clientRequestId: randomUUID(),
    idempotencyKey: randomUUID(),
    projectId,
    name: 'Synthetic migration preservation',
    actorPrincipalId: principal.principalId,
    expectedProjectRevision: 0,
  });
  const ids = [randomUUID(), randomUUID()].sort();
  for (let i = 0; i < ids.length; i++)
    await seedAssertion(pool, {
      projectId,
      principalId: principal.principalId,
      assertionId: ids[i]!,
      text: `Synthetic legacy claim ${i} ${projectId}`,
    });
  const decisionId = randomUUID();
  await pool.query(
    `INSERT INTO vp.decision_receipts
    (decision_id,project_id,method,task_kind,policy_revision,input_digest,outcome,
     left_assertion_id,right_assertion_id,confidence,provider_model,input_tokens,output_tokens)
    VALUES($1,$2,'GENERAL_AI','SEMANTIC_RELATION','vp-deepseek-relation-v6-evidence-context',
      $3,'SUPPORTS',$4,$5,0.95,'synthetic-only',10,5)`,
    [decisionId, projectId, `sha256:${'a'.repeat(64)}`, ids[0], ids[1]],
  );
  await pool.query(
    `INSERT INTO vp.relations
    (relation_id,project_id,left_assertion_id,right_assertion_id,relation_kind,relation_direction,decision_id)
    VALUES($1,$2,$3,$4,'SUPPORTS','LEFT_TO_RIGHT',$5)`,
    [randomUUID(), projectId, ids[0], ids[1], decisionId],
  );
  const snapshot = async () => ({
    receipts: (
      await pool.query('SELECT * FROM vp.decision_receipts WHERE project_id=$1', [projectId])
    ).rows.map(({ provider_call_id: _ignored, ...row }) => row),
    relations: (
      await pool.query('SELECT * FROM vp.current_relations WHERE project_id=$1', [projectId])
    ).rows,
    history: (await pool.query('SELECT * FROM vp.history_events WHERE project_id=$1', [projectId]))
      .rows,
  });
  const before = await snapshot();
  expect(before.relations).toHaveLength(1);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      await readFile('db/migrations/140_vp_isolated_negative_knowledge.sql', 'utf8'),
    );
    expect(
      (
        await client.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema='vp' AND table_name='project_epochs' AND column_name='relation_policy_revision'`)
      ).rowCount,
    ).toBe(1);
    await client.query('ROLLBACK');
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  expect(
    (
      await pool.query(`SELECT column_name FROM information_schema.columns
    WHERE table_schema='vp' AND table_name='project_epochs' AND column_name='relation_policy_revision'`)
    ).rowCount,
  ).toBe(0);
  expect(await snapshot()).toEqual(before);
  await migrateUpTo('140_vp_isolated_negative_knowledge.sql', db.databaseUrl);
  expect(await snapshot()).toEqual(before);
  expect(
    (
      await pool.query(`SELECT provider_call_id FROM vp.decision_receipts WHERE decision_id=$1`, [
        decisionId,
      ])
    ).rows,
  ).toEqual([{ provider_call_id: null }]);
  expect(
    (await pool.query(`SELECT 1 FROM vp.decision_receipts WHERE outcome='NO_RELATION'`)).rowCount,
  ).toBe(0);
});
