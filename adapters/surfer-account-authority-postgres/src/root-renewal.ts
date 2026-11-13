import type { Pool, PoolClient } from 'pg';
import { withSafePostgresTransaction } from '../../../packages/postgres-transaction/src/index.js';
import { decodeSurferAccountAuthorityConfigV2 } from '../../../packages/contracts/src/surfer-account-authority-v2.js';
import {
  decodeSurferRootRenewal,
  type SurferRootRenewalCommand,
  type SurferRootRenewalPort,
  type SurferRootRenewalReceipt,
} from '../../../packages/contracts/src/surfer-root-renewal.js';
import { surferDigest, surferFailure } from '../../../packages/contracts/src/surfer-learning.js';
const denied = () =>
  surferFailure('Root renewal authority, history or retained reservations changed.');
const assertConfig = (
  s: { registrations: Record<string, unknown>[]; credentials: Record<string, unknown>[] },
  config: ReturnType<typeof decodeSurferAccountAuthorityConfigV2>,
) => {
  if (
    !s.registrations.some(
      (r) =>
        r.registration_id === config.registrationId &&
        r.profile_digest === surferDigest(config.profile) &&
        surferDigest(r.profile) === r.profile_digest &&
        r.identity_digest === surferDigest(config.profile.identity),
    ) ||
    !s.credentials.some(
      (c) =>
        c.provider === config.rootPolicy.provider &&
        c.credential_fingerprint === config.profile.accountFingerprint,
    )
  )
    throw denied();
};
/** Administrative capability only. Never settles, refunds, resets or replays a provider request. */
export class PostgresSurferRootRenewal implements SurferRootRenewalPort {
  constructor(private readonly pool: Pick<Pool, 'connect'>) {}
  private async snapshot(c: PoolClient, rid: string) {
    const root = (
      await c.query('SELECT to_jsonb(r) data FROM provider_account.roots r WHERE root_id=$1', [rid])
    ).rows[0]?.data;
    if (
      !root ||
      surferDigest(root.policy) !== root.policy_digest ||
      !(
        await c.query(
          'SELECT 1 FROM vp_global_budget.authority_store WHERE singleton AND store_id=$1',
          [root.store_id],
        )
      ).rowCount
    )
      throw denied();
    const rows = async (table: string, key: string) =>
      (
        await c.query(`SELECT to_jsonb(t) data FROM ${table} t WHERE root_id=$1 ORDER BY ${key}`, [
          rid,
        ])
      ).rows.map((x) => x.data);
    const registrations = await rows('provider_account.registrations', 'registration_id'),
      grants = await rows('provider_account.grants', 'receipt_id'),
      calls = await rows('provider_account.daily_calls', 'budget_day'),
      legacy = await rows('provider_account.legacy_links', 'authority_id'),
      credentials = await rows(
        'provider_account.credential_accounts',
        'provider,credential_fingerprint',
      );
    const legacyPending = (
      await c.query(
        "SELECT EXISTS(SELECT 1 FROM vp_global_budget.claims c JOIN provider_account.legacy_links l ON l.authority_id=c.authority_id WHERE l.root_id=$1 AND c.state='RESERVED') unsafe",
        [rid],
      )
    ).rows[0].unsafe;
    const overage = (
      await c.query(
        "SELECT EXISTS(SELECT 1 FROM provider_account.grants g,jsonb_each(g.usage) x WHERE g.root_id=$1 AND NOT g.overage_resolved AND (x.value::text)::numeric>(g.binding->'maximum'->>x.key)::numeric) unsafe",
        [rid],
      )
    ).rows[0].unsafe;
    return { root, registrations, grants, calls, legacy, credentials, legacyPending, overage };
  }
  async inspect(input: unknown) {
    const config = decodeSurferAccountAuthorityConfigV2(input);
    return withSafePostgresTransaction(
      this.pool,
      async (c) => {
        await c.query("SET LOCAL TIME ZONE 'UTC'");
        const s = await this.snapshot(c, config.rootPolicy.rootId);
        if (s.root.policy_digest !== surferDigest(config.rootPolicy)) throw denied();
        assertConfig(s, config);
        const migrationReady = !!(
          await c.query(
            "SELECT to_regclass('provider_account.root_renewal_commands') IS NOT NULL AND to_regclass('provider_account.retained_unknown_grants') IS NOT NULL AS ready",
          )
        ).rows[0].ready;
        const rootStillActive =
          s.root.enabled &&
          (
            await c.query(
              'SELECT $1::numeric>extract(epoch FROM clock_timestamp())*1000 AS active',
              [config.rootPolicy.expiresAtMs],
            )
          ).rows[0].active;
        return {
          digest: surferDigest(s),
          enabled: s.root.enabled as boolean,
          expiresAtMs: Number(s.root.policy.expiresAtMs),
          migrationReady,
          pending: s.grants
            .filter((g) => g.state === 'AUTHORIZED')
            .map((g) => ({
              receiptId: g.receipt_id as string,
              grantDigest: surferDigest(g),
              maximum: g.binding.maximum as unknown,
            })),
          blocked:
            !migrationReady ||
            !!rootStillActive ||
            s.registrations.some((r) => r.enabled) ||
            !!s.legacy.length ||
            s.legacyPending ||
            s.overage,
        };
      },
      {
        module: 'surfer.account-authority',
        operation: 'inspect-root-renewal',
        readOnly: true,
        isolationLevel: 'REPEATABLE READ',
      },
    );
  }
  async apply(input: SurferRootRenewalCommand) {
    const r = decodeSurferRootRenewal(input),
      rid = r.config.rootPolicy.rootId,
      requestDigest = surferDigest(r);
    return withSafePostgresTransaction(
      this.pool,
      async (c) => {
        await c.query("SET LOCAL lock_timeout='3s'; SET LOCAL TIME ZONE 'UTC'");
        await c.query(
          'SELECT root_id FROM provider_account.roots WHERE root_id=$1 FOR NO KEY UPDATE',
          [rid],
        );
        const prior = (
          await c.query(
            'SELECT request_digest,request,receipt,receipt_digest FROM provider_account.root_renewal_commands WHERE command_id=$1',
            [r.commandId],
          )
        ).rows[0];
        const s = await this.snapshot(c, rid);
        if (prior) {
          if (
            prior.request_digest !== requestDigest ||
            surferDigest(prior.request) !== requestDigest ||
            surferDigest(prior.receipt) !== prior.receipt_digest
          )
            throw denied();
          const receipt = prior.receipt as SurferRootRenewalReceipt;
          const current = (
            await c.query('SELECT $1::numeric>extract(epoch FROM clock_timestamp())*1000 ready', [
              receipt.expiresAtMs,
            ])
          ).rows[0].ready;
          return {
            receipt,
            replayed: true,
            current:
              !!s.root.enabled && s.root.policy_digest === receipt.afterPolicyDigest && !!current,
          };
        }
        const now = Number(
          (await c.query('SELECT extract(epoch FROM clock_timestamp())*1000 now_ms')).rows[0]
            .now_ms,
        );
        if (
          (
            await c.query(
              'SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()',
            )
          ).rows[0].n !== 0
        )
          throw surferFailure('Root renewal requires all other authority connections to drain.');
        if (
          s.root.policy_digest !== surferDigest(r.config.rootPolicy) ||
          surferDigest(s) !== r.expectedDigest ||
          (s.root.enabled && r.config.rootPolicy.expiresAtMs > now) ||
          s.registrations.some((x) => x.enabled) ||
          s.legacy.length ||
          s.legacyPending ||
          s.overage ||
          r.expiresAtMs <= now ||
          r.expiresAtMs > now + 30 * 86400000
        )
          throw denied();
        assertConfig(s, r.config);
        // A used root is renewed; bootstrap remains the only path for a virgin account.
        if (!s.registrations.length || !s.grants.length || !s.credentials.length) throw denied();
        const pending = s.grants.filter((g) => g.state === 'AUTHORIZED');
        if (
          pending.length !== r.retained.length ||
          pending.some(
            (g) =>
              !r.retained.some(
                (p) => p.receiptId === g.receipt_id && p.grantDigest === surferDigest(g),
              ),
          )
        )
          throw denied();
        const policy = { ...r.config.rootPolicy, expiresAtMs: r.expiresAtMs };
        await c.query(
          'UPDATE provider_account.roots SET policy=$2::jsonb,policy_digest=$3,enabled=true WHERE root_id=$1',
          [rid, JSON.stringify(policy), surferDigest(policy)],
        );
        const after = await this.snapshot(c, rid);
        if (surferDigest({ ...s, root: null }) !== surferDigest({ ...after, root: null }))
          throw surferFailure('Renewal changed account history.');
        const receipt: SurferRootRenewalReceipt = {
          schemaVersion: '1.0.0',
          commandId: r.commandId,
          rootId: rid,
          requestDigest,
          beforeDigest: r.expectedDigest,
          afterDigest: surferDigest(after),
          beforePolicyDigest: s.root.policy_digest,
          afterPolicyDigest: surferDigest(policy),
          expiresAtMs: r.expiresAtMs,
          retained: r.retained,
        };
        await c.query(
          'INSERT INTO provider_account.root_renewal_commands(command_id,root_id,request_digest,after_policy_digest,request,receipt,receipt_digest) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)',
          [
            r.commandId,
            rid,
            requestDigest,
            receipt.afterPolicyDigest,
            JSON.stringify(r),
            JSON.stringify(receipt),
            surferDigest(receipt),
          ],
        );
        for (const g of pending)
          await c.query(
            'INSERT INTO provider_account.retained_unknown_grants(command_id,receipt_id,grant_snapshot) VALUES($1,$2,$3::jsonb)',
            [r.commandId, g.receipt_id, JSON.stringify(g)],
          );
        return { receipt, replayed: false, current: true };
      },
      { module: 'surfer.account-authority', operation: 'operator-root-renewal' },
    );
  }
}
