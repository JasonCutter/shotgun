import { createHash, randomUUID } from 'node:crypto';

import { expect, it } from 'vitest';

import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import { PostgresProjectAdministrationRepository } from '../../adapters/postgres/src/index.js';
import { PostgresVPCandidatePolicyRefresh } from '../../adapters/vp-knowledge-postgres/src/candidate-policy-refresh.js';
import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';

const hash = (text: string): string => `sha256:${createHash('sha256').update(text).digest('hex')}`;

it('selects only a current, indexed, owner-visible SourceVersion with an outdated extraction batch', async () => {
  const database = await createIsolatedPostgresTestDatabase();
  const pool = database.createPool();
  try {
    const projectId = `vp-refresh-${randomUUID()}`;
    const principal = await new PostgresAuthRepository(pool).bootstrapLocalOwnerPrincipal({
      accountId: `vp-refresh-owner-${randomUUID()}`,
    });
    await new PostgresProjectAdministrationRepository(pool).createProject({
      commandId: randomUUID(),
      clientRequestId: randomUUID(),
      idempotencyKey: randomUUID(),
      projectId,
      name: 'VP policy refresh',
      description: 'historical direct claim policy',
      actorPrincipalId: principal.principalId,
      expectedProjectRevision: 0,
    });
    const sourceId = randomUUID();
    const versionId = randomUUID();
    const assetId = randomUUID();
    const revisionId = randomUUID();
    const indexingId = randomUUID();
    const text = '자산은 1억 원이다.';
    await pool.query(
      `INSERT INTO asset.original_assets
         (asset_id, content_hash, size_bytes, storage_key, created_at)
       VALUES ($1, $2, $3, $4, now())`,
      [assetId, hash(text), Buffer.byteLength(text), `vp-refresh-${assetId}`],
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
       VALUES ($1, $2, 1, $3, 'text/plain', '{owner}', 'private', now())`,
      [versionId, sourceId, assetId],
    );
    await pool.query(
      `INSERT INTO transformation.revisions
         (revision_id, project_id, source_id, source_version_id, source_content_hash,
          transformer_id, transformer_version, document_ir, source_map, document_hash,
          source_map_hash, access_scope, sensitivity, created_at)
       VALUES ($1, $2, $3, $4, $5, 'test-transformer', '1.0.0', '{}'::jsonb,
               '{}'::jsonb, $6, $7, '{owner}', 'private', now())`,
      [revisionId, projectId, sourceId, versionId, hash(text), hash(text), hash(sourceId)],
    );
    await pool.query(
      `INSERT INTO evidence.indexing_results
         (indexing_result_id, project_id, source_id, source_version_id, revision_id,
          transformer_id, transformer_version, status, evidence_count, reused_count,
          evidence_set_digest, contract_version, security_scope_digest, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'test-transformer', '1.0.0', 'INDEXED', 1, 0,
               $6, 'stage3-evidence-index.v1', $7, now(), now())`,
      [indexingId, projectId, sourceId, versionId, revisionId, hash('evidence'), hash('owner')],
    );
    await pool.query(
      `INSERT INTO source_product.source_stage3_progress
         (project_id, source_id, source_version_id, state, indexing_result_id,
          created_at, updated_at)
       VALUES ($1, $2, $3, 'STAGE3_COMPLETED', $4, now(), now())`,
      [projectId, sourceId, versionId, indexingId],
    );
    const store = new PostgresVPCandidatePolicyRefresh(pool);
    expect(await store.nextOutdated('direct-claim-v2')).toBeUndefined();
    await pool.query(
      `INSERT INTO candidate.batches
         (batch_id, project_id, source_version_id, revision_id,
          idempotency_key, provider_call, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, now())`,
      [
        randomUUID(),
        projectId,
        versionId,
        revisionId,
        randomUUID(),
        JSON.stringify({ promptVersion: 'direct-claim-v1' }),
      ],
    );
    expect(await store.nextOutdated('direct-claim-v2')).toEqual({
      projectId,
      sourceVersionId: versionId,
      revisionId,
      accessScope: ['owner'],
      sensitivity: 'private',
    });
    await pool.query(
      `UPDATE asset.source_versions SET access_scope = '{reader}' WHERE source_version_id = $1`,
      [versionId],
    );
    expect(await store.nextOutdated('direct-claim-v2')).toBeUndefined();
    await pool.query(
      `UPDATE asset.source_versions SET access_scope = '{owner}' WHERE source_version_id = $1`,
      [versionId],
    );
    await pool.query(
      `INSERT INTO candidate.batches
         (batch_id, project_id, source_version_id, revision_id,
          idempotency_key, provider_call, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, now())`,
      [
        randomUUID(),
        projectId,
        versionId,
        revisionId,
        randomUUID(),
        JSON.stringify({ promptVersion: 'direct-claim-v2' }),
      ],
    );
    expect(await store.nextOutdated('direct-claim-v2')).toBeUndefined();
  } finally {
    await database.dispose();
  }
});
