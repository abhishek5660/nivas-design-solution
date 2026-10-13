import { buildBoq } from '../docs/bom';
import { buildCutList } from '../docs/cutlist';
import { findCollisions, footprint, validateNode } from '../scene';
import type { SceneDoc, SceneNode } from '../types';
import { allFloors } from './model';
import { dist, mid, polygonArea, polysIntersectPt, round } from './geom';
import { roomsOf } from './rooms';
import { floorEntities, floorWalls, wallGeometries, wallLen } from './walls';
import type { Entity, Floor, Pt, Room } from './types';

const m2 = (mm2: number) => mm2 / 1e6;
const m = (mm: number) => mm / 1000;
const r2 = (n: number) => round(n, 2);
const r3 = (n: number) => round(n, 3);

export function nodeFloorId(doc: SceneDoc, n: SceneNode): string {
  return n.floorId ?? doc.plan!.buildings[0].floors[0].id;
}

export interface PlanBoqLine {
  key: string;
  section: string;
  description: string;
  spec: string;
  unit: string;
  qty: number;
  unitPrice: number | null;
  amount: number;
  source: 'entered' | 'missing' | 'cabinetry';
  estimate: boolean;
  objects: string[];
  floors: string[];
}

export interface PlanBoq {
  lines: PlanBoqLine[];
  planTotal: number;
  cabinetryTotal: number;
  unpriced: number;
  warnings: string[];
}

interface Acc {
  key: string;
  section: string;
  description: string;
  spec: string;
  unit: string;
  qty: number;
  objects: string[];
  floors: Set<string>;
}

