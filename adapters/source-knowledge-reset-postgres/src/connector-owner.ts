import type { Pool } from 'pg';

import {
  KnowledgeResetExecutionError,
  type KnowledgeResetOwnerContext,
  type KnowledgeResetOwnerPort,
} from '../../../modules/source-knowledge-reset/src/index.js';

type ConnectorImpact = Readonly<{
  sourceDerivedRecordCount: number;
  unclassifiedRecordCount: number;
  activeJobCount: number;
  fingerprint: string;
}>;

type ConnectorStatus = Readonly<{
  purgeCompleted: boolean;
  sourceDerivedRecordCount: number;
  remainingProjectRecordCount: number;
  fingerprint: string;
}>;

const readObject = (value: unknown, owner: string): Record<string, unknown> => {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      throw new Error(`${owner} returned malformed JSON.`);
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${owner} returned a malformed object.`);
  }
  return value as Record<string, unknown>;
};

const safeCount = (value: unknown, owner: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${owner} returned an invalid count.`);
  }
  return value;
};

const readImpact = async (pool: Pool, projectId: string): Promise<ConnectorImpact> => {
  const result = await pool.query<{ impact: unknown }>(
    'SELECT connector.t3_project_connector_impact($1) AS impact',
    [projectId],
  );
  const impact = readObject(result.rows[0]?.impact, 'Connector impact');
  if (typeof impact.fingerprint !== 'string' || !/^[0-9a-f]{64}$/u.test(impact.fingerprint)) {
    throw new Error('Connector impact returned an invalid fingerprint.');
  }
  return {
    sourceDerivedRecordCount: safeCount(impact.sourceDerivedRecordCount, 'Connector impact'),
    unclassifiedRecordCount: safeCount(impact.unclassifiedRecordCount, 'Connector impact'),
    activeJobCount: safeCount(impact.activeJobCount, 'Connector impact'),
    fingerprint: impact.fingerprint,
  };
};

const readStatus = async (
  pool: Pool,
  context: KnowledgeResetOwnerContext,
): Promise<ConnectorStatus> => {
  const result = await pool.query<{ status: unknown }>(
    'SELECT connector.t3_project_connector_status($1, $2::uuid) AS status',
    [context.projectId, context.requestId],
  );
  const status = readObject(result.rows[0]?.status, 'Connector reset status');
  if (
    typeof status.purgeCompleted !== 'boolean' ||
    typeof status.fingerprint !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(status.fingerprint)
  ) {
    throw new Error('Connector reset status returned invalid state.');
  }
  return {
    purgeCompleted: status.purgeCompleted,
    sourceDerivedRecordCount: safeCount(status.sourceDerivedRecordCount, 'Connector reset status'),
    remainingProjectRecordCount: safeCount(
      status.remainingProjectRecordCount,
      'Connector reset status',
    ),
    fingerprint: status.fingerprint,
  };
};

const mapError = (error: unknown): KnowledgeResetExecutionError | undefined => {
  if (typeof error !== 'object' || error === null || !('constraint' in error)) return undefined;
  switch (error.constraint) {
    case 't3_erasure_executor_required':
      return new KnowledgeResetExecutionError(
        'ERASURE_EXECUTOR_UNAVAILABLE',
        'Connector reset requires the dedicated erasure executor.',
      );
    case 't3_connector_unclassified':
      return new KnowledgeResetExecutionError(
        'UNCLASSIFIED_CONTENT',
        'Connector job lineage cannot be attributed safely to this Project Source set.',
      );
    case 'active_job_outcome_unknown':
      return new KnowledgeResetExecutionError(
        'ACTIVE_JOB_OUTCOME_UNKNOWN',
        'Connector has an active lease, replay or unknown Source job outcome.',
      );
    case 't3_connector_snapshot_stale':
      return new KnowledgeResetExecutionError(
        'STALE_PREVIEW',
        'Connector delivery state changed after the approved reset preview.',
      );
    case 't3_connector_snapshot_missing':
      return new KnowledgeResetExecutionError(
        'UNCLASSIFIED_CONTENT',
        'Connector fence snapshot is missing during forward recovery.',
        'ERASURE_UNVERIFIED',
      );
    default:
      return undefined;
  }
};

const execute = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work();
  } catch (error) {
    throw mapError(error) ?? error;
  }
};

/** Fences Source-linked durable events, jobs, attempts and replay payloads. */
export class PostgresConnectorKnowledgeResetOwner implements KnowledgeResetOwnerPort {
  readonly ownerId = 'connector' as const;

  constructor(private readonly pool: Pool) {}

  async fence(context: KnowledgeResetOwnerContext): Promise<void> {
    const impact = await execute(() => readImpact(this.pool, context.projectId));
    if (impact.unclassifiedRecordCount > 0) {
      throw new KnowledgeResetExecutionError(
        'UNCLASSIFIED_CONTENT',
        'Connector project records have no proven Source or independent lineage.',
      );
    }
    if (impact.activeJobCount > 0) {
      throw new KnowledgeResetExecutionError(
        'ACTIVE_JOB_OUTCOME_UNKNOWN',
        'Connector has an active lease, replay or unknown Source job outcome.',
      );
    }
    await execute(() =>
      this.pool.query('SELECT connector.t3_snapshot_project_connector($1, $2::uuid)', [
        context.projectId,
        context.requestId,
      ]),
    );
  }

  async purge(context: KnowledgeResetOwnerContext): Promise<void> {
    await execute(() =>
      this.pool.query('SELECT connector.t3_erase_project_connector($1, $2::uuid)', [
        context.projectId,
        context.requestId,
      ]),
    );
  }

  async rebuild(): Promise<void> {
    // Connector delivery identity is deleted or retained; it is not a projection.
  }

  async verify(context: KnowledgeResetOwnerContext) {
    const status = await execute(() => readStatus(this.pool, context));
    const verified =
      status.purgeCompleted &&
      status.sourceDerivedRecordCount >= 0 &&
      status.remainingProjectRecordCount === 0;
    return {
      verified,
      blockerCodes: verified ? [] : (['UNCLASSIFIED_CONTENT'] as const),
    };
  }
}
