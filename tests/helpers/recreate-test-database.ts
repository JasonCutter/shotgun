import { dropSchemas, migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

/** Recreate only the explicitly configured disposable test database schemas. */
export const recreateTestDatabaseSchemas = async (databaseUrl: string): Promise<void> => {
  const testDatabaseUrl = await requireTestDatabaseTarget({
    environment: { ...process.env, TEST_DATABASE_URL: databaseUrl },
  });
  await dropSchemas(testDatabaseUrl);
  await migrateUpTo(undefined, testDatabaseUrl);
};
