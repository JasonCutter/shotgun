import { fork } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { PostgresImageObservationExecutionRepository } from '../../adapters/image-observation-execution-postgres/src/index.js';
import {
  executeImageObservation,
  imageObservationTransformationIdentity,
  type ImageObservationExecutionInput,
  type ImageObservationExecutionRecord,
} from '../../modules/image-observation-execution/src/index.js';
import { sha256Text } from '../../packages/contracts/src/index.js';
import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';
import {
  fakeNativeImageExecutor,
  imageExecutionFixtureInput,
} from '../helpers/image-observation-execution-fixture.js';

async function setup() {
  // Real PostgreSQL test of migration134 and its exact AI execution boundary.
  // Existing SourceVersion/revision columns are minimized here; the actual app
  // integration separately verifies the full Canonical migrations and ACL.
  const db = await createIsolatedPostgresTestDatabase({ migrate: async () => {} });
  const pool = db.createPool();
  try {
    await pool.query(`CREATE SCHEMA ai; CREATE SCHEMA asset; CREATE SCHEMA transformation;
    CREATE TABLE asset.original_assets(asset_id uuid PRIMARY KEY, content_hash text NOT NULL);
    CREATE TABLE asset.sources(source_id uuid PRIMARY KEY,project_id text NOT NULL);
    CREATE TABLE asset.source_versions(source_version_id uuid PRIMARY KEY,source_id uuid NOT NULL REFERENCES asset.sources,
      original_asset_id uuid NOT NULL REFERENCES asset.original_assets,media_type text NOT NULL,version_number integer NOT NULL,access_scope text[] NOT NULL,sensitivity text NOT NULL);
    CREATE TABLE transformation.revisions(revision_id uuid PRIMARY KEY,project_id text NOT NULL,source_id uuid NOT NULL,source_version_id uuid NOT NULL,
      source_content_hash text NOT NULL,transformer_id text NOT NULL,transformer_version text NOT NULL,document_ir jsonb NOT NULL,source_map jsonb NOT NULL);
    CREATE TABLE public.fake_image_egress(event_id bigserial PRIMARY KEY,call_id uuid NOT NULL,request_body text NOT NULL);
    CREATE SCHEMA vp;
    CREATE TABLE vp.image_observations(project_id text NOT NULL,call_id uuid NOT NULL,attempt_id uuid NOT NULL);`);
    await pool.query(
      await readFile(
        new URL('../../db/migrations/134_image_observation_execution.sql', import.meta.url),
        'utf8',
      ),
    );
    const input = imageExecutionFixtureInput();
    await pool.query('INSERT INTO asset.original_assets VALUES($1,$2)', [
      input.originalAssetId,
      input.sourceContentHash,
    ]);
    await pool.query('INSERT INTO asset.sources VALUES($1,$2)', [input.sourceId, input.projectId]);
    await pool.query('INSERT INTO asset.source_versions VALUES($1,$2,$3,$4,1,$5,$6)', [
      input.sourceVersionId,
      input.sourceId,
      input.originalAssetId,
      input.image.mediaType,
      input.accessScope,
      input.sensitivity,
    ]);
    return { db, pool, input, repository: new PostgresImageObservationExecutionRepository(pool) };
  } catch (error) {
    await db.dispose();
    throw error;
  }
}

async function annotation(
  pool: Pool,
  record: ImageObservationExecutionRecord,
  text = record.output!.text,
  origin = 'annotation',
  useBaseIdentity = false,
): Promise<string> {
  const id = randomUUID(),
    pin = record.snapshot;
  const transformer = useBaseIdentity
    ? { id: pin.transformerId, version: pin.transformerVersion }
    : imageObservationTransformationIdentity(record);
  await pool.query(
    `INSERT INTO transformation.revisions VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)`,
    [
      id,
      pin.projectId,
      pin.sourceId,
      pin.sourceVersionId,
      pin.sourceContentHash,
      transformer.id,
      transformer.version,
      JSON.stringify({ schemaVersion: '1.0.0', mediaType: pin.image.mediaType, blocks: [] }),
      JSON.stringify({
        schemaVersion: '1.0.0',
        entries: [
          { nodeKind: 'document', origin, quote: { type: 'TextQuoteSelector', exact: text } },
        ],
      }),
    ],
  );
  return id;
}

