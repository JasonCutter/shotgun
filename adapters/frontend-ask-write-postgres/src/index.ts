import type { Pool, PoolClient, QueryResultRow } from 'pg';

import {
  ASK_SCHEMA_VERSION,
  ShotgunError,
  decodeAskAnswerRunSnapshot,
  decodeAskConversationView,
  decodeAskWorkspaceView,
  type AskAnswerRunSnapshot,
  type AskBranchView,
  type AskCitationView,
  type AskConversationView,
  type AskSourceSelectionView,
  type AskWorkspaceView,
} from '../../../packages/contracts/src/index.js';
import type {
  AskCommittedQuestion,
  AskConversationRepositoryPort,
  AskSourceSelectionValidatorPort,
  PersistAskQuestionInput,
} from '../../../modules/frontend-ask-write/src/index.js';
import type {
  AskWorkspaceProjectionPort,
  FrontendReadScope,
} from '../../../modules/frontend-product-read/src/index.js';

type ConversationRow = QueryResultRow & {
  readonly conversation_id: string;
  readonly project_id: string;
  readonly title: string;
  readonly active_branch_id: string;
  readonly conversation_revision: string;
  readonly created_at: Date;
  readonly updated_at: Date;
};

type BranchRow = QueryResultRow & {
  readonly branch_id: string;
  readonly conversation_id: string;
  readonly label: string;
  readonly branch_revision: string;
  readonly created_at: Date;
  readonly updated_at: Date;
};

type TurnRow = QueryResultRow & {
  readonly turn_id: string;
  readonly conversation_id: string;
  readonly branch_id: string;
  readonly ordinal: number;
  readonly user_message: string;
  readonly ask_mode: AskAnswerRunSnapshot['mode'];
  readonly turn_revision: string;
  readonly created_at: Date;
};

type AnswerRunRow = QueryResultRow & {
  readonly answer_run_id: string;
  readonly conversation_id: string;
  readonly branch_id: string;
  readonly turn_id: string;
  readonly project_id: string;
  readonly mode: AskAnswerRunSnapshot['mode'];
  readonly state: AskAnswerRunSnapshot['state'];
  readonly attention_reason: AskAnswerRunSnapshot['attentionReason'] | null;
  readonly question: string;
  readonly capabilities: AskAnswerRunSnapshot['capabilities'];
  readonly answer_revision: string;
  readonly conversation_revision: string;
  readonly access_revision: string;
  readonly policy_context_revision: string;
  readonly failure_code: string | null;
  readonly failure_message: string | null;
  readonly failure_retryable: boolean | null;
  readonly failure_outcome_unknown: boolean | null;
  readonly partial_text: string | null;
  readonly provider_name: string | null;
  readonly provider_model: string | null;
  readonly provider_adapter_version: string | null;
  readonly input_tokens: number | null;
  readonly output_tokens: number | null;
  readonly total_tokens: number | null;
  readonly cost_micros: number | string | null;
  readonly attempt_number: number;
  readonly event_revision: number;
  readonly created_at: Date;
  readonly updated_at: Date;
};

type SelectionRow = QueryResultRow & {
  readonly selection_id: string;
  readonly answer_run_id: string;
  readonly selection_ordinal: number;
  readonly source_id: string;
  readonly source_version_id: string;
  readonly evidence_id: string | null;
  readonly evidence_ordinal: number | null;
};

type StatementRow = QueryResultRow & {
  readonly statement_id: string;
  readonly answer_run_id: string;
  readonly ordinal: number;
  readonly text: string;
};

type CitationRow = QueryResultRow & {
  readonly citation_id: string;
  readonly statement_id: string;
  readonly citation_ordinal: number;
  readonly source_id: string;
  readonly source_version_id: string;
  readonly evidence_id: string;
  readonly exact_quote: string | null;
};

type ConversationSummaryRow = QueryResultRow & {
  readonly conversation_id: string;
  readonly project_id: string;
  readonly title: string;
  readonly active_branch_id: string;
  readonly turn_count: number;
  readonly latest_run_state: AskAnswerRunSnapshot['state'];
  readonly updated_at: Date;
};

