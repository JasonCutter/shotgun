import type { Pool } from 'pg';

import {
  KnowledgeResetExecutionError,
  type KnowledgeResetOwnerContext,
  type KnowledgeResetOwnerPort,
} from '../../../modules/source-knowledge-reset/src/index.js';

const validationCount = async (
  pool: Pool,
  context: KnowledgeResetOwnerContext,
): Promise<number> => {
  try {
    const result = await pool.query<{ status: unknown }>(
      'SELECT validation.t3_project_validation_status($1, $2::uuid) AS status',
      [context.projectId, context.requestId],
    );
    let status = result.rows[0]?.status;
    if (typeof status === 'string') status = JSON.parse(status) as unknown;
    if (typeof status !== 'object' || status === null || Array.isArray(status)) {
      throw new Error('Validation status routine returned malformed counts.');
    }
    const count = (status as Record<string, unknown>).results;
    if (
      Object.keys(status).length !== 1 ||
      typeof count !== 'number' ||
      !Number.isSafeInteger(count) ||
      count < 0
    ) {
      throw new Error('Validation status routine returned malformed counts.');
    }
    return count;
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'constraint' in error &&
      error.constraint === 't3_erasure_executor_required'
    ) {
      throw new KnowledgeResetExecutionError(
        'ERASURE_EXECUTOR_UNAVAILABLE',
        'Validation status requires the dedicated erasure executor.',
      );
    }
    throw error;
  }
};

/** Validation owns Source-derived validation dimensions and outcomes. */
export class PostgresValidationKnowledgeResetOwner implements KnowledgeResetOwnerPort {
  readonly ownerId = 'validation' as const;

  constructor(private readonly pool: Pool) {}

  async fence(context: KnowledgeResetOwnerContext): Promise<void> {
    await validationCount(this.pool, context);
  }

  async purge(context: KnowledgeResetOwnerContext): Promise<void> {
    try {
      await this.pool.query('SELECT validation.t3_erase_project_validation($1, $2::uuid)', [
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
          'Validation purge requires the dedicated erasure executor.',
        );
      }
      throw error;
    }
  }

  async rebuild(): Promise<void> {
    // Source-derived validation results are not recreated after reset.
  }

  async verify(context: KnowledgeResetOwnerContext) {
    const empty = (await validationCount(this.pool, context)) === 0;
    return { verified: empty, blockerCodes: empty ? [] : (['UNCLASSIFIED_CONTENT'] as const) };
  }
}
