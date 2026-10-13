import { buildCabinet, CABINET_VARIANTS, defaultCabinet, validateCabinet } from './build/cabinet';
import { buildAppliance, buildBox, buildCountertop, defaultAppliance, defaultBox, defaultCountertop, validateAppliance, validateBox, validateCountertop } from './build/misc';
import { buildTv, defaultTv, validateTv } from './build/tv';
import { buildFurniture, furnitureById, validateFurniture } from './build/furniture';
import { activeFloor, allFloors, makePlan } from './plan/model';
import { roomsOf } from './plan/rooms';
import { buildWardrobe, defaultWardrobe, resizeWardrobe, uid, validateWardrobe } from './build/wardrobe';
import type {
  ApplianceParams,
  CabinetParams,
  CabinetVariant,
  Category,
  Issue,
  NodeType,
  Part,
  Room,
  SceneDoc,
  SceneNode,
  Vec3,
} from './types';

export { uid };

// ---------- Parts registry ----------

const partCache = new WeakMap<SceneNode, Part[]>();

export function buildParts(node: SceneNode): Part[] {
  const hit = partCache.get(node);
  if (hit) return hit;
  let parts: Part[] = [];
  switch (node.type) {
    case 'wardrobe':
      parts = buildWardrobe(node);
      break;
    case 'cabinet':
      parts = buildCabinet(node);
      break;
    case 'countertop':
      parts = buildCountertop(node);
      break;
    case 'appliance':
      parts = buildAppliance(node);
      break;
    case 'tv_panel':
      parts = buildTv(node);
      break;
    case 'box':
      parts = buildBox(node);
      break;
    case 'furniture':
      parts = buildFurniture(node);
      break;
    default:
      parts = [];
  }
  partCache.set(node, parts);
  return parts;
}

export function validateNode(node: SceneNode): Issue[] {
  const dims = node.size;
  if (!(Number.isFinite(dims.w) && Number.isFinite(dims.h) && Number.isFinite(dims.d))) {
    return [{ level: 'error', message: 'Dimensions must be valid numbers.' }];
  }
  if (dims.w <= 0 || dims.h <= 0 || dims.d <= 0) {
    return [{ level: 'error', message: 'Dimensions must be positive (negative or zero sizes are not allowed).' }];
  }
  switch (node.type) {
    case 'wardrobe':
      return validateWardrobe(node);
    case 'cabinet':
      return validateCabinet(node);
    case 'countertop':
      return validateCountertop(node);
    case 'appliance':
      return validateAppliance(node);
    case 'tv_panel':
      return validateTv(node);
    case 'box':
      return validateBox(node);
    case 'model':
      return validateBox(node);
    case 'furniture':
      return validateFurniture(node);
    default:
      return [];
  }
}

/** Applies an overall resize, letting the node type re-balance its parametric content. */
export function resizeNode(node: SceneNode, size: SceneNode['size']): SceneNode {
  if (node.type === 'wardrobe') return resizeWardrobe(node, size);
  if (node.type === 'tv_panel') {
    const p = node.params as { unit: { width: number }; sides: { left: { enabled: boolean; width: number }; right: { enabled: boolean; width: number } } };
    const dw = size.w - node.size.w;
    return { ...node, size, params: { ...node.params, unit: { ...p.unit, width: Math.max(300, Math.round(p.unit.width + dw)) } } };
  }
  return { ...node, size };
}

// ---------- Rooms ----------

export function defaultRoom(category: Category): Room {
  const dims = category === 'KITCHEN' ? [3600, 3000, 2700] : category === 'TV_PANEL' ? [4200, 3600, 2900] : [3600, 3200, 2700];
  return roomFromRect(dims[0], dims[1], dims[2]);
}

export function roomFromRect(w: number, d: number, h: number): Room {
  return {
    points: [
      [0, 0],
      [w, 0],
      [w, d],
      [0, d],
    ],
    height: h,
    wallThickness: 120,
    openings: [
      { id: uid('op'), kind: 'door', wall: 3, offset: Math.max(200, d - 1100), width: 900, height: 2100, sill: 0 },
      { id: uid('op'), kind: 'window', wall: 1, offset: Math.max(300, d / 2 - 600), width: 1200, height: 1200, sill: 900 },
    ],
    columns: [],
    floorMaterial: 'floor-oak',
    wallMaterial: 'wall-white',
    ceilingMaterial: 'wall-white',
    showWalls: true,
    showCeiling: false,
  };
}

