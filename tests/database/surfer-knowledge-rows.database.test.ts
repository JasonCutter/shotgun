import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { Pool, type PoolClient } from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PostgresSurferKnowledgeRows } from '../../adapters/surfer-knowledge-rows-postgres/src/index.js';
import { InMemorySurferKnowledgeStore } from '../../adapters/surfer-knowledge-in-memory/src/index.js';
import { SurferKnowledgeService } from '../../modules/surfer-core/src/index.js';
import { surferDigest } from '../../packages/contracts/src/surfer-learning.js';
import type {
  SurferArtifactDraft,
  SurferArtifactRef,
  SurferKnowledgeCommand,
  SurferKnowledgeCommit,
} from '../../packages/contracts/src/surfer-knowledge.js';
import type { SurferAccessContext } from '../../packages/contracts/src/surfer-experiment.js';
import { migrateSurferSourceDatabase } from '../helpers/surfer-source-database.js';

const target = process.env.SURFER_ISOLATED_DATABASE_URL;
let pool: Pool;
describe.skipIf(!target)('Surfer explicit bounded Core row owner', () => {
  beforeAll(async () => {
    const u = new URL(target!);
    if (u.hostname !== '127.0.0.1' || u.username !== 'surfer_test' || u.pathname !== '/surfer_test')
      throw new Error('Disposable database only');
    pool = new Pool({ connectionString: target, max: 5, statement_timeout: 10000 });
    await migrateSurferSourceDatabase(pool);
    await pool.query(
      'CREATE TABLE rows_access(space_id text PRIMARY KEY,context jsonb NOT NULL,enabled boolean NOT NULL DEFAULT true)',
    );
  });
  afterAll(async () => {
    await pool?.end();
  });
  const authorize = async (client: PoolClient, spaceId: string): Promise<SurferAccessContext> => {
    const r = (
      await client.query<{ context: SurferAccessContext }>(
        'SELECT context FROM rows_access WHERE space_id=$1 AND enabled',
        [spaceId],
      )
    ).rows[0];
    if (!r) throw new Error('Core access denied');
    return r.context;
  };
  const owner = (spaceId: string) => new PostgresSurferKnowledgeRows(pool, { spaceId, authorize });
  async function fixture() {
    const spaceId = `rows-${randomUUID()}`,
      scope = { spaceId, accessScope: ['team'], sensitivity: 'private' as const },
      context = { spaceId, accessScope: ['team'], clearance: 'private' as const };
    await pool.query('INSERT INTO rows_access(space_id,context)VALUES($1,$2::jsonb)', [
      spaceId,
      JSON.stringify(context),
    ]);
    const rows = owner(spaceId),
      memory = new SurferKnowledgeService(new InMemorySurferKnowledgeStore());
    const input = (revision = 1) => ({
      inputId: 'source',
      revision,
      kind: 'SOURCE' as const,
      scope,
      contentDigest: surferDigest({ source: revision }),
      observedAt: '2026-11-02T00:00:00.000Z',
      retired: false,
      witnesses: [
        {
          sourceId: 'source',
          sourceVersionId: `v${revision}`,
          evidenceId: `e${revision}`,
          materialDigest: surferDigest({ source: revision }),
        },
      ],
    });
    const observe = (revision = 1): SurferKnowledgeCommand => ({
      action: 'OBSERVE_INPUT',
      operationId: `observe-${revision}`,
      expectedRevision: revision === 1 ? null : revision - 1,
      input: input(revision),
      affectedFootprints: [{ domain: 'd', predicate: 'p' }],
    });
    await rows.execute(observe());
    await memory.execute(observe(), context);
    async function draft(id = 'active', revision = 1): Promise<SurferArtifactDraft> {
      return {
        schemaVersion: '1.0.0',
        artifactId: id,
        revision,
        kind: 'INTERPRETATION',
        origin: 'INTERPRETATION',
        scope,
        domain: 'd',
        createdAt: '2026-11-02T00:00:00.000Z',
        observedAt: '2026-11-02T00:00:00.000Z',
        producer: {
          engineRevision: 'rows-fixture',
          modelRevision: 'NONE',
          policyRevision: '1',
          executionId: 'offline',
        },
        payloadSchema: 'surfer.opaque.v1',
        payload: { threshold: 7 },
        basis: await rows.captureBasis({ inputIds: ['source'], artifacts: [], footprints: [] }),
      };
    }
    const command = (d: SurferArtifactDraft): SurferKnowledgeCommand => ({
      action: 'APPEND_ARTIFACT',
      operationId: `append-${d.artifactId}-${d.revision}`,
      expectedRevision: d.revision === 1 ? null : d.revision - 1,
      draft: d,
    });
    const append = async (d: SurferArtifactDraft) => {
      const result = await rows.execute(command(d));
      return {
        artifactId: result.commit.subjectId,
        revision: result.commit.revision,
        digest: result.commit.digest,
      };
    };
    const publish = (
      ref: SurferArtifactRef,
      id = 'snapshot',
      prior: string | null = null,
    ): SurferKnowledgeCommand => ({
      action: 'PUBLISH_SNAPSHOT',
      operationId: `publish-${id}`,
      snapshotId: id,
      expectedActiveSnapshotId: prior,
      entries: [ref],
      engineRevision: 'rows-fixture',
      createdAt: '2026-11-02T00:00:00.000Z',
    });
    return {
      spaceId,
      scope,
      context,
      rows,
      memory,
      input,
      observe,
      draft,
      command,
      append,
      publish,
    };
  }
  it('matches full-state Core commits, bases, payloads, roots and snapshot digests', async () => {
    const f = await fixture(),
      d = await f.draft(),
      c = f.command(d);
    expect(await f.rows.execute(c)).toEqual(await f.memory.execute(c, f.context));
    const ref = {
      artifactId: d.artifactId,
      revision: d.revision,
      digest: (await f.rows.execute(c)).commit.digest,
    };
    const p = f.publish(ref);
    expect(await f.rows.execute(p)).toEqual(await f.memory.execute(p, f.context));
    expect(
      await f.rows.captureBasis({
        inputIds: ['source'],
        artifacts: [ref],
        footprints: [{ domain: 'd', predicate: 'p' }],
      }),
    ).toEqual(
      await f.memory.captureBasis(
        { inputIds: ['source'], artifacts: [ref], footprints: [{ domain: 'd', predicate: 'p' }] },
        f.context,
      ),
    );
    const a = await f.rows.readClosure({ snapshotId: null }),
      b = await f.memory.readSnapshot(null, 'CURRENT', f.context);
    expect(a.snapshot).toEqual(b.snapshot);
    expect(a.artifacts).toEqual(b.artifacts);
    expect(a.kernelCurrent).toBe(true);
    expect(a.sourceCurrentness).toBe('NOT_ASSESSED');
  });
  it('stores 1000 inactive 512-character history revisions and reads only the current closure after restart', async () => {
    const f = await fixture(),
      active = await f.append(await f.draft());
    await f.rows.execute(f.publish(active));
    const measure = async () => {
      let selected = 0,
        selects = 0,
        mutations = 0;
      const tracked: Pick<Pool, 'connect'> = {
        connect: async () => {
          const client = await pool.connect();
          return new Proxy(client, {
            get(t, p) {
              if (p === 'query')
                return (...args: unknown[]) => {
                  const result = Reflect.apply(t.query, t, args);
                  return result.then((r: { rowCount: number | null }) => {
                    const sql = String(args[0]);
                    if (sql.includes('surfer_rows.')) {
                      if (sql.startsWith('SELECT')) {
                        selects++;
                        selected += r.rowCount ?? 0;
                      } else mutations++;
                    }
                    return r;
                  });
                };
              const v = Reflect.get(t, p);
              return typeof v === 'function' ? v.bind(t) : v;
            },
          });
        },
      };
      const result = await new PostgresSurferKnowledgeRows(tracked, {
        spaceId: f.spaceId,
        authorize,
      }).readClosure({ snapshotId: null });
      return { selected, selects, mutations, result };
    };
    const initial = await measure(),
      expected: SurferKnowledgeCommit[] = [];
    const basis = await f.rows.captureBasis({
      inputIds: ['source'],
      artifacts: [],
      footprints: [],
    });
    for (let revision = 1; revision <= 1000; revision++) {
      const d = {
        ...(await f.draft('history', revision)),
        kind: 'EPISODE' as const,
        origin: 'EXPERIENCE' as const,
        payload: { note: 'x'.repeat(512) },
        basis,
      };
      expected.push((await f.rows.execute(f.command(d))).commit);
    }
    const restarted = owner(f.spaceId),
      after = await measure();
    expect(after.result).toEqual(initial.result);
    expect(after.selected).toBe(initial.selected);
    expect(after.selects).toBe(initial.selects);
    expect(after.mutations).toBe(0);
    expect(after.selected).toBeLessThan(10);
    const stored = (
      await pool.query<{ revision: string; payload: { digest: string }; digest: string }>(
        "SELECT revision::text,payload,digest FROM surfer_rows.record WHERE space_id=$1 AND kind='ARTIFACT' AND record_id='history' ORDER BY surfer_rows.record.revision",
        [f.spaceId],
      )
    ).rows;
    expect(stored).toHaveLength(1000);
    for (let i = 0; i < stored.length; i++) {
      expect(stored[i]!.payload.digest).toBe(expected[i]!.digest);
      expect(stored[i]!.digest).toBe(surferDigest(stored[i]!.payload));
      expect(Number(stored[i]!.revision)).toBe(i + 1);
    }
    const receipts = (
      await pool.query<{ payload: { commit: SurferKnowledgeCommit } }>(
        "SELECT payload FROM surfer_rows.record WHERE space_id=$1 AND kind='COMMAND' AND record_id LIKE 'append-history-%' ORDER BY revision",
        [f.spaceId],
      )
    ).rows;
    expect(receipts.map((r) => r.payload.commit)).toEqual(expected);
    const old = await restarted.readHistoricalArtifact({
      artifactId: 'history',
      revision: 1,
      digest: expected[0]!.digest,
    });
    expect(old.mode).toBe('HISTORICAL');
    expect(old.artifacts).toHaveLength(1);
    expect(old.kernelCurrent).toBe(false);
    expect(
      (
        await restarted.readClosure({
          artifacts: [{ artifactId: 'history', revision: 1, digest: expected[0]!.digest }],
        })
      ).artifacts,
    ).toEqual([]);
    await mkdir('.data/surfer-knowledge-rows-postgres', { recursive: true });
    await writeFile(
      '.data/surfer-knowledge-rows-postgres/capacity.json',
      JSON.stringify({
        historyRevisions: 1000,
        payloadCharacters: 512,
        allArtifactDigestsExact: true,
        allCommandReceiptsExact: true,
        initialSelectedRows: initial.selected,
        finalSelectedRows: after.selected,
        initialSelects: initial.selects,
        finalSelects: after.selects,
        readMutations: after.mutations,
        activeClosureUnchanged: true,
        sourceCurrentness: 'NOT_ASSESSED',
        logical1000ClaimsAccepted: false,
      }),
    );
  });
  it('invalidates changed inputs and retired/current permissions without returning stale current payload', async () => {
    const f = await fixture(),
      ref = await f.append(await f.draft());
    await f.rows.execute(f.publish(ref));
    await f.rows.execute(f.observe(2));
    const stale = await f.rows.readClosure({ snapshotId: null });
    expect(stale.staleReasons).toContain('INPUT_CHANGED');
    expect(stale.artifacts).toEqual([]);
    expect(stale.snapshot).toBeNull();
    await f.rows.execute({
      ...f.observe(3),
      input: { ...f.input(3), retired: true },
    } as SurferKnowledgeCommand);
    await expect(f.rows.readHistoricalArtifact(ref)).rejects.toMatchObject({
      code: 'POLICY_DENIED',
    });
  });
  it('orders input/artifact/footprint heads numerically beyond single-digit revisions', async () => {
    const f = await fixture();
    for (let revision = 2; revision <= 12; revision++) await f.rows.execute(f.observe(revision));
    const basis = await f.rows.captureBasis({
      inputIds: ['source'],
      artifacts: [],
      footprints: [{ domain: 'd', predicate: 'p' }],
    });
    expect(basis.inputs[0]!.revision).toBe(12);
    expect(basis.footprints[0]!.exactEpoch).toBe(12);
    let ref: SurferArtifactRef | undefined;
    for (let revision = 1; revision <= 12; revision++)
      ref = await f.append(await f.draft('numeric', revision));
    expect((await f.rows.readClosure({ artifacts: [ref!] })).kernelCurrent).toBe(true);
    expect(ref!.revision).toBe(12);
  });
  it('checks current authority, footprint epochs and true dependency heads', async () => {
    const f = await fixture();
    const d: SurferArtifactDraft = {
      ...(await f.draft('rule')),
      kind: 'RULE',
      origin: 'INDUCTION',
      basis: await f.rows.captureBasis({
        inputIds: ['source'],
        artifacts: [],
        footprints: [{ domain: 'd', predicate: 'p' }],
      }),
    };
    const ref = await f.append(d),
      dependent: SurferArtifactDraft = {
        ...(await f.draft('dependent')),
        basis: await f.rows.captureBasis({ inputIds: [], artifacts: [ref], footprints: [] }),
      };
    const dep = await f.append(dependent);
    await f.append({ ...d, revision: 2 });
    expect((await f.rows.readClosure({ artifacts: [dep] })).staleReasons).toContain(
      'ARTIFACT_HEAD_CHANGED',
    );
    await f.rows.execute({
      action: 'OBSERVE_INPUT',
      operationId: 'epoch',
      expectedRevision: null,
      input: {
        inputId: 'other',
        revision: 1,
        kind: 'DATASET',
        scope: f.scope,
        contentDigest: surferDigest('other'),
        observedAt: d.observedAt,
        retired: false,
        witnesses: [],
      },
      affectedFootprints: [{ domain: 'd', predicate: 'p' }],
    });
    expect((await f.rows.readClosure({ artifacts: [ref] })).staleReasons).toContain(
      'QUERY_FOOTPRINT_CHANGED',
    );
    await f.rows.execute({
      action: 'OBSERVE_INPUT',
      operationId: 'policy',
      expectedRevision: null,
      input: {
        inputId: 'policy',
        revision: 1,
        kind: 'POLICY',
        scope: f.scope,
        contentDigest: surferDigest('policy'),
        observedAt: d.observedAt,
        retired: false,
        witnesses: [],
      },
      affectedFootprints: [{ domain: '*', predicate: '*' }],
    });
    expect((await f.rows.readClosure({ artifacts: [ref] })).staleReasons).toContain(
      'AUTHORITY_CHANGED',
    );
  });
  it('preserves the active pointer on old command replay and rejects changed operation meaning', async () => {
    const f = await fixture(),
      a = await f.append(await f.draft('a')),
      b = await f.append(await f.draft('b')),
      first = f.publish(a, 'first');
    await f.rows.execute(first);
    await f.rows.execute(f.publish(b, 'second', 'first'));
    expect((await f.rows.execute(first)).replayed).toBe(true);
    expect((await f.rows.readClosure({ snapshotId: null })).snapshot!.snapshotId).toBe('second');
    await expect(
      f.rows.execute({ ...first, engineRevision: 'changed' } as SurferKnowledgeCommand),
    ).rejects.toThrow(/different input/);
  });
  it('rolls back artifact/receipt/metadata together on a later insert failure', async () => {
    const f = await fixture(),
      d = await f.draft(),
      before = (await pool.query('SELECT * FROM surfer_rows.space WHERE space_id=$1', [f.spaceId]))
        .rows;
    await pool.query(
      `CREATE FUNCTION surfer_rows.fail_write()RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.space_id='${f.spaceId}' AND NEW.kind='COMMAND' THEN RAISE EXCEPTION 'injected row failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER fail_write BEFORE INSERT ON surfer_rows.record FOR EACH ROW EXECUTE FUNCTION surfer_rows.fail_write()`,
    );
    try {
      await expect(f.rows.execute(f.command(d))).rejects.toThrow(/injected/);
    } finally {
      await pool.query(
        'DROP TRIGGER fail_write ON surfer_rows.record;DROP FUNCTION surfer_rows.fail_write()',
      );
    }
    expect(
      (await pool.query('SELECT * FROM surfer_rows.space WHERE space_id=$1', [f.spaceId])).rows,
    ).toEqual(before);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM surfer_rows.record WHERE space_id=$1 AND kind='ARTIFACT'",
          [f.spaceId],
        )
      ).rows[0]!.n,
    ).toBe(0);
    await expect(f.append(d)).resolves.toBeDefined();
  });
  it('serializes competing writes but lets a consistent read snapshot finish across a committed writer', async () => {
    const f = await fixture(),
      d = await f.draft();
    const attempts = await Promise.allSettled([
      f.rows.execute(f.command(d)),
      owner(f.spaceId).execute({ ...f.command(d), operationId: 'other' }),
    ]);
    expect(attempts.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const ref = await f.rows.captureBasis({ inputIds: ['source'], artifacts: [], footprints: [] });
    expect(ref.inputs).toHaveLength(1);
    let entered!: () => void, release!: () => void;
    const enteredPromise = new Promise<void>((r) => {
        entered = r;
      }),
      gate = new Promise<void>((r) => {
        release = r;
      });
    const reader = new PostgresSurferKnowledgeRows(pool, {
      spaceId: f.spaceId,
      authorize: async (c, s) => {
        const ctx = await authorize(c, s);
        entered();
        await gate;
        return ctx;
      },
    });
    const pending = reader.captureBasis({ inputIds: ['source'], artifacts: [], footprints: [] });
    await enteredPromise;
    await f.rows.execute(f.observe(2));
    release();
    expect((await pending).inputs[0]!.revision).toBe(1);
    expect(
      (await f.rows.captureBasis({ inputIds: ['source'], artifacts: [], footprints: [] }))
        .inputs[0]!.revision,
    ).toBe(2);
  });
  it('requires current server context, denies wrong scopes and persists no unauthorized writes', async () => {
    const f = await fixture(),
      d = await f.draft();
    await expect(
      f.rows.execute(f.command({ ...d, scope: { ...d.scope, accessScope: ['admin'] } })),
    ).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    await pool.query('UPDATE rows_access SET enabled=false WHERE space_id=$1', [f.spaceId]);
    await expect(
      f.rows.captureBasis({ inputIds: [], artifacts: [], footprints: [] }),
    ).rejects.toThrow(/access denied/);
    await expect(f.rows.execute(f.command(d))).rejects.toThrow(/access denied/);
    const wrong = new PostgresSurferKnowledgeRows(pool, {
      spaceId: f.spaceId,
      authorize: async () => ({ ...f.context, spaceId: 'another' }),
    });
    await expect(wrong.readClosure({ artifacts: [] })).rejects.toThrow(/cross spaces/);
  });
  it('rejects forged digests/missing dependencies, cycles and excessive lookup requests', async () => {
    const f = await fixture(),
      d = await f.draft(),
      ref = await f.append(d);
    await expect(
      f.rows.readClosure({ artifacts: [{ ...ref, digest: surferDigest('forged') }] }),
    ).rejects.toThrow(/digest/);
    await expect(
      f.rows.readClosure({ artifacts: [{ ...ref, artifactId: 'missing' }] }),
    ).rejects.toThrow(/missing/);
    const next = {
      ...d,
      revision: 2,
      basis: await f.rows.captureBasis({ inputIds: [], artifacts: [ref], footprints: [] }),
    };
    await expect(f.rows.execute(f.command(next))).rejects.toThrow(/cycle/);
    await expect(
      f.rows.readClosure({
        artifacts: Array.from({ length: 65 }, (_, i) => ({ ...ref, artifactId: `fake-${i}` })),
      }),
    ).rejects.toThrow(/64-record/);
  });
  it('detects metadata checksum corruption and retains immutable history against update/delete', async () => {
    const f = await fixture();
    await expect(
      pool.query('DELETE FROM surfer_rows.record WHERE space_id=$1', [f.spaceId]),
    ).rejects.toThrow(/immutable/);
    await pool.query('UPDATE surfer_rows.space SET digest=$2 WHERE space_id=$1', [
      f.spaceId,
      surferDigest('bad'),
    ]);
    await expect(
      f.rows.captureBasis({ inputIds: [], artifacts: [], footprints: [] }),
    ).rejects.toThrow(/checksum/);
  });
});
