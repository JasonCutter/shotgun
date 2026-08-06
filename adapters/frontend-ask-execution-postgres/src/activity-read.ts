import type { Pool, QueryResultRow } from 'pg';

import {
  ASK_SCHEMA_VERSION,
  type AskAnswerRunEventKind,
  type AskAnswerRunEventView,
  type AskAnswerRunState,
} from '../../../packages/contracts/src/index.js';
import {
  decodeAskActivityCursor,
  encodeAskActivityCursor,
  type AskActivityAnswerRunRow,
  type AskActivityReadPort,
} from '../../../modules/frontend-activity/src/index.js';

/**
 * FE-P5-S1 WP3 — PostgreSQL `AskActivityReadPort`.
 *
 * Reads the Ask Domain's `frontend_ask` tables directly (answer-run queue +
 * bounded answer-run events). The Activity read exposes only bounded
 * operational fields (never provider payloads or answer content), keyed by the
 * concrete Domain identity `answerRunId` within the active Project.
 */

type RunRow = QueryResultRow & {
  readonly answer_run_id: string;
  readonly project_id: string;
  readonly state: AskAnswerRunState;
  readonly attention_reason: string | null;
  readonly failure_code: string | null;
  readonly failure_message: string | null;
  readonly failure_retryable: boolean | null;
  readonly failure_outcome_unknown: boolean | null;
  readonly attempt_number: number;
  readonly attempt_id: string | null;
  readonly access_revision: string;
  readonly policy_context_revision: string;
  readonly sensitivity_clearance: string;
  readonly created_at: Date;
  readonly updated_at: Date;
};

const SENSITIVITY_RANK: Readonly<Record<string, number>> = {
  public: 0,
  internal: 1,
  private: 2,
  restricted: 3,
};

type EventRow = QueryResultRow & {
  readonly event_id: string;
  readonly answer_run_id: string;
  readonly attempt_id: string | null;
  readonly project_id: string;
  readonly ordinal: number;
  readonly kind: AskAnswerRunEventKind;
  readonly state: AskAnswerRunState;
  readonly partial_text: string | null;
  readonly answer_revision: string;
  readonly created_at: Date;
};

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const RUN_COLUMNS = `r.answer_run_id, r.project_id, r.state, r.attention_reason,
       r.failure_code, r.failure_message, r.failure_retryable, r.failure_outcome_unknown,
       r.attempt_number, r.created_at, r.updated_at,
       r.access_revision, r.policy_context_revision, r.sensitivity_clearance,
       a.attempt_id`;

const RUN_JOIN = `FROM frontend_ask.answer_runs r
LEFT JOIN frontend_ask.answer_run_attempts a
  ON a.answer_run_id = r.answer_run_id AND a.attempt_number = r.attempt_number`;

/**
 * Own-Domain access revalidation with the server-derived binding: the caller's
 * sensitivity clearance must dominate the run's sensitivity, and the run's
 * stored access/policy revisions must match the current binding. Any mismatch
 * is a denial (returned as NOT_FOUND by the adapter) — never a leak.
 */
const isAskRunAccessible = (input: {
  readonly sensitivityClearance?: string;
  readonly accessRevision?: string;
  readonly policyContextRevision?: string;
  row: RunRow;
}): boolean => {
  if (
    input.sensitivityClearance !== undefined &&
    (SENSITIVITY_RANK[input.row.sensitivity_clearance] ?? 3) >
      (SENSITIVITY_RANK[input.sensitivityClearance] ?? -1)
  ) {
    return false;
  }
  if (input.accessRevision !== undefined && input.row.access_revision !== input.accessRevision) {
    return false;
  }
  if (
    input.policyContextRevision !== undefined &&
    input.row.policy_context_revision !== input.policyContextRevision
  ) {
    return false;
  }
  return true;
};

