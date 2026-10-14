import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'pg';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { createImageObservationRuntime } from '../../assemblies/shotgun-app/src/image-observation-runtime.js';
import { PostgresImageObservationExecutionRepository } from '../../adapters/image-observation-execution-postgres/src/index.js';
import { PostgresVPImageObservationLedger } from '../../adapters/vp-knowledge-postgres/src/image-observations.js';
import {
  PostgresTransformationRepository,
  PostgresEvidenceRepository,
} from '../../adapters/postgres-stage3/src/index.js';
import {
  PostgresSourcesStage3ProgressRepository,
  PostgresSourcesStage3AtomicPersistence,
} from '../../adapters/postgres-stage3/src/runtime-data-integrity.js';
import { createProductionStage3Pipeline } from '../../adapters/sources-stage3-pipeline/src/index.js';
import { PythonDocumentFormatAdapter } from '../../adapters/document-format-python/src/index.js';
import { LucasAugmentedPlainTextAdapter } from '../../adapters/plain-text-lucas-augmented/src/index.js';
import { InMemoryAssetStorage } from '../../adapters/stage2-in-memory/src/index.js';
import {
  createIsolatedPostgresTestDatabase,
  type IsolatedPostgresTestDatabase,
} from '../helpers/isolated-postgres-test-database.js';
import { fakeNativeImageExecutor } from '../helpers/image-observation-execution-fixture.js';
import { migrateUpTo } from '../../scripts/database.js';

