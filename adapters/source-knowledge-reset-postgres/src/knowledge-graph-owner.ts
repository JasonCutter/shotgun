import type { Pool } from 'pg';

import {
  KnowledgeResetExecutionError,
  type KnowledgeResetOwnerContext,
  type KnowledgeResetOwnerPort,
} from '../../../modules/source-knowledge-reset/src/index.js';

const KEYS = ['snapshotContexts', 'projectionHealth', 'overlayHealth', 'continuations'] as const;
type Status = Readonly<Record<(typeof KEYS)[number], number>>;

const readStatus = async (pool: Pool, context: KnowledgeResetOwnerContext): Promise<Status> => {
  try {
    const result = await pool.query<{ status: unknown }>(
      'SELECT frontend_knowledge_graph.t3_project_graph_status($1, $2::uuid) AS status',
      [context.projectId, context.requestId],
    );
    let status = result.rows[0]?.status;
    if (typeof status === 'string') status = JSON.parse(status) as unknown;
    if (typeof status !== 'object' || status === null || Array.isArray(status)) {
      throw new Error('Knowledge graph status routine returned a malformed object.');
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
      throw new Error('Knowledge graph status routine returned malformed counts.');
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
        'Knowledge graph status requires the dedicated erasure executor.',
      );
    }
    throw error;
  }
};

/** Invalidates source-bearing graph snapshots and session continuations for this Project. */
export class PostgresKnowledgeGraphResetOwner implements KnowledgeResetOwnerPort {
  readonly ownerId = 'knowledge-graph' as const;

  constructor(private readonly pool: Pool) {}

  async fence(context: KnowledgeResetOwnerContext): Promise<void> {
    await readStatus(this.pool, context);
  }

  async purge(context: KnowledgeResetOwnerContext): Promise<void> {
    try {
      await this.pool.query(
        'SELECT frontend_knowledge_graph.t3_erase_project_graph_views($1, $2::uuid)',
        [context.projectId, context.requestId],
      );
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'constraint' in error &&
        error.constraint === 't3_erasure_executor_required'
      ) {
        throw new KnowledgeResetExecutionError(
          'ERASURE_EXECUTOR_UNAVAILABLE',
          'Knowledge graph purge requires the dedicated erasure executor.',
        );
      }
      throw error;
    }
  }

  async rebuild(): Promise<void> {
    // Graph snapshots are request-scoped and are rebuilt lazily from live owners.
  }

  async verify(context: KnowledgeResetOwnerContext) {
    const status = await readStatus(this.pool, context);
    const empty = Object.values(status).every((count) => count === 0);
    return {
      verified: empty,
      blockerCodes: empty ? [] : (['UNCLASSIFIED_CONTENT'] as const),
    };
  }
}
