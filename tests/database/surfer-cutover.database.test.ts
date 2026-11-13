import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';
import { randomUUID } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { Pool, type PoolClient } from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import { PostgresSurferSourceSession } from '../../adapters/surfer-shotgun-source-postgres/src/index.js';
import { ShotgunSurferSourceBridgeV2 } from '../../adapters/surfer-shotgun-bridge/src/v2.js';
import { ShotgunSurferSourceRowsBridge } from '../../adapters/surfer-shotgun-bridge/src/rows.js';
import { PostgresSurferStorageCutover } from '../../adapters/surfer-storage-postgres/src/index.js';
import { PostgresSurferHistoryArchive } from '../../adapters/surfer-history-postgres/src/index.js';
import { PostgresSurferKnowledgeStore } from '../../adapters/surfer-knowledge-postgres/src/index.js';
import { PostgresSurferKnowledgeRows } from '../../adapters/surfer-knowledge-rows-postgres/src/index.js';
import { SurferKnowledgeService } from '../../modules/surfer-core/src/index.js';
import { surferDigest } from '../../packages/contracts/src/surfer-learning.js';
import { projectSurferHistory } from '../../packages/contracts/src/surfer-history.js';
import type {
  SurferArtifactDraft,
  SurferArtifactRef,
  SurferKnowledgeCommand,
  SurferKnowledgeState,
} from '../../packages/contracts/src/surfer-knowledge.js';
import type { SurferBindingStateV2 } from '../../packages/contracts/src/surfer-source-binding-v2.js';
import type { SurferCutoverProgress } from '../../packages/contracts/src/surfer-storage-cutover.js';
import { createSurferSourceFixture } from '../helpers/surfer-source-database.js';

const target = process.env.SURFER_ISOLATED_DATABASE_URL;
let pool: Pool,
  principalId: string,
  sessions: PostgresSurferSourceSession,
  legacy: ShotgunSurferSourceBridgeV2,
  rows: ShotgunSurferSourceRowsBridge;
