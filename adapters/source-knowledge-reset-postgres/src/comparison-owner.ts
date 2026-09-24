import type { Pool } from 'pg';

import {
  KnowledgeResetExecutionError,
  type KnowledgeResetOwnerContext,
  type KnowledgeResetOwnerPort,
} from '../../../modules/source-knowledge-reset/src/index.js';

const KEYS = [
  'results',
  'resultsV2',
  'analysisRevisionsV2',
  'relationshipsV2',
  'blockedOutcomesV2',
  'activeAnalyses',
] as const;

type Status = Readonly<Record<(typeof KEYS)[number], number>>;

const readStatus = async (pool: Pool, context: KnowledgeResetOwnerContext): Promise<Status> => {
  try {
    const result = await pool.query<{ status: unknown }>(
      'SELECT comparison.t3_project_comparison_status($1, $2::uuid) AS status',
      [context.projectId, context.requestId],
    );
    let status = result.rows[0]?.status;
    if (typeof status === 'string') status = JSON.parse(status) as unknown;
    if (typeof status !== 'object' || status === null || Array.isArray(status)) {
      throw new Error('Comparison status routine returned a malformed object.');
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
      throw new Error('Comparison status routine returned malformed counts.');
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
        'Comparison status requires the dedicated erasure executor.',
      );
    }
    throw error;
  }
};

const recordCount = (status: Status): number =>
  KEYS.filter((key) => key !== 'activeAnalyses').reduce((sum, key) => sum + status[key], 0);

/** Comparison owns Source-derived duplicate and semantic relationship outcomes. */
export class PostgresComparisonKnowledgeResetOwner implements KnowledgeResetOwnerPort {
  readonly ownerId = 'comparison' as const;

  constructor(private readonly pool: Pool) {}

  async fence(context: KnowledgeResetOwnerContext): Promise<void> {
    if ((await readStatus(this.pool, context)).activeAnalyses > 0) {
      throw new KnowledgeResetExecutionError(
        'ACTIVE_JOB_OUTCOME_UNKNOWN',
        'Comparison analysis has not reached a terminal outcome.',
      );
    }
  }

  async purge(context: KnowledgeResetOwnerContext): Promise<void> {
    try {
      await this.pool.query('SELECT comparison.t3_erase_project_comparison($1, $2::uuid)', [
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
          'Comparison analysis has not reached a terminal outcome.',
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
          'Comparison purge requires the dedicated erasure executor.',
        );
      }
      throw error;
    }
  }

  async rebuild(): Promise<void> {
    // Source-derived comparison results are not recreated after reset.
  }

  async verify(context: KnowledgeResetOwnerContext) {
    const empty = recordCount(await readStatus(this.pool, context)) === 0;
    return { verified: empty, blockerCodes: empty ? [] : (['UNCLASSIFIED_CONTENT'] as const) };
  }
}
