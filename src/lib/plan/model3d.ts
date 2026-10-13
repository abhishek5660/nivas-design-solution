import { add, angleOf, boundsOf, circlePoints, dist, mul, norm, perp, polygonArea, rotatePt, sub } from './geom';
import { columnCorners, rectCorners, stairsOutline } from './entities';
import { insetPolygon, roomsOf } from './rooms';
import { floorEntities, floorWalls, openingsOf, wallDir, wallGeometries, wallLen } from './walls';
import type { Entity, Floor, PlanModel, Pt, Room, RoomProps, TilePattern } from './types';

export type V3 = [number, number, number]; // x, y(up), z — plan (x,y) maps to world (x, z)

export interface WallHole {
  x0: number; // local distance along the wall (from wall.a)
  x1: number;
  y0: number;
  y1: number;
  kind: 'door' | 'window';
}

export interface WallSolid {
  id: string;
  y0: number;
  height: number;
  thickness: number;
  a: Pt;
  dir: Pt;
  /** local x range of the solid along the wall including corner extensions (may start below 0) */
  start: number;
  end: number;
  holes: WallHole[];
  color: string;
  outline: [Pt, Pt, Pt, Pt];
}

export function wallSolids(floor: Floor): WallSolid[] {
  const walls = floorWalls(floor);
  return wallGeometries(walls).map((g) => {
    const w = g.wall;
    const L = wallLen(w);
    const holes: WallHole[] = openingsOf(floor, w.id).map((o) => ({
      x0: o.offset,
      x1: o.offset + o.width,
      y0: o.kind === 'window' ? o.sill : 0,
      y1: Math.min(w.height, (o.kind === 'window' ? o.sill : 0) + o.height),
      kind: o.kind,
    }));
    return { id: w.id, y0: floor.elevation, height: w.height, thickness: w.thickness, a: w.a, dir: wallDir(w), start: -g.extA, end: L + g.extB, holes, color: w.color ?? (w.wallType === 'exterior' ? '#ddd3c2' : '#efe9de'), outline: g.outline };
  });
}

export interface SurfaceSolid {
  id: string;
  kind: 'slab' | 'ceiling' | 'floor-finish';
  poly: Pt[];
  y: number; // top surface
  thickness: number;
  color: string;
  tile?: TileSpec;
  visible: boolean;
}

export interface TileSpec {
  w: number;
  h: number;
  grout: number;
  pattern: TilePattern;
  rotation: number;
  color: string;
}

const DEFAULT_FLOOR = '#c9b595';

function expandOutline(room: Room, walls: { thickness: number }[]): Pt[] {
  const t = Math.max(100, ...walls.map((w) => w.thickness)) / 2;
  return insetPolygon(room.outline, room.outline.map(() => -t));
}

/** Slabs, ceilings and finished floor surfaces. Finished floors are drawn in every room (tiled when a tiling exists). */
export function surfaceSolids(floor: Floor, rooms: Room[]): SurfaceSolid[] {
  const out: SurfaceSolid[] = [];
  const ents = floorEntities(floor);
  const wallsOfRoom = (r: Room) => r.wallIds.map((id) => floor.entities[id]).filter((e): e is Extract<Entity, { kind: 'wall' }> => e?.kind === 'wall');
  for (const e of ents) {
    if (e.kind === 'slab') {
      const room = rooms.find((r) => pointIn(e.anchor, r.outline));
      const poly = e.pts && e.pts.length >= 3 ? e.pts : room ? expandOutline(room, wallsOfRoom(room)) : null;
      if (poly) out.push({ id: e.id, kind: 'slab', poly, y: floor.elevation + e.elevation, thickness: e.thickness, color: '#b9b3a8', visible: !e.hidden });
    } else if (e.kind === 'ceiling') {
      const room = rooms.find((r) => pointIn(e.anchor, r.outline));
      if (room) out.push({ id: e.id, kind: 'ceiling', poly: room.inner, y: floor.elevation + e.height, thickness: e.thickness, color: '#f5f2ec', visible: e.visible && !e.hidden });
    }
  }
  for (const r of rooms) {
    const tiling = ents.find((e): e is Extract<Entity, { kind: 'tiling' }> => e.kind === 'tiling' && e.target === 'floor' && pointIn(e.anchor, r.outline));
    out.push({
      id: `floor:${r.key}`,
      kind: 'floor-finish',
      poly: r.inner,
      y: floor.elevation + 2,
      thickness: 2,
      color: tiling ? tiling.color : DEFAULT_FLOOR,
      tile: tiling ? { w: tiling.tileW, h: tiling.tileH, grout: tiling.grout, pattern: tiling.pattern, rotation: tiling.rotation, color: tiling.color } : undefined,
      visible: true,
    });
  }
  return out;
}

