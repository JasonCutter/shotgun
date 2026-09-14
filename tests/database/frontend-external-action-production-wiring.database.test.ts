import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

import { PostgresExternalActionStore } from '../../adapters/frontend-external-action-postgres/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import { startShotgunApplication } from '../../assemblies/shotgun-app/src/application.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

let databaseUrl: string | undefined;
if (process.env.TEST_DATABASE_URL?.trim()) {
  try {
    databaseUrl = await requireTestDatabaseTarget();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ECONNREFUSED|ENOTFOUND|timeout|connect/i.test(message)) {
      console.warn(`External Action production wiring proof skipped: ${message}`);
    } else {
      throw error;
    }
  }
}

const pool: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

const targetRef = {
  schemaVersion: '1.0.0' as const,
  targetKind: 'KNOWN_TARGET' as const,
  targetId: 'production-wiring-target',
  targetRevision: 'target-revision-1',
  externalRevision: 'external-revision-1',
};

const parameterRef = {
  schemaVersion: '1.0.0' as const,
  parameterId: 'production-wiring-parameters',
  parameterRevision: 1,
  parameterDigest: `sha256:${'a'.repeat(64)}`,
};

const credential = {
  schemaVersion: '1.0.0' as const,
  connectorId: 'fake-connector',
  name: 'Fake Connector',
  status: 'CONFIGURED' as const,
  maskedCredential: 'ab••••••••cd',
  capabilities: ['TEST', 'ROTATE', 'REVOKE'] as const,
};

const createBudget = (projectId: string) => ({
  schemaVersion: '1.0.0' as const,
  projectId,
  status: 'OK' as const,
  usedExecutions: 0,
  remainingExecutions: 10,
  softLimit: 8,
  hardLimit: 10,
  exhausted: false,
});

