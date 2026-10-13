import type { Pt } from './types';

export const EPS = 1e-6;
export const TOL = 0.5; // mm: points closer than this are the same point

export const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
export const mul = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k];
export const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];
export const cross = (a: Pt, b: Pt) => a[0] * b[1] - a[1] * b[0];
export const len = (a: Pt) => Math.hypot(a[0], a[1]);
export const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
export const same = (a: Pt, b: Pt, tol = TOL) => dist(a, b) <= tol;
export const norm = (a: Pt): Pt => {
  const l = len(a);
  return l < EPS ? [0, 0] : [a[0] / l, a[1] / l];
};
/** Left-hand normal in the (x, y-down) plan frame: rotates the direction by +90 degrees. */
export const perp = (a: Pt): Pt => [-a[1], a[0]];
export const rad = (d: number) => (d * Math.PI) / 180;
export const deg = (r: number) => (r * 180) / Math.PI;
export const angleOf = (from: Pt, to: Pt) => deg(Math.atan2(to[1] - from[1], to[0] - from[0]));
export const fromPolar = (origin: Pt, angleDeg: number, length: number): Pt => [origin[0] + Math.cos(rad(angleDeg)) * length, origin[1] + Math.sin(rad(angleDeg)) * length];
export const normAngle = (d: number) => ((d % 360) + 360) % 360;

export const round = (n: number, p = 3) => Math.round(n * 10 ** p) / 10 ** p;
export const roundPt = (p: Pt, prec = 3): Pt => [round(p[0], prec), round(p[1], prec)];

export function rotatePt(p: Pt, angleDeg: number, origin: Pt = [0, 0]): Pt {
  const c = Math.cos(rad(angleDeg));
  const s = Math.sin(rad(angleDeg));
  const dx = p[0] - origin[0];
  const dy = p[1] - origin[1];
  return [origin[0] + dx * c - dy * s, origin[1] + dx * s + dy * c];
}

export function mirrorPt(p: Pt, a: Pt, b: Pt): Pt {
  const d = norm(sub(b, a));
  const v = sub(p, a);
  const along = dot(v, d);
  const proj = add(a, mul(d, along));
  return [2 * proj[0] - p[0], 2 * proj[1] - p[1]];
}

export const scalePt = (p: Pt, base: Pt, k: number): Pt => [base[0] + (p[0] - base[0]) * k, base[1] + (p[1] - base[1]) * k];

export function pointSegment(p: Pt, a: Pt, b: Pt): { d: number; t: number; q: Pt } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < EPS) return { d: dist(p, a), t: 0, q: a };
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  const q = add(a, mul(ab, t));
  return { d: dist(p, q), t, q };
}

/** Unclamped projection of p onto the line a-b. */
export function projectOnLine(p: Pt, a: Pt, b: Pt): { t: number; q: Pt } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < EPS) return { t: 0, q: a };
  const t = dot(sub(p, a), ab) / l2;
  return { t, q: add(a, mul(ab, t)) };
}

export interface Hit {
  pt: Pt;
  t: number; // along p1-p2
  u: number; // along p3-p4
}

/** Segment-segment intersection. `touch` allows intersections at/near the end points. */
export function segIntersect(p1: Pt, p2: Pt, p3: Pt, p4: Pt, touch = true): Hit | null {
  const r = sub(p2, p1);
  const s = sub(p4, p3);
  const den = cross(r, s);
  if (Math.abs(den) < EPS) return null;
  const qp = sub(p3, p1);
  const t = cross(qp, s) / den;
  const u = cross(qp, r) / den;
  const lo = touch ? -1e-9 : 1e-9;
  const hi = touch ? 1 + 1e-9 : 1 - 1e-9;
  if (t < lo || t > hi || u < lo || u > hi) return null;
  return { pt: add(p1, mul(r, t)), t, u };
}

/** Infinite line (through a-b) x infinite line (through c-d). */
export function lineIntersect(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const r = sub(b, a);
  const s = sub(d, c);
  const den = cross(r, s);
  if (Math.abs(den) < EPS) return null;
  const t = cross(sub(c, a), s) / den;
  return add(a, mul(r, t));
}

/** Intersection of a ray (origin o, direction d, t >= 0) with segment c-e. */
export function rayIntersect(o: Pt, d: Pt, c: Pt, e: Pt): { pt: Pt; t: number } | null {
  const s = sub(e, c);
  const den = cross(d, s);
  if (Math.abs(den) < EPS) return null;
  const qp = sub(c, o);
  const t = cross(qp, s) / den;
  const u = cross(qp, d) / den;
  if (t < -1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { pt: add(o, mul(d, t)), t };
}

export function polygonArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function polygonCentroid(pts: Pt[]): Pt {
  const a = polygonArea(pts);
  if (Math.abs(a) < EPS) return pts.length ? pts[0] : [0, 0];
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const f = p[0] * q[1] - q[0] * p[1];
    cx += (p[0] + q[0]) * f;
    cy += (p[1] + q[1]) * f;
  }
  return [cx / (6 * a), cy / (6 * a)];
}