const pointIn = (p: Pt, poly: Pt[]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (poly[i][1] > p[1] !== poly[j][1] > p[1] && p[0] < ((poly[j][0] - poly[i][0]) * (p[1] - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) inside = !inside;
  }
  return inside;
};

export interface WallTileSurface {
  id: string;
  wallId: string;
  a: Pt; // face start
  b: Pt; // face end
  normal: Pt; // outward from the face
  y0: number;
  height: number;
  tile: TileSpec;
}

/** Tiling planes that sit on both faces of tiled walls. */
export function wallTileSurfaces(floor: Floor): WallTileSurface[] {
  const out: WallTileSurface[] = [];
  for (const e of floorEntities(floor)) {
    if (e.kind !== 'tiling' || e.target !== 'wall' || !e.wall) continue;
    const w = floor.entities[e.wall];
    if (!w || w.kind !== 'wall') continue;
    const n = perp(wallDir(w));
    for (const side of [1, -1]) {
      const off = mul(n, (w.thickness / 2 + 1) * side);
      out.push({ id: `${e.id}:${side}`, wallId: w.id, a: add(w.a, off), b: add(w.b, off), normal: mul(n, side), y0: floor.elevation, height: Math.min(e.height, w.height), tile: { w: e.tileW, h: e.tileH, grout: e.grout, pattern: e.pattern, rotation: e.rotation, color: e.color } });
    }
  }
  return out;
}

export interface StairSolid {
  id: string;
  steps: { poly: Pt[]; top: number }[]; // each step is a solid block from the floor up to `top`
}

export function stairSolids(floor: Floor): StairSolid[] {
  const out: StairSolid[] = [];
  for (const e of floorEntities(floor)) {
    if (e.kind !== 'stairs') continue;
    const steps: StairSolid['steps'] = [];
    for (let i = 0; i < e.steps; i++) {
      const x0 = i * e.tread;
      const x1 = (i + 1) * e.tread;
      const local: Pt[] = [[x0, 0], [x1, 0], [x1, e.width], [x0, e.width]];
      steps.push({ poly: local.map((p) => rotatePt(add(e.origin, p), e.rot, e.origin)), top: floor.elevation + (i + 1) * e.riser });
    }
    out.push({ id: e.id, steps });
  }
  return out;
}

export interface RailingSolid {
  id: string;
  rail: Pt[];
  posts: Pt[];
  y0: number;
  height: number;
  elevation: number;
}

export function railingSolids(floor: Floor): RailingSolid[] {
  const out: RailingSolid[] = [];
  for (const e of floorEntities(floor)) {
    if (e.kind !== 'railing') continue;
    const posts: Pt[] = [];
    for (let i = 0; i < e.pts.length - 1; i++) {
      const a = e.pts[i];
      const b = e.pts[i + 1];
      const L = dist(a, b);
      const n = Math.max(1, Math.round(L / Math.max(e.spacing, 30)));
      for (let k = 0; k <= n; k++) {
        if (i > 0 && k === 0) continue;
        posts.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
      }
    }
    out.push({ id: e.id, rail: e.pts, posts, y0: floor.elevation + e.elevation, height: e.height, elevation: e.elevation });
  }
  return out;
}

export interface RoofSolid {
  id: string;
  tris: [V3, V3, V3][];
  thickness: number;
  roofType: string;
}

/** Roof surfaces over the bounding rectangle of the outline (plus overhang). Non-rectangular outlines are approximated by it. */
export function roofSolids(floor: Floor): RoofSolid[] {
  const out: RoofSolid[] = [];
  for (const e of floorEntities(floor)) {
    if (e.kind !== 'roof') continue;
    const b = boundsOf(e.pts);
    const o = e.overhang;
    const x0 = b.minX - o;
    const x1 = b.maxX + o;
    const z0 = b.minY - o;
    const z1 = b.maxY + o;
    const y = floor.elevation + e.elevation;
    const W = x1 - x0;
    const D = z1 - z0;
    const t = Math.tan((e.slope * Math.PI) / 180);
    const tris: RoofSolid['tris'] = [];
    const quad = (a: V3, b2: V3, c: V3, d: V3) => tris.push([a, b2, c], [a, c, d]);
    if (e.roofType === 'flat' || e.slope <= 0) {
      quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]);
    } else if (e.roofType === 'shed') {
      const rise = (W < D ? D : W) * t;
      if (W >= D) quad([x0, y, z0], [x1, y + rise, z0], [x1, y + rise, z1], [x0, y, z1]);
      else quad([x0, y, z0], [x1, y, z0], [x1, y + rise, z1], [x0, y + rise, z1]);
    } else if (e.roofType === 'gable') {
      if (W >= D) {
        const ridge = y + (D / 2) * t;
        const zm = (z0 + z1) / 2;
        quad([x0, y, z0], [x1, y, z0], [x1, ridge, zm], [x0, ridge, zm]);
        quad([x0, y, z1], [x0, ridge, zm], [x1, ridge, zm], [x1, y, z1]);
        tris.push([[x0, y, z0], [x0, ridge, zm], [x0, y, z1]], [[x1, y, z0], [x1, y, z1], [x1, ridge, zm]]);
      } else {
        const ridge = y + (W / 2) * t;
        const xm = (x0 + x1) / 2;
        quad([x0, y, z0], [xm, ridge, z0], [xm, ridge, z1], [x0, y, z1]);
        quad([x1, y, z0], [x1, y, z1], [xm, ridge, z1], [xm, ridge, z0]);
        tris.push([[x0, y, z0], [x1, y, z0], [xm, ridge, z0]], [[x0, y, z1], [xm, ridge, z1], [x1, y, z1]]);
      }
    } else {
      // hip
      const half = Math.min(W, D) / 2;
      const ridgeY = y + half * t;
      const long = W >= D;
      const r0: V3 = long ? [x0 + half, ridgeY, (z0 + z1) / 2] : [(x0 + x1) / 2, ridgeY, z0 + half];
      const r1: V3 = long ? [x1 - half, ridgeY, (z0 + z1) / 2] : [(x0 + x1) / 2, ridgeY, z1 - half];
      const c: V3[] = [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]];
      tris.push([c[0], c[1], r1], [c[0], r1, r0], [c[1], c[2], r1], [c[2], c[3], r0], [c[2], r0, r1], [c[3], c[0], r0]);
    }
    out.push({ id: e.id, tris, thickness: e.thickness, roofType: e.roofType });
  }
  return out;
}

