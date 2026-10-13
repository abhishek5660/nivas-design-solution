import { TOL, add, angleOf, dist, dot, mul, norm, perp, pointSegment, projectOnLine, round, same, segIntersect, sub } from './geom';
import type { DoorE, Entity, Floor, Pt, WallE, WindowE } from './types';

export const wallLen = (w: WallE) => dist(w.a, w.b);
export const wallDir = (w: WallE): Pt => norm(sub(w.b, w.a));
/** Left normal of the wall direction (plan frame, y down). */
export const wallNormal = (w: WallE): Pt => perp(wallDir(w));
export const pointAtOffset = (w: WallE, off: number): Pt => add(w.a, mul(wallDir(w), off));

export type OpeningE = DoorE | WindowE;
export const isOpening = (e: Entity): e is OpeningE => e.kind === 'door' || e.kind === 'window';

export const floorEntities = (f: Floor): Entity[] => f.order.map((id) => f.entities[id]).filter((e): e is Entity => !!e);
export const floorWalls = (f: Floor): WallE[] => floorEntities(f).filter((e): e is WallE => e.kind === 'wall' && !e.hidden);
export const openingsOf = (f: Floor, wallId: string): OpeningE[] => floorEntities(f).filter((e): e is OpeningE => isOpening(e) && e.wall === wallId);

export interface WallGeom {
  wall: WallE;
  /** how far each end is extended so joined walls form clean corners */
  extA: number;
  extB: number;
  /** 4-point outline: a-left, b-left, b-right, a-right */
  outline: [Pt, Pt, Pt, Pt];
}

/** Computes joined wall outlines. Corners/T-junctions are completed by extending wall ends. */
export function wallGeometries(walls: WallE[]): WallGeom[] {
  const ends = (w: WallE, atB: boolean) => {
    const node = atB ? w.b : w.a;
    // direction of the wall leaving the node
    const leaving = atB ? sub(w.a, w.b) : sub(w.b, w.a);
    let ext = 0;
    for (const o of walls) {
      if (o === w) continue;
      let od: Pt | null = null;
      if (same(o.a, node, TOL * 4)) od = sub(o.b, o.a);
      else if (same(o.b, node, TOL * 4)) od = sub(o.a, o.b);
      else {
        const ps = pointSegment(node, o.a, o.b);
        if (ps.d < TOL * 4 && ps.t > 0 && ps.t < 1) od = sub(o.b, o.a); // T-junction: stem ends on o
      }
      if (!od) continue;
      const u = norm(leaving);
      const v = norm(od);
      const cosPhi = dot(u, v);
      const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
      if (sinPhi < 0.05) continue; // collinear (continuation) or overlapping
      ext = Math.max(ext, Math.min(o.thickness / 2 / sinPhi, o.thickness * 1.5));
    }
    return ext;
  };
  return walls.map((w) => {
    const d = wallDir(w);
    const n = perp(d);
    const extA = ends(w, false);
    const extB = ends(w, true);
    const a = sub(w.a, mul(d, extA));
    const b = add(w.b, mul(d, extB));
    const h = w.thickness / 2;
    return { wall: w, extA, extB, outline: [add(a, mul(n, h)), add(b, mul(n, h)), sub(b, mul(n, h)), sub(a, mul(n, h))] };
  });
}

// ---------- splitting / normalisation ----------

