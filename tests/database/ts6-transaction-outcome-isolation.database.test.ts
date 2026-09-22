import { describe, expect, it } from 'vitest';

import { withSafePostgresTransaction } from '../../packages/postgres-transaction/src/index.js';
import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';
import { createPostCommitAckLossPool } from '../helpers/postgres-commit-ack-loss.js';

const databaseConfigured = Boolean(process.env.TEST_DATABASE_URL?.trim());

describe.skipIf(!databaseConfigured)('TS-6 isolated transaction outcome proof', () => {
  it('retains a committed row and leaves no post-COMMIT rollback path', async () => {
    const isolated = await createIsolatedPostgresTestDatabase({ migrate: async () => undefined });
    const pool = isolated.createPool();
    try {
      await pool.query(`CREATE TABLE ts6_commit_ack_loss_probe (id integer PRIMARY KEY)`);
      const injected = createPostCommitAckLossPool(pool);

      await expect(
        withSafePostgresTransaction(
          injected.pool,
          async (client) => {
            await client.query(`INSERT INTO ts6_commit_ack_loss_probe (id) VALUES (1)`);
          },
          { module: 'ts6-test', operation: 'isolated-commit-ack-loss' },
        ),
      ).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });

      const readback = await pool.query<{ id: number }>(
        `SELECT id FROM ts6_commit_ack_loss_probe WHERE id = 1`,
      );
      expect(readback.rows).toEqual([{ id: 1 }]);
      expect(injected.trace.commitAttempts).toBe(1);
      expect(injected.trace.rollbackAttempts).toBe(0);
      expect(injected.trace.acknowledgementLost).toBe(true);
      expect(injected.trace.rollbackAfterCommit).toBe(0);
    } finally {
      await isolated.dispose();
    }
  }, 60000);
});
