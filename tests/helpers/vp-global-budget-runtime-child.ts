import { randomUUID } from 'node:crypto';
import { globalRelationBudgetFromEnvironment } from '../../adapters/vp-global-provider-budget-postgres/src/config.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const [workloadUrl, fingerprint] = process.argv.slice(2);
if (!workloadUrl || !fingerprint) process.exit(2);
await requireTestDatabaseTarget({
  environment: { TEST_DATABASE_URL: workloadUrl, DATABASE_URL: process.env.DATABASE_URL },
});
await requireTestDatabaseTarget({
  environment: {
    TEST_DATABASE_URL: process.env.VP_GLOBAL_RELATION_BUDGET_DATABASE_URL,
    DATABASE_URL: process.env.DATABASE_URL,
  },
});

const runtime = globalRelationBudgetFromEnvironment(workloadUrl, fingerprint);
try {
  const before = await runtime.budget.status();
  const claim = await runtime.budget.claim(`runtime-child:${process.pid}:${randomUUID()}`);
  const after = await runtime.budget.status();
  process.stdout.write(JSON.stringify({ before, after, claim }));
} finally {
  await runtime.close();
}
