import { add, angleBetween, angleOf, arcFrom3, arcPoints, boundsOf, circlePoints, dist, dot, fromPolar, mid, mul, norm, perp, pointInPolygon, pointSegment, polygonArea, rad, rotatePt, round, same, sub, type Box } from './geom';
import { entityBounds, entityHandles, entityLabel, entityPaths, findHandleAt, handlePoint, rectCorners, rotateEntity, stairsOutline, translateEntity } from './entities';
import { addEntities, displayToMm, mmToDisplay, removeEntities, updateEntity } from './model';
import { applyGrip, copyEntities, createComponent, expandSelection, extendEntity, filletEntities, insertComponent, mirrorEntities, moveEntities, offsetEntity, rotateEntities, scaleEntities, trimEntity } from './ops';
import { pickEntity, pickInBox, withGroups } from './pick';
import { roomAt } from './rooms';
import { newId, normalizeWalls, nearestWall, placeOpening, wallGeometries, floorWalls, wallLen } from './walls';
import type { Entity, Floor, PlanSettings, Pt, Room, WallE } from './types';
import type { Drawable, OptionField, PlanHost, PlanPointer, PlanTool, ToolId, ToolOptions, ToolState } from './toolHost';

// ---------- typed (numeric) input ----------

export type Typed =
  | { kind: 'rel'; d: Pt }
  | { kind: 'polar'; len: number; angle: number }
  | { kind: 'len'; len: number }
  | { kind: 'pair'; a: number; b: number }
  | { kind: 'num'; v: number };

const split2 = (t: string) => t.split(/[,;x×]\s*|\s+x\s+/i);

export function parseTyped(text: string, s: PlanSettings): Typed | null {
  const t = text.trim();
  if (!t) return null;
  if (t.startsWith('@')) {
    const parts = split2(t.slice(1));
    if (parts.length !== 2) return null;
    const a = displayToMm(parts[0], s);
    const b = displayToMm(parts[1], s);
    return a == null || b == null ? null : { kind: 'rel', d: [a, b] };
  }
  const pol = /^(.+?)\s*<\s*(-?\d+(?:\.\d+)?)$/.exec(t);
  if (pol) {
    const len = displayToMm(pol[1], s);
    return len == null ? null : { kind: 'polar', len, angle: parseFloat(pol[2]) };
  }
  const parts = split2(t);
  if (parts.length === 2) {
    const a = displayToMm(parts[0], s);
    const b = displayToMm(parts[1], s);
    return a == null || b == null ? null : { kind: 'pair', a, b };
  }
  const v = displayToMm(t, s);
  if (v == null) return null;
  return { kind: 'len', len: v };
}

/** Next point from typed input given the previous point and the cursor direction. */
export function typedPoint(t: Typed, ref: Pt | null, cursor: Pt): Pt | null {
  if (t.kind === 'pair') return [t.a, t.b];
  if (!ref) return null;
  if (t.kind === 'rel') return add(ref, t.d);
  if (t.kind === 'polar') return fromPolar(ref, t.angle, t.len);
  if (t.kind === 'len') {
    const a = dist(ref, cursor) < 1e-6 ? 0 : angleOf(ref, cursor);
    return fromPolar(ref, a, t.len);
  }
  return null;
}

// ---------- shared helpers ----------

type E = Entity;
const mk = <T extends E>(e: Omit<T, 'id'> & { id?: string }): T => ({ id: e.id ?? newId((e as { kind: string }).kind), ...e }) as T;
const rpt = (p: Pt): Pt => [round(p[0], 2), round(p[1], 2)];
const opt = <T extends string | number | boolean>(h: PlanHost, tool: ToolId, key: string): T => h.options(tool)[key] as T;
const num = (h: PlanHost, tool: ToolId, key: string) => Number(h.options(tool)[key]);

function commitAdd(h: PlanHost, label: string, es: E[], select = true): string[] {
  let f = addEntities(h.floor(), es);
  if (es.some((e) => e.kind === 'wall')) f = normalizeWalls(f);
  h.commit(label, f, select ? es.map((e) => e.id) : undefined);
  return es.map((e) => e.id);
}

function guard(h: PlanHost): boolean {
  if (h.locked()) {
    h.say('The design is locked. Unlock it (View → Lock Des) to edit.', 'warn');
    return false;
  }
  return true;
}

const ghost = (e: E): Drawable => ({ kind: 'entity', entity: e, style: 'preview' });
const line = (a: Pt, b: Pt, style: Drawable['style'] = 'preview'): Drawable => ({ kind: 'line', pts: [a, b], style });

function closedShapeAt(f: Floor, p: Pt): E | null {
  let best: { e: E; a: number } | null = null;
  for (const id of f.order) {
    const e = f.entities[id];
    if (!e || e.hidden) continue;
    if (e.kind !== 'rect' && e.kind !== 'polygon' && e.kind !== 'circle' && !(e.kind === 'polyline' && e.closed)) continue;
    const path = entityPaths(f, e)[0];
    if (!path || !pointInPolygon(p, path.pts)) continue;
    const a = Math.abs(polygonArea(path.pts));
    if (!best || a < best.a) best = { e, a };
  }
  return best?.e ?? null;
}

export const closedOutline = (f: Floor, e: E): Pt[] | null => {
  if (e.kind === 'rect') return rectCorners(e.p1, e.p2);
  if (e.kind === 'polygon') return e.pts;
  if (e.kind === 'polyline' && e.closed) return e.pts;
  if (e.kind === 'circle') return circlePoints(e.c, e.r, 48);
  void f;
  return null;
};

// ---------- option schemas ----------

const sel = (v: [string, string][]): OptionField['options'] => v.map(([value, label]) => ({ value, label }));
const N = (key: string, label: string, unit = 'mm', min = 0, max = 100000, step = 10): OptionField => ({ key, label, type: 'number', unit, min, max, step });

// ---------- two-point creators ----------

function twoPoint(
  id: ToolId,
  label: string,
  hint1: string,
  hint2: string,
  make: (h: PlanHost, a: Pt, b: Pt) => E | null,
  extra: Partial<PlanTool> = {},
): PlanTool {
  return {
    id,
    label,
    hint: (st) => (st.a ? hint2 : hint1),
    start: (_h, st) => {
      st.a = null;
    },
    ref: (st) => st.a ?? null,
    down(h, st, ev) {
      if (!guard(h)) return;
      if (!st.a) {
        st.a = ev.pt;
        return;
      }
      if (dist(st.a, ev.pt) < 1) return;
      const e = make(h, st.a, ev.pt);
      if (e) {
        commitAdd(h, label, [e]);
        st.a = null;
      }
    },
    numeric(h, st, text, cursor) {
      const t = parseTyped(text, h.settings());
      if (!t) return false;
      if (!st.a) {
        const p = typedPoint(t, null, cursor);
        if (p) {
          st.a = p;
          return true;
        }
        return false;
      }
      const p = typedPoint(t, st.a, cursor);
      if (!p || dist(st.a, p) < 1) return false;
      const e = make(h, st.a, p);
      if (e) {
        commitAdd(h, label, [e]);
        st.a = null;
      }
      return true;
    },
    preview(h, st, cur) {
      if (!st.a) return [];
      const e = make(h, st.a, cur.pt);
      return e ? [ghost(e), { kind: 'text', pts: [mid(st.a, cur.pt)], text: mmToDisplay(dist(st.a, cur.pt), h.settings()), style: 'dim' }] : [line(st.a, cur.pt)];
    },
    inputLabel: (st) => (st.a ? 'Length' : 'x,y'),
    cancel: (_h, st) => {
      const had = !!st.a;
      st.a = null;
      return had;
    },
    ...extra,
  };
}

// ---------- the tools ----------

export const TOOLS: Record<ToolId, PlanTool> = {} as Record<ToolId, PlanTool>;
const reg = (t: PlanTool) => {
  TOOLS[t.id] = t;
};

reg({ id: 'select', label: 'Select', hint: () => 'Click an object to select it. Drag a box to select several (left→right: fully inside, right→left: touching). Shift adds. Drag a grip to edit.', cancel: () => false });

reg({ id: 'pan', label: 'Pan', hint: () => 'Drag to pan the view. Scroll to zoom.', cancel: () => false });

reg(twoPoint('line', 'Line', 'Click the start point (or type x,y).', 'Click the end point, or type a length (e.g. 3000) or length<angle (3000<45).', (_h, a, b) => mk<E>({ kind: 'line', a: rpt(a), b: rpt(b) } as E)));

reg(twoPoint('arrow', 'Arrow', 'Click the arrow tail.', 'Click the arrow head.', (_h, a, b) => mk<E>({ kind: 'arrow', a: rpt(a), b: rpt(b) } as E)));

