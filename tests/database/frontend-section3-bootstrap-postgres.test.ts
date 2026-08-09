import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import { PostgresFrontendCommandGateway } from '../../adapters/frontend-command-gateway-postgres/src/index.js';
import {
  createPostgresPool,
  PostgresProjectBootstrapUnitOfWork,
} from '../../adapters/postgres/src/index.js';
import { acceptPrincipalProjectCreateCommand } from '../../assemblies/shotgun-app/src/product-api/frontend-command-route.js';
import { hashSecuritySecret } from '../../packages/authentication/src/index.js';
import { dropSchemas, migrateUpTo } from '../../scripts/database.js';

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

afterAll(async () => {
  await pool?.end();
});

const request = (suffix: string) => ({
  envelopeVersion: '2.0.0',
  commandType: 'project.create.v1',
  commandSchemaVersion: '1.0.0',
  clientRequestId: `bootstrap-request-${suffix}`,
  idempotencyKey: `bootstrap-idempotency-${suffix}`,
  projectContext: {
    scope: 'PRINCIPAL',
    observedProjectAccessRevision: '0',
  },
  policyBinding: { mode: 'CURRENT' },
  preconditions: [],
  clientIssuedAt: new Date().toISOString(),
  payload: { name: `Bootstrap ${suffix}` },
});

