import { buildParts } from '@/lib/scene';
import { add, angleOf, arcFrom3, arcPoints, boundsOf, circlePoints, deg, dist, fromPolar, mid, mul, norm, perp, polygonArea, rad, rotatePt, sub } from '@/lib/plan/geom';
import { columnCorners, rectCorners, referenceCorners, resolveRef, stairsOutline, modelCorners } from '@/lib/plan/entities';
import { mmToDisplay } from '@/lib/plan/model';
import { insetPolygon } from '@/lib/plan/rooms';
import { floorEntities, openingSegment, wallDir, wallGeometries, wallLen, wallPieces, floorWalls } from '@/lib/plan/walls';
import type { Drawable } from '@/lib/plan/toolHost';
import type { SnapResult } from '@/lib/plan/snap';
import type { DesignMode, Entity, Floor, PlanModel, Pt, Room, WallE } from '@/lib/plan/types';
import { ARCHITECTURE_KINDS } from '@/lib/plan/types';
import type { SceneNode } from '@/lib/types';
import type { View2D } from '@/store/planUi';

export const COLORS = {
  bg: '#faf8f3',
  gridMinor: 'rgba(120,110,95,0.10)',
  gridMajor: 'rgba(120,110,95,0.22)',
  wallExterior: '#3b3a3e',
  wallInterior: '#6e6b66',
  ink: '#26272b',
  room: '#f1ece1',
  select: '#1d6fe5',
  hover: '#b8923f',
  preview: '#1d6fe5',
  ok: '#2f8f55',
  bad: '#d23b34',
  dim: '#a0701a',
  guide: '#3aa0c8',
  muted: '#8a8478',
};

export interface DrawCtx {
  g: CanvasRenderingContext2D;
  w: number;
  h: number;
  view: View2D;
  plan: PlanModel;
  floor: Floor;
  rooms: Room[];
  nodes: SceneNode[];
  selection: Set<string>;
  hovered: string | null;
  images: Map<string, HTMLImageElement>;
  mode: DesignMode;
  highlight: { at: Pt; age: number } | null;
}

const S = (c: DrawCtx, p: Pt): Pt => [(p[0] - c.view.cx) * c.view.scale + c.w / 2, (p[1] - c.view.cy) * c.view.scale + c.h / 2];
export const toWorld = (view: View2D, w: number, h: number, sx: number, sy: number): Pt => [(sx - w / 2) / view.scale + view.cx, (sy - h / 2) / view.scale + view.cy];

function path(c: DrawCtx, pts: Pt[], closed = false) {
  const { g } = c;
  g.beginPath();
  pts.forEach((p, i) => {
    const [x, y] = S(c, p);
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  });
  if (closed) g.closePath();
}

interface Style {
  stroke: string;
  fill?: string;
  lw: number;
  dash?: number[];
  alpha?: number;
}

function stroke(c: DrawCtx, st: Style) {
  const { g } = c;
  g.save();
  g.globalAlpha = st.alpha ?? 1;
  if (st.fill) {
    g.fillStyle = st.fill;
    g.fill();
  }
  g.strokeStyle = st.stroke;
  g.lineWidth = st.lw;
  g.setLineDash(st.dash ?? []);
  g.lineJoin = 'round';
  g.stroke();
  g.restore();
}

function text(c: DrawCtx, s: string, p: Pt, opts: { size?: number; color?: string; align?: CanvasTextAlign; rot?: number; bold?: boolean; bg?: boolean; worldSize?: number } = {}) {
  const { g } = c;
  const [x, y] = S(c, p);
  const px = opts.worldSize ? Math.max(6, opts.worldSize * c.view.scale) : opts.size ?? 11;
  if (px < 4) return;
  g.save();
  g.translate(x, y);
  if (opts.rot) g.rotate(rad(opts.rot));
  g.font = `${opts.bold ? '600 ' : ''}${px}px "Segoe UI", Arial, sans-serif`;
  g.textAlign = opts.align ?? 'center';
  g.textBaseline = 'middle';
  if (opts.bg) {
    const w = g.measureText(s).width + 6;
    g.fillStyle = 'rgba(250,248,243,0.88)';
    g.fillRect(-(opts.align === 'left' ? 3 : w / 2), -px / 2 - 1, w, px + 2);
  }
  g.fillStyle = opts.color ?? COLORS.ink;
  g.fillText(s, 0, 0);
  g.restore();
}

// ---------------------------------------------------------------- grid & axes

function drawGrid(c: DrawCtx) {
  const { g, w, h, view, plan } = c;
  const gs = plan.settings.grid;
  g.fillStyle = COLORS.bg;
  g.fillRect(0, 0, w, h);
  if (!gs.visible) return drawAxes(c);
  let step = gs.spacing;
  while (step * view.scale < 8) step *= 5; // keep the grid readable when zoomed out
  const major = Math.max(gs.major, step);
  const tl = toWorld(view, w, h, 0, 0);
  const br = toWorld(view, w, h, w, h);
  const draw = (stepMm: number, color: string, skipMajor: boolean) => {
    g.strokeStyle = color;
    g.lineWidth = 1;
    g.beginPath();
    for (let x = Math.ceil(tl[0] / stepMm) * stepMm; x <= br[0]; x += stepMm) {
      if (skipMajor && Math.abs(x % major) < 1e-6) continue;
      const sx = Math.round((x - view.cx) * view.scale + w / 2) + 0.5;
      g.moveTo(sx, 0);
      g.lineTo(sx, h);
    }
    for (let y = Math.ceil(tl[1] / stepMm) * stepMm; y <= br[1]; y += stepMm) {
      if (skipMajor && Math.abs(y % major) < 1e-6) continue;
      const sy = Math.round((y - view.cy) * view.scale + h / 2) + 0.5;
      g.moveTo(0, sy);
      g.lineTo(w, sy);
    }
    g.stroke();
  };
  draw(step, COLORS.gridMinor, true);
  draw(major, COLORS.gridMajor, false);
  drawAxes(c);
}

