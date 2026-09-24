import type { Pool } from 'pg';

import {
  KnowledgeResetExecutionError,
  type KnowledgeResetOwnerContext,
  type KnowledgeResetOwnerPort,
} from '../../../modules/source-knowledge-reset/src/index.js';

const SNAPSHOT_KEYS = [
  'sourceCommands',
  'askCommands',
  'activeCommands',
  'unclassifiedCommands',
  'derivedRecords',
  'fingerprint',
] as const;
type Snapshot = Readonly<{
  sourceCommands: number;
  askCommands: number;
  activeCommands: number;
  unclassifiedCommands: number;
  derivedRecords: number;
  fingerprint: string;
}>;

const readSnapshot = async (pool: Pool, context: KnowledgeResetOwnerContext): Promise<Snapshot> => {
  try {
    const result = await pool.query<{ snapshot: unknown }>(
      'SELECT frontend_command.t3_snapshot_project_source_commands($1, $2::uuid) AS snapshot',
      [context.projectId, context.requestId],
    );
    let value = result.rows[0]?.snapshot;
    if (typeof value === 'string') value = JSON.parse(value) as unknown;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('Frontend command snapshot routine returned a malformed object.');
    }
    const snapshot = value as Record<string, unknown>;
    if (
      Object.keys(snapshot).length !== SNAPSHOT_KEYS.length ||
      SNAPSHOT_KEYS.some((key) =>
        key === 'fingerprint'
          ? typeof snapshot[key] !== 'string'
          : typeof snapshot[key] !== 'number' ||
            !Number.isSafeInteger(snapshot[key]) ||
            (snapshot[key] as number) < 0,
      )
    ) {
      throw new Error('Frontend command snapshot routine returned malformed counts.');
    }
    return snapshot as Snapshot;
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'constraint' in error &&
      error.constraint === 't3_erasure_executor_required'
    ) {
      throw new KnowledgeResetExecutionError(
        'ERASURE_EXECUTOR_UNAVAILABLE',
        'Frontend command snapshot requires the dedicated erasure executor.',
      );
    }
    throw error;
  }
};

const readVerification = async (
  pool: Pool,
  context: KnowledgeResetOwnerContext,
): Promise<{ targetedCommands: number; unsanitizedCommands: number; activeCommands: number }> => {
  const result = await pool.query<{ status: unknown }>(
    'SELECT frontend_command.t3_verify_project_source_commands($1, $2::uuid) AS status',
    [context.projectId, context.requestId],
  );
  let value = result.rows[0]?.status;
  if (typeof value === 'string') value = JSON.parse(value) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Frontend command verification routine returned a malformed object.');
  }
  const status = value as Record<string, unknown>;
  const keys = ['targetedCommands', 'unsanitizedCommands', 'activeCommands'] as const;
  if (
    Object.keys(status).length !== keys.length ||
    keys.some(
      (key) =>
        typeof status[key] !== 'number' ||
        !Number.isSafeInteger(status[key]) ||
        (status[key] as number) < 0,
    )
  ) {
    throw new Error('Frontend command verification routine returned malformed counts.');
  }
  return status as {
    targetedCommands: number;
    unsanitizedCommands: number;
    activeCommands: number;
  };
};

/** Scrubs exact Source and Source-linked Ask command payloads while retaining opaque request identity and outcome. */
export class PostgresFrontendCommandKnowledgeResetOwner implements KnowledgeResetOwnerPort {
  readonly ownerId = 'frontend-command' as const;

  constructor(private readonly pool: Pool) {}

  async fence(context: KnowledgeResetOwnerContext): Promise<void> {
    const snapshot = await readSnapshot(this.pool, context);
    if (snapshot.activeCommands > 0) {
      throw new KnowledgeResetExecutionError(
        'ACTIVE_JOB_OUTCOME_UNKNOWN',
        'Source command outcomes must reach a terminal state before reset.',
      );
    }
    if (snapshot.unclassifiedCommands > 0) {
      throw new KnowledgeResetExecutionError(
        'UNCLASSIFIED_CONTENT',
        'Command-ledger records do not have a supported Source lineage disposition.',
      );
    }
  }

  async purge(context: KnowledgeResetOwnerContext): Promise<void> {
    try {
      await this.pool.query(
        'SELECT frontend_command.t3_erase_project_source_commands($1, $2::uuid)',
        [context.projectId, context.requestId],
      );
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'constraint' in error &&
        error.constraint === 't3_command_active_outcome'
      ) {
        throw new KnowledgeResetExecutionError(
          'ACTIVE_JOB_OUTCOME_UNKNOWN',
          'Source command outcomes must reach a terminal state before reset.',
        );
      }
      if (
        typeof error === 'object' &&
        error !== null &&
        'constraint' in error &&
        error.constraint === 't3_command_unclassified'
      ) {
        throw new KnowledgeResetExecutionError(
          'UNCLASSIFIED_CONTENT',
          'Command-ledger records do not have a supported Source lineage disposition.',
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
          'Frontend command purge requires the dedicated erasure executor.',
        );
      }
      throw error;
    }
  }

  async rebuild(): Promise<void> {
    // Command identity and terminal outcome are immutable history; content is not rebuilt.
  }

  async verify(context: KnowledgeResetOwnerContext) {
    const status = await readVerification(this.pool, context);
    const verified = status.unsanitizedCommands === 0 && status.activeCommands === 0;
    return {
      verified,
      blockerCodes: verified ? [] : (['UNCLASSIFIED_CONTENT'] as const),
    };
  }
}
