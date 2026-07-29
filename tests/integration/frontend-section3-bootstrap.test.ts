import { afterEach, describe, expect, it } from 'vitest';

import {
  InMemoryProjectAdministrationRepository,
  InMemoryProjectBootstrapUnitOfWork,
} from '../../adapters/settings-project-admin-in-memory/src/index.js';
import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import {
  InMemoryAuthRepository,
  LOCAL_OWNER_ACCOUNT_ID,
} from '../../packages/authentication/src/index.js';

const bootstrapRequest = (clientRequestId = 'first-project-request') => ({
  envelopeVersion: '2.0.0',
  commandType: 'project.create.v1',
  commandSchemaVersion: '1.0.0',
  clientRequestId,
  idempotencyKey: 'first-project-idempotency',
  projectContext: {
    scope: 'PRINCIPAL',
    observedProjectAccessRevision: '0',
  },
  policyBinding: { mode: 'CURRENT' },
  preconditions: [],
  clientIssuedAt: new Date().toISOString(),
  payload: {
    name: 'My First Project',
    locale: 'ko-KR',
    timezone: 'Asia/Seoul',
  },
});

describe('Frontend Section 3 first Project bootstrap', () => {
  const applications: Awaited<ReturnType<typeof createApplication>>[] = [];

  afterEach(async () => {
    await Promise.all(applications.splice(0).map((application) => application.server.close()));
  });

  it('atomically creates a server-ID Project, Owner membership, active Session, and outcome', async () => {
    const auth = new InMemoryAuthRepository();
    const projects = new InMemoryProjectAdministrationRepository(
      (input) =>
        auth.createProjectOwnerMembership({
          ...input,
          scopes: ['owner'],
          sensitivityClearance: 'private',
        }),
      false,
    );
    const application = await createApplication({
      authRepository: auth,
      projectAdminRepository: projects,
    });
    applications.push(application);

    const localSession = await application.server.inject({
      method: 'POST',
      url: '/api/v1/session/local-bootstrap',
      headers: { host: '127.0.0.1' },
    });
    expect(localSession.statusCode).toBe(200);
    expect(localSession.json()).toMatchObject({
      session: {
        apiVersion: '2.0.0',
        activeProject: null,
        accessibleProjects: [],
        projectReady: false,
      },
    });
    const setCookie = localSession.headers['set-cookie'];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)!.split(';')[0]!;
    const csrfResponse = await application.server.inject({
      method: 'GET',
      url: '/api/v1/security/csrf',
      headers: { cookie },
    });
    const csrfToken = csrfResponse.json<{ csrfToken: string }>().csrfToken;

    const response = await application.server.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: bootstrapRequest(),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      outcome: {
        outcomeState: string;
        acceptedProjectContext: { scope: string };
        producedResources: readonly { resourceId: string }[];
      };
      project: { id: string; active: boolean };
    }>();
    expect(body.project.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(body.project.active).toBe(true);
    expect(body.outcome).toMatchObject({
      outcomeState: 'COMPLETED',
      acceptedProjectContext: { scope: 'PRINCIPAL' },
      producedResources: [{ resourceId: body.project.id }],
    });

    const principal = await auth.findPrincipalByAccountId(LOCAL_OWNER_ACCOUNT_ID);
    expect(principal).toBeDefined();
    const memberships = await auth.listMemberships(principal!.principalId);
    expect(memberships).toEqual([
      expect.objectContaining({
        projectId: body.project.id,
        principalId: principal!.principalId,
        isOwner: true,
      }),
    ]);
    const sessionView = await application.server.inject({
      method: 'GET',
      url: '/api/v1/session',
      headers: { cookie },
    });
    expect(sessionView.json()).toMatchObject({
      session: {
        apiVersion: '1.0.0',
        activeProject: { id: body.project.id },
      },
    });
  });

  it('rolls back Project and Owner creation if Session activation fails', async () => {
    const auth = new InMemoryAuthRepository();
    const principal = await auth.bootstrapLocalOwnerPrincipal({
      accountId: LOCAL_OWNER_ACCOUNT_ID,
    });
    const session = await auth.createSession(
      principal.principalId,
      null,
      new Date(Date.now() + 60_000).toISOString(),
    );
    const projects = new InMemoryProjectAdministrationRepository(
      (input) =>
        auth.createProjectOwnerMembership({
          ...input,
          scopes: ['owner'],
          sensitivityClearance: 'private',
        }),
      false,
    );
    const unitOfWork = new InMemoryProjectBootstrapUnitOfWork(projects, auth);
    const updateSession = auth.updateSessionProjectById.bind(auth);
    auth.updateSessionProjectById = (sessionId, principalId, projectId) => {
      if (projectId !== null) throw new Error('injected activation failure');
      updateSession(sessionId, principalId, projectId);
    };

    await expect(
      unitOfWork.bootstrap({
        commandId: 'command-failure',
        clientRequestId: 'request-failure',
        idempotencyKey: 'idempotency-failure',
        principalId: principal.principalId,
        sessionId: session.sessionId,
        observedProjectAccessRevision: '0',
        payload: { name: 'Must Roll Back' },
      }),
    ).rejects.toThrow('injected activation failure');
    expect(await auth.listMemberships(principal.principalId)).toEqual([]);
    expect((await projects.getProjects([])).projects).toEqual([]);
    expect((await auth.findSession(session.sessionToken))?.activeProjectId).toBeNull();
  });
});