export function roomBounds(room: Room) {
  const xs = room.points.map((p) => p[0]);
  const zs = room.points.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

export function polygonArea(pts: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i];
    const [x2, z2] = pts[(i + 1) % pts.length];
    a += x1 * z2 - x2 * z1;
  }
  return a / 2;
}

export interface WallEdge {
  index: number;
  p0: [number, number];
  p1: [number, number];
  dir: [number, number]; // unit
  normal: [number, number]; // unit, pointing into the room
  length: number;
}

export function wallEdges(room: Room): WallEdge[] {
  const pts = room.points;
  const ccw = polygonArea(pts) > 0;
  return pts.map((p0, i) => {
    const p1 = pts[(i + 1) % pts.length];
    const dx = p1[0] - p0[0];
    const dz = p1[1] - p0[1];
    const length = Math.hypot(dx, dz) || 1;
    const dir: [number, number] = [dx / length, dz / length];
    // area sign in the (x,z) plane: for ccw (positive shoelace), the interior lies to the left of travel
    const normal: [number, number] = ccw ? [-dz / length, dx / length] : [dz / length, -dx / length];
    return { index: i, p0, p1, dir, normal, length };
  });
}

export function validateRoom(room: Room): Issue[] {
  const out: Issue[] = [];
  if (room.points.length < 3) out.push({ level: 'error', message: 'A room needs at least 3 corners.' });
  if (room.height < 2000 || room.height > 5000) out.push({ level: 'error', field: 'height', message: 'Room height must be 2000-5000 mm.' });
  if (out.length) return out;
  const area = Math.abs(polygonArea(room.points));
  if (area < 1_000_000) out.push({ level: 'error', message: 'Room area is under 1 m2.' });
  const edges = wallEdges(room);
  edges.forEach((e) => {
    if (e.length < 300) out.push({ level: 'error', message: `Wall ${e.index + 1} is shorter than 300 mm.` });
  });
  // self-intersection check (simple polygon)
  for (let i = 0; i < edges.length; i++)
    for (let j = i + 2; j < edges.length; j++) {
      if (i === 0 && j === edges.length - 1) continue;
      if (segIntersect(edges[i].p0, edges[i].p1, edges[j].p0, edges[j].p1)) out.push({ level: 'error', message: `Walls ${i + 1} and ${j + 1} cross each other.` });
    }
  for (const o of room.openings) {
    const e = edges[o.wall];
    if (!e) {
      out.push({ level: 'error', message: `An opening refers to missing wall ${o.wall + 1}.` });
      continue;
    }
    if (o.width < 300 || o.height < 300) out.push({ level: 'error', message: 'Openings must be at least 300 x 300 mm.' });
    if (o.offset < 0 || o.offset + o.width > e.length) out.push({ level: 'error', message: `${o.kind} on wall ${o.wall + 1} extends past the wall (${Math.round(e.length)} mm).` });
    if (o.sill + o.height > room.height) out.push({ level: 'error', message: `${o.kind} on wall ${o.wall + 1} is taller than the room.` });
  }
  return out;
}

