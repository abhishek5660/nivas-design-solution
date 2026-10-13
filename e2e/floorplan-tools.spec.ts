import { expect, test, type Page } from '@playwright/test';
import zlib from 'node:zlib';
import { createProject, openProject, prisma, signUp } from './helpers';

test.afterAll(async () => {
  await prisma.$disconnect();
});

/** a valid 1 m cube as a binary glTF */
function makeGlb(): Buffer {
  const pos = new Float32Array([-0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5]);
  const idx = new Uint16Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 3, 0, 4, 3, 4, 7]);
  const bin = Buffer.concat([Buffer.from(pos.buffer), Buffer.from(idx.buffer)]);
  const json = JSON.stringify({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pos.byteLength, target: 34962 }, { buffer: 0, byteOffset: pos.byteLength, byteLength: idx.byteLength, target: 34963 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] }, { bufferView: 1, componentType: 5123, count: 36, type: 'SCALAR' }],
  });
  const jb = Buffer.from(json + ' '.repeat((4 - (json.length % 4)) % 4));
  const total = 12 + 8 + jb.length + 8 + bin.length;
  const h = Buffer.alloc(12);
  h.writeUInt32LE(0x46546c67, 0);
  h.writeUInt32LE(2, 4);
  h.writeUInt32LE(total, 8);
  const c1 = Buffer.alloc(8);
  c1.writeUInt32LE(jb.length, 0);
  c1.writeUInt32LE(0x4e4f534a, 4);
  const c2 = Buffer.alloc(8);
  c2.writeUInt32LE(bin.length, 0);
  c2.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([h, c1, jb, c2, bin]);
}

/** a valid 2x1 px PNG (aspect ratio 2:1) */
function makePng(): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.from([0, 255, 0, 0, 0, 0, 255]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const signature = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __nivas: { plan: { ui: { getState: () => any } }; store: { getState: () => any } } }; // eslint-disable-line @typescript-eslint/no-explicit-any
    const u = w.__nivas.plan.ui.getState();
    const d = w.__nivas.store.getState().doc.plan;
    return JSON.stringify({
      tool: u.tool,
      panel: u.panel,
      status: u.status?.text,
      mode: u.viewMode,
      flo: u.floorMode,
      views: Object.values(u.views).map((v: any) => v.scale), // eslint-disable-line @typescript-eslint/no-explicit-any
      sel: u.selection.length,
      prompt: !!u.prompt,
      menus: document.querySelectorAll('[role=menu]').length,
      dialogs: document.querySelectorAll('[role=dialog]').length,
      settings: d.settings,
      locked: d.locked,
      vp: d.viewpoints.length,
      ents: d.buildings.flatMap((b: any) => b.floors).reduce((a: number, f: any) => a + f.order.length, 0), // eslint-disable-line @typescript-eslint/no-explicit-any
    });
  });

async function reset(page: Page) {
  // close menus / dialogs / panels so every button starts from a clean state
  for (let i = 0; i < 3; i++) {
    const dialog = page.getByRole('dialog');
    if (await dialog.count()) await dialog.getByRole('button', { name: /^(Close|Cancel)$/ }).first().click().catch(() => undefined);
  }
  await page.mouse.click(5, 5);
  await page.evaluate(() => {
    const w = window as unknown as { __nivas: { plan: { ui: { getState: () => any; setState: (s: unknown) => void } } } }; // eslint-disable-line @typescript-eslint/no-explicit-any
    w.__nivas.plan.ui.setState({ panel: null, prompt: null, status: null });
  });
  await page.waitForTimeout(200);
}

