import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import { PostgresFrontendCommandGateway } from '../../adapters/frontend-command-gateway-postgres/src/index.js';
import {
  createPostgresPool,
  PostgresProjectAdministrationRepository,
  PostgresSettingsRepository,
} from '../../adapters/postgres/src/index.js';
import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

const commandRequest = (input: {
  readonly commandType: string;
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly expectedRevision?: number;
  readonly payload: Record<string, unknown>;
}) => ({
  envelopeVersion: '1.0.0',
  commandType: input.commandType,
  commandSchemaVersion: '1.0.0',
  clientRequestId: input.clientRequestId,
  idempotencyKey: input.idempotencyKey,
  projectContext: {
    activeProjectId: input.projectId,
    targetProjectId: input.projectId,
    resourceProjectId: input.projectId,
  },
  policyBinding: { mode: 'CURRENT' },
  preconditions:
    input.expectedRevision === undefined
      ? []
      : [
          {
            purpose: 'TARGET',
            subject: { resourceKind: 'project', resourceId: input.projectId },
            expectedRevision: String(input.expectedRevision),
          },
        ],
  clientIssuedAt: new Date().toISOString(),
  payload: input.payload,
});

describe.runIf(pool)('RUS-2-C2 real PostgreSQL Product Project and Discovery regression', () => {
  afterAll(async () => {
    await pool?.end();
  });

  it('creates a secondary Project through Product, switches the Session, and reads Discovery', async () => {
    const suffix = randomUUID();
    const ownerProjectId = `rus2-c2-owner-${suffix}`;
    const secondaryProjectId = `rus2-c2-secondary-${suffix}`;
    const accountId = `rus2-c2-account-${suffix}`;
    const auth = new PostgresAuthRepository(pool!);
    const projects = new PostgresProjectAdministrationRepository(pool!);
    const settings = new PostgresSettingsRepository(pool!);
    const commandGateway = new PostgresFrontendCommandGateway(pool!);
    const principal = await auth.bootstrapLocalOwnerPrincipal({ accountId });
    const ownerProject = await projects.createProject({
      commandId: randomUUID(),
      clientRequestId: `owner-request-${suffix}`,
      idempotencyKey: `owner-idempotency-${suffix}`,
      projectId: ownerProjectId,
      actorPrincipalId: principal.principalId,
      expectedProjectRevision: 0,
      name: 'RUS-2 C2 Owner Project',
    });
    expect(ownerProject).toMatchObject({ id: ownerProjectId, status: 'ACTIVE', active: true });
    const session = await auth.createSession(
      principal.principalId,
      ownerProjectId,
      new Date(Date.now() + 60_000).toISOString(),
    );
    const cookie = `shotgun_session=${session.sessionToken}`;
    const application = await createApplication({
      authRepository: auth,
      projectAdminRepository: projects,
      settingsRepository: settings,
      frontendCommandGateway: commandGateway,
      canonicalProjectionRecoveryIntervalMs: false,
    });

    try {
      const csrf = (
        await application.server.inject({
          method: 'GET',
          url: '/api/v1/security/csrf',
          headers: { cookie },
        })
      ).json<{ csrfToken: string }>().csrfToken;
      const headers = { cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' };

      const created = await application.server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers,
        payload: commandRequest({
          commandType: 'project.create.v1',
          clientRequestId: `secondary-create-request-${suffix}`,
          idempotencyKey: `secondary-create-idempotency-${suffix}`,
          projectId: ownerProjectId,
          payload: {
            newProjectId: secondaryProjectId,
            name: 'RUS-2 C2 Secondary Project',
          },
        }),
      });
      expect(created.statusCode, created.body).toBe(200);
      expect(created.json()).toMatchObject({
        project: { id: secondaryProjectId, status: 'ACTIVE', active: true, revision: 1 },
        outcome: { outcomeState: 'COMPLETED' },
      });
      expect(
        await pool!.query(
          'SELECT status, active, revision FROM project_admin.projects WHERE id = $1',
          [secondaryProjectId],
        ),
      ).toMatchObject({ rows: [{ status: 'ACTIVE', active: true, revision: 1 }] });

      const switched = await application.server.inject({
        method: 'POST',
        url: '/api/v1/session/active-project',
        headers,
        payload: { projectId: secondaryProjectId },
      });
      expect(switched.statusCode, switched.body).toBe(200);
      expect(switched.json()).toMatchObject({
        session: { activeProject: { id: secondaryProjectId } },
      });

      const discoveries = await application.server.inject({
        method: 'POST',
        url: '/product-api/frontend/knowledge/discoveries/list',
        headers,
        payload: { schemaVersion: '1.0.0' },
      });
      expect(discoveries.statusCode, discoveries.body).toBe(200);
      expect(discoveries.json()).toMatchObject({
        result: { projectId: secondaryProjectId, findings: [] },
      });

      const archived = await application.server.inject({
        method: 'POST',
        url: `/api/v1/projects/${secondaryProjectId}/archive`,
        headers,
        payload: commandRequest({
          commandType: 'project.archive.v1',
          clientRequestId: `secondary-archive-request-${suffix}`,
          idempotencyKey: `secondary-archive-idempotency-${suffix}`,
          projectId: secondaryProjectId,
          expectedRevision: 1,
          payload: {},
        }),
      });
      expect(archived.statusCode, archived.body).toBe(200);
      expect(archived.json()).toMatchObject({
        project: { id: secondaryProjectId, status: 'ARCHIVED', active: false, revision: 2 },
      });

      const inactiveDiscovery = await application.server.inject({
        method: 'POST',
        url: '/product-api/frontend/knowledge/discoveries/list',
        headers,
        payload: { schemaVersion: '1.0.0' },
      });
      expect(inactiveDiscovery.statusCode).toBe(403);
      expect(inactiveDiscovery.json()).toMatchObject({ code: 'PROJECT_ACCESS_DENIED' });
    } finally {
      await application.server.close();
      const client = await pool!.connect();
      try {
        await client.query('SET session_replication_role = replica');
        await client.query(
          'DELETE FROM ai.project_standing_ai_processing_policies WHERE project_id IN ($1, $2)',
          [ownerProjectId, secondaryProjectId],
        );
        await client.query(
          'DELETE FROM ai.project_standing_ai_processing_policy_revisions WHERE project_id IN ($1, $2)',
          [ownerProjectId, secondaryProjectId],
        );
        await client.query('SET session_replication_role = origin');
        await client.query(
          `DELETE FROM project_admin.project_command_results
           WHERE command_id IN (SELECT command_id FROM project_admin.project_commands WHERE project_id IN ($1, $2))`,
          [ownerProjectId, secondaryProjectId],
        );
        await client.query(
          'DELETE FROM frontend_command.command_ledger WHERE target_project_id IN ($1, $2)',
          [ownerProjectId, secondaryProjectId],
        );
        await client.query(
          'DELETE FROM project_admin.project_commands WHERE project_id IN ($1, $2)',
          [ownerProjectId, secondaryProjectId],
        );
        await client.query(
          'DELETE FROM project_admin.project_revisions WHERE project_id IN ($1, $2)',
          [ownerProjectId, secondaryProjectId],
        );
        await client.query('DELETE FROM auth.sessions WHERE principal_id = $1', [
          principal.principalId,
        ]);
        await client.query('DELETE FROM auth.project_memberships WHERE project_id IN ($1, $2)', [
          ownerProjectId,
          secondaryProjectId,
        ]);
        await client.query('DELETE FROM project_admin.projects WHERE id IN ($1, $2)', [
          ownerProjectId,
          secondaryProjectId,
        ]);
        await client.query('DELETE FROM auth.principals WHERE principal_id = $1', [
          principal.principalId,
        ]);
      } finally {
        await client.query('SET session_replication_role = origin');
        client.release();
      }
    }
  });
});
