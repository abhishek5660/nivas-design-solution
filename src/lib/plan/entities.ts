import { add, arcFrom3, arcPoints, boundsOf, boxInside, boxesOverlap, circlePoints, dist, mid, mul, pointInPolygon, pointSegment, rotatePt, scalePt, mirrorPt, segIntersectsBox, sub, unionBox, type Box } from './geom';
import { openingSegment, pointAtOffset, wallDir, wallGeometries, floorWalls, wallNormal } from './walls';
import type { Entity, Floor, Pt, WallE } from './types';

export const isClosedShape = (e: Entity) => e.kind === 'rect' || e.kind === 'polygon' || e.kind === 'circle' || (e.kind === 'polyline' && e.closed);

export function rectCorners(p1: Pt, p2: Pt): Pt[] {
  return [[p1[0], p1[1]], [p2[0], p1[1]], [p2[0], p2[1]], [p1[0], p2[1]]];
}

export function columnCorners(e: { c: Pt; width: number; depth: number; rot: number }): Pt[] {
  const h = [e.width / 2, e.depth / 2];
  const pts: Pt[] = [[-h[0], -h[1]], [h[0], -h[1]], [h[0], h[1]], [-h[0], h[1]]];
  return pts.map((p) => rotatePt(add(e.c, p), e.rot, e.c));
}

export function stairsOutline(e: { origin: Pt; rot: number; width: number; steps: number; tread: number }): Pt[] {
  const run = e.steps * e.tread;
  const pts: Pt[] = [[0, 0], [run, 0], [run, e.width], [0, e.width]];
  return pts.map((p) => rotatePt(add(e.origin, p), e.rot, e.origin));
}

export function modelCorners(e: { pos: Pt; rot: number; size: { w: number; d: number } }): Pt[] {
  const hw = e.size.w / 2;
  const hd = e.size.d / 2;
  return ([[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]] as Pt[]).map((p) => rotatePt(add(e.pos, p), e.rot, e.pos));
}

export function referenceCorners(e: { pos: Pt; width: number; height: number; rot: number }): Pt[] {
  const hw = e.width / 2;
  const hh = e.height / 2;
  return ([[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]] as Pt[]).map((p) => rotatePt(add(e.pos, p), e.rot, e.pos));
}

/** Resolve a dimension/radial reference to a point. */
export function resolveRef(floor: Floor, ref: { id: string; handle: string } | undefined): Pt | null {
  if (!ref) return null;
  const e = floor.entities[ref.id];
  if (!e) return null;
  return handlePoint(floor, e, ref.handle);
}

export function handlePoint(floor: Floor, e: Entity, handle: string): Pt | null {
  const hs = entityHandles(floor, e);
  return hs.find((h) => h.id === handle)?.p ?? null;
}

export interface Handle {
  id: string;
  p: Pt;
}

/** Grip points of an entity (used for editing and for linked dimensions). */
export function entityHandles(floor: Floor, e: Entity): Handle[] {
  switch (e.kind) {
    case 'line':
    case 'arrow':
    case 'guide':
    case 'wall':
    case 'beam':
    case 'strip':
      return [{ id: 'a', p: e.a }, { id: 'b', p: e.b }];
    case 'polyline':
    case 'polygon':
    case 'railing':
    case 'roof':
      return e.pts.map((p, i) => ({ id: `v${i}`, p }));
    case 'leader':
      return e.pts.map((p, i) => ({ id: `v${i}`, p }));
    case 'arc':
      return [{ id: 'p1', p: e.p1 }, { id: 'p2', p: e.p2 }, { id: 'p3', p: e.p3 }];
    case 'circle':
      return [{ id: 'c', p: e.c }, { id: 'r', p: [e.c[0] + e.r, e.c[1]] }];
    case 'rect':
      return rectCorners(e.p1, e.p2).map((p, i) => ({ id: `c${i}`, p }));
    case 'column':
      return [{ id: 'c', p: e.c }, ...columnCorners(e).map((p, i) => ({ id: `c${i}`, p }))];
    case 'stairs':
      return [{ id: 'o', p: e.origin }];
    case 'door':
    case 'window': {
      const s = openingSegment(floor, e);
      return s ? [{ id: 'a', p: s.a }, { id: 'b', p: s.b }, { id: 'm', p: mid(s.a, s.b) }] : [];
    }
    case 'dimension':
      return [{ id: 'a', p: e.a }, { id: 'b', p: e.b }];
    case 'angle':
      return [{ id: 'v', p: e.v }, { id: 'a', p: e.a }, { id: 'b', p: e.b }];
    case 'text':
    case 'compass':
    case 'xy':
    case 'light':
    case 'model':
    case 'reference':
      return [{ id: 'pos', p: 'pos' in e ? e.pos : [0, 0] }];
    default:
      return [];
  }
}

