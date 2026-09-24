import type { Pool } from 'pg';

import {
  KnowledgeResetExecutionError,
  type KnowledgeResetOwnerContext,
  type KnowledgeResetOwnerPort,
} from '../../../modules/source-knowledge-reset/src/index.js';

const evidenceStatus = async (
  pool: Pool,
  context: KnowledgeResetOwnerContext,
): Promise<Readonly<Record<string, number>>> => {
  try {
    const result = await pool.query<{ status: unknown }>(
      'SELECT evidence.t3_project_evidence_status($1, $2::uuid) AS status',
      [context.projectId, context.requestId],
    );
    let status = result.rows[0]?.status;
    if (typeof status === 'string') status = JSON.parse(status) as unknown;
    if (typeof status !== 'object' || status === null || Array.isArray(status)) {
      throw new Error('Evidence status routine returned a malformed object.');
    }
    const entries = Object.entries(status as Record<string, unknown>);
    if (
      entries.length !== 4 ||
      entries.some(
        ([, count]) => typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0,
      )
    ) {
      throw new Error('Evidence status routine returned malformed counts.');
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
        'Evidence status requires the dedicated erasure executor.',
      );
    }
    throw error;
  }
};

const rowCount = (status: Readonly<Record<string, number>>): number =>
  Object.entries(status)
    .filter(([key]) => key !== 'activeContinuations')
    .reduce((sum, [, value]) => sum + value, 0);

/** Evidence owns Source spans, indexing results, and Stage 4 continuations. */
export class PostgresEvidenceKnowledgeResetOwner implements KnowledgeResetOwnerPort {
  readonly ownerId = 'evidence' as const;

  constructor(private readonly pool: Pool) {}

  async fence(context: KnowledgeResetOwnerContext): Promise<void> {
    const status = await evidenceStatus(this.pool, context);
    if ((status.activeContinuations ?? 0) > 0) {
      throw new KnowledgeResetExecutionError(
        'ACTIVE_JOB_OUTCOME_UNKNOWN',
        'Evidence contains work without a terminal outcome.',
      );
    }
  }

  async purge(context: KnowledgeResetOwnerContext): Promise<void> {
    try {
      await this.pool.query('SELECT evidence.t3_erase_project_evidence($1, $2::uuid)', [
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
          'Evidence contains work without a terminal outcome.',
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
          'Evidence purge requires the dedicated erasure executor.',
        );
      }
      throw error;
    }
  }

  async rebuild(): Promise<void> {
    // Evidence is authoritative Source lineage and is not rebuilt after reset.
  }

  async verify(context: KnowledgeResetOwnerContext) {
    const status = await evidenceStatus(this.pool, context);
    const empty = rowCount(status) === 0 && (status.activeContinuations ?? 0) === 0;
    return {
      verified: empty,
      blockerCodes: empty ? [] : (['UNCLASSIFIED_CONTENT'] as const),
    };
  }
}
