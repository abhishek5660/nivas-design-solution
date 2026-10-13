import { expect, test } from '@playwright/test';
import { createProject, openProject, prisma, signUp, state, waitSaved } from './helpers';
import { click, planState, tool } from './plan-helpers';

test.afterAll(async () => {
  await prisma.$disconnect();
});


test.describe('floor plan workspace', () => {
  test('draw a room, add a door + window + furniture, undo/redo, see it in 3D, save, reload', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await signUp(page);
    const id = await createProject(page, { name: 'E2E floor plan', category: 'CUSTOM', floorPlan: true });
    await openProject(page, id);
    await expect(page.getByTestId('plan-workspace')).toBeVisible();
    await expect(page.getByTestId('plan-canvas')).toBeVisible();

    // walls: click-click drawing, closing the loop at the first point
    await tool(page, 'architecture', 'wall');
    for (const [x, y] of [[1000, 1000], [6000, 1000], [6000, 4500], [1000, 4500], [1000, 1000]]) await click(page, x, y);
    await page.keyboard.press('Escape');
    let s = await planState(page);
    expect(s.walls).toBe(4);

    // door and window go onto the wall that is clicked
    await tool(page, 'architecture', 'door');
    await click(page, 3000, 1000);
    await page.keyboard.press('Escape');
    await tool(page, 'architecture', 'window');
    await click(page, 6000, 2700);
    await page.keyboard.press('Escape');
    s = await planState(page);
    expect(s.doors).toBe(1);
    expect(s.windows).toBe(1);

    // furniture from the library lands on this floor
    await page.getByTestId('tab-insert').click();
    await page.getByTestId('rb-furnish').click();
    await page.getByRole('button', { name: /Double bed/ }).first().click();
    await click(page, 3500, 3200);
    await page.keyboard.press('Escape');
    s = await planState(page);
    expect(s.nodes).toBe(1);
    const node = await state<{ floorId: string; type: string }>(page, `(s)=>{const n=Object.values(s.doc.nodes)[0];return {floorId:n.floorId,type:n.type};}`);
    expect(node.type).toBe('furniture');
    expect(node.floorId).toBe(s.floorId);

    // undo removes the furniture again (one step per action), redo brings it back
    await page.keyboard.press('Control+z');
    expect((await planState(page)).nodes).toBe(0);
    await page.keyboard.press('Control+y');
    expect((await planState(page)).nodes).toBe(1);

    // the same model in 3D
    await page.getByTestId('view-3d').click();
    await page.waitForSelector('canvas:not([data-testid="plan-canvas"])', { timeout: 20_000 });
    await expect.poll(() => page.evaluate(() => (window as unknown as { __nivas: { frames: () => number } }).__nivas.frames()), { timeout: 15_000 }).toBeGreaterThan(0);
    await page.getByTestId('view-2d').click();

    // save, reload: everything is still there
    await page.keyboard.press('Control+s');
    await waitSaved(page);
    await page.reload();
    await page.waitForFunction(() => !!(window as unknown as { __nivas?: unknown }).__nivas);
    await expect(page.getByTestId('plan-canvas')).toBeVisible();
    const after = await planState(page);
    expect(after).toMatchObject({ walls: 4, doors: 1, windows: 1, nodes: 1 });

    expect(errors).toEqual([]);
  });
});
