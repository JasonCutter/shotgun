import { expect, type Page } from '@playwright/test';

export const openTechnicalInformation = async (page: Page) => {
  await expect(page.getByRole('button', { name: 'Search' })).toBeVisible();
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Commands' });
  await expect(palette).toBeVisible();
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
