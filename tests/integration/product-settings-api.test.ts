import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import { InMemoryAuthRepository } from '../../packages/authentication/src/index.js';
import type { FastifyInstance } from 'fastify';

const commandRequest = (input: {
  commandType: string;
  clientRequestId: string;
  idempotencyKey: string;
  targetProjectId?: string;
  resourceProjectId?: string;
  policyRevision?: number;
  preconditions?: readonly unknown[];
  payload: Record<string, unknown>;
}) => ({
  envelopeVersion: '1.0.0',
  commandType: input.commandType,
  commandSchemaVersion: '1.0.0',
  clientRequestId: input.clientRequestId,
  idempotencyKey: input.idempotencyKey,
  projectContext: {
    activeProjectId: 'shotgun',
    targetProjectId: input.targetProjectId ?? 'shotgun',
    ...(input.resourceProjectId ? { resourceProjectId: input.resourceProjectId } : {}),
  },
  policyBinding: {
    mode: 'CURRENT',
    ...(input.policyRevision === undefined
      ? {}
      : { observedPolicyContextRevision: String(input.policyRevision) }),
  },
  preconditions: input.preconditions ?? [],
  clientIssuedAt: new Date().toISOString(),
  payload: input.payload,
});

describe('Product Settings & Project Administration REST Endpoints', () => {
  let app: Awaited<ReturnType<typeof createApplication>>;
  let server: FastifyInstance;
  let cookieHeader: string;
  let csrfToken: string;

  beforeAll(async () => {
    const authRepository = new InMemoryAuthRepository();
    await authRepository.bootstrapOwner({
      accountId: 'test-owner',
      projectId: 'shotgun',
      scopes: ['owner'],
      sensitivityClearance: 'private',
    });
    const membership = await authRepository.findOwnerMembership('test-owner', 'shotgun');
    if (!membership) throw new Error('Fixture owner membership not created');

    const session = await authRepository.createSession(
      membership.principalId,
      'shotgun',
      new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    );
    cookieHeader = `shotgun_session=${session.sessionToken}`;

    app = await createApplication({ authRepository });
    server = app.server;

    // Get CSRF Token
    const csrfRes = await server.inject({
      method: 'GET',
      url: '/api/v1/security/csrf',
      headers: { cookie: cookieHeader },
    });
    expect(csrfRes.statusCode).toBe(200);
    csrfToken = (JSON.parse(csrfRes.body) as { csrfToken: string }).csrfToken;
  });

  afterAll(async () => {
    await server.close();
  });

  it('GET /api/v1/projects returns project list with default shotgun project', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: { cookie: cookieHeader },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { projects: readonly { id: string }[] };
    expect(body.projects.length).toBeGreaterThan(0);
    expect(body.projects[0]?.id).toBe('shotgun');
  });

  it('POST /api/v1/projects creates a new project atomically', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: {
        cookie: cookieHeader,
        'x-csrf-token': csrfToken,
        'content-type': 'application/json',
      },
      payload: commandRequest({
        commandType: 'project.create.v1',
        clientRequestId: 'req-create-1',
        idempotencyKey: 'idem-create-1',
        payload: {
          newProjectId: 'proj-integration-1',
          name: 'Integration Test Project',
          description: 'Created during integration test',
        },
      }),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      outcome: { commandId: string; outcomeState: string };
      project: { id: string; name: string };
    };
    expect(body.project.id).toBe('proj-integration-1');
    expect(body.project.name).toBe('Integration Test Project');
    expect(body.outcome.commandId).not.toBe('req-create-1');
    expect(body.outcome.outcomeState).toBe('COMPLETED');

    const details = await server.inject({
      method: 'GET',
      url: '/api/v1/projects/proj-integration-1',
      headers: { cookie: cookieHeader },
    });
    expect(details.statusCode).toBe(200);
    expect((JSON.parse(details.body) as { project: { isOwner: boolean } }).project.isOwner).toBe(
      true,
    );
  });

  it('runs typed Project metadata and lifecycle preconditions through completion outcomes', async () => {
    const create = await server.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: {
        cookie: cookieHeader,
        'x-csrf-token': csrfToken,
        'content-type': 'application/json',
      },
      payload: commandRequest({
        commandType: 'project.create.v1',
        clientRequestId: 'req-lifecycle-create',
        idempotencyKey: 'idem-lifecycle-create',
        payload: { newProjectId: 'proj-lifecycle', name: 'Lifecycle Project' },
      }),
    });
    expect(create.statusCode).toBe(200);

    const mutate = async (
      method: 'PATCH' | 'POST',
      path: string,
      commandType: string,
      expectedRevision: number,
      payload: Record<string, unknown>,
    ) =>
      server.inject({
        method,
        url: path,
        headers: {
          cookie: cookieHeader,
          'x-csrf-token': csrfToken,
          'content-type': 'application/json',
        },
        payload: commandRequest({
          commandType,
          clientRequestId: `req-${commandType}`,
          idempotencyKey: `idem-${commandType}`,
          targetProjectId: 'proj-lifecycle',
          resourceProjectId: 'proj-lifecycle',
          preconditions: [
            {
              purpose: 'TARGET',
              subject: { resourceKind: 'project', resourceId: 'proj-lifecycle' },
              expectedRevision: String(expectedRevision),
            },
          ],
          payload,
        }),
      });

    const rename = await mutate(
      'PATCH',
      '/api/v1/projects/proj-lifecycle',
      'project.metadata.update.v1',
      1,
      { name: 'Renamed Lifecycle Project' },
    );
    expect(rename.statusCode).toBe(200);
    expect(
      (JSON.parse(rename.body) as { project: { revision: number; name: string } }).project,
    ).toMatchObject({ revision: 2, name: 'Renamed Lifecycle Project' });

    const archive = await mutate(
      'POST',
      '/api/v1/projects/proj-lifecycle/archive',
      'project.archive.v1',
      2,
      {},
    );
    expect(archive.statusCode).toBe(200);
    expect(
      (JSON.parse(archive.body) as { project: { revision: number; status: string } }).project,
    ).toMatchObject({ revision: 3, status: 'ARCHIVED' });

    const restore = await mutate(
      'POST',
      '/api/v1/projects/proj-lifecycle/restore',
      'project.restore.v1',
      3,
      {},
    );
    expect(restore.statusCode).toBe(200);
    expect(
      (JSON.parse(restore.body) as { project: { revision: number; status: string } }).project,
    ).toMatchObject({ revision: 4, status: 'ACTIVE' });

    const deletion = await mutate(
      'POST',
      '/api/v1/projects/proj-lifecycle/delete-request',
      'project.delete-request.v1',
      4,
      {},
    );
    expect(deletion.statusCode).toBe(200);
    const deletionBody = JSON.parse(deletion.body) as {
      outcome: { outcomeState: string; producedResources: readonly unknown[] };
      project: { revision: number; status: string };
    };
    expect(deletionBody.project).toMatchObject({ revision: 5, status: 'DELETE_REQUESTED' });
    expect(deletionBody.outcome.outcomeState).toBe('COMPLETED');
    expect(deletionBody.outcome.producedResources).toHaveLength(1);
  });

  it('replays identical requests and rejects idempotency semantic mismatches', async () => {
    const request = commandRequest({
      commandType: 'project.create.v1',
      clientRequestId: 'req-idempotent-create',
      idempotencyKey: 'idem-idempotent-create',
      payload: { newProjectId: 'proj-idempotent', name: 'Idempotent Project' },
    });
    const submit = (payload: Record<string, unknown>) =>
      server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: {
          cookie: cookieHeader,
          'x-csrf-token': csrfToken,
          'content-type': 'application/json',
        },
        payload,
      });

    const first = await submit(request);
    const replay = await submit(request);
    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect((JSON.parse(replay.body) as { outcome: { commandId: string } }).outcome.commandId).toBe(
      (JSON.parse(first.body) as { outcome: { commandId: string } }).outcome.commandId,
    );

    const mismatch = await submit({
      ...request,
      payload: { newProjectId: 'proj-idempotent', name: 'Different Meaning' },
    });
    expect(mismatch.statusCode).toBe(409);
    expect((JSON.parse(mismatch.body) as { code: string }).code).toBe(
      'IDEMPOTENCY_KEY_REUSE_MISMATCH',
    );
  });

  it('rejects browser authority injection and cross-project resource rebinding', async () => {
    const injected = await server.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: {
        cookie: cookieHeader,
        'x-csrf-token': csrfToken,
        'content-type': 'application/json',
      },
      payload: {
        ...commandRequest({
          commandType: 'project.create.v1',
          clientRequestId: 'req-injected',
          idempotencyKey: 'idem-injected',
          payload: { newProjectId: 'proj-injected', name: 'Injected' },
        }),
        commandId: 'browser-command-id',
        principal: { id: 'attacker' },
        securityContext: { scopes: ['owner'] },
        traceId: 'browser-trace',
      },
    });
    expect(injected.statusCode).toBe(400);
    expect((JSON.parse(injected.body) as { code: string }).code).toBe('INVALID_REQUEST');

    const rebound = await server.inject({
      method: 'PATCH',
      url: '/api/v1/projects/shotgun',
      headers: {
        cookie: cookieHeader,
        'x-csrf-token': csrfToken,
        'content-type': 'application/json',
      },
      payload: commandRequest({
        commandType: 'project.metadata.update.v1',
        clientRequestId: 'req-rebound',
        idempotencyKey: 'idem-rebound',
        targetProjectId: 'shotgun',
        resourceProjectId: 'proj-integration-1',
        preconditions: [
          {
            purpose: 'TARGET',
            subject: { resourceKind: 'project', resourceId: 'shotgun' },
            expectedRevision: '1',
          },
        ],
        payload: { name: 'Must Not Apply' },
      }),
    });
    expect(rebound.statusCode).toBe(400);
    expect((JSON.parse(rebound.body) as { code: string }).code).toBe('RESOURCE_PROJECT_MISMATCH');
  });

  it('updates Principal preferences through a server-generated command resource', async () => {
    const current = await server.inject({
      method: 'GET',
      url: '/api/v1/settings/preferences',
      headers: { cookie: cookieHeader },
    });
    const revision = (JSON.parse(current.body) as { preferenceRevision: number })
      .preferenceRevision;
    const update = await server.inject({
      method: 'POST',
      url: '/api/v1/settings/preferences',
      headers: {
        cookie: cookieHeader,
        'x-csrf-token': csrfToken,
        'content-type': 'application/json',
      },
      payload: commandRequest({
        commandType: 'settings.preference.update.v1',
        clientRequestId: 'req-preference',
        idempotencyKey: 'idem-preference',
        resourceProjectId: 'shotgun',
        preconditions: [
          {
            purpose: 'TARGET',
            subject: { resourceKind: 'principal-preferences', resourceId: 'self' },
            expectedRevision: String(revision),
          },
        ],
        payload: { preferences: { locale: 'en-US' } },
      }),
    });
    expect(update.statusCode).toBe(200);
    const body = JSON.parse(update.body) as {
      outcome: { commandId: string; acceptedPrincipalContext: { principalId: string } };
      preferences: { locale: string };
    };
    expect(body.outcome.commandId).not.toBe('req-preference');
    expect(body.outcome.acceptedPrincipalContext.principalId).toBeTruthy();
    expect(body.preferences.locale).toBe('en-US');
  });

  it('GET /api/v1/settings/snapshot returns snapshot for project', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/settings/snapshot?targetProjectId=shotgun',
      headers: { cookie: cookieHeader },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      snapshot: { targetProjectId: string; settingsRevision: number };
    };
    expect(body.snapshot.targetProjectId).toBe('shotgun');
    expect(body.snapshot.settingsRevision).toBe(1);
  });

  it('POST /api/v1/settings/validate validates settings draft', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/settings/validate',
      headers: {
        cookie: cookieHeader,
        'x-csrf-token': csrfToken,
        'content-type': 'application/json',
      },
      payload: {
        targetProjectId: 'shotgun',
        draft: { 'costs.monthlyHardLimitUsd': 150 },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { validation: { isValid: boolean } };
    expect(body.validation.isValid).toBe(true);
  });

  it('POST /api/v1/settings/commands applies command and increments revision', async () => {
    // 1. Get current revision
    const getRes = await server.inject({
      method: 'GET',
      url: '/api/v1/settings/snapshot?projectId=shotgun',
      headers: { cookie: cookieHeader },
    });
    const resData = JSON.parse(getRes.body) as {
      snapshot: { settingsRevision: number; policyContextRevision: number };
    };
    const currentRev = resData.snapshot.settingsRevision;
    const policyRev = resData.snapshot.policyContextRevision;

    // 2. Apply command
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/settings/commands',
      headers: {
        cookie: cookieHeader,
        'x-csrf-token': csrfToken,
        'content-type': 'application/json',
      },
      payload: commandRequest({
        commandType: 'settings.project-policy.apply.v1',
        clientRequestId: 'req-cmd-1',
        idempotencyKey: 'idem-cmd-1',
        targetProjectId: 'shotgun',
        resourceProjectId: 'shotgun',
        policyRevision: policyRev,
        preconditions: [
          {
            purpose: 'TARGET',
            subject: { resourceKind: 'project-settings', resourceId: 'shotgun' },
            expectedRevision: String(currentRev),
          },
          {
            purpose: 'POLICY',
            subject: { resourceKind: 'project-policy-context', resourceId: 'shotgun' },
            expectedRevision: String(policyRev),
          },
        ],
        payload: { settings: { 'general.locale': 'ko-KR' } },
      }),
    });
    if (res.statusCode !== 200) {
      console.error('Settings Command Failed:', res.body);
    }
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      outcome: { commandId: string; outcomeState: string };
      result: { status: string; appliedRevision: number };
    };
    expect(body.result.status).toBe('APPLIED');
    expect(body.result.appliedRevision).toBe(currentRev + 1);
    expect(body.outcome.commandId).not.toBe('cmd-integration-1');
    expect(body.outcome.outcomeState).toBe('COMPLETED');

    const recovery = await server.inject({
      method: 'GET',
      url: '/api/v1/frontend-commands/by-client-request/req-cmd-1',
      headers: { cookie: cookieHeader },
    });
    expect(recovery.statusCode).toBe(200);
    expect(
      (JSON.parse(recovery.body) as { outcome: { commandId: string } }).outcome.commandId,
    ).toBe(body.outcome.commandId);
  });

  it('POST /api/v1/settings/commands rejects stale expectedRevision (409 conflict)', async () => {
    // 1. Get current revision
    const getRes = await server.inject({
      method: 'GET',
      url: '/api/v1/settings/snapshot?projectId=shotgun',
      headers: { cookie: cookieHeader },
    });
    const resData = JSON.parse(getRes.body) as {
      snapshot: { settingsRevision: number; policyContextRevision: number };
    };
    const currentRev = resData.snapshot.settingsRevision;
    const policyRev = resData.snapshot.policyContextRevision;

    // 2. Try with stale revision
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/settings/commands',
      headers: {
        cookie: cookieHeader,
        'x-csrf-token': csrfToken,
        'content-type': 'application/json',
      },
      payload: commandRequest({
        commandType: 'settings.project-policy.apply.v1',
        clientRequestId: 'req-cmd-stale',
        idempotencyKey: 'idem-cmd-stale',
        targetProjectId: 'shotgun',
        resourceProjectId: 'shotgun',
        policyRevision: policyRev,
        preconditions: [
          {
            purpose: 'TARGET',
            subject: { resourceKind: 'project-settings', resourceId: 'shotgun' },
            expectedRevision: String(currentRev - 1),
          },
          {
            purpose: 'POLICY',
            subject: { resourceKind: 'project-policy-context', resourceId: 'shotgun' },
            expectedRevision: String(policyRev),
          },
        ],
        payload: { settings: { 'general.locale': 'en-US' } },
      }),
    });
    expect(res.statusCode).toBe(409);
  });
});