test.describe('floor plan tools (no dead buttons)', () => {
  test('every ribbon button does something visible; unsupported ones say why', async ({ page }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('filechooser', (fc) => void fc.setFiles([]));
    await signUp(page);
    const id = await createProject(page, { name: 'Tool smoke', category: 'CUSTOM', floorPlan: true });
    await openProject(page, id);
    await expect(page.getByTestId('plan-canvas')).toBeVisible();
    // content so tools have something to act on
    await page.getByTestId('tab-architecture').click();
    await page.getByTestId('rb-panel-aifloor').click();
    await page.getByRole('button', { name: 'Create floor plan' }).click();
    await reset(page);

    const exempt = new Set(['rb-import3d', 'rb-addref', 'rb-production']); // file pickers / tab switch are covered separately
    const dead: string[] = [];
    let total = 0;
    for (const tab of ['home', 'view', 'insert', 'draw', 'architecture', 'annotate', 'render', 'outputs']) {
      await page.getByTestId(`tab-${tab}`).click();
      const ids = await page.locator('[data-testid^="rb-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!));
      for (const tid of ids) {
        if (exempt.has(tid)) continue;
        await reset(page);
        const before = await signature(page);
        const alreadyOn = (await page.getByTestId(tid).getAttribute('aria-pressed')) === 'true';
        await page.getByTestId(tid).click({ force: true });
        await page.waitForTimeout(250);
        const after = await signature(page);
        total++;
        if (before === after && !alreadyOn) dead.push(`${tab}/${tid}`);
        const disabled = await page.getByTestId(tid).getAttribute('aria-disabled');
        if (disabled) expect(JSON.parse(after).status, `${tid} must explain why it is unavailable`).toMatch(/not available|are not available/i);
      }
    }
    expect(total).toBeGreaterThan(80);
    expect(dead, `buttons that did nothing: ${dead.join(', ')}`).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('3D import and reference images upload, place and render', async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await signUp(page);
    const id = await createProject(page, { name: 'Imports', category: 'CUSTOM', floorPlan: true });
    await openProject(page, id);
    await page.getByTestId('tab-insert').click();

    // 3D import
    const chooser1 = page.waitForEvent('filechooser');
    await page.getByTestId('rb-import3d').click();
    await (await chooser1).setFiles({ name: 'cube.glb', mimeType: 'model/gltf-binary', buffer: makeGlb() });
    await expect.poll(() => page.evaluate(() => (window as any).__nivas.plan.ui.getState().tool)).toBe('model'); // eslint-disable-line @typescript-eslint/no-explicit-any
    const box = (await page.getByTestId('plan-canvas').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const models = await page.evaluate(() => (window as any).__nivas.store.getState().doc.plan.buildings[0].floors[0].order.map((i: string) => (window as any).__nivas.store.getState().doc.plan.buildings[0].floors[0].entities[i]).filter((e: any) => e.kind === 'model')); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(models).toHaveLength(1);
    expect(models[0].url).toMatch(/^\/api\/assets\//);
    expect(models[0].size.w).toBeGreaterThan(100);

    // reference image
    const chooser2 = page.waitForEvent('filechooser');
    await page.getByTestId('rb-addref').click();
    await (await chooser2).setFiles({ name: 'ref.png', mimeType: 'image/png', buffer: makePng() });
    await expect.poll(() => page.evaluate(() => (window as any).__nivas.plan.ui.getState().tool)).toBe('reference'); // eslint-disable-line @typescript-eslint/no-explicit-any
    await page.mouse.click(box.x + box.width / 3, box.y + box.height / 3);
    const refs = await page.evaluate(() => { const f = (window as any).__nivas.store.getState().doc.plan.buildings[0].floors[0]; return f.order.map((i: string) => f.entities[i]).filter((e: any) => e.kind === 'reference'); }); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(refs).toHaveLength(1);
    expect(refs[0].height).toBeCloseTo(refs[0].width / 2, 0); // aspect ratio of the 2x1 image is kept

    // the imported model renders in 3D
    await page.getByTestId('view-3d').click();
    await expect.poll(() => page.evaluate(() => (window as any).__nivas.meshes()), { timeout: 20_000 }).toBeGreaterThan(0); // eslint-disable-line @typescript-eslint/no-explicit-any
    await page.waitForTimeout(1200);
    expect(errors).toEqual([]);
  });
});
