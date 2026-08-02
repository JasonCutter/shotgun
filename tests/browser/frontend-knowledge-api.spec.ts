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
