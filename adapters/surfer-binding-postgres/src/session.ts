import type { PoolClient } from 'pg';
import {
  assertSurferBindingTransitionV2,
  emptySurferBindingStateV2,
  type SurferBindingStateV2,
  type SurferBindingStorePortV2,
} from '../../../packages/contracts/src/surfer-source-binding-v2.js';
import { surferDigest, surferFailure } from '../../../packages/contracts/src/surfer-learning.js';
import { transactionAggregateSession } from '../../../packages/postgres-transaction/src/aggregate-session.js';
/** One locked binding aggregate per exclusive Source transaction, with the same transition checker. */
export function bindSurferBindingSessionV2(
  client: PoolClient,
  spaceId: string,
  active: () => void,
  readOnly = false,
): SurferBindingStorePortV2 {
  const transaction = transactionAggregateSession<SurferBindingStateV2>({
    active,
    digest: surferDigest,
    load: async () => {
      const initial = emptySurferBindingStateV2(spaceId);
      if (!readOnly)
        await client.query(
          'INSERT INTO surfer_knowledge.source_binding_v2(space_id,revision,payload,digest) VALUES ($1,0,$2::jsonb,$3) ON CONFLICT DO NOTHING',
          [spaceId, JSON.stringify(initial), surferDigest(initial)],
        );
      active();
      const selected = await client.query<{
        revision: string;
        payload: SurferBindingStateV2;
        digest: string;
      }>(
        'SELECT revision::text,payload,digest FROM surfer_knowledge.source_binding_v2 WHERE space_id=$1' +
          (readOnly ? '' : ' FOR UPDATE'),
        [spaceId],
      );
      active();
      const row = selected.rows[0];
      if (!row && readOnly) return { value: initial, digest: surferDigest(initial), revision: 0 };
      if (
        !row ||
        row.payload.schemaVersion !== '2.0.0' ||
        row.payload.spaceId !== spaceId ||
        Number(row.revision) !== row.payload.sequence ||
        surferDigest(row.payload) !== row.digest
      )
        throw surferFailure('Binding storage schema/identity/digest mismatch.');
      return { value: row.payload, digest: row.digest, revision: Number(row.revision) };
    },
    validate: (old, next) => assertSurferBindingTransitionV2(old, next),
    persist: async (revision, next, digest) => {
      const result = await client.query(
        'UPDATE surfer_knowledge.source_binding_v2 SET revision=$2,payload=$3::jsonb,digest=$4 WHERE space_id=$1 AND revision=$5',
        [spaceId, next.sequence, JSON.stringify(next), digest, revision],
      );
      if (result.rowCount !== 1) throw surferFailure('Binding storage CAS conflict.');
      return next.sequence;
    },
  });
  return {
    read: (requested, apply) => {
      active();
      if (requested !== spaceId) throw surferFailure('Source binding cannot cross spaces.');
      return transaction.read(apply);
    },
    transaction: (requested, apply) => {
      active();
      if (readOnly) throw surferFailure('Read-only binding session cannot write.');
      if (requested !== spaceId) throw surferFailure('Source binding cannot cross spaces.');
      return transaction(apply);
    },
  };
}