export interface Plan3D {
  walls: WallSolid[];
  surfaces: SurfaceSolid[];
  wallTiles: WallTileSurface[];
  columns: { id: string; poly: Pt[]; y0: number; height: number; round: boolean }[];
  beams: { id: string; a: Pt; b: Pt; width: number; depth: number; y: number }[];
  stairs: StairSolid[];
  railings: RailingSolid[];
  roofs: RoofSolid[];
  lights: { id: string; p: V3; color: string; intensity: number; lightType: string }[];
  strips: { id: string; a: V3; b: V3; color: string; intensity: number }[];
  models: { id: string; pos: V3; rot: number; size: { w: number; d: number; h: number }; url: string }[];
  elevation: number;
  height: number;
}

export function floor3D(floor: Floor, roomProps: Record<string, RoomProps> = {}): Plan3D {
  const rooms = roomsOf(floor, roomProps);
  const visible = (e: Entity) => !e.hidden && (!floor.isolated || floor.isolated.includes(e.id));
  const ents = floorEntities(floor).filter(visible);
  return {
    walls: wallSolids({ ...floor, order: floor.order.filter((i) => floor.entities[i] && visible(floor.entities[i])) }),
    surfaces: surfaceSolids(floor, rooms),
    wallTiles: wallTileSurfaces(floor),
    columns: ents.filter((e): e is Extract<Entity, { kind: 'column' }> => e.kind === 'column').map((e) => ({ id: e.id, poly: e.shape === 'round' ? circlePoints(e.c, e.width / 2, 24) : columnCorners(e), y0: floor.elevation, height: e.height, round: e.shape === 'round' })),
    beams: ents.filter((e): e is Extract<Entity, { kind: 'beam' }> => e.kind === 'beam').map((e) => ({ id: e.id, a: e.a, b: e.b, width: e.width, depth: e.depth, y: floor.elevation + e.elevation })),
    stairs: stairSolids(floor),
    railings: railingSolids(floor),
    roofs: roofSolids(floor),
    lights: ents.filter((e): e is Extract<Entity, { kind: 'light' }> => e.kind === 'light').map((e) => ({ id: e.id, p: [e.pos[0], floor.elevation + e.elevation, e.pos[1]], color: e.color, intensity: e.intensity, lightType: e.lightType })),
    strips: ents.filter((e): e is Extract<Entity, { kind: 'strip' }> => e.kind === 'strip').map((e) => ({ id: e.id, a: [e.a[0], floor.elevation + e.elevation, e.a[1]], b: [e.b[0], floor.elevation + e.elevation, e.b[1]], color: e.color, intensity: e.intensity })),
    models: ents.filter((e): e is Extract<Entity, { kind: 'model' }> => e.kind === 'model').map((e) => ({ id: e.id, pos: [e.pos[0], floor.elevation + e.elevation, e.pos[1]], rot: e.rot, size: e.size, url: e.url })),
    elevation: floor.elevation,
    height: floor.height,
  };
}

export const planHasContent = (p: PlanModel | undefined): boolean => !!p?.enabled && p.buildings.some((b) => b.floors.some((f) => f.order.length > 0));

export { angleOf, norm, polygonArea, rectCorners, sub, stairsOutline };
