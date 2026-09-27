import { createHash, randomUUID } from 'node:crypto';

import type { Pool } from 'pg';
import { expect, it } from 'vitest';

import { PostgresVPRelationJobs } from '../../adapters/vp-knowledge-postgres/src/relation-jobs.js';
import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import { PostgresProjectAdministrationRepository } from '../../adapters/postgres/src/index.js';
import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';

const hash = (text: string): string => `sha256:${createHash('sha256').update(text).digest('hex')}`;

const seedAssertion = async (
  pool: Pool,
  input: {
    projectId: string;
    principalId: string;
    assertionId: string;
    text: string;
  },
): Promise<void> => {
  const sourceId = randomUUID();
  const sourceVersionId = randomUUID();
  const assetId = randomUUID();
  const revisionId = randomUUID();
  const evidenceId = randomUUID();
  const candidateId = randomUUID();
  const batchId = randomUUID();
  const indexingId = randomUUID();
  const { projectId, principalId, assertionId, text } = input;
  await pool.query(
    `INSERT INTO asset.original_assets
       (asset_id, content_hash, size_bytes, storage_key, created_at)
     VALUES ($1, $2, $3, $4, now())`,
    [assetId, hash(text), Buffer.byteLength(text), `vp-priority-${assetId}`],
  );
  await pool.query(
    `INSERT INTO asset.sources (source_id, project_id, created_by_actor_id, created_at)
     VALUES ($1, $2, $3, now())`,
    [sourceId, projectId, principalId],
  );
  await pool.query(
    `INSERT INTO asset.source_versions
       (source_version_id, source_id, version_number, original_asset_id,
        media_type, access_scope, sensitivity, created_at)
     VALUES ($1, $2, 1, $3, 'text/plain', '{owner}', 'public', now())`,
    [sourceVersionId, sourceId, assetId],
  );
  await pool.query(
    `INSERT INTO transformation.revisions
       (revision_id, project_id, source_id, source_version_id, source_content_hash,
        transformer_id, transformer_version, document_ir, source_map, document_hash,
        source_map_hash, access_scope, sensitivity, created_at)
     VALUES ($1, $2, $3, $4, $5, 'test-transformer', '1.0.0', '{}'::jsonb,
             '{}'::jsonb, $6, $7, '{owner}', 'public', now())`,
    [revisionId, projectId, sourceId, sourceVersionId, hash(text), hash(text), hash(sourceId)],
  );
  await pool.query(
    `INSERT INTO evidence.spans
       (evidence_id, revision_id, project_id, source_id, source_version_id,
        pointer, node_kind, origin, position, quote, exact_hash,
        access_scope, sensitivity, created_at)
     VALUES ($1, $2, $3, $4, $5, '/paragraph[1]/sentence[1]', 'sentence',
             'source', $6::jsonb, $7::jsonb, $8, '{owner}', 'public', now())`,
    [
      evidenceId,
      revisionId,
      projectId,
      sourceId,
      sourceVersionId,
      JSON.stringify({ start: 0, end: text.length }),
      JSON.stringify({ exact: text }),
      hash(text),
    ],
  );
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
      hash('owner-public'),
    ],
  );
  await pool.query(
    `INSERT INTO source_product.source_stage3_progress
       (project_id, source_id, source_version_id, state, indexing_result_id,
        created_at, updated_at)
     VALUES ($1, $2, $3, 'STAGE3_COMPLETED', $4, now(), now())`,
    [projectId, sourceId, sourceVersionId, indexingId],
  );
  await pool.query(
    `INSERT INTO candidate.batches
       (batch_id, project_id, source_version_id, revision_id,
        idempotency_key, provider_call, created_at)
     VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, now())`,
    [batchId, projectId, sourceVersionId, revisionId, `vp-priority-${batchId}`],
  );
  await pool.query(
    `INSERT INTO candidate.claim_candidates
       (candidate_id, batch_id, project_id, source_version_id,
        revision_number, claim_text, evidence_id, evidence_mode,
        extraction_profile, status, provider_call, access_scope,
        sensitivity, created_at)
     VALUES ($1, $2, $3, $4, 1, $5, $6, 'DIRECT_EVIDENCE',
             'direct-only', 'READY', '{}'::jsonb, '{owner}', 'public', now())`,
    [candidateId, batchId, projectId, sourceVersionId, text, evidenceId],
  );
  await pool.query(
    `INSERT INTO vp.assertions
       (assertion_id, project_id, candidate_id, source_id, source_version_id,
        evidence_id, claim_text, origin, access_scope, sensitivity, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'DIRECT_SOURCE', '{owner}', 'public', now())`,
    [assertionId, projectId, candidateId, sourceId, sourceVersionId, evidenceId, text],
  );
};

it('prioritizes the related cross-source pair before an older unrelated pair', async () => {
  const database = await createIsolatedPostgresTestDatabase();
  const pool = database.createPool();
  try {
    const projectId = `vp-priority-${randomUUID()}`;
    const principal = await new PostgresAuthRepository(pool).bootstrapLocalOwnerPrincipal({
      accountId: `vp-priority-owner-${randomUUID()}`,
    });
    await new PostgresProjectAdministrationRepository(pool).createProject({
      commandId: randomUUID(),
      clientRequestId: randomUUID(),
      idempotencyKey: randomUUID(),
      projectId,
      name: 'VP relation priority',
      description: 'related pair before older unrelated pair',
      actorPrincipalId: principal.principalId,
      expectedProjectRevision: 0,
    });
    const anchor = '00000000-0000-4000-8000-000000000001';
    const unrelated = '00000000-0000-4000-8000-000000000002';
    const related = '00000000-0000-4000-8000-000000000003';
    await seedAssertion(pool, {
      projectId,
      principalId: principal.principalId,
      assertionId: anchor,
      text: '자산 = 부채 + 자본',
    });
    await seedAssertion(pool, {
      projectId,
      principalId: principal.principalId,
      assertionId: unrelated,
      text: '달빛 연구소에는 사과나무 세 그루가 있다.',
    });
    await seedAssertion(pool, {
      projectId,
      principalId: principal.principalId,
      assertionId: related,
      text: '자산 = 부채 + 자본이다.',
    });
    const jobs = new PostgresVPRelationJobs(pool);
    expect(await jobs.enqueueCurrentPairs(`vp-priority-${randomUUID()}`, 1)).toBe(1);
    const selected = await pool.query<{ left_assertion_id: string; right_assertion_id: string }>(
      `SELECT left_assertion_id::text, right_assertion_id::text
         FROM vp.relation_jobs WHERE project_id = $1`,
      [projectId],
    );
    expect(selected.rows).toEqual([{ left_assertion_id: anchor, right_assertion_id: related }]);
  } finally {
    await database.dispose();
  }
}, 60_000);
