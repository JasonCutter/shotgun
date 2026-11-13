import type { Pool, PoolClient } from 'pg';
import {
  emptySurferKnowledgeState,
  type SurferKnowledgeState,
  type SurferKnowledgeStorePort,
} from '../../../packages/contracts/src/surfer-knowledge.js';
import { surferDigest, surferFailure } from '../../../packages/contracts/src/surfer-learning.js';
import { withSafePostgresTransaction } from '../../../packages/postgres-transaction/src/index.js';

/** First vertical slice: a serialized, bounded JSONB aggregate per knowledge space. */
export class PostgresSurferKnowledgeStore implements SurferKnowledgeStorePort {
  constructor(private readonly pool: Pick<Pool, 'connect'>) {}

  async transaction<T>(spaceId: string, apply: (state: SurferKnowledgeState) => T): Promise<T> {
    return withSafePostgresTransaction(
      this.pool,
      async (client) => {
        return transactSurferKnowledge(client, spaceId, apply);
      },
      { module: 'surfer.core', operation: 'knowledge-transaction' },
    );
  }
}

/** Bind to a caller-owned transaction; this function never issues BEGIN/COMMIT. */
export function bindSurferKnowledgeStore(
  client: PoolClient,
  authorizedSpaceId: string,
  assertActive: () => void,
): SurferKnowledgeStorePort {
  return {
    transaction: async <T>(
      spaceId: string,
      apply: (state: SurferKnowledgeState) => T,
    ): Promise<T> => {
      assertActive();
      if (spaceId !== authorizedSpaceId)
        throw surferFailure('Source session cannot cross knowledge spaces.');
      return transactSurferKnowledge(client, spaceId, apply, assertActive);
    },
  };
}
async function transactSurferKnowledge<T>(
  client: PoolClient,
  spaceId: string,
  apply: (state: SurferKnowledgeState) => T,
  assertActive?: () => void,
): Promise<T> {
  const initial = emptySurferKnowledgeState(spaceId);
  await client.query(
    'INSERT INTO surfer_knowledge.space_state (space_id, revision, payload, digest) VALUES ($1, 0, $2::jsonb, $3) ON CONFLICT (space_id) DO NOTHING',
    [spaceId, JSON.stringify(initial), surferDigest(initial)],
  );
  assertActive?.();
  const selected = await client.query<{
    revision: string;
    payload: SurferKnowledgeState;
    digest: string;
  }>(
    'SELECT revision::text, payload, digest FROM surfer_knowledge.space_state WHERE space_id = $1 FOR UPDATE',
    [spaceId],
  );
  const row = selected.rows[0];
  assertActive?.();
  if (
    !row ||
    row.payload.schemaVersion !== '1.0.0' ||
    row.payload.spaceId !== spaceId ||
    Number(row.revision) !== row.payload.sequence ||
    surferDigest(row.payload) !== row.digest
  )
    throw surferFailure('Knowledge storage identity/schema/digest mismatch.');
  const originalSequence = row.payload.sequence;
  const draft = structuredClone(row.payload);
  const result = structuredClone(apply(draft));
  const digest = surferDigest(draft);
  if (
    draft.spaceId !== spaceId ||
    draft.schemaVersion !== '1.0.0' ||
    !Number.isSafeInteger(draft.sequence) ||
    draft.sequence < originalSequence ||
    draft.sequence > originalSequence + 1 ||
    (draft.sequence === originalSequence && digest !== row.digest)
  )
    throw surferFailure('Knowledge transaction changed identity/schema/sequence.');
  if (digest !== row.digest) {
    const updated = await client.query(
      'UPDATE surfer_knowledge.space_state SET revision = $2, payload = $3::jsonb, digest = $4 WHERE space_id = $1 AND revision = $5',
      [spaceId, draft.sequence, JSON.stringify(draft), digest, originalSequence],
    );
    if (updated.rowCount !== 1)
      throw surferFailure('Knowledge storage revision changed inside transaction.');
  }
  assertActive?.();
  return result;
}
