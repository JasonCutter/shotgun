import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { ShotgunError } from '../../packages/contracts/src/index.js';
import { withSafePostgresTransaction } from '../../packages/postgres-transaction/src/index.js';

const fakePool = (commitError?: Error) => {
  const commands: string[] = [];
  const client = {
    query: vi.fn(async (query: string) => {
      const command = query.trim().toUpperCase();
      commands.push(command);
      if (command === 'COMMIT' && commitError) throw commitError;
      return { rows: [], rowCount: 1 };
    }),
    release: vi.fn(),
  };
  return {
    pool: { connect: vi.fn(async () => client) } as unknown as Pick<Pool, 'connect'>,
    client,
    commands,
  };
};

describe('TS-6 transaction outcome contract', () => {
  it('rolls back deterministic failures before COMMIT', async () => {
    const fake = fakePool();
    await expect(
      withSafePostgresTransaction(
        fake.pool,
        async () => {
          throw new ShotgunError({
            code: 'CONFLICT',
            safeMessage: 'deterministic conflict',
            module: 'ts6-test',
            operation: 'before-commit',
          });
        },
        { module: 'ts6-test', operation: 'before-commit' },
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(fake.commands).toEqual(['BEGIN', 'ROLLBACK']);
  });

  it('never rolls back after COMMIT acknowledgement loss', async () => {
    const fake = fakePool(new Error('synthetic acknowledgement loss'));
    await expect(
      withSafePostgresTransaction(fake.pool, async () => 'committed', {
        module: 'ts6-test',
        operation: 'after-commit',
      }),
    ).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    expect(fake.commands).toEqual(['BEGIN', 'COMMIT']);
    expect(fake.commands).not.toContain('ROLLBACK');
  });

  it('runs post-commit callbacks only after an acknowledged commit', async () => {
    const fake = fakePool();
    const callback = vi.fn();
    await expect(
      withSafePostgresTransaction(
        fake.pool,
        async (_client, afterCommit) => {
          afterCommit(callback);
          return 'ok';
        },
        { module: 'ts6-test', operation: 'after-commit-callback' },
      ),
    ).resolves.toBe('ok');
    expect(callback).toHaveBeenCalledOnce();
    expect(fake.commands).toEqual(['BEGIN', 'COMMIT']);
  });
});
