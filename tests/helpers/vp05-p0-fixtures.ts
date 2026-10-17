// Reused from Canonical main tests/database/vp-relation-priority.database.test.ts.
// Synthetic SourceVersion/Evidence fixture only; never production data.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'pg';
const hash = (value: string) => 'sha256:' + createHash('sha256').update(value).digest('hex');
export const seedAssertion = async (
  pool: Pool,
  input: {
    projectId: string;
    principalId: string;
    assertionId: string;
    text: string;
    sourceText?: string;
    assetRoot?: string;
    materialize?: boolean;
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
  const sourceText = input.sourceText ?? text;
  const storageKey = `vp-priority-${assetId}`;
  if (input.assetRoot) {
    await mkdir(input.assetRoot, { recursive: true });
    await writeFile(path.join(input.assetRoot, storageKey), sourceText);
  }
  await pool.query(
    `INSERT INTO asset.original_assets
       (asset_id, content_hash, size_bytes, storage_key, created_at)
     VALUES ($1, $2, $3, $4, now())`,
    [assetId, hash(sourceText), Buffer.byteLength(sourceText), storageKey],
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
    [
      revisionId,
      projectId,
      sourceId,
      sourceVersionId,
      hash(sourceText),
      hash(sourceText),
      hash(sourceId),
    ],
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
      JSON.stringify({ start: 0, end: sourceText.length }),
      JSON.stringify({ exact: sourceText }),
      hash(sourceText),
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
    `INSERT INTO validation.results
       (validation_id, candidate_id, revision_number, project_id,
        source_version_id, status, dimensions, created_at)
     VALUES ($1, $2, 1, $3, $4, 'READY', '[]'::jsonb, now())`,
    [randomUUID(), candidateId, projectId, sourceVersionId],
  );
  if (input.materialize !== false)
    await pool.query(
      `INSERT INTO vp.assertions
       (assertion_id, project_id, candidate_id, source_id, source_version_id,
        evidence_id, claim_text, origin, access_scope, sensitivity, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'DIRECT_SOURCE', '{owner}', 'public', now())`,
      [assertionId, projectId, candidateId, sourceId, sourceVersionId, evidenceId, text],
    );
};
