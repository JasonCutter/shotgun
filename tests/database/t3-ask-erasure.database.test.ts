import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresAskKnowledgeResetOwner } from '../../adapters/source-knowledge-reset-postgres/src/ask-owner.js';
import { PostgresKnowledgeResetImpactInspector } from '../../adapters/source-knowledge-reset-postgres/src/impact-inspector.js';
import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';

const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const hash = (character: string): string => `sha256:${character.repeat(64)}`;

type ConversationFixture = {
  conversationId: string;
  branchId: string;
  turnIds: string[];
};

describe('ADR-171 Ask conversation erasure owner', () => {
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

  const createConversation = async (
    projectId: string,
    turnCount: number,
    now: Date,
  ): Promise<ConversationFixture> => {
    const conversationId = `conversation-${randomUUID()}`;
    const branchId = `branch-${randomUUID()}`;
    const turnIds = Array.from({ length: turnCount }, () => `turn-${randomUUID()}`);
    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO frontend_ask.conversations (
           conversation_id, project_id, title, active_branch_id, conversation_revision,
           created_at, updated_at
         ) VALUES ($1, $2, 'Source-linked question', $3, '1', $4, $4)`,
        [conversationId, projectId, branchId, now],
      );
      await client.query(
        `INSERT INTO frontend_ask.branches (
           branch_id, conversation_id, label, branch_revision, created_at, updated_at
         ) VALUES ($1, $2, 'Main', '1', $3, $3)`,
        [branchId, conversationId, now],
      );
      for (const [index, turnId] of turnIds.entries()) {
        await client.query(
          `INSERT INTO frontend_ask.turns (
             turn_id, conversation_id, branch_id, ordinal, user_message, ask_mode,
             turn_revision, created_at
           ) VALUES ($1, $2, $3, $4, $5, 'SOURCE_EXPLORATION', '1', $6)`,
          [turnId, conversationId, branchId, index + 1, `Question ${index + 1}`, now],
        );
      }
      await client.query('COMMIT');
      return { conversationId, branchId, turnIds };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };

  const insertCommand = async (input: {
    commandId: string;
    projectId: string;
    now: Date;
  }): Promise<void> => {
    await adminPool.query(
      `INSERT INTO frontend_command.command_ledger (
         command_id, command_revision, client_request_id, idempotency_key, principal_id,
         target_project_id, command_type, command_schema_version, command_semantic_digest,
         policy_binding, accepted_principal_context, accepted_project_context,
         accepted_policy_context, preconditions, command_payload, outcome_state,
         correlation_id, trace_id, received_at, last_updated_at
       ) VALUES (
         $1, 1, $2, $3, 't3-ask-test', $4, 'ASK_QUERY', '1.0.0', $5,
         '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
         '{"mode":"fixture"}'::jsonb, 'ACCEPTED', $6, $7, $8, $8
       )`,
      [
        input.commandId,
        `request-${randomUUID()}`,
        randomUUID(),
        input.projectId,
        hash('d'),
        `correlation-${randomUUID()}`,
        `trace-${randomUUID()}`,
        input.now,
      ],
    );
  };

  const insertAnswerRun = async (input: {
    answerRunId: string;
    conversation: ConversationFixture;
    projectId: string;
    commandId: string;
    turnId: string;
    state?: 'SUCCEEDED' | 'RUNNING';
    question: string;
    now: Date;
  }): Promise<void> => {
    await insertCommand({ commandId: input.commandId, projectId: input.projectId, now: input.now });
    await adminPool.query(
      `INSERT INTO frontend_ask.answer_runs (
         answer_run_id, conversation_id, branch_id, turn_id, project_id, create_command_id,
         mode, state, question, answer_revision, conversation_revision, access_revision,
         policy_context_revision, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'SOURCE_EXPLORATION', $7, $8,
                 '1', '1', 'access-1', 'policy-1', $9, $9)`,
      [
        input.answerRunId,
        input.conversation.conversationId,
        input.conversation.branchId,
        input.turnId,
        input.projectId,
        input.commandId,
        input.state ?? 'SUCCEEDED',
        input.question,
        input.now,
      ],
    );
  };

  const createResetRequest = async (projectId: string) => {
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
       ) VALUES ($1, $2, $3, 't3-ask-test', 1, 0, 1, $4, $5, $6, $7,
                 'FENCING', '{}'::jsonb)`,
      [requestId, randomUUID(), projectId, hash('a'), hash('b'), hash('c'), randomUUID()],
    );
    return {
      requestId,
      context: {
        projectId,
        requestId,
        knowledgeEpoch: 1,
        manifestDigest: hash('a') as `sha256:${string}`,
      },
    };
  };

  it('erases the whole Source-linked conversation and retains independent Project conversations', async () => {
    const projectId = `t3-ask-${randomUUID()}`;
    const otherProjectId = `t3-ask-other-${randomUUID()}`;
    const sourceId = randomUUID();
    const sourceVersionId = randomUUID();
    const assetId = randomUUID();
    const revisionId = randomUUID();
    const evidenceId = randomUUID();
    const now = new Date('2026-09-23T01:00:00.000Z');
    const canary = `ask-source-canary-${randomUUID()}`;
    await adminPool.query(
      `INSERT INTO project_admin.projects (id, name, status, active)
       VALUES ($1, 'T3 Ask fixture', 'ACTIVE', true),
              ($2, 'T3 Ask other fixture', 'ACTIVE', true)`,
      [projectId, otherProjectId],
    );
    await adminPool.query(
      `INSERT INTO asset.original_assets (asset_id, content_hash, size_bytes, storage_key, created_at)
       VALUES ($1, $2, 12, $3, $4)`,
      [assetId, hash('1'), `sha256/${'1'.repeat(64)}`, now],
    );
    await adminPool.query(
      `INSERT INTO asset.sources (source_id, project_id, created_by_actor_id, created_at)
       VALUES ($1, $2, 't3-ask-test', $3)`,
      [sourceId, projectId, now],
    );
    await adminPool.query(
      `INSERT INTO asset.source_versions (
         source_version_id, source_id, version_number, original_asset_id, media_type,
         access_scope, sensitivity, created_at
       ) VALUES ($1, $2, 1, $3, 'text/plain', ARRAY['owner'], 'private', $4)`,
      [sourceVersionId, sourceId, assetId, now],
    );
    await adminPool.query(
      `INSERT INTO transformation.revisions (
         revision_id, project_id, source_id, source_version_id, source_content_hash,
         transformer_id, transformer_version, document_ir, source_map, document_hash,
         source_map_hash, access_scope, sensitivity, created_at
       ) VALUES ($1, $2, $3, $4, $5, 't3-test', '1', '{"text":"source"}',
                '{"quote":"source"}', $6, $7, ARRAY['owner'], 'private', $8)`,
      [revisionId, projectId, sourceId, sourceVersionId, hash('2'), hash('3'), hash('4'), now],
    );
    await adminPool.query(
      `INSERT INTO evidence.spans (
         evidence_id, revision_id, project_id, source_id, source_version_id, pointer,
         node_kind, origin, position, quote, exact_hash, access_scope, sensitivity, created_at
       ) VALUES ($1, $2, $3, $4, $5, '/p/0', 'paragraph', 'source',
                 '{"start":0,"end":20}'::jsonb, $6::jsonb, $7,
                 ARRAY['owner'], 'private', $8)`,
      [
        evidenceId,
        revisionId,
        projectId,
        sourceId,
        sourceVersionId,
        JSON.stringify({ text: canary }),
        hash('5'),
        now,
      ],
    );

    const linkedConversation = await createConversation(projectId, 2, now);
    const independentConversation = await createConversation(projectId, 1, now);
    const otherProjectConversation = await createConversation(otherProjectId, 1, now);
    const firstRunId = `run-${randomUUID()}`;
    const laterRunId = `run-${randomUUID()}`;
    const independentRunId = `run-${randomUUID()}`;
    const otherProjectRunId = `run-${randomUUID()}`;
    await insertAnswerRun({
      answerRunId: firstRunId,
      conversation: linkedConversation,
      projectId,
      commandId: `command-${randomUUID()}`,
      turnId: linkedConversation.turnIds[0]!,
      question: `Question containing ${canary}`,
      now,
    });
    await insertAnswerRun({
      answerRunId: laterRunId,
      conversation: linkedConversation,
      projectId,
      commandId: `command-${randomUUID()}`,
      turnId: linkedConversation.turnIds[1]!,
      question: 'Later question with inherited Source context',
      now,
    });
    await insertAnswerRun({
      answerRunId: independentRunId,
      conversation: independentConversation,
      projectId,
      commandId: `command-${randomUUID()}`,
      turnId: independentConversation.turnIds[0]!,
      question: 'Independent question',
      now,
    });
    await insertAnswerRun({
      answerRunId: otherProjectRunId,
      conversation: otherProjectConversation,
      projectId: otherProjectId,
      commandId: `command-${randomUUID()}`,
      turnId: otherProjectConversation.turnIds[0]!,
      question: 'Other Project question',
      now,
    });
    const impactBeforeSourceLink = await new PostgresKnowledgeResetImpactInspector(
      adminPool,
      true,
    ).inspectProjectSourceKnowledge(projectId);
    const selectionId = `selection-${randomUUID()}`;
    await adminPool.query(
      `INSERT INTO frontend_ask.source_selections (
         selection_id, answer_run_id, project_id, source_id, source_version_id, selection_ordinal
       ) VALUES ($1, $2, $3, $4, $5, 0)`,
      [selectionId, firstRunId, projectId, sourceId, sourceVersionId],
    );
    await adminPool.query(
      `INSERT INTO frontend_ask.source_selection_evidence (selection_id, evidence_ordinal, evidence_id)
       VALUES ($1, 0, $2)`,
      [selectionId, evidenceId],
    );
    const statementId = `statement-${randomUUID()}`;
    await adminPool.query(
      `INSERT INTO frontend_ask.statements (
         statement_id, answer_run_id, ordinal, text, statement_revision
       ) VALUES ($1, $2, 0, $3, '1')`,
      [statementId, firstRunId, `Answer containing ${canary}`],
    );
    await adminPool.query(
      `INSERT INTO frontend_ask.citations (
         citation_id, statement_id, citation_ordinal, source_id, source_version_id,
         evidence_id, exact_quote
       ) VALUES ($1, $2, 0, $3, $4, $5, $6)`,
      [`citation-${randomUUID()}`, statementId, sourceId, sourceVersionId, evidenceId, canary],
    );
    const attemptId = `attempt-${randomUUID()}`;
    await adminPool.query(
      `INSERT INTO frontend_ask.answer_run_attempts (
         attempt_id, answer_run_id, project_id, attempt_number, attempt_kind, state,
         access_revision, policy_context_revision, created_at, updated_at, completed_at
       ) VALUES ($1, $2, $3, 1, 'INITIAL', 'SUCCEEDED', 'access-1', 'policy-1', $4, $4, $4)`,
      [attemptId, firstRunId, projectId, now],
    );
    await adminPool.query(
      `INSERT INTO frontend_ask.answer_attempt_evidence (
         attempt_id, evidence_ordinal, evidence_id, source_id, source_version_id,
         exact_quote, sensitivity
       ) VALUES ($1, 0, $2, $3, $4, $5, 'private')`,
      [attemptId, evidenceId, sourceId, sourceVersionId, canary],
    );
    await adminPool.query(
      `INSERT INTO frontend_ask.answer_run_events (
         event_id, answer_run_id, project_id, ordinal, kind, state, partial_text,
         answer_revision, created_at, attempt_id
       ) VALUES ($1, $2, $3, 0, 'COMPLETED', 'SUCCEEDED', $4, '1', $5, $6)`,
      [`event-${randomUUID()}`, firstRunId, projectId, canary, now, attemptId],
    );
    await adminPool.query(
      `INSERT INTO frontend_ask.answer_exports (
         export_id, answer_run_id, project_id, principal_id, format, content, request_id, created_at
       ) VALUES ($1, $2, $3, 't3-ask-test', 'MARKDOWN', $4, $5, $6)`,
      [`export-${randomUUID()}`, firstRunId, projectId, canary, randomUUID(), now],
    );
    await adminPool.query(
      `INSERT INTO frontend_ask.answer_feedback (
         feedback_id, answer_run_id, project_id, principal_id, kind, comment, request_id, created_at
       ) VALUES ($1, $2, $3, 't3-ask-test', 'REPORT_ISSUE', $4, $5, $6)`,
      [`feedback-${randomUUID()}`, firstRunId, projectId, canary, randomUUID(), now],
    );
    await adminPool.query(
      `INSERT INTO frontend_ask.transition_seeds (
         seed_id, answer_run_id, project_id, principal_id, kind, state, payload, request_id, created_at
       ) VALUES ($1, $2, $3, 't3-ask-test', 'USER_DIRECTIVE', 'PROPOSED', $4::jsonb, $5, $6)`,
      [
        `seed-${randomUUID()}`,
        firstRunId,
        projectId,
        JSON.stringify({ text: canary }),
        randomUUID(),
        now,
      ],
    );

    const impact = await new PostgresKnowledgeResetImpactInspector(
      adminPool,
      true,
    ).inspectProjectSourceKnowledge(projectId);
    expect(
      impact.counts.sourceDerivedRecordCount -
        impactBeforeSourceLink.counts.sourceDerivedRecordCount,
    ).toBe(16);
    expect(JSON.stringify(impact)).not.toContain(canary);

    const { requestId, context } = await createResetRequest(projectId);
    await expect(
      executorPool.query('SELECT count(*) FROM frontend_ask.answer_runs'),
    ).rejects.toMatchObject({ code: '42501' });
    const owner = new PostgresAskKnowledgeResetOwner(executorPool);
    await owner.fence(context);
    await adminPool.query(
      `UPDATE project_admin.project_knowledge_reset_requests SET state = 'PURGING'
       WHERE project_id = $1 AND request_id = $2`,
      [projectId, requestId],
    );
    await owner.purge(context);
    await adminPool.query(
      `UPDATE project_admin.project_knowledge_reset_requests SET state = 'VERIFYING'
       WHERE project_id = $1 AND request_id = $2`,
      [projectId, requestId],
    );
    await expect(owner.verify(context)).resolves.toEqual({ verified: true, blockerCodes: [] });
    await expect(owner.purge(context)).resolves.toBeUndefined();

    const counts = await adminPool.query<{
      conversation_id: string;
      conversations: string;
      answer_runs: string;
      turns: string;
      ask_canary_rows: string;
    }>(
      `SELECT target.conversation_id,
         (SELECT count(*)::text FROM frontend_ask.conversations c
           WHERE c.conversation_id = target.conversation_id) AS conversations,
         (SELECT count(*)::text FROM frontend_ask.answer_runs r
           WHERE r.conversation_id = target.conversation_id) AS answer_runs,
         (SELECT count(*)::text FROM frontend_ask.turns t
           WHERE t.conversation_id = target.conversation_id) AS turns,
         ((SELECT count(*) FROM frontend_ask.answer_runs r
            WHERE r.conversation_id = target.conversation_id AND to_jsonb(r)::text LIKE $4) +
          (SELECT count(*) FROM frontend_ask.statements s
            JOIN frontend_ask.answer_runs r USING (answer_run_id)
            WHERE r.conversation_id = target.conversation_id AND to_jsonb(s)::text LIKE $4))::text AS ask_canary_rows
       FROM (VALUES ($1::text), ($2::text), ($3::text)) AS target(conversation_id)
       ORDER BY conversation_id`,
      [
        linkedConversation.conversationId,
        independentConversation.conversationId,
        otherProjectConversation.conversationId,
        `%${canary}%`,
      ],
    );
    expect(
      counts.rows.find((row) => row.conversation_id === linkedConversation.conversationId),
    ).toMatchObject({
      conversations: '0',
      answer_runs: '0',
      turns: '0',
      ask_canary_rows: '0',
    });
    expect(
      counts.rows.find((row) => row.conversation_id === independentConversation.conversationId),
    ).toMatchObject({
      conversations: '1',
      answer_runs: '1',
      turns: '1',
      ask_canary_rows: '0',
    });
    expect(
      counts.rows.find((row) => row.conversation_id === otherProjectConversation.conversationId),
    ).toMatchObject({
      conversations: '1',
      answer_runs: '1',
      turns: '1',
      ask_canary_rows: '0',
    });
  });

  it('blocks Ask evidence references that cannot be tied to a Project Source', async () => {
    const projectId = `t3-ask-unresolved-${randomUUID()}`;
    const now = new Date('2026-09-23T01:00:00.000Z');
    const canary = `unresolved-ask-evidence-${randomUUID()}`;
    await adminPool.query(
      `INSERT INTO project_admin.projects (id, name, status, active)
       VALUES ($1, 'T3 Ask unresolved fixture', 'ACTIVE', true)`,
      [projectId],
    );
    const conversation = await createConversation(projectId, 1, now);
    const answerRunId = `run-${randomUUID()}`;
    await insertAnswerRun({
      answerRunId,
      conversation,
      projectId,
      commandId: `command-${randomUUID()}`,
      turnId: conversation.turnIds[0]!,
      question: 'Unresolved evidence question',
      now,
    });
    const attemptId = `attempt-${randomUUID()}`;
    await adminPool.query(
      `INSERT INTO frontend_ask.answer_run_attempts (
         attempt_id, answer_run_id, project_id, attempt_number, attempt_kind, state,
         access_revision, policy_context_revision, created_at, updated_at, completed_at
       ) VALUES ($1, $2, $3, 1, 'INITIAL', 'SUCCEEDED', 'access-1', 'policy-1', $4, $4, $4)`,
      [attemptId, answerRunId, projectId, now],
    );
    await adminPool.query(
      `INSERT INTO frontend_ask.answer_attempt_evidence (
         attempt_id, evidence_ordinal, evidence_id, source_id, source_version_id,
         exact_quote, sensitivity
       ) VALUES ($1, 0, $2, $3, $4, $5, 'private')`,
      [attemptId, randomUUID(), randomUUID(), randomUUID(), canary],
    );

    const impact = await new PostgresKnowledgeResetImpactInspector(
      adminPool,
      true,
    ).inspectProjectSourceKnowledge(projectId);
    expect(impact.blockers).toContain('UNCLASSIFIED_CONTENT');
    expect(impact.counts.blockedRecordCount).toBe(1);
    expect(JSON.stringify(impact)).not.toContain(canary);

    const { requestId, context } = await createResetRequest(projectId);
    const owner = new PostgresAskKnowledgeResetOwner(executorPool);
    await expect(owner.fence(context)).rejects.toMatchObject({
      blockerCode: 'UNCLASSIFIED_CONTENT',
    });
    await adminPool.query(
      `UPDATE project_admin.project_knowledge_reset_requests SET state = 'PURGING'
       WHERE project_id = $1 AND request_id = $2`,
      [projectId, requestId],
    );
    await expect(owner.purge(context)).rejects.toMatchObject({
      blockerCode: 'UNCLASSIFIED_CONTENT',
    });
    await expect(
      adminPool.query(
        'SELECT count(*)::text AS count FROM frontend_ask.answer_attempt_evidence WHERE attempt_id = $1',
        [attemptId],
      ),
    ).resolves.toMatchObject({ rows: [{ count: '1' }] });
  });

  it('blocks a linked conversation while an AnswerRun has no terminal outcome', async () => {
    const projectId = `t3-ask-active-${randomUUID()}`;
    const sourceId = randomUUID();
    const sourceVersionId = randomUUID();
    const assetId = randomUUID();
    const now = new Date('2026-09-23T01:00:00.000Z');
    await adminPool.query(
      `INSERT INTO project_admin.projects (id, name, status, active)
       VALUES ($1, 'T3 Ask active fixture', 'ACTIVE', true)`,
      [projectId],
    );
    await adminPool.query(
      `INSERT INTO asset.original_assets (asset_id, content_hash, size_bytes, storage_key, created_at)
       VALUES ($1, $2, 12, $3, $4)`,
      [assetId, hash('6'), `sha256/${'6'.repeat(64)}`, now],
    );
    await adminPool.query(
      `INSERT INTO asset.sources (source_id, project_id, created_by_actor_id, created_at)
       VALUES ($1, $2, 't3-ask-test', $3)`,
      [sourceId, projectId, now],
    );
    await adminPool.query(
      `INSERT INTO asset.source_versions (
         source_version_id, source_id, version_number, original_asset_id, media_type,
         access_scope, sensitivity, created_at
       ) VALUES ($1, $2, 1, $3, 'text/plain', ARRAY['owner'], 'private', $4)`,
      [sourceVersionId, sourceId, assetId, now],
    );
    const conversation = await createConversation(projectId, 1, now);
    const answerRunId = `run-${randomUUID()}`;
    await insertAnswerRun({
      answerRunId,
      conversation,
      projectId,
      commandId: `command-${randomUUID()}`,
      turnId: conversation.turnIds[0]!,
      state: 'RUNNING',
      question: 'Active source question',
      now,
    });
    await adminPool.query(
      `INSERT INTO frontend_ask.source_selections (
         selection_id, answer_run_id, project_id, source_id, source_version_id, selection_ordinal
       ) VALUES ($1, $2, $3, $4, $5, 0)`,
      [`selection-${randomUUID()}`, answerRunId, projectId, sourceId, sourceVersionId],
    );
    const { context } = await createResetRequest(projectId);
    const owner = new PostgresAskKnowledgeResetOwner(executorPool);
    await expect(owner.fence(context)).rejects.toMatchObject({
      blockerCode: 'ACTIVE_JOB_OUTCOME_UNKNOWN',
    });
    await expect(
      executorPool.query('SELECT frontend_ask.t3_erase_project_ask($1, $2::uuid)', [
        projectId,
        context.requestId,
      ]),
    ).rejects.toMatchObject({
      constraint: 't3_reset_request_not_authorized',
    });
  });
});
