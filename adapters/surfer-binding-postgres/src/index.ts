import type { Pool, PoolClient } from 'pg';
import {
  assertSurferBindingTransitionV2,
  emptySurferBindingStateV2,
  type SurferBindingStateV2,
  type SurferBindingStorePortV2,
} from '../../../packages/contracts/src/surfer-source-binding-v2.js';
import { surferDigest, surferFailure } from '../../../packages/contracts/src/surfer-learning.js';
import { withSafePostgresTransaction } from '../../../packages/postgres-transaction/src/index.js';

async function transact<T>(
  client: PoolClient,
  spaceId: string,
  apply: (state: SurferBindingStateV2) => T,
  active = () => {},
): Promise<T> {
  active();
  if (!spaceId || spaceId.length > 256) throw surferFailure('Invalid binding space.');
  const initial = emptySurferBindingStateV2(spaceId);
  await client.query(
    'INSERT INTO surfer_knowledge.source_binding_v2(space_id,revision,payload,digest) VALUES ($1,0,$2::jsonb,$3) ON CONFLICT DO NOTHING',
    [spaceId, JSON.stringify(initial), surferDigest(initial)],
  );
  const selected = await client.query<{
    revision: string;
    payload: SurferBindingStateV2;
    digest: string;
  }>(
    'SELECT revision::text,payload,digest FROM surfer_knowledge.source_binding_v2 WHERE space_id=$1 FOR UPDATE',
    [spaceId],
  );
  active();
  const row = selected.rows[0];
  if (
    !row ||
    row.payload.schemaVersion !== '2.0.0' ||
    row.payload.spaceId !== spaceId ||
    row.payload.sequence !== Number(row.revision) ||
    surferDigest(row.payload) !== row.digest
  )
    throw surferFailure('Binding storage schema/identity/digest mismatch.');
  const next = structuredClone(row.payload),
    result = structuredClone(apply(next));
  assertSurferBindingTransitionV2(row.payload, next);
  const hash = surferDigest(next);
  if (hash !== row.digest) {
    const update = await client.query(
      'UPDATE surfer_knowledge.source_binding_v2 SET revision=$2,payload=$3::jsonb,digest=$4 WHERE space_id=$1 AND revision=$5',
      [spaceId, next.sequence, JSON.stringify(next), hash, row.revision],
    );
    if (update.rowCount !== 1) throw surferFailure('Binding storage CAS conflict.');
  }
  active();
  return result;
}
export class PostgresSurferBindingStoreV2 implements SurferBindingStorePortV2 {
  constructor(private readonly pool: Pick<Pool, 'connect'>) {}
  transaction<T>(spaceId: string, apply: (state: SurferBindingStateV2) => T): Promise<T> {
    return withSafePostgresTransaction(this.pool, (c) => transact(c, spaceId, apply), {
      module: 'surfer.binding.v2',
      operation: 'transaction',
    });
  }
}
export function bindSurferBindingStoreV2(
  client: PoolClient,
  spaceId: string,
  active: () => void,
): SurferBindingStorePortV2 {
  return {
    transaction: async <T>(
      requested: string,
      apply: (state: SurferBindingStateV2) => T,
    ): Promise<T> => {
      active();
      if (requested !== spaceId) throw surferFailure('Source binding cannot cross spaces.');
      return transact(client, spaceId, apply, active);
    },
  };
}
