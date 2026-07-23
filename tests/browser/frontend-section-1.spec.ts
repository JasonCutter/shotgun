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
  await expect(page.locator('.project-summary')).toContainText('project-a');
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

  await page.route('**/api/v1/session/active-project', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.continue();
  });
  const projectSelector = page.getByRole('combobox', { name: 'Active Project' });
  await projectSelector.selectOption('project-b');
  await expect(page.getByRole('status', { name: '' })).toContainText('Project 전환 중');
  await expect(projectSelector).toHaveValue('project-b');
  await expect(page.locator('.project-summary')).toContainText('project-b');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(projectSelector).toHaveValue('project-b');
  await expect(page.locator('.project-summary')).not.toContainText('project-a');

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
});