function segIntersect(a: [number, number], b: [number, number], c: [number, number], d: [number, number]) {
  const o = (p: [number, number], q: [number, number], r: [number, number]) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

export function pointInPolygon(x: number, z: number, pts: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i];
    const [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// ---------- Defaults / factories ----------

export function defaultDoc(category: Category): SceneDoc {
  return {
    schema: 1,
    units: 'mm',
    category,
    room: defaultRoom(category),
    nodes: {},
    order: [],
    defaults: {
      carcass: 'lam-white-matte',
      interior: 'lam-white-matte',
      back: 'lam-white-matte',
      shutter: category === 'KITCHEN' ? 'sc-sage' : 'wood-oak',
      handle: 'metal-brass',
      top: 'stone-quartz',
      backsplash: 'marble-carrara',
      accent: 'deco-fluted-walnut',
    },
    customMaterials: [],
    pricing: { currency: 'INR', taxPct: 18, labourPct: 12, installationFlat: 0, wastagePct: 10, discountPct: 0, overrides: {} },
    lighting: { preset: 'neutral', exposure: 1, toneMapping: 'ACES', shadows: true, ao: true, roomLight: 1 },
    meta: { createdWith: 'NIVAS DESIGN SOLUTION 0.1', notes: '' },
  };
}


export interface MakeNodeOpts {
  name?: string;
  position?: Vec3;
  rotationY?: number;
  size?: Partial<SceneNode['size']>;
  params?: Record<string, unknown>;
  materials?: SceneNode['materials'];
  variant?: CabinetVariant;
  kind?: ApplianceParams['kind'];
}

let nameCounters: Record<string, number> = {};
export function nextName(prefix: string): string {
  nameCounters[prefix] = (nameCounters[prefix] ?? 0) + 1;
  return `${prefix} ${nameCounters[prefix]}`;
}
export function resetNameCounters(doc?: SceneDoc) {
  nameCounters = {};
  if (doc) {
    for (const n of Object.values(doc.nodes)) {
      const m = /^(.*) (\d+)$/.exec(n.name);
      if (m) nameCounters[m[1]] = Math.max(nameCounters[m[1]] ?? 0, Number(m[2]));
    }
  }
}

export function makeNode(type: NodeType, o: MakeNodeOpts = {}): SceneNode {
  const id = uid(type === 'cabinet' ? 'cab' : type.slice(0, 3));
  let size: SceneNode['size'];
  let params: Record<string, unknown>;
  let y = 0;
  let name: string;
  switch (type) {
    case 'wardrobe': {
      const d = defaultWardrobe(o.size?.w, o.size?.h, o.size?.d);
      size = d.size;
      params = d.params as unknown as Record<string, unknown>;
      name = o.name ?? nextName('Wardrobe');
      break;
    }
    case 'cabinet': {
      const v = o.variant ?? 'base';
      const d = defaultCabinet(v);
      size = d.size;
      params = d.params as unknown as Record<string, unknown>;
      y = d.elevation;
      name = o.name ?? nextName(CABINET_VARIANTS[v].label);
      break;
    }
    case 'countertop': {
      const d = defaultCountertop();
      size = d.size;
      params = d.params as unknown as Record<string, unknown>;
      y = d.elevation;
      name = o.name ?? nextName('Countertop');
      break;
    }
    case 'appliance': {
      const d = defaultAppliance(o.kind ?? 'fridge');
      size = d.size;
      params = d.params as unknown as Record<string, unknown>;
      y = d.elevation;
      name = o.name ?? nextName(applianceLabel(o.kind ?? 'fridge'));
      break;
    }
    case 'tv_panel': {
      const d = defaultTv(o.size?.w, o.size?.h, o.size?.d);
      size = d.size;
      params = d.params as unknown as Record<string, unknown>;
      name = o.name ?? nextName('TV panel');
      break;
    }
    case 'furniture': {
      const item = furnitureById(String(o.params?.kind ?? o.variant ?? 'sofa3'));
      size = item ? { ...item.size } : { w: 800, h: 800, d: 800 };
      params = { kind: item?.id ?? 'sofa3' };
      name = o.name ?? nextName(item?.label ?? 'Furniture');
      if (item && !o.materials) o = { ...o, materials: { ...item.materials } };
      break;
    }
    default: {
      const d = defaultBox();
      size = d.size;
      params = d.params as unknown as Record<string, unknown>;
      name = o.name ?? nextName(type === 'model' ? 'Imported model' : 'Block');
    }
  }
  const position: Vec3 = o.position ?? [0, y, 0];
  if (o.position && o.position[1] === 0 && y) position[1] = y;
  return {
    id,
    type,
    name,
    parentId: null,
    position,
    rotationY: o.rotationY ?? 0,
    size: { ...size, ...o.size },
    materials: o.materials ?? {},
    visible: true,
    locked: false,
    params: { ...params, ...(o.params ?? {}) },
  };
}

function applianceLabel(k: ApplianceParams['kind']) {
  return { fridge: 'Refrigerator', oven: 'Oven', microwave: 'Microwave', hob: 'Hob', chimney: 'Chimney', dishwasher: 'Dishwasher', sink: 'Sink', light_strip: 'Task light' }[k];
}

export function addNodeToDoc(doc: SceneDoc, node: SceneNode): SceneDoc {
  return { ...doc, nodes: { ...doc.nodes, [node.id]: node }, order: [...doc.order, node.id] };
}

// ---------- Geometry in plan ----------

export type Pt = [number, number];

/** Footprint of a node as 4 corners in world (x,z) coords. */
export function footprint(node: SceneNode, shrink = 0): Pt[] {
  const w = node.size.w - shrink * 2;
  const d = node.size.d - shrink * 2;
  const th = (node.rotationY * Math.PI) / 180;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const [px, , pz] = node.position;
  const corners: Pt[] = [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ];
  return corners.map(([lx, lz]) => [px + lx * c + lz * s, pz - lx * s + lz * c] as Pt);
}

function project(poly: Pt[], ax: Pt): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const [x, z] of poly) {
    const v = x * ax[0] + z * ax[1];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return [min, max];
}

export function polysOverlap(a: Pt[], b: Pt[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const ax: Pt = [-(q[1] - p[1]), q[0] - p[0]];
      const [a0, a1] = project(a, ax);
      const [b0, b1] = project(b, ax);
      if (a1 <= b0 || b1 <= a0) return false;
    }
  }
  return true;
}

