'use client';
import { api } from '@/components/ui';
import { viewportApi } from '@/components/editor/Viewport';
import { canvasRef } from '@/components/plan/PlanCanvas';
import { alignEntities, autoDimensions, autoRoomLabels, healWalls, isolate, removeDuplicateWalls, setHidden, setLocked, unisolate, type AlignMode } from '@/lib/plan/actions';
import { floorToDxf } from '@/lib/plan/exportDxf';
import { activeFloor, findFloor, updateFloor } from '@/lib/plan/model';
import { expandSelection } from '@/lib/plan/ops';
import { newId } from '@/lib/plan/walls';
import type { DesignMode, Floor, GalleryItem, PlanModel, Viewpoint } from '@/lib/plan/types';
import type { ToolId } from '@/lib/plan/toolHost';
import { thumbnailOverride, saveNow } from './save';
import { useEditor } from './editor';
import { activateTool, planEngine, planHost, setPlan } from './planHost';
import { usePlanUi } from './planUi';

const ui = () => usePlanUi.getState();
const ed = () => useEditor.getState();
const plan = (): PlanModel => ed().doc.plan!;
const say = (t: string, l: 'info' | 'warn' | 'error' = 'info') => ui().say(t, l);

/** Applies a change to the active floor as ONE undo step; `fn` may return an error string instead. */
export function editFloor(fn: (f: Floor) => Floor | { error: string }, label = 'Edit', select?: string[]): boolean {
  if (planHost.locked()) {
    say(ed().access === 'VIEW' ? 'You only have view access to this project.' : 'The design is locked. Unlock it in View → Lock design.', 'warn');
    return false;
  }
  const r = fn(planHost.floor());
  if ('error' in r) {
    say(r.error, 'warn');
    return false;
  }
  planHost.commit(label, r, select);
  return true;
}

function entitySelection(): string[] {
  const f = planHost.floor();
  return planHost.selection().filter((i) => f.entities[i]);
}
function nodeSelection(): string[] {
  const d = ed().doc;
  return planHost.selection().filter((i) => d.nodes[i]);
}

// ---------------- edit commands ----------------
export const undo = () => ed().undo();
export const redo = () => ed().redo();

export function groupSelection() {
  const ids = entitySelection();
  if (ids.length < 2) return say('Select two or more objects to group.', 'warn');
  const g = newId('grp');
  editFloor((f) => ({ ...f, entities: { ...f.entities, ...Object.fromEntries(ids.map((i) => [i, { ...f.entities[i], group: g }])) } }), 'Group');
  say(`${ids.length} objects grouped.`);
}
export function ungroupSelection() {
  const f = planHost.floor();
  const ids = expandSelection(f, entitySelection()).filter((i) => f.entities[i].group);
  if (!ids.length) return say('The selection contains no groups.', 'warn');
  editFloor((fl) => ({ ...fl, entities: { ...fl.entities, ...Object.fromEntries(ids.map((i) => [i, { ...fl.entities[i], group: undefined }])) } }), 'Ungroup');
  say('Ungrouped.');
}

export function lockSelection(lock: boolean) {
  const ids = entitySelection();
  const nodes = nodeSelection();
  if (!ids.length && !nodes.length) return say('Select an object first.', 'warn');
  planHost.batch('Lock', () => {
    if (ids.length) planHost.commit('Lock', setLocked(planHost.floor(), expandSelection(planHost.floor(), ids), lock));
    for (const n of nodes) if (!!ed().doc.nodes[n]?.locked !== lock) ed().toggleLock([n]);
  });
  say(lock ? 'Locked. Locked objects cannot be selected or edited.' : 'Unlocked.');
  if (lock) planHost.setSelection([]);
}

export function hideSelection() {
  const ids = entitySelection();
  const nodes = nodeSelection();
  if (!ids.length && !nodes.length) return say('Select an object first.', 'warn');
  planHost.batch('Hide', () => {
    if (ids.length) planHost.commit('Hide', setHidden(planHost.floor(), expandSelection(planHost.floor(), ids), true));
    for (const n of nodes) if (ed().doc.nodes[n]?.visible) ed().toggleVisible([n]);
  });
  planHost.setSelection([]);
  say('Hidden. Use View → Unhide all to bring them back.');
}

