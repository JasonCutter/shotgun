import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresExternalActionKnowledgeResetOwner } from '../../adapters/source-knowledge-reset-postgres/src/index.js';
import { PostgresKnowledgeResetImpactInspector } from '../../adapters/source-knowledge-reset-postgres/src/impact-inspector.js';
import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';

const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const hash = (character: string): string => `sha256:${character.repeat(64)}`;

describe('ADR-171 External Action erasure owner', () => {
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
       VALUES ($1, 'T3 external action fixture', 'ACTIVE', true)`,
      [projectId],
    );
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
       ) VALUES ($1, $2, $3, 't3-external-action-test', 1, 0, 1, $4, $5, $6, $7,
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

  const addCandidateAction = async (input: {
    projectId: string;
    actionId?: string;
    candidateId?: string;
    sourceId?: string;
    evidenceRefs?: readonly { evidenceSetId: string; evidenceSetDigest: string }[];
    status?: string;
    payloadCanary?: string;
  }) => {
    const actionId = input.actionId ?? `t3-action-${randomUUID()}`;
    const candidateId = input.candidateId ?? `t3-candidate-${randomUUID()}`;
    const now = new Date().toISOString();
    const sourceRefs = input.sourceId
      ? [
          {
            schemaVersion: '1.0.0',
            sourceKind: 'source',
            sourceId: input.sourceId,
            sourceRevision: '1',
            sourceDigest: hash('d'),
          },
        ]
      : [];
    const candidate = {
      schemaVersion: '1.0.0',
      candidateId,
      candidateRevision: 1,
      actionId,
      resourceProjectId: input.projectId,
      effectiveProjectId: input.projectId,
      generatedBy: { schemaVersion: '1.0.0', principalId: 't3-test', actorId: 't3-test' },
      sourceRefs,
      operation: 'CREATE_DRAFT',
      evidenceRefs: input.evidenceRefs ?? [],
      ...(input.payloadCanary ? { proposedTitle: input.payloadCanary } : {}),
    };
    const aggregate = {
      schemaVersion: '1.0.0',
      actionId,
      actionRevision: 1,
      resourceProjectId: input.projectId,
      effectiveProjectId: input.projectId,
      status: input.status ?? 'CANDIDATE_VALIDATED',
      aggregateState: 'AVAILABLE',
      ...(input.payloadCanary ? { sourceContext: input.payloadCanary } : {}),
    };
    await adminPool.query(
      `INSERT INTO frontend_external_action.aggregates (
         action_id, resource_project_id, effective_project_id, status, aggregate_state,
         action_revision, access_revision, policy_context_revision, snapshot, created_at, updated_at
       ) VALUES ($1, $2, $2, $3, 'AVAILABLE', 1, 'access-v1', 'policy-v1', $4, $5, $5)`,
      [actionId, input.projectId, input.status ?? 'CANDIDATE_VALIDATED', aggregate, now],
    );
    await adminPool.query(
      `INSERT INTO frontend_external_action.candidates (
         action_id, candidate_id, candidate_revision, resource_project_id,
         effective_project_id, candidate_digest, snapshot, created_at
       ) VALUES ($1, $2, 1, $3, $3, $4, $5, $6)`,
      [actionId, candidateId, input.projectId, hash('e'), candidate, now],
    );
    return { actionId, candidateId };
  };

  it('purges Source-linked unexecuted content, redacts audit payloads, and preserves independent data', async () => {
    const projectId = `t3-external-action-${randomUUID()}`;
    const otherProjectId = `t3-external-action-other-${randomUUID()}`;
    const sourceId = randomUUID();
    const payloadCanary = `source-action-payload-${randomUUID()}`;
    await createProject(projectId);
    await createProject(otherProjectId);
    await adminPool.query(
      `INSERT INTO asset.sources (source_id, project_id, created_by_actor_id, created_at)
       VALUES ($1, $2, 't3-test', now())`,
      [sourceId, projectId],
    );
    const linked = await addCandidateAction({ projectId, sourceId, payloadCanary });
    const independent = await addCandidateAction({ projectId });
    const otherProject = await addCandidateAction({ projectId: otherProjectId });
    const auditEventId = `t3-audit-${randomUUID()}`;
    const connectorId = `connector-${randomUUID()}`;
    await adminPool.query(
      `INSERT INTO frontend_external_action.audit_events (
         audit_event_id, action_id, resource_project_id, effective_project_id,
         sequence, category, snapshot, occurred_at
       ) VALUES ($1, $2, $3, $3, 1, 'ACTION_CANDIDATE_VALIDATED', $4, now())`,
      [
        auditEventId,
        linked.actionId,
        projectId,
        { schemaVersion: '1.0.0', actionId: linked.actionId, sourceId, payloadCanary },
      ],
    );
    await adminPool.query(
      `INSERT INTO frontend_external_action.history_payload_state (
         resource_project_id, source_event_kind, source_event_id, payload_availability,
         tombstone_metadata, changed_at, reason
       ) VALUES ($1, 'ACTION_AUDIT', $2, 'AVAILABLE', $3, now(), 'source-derived fixture')`,
      [projectId, auditEventId, { note: payloadCanary }],
    );
    await expect(
      adminPool.query(
        `UPDATE frontend_external_action.audit_events
         SET snapshot = '{"payload":"must remain immutable"}'::jsonb
         WHERE audit_event_id = $1`,
        [auditEventId],
      ),
    ).rejects.toThrow('append-only and immutable');
    await adminPool.query(
      `INSERT INTO frontend_external_action.credentials (connector_id, snapshot, created_at)
       VALUES ($1, $2, now())`,
      [connectorId, { token: 'credential-preserved' }],
    );
    await adminPool.query(
      `INSERT INTO frontend_external_action.budgets (project_id, snapshot, created_at, updated_at)
       VALUES ($1, $2, now(), now())`,
      [projectId, { remainingExecutions: 7, policy: 'preserved' }],
    );
    const context = await createReset(projectId);
    const impact = new PostgresKnowledgeResetImpactInspector(adminPool, true);
    const preview = await impact.inspectProjectSourceKnowledge(projectId);
    expect(preview.blockers).toEqual([]);
    expect(preview.counts.sourceDerivedRecordCount).toBeGreaterThanOrEqual(2);

    const owner = new PostgresExternalActionKnowledgeResetOwner(executorPool);
    await owner.fence(context);
    await executorPool.query(
      'SELECT project_admin.t3_set_reset_execution_state($1, $2::uuid, $3, $4::text[])',
      [projectId, context.requestId, 'PURGING', []],
    );
    await owner.purge(context);
    await expect(owner.verify(context)).resolves.toEqual({ verified: true, blockerCodes: [] });

    await expect(
      adminPool.query(
        `SELECT count(*)::int AS count FROM frontend_external_action.aggregates
         WHERE action_id = $1`,
        [linked.actionId],
      ),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
    await expect(
      adminPool.query(
        `SELECT count(*)::int AS count FROM frontend_external_action.candidates
         WHERE action_id = $1`,
        [linked.actionId],
      ),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
    await expect(
      adminPool.query(
        `SELECT snapshot FROM frontend_external_action.audit_events WHERE audit_event_id = $1`,
        [auditEventId],
      ),
    ).resolves.toMatchObject({
      rows: [{ snapshot: { schemaVersion: '1.0.0', payloadAvailability: 'PURGED_BY_T3' } }],
    });
    const historyState = await adminPool.query(
      `SELECT payload_availability, tombstone_metadata, reason, policy_revision
       FROM frontend_external_action.history_payload_state
       WHERE resource_project_id = $1 AND source_event_id = $2`,
      [projectId, auditEventId],
    );
    expect(historyState.rows).toMatchObject([
      {
        payload_availability: 'PURGED_BY_POLICY',
        tombstone_metadata: { policy: 'T3-ADR-171' },
        reason: 'T3_SOURCE_KNOWLEDGE_RESET',
        policy_revision: 'T3-ADR-171',
      },
    ]);
    expect(JSON.stringify(historyState.rows)).not.toContain(payloadCanary);
    await expect(
      adminPool.query(
        `SELECT count(*)::int AS count FROM frontend_external_action.aggregates
         WHERE action_id = ANY($1::text[])`,
        [[independent.actionId, otherProject.actionId]],
      ),
    ).resolves.toMatchObject({ rows: [{ count: 2 }] });
    await expect(
      adminPool.query(
        `SELECT snapshot FROM frontend_external_action.budgets WHERE project_id = $1`,
        [projectId],
      ),
    ).resolves.toMatchObject({
      rows: [{ snapshot: { remainingExecutions: 7, policy: 'preserved' } }],
    });
    await expect(
      adminPool.query(
        `SELECT snapshot FROM frontend_external_action.credentials WHERE connector_id = $1`,
        [connectorId],
      ),
    ).resolves.toMatchObject({ rows: [{ snapshot: { token: 'credential-preserved' } }] });
    expect(JSON.stringify(preview)).not.toContain(payloadCanary);
  });

  it('blocks a Source-linked Action with any execution record before mutating it', async () => {
    const projectId = `t3-external-action-executed-${randomUUID()}`;
    const sourceId = randomUUID();
    await createProject(projectId);
    await adminPool.query(
      `INSERT INTO asset.sources (source_id, project_id, created_by_actor_id, created_at)
       VALUES ($1, $2, 't3-test', now())`,
      [sourceId, projectId],
    );
    const action = await addCandidateAction({ projectId, sourceId });
    await adminPool.query(
      `INSERT INTO frontend_external_action.executions (
         execution_id, action_id, resource_project_id, effective_project_id,
         status, manifest_revision, snapshot, created_at, updated_at
       ) VALUES ($1, $2, $3, $3, 'SUCCEEDED', 1, $4, now(), now())`,
      [
        `execution-${randomUUID()}`,
        action.actionId,
        projectId,
        { schemaVersion: '1.0.0', actionId: action.actionId, status: 'SUCCEEDED' },
      ],
    );
    const context = await createReset(projectId);
    const preview = await new PostgresKnowledgeResetImpactInspector(
      adminPool,
      true,
    ).inspectProjectSourceKnowledge(projectId);
    expect(preview.blockers).toContain('EXTERNAL_ACTION_DEPENDENCY');

    const owner = new PostgresExternalActionKnowledgeResetOwner(executorPool);
    await expect(owner.fence(context)).rejects.toMatchObject({
      blockerCode: 'EXTERNAL_ACTION_DEPENDENCY',
    });
    await expect(
      adminPool.query(
        'SELECT count(*)::int AS count FROM frontend_external_action.aggregates WHERE action_id = $1',
        [action.actionId],
      ),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it('blocks evidence-only lineage when the evidence set cannot be resolved to a Source', async () => {
    const projectId = `t3-external-action-unresolved-${randomUUID()}`;
    await createProject(projectId);
    const action = await addCandidateAction({
      projectId,
      evidenceRefs: [{ evidenceSetId: `evidence-${randomUUID()}`, evidenceSetDigest: hash('f') }],
    });
    const context = await createReset(projectId);
    const preview = await new PostgresKnowledgeResetImpactInspector(
      adminPool,
      true,
    ).inspectProjectSourceKnowledge(projectId);
    expect(preview.blockers).toContain('UNCLASSIFIED_CONTENT');

    const owner = new PostgresExternalActionKnowledgeResetOwner(executorPool);
    await expect(
      adminPool.query(
        `UPDATE frontend_external_action.aggregates
         SET snapshot = jsonb_set(snapshot, '{sourceContext}', '"late write"'::jsonb)
         WHERE action_id = $1`,
        [action.actionId],
      ),
    ).rejects.toMatchObject({ constraint: 'project_knowledge_reset_write_fence' });
    await expect(owner.fence(context)).rejects.toMatchObject({
      blockerCode: 'UNCLASSIFIED_CONTENT',
    });
    await expect(
      adminPool.query(
        'SELECT count(*)::int AS count FROM frontend_external_action.aggregates WHERE action_id = $1',
        [action.actionId],
      ),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it('blocks cross-Project effective scope and prevents Project rebinding during the reset fence', async () => {
    const projectId = `t3-external-action-scope-${randomUUID()}`;
    const otherProjectId = `t3-external-action-scope-other-${randomUUID()}`;
    await createProject(projectId);
    await createProject(otherProjectId);
    const action = await addCandidateAction({ projectId });
    await adminPool.query(
      `UPDATE frontend_external_action.aggregates
       SET effective_project_id = $2,
           snapshot = jsonb_set(snapshot, '{effectiveProjectId}', to_jsonb($2::text))
       WHERE action_id = $1`,
      [action.actionId, otherProjectId],
    );
    await adminPool.query(
      `UPDATE frontend_external_action.candidates
       SET effective_project_id = $2,
           snapshot = jsonb_set(snapshot, '{effectiveProjectId}', to_jsonb($2::text))
       WHERE action_id = $1`,
      [action.actionId, otherProjectId],
    );
    const context = await createReset(projectId);
    const preview = await new PostgresKnowledgeResetImpactInspector(
      adminPool,
      true,
    ).inspectProjectSourceKnowledge(projectId);
    expect(preview.blockers).toContain('UNCLASSIFIED_CONTENT');

    await expect(
      adminPool.query(
        `UPDATE frontend_external_action.aggregates
         SET resource_project_id = $2 WHERE action_id = $1`,
        [action.actionId, otherProjectId],
      ),
    ).rejects.toMatchObject({ constraint: 't3_external_action_project_binding_immutable' });
    await expect(
      new PostgresExternalActionKnowledgeResetOwner(executorPool).fence(context),
    ).rejects.toMatchObject({ blockerCode: 'UNCLASSIFIED_CONTENT' });
  });
});
