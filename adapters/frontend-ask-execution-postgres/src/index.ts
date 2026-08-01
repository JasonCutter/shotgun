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
  sha256Text,
  stableJson,
} from '../../../packages/contracts/src/index.js';
import type {
  AskReadScope,
  AskWorkspaceQueryPort,
} from '../../../modules/frontend-ask-write/src/index.js';
import { highestSensitivity } from '../../../modules/frontend-ask-execution/src/index.js';
import type {
  AskAnswerExecutionRepositoryPort,
  AskClaimedExecution,
  AskExecutionAttempt,
  AskExecutionRunContext,
  AskExecutionScope,
  AskExecutionTransactionPort,
  AskWorkerLeaseState,
} from '../../../modules/frontend-ask-execution/src/index.js';

type RunRow = QueryResultRow & {
  readonly answer_run_id: string;
  readonly project_id: string;
  readonly state: AskAnswerRunSnapshot['state'];
  readonly attempt_number: number;
  readonly event_revision: number;
  readonly access_scope: string[];
  readonly sensitivity_clearance: AskExecutionScope['sensitivityClearance'];
  readonly access_revision: string;
  readonly policy_context_revision: string;
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
  readonly attempt_id: string | null;
  readonly partial_text: string | null;
  readonly answer_revision: string;
  readonly created_at: Date;
};

type ExportRow = QueryResultRow & {
  readonly export_id: string;
  readonly answer_run_id: string;
  readonly project_id: string;
  readonly format: AskAnswerExportFormat;
  readonly content: string;
  readonly created_at: Date;
};

type FeedbackRow = QueryResultRow & {
  readonly feedback_id: string;
  readonly answer_run_id: string;
  readonly project_id: string;
  readonly kind: AskAnswerFeedbackKind;
  readonly comment: string | null;
  readonly created_at: Date;
};

type TransitionSeedRow = QueryResultRow & {
  readonly seed_id: string;
  readonly answer_run_id: string;
  readonly project_id: string;
  readonly kind: AskTransitionSeedKind;
  readonly payload: AskTransitionSeedPayload;
  readonly created_at: Date;
};