const options = (
  repository: PostgresImageObservationExecutionRepository,
  onEgress?: (init: RequestInit) => Promise<void>,
) => ({
  runtimeProfile: 'runtime-test',
  repository,
  resolver: { resolve: async () => fakeNativeImageExecutor(onEgress) },
});

function child(databaseUrl: string) {
  const messages: { type: string; state?: string; callId?: string; message?: string }[] = [];
  const processChild = fork(
    fileURLToPath(new URL('../fixtures/image-observation-execution-race.ts', import.meta.url)),
    [],
    {
      env: { ...process.env, TEST_DATABASE_URL: databaseUrl },
      execArgv: ['--import', 'tsx'],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  );
  let output = '';
  processChild.stdout!.on('data', (bytes: Buffer) => {
    output += bytes.toString();
  });
  processChild.stderr!.on('data', (bytes: Buffer) => {
    output += bytes.toString();
  });
  processChild.on('message', (message) => messages.push(message as (typeof messages)[number]));
  const ready = new Promise<void>((resolve, reject) => {
    processChild.on('message', (message: unknown) => {
      if ((message as { type: string }).type === 'ready') resolve();
    });
    processChild.once('error', reject);
    processChild.once('exit', (code) => {
      if (!messages.some((message) => message.type === 'ready'))
        reject(Error(`Image race startup failed ${code}: ${output}`));
    });
  });
  const exit = new Promise<number | null>((resolve, reject) => {
    processChild.once('error', reject);
    processChild.once('exit', resolve);
  });
  return { processChild, messages, ready, exit, output: () => output };
}
const send = (
  target: ReturnType<typeof child>,
  input: ImageObservationExecutionInput,
  crashAfterEgress = false,
) =>
  target.processChild.send({
    type: 'execute',
    input: { ...input, imageBytes: [...input.imageBytes] },
    crashAfterEgress,
  });

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  'isolated image durable execution PostgreSQL',
  () => {
    it('persists distinct accepted-live transport authority and rejects Fake replay', async () => {
      const f = await setup();
      try {
        let observed = 0;
        const captured = fakeNativeImageExecutor(async () => {
          observed += 1;
        });
        Object.assign(captured, {
          transportKind: 'ISOLATED_LIVE_ACCEPTANCE',
          liveCapable: true,
        });
        const grant = {
          acceptanceId: 'isolated-image-pg-acceptance',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          sourceContentHash: f.input.sourceContentHash,
          credentialFingerprint: captured.credentialFingerprint,
          authorize: async () => {},
        };
        const result = await executeImageObservation(f.input, {
          runtimeProfile: 'runtime-test',
          repository: f.repository,
          resolver: { resolve: async () => captured },
          liveAcceptance: grant,
        });
        expect(result.state).toBe('OUTPUT_STORED');
        expect(observed).toBe(1);
        expect(await f.repository.read(f.input.projectId, f.input.requestId)).toMatchObject({
          transportKind: 'ISOLATED_LIVE_ACCEPTANCE',
          acceptanceId: grant.acceptanceId,
        });
        await expect(executeImageObservation(f.input, options(f.repository))).rejects.toThrow();
        expect(observed).toBe(1);
      } finally {
        await f.db.dispose();
      }
    });
    it('retains a known rejected native Fake response and holds it across repository restart without publication', async () => {
      const f = await setup();
      try {
        const rawText = '{"observationText":"Authored rejected Fake output","fact":true}';
        let calls = 0;
        const captured = fakeNativeImageExecutor(async () => {
          calls++;
        }, rawText);
        const result = await executeImageObservation(f.input, {
          runtimeProfile: 'runtime-test',
          repository: f.repository,
          resolver: { resolve: async () => captured },
        });
        expect(result.state).toBe('OUTPUT_REJECTED');
        expect(result.rejectedResponse).toMatchObject({
          rawText,
          rawLength: rawText.length,
          responseDigest: sha256Text(rawText),
          truncated: false,
        });
        const rebuilt = new PostgresImageObservationExecutionRepository(f.db.createPool());
        expect(
          (
            await executeImageObservation(
              f.input,
              options(rebuilt, async () => {
                calls++;
              }),
            )
          ).rejectedResponse,
        ).toEqual(result.rejectedResponse);
        expect(
          await rebuilt.findCompleted({
            projectId: f.input.projectId,
            callId: result.callId,
            attemptId: result.attemptId!,
          }),
        ).toBeUndefined();
        expect(calls).toBe(1);
        expect(
          (await f.pool.query('SELECT rejected_response_json FROM ai.image_observation_executions'))
            .rows[0]?.rejected_response_json.rawText,
        ).toBe(rawText);
      } finally {
        await f.db.dispose();
      }
    }, 30_000);
    it('rejected output ACK loss reuses the exact saved audit and cannot replace it with another outcome', async () => {
      const f = await setup();
      try {
        class LostRejectionAck extends PostgresImageObservationExecutionRepository {
          async rejectOutput(
            ...args: Parameters<PostgresImageObservationExecutionRepository['rejectOutput']>
          ) {
            await super.rejectOutput(...args);
            throw Error('Synthetic committed rejection ACK loss');
          }
        }
        let calls = 0;
        const captured = fakeNativeImageExecutor(async () => {
          calls++;
        }, '{"unexpected":"synthetic"}');
        const result = await executeImageObservation(f.input, {
          runtimeProfile: 'runtime-test',
          repository: new LostRejectionAck(f.pool),
          resolver: { resolve: async () => captured },
        });
        expect(result.state).toBe('OUTPUT_REJECTED');
        const audit = result.rejectedResponse!;
        const restarted = new PostgresImageObservationExecutionRepository(f.db.createPool());
        await expect(
          restarted.rejectOutput(f.input.projectId, result.callId, result.attemptId!, audit),
        ).resolves.toBeUndefined();
        await expect(
          restarted.rejectOutput(f.input.projectId, result.callId, result.attemptId!, {
            ...audit,
            responseDigest: sha256Text('different audit'),
          }),
        ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        await expect(
          restarted.rejectOutput(f.input.projectId, result.callId, randomUUID(), audit),
        ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        const replay = await executeImageObservation(
          f.input,
          options(restarted, async () => {
            calls++;
          }),
        );
        expect(replay.rejectedResponse).toEqual(audit);
        expect(replay.attemptId).toBe(result.attemptId);
        expect(calls).toBe(1);
        expect(
          await restarted.findCompleted({
            projectId: f.input.projectId,
            callId: result.callId,
            attemptId: result.attemptId!,
          }),
        ).toBeUndefined();
      } finally {
        await f.db.dispose();
      }
    }, 30_000);
    it('binds exact native Fake HTTP hashes, preserves generated annotation finalization, and reuses after repository restart', async () => {
      const f = await setup();
      try {
        let calls = 0,
          requestBody = '';
        const record = await executeImageObservation(
          f.input,
          options(f.repository, async (init) => {
            calls++;
            requestBody = String(init.body);
          }),
        );
        expect(record.state).toBe('OUTPUT_STORED');
        expect(record.output?.transportRequestDigest).toBe(
          `sha256:${createHash('sha256').update(requestBody).digest('hex')}`,
        );
        expect(record.output?.responseDigest).toBe(sha256Text(record.output!.rawText));
        expect(
          await f.repository.findCompleted({
            projectId: f.input.projectId,
            callId: record.callId,
            attemptId: record.attemptId!,
          }),
        ).toBeUndefined();
        const rebuilt = new PostgresImageObservationExecutionRepository(f.db.createPool());
        expect(
          (
            await executeImageObservation(
              f.input,
              options(rebuilt, async () => {
                calls++;
              }),
            )
          ).callId,
        ).toBe(record.callId);
        expect(calls).toBe(1);
        for (const bad of [
          await annotation(f.pool, record, 'different generated text'),
          await annotation(f.pool, record, record.output!.text, 'source'),
          await annotation(f.pool, record, record.output!.text, 'annotation', true),
        ])
          await expect(
            rebuilt.finalize({
              projectId: f.input.projectId,
              callId: record.callId,
              attemptId: record.attemptId!,
              transformationRevisionId: bad,
            }),
          ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        const revisionId = await annotation(f.pool, record);
        const done = await rebuilt.finalize({
          projectId: f.input.projectId,
          callId: record.callId,
          attemptId: record.attemptId!,
          transformationRevisionId: revisionId,
        });
        expect(done.state).toBe('COMPLETED');
        expect(
          (
            await rebuilt.finalize({
              projectId: f.input.projectId,
              callId: record.callId,
              attemptId: record.attemptId!,
              transformationRevisionId: revisionId,
            })
          ).callId,
        ).toBe(record.callId);
        const proof = await rebuilt.findCompleted({
          projectId: f.input.projectId,
          callId: record.callId,
          attemptId: record.attemptId!,
        });
        expect(proof).toMatchObject({
          text: record.output!.text,
          derivation: {
            callId: record.callId,
            attemptId: record.attemptId,
            transformationRevisionId: revisionId,
            transportRequestDigest: record.output!.transportRequestDigest,
          },
        });
        expect(
          await rebuilt.findCompleted({
            projectId: 'other-project',
            callId: record.callId,
            attemptId: record.attemptId!,
          }),
        ).toBeUndefined();
        expect(calls).toBe(1);
      } finally {
        await f.db.dispose();
      }
    }, 30_000);

    it('activation ACK loss preserves exactly one durable unknown attempt with zero provider calls', async () => {
      const f = await setup();
      try {
        class LostActivationAck extends PostgresImageObservationExecutionRepository {
          async activate(
            ...args: Parameters<PostgresImageObservationExecutionRepository['activate']>
          ): Promise<boolean> {
            await super.activate(...args);
            throw Error('synthetic committed activation ACK loss');
          }
        }
        let calls = 0;
        const result = await executeImageObservation(
          f.input,
          options(new LostActivationAck(f.pool), async () => {
            calls++;
          }),
        );
        expect(result.state).toBe('OUTCOME_UNKNOWN');
        expect(
          (
            await executeImageObservation(
              f.input,
              options(
                new PostgresImageObservationExecutionRepository(f.db.createPool()),
                async () => {
                  calls++;
                },
              ),
            )
          ).attemptId,
        ).toBe(result.attemptId);
        expect(calls).toBe(0);
        expect(
          (
            await f.pool.query(
              'SELECT count(*)::int AS count FROM ai.image_observation_executions WHERE attempt_id IS NOT NULL',
            )
          ).rows[0]?.count,
        ).toBe(1);
      } finally {
        await f.db.dispose();
      }
    }, 30_000);

    it('output and finalization ACK loss read back exact persisted state without another provider call', async () => {
      const f = await setup();
      try {
        class LostOutputAck extends PostgresImageObservationExecutionRepository {
          async storeOutput(
            ...args: Parameters<PostgresImageObservationExecutionRepository['storeOutput']>
          ) {
            await super.storeOutput(...args);
            throw Error('synthetic committed output ACK loss');
          }
        }
        let calls = 0;
        const output = await executeImageObservation(
          f.input,
          options(new LostOutputAck(f.pool), async () => {
            calls++;
          }),
        );
        expect(output.state).toBe('OUTPUT_STORED');
        const revision = await annotation(f.pool, output);
        class LostFinalizationAck extends PostgresImageObservationExecutionRepository {
          async finalize(
            input: Parameters<PostgresImageObservationExecutionRepository['finalize']>[0],
          ): Promise<ImageObservationExecutionRecord> {
            await super.finalize(input);
            throw Error('synthetic committed finalize ACK loss');
          }
        }
        const binding = {
          projectId: f.input.projectId,
          callId: output.callId,
          attemptId: output.attemptId!,
          transformationRevisionId: revision,
        };
        await expect(new LostFinalizationAck(f.pool).finalize(binding)).rejects.toThrow('ACK loss');
        expect((await f.repository.finalize(binding)).state).toBe('COMPLETED');
        expect(
          (
            await executeImageObservation(
              f.input,
              options(f.repository, async () => {
                calls++;
              }),
            )
          ).state,
        ).toBe('COMPLETED');
        expect(calls).toBe(1);
      } finally {
        await f.db.dispose();
      }
    }, 30_000);

    it('crash after durable activation before egress is explicitly unknown after restart without dispatch', async () => {
      const f = await setup();
      try {
        class StopBeforeActivation extends PostgresImageObservationExecutionRepository {
          async activate(): Promise<boolean> {
            throw Error('synthetic crash before local activation');
          }
        }
        await expect(
          executeImageObservation(f.input, options(new StopBeforeActivation(f.pool))),
        ).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
        const prepared = (await f.repository.read(f.input.projectId, f.input.requestId))!;
        expect(prepared.state).toBe('REQUESTED');
        expect(prepared.attemptId).toBeUndefined();
        const attemptId = randomUUID();
        expect(await f.repository.activate(f.input.projectId, prepared.callId, attemptId)).toBe(
          true,
        );
        let calls = 0;
        const recovered = await executeImageObservation(
          f.input,
          options(new PostgresImageObservationExecutionRepository(f.db.createPool()), async () => {
            calls++;
          }),
        );
        expect(recovered.state).toBe('OUTCOME_UNKNOWN');
        expect((await f.repository.read(f.input.projectId, f.input.requestId))?.state).toBe(
          'OUTCOME_UNKNOWN',
        );
        expect(recovered.attemptId).toBe(attemptId);
        expect(calls).toBe(0);
        expect(await f.repository.activate(f.input.projectId, prepared.callId, randomUUID())).toBe(
          false,
        );
      } finally {
        await f.db.dispose();
      }
    }, 30_000);

    it('separate processes cannot activate two image calls for the same durable request', async () => {
      const f = await setup();
      const workers = [child(f.db.databaseUrl), child(f.db.databaseUrl)];
      try {
        await Promise.all(workers.map((worker) => worker.ready));
        for (const worker of workers) send(worker, f.input);
        const codes = await Promise.all(workers.map((worker) => worker.exit));
        expect(codes, workers.map((worker) => worker.output()).join('\n')).toEqual([0, 0]);
        expect(
          workers
            .flatMap((worker) => worker.messages)
            .filter((message) => message.type === 'failure'),
        ).toEqual([]);
        const result = (await f.repository.read(f.input.projectId, f.input.requestId))!;
        expect(result.state).toBe('OUTPUT_STORED');
        expect(
          (await f.pool.query('SELECT count(*)::int AS count FROM public.fake_image_egress'))
            .rows[0]?.count,
        ).toBe(1);
        expect(
          workers
            .flatMap((worker) => worker.messages)
            .filter((message) => message.type === 'result')
            .every((message) => message.callId === result.callId),
        ).toBe(true);
        expect(
          (await f.pool.query('SELECT count(*)::int AS count FROM ai.image_observation_executions'))
            .rows[0]?.count,
        ).toBe(1);
      } finally {
        for (const worker of workers)
          if (worker.processChild.exitCode === null && worker.processChild.signalCode === null)
            worker.processChild.kill();
        await f.db.dispose();
      }
    }, 45_000);

    it('actual process crash after Fake egress before response persistence holds UNKNOWN without another request', async () => {
      const f = await setup(),
        worker = child(f.db.databaseUrl);
      try {
        await worker.ready;
        send(worker, f.input, true);
        expect(await worker.exit, worker.output()).toBe(17);
        expect((await f.repository.read(f.input.projectId, f.input.requestId))?.state).toBe(
          'PROVIDER_RUNNING',
        );
        let restartedCalls = 0;
        const recovered = await executeImageObservation(
          f.input,
          options(new PostgresImageObservationExecutionRepository(f.db.createPool()), async () => {
            restartedCalls++;
          }),
        );
        expect(recovered.state).toBe('OUTCOME_UNKNOWN');
        expect(restartedCalls).toBe(0);
        expect(
          (await f.pool.query('SELECT count(*)::int AS count FROM public.fake_image_egress'))
            .rows[0]?.count,
        ).toBe(1);
        expect(
          await f.repository.findCompleted({
            projectId: f.input.projectId,
            callId: recovered.callId,
            attemptId: recovered.attemptId!,
          }),
        ).toBeUndefined();
      } finally {
        if (worker.processChild.exitCode === null && worker.processChild.signalCode === null)
          worker.processChild.kill();
        await f.db.dispose();
      }
    }, 45_000);
  },
);
