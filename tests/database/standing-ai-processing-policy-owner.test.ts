import { randomUUID } from 'node:crypto';

import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresProviderExternalTransferApprovalRepository } from '../../adapters/provider-privacy-deployment-postgres/src/index.js';
import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { PostgresStandingAIProcessingPolicyRepository } from '../../adapters/project-standing-ai-policy-postgres/src/index.js';
import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import { initialProviderRegistry } from '../../modules/ai-configuration/src/index.js';
import { ProviderExternalTransferApprovalService } from '../../modules/provider-privacy-policy/src/index.js';
import type { AISettingsBackendPort } from '../../modules/ai-settings-backend/src/index.js';
import { StandingAIProcessingPolicyService } from '../../packages/policy/src/index.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool: Pool = createPostgresPool(databaseUrl);

const createFixture = async () => {
  const suffix = randomUUID();
  const projectId = `standing-policy-${suffix}`;
  const ownerPrincipalId = randomUUID();
  const adminPrincipalId = randomUUID();
  const createdAt = new Date(Date.now() - 1_000);

  await pool.query(
    `INSERT INTO project_admin.projects
       (id, name, status, active, created_at, updated_at, revision)
     VALUES ($1, $2, 'ACTIVE', true, $3, $3, 1)`,
    [projectId, `Standing Policy ${suffix}`, createdAt],
  );
  await pool.query(
    `INSERT INTO auth.principals
       (principal_id, actor_type, status, account_id, created_at)
     VALUES
       ($1, 'user', 'active', $3, $4),
       ($2, 'user', 'active', $5, $4)`,
    [
      ownerPrincipalId,
      adminPrincipalId,
      `standing-owner-${suffix}`,
      createdAt,
      `standing-admin-${suffix}`,
    ],
  );
  await pool.query(
    `INSERT INTO auth.project_memberships
       (principal_id, project_id, scopes, sensitivity_clearance, is_owner)
     VALUES
       ($1, $3, ARRAY['owner'], 'private', true),
       ($2, $3, ARRAY['admin'], 'private', false)`,
    [ownerPrincipalId, adminPrincipalId, projectId],
  );
  await pool.query(
    `INSERT INTO ai.project_standing_ai_processing_policy_revisions
       (project_id, enabled, provider_id, policy_revision,
        ai_configuration_revision, changed_by, changed_at)
     VALUES ($1, false, 'deepseek', 1, 0, $2, $3)`,
    [projectId, ownerPrincipalId, createdAt],
  );
  await pool.query(
    `INSERT INTO ai.project_standing_ai_processing_policies
       (project_id, enabled, provider_id, policy_revision,
        ai_configuration_revision, changed_by, changed_at)
     VALUES ($1, false, 'deepseek', 1, 0, $2, $3)`,
    [projectId, ownerPrincipalId, createdAt],
  );

  const approvalService = new ProviderExternalTransferApprovalService(
    new PostgresProviderExternalTransferApprovalRepository(pool),
    initialProviderRegistry(),
  );
  const rejectionProposal = await approvalService.propose({
    projectId,
    providerId: 'deepseek',
    approved: false,
    expectedApprovalRevision: 0,
    proposedBy: ownerPrincipalId,
  });
  await approvalService.approve({
    proposalId: rejectionProposal.proposalId,
    projectId,
    providerId: 'deepseek',
    expectedApprovalRevision: 0,
    reviewedBy: ownerPrincipalId,
  });

  return { projectId, ownerPrincipalId, adminPrincipalId, approvalService };
};

const sessionHeaders = async (
  app: Awaited<ReturnType<typeof createApplication>>,
  auth: PostgresAuthRepository,
  principalId: string,
  projectId: string,
) => {
  const session = await auth.createSession(
    principalId,
    projectId,
    new Date(Date.now() + 60_000).toISOString(),
  );
  const cookie = `shotgun_session=${session.sessionToken}`;
  const csrfResponse = await app.server.inject({
    method: 'GET',
    url: '/api/v1/security/csrf',
    headers: { cookie },
  });
  expect(csrfResponse.statusCode).toBe(200);
  const csrfToken = (csrfResponse.json() as { csrfToken: string }).csrfToken;
  return {
    cookie,
    'x-csrf-token': csrfToken,
    'content-type': 'application/json',
  };
};

