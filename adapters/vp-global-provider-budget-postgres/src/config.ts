import { createHash } from 'node:crypto';
import pg from 'pg';

import { GlobalRelationBudgetPausedError, PostgresGlobalRelationBudget } from './index.js';

export const relationCredentialFingerprint = (secret: Uint8Array | string): string =>
  createHash('sha256').update(secret).digest('hex');

export function globalRelationBudgetFromEnvironment(
  workloadDatabaseUrl: string,
  accountFingerprint: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): { readonly budget: PostgresGlobalRelationBudget; readonly close: () => Promise<void> } {
  const authorityUrl = environment.VP_GLOBAL_RELATION_BUDGET_DATABASE_URL?.trim();
  const storeId = environment.VP_GLOBAL_RELATION_BUDGET_STORE_ID?.trim();
  const authorityId = environment.VP_GLOBAL_RELATION_BUDGET_AUTHORITY_ID?.trim();
  if (
    !authorityUrl ||
    !storeId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(storeId) ||
    !authorityId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      authorityId,
    ) ||
    !/^[a-f0-9]{64}$/u.test(accountFingerprint)
  ) {
    throw new GlobalRelationBudgetPausedError('IDENTITY_UNVERIFIED');
  }
  try {
    const workload = new URL(workloadDatabaseUrl);
    const authority = new URL(authorityUrl);
    for (const url of [workload, authority]) {
      if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) {
        throw new GlobalRelationBudgetPausedError('IDENTITY_UNVERIFIED');
      }
      // pg permits query parameters to override the URL's host and port.
      // The verified target must be the target the Pool will actually use.
      for (const key of url.searchParams.keys()) {
        if (['host', 'port', 'database', 'dbname', 'db', 'service'].includes(key.toLowerCase())) {
          throw new GlobalRelationBudgetPausedError('IDENTITY_UNVERIFIED');
        }
      }
    }
    const host = (url: URL) =>
      ['localhost', '127.0.0.1', '[::1]'].includes(decodeURIComponent(url.hostname).toLowerCase())
        ? 'loopback'
        : decodeURIComponent(url.hostname).toLowerCase();
    if (
      !['postgres:', 'postgresql:'].includes(authority.protocol) ||
      !authority.pathname.replace(/^\//u, '') ||
      (host(workload) === host(authority) &&
        (workload.port || '5432') === (authority.port || '5432') &&
        decodeURIComponent(workload.pathname) === decodeURIComponent(authority.pathname))
    ) {
      throw new GlobalRelationBudgetPausedError('IDENTITY_UNVERIFIED');
    }
  } catch {
    throw new GlobalRelationBudgetPausedError('IDENTITY_UNVERIFIED');
  }
  const pool = new pg.Pool({
    connectionString: authorityUrl,
    connectionTimeoutMillis: 5_000,
    query_timeout: 10_000,
    statement_timeout: 10_000,
  });
  const budget = new PostgresGlobalRelationBudget(pool, {
    storeId,
    authorityId,
    provider: 'deepseek',
    accountFingerprint,
    dailyLimit: 100,
  });
  return { budget, close: () => pool.end() };
}
