import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import { PostgresActionExecutionRepository } from '../../adapters/postgres-stage11/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { hashPassword } from '../../packages/authentication/src/index.js';
import { actionServerCandidate } from '../helpers/stage-11.js';
import { InMemoryActionCandidateRepository } from '../../adapters/stage11-in-memory/src/index.js';
import type { ValidationResult } from '../../packages/contracts/src/index.js';

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

describe.runIf(pool)('Stage 12.1 P0-1/2 Postgres Integration Tests', () => {
  beforeEach(async () => {
    await pool!.query(
      'TRUNCATE auth.audit_events, auth.api_tokens, auth.sessions, auth.project_memberships, auth.credentials, auth.principals, action.executions, action.preview_snapshots, action.approval_records, action.execution_audit_events CASCADE',
    );
  });
  afterAll(async () => {
    await pool!.end();
  });

  it('handles CSRF, project switching, password change, tampering resistance, and audit binding', async () => {
    const authRepository = new PostgresAuthRepository(pool!);
    const actionExecutionRepository = new PostgresActionExecutionRepository(pool!);
    const actionCandidateRepository = new InMemoryActionCandidateRepository();
    const validationRepository = {
      save: async (v: ValidationResult) => v,
      findByCandidateId: async (projectId: string, candidateId: string) => {
        return {
          validationId: 'v1',
          candidateId,
          revisionNumber: 1,
          projectId,
          sourceVersionId: 's1',
          status: 'READY' as const,
          dimensions: [],
          createdAt: new Date().toISOString(),
        } as ValidationResult;
      },
    };
    const evidenceRepository = {
      index: async () => ({ items: [], reusedCount: 0 }),
      listBySourceVersion: async () => [],
      findById: async () => undefined,
    };

    await authRepository.bootstrapOwner({
      accountId: 'owner',
      passwordHash: await hashPassword('initial-password'),
      projectId: 'shotgun',
      scopes: ['owner', 'action:approve', 'action:execute'],
      sensitivityClearance: 'private',
    });

    const app = await createApplication({
      authRepository,
      actionExecutionRepository,
      actionCandidateRepository,
      validationRepository,
      evidenceRepository,
      production: true,
    });

    const login = await app.server.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { accountId: 'owner', password: 'initial-password', projectId: 'shotgun' },
    });
    expect(login.statusCode).toBe(200);
    const setCookie = login.headers['set-cookie'];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(';')[0] ?? '';
    const csrfToken = login.json().csrfToken as string;

    const noCsrf = await app.server.inject({
      method: 'POST',
      url: '/demo/ping',
      headers: { cookie },
      payload: { message: 'hi' },
    });
    expect(noCsrf.statusCode).toBe(403);

    const switchProj = await app.server.inject({
      method: 'POST',
      url: '/auth/projects/active',
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: { projectId: 'shotgun' },
    });
    expect(switchProj.statusCode).toBe(200);

    const badPw = await app.server.inject({
      method: 'POST',
      url: '/auth/password',
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: { currentPassword: 'wrong', newPassword: 'new-password' },
    });
    expect(badPw.statusCode).toBe(400);

    const goodPw = await app.server.inject({
      method: 'POST',
      url: '/auth/password',
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: { currentPassword: 'initial-password', newPassword: 'new-password' },
    });
    expect(goodPw.statusCode).toBe(200);

    const revoked = await app.server.inject({
      method: 'POST',
      url: '/demo/ping',
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: { message: 'hi' },
    });
    expect(revoked.statusCode).toBe(401);

    const login2 = await app.server.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { accountId: 'owner', password: 'new-password', projectId: 'shotgun' },
    });
    expect(login2.statusCode).toBe(200);
    const cookie2 =
      (Array.isArray(login2.headers['set-cookie'])
        ? login2.headers['set-cookie'][0]
        : login2.headers['set-cookie']
      )?.split(';')[0] ?? '';
    const csrfToken2 = login2.json().csrfToken as string;

    const candidate = actionServerCandidate('test', { projectId: 'shotgun' });
    await actionCandidateRepository.stage(candidate);

    const previewResp = await app.server.inject({
      method: 'POST',
      url: '/actions/preview',
      headers: { cookie: cookie2, 'x-csrf-token': csrfToken2 },
      payload: {
        candidateId: candidate.candidate.candidateId,
        expectedRevision: 1,
        operationKey: 'CREATE_DRAFT',
      },
    });
    expect(previewResp.statusCode).toBe(200);
    const actionId = previewResp.json().actionId;
    const previewDigest = previewResp.json().preview.previewDigest;

    const approveRespForged = await app.server.inject({
      method: 'POST',
      url: `/actions/${actionId}/approve`,
      headers: { cookie: cookie2, 'x-csrf-token': csrfToken2 },
      payload: { expectedPreviewDigest: 'sha256:forged' },
    });
    expect(approveRespForged.statusCode).toBe(409);

    const approveResp = await app.server.inject({
      method: 'POST',
      url: `/actions/${actionId}/approve`,
      headers: { cookie: cookie2, 'x-csrf-token': csrfToken2 },
      payload: { expectedPreviewDigest: previewDigest },
    });
    expect(approveResp.statusCode).toBe(200);

    const executeResp = await app.server.inject({
      method: 'POST',
      url: `/actions/${actionId}/execute`,
      headers: { cookie: cookie2, 'x-csrf-token': csrfToken2 },
    });
    expect(executeResp.statusCode).toBe(200);

    const audits = await actionExecutionRepository.listAudit('shotgun', actionId);
    expect(audits.some((a) => a.category === 'ACTION_EXECUTION_CLAIMED')).toBe(true);

    await app.server.close();
  });
});
