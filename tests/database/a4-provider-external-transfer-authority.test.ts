import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresProviderExternalTransferApprovalRepository } from '../../adapters/provider-privacy-deployment-postgres/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import {
  ProviderExternalTransferApprovalService,
  evaluateProviderExternalTransfer,
  parseProviderDeploymentCeiling,
} from '../../modules/provider-privacy-policy/src/index.js';
import { initialProviderRegistry } from '../../modules/ai-configuration/src/index.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';
import { migrateUpTo } from '../../scripts/database.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool = createPostgresPool(databaseUrl);

const createProjectWithOwner = async (prefix: string) => {
  const projectId = `a4-${prefix}-${randomUUID().slice(0, 8)}`;
  const principalId = randomUUID();
  await pool.query(
    `INSERT INTO auth.principals
       (principal_id, actor_type, status, account_id, created_at)
     VALUES ($1, 'user', 'active', $2, now())`,
    [principalId, `a4-account-${principalId.slice(0, 8)}`],
  );
  await pool.query(
    `INSERT INTO project_admin.projects
       (id, name, status, active, created_at, updated_at, revision)
     VALUES ($1, $1, 'ACTIVE', true, now(), now(), 1)`,
    [projectId],
  );
  await pool.query(
    `INSERT INTO auth.project_memberships
       (principal_id, project_id, scopes, sensitivity_clearance, is_owner)
     VALUES ($1, $2, ARRAY['owner'], 'private', true)`,
    [principalId, projectId],
  );
  return { projectId, principalId };
};

describe('A4 provider external transfer authority PostgreSQL persistence', () => {
  beforeAll(async () => {
    await migrateUpTo(undefined, databaseUrl);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('adds provider/project authority without rewriting historical Settings and preserves immutable history', async () => {
    const { projectId, principalId } = await createProjectWithOwner('history');
    const repository = new PostgresProviderExternalTransferApprovalRepository(pool);
    const service = new ProviderExternalTransferApprovalService(
      repository,
      initialProviderRegistry(),
    );

    const proposal = await service.propose({
      projectId,
      providerId: 'openai',
      approved: true,
      expectedApprovalRevision: 0,
      proposedBy: principalId,
    });
    expect(await service.getCurrent(projectId, 'openai')).toBeUndefined();
    const approval = await service.approve({
      proposalId: proposal.proposalId,
      projectId,
      providerId: 'openai',
      expectedApprovalRevision: 0,
      reviewedBy: principalId,
    });

    expect(approval).toMatchObject({
      projectId,
      providerId: 'openai',
      approved: true,
      approvalRevision: 1,
      reviewedBy: principalId,
    });
    expect(await service.listHistory(projectId, 'openai')).toHaveLength(1);
    expect(await service.getCurrent(projectId, 'deepseek')).toBeUndefined();
    expect(
      await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM settings.settings_audit_events
         WHERE project_id = $1
           AND action_name IN ('PROVIDER_EXTERNAL_TRANSFER_REVIEW_PROPOSED', 'PROVIDER_EXTERNAL_TRANSFER_REVIEW_APPROVED')`,
        [projectId],
      ),
    ).toMatchObject({ rows: [{ count: '2' }] });
    await expect(
      pool.query(
        `UPDATE settings.provider_external_transfer_approval_revisions
         SET approved = false
         WHERE project_id = $1 AND provider_id = 'openai' AND approval_revision = 1`,
        [projectId],
      ),
    ).rejects.toThrow(/append-only|immutable/);
  });

  it('isolates Project/provider approvals and never applies legacy Gemini approval to another provider', async () => {
    const { projectId, principalId } = await createProjectWithOwner('isolation');
    const repository = new PostgresProviderExternalTransferApprovalRepository(pool);
    const service = new ProviderExternalTransferApprovalService(
      repository,
      initialProviderRegistry(),
    );
    const proposal = await service.propose({
      projectId,
      providerId: 'google-gemini',
      approved: false,
      expectedApprovalRevision: 0,
      proposedBy: principalId,
    });
    await service.approve({
      proposalId: proposal.proposalId,
      projectId,
      providerId: 'google-gemini',
      expectedApprovalRevision: 0,
      reviewedBy: principalId,
    });

    const deployment = parseProviderDeploymentCeiling({
      providerAllowlist: 'openai,google-gemini',
    });
    expect(
      evaluateProviderExternalTransfer({
        providerId: 'openai',
        sensitivity: 'private',
        deployment,
        legacyExternalTransferAllowed: true,
      }),
    ).toMatchObject({ eligible: false, reason: 'PROJECT_APPROVAL_REQUIRED' });
    expect(
      evaluateProviderExternalTransfer({
        providerId: 'google-gemini',
        sensitivity: 'private',
        deployment,
        legacyExternalTransferAllowed: true,
        approval: await service.getCurrent(projectId, 'google-gemini'),
      }),
    ).toMatchObject({ eligible: false, reason: 'PROJECT_APPROVAL_REQUIRED' });
    expect(await service.getCurrent(`other-${projectId}`, 'google-gemini')).toBeUndefined();
  });

  it('fails closed on stale and concurrent approvals while keeping one current revision', async () => {
    const { projectId, principalId } = await createProjectWithOwner('cas');
    const repository = new PostgresProviderExternalTransferApprovalRepository(pool);
    const service = new ProviderExternalTransferApprovalService(
      repository,
      initialProviderRegistry(),
    );
    const first = await service.propose({
      projectId,
      providerId: 'deepseek',
      approved: true,
      expectedApprovalRevision: 0,
      proposedBy: principalId,
    });
    const second = await service.propose({
      projectId,
      providerId: 'deepseek',
      approved: false,
      expectedApprovalRevision: 0,
      proposedBy: principalId,
    });
    const results = await Promise.allSettled([
      service.approve({
        proposalId: first.proposalId,
        projectId,
        providerId: 'deepseek',
        expectedApprovalRevision: 0,
        reviewedBy: principalId,
      }),
      service.approve({
        proposalId: second.proposalId,
        projectId,
        providerId: 'deepseek',
        expectedApprovalRevision: 0,
        reviewedBy: principalId,
      }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await service.getCurrent(projectId, 'deepseek')).toMatchObject({ approvalRevision: 1 });
    await expect(
      service.approve({
        proposalId: first.proposalId,
        projectId,
        providerId: 'deepseek',
        expectedApprovalRevision: 0,
        reviewedBy: principalId,
      }),
    ).rejects.toMatchObject({ code: 'PROPOSAL_STALE' });
  });
});