reg(
  twoPoint(
    'guide',
    'Construction line',
    'Click the first point of the guide.',
    'Click a second point to set its direction.',
    (h, a, b) => mk<E>({ kind: 'guide', a: rpt(a), b: rpt(b), infinite: !!opt<boolean>(h, 'guide', 'infinite'), temporary: !!opt<boolean>(h, 'guide', 'temporary') } as E),
    {
      options: [{ key: 'infinite', label: 'Infinite line', type: 'bool' }, { key: 'temporary', label: 'Temporary (removed on Esc/clear)', type: 'bool' }],
      defaults: { infinite: true, temporary: false },
    },
  ),
);

reg(twoPoint('beam', 'Beam', 'Click the beam start.', 'Click the beam end.', (h, a, b) => mk<E>({ kind: 'beam', a: rpt(a), b: rpt(b), width: num(h, 'beam', 'width'), depth: num(h, 'beam', 'depth'), elevation: num(h, 'beam', 'elevation') } as E), { options: [N('width', 'Width'), N('depth', 'Depth'), N('elevation', 'Bottom elevation')], defaults: { width: 200, depth: 400, elevation: 2400 } }));

reg(twoPoint('strip', 'Strip light', 'Click the strip start.', 'Click the strip end.', (h, a, b) => mk<E>({ kind: 'strip', a: rpt(a), b: rpt(b), elevation: num(h, 'strip', 'elevation'), color: String(opt(h, 'strip', 'color')), intensity: num(h, 'strip', 'intensity') } as E), { options: [N('elevation', 'Elevation'), { key: 'color', label: 'Colour', type: 'color' }, N('intensity', 'Intensity', '×', 0, 5, 0.1)], defaults: { elevation: 2600, color: '#ffd9a0', intensity: 1 } }));

reg(
  twoPoint(
    'rect',
    'Rectangle',
    'Click the first corner.',
    'Click the opposite corner, or type width,height (e.g. 4000,3000).',
    (_h, a, b) => (Math.abs(a[0] - b[0]) < 1 || Math.abs(a[1] - b[1]) < 1 ? null : mk<E>({ kind: 'rect', p1: rpt(a), p2: rpt(b) } as E)),
    {
      numeric(h, st, text, cursor) {
        const t = parseTyped(text, h.settings());
        if (!t) return false;
        if (!st.a) {
          if (t.kind !== 'pair') return false;
          st.a = [t.a, t.b];
          return true;
        }
        if (t.kind === 'pair' || t.kind === 'rel') {
          const [w, hgt] = t.kind === 'pair' ? [t.a, t.b] : t.d;
          const sx = cursor[0] >= st.a[0] ? 1 : -1;
          const sy = cursor[1] >= st.a[1] ? 1 : -1;
          if (Math.abs(w) < 1 || Math.abs(hgt) < 1) {
            h.say('Width and height must be greater than zero.', 'error');
            return true;
          }
          commitAdd(h, 'Rectangle', [mk<E>({ kind: 'rect', p1: rpt(st.a), p2: rpt([st.a[0] + Math.abs(w) * sx, st.a[1] + Math.abs(hgt) * sy]) } as E)]);
          st.a = null;
          return true;
        }
        return false;
      },
      inputLabel: (st) => (st.a ? 'Width,Height' : 'x,y'),
    },
  ),
);

reg({
  id: 'circle',
  label: 'Circle',
  hint: (st) => (st.c ? 'Click a point on the circle, or type the radius.' : 'Click the centre.'),
  start: (_h, st) => (st.c = null),
  ref: (st) => st.c ?? null,
  down(h, st, ev) {
    if (!guard(h)) return;
    if (!st.c) {
      st.c = ev.pt;
      return;
    }
    const r = dist(st.c, ev.pt);
    if (r < 1) return;
    commitAdd(h, 'Circle', [mk<E>({ kind: 'circle', c: rpt(st.c), r: round(r, 2) } as E)]);
    st.c = null;
  },
  numeric(h, st, text, cursor) {
    const t = parseTyped(text, h.settings());
    if (!t) return false;
    if (!st.c) {
      const p = typedPoint(t, null, cursor);
      if (!p) return false;
      st.c = p;
      return true;
    }
    if (t.kind !== 'len' || t.len < 1) return false;
    commitAdd(h, 'Circle', [mk<E>({ kind: 'circle', c: rpt(st.c), r: t.len } as E)]);
    st.c = null;
    return true;
  },
  preview: (h, st, cur) => (st.c ? [{ kind: 'circle', c: st.c, r: dist(st.c, cur.pt), style: 'preview' }, { kind: 'text', pts: [mid(st.c, cur.pt)], text: `R ${mmToDisplay(dist(st.c, cur.pt), h.settings())}`, style: 'dim' }, line(st.c, cur.pt, 'dim')] : []),
  inputLabel: (st) => (st.c ? 'Radius' : 'x,y'),
  cancel: (_h, st) => {
    const had = !!st.c;
    st.c = null;
    return had;
  },
});

reg({
  id: 'arc',
  label: '3-Point Arc',
  hint: (st) => (!st.p1 ? 'Click the arc start point.' : !st.p2 ? 'Click a point the arc passes through.' : 'Click the arc end point.'),
  start: (_h, st) => {
    st.p1 = st.p2 = null;
  },
  ref: (st) => st.p2 ?? st.p1 ?? null,
  down(h, st, ev) {
    if (!guard(h)) return;
    if (!st.p1) st.p1 = ev.pt;
    else if (!st.p2) {
      if (dist(st.p1, ev.pt) < 1) return;
      st.p2 = ev.pt;
    } else {
      if (!arcFrom3(st.p1, st.p2, ev.pt)) {
        h.say('The three points are on one line - an arc needs a bend.', 'error');
        return;
      }
      commitAdd(h, 'Arc', [mk<E>({ kind: 'arc', p1: rpt(st.p1), p2: rpt(st.p2), p3: rpt(ev.pt) } as E)]);
      st.p1 = st.p2 = null;
    }
  },
  preview(_h, st, cur) {
    if (st.p1 && !st.p2) return [line(st.p1, cur.pt)];
    if (st.p1 && st.p2) {
      const g = arcFrom3(st.p1, st.p2, cur.pt);
      return g ? [{ kind: 'poly', pts: arcPoints(g), style: 'preview' }, { kind: 'point', pts: [st.p1, st.p2, cur.pt], style: 'dim' }] : [line(st.p1, st.p2, 'bad'), line(st.p2, cur.pt, 'bad')];
    }
    return [];
  },
  cancel: (_h, st) => {
    const had = !!st.p1;
    st.p1 = st.p2 = null;
    return had;
  },
});

// multi-point shapes ---------------------------------------------------------

function multiPoint(id: ToolId, label: string, minPts: number, make: (h: PlanHost, pts: Pt[], closed: boolean) => E | null, hint: string, closes: boolean, extra: Partial<PlanTool> = {}): PlanTool {
  return {
    id,
    label,
    hint: (st) => (st.pts?.length ? `${hint} Enter or right-click finishes${closes ? '; click the first point or press C to close' : ''}; Backspace removes the last point.` : `Click the first point of the ${label.toLowerCase()}.`),
    start: (_h, st) => {
      st.pts = [];
    },
    ref: (st) => (st.pts?.length ? st.pts[st.pts.length - 1] : null),
    down(h, st, ev) {
      if (!guard(h)) return;
      const pts: Pt[] = st.pts ?? (st.pts = []);
      if (closes && pts.length >= minPts && same(ev.pt, pts[0], 2 / ev.scale)) {
        this.finish!(h, st, true);
        return;
      }
      if (pts.length && same(ev.pt, pts[pts.length - 1], 1)) return;
      pts.push(ev.pt);
    },
    numeric(h, st, text, cursor) {
      const t = parseTyped(text, h.settings());
      if (!t) return false;
      const pts: Pt[] = st.pts ?? (st.pts = []);
      const p = typedPoint(t, pts.length ? pts[pts.length - 1] : null, cursor);
      if (!p) return false;
      pts.push(p);
      return true;
    },
    finish(h, st, close = false) {
      const pts: Pt[] = st.pts ?? [];
      if (pts.length < minPts) {
        h.say(`A ${label.toLowerCase()} needs at least ${minPts} points.`, 'warn');
        return;
      }
      const e = make(h, pts.map(rpt), close || (closes && minPts >= 3));
      if (e) commitAdd(h, label, [e]);
      st.pts = [];
    },
    key(h, st, key) {
      if (key.toLowerCase() === 'c' && closes && (st.pts?.length ?? 0) >= Math.max(minPts, 3)) {
        this.finish!(h, st, true);
        return true;
      }
      if (key === 'Backspace' && st.pts?.length) {
        st.pts.pop();
        return true;
      }
      return false;
    },
    preview(h, st, cur) {
      const pts: Pt[] = st.pts ?? [];
      if (!pts.length) return [];
      const draft = [...pts, cur.pt];
      const e = make(h, draft, false);
      return e ? [ghost(e), { kind: 'point', pts, style: 'dim' }] : [{ kind: 'poly', pts: draft, style: 'preview' }];
    },
    inputLabel: (st) => (st.pts?.length ? 'Length' : 'x,y'),
    cancel: (_h, st) => {
      const had = !!st.pts?.length;
      st.pts = [];
      return had;
    },
    ...extra,
  };
}

