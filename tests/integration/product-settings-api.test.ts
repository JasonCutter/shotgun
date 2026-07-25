import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import { InMemoryAuthRepository } from '../../packages/authentication/src/index.js';
import type { FastifyInstance } from 'fastify';

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
      payload: {
        id: 'proj-integration-1',
        name: 'Integration Test Project',
        description: 'Created during integration test',
        clientRequestId: 'req-create-1',
        idempotencyKey: 'idem-create-1',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { project: { id: string; name: string } };
    expect(body.project.id).toBe('proj-integration-1');
    expect(body.project.name).toBe('Integration Test Project');
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
      payload: {
        commandId: 'cmd-integration-1',
        clientRequestId: 'req-cmd-1',
        idempotencyKey: 'idem-cmd-1',
        targetProjectId: 'shotgun',
        expectedSettingsRevision: currentRev,
        observedPolicyContextRevision: policyRev,
        settings: { 'general.locale': 'ko-KR' },
      },
    });
    if (res.statusCode !== 200) {
      console.error('Settings Command Failed:', res.body);
    }
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { result: { status: string; appliedRevision: number } };
    expect(body.result.status).toBe('APPLIED');
    expect(body.result.appliedRevision).toBe(currentRev + 1);
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
      payload: {
        commandId: 'cmd-integration-stale',
        clientRequestId: 'req-cmd-stale',
        idempotencyKey: 'idem-cmd-stale',
        targetProjectId: 'shotgun',
        expectedSettingsRevision: currentRev - 1, // Definitely stale
        observedPolicyContextRevision: policyRev,
        settings: { 'general.locale': 'en-US' },
      },
    });
    expect(res.statusCode).toBe(409);
  });
});