export function nodeYRange(node: SceneNode): [number, number] {
  return [node.position[1], node.position[1] + node.size.h];
}

const NO_COLLIDE: NodeType[] = ['group'];
function ignoresCollision(a: SceneNode, b: SceneNode) {
  if (NO_COLLIDE.includes(a.type) || NO_COLLIDE.includes(b.type)) return true;
  // worktop slabs meet in mitred corner joints
  if (a.type === 'countertop' && b.type === 'countertop') return true;
  // under-cabinet lights are decorative
  const isLight = (n: SceneNode) => n.type === 'appliance' && (n.params as { kind?: string }).kind === 'light_strip';
  return isLight(a) || isLight(b);
}

export interface Collision {
  a: string;
  b: string;
  message: string;
}

export function findCollisions(doc: SceneDoc, onlyId?: string): Collision[] {
  const nodes = doc.order.map((id) => doc.nodes[id]).filter((n) => n && n.visible);
  const out: Collision[] = [];
  const list = onlyId ? nodes.filter((n) => n.id === onlyId) : nodes;
  for (const a of list) {
    const fa = footprint(a, 1);
    const [a0, a1] = nodeYRange(a);
    for (const b of nodes) {
      if (a.id === b.id || (!onlyId && a.id > b.id)) continue;
      if (ignoresCollision(a, b)) continue;
      const [b0, b1] = nodeYRange(b);
      if (a1 <= b0 + 1 || b1 <= a0 + 1) continue;
      if (polysOverlap(fa, footprint(b, 1))) out.push({ a: a.id, b: b.id, message: `${a.name} overlaps ${b.name}` });
    }
  }
  return out;
}

export function nodeOutsideRoom(doc: SceneDoc, node: SceneNode): boolean {
  const poly = footprint(node, 2);
  const pts = doc.room.points;
  return poly.some(([x, z]) => !pointInPolygon(x, z, pts));
}

/** Overall bounding box of a node's footprint in world coordinates. */
export function nodeWorldBox(node: SceneNode) {
  const f = footprint(node);
  const xs = f.map((p) => p[0]);
  const zs = f.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs), minY: node.position[1], maxY: node.position[1] + node.size.h };
}

// ---------- Snapping ----------

export interface SnapResult {
  position: Vec3;
  rotationY: number;
  snappedWall: number | null;
}

const WALL_SNAP = 220;
const EDGE_SNAP = 60;

/** Room edges that furniture can snap to: the plan's detected rooms (floor-plan projects) or the legacy room polygon. */
export function snapEdges(doc: SceneDoc, floorId?: string): WallEdge[] {
  if (doc.plan?.enabled) {
    const fl = (floorId && allFloors(doc.plan).find((f) => f.id === floorId)) || activeFloor(doc.plan);
    const out: WallEdge[] = [];
    let k = 0;
    for (const r of roomsOf(fl, doc.plan.roomProps)) {
      const pts = r.inner;
      for (let i = 0; i < pts.length; i++) {
        const p0 = pts[i];
        const p1 = pts[(i + 1) % pts.length];
        const dx = p1[0] - p0[0];
        const dz = p1[1] - p0[1];
        const length = Math.hypot(dx, dz);
        if (length < 1) continue;
        out.push({ index: k++, p0, p1, dir: [dx / length, dz / length], normal: [-dz / length, dx / length], length });
      }
    }
    return out;
  }
  return wallEdges(doc.room);
}

