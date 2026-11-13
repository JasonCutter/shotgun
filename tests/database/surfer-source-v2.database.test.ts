import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { Pool } from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import { PostgresSurferSourceSession } from '../../adapters/surfer-shotgun-source-postgres/src/index.js';
import {
  ShotgunSurferSourceBridge,
  ShotgunSurferSourceBridgeV2,
} from '../../adapters/surfer-shotgun-bridge/src/index.js';
import { PostgresSurferBindingStoreV2 } from '../../adapters/surfer-binding-postgres/src/index.js';
import { PostgresSurferKnowledgeStore } from '../../adapters/surfer-knowledge-postgres/src/index.js';
import { surferDigest } from '../../packages/contracts/src/surfer-learning.js';
import type { SurferKnowledgeCommand } from '../../packages/contracts/src/surfer-knowledge.js';
import type { SurferSourceSessionV2 } from '../../packages/contracts/src/surfer-source-binding-v2.js';
import {
  createSurferSourceFixture,
  migrateSurferSourceDatabase,
} from '../helpers/surfer-source-database.js';
import { surferBindingContracts } from '../helpers/surfer-binding-contracts.js';

const target = process.env.SURFER_ISOLATED_DATABASE_URL;
describe.skipIf(!target)('Surfer source-binding v2 actual PostgreSQL', () => {
  let pool: Pool,
    principalId: string,
    sessions: PostgresSurferSourceSession,
    bridge: ShotgunSurferSourceBridgeV2;
  beforeAll(async () => {
    const url = new URL(target!);
    if (
      url.hostname !== '127.0.0.1' ||
      url.username !== 'surfer_test' ||
      url.pathname !== '/surfer_test'
    )
      throw new Error('Disposable DB only.');
    pool = new Pool({
      connectionString: target,
      max: 5,
      connectionTimeoutMillis: 5000,
      statement_timeout: 10000,
    });
    const migrations = await migrateSurferSourceDatabase(pool);
    expect(migrations.at(-1)).toBe('173_surfer_meaning_review_prompt_v12.sql');
    await mkdir('.data/surfer-source-v2', { recursive: true });
    await writeFile(
      '.data/surfer-source-v2/schema.json',
      JSON.stringify({
        migrations,
        version: (await pool.query('SELECT version() AS version')).rows[0].version,
      }),
    );
    const auth = new PostgresAuthRepository(pool);
    const account = await auth.bootstrapLocalOwnerPrincipal({
      accountId: `surfer-v2-${randomUUID()}`,
    });
    principalId = account.principalId;
    sessions = new PostgresSurferSourceSession(pool);
    bridge = new ShotgunSurferSourceBridgeV2(sessions);
  }, 60000);
  afterAll(async () => {
    if (pool) await pool.end();
  });
  surferBindingContracts(
    'Memory/PostgreSQL v2 binding replacement',
    () => new PostgresSurferBindingStoreV2(pool),
  );
  async function setup() {
    const f = await createSurferSourceFixture(pool, principalId),
      source = await f.source('서퍼 😀 압력은 3 bar 이하이다.');
    return { ...f, materialSource: source };
  }
  async function append(
    f: Awaited<ReturnType<typeof setup>>,
    options: {
      open?: boolean;
      selected?: string[];
      artifacts?: { artifactId: string; revision: number; digest: string }[];
    } = {},
  ) {
    const captured = await bridge.capture(f.request, {
      schemaVersion: '2.0.0',
      sourceIds: [f.materialSource.sourceId],
      artifacts: options.artifacts ?? [],
      queries: options.open
        ? [{ kind: 'OPEN_QUERY' }]
        : options.selected
          ? [{ kind: 'EXPLICIT_SOURCE_SET', sourceIds: options.selected }]
          : [],
    });
    const command: Extract<SurferKnowledgeCommand, { action: 'APPEND_ARTIFACT' }> = {
      action: 'APPEND_ARTIFACT',
      operationId: randomUUID(),
      expectedRevision: null,
      draft: {
        schemaVersion: '1.0.0',
        artifactId: randomUUID(),
        revision: 1,
        kind: 'INTERPRETATION',
        origin: 'INTERPRETATION',
        scope: captured.knowledgeScope,
        domain: 'v2-source-contract',
        createdAt: new Date().toISOString(),
        observedAt: captured.readReceipt.observedAt,
        producer: {
          engineRevision: 'surfer-v2-fixture',
          modelRevision: 'NONE',
          policyRevision: '1',
          executionId: 'offline',
        },
        payloadSchema: 'surfer.opaque.v1',
        payload: { note: 'Unverified fixture, no semantic/model learning' },
        basis: captured.basis.coreBasis,
      },
    };
    const envelope = { schemaVersion: '2.0.0', command, basis: captured.basis };
    const result = await bridge.execute(f.request, envelope);
    return {
      captured,
      command,
      envelope,
      result,
      ref: {
        artifactId: result.commit.subjectId,
        revision: result.commit.revision,
        digest: result.commit.digest,
      },
    };
  }
  async function publish(
    f: Awaited<ReturnType<typeof setup>>,
    options: Parameters<typeof append>[1] = {},
  ) {
    const saved = await append(f, options);
    const command: SurferKnowledgeCommand = {
      action: 'PUBLISH_SNAPSHOT',
      operationId: randomUUID(),
      snapshotId: randomUUID(),
      expectedActiveSnapshotId: null,
      entries: [saved.ref],
      engineRevision: 'surfer-v2-fixture',
      createdAt: new Date().toISOString(),
    };
    const publication = { schemaVersion: '2.0.0', command, basis: null };
    await bridge.execute(f.request, publication);
    return { ...saved, publication };
  }
  it('keeps direct content/currentness while unrelated metadata advances the read watermark', async () => {
    const f = await setup(),
      saved = await publish(f);
    expect(saved.captured.basis.coreBasis.inputs).toHaveLength(1);
    expect(saved.captured.basis.coreBasis.footprints).toEqual([]);
    const before = await bridge.readCurrentSnapshot(f.request);
    await f.source('사용하지 않은 독립 문서.');
    const after = await bridge.readCurrentSnapshot(f.request);
    expect(before.status).toBe('CURRENT');
    expect(after.status).toBe('CURRENT');
    expect(after.readReceipt.sourceSnapshotDigest).not.toBe(
      before.readReceipt.sourceSnapshotDigest,
    );
    if (before.status === 'CURRENT' && after.status === 'CURRENT')
      expect(after.result.artifacts[0]!.digest).toBe(before.result.artifacts[0]!.digest);
    expect((await bridge.execute(f.request, saved.envelope)).replayed).toBe(true);
  });
  it('invalidates a direct changed version before append or read without waiting for event delivery', async () => {
    const f = await setup(),
      saved = await publish(f);
    await f.source('직접 자료의 변경된 새 버전.', { sourceId: f.materialSource.sourceId });
    expect((await bridge.readCurrentSnapshot(f.request)).status).toBe('UNAVAILABLE');
    await expect(
      bridge.execute(f.request, {
        ...saved.envelope,
        command: { ...saved.command, operationId: randomUUID() },
      }),
    ).rejects.toMatchObject({ code: 'STALE_VERSION' });
  });
  it('keeps UNKNOWN/open relevance conservative for new unseen evidence and empty intake', async () => {
    const f = await setup();
    await publish(f, { open: true });
    await f.source('이전에 읽지 않은 새 반례 후보.');
    expect((await bridge.readCurrentSnapshot(f.request)).status).toBe('UNAVAILABLE');
    const g = await setup();
    await publish(g, { open: true });
    await g.emptyIntake();
    expect((await bridge.readCurrentSnapshot(g.request)).status).toBe('UNAVAILABLE');
  });
  it('tracks an explicit named Source set while excluding changes outside that set', async () => {
    const f = await setup(),
      selected = await f.source('명시적으로 선택한 두 번째 자료.'),
      outside = await f.source('선택 밖 자료.');
    await publish(f, { selected: [f.materialSource.sourceId, selected.sourceId] });
    await f.source('선택 밖의 수정.', { sourceId: outside.sourceId });
    expect((await bridge.readCurrentSnapshot(f.request)).status).toBe('CURRENT');
    await f.source('선택 내부의 수정.', { sourceId: selected.sourceId });
    expect((await bridge.readCurrentSnapshot(f.request)).status).toBe('UNAVAILABLE');
  });
  it('preserves unavailable/NO_EVIDENCE as unknown rather than certifying an explicit negative scope', async () => {
    const f = await setup(),
      unavailable = await f.source('미처리 최신 버전.', { indexed: false });
    await expect(
      bridge.capture(f.request, {
        schemaVersion: '2.0.0',
        sourceIds: [],
        artifacts: [],
        queries: [{ kind: 'EXPLICIT_SOURCE_SET', sourceIds: [unavailable.sourceId] }],
      }),
    ).rejects.toThrow('inaccessible/unready');
    const noEvidence = await f.source('NO_EVIDENCE 자료.', { noEvidence: true });
    await expect(
      bridge.capture(f.request, {
        schemaVersion: '2.0.0',
        sourceIds: [noEvidence.sourceId],
        artifacts: [],
        queries: [],
      }),
    ).rejects.toThrow();
    expect((await publish(f)).captured.readReceipt.contract).toBe('surfer.source-binding.v2');
  });
  it('checks authority on cache hits and never falls back to an older readable version', async () => {
    const f = await setup();
    await publish(f);
    await bridge.readCurrentSnapshot(f.request);
    await f.source('권한 없는 최신 버전.', {
      sourceId: f.materialSource.sourceId,
      accessScope: ['owner', 'admin'],
    });
    expect((await bridge.readCurrentSnapshot(f.request)).status).toBe('UNAVAILABLE');
    await expect(
      bridge.capture(f.request, {
        schemaVersion: '2.0.0',
        sourceIds: [f.materialSource.sourceId],
        artifacts: [],
        queries: [],
      }),
    ).rejects.toThrow();
  });
  it('denies expired membership/session and reset generations even when validation is cached', async () => {
    const f = await setup();
    await publish(f);
    await pool.query(
      "UPDATE project_admin.project_knowledge_epoch SET state='RESET_PENDING' WHERE project_id=$1",
      [f.projectId],
    );
    await expect(bridge.readCurrentSnapshot(f.request)).rejects.toMatchObject({
      code: 'POLICY_DENIED',
    });
    await pool.query(
      "UPDATE project_admin.project_knowledge_epoch SET state='READY',epoch=epoch+1 WHERE project_id=$1",
      [f.projectId],
    );
    expect((await bridge.readCurrentSnapshot(f.request)).status).toBe('UNAVAILABLE');
    const g = await setup();
    await publish(g);
    await pool.query(
      'DELETE FROM auth.project_memberships WHERE principal_id=$1 AND project_id=$2',
      [principalId, g.projectId],
    );
    await expect(bridge.readCurrentSnapshot(g.request)).rejects.toMatchObject({
      code: 'POLICY_DENIED',
    });
  });
  it('detects Evidence tampering behind unchanged metadata and refuses a warm cached witness', async () => {
    const f = await setup();
    await publish(f);
    expect((await bridge.readCurrentSnapshot(f.request)).metrics.cacheHits).toBe(1);
    await pool.query(
      "UPDATE evidence.spans SET quote=jsonb_set(quote,'{exact}',to_jsonb('tampered'::text)) WHERE evidence_id=$1",
      [f.materialSource.evidenceIds[0]],
    );
    await expect(bridge.readCurrentSnapshot(f.request)).rejects.toThrow('Evidence does not match');
  });
  it('rejects forged capture watermarks/core premises rather than trusting a recomputed public digest', async () => {
    const f = await setup(),
      saved = await append(f);
    const forged = structuredClone(saved.envelope);
    forged.basis.readWatermark.observedAt = '2000-01-01T00:00:00.000Z';
    await expect(bridge.execute(f.request, forged)).rejects.toThrow('not issued');
    const changed = {
      ...saved.envelope,
      command: {
        ...saved.command,
        draft: { ...saved.command.draft, basis: { ...saved.command.draft.basis, inputs: [] } },
      },
    };
    await expect(bridge.execute(f.request, changed)).rejects.toThrow('issued v2 core premises');
  });
  it('reuses a stable capture receipt and cannot mutate stored content through returned material', async () => {
    const f = await setup(),
      request = {
        schemaVersion: '2.0.0',
        sourceIds: [f.materialSource.sourceId],
        artifacts: [],
        queries: [],
      };
    const one = await bridge.capture(f.request, request),
      two = await bridge.capture(f.request, request);
    expect(two.basis).toEqual(one.basis);
    const expected = two.materials[0]!.sourceContentHash;
    (one.materials[0]! as { sourceContentHash: string }).sourceContentHash =
      surferDigest('changed');
    expect((await bridge.capture(f.request, request)).materials[0]!.sourceContentHash).toBe(
      expected,
    );
  });
  it('inherits transitive binding changes and prohibits unregistered v1 dependency mixing', async () => {
    const f = await setup(),
      base = await append(f);
    const second = await publish(f, { artifacts: [base.ref] });
    expect(second.captured.basis.dependencies).toHaveLength(1);
    await f.source('이전 전제 수정.', { sourceId: f.materialSource.sourceId });
    expect((await bridge.readCurrentSnapshot(f.request)).status).toBe('UNAVAILABLE');
    await expect(
      bridge.capture(f.request, {
        schemaVersion: '2.0.0',
        sourceIds: [],
        queries: [],
        artifacts: [{ artifactId: 'unregistered', revision: 1, digest: surferDigest('none') }],
      }),
    ).rejects.toThrow('recapture');
  });
  it('keeps coherent MVCC content proofs and rejects escaped/unawaited v2 capabilities', async () => {
    const f = await setup();
    let escaped: SurferSourceSessionV2 | undefined;
    await sessions.withSnapshotV2(f.request, async (s) => {
      escaped = s;
      await expect(
        s.bindingStore.transaction('another-space', (state) => state.sequence),
      ).rejects.toThrow('cross spaces');
      const a = await s.readMaterialV2(f.materialSource.sourceId);
      await f.source('동시 저장된 새 버전.', { sourceId: f.materialSource.sourceId });
      const b = await s.readMaterialV2(f.materialSource.sourceId);
      expect(b.proof).toBe(a.proof);
    });
    await expect(escaped!.readMaterialV2(f.materialSource.sourceId)).rejects.toThrow('expired');
    await expect(escaped!.bindingStore.transaction(f.projectId, (s) => s.sequence)).rejects.toThrow(
      'expired',
    );
  });
  it('detects changed query-range content even outside direct witnesses and behind unchanged metadata', async () => {
    const f = await setup(),
      other = await f.source('공개 범위의 별도 자료.');
    await publish(f, { open: true });
    await pool.query(
      "UPDATE evidence.spans SET quote=jsonb_set(quote,'{exact}',to_jsonb('changed range'::text)) WHERE evidence_id=$1",
      [other.evidenceIds[0]],
    );
    expect((await bridge.readCurrentSnapshot(f.request)).status).toBe('UNAVAILABLE');
  });
  it('does not reactivate an old snapshot on replay or accept a stale v2 activation CAS', async () => {
    const f = await setup(),
      saved = await publish(f);
    const newer = {
      ...saved.publication,
      command: {
        ...saved.publication.command,
        operationId: randomUUID(),
        snapshotId: randomUUID(),
        expectedActiveSnapshotId: saved.publication.command.snapshotId,
      },
    };
    const competitor = {
      ...newer,
      command: { ...newer.command, operationId: randomUUID(), snapshotId: randomUUID() },
    };
    const races = await Promise.allSettled([
      bridge.execute(f.request, newer),
      bridge.execute(f.request, competitor),
    ]);
    expect(races.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const winner = races.find((x) => x.status === 'fulfilled');
    if (!winner || winner.status !== 'fulfilled') throw new Error('No v2 publication won CAS.');
    expect((await bridge.execute(f.request, saved.publication)).replayed).toBe(true);
    const current = await bridge.readCurrentSnapshot(f.request);
    if (current.status !== 'CURRENT') throw new Error('v2 current snapshot missing');
    expect(current.result.snapshot.snapshotId).toBe(winner.value.commit.subjectId);
    await expect(
      bridge.execute(f.request, {
        ...saved.publication,
        command: {
          ...saved.publication.command,
          operationId: randomUUID(),
          snapshotId: randomUUID(),
        },
      }),
    ).rejects.toThrow('Active v2 snapshot changed');
  });
  async function legacySnapshot(f: Awaited<ReturnType<typeof setup>>) {
    const legacy = new ShotgunSurferSourceBridge(sessions),
      captured = await legacy.captureMaterial(f.request, f.materialSource.sourceId);
    const command: SurferKnowledgeCommand = {
      action: 'APPEND_ARTIFACT',
      operationId: randomUUID(),
      expectedRevision: null,
      draft: {
        schemaVersion: '1.0.0',
        artifactId: randomUUID(),
        revision: 1,
        kind: 'INTERPRETATION',
        origin: 'INTERPRETATION',
        scope: captured.knowledgeScope,
        domain: 'v1-shadow',
        createdAt: new Date().toISOString(),
        observedAt: captured.sourceObservedAt,
        producer: {
          engineRevision: 'legacy',
          modelRevision: 'NONE',
          policyRevision: '1',
          executionId: 'offline',
        },
        payloadSchema: 'surfer.opaque.v1',
        payload: { fixture: true },
        basis: captured.basis,
      },
    };
    const result = await legacy.execute(f.request, command),
      id = randomUUID();
    const ref = {
      artifactId: result.commit.subjectId,
      revision: result.commit.revision,
      digest: result.commit.digest,
    };
    await legacy.execute(f.request, {
      action: 'PUBLISH_SNAPSHOT',
      operationId: randomUUID(),
      snapshotId: id,
      expectedActiveSnapshotId: null,
      entries: [ref],
      engineRevision: 'legacy',
      createdAt: new Date().toISOString(),
    });
    return { legacy, id, ref };
  }
  it('shadow-rebuilds v2 while v1 retains its own strict reader and active pointer', async () => {
    const f = await setup(),
      old = await legacySnapshot(f),
      rebuilt = await publish(f);
    expect(
      await new PostgresSurferKnowledgeStore(pool).transaction(
        f.projectId,
        (s) => s.activeSnapshotId,
      ),
    ).toBe(old.id);
    expect((await old.legacy.readCurrentSnapshot(f.request)).status).toBe('CURRENT');
    expect((await bridge.readCurrentSnapshot(f.request)).status).toBe('CURRENT');
    expect(
      (await old.legacy.readCurrentSnapshot(f.request, rebuilt.publication.command.snapshotId))
        .status,
    ).toBe('UNAVAILABLE');
    await expect(
      bridge.capture(f.request, {
        schemaVersion: '2.0.0',
        sourceIds: [],
        queries: [],
        artifacts: [old.ref],
      }),
    ).rejects.toThrow('recapture');
    expect((await bridge.execute(f.request, rebuilt.publication)).replayed).toBe(true);
    await f.source('v1 broad catalogue changes.');
    expect((await old.legacy.readCurrentSnapshot(f.request)).status).toBe('UNAVAILABLE');
    expect((await bridge.readCurrentSnapshot(f.request)).status).toBe('CURRENT');
  });
  it('measures metadata/body transfers and cold/warm validation without claiming notebook p95', async () => {
    const f = await setup();
    for (let i = 0; i < 5; i++) await f.source(`독립 자료 ${i}. ` + '측정용 본문 '.repeat(500));
    let bodyRows = 0,
      bodyBytes = 0,
      totalBytes = 0;
    const auditPool = new Proxy(pool, {
      get(targetPool, key) {
        if (key === 'connect')
          return async () => {
            const client = await targetPool.connect();
            return new Proxy(client, {
              get(targetClient, memberKey) {
                const member = Reflect.get(targetClient, memberKey, targetClient);
                if (memberKey === 'query')
                  return async (...args: unknown[]) => {
                    const result: unknown = await Reflect.apply(member, targetClient, args);
                    if (
                      result &&
                      typeof result === 'object' &&
                      'rows' in result &&
                      Array.isArray(result.rows)
                    ) {
                      const rows = result.rows as Record<string, unknown>[];
                      totalBytes += Buffer.byteLength(JSON.stringify(rows));
                      for (const row of rows)
                        if ('document_ir' in row) {
                          bodyRows++;
                          bodyBytes += Buffer.byteLength(JSON.stringify(row));
                        }
                    }
                    return result;
                  };
                return typeof member === 'function' ? member.bind(targetClient) : member;
              },
            });
          };
        const member = Reflect.get(targetPool, key, targetPool);
        return typeof member === 'function' ? member.bind(targetPool) : member;
      },
    });
    const observed = new PostgresSurferSourceSession(auditPool),
      v1 = new ShotgunSurferSourceBridge(observed),
      v2 = new ShotgunSurferSourceBridgeV2(observed);
    let startTime = performance.now();
    await v1.captureMaterial(f.request, f.materialSource.sourceId);
    const v1Result = { bodyRows, bodyBytes, totalBytes, elapsedMs: performance.now() - startTime };
    bodyRows = bodyBytes = totalBytes = 0;
    const req = {
      schemaVersion: '2.0.0',
      sourceIds: [f.materialSource.sourceId],
      artifacts: [],
      queries: [],
    };
    startTime = performance.now();
    const cold = await v2.capture(f.request, req);
    const coldResult = {
      bodyRows,
      bodyBytes,
      totalBytes,
      metrics: cold.metrics,
      elapsedMs: performance.now() - startTime,
    };
    bodyRows = bodyBytes = totalBytes = 0;
    startTime = performance.now();
    const warm = await v2.capture(f.request, req);
    const warmResult = {
      bodyRows,
      bodyBytes,
      totalBytes,
      metrics: warm.metrics,
      elapsedMs: performance.now() - startTime,
    };
    expect(v1Result.bodyRows).toBe(12);
    expect(coldResult.bodyRows).toBe(1);
    expect(warmResult.bodyRows).toBe(0);
    expect(cold.metrics.materialLoads).toBe(1);
    expect(warm.metrics.materialLoads).toBe(0);
    expect(warm.metrics.cacheHits).toBe(1);
    expect(warm.metrics.proofReads).toBe(1);
    await writeFile(
      '.data/surfer-source-v2/performance.json',
      JSON.stringify(
        {
          schema: 'surfer-source-v2-read-sample-v1',
          sources: 6,
          v1: v1Result,
          v2Cold: coldResult,
          v2Warm: warmResult,
          samplesPerArm: 1,
          claim:
            'Controlled DB source-read sample only; DB proof hashing still reads selected contents, no notebook/p95 or universal speed claim',
        },
        null,
        2,
      ),
    );
  });
  it('rejects unawaited v2 writes without committing a leaked sidecar operation', async () => {
    const f = await setup();
    let pending: Promise<unknown> | undefined;
    await expect(
      sessions.withSnapshotV2(f.request, async (s) => {
        pending = s.bindingStore.transaction(f.projectId, (st) => {
          st.activeSnapshotId = 'leaked';
          st.sequence++;
        });
        void pending.catch(() => {});
        return undefined;
      }),
    ).rejects.toThrow('unawaited');
    await pending?.catch(() => {});
    expect(
      await new PostgresSurferBindingStoreV2(pool).transaction(
        f.projectId,
        (s) => s.activeSnapshotId,
      ),
    ).toBeNull();
  });
  it('loads durable receipts and snapshot pointers through an independent connection after cache loss', async () => {
    const f = await setup();
    await publish(f);
    const other = new Pool({ connectionString: target, max: 1 });
    try {
      const restarted = new ShotgunSurferSourceBridgeV2(new PostgresSurferSourceSession(other));
      const current = await restarted.readCurrentSnapshot(f.request);
      expect(current.status).toBe('CURRENT');
      expect(current.metrics.materialLoads).toBe(1);
      expect(current.metrics.cacheHits).toBe(0);
    } finally {
      await other.end();
    }
  });
  it('reads back an atomic core/binding append after a lost COMMIT acknowledgement', async () => {
    const f = await setup(),
      saved = await append(f);
    const command = {
      ...saved.command,
      operationId: randomUUID(),
      draft: { ...saved.command.draft, artifactId: randomUUID() },
    };
    const envelope = { ...saved.envelope, command };
    let lost = false;
    const proxy = new Proxy(pool, {
      get(targetPool, key) {
        if (key === 'connect')
          return async () => {
            const client = await targetPool.connect();
            return new Proxy(client, {
              get(targetClient, memberKey) {
                const member = Reflect.get(targetClient, memberKey, targetClient);
                if (memberKey === 'query')
                  return async (...args: unknown[]) => {
                    const result: unknown = await Reflect.apply(member, targetClient, args);
                    if (args[0] === 'COMMIT' && !lost) {
                      lost = true;
                      throw new Error('COMMIT acknowledgement lost');
                    }
                    return result;
                  };
                return typeof member === 'function' ? member.bind(targetClient) : member;
              },
            });
          };
        const member = Reflect.get(targetPool, key, targetPool);
        return typeof member === 'function' ? member.bind(targetPool) : member;
      },
    });
    const lossy = new ShotgunSurferSourceBridgeV2(new PostgresSurferSourceSession(proxy));
    await expect(lossy.execute(f.request, envelope)).rejects.toMatchObject({
      code: 'OUTCOME_UNKNOWN',
    });
    const resolved = await bridge.execute(f.request, envelope);
    expect(resolved.replayed).toBe(true);
    const bindings = await new PostgresSurferBindingStoreV2(pool).transaction(f.projectId, (s) =>
      s.bindings.filter((r) => r.artifact.artifactId === command.draft.artifactId),
    );
    expect(bindings).toHaveLength(1);
  });
  it('fails closed on v2 sidecar corruption without falling back to a legacy reader', async () => {
    const f = await setup();
    await publish(f);
    const row = (
      await pool.query<{ digest: string }>(
        'SELECT digest FROM surfer_knowledge.source_binding_v2 WHERE space_id=$1',
        [f.projectId],
      )
    ).rows[0]!;
    await pool.query('UPDATE surfer_knowledge.source_binding_v2 SET digest=$2 WHERE space_id=$1', [
      f.projectId,
      surferDigest('corrupt'),
    ]);
    await expect(bridge.readCurrentSnapshot(f.request)).rejects.toThrow('digest mismatch');
    await pool.query('UPDATE surfer_knowledge.source_binding_v2 SET digest=$2 WHERE space_id=$1', [
      f.projectId,
      row.digest,
    ]);
  });
  it('does not expose a cached derived payload after actual Source owner rows are deleted', async () => {
    const f = await setup();
    await publish(f);
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      for (const table of [
        'source_product.source_stage3_progress',
        'evidence.indexing_results',
        'evidence.spans',
        'transformation.attempts',
        'transformation.revisions',
        'asset.storage_receipts',
      ]) {
        const byVersion = table === 'transformation.attempts' || table === 'asset.storage_receipts';
        await c.query(
          `DELETE FROM ${table} WHERE project_id=$1 AND ${byVersion ? 'source_version_id' : 'source_id'}=$2`,
          [f.projectId, byVersion ? f.materialSource.sourceVersionId : f.materialSource.sourceId],
        );
      }
      await c.query('DELETE FROM asset.source_versions WHERE source_id=$1', [
        f.materialSource.sourceId,
      ]);
      await c.query('DELETE FROM asset.sources WHERE project_id=$1 AND source_id=$2', [
        f.projectId,
        f.materialSource.sourceId,
      ]);
      await c.query('COMMIT');
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    } finally {
      c.release();
    }
    const current = await bridge.readCurrentSnapshot(f.request);
    expect(current.status).toBe('UNAVAILABLE');
    expect('result' in current).toBe(false);
  });
  it('rolls back only the v2 sidecar and restores exact isolated snapshots while legacy remains readable', async () => {
    const f = await setup(),
      old = await legacySnapshot(f);
    await publish(f);
    const rows = (await pool.query('SELECT * FROM surfer_knowledge.source_binding_v2')).rows;
    await pool.query(
      await readFile(
        new URL('../../adapters/surfer-binding-postgres/rollback.sql', import.meta.url),
        'utf8',
      ),
    );
    expect((await old.legacy.readCurrentSnapshot(f.request)).status).toBe('CURRENT');
    await pool.query(
      await readFile(
        new URL('../../db/migrations/143_surfer_source_binding_v2.sql', import.meta.url),
        'utf8',
      ),
    );
    for (const row of rows)
      await pool.query(
        'INSERT INTO surfer_knowledge.source_binding_v2(space_id,revision,payload,digest) VALUES($1,$2,$3::jsonb,$4)',
        [row.space_id, row.revision, JSON.stringify(row.payload), row.digest],
      );
    expect(
      new Map(
        (await pool.query('SELECT * FROM surfer_knowledge.source_binding_v2')).rows.map((r) => [
          r.space_id,
          r,
        ]),
      ),
    ).toEqual(new Map(rows.map((r) => [r.space_id, r])));
    expect((await bridge.readCurrentSnapshot(f.request)).status).toBe('CURRENT');
  });
});
