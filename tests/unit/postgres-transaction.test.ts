import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withSafePostgresTransaction } from '../../packages/postgres-transaction/src/index.js';

describe('withSafePostgresTransaction', () => {
  let query: ReturnType<typeof vi.fn>;
  let client: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
  let pool: { connect: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    query = vi.fn(async () => ({ rowCount: 1, rows: [] }));
    client = { query, release: vi.fn() };
    pool = { connect: vi.fn(async () => client) };
  });

  it('does not roll back after COMMIT acknowledgement loss', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql === 'COMMIT') throw new Error('commit response lost');
      return { rowCount: 1, rows: [] };
    });

    await expect(
      withSafePostgresTransaction(pool, async () => 'committed-or-unknown', {
        module: 'test',
        operation: 'commit-ack',
      }),
    ).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    expect(query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'COMMIT']);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('reports OUTCOME_UNKNOWN when rollback acknowledgement is lost', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql === 'ROLLBACK') throw new Error('rollback response lost');
      return { rowCount: 1, rows: [] };
    });

    await expect(
      withSafePostgresTransaction(
        pool,
        async () => {
          throw new Error('mutation failed');
        },
        { module: 'test', operation: 'rollback-ack' },
      ),
    ).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    expect(query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'ROLLBACK']);
  });

  it('runs callbacks after a committed transaction and isolates callback failures', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let callbackRan = false;
    await expect(
      withSafePostgresTransaction(
        pool,
        async (_client, afterCommit) => {
          afterCommit(() => {
            callbackRan = true;
            throw new Error('wake-up failed');
          });
          return 'committed';
        },
        { module: 'test', operation: 'post-commit' },
      ),
    ).resolves.toBe('committed');
    expect(callbackRan).toBe(true);
    expect(errorSpy).toHaveBeenCalledOnce();
    errorSpy.mockRestore();
  });
});