/** Quantities taken from the floor plan objects (not a template): every figure comes from real geometry. */
export function planBoq(doc: SceneDoc): PlanBoq {
  const plan = doc.plan!;
  const acc = new Map<string, Acc>();
  const add = (key: string, section: string, description: string, spec: string, unit: string, qty: number, id: string, floor: string) => {
    const a = acc.get(key) ?? { key, section, description, spec, unit, qty: 0, objects: [], floors: new Set<string>() };
    a.qty += qty;
    a.objects.push(id);
    a.floors.add(floor);
    acc.set(key, a);
  };
  for (const floor of allFloors(plan)) {
    const rooms = roomsOf(floor, plan.roomProps);
    const ents = floorEntities(floor);
    const wallArea = new Map<string, number>();
    for (const e of ents) {
      if (e.kind === 'wall') {
        const L = wallLen(e);
        let opening = 0;
        for (const o of ents) if ((o.kind === 'door' || o.kind === 'window') && o.wall === e.id) opening += o.width * Math.min(o.height, e.height - (o.kind === 'window' ? o.sill : 0));
        const net = L * e.height - opening;
        wallArea.set(e.id, net);
        add(`wall:${e.wallType}:${e.thickness}:${e.height}`, 'Walls & structure', `${e.wallType === 'exterior' ? 'Exterior' : 'Interior'} wall`, `${e.thickness} mm thick × ${e.height} mm high · volume ${r3(m2(net) * m(e.thickness))} m³ per m² shown × thickness`, 'm²', m2(net), e.id, floor.id);
      } else if (e.kind === 'door') add(`door:${e.width}x${e.height}`, 'Doors & windows', 'Door', `${e.width} × ${e.height} mm`, 'pcs', 1, e.id, floor.id);
      else if (e.kind === 'window') add(`window:${e.width}x${e.height}:${e.sill}`, 'Doors & windows', 'Window', `${e.width} × ${e.height} mm, sill ${e.sill} mm`, 'pcs', 1, e.id, floor.id);
      else if (e.kind === 'column') add(`column:${e.shape}:${e.width}x${e.depth}x${e.height}`, 'Walls & structure', e.shape === 'round' ? 'Round column' : 'Column', `${e.width}${e.shape === 'round' ? ' Ø' : ` × ${e.depth}`} mm × ${e.height} mm high`, 'pcs', 1, e.id, floor.id);
      else if (e.kind === 'beam') add(`beam:${e.width}x${e.depth}`, 'Walls & structure', 'Beam', `${e.width} × ${e.depth} mm`, 'm', m(dist(e.a, e.b)), e.id, floor.id);
      else if (e.kind === 'stairs') add(`stairs:${e.steps}:${e.riser}:${e.tread}:${e.width}`, 'Stairs & railings', 'Staircase', `${e.steps} steps, riser ${e.riser} mm, tread ${e.tread} mm, width ${e.width} mm`, 'pcs', 1, e.id, floor.id);
      else if (e.kind === 'railing') {
        let L = 0;
        for (let i = 0; i < e.pts.length - 1; i++) L += dist(e.pts[i], e.pts[i + 1]);
        add(`railing:${e.height}`, 'Stairs & railings', 'Railing', `${e.height} mm high, posts @ ${e.spacing} mm`, 'm', m(L), e.id, floor.id);
      } else if (e.kind === 'light') add(`light:${e.lightType}`, 'Electrical', `${e.lightType[0].toUpperCase()}${e.lightType.slice(1)} light`, '', 'pcs', 1, e.id, floor.id);
      else if (e.kind === 'strip') add('strip', 'Electrical', 'Strip light', '', 'm', m(dist(e.a, e.b)), e.id, floor.id);
      else if (e.kind === 'model') add(`model:${e.fileName}`, 'Imported objects', `Imported model: ${e.fileName}`, `${Math.round(e.size.w)} × ${Math.round(e.size.d)} × ${Math.round(e.size.h)} mm`, 'pcs', 1, e.id, floor.id);
      else if (e.kind === 'slab') {
        const room = rooms.find((r) => insideRoom(e.anchor, r));
        const area = e.pts?.length ? Math.abs(polygonArea(e.pts)) : room ? Math.abs(polygonArea(room.outline)) : 0;
        add(`slab:${e.thickness}`, 'Walls & structure', 'Floor slab', `${e.thickness} mm thick · concrete volume = area × thickness`, 'm²', m2(area), e.id, floor.id);
      } else if (e.kind === 'ceiling') {
        const room = rooms.find((r) => insideRoom(e.anchor, r));
        if (room) add('ceiling', 'Finishes', 'Ceiling', `height ${e.height} mm`, 'm²', m2(room.area), e.id, floor.id);
      } else if (e.kind === 'roof') {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const p of e.pts) {
          minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
        }
        const plan2 = (maxX - minX + 2 * e.overhang) * (maxY - minY + 2 * e.overhang);
        const slope = e.roofType === 'flat' ? 1 : 1 / Math.cos((e.slope * Math.PI) / 180);
        add(`roof:${e.roofType}:${e.slope}`, 'Roof', `${e.roofType[0].toUpperCase()}${e.roofType.slice(1)} roof`, `${e.slope}° pitch, ${e.overhang} mm overhang (rectangle enclosing the outline)`, 'm²', m2(plan2) * slope, e.id, floor.id);
      } else if (e.kind === 'tiling') {
        const cell = (e.tileW + e.grout) * (e.tileH + e.grout);
        let area = 0;
        if (e.target === 'floor') {
          const room = rooms.find((r) => insideRoom(e.anchor, r));
          area = room ? room.area : 0;
        } else if (e.wall) {
          const w = floor.entities[e.wall];
          if (w?.kind === 'wall') area = 2 * wallLen(w) * Math.min(e.height, w.height);
        }
        if (area > 0) {
          add(`tile-area:${e.target}`, 'Finishes', e.target === 'floor' ? 'Floor tiling' : 'Wall tiling', `${e.tileW} × ${e.tileH} mm tiles, ${e.grout} mm grout, ${e.pattern}`, 'm²', m2(area), e.id, floor.id);
          add(`tile-pcs:${e.tileW}x${e.tileH}`, 'Finishes', `Tiles ${e.tileW} × ${e.tileH} mm`, 'incl. 10% cutting allowance', 'pcs', Math.ceil((area / cell) * 1.1), e.id, floor.id);
        }
      }
    }
    void wallArea;
  }
  // furniture & other scene nodes
  for (const n of Object.values(doc.nodes)) {
    if (n.type === 'group' || !n.visible) continue;
    const kind = String((n.params as { kind?: string; variant?: string }).kind ?? (n.params as { variant?: string }).variant ?? n.type);
    if (n.type === 'furniture') add(`furniture:${kind}`, 'Furniture', n.name.replace(/ \d+$/, ''), `${Math.round(n.size.w)} × ${Math.round(n.size.d)} × ${Math.round(n.size.h)} mm`, 'pcs', 1, n.id, nodeFloorId(doc, n));
  }

  const warnings: string[] = [];
  const lines: PlanBoqLine[] = [...acc.values()].map((a) => {
    const priced = plan.prices[a.key];
    const qty = a.unit === 'pcs' ? Math.round(a.qty) : r3(a.qty);
    const unitPrice = priced ? priced.unitPrice : null;
    return { key: a.key, section: a.section, description: a.description, spec: a.spec, unit: a.unit, qty, unitPrice, amount: unitPrice == null ? 0 : r2(unitPrice * qty), source: unitPrice == null ? 'missing' : 'entered', estimate: priced ? priced.estimate : true, objects: a.objects, floors: [...a.floors] };
  });
  // cabinetry: wardrobes, kitchen cabinets, TV panels, appliances (from the parametric designers)
  const cab = buildBoq(doc);
  const cabNodes = Object.values(doc.nodes).filter((n) => ['wardrobe', 'cabinet', 'countertop', 'appliance', 'tv_panel', 'box', 'model'].includes(n.type));
  if (cabNodes.length) {
    for (const it of cab.items) {
      lines.push({ key: `cab:${it.section}:${it.key}`, section: 'Cabinetry & appliances', description: it.description, spec: it.spec || it.section, unit: it.unit, qty: it.qty, unitPrice: it.unitPrice, amount: it.amount, source: it.unitPrice == null ? 'missing' : 'cabinetry', estimate: it.estimate, objects: it.nodes, floors: [] });
    }
  }
  lines.sort((x, y) => x.section.localeCompare(y.section) || x.description.localeCompare(y.description));
  const unpriced = lines.filter((l) => l.unitPrice == null).length;
  if (unpriced) warnings.push(`${unpriced} line${unpriced === 1 ? ' has' : 's have'} no unit price and ${unpriced === 1 ? 'is' : 'are'} excluded from the total. Enter your own rates; nothing is estimated for you.`);
  if (!lines.length) warnings.push('The design has no measurable objects yet.');
  const planTotal = r2(lines.filter((l) => l.source !== 'cabinetry').reduce((a, l) => a + l.amount, 0));
  const cabinetryTotal = r2(lines.filter((l) => l.source === 'cabinetry').reduce((a, l) => a + l.amount, 0));
  return { lines, planTotal, cabinetryTotal, unpriced, warnings: [...warnings, ...cab.warnings.filter(() => cabNodes.length > 0).slice(0, 3)] };
}

