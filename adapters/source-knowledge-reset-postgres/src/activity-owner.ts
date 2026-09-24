import type { Pool } from 'pg';

import type {
  ActivityIndexRecordV1,
  ActivityWatermarkRecordV1,
} from '../../../modules/frontend-activity/src/index.js';
import {
  KnowledgeResetExecutionError,
  type KnowledgeResetOwnerContext,
  type KnowledgeResetOwnerPort,
} from '../../../modules/source-knowledge-reset/src/index.js';

export type ActivityResetProjection = Readonly<{
  readonly records: readonly ActivityIndexRecordV1[];
  readonly watermarks: readonly ActivityWatermarkRecordV1[];
  readonly partial: boolean;
  readonly failures: readonly unknown[];
}>;

export type ProjectActivityResetRebuilder = Readonly<{
  rebuildProjectActivity(context: KnowledgeResetOwnerContext): Promise<ActivityResetProjection>;
}>;

const REQUIRED_ACTIVITY_DOMAINS = ['SOURCES', 'ASK', 'EXTERNAL_ACTION', 'DISCOVERY'] as const;

const STATUS_KEYS = [
  'activityRecordCount',
  'watermarkCount',
  'sourceDomainRecordCount',
  'snapshotRevision',
  'fingerprint',
  'expectedSnapshotRevision',
  'revisionMismatchCount',
  'rebuildCompleted',
] as const;

type Status = Readonly<{
  activityRecordCount: number;
  watermarkCount: number;
  sourceDomainRecordCount: number;
  snapshotRevision: number;
  fingerprint: string;
  expectedSnapshotRevision: number;
  revisionMismatchCount: number;
  rebuildCompleted: boolean;
}>;

const readStatus = async (pool: Pool, context: KnowledgeResetOwnerContext): Promise<Status> => {
  const result = await pool.query<{ status: unknown }>(
    'SELECT frontend_activity.t3_project_activity_status($1, $2::uuid) AS status',
    [context.projectId, context.requestId],
  );
  let value = result.rows[0]?.status;
  if (typeof value === 'string') value = JSON.parse(value) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Activity status routine returned a malformed object.');
  }
  const status = value as Record<string, unknown>;
  const countKeys = [
    'activityRecordCount',
    'watermarkCount',
    'sourceDomainRecordCount',
    'snapshotRevision',
    'expectedSnapshotRevision',
    'revisionMismatchCount',
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
    typeof status.rebuildCompleted !== 'boolean'
  ) {
    throw new Error('Activity status routine returned malformed counts.');
  }
  return status as Status;
};

