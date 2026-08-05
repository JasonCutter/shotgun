import { beforeEach, describe, expect, it } from 'vitest';

import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import { InMemoryAuthRepository } from '../../packages/authentication/src/index.js';
import { InMemoryFrontendCommandGateway } from '../../adapters/frontend-command-gateway-in-memory/src/index.js';
import {
  FakeExternalActionEngine,
  InMemoryExternalActionStore,
} from '../../adapters/frontend-external-action-in-memory/src/index.js';
import { FrontendExternalActionProductCoordinator } from '../../modules/frontend-external-action/src/index.js';
import { frontendExternalActionExecuteDigest } from '../../packages/contracts/src/index.js';

const PROJECT_ID = 'project-1';

const targetRef = {
  schemaVersion: '1.0.0' as const,
  targetKind: 'KNOWN_TARGET' as const,
  targetId: 'target-1',
  targetRevision: 'rev-3',
  externalRevision: 'ext-7',
};

const parameterRef = {
  schemaVersion: '1.0.0' as const,
  parameterId: 'param-1',
  parameterRevision: '2',
  parameterDigest: `sha256:${'a'.repeat(64)}`,
};

const evidenceSetRef = {
  schemaVersion: '1.0.0' as const,
  evidenceSetId: 'evidence-1',
  evidenceSetDigest: `sha256:${'b'.repeat(64)}`,
};

