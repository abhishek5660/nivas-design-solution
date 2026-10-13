import { entityBounds, translateEntity } from './entities';
import { addEntities, activeBuilding, activeFloor, allFloors, makeFloor, makePlan, removeEntities, updateFloor } from './model';
import { dist, dot, mid, polygonArea, round, same, sub, type Box } from './geom';
import { insetPolygon, roomsOf } from './rooms';
import { floorEntities, floorWalls, isOpening, nearestWall, newId, normalizeWalls, placeOpening, wallDir, wallLen } from './walls';
import type { Branch, Building, DimensionE, Entity, Floor, PlanModel, Pt, TextE, WallE } from './types';
import type { Room as LegacyRoom, SceneDoc, SceneNode } from '../types';

export type R<T = PlanModel> = { ok: true; value: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

// ---------------- buildings & floors ----------------

export function addBuilding(p: PlanModel, name?: string): PlanModel {
  const f = makeFloor('Ground Floor', 0);
  const b: Building = { id: newId('bld'), name: name?.trim() || `Building ${p.buildings.length + 1}`, floors: [f] };
  return { ...p, buildings: [...p.buildings, b], activeBuildingId: b.id, activeFloorId: f.id };
}

export function renameBuilding(p: PlanModel, id: string, name: string): R {
  if (!name.trim()) return fail('The name cannot be empty.');
  return { ok: true, value: { ...p, buildings: p.buildings.map((b) => (b.id === id ? { ...b, name: name.trim() } : b)) } };
}

export function deleteBuilding(p: PlanModel, id: string): R<{ plan: PlanModel; removedFloorIds: string[] }> {
  if (p.buildings.length <= 1) return fail('A project needs at least one building.');
  const b = p.buildings.find((x) => x.id === id);
  if (!b) return fail('Building not found.');
  const rest = p.buildings.filter((x) => x.id !== id);
  const active = p.activeBuildingId === id ? rest[0] : rest.find((x) => x.id === p.activeBuildingId)!;
  return { ok: true, value: { plan: { ...p, buildings: rest, activeBuildingId: active.id, activeFloorId: p.activeBuildingId === id ? active.floors[0].id : p.activeFloorId }, removedFloorIds: b.floors.map((f) => f.id) } };
}

export function selectBuilding(p: PlanModel, id: string): PlanModel {
  const b = p.buildings.find((x) => x.id === id);
  return b ? { ...p, activeBuildingId: id, activeFloorId: b.floors.find((f) => f.id === p.activeFloorId)?.id ?? b.floors[0].id } : p;
}

export function selectFloor(p: PlanModel, id: string): PlanModel {
  const b = p.buildings.find((x) => x.floors.some((f) => f.id === id));
  return b ? { ...p, activeBuildingId: b.id, activeFloorId: id } : p;
}

const ORDINAL = ['Ground Floor', 'First Floor', 'Second Floor', 'Third Floor', 'Fourth Floor', 'Fifth Floor'];

/** Adds a storey above (or below) the existing ones. The new floor is a real entity with its own elevation. */
export function addFloor(p: PlanModel, where: 'above' | 'below', name?: string): PlanModel {
  const b = activeBuilding(p);
  const floors = b.floors;
  const top = floors.reduce((a, f) => (f.elevation + f.height > a.elevation + a.height ? f : a), floors[0]);
  const bottom = floors.reduce((a, f) => (f.elevation < a.elevation ? f : a), floors[0]);
  const nf =
    where === 'above'
      ? makeFloor(name?.trim() || ORDINAL[floors.length] || `Floor ${floors.length}`, top.elevation + top.height, top.height)
      : makeFloor(name?.trim() || `Basement ${floors.filter((f) => f.elevation < 0).length + 1}`, bottom.elevation - bottom.height, bottom.height);
  return { ...p, buildings: p.buildings.map((x) => (x.id === b.id ? { ...x, floors: [...x.floors, nf].sort((a, c) => a.elevation - c.elevation) } : x)), activeFloorId: nf.id };
}

export function renameFloor(p: PlanModel, id: string, name: string): R {
  if (!name.trim()) return fail('The name cannot be empty.');
  return { ok: true, value: updateFloor(p, id, (f) => ({ ...f, name: name.trim() })) };
}

/** Changing elevation moves the furniture standing on the floor with it. Returns the vertical shift for nodes. */
export function setFloorLevels(p: PlanModel, id: string, elevation: number, height: number): R<{ plan: PlanModel; shift: number }> {
  if (!Number.isFinite(elevation) || !(height >= 1500 && height <= 12000)) return fail('Storey height must be between 1500 and 12000 mm.');
  const f = allFloors(p).find((x) => x.id === id);
  if (!f) return fail('Floor not found.');
  return { ok: true, value: { plan: updateFloor(p, id, (x) => ({ ...x, elevation, height })), shift: elevation - f.elevation } };
}

export function deleteFloor(p: PlanModel, id: string): R {
  const b = p.buildings.find((x) => x.floors.some((f) => f.id === id));
  if (!b) return fail('Floor not found.');
  if (b.floors.length <= 1) return fail('A building needs at least one floor.');
  const rest = b.floors.filter((f) => f.id !== id);
  return { ok: true, value: { ...p, buildings: p.buildings.map((x) => (x.id === b.id ? { ...x, floors: rest } : x)), activeFloorId: p.activeFloorId === id ? rest[0].id : p.activeFloorId } };
}

/** Copies every object of one floor onto a new floor above it (new ids, doors stay attached to the copied walls). */
export function duplicateFloor(p: PlanModel, id: string): R {
  const src = allFloors(p).find((f) => f.id === id);
  if (!src) return fail('Floor not found.');
  const added = addFloor(p, 'above', `${src.name} copy`);
  const nf = activeFloor(added);
  const idMap = new Map<string, string>();
  for (const e of floorEntities(src)) idMap.set(e.id, newId(e.kind));
  const copies = floorEntities(src).map((e) => {
    const c = structuredClone(e) as Entity;
    c.id = idMap.get(e.id)!;
    if (isOpening(c)) c.wall = idMap.get(c.wall) ?? c.wall;
    if (c.kind === 'radial') c.target = idMap.get(c.target) ?? c.target;
    return c;
  });
  return { ok: true, value: updateFloor(added, nf.id, (f) => addEntities({ ...f, height: src.height }, copies)) };
}

// ---------------- selection-level actions ----------------

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

export function alignBoxes(boxes: { id: string; box: Box }[], mode: AlignMode): Map<string, Pt> {
  const out = new Map<string, Pt>();
  if (boxes.length < 2) return out;
  const minX = Math.min(...boxes.map((b) => b.box.minX));
  const maxX = Math.max(...boxes.map((b) => b.box.maxX));
  const minY = Math.min(...boxes.map((b) => b.box.minY));
  const maxY = Math.max(...boxes.map((b) => b.box.maxY));
  for (const { id, box } of boxes) {
    let dx = 0;
    let dy = 0;
    if (mode === 'left') dx = minX - box.minX;
    if (mode === 'right') dx = maxX - box.maxX;
    if (mode === 'center') dx = (minX + maxX) / 2 - (box.minX + box.maxX) / 2;
    if (mode === 'top') dy = minY - box.minY;
    if (mode === 'bottom') dy = maxY - box.maxY;
    if (mode === 'middle') dy = (minY + maxY) / 2 - (box.minY + box.maxY) / 2;
    out.set(id, [round(dx), round(dy)]);
  }
  return out;
}

export function distributeBoxes(boxes: { id: string; box: Box }[], axis: 'x' | 'y'): Map<string, Pt> {
  const out = new Map<string, Pt>();
  if (boxes.length < 3) return out;
  const lo = (b: Box) => (axis === 'x' ? b.minX : b.minY);
  const hi = (b: Box) => (axis === 'x' ? b.maxX : b.maxY);
  const sorted = [...boxes].sort((a, c) => lo(a.box) - lo(c.box));
  const total = hi(sorted[sorted.length - 1].box) - lo(sorted[0].box);
  const sizes = sorted.reduce((a, b) => a + (hi(b.box) - lo(b.box)), 0);
  const gap = (total - sizes) / (sorted.length - 1);
  let cursor = lo(sorted[0].box);
  for (const b of sorted) {
    const d = cursor - lo(b.box);
    out.set(b.id, axis === 'x' ? [round(d), 0] : [0, round(d)]);
    cursor += hi(b.box) - lo(b.box) + gap;
  }
  return out;
}

export function alignEntities(f: Floor, ids: string[], mode: AlignMode | 'distribute-x' | 'distribute-y'): R<Floor> {
  const targets = ids.map((i) => f.entities[i]).filter((e) => e && !isOpening(e) && e.kind !== 'wall' && !e.locked) as Entity[];
  if (targets.length < 2) return fail('Select two or more movable objects (not walls or openings) to align.');
  const boxes = targets.map((e) => ({ id: e.id, box: entityBounds(f, e)! })).filter((b) => b.box);
  const deltas = mode === 'distribute-x' ? distributeBoxes(boxes, 'x') : mode === 'distribute-y' ? distributeBoxes(boxes, 'y') : alignBoxes(boxes, mode);
  if (!deltas.size) return fail(mode.startsWith('distribute') ? 'Select three or more objects to distribute.' : 'Nothing to align.');
  const entities = { ...f.entities };
  for (const [id, d] of deltas) entities[id] = translateEntity(entities[id], d);
  return { ok: true, value: { ...f, entities } };
}

export function setLocked(f: Floor, ids: string[], locked: boolean): Floor {
  const entities = { ...f.entities };
  for (const id of ids) if (entities[id]) entities[id] = { ...entities[id], locked } as Entity;
  return { ...f, entities };
}

export function setHidden(f: Floor, ids: string[], hidden: boolean): Floor {
  const entities = { ...f.entities };
  for (const id of ids) if (entities[id]) entities[id] = { ...entities[id], hidden } as Entity;
  return { ...f, entities };
}

/** Show only the selected objects (and the walls/rooms needed to understand them are NOT added: it is a true isolate). */
export function isolate(f: Floor, ids: string[]): Floor {
  return { ...f, isolated: ids.length ? ids : undefined };
}
export const unisolate = (f: Floor): Floor => ({ ...f, isolated: undefined, entities: Object.fromEntries(Object.entries(f.entities).map(([k, e]) => [k, e.hidden ? { ...e, hidden: false } : e])) as Floor['entities'] });

// ---------------- automatic tools ----------------

/** Adds linked dimensions along every wall (outer length) that does not already have one. */
export function autoDimensions(f: Floor): R<{ floor: Floor; added: number }> {
  const existing = floorEntities(f).filter((e): e is DimensionE => e.kind === 'dimension');
  const have = new Set(existing.flatMap((d) => [d.refA?.id, d.refB?.id].filter(Boolean) as string[]));
  const dims: DimensionE[] = [];
  for (const w of floorWalls(f)) {
    if (have.has(w.id) || wallLen(w) < 400) continue;
    dims.push({ id: newId('dimension'), kind: 'dimension', a: w.a, b: w.b, offset: -(w.thickness / 2 + 350), refA: { id: w.id, handle: 'a' }, refB: { id: w.id, handle: 'b' } });
  }
  if (!dims.length) return fail('Every wall already has a dimension.');
  return { ok: true, value: { floor: addEntities(f, dims), added: dims.length } };
}

/** Writes each room's name and area as text labels (editable annotations). */
export function autoRoomLabels(f: Floor, p: PlanModel): R<{ floor: Floor; added: number }> {
  const rooms = roomsOf(f, p.roomProps);
  const labels: TextE[] = [];
  for (const r of rooms) {
    labels.push({ id: newId('text'), kind: 'text', pos: [r.centroid[0] - 600, r.centroid[1] + 480], text: `${r.name} · ${(r.area / 1e6).toFixed(1)} m²`, size: 140, rot: 0 });
  }
  if (!labels.length) return fail('No closed rooms found. Draw walls that form a closed loop first.');
  return { ok: true, value: { floor: addEntities(f, labels), added: labels.length } };
}

/** Joins wall ends that are almost (but not exactly) touching, then re-splits junctions. */
export function healWalls(f: Floor, tol = 60): R<{ floor: Floor; merged: number }> {
  const walls = floorWalls(f);
  const nodes: Pt[] = [];
  const snap = (p: Pt): Pt => {
    const hit = nodes.find((n) => dist(n, p) <= tol);
    if (hit) return hit;
    nodes.push(p);
    return p;
  };
  let merged = 0;
  const entities = { ...f.entities };
  for (const w of walls) {
    const a = snap(w.a);
    const b = snap(w.b);
    if (!same(a, w.a, 0.01)) merged++;
    if (!same(b, w.b, 0.01)) merged++;
    entities[w.id] = { ...w, a, b } as WallE;
  }
  if (!merged) return fail('No nearly-touching wall ends were found.');
  return { ok: true, value: { floor: normalizeWalls({ ...f, entities }), merged } };
}

export function removeDuplicateWalls(f: Floor): R<{ floor: Floor; removed: number }> {
  const walls = floorWalls(f);
  const drop: string[] = [];
  for (let i = 0; i < walls.length; i++)
    for (let j = i + 1; j < walls.length; j++) {
      const a = walls[i];
      const b = walls[j];
      if (drop.includes(b.id)) continue;
      if ((same(a.a, b.a, 1) && same(a.b, b.b, 1)) || (same(a.a, b.b, 1) && same(a.b, b.a, 1))) drop.push(b.id);
    }
  if (!drop.length) return fail('No duplicate walls found.');
  return { ok: true, value: { floor: removeEntities(f, drop), removed: drop.length } };
}

// ---------------- branches (design variants) ----------------

export function createBranch(p: PlanModel, doc: SceneDoc, name: string): R {
  if (!name.trim()) return fail('Give the branch a name.');
  if (p.branches.some((b) => b.name.toLowerCase() === name.trim().toLowerCase())) return fail('A branch with this name already exists.');
  const snap = snapshot(p, doc);
  return { ok: true, value: { ...p, branches: [...p.branches, { id: newId('br'), name: name.trim(), createdAt: new Date().toISOString(), snapshot: snap }], activeBranch: null } };
}

function snapshot(p: PlanModel, doc: SceneDoc): Branch['snapshot'] {
  return { buildings: structuredClone(p.buildings), nodes: structuredClone(doc.nodes) as Record<string, unknown>, order: [...doc.order] };
}

/** Switch to a branch: the current design is stored back into the branch you leave (so nothing is lost). */
export function switchBranch(doc: SceneDoc, branchId: string | null): R<SceneDoc> {
  const p = doc.plan;
  if (!p) return fail('No floor plan.');
  if (branchId === p.activeBranch) return { ok: true, value: doc };
  const cur = snapshot(p, doc);
  let branches = p.branches;
  if (p.activeBranch) branches = branches.map((b) => (b.id === p.activeBranch ? { ...b, snapshot: cur } : b));
  let main = p.buildings;
  let mainNodes: Record<string, unknown> = doc.nodes as Record<string, unknown>;
  let mainOrder = doc.order;
  // "main" is stored as a pseudo-branch the first time we leave it
  let mainBranch = branches.find((b) => b.id === '__main__');
  if (!p.activeBranch) {
    mainBranch = { id: '__main__', name: 'Main design', createdAt: new Date().toISOString(), snapshot: cur };
    branches = [...branches.filter((b) => b.id !== '__main__'), mainBranch];
  }
  const target = branchId ? branches.find((b) => b.id === branchId) : branches.find((b) => b.id === '__main__');
  if (!target) return fail('Branch not found.');
  main = structuredClone(target.snapshot.buildings);
  mainNodes = structuredClone(target.snapshot.nodes);
  mainOrder = [...target.snapshot.order];
  const activeFloorId = main.flatMap((b) => b.floors).some((f) => f.id === p.activeFloorId) ? p.activeFloorId : main[0].floors[0].id;
  const activeBuildingId = main.find((b) => b.floors.some((f) => f.id === activeFloorId))!.id;
  return { ok: true, value: { ...doc, nodes: mainNodes as SceneDoc['nodes'], order: mainOrder, plan: { ...p, buildings: main, activeFloorId, activeBuildingId, branches, activeBranch: branchId } } };
}

export function deleteBranch(p: PlanModel, id: string): R {
  if (p.activeBranch === id) return fail('Switch to another branch before deleting this one.');
  return { ok: true, value: { ...p, branches: p.branches.filter((b) => b.id !== id) } };
}

// ---------------- classic room -> plan ----------------

/** Turns the project's classic room polygon (and its doors/windows) into real walls on the ground floor. */
export function roomToPlan(doc: SceneDoc): PlanModel {
  const plan = doc.plan ?? makePlan(true);
  const floor = activeFloor(plan);
  const r: LegacyRoom = doc.room;
  const pts = r.points as Pt[];
  const n = pts.length;
  // The classic polygon is the CLEAR interior, so the wall centre lines sit half a thickness outside it:
  // furniture already placed against the old walls stays exactly where it was.
  const half = r.wallThickness / 2;
  const centre = insetPolygon(pts, pts.map(() => (polygonArea(pts) > 0 ? -half : half)));
  const walls: WallE[] = centre.map((a, i) => ({ id: newId('wall'), kind: 'wall', a, b: centre[(i + 1) % n], thickness: r.wallThickness, height: r.height, wallType: 'exterior' }));
  const ents: Entity[] = [...walls];
  r.openings.forEach((o) => {
    const w = walls[o.wall];
    const old0 = pts[o.wall];
    if (!w || !old0) return;
    const L = wallLen(w);
    // offsets were measured from the old wall start; the new wall starts at the extended corner
    const shift = dot(sub(w.a, old0), wallDir(w));
    const width = Math.min(o.width, L - 100);
    const offset = Math.max(50, Math.min(o.offset - shift, L - width - 50));
    ents.push(
      o.kind === 'window'
        ? { id: newId('window'), kind: 'window', wall: w.id, offset, width, height: o.height, sill: o.sill }
        : { id: newId('door'), kind: 'door', wall: w.id, offset, width, height: o.height, swing: 'left', opens: 'in' },
    );
  });
  return updateFloor({ ...plan, enabled: true }, floor.id, (f) => normalizeWalls(addEntities({ ...f, height: r.height }, ents)));
}

export { mid, sub };
export type { SceneNode };

// ---------------- floor plan wizard ----------------

export interface WizardRoom {
  name: string;
  width: number;
}
export interface WizardRow {
  depth: number;
  rooms: WizardRoom[];
}
export interface WizardSpec {
  origin: Pt;
  rows: WizardRow[];
  thickness: number;
  height: number;
  doors: boolean;
  windows: boolean;
  entrance: boolean;
}

export const WIZARD_MIN = 1800;

/**
 * Builds walls (and optionally doors/windows) for rows of rooms. Every figure is the user's: nothing is guessed.
 * The outer rectangle is as wide as the widest row; the last room of a shorter row is stretched to close it.
 */
export function generateLayout(f: Floor, spec: WizardSpec): R<{ floor: Floor; roomNames: Record<string, string> }> {
  if (!spec.rows.length || spec.rows.some((r) => !r.rooms.length)) return fail('Add at least one room to every row.');
  for (const r of spec.rows) {
    if (!(r.depth >= WIZARD_MIN && r.depth <= 30000)) return fail(`Row depths must be between ${WIZARD_MIN} and 30000 mm.`);
    for (const rm of r.rooms) if (!(rm.width >= WIZARD_MIN && rm.width <= 30000)) return fail(`“${rm.name || 'Room'}”: widths must be between ${WIZARD_MIN} and 30000 mm.`);
  }
  if (!(spec.thickness >= 50 && spec.thickness <= 600)) return fail('Wall thickness must be between 50 and 600 mm.');
  const W = Math.max(...spec.rows.map((r) => r.rooms.reduce((a, x) => a + x.width, 0)));
  const D = spec.rows.reduce((a, r) => a + r.depth, 0);
  const [ox, oy] = spec.origin;
  const wall = (a: Pt, b: Pt, ext: boolean): WallE => ({ id: newId('wall'), kind: 'wall', a, b, thickness: spec.thickness, height: spec.height, wallType: ext ? 'exterior' : 'interior' });
  const walls: WallE[] = [
    wall([ox, oy], [ox + W, oy], true),
    wall([ox + W, oy], [ox + W, oy + D], true),
    wall([ox + W, oy + D], [ox, oy + D], true),
    wall([ox, oy + D], [ox, oy], true),
  ];
  // cells (room rectangles) with their stretched widths
  const cells: { name: string; x0: number; y0: number; x1: number; y1: number; row: number; col: number }[] = [];
  let y = oy;
  spec.rows.forEach((row, ri) => {
    let x = ox;
    row.rooms.forEach((rm, ci) => {
      const w = ci === row.rooms.length - 1 ? ox + W - x : rm.width;
      cells.push({ name: rm.name.trim() || `Room ${cells.length + 1}`, x0: x, y0: y, x1: x + w, y1: y + row.depth, row: ri, col: ci });
      if (ci > 0) walls.push(wall([x, y], [x, y + row.depth], false));
      x += w;
    });
    y += row.depth;
    if (ri < spec.rows.length - 1) walls.push(wall([ox, y], [ox + W, y], false));
  });
  let fl = normalizeWalls(addEntities(f, walls));
  const ents: Entity[] = [];
  const place = (kind: 'door' | 'window', p: Pt, width: number) => {
    const hit = nearestWall(fl, p, 80);
    if (!hit) return;
    const pos = placeOpening({ ...fl, entities: { ...fl.entities, ...Object.fromEntries(ents.map((e) => [e.id, e])) }, order: [...fl.order, ...ents.map((e) => e.id)] }, hit.wall.id, hit.t, width);
    if ('error' in pos) return;
    ents.push(kind === 'door' ? { id: newId('door'), kind: 'door', wall: hit.wall.id, offset: pos.offset, width, height: 2100, swing: 'left', opens: 'in' } : { id: newId('window'), kind: 'window', wall: hit.wall.id, offset: pos.offset, width, height: 1200, sill: 900 });
  };
  const lastRow = spec.rows.length - 1;
  if (spec.doors) {
    for (const c of cells) {
      if (c.col > 0) place('door', [c.x0, (c.y0 + c.y1) / 2], 900); // door in the partition to the room on the left
      else if (c.row > 0) place('door', [(c.x0 + c.x1) / 2, c.y0], 900); // first room of a row opens to the row above
    }
  }
  const entranceCell = cells.find((c) => c.row === lastRow && c.col === 0)!;
  if (spec.entrance) place('door', [(entranceCell.x0 + entranceCell.x1) / 2, entranceCell.y1], 1000);
  if (spec.windows) {
    for (const c of cells) {
      const w = Math.min(1200, Math.max(600, Math.min(c.x1 - c.x0, c.y1 - c.y0) - 700));
      const mx = (c.x0 + c.x1) / 2;
      const my = (c.y0 + c.y1) / 2;
      if (Math.abs(c.y0 - oy) < 1) place('window', [mx, c.y0], w);
      if (Math.abs(c.y1 - (oy + D)) < 1 && !(spec.entrance && c === entranceCell)) place('window', [mx, c.y1], w);
      if (Math.abs(c.x0 - ox) < 1) place('window', [c.x0, my], w);
      if (Math.abs(c.x1 - (ox + W)) < 1) place('window', [c.x1, my], w);
    }
  }
  fl = addEntities(fl, ents);
  const rooms = roomsOf(fl);
  const roomNames: Record<string, string> = {};
  for (const c of cells) {
    const mid: Pt = [(c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2];
    const r = rooms.find((rr) => pointIn(mid, rr.inner));
    if (r) roomNames[r.key] = c.name;
  }
  return { ok: true, value: { floor: fl, roomNames } };
}

function pointIn(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (poly[i][1] > p[1] !== poly[j][1] > p[1] && p[0] < ((poly[j][0] - poly[i][0]) * (p[1] - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) inside = !inside;
  }
  return inside;
}