/** Whether the object's footprint lies outside every room of its floor (floor-plan projects) or the legacy room. */
function outsideRooms(doc: SceneDoc, node: SceneNode): boolean {
  if (!doc.plan?.enabled) return nodeOutsideRoom(doc, node);
  const fl = (node.floorId && allFloors(doc.plan).find((f) => f.id === node.floorId)) || activeFloor(doc.plan);
  const rooms = roomsOf(fl, doc.plan.roomProps);
  if (!rooms.length) return false; // nothing drawn yet: no warning
  const poly = footprint(node, 2);
  return !rooms.some((r) => poly.every(([x, z]) => pointInPolygon(x, z, r.outline)));
}

export function snapNode(doc: SceneDoc, node: SceneNode, cand: Vec3, rotationY: number, gridSnap: number | null, wallSnap = true): SnapResult {
  let [x, y, z] = cand;
  let rot = rotationY;
  if (gridSnap) {
    x = Math.round(x / gridSnap) * gridSnap;
    z = Math.round(z / gridSnap) * gridSnap;
  }
  let snappedWall: number | null = null;
  const isIsland = node.type === 'cabinet' && (node.params as unknown as CabinetParams).variant === 'island';
  if (wallSnap && !isIsland && node.type !== 'box') {
    let best: { e: WallEdge; dist: number } | null = null;
    for (const e of snapEdges(doc, node.floorId)) {
      // distance from node centre to wall line along the normal
      const dist = (x - e.p0[0]) * e.normal[0] + (z - e.p0[1]) * e.normal[1] - node.size.d / 2;
      const along = (x - e.p0[0]) * e.dir[0] + (z - e.p0[1]) * e.dir[1];
      if (along < -node.size.w / 2 || along > e.length + node.size.w / 2) continue;
      if (Math.abs(dist) < WALL_SNAP && (!best || Math.abs(dist) < Math.abs(best.dist))) best = { e, dist };
    }
    if (best) {
      const { e, dist } = best;
      x -= e.normal[0] * dist;
      z -= e.normal[1] * dist;
      rot = (Math.atan2(e.normal[0], e.normal[1]) * 180) / Math.PI;
      snappedWall = e.index;
      // slide along the wall: snap to neighbours' edges and the corners
      const along = (x - e.p0[0]) * e.dir[0] + (z - e.p0[1]) * e.dir[1];
      const half = node.size.w / 2;
      const stops: number[] = [half, e.length - half];
      for (const id of doc.order) {
        const o = doc.nodes[id];
        if (!o || o.id === node.id || !o.visible) continue;
        if (Math.abs(((o.rotationY - rot + 540) % 360) - 180) > 1) continue; // same facing
        const oa = (o.position[0] - e.p0[0]) * e.dir[0] + (o.position[2] - e.p0[1]) * e.dir[1];
        const perp = (o.position[0] - e.p0[0]) * e.normal[0] + (o.position[2] - e.p0[1]) * e.normal[1] - o.size.d / 2;
        if (Math.abs(perp) > 80) continue;
        stops.push(oa - o.size.w / 2 - half, oa + o.size.w / 2 + half);
      }
      let bestStop: number | null = null;
      for (const s of stops) if (Math.abs(s - along) < EDGE_SNAP && (bestStop === null || Math.abs(s - along) < Math.abs(bestStop - along))) bestStop = s;
      if (bestStop !== null) {
        x += e.dir[0] * (bestStop - along);
        z += e.dir[1] * (bestStop - along);
      }
    }
  }
  rot = Math.round(rot * 1000) / 1000;
  return { position: [Math.round(x * 10) / 10, y, Math.round(z * 10) / 10], rotationY: rot, snappedWall };
}

/** Checks a proposed placement; returns messages (empty = fine). */
export function checkPlacement(doc: SceneDoc, node: SceneNode): Issue[] {
  const out: Issue[] = [];
  const probe: SceneDoc = { ...doc, nodes: { ...doc.nodes, [node.id]: node } };
  const cols = findCollisions(probe, node.id);
  for (const c of cols) out.push({ level: 'error', message: c.message });
  if (node.type !== 'tv_panel' && outsideRooms(probe, node)) out.push({ level: 'warning', message: `${node.name} extends outside the room.` });
  if (node.position[1] < 0) out.push({ level: 'error', message: 'Elevation cannot be below the floor.' });
  return out;
}

