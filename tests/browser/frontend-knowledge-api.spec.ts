import { expect, test } from '@playwright/test';

test('Knowledge Product API remains body-only and rejects browser authority inputs', async ({
  page,
}) => {
  let observed:
    | {
        readonly url: string;
        readonly method: string;
        readonly headers: Record<string, string>;
        readonly body: string;
      }
    | undefined;

  await page.route('**/product-api/frontend/knowledge/search', async (route) => {
    const request = route.request();
    observed = {
      url: request.url(),
      method: request.method(),
      headers: request.headers(),
      body: request.postData() ?? '',
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        result: {
          schemaVersion: '1.1.0',
          projectId: 'server-project-1',
          accessRevision: 'access-1',
          policyContextRevision: 'policy-1',
          query: 'canonical',
          matches: [],
          projection: {
            projectionKind: 'CANONICAL_SEARCH',
            status: 'READY',
            canonicalVersion: 1,
            projectedCanonicalVersion: 1,
            lag: 0,
          },
          readiness: {
            canonicalSearch: {
              projectionKind: 'CANONICAL_SEARCH',
              status: 'READY',
              canonicalVersion: 1,
              projectedCanonicalVersion: 1,
              lag: 0,
            },
            sourceProjections: [],
            partial: false,
          },
          fetchedAt: '2026-08-02T12:00:00.000Z',
        },
      }),
    });
  });

  await page.goto('/');
  const response = await page.evaluate(async () => {
    const result = await fetch('/product-api/frontend/knowledge/search', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'browser-csrf',
      },
      body: JSON.stringify({
        schemaVersion: '1.0.0',
        query: 'canonical',
      }),
    });
    return { status: result.status, body: await result.json() };
  });

  expect(response.status).toBe(200);
  expect(response.body.result.schemaVersion).toBe('1.1.0');
  expect(observed).toBeDefined();
  expect(observed?.method).toBe('POST');
  expect(observed?.url).not.toContain('canonical');
  expect(observed?.headers['x-project-id']).toBeUndefined();
  expect(JSON.parse(observed?.body ?? '{}')).toEqual({
    schemaVersion: '1.0.0',
    query: 'canonical',
  });
});

test('Knowledge Product API rejects a missing browser session and authority header', async ({
  page,
}) => {
  await page.goto('/');

  await page.context().clearCookies();
  const withoutSession = await page.evaluate(async () => {
    const response = await fetch('/product-api/frontend/knowledge/search', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'browser-csrf-without-session',
      },
      body: JSON.stringify({ schemaVersion: '1.0.0', query: 'without-session' }),
    });
    return { status: response.status, body: await response.json() };
  });

  expect(withoutSession.status).toBe(401);
  expect(withoutSession.body.code).toBe('AUTHENTICATION_REQUIRED');

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  const csrf = await page.evaluate(async () => {
    const response = await fetch('/api/v1/security/csrf');
    return (await response.json()) as { csrfToken: string };
  });
  const forgedAuthority = await page.evaluate(async (csrfToken) => {
    const response = await fetch('/product-api/frontend/knowledge/search', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrfToken,
        'x-project-id': 'forged-project',
      },
      body: JSON.stringify({ schemaVersion: '1.0.0', query: 'forged-authority' }),
    });
    return { status: response.status, body: await response.json() };
  }, csrf.csrfToken);

  expect(forgedAuthority.status).toBe(400);
  expect(forgedAuthority.body.code).toBe('LEGACY_SECURITY_HEADER_FORBIDDEN');
});

test('Knowledge browser harness proves cache isolation, typed failure and retry boundaries', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();

  await page.route('**/api/v1/security/csrf', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ csrfToken: 'browser-harness-csrf' }),
    });
  });
  await page.route('**/product-api/frontend/knowledge/search', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: '1.0.0',
        code: 'RETRYABLE_DEPENDENCY',
        category: 'DEPENDENCY',
        retryability: 'SAFE',
        recovery: 'RETRY',
        message: 'Browser harness dependency failure.',
      }),
    });
  });

  const result = await page.evaluate(async () => {
    const harnessUrl = new URL(
      '/src/knowledge/knowledge-browser-test-harness.ts',
      window.location.origin,
    ).href;
    const harness = await import(harnessUrl);
    return {
      cache: await harness.runKnowledgeBrowserCacheHarness(),
      failure: await harness.readKnowledgeBrowserApiFailure(),
    };
  });

  expect(result.cache.projectSwitchIsolation).toBe(true);
  expect(result.cache.authorityRevisionIsolation).toBe(true);
  expect(result.cache.projectPurgeRemovesKnowledge).toBe(true);
  expect(result.cache.logoutPurgeRemovesKnowledge).toBe(true);
  expect(result.cache.zeroProjectDisabled).toBe(true);
  expect(result.cache.domainProjectionStalePreserved).toBe(true);
  expect(result.cache.typedFailure).toMatchObject({
    instanceofShotgunApiError: true,
    code: 'RETRYABLE_DEPENDENCY',
    retryability: 'SAFE',
    recovery: 'RETRY',
    envelopeCode: 'RETRYABLE_DEPENDENCY',
  });
  expect(result.cache.retryPolicy).toEqual({
    safeAtZero: true,
    safeAtOne: true,
    safeAtTwo: false,
    never: false,
    raw: false,
  });
  expect(result.failure).toMatchObject({
    kind: 'TYPED_FAILURE',
    instanceofShotgunApiError: true,
    code: 'RETRYABLE_DEPENDENCY',
    retryability: 'SAFE',
    recovery: 'RETRY',
    envelopeCode: 'RETRYABLE_DEPENDENCY',
  });
});
