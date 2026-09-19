import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import { configureSourcesWriteRuntime } from '../../assemblies/shotgun-app/src/product-api/sources-write-runtime.js';
import { InMemoryFrontendCommandGateway } from '../../adapters/frontend-command-gateway-in-memory/src/index.js';
import {
  InMemoryAssetStorage,
  InMemoryOriginalAssetRepository,
} from '../../adapters/stage2-in-memory/src/index.js';
import { InMemoryEvidenceRepository } from '../../adapters/stage3-in-memory/src/index.js';
import {
  InMemoryAIProviderCallRepository,
  InMemoryCandidateRepository,
} from '../../adapters/stage4-in-memory/src/index.js';
import { InMemoryAuthRepository } from '../../packages/authentication/src/index.js';
import {
  sha256Text,
  ShotgunError,
  type ClaimCandidate,
} from '../../packages/contracts/src/index.js';
import type { AIProviderExecutionResolverPort } from '../../modules/ai-provider/src/index.js';

const FIXTURE_REVISION_ID = '00000000-0000-4000-8000-000000000001';
const FIXTURE_INDEXING_RESULT_ID = 'indexing-result-1';
const FIXTURE_NO_EVIDENCE_INDEXING_RESULT_ID = 'indexing-result-no-evidence';

const createFixture = async (
  includeEmptyQuoteContextEvidence = false,
  includeUsableSentenceEvidence = false,
  withWriteRuntime = false,
  aiProviderExecutionResolver?: AIProviderExecutionResolverPort,
  includeNoEvidenceAuthority = false,
) => {
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
  const hasIndexedEvidence = includeEmptyQuoteContextEvidence || includeUsableSentenceEvidence;
  const hasEvidenceAuthority = hasIndexedEvidence || includeNoEvidenceAuthority;
  const bytes = Buffer.from('\uFEFFOriginal evidence', 'utf8');
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
  if (hasIndexedEvidence) {
    await evidence.index([
      {
        revisionId: FIXTURE_REVISION_ID,
        projectId: 'project-1',
        sourceId: stored.sourceId,
        sourceVersionId: stored.sourceVersionId,
        pointer: '',
        nodeKind: includeUsableSentenceEvidence ? 'sentence' : 'document',
        origin: 'source',
        position: { type: 'TextPositionSelector', start: 0, end: 17, unit: 'unicode-code-point' },
        quote: { type: 'TextQuoteSelector', exact: 'Original evidence', suffix: '' },
        selectors: [],
        exactHash: sha256Text('Original evidence'),
        accessScope: ['owner'],
        sensitivity: 'internal',
        createdAt: '2026-07-30T12:00:00.000Z',
      },
    ]);
  }
  const aiProviderRepository = new InMemoryAIProviderCallRepository();
  const candidateRepository = new InMemoryCandidateRepository();
  const commandGateway = withWriteRuntime ? new InMemoryFrontendCommandGateway() : undefined;
  const sourcesProjectionRepository = {
    async listProjectSourceVersions(projectId: string) {
      const records = await repository.listProjectSourceVersions(projectId);
      if (!hasEvidenceAuthority) return records;
      return records.map((record) => ({
        ...record,
        stage3State: hasIndexedEvidence ? ('STAGE3_COMPLETED' as const) : ('NO_EVIDENCE' as const),
        activeEvidenceRevision: {
          indexingResultId: hasIndexedEvidence
            ? FIXTURE_INDEXING_RESULT_ID
            : FIXTURE_NO_EVIDENCE_INDEXING_RESULT_ID,
          sourceId: record.sourceId,
          sourceVersionId: record.sourceVersionId,
          revisionId: FIXTURE_REVISION_ID,
          status: hasIndexedEvidence ? ('INDEXED' as const) : ('NO_EVIDENCE' as const),
          evidenceCount: hasIndexedEvidence ? 1 : 0,
        },
      }));
    },
  };
  const application = await createApplication({
    authRepository: auth,
    originalAssetRepository: repository,
    assetStorage: storage,
    evidenceRepository: evidence,
    aiProviderRepository,
    candidateRepository,
    sourcesProjectionRepository,
    frontendCommandGateway: commandGateway,
    aiProviderExecutionResolver,
  });
  const removeWriteRuntime = withWriteRuntime
    ? configureSourcesWriteRuntime({
        commandGateway: commandGateway!,
        // The mutation under test does not use staging or the intake Product
        // service; browser fixture write routes provide those in their own
        // integration composition.
        staging: {} as never,
        productService: {} as never,
      })
    : () => {};
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await application.server.close();
    removeWriteRuntime();
  };
  const cookie = `shotgun_session=${session.sessionToken}`;
  const csrf = (
    await application.server.inject({
      method: 'GET',
      url: '/api/v1/security/csrf',
      headers: { cookie },
    })
  ).json<{ csrfToken: string }>().csrfToken;
  return {
    application,
    cookie,
    csrf,
    stored,
    auth,
    repository,
    storage,
    evidence,
    aiProviderRepository,
    candidateRepository,
    removeWriteRuntime,
    close,
  };
};

