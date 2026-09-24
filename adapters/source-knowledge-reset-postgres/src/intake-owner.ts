import type { Pool } from 'pg';

import {
  KnowledgeResetExecutionError,
  type KnowledgeResetOwnerContext,
  type KnowledgeResetOwnerPort,
} from '../../../modules/source-knowledge-reset/src/index.js';

const submissionCount = async (
  pool: Pool,
  context: KnowledgeResetOwnerContext,
): Promise<number> => {
  try {
    const result = await pool.query<{ status: unknown }>(
      'SELECT intake.t3_project_submission_status($1, $2::uuid) AS status',
      [context.projectId, context.requestId],
    );
    let status = result.rows[0]?.status;
    if (typeof status === 'string') status = JSON.parse(status) as unknown;
    if (
      typeof status !== 'object' ||
      status === null ||
      Array.isArray(status) ||
      !('submissions' in status) ||
      typeof status.submissions !== 'number' ||
      !Number.isSafeInteger(status.submissions) ||
      status.submissions < 0
    ) {
      throw new Error('Intake status routine returned a malformed count.');
    }
    return status.submissions;
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'constraint' in error &&
      error.constraint === 't3_erasure_executor_required'
    ) {
      throw new KnowledgeResetExecutionError(
        'ERASURE_EXECUTOR_UNAVAILABLE',
        'Intake status requires the dedicated erasure executor.',
      );
    }
    throw error;
  }
};

/** Intake-owned Project submissions are erased through fixed SQL routines. */
export class PostgresIntakeKnowledgeResetOwner implements KnowledgeResetOwnerPort {
  readonly ownerId = 'intake' as const;

  constructor(private readonly pool: Pool) {}

  async fence(context: KnowledgeResetOwnerContext): Promise<void> {
    await submissionCount(this.pool, context);
  }

  async purge(context: KnowledgeResetOwnerContext): Promise<void> {
    try {
      await this.pool.query('SELECT intake.t3_erase_project_submissions($1, $2::uuid)', [
        context.projectId,
        context.requestId,
      ]);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'constraint' in error &&
        error.constraint === 't3_erasure_executor_required'
      ) {
        throw new KnowledgeResetExecutionError(
          'ERASURE_EXECUTOR_UNAVAILABLE',
          'Intake purge requires the dedicated erasure executor.',
        );
      }
      throw error;
    }
  }

  async rebuild(): Promise<void> {
    // Intake submissions are authoritative intake records, not projections.
  }

  async verify(context: KnowledgeResetOwnerContext) {
    const empty = (await submissionCount(this.pool, context)) === 0;
    return {
      verified: empty,
      blockerCodes: empty ? [] : (['UNCLASSIFIED_CONTENT'] as const),
    };
  }
}
