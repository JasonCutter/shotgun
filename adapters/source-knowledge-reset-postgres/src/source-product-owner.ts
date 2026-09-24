import type { Pool } from 'pg';

import {
  KnowledgeResetExecutionError,
  type KnowledgeResetOwnerContext,
  type KnowledgeResetOwnerPort,
} from '../../../modules/source-knowledge-reset/src/index.js';

const asCountRecord = (value: unknown): Readonly<Record<string, number>> => {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      throw new KnowledgeResetExecutionError(
        'UNCLASSIFIED_CONTENT',
        'Source Product owner readback was malformed.',
        'ERASURE_UNVERIFIED',
      );
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new KnowledgeResetExecutionError(
      'UNCLASSIFIED_CONTENT',
      'Source Product owner readback was unavailable.',
      'ERASURE_UNVERIFIED',
    );
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (
    entries.some(
      ([, count]) => typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0,
    )
  ) {
    throw new KnowledgeResetExecutionError(
      'UNCLASSIFIED_CONTENT',
      'Source Product owner readback contained invalid counts.',
      'ERASURE_UNVERIFIED',
    );
  }
  return Object.fromEntries(entries) as Record<string, number>;
};

const statusSnapshot = async (
  pool: Pool,
  context: KnowledgeResetOwnerContext,
): Promise<Readonly<Record<string, number>>> => {
  try {
    const result = await pool.query<{ status: unknown }>(
      `SELECT source_product.t3_source_product_status($1, $2::uuid) AS status`,
      [context.projectId, context.requestId],
    );
    const status = result.rows[0]?.status;
    if (status === undefined) throw new Error('Source Product status routine returned no row.');
    return asCountRecord(status);
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'constraint' in error &&
      error.constraint === 't3_erasure_executor_required'
    ) {
      throw new KnowledgeResetExecutionError(
        'ERASURE_EXECUTOR_UNAVAILABLE',
        'Source Product status requires the dedicated erasure executor.',
      );
    }
    throw error;
  }
};

const activeWorkCount = (status: Readonly<Record<string, number>>): number =>
  (status.activeSubmissions ?? 0) +
  (status.activeAttempts ?? 0) +
  (status.activeUrlAcquisitions ?? 0);

const contentRowCount = (status: Readonly<Record<string, number>>): number =>
  Object.entries(status)
    .filter(([key]) => !key.startsWith('active'))
    .reduce((count, [, value]) => count + value, 0);

/** Owner-local Source Product erasure through the fixed migration routine. */
export class PostgresSourceProductKnowledgeResetOwner implements KnowledgeResetOwnerPort {
  readonly ownerId = 'source-product' as const;

  constructor(private readonly pool: Pool) {}

  async fence(context: KnowledgeResetOwnerContext): Promise<void> {
    const status = await statusSnapshot(this.pool, context);
    if (activeWorkCount(status) > 0) {
      throw new KnowledgeResetExecutionError(
        'ACTIVE_JOB_OUTCOME_UNKNOWN',
        'Source Product contains work without a terminal outcome.',
      );
    }
  }

  async purge(context: KnowledgeResetOwnerContext): Promise<void> {
    try {
      await this.pool.query(`SELECT source_product.t3_erase_project_source_product($1, $2::uuid)`, [
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
          'Source Product contains work without a terminal outcome.',
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
          'Source Product purge requires the dedicated erasure executor.',
        );
      }
      throw error;
    }
  }

  async rebuild(): Promise<void> {
    // Source Product owns intake lineage only; its activity projections have
    // separate owner ports and are rebuilt after their authoritative owners.
  }

  async verify(context: KnowledgeResetOwnerContext) {
    const status = await statusSnapshot(this.pool, context);
    const empty = contentRowCount(status) === 0 && activeWorkCount(status) === 0;
    return {
      verified: empty,
      blockerCodes: empty ? [] : (['UNCLASSIFIED_CONTENT'] as const),
    };
  }
}