const reextractRequest = (input: {
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly payloadExtensions?: Record<string, unknown>;
}) => ({
  envelopeVersion: '1.0.0',
  commandType: 'sources.candidate.reextract.v1',
  commandSchemaVersion: '1.0.0',
  clientRequestId: input.clientRequestId,
  idempotencyKey: input.idempotencyKey,
  projectContext: {
    activeProjectId: 'project-1',
    targetProjectId: 'project-1',
    resourceProjectId: 'project-1',
  },
  policyBinding: { mode: 'CURRENT' },
  preconditions: [],
  clientIssuedAt: '2026-07-30T12:01:00.000Z',
  payload: {
    sourceId: input.sourceId,
    sourceVersionId: input.sourceVersionId,
    ...input.payloadExtensions,
  },
});

const candidateFor = (
  candidateId: string,
  sourceVersionId: string,
  overrides: Partial<ClaimCandidate> = {},
): ClaimCandidate =>
  ({
    candidateId,
    batchId: `batch-${candidateId}`,
    revisionNumber: 1,
    projectId: 'project-1',
    sourceVersionId,
    claimText: `Claim ${candidateId}`,
    evidenceIds: [`evidence-${candidateId}`],
    evidenceMode: 'DIRECT_EVIDENCE',
    extractionProfile: 'direct-only',
    status: 'READY',
    providerCall: {} as ClaimCandidate['providerCall'],
    accessScope: ['owner'],
    sensitivity: 'internal',
    createdAt: '2026-07-30T12:00:00.000Z',
    ...overrides,
  }) as ClaimCandidate;

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
        text: '\uFEFFOriginal evidence',
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

  it('returns Evidence with an empty TextQuoteSelector suffix as a valid 200 response', async () => {
    const { application, cookie, stored } = await createFixture(true);
    const response = await application.server.inject({
      method: 'GET',
      url: `/product-api/frontend/sources/${stored.sourceId}/versions/${stored.sourceVersionId}/evidence`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      evidence: {
        items: [
          {
            exactText: 'Original evidence',
            locators: [
              { type: 'TextPositionSelector', start: 0, end: 17 },
              { type: 'TextQuoteSelector', exact: 'Original evidence', suffix: '' },
            ],
          },
        ],
      },
    });
    await application.server.close();
  });

  it('returns only the bounded, authorized Candidate projection for an exact SourceVersion', async () => {
    const fixture = await createFixture(true);
    const [indexedEvidence] = await fixture.evidence.listByRevision(
      'project-1',
      fixture.stored.sourceVersionId,
      FIXTURE_REVISION_ID,
    );
    if (!indexedEvidence) throw new Error('Candidate fixture Evidence was not indexed.');
    await fixture.candidateRepository.saveBatch({
      batchId: 'candidate-batch-1',
      projectId: 'project-1',
      sourceVersionId: fixture.stored.sourceVersionId,
      revisionId: FIXTURE_REVISION_ID,
      idempotencyKey: 'candidate-batch-1',
      providerCall: {} as ClaimCandidate['providerCall'],
      candidates: [
        candidateFor('candidate-a', fixture.stored.sourceVersionId, {
          batchId: 'candidate-batch-1',
          claimText: 'Visible candidate A',
          evidenceIds: [indexedEvidence.evidenceId],
        }),
        candidateFor('candidate-pending', fixture.stored.sourceVersionId, {
          batchId: 'candidate-batch-1',
          status: 'PENDING_VALIDATION',
          claimText: 'Pending candidate',
          evidenceIds: [indexedEvidence.evidenceId],
        }),
      ],
      createdAt: '2026-07-30T12:00:00.000Z',
    });

    const response = await fixture.application.server.inject({
      method: 'GET',
      url: `/product-api/frontend/sources/${fixture.stored.sourceId}/versions/${fixture.stored.sourceVersionId}/candidates`,
      headers: { cookie: fixture.cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      candidates: {
        projectId: 'project-1',
        sourceId: fixture.stored.sourceId,
        sourceVersionId: fixture.stored.sourceVersionId,
        items: [
          {
            candidateId: 'candidate-a',
            revisionNumber: 1,
            status: 'READY',
            claimText: 'Visible candidate A',
            sourceVersionId: fixture.stored.sourceVersionId,
          },
          { candidateId: 'candidate-pending', status: 'PENDING_VALIDATION' },
        ],
      },
    });
    expect(response.json().candidates.items[0]).not.toHaveProperty('providerCall');
    expect(response.json().candidates.items[0]).not.toHaveProperty('accessScope');
    expect(response.json().candidates.items[0]).not.toHaveProperty('sensitivity');

    const rebound = await fixture.application.server.inject({
      method: 'GET',
      url: `/product-api/frontend/sources/${fixture.stored.sourceId}/versions/not-this-version/candidates`,
      headers: { cookie: fixture.cookie },
    });
    expect(rebound.statusCode).toBe(404);

    const arbitrary = await fixture.application.server.inject({
      method: 'GET',
      url: '/product-api/frontend/sources/not-a-source/versions/not-a-version/candidates',
      headers: { cookie: fixture.cookie },
    });
    expect(arbitrary.statusCode).toBe(404);
    await fixture.close();
  });

  it('re-extracts the existing SourceVersion through Stage 4 with Product idempotency', async () => {
    const fixture = await createFixture(false, true, true);
    const {
      application,
      cookie,
      csrf,
      stored,
      repository,
      candidateRepository,
      aiProviderRepository,
      evidence,
    } = fixture;
    try {
      const invoke = (body: ReturnType<typeof reextractRequest>) =>
        application.server.inject({
          method: 'POST',
          url: `/product-api/frontend/sources/${stored.sourceId}/versions/${stored.sourceVersionId}/reextract-candidates`,
          headers: { cookie, 'x-csrf-token': csrf },
          payload: body,
        });
      const first = await invoke(
        reextractRequest({
          sourceId: stored.sourceId,
          sourceVersionId: stored.sourceVersionId,
          clientRequestId: 'reextract-request-1',
          idempotencyKey: 'reextract-idempotency-1',
        }),
      );
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({
        reextract: {
          projectId: 'project-1',
          sourceId: stored.sourceId,
          sourceVersionId: stored.sourceVersionId,
          status: 'ACCEPTED',
        },
        outcome: { outcomeState: 'COMPLETED' },
      });
      const firstCommandId = first.json().outcome.commandId;

      const replay = await invoke(
        reextractRequest({
          sourceId: stored.sourceId,
          sourceVersionId: stored.sourceVersionId,
          clientRequestId: 'reextract-request-1',
          idempotencyKey: 'reextract-idempotency-1',
        }),
      );
      expect(replay.statusCode).toBe(200);
      expect(replay.json().outcome.commandId).toBe(firstCommandId);

      const second = await invoke(
        reextractRequest({
          sourceId: stored.sourceId,
          sourceVersionId: stored.sourceVersionId,
          clientRequestId: 'reextract-request-2',
          idempotencyKey: 'reextract-idempotency-2',
        }),
      );
      expect(second.statusCode).toBe(200);
      expect(second.json().outcome.commandId).not.toBe(firstCommandId);

      expect(
        await candidateRepository.listBySourceVersion('project-1', stored.sourceVersionId),
      ).toHaveLength(2);
      expect(aiProviderRepository.list()).toHaveLength(2);
      expect(await evidence.listBySourceVersion('project-1', stored.sourceVersionId)).toHaveLength(
        1,
      );
      expect(await repository.listProjectSourceVersions('project-1')).toHaveLength(1);
    } finally {
      await fixture.close();
    }
  });

  it('fails closed for missing Evidence, cross-project identity, and browser AI authority', async () => {
    const noEvidence = await createFixture(false, false, true, undefined, true);
    try {
      const noEvidenceResponse = await noEvidence.application.server.inject({
        method: 'POST',
        url: `/product-api/frontend/sources/${noEvidence.stored.sourceId}/versions/${noEvidence.stored.sourceVersionId}/reextract-candidates`,
        headers: { cookie: noEvidence.cookie, 'x-csrf-token': noEvidence.csrf },
        payload: reextractRequest({
          sourceId: noEvidence.stored.sourceId,
          sourceVersionId: noEvidence.stored.sourceVersionId,
          clientRequestId: 'reextract-no-evidence',
          idempotencyKey: 'reextract-no-evidence',
        }),
      });
      expect(noEvidenceResponse.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(noEvidence.aiProviderRepository.list()).toHaveLength(0);
    } finally {
      await noEvidence.close();
    }

    const guarded = await createFixture(false, true, true);
    try {
      const otherBytes = Buffer.from('Other project evidence', 'utf8');
      const otherHash = `sha256:${createHash('sha256').update(otherBytes).digest('hex')}`;
      const otherStorageKey = await guarded.storage.put(otherHash, otherBytes);
      const otherSource = await guarded.repository.store({
        submissionId: 'submission-other-project',
        projectId: 'project-2',
        actorId: 'other-project-owner',
        channel: 'file_upload',
        materialKind: 'plain_text',
        mediaType: 'text/markdown',
        originalFileName: 'other.md',
        contentHash: otherHash,
        sizeBytes: otherBytes.byteLength,
        storageKey: otherStorageKey,
        accessScope: ['owner'],
        sensitivity: 'internal',
        createdAt: '2026-07-30T12:00:00.000Z',
      });
      const crossProject = await guarded.application.server.inject({
        method: 'POST',
        url: `/product-api/frontend/sources/${otherSource.sourceId}/versions/${otherSource.sourceVersionId}/reextract-candidates`,
        headers: { cookie: guarded.cookie, 'x-csrf-token': guarded.csrf },
        payload: reextractRequest({
          sourceId: otherSource.sourceId,
          sourceVersionId: otherSource.sourceVersionId,
          clientRequestId: 'reextract-cross-project',
          idempotencyKey: 'reextract-cross-project',
        }),
      });
      expect(crossProject.statusCode).toBe(404);
      expect(crossProject.json()).toMatchObject({ code: 'NOT_FOUND' });

      const browserAuthority = await guarded.application.server.inject({
        method: 'POST',
        url: `/product-api/frontend/sources/${guarded.stored.sourceId}/versions/${guarded.stored.sourceVersionId}/reextract-candidates`,
        headers: { cookie: guarded.cookie, 'x-csrf-token': guarded.csrf },
        payload: reextractRequest({
          sourceId: guarded.stored.sourceId,
          sourceVersionId: guarded.stored.sourceVersionId,
          clientRequestId: 'reextract-browser-authority',
          idempotencyKey: 'reextract-browser-authority',
          payloadExtensions: {
            providerId: 'browser-provider',
            modelId: 'browser-model',
            credentialId: 'browser-credential',
          },
        }),
      });
      expect(browserAuthority.statusCode).toBe(400);
      expect(browserAuthority.json()).toMatchObject({ code: 'INVALID_REQUEST' });
      expect(guarded.aiProviderRepository.list()).toHaveLength(0);
    } finally {
      await guarded.close();
    }
  });

  it('does not call a provider when the current Project AI resolver is unavailable', async () => {
    const unavailableAI: AIProviderExecutionResolverPort = {
      resolve: async () => {
        throw new ShotgunError({
          code: 'CONFIGURATION_REQUIRED',
          safeMessage: 'Project AI configuration is required.',
          module: 'test-ai-authority',
          operation: 'resolve',
        });
      },
    };
    const fixture = await createFixture(false, true, true, unavailableAI);
    try {
      const response = await fixture.application.server.inject({
        method: 'POST',
        url: `/product-api/frontend/sources/${fixture.stored.sourceId}/versions/${fixture.stored.sourceVersionId}/reextract-candidates`,
        headers: { cookie: fixture.cookie, 'x-csrf-token': fixture.csrf },
        payload: reextractRequest({
          sourceId: fixture.stored.sourceId,
          sourceVersionId: fixture.stored.sourceVersionId,
          clientRequestId: 'reextract-unconfigured-ai',
          idempotencyKey: 'reextract-unconfigured-ai',
        }),
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ code: 'CONFIGURATION_REQUIRED' });
      expect(fixture.aiProviderRepository.list()).toHaveLength(0);
      expect(
        await fixture.candidateRepository.listBySourceVersion(
          'project-1',
          fixture.stored.sourceVersionId,
        ),
      ).toHaveLength(0);
    } finally {
      await fixture.close();
    }
  });
});
