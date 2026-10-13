import type { Page } from '@playwright/test';
import { state } from './helpers';

export type PlanState = { floorId: string; walls: number; doors: number; windows: number; nodes: number; entities: number };

export const planState = (page: Page) =>
  state<PlanState>(
    page,
    `(s)=>{const p=s.doc.plan;const f=p.buildings.flatMap(b=>b.floors).find(x=>x.id===p.activeFloorId);const es=Object.values(f.entities);
      return {floorId:f.id,walls:es.filter(e=>e.kind==='wall').length,doors:es.filter(e=>e.kind==='door').length,windows:es.filter(e=>e.kind==='window').length,entities:es.length,nodes:Object.values(s.doc.nodes).filter(n=>n.type!=='group').length};}`,
  );

/** converts plan millimetres to page pixels using the live 2D view */
export async function toScreen(page: Page, x: number, y: number) {
  const box = (await page.getByTestId('plan-canvas').boundingBox())!;
  const view = await page.evaluate(() => {
    const w = window as unknown as { __nivas: { plan: { ui: { getState: () => { views: Record<string, { cx: number; cy: number; scale: number }> } } }; store: { getState: () => { doc: { plan: { activeFloorId: string } } } } } };
    return w.__nivas.plan.ui.getState().views[w.__nivas.store.getState().doc.plan.activeFloorId];
  });
  return { x: box.x + (x - view.cx) * view.scale + box.width / 2, y: box.y + (y - view.cy) * view.scale + box.height / 2 };
}

export async function click(page: Page, x: number, y: number) {
  const p = await toScreen(page, x, y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
}

export async function move(page: Page, x: number, y: number) {
  const p = await toScreen(page, x, y);
  await page.mouse.move(p.x, p.y, { steps: 3 });
}

export async function tool(page: Page, tab: string, id: string) {
  await page.getByTestId(`tab-${tab}`).click();
  await page.getByTestId(`rb-${id}`).click();
}

/** draws a closed rectangle of walls with the wall tool */
export async function drawRoom(page: Page, x0: number, y0: number, x1: number, y1: number) {
  await tool(page, 'architecture', 'wall');
  for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]) await click(page, x, y);
  await page.keyboard.press('Escape');
}

export const ui = <T>(page: Page, fn: string): Promise<T> =>
  page.evaluate((src) => {
    const w = window as unknown as { __nivas: { plan: { ui: { getState: () => unknown } } } };
    // eslint-disable-next-line no-new-func
    return new Function('s', `return (${src})(s)`)(w.__nivas.plan.ui.getState());
  }, fn) as Promise<T>;
