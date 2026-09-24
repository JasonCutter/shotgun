import type { Pool } from 'pg';

import {
  KnowledgeResetExecutionError,
  type KnowledgeResetOwnerContext,
  type KnowledgeResetOwnerPort,
} from '../../../modules/source-knowledge-reset/src/index.js';

const KEYS = ['batches', 'candidates', 'materializations', 'activeCandidates'] as const;
type Status = Readonly<Record<(typeof KEYS)[number], number>>;

const readStatus = async (pool: Pool, context: KnowledgeResetOwnerContext): Promise<Status> => {
  try {
    const result = await pool.query<{ status: unknown }>(
      'SELECT candidate.t3_project_candidate_status($1, $2::uuid) AS status',
      [context.projectId, context.requestId],
    );
    let status = result.rows[0]?.status;
    if (typeof status === 'string') status = JSON.parse(status) as unknown;
    if (typeof status !== 'object' || status === null || Array.isArray(status)) {
      throw new Error('Candidate status routine returned a malformed object.');
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
      throw new Error('Candidate status routine returned malformed counts.');
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
        'Candidate status requires the dedicated erasure executor.',
      );
    }
    throw error;
  }
};

const recordCount = (status: Status): number =>
  status.batches + status.candidates + status.materializations;

/** Candidate owns Source-derived batches, claims and provider materializations. */
export class PostgresCandidateKnowledgeResetOwner implements KnowledgeResetOwnerPort {
  readonly ownerId = 'candidate' as const;

  constructor(private readonly pool: Pool) {}

  async fence(context: KnowledgeResetOwnerContext): Promise<void> {
    if ((await readStatus(this.pool, context)).activeCandidates > 0) {
      throw new KnowledgeResetExecutionError(
        'ACTIVE_JOB_OUTCOME_UNKNOWN',
        'Candidate validation has not reached a terminal outcome.',
      );
    }
  }

  async purge(context: KnowledgeResetOwnerContext): Promise<void> {
    try {
      await this.pool.query('SELECT candidate.t3_erase_project_candidate($1, $2::uuid)', [
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
          'Candidate validation has not reached a terminal outcome.',
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
          'Candidate purge requires the dedicated erasure executor.',
        );
      }
      throw error;
    }
  }

  async rebuild(): Promise<void> {
    // Source-derived claims and provider materializations are not recreated.
  }

  async verify(context: KnowledgeResetOwnerContext) {
    const status = await readStatus(this.pool, context);
    const empty = recordCount(status) === 0 && status.activeCandidates === 0;
    return { verified: empty, blockerCodes: empty ? [] : (['UNCLASSIFIED_CONTENT'] as const) };
  }
}
