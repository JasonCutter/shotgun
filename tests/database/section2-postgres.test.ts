import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import { PostgresFrontendCommandGateway } from '../../adapters/frontend-command-gateway-postgres/src/index.js';
import {
  createPostgresPool,
  PostgresProjectAdministrationRepository,
  PostgresSettingsRepository,
} from '../../adapters/postgres/src/index.js';
import { FrontendContractError } from '../../packages/contracts/src/index.js';
import type { FrontendCommandRequest } from '../../packages/contracts/src/index.js';

import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

describe.runIf(pool)('Persistent PostgreSQL Section 2 Settings & Project Administration', () => {
  let projectAdminRepo: PostgresProjectAdministrationRepository;
  let settingsRepo: PostgresSettingsRepository;
  let authRepo: PostgresAuthRepository;
  let commandGateway: PostgresFrontendCommandGateway;

  beforeEach(async () => {
    const client = await pool!.connect();
    try {
      // The standing-policy tables are test-owned immutable history. The
      // current pointer is protected by a production DELETE trigger, so use
      // the same test-only trigger bypass used by other immutable-history
      // cleanup helpers, then restore normal trigger/FK enforcement before
      // deleting the parent Project.
      await client.query('SET session_replication_role = replica');
      await client.query(`
        DELETE FROM ai.project_standing_ai_processing_policies WHERE project_id LIKE 'pg-proj-%';
        DELETE FROM ai.project_standing_ai_processing_policy_revisions WHERE project_id LIKE 'pg-proj-%';
      `);
      await client.query('SET session_replication_role = origin');
      await client.query(`
        DELETE FROM project_admin.project_command_results WHERE command_id IN (SELECT command_id FROM project_admin.project_commands WHERE project_id LIKE 'pg-proj-%');
        DELETE FROM frontend_command.command_ledger WHERE target_project_id LIKE 'pg-proj-%';
        DELETE FROM project_admin.project_commands WHERE project_id LIKE 'pg-proj-%';
        DELETE FROM project_admin.project_revisions WHERE project_id LIKE 'pg-proj-%';
        -- settings history sources are append-only and must NOT be truncated or
        -- deleted (migration 032 immutability guard: UPDATE/DELETE/TRUNCATE all
        -- forbidden). Each test uses a unique project prefix ('pg-proj-%'), so
        -- historical rows are isolated and left for the full DB reset boundary.
        DELETE FROM settings.settings_command_results WHERE command_id IN (SELECT command_id FROM settings.settings_commands WHERE project_id LIKE 'pg-proj-%');
        DELETE FROM settings.settings_commands WHERE project_id LIKE 'pg-proj-%';
        DELETE FROM settings.project_settings WHERE project_id LIKE 'pg-proj-%';
        DELETE FROM auth.project_memberships WHERE project_id LIKE 'pg-proj-%';
        DELETE FROM project_admin.projects WHERE id LIKE 'pg-proj-%';
      `);
    } finally {
      await client.query('SET session_replication_role = origin');
      client.release();
    }
    projectAdminRepo = new PostgresProjectAdministrationRepository(pool!);
    settingsRepo = new PostgresSettingsRepository(pool!);
    authRepo = new PostgresAuthRepository(pool!);
    commandGateway = new PostgresFrontendCommandGateway(pool!);
  });

  afterAll(async () => {
    await pool!.end();
  });

  it('atomically creates a new project, initial revision, and owner membership in PostgreSQL', async () => {
    const projId = `pg-proj-${randomUUID().slice(0, 8)}`;
    const actorId = randomUUID();

    await pool!.query(
      'INSERT INTO auth.principals (principal_id, actor_type, status, account_id, created_at) VALUES ($1, $2, $3, $4, now())',
      [actorId, 'user', 'active', `user-${actorId.slice(0, 8)}`],
    );

    const project = await projectAdminRepo.createProject({
      commandId: randomUUID(),
      clientRequestId: `req-${randomUUID()}`,
      idempotencyKey: `idem-${randomUUID()}`,
      projectId: projId,
      actorPrincipalId: actorId,
      expectedProjectRevision: 0,
      name: 'Persistent Test Project',
      description: 'Testing PostgreSQL Persistence',
    });

    expect(project.id).toBe(projId);
    expect(project.name).toBe('Persistent Test Project');
    expect(project.status).toBe('ACTIVE');
    expect(project.revision).toBe(1);

    // Verify initial settings snapshot
    const snapshot = await settingsRepo.getSettingsSnapshot(projId);
    expect(snapshot.targetProjectId).toBe(projId);
    expect(snapshot.settingsRevision).toBe(1);
    expect(snapshot.policyContextRevision).toBe(1);

    // Verify owner membership
    const membership = await authRepo.findMembership(actorId, projId);
    expect(membership).not.toBeNull();
    expect(membership?.isOwner).toBe(true);
  });

  it('applies settings command, increments revisions, and persists across repository re-instantiation', async () => {
    const projId = `pg-proj-${randomUUID().slice(0, 8)}`;
    const actorId = randomUUID();

    await pool!.query(
      'INSERT INTO auth.principals (principal_id, actor_type, status, account_id, created_at) VALUES ($1, $2, $3, $4, now())',
      [actorId, 'user', 'active', `user-${actorId.slice(0, 8)}`],
    );

    await projectAdminRepo.createProject({
      commandId: randomUUID(),
      clientRequestId: `req-${randomUUID()}`,
      idempotencyKey: `idem-${randomUUID()}`,
      projectId: projId,
      actorPrincipalId: actorId,
      expectedProjectRevision: 0,
      name: 'Persistence Check',
    });

    const cmdResult = await settingsRepo.applySettingsCommand({
      commandId: randomUUID(),
      clientRequestId: `req-cmd-${randomUUID()}`,
      idempotencyKey: `idem-cmd-${randomUUID()}`,
      projectId: projId,
      expectedSettingsRevision: 1,
      observedPolicyContextRevision: 1,
      settings: { 'general.locale': 'ko-KR', 'costs.monthlyHardLimitUsd': 250 },
      actorId,
    });

    expect(cmdResult.status).toBe('APPLIED');
    expect(cmdResult.appliedRevision).toBe(2);

    // Restart Persistence check: Instantiate fresh repositories against same pool
    const newSettingsRepo = new PostgresSettingsRepository(pool!);
    const newProjectAdminRepo = new PostgresProjectAdministrationRepository(pool!);

    const snapshotAfter = await newSettingsRepo.getSettingsSnapshot(projId);
    expect(snapshotAfter.settingsRevision).toBe(2);
    expect(snapshotAfter.policyContextRevision).toBe(2);

    const localeSetting = snapshotAfter.settings.find((s) => s.key === 'general.locale');
    expect(localeSetting?.currentValue).toBe('ko-KR');

    const projectDetail = await newProjectAdminRepo.getProjectDetails(projId);
    expect(projectDetail?.id).toBe(projId);
  });

  it('requires a revision-bound audited review before Project private external transfer approval', async () => {
    const projId = `pg-proj-${randomUUID().slice(0, 8)}`;
    const actorId = randomUUID();
    await pool!.query(
      'INSERT INTO auth.principals (principal_id, actor_type, status, account_id, created_at) VALUES ($1, $2, $3, $4, now())',
      [actorId, 'user', 'active', `user-${actorId.slice(0, 8)}`],
    );
    await projectAdminRepo.createProject({
      commandId: randomUUID(),
      clientRequestId: `req-init-${randomUUID()}`,
      idempotencyKey: `idem-init-${randomUUID()}`,
      projectId: projId,
      actorPrincipalId: actorId,
      expectedProjectRevision: 0,
      name: 'Privacy Review Project',
    });
    const productionSettings = new PostgresSettingsRepository(pool!, true);
    const proposed = await productionSettings.applySettingsCommand({
      commandId: randomUUID(),
      clientRequestId: `req-review-${randomUUID()}`,
      idempotencyKey: `idem-review-${randomUUID()}`,
      projectId: projId,
      expectedSettingsRevision: 1,
      observedPolicyContextRevision: 1,
      settings: { 'privacy.externalTransferAllowed': true },
      actorId,
    });
    expect(proposed).toMatchObject({ status: 'REVIEW_REQUIRED' });
    expect(proposed.reviewProposalId).toBeTruthy();
    expect((await productionSettings.getSettingsSnapshot(projId)).settingsRevision).toBe(1);
    expect(await productionSettings.getPrivacyRetention(projId)).toMatchObject({
      availability: 'AVAILABLE',
      data: {
        externalTransferAllowed: false,
        approvalStatus: 'REVIEW_PENDING',
        pendingReviewProposalId: proposed.reviewProposalId,
      },
    });

    const approved = await productionSettings.applySettingsCommand({
      commandId: randomUUID(),
      clientRequestId: `req-approve-${randomUUID()}`,
      idempotencyKey: `idem-approve-${randomUUID()}`,
      projectId: projId,
      expectedSettingsRevision: 1,
      observedPolicyContextRevision: 1,
      settings: { 'privacy.externalTransferAllowed': true },
      reviewProposalId: proposed.reviewProposalId!,
      actorId,
    });
    expect(approved).toMatchObject({ status: 'APPLIED', appliedRevision: 2 });
    expect(await productionSettings.getPrivacyRetention(projId)).toMatchObject({
      availability: 'AVAILABLE',
      data: {
        externalTransferAllowed: true,
        deploymentAllowsPrivateExternalTransfer: true,
        approvalStatus: 'APPROVED',
        restrictedExternalTransferAllowed: false,
      },
    });
    const evidence = await pool!.query<{ proposal_status: string; audit_count: number }>(
      `SELECT proposal.status AS proposal_status,
              (SELECT COUNT(*)::integer FROM settings.settings_audit_events
               WHERE project_id = $1 AND action_name IN ('SETTINGS_REVIEW_PROPOSED', 'SETTINGS_COMMAND_APPLIED')) AS audit_count
       FROM settings.settings_review_proposals AS proposal
       WHERE proposal.proposal_id = $2`,
      [projId, proposed.reviewProposalId],
    );
    expect(evidence.rows[0]).toEqual({ proposal_status: 'APPROVED', audit_count: 2 });
  });

  it('enforces idempotency key reuse with payload & parameter binding in PostgreSQL', async () => {
    const projId = `pg-proj-${randomUUID().slice(0, 8)}`;
    const actorId = randomUUID();
    const idemKey = `idem-reuse-${randomUUID()}`;
    const reqId = `req-reuse-${randomUUID()}`;

    await pool!.query(
      'INSERT INTO auth.principals (principal_id, actor_type, status, account_id, created_at) VALUES ($1, $2, $3, $4, now())',
      [actorId, 'user', 'active', `user-${actorId.slice(0, 8)}`],
    );

    await projectAdminRepo.createProject({
      commandId: randomUUID(),
      clientRequestId: `req-init-${randomUUID()}`,
      idempotencyKey: `idem-init-${randomUUID()}`,
      projectId: projId,
      actorPrincipalId: actorId,
      expectedProjectRevision: 0,
      name: 'Idempotency Project',
    });

    // 1st Call
    const res1 = await settingsRepo.applySettingsCommand({
      commandId: `cmd-1-${randomUUID()}`,
      clientRequestId: reqId,
      idempotencyKey: idemKey,
      projectId: projId,
      expectedSettingsRevision: 1,
      observedPolicyContextRevision: 1,
      settings: { 'general.locale': 'en-US' },
      actorId,
    });

    expect(res1.status).toBe('APPLIED');
    expect(res1.appliedRevision).toBe(2);

    // Re-call with exact same parameters & payload -> returns identical stored result
    const res2 = await settingsRepo.applySettingsCommand({
      commandId: `cmd-2-${randomUUID()}`,
      clientRequestId: reqId,
      idempotencyKey: idemKey,
      projectId: projId,
      expectedSettingsRevision: 1,
      observedPolicyContextRevision: 1,
      settings: { 'general.locale': 'en-US' },
      actorId,
    });

    expect(res2.commandId).toBe(res1.commandId);
    expect(res2.appliedRevision).toBe(2);

    // Re-call with mismatched payload -> throws IDEMPOTENCY_KEY_REUSE_MISMATCH
    await expect(
      settingsRepo.applySettingsCommand({
        commandId: `cmd-3-${randomUUID()}`,
        clientRequestId: reqId,
        idempotencyKey: idemKey,
        projectId: projId,
        expectedSettingsRevision: 1,
        observedPolicyContextRevision: 1,
        settings: { 'general.locale': 'fr-FR' }, // Different payload
        actorId,
      }),
    ).rejects.toThrowError(FrontendContractError);
  });

  it('rolls back cleanly on transaction errors without leaving corrupted revisions', async () => {
    const projId = `pg-proj-${randomUUID().slice(0, 8)}`;
    const actorId = randomUUID();

    await pool!.query(
      'INSERT INTO auth.principals (principal_id, actor_type, status, account_id, created_at) VALUES ($1, $2, $3, $4, now())',
      [actorId, 'user', 'active', `user-${actorId.slice(0, 8)}`],
    );

    await projectAdminRepo.createProject({
      commandId: randomUUID(),
      clientRequestId: `req-init-${randomUUID()}`,
      idempotencyKey: `idem-init-${randomUUID()}`,
      projectId: projId,
      actorPrincipalId: actorId,
      expectedProjectRevision: 0,
      name: 'Rollback Project',
    });

    // Attempt applySettingsCommand with wrong expectedSettingsRevision -> REVISION_CONFLICT
    await expect(
      settingsRepo.applySettingsCommand({
        commandId: randomUUID(),
        clientRequestId: `req-conflict-${randomUUID()}`,
        idempotencyKey: `idem-conflict-${randomUUID()}`,
        projectId: projId,
        expectedSettingsRevision: 999, // Stale/invalid revision
        observedPolicyContextRevision: 1,
        settings: { 'general.locale': 'de-DE' },
        actorId,
      }),
    ).rejects.toThrowError(FrontendContractError);

    // Verify revision is still 1
    const snapshot = await settingsRepo.getSettingsSnapshot(projId);
    expect(snapshot.settingsRevision).toBe(1);
  });

  it('persists accepted context, semantic digest, outcome revision, and clientRequestId recovery', async () => {
    const projectId = `pg-proj-${randomUUID().slice(0, 8)}`;
    const principalId = randomUUID();
    const clientRequestId = `req-ledger-${randomUUID()}`;
    const request: FrontendCommandRequest = {
      envelopeVersion: '1.0.0',
      commandType: 'project.metadata.update.v1',
      commandSchemaVersion: '1.0.0',
      clientRequestId,
      idempotencyKey: `idem-ledger-${randomUUID()}`,
      projectContext: {
        activeProjectId: projectId,
        targetProjectId: projectId,
        resourceProjectId: projectId,
      },
      policyBinding: { mode: 'CURRENT', observedPolicyContextRevision: '1' },
      preconditions: [
        {
          purpose: 'TARGET',
          subject: { resourceKind: 'project', resourceId: projectId },
          expectedRevision: '1',
        },
      ],
      clientIssuedAt: new Date().toISOString(),
      payload: { name: 'Ledger Project' },
    };
    const commandId = randomUUID();
    const acceptedAt = new Date().toISOString();
    const accepted = await commandGateway.accept({
      commandId,
      commandRevision: '1',
      principalId,
      request,
      commandSemanticDigest: 'digest-ledger-1',
      acceptedPolicyContext: {
        policyContextId: `project-policy-context/${projectId}`,
        policyContextRevision: '1',
        acceptedAt,
      },
      correlationId: randomUUID(),
      traceId: randomUUID(),
      receivedAt: acceptedAt,
      acceptedAt,
    });
    expect(accepted.replayed).toBe(false);

    await commandGateway.complete({
      commandId,
      producedResources: [
        { resourceKind: 'project', resourceId: projectId, resourceRevision: '2' },
      ],
      completedAt: new Date().toISOString(),
    });

    const recovered = await commandGateway.findByClientRequestId(principalId, clientRequestId);
    expect(recovered).toMatchObject({
      commandId,
      commandRevision: '2',
      commandSemanticDigest: 'digest-ledger-1',
      outcomeState: 'COMPLETED',
      completionDisposition: 'SUCCEEDED',
    });
    expect(recovered?.acceptedPolicyContext.policyContextRevision).toBe('1');
    expect(recovered?.producedResources).toEqual([
      { resourceKind: 'project', resourceId: projectId, resourceRevision: '2' },
    ]);
  });
});
