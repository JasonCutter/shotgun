import type { Pool } from 'pg';

import {
  KnowledgeResetExecutionError,
  type KnowledgeResetOwnerContext,
  type KnowledgeResetOwnerPort,
} from '../../../modules/source-knowledge-reset/src/index.js';

const KEYS = [
  'providerCalls',
  'providerAttempts',
  'providerOutputs',
  'activeWork',
  'unresolvedRecords',
  'derivedRecords',
] as const;
type Status = Readonly<Record<(typeof KEYS)[number], number>>;

const readStatus = async (pool: Pool, context: KnowledgeResetOwnerContext): Promise<Status> => {
  try {
    const result = await pool.query<{ status: unknown }>(
      'SELECT ai.t3_project_provider_status($1, $2::uuid) AS status',
      [context.projectId, context.requestId],
    );
    let status = result.rows[0]?.status;
    if (typeof status === 'string') status = JSON.parse(status) as unknown;
    if (typeof status !== 'object' || status === null || Array.isArray(status)) {
      throw new Error('AI provider status routine returned a malformed object.');
    }
    const value = status as Record<string, unknown>;
    if (
      Object.keys(value).length !== KEYS.length ||
      KEYS.some(
        (key) =>
          typeof value[key] !== 'number' ||
          !Number.isSafeInteger(value[key]) ||
          (value[key] as number) < 0,
      )
    ) {
      throw new Error('AI provider status routine returned malformed counts.');
    }
    return value as Status;
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'constraint' in error &&
      error.constraint === 't3_erasure_executor_required'
    ) {
      throw new KnowledgeResetExecutionError(
        'ERASURE_EXECUTOR_UNAVAILABLE',
        'AI provider status requires the dedicated erasure executor.',
      );
    }
    throw error;
  }
};

/** AI Provider owns Source-pinned candidate calls and immutable provider outputs. */
export class PostgresAiOutputKnowledgeResetOwner implements KnowledgeResetOwnerPort {
  readonly ownerId = 'ai-output' as const;

  constructor(private readonly pool: Pool) {}

  async fence(context: KnowledgeResetOwnerContext): Promise<void> {
    const status = await readStatus(this.pool, context);
    if (status.activeWork > 0) {
      throw new KnowledgeResetExecutionError(
        'ACTIVE_JOB_OUTCOME_UNKNOWN',
        'AI provider work has not reached a terminal outcome.',
      );
    }
    if (status.unresolvedRecords > 0) {
      throw new KnowledgeResetExecutionError(
        'UNCLASSIFIED_CONTENT',
        'AI provider records do not have exact Project Source lineage.',
      );
    }
  }

  async purge(context: KnowledgeResetOwnerContext): Promise<void> {
    try {
      await this.pool.query('SELECT ai.t3_erase_project_provider_data($1, $2::uuid)', [
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
          'AI provider work has not reached a terminal outcome.',
        );
      }
      if (
        typeof error === 'object' &&
        error !== null &&
        'constraint' in error &&
        error.constraint === 't3_ai_unclassified_content'
      ) {
        throw new KnowledgeResetExecutionError(
          'UNCLASSIFIED_CONTENT',
          'AI provider records do not have exact Project Source lineage.',
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
          'AI provider purge requires the dedicated erasure executor.',
        );
      }
      throw error;
    }
  }

  async rebuild(): Promise<void> {
    // Source-derived provider calls, attempts, and outputs are not recreated.
  }

  async verify(context: KnowledgeResetOwnerContext) {
    const status = await readStatus(this.pool, context);
    const empty =
      status.derivedRecords === 0 && status.unresolvedRecords === 0 && status.activeWork === 0;
    return { verified: empty, blockerCodes: empty ? [] : (['UNCLASSIFIED_CONTENT'] as const) };
  }
}