/** Polylines that approximate the entity outline (for hit tests, snapping, trim/extend boundaries). */
export function entityPaths(floor: Floor, e: Entity): { pts: Pt[]; closed: boolean }[] {
  switch (e.kind) {
    case 'line':
    case 'arrow':
    case 'guide':
      return [{ pts: [e.a, e.b], closed: false }];
    case 'wall':
    case 'beam':
    case 'strip':
      return [{ pts: [e.a, e.b], closed: false }];
    case 'polyline':
      return [{ pts: e.pts, closed: e.closed }];
    case 'polygon':
      return [{ pts: e.pts, closed: true }];
    case 'railing':
      return [{ pts: e.pts, closed: false }];
    case 'roof':
      return [{ pts: e.pts, closed: true }];
    case 'rect':
      return [{ pts: rectCorners(e.p1, e.p2), closed: true }];
    case 'circle':
      return [{ pts: circlePoints(e.c, e.r), closed: true }];
    case 'arc': {
      const g = arcFrom3(e.p1, e.p2, e.p3);
      return [{ pts: g ? arcPoints(g) : [e.p1, e.p2, e.p3], closed: false }];
    }
    case 'column':
      return [{ pts: e.shape === 'round' ? circlePoints(e.c, e.width / 2, 24) : columnCorners(e), closed: true }];
    case 'stairs':
      return [{ pts: stairsOutline(e), closed: true }];
    case 'door':
    case 'window': {
      const s = openingSegment(floor, e);
      return s ? [{ pts: [s.a, s.b], closed: false }] : [];
    }
    case 'dimension':
      return [{ pts: [e.a, e.b], closed: false }];
    case 'angle':
      return [{ pts: [e.a, e.v, e.b], closed: false }];
    case 'leader':
      return [{ pts: e.pts, closed: false }];
    case 'model':
      return [{ pts: modelCorners(e), closed: true }];
    case 'reference':
      return [{ pts: referenceCorners(e), closed: true }];
    case 'text': {
      const w = e.text.length * e.size * 0.6;
      const c = ([[0, -e.size], [w, -e.size], [w, 0], [0, 0]] as Pt[]).map((p) => rotatePt(add(e.pos, p), e.rot, e.pos));
      return [{ pts: c, closed: true }];
    }
    case 'compass':
      return [{ pts: circlePoints(e.pos, e.size / 2, 24), closed: true }];
    case 'light':
      return [{ pts: circlePoints(e.pos, 150, 12), closed: true }];
    case 'xy':
      return [{ pts: circlePoints(e.pos, 60, 8), closed: true }];
    default:
      return [];
  }
}

export function entityBounds(floor: Floor, e: Entity): Box | null {
  if (e.kind === 'wall') {
    const g = wallGeometries(floorWalls(floor)).find((x) => x.wall.id === e.id);
    if (g) return boundsOf(g.outline);
  }
  if (e.kind === 'door' || e.kind === 'window') {
    const s = openingSegment(floor, e);
    if (!s) return null;
    const n = mul(wallNormal(s.wall), s.wall.thickness / 2);
    return boundsOf([add(s.a, n), sub(s.a, n), add(s.b, n), sub(s.b, n)]);
  }
  let box: Box | null = null;
  for (const p of entityPaths(floor, e)) box = unionBox(box, boundsOf(p.pts));
  if (e.kind === 'strip' || e.kind === 'beam') {
    const pad = ('width' in e ? e.width : 40) / 2;
    if (box) box = { minX: box.minX - pad, minY: box.minY - pad, maxX: box.maxX + pad, maxY: box.maxY + pad };
  }
  if (e.kind === 'dimension' && box) {
    const n = wallNormalOf(e.a, e.b);
    const o = mul(n, e.offset);
    box = unionBox(box, boundsOf([add(e.a, o), add(e.b, o)]));
  }
  return box;
}

