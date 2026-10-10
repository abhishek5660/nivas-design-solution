import { footprint, wallEdges } from '../scene';
import type { Part, SceneDoc, SceneNode } from '../types';
import { allNodeParts, nodeCodes } from './resolve';

export type DrawingView = 'plan' | 'front' | 'back' | 'left' | 'right';

export type Prim =
  | { t: 'poly'; pts: [number, number][]; fill?: string; stroke: string; sw: number; layer: string; dash?: boolean }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; sw: number; layer: string; dash?: boolean }
  | { t: 'text'; x: number; y: number; text: string; size: number; anchor: 'start' | 'middle' | 'end'; layer: string; rot?: number };

export interface Drawing {
  view: DrawingView;
  title: string;
  prims: Prim[];
  /** bounds in drawing space (y up) */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  scaleNote: string;
  dimensions: { label: string; value: number }[];
  nodeCount: number;
}

export interface DrawingOptions {
  showInterior?: boolean; // hide doors/drawer fronts to reveal the internals
  dimensions?: boolean;
  labels?: boolean;
  room?: boolean;
  onlyNodeIds?: string[];
}

type V3 = [number, number, number];

function localCorners(part: Part): V3[] {
  let [sx, sy, sz] = part.size;
  if (part.shape === 'cylinder') {
    const r = part.rot ?? [0, 0, 0];
    if (Math.abs(r[2]) === 90) [sx, sy, sz] = [part.size[1], part.size[0], part.size[2]];
    else if (Math.abs(r[0]) === 90) [sx, sy, sz] = [part.size[0], part.size[2], part.size[1]];
  }
  const [cx, cy, cz] = part.center;
  const out: V3[] = [];
  for (const dx of [-1, 1]) for (const dy of [-1, 1]) for (const dz of [-1, 1]) out.push([cx + (dx * sx) / 2, cy + (dy * sy) / 2, cz + (dz * sz) / 2]);
  return out;
}

function toWorld(node: SceneNode, p: V3): V3 {
  const th = (node.rotationY * Math.PI) / 180;
  const c = Math.cos(th);
  const s = Math.sin(th);
  return [node.position[0] + p[0] * c + p[2] * s, node.position[1] + p[1], node.position[2] - p[0] * s + p[2] * c];
}

