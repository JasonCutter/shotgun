import { expect, test } from '@playwright/test';

test('Sources keeps draft input route-scoped, blocks server submit, and guards Project switch', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/sources');

  await expect(page.getByRole('heading', { name: 'Sources', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Source Library' })).toBeVisible();
  await page.getByLabel('Label').fill('E2E draft');
  await page.getByLabel('Direct Text').fill('Transient browser-only evidence');
  await page.getByRole('button', { name: 'Add intake draft' }).click();

  await expect(page.getByRole('list', { name: 'Intake drafts' })).toContainText('E2E draft');
  await expect(page.getByRole('button', { name: 'Submit drafts' })).toBeDisabled();
  await expect(
    page.getByText('Client preflight passed. The Server will validate again.'),
  ).toBeVisible();

  const selector = page.getByRole('combobox', { name: 'Active Project' });
  await selector.selectOption('project-b');
  await expect(selector).toHaveValue('shotgun');
  await expect(page.getByRole('alert')).toContainText('current Workspace');

  await expect
    .poll(() =>
      page.evaluate(() => `${JSON.stringify(localStorage)}${JSON.stringify(sessionStorage)}`),
    )
    .not.toContain('Transient browser-only evidence');

  await page.getByRole('button', { name: 'Discard all drafts' }).click();
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
