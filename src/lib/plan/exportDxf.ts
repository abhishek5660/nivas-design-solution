import { entityPaths } from './entities';
import { roomsOf } from './rooms';
import { floorEntities, floorWalls, wallGeometries } from './walls';
import type { Entity, Floor, PlanModel, Pt } from './types';

const LAYER: Partial<Record<Entity['kind'], string>> = {
  wall: 'WALLS', door: 'DOORS', window: 'WINDOWS', column: 'COLUMNS', beam: 'BEAMS', slab: 'SLABS', stairs: 'STAIRS', railing: 'RAILINGS', roof: 'ROOF',
  dimension: 'DIMENSIONS', text: 'TEXT', leader: 'TEXT', light: 'LIGHTS', strip: 'LIGHTS', guide: 'CONSTRUCTION',
};
const SKIP: Entity['kind'][] = ['hatch', 'tiling', 'ceiling', 'reference', 'model', 'compass', 'xy', 'radial', 'angle'];

const num = (n: number) => (Math.round(n * 1000) / 1000).toString();

/**
 * ASCII DXF (AutoCAD R12 compatible) of one floor. Units are millimetres; plan y runs south, DXF y runs north, so y is mirrored.
 * Lines/arcs/walls/openings/columns/stairs are written as LINE entities, circles as CIRCLE, text as TEXT.
 */
export function floorToDxf(floor: Floor, plan?: PlanModel): string {
  const out: string[] = [];
  const g = (code: number, value: string | number) => out.push(String(code), String(value));
  const layers = new Set<string>(['0']);
  const body: string[] = [];
  const push = (code: number, value: string | number) => body.push(String(code), String(value));
  const line = (layer: string, a: Pt, b: Pt) => {
    layers.add(layer);
    push(0, 'LINE'); push(8, layer);
    push(10, num(a[0])); push(20, num(-a[1])); push(30, 0);
    push(11, num(b[0])); push(21, num(-b[1])); push(31, 0);
  };
  const path = (layer: string, pts: Pt[], closed: boolean) => {
    for (let i = 0; i < pts.length - 1; i++) line(layer, pts[i], pts[i + 1]);
    if (closed && pts.length > 2) line(layer, pts[pts.length - 1], pts[0]);
  };
  const text = (layer: string, at: Pt, h: number, s: string) => {
    layers.add(layer);
    push(0, 'TEXT'); push(8, layer);
    push(10, num(at[0])); push(20, num(-at[1])); push(30, 0);
    push(40, num(h)); push(1, s.replace(/[\r\n]+/g, ' '));
  };

  const walls = floorWalls(floor);
  for (const w of wallGeometries(walls)) path('WALLS', w.outline as Pt[], true);
  for (const e of floorEntities(floor)) {
    if (e.hidden || SKIP.includes(e.kind) || e.kind === 'wall') continue;
    const layer = LAYER[e.kind] ?? 'DRAWING';
    if (e.kind === 'circle') {
      layers.add(layer);
      push(0, 'CIRCLE'); push(8, layer);
      push(10, num(e.c[0])); push(20, num(-e.c[1])); push(30, 0); push(40, num(e.r));
    } else if (e.kind === 'text') text(layer, e.pos, e.size, e.text);
    else if (e.kind === 'leader') {
      path(layer, e.pts, false);
      text(layer, e.pts[e.pts.length - 1], e.size, e.text);
    } else if (e.kind === 'dimension') {
      path(layer, [e.a, e.b], false);
      const d = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]);
      text(layer, [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2], 120, `${Math.round(d)}`);
    } else for (const p of entityPaths(floor, e)) path(layer, p.pts, p.closed);
  }
  if (plan) for (const r of roomsOf(floor, plan.roomProps)) text('ROOMS', r.centroid, 150, `${r.name} ${(r.area / 1e6).toFixed(1)} m2`);

  g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1009'); g(9, '$INSUNITS'); g(70, 4); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'TABLES'); g(0, 'TABLE'); g(2, 'LAYER'); g(70, layers.size);
  for (const l of layers) { g(0, 'LAYER'); g(2, l); g(70, 0); g(62, 7); g(6, 'CONTINUOUS'); }
  g(0, 'ENDTAB'); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'ENTITIES');
  out.push(...body);
  g(0, 'ENDSEC'); g(0, 'EOF');
  return out.join('\n') + '\n';
}
