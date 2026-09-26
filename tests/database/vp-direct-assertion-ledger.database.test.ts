import { createHash, randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresVPKnowledgeLedger } from '../../adapters/vp-knowledge-postgres/src/index.js';
import { PostgresVPRelationJobs } from '../../adapters/vp-knowledge-postgres/src/relation-jobs.js';
import { GeneralAIVPDecisionAdapter } from '../../adapters/vp-decision-general-ai/src/index.js';
import { PostgresKnowledgeResetImpactInspector } from '../../adapters/source-knowledge-reset-postgres/src/impact-inspector.js';
import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import { PostgresProjectAdministrationRepository } from '../../adapters/postgres/src/index.js';
import type { AIProviderExecutionResolverPort } from '../../modules/ai-provider/src/index.js';
import { VPRelationJobWorker } from '../../modules/vp-knowledge-ledger/src/index.js';
import { VPRelationDecisionRouter } from '../../modules/vp-decision/src/index.js';
import {
  createIsolatedPostgresTestDatabase,
  type IsolatedPostgresTestDatabase,
} from '../helpers/isolated-postgres-test-database.js';

const hash = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`;

let database: IsolatedPostgresTestDatabase | undefined;
let pool: Pool;
let runtimePool: Pool | undefined;

describe('VP validated direct assertion ledger', () => {
  beforeAll(async () => {
    database = await createIsolatedPostgresTestDatabase();
    pool = database.createPool();
  });

  afterAll(async () => {
    await runtimePool?.end();
    await database?.dispose();
  });

  it('records direct claims once, links exact text, filters security, and retires old versions', async () => {
    const suffix = randomUUID();
    const projectId = `vp-ledger-${suffix}`;
    const auth = new PostgresAuthRepository(pool);
    const principal = await auth.bootstrapLocalOwnerPrincipal({ accountId: `vp-owner-${suffix}` });
    const administration = new PostgresProjectAdministrationRepository(pool);
    const createProject = async (id: string): Promise<void> => {
      await administration.createProject({
        commandId: `vp-project-command-${id}`,
        clientRequestId: `vp-project-request-${id}`,
        idempotencyKey: `vp-project-idempotency-${id}`,
        projectId: id,
        name: 'VP Ledger Fixture',
        description: 'Direct assertion provenance and current view',
        actorPrincipalId: principal.principalId,
        expectedProjectRevision: 0,
      });
    };
    await createProject(projectId);

    const claimText = 'The shared verification code is 42.';
    const seedCandidate = async (
      index: number,
      sensitivity: 'public' | 'private',
      text = claimText,
    ) => {
      const sourceId = randomUUID();
      const sourceVersionId = randomUUID();
      const assetId = randomUUID();
      const revisionId = randomUUID();
      const evidenceId = randomUUID();
      const candidateId = randomUUID();
      const content = `VP source ${index}: ${text} ${suffix}`;
      await pool.query(
        `INSERT INTO asset.original_assets
           (asset_id, content_hash, size_bytes, storage_key, created_at)
         VALUES ($1, $2, $3, $4, now())`,
        [assetId, hash(content), Buffer.byteLength(content), `vp-ledger-${index}-${suffix}`],
      );
      await pool.query(
        `INSERT INTO asset.sources (source_id, project_id, created_by_actor_id, created_at)
         VALUES ($1, $2, $3, now())`,
        [sourceId, projectId, principal.principalId],
      );
      await pool.query(
        `INSERT INTO asset.source_versions
           (source_version_id, source_id, version_number, original_asset_id,
            media_type, access_scope, sensitivity, created_at)
         VALUES ($1, $2, 1, $3, 'text/plain', '{owner}', $4, now())`,
        [sourceVersionId, sourceId, assetId, sensitivity],
      );
      await pool.query(
        `INSERT INTO transformation.revisions
           (revision_id, project_id, source_id, source_version_id, source_content_hash,
            transformer_id, transformer_version, document_ir, source_map, document_hash,
            source_map_hash, access_scope, sensitivity, created_at)
         VALUES ($1, $2, $3, $4, $5, 'test-transformer', '1.0.0', '{}'::jsonb,
                 '{}'::jsonb, $6, $7, '{owner}', $8, now())`,
        [
          revisionId,
          projectId,
          sourceId,
          sourceVersionId,
          hash(content),
          hash(text),
          hash(`map-${index}`),
          sensitivity,
        ],
      );
      await pool.query(
        `INSERT INTO evidence.spans
           (evidence_id, revision_id, project_id, source_id, source_version_id,
            pointer, node_kind, origin, position, quote, exact_hash,
            access_scope, sensitivity, created_at)
         VALUES ($1, $2, $3, $4, $5, '/paragraph[1]/sentence[1]', 'sentence',
                 'source', $6::jsonb, $7::jsonb, $8, '{owner}', $9, now())`,
        [
          evidenceId,
          revisionId,
          projectId,
          sourceId,
          sourceVersionId,
          JSON.stringify({ start: 0, end: text.length }),
          JSON.stringify({ exact: text }),
          hash(text),
          sensitivity,
        ],
      );
      const indexingId = randomUUID();
      await pool.query(
        `INSERT INTO evidence.indexing_results
           (indexing_result_id, project_id, source_id, source_version_id, revision_id,
            transformer_id, transformer_version, status, evidence_count, reused_count,
            evidence_set_digest, contract_version, security_scope_digest, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'test-transformer', '1.0.0', 'INDEXED', 1, 0,
                 $6, 'stage3-evidence-index.v1', $7, now(), now())`,
        [
          indexingId,
          projectId,
          sourceId,
          sourceVersionId,
          revisionId,
          hash(evidenceId),
          hash(`${sensitivity}-owner`),
        ],
      );
      await pool.query(
        `INSERT INTO source_product.source_stage3_progress
           (project_id, source_id, source_version_id, state, indexing_result_id,
            created_at, updated_at)
         VALUES ($1, $2, $3, 'STAGE3_COMPLETED', $4, now(), now())`,
        [projectId, sourceId, sourceVersionId, indexingId],
      );
      const batchId = randomUUID();
      await pool.query(
        `INSERT INTO candidate.batches
           (batch_id, project_id, source_version_id, revision_id,
            idempotency_key, provider_call, created_at)
         VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, now())`,
        [batchId, projectId, sourceVersionId, revisionId, `vp-batch-${index}-${suffix}`],
      );
      await pool.query(
        `INSERT INTO candidate.claim_candidates
           (candidate_id, batch_id, project_id, source_version_id,
            revision_number, claim_text, evidence_id, evidence_mode,
            extraction_profile, status, provider_call, access_scope,
            sensitivity, created_at)
         VALUES ($1, $2, $3, $4, 1, $5, $6, 'DIRECT_EVIDENCE',
                 'direct-only', 'READY', '{}'::jsonb, '{owner}', $7, now())`,
        [candidateId, batchId, projectId, sourceVersionId, text, evidenceId, sensitivity],
      );
      await pool.query(
        `INSERT INTO validation.results
           (validation_id, candidate_id, revision_number, project_id,
            source_version_id, status, dimensions, created_at)
         VALUES ($1, $2, 1, $3, $4, 'READY', '[]'::jsonb, now())`,
        [randomUUID(), candidateId, projectId, sourceVersionId],
      );
      return { sourceId, sourceVersionId, revisionId, evidenceId, candidateId, content };
    };

    const first = await seedCandidate(1, 'public');
    runtimePool = new Pool({ connectionString: database!.databaseUrl, max: 1 });
    await runtimePool.query('SET ROLE shotgun_runtime');
    const ledger = new PostgresVPKnowledgeLedger(runtimePool);
    expect(await ledger.ingestValidatedDirectClaims()).toBe(1);
    expect(await ledger.ingestValidatedDirectClaims()).toBe(0);

    const second = await seedCandidate(2, 'public');
    expect(await ledger.ingestValidatedDirectClaims()).toBe(1);
    const third = await seedCandidate(3, 'private');
    expect(await ledger.ingestValidatedDirectClaims()).toBe(1);

    const assertions = await ledger.listCurrentAssertions({
      projectId,
      accessScope: ['owner'],
      authorizedSensitivities: ['public', 'private'],
    });
    expect(assertions).toHaveLength(3);
    expect(new Set(assertions.map((item) => item.evidenceId))).toEqual(
      new Set([first.evidenceId, second.evidenceId, third.evidenceId]),
    );
    expect(
      await ledger.listCurrentAssertions({
        projectId,
        accessScope: ['owner'],
        authorizedSensitivities: ['public'],
      }),
    ).toHaveLength(2);
    expect(
      await ledger.listCurrentAssertions({
        projectId,
        accessScope: [],
        authorizedSensitivities: ['public', 'private'],
      }),
    ).toHaveLength(0);
    const links = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM vp.current_relations
        WHERE project_id = $1 AND relation_kind = 'EQUIVALENT'`,
      [projectId],
    );
    expect(links.rows[0]?.count).toBe('1');
    const epoch = await pool.query<{ current_epoch: string }>(
      `SELECT current_epoch::text FROM vp.project_epochs WHERE project_id = $1`,
      [projectId],
    );
    expect(epoch.rows[0]?.current_epoch).toBe('3');
    await expect(
      pool.query('UPDATE vp.project_epochs SET current_epoch = 0 WHERE project_id = $1', [
        projectId,
      ]),
    ).rejects.toThrow(/advance by one/);

    const alternateRevisionId = randomUUID();
    await pool.query(
      `INSERT INTO transformation.revisions
         (revision_id, project_id, source_id, source_version_id, source_content_hash,
          transformer_id, transformer_version, document_ir, source_map, document_hash,
          source_map_hash, access_scope, sensitivity, created_at)
       VALUES ($1, $2, $3, $4, $5, 'alternate-transformer', '1.0.0',
               '{}'::jsonb, '{}'::jsonb, $6, $7, '{owner}', 'public', now())`,
      [
        alternateRevisionId,
        projectId,
        first.sourceId,
        first.sourceVersionId,
        hash(first.content),
        hash(claimText),
        hash(`alternate-map-${suffix}`),
      ],
    );
    const mismatchedBatchId = randomUUID();
    const mismatchedCandidateId = randomUUID();
    await pool.query(
      `INSERT INTO candidate.batches
         (batch_id, project_id, source_version_id, revision_id,
          idempotency_key, provider_call, created_at)
       VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, now())`,
      [
        mismatchedBatchId,
        projectId,
        first.sourceVersionId,
        alternateRevisionId,
        `mismatch-${suffix}`,
      ],
    );
    await pool.query(
      `INSERT INTO candidate.claim_candidates
         (candidate_id, batch_id, project_id, source_version_id, revision_number,
          claim_text, evidence_id, evidence_mode, extraction_profile, status,
          provider_call, access_scope, sensitivity, created_at)
       VALUES ($1, $2, $3, $4, 1, $5, $6, 'DIRECT_EVIDENCE', 'direct-only',
               'READY', '{}'::jsonb, '{owner}', 'public', now())`,
      [
        mismatchedCandidateId,
        mismatchedBatchId,
        projectId,
        first.sourceVersionId,
        claimText,
        first.evidenceId,
      ],
    );
    await pool.query(
      `INSERT INTO validation.results
         (validation_id, candidate_id, revision_number, project_id,
          source_version_id, status, dimensions, created_at)
       VALUES ($1, $2, 1, $3, $4, 'READY', '[]'::jsonb, now())`,
      [randomUUID(), mismatchedCandidateId, projectId, first.sourceVersionId],
    );
    expect(await ledger.ingestValidatedDirectClaims()).toBe(0);

    const newerAssetId = randomUUID();
    const newerVersionId = randomUUID();
    const newerContent = `The revised source supersedes its earlier claim ${suffix}.`;
    await pool.query(
      `INSERT INTO asset.original_assets
         (asset_id, content_hash, size_bytes, storage_key, created_at)
       VALUES ($1, $2, $3, $4, now())`,
      [newerAssetId, hash(newerContent), Buffer.byteLength(newerContent), `vp-newer-${suffix}`],
    );
    await pool.query(
      `INSERT INTO asset.source_versions
         (source_version_id, source_id, version_number, original_asset_id,
          media_type, access_scope, sensitivity, created_at)
       VALUES ($1, $2, 2, $3, 'text/plain', '{owner}', 'public', now())`,
      [newerVersionId, first.sourceId, newerAssetId],
    );
    const supersededBatchId = randomUUID();
    await pool.query(
      `INSERT INTO candidate.batches
         (batch_id, project_id, source_version_id, revision_id,
          idempotency_key, provider_call, created_at)
       VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, now())`,
      [
        supersededBatchId,
        projectId,
        first.sourceVersionId,
        first.revisionId,
        `superseded-${suffix}`,
      ],
    );
    const supersededCandidateId = randomUUID();
    await pool.query(
      `INSERT INTO candidate.claim_candidates
         (candidate_id, batch_id, project_id, source_version_id,
          revision_number, claim_text, evidence_id, evidence_mode, extraction_profile,
          status, provider_call, access_scope, sensitivity, created_at)
       VALUES ($1, $2, $3, $4, 1, $5, $6, 'DIRECT_EVIDENCE', 'direct-only',
               'READY', '{}'::jsonb, '{owner}', 'public', now())`,
      [
        supersededCandidateId,
        supersededBatchId,
        projectId,
        first.sourceVersionId,
        claimText,
        first.evidenceId,
      ],
    );
    await pool.query(
      `INSERT INTO validation.results
         (validation_id, candidate_id, revision_number, project_id,
          source_version_id, status, dimensions, created_at)
       VALUES ($1, $2, 1, $3, $4, 'READY', '[]'::jsonb, now())`,
      [randomUUID(), supersededCandidateId, projectId, first.sourceVersionId],
    );
    expect(await ledger.ingestValidatedDirectClaims()).toBe(0);
    const current = await ledger.listCurrentAssertions({
      projectId,
      accessScope: ['owner'],
      authorizedSensitivities: ['public', 'private'],
    });
    expect(new Set(current.map((item) => item.sourceId))).toEqual(
      new Set([second.sourceId, third.sourceId]),
    );
    const currentLinks = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM vp.current_relations WHERE project_id = $1`,
      [projectId],
    );
    expect(currentLinks.rows[0]?.count).toBe('0');
    await seedCandidate(4, 'public', 'The shared verification code is 43.');
    expect(await ledger.ingestValidatedDirectClaims()).toBe(1);
    const jobs = new PostgresVPRelationJobs(runtimePool);
    expect(await jobs.enqueueCurrentPairs('vp-test-policy')).toBe(1);
    expect(await jobs.enqueueCurrentPairs('vp-test-policy')).toBe(0);
    const job = await jobs.claimNext('vp-test-policy');
    expect(job).toBeDefined();
    expect(new Set([job!.left.claimText, job!.right.claimText])).toEqual(
      new Set([claimText, 'The shared verification code is 43.']),
    );
    const decision = {
      jobId: job!.jobId,
      leaseToken: job!.leaseToken,
      provider: 'GENERAL_AI' as const,
      choice: 'CONTRADICTS' as const,
      confidence: 0.91,
      model: 'vp-test-model',
      inputTokens: 20,
      outputTokens: 5,
    };
    expect(await jobs.completeDecision({ ...decision, leaseToken: randomUUID() })).toBe(false);
    expect(await jobs.completeDecision(decision)).toBe(true);
    expect(await jobs.completeDecision(decision)).toBe(false);
    const semanticLinks = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM vp.current_relations
        WHERE project_id = $1 AND relation_kind = 'CONTRADICTS'`,
      [projectId],
    );
    expect(semanticLinks.rows[0]?.count).toBe('1');
    expect(await jobs.enqueueCurrentPairs('vp-revised-policy')).toBe(1);
    const revisedJob = await jobs.claimNext('vp-revised-policy');
    expect(revisedJob).toBeDefined();
    expect(
      await jobs.completeDecision({
        ...decision,
        jobId: revisedJob!.jobId,
        leaseToken: revisedJob!.leaseToken,
      }),
    ).toBe(true);
    const relationVersions = await pool.query<{ historical: string; current: string }>(
      `SELECT
         (SELECT count(*)::text FROM vp.relations
           WHERE project_id = $1 AND relation_kind = 'CONTRADICTS') AS historical,
         (SELECT count(*)::text FROM vp.current_relations
           WHERE project_id = $1 AND relation_kind = 'CONTRADICTS') AS current`,
      [projectId],
    );
    expect(relationVersions.rows[0]).toEqual({ historical: '2', current: '1' });
    const deepseekResolver: AIProviderExecutionResolverPort = {
      resolve: async () => ({
        adapter: {
          identity: {
            provider: 'deepseek',
            model: 'deepseek-flash',
            adapterVersion: 'test',
            dataPolicyVersion: 'test',
          },
          generateStructured: async () => ({
            rawText: JSON.stringify({
              choice: 'CONTRADICTS',
              confidence: 0.98,
              probabilities: {
                EQUIVALENT: 0.01,
                QUALIFIES: 0.01,
                CONTRADICTS: 0.98,
                RELATED: 0,
                UNRESOLVED: 0,
              },
            }),
            modelVersion: 'deepseek-flash',
            inputTokens: 100,
            outputTokens: 30,
          }),
        },
        executionIdentity: {} as never,
      }),
    };
    const worker = new VPRelationJobWorker(
      jobs,
      new VPRelationDecisionRouter(undefined, new GeneralAIVPDecisionAdapter(deepseekResolver), {
        revision: 'vp-deepseek-relation-v1',
        minimumChoiceProbability: 0.9,
        maximumDeepAnalysisScore: 0,
        maximumInputTokens: 4_000,
        maximumOutputTokens: 256,
      }),
      async () => true,
      'vp-deepseek-relation-v1',
    );
    expect(await worker.dispatchOnce()).toBe('DECIDED');
    const deepseekReceipt = await pool.query<{ method: string; provider_model: string }>(
      `SELECT method, provider_model FROM vp.decision_receipts
        WHERE project_id = $1 AND policy_revision = 'vp-deepseek-relation-v1'`,
      [projectId],
    );
    expect(deepseekReceipt.rows).toEqual([
      { method: 'GENERAL_AI', provider_model: 'deepseek/deepseek-flash' },
    ]);
    expect(await jobs.enqueueCurrentPairs('vp-unresolved-test')).toBe(1);
    const unresolvedJob = await jobs.claimNext('vp-unresolved-test');
    expect(unresolvedJob).toBeDefined();
    expect(
      await jobs.completeUnresolved({
        jobId: unresolvedJob!.jobId,
        leaseToken: randomUUID(),
        code: 'QUALIFIER_NOT_MODELED',
      }),
    ).toBe(false);
    expect(
      await jobs.completeUnresolved({
        jobId: unresolvedJob!.jobId,
        leaseToken: unresolvedJob!.leaseToken,
        code: 'QUALIFIER_NOT_MODELED',
      }),
    ).toBe(true);
    expect(await jobs.claimNext('vp-unresolved-test')).toBeUndefined();
    await expect(
      pool.query(`UPDATE vp.assertions SET claim_text = 'tampered' WHERE candidate_id = $1`, [
        first.candidateId,
      ]),
    ).rejects.toThrow(/append-only/);
    const impact = await new PostgresKnowledgeResetImpactInspector(
      pool,
      true,
    ).inspectProjectSourceKnowledge(projectId);

    const resetRequestId = randomUUID();
    const digest = hash(`vp-reset-${suffix}`);
    await pool.query(
      `INSERT INTO project_admin.project_knowledge_epoch (project_id, epoch, state)
       VALUES ($1, 1, 'RESET_PENDING')
       ON CONFLICT (project_id) DO UPDATE
         SET epoch = 1, state = 'RESET_PENDING'`,
      [projectId],
    );
    await pool.query(
      `INSERT INTO project_admin.project_knowledge_reset_requests
         (request_id, preview_id, project_id, actor_principal_id,
          project_revision, expected_knowledge_epoch, resulting_knowledge_epoch,
          manifest_digest, owner_manifest_digest, idempotency_key, state)
       SELECT $1, $2, $3, $4, project.revision, 0, 1, $5, $5, $6, 'PURGING'
         FROM project_admin.projects AS project WHERE project.id = $3`,
      [
        resetRequestId,
        randomUUID(),
        projectId,
        principal.principalId,
        digest,
        `vp-reset-${suffix}`,
      ],
    );
    await expect(
      pool.query('SELECT vp.t3_erase_project($1, $2::uuid)', [projectId, resetRequestId]),
    ).rejects.toMatchObject({ constraint: 't3_erasure_executor_required' });
    const executor = await pool.connect();
    let resetAuthorization = false;
    try {
      await executor.query('SET SESSION AUTHORIZATION shotgun_erasure_executor');
      resetAuthorization = true;
      const before = await executor.query<{ status: Record<string, number> }>(
        'SELECT vp.t3_project_status($1, $2::uuid) AS status',
        [projectId, resetRequestId],
      );
      expect(before.rows[0]?.status.assertions).toBe(4);
      expect(before.rows[0]?.status.jobs).toBe(4);
      await executor.query('SELECT vp.t3_erase_project($1, $2::uuid)', [projectId, resetRequestId]);
      const after = await executor.query<{ status: Record<string, number> }>(
        'SELECT vp.t3_project_status($1, $2::uuid) AS status',
        [projectId, resetRequestId],
      );
      expect(after.rows[0]?.status).toEqual({
        jobs: 0,
        assertions: 0,
        relations: 0,
        decisions: 0,
        events: 0,
        epochs: 0,
      });
    } finally {
      if (resetAuthorization) await executor.query('RESET SESSION AUTHORIZATION');
      executor.release();
    }
    const afterPurgeImpact = await new PostgresKnowledgeResetImpactInspector(
      pool,
      true,
    ).inspectProjectSourceKnowledge(projectId);
    expect(
      impact.counts.sourceDerivedRecordCount - afterPurgeImpact.counts.sourceDerivedRecordCount,
    ).toBe(24);
    expect(afterPurgeImpact.manifestDigest).not.toBe(impact.manifestDigest);
  });
});
