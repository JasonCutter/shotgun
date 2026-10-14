import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PythonDocumentFormatAdapter } from '../../adapters/document-format-python/src/index.js';
import { PostgresTransformationRepository } from '../../adapters/postgres-stage3/src/index.js';
import { PostgresVPImageObservationLedger } from '../../adapters/vp-knowledge-postgres/src/image-observations.js';
import { sha256Text } from '../../packages/contracts/src/index.js';
import {
  imageObservationDerivationProof,
  type VPImageObservationDerivationProofV1,
} from '../../packages/contracts/src/vp-image-observation.js';
import { migrateUpTo } from '../../scripts/database.js';
import {
  createIsolatedPostgresTestDatabase,
  type IsolatedPostgresTestDatabase,
} from '../helpers/isolated-postgres-test-database.js';
import { imageObservationFixture } from '../helpers/vp-image-observation.js';

let database: IsolatedPostgresTestDatabase;
let pool: Pool;
const proofs = new Map<string, VPImageObservationDerivationProofV1>();
let ledger: PostgresVPImageObservationLedger;

describe('typed generated image observations on actual isolated PostgreSQL', () => {
  beforeAll(async () => {
    database = await createIsolatedPostgresTestDatabase({
      migrate: (url) => migrateUpTo('133_vp_image_observations.sql', url),
    });
    pool = database.createPool();
    ledger = new PostgresVPImageObservationLedger(pool, {
      findCompleted: async (input) => {
        const proof = proofs.get(input.callId);
        return proof?.projectId === input.projectId &&
          proof.derivation.attemptId === input.attemptId
          ? proof
          : undefined;
      },
    });
  }, 60_000);
  afterAll(async () => {
    await database?.dispose();
  });

  async function fixture(projectId?: string, text?: string) {
    const original = {
      ...imageObservationFixture(),
      ...(projectId ? { projectId } : {}),
      ...(text ? { text } : {}),
    };
    const bytes = await readFile(path.resolve('tests/fixtures/stage-8/golden.png'));
    const observation = {
      ...original,
      sourceContentHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    };
    await pool.query(
      `INSERT INTO project_admin.projects(id,name,status,active,created_at,updated_at,revision)
      VALUES($1,'Isolated fake image','ACTIVE',true,now(),now(),1) ON CONFLICT(id) DO NOTHING`,
      [observation.projectId],
    );
    await pool
      .query(
        `INSERT INTO asset.original_assets(asset_id,content_hash,size_bytes,storage_key,created_at)
      VALUES($1,$2,$3,$4,now()) ON CONFLICT(content_hash) DO UPDATE SET content_hash=EXCLUDED.content_hash RETURNING asset_id::text`,
        [
          observation.originalAssetId,
          observation.sourceContentHash,
          bytes.length,
          `image-${randomUUID()}`,
        ],
      )
      .then((result) => {
        observation.originalAssetId = result.rows[0].asset_id;
      });
    await pool.query(
      `INSERT INTO asset.sources(source_id,project_id,created_by_actor_id,created_at) VALUES($1,$2,'fake-owner',now())`,
      [observation.sourceId, observation.projectId],
    );
    await pool.query(
      `INSERT INTO asset.source_versions(source_version_id,source_id,version_number,original_asset_id,media_type,access_scope,sensitivity,created_at)
      VALUES($1,$2,1,$3,'image/png','{owner}','private',now())`,
      [observation.sourceVersionId, observation.sourceId, observation.originalAssetId],
    );
    const transformer = new PythonDocumentFormatAdapter({
      pythonExecutable: process.env.PYTHON ?? 'python',
      multimodal: { describe: async () => observation.text },
    });
    const output = await transformer.transform({
      sourceId: observation.sourceId,
      sourceVersionId: observation.sourceVersionId,
      sourceContentHash: observation.sourceContentHash,
      mediaType: 'image/png',
      contentBase64: bytes.toString('base64'),
    });
    const saved = await new PostgresTransformationRepository(pool).save({
      projectId: observation.projectId,
      sourceId: observation.sourceId,
      sourceVersionId: observation.sourceVersionId,
      sourceContentHash: observation.sourceContentHash,
      transformer: transformer.identity,
      output,
      accessScope: ['owner'],
      sensitivity: 'private',
      createdAt: observation.createdAt,
    });
    observation.derivation = {
      ...observation.derivation,
      transformationRevisionId: saved.revision.revisionId,
    };
    proofs.set(observation.derivation.callId, imageObservationDerivationProof(observation));
    return observation;
  }
  const scope = (projectId: string) => ({
    projectId,
    accessScope: ['owner'],
    authorizedSensitivities: ['private'] as const,
  });
  async function nextVersion(
    observation: Awaited<ReturnType<typeof fixture>>,
    accessScope = ['owner'],
    sensitivity = 'private',
  ) {
    const assetId = randomUUID(),
      versionId = randomUUID();
    await pool.query(
      `INSERT INTO asset.original_assets(asset_id,content_hash,size_bytes,storage_key,created_at) VALUES($1,$2,10,$3,now())`,
      [assetId, sha256Text(assetId), `image-next-${assetId}`],
    );
    await pool.query(
      `INSERT INTO asset.source_versions(source_version_id,source_id,version_number,original_asset_id,media_type,access_scope,sensitivity,created_at)
      VALUES($1,$2,2,$3,'image/png',$4,$5,now())`,
      [versionId, observation.sourceId, assetId, accessScope, sensitivity],
    );
    return versionId;
  }

  it('selects a query-relevant later image beyond the first twelve and returns no unrelated generated context', async () => {
    const projectId = `image-query-${randomUUID()}`;
    for (let index = 0; index < 13; index += 1) {
      await ledger.append(await fixture(projectId, `Cotton orchard texture sample ${index}.`));
    }
    const later = await fixture(projectId, 'The neptune turbine diagram describes the rotor.');
    await ledger.append(later);
    expect(
      await ledger.listCurrent({ ...scope(projectId), limit: 12, question: 'neptune turbine' }),
    ).toEqual([later]);
    expect(
      await ledger.listCurrent({ ...scope(projectId), limit: 12, question: 'xylophone zebras' }),
    ).toEqual([]);
  }, 60_000);

  it('appends once, increments the existing epoch once, and creates no source Evidence/Claim/Fact', async () => {
    const observation = await fixture();
    expect(await ledger.append(observation)).toEqual({ observation, reused: false });
    expect(await ledger.append(observation)).toEqual({ observation, reused: true });
    expect(await ledger.listCurrent(scope(observation.projectId))).toEqual([observation]);
    expect(
      await ledger.findHistorical(scope(observation.projectId), observation.observationId),
    ).toEqual(observation);
    expect(
      (
        await pool.query(`SELECT current_epoch::text FROM vp.project_epochs WHERE project_id=$1`, [
          observation.projectId,
        ])
      ).rows[0].current_epoch,
    ).toBe('1');
    for (const table of ['evidence.spans', 'vp.assertions', 'vp.relations']) {
      expect(
        (
          await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE project_id=$1`, [
            observation.projectId,
          ])
        ).rows[0].n,
      ).toBe(0);
    }
  });
  it('rejects missing/UNKNOWN or mismatching durable derivation proof before publication', async () => {
    const observation = await fixture();
    proofs.delete(observation.derivation.callId);
    await expect(ledger.append(observation)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    proofs.set(observation.derivation.callId, {
      ...imageObservationDerivationProof(observation),
      text: 'Different provider result',
    });
    await expect(ledger.append(observation)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(await ledger.listCurrent(scope(observation.projectId))).toEqual([]);
  });
  it('rejects forged project, source hash, annotation text or region even when a fake proof asserts it', async () => {
    const observation = await fixture();
    for (const changed of [
      { ...observation, projectId: 'different-project' },
      { ...observation, sourceContentHash: sha256Text('forged') },
      { ...observation, text: 'forged description' },
      { ...observation, image: { ...observation.image, width: 321 } },
      {
        ...observation,
        image: { ...observation.image, region: { ...observation.image.region, width: 319 } },
      },
    ]) {
      proofs.set(observation.derivation.callId, imageObservationDerivationProof(changed));
      await expect(ledger.append(changed)).rejects.toBeDefined();
    }
    expect(await ledger.listCurrent(scope(observation.projectId))).toEqual([]);
  });
  it('one durable call cannot authorize two observations or changed output', async () => {
    const observation = await fixture();
    await ledger.append(observation);
    await expect(
      ledger.append({ ...observation, observationId: randomUUID() }),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(await ledger.listCurrent(scope(observation.projectId))).toHaveLength(1);
  });
  it('database payload access metadata cannot diverge from the immutable ledger columns', async () => {
    const observation = await fixture();
    await expect(
      pool.query(
        `INSERT INTO vp.image_observations(observation_id,project_id,source_id,source_version_id,original_asset_id,
      transformation_revision_id,call_id,attempt_id,source_content_hash,observation_text,epistemic_status,access_scope,sensitivity,payload,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'GENERATED_UNVERIFIED','{owner}','private',$11::jsonb,$12)`,
        [
          observation.observationId,
          observation.projectId,
          observation.sourceId,
          observation.sourceVersionId,
          observation.originalAssetId,
          observation.derivation.transformationRevisionId,
          observation.derivation.callId,
          observation.derivation.attemptId,
          observation.sourceContentHash,
          observation.text,
          JSON.stringify({ ...observation, accessScope: ['reader'] }),
          observation.createdAt,
        ],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    expect(await ledger.listCurrent(scope(observation.projectId))).toEqual([]);
  });
  it('concurrent finalizers and a restarted ledger reuse one observation and one epoch', async () => {
    const observation = await fixture();
    const results = await Promise.all([ledger.append(observation), ledger.append(observation)]);
    expect(results.map((result) => result.reused).sort()).toEqual([false, true]);
    const restarted = new PostgresVPImageObservationLedger(pool, {
      findCompleted: async () => proofs.get(observation.derivation.callId),
    });
    expect((await restarted.append(observation)).reused).toBe(true);
    expect(
      (
        await pool.query(`SELECT current_epoch::text FROM vp.project_epochs WHERE project_id=$1`, [
          observation.projectId,
        ])
      ).rows[0].current_epoch,
    ).toBe('1');
  });
  it('COMMIT acknowledgement loss is unknown and durable readback prevents a second publication', async () => {
    const observation = await fixture();
    let lost = false;
    const lostAckPool = {
      connect: async () => {
        const client = await pool.connect();
        return new Proxy(client, {
          get(target, key) {
            if (key === 'query')
              return async (sql: string, values?: unknown[]) => {
                const result = await target.query(sql, values);
                if (sql === 'COMMIT' && !lost) {
                  lost = true;
                  throw new Error('isolated commit ACK lost');
                }
                return result;
              };
            const value = Reflect.get(target, key, target);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
      },
    } as unknown as Pool;
    const uncertain = new PostgresVPImageObservationLedger(lostAckPool, {
      findCompleted: async () => proofs.get(observation.derivation.callId),
    });
    await expect(uncertain.append(observation)).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    expect((await ledger.append(observation)).reused).toBe(true);
    expect(await ledger.listCurrent(scope(observation.projectId))).toEqual([observation]);
    expect(
      (
        await pool.query(`SELECT current_epoch::text FROM vp.project_epochs WHERE project_id=$1`, [
          observation.projectId,
        ])
      ).rows[0].current_epoch,
    ).toBe('1');
  });
  it('filters current and historical reads by project, access and sensitivity', async () => {
    const observation = await fixture();
    await ledger.append(observation);
    for (const forbidden of [
      scope('other-project'),
      { ...scope(observation.projectId), accessScope: ['reader'] },
      { ...scope(observation.projectId), authorizedSensitivities: ['public'] as const },
    ]) {
      expect(await ledger.listCurrent(forbidden)).toEqual([]);
      expect(await ledger.findHistorical(forbidden, observation.observationId)).toBeUndefined();
    }
    expect(
      await ledger.listCurrent({ ...scope(observation.projectId), sourceVersionIds: [] }),
    ).toEqual([]);
  });
  it('a newer source version removes current reuse while preserving the exact historical observation', async () => {
    const observation = await fixture();
    await ledger.append(observation);
    await nextVersion(observation);
    expect(await ledger.listCurrent(scope(observation.projectId))).toEqual([]);
    expect(
      await ledger.findHistorical(scope(observation.projectId), observation.observationId),
    ).toEqual(observation);
  });
  it('an unrelated source change preserves current observations; latest hidden-source ACL also gates history', async () => {
    const observation = await fixture(),
      unrelated = await fixture();
    await ledger.append(observation);
    await nextVersion(unrelated);
    expect(await ledger.listCurrent(scope(observation.projectId))).toEqual([observation]);
    await nextVersion(observation, ['private-owner'], 'restricted');
    expect(
      await ledger.findHistorical(scope(observation.projectId), observation.observationId),
    ).toBeUndefined();
  });
  it('inactive projects and reset-pending knowledge are excluded from normal reads', async () => {
    const observation = await fixture();
    await ledger.append(observation);
    await pool.query(`UPDATE project_admin.projects SET active=false WHERE id=$1`, [
      observation.projectId,
    ]);
    expect(await ledger.listCurrent(scope(observation.projectId))).toEqual([]);
    await pool.query(`UPDATE project_admin.projects SET active=true WHERE id=$1`, [
      observation.projectId,
    ]);
    await pool.query(
      `INSERT INTO project_admin.project_knowledge_epoch(project_id,state) VALUES($1,'RESET_PENDING')`,
      [observation.projectId],
    );
    expect(await ledger.listCurrent(scope(observation.projectId))).toEqual([]);
    expect(
      await ledger.findHistorical(scope(observation.projectId), observation.observationId),
    ).toBeUndefined();
  });
  it.each([
    {
      operation: 'UPDATE',
      sql: `UPDATE vp.image_observations SET observation_text='changed' WHERE observation_id=$1`,
      reason: 'append-only',
    },
    {
      operation: 'DELETE',
      sql: `DELETE FROM vp.image_observations WHERE observation_id=$1`,
      reason: 'append-only',
    },
    { operation: 'TRUNCATE', sql: `TRUNCATE vp.image_observations`, reason: 'cannot be truncated' },
  ])('preserves append-only records against $operation', async ({ operation, sql, reason }) => {
    const observation = await fixture();
    await ledger.append(observation);
    await expect(
      pool.query(sql, operation === 'TRUNCATE' ? [] : [observation.observationId]),
    ).rejects.toThrow(reason);
    expect(
      await ledger.findHistorical(scope(observation.projectId), observation.observationId),
    ).toEqual(observation);
  });
  it('uses a supplied snapshot query executor and surfaces lookup errors without false empty success', async () => {
    const observation = await fixture();
    await ledger.append(observation);
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      expect(
        await ledger.listCurrent({ ...scope(observation.projectId), queryExecutor: client }),
      ).toEqual([observation]);
      await nextVersion(observation);
      expect(
        await ledger.listCurrent({ ...scope(observation.projectId), queryExecutor: client }),
      ).toEqual([observation]);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    expect(await ledger.listCurrent(scope(observation.projectId))).toEqual([]);
    const query = vi.fn().mockRejectedValue(new Error('database unavailable'));
    await expect(
      ledger.listCurrent({ ...scope(observation.projectId), queryExecutor: { query } }),
    ).rejects.toThrow('database unavailable');
  });
});
