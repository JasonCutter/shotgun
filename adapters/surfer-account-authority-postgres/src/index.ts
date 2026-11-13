import { assertSurferAccountDatabaseTargets } from './targets.js';
export * from './targets.js';
export * from './bootstrap.js';
import { randomUUID } from 'node:crypto';
export * from './closeout.js';
export * from './registration.js';
export * from './root-renewal.js';
import pg, { type Pool } from 'pg';
import { withSafePostgresTransaction } from '../../../packages/postgres-transaction/src/index.js';
import { decodeSurferAccountBinding } from '../../../packages/contracts/src/surfer-account-authority.js';
import {
  decodeSurferAccountAuthorityConfigV2 as decodeSurferAccountAuthorityConfig,
  type SurferAccountAuthorityStatusV2 as SurferAccountAuthorityStatus,
} from '../../../packages/contracts/src/surfer-account-authority-v2.js';
import {
  assertSurferAccountReceipt,
  priceSurferProviderUsage,
  type SurferAccountExecutionAuthorityPort,
  type SurferProviderBinding,
  type SurferAccountReceipt,
} from '../../../packages/contracts/src/surfer-provider.js';
import {
  decodeSurferUsage,
  type SurferUsage,
} from '../../../packages/contracts/src/surfer-execution.js';
import { surferDigest, surferFailure } from '../../../packages/contracts/src/surfer-learning.js';

/** Dedicated authority only. This class cannot provision policies, release calls, or replay send grants. */
export class PostgresSurferAccountAuthority implements SurferAccountExecutionAuthorityPort {
  readonly config: ReturnType<typeof decodeSurferAccountAuthorityConfig>;
  constructor(
    private readonly pool: Pick<Pool, 'connect'>,
    config: unknown,
  ) {
    this.config = decodeSurferAccountAuthorityConfig(config);
  }
  async authorize(input: SurferProviderBinding): Promise<SurferAccountReceipt> {
    const c = this.config,
      b = decodeSurferAccountBinding(input, c.profile),
      receipt = randomUUID();
    return withSafePostgresTransaction(
      this.pool,
      async (client) => {
        const q = await client.query<{ receipt: unknown }>(
          `SELECT provider_account.authorize($1,$2::jsonb,$3,$4,$5::jsonb,$6,$7::jsonb,$8,$9) AS receipt`,
          [
            c.rootPolicy.rootId,
            JSON.stringify(c.rootPolicy),
            surferDigest(c.rootPolicy),
            c.registrationId,
            JSON.stringify(c.profile),
            surferDigest(c.profile),
            JSON.stringify(b),
            surferDigest(b),
            receipt,
          ],
        );
        return assertSurferAccountReceipt(q.rows[0]?.receipt, b, c.profile);
      },
      { module: 'surfer.account-authority', operation: 'authorize' },
    );
  }
  async settle(
    input: SurferProviderBinding,
    receiptInput: SurferAccountReceipt,
    usageInput: SurferUsage,
  ): Promise<void> {
    const c = this.config,
      b = decodeSurferAccountBinding(input, c.profile),
      receipt = assertSurferAccountReceipt(receiptInput, b, c.profile),
      usage = decodeSurferUsage(usageInput);
    if (
      usage.calls !== 1 ||
      surferDigest(usage) !==
        surferDigest(
          priceSurferProviderUsage(
            usage.inputTokens,
            usage.outputTokens,
            usage.elapsedMs,
            c.profile,
          ),
        )
    )
      throw surferFailure('Account settlement changed declared usage/pricing.');
    return withSafePostgresTransaction(
      this.pool,
      async (client) => {
        await client.query(
          `SELECT provider_account.settle($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8)`,
          [
            c.rootPolicy.rootId,
            c.rootPolicy.storeId,
            c.registrationId,
            receipt.receiptId,
            JSON.stringify(b),
            surferDigest(b),
            JSON.stringify(usage),
            surferDigest(usage),
          ],
        );
      },
      { module: 'surfer.account-authority', operation: 'settle' },
    );
  }
  status(): Promise<SurferAccountAuthorityStatus> {
    const c = this.config;
    return withSafePostgresTransaction(
      this.pool,
      async (client) => {
        const q = await client.query<{ status: SurferAccountAuthorityStatus }>(
          `SELECT provider_account.status($1,$2,$3) AS status`,
          [c.rootPolicy.rootId, c.rootPolicy.storeId, c.registrationId],
        );
        const s = q.rows[0]?.status;
        if (!s || s.rootId !== c.rootPolicy.rootId || s.storeId !== c.rootPolicy.storeId)
          throw surferFailure('Account authority status unavailable.');
        return structuredClone(s);
      },
      { module: 'surfer.account-authority', operation: 'status', readOnly: true },
    );
  }
  /** Readiness only. authorize remains the atomic single-use send authority. */
  isCurrent(projectId: string): Promise<boolean> {
    const c = this.config;
    if (typeof projectId !== 'string' || !projectId.length || projectId.length > 256)
      throw surferFailure('Invalid account project.');
    return withSafePostgresTransaction(
      this.pool,
      async (client) => {
        const q = await client.query<{ ready: boolean }>(
          'SELECT provider_account.binding_current($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7,$8,$9) AS ready',
          [
            c.rootPolicy.rootId,
            c.rootPolicy.storeId,
            JSON.stringify(c.rootPolicy),
            surferDigest(c.rootPolicy),
            c.registrationId,
            JSON.stringify(c.profile),
            surferDigest(c.profile),
            surferDigest(c.profile.identity),
            projectId,
          ],
        );
        if (typeof q.rows[0]?.ready !== 'boolean')
          throw surferFailure('Account readiness unavailable.');
        return q.rows[0].ready;
      },
      { module: 'surfer.account-authority', operation: 'inspect-binding', readOnly: true },
    );
  }
}

/** Explicit URLs only. Do not load/copy env credentials or turn a workload DB clone into authority. */
export function surferAccountAuthorityFromConfig(input: {
  workloadDatabaseUrl: string;
  authorityDatabaseUrl: string;
  config: unknown;
}) {
  const c = decodeSurferAccountAuthorityConfig(input.config);
  assertSurferAccountDatabaseTargets(input.workloadDatabaseUrl, input.authorityDatabaseUrl);
  const pool = new pg.Pool({
    connectionString: input.authorityDatabaseUrl,
    max: 4,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
    query_timeout: 10000,
  });
  return { authority: new PostgresSurferAccountAuthority(pool, c), close: () => pool.end() };
}
