import type { Pool, PoolClient } from 'pg';
import { withSafePostgresTransaction } from '../../../packages/postgres-transaction/src/index.js';
import {
  decodeSurferAccountCloseout,
  type SurferAccountCloseoutPort,
  type SurferAccountCloseoutRequest,
  type SurferAccountCloseoutReceipt,
} from '../../../packages/contracts/src/surfer-runtime-controls.js';
import { surferDigest, surferFailure } from '../../../packages/contracts/src/surfer-learning.js';

/** Explicit operator adapter. Uses existing admin privileges, never grants new runtime permissions. */
export class PostgresSurferAccountCloseout implements SurferAccountCloseoutPort {
  constructor(private readonly pool: Pick<Pool, 'connect'>) {}
  async close(input: SurferAccountCloseoutRequest): Promise<SurferAccountCloseoutReceipt> {
    const r = decodeSurferAccountCloseout(input),
      config = r.config,
      root = config.rootPolicy;
    return withSafePostgresTransaction(
      this.pool,
      async (c) => {
        await c.query("SET LOCAL lock_timeout='3s'");
        await c.query("SET LOCAL TIME ZONE 'UTC'");
        await c.query(
          'LOCK TABLE vp_global_budget.daily_usage,vp_global_budget.claims IN ACCESS EXCLUSIVE MODE',
        );
        await c.query(
          'LOCK TABLE provider_account.roots,provider_account.registrations,provider_account.legacy_links,provider_account.grants,provider_account.daily_calls IN SHARE ROW EXCLUSIVE MODE',
        );
        const peers = (
          await c.query(
            'SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()',
          )
        ).rows[0].n;
        if (peers !== 0)
          throw surferFailure(
            'Account closeout requires drained connections, including identical application names.',
          );
        const actual = (
          await c.query('SELECT * FROM provider_account.roots WHERE root_id=$1', [root.rootId])
        ).rows[0];
        const registrations = (
          await c.query('SELECT * FROM provider_account.registrations WHERE root_id=$1', [
            root.rootId,
          ])
        ).rows;
        const registration = registrations.find((x) => x.registration_id === config.registrationId);
        const store = (await c.query('SELECT store_id FROM vp_global_budget.authority_store')).rows;
        if (
          !actual ||
          store.length !== 1 ||
          store[0].store_id !== root.storeId ||
          actual.store_id !== root.storeId ||
          actual.policy_digest !== surferDigest(root) ||
          surferDigest(actual.policy) !== surferDigest(root) ||
          !registration ||
          registrations.some((x) => x.registration_id !== config.registrationId && x.enabled) ||
          registration.profile_digest !== surferDigest(config.profile) ||
          surferDigest(registration.profile) !== surferDigest(config.profile) ||
          registration.identity_digest !== surferDigest(config.profile.identity)
        )
          throw surferFailure('Account closeout exact root/profile/store/registration changed.');
        const legacy = (
          await c.query('SELECT * FROM vp_global_budget.policies WHERE authority_id=$1', [
            r.legacyAuthorityId,
          ])
        ).rows[0];
        if (
          !legacy ||
          legacy.provider !== root.provider ||
          legacy.account_fingerprint !== config.profile.accountFingerprint
        )
          throw surferFailure('Account closeout legacy account mismatch.');
        const links = (
          await c.query('SELECT authority_id FROM provider_account.legacy_links WHERE root_id=$1', [
            root.rootId,
          ])
        ).rows;
        const alreadyClosed = !actual.enabled && !registration.enabled && links.length === 0;
        if (!alreadyClosed && (links.length !== 1 || links[0].authority_id !== r.legacyAuthorityId))
          throw surferFailure('Account closeout legacy link changed.');
        if (
          (
            await c.query(
              "SELECT count(*)::int AS n FROM vp_global_budget.claims WHERE authority_id=$1 AND state='RESERVED'",
              [r.legacyAuthorityId],
            )
          ).rows[0].n !== 0
        )
          throw surferFailure('Account closeout refuses in-flight legacy claims.');
        const foreign = (
          await c.query(
            'SELECT count(*)::int AS n FROM provider_account.grants WHERE root_id=$1 AND registration_id=$2 AND left(operation_id,length($3))<>$3',
            [root.rootId, config.registrationId, 'semantic:' + r.stoppedRunId + ':'],
          )
        ).rows[0].n;
        if (foreign !== 0) throw surferFailure('Account closeout grants belong to another run.');
        const counts = (
          await c.query(
            "SELECT count(*)::int AS n,count(*) FILTER(WHERE state='AUTHORIZED')::int AS pending FROM provider_account.grants WHERE root_id=$1",
            [root.rootId],
          )
        ).rows[0];
        const before = await this.snapshot(
          c,
          root.rootId,
          r.legacyAuthorityId,
          config.registrationId,
        );
        await c.query(
          'UPDATE provider_account.registrations SET enabled=false WHERE registration_id=$1 AND root_id=$2',
          [config.registrationId, root.rootId],
        );
        await c.query('UPDATE provider_account.roots SET enabled=false WHERE root_id=$1', [
          root.rootId,
        ]);
        await c.query(
          'DELETE FROM provider_account.legacy_links WHERE root_id=$1 AND authority_id=$2',
          [root.rootId, r.legacyAuthorityId],
        );
        const after = await this.snapshot(
          c,
          root.rootId,
          r.legacyAuthorityId,
          config.registrationId,
        );
        if (surferDigest(before) !== surferDigest(after))
          throw surferFailure('Account closeout changed counters/grants/legacy history.');
        return {
          schemaVersion: '1.0.0',
          rootId: root.rootId,
          registrationId: config.registrationId,
          stoppedRunId: r.stoppedRunId,
          closureRef: r.closureRef,
          rootDisabled: true,
          registrationDisabled: true,
          legacyLinkAbsent: true,
          alreadyClosed,
          grantsPreserved: counts.n,
          unsettledGrantsPreserved: counts.pending,
          counterDigest: surferDigest(after.counters),
          grantDigest: surferDigest(after.grants),
          legacyDigest: surferDigest(after.legacy),
        };
      },
      { module: 'provider.account-authority', operation: 'operator-closeout' },
    );
  }
  private async snapshot(c: PoolClient, root: string, legacy: string, registration: string) {
    const hash = async (
      table: string,
      where: string,
      key: string,
      id: string,
      exclude?: string,
    ) => {
      const q = await c.query(
        `SELECT count(*)::text AS count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' ORDER BY ${key}),''),'UTF8')),'hex') AS sha256 FROM ${table} t WHERE ${where}=$1${exclude ? ' AND registration_id<>$2' : ''}`,
        exclude ? [id, exclude] : [id],
      );
      return q.rows[0] as { count: string; sha256: string };
    };
    return {
      historicalRegistrations: await hash(
        'provider_account.registrations',
        'root_id',
        'registration_id',
        root,
        registration,
      ),
      counters: await hash('provider_account.daily_calls', 'root_id', 'budget_day', root),
      grants: await hash('provider_account.grants', 'root_id', 'receipt_id', root),
      legacy: [
        await hash('vp_global_budget.policies', 'authority_id', 'authority_id', legacy),
        await hash('vp_global_budget.daily_usage', 'authority_id', 'budget_day', legacy),
        await hash('vp_global_budget.claims', 'authority_id', 'claim_id', legacy),
      ],
    };
  }
}
