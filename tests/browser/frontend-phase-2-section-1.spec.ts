import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

test('Sources stages and submits Direct Text, then releases Project switching after success', async ({
  page,
}) => {
  const uniqueToken = randomUUID();
  const draftLabel = `E2E draft ${uniqueToken}`;
  const draftText = `Transient browser-only evidence ${uniqueToken}`;

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/sources');

  await expect(page.getByRole('heading', { name: 'Sources', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Source Library' })).toBeVisible();
  await page.getByLabel('Label').fill(draftLabel);
  await page.getByLabel('Direct Text').fill(draftText);
  await page.getByRole('button', { name: 'Add intake draft' }).click();

  await expect(page.getByRole('list', { name: 'Intake drafts' })).toContainText(draftLabel);
  await expect(page.getByRole('button', { name: 'Submit drafts' })).toBeEnabled();
  await expect(
    page.getByText('Client preflight passed. The Server will validate again.'),
  ).toBeVisible();

  await expect
    .poll(() =>
      page.evaluate(() => `${JSON.stringify(localStorage)}${JSON.stringify(sessionStorage)}`),
    )
    .not.toContain(draftText);

  await page.getByRole('button', { name: 'Submit drafts' }).click();
  await expect(page.getByRole('heading', { name: 'Submission Completed' })).toBeVisible();
  await expect(page.getByText('No route-scoped drafts.')).toBeVisible();

  const selector = page.getByRole('combobox', { name: 'Current project' });
  await selector.selectOption('project-b');
  await expect(selector).toHaveValue('project-b');
});

test('Sources keeps Project switching blocked after a partial delete and releases it after the last delete', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/sources');

  await page.getByLabel('Label').fill('Draft A');
  await page.getByLabel('Direct Text').fill('First transient draft');
  await page.getByRole('button', { name: 'Add intake draft' }).click();
  await page.getByLabel('Label').fill('Draft B');
  await page.getByLabel('Direct Text').fill('Second transient draft');
  await page.getByRole('button', { name: 'Add intake draft' }).click();

  const selector = page.getByRole('combobox', { name: 'Current project' });
  await page.getByRole('button', { name: 'Remove Draft A' }).click();
  await selector.selectOption('project-b');
  await expect(selector).toHaveValue('shotgun');
  await expect(page.getByRole('alert')).toContainText('current Workspace');

  await page.getByRole('button', { name: 'Remove Draft B' }).click();
  await selector.selectOption('project-b');
  await expect(selector).toHaveValue('project-b');
});

test('Sources URL preflight is advisory, transient, responsive, and offline-safe', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/sources');
  await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible();

  await page.getByLabel('Input type').selectOption('URL');
  await page.getByLabel('URL').fill('file:///etc/passwd');
  await page.getByRole('button', { name: 'Add intake draft' }).click();
  await expect(page.getByText('Enter an absolute HTTP(S) URL.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit drafts' })).toBeDisabled();
  expect(page.url()).not.toContain('file');

  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.getByLabel('Search Sources')).toBeDisabled();
  await expect(page.getByText(/Server search and intake actions are blocked/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit drafts' })).toBeDisabled();
});
