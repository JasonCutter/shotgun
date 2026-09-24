import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  PostgresActivityKnowledgeResetOwner,
  type ActivityResetProjection,
} from '../../adapters/source-knowledge-reset-postgres/src/index.js';
import { PostgresKnowledgeResetImpactInspector } from '../../adapters/source-knowledge-reset-postgres/src/impact-inspector.js';
import type { KnowledgeResetOwnerContext } from '../../modules/source-knowledge-reset/src/index.js';
import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';

const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const hash = (character: string): string => `sha256:${character.repeat(64)}`;

describe('ADR-171 Activity erasure owner', () => {
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

  const createProject = async (projectId: string) => {
    await adminPool.query(
      `INSERT INTO project_admin.projects (id, name, status, active)
       VALUES ($1, 'T3 Activity fixture', 'ACTIVE', true)`,
      [projectId],
    );
    await adminPool.query(
      `INSERT INTO canonical.project_state (project_id, version, snapshot_digest, updated_at)
       VALUES ($1, 2, $2, now())`,
      [projectId, hash('a')],
    );
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
       ) VALUES ($1, $2, $3, 't3-activity-test', 1, 0, 1, $4, $5, $6, $7,
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

  const addActivity = async (
    projectId: string,
    domainKind: 'SOURCES' | 'ASK',
    canary: string,
    activityId: string,
    revision = 5,
  ) => {
    await adminPool.query(
      `INSERT INTO frontend_activity.activity_index (
         resource_project_id, activity_id, domain_kind, root_kind,
         domain_resource_kind, domain_resource_id, domain_resource_revision,
         resource_href, job_id, run_id, summary, state, attention, retryability,
         freshness, adapter_status, snapshot_revision, snapshot, projected_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8, $9, $10, 'SUCCEEDED',
                 'NONE', 'NOT_RETRYABLE', 'CURRENT', 'AVAILABLE', $11, $12::jsonb, now(), now())`,
      [
        projectId,
        activityId,
        domainKind,
        domainKind === 'ASK' ? 'RUN' : 'JOB',
        domainKind === 'ASK' ? 'AnswerRun' : 'IntakeSubmission',
        `${domainKind.toLowerCase()}-resource-${activityId}`,
        `/activity/${activityId}`,
        domainKind === 'ASK' ? null : `job-${activityId}`,
        `run-${activityId}`,
        canary,
        revision,
        JSON.stringify({ sourceCanary: canary }),
      ],
    );
  };

  const addWatermark = async (projectId: string, revision = 5) => {
    await adminPool.query(
      `INSERT INTO frontend_activity.projection_watermarks (
         resource_project_id, adapter_id, domain_kind, projected_at, adapter_status,
         snapshot_revision, updated_at
       ) VALUES ($1, 'ask-adapter', 'ASK', now(), 'AVAILABLE', $2, now())`,
      [projectId, revision],
    );
  };

  it('rebuilds Project Activity from surviving owners and preserves other Projects', async () => {
    const projectId = `t3-activity-${randomUUID()}`;
    const otherProjectId = `${projectId}-other`;
    await createProject(projectId);
    await createProject(otherProjectId);
    await addActivity(projectId, 'SOURCES', 'T3_ACTIVITY_SOURCE_CANARY', 'source-activity');
    await addActivity(projectId, 'ASK', 'OLD_ASK_ACTIVITY_CANARY', 'old-ask-activity');
    await addWatermark(projectId);
    await addActivity(otherProjectId, 'SOURCES', 'OTHER_PROJECT_ACTIVITY', 'other-activity');
    await addWatermark(otherProjectId);

    const preview = await new PostgresKnowledgeResetImpactInspector(
      adminPool,
      true,
    ).inspectProjectSourceKnowledge(projectId);
    expect(preview.counts.rebuildProjectionCount).toBeGreaterThanOrEqual(3);

    const context = await createReset(projectId);
    const now = new Date().toISOString();
    const rebuilt: ActivityResetProjection = {
      records: [
        {
          resourceProjectId: projectId,
          activityId: 'surviving-independent-ask',
          domainKind: 'ASK',
          rootKind: 'RUN',
          domainResourceKind: 'AnswerRun',
          domainResourceId: 'independent-answer-run',
          resourceHref: '/activity/independent-answer-run',
          runId: 'independent-answer-run',
          summary: 'Independent Ask remains available',
          state: 'SUCCEEDED',
          attention: 'NONE',
          retryability: 'NOT_RETRYABLE',
          freshness: 'CURRENT',
          adapterStatus: 'AVAILABLE',
          snapshotRevision: 1,
          snapshot: { sourceCanary: 'clean' },
          projectedAt: now,
          updatedAt: now,
        },
      ],
      watermarks: (['SOURCES', 'ASK', 'EXTERNAL_ACTION', 'DISCOVERY'] as const).map(
        (domainKind) => ({
          resourceProjectId: projectId,
          adapterId: `${domainKind.toLowerCase()}-adapter`,
          domainKind,
          projectedAt: now,
          adapterStatus: 'AVAILABLE',
          snapshotRevision: 1,
          updatedAt: now,
        }),
      ),
      partial: false,
      failures: [],
    };
    const owner = new PostgresActivityKnowledgeResetOwner(executorPool, {
      async rebuildProjectActivity(input) {
        expect(input).toEqual(context);
        return rebuilt;
      },
    });

    await owner.fence(context);
    await expect(
      adminPool.query(
        `DELETE FROM frontend_activity.activity_index WHERE resource_project_id = $1`,
        [projectId],
      ),
    ).rejects.toMatchObject({ constraint: 'project_knowledge_reset_write_fence' });
    await setState(context, 'PURGING');
    await owner.purge(context);
    await owner.purge(context);
    await expect(owner.verify(context)).resolves.toEqual({
      verified: false,
      blockerCodes: ['UNCLASSIFIED_CONTENT'],
    });
    await setState(context, 'REBUILDING');
    await owner.rebuild(context);
    await expect(owner.verify(context)).resolves.toEqual({ verified: true, blockerCodes: [] });

    const selectedRows = await adminPool.query<{
      domain_kind: string;
      summary: string;
      snapshot_revision: string;
    }>(
      `SELECT domain_kind, summary, snapshot_revision
       FROM frontend_activity.activity_index WHERE resource_project_id = $1`,
      [projectId],
    );
    expect(selectedRows.rows).toEqual([
      {
        domain_kind: 'ASK',
        summary: 'Independent Ask remains available',
        snapshot_revision: '6',
      },
    ]);
    const canaries = await adminPool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM frontend_activity.activity_index
       WHERE resource_project_id = $1 AND snapshot::text LIKE '%CANARY%'`,
      [projectId],
    );
    expect(canaries.rows[0]?.count).toBe('0');
    const otherRows = await adminPool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM frontend_activity.activity_index WHERE resource_project_id = $1',
      [otherProjectId],
    );
    expect(otherRows.rows[0]?.count).toBe('1');
  }, 60_000);

  it('rejects partial Activity rebuilds and discards fence data before mutation on BLOCKED', async () => {
    const projectId = `t3-activity-blocked-${randomUUID()}`;
    await createProject(projectId);
    const context = await createReset(projectId);
    const owner = new PostgresActivityKnowledgeResetOwner(executorPool, {
      async rebuildProjectActivity() {
        return { records: [], watermarks: [], partial: true, failures: ['adapter unavailable'] };
      },
    });
    await owner.fence(context);
    await setState(context, 'BLOCKED');
    const checkpoint = await adminPool.query<{ present: boolean }>(
      `SELECT step_checkpoints ? 't3ActivityFenceSnapshot' AS present
       FROM project_admin.project_knowledge_reset_requests
       WHERE project_id = $1 AND request_id = $2`,
      [projectId, context.requestId],
    );
    expect(checkpoint.rows[0]?.present).toBe(false);
  });
});
