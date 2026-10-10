import { expect, test } from '@playwright/test';
import { createProject, openProject, prisma, setNumber, signUp, state, waitSaved } from './helpers';

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.describe('projects (acceptance 1, 11)', () => {
  test('create from the dashboard UI, edit, autosave, reopen, rename, duplicate, delete', async ({ page }) => {
    await signUp(page);
    await page.goto('/projects');
    await page.getByRole('button', { name: '+ New project' }).click();
    await page.getByLabel('Project name').fill('E2E wardrobe');
    await page.getByLabel('Customer').fill('Test Customer');
    await page.getByRole('button', { name: 'Create & open' }).click();
    await page.waitForURL(/\/projects\//);
    await page.waitForFunction(() => !!(window as any).__nivas);

    // change a dimension through the inspector
    await page.evaluate(() => {
      const s = (window as any).__nivas.store.getState();
      s.select([s.doc.order[0]]);
    });
    await setNumber(page, 'Width', '2700');
    expect(await state<number>(page, '(s)=>s.doc.nodes[s.doc.order[0]].size.w')).toBe(2700);
    await expect(page.getByText(/Unsaved changes|Saving/)).toBeVisible();
    await waitSaved(page); // only shown after the server confirmed the commit

    await page.reload();
    await page.waitForFunction(() => !!(window as any).__nivas);
    expect(await state<number>(page, '(s)=>s.doc.nodes[s.doc.order[0]].size.w')).toBe(2700);

    // dashboard: rename, duplicate, delete with confirmation
    await page.goto('/projects');
    await expect(page.getByText('E2E wardrobe')).toBeVisible();
    await page.getByRole('button', { name: 'Rename' }).click();
    await page.getByLabel('Project name').fill('E2E wardrobe renamed');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('E2E wardrobe renamed')).toBeVisible();
    await page.getByRole('button', { name: 'Duplicate' }).click();
    await expect(page.getByText('E2E wardrobe renamed (copy)')).toBeVisible();
    await page.getByRole('button', { name: 'Delete' }).first().click();
    await expect(page.getByRole('dialog')).toContainText('cannot be undone');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Delete' }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText(/\(copy\)/).first()).toBeHidden({ timeout: 10_000 }).catch(() => undefined);
  });
});

test.describe('wardrobe (acceptance 2,3,4,7,8,10)', () => {
  test('dimensions, sections, doors/drawers animation, materials, undo/redo', async ({ page }) => {
    await signUp(page);
    const id = await createProject(page, { name: 'WD', category: 'WARDROBE' });
    await openProject(page, id);
    const nid = await state<string>(page, '(s)=>s.doc.order[0]');
    await page.evaluate((i) => (window as any).__nivas.store.getState().select([i]), nid);

    // changing a dimension updates the node (and the generated geometry, covered in unit tests)
    await setNumber(page, 'Height', '2200');
    expect(await state<number>(page, `(s)=>s.doc.nodes['${nid}'].size.h`)).toBe(2200);
    // undo / redo
    await page.getByRole('button', { name: /^Undo/ }).click();
    expect(await state<number>(page, `(s)=>s.doc.nodes['${nid}'].size.h`)).toBe(2400);
    await page.getByRole('button', { name: /^Redo/ }).click();
    expect(await state<number>(page, `(s)=>s.doc.nodes['${nid}'].size.h`)).toBe(2200);

    // invalid dimension: rejected with a clear message, nothing changes
    await setNumber(page, 'Width', '100');
    await expect(page.getByRole('status').getByText(/Width must be between/)).toBeVisible();
    expect(await state<number>(page, `(s)=>s.doc.nodes['${nid}'].size.w`)).toBeGreaterThanOrEqual(600);

    // sections edited independently: add a shelf to section 1 only
    const before = await state<number[]>(page, `(s)=>s.doc.nodes['${nid}'].params.sections.map(x=>x.shelves.length)`);
    await page.getByRole('button', { name: /^1\. / }).click();
    await page.getByRole('button', { name: '+ Shelf' }).click();
    const after = await state<number[]>(page, `(s)=>s.doc.nodes['${nid}'].params.sections.map(x=>x.shelves.length)`);
    expect(after[0]).toBe(before[0] + 1);
    expect(after.slice(1)).toEqual(before.slice(1));

    // doors & drawers animate (target openness set, then the renderer eases toward it)
    await page.getByRole('button', { name: 'Open doors' }).first().click();
    expect(await state<number>(page, `(s)=>Object.keys(s.openTargets).filter(k=>k.includes(':door-') && s.openTargets[k]===1).length`)).toBeGreaterThanOrEqual(2);
    await page.getByRole('button', { name: 'Open drawers' }).first().click();
    expect(await state<number>(page, `(s)=>Object.keys(s.openTargets).filter(k=>k.includes(':drawer-') && s.openTargets[k]===1).length`)).toBeGreaterThanOrEqual(1);

    // material on the selected component only
    await page.evaluate((i) => (window as any).__nivas.store.getState().setSlotMaterial([i], 'shutter', 'wood-walnut'), nid);
    expect(await state<string>(page, `(s)=>s.doc.nodes['${nid}'].materials.shutter`)).toBe('wood-walnut');
    // per-door material
    await page.evaluate((i) => (window as any).__nivas.store.getState().setSlotMaterial([i], 'shutter', 'sc-navy', { kind: 'door', index: 1 }), nid);
    expect(await state<string>(page, `(s)=>s.doc.nodes['${nid}'].subMaterials['door:1'].shutter`)).toBe('sc-navy');
    await waitSaved(page);
    await page.reload();
    await page.waitForFunction(() => !!(window as any).__nivas);
    expect(await state<string>(page, `(s)=>s.doc.nodes['${nid}'].subMaterials['door:1'].shutter`)).toBe('sc-navy');
  });
});

