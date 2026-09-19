import type { Pool } from 'pg';

import {
  acquireMaintenanceLock,
  releaseMaintenanceLock,
  type MaintenanceLockMode,
} from '../../postgres-maintenance-lock/src/index.js';
import type {
  MaintenanceBarrierPort,
  StagingAssetLeaseInput,
  StagingAssetLeasePersistencePort,
  StagingTimeAuthorityPort,
} from '../../../modules/frontend-sources-staging/src/index.js';

export class PostgresStagingAssetLeaseRepository
  implements StagingAssetLeasePersistencePort, StagingTimeAuthorityPort, MaintenanceBarrierPort
{
  public constructor(private readonly pool: Pool) {}

  async createLease(input: StagingAssetLeaseInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO asset.staging_asset_leases (
         lease_id, reference_digest, project_id, draft_id, item_id, principal_id,
         input_kind, storage_key, content_hash, size_bytes, issued_at, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        input.leaseId,
        input.referenceDigest,
        input.projectId,
        input.draftId,
        input.itemId,
        input.principalId,
        input.inputKind,
        input.storageKey,
        input.contentHash,
        input.sizeBytes,
        input.issuedAt,
        input.expiresAt,
      ],
    );
  }

  async now(): Promise<Date> {
    const result = await this.pool.query<{ now: Date }>('SELECT clock_timestamp() AS now');
    const value = result.rows[0]?.now;
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw new Error('PostgreSQL staging time authority returned an invalid value.');
    }
    return value;
  }

  async runShared<T>(action: () => Promise<T>): Promise<T> {
    return this.withLock('shared', action);
  }

  private async withLock<T>(mode: MaintenanceLockMode, action: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let acquired = false;
    try {
      acquired = await acquireMaintenanceLock(client, mode);
      if (!acquired) throw new Error(`Failed to acquire ${mode} maintenance lock.`);
      return await action();
    } finally {
      if (acquired) await releaseMaintenanceLock(client, mode);
      client.release();
    }
  }
}
