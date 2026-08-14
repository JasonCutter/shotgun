import { expect, type Page } from '@playwright/test';

export const openCommandPalette = async (page: Page) => {
  await expect(page.getByRole('button', { name: 'Commands' })).toHaveCount(0);
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Commands' });
  await expect(palette).toBeVisible();
  return palette;
};

export const switchProject = async (page: Page, projectLabel: string) => {
  const palette = await openCommandPalette(page);
  await palette.getByRole('button', { name: `Switch to ${projectLabel}` }).click();
};
