import { expect, test, type Page } from '@playwright/test';
import { createProject, openProject, prisma, signUp, state } from './helpers';
import { click, move, tool, toScreen, ui } from './plan-helpers';

test.afterAll(async () => {
  await prisma.$disconnect();
});

type Ent = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const entities = (page: Page) =>
  state<Ent[]>(page, `(s)=>{const f=s.doc.plan.buildings[0].floors[0];return f.order.map(i=>f.entities[i]);}`);

async function drag(page: Page, a: [number, number], b: [number, number]) {
  const p = await toScreen(page, a[0], a[1]);
  const q = await toScreen(page, b[0], b[1]);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(q.x, q.y, { steps: 8 });
  await page.mouse.up();
}

test('draw and edit with the mouse: shapes, box select, move, copy, mirror, delete, undo', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signUp(page);
  const id = await createProject(page, { name: 'Draw', category: 'CUSTOM', floorPlan: true });
  await openProject(page, id);
  await expect(page.getByTestId('plan-canvas')).toBeVisible();

  // --- shapes
  await tool(page, 'draw', 'line');
  await click(page, 1000, 1000);
  await click(page, 3000, 1000);
  await page.keyboard.press('Escape');

  await tool(page, 'draw', 'rect');
  await click(page, 1000, 2000);
  await click(page, 3000, 3000);

  await tool(page, 'draw', 'circle');
  await click(page, 6000, 2000);
  await click(page, 7000, 2000);

  await tool(page, 'draw', 'polyline');
  for (const [x, y] of [[1000, 4500], [2000, 5000], [3000, 4500]]) await click(page, x, y);
  await page.keyboard.press('Enter');

  await tool(page, 'draw', 'arc');
  for (const [x, y] of [[5000, 4500], [6000, 5200], [7000, 4500]]) await click(page, x, y);

  await tool(page, 'draw', 'polygon');
  for (const [x, y] of [[8500, 1000], [9500, 1000], [9800, 2000], [8200, 2000]]) await click(page, x, y);
  await page.keyboard.press('Enter');

  let ents = await entities(page);
  const kinds = ents.map((e) => e.kind).sort();
  expect(kinds).toEqual(['arc', 'circle', 'line', 'polygon', 'polyline', 'rect']);
  const line = ents.find((e) => e.kind === 'line')!;
  expect(line.a).toEqual([1000, 1000]);
  expect(line.b).toEqual([3000, 1000]);
  expect(ents.find((e) => e.kind === 'circle')!.r).toBeCloseTo(1000, 3);
  expect(ents.find((e) => e.kind === 'polyline')!.pts).toHaveLength(3);
  expect(ents.find((e) => e.kind === 'polygon')!.pts).toHaveLength(4);

  // --- box select (window: left → right selects what is fully inside)
  await page.getByTestId('tab-home').click();
  await page.getByTestId('rb-select').click();
  await drag(page, [500, 1500], [3500, 3500]);
  expect(await ui<string[]>(page, '(s)=>s.selection')).toEqual([ents.find((e) => e.kind === 'rect')!.id]);

  // --- move with the Move tool (base point → destination)
  await page.getByTestId('rb-move').click();
  await click(page, 1000, 2000);
  await click(page, 1000, 3000);
  ents = await entities(page);
  const rect = ents.find((e) => e.kind === 'rect')!;
  expect(rect.p1).toEqual([1000, 3000]);
  expect(rect.p2).toEqual([3000, 4000]);

  // --- copy (stays selected, adds a second rectangle)
  await page.getByTestId('rb-copy').click();
  await click(page, 1000, 3000);
  await click(page, 4000, 3000);
  await page.keyboard.press('Escape');
  ents = await entities(page);
  expect(ents.filter((e) => e.kind === 'rect')).toHaveLength(2);

  // --- mirror the selection across a vertical axis, keeping the original
  await page.getByTestId('rb-mirror').click();
  await click(page, 10000, 0);
  await click(page, 10000, 1000);
  await page.keyboard.press('Escape');
  ents = await entities(page);
  expect(ents.length).toBeGreaterThanOrEqual(8);

  // --- delete with the keyboard, then undo / redo restore it
  const before = (await entities(page)).length;
  await page.getByTestId('rb-select').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  expect((await entities(page)).length).toBe(0);
  await page.keyboard.press('Control+z');
  expect((await entities(page)).length).toBe(before);
  await page.keyboard.press('Control+y');
  expect((await entities(page)).length).toBe(0);
  await page.keyboard.press('Control+z');

  // --- dimension tool: two clicked points and an offset give the measured length
  await page.getByTestId('tab-architecture').click();
  await page.getByTestId('rb-dimension').click();
  await click(page, 1000, 1000);
  await click(page, 3000, 1000);
  await move(page, 2000, 400);
  await click(page, 2000, 400);
  await page.keyboard.press('Escape');
  ents = await entities(page);
  const dim = ents.find((e) => e.kind === 'dimension')!;
  expect(Math.hypot(dim.b[0] - dim.a[0], dim.b[1] - dim.a[1])).toBeCloseTo(2000, 3);
  expect(errors).toEqual([]);
});
