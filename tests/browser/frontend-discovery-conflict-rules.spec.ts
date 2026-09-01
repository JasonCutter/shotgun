import { expect, test } from '@playwright/test';

import { openCommandPalette } from './helpers/hfm-commands.js';

test('WP2R exposes a focused owner conflict-rule surface without assertion controls', async ({
  page,
}) => {
  await page.route('**/api/v1/discovery/conflict-rules', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        rules: [
          {
            schemaVersion: '1.0.0',
            ruleId: 'typed-proposition-conflict-rule:browser-1',
            ruleRevision: 1,
            leftRelationType: 'contradicts',
            rightRelationType: 'supports',
            directionSemantics: 'DIRECTED_SAME_ORIENTATION',
            status: 'ACTIVE',
            createdAt: '2026-09-01T00:00:00.000Z',
            lifecycle: { currentRevision: 1, activeRevision: 1 },
          },
        ],
      }),
    });
  });

  await page.goto('/');
  const palette = await openCommandPalette(page);
  await palette.getByRole('textbox', { name: 'Command search' }).fill('conflict rules');
  await palette.getByRole('button', { name: 'Conflict rules' }).click();

  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('heading', { name: 'Typed proposition conflict rules' }),
  ).toBeVisible();
  await expect(dialog.getByLabel('Relation type A')).toBeVisible();
  await expect(dialog.getByLabel('Relation type B')).toBeVisible();
  await expect(dialog.getByLabel('Direction')).toBeVisible();
  await expect(dialog.getByText(/does not make .*Canonical knowledge/i)).toBeVisible();
  await expect(dialog.getByText(/assertion/i)).toHaveCount(0);
});