type SourceAuthorityRow = QueryResultRow & {
  readonly project_id: string;
  readonly source_id: string;
  readonly source_version_id: string;
  readonly sensitivity: 'public' | 'internal' | 'private' | 'restricted';
};

type EvidenceAuthorityRow = QueryResultRow & {
  readonly evidence_id: string;
  readonly project_id: string;
  readonly source_id: string;
  readonly source_version_id: string;
  readonly sensitivity: 'public' | 'internal' | 'private' | 'restricted';
};

const sensitivityRank = {
  public: 0,
  internal: 1,
  private: 2,
  restricted: 3,
} as const;

const notFound = (operation: string): ShotgunError =>
  new ShotgunError({
    code: 'NOT_FOUND',
    safeMessage: 'The requested Ask resource was not found.',
    module: 'frontend-ask-write-postgres',
    operation,
  });

const revisionConflict = (resource: string): ShotgunError =>
  new ShotgunError({
    code: 'REVISION_CONFLICT',
    safeMessage: `${resource} revision mismatch. Refresh before submitting again.`,
    module: 'frontend-ask-write-postgres',
    operation: 'persist-question',
  });

export class PostgresAskConversationRepository implements AskConversationRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async transaction<T>(action: (transaction: unknown) => Promise<T>): Promise<T> {
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

  async persistQuestion(
    transaction: unknown,
    input: PersistAskQuestionInput,
  ): Promise<AskCommittedQuestion> {
    const client = transaction as PoolClient;
    if (input.conversationId) {
      return this.appendFollowUp(client, input);
    }
    return this.createConversation(client, input);
  }

  private async createConversation(
    client: PoolClient,
    input: PersistAskQuestionInput,
  ): Promise<AskCommittedQuestion> {
    await client.query(
      `INSERT INTO frontend_ask.conversations (
         conversation_id, project_id, title, active_branch_id,
         conversation_revision, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $6)`,
      [
        input.generated.conversationId,
        input.projectId,
        input.question.slice(0, 256),
        input.generated.branchId,
        input.generated.conversationRevision,
        input.createdAt,
      ],
    );
    await client.query(
      `INSERT INTO frontend_ask.branches (
         branch_id, conversation_id, label, branch_revision, created_at, updated_at
       ) VALUES ($1, $2, 'Main Branch', $3, $4, $4)`,
      [
        input.generated.branchId,
        input.generated.conversationId,
        input.generated.branchRevision,
        input.createdAt,
      ],
    );
    await this.insertTurnAndRun(client, input, {
      conversationId: input.generated.conversationId,
      branchId: input.generated.branchId,
      ordinal: 1,
    });
    return this.committed(input, input.generated.conversationId, input.generated.branchId);
  }

  private async appendFollowUp(
    client: PoolClient,
    input: PersistAskQuestionInput,
  ): Promise<AskCommittedQuestion> {
    const conversation = await client.query<ConversationRow>(
      `SELECT *
       FROM frontend_ask.conversations
       WHERE conversation_id = $1 AND project_id = $2
       FOR UPDATE`,
      [input.conversationId, input.projectId],
    );
    const currentConversation = conversation.rows[0];
    if (!currentConversation) throw notFound('append-question');
    if (currentConversation.conversation_revision !== input.expectedConversationRevision) {
      throw revisionConflict('Conversation');
    }

    const branchId = input.branchId ?? currentConversation.active_branch_id;
    const branch = await client.query<BranchRow>(
      `SELECT *
       FROM frontend_ask.branches
       WHERE conversation_id = $1 AND branch_id = $2
       FOR UPDATE`,
      [input.conversationId, branchId],
    );
    const currentBranch = branch.rows[0];
    if (!currentBranch) throw notFound('append-question');
    if (currentBranch.branch_revision !== input.expectedBranchRevision) {
      throw revisionConflict('Branch');
    }

    const next = await client.query<{ readonly ordinal: number }>(
      `SELECT COALESCE(MAX(ordinal), 0)::integer + 1 AS ordinal
       FROM frontend_ask.turns
       WHERE branch_id = $1`,
      [branchId],
    );
    const ordinal = next.rows[0]?.ordinal;
    if (!ordinal) {
      throw new ShotgunError({
        code: 'INTERNAL_UNCLASSIFIED',
        safeMessage: 'Unable to allocate the next Conversation Turn.',
        module: 'frontend-ask-write-postgres',
        operation: 'append-question',
      });
    }

    const conversationUpdate = await client.query(
      `UPDATE frontend_ask.conversations
       SET conversation_revision = $3, updated_at = $4
       WHERE conversation_id = $1 AND conversation_revision = $2`,
      [
        input.conversationId,
        input.expectedConversationRevision,
        input.generated.conversationRevision,
        input.createdAt,
      ],
    );
    if ((conversationUpdate.rowCount ?? 0) !== 1) throw revisionConflict('Conversation');

    const branchUpdate = await client.query(
      `UPDATE frontend_ask.branches
       SET branch_revision = $3, updated_at = $4
       WHERE branch_id = $1 AND branch_revision = $2`,
      [branchId, input.expectedBranchRevision, input.generated.branchRevision, input.createdAt],
    );
    if ((branchUpdate.rowCount ?? 0) !== 1) throw revisionConflict('Branch');

    await this.insertTurnAndRun(client, input, {
      conversationId: input.conversationId,
      branchId,
      ordinal,
    });
    return this.committed(input, input.conversationId, branchId);
  }

