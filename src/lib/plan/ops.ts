import { add, arcFrom3, arcPoints, dist, lerp, mul, norm, perp, pointSegment, rayIntersect, rotatePt, round, same, segIntersect, sub, lineIntersect, dot, angleOf, type Hit } from './geom';
import { insetPolygon } from './rooms';
import { addEntities, removeEntities } from './model';
import { entityPaths, mapEntityPoints, mirrorEntity, rectCorners, rotateEntity, scaleEntity, translateEntity } from './entities';
import { floorWalls, isOpening, newId, normalizeWalls, wallLen } from './walls';
import type { ComponentDef, Entity, Floor, PolylineE, Pt, WallE } from './types';

export type OpResult<T = Floor> = { ok: true; value: T; message?: string } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

// ---------- helpers ----------

export const cloneWithId = <T extends Entity>(e: T, id = newId(e.kind)): T => ({ ...structuredClone(e), id });

/** Entities that must travel with the selection (doors/windows follow their walls, group members follow each other). */
export function expandSelection(f: Floor, ids: string[]): string[] {
  const out = new Set(ids);
  for (const id of ids) {
    const e = f.entities[id];
    if (e?.group) for (const o of Object.values(f.entities)) if (o.group === e.group) out.add(o.id);
  }
  for (const e of Object.values(f.entities)) if (isOpening(e) && out.has(e.wall)) out.add(e.id);
  return [...out].filter((i) => !!f.entities[i]);
}

function replace(f: Floor, es: Entity[]): Floor {
  const entities = { ...f.entities };
  for (const e of es) entities[e.id] = e;
  return { ...f, entities };
}

// ---------- transforms ----------

export function moveEntities(f: Floor, ids: string[], d: Pt): Floor {
  const sel = expandSelection(f, ids);
  const moved = sel.map((id) => f.entities[id]).filter((e) => !isOpening(e)).map((e) => translateEntity(e, d));
  return replace(f, moved);
}

export function rotateEntities(f: Floor, ids: string[], angle: number, origin: Pt): Floor {
  const sel = expandSelection(f, ids);
  return replace(f, sel.map((id) => f.entities[id]).filter((e) => !isOpening(e)).map((e) => rotateEntity(e, angle, origin)));
}

export function scaleEntities(f: Floor, ids: string[], base: Pt, k: number): OpResult {
  if (!(k > 0) || !Number.isFinite(k)) return fail('Scale factor must be a positive number.');
  const sel = expandSelection(f, ids);
  const out: Entity[] = [];
  for (const id of sel) {
    const e = f.entities[id];
    if (isOpening(e)) out.push({ ...e, offset: e.offset * k });
    else out.push(scaleEntity(e, base, k));
  }
  return { ok: true, value: replace(f, out) };
}

/** Copies the selection (optionally translated). Doors/windows travel with copied walls. */
export function copyEntities(f: Floor, ids: string[], d: Pt, transform?: (e: Entity) => Entity): { floor: Floor; newIds: string[]; idMap: Map<string, string> } {
  const sel = expandSelection(f, ids);
  const idMap = new Map<string, string>();
  for (const id of sel) idMap.set(id, newId(f.entities[id].kind));
  const group = new Map<string, string>();
  const copies: Entity[] = [];
  for (const id of sel) {
    let e: Entity = structuredClone(f.entities[id]);
    e.id = idMap.get(id)!;
    if (e.group) {
      if (!group.has(e.group)) group.set(e.group, newId('grp'));
      e.group = group.get(e.group);
    }
    if (isOpening(e)) e = { ...e, wall: idMap.get(e.wall) ?? e.wall };
    else e = transform ? transform(e) : translateEntity(e, d);
    if (e.kind === 'radial') e = { ...e, target: idMap.get(e.target) ?? e.target };
    copies.push(e);
  }
  return { floor: addEntities(f, copies), newIds: copies.map((c) => c.id), idMap };
}

