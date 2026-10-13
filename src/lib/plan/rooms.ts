import { TOL, EPS, angleOf, cross, dist, lineIntersect, mul, norm, add, perimeter, perp, pointInPolygon, polygonArea, polygonCentroid, round, same, sub } from './geom';
import { floorWalls } from './walls';
import type { Floor, Pt, Room, RoomProps, WallE } from './types';

interface Node {
  id: number;
  p: Pt;
}

interface HalfEdge {
  from: number;
  to: number;
  wall: WallE;
}

/** Offsets a closed polygon inwards by per-edge distances (miter joins). Polygon must be CCW in the shoelace sense. */
export function insetPolygon(pts: Pt[], dists: number[]): Pt[] {
  const n = pts.length;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const d1 = norm(sub(p1, p0));
    const d2 = norm(sub(p2, p1));
    const o1 = dists[(i - 1 + n) % n];
    const o2 = dists[i];
    // interior is on the left of travel for CCW polygons: left normal of (dx,dy) in a y-up frame is (-dy, dx)
    const n1 = perp(d1);
    const n2 = perp(d2);
    const a1 = add(p0, mul(n1, o1));
    const a2 = add(p1, mul(n1, o1));
    const b1 = add(p1, mul(n2, o2));
    const b2 = add(p2, mul(n2, o2));
    const hit = Math.abs(cross(d1, d2)) < 1e-6 ? null : lineIntersect(a1, a2, b1, b2);
    out.push(hit ?? add(p1, mul(n1, (o1 + o2) / 2)));
  }
  return out;
}

function cleanSpikes(ids: number[], edges: HalfEdge[]): { ids: number[]; edges: HalfEdge[] } | null {
  let v = [...ids];
  let e = [...edges];
  let changed = true;
  while (changed && v.length >= 3) {
    changed = false;
    for (let i = 0; i < v.length; i++) {
      const prev = v[(i - 1 + v.length) % v.length];
      const next = v[(i + 1) % v.length];
      if (prev === next) {
        // dead-end spike: remove vertex i and the next one
        const j = (i + 1) % v.length;
        const drop = new Set([i, j]);
        v = v.filter((_, k) => !drop.has(k));
        // edges list is aligned: edge k goes v[k] -> v[k+1]; drop edges i-1 and i
        const dropE = new Set([(i - 1 + e.length) % e.length, i]);
        e = e.filter((_, k) => !dropE.has(k));
        changed = true;
        break;
      }
    }
  }
  return v.length >= 3 ? { ids: v, edges: e } : null;
}

export function roomKeyFor(wallIds: string[]): string {
  return `room:${[...new Set(wallIds)].sort().join('|')}`;
}

/**
 * Finds the closed rooms formed by the floor's walls (face detection on the wall centre-line graph).
 * Walls must already be normalised (see normalizeWalls) so junctions are shared nodes.
 */
