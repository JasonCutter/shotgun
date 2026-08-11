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
    await pool!.query(`
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