type CancelMutationResult = {
  readonly state: AskAnswerRunState;
  readonly eventRevision: number;
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
  ...(scope.accessScope ? { accessScope: scope.accessScope } : {}),
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
    const resolved = await this.resolveContext(scope, snapshot);
    return { snapshot, ...resolved };
  }

  private async resolveContext(
    scope: AskExecutionScope,
    snapshot: AskAnswerRunSnapshot,
  ): Promise<
    Pick<
      AskExecutionRunContext,
      'evidence' | 'contextStatus' | 'resolvedContextDigest' | 'queryPlanRevision'
    >
  > {
    const selections = await this.pool.query<{
      readonly source_version_id: string;
      readonly evidence_id: string | null;
    }>(
      `SELECT selection.source_version_id::text, selected.evidence_id::text
       FROM frontend_ask.source_selections AS selection
       LEFT JOIN frontend_ask.source_selection_evidence AS selected
         ON selected.selection_id = selection.selection_id
       WHERE selection.answer_run_id = $1 AND selection.project_id = $2
       ORDER BY selection.selection_ordinal, selected.evidence_ordinal`,
      [snapshot.answerRunId, scope.projectId],
    );
    const sourceVersionIds = [...new Set(selections.rows.map((row) => row.source_version_id))];
    if (snapshot.mode === 'SOURCE_EXPLORATION' && sourceVersionIds.length === 0) {
      throw invalid('SOURCE_EXPLORATION requires at least one pinned SourceVersion.');
    }
    const selectedEvidenceIds = selections.rows.flatMap((row) =>
      row.evidence_id ? [row.evidence_id] : [],
    );
    const implicitSourceVersionIds = [
      ...new Set(
        selections.rows
          .filter((row) => row.evidence_id === null)
          .map((row) => row.source_version_id),
      ),
    ];
    const implicitSourceEvidenceIds =
      implicitSourceVersionIds.length > 0
        ? (
            await this.pool.query<{ readonly evidence_id: string }>(
              `SELECT evidence_id
               FROM (
                 SELECT evidence_id,
                        MAX(
                          ts_rank(
                            document.search_vector,
                            websearch_to_tsquery('simple', $3)
                          )
                        ) AS relevance
                 FROM projection.search_documents AS document,
                      unnest(document.evidence_ids) AS evidence_id
                 WHERE document.project_id = $1
                   AND document.source_version_id::text = ANY($2::text[])
                   AND document.access_scope <@ $4::text[]
                   AND (
                     document.search_vector @@ websearch_to_tsquery('simple', $3)
                     OR document.claim_text % $3
                     OR document.claim_text ILIKE '%' || $3 || '%'
                   )
                 GROUP BY evidence_id
               ) AS ranked
               ORDER BY relevance DESC NULLS LAST, evidence_id
               LIMIT 100`,
              [
                scope.projectId,
                implicitSourceVersionIds,
                snapshot.question,
                scope.accessScope ?? [],
              ],
            )
          ).rows.map((row) => row.evidence_id)
        : [];
    const sourceEvidenceIds = [...new Set([...selectedEvidenceIds, ...implicitSourceEvidenceIds])];
    const canonicalEvidenceIds =
      snapshot.mode === 'SOURCE_EXPLORATION'
        ? []
        : (
            await this.pool.query<{ readonly evidence_id: string }>(
              `SELECT DISTINCT evidence_id
               FROM projection.search_documents AS document,
                    unnest(document.evidence_ids) AS evidence_id
               WHERE document.project_id = $1
                 AND document.access_scope <@ $2::text[]
                 AND (
                   document.search_vector @@ websearch_to_tsquery('simple', $3)
                    OR document.claim_text % $3
                   OR document.claim_text ILIKE '%' || $3 || '%'
                 )
               ORDER BY evidence_id
               LIMIT 100`,
              [scope.projectId, scope.accessScope ?? [], snapshot.question],
            )
          ).rows.map((row) => row.evidence_id);
    const evidenceIds =
      snapshot.mode === 'CANONICAL_ONLY'
        ? canonicalEvidenceIds
        : snapshot.mode === 'HYBRID'
          ? [...new Set([...canonicalEvidenceIds, ...sourceEvidenceIds])]
          : sourceEvidenceIds;
    const evidenceResult =
      evidenceIds.length === 0
        ? { rows: [] as EvidenceRow[] }
        : await this.pool.query<EvidenceRow>(
            `SELECT
               spans.evidence_id::text,
               spans.source_id::text,
               spans.source_version_id::text,
               spans.quote ->> 'exact' AS exact_quote,
               spans.sensitivity
             FROM evidence.spans AS spans
              WHERE spans.project_id = $1
                AND spans.evidence_id::text = ANY($2::text[])
                AND spans.access_scope <@ $3::text[]
              ORDER BY array_position($2::text[], spans.evidence_id::text)`,
            [scope.projectId, evidenceIds, scope.accessScope ?? []],
          );
    const evidenceById = new Map(evidenceResult.rows.map((row) => [row.evidence_id, row]));
    for (const selection of selections.rows) {
      if (!selection.evidence_id) continue;
      const evidence = evidenceById.get(selection.evidence_id);
      if (!evidence || evidence.source_version_id !== selection.source_version_id) {
        throw invalid(
          'An explicitly selected EvidenceSpan is no longer valid for this SourceVersion.',
        );
      }
    }
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
    const queryPlanRevision = 'ask-query-plan-v2';
    return {
      evidence,
      contextStatus: evidence.length > 0 ? 'SUPPORTED' : 'NO_SUPPORTED_ANSWER',
      queryPlanRevision,
      resolvedContextDigest: sha256Text(
        stableJson({
          queryPlanRevision,
          projectId: scope.projectId,
          mode: snapshot.mode,
          question: snapshot.question,
          evidence: evidence.map((item) => ({
            evidenceId: item.evidenceId,
            sourceVersionId: item.sourceVersionId,
            exactQuote: item.exactQuote,
          })),
        }),
      ),
    };
  }

  async claimInitial(
    scope: AskExecutionScope,
    answerRunId: string,
    workerId?: string,
  ): Promise<AskClaimedExecution | undefined> {
    const context = await this.getRunContext(scope, answerRunId);
    if (!context || context.snapshot.state !== 'QUEUED') return undefined;
    const claimed = await this.poolTransaction(async (client) => {
      const row = await this.lockRun(client, scope, answerRunId);
      if (!row || row.state !== 'QUEUED') return undefined;
      return this.claimLocked(
        client,
        row,
        context,
        scope,
        'INITIAL',
        workerId ?? `ask-worker-${process.pid}-${randomUUID()}`,
      );
    });
    return claimed;
  }

  async retryAndClaim(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly mode: AskAnswerRunRetryMode;
    readonly workerId?: string;
  }): Promise<AskClaimedExecution> {
    const current = await this.getRunContext(input.scope, input.answerRunId);
    const context =
      current && input.mode === 'SAME_CONTEXT'
        ? ((await this.loadAttemptContext(input.scope, current.snapshot)) ?? current)
        : current;
    if (!context) throw notFound();
    const claimed = await this.poolTransaction((client) =>
      this.retryAndClaimWithClient(client, input, context),
    );
    if (!claimed) throw notFound();
    return claimed;
  }

  private async loadAttemptContext(
    scope: AskExecutionScope,
    snapshot: AskAnswerRunSnapshot,
  ): Promise<AskExecutionRunContext | undefined> {
    const attemptNumber = snapshot.attemptNumber;
    if (!attemptNumber) return undefined;
    const attempt = await this.pool.query<{
      readonly context_supported: boolean;
      readonly resolved_context_digest: string | null;
      readonly query_plan_revision: string | null;
    }>(
      `SELECT context_supported, resolved_context_digest, query_plan_revision
       FROM frontend_ask.answer_run_attempts
       WHERE answer_run_id = $1 AND project_id = $2 AND attempt_number = $3`,
      [snapshot.answerRunId, scope.projectId, attemptNumber],
    );
    const row = attempt.rows[0];
    if (!row) return undefined;
    const evidence = await this.pool.query<EvidenceRow>(
      `SELECT evidence_id::text, source_id::text, source_version_id::text,
              exact_quote, sensitivity
       FROM frontend_ask.answer_attempt_evidence
       WHERE attempt_id = (
         SELECT attempt_id FROM frontend_ask.answer_run_attempts
         WHERE answer_run_id = $1 AND project_id = $2 AND attempt_number = $3
       )
       ORDER BY evidence_ordinal`,
      [snapshot.answerRunId, scope.projectId, attemptNumber],
    );
    return {
      snapshot,
      evidence: evidence.rows.map((item) => ({
        evidenceId: item.evidence_id,
        sourceId: item.source_id,
        sourceVersionId: item.source_version_id,
        exactQuote: item.exact_quote,
        sensitivity: item.sensitivity,
      })),
      contextStatus:
        row.context_supported && evidence.rows.length > 0 ? 'SUPPORTED' : 'NO_SUPPORTED_ANSWER',
      resolvedContextDigest:
        row.resolved_context_digest ??
        sha256Text(stableJson({ answerRunId: snapshot.answerRunId, attemptNumber })),
      queryPlanRevision: row.query_plan_revision ?? 'ask-query-plan-v2',
    };
  }

  private async retryAndClaimWithClient(
    client: PoolClient,
    input: {
      readonly scope: AskExecutionScope;
      readonly answerRunId: string;
      readonly mode: AskAnswerRunRetryMode;
      readonly workerId?: string;
    },
    context: AskExecutionRunContext,
  ): Promise<AskClaimedExecution> {
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
      input.workerId ?? `ask-worker-${process.pid}-${randomUUID()}`,
    );
  }

  async requestCancel(
    scope: AskExecutionScope,
    answerRunId: string,
  ): Promise<AskAnswerRunSnapshot> {
    await this.poolTransaction((client) =>
      this.requestCancelWithClient(client, scope, answerRunId),
    );
    const current = await this.getRunContext(scope, answerRunId);
    if (!current) throw notFound();
    return current.snapshot;
  }

  private async requestCancelWithClient(
    client: PoolClient,
    scope: AskExecutionScope,
    answerRunId: string,
  ): Promise<CancelMutationResult> {
    const row = await this.lockRun(client, scope, answerRunId);
    if (!row) throw notFound();
    let nextState: AskAnswerRunState;
    let eventRevision = Number(row.event_revision);
    if (row.state === 'QUEUED') {
      nextState = 'CANCELLED';
      eventRevision += 1;
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
      nextState = 'CANCEL_REQUESTED';
      if (row.state !== 'CANCEL_REQUESTED') {
        eventRevision += 1;
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
    return { state: nextState, eventRevision };
  }

  async isCancelRequested(scope: AskExecutionScope, answerRunId: string): Promise<boolean> {
    const result = await this.pool.query<{ readonly state: AskAnswerRunSnapshot['state'] }>(
      `SELECT state FROM frontend_ask.answer_runs WHERE answer_run_id = $1 AND project_id = $2`,
      [answerRunId, scope.projectId],
    );
    if (!result.rows[0]) throw notFound();
    return result.rows[0].state === 'CANCEL_REQUESTED' || result.rows[0].state === 'CANCELLED';
  }

  private async attemptIdFor(
    client: PoolClient,
    input: {
      readonly scope: AskExecutionScope;
      readonly answerRunId: string;
      readonly attemptNumber: number;
    },
  ): Promise<string> {
    const result = await client.query<{ readonly attempt_id: string }>(
      `SELECT attempt_id
       FROM frontend_ask.answer_run_attempts
       WHERE answer_run_id = $1 AND project_id = $2 AND attempt_number = $3`,
      [input.answerRunId, input.scope.projectId, input.attemptNumber],
    );
    return result.rows[0]?.attempt_id ?? '';
  }

  private async ownsLiveAttempt(
    client: PoolClient,
    input: {
      readonly scope: AskExecutionScope;
      readonly answerRunId: string;
      readonly attemptId: string;
      readonly attemptNumber: number;
      readonly workerId: string;
      readonly runState: AskAnswerRunState;
      readonly allowCancelRequested?: boolean;
    },
  ): Promise<boolean> {
    if (
      !['RUNNING', 'STREAMING', 'PARTIAL'].includes(input.runState) &&
      !(input.allowCancelRequested && input.runState === 'CANCEL_REQUESTED')
    ) {
      return false;
    }
    const result = await client.query<{
      readonly state: string;
      readonly lease_owner: string | null;
      readonly lease_expires_at: Date | null;
      readonly attempt_number: number;
    }>(
      `SELECT state, lease_owner, lease_expires_at, attempt_number
       FROM frontend_ask.answer_run_attempts
       WHERE attempt_id = $1 AND answer_run_id = $2 AND project_id = $3
       FOR UPDATE`,
      [input.attemptId, input.answerRunId, input.scope.projectId],
    );
    const attempt = result.rows[0];
    return Boolean(
      attempt &&
      attempt.attempt_number === input.attemptNumber &&
      attempt.state === 'RUNNING' &&
      attempt.lease_owner === input.workerId &&
      attempt.lease_expires_at &&
      attempt.lease_expires_at.getTime() >= Date.now(),
    );
  }

  async appendPartial(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly attemptId: string;
    readonly attemptNumber: number;
    readonly partialText: string;
    readonly workerId: string;
  }): Promise<void> {
    await this.poolTransaction(async (client) => {
      const row = await this.lockRun(client, input.scope, input.answerRunId);
      if (
        !row ||
        !(await this.ownsLiveAttempt(client, {
          ...input,
          runState: row.state,
        }))
      )
        return;
      const heartbeatAt = new Date().toISOString();
      const leaseExpiresAt = new Date(Date.now() + 30_000).toISOString();
      const refreshed = await client.query(
        `UPDATE frontend_ask.answer_run_attempts
         SET heartbeat_at = $4, lease_expires_at = $5, updated_at = $4
         WHERE attempt_id = $1 AND answer_run_id = $2 AND project_id = $3
            AND state = 'RUNNING' AND lease_owner = $6 AND lease_expires_at >= now()`,
        [
          input.attemptId,
          input.answerRunId,
          input.scope.projectId,
          heartbeatAt,
          leaseExpiresAt,
          input.workerId,
        ],
      );
      if ((refreshed.rowCount ?? 0) !== 1) return;
      let eventRevision = Number(row.event_revision);
      if (row.state === 'RUNNING') {
        eventRevision += 1;
        await this.updateRun(client, input.scope, input.answerRunId, {
          state: 'STREAMING',
          eventRevision,
        });
        await this.appendEvent(
          client,
          input.scope,
          input.answerRunId,
          'STATE',
          'STREAMING',
          eventRevision,
          undefined,
          input.attemptId,
        );
      }
      eventRevision += 1;
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
        input.attemptId,
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
    readonly providerResponseId?: string;
    readonly dataPolicyVersion?: string;
    readonly resolvedContextDigest?: string;
    readonly queryPlanRevision?: string;
    readonly usage?: AskAnswerRunUsage;
    readonly workerId: string;
  }): Promise<AskAnswerRunSnapshot> {
    await this.poolTransaction(async (client) => {
      const row = await this.lockRun(client, input.scope, input.answerRunId);
      if (!row) return;
      const attemptId = await this.attemptIdFor(client, input);
      if (
        !(await this.ownsLiveAttempt(client, {
          scope: input.scope,
          answerRunId: input.answerRunId,
          attemptId,
          attemptNumber: input.attemptNumber,
          workerId: input.workerId,
          runState: row.state,
        }))
      )
        return;
      const completedAt = new Date().toISOString();
      const attemptUpdate = await client.query(
        `UPDATE frontend_ask.answer_run_attempts
            SET state = 'SUCCEEDED', provider_name = $3, provider_model = $4,
                provider_adapter_version = $5, provider_response_id = $6,
                data_policy_version = $7, resolved_context_digest = $8,
                query_plan_revision = $9, lease_owner = NULL, lease_expires_at = NULL,
                heartbeat_at = $10, updated_at = $10, completed_at = $10
            WHERE answer_run_id = $1 AND project_id = $2 AND attempt_number = $11
              AND state = 'RUNNING' AND lease_owner = $12 AND lease_expires_at >= now()`,
        [
          input.answerRunId,
          input.scope.projectId,
          input.provider.provider,
          input.provider.model,
          input.provider.adapterVersion ?? null,
          input.providerResponseId ?? null,
          input.dataPolicyVersion ?? null,
          input.resolvedContextDigest ?? null,
          input.queryPlanRevision ?? null,
          completedAt,
          input.attemptNumber,
          input.workerId,
        ],
      );
      if ((attemptUpdate.rowCount ?? 0) !== 1) return;
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
      await this.appendEvent(
        client,
        input.scope,
        input.answerRunId,
        'COMPLETED',
        'SUCCEEDED',
        eventRevision,
        undefined,
        attemptId,
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
    readonly workerId: string;
  }): Promise<AskAnswerRunSnapshot> {
    await this.poolTransaction(async (client) => {
      const row = await this.lockRun(client, input.scope, input.answerRunId);
      if (!row) return;
      const attemptState = input.state === 'CANCELLED' ? 'CANCELLED' : input.state;
      const attemptId = await this.attemptIdFor(client, input);
      if (
        !(await this.ownsLiveAttempt(client, {
          scope: input.scope,
          answerRunId: input.answerRunId,
          attemptId,
          attemptNumber: input.attemptNumber,
          workerId: input.workerId,
          runState: row.state,
          allowCancelRequested: input.state === 'CANCELLED',
        }))
      )
        return;
      const failedAt = new Date().toISOString();
      const attemptUpdate = await client.query(
        `UPDATE frontend_ask.answer_run_attempts
           SET state = $4, failure_code = $5, failure_message = $6,
               failure_retryable = $7, failure_outcome_unknown = $8,
              lease_owner = NULL, lease_expires_at = NULL,
              heartbeat_at = $3, updated_at = $3, completed_at = $3
          WHERE answer_run_id = $1 AND project_id = $2 AND attempt_number = $9
            AND state = 'RUNNING' AND lease_owner = $10 AND lease_expires_at >= now()`,
        [
          input.answerRunId,
          input.scope.projectId,
          failedAt,
          attemptState,
          input.failure.code,
          input.failure.message,
          input.failure.retryable,
          input.failure.outcomeUnknown,
          input.attemptNumber,
          input.workerId,
        ],
      );
      if ((attemptUpdate.rowCount ?? 0) !== 1) return;
      const eventRevision = Number(row.event_revision) + 1;
      await this.updateRun(client, input.scope, input.answerRunId, {
        state: input.state,
        capabilities: ['RETRY_SAME_CONTEXT', 'RETRY_CURRENT_POLICY'],
        failure: input.failure,
        eventRevision,
      });
      await this.appendEvent(
        client,
        input.scope,
        input.answerRunId,
        input.state === 'CANCELLED' ? 'CANCELLED' : 'FAILED',
        input.state,
        eventRevision,
        undefined,
        attemptId,
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
              partial_text, answer_revision, created_at, attempt_id
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
      ...(row.attempt_id === null ? {} : { attemptId: row.attempt_id }),
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
    return this.saveExportWithClient(undefined, input);
  }

  private async saveExportWithClient(
    client: PoolClient | undefined,
    input: {
      readonly scope: AskExecutionScope;
      readonly answerRunId: string;
      readonly format: AskAnswerExportFormat;
      readonly content: string;
      readonly requestId: string;
    },
  ): Promise<AskAnswerRunExportView> {
    const sql = `INSERT INTO frontend_ask.answer_exports (
         export_id, answer_run_id, project_id, principal_id, format, content, request_id, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (principal_id, answer_run_id, request_id)
       DO UPDATE SET format = frontend_ask.answer_exports.format
        RETURNING export_id, answer_run_id, project_id, format, content, created_at`;
    const values = [
      `export-${randomUUID()}`,
      input.answerRunId,
      input.scope.projectId,
      input.scope.principalId,
      input.format,
      input.content,
      input.requestId,
      new Date().toISOString(),
    ];
    const result = client
      ? await client.query<ExportRow>(sql, values)
      : await this.pool.query<ExportRow>(sql, values);
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
    return this.saveFeedbackWithClient(undefined, input);
  }

  private async saveFeedbackWithClient(
    client: PoolClient | undefined,
    input: {
      readonly scope: AskExecutionScope;
      readonly answerRunId: string;
      readonly kind: AskAnswerFeedbackKind;
      readonly comment?: string;
      readonly requestId: string;
    },
  ): Promise<AskAnswerRunFeedbackView> {
    const sql = `INSERT INTO frontend_ask.answer_feedback (
         feedback_id, answer_run_id, project_id, principal_id, kind, comment, request_id, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (principal_id, answer_run_id, request_id)
       DO UPDATE SET kind = frontend_ask.answer_feedback.kind
        RETURNING feedback_id, answer_run_id, project_id, kind, comment, created_at`;
    const values = [
      `feedback-${randomUUID()}`,
      input.answerRunId,
      input.scope.projectId,
      input.scope.principalId,
      input.kind,
      input.comment ?? null,
      input.requestId,
      new Date().toISOString(),
    ];
    const result = client
      ? await client.query<FeedbackRow>(sql, values)
      : await this.pool.query<FeedbackRow>(sql, values);
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
    return this.saveTransitionSeedWithClient(undefined, input);
  }

  private async saveTransitionSeedWithClient(
    client: PoolClient | undefined,
    input: {
      readonly scope: AskExecutionScope;
      readonly answerRunId: string;
      readonly kind: AskTransitionSeedKind;
      readonly payload: AskTransitionSeedPayload;
      readonly requestId: string;
    },
  ): Promise<AskTransitionSeedView> {
    const sql = `INSERT INTO frontend_ask.transition_seeds (
         seed_id, answer_run_id, project_id, principal_id, kind, state, payload, request_id, created_at
       ) VALUES ($1, $2, $3, $4, $5, 'PROPOSED', $6::jsonb, $7, $8)
       ON CONFLICT (principal_id, answer_run_id, kind, request_id)
       DO UPDATE SET kind = frontend_ask.transition_seeds.kind
        RETURNING seed_id, answer_run_id, project_id, kind, payload, created_at`;
    const values = [
      `seed-${randomUUID()}`,
      input.answerRunId,
      input.scope.projectId,
      input.scope.principalId,
      input.kind,
      JSON.stringify(input.payload),
      input.requestId,
      new Date().toISOString(),
    ];
    const result = client
      ? await client.query<TransitionSeedRow>(sql, values)
      : await this.pool.query<TransitionSeedRow>(sql, values);
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

  async findExportByRequestId(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly requestId: string;
  }): Promise<AskAnswerRunExportView | undefined> {
    const context = await this.getRunContext(input.scope, input.answerRunId);
    if (!context) throw notFound();
    const result = await this.pool.query<ExportRow>(
      `SELECT export_id, answer_run_id, project_id, format, content, created_at
       FROM frontend_ask.answer_exports
       WHERE principal_id = $1 AND answer_run_id = $2 AND project_id = $3 AND request_id = $4`,
      [input.scope.principalId, input.answerRunId, input.scope.projectId, input.requestId],
    );
    const row = result.rows[0];
    return row
      ? {
          schemaVersion: ASK_SCHEMA_VERSION,
          exportId: row.export_id,
          answerRunId: row.answer_run_id,
          projectId: row.project_id,
          format: row.format,
          content: row.content,
          createdAt: row.created_at.toISOString(),
        }
      : undefined;
  }

  async findFeedbackByRequestId(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly requestId: string;
  }): Promise<AskAnswerRunFeedbackView | undefined> {
    const context = await this.getRunContext(input.scope, input.answerRunId);
    if (!context) throw notFound();
    const result = await this.pool.query<FeedbackRow>(
      `SELECT feedback_id, answer_run_id, project_id, kind, comment, created_at
       FROM frontend_ask.answer_feedback
       WHERE principal_id = $1 AND answer_run_id = $2 AND project_id = $3 AND request_id = $4`,
      [input.scope.principalId, input.answerRunId, input.scope.projectId, input.requestId],
    );
    const row = result.rows[0];
    return row
      ? {
          schemaVersion: ASK_SCHEMA_VERSION,
          feedbackId: row.feedback_id,
          answerRunId: row.answer_run_id,
          projectId: row.project_id,
          kind: row.kind,
          ...(row.comment === null ? {} : { comment: row.comment }),
          createdAt: row.created_at.toISOString(),
        }
      : undefined;
  }

  async findTransitionSeedByRequestId(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly kind: AskTransitionSeedKind;
    readonly requestId: string;
  }): Promise<AskTransitionSeedView | undefined> {
    const context = await this.getRunContext(input.scope, input.answerRunId);
    if (!context) throw notFound();
    const result = await this.pool.query<TransitionSeedRow>(
      `SELECT seed_id, answer_run_id, project_id, kind, payload, created_at
       FROM frontend_ask.transition_seeds
       WHERE principal_id = $1 AND answer_run_id = $2 AND project_id = $3
         AND kind = $4 AND request_id = $5`,
      [
        input.scope.principalId,
        input.answerRunId,
        input.scope.projectId,
        input.kind,
        input.requestId,
      ],
    );
    const row = result.rows[0];
    return row
      ? {
          schemaVersion: ASK_SCHEMA_VERSION,
          seedId: row.seed_id,
          answerRunId: row.answer_run_id,
          projectId: row.project_id,
          kind: row.kind,
          state: 'PROPOSED',
          payload: row.payload,
          createdAt: row.created_at.toISOString(),
        }
      : undefined;
  }

  async setAttemptAudit(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly attemptId: string;
    readonly dataPolicyVersion: string;
    readonly workerId: string;
  }): Promise<void> {
    const result = await this.pool.query(
      `UPDATE frontend_ask.answer_run_attempts
       SET data_policy_version = $4, heartbeat_at = $5, updated_at = $5
       WHERE attempt_id = $1 AND answer_run_id = $2 AND project_id = $3
          AND state = 'RUNNING' AND lease_owner = $6 AND lease_expires_at >= now()`,
      [
        input.attemptId,
        input.answerRunId,
        input.scope.projectId,
        input.dataPolicyVersion,
        new Date().toISOString(),
        input.workerId,
      ],
    );
    if (result.rowCount === 0) throw notFound();
  }

  async heartbeatAttempt(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly attemptId: string;
    readonly workerId: string;
  }): Promise<AskWorkerLeaseState> {
    const current = await this.pool.query<{
      readonly attempt_state: string;
      readonly lease_owner: string | null;
      readonly lease_expires_at: Date | null;
      readonly run_state: AskAnswerRunState;
    }>(
      `SELECT attempt.state AS attempt_state, attempt.lease_owner, attempt.lease_expires_at,
              run.state AS run_state
       FROM frontend_ask.answer_run_attempts AS attempt
       JOIN frontend_ask.answer_runs AS run
         ON run.answer_run_id = attempt.answer_run_id AND run.project_id = attempt.project_id
       WHERE attempt.attempt_id = $1 AND attempt.answer_run_id = $2 AND attempt.project_id = $3`,
      [input.attemptId, input.answerRunId, input.scope.projectId],
    );
    const row = current.rows[0];
    if (!row) return 'TERMINAL';
    if (row.run_state === 'CANCEL_REQUESTED') return 'CANCEL_REQUESTED';
    if (['CANCELLED', 'SUCCEEDED', 'FAILED', 'OUTCOME_UNKNOWN'].includes(row.run_state))
      return 'TERMINAL';
    if (
      row.attempt_state !== 'RUNNING' ||
      row.lease_owner !== input.workerId ||
      !row.lease_expires_at ||
      row.lease_expires_at.getTime() < Date.now()
    )
      return 'LEASE_LOST';
    const heartbeatAt = new Date().toISOString();
    const result = await this.pool.query(
      `UPDATE frontend_ask.answer_run_attempts
       SET heartbeat_at = $4, lease_expires_at = $5, updated_at = $4
       WHERE attempt_id = $1 AND answer_run_id = $2 AND project_id = $3
          AND state = 'RUNNING' AND lease_owner = $6 AND lease_expires_at >= now()`,
      [
        input.attemptId,
        input.answerRunId,
        input.scope.projectId,
        heartbeatAt,
        new Date(Date.now() + 30_000).toISOString(),
        input.workerId,
      ],
    );
    return (result.rowCount ?? 0) > 0 ? 'OWNED' : 'LEASE_LOST';
  }

  async transaction<T>(
    action: (transaction: AskExecutionTransactionPort) => Promise<T>,
  ): Promise<T> {
    const afterCommit: (() => void)[] = [];
    const result = await this.withPostgresTransaction(async (client) => {
      const transaction: AskExecutionTransactionPort = {
        rawTransaction: client,
        afterCommit: (callback) => afterCommit.push(callback),
        getRunContext: (scope, answerRunId) => this.getRunContext(scope, answerRunId),
        requestCancel: async (scope, answerRunId) => {
          const context = await this.getRunContext(scope, answerRunId);
          if (!context) throw notFound();
          const mutation = await this.requestCancelWithClient(client, scope, answerRunId);
          return {
            ...context.snapshot,
            state: mutation.state,
            eventRevision: mutation.eventRevision,
            capabilities:
              mutation.state === 'CANCELLED' ? ['RETRY_SAME_CONTEXT', 'RETRY_CURRENT_POLICY'] : [],
            ...(mutation.state === 'CANCELLED'
              ? {
                  failure: {
                    code: 'CANCELLED',
                    message: 'The AnswerRun was cancelled by the user.',
                    retryable: true,
                    outcomeUnknown: false,
                  },
                }
              : {}),
            updatedAt: new Date().toISOString(),
          };
        },
        retryAndClaim: async (input) => {
          const current = await this.getRunContext(input.scope, input.answerRunId);
          const context =
            current && input.mode === 'SAME_CONTEXT'
              ? ((await this.loadAttemptContext(input.scope, current.snapshot)) ?? current)
              : current;
          if (!context) throw notFound();
          return this.retryAndClaimWithClient(client, input, context);
        },
        saveExport: (input) => this.saveExportWithClient(client, input),
        saveFeedback: (input) => this.saveFeedbackWithClient(client, input),
        saveTransitionSeed: (input) => this.saveTransitionSeedWithClient(client, input),
      };
      return action(transaction);
    });
    // A callback is a post-commit wake-up hook, not part of the transaction.
    // Its failure must never turn a committed mutation into a rejection.
    for (const callback of afterCommit) {
      try {
        callback();
      } catch (error) {
        console.error('[frontend-ask-execution] post-commit callback failed', error);
      }
    }
    return result;
  }

  async recoverInterrupted(): Promise<number> {
    return this.poolTransaction(async (client) => {
      const candidates = await client.query<{
        readonly attempt_id: string;
        readonly answer_run_id: string;
        readonly project_id: string;
        readonly attempt_number: number;
        readonly state: AskAnswerRunState;
      }>(
        `SELECT attempt.attempt_id, attempt.answer_run_id, attempt.project_id,
                attempt.attempt_number, run.state
         FROM frontend_ask.answer_run_attempts AS attempt
         JOIN frontend_ask.answer_runs AS run
           ON run.answer_run_id = attempt.answer_run_id
          AND run.project_id = attempt.project_id
         WHERE attempt.state = 'RUNNING'
           AND (
            (
              run.state = 'CANCEL_REQUESTED'
              AND attempt.lease_expires_at IS NOT NULL
              AND attempt.lease_expires_at < now()
            ) OR (
               run.state IN ('RUNNING', 'STREAMING', 'PARTIAL')
               AND attempt.lease_expires_at IS NOT NULL
               AND attempt.lease_expires_at < now()
             )
           )
         ORDER BY attempt.created_at, attempt.attempt_id
          FOR UPDATE OF attempt, run SKIP LOCKED`,
      );
      let recovered = 0;
      for (const candidate of candidates.rows) {
        const row = await this.lockRun(
          client,
          {
            principalId: 'ask-worker',
            projectId: candidate.project_id,
            accessRevision: 'recovery',
            policyContextRevision: 'recovery',
            sensitivityClearance: 'restricted',
          },
          candidate.answer_run_id,
        );
        if (!row || row.attempt_number !== candidate.attempt_number) continue;
        const cancelled = row.state === 'CANCEL_REQUESTED';
        const nextState: Extract<AskAnswerRunState, 'CANCELLED' | 'OUTCOME_UNKNOWN'> = cancelled
          ? 'CANCELLED'
          : 'OUTCOME_UNKNOWN';
        const failure: AskAnswerRunFailure = cancelled
          ? {
              code: 'CANCELLED',
              message: 'The execution was cancelled after worker recovery.',
              retryable: true,
              outcomeUnknown: false,
            }
          : {
              code: 'OUTCOME_UNKNOWN',
              message: 'The execution worker stopped before the provider outcome was known.',
              retryable: false,
              outcomeUnknown: true,
            };
        const recoveryScope: AskExecutionScope = {
          principalId: 'ask-worker',
          projectId: row.project_id,
          accessRevision: row.access_revision,
          policyContextRevision: row.policy_context_revision,
          sensitivityClearance: row.sensitivity_clearance,
          accessScope: row.access_scope,
        };
        const completedAt = new Date().toISOString();
        const attemptUpdate = await client.query(
          `UPDATE frontend_ask.answer_run_attempts
           SET state = $2, failure_code = $3, failure_message = $4,
               failure_retryable = $5, failure_outcome_unknown = $6,
               lease_owner = NULL, lease_expires_at = NULL,
               heartbeat_at = $7, updated_at = $7, completed_at = $7
            WHERE attempt_id = $1 AND state = 'RUNNING' AND lease_expires_at < now()`,
          [
            candidate.attempt_id,
            nextState,
            failure.code,
            failure.message,
            failure.retryable,
            failure.outcomeUnknown,
            completedAt,
          ],
        );
        if ((attemptUpdate.rowCount ?? 0) !== 1) continue;
        const eventRevision = Number(row.event_revision) + 1;
        await this.updateRun(client, recoveryScope, candidate.answer_run_id, {
          state: nextState,
          capabilities: ['RETRY_SAME_CONTEXT', 'RETRY_CURRENT_POLICY'],
          failure,
          eventRevision,
        });
        await this.appendEvent(
          client,
          recoveryScope,
          candidate.answer_run_id,
          cancelled ? 'CANCELLED' : 'FAILED',
          nextState,
          eventRevision,
          undefined,
          candidate.attempt_id,
        );
        recovered += 1;
      }
      return recovered;
    });
  }

  async claimQueuedForWorker(workerId?: string): Promise<
    readonly {
      readonly scope: AskExecutionScope;
      readonly claimed: AskClaimedExecution;
    }[]
  > {
    const owner = workerId ?? `ask-worker-${process.pid}-${randomUUID()}`;
    const result = await this.pool.query<RunRow>(
      `SELECT answer_run_id, project_id, state, attempt_number, event_revision,
              access_scope, sensitivity_clearance, access_revision,
              policy_context_revision
       FROM frontend_ask.answer_runs
       WHERE state = 'QUEUED'
       ORDER BY created_at, answer_run_id
       LIMIT 32`,
    );
    const claimed: { scope: AskExecutionScope; claimed: AskClaimedExecution }[] = [];
    for (const row of result.rows) {
      const scope: AskExecutionScope = {
        principalId: 'ask-worker',
        projectId: row.project_id,
        accessRevision: row.access_revision,
        policyContextRevision: row.policy_context_revision,
        sensitivityClearance: row.sensitivity_clearance,
        accessScope: row.access_scope,
      };
      const execution = await this.claimInitial(scope, row.answer_run_id, owner);
      if (execution) claimed.push({ scope, claimed: execution });
    }
    return claimed;
  }

  private async claimLocked(
    client: PoolClient,
    row: RunRow,
    context: AskExecutionRunContext,
    scope: AskExecutionScope,
    kind: AskExecutionAttempt['kind'],
    workerId: string,
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
          state, access_revision, policy_context_revision, resolved_context_digest,
           query_plan_revision, context_supported, resolved_sensitivity,
           created_at, updated_at,
           started_at, heartbeat_at, lease_owner, lease_expires_at
        ) VALUES ($1, $2, $3, $4, $5, 'RUNNING', $6, $7, $8, $9, $10, $11, $12, $12, $12, $12, $13, $14)`,
      [
        attemptId,
        row.answer_run_id,
        scope.projectId,
        attemptNumber,
        kind,
        accessRevision,
        policyContextRevision,
        context.resolvedContextDigest,
        context.queryPlanRevision,
        context.contextStatus === 'SUPPORTED',
        highestSensitivity(context.evidence),
        createdAt,
        workerId,
        new Date(Date.now() + 30_000).toISOString(),
      ],
    );
    for (let index = 0; index < context.evidence.length; index += 1) {
      const evidence = context.evidence[index];
      if (!evidence) continue;
      await client.query(
        `INSERT INTO frontend_ask.answer_attempt_evidence (
           attempt_id, evidence_ordinal, evidence_id, source_id,
           source_version_id, exact_quote, sensitivity
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          attemptId,
          index,
          evidence.evidenceId,
          evidence.sourceId,
          evidence.sourceVersionId,
          evidence.exactQuote,
          evidence.sensitivity,
        ],
      );
    }
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
    await this.appendEvent(
      client,
      scope,
      row.answer_run_id,
      'STATE',
      'RUNNING',
      eventRevision,
      undefined,
      attemptId,
    );
    return {
      attempt: {
        attemptId,
        attemptNumber,
        kind,
        accessRevision,
        policyContextRevision,
        resolvedContextDigest: context.resolvedContextDigest,
        queryPlanRevision: context.queryPlanRevision,
        resolvedSensitivity: highestSensitivity(context.evidence),
        leaseOwner: workerId,
      },
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
        contextStatus: context.contextStatus,
        resolvedContextDigest: context.resolvedContextDigest,
        queryPlanRevision: context.queryPlanRevision,
      },
    };
  }

  private async lockRun(
    client: PoolClient,
    scope: AskExecutionScope,
    answerRunId: string,
  ): Promise<RunRow | undefined> {
    const result = await client.query<RunRow>(
      `SELECT answer_run_id, project_id, state, attempt_number, event_revision,
              access_scope, sensitivity_clearance, access_revision,
              policy_context_revision
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
    attemptId?: string,
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
          partial_text, answer_revision, created_at, attempt_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
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
        attemptId ?? null,
      ],
    );
  }

  private async poolTransaction<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.withPostgresTransaction(action);
  }

  private async withPostgresTransaction<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let state:
      | 'BEFORE_COMMIT'
      | 'COMMIT_ATTEMPTED'
      | 'COMMITTED'
      | 'ROLLBACK_ATTEMPTED'
      | 'ROLLED_BACK'
      | 'OUTCOME_UNKNOWN' = 'BEFORE_COMMIT';
    try {
      await client.query('BEGIN');
      const result = await action(client);
      state = 'COMMIT_ATTEMPTED';
      try {
        await client.query('COMMIT');
        state = 'COMMITTED';
      } catch (error) {
        state = 'OUTCOME_UNKNOWN';
        throw new ShotgunError({
          code: 'OUTCOME_UNKNOWN',
          safeMessage: 'The AnswerRun command transaction outcome could not be resolved.',
          module: 'frontend-ask-execution-postgres',
          operation: 'commit-command-transaction',
          cause: error,
        });
      }
      return result;
    } catch (error) {
      if (state === 'BEFORE_COMMIT') {
        state = 'ROLLBACK_ATTEMPTED';
        try {
          await client.query('ROLLBACK');
          state = 'ROLLED_BACK';
        } catch (rollbackError) {
          state = 'OUTCOME_UNKNOWN';
          throw new ShotgunError({
            code: 'OUTCOME_UNKNOWN',
            safeMessage:
              'The AnswerRun command transaction rollback outcome could not be resolved.',
            module: 'frontend-ask-execution-postgres',
            operation: 'rollback-command-transaction',
            cause: rollbackError,
          });
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