// ---------- Layout generation ----------

export type KitchenLayout = 'straight' | 'l_shape' | 'u_shape' | 'parallel' | 'island';

interface RunItem {
  kind: 'cabinet' | 'appliance';
  variant?: CabinetVariant;
  appliance?: ApplianceParams['kind'];
  w: number;
  wall?: boolean; // wall cabinet above (cabinets only)
  top?: 'hob' | 'sink'; // appliance sitting on the worktop above this cabinet
  hood?: boolean; // chimney above (replaces the wall cabinet)
  params?: Record<string, unknown>;
}

function splitWidths(length: number, target = 600): number[] {
  if (length < 150) return [];
  const n = Math.max(1, Math.round(length / target));
  const w = Math.floor(length / n / 5) * 5;
  const arr = Array(n).fill(w);
  arr[n - 1] += length - w * n;
  return arr;
}

type Wall = 'back' | 'left' | 'right' | 'front';

/** Generates a parametric kitchen for a rectangular room of W x D (mm). */
export function generateKitchen(layout: KitchenLayout, W: number, D: number): { nodes: SceneNode[]; notes: string[] } {
  const nodes: SceneNode[] = [];
  const notes: string[] = [];
  const CD = 600;
  // position/rotation for a unit of width w, depth d starting `along` mm from the wall's origin corner
  const place = (wall: Wall, along: number, w: number, d: number): { x: number; z: number; rot: number } => {
    switch (wall) {
      case 'back':
        return { x: along + w / 2, z: d / 2, rot: 0 };
      case 'left':
        return { x: d / 2, z: along + w / 2, rot: 90 };
      case 'right':
        return { x: W - d / 2, z: D - (along + w / 2), rot: -90 };
      default:
        return { x: W - (along + w / 2), z: D - d / 2, rot: 180 };
    }
  };
  const put = (n: SceneNode, wall: Wall, along: number, width: number, frontShift = 0) => {
    const q = place(wall, along, width, n.size.d);
    const th = (q.rot * Math.PI) / 180;
    n.position = [q.x + Math.sin(th) * frontShift, n.position[1], q.z + Math.cos(th) * frontShift];
    n.rotationY = q.rot;
    nodes.push(n);
  };
  const addRun = (wall: Wall, start: number, items: RunItem[]) => {
    let cursor = start;
    let cs = -1;
    let ce = -1;
    for (const it of items) {
      if (it.kind === 'cabinet') {
        const n = makeNode('cabinet', { variant: it.variant, size: { w: it.w }, params: it.params });
        put(n, wall, cursor, it.w);
        if (['base', 'drawer', 'sink', 'corner'].includes(it.variant!)) {
          if (cs < 0) cs = cursor;
          ce = cursor + it.w;
        }
        if (it.top) {
          const a = makeNode('appliance', { kind: it.top });
          a.size.w = Math.min(a.size.w, it.w - 40);
          put(a, wall, cursor + (it.w - a.size.w) / 2, a.size.w, (CD + 20 - a.size.d) / 2 - 30);
        }
        if (it.hood) {
          const a = makeNode('appliance', { kind: 'chimney' });
          a.size.w = Math.min(a.size.w, it.w);
          put(a, wall, cursor + (it.w - a.size.w) / 2, a.size.w, 0);
        } else if (it.wall) {
          const wn = makeNode('cabinet', { variant: 'wall', size: { w: it.w }, params: { doors: it.w > 700 ? 2 : 1 } });
          put(wn, wall, cursor, it.w);
        }
      } else {
        const a = makeNode('appliance', { kind: it.appliance, size: { w: it.w } });
        put(a, wall, cursor, it.w);
      }
      cursor += it.w;
    }
    if (cs >= 0) {
      const ct = makeNode('countertop', { size: { w: ce - cs, d: CD + 20 } });
      put(ct, wall, cs, ce - cs, 10);
    }
  };
  const baseItem = (w: number, extra: Partial<RunItem> = {}): RunItem => ({ kind: 'cabinet', variant: 'base', w, wall: true, params: { doors: w > 650 ? 2 : 1 }, ...extra });
  /** Fills a run of exactly `length` mm: sink in the middle, hob (with hood) towards the start, base cabinets elsewhere. */
  const fill = (length: number, withHob: boolean): RunItem[] => {
    let sinkW = 900;
    let hobW = withHob ? 600 : 0;
    let R = length - sinkW - hobW;
    if (R < 0 && hobW) {
      hobW = 0;
      R = length - sinkW;
    }
    if (R < 0) {
      sinkW = Math.max(600, length);
      R = length - sinkW;
    }
    const chunks = R >= 900 ? [Math.floor(R / 3 / 5) * 5, Math.floor(R / 3 / 5) * 5, 0] : R >= 300 ? [0, 0, R] : [0, 0, 0];
    if (R >= 900) chunks[2] = R - chunks[0] - chunks[1];
    else if (R > 0 && R < 300) sinkW += R;
    const items: RunItem[] = [];
    splitWidths(chunks[0]).forEach((w) => items.push(baseItem(w)));
    if (hobW) items.push({ kind: 'cabinet', variant: 'drawer', w: hobW, top: 'hob', hood: true });
    splitWidths(chunks[1]).forEach((w) => items.push(baseItem(w)));
    items.push({ kind: 'cabinet', variant: 'sink', w: sinkW, wall: true, top: 'sink', params: { doors: 2 } });
    splitWidths(chunks[2]).forEach((w) => items.push(baseItem(w)));
    return items;
  };

  if (layout === 'straight' || layout === 'island') {
    const items: RunItem[] = [{ kind: 'cabinet', variant: 'tall', w: 600 }, { kind: 'appliance', appliance: 'fridge', w: 700 }];
    items.push(...fill(W - 1300, true));
    addRun('back', 0, items);
    if (layout === 'island') {
      const iw = Math.max(1200, Math.min(2000, W - 1800));
      const isl = makeNode('cabinet', { variant: 'island', size: { w: iw }, params: { raisedBar: true } });
      const z = CD + 1000 + isl.size.d / 2;
      isl.position = [W / 2, 0, z];
      isl.rotationY = 180;
      if (z + isl.size.d / 2 > D - 700) notes.push('The room is shallow for an island: passage clearance is under 700 mm.');
      nodes.push(isl);
    }
  } else {
    const back: RunItem[] = [{ kind: 'cabinet', variant: 'corner', w: 900 }];
    const u = layout === 'u_shape';
    back.push(...fill(W - 900 - (u ? CD : 700), true));
    if (!u) back.push({ kind: 'appliance', appliance: 'fridge', w: 700 });
    addRun('back', 0, back);
    if (layout === 'l_shape' || u) {
      addRun('left', 900, splitWidths(D - 900).map((w) => ({ kind: 'cabinet', variant: 'drawer', w, wall: true }) as RunItem));
    }
    if (u) {
      const right: RunItem[] = [{ kind: 'appliance', appliance: 'fridge', w: 700 }, ...splitWidths(D - CD - 700).map((w) => baseItem(w))];
      addRun('right', CD, right);
    }
    if (layout === 'parallel') {
      addRun('front', 0, splitWidths(W).map((w, i, a) => (i === Math.floor(a.length / 2) ? ({ kind: 'cabinet', variant: 'drawer', w, top: 'hob' } as RunItem) : baseItem(w))));
      notes.push('Parallel layout: keep 1000-1200 mm between the two runs.');
    }
  }
  return { nodes, notes };
}

