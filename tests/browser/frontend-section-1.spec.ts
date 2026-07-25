import { expect, test } from '@playwright/test';

const forbiddenAuthorityHeaders = [
  'x-project-id',
  'x-actor-id',
  'x-access-scope',
  'x-sensitivity',
  'x-shotgun-project',
  'authorization',
];

test('Frontend Section 1 restores server project context and protects routes', async ({ page }) => {
  const forbiddenHeaderUses: string[] = [];
  page.on('request', (request) => {
    if (!request.url().includes('/api/v1/')) return;
    const headers = request.headers();
    for (const name of forbiddenAuthorityHeaders) {
      if (headers[name] !== undefined) forbiddenHeaderUses.push(name);
    }
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  await expect(page.locator('.project-summary')).toContainText('shotgun');
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

  await page.route('**/api/v1/session/active-project', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.continue();
  });
  const projectSelector = page.getByRole('combobox', { name: 'Active Project' });
  await projectSelector.selectOption('project-b');
  await expect(page.locator('.project-summary')).toContainText('project-b');
  await expect(projectSelector).toHaveValue('project-b');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(projectSelector).toHaveValue('project-b');
  await expect(page.locator('.project-summary')).not.toContainText('shotgun');

  const routes = [
    ['Home', 'Home'],
    ['Sources', 'Sources'],
    ['Ask', 'Ask'],
    ['Knowledge', 'Knowledge'],
    ['Review', 'Review'],
    ['Activity', 'Activity'],
    ['History', 'History'],
    ['Settings', 'Settings'],
  ] as const;
  for (const [link, heading] of routes) {
    await page.getByRole('link', { name: link }).click();
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeFocused();
  }

  const storage = await page.evaluate(() => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
  }));
  expect(storage).toEqual({ local: [], session: [] });
  expect(forbiddenHeaderUses).toEqual([]);

  await page.goto('/sources');
  await expect(page.getByRole('heading', { level: 1, name: 'Sources' })).toBeVisible();

  // Verify Browser Web Crypto Digest Parity using production API Client Adapter
  const digestResults = await page.evaluate(async () => {
    const adapter = (
      window as unknown as {
        __SHOTGUN_TEST_DIGEST_ADAPTER__?: {
          webCryptoDigestProvider: (input: string) => Promise<string>;
          computeCommandSemanticDigestAsync: (req: unknown) => Promise<string>;
        };
      }
    ).__SHOTGUN_TEST_DIGEST_ADAPTER__;

    if (!adapter) throw new Error('Test digest adapter not found on window');

    const knownCanonical = '{"a":1,"b":2}';
    const knownVectorDigest = await adapter.webCryptoDigestProvider(knownCanonical);

    const req1 = {
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

    const req1Reordered = {
      ...req1,
      preconditions: [
        {
          purpose: 'TARGET',
          subject: { resourceKind: 'A', resourceId: '1' },
          expectedRevision: '1',
        },
        {
          purpose: 'TARGET',
          subject: { resourceKind: 'B', resourceId: '2' },
          expectedRevision: '1',
        },
      ],
    };

    const req2ModifiedPayload = {
      ...req1,
      payload: { text: 'Test Changed' },
    };

    const req1Digest = await adapter.computeCommandSemanticDigestAsync(req1);
    const req1ReorderedDigest = await adapter.computeCommandSemanticDigestAsync(req1Reordered);
    const req2Digest = await adapter.computeCommandSemanticDigestAsync(req2ModifiedPayload);

    return {
      knownVectorDigest,
      req1Digest,
      req1ReorderedDigest,
      req2Digest,
    };
  });

  const EXPECTED_KNOWN_SHA256 = '43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777';
  expect(digestResults.knownVectorDigest).toBe(EXPECTED_KNOWN_SHA256);
  expect(digestResults.req1Digest).toBe(digestResults.req1ReorderedDigest);
  expect(digestResults.req1Digest).not.toBe(digestResults.req2Digest);

  // Local Owner Mode UI policy: No logout button or password phrases rendered
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('button', { name: '로그아웃' })).not.toBeVisible();

  // Session Boundary Error Screen test
  await page.route(
    (url) => url.pathname === '/api/v1/session',
    async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'LOCAL_SERVER_UNAVAILABLE', message: 'Local server error' }),
      });
    },
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: '로컬 서버에 연결할 수 없음' })).toBeVisible();
  await expect(page.getByRole('button', { name: '다시 연결' })).toBeVisible();
  await expect(page.getByRole('button', { name: '로컬 서버 상태 확인' })).toBeVisible();
});
