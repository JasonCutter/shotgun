import type { Pool } from 'pg';
import { withSafePostgresTransaction } from '../../../packages/postgres-transaction/src/index.js';
import {
  emptySurferSemanticRun,
  assertSurferSemanticRunTransition,
  type SurferSemanticRunState,
  type SurferSemanticRunStorePort,
} from '../../../packages/contracts/src/surfer-semantic-run.js';
import { surferDigest, surferFailure } from '../../../packages/contracts/src/surfer-learning.js';
export class PostgresSurferSemanticRunStore implements SurferSemanticRunStorePort {
  constructor(private readonly pool: Pick<Pool, 'connect'>) {}
  transaction<T>(runId: string, apply: (s: SurferSemanticRunState) => T): Promise<T> {
    if (!runId || runId.length > 256) throw surferFailure('Invalid semantic run id.');
    return withSafePostgresTransaction(
      this.pool,
      async (c) => {
        const initial = emptySurferSemanticRun(runId);
        await c.query(
          'INSERT INTO surfer_execution.semantic_runs(run_id,revision,approval_key,payload,digest) VALUES($1,0,NULL,$2::jsonb,$3) ON CONFLICT DO NOTHING',
          [runId, JSON.stringify(initial), surferDigest(initial)],
        );
        const q = await c.query<{
            revision: string;
            approval_key: string | null;
            payload: SurferSemanticRunState;
            digest: string;
          }>(
            'SELECT revision::text,approval_key,payload,digest FROM surfer_execution.semantic_runs WHERE run_id=$1 FOR UPDATE',
            [runId],
          ),
          row = q.rows[0];
        if (
          !row ||
          row.payload.runId !== runId ||
          row.payload.sequence !== Number(row.revision) ||
          surferDigest(row.payload) !== row.digest ||
          row.approval_key !==
            (row.payload.approvalRef ? surferDigest(row.payload.approvalRef) : null)
        )
          throw surferFailure('Semantic run checksum/identity mismatch.');
        const draft = structuredClone(row.payload),
          value = structuredClone(apply(draft));
        assertSurferSemanticRunTransition(row.payload, draft);
        if (surferDigest(draft) !== row.digest) {
          const update = await c.query(
            'UPDATE surfer_execution.semantic_runs SET revision=$2,approval_key=$3,payload=$4::jsonb,digest=$5 WHERE run_id=$1 AND revision=$6',
            [
              runId,
              draft.sequence,
              draft.approvalRef ? surferDigest(draft.approvalRef) : null,
              JSON.stringify(draft),
              surferDigest(draft),
              row.revision,
            ],
          );
          if (update.rowCount !== 1) throw surferFailure('Semantic run CAS changed.');
        }
        return value;
      },
      { module: 'surfer.execution', operation: 'semantic-run' },
    );
  }
}