export function applyKitchen(doc: SceneDoc, layout: KitchenLayout): SceneDoc {
  resetNameCounters();
  const b = roomBounds(doc.room);
  const { nodes } = generateKitchen(layout, b.maxX - b.minX, b.maxZ - b.minZ);
  const base: SceneDoc = { ...doc, nodes: {}, order: [] };
  let out = base;
  for (const n of nodes) out = addNodeToDoc(out, n);
  return out;
}

/** Re-derives countertops: one slab over every contiguous run of base cabinets/sinks/hobs. */
export function autoCountertops(doc: SceneDoc): SceneDoc {
  const keep = doc.order.filter((id) => doc.nodes[id].type !== 'countertop');
  const nodes: Record<string, SceneNode> = {};
  for (const id of keep) nodes[id] = doc.nodes[id];
  let out: SceneDoc = { ...doc, nodes, order: keep };
  const bases = keep.map((id) => nodes[id]).filter((n) => n.type === 'cabinet' && ['base', 'drawer', 'sink', 'corner'].includes((n.params as unknown as CabinetParams).variant));
  const used = new Set<string>();
  for (const b of bases) {
    if (used.has(b.id)) continue;
    // gather run members with the same rotation, abutting along the facing direction
    const th = (b.rotationY * Math.PI) / 180;
    const dir: Pt = [Math.cos(th), -Math.sin(th)];
    const along = (n: SceneNode) => n.position[0] * dir[0] + n.position[2] * dir[1];
    const perp = (n: SceneNode) => n.position[0] * Math.sin(th) + n.position[2] * Math.cos(th);
    const same = bases.filter((o) => !used.has(o.id) && Math.abs(((o.rotationY - b.rotationY + 540) % 360) - 180) < 1 && Math.abs(perp(o) - o.size.d / 2 - (perp(b) - b.size.d / 2)) < 30);
    same.sort((p, q) => along(p) - along(q));
    const runs: SceneNode[][] = [];
    for (const n of same) {
      const lastRun = runs[runs.length - 1];
      const last = lastRun?.[lastRun.length - 1];
      if (last && along(n) - n.size.w / 2 - (along(last) + last.size.w / 2) < 60) lastRun.push(n);
      else runs.push([n]);
    }
    for (const run of runs) {
      run.forEach((n) => used.add(n.id));
      if (!run.includes(b)) continue;
      const a0 = along(run[0]) - run[0].size.w / 2;
      const a1 = along(run[run.length - 1]) + run[run.length - 1].size.w / 2;
      const depth = Math.max(...run.map((n) => n.size.d)) + 20;
      const ct = makeNode('countertop', { size: { w: a1 - a0, d: depth } });
      const mid = (a0 + a1) / 2;
      const backPerp = perp(run[0]) - run[0].size.d / 2;
      const cPerp = backPerp + depth / 2;
      ct.position = [dir[0] * mid + Math.sin(th) * cPerp, run[0].size.h, dir[1] * mid + Math.cos(th) * cPerp];
      ct.rotationY = b.rotationY;
      out = addNodeToDoc(out, ct);
    }
  }
  return out;
}

