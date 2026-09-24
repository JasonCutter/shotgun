import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresFrontendCommandKnowledgeResetOwner } from '../../adapters/source-knowledge-reset-postgres/src/index.js';
import { PostgresAskKnowledgeResetOwner } from '../../adapters/source-knowledge-reset-postgres/src/ask-owner.js';
import { PostgresKnowledgeResetImpactInspector } from '../../adapters/source-knowledge-reset-postgres/src/impact-inspector.js';
import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';

const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const hash = (character: string): string => `sha256:${character.repeat(64)}`;

describe('ADR-171 Frontend Command erasure owner', () => {
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

  const insertCommand = async (input: {
    readonly projectId: string;
    readonly commandType: string;
    readonly state?: 'ACCEPTED' | 'COMPLETED' | 'REJECTED' | 'OUTCOME_UNKNOWN';
    readonly payload: unknown;
    readonly preconditions?: unknown;
    readonly producedResources?: unknown;
  }) => {
    const commandId = `t3-ledger-${randomUUID()}`;
    const now = new Date('2026-09-23T02:00:00.000Z');
    await adminPool.query(
      `INSERT INTO frontend_command.command_ledger (
         command_id, command_revision, client_request_id, idempotency_key, principal_id,
         target_project_id, command_type, command_schema_version, command_semantic_digest,
         policy_binding, accepted_principal_context, accepted_project_context,
         accepted_policy_context, preconditions, command_payload, outcome_state,
         produced_resources, rejection, correlation_id, trace_id, received_at,
         accepted_at, completed_at, last_updated_at
       ) VALUES (
         $1, 1, $2, $3, 't3-test-principal', $4, $5, '1.0.0', $6,
         '{"mode":"CURRENT"}'::jsonb, '{"principal":"t3-test-principal"}'::jsonb,
         '{"project":"t3-project"}'::jsonb, '{"policy":"t3-policy"}'::jsonb,
         $7::jsonb, $8::jsonb, $9, $10::jsonb,
         '{"message":"private rejection detail"}'::jsonb, $11, $12, $13, $13, $13, $13
       )`,
      [
        commandId,
        `request-${randomUUID()}`,
        randomUUID(),
        input.projectId,
        input.commandType,
        hash('a'),
        JSON.stringify(
          input.preconditions ?? [
            {
              purpose: 'TARGET',
              subject: { resourceKind: 'SOURCE', resourceId: 'source-t3' },
            },
          ],
        ),
        JSON.stringify(input.payload),
        input.state ?? 'COMPLETED',
        JSON.stringify(
          input.producedResources ?? [{ resourceKind: 'SOURCE', resourceId: 'source-t3' }],
        ),
        `correlation-${randomUUID()}`,
        `trace-${randomUUID()}`,
        now,
      ],
    );
    return commandId;
  };

  const createReset = async (projectId: string) => {
    const requestId = randomUUID();
    await adminPool.query(
      `INSERT INTO project_admin.projects (id, name, status, active)
       VALUES ($1, 'T3 command fixture', 'ACTIVE', true)
       ON CONFLICT (id) DO NOTHING`,
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
       ) VALUES ($1, $2, $3, 't3-command-test', 1, 0, 1, $4, $5, $6, $7,
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

  it('scrubs only exact Source commands and preserves project, settings, other-project, and command outcome identity', async () => {
    const projectId = `t3-command-${randomUUID()}`;
    const otherProjectId = `t3-command-other-${randomUUID()}`;
    const payloadCanary = `private-command-payload-${randomUUID()}`;
    await adminPool.query(
      `INSERT INTO project_admin.projects (id, name, status, active)
       VALUES ($1, 'T3 command fixture', 'ACTIVE', true),
              ($2, 'T3 command other fixture', 'ACTIVE', true)`,
      [projectId, otherProjectId],
    );
    const sourceCommandId = await insertCommand({
      projectId,
      commandType: 'sources.intake.submit.v1',
      payload: { text: payloadCanary, filename: 'private-source.txt' },
    });
    const otherProjectCommandId = await insertCommand({
      projectId: otherProjectId,
      commandType: 'sources.intake.submit.v1',
      payload: { text: `other-${payloadCanary}` },
    });
    const settingsCommandId = await insertCommand({
      projectId,
      commandType: 'settings.project.update.v1',
      payload: { theme: 'dark', settingCanary: payloadCanary },
    });
    const inspector = new PostgresKnowledgeResetImpactInspector(adminPool, true);
    const before = await inspector.inspectProjectSourceKnowledge(projectId);
    expect(before.counts.sourceDerivedRecordCount).toBe(1);
    expect(before.blockers).toEqual([]);
    const context = await createReset(projectId);
    const owner = new PostgresFrontendCommandKnowledgeResetOwner(executorPool);
    await owner.fence(context);
    const afterFence = await inspector.inspectProjectSourceKnowledge(projectId);
    expect(afterFence.manifestDigest).toBe(before.manifestDigest);
    expect(afterFence.counts).toEqual(before.counts);

    await adminPool.query(
      `UPDATE project_admin.project_knowledge_reset_requests
       SET state = 'PURGING' WHERE project_id = $1 AND request_id = $2`,
      [projectId, context.requestId],
    );
    await owner.purge(context);
    await adminPool.query(
      `UPDATE project_admin.project_knowledge_reset_requests
       SET state = 'VERIFYING' WHERE project_id = $1 AND request_id = $2`,
      [projectId, context.requestId],
    );
    await expect(owner.verify(context)).resolves.toEqual({ verified: true, blockerCodes: [] });

    const scrubbed = await adminPool.query<{
      outcome_state: string;
      command_revision: string;
      command_semantic_digest: string;
      command_payload: unknown;
      preconditions: unknown;
      produced_resources: unknown;
      rejection: unknown;
      accepted_principal_context: unknown;
    }>(
      `SELECT outcome_state, command_revision::text, command_semantic_digest,
              command_payload, preconditions, produced_resources, rejection,
              accepted_principal_context
       FROM frontend_command.command_ledger WHERE command_id = $1`,
      [sourceCommandId],
    );
    expect(scrubbed.rows[0]).toMatchObject({
      outcome_state: 'COMPLETED',
      command_semantic_digest: 't3-content-purged',
      command_payload: {},
      preconditions: [],
      produced_resources: [],
      rejection: null,
      accepted_principal_context: {},
    });
    expect(Number(scrubbed.rows[0]?.command_revision)).toBe(2);
    expect(JSON.stringify(scrubbed.rows[0])).not.toContain(payloadCanary);

    const preserved = await adminPool.query<{ command_payload: unknown }>(
      `SELECT command_payload FROM frontend_command.command_ledger
       WHERE command_id = ANY($1::text[]) ORDER BY command_id`,
      [[settingsCommandId, otherProjectCommandId]],
    );
    expect(preserved.rows).toHaveLength(2);
    expect(JSON.stringify(preserved.rows)).toContain(payloadCanary);
  });

  it('blocks active Source outcomes and unsupported Source command families without exposing payload text', async () => {
    const projectId = `t3-command-active-${randomUUID()}`;
    const canary = `active-command-private-${randomUUID()}`;
    await insertCommand({
      projectId,
      commandType: 'sources.intake.retry.v1',
      state: 'OUTCOME_UNKNOWN',
      payload: { text: canary },
    });
    const context = await createReset(projectId);
    const owner = new PostgresFrontendCommandKnowledgeResetOwner(executorPool);
    const error = await owner.fence(context).then(
      () => undefined,
      (cause: unknown) => cause,
    );
    expect(error).toMatchObject({ blockerCode: 'ACTIVE_JOB_OUTCOME_UNKNOWN' });
    expect(String(error)).not.toContain(canary);

    const unsupportedProjectId = `t3-command-unsupported-${randomUUID()}`;
    const unsupportedCanary = `unsupported-command-private-${randomUUID()}`;
    await insertCommand({
      projectId: unsupportedProjectId,
      commandType: 'sources.unknown.v9',
      payload: { text: unsupportedCanary },
    });
    const unsupportedContext = await createReset(unsupportedProjectId);
    const unsupportedError = await owner.fence(unsupportedContext).then(
      () => undefined,
      (cause: unknown) => cause,
    );
    expect(unsupportedError).toMatchObject({ blockerCode: 'UNCLASSIFIED_CONTENT' });
    expect(String(unsupportedError)).not.toContain(unsupportedCanary);
  });

  it('snapshots Source-linked Ask commands before Ask purge and preserves independent Ask commands', async () => {
    const projectId = `t3-command-ask-${randomUUID()}`;
    const sourceId = randomUUID();
    const sourceVersionId = randomUUID();
    const assetId = randomUUID();
    const linkedRunId = randomUUID();
    const independentRunId = randomUUID();
    const linkedCommandCanary = `private-ask-command-${randomUUID()}`;
    const independentCanary = `independent-ask-command-${randomUUID()}`;
    const now = new Date('2026-09-23T02:30:00.000Z');

    await adminPool.query(
      `INSERT INTO project_admin.projects (id, name, status, active)
       VALUES ($1, 'T3 Ask command fixture', 'ACTIVE', true)`,
      [projectId],
    );
    await adminPool.query(
      `INSERT INTO asset.original_assets (asset_id, content_hash, size_bytes, storage_key, created_at)
       VALUES ($1, $2, 12, $3, $4)`,
      [assetId, hash('e'), `sha256/${'e'.repeat(64)}`, now],
    );
    await adminPool.query(
      `INSERT INTO asset.sources (source_id, project_id, created_by_actor_id, created_at)
       VALUES ($1, $2, 't3-command-test', $3)`,
      [sourceId, projectId, now],
    );
    await adminPool.query(
      `INSERT INTO asset.source_versions (
         source_version_id, source_id, version_number, original_asset_id, media_type,
         access_scope, sensitivity, created_at
       ) VALUES ($1, $2, 1, $3, 'text/plain', ARRAY['owner'], 'private', $4)`,
      [sourceVersionId, sourceId, assetId, now],
    );

    const conversations = [
      {
        conversationId: `conversation-${randomUUID()}`,
        branchId: `branch-${randomUUID()}`,
        turnId: `turn-${randomUUID()}`,
        runId: linkedRunId,
      },
      {
        conversationId: `conversation-${randomUUID()}`,
        branchId: `branch-${randomUUID()}`,
        turnId: `turn-${randomUUID()}`,
        runId: independentRunId,
      },
    ];
    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET CONSTRAINTS ALL DEFERRED');
      for (const conversation of conversations) {
        await client.query(
          `INSERT INTO frontend_ask.conversations (
             conversation_id, project_id, title, active_branch_id, conversation_revision,
             created_at, updated_at
           ) VALUES ($1, $2, 'T3 Ask command fixture', $3, '1', $4, $4)`,
          [conversation.conversationId, projectId, conversation.branchId, now],
        );
        await client.query(
          `INSERT INTO frontend_ask.branches (
             branch_id, conversation_id, label, branch_revision, created_at, updated_at
           ) VALUES ($1, $2, 'Main', '1', $3, $3)`,
          [conversation.branchId, conversation.conversationId, now],
        );
        await client.query(
          `INSERT INTO frontend_ask.turns (
             turn_id, conversation_id, branch_id, ordinal, user_message, ask_mode,
             turn_revision, created_at
           ) VALUES ($1, $2, $3, 1, 'Question', 'SOURCE_EXPLORATION', '1', $4)`,
          [conversation.turnId, conversation.conversationId, conversation.branchId, now],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const linkedCommandId = await insertCommand({
      projectId,
      commandType: 'ask.answer-run.feedback.v1',
      payload: { comment: linkedCommandCanary },
      preconditions: [
        {
          purpose: 'TARGET',
          subject: { resourceKind: 'ASK_ANSWER_RUN', resourceId: linkedRunId },
        },
      ],
      producedResources: [{ resourceKind: 'ASK_ANSWER_RUN', resourceId: linkedRunId }],
    });
    const independentCommandId = await insertCommand({
      projectId,
      commandType: 'ask.answer-run.feedback.v1',
      payload: { comment: independentCanary },
      preconditions: [
        {
          purpose: 'TARGET',
          subject: { resourceKind: 'ASK_ANSWER_RUN', resourceId: independentRunId },
        },
      ],
      producedResources: [{ resourceKind: 'ASK_ANSWER_RUN', resourceId: independentRunId }],
    });
    await adminPool.query(
      `INSERT INTO frontend_ask.answer_runs (
         answer_run_id, conversation_id, branch_id, turn_id, project_id, create_command_id,
         mode, state, question, answer_revision, conversation_revision, access_revision,
         policy_context_revision, created_at, updated_at
       ) VALUES
         ($1, $2, $3, $4, $5, $6, 'SOURCE_EXPLORATION', 'SUCCEEDED', 'Source question',
          '1', '1', 'access-1', 'policy-1', $7, $7),
         ($8, $9, $10, $11, $5, $12, 'SOURCE_EXPLORATION', 'SUCCEEDED', 'Independent question',
          '1', '1', 'access-1', 'policy-1', $7, $7)`,
      [
        linkedRunId,
        conversations[0]!.conversationId,
        conversations[0]!.branchId,
        conversations[0]!.turnId,
        projectId,
        linkedCommandId,
        now,
        independentRunId,
        conversations[1]!.conversationId,
        conversations[1]!.branchId,
        conversations[1]!.turnId,
        independentCommandId,
      ],
    );
    await adminPool.query(
      `INSERT INTO frontend_ask.source_selections (
         selection_id, answer_run_id, project_id, source_id, source_version_id, selection_ordinal
       ) VALUES ($1, $2, $3, $4, $5, 0)`,
      [`selection-${randomUUID()}`, linkedRunId, projectId, sourceId, sourceVersionId],
    );

    const context = await createReset(projectId);
    const askOwner = new PostgresAskKnowledgeResetOwner(executorPool);
    const commandOwner = new PostgresFrontendCommandKnowledgeResetOwner(executorPool);
    await askOwner.fence(context);
    await commandOwner.fence(context);
    await adminPool.query(
      `UPDATE project_admin.project_knowledge_reset_requests
       SET state = 'PURGING' WHERE project_id = $1 AND request_id = $2`,
      [projectId, context.requestId],
    );
    await askOwner.purge(context);
    await commandOwner.purge(context);
    await adminPool.query(
      `UPDATE project_admin.project_knowledge_reset_requests
       SET state = 'VERIFYING' WHERE project_id = $1 AND request_id = $2`,
      [projectId, context.requestId],
    );
    await expect(askOwner.verify(context)).resolves.toMatchObject({ verified: true });
    await expect(commandOwner.verify(context)).resolves.toEqual({
      verified: true,
      blockerCodes: [],
    });

    const rows = await adminPool.query<{ command_id: string; command_payload: unknown }>(
      `SELECT command_id, command_payload FROM frontend_command.command_ledger
       WHERE command_id = ANY($1::text[]) ORDER BY command_id`,
      [[linkedCommandId, independentCommandId]],
    );
    const linkedRow = rows.rows.find((row) => row.command_id === linkedCommandId);
    const independentRow = rows.rows.find((row) => row.command_id === independentCommandId);
    expect(linkedRow?.command_payload).toEqual({});
    expect(independentRow?.command_payload).toMatchObject({ comment: independentCanary });
    expect(JSON.stringify(linkedRow)).not.toContain(linkedCommandCanary);
    await expect(
      adminPool.query(
        'SELECT count(*)::text FROM frontend_ask.conversations WHERE conversation_id = $1',
        [conversations[1]!.conversationId],
      ),
    ).resolves.toMatchObject({ rows: [{ count: '1' }] });
  });
});
