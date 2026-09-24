import type { Pool } from 'pg';

import {
  KnowledgeResetExecutionError,
  type KnowledgeResetOwnerContext,
  type KnowledgeResetOwnerPort,
} from '../../../modules/source-knowledge-reset/src/index.js';

const transformationStatus = async (
  pool: Pool,
  context: KnowledgeResetOwnerContext,
): Promise<Readonly<Record<string, number>>> => {
  try {
    const result = await pool.query<{ status: unknown }>(
      'SELECT transformation.t3_project_transformation_status($1, $2::uuid) AS status',
      [context.projectId, context.requestId],
    );
    let status = result.rows[0]?.status;
    if (typeof status === 'string') status = JSON.parse(status) as unknown;
    if (typeof status !== 'object' || status === null || Array.isArray(status)) {
      throw new Error('Transformation status routine returned a malformed object.');
    }
    const entries = Object.entries(status as Record<string, unknown>);
    if (
      entries.length !== 2 ||
      entries.some(
        ([, count]) => typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0,
      )
    ) {
      throw new Error('Transformation status routine returned malformed counts.');
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
        'Transformation status requires the dedicated erasure executor.',
      );
    }
    throw error;
  }
};

const transformationRowCount = (status: Readonly<Record<string, number>>): number =>
  Object.values(status).reduce((total, count) => total + count, 0);

/** Transformation owns Source-versioned document IR and source-map records. */
export class PostgresTransformationKnowledgeResetOwner implements KnowledgeResetOwnerPort {
  readonly ownerId = 'transformation' as const;

  constructor(private readonly pool: Pool) {}

  async fence(context: KnowledgeResetOwnerContext): Promise<void> {
    await transformationStatus(this.pool, context);
  }

  async purge(context: KnowledgeResetOwnerContext): Promise<void> {
    try {
      await this.pool.query('SELECT transformation.t3_erase_project_transformation($1, $2::uuid)', [
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
          'Transformation purge requires the dedicated erasure executor.',
        );
      }
      throw error;
    }
  }

  async rebuild(): Promise<void> {
    // Transformation documents are Source-derived and are not recreated.
  }

  async verify(context: KnowledgeResetOwnerContext) {
    const empty = transformationRowCount(await transformationStatus(this.pool, context)) === 0;
    return {
      verified: empty,
      blockerCodes: empty ? [] : (['UNCLASSIFIED_CONTENT'] as const),
    };
  }
}