describe('Standing AI processing policy Project Owner authority', () => {
  beforeAll(async () => {
    await migrateUpTo(undefined, databaseUrl);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('rejects admin-only writes and persists one owner revision', async () => {
    const fixture = await createFixture();
    const auth = new PostgresAuthRepository(pool);
    const standingPolicy = new StandingAIProcessingPolicyService(
      new PostgresStandingAIProcessingPolicyRepository(pool),
    );
    const backend = {
      saveStandingPolicy: (input: Parameters<AISettingsBackendPort['saveStandingPolicy']>[0]) =>
        standingPolicy.save(input),
    } as unknown as AISettingsBackendPort;
    const app = await createApplication({ authRepository: auth, aiSettingsBackend: backend });

    try {
      const adminResponse = await app.server.inject({
        method: 'POST',
        url: '/api/v1/settings/ai/standing-policy',
        headers: await sessionHeaders(app, auth, fixture.adminPrincipalId, fixture.projectId),
        payload: {
          projectId: fixture.projectId,
          expectedRevision: 1,
          enabled: true,
          providerId: 'deepseek',
          aiConfigurationRevision: 7,
        },
      });
      expect(adminResponse.statusCode).toBe(403);
      expect(adminResponse.json()).toMatchObject({ code: 'PROJECT_ACCESS_DENIED' });

      const deniedState = await pool.query<{ count: string; policy_revision: number }>(
        `SELECT
           (SELECT count(*)::text
              FROM ai.project_standing_ai_processing_policy_revisions
             WHERE project_id = $1) AS count,
           (SELECT policy_revision
              FROM ai.project_standing_ai_processing_policies
             WHERE project_id = $1) AS policy_revision`,
        [fixture.projectId],
      );
      expect(deniedState.rows[0]).toEqual({ count: '1', policy_revision: 1 });
      expect(
        await pool.query(
          `SELECT count(*)::text AS count
           FROM settings.settings_audit_events
           WHERE project_id = $1
             AND action_name = 'PROJECT_STANDING_AI_PROCESSING_POLICY_CHANGED'`,
          [fixture.projectId],
        ),
      ).toMatchObject({ rows: [{ count: '0' }] });

      const ownerResponse = await app.server.inject({
        method: 'POST',
        url: '/api/v1/settings/ai/standing-policy',
        headers: await sessionHeaders(app, auth, fixture.ownerPrincipalId, fixture.projectId),
        payload: {
          projectId: fixture.projectId,
          expectedRevision: 1,
          enabled: true,
          providerId: 'deepseek',
          aiConfigurationRevision: 7,
        },
      });
      expect(ownerResponse.statusCode).toBe(200);
      expect(ownerResponse.json()).toMatchObject({
        standingPolicy: {
          projectId: fixture.projectId,
          enabled: true,
          providerId: 'deepseek',
          policyRevision: 2,
          aiConfigurationRevision: 7,
          changedBy: fixture.ownerPrincipalId,
        },
      });

      const current = await pool.query<{
        enabled: boolean;
        provider_id: string;
        policy_revision: number;
        ai_configuration_revision: number;
        changed_by: string;
      }>(
        `SELECT enabled, provider_id, policy_revision,
                ai_configuration_revision, changed_by
           FROM ai.project_standing_ai_processing_policies
          WHERE project_id = $1`,
        [fixture.projectId],
      );
      expect(current.rows[0]).toEqual({
        enabled: true,
        provider_id: 'deepseek',
        policy_revision: 2,
        ai_configuration_revision: 7,
        changed_by: fixture.ownerPrincipalId,
      });
      expect(
        await pool.query<{ count: string }>(
          `SELECT count(*)::text AS count
             FROM ai.project_standing_ai_processing_policy_revisions
            WHERE project_id = $1`,
          [fixture.projectId],
        ),
      ).toMatchObject({ rows: [{ count: '2' }] });

      const audit = await pool.query<{ risk_level: string; details: Record<string, unknown> }>(
        `SELECT risk_level, details
           FROM settings.settings_audit_events
          WHERE project_id = $1
            AND action_name = 'PROJECT_STANDING_AI_PROCESSING_POLICY_CHANGED'`,
        [fixture.projectId],
      );
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0]).toEqual({
        risk_level: 'HIGH',
        details: {
          enabled: true,
          providerId: 'deepseek',
          policyRevision: 2,
          aiConfigurationRevision: 7,
        },
      });
      expect(JSON.stringify(audit.rows[0])).not.toMatch(/secret|credential|api.?key/i);

      const conflictResponse = await app.server.inject({
        method: 'POST',
        url: '/api/v1/settings/ai/standing-policy',
        headers: await sessionHeaders(app, auth, fixture.ownerPrincipalId, fixture.projectId),
        payload: {
          projectId: fixture.projectId,
          expectedRevision: 1,
          enabled: false,
          providerId: 'deepseek',
          aiConfigurationRevision: 7,
        },
      });
      expect(conflictResponse.statusCode).toBe(409);
      expect(conflictResponse.json()).toMatchObject({ code: 'CONFLICT' });
      expect(
        await pool.query<{ count: string }>(
          `SELECT count(*)::text AS count
             FROM ai.project_standing_ai_processing_policy_revisions
            WHERE project_id = $1`,
          [fixture.projectId],
        ),
      ).toMatchObject({ rows: [{ count: '2' }] });

      await expect(
        pool.query(
          `UPDATE ai.project_standing_ai_processing_policy_revisions
              SET enabled = false
            WHERE project_id = $1 AND policy_revision = 2`,
          [fixture.projectId],
        ),
      ).rejects.toThrow(/append-only and immutable/);

      expect(await fixture.approvalService.getCurrent(fixture.projectId, 'deepseek')).toMatchObject(
        {
          approved: false,
          approvalRevision: 1,
        },
      );
    } finally {
      await app.server.close();
    }
  });
});