const insideRoom = (p: Pt, r: Room) => {
  let inside = false;
  const poly = r.outline;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (poly[i][1] > p[1] !== poly[j][1] > p[1] && p[0] < ((poly[j][0] - poly[i][0]) * (p[1] - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) inside = !inside;
  }
  return inside;
};

// ---------------- raw materials ----------------

export interface RawMaterial {
  material: string;
  qty: number;
  unit: string;
  usedIn: string;
}

export function rawMaterials(doc: SceneDoc): RawMaterial[] {
  const out: RawMaterial[] = [];
  const boq = planBoq(doc);
  for (const l of boq.lines) {
    if (l.section === 'Walls & structure' && l.description.endsWith('wall')) out.push({ material: `${l.description} - ${l.spec.split(' · ')[0]}`, qty: l.qty, unit: l.unit, usedIn: 'Walls' });
    else if (l.key.startsWith('slab:')) out.push({ material: `Concrete slab ${l.spec.split(' ')[0]} mm`, qty: r3(l.qty * (Number(l.key.split(':')[1]) / 1000)), unit: 'm³', usedIn: 'Floor slabs' });
    else if (l.key.startsWith('tile-pcs')) out.push({ material: l.description, qty: l.qty, unit: 'pcs', usedIn: 'Tiling' });
    else if (l.key === 'ceiling') out.push({ material: 'Ceiling board / finish', qty: l.qty, unit: 'm²', usedIn: 'Ceilings' });
    else if (l.key.startsWith('roof:')) out.push({ material: l.description, qty: l.qty, unit: 'm²', usedIn: 'Roof' });
  }
  const cabNodes = Object.values(doc.nodes).filter((n) => ['wardrobe', 'cabinet', 'countertop', 'tv_panel', 'box'].includes(n.type));
  if (cabNodes.length) {
    const cl = buildCutList(doc);
    for (const mt of cl.materials) out.push({ material: `${mt.name}, ${mt.thickness} mm board`, qty: r3(mt.areaM2), unit: 'm²', usedIn: 'Cabinetry panels' });
    const edge = cl.materials.reduce((a, x) => a + x.edgeBandM, 0);
    if (edge > 0) out.push({ material: 'Edge-banding tape', qty: r2(edge), unit: 'm', usedIn: 'Cabinetry panels' });
    for (const it of buildBoq(doc).items.filter((i) => i.section === 'Hardware' || i.section === 'Lighting')) out.push({ material: it.description, qty: it.qty, unit: it.unit, usedIn: 'Cabinetry hardware' });
  }
  return out;
}

// ---------------- QC / violations ----------------

export type Severity = 'error' | 'warning' | 'info';
export interface Violation {
  id: string;
  rule: string;
  severity: Severity;
  message: string;
  floorId: string;
  floorName: string;
  entityId?: string;
  nodeId?: string;
  at?: Pt;
}

/** Real design checks. Each result points to the object (and location) that causes it. */
export function runQc(doc: SceneDoc): Violation[] {
  const plan = doc.plan!;
  const out: Violation[] = [];
  let n = 0;
  const v = (rule: string, severity: Severity, message: string, floor: Floor, extra: Partial<Violation> = {}) => out.push({ id: `v${n++}`, rule, severity, message, floorId: floor.id, floorName: floor.name, ...extra });
  const floors = allFloors(plan);
  for (const floor of floors) {
    const rooms = roomsOf(floor, plan.roomProps);
    const ents = floorEntities(floor);
    const walls = floorWalls(floor);
    const inRoom = new Set(rooms.flatMap((r) => r.wallIds));
    const geoms = wallGeometries(walls);
    for (const w of walls) {
      const L = wallLen(w);
      if (L < 300) v('wall-short', 'warning', `Wall is only ${Math.round(L)} mm long (shorter than 300 mm).`, floor, { entityId: w.id, at: mid(w.a, w.b) });
      if (!inRoom.has(w.id)) v('wall-open', 'info', 'This wall is not part of a closed room (its ends are not connected into a loop).', floor, { entityId: w.id, at: mid(w.a, w.b) });
      if (w.height > floor.height + 1) v('wall-taller', 'warning', `Wall (${w.height} mm) is taller than the storey height (${floor.height} mm).`, floor, { entityId: w.id, at: mid(w.a, w.b) });
    }
    for (let i = 0; i < walls.length; i++)
      for (let j = i + 1; j < walls.length; j++) {
        const a = walls[i];
        const b = walls[j];
        if ((dist(a.a, b.a) < 1 && dist(a.b, b.b) < 1) || (dist(a.a, b.b) < 1 && dist(a.b, b.a) < 1)) v('wall-duplicate', 'warning', 'Two walls lie exactly on top of each other.', floor, { entityId: a.id, at: mid(a.a, a.b) });
      }
    for (const e of ents) {
      if (e.kind === 'door' || e.kind === 'window') {
        const w = floor.entities[e.wall];
        if (w?.kind !== 'wall') continue;
        const L = wallLen(w);
        const at = mid([w.a[0] + ((w.b[0] - w.a[0]) / L) * e.offset, w.a[1] + ((w.b[1] - w.a[1]) / L) * e.offset], [w.a[0] + ((w.b[0] - w.a[0]) / L) * (e.offset + e.width), w.a[1] + ((w.b[1] - w.a[1]) / L) * (e.offset + e.width)]);
        if (e.offset < -1e-6 || e.offset + e.width > L + 1e-6) v('opening-outside', 'error', `${e.kind === 'door' ? 'Door' : 'Window'} (${e.width} mm) extends beyond its ${Math.round(L)} mm wall segment.`, floor, { entityId: e.id, at });
        const top = (e.kind === 'window' ? e.sill : 0) + e.height;
        if (top > w.height + 1e-6) v('opening-tall', 'error', `${e.kind === 'door' ? 'Door' : 'Window'} top (${top} mm) is above the wall height (${w.height} mm).`, floor, { entityId: e.id, at });
        if (e.kind === 'door' && e.width < 700) v('door-narrow', 'warning', `Door is only ${e.width} mm wide (recommended minimum 700 mm).`, floor, { entityId: e.id, at });
        for (const o of ents) {
          if ((o.kind === 'door' || o.kind === 'window') && o.id > e.id && o.wall === e.wall && e.offset < o.offset + o.width && o.offset < e.offset + e.width) v('opening-overlap', 'error', 'A door/window overlaps another opening on the same wall.', floor, { entityId: e.id, at });
        }
      } else if (e.kind === 'stairs') {
        const rise = e.steps * e.riser;
        if (Math.abs(rise - floor.height) > 25) v('stairs-rise', 'warning', `Stairs rise ${rise} mm but the storey height is ${floor.height} mm.`, floor, { entityId: e.id, at: e.origin });
        const c = 2 * e.riser + e.tread;
        if (c < 550 || c > 700) v('stairs-comfort', 'warning', `Riser/tread combination (2R+T = ${c} mm) is outside the comfortable 550-700 mm range.`, floor, { entityId: e.id, at: e.origin });
        if (e.width < 800) v('stairs-width', 'warning', `Stairs are only ${e.width} mm wide.`, floor, { entityId: e.id, at: e.origin });
      } else if (e.kind === 'ceiling') {
        if (e.height > floor.height + 1) v('ceiling-high', 'warning', `Ceiling (${e.height} mm) is above the storey height (${floor.height} mm).`, floor, { entityId: e.id, at: e.anchor });
        if (!rooms.some((r) => insideRoom(e.anchor, r))) v('orphan', 'warning', 'This ceiling no longer sits inside a closed room.', floor, { entityId: e.id, at: e.anchor });
      } else if (e.kind === 'slab' || e.kind === 'tiling') {
        if (!(e.kind === 'slab' && e.pts?.length) && !(e.kind === 'tiling' && e.target === 'wall') && !rooms.some((r) => insideRoom(e.anchor, r))) v('orphan', 'warning', `This ${e.kind} no longer sits inside a closed room.`, floor, { entityId: e.id, at: e.anchor });
      } else if (e.kind === 'dimension') {
        if ((e.refA && !floor.entities[e.refA.id]) || (e.refB && !floor.entities[e.refB.id])) v('dimension-unlinked', 'warning', 'A dimension lost the object it was linked to.', floor, { entityId: e.id, at: e.a });
      } else if (e.kind === 'column') {
        for (const g of geoms) if (polysIntersectPt(g.outline, e.c)) v('column-in-wall', 'info', 'Column centre lies inside a wall.', floor, { entityId: e.id, at: e.c });
      }
    }
    for (const r of rooms) {
      const hasDoor = ents.some((e) => e.kind === 'door' && r.wallIds.includes(e.wall));
      if (!hasDoor) v('room-no-door', 'warning', `${r.name} has no door.`, floor, { at: r.centroid });
      if (!ents.some((e) => e.kind === 'window' && r.wallIds.includes(e.wall))) v('room-no-window', 'info', `${r.name} has no window.`, floor, { at: r.centroid });
      const hasDim = ents.some((e) => e.kind === 'dimension' && insideRoom(e.a, r) || (e.kind === 'dimension' && insideRoom(e.b, r)));
      if (!hasDim) v('room-no-dimension', 'info', `${r.name} has no dimension annotation.`, floor, { at: r.centroid });
      if (r.area < 3e6) v('room-small', 'info', `${r.name} is small (${(r.area / 1e6).toFixed(2)} m²).`, floor, { at: r.centroid });
    }
  }
  // objects from the designers
  const nodes = Object.values(doc.nodes).filter((x) => x.type !== 'group' && x.visible);
  for (const node of nodes) {
    const fl = floors.find((f) => f.id === nodeFloorId(doc, node)) ?? floors[0];
    for (const i of validateNode(node)) if (i.level === 'error') v('object-invalid', 'error', `${node.name}: ${i.message}`, fl, { nodeId: node.id, at: [node.position[0], node.position[2]] });
  }
  for (const c of findCollisions(doc)) {
    const a = doc.nodes[c.a];
    const fl = floors.find((f) => f.id === nodeFloorId(doc, a)) ?? floors[0];
    v('object-overlap', 'error', c.message, fl, { nodeId: c.a, at: [a.position[0], a.position[2]] });
  }
  for (const node of nodes) {
    const fl = floors.find((f) => f.id === nodeFloorId(doc, node)) ?? floors[0];
    const geoms = wallGeometries(floorWalls(fl));
    const fp = footprint(node);
    if (node.type !== 'tv_panel' && node.type !== 'countertop' && node.position[1] < fl.elevation + 1000) {
      for (const g of geoms) if (fp.some((p) => polysIntersectPt(g.outline, p, 5)) && !fp.every((p) => polysIntersectPt(g.outline, p, 5))) {
        v('object-in-wall', 'warning', `${node.name} runs into a wall.`, fl, { nodeId: node.id, at: [node.position[0], node.position[2]] });
        break;
      }
    }
  }
  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity] || a.rule.localeCompare(b.rule));
}