describe.skipIf(!target)('Surfer lossless storage cutover and writer fence', () => {
  const rowEnvelope = (command: SurferKnowledgeCommand, basis: unknown = null) => ({
    contract: 'surfer.source-rows.v1',
    schemaVersion: '1.0.0',
    command,
    basis,
  });
  async function setup() {
    const f = await createSurferSourceFixture(pool, principalId),
      source = await f.source('cutover Source pressure 7 bar');
    return { ...f, sourceRecord: source };
  }
  type F = Awaited<ReturnType<typeof setup>>;
  async function saved(f: F) {
    const c = await legacy.capture(f.request, {
      schemaVersion: '2.0.0',
      sourceIds: [f.sourceRecord.sourceId],
      artifacts: [],
      queries: [{ kind: 'EXPLICIT_SOURCE_SET', sourceIds: [f.sourceRecord.sourceId] }],
    });
    const d: SurferArtifactDraft = {
      schemaVersion: '1.0.0',
      artifactId: randomUUID(),
      revision: 1,
      kind: 'INTERPRETATION',
      origin: 'INTERPRETATION',
      scope: c.knowledgeScope,
      domain: 'cutover-fixture',
      createdAt: '2026-11-02T00:00:00.000Z',
      observedAt: c.readReceipt.observedAt,
      producer: {
        engineRevision: 'cutover-fixture',
        modelRevision: 'NONE',
        policyRevision: '1',
        executionId: 'offline',
      },
      payloadSchema: 'surfer.opaque.v1',
      payload: { note: 'authored unverified fixture' },
      basis: c.basis.coreBasis,
    };
    const command: SurferKnowledgeCommand = {
        action: 'APPEND_ARTIFACT',
        operationId: randomUUID(),
        expectedRevision: null,
        draft: d,
      },
      result = await legacy.execute(f.request, { schemaVersion: '2.0.0', command, basis: c.basis }),
      ref = { artifactId: d.artifactId, revision: 1, digest: result.commit.digest };
    const publication: SurferKnowledgeCommand = {
      action: 'PUBLISH_SNAPSHOT',
      operationId: randomUUID(),
      snapshotId: randomUUID(),
      expectedActiveSnapshotId: null,
      entries: [ref],
      engineRevision: 'cutover-fixture',
      createdAt: d.createdAt,
    };
    await legacy.execute(f.request, { schemaVersion: '2.0.0', command: publication, basis: null });
    return { c, d, command, ref, publication };
  }
  const authorize = async (c: PoolClient, space: string) => {
    if (
      !(
        await c.query(
          'SELECT 1 FROM auth.project_memberships WHERE principal_id=$1 AND project_id=$2 AND is_owner',
          [principalId, space],
        )
      ).rowCount
    )
      throw new Error('Migration admin denied');
  };
  const admin = (spaceId: string) => ({ spaceId, authorize });
  const manager = (spaceId: string) => new PostgresSurferStorageCutover(pool, admin(spaceId));
  async function source(f: F) {
    const k = (
        await pool.query<{ payload: SurferKnowledgeState }>(
          'SELECT payload FROM surfer_knowledge.space_state WHERE space_id=$1',
          [f.projectId],
        )
      ).rows[0]!.payload,
      b = (
        await pool.query<{ payload: SurferBindingStateV2 }>(
          'SELECT payload FROM surfer_knowledge.source_binding_v2 WHERE space_id=$1',
          [f.projectId],
        )
      ).rows[0]!.payload;
    return { k, b, ...projectSurferHistory(k, b) };
  }
  async function copy(f: F, g?: SurferCutoverProgress) {
    const m = manager(f.projectId);
    let p = g ?? (await m.begin((await source(f)).manifest.pins));
    while (p.cursor < p.total) p = await m.copyBatch(p.generationId, p.cursor, 16);
    return m.seal(p.generationId);
  }
  async function activate(f: F, g?: SurferCutoverProgress) {
    const p = await copy(f, g);
    return manager(f.projectId).activate(p.generationId, p.routeRevision);
  }
  async function liveCounts(f: F) {
    return (
      await pool.query<{ owner: string; n: string }>(
        `SELECT 'space' owner,count(*)::text n FROM surfer_rows.space WHERE space_id=$1 UNION ALL SELECT 'record',count(*)::text FROM surfer_rows.record WHERE space_id=$1 UNION ALL SELECT 'capture',count(*)::text FROM surfer_rows.source_capture WHERE space_id=$1 UNION ALL SELECT 'binding',count(*)::text FROM surfer_rows.source_binding WHERE space_id=$1`,
        [f.projectId],
      )
    ).rows;
  }
  let upgrade: F,
    mixed: F,
    upgradeBefore: Awaited<ReturnType<typeof source>>,
    mixedBefore: Awaited<ReturnType<typeof source>>;
  beforeAll(async () => {
    const u = new URL(target!);
    if (
      u.hostname !== '127.0.0.1' ||
      u.pathname !== '/shotgun_test_surfer' ||
      u.username !== 'surfer_test'
    )
      throw new Error('Disposable database only');
    const databaseUrl = await requireTestDatabaseTarget({
      environment: { ...process.env, TEST_DATABASE_URL: target },
    });
    pool = new Pool({ connectionString: databaseUrl, max: 5, statement_timeout: 15000 });
    const dir = new URL('../../db/migrations/', import.meta.url),
      files = (await readdir(dir)).filter((x) => /^\d{3}_.*\.sql$/.test(x)).sort();
    await pool.query(
      'CREATE SCHEMA runtime;CREATE TABLE runtime.schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())',
    );
    for (const file of files.filter((x) => Number(x.slice(0, 3)) <= 150)) {
      await pool.query(await readFile(new URL(file, dir), 'utf8'));
      await pool.query('INSERT INTO runtime.schema_migrations(name)VALUES($1)', [file]);
    }
    principalId = (
      await new PostgresAuthRepository(pool).bootstrapLocalOwnerPrincipal({
        accountId: `cutover-${randomUUID()}`,
      })
    ).principalId;
    sessions = new PostgresSurferSourceSession(pool);
    legacy = new ShotgunSurferSourceBridgeV2(sessions);
    rows = new ShotgunSurferSourceRowsBridge(sessions);
    upgrade = await setup();
    await saved(upgrade);
    upgradeBefore = await source(upgrade);
    mixed = await setup();
    const old = await saved(mixed);
    mixedBefore = await source(mixed);
    const raw = new PostgresSurferKnowledgeRows(pool, {
      spaceId: mixed.projectId,
      authorize: async () => ({
        spaceId: mixed.projectId,
        accessScope: ['owner'],
        clearance: 'private',
      }),
    });
    await raw.execute({
      action: 'OBSERVE_INPUT',
      operationId: 'independent-row-state',
      expectedRevision: null,
      input: {
        inputId: 'independent',
        revision: 1,
        kind: 'DATASET',
        scope: old.c.knowledgeScope,
        contentDigest: surferDigest('independent'),
        observedAt: old.d.observedAt,
        retired: false,
        witnesses: [],
      },
      affectedFootprints: [{ domain: 'd', predicate: 'p' }],
    });
    const client = await pool.connect();
    await client.query('BEGIN');
    try {
      await client.query(await readFile(new URL('151_surfer_storage_cutover.sql', dir), 'utf8'));
      await client.query(
        "INSERT INTO runtime.schema_migrations(name)VALUES('151_surfer_storage_cutover.sql')",
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }, 60000);
  afterAll(async () => {
    await pool?.end();
  });
  it('preserves pre-upgrade stores and refuses automatic selection of mixed data', async () => {
    expect(await source(upgrade)).toEqual(upgradeBefore);
    expect((await legacy.readCurrentSnapshot(upgrade.request)).status).toBe('CURRENT');
    expect(await source(mixed)).toEqual(mixedBefore);
    expect(
      (await pool.query('SELECT mode FROM surfer_rows.route WHERE space_id=$1', [mixed.projectId]))
        .rows[0]!.mode,
    ).toBe('CONFLICT');
    await expect(manager(mixed.projectId).begin(mixedBefore.manifest.pins)).rejects.toThrow(
      /unmixed/,
    );
    await expect(legacy.readCurrentSnapshot(mixed.request)).rejects.toThrow(/route CONFLICT/);
    await expect(rows.readCurrentSnapshot(mixed.request)).rejects.toMatchObject({
      code: 'POLICY_DENIED',
    });
    expect((await liveCounts(mixed)).some((x) => Number(x.n) > 0)).toBe(true);
  });
  it('copies a sealed archive losslessly, restarts and activates the v2 pointer with exact replay compatibility', async () => {
    const f = await setup(),
      old = await saved(f),
      core = new SurferKnowledgeService(new PostgresSurferKnowledgeStore(pool));
    const v1: SurferKnowledgeCommand = {
      action: 'PUBLISH_SNAPSHOT',
      operationId: randomUUID(),
      snapshotId: randomUUID(),
      expectedActiveSnapshotId: null,
      entries: [old.ref],
      engineRevision: 'legacy-v1-fixture',
      createdAt: old.d.createdAt,
    };
    await core.execute(v1, { spaceId: f.projectId, accessScope: ['owner'], clearance: 'private' });
    const original = await source(f),
      before = await legacy.readCurrentSnapshot(f.request),
      archive = new PostgresSurferHistoryArchive(pool, admin(f.projectId));
    let a = await archive.begin(original.manifest.pins);
    while (a.cursor < a.total) a = await archive.copyBatch(a.generationId, a.cursor, 16);
    await archive.seal(a.generationId);
    const m = manager(f.projectId);
    let g = await m.begin(original.manifest.pins, a.generationId);
    g = await m.copyBatch(g.generationId, 0, 3);
    expect((await manager(f.projectId).begin(original.manifest.pins, a.generationId)).cursor).toBe(
      3,
    );
    g = await activate(f, g);
    expect(await source(f)).toEqual(original);
    const after = await rows.readCurrentSnapshot(f.request);
    expect(after.status).toBe('CURRENT');
    if (before.status === 'CURRENT' && after.status === 'CURRENT') {
      expect(after.result.snapshot).toEqual(before.result.snapshot);
      expect(after.result.artifacts).toEqual(before.result.artifacts);
    }
    expect((await rows.execute(f.request, rowEnvelope(old.publication))).replayed).toBe(true);
    expect((await rows.execute(f.request, rowEnvelope(v1))).replayed).toBe(true);
    const current = await rows.readCurrentSnapshot(f.request);
    if (current.status === 'CURRENT' && old.publication.action === 'PUBLISH_SNAPSHOT')
      expect(current.result.snapshot!.snapshotId).toBe(old.publication.snapshotId);
    expect((await m.activate(g.generationId, g.routeRevision)).status).toBe('ACTIVE');
    await expect(legacy.readCurrentSnapshot(f.request)).rejects.toThrow(/route ROWS/);
    const staged = (
      await pool.query<{ archive_record: unknown }>(
        'SELECT archive_record FROM surfer_rows.stage WHERE space_id=$1 AND generation_id=$2 ORDER BY ordinal',
        [f.projectId, g.generationId],
      )
    ).rows.map((r) => r.archive_record);
    expect(staged).toEqual(original.records);
    await mkdir('.data/surfer-cutover-postgres', { recursive: true });
    await writeFile(
      '.data/surfer-cutover-postgres/roundtrip.json',
      JSON.stringify({
        allStageRecordsExact: true,
        recordKinds: [...new Set(original.records.map((r) => r.kind))],
        records: original.records.length,
        originalBothAggregatesUnchanged: true,
        archiveSource: true,
        v2ActiveSelected: true,
        v1PointerRetained: true,
        legacyDetachedReplay: true,
        legacyReadFenced: true,
      }),
    );
  });
  it('rolls back a failed batch and fences both writers throughout copying', async () => {
    const f = await setup(),
      old = await saved(f),
      original = await source(f),
      m = manager(f.projectId),
      g = await m.begin(original.manifest.pins);
    await expect(
      legacy.execute(f.request, {
        schemaVersion: '2.0.0',
        command: old.command,
        basis: old.c.basis,
      }),
    ).rejects.toThrow(/route COPYING/);
    await expect(
      rows.capture(f.request, {
        schemaVersion: '2.0.0',
        sourceIds: [f.sourceRecord.sourceId],
        artifacts: [],
        queries: [],
      }),
    ).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    await pool.query(
      `CREATE FUNCTION surfer_rows.fail_stage()RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.space_id='${f.projectId}' AND NEW.ordinal=1 THEN RAISE EXCEPTION 'injected stage failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER fail_stage BEFORE INSERT ON surfer_rows.stage FOR EACH ROW EXECUTE FUNCTION surfer_rows.fail_stage()`,
    );
    try {
      await expect(m.copyBatch(g.generationId, 0, 16)).rejects.toThrow(/injected/);
    } finally {
      await pool.query(
        'DROP TRIGGER fail_stage ON surfer_rows.stage;DROP FUNCTION surfer_rows.fail_stage()',
      );
    }
    expect((await m.begin(original.manifest.pins)).cursor).toBe(0);
    expect(
      (
        await pool.query('SELECT count(*)::int n FROM surfer_rows.stage WHERE space_id=$1', [
          f.projectId,
        ])
      ).rows[0]!.n,
    ).toBe(0);
    expect(await source(f)).toEqual(original);
    expect((await activate(f)).status).toBe('ACTIVE');
  });
  it('rolls back mode/metadata/records/captures when activation fails at the binding insert', async () => {
    const f = await setup();
    await saved(f);
    const m = manager(f.projectId),
      g = await copy(f);
    await pool.query(
      `CREATE FUNCTION surfer_rows.fail_activation()RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.space_id='${f.projectId}' THEN RAISE EXCEPTION 'injected activation failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER fail_activation BEFORE INSERT ON surfer_rows.source_binding FOR EACH ROW EXECUTE FUNCTION surfer_rows.fail_activation()`,
    );
    try {
      await expect(m.activate(g.generationId, g.routeRevision)).rejects.toThrow(/injected/);
    } finally {
      await pool.query(
        'DROP TRIGGER fail_activation ON surfer_rows.source_binding;DROP FUNCTION surfer_rows.fail_activation()',
      );
    }
    expect((await liveCounts(f)).every((x) => Number(x.n) === 0)).toBe(true);
    expect(
      (await pool.query('SELECT mode FROM surfer_rows.route WHERE space_id=$1', [f.projectId]))
        .rows[0]!.mode,
    ).toBe('COPYING');
    expect((await m.activate(g.generationId, g.routeRevision)).status).toBe('ACTIVE');
  });
  it('retains stage on abort, resumes legacy and creates a new pinned generation after new data', async () => {
    const f = await setup();
    await saved(f);
    const original = await source(f),
      m = manager(f.projectId);
    let g = await m.begin(original.manifest.pins);
    g = await m.copyBatch(g.generationId, 0, 3);
    await m.abort(g.generationId, g.routeRevision);
    expect((await legacy.readCurrentSnapshot(f.request)).status).toBe('CURRENT');
    expect(
      (
        await pool.query('SELECT count(*)::int n FROM surfer_rows.stage WHERE space_id=$1', [
          f.projectId,
        ])
      ).rows[0]!.n,
    ).toBe(3);
    await f.source('legacy new original after abort', { sourceId: f.sourceRecord.sourceId });
    await legacy.capture(f.request, {
      schemaVersion: '2.0.0',
      sourceIds: [f.sourceRecord.sourceId],
      artifacts: [],
      queries: [],
    });
    const next = await m.begin((await source(f)).manifest.pins);
    expect(next.generationId).not.toBe(g.generationId);
    await m.abort(next.generationId, next.routeRevision);
    expect((await liveCounts(f)).every((x) => Number(x.n) === 0)).toBe(true);
  });
  it('drains an in-flight legacy writer and rejects the stale pre-write source pin', async () => {
    const f = await setup();
    const old = await saved(f),
      pins = (await source(f)).manifest.pins;
    let entered!: () => void, release!: () => void;
    const ready = new Promise<void>((r) => {
        entered = r;
      }),
      gate = new Promise<void>((r) => {
        release = r;
      });
    const writer = sessions.withSnapshotV2(f.request, async (s) => {
      await new SurferKnowledgeService(s.store).execute(
        {
          action: 'OBSERVE_INPUT',
          operationId: 'concurrent-legacy-input',
          expectedRevision: null,
          input: {
            inputId: 'new-dataset',
            revision: 1,
            kind: 'DATASET',
            scope: old.c.knowledgeScope,
            contentDigest: surferDigest('new'),
            observedAt: old.d.observedAt,
            retired: false,
            witnesses: [],
          },
          affectedFootprints: [{ domain: 'extra', predicate: 'p' }],
        },
        s.snapshot.context,
      );
      entered();
      await gate;
    });
    await ready;
    const pending = manager(f.projectId).begin(pins);
    pending.catch(() => undefined);
    let blocked = false;
    try {
      for (let n = 0; n < 50; n++) {
        blocked = !!(
          await pool.query(
            "SELECT 1 FROM pg_locks WHERE locktype='advisory' AND mode='ExclusiveLock' AND NOT granted",
          )
        ).rowCount;
        if (blocked) break;
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(blocked).toBe(true);
    } finally {
      release();
      await writer;
    }
    await expect(pending).rejects.toThrow(/source pin changed/);
    const fresh = await source(f);
    expect(fresh.k.inputs.some((x) => x.inputId === 'new-dataset')).toBe(true);
    const g = await manager(f.projectId).begin(fresh.manifest.pins);
    await manager(f.projectId).abort(g.generationId, g.routeRevision);
  });
  it('rejects an old repeatable-read writer after the fence became visible', async () => {
    const f = await setup();
    await saved(f);
    const original = await source(f),
      client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      await client.query('SELECT payload FROM surfer_knowledge.space_state WHERE space_id=$1', [
        f.projectId,
      ]);
      const g = await manager(f.projectId).begin(original.manifest.pins);
      let error: unknown;
      try {
        await client.query(
          'UPDATE surfer_knowledge.space_state SET digest=digest WHERE space_id=$1',
          [f.projectId],
        );
      } catch (e) {
        error = e;
      }
      expect(['40001', '55000']).toContain((error as { code: string })?.code);
      await client.query('ROLLBACK');
      expect(await source(f)).toEqual(original);
      await manager(f.projectId).abort(g.generationId, g.routeRevision);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
  it('requires fresh admin authority and exact cursor/route CAS for each step', async () => {
    const f = await setup();
    await saved(f);
    const p = await source(f),
      m = manager(f.projectId),
      g = await m.begin(p.manifest.pins);
    const both = await Promise.allSettled([
      m.copyBatch(g.generationId, 0, 3),
      manager(f.projectId).copyBatch(g.generationId, 0, 3),
    ]);
    expect(both.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    await expect(m.activate(g.generationId, g.routeRevision + 1)).rejects.toThrow();
    await pool.query(
      'UPDATE auth.project_memberships SET is_owner=false WHERE principal_id=$1 AND project_id=$2',
      [principalId, f.projectId],
    );
    await expect(m.seal(g.generationId)).rejects.toThrow(/admin denied/);
    await pool.query(
      'UPDATE auth.project_memberships SET is_owner=true WHERE principal_id=$1 AND project_id=$2',
      [principalId, f.projectId],
    );
    await m.abort(g.generationId, g.routeRevision);
    await expect(m.copyBatch(g.generationId, 3, 3)).rejects.toThrow(/status/);
  });
  it('copies history without certifying Source currentness when the upstream original changes during the freeze', async () => {
    const f = await setup();
    await saved(f);
    const g = await copy(f);
    await f.source('new upstream original 9 bar', { sourceId: f.sourceRecord.sourceId });
    await manager(f.projectId).activate(g.generationId, g.routeRevision);
    expect((await rows.readCurrentSnapshot(f.request)).status).toBe('UNAVAILABLE');
  });
  it('preserves 1000 post-cutover revisions on suspension and never down-converts to v1', async () => {
    const f = await setup();
    const old = await saved(f),
      original = await source(f),
      m = manager(f.projectId),
      g = await activate(f),
      id = randomUUID(),
      expected: SurferArtifactRef[] = [];
    for (let revision = 1; revision <= 1000; revision++) {
      const d: SurferArtifactDraft = {
          ...old.d,
          artifactId: id,
          revision,
          kind: 'EPISODE',
          origin: 'EXPERIENCE',
          payload: { note: 'x'.repeat(512) },
        },
        r = await rows.execute(
          f.request,
          rowEnvelope(
            {
              action: 'APPEND_ARTIFACT',
              operationId: `post-cutover:${revision}`,
              expectedRevision: revision === 1 ? null : revision - 1,
              draft: d,
            },
            old.c.basis,
          ),
        );
      expected.push({ artifactId: id, revision, digest: r.commit.digest });
    }
    const artifacts = (
      await pool.query<{ payload: SurferKnowledgeState['artifacts'][number] }>(
        "SELECT payload FROM surfer_rows.record WHERE space_id=$1 AND kind='ARTIFACT' AND record_id=$2 ORDER BY revision",
        [f.projectId, id],
      )
    ).rows.map((x) => x.payload);
    expect(artifacts.map((a) => a.digest)).toEqual(expected.map((r) => r.digest));
    const bindings = (
      await pool.query<{ payload: { artifact: SurferArtifactRef } }>(
        'SELECT payload FROM surfer_rows.source_binding WHERE space_id=$1 AND artifact_id=$2 ORDER BY revision',
        [f.projectId, id],
      )
    ).rows;
    expect(bindings.map((b) => b.payload.artifact)).toEqual(expected);
    const receipts = (
      await pool.query<{ payload: SurferKnowledgeState['commands'][number] }>(
        "SELECT payload FROM surfer_rows.record WHERE space_id=$1 AND kind='COMMAND' AND record_id LIKE 'post-cutover:%' ORDER BY revision",
        [f.projectId],
      )
    ).rows.map((x) => x.payload);
    expect(receipts).toHaveLength(1000);
    expect(receipts.map((x) => x.commit.digest)).toEqual(expected.map((x) => x.digest));
    expect(() =>
      surferDigest({
        ...original.k,
        sequence: original.k.sequence + 1000,
        artifacts: [...original.k.artifacts, ...artifacts],
        commands: [...original.k.commands, ...receipts],
      }),
    ).toThrow(/(structural|text) budget/);
    const before = await liveCounts(f),
      active = await rows.readCurrentSnapshot(f.request);
    expect(active.status).toBe('CURRENT');
    const stopped = await m.suspend(g.generationId, g.routeRevision);
    expect(stopped.status).toBe('SUSPENDED');
    expect(await liveCounts(f)).toEqual(before);
    expect(await source(f)).toEqual(original);
    const after = await new ShotgunSurferSourceRowsBridge(
      new PostgresSurferSourceSession(pool),
    ).readCurrentSnapshot(f.request);
    expect(after.status).toBe('CURRENT');
    if (active.status === 'CURRENT' && after.status === 'CURRENT')
      expect(after.result).toEqual(active.result);
    await expect(legacy.readCurrentSnapshot(f.request)).rejects.toThrow(/route SUSPENDED/);
    await expect(
      rows.execute(f.request, rowEnvelope(old.command, old.c.basis)),
    ).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    await expect(m.abort(g.generationId, stopped.routeRevision)).rejects.toThrow();
    await expect(m.activate(g.generationId, stopped.routeRevision)).rejects.toThrow();
    expect(await liveCounts(f)).toEqual(before);
    await mkdir('.data/surfer-cutover-postgres', { recursive: true });
    await writeFile(
      '.data/surfer-cutover-postgres/suspension.json',
      JSON.stringify({
        postCutoverHistoryRevisions: 1000,
        allArtifactDigestsExact: true,
        allBindingsExact: true,
        allCommandReceiptsExact: true,
        hypotheticalLegacyGuardOwner: 'KNOWLEDGE_WITH_ALL_ARTIFACTS_AND_COMMANDS',
        legacyAggregatesUnchanged: true,
        rowCountsUnchanged: true,
        readCurrentAfterSuspension: true,
        oldReaderWriterFenced: true,
        rowWriterStopped: true,
        v1AggregateGuardWouldReject: true,
        destructiveDownConversion: false,
        logical1000ClaimsAccepted: false,
      }),
    );
  });
  it('keeps stage immutable and rejects a corrupted migration manifest', async () => {
    const f = await setup();
    await saved(f);
    const m = manager(f.projectId),
      g = await copy(f);
    await expect(
      pool.query('DELETE FROM surfer_rows.stage WHERE space_id=$1', [f.projectId]),
    ).rejects.toThrow(/immutable/);
    await pool.query('UPDATE surfer_rows.migration SET digest=$2 WHERE space_id=$1', [
      f.projectId,
      surferDigest('corrupt'),
    ]);
    await expect(m.activate(g.generationId, g.routeRevision)).rejects.toThrow(/manifest/);
    expect((await liveCounts(f)).every((x) => Number(x.n) === 0)).toBe(true);
  });
  it('resolves lost copy/activation acknowledgements by read-only inspection without replaying effects', async () => {
    const f = await setup();
    await saved(f);
    const normal = manager(f.projectId),
      start = await normal.begin((await source(f)).manifest.pins);
    const loseAck = () =>
      new PostgresSurferStorageCutover(
        {
          connect: async () => {
            const client = await pool.connect();
            return new Proxy(client, {
              get(c, k) {
                if (k === 'query')
                  return (...args: unknown[]) =>
                    Reflect.apply(c.query, c, args).then((result: unknown) => {
                      if (args[0] === 'COMMIT')
                        throw new Error('lost acknowledgement after actual COMMIT');
                      return result;
                    });
                const value = Reflect.get(c, k);
                return typeof value === 'function' ? value.bind(c) : value;
              },
            });
          },
        },
        admin(f.projectId),
      );
    await expect(loseAck().copyBatch(start.generationId, 0, 3)).rejects.toMatchObject({
      code: 'OUTCOME_UNKNOWN',
    });
    const copied = await normal.inspect(start.generationId);
    expect(copied.cursor).toBe(3);
    expect(copied.routeMode).toBe('COPYING');
    const ready = await copy(f, copied);
    await expect(loseAck().activate(ready.generationId, ready.routeRevision)).rejects.toMatchObject(
      { code: 'OUTCOME_UNKNOWN' },
    );
    const active = await normal.inspect(ready.generationId);
    expect(active.status).toBe('ACTIVE');
    expect(active.routeMode).toBe('ROWS');
    const before = await liveCounts(f);
    expect(await normal.activate(ready.generationId, ready.routeRevision)).toEqual(active);
    expect(await liveCounts(f)).toEqual(before);
    expect((await rows.readCurrentSnapshot(f.request)).status).toBe('CURRENT');
  });
});
