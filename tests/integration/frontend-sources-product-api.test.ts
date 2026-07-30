import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import {
  InMemoryAssetStorage,
  InMemoryOriginalAssetRepository,
} from '../../adapters/stage2-in-memory/src/index.js';
import { InMemoryEvidenceRepository } from '../../adapters/stage3-in-memory/src/index.js';
import { InMemoryAuthRepository } from '../../packages/authentication/src/index.js';

const createFixture = async () => {
  const auth = new InMemoryAuthRepository();
  await auth.bootstrapOwner({
    accountId: 'sources-owner',
    projectId: 'project-1',
    scopes: ['owner'],
    sensitivityClearance: 'private',
  });
  const principal = await auth.findPrincipalByAccountId('sources-owner');
  if (!principal) throw new Error('Fixture Principal was not created.');
  const session = await auth.createSession(
    principal.principalId,
    'project-1',
    new Date(Date.now() + 60_000).toISOString(),
  );
  const repository = new InMemoryOriginalAssetRepository();
  const storage = new InMemoryAssetStorage();
  const evidence = new InMemoryEvidenceRepository();
  const bytes = Buffer.from('Original evidence', 'utf8');
  const contentHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const storageKey = await storage.put(contentHash, bytes);
  const stored = await repository.store({
    submissionId: 'submission-1',
    projectId: 'project-1',
    actorId: principal.principalId,
    channel: 'file_upload',
    materialKind: 'plain_text',
    mediaType: 'text/markdown',
    originalFileName: 'evidence.md',
    contentHash,
    sizeBytes: bytes.byteLength,
    storageKey,
    accessScope: ['owner'],
    sensitivity: 'internal',
    createdAt: '2026-07-30T12:00:00.000Z',
  });
  const application = await createApplication({
    authRepository: auth,
    originalAssetRepository: repository,
    assetStorage: storage,
    evidenceRepository: evidence,
  });
  const cookie = `shotgun_session=${session.sessionToken}`;
  const csrf = (
    await application.server.inject({
      method: 'GET',
      url: '/api/v1/security/csrf',
      headers: { cookie },
    })
  ).json<{ csrfToken: string }>().csrfToken;
  return { application, cookie, csrf, stored };
};

describe('Frontend Sources Product API', () => {
  it('serves protected bounded Library, detail, history and explicit Version Preview', async () => {
    const { application, cookie, csrf, stored } = await createFixture();
    const pageResponse = await application.server.inject({
      method: 'POST',
      url: '/product-api/frontend/sources/query',
      headers: { cookie, 'x-csrf-token': csrf },
      payload: {
        schemaVersion: '1.0.0',
        query: 'evidence',
        filters: {},
        sort: 'UPDATED_DESC',
        limit: 20,
      },
    });
    expect(pageResponse.statusCode).toBe(200);
    expect(pageResponse.json()).toMatchObject({
      page: {
        projectId: 'project-1',
        items: [
          {
            sourceId: stored.sourceId,
            selectedSourceVersionId: stored.sourceVersionId,
            label: 'evidence.md',
          },
        ],
      },
    });

    const detail = await application.server.inject({
      method: 'GET',
      url: `/product-api/frontend/sources/${stored.sourceId}`,
      headers: { cookie },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      source: {
        sourceId: stored.sourceId,
        currentSourceVersionId: stored.sourceVersionId,
      },
    });

    const history = await application.server.inject({
      method: 'GET',
      url: `/product-api/frontend/sources/${stored.sourceId}/versions?selectedSourceVersionId=${stored.sourceVersionId}`,
      headers: { cookie },
    });
    expect(history.statusCode).toBe(200);
    expect(history.json()).toMatchObject({
      history: {
        selectedSourceVersionId: stored.sourceVersionId,
        versions: [{ sourceVersionId: stored.sourceVersionId }],
      },
    });

    const preview = await application.server.inject({
      method: 'GET',
      url: `/product-api/frontend/sources/${stored.sourceId}/versions/${stored.sourceVersionId}/preview?mode=ORIGINAL`,
      headers: { cookie },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      preview: {
        sourceId: stored.sourceId,
        sourceVersionId: stored.sourceVersionId,
        text: 'Original evidence',
        mode: 'ORIGINAL',
      },
    });
    await application.server.close();
  });

  it('requires CSRF for protected Library search and rejects browser authority headers', async () => {
    const { application, cookie } = await createFixture();
    const withoutCsrf = await application.server.inject({
      method: 'POST',
      url: '/product-api/frontend/sources/query',
      headers: { cookie },
      payload: {
        schemaVersion: '1.0.0',
        filters: {},
        sort: 'UPDATED_DESC',
        limit: 20,
      },
    });
    expect(withoutCsrf.statusCode).toBe(403);
    expect(withoutCsrf.json()).toMatchObject({ code: 'REQUEST_ORIGIN_DENIED' });

    const injected = await application.server.inject({
      method: 'GET',
      url: '/product-api/frontend/sources/browser-source',
      headers: { cookie, 'x-project-id': 'browser-project' },
    });
    expect(injected.statusCode).toBe(400);
    expect(injected.json()).toMatchObject({ code: 'LEGACY_SECURITY_HEADER_FORBIDDEN' });
    await application.server.close();
  });

  it('masks inaccessible Source identity as NOT_FOUND', async () => {
    const { application, cookie } = await createFixture();
    const response = await application.server.inject({
      method: 'GET',
      url: '/product-api/frontend/sources/not-in-project',
      headers: { cookie },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      code: 'NOT_FOUND',
      message: 'The requested Source resource was not found.',
    });
    await application.server.close();
  });
});
