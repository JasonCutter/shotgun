import pg from 'pg';
import {
  PostgresGlobalRelationBudget,
  type GlobalRelationBudgetIdentity,
  type GlobalRelationBudgetPort,
} from '../../adapters/vp-global-provider-budget-postgres/src/index.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const { identity, input } = JSON.parse(process.argv[2] ?? '{}') as {
  identity: GlobalRelationBudgetIdentity;
  input: Parameters<NonNullable<GlobalRelationBudgetPort['authorizeExecution']>>[0];
};
const pool = new pg.Pool({ connectionString: databaseUrl });
try {
  const budget = new PostgresGlobalRelationBudget(pool, identity);
  try {
    await budget.authorizeExecution(input);
    process.stdout.write(JSON.stringify({ authorized: true }));
  } catch {
    process.stdout.write(JSON.stringify({ authorized: false }));
  }
} finally {
  await pool.end();
}