const wallNormalOf = (a: Pt, b: Pt): Pt => {
  const d = sub(b, a);
  const l = Math.hypot(d[0], d[1]) || 1;
  return [-d[1] / l, d[0] / l];
};

export function floorBounds(floor: Floor, ids?: string[]): Box | null {
  let box: Box | null = null;
  for (const id of ids ?? floor.order) {
    const e = floor.entities[id];
    if (e && !e.hidden) box = unionBox(box, entityBounds(floor, e));
  }
  return box;
}

/** Distance from p to the entity (0 when inside a closed or filled shape). Infinity if the entity has no geometry. */
export function entityDistance(floor: Floor, e: Entity, p: Pt): number {
  if (e.kind === 'wall') {
    const g = wallGeometries(floorWalls(floor)).find((x) => x.wall.id === e.id);
    if (g && pointInPolygon(p, g.outline)) return 0;
  }
  if (e.kind === 'door' || e.kind === 'window') {
    const s = openingSegment(floor, e);
    if (!s) return Infinity;
    return pointSegment(p, s.a, s.b).d - s.wall.thickness / 2 > 0 ? pointSegment(p, s.a, s.b).d - s.wall.thickness / 2 : 0;
  }
  if (e.kind === 'column' || e.kind === 'stairs' || e.kind === 'model' || e.kind === 'text' || e.kind === 'reference') {
    const path = entityPaths(floor, e)[0];
    if (path && pointInPolygon(p, path.pts)) return 0;
  }
  if (e.kind === 'beam' || e.kind === 'strip') {
    const w = ('width' in e ? e.width : 40) / 2;
    return Math.max(0, pointSegment(p, e.a, e.b).d - w);
  }
  let best = Infinity;
  for (const path of entityPaths(floor, e)) {
    const n = path.pts.length;
    for (let i = 0; i < n - (path.closed ? 0 : 1); i++) best = Math.min(best, pointSegment(p, path.pts[i], path.pts[(i + 1) % n]).d);
    if (path.pts.length === 1) best = Math.min(best, dist(p, path.pts[0]));
  }
  return best;
}

export function entityHit(floor: Floor, e: Entity, p: Pt, tol: number): boolean {
  if (e.kind === 'hatch' || e.kind === 'tiling' || e.kind === 'slab' || e.kind === 'ceiling') return false; // surfaces are selected via the room / properties
  return entityDistance(floor, e, p) <= tol;
}

/** Window (fully inside) or crossing (touching) selection. */
export function entityInBox(floor: Floor, e: Entity, box: Box, crossing: boolean): boolean {
  const b = entityBounds(floor, e);
  if (!b) return false;
  if (!crossing) return boxInside(b, box);
  if (!boxesOverlap(b, box)) return false;
  for (const path of entityPaths(floor, e)) {
    const n = path.pts.length;
    for (let i = 0; i < n - (path.closed ? 0 : 1); i++) if (segIntersectsBox(path.pts[i], path.pts[(i + 1) % n], box)) return true;
    if (path.closed && path.pts.some((p) => p[0] >= box.minX && p[0] <= box.maxX && p[1] >= box.minY && p[1] <= box.maxY)) return true;
  }
  // box fully inside a closed shape
  return false;
}

