import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgresGlobalRelationBudget } from '../../adapters/vp-global-provider-budget-postgres/src/index.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = process.env.VP_TEST_AUTHORITY_DATABASE_URL;
const [storeId, authorityId, accountFingerprint, requestedCount] = process.argv.slice(2);
if (!databaseUrl || !storeId || !authorityId || !accountFingerprint || !requestedCount)
  process.exit(2);
await requireTestDatabaseTarget({
  environment: { TEST_DATABASE_URL: databaseUrl, DATABASE_URL: process.env.DATABASE_URL },
});
const pool = new pg.Pool({ connectionString: databaseUrl });
try {
  const budget = new PostgresGlobalRelationBudget(pool, {
    storeId,
    authorityId,
    provider: 'deepseek',
    accountFingerprint,
    dailyLimit: 10,
  });
  let claimed = 0;
  for (let index = 0; index < Number(requestedCount); index++) {
    try {
      await budget.claim(`process:${process.pid}:${randomUUID()}`);
      claimed++;
    } catch {
      break;
    }
  }
  process.stdout.write(JSON.stringify({ claimed }));
} finally {
  await pool.end();
}
