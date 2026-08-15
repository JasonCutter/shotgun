import { expect, test } from '@playwright/test';

import { openCommandPalette } from './helpers/hfm-commands.js';

const forbiddenAuthorityHeaders = [
  'x-project-id',
  'x-actor-id',
  'x-access-scope',
  'x-sensitivity',
  'authorization',
];

test('HFM-S3 replaces Settings IA with focused owner commands without browser authority', async ({
  page,
}) => {
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
  const primaryNavigation = page.getByRole('navigation', { name: 'Primary navigation' });
  await expect(primaryNavigation.getByRole('link', { name: 'Home' })).toBeVisible();
  await expect(primaryNavigation.getByRole('link', { name: 'Library' })).toBeVisible();
  await expect(primaryNavigation.getByRole('link', { name: 'Conversations' })).toBeVisible();
  await expect(
    primaryNavigation.getByText('Settings', { exact: true, selector: 'summary' }),
  ).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Current project' })).toHaveCount(1);

  const palette = await openCommandPalette(page);
  for (const command of [/Manage Projects/, /Set Locale/, /Configure AI/, /Review Privacy/]) {
    await expect(palette.getByRole('button', { name: command })).toBeVisible();
  }
  for (const placeholder of [
    'Models',
    'Costs & Budgets',
    'Connectors',
    'Directives & Priority',
    'Schema Packs',
    'Diagnostics',
    'Advanced',
  ]) {
    await expect(palette.getByRole('button', { name: placeholder, exact: true })).toHaveCount(0);
  }

  await palette.getByRole('button', { name: /Manage Projects/ }).click();
  await expect(page.getByRole('dialog', { name: 'Manage Projects' })).toBeVisible();
  await expect(page.getByRole('link', { name: /settings/i })).toHaveCount(0);

  const storage = await page.evaluate(() => ({
    localKeys: Object.keys(localStorage),
    sessionKeys: Object.keys(sessionStorage),
    bodyText: document.body.innerText,
  }));
  expect(storage.localKeys.some((key) => key.toLowerCase().includes('secret'))).toBe(false);
  expect(storage.sessionKeys.some((key) => key.toLowerCase().includes('secret'))).toBe(false);
  expect(storage.bodyText).not.toContain('my_super_secret_raw_password');
  expect(forbiddenHeaderUses).toEqual([]);
});

test('legacy Settings destinations do not expose the removed mega IA', async ({ page }) => {
  await page.goto('/settings/projects');
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();

  for (const path of [
    '/settings',
    '/settings/preferences',
    '/settings/models',
    '/settings/costs',
    '/settings/connectors',
    '/settings/directives',
    '/settings/schema',
    '/settings/diagnostics',
    '/settings/advanced',
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: 'Settings Categories Index' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Advanced Settings/ })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Settings categories' })).toHaveCount(0);
  }
});
