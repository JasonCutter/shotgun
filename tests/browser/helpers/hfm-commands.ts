import { expect, type Page } from '@playwright/test';

export const openCommandPalette = async (page: Page) => {
  const globalTools = page.getByRole('banner');
  await expect(globalTools).toBeVisible();
  await expect(page.locator('.project-summary')).toBeVisible();
  await expect(globalTools.getByRole('button', { name: 'Search' })).toHaveCount(0);
  await expect(globalTools.getByRole('button', { name: 'Commands' })).toHaveCount(0);
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('region', { name: 'Commands' });
  await expect(palette).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Commands' })).toHaveCount(0);
  return palette;
};

export const switchProject = async (page: Page, projectLabel: string) => {
  const palette = await openCommandPalette(page);
  await palette.getByRole('button', { name: `Switch to ${projectLabel}` }).click();
};
