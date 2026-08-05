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

// Contract-valid payloads for the fine-grained scope→capability matrix test.
// For DENY rows the capability check runs BEFORE any resource existence check,
// so a 403 is deterministic even though the referenced action does not exist.
const scopePayloads = {
  queue: { schemaVersion: '1.0.0', pageSize: 50 },
  validate: {
    schemaVersion: '1.0.0',
    clientRequestId: 'scope-validate',
    idempotencyKey: 'scope-idem-validate',
    actionId: 'action-1',
    candidateId: 'candidate-1',
    operation: 'UPDATE_REVERSIBLE',
    targetRef,
    parameterRef,
    evidenceRefs: [evidenceSetRef],
    reason: 'Validate.',
  },
  prepare: {
    schemaVersion: '1.0.0',
    clientRequestId: 'scope-prepare',
    idempotencyKey: 'scope-idem-prepare',
    actionId: 'action-1',
    expectedActionRevision: 4,
    reason: 'Prepare.',
  },
  approve: {
    schemaVersion: '1.0.0',
    clientRequestId: 'scope-approve',
    idempotencyKey: 'scope-idem-approve',
    actionId: 'action-1',
    manifestId: 'manifest-1',
    manifestRevision: 1,
    expectedTargetRevision: 'rev-3',
    expectedExternalRevision: 'ext-7',
    reason: 'Approved.',
  },
  preflight: {
    schemaVersion: '1.0.0',
    clientRequestId: 'scope-preflight',
    idempotencyKey: 'scope-idem-preflight',
    actionId: 'action-1',
    expectedActionRevision: 3,
    manifestRevision: 1,
    expectedExternalRevision: 'ext-7',
    reason: 'Preflight.',
  },
  execute: {
    schemaVersion: '1.0.0',
    clientRequestId: 'scope-execute',
    idempotencyKey: 'scope-idem-execute',
    actionId: 'action-1',
    expectedActionRevision: 4,
    manifestRevision: 1,
    preflightId: 'preflight-1',
    expectedExternalRevision: 'ext-7',
    reason: 'Execute.',
  },
  retry: {
    schemaVersion: '1.0.0',
    clientRequestId: 'scope-retry',
    idempotencyKey: 'scope-idem-retry',
    actionId: 'action-1',
    executionId: 'execution-1',
    sourceAttemptId: 'attempt-1',
    causationId: 'cause-1',
    reason: 'Retry.',
  },
  verify: {
    schemaVersion: '1.0.0',
    clientRequestId: 'scope-verify',
    idempotencyKey: 'scope-idem-verify',
    actionId: 'action-1',
    executionId: 'execution-1',
    expectedTargetRevision: 'rev-3',
    expectedExternalRevision: 'ext-7',
    reason: 'Verify.',
  },
  cancel: {
    schemaVersion: '1.0.0',
    clientRequestId: 'scope-cancel',
    idempotencyKey: 'scope-idem-cancel',
    actionId: 'action-1',
    expectedActionRevision: 4,
    reason: 'Cancel.',
  },
  rollback: {
    schemaVersion: '1.0.0',
    clientRequestId: 'scope-rollback',
    idempotencyKey: 'scope-idem-rollback',
    actionId: 'action-1',
    executionId: 'execution-1',
    reason: 'Rollback.',
  },
  compensation: {
    schemaVersion: '1.0.0',
    clientRequestId: 'scope-compensation',
    idempotencyKey: 'scope-idem-compensation',
    sourceActionId: 'action-1',
    sourceExecutionId: 'execution-1',
    reason: 'Compensate.',
  },
  audit: { schemaVersion: '1.0.0', actionId: 'action-1', pageSize: 50 },
} as const;