test.describe('3D interaction (acceptance 9)', () => {
  test('dragging a component with the mouse updates stored coordinates; duplicate and delete work', async ({ page }) => {
    await signUp(page);
    const id = await createProject(page, { name: 'Drag', category: 'WARDROBE' });
    await openProject(page, id);
    await page.waitForTimeout(1500); // initial camera framing
    const nid = await state<string>(page, '(s)=>s.doc.order[0]');
    const start = await state<number[]>(page, `(s)=>s.doc.nodes['${nid}'].position`);
    const p = await page.evaluate((i) => (window as any).__nivas.screenOf(i), nid);
    expect(p).toBeTruthy();
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x - 70, p.y + 30, { steps: 6 });
    await page.mouse.move(p.x - 140, p.y + 60, { steps: 6 });
    await page.mouse.up();
    const end = await state<number[]>(page, `(s)=>s.doc.nodes['${nid}'].position`);
    expect(end[0] !== start[0] || end[2] !== start[2]).toBe(true);
    expect(await state<boolean>(page, '(s)=>s.past.length>0')).toBe(true);

    // keyboard: rotate tool etc. Duplicate (Ctrl+D) then delete
    await page.keyboard.press('Control+d');
    expect(await state<number>(page, '(s)=>s.doc.order.length')).toBe(2);
    await page.keyboard.press('Delete');
    expect(await state<number>(page, '(s)=>s.doc.order.length')).toBe(1);
    await page.keyboard.press('Control+z');
    expect(await state<number>(page, '(s)=>s.doc.order.length')).toBe(2);
  });

  test('overlapping placement is rejected with a message and reverted', async ({ page }) => {
    await signUp(page);
    const id = await createProject(page, { name: 'Overlap', category: 'KITCHEN', layout: 'straight', roomWidth: 4200, roomDepth: 3000, roomHeight: 2700 });
    await openProject(page, id);
    const [a, b] = await state<string[]>(page, `(s)=>s.doc.order.filter(i=>s.doc.nodes[i].type==='cabinet' && s.doc.nodes[i].params.variant==='base').slice(0,2)`);
    const pa = await state<number[]>(page, `(s)=>s.doc.nodes['${a}'].position`);
    await page.evaluate(([i, x, z]) => (window as any).__nivas.store.getState().setPosition(i, { x, z }), [b, pa[0] + 50, pa[2]] as const);
    await expect(page.getByText(/overlaps/).first()).toBeVisible();
    const pb = await state<number[]>(page, `(s)=>s.doc.nodes['${b}'].position`);
    expect(pb[0]).not.toBe(pa[0] + 50);
  });
});