export function computeRooms(floor: Floor, roomProps: Record<string, RoomProps> = {}): Room[] {
  const walls = floorWalls(floor);
  if (walls.length < 3) return [];
  const nodes: Node[] = [];
  const nodeOf = (p: Pt): number => {
    const found = nodes.find((n) => same(n.p, p, TOL * 2));
    if (found) return found.id;
    nodes.push({ id: nodes.length, p });
    return nodes.length - 1;
  };
  const halves: HalfEdge[] = [];
  const seenPair = new Map<string, WallE>();
  for (const w of walls) {
    const a = nodeOf(w.a);
    const b = nodeOf(w.b);
    if (a === b) continue;
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    const prev = seenPair.get(key);
    if (prev) {
      if (w.thickness > prev.thickness) seenPair.set(key, w); // duplicate wall on the same line: keep the thicker
      continue;
    }
    seenPair.set(key, w);
  }
  for (const [key, w] of seenPair) {
    const [a, b] = key.split('-').map(Number);
    halves.push({ from: a, to: b, wall: w }, { from: b, to: a, wall: w });
  }
  // outgoing edges per node sorted by angle
  const out = new Map<number, HalfEdge[]>();
  for (const h of halves) out.set(h.from, [...(out.get(h.from) ?? []), h]);
  const ang = (h: HalfEdge) => Math.atan2(nodes[h.to].p[1] - nodes[h.from].p[1], nodes[h.to].p[0] - nodes[h.from].p[0]);
  for (const [, list] of out) list.sort((x, y) => ang(x) - ang(y));
  const twinOf = (h: HalfEdge) => out.get(h.to)!.find((x) => x.to === h.from)!;
  const nextOf = (h: HalfEdge): HalfEdge => {
    const list = out.get(h.to)!;
    const t = twinOf(h);
    const i = list.indexOf(t);
    return list[(i - 1 + list.length) % list.length]; // next clockwise from the twin
  };
  const visited = new Set<HalfEdge>();
  const rooms: Room[] = [];
  for (const start of halves) {
    if (visited.has(start)) continue;
    const ids: number[] = [];
    const edges: HalfEdge[] = [];
    let h = start;
    let guard = 0;
    while (!visited.has(h) && guard++ < 10000) {
      visited.add(h);
      ids.push(h.from);
      edges.push(h);
      h = nextOf(h);
      if (h === start) break;
    }
    if (h !== start) continue;
    const cleaned = cleanSpikes(ids, edges);
    if (!cleaned) continue;
    const poly = cleaned.ids.map((i) => nodes[i].p);
    const area = polygonArea(poly);
    // faces are traced with the face on the left: bounded rooms come out counter-clockwise (positive shoelace area),
    // the single unbounded outer face of each connected component comes out negative and is skipped
    if (area <= 1) continue;
    const eThick = cleaned.edges.map((e) => e.wall.thickness / 2);
    const inner = insetPolygon(poly, eThick);
    const innerArea = Math.abs(polygonArea(inner));
    if (innerArea < 1e4 || polygonArea(inner) <= 0 || innerArea > area * 1.0001) continue; // collapsed or inverted
    const wallIds = Array.from(new Set(cleaned.edges.map((e) => e.wall.id)));
    const key = roomKeyFor(wallIds);
    rooms.push({
      key,
      outline: poly,
      inner,
      area: innerArea,
      perimeter: perimeter(inner),
      wallIds,
      name: roomProps[key]?.name ?? '',
      centroid: polygonCentroid(inner),
    });
  }
  // default names in reading order
  const sorted = [...rooms].sort((a, b) => Math.round(a.centroid[1] / 1000) - Math.round(b.centroid[1] / 1000) || a.centroid[0] - b.centroid[0]);
  sorted.forEach((r, i) => {
    if (!r.name) r.name = `Room ${i + 1}`;
  });
  return sorted;
}

export function roomAt(rooms: Room[], p: Pt): Room | null {
  let best: Room | null = null;
  for (const r of rooms) if (pointInPolygon(p, r.outline) && (!best || r.area < best.area)) best = r;
  return best;
}

export const roomDims = (r: Room) => {
  const xs = r.inner.map((p) => p[0]);
  const ys = r.inner.map((p) => p[1]);
  return { width: Math.max(...xs) - Math.min(...xs), depth: Math.max(...ys) - Math.min(...ys) };
};

export { angleOf, dist, EPS, round };

const roomCache = new WeakMap<Floor, Room[]>();

/** Memoised room detection (keyed by the floor object, which is replaced on every edit). User-given names are applied on top. */
export function roomsOf(floor: Floor, roomProps: Record<string, RoomProps> = {}): Room[] {
  let rooms = roomCache.get(floor);
  if (!rooms) {
    rooms = computeRooms(floor, {});
    roomCache.set(floor, rooms);
  }
  return rooms.map((r) => (roomProps[r.key]?.name ? { ...r, name: roomProps[r.key].name! } : r));
}