reg(multiPoint('polyline', 'Polyline', 2, (_h, pts, closed) => mk<E>({ kind: 'polyline', pts, closed } as E), 'Click the next vertex.', true));
reg(multiPoint('polygon', 'Polygon', 3, (_h, pts) => (pts.length >= 3 ? mk<E>({ kind: 'polygon', pts } as E) : null), 'Click the next corner.', true));
reg(multiPoint('railing', 'Railing', 2, (h, pts) => mk<E>({ kind: 'railing', pts, height: num(h, 'railing', 'height'), spacing: num(h, 'railing', 'spacing'), elevation: 0 } as E), 'Click the next point of the railing path.', false, { options: [N('height', 'Height'), N('spacing', 'Post spacing')], defaults: { height: 1000, spacing: 120 } }));

// hatch -----------------------------------------------------------------------------

reg({
  id: 'hatch',
  label: 'Hatch',
  hint: () => 'Click inside a closed shape (rectangle, polygon, closed polyline, circle) or a room to hatch it.',
  options: [{ key: 'pattern', label: 'Pattern', type: 'select', options: sel([['diagonal', 'Diagonal'], ['cross', 'Cross-hatch'], ['horizontal', 'Horizontal'], ['vertical', 'Vertical'], ['dots', 'Dots'], ['solid', 'Solid']]) }, N('scale', 'Spacing', 'mm', 20, 2000, 10), N('angle', 'Angle', '°', -180, 180, 5), { key: 'color', label: 'Colour', type: 'color' }],
  defaults: { pattern: 'diagonal', scale: 150, angle: 45, color: '#8a8478' },
  down(h, _st, ev) {
    if (!guard(h)) return;
    const f = h.floor();
    const shape = closedShapeAt(f, ev.pt);
    const room = roomAt(h.rooms(), ev.pt);
    let boundary: E extends never ? never : { kind: 'ref'; id: string } | { kind: 'room'; at: Pt };
    if (shape && (!room || (closedOutline(f, shape) && Math.abs(polygonArea(closedOutline(f, shape)!)) < room.area * 1.05))) boundary = { kind: 'ref', id: shape.id };
    else if (room) boundary = { kind: 'room', at: rpt(ev.pt) };
    else {
      h.say('Nothing closed here to hatch. Click inside a closed shape or a room.', 'error');
      return;
    }
    const o = h.options('hatch');
    commitAdd(h, 'Hatch', [mk<E>({ kind: 'hatch', boundary, pattern: String(o.pattern), scale: Number(o.scale), angle: Number(o.angle), color: String(o.color) } as E)]);
  },
  cancel: () => false,
});

// trim / extend -----------------------------------------------------------------------

function pickTarget(h: PlanHost, ev: PlanPointer, kinds?: string[]): string | null {
  const id = pickEntity(h.floor(), ev.raw, h.tol(8), 'architecture');
  if (!id) return null;
  if (kinds && !kinds.includes(h.floor().entities[id].kind)) return null;
  return id;
}

for (const [id, label, fn] of [['trim', 'Trim', trimEntity], ['extend', 'Extend', extendEntity]] as const) {
  reg({
    id,
    label,
    hint: () => (id === 'trim' ? 'Click the part of a line, wall or polyline you want to remove (between the boundaries that cross it).' : 'Click the end of a line, wall or polyline to extend it to the next boundary.'),
    down(h, _st, ev) {
      if (!guard(h)) return;
      const t = pickTarget(h, ev);
      if (!t) {
        h.say(`Click a line, wall or polyline to ${id}.`, 'warn');
        return;
      }
      const r = fn(h.floor(), t, ev.raw);
      if (!r.ok) {
        h.say(r.error, 'error');
        return;
      }
      h.commit(label, normalizeWalls(r.value));
    },
    cancel: () => false,
  });
}

reg({
  id: 'fillet',
  label: 'Fillet',
  hint: (st) => (st.first ? 'Click the second wall or line.' : 'Click the first wall or line to join into a corner.'),
  start: (_h, st) => (st.first = null),
  down(h, st, ev) {
    if (!guard(h)) return;
    const t = pickTarget(h, ev, ['wall', 'line']);
    if (!t) return h.say('Click a wall or a line.', 'warn');
    if (!st.first) {
      st.first = t;
      h.setSelection([t]);
      return;
    }
    if (st.first === t) return;
    const r = filletEntities(h.floor(), st.first, t);
    st.first = null;
    if (!r.ok) return h.say(r.error, 'error');
    h.commit('Fillet corner', r.value);
  },
  cancel: (_h, st) => {
    const had = !!st.first;
    st.first = null;
    return had;
  },
});

reg({
  id: 'attach',
  label: 'Attach wall',
  hint: (st) => (st.first ? 'Click the wall to attach it to.' : 'Click the wall whose end should be attached to another wall.'),
  start: (_h, st) => (st.first = null),
  down(h, st, ev) {
    if (!guard(h)) return;
    const t = pickTarget(h, ev, ['wall']);
    if (!t) return h.say('Click a wall.', 'warn');
    if (!st.first) {
      st.first = t;
      st.at = ev.raw;
      h.setSelection([t]);
      return;
    }
    if (st.first === t) return;
    const r = extendEntity(h.floor(), st.first, st.at, [t]);
    st.first = null;
    if (!r.ok) return h.say(r.error, 'error');
    h.commit('Attach wall', r.value);
  },
  cancel: (_h, st) => {
    const had = !!st.first;
    st.first = null;
    return had;
  },
});

// selection-based transforms ------------------------------------------------------------

const entIds = (h: PlanHost) => h.selection().filter((i) => !!h.floor().entities[i]);
const nodeIds = (h: PlanHost) => h.selection().filter((i) => !h.floor().entities[i] && h.nodeOutline(i));

function needSel(h: PlanHost, what: string): boolean {
  if (!h.selection().length) {
    h.say(`Select the objects to ${what} first (Select tool), then choose ${what}.`, 'warn');
    return false;
  }
  return guard(h);
}

reg({
  id: 'move',
  label: 'Move',
  needsSelection: true,
  hint: (st) => (st.base ? 'Click the destination, or type a distance / dx,dy.' : 'Click a base point.'),
  start: (h, st) => {
    st.base = null;
    needSel(h, 'move');
  },
  ref: (st) => st.base ?? null,
  down(h, st, ev) {
    if (!needSel(h, 'move')) return;
    if (!st.base) return void (st.base = ev.pt);
    applyMove(h, sub(ev.pt, st.base));
    st.base = null;
  },
  numeric(h, st, text, cursor) {
    const t = parseTyped(text, h.settings());
    if (!t || !st.base) return false;
    const p = typedPoint(t.kind === 'pair' ? { kind: 'rel', d: [t.a, t.b] } : t, st.base, cursor);
    if (!p) return false;
    applyMove(h, sub(p, st.base));
    st.base = null;
    return true;
  },
  preview: (h, st, cur) => (st.base ? movedGhosts(h, sub(cur.pt, st.base)).concat([line(st.base, cur.pt, 'dim')]) : []),
  inputLabel: (st) => (st.base ? 'Distance or dx,dy' : null),
  cancel: (_h, st) => {
    const had = !!st.base;
    st.base = null;
    return had;
  },
});

function applyMove(h: PlanHost, d: Pt) {
  if (Math.hypot(d[0], d[1]) < 0.01) return;
  const ids = entIds(h);
  const nodes = nodeIds(h);
  h.batch('Move', () => {
    if (ids.length) h.commit('Move', normalizeWalls(moveEntities(h.floor(), ids, d)));
    if (nodes.length) h.transformNodes({ type: 'move', d }, nodes);
  });
}

function movedGhosts(h: PlanHost, d: Pt): Drawable[] {
  const f = h.floor();
  const out: Drawable[] = [];
  for (const id of expandSelection(f, entIds(h))) {
    const e = f.entities[id];
    if (e && e.kind !== 'door' && e.kind !== 'window') out.push(ghost(translateEntity(e, d)));
  }
  for (const id of nodeIds(h)) {
    const o = h.nodeOutline(id);
    if (o) out.push({ kind: 'poly', pts: o.map((p) => add(p, d)), closed: true, style: 'preview' });
  }
  return out;
}

