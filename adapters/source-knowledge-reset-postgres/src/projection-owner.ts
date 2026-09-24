import type { Pool } from 'pg';

import type {
  CompiledTruthProjection,
  SearchProjectionDocument,
} from '../../../packages/contracts/src/index.js';
import {
  KnowledgeResetExecutionError,
  type KnowledgeResetOwnerContext,
  type KnowledgeResetOwnerPort,
} from '../../../modules/source-knowledge-reset/src/index.js';

const STATUS_KEYS = [
  'projectionRecordCount',
  'activeGenerationCount',
  'fingerprint',
  'canonicalVersion',
  'staleProjectionCount',
] as const;

type Status = Readonly<{
  projectionRecordCount: number;
  activeGenerationCount: number;
  fingerprint: string;
  canonicalVersion: number;
  staleProjectionCount: number;
}>;

export type ProjectProjectionRebuilder = Readonly<{
  rebuildProjectProjections(context: KnowledgeResetOwnerContext): Promise<void>;
}>;

/** Persists domain-built projections through the executor-only T3 DB boundary. */
export class PostgresProjectionResetSnapshotWriter {
  constructor(private readonly pool: Pool) {}

  async persist(input: {
    readonly context: KnowledgeResetOwnerContext;
    readonly searchDocuments: readonly SearchProjectionDocument[];
    readonly compiledProjection: CompiledTruthProjection;
  }): Promise<void> {
    try {
      const result = await this.pool.query<{ snapshot: unknown }>(
        `SELECT projection.t3_rebuild_project_projection_snapshot(
           $1, $2::uuid, $3::jsonb, $4::jsonb
         ) AS snapshot`,
        [
          input.context.projectId,
          input.context.requestId,
          JSON.stringify(input.searchDocuments),
          JSON.stringify(input.compiledProjection),
        ],
      );
      let snapshot = result.rows[0]?.snapshot;
      if (typeof snapshot === 'string') snapshot = JSON.parse(snapshot) as unknown;
      if (
        typeof snapshot !== 'object' ||
        snapshot === null ||
        Array.isArray(snapshot) ||
        !('status' in snapshot) ||
        snapshot.status !== 'READY' ||
        !('projectId' in snapshot) ||
        snapshot.projectId !== input.context.projectId ||
        !('canonicalVersion' in snapshot) ||
        snapshot.canonicalVersion !== input.compiledProjection.canonicalVersion ||
        !('canonicalSnapshotDigest' in snapshot) ||
        typeof snapshot.canonicalSnapshotDigest !== 'string' ||
        !/^sha256:[a-f0-9]{64}$/u.test(snapshot.canonicalSnapshotDigest) ||
        !('sourceSnapshotDigest' in snapshot) ||
        snapshot.sourceSnapshotDigest !== input.compiledProjection.sourceSnapshotDigest ||
        !('searchDocumentCount' in snapshot) ||
        snapshot.searchDocumentCount !== input.searchDocuments.length
      ) {
        throw new KnowledgeResetExecutionError(
          'UNCLASSIFIED_CONTENT',
          'Projection rebuild persistence returned a malformed readback.',
          'ERASURE_UNVERIFIED',
        );
      }
    } catch (error) {
      throw mapDatabaseError(error) ?? error;
    }
  }
}

const mapDatabaseError = (error: unknown): KnowledgeResetExecutionError | undefined => {
  if (typeof error !== 'object' || error === null || !('constraint' in error)) return undefined;
  if (error.constraint === 'active_job_outcome_unknown') {
    return new KnowledgeResetExecutionError(
      'ACTIVE_JOB_OUTCOME_UNKNOWN',
      'Semantic projection work must reach a known terminal state before reset.',
    );
  }
  if (error.constraint === 't3_erasure_executor_required') {
    return new KnowledgeResetExecutionError(
      'ERASURE_EXECUTOR_UNAVAILABLE',
      'Projection erasure requires the dedicated erasure executor.',
    );
  }
  if (
    error.constraint === 't3_projection_snapshot_invalid' ||
    error.constraint === 't3_projection_snapshot_stale'
  ) {
    return new KnowledgeResetExecutionError(
      'UNCLASSIFIED_CONTENT',
      'Projection rebuild output does not match the post-reset Canonical snapshot.',
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

const readStatus = async (pool: Pool, context: KnowledgeResetOwnerContext): Promise<Status> => {
  const result = await pool.query<{ status: unknown }>(
    'SELECT projection.t3_project_projection_status($1, $2::uuid) AS status',
    [context.projectId, context.requestId],
  );
  let value = result.rows[0]?.status;
  if (typeof value === 'string') value = JSON.parse(value) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Projection status routine returned a malformed object.');
  }
  const status = value as Record<string, unknown>;
  if (
    Object.keys(status).length !== STATUS_KEYS.length ||
    STATUS_KEYS.some((key) =>
      key === 'fingerprint'
        ? typeof status[key] !== 'string' || !/^[0-9a-f]{64}$/u.test(status[key] as string)
        : typeof status[key] !== 'number' ||
          !Number.isSafeInteger(status[key]) ||
          (status[key] as number) < (key === 'canonicalVersion' ? -1 : 0),
    )
  ) {
    throw new Error('Projection status routine returned malformed counts.');
  }
  return status as Status;
};

/** Removes stale Project projection data and rebuilds against post-reset Canonical state. */
export class PostgresProjectionKnowledgeResetOwner implements KnowledgeResetOwnerPort {
  readonly ownerId = 'projection' as const;

  constructor(
    private readonly pool: Pool,
    private readonly rebuilder: ProjectProjectionRebuilder,
  ) {}

  async fence(context: KnowledgeResetOwnerContext): Promise<void> {
    const status = await execute(() => readStatus(this.pool, context));
    if (status.activeGenerationCount > 0) {
      throw new KnowledgeResetExecutionError(
        'ACTIVE_JOB_OUTCOME_UNKNOWN',
        'Semantic projection work must reach a known terminal state before reset.',
      );
    }
  }

  async purge(context: KnowledgeResetOwnerContext): Promise<void> {
    await execute(() =>
      this.pool.query('SELECT projection.t3_erase_project_projections($1, $2::uuid)', [
        context.projectId,
        context.requestId,
      ]),
    );
  }

  async rebuild(context: KnowledgeResetOwnerContext): Promise<void> {
    await this.rebuilder.rebuildProjectProjections(context);
  }

  async verify(context: KnowledgeResetOwnerContext) {
    const status = await execute(() => readStatus(this.pool, context));
    const verified = status.activeGenerationCount === 0 && status.staleProjectionCount === 0;
    return {
      verified,
      blockerCodes: verified
        ? []
        : status.activeGenerationCount > 0
          ? (['ACTIVE_JOB_OUTCOME_UNKNOWN'] as const)
          : (['UNCLASSIFIED_CONTENT'] as const),
    };
  }
}
