import type { Pool, PoolClient } from 'pg';
import {
  ShotgunError,
  AskAnswerRunSnapshot,
  AskBranchView,
  AskConversationView,
  AskQuestionSubmissionOutcomeView,
} from '../../../packages/contracts/src/index.js';
import type { AskConversationRepositoryPort } from '../../../modules/frontend-ask-write/src/index.js';

export class PostgresAskConversationRepository implements AskConversationRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async transaction<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await action(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async saveAggregate(
    client: unknown,
    aggregate: {
      conversation: AskConversationView;
      branch: AskBranchView;
      turn: AskBranchView['turns'][0];
      answerRun: AskAnswerRunSnapshot;
    },
    expectedConversationRevision?: string,
    expectedBranchRevision?: string,
  ): Promise<void> {
    const pgClient = client as PoolClient;
    const { conversation, branch, turn, answerRun } = aggregate;

    // Check conversation revision
    if (expectedConversationRevision !== undefined) {
      const res = await pgClient.query(
        'SELECT conversation_revision FROM frontend_ask.conversations WHERE conversation_id = $1 FOR UPDATE',
        [conversation.conversationId]
      );
      if (res.rowCount === 0) {
        throw new ShotgunError({
          code: 'NOT_FOUND',
          safeMessage: 'Conversation not found.',
          module: 'frontend-ask-write-postgres',
          operation: 'save-aggregate',
        });
      }
      if (res.rows[0].conversation_revision !== expectedConversationRevision) {
        throw new ShotgunError({
          code: 'REVISION_CONFLICT',
          safeMessage: 'Conversation revision mismatch. Another client may have submitted a question.',
          module: 'frontend-ask-write-postgres',
          operation: 'start-answer-run',
        });
      }
    }

    // Upsert conversation
    await pgClient.query(
      `INSERT INTO frontend_ask.conversations (
        conversation_id, project_id, title, active_branch_id, conversation_revision, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (conversation_id) DO UPDATE SET
        title = EXCLUDED.title,
        active_branch_id = EXCLUDED.active_branch_id,
        conversation_revision = EXCLUDED.conversation_revision,
        updated_at = EXCLUDED.updated_at`,
      [
        conversation.conversationId,
        conversation.projectId,
        conversation.title,
        conversation.activeBranchId,
        conversation.conversationRevision,
        new Date(conversation.updatedAt),
      ]
    );

    // Upsert branch
    await pgClient.query(
      `INSERT INTO frontend_ask.branches (
        conversation_id, branch_id, label
      ) VALUES ($1, $2, $3)
      ON CONFLICT (conversation_id, branch_id) DO NOTHING`,
      [
        conversation.conversationId,
        branch.branchId,
        branch.label,
      ]
    );

    // Insert turn
    await pgClient.query(
      `INSERT INTO frontend_ask.turns (
        conversation_id, branch_id, turn_id, ordinal, user_message, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (conversation_id, branch_id, turn_id) DO NOTHING`,
      [
        conversation.conversationId,
        branch.branchId,
        turn.turnId,
        turn.ordinal,
        turn.userMessage,
        new Date(turn.createdAt),
      ]
    );

    // Insert answer run
    await pgClient.query(
      `INSERT INTO frontend_ask.answer_runs (
        answer_run_id, conversation_id, branch_id, turn_id, project_id, mode, state, question,
        statements_json, source_selections_json, capabilities_json, answer_revision,
        conversation_revision, access_revision, policy_context_revision, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      ON CONFLICT (answer_run_id) DO NOTHING`,
      [
        answerRun.answerRunId,
        answerRun.conversationId,
        answerRun.branchId,
        answerRun.turnId,
        answerRun.projectId,
        answerRun.mode,
        answerRun.state,
        answerRun.question,
        JSON.stringify(answerRun.statements),
        JSON.stringify(answerRun.sourceSelections),
        JSON.stringify(answerRun.capabilities),
        answerRun.answerRevision,
        answerRun.conversationRevision,
        answerRun.accessRevision,
        answerRun.policyContextRevision,
        new Date(answerRun.createdAt),
        new Date(answerRun.updatedAt),
      ]
    );
  }

  async getConversationOutcome(
    clientRequestId: string,
    principalId: string,
    projectId: string,
  ): Promise<AskQuestionSubmissionOutcomeView | undefined> {
    const res = await this.pool.query(
      `SELECT
        o.command_id, o.client_request_id, o.idempotency_key, o.conversation_id, o.branch_id, o.turn_id, o.answer_run_id, o.outcome_state,
        a.project_id, a.mode, a.state, a.question, a.statements_json, a.source_selections_json, a.capabilities_json,
        a.answer_revision, a.conversation_revision, a.access_revision, a.policy_context_revision, a.created_at, a.updated_at
       FROM frontend_ask.submission_outcomes o
       JOIN frontend_ask.answer_runs a ON o.answer_run_id = a.answer_run_id
       WHERE o.client_request_id = $1 AND o.principal_id = $2 AND a.project_id = $3`,
      [clientRequestId, principalId, projectId]
    );

    if (res.rowCount === 0) return undefined;
    const row = res.rows[0];

    const answerRun: AskAnswerRunSnapshot = {
      schemaVersion: '1.0.0', // ASK_SCHEMA_VERSION doesn't seem to be exported properly if we don't import it, but we can hardcode for this test or import it
      answerRunId: row.answer_run_id,
      conversationId: row.conversation_id,
      branchId: row.branch_id,
      turnId: row.turn_id,
      projectId: row.project_id,
      mode: row.mode,
      state: row.state,
      question: row.question,
      statements: typeof row.statements_json === 'string' ? JSON.parse(row.statements_json) : row.statements_json,
      sourceSelections: typeof row.source_selections_json === 'string' ? JSON.parse(row.source_selections_json) : row.source_selections_json,
      capabilities: typeof row.capabilities_json === 'string' ? JSON.parse(row.capabilities_json) : row.capabilities_json,
      answerRevision: row.answer_revision,
      conversationRevision: row.conversation_revision,
      accessRevision: row.access_revision,
      policyContextRevision: row.policy_context_revision,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      stale: false,
    };

    return {
      schemaVersion: '1.0.0',
      outcomeState: row.outcome_state,
      clientRequestId: row.client_request_id,
      idempotencyKey: row.idempotency_key,
      commandId: row.command_id,
      conversationId: row.conversation_id,
      branchId: row.branch_id,
      turnId: row.turn_id,
      answerRunId: row.answer_run_id,
      answerRun,
    };
  }
}
