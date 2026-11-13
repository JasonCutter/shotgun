import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { beforeAll, beforeEach, afterAll, afterEach, describe, it, expect } from 'vitest';
import { startApplicationSurferIntake } from '../../assemblies/shotgun-app/src/surfer-intake-scheduler.js';
import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import { createSurferIntakeClient } from '../../packages/shotgun-api-client/src/surfer-intake-client.js';
import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import { PostgresSurferExecutionStore } from '../../adapters/surfer-execution-postgres/src/index.js';
import { PostgresSurferIntakeInbox } from '../../adapters/surfer-intake-postgres/src/index.js';
import { SurferExecutionLedger } from '../../modules/surfer-execution/src/index.js';
import { createSurferApplicationRuntime } from '../../assemblies/shotgun-app/src/surfer-runtime.js';
import {
  createProductionStage3Pipeline,
  SourcesStage4ContinuationDispatcher,
} from '../../adapters/sources-stage3-pipeline/src/index.js';
import {
  PostgresSourcesStage3ProgressRepository,
  PostgresSourcesStage3AtomicPersistence,
  PostgresSourcesStage4ContinuationStore,
} from '../../adapters/postgres-stage3/src/runtime-data-integrity.js';
import {
  PostgresTransformationRepository,
  PostgresEvidenceRepository,
} from '../../adapters/postgres-stage3/src/index.js';
import { PythonDocumentFormatAdapter } from '../../adapters/document-format-python/src/index.js';
import { LucasAugmentedPlainTextAdapter } from '../../adapters/plain-text-lucas-augmented/src/index.js';
import type { SurferIndexedSource } from '../../packages/contracts/src/surfer-intake.js';
import type { SurferProviderGatewayPort } from '../../packages/contracts/src/surfer-provider.js';
import { surferDigest } from '../../packages/contracts/src/surfer-learning.js';
import { sha256Text } from '../../packages/contracts/src/document-evidence.js';
import { providerFixture } from '../helpers/surfer-provider-contracts.js';
import { memoryFixture, memoryData } from '../helpers/surfer-memory-fixture.js';
import {
  createSurferSourceFixture,
  migrateSurferSourceDatabase,
} from '../helpers/surfer-source-database.js';
const target = process.env.SURFER_ISOLATED_DATABASE_URL;
let pool: Pool, principalId: string;
const root = '.data/surfer-intake-postgres';
const schedulers: { stop(): Promise<void> }[] = [];
describe.skipIf(!target)('Stage3 outbox to Surfer intake handoff', () => {
  afterEach(async () => {
    for (const s of schedulers.splice(0)) await s.stop();
  });
  beforeAll(async () => {
    const u = new URL(target!);
    if (u.hostname !== '127.0.0.1' || u.username !== 'surfer_test' || u.pathname !== '/surfer_test')
      throw Error('Disposable DB only');
    pool = new Pool({ connectionString: target, max: 8, statement_timeout: 15000 });
    await migrateSurferSourceDatabase(pool);
    principalId = (
      await new PostgresAuthRepository(pool).bootstrapLocalOwnerPrincipal({
        accountId: 'intake-' + randomUUID(),
      })
    ).principalId;
    await mkdir(root, { recursive: true });
    const hostBefore = Date.now(),
      dbClock = (await pool.query('SELECT clock_timestamp() AS now')).rows[0].now as Date,
      hostAfter = Date.now();
    await writeFile(
      root + '/clock.json',
      JSON.stringify({
        hostBefore,
        hostAfter,
        dbClock: dbClock.toISOString(),
        hostAheadLowerMs: hostBefore - dbClock.getTime(),
        hostAheadUpperMs: hostAfter - dbClock.getTime(),
        scope:
          'Disposable DB clock observation only;production host/VM clock acceptance remains open',
      }),
    );
  }, 60000);
  beforeEach(async () => {
    // The existing dispatcher is global. Drain only prior disposable test events
    // so a failure/retry assertion cannot accidentally consume another project.
    await pool.query(
      "UPDATE evidence.stage4_continuations SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE state='RETRYABLE_FAILED'",
    );
    const drain = new SourcesStage4ContinuationDispatcher(
      new PostgresSourcesStage4ContinuationStore(pool),
      { onEvidenceIndexed: async () => {} },
    );
    for (let i = 0; i < 64; i++) {
      if ((await drain.dispatchOnce()) === 'EMPTY') return;
    }
    throw Error('Unexpected test outbox backlog');
  });
  afterAll(async () => {
    await pool?.end();
  });
  async function setup() {
    const actual = await createSurferSourceFixture(pool, principalId),
      runtime = createSurferApplicationRuntime(pool),
      inbox = new PostgresSurferIntakeInbox(pool),
      store = new PostgresSurferExecutionStore(pool),
      p = providerFixture(store);
    p.profile.promptRevision = 'surfer-directive-role-catalog-v3';
    p.policy.allowedSpaceIds = [actual.projectId];
    const ledger = new SurferExecutionLedger(store, p.policy),
      options = { runId: randomUUID(), profile: p.profile, ledger, gateway: p.gateway },
      worker = runtime.createIntakeWorker(options);
    const source = async (item = memoryData.cases[0]!) => {
      const f = memoryFixture(item),
        stored = await actual.source(item.text, { indexed: false });
      const pipeline = createProductionStage3Pipeline({
        storage: { put: async () => stored.storageKey, read: async () => Buffer.from(item.text) },
        transformer: new PythonDocumentFormatAdapter(),
        locator: new LucasAugmentedPlainTextAdapter(),
        transformationRepository: new PostgresTransformationRepository(pool),
        evidenceRepository: new PostgresEvidenceRepository(pool),
        progress: new PostgresSourcesStage3ProgressRepository(pool),
        atomicPersistence: new PostgresSourcesStage3AtomicPersistence(pool),
      });
      await pipeline.runForSourceVersion({
        projectId: actual.projectId,
        sourceId: stored.sourceId,
        sourceVersionId: stored.sourceVersionId,
        storageKey: stored.storageKey,
        contentHash: sha256Text(item.text),
        mediaType: 'text/plain',
        accessScope: ['owner'],
        sensitivity: 'private',
      });
      const row = (
        await pool.query(
          'SELECT * FROM evidence.stage4_continuations WHERE project_id=$1 AND source_version_id=$2',
          [actual.projectId, stored.sourceVersionId],
        )
      ).rows[0];
      const event: SurferIndexedSource = {
        projectId: actual.projectId,
        sourceId: stored.sourceId,
        sourceVersionId: stored.sourceVersionId,
        revisionId: row.revision_id,
        evidenceCount: row.evidence_count,
      };
      return { stored, event, f };
    };
    const first = await source();
    p.response.rawText = first.f.response.rawText;
    const publish = async () =>
      new SourcesStage4ContinuationDispatcher(new PostgresSourcesStage4ContinuationStore(pool), {
        onEvidenceIndexed: async (input) => {
          await runtime.onSourceIndexed({
            projectId: input.projectId,
            sourceId: input.sourceId,
            sourceVersionId: input.sourceVersionId,
            revisionId: input.revisionId,
            evidenceCount: input.evidenceCount,
          });
        },
      }).dispatchOnce();
    const identity = {
      projectId: actual.projectId,
      principalId,
      runId: options.runId,
      profileDigest: surferDigest(p.profile),
      leaseMs: 30000,
    };
    return { actual, runtime, inbox, p, options, worker, source, first, publish, identity };
  }
  const expire = async (jobId: string) =>
    pool.query(
      "UPDATE surfer_intake.job SET lease_until=clock_timestamp()-interval '1 second',revision=revision+1 WHERE job_id=$1 AND state='RUNNING'",
      [jobId],
    );
  const schedule = (f: Awaited<ReturnType<typeof setup>>) => {
    const scheduler = startApplicationSurferIntake(
      f.runtime,
      {
        execution: f.options,
        resolveActor: async () => f.actual.request,
        intervalMs: 1000,
        maxCyclesPerTick: 1,
      },
      false,
    )!;
    schedulers.push(scheduler);
    return scheduler;
  };
  const until = async (check: () => Promise<boolean>) => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw Error('Scheduled intake did not reach expected durable state');
  };
  const state = async (jobId: string) =>
    (await pool.query('SELECT state FROM surfer_intake.job WHERE job_id=$1', [jobId])).rows[0]
      .state as string;
  const revision = async (jobId: string) => ({
    jobId,
    expectedRevision: (
      await pool.query('SELECT revision::text FROM surfer_intake.job WHERE job_id=$1', [jobId])
    ).rows[0].revision as string,
  });
  it('returns only owner-visible metadata without execution secrets and reports the missing server binding', async () => {
    const f = await setup(),
      e = await f.runtime.onSourceIndexed(f.first.event);
    await f.inbox.claim(f.identity);
    const page = await f.runtime.intakeStatus(f.actual.request, {});
    expect(page).toMatchObject({
      executionConfigured: false,
      items: [{ jobId: e.jobId, state: 'RUNNING', recovery: 'NOT_CONFIGURED' }],
      nextCursor: null,
    });
    expect(JSON.stringify(page)).not.toMatch(
      /lease_token|principal_id|profile_digest|prepared|receipt|sessionToken/,
    );
    expect(await f.runtime.resumeIntake(f.actual.request, await revision(e.jobId!))).toEqual({
      status: 'NOT_CONFIGURED',
    });
    expect(f.p.control.sends).toBe(0);
    await f.actual.source('changed-access ' + memoryData.cases[0]!.text, {
      sourceId: f.first.event.sourceId,
      accessScope: ['hidden'],
      indexed: false,
    });
    expect((await f.runtime.intakeStatus(f.actual.request, {})).items).toHaveLength(0);
    await pool.query('UPDATE auth.project_memberships SET is_owner=false WHERE project_id=$1', [
      f.actual.projectId,
    ]);
    await expect(f.runtime.intakeStatus(f.actual.request, {})).rejects.toMatchObject({
      code: 'POLICY_DENIED',
    });
  });
  it('uses the actual browser client and CSRF HTTP boundary to inspect and recover one exact expired job', async () => {
    const f = await setup(),
      e = await f.runtime.onSourceIndexed(f.first.event);
    await f.inbox.claim(f.identity);
    await expire(e.jobId!);
    const runtime = createSurferApplicationRuntime(pool, f.options),
      app = await createApplication({
        authRepository: new PostgresAuthRepository(pool),
        surferRuntime: runtime,
      });
    const requests: { path: string; body: unknown }[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const path = String(input);
      if (
        ![
          '/api/v1/security/csrf',
          '/api/v1/surfer/intake/status',
          '/api/v1/surfer/intake/resume',
        ].includes(path)
      )
        throw Error('Unexpected HTTP path');
      const headers = Object.fromEntries(new Headers(init?.headers).entries());
      headers.cookie = `shotgun_session=${f.actual.session.sessionToken}`;
      requests.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null });
      const response = await app.server.inject({
        method: init?.method === 'POST' ? 'POST' : 'GET',
        url: path,
        headers,
        ...(init?.body ? { payload: String(init.body) } : {}),
      });
      return new Response(response.body, {
        status: response.statusCode,
        headers: { 'content-type': 'application/json' },
      });
    };
    try {
      const client = createSurferIntakeClient(fetcher),
        page = await client.status();
      expect(page.items[0]!.recovery).toBe('AVAILABLE');
      const item = page.items[0]!;
      expect(await client.resume({ jobId: item.jobId, expectedRevision: item.revision })).toEqual({
        status: 'COMPLETED',
        jobId: e.jobId,
      });
      expect((await client.status()).items[0]!.state).toBe('COMPLETED');
      expect(f.p.control.sends).toBe(1);
      expect(requests.filter((r) => r.path.endsWith('/resume'))).toEqual([
        {
          path: '/api/v1/surfer/intake/resume',
          body: { jobId: item.jobId, expectedRevision: item.revision },
        },
      ]);
      await writeFile(
        root + '/browser-client.json',
        JSON.stringify({
          actualCsrfHttpClient: true,
          statusDecoded: true,
          exactResume: true,
          completedMetadata: true,
          resumePosts: 1,
          contractGatewaySends: 1,
          modelCalls: 0,
        }),
      );
    } finally {
      await app.server.close();
    }
  });
  it('protects the actual intake HTTP boundary with session/CSRF and strict server-derived actor input', async () => {
    const f = await setup();
    await f.runtime.onSourceIndexed(f.first.event);
    const app = await createApplication({
      authRepository: new PostgresAuthRepository(pool),
      surferRuntime: f.runtime,
    });
    const headers = {
      cookie: `shotgun_session=${f.actual.session.sessionToken}`,
      'x-csrf-token': f.actual.session.csrfToken,
    };
    const send = (payload: Record<string, unknown>, supplied: Record<string, string> = headers) =>
      app.server.inject({
        method: 'POST',
        url: '/api/v1/surfer/intake/status',
        headers: supplied,
        payload,
      });
    try {
      expect((await send({})).json().items).toHaveLength(1);
      expect((await send({}, {})).statusCode).not.toBe(200);
      expect((await send({}, { cookie: headers.cookie })).statusCode).not.toBe(200);
      for (const payload of [
        { projectId: 'foreign' },
        { actor: f.actual.request },
        { profile: f.p.profile },
        { limit: 100 },
      ])
        expect((await send(payload)).statusCode).not.toBe(200);
      expect((await send({ padding: 'x'.repeat(3000) })).statusCode).toBe(400);
      expect(f.p.control.sends).toBe(0);
    } finally {
      await app.server.close();
    }
  });
  it('resumes only the exact expired running revision using the fixed server binding and strips internal receipts', async () => {
    const f = await setup(),
      e = await f.runtime.onSourceIndexed(f.first.event);
    await f.inbox.claim(f.identity);
    const bound = createSurferApplicationRuntime(pool, f.options);
    expect((await bound.intakeStatus(f.actual.request, {})).items[0]!.recovery).toBe('WAIT_LEASE');
    await expire(e.jobId!);
    expect((await bound.intakeStatus(f.actual.request, {})).items[0]!.recovery).toBe('AVAILABLE');
    const target = await revision(e.jobId!);
    f.options.runId = randomUUID();
    const attempts = await Promise.allSettled([
      bound.resumeIntake(f.actual.request, target),
      bound.resumeIntake(f.actual.request, target),
    ]);
    expect(attempts.filter((r) => r.status === 'fulfilled')).toEqual([
      { status: 'fulfilled', value: { status: 'COMPLETED', jobId: e.jobId } },
    ]);
    expect(attempts.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(f.p.control.sends).toBe(1);
    expect((await bound.intakeStatus(f.actual.request, {})).items[0]!.state).toBe('COMPLETED');
    await expect(bound.resumeIntake(f.actual.request, target)).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
    });
    await mkdir(root, { recursive: true });
    await writeFile(
      root + '/operations.json',
      JSON.stringify({
        ownerMetadata: true,
        exactExpiredResume: true,
        serverBindingFixed: true,
        publicReceiptRedacted: true,
        contractGatewaySends: 1,
        modelCalls: 0,
      }),
    );
  });
  it('rejects unexpired, stale, foreign or differently pinned recovery without selecting another queued document', async () => {
    const f = await setup(),
      e = await f.runtime.onSourceIndexed(f.first.event);
    await f.inbox.claim(f.identity);
    const bound = createSurferApplicationRuntime(pool, f.options),
      target = await revision(e.jobId!);
    await expect(bound.resumeIntake(f.actual.request, target)).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
    });
    await expire(e.jobId!);
    await expect(bound.resumeIntake(f.actual.request, target)).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
    });
    const current = await revision(e.jobId!);
    await expect(
      bound.resumeIntake(f.actual.request, { ...current, jobId: 'intake:' + 'f'.repeat(64) }),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    const mismatch = createSurferApplicationRuntime(pool, { ...f.options, runId: randomUUID() });
    expect((await mismatch.intakeStatus(f.actual.request, {})).items[0]!.recovery).toBe(
      'CONFIGURATION_MISMATCH',
    );
    await expect(mismatch.resumeIntake(f.actual.request, current)).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
    });
    const other = await createSurferSourceFixture(pool, principalId);
    await expect(bound.resumeIntake(other.request, current)).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
    });
    expect(f.p.control.sends).toBe(0);
    expect(await state(e.jobId!)).toBe('RUNNING');
  });
  it('keeps UNKNOWN and completed jobs terminal under explicit recovery requests', async () => {
    for (const unknown of [true, false]) {
      const f = await setup(),
        e = await f.runtime.onSourceIndexed(f.first.event);
      f.p.control.generateError = unknown;
      await f.worker.cycle(f.actual.request);
      const bound = createSurferApplicationRuntime(pool, f.options),
        target = await revision(e.jobId!);
      expect((await bound.intakeStatus(f.actual.request, {})).items[0]!.recovery).toBe(
        'UNAVAILABLE',
      );
      await expect(bound.resumeIntake(f.actual.request, target)).rejects.toMatchObject({
        code: 'REVISION_CONFLICT',
      });
      expect(await state(e.jobId!)).toBe(unknown ? 'BLOCKED' : 'COMPLETED');
      expect(f.p.control.sends).toBe(1);
    }
  });
  it('recovers final acknowledgement through authenticated HTTP from the saved checkpoint without another send', async () => {
    const f = await setup(),
      e = await f.runtime.onSourceIndexed(f.first.event);
    await pool.query(
      "CREATE FUNCTION surfer_intake.ops_fail_done() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected ops done ack'; END $$",
    );
    await pool.query(
      "CREATE TRIGGER ops_fail_done BEFORE UPDATE ON surfer_intake.job FOR EACH ROW WHEN (NEW.state='COMPLETED') EXECUTE FUNCTION surfer_intake.ops_fail_done()",
    );
    try {
      await expect(f.worker.cycle(f.actual.request)).rejects.toThrow('injected ops done ack');
    } finally {
      await pool.query('DROP TRIGGER ops_fail_done ON surfer_intake.job');
      await pool.query('DROP FUNCTION surfer_intake.ops_fail_done()');
    }
    await expire(e.jobId!);
    const bound = createSurferApplicationRuntime(pool, f.options),
      app = await createApplication({
        authRepository: new PostgresAuthRepository(pool),
        surferRuntime: bound,
      });
    try {
      const response = await app.server.inject({
        method: 'POST',
        url: '/api/v1/surfer/intake/resume',
        headers: {
          cookie: `shotgun_session=${f.actual.session.sessionToken}`,
          'x-csrf-token': f.actual.session.csrfToken,
        },
        payload: await revision(e.jobId!),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'COMPLETED', jobId: e.jobId });
      expect(f.p.control.sends).toBe(1);
      expect((await bound.catalog(f.actual.request)).items).toHaveLength(1);
    } finally {
      await app.server.close();
    }
  });
  it('uses read-only status queries and refuses a permission change between metadata read and response', async () => {
    const f = await setup();
    await f.runtime.onSourceIndexed(f.first.event);
    let readOnly = 0,
      writes = 0,
      revoke = false;
    const tracked = new Proxy(pool, {
      get(t, k) {
        if (k === 'connect')
          return async () => {
            const c = await t.connect();
            return new Proxy(c, {
              get(x, p) {
                if (p === 'query')
                  return async (sql: unknown, ...args: unknown[]) => {
                    const result = await (x.query as (...a: unknown[]) => Promise<unknown>)(
                      sql,
                      ...args,
                    );
                    if (sql === 'SET TRANSACTION READ ONLY') {
                      readOnly++;
                      expect(
                        (await x.query('SHOW transaction_read_only')).rows[0].transaction_read_only,
                      ).toBe('on');
                    }
                    if (typeof sql === 'string' && /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql))
                      writes++;
                    if (
                      revoke &&
                      typeof sql === 'string' &&
                      sql.startsWith('SELECT job_id,source_id,source_version_id')
                    ) {
                      revoke = false;
                      await pool.query(
                        'UPDATE auth.project_memberships SET is_owner=false WHERE project_id=$1',
                        [f.actual.projectId],
                      );
                    }
                    return result;
                  };
                const v = Reflect.get(x, p);
                return typeof v === 'function' ? v.bind(x) : v;
              },
            });
          };
        const v = Reflect.get(t, k);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
    const runtime = createSurferApplicationRuntime(tracked);
    expect((await runtime.intakeStatus(f.actual.request, {})).items).toHaveLength(1);
    expect(readOnly).toBe(3);
    expect(writes).toBe(0);
    revoke = true;
    await expect(runtime.intakeStatus(f.actual.request, {})).rejects.toMatchObject({
      code: 'POLICY_DENIED',
    });
    expect(writes).toBe(0);
  });
  it('paginates more than twenty immutable jobs without duplication or microsecond cursor truncation', async () => {
    const f = await setup();
    await f.runtime.onSourceIndexed(f.first.event);
    for (let i = 0; i < 20; i++) {
      const s = await f.source();
      await f.runtime.onSourceIndexed(s.event);
    }
    const first = await f.runtime.intakeStatus(f.actual.request, {});
    expect(first.items).toHaveLength(20);
    expect(first.nextCursor!.createdAt).toMatch(/\.\d{6}Z$/);
    const second = await f.runtime.intakeStatus(f.actual.request, { cursor: first.nextCursor });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((x) => x.jobId)).size).toBe(21);
    expect(f.p.control.sends).toBe(0);
  });
  it('automatically consumes a newly delivered outbox event on a later timer and resumes preserved work after stop', async () => {
    const f = await setup(),
      scheduler = schedule(f);
    expect((await scheduler.drainOnce()).status).toBe('IDLE');
    expect(await f.publish()).toBe('SUCCEEDED');
    const e = await f.runtime.onSourceIndexed(f.first.event);
    // No manual tick after enqueue: the real interval must execute the queued document.
    await until(async () => (await state(e.jobId!)) === 'COMPLETED');
    await scheduler.stop();
    expect(f.p.control.sends).toBe(1);
    const second = await f.source(memoryData.cases[1]!);
    f.p.response.rawText = second.f.response.rawText;
    const next = await f.runtime.onSourceIndexed(second.event);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(await state(next.jobId!)).toBe('READY');
    expect(f.p.control.sends).toBe(1);
    const restarted = schedule(f);
    expect((await restarted.drainOnce()).completed).toBe(1);
    expect(await state(next.jobId!)).toBe('COMPLETED');
    expect((await f.runtime.catalog(f.actual.request)).items).toHaveLength(2);
    expect(f.p.control.sends).toBe(2);
    await mkdir(root, { recursive: true });
    await writeFile(
      root + '/scheduler.json',
      JSON.stringify({
        realIntervalConsumedOutbox: true,
        stopPreservedQueuedWork: true,
        restartCompleted: true,
        memoryCount: 2,
        contractGatewaySends: 2,
        modelCalls: 0,
      }),
    );
  });
  it('rechecks current owner permission on a later scheduled cycle without consuming unauthorized work', async () => {
    const f = await setup();
    await f.runtime.onSourceIndexed(f.first.event);
    const scheduler = schedule(f);
    expect((await scheduler.drainOnce()).completed).toBe(1);
    const next = await f.source(memoryData.cases[1]!);
    f.p.response.rawText = next.f.response.rawText;
    const job = await f.runtime.onSourceIndexed(next.event);
    await pool.query('UPDATE auth.project_memberships SET is_owner=false WHERE project_id=$1', [
      f.actual.projectId,
    ]);
    expect(await scheduler.drainOnce()).toMatchObject({ status: 'PAUSED', code: 'CYCLE_FAILED' });
    expect(await state(job.jobId!)).toBe('READY');
    expect(f.p.control.sends).toBe(1);
    await pool.query('UPDATE auth.project_memberships SET is_owner=true WHERE project_id=$1', [
      f.actual.projectId,
    ]);
    await until(async () => (await state(job.jobId!)) === 'COMPLETED');
    expect(f.p.control.sends).toBe(2);
  });
  it('drains an in-flight provider on shutdown while preserving the next queued document', async () => {
    const f = await setup();
    const first = await f.runtime.onSourceIndexed(f.first.event);
    const next = await f.source(memoryData.cases[1]!);
    const second = await f.runtime.onSourceIndexed(next.event);
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gateway: SurferProviderGatewayPort = {
      ...f.options.gateway,
      prepare: async (binding, request) => {
        const prepared = await f.options.gateway.prepare(binding, request);
        return {
          ...prepared,
          generate: async (signal) => {
            entered();
            await gate;
            return prepared.generate(signal);
          },
        };
      },
    };
    const scheduler = schedule({ ...f, options: { ...f.options, gateway } });
    await started;
    let stopped = false;
    const stopping = scheduler.stop().then(() => {
      stopped = true;
    });
    try {
      await Promise.resolve();
      expect(stopped).toBe(false);
    } finally {
      release();
      await stopping;
    }
    expect(await state(first.jobId!)).toBe('COMPLETED');
    expect(await state(second.jobId!)).toBe('READY');
    expect(f.p.control.sends).toBe(1);
    f.p.response.rawText = next.f.response.rawText;
    const restarted = schedule(f);
    expect((await restarted.drainOnce()).completed).toBe(1);
    expect(f.p.control.sends).toBe(2);
    expect((await f.runtime.catalog(f.actual.request)).items).toHaveLength(2);
  });
  it('retains provider UNKNOWN across recurring ticks and scheduler reconstruction without redispatch', async () => {
    const f = await setup(),
      e = await f.runtime.onSourceIndexed(f.first.event);
    f.p.control.generateError = true;
    const scheduler = schedule(f);
    expect(await scheduler.drainOnce()).toMatchObject({
      status: 'PAUSED',
      code: 'WORK_BLOCKED',
      blocked: 1,
    });
    expect(await state(e.jobId!)).toBe('BLOCKED');
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await scheduler.stop();
    const restarted = schedule(f);
    expect((await restarted.drainOnce()).status).toBe('IDLE');
    expect(f.p.control.sends).toBe(1);
    expect(
      (await pool.query('SELECT safe_code FROM surfer_intake.job WHERE job_id=$1', [e.jobId]))
        .rows[0].safe_code,
    ).toBe('OUTCOME_UNKNOWN');
  });
  it('recovers a scheduler-paused final acknowledgement using the original checkpoint after restart', async () => {
    const f = await setup(),
      e = await f.runtime.onSourceIndexed(f.first.event);
    await pool.query(
      "CREATE FUNCTION surfer_intake.scheduler_fail_done() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected scheduler done ack'; END $$",
    );
    await pool.query(
      "CREATE TRIGGER scheduler_fail_done BEFORE UPDATE ON surfer_intake.job FOR EACH ROW WHEN (NEW.state='COMPLETED') EXECUTE FUNCTION surfer_intake.scheduler_fail_done()",
    );
    const scheduler = schedule(f);
    try {
      expect(await scheduler.drainOnce()).toMatchObject({ status: 'PAUSED', code: 'CYCLE_FAILED' });
      expect(await state(e.jobId!)).toBe('RUNNING');
      expect(f.p.control.sends).toBe(1);
    } finally {
      await scheduler.stop();
      await pool.query('DROP TRIGGER scheduler_fail_done ON surfer_intake.job');
      await pool.query('DROP FUNCTION surfer_intake.scheduler_fail_done()');
    }
    await expire(e.jobId!);
    const restarted = schedule(f);
    expect((await restarted.drainOnce()).completed).toBe(1);
    expect(await state(e.jobId!)).toBe('COMPLETED');
    expect(f.p.control.sends).toBe(1);
    expect((await f.runtime.catalog(f.actual.request)).items).toHaveLength(1);
  });
  it('uses real Stage3/outbox delivery to enqueue once without a model and completes a configured explicit cycle', async () => {
    const f = await setup();
    expect(
      (
        await pool.query('SELECT count(*)::int AS n FROM surfer_intake.job WHERE project_id=$1', [
          f.actual.projectId,
        ])
      ).rows[0].n,
    ).toBe(0);
    expect(await f.publish()).toBe('SUCCEEDED');
    expect(f.p.control.sends).toBe(0);
    const result = await f.worker.cycle(f.actual.request);
    expect(result.status).toBe('COMPLETED');
    expect(f.p.control.sends).toBe(1);
    expect((await f.runtime.catalog(f.actual.request)).items).toHaveLength(1);
    expect((await f.worker.cycle(f.actual.request)).status).toBe('EMPTY');
    const state = (
      await pool.query('SELECT * FROM surfer_intake.job WHERE project_id=$1', [f.actual.projectId])
    ).rows[0];
    expect(state.state).toBe('COMPLETED');
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM surfer_intake.transition WHERE job_id=$1',
          [state.job_id],
        )
      ).rows[0].n,
    ).toBe(4);
    expect(JSON.stringify(state)).not.toMatch(
      /sessionToken|rawText|coreBasis|packet|fixture-credential/,
    );
    await writeFile(
      root + '/path.json',
      JSON.stringify({
        realStage3Outbox: true,
        automaticMetadataEnqueue: true,
        configuredExplicitCycle: true,
        memoryQueryable: true,
        enqueueProviderSends: 0,
        contractGatewaySends: 1,
        modelCalls: 0,
      }),
    );
  });
  it('deduplicates concurrent delivery and preserves the original event and transition identity', async () => {
    const f = await setup(),
      r = await Promise.all([
        f.runtime.onSourceIndexed(f.first.event),
        f.runtime.onSourceIndexed(f.first.event),
      ]);
    expect(r[0]!.jobId).toBe(r[1]!.jobId);
    expect(r.filter((x) => !x.replayed)).toHaveLength(1);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM surfer_intake.transition WHERE job_id=$1',
          [r[0]!.jobId],
        )
      ).rows[0].n,
    ).toBe(1);
    await expect(
      f.runtime.onSourceIndexed({
        ...f.first.event,
        evidenceCount: f.first.event.evidenceCount + 1,
      }),
    ).rejects.toBeTruthy();
    expect(f.p.control.sends).toBe(0);
  });
  it('recovers Stage4 redelivery after a post-enqueue hook failure without losing or duplicating the job', async () => {
    const f = await setup();
    let fail = true;
    const dispatcher = new SourcesStage4ContinuationDispatcher(
      new PostgresSourcesStage4ContinuationStore(pool),
      {
        onEvidenceIndexed: async (input) => {
          expect(input.projectId).toBe(f.actual.projectId);
          await f.runtime.onSourceIndexed({
            projectId: input.projectId,
            sourceId: input.sourceId,
            sourceVersionId: input.sourceVersionId,
            revisionId: input.revisionId,
            evidenceCount: input.evidenceCount,
          });
          if (fail) {
            fail = false;
            throw Error('injected after inbox commit');
          }
        },
      },
    );
    expect(await dispatcher.dispatchOnce()).toBe('FAILED');
    await pool.query(
      "UPDATE evidence.stage4_continuations SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE project_id=$1 AND state='RETRYABLE_FAILED'",
      [f.actual.projectId],
    );
    expect(await dispatcher.dispatchOnce()).toBe('SUCCEEDED');
    expect(
      (
        await pool.query('SELECT count(*)::int AS n FROM surfer_intake.job WHERE project_id=$1', [
          f.actual.projectId,
        ])
      ).rows[0].n,
    ).toBe(1);
    expect(f.p.control.sends).toBe(0);
  });
  it('resolves a lost enqueue COMMIT acknowledgement from durable metadata before Stage4 completes', async () => {
    const f = await setup();
    let lost = false;
    const uncertain = new Proxy(pool, {
      get(t, k) {
        if (k === 'connect')
          return async () => {
            const c = await t.connect();
            return new Proxy(c, {
              get(x, p) {
                if (p === 'query')
                  return async (sql: unknown, ...args: unknown[]) => {
                    const r = await (x.query as (...a: unknown[]) => Promise<unknown>)(
                      sql,
                      ...args,
                    );
                    if (sql === 'COMMIT' && !lost) {
                      lost = true;
                      throw Error('injected enqueue COMMIT ack loss');
                    }
                    return r;
                  };
                const v = Reflect.get(x, p);
                return typeof v === 'function' ? v.bind(x) : v;
              },
            });
          };
        const v = Reflect.get(t, k);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
    const inbox = new PostgresSurferIntakeInbox(uncertain),
      dispatcher = new SourcesStage4ContinuationDispatcher(
        new PostgresSourcesStage4ContinuationStore(pool),
        {
          onEvidenceIndexed: async (input) => {
            const r = await inbox.enqueue({
              projectId: input.projectId,
              sourceId: input.sourceId,
              sourceVersionId: input.sourceVersionId,
              revisionId: input.revisionId,
              evidenceCount: input.evidenceCount,
            });
            expect(r.replayed).toBe(true);
          },
        },
      );
    expect(await dispatcher.dispatchOnce()).toBe('SUCCEEDED');
    expect(lost).toBe(true);
    expect(
      (
        await pool.query('SELECT count(*)::int AS n FROM surfer_intake.job WHERE project_id=$1', [
          f.actual.projectId,
        ])
      ).rows[0].n,
    ).toBe(1);
    expect(f.p.control.sends).toBe(0);
  });
  it('pins exact queued SourceVersion/revision and blocks a superseded document before dispatch', async () => {
    const f = await setup();
    await f.runtime.onSourceIndexed(f.first.event);
    await f.actual.source('new source head', { sourceId: f.first.stored.sourceId });
    expect(await f.worker.cycle(f.actual.request)).toMatchObject({
      status: 'BLOCKED',
      code: 'WORK_UNAVAILABLE',
    });
    expect(f.p.control.sends).toBe(0);
    expect(
      (
        await pool.query('SELECT source_version_id FROM surfer_intake.job WHERE project_id=$1', [
          f.actual.projectId,
        ])
      ).rows[0].source_version_id,
    ).toBe(f.first.event.sourceVersionId);
  });
  it('serially accumulates two queued documents and replays indexed preparation after active memory changes', async () => {
    const f = await setup();
    await f.runtime.onSourceIndexed(f.first.event);
    const next = await f.source(memoryData.cases[1]!);
    await f.runtime.onSourceIndexed(next.event);
    const a = await f.worker.cycle(f.actual.request);
    expect(a.status).toBe('COMPLETED');
    f.p.response.rawText = next.f.response.rawText;
    const b = await f.worker.cycle(f.actual.request);
    expect(b).toMatchObject({ status: 'COMPLETED', receipt: { memoryCount: 2 } });
    const row = (
      await pool.query(
        'SELECT request_id,prepared FROM surfer_intake.job WHERE project_id=$1 AND source_version_id=$2',
        [f.actual.projectId, f.first.event.sourceVersionId],
      )
    ).rows[0];
    const replay = await f.runtime
      .createDocumentWorker(f.options)
      .prepareIndexed(f.actual.request, {
        schemaVersion: '1.0.0',
        requestId: row.request_id,
        sourceId: f.first.event.sourceId,
        sourceVersionId: f.first.event.sourceVersionId,
        revisionId: f.first.event.revisionId,
      });
    expect(replay).toMatchObject({ prepared: row.prepared, replayed: true });
    expect((await f.runtime.catalog(f.actual.request)).items).toHaveLength(2);
    expect(f.p.control.sends).toBe(2);
  });
  it('fences stale lease acknowledgements and refuses a different pinned profile before exact recovery', async () => {
    const f = await setup(),
      enqueued = await f.runtime.onSourceIndexed(f.first.event),
      a = (await f.inbox.claim(f.identity))!;
    await expire(enqueued.jobId!);
    expect(await f.inbox.claim({ ...f.identity, profileDigest: surferDigest('other') })).toBeNull();
    const b = (await f.inbox.claim(f.identity))!;
    expect(b.token).not.toBe(a.token);
    await expect(f.inbox.block(a, 'INCOMPLETE')).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
    });
    await expire(enqueued.jobId!);
    expect((await f.worker.cycle(f.actual.request)).status).toBe('COMPLETED');
    expect(f.p.control.sends).toBe(1);
  });
  it('reuses the durable preparation when saving its inbox reference rolls back', async () => {
    const f = await setup(),
      e = await f.runtime.onSourceIndexed(f.first.event);
    await pool.query(
      "CREATE FUNCTION surfer_intake.fail_prepared() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected prepared ack'; END $$",
    );
    await pool.query(
      'CREATE TRIGGER fail_prepared BEFORE UPDATE ON surfer_intake.job FOR EACH ROW WHEN (OLD.prepared IS NULL AND NEW.prepared IS NOT NULL) EXECUTE FUNCTION surfer_intake.fail_prepared()',
    );
    try {
      await expect(f.worker.cycle(f.actual.request)).rejects.toThrow('injected prepared');
      expect(f.p.control.sends).toBe(0);
    } finally {
      await pool.query('DROP TRIGGER fail_prepared ON surfer_intake.job');
      await pool.query('DROP FUNCTION surfer_intake.fail_prepared()');
    }
    await expire(e.jobId!);
    expect((await f.worker.cycle(f.actual.request)).status).toBe('COMPLETED');
    expect(f.p.control.sends).toBe(1);
    const st = (
      await pool.query('SELECT payload FROM surfer_knowledge.space_state WHERE space_id=$1', [
        f.actual.projectId,
      ])
    ).rows[0].payload;
    expect(
      st.artifacts.filter((a: { domain: string }) => a.domain === 'surfer.document-work.v1'),
    ).toHaveLength(1);
  });
  it('reuses completed memory after final inbox acknowledgement failure and service reconstruction', async () => {
    const f = await setup(),
      e = await f.runtime.onSourceIndexed(f.first.event);
    await pool.query(
      "CREATE FUNCTION surfer_intake.fail_done() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected done ack'; END $$",
    );
    await pool.query(
      "CREATE TRIGGER fail_done BEFORE UPDATE ON surfer_intake.job FOR EACH ROW WHEN (NEW.state='COMPLETED') EXECUTE FUNCTION surfer_intake.fail_done()",
    );
    try {
      await expect(f.worker.cycle(f.actual.request)).rejects.toThrow('injected done');
      expect((await f.runtime.catalog(f.actual.request)).items).toHaveLength(1);
    } finally {
      await pool.query('DROP TRIGGER fail_done ON surfer_intake.job');
      await pool.query('DROP FUNCTION surfer_intake.fail_done()');
    }
    await expire(e.jobId!);
    const recovered = await createSurferApplicationRuntime(pool)
      .createIntakeWorker(f.options)
      .cycle(f.actual.request);
    expect(recovered).toMatchObject({ status: 'COMPLETED', replayed: true });
    expect(f.p.control.sends).toBe(1);
    await writeFile(
      root + '/recovery.json',
      JSON.stringify({
        completedMemoryPreserved: true,
        lostAckRecovery: true,
        replayedWithoutDispatch: true,
        contractGatewaySends: 1,
        modelCalls: 0,
      }),
    );
  });
  it('leaves an uncertain send blocked without re-dispatching it on later cycles', async () => {
    const f = await setup();
    await f.runtime.onSourceIndexed(f.first.event);
    f.p.control.generateError = true;
    expect(await f.worker.cycle(f.actual.request)).toMatchObject({
      status: 'BLOCKED',
      code: 'OUTCOME_UNKNOWN',
    });
    expect(await f.worker.cycle(f.actual.request)).toEqual({ status: 'EMPTY' });
    expect(f.p.control.sends).toBe(1);
  });
  it('allows only one unexpired project worker while the provider runs outside the claim transaction', async () => {
    const f = await setup();
    await f.runtime.onSourceIndexed(f.first.event);
    const next = await f.source(memoryData.cases[1]!);
    await f.runtime.onSourceIndexed(next.event);
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((r) => {
        entered = r;
      }),
      pause = new Promise<void>((r) => {
        release = r;
      }),
      gateway: SurferProviderGatewayPort = {
        ...f.p.gateway,
        prepare: async (b, r) => {
          const p = await f.p.gateway.prepare(b, r);
          return {
            ...p,
            generate: async (signal) => {
              entered();
              await pause;
              return p.generate(signal);
            },
          };
        },
      },
      worker = f.runtime.createIntakeWorker({ ...f.options, gateway }),
      first = worker.cycle(f.actual.request);
    await started;
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM surfer_intake.job WHERE project_id=$1 AND state='RUNNING'",
          [f.actual.projectId],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(await worker.cycle(f.actual.request)).toEqual({ status: 'EMPTY' });
    release();
    expect((await first).status).toBe('COMPLETED');
    f.p.response.rawText = next.f.response.rawText;
    expect((await f.worker.cycle(f.actual.request)).status).toBe('COMPLETED');
    expect(f.p.control.sends).toBe(2);
  });
  it('rechecks owner/project authority and preserves queue rows when access is revoked', async () => {
    const f = await setup();
    await f.runtime.onSourceIndexed(f.first.event);
    const other = await createSurferSourceFixture(pool, principalId);
    expect(await f.worker.cycle(other.request)).toEqual({ status: 'EMPTY' });
    await pool.query('UPDATE auth.project_memberships SET is_owner=false WHERE project_id=$1', [
      f.actual.projectId,
    ]);
    await expect(f.worker.cycle(f.actual.request)).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    expect(
      (
        await pool.query('SELECT state FROM surfer_intake.job WHERE project_id=$1', [
          f.actual.projectId,
        ])
      ).rows[0].state,
    ).toBe('READY');
    expect(f.p.control.sends).toBe(0);
  });
  it('verifies runtime-role enqueue/claim and rejects event/profile/history tampering with metadata-only image routing stub', async () => {
    const f = await setup(),
      client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE shotgun_runtime');
      await client.query(
        "INSERT INTO surfer_intake.job(job_id,request_id,project_id,source_id,source_version_id,revision_id,evidence_count,event_digest,revision,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,'READY')",
        [
          'intake:' + surferDigest(f.first.event).slice(7),
          surferDigest(f.first.event).slice(7),
          f.actual.projectId,
          f.first.event.sourceId,
          f.first.event.sourceVersionId,
          f.first.event.revisionId,
          f.first.event.evidenceCount,
          surferDigest(f.first.event),
        ],
      );
      await client.query('COMMIT');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    const rolePool = new Proxy(pool, {
      get(t, k) {
        if (k === 'connect')
          return async () => {
            const c = await t.connect();
            return new Proxy(c, {
              get(x, p) {
                if (p === 'query')
                  return async (sql: unknown, ...args: unknown[]) => {
                    const r = await (x.query as (...a: unknown[]) => Promise<unknown>)(
                      sql,
                      ...args,
                    );
                    if (typeof sql === 'string' && sql.startsWith('BEGIN'))
                      await x.query('SET LOCAL ROLE shotgun_runtime');
                    return r;
                  };
                const v = Reflect.get(x, p);
                return typeof v === 'function' ? v.bind(x) : v;
              },
            });
          };
        const v = Reflect.get(t, k);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
    const job = (await new PostgresSurferIntakeInbox(rolePool).claim(f.identity))!;
    await expect(
      pool.query('UPDATE surfer_intake.job SET source_id=$2,revision=revision+1 WHERE job_id=$1', [
        job.jobId,
        randomUUID(),
      ]),
    ).rejects.toThrow('immutable');
    await expect(
      pool.query(
        'UPDATE surfer_intake.job SET profile_digest=$2,revision=revision+1 WHERE job_id=$1',
        [job.jobId, surferDigest('changed')],
      ),
    ).rejects.toThrow('immutable');
    await expect(
      pool.query('UPDATE surfer_intake.transition SET payload=payload WHERE job_id=$1', [
        job.jobId,
      ]),
    ).rejects.toBeTruthy();
    await expect(
      f.runtime.onSourceIndexed({ ...f.first.event, sourceVersionId: randomUUID() }),
    ).rejects.toBeTruthy();
    const imagePool = new Proxy(pool, {
      get(t, k) {
        if (k === 'connect')
          return async () => {
            const c = await t.connect();
            return new Proxy(c, {
              get(x, p) {
                if (p === 'query')
                  return async (sql: unknown, ...args: unknown[]) =>
                    typeof sql === 'string' &&
                    sql.startsWith('SELECT p.state FROM evidence.stage4_continuations')
                      ? { rows: [{ state: 'IMAGE_OBSERVATION_COMPLETED' }], rowCount: 1 }
                      : (x.query as (...a: unknown[]) => Promise<unknown>)(sql, ...args);
                const v = Reflect.get(x, p);
                return typeof v === 'function' ? v.bind(x) : v;
              },
            });
          };
        const v = Reflect.get(t, k);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
    expect(await new PostgresSurferIntakeInbox(imagePool).enqueue(f.first.event)).toEqual({
      jobId: null,
      replayed: false,
    });
    expect(f.p.control.sends).toBe(0);
  });
});
