import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { type Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresAiOutputKnowledgeResetOwner } from '../../adapters/source-knowledge-reset-postgres/src/ai-output-owner.js';
import { PostgresSourceProductKnowledgeResetOwner } from '../../adapters/source-knowledge-reset-postgres/src/source-product-owner.js';
import { PostgresVPKnowledgeResetOwner } from '../../adapters/source-knowledge-reset-postgres/src/vp-ledger-owner.js';
import { PostgresKnowledgeResetImpactInspector } from '../../adapters/source-knowledge-reset-postgres/src/impact-inspector.js';
import { migrateUpTo } from '../../scripts/database.js';
import {
  createIsolatedPostgresTestDatabase,
  type IsolatedPostgresTestDatabase,
} from '../helpers/isolated-postgres-test-database.js';
import { imageObservationFixture } from '../helpers/vp-image-observation.js';

describe('image derivative T3 erasure uses existing owner authorization and original lineage', () => {
  let database: IsolatedPostgresTestDatabase, pool: Pool;
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
  it('rolls back the additive owner migration atomically before applying it', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        await readFile('db/migrations/137_image_observation_t3_ownership.sql', 'utf8'),
      );
      expect(
        (
          await client.query(
            "SELECT to_regprocedure('vp.t3_project_status_before_image(text,uuid)')::text AS name",
          )
        ).rows[0].name,
      ).not.toBeNull();
      await client.query('ROLLBACK');
      expect(
        (
          await client.query(
            "SELECT to_regprocedure('vp.t3_project_status_before_image(text,uuid)')::text AS name",
          )
        ).rows[0].name,
      ).toBeNull();
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    await migrateUpTo('137_image_observation_t3_ownership.sql', database.databaseUrl);
  });
  async function fixture(state = 'COMPLETED') {
    const observation = imageObservationFixture();
    const { projectId, sourceId, sourceVersionId, originalAssetId, sourceContentHash } =
      observation;
    const { callId, attemptId, transformationRevisionId: revisionId } = observation.derivation;
    await pool.query(
      "INSERT INTO project_admin.projects(id,name,status,active) VALUES($1,'Synthetic T3 image lineage','ACTIVE',true)",
      [projectId],
    );
    await pool.query(
      'INSERT INTO asset.original_assets(asset_id,content_hash,size_bytes,storage_key,created_at) VALUES($1,$2,1,$3,now())',
      [
        originalAssetId,
        `sha256:${originalAssetId.replaceAll('-', '').padEnd(64, '0')}`,
        `t3-image-${originalAssetId}`,
      ],
    );
    await pool.query(
      "INSERT INTO asset.sources(source_id,project_id,created_by_actor_id,created_at) VALUES($1,$2,'t3-synthetic',now())",
      [sourceId, projectId],
    );
    await pool.query(
      "INSERT INTO asset.source_versions(source_version_id,source_id,version_number,original_asset_id,media_type,access_scope,sensitivity,created_at) VALUES($1,$2,1,$3,'image/png','{owner}','private',now())",
      [sourceVersionId, sourceId, originalAssetId],
    );
    await pool.query(
      `INSERT INTO transformation.revisions(revision_id,project_id,source_id,source_version_id,source_content_hash,
      transformer_id,transformer_version,document_ir,source_map,document_hash,source_map_hash,access_scope,sensitivity,created_at)
      VALUES($1,$2,$3,$4,$5,'synthetic-t3-only','1','{}','{}',$5,$5,'{owner}','private',now())`,
      [revisionId, projectId, sourceId, sourceVersionId, sourceContentHash],
    );
    await pool.query(
      `INSERT INTO ai.image_observation_executions(call_id,project_id,request_id,source_version_id,state,attempt_id,
      request_digest,record_json,output_json,rejected_response_json,transformation_revision_id,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,'{}',$8,$9,$10,now())`,
      [
        callId,
        projectId,
        randomUUID(),
        sourceVersionId,
        state,
        state === 'REQUESTED' ? null : attemptId,
        observation.derivation.requestDigest,
        ['COMPLETED', 'OUTPUT_STORED'].includes(state) ? {} : null,
        state === 'OUTPUT_REJECTED' ? {} : null,
        state === 'COMPLETED' ? revisionId : null,
      ],
    );
    if (state === 'COMPLETED') {
      await pool.query(
        `INSERT INTO vp.image_observations(observation_id,project_id,source_id,source_version_id,original_asset_id,
        transformation_revision_id,call_id,attempt_id,source_content_hash,observation_text,epistemic_status,access_scope,sensitivity,payload,created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'GENERATED_UNVERIFIED','{owner}','private',$11,$12)`,
        [
          observation.observationId,
          projectId,
          sourceId,
          sourceVersionId,
          originalAssetId,
          revisionId,
          callId,
          attemptId,
          sourceContentHash,
          observation.text,
          observation,
          observation.createdAt,
        ],
      );
    }
    await pool.query(
      `INSERT INTO source_product.source_stage3_progress(project_id,source_id,source_version_id,state,image_observation_id,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,now(),now())`,
      [
        projectId,
        sourceId,
        sourceVersionId,
        state === 'COMPLETED' ? 'IMAGE_OBSERVATION_COMPLETED' : 'RECONCILIATION_REQUIRED',
        state === 'COMPLETED' ? observation.observationId : null,
      ],
    );
    return observation;
  }
  async function beginReset(projectId: string) {
    const requestId = randomUUID(),
      hash = `sha256:${'a'.repeat(64)}`;
    await pool.query(
      "INSERT INTO project_admin.project_knowledge_epoch(project_id,epoch,state) VALUES($1,1,'RESET_PENDING')",
      [projectId],
    );
    await pool.query(
      `INSERT INTO project_admin.project_knowledge_reset_requests(request_id,preview_id,project_id,actor_principal_id,
      project_revision,expected_knowledge_epoch,resulting_knowledge_epoch,manifest_digest,owner_manifest_digest,
      preserved_configuration_digest,idempotency_key,state,impact_counts)
      VALUES($1,$2,$3,'synthetic-t3',1,0,1,$4,$4,$4,$5,'PURGING','{}')`,
      [requestId, randomUUID(), projectId, hash, randomUUID()],
    );
    return { projectId, requestId, knowledgeEpoch: 1, manifestDigest: hash as `sha256:${string}` };
  }
  async function executor<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('SET SESSION AUTHORIZATION shotgun_erasure_executor');
      return await action(client);
    } finally {
      await client.query('RESET SESSION AUTHORIZATION');
      client.release();
    }
  }
  it('requires progress→VP→AI order, is idempotent, and preserves another project and source lineage', async () => {
    const selected = await fixture(),
      other = await fixture();
    const preview = await new PostgresKnowledgeResetImpactInspector(
      pool,
      true,
    ).inspectProjectSourceKnowledge(selected.projectId);
    expect(preview.blockers).not.toContain('UNCLASSIFIED_CONTENT');
    expect(preview.blockers).not.toContain('ACTIVE_JOB_OUTCOME_UNKNOWN');
    expect(preview.counts.sourceDerivedRecordCount).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(preview)).not.toContain(selected.text);
    const context = await beginReset(selected.projectId);
    await executor(async (client) => {
      await expect(
        client.query('SELECT vp.t3_erase_project($1,$2)', [context.projectId, context.requestId]),
      ).rejects.toMatchObject({ code: '23503' });
      await client.query('SELECT source_product.t3_erase_project_source_product($1,$2)', [
        context.projectId,
        context.requestId,
      ]);
      await expect(
        client.query('SELECT ai.t3_erase_project_provider_data($1,$2)', [
          context.projectId,
          context.requestId,
        ]),
      ).rejects.toMatchObject({ code: '23503' });
      await client.query('SELECT vp.t3_erase_project($1,$2)', [
        context.projectId,
        context.requestId,
      ]);
      await client.query('SELECT ai.t3_erase_project_provider_data($1,$2)', [
        context.projectId,
        context.requestId,
      ]);
      for (const routine of [
        'source_product.t3_erase_project_source_product',
        'vp.t3_erase_project',
        'ai.t3_erase_project_provider_data',
      ])
        await client.query(`SELECT ${routine}($1,$2)`, [context.projectId, context.requestId]);
      for (const Owner of [
        PostgresSourceProductKnowledgeResetOwner,
        PostgresVPKnowledgeResetOwner,
        PostgresAiOutputKnowledgeResetOwner,
      ])
        await expect(new Owner(client as unknown as Pool).verify(context)).resolves.toEqual({
          verified: true,
          blockerCodes: [],
        });
    });
    for (const table of [
      'source_product.source_stage3_progress',
      'vp.image_observations',
      'ai.image_observation_executions',
    ]) {
      expect(
        (
          await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE project_id=$1`, [
            selected.projectId,
          ])
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE project_id=$1`, [
            other.projectId,
          ])
        ).rows[0].n,
      ).toBe(1);
    }
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM asset.source_versions WHERE source_version_id=$1',
          [selected.sourceVersionId],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM transformation.revisions WHERE revision_id=$1',
          [selected.derivation.transformationRevisionId],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it.each(['REQUESTED', 'PROVIDER_RUNNING', 'OUTPUT_STORED', 'OUTCOME_UNKNOWN'])(
    'never erases %s or its resumable progress',
    async (state) => {
      const observation = await fixture(state),
        preview = await new PostgresKnowledgeResetImpactInspector(
          pool,
          true,
        ).inspectProjectSourceKnowledge(observation.projectId),
        context = await beginReset(observation.projectId);
      expect(preview.blockers).toContain('ACTIVE_JOB_OUTCOME_UNKNOWN');
      expect(preview.counts.blockedRecordCount).toBeGreaterThan(0);
      await executor(async (client) => {
        for (const Owner of [
          PostgresSourceProductKnowledgeResetOwner,
          PostgresAiOutputKnowledgeResetOwner,
        ])
          await expect(new Owner(client as unknown as Pool).fence(context)).rejects.toMatchObject({
            blockerCode: 'ACTIVE_JOB_OUTCOME_UNKNOWN',
          });
        for (const routine of [
          'source_product.t3_erase_project_source_product',
          'vp.t3_erase_project',
          'ai.t3_erase_project_provider_data',
        ])
          await expect(
            client.query(`SELECT ${routine}($1,$2)`, [context.projectId, context.requestId]),
          ).rejects.toMatchObject({ constraint: 'active_job_outcome_unknown' });
      });
      expect(
        (
          await pool.query('SELECT state FROM ai.image_observation_executions WHERE call_id=$1', [
            observation.derivation.callId,
          ])
        ).rows[0].state,
      ).toBe(state);
      expect(
        (
          await pool.query(
            'SELECT state FROM source_product.source_stage3_progress WHERE source_version_id=$1',
            [observation.sourceVersionId],
          )
        ).rows[0].state,
      ).toBe('RECONCILIATION_REQUIRED');
    },
  );
  it('does not grant erasure or private predecessor calls to ordinary runtime and fences writes', async () => {
    const observation = await fixture('OUTPUT_REJECTED'),
      context = await beginReset(observation.projectId);
    const client = await pool.connect();
    try {
      await client.query('SET SESSION AUTHORIZATION shotgun_runtime');
      await expect(
        client.query('DELETE FROM ai.image_observation_executions WHERE call_id=$1', [
          observation.derivation.callId,
        ]),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        client.query('SELECT ai.t3_erase_project_provider_data($1,$2)', [
          context.projectId,
          context.requestId,
        ]),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        client.query(
          'UPDATE ai.image_observation_executions SET request_id=request_id WHERE call_id=$1',
          [observation.derivation.callId],
        ),
      ).rejects.toMatchObject({ constraint: 'project_knowledge_reset_write_fence' });
    } finally {
      await client.query('RESET SESSION AUTHORIZATION');
      client.release();
    }
    await executor(async (executorClient) => {
      await expect(
        executorClient.query('SELECT vp.t3_erase_project_before_image($1,$2)', [
          context.projectId,
          context.requestId,
        ]),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });
});