/** The coloured X / Z axis arrows at the world origin. */
function drawAxes(c: DrawCtx) {
  const { g } = c;
  const [ox, oy] = S(c, [0, 0]);
  const L = 120;
  g.save();
  g.lineWidth = 1.4;
  g.strokeStyle = '#e2564f';
  g.fillStyle = '#e2564f';
  g.beginPath();
  g.moveTo(ox, oy);
  g.lineTo(ox + L, oy);
  g.stroke();
  g.beginPath();
  g.moveTo(ox + L, oy - 4);
  g.lineTo(ox + L + 9, oy);
  g.lineTo(ox + L, oy + 4);
  g.closePath();
  g.fill();
  g.font = '10px Arial';
  g.fillText('X', ox + L + 14, oy - 4);
  g.strokeStyle = '#4a56e6';
  g.fillStyle = '#4a56e6';
  g.beginPath();
  g.moveTo(ox, oy);
  g.lineTo(ox, oy + L);
  g.stroke();
  g.beginPath();
  g.moveTo(ox - 4, oy + L);
  g.lineTo(ox, oy + L + 9);
  g.lineTo(ox + 4, oy + L);
  g.closePath();
  g.fill();
  g.fillText('Z', ox + 6, oy + L + 14);
  g.restore();
}

// ---------------------------------------------------------------- walls

function drawWalls(c: DrawCtx) {
  const { g, floor, plan, selection, hovered } = c;
  const walls = floorWalls(floor).filter((w) => !floor.isolated || floor.isolated.includes(w.id));
  const geoms = wallGeometries(walls);
  const xray = plan.settings.xray;
  const pieces = geoms.map((gm) => ({ gm, polys: wallPieces(floor, gm.wall, gm.extA, gm.extB) }));
  // pass 1: outline (heavier stroke so joined walls merge visually), pass 2: fill covering inner strokes
  for (const { gm, polys } of pieces) {
    const sel = selection.has(gm.wall.id);
    const hov = hovered === gm.wall.id;
    for (const p of polys) {
      path(c, p, true);
      g.save();
      g.strokeStyle = sel ? COLORS.select : hov ? COLORS.hover : COLORS.ink;
      g.lineWidth = sel ? 4 : 3;
      g.lineJoin = 'miter';
      g.stroke();
      g.restore();
    }
  }
  for (const { gm, polys } of pieces) {
    const fill = gm.wall.wallType === 'exterior' ? COLORS.wallExterior : COLORS.wallInterior;
    for (const p of polys) {
      path(c, p, true);
      g.save();
      g.fillStyle = xray ? 'rgba(250,248,243,1)' : fill;
      g.fill();
      if (xray) {
        g.strokeStyle = COLORS.ink;
        g.lineWidth = 1;
        g.stroke();
      }
      g.restore();
    }
  }
  // door / window symbols
  for (const e of floorEntities(floor)) {
    if (e.kind !== 'door' && e.kind !== 'window') continue;
    drawOpening(c, e, selection.has(e.id) ? COLORS.select : hovered === e.id ? COLORS.hover : COLORS.ink);
  }
}

export function drawOpening(c: DrawCtx, e: Extract<Entity, { kind: 'door' | 'window' }>, color: string, alpha = 1) {
  const { g, floor } = c;
  const seg = openingSegment(floor, e);
  if (!seg) return;
  const w = seg.wall;
  const d = wallDir(w);
  const n = perp(d);
  const h = w.thickness / 2;
  g.save();
  g.globalAlpha = alpha;
  if (e.kind === 'window') {
    // frame, two glass lines
    const lines: [number, number][] = [[-h, h], [-h / 3, h / 3]];
    path(c, [add(seg.a, mul(n, h)), add(seg.b, mul(n, h)), sub(seg.b, mul(n, h)), sub(seg.a, mul(n, h))], true);
    g.fillStyle = 'rgba(190,225,240,0.55)';
    g.fill();
    g.strokeStyle = color;
    g.lineWidth = 1.4;
    g.stroke();
    for (const [o1] of [[h / 3], [-h / 3]]) {
      path(c, [add(seg.a, mul(n, o1)), add(seg.b, mul(n, o1))]);
      g.stroke();
    }
    void lines;
  } else {
    // jambs + leaf + swing arc
    path(c, [add(seg.a, mul(n, h)), sub(seg.a, mul(n, h))]);
    g.strokeStyle = color;
    g.lineWidth = 1.4;
    g.stroke();
    path(c, [add(seg.b, mul(n, h)), sub(seg.b, mul(n, h))]);
    g.stroke();
    const side = e.opens === 'in' ? n : mul(n, -1);
    const hingeAtA = e.swing === 'left';
    const hinge = hingeAtA ? seg.a : seg.b;
    const closedDir = hingeAtA ? d : mul(d, -1);
    const leafEnd = add(hinge, mul(side, e.width));
    path(c, [hinge, leafEnd]);
    g.lineWidth = 2;
    g.stroke();
    // arc from the closed position to the open position
    const a0 = angleOf([0, 0], closedDir);
    const a1 = angleOf([0, 0], side);
    let delta = ((a1 - a0 + 540) % 360) - 180;
    const pts: Pt[] = [];
    for (let i = 0; i <= 16; i++) pts.push(fromPolar(hinge, a0 + (delta * i) / 16, e.width));
    path(c, pts);
    g.lineWidth = 1;
    g.setLineDash([4, 3]);
    g.stroke();
    void delta;
  }
  g.restore();
}

