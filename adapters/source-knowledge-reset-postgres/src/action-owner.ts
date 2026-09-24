import type { Pool } from 'pg';

import {
  KnowledgeResetExecutionError,
  type KnowledgeResetOwnerContext,
  type KnowledgeResetOwnerPort,
} from '../../../modules/source-knowledge-reset/src/index.js';

const STATUS_KEYS = [
  'candidateCount',
  'actionCount',
  'linkedCandidateCount',
  'linkedActionCount',
  'unclassifiedCandidateCount',
  'unclassifiedActionCount',
  'unclassifiedWorkItemCount',
  'activeActionCount',
  'externalEffectActionCount',
  'derivedRecords',
  'redactedAuditRecords',
  'fingerprint',
] as const;

type Status = Readonly<{
  candidateCount: number;
  actionCount: number;
  linkedCandidateCount: number;
  linkedActionCount: number;
  unclassifiedCandidateCount: number;
  unclassifiedActionCount: number;
  unclassifiedWorkItemCount: number;
  activeActionCount: number;
  externalEffectActionCount: number;
  derivedRecords: number;
  redactedAuditRecords: number;
  fingerprint: string;
}>;

const readStatus = async (pool: Pool, context: KnowledgeResetOwnerContext): Promise<Status> => {
  const result = await pool.query<{ status: unknown }>(
    'SELECT action.t3_project_action_status($1, $2::uuid) AS status',
    [context.projectId, context.requestId],
  );
  let value = result.rows[0]?.status;
  if (typeof value === 'string') value = JSON.parse(value) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Action status routine returned a malformed object.');
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
    throw new Error('Action status routine returned malformed counts.');
  }
  return status as Status;
};

const mapDatabaseError = (error: unknown): KnowledgeResetExecutionError | undefined => {
  if (typeof error !== 'object' || error === null || !('constraint' in error)) return undefined;
  const constraint = error.constraint;
  if (constraint === 'active_job_outcome_unknown') {
    return new KnowledgeResetExecutionError(
      'ACTIVE_JOB_OUTCOME_UNKNOWN',
      'Action execution or feedback delivery must reach a known terminal state before reset.',
    );
  }
  if (constraint === 'external_action_dependency') {
    return new KnowledgeResetExecutionError(
      'EXTERNAL_ACTION_DEPENDENCY',
      'A Source-linked Action may have produced an external effect.',
    );
  }
  if (constraint === 't3_action_unclassified') {
    return new KnowledgeResetExecutionError(
      'UNCLASSIFIED_CONTENT',
      'Action Source lineage is incomplete or ambiguous.',
    );
  }
  if (constraint === 't3_action_snapshot_missing') {
    return new KnowledgeResetExecutionError(
      'UNCLASSIFIED_CONTENT',
      'Action reset snapshot is missing.',
      'ERASURE_UNVERIFIED',
    );
  }
  if (constraint === 't3_erasure_executor_required') {
    return new KnowledgeResetExecutionError(
      'ERASURE_EXECUTOR_UNAVAILABLE',
      'Action reset requires the dedicated erasure executor.',
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

/** Removes Source-derived Action previews and candidates while retaining redacted audit identity. */
export class PostgresActionKnowledgeResetOwner implements KnowledgeResetOwnerPort {
  readonly ownerId = 'action' as const;

  constructor(private readonly pool: Pool) {}

  async fence(context: KnowledgeResetOwnerContext): Promise<void> {
    await execute(() =>
      this.pool.query('SELECT action.t3_snapshot_project_actions($1, $2::uuid)', [
        context.projectId,
        context.requestId,
      ]),
    );
  }

  async purge(context: KnowledgeResetOwnerContext): Promise<void> {
    await execute(() =>
      this.pool.query('SELECT action.t3_erase_project_actions($1, $2::uuid)', [
        context.projectId,
        context.requestId,
      ]),
    );
  }

  async rebuild(): Promise<void> {
    // Action candidates and previews are not rebuilt from a reset Project's Sources.
  }

  async verify(context: KnowledgeResetOwnerContext) {
    const status = await execute(() => readStatus(this.pool, context));
    const verified =
      status.linkedCandidateCount === 0 &&
      status.linkedActionCount === 0 &&
      status.unclassifiedCandidateCount === 0 &&
      status.unclassifiedActionCount === 0 &&
      status.unclassifiedWorkItemCount === 0 &&
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
