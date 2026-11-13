import type { PoolClient } from 'pg';
import {
  emptySurferKnowledgeState,
  type SurferKnowledgeState,
  type SurferKnowledgeStorePort,
} from '../../../packages/contracts/src/surfer-knowledge.js';
import { surferDigest, surferFailure } from '../../../packages/contracts/src/surfer-learning.js';
import { transactionAggregateSession } from '../../../packages/postgres-transaction/src/aggregate-session.js';
/** Exclusive Source v2 transaction owner; stateless stores and the legacy binder stay available. */
export function bindSurferKnowledgeSession(
  client: PoolClient,
  spaceId: string,
  active: () => void,
  readOnly = false,
): SurferKnowledgeStorePort {
  const transaction = transactionAggregateSession<SurferKnowledgeState>({
    active,
    digest: surferDigest,
    load: async () => {
      const initial = emptySurferKnowledgeState(spaceId);
      if (!readOnly)
        await client.query(
          'INSERT INTO surfer_knowledge.space_state (space_id,revision,payload,digest) VALUES ($1,0,$2::jsonb,$3) ON CONFLICT (space_id) DO NOTHING',
          [spaceId, JSON.stringify(initial), surferDigest(initial)],
        );
      active();
      const selected = await client.query<{
        revision: string;
        payload: SurferKnowledgeState;
        digest: string;
      }>(
        'SELECT revision::text,payload,digest FROM surfer_knowledge.space_state WHERE space_id=$1' +
          (readOnly ? '' : ' FOR UPDATE'),
        [spaceId],
      );
      active();
      const row = selected.rows[0];
      if (!row && readOnly) return { value: initial, digest: surferDigest(initial), revision: 0 };
      if (
        !row ||
        row.payload.schemaVersion !== '1.0.0' ||
        row.payload.spaceId !== spaceId ||
        Number(row.revision) !== row.payload.sequence ||
        surferDigest(row.payload) !== row.digest
      )
        throw surferFailure('Knowledge storage identity/schema/digest mismatch.');
      return { value: row.payload, digest: row.digest, revision: Number(row.revision) };
    },
    validate: (old, next, digest, previousDigest) => {
      if (
        next.spaceId !== spaceId ||
        next.schemaVersion !== '1.0.0' ||
        !Number.isSafeInteger(next.sequence) ||
        next.sequence < old.sequence ||
        next.sequence > old.sequence + 1 ||
        (next.sequence === old.sequence && digest !== previousDigest)
      )
        throw surferFailure('Knowledge transaction changed identity/schema/sequence.');
    },
    persist: async (revision, next, digest) => {
      const result = await client.query(
        'UPDATE surfer_knowledge.space_state SET revision=$2,payload=$3::jsonb,digest=$4 WHERE space_id=$1 AND revision=$5',
        [spaceId, next.sequence, JSON.stringify(next), digest, revision],
      );
      if (result.rowCount !== 1)
        throw surferFailure('Knowledge storage revision changed inside transaction.');
      return next.sequence;
    },
  });
  return {
    read: (requested, apply) => {
      active();
      if (requested !== spaceId)
        throw surferFailure('Source session cannot cross knowledge spaces.');
      return transaction.read(apply);
    },
    transaction: (requested, apply) => {
      active();
      if (readOnly) throw surferFailure('Read-only knowledge session cannot write.');
      if (requested !== spaceId)
        throw surferFailure('Source session cannot cross knowledge spaces.');
      return transaction(apply);
    },
  };
}