// ---------------------------------------------------------------- rooms

function drawRooms(c: DrawCtx) {
  const { g, rooms, plan, floor } = c;
  for (const r of rooms) {
    path(c, r.inner, true);
    g.fillStyle = COLORS.room;
    g.fill();
  }
  // tilings (floor): real tile layout inside the room
  for (const e of floorEntities(floor)) {
    if (e.kind !== 'tiling' || e.target !== 'floor') continue;
    const r = rooms.find((x) => pointInPoly(e.anchor, x.outline));
    if (!r) continue;
    g.save();
    path(c, r.inner, true);
    g.clip();
    g.fillStyle = e.color;
    g.globalAlpha = 0.55;
    g.fillRect(0, 0, c.w, c.h);
    g.globalAlpha = 1;
    drawTileLines(c, r.inner, e);
    g.restore();
  }
  if (plan.settings.showRoomLabels) {
    for (const r of rooms) {
      const [x0, x1] = [Math.min(...r.inner.map((p) => p[0])), Math.max(...r.inner.map((p) => p[0]))];
      const [y0, y1] = [Math.min(...r.inner.map((p) => p[1])), Math.max(...r.inner.map((p) => p[1]))];
      const fs = Math.min(13, Math.max(9, c.view.scale * 150));
      if ((x1 - x0) * c.view.scale < 60) continue;
      text(c, r.name, [r.centroid[0], r.centroid[1] - 140], { size: fs + 1, bold: true, color: '#4a463e' });
      text(c, `${(r.area / 1e6).toFixed(2)} m²`, [r.centroid[0], r.centroid[1] + 40], { size: fs, color: COLORS.muted });
      if (plan.settings.showDimensions) text(c, `${Math.round(x1 - x0)} × ${Math.round(y1 - y0)}`, [r.centroid[0], r.centroid[1] + 220], { size: fs - 1, color: COLORS.muted });
    }
  }
}

function drawTileLines(c: DrawCtx, poly: Pt[], t: { tileW: number; tileH: number; grout: number; pattern: string; rotation: number }) {
  const { g } = c;
  const b = boundsOf(poly);
  const cell: Pt = t.rotation % 180 === 90 ? [t.tileH + t.grout, t.tileW + t.grout] : [t.tileW + t.grout, t.tileH + t.grout];
  if (cell[0] * c.view.scale < 3 || cell[1] * c.view.scale < 3) return;
  g.strokeStyle = 'rgba(90,84,72,0.45)';
  g.lineWidth = 0.8;
  g.beginPath();
  const diag = t.pattern === 'diagonal';
  if (diag) {
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const R = Math.hypot(b.maxX - b.minX, b.maxY - b.minY) / 2;
    for (let u = -R; u <= R; u += cell[0]) {
      for (const [s, e] of [[[u, -R], [u, R]], [[-R, u], [R, u]]] as [Pt, Pt][]) {
        const p = rotatePt([cx + s[0], cy + s[1]], 45, [cx, cy]);
        const q = rotatePt([cx + e[0], cy + e[1]], 45, [cx, cy]);
        const [x1, y1] = S(c, p);
        const [x2, y2] = S(c, q);
        g.moveTo(x1, y1);
        g.lineTo(x2, y2);
      }
    }
  } else {
    let row = 0;
    for (let y = b.minY; y <= b.maxY + cell[1]; y += cell[1], row++) {
      const [, sy] = S(c, [0, y]);
      g.moveTo(0, sy);
      g.lineTo(c.w, sy);
      const off = t.pattern === 'brick' && row % 2 ? cell[0] / 2 : 0;
      for (let x = b.minX - cell[0] + off; x <= b.maxX; x += cell[0]) {
        const [sx, sy2] = S(c, [x, y]);
        const [, sy3] = S(c, [x, y + cell[1]]);
        g.moveTo(sx, sy2);
        g.lineTo(sx, sy3);
      }
    }
    if (t.pattern !== 'brick') {
      for (let x = b.minX; x <= b.maxX + cell[0]; x += cell[0]) {
        const [sx] = S(c, [x, 0]);
        g.moveTo(sx, 0);
        g.lineTo(sx, c.h);
      }
    }
  }
  g.stroke();
}