const mapDatabaseError = (error: unknown): KnowledgeResetExecutionError | undefined => {
  if (typeof error !== 'object' || error === null || !('constraint' in error)) return undefined;
  const constraint = error.constraint;
  if (constraint === 't3_erasure_executor_required') {
    return new KnowledgeResetExecutionError(
      'ERASURE_EXECUTOR_UNAVAILABLE',
      'Activity reset requires the dedicated erasure executor.',
    );
  }
  if (constraint === 't3_activity_snapshot_stale') {
    return new KnowledgeResetExecutionError(
      'STALE_PREVIEW',
      'Activity projection changed after the approved reset preview.',
    );
  }
  if (constraint === 't3_activity_source_projection_remaining') {
    return new KnowledgeResetExecutionError(
      'UNCLASSIFIED_CONTENT',
      'The Activity projection still contains Source-domain content.',
      'ERASURE_UNVERIFIED',
    );
  }
  if (
    constraint === 't3_activity_snapshot_missing' ||
    constraint === 't3_activity_rebuild_invalid'
  ) {
    return new KnowledgeResetExecutionError(
      'UNCLASSIFIED_CONTENT',
      'Activity reset approval or rebuild contract is incomplete.',
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

/** Clears the materialized Activity view and rebuilds it from surviving owners. */
export class PostgresActivityKnowledgeResetOwner implements KnowledgeResetOwnerPort {
  readonly ownerId = 'activity' as const;

  constructor(
    private readonly pool: Pool,
    private readonly rebuilder: ProjectActivityResetRebuilder,
  ) {}

  async fence(context: KnowledgeResetOwnerContext): Promise<void> {
    await execute(() =>
      this.pool.query('SELECT frontend_activity.t3_snapshot_project_activity($1, $2::uuid)', [
        context.projectId,
        context.requestId,
      ]),
    );
  }

  async purge(context: KnowledgeResetOwnerContext): Promise<void> {
    await execute(() =>
      this.pool.query('SELECT frontend_activity.t3_erase_project_activity($1, $2::uuid)', [
        context.projectId,
        context.requestId,
      ]),
    );
  }

  async rebuild(context: KnowledgeResetOwnerContext): Promise<void> {
    const projection = await this.rebuilder.rebuildProjectActivity(context);
    const availableDomains = new Set(
      projection.watermarks.map((watermark) => watermark.domainKind),
    );
    if (
      projection.partial ||
      projection.failures.length > 0 ||
      projection.records.some((record) => record.resourceProjectId !== context.projectId) ||
      projection.watermarks.some((record) => record.resourceProjectId !== context.projectId) ||
      REQUIRED_ACTIVITY_DOMAINS.some((domain) => !availableDomains.has(domain))
    ) {
      throw new KnowledgeResetExecutionError(
        'UNCLASSIFIED_CONTENT',
        'Activity rebuild did not produce a complete, Project-scoped projection.',
        'ERASURE_UNVERIFIED',
      );
    }
    await execute(() =>
      this.pool.query(
        'SELECT frontend_activity.t3_rebuild_project_activity($1, $2::uuid, $3::jsonb, $4::jsonb)',
        [
          context.projectId,
          context.requestId,
          JSON.stringify(projection.records.map(toDatabaseActivityRecord)),
          JSON.stringify(projection.watermarks.map(toDatabaseWatermark)),
        ],
      ),
    );
  }

  async verify(context: KnowledgeResetOwnerContext) {
    const status = await execute(() => readStatus(this.pool, context));
    const verified =
      status.rebuildCompleted &&
      status.sourceDomainRecordCount === 0 &&
      status.watermarkCount > 0 &&
      status.revisionMismatchCount === 0 &&
      status.snapshotRevision === status.expectedSnapshotRevision;
    return {
      verified,
      blockerCodes: verified ? [] : (['UNCLASSIFIED_CONTENT'] as const),
    };
  }
}

const toDatabaseActivityRecord = (record: ActivityIndexRecordV1) => ({
  resource_project_id: record.resourceProjectId,
  activity_id: record.activityId,
  domain_kind: record.domainKind,
  root_kind: record.rootKind,
  domain_resource_kind: record.domainResourceKind,
  domain_resource_id: record.domainResourceId,
  domain_resource_revision: record.domainResourceRevision ?? null,
  resource_href: record.resourceHref,
  job_id: record.jobId ?? null,
  run_id: record.runId,
  summary: record.summary,
  state: record.state,
  attention: record.attention,
  retryability: record.retryability,
  freshness: record.freshness,
  adapter_status: record.adapterStatus,
  snapshot_revision: record.snapshotRevision,
  snapshot: record.snapshot,
  projected_at: record.projectedAt,
  updated_at: record.updatedAt,
});

const toDatabaseWatermark = (record: ActivityWatermarkRecordV1) => ({
  resource_project_id: record.resourceProjectId,
  adapter_id: record.adapterId,
  domain_kind: record.domainKind,
  source_updated_at: record.sourceUpdatedAt ?? null,
  projected_at: record.projectedAt,
  lag_milliseconds: record.lagMilliseconds ?? null,
  adapter_status: record.adapterStatus,
  snapshot_revision: record.snapshotRevision,
  cursor: record.cursor ?? null,
  updated_at: record.updatedAt,
});
