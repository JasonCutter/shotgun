import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { Pool, type PoolClient } from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PostgresSurferHistoryArchive } from '../../adapters/surfer-history-postgres/src/index.js';
import { PostgresSurferKnowledgeStore } from '../../adapters/surfer-knowledge-postgres/src/index.js';
import { InMemorySurferKnowledgeStore } from '../../adapters/surfer-knowledge-in-memory/src/index.js';
import { SurferKnowledgeService } from '../../modules/surfer-core/src/index.js';
import { emptySurferBindingStateV2 } from '../../packages/contracts/src/surfer-source-binding-v2.js';
import {
  projectSurferHistory,
  type SurferHistoryProgress,
  type SurferHistoryRecord,
} from '../../packages/contracts/src/surfer-history.js';
import { surferDigest } from '../../packages/contracts/src/surfer-learning.js';
import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import { PostgresSurferSourceSession } from '../../adapters/surfer-shotgun-source-postgres/src/index.js';
import { ShotgunSurferSourceBridgeV2 } from '../../adapters/surfer-shotgun-bridge/src/index.js';
import {
  createSurferSourceFixture,
  migrateSurferSourceDatabase,
} from '../helpers/surfer-source-database.js';
import type { SurferKnowledgeState } from '../../packages/contracts/src/surfer-knowledge.js';
import type { SurferBindingStateV2 } from '../../packages/contracts/src/surfer-source-binding-v2.js';

