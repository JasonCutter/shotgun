import type { Pool } from 'pg';
import {
  emptySurferExecutionState,
  assertSurferExecutionTransition,
  type SurferExecutionState,
  type SurferExecutionStorePort,
} from '../../../packages/contracts/src/surfer-execution.js';
import { surferDigest, surferFailure } from '../../../packages/contracts/src/surfer-learning.js';
import { withSafePostgresTransaction } from '../../../packages/postgres-transaction/src/index.js';

/** One frozen allowance root across all runs/spaces; never keyed by client job ID. */
export class PostgresSurferExecutionStore implements SurferExecutionStorePort {
  constructor(private readonly pool: Pick<Pool, 'connect'>) {}
  transaction<T>(budgetId: string, apply: (state: SurferExecutionState) => T): Promise<T> {
    if (!budgetId || budgetId.length > 256) throw surferFailure('Invalid budget identity.');
    return withSafePostgresTransaction(
      this.pool,
      async (client) => {
        const initial = emptySurferExecutionState(budgetId);
        await client.query(
          'INSERT INTO surfer_execution.budget_state (budget_id, revision, payload, digest) VALUES ($1, 0, $2::jsonb, $3) ON CONFLICT DO NOTHING',
          [budgetId, JSON.stringify(initial), surferDigest(initial)],
        );
        const result = await client.query<{
          revision: string;
          payload: SurferExecutionState;
          digest: string;
        }>(
          'SELECT revision::text, payload, digest FROM surfer_execution.budget_state WHERE budget_id=$1 FOR UPDATE',
          [budgetId],
        );
        const row = result.rows[0];
        if (
          !row ||
          row.payload.schemaVersion !== '1.0.0' ||
          row.payload.budgetId !== budgetId ||
          row.payload.sequence !== Number(row.revision) ||
          surferDigest(row.payload) !== row.digest
        )
          throw surferFailure('Execution storage identity/schema/digest mismatch.');
        const draft = structuredClone(row.payload),
          value = structuredClone(apply(draft));
        assertSurferExecutionTransition(row.payload, draft);
        if (surferDigest(draft) !== row.digest) {
          const update = await client.query(
            'UPDATE surfer_execution.budget_state SET revision=$2, payload=$3::jsonb, digest=$4 WHERE budget_id=$1 AND revision=$5',
            [budgetId, draft.sequence, JSON.stringify(draft), surferDigest(draft), row.revision],
          );
          if (update.rowCount !== 1) throw surferFailure('Execution storage revision changed.');
        }
        return value;
      },
      { module: 'surfer.execution', operation: 'budget-transaction' },
    );
  }
}