const post = async <T>(
  server: FastifyInstance,
  cookie: string,
  url: string,
  payload: Record<string, unknown>,
): Promise<T> => {
  const csrfResponse = await server.inject({
    method: 'GET',
    url: '/api/v1/security/csrf',
    headers: { cookie },
  });
  expect(csrfResponse.statusCode, csrfResponse.body).toBe(200);
  const csrfToken = csrfResponse.json<{ csrfToken: string }>().csrfToken;

  const response = await server.inject({
    method: 'POST',
    url,
    headers: { cookie, 'x-csrf-token': csrfToken },
    payload,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<T>();
};

const detail = async (server: FastifyInstance, cookie: string, actionId: string) =>
  post<{ action: { actionRevision: number; actionId: string; status: string } }>(
    server,
    cookie,
    '/product-api/frontend/external-action/actions/detail',
    { schemaVersion: '1.0.0', actionId },
  );

const createProjectAndSession = async (input: {
  readonly pool: Pool;
  readonly suffix: string;
  readonly projectId: string;
}) => {
  const auth = new PostgresAuthRepository(input.pool);
  const principal = await auth.bootstrapLocalOwnerPrincipal({
    accountId: `external-action-wiring-owner-${input.suffix}`,
  });
  await input.pool.query(
    `INSERT INTO project_admin.projects
       (id, name, status, active, created_at, updated_at, revision)
     VALUES ($1, $2, 'ACTIVE', true, now(), now(), 1)`,
    [input.projectId, `External Action wiring ${input.suffix}`],
  );
  await input.pool.query(
    `INSERT INTO auth.project_memberships
       (principal_id, project_id, scopes, sensitivity_clearance, is_owner)
     VALUES ($1, $2, ARRAY['owner'], 'private', true)`,
    [principal.principalId, input.projectId],
  );
  const session = await auth.createSession(
    principal.principalId,
    input.projectId,
    '2099-01-01T00:00:00.000Z',
  );
  return {
    cookie: `shotgun_session=${session.sessionToken}`,
  };
};

const seedProductState = async (projectId: string) => {
  const store = new PostgresExternalActionStore(pool!);
  await store.transaction(async (repositories) => {
    await repositories.credentials.insert(credential);
    await repositories.budgets.insert(createBudget(projectId));
  });
};

const createAction = async (server: FastifyInstance, cookie: string, actionId: string) => {
  const prefix = `production-wiring-${actionId}`;
  const validated = await post<{
    actionId: string;
    candidate: { candidateRevision: number };
  }>(server, cookie, '/product-api/frontend/external-action/validate', {
    schemaVersion: '1.0.0',
    clientRequestId: `${prefix}-validate-request`,
    idempotencyKey: `${prefix}-validate-idempotency`,
    actionId,
    candidateId: `${prefix}-candidate`,
    operation: 'UPDATE_REVERSIBLE',
    targetRef,
    parameterRef,
    evidenceRefs: [`${prefix}-evidence`],
  });
  const validatedDetail = await detail(server, cookie, actionId);
  const prepared = await post<{
    manifest: { manifestId: string; manifestRevision: number };
  }>(server, cookie, '/product-api/frontend/external-action/prepare', {
    schemaVersion: '1.0.0',
    clientRequestId: `${prefix}-prepare-request`,
    idempotencyKey: `${prefix}-prepare-idempotency`,
    actionId,
    expectedActionRevision: validatedDetail.action.actionRevision,
    reason: 'Prepare production wiring restart proof.',
  });
  await post(server, cookie, '/product-api/frontend/external-action/approve', {
    schemaVersion: '1.0.0',
    clientRequestId: `${prefix}-approve-request`,
    idempotencyKey: `${prefix}-approve-idempotency`,
    actionId,
    manifestId: prepared.manifest.manifestId,
    manifestRevision: prepared.manifest.manifestRevision,
    expectedTargetRevision: targetRef.targetRevision,
    expectedExternalRevision: targetRef.externalRevision,
    reason: 'Approve production wiring restart proof.',
  });
  const approvedDetail = await detail(server, cookie, actionId);
  const preflighted = await post<{
    preflight: { preflightId: string };
  }>(server, cookie, '/product-api/frontend/external-action/preflight', {
    schemaVersion: '1.0.0',
    clientRequestId: `${prefix}-preflight-request`,
    idempotencyKey: `${prefix}-preflight-idempotency`,
    actionId,
    expectedActionRevision: approvedDetail.action.actionRevision,
    manifestRevision: prepared.manifest.manifestRevision,
    expectedExternalRevision: targetRef.externalRevision,
    reason: 'Preflight production wiring restart proof.',
  });
  const preflightedDetail = await detail(server, cookie, actionId);
  const executeRequest = {
    schemaVersion: '1.0.0' as const,
    clientRequestId: `${prefix}-execute-request`,
    idempotencyKey: `${prefix}-execute-idempotency`,
    actionId,
    expectedActionRevision: preflightedDetail.action.actionRevision,
    manifestRevision: prepared.manifest.manifestRevision,
    preflightId: preflighted.preflight.preflightId,
    expectedExternalRevision: targetRef.externalRevision,
    reason: 'Execute production wiring restart proof.',
  };
  const executed = await post<{
    actionId: string;
    execution: { executionId: string; status: string };
    attempt: { attemptId: string; attemptNumber: number; status: string };
  }>(server, cookie, '/product-api/frontend/external-action/execute', executeRequest);
  return { validated, executeRequest, executed };
};

const startForTest = (assetRoot: string) =>
  startShotgunApplication({
    databaseUrl: databaseUrl!,
    assetRoot,
    stagingSecret: 'external-action-wiring-test-staging-secret',
    noSignals: true,
    disableAskWorker: true,
    recoveryIntervalMs: false,
  });

afterAll(async () => {
  await pool?.end();
});

describe.runIf(pool)('RUS-1D-A Product External Action production wiring', () => {
  it('persists Product state, command identity, and Activity reads across application restart', async () => {
    await migrateUpTo(undefined, databaseUrl!);
    const suffix = randomUUID();
    const projectId = `external-action-wiring-${suffix}`;
    const actionId = `external-action-wiring-action-${suffix}`;
    const assetRoot = await mkdtemp(path.join(tmpdir(), 'shotgun-external-action-wiring-'));
    const session = await createProjectAndSession({ pool: pool!, suffix, projectId });
    await seedProductState(projectId);

    let firstApplication: Awaited<ReturnType<typeof startForTest>> | undefined;
    let secondApplication: Awaited<ReturnType<typeof startForTest>> | undefined;
    try {
      firstApplication = await startForTest(assetRoot);
      const first = await createAction(firstApplication.server, session.cookie, actionId);
      const firstDetail = await detail(firstApplication.server, session.cookie, actionId);
      expect(firstDetail.action).toMatchObject({ actionId, status: 'SUCCEEDED' });

      await post(
        firstApplication.server,
        session.cookie,
        '/product-api/frontend/activity/refresh',
        { schemaVersion: '1.0.0' },
      );
      const firstQueue = await post<{
        items: Array<{ root: { domainKind: string; domainResourceId: string } }>;
      }>(firstApplication.server, session.cookie, '/product-api/frontend/activity/queue', {
        schemaVersion: '1.0.0',
        domainKinds: ['EXTERNAL_ACTION'],
        limit: 50,
      });
      const firstActivity = firstQueue.items.find(
        (item) => item.root.domainResourceId === actionId,
      );
      expect(firstActivity?.root).toMatchObject({
        domainKind: 'EXTERNAL_ACTION',
        domainResourceId: actionId,
      });
      const firstActivityDetail = await post<{ root: { domainResourceId: string } }>(
        firstApplication.server,
        session.cookie,
        '/product-api/frontend/activity/detail',
        {
          schemaVersion: '1.0.0',
          domainKind: 'EXTERNAL_ACTION',
          activityId: actionId,
          domainResourceKind: 'ExternalAction',
          domainResourceId: actionId,
        },
      );
      expect(firstActivityDetail.root.domainResourceId).toBe(actionId);

      await firstApplication.close();
      firstApplication = undefined;
      secondApplication = await startForTest(assetRoot);

      const replayed = await post(
        secondApplication.server,
        session.cookie,
        '/product-api/frontend/external-action/execute',
        first.executeRequest,
      );
      expect(replayed).toEqual(first.executed);
      const restartedDetail = await detail(secondApplication.server, session.cookie, actionId);
      expect(restartedDetail.action).toMatchObject({ actionId, status: 'SUCCEEDED' });

      await post(
        secondApplication.server,
        session.cookie,
        '/product-api/frontend/activity/refresh',
        { schemaVersion: '1.0.0' },
      );
      const restartedActivityDetail = await post<{ root: { domainResourceId: string } }>(
        secondApplication.server,
        session.cookie,
        '/product-api/frontend/activity/detail',
        {
          schemaVersion: '1.0.0',
          domainKind: 'EXTERNAL_ACTION',
          activityId: actionId,
          domainResourceKind: 'ExternalAction',
          domainResourceId: actionId,
        },
      );
      expect(restartedActivityDetail.root.domainResourceId).toBe(actionId);

      const counts = await pool!.query<{
        aggregates: number;
        executions: number;
        attempts: number;
      }>(
        `SELECT
           (SELECT count(*)::int FROM frontend_external_action.aggregates WHERE action_id = $1) AS aggregates,
           (SELECT count(*)::int
              FROM frontend_external_action.executions
             WHERE action_id = $1) AS executions,
           (SELECT count(*)::int
              FROM frontend_external_action.attempts a
              JOIN frontend_external_action.executions e ON e.execution_id = a.execution_id
             WHERE e.action_id = $1) AS attempts`,
        [actionId],
      );
      expect(counts.rows[0]).toEqual({ aggregates: 1, executions: 1, attempts: 1 });
    } finally {
      await secondApplication?.close();
      await firstApplication?.close();
      await rm(assetRoot, { recursive: true, force: true });
    }
  });
});