reg({
  id: 'copy',
  label: 'Copy',
  needsSelection: true,
  hint: (st) => (st.base ? 'Click where to place each copy (Esc to finish). Type a distance or dx,dy for exact placement.' : 'Click a reference point on the selection.'),
  start: (h, st) => {
    st.base = null;
    needSel(h, 'copy');
  },
  ref: (st) => st.base ?? null,
  down(h, st, ev) {
    if (!needSel(h, 'copy')) return;
    if (!st.base) return void (st.base = ev.pt);
    applyCopy(h, sub(ev.pt, st.base));
  },
  numeric(h, st, text, cursor) {
    const t = parseTyped(text, h.settings());
    if (!t || !st.base) return false;
    const p = typedPoint(t.kind === 'pair' ? { kind: 'rel', d: [t.a, t.b] } : t, st.base, cursor);
    if (!p) return false;
    applyCopy(h, sub(p, st.base));
    return true;
  },
  preview: (h, st, cur) => (st.base ? movedGhosts(h, sub(cur.pt, st.base)) : []),
  inputLabel: (st) => (st.base ? 'Distance or dx,dy' : null),
  cancel: (_h, st) => {
    const had = !!st.base;
    st.base = null;
    return had;
  },
});

function applyCopy(h: PlanHost, d: Pt) {
  if (Math.hypot(d[0], d[1]) < 0.01) return;
  const ids = entIds(h);
  const nodes = nodeIds(h);
  h.batch('Copy', () => {
    let sel: string[] = [];
    if (ids.length) {
      const r = copyEntities(h.floor(), ids, d);
      h.commit('Copy', normalizeWalls(r.floor), r.newIds);
      sel = r.newIds;
    }
    if (nodes.length) sel = sel.concat(h.transformNodes({ type: 'copy', d }, nodes));
    if (sel.length) h.setSelection(sel);
  });
}

reg({
  id: 'mirror',
  label: 'Mirror',
  needsSelection: true,
  hint: (st) => (st.a ? 'Click the second point of the mirror axis.' : 'Click the first point of the mirror axis.'),
  options: [{ key: 'keep', label: 'Keep the original', type: 'bool' }],
  defaults: { keep: true },
  start: (h, st) => {
    st.a = null;
    needSel(h, 'mirror');
  },
  ref: (st) => st.a ?? null,
  down(h, st, ev) {
    if (!needSel(h, 'mirror')) return;
    if (!st.a) return void (st.a = ev.pt);
    const keep = !!opt<boolean>(h, 'mirror', 'keep');
    const ids = entIds(h);
    const nodes = nodeIds(h);
    let ok = true;
    h.batch('Mirror', () => {
      let sel: string[] = [];
      if (ids.length) {
        const r = mirrorEntities(h.floor(), ids, st.a, ev.pt, keep);
        if (!r.ok) {
          ok = false;
          return h.say(r.error, 'error');
        }
        h.commit('Mirror', normalizeWalls(r.value.floor), r.value.newIds);
        sel = r.value.newIds;
      }
      if (nodes.length) sel = sel.concat(h.transformNodes({ type: 'mirror', a: st.a, b: ev.pt, keep }, nodes));
      if (sel.length) h.setSelection(sel);
    });
    if (ok) st.a = null;
  },
  preview: (_h, st, cur) => (st.a ? [line(st.a, cur.pt, 'guide')] : []),
  cancel: (_h, st) => {
    const had = !!st.a;
    st.a = null;
    return had;
  },
});

reg({
  id: 'rotate',
  label: 'Rotate',
  needsSelection: true,
  hint: (st) => (!st.base ? 'Click the base point (the centre of rotation).' : !st.refPt ? 'Type an angle in degrees (positive turns clockwise on screen), or click a reference direction.' : 'Click the new direction.'),
  start: (h, st) => {
    st.base = st.refPt = null;
    needSel(h, 'rotate');
  },
  ref: (st) => st.base ?? null,
  down(h, st, ev) {
    if (!needSel(h, 'rotate')) return;
    if (!st.base) return void (st.base = ev.pt);
    if (!st.refPt) {
      if (dist(st.base, ev.pt) < 1) return;
      return void (st.refPt = ev.pt);
    }
    if (dist(st.base, ev.pt) < 1) return;
    doRotate(h, st, angleOf(st.base, ev.pt) - angleOf(st.base, st.refPt));
  },
  numeric(h, st, text) {
    if (!st.base) return false;
    const a = parseFloat(text.replace(',', '.'));
    if (!Number.isFinite(a)) return false;
    doRotate(h, st, a);
    return true;
  },
  preview(h, st, cur) {
    if (!st.base) return [];
    const a = st.refPt ? angleOf(st.base, cur.pt) - angleOf(st.base, st.refPt) : 0;
    const out: Drawable[] = [line(st.base, st.refPt ?? cur.pt, 'guide')];
    if (st.refPt) {
      out.push(line(st.base, cur.pt, 'dim'), { kind: 'text', pts: [cur.pt], text: `${(((a + 540) % 360) - 180).toFixed(1)}°`, style: 'dim' });
      const f = h.floor();
      for (const id of expandSelection(f, entIds(h))) {
        const e = f.entities[id];
        if (e && e.kind !== 'door' && e.kind !== 'window') out.push(ghost(rotateEntity(e, a, st.base)));
      }
      for (const id of nodeIds(h)) {
        const o = h.nodeOutline(id);
        if (o) out.push({ kind: 'poly', pts: o.map((p: Pt) => rotatePt(p, a, st.base)), closed: true, style: 'preview' });
      }
    }
    return out;
  },
  inputLabel: (st) => (st.base ? 'Angle (°)' : null),
  cancel: (_h, st) => {
    const had = !!st.base;
    st.base = st.refPt = null;
    return had;
  },
});

function doRotate(h: PlanHost, st: ToolState, angle: number) {
  if (Math.abs(angle) < 0.001) return;
  const ids = entIds(h);
  const nodes = nodeIds(h);
  const base: Pt = st.base;
  h.batch('Rotate', () => {
    if (ids.length) h.commit('Rotate', normalizeWalls(rotateEntities(h.floor(), ids, angle, base)));
    if (nodes.length) h.transformNodes({ type: 'rotate', angle, origin: base }, nodes);
  });
  st.base = st.refPt = null;
}

reg({
  id: 'scale',
  label: 'Scale',
  needsSelection: true,
  hint: (st) => (!st.base ? 'Click the base point (stays fixed).' : !st.refPt ? 'Type a scale factor (e.g. 2 or 0.5), or click a reference point.' : 'Click where the reference point should end up.'),
  start: (h, st) => {
    st.base = st.refPt = null;
    needSel(h, 'scale');
  },
  ref: (st) => st.base ?? null,
  down(h, st, ev) {
    if (!needSel(h, 'scale')) return;
    if (!st.base) return void (st.base = ev.pt);
    if (!st.refPt) {
      if (dist(st.base, ev.pt) < 1) return;
      return void (st.refPt = ev.pt);
    }
    const k = dist(st.base, ev.pt) / dist(st.base, st.refPt);
    doScale(h, st, k);
  },
  numeric(h, st, text) {
    if (!st.base) return false;
    const k = parseFloat(text.replace(',', '.'));
    if (!Number.isFinite(k)) return false;
    doScale(h, st, k);
    return true;
  },
  preview: (h, st, cur) => (st.base && st.refPt ? [line(st.base, st.refPt, 'guide'), line(st.base, cur.pt, 'dim'), { kind: 'text', pts: [cur.pt], text: `× ${(dist(st.base, cur.pt) / dist(st.base, st.refPt)).toFixed(3)}`, style: 'dim' }] : st.base ? [line(st.base, cur.pt, 'guide')] : []),
  inputLabel: (st) => (st.base ? 'Scale factor' : null),
  cancel: (_h, st) => {
    const had = !!st.base;
    st.base = st.refPt = null;
    return had;
  },
});

function doScale(h: PlanHost, st: ToolState, k: number) {
  const r = scaleEntities(h.floor(), entIds(h), st.base, k);
  if (!r.ok) return h.say(r.error, 'error');
  h.commit('Scale', normalizeWalls(r.value));
  st.base = st.refPt = null;
}

reg({
  id: 'offset',
  label: 'Offset',
  hint: (st) => (st.target ? 'Click the side to offset towards.' : 'Click the line, wall, polyline, arc, circle or shape to offset.'),
  options: [N('distance', 'Distance', 'mm', 1, 100000, 10)],
  defaults: { distance: 200 },
  start: (_h, st) => (st.target = null),
  down(h, st, ev) {
    if (!guard(h)) return;
    if (!st.target) {
      const t = pickTarget(h, ev);
      if (!t) return h.say('Click an object to offset.', 'warn');
      st.target = t;
      h.setSelection([t]);
      return;
    }
    const r = offsetEntity(h.floor(), st.target, st.distance ?? num(h, 'offset', 'distance'), ev.raw);
    if (!r.ok) return h.say(r.error, 'error');
    commitAdd(h, 'Offset', [r.value]);
    st.target = null;
  },
  numeric(h, st, text) {
    const v = displayToMm(text, h.settings());
    if (v == null || v <= 0) return false;
    st.distance = v;
    h.setOption('offset', 'distance', v);
    h.say(`Offset distance set to ${mmToDisplay(v, h.settings())}.`);
    return true;
  },
  preview(h, st, cur) {
    if (!st.target) return [];
    const r = offsetEntity(h.floor(), st.target, st.distance ?? num(h, 'offset', 'distance'), cur.raw);
    return r.ok ? [ghost(r.value)] : [];
  },
  inputLabel: () => 'Distance',
  cancel: (_h, st) => {
    const had = !!st.target;
    st.target = null;
    return had;
  },
});

