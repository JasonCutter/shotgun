import { expect, test } from '@playwright/test';

const forbiddenAuthorityHeaders = [
  'x-project-id',
  'x-actor-id',
  'x-access-scope',
  'x-sensitivity',
  'authorization',
];

test('Frontend Section 2 Settings & Project Administration End-to-End Flow', async ({ page }) => {
  const forbiddenHeaderUses: string[] = [];
  page.on('request', (request) => {
    if (!request.url().includes('/api/v1/')) return;
    const headers = request.headers();
    for (const name of forbiddenAuthorityHeaders) {
      if (headers[name] !== undefined) forbiddenHeaderUses.push(name);
    }
  });

  // 1. Navigate to Settings page
  await page.goto('/settings');
  await expect(
    page.getByRole('heading', { name: 'Settings & Project Administration' }),
  ).toBeVisible();

  // 2. Check 5D project badges in header
  await expect(page.locator('.active-project')).toContainText('shotgun');
  await expect(page.locator('.target-project')).toContainText('shotgun');

  // 3. Navigate through category tabs
  await page.getByRole('link', { name: 'Category Index' }).click();
  await expect(page.getByRole('heading', { name: 'Settings Categories Index' })).toBeVisible();

  await page.getByRole('link', { name: 'Preferences' }).click();
  await expect(page.getByRole('heading', { name: 'User Preferences Workspace' })).toBeVisible();

  await page.getByRole('link', { name: 'Project Admin' }).click();
  await expect(page.getByRole('heading', { name: 'Project Administration' })).toBeVisible();

  await page.getByRole('link', { name: 'Models' }).click();
  await expect(page.getByRole('heading', { name: 'AI Model Profiles & Routing' })).toBeVisible();

  await page.getByRole('link', { name: 'Costs & Budgets' }).click();
  await expect(page.getByRole('heading', { name: 'Costs & Budget Management' })).toBeVisible();

  await page.getByRole('link', { name: 'Privacy & Sensitivity' }).click();
  await expect(page.getByRole('heading', { name: 'Privacy & Sensitivity Controls' })).toBeVisible();

  await page.getByRole('link', { name: 'Connectors' }).click();
  await expect(page.getByRole('heading', { name: 'Connector Integrations' })).toBeVisible();

  await page.getByRole('link', { name: 'Directives & Priority' }).click();
  await expect(
    page.getByRole('heading', { name: 'User Directives & Fact Priority' }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Schema Packs' }).click();
  await expect(
    page.getByRole('heading', { name: 'Schema Packs & Migration Requirements' }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Diagnostics' }).click();
  await expect(
    page.getByRole('heading', { name: 'System Diagnostics & Real-Fact Telemetry' }),
  ).toBeVisible();

  // 4. Security Negative Gate: No authority headers or raw secrets in storage/DOM
  expect(forbiddenHeaderUses).toEqual([]);
  const storage = await page.evaluate(() => ({
    localKeys: Object.keys(localStorage),
    sessionKeys: Object.keys(sessionStorage),
    bodyText: document.body.innerText,
  }));

  expect(storage.localKeys.some((k) => k.toLowerCase().includes('secret'))).toBe(false);
  expect(storage.sessionKeys.some((k) => k.toLowerCase().includes('secret'))).toBe(false);
  expect(storage.bodyText.includes('my_super_secret_raw_password')).toBe(false);
});
