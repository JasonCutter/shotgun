import type { Pool } from 'pg';

import {
  KnowledgeResetExecutionError,
  type KnowledgeResetOwnerContext,
  type KnowledgeResetOwnerPort,
} from '../../../modules/source-knowledge-reset/src/index.js';

const KEYS = [
  'sources',
  'sourceVersions',
  'storageReceipts',
  'stagingLeases',
  'activeStagingLeases',
  'sharedAssets',
] as const;
type Status = Readonly<Record<(typeof KEYS)[number], number>>;

const readStatus = async (pool: Pool, context: KnowledgeResetOwnerContext): Promise<Status> => {
  try {
    const result = await pool.query<{ status: unknown }>(
      'SELECT asset.t3_project_asset_status($1, $2::uuid) AS status',
      [context.projectId, context.requestId],
    );
    let status = result.rows[0]?.status;
    if (typeof status === 'string') status = JSON.parse(status) as unknown;
    if (typeof status !== 'object' || status === null || Array.isArray(status)) {
      throw new Error('Asset status routine returned a malformed object.');
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
      throw new Error('Asset status routine returned malformed counts.');
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
        'Asset status requires the dedicated erasure executor.',
      );
    }
    throw error;
  }
};

/** Project Source rows and CAS roots are removed only after every dependent owner has closed. */
export class PostgresAssetKnowledgeResetOwner implements KnowledgeResetOwnerPort {
  readonly ownerId = 'asset' as const;

  constructor(private readonly pool: Pool) {}

  async fence(context: KnowledgeResetOwnerContext): Promise<void> {
    const status = await readStatus(this.pool, context);
    if (status.activeStagingLeases > 0) {
      throw new KnowledgeResetExecutionError(
        'ACTIVE_JOB_OUTCOME_UNKNOWN',
        'An active staging asset lease must expire before the Source reset can proceed.',
      );
    }
  }

  async purge(context: KnowledgeResetOwnerContext): Promise<void> {
    try {
      await this.pool.query('SELECT asset.t3_erase_project_asset_data($1, $2::uuid)', [
        context.projectId,
        context.requestId,
      ]);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'constraint' in error &&
        error.constraint === 'active_staging_asset_lease'
      ) {
        throw new KnowledgeResetExecutionError(
          'ACTIVE_JOB_OUTCOME_UNKNOWN',
          'An active staging asset lease must expire before the Source reset can proceed.',
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
          'Asset purge requires the dedicated erasure executor.',
        );
      }
      throw error;
    }
  }

  async rebuild(): Promise<void> {
    // The Source reset does not create a replacement Source or OriginalAsset.
  }

  async verify(context: KnowledgeResetOwnerContext) {
    const status = await readStatus(this.pool, context);
    const empty =
      status.sources === 0 &&
      status.sourceVersions === 0 &&
      status.storageReceipts === 0 &&
      status.stagingLeases === 0;
    return {
      verified: empty,
      blockerCodes: empty ? [] : (['UNCLASSIFIED_CONTENT'] as const),
    };
  }
}
