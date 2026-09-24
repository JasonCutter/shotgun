import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresActionKnowledgeResetOwner } from '../../adapters/source-knowledge-reset-postgres/src/index.js';
import { PostgresKnowledgeResetImpactInspector } from '../../adapters/source-knowledge-reset-postgres/src/impact-inspector.js';
import { PostgresActionExecutionRepository } from '../../adapters/postgres-stage11/src/index.js';
import { actionServerCandidate } from '../helpers/stage-11.js';
import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';

const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const hash = (character: string): string => `sha256:${character.repeat(64)}`;

describe('ADR-171 Stage 11 Action erasure owner', () => {
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
       VALUES ($1, 'T3 Action fixture', 'ACTIVE', true)`,
      [projectId],
    );
  };

  const createSourceEvidence = async (projectId: string) => {
    const sourceId = randomUUID();
    const sourceVersionId = randomUUID();
    const assetId = randomUUID();
    const revisionId = randomUUID();
    const evidenceId = randomUUID();
    const now = new Date().toISOString();
    await adminPool.query(
      `INSERT INTO asset.sources (source_id, project_id, created_by_actor_id, created_at)
       VALUES ($1, $2, 't3-test', $3)`,
      [sourceId, projectId, now],
    );
    await adminPool.query(
      `INSERT INTO asset.original_assets (asset_id, content_hash, size_bytes, storage_key, created_at)
       VALUES ($1, $2, 100, $3, $4)`,
      [assetId, `sha256:${assetId.replaceAll('-', '').repeat(2)}`, `t3-action/${assetId}`, now],
    );
    await adminPool.query(
      `INSERT INTO asset.source_versions (
         source_version_id, source_id, version_number, original_asset_id,
         media_type, access_scope, sensitivity, created_at
       ) VALUES ($1, $2, 1, $3, 'text/plain', ARRAY['project:owner'], 'private', $4)`,
      [sourceVersionId, sourceId, assetId, now],
    );
    await adminPool.query(
      `INSERT INTO transformation.revisions (
         revision_id, project_id, source_id, source_version_id, source_content_hash,
         transformer_id, transformer_version, document_ir, source_map, document_hash,
         source_map_hash, access_scope, sensitivity, created_at
       ) VALUES ($1, $2, $3, $4, $5, 't3-test', '1.0.0', '{}'::jsonb, '{}'::jsonb,
                 $6, $7, ARRAY['project:owner'], 'private', $8)`,
      [revisionId, projectId, sourceId, sourceVersionId, hash('b'), hash('c'), hash('d'), now],
    );
    await adminPool.query(
      `INSERT INTO evidence.spans (
         evidence_id, revision_id, project_id, source_id, source_version_id,
         pointer, node_kind, origin, position, quote, exact_hash, access_scope,
         sensitivity, created_at
       ) VALUES ($1, $2, $3, $4, $5, '/paragraph/1', 'paragraph', 'source',
                 '{"start":0,"end":16}'::jsonb, '{"text":"private evidence"}'::jsonb,
                 $6, ARRAY['project:owner'], 'private', $7)`,
      [evidenceId, revisionId, projectId, sourceId, sourceVersionId, hash('e'), now],
    );
    return { sourceId, sourceVersionId, evidenceId };
  };

  const addAction = async (input: {
    projectId: string;
    candidateId?: string;
    actionId?: string;
    evidenceId?: string;
    status?: string;
    payloadCanary?: string;
    withApproval?: boolean;
  }) => {
    const candidateId = input.candidateId ?? `t3-candidate-${randomUUID()}`;
    const actionId = input.actionId ?? randomUUID();
    const now = new Date().toISOString();
    const base = actionServerCandidate(randomUUID(), { projectId: input.projectId });
    const candidate = {
      ...base,
      candidate: {
        ...base.candidate,
        candidateId,
        validation: {
          ...base.candidate.validation,
          evidenceIds: input.evidenceId ? [input.evidenceId] : [],
        },
        ...(input.payloadCanary ? { parameters: { title: input.payloadCanary } } : {}),
      },
      evidence: input.evidenceId ? [{ evidenceId: input.evidenceId, digest: hash('f') }] : [],
      ...(input.payloadCanary ? { sourceContext: input.payloadCanary } : {}),
    };
    const preview = {
      schemaVersion: 'action-preview-snapshot-v1',
      actionId,
      projectId: input.projectId,
      candidate: candidate.candidate,
      evidence: candidate.evidence,
      ...(input.payloadCanary ? { renderedPayload: { title: input.payloadCanary } } : {}),
    };
    const status = input.status ?? (input.withApproval ? 'APPROVED' : 'PREVIEW_READY');
    const record = {
      schemaVersion: '1.0.0',
      actionId,
      projectId: input.projectId,
      status,
      preview,
      createdAt: now,
      updatedAt: now,
      ...(input.payloadCanary ? { sourceContext: input.payloadCanary } : {}),
    };
    await adminPool.query(
      `INSERT INTO action.candidates (
         project_id, candidate_id, revision_number, candidate_json, created_at, updated_at
       ) VALUES ($1, $2, 1, $3::jsonb, $4, $4)`,
      [input.projectId, candidateId, JSON.stringify(candidate), now],
    );
    await adminPool.query(
      `INSERT INTO action.executions (
         action_id, project_id, candidate_id, candidate_revision, candidate_digest,
         target_digest, parameter_digest, preview_digest, status, record_json,
         created_at, updated_at
       ) VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9::jsonb, $10, $10)`,
      [
        actionId,
        input.projectId,
        candidateId,
        hash('1'),
        hash('2'),
        hash('3'),
        hash('4'),
        status,
        record,
        now,
      ],
    );
    const snapshotId = randomUUID();
    const snapshotDigest = `sha256:${snapshotId.replaceAll('-', '').repeat(2)}`;
    await adminPool.query(
      `INSERT INTO action.preview_snapshots (
         snapshot_id, action_id, project_id, snapshot_digest, expires_at, snapshot_json, created_at
       ) VALUES ($1, $2, $3, $4, now() + interval '1 day', $5::jsonb, $6)`,
      [snapshotId, actionId, input.projectId, snapshotDigest, JSON.stringify(preview), now],
    );
    let approvalId: string | undefined;
    if (input.withApproval) {
      approvalId = randomUUID();
      const approval = {
        schemaVersion: '1.0.0',
        actionId,
        projectId: input.projectId,
        payload: input.payloadCanary,
      };
      await adminPool.query(
        `INSERT INTO action.approvals (
           token_id, action_id, preview_digest, target_digest, parameter_digest,
           candidate_revision, approved_by, approval_json, approved_at, expires_at
         ) VALUES ($1, $2, $3, $4, $5, 1, 't3-test', $6::jsonb, now(), now() + interval '1 day')`,
        [randomUUID(), actionId, hash('4'), hash('2'), hash('3'), JSON.stringify(approval)],
      );
      await adminPool.query(
        `INSERT INTO action.approval_records (
           approval_id, action_id, snapshot_id, snapshot_digest, approved_by,
           expires_at, approval_json, created_at
         ) VALUES ($1, $2, $3, $4, 't3-test', now() + interval '1 day', $5::jsonb, $6)`,
        [approvalId, actionId, snapshotId, snapshotDigest, JSON.stringify(approval), now],
      );
    }
    const auditEventId = randomUUID();
    const auditEvent = {
      schemaVersion: '1.0.0',
      actionId,
      projectId: input.projectId,
      category: 'ACTION_PREVIEW_CREATED',
      actorId: 't3-test',
      details: {
        ...(input.evidenceId ? { evidenceId: input.evidenceId } : {}),
        payload: input.payloadCanary,
      },
      ...(input.payloadCanary ? { sourceContext: input.payloadCanary } : {}),
      occurredAt: now,
    };
    await adminPool.query(
      `INSERT INTO action.audit_events (
         audit_event_id, action_id, project_id, sequence, category, event_json, occurred_at
       ) VALUES ($1, $2, $3, 1, 'ACTION_PREVIEW_CREATED', $4::jsonb, $5)`,
      [auditEventId, actionId, input.projectId, JSON.stringify(auditEvent), now],
    );
    if (input.evidenceId) {
      await adminPool.query(
        `INSERT INTO action.action_review_work_items (
           work_item_id, project_id, semantic_key, action_id, outcome, phase, status,
           evidence_ref, feedback_occurred_at, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, 'FAILED', 'ACTION_REVIEW', 'PENDING', $5, $6, $6, $6)`,
        [randomUUID(), input.projectId, `t3-review:${actionId}`, actionId, input.evidenceId, now],
      );
    }
    return { candidateId, actionId, snapshotId, approvalId, auditEventId, record };
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
       ) VALUES ($1, $2, $3, 't3-action-test', 1, 0, 1, $4, $5, $6, $7,
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
  };

  it('purges Source-linked unexecuted Actions and redacts append-only audit payloads', async () => {
    const projectId = `t3-action-${randomUUID()}`;
    const otherProjectId = `t3-action-other-${randomUUID()}`;
    const payloadCanary = `source-action-payload-${randomUUID()}`;
    await createProject(projectId);
    await createProject(otherProjectId);
    const source = await createSourceEvidence(projectId);
    const linked = await addAction({
      projectId,
      evidenceId: source.evidenceId,
      payloadCanary,
      withApproval: true,
    });
    const independent = await addAction({ projectId });
    const otherProject = await addAction({ projectId: otherProjectId });
    const context = await createReset(projectId);

    const impact = await new PostgresKnowledgeResetImpactInspector(
      adminPool,
      true,
    ).inspectProjectSourceKnowledge(projectId);
    expect(impact.blockers).toEqual([]);
    expect(impact.counts.sourceDerivedRecordCount).toBeGreaterThanOrEqual(2);
    expect(impact.counts.redactedHistoryRecordCount).toBeGreaterThanOrEqual(1);

    const owner = new PostgresActionKnowledgeResetOwner(executorPool);
    await owner.fence(context);
    await expect(
      adminPool.query(
        `UPDATE action.candidates SET candidate_json = '{}'::jsonb
         WHERE project_id = $1 AND candidate_id = $2`,
        [projectId, linked.candidateId],
      ),
    ).rejects.toThrow('fences Action writes');
    await expect(
      adminPool.query(
        `INSERT INTO action.approval_records (
           approval_id, action_id, snapshot_id, snapshot_digest, approved_by,
           expires_at, approval_json, created_at
         ) VALUES ($1, $2, $3, $4, 'late-writer', now() + interval '1 day', '{}'::jsonb, now())`,
        [randomUUID(), independent.actionId, linked.snapshotId, hash('6')],
      ),
    ).rejects.toThrow('fences Action approval writes');
    await beginPurge(projectId, context.requestId);
    await owner.purge(context);
    await expect(owner.verify(context)).resolves.toEqual({ verified: true, blockerCodes: [] });

    const tombstone = await adminPool.query<{
      status: string;
      record_json: Record<string, unknown>;
      candidate_digest: string;
      target_digest: string;
      parameter_digest: string;
      preview_digest: string;
    }>(
      `SELECT status, record_json, candidate_digest, target_digest, parameter_digest, preview_digest
       FROM action.executions WHERE action_id = $1`,
      [linked.actionId],
    );
    expect(tombstone.rows).toMatchObject([
      {
        status: 'SOURCE_RESET',
        record_json: {
          schemaVersion: 't3-action-reset-tombstone-v1',
          payloadAvailability: 'PURGED_BY_T3',
          canonicalWrite: false,
        },
        candidate_digest: hash('0'),
        target_digest: hash('0'),
        parameter_digest: hash('0'),
        preview_digest: hash('0'),
      },
    ]);
    expect(JSON.stringify(tombstone.rows)).not.toContain(payloadCanary);
    await expect(
      adminPool.query(
        `SELECT count(*)::int AS count FROM action.candidates
         WHERE project_id = $1 AND candidate_id = $2`,
        [projectId, linked.candidateId],
      ),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
    await expect(
      adminPool.query(
        `SELECT count(*)::int AS count FROM action.preview_snapshots WHERE action_id = $1`,
        [linked.actionId],
      ),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
    await expect(
      adminPool.query(
        `SELECT count(*)::int AS count FROM action.approval_records WHERE action_id = $1`,
        [linked.actionId],
      ),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
    await expect(
      adminPool.query(`SELECT count(*)::int AS count FROM action.approvals WHERE action_id = $1`, [
        linked.actionId,
      ]),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
    await expect(
      adminPool.query(
        `SELECT category, event_json FROM action.audit_events WHERE audit_event_id = $1`,
        [linked.auditEventId],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          category: 'ACTION_PREVIEW_CREATED',
          event_json: {
            schemaVersion: '1.0.0',
            payloadAvailability: 'PURGED_BY_T3',
            resetRequestId: context.requestId,
          },
        },
      ],
    });
    expect(
      JSON.stringify(
        (
          await adminPool.query(
            'SELECT event_json FROM action.audit_events WHERE audit_event_id = $1',
            [linked.auditEventId],
          )
        ).rows,
      ),
    ).not.toContain(payloadCanary);
    await expect(
      adminPool.query(
        `SELECT count(*)::int AS count FROM action.action_review_work_items WHERE action_id = $1`,
        [linked.actionId],
      ),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });

    const repository = new PostgresActionExecutionRepository(adminPool);
    await expect(repository.find(projectId, linked.actionId)).resolves.toBeUndefined();
    await expect(repository.listAudit(projectId, linked.actionId)).resolves.toEqual([]);
    await expect(repository.find(projectId, independent.actionId)).resolves.toMatchObject({
      actionId: independent.actionId,
    });
    await expect(repository.find(otherProjectId, otherProject.actionId)).resolves.toMatchObject({
      actionId: otherProject.actionId,
    });
  }, 60_000);

  it('allows a fresh Action to reuse the candidate revision kept by an old tombstone', async () => {
    const projectId = `t3-action-reuse-${randomUUID()}`;
    const candidateId = `t3-candidate-reuse-${randomUUID()}`;
    const oldActionId = randomUUID();
    await createProject(projectId);
    await adminPool.query(
      `INSERT INTO action.executions (
         action_id, project_id, candidate_id, candidate_revision, candidate_digest,
         target_digest, parameter_digest, preview_digest, status, record_json,
         created_at, updated_at
       ) VALUES ($1, $2, $3, 1, $4, $4, $4, $4, 'SOURCE_RESET', $5::jsonb, now(), now())`,
      [
        oldActionId,
        projectId,
        candidateId,
        hash('0'),
        { schemaVersion: 't3-action-reset-tombstone-v1', payloadAvailability: 'PURGED_BY_T3' },
      ],
    );
    const replacement = await addAction({ projectId, candidateId, status: 'PREVIEW_READY' });
    expect(replacement.actionId).not.toBe(oldActionId);
    expect(
      (
        await adminPool.query(
          `SELECT count(*)::int AS count FROM action.executions
           WHERE project_id = $1 AND candidate_id = $2 AND candidate_revision = 1`,
          [projectId, candidateId],
        )
      ).rows[0]?.count,
    ).toBe(2);
  }, 60_000);

  it('blocks Source-linked Actions with completed or unknown external outcomes', async () => {
    for (const status of ['EXECUTED', 'OUTCOME_UNKNOWN']) {
      const projectId = `t3-action-block-${status}-${randomUUID()}`;
      await createProject(projectId);
      const source = await createSourceEvidence(projectId);
      await addAction({ projectId, evidenceId: source.evidenceId, status });
      const context = await createReset(projectId);
      const owner = new PostgresActionKnowledgeResetOwner(executorPool);
      await expect(owner.fence(context)).rejects.toMatchObject({
        blockerCode:
          status === 'OUTCOME_UNKNOWN'
            ? 'ACTIVE_JOB_OUTCOME_UNKNOWN'
            : 'EXTERNAL_ACTION_DEPENDENCY',
      });
    }
  }, 60_000);

  it('blocks a candidate whose Evidence lineage cannot be resolved', async () => {
    const projectId = `t3-action-unresolved-${randomUUID()}`;
    await createProject(projectId);
    await addAction({ projectId, evidenceId: randomUUID() });
    const context = await createReset(projectId);
    const owner = new PostgresActionKnowledgeResetOwner(executorPool);
    await expect(owner.fence(context)).rejects.toMatchObject({
      blockerCode: 'UNCLASSIFIED_CONTENT',
    });
  }, 60_000);
});
