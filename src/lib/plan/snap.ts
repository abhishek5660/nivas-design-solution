import { dist, pointSegment, segIntersect, sub, angleOf, fromPolar, round, type Box } from './geom';
import { entityPaths, entitySnapPoints } from './entities';
import type { Entity, Floor, PlanSettings, Pt } from './types';

export type SnapKind = 'endpoint' | 'midpoint' | 'center' | 'intersection' | 'nearest' | 'guide' | 'ortho' | 'angle' | 'grid' | 'align' | 'none';

export interface SnapResult {
  pt: Pt;
  kind: SnapKind;
  /** alignment helper lines to draw (world coords) */
  guides: { a: Pt; b: Pt }[];
  label: string;
}

export interface SnapOptions {
  /** previous point of the tool in progress (enables orthogonal / angle snapping) */
  ref?: Pt | null;
  /** entity ids to ignore (e.g. those being moved) */
  exclude?: Set<string>;
  /** force ortho irrespective of the setting (Shift) */
  forceOrtho?: boolean;
  /** disable all snapping (Alt) */
  none?: boolean;
  /** snap tolerance in mm (callers pass pixels / scale) */
  tol: number;
  /** extra anchor points (e.g. the points of the shape being drawn) */
  extra?: Pt[];
}

interface Cache {
  pts: { p: Pt; kind: 'endpoint' | 'midpoint' | 'center'; id: string }[];
  segs: { a: Pt; b: Pt; id: string; infinite: boolean }[];
}
const cache = new WeakMap<Floor, Cache>();

function build(floor: Floor): Cache {
  const hit = cache.get(floor);
  if (hit) return hit;
  const pts: Cache['pts'] = [];
  const segs: Cache['segs'] = [];
  for (const id of floor.order) {
    const e = floor.entities[id];
    if (!e || e.hidden) continue;
    for (const s of entitySnapPoints(floor, e)) pts.push({ ...s, id });
    for (const path of entityPaths(floor, e)) {
      const n = path.pts.length;
      for (let i = 0; i < n - (path.closed ? 0 : 1); i++) segs.push({ a: path.pts[i], b: path.pts[(i + 1) % n], id, infinite: e.kind === 'guide' && e.infinite });
    }
  }
  const c = { pts, segs };
  cache.set(floor, c);
  return c;
}

const LABEL: Record<SnapKind, string> = { endpoint: 'Endpoint', midpoint: 'Midpoint', center: 'Centre', intersection: 'Intersection', nearest: 'On edge', guide: 'On guide', ortho: 'Orthogonal', angle: 'Angle', grid: 'Grid', align: 'Aligned', none: '' };