let uidCounter = 0;
export const newId = (prefix = 'e') => `${prefix}_${Date.now().toString(36)}${(uidCounter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/**
 * Splits walls wherever another wall's end point lies on them (T-junctions) or where they cross, so the wall
 * network is a clean planar graph (needed for room detection). Openings are re-attached to the right piece.
 * Idempotent. Returns the same object when nothing changes.
 */
export function normalizeWalls(floor: Floor): Floor {
  const walls = floorWalls(floor);
  const splitsById = new Map<string, number[]>();
  const add_ = (id: string, t: number) => {
    const w = floor.entities[id] as WallE;
    const L = wallLen(w);
    if (t * L < TOL * 2 || (1 - t) * L < TOL * 2) return; // at an end already
    const arr = splitsById.get(id) ?? [];
    if (!arr.some((x) => Math.abs(x - t) * L < TOL * 2)) arr.push(t);
    splitsById.set(id, arr);
  };
  for (let i = 0; i < walls.length; i++) {
    for (let j = 0; j < walls.length; j++) {
      if (i === j) continue;
      const w = walls[i];
      const o = walls[j];
      // end points of o that lie in the interior of w
      for (const p of [o.a, o.b]) {
        const ps = pointSegment(p, w.a, w.b);
        if (ps.d < TOL * 2) add_(w.id, ps.t);
      }
      if (j > i) {
        const hit = segIntersect(w.a, w.b, o.a, o.b, false);
        if (hit) {
          add_(w.id, hit.t);
          add_(o.id, hit.u);
        }
      }
    }
  }
  if (!splitsById.size) return floor;

  const entities = { ...floor.entities };
  const order = [...floor.order];
  const pieceFor = new Map<string, { id: string; from: number; to: number }[]>();
  for (const [id, ts] of splitsById) {
    const w = floor.entities[id] as WallE;
    const L = wallLen(w);
    const cuts = [0, ...ts.sort((a, b) => a - b), 1];
    const pieces: { id: string; from: number; to: number }[] = [];
    for (let k = 0; k < cuts.length - 1; k++) {
      const pid = k === 0 ? id : newId('wall');
      const a = k === 0 ? w.a : add(w.a, mul(wallDir(w), cuts[k] * L));
      const b = k === cuts.length - 2 ? w.b : add(w.a, mul(wallDir(w), cuts[k + 1] * L));
      const piece: WallE = { ...w, id: pid, a: [round(a[0]), round(a[1])], b: [round(b[0]), round(b[1])] };
      if (k === 0) piece.a = w.a;
      if (k === cuts.length - 2) piece.b = w.b;
      entities[pid] = piece;
      if (k > 0) order.splice(order.indexOf(id) + k, 0, pid);
      pieces.push({ id: pid, from: cuts[k] * L, to: cuts[k + 1] * L });
    }
    pieceFor.set(id, pieces);
  }
  // re-attach openings by their centre position along the original wall
  for (const e of floorEntities(floor)) {
    if (!isOpening(e)) continue;
    const pieces = pieceFor.get(e.wall);
    if (!pieces) continue;
    const centre = e.offset + e.width / 2;
    const p = pieces.find((x) => centre >= x.from - 1e-6 && centre <= x.to + 1e-6) ?? pieces[pieces.length - 1];
    entities[e.id] = { ...e, wall: p.id, offset: Math.max(0, e.offset - p.from) };
  }
  return { ...floor, entities, order };
}

// ---------- openings ----------

export const OPENING_MARGIN = 50; // mm kept between an opening and the wall end / other openings

export interface OpeningCheck {
  ok: boolean;
  reason?: string;
}

/** Whether an opening fits in the wall at the offset (inside the wall, not overlapping other openings). */
export function checkOpening(floor: Floor, wallId: string, offset: number, width: number, ignoreId?: string): OpeningCheck {
  const w = floor.entities[wallId];
  if (!w || w.kind !== 'wall') return { ok: false, reason: 'The opening must be placed on a wall.' };
  const L = wallLen(w);
  if (width <= 0) return { ok: false, reason: 'Opening width must be positive.' };
  if (offset < -1e-6 || offset + width > L + 1e-6) return { ok: false, reason: `The ${Math.round(width)} mm opening does not fit this ${Math.round(L)} mm wall segment.` };
  for (const o of openingsOf(floor, wallId)) {
    if (o.id === ignoreId) continue;
    if (offset < o.offset + o.width + OPENING_MARGIN - 1e-6 && o.offset < offset + width + OPENING_MARGIN - 1e-6) return { ok: false, reason: 'It would overlap another door or window on this wall.' };
  }
  return { ok: true };
}

/** Nearest wall to a point (within maxDist) with the projected parameter. */
export function nearestWall(floor: Floor, p: Pt, maxDist = 300): { wall: WallE; t: number; d: number; q: Pt } | null {
  let best: { wall: WallE; t: number; d: number; q: Pt } | null = null;
  for (const w of floorWalls(floor)) {
    const ps = pointSegment(p, w.a, w.b);
    if (ps.d <= Math.max(maxDist, w.thickness / 2) && (!best || ps.d < best.d)) best = { wall: w, t: ps.t, d: ps.d, q: ps.q };
  }
  return best;
}

/** Offset for an opening of `width` centred at the click, clamped into the wall. Null when it cannot fit. */
export function placeOpening(floor: Floor, wallId: string, clickT: number, width: number, ignoreId?: string): { offset: number } | { error: string } {
  const w = floor.entities[wallId] as WallE | undefined;
  if (!w || w.kind !== 'wall') return { error: 'No wall here.' };
  const L = wallLen(w);
  if (width + 2 * OPENING_MARGIN > L + 1e-6) return { error: `This wall segment is only ${Math.round(L)} mm long - too short for a ${Math.round(width)} mm opening.` };
  let offset = clickT * L - width / 2;
  offset = Math.max(OPENING_MARGIN, Math.min(L - width - OPENING_MARGIN, offset));
  const chk = checkOpening(floor, wallId, offset, width, ignoreId);
  if (chk.ok) return { offset: round(offset) };
  // try nudging to the nearest free position along the wall
  const taken = openingsOf(floor, wallId).filter((o) => o.id !== ignoreId).sort((a, b) => a.offset - b.offset);
  const candidates: number[] = [OPENING_MARGIN];
  for (const o of taken) candidates.push(o.offset + o.width + OPENING_MARGIN, o.offset - width - OPENING_MARGIN);
  let best: number | null = null;
  for (const c of candidates) {
    if (c < OPENING_MARGIN - 1e-6 || c + width > L - OPENING_MARGIN + 1e-6) continue;
    if (!checkOpening(floor, wallId, c, width, ignoreId).ok) continue;
    if (best === null || Math.abs(c - offset) < Math.abs(best - offset)) best = c;
  }
  return best === null ? { error: chk.reason ?? 'No free space on this wall.' } : { offset: round(best) };
}

/** Start/end points of an opening along its wall centre line. */
export function openingSegment(floor: Floor, e: OpeningE): { a: Pt; b: Pt; wall: WallE } | null {
  const w = floor.entities[e.wall];
  if (!w || w.kind !== 'wall') return null;
  return { a: pointAtOffset(w, e.offset), b: pointAtOffset(w, e.offset + e.width), wall: w };
}

export { angleOf, projectOnLine };

/** The solid parts of a wall in plan: the wall outline split where doors and windows cut it (so openings read as gaps). */
export function wallPieces(floor: Floor, w: WallE, extA: number, extB: number): Pt[][] {
  const L = wallLen(w);
  const d = wallDir(w);
  const n = perp(d);
  const h = w.thickness / 2;
  const holes = openingsOf(floor, w.id)
    .map((o) => [o.offset, o.offset + o.width] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const segs: [number, number][] = [];
  let cur = -extA;
  for (const [a, b] of holes) {
    if (a > cur) segs.push([cur, a]);
    cur = Math.max(cur, b);
  }
  if (cur < L + extB) segs.push([cur, L + extB]);
  return segs.map(([s0, s1]) => {
    const p0 = add(w.a, mul(d, s0));
    const p1 = add(w.a, mul(d, s1));
    return [add(p0, mul(n, h)), add(p1, mul(n, h)), sub(p1, mul(n, h)), sub(p0, mul(n, h))];
  });
}