/** Special points for object snapping: end points, mid points, centres. */
export function entitySnapPoints(floor: Floor, e: Entity): { p: Pt; kind: 'endpoint' | 'midpoint' | 'center' }[] {
  const out: { p: Pt; kind: 'endpoint' | 'midpoint' | 'center' }[] = [];
  if (e.kind === 'door' || e.kind === 'window' || e.kind === 'dimension' || e.kind === 'hatch' || e.kind === 'tiling' || e.kind === 'slab' || e.kind === 'ceiling') return out;
  if (e.kind === 'circle') {
    out.push({ p: e.c, kind: 'center' });
    for (const a of [0, 90, 180, 270]) out.push({ p: rotatePt([e.c[0] + e.r, e.c[1]], a, e.c), kind: 'endpoint' });
    return out;
  }
  if (e.kind === 'arc') {
    const g = arcFrom3(e.p1, e.p2, e.p3);
    out.push({ p: e.p1, kind: 'endpoint' }, { p: e.p3, kind: 'endpoint' }, { p: e.p2, kind: 'midpoint' });
    if (g) out.push({ p: g.c, kind: 'center' });
    return out;
  }
  const paths = entityPaths(floor, e);
  if (e.kind === 'column' || e.kind === 'model' || e.kind === 'stairs') {
    for (const pth of paths) for (const p of pth.pts.slice(0, e.kind === 'column' && e.shape === 'round' ? 0 : 4)) out.push({ p, kind: 'endpoint' });
    if (e.kind === 'column') out.push({ p: e.c, kind: 'center' });
    return out;
  }
  for (const pth of paths) {
    const n = pth.pts.length;
    pth.pts.forEach((p) => out.push({ p, kind: 'endpoint' }));
    for (let i = 0; i < n - (pth.closed ? 0 : 1); i++) out.push({ p: mid(pth.pts[i], pth.pts[(i + 1) % n]), kind: 'midpoint' });
  }
  if (e.kind === 'wall') {
    // wall faces are snappable too (outer corners)
    const g = wallGeometries(floorWalls(floor)).find((x) => x.wall.id === e.id);
    if (g) g.outline.forEach((p) => out.push({ p, kind: 'endpoint' }));
  }
  return out;
}

// ---------- transforms ----------

/** Apply a point mapping to every coordinate of an entity (geometry only). */
export function mapEntityPoints<T extends Entity>(e: T, f: (p: Pt) => Pt): T {
  const m = (p: Pt) => f(p);
  const c: Entity = { ...e };
  switch (c.kind) {
    case 'line':
    case 'arrow':
    case 'guide':
    case 'wall':
    case 'beam':
    case 'strip':
    case 'dimension':
      c.a = m(c.a);
      c.b = m(c.b);
      break;
    case 'polyline':
    case 'polygon':
    case 'railing':
    case 'roof':
    case 'leader':
      c.pts = c.pts.map(m);
      break;
    case 'arc':
      c.p1 = m(c.p1);
      c.p2 = m(c.p2);
      c.p3 = m(c.p3);
      break;
    case 'circle':
      c.c = m(c.c);
      break;
    case 'rect':
      c.p1 = m(c.p1);
      c.p2 = m(c.p2);
      break;
    case 'column':
      c.c = m(c.c);
      break;
    case 'stairs':
      c.origin = m(c.origin);
      break;
    case 'angle':
      c.v = m(c.v);
      c.a = m(c.a);
      c.b = m(c.b);
      break;
    case 'slab':
    case 'ceiling':
    case 'tiling':
      c.anchor = m(c.anchor);
      if (c.kind === 'slab' && c.pts) c.pts = c.pts.map(m);
      break;
    case 'hatch':
      if (c.boundary.kind === 'room') c.boundary = { kind: 'room', at: m(c.boundary.at) };
      if (c.boundary.kind === 'pts') c.boundary = { kind: 'pts', pts: c.boundary.pts.map(m) };
      break;
    case 'text':
    case 'compass':
    case 'xy':
    case 'light':
    case 'model':
    case 'reference':
      c.pos = m(c.pos);
      break;
    default:
      break;
  }
  return c as T;
}

export function translateEntity<T extends Entity>(e: T, d: Pt): T {
  return mapEntityPoints(e, (p) => add(p, d));
}

