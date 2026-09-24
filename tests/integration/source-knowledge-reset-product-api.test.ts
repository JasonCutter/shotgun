import { afterEach, describe, expect, it } from 'vitest';

import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import { InMemoryAuthRepository } from '../../packages/authentication/src/index.js';
import type {
  KnowledgeResetCoordinatorPort,
  KnowledgeResetPreviewV1,
  KnowledgeResetRequestV1,
} from '../../modules/source-knowledge-reset/src/index.js';

const projectId = 'knowledge-reset-project';
const manifestDigest = `sha256:${'a'.repeat(64)}` as const;
const ownerManifestDigest = `sha256:${'c'.repeat(64)}` as const;
const configurationDigest = `sha256:${'b'.repeat(64)}` as const;
const counts = {
  sourceCount: 2,
  sourceVersionCount: 3,
  sourceDerivedRecordCount: 14,
  redactedHistoryRecordCount: 4,
  rebuildProjectionCount: 5,
  sharedAssetCount: 1,
  blockedRecordCount: 0,
} as const;

const preview: KnowledgeResetPreviewV1 = {
  schemaVersion: '1.0.0',
  previewId: 'preview-1',
  projectId,
  manifestDigest,
  ownerManifestDigest,
  projectRevision: 1,
  knowledgeEpoch: 0,
  expiresAt: '2026-09-23T02:00:00.000Z',
  counts,
  blockers: [],
  preservedConfigurationDigest: configurationDigest,
  canConfirm: true,
};

const request: KnowledgeResetRequestV1 = {
  schemaVersion: '1.0.0',
  requestId: 'request-1',
  projectId,
  projectRevision: 1,
  manifestDigest,
  state: 'APPROVED',
  expectedKnowledgeEpoch: 0,
  knowledgeEpoch: 1,
  blockerCodes: [],
  counts,
  completedSteps: [],
  casStatus: 'NOT_STARTED',
  backupStatus: 'PENDING',
  createdAt: '2026-09-23T01:00:00.000Z',
  updatedAt: '2026-09-23T01:00:00.000Z',
};

describe('Source knowledge reset Product API', () => {
  const applications: Awaited<ReturnType<typeof createApplication>>[] = [];

  afterEach(async () => {
    await Promise.all(applications.splice(0).map((application) => application.server.close()));
  });

  it('requires the active Owner browser session and CSRF before previewing', async () => {
    const auth = new InMemoryAuthRepository();
    await auth.bootstrapOwner({
      accountId: 'knowledge-reset-owner',
      projectId,
      scopes: ['owner'],
      sensitivityClearance: 'private',
    });
    const principal = await auth.findPrincipalByAccountId('knowledge-reset-owner');
    if (!principal) throw new Error('Reset Owner fixture was not created.');
    const session = await auth.createSession(
      principal.principalId,
      projectId,
      new Date(Date.now() + 60_000).toISOString(),
    );
    let previewCalls = 0;
    const coordinator: KnowledgeResetCoordinatorPort = {
      async preview(input) {
        previewCalls += 1;
        expect(input).toEqual({ projectId, actorPrincipalId: principal.principalId });
        return preview;
      },
      async confirm() {
        return { request, replayed: false };
      },
      async getRequest(input) {
        return input.projectId === projectId && input.requestId === request.requestId
          ? request
          : null;
      },
    };
    const application = await createApplication({
      authRepository: auth,
      sourceKnowledgeResetCoordinator: coordinator,
    });
    applications.push(application);
    const cookie = `shotgun_session=${session.sessionToken}`;

    const noCsrf = await application.server.inject({
      method: 'POST',
      url: `/product-api/frontend/projects/${projectId}/source-knowledge-reset/preview`,
      headers: { cookie },
      payload: {},
    });
    expect(noCsrf.statusCode).toBe(403);

    const csrf = (
      await application.server.inject({
        method: 'GET',
        url: '/api/v1/security/csrf',
        headers: { cookie },
      })
    ).json<{ csrfToken: string }>().csrfToken;
    const headers = { cookie, 'x-csrf-token': csrf };
    const inactiveProject = await application.server.inject({
      method: 'POST',
      url: '/product-api/frontend/projects/another-project/source-knowledge-reset/preview',
      headers,
      payload: {},
    });
    expect(inactiveProject.statusCode).toBe(403);

    const response = await application.server.inject({
      method: 'POST',
      url: `/product-api/frontend/projects/${projectId}/source-knowledge-reset/preview`,
      headers,
      payload: {},
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({ preview });
    expect(previewCalls).toBe(1);
  });

  it('binds confirm to the preview and matching idempotency header, then reads status', async () => {
    const auth = new InMemoryAuthRepository();
    await auth.bootstrapOwner({
      accountId: 'knowledge-reset-confirm-owner',
      projectId,
      scopes: ['owner'],
      sensitivityClearance: 'private',
    });
    const principal = await auth.findPrincipalByAccountId('knowledge-reset-confirm-owner');
    if (!principal) throw new Error('Reset Owner fixture was not created.');
    const session = await auth.createSession(
      principal.principalId,
      projectId,
      new Date(Date.now() + 60_000).toISOString(),
    );
    const calls: string[] = [];
    const coordinator: KnowledgeResetCoordinatorPort = {
      async preview() {
        return preview;
      },
      async confirm(input) {
        calls.push(input.confirmation.idempotencyKey);
        return { request, replayed: false };
      },
      async getRequest(input) {
        return input.projectId === projectId && input.requestId === request.requestId
          ? request
          : null;
      },
    };
    const application = await createApplication({
      authRepository: auth,
      sourceKnowledgeResetCoordinator: coordinator,
    });
    applications.push(application);
    const cookie = `shotgun_session=${session.sessionToken}`;
    const csrf = (
      await application.server.inject({
        method: 'GET',
        url: '/api/v1/security/csrf',
        headers: { cookie },
      })
    ).json<{ csrfToken: string }>().csrfToken;
    const headers = { cookie, 'x-csrf-token': csrf };
    const confirmation = {
      previewId: preview.previewId,
      manifestDigest,
      expectedProjectRevision: preview.projectRevision,
      expectedKnowledgeEpoch: preview.knowledgeEpoch,
      idempotencyKey: 'reset-confirmation-1',
      confirmIrreversibleReset: true,
    };

    const mismatchedHeader = await application.server.inject({
      method: 'POST',
      url: `/product-api/frontend/projects/${projectId}/source-knowledge-reset/confirm`,
      headers: { ...headers, 'x-idempotency-key': 'another-key' },
      payload: confirmation,
    });
    expect(mismatchedHeader.statusCode).toBe(409);
    expect(calls).toEqual([]);

    const confirmed = await application.server.inject({
      method: 'POST',
      url: `/product-api/frontend/projects/${projectId}/source-knowledge-reset/confirm`,
      headers: { ...headers, 'x-idempotency-key': confirmation.idempotencyKey },
      payload: confirmation,
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json()).toEqual({ request, replayed: false });
    expect(calls).toEqual([confirmation.idempotencyKey]);

    const status = await application.server.inject({
      method: 'GET',
      url: `/product-api/frontend/projects/${projectId}/source-knowledge-reset/${request.requestId}`,
      headers,
    });
    expect(status.statusCode, status.body).toBe(200);
    expect(status.json()).toEqual({ request });
  });
});