reg({
  id: 'component',
  label: 'Component',
  hint: () => 'To create: select objects, then click a base point. To insert: choose a component in the options, then click where to place it.',
  options: [{ key: 'componentId', label: 'Insert component', type: 'select', options: [] }, N('rotation', 'Rotation', '°', -360, 360, 15), N('scale', 'Scale', '×', 0.1, 10, 0.1)],
  defaults: { componentId: '', rotation: 0, scale: 1 },
  start: (_h, st) => (st.base = null),
  down(h, st, ev) {
    if (!guard(h)) return;
    const cid = String(opt(h, 'component', 'componentId') || '');
    if (cid) {
      const def = h.plan().components.find((c) => c.id === cid);
      if (!def) return h.say('That component no longer exists.', 'error');
      const r = insertComponent(h.floor(), def, ev.pt, num(h, 'component', 'rotation'), num(h, 'component', 'scale') || 1);
      h.commit(`Insert ${def.name}`, r.floor, r.newIds);
      return;
    }
    const ids = entIds(h);
    if (!ids.length) return h.say('Select objects (Select tool) to turn into a component, or choose a component to insert.', 'warn');
    void h.prompt('Component name', 'My component').then((name) => {
      if (!name) return;
      const r = createComponent(h.floor(), ids, ev.pt, name);
      if (!r.ok) return h.say(r.error, 'error');
      h.addComponent(r.value);
      h.say(`Component “${r.value.name}” created. Choose it in the options to insert copies.`);
    });
  },
  cancel: () => false,
});

// ---------- architecture ----------

reg({
  id: 'wall',
  label: 'Wall',
  hint: (st) => (st.last ? 'Click the next corner (click the first point to close the room), or type a length. Enter / right-click ends the chain.' : 'Click the wall start point (or type x,y).'),
  options: [N('thickness', 'Thickness', 'mm', 20, 2000, 10), N('height', 'Height', 'mm', 500, 12000, 50), { key: 'wallType', label: 'Type', type: 'select', options: sel([['interior', 'Interior'], ['exterior', 'Exterior']]) }],
  defaults: { thickness: 200, height: 2800, wallType: 'interior' },
  start: (_h, st) => {
    st.last = st.first = null;
  },
  ref: (st) => st.last ?? null,
  down(h, st, ev) {
    if (!guard(h)) return;
    if (!st.last) {
      st.last = st.first = ev.pt;
      return;
    }
    addWallTo(h, st, ev.pt);
  },
  numeric(h, st, text, cursor) {
    const t = parseTyped(text, h.settings());
    if (!t) return false;
    const p = typedPoint(t, st.last ?? null, cursor);
    if (!p) return false;
    if (!st.last) {
      st.last = st.first = p;
      return true;
    }
    addWallTo(h, st, p);
    return true;
  },
  finish: (_h, st) => {
    st.last = st.first = null;
  },
  preview(h, st, cur) {
    if (!st.last || dist(st.last, cur.pt) < 1) return [];
    const o = h.options('wall');
    const w = mk<WallE>({ kind: 'wall', a: st.last, b: cur.pt, thickness: Number(o.thickness), height: Number(o.height), wallType: o.wallType as 'interior' | 'exterior' });
    return [ghost(w), { kind: 'text', pts: [mid(st.last, cur.pt)], text: mmToDisplay(dist(st.last, cur.pt), h.settings()), style: 'dim' }];
  },
  inputLabel: (st) => (st.last ? 'Length' : 'x,y'),
  cancel: (_h, st) => {
    const had = !!st.last;
    st.last = st.first = null;
    return had;
  },
});

function addWallTo(h: PlanHost, st: ToolState, p: Pt) {
  if (dist(st.last, p) < 10) return h.say('A wall must be longer than 10 mm.', 'warn');
  const o = h.options('wall');
  const w = mk<WallE>({ kind: 'wall', a: rpt(st.last), b: rpt(p), thickness: Number(o.thickness), height: Number(o.height), wallType: o.wallType as 'interior' | 'exterior' });
  commitAdd(h, 'Wall', [w], false);
  const closed = st.first && same(p, st.first, 1);
  st.last = closed ? null : p;
  if (closed) {
    st.first = null;
    h.say('Room closed.');
  }
}

function openingTool(kind: 'door' | 'window'): PlanTool {
  const id = kind;
  return {
    id,
    label: kind === 'door' ? 'Door' : 'Window',
    hint: (st) => (st.hover?.error ? st.hover.error : 'Hover a wall and click to place. F flips the opening side, Space flips the hinge.'),
    options:
      kind === 'door'
        ? [N('width', 'Width', 'mm', 300, 4000, 50), N('height', 'Height', 'mm', 1500, 3500, 50), { key: 'swing', label: 'Hinge side', type: 'select', options: sel([['left', 'Start of wall'], ['right', 'End of wall']]) }, { key: 'opens', label: 'Opens towards', type: 'select', options: sel([['in', 'Left of wall direction'], ['out', 'Right of wall direction']]) }]
        : [N('width', 'Width', 'mm', 300, 6000, 50), N('height', 'Height', 'mm', 300, 3000, 50), N('sill', 'Sill height', 'mm', 0, 2500, 50)],
    defaults: kind === 'door' ? { width: 900, height: 2100, swing: 'left', opens: 'in' } : { width: 1200, height: 1200, sill: 900 },
    start: (_h, st) => (st.hover = null),
    move(h, st, ev) {
      const w = nearestWall(h.floor(), ev.raw, h.tol(24));
      if (!w) return void (st.hover = null);
      const width = num(h, id, 'width');
      const r = placeOpening(h.floor(), w.wall.id, w.t, width);
      st.hover = 'offset' in r ? { wall: w.wall.id, offset: r.offset } : { error: r.error, wall: w.wall.id };
    },
    down(h, st, ev) {
      if (!guard(h)) return;
      const w = nearestWall(h.floor(), ev.raw, h.tol(24));
      if (!w) return h.say(`Click on a wall to place the ${kind}.`, 'warn');
      const width = num(h, id, 'width');
      const r = placeOpening(h.floor(), w.wall.id, w.t, width);
      if (!('offset' in r)) return h.say(r.error, 'error');
      const o = h.options(id);
      const e =
        kind === 'door'
          ? mk<E>({ kind: 'door', wall: w.wall.id, offset: r.offset, width, height: Number(o.height), swing: o.swing as 'left' | 'right', opens: o.opens as 'in' | 'out' } as E)
          : mk<E>({ kind: 'window', wall: w.wall.id, offset: r.offset, width, height: Number(o.height), sill: Number(o.sill) } as E);
      commitAdd(h, kind === 'door' ? 'Door' : 'Window', [e], false);
      st.hover = null;
    },
    key(h, _st, key) {
      if (kind === 'door' && key.toLowerCase() === 'f') {
        h.setOption('door', 'opens', h.options('door').opens === 'in' ? 'out' : 'in');
        return true;
      }
      if (kind === 'door' && key === ' ') {
        h.setOption('door', 'swing', h.options('door').swing === 'left' ? 'right' : 'left');
        return true;
      }
      return false;
    },
    preview(h, st) {
      if (!st.hover) return [];
      const o = h.options(id);
      const bad = !!st.hover.error;
      const e = (kind === 'door'
        ? { id: 'preview', kind: 'door', wall: st.hover.wall, offset: st.hover.offset ?? 0, width: Number(o.width), height: Number(o.height), swing: o.swing, opens: o.opens }
        : { id: 'preview', kind: 'window', wall: st.hover.wall, offset: st.hover.offset ?? 0, width: Number(o.width), height: Number(o.height), sill: Number(o.sill) }) as E;
      if (bad) return [];
      return [{ kind: 'entity', entity: e, style: 'ok' }];
    },
    cancel: (_h, st) => {
      const had = !!st.hover;
      st.hover = null;
      return had;
    },
  };
}
reg(openingTool('door'));
reg(openingTool('window'));

function roomClick(h: PlanHost, ev: PlanPointer): { room?: Room; outline?: Pt[] } {
  const room = roomAt(h.rooms(), ev.pt);
  if (room) return { room };
  const shape = closedShapeAt(h.floor(), ev.pt);
  const outline = shape ? closedOutline(h.floor(), shape) : null;
  return outline ? { outline } : {};
}
const noRoom = (h: PlanHost) => h.say('Click inside a closed room. Draw walls so they form a closed loop first (a room is detected automatically).', 'error');