export function deepClone<T>(v: T): T {
  return structuredClone(v);
}

export interface StarterOpts {
  layout?: KitchenLayout;
  roomWidth?: number;
  roomDepth?: number;
  roomHeight?: number;
  width?: number;
  height?: number;
  depth?: number;
  empty?: boolean;
  /** start with an empty floor plan (walls, rooms and furniture are drawn in the 2D workspace) */
  floorPlan?: boolean;
}

/** Builds the document a brand-new project starts with. */
export function starterDoc(category: Category, o: StarterOpts = {}): SceneDoc {
  resetNameCounters(); // names are numbered per project, never across requests
  let doc = defaultDoc(category);
  if (o.floorPlan) return { ...doc, plan: makePlan(true) };
  if (o.roomWidth || o.roomDepth || o.roomHeight) {
    const prev = roomBounds(doc.room);
    doc = { ...doc, room: { ...roomFromRect(o.roomWidth ?? prev.maxX, o.roomDepth ?? prev.maxZ, o.roomHeight ?? doc.room.height) } };
  }
  const b = roomBounds(doc.room);
  const W = b.maxX - b.minX;
  if (o.empty) return doc;
  if (category === 'WARDROBE') {
    const w = o.width ?? Math.min(2400, W - 200);
    const node = makeNode('wardrobe', { size: { w, h: o.height ?? Math.min(2400, doc.room.height - 100), d: o.depth ?? 600 } });
    node.position = [W / 2, 0, node.size.d / 2];
    doc = addNodeToDoc(doc, node);
  } else if (category === 'KITCHEN') {
    doc = applyKitchen(doc, o.layout ?? 'l_shape');
  } else if (category === 'TV_PANEL') {
    const w = o.width ?? Math.min(3200, W - 300);
    const node = makeNode('tv_panel', { size: { w, h: o.height ?? Math.min(2700, doc.room.height - 100), d: o.depth ?? 450 } });
    const p = node.params as { unit: { width: number }; sides: { left: { width: number }; right: { width: number } } };
    p.unit.width = Math.max(600, w - p.sides.left.width - p.sides.right.width - 40);
    node.position = [W / 2, 0, node.size.d / 2];
    doc = addNodeToDoc(doc, node);
  }
  return doc;
}