const pointInPoly = (p: Pt, poly: Pt[]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (poly[i][1] > p[1] !== poly[j][1] > p[1] && p[0] < ((poly[j][0] - poly[i][0]) * (p[1] - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) inside = !inside;
  }
  return inside;
};

// ---------------------------------------------------------------- generic entities

export function resolveHatchBoundary(c: { floor: Floor; rooms: Room[] }, e: Extract<Entity, { kind: 'hatch' }>): Pt[] | null {
  if (e.boundary.kind === 'pts') return e.boundary.pts;
  if (e.boundary.kind === 'room') {
    const at = e.boundary.at;
    const r = c.rooms.find((x) => pointInPoly(at, x.outline));
    return r ? r.inner : null;
  }
  const src = c.floor.entities[e.boundary.id];
  if (!src) return null;
  if (src.kind === 'rect') return rectCorners(src.p1, src.p2);
  if (src.kind === 'polygon') return src.pts;
  if (src.kind === 'polyline' && src.closed) return src.pts;
  if (src.kind === 'circle') return circlePoints(src.c, src.r, 48);
  return null;
}

function drawHatch(c: DrawCtx, e: Extract<Entity, { kind: 'hatch' }>, st: { color: string }) {
  const poly = resolveHatchBoundary(c, e);
  if (!poly) return;
  const { g } = c;
  g.save();
  path(c, poly, true);
  g.clip();
  const b = boundsOf(poly);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const R = Math.hypot(b.maxX - b.minX, b.maxY - b.minY) / 2 + e.scale;
  g.strokeStyle = st.color;
  g.fillStyle = st.color;
  g.lineWidth = 1;
  g.globalAlpha = e.pattern === 'solid' ? 0.35 : 0.9;
  if (e.pattern === 'solid') g.fillRect(0, 0, c.w, c.h);
  else if (e.pattern === 'dots') {
    for (let x = b.minX; x <= b.maxX; x += e.scale) for (let y = b.minY; y <= b.maxY; y += e.scale) {
      const [sx, sy] = S(c, [x, y]);
      g.beginPath();
      g.arc(sx, sy, 1.3, 0, Math.PI * 2);
      g.fill();
    }
  } else {
    const angles = e.pattern === 'cross' ? [e.angle, e.angle + 90] : [e.pattern === 'horizontal' ? 0 : e.pattern === 'vertical' ? 90 : e.angle];
    for (const a of angles) {
      g.beginPath();
      for (let u = -R; u <= R; u += e.scale) {
        const p = rotatePt([cx - R, cy + u], a, [cx, cy]);
        const q = rotatePt([cx + R, cy + u], a, [cx, cy]);
        const [x1, y1] = S(c, p);
        const [x2, y2] = S(c, q);
        g.moveTo(x1, y1);
        g.lineTo(x2, y2);
      }
      g.stroke();
    }
  }
  g.restore();
}

export function drawEntity(c: DrawCtx, e: Entity, mode: 'normal' | 'selected' | 'hover' | 'preview' | 'ok' | 'bad' = 'normal') {
  const { g, floor, plan, view } = c;
  const col = mode === 'selected' ? COLORS.select : mode === 'hover' ? COLORS.hover : mode === 'preview' ? COLORS.preview : mode === 'ok' ? COLORS.ok : mode === 'bad' ? COLORS.bad : COLORS.ink;
  const lw = mode === 'selected' ? 2.2 : 1.5;
  const alpha = mode === 'preview' ? 0.8 : 1;
  const base: Style = { stroke: col, lw, alpha };
  switch (e.kind) {
    case 'line':
      path(c, [e.a, e.b]);
      return stroke(c, base);
    case 'polyline':
      path(c, e.pts, e.closed);
      return stroke(c, base);
    case 'polygon':
      path(c, e.pts, true);
      return stroke(c, { ...base, fill: 'rgba(120,110,95,0.06)' });
    case 'rect':
      path(c, rectCorners(e.p1, e.p2), true);
      return stroke(c, { ...base, fill: 'rgba(120,110,95,0.06)' });
    case 'circle': {
      const [x, y] = S(c, e.c);
      g.beginPath();
      g.arc(x, y, e.r * view.scale, 0, Math.PI * 2);
      return stroke(c, { ...base, fill: 'rgba(120,110,95,0.06)' });
    }
    case 'arc': {
      const a = arcFrom3(e.p1, e.p2, e.p3);
      path(c, a ? arcPoints(a) : [e.p1, e.p2, e.p3]);
      return stroke(c, base);
    }
    case 'arrow': {
      path(c, [e.a, e.b]);
      stroke(c, base);
      const ang = angleOf(e.a, e.b);
      const len = Math.max(150, dist(e.a, e.b) * 0.12);
      path(c, [fromPolar(e.b, ang + 155, len), e.b, fromPolar(e.b, ang - 155, len)]);
      return stroke(c, base);
    }
    case 'guide': {
      let a = e.a;
      let b = e.b;
      if (e.infinite) {
        const d = norm(sub(e.b, e.a));
        const R = (c.w + c.h) / view.scale;
        a = sub(e.a, mul(d, R));
        b = add(e.a, mul(d, R));
      }
      path(c, [a, b]);
      return stroke(c, { stroke: mode === 'selected' ? COLORS.select : COLORS.guide, lw: 1, dash: [8, 5], alpha: 0.9 });
    }
    case 'hatch':
      return drawHatch(c, e, { color: mode === 'selected' ? COLORS.select : e.color });
    case 'wall':
    case 'door':
    case 'window':
      return; // drawn by drawWalls
    case 'column': {
      const pts = e.shape === 'round' ? circlePoints(e.c, e.width / 2, 28) : columnCorners(e);
      path(c, pts, true);
      stroke(c, { ...base, fill: plan.settings.xray ? undefined : '#55535a' });
      if (e.shape === 'rect') {
        const k = columnCorners(e);
        path(c, [k[0], k[2]]);
        stroke(c, { stroke: '#faf8f3', lw: 0.8 });
        path(c, [k[1], k[3]]);
        stroke(c, { stroke: '#faf8f3', lw: 0.8 });
      }
      return;
    }
    case 'beam': {
      const n = mul(perp(norm(sub(e.b, e.a))), e.width / 2);
      path(c, [add(e.a, n), add(e.b, n), sub(e.b, n), sub(e.a, n)], true);
      return stroke(c, { ...base, dash: [10, 6], fill: 'rgba(120,110,95,0.10)' });
    }
    case 'slab':
    case 'ceiling':
    case 'tiling': {
      // surfaces: a small marker at the anchor + label; selection of these happens through the properties panel
      const [x, y] = S(c, e.anchor);
      const label = e.kind === 'slab' ? `Slab ${e.thickness}` : e.kind === 'ceiling' ? `Ceiling ${e.height}` : e.target === 'wall' ? 'Wall tiles' : '';
      if (label && view.scale > 0.03) {
        g.save();
        g.fillStyle = mode === 'selected' ? COLORS.select : COLORS.muted;
        g.font = '10px "Segoe UI", Arial';
        g.textAlign = 'center';
        g.fillText(label, x, y + 70 * view.scale * 6 + 10);
        g.restore();
      }
      if (e.kind === 'tiling' && e.target === 'wall' && e.wall) {
        const w = floor.entities[e.wall];
        if (w?.kind === 'wall') {
          path(c, [w.a, w.b]);
          stroke(c, { stroke: e.color, lw: 3, dash: [3, 3] });
        }
      }
      return;
    }
    case 'stairs': {
      const o = stairsOutline(e);
      path(c, o, true);
      stroke(c, { ...base, fill: 'rgba(255,255,255,0.7)' });
      for (let i = 1; i < e.steps; i++) {
        const a = rotatePt(add(e.origin, [i * e.tread, 0]), e.rot, e.origin);
        const b = rotatePt(add(e.origin, [i * e.tread, e.width]), e.rot, e.origin);
        path(c, [a, b]);
        stroke(c, { stroke: col, lw: 0.8, alpha });
      }
      const m0 = rotatePt(add(e.origin, [e.tread * 0.4, e.width / 2]), e.rot, e.origin);
      const m1 = rotatePt(add(e.origin, [e.tread * (e.steps - 0.4), e.width / 2]), e.rot, e.origin);
      path(c, [m0, m1]);
      stroke(c, { stroke: col, lw: 1.2, alpha });
      const ang = angleOf(m0, m1);
      path(c, [fromPolar(m1, ang + 150, 200), m1, fromPolar(m1, ang - 150, 200)]);
      stroke(c, { stroke: col, lw: 1.2, alpha });
      text(c, 'UP', mid(m0, m1), { size: 10, color: COLORS.muted, bg: true });
      return;
    }
    case 'railing': {
      path(c, e.pts);
      stroke(c, { ...base, lw: 2.4 });
      for (const [i, p] of e.pts.entries()) {
        const [x, y] = S(c, p);
        g.save();
        g.fillStyle = col;
        g.fillRect(x - 2, y - 2, 4, 4);
        g.restore();
        void i;
      }
      return;
    }
    case 'roof': {
      path(c, e.pts, true);
      stroke(c, { ...base, dash: [12, 6], fill: 'rgba(190,120,90,0.07)' });
      const b = boundsOf(e.pts);
      text(c, `Roof ${e.roofType} ${e.slope}°`, [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2], { size: 10, color: COLORS.muted });
      return;
    }
    case 'light': {
      const [x, y] = S(c, e.pos);
      g.save();
      g.strokeStyle = col === COLORS.ink ? '#c98a1b' : col;
      g.fillStyle = e.color;
      g.lineWidth = 1.3;
      g.beginPath();
      g.arc(x, y, 8, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        g.beginPath();
        g.moveTo(x + Math.cos(a) * 11, y + Math.sin(a) * 11);
        g.lineTo(x + Math.cos(a) * 15, y + Math.sin(a) * 15);
        g.stroke();
      }
      g.restore();
      return;
    }
    case 'strip':
      path(c, [e.a, e.b]);
      return stroke(c, { stroke: mode === 'selected' ? COLORS.select : e.color, lw: 4, alpha });
    case 'model': {
      path(c, modelCorners(e), true);
      stroke(c, { ...base, fill: 'rgba(120,150,190,0.14)', dash: [6, 4] });
      const k = modelCorners(e);
      path(c, [k[0], k[2]]);
      stroke(c, { stroke: col, lw: 0.7, alpha: 0.5 });
      path(c, [k[1], k[3]]);
      stroke(c, { stroke: col, lw: 0.7, alpha: 0.5 });
      text(c, e.fileName, e.pos, { size: 10, color: COLORS.muted, bg: true });
      return;
    }
    case 'reference': {
      const img = c.images.get(e.url);
      const k = referenceCorners(e);
      if (img && img.complete && plan.settings.showReferences) {
        const [x, y] = S(c, e.pos);
        g.save();
        g.globalAlpha = e.opacity;
        g.translate(x, y);
        g.rotate(rad(e.rot));
        g.drawImage(img, (-e.width / 2) * view.scale, (-e.height / 2) * view.scale, e.width * view.scale, e.height * view.scale);
        g.restore();
      }
      if (mode === 'selected' || mode === 'hover') {
        path(c, k, true);
        stroke(c, { ...base, dash: [6, 4] });
      }
      return;
    }
    case 'dimension': {
      const a = resolveRef(floor, e.refA) ?? e.a;
      const b = resolveRef(floor, e.refB) ?? e.b;
      const d = norm(sub(b, a));
      const n = perp(d);
      const off = mul(n, e.offset);
      const A = add(a, off);
      const B = add(b, off);
      const dc = mode === 'selected' ? COLORS.select : mode === 'preview' ? COLORS.preview : COLORS.dim;
      const ext = (p: Pt, q: Pt) => {
        path(c, [add(p, mul(n, Math.sign(e.offset || 1) * 60)), add(q, mul(n, Math.sign(e.offset || 1) * 120))]);
        stroke(c, { stroke: dc, lw: 0.9 });
      };
      ext(a, A);
      ext(b, B);
      path(c, [A, B]);
      stroke(c, { stroke: dc, lw: 1.1 });
      for (const [p, dir] of [[A, 1], [B, -1]] as [Pt, number][]) {
        path(c, [add(p, add(mul(d, dir * 120), mul(n, 40))), p, add(p, add(mul(d, dir * 120), mul(n, -40)))]);
        stroke(c, { stroke: dc, lw: 1.1 });
      }
      const ang = deg(Math.atan2(d[1], d[0]));
      const flip = ang > 90 || ang < -90;
      text(c, mmToDisplay(dist(a, b), plan.settings), add(mid(A, B), mul(n, 0)), { size: 11, color: dc, rot: flip ? ang + 180 : ang, bg: true, bold: true });
      return;
    }
    case 'text':
      return text(c, e.text, e.pos, { worldSize: e.size, align: 'left', rot: e.rot, color: mode === 'selected' ? COLORS.select : COLORS.ink, bold: false });
    case 'compass': {
      const R = e.size / 2;
      const [x, y] = S(c, e.pos);
      g.save();
      g.translate(x, y);
      g.rotate(rad(e.north));
      g.strokeStyle = mode === 'selected' ? COLORS.select : COLORS.ink;
      g.lineWidth = 1.4;
      const r = R * view.scale;
      g.beginPath();
      g.arc(0, 0, r, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = COLORS.ink;
      g.beginPath();
      g.moveTo(0, -r);
      g.lineTo(r * 0.3, r * 0.45);
      g.lineTo(0, r * 0.2);
      g.lineTo(-r * 0.3, r * 0.45);
      g.closePath();
      g.fill();
      g.fillStyle = COLORS.ink;
      g.font = `600 ${Math.max(10, r * 0.4)}px Arial`;
      g.textAlign = 'center';
      g.fillText('N', 0, -r - 6);
      g.restore();
      return;
    }
    case 'angle': {
      path(c, [e.a, e.v, e.b]);
      stroke(c, { stroke: mode === 'selected' ? COLORS.select : COLORS.dim, lw: 1 });
      const a0 = angleOf(e.v, e.a);
      const a1 = angleOf(e.v, e.b);
      const R = Math.min(dist(e.v, e.a), dist(e.v, e.b)) * 0.35;
      const delta = ((a1 - a0 + 540) % 360) - 180;
      const pts: Pt[] = [];
      for (let i = 0; i <= 20; i++) pts.push(fromPolar(e.v, a0 + (delta * i) / 20, R));
      path(c, pts);
      stroke(c, { stroke: COLORS.dim, lw: 1.2 });
      const ang = Math.abs(delta);
      text(c, `${ang.toFixed(1)}°`, fromPolar(e.v, a0 + delta / 2, R * 1.45), { size: 11, color: COLORS.dim, bg: true, bold: true });
      return;
    }
    case 'xy': {
      const [x, y] = S(c, e.pos);
      g.save();
      g.strokeStyle = mode === 'selected' ? COLORS.select : COLORS.dim;
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(x - 6, y);
      g.lineTo(x + 6, y);
      g.moveTo(x, y - 6);
      g.lineTo(x, y + 6);
      g.stroke();
      g.restore();
      text(c, `X ${Math.round(e.pos[0])}  Z ${Math.round(e.pos[1])}`, add(e.pos, [60, -90 / Math.max(view.scale * 10, 0.5)]), { size: 10, color: COLORS.dim, align: 'left', bg: true });
      return;
    }
    case 'radial': {
      const t = floor.entities[e.target];
      let ctr: Pt | null = null;
      let r = 0;
      if (t?.kind === 'circle') {
        ctr = t.c;
        r = t.r;
      } else if (t?.kind === 'arc') {
        const g2 = arcFrom3(t.p1, t.p2, t.p3);
        if (g2) {
          ctr = g2.c;
          r = g2.r;
        }
      }
      if (!ctr) return;
      const tip = fromPolar(ctr, e.angle, r);
      const from = e.mode === 'diameter' ? fromPolar(ctr, e.angle + 180, r) : ctr;
      path(c, [from, tip, fromPolar(tip, e.angle, 300)]);
      stroke(c, { stroke: mode === 'selected' ? COLORS.select : COLORS.dim, lw: 1.1 });
      const val = e.mode === 'diameter' ? r * 2 : r;
      text(c, `${e.mode === 'diameter' ? 'Ø' : 'R'} ${mmToDisplay(val, plan.settings)}`, fromPolar(tip, e.angle, 600), { size: 11, color: COLORS.dim, bg: true, bold: true });
      return;
    }
    case 'leader': {
      path(c, e.pts);
      stroke(c, { stroke: mode === 'selected' ? COLORS.select : COLORS.ink, lw: 1.2 });
      const tip = e.pts[0];
      const nxt = e.pts[1] ?? tip;
      const ang = angleOf(tip, nxt);
      path(c, [fromPolar(tip, ang + 20, 160), tip, fromPolar(tip, ang - 20, 160)]);
      stroke(c, { stroke: COLORS.ink, lw: 1.2 });
      const last = e.pts[e.pts.length - 1];
      text(c, e.text, add(last, [40, 0]), { worldSize: e.size, align: 'left', color: COLORS.ink, bg: true });
      return;
    }
    default:
      return;
  }
}

// ---------------------------------------------------------------- nodes (furniture & cabinetry)

function drawNodes(c: DrawCtx) {
  const { g, nodes, selection, hovered, mode, view } = c;
  for (const n of nodes) {
    const th = rad(n.rotationY);
    const to = (lx: number, lz: number): Pt => [n.position[0] + lx * Math.cos(th) + lz * Math.sin(th), n.position[2] - lx * Math.sin(th) + lz * Math.cos(th)];
    const hw = n.size.w / 2;
    const hd = n.size.d / 2;
    const outline: Pt[] = [to(-hw, -hd), to(hw, -hd), to(hw, hd), to(-hw, hd)];
    const sel = selection.has(n.id);
    const hov = hovered === n.id;
    const dimmed = mode === 'architecture' ? false : false;
    path(c, outline, true);
    g.save();
    g.fillStyle = sel ? 'rgba(29,111,229,0.12)' : 'rgba(255,255,255,0.88)';
    g.fill();
    g.restore();
    if (n.type === 'furniture' && n.visible) {
      // plan view built from the real 3D parts
      for (const part of buildParts(n)) {
        if (part.anim) continue;
        let [sx, , sz] = part.size;
        if (part.shape === 'cylinder' && part.rot && Math.abs(part.rot[2]) === 90) [sx, sz] = [part.size[1], part.size[0]];
        const pts: Pt[] = [to(part.center[0] - sx / 2, part.center[2] - sz / 2), to(part.center[0] + sx / 2, part.center[2] - sz / 2), to(part.center[0] + sx / 2, part.center[2] + sz / 2), to(part.center[0] - sx / 2, part.center[2] + sz / 2)];
        path(c, pts, true);
        stroke(c, { stroke: 'rgba(60,56,48,0.55)', lw: 0.8 });
      }
    } else {
      // cabinetry: front edge emphasised + door/drawer lines
      path(c, [outline[2], outline[3]]);
      stroke(c, { stroke: COLORS.ink, lw: 2.4 });
      for (const part of buildParts(n)) {
        if (part.role !== 'door' && part.role !== 'drawer_front') continue;
        const hwp = part.size[0] / 2;
        const z = part.center[2] + part.size[2] / 2;
        path(c, [to(part.center[0] - hwp, z), to(part.center[0] + hwp, z)]);
        stroke(c, { stroke: 'rgba(38,39,43,0.55)', lw: 0.7 });
      }
    }
    path(c, outline, true);
    stroke(c, { stroke: sel ? COLORS.select : hov ? COLORS.hover : COLORS.ink, lw: sel ? 2.2 : 1.3 });
    void dimmed;
    if (view.scale > 0.05 && Math.min(n.size.w, n.size.d) * view.scale > 26) text(c, n.name, [n.position[0], n.position[2]], { size: 10, color: COLORS.muted, bg: true });
  }
}

// ---------------------------------------------------------------- handles & overlays

function drawGrips(c: DrawCtx, handles: { p: Pt }[]) {
  const { g } = c;
  g.save();
  for (const h of handles) {
    const [x, y] = S(c, h.p);
    g.fillStyle = '#fff';
    g.strokeStyle = COLORS.select;
    g.lineWidth = 1.5;
    g.beginPath();
    g.rect(x - 4, y - 4, 8, 8);
    g.fill();
    g.stroke();
  }
  g.restore();
}

function drawDrawable(c: DrawCtx, d: Drawable) {
  const { g, view } = c;
  const col = d.style === 'ok' ? COLORS.ok : d.style === 'bad' ? COLORS.bad : d.style === 'dim' ? COLORS.dim : d.style === 'guide' ? COLORS.guide : COLORS.preview;
  switch (d.kind) {
    case 'entity':
      if (d.entity?.kind === 'door' || d.entity?.kind === 'window') return drawOpening(c, d.entity, col, 0.9);
      if (d.entity?.kind === 'wall') {
        const w = d.entity;
        const n = mul(perp(norm(sub(w.b, w.a))), w.thickness / 2);
        path(c, [add(w.a, n), add(w.b, n), sub(w.b, n), sub(w.a, n)], true);
        return stroke(c, { stroke: COLORS.preview, lw: 1.4, fill: 'rgba(29,111,229,0.22)' });
      }
      if (d.entity) return drawEntity(c, d.entity, d.style === 'ok' ? 'ok' : d.style === 'bad' ? 'bad' : 'preview');
      return;
    case 'line':
      path(c, d.pts!);
      return stroke(c, { stroke: col, lw: 1.3, dash: d.style === 'dim' || d.style === 'guide' ? [6, 4] : undefined });
    case 'poly':
      path(c, d.pts!, !!d.closed);
      return stroke(c, { stroke: col, lw: 1.4, fill: d.closed ? 'rgba(29,111,229,0.08)' : undefined });
    case 'rect': {
      const [a, b] = d.pts!;
      path(c, [a, [b[0], a[1]], b, [a[0], b[1]]], true);
      return stroke(c, { stroke: col, lw: 1, dash: [5, 4], fill: d.style === 'ok' ? 'rgba(47,143,85,0.10)' : 'rgba(29,111,229,0.08)' });
    }
    case 'circle': {
      const [x, y] = S(c, d.c!);
      g.beginPath();
      g.arc(x, y, d.r! * view.scale, 0, Math.PI * 2);
      return stroke(c, { stroke: col, lw: 1.4 });
    }
    case 'point':
      for (const p of d.pts!) {
        const [x, y] = S(c, p);
        g.save();
        g.fillStyle = col;
        g.fillRect(x - 3, y - 3, 6, 6);
        g.restore();
      }
      return;
    case 'text':
      return text(c, d.text ?? '', d.pts![0], { size: 11, color: col, bg: true, bold: true });
    default:
      return;
  }
}

function drawSnap(c: DrawCtx, snap: SnapResult | null) {
  if (!snap || snap.kind === 'none') return;
  const { g } = c;
  for (const gl of snap.guides) {
    path(c, [gl.a, gl.b]);
    stroke(c, { stroke: COLORS.guide, lw: 1, dash: [4, 4] });
  }
  if (snap.kind === 'grid') return;
  const [x, y] = S(c, snap.pt);
  g.save();
  g.strokeStyle = '#17a34a';
  g.lineWidth = 1.8;
  g.beginPath();
  if (snap.kind === 'endpoint') g.rect(x - 6, y - 6, 12, 12);
  else if (snap.kind === 'midpoint') {
    g.moveTo(x - 6, y + 5);
    g.lineTo(x + 6, y + 5);
    g.lineTo(x, y - 6);
    g.closePath();
  } else if (snap.kind === 'intersection') {
    g.moveTo(x - 6, y - 6);
    g.lineTo(x + 6, y + 6);
    g.moveTo(x + 6, y - 6);
    g.lineTo(x - 6, y + 6);
  } else if (snap.kind === 'center') g.arc(x, y, 6, 0, Math.PI * 2);
  else g.arc(x, y, 4, 0, Math.PI * 2);
  g.stroke();
  g.restore();
  if (snap.label) text(c, snap.label, [snap.pt[0], snap.pt[1]], { size: 10, color: '#17803d', align: 'left', bg: true });
}

// ---------------------------------------------------------------- main

export function drawScene(c: DrawCtx, opts: { preview: Drawable[]; snap: SnapResult | null; grips: { p: Pt }[]; cursor: Pt | null }) {
  const { g } = c;
  g.save();
  drawGrid(c);
  const ents = floorEntities(c.floor).filter((e) => !e.hidden && (!c.floor.isolated || c.floor.isolated.includes(e.id)));
  const lockedKinds = c.mode === 'interior' ? new Set(ARCHITECTURE_KINDS) : null;
  g.globalAlpha = 1;
  // references and hatch/tiling surfaces first
  for (const e of ents) if (e.kind === 'reference') drawEntity(c, e, c.selection.has(e.id) ? 'selected' : 'normal');
  drawRooms(c);
  for (const e of ents) if (e.kind === 'hatch') drawEntity(c, e, c.selection.has(e.id) ? 'selected' : 'normal');
  // architecture
  g.save();
  if (lockedKinds) g.globalAlpha = 0.85;
  drawWalls(c);
  g.restore();
  for (const e of ents) {
    if (e.kind === 'hatch' || e.kind === 'reference' || e.kind === 'dimension' || e.kind === 'text' || e.kind === 'door' || e.kind === 'window' || e.kind === 'wall') continue;
    if (e.kind === 'light' && !c.plan.settings.showLights) continue;
    drawEntity(c, e, c.selection.has(e.id) ? 'selected' : c.hovered === e.id ? 'hover' : 'normal');
  }
  drawNodes(c);
  if (c.plan.settings.showDimensions || true) for (const e of ents) if (e.kind === 'dimension' || e.kind === 'text') drawEntity(c, e, c.selection.has(e.id) ? 'selected' : 'normal');
  // selected walls / openings overlay already coloured in drawWalls
  drawGrips(c, opts.grips);
  for (const d of opts.preview) drawDrawable(c, d);
  drawSnap(c, opts.snap);
  if (c.highlight) {
    const [x, y] = S(c, c.highlight.at);
    const t = Math.min(1, c.highlight.age / 900);
    g.save();
    g.strokeStyle = `rgba(210,59,52,${1 - t})`;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(x, y, 14 + t * 50, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  }
  g.restore();
}

export { insetPolygon, polygonArea };
