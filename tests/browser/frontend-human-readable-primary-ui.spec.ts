import { expect, test } from '@playwright/test';

const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;

test('Human-readable primary UI smoke', async ({ page }) => {
  const sourceLabel = `Human-readable source ${Date.now()}`;

  await page.goto('/sources');
  await expect(page.getByRole('heading', { name: 'Sources', level: 1 })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Current project' })).toContainText('shotgun');
  await expect(page.getByText(/Principal [0-9a-f-]{20,}/i)).toHaveCount(0);

  await page.getByLabel('Label').fill(sourceLabel);
  await page.getByLabel('Direct Text').fill('A human-readable Source label must survive intake.');
  await page.getByRole('button', { name: 'Add intake draft' }).click();
  await page.getByRole('button', { name: 'Submit drafts' }).click();

  await expect(page.getByRole('heading', { name: 'Submission Completed' })).toBeVisible();
  await expect(page.getByRole('heading', { name: sourceLabel })).toBeVisible();

  const primaryText = await page.locator('body').innerText();
  expect(primaryText).not.toMatch(uuidPattern);
  expect(primaryText).not.toContain('SUCCEEDED');
  expect(primaryText).not.toContain('SOURCE_VERSION_READY');
  expect(primaryText).not.toContain('EVIDENCE_READY');

  const submissionDetails = page.locator('details').filter({ hasText: 'Submission ID' }).first();
  await expect(submissionDetails).not.toHaveAttribute('open', '');
  await submissionDetails.locator('summary').click();
  await expect(submissionDetails).toHaveAttribute('open', '');
  expect(await submissionDetails.innerText()).toMatch(uuidPattern);
});