describe.runIf(pool)('ADR-116 PostgreSQL bootstrap transaction', () => {
  beforeEach(async () => {
    await pool!.query(`
      TRUNCATE
        frontend_command.command_ledger,
        project_admin.project_command_results,
        project_admin.project_commands,
        project_admin.project_revisions,
        project_admin.projects,
        auth.audit_events,
        auth.sessions,
        auth.project_memberships,
        auth.credentials,
        auth.principals
      CASCADE
    `);
  });

  afterEach(async () => {
    await pool!.query(
      'DROP TRIGGER IF EXISTS test_block_settings_revisions_trigger ON settings.settings_revisions',
    );
    await pool!.query('DROP FUNCTION IF EXISTS test_block_settings_revisions()');
  });

  const zeroProjectFixture = async () => {
    const auth = new PostgresAuthRepository(pool!);
    const principal = await auth.bootstrapLocalOwnerPrincipal({
      accountId: `local-owner-${randomUUID()}`,
    });
    const session = await auth.createSession(
      principal.principalId,
      null,
      new Date(Date.now() + 60_000).toISOString(),
    );
    return { auth, principal, session };
  };

  it('persists Project, one Owner, active Session, operation binding, and recoverable outcome', async () => {
    const { auth, principal, session } = await zeroProjectFixture();
    const gateway = new PostgresFrontendCommandGateway(pool!);
    const unitOfWork = new PostgresProjectBootstrapUnitOfWork(pool!);
    const accepted = await acceptPrincipalProjectCreateCommand({
      rawRequest: request('success'),
      principalId: principal.principalId,
      sessionActiveProjectId: null,
      commandGateway: gateway,
    });

    const committed = await unitOfWork.bootstrap({
      commandId: accepted.outcome.commandId,
      clientRequestId: accepted.request.clientRequestId,
      idempotencyKey: accepted.request.idempotencyKey,
      principalId: principal.principalId,
      sessionId: session.sessionId,
      observedProjectAccessRevision: '0',
      payload: accepted.request.payload,
    });
    expect(committed.replayed).toBe(false);
    expect((await auth.findSession(session.sessionToken))?.activeProjectId).toBe(
      committed.project.id,
    );
    expect(await auth.listMemberships(principal.principalId)).toEqual([
      expect.objectContaining({
        projectId: committed.project.id,
        isOwner: true,
      }),
    ]);
    expect(
      await gateway.findByClientRequestId(principal.principalId, accepted.request.clientRequestId),
    ).toMatchObject({ outcomeState: 'ACCEPTED' });

    const recovered = await unitOfWork.findCompleted(accepted.outcome.commandId);
    expect(recovered?.id).toBe(committed.project.id);
    const completed = await gateway.complete({
      commandId: accepted.outcome.commandId,
      producedResources: [
        {
          resourceKind: 'project',
          resourceId: committed.project.id,
          resourceRevision: String(committed.project.revision),
        },
      ],
      completedAt: new Date().toISOString(),
    });
    expect(completed.outcomeState).toBe('COMPLETED');

    const duplicatePrincipalId = randomUUID();
    await pool!.query(
      `INSERT INTO auth.principals (
         principal_id, actor_type, status, account_id, created_at
       ) VALUES ($1, 'user', 'active', $2, now())`,
      [duplicatePrincipalId, `duplicate-owner-${duplicatePrincipalId}`],
    );
    await expect(
      pool!.query(
        `INSERT INTO auth.project_memberships (
           principal_id, project_id, scopes, sensitivity_clearance, is_owner
         ) VALUES ($1, $2, '{owner}', 'private', true)`,
        [duplicatePrincipalId, committed.project.id],
      ),
    ).rejects.toThrow();
  });

  it('rolls back every bootstrap write when a late settings insert fails', async () => {
    const { principal, session } = await zeroProjectFixture();
    // settings history is append-only (migration 032): the historical rows must
    // never be altered or truncated. To force a late settings insert failure
    // without touching existing rows, install a temporary INSERT-blocking
    // trigger for this test only (removed in the same test).
    await pool!.query(`
      CREATE OR REPLACE FUNCTION test_block_settings_revisions()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'test: settings insert blocked';
      END;
      $$ LANGUAGE plpgsql
    `);
    await pool!.query(`
      DROP TRIGGER IF EXISTS test_block_settings_revisions_trigger
        ON settings.settings_revisions
    `);
    await pool!.query(`
      CREATE TRIGGER test_block_settings_revisions_trigger
        BEFORE INSERT ON settings.settings_revisions
        FOR EACH ROW EXECUTE FUNCTION test_block_settings_revisions()
    `);
    const unitOfWork = new PostgresProjectBootstrapUnitOfWork(pool!);
    await expect(
      unitOfWork.bootstrap({
        commandId: randomUUID(),
        clientRequestId: `rollback-request-${randomUUID()}`,
        idempotencyKey: `rollback-idempotency-${randomUUID()}`,
        principalId: principal.principalId,
        sessionId: session.sessionId,
        observedProjectAccessRevision: '0',
        payload: { name: 'Rollback Required' },
      }),
    ).rejects.toThrow();
    await pool!.query(`
      DROP TRIGGER IF EXISTS test_block_settings_revisions_trigger
        ON settings.settings_revisions
    `);
    await pool!.query(`DROP FUNCTION IF EXISTS test_block_settings_revisions()`);

    const counts = await pool!.query<{
      projects: string;
      memberships: string;
      commands: string;
      audits: string;
      active_project_id: string | null;
    }>(
      `
      SELECT
        (SELECT count(*)::text FROM project_admin.projects) AS projects,
        (SELECT count(*)::text FROM auth.project_memberships) AS memberships,
        (SELECT count(*)::text FROM project_admin.project_commands) AS commands,
        (SELECT count(*)::text FROM auth.audit_events) AS audits,
        (SELECT active_project_id FROM auth.sessions WHERE session_id = $1)
          AS active_project_id
    `,
      [session.sessionId],
    );
    expect(counts.rows[0]).toEqual({
      projects: '0',
      memberships: '0',
      commands: '0',
      audits: '0',
      active_project_id: null,
    });
  });

  it('serializes concurrent first-Project attempts so only one can commit', async () => {
    const { principal, session } = await zeroProjectFixture();
    const unitOfWork = new PostgresProjectBootstrapUnitOfWork(pool!);
    const attempts = ['a', 'b'].map((suffix) =>
      unitOfWork.bootstrap({
        commandId: randomUUID(),
        clientRequestId: `concurrent-request-${suffix}`,
        idempotencyKey: `concurrent-idempotency-${suffix}`,
        principalId: principal.principalId,
        sessionId: session.sessionId,
        observedProjectAccessRevision: '0',
        payload: { name: `Concurrent ${suffix}` },
      }),
    );
    const results = await Promise.allSettled(attempts);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await pool!.query('SELECT id FROM project_admin.projects')).toMatchObject({
      rowCount: 1,
    });
    expect(
      await pool!.query(
        'SELECT project_id FROM auth.project_memberships WHERE principal_id = $1 AND is_owner',
        [principal.principalId],
      ),
    ).toMatchObject({ rowCount: 1 });
  });
});

