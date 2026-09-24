import type { Pool } from 'pg';

import {
  KnowledgeResetExecutionError,
  type KnowledgeResetOwnerContext,
  type KnowledgeResetOwnerPort,
} from '../../../modules/source-knowledge-reset/src/index.js';

const readStatus = async (pool: Pool, context: KnowledgeResetOwnerContext) => {
  try {
    const result = await pool.query<{ status: unknown }>(
      'SELECT project_audit.t3_project_reset_guard_status($1, $2::uuid) AS status',
      [context.projectId, context.requestId],
    );
    let status = result.rows[0]?.status;
    if (typeof status === 'string') status = JSON.parse(status) as unknown;
    if (typeof status !== 'object' || status === null || Array.isArray(status)) {
      throw new Error('Project audit status routine returned a malformed object.');
    }
    const value = status as Record<string, unknown>;
    const keys = ['projectTombstones', 'deletedProjectAuditScopes'] as const;
    if (
      Object.keys(value).length !== keys.length ||
      keys.some(
        (key) =>
          typeof value[key] !== 'number' ||
          !Number.isSafeInteger(value[key]) ||
          (value[key] as number) < 0,
      )
    ) {
      throw new Error('Project audit status routine returned malformed counts.');
    }
    return value as Readonly<Record<(typeof keys)[number], number>>;
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'constraint' in error &&
      error.constraint === 't3_erasure_executor_required'
    ) {
      throw new KnowledgeResetExecutionError(
        'ERASURE_EXECUTOR_UNAVAILABLE',
        'Project audit status requires the dedicated erasure executor.',
      );
    }
    throw error;
  }
};

/** Deleted-Project tombstones have separate retention authority and block a Project reset. */
export class PostgresProjectAuditKnowledgeResetOwner implements KnowledgeResetOwnerPort {
  readonly ownerId = 'project-audit' as const;

  constructor(private readonly pool: Pool) {}

  async fence(context: KnowledgeResetOwnerContext): Promise<void> {
    const status = await readStatus(this.pool, context);
    if (Object.values(status).some((count) => count > 0)) {
      throw new KnowledgeResetExecutionError(
        'UNCLASSIFIED_CONTENT',
        'Project audit rows require their own retention disposition.',
      );
    }
  }

  async purge(context: KnowledgeResetOwnerContext): Promise<void> {
    try {
      await this.pool.query(
        'SELECT project_audit.t3_assert_project_reset_audit_empty($1, $2::uuid)',
        [context.projectId, context.requestId],
      );
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'constraint' in error &&
        error.constraint === 't3_project_audit_unclassified'
      ) {
        throw new KnowledgeResetExecutionError(
          'UNCLASSIFIED_CONTENT',
          'Project audit rows require their own retention disposition.',
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
          'Project audit guard requires the dedicated erasure executor.',
        );
      }
      throw error;
    }
  }

  async rebuild(): Promise<void> {
    // Project deletion audit is outside Source knowledge and is never rebuilt here.
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
