import type { Pool } from 'pg';

import {
  KnowledgeResetExecutionError,
  type KnowledgeResetOwnerContext,
  type KnowledgeResetOwnerPort,
} from '../../../modules/source-knowledge-reset/src/index.js';

const STATUS_KEYS = [
  'sourceDerivedRecordCount',
  'preservedRecordCount',
  'redactedIdentityCount',
  'unclassifiedRecordCount',
  'fingerprint',
] as const;

type Status = Readonly<{
  sourceDerivedRecordCount: number;
  preservedRecordCount: number;
  redactedIdentityCount: number;
  unclassifiedRecordCount: number;
  fingerprint: string;
}>;

const readStatus = async (pool: Pool, context: KnowledgeResetOwnerContext): Promise<Status> => {
  const result = await pool.query<{ status: unknown }>(
    'SELECT review.t3_project_review_status($1, $2::uuid) AS status',
    [context.projectId, context.requestId],
  );
  let value = result.rows[0]?.status;
  if (typeof value === 'string') value = JSON.parse(value) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Review status routine returned a malformed object.');
  }
  const status = value as Record<string, unknown>;
  if (
    Object.keys(status).length !== STATUS_KEYS.length ||
    STATUS_KEYS.some((key) =>
      key === 'fingerprint'
        ? typeof status[key] !== 'string' || !/^[0-9a-f]{64}$/u.test(status[key] as string)
        : typeof status[key] !== 'number' ||
          !Number.isSafeInteger(status[key]) ||
          (status[key] as number) < 0,
    )
  ) {
    throw new Error('Review status routine returned malformed counts.');
  }
  return status as Status;
};

const mapDatabaseError = (error: unknown): KnowledgeResetExecutionError | undefined => {
  if (typeof error !== 'object' || error === null || !('constraint' in error)) return undefined;
  const constraint = error.constraint;
  if (constraint === 't3_review_unclassified') {
    return new KnowledgeResetExecutionError(
      'UNCLASSIFIED_CONTENT',
      'Review lineage is incomplete or ambiguous.',
    );
  }
  if (constraint === 't3_review_snapshot_missing') {
    return new KnowledgeResetExecutionError(
      'UNCLASSIFIED_CONTENT',
      'Review reset request is missing.',
      'ERASURE_UNVERIFIED',
    );
  }
  if (constraint === 't3_erasure_executor_required') {
    return new KnowledgeResetExecutionError(
      'ERASURE_EXECUTOR_UNAVAILABLE',
      'Review reset requires the dedicated erasure executor.',
    );
  }
  return undefined;
};

const execute = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work();
  } catch (error) {
    throw mapDatabaseError(error) ?? error;
  }
};

/** Removes Source-linked Review content while retaining opaque decision identities. */
export class PostgresReviewKnowledgeResetOwner implements KnowledgeResetOwnerPort {
  readonly ownerId = 'review' as const;

  constructor(private readonly pool: Pool) {}

  async fence(context: KnowledgeResetOwnerContext): Promise<void> {
    const status = await execute(() => readStatus(this.pool, context));
    if (status.unclassifiedRecordCount > 0) {
      throw new KnowledgeResetExecutionError(
        'UNCLASSIFIED_CONTENT',
        'Review lineage is incomplete or ambiguous.',
      );
    }
  }

  async purge(context: KnowledgeResetOwnerContext): Promise<void> {
    await execute(() =>
      this.pool.query('SELECT review.t3_erase_project_review($1, $2::uuid)', [
        context.projectId,
        context.requestId,
      ]),
    );
  }

  async rebuild(): Promise<void> {
    // Independent Review content is retained; erased Source-linked Review is not recreated.
  }

  async verify(context: KnowledgeResetOwnerContext) {
    const status = await execute(() => readStatus(this.pool, context));
    const verified = status.sourceDerivedRecordCount === 0 && status.unclassifiedRecordCount === 0;
    return {
      verified,
      blockerCodes: verified ? [] : (['UNCLASSIFIED_CONTENT'] as const),
    };
  }
}
