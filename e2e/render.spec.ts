import { expect, test } from '@playwright/test';
import { createProject, openProject, prisma, signUp } from './helpers';

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.describe('rendering (acceptance: real render, not a screenshot)', () => {
  test('progressive still render produces an image at the requested resolution', async ({ page }) => {
    await signUp(page);
    const id = await createProject(page, { name: 'Render still', category: 'KITCHEN', layout: 'l_shape' });
    await openProject(page, id);
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'Render', exact: true }).click();
    await page.getByLabel('Resolution').selectOption('1280x720');
    const samples = page.getByRole('textbox', { name: 'Quality samples' });
    await samples.click();
    await samples.fill('4');
    await samples.press('Enter');
    await page.getByRole('button', { name: 'Start render' }).click();
    const img = page.getByRole('img', { name: 'Rendered result' });
    await expect(img).toBeVisible({ timeout: 80_000 });
    const dims = await img.evaluate((el: HTMLImageElement) => ({ w: el.naturalWidth, h: el.naturalHeight }));
    expect(dims).toEqual({ w: 1280, h: 720 });
    await expect(page.getByRole('link', { name: 'Download' })).toBeVisible();
    // the live view comes back after the render
    await page.getByRole('dialog').getByText('Close', { exact: true }).click();
    const canvas = await page.locator('canvas').first().evaluate((c: HTMLCanvasElement) => ({ w: c.width, h: c.height }));
    expect(canvas.w).toBeGreaterThan(300);
  });

  test('360° panorama is 2:1 equirectangular', async ({ page }) => {
    await signUp(page);
    const id = await createProject(page, { name: 'Render pano', category: 'WARDROBE' });
    await openProject(page, id);
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'Render', exact: true }).click();
    await page.getByRole('tab', { name: '360° panorama' }).click();
    await page.getByLabel('Panorama width').selectOption('2048');
    await page.getByRole('button', { name: 'Start render' }).click();
    const img = page.getByRole('img', { name: 'Rendered result' });
    await expect(img).toBeVisible({ timeout: 80_000 });
    const dims = await img.evaluate((el: HTMLImageElement) => ({ w: el.naturalWidth, h: el.naturalHeight }));
    expect(dims).toEqual({ w: 2048, h: 1024 });
  });
});
