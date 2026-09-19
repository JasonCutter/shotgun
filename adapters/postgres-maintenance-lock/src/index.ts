import type { ClientBase } from 'pg';

export const ASSET_CAS_MAINTENANCE_LOCK_NAME = 'shotgun.asset-cas-maintenance.v1';

export type MaintenanceLockMode = 'shared' | 'exclusive';

type AdvisoryClient = Pick<ClientBase, 'query'>;

const functionName = (mode: MaintenanceLockMode, tryOnly: boolean): string => {
  if (mode === 'exclusive') return tryOnly ? 'pg_try_advisory_lock' : 'pg_advisory_lock';
  return tryOnly ? 'pg_try_advisory_lock_shared' : 'pg_advisory_lock_shared';
};

const unlockFunctionName = (mode: MaintenanceLockMode): string =>
  mode === 'exclusive' ? 'pg_advisory_unlock' : 'pg_advisory_unlock_shared';

export const acquireMaintenanceLock = async (
  client: AdvisoryClient,
  mode: MaintenanceLockMode,
  tryOnly = false,
): Promise<boolean> => {
  if (!tryOnly) {
    await client.query(`SELECT ${functionName(mode, false)}(hashtextextended($1, 0))`, [
      ASSET_CAS_MAINTENANCE_LOCK_NAME,
    ]);
    return true;
  }
  const result = await client.query<{ acquired: boolean }>(
    `SELECT ${functionName(mode, true)}(hashtextextended($1, 0)) AS acquired`,
    [ASSET_CAS_MAINTENANCE_LOCK_NAME],
  );
  return result.rows[0]?.acquired === true;
};

export const releaseMaintenanceLock = async (
  client: AdvisoryClient,
  mode: MaintenanceLockMode,
): Promise<void> => {
  const result = await client.query<{ released: boolean }>(
    `SELECT ${unlockFunctionName(mode)}(hashtextextended($1, 0)) AS released`,
    [ASSET_CAS_MAINTENANCE_LOCK_NAME],
  );
  if (result.rows[0]?.released !== true) {
    throw new Error(`PostgreSQL ${mode} maintenance lock was not held by this session.`);
  }
};

export const withMaintenanceLock = async <T>(
  client: AdvisoryClient,
  mode: MaintenanceLockMode,
  action: () => Promise<T>,
): Promise<T> => {
  await acquireMaintenanceLock(client, mode);
  try {
    return await action();
  } finally {
    await releaseMaintenanceLock(client, mode);
  }
};