export function snapPoint(floor: Floor, raw: Pt, s: PlanSettings, o: SnapOptions): SnapResult {
  const none = (): SnapResult => ({ pt: raw, kind: 'none', guides: [], label: '' });
  if (o.none) return none();
  const c = build(floor);
  const tol = o.tol;
  const ex = o.exclude;

  // 1. point snaps (endpoint / midpoint / centre) incl. extra anchors
  let best: { p: Pt; kind: SnapKind; d: number } | null = null;
  const consider = (p: Pt, kind: SnapKind, d?: number) => {
    const dd = d ?? dist(p, raw);
    if (dd <= tol && (!best || dd < best.d - 1e-9)) best = { p, kind, d: dd };
  };
  for (const q of c.pts) {
    if (ex?.has(q.id)) continue;
    if (q.kind === 'endpoint' && s.snap.endpoint) consider(q.p, 'endpoint');
    else if (q.kind === 'midpoint' && s.snap.midpoint) consider(q.p, 'midpoint');
    else if (q.kind === 'center' && s.snap.endpoint) consider(q.p, 'center');
  }
  for (const p of o.extra ?? []) consider(p, 'endpoint');
  // 2. intersections of nearby segments
  if (s.snap.intersection && !best) {
    const near = c.segs.filter((sg) => !ex?.has(sg.id) && (sg.infinite || pointSegment(raw, sg.a, sg.b).d <= tol * 4));
    for (let i = 0; i < near.length; i++)
      for (let j = i + 1; j < near.length; j++) {
        const A = near[i];
        const B = near[j];
        const ext = (sg: typeof A): [Pt, Pt] => (sg.infinite ? [[sg.a[0] + (sg.a[0] - sg.b[0]) * 1e4, sg.a[1] + (sg.a[1] - sg.b[1]) * 1e4], [sg.b[0] + (sg.b[0] - sg.a[0]) * 1e4, sg.b[1] + (sg.b[1] - sg.a[1]) * 1e4]] : [sg.a, sg.b]);
        const [a1, a2] = ext(A);
        const [b1, b2] = ext(B);
        const hit = segIntersect(a1, a2, b1, b2);
        if (hit) consider(hit.pt, 'intersection');
      }
  }
  if (best) {
    const b = best as { p: Pt; kind: SnapKind; d: number };
    return { pt: b.p, kind: b.kind, guides: [], label: LABEL[b.kind] };
  }

  let pt = raw;
  let kind: SnapKind = 'none';
  const guides: { a: Pt; b: Pt }[] = [];

  // 3. guide lines / edges (nearest point on an edge)
  let nearest: { q: Pt; d: number; guide: boolean } | null = null;
  for (const sg of c.segs) {
    if (ex?.has(sg.id)) continue;
    const isGuide = sg.infinite;
    if (!s.snap.nearest && !isGuide) continue;
    let ps;
    if (isGuide) {
      const dx = sg.b[0] - sg.a[0];
      const dy = sg.b[1] - sg.a[1];
      const l2 = dx * dx + dy * dy || 1;
      const t = ((raw[0] - sg.a[0]) * dx + (raw[1] - sg.a[1]) * dy) / l2;
      const q: Pt = [sg.a[0] + dx * t, sg.a[1] + dy * t];
      ps = { d: dist(raw, q), q };
    } else ps = pointSegment(raw, sg.a, sg.b);
    if (ps.d <= tol && (!nearest || ps.d < nearest.d)) nearest = { q: ps.q, d: ps.d, guide: isGuide };
  }
  if (nearest) {
    const n = nearest as { q: Pt; d: number; guide: boolean };
    pt = n.q;
    kind = n.guide ? 'guide' : 'nearest';
  }

  // 4. orthogonal / 45-degree lock relative to the previous point
  if (kind === 'none' && o.ref && (s.snap.ortho || o.forceOrtho)) {
    const a = angleOf(o.ref, raw);
    const L = dist(o.ref, raw);
    const step = 45;
    const snapped = Math.round(a / step) * step;
    const limit = o.forceOrtho ? 45 : 6;
    if (L > tol && Math.abs(a - snapped) <= limit) {
      pt = fromPolar(o.ref, snapped, L);
      kind = snapped % 90 === 0 ? 'ortho' : 'angle';
    }
  }

  // 5. alignment with other points (magnet)
  if (kind === 'none' || kind === 'ortho') {
    if (s.snap.magnet) {
      let ax: Pt | null = null;
      let ay: Pt | null = null;
      for (const q of c.pts) {
        if (ex?.has(q.id) || q.kind === 'midpoint') continue;
        if (Math.abs(q.p[0] - pt[0]) <= tol * 0.6 && (!ax || Math.abs(q.p[0] - pt[0]) < Math.abs(ax[0] - pt[0]))) ax = q.p;
        if (Math.abs(q.p[1] - pt[1]) <= tol * 0.6 && (!ay || Math.abs(q.p[1] - pt[1]) < Math.abs(ay[1] - pt[1]))) ay = q.p;
      }
      for (const q of o.extra ?? []) {
        if (Math.abs(q[0] - pt[0]) <= tol * 0.6) ax = q;
        if (Math.abs(q[1] - pt[1]) <= tol * 0.6) ay = q;
      }
      if (ax || ay) {
        const np: Pt = [ax ? ax[0] : pt[0], ay ? ay[1] : pt[1]];
        if (ax) guides.push({ a: ax, b: np });
        if (ay) guides.push({ a: ay, b: np });
        pt = np;
        kind = 'align';
      }
    }
  }

  // 6. grid
  if (kind === 'none' && s.snap.grid && s.grid.spacing > 0) {
    const g = s.grid.spacing;
    pt = [Math.round(raw[0] / g) * g, Math.round(raw[1] / g) * g];
    kind = 'grid';
  } else if (kind === 'ortho' && s.snap.grid && s.grid.spacing > 0 && o.ref) {
    // keep the locked direction but round the length to the grid
    const a = angleOf(o.ref, pt);
    const L = Math.round(dist(o.ref, pt) / s.grid.spacing) * s.grid.spacing;
    if (L > 0) pt = fromPolar(o.ref, a, L);
  }
  return { pt: [round(pt[0], 3), round(pt[1], 3)], kind, guides, label: LABEL[kind] };
}

export type { Box };
export { sub };
export type { Entity };