function convexHull(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  const up: [number, number][] = [];
  for (const q of [...p].reverse()) {
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
    up.push(q);
  }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

const fmt = (n: number) => String(Math.round(n));

/** Projects a part into drawing space. Returns polygon and a depth key for painter's ordering. */
function project(node: SceneNode, part: Part, view: DrawingView): { pts: [number, number][]; depth: number } {
  const w = localCorners(part).map((c) => toWorld(node, c));
  let pts: [number, number][];
  let depth: number;
  switch (view) {
    case 'plan':
      pts = w.map((p) => [p[0], -p[2]] as [number, number]);
      depth = Math.max(...w.map((p) => p[1]));
      break;
    case 'front':
      pts = w.map((p) => [p[0], p[1]] as [number, number]);
      depth = Math.max(...w.map((p) => p[2]));
      break;
    case 'back':
      pts = w.map((p) => [-p[0], p[1]] as [number, number]);
      depth = -Math.min(...w.map((p) => p[2]));
      break;
    case 'left':
      pts = w.map((p) => [p[2], p[1]] as [number, number]);
      depth = -Math.min(...w.map((p) => p[0]));
      break;
    default:
      pts = w.map((p) => [-p[2], p[1]] as [number, number]);
      depth = Math.max(...w.map((p) => p[0]));
  }
  return { pts: convexHull(pts), depth };
}

const VIEW_TITLE: Record<DrawingView, string> = {
  plan: 'TOP PLAN',
  front: 'FRONT ELEVATION',
  back: 'BACK ELEVATION',
  left: 'LEFT ELEVATION',
  right: 'RIGHT ELEVATION',
};

function dimLine(prims: Prim[], x1: number, y1: number, x2: number, y2: number, offset: number, text: string, vertical: boolean, size = 55) {
  const layer = 'DIMS';
  const tick = 40;
  if (!vertical) {
    const y = y1 + offset;
    prims.push({ t: 'line', x1, y1: y1, x2: x1, y2: y + Math.sign(offset) * 25, sw: 0.7, layer });
    prims.push({ t: 'line', x1: x2, y1: y2, x2, y2: y + Math.sign(offset) * 25, sw: 0.7, layer });
    prims.push({ t: 'line', x1, y1: y, x2, y2: y, sw: 1.1, layer });
    prims.push({ t: 'line', x1: x1 - tick / 2, y1: y - tick / 2, x2: x1 + tick / 2, y2: y + tick / 2, sw: 1.4, layer });
    prims.push({ t: 'line', x1: x2 - tick / 2, y1: y - tick / 2, x2: x2 + tick / 2, y2: y + tick / 2, sw: 1.4, layer });
    prims.push({ t: 'text', x: (x1 + x2) / 2, y: y + (offset < 0 ? -size * 1.25 : size * 0.4), text, size, anchor: 'middle', layer });
  } else {
    const x = x1 + offset;
    prims.push({ t: 'line', x1: x1, y1, x2: x + Math.sign(offset) * 25, y2: y1, sw: 0.7, layer });
    prims.push({ t: 'line', x1: x2, y1: y2, x2: x + Math.sign(offset) * 25, y2, sw: 0.7, layer });
    prims.push({ t: 'line', x1: x, y1, x2: x, y2, sw: 1.1, layer });
    prims.push({ t: 'line', x1: x - tick / 2, y1: y1 - tick / 2, x2: x + tick / 2, y2: y1 + tick / 2, sw: 1.4, layer });
    prims.push({ t: 'line', x1: x - tick / 2, y1: y2 - tick / 2, x2: x + tick / 2, y2: y2 + tick / 2, sw: 1.4, layer });
    prims.push({ t: 'text', x: x + (offset < 0 ? -size * 0.4 : size * 1.2), y: (y1 + y2) / 2, text, size, anchor: 'middle', layer, rot: 90 });
  }
}

export function buildDrawing(doc: SceneDoc, view: DrawingView, opts: DrawingOptions = {}): Drawing {
  const { showInterior = false, dimensions = true, labels = true, room = true } = opts;
  const codes = nodeCodes(doc);
  const prims: Prim[] = [];
  const dims: Drawing['dimensions'] = [];
  const entries = allNodeParts(doc).filter((e) => !opts.onlyNodeIds || opts.onlyNodeIds.includes(e.node.id));
  const items: { poly: [number, number][]; depth: number; part: Part; node: SceneNode }[] = [];
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const grow = (x: number, y: number) => {
    bounds.minX = Math.min(bounds.minX, x);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxY = Math.max(bounds.maxY, y);
  };
  for (const { node, parts } of entries) {
    for (const part of parts) {
      if (showInterior && (part.role === 'door' || part.role === 'drawer_front' || part.role === 'plinth') && view !== 'plan') continue;
      if (showInterior && part.role === 'hardware' && part.slot === 'handle') continue;
      if (part.role === 'led' && view !== 'plan') continue;
      const pr = project(node, part, view);
      items.push({ poly: pr.pts, depth: pr.depth, part, node });
      pr.pts.forEach(([x, y]) => grow(x, y));
    }
  }
  if (!items.length) {
    return { view, title: VIEW_TITLE[view], prims: [], bounds: { minX: 0, minY: 0, maxX: 1000, maxY: 1000 }, scaleNote: '', dimensions: [], nodeCount: 0 };
  }
  items.sort((a, b) => a.depth - b.depth);
  for (const it of items) {
    const fill = it.part.role === 'appliance' ? '#e9e9e9' : it.part.role === 'led' ? '#fff6dd' : it.part.slot === 'glass' || it.part.slot === 'mirror' ? '#e8f2f6' : '#ffffff';
    const sw = it.part.sheet ? 0.9 : 0.6;
    prims.push({ t: 'poly', pts: it.poly, fill, stroke: '#1b1b1b', sw, layer: it.part.role === 'hardware' ? 'HARDWARE' : 'PARTS' });
  }
  // Room outline
  if (room) {
    if (view === 'plan') {
      const edges = wallEdges(doc.room);
      for (const e of edges) {
        prims.push({ t: 'line', x1: e.p0[0], y1: -e.p0[1], x2: e.p1[0], y2: -e.p1[1], sw: 2.2, layer: 'ROOM' });
        grow(e.p0[0], -e.p0[1]);
        grow(e.p1[0], -e.p1[1]);
      }
      for (const o of doc.room.openings) {
        const e = edges[o.wall];
        if (!e) continue;
        const a: [number, number] = [e.p0[0] + e.dir[0] * o.offset, e.p0[1] + e.dir[1] * o.offset];
        const b: [number, number] = [e.p0[0] + e.dir[0] * (o.offset + o.width), e.p0[1] + e.dir[1] * (o.offset + o.width)];
        prims.push({ t: 'line', x1: a[0], y1: -a[1], x2: b[0], y2: -b[1], sw: 4.5, layer: 'ROOM', dash: true });
        prims.push({ t: 'text', x: (a[0] + b[0]) / 2 + e.normal[0] * 70, y: -((a[1] + b[1]) / 2 + e.normal[1] * 70), text: `${o.kind === 'window' ? 'W' : 'D'} ${fmt(o.width)}`, size: 45, anchor: 'middle', layer: 'ROOM' });
      }
      if (dimensions) {
        for (const e of edges) {
          const mx = (e.p0[0] + e.p1[0]) / 2 - e.normal[0] * 230;
          const mz = (e.p0[1] + e.p1[1]) / 2 - e.normal[1] * 230;
          const horizontal = Math.abs(e.dir[0]) > Math.abs(e.dir[1]);
          prims.push({ t: 'text', x: mx, y: -mz - (horizontal ? 20 : 0), text: `${fmt(e.length)}`, size: 60, anchor: 'middle', layer: 'DIMS', rot: horizontal ? 0 : 90 });
          grow(mx, -mz);
        }
      }
    } else {
      // floor line
      const fl = { minX: bounds.minX - 300, maxX: bounds.maxX + 300 };
      prims.push({ t: 'line', x1: fl.minX, y1: 0, x2: fl.maxX, y2: 0, sw: 1.8, layer: 'ROOM' });
      grow(fl.minX, 0);
      grow(fl.maxX, 0);
      if (doc.room.height) {
        prims.push({ t: 'line', x1: fl.minX, y1: doc.room.height, x2: fl.maxX, y2: doc.room.height, sw: 0.8, layer: 'ROOM', dash: true });
        grow(0, doc.room.height);
      }
    }
  }
  // Dimensions
  if (dimensions) {
    if (view === 'plan') {
      const w = bounds.maxX - bounds.minX;
      const d = bounds.maxY - bounds.minY;
      const margin = 350;
      dimLine(prims, bounds.minX, bounds.minY, bounds.maxX, bounds.minY, -margin, `${fmt(w)}`, false);
      dimLine(prims, bounds.minX, bounds.minY, bounds.minX, bounds.maxY, -margin, `${fmt(d)}`, true);
      dims.push({ label: 'Plan width', value: w }, { label: 'Plan depth', value: d });
      // per-unit width chain
      if (entries.length <= 40) {
        for (const { node } of entries) {
          if (node.type === 'countertop' || node.type === 'appliance') continue;
          const f = footprint(node);
          const xs = f.map((p) => p[0]);
          const zs = f.map((p) => -p[1]);
          const x0 = Math.min(...xs);
          const x1 = Math.max(...xs);
          const z1 = Math.max(...zs);
          if (labels) prims.push({ t: 'text', x: (x0 + x1) / 2, y: (Math.min(...zs) + z1) / 2 - 20, text: codes[node.id], size: 55, anchor: 'middle', layer: 'TEXT' });
        }
      }
    } else {
      const solid = items.filter((i) => i.part.role !== 'led');
      const minX = Math.min(...solid.flatMap((i) => i.poly.map((p) => p[0])));
      const maxX = Math.max(...solid.flatMap((i) => i.poly.map((p) => p[0])));
      const maxY = Math.max(...solid.flatMap((i) => i.poly.map((p) => p[1])));
      const minY = Math.min(0, ...solid.flatMap((i) => i.poly.map((p) => p[1])));
      // unit width chain (cabinets/wardrobes/tv panels), sorted along x
      const chain = entries
        .filter(({ node }) => ['cabinet', 'wardrobe', 'tv_panel', 'box'].includes(node.type))
        .map(({ node }) => {
          const f = footprint(node);
          const coords = f.map((p) => (view === 'front' ? p[0] : view === 'back' ? -p[0] : view === 'left' ? p[1] : -p[1]));
          return { node, x0: Math.min(...coords), x1: Math.max(...coords) };
        })
        .sort((a, b) => a.x0 - b.x0);
      if (chain.length) {
        // merge those sharing the same extents so stacked units (wall over base) are dimensioned once
        const seen = new Set<string>();
        const uniq = chain.filter((c) => {
          const k = `${Math.round(c.x0)}-${Math.round(c.x1)}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        if (uniq.length <= 24) {
          for (const c of uniq) {
            dimLine(prims, c.x0, minY, c.x1, minY, -200, fmt(c.x1 - c.x0), false, 48);
            if (labels) {
              const code = codes[c.node.id];
              prims.push({ t: 'text', x: (c.x0 + c.x1) / 2, y: c.node.position[1] + c.node.size.h / 2, text: code, size: 56, anchor: 'middle', layer: 'TEXT' });
            }
          }
        }
        dims.push(...chain.slice(0, 1).map((c) => ({ label: `${c.node.name} width`, value: c.x1 - c.x0 })));
      }
      dimLine(prims, minX, minY, maxX, minY, -450, fmt(maxX - minX), false, 62);
      dimLine(prims, maxX, minY, maxX, maxY, 350, fmt(maxY - minY), true, 62);
      dims.push({ label: 'Overall width', value: maxX - minX }, { label: 'Overall height', value: maxY - minY });
      // vertical dims for tall units that differ from overall
      const talls = entries.filter(({ node }) => node.type === 'wardrobe' || node.type === 'tv_panel');
      if (talls.length === 1) {
        const n = talls[0].node;
        const x = view === 'front' ? n.position[0] - n.size.w / 2 : minX;
        dimLine(prims, x, 0, x, n.size.h, -300, fmt(n.size.h), true, 55);
      }
    }
  }
  const pad = 700;
  const b = { minX: bounds.minX - pad, minY: bounds.minY - pad, maxX: bounds.maxX + pad, maxY: bounds.maxY + pad };
  return { view, title: VIEW_TITLE[view], prims, bounds: b, scaleNote: 'All dimensions in mm', dimensions: dims, nodeCount: entries.length };
}

// ---------- Serialisers ----------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function drawingToSVG(d: Drawing, opts: { maxPx?: number; title?: string; bg?: string } = {}): string {
  const { minX, minY, maxX, maxY } = d.bounds;
  const w = maxX - minX;
  const h = maxY - minY;
  const body = d.prims
    .map((p) => {
      if (p.t === 'poly') return `<polygon points="${p.pts.map(([x, y]) => `${(x - minX).toFixed(1)},${(maxY - y).toFixed(1)}`).join(' ')}" fill="${p.fill ?? 'none'}" stroke="${p.stroke}" stroke-width="${Math.max(1, p.sw * 1.1)}" vector-effect="non-scaling-stroke" stroke-linejoin="round" data-layer="${p.layer}"/>`;
      if (p.t === 'line') return `<line x1="${(p.x1 - minX).toFixed(1)}" y1="${(maxY - p.y1).toFixed(1)}" x2="${(p.x2 - minX).toFixed(1)}" y2="${(maxY - p.y2).toFixed(1)}" stroke="${p.layer === 'DIMS' ? '#a0701a' : '#1b1b1b'}" stroke-width="${Math.max(0.8, p.sw)}" vector-effect="non-scaling-stroke"${p.dash ? ' stroke-dasharray="9 6"' : ''} data-layer="${p.layer}"/>`;
      const x = (p.x - minX).toFixed(1);
      const y = (maxY - p.y).toFixed(1);
      const rot = p.rot ? ` transform="rotate(${-p.rot} ${x} ${y})"` : '';
      return `<text x="${x}" y="${y}" font-size="${p.size}" text-anchor="${p.anchor}" fill="${p.layer === 'DIMS' ? '#a0701a' : '#1b1b1b'}" font-family="Inter, Arial, sans-serif"${rot}>${esc(p.text)}</text>`;
    })
    .join('\n');
  const title = opts.title ?? d.title;
  const tH = 220;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(0)} ${(h + tH).toFixed(0)}" width="${opts.maxPx ?? 1200}" data-view="${d.view}">
<rect width="${w.toFixed(0)}" height="${(h + tH).toFixed(0)}" fill="${opts.bg ?? '#ffffff'}"/>
<g>${body}</g>
<text x="40" y="${(h + 130).toFixed(0)}" font-size="90" font-weight="700" fill="#1b1b1b" font-family="Inter, Arial, sans-serif">${esc(title)}</text>
<text x="${(w - 40).toFixed(0)}" y="${(h + 130).toFixed(0)}" font-size="60" text-anchor="end" fill="#666" font-family="Inter, Arial, sans-serif">${esc(d.scaleNote)}</text>
</svg>`;
}

/** Minimal ASCII DXF (AC1009 / R12) with LINE and TEXT entities. Coordinates are millimetres. */
export function drawingToDXF(d: Drawing): string {
  const out: string[] = [];
  const g = (code: number, value: string | number) => out.push(String(code), String(value));
  const layers = Array.from(new Set(d.prims.map((p) => p.layer)));
  const colors: Record<string, number> = { PARTS: 7, HARDWARE: 3, DIMS: 2, TEXT: 7, ROOM: 5 };
  g(0, 'SECTION');
  g(2, 'HEADER');
  g(9, '$ACADVER');
  g(1, 'AC1009');
  g(9, '$INSUNITS');
  g(70, 4);
  g(0, 'ENDSEC');
  g(0, 'SECTION');
  g(2, 'TABLES');
  g(0, 'TABLE');
  g(2, 'LAYER');
  g(70, layers.length);
  for (const l of layers) {
    g(0, 'LAYER');
    g(2, l);
    g(70, 0);
    g(62, colors[l] ?? 7);
    g(6, 'CONTINUOUS');
  }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');
  g(0, 'SECTION');
  g(2, 'ENTITIES');
  const line = (layer: string, x1: number, y1: number, x2: number, y2: number) => {
    g(0, 'LINE');
    g(8, layer);
    g(10, x1.toFixed(3));
    g(20, y1.toFixed(3));
    g(30, 0);
    g(11, x2.toFixed(3));
    g(21, y2.toFixed(3));
    g(31, 0);
  };
  for (const p of d.prims) {
    if (p.t === 'line') line(p.layer, p.x1, p.y1, p.x2, p.y2);
    else if (p.t === 'poly') for (let i = 0; i < p.pts.length; i++) line(p.layer, p.pts[i][0], p.pts[i][1], p.pts[(i + 1) % p.pts.length][0], p.pts[(i + 1) % p.pts.length][1]);
    else {
      g(0, 'TEXT');
      g(8, p.layer);
      g(10, p.x.toFixed(3));
      g(20, p.y.toFixed(3));
      g(30, 0);
      g(40, p.size);
      g(1, p.text);
      if (p.rot) g(50, p.rot);
      if (p.anchor !== 'start') {
        g(72, p.anchor === 'middle' ? 1 : 2);
        g(11, p.x.toFixed(3));
        g(21, p.y.toFixed(3));
        g(31, 0);
      }
    }
  }
  g(0, 'ENDSEC');
  g(0, 'EOF');
  return out.join('\r\n') + '\r\n';
}