const target = process.env.SURFER_ISOLATED_DATABASE_URL;
let pool: Pool;
describe.skipIf(!target)('Surfer isolated row-history archive', () => {
  beforeAll(async () => {
    const url = new URL(target!);
    if (
      url.hostname !== '127.0.0.1' ||
      url.pathname !== '/shotgun_test_surfer' ||
      url.username !== 'surfer_test'
    )
      throw new Error('Disposable DB only');
    const databaseUrl = await requireTestDatabaseTarget({
      environment: { ...process.env, TEST_DATABASE_URL: target },
    });
    pool = new Pool({ connectionString: databaseUrl, max: 4, statement_timeout: 10000 });
    await migrateSurferSourceDatabase(pool);
    await pool.query(
      'CREATE TABLE history_admin(space_id text PRIMARY KEY, enabled boolean NOT NULL)',
    );
  });
  afterAll(async () => {
    await pool?.end();
  });
  const authorize = async (client: PoolClient, spaceId: string) => {
    const result = await client.query(
      'SELECT 1 FROM history_admin WHERE space_id=$1 AND enabled FOR SHARE',
      [spaceId],
    );
    if (!result.rowCount) throw new Error('archive admin denied');
  };
  const owner = (spaceId: string) => new PostgresSurferHistoryArchive(pool, { spaceId, authorize });
  async function fixture(n = 3) {
    const spaceId = `history-${randomUUID()}`,
      context = { spaceId, accessScope: ['team'], clearance: 'private' as const };
    const store = new InMemorySurferKnowledgeStore(),
      core = new SurferKnowledgeService(store);
    const input = (revision: number) => ({
      inputId: 'source',
      revision,
      kind: 'SOURCE' as const,
      scope: { spaceId, accessScope: ['team'], sensitivity: 'private' as const },
      contentDigest: surferDigest({ revision }),
      observedAt: '2026-11-02T00:00:00.000Z',
      retired: false,
      witnesses: [
        {
          sourceId: 's',
          sourceVersionId: `v${revision}`,
          evidenceId: `e${revision}`,
          materialDigest: surferDigest({ revision }),
        },
      ],
    });
    for (let revision = 1; revision <= n; revision++)
      await core.execute(
        {
          action: 'OBSERVE_INPUT',
          operationId: `input-${revision}`,
          expectedRevision: revision === 1 ? null : revision - 1,
          input: input(revision),
          affectedFootprints: [{ domain: 'd', predicate: 'p' }],
        },
        context,
      );
    const k = await store.transaction(spaceId, (s) => s),
      b = emptySurferBindingStateV2(spaceId);
    // Persist only actual Core-issued state, never inflated artifact counts or invented receipts.
    await pool.query('INSERT INTO surfer_knowledge.space_state VALUES($1,$2,$3::jsonb,$4)', [
      spaceId,
      k.sequence,
      JSON.stringify(k),
      surferDigest(k),
    ]);
    await pool.query('INSERT INTO surfer_knowledge.source_binding_v2 VALUES($1,0,$2::jsonb,$3)', [
      spaceId,
      JSON.stringify(b),
      surferDigest(b),
    ]);
    await pool.query('INSERT INTO history_admin VALUES($1,true)', [spaceId]);
    const projection = projectSurferHistory(k, b);
    return { spaceId, context, k, b, input, ...projection, archive: owner(spaceId) };
  }
  async function copyAll(f: Awaited<ReturnType<typeof fixture>>, g?: SurferHistoryProgress) {
    let p = g ?? (await f.archive.begin(f.manifest.pins));
    while (p.cursor < p.total) p = await f.archive.copyBatch(p.generationId, p.cursor, 16);
    return f.archive.seal(p.generationId);
  }
  it('preserves actual Source-bound artifact revisions, snapshot, binding/capture receipts and watermark', async () => {
    const auth = new PostgresAuthRepository(pool);
    const account = await auth.bootstrapLocalOwnerPrincipal({
      accountId: `history-source-${randomUUID()}`,
    });
    const f = await createSurferSourceFixture(pool, account.principalId),
      source = await f.source('archive source 7 bar');
    const bridge = new ShotgunSurferSourceBridgeV2(new PostgresSurferSourceSession(pool));
    let ref: { artifactId: string; revision: number; digest: string } | undefined;
    const artifactId = randomUUID();
    for (let revision = 1; revision <= 2; revision++) {
      const c = await bridge.capture(f.request, {
        schemaVersion: '2.0.0',
        sourceIds: [source.sourceId],
        artifacts: [],
        queries: [{ kind: 'EXPLICIT_SOURCE_SET', sourceIds: [source.sourceId] }],
      });
      const result = await bridge.execute(f.request, {
        schemaVersion: '2.0.0',
        basis: c.basis,
        command: {
          action: 'APPEND_ARTIFACT',
          operationId: randomUUID(),
          expectedRevision: revision === 1 ? null : 1,
          draft: {
            schemaVersion: '1.0.0',
            artifactId,
            revision,
            kind: 'INTERPRETATION',
            origin: 'INTERPRETATION',
            scope: c.knowledgeScope,
            domain: 'history-fixture',
            createdAt: new Date().toISOString(),
            observedAt: c.readReceipt.observedAt,
            producer: {
              engineRevision: 'history-fixture',
              modelRevision: 'NONE',
              policyRevision: '1',
              executionId: 'offline',
            },
            payloadSchema: 'surfer.opaque.v1',
            payload: { note: 'Unverified archival integration fixture', revision },
            basis: c.basis.coreBasis,
          },
        },
      });
      ref = { artifactId, revision, digest: result.commit.digest };
    }
    const snapshotId = randomUUID();
    await bridge.execute(f.request, {
      schemaVersion: '2.0.0',
      basis: null,
      command: {
        action: 'PUBLISH_SNAPSHOT',
        operationId: randomUUID(),
        snapshotId,
        expectedActiveSnapshotId: null,
        entries: [ref!],
        engineRevision: 'history-fixture',
        createdAt: new Date().toISOString(),
      },
    });
    const spaceId = f.request.projectId;
    const k = (
      await pool.query<{ payload: SurferKnowledgeState }>(
        'SELECT payload FROM surfer_knowledge.space_state WHERE space_id=$1',
        [spaceId],
      )
    ).rows[0]!.payload;
    const b = (
      await pool.query<{ payload: SurferBindingStateV2 }>(
        'SELECT payload FROM surfer_knowledge.source_binding_v2 WHERE space_id=$1',
        [spaceId],
      )
    ).rows[0]!.payload;
    await pool.query('INSERT INTO history_admin VALUES($1,true)', [spaceId]);
    const archive = owner(spaceId),
      projection = projectSurferHistory(k, b);
    let g = await archive.begin(projection.manifest.pins);
    while (g.cursor < g.total) g = await archive.copyBatch(g.generationId, g.cursor, 16);
    await archive.seal(g.generationId);
    const records: SurferHistoryRecord[] = [];
    for (let n = 0; n < g.total;) {
      const p = await archive.page(g.generationId, n, 16);
      records.push(...p.records.map((x) => x.record));
      n = p.next;
      expect(p.verified).toBe(true);
    }
    expect(records).toEqual(projection.records);
    expect(new Set(records.map((r) => r.kind))).toEqual(
      new Set([
        'INPUT',
        'ARTIFACT',
        'EPOCH',
        'SNAPSHOT',
        'COMMAND',
        'BINDING',
        'CAPTURE',
        'WATERMARK',
      ]),
    );
    expect(records.filter((r) => r.kind === 'ARTIFACT')).toHaveLength(2);
    expect((await bridge.readCurrentSnapshot(f.request)).status).toBe('CURRENT');
    await writeFile(
      '.data/surfer-history-postgres/source-roundtrip.json',
      JSON.stringify({
        kinds: [...new Set(records.map((r) => r.kind))],
        artifactRevisions: 2,
        records: records.length,
        exact: true,
        snapshotId,
      }),
    );
  });
  it('backfills/seals all records exactly and supports independent restart with bounded historical pages', async () => {
    const f = await fixture(),
      g = await copyAll(f);
    expect(g.status).toBe('SEALED');
    const restarted = owner(f.spaceId),
      page = await restarted.page(g.generationId, 0, 16);
    expect(page.purpose).toBe('HISTORICAL_ONLY');
    expect(page.records.map((r) => r.record)).toEqual(f.records);
    expect(page.manifest).toEqual(f.manifest);
    expect(await restarted.seal(g.generationId)).toEqual(g);
    expect(await restarted.begin(f.manifest.pins)).toEqual(g);
    page.records.length = 0;
    expect((await restarted.page(g.generationId, 0, 16)).records.length).toBe(g.total);
  });
  it('preserves 1000 Core command receipts and every original row across stop/restart/suspension', async () => {
    const f = await fixture(1000),
      before = surferDigest(f.k);
    let p = await f.archive.begin(f.manifest.pins);
    p = await f.archive.copyBatch(p.generationId, 0, 16);
    f.archive = owner(f.spaceId);
    p = await copyAll(f, p);
    const rows: SurferHistoryRecord[] = [];
    for (let n = 0; n < p.total;) {
      const page = await f.archive.page(p.generationId, n, 16);
      rows.push(...page.records.map((r) => r.record));
      n = page.next;
    }
    expect(rows).toEqual(f.records);
    expect(rows.filter((r) => r.kind === 'COMMAND')).toHaveLength(1000);
    const legacy = (
      await pool.query(
        'SELECT payload,digest FROM surfer_knowledge.space_state WHERE space_id=$1',
        [f.spaceId],
      )
    ).rows[0]!;
    expect(legacy.digest).toBe(before);
    expect(legacy.payload).toEqual(f.k);
    const stopped = await f.archive.suspend(p.generationId, p.cursor);
    expect(stopped.status).toBe('SUSPENDED');
    expect(
      (await owner(f.spaceId).page(p.generationId, 992, 16)).records.map((r) => r.record),
    ).toEqual(f.records.slice(992));
    await expect(f.archive.copyBatch(p.generationId, p.cursor, 1)).rejects.toThrow(/status/);
    await mkdir('.data/surfer-history-postgres', { recursive: true });
    await writeFile(
      '.data/surfer-history-postgres/capacity.json',
      JSON.stringify({
        commandReceipts: 1000,
        totalRows: p.total,
        allRowsExact: true,
        legacyDigestUnchanged: true,
        suspendedRowsPreserved: true,
        logicalClaimsAccepted: false,
        manifestDigest: p.manifestDigest,
      }),
    );
  });
  it('rolls back a mid-batch SQL failure with no row or cursor residue', async () => {
    const f = await fixture(),
      g = await f.archive.begin(f.manifest.pins);
    await pool.query(
      `CREATE FUNCTION surfer_history.fail_copy() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.space_id='${f.spaceId}' AND NEW.ordinal=1 THEN RAISE EXCEPTION 'injected history failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER fail_copy BEFORE INSERT ON surfer_history.record FOR EACH ROW EXECUTE FUNCTION surfer_history.fail_copy()`,
    );
    try {
      await expect(f.archive.copyBatch(g.generationId, 0, 16)).rejects.toThrow(/injected/);
    } finally {
      await pool.query(
        'DROP TRIGGER fail_copy ON surfer_history.record; DROP FUNCTION surfer_history.fail_copy()',
      );
    }
    expect(
      (
        await pool.query('SELECT count(*)::int n FROM surfer_history.record WHERE space_id=$1', [
          f.spaceId,
        ])
      ).rows[0]!.n,
    ).toBe(0);
    expect((await f.archive.begin(f.manifest.pins)).cursor).toBe(0);
    expect((await copyAll(f)).status).toBe('SEALED');
  });
  it('fences concurrent copy attempts and stale cursors without duplicate receipts', async () => {
    const f = await fixture(30),
      g = await f.archive.begin(f.manifest.pins);
    const attempts = await Promise.allSettled([
      f.archive.copyBatch(g.generationId, 0, 16),
      owner(f.spaceId).copyBatch(g.generationId, 0, 16),
    ]);
    expect(attempts.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((x) => x.status === 'rejected')).toHaveLength(1);
    expect((await f.archive.begin(f.manifest.pins)).cursor).toBe(16);
    expect(
      (
        await pool.query('SELECT count(*)::int n FROM surfer_history.record WHERE space_id=$1', [
          f.spaceId,
        ])
      ).rows[0]!.n,
    ).toBe(16);
  });
  it('refuses a changed legacy source and permits historical reads after source advancement', async () => {
    const f = await fixture(),
      g = await copyAll(f);
    await new SurferKnowledgeService(new PostgresSurferKnowledgeStore(pool)).execute(
      {
        action: 'OBSERVE_INPUT',
        operationId: 'next',
        expectedRevision: 3,
        input: f.input(4),
        affectedFootprints: [{ domain: 'd', predicate: 'p' }],
      },
      f.context,
    );
    await expect(f.archive.begin(f.manifest.pins)).rejects.toThrow(/pin/);
    await expect(f.archive.seal(g.generationId)).rejects.toThrow(/changed/);
    expect((await f.archive.page(g.generationId, 0, 16)).records.map((r) => r.record)).toEqual(
      f.records,
    );
  });
  it('checks server admin authority for each read/write and never crosses spaces', async () => {
    const f = await fixture(),
      g = await copyAll(f),
      other = await fixture();
    await expect(other.archive.page(g.generationId, 0, 16)).rejects.toThrow(/generation/);
    await pool.query('UPDATE history_admin SET enabled=false WHERE space_id=$1', [f.spaceId]);
    for (const action of [
      () => f.archive.begin(f.manifest.pins),
      () => f.archive.page(g.generationId, 0, 1),
      () => f.archive.copyBatch(g.generationId, 0, 1),
      () => f.archive.seal(g.generationId),
      () => f.archive.suspend(g.generationId, g.cursor),
    ])
      await expect(action()).rejects.toThrow(/admin denied/);
  });
  it('stops partial copy when either legacy owner advances and retains the pinned generation', async () => {
    const f = await fixture(30),
      g = await f.archive.begin(f.manifest.pins);
    const p = await f.archive.copyBatch(g.generationId, 0, 3);
    const b = { ...f.b, sequence: 1 };
    await pool.query(
      'UPDATE surfer_knowledge.source_binding_v2 SET revision=1,payload=$2::jsonb,digest=$3 WHERE space_id=$1',
      [f.spaceId, JSON.stringify(b), surferDigest(b)],
    );
    await expect(f.archive.copyBatch(g.generationId, p.cursor, 16)).rejects.toThrow(/changed/);
    await expect(f.archive.seal(g.generationId)).rejects.toThrow(/incomplete/);
    const stopped = await f.archive.suspend(g.generationId, p.cursor);
    expect(stopped.verified).toBe(false);
    const page = await f.archive.page(g.generationId, 0, 16);
    expect(page.verified).toBe(false);
    expect(page.copied).toBe(3);
    expect(page.records.map((r) => r.record)).toEqual(f.records.slice(0, 3));
    const fresh = await f.archive.begin({
      ...f.manifest.pins,
      binding: { revision: 1, digest: surferDigest(b) },
    });
    expect(fresh.generationId).not.toBe(g.generationId);
    expect(fresh.cursor).toBe(0);
  });
  it('reconstructs both original aggregate bodies from bounded archived records without field loss', async () => {
    const f = await fixture(20),
      g = await copyAll(f),
      page = await f.archive.page(g.generationId, 0, 16);
    const rows = [...page.records];
    let next = page.next;
    while (next < g.total) {
      const p = await f.archive.page(g.generationId, next, 16);
      rows.push(...p.records);
      next = p.next;
    }
    const values = (kind: SurferHistoryRecord['kind']) =>
      rows.filter((x) => x.record.kind === kind).map((x) => x.record.value);
    const k = {
      ...page.manifest.knowledge,
      inputs: values('INPUT'),
      artifacts: values('ARTIFACT'),
      epochs: values('EPOCH'),
      snapshots: values('SNAPSHOT'),
      commands: values('COMMAND'),
    };
    const b = {
      ...page.manifest.binding,
      bindings: values('BINDING'),
      captures: values('CAPTURE'),
      watermarks: values('WATERMARK'),
    };
    expect(k).toEqual(f.k);
    expect(b).toEqual(f.b);
    expect(surferDigest(k)).toBe(f.manifest.pins.knowledge.digest);
    expect(surferDigest(b)).toBe(f.manifest.pins.binding.digest);
    expect(page.verified).toBe(true);
  });
  it('retains immutable rows and rejects original checksum/manifest tampering', async () => {
    const f = await fixture(),
      g = await copyAll(f);
    await expect(
      pool.query('DELETE FROM surfer_history.record WHERE space_id=$1', [f.spaceId]),
    ).rejects.toThrow(/immutable/);
    await expect(
      pool.query('UPDATE surfer_history.record SET digest=$2 WHERE space_id=$1', [
        f.spaceId,
        surferDigest('tamper'),
      ]),
    ).rejects.toThrow(/immutable/);
    await pool.query('UPDATE surfer_history.generation SET manifest_digest=$2 WHERE space_id=$1', [
      f.spaceId,
      surferDigest('tamper'),
    ]);
    await expect(f.archive.page(g.generationId, 0, 1)).rejects.toThrow(/manifest/);
    await pool.query('UPDATE surfer_knowledge.space_state SET digest=$2 WHERE space_id=$1', [
      f.spaceId,
      surferDigest('tamper'),
    ]);
    await expect(f.archive.begin(f.manifest.pins)).rejects.toThrow(/checksum/);
  });
  it('supports safe suspension of partial backfill and rejects premature seal/read/invalid limits', async () => {
    const f = await fixture(30),
      g = await f.archive.begin(f.manifest.pins);
    await expect(f.archive.seal(g.generationId)).rejects.toThrow(/incomplete/);
    await expect(f.archive.page(g.generationId, 0, 1)).rejects.toThrow(/unavailable/);
    await expect(f.archive.copyBatch(g.generationId, 0, 17)).rejects.toThrow(/limit/);
    await expect(f.archive.page(g.generationId, -1, 1)).rejects.toThrow(/cursor/);
    const p = await f.archive.copyBatch(g.generationId, 0, 3);
    await expect(f.archive.suspend(g.generationId, 0)).rejects.toThrow(/conflict/);
    await f.archive.suspend(g.generationId, p.cursor);
    expect((await f.archive.page(g.generationId, 0, 16)).records).toHaveLength(3);
    expect(
      (
        await pool.query('SELECT payload FROM surfer_knowledge.space_state WHERE space_id=$1', [
          f.spaceId,
        ])
      ).rows[0]!.payload,
    ).toEqual(f.k);
  });
});
