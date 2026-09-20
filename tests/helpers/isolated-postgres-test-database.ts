import type { Pool } from 'pg';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import {
  createIsolatedPostgresDatabase,
  dropIsolatedPostgresDatabase,
} from '../../scripts/isolated-postgres-database.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

export type IsolatedPostgresTestDatabase = {
  readonly databaseName: string;
  readonly databaseUrl: string;
  readonly createPool: () => Pool;
  readonly dispose: () => Promise<void>;
};

export type CreateIsolatedPostgresTestDatabaseOptions = {
  readonly migrate?: (databaseUrl: string) => Promise<void>;
};

const asError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(String(value));

const aggregate = (message: string, errors: readonly unknown[]): Error =>
  errors.length === 1 ? asError(errors[0]) : new AggregateError(errors.map(asError), message);

export const createIsolatedPostgresTestDatabase = async (
  options: CreateIsolatedPostgresTestDatabaseOptions = {},
): Promise<IsolatedPostgresTestDatabase> => {
  const parentDatabaseUrl = await requireTestDatabaseTarget();
  const isolated = await createIsolatedPostgresDatabase(parentDatabaseUrl, 'test');
  const pools: Pool[] = [];
  let disposePromise: Promise<void> | undefined;

  const dispose = (): Promise<void> => {
    if (!disposePromise) {
      disposePromise = (async () => {
        const closeResults = await Promise.allSettled(pools.map((pool) => pool.end()));
        const closeErrors = closeResults
          .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
          .map((result) => result.reason);
        let dropError: unknown;
        try {
          await dropIsolatedPostgresDatabase(parentDatabaseUrl, 'test', isolated.databaseName);
        } catch (error) {
          dropError = error;
        }
        const errors = dropError === undefined ? closeErrors : [...closeErrors, dropError];
        if (errors.length > 0) {
          throw aggregate(
            'Failed to dispose isolated database ' + isolated.databaseName + '.',
            errors,
          );
        }
      })();
    }
    return disposePromise;
  };

  try {
    await (options.migrate ?? ((databaseUrl) => migrateUpTo(undefined, databaseUrl)))(
      isolated.databaseUrl,
    );
  } catch (error) {
    try {
      await dispose();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Isolated database setup failed and cleanup also failed for ' + isolated.databaseName + '.',
      );
    }
    throw error;
  }

  return {
    databaseName: isolated.databaseName,
    databaseUrl: isolated.databaseUrl,
    createPool: () => {
      if (disposePromise) {
        throw new Error('Cannot create a pool after isolated database disposal started.');
      }
      const pool = createPostgresPool(isolated.databaseUrl);
      pools.push(pool);
      return pool;
    },
    dispose,
  };
};
