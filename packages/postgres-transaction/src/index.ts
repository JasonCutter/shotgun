import type { Pool, PoolClient } from 'pg';

import { ShotgunError } from '../../contracts/src/index.js';

export type PostgresTransactionState =
  | 'BEFORE_COMMIT'
  | 'COMMIT_ATTEMPTED'
  | 'COMMITTED'
  | 'ROLLBACK_ATTEMPTED'
  | 'ROLLED_BACK'
  | 'OUTCOME_UNKNOWN';

export type SafePostgresTransactionOptions = {
  readonly module: string;
  readonly operation: string;
};

const outcomeUnknown = (
  options: SafePostgresTransactionOptions,
  message: string,
  cause: unknown,
): ShotgunError =>
  new ShotgunError({
    code: 'OUTCOME_UNKNOWN',
    safeMessage: message,
    module: options.module,
    operation: options.operation,
    cause,
  });

/**
 * Runs a PostgreSQL unit of work without attempting rollback after COMMIT was
 * issued.  Commit/rollback acknowledgement loss is deliberately surfaced as
 * OUTCOME_UNKNOWN so callers resolve the durable ledger/resource outcome.
 */
export async function withSafePostgresTransaction<T>(
  pool: Pick<Pool, 'connect'>,
  action: (
    client: PoolClient,
    afterCommit: (callback: () => void) => void,
  ) => Promise<T>,
  options: SafePostgresTransactionOptions,
): Promise<T> {
  const client = await pool.connect();
  const afterCommit: (() => void)[] = [];
  let state: PostgresTransactionState = 'BEFORE_COMMIT';
  let result: T;
  try {
    await client.query('BEGIN');
    result = await action(client, (callback) => afterCommit.push(callback));
    state = 'COMMIT_ATTEMPTED';
    try {
      await client.query('COMMIT');
      state = 'COMMITTED';
    } catch (error) {
      state = 'OUTCOME_UNKNOWN';
      throw outcomeUnknown(
        options,
        'The PostgreSQL transaction outcome could not be resolved after COMMIT was attempted.',
        error,
      );
    }
  } catch (error) {
    if (state === 'BEFORE_COMMIT') {
      state = 'ROLLBACK_ATTEMPTED';
      try {
        await client.query('ROLLBACK');
        state = 'ROLLED_BACK';
      } catch (rollbackError) {
        state = 'OUTCOME_UNKNOWN';
        throw outcomeUnknown(
          options,
          'The PostgreSQL transaction rollback outcome could not be resolved.',
          rollbackError,
        );
      }
    }
    throw error;
  } finally {
    client.release();
  }

  for (const callback of afterCommit) {
    try {
      callback();
    } catch (error) {
      console.error('[postgres-transaction] post-commit callback failed', error);
    }
  }
  return result!;
}