// ---------------- work schedule ----------------

export interface SchedulePhase {
  id: string;
  name: string;
  items: string;
  quantity: string;
  days: number | null;
}

const PHASES: { id: string; name: string; sections: string[] }[] = [
  { id: 'structure', name: 'Walls, columns, beams & slabs', sections: ['Walls & structure'] },
  { id: 'roof', name: 'Roof', sections: ['Roof'] },
  { id: 'openings', name: 'Doors & windows', sections: ['Doors & windows'] },
  { id: 'stairs', name: 'Stairs & railings', sections: ['Stairs & railings'] },
  { id: 'electrical', name: 'Electrical & lighting', sections: ['Electrical'] },
  { id: 'finishes', name: 'Ceilings, tiling & finishes', sections: ['Finishes'] },
  { id: 'cabinetry', name: 'Cabinetry & joinery (production)', sections: ['Cabinetry & appliances'] },
  { id: 'furniture', name: 'Furniture & imported objects', sections: ['Furniture', 'Imported objects'] },
];

/** Phases appear only for work that exists in the design. Durations are entered by the user; none are assumed. */
export function workSchedule(doc: SceneDoc): { phases: SchedulePhase[]; totalDays: number; unestimated: number } {
  const boq = planBoq(doc);
  const phases: SchedulePhase[] = [];
  for (const ph of PHASES) {
    const lines = boq.lines.filter((l) => ph.sections.includes(l.section));
    if (!lines.length) continue;
    const q = new Map<string, number>();
    for (const l of lines) q.set(l.unit, (q.get(l.unit) ?? 0) + l.qty);
    phases.push({ id: ph.id, name: ph.name, items: `${lines.length} line${lines.length === 1 ? '' : 's'}`, quantity: [...q].map(([u, n]) => `${r2(n)} ${u}`).join(' · '), days: doc.plan!.schedule[ph.id]?.days ?? null });
  }
  const totalDays = phases.reduce((a, p) => a + (p.days ?? 0), 0);
  return { phases, totalDays, unestimated: phases.filter((p) => p.days == null).length };
}

export type { Entity };
