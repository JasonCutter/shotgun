import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresKnowledgeGraphResetOwner } from '../../adapters/source-knowledge-reset-postgres/src/index.js';
import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';

const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const hash = (character: string): string => `sha256:${character.repeat(64)}`;

describe('ADR-171 knowledge graph projection erasure owner', () => {
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

  const seedViews = async (projectId: string) => {
    const snapshotId = `snapshot-${randomUUID()}`;
    const now = new Date('2026-09-23T01:00:00.000Z');
    await adminPool.query(
      `INSERT INTO frontend_knowledge_graph.snapshot_context (
         snapshot_id, project_id, view_kind, overlay_kinds, root_refs, normalized_filters,
         filters_digest, limits, access_revision, policy_context_revision, projection_revision,
         generated_at, expires_at
       ) VALUES ($1, $2, 'KNOWLEDGE_SEMANTIC', '[]'::jsonb, $3::jsonb, '{}'::jsonb,
                 $4, '{}'::jsonb, 'access-1', 'policy-1', 'projection-1',
                 $5::timestamptz, $5::timestamptz + interval '1 day')`,
      [
        snapshotId,
        projectId,
        JSON.stringify([{ kind: 'SOURCE', id: randomUUID() }]),
        hash('a'),
        now,
      ],
    );
    await adminPool.query(
      `INSERT INTO frontend_knowledge_graph.projection_health (
         project_id, view_kind, projection_revision, status, generated_at, lag, rebuild_state,
         access_revision, policy_context_revision
       ) VALUES ($1, 'KNOWLEDGE_SEMANTIC', 'projection-1', 'COMPLETE', $2, 0, 'IDLE', 'access-1', 'policy-1')`,
      [projectId, now],
    );
    await adminPool.query(
      `INSERT INTO frontend_knowledge_graph.overlay_health (
         project_id, base_snapshot_id, overlay_kind, overlay_snapshot_id, overlay_revision,
         analyzer_revision, policy_context_revision, generated_at, completeness, truncation,
         unavailable_reason
       ) VALUES ($1, $2, 'CONFLICT', $3, 'overlay-1', 'analyzer-1', 'policy-1', $4,
                 'COMPLETE', NULL, NULL)`,
      [projectId, snapshotId, `overlay-${randomUUID()}`, now],
    );
    await adminPool.query(
      `INSERT INTO frontend_knowledge_graph.continuation (
         token, expires_at, principal_id, session_id, project_id, access_revision,
         policy_context_revision, snapshot_id, root_ref, filters_digest, view_kind,
         overlay_kinds, limits
       ) VALUES ($1, $2, 'principal', 'session', $3, 'access-1', 'policy-1', $4,
                 NULL, $5, 'KNOWLEDGE_SEMANTIC', '[]'::jsonb, '{}'::jsonb)`,
      [
        `token-${randomUUID()}`,
        new Date('2026-09-24T01:00:00.000Z'),
        projectId,
        snapshotId,
        hash('b'),
      ],
    );
  };

  it('invalidates selected Project graph snapshots while retaining another Project and immutable writes', async () => {
    const projectId = `t3-graph-${randomUUID()}`;
    const otherProjectId = `t3-graph-other-${randomUUID()}`;
    await seedViews(projectId);
    await seedViews(otherProjectId);
    await expect(
      adminPool.query(
        'DELETE FROM frontend_knowledge_graph.snapshot_context WHERE project_id = $1',
        [projectId],
      ),
    ).rejects.toMatchObject({
      code: '55000',
      constraint: 'frontend_graph_snapshot_context_immutable',
    });

    const requestId = randomUUID();
    await adminPool.query(
      `INSERT INTO project_admin.projects (id, name, status, active)
       VALUES ($1, 'T3 graph fixture', 'ACTIVE', true)`,
      [projectId],
    );
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
       ) VALUES ($1, $2, $3, 't3-graph-test', 1, 0, 1, $4, $5, $6, $7,
                 'FENCING', '{}'::jsonb)`,
      [requestId, randomUUID(), projectId, hash('c'), hash('d'), hash('e'), randomUUID()],
    );
    const context = {
      projectId,
      requestId,
      knowledgeEpoch: 1,
      manifestDigest: hash('c') as `sha256:${string}`,
    };
    const owner = new PostgresKnowledgeGraphResetOwner(executorPool);
    await owner.fence(context);
    await adminPool.query(
      `UPDATE project_admin.project_knowledge_reset_requests SET state = 'PURGING'
       WHERE project_id = $1 AND request_id = $2`,
      [projectId, requestId],
    );
    await owner.purge(context);
    await expect(owner.verify(context)).resolves.toEqual({ verified: true, blockerCodes: [] });

    const counts = await adminPool.query<{
      project_id: string;
      snapshots: string;
      health: string;
      overlays: string;
      continuations: string;
    }>(
      `SELECT target.project_id,
         (SELECT count(*)::text FROM frontend_knowledge_graph.snapshot_context row WHERE row.project_id = target.project_id) AS snapshots,
         (SELECT count(*)::text FROM frontend_knowledge_graph.projection_health row WHERE row.project_id = target.project_id) AS health,
         (SELECT count(*)::text FROM frontend_knowledge_graph.overlay_health row WHERE row.project_id = target.project_id) AS overlays,
         (SELECT count(*)::text FROM frontend_knowledge_graph.continuation row WHERE row.project_id = target.project_id) AS continuations
       FROM (VALUES ($1::text), ($2::text)) AS target(project_id)
       ORDER BY project_id`,
      [projectId, otherProjectId],
    );
    expect(counts.rows.find((row) => row.project_id === projectId)).toMatchObject({
      snapshots: '0',
      health: '0',
      overlays: '0',
      continuations: '0',
    });
    expect(counts.rows.find((row) => row.project_id === otherProjectId)).toMatchObject({
      snapshots: '1',
      health: '1',
      overlays: '1',
      continuations: '1',
    });
  });
});