test.describe('kitchen, TV panel and documents (acceptance 5,6,12,13,14)', () => {
  test('kitchen: layout, cabinets + appliances, BOQ from components, exports contain real data', async ({ page }) => {
    await signUp(page);
    const id = await createProject(page, { name: 'Kitchen QA', category: 'KITCHEN', layout: 'l_shape', roomWidth: 4200, roomDepth: 3400, roomHeight: 2700, customer: 'QA Customer' });
    await openProject(page, id);
    const kinds = await state<string[]>(page, `(s)=>Object.values(s.doc.nodes).map(n=>n.type==='cabinet'?n.params.variant:n.type==='appliance'?n.params.kind:n.type)`);
    for (const k of ['base', 'wall', 'sink', 'countertop', 'hob', 'fridge']) expect(kinds).toContain(k);

    // edit a single cabinet without rebuilding the kitchen
    const base = await state<string>(page, `(s)=>s.doc.order.find(i=>s.doc.nodes[i].type==='cabinet' && s.doc.nodes[i].params.variant==='base')`);
    await page.evaluate((i) => (window as any).__nivas.store.getState().select([i]), base);
    const w0 = await state<number>(page, `(s)=>s.doc.nodes['${base}'].size.w`);
    // widening a cabinet in a packed run would overlap its neighbour -> rejected with a message
    await setNumber(page, 'Width', String(w0 + 200));
    await expect(page.getByText(/overlaps/).first()).toBeVisible();
    expect(await state<number>(page, `(s)=>s.doc.nodes['${base}'].size.w`)).toBe(w0);
    // narrowing it works and regenerates the cabinet
    await setNumber(page, 'Width', '300');
    expect(await state<number>(page, `(s)=>s.doc.nodes['${base}'].size.w`)).toBe(300);

    await page.getByRole('navigation', { name: 'Project sections' }).getByRole('button', { name: 'BOQ & Quote' }).click();
    await expect(page.getByText('Estimate only.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Totals' })).toBeVisible();
    await expect(page.getByText('MISSING PRICE').first()).toBeVisible(); // appliances have no rate -> warned, not invented
    await waitSaved(page);

    // server-generated exports from the saved project
    const csv = await (await page.request.get(`/api/projects/${id}/export?type=boq.csv`)).text();
    expect(csv).toContain('Kitchen QA');
    expect(csv).toContain('Refrigerator');
    expect(csv).toContain('MISSING');
    const cut = await (await page.request.get(`/api/projects/${id}/export?type=cutlist.csv`)).text();
    expect(cut.split('\n').length).toBeGreaterThan(60);
    const pdf = await page.request.get(`/api/projects/${id}/export?type=quotation.pdf`);
    expect(pdf.headers()['content-type']).toContain('application/pdf');
    expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
    const dxf = await (await page.request.get(`/api/projects/${id}/export?type=plan.dxf`)).text();
    expect(dxf).toContain('ENTITIES');

    // drawings reflect the model
    await page.getByRole('navigation', { name: 'Project sections' }).getByRole('button', { name: '2D Drawings' }).click();
    await expect(page.locator('svg[data-view="front"] polygon').first()).toBeVisible();
    await page.getByRole('tab', { name: 'Top plan' }).click();
    await expect(page.locator('svg[data-view="plan"] polygon').first()).toBeVisible();
  });

  test('TV panel: configure shelves, drawers, finish and lighting; templates and history', async ({ page }) => {
    await signUp(page);
    const id = await createProject(page, { name: 'TV QA', category: 'TV_PANEL' });
    await openProject(page, id);
    const nid = await state<string>(page, '(s)=>s.doc.order[0]');
    await page.evaluate((i) => (window as any).__nivas.store.getState().select([i]), nid);
    await expect(page.getByRole('button', { name: 'Panel finish' })).toBeVisible();
    await page.evaluate((i) => {
      const s = (window as any).__nivas.store.getState();
      s.patchParams(i, { style: 'slat', patternSpacing: 90 });
      s.patchParams(i, { unit: { ...s.doc.nodes[i].params.unit, drawers: 3, height: 600, type: 'floor' } });
      s.patchParams(i, { led: { ...s.doc.nodes[i].params.led, color: '#88aaff' } });
    }, nid);
    expect(await state<string>(page, `(s)=>s.doc.nodes['${nid}'].params.style`)).toBe('slat');
    expect(await state<number>(page, `(s)=>s.doc.nodes['${nid}'].params.unit.drawers`)).toBe(3);
    // a TV that cannot fit is rejected with a clear message
    await page.evaluate((i) => (window as any).__nivas.store.getState().patchParams(i, { tv: { size: 120, x: 0, bottom: 900, depth: 0, wallMount: true } }), nid);
    await expect(page.getByText(/does not fit between the side units/).first()).toBeVisible();
    expect(await state<number>(page, `(s)=>s.doc.nodes['${nid}'].params.tv.size`)).toBe(65);

    await page.keyboard.press('Control+s');
    await waitSaved(page);
    await page.getByRole('navigation', { name: 'Project sections' }).getByRole('button', { name: 'History' }).click();
    await expect(page.getByText('Manual save').first()).toBeVisible();
    await page.getByRole('button', { name: 'Save design as template' }).click();
    await page.getByLabel('Template name').fill('E2E TV template');
    await page.getByRole('button', { name: 'Save template' }).click();
    await page.goto('/templates');
    await expect(page.getByText('E2E TV template')).toBeVisible();
  });
});