reg({
  id: 'ceiling',
  label: 'Ceiling',
  hint: () => 'Click inside a room to create its ceiling.',
  options: [N('height', 'Height', 'mm', 1800, 12000, 50), N('thickness', 'Thickness', 'mm', 10, 500, 10)],
  defaults: { height: 2800, thickness: 50 },
  down(h, _st, ev) {
    if (!guard(h)) return;
    const { room } = roomClick(h, ev);
    if (!room) return noRoom(h);
    const f = h.floor();
    if (Object.values(f.entities).some((e) => e.kind === 'ceiling' && pointInPolygon(e.anchor, room.outline))) return h.say('This room already has a ceiling. Select it to change its height.', 'warn');
    commitAdd(h, 'Ceiling', [mk<E>({ kind: 'ceiling', anchor: rpt(room.centroid), height: num(h, 'ceiling', 'height'), thickness: num(h, 'ceiling', 'thickness'), visible: true } as E)]);
  },
  cancel: () => false,
});

reg({
  id: 'slab',
  label: 'Slab',
  hint: () => 'Click inside a room (or a closed shape you drew) to create a floor slab.',
  options: [N('thickness', 'Thickness', 'mm', 20, 1000, 10), N('elevation', 'Top elevation', 'mm', -2000, 5000, 10)],
  defaults: { thickness: 150, elevation: 0 },
  down(h, _st, ev) {
    if (!guard(h)) return;
    const { room, outline } = roomClick(h, ev);
    if (!room && !outline) return noRoom(h);
    const f = h.floor();
    const anchor = room ? room.centroid : mid(boundsPt(outline!, 0), boundsPt(outline!, 1));
    if (room && Object.values(f.entities).some((e) => e.kind === 'slab' && pointInPolygon(e.anchor, room.outline))) return h.say('This room already has a slab.', 'warn');
    commitAdd(h, 'Slab', [mk<E>({ kind: 'slab', anchor: rpt(room ? anchor : ev.pt), pts: room ? undefined : outline!.map(rpt), thickness: num(h, 'slab', 'thickness'), elevation: num(h, 'slab', 'elevation') } as E)]);
  },
  cancel: () => false,
});
const boundsPt = (pts: Pt[], which: 0 | 1): Pt => {
  const b = boundsOf(pts);
  return which === 0 ? [b.minX, b.minY] : [b.maxX, b.maxY];
};

reg({
  id: 'tiling',
  label: 'Tiling',
  hint: () => 'Click inside a room to tile its floor, or click a wall to tile that wall.',
  options: [
    { key: 'target', label: 'Surface', type: 'select', options: sel([['floor', 'Room floor'], ['wall', 'Wall']]) },
    N('tileW', 'Tile width', 'mm', 20, 3000, 10),
    N('tileH', 'Tile height', 'mm', 20, 3000, 10),
    N('grout', 'Grout', 'mm', 0, 20, 1),
    { key: 'pattern', label: 'Pattern', type: 'select', options: sel([['grid', 'Straight grid'], ['brick', 'Brick (half offset)'], ['diagonal', 'Diagonal 45°']]) },
    N('rotation', 'Orientation', '°', 0, 90, 90),
    { key: 'color', label: 'Tile colour', type: 'color' },
    N('height', 'Wall tile height', 'mm', 100, 6000, 50),
  ],
  defaults: { target: 'floor', tileW: 600, tileH: 600, grout: 3, pattern: 'grid', rotation: 0, color: '#d9d4c9', height: 1200 },
  down(h, _st, ev) {
    if (!guard(h)) return;
    const o = h.options('tiling');
    const base = { tileW: Number(o.tileW), tileH: Number(o.tileH), grout: Number(o.grout), pattern: o.pattern as 'grid' | 'brick' | 'diagonal', rotation: Number(o.rotation), color: String(o.color), height: Number(o.height) };
    if (o.target === 'wall') {
      const w = nearestWall(h.floor(), ev.raw, h.tol(16));
      if (!w) return h.say('Click on a wall to tile it.', 'warn');
      commitAdd(h, 'Wall tiling', [mk<E>({ kind: 'tiling', target: 'wall', anchor: rpt(w.q), wall: w.wall.id, ...base } as E)]);
      return;
    }
    const room = roomAt(h.rooms(), ev.pt);
    if (!room) return noRoom(h);
    // replace existing floor tiling of this room
    let f = h.floor();
    const old = Object.values(f.entities).filter((e) => e.kind === 'tiling' && e.target === 'floor' && pointInPolygon(e.anchor, room.outline)).map((e) => e.id);
    if (old.length) f = removeEntities(f, old);
    const e = mk<E>({ kind: 'tiling', target: 'floor', anchor: rpt(room.centroid), ...base } as E);
    h.commit('Floor tiling', addEntities(f, [e]), [e.id]);
  },
  cancel: () => false,
});

reg({
  id: 'stairs',
  label: 'Stairs',
  hint: (st) => (st.origin ? 'Click to set the direction of the flight.' : 'Click the foot of the stairs.'),
  options: [N('width', 'Width', 'mm', 500, 4000, 50), N('steps', 'Number of steps', '', 2, 60, 1), N('riser', 'Riser height', 'mm', 100, 250, 5), N('tread', 'Tread depth', 'mm', 150, 450, 10)],
  defaults: { width: 1000, steps: 14, riser: 180, tread: 260 },
  start: (_h, st) => (st.origin = null),
  ref: (st) => st.origin ?? null,
  down(h, st, ev) {
    if (!guard(h)) return;
    if (!st.origin) return void (st.origin = ev.pt);
    if (dist(st.origin, ev.pt) < 1) return;
    const o = h.options('stairs');
    commitAdd(h, 'Stairs', [mk<E>({ kind: 'stairs', origin: rpt(st.origin), rot: round(angleOf(st.origin, ev.pt), 2), width: Number(o.width), steps: Number(o.steps), riser: Number(o.riser), tread: Number(o.tread) } as E)]);
    st.origin = null;
  },
  preview(h, st, cur) {
    const o = h.options('stairs');
    const origin = st.origin ?? cur.pt;
    const rot = st.origin ? angleOf(st.origin, cur.pt) : 0;
    return [ghost(mk<E>({ id: 'preview', kind: 'stairs', origin, rot, width: Number(o.width), steps: Number(o.steps), riser: Number(o.riser), tread: Number(o.tread) } as E))];
  },
  cancel: (_h, st) => {
    const had = !!st.origin;
    st.origin = null;
    return had;
  },
});

reg({
  id: 'column',
  label: 'Column',
  hint: () => 'Click to place a column (R rotates 15°). Type x,y for an exact position.',
  options: [{ key: 'shape', label: 'Profile', type: 'select', options: sel([['rect', 'Rectangular'], ['round', 'Circular']]) }, N('width', 'Width / diameter', 'mm', 50, 3000, 10), N('depth', 'Depth', 'mm', 50, 3000, 10), N('height', 'Height', 'mm', 500, 12000, 50), N('rot', 'Rotation', '°', -180, 180, 15)],
  defaults: { shape: 'rect', width: 300, depth: 300, height: 2800, rot: 0 },
  key(h, _st, key) {
    if (key.toLowerCase() === 'r') {
      h.setOption('column', 'rot', (Number(h.options('column').rot) + 15) % 360);
      return true;
    }
    return false;
  },
  down(h, _st, ev) {
    if (!guard(h)) return;
    placeColumn(h, ev.pt);
  },
  numeric(h, _st, text) {
    const t = parseTyped(text, h.settings());
    if (!t || t.kind !== 'pair') return false;
    placeColumn(h, [t.a, t.b]);
    return true;
  },
  preview: (h, _st, cur) => {
    const o = h.options('column');
    return [ghost(mk<E>({ id: 'preview', kind: 'column', c: cur.pt, width: Number(o.width), depth: o.shape === 'round' ? Number(o.width) : Number(o.depth), shape: o.shape as 'rect' | 'round', height: Number(o.height), rot: Number(o.rot) } as E))];
  },
  cancel: () => false,
});
function placeColumn(h: PlanHost, p: Pt) {
  const o = h.options('column');
  commitAdd(h, 'Column', [mk<E>({ kind: 'column', c: rpt(p), width: Number(o.width), depth: o.shape === 'round' ? Number(o.width) : Number(o.depth), shape: o.shape as 'rect' | 'round', height: Number(o.height), rot: Number(o.rot) } as E)]);
}

