import type { Pool, PoolClient } from 'pg';
import type { SurferKnowledgeState } from '../../../packages/contracts/src/surfer-knowledge.js';
import type { SurferBindingStateV2 } from '../../../packages/contracts/src/surfer-source-binding-v2.js';
import {
  assertHistoryLimit,
  assertHistoryRecord,
  projectSurferHistory,
  type SurferHistoryArchivePort,
  type SurferHistoryManifest,
  type SurferHistoryPins,
  type SurferHistoryProgress,
  type SurferHistoryRecord,
} from '../../../packages/contracts/src/surfer-history.js';
import { surferDigest, surferFailure } from '../../../packages/contracts/src/surfer-learning.js';
import { withSafePostgresTransaction } from '../../../packages/postgres-transaction/src/index.js';

type Generation = {
  verified: boolean;
  manifest: SurferHistoryManifest;
  manifest_digest: string;
  cursor: number;
  total: number;
  status: SurferHistoryProgress['status'];
};
/** Trusted server capability: must check current space-wide archive-admin authority in this transaction.
 * Never supplied by an HTTP/model caller. No default authorizer, Source CURRENT authority or activation API.
 */
export type SurferHistoryAdminCapability = {
  readonly spaceId: string;
  readonly authorize: (client: PoolClient, spaceId: string) => Promise<void>;
};
export class PostgresSurferHistoryArchive implements SurferHistoryArchivePort {
  private readonly spaceId: string;
  private readonly authorize: SurferHistoryAdminCapability['authorize'];
  constructor(
    private readonly pool: Pick<Pool, 'connect'>,
    capability: SurferHistoryAdminCapability,
  ) {
    if (
      !capability.spaceId ||
      capability.spaceId.length > 256 ||
      typeof capability.authorize !== 'function'
    )
      throw surferFailure('History archive requires an explicit server admin capability.');
    this.spaceId = capability.spaceId;
    this.authorize = capability.authorize;
  }
  private async tx<T>(operation: string, action: (client: PoolClient) => Promise<T>): Promise<T> {
    return withSafePostgresTransaction(
      this.pool,
      async (client) => {
        await this.authorize(client, this.spaceId);
        return structuredClone(await action(client));
      },
      { module: 'surfer.history', operation },
    );
  }
  private async source(client: PoolClient) {
    // Same binding -> knowledge lock order as the existing Source owner. No legacy mutation.
    const b = (
      await client.query<{ revision: string; payload: SurferBindingStateV2; digest: string }>(
        'SELECT revision::text, payload, digest FROM surfer_knowledge.source_binding_v2 WHERE space_id=$1 FOR UPDATE',
        [this.spaceId],
      )
    ).rows[0];
    const k = (
      await client.query<{ revision: string; payload: SurferKnowledgeState; digest: string }>(
        'SELECT revision::text, payload, digest FROM surfer_knowledge.space_state WHERE space_id=$1 FOR UPDATE',
        [this.spaceId],
      )
    ).rows[0];
    if (
      !k ||
      !b ||
      k.payload.spaceId !== this.spaceId ||
      b.payload.spaceId !== this.spaceId ||
      Number(k.revision) !== k.payload.sequence ||
      Number(b.revision) !== b.payload.sequence ||
      surferDigest(k.payload) !== k.digest ||
      surferDigest(b.payload) !== b.digest
    )
      throw surferFailure('History legacy source identity/revision/checksum mismatch.');
    return projectSurferHistory(k.payload, b.payload);
  }
  private async generation(client: PoolClient, id: string): Promise<Generation> {
    const g = (
      await client.query<Generation>(
        'SELECT manifest,manifest_digest,cursor,total,status,verified FROM surfer_history.generation WHERE space_id=$1 AND generation_id=$2 FOR UPDATE',
        [this.spaceId, id],
      )
    ).rows[0];
    if (
      !g ||
      g.manifest.spaceId !== this.spaceId ||
      g.manifest.purpose !== 'HISTORICAL_ONLY' ||
      surferDigest(g.manifest) !== g.manifest_digest ||
      g.manifest_digest !== id ||
      g.total !== g.manifest.total
    )
      throw surferFailure('History generation identity/manifest mismatch.');
    return g;
  }
  private progress(id: string, g: Generation): SurferHistoryProgress {
    return {
      generationId: id,
      mode: 'SHADOW_ONLY',
      status: g.status,
      verified: g.verified,
      cursor: g.cursor,
      total: g.total,
      manifestDigest: g.manifest_digest,
    };
  }
  async begin(pins: SurferHistoryPins): Promise<SurferHistoryProgress> {
    // Detach caller arguments before the first await.
    const expected = surferDigest(pins);
    return this.tx('history-begin', async (client) => {
      const { manifest } = await this.source(client);
      if (surferDigest(manifest.pins) !== expected)
        throw surferFailure('History legacy source pin changed.');
      const id = surferDigest(manifest);
      await client.query(
        "INSERT INTO surfer_history.generation(space_id,generation_id,status,total,manifest,manifest_digest) VALUES($1,$2,'COPYING',$3,$4::jsonb,$2) ON CONFLICT DO NOTHING",
        [this.spaceId, id, manifest.total, JSON.stringify(manifest)],
      );
      return this.progress(id, await this.generation(client, id));
    });
  }
  async copyBatch(
    id: string,
    expectedCursor: number,
    limit: number,
  ): Promise<SurferHistoryProgress> {
    assertHistoryLimit(limit);
    if (!Number.isSafeInteger(expectedCursor) || expectedCursor < 0)
      throw surferFailure('Invalid history cursor.');
    return this.tx('history-copy', async (client) => {
      const source = await this.source(client);
      const g = await this.generation(client, id);
      if (surferDigest(source.manifest) !== g.manifest_digest)
        throw surferFailure('History legacy source changed during copy.');
      if (g.status !== 'COPYING' || g.cursor !== expectedCursor)
        throw surferFailure('History status/cursor conflict.');
      const end = Math.min(g.total, g.cursor + limit);
      for (let ordinal = g.cursor; ordinal < end; ordinal++) {
        const record = source.records[ordinal]!;
        assertHistoryRecord(record);
        await client.query(
          'INSERT INTO surfer_history.record(space_id,generation_id,ordinal,kind,record_key,payload,digest) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)',
          [
            this.spaceId,
            id,
            ordinal,
            record.kind,
            record.key,
            JSON.stringify(record),
            record.digest,
          ],
        );
      }
      const updated = await client.query(
        "UPDATE surfer_history.generation SET cursor=$3 WHERE space_id=$1 AND generation_id=$2 AND cursor=$4 AND status='COPYING'",
        [this.spaceId, id, end, expectedCursor],
      );
      if (updated.rowCount !== 1) throw surferFailure('History copy CAS conflict.');
      return this.progress(id, { ...g, cursor: end });
    });
  }
  private async records(client: PoolClient, id: string, after: number, limit: number) {
    const rows = (
      await client.query<{
        ordinal: number;
        kind: string;
        record_key: string;
        payload: SurferHistoryRecord;
        digest: string;
      }>(
        'SELECT ordinal,kind,record_key,payload,digest FROM surfer_history.record WHERE space_id=$1 AND generation_id=$2 AND ordinal >= $3 ORDER BY ordinal LIMIT $4',
        [this.spaceId, id, after, limit],
      )
    ).rows;
    return rows.map((r, i) => {
      assertHistoryRecord(r.payload);
      if (
        r.ordinal !== after + i ||
        r.payload.digest !== r.digest ||
        r.payload.kind !== r.kind ||
        r.payload.key !== r.record_key
      )
        throw surferFailure('History row identity/digest/gap mismatch.');
      return { ordinal: r.ordinal, record: r.payload };
    });
  }
  async seal(id: string): Promise<SurferHistoryProgress> {
    return this.tx('history-seal', async (client) => {
      const source = await this.source(client);
      const g = await this.generation(client, id);
      if (g.status === 'SUSPENDED' || g.cursor !== g.total || surferDigest(source.manifest) !== id)
        throw surferFailure('History cannot seal incomplete/changed/suspended generation.');
      for (let n = 0; n < g.total; n += 16) {
        const rows = await this.records(client, id, n, 16);
        if (rows.length !== Math.min(16, g.total - n))
          throw surferFailure('History copy is incomplete.');
        for (const row of rows)
          if (surferDigest(row.record) !== surferDigest(source.records[row.ordinal]))
            throw surferFailure('History row differs from source.');
      }
      const count = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM surfer_history.record WHERE space_id=$1 AND generation_id=$2',
        [this.spaceId, id],
      );
      if (Number(count.rows[0]!.count) !== g.total)
        throw surferFailure('History copy has unexpected rows.');
      await client.query(
        "UPDATE surfer_history.generation SET status='SEALED',verified=true WHERE space_id=$1 AND generation_id=$2",
        [this.spaceId, id],
      );
      return this.progress(id, { ...g, status: 'SEALED', verified: true });
    });
  }
  async suspend(id: string, expectedCursor: number): Promise<SurferHistoryProgress> {
    return this.tx('history-suspend', async (client) => {
      const g = await this.generation(client, id);
      if (g.cursor !== expectedCursor) throw surferFailure('History suspend cursor conflict.');
      await client.query(
        "UPDATE surfer_history.generation SET status='SUSPENDED' WHERE space_id=$1 AND generation_id=$2",
        [this.spaceId, id],
      );
      return this.progress(id, { ...g, status: 'SUSPENDED' });
    });
  }
  async page(id: string, after: number, limit: number) {
    assertHistoryLimit(limit);
    if (!Number.isSafeInteger(after) || after < 0)
      throw surferFailure('Invalid history page cursor.');
    return this.tx('history-page', async (client) => {
      const g = await this.generation(client, id);
      if (after > g.cursor || g.status === 'COPYING')
        throw surferFailure('History page is unavailable.');
      const records = await this.records(client, id, after, Math.min(limit, g.cursor - after));
      if (records.length !== Math.min(limit, g.cursor - after))
        throw surferFailure('History page has missing records.');
      const result = {
        purpose: 'HISTORICAL_ONLY' as const,
        status: g.status as 'SEALED' | 'SUSPENDED',
        verified: g.verified,
        copied: g.cursor,
        manifest: g.manifest,
        records,
        next: after + records.length,
      };
      surferDigest(result); // Bounded response guard is retained; callers may request a smaller page.
      return result;
    });
  }
}
