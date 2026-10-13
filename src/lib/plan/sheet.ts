import type { Drawing, Prim } from '../docs/drawing';
import { footprint } from '../scene';
import type { SceneDoc } from '../types';
import { columnCorners, modelCorners, resolveRef, stairsOutline } from './entities';
import { add, angleOf, boundsOf, circlePoints, dist, fromPolar, mul, norm, perp, rotatePt, sub } from './geom';
import { findFloor } from './model';
import { roomsOf } from './rooms';
import { floorEntities, floorWalls, openingSegment, wallDir, wallGeometries, wallPieces } from './walls';
import type { Entity, Pt } from './types';

export interface SheetOptions {
  dimensions?: boolean;
  furniture?: boolean;
  labels?: boolean;
}

const Y = (p: Pt): [number, number] => [p[0], -p[1]];

/**
 * Printable floor-plan drawing of one floor, built from the same model as the 2D workspace and the 3D view.
 * Output uses the shared drawing primitives so SVG / DXF / PDF export work unchanged. Drawing space has y up.
 */
export function buildFloorSheet(doc: SceneDoc, floorId: string, opts: SheetOptions = {}): Drawing {
  const { dimensions = true, furniture = true, labels = true } = opts;
  const plan = doc.plan;
  const floor = plan ? findFloor(plan, floorId) : undefined;
  const empty: Drawing = { view: 'plan', title: 'FLOOR PLAN', prims: [], bounds: { minX: 0, minY: 0, maxX: 1000, maxY: 1000 }, scaleNote: '', dimensions: [], nodeCount: 0 };
  if (!plan || !floor) return empty;
  const prims: Prim[] = [];
  const dims: Drawing['dimensions'] = [];
  const poly = (pts: Pt[], layer: string, o: { fill?: string; stroke?: string; sw?: number; dash?: boolean } = {}) => prims.push({ t: 'poly', pts: pts.map(Y), fill: o.fill, stroke: o.stroke ?? '#1b1b1b', sw: o.sw ?? 1, layer, dash: o.dash });
  const line = (a: Pt, b: Pt, layer: string, sw = 1, dash = false) => prims.push({ t: 'line', x1: a[0], y1: -a[1], x2: b[0], y2: -b[1], sw, layer, dash });
  const path = (pts: Pt[], layer: string, sw = 1, dash = false) => {
    for (let i = 0; i < pts.length - 1; i++) line(pts[i], pts[i + 1], layer, sw, dash);
  };
  const text = (at: Pt, s: string, size: number, layer = 'TEXT', anchor: 'start' | 'middle' | 'end' = 'middle', rot?: number) => prims.push({ t: 'text', x: at[0], y: -at[1], text: s, size, anchor, layer, rot });

  const rooms = roomsOf(floor, plan.roomProps);
  for (const r of rooms) poly(r.inner, 'ROOMS', { fill: '#f6f2e9', stroke: '#d8d1c3', sw: 0.4 });

  // walls with gaps where doors / windows cut them
  const walls = floorWalls(floor);
  for (const g of wallGeometries(walls)) for (const p of wallPieces(floor, g.wall, g.extA, g.extB)) poly(p, 'WALLS', { fill: g.wall.wallType === 'exterior' ? '#4a4a4e' : '#8a8780', stroke: '#1b1b1b', sw: 1.2 });

  for (const e of floorEntities(floor)) {
    if (e.hidden) continue;
    switch (e.kind) {
      case 'door':
      case 'window': {
        const seg = openingSegment(floor, e);
        if (!seg) break;
        const d = wallDir(seg.wall);
        const n = perp(d);
        const h = seg.wall.thickness / 2;
        if (e.kind === 'window') {
          poly([add(seg.a, mul(n, h)), add(seg.b, mul(n, h)), sub(seg.b, mul(n, h)), sub(seg.a, mul(n, h))], 'WINDOWS', { fill: '#e6f1f6', sw: 1 });
          line(add(seg.a, mul(n, h / 3)), add(seg.b, mul(n, h / 3)), 'WINDOWS', 0.8);
          line(sub(seg.a, mul(n, h / 3)), sub(seg.b, mul(n, h / 3)), 'WINDOWS', 0.8);
        } else {
          line(add(seg.a, mul(n, h)), sub(seg.a, mul(n, h)), 'DOORS', 1);
          line(add(seg.b, mul(n, h)), sub(seg.b, mul(n, h)), 'DOORS', 1);
          const side = e.opens === 'in' ? n : mul(n, -1);
          const hingeAtA = e.swing === 'left';
          const hinge = hingeAtA ? seg.a : seg.b;
          const closedDir = hingeAtA ? d : mul(d, -1);
          line(hinge, add(hinge, mul(side, e.width)), 'DOORS', 1.6);
          const a0 = angleOf([0, 0], closedDir);
          const a1 = angleOf([0, 0], side);
          const delta = ((a1 - a0 + 540) % 360) - 180;
          const arc: Pt[] = [];
          for (let i = 0; i <= 16; i++) arc.push(fromPolar(hinge, a0 + (delta * i) / 16, e.width));
          path(arc, 'DOORS', 0.7, true);
        }
        break;
      }
      case 'column':
        poly(e.shape === 'round' ? circlePoints(e.c, e.width / 2, 24) : columnCorners(e), 'COLUMNS', { fill: '#5a5a5e', sw: 1 });
        break;
      case 'beam': {
        const d = norm(sub(e.b, e.a));
        const n = perp(d);
        const h = e.width / 2;
        poly([add(e.a, mul(n, h)), add(e.b, mul(n, h)), sub(e.b, mul(n, h)), sub(e.a, mul(n, h))], 'BEAMS', { dash: true, sw: 0.8 });
        break;
      }
      case 'stairs': {
        poly(stairsOutline(e), 'STAIRS', { sw: 1 });
        // stair-local (along, across) -> plan coordinates
        const W = (lx: number, ly: number): Pt => rotatePt([e.origin[0] + lx, e.origin[1] + ly], e.rot, e.origin);
        for (let i = 1; i < e.steps; i++) line(W(i * e.tread, 0), W(i * e.tread, e.width), 'STAIRS', 0.6);
        line(W(e.tread * 0.3, e.width / 2), W(e.tread * (e.steps - 0.3), e.width / 2), 'STAIRS', 0.8);
        text(W(e.tread * e.steps * 0.5, e.width / 2 - 120), `UP ${e.steps} × ${Math.round(e.riser)}`, 110, 'STAIRS');
        break;
      }
      case 'railing':
        path(e.pts, 'RAILINGS', 1.4);
        break;
      case 'roof':
        poly(e.pts, 'ROOF', { dash: true, sw: 0.7 });
        break;
      case 'light':
        poly(circlePoints(e.pos, 90, 12), 'LIGHTS', { fill: '#fff6dd', sw: 0.8 });
        break;
      case 'strip':
        line(e.a, e.b, 'LIGHTS', 1.6, true);
        break;
      case 'model':
        poly(modelCorners(e), 'FURNITURE', { fill: '#ffffff', sw: 0.8 });
        if (labels) text([e.pos[0], e.pos[1]], e.fileName.replace(/\.glb$/i, ''), 70, 'TEXT');
        break;
      case 'line': case 'arrow': case 'guide':
        if (e.kind !== 'guide' || !e.temporary) line(e.a, e.b, 'DRAWING', 0.9, e.kind === 'guide');
        break;
      case 'polyline':
        path(e.closed ? [...e.pts, e.pts[0]] : e.pts, 'DRAWING', 0.9);
        break;
      case 'polygon':
        poly(e.pts, 'DRAWING', { sw: 0.9 });
        break;
      case 'rect':
        poly([e.p1, [e.p2[0], e.p1[1]], e.p2, [e.p1[0], e.p2[1]]], 'DRAWING', { sw: 0.9 });
        break;
      case 'circle':
        poly(circlePoints(e.c, e.r, 48), 'DRAWING', { sw: 0.9 });
        break;
      case 'text':
        text(e.pos, e.text, e.size, 'TEXT', 'start', e.rot ? -e.rot : undefined);
        break;
      case 'leader':
        path(e.pts, 'TEXT', 0.8);
        text(e.pts[e.pts.length - 1], e.text, e.size, 'TEXT', 'start');
        break;
      case 'compass': {
        poly(circlePoints(e.pos, e.size / 2, 32), 'TEXT', { sw: 0.8 });
        const tip = fromPolar(e.pos, e.north - 90, e.size / 2);
        line(e.pos, tip, 'TEXT', 1.4);
        text(fromPolar(e.pos, e.north - 90, e.size * 0.7), 'N', e.size * 0.3);
        break;
      }
      case 'xy':
        line([e.pos[0] - 60, e.pos[1]], [e.pos[0] + 60, e.pos[1]], 'TEXT', 0.8);
        line([e.pos[0], e.pos[1] - 60], [e.pos[0], e.pos[1] + 60], 'TEXT', 0.8);
        text([e.pos[0] + 80, e.pos[1] - 50], `X ${Math.round(e.pos[0])}  Y ${Math.round(-e.pos[1])}`, 70, 'TEXT', 'start');
        break;
      case 'angle': {
        path([e.a, e.v, e.b], 'DIMS', 0.9);
        const a0 = angleOf(e.v, e.a);
        const a1 = angleOf(e.v, e.b);
        const delta = Math.abs(((a1 - a0 + 540) % 360) - 180);
        text(fromPolar(e.v, (a0 + a1) / 2, 260), `${(180 - delta).toFixed(1)}°`, 80, 'DIMS');
        break;
      }
      case 'dimension': {
        if (!dimensions) break;
        const a = resolveRef(floor, e.refA) ?? e.a;
        const b = resolveRef(floor, e.refB) ?? e.b;
        const L = dist(a, b);
        if (L < 1) break;
        const n = perp(norm(sub(b, a)));
        const off = mul(n, e.offset);
        const a2 = add(a, off);
        const b2 = add(b, off);
        line(a, a2, 'DIMS', 0.6);
        line(b, b2, 'DIMS', 0.6);
        line(a2, b2, 'DIMS', 1.1);
        const ang = angleOf(a, b);
        text(add(add(a2, mul(sub(b2, a2), 0.5)), mul(n, e.offset >= 0 ? 60 : -140)), `${Math.round(L)}`, 85, 'DIMS', 'middle', -((ang + 90) % 180 - 90));
        dims.push({ label: 'Dimension', value: Math.round(L) });
        break;
      }
      default:
        break;
    }
  }

  // furniture and cabinets standing on this floor
  const first = plan.buildings[0].floors[0].id;
  let nodeCount = 0;
  if (furniture) {
    for (const n of Object.values(doc.nodes)) {
      if (n.type === 'group' || !n.visible || (n.floorId ?? first) !== floorId) continue;
      const fp = footprint(n);
      poly(fp, 'FURNITURE', { fill: '#ffffff', sw: 0.9 });
      const b = boundsOf(fp);
      if (labels) text([(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2], n.name, Math.min(90, Math.max(45, (b.maxX - b.minX) / Math.max(6, n.name.length))), 'TEXT');
      nodeCount++;
    }
  }

  if (labels) for (const r of rooms) {
    const dy = furniture ? -260 : 0;
    text([r.centroid[0], r.centroid[1] + dy], r.name, 130, 'TEXT');
    text([r.centroid[0], r.centroid[1] + dy + 170], `${(r.area / 1e6).toFixed(2)} m²`, 100, 'TEXT');
  }

  // overall dimensions of the wall network
  const wallPts = wallGeometries(walls).flatMap((g) => g.outline as Pt[]); // outer faces, not centre lines
  if (dimensions && wallPts.length) {
    const b = boundsOf(wallPts);
    const pad = 600;
    const dimLine = (p: Pt, q: Pt, off: Pt, v: number, rot?: number) => {
      const a2 = add(p, off);
      const b2 = add(q, off);
      line(p, a2, 'DIMS', 0.6);
      line(q, b2, 'DIMS', 0.6);
      line(a2, b2, 'DIMS', 1.1);
      text(add(add(a2, mul(sub(b2, a2), 0.5)), mul(off, 0.18)), `${Math.round(v)}`, 95, 'DIMS', 'middle', rot);
    };
    dimLine([b.minX, b.minY], [b.maxX, b.minY], [0, -pad], b.maxX - b.minX);
    dimLine([b.minX, b.minY], [b.minX, b.maxY], [-pad, 0], b.maxY - b.minY, 90);
    dims.push({ label: 'Overall width', value: Math.round(b.maxX - b.minX) }, { label: 'Overall depth', value: Math.round(b.maxY - b.minY) });
  }

  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const grow = (x: number, y: number) => {
    bounds.minX = Math.min(bounds.minX, x);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxY = Math.max(bounds.maxY, y);
  };
  for (const p of prims) {
    if (p.t === 'poly') p.pts.forEach(([x, y]) => grow(x, y));
    else if (p.t === 'line') {
      grow(p.x1, p.y1);
      grow(p.x2, p.y2);
    } else grow(p.x, p.y);
  }
  if (!Number.isFinite(bounds.minX)) return { ...empty, title: `FLOOR PLAN - ${floor.name.toUpperCase()}` };
  const m = 400;
  return {
    view: 'plan',
    title: `FLOOR PLAN - ${floor.name.toUpperCase()}`,
    prims,
    bounds: { minX: bounds.minX - m, minY: bounds.minY - m, maxX: bounds.maxX + m, maxY: bounds.maxY + m },
    scaleNote: 'All dimensions in millimetres',
    dimensions: dims,
    nodeCount,
  };
}
