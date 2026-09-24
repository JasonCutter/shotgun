import { createHash, randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  PostgresAiOutputKnowledgeResetOwner,
  PostgresCandidateKnowledgeResetOwner,
} from '../../adapters/source-knowledge-reset-postgres/src/index.js';
import { PostgresKnowledgeResetImpactInspector } from '../../adapters/source-knowledge-reset-postgres/src/impact-inspector.js';
import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';

const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const hash = (character: string): string => `sha256:${character.repeat(64)}`;

type ProviderFixture = Readonly<{
  projectId: string;
  sourceId: string;
  sourceVersionId: string;
  revisionId: string;
  evidenceId: string;
  callId: string;
  attemptId: string;
  outputId: string;
}>;

describe('ADR-171 AI Provider output erasure owner', () => {
  let database: Awaited<ReturnType<typeof createIsolatedPostgresTestDatabase>>;
  let adminPool: Pool;
  let executorPool: Pool;

  beforeAll(async () => {
    database = await createIsolatedPostgresTestDatabase();
    adminPool = database.createPool();
    const password = randomUUID();
    await adminPool.query(
      `ALTER ROLE shotgun_erasure_executor LOGIN PASSWORD ${literal(password)}`,
    );
    const connection = new URL(database.databaseUrl);
    connection.username = 'shotgun_erasure_executor';
    connection.password = password;
    executorPool = new Pool({ connectionString: connection.toString(), max: 1 });
    await executorPool.query('SELECT 1');
  });

  afterAll(async () => {
    await executorPool?.end();
    await adminPool?.query('ALTER ROLE shotgun_erasure_executor NOLOGIN PASSWORD NULL');
    await database?.dispose();
  });

  const seedProvider = async (
    projectId: string,
    options: { readonly durableState?: string; readonly schemaName?: string } = {},
  ): Promise<ProviderFixture> => {
    const sourceId = randomUUID();
    const sourceVersionId = randomUUID();
    const revisionId = randomUUID();
    const evidenceId = randomUUID();
    const callId = randomUUID();
    const attemptId = randomUUID();
    const outputId = randomUUID();
    const assetId = randomUUID();
    const now = new Date('2026-09-23T01:00:00.000Z');
    const sourceCanary = `private-source-payload-${randomUUID()}`;
    const contentHash = `sha256:${createHash('sha256').update(randomUUID()).digest('hex')}`;

    await adminPool.query(
      `INSERT INTO asset.original_assets (asset_id, content_hash, size_bytes, storage_key, created_at)
       VALUES ($1, $2, 18, $3, $4)`,
      [assetId, contentHash, `sha256/${randomUUID()}`, now],
    );
    await adminPool.query(
      `INSERT INTO asset.sources (source_id, project_id, created_by_actor_id, created_at)
       VALUES ($1, $2, 't3-test', $3)`,
      [sourceId, projectId, now],
    );
    await adminPool.query(
      `INSERT INTO asset.source_versions (
         source_version_id, source_id, version_number, original_asset_id, media_type,
         access_scope, sensitivity, created_at
       ) VALUES ($1, $2, 1, $3, 'text/plain', ARRAY['owner'], 'private', $4)`,
      [sourceVersionId, sourceId, assetId, now],
    );
    await adminPool.query(
      `INSERT INTO transformation.revisions (
         revision_id, project_id, source_id, source_version_id, source_content_hash,
         transformer_id, transformer_version, document_ir, source_map, document_hash,
         source_map_hash, access_scope, sensitivity, created_at
       ) VALUES ($1, $2, $3, $4, $5, 't3-test', '1', $6::jsonb,
                '{"quote":"source"}'::jsonb, $7, $8, ARRAY['owner'], 'private', $9)`,
      [
        revisionId,
        projectId,
        sourceId,
        sourceVersionId,
        hash('2'),
        JSON.stringify({ text: sourceCanary }),
        hash('3'),
        hash('4'),
        now,
      ],
    );
    await adminPool.query(
      `INSERT INTO evidence.spans (
         evidence_id, revision_id, project_id, source_id, source_version_id, pointer,
         node_kind, origin, position, quote, exact_hash, access_scope, sensitivity, created_at
       ) VALUES ($1, $2, $3, $4, $5, '/p/0', 'paragraph', 'source',
                 '{"start":0,"end":6}'::jsonb, $6::jsonb, $7,
                 ARRAY['owner'], 'private', $8)`,
      [
        evidenceId,
        revisionId,
        projectId,
        sourceId,
        sourceVersionId,
        JSON.stringify({ text: sourceCanary }),
        hash('5'),
        now,
      ],
    );
    await adminPool.query(
      `INSERT INTO ai.provider_calls (
         call_id, project_id, request_id, provider, model, prompt_version, policy_version,
         schema_name, data_classification, input_evidence_ids, status, call_json, created_at,
         source_version_id, access_scope, sensitivity, input_snapshot_digest, request_digest,
         durable_state, max_attempts, updated_at, revision_id
       ) VALUES ($1, $2, $3, 'test-provider', 'test-model', 'prompt-1', 'policy-1',
                 $4, 'private', ARRAY[$5]::uuid[], 'succeeded', $6::jsonb, $7,
                 $8, ARRAY['owner'], 'private', $9, $10, $11, 1, $7, $12)`,
      [
        callId,
        projectId,
        `provider-request-${randomUUID()}`,
        options.schemaName ?? 'ClaimCandidateBatch.v1',
        evidenceId,
        JSON.stringify({ sourceCanary }),
        now,
        sourceVersionId,
        hash('6'),
        hash('7'),
        options.durableState ?? 'COMPLETED',
        revisionId,
      ],
    );
    await adminPool.query(
      `INSERT INTO ai.provider_attempts (
         attempt_id, call_id, attempt_number, status, latency_ms, started_at, finished_at
       ) VALUES ($1, $2, 1, 'succeeded', 1, $3, $3)`,
      [attemptId, callId, now],
    );
    await adminPool.query(
      `INSERT INTO ai.provider_outputs (
         output_id, project_id, call_id, attempt_id, envelope_version, provider,
         adapter_version, model, schema_name, schema_version, prompt_version, policy_version,
         data_policy_version, output_text, content_digest, request_digest, input_snapshot_digest,
         model_version, usage_json, cost_json, received_at
       ) VALUES ($1, $2, $3, $4, 'ai-provider-output-v1', 'test-provider', '1',
                 'test-model', 'candidate', '1', 'prompt-1', 'policy-1', 'policy-1',
                 $5, $6, $7, $8, 'model-1', '{}'::jsonb, '{}'::jsonb, $9)`,
      [outputId, projectId, callId, attemptId, sourceCanary, hash('8'), hash('9'), hash('a'), now],
    );
    await adminPool.query(
      `UPDATE ai.provider_calls SET accepted_output_id = $2 WHERE call_id = $1`,
      [callId, outputId],
    );
    return {
      projectId,
      sourceId,
      sourceVersionId,
      revisionId,
      evidenceId,
      callId,
      attemptId,
      outputId,
    };
  };

  const beginReset = async (projectId: string) => {
    const requestId = randomUUID();
    await adminPool.query(
      `INSERT INTO project_admin.project_knowledge_epoch (project_id, epoch, state)
       VALUES ($1, 1, 'RESET_PENDING')`,
      [projectId],
    );
    await adminPool.query(
      `INSERT INTO project_admin.project_knowledge_reset_requests (
         request_id, preview_id, project_id, actor_principal_id, project_revision,
         expected_knowledge_epoch, resulting_knowledge_epoch, manifest_digest,
         owner_manifest_digest, preserved_configuration_digest, idempotency_key,
         state, impact_counts
       ) VALUES ($1, $2, $3, 't3-ai-test', 1, 0, 1, $4, $5, $6, $7,
                 'FENCING', '{}'::jsonb)`,
      [requestId, randomUUID(), projectId, hash('b'), hash('c'), hash('d'), randomUUID()],
    );
    return {
      projectId,
      requestId,
      knowledgeEpoch: 1,
      manifestDigest: hash('b') as `sha256:${string}`,
    };
  };

  it('purges only exact source-linked provider calls, attempts, and outputs in owner order', async () => {
    const projectId = `t3-ai-${randomUUID()}`;
    const otherProjectId = `t3-ai-other-${randomUUID()}`;
    await adminPool.query(
      `INSERT INTO project_admin.projects (id, name, status, active)
       VALUES ($1, 'T3 AI fixture', 'ACTIVE', true), ($2, 'T3 AI other fixture', 'ACTIVE', true)`,
      [projectId, otherProjectId],
    );
    const selected = await seedProvider(projectId);
    const other = await seedProvider(otherProjectId);
    await adminPool.query(
      `INSERT INTO candidate.materializations (
         materialization_id, project_id, output_id, output_digest, input_snapshot_digest,
         materializer_version, state, created_at, completed_at
       ) VALUES ($1, $2, $3, $4, $5, 'stage12-1-v1', 'COMPLETED', now(), now())`,
      [randomUUID(), projectId, selected.outputId, hash('e'), hash('f')],
    );

    const before = await new PostgresKnowledgeResetImpactInspector(
      adminPool,
    ).inspectProjectSourceKnowledge(projectId);
    expect(before.blockers).not.toContain('UNCLASSIFIED_CONTENT');
    expect(before.counts.sourceDerivedRecordCount).toBe(6);
    expect(JSON.stringify(before)).not.toContain('private-source-payload-');

    const context = await beginReset(projectId);
    const candidateOwner = new PostgresCandidateKnowledgeResetOwner(executorPool);
    const aiOwner = new PostgresAiOutputKnowledgeResetOwner(executorPool);
    await candidateOwner.fence(context);
    await aiOwner.fence(context);
    await adminPool.query(
      `UPDATE project_admin.project_knowledge_reset_requests SET state = 'PURGING'
       WHERE project_id = $1 AND request_id = $2`,
      [projectId, context.requestId],
    );
    await candidateOwner.purge(context);
    await aiOwner.purge(context);
    await expect(aiOwner.verify(context)).resolves.toEqual({ verified: true, blockerCodes: [] });

    const rows = await adminPool.query<{
      project_id: string;
      calls: string;
      attempts: string;
      outputs: string;
      materializations: string;
    }>(
      `SELECT scope.project_id,
         (SELECT count(*)::text FROM ai.provider_calls call WHERE call.project_id = scope.project_id) AS calls,
         (SELECT count(*)::text FROM ai.provider_attempts attempt
           JOIN ai.provider_calls call USING (call_id) WHERE call.project_id = scope.project_id) AS attempts,
         (SELECT count(*)::text FROM ai.provider_outputs output WHERE output.project_id = scope.project_id) AS outputs,
         (SELECT count(*)::text FROM candidate.materializations materialization
           WHERE materialization.project_id = scope.project_id) AS materializations
       FROM (VALUES ($1::text), ($2::text)) AS scope(project_id)
       ORDER BY scope.project_id`,
      [projectId, otherProjectId],
    );
    expect(rows.rows.find((row) => row.project_id === projectId)).toMatchObject({
      calls: '0',
      attempts: '0',
      outputs: '0',
      materializations: '0',
    });
    expect(rows.rows.find((row) => row.project_id === otherProjectId)).toMatchObject({
      calls: '1',
      attempts: '1',
      outputs: '1',
      materializations: '0',
    });
    expect(selected.callId).not.toBe(other.callId);
  });

  it('blocks active provider work and source-unresolved calls without deleting either', async () => {
    const projectId = `t3-ai-blocked-${randomUUID()}`;
    const unresolvedProjectId = `t3-ai-unresolved-${randomUUID()}`;
    await adminPool.query(
      `INSERT INTO project_admin.projects (id, name, status, active)
       VALUES ($1, 'T3 AI blocked fixture', 'ACTIVE', true),
              ($2, 'T3 AI unresolved fixture', 'ACTIVE', true)`,
      [projectId, unresolvedProjectId],
    );
    const active = await seedProvider(projectId, { durableState: 'PROVIDER_RUNNING' });
    const context = await beginReset(projectId);
    const owner = new PostgresAiOutputKnowledgeResetOwner(executorPool);
    await expect(owner.fence(context)).rejects.toMatchObject({
      blockerCode: 'ACTIVE_JOB_OUTCOME_UNKNOWN',
    });
    await expect(
      adminPool.query('SELECT ai.t3_erase_project_provider_data($1, $2::uuid)', [
        projectId,
        context.requestId,
      ]),
    ).rejects.toMatchObject({ code: '42501' });

    const unresolved = await seedProvider(unresolvedProjectId, { schemaName: 'Unclassified.v1' });
    const unresolvedContext = await beginReset(unresolvedProjectId);
    await expect(owner.fence(unresolvedContext)).rejects.toMatchObject({
      blockerCode: 'UNCLASSIFIED_CONTENT',
    });
    const impact = await new PostgresKnowledgeResetImpactInspector(
      adminPool,
    ).inspectProjectSourceKnowledge(unresolvedProjectId);
    expect(impact.blockers).toContain('UNCLASSIFIED_CONTENT');
    expect(JSON.stringify(impact)).not.toContain('private-source-payload-');
    const remainingCalls = await adminPool.query<{ count: string }>(
      `SELECT count(*)::text FROM ai.provider_calls WHERE call_id = ANY($1::uuid[])`,
      [[unresolved.callId, active.callId]],
    );
    expect(remainingCalls.rows[0]?.count).toBe('2');
  });
});