reg({
  id: 'roof',
  label: 'Roof',
  hint: (st) => (st.pts?.length ? 'Click the next roof corner; Enter finishes.' : 'Click inside a room to roof it, or click corners to draw a roof outline.'),
  options: [{ key: 'roofType', label: 'Shape', type: 'select', options: sel([['flat', 'Flat'], ['gable', 'Gable'], ['hip', 'Hip'], ['shed', 'Shed (mono-pitch)']]) }, N('slope', 'Slope', '°', 0, 60, 1), N('overhang', 'Overhang', 'mm', 0, 2000, 50), N('thickness', 'Thickness', 'mm', 20, 600, 10), N('elevation', 'Eaves elevation', 'mm', 0, 20000, 50)],
  defaults: { roofType: 'gable', slope: 25, overhang: 400, thickness: 150, elevation: 2800 },
  start: (_h, st) => (st.pts = []),
  ref: (st) => (st.pts?.length ? st.pts[st.pts.length - 1] : null),
  down(h, st, ev) {
    if (!guard(h)) return;
    if (!st.pts?.length) {
      const room = roomAt(h.rooms(), ev.pt);
      if (room) return createRoof(h, room.outline);
      st.pts = [];
    }
    if (st.pts.length >= 3 && same(ev.pt, st.pts[0], 2 / ev.scale)) return createRoof(h, st.pts, st);
    st.pts.push(ev.pt);
  },
  finish(h, st) {
    if ((st.pts?.length ?? 0) >= 3) createRoof(h, st.pts, st);
    else h.say('A roof outline needs at least 3 corners.', 'warn');
  },
  preview: (_h, st, cur) => (st.pts?.length ? [{ kind: 'poly', pts: [...st.pts, cur.pt], closed: false, style: 'preview' }] : []),
  cancel: (_h, st) => {
    const had = !!st.pts?.length;
    st.pts = [];
    return had;
  },
});
function createRoof(h: PlanHost, pts: Pt[], st?: ToolState) {
  const o = h.options('roof');
  const wallTop = Math.max(Number(o.elevation), h.floor().height);
  commitAdd(h, 'Roof', [mk<E>({ kind: 'roof', pts: pts.map(rpt), roofType: o.roofType as 'flat', slope: Number(o.slope), overhang: Number(o.overhang), thickness: Number(o.thickness), elevation: wallTop } as E)]);
  if (st) st.pts = [];
}

// ---------- measuring & annotation ----------

reg({
  id: 'dimension',
  label: 'Dimension',
  hint: (st) => (!st.a ? 'Click the first point (snap to an end point to link the dimension to the object).' : !st.b ? 'Click the second point.' : 'Click to place the dimension line.'),
  start: (_h, st) => {
    st.a = st.b = null;
  },
  ref: (st) => st.b ?? st.a ?? null,
  down(h, st, ev) {
    if (!guard(h)) return;
    const f = h.floor();
    if (!st.a) {
      st.a = ev.pt;
      st.refA = findHandleAt(f, ev.pt);
      return;
    }
    if (!st.b) {
      if (dist(st.a, ev.pt) < 1) return;
      st.b = ev.pt;
      st.refB = findHandleAt(f, ev.pt);
      return;
    }
    const n = perp(norm(sub(st.b, st.a)));
    const off = dot(sub(ev.pt, st.a), n);
    commitAdd(h, 'Dimension', [mk<E>({ kind: 'dimension', a: rpt(st.a), b: rpt(st.b), offset: round(off, 1), refA: st.refA ?? undefined, refB: st.refB ?? undefined } as E)]);
    st.a = st.b = null;
  },
  preview(h, st, cur) {
    if (st.a && !st.b) return [line(st.a, cur.pt, 'dim'), { kind: 'text', pts: [mid(st.a, cur.pt)], text: mmToDisplay(dist(st.a, cur.pt), h.settings()), style: 'dim' }];
    if (st.a && st.b) {
      const n = perp(norm(sub(st.b, st.a)));
      return [ghost(mk<E>({ id: 'preview', kind: 'dimension', a: st.a, b: st.b, offset: dot(sub(cur.pt, st.a), n) } as E))];
    }
    return [];
  },
  cancel: (_h, st) => {
    const had = !!st.a;
    st.a = st.b = null;
    return had;
  },
});

reg({
  id: 'measure',
  label: 'Measure',
  hint: (st) => (st.a ? 'Click the second point. The result stays on screen until the next measurement.' : 'Click two points to measure, or click inside a room or closed shape to read its area and perimeter.'),
  start: (_h, st) => {
    st.a = null;
  },
  ref: (st) => st.a ?? null,
  down(h, st, ev) {
    if (!st.a) {
      const room = roomAt(h.rooms(), ev.pt);
      const shape = closedShapeAt(h.floor(), ev.pt);
      const outline = room ? room.inner : shape ? closedOutline(h.floor(), shape) : null;
      if (outline && h.options('measure').area !== false) {
        const area = Math.abs(polygonArea(outline));
        let per = 0;
        for (let i = 0; i < outline.length; i++) per += dist(outline[i], outline[(i + 1) % outline.length]);
        st.result = { kind: 'area', outline };
        h.say(`${room ? room.name : entityLabel(shape!)}: area ${(area / 1e6).toFixed(3)} m², perimeter ${mmToDisplay(per, h.settings())}`);
        return;
      }
      st.a = ev.pt;
      st.result = null;
      return;
    }
    const d = sub(ev.pt, st.a);
    const L = Math.hypot(d[0], d[1]);
    st.result = { kind: 'dist', a: st.a, b: ev.pt };
    h.say(`Distance ${mmToDisplay(L, h.settings())} · Δx ${mmToDisplay(Math.abs(d[0]), h.settings())} · Δy ${mmToDisplay(Math.abs(d[1]), h.settings())} · angle ${(((angleOf(st.a, ev.pt) % 360) + 360) % 360).toFixed(1)}°`);
    st.a = null;
  },
  preview(h, st, cur) {
    if (st.a) return [line(st.a, cur.pt, 'dim'), { kind: 'text', pts: [mid(st.a, cur.pt)], text: mmToDisplay(dist(st.a, cur.pt), h.settings()), style: 'dim' }];
    const r = st.result;
    if (r?.kind === 'dist') return [line(r.a, r.b, 'ok'), { kind: 'text', pts: [mid(r.a, r.b)], text: mmToDisplay(dist(r.a, r.b), h.settings()), style: 'ok' }];
    if (r?.kind === 'area') return [{ kind: 'poly', pts: r.outline, closed: true, style: 'ok' }];
    return [];
  },
  cancel: (_h, st) => {
    const had = !!st.a || !!st.result;
    st.a = st.result = null;
    return had;
  },
});

reg({
  id: 'text',
  label: 'Text',
  hint: () => 'Click where the text should go.',
  options: [N('size', 'Text height', 'mm', 20, 2000, 10), N('rot', 'Rotation', '°', -180, 180, 15)],
  defaults: { size: 150, rot: 0 },
  down(h, _st, ev) {
    if (!guard(h)) return;
    void h.prompt('Text', '').then((t) => {
      if (!t || !t.trim()) return;
      commitAdd(h, 'Text', [mk<E>({ kind: 'text', pos: rpt(ev.pt), text: t.trim(), size: num(h, 'text', 'size'), rot: num(h, 'text', 'rot') } as E)]);
    });
  },
  cancel: () => false,
});

reg({
  id: 'compass',
  label: 'Compass',
  hint: () => 'Click to place the compass / north arrow.',
  options: [N('size', 'Size', 'mm', 200, 5000, 50), N('north', 'North direction (0 = up)', '°', -180, 180, 5)],
  defaults: { size: 800, north: 0 },
  down(h, _st, ev) {
    if (!guard(h)) return;
    const f = h.floor();
    const old = Object.values(f.entities).filter((e) => e.kind === 'compass').map((e) => e.id);
    const e = mk<E>({ kind: 'compass', pos: rpt(ev.pt), size: num(h, 'compass', 'size'), north: num(h, 'compass', 'north') } as E);
    h.commit('Compass', addEntities(old.length ? removeEntities(f, old) : f, [e]), [e.id]);
  },
  cancel: () => false,
});

reg({
  id: 'angle',
  label: 'Angle',
  hint: (st) => (!st.v ? 'Click the vertex of the angle.' : !st.a ? 'Click a point on the first arm.' : 'Click a point on the second arm.'),
  start: (_h, st) => {
    st.v = st.a = null;
  },
  ref: (st) => st.a ?? st.v ?? null,
  down(h, st, ev) {
    if (!guard(h)) return;
    if (!st.v) st.v = ev.pt;
    else if (!st.a) {
      if (dist(st.v, ev.pt) < 1) return;
      st.a = ev.pt;
    } else {
      if (dist(st.v, ev.pt) < 1) return;
      commitAdd(h, 'Angle', [mk<E>({ kind: 'angle', v: rpt(st.v), a: rpt(st.a), b: rpt(ev.pt) } as E)]);
      st.v = st.a = null;
    }
  },
  preview(_h, st, cur) {
    if (st.v && !st.a) return [line(st.v, cur.pt)];
    if (st.v && st.a) return [ghost(mk<E>({ id: 'preview', kind: 'angle', v: st.v, a: st.a, b: cur.pt } as E))];
    return [];
  },
  cancel: (_h, st) => {
    const had = !!st.v;
    st.v = st.a = null;
    return had;
  },
});