export function mirrorEntities(f: Floor, ids: string[], a: Pt, b: Pt, keepOriginal: boolean): OpResult<{ floor: Floor; newIds: string[] }> {
  if (same(a, b)) return fail('Pick two different points for the mirror axis.');
  const flipOpening = (e: Entity): Entity => (e.kind === 'door' ? { ...e, opens: e.opens === 'in' ? 'out' : 'in' } : e);
  if (keepOriginal) {
    const r = copyEntities(f, ids, [0, 0], (e) => mirrorEntity(e, a, b));
    const entities = { ...r.floor.entities };
    for (const nid of r.newIds) entities[nid] = flipOpening(entities[nid]);
    return { ok: true, value: { floor: normalizeWalls({ ...r.floor, entities }), newIds: r.newIds } };
  }
  const sel = expandSelection(f, ids);
  const out: Entity[] = sel.map((id) => f.entities[id]).map((e) => (isOpening(e) ? flipOpening(e) : mirrorEntity(e, a, b)));
  return { ok: true, value: { floor: replace(f, out), newIds: sel } };
}

// ---------- offset ----------

export function offsetEntity(f: Floor, id: string, distance: number, side: Pt): OpResult<Entity> {
  const e = f.entities[id];
  if (!e) return fail('Nothing to offset.');
  if (!(distance > 0)) return fail('Offset distance must be greater than zero.');
  const newE = (patch: Partial<Entity>): Entity => ({ ...structuredClone(e), ...patch, id: newId(e.kind), group: undefined } as Entity);
  if (e.kind === 'line' || e.kind === 'wall' || e.kind === 'beam' || e.kind === 'arrow' || e.kind === 'strip') {
    const n = perp(norm(sub(e.b, e.a)));
    const sgn = dot(sub(side, e.a), n) >= 0 ? 1 : -1;
    const o = mul(n, sgn * distance);
    return { ok: true, value: newE({ a: add(e.a, o), b: add(e.b, o) } as Partial<Entity>) };
  }
  if (e.kind === 'circle') {
    const inside = dist(side, e.c) < e.r;
    const r = inside ? e.r - distance : e.r + distance;
    if (r <= 0) return fail('The offset would collapse the circle.');
    return { ok: true, value: newE({ r } as Partial<Entity>) };
  }
  if (e.kind === 'arc') {
    const g = arcFrom3(e.p1, e.p2, e.p3);
    if (!g) return fail('Degenerate arc.');
    const inside = dist(side, g.c) < g.r;
    const r = inside ? g.r - distance : g.r + distance;
    if (r <= 0) return fail('The offset would collapse the arc.');
    const k = r / g.r;
    const mv = (p: Pt): Pt => [g.c[0] + (p[0] - g.c[0]) * k, g.c[1] + (p[1] - g.c[1]) * k];
    return { ok: true, value: newE({ p1: mv(e.p1), p2: mv(e.p2), p3: mv(e.p3) } as Partial<Entity>) };
  }
  if (e.kind === 'rect') {
    const [x0, x1] = [Math.min(e.p1[0], e.p2[0]), Math.max(e.p1[0], e.p2[0])];
    const [y0, y1] = [Math.min(e.p1[1], e.p2[1]), Math.max(e.p1[1], e.p2[1])];
    const inside = side[0] > x0 && side[0] < x1 && side[1] > y0 && side[1] < y1;
    const d = inside ? -distance : distance;
    if (x1 - x0 + 2 * d <= 0 || y1 - y0 + 2 * d <= 0) return fail('The offset would collapse the rectangle.');
    return { ok: true, value: newE({ p1: [x0 - d, y0 - d], p2: [x1 + d, y1 + d] } as Partial<Entity>) };
  }
  if (e.kind === 'polygon' || (e.kind === 'polyline' && e.closed)) {
    let pts = e.pts;
    // work on a counter-clockwise copy
    let area = 0;
    for (let i = 0; i < pts.length; i++) area += pts[i][0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * pts[i][1];
    if (area < 0) pts = [...pts].reverse();
    const inside = pointInside(side, pts);
    const d = inside ? distance : -distance; // inset for inside
    const out = insetPolygon(pts, pts.map(() => d));
    return { ok: true, value: newE({ pts: out } as Partial<Entity>) };
  }
  if (e.kind === 'polyline') {
    // offset an open polyline to the side of the pick point, using miter joins
    const pts = e.pts;
    if (pts.length < 2) return fail('Polyline needs at least two points.');
    const near = nearestSegment(pts, side);
    const n = perp(norm(sub(pts[near + 1], pts[near])));
    const sgn = dot(sub(side, pts[near]), n) >= 0 ? 1 : -1;
    const off: Pt[] = [];
    for (let i = 0; i < pts.length; i++) {
      const dPrev = i > 0 ? norm(sub(pts[i], pts[i - 1])) : null;
      const dNext = i < pts.length - 1 ? norm(sub(pts[i + 1], pts[i])) : null;
      const n1 = dPrev ? perp(dPrev) : perp(dNext!);
      const n2 = dNext ? perp(dNext) : n1;
      if (!dPrev || !dNext) off.push(add(pts[i], mul(dPrev ? n1 : n2, sgn * distance)));
      else {
        const a1 = add(pts[i - 1], mul(n1, sgn * distance));
        const a2 = add(pts[i], mul(n1, sgn * distance));
        const b1 = add(pts[i], mul(n2, sgn * distance));
        const b2 = add(pts[i + 1], mul(n2, sgn * distance));
        off.push(lineIntersect(a1, a2, b1, b2) ?? a2);
      }
    }
    return { ok: true, value: newE({ pts: off } as Partial<Entity>) };
  }
  return fail('Offset works on lines, polylines, arcs, circles, rectangles, polygons and walls.');
}

const pointInside = (p: Pt, pts: Pt[]) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    if (pts[i][1] > p[1] !== pts[j][1] > p[1] && p[0] < ((pts[j][0] - pts[i][0]) * (p[1] - pts[i][1])) / (pts[j][1] - pts[i][1]) + pts[i][0]) inside = !inside;
  }
  return inside;
};

