import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresKnowledgeDraftResetOwner } from '../../adapters/source-knowledge-reset-postgres/src/index.js';
import { PostgresKnowledgeResetImpactInspector } from '../../adapters/source-knowledge-reset-postgres/src/impact-inspector.js';
import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';

const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const hash = (character: string): string => `sha256:${character.repeat(64)}`;

describe('ADR-171 Knowledge Draft erasure owner', () => {
  let database: Awaited<ReturnType<typeof createIsolatedPostgresTestDatabase>>;
  let adminPool: Pool;
  let executorPool: Pool;
  let owner: PostgresKnowledgeDraftResetOwner;

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
    owner = new PostgresKnowledgeDraftResetOwner(executorPool);
  });

  afterAll(async () => {
    await executorPool?.end();
    await adminPool?.query('ALTER ROLE shotgun_erasure_executor NOLOGIN PASSWORD NULL');
    await database?.dispose();
  });

  const createProject = async (projectId: string) => {
    await adminPool.query(
      `INSERT INTO project_admin.projects (id, name, status, active)
       VALUES ($1, 'T3 Knowledge Draft fixture', 'ACTIVE', true)`,
      [projectId],
    );
  };

  const addDraft = async (input: {
    projectId: string;
    kind: 'source-seed' | 'independent-page' | 'unknown-resource';
    sourceId?: string;
  }) => {
    const draftId = `draft-${randomUUID()}`;
    const revision = 1;
    const digest = hash('d');
    const now = new Date().toISOString();
    const startMode = input.kind === 'source-seed' ? 'SEED_MATERIALIZATION' : 'KNOWLEDGE_PAGE';
    const targetKind =
      input.kind === 'source-seed'
        ? 'SEED'
        : input.kind === 'unknown-resource'
          ? 'RESOURCE'
          : 'PAGE';
    const seedId = input.kind === 'source-seed' ? `seed-${randomUUID()}` : null;
    const pageId = targetKind === 'PAGE' ? `page-${randomUUID()}` : null;
    const resourceId = targetKind === 'RESOURCE' ? `resource-${randomUUID()}` : (pageId ?? seedId!);
    const base = {
      resourceProjectId: input.projectId,
      canonicalSnapshotId: `snapshot-${input.projectId}`,
      canonicalVersion: 1,
      canonicalSnapshotDigest: hash('a'),
      revisionIdentityKind:
        targetKind === 'RESOURCE' ? 'RESOURCE_REVISION' : 'NEW_RESOURCE_SNAPSHOT',
      ...(targetKind === 'RESOURCE'
        ? {
            canonicalResourceId: resourceId,
            canonicalRevisionId: `canonical-revision-${resourceId}`,
          }
        : {}),
      sourceLineage: [],
    };
    const operation = input.sourceId
      ? { operationId: `operation-${draftId}`, sourceId: input.sourceId, evidenceReferences: [] }
      : { operationId: `operation-${draftId}`, evidenceReferences: [] };
    const snapshot = {
      schemaVersion: '1.0.0',
      draftId,
      ...(seedId === null ? {} : { seedId }),
      startMode,
      status: 'DRAFT',
      revision,
      activeProjectId: input.projectId,
      resourceProjectId: input.projectId,
      draftProjectId: input.projectId,
      effectiveProjectId: input.projectId,
      resourceId,
      base,
      operations: [operation],
      contentDigest: digest,
      createdAt: now,
      updatedAt: now,
    };
    const materialization = {
      materializationId: `materialization-${draftId}`,
      draftId,
      target: {
        kind: targetKind,
        resourceId,
        ...(seedId === null ? {} : { seedId }),
        ...(pageId === null ? {} : { pageId }),
      },
      resourceProjectId: input.projectId,
      draftProjectId: input.projectId,
      effectiveProjectId: input.projectId,
      base,
      commandIdentity: {
        principalId: 't3-user',
        clientRequestId: `request-${draftId}`,
        idempotencyKey: `key-${draftId}`,
        semanticDigest: digest,
      },
      createdAt: now,
    };
    await adminPool.query(
      `INSERT INTO frontend_knowledge_draft.drafts (
         draft_id, resource_project_id, draft_project_id, effective_project_id,
         active_project_id, resource_id, seed_id, answer_run_id, start_mode, status,
         revision, content_digest, snapshot, created_at, updated_at
       ) VALUES ($1, $2, $2, $2, $2, $3, $4, NULL, $5, 'DRAFT', 1, $6, $7::jsonb, $8, $8)`,
      [
        draftId,
        input.projectId,
        resourceId,
        seedId,
        startMode,
        digest,
        JSON.stringify(snapshot),
        now,
      ],
    );
    await adminPool.query(
      `INSERT INTO frontend_knowledge_draft.revisions (
         draft_id, revision, status, resource_project_id, draft_project_id,
         effective_project_id, base, operations, content_digest, created_at, updated_at
       ) VALUES ($1, 1, 'DRAFT', $2, $2, $2, $3::jsonb, $4::jsonb, $5, $6, $6)`,
      [draftId, input.projectId, JSON.stringify(base), JSON.stringify([operation]), digest, now],
    );
    await adminPool.query(
      `INSERT INTO frontend_knowledge_draft.operations (
         draft_id, revision, operation_id, operation_ordinal, resource_project_id, operation
       ) VALUES ($1, 1, $2, 1, $3, $4::jsonb)`,
      [`${draftId}`, operation.operationId, input.projectId, JSON.stringify(operation)],
    );
    await adminPool.query(
      `INSERT INTO frontend_knowledge_draft.materializations (
         materialization_id, draft_id, seed_id, target_kind, page_id, resource_id,
         resource_project_id, draft_project_id, effective_project_id, base,
         command_identity, replay_principal_id, replay_client_request_id,
         replay_idempotency_key, semantic_digest, snapshot, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $7, $8::jsonb, $9::jsonb,
                 't3-user', $10, $11, $12, $13::jsonb, $14)`,
      [
        materialization.materializationId,
        draftId,
        seedId,
        targetKind,
        pageId,
        resourceId,
        input.projectId,
        JSON.stringify(base),
        JSON.stringify(materialization.commandIdentity),
        materialization.commandIdentity.clientRequestId,
        materialization.commandIdentity.idempotencyKey,
        digest,
        JSON.stringify(materialization),
        now,
      ],
    );
    await adminPool.query(
      `INSERT INTO frontend_knowledge_draft.artifact_refs (
         artifact_id, artifact_kind, draft_id, draft_revision, artifact_revision, digest,
         status, resource_project_id, project_policy_context
       ) VALUES ($1, 'VALIDATION', $2, 1, 1, $3, 'COMPLETE', $4, $5::jsonb)`,
      [
        `artifact-${draftId}`,
        draftId,
        digest,
        input.projectId,
        JSON.stringify({ resourceProjectId: input.projectId, activeProjectId: input.projectId }),
      ],
    );
    return draftId;
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
       ) VALUES ($1, $2, $3, 't3-draft-test', 1, 0, 1, $4, $5, $6, $7,
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
    await executorPool.query("SELECT set_config('shotgun.t3_reset_request_id', $1, false)", [
      requestId,
    ]);
  };

  it('removes Source-derived Drafts and retains a proven independent Knowledge Page Draft', async () => {
    const projectId = `t3-draft-${randomUUID()}`;
    await createProject(projectId);
    const sourceId = randomUUID();
    await adminPool.query(
      `INSERT INTO asset.sources (source_id, project_id, created_by_actor_id, created_at)
       VALUES ($1, $2, 't3-user', now())`,
      [sourceId, projectId],
    );
    const sourceDraftId = await addDraft({ projectId, kind: 'source-seed', sourceId });
    const independentDraftId = await addDraft({ projectId, kind: 'independent-page' });
    const context = await createReset(projectId);

    const impact = await adminPool.query<{ impact: Record<string, unknown> }>(
      'SELECT frontend_knowledge_draft.t3_project_draft_impact($1) AS impact',
      [projectId],
    );
    expect(impact.rows[0]?.impact).toMatchObject({
      sourceDerivedDraftCount: 1,
      sourceDerivedRecordCount: 5,
      preservedDraftCount: 1,
      unclassifiedRecordCount: 0,
    });
    const preview = await new PostgresKnowledgeResetImpactInspector(
      adminPool,
      true,
    ).inspectProjectSourceKnowledge(projectId);
    expect(preview.counts.sourceDerivedRecordCount).toBeGreaterThanOrEqual(5);
    expect(preview.blockers).not.toContain('UNCLASSIFIED_CONTENT');

    await owner.fence(context);
    await beginPurge(projectId, context.requestId);
    await owner.purge(context);
    expect(await owner.verify(context)).toEqual({ verified: true, blockerCodes: [] });

    const rows = await adminPool.query<{
      drafts: string;
      revisions: string;
      operations: string;
      materializations: string;
      artifacts: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM frontend_knowledge_draft.drafts WHERE draft_id = $1) AS drafts,
         (SELECT count(*)::text FROM frontend_knowledge_draft.revisions WHERE draft_id = $1) AS revisions,
         (SELECT count(*)::text FROM frontend_knowledge_draft.operations WHERE draft_id = $1) AS operations,
         (SELECT count(*)::text FROM frontend_knowledge_draft.materializations WHERE draft_id = $1) AS materializations,
         (SELECT count(*)::text FROM frontend_knowledge_draft.artifact_refs WHERE draft_id = $1) AS artifacts`,
      [sourceDraftId],
    );
    expect(rows.rows[0]).toEqual({
      drafts: '0',
      revisions: '0',
      operations: '0',
      materializations: '0',
      artifacts: '0',
    });
    const preserved = await adminPool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM frontend_knowledge_draft.drafts WHERE draft_id = $1',
      [independentDraftId],
    );
    expect(preserved.rows[0]?.count).toBe('1');
    await executorPool.query("SELECT set_config('shotgun.t3_reset_request_id', '', false)");
  }, 60_000);

  it('blocks Drafts whose Source reference or Canonical dependency cannot be classified', async () => {
    const projectId = `t3-draft-unknown-${randomUUID()}`;
    await createProject(projectId);
    const unknownSourceDraft = await addDraft({
      projectId,
      kind: 'independent-page',
      sourceId: randomUUID(),
    });
    const context = await createReset(projectId);
    await expect(owner.fence(context)).rejects.toMatchObject({
      blockerCode: 'UNCLASSIFIED_CONTENT',
    });
    const stillPresent = await adminPool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM frontend_knowledge_draft.drafts WHERE draft_id = $1',
      [unknownSourceDraft],
    );
    expect(stillPresent.rows[0]?.count).toBe('1');

    const resourceProject = `t3-draft-resource-${randomUUID()}`;
    await createProject(resourceProject);
    await addDraft({ projectId: resourceProject, kind: 'unknown-resource' });
    const resourceContext = await createReset(resourceProject);
    await expect(owner.fence(resourceContext)).rejects.toMatchObject({
      blockerCode: 'UNCLASSIFIED_CONTENT',
    });
  });
});
