import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  PostgresCandidateKnowledgeResetOwner,
  PostgresComparisonKnowledgeResetOwner,
  PostgresValidationKnowledgeResetOwner,
} from '../../adapters/source-knowledge-reset-postgres/src/index.js';
import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';

const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const hash = (character: string): string => `sha256:${character.repeat(64)}`;

type CandidateFixture = {
  projectId: string;
  candidateId: string;
  batchId: string;
  evidenceId: string;
  sourceVersionId: string;
  revisionId: string;
  now: Date;
};

describe('ADR-171 Comparison, Validation, and Candidate erasure owners', () => {
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

  const seedCandidate = async (projectId: string, now: Date): Promise<CandidateFixture> => {
    const candidateId = randomUUID();
    const batchId = randomUUID();
    const evidenceId = randomUUID();
    const sourceVersionId = randomUUID();
    const revisionId = randomUUID();
    await adminPool.query(
      `INSERT INTO transformation.revisions (
         revision_id, project_id, source_id, source_version_id, source_content_hash,
         transformer_id, transformer_version, document_ir, source_map, document_hash,
         source_map_hash, access_scope, sensitivity, created_at
       ) VALUES ($1, $2, $3, $4, $5, 't3-test', '1', '{"text":"source"}',
                '{"quote":"source"}', $6, $7, ARRAY['owner'], 'private', $8)`,
      [revisionId, projectId, randomUUID(), sourceVersionId, hash('1'), hash('2'), hash('3'), now],
    );
    await adminPool.query(
      `INSERT INTO evidence.spans (
         evidence_id, revision_id, project_id, source_id, source_version_id, pointer,
         node_kind, origin, position, quote, exact_hash, access_scope, sensitivity, created_at
       ) VALUES ($1, $2, $3, $4, $5, '/p/0', 'paragraph', 'source',
                 '{"start":0,"end":6}'::jsonb, '{"text":"source"}'::jsonb, $6,
                 ARRAY['owner'], 'private', $7)`,
      [evidenceId, revisionId, projectId, randomUUID(), sourceVersionId, hash('4'), now],
    );
    await adminPool.query(
      `INSERT INTO candidate.batches (
         batch_id, project_id, source_version_id, idempotency_key, provider_call, created_at, revision_id
       ) VALUES ($1, $2, $3, $4, '{"response":"source-derived"}'::jsonb, $5, $6)`,
      [batchId, projectId, sourceVersionId, `batch-${randomUUID()}`, now, revisionId],
    );
    await adminPool.query(
      `INSERT INTO candidate.claim_candidates (
         candidate_id, batch_id, project_id, source_version_id, revision_number,
         claim_text, evidence_id, evidence_mode, extraction_profile, status,
         provider_call, access_scope, sensitivity, created_at
       ) VALUES ($1, $2, $3, $4, 1, 'Source-derived candidate claim', $5,
                 'DIRECT_EVIDENCE', 'direct-only', 'READY', '{"output":"claim"}'::jsonb,
                 ARRAY['owner'], 'private', $6)`,
      [candidateId, batchId, projectId, sourceVersionId, evidenceId, now],
    );
    return { projectId, candidateId, batchId, evidenceId, sourceVersionId, revisionId, now };
  };

  const seedComparison = async (fixture: CandidateFixture) => {
    const legacyId = randomUUID();
    const comparisonId = `comparison-${randomUUID()}`;
    const analysisId = `analysis-${randomUUID()}`;
    await adminPool.query(
      `INSERT INTO comparison.results (
         comparison_id, project_id, source_version_id, candidate_id, snapshot_id,
         snapshot_version, snapshot_digest, classification, candidate_digest,
         diff_digest, result_json, created_at
       ) VALUES ($1, $2, $3, $4, 'snapshot-1', 1, $5, 'NEW_CLAIM', $6, $7, '{}'::jsonb, $8)`,
      [
        legacyId,
        fixture.projectId,
        fixture.sourceVersionId,
        fixture.candidateId,
        hash('5'),
        hash('6'),
        hash('7'),
        fixture.now,
      ],
    );
    await adminPool.query(
      `INSERT INTO comparison.results_v2 (
         comparison_id, project_id, candidate_id, candidate_revision, candidate_digest,
         source_version_id, snapshot_id, snapshot_version, snapshot_digest, disposition,
         review_recommendation, comparison_mode, shortlist_digest, analysis_input_set_digest,
         access_scope, sensitivity, logical_identity_digest, content_digest, result_json, created_at
       ) VALUES ($1, $2, $3, 1, $4, $5, 'snapshot-2', 1, $6, 'NEW', 'ADD_CLAIM',
                 'SEMANTIC', $7, $8, ARRAY['owner'], 'private', $9, $10, '{}'::jsonb, $11)`,
      [
        comparisonId,
        fixture.projectId,
        fixture.candidateId,
        hash('8'),
        fixture.sourceVersionId,
        hash('9'),
        hash('a'),
        hash('b'),
        hash('c'),
        hash('d'),
        fixture.now,
      ],
    );
    await adminPool.query(
      `INSERT INTO comparison.analysis_revisions_v2 (
         analysis_revision_id, project_id, comparison_id, candidate_id, candidate_revision,
         candidate_digest, candidate_source_version_id, candidate_evidence_ids,
         snapshot_id, snapshot_version, snapshot_digest, input_digest, shortlist_digest,
         compared_resource_identities, provider_id, model_id, capability_id,
         credential_revision_ref, prompt_template_revision, output_schema_revision,
         semantic_policy_revision, attempt, state, outcome, started_at, completed_at,
         duration_ms, output_digest, material_digest, analysis_json, created_at
       ) VALUES ($1, $2, $3, $4, 1, $5, $6, ARRAY[$7]::text[], 'snapshot-2', 1,
                 $8, $9, $10, '[]'::jsonb, 'provider', 'model', 'capability', 'credential-1',
                 'prompt-1', 'schema-1', 'policy-1', 1, 'COMPLETED', 'COMPLETED', $11, $11,
                 1, $12, $13, '{}'::jsonb, $11)`,
      [
        analysisId,
        fixture.projectId,
        comparisonId,
        fixture.candidateId,
        hash('e'),
        fixture.sourceVersionId,
        fixture.evidenceId,
        hash('f'),
        hash('1'),
        hash('2'),
        fixture.now,
        hash('3'),
        hash('4'),
      ],
    );
    await adminPool.query(
      `INSERT INTO comparison.relationships_v2 (
         relationship_id, project_id, comparison_id, candidate_id, candidate_revision,
         candidate_digest, candidate_evidence_ids, compared_resource_type, compared_resource_id,
         compared_resource_revision, snapshot_id, snapshot_version, snapshot_digest,
         relationship_type, analysis_revision_id, rule_identity, rationale, material_digest,
         access_scope, sensitivity, relationship_revision, relationship_identity_digest,
         relationship_json, created_at
       ) VALUES ($1, $2, $3, $4, 1, $5, ARRAY[$6]::text[], 'CLAIM', 'claim-other', 1,
                 'snapshot-2', 1, $7, 'SUPPORTS', $8, 'rule-1', 'Source-derived rationale',
                 $9, ARRAY['owner'], 'private', 1, $10, '{}'::jsonb, $11)`,
      [
        `relationship-${randomUUID()}`,
        fixture.projectId,
        comparisonId,
        fixture.candidateId,
        hash('5'),
        fixture.evidenceId,
        hash('6'),
        analysisId,
        hash('7'),
        hash('8'),
        fixture.now,
      ],
    );
    await adminPool.query(
      `INSERT INTO comparison.blocked_outcomes_v2 (
         blocked_outcome_id, project_id, candidate_id, candidate_revision, candidate_digest,
         blocked_phase, reason, safe_code, governing_input_digest, access_scope, sensitivity,
         first_observed_at, last_observed_at, state
       ) VALUES ($1, $2, $3, 1, $4, 'CONTRACT', 'Source-derived blocked reason', 'SAFE_BLOCK',
                 $5, ARRAY['owner'], 'private', $6, $6, 'ACTIVE')`,
      [
        `blocked-${randomUUID()}`,
        fixture.projectId,
        fixture.candidateId,
        hash('9'),
        hash('a'),
        fixture.now,
      ],
    );
    await adminPool.query(
      `INSERT INTO validation.results (
         validation_id, candidate_id, revision_number, project_id, source_version_id,
         status, dimensions, created_at
       ) VALUES ($1, $2, 1, $3, $4, 'READY', '{"source":"valid"}'::jsonb, $5)`,
      [randomUUID(), fixture.candidateId, fixture.projectId, fixture.sourceVersionId, fixture.now],
    );
    return { legacyId, comparisonId, analysisId };
  };

  it('purges in FK order and retains another Project candidate and comparison lineage', async () => {
    const projectId = `t3-derived-${randomUUID()}`;
    const otherProjectId = `t3-derived-other-${randomUUID()}`;
    const now = new Date('2026-09-23T01:00:00.000Z');
    await adminPool.query(
      `INSERT INTO project_admin.projects (id, name, status, active)
       VALUES ($1, 'T3 derived fixture', 'ACTIVE', true),
              ($2, 'T3 derived other fixture', 'ACTIVE', true)`,
      [projectId, otherProjectId],
    );
    const selectedCandidate = await seedCandidate(projectId, now);
    const otherCandidate = await seedCandidate(otherProjectId, now);
    const selectedComparison = await seedComparison(selectedCandidate);
    const otherComparison = await seedComparison(otherCandidate);
    const providerCallId = randomUUID();
    const providerAttemptId = randomUUID();
    const providerOutputId = randomUUID();
    await adminPool.query(
      `INSERT INTO ai.provider_calls (
         call_id, project_id, request_id, provider, model, prompt_version, policy_version,
         schema_name, data_classification, input_evidence_ids, status, call_json, created_at,
         source_version_id, access_scope, sensitivity, input_snapshot_digest, request_digest,
         durable_state, max_attempts, updated_at, revision_id
       ) VALUES ($1, $2, $3, 'test-provider', 'test-model', 'prompt-1', 'policy-1',
                 'ClaimCandidateBatch.v1', 'private', ARRAY[$4]::uuid[], 'succeeded', '{}'::jsonb, $5,
                 $6, ARRAY['owner'], 'private', $7, $8, 'COMPLETED', 1, $5, $9)`,
      [
        providerCallId,
        projectId,
        `provider-request-${randomUUID()}`,
        selectedCandidate.evidenceId,
        now,
        selectedCandidate.sourceVersionId,
        hash('a'),
        hash('b'),
        selectedCandidate.revisionId,
      ],
    );
    await adminPool.query(
      `INSERT INTO ai.provider_attempts (
         attempt_id, call_id, attempt_number, status, latency_ms, started_at, finished_at
       ) VALUES ($1, $2, 1, 'succeeded', 1, $3, $3)`,
      [providerAttemptId, providerCallId, now],
    );
    await adminPool.query(
      `INSERT INTO ai.provider_outputs (
         output_id, project_id, call_id, attempt_id, envelope_version, provider,
         adapter_version, model, schema_name, schema_version, prompt_version, policy_version,
         data_policy_version, output_text, content_digest, request_digest, input_snapshot_digest,
         model_version, usage_json, cost_json, received_at
       ) VALUES ($1, $2, $3, $4, 'ai-provider-output-v1', 'test-provider', '1',
                 'test-model', 'candidate', '1', 'prompt-1', 'policy-1', 'policy-1',
                 'source-derived provider output', $5, $6, $7, 'model-1', '{}'::jsonb, '{}'::jsonb, $8)`,
      [
        providerOutputId,
        projectId,
        providerCallId,
        providerAttemptId,
        hash('c'),
        hash('d'),
        hash('e'),
        now,
      ],
    );
    await adminPool.query(
      `UPDATE ai.provider_calls SET accepted_output_id = $2 WHERE call_id = $1`,
      [providerCallId, providerOutputId],
    );
    await adminPool.query(
      `INSERT INTO candidate.materializations (
         materialization_id, project_id, output_id, output_digest, input_snapshot_digest,
         materializer_version, batch_id, state, created_at, completed_at
       ) VALUES ($1, $2, $3, $4, $5, 'stage12-1-v1', $6, 'COMPLETED', $7, $7)`,
      [
        randomUUID(),
        projectId,
        providerOutputId,
        hash('b'),
        hash('c'),
        selectedCandidate.batchId,
        now,
      ],
    );

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
       ) VALUES ($1, $2, $3, 't3-derived-test', 1, 0, 1, $4, $5, $6, $7,
                 'FENCING', '{}'::jsonb)`,
      [requestId, randomUUID(), projectId, hash('d'), hash('e'), hash('f'), randomUUID()],
    );
    const context = {
      projectId,
      requestId,
      knowledgeEpoch: 1,
      manifestDigest: hash('d') as `sha256:${string}`,
    };
    await expect(
      executorPool.query('SELECT count(*) FROM candidate.claim_candidates'),
    ).rejects.toMatchObject({ code: '42501' });

    const comparisonOwner = new PostgresComparisonKnowledgeResetOwner(executorPool);
    const validationOwner = new PostgresValidationKnowledgeResetOwner(executorPool);
    const candidateOwner = new PostgresCandidateKnowledgeResetOwner(executorPool);
    await comparisonOwner.fence(context);
    await validationOwner.fence(context);
    await candidateOwner.fence(context);
    await adminPool.query(
      `UPDATE project_admin.project_knowledge_reset_requests SET state = 'PURGING'
       WHERE project_id = $1 AND request_id = $2`,
      [projectId, requestId],
    );
    await comparisonOwner.purge(context);
    await expect(comparisonOwner.verify(context)).resolves.toEqual({
      verified: true,
      blockerCodes: [],
    });
    await validationOwner.purge(context);
    await expect(validationOwner.verify(context)).resolves.toEqual({
      verified: true,
      blockerCodes: [],
    });
    await candidateOwner.purge(context);
    await expect(candidateOwner.verify(context)).resolves.toEqual({
      verified: true,
      blockerCodes: [],
    });

    const counts = await adminPool.query<{
      project_id: string;
      candidates: string;
      batches: string;
      materializations: string;
      validations: string;
      comparisons: string;
      semantic_rows: string;
    }>(
      `SELECT target.project_id,
         (SELECT count(*)::text FROM candidate.claim_candidates c WHERE c.project_id = target.project_id) AS candidates,
         (SELECT count(*)::text FROM candidate.batches b WHERE b.project_id = target.project_id) AS batches,
         (SELECT count(*)::text FROM candidate.materializations m WHERE m.project_id = target.project_id) AS materializations,
         (SELECT count(*)::text FROM validation.results v WHERE v.project_id = target.project_id) AS validations,
         (SELECT count(*)::text FROM comparison.results c WHERE c.project_id = target.project_id) AS comparisons,
         ((SELECT count(*) FROM comparison.results_v2 c WHERE c.project_id = target.project_id) +
          (SELECT count(*) FROM comparison.analysis_revisions_v2 a WHERE a.project_id = target.project_id) +
          (SELECT count(*) FROM comparison.relationships_v2 r WHERE r.project_id = target.project_id) +
          (SELECT count(*) FROM comparison.blocked_outcomes_v2 b WHERE b.project_id = target.project_id))::text AS semantic_rows
       FROM (VALUES ($1::text), ($2::text)) AS target(project_id)
       ORDER BY project_id`,
      [projectId, otherProjectId],
    );
    expect(counts.rows.find((row) => row.project_id === projectId)).toMatchObject({
      candidates: '0',
      batches: '0',
      materializations: '0',
      validations: '0',
      comparisons: '0',
      semantic_rows: '0',
    });
    expect(counts.rows.find((row) => row.project_id === otherProjectId)).toMatchObject({
      candidates: '1',
      batches: '1',
      materializations: '0',
      validations: '1',
      comparisons: '1',
      semantic_rows: '4',
    });
    expect(selectedComparison.legacyId).toBeTruthy();
    expect(otherComparison.legacyId).toBeTruthy();
  });
});
