import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient, QueryResultRow } from 'pg';

import {
  ASK_SCHEMA_VERSION,
  ShotgunError,
  type AskAnswerRunEventView,
  type AskAnswerRunExportView,
  type AskAnswerRunFeedbackView,
  type AskAnswerRunFailure,
  type AskAnswerRunProvider,
  type AskAnswerRunRetryMode,
  type AskAnswerRunSnapshot,
  type AskAnswerRunState,
  type AskAnswerRunUsage,
  type AskAnswerExportFormat,
  type AskAnswerFeedbackKind,
  type AskCitationView,
  type AskTransitionSeedKind,
  type AskTransitionSeedPayload,
  type AskTransitionSeedView,
} from '../../../packages/contracts/src/index.js';
import type {
  AskReadScope,
  AskWorkspaceQueryPort,
} from '../../../modules/frontend-ask-write/src/index.js';
import type {
  AskAnswerExecutionRepositoryPort,
  AskClaimedExecution,
  AskExecutionAttempt,
  AskExecutionRunContext,
  AskExecutionScope,
} from '../../../modules/frontend-ask-execution/src/index.js';

type RunRow = QueryResultRow & {
  readonly answer_run_id: string;
  readonly project_id: string;
  readonly state: AskAnswerRunSnapshot['state'];
  readonly attempt_number: number;
  readonly event_revision: number;
};

type EvidenceRow = QueryResultRow & {
  readonly evidence_id: string;
  readonly source_id: string;
  readonly source_version_id: string;
  readonly exact_quote: string;
  readonly sensitivity: AskExecutionScope['sensitivityClearance'];
};

type EventRow = QueryResultRow & {
  readonly event_id: string;
  readonly answer_run_id: string;
  readonly project_id: string;
  readonly ordinal: number;
  readonly kind: AskAnswerRunEventView['kind'];
  readonly state: AskAnswerRunEventView['state'];
  readonly partial_text: string | null;
  readonly answer_revision: string;
  readonly created_at: Date;
};

const sensitivityRank = {
  public: 0,
  internal: 1,
  private: 2,
  restricted: 3,
} as const;

const notFound = (): ShotgunError =>
  new ShotgunError({
    code: 'NOT_FOUND',
    safeMessage: 'The requested AnswerRun was not found.',
    module: 'frontend-ask-execution-postgres',
    operation: 'resolve-answer-run',
  });

const invalid = (message: string): ShotgunError =>
  new ShotgunError({
    code: 'INVALID_REQUEST',
    safeMessage: message,
    module: 'frontend-ask-execution-postgres',
    operation: 'execution',
  });

const readScope = (scope: AskExecutionScope): AskReadScope => ({
  principalId: scope.principalId,
  sessionId: 'ask-execution',
  activeProject: {
    id: scope.projectId,
    label: 'Execution Project',
    isOwner: false,
    sensitivityClearance: scope.sensitivityClearance,
  },
  accessibleProjects: [
    {
      id: scope.projectId,
      label: 'Execution Project',
      isOwner: false,
      sensitivityClearance: scope.sensitivityClearance,
    },
  ],
  accessRevision: scope.accessRevision,
  policyContextRevision: scope.policyContextRevision,
});

export class PostgresAskAnswerExecutionRepository implements AskAnswerExecutionRepositoryPort {
  constructor(
    private readonly pool: Pool,
    private readonly workspace: AskWorkspaceQueryPort,
  ) {}

  async getRunContext(
    scope: AskExecutionScope,
    answerRunId: string,
  ): Promise<AskExecutionRunContext | undefined> {
    let snapshot: AskAnswerRunSnapshot;
    try {
      snapshot = await this.workspace.getAnswerRun({ ...readScope(scope), answerRunId });
    } catch (error) {
      if (error instanceof ShotgunError && error.code === 'NOT_FOUND') return undefined;
      throw error;
    }
    const evidenceResult = await this.pool.query<EvidenceRow>(
      `SELECT
         spans.evidence_id::text,
         spans.source_id::text,
         spans.source_version_id::text,
         spans.quote ->> 'exact' AS exact_quote,
         spans.sensitivity
       FROM frontend_ask.source_selection_evidence AS selected
       JOIN frontend_ask.source_selections AS selection
         ON selection.selection_id = selected.selection_id
       JOIN evidence.spans AS spans
         ON spans.evidence_id = selected.evidence_id
       WHERE selection.answer_run_id = $1
         AND selection.project_id = $2
       ORDER BY selection.selection_ordinal, selected.evidence_ordinal`,
      [answerRunId, scope.projectId],
    );
    const evidence = evidenceResult.rows.map((row) => {
      if (sensitivityRank[row.sensitivity] > sensitivityRank[scope.sensitivityClearance]) {
        throw invalid('The AnswerRun contains Evidence outside the current sensitivity clearance.');
      }
      return {
        evidenceId: row.evidence_id,
        sourceId: row.source_id,
        sourceVersionId: row.source_version_id,
        exactQuote: row.exact_quote,
        sensitivity: row.sensitivity,
      };
    });
    return { snapshot, evidence };
  }