export function perimeter(pts: Pt[], closed = true): number {
  let l = 0;
  for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) l += dist(pts[i], pts[(i + 1) % pts.length]);
  return l;
}

export function pointInPolygon(p: Pt, pts: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boundsOf(pts: Pt[]): Box {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const [x, y] of pts) {
    b.minX = Math.min(b.minX, x);
    b.minY = Math.min(b.minY, y);
    b.maxX = Math.max(b.maxX, x);
    b.maxY = Math.max(b.maxY, y);
  }
  return b;
}

export const unionBox = (a: Box | null, b: Box | null): Box | null => (!a ? b : !b ? a : { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) });
export const boxesOverlap = (a: Box, b: Box) => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
export const boxInside = (inner: Box, outer: Box) => inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY;

export function segIntersectsBox(a: Pt, b: Pt, box: Box): boolean {
  const inBox = (p: Pt) => p[0] >= box.minX && p[0] <= box.maxX && p[1] >= box.minY && p[1] <= box.maxY;
  if (inBox(a) || inBox(b)) return true;
  const c: Pt[] = [[box.minX, box.minY], [box.maxX, box.minY], [box.maxX, box.maxY], [box.minX, box.maxY]];
  for (let i = 0; i < 4; i++) if (segIntersect(a, b, c[i], c[(i + 1) % 4])) return true;
  return false;
}

// ---------- arcs ----------

export interface ArcGeom {
  c: Pt;
  r: number;
  /** start/end angle in radians (end reached from start going in `dir`), dir = +1 (increasing angle) or -1 */
  a1: number;
  a2: number;
  dir: 1 | -1;
  /** swept angle, radians, 0..2pi */
  sweep: number;
}

/** Circle through three points; the arc runs p1 -> p2 -> p3. Null if the points are (nearly) collinear. */
export function arcFrom3(p1: Pt, p2: Pt, p3: Pt): ArcGeom | null {
  const d = 2 * (p1[0] * (p2[1] - p3[1]) + p2[0] * (p3[1] - p1[1]) + p3[0] * (p1[1] - p2[1]));
  if (Math.abs(d) < 1e-6) return null;
  const s1 = p1[0] ** 2 + p1[1] ** 2;
  const s2 = p2[0] ** 2 + p2[1] ** 2;
  const s3 = p3[0] ** 2 + p3[1] ** 2;
  const c: Pt = [(s1 * (p2[1] - p3[1]) + s2 * (p3[1] - p1[1]) + s3 * (p1[1] - p2[1])) / d, (s1 * (p3[0] - p2[0]) + s2 * (p1[0] - p3[0]) + s3 * (p2[0] - p1[0])) / d];
  const r = dist(c, p1);
  const a1 = Math.atan2(p1[1] - c[1], p1[0] - c[0]);
  const am = Math.atan2(p2[1] - c[1], p2[0] - c[0]);
  const a2 = Math.atan2(p3[1] - c[1], p3[0] - c[0]);
  const TAU = Math.PI * 2;
  const up = (x: number) => ((x % TAU) + TAU) % TAU;
  // direction: is p2 reached from p1 before p3 when going in +angle?
  const dir: 1 | -1 = up(am - a1) < up(a2 - a1) ? 1 : -1;
  const sweep = dir === 1 ? up(a2 - a1) : up(a1 - a2);
  return { c, r, a1, a2, dir, sweep };
}

export function arcPoints(g: ArcGeom, segmentsPerQuarter = 12): Pt[] {
  const n = Math.max(2, Math.ceil((g.sweep / (Math.PI / 2)) * segmentsPerQuarter));
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = g.a1 + g.dir * (g.sweep * i) / n;
    out.push([g.c[0] + Math.cos(a) * g.r, g.c[1] + Math.sin(a) * g.r]);
  }
  return out;
}

export const arcLength = (g: ArcGeom) => g.r * g.sweep;

export function circlePoints(c: Pt, r: number, n = 64): Pt[] {
  return Array.from({ length: n }, (_, i) => [c[0] + Math.cos((i / n) * Math.PI * 2) * r, c[1] + Math.sin((i / n) * Math.PI * 2) * r] as Pt);
}

/** Angle in degrees (0..180) at vertex v between rays v->a and v->b. */
export function angleBetween(v: Pt, a: Pt, b: Pt): number {
  const u = norm(sub(a, v));
  const w = norm(sub(b, v));
  return deg(Math.acos(Math.max(-1, Math.min(1, dot(u, w)))));
}

/** Whether a point lies inside (or within `tol` of) a polygon. */
export function polysIntersectPt(poly: Pt[], p: Pt, tol = 0): boolean {
  if (pointInPolygon(p, poly)) return true;
  if (tol <= 0) return false;
  for (let i = 0; i < poly.length; i++) if (pointSegment(p, poly[i], poly[(i + 1) % poly.length]).d <= tol) return true;
  return false;
}
