import { expect, test, type Page } from '@playwright/test';
import { createProject, openProject, prisma, signUp, state, waitSaved } from './helpers';
import { click, drawRoom, move, planState, tool, ui } from './plan-helpers';

test.afterAll(async () => {
  await prisma.$disconnect();
});

const host = (page: Page, src: string) => page.evaluate((code) => new Function('h', code)((window as unknown as { __nivas: { plan: { host: unknown } } }).__nivas.plan.host), src);

const open = async (page: Page, body: Record<string, unknown> = {}) => {
  await signUp(page);
  const id = await createProject(page, { name: 'Flow', category: 'CUSTOM', floorPlan: true, ...body });
  await openProject(page, id);
  await expect(page.getByTestId('plan-canvas')).toBeVisible();
  return id;
};

test.describe('floor plan flows', () => {
  test('typed numeric input draws exact lengths and the properties panel edits them', async ({ page }) => {
    await open(page);
    await tool(page, 'architecture', 'wall');
    await click(page, 1000, 1000);
    await move(page, 5000, 1000);
    await page.keyboard.type('3250');
    await expect(page.getByTestId('dynamic-input')).toContainText('3250');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    const wall = await state<{ a: number[]; b: number[]; thickness: number }>(page, `(s)=>{const f=s.doc.plan.buildings[0].floors[0];return f.entities[f.order[0]];}`);
    expect(Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1])).toBeCloseTo(3250, 3);

    // select it and change the thickness in the properties panel
    await page.getByTestId('tab-home').click();
    await page.getByTestId('rb-select').click();
    await click(page, 2500, 1000);
    await expect(page.getByText(/Properties — /)).toBeVisible();
    const field = page.getByRole('textbox', { name: 'Thickness', exact: true });
    await field.click();
    await field.fill('310');
    await field.press('Enter');
    expect(await state<number>(page, `(s)=>{const f=s.doc.plan.buildings[0].floors[0];return f.entities[f.order[0]].thickness;}`)).toBe(310);
  });

  test('floors: add a floor, draw on it, switch back; 3D shows both', async ({ page }) => {
    await open(page);
    await drawRoom(page, 1000, 1000, 5000, 4000);
    const ground = await planState(page);
    expect(ground.walls).toBe(4);
    await page.getByLabel('Floor', { exact: true }).selectOption({ label: 'Add / edit floors…' });
    await page.getByRole('button', { name: 'Add above' }).click();
    await expect(page.getByLabel('Floor', { exact: true })).toHaveValue(/floor_/);
    expect((await planState(page)).walls).toBe(0);
    await page.getByRole('button', { name: 'Close Buildings & floors' }).click();
    await drawRoom(page, 1000, 1000, 4000, 3000);
    expect((await planState(page)).walls).toBe(4);
    const floors = await state<{ n: string; e: number }[]>(page, `(s)=>s.doc.plan.buildings[0].floors.map(f=>({n:f.name,e:f.elevation}))`);
    expect(floors).toEqual([{ n: 'Ground Floor', e: 0 }, { n: 'First Floor', e: 2800 }]);
    // back to the ground floor: its walls are untouched
    await page.getByLabel('Floor', { exact: true }).selectOption({ label: 'Ground Floor' });
    expect((await planState(page)).walls).toBe(4);
    await page.getByTestId('tab-view').click();
    await page.getByTestId('rb-fl-all').click();
    await page.getByTestId('view-3d').click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __nivas: { meshes: () => number } }).__nivas.meshes()), { timeout: 20_000 }).toBeGreaterThanOrEqual(10); // walls and floors of both storeys
  });

  test('branches keep separate variants of the whole design', async ({ page }) => {
    await open(page);
    await drawRoom(page, 1000, 1000, 6000, 5000);
    await host(page, `h.placeFurniture('sofa3', [3000, 2000], 0)`);
    await page.getByTestId('tab-outputs').click();
    await page.getByTestId('rb-panel-branch').click();
    await page.getByLabel('Branch name').fill('Option B');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByText('Option B')).toBeVisible();
    // change the main design, then open the branch: it still has the original
    await host(page, `h.placeFurniture('bed_double', [4500, 4000], 0)`);
    expect((await planState(page)).nodes).toBe(2);
    await page.getByRole('listitem').filter({ hasText: 'Option B' }).getByRole('button', { name: 'Open' }).click();
    await expect.poll(async () => (await planState(page)).nodes).toBe(1);
    await page.getByRole('listitem').filter({ hasText: 'Main design' }).getByRole('button', { name: 'Open' }).click();
    await expect.poll(async () => (await planState(page)).nodes).toBe(2);
  });

  test('wizard builds rooms; QC findings can be located; pricing feeds the BOQ', async ({ page }) => {
    await open(page);
    await page.getByTestId('tab-architecture').click();
    await page.getByTestId('rb-panel-aifloor').click();
    await page.getByRole('button', { name: 'Create floor plan' }).click();
    const s = await planState(page);
    expect(s.walls).toBeGreaterThanOrEqual(8);
    expect(s.doors).toBeGreaterThanOrEqual(4);
    expect(s.windows).toBeGreaterThanOrEqual(3);
    // something to flag: a toilet straight into a wall
    await host(page, `h.placeFurniture('toilet', [200, 200], 0)`);
    await page.getByTestId('tab-outputs').click();
    await page.getByTestId('rb-panel-qc').click();
    await expect(page.getByText(/runs into a wall/).first()).toBeVisible();
    await page.getByText(/runs into a wall/).first().click();
    expect(await ui<number>(page, '(s)=>s.selection.length')).toBe(1);

    // pricing: enter a door price and see it priced in the BOQ schedule
    await page.getByTestId('rb-panel-pricing').click();
    const doorRow = page.getByRole('row').filter({ hasText: 'Door' }).first();
    const price = doorRow.getByRole('textbox').first();
    await price.click();
    await price.fill('12500');
    await price.press('Enter');
    await page.getByTestId('rb-panel-boq').click();
    await expect(page.getByRole('row').filter({ hasText: 'Door' }).first()).not.toContainText('no price');
    const prices = await state<Record<string, { unitPrice: number }>>(page, '(s)=>s.doc.plan.prices');
    expect(Object.values(prices).some((p) => p.unitPrice === 12500)).toBe(true);
  });

  test('exports: DXF download, drawings PDF with a floor sheet, floor-plan SVG', async ({ page }) => {
    const id = await open(page);
    await drawRoom(page, 1000, 1000, 6000, 4500);
    await tool(page, 'architecture', 'door');
    await click(page, 3000, 1000);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+s');
    await waitSaved(page);

    await page.getByTestId('tab-render').click();
    await page.getByTestId('rb-export').click();
    const dl = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: /DXF/ }).click();
    const file = await dl;
    expect(file.suggestedFilename()).toMatch(/\.dxf$/);
    const text = (await (await file.createReadStream())!.toArray()).map((b) => b.toString()).join('');
    expect(text).toContain('WALLS');
    expect(text).toContain('DOORS');
    expect(text.trimEnd().endsWith('EOF')).toBe(true);

    const pdf = await page.request.get(`/api/projects/${id}/export?type=drawings.pdf`);
    expect(pdf.status()).toBe(200);
    expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF');
    const svg = await page.request.get(`/api/projects/${id}/export?type=floorplan.svg`);
    expect(svg.status()).toBe(200);
    const svgText = await svg.text();
    expect(svgText).toContain('<svg');
    expect(svgText).toContain('FLOOR PLAN');
    expect(svgText).toContain('data-layer="WALLS"');
  });

  test('a classic project converts into a floor plan and keeps its cabinets', async ({ page }) => {
    await signUp(page);
    const id = await createProject(page, { name: 'Classic', category: 'WARDROBE' });
    await openProject(page, id);
    await page.getByRole('button', { name: 'Convert to floor plan' }).click();
    await expect(page.getByTestId('plan-canvas')).toBeVisible();
    const s = await planState(page);
    expect(s.walls).toBeGreaterThanOrEqual(4);
    expect(s.doors + s.windows).toBeGreaterThanOrEqual(1);
    expect(s.nodes).toBe(1); // the wardrobe
    // undoing the conversion returns to the classic workspace
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('plan-workspace')).toBeHidden();
  });

  test('design modes protect architecture while furnishing, and a locked design refuses edits', async ({ page }) => {
    await open(page);
    await drawRoom(page, 1000, 1000, 5000, 4000);
    await page.getByTestId('tab-home').click();
    await page.getByTestId('rb-select').click();
    // interior mode: walls are not selectable
    await page.getByLabel('Design mode').selectOption('interior');
    await click(page, 3000, 1000);
    expect(await ui<number>(page, '(s)=>s.selection.length')).toBe(0);
    await page.getByLabel('Design mode').selectOption('architecture');
    await click(page, 3000, 1000);
    expect(await ui<number>(page, '(s)=>s.selection.length')).toBe(1);
    // lock the design: drawing is refused with a message
    await page.getByTestId('tab-view').click();
    await page.getByTestId('rb-lockdesign').click();
    await tool(page, 'architecture', 'wall');
    await click(page, 6000, 1000);
    await click(page, 7000, 1000);
    expect((await planState(page)).walls).toBe(4);
    await expect(page.getByTestId('plan-status')).toContainText(/locked/i);
  });
});
