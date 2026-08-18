import { expect, type Page } from '@playwright/test';

export const openTechnicalInformation = async (page: Page) => {
  const globalTools = page.getByRole('banner');
  await expect(globalTools).toBeVisible();
  await expect(page.locator('.project-summary')).toBeVisible();
  await expect(globalTools.getByRole('button', { name: 'Search', exact: true })).toHaveCount(0);
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('region', { name: 'Commands' });
  await expect(palette).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Commands' })).toHaveCount(0);
  const query = palette.getByRole('textbox', { name: 'Command search' });
  await query.fill('technical information');
  await palette.getByRole('button', { name: /^Technical information/ }).click();
  const technical = page.getByRole('dialog', { name: 'Technical information' });
  await expect(technical).toBeVisible();
  return technical;
};

export const expectTechnicalInformation = async (
  page: Page,
  expected: string | readonly string[],
) => {
  const technical = await openTechnicalInformation(page);
  for (const value of typeof expected === 'string' ? [expected] : expected) {
    await expect(technical).toContainText(value);
  }
  await technical.getByRole('button', { name: 'Close' }).click();
};
