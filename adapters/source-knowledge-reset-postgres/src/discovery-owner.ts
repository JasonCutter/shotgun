import type { Pool } from 'pg';

import {
  KnowledgeResetExecutionError,
  type KnowledgeResetOwnerContext,
  type KnowledgeResetOwnerPort,
} from '../../../modules/source-knowledge-reset/src/index.js';

const STATUS_KEYS = [
  'derivedRecordCount',
  'activeJobCount',
  'activeProviderReservationCount',
  'pendingReentryCount',
  'unclassifiedRecordCount',
  'fingerprint',
] as const;

type Status = Readonly<{
  derivedRecordCount: number;
  activeJobCount: number;
  activeProviderReservationCount: number;
  pendingReentryCount: number;
  unclassifiedRecordCount: number;
  fingerprint: string;
}>;

const readStatus = async (pool: Pool, context: KnowledgeResetOwnerContext): Promise<Status> => {
  const result = await pool.query<{ status: unknown }>(
    'SELECT discovery.t3_project_discovery_status($1, $2::uuid) AS status',
    [context.projectId, context.requestId],
  );
  let value = result.rows[0]?.status;
  if (typeof value === 'string') value = JSON.parse(value) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Discovery status routine returned a malformed object.');
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
    throw new Error('Discovery status routine returned malformed counts.');
  }
  return status as Status;
};

const mapDatabaseError = (error: unknown): KnowledgeResetExecutionError | undefined => {
  if (typeof error !== 'object' || error === null || !('constraint' in error)) return undefined;
  const constraint = error.constraint;
  if (constraint === 'active_job_outcome_unknown') {
    return new KnowledgeResetExecutionError(
      'ACTIVE_JOB_OUTCOME_UNKNOWN',
      'Discovery jobs, provider calls, and re-entry work must reach a known terminal state.',
    );
  }
  if (constraint === 't3_discovery_unclassified') {
    return new KnowledgeResetExecutionError(
      'UNCLASSIFIED_CONTENT',
      'Discovery run, finding, or evidence lineage is incomplete.',
    );
  }
  if (constraint === 't3_discovery_snapshot_missing') {
    return new KnowledgeResetExecutionError(
      'UNCLASSIFIED_CONTENT',
      'Discovery reset request is missing.',
      'ERASURE_UNVERIFIED',
    );
  }
  if (constraint === 't3_erasure_executor_required') {
    return new KnowledgeResetExecutionError(
      'ERASURE_EXECUTOR_UNAVAILABLE',
      'Discovery reset requires the dedicated erasure executor.',
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

/** Removes stale Project Discovery projections while retaining project configuration. */
export class PostgresDiscoveryKnowledgeResetOwner implements KnowledgeResetOwnerPort {
  readonly ownerId = 'discovery' as const;

  constructor(private readonly pool: Pool) {}

  async fence(context: KnowledgeResetOwnerContext): Promise<void> {
    const status = await execute(() => readStatus(this.pool, context));
    if (
      status.activeJobCount > 0 ||
      status.activeProviderReservationCount > 0 ||
      status.pendingReentryCount > 0
    ) {
      throw new KnowledgeResetExecutionError(
        'ACTIVE_JOB_OUTCOME_UNKNOWN',
        'Discovery jobs, provider calls, and re-entry work must reach a known terminal state.',
      );
    }
    if (status.unclassifiedRecordCount > 0) {
      throw new KnowledgeResetExecutionError(
        'UNCLASSIFIED_CONTENT',
        'Discovery run, finding, or evidence lineage is incomplete.',
      );
    }
  }

  async purge(context: KnowledgeResetOwnerContext): Promise<void> {
    await execute(() =>
      this.pool.query('SELECT discovery.t3_erase_project_discovery($1, $2::uuid)', [
        context.projectId,
        context.requestId,
      ]),
    );
  }

  async rebuild(): Promise<void> {
    // Discovery output is regenerated from the new Canonical and projection epoch.
  }

  async verify(context: KnowledgeResetOwnerContext) {
    const status = await execute(() => readStatus(this.pool, context));
    const active =
      status.activeJobCount > 0 ||
      status.activeProviderReservationCount > 0 ||
      status.pendingReentryCount > 0;
    const verified =
      status.derivedRecordCount === 0 && !active && status.unclassifiedRecordCount === 0;
    return {
      verified,
      blockerCodes: verified
        ? []
        : active
          ? (['ACTIVE_JOB_OUTCOME_UNKNOWN'] as const)
          : (['UNCLASSIFIED_CONTENT'] as const),
    };
  }
}