  async claimInitial(
    scope: AskExecutionScope,
    answerRunId: string,
  ): Promise<AskClaimedExecution | undefined> {
    const context = await this.getRunContext(scope, answerRunId);
    if (!context || context.snapshot.state !== 'QUEUED') return undefined;
    const claimed = await this.poolTransaction(async (client) => {
      const row = await this.lockRun(client, scope, answerRunId);
      if (!row || row.state !== 'QUEUED') return undefined;
      return this.claimLocked(client, row, context, scope, 'INITIAL');
    });
    return claimed;
  }

  async retryAndClaim(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly mode: AskAnswerRunRetryMode;
  }): Promise<AskClaimedExecution> {
    const context = await this.getRunContext(input.scope, input.answerRunId);
    if (!context) throw notFound();
    const claimed = await this.poolTransaction(async (client) => {
      const row = await this.lockRun(client, input.scope, input.answerRunId);
      if (!row) throw notFound();
      if (!['FAILED', 'CANCELLED', 'OUTCOME_UNKNOWN'].includes(row.state)) {
        throw invalid('Only a failed, cancelled, or outcome-unknown AnswerRun can retry.');
      }
      return this.claimLocked(
        client,
        row,
        context,
        input.scope,
        input.mode === 'SAME_CONTEXT' ? 'RETRY_SAME_CONTEXT' : 'RETRY_CURRENT_POLICY',
      );
    });
    if (!claimed) throw notFound();
    const current = await this.getRunContext(input.scope, input.answerRunId);
    return current ? { ...claimed, context: current } : claimed;
  }

  async requestCancel(
    scope: AskExecutionScope,
    answerRunId: string,
  ): Promise<AskAnswerRunSnapshot> {
    const result = await this.poolTransaction(async (client) => {
      const row = await this.lockRun(client, scope, answerRunId);
      if (!row) throw notFound();
      if (row.state === 'QUEUED') {
        const eventRevision = Number(row.event_revision) + 1;
        await this.updateRun(client, scope, answerRunId, {
          state: 'CANCELLED',
          capabilities: ['RETRY_SAME_CONTEXT', 'RETRY_CURRENT_POLICY'],
          failure: {
            code: 'CANCELLED',
            message: 'The AnswerRun was cancelled by the user.',
            retryable: true,
            outcomeUnknown: false,
          },
          eventRevision,
        });
        await this.appendEvent(client, scope, answerRunId, 'CANCELLED', 'CANCELLED', eventRevision);
      } else if (['RUNNING', 'STREAMING', 'PARTIAL', 'CANCEL_REQUESTED'].includes(row.state)) {
        if (row.state !== 'CANCEL_REQUESTED') {
          const eventRevision = Number(row.event_revision) + 1;
          await this.updateRun(client, scope, answerRunId, {
            state: 'CANCEL_REQUESTED',
            capabilities: [],
            eventRevision,
          });
          await this.appendEvent(
            client,
            scope,
            answerRunId,
            'STATE',
            'CANCEL_REQUESTED',
            eventRevision,
          );
        }
      } else {
        throw invalid('Only an active AnswerRun can be cancelled.');
      }
    });
    void result;
    const current = await this.getRunContext(scope, answerRunId);
    if (!current) throw notFound();
    return current.snapshot;
  }

  async isCancelRequested(scope: AskExecutionScope, answerRunId: string): Promise<boolean> {
    const result = await this.pool.query<{ readonly state: AskAnswerRunSnapshot['state'] }>(
      `SELECT state FROM frontend_ask.answer_runs WHERE answer_run_id = $1 AND project_id = $2`,
      [answerRunId, scope.projectId],
    );
    if (!result.rows[0]) throw notFound();
    return result.rows[0].state === 'CANCEL_REQUESTED' || result.rows[0].state === 'CANCELLED';
  }

  async appendPartial(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly attemptNumber: number;
    readonly partialText: string;
  }): Promise<void> {
    await this.poolTransaction(async (client) => {
      const row = await this.lockRun(client, input.scope, input.answerRunId);
      if (!row || row.attempt_number !== input.attemptNumber || row.state === 'CANCEL_REQUESTED')
        return;
      const eventRevision = Number(row.event_revision) + 1;
      await this.updateRun(client, input.scope, input.answerRunId, {
        state: 'PARTIAL',
        partialText: input.partialText,
        eventRevision,
      });
      await this.appendEvent(
        client,
        input.scope,
        input.answerRunId,
        'PARTIAL',
        'PARTIAL',
        eventRevision,
        input.partialText,
      );
    });
  }

  async complete(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly attemptNumber: number;
    readonly answer: string;
    readonly citations: readonly AskCitationView[];
    readonly provider: AskAnswerRunProvider;
    readonly usage?: AskAnswerRunUsage;
  }): Promise<AskAnswerRunSnapshot> {
    await this.poolTransaction(async (client) => {
      const row = await this.lockRun(client, input.scope, input.answerRunId);
      if (!row || row.attempt_number !== input.attemptNumber || row.state === 'CANCEL_REQUESTED')
        return;
      const statementId = `statement-${randomUUID()}`;
      await client.query(
        `INSERT INTO frontend_ask.statements (
           statement_id, answer_run_id, ordinal, text, statement_revision
         ) VALUES ($1, $2, 0, $3, $4)`,
        [statementId, input.answerRunId, input.answer, `answer-${randomUUID()}`],
      );
      for (let index = 0; index < input.citations.length; index += 1) {
        const citation = input.citations[index];
        if (!citation) continue;
        await client.query(
          `INSERT INTO frontend_ask.citations (
             citation_id, statement_id, citation_ordinal, source_id,
             source_version_id, evidence_id, exact_quote
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            citation.citationId,
            statementId,
            index,
            citation.sourceId,
            citation.sourceVersionId,
            citation.evidenceId,
            citation.exactQuote ?? null,
          ],
        );
      }
      const eventRevision = Number(row.event_revision) + 1;
      await this.updateRun(client, input.scope, input.answerRunId, {
        state: 'SUCCEEDED',
        capabilities: [
          'EXPORT',
          'CREATE_INTAKE_DRAFT',
          'CREATE_DRAFT_CHANGE_SET',
          'PROPOSE_DIRECTIVE',
        ],
        failure: null,
        partialText: null,
        provider: input.provider,
        usage: input.usage,
        eventRevision,
      });
      await client.query(
        `UPDATE frontend_ask.answer_run_attempts
         SET state = 'SUCCEEDED', provider_name = $3, provider_model = $4,
             provider_adapter_version = $5, updated_at = $6, completed_at = $6
         WHERE answer_run_id = $1 AND project_id = $2 AND attempt_number = $7`,
        [
          input.answerRunId,
          input.scope.projectId,
          input.provider.provider,
          input.provider.model,
          input.provider.adapterVersion ?? null,
          new Date().toISOString(),
          input.attemptNumber,
        ],
      );
      await this.appendEvent(
        client,
        input.scope,
        input.answerRunId,
        'COMPLETED',
        'SUCCEEDED',
        eventRevision,
      );
    });
    const current = await this.getRunContext(input.scope, input.answerRunId);
    if (!current) throw notFound();
    return current.snapshot;
  }

  async fail(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly attemptNumber: number;
    readonly failure: AskAnswerRunFailure;
    readonly state: Extract<AskAnswerRunState, 'FAILED' | 'OUTCOME_UNKNOWN' | 'CANCELLED'>;
  }): Promise<AskAnswerRunSnapshot> {
    await this.poolTransaction(async (client) => {
      const row = await this.lockRun(client, input.scope, input.answerRunId);
      if (!row || (row.attempt_number !== input.attemptNumber && row.state !== 'CANCEL_REQUESTED'))
        return;
      const eventRevision = Number(row.event_revision) + 1;
      await this.updateRun(client, input.scope, input.answerRunId, {
        state: input.state,
        capabilities: ['RETRY_SAME_CONTEXT', 'RETRY_CURRENT_POLICY'],
        failure: input.failure,
        eventRevision,
      });
      const attemptState = input.state === 'CANCELLED' ? 'CANCELLED' : input.state;
      await client.query(
        `UPDATE frontend_ask.answer_run_attempts
         SET state = $4, failure_code = $5, failure_message = $6,
             failure_retryable = $7, failure_outcome_unknown = $8,
             updated_at = $3, completed_at = $3
         WHERE answer_run_id = $1 AND project_id = $2 AND attempt_number = $9`,
        [
          input.answerRunId,
          input.scope.projectId,
          new Date().toISOString(),
          attemptState,
          input.failure.code,
          input.failure.message,
          input.failure.retryable,
          input.failure.outcomeUnknown,
          input.attemptNumber,
        ],
      );
      await this.appendEvent(
        client,
        input.scope,
        input.answerRunId,
        input.state === 'CANCELLED' ? 'CANCELLED' : 'FAILED',
        input.state,
        eventRevision,
      );
    });
    const current = await this.getRunContext(input.scope, input.answerRunId);
    if (!current) throw notFound();
    return current.snapshot;
  }

  async getEvents(
    scope: AskExecutionScope,
    answerRunId: string,
    afterOrdinal = -1,
  ): Promise<readonly AskAnswerRunEventView[]> {
    const context = await this.getRunContext(scope, answerRunId);
    if (!context) throw notFound();
    const result = await this.pool.query<EventRow>(
      `SELECT event_id, answer_run_id, project_id, ordinal, kind, state,
              partial_text, answer_revision, created_at
       FROM frontend_ask.answer_run_events
       WHERE answer_run_id = $1 AND project_id = $2 AND ordinal > $3
       ORDER BY ordinal`,
      [answerRunId, scope.projectId, afterOrdinal],
    );
    return result.rows.map((row) => ({
      schemaVersion: ASK_SCHEMA_VERSION,
      eventId: row.event_id,
      answerRunId: row.answer_run_id,
      projectId: row.project_id,
      ordinal: row.ordinal,
      kind: row.kind,
      state: row.state,
      ...(row.partial_text === null ? {} : { partialText: row.partial_text }),
      answerRevision: row.answer_revision,
      createdAt: row.created_at.toISOString(),
    }));
  }

  async saveExport(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly format: AskAnswerExportFormat;
    readonly content: string;
    readonly requestId: string;
  }): Promise<AskAnswerRunExportView> {
    const context = await this.getRunContext(input.scope, input.answerRunId);
    if (!context) throw notFound();
    const result = await this.pool.query<{
      export_id: string;
      answer_run_id: string;
      project_id: string;
      format: AskAnswerExportFormat;
      content: string;
      created_at: Date;
    }>(
      `INSERT INTO frontend_ask.answer_exports (
         export_id, answer_run_id, project_id, principal_id, format, content, request_id, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (principal_id, answer_run_id, request_id)
       DO UPDATE SET format = frontend_ask.answer_exports.format
       RETURNING export_id, answer_run_id, project_id, format, content, created_at`,
      [
        `export-${randomUUID()}`,
        input.answerRunId,
        input.scope.projectId,
        input.scope.principalId,
        input.format,
        input.content,
        input.requestId,
        new Date().toISOString(),
      ],
    );
    const row = result.rows[0];
    if (!row) throw notFound();
    return {
      schemaVersion: ASK_SCHEMA_VERSION,
      exportId: row.export_id,
      answerRunId: row.answer_run_id,
      projectId: row.project_id,
      format: row.format,
      content: row.content,
      createdAt: row.created_at.toISOString(),
    };
  }

  async saveFeedback(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly kind: AskAnswerFeedbackKind;
    readonly comment?: string;
    readonly requestId: string;
  }): Promise<AskAnswerRunFeedbackView> {
    const context = await this.getRunContext(input.scope, input.answerRunId);
    if (!context) throw notFound();
    const result = await this.pool.query<{
      feedback_id: string;
      answer_run_id: string;
      project_id: string;
      kind: AskAnswerFeedbackKind;
      comment: string | null;
      created_at: Date;
    }>(
      `INSERT INTO frontend_ask.answer_feedback (
         feedback_id, answer_run_id, project_id, principal_id, kind, comment, request_id, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (principal_id, answer_run_id, request_id)
       DO UPDATE SET kind = frontend_ask.answer_feedback.kind
       RETURNING feedback_id, answer_run_id, project_id, kind, comment, created_at`,
      [
        `feedback-${randomUUID()}`,
        input.answerRunId,
        input.scope.projectId,
        input.scope.principalId,
        input.kind,
        input.comment ?? null,
        input.requestId,
        new Date().toISOString(),
      ],
    );
    const row = result.rows[0];
    if (!row) throw notFound();
    return {
      schemaVersion: ASK_SCHEMA_VERSION,
      feedbackId: row.feedback_id,
      answerRunId: row.answer_run_id,
      projectId: row.project_id,
      kind: row.kind,
      ...(row.comment === null ? {} : { comment: row.comment }),
      createdAt: row.created_at.toISOString(),
    };
  }

  async saveTransitionSeed(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly kind: AskTransitionSeedKind;
    readonly payload: AskTransitionSeedPayload;
    readonly requestId: string;
  }): Promise<AskTransitionSeedView> {
    const context = await this.getRunContext(input.scope, input.answerRunId);
    if (!context) throw notFound();
    const result = await this.pool.query<{
      seed_id: string;
      answer_run_id: string;
      project_id: string;
      kind: AskTransitionSeedKind;
      payload: AskTransitionSeedPayload;
      created_at: Date;
    }>(
      `INSERT INTO frontend_ask.transition_seeds (
         seed_id, answer_run_id, project_id, principal_id, kind, state, payload, request_id, created_at
       ) VALUES ($1, $2, $3, $4, $5, 'PROPOSED', $6::jsonb, $7, $8)
       ON CONFLICT (principal_id, answer_run_id, kind, request_id)
       DO UPDATE SET kind = frontend_ask.transition_seeds.kind
       RETURNING seed_id, answer_run_id, project_id, kind, payload, created_at`,
      [
        `seed-${randomUUID()}`,
        input.answerRunId,
        input.scope.projectId,
        input.scope.principalId,
        input.kind,
        JSON.stringify(input.payload),
        input.requestId,
        new Date().toISOString(),
      ],
    );
    const row = result.rows[0];
    if (!row) throw notFound();
    return {
      schemaVersion: ASK_SCHEMA_VERSION,
      seedId: row.seed_id,
      answerRunId: row.answer_run_id,
      projectId: row.project_id,
      kind: row.kind,
      state: 'PROPOSED',
      payload: row.payload,
      createdAt: row.created_at.toISOString(),
    };
  }

  private async claimLocked(
    client: PoolClient,
    row: RunRow,
    context: AskExecutionRunContext,
    scope: AskExecutionScope,
    kind: AskExecutionAttempt['kind'],
  ): Promise<AskClaimedExecution> {
    const attemptNumber = Number(row.attempt_number) + 1;
    const accessRevision =
      kind === 'RETRY_SAME_CONTEXT' ? context.snapshot.accessRevision : scope.accessRevision;
    const policyContextRevision =
      kind === 'RETRY_SAME_CONTEXT'
        ? context.snapshot.policyContextRevision
        : scope.policyContextRevision;
    const attemptId = `attempt-${randomUUID()}`;
    const createdAt = new Date().toISOString();
    await client.query(
      `INSERT INTO frontend_ask.answer_run_attempts (
         attempt_id, answer_run_id, project_id, attempt_number, attempt_kind,
         state, access_revision, policy_context_revision, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, 'RUNNING', $6, $7, $8, $8)`,
      [
        attemptId,
        row.answer_run_id,
        scope.projectId,
        attemptNumber,
        kind,
        accessRevision,
        policyContextRevision,
        createdAt,
      ],
    );
    const eventRevision = Number(row.event_revision) + 1;
    await this.updateRun(client, scope, row.answer_run_id, {
      state: 'RUNNING',
      capabilities: ['CANCEL'],
      failure: null,
      partialText: null,
      attemptNumber,
      eventRevision,
      accessRevision,
      policyContextRevision,
    });
    await this.appendEvent(client, scope, row.answer_run_id, 'STATE', 'RUNNING', eventRevision);
    return {
      attempt: { attemptId, attemptNumber, kind, accessRevision, policyContextRevision },
      context: {
        snapshot: {
          ...context.snapshot,
          state: 'RUNNING',
          capabilities: ['CANCEL'],
          attemptNumber,
          eventRevision,
          accessRevision,
          policyContextRevision,
          updatedAt: createdAt,
          ...(context.snapshot.attentionReason ? { attentionReason: undefined } : {}),
        },
        evidence: context.evidence,
      },
    };
  }

  private async lockRun(
    client: PoolClient,
    scope: AskExecutionScope,
    answerRunId: string,
  ): Promise<RunRow | undefined> {
    const result = await client.query<RunRow>(
      `SELECT answer_run_id, project_id, state, attempt_number, event_revision
       FROM frontend_ask.answer_runs
       WHERE answer_run_id = $1 AND project_id = $2
       FOR UPDATE`,
      [answerRunId, scope.projectId],
    );
    return result.rows[0];
  }

  private async updateRun(
    client: PoolClient,
    scope: AskExecutionScope,
    answerRunId: string,
    patch: {
      readonly state?: string;
      readonly capabilities?: readonly string[];
      readonly failure?: AskAnswerRunFailure | null;
      readonly partialText?: string | null;
      readonly provider?: AskAnswerRunProvider;
      readonly usage?: AskAnswerRunUsage;
      readonly attemptNumber?: number;
      readonly eventRevision: number;
      readonly accessRevision?: string;
      readonly policyContextRevision?: string;
    },
  ): Promise<void> {
    const provider = patch.provider;
    const usage = patch.usage;
    await client.query(
      `UPDATE frontend_ask.answer_runs
       SET state = COALESCE($3, state),
           attention_reason = CASE WHEN COALESCE($3, state) = 'ACTION_REQUIRED' THEN attention_reason ELSE NULL END,
           capabilities = COALESCE($4::text[], capabilities),
           failure_code = $5,
           failure_message = $6,
           failure_retryable = $7,
           failure_outcome_unknown = $8,
           partial_text = CASE WHEN $9::boolean THEN $10 ELSE partial_text END,
           provider_name = COALESCE($11, provider_name),
           provider_model = COALESCE($12, provider_model),
           provider_adapter_version = COALESCE($13, provider_adapter_version),
           input_tokens = COALESCE($14, input_tokens),
           output_tokens = COALESCE($15, output_tokens),
           total_tokens = COALESCE($16, total_tokens),
           cost_micros = COALESCE($17, cost_micros),
           attempt_number = COALESCE($18, attempt_number),
           event_revision = $19,
           access_revision = COALESCE($20, access_revision),
           policy_context_revision = COALESCE($21, policy_context_revision),
           updated_at = $22
       WHERE answer_run_id = $1 AND project_id = $2`,
      [
        answerRunId,
        scope.projectId,
        patch.state ?? null,
        patch.capabilities ?? null,
        patch.failure?.code ?? null,
        patch.failure?.message ?? null,
        patch.failure?.retryable ?? null,
        patch.failure?.outcomeUnknown ?? null,
        patch.partialText !== undefined,
        patch.partialText ?? null,
        provider?.provider ?? null,
        provider?.model ?? null,
        provider?.adapterVersion ?? null,
        usage?.inputTokens ?? null,
        usage?.outputTokens ?? null,
        usage?.totalTokens ?? null,
        usage?.costMicros ?? null,
        patch.attemptNumber ?? null,
        patch.eventRevision,
        patch.accessRevision ?? null,
        patch.policyContextRevision ?? null,
        new Date().toISOString(),
      ],
    );
  }

  private async appendEvent(
    client: PoolClient,
    scope: AskExecutionScope,
    answerRunId: string,
    kind: AskAnswerRunEventView['kind'],
    state: AskAnswerRunEventView['state'],
    _eventRevision: number,
    partialText?: string,
  ): Promise<void> {
    const next = await client.query<{ readonly ordinal: number }>(
      `SELECT COALESCE(MAX(ordinal), -1)::integer + 1 AS ordinal
       FROM frontend_ask.answer_run_events
       WHERE answer_run_id = $1 AND project_id = $2`,
      [answerRunId, scope.projectId],
    );
    const ordinal = next.rows[0]?.ordinal;
    if (ordinal === undefined) throw new Error('Unable to allocate an AnswerRun event ordinal.');
    const revision = await client.query<{ readonly answer_revision: string }>(
      `SELECT answer_revision FROM frontend_ask.answer_runs
       WHERE answer_run_id = $1 AND project_id = $2`,
      [answerRunId, scope.projectId],
    );
    const answerRevision = revision.rows[0]?.answer_revision;
    if (!answerRevision) throw notFound();
    await client.query(
      `INSERT INTO frontend_ask.answer_run_events (
         event_id, answer_run_id, project_id, ordinal, kind, state,
         partial_text, answer_revision, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        `event-${randomUUID()}`,
        answerRunId,
        scope.projectId,
        ordinal,
        kind,
        state,
        partialText ?? null,
        answerRevision,
        new Date().toISOString(),
      ],
    );
  }

  private async poolTransaction<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
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
}
