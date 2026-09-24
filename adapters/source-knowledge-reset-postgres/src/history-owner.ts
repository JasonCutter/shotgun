import type { Pool } from 'pg';

import type { HistoryEntryV1 } from '../../../packages/contracts/src/index.js';
import {
  KnowledgeResetExecutionError,
  type KnowledgeResetOwnerContext,
  type KnowledgeResetOwnerPort,
} from '../../../modules/source-knowledge-reset/src/index.js';
import type { HistoryWatermarkRecordV1 } from '../../../modules/frontend-history/src/history-watermark-store-port.js';

export type HistoryResetProjection = Readonly<{
  readonly entries: readonly HistoryEntryV1[];
  readonly watermarks: readonly HistoryWatermarkRecordV1[];
  readonly partial: boolean;
  readonly failures: readonly unknown[];
}>;

export type ProjectHistoryResetRebuilder = Readonly<{
  rebuildProjectHistory(context: KnowledgeResetOwnerContext): Promise<HistoryResetProjection>;
}>;

const REQUIRED_HISTORY_DOMAINS = ['CANONICAL', 'REVIEW', 'EXTERNAL_ACTION', 'POLICY'] as const;
const STATUS_KEYS = [
  'historyRecordCount',
  'watermarkCount',
  'snapshotRevision',
  'fingerprint',
  'expectedSnapshotRevision',
  'revisionMismatchCount',
  'rebuildCompleted',
] as const;

type Status = Readonly<{
  historyRecordCount: number;
  watermarkCount: number;
  snapshotRevision: number;
  fingerprint: string;
  expectedSnapshotRevision: number;
  revisionMismatchCount: number;
  rebuildCompleted: boolean;
}>;

const readStatus = async (pool: Pool, context: KnowledgeResetOwnerContext): Promise<Status> => {
  const result = await pool.query<{ status: unknown }>(
    'SELECT frontend_history.t3_project_history_status($1, $2::uuid) AS status',
    [context.projectId, context.requestId],
  );
  let value = result.rows[0]?.status;
  if (typeof value === 'string') value = JSON.parse(value) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('History status routine returned a malformed object.');
  }
  const status = value as Record<string, unknown>;
  const countKeys = [
    'historyRecordCount',
    'watermarkCount',
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
    throw new Error('History status routine returned malformed counts or fingerprint.');
  }
  return status as Status;
};

const mapDatabaseError = (error: unknown): KnowledgeResetExecutionError | undefined => {
  if (typeof error !== 'object' || error === null || !('constraint' in error)) return undefined;
  const constraint = error.constraint;
  if (constraint === 't3_erasure_executor_required') {
    return new KnowledgeResetExecutionError(
      'ERASURE_EXECUTOR_UNAVAILABLE',
      'History reset requires the dedicated erasure executor.',
    );
  }
  if (constraint === 't3_history_snapshot_stale') {
    return new KnowledgeResetExecutionError(
      'STALE_PREVIEW',
      'History projection changed after the approved reset preview.',
    );
  }
  if (constraint === 't3_history_snapshot_missing' || constraint === 't3_history_rebuild_invalid') {
    return new KnowledgeResetExecutionError(
      'UNCLASSIFIED_CONTENT',
      'History reset approval or rebuild contract is incomplete.',
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

/** Rebuilds the federated History view only from owners after their payload scrub. */
export class PostgresHistoryKnowledgeResetOwner implements KnowledgeResetOwnerPort {
  readonly ownerId = 'history' as const;

  constructor(
    private readonly pool: Pool,
    private readonly rebuilder: ProjectHistoryResetRebuilder,
  ) {}

  async fence(context: KnowledgeResetOwnerContext): Promise<void> {
    await execute(() =>
      this.pool.query('SELECT frontend_history.t3_snapshot_project_history($1, $2::uuid)', [
        context.projectId,
        context.requestId,
      ]),
    );
  }

  async purge(context: KnowledgeResetOwnerContext): Promise<void> {
    await execute(() =>
      this.pool.query('SELECT frontend_history.t3_erase_project_history($1, $2::uuid)', [
        context.projectId,
        context.requestId,
      ]),
    );
  }

  async rebuild(context: KnowledgeResetOwnerContext): Promise<void> {
    const projection = await this.rebuilder.rebuildProjectHistory(context);
    const availableDomains = new Set(
      projection.watermarks.map((watermark) => watermark.domainKind),
    );
    if (
      projection.partial ||
      projection.failures.length > 0 ||
      projection.entries.some((entry) => entry.resourceProjectId !== context.projectId) ||
      projection.watermarks.some((record) => record.resourceProjectId !== context.projectId) ||
      REQUIRED_HISTORY_DOMAINS.some((domain) => !availableDomains.has(domain))
    ) {
      throw new KnowledgeResetExecutionError(
        'UNCLASSIFIED_CONTENT',
        'History rebuild omitted an owner or returned a partial or cross-Project snapshot.',
        'ERASURE_UNVERIFIED',
      );
    }
    await execute(() =>
      this.pool.query(
        'SELECT frontend_history.t3_rebuild_project_history($1, $2::uuid, $3::jsonb, $4::jsonb)',
        [
          context.projectId,
          context.requestId,
          JSON.stringify(projection.entries.map(toDatabaseEntry)),
          JSON.stringify(projection.watermarks.map(toDatabaseWatermark)),
        ],
      ),
    );
    await execute(() =>
      this.pool.query('SELECT canonical.t3_publish_project_knowledge_reset_event($1, $2::uuid)', [
        context.projectId,
        context.requestId,
      ]),
    );
  }

  async verify(context: KnowledgeResetOwnerContext) {
    const status = await execute(() => readStatus(this.pool, context));
    const verified =
      status.rebuildCompleted &&
      status.watermarkCount >= REQUIRED_HISTORY_DOMAINS.length &&
      status.revisionMismatchCount === 0 &&
      status.snapshotRevision === status.expectedSnapshotRevision;
    return {
      verified,
      blockerCodes: verified ? [] : (['UNCLASSIFIED_CONTENT'] as const),
    };
  }
}

const toDatabaseEntry = (entry: HistoryEntryV1) => ({
  resource_project_id: entry.resourceProjectId,
  history_entry_id: entry.historyEntryId,
  domain_kind: entry.domainKind,
  domain_resource_kind: entry.domainResourceKind,
  domain_resource_id: entry.domainResourceId,
  source_event_kind: entry.sourceEventKind,
  source_event_id: entry.sourceEventId,
  source_sequence: entry.sourceSequence ?? null,
  occurred_at: entry.occurredAt,
  payload_availability: entry.payloadAvailability,
  payload_snapshot: entry.payloadSnapshot ?? null,
  projected_at: entry.projectedAt,
});

const toDatabaseWatermark = (watermark: HistoryWatermarkRecordV1) => ({
  resource_project_id: watermark.resourceProjectId,
  adapter_id: watermark.adapterId,
  domain_kind: watermark.domainKind,
  source_updated_at: watermark.sourceUpdatedAt ?? null,
  projected_at: watermark.projectedAt,
  last_source_position: watermark.lastSourcePosition ?? null,
  adapter_status: watermark.adapterStatus,
  snapshot_revision: watermark.snapshotRevision,
});
