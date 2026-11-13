import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { withSafePostgresTransaction } from '../../../packages/postgres-transaction/src/index.js';
import {
  decodeSurferAccountAuthorityConfigV2,
  type SurferAccountAuthorityConfigV2,
} from '../../../packages/contracts/src/surfer-account-authority-v2.js';
import {
  decodeSurferRegistrationCommand,
  type SurferRegistrationAdminPort,
  type SurferRegistrationCommand,
  type SurferRegistrationPin,
  type SurferRegistrationReceipt,
} from '../../../packages/contracts/src/surfer-account-registration.js';
import { surferDigest, surferFailure } from '../../../packages/contracts/src/surfer-learning.js';

const denied = () =>
  surferFailure('Exact account registration authority/state changed.', 'operator-registration');
const pin = (row: QueryResultRow): SurferRegistrationPin => ({
  registrationId: row.registration_id,
  digest: surferDigest(row),
});
/** Explicit operator credentials only. Never inject this capability into an HTTP/runtime worker. */
export class PostgresSurferRegistrationAdmin implements SurferRegistrationAdminPort {
  constructor(private readonly pool: Pick<Pool, 'connect'>) {}
  private async root(c: PoolClient, config: SurferAccountAuthorityConfigV2, lock: boolean) {
    const row = (
      await c.query(
        `SELECT r.*,extract(epoch FROM clock_timestamp())*1000 AS now_ms,
      EXISTS(SELECT 1 FROM vp_global_budget.authority_store WHERE singleton AND store_id=r.store_id) AS store_present
      FROM provider_account.roots r WHERE root_id=$1${lock ? ' FOR NO KEY UPDATE OF r' : ''}`,
        [config.rootPolicy.rootId],
      )
    ).rows[0];
    if (
      !row ||
      !row.store_present ||
      row.store_id !== config.rootPolicy.storeId ||
      row.policy_digest !== surferDigest(config.rootPolicy) ||
      surferDigest(row.policy) !== row.policy_digest
    )
      throw denied();
    return row;
  }
  private async active(c: PoolClient, rootId: string, projectId: string) {
    const rows = (
      await c.query(
        `SELECT registration_id::text,root_id::text,profile,profile_digest,identity_digest,
      project_ids,access_scopes,runtime_role::text,expires_at::text,enabled FROM provider_account.registrations
      WHERE root_id=$1 AND enabled AND $2=ANY(project_ids) ORDER BY registration_id`,
        [rootId, projectId],
      )
    ).rows;
    if (
      rows.length > 1 ||
      rows.some(
        (r) =>
          r.project_ids.length !== 1 ||
          r.project_ids[0] !== projectId ||
          r.access_scopes.length !== 1 ||
          r.access_scopes[0] !== 'owner' ||
          r.runtime_role !== 'shotgun_runtime' ||
          surferDigest(r.profile) !== r.profile_digest ||
          surferDigest(r.profile.identity) !== r.identity_digest,
      )
    )
      throw denied();
    return rows[0];
  }
  async inspect(input: unknown, projectId: string) {
    const config = decodeSurferAccountAuthorityConfigV2(input);
    if (typeof projectId !== 'string' || !projectId.trim() || projectId.length > 256)
      throw denied();
    return withSafePostgresTransaction(
      this.pool,
      async (c) => {
        await c.query("SET LOCAL TIME ZONE 'UTC'");
        const root = await this.root(c, config, false),
          row = await this.active(c, config.rootPolicy.rootId, projectId);
        // SQL compares full PostgreSQL precision; Date conversion never defines a CAS pin.
        const ready = row
          ? ((
              await c.query(
                'SELECT $1::boolean AND $2::numeric>extract(epoch FROM clock_timestamp())*1000 AND $3::timestamptz>clock_timestamp() AS ready',
                [root.enabled, config.rootPolicy.expiresAtMs, row.expires_at],
              )
            ).rows[0].ready as boolean)
          : false;
        return { pin: row ? pin(row) : null, expiresAt: row?.expires_at ?? null, ready };
      },
      {
        module: 'surfer.account-authority',
        operation: 'inspect-registration',
        readOnly: true,
        isolationLevel: 'REPEATABLE READ',
      },
    );
  }
  async apply(input: SurferRegistrationCommand) {
    const r = decodeSurferRegistrationCommand(input),
      config = r.config,
      rid = config.rootPolicy.rootId,
      digest = surferDigest(r);
    return withSafePostgresTransaction(
      this.pool,
      async (c) => {
        await c.query("SET LOCAL lock_timeout='3s'; SET LOCAL TIME ZONE 'UTC'");
        const root = await this.root(c, config, true);
        root.now_ms = (
          await c.query('SELECT extract(epoch FROM clock_timestamp())*1000 AS now_ms')
        ).rows[0].now_ms;
        const prior = (
          await c.query(
            'SELECT request_digest,request,receipt FROM provider_account.registration_commands WHERE command_id=$1',
            [r.commandId],
          )
        ).rows[0];
        if (prior) {
          if (prior.request_digest !== digest || surferDigest(prior.request) !== digest)
            throw denied();
          const row = await this.active(c, rid, r.projectId);
          const current =
            r.action === 'REVOKE'
              ? !row
              : !!row &&
                surferDigest(pin(row)) ===
                  surferDigest((prior.receipt as SurferRegistrationReceipt).registration) &&
                root.enabled &&
                Number(root.now_ms) < config.rootPolicy.expiresAtMs &&
                (
                  await c.query('SELECT $1::timestamptz>clock_timestamp() AS ready', [
                    row.expires_at,
                  ])
                ).rows[0].ready;
          return {
            receipt: structuredClone(prior.receipt) as SurferRegistrationReceipt,
            replayed: true,
            current: !!current,
          };
        }
        if (
          (
            await c.query(
              'SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()',
            )
          ).rows[0].n !== 0
        )
          throw surferFailure(
            'Registration changes require all other authority connections to drain.',
          );
        const row = await this.active(c, rid, r.projectId),
          before = row ? pin(row) : null;
        if (surferDigest(before) !== surferDigest(r.expected)) throw denied();
        if (
          r.action === 'REVOKE' &&
          (!row ||
            row.registration_id !== config.registrationId ||
            row.profile_digest !== surferDigest(config.profile))
        )
          throw denied();
        if (r.action === 'PUBLISH') {
          if (
            !root.enabled ||
            Number(root.now_ms) >= config.rootPolicy.expiresAtMs ||
            r.expiresAtMs! <= Number(root.now_ms)
          )
            throw denied();
          const retentionAvailable = (
            await c.query(
              "SELECT to_regclass('provider_account.retained_unknown_grants') IS NOT NULL AND to_regclass('provider_account.root_renewal_commands') IS NOT NULL AS ready",
            )
          ).rows[0].ready;
          const unsafe = (
            await c.query(
              retentionAvailable
                ? `SELECT EXISTS(SELECT 1 FROM provider_account.grants g WHERE root_id=$1 AND state='AUTHORIZED' AND NOT EXISTS(
                SELECT 1 FROM provider_account.retained_unknown_grants h JOIN provider_account.root_renewal_commands c ON c.command_id=h.command_id
                WHERE h.receipt_id=g.receipt_id AND h.grant_snapshot=to_jsonb(g) AND c.root_id=g.root_id AND c.after_policy_digest=$2
              ))
          OR EXISTS(SELECT 1 FROM provider_account.grants g,jsonb_each(g.usage) x WHERE g.root_id=$1 AND NOT g.overage_resolved AND (x.value::text)::numeric>(g.binding->'maximum'->>x.key)::numeric) AS unsafe`
                : `SELECT EXISTS(SELECT 1 FROM provider_account.grants WHERE root_id=$1 AND state='AUTHORIZED') OR EXISTS(SELECT 1 FROM provider_account.grants g,jsonb_each(g.usage) x WHERE g.root_id=$1 AND NOT g.overage_resolved AND (x.value::text)::numeric>(g.binding->'maximum'->>x.key)::numeric) AS unsafe`,
              retentionAvailable ? [rid, root.policy_digest] : [rid],
            )
          ).rows[0].unsafe;
          if (unsafe)
            throw surferFailure(
              'Unsettled or unresolved account grants prevent a new registration.',
            );
          if (
            (
              await c.query(
                'SELECT 1 FROM provider_account.registrations WHERE registration_id=$1',
                [config.registrationId],
              )
            ).rowCount
          )
            throw denied();
        }
        if (row)
          await c.query(
            'UPDATE provider_account.registrations SET enabled=false WHERE registration_id=$1',
            [row.registration_id],
          );
        if (r.action === 'PUBLISH')
          await c.query(
            `INSERT INTO provider_account.registrations(registration_id,root_id,profile,profile_digest,identity_digest,project_ids,access_scopes,runtime_role,expires_at,enabled)
        VALUES($1,$2,$3::jsonb,$4,$5,$6,ARRAY['owner'],'shotgun_runtime',$7::timestamptz,true)`,
            [
              config.registrationId,
              rid,
              JSON.stringify(config.profile),
              surferDigest(config.profile),
              surferDigest(config.profile.identity),
              [r.projectId],
              new Date(r.expiresAtMs!).toISOString(),
            ],
          );
        const next = await this.active(c, rid, r.projectId),
          after = next ? pin(next) : before!;
        const receipt: SurferRegistrationReceipt = {
          schemaVersion: '1.0.0',
          commandId: r.commandId,
          requestDigest: digest,
          rootId: rid,
          projectId: r.projectId,
          action: r.action,
          registration: after,
          previous: before,
        };
        await c.query(
          'INSERT INTO provider_account.registration_commands(command_id,root_id,project_id,request_digest,request,receipt) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)',
          [r.commandId, rid, r.projectId, digest, JSON.stringify(r), JSON.stringify(receipt)],
        );
        return { receipt, replayed: false, current: true };
      },
      { module: 'surfer.account-authority', operation: 'operator-registration' },
    );
  }
}