  private async insertTurnAndRun(
    client: PoolClient,
    input: PersistAskQuestionInput,
    identity: {
      readonly conversationId: string;
      readonly branchId: string;
      readonly ordinal: number;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO frontend_ask.turns (
         turn_id, conversation_id, branch_id, ordinal, user_message,
         ask_mode, turn_revision, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        input.generated.turnId,
        identity.conversationId,
        identity.branchId,
        identity.ordinal,
        input.question,
        input.mode,
        input.generated.turnRevision,
        input.createdAt,
      ],
    );
    await client.query(
      `INSERT INTO frontend_ask.answer_runs (
         answer_run_id, conversation_id, branch_id, turn_id, project_id,
         create_command_id, mode, state, attention_reason, question, capabilities,
          answer_revision, conversation_revision, access_revision, access_scope,
          sensitivity_clearance, policy_context_revision, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $11, $10, $12, $13, $14, $15, $16, $17, $18, $18
       )`,
      [
        input.generated.answerRunId,
        identity.conversationId,
        identity.branchId,
        input.generated.turnId,
        input.projectId,
        input.commandId,
        input.mode,
        input.executionEnabled ? 'QUEUED' : 'ACTION_REQUIRED',
        input.executionEnabled ? null : 'MODEL_EXECUTION_NOT_CONFIGURED',
        input.executionEnabled ? ['CANCEL'] : [],
        input.question,
        input.generated.answerRevision,
        input.generated.conversationRevision,
        input.accessRevision,
        input.accessScope ?? ['owner'],
        input.sensitivityClearance ?? 'public',
        input.policyContextRevision,
        input.createdAt,
      ],
    );

    if (input.executionEnabled) {
      await client.query(
        `INSERT INTO frontend_ask.answer_run_events (
           event_id, answer_run_id, project_id, ordinal, kind, state,
           answer_revision, created_at
         ) VALUES ($1, $2, $3, 0, 'STATE', 'QUEUED', $4, $5)`,
        [
          `event-${input.generated.answerRunId}-queued`,
          input.generated.answerRunId,
          input.projectId,
          input.generated.answerRevision,
          input.createdAt,
        ],
      );
    }

    for (
      let selectionOrdinal = 0;
      selectionOrdinal < input.sourceSelections.length;
      selectionOrdinal += 1
    ) {
      const selection = input.sourceSelections[selectionOrdinal];
      if (!selection) continue;
      const selectionId = `selection-${input.generated.answerRunId}-${selectionOrdinal}`;
      await client.query(
        `INSERT INTO frontend_ask.source_selections (
           selection_id, answer_run_id, project_id, source_id,
           source_version_id, selection_ordinal
         ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          selectionId,
          input.generated.answerRunId,
          input.projectId,
          selection.sourceId,
          selection.sourceVersionId,
          selectionOrdinal,
        ],
      );
      for (
        let evidenceOrdinal = 0;
        evidenceOrdinal < selection.evidenceIds.length;
        evidenceOrdinal += 1
      ) {
        const evidenceId = selection.evidenceIds[evidenceOrdinal];
        if (!evidenceId) continue;
        await client.query(
          `INSERT INTO frontend_ask.source_selection_evidence (
             selection_id, evidence_ordinal, evidence_id
           ) VALUES ($1, $2, $3)`,
          [selectionId, evidenceOrdinal, evidenceId],
        );
      }
    }
  }

  private committed(
    input: PersistAskQuestionInput,
    conversationId: string,
    branchId: string,
  ): AskCommittedQuestion {
    return {
      projectId: input.projectId,
      conversationId,
      branchId,
      turnId: input.generated.turnId,
      answerRunId: input.generated.answerRunId,
      conversationRevision: input.generated.conversationRevision,
      branchRevision: input.generated.branchRevision,
      turnRevision: input.generated.turnRevision,
      answerRevision: input.generated.answerRevision,
    };
  }
}

export class PostgresAskSourceSelectionValidator implements AskSourceSelectionValidatorPort {
  constructor(private readonly pool: Pool) {}

  async validate(input: Parameters<AskSourceSelectionValidatorPort['validate']>[0]): Promise<void> {
    for (const selection of input.sourceSelections) {
      const source = await this.pool.query<SourceAuthorityRow>(
        `SELECT
           source.project_id,
           source.source_id::text,
           version.source_version_id::text,
           version.sensitivity
         FROM asset.sources AS source
         JOIN asset.source_versions AS version
           ON version.source_id = source.source_id
         WHERE source.project_id = $1
           AND source.source_id::text = $2
           AND version.source_version_id::text = $3`,
        [input.projectId, selection.sourceId, selection.sourceVersionId],
      );
      const authoritative = source.rows[0];
      if (
        !authoritative ||
        !this.allowedSensitivity(authoritative.sensitivity, input.sensitivityClearance)
      ) {
        throw notFound('validate-source-selection');
      }

      if (selection.evidenceIds.length === 0) continue;
      const evidence = await this.pool.query<EvidenceAuthorityRow>(
        `SELECT
           evidence_id::text,
           project_id,
           source_id::text,
           source_version_id::text,
           sensitivity
         FROM evidence.spans
         WHERE evidence_id::text = ANY($1::text[])`,
        [[...selection.evidenceIds]],
      );
      const byId = new Map(evidence.rows.map((row) => [row.evidence_id, row]));
      for (const evidenceId of selection.evidenceIds) {
        const row = byId.get(evidenceId);
        if (
          !row ||
          row.project_id !== input.projectId ||
          row.source_id !== selection.sourceId ||
          row.source_version_id !== selection.sourceVersionId ||
          !this.allowedSensitivity(row.sensitivity, input.sensitivityClearance)
        ) {
          throw notFound('validate-source-selection');
        }
      }
    }
  }

  private allowedSensitivity(
    sensitivity: keyof typeof sensitivityRank,
    clearance: keyof typeof sensitivityRank,
  ): boolean {
    return sensitivityRank[sensitivity] <= sensitivityRank[clearance];
  }
}

export class PostgresAskWorkspaceProjection implements AskWorkspaceProjectionPort {
  constructor(private readonly pool: Pool) {}

  async getWorkspace(
    input: FrontendReadScope & { readonly conversationId?: string },
  ): Promise<AskWorkspaceView> {
    const projectId = input.conversationId
      ? await this.projectForConversation(input.conversationId)
      : input.activeProject?.id;
    if (!projectId || !this.hasProjectAccess(input, projectId)) {
      throw notFound('get-workspace');
    }

    const summaries = await this.pool.query<ConversationSummaryRow>(
      `SELECT
         conversation.conversation_id,
         conversation.project_id,
         conversation.title,
         conversation.active_branch_id,
         COUNT(turn.turn_id)::integer AS turn_count,
         COALESCE(
           (ARRAY_AGG(run.state ORDER BY turn.created_at DESC)
             FILTER (WHERE run.state IS NOT NULL))[1],
           'ACTION_REQUIRED'
         ) AS latest_run_state,
         conversation.updated_at
       FROM frontend_ask.conversations AS conversation
       LEFT JOIN frontend_ask.turns AS turn
         ON turn.conversation_id = conversation.conversation_id
       LEFT JOIN frontend_ask.answer_runs AS run
         ON run.turn_id = turn.turn_id
       WHERE conversation.project_id = $1
       GROUP BY conversation.conversation_id
       ORDER BY conversation.updated_at DESC, conversation.conversation_id`,
      [projectId],
    );

    const selectedConversation = input.conversationId
      ? await this.loadConversation(input.conversationId, projectId)
      : undefined;
    const fetchedAt = new Date().toISOString();
    return decodeAskWorkspaceView({
      schemaVersion: ASK_SCHEMA_VERSION,
      principalId: input.principalId,
      sessionId: input.sessionId,
      projectId,
      defaultAskMode: 'CANONICAL_ONLY',
      // SOURCE_EXPLORATION is not advertised until the product UI can pin a
      // server-authorized SourceVersion for the draft.
      availableAskModes: ['CANONICAL_ONLY', 'HYBRID'],
      conversations: summaries.rows.map((row) => ({
        conversationId: row.conversation_id,
        projectId: row.project_id,
        title: row.title,
        activeBranchId: row.active_branch_id,
        turnCount: row.turn_count,
        latestRunState: row.latest_run_state,
        updatedAt: row.updated_at.toISOString(),
      })),
      ...(selectedConversation ? { selectedConversation } : {}),
      capabilities: ['SUBMIT_QUESTION'],
      projectionRevision: `ask-projection-${input.accessRevision}-${input.policyContextRevision}`,
      accessRevision: input.accessRevision,
      policyContextRevision: input.policyContextRevision,
      fetchedAt,
      stale: false,
    });
  }

  async getConversation(
    input: FrontendReadScope & { readonly conversationId: string },
  ): Promise<AskConversationView> {
    const projectId = await this.projectForConversation(input.conversationId);
    if (!this.hasProjectAccess(input, projectId)) throw notFound('get-conversation');
    return this.loadConversation(input.conversationId, projectId);
  }

  async getBranch(
    input: FrontendReadScope & { readonly conversationId: string; readonly branchId: string },
  ): Promise<AskBranchView> {
    const conversation = await this.getConversation(input);
    const branch = conversation.branches.find((candidate) => candidate.branchId === input.branchId);
    if (!branch) throw notFound('get-branch');
    return branch;
  }

  async getAnswerRun(
    input: FrontendReadScope & { readonly answerRunId: string },
  ): Promise<AskAnswerRunSnapshot> {
    const identity = await this.pool.query<{
      readonly conversation_id: string;
      readonly project_id: string;
    }>(
      `SELECT conversation_id, project_id
       FROM frontend_ask.answer_runs
       WHERE answer_run_id = $1`,
      [input.answerRunId],
    );
    const row = identity.rows[0];
    if (!row || !this.hasProjectAccess(input, row.project_id)) throw notFound('get-answer-run');
    const conversation = await this.loadConversation(row.conversation_id, row.project_id);
    for (const branch of conversation.branches) {
      for (const turn of branch.turns) {
        if (turn.answerRun.answerRunId === input.answerRunId) return turn.answerRun;
      }
    }
    throw notFound('get-answer-run');
  }

  private async projectForConversation(conversationId: string): Promise<string> {
    const result = await this.pool.query<{ readonly project_id: string }>(
      `SELECT project_id
       FROM frontend_ask.conversations
       WHERE conversation_id = $1`,
      [conversationId],
    );
    const projectId = result.rows[0]?.project_id;
    if (!projectId) throw notFound('resolve-conversation-project');
    return projectId;
  }

  private hasProjectAccess(input: FrontendReadScope, projectId: string): boolean {
    return input.accessibleProjects.some((project) => project.id === projectId);
  }

  private async loadConversation(
    conversationId: string,
    projectId: string,
  ): Promise<AskConversationView> {
    const [
      conversationResult,
      branchesResult,
      turnsResult,
      runsResult,
      selectionsResult,
      statementsResult,
      citationsResult,
    ] = await Promise.all([
      this.pool.query<ConversationRow>(
        `SELECT * FROM frontend_ask.conversations
           WHERE conversation_id = $1 AND project_id = $2`,
        [conversationId, projectId],
      ),
      this.pool.query<BranchRow>(
        `SELECT * FROM frontend_ask.branches
           WHERE conversation_id = $1
           ORDER BY created_at, branch_id`,
        [conversationId],
      ),
      this.pool.query<TurnRow>(
        `SELECT * FROM frontend_ask.turns
           WHERE conversation_id = $1
           ORDER BY branch_id, ordinal, turn_id`,
        [conversationId],
      ),
      this.pool.query<AnswerRunRow>(
        `SELECT * FROM frontend_ask.answer_runs
           WHERE conversation_id = $1`,
        [conversationId],
      ),
      this.pool.query<SelectionRow>(
        `SELECT
             selection.selection_id,
             selection.answer_run_id,
             selection.selection_ordinal,
             selection.source_id::text,
             selection.source_version_id::text,
             evidence.evidence_id::text,
             evidence.evidence_ordinal
           FROM frontend_ask.source_selections AS selection
           LEFT JOIN frontend_ask.source_selection_evidence AS evidence
             ON evidence.selection_id = selection.selection_id
           JOIN frontend_ask.answer_runs AS run
             ON run.answer_run_id = selection.answer_run_id
           WHERE run.conversation_id = $1
           ORDER BY selection.answer_run_id, selection.selection_ordinal, evidence.evidence_ordinal`,
        [conversationId],
      ),
      this.pool.query<StatementRow>(
        `SELECT statement_id, answer_run_id, ordinal, text
           FROM frontend_ask.statements
           WHERE answer_run_id IN (
             SELECT answer_run_id FROM frontend_ask.answer_runs WHERE conversation_id = $1
           )
           ORDER BY answer_run_id, ordinal`,
        [conversationId],
      ),
      this.pool.query<CitationRow>(
        `SELECT
             citation.citation_id,
             citation.statement_id,
             citation.citation_ordinal,
             citation.source_id::text,
             citation.source_version_id::text,
             citation.evidence_id::text,
             citation.exact_quote
           FROM frontend_ask.citations AS citation
           JOIN frontend_ask.statements AS statement
             ON statement.statement_id = citation.statement_id
           JOIN frontend_ask.answer_runs AS run
             ON run.answer_run_id = statement.answer_run_id
           WHERE run.conversation_id = $1
           ORDER BY citation.statement_id, citation.citation_ordinal`,
        [conversationId],
      ),
    ]);

    const conversationRow = conversationResult.rows[0];
    if (!conversationRow) throw notFound('load-conversation');

    const evidenceBySelection = new Map<string, string[]>();
    const selectionsByRun = new Map<string, AskSourceSelectionView[]>();
    for (const row of selectionsResult.rows) {
      const evidence = evidenceBySelection.get(row.selection_id) ?? [];
      if (row.evidence_id) evidence.push(row.evidence_id);
      evidenceBySelection.set(row.selection_id, evidence);
      if (!selectionsByRun.has(row.answer_run_id)) selectionsByRun.set(row.answer_run_id, []);
    }
    const seenSelection = new Set<string>();
    for (const row of selectionsResult.rows) {
      if (seenSelection.has(row.selection_id)) continue;
      seenSelection.add(row.selection_id);
      selectionsByRun.get(row.answer_run_id)?.push({
        sourceId: row.source_id,
        sourceVersionId: row.source_version_id,
        evidenceIds: evidenceBySelection.get(row.selection_id) ?? [],
      });
    }

    const citationsByStatement = new Map<string, AskCitationView[]>();
    for (const row of citationsResult.rows) {
      const citations = citationsByStatement.get(row.statement_id) ?? [];
      citations.push({
        citationId: row.citation_id,
        sourceId: row.source_id,
        sourceVersionId: row.source_version_id,
        evidenceId: row.evidence_id,
        ...(row.exact_quote ? { exactQuote: row.exact_quote } : {}),
      });
      citationsByStatement.set(row.statement_id, citations);
    }
    const statementsByRun = new Map<
      string,
      {
        readonly statementId: string;
        readonly text: string;
        readonly citations: readonly AskCitationView[];
      }[]
    >();
    for (const row of statementsResult.rows) {
      const statements = statementsByRun.get(row.answer_run_id) ?? [];
      statements.push({
        statementId: row.statement_id,
        text: row.text,
        citations: citationsByStatement.get(row.statement_id) ?? [],
      });
      statementsByRun.set(row.answer_run_id, statements);
    }

    const runByTurn = new Map<string, AskAnswerRunSnapshot>();
    for (const row of runsResult.rows) {
      const hasFailure =
        row.failure_code !== null &&
        row.failure_message !== null &&
        row.failure_retryable !== null &&
        row.failure_outcome_unknown !== null;
      const hasProvider = row.provider_name !== null && row.provider_model !== null;
      const usage = {
        ...(row.input_tokens === null ? {} : { inputTokens: row.input_tokens }),
        ...(row.output_tokens === null ? {} : { outputTokens: row.output_tokens }),
        ...(row.total_tokens === null ? {} : { totalTokens: row.total_tokens }),
        ...(row.cost_micros === null
          ? {}
          : {
              costMicros:
                typeof row.cost_micros === 'string' ? Number(row.cost_micros) : row.cost_micros,
            }),
      };
      runByTurn.set(
        row.turn_id,
        decodeAskAnswerRunSnapshot({
          schemaVersion: ASK_SCHEMA_VERSION,
          answerRunId: row.answer_run_id,
          conversationId: row.conversation_id,
          branchId: row.branch_id,
          turnId: row.turn_id,
          projectId: row.project_id,
          mode: row.mode,
          state: row.state,
          ...(row.attention_reason ? { attentionReason: row.attention_reason } : {}),
          question: row.question,
          statements: statementsByRun.get(row.answer_run_id) ?? [],
          sourceSelections: selectionsByRun.get(row.answer_run_id) ?? [],
          capabilities: row.capabilities,
          answerRevision: row.answer_revision,
          conversationRevision: row.conversation_revision,
          accessRevision: row.access_revision,
          policyContextRevision: row.policy_context_revision,
          createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString(),
          stale: false,
          ...(row.attempt_number > 0 ? { attemptNumber: row.attempt_number } : {}),
          ...(row.event_revision > 0 ? { eventRevision: row.event_revision } : {}),
          ...(row.partial_text === null ? {} : { partialText: row.partial_text }),
          ...(hasFailure
            ? {
                failure: {
                  code: row.failure_code!,
                  message: row.failure_message!,
                  retryable: row.failure_retryable!,
                  outcomeUnknown: row.failure_outcome_unknown!,
                },
              }
            : {}),
          ...(hasProvider
            ? {
                provider: {
                  provider: row.provider_name!,
                  model: row.provider_model!,
                  ...(row.provider_adapter_version === null
                    ? {}
                    : { adapterVersion: row.provider_adapter_version }),
                },
              }
            : {}),
          ...(Object.keys(usage).length > 0 ? { usage } : {}),
        }),
      );
    }

    const turnsByBranch = new Map<string, AskBranchView['turns'][number][]>();
    for (const row of turnsResult.rows) {
      const answerRun = runByTurn.get(row.turn_id);
      if (!answerRun) {
        throw new ShotgunError({
          code: 'INTERNAL_UNCLASSIFIED',
          safeMessage: 'A Conversation Turn is missing its authoritative AnswerRun.',
          module: 'frontend-ask-write-postgres',
          operation: 'load-conversation',
        });
      }
      const turns = turnsByBranch.get(row.branch_id) ?? [];
      turns.push({
        turnId: row.turn_id,
        turnRevision: row.turn_revision,
        ordinal: row.ordinal,
        userMessage: row.user_message,
        createdAt: row.created_at.toISOString(),
        answerRun,
      });
      turnsByBranch.set(row.branch_id, turns);
    }

    return decodeAskConversationView({
      schemaVersion: ASK_SCHEMA_VERSION,
      conversationId: conversationRow.conversation_id,
      projectId: conversationRow.project_id,
      title: conversationRow.title,
      activeBranchId: conversationRow.active_branch_id,
      branches: branchesResult.rows.map((row) => ({
        branchId: row.branch_id,
        branchRevision: row.branch_revision,
        label: row.label,
        turns: turnsByBranch.get(row.branch_id) ?? [],
      })),
      conversationRevision: conversationRow.conversation_revision,
      createdAt: conversationRow.created_at.toISOString(),
      updatedAt: conversationRow.updated_at.toISOString(),
    });
  }
}
