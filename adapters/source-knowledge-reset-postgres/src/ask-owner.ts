import type { Pool } from 'pg';

import {
  KnowledgeResetExecutionError,
  type KnowledgeResetOwnerContext,
  type KnowledgeResetOwnerPort,
} from '../../../modules/source-knowledge-reset/src/index.js';

const askStatus = async (
  pool: Pool,
  context: KnowledgeResetOwnerContext,
): Promise<Readonly<Record<string, number>>> => {
  try {
    const result = await pool.query<{ status: unknown }>(
      'SELECT frontend_ask.t3_project_ask_status($1, $2::uuid) AS status',
      [context.projectId, context.requestId],
    );
    let status = result.rows[0]?.status;
    if (typeof status === 'string') status = JSON.parse(status) as unknown;
    if (typeof status !== 'object' || status === null || Array.isArray(status)) {
      throw new Error('Ask status routine returned a malformed object.');
    }
    const entries = Object.entries(status as Record<string, unknown>);
    const expectedKeys = [
      'affectedConversations',
      'answerRuns',
      'activeAnswerRuns',
      'activeAttempts',
      'unresolvedEvidence',
      'derivedRecords',
    ];
    if (
      entries.length !== expectedKeys.length ||
      expectedKeys.some((key) => !(key in (status as Record<string, unknown>))) ||
      entries.some(
        ([, count]) => typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0,
      )
    ) {
      throw new Error('Ask status routine returned malformed counts.');
    }
    return Object.fromEntries(entries) as Record<string, number>;
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'constraint' in error &&
      error.constraint === 't3_erasure_executor_required'
    ) {
      throw new KnowledgeResetExecutionError(
        'ERASURE_EXECUTOR_UNAVAILABLE',
        'Ask status requires the dedicated erasure executor.',
      );
    }
    throw error;
  }
};

/** Ask owns whole-conversation closure for Source selection and citation lineage. */
export class PostgresAskKnowledgeResetOwner implements KnowledgeResetOwnerPort {
  readonly ownerId = 'ask' as const;

  constructor(private readonly pool: Pool) {}

  async fence(context: KnowledgeResetOwnerContext): Promise<void> {
    const status = await askStatus(this.pool, context);
    if ((status.activeAnswerRuns ?? 0) > 0 || (status.activeAttempts ?? 0) > 0) {
      throw new KnowledgeResetExecutionError(
        'ACTIVE_JOB_OUTCOME_UNKNOWN',
        'A Source-linked Ask conversation has work without a terminal outcome.',
      );
    }
    if ((status.unresolvedEvidence ?? 0) > 0) {
      throw new KnowledgeResetExecutionError(
        'UNCLASSIFIED_CONTENT',
        'Ask contains evidence references that cannot be tied to a Source in this Project.',
      );
    }
  }

  async purge(context: KnowledgeResetOwnerContext): Promise<void> {
    try {
      await this.pool.query('SELECT frontend_ask.t3_erase_project_ask($1, $2::uuid)', [
        context.projectId,
        context.requestId,
      ]);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'constraint' in error &&
        error.constraint === 'active_job_outcome_unknown'
      ) {
        throw new KnowledgeResetExecutionError(
          'ACTIVE_JOB_OUTCOME_UNKNOWN',
          'A Source-linked Ask conversation has work without a terminal outcome.',
        );
      }
      if (
        typeof error === 'object' &&
        error !== null &&
        'constraint' in error &&
        error.constraint === 't3_ask_unclassified_content'
      ) {
        throw new KnowledgeResetExecutionError(
          'UNCLASSIFIED_CONTENT',
          'Ask contains evidence references that cannot be tied to a Source in this Project.',
        );
      }
      if (
        typeof error === 'object' &&
        error !== null &&
        'constraint' in error &&
        error.constraint === 't3_erasure_executor_required'
      ) {
        throw new KnowledgeResetExecutionError(
          'ERASURE_EXECUTOR_UNAVAILABLE',
          'Ask purge requires the dedicated erasure executor.',
        );
      }
      throw error;
    }
  }

  async rebuild(): Promise<void> {
    // Ask answers and their later conversation context are deleted as one unit.
  }

  async verify(context: KnowledgeResetOwnerContext) {
    const status = await askStatus(this.pool, context);
    const empty = (status.affectedConversations ?? -1) === 0 && (status.derivedRecords ?? -1) === 0;
    return {
      verified: empty,
      blockerCodes: empty ? [] : (['UNCLASSIFIED_CONTENT'] as const),
    };
  }
}
