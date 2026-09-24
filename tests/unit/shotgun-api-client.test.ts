import { describe, expect, it, vi } from 'vitest';

import {
  createShotgunApiClient,
  ShotgunApiError,
  type ProductSessionView,
} from '../../packages/shotgun-api-client/src/index.js';

const session = (projectId = 'project-a'): ProductSessionView => ({
  apiVersion: '1.0.0',
  principal: {
    id: 'principal-a',
    actor: { type: 'user', id: 'principal-a' },
    authenticationMethod: 'session',
  },
  activeProject: { id: projectId },
  accessibleProjects: [
    { id: 'project-a', isOwner: true },
    { id: 'project-b', isOwner: false },
  ],
  session: { expiresAt: '2026-07-23T00:00:00.000Z' },
});

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('shotgun-api-client', () => {
  it('decodes a valid session and ignores non-contract authority fields', async () => {
    const fetch = vi.fn(async () =>
      json({
        session: {
          ...session(),
          scopes: ['owner'],
          sensitivityClearance: 'restricted',
          credentialId: 'hidden',
          sessionToken: 'hidden',
          csrfHash: 'hidden',
        },
      }),
    );
    const result = await createShotgunApiClient({ fetch }).getSession();
    expect(result).toEqual(session());
    expect(result).not.toHaveProperty('scopes');
  });

  it.each([
    { session: { ...session(), activeProject: undefined } },
    { session: { ...session(), accessibleProjects: {} } },
    { session: { ...session(), activeProject: { id: 'project-c' } } },
  ])('rejects malformed Product API responses', async (body) => {
    const client = createShotgunApiClient({ fetch: vi.fn(async () => json(body)) });
    await expect(client.getSession()).rejects.toMatchObject({
      code: 'INVALID_PRODUCT_API_RESPONSE',
      message: 'Invalid Product API Response',
    });
  });

  it('uses same-origin credentials and never sends authority or bearer headers', async () => {
    let csrfIndex = 0;
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void init;
      const url = String(input);
      if (url.endsWith('/security/csrf')) return json({ csrfToken: `csrf-${++csrfIndex}` });
      if (url.endsWith('/session/logout')) return json({ message: 'Logged out' });
      if (url.endsWith('/session/active-project')) return json({ session: session('project-b') });
      return json({ session: session() });
    });
    const client = createShotgunApiClient({ fetch });
    await client.bootstrapLocalOwner();
    await client.getSession();
    await client.switchActiveProject('project-b');
    await client.logout();

    const forbidden = [
      'x-project-id',
      'x-actor-id',
      'x-access-scope',
      'x-sensitivity',
      'x-shotgun-project',
      'authorization',
    ];
    for (const [, init] of fetch.mock.calls) {
      expect(init?.credentials).toBe('same-origin');
      const headers = new Headers(init?.headers);
      for (const name of forbidden) expect(headers.has(name)).toBe(false);
    }
  });

  it('serializes project switch and logout through the shared CSRF authority', async () => {
    const calls: string[] = [];
    let csrfIndex = 0;
    let releaseFirst = (): void => undefined;
    const firstMutation = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/security/csrf')) {
        const token = `csrf-${++csrfIndex}`;
        calls.push(token);
        return json({ csrfToken: token });
      }
      if (url.endsWith('/session/active-project')) {
        calls.push('switch');
        await firstMutation;
        return json({ session: session('project-b') });
      }
      calls.push('logout');
      return json({ message: 'Logged out' });
    });
    const client = createShotgunApiClient({ fetch });
    const switching = client.switchActiveProject('project-b');
    const logout = client.logout();
    await vi.waitFor(() => expect(calls).toEqual(['csrf-1', 'switch']));
    releaseFirst();
    await Promise.all([switching, logout]);
    expect(calls).toEqual(['csrf-1', 'switch', 'logout']);
  });

  it('releases the mutation lock after a network failure', async () => {
    let mutationCount = 0;
    let csrfIndex = 0;
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/security/csrf')) return json({ csrfToken: `csrf-${++csrfIndex}` });
      if (url.endsWith('/session/active-project') && mutationCount++ === 0) {
        throw new TypeError('network unavailable');
      }
      return json({ session: session('project-b') });
    });
    const client = createShotgunApiClient({ fetch });
    const first = client.switchActiveProject('project-b');
    const second = client.switchActiveProject('project-b');
    await expect(first).rejects.toThrow('network unavailable');
    await expect(second).resolves.toEqual(session('project-b'));
    expect(csrfIndex).toBe(2);
  });

  it('recovers exactly once from a typed CSRF denial', async () => {
    let mutationCalls = 0;
    let csrfIndex = 0;
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/security/csrf')) return json({ csrfToken: `csrf-${++csrfIndex}` });
      mutationCalls += 1;
      if (mutationCalls === 1) {
        return json(
          { code: 'REQUEST_ORIGIN_DENIED', message: 'A valid CSRF token is required.' },
          403,
        );
      }
      return json({ session: session('project-b') });
    });
    const client = createShotgunApiClient({ fetch });
    await expect(client.switchActiveProject('project-b')).resolves.toEqual(session('project-b'));
    expect(mutationCalls).toBe(2);
    expect(csrfIndex).toBe(2);
  });

  it('classifies an unreceived Section 2 command response as outcome indeterminate', async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/security/csrf')) return json({ csrfToken: 'csrf-command' });
      throw new TypeError('response connection closed');
    });
    const client = createShotgunApiClient({ fetch });
    await expect(
      client.applySettingsCommand({
        activeProjectId: 'project-a',
        targetProjectId: 'project-a',
        resourceProjectId: 'project-a',
        clientRequestId: 'request-a',
        idempotencyKey: 'intent-a',
        expectedSettingsRevision: 1,
        observedPolicyContextRevision: 1,
        settings: { 'models.defaultAnswerProfile': 'model-b' },
      }),
    ).rejects.toMatchObject({
      code: 'OUTCOME_INDETERMINATE',
      status: 0,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('executes getSession correctly returning session envelope', async () => {
    const fetch = vi.fn(async () => json({ session: session() }));
    const result = await createShotgunApiClient({ fetch }).getSession();
    expect(result.principal.id).toBe('principal-a');
    expect(result.activeProject?.id).toBe('project-a');
  });

  it('decodes a zero-project Product Session V2 without fabricating a Project', async () => {
    const fetch = vi.fn(async () =>
      json({
        session: {
          apiVersion: '2.0.0',
          principal: session().principal,
          activeProject: null,
          accessibleProjects: [],
          session: { expiresAt: null },
          sessionReady: true,
          projectReady: false,
          projectAccessRevision: '0',
        },
      }),
    );
    const result = await createShotgunApiClient({ fetch }).getSession();
    expect(result.apiVersion).toBe('2.0.0');
    expect(result.activeProject).toBeNull();
    expect(result.accessibleProjects).toEqual([]);
  });

  it('sends raw Search text only in the protected POST body and never in the URL', async () => {
    const rawQuery = 'confidential search phrase';
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void init;
      const url = String(input);
      if (url.endsWith('/api/v1/security/csrf')) {
        return json({ csrfToken: 'csrf-search' });
      }
      return json({
        result: {
          schemaVersion: '1.0.0',
          scope: 'ACTIVE_PROJECT',
          results: [],
          projectionRevision: 'search-1',
          fetchedAt: '2026-07-29T00:00:00.000Z',
        },
      });
    });
    await createShotgunApiClient({ fetch }).searchGlobal({
      schemaVersion: '1.0.0',
      query: rawQuery,
      scope: { kind: 'ACTIVE_PROJECT' },
      limit: 20,
    });
    const [searchUrl, searchInit] = fetch.mock.calls[1]!;
    expect(String(searchUrl)).toBe('/product-api/frontend/search/query');
    expect(String(searchUrl)).not.toContain(rawQuery);
    expect(searchInit?.method).toBe('POST');
    expect(JSON.parse(String(searchInit?.body))).toMatchObject({ query: rawQuery });
  });

  it('never sends a browser-created Project ID in PRINCIPAL bootstrap', async () => {
    let bootstrapBody: Record<string, unknown> | undefined;
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/security/csrf')) {
        return json({ csrfToken: 'csrf-bootstrap' });
      }
      bootstrapBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return json(
        {
          schemaVersion: '1.0.0',
          code: 'ZERO_PROJECT_PRECONDITION_FAILED',
          message: 'Fixture stop.',
          category: 'CONFLICT',
          retryability: 'NEVER',
          recovery: 'REFRESH_AND_REAPPLY',
          retryable: false,
          details: {},
        },
        409,
      );
    });
    await expect(
      createShotgunApiClient({ fetch }).createFirstProject({
        name: 'First Project',
        projectAccessRevision: '0',
        clientRequestId: 'request-first',
        idempotencyKey: 'idempotency-first',
      }),
    ).rejects.toBeInstanceOf(ShotgunApiError);
    expect(bootstrapBody).toMatchObject({
      envelopeVersion: '2.0.0',
      projectContext: {
        scope: 'PRINCIPAL',
        observedProjectAccessRevision: '0',
      },
      payload: { name: 'First Project' },
    });
    expect(JSON.stringify(bootstrapBody)).not.toContain('newProjectId');
  });

  it('throws ShotgunApiError on 401 Unauthorized during getSession', async () => {
    const fetch = vi.fn(async () =>
      json({ code: 'SESSION_EXPIRED', message: 'Session expired' }, 401),
    );
    await expect(createShotgunApiClient({ fetch }).getSession()).rejects.toBeInstanceOf(
      ShotgunApiError,
    );
  });

  it('strictly decodes the bounded recompare receipt and supports a Change Set locator', async () => {
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/security/csrf')) return json({ csrfToken: 'csrf-recompare' });
      expect(url).toBe('/api/v1/comparisons/recompare');
      expect(JSON.parse(String(init?.body))).toEqual({
        changeSetId: 'change-set-1',
        idempotencyKey: 'idem-1',
      });
      return json({
        commandStatus: 'SUCCEEDED',
        result: {
          candidateId: 'candidate-1',
          candidateRevisionNumber: 3,
          rollout: 'V2_ACTIVE',
          v1Executed: false,
          v2: {
            status: 'COMPLETED',
            comparisonId: 'comparison-2',
            snapshotVersion: 9,
            snapshotDigest: 'sha256:snapshot-9',
          },
          review: { status: 'DRAFT_CREATED' },
          comparisonId: 'comparison-2',
          snapshotVersion: 9,
          snapshotDigest: 'sha256:snapshot-9',
        },
        reviewChangeSetId: 'comparison-v2:comparison-2',
        trace: { secret: 'must-not-be-consumed' },
      });
    });
    const result = await createShotgunApiClient({ fetch }).recompareCandidate({
      changeSetId: 'change-set-1',
      idempotencyKey: 'idem-1',
    });
    expect(result).toEqual({
      commandStatus: 'SUCCEEDED',
      result: expect.objectContaining({
        candidateId: 'candidate-1',
        rollout: 'V2_ACTIVE',
        v1Executed: false,
        v2: expect.objectContaining({ status: 'COMPLETED' }),
        review: { status: 'DRAFT_CREATED' },
      }),
      reviewChangeSetId: 'comparison-v2:comparison-2',
    });
    expect(result).not.toHaveProperty('trace');
  });

  it.each(['BLOCKED', 'INCOMPLETE', 'FAILED'] as const)(
    'decodes V2 %s as a domain outcome rather than transport success',
    async (status) => {
      const fetch = vi.fn(async (input: string | URL | Request) => {
        if (String(input).endsWith('/security/csrf')) return json({ csrfToken: 'csrf-recompare' });
        const v2 =
          status === 'BLOCKED'
            ? { status, reason: 'SHORTLIST_BLOCKED' }
            : {
                status,
                comparisonId: 'comparison-2',
                snapshotVersion: 9,
                snapshotDigest: 'sha256:snapshot-9',
                analysisRevisionId: 'analysis-2',
                analysisState: status === 'INCOMPLETE' ? 'SEMANTIC_UNAVAILABLE' : 'FAILED_TERMINAL',
                safeFailureCode:
                  status === 'INCOMPLETE' ? 'SEMANTIC_UNAVAILABLE' : 'TERMINAL_FAILURE',
              };
        return json({
          commandStatus: 'SUCCEEDED',
          result: {
            candidateId: 'candidate-1',
            candidateRevisionNumber: 3,
            rollout: 'V2_ACTIVE',
            v1Executed: false,
            v2,
            review: { status: 'NOT_ATTEMPTED' },
          },
        });
      });
      const result = await createShotgunApiClient({ fetch }).recompareCandidate({
        candidateId: 'candidate-1',
        idempotencyKey: 'idem-1',
      });
      expect(result.commandStatus).toBe('SUCCEEDED');
      expect(result.result.v2?.status).toBe(status);
    },
  );

  it('classifies a lost recompare response as outcome indeterminate using the same key', async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/security/csrf')) return json({ csrfToken: 'csrf-recompare' });
      throw new TypeError('response connection closed');
    });
    await expect(
      createShotgunApiClient({ fetch }).recompareCandidate({
        candidateId: 'candidate-a',
        idempotencyKey: 'idem-recompare-a',
      }),
    ).rejects.toMatchObject({
      code: 'OUTCOME_INDETERMINATE',
      clientRequestId: 'idem-recompare-a',
    });
  });

  it('rejects a malformed nested recompare result', async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/security/csrf')) return json({ csrfToken: 'csrf-recompare' });
      return json({
        commandStatus: 'SUCCEEDED',
        result: {
          candidateId: 'candidate-1',
          candidateRevisionNumber: 3,
          rollout: 'V2_ACTIVE',
          v1Executed: false,
          v2: { status: 'INCOMPLETE', comparisonId: 'comparison-2' },
        },
      });
    });
    await expect(
      createShotgunApiClient({ fetch }).recompareCandidate({
        candidateId: 'candidate-1',
        idempotencyKey: 'idem-1',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PRODUCT_API_RESPONSE' });
  });

  it('binds Project reset preview, explicit confirmation, CSRF, idempotency, and status APIs', async () => {
    const counts = {
      sourceCount: 1,
      sourceVersionCount: 2,
      sourceDerivedRecordCount: 3,
      redactedHistoryRecordCount: 4,
      rebuildProjectionCount: 5,
      sharedAssetCount: 0,
      blockedRecordCount: 0,
    };
    const preview = {
      schemaVersion: '1.0.0',
      previewId: 'preview-1',
      projectId: 'project-reset',
      manifestDigest: `sha256:${'a'.repeat(64)}`,
      ownerManifestDigest: `sha256:${'c'.repeat(64)}`,
      projectRevision: 7,
      knowledgeEpoch: 2,
      expiresAt: '2026-09-23T01:05:00.000Z',
      counts,
      blockers: [],
      preservedConfigurationDigest: `sha256:${'b'.repeat(64)}`,
      canConfirm: true,
    };
    const request = {
      schemaVersion: '1.0.0',
      requestId: 'request-1',
      projectId: 'project-reset',
      projectRevision: 7,
      manifestDigest: preview.manifestDigest,
      ownerManifestDigest: preview.ownerManifestDigest,
      state: 'APPROVED',
      expectedKnowledgeEpoch: 2,
      knowledgeEpoch: 3,
      blockerCodes: [],
      counts,
      completedSteps: [],
      casStatus: 'NOT_STARTED',
      backupStatus: 'PENDING',
      createdAt: '2026-09-23T01:00:00.000Z',
      updatedAt: '2026-09-23T01:00:00.000Z',
    };
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void init;
      const url = String(input);
      if (url.endsWith('/security/csrf')) return json({ csrfToken: 'csrf-reset' });
      if (url.endsWith('/preview')) return json({ preview });
      if (url.endsWith('/confirm')) return json({ request, replayed: false });
      return json({ request });
    });
    const client = createShotgunApiClient({ fetch });
    const readPreview = await client.previewSourceKnowledgeReset('project-reset');
    const confirmation = {
      previewId: readPreview.previewId,
      manifestDigest: readPreview.manifestDigest,
      expectedProjectRevision: readPreview.projectRevision,
      expectedKnowledgeEpoch: readPreview.knowledgeEpoch,
      idempotencyKey: 'reset-idem-1',
      confirmIrreversibleReset: true as const,
    };
    const confirmed = await client.confirmSourceKnowledgeReset('project-reset', confirmation);
    const status = await client.getSourceKnowledgeResetStatus('project-reset', request.requestId);

    expect(confirmed).toEqual({ request, replayed: false });
    expect(status).toEqual(request);
    const confirmCall = fetch.mock.calls.find(([input]) => String(input).endsWith('/confirm'));
    expect(confirmCall?.[1]).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'x-csrf-token': 'csrf-reset',
        'x-idempotency-key': 'reset-idem-1',
      },
    });
    expect(JSON.parse(String(confirmCall?.[1]?.body))).toMatchObject({
      confirmIrreversibleReset: true,
      previewId: 'preview-1',
    });
  });
});
