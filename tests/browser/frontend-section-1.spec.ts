import { expect, test } from '@playwright/test';

const forbiddenAuthorityHeaders = [
  'x-project-id',
  'x-actor-id',
  'x-access-scope',
  'x-sensitivity',
  'x-shotgun-project',
  'authorization',
];

test('Frontend Section 1 restores server Project context and protects routes', async ({ page }) => {
  const forbiddenHeaderUses: string[] = [];
  page.on('request', (request) => {
    if (!request.url().includes('/api/v1/') && !request.url().includes('/product-api/')) {
      return;
    }
    const headers = request.headers();
    for (const name of forbiddenAuthorityHeaders) {
      if (headers[name] !== undefined) forbiddenHeaderUses.push(name);
    }
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  await expect(page.locator('.project-summary')).toContainText('shotgun');
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Settings/ })).toBeVisible();

  await page.route('**/api/v1/session/active-project', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.continue();
  });
  const projectSelector = page.getByRole('combobox', {
    name: 'Current project',
  });
  await projectSelector.selectOption('project-b');
  await expect(page.locator('.project-summary')).toContainText('Project B');
  await expect(projectSelector).toHaveValue('project-b');

  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: /Settings/ })).toBeVisible();
  await expect(projectSelector).toHaveValue('project-b');
  await expect(page.locator('.project-summary')).not.toContainText('shotgun');

  for (const [link, heading] of [
    ['Home', 'Home'],
    ['Sources', 'Sources'],
    ['Ask', 'Ask'],
    ['Settings', 'Settings'],
  ] as const) {
    await page.getByRole('link', { name: link }).click();
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeFocused();
  }
  for (const unavailable of ['Knowledge', 'Review']) {
    await expect(page.getByRole('link', { name: unavailable })).toHaveCount(0);
    await expect(
      page.locator('.navigation-disabled', { hasText: unavailable }).first(),
    ).toHaveAttribute('aria-disabled', 'true');
  }

  const storage = await page.evaluate(() => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
  }));
  expect(storage).toEqual({ local: [], session: [] });
  expect(forbiddenHeaderUses).toEqual([]);

  await page.goto('/sources');
  await expect(page.getByRole('heading', { name: 'Sources' })).toBeVisible();

  const digestResults = await page.evaluate(async () => {
    const adapter = (
      window as unknown as {
        __SHOTGUN_TEST_DIGEST_ADAPTER__?: {
          webCryptoDigestProvider: (input: string) => Promise<string>;
          computeCommandSemanticDigestAsync: (request: unknown) => Promise<string>;
        };
      }
    ).__SHOTGUN_TEST_DIGEST_ADAPTER__;
    if (!adapter) throw new Error('Test digest adapter not found on window');

    const request = {
      envelopeVersion: '1.0.0',
      commandType: 'KNOWLEDGE_TRANSITION_SUBMIT',
      commandSchemaVersion: '1.0.0',
      clientRequestId: 'req-111',
      idempotencyKey: 'idem-222',
      projectContext: {
        activeProjectId: 'project-alpha',
        targetProjectId: 'project-alpha',
        resourceProjectId: 'project-alpha',
      },
      policyBinding: { mode: 'CURRENT' },
      preconditions: [
        {
          purpose: 'TARGET',
          subject: { resourceKind: 'B', resourceId: '2' },
          expectedRevision: '1',
        },
        {
          purpose: 'TARGET',
          subject: { resourceKind: 'A', resourceId: '1' },
          expectedRevision: '1',
        },
      ],
      clientIssuedAt: '2026-07-24T12:00:00.000Z',
      payload: { text: 'Test' },
    };
    return {
      knownVectorDigest: await adapter.webCryptoDigestProvider('{"a":1,"b":2}'),
      original: await adapter.computeCommandSemanticDigestAsync(request),
      reordered: await adapter.computeCommandSemanticDigestAsync({
        ...request,
        preconditions: [...request.preconditions].reverse(),
      }),
      changed: await adapter.computeCommandSemanticDigestAsync({
        ...request,
        payload: { text: 'Test Changed' },
      }),
    };
  });
  expect(digestResults.knownVectorDigest).toBe(
    '43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777',
  );
  expect(digestResults.original).toBe(digestResults.reordered);
  expect(digestResults.original).not.toBe(digestResults.changed);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('button', { name: /log out/i })).toHaveCount(0);
});

test('Session revocation removes the protected Shell and reestablishes READY', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  await page.route('**/api/v1/session', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'SESSION_REVOKED',
          message: 'Session revoked',
        }),
      });
    } else {
      await route.continue();
    }
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
});

test('Session recovery failure offers typed reconnect actions', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  await page.route(
    (url) => url.pathname.startsWith('/api/v1/session'),
    async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'LOCAL_SERVER_UNAVAILABLE',
          message: 'Server unavailable',
        }),
      });
    },
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Local server unavailable' })).toBeVisible();
  const reconnect = page.getByRole('button', { name: 'Reconnect' });
  await expect(reconnect).toBeVisible();
  await reconnect.click();
  await expect(page.getByRole('heading', { name: 'Local server unavailable' })).toBeVisible();
});

test('protected browser storage does not leak Project cache data', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => ({
        local: Object.keys(localStorage),
        session: Object.keys(sessionStorage),
      })),
    )
    .toEqual({ local: [], session: [] });
});