export function isolateSelection() {
  const ids = expandSelection(planHost.floor(), entitySelection());
  if (!ids.length) return say('Select the objects to isolate first.', 'warn');
  editFloor((f) => isolate(f, ids), 'Isolate');
  say(`Isolated ${ids.length} object${ids.length === 1 ? '' : 's'}. Use Unhide / Show all to restore.`);
}

export function showAll() {
  planHost.batch('Show all', () => {
    for (const f of plan().buildings.flatMap((b) => b.floors)) {
      if (f.isolated || Object.values(f.entities).some((e) => e.hidden)) setPlan((p) => updateFloor(p, f.id, unisolate), 'show-all');
    }
    for (const n of Object.values(ed().doc.nodes)) if (!n.visible) ed().toggleVisible([n.id]);
  });
  say('All objects are visible.');
}

export function alignSelection(mode: AlignMode | 'distribute-x' | 'distribute-y') {
  const ids = entitySelection();
  if (editFloor((f) => { const r = alignEntities(f, ids, mode); return r.ok ? r.value : { error: r.error }; }, 'Align')) say('Aligned.');
}

export function moveBy(dx: number, dy: number) {
  planEngine.nudge(dx, dy);
}

export function zoom(kind: 'fit' | 'selection' | 'in' | 'out' | 'room') {
  if (ui().viewMode === '3d') {
    ed().requestView(kind === 'selection' ? 'fit-selection' : 'fit-scene');
    return;
  }
  ui().requestZoom(kind);
}

export function setMode(mode: DesignMode) {
  setPlan((p) => ({ ...p, mode }), 'design-mode');
  planHost.setSelection([]);
  say(
    mode === 'architecture' ? 'Architecture mode: walls, openings and structure are editable.' : mode === 'interior' ? 'Interior mode: architecture is locked; furniture and fittings are editable.' : 'Production mode: only imported/production objects are selectable.',
  );
}

// ---------------- automatic tools ----------------
export function runAuto(kind: 'dimensions' | 'labels' | 'heal' | 'dupes') {
  const p = plan();
  const ok = editFloor((f) => {
    if (kind === 'dimensions') { const r = autoDimensions(f); if (r.ok) say(`${r.value.added} dimensions added.`); return r.ok ? r.value.floor : { error: r.error }; }
    if (kind === 'labels') { const r = autoRoomLabels(f, p); if (r.ok) say(`${r.value.added} room labels added.`); return r.ok ? r.value.floor : { error: r.error }; }
    if (kind === 'heal') { const r = healWalls(f); if (r.ok) say(`${r.value.merged} wall ends joined.`); return r.ok ? r.value.floor : { error: r.error }; }
    const r = removeDuplicateWalls(f);
    if (r.ok) say(`${r.value.removed} duplicate walls removed.`);
    return r.ok ? r.value.floor : { error: r.error };
  }, 'Automatic tool');
  return ok;
}

// ---------------- files ----------------
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    document.body.appendChild(input);
    input.click();
    setTimeout(() => input.remove(), 60_000);
  });
}

async function upload(file: File | Blob, name: string): Promise<{ url: string; name: string }> {
  const fd = new FormData();
  fd.append('file', file instanceof File ? file : new File([file], name, { type: file.type }));
  const r = await api<{ asset: { url: string; name: string } }>('/api/assets', { method: 'POST', body: fd });
  return r.asset;
}

export async function importModel() {
  const f = await pickFile('.glb,model/gltf-binary');
  if (!f) return;
  try {
    const { inspectGlb } = await import('@/lib/three/glb');
    const info = await inspectGlb(f);
    const a = await upload(f, f.name);
    ui().setPayload({ url: a.url, fileName: f.name, size: { w: info.size.w, d: info.size.d, h: info.size.h } });
    activateTool('model');
    say(`${f.name} imported (${info.triangles.toLocaleString()} triangles). Click in the plan to place it.`);
  } catch (e) {
    say(`Import failed: ${(e as Error).message}`, 'error');
  }
}