const scopeMatrixCases: ReadonlyArray<{
  readonly name: string;
  readonly scopes: readonly string[];
  readonly checks: ReadonlyArray<{
    readonly url: string;
    readonly payload: object;
    // 200 = allowed; 403 = capability denied; 404 = capability granted but the
    // referenced resource does not exist (also proves the capability passed).
    readonly expected: 200 | 403 | 404;
  }>;
}> = [
  {
    name: 'action:read grants reads but denies every governed family',
    scopes: ['action:read'],
    checks: [
      { url: '/queue', payload: scopePayloads.queue, expected: 200 },
      { url: '/validate', payload: scopePayloads.validate, expected: 403 },
      { url: '/prepare', payload: scopePayloads.prepare, expected: 403 },
      { url: '/approve', payload: scopePayloads.approve, expected: 403 },
      { url: '/preflight', payload: scopePayloads.preflight, expected: 403 },
      { url: '/execute', payload: scopePayloads.execute, expected: 403 },
      { url: '/retry', payload: scopePayloads.retry, expected: 403 },
      { url: '/verify', payload: scopePayloads.verify, expected: 403 },
      { url: '/cancel', payload: scopePayloads.cancel, expected: 403 },
      { url: '/rollback', payload: scopePayloads.rollback, expected: 403 },
      { url: '/compensations/prepare', payload: scopePayloads.compensation, expected: 403 },
      { url: '/audit', payload: scopePayloads.audit, expected: 403 },
    ],
  },
  {
    name: 'action:audit:read grants audit read only',
    scopes: ['action:audit:read'],
    checks: [
      // 404 (NOT_FOUND, resource missing) proves READ_AUDIT is granted — a
      // 403 would mean the capability was denied.
      { url: '/audit', payload: scopePayloads.audit, expected: 404 },
      { url: '/queue', payload: scopePayloads.queue, expected: 403 },
      { url: '/validate', payload: scopePayloads.validate, expected: 403 },
    ],
  },
  {
    name: 'action:execute grants the execution family but NOT approve/verify/cancel/rollback/govern',
    scopes: ['action:execute'],
    checks: [
      // 404 (NOT_FOUND, resource missing) proves PREFLIGHT/EXECUTE are granted.
      { url: '/preflight', payload: scopePayloads.preflight, expected: 404 },
      { url: '/execute', payload: scopePayloads.execute, expected: 404 },
      { url: '/validate', payload: scopePayloads.validate, expected: 403 },
      { url: '/approve', payload: scopePayloads.approve, expected: 403 },
      { url: '/verify', payload: scopePayloads.verify, expected: 403 },
      { url: '/cancel', payload: scopePayloads.cancel, expected: 403 },
      { url: '/rollback', payload: scopePayloads.rollback, expected: 403 },
      { url: '/compensations/prepare', payload: scopePayloads.compensation, expected: 403 },
      { url: '/audit', payload: scopePayloads.audit, expected: 403 },
    ],
  },
  {
    name: 'action:verify grants verify but NOT execute/cancel/rollback/audit',
    scopes: ['action:verify'],
    checks: [
      { url: '/execute', payload: scopePayloads.execute, expected: 403 },
      { url: '/cancel', payload: scopePayloads.cancel, expected: 403 },
      { url: '/rollback', payload: scopePayloads.rollback, expected: 403 },
      { url: '/audit', payload: scopePayloads.audit, expected: 403 },
    ],
  },
  {
    name: 'action:cancel grants cancel but NOT rollback/execute/verify',
    scopes: ['action:cancel'],
    checks: [
      { url: '/rollback', payload: scopePayloads.rollback, expected: 403 },
      { url: '/execute', payload: scopePayloads.execute, expected: 403 },
      { url: '/verify', payload: scopePayloads.verify, expected: 403 },
    ],
  },
  {
    name: 'action:rollback grants rollback but NOT cancel/execute/verify',
    scopes: ['action:rollback'],
    checks: [
      { url: '/cancel', payload: scopePayloads.cancel, expected: 403 },
      { url: '/execute', payload: scopePayloads.execute, expected: 403 },
      { url: '/verify', payload: scopePayloads.verify, expected: 403 },
    ],
  },
  {
    name: 'action:candidate:stage grants validate (allow) but nothing else',
    scopes: ['action:candidate:stage'],
    checks: [
      { url: '/validate', payload: scopePayloads.validate, expected: 200 },
      { url: '/approve', payload: scopePayloads.approve, expected: 403 },
      { url: '/execute', payload: scopePayloads.execute, expected: 403 },
    ],
  },
];

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

  it('reads the approval of an External Action through the protected approvals/read route', async () => {
    const cookie = await projectSession();
    const app = await buildApplication();
    const token = await csrf(app, cookie);
    const headers = { cookie, 'x-csrf-token': token.csrfToken ?? '' };
    await runLifecycle(app, headers);

    const response = await app.server.inject({
      method: 'POST',
      url: '/product-api/frontend/external-action/approvals/read',
      headers,
      payload: { schemaVersion: '1.0.0', actionId: 'action-api-1' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      approval: { approvalId: string; actionId: string; status: string };
    }>();
    expect(body.approval.actionId).toBe('action-api-1');
    expect(body.approval.status).toBe('ACTIVE');
  });

  it.each(scopeMatrixCases)(
    'enforces the least-privilege frozen scope→capability matrix: $name',
    async ({ scopes, checks }) => {
      await auth.bootstrapOwner({
        accountId: 'scope-owner',
        projectId: PROJECT_ID,
        scopes: [...scopes],
        sensitivityClearance: 'private',
      });
      const principal = await auth.findPrincipalByAccountId('scope-owner');
      if (!principal) throw new Error('Scope fixture Principal was not created.');
      const session = await auth.createSession(
        principal.principalId,
        PROJECT_ID,
        new Date(Date.now() + 60_000).toISOString(),
      );
      const app = await buildApplication();
      const cookie = `shotgun_session=${session.sessionToken}`;
      const token = await csrf(app, cookie);
      const headers = { cookie, 'x-csrf-token': token.csrfToken ?? '' };

      for (const check of checks) {
        const response = await app.server.inject({
          method: 'POST',
          url: `/product-api/frontend/external-action${check.url}`,
          headers,
          payload: check.payload,
        });
        expect(response.statusCode, `${scopes.join(',')} -> ${check.url}`).toBe(check.expected);
      }
    },
  );
});
