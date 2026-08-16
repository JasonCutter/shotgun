import { expect, test } from '@playwright/test';

import { expectTechnicalInformation } from './hfm-technical.js';

const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;

test('Human-readable primary UI smoke', async ({ page }) => {
  const sourceLabel = `Human-readable source ${Date.now()}`;

  await page.goto('/sources');
  await expect(page.getByRole('heading', { name: 'Sources', level: 1 })).toBeVisible();
  await expect(page.locator('.project-summary')).toContainText('shotgun');
  await expect(page.getByRole('combobox', { name: 'Current project' })).toBeVisible();
  await expect(page.getByText(/Principal [0-9a-f-]{20,}/i)).toHaveCount(0);
  await page.getByLabel('Source Library').getByRole('link', { name: 'Add Source' }).click();
  await expect(page).toHaveURL(/\/sources\?view=add$/);

  await page.getByLabel('Label').fill(sourceLabel);
  await page
    .getByLabel('Direct Text')
    .fill(`A human-readable Source label must survive intake: ${sourceLabel}.`);
  await page.getByRole('button', { name: 'Add intake draft' }).click();
  await page.getByRole('button', { name: 'Submit drafts' }).click();

  await expect(page.getByRole('heading', { name: 'Submission Completed' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByRole('list', { name: 'Submission items' }).getByText(sourceLabel, { exact: true }),
  ).toBeVisible();
  await expect(page.locator('details.technical-details')).toHaveCount(0);
  await expectTechnicalInformation(page, 'Submission ID');

  await page.getByRole('link', { name: 'Source Library' }).click();
  await expect(page).toHaveURL(/\/sources$/);
  await expect(page.getByRole('link', { name: 'Open source' }).first()).toBeVisible();
  await expect(page.getByText('Preview ready')).toHaveCount(0);
  await expect(page.getByText('Available with indexed evidence')).toHaveCount(0);

  const primaryText = await page.locator('body').innerText();
  expect(primaryText).not.toMatch(uuidPattern);
  expect(primaryText).not.toContain('SUCCEEDED');
  expect(primaryText).not.toContain('SOURCE_VERSION_READY');
  expect(primaryText).not.toContain('EVIDENCE_READY');
});