describe('FE-P4-S2 WP4 External Action Protected Product API', () => {
  let auth: InMemoryAuthRepository;

  beforeEach(() => {
    auth = new InMemoryAuthRepository();
  });

  const projectSession = async () => {
    await auth.bootstrapOwner({
      accountId: 'external-action-api-owner',
      projectId: PROJECT_ID,
      scopes: ['owner'],
      sensitivityClearance: 'private',
    });
    const principal = await auth.findPrincipalByAccountId('external-action-api-owner');
    if (!principal) throw new Error('External Action API fixture Principal was not created.');
    const session = await auth.createSession(
      principal.principalId,
      PROJECT_ID,
      new Date(Date.now() + 60_000).toISOString(),
    );
    return `shotgun_session=${session.sessionToken}`;
  };

  const buildApplication = async () => {
    const store = new InMemoryExternalActionStore();
    store.seedCredential({
      schemaVersion: '1.0.0',
      connectorId: 'fake-connector',
      name: 'Fake Connector',
      status: 'CONFIGURED',
      maskedCredential: 'ab••••••••cd',
      capabilities: ['TEST', 'ROTATE', 'REVOKE'],
    });
    store.seedBudget({
      schemaVersion: '1.0.0',
      projectId: PROJECT_ID,
      status: 'OK',
      usedExecutions: 0,
      remainingExecutions: 100,
      softLimit: 80,
      hardLimit: 100,
      exhausted: false,
    });
    const coordinator = new FrontendExternalActionProductCoordinator(
      store,
      new InMemoryFrontendCommandGateway(),
      new FakeExternalActionEngine(),
    );
    return createApplication({
      authRepository: auth,
      frontendExternalActionCoordinator: coordinator,
    });
  };

  const csrf = async (application: Awaited<ReturnType<typeof buildApplication>>, cookie: string) =>
    (
      await application.server.inject({
        method: 'GET',
        url: '/api/v1/security/csrf',
        headers: { cookie },
      })
    ).json<{ csrfToken?: string }>();

  const runLifecycle = async (
    app: Awaited<ReturnType<typeof buildApplication>>,
    headers: { readonly cookie: string; readonly 'x-csrf-token': string },
  ) => {
    const post = async <T>(url: string, payload: object): Promise<T> => {
      const response = await app.server.inject({
        method: 'POST',
        url,
        headers,
        payload,
      });
      expect(response.statusCode).toBe(200);
      return response.json<T>();
    };

    const validated = await post<{
      actionId: string;
      candidate: { candidateDigest: string };
    }>('/product-api/frontend/external-action/validate', {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-api-validate',
      idempotencyKey: 'idem-api-validate',
      actionId: 'action-api-1',
      candidateId: 'candidate-api-1',
      operation: 'UPDATE_REVERSIBLE',
      targetRef,
      parameterRef,
      evidenceRefs: [evidenceSetRef],
      reason: 'Validate.',
    });
    expect(validated.actionId).toBe('action-api-1');

    const prepared = await post<{
      actionId: string;
      manifest: { manifestId: string; manifestRevision: number };
    }>('/product-api/frontend/external-action/prepare', {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-api-prepare',
      idempotencyKey: 'idem-api-prepare',
      actionId: 'action-api-1',
      expectedActionRevision: 1,
      reason: 'Prepare.',
    });
    expect(prepared.manifest.manifestRevision).toBe(1);

    const approved = await post<{ approval: { approvalId: string } }>(
      '/product-api/frontend/external-action/approve',
      {
        schemaVersion: '1.0.0',
        clientRequestId: 'client-api-approve',
        idempotencyKey: 'idem-api-approve',
        actionId: 'action-api-1',
        manifestId: prepared.manifest.manifestId,
        manifestRevision: prepared.manifest.manifestRevision,
        expectedTargetRevision: 'rev-3',
        expectedExternalRevision: 'ext-7',
        reason: 'Approved.',
      },
    );
    expect(approved.approval.approvalId).toBeDefined();

    const preflighted = await post<{ preflight: { preflightId: string } }>(
      '/product-api/frontend/external-action/preflight',
      {
        schemaVersion: '1.0.0',
        clientRequestId: 'client-api-preflight',
        idempotencyKey: 'idem-api-preflight',
        actionId: 'action-api-1',
        expectedActionRevision: 3,
        manifestRevision: 1,
        expectedExternalRevision: 'ext-7',
        reason: 'Preflight.',
      },
    );
    expect(preflighted.preflight.preflightId).toBeDefined();

    const executeRequest = {
      schemaVersion: '1.0.0' as const,
      clientRequestId: 'client-api-execute',
      idempotencyKey: 'idem-api-execute',
      actionId: 'action-api-1',
      expectedActionRevision: 4,
      manifestRevision: 1,
      preflightId: preflighted.preflight.preflightId,
      expectedExternalRevision: 'ext-7',
      reason: 'Execute.',
    };
    const executed = await post<{
      execution: { executionId: string };
      attempt: { attemptId: string };
      outcome: string;
    }>('/product-api/frontend/external-action/execute', executeRequest);
    expect(executed.execution.executionId).toBeDefined();

    const verified = await post<{ verification: { verificationId: string } }>(
      '/product-api/frontend/external-action/verify',
      {
        schemaVersion: '1.0.0',
        clientRequestId: 'client-api-verify',
        idempotencyKey: 'idem-api-verify',
        actionId: 'action-api-1',
        executionId: executed.execution.executionId,
        expectedTargetRevision: 'rev-3',
        expectedExternalRevision: 'ext-7',
        reason: 'Verify.',
      },
    );
    expect(verified.verification.verificationId).toBeDefined();

    return { prepared, preflighted, executed, executeRequest };
  };

  it('runs the full governed lifecycle and reads through the protected routes', async () => {
    const cookie = await projectSession();
    const app = await buildApplication();
    const token = await csrf(app, cookie);
    const headers = { cookie, 'x-csrf-token': token.csrfToken ?? '' };

    const { executed } = await runLifecycle(app, headers);

    const post = async <T>(url: string, payload: object): Promise<T> => {
      const response = await app.server.inject({
        method: 'POST',
        url,
        headers,
        payload,
      });
      expect(response.statusCode).toBe(200);
      return response.json<T>();
    };

    const detail = await post<{ action: { actionId: string; status: string } }>(
      '/product-api/frontend/external-action/actions/detail',
      { schemaVersion: '1.0.0', actionId: 'action-api-1' },
    );
    expect(detail.action.actionId).toBe('action-api-1');
    expect(detail.action.status).toBe('VERIFIED');

    const queue = await post<{ items: { actionId: string }[] }>(
      '/product-api/frontend/external-action/queue',
      { schemaVersion: '1.0.0', pageSize: 50 },
    );
    expect(queue.items.some((entry) => entry.actionId === 'action-api-1')).toBe(true);

    const attempts = await post<{ attempts: { executionId: string }[] }>(
      '/product-api/frontend/external-action/executions/attempts',
      { schemaVersion: '1.0.0', actionId: 'action-api-1', pageSize: 50 },
    );
    expect(attempts.attempts[0]?.executionId).toBe(executed.execution.executionId);

    const audit = await post<{ events: unknown[] }>('/product-api/frontend/external-action/audit', {
      schemaVersion: '1.0.0',
      actionId: 'action-api-1',
      pageSize: 50,
    });
    expect(audit.events.length).toBeGreaterThan(0);
  });

  it('resolves a governed command outcome by the original identity', async () => {
    const cookie = await projectSession();
    const app = await buildApplication();
    const token = await csrf(app, cookie);
    const headers = { cookie, 'x-csrf-token': token.csrfToken ?? '' };
    const { executeRequest } = await runLifecycle(app, headers);

    const digest = frontendExternalActionExecuteDigest(executeRequest);
    const query = new URLSearchParams({
      idempotencyKey: 'idem-api-execute',
      semanticDigest: digest,
    });
    const response = await app.server.inject({
      method: 'GET',
      url: `/product-api/frontend/external-action/command-outcomes/by-client-request/client-api-execute?${query.toString()}`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ outcome: string; originalClientRequestId: string }>();
    expect(body.outcome).toBe('COMPLETED');
    expect(body.originalClientRequestId).toBe('client-api-execute');
  });

  it('fails closed without a CSRF token and for a principal outside the project', async () => {
    const cookie = await projectSession();
    const app = await buildApplication();

    const noCsrf = await app.server.inject({
      method: 'POST',
      url: '/product-api/frontend/external-action/queue',
      headers: { cookie },
      payload: { schemaVersion: '1.0.0', pageSize: 50 },
    });
    expect(noCsrf.statusCode).toBeGreaterThanOrEqual(400);

    // A principal who is NOT a member of the active project is denied
    // server-side (scope derivation never trusts browser input).
    await auth.bootstrapOwner({
      accountId: 'other-owner',
      projectId: 'other-project',
      scopes: ['owner'],
      sensitivityClearance: 'private',
    });
    const principal = await auth.findPrincipalByAccountId('other-owner');
    const session = await auth.createSession(
      principal!.principalId,
      PROJECT_ID,
      new Date(Date.now() + 60_000).toISOString(),
    );
    const otherCookie = `shotgun_session=${session.sessionToken}`;
    const otherToken = await csrf(app, otherCookie);
    const denied = await app.server.inject({
      method: 'POST',
      url: '/product-api/frontend/external-action/queue',
      headers: { cookie: otherCookie, 'x-csrf-token': otherToken.csrfToken ?? '' },
      payload: { schemaVersion: '1.0.0', pageSize: 50 },
    });
    expect(denied.statusCode).toBeGreaterThanOrEqual(400);
  });
});
