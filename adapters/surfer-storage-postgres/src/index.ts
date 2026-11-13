import type { Pool, PoolClient } from 'pg';
import {
  assertHistoryLimit,
  assertHistoryRecord,
  projectSurferHistory,
  type SurferHistoryPins,
  type SurferHistoryRecord,
} from '../../../packages/contracts/src/surfer-history.js';
import type { SurferKnowledgeState } from '../../../packages/contracts/src/surfer-knowledge.js';
import type { SurferBindingStateV2 } from '../../../packages/contracts/src/surfer-source-binding-v2.js';
import type {
  SurferCutoverProgress,
  SurferStorageCutoverPort,
} from '../../../packages/contracts/src/surfer-storage-cutover.js';
import { surferDigest, surferFailure } from '../../../packages/contracts/src/surfer-learning.js';
import { withSafePostgresTransaction } from '../../../packages/postgres-transaction/src/index.js';
import type { SurferHistoryAdminCapability } from '../../surfer-history-postgres/src/index.js';

type Projection = ReturnType<typeof projectSurferHistory>;
type Manifest = {
  contract: 'surfer.storage-cutover.v1';
  source: Projection['manifest'];
  archiveGeneration: string | null;
  activeSelection: 'V2_BINDING_ACTIVE';
};
type Migration = {
  status: SurferCutoverProgress['status'];
  cursor: number;
  total: number;
  manifest: Manifest;
  digest: string;
};
type Route = { mode: string; generation_id: string | null; revision: string };
type Target = { kind: string; id: string; revision: number; payload: unknown; digest: string };
type Stage = {
  ordinal: number;
  archive_record: SurferHistoryRecord;
  archive_digest: string;
  target_kind: string;
  target_id: string;
  target_revision: string;
  target_payload: unknown;
  target_digest: string;
};
/** Explicit admin owner. Legacy data/stage remain intact; no down-conversion or operating assembly changes. */
export class PostgresSurferStorageCutover implements SurferStorageCutoverPort {
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
      throw surferFailure('Storage cutover requires a server admin capability.');
    this.spaceId = capability.spaceId;
    this.authorize = capability.authorize;
  }
  private tx<T>(operation: string, action: (client: PoolClient) => Promise<T>) {
    return withSafePostgresTransaction(
      this.pool,
      async (c) => {
        await this.authorize(c, this.spaceId);
        await c.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('surfer-storage-cutover-v1',0))",
        );
        const result = await action(c);
        surferDigest(result);
        return structuredClone(result);
      },
      { module: 'surfer.storage', operation },
    );
  }
  private async route(c: PoolClient, lock = true): Promise<Route> {
    if (lock)
      await c.query(
        "INSERT INTO surfer_rows.route(space_id,mode) VALUES($1,'LEGACY') ON CONFLICT DO NOTHING",
        [this.spaceId],
      );
    return (
      await c.query<Route>(
        `SELECT mode,generation_id,revision::text FROM surfer_rows.route WHERE space_id=$1${lock ? ' FOR UPDATE' : ''}`,
        [this.spaceId],
      )
    ).rows[0]!;
  }
  private async source(c: PoolClient): Promise<Projection> {
    const k = (
      await c.query<{ revision: string; payload: SurferKnowledgeState; digest: string }>(
        'SELECT revision::text,payload,digest FROM surfer_knowledge.space_state WHERE space_id=$1',
        [this.spaceId],
      )
    ).rows[0];
    const b = (
      await c.query<{ revision: string; payload: SurferBindingStateV2; digest: string }>(
        'SELECT revision::text,payload,digest FROM surfer_knowledge.source_binding_v2 WHERE space_id=$1',
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
      throw surferFailure('Cutover source identity/revision/checksum mismatch.');
    const p = projectSurferHistory(k.payload, b.payload);
    if (
      b.payload.activeSnapshotId !== null &&
      !k.payload.snapshots.some((s) => s.snapshotId === b.payload.activeSnapshotId)
    )
      throw surferFailure('V2 active snapshot is missing.');
    const keys = new Set<string>();
    for (const r of p.records) {
      const t = this.target(r),
        key = JSON.stringify([t.kind, t.id, t.revision]);
      if (keys.has(key)) throw surferFailure('Cutover target identity collision.');
      keys.add(key);
    }
    return p;
  }
  private target(r: SurferHistoryRecord): Target {
    assertHistoryRecord(r);
    // Values were projected from the checked typed legacy envelopes, not supplied by an external command.
    const x = r.value as Record<string, unknown>;
    let kind: string = r.kind,
      id: string,
      revision: number,
      payload: unknown = x;
    switch (r.kind) {
      case 'INPUT':
        id = String(x.inputId);
        revision = Number(x.revision);
        break;
      case 'ARTIFACT':
        id = String(x.artifactId);
        revision = Number(x.revision);
        break;
      case 'EPOCH':
        id = surferDigest({ domain: x.domain, predicate: x.predicate });
        revision = Number(x.epoch);
        break;
      case 'SNAPSHOT':
        id = String(x.snapshotId);
        revision = 1;
        break;
      case 'COMMAND':
        id = String(x.operationId);
        revision = Number((x.commit as { sequence: number }).sequence);
        if ((x.commit as { operationId: string }).operationId !== id)
          throw surferFailure('Cutover command receipt identity mismatch.');
        break;
      case 'CAPTURE': {
        const b = x.basis as { contentDigest: string };
        id = b.contentDigest;
        revision = 1;
        payload = b;
        break;
      }
      case 'BINDING': {
        const a = x.artifact as { artifactId: string; revision: number };
        id = a.artifactId;
        revision = a.revision;
        break;
      }
      case 'WATERMARK':
        kind = 'ARCHIVE_ONLY';
        id = r.key;
        revision = 1;
        break;
    }
    if (
      !id ||
      id === 'undefined' ||
      id.length > 256 ||
      !Number.isSafeInteger(revision) ||
      revision < 1
    )
      throw surferFailure('Cutover target identity/revision invalid.');
    return { kind, id, revision, payload, digest: surferDigest(payload) };
  }
  private async migration(c: PoolClient, id: string, lock = true): Promise<Migration> {
    const m = (
      await c.query<Migration>(
        `SELECT status,cursor,total,manifest,digest FROM surfer_rows.migration WHERE space_id=$1 AND generation_id=$2${lock ? ' FOR UPDATE' : ''}`,
        [this.spaceId, id],
      )
    ).rows[0];
    if (
      !m ||
      m.digest !== id ||
      surferDigest(m.manifest) !== id ||
      m.manifest.contract !== 'surfer.storage-cutover.v1' ||
      m.manifest.source.spaceId !== this.spaceId ||
      m.total !== m.manifest.source.total
    )
      throw surferFailure('Cutover manifest identity/digest mismatch.');
    return m;
  }
  private progress(id: string, m: Migration, r: Route): SurferCutoverProgress {
    return {
      generationId: id,
      status: m.status,
      cursor: m.cursor,
      total: m.total,
      routeRevision: Number(r.revision),
      routeMode: r.mode as SurferCutoverProgress['routeMode'],
      routeGenerationId: r.generation_id,
    };
  }
  inspect(id: string) {
    return withSafePostgresTransaction(
      this.pool,
      async (c) => {
        await this.authorize(c, this.spaceId);
        const r = await this.route(c, false);
        if (!r) throw surferFailure('Cutover route is missing.');
        return this.progress(id, await this.migration(c, id, false), r);
      },
      {
        module: 'surfer.storage',
        operation: 'cutover-inspect',
        isolationLevel: 'REPEATABLE READ',
        readOnly: true,
      },
    );
  }
  private assertCopy(m: Migration, r: Route, id: string) {
    if (!['COPYING', 'READY'].includes(m.status) || r.mode !== 'COPYING' || r.generation_id !== id)
      throw surferFailure('Cutover status/route conflict.');
  }
  private async current(c: PoolClient, m: Migration) {
    const p = await this.source(c);
    if (surferDigest(p.manifest) !== surferDigest(m.manifest.source))
      throw surferFailure('Cutover source pin changed.');
    return p;
  }
  private async noDestination(c: PoolClient) {
    if (
      (await c.query('SELECT 1 FROM surfer_rows.space WHERE space_id=$1', [this.spaceId])).rowCount
    )
      throw surferFailure(
        'Destination row data already exists; explicit conflict resolution is required.',
      );
  }
  async begin(pins: SurferHistoryPins, archiveGeneration?: string) {
    const expected = surferDigest(pins);
    return this.tx('cutover-begin', async (c) => {
      const route = await this.route(c);
      if (!['LEGACY', 'COPYING'].includes(route.mode))
        throw surferFailure('Cutover requires an unmixed legacy route.');
      await this.noDestination(c);
      const p = await this.source(c);
      if (surferDigest(p.manifest.pins) !== expected)
        throw surferFailure('Cutover source pin changed.');
      if (archiveGeneration) {
        const a = (
          await c.query<{
            status: string;
            verified: boolean;
            cursor: number;
            total: number;
            manifest: unknown;
            manifest_digest: string;
          }>(
            'SELECT status,verified,cursor,total,manifest,manifest_digest FROM surfer_history.generation WHERE space_id=$1 AND generation_id=$2',
            [this.spaceId, archiveGeneration],
          )
        ).rows[0];
        if (
          !a ||
          !a.verified ||
          a.cursor !== a.total ||
          !['SEALED', 'SUSPENDED'].includes(a.status) ||
          a.manifest_digest !== surferDigest(a.manifest) ||
          surferDigest(a.manifest) !== surferDigest(p.manifest)
        )
          throw surferFailure('Sealed archive does not match the current source.');
      }
      const manifest: Manifest = {
          contract: 'surfer.storage-cutover.v1',
          source: p.manifest,
          archiveGeneration: archiveGeneration ?? null,
          activeSelection: 'V2_BINDING_ACTIVE',
        },
        id = surferDigest(manifest);
      if (route.mode === 'COPYING' && route.generation_id !== id)
        throw surferFailure('A different cutover generation is already frozen.');
      await c.query(
        "INSERT INTO surfer_rows.migration(space_id,generation_id,status,total,manifest,digest) VALUES($1,$2,'COPYING',$3,$4::jsonb,$2) ON CONFLICT DO NOTHING",
        [this.spaceId, id, p.records.length, JSON.stringify(manifest)],
      );
      let m = await this.migration(c, id);
      if (m.status === 'ABORTED') {
        await c.query(
          "UPDATE surfer_rows.migration SET status='COPYING' WHERE space_id=$1 AND generation_id=$2",
          [this.spaceId, id],
        );
        m = { ...m, status: 'COPYING' };
      }
      if (route.mode === 'LEGACY') {
        await c.query(
          "UPDATE surfer_rows.route SET mode='COPYING',generation_id=$2,revision=revision+1 WHERE space_id=$1",
          [this.spaceId, id],
        );
        route.mode = 'COPYING';
        route.generation_id = id;
        route.revision = String(Number(route.revision) + 1);
      }
      this.assertCopy(m, route, id);
      return this.progress(id, m, route);
    });
  }
  async copyBatch(id: string, cursor: number, limit: number) {
    assertHistoryLimit(limit);
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw surferFailure('Invalid cutover cursor.');
    return this.tx('cutover-copy', async (c) => {
      const r = await this.route(c),
        m = await this.migration(c, id);
      this.assertCopy(m, r, id);
      if (m.status !== 'COPYING' || m.cursor !== cursor)
        throw surferFailure('Cutover cursor conflict.');
      const p = await this.current(c, m),
        end = Math.min(m.total, cursor + limit);
      let records = p.records.slice(cursor, end);
      if (m.manifest.archiveGeneration) {
        const rows = (
          await c.query<{ ordinal: number; payload: SurferHistoryRecord; digest: string }>(
            'SELECT ordinal,payload,digest FROM surfer_history.record WHERE space_id=$1 AND generation_id=$2 AND ordinal >= $3 AND ordinal < $4 ORDER BY ordinal',
            [this.spaceId, m.manifest.archiveGeneration, cursor, end],
          )
        ).rows;
        if (rows.length !== end - cursor) throw surferFailure('Archive copy has missing rows.');
        records = rows.map((x, i) => {
          if (
            x.ordinal !== cursor + i ||
            x.digest !== x.payload.digest ||
            surferDigest(x.payload) !== surferDigest(p.records[cursor + i])
          )
            throw surferFailure('Archive copy differs from the current source.');
          return x.payload;
        });
      }
      for (let n = cursor; n < end; n++) {
        const record = records[n - cursor]!,
          t = this.target(record);
        await c.query(
          'INSERT INTO surfer_rows.stage VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9::jsonb,$10)',
          [
            this.spaceId,
            id,
            n,
            JSON.stringify(record),
            record.digest,
            t.kind,
            t.id,
            t.revision,
            JSON.stringify(t.payload),
            t.digest,
          ],
        );
      }
      const updated = await c.query(
        'UPDATE surfer_rows.migration SET cursor=$3 WHERE space_id=$1 AND generation_id=$2 AND cursor=$4',
        [this.spaceId, id, end, cursor],
      );
      if (updated.rowCount !== 1) throw surferFailure('Cutover cursor CAS conflict.');
      return this.progress(id, { ...m, cursor: end }, r);
    });
  }
  private async validate(c: PoolClient, id: string, m: Migration) {
    const p = await this.current(c, m);
    if (m.cursor !== m.total) throw surferFailure('Cutover copy is incomplete.');
    for (let n = 0; n < m.total; n += 16) {
      const rows = (
        await c.query<Stage>(
          'SELECT ordinal,archive_record,archive_digest,target_kind,target_id,target_revision::text,target_payload,target_digest FROM surfer_rows.stage WHERE space_id=$1 AND generation_id=$2 AND ordinal >= $3 AND ordinal < $4 ORDER BY ordinal',
          [this.spaceId, id, n, Math.min(n + 16, m.total)],
        )
      ).rows;
      if (rows.length !== Math.min(16, m.total - n))
        throw surferFailure('Cutover stage is incomplete.');
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]!,
          record = p.records[n + i]!,
          t = this.target(record);
        if (
          row.ordinal !== n + i ||
          row.archive_digest !== record.digest ||
          surferDigest(row.archive_record) !== surferDigest(record) ||
          row.target_kind !== t.kind ||
          row.target_id !== t.id ||
          Number(row.target_revision) !== t.revision ||
          row.target_digest !== t.digest ||
          surferDigest(row.target_payload) !== t.digest
        )
          throw surferFailure('Cutover staged record differs from source.');
      }
    }
    if (
      Number(
        (
          await c.query<{ n: string }>(
            'SELECT count(*)::text n FROM surfer_rows.stage WHERE space_id=$1 AND generation_id=$2',
            [this.spaceId, id],
          )
        ).rows[0]!.n,
      ) !== m.total
    )
      throw surferFailure('Cutover stage has unexpected rows.');
  }
  seal(id: string) {
    return this.tx('cutover-seal', async (c) => {
      const r = await this.route(c),
        m = await this.migration(c, id);
      this.assertCopy(m, r, id);
      await this.validate(c, id, m);
      await c.query(
        "UPDATE surfer_rows.migration SET status='READY' WHERE space_id=$1 AND generation_id=$2",
        [this.spaceId, id],
      );
      return this.progress(id, { ...m, status: 'READY' }, r);
    });
  }
  activate(id: string, expectedRouteRevision: number) {
    return this.tx('cutover-activate', async (c) => {
      const r = await this.route(c),
        m = await this.migration(c, id);
      if (m.status === 'ACTIVE' && r.mode === 'ROWS' && r.generation_id === id)
        return this.progress(id, m, r);
      this.assertCopy(m, r, id);
      if (m.status !== 'READY' || Number(r.revision) !== expectedRouteRevision)
        throw surferFailure('Cutover activation CAS conflict.');
      await this.noDestination(c);
      await this.validate(c, id, m);
      // Mode+target data become visible together at outer COMMIT; global exclusive gate excludes writers.
      await c.query(
        "UPDATE surfer_rows.route SET mode='ROWS',revision=revision+1 WHERE space_id=$1 AND revision=$2",
        [this.spaceId, expectedRouteRevision],
      );
      const s = m.manifest.source,
        meta = {
          contract: 'surfer.knowledge-rows.v1',
          spaceId: this.spaceId,
          sequence: s.knowledge.sequence,
          authorityEpoch: s.knowledge.authorityEpoch,
          activeSnapshotId: s.binding.activeSnapshotId,
        };
      await c.query('INSERT INTO surfer_rows.space VALUES($1,$2,$3::jsonb,$4)', [
        this.spaceId,
        meta.sequence,
        JSON.stringify(meta),
        surferDigest(meta),
      ]);
      await c.query(
        "INSERT INTO surfer_rows.record SELECT space_id,target_kind,target_id,target_revision,target_payload,target_digest FROM surfer_rows.stage WHERE space_id=$1 AND generation_id=$2 AND target_kind IN ('INPUT','ARTIFACT','EPOCH','SNAPSHOT','COMMAND') ORDER BY ordinal",
        [this.spaceId, id],
      );
      await c.query(
        "INSERT INTO surfer_rows.source_capture SELECT space_id,target_id,target_digest,target_payload FROM surfer_rows.stage WHERE space_id=$1 AND generation_id=$2 AND target_kind='CAPTURE' ORDER BY ordinal",
        [this.spaceId, id],
      );
      await c.query(
        "INSERT INTO surfer_rows.source_binding SELECT space_id,target_id,target_revision,target_payload,target_digest FROM surfer_rows.stage WHERE space_id=$1 AND generation_id=$2 AND target_kind='BINDING' ORDER BY ordinal",
        [this.spaceId, id],
      );
      await c.query(
        "UPDATE surfer_rows.migration SET status='ACTIVE' WHERE space_id=$1 AND generation_id=$2",
        [this.spaceId, id],
      );
      return this.progress(
        id,
        { ...m, status: 'ACTIVE' },
        { ...r, mode: 'ROWS', revision: String(expectedRouteRevision + 1) },
      );
    });
  }
  abort(id: string, expectedRouteRevision: number) {
    return this.tx('cutover-abort', async (c) => {
      const r = await this.route(c),
        m = await this.migration(c, id);
      if (m.status === 'ABORTED' && r.mode === 'LEGACY' && r.generation_id === null)
        return this.progress(id, m, r);
      this.assertCopy(m, r, id);
      if (Number(r.revision) !== expectedRouteRevision)
        throw surferFailure('Cutover abort CAS conflict.');
      await this.noDestination(c);
      await c.query(
        "UPDATE surfer_rows.route SET mode='LEGACY',generation_id=NULL,revision=revision+1 WHERE space_id=$1",
        [this.spaceId],
      );
      await c.query(
        "UPDATE surfer_rows.migration SET status='ABORTED' WHERE space_id=$1 AND generation_id=$2",
        [this.spaceId, id],
      );
      return this.progress(
        id,
        { ...m, status: 'ABORTED' },
        { ...r, mode: 'LEGACY', generation_id: null, revision: String(expectedRouteRevision + 1) },
      );
    });
  }
  suspend(id: string, expectedRouteRevision: number) {
    return this.tx('cutover-suspend', async (c) => {
      const r = await this.route(c),
        m = await this.migration(c, id);
      if (m.status === 'SUSPENDED' && r.mode === 'SUSPENDED' && r.generation_id === id)
        return this.progress(id, m, r);
      if (
        m.status !== 'ACTIVE' ||
        r.mode !== 'ROWS' ||
        r.generation_id !== id ||
        Number(r.revision) !== expectedRouteRevision
      )
        throw surferFailure('Cutover suspension CAS conflict.');
      await c.query(
        "UPDATE surfer_rows.route SET mode='SUSPENDED',revision=revision+1 WHERE space_id=$1",
        [this.spaceId],
      );
      await c.query(
        "UPDATE surfer_rows.migration SET status='SUSPENDED' WHERE space_id=$1 AND generation_id=$2",
        [this.spaceId, id],
      );
      return this.progress(
        id,
        { ...m, status: 'SUSPENDED' },
        { ...r, mode: 'SUSPENDED', revision: String(expectedRouteRevision + 1) },
      );
    });
  }
}