describe.runIf(pool)('ADR-116 Migration 018 to 019 compatibility', () => {
  afterEach(async () => {
    await dropSchemas();
    await migrateUpTo();
  });

  it('backfills V1 scope deterministically, preserves data, and is replay-safe', async () => {
    try {
      await dropSchemas();
      await migrateUpTo('018_frontend_command_request_outcome_contract.sql');
      const principalId = randomUUID();
      const projectId = `migration-project-${randomUUID()}`;
      const sessionId = randomUUID();
      const targetProjectId = `${projectId}-quote-'`;
      await pool!.query(
        `INSERT INTO auth.principals (
           principal_id, actor_type, status, account_id, created_at
         ) VALUES ($1, 'user', 'active', $2, now())`,
        [principalId, `migration-owner-${principalId}`],
      );
      await pool!.query(
        `INSERT INTO auth.project_memberships (
           principal_id, project_id, scopes, sensitivity_clearance, is_owner
         ) VALUES ($1, $2, '{owner}', 'private', true)`,
        [principalId, targetProjectId],
      );
      await pool!.query(
        `INSERT INTO auth.sessions (
           session_id, token_hash, csrf_hash, principal_id, active_project_id,
           expires_at, created_at
         ) VALUES ($1, $2, $3, $4, $5, now() + interval '1 hour', now())`,
        [
          sessionId,
          hashSecuritySecret(randomUUID()),
          hashSecuritySecret(randomUUID()),
          principalId,
          targetProjectId,
        ],
      );
      await pool!.query(
        `INSERT INTO frontend_command.command_ledger (
           command_id, command_revision, client_request_id, idempotency_key,
           principal_id, target_project_id, command_type, command_schema_version,
           command_semantic_digest, policy_binding, accepted_principal_context,
           accepted_project_context, accepted_policy_context, preconditions,
           command_payload, outcome_state, produced_resources, correlation_id,
           trace_id, received_at, accepted_at, last_updated_at
         ) VALUES (
           'migration-command', 1, 'migration-client-request', 'migration-idempotency',
           $1, $2, 'project.update.v1', '1.0.0', 'migration-digest',
           '{"mode":"CURRENT"}', $3, $4, $5, '[]', '{}', 'ACCEPTED', '[]',
           'migration-correlation', 'migration-trace', now(), now(), now()
         )`,
        [
          principalId,
          targetProjectId,
          JSON.stringify({
            principalId,
            actor: { type: 'user', id: principalId },
          }),
          JSON.stringify({ targetProjectId }),
          JSON.stringify({
            policyContextId: `project-policy-context/${targetProjectId}`,
            policyContextRevision: '1',
            acceptedAt: new Date().toISOString(),
          }),
        ],
      );

      await migrateUpTo('019_frontend_section3_principal_bootstrap.sql');
      const migrated = await pool!.query<{
        envelope_version: string;
        scope_kind: string;
        active_project_id: string;
        target_project_id: string;
        scope_binding_key: string;
      }>(
        `SELECT envelope_version, scope_kind, active_project_id,
                target_project_id, scope_binding_key
         FROM frontend_command.command_ledger
         WHERE command_id = 'migration-command'`,
      );
      expect(migrated.rows[0]).toEqual({
        envelope_version: '1.0.0',
        scope_kind: 'PROJECT',
        active_project_id: targetProjectId,
        target_project_id: targetProjectId,
        scope_binding_key: `{"envelopeVersion":"1.0.0","scope":"PROJECT","targetProjectId":${JSON.stringify(targetProjectId)}}`,
      });
      expect(
        await pool!.query(
          `SELECT active_project_id
           FROM auth.sessions
           WHERE session_id = $1`,
          [sessionId],
        ),
      ).toMatchObject({ rows: [{ active_project_id: targetProjectId }] });

      await pool!.query(
        `INSERT INTO frontend_command.command_ledger (
           command_id, command_revision, client_request_id, idempotency_key,
           principal_id, target_project_id, command_type, command_schema_version,
           command_semantic_digest, policy_binding, accepted_principal_context,
           accepted_project_context, accepted_policy_context, preconditions,
           command_payload, outcome_state, produced_resources, correlation_id,
           trace_id, received_at, accepted_at, last_updated_at
         ) VALUES (
           'migration-v1-writer-command', 1, 'migration-v1-client-request',
           'migration-v1-idempotency', $1, $2, 'project.update.v1', '1.0.0',
           'migration-v1-digest', '{"mode":"CURRENT"}', $3, $4, $5, '[]',
           '{}', 'ACCEPTED', '[]', 'migration-v1-correlation',
           'migration-v1-trace', now(), now(), now()
         )`,
        [
          principalId,
          targetProjectId,
          JSON.stringify({
            principalId,
            actor: { type: 'user', id: principalId },
          }),
          JSON.stringify({ targetProjectId }),
          JSON.stringify({
            policyContextId: `project-policy-context/${targetProjectId}`,
            policyContextRevision: '1',
            acceptedAt: new Date().toISOString(),
          }),
        ],
      );
      expect(
        await pool!.query(
          `SELECT envelope_version, scope_kind, active_project_id,
                  target_project_id, scope_binding_key
           FROM frontend_command.command_ledger
           WHERE command_id = 'migration-v1-writer-command'`,
        ),
      ).toMatchObject({
        rows: [
          {
            envelope_version: '1.0.0',
            scope_kind: 'PROJECT',
            active_project_id: targetProjectId,
            target_project_id: targetProjectId,
            scope_binding_key: `{"envelopeVersion":"1.0.0","scope":"PROJECT","targetProjectId":${JSON.stringify(targetProjectId)}}`,
          },
        ],
      });

      await migrateUpTo('019_frontend_section3_principal_bootstrap.sql');
      expect(
        await pool!.query(
          `SELECT count(*)::text AS count
           FROM frontend_command.command_ledger
           WHERE command_id = 'migration-command'`,
        ),
      ).toMatchObject({ rows: [{ count: '1' }] });
    } finally {
      await dropSchemas();
      await migrateUpTo();
    }
  });
});
