import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresConnectorKnowledgeResetOwner } from '../../adapters/source-knowledge-reset-postgres/src/index.js';
import type { KnowledgeResetOwnerContext } from '../../modules/source-knowledge-reset/src/index.js';
import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';

const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const hash = (character: string): string => `sha256:${character.repeat(64)}`;

describe('ADR-171 Connector erasure owner', () => {
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

  const createProject = async (projectId: string) =>
    adminPool.query(
      `INSERT INTO project_admin.projects (id, name, status, active)
       VALUES ($1, 'T3 Connector fixture', 'ACTIVE', true)`,
      [projectId],
    );

  const addSourceAndEvent = async (projectId: string, messageType = 'EvidenceIndexed') => {
    const sourceId = randomUUID();
    const versionId = randomUUID();
    const revisionId = randomUUID();
    const assetId = randomUUID();
    const dedupId = randomUUID();
    const jobId = randomUUID();
    const now = new Date().toISOString();
    const contentHash = `sha256:${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`;
    await adminPool.query(
      `INSERT INTO asset.original_assets (asset_id, content_hash, size_bytes, storage_key, created_at)
       VALUES ($1, $2, 10, $3, $4)`,
      [assetId, contentHash, `t3-connector/${assetId}`, now],
    );
    await adminPool.query(
      `INSERT INTO asset.sources (source_id, project_id, created_by_actor_id, created_at)
       VALUES ($1, $2, 't3-connector-test', $3)`,
      [sourceId, projectId, now],
    );
    await adminPool.query(
      `INSERT INTO asset.source_versions (
         source_version_id, source_id, version_number, original_asset_id,
         media_type, access_scope, sensitivity, created_at
       ) VALUES ($1, $2, 1, $3, 'text/plain', ARRAY['project:owner'], 'private', $4)`,
      [versionId, sourceId, assetId, now],
    );
    await adminPool.query(
      `INSERT INTO transformation.revisions (
         revision_id, project_id, source_id, source_version_id, source_content_hash,
         transformer_id, transformer_version, document_ir, source_map, document_hash,
         source_map_hash, access_scope, sensitivity, created_at
       ) VALUES ($1, $2, $3, $4, $5, 't3-test', '1', '{}'::jsonb, '{}'::jsonb,
                 $6, $7, ARRAY['project:owner'], 'private', $8)`,
      [revisionId, projectId, sourceId, versionId, hash('b'), hash('c'), hash('d'), now],
    );
    await adminPool.query(
      `INSERT INTO connector.dedup_records (
         dedup_record_id, project_id, security_scope, consumer_id, message_kind,
         message_type, semantic_key, fingerprint, state, job_id, result, created_at, updated_at, completed_at
       ) VALUES ($1, $2, 'project', 'stage4-continuation', 'event', $3, $4, $5,
                 'COMPLETED', $6, '{}'::jsonb, now(), now(), now())`,
      [
        dedupId,
        projectId,
        messageType,
        messageType === 'EvidenceIndexed'
          ? `evidence-indexed:${projectId}:${revisionId}`
          : 'unclassified-connector-operation',
        hash('e'),
        jobId,
      ],
    );
    await adminPool.query(
      `INSERT INTO connector.jobs (job_id, dedup_record_id, correlation_id, status, created_at, updated_at)
       VALUES ($1, $2, 't3-correlation', 'succeeded', now(), now())`,
      [jobId, dedupId],
    );
    await adminPool.query(
      `INSERT INTO connector.job_attempts (
         attempt_id, job_id, attempt_number, worker_id, fencing_token,
         started_at, finished_at, status
       ) VALUES ($1, $2, 1, 't3-worker', 1, now(), now(), 'succeeded')`,
      [randomUUID(), jobId],
    );
    await adminPool.query(
      `INSERT INTO connector.ordering_checkpoints (
         project_id, security_scope, consumer_id, message_kind, message_type,
         ordering_key, last_sequence, claim_job_id
       ) VALUES ($1, 'project', 'stage4-continuation', 'event', $2, $3, 1, $4)`,
      [
        projectId,
        messageType,
        messageType === 'EvidenceIndexed'
          ? `evidence-indexed:${projectId}:${revisionId}`
          : 'unclassified-connector-operation',
        jobId,
      ],
    );
    return { sourceId, versionId, revisionId, dedupId, jobId };
  };

  const createReset = async (projectId: string): Promise<KnowledgeResetOwnerContext> => {
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
       ) VALUES ($1, $2, $3, 't3-connector-test', 1, 0, 1, $4, $5, $6, $7,
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

  const setState = async (context: KnowledgeResetOwnerContext, state: string) => {
    await executorPool.query(
      'SELECT project_admin.t3_set_reset_execution_state($1, $2::uuid, $3, $4::text[])',
      [context.projectId, context.requestId, state, []],
    );
  };

  it('purges a terminal Source-linked event chain and preserves another Project', async () => {
    const projectId = `t3-connector-${randomUUID()}`;
    const otherProjectId = `${projectId}-other`;
    await createProject(projectId);
    await createProject(otherProjectId);
    const selected = await addSourceAndEvent(projectId);
    const other = await addSourceAndEvent(otherProjectId);
    const context = await createReset(projectId);
    const owner = new PostgresConnectorKnowledgeResetOwner(executorPool);

    const impact = await adminPool.query<{
      impact: { sourceDerivedRecordCount: number; unclassifiedRecordCount: number };
    }>('SELECT connector.t3_project_connector_impact($1) AS impact', [projectId]);
    expect(impact.rows[0]?.impact.sourceDerivedRecordCount).toBe(4);
    expect(impact.rows[0]?.impact.unclassifiedRecordCount).toBe(0);

    await owner.fence(context);
    await setState(context, 'PURGING');
    await owner.purge(context);
    await owner.purge(context);
    await setState(context, 'VERIFYING');
    const status = await executorPool.query<{ status: unknown }>(
      'SELECT connector.t3_project_connector_status($1, $2::uuid) AS status',
      [context.projectId, context.requestId],
    );
    expect(status.rows[0]?.status).toMatchObject({
      purgeCompleted: true,
      remainingProjectRecordCount: 0,
    });
    await expect(owner.verify(context)).resolves.toEqual({ verified: true, blockerCodes: [] });

    const selectedRows = await adminPool.query<{ count: string }>(
      `SELECT (
         (SELECT count(*) FROM connector.dedup_records WHERE dedup_record_id = $1) +
         (SELECT count(*) FROM connector.jobs WHERE job_id = $2) +
         (SELECT count(*) FROM connector.ordering_checkpoints WHERE project_id = $3)
       )::text AS count`,
      [selected.dedupId, selected.jobId, projectId],
    );
    expect(selectedRows.rows[0]?.count).toBe('0');
    const otherRows = await adminPool.query<{ count: string }>(
      `SELECT (
         (SELECT count(*) FROM connector.dedup_records WHERE dedup_record_id = $1) +
         (SELECT count(*) FROM connector.jobs WHERE job_id = $2) +
         (SELECT count(*) FROM connector.ordering_checkpoints WHERE project_id = $3)
       )::text AS count`,
      [other.dedupId, other.jobId, otherProjectId],
    );
    expect(otherRows.rows[0]?.count).toBe('3');
  });

  it('blocks active Source jobs and connector records without Source lineage', async () => {
    const activeProjectId = `t3-connector-active-${randomUUID()}`;
    await createProject(activeProjectId);
    const active = await addSourceAndEvent(activeProjectId);
    await adminPool.query(
      `UPDATE connector.dedup_records SET state = 'IN_PROGRESS', completed_at = NULL
       WHERE dedup_record_id = $1`,
      [active.dedupId],
    );
    await adminPool.query(
      `UPDATE connector.jobs SET status = 'running', lease_owner = 'worker',
         lease_expires_at = now() + interval '5 minutes' WHERE job_id = $1`,
      [active.jobId],
    );
    const activeContext = await createReset(activeProjectId);
    const owner = new PostgresConnectorKnowledgeResetOwner(executorPool);
    await expect(owner.fence(activeContext)).rejects.toMatchObject({
      blockerCode: 'ACTIVE_JOB_OUTCOME_UNKNOWN',
    });

    const unknownProjectId = `t3-connector-unknown-${randomUUID()}`;
    await createProject(unknownProjectId);
    await addSourceAndEvent(unknownProjectId, 'UnclassifiedMessage');
    const unknownContext = await createReset(unknownProjectId);
    await expect(owner.fence(unknownContext)).rejects.toMatchObject({
      blockerCode: 'UNCLASSIFIED_CONTENT',
    });
  });
});