let database: IsolatedPostgresTestDatabase, pool: Pool;
describe('actual Source image readiness uses typed VP observation instead of empty source Evidence', () => {
  beforeAll(async () => {
    database = await createIsolatedPostgresTestDatabase({
      migrate: (url) => migrateUpTo('136_source_image_observation_readiness.sql', url),
    });
    pool = database.createPool();
    await pool.query('SELECT 1');
  }, 60_000);
  afterAll(async () => {
    await database?.dispose();
  });
  async function fixture(unknown = false, progressPool = pool) {
    const sourceId = randomUUID(),
      sourceVersionId = randomUUID(),
      projectId = `source-image-${randomUUID()}`;
    const storage = new InMemoryAssetStorage(),
      bytes = await readFile(path.resolve('tests/fixtures/stage-8/golden.png'));
    const contentHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      storageKey = await storage.put(contentHash, bytes);
    await pool.query(
      `INSERT INTO project_admin.projects(id,name,status,active,created_at,updated_at,revision) VALUES($1,'Image readiness test','ACTIVE',true,now(),now(),1)`,
      [projectId],
    );
    const asset = await pool.query<{ asset_id: string }>(
      `INSERT INTO asset.original_assets(asset_id,content_hash,size_bytes,storage_key,created_at) VALUES($1,$2,$3,$4,now())
      ON CONFLICT(content_hash) DO UPDATE SET content_hash=EXCLUDED.content_hash RETURNING asset_id::text`,
      [randomUUID(), contentHash, bytes.length, storageKey],
    );
    await pool.query(
      `INSERT INTO asset.sources(source_id,project_id,created_by_actor_id,created_at) VALUES($1,$2,'fake-owner',now())`,
      [sourceId, projectId],
    );
    await pool.query(
      `INSERT INTO asset.source_versions(source_version_id,source_id,version_number,original_asset_id,media_type,access_scope,sensitivity,created_at)
      VALUES($1,$2,1,$3,'image/png','{owner}','private',now())`,
      [sourceVersionId, sourceId, asset.rows[0]!.asset_id],
    );
    const input = {
      projectId,
      sourceId,
      sourceVersionId,
      storageKey,
      mediaType: 'image/png' as const,
      contentHash,
      accessScope: ['owner'],
      sensitivity: 'private' as const,
    };
    let calls = 0;
    const native = fakeNativeImageExecutor(async () => {
      calls += 1;
      if (unknown) throw new Error('authored unknown fake provider outcome');
    });
    const execution = new PostgresImageObservationExecutionRepository(pool),
      transformations = new PostgresTransformationRepository(pool);
    const ledger = new PostgresVPImageObservationLedger(pool, execution);
    const image = createImageObservationRuntime({
      runtimeProfile: 'runtime-test',
      pool,
      storage,
      authorizeSourceInput: async () => {},
      imageExecutionResolver: { resolve: async () => native },
      transformationRepository: transformations,
      ledger,
    });
    const progress = new PostgresSourcesStage3ProgressRepository(progressPool),
      stage4 = vi.fn(async () => {});
    const pipeline = createProductionStage3Pipeline({
      storage,
      transformer: new PythonDocumentFormatAdapter(),
      locator: new LucasAugmentedPlainTextAdapter(),
      transformationRepository: transformations,
      evidenceRepository: new PostgresEvidenceRepository(pool),
      progress,
      atomicPersistence: new PostgresSourcesStage3AtomicPersistence(pool),
      stage4: { onEvidenceIndexed: stage4 },
      imageObservationPipeline: image,
    });
    return { input, image, pipeline, progress, ledger, stage4, calls: () => calls };
  }
  it('completes one Fake call through actual assembly/pipeline/PG, stores no Evidence indexing, and reuses readiness after restart', async () => {
    const f = await fixture(),
      result = await f.pipeline.runForSourceVersion(f.input);
    expect(result.status).toBe('IMAGE_OBSERVATION_COMPLETED');
    const progress = (
      await pool.query(
        `SELECT state,indexing_result_id,image_observation_id::text,attempt_count FROM source_product.source_stage3_progress WHERE project_id=$1`,
        [f.input.projectId],
      )
    ).rows[0];
    expect(progress).toMatchObject({
      state: 'IMAGE_OBSERVATION_COMPLETED',
      indexing_result_id: null,
      attempt_count: 1,
    });
    expect('imageObservation' in result ? result.imageObservation.observationId : undefined).toBe(
      progress.image_observation_id,
    );
    expect(f.calls()).toBe(1);
    expect(f.stage4).not.toHaveBeenCalled();
    for (const table of [
      'evidence.spans',
      'evidence.indexing_results',
      'evidence.stage4_continuations',
      'vp.assertions',
      'candidate.claim_candidates',
    ]) {
      expect(
        (
          await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE project_id=$1`, [
            f.input.projectId,
          ])
        ).rows[0].n,
      ).toBe(0);
    }
    expect(
      (
        await pool.query(`SELECT state FROM ai.image_observation_executions WHERE project_id=$1`, [
          f.input.projectId,
        ])
      ).rows,
    ).toEqual([{ state: 'COMPLETED' }]);
    expect((await f.pipeline.runForSourceVersion(f.input)).status).toBe(
      'IMAGE_OBSERVATION_COMPLETED',
    );
    const restarted = new PostgresSourcesStage3ProgressRepository(pool);
    expect(
      await restarted.claim({ ...f.input, workerId: 'restarted', leaseDurationMs: 30_000 }),
    ).toMatchObject({
      status: 'COMPLETED',
      state: 'IMAGE_OBSERVATION_COMPLETED',
      observationId: progress.image_observation_id,
    });
    expect(f.calls()).toBe(1);
    expect(
      await f.ledger.listCurrent({
        projectId: f.input.projectId,
        accessScope: ['owner'],
        authorizedSensitivities: ['private'],
      }),
    ).toHaveLength(1);
  });
  it('rejects an unbound observation, wrong revision and stale fencing token; exact finalization is idempotent', async () => {
    const f = await fixture();
    await f.progress.ensureMaterialized(f.input);
    const claimed = await f.progress.claim({
      ...f.input,
      workerId: 'test',
      leaseDurationMs: 30_000,
    });
    if (claimed.status !== 'CLAIMED') throw new Error('expected actual Source lease');
    const observation = await f.image.runForSourceVersion(f.input);
    await expect(
      f.progress.finalizeImageObservation({
        lease: claimed.lease,
        observationId: randomUUID(),
        revisionId: observation.revisionId,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      f.progress.finalizeImageObservation({
        lease: claimed.lease,
        observationId: observation.observationId,
        revisionId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const finalize = {
      lease: claimed.lease,
      observationId: observation.observationId,
      revisionId: observation.revisionId,
    };
    await f.progress.finalizeImageObservation(finalize);
    await f.progress.finalizeImageObservation(finalize);
    await expect(
      f.progress.finalizeImageObservation({
        ...finalize,
        lease: { ...claimed.lease, fencingToken: claimed.lease.fencingToken + 1 },
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(f.calls()).toBe(1);
  });
  it('unknown provider outcome is reconciliation-required, excluded from recovery, and never repeated', async () => {
    const f = await fixture(true);
    await expect(f.pipeline.runForSourceVersion(f.input)).rejects.toMatchObject({
      code: 'OUTCOME_UNKNOWN',
      retryable: false,
    });
    expect(
      (
        await pool.query(
          `SELECT state,indexing_result_id,image_observation_id,safe_failure_code FROM source_product.source_stage3_progress WHERE project_id=$1`,
          [f.input.projectId],
        )
      ).rows[0],
    ).toEqual({
      state: 'RECONCILIATION_REQUIRED',
      indexing_result_id: null,
      image_observation_id: null,
      safe_failure_code: 'OUTCOME_UNKNOWN',
    });
    expect(
      (await f.progress.findRecoverable()).some(
        (row) => row.sourceVersionId === f.input.sourceVersionId,
      ),
    ).toBe(false);
    await expect(f.pipeline.runForSourceVersion(f.input)).rejects.toThrow(
      'requires reconciliation',
    );
    expect(f.calls()).toBe(1);
    expect(f.stage4).not.toHaveBeenCalled();
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS n FROM vp.image_observations WHERE project_id=$1`,
          [f.input.projectId],
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it('readback resolves a lost image-readiness update ACK without another call or fabricated success event', async () => {
    let lost = false;
    const ackPool = {
      query: async (sql: string, values?: unknown[]) => {
        const result = await pool.query(sql, values);
        if (!lost && sql.includes("SET state='IMAGE_OBSERVATION_COMPLETED'")) {
          lost = true;
          throw new Error('authored update ACK lost');
        }
        return result;
      },
      connect: () => pool.connect(),
    } as unknown as Pool;
    const f = await fixture(false, ackPool);
    expect((await f.pipeline.runForSourceVersion(f.input)).status).toBe(
      'IMAGE_OBSERVATION_COMPLETED',
    );
    expect(lost).toBe(true);
    expect(f.calls()).toBe(1);
    expect(f.stage4).not.toHaveBeenCalled();
  });
  it('a completed image binding cannot be replaced or reopened through direct SQL', async () => {
    const f = await fixture();
    await f.pipeline.runForSourceVersion(f.input);
    await expect(
      pool.query(
        `UPDATE source_product.source_stage3_progress SET state='STAGE3_RETRYABLE' WHERE project_id=$1`,
        [f.input.projectId],
      ),
    ).rejects.toThrow('Invalid Source Stage3 transition');
    await expect(
      pool.query(
        `UPDATE source_product.source_stage3_progress SET image_observation_id=$2 WHERE project_id=$1`,
        [f.input.projectId, randomUUID()],
      ),
    ).rejects.toThrow('immutable');
  });
});
