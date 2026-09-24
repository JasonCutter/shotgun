import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresReviewKnowledgeResetOwner } from '../../adapters/source-knowledge-reset-postgres/src/index.js';
import { PostgresKnowledgeResetImpactInspector } from '../../adapters/source-knowledge-reset-postgres/src/impact-inspector.js';
import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';

const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const hash = (character: string): string => `sha256:${character.repeat(64)}`;

describe('ADR-171 Review erasure owner', () => {
  let database: Awaited<ReturnType<typeof createIsolatedPostgresTestDatabase>>;
  let adminPool: Pool;
  let executorPool: Pool;
  let owner: PostgresReviewKnowledgeResetOwner;

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
    owner = new PostgresReviewKnowledgeResetOwner(executorPool);
  });

  afterAll(async () => {
    await executorPool?.end();
    await adminPool?.query('ALTER ROLE shotgun_erasure_executor NOLOGIN PASSWORD NULL');
    await database?.dispose();
  });

  const createProject = async (projectId: string) => {
    await adminPool.query(
      `INSERT INTO project_admin.projects (id, name, status, active)
       VALUES ($1, 'T3 Review fixture', 'ACTIVE', true)`,
      [projectId],
    );
  };

  const addContext = async (input: {
    projectId: string;
    contextId: string;
    sourceToken?: string;
  }) => {
    const now = new Date().toISOString();
    await adminPool.query(
      `INSERT INTO frontend_review.context_revision (
         review_context_id, context_revision, review_resource_id, target_kind, target_id,
         target_revision, target_digest, resource_project_id, effective_project_id,
         access_revision, policy_context_revision, canonical_base, artifact_refs,
         aggregate_state, capabilities, generated_at, stale_reason, source_revision,
         source_digest, source_updated_at, materialized_at
       ) VALUES (
         $1, 1, $1, 'USER_DIRECTIVE_PROPOSAL', $2, '1', $3, $4, $4,
         'access-v1', 'policy-v1', NULL, '[]'::jsonb, 'PENDING', '{}'::jsonb,
         $5, NULL, 'revision-v1', $6, $5, $5
       )`,
      [input.contextId, `directive-${input.contextId}`, hash('a'), input.projectId, now, hash('b')],
    );
    await adminPool.query(
      `INSERT INTO frontend_review.item (
         review_context_id, context_revision, review_item_id, source_item_kind,
         source_item_id, source_item_revision, source_item_digest, target_ref, label,
         before_representation, after_representation, rationale, expected_impact,
         artifact_refs, allowed_decisions, decision_state, sensitivity, masked_fields,
         access_masking
       ) VALUES (
         $1, 1, $2, 'USER_DIRECTIVE_CLAUSE', $2, '1', $3, $4::jsonb, 'Fixture item',
         NULL, '{}'::jsonb, 'fixture rationale', NULL, '[]'::jsonb,
         '["APPROVE","REJECT"]'::jsonb, 'PENDING', 'NORMAL', '[]'::jsonb, 'VISIBLE'
       )`,
      [
        input.contextId,
        `item-${input.contextId}`,
        hash('c'),
        JSON.stringify(input.sourceToken ? { sourceId: input.sourceToken } : { independent: true }),
      ],
    );
    const decisionId = `decision-${input.contextId}`;
    const commentId = `comment-${input.contextId}`;
    await adminPool.query(
      `INSERT INTO frontend_review.decision (
         decision_id, review_context_id, context_revision, review_item_id, intent,
         reason, decided_by, decided_at, terminal
       ) VALUES ($1, $2, 1, $3, 'HOLD', 'fixture decision', '{}'::jsonb, $4, false)`,
      [decisionId, input.contextId, `item-${input.contextId}`, now],
    );
    await adminPool.query(
      `INSERT INTO frontend_review.comment (
         comment_id, review_context_id, context_revision, review_item_id,
         text, authored_by, authored_at
       ) VALUES ($1, $2, 1, $3, 'fixture comment', '{}'::jsonb, $4)`,
      [commentId, input.contextId, `item-${input.contextId}`, now],
    );
    return { decisionId, commentId };
  };

  const createReset = async (projectId: string) => {
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
       ) VALUES ($1, $2, $3, 't3-review-test', 1, 0, 1, $4, $5, $6, $7,
                 'FENCING', '{}'::jsonb)`,
      [requestId, randomUUID(), projectId, hash('a'), hash('b'), hash('c'), randomUUID()],
    );
    return {
      projectId,
      requestId,
      knowledgeEpoch: 1,
      manifestDigest: hash('a') as `sha256:${string}`,
    };
  };

  const beginPurge = async (projectId: string, requestId: string) => {
    await executorPool.query(
      'SELECT project_admin.t3_set_reset_execution_state($1, $2::uuid, $3, $4::text[])',
      [projectId, requestId, 'PURGING', []],
    );
    await executorPool.query('SELECT set_config($1, $2, false)', [
      'shotgun.t3_reset_request_id',
      requestId,
    ]);
  };

  it('purges Source-linked review content and retains independent review plus opaque identities', async () => {
    const projectId = `t3-review-${randomUUID()}`;
    await createProject(projectId);
    const sourceId = randomUUID();
    await adminPool.query(
      `INSERT INTO asset.sources (source_id, project_id, created_by_actor_id, created_at)
       VALUES ($1, $2, 't3-review-test', now())`,
      [sourceId, projectId],
    );
    const sourceContextId = `context-source-${randomUUID()}`;
    const independentContextId = `context-independent-${randomUUID()}`;
    const sourceEvents = await addContext({
      projectId,
      contextId: sourceContextId,
      sourceToken: sourceId,
    });
    await addContext({ projectId, contextId: independentContextId });
    const context = await createReset(projectId);

    await expect(
      adminPool.query('DELETE FROM frontend_review.context_revision WHERE review_context_id = $1', [
        sourceContextId,
      ]),
    ).rejects.toThrow('immutable');

    const before = await adminPool.query<{ impact: Record<string, unknown> }>(
      'SELECT review.t3_project_review_impact($1) AS impact',
      [projectId],
    );
    expect(Number(before.rows[0]?.impact.sourceDerivedRecordCount)).toBeGreaterThanOrEqual(4);
    expect(Number(before.rows[0]?.impact.unclassifiedRecordCount)).toBe(0);
    const preview = await new PostgresKnowledgeResetImpactInspector(
      adminPool,
      true,
    ).inspectProjectSourceKnowledge(projectId);
    expect(preview.blockers).not.toContain('UNCLASSIFIED_CONTENT');

    await owner.fence(context);
    await beginPurge(projectId, context.requestId);
    await owner.purge(context);
    const after = await adminPool.query<{ impact: Record<string, unknown> }>(
      'SELECT review.t3_project_review_impact($1) AS impact',
      [projectId],
    );
    expect(Number(after.rows[0]?.impact.sourceDerivedRecordCount)).toBe(0);
    expect(Number(after.rows[0]?.impact.unclassifiedRecordCount)).toBe(0);
    expect(await owner.verify(context)).toEqual({ verified: true, blockerCodes: [] });

    const remainingContexts = await adminPool.query<{ review_context_id: string }>(
      `SELECT review_context_id
       FROM frontend_review.context_revision
       WHERE review_context_id = ANY($1::text[])
       ORDER BY review_context_id`,
      [[sourceContextId, independentContextId]],
    );
    expect(remainingContexts.rows.map((row) => row.review_context_id)).toEqual([
      independentContextId,
    ]);
    const retainedIdentity = await adminPool.query<{
      event_kind: string;
      event_id: string;
      availability: string;
    }>(
      `SELECT source_event_kind AS event_kind, source_event_id AS event_id,
              payload_availability AS availability
       FROM frontend_review.history_payload_state
       WHERE resource_project_id = $1 AND source_event_id = ANY($2::text[])
       ORDER BY event_kind, event_id`,
      [projectId, [sourceEvents.decisionId, sourceEvents.commentId]],
    );
    expect(retainedIdentity.rows).toEqual([
      {
        event_kind: 'T3:frontend_review.comment',
        event_id: sourceEvents.commentId,
        availability: 'PURGED_BY_POLICY',
      },
      {
        event_kind: 'T3:frontend_review.decision',
        event_id: sourceEvents.decisionId,
        availability: 'PURGED_BY_POLICY',
      },
    ]);
    const audit = await adminPool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM frontend_review.history_payload_audit_events
       WHERE resource_project_id = $1
         AND source_event_id = ANY($2::text[])
         AND new_availability = 'PURGED_BY_POLICY'`,
      [projectId, [sourceEvents.decisionId, sourceEvents.commentId]],
    );
    expect(Number(audit.rows[0]?.count)).toBe(2);
    await executorPool.query('SELECT set_config($1, $2, false)', [
      'shotgun.t3_reset_request_id',
      '',
    ]);
  }, 60_000);

  it('blocks unresolved Source references without deleting review content', async () => {
    const projectId = `t3-review-unknown-${randomUUID()}`;
    await createProject(projectId);
    const contextId = `context-unknown-${randomUUID()}`;
    await addContext({
      projectId,
      contextId,
      sourceToken: randomUUID(),
    });
    const context = await createReset(projectId);

    await expect(owner.fence(context)).rejects.toMatchObject({
      blockerCode: 'UNCLASSIFIED_CONTENT',
    });
    const remains = await adminPool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM frontend_review.context_revision WHERE review_context_id = $1',
      [contextId],
    );
    expect(remains.rows[0]?.count).toBe('1');
  });
});