export async function addReference() {
  const f = await pickFile('image/png,image/jpeg,image/webp');
  if (!f) return;
  try {
    const bmp = await createImageBitmap(f);
    const aspect = bmp.width / bmp.height;
    bmp.close();
    const a = await upload(f, f.name);
    ui().setPayload({ url: a.url, fileName: f.name, aspect });
    activateTool('reference');
    say('Reference image uploaded. Click where its centre should go; set its Width in the options on the left.');
  } catch (e) {
    say(`Could not add the reference: ${(e as Error).message}`, 'error');
  }
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const baseName = () => (ed().meta?.name ?? 'plan').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 40);

function canvasBlob(c: HTMLCanvasElement, type = 'image/png', q?: number): Promise<Blob | null> {
  return new Promise((res) => c.toBlob(res, type, q));
}

/** Captures what is on screen: the 2D plan canvas or the 3D viewport. */
export async function captureView(): Promise<{ blob: Blob; w: number; h: number; kind: '2d' | '3d' } | null> {
  const mode = ui().viewMode;
  if (mode === '3d' && viewportApi.gl && viewportApi.scene && viewportApi.camera) {
    viewportApi.gl.render(viewportApi.scene, viewportApi.camera);
    const c = viewportApi.gl.domElement;
    const blob = await canvasBlob(c);
    return blob ? { blob, w: c.width, h: c.height, kind: '3d' } : null;
  }
  const c = canvasRef.current;
  if (!c) return null;
  const blob = await canvasBlob(c);
  return blob ? { blob, w: c.width, h: c.height, kind: '2d' } : null;
}

export async function screenshot(toGallery = true) {
  const shot = await captureView();
  if (!shot) return say('Nothing to capture — open the Floorplan or 3D view first.', 'warn');
  const name = `${baseName()}-${shot.kind}-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}.png`;
  download(shot.blob, name);
  if (toGallery && ed().access !== 'VIEW') {
    try {
      const a = await upload(shot.blob, name);
      const item: GalleryItem = { id: newId('shot'), name, url: a.url, createdAt: new Date().toISOString(), width: shot.w, height: shot.h, kind: 'screenshot' };
      setPlan((p) => ({ ...p, gallery: [item, ...p.gallery] }), 'gallery');
      say('Screenshot saved to the gallery and downloaded.');
    } catch (e) {
      say(`Downloaded, but it could not be added to the gallery: ${(e as Error).message}`, 'warn');
    }
  } else say('Screenshot downloaded.');
}

export async function addToGallery(blob: Blob, name: string, w: number, h: number, kind: GalleryItem['kind']) {
  const a = await upload(blob, name);
  setPlan((p) => ({ ...p, gallery: [{ id: newId('shot'), name, url: a.url, createdAt: new Date().toISOString(), width: w, height: h, kind }, ...p.gallery] }), 'gallery');
}

export async function setThumbnail() {
  const shot = await captureView();
  if (!shot) return say('Nothing to capture — open the Floorplan or 3D view first.', 'warn');
  const bmp = await createImageBitmap(shot.blob);
  const c = document.createElement('canvas');
  c.width = 480;
  c.height = 300;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, c.width, c.height);
  const k = Math.min(c.width / bmp.width, c.height / bmp.height);
  g.drawImage(bmp, (c.width - bmp.width * k) / 2, (c.height - bmp.height * k) / 2, bmp.width * k, bmp.height * k);
  bmp.close();
  thumbnailOverride.current = c.toDataURL('image/jpeg', 0.75);
  await saveNow({ manual: true, label: 'Thumbnail updated' });
  say('Project thumbnail updated.');
}

