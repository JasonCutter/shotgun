import type { Pool } from 'pg';

import {
  KnowledgeResetExecutionError,
  type KnowledgeResetOwnerContext,
  type KnowledgeResetOwnerPort,
} from '../../../modules/source-knowledge-reset/src/index.js';

const STATUS_KEYS = [
  'sourceDerivedRecordCount',
  'unclassifiedRecordCount',
  'fingerprint',
  'remainingRecordCount',
  'purgeCompleted',
] as const;

type Status = Readonly<{
  sourceDerivedRecordCount: number;
  unclassifiedRecordCount: number;
  fingerprint: string;
  remainingRecordCount: number;
  purgeCompleted: boolean;
}>;

const readStatus = async (pool: Pool, context: KnowledgeResetOwnerContext): Promise<Status> => {
  const result = await pool.query<{ status: unknown }>(
    'SELECT knowledge.t3_project_knowledge_status($1, $2::uuid) AS status',
    [context.projectId, context.requestId],
  );
  let value = result.rows[0]?.status;
  if (typeof value === 'string') value = JSON.parse(value) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Knowledge Model status routine returned a malformed object.');
  }
  const status = value as Record<string, unknown>;
  const countKeys = [
    'sourceDerivedRecordCount',
    'unclassifiedRecordCount',
    'remainingRecordCount',
  ] as const;
  if (
    Object.keys(status).length !== STATUS_KEYS.length ||
    countKeys.some(
      (key) =>
        typeof status[key] !== 'number' ||
        !Number.isSafeInteger(status[key]) ||
        (status[key] as number) < 0,
    ) ||
    typeof status.fingerprint !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(status.fingerprint) ||
    typeof status.purgeCompleted !== 'boolean'
  ) {
    throw new Error('Knowledge Model status routine returned malformed counts or fingerprint.');
  }
  return status as Status;
};

const mapDatabaseError = (error: unknown): KnowledgeResetExecutionError | undefined => {
  if (typeof error !== 'object' || error === null || !('constraint' in error)) return undefined;
  if (error.constraint === 't3_erasure_executor_required') {
    return new KnowledgeResetExecutionError(
      'ERASURE_EXECUTOR_UNAVAILABLE',
      'Knowledge Model reset requires the dedicated erasure executor.',
    );
  }
  if (error.constraint === 't3_knowledge_snapshot_stale') {
    return new KnowledgeResetExecutionError(
      'STALE_PREVIEW',
      'Knowledge Model content changed after the approved reset preview.',
    );
  }
  if (error.constraint === 't3_knowledge_unclassified') {
    return new KnowledgeResetExecutionError(
      'UNCLASSIFIED_CONTENT',
      'Knowledge Model SourceVersion lineage is incomplete.',
    );
  }
  if (error.constraint === 't3_knowledge_snapshot_missing') {
    return new KnowledgeResetExecutionError(
      'UNCLASSIFIED_CONTENT',
      'Knowledge Model reset approval or fence snapshot is missing.',
      'ERASURE_UNVERIFIED',
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

/** Removes SourceVersion-bound Knowledge Model import and review records. */
export class PostgresKnowledgeModelResetOwner implements KnowledgeResetOwnerPort {
  readonly ownerId = 'knowledge' as const;

  constructor(private readonly pool: Pool) {}

  async fence(context: KnowledgeResetOwnerContext): Promise<void> {
    await execute(() =>
      this.pool.query('SELECT knowledge.t3_snapshot_project_knowledge($1, $2::uuid)', [
        context.projectId,
        context.requestId,
      ]),
    );
  }

  async purge(context: KnowledgeResetOwnerContext): Promise<void> {
    await execute(() =>
      this.pool.query('SELECT knowledge.t3_erase_project_knowledge($1, $2::uuid)', [
        context.projectId,
        context.requestId,
      ]),
    );
  }

  async rebuild(): Promise<void> {
    // The Knowledge Model has no separate project projection to rebuild.
  }

  async verify(context: KnowledgeResetOwnerContext) {
    const status = await execute(() => readStatus(this.pool, context));
    const verified =
      status.purgeCompleted &&
      status.sourceDerivedRecordCount === 0 &&
      status.unclassifiedRecordCount === 0 &&
      status.remainingRecordCount === 0;
    return {
      verified,
      blockerCodes: verified ? [] : (['UNCLASSIFIED_CONTENT'] as const),
    };
  }
}
