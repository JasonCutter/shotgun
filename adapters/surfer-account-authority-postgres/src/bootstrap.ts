import type { Pool, PoolClient } from 'pg';
import { withSafePostgresTransaction } from '../../../packages/postgres-transaction/src/index.js';
import {
  decodeSurferAccountAuthorityConfigV2,
  type SurferAccountAuthorityConfigV2,
} from '../../../packages/contracts/src/surfer-account-authority-v2.js';
import {
  decodeSurferAccountBootstrap,
  type SurferAccountBootstrapCommand,
  type SurferAccountBootstrapPort,
  type SurferAccountBootstrapReceipt,
  type SurferAccountBootstrapState,
} from '../../../packages/contracts/src/surfer-account-bootstrap.js';
import { surferDigest, surferFailure } from '../../../packages/contracts/src/surfer-learning.js';
import { assertSurferAccountDatabaseTargets } from './targets.js';
/** Separate operator capability. This is never passed to the application/runtime or browser. */
export class PostgresSurferAccountBootstrap implements SurferAccountBootstrapPort {
  private readonly databaseName: string;
  constructor(
    private readonly pool: Pick<Pool, 'connect'>,
    targets: { workloadDatabaseUrl: string; authorityDatabaseUrl: string },
  ) {
    this.databaseName = assertSurferAccountDatabaseTargets(
      targets.workloadDatabaseUrl,
      targets.authorityDatabaseUrl,
    ).authorityDatabaseName;
  }
  private async assertTarget(c: PoolClient) {
    if ((await c.query('SELECT current_database() AS name')).rows[0].name !== this.databaseName)
      throw surferFailure('Bootstrap authority database target changed.');
  }
  private async snapshot(c: PoolClient, config: SurferAccountAuthorityConfigV2) {
    await this.assertTarget(c);
    const p = config.rootPolicy,
      store = (await c.query('SELECT store_id::text FROM vp_global_budget.authority_store'))
        .rows[0],
      root = (
        await c.query(
          'SELECT root_id::text,store_id::text,policy,policy_digest,enabled FROM provider_account.roots WHERE root_id=$1',
          [p.rootId],
        )
      ).rows[0],
      credential = (
        await c.query(
          'SELECT root_id::text FROM provider_account.credential_accounts WHERE provider=$1 AND credential_fingerprint=$2',
          [p.provider, config.profile.accountFingerprint],
        )
      ).rows[0],
      policies = (
        await c.query(
          'SELECT authority_id::text,provider,account_fingerprint,budget_timezone,daily_limit FROM vp_global_budget.policies WHERE provider=$1 AND account_fingerprint=$2 ORDER BY authority_id LIMIT 65',
          [p.provider, config.profile.accountFingerprint],
        )
      ).rows,
      links = (
        await c.query(
          'SELECT authority_id::text,root_id::text FROM provider_account.legacy_links WHERE root_id=$1 ORDER BY authority_id',
          [p.rootId],
        )
      ).rows;
    if (policies.length > 64)
      throw surferFailure('Bootstrap legacy account review exceeds its bounded scope.');
    const scopeRoot = (
      await c.query(
        "SELECT root_id::text FROM provider_account.roots WHERE policy->>'provider'=$1 AND policy->>'accountScopeId'=$2 LIMIT 1",
        [p.provider, p.accountScopeId],
      )
    ).rows[0];
    const expired =
      Number(
        (await c.query('SELECT extract(epoch FROM clock_timestamp())*1000 AS now')).rows[0].now,
      ) >= p.expiresAtMs;
    const conflict =
      (!!scopeRoot && scopeRoot.root_id !== p.rootId) ||
      (!!store && store.store_id !== p.storeId) ||
      (!!root &&
        (root.store_id !== p.storeId ||
          root.policy_digest !== surferDigest(p) ||
          surferDigest(root.policy) !== root.policy_digest)) ||
      (!!credential && credential.root_id !== p.rootId) ||
      policies.some((x) => x.budget_timezone !== 'UTC');
    const state: SurferAccountBootstrapState = {
      state: conflict
        ? 'CONFLICT'
        : !root
          ? 'ABSENT'
          : expired
            ? 'EXPIRED'
            : root.enabled
              ? 'ACTIVE'
              : 'INACTIVE',
      store: !store ? 'ABSENT' : store.store_id === p.storeId ? 'MATCH' : 'CONFLICT',
      pin: root
        ? surferDigest({ root, credentialRoot: credential?.root_id ?? null, policies, links })
        : null,
      legacyAuthorityIds: policies.map((x) => x.authority_id),
    };
    return { state, root, links };
  }
  async inspect(input: unknown) {
    const config = decodeSurferAccountAuthorityConfigV2(input);
    return withSafePostgresTransaction(
      this.pool,
      async (c) => (await this.snapshot(c, config)).state,
      {
        module: 'surfer.account-authority',
        operation: 'prepare-bootstrap',
        readOnly: true,
        isolationLevel: 'REPEATABLE READ',
      },
    );
  }
  async apply(input: SurferAccountBootstrapCommand) {
    const r = decodeSurferAccountBootstrap(input),
      p = r.config.rootPolicy,
      digest = surferDigest(r);
    return withSafePostgresTransaction(
      this.pool,
      async (c) => {
        await this.assertTarget(c);
        await c.query("SET LOCAL lock_timeout='3s'; SET LOCAL TIME ZONE 'UTC'");
        // Same ordering as existing administrative closeout; no other runtime may be connected.
        await c.query(
          'LOCK TABLE vp_global_budget.daily_usage,vp_global_budget.claims IN ACCESS EXCLUSIVE MODE',
        );
        await c.query(
          'LOCK TABLE vp_global_budget.authority_store,vp_global_budget.policies,provider_account.roots,provider_account.registrations,provider_account.legacy_links,provider_account.grants,provider_account.daily_calls,provider_account.bootstrap_commands IN SHARE ROW EXCLUSIVE MODE',
        );
        let before = await this.snapshot(c, r.config);
        if (before.state.state === 'CONFLICT')
          throw surferFailure('Bootstrap exact store/root/credential binding conflicts.');
        const prior = (
          await c.query(
            'SELECT request_digest,request,receipt FROM provider_account.bootstrap_commands WHERE command_id=$1',
            [r.commandId],
          )
        ).rows[0];
        if (prior) {
          if (prior.request_digest !== digest || surferDigest(prior.request) !== digest)
            throw surferFailure('Bootstrap command identity changed.');
          const receipt = prior.receipt as SurferAccountBootstrapReceipt;
          return {
            receipt: structuredClone(receipt),
            replayed: true,
            current: before.state.pin === receipt.pin && before.state.state !== 'EXPIRED',
          };
        }
        if (
          (
            await c.query(
              'SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()',
            )
          ).rows[0].n !== 0
        )
          throw surferFailure('Bootstrap requires all other authority connections to drain.');
        if (surferDigest(before.state.legacyAuthorityIds) !== surferDigest(r.legacyAuthorityIds))
          throw surferFailure('Bootstrap requires the exact existing legacy authority set.');
        if (
          (
            await c.query(
              "SELECT EXISTS(SELECT 1 FROM vp_global_budget.claims WHERE authority_id=ANY($1::uuid[]) AND state='RESERVED') OR EXISTS(SELECT 1 FROM provider_account.grants WHERE root_id=$2) OR EXISTS(SELECT 1 FROM provider_account.registrations WHERE root_id=$2) AS unsafe",
              [r.legacyAuthorityIds, p.rootId],
            )
          ).rows[0].unsafe
        )
          throw surferFailure(
            'Bootstrap refuses existing registrations,grants or pending legacy work.',
          );
        const now = Number(
          (await c.query('SELECT extract(epoch FROM clock_timestamp())*1000 AS now')).rows[0].now,
        );
        if (p.expiresAtMs <= now) throw surferFailure('Bootstrap root policy is already expired.');
        if (r.action === 'INITIALIZE') {
          if (
            before.state.state !== 'ABSENT' ||
            (r.createStore ? before.state.store !== 'ABSENT' : before.state.store !== 'MATCH')
          )
            throw surferFailure('Bootstrap initialize precondition changed.');
          if (r.createStore)
            await c.query('INSERT INTO vp_global_budget.authority_store(store_id) VALUES($1)', [
              p.storeId,
            ]);
          await c.query(
            'INSERT INTO provider_account.roots(root_id,store_id,policy,policy_digest,enabled) VALUES($1,$2,$3::jsonb,$4,false)',
            [p.rootId, p.storeId, JSON.stringify(p), surferDigest(p)],
          );
          await c.query('SELECT provider_account.pin_credential($1,$2,$3)', [
            p.provider,
            r.config.profile.accountFingerprint,
            p.rootId,
          ]);
          for (const aid of r.legacyAuthorityIds)
            await c.query(
              'INSERT INTO provider_account.legacy_links(authority_id,root_id) VALUES($1,$2)',
              [aid, p.rootId],
            );
        } else {
          const init = (
            await c.query(
              "SELECT request FROM provider_account.bootstrap_commands WHERE root_id=$1 AND action='INITIALIZE' LIMIT 2",
              [p.rootId],
            )
          ).rows;
          if (
            before.state.state !== 'INACTIVE' ||
            before.state.pin !== r.expected ||
            init.length !== 1 ||
            surferDigest(init[0].request.config) !== surferDigest(r.config) ||
            surferDigest(before.links.map((x) => x.authority_id)) !==
              surferDigest(r.legacyAuthorityIds)
          )
            throw surferFailure('Bootstrap activation requires the exact prepared inactive root.');
          await c.query('UPDATE provider_account.roots SET enabled=true WHERE root_id=$1', [
            p.rootId,
          ]);
        }
        before = await this.snapshot(c, r.config);
        const receipt: SurferAccountBootstrapReceipt = {
          schemaVersion: '1.0.0',
          commandId: r.commandId,
          requestDigest: digest,
          rootId: p.rootId,
          storeId: p.storeId,
          action: r.action,
          pin: before.state.pin!,
          enabled: before.state.state === 'ACTIVE',
        };
        await c.query(
          'INSERT INTO provider_account.bootstrap_commands(command_id,root_id,action,request_digest,request,receipt) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)',
          [r.commandId, p.rootId, r.action, digest, JSON.stringify(r), JSON.stringify(receipt)],
        );
        return { receipt, replayed: false, current: true };
      },
      { module: 'surfer.account-authority', operation: 'operator-bootstrap' },
    );
  }
}