function nearestSegment(pts: Pt[], p: Pt): number {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = pointSegment(p, pts[i], pts[i + 1]).d;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

// ---------- trim / extend ----------

const BOUNDARY_SKIP = new Set(['dimension', 'text', 'compass', 'angle', 'xy', 'radial', 'leader', 'hatch', 'tiling', 'slab', 'ceiling', 'door', 'window', 'reference', 'light']);

function boundarySegments(f: Floor, excludeId: string, only?: string[]): { a: Pt; b: Pt }[] {
  const segs: { a: Pt; b: Pt }[] = [];
  for (const id of only ?? f.order) {
    if (id === excludeId) continue;
    const e = f.entities[id];
    if (!e || e.hidden || BOUNDARY_SKIP.has(e.kind)) continue;
    for (const p of entityPaths(f, e)) {
      const n = p.pts.length;
      for (let i = 0; i < n - (p.closed ? 0 : 1); i++) segs.push({ a: p.pts[i], b: p.pts[(i + 1) % n] });
    }
  }
  return segs;
}

/** Re-attaches doors/windows of `wallId` after it has been cut: pieces map to [from,to] distances along the original wall. */
function cutWall(f: Floor, wall: WallE, keep: [number, number][]): Floor {
  const L = wallLen(wall);
  const d = norm(sub(wall.b, wall.a));
  let out = f;
  const entities = { ...out.entities };
  const order = [...out.order];
  const pieces: { id: string; from: number; to: number }[] = [];
  keep.forEach(([from, to], i) => {
    const pid = i === 0 ? wall.id : newId('wall');
    entities[pid] = { ...wall, id: pid, a: round2(add(wall.a, mul(d, from))), b: round2(add(wall.a, mul(d, to))) };
    if (i > 0) order.splice(order.indexOf(wall.id) + i, 0, pid);
    pieces.push({ id: pid, from, to });
  });
  if (!keep.length) {
    delete entities[wall.id];
    order.splice(order.indexOf(wall.id), 1);
  }
  for (const e of Object.values(f.entities)) {
    if (!isOpening(e) || e.wall !== wall.id) continue;
    const c = e.offset + e.width / 2;
    const p = pieces.find((x) => c >= x.from && c <= x.to);
    if (!p || e.offset < p.from - 1e-6 || e.offset + e.width > p.to + 1e-6) {
      delete entities[e.id];
      const k = order.indexOf(e.id);
      if (k >= 0) order.splice(k, 1);
    } else entities[e.id] = { ...e, wall: p.id, offset: e.offset - p.from };
  }
  out = { ...out, entities, order };
  void L;
  return out;
}
const round2 = (p: Pt): Pt => [round(p[0], 3), round(p[1], 3)];

export function trimEntity(f: Floor, targetId: string, click: Pt, boundaryIds?: string[]): OpResult {
  const e = f.entities[targetId];
  if (!e) return fail('Nothing to trim.');
  if (e.kind !== 'line' && e.kind !== 'wall' && e.kind !== 'polyline' && e.kind !== 'arrow' && e.kind !== 'beam') {
    return fail('Trim works on lines, walls, beams and open polylines. Select one of those.');
  }
  if (e.kind === 'polyline' && e.closed) return fail('Open the polyline first - trim works on open polylines.');
  const segs = boundarySegments(f, targetId, boundaryIds);
  if (e.kind === 'polyline') {
    const i = nearestSegment(e.pts, click);
    const a = e.pts[i];
    const b = e.pts[i + 1];
    const ts = segs.map((s) => segIntersect(a, b, s.a, s.b, false)).filter((h): h is Hit => !!h).map((h) => h.t).sort((x, y) => x - y);
    if (!ts.length) return fail('No boundary crosses this segment, so there is nothing to trim.');
    const tc = pointSegment(click, a, b).t;
    const lo = [...ts].reverse().find((t) => t <= tc) ?? 0;
    const hi = ts.find((t) => t > tc) ?? 1;
    const pLo = lerp(a, b, lo);
    const pHi = lerp(a, b, hi);
    const left: Pt[] = [...e.pts.slice(0, i + 1)];
    if (lo > 1e-9) left.push(pLo);
    const right: Pt[] = [];
    if (hi < 1 - 1e-9) right.push(pHi);
    right.push(...e.pts.slice(i + 1));
    const pieces: PolylineE[] = [];
    if (left.length >= 2) pieces.push({ ...e, pts: left });
    if (right.length >= 2) pieces.push({ ...e, id: newId('polyline'), pts: right });
    let out = removeEntities(f, [targetId]);
    out = addEntities(out, pieces);
    return { ok: true, value: out };
  }
  const L = dist(e.a, e.b);
  const hits = segs.map((s) => segIntersect(e.a, e.b, s.a, s.b, false)).filter((h): h is Hit => !!h).map((h) => h.t).filter((t) => t > 1e-6 && t < 1 - 1e-6).sort((x, y) => x - y);
  if (!hits.length) return fail('No boundary crosses this object, so there is nothing to trim.');
  const tc = pointSegment(click, e.a, e.b).t;
  const lo = [...hits].reverse().find((t) => t <= tc) ?? 0;
  const hi = hits.find((t) => t > tc) ?? 1;
  const keep: [number, number][] = [];
  if (lo > 1e-9) keep.push([0, lo * L]);
  if (hi < 1 - 1e-9) keep.push([hi * L, L]);
  if (e.kind === 'wall') return { ok: true, value: cutWall(f, e, keep) };
  let out = removeEntities(f, [targetId]);
  const d = norm(sub(e.b, e.a));
  const pieces = keep.map(([from, to]) => ({ ...e, id: newId(e.kind), a: round2(add(e.a, mul(d, from))), b: round2(add(e.a, mul(d, to))) }) as Entity);
  out = addEntities(out, pieces);
  return { ok: true, value: out };
}

export function extendEntity(f: Floor, targetId: string, click: Pt, boundaryIds?: string[]): OpResult {
  const e = f.entities[targetId];
  if (!e) return fail('Nothing to extend.');
  if (e.kind !== 'line' && e.kind !== 'wall' && e.kind !== 'beam' && e.kind !== 'arrow' && e.kind !== 'polyline') return fail('Extend works on lines, walls, beams and open polylines.');
  if (e.kind === 'polyline' && e.closed) return fail('A closed polyline has no ends to extend.');
  const pts = e.kind === 'polyline' ? e.pts : [e.a, e.b];
  const nearFirst = dist(click, pts[0]) <= dist(click, pts[pts.length - 1]);
  const end = nearFirst ? pts[0] : pts[pts.length - 1];
  const prev = nearFirst ? pts[1] : pts[pts.length - 2];
  const dir = norm(sub(end, prev));
  const segs = boundarySegments(f, targetId, boundaryIds);
  let best: { pt: Pt; t: number } | null = null;
  for (const s of segs) {
    const h = rayIntersect(end, dir, s.a, s.b);
    if (h && h.t > 1e-6 && (!best || h.t < best.t)) best = h;
  }
  if (!best) return fail('There is no boundary in the direction of this end to extend to.');
  const np = round2(best.pt);
  let updated: Entity;
  if (e.kind === 'polyline') {
    const p2 = [...e.pts];
    p2[nearFirst ? 0 : p2.length - 1] = np;
    updated = { ...e, pts: p2 };
  } else updated = nearFirst ? ({ ...e, a: np } as Entity) : ({ ...e, b: np } as Entity);
  let out = replace(f, [updated]);
  if (e.kind === 'wall') {
    // openings keep their position measured from the (possibly moved) start point
    if (nearFirst) {
      const shift = dist(np, e.a);
      for (const o of Object.values(out.entities)) if (isOpening(o) && o.wall === e.id) out = replace(out, [{ ...o, offset: o.offset + shift }]);
    }
    out = normalizeWalls(out);
  }
  return { ok: true, value: out };
}

/** Fillet two walls/lines into a clean corner (both ends move to the intersection of their lines). */
export function filletEntities(f: Floor, idA: string, idB: string): OpResult {
  const A = f.entities[idA];
  const B = f.entities[idB];
  if (!A || !B || (A.kind !== 'wall' && A.kind !== 'line') || (B.kind !== 'wall' && B.kind !== 'line')) return fail('Fillet joins two walls or two lines.');
  const hit = lineIntersect(A.a, A.b, B.a, B.b);
  if (!hit) return fail('The two objects are parallel and never meet.');
  const moveNearest = <T extends { a: Pt; b: Pt }>(e: T): T => (dist(e.a, hit) <= dist(e.b, hit) ? { ...e, a: round2(hit) } : { ...e, b: round2(hit) });
  let out = replace(f, [moveNearest(A), moveNearest(B)]);
  out = normalizeWalls(out);
  return { ok: true, value: out };
}

/** Connected-node move: moves every wall/line end point that coincides with `from` to `to`. */
export function moveNode(f: Floor, from: Pt, to: Pt): Floor {
  const upd: Entity[] = [];
  for (const id of f.order) {
    const e = f.entities[id];
    if (!e) continue;
    if ((e.kind === 'wall' || e.kind === 'line' || e.kind === 'beam') && (same(e.a, from, 1) || same(e.b, from, 1))) {
      const moved = { ...e, a: same(e.a, from, 1) ? to : e.a, b: same(e.b, from, 1) ? to : e.b };
      // openings keep their offset from the wall start; if the start moved they would shift - compensate
      upd.push(moved);
      if (e.kind === 'wall' && same(e.a, from, 1)) {
        const delta = dist(to, e.b) - dist(from, e.b);
        for (const o of Object.values(f.entities)) if (isOpening(o) && o.wall === e.id) upd.push({ ...o, offset: Math.max(0, o.offset + delta) });
      }
    }
  }
  return upd.length ? replace(f, upd) : f;
}

// ---------- components ----------

export function createComponent(f: Floor, ids: string[], base: Pt, name: string): OpResult<ComponentDef> {
  const sel = expandSelection(f, ids);
  if (!sel.length) return fail('Select objects first, then choose Component.');
  if (!name.trim()) return fail('Give the component a name.');
  const idMap = new Map(sel.map((id) => [id, `c_${id}`]));
  const entities = sel.map((id) => {
    let e = translateEntity(structuredClone(f.entities[id]), [-base[0], -base[1]]);
    e.id = idMap.get(id)!;
    e.group = undefined;
    if (isOpening(e)) e = { ...e, wall: idMap.get(e.wall) ?? e.wall };
    return e;
  });
  return { ok: true, value: { id: newId('comp'), name: name.trim(), entities } };
}

/** Inserts a component definition as independent copies that share a group id. */
export function insertComponent(f: Floor, def: ComponentDef, at: Pt, rot = 0, scale = 1): { floor: Floor; newIds: string[] } {
  const idMap = new Map<string, string>();
  for (const e of def.entities) idMap.set(e.id, newId(e.kind));
  const group = newId('grp');
  const created: Entity[] = def.entities.map((src) => {
    let e: Entity = structuredClone(src);
    e.id = idMap.get(src.id)!;
    e.group = group;
    if (isOpening(e)) {
      e = { ...e, wall: idMap.get(e.wall) ?? e.wall, offset: e.offset * scale };
      return e;
    }
    if (scale !== 1) e = scaleEntity(e, [0, 0], scale);
    if (rot) e = rotateEntity(e, rot, [0, 0]);
    e = translateEntity(e, at);
    if (e.kind === 'radial') e = { ...e, target: idMap.get(e.target) ?? e.target };
    return e;
  });
  return { floor: normalizeWalls(addEntities(f, created)), newIds: created.map((c) => c.id) };
}

export { angleOf, arcPoints, mapEntityPoints, rectCorners, rotatePt, floorWalls };

// ---------- grips ----------

/** Result of dragging one grip of an entity to a new point. */
export function applyGrip(f: Floor, e: Entity, handle: string, pt: Pt): OpResult {
  const P = round2(pt);
  const idx = /^v(\d+)$/.exec(handle);
  switch (e.kind) {
    case 'line':
    case 'arrow':
    case 'guide':
    case 'beam':
    case 'strip':
    case 'dimension':
      if (handle === 'a') return { ok: true, value: replace(f, [{ ...e, a: P }]) };
      if (handle === 'b') return { ok: true, value: replace(f, [{ ...e, b: P }]) };
      break;
    case 'wall': {
      const from = handle === 'a' ? e.a : e.b;
      if (handle !== 'a' && handle !== 'b') break;
      return { ok: true, value: normalizeWalls(moveNode(f, from, P)) };
    }
    case 'polyline':
    case 'polygon':
    case 'railing':
    case 'roof':
    case 'leader':
      if (idx) {
        const pts = [...e.pts];
        pts[Number(idx[1])] = P;
        return { ok: true, value: replace(f, [{ ...e, pts }]) };
      }
      break;
    case 'arc':
      if (handle === 'p1' || handle === 'p2' || handle === 'p3') {
        const next = { ...e, [handle]: P };
        if (!arcFrom3(next.p1, next.p2, next.p3)) return fail('The three arc points must not be on one line.');
        return { ok: true, value: replace(f, [next]) };
      }
      break;
    case 'circle':
      if (handle === 'c') return { ok: true, value: replace(f, [{ ...e, c: P }]) };
      if (handle === 'r') {
        const r = dist(e.c, P);
        return r > 0.5 ? { ok: true, value: replace(f, [{ ...e, r: round(r, 3) }]) } : fail('Radius must be greater than zero.');
      }
      break;
    case 'rect': {
      const [x0, y0] = e.p1;
      const [x1, y1] = e.p2;
      const map: Record<string, { p1: Pt; p2: Pt }> = {
        c0: { p1: P, p2: [x1, y1] },
        c1: { p1: [x0, P[1]], p2: [P[0], y1] },
        c2: { p1: [x0, y0], p2: P },
        c3: { p1: [P[0], y0], p2: [x1, P[1]] },
      };
      const m = map[handle];
      if (m) return Math.abs(m.p1[0] - m.p2[0]) < 1 || Math.abs(m.p1[1] - m.p2[1]) < 1 ? fail('A rectangle needs a width and height.') : { ok: true, value: replace(f, [{ ...e, ...m }]) };
      break;
    }
    case 'column':
      return { ok: true, value: replace(f, [{ ...e, c: P }]) };
    case 'stairs':
      return { ok: true, value: replace(f, [{ ...e, origin: P }]) };
    case 'angle':
      if (handle === 'v' || handle === 'a' || handle === 'b') return { ok: true, value: replace(f, [{ ...e, [handle]: P }]) };
      break;
    case 'text':
    case 'compass':
    case 'xy':
    case 'light':
    case 'model':
    case 'reference':
      return { ok: true, value: replace(f, [{ ...e, pos: P }]) };
    case 'door':
    case 'window': {
      const w = f.entities[e.wall];
      if (w?.kind !== 'wall') break;
      const L = wallLen(w);
      const t = pointSegment(P, w.a, w.b).t;
      const res = placeOpeningLocal(f, e.wall, t, e.width, e.id);
      return 'offset' in res ? { ok: true, value: replace(f, [{ ...e, offset: res.offset }]) } : fail(res.error + (L ? '' : ''));
    }
    default:
      break;
  }
  return fail('This point cannot be dragged.');
}

import { placeOpening as placeOpeningLocal } from './walls';
