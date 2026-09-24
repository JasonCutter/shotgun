import type { Pool } from 'pg';

import {
  KnowledgeResetExecutionError,
  type KnowledgeResetOwnerContext,
  type KnowledgeResetOwnerPort,
} from '../../../modules/source-knowledge-reset/src/index.js';

const STATUS_KEYS = [
  'actionCount',
  'linkedActionCount',
  'unclassifiedActionCount',
  'activeActionCount',
  'externalEffectActionCount',
  'derivedRecords',
  'redactedAuditRecords',
  'fingerprint',
] as const;

type Status = Readonly<{
  actionCount: number;
  linkedActionCount: number;
  unclassifiedActionCount: number;
  activeActionCount: number;
  externalEffectActionCount: number;
  derivedRecords: number;
  redactedAuditRecords: number;
  fingerprint: string;
}>;

const readStatus = async (pool: Pool, context: KnowledgeResetOwnerContext): Promise<Status> => {
  const result = await pool.query<{ status: unknown }>(
    'SELECT frontend_external_action.t3_project_action_status($1, $2::uuid) AS status',
    [context.projectId, context.requestId],
  );
  let value = result.rows[0]?.status;
  if (typeof value === 'string') value = JSON.parse(value) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('External Action status routine returned a malformed object.');
  }
  const status = value as Record<string, unknown>;
  if (
    Object.keys(status).length !== STATUS_KEYS.length ||
    STATUS_KEYS.some((key) =>
      key === 'fingerprint'
        ? typeof status[key] !== 'string'
        : typeof status[key] !== 'number' ||
          !Number.isSafeInteger(status[key]) ||
          (status[key] as number) < 0,
    )
  ) {
    throw new Error('External Action status routine returned malformed counts.');
  }
  return status as Status;
};

const mapDatabaseError = (error: unknown): KnowledgeResetExecutionError | undefined => {
  if (typeof error !== 'object' || error === null || !('constraint' in error)) return undefined;
  const constraint = error.constraint;
  if (constraint === 'active_job_outcome_unknown') {
    return new KnowledgeResetExecutionError(
      'ACTIVE_JOB_OUTCOME_UNKNOWN',
      'External Action work must reach a known terminal state before reset.',
    );
  }
  if (constraint === 'external_action_dependency') {
    return new KnowledgeResetExecutionError(
      'EXTERNAL_ACTION_DEPENDENCY',
      'A Source-linked External Action may have produced an external effect.',
    );
  }
  if (constraint === 't3_external_action_unclassified') {
    return new KnowledgeResetExecutionError(
      'UNCLASSIFIED_CONTENT',
      'External Action lineage is incomplete or ambiguous.',
    );
  }
  if (constraint === 't3_erasure_executor_required') {
    return new KnowledgeResetExecutionError(
      'ERASURE_EXECUTOR_UNAVAILABLE',
      'External Action reset requires the dedicated erasure executor.',
    );
  }
  if (constraint === 't3_external_action_snapshot_missing') {
    return new KnowledgeResetExecutionError(
      'UNCLASSIFIED_CONTENT',
      'External Action reset snapshot is missing.',
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

/** Removes only Source-linked, unexecuted External Actions and redacts their audit payloads. */
export class PostgresExternalActionKnowledgeResetOwner implements KnowledgeResetOwnerPort {
  readonly ownerId = 'external-action' as const;

  constructor(private readonly pool: Pool) {}

  async fence(context: KnowledgeResetOwnerContext): Promise<void> {
    await execute(() =>
      this.pool.query('SELECT frontend_external_action.t3_snapshot_project_actions($1, $2::uuid)', [
        context.projectId,
        context.requestId,
      ]),
    );
  }

  async purge(context: KnowledgeResetOwnerContext): Promise<void> {
    await execute(() =>
      this.pool.query('SELECT frontend_external_action.t3_erase_project_actions($1, $2::uuid)', [
        context.projectId,
        context.requestId,
      ]),
    );
  }

  async rebuild(): Promise<void> {
    // External Action content is never rebuilt from a reset Project's Sources.
  }

  async verify(context: KnowledgeResetOwnerContext) {
    const status = await execute(() => readStatus(this.pool, context));
    const verified =
      status.linkedActionCount === 0 &&
      status.unclassifiedActionCount === 0 &&
      status.activeActionCount === 0 &&
      status.externalEffectActionCount === 0;
    return {
      verified,
      blockerCodes: verified
        ? []
        : status.externalEffectActionCount > 0
          ? (['EXTERNAL_ACTION_DEPENDENCY'] as const)
          : status.activeActionCount > 0
            ? (['ACTIVE_JOB_OUTCOME_UNKNOWN'] as const)
            : (['UNCLASSIFIED_CONTENT'] as const),
    };
  }
}