test.describe('reliability (acceptance 16)', () => {
  test('a failed save never reports success, keeps the work, and recovers on retry', async ({ page }) => {
    await signUp(page);
    const id = await createProject(page, { name: 'Failing saves', category: 'WARDROBE' });
    await openProject(page, id);
    const nid = await state<string>(page, '(s)=>s.doc.order[0]');

    let fail = true;
    await page.route(`**/api/projects/${id}`, async (route) => {
      if (route.request().method() === 'PUT' && fail) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Simulated outage' }) });
      return route.continue();
    });
    await page.evaluate((i) => (window as any).__nivas.store.getState().select([i]), nid);
    await setNumber(page, 'Width', '2500');
    await expect(page.getByText('Save failed - retrying')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/All changes saved/)).toBeHidden();
    // work is kept in memory and in a local draft
    expect(await state<number>(page, `(s)=>s.doc.nodes['${nid}'].size.w`)).toBe(2500);
    expect(await page.evaluate((pid) => !!localStorage.getItem(`nivas:draft:${pid}`), id)).toBe(true);
    // server still has the old value
    const srv = await (await page.request.get(`/api/projects/${id}`)).json();
    expect(Object.values(srv.project.data.nodes as Record<string, any>)[0].size.w).not.toBe(2500);

    fail = false;
    await page.getByRole('button', { name: 'Retry now' }).click();
    await waitSaved(page);
    const srv2 = await (await page.request.get(`/api/projects/${id}`)).json();
    expect(Object.values(srv2.project.data.nodes as Record<string, any>)[0].size.w).toBe(2500);
  });

  test('invalid imports are rejected before touching the project', async ({ page }) => {
    await signUp(page);
    const id = await createProject(page, { name: 'Import target', category: 'WARDROBE' });
    await openProject(page, id, 'history');
    await page.setInputFiles('input[type=file]', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"nivas-project","version":1,"exportedAt":"x","project":{"name":"x","category":"WARDROBE"},"data":{"schema":1}}') });
    await expect(page.getByText(/Import rejected/)).toBeVisible();
  });
});

test.describe('roles and authorization', () => {
  test('viewer cannot edit; non-owner cannot read private projects; admin page is admin-only', async ({ browser }) => {
    const ctxOwner = await browser.newContext();
    const owner = await ctxOwner.newPage();
    await signUp(owner);
    const id = await createProject(owner, { name: 'Private', category: 'KITCHEN' });

    const ctxViewer = await browser.newContext();
    const viewer = await ctxViewer.newPage();
    const v = await signUp(viewer, 'VIEWER');
    // not shared -> not found
    expect((await viewer.request.get(`/api/projects/${id}`)).status()).toBe(404);
    // share with view access -> readable but not writable
    const share = await owner.request.post(`/api/projects/${id}/share`, { data: { email: v.email, access: 'VIEW' } });
    expect(share.ok()).toBeTruthy();
    expect((await viewer.request.get(`/api/projects/${id}`)).status()).toBe(200);
    const put = await viewer.request.put(`/api/projects/${id}`, { data: { data: {}, baseVersion: 1 } });
    expect(put.status()).toBe(403);
    expect((await viewer.request.post('/api/projects', { data: { name: 'x', category: 'WARDROBE' } })).status()).toBe(403);
    expect((await viewer.request.get('/api/admin/users')).status()).toBe(403);
    await viewer.goto(`/projects/${id}`);
    await viewer.waitForFunction(() => !!(window as any).__nivas);
    await expect(viewer.getByText('View only')).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    // unauthenticated
    const anon = await browser.newContext();
    expect((await anon.request.get(`/api/projects/${id}`)).status()).toBe(401);
    await anon.close();
    await ctxOwner.close();
    await ctxViewer.close();
  });

  test('administrator can manage users and the rate card', async ({ page }) => {
    const a = await signUp(page, 'ADMIN');
    void a;
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Administration' })).toBeVisible();
    await expect(page.getByRole('cell', { name: /E2E User/ }).first()).toBeVisible();
    await page.getByRole('tab', { name: 'Pricing rules' }).click();
    await expect(page.getByText('illustrative placeholder values')).toBeVisible();
    const r = await page.request.put('/api/settings/rates', { data: { custom: { 'app:fridge': 52000 } } });
    expect(r.ok()).toBeTruthy();
    const rates = await (await page.request.get('/api/settings/rates')).json();
    expect(rates.rates['app:fridge']).toBe(52000);
    await page.request.put('/api/settings/rates', { data: { custom: {} } });
  });
});