const runFromRow = (row: RunRow): AskActivityAnswerRunRow => ({
  answerRunId: row.answer_run_id,
  projectId: row.project_id,
  state: row.state,
  ...(row.attention_reason === null ? {} : { attentionReason: row.attention_reason }),
  ...(row.attempt_id === null ? {} : { attemptId: row.attempt_id }),
  attemptNumber: row.attempt_number > 0 ? row.attempt_number : undefined,
  ...(row.failure_code === null
    ? {}
    : {
        failure: {
          code: row.failure_code,
          message: row.failure_message ?? 'Unknown failure',
          retryable: row.failure_retryable ?? false,
          outcomeUnknown: row.failure_outcome_unknown ?? false,
        },
      }),
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

export class PostgresAskActivityRead implements AskActivityReadPort {
  constructor(private readonly pool: Pool) {}

  async listAnswerRuns(input: {
    readonly projectId: string;
    readonly cursor?: string;
    readonly limit: number;
  }): Promise<{
    readonly runs: readonly AskActivityAnswerRunRow[];
    readonly nextCursor?: string;
  }> {
    const params: unknown[] = [input.projectId];
    const conditions = ['r.project_id = $1'];
    if (input.cursor !== undefined) {
      const cursor = decodeAskActivityCursor(input.cursor);
      params.push(cursor.updatedAt, cursor.answerRunId);
      const updatedParam = params.length - 1;
      const idParam = params.length;
      conditions.push(
        `(r.updated_at < $${updatedParam}
          OR (r.updated_at = $${updatedParam} AND r.answer_run_id > $${idParam}))`,
      );
    }
    params.push(input.limit);
    const result = await this.pool.query<RunRow>(
      `SELECT ${RUN_COLUMNS}
       ${RUN_JOIN}
       WHERE ${conditions.join(' AND ')}
       ORDER BY r.updated_at DESC, r.answer_run_id ASC
       LIMIT $${params.length}`,
      params,
    );
    const runs = result.rows.map(runFromRow);
    const last = runs[runs.length - 1];
    return {
      runs,
      ...(runs.length >= input.limit && last !== undefined
        ? {
            nextCursor: encodeAskActivityCursor({
              updatedAt: last.updatedAt,
              answerRunId: last.answerRunId,
            }),
          }
        : {}),
    };
  }

  async getAnswerRun(input: {
    readonly projectId: string;
    readonly answerRunId: string;
    readonly sensitivityClearance?: string;
    readonly accessRevision?: string;
    readonly policyContextRevision?: string;
  }): Promise<AskActivityAnswerRunRow | undefined> {
    const result = await this.pool.query<RunRow>(
      `SELECT ${RUN_COLUMNS}
       ${RUN_JOIN}
       WHERE r.project_id = $1 AND r.answer_run_id = $2`,
      [input.projectId, input.answerRunId],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    if (
      !isAskRunAccessible({
        sensitivityClearance: input.sensitivityClearance,
        accessRevision: input.accessRevision,
        policyContextRevision: input.policyContextRevision,
        row,
      })
    ) {
      return undefined;
    }
    return runFromRow(row);
  }

  async listAnswerRunEvents(input: {
    readonly projectId: string;
    readonly answerRunId: string;
    readonly afterOrdinal?: number;
    readonly limit: number;
  }): Promise<readonly AskAnswerRunEventView[]> {
    const params: unknown[] = [input.projectId, input.answerRunId];
    let ordinalClause = '';
    if (input.afterOrdinal !== undefined) {
      params.push(input.afterOrdinal);
      ordinalClause = ` AND ordinal > $${params.length}`;
    }
    params.push(input.limit);
    const result = await this.pool.query<EventRow>(
      `SELECT event_id, answer_run_id, attempt_id, project_id, ordinal, kind, state,
              partial_text, answer_revision, created_at
       FROM frontend_ask.answer_run_events
       WHERE project_id = $1 AND answer_run_id = $2${ordinalClause}
       ORDER BY ordinal ASC
       LIMIT $${params.length}`,
      params,
    );
    return result.rows.map<AskAnswerRunEventView>((row) => ({
      schemaVersion: ASK_SCHEMA_VERSION,
      eventId: row.event_id,
      answerRunId: row.answer_run_id,
      ...(row.attempt_id === null ? {} : { attemptId: row.attempt_id }),
      projectId: row.project_id,
      ordinal: row.ordinal,
      kind: row.kind,
      state: row.state,
      ...(row.partial_text === null ? {} : { partialText: row.partial_text }),
      answerRevision: row.answer_revision,
      createdAt: iso(row.created_at),
    }));
  }
}