export async function exportPlan(kind: 'png' | 'pdf' | 'dxf' | 'json') {
  const p = plan();
  const f = activeFloor(p);
  if (kind === 'dxf') {
    download(new Blob([floorToDxf(f, p)], { type: 'application/dxf' }), `${baseName()}-${f.name.replace(/\W+/g, '_')}.dxf`);
    return say('DXF exported (millimetres, one layer per object type).');
  }
  if (kind === 'json') {
    download(new Blob([JSON.stringify(ed().doc, null, 2)], { type: 'application/json' }), `${baseName()}.nivas.json`);
    return say('Project exported as JSON (includes the whole floor plan).');
  }
  const shot = await captureView();
  if (!shot) return say('Open the Floorplan or 3D view first.', 'warn');
  if (kind === 'png') {
    download(shot.blob, `${baseName()}-${shot.kind}.png`);
    return say('Image exported.');
  }
  const { jsPDF } = await import('jspdf');
  const bmp = await createImageBitmap(shot.blob);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0);
  bmp.close();
  const land = c.width >= c.height;
  const pdf = new jsPDF({ orientation: land ? 'landscape' : 'portrait', unit: 'mm', format: 'a3' });
  const W = pdf.internal.pageSize.getWidth() - 20;
  const H = pdf.internal.pageSize.getHeight() - 30;
  const k = Math.min(W / c.width, H / c.height);
  pdf.setFontSize(12);
  pdf.text(`${ed().meta?.name ?? 'Plan'} - ${f.name}`, 10, 10);
  pdf.addImage(c.toDataURL('image/jpeg', 0.9), 'JPEG', 10, 16, c.width * k, c.height * k);
  pdf.setFontSize(8);
  pdf.text(`Printed ${new Date().toLocaleString()}  |  Units: mm`, 10, pdf.internal.pageSize.getHeight() - 6);
  download(pdf.output('blob'), `${baseName()}-${shot.kind}.pdf`);
  say('PDF exported.');
}

// ---------------- saved views ----------------
export function saveView(name?: string) {
  const p = plan();
  const f = activeFloor(p);
  const n = name?.trim() || `View ${p.viewpoints.length + 1}`;
  const mode = ui().viewMode === '3d' ? '3d' : '2d';
  const vp: Viewpoint = { id: newId('view'), name: n, floorId: f.id, kind: mode };
  if (mode === '2d') {
    const v = ui().views[f.id];
    if (!v) return say('Open the Floorplan view first.', 'warn');
    vp.view2d = { cx: v.cx, cy: v.cy, scale: v.scale };
  } else {
    const pose = viewportApi.getPose?.();
    if (!pose) return say('The 3D view is not ready yet.', 'warn');
    vp.view3d = pose;
  }
  setPlan((pl) => ({ ...pl, viewpoints: [...pl.viewpoints, vp] }), 'views');
  say(`Saved “${n}”.`);
}

export function applyView(id: string) {
  const p = plan();
  const vp = p.viewpoints.find((v) => v.id === id);
  if (!vp) return;
  if (findFloor(p, vp.floorId)) switchFloor(vp.floorId);
  if (vp.kind === '2d' && vp.view2d) {
    if (ui().viewMode === '3d') ui().setViewMode('2d');
    ui().setView(vp.floorId, vp.view2d);
  } else if (vp.kind === '3d' && vp.view3d) {
    if (ui().viewMode === '2d') ui().setViewMode('3d');
    const pose = vp.view3d;
    const tryApply = (n: number) => {
      if (viewportApi.setPose) viewportApi.setPose(pose.pos, pose.target);
      else if (n > 0) setTimeout(() => tryApply(n - 1), 120);
    };
    setTimeout(() => tryApply(20), 60);
  }
}

export function deleteView(id: string) {
  setPlan((p) => ({ ...p, viewpoints: p.viewpoints.filter((v) => v.id !== id), presentations: p.presentations.map((pr) => ({ ...pr, viewpoints: pr.viewpoints.filter((x) => x !== id) })) }), 'views');
}

export function switchFloor(id: string) {
  const d = ed().doc;
  const p = d.plan;
  if (!p) return;
  const b = p.buildings.find((x) => x.floors.some((f) => f.id === id));
  if (!b) return;
  ed().softSet({ ...d, plan: { ...p, activeBuildingId: b.id, activeFloorId: id } });
  planHost.setSelection([]);
}

export function chooseTool(tool: ToolId, tab?: Parameters<ReturnType<typeof usePlanUi.getState>['setTab']>[0]) {
  if (tab) ui().setTab(tab);
  activateTool(tool);
}
