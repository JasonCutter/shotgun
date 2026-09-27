import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

test('Sources submits Direct Text in one action and clears its unsaved state', async ({ page }) => {
  const uniqueToken = randomUUID();
  const draftLabel = `E2E draft ${uniqueToken}`;
  const draftText = `Transient browser-only evidence ${uniqueToken}`;

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/sources');

  await expect(page.getByRole('heading', { name: 'Sources', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Source Library' })).toBeVisible();
  await page.getByLabel('Source Library').getByRole('link', { name: 'Add Source' }).click();
  await expect(page).toHaveURL(/\/sources\?view=add$/);
  await page.getByLabel('Label').fill(draftLabel);
  await page.getByLabel('Direct Text').fill(draftText);
  await expect
    .poll(() =>
      page.evaluate(() => `${JSON.stringify(localStorage)}${JSON.stringify(sessionStorage)}`),
    )
    .not.toContain(draftText);

  await page.getByRole('button', { name: 'Add source' }).click();
  await expect(page.getByRole('heading', { name: 'Submission Completed' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Submission items' })).toContainText(draftLabel);
  await page.getByRole('link', { name: 'Source Library' }).click();
  await expect(page).toHaveURL(/\/sources$/);
});

test('Sources submits a real file in one action', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/sources');
  await page.getByLabel('Source Library').getByRole('link', { name: 'Add Source' }).click();
  await expect(page).toHaveURL(/\/sources\?view=add$/);

  await page.getByLabel('Input type').selectOption('FILE');
  await page.getByLabel('File').setInputFiles({
    name: 'renderer-safe.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# renderer-safe file draft\n', 'utf8'),
  });
  await page.getByRole('button', { name: 'Add source' }).click();
  await expect(page.getByRole('heading', { name: 'Submission Completed' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Submission items' })).toContainText(
    'renderer-safe.md',
  );
});

test('Sources guards an unsaved form and releases navigation after discard', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/sources');
  await page.getByLabel('Source Library').getByRole('link', { name: 'Add Source' }).click();
  await expect(page).toHaveURL(/\/sources\?view=add$/);

  await page.getByLabel('Label').fill('Guarded source');
  await page.getByLabel('Direct Text').fill('Transient unsaved evidence');
  await page.getByRole('link', { name: 'Source Library' }).click();
  const guard = page.getByRole('dialog', { name: 'Leave with unsubmitted drafts?' });
  await expect(guard).toBeVisible();
  await guard.getByRole('button', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(/\/sources\?view=add$/);
  await expect(page.getByLabel('Direct Text')).toHaveValue('Transient unsaved evidence');
  await page.getByRole('link', { name: 'Source Library' }).click();
  await guard.getByRole('button', { name: 'Discard drafts and leave' }).click();
  await expect(page).toHaveURL(/\/sources$/);
});

test('Sources URL preflight is advisory, transient, PC-shell-safe, and offline-safe', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/sources');
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toHaveCount(0);
  await page.getByLabel('Source Library').getByRole('link', { name: 'Add Source' }).click();
  await expect(page).toHaveURL(/\/sources\?view=add$/);

  await page.getByLabel('Input type').selectOption('URL');
  await page.getByLabel('URL').fill('file:///etc/passwd');
  await page.getByRole('button', { name: 'Add source' }).click();
  await expect(page.getByText('Enter an absolute HTTP(S) URL.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Submission Completed' })).toHaveCount(0);
  expect(page.url()).not.toContain('file');

  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.getByLabel('Search Sources')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add source' })).toBeDisabled();
});