/** Rotates around `origin`. Axis-aligned rectangles stay rectangles for multiples of 90 degrees, otherwise become polygons. */
export function rotateEntity(e: Entity, angle: number, origin: Pt): Entity {
  if (e.kind === 'rect') {
    const quarter = Math.abs(((angle % 90) + 90) % 90) < 1e-9 || Math.abs((((angle % 90) + 90) % 90) - 90) < 1e-9;
    if (!quarter) return { id: e.id, kind: 'polygon', pts: rectCorners(e.p1, e.p2).map((p) => rotatePt(p, angle, origin)), locked: e.locked, hidden: e.hidden };
  }
  const turned = mapEntityPoints(e, (p) => rotatePt(p, angle, origin));
  if (turned.kind === 'column' && e.kind === 'column') turned.rot = e.rot + angle;
  if (turned.kind === 'stairs' && e.kind === 'stairs') turned.rot = e.rot + angle;
  if (turned.kind === 'model' && e.kind === 'model') turned.rot = e.rot + angle;
  if (turned.kind === 'reference' && e.kind === 'reference') turned.rot = e.rot + angle;
  if (turned.kind === 'text' && e.kind === 'text') turned.rot = e.rot + angle;
  if (turned.kind === 'hatch' && e.kind === 'hatch') turned.angle = e.angle + angle;
  if (turned.kind === 'compass' && e.kind === 'compass') turned.north = e.north + angle;
  return turned;
}

export function mirrorEntity(e: Entity, a: Pt, b: Pt): Entity {
  const m = mapEntityPoints(e, (p) => mirrorPt(p, a, b));
  if (e.kind === 'arc' && m.kind === 'arc') return { ...m, p1: m.p3, p3: m.p1 }; // keep arc orientation sensible
  if (e.kind === 'rect' && m.kind === 'rect') return m; // mirrored axis-aligned rect remains axis-aligned only for axis-aligned mirror lines
  if (e.kind === 'column' && m.kind === 'column') {
    const axis = Math.atan2(b[1] - a[1], b[0] - a[0]) * (180 / Math.PI);
    return { ...m, rot: 2 * axis - e.rot };
  }
  if ((e.kind === 'stairs' || e.kind === 'model') && (m.kind === 'stairs' || m.kind === 'model')) {
    const axis = Math.atan2(b[1] - a[1], b[0] - a[0]) * (180 / Math.PI);
    return { ...m, rot: 2 * axis - e.rot };
  }
  return m;
}

export function scaleEntity(e: Entity, base: Pt, k: number): Entity {
  const m = mapEntityPoints(e, (p) => scalePt(p, base, k));
  if (m.kind === 'circle' && e.kind === 'circle') m.r = e.r * k;
  if (m.kind === 'column' && e.kind === 'column') {
    m.width = e.width * k;
    m.depth = e.depth * k;
  }
  if (m.kind === 'stairs' && e.kind === 'stairs') {
    m.width = e.width * k;
    m.tread = e.tread * k;
  }
  if (m.kind === 'text' && e.kind === 'text') m.size = e.size * k;
  if (m.kind === 'model' && e.kind === 'model') m.size = { w: e.size.w * k, d: e.size.d * k, h: e.size.h * k };
  if (m.kind === 'reference' && e.kind === 'reference') {
    m.width = e.width * k;
    m.height = e.height * k;
  }
  if (m.kind === 'hatch' && e.kind === 'hatch') m.scale = e.scale * k;
  return m;
}

export const entityLabel = (e: Entity): string =>
  ({ line: 'Line', polyline: 'Polyline', arc: 'Arc', circle: 'Circle', rect: 'Rectangle', polygon: 'Polygon', arrow: 'Arrow', hatch: 'Hatch', guide: 'Construction line', wall: 'Wall', door: 'Door', window: 'Window', column: 'Column', beam: 'Beam', slab: 'Slab', ceiling: 'Ceiling', tiling: 'Tiling', stairs: 'Stairs', railing: 'Railing', roof: 'Roof', light: 'Light', strip: 'Strip light', model: '3D model', reference: 'Reference', dimension: 'Dimension', text: 'Text', compass: 'Compass', angle: 'Angle', xy: 'XY', radial: 'Radial', leader: 'MultiLeader' })[e.kind];

export { pointAtOffset, wallDir };

/** The entity grip located at a point (used to link dimensions to real geometry). */
export function findHandleAt(floor: Floor, pt: Pt, tol = 0.75): { id: string; handle: string } | null {
  for (const id of floor.order) {
    const e = floor.entities[id];
    if (!e || e.hidden || e.kind === 'dimension' || e.kind === 'door' || e.kind === 'window') continue;
    for (const h of entityHandles(floor, e)) if (Math.hypot(h.p[0] - pt[0], h.p[1] - pt[1]) <= tol) return { id, handle: h.id };
  }
  return null;
}