reg({
  id: 'xy',
  label: 'XY coordinate',
  hint: () => 'Click a point to label its X,Y coordinates.',
  down(h, _st, ev) {
    if (!guard(h)) return;
    commitAdd(h, 'XY', [mk<E>({ kind: 'xy', pos: rpt(ev.pt) } as E)]);
  },
  cancel: () => false,
});

reg({
  id: 'radial',
  label: 'Radial',
  hint: () => 'Click a circle or arc to annotate its radius or diameter.',
  options: [{ key: 'mode', label: 'Show', type: 'select', options: sel([['radius', 'Radius'], ['diameter', 'Diameter']]) }],
  defaults: { mode: 'radius' },
  down(h, _st, ev) {
    if (!guard(h)) return;
    const id = pickEntity(h.floor(), ev.raw, h.tol(8), 'architecture');
    const e = id ? h.floor().entities[id] : null;
    if (!e || (e.kind !== 'circle' && e.kind !== 'arc')) return h.say('Click a circle or an arc.', 'warn');
    const c = e.kind === 'circle' ? e.c : arcFrom3(e.p1, e.p2, e.p3)?.c;
    if (!c) return h.say('That arc is degenerate.', 'error');
    commitAdd(h, 'Radial', [mk<E>({ kind: 'radial', target: e.id, mode: h.options('radial').mode as 'radius' | 'diameter', angle: round(angleOf(c, ev.raw), 1) } as E)]);
  },
  cancel: () => false,
});

reg({
  id: 'leader',
  label: 'MultiLeader',
  hint: (st) => (st.pts?.length ? 'Click the next bend; Enter / right-click finishes and asks for the text.' : 'Click the point the leader should point to.'),
  options: [N('size', 'Text height', 'mm', 20, 1000, 10)],
  defaults: { size: 120 },
  start: (_h, st) => (st.pts = []),
  ref: (st) => (st.pts?.length ? st.pts[st.pts.length - 1] : null),
  down(h, st, ev) {
    if (!guard(h)) return;
    (st.pts ?? (st.pts = [])).push(ev.pt);
  },
  finish(h, st) {
    const pts: Pt[] = st.pts ?? [];
    if (pts.length < 2) return h.say('A leader needs a tip and at least one more point.', 'warn');
    void h.prompt('Leader text', '').then((t) => {
      if (!t?.trim()) return;
      commitAdd(h, 'MultiLeader', [mk<E>({ kind: 'leader', pts: pts.map(rpt), text: t.trim(), size: num(h, 'leader', 'size') } as E)]);
    });
    st.pts = [];
  },
  preview: (_h, st, cur) => (st.pts?.length ? [{ kind: 'poly', pts: [...st.pts, cur.pt], style: 'preview' }] : []),
  cancel: (_h, st) => {
    const had = !!st.pts?.length;
    st.pts = [];
    return had;
  },
});

// ---------- insert ----------

reg({
  id: 'light',
  label: 'Light',
  hint: () => 'Click to place a light. Adjust type, elevation and intensity in the options.',
  options: [{ key: 'lightType', label: 'Type', type: 'select', options: sel([['ceiling', 'Ceiling light'], ['point', 'Point light'], ['spot', 'Spot'], ['wall', 'Wall light']]) }, N('elevation', 'Elevation', 'mm', 0, 12000, 50), N('intensity', 'Intensity', '×', 0, 5, 0.1), { key: 'color', label: 'Colour', type: 'color' }],
  defaults: { lightType: 'ceiling', elevation: 2700, intensity: 1, color: '#fff1d6' },
  down(h, _st, ev) {
    if (!guard(h)) return;
    const o = h.options('light');
    commitAdd(h, 'Light', [mk<E>({ kind: 'light', pos: rpt(ev.pt), elevation: Number(o.elevation), lightType: o.lightType as 'ceiling', intensity: Number(o.intensity), color: String(o.color) } as E)]);
  },
  cancel: () => false,
});

reg({
  id: 'furnish',
  label: 'Furnish',
  hint: (st) => (st.rot ? `Rotation ${st.rot}°. Click to place; R rotates 90°.` : 'Choose an item in the Furnish panel, then click to place it. R rotates 90°.'),
  start: (_h, st) => (st.rot = 0),
  key(_h, st, key) {
    if (key.toLowerCase() === 'r') {
      st.rot = ((st.rot ?? 0) + 90) % 360;
      return true;
    }
    return false;
  },
  down(h, st, ev) {
    if (!guard(h)) return;
    const p = h.payload();
    if (!p?.itemId) return h.say('Pick a furniture item in the library panel first.', 'warn');
    const id = h.placeFurniture(String(p.itemId), ev.pt, st.rot ?? 0);
    if (id) h.setSelection([id]);
  },
  preview(h, st, cur) {
    const p = h.payload();
    if (!p?.size) return [];
    const s = p.size as { w: number; d: number };
    return [{ kind: 'poly', pts: (([[-s.w / 2, -s.d / 2], [s.w / 2, -s.d / 2], [s.w / 2, s.d / 2], [-s.w / 2, s.d / 2]] as Pt[]).map((q) => add(cur.pt, rotateLocal(q, st.rot ?? 0)))), closed: true, style: 'preview' }];
  },
  cancel: () => false,
});
const rotateLocal = (p: Pt, deg: number): Pt => [p[0] * Math.cos(rad(deg)) - p[1] * Math.sin(rad(deg)), p[0] * Math.sin(rad(deg)) + p[1] * Math.cos(rad(deg))];

reg({
  id: 'model',
  label: '3D Import',
  hint: () => 'Click to place the imported model. R rotates 90°.',
  options: [N('elevation', 'Elevation', 'mm', 0, 12000, 10), N('scale', 'Scale', '×', 0.01, 100, 0.1)],
  defaults: { elevation: 0, scale: 1 },
  start: (_h, st) => (st.rot = 0),
  key(_h, st, key) {
    if (key.toLowerCase() === 'r') {
      st.rot = ((st.rot ?? 0) + 90) % 360;
      return true;
    }
    return false;
  },
  down(h, st, ev) {
    if (!guard(h)) return;
    const p = h.payload() as { url: string; fileName: string; size: { w: number; d: number; h: number } } | null;
    if (!p?.url) return h.say('Import a GLB file first (Insert → 3D Import).', 'warn');
    const k = num(h, 'model', 'scale') || 1;
    commitAdd(h, '3D model', [mk<E>({ kind: 'model', pos: rpt(ev.pt), elevation: num(h, 'model', 'elevation'), rot: st.rot ?? 0, size: { w: p.size.w * k, d: p.size.d * k, h: p.size.h * k }, url: p.url, fileName: p.fileName } as E)]);
  },
  preview(h, st, cur) {
    const p = h.payload() as { size: { w: number; d: number } } | null;
    if (!p?.size) return [];
    const k = num(h, 'model', 'scale') || 1;
    const s = { w: p.size.w * k, d: p.size.d * k };
    return [{ kind: 'poly', pts: (([[-s.w / 2, -s.d / 2], [s.w / 2, -s.d / 2], [s.w / 2, s.d / 2], [-s.w / 2, s.d / 2]] as Pt[]).map((q) => add(cur.pt, rotateLocal(q, st.rot ?? 0)))), closed: true, style: 'preview' }];
  },
  cancel: () => false,
});

reg({
  id: 'reference',
  label: 'Add Reference',
  hint: (st) => (st.a ? 'Click a second point at a known distance, then type the real distance to calibrate the scale. (Or press Enter to keep the current scale.)' : 'Click where the reference image should be centred.'),
  options: [N('opacity', 'Opacity', '', 0.1, 1, 0.1), N('width', 'Width', 'mm', 100, 200000, 100)],
  defaults: { opacity: 0.5, width: 10000 },
  start: (_h, st) => {
    st.a = null;
    st.id = null;
  },
  down(h, st, ev) {
    if (!guard(h)) return;
    const p = h.payload() as { url: string; fileName: string; aspect: number } | null;
    if (!p?.url) return h.say('Choose an image first (Insert → Add Ref.).', 'warn');
    const w = num(h, 'reference', 'width');
    commitAdd(h, 'Reference', [mk<E>({ kind: 'reference', url: p.url, fileName: p.fileName, pos: rpt(ev.pt), width: w, height: w / (p.aspect || 1), rot: 0, opacity: num(h, 'reference', 'opacity') } as E)]);
  },
  cancel: () => false,
});

// ---------- registry helpers ----------

export function toolOptionDefaults(id: ToolId): ToolOptions {
  return { ...(TOOLS[id]?.defaults ?? {}) };
}

export { rotateEntities, pickInBox, withGroups, wallGeometries, floorWalls, wallLen, handlePoint, entityHandles, entityBounds, pointSegment, angleBetween, updateEntity, mul, dist as distance, stairsOutline };
export type { Box };
