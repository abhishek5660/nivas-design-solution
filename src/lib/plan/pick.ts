import { entityBounds, entityDistance, entityHit, entityInBox } from './entities';
import { floorEntities } from './walls';
import { ARCHITECTURE_KINDS } from './types';
import type { DesignMode, Entity, EntityKind, Floor, Pt } from './types';
import type { Box } from './geom';

const RANK: Partial<Record<EntityKind, number>> = {
  dimension: 0, text: 0, leader: 0, angle: 0, radial: 0, xy: 0, compass: 0,
  door: 1, window: 1, light: 1, strip: 1,
  model: 2, stairs: 2, column: 3, beam: 3, railing: 3,
  line: 4, polyline: 4, arc: 4, circle: 4, rect: 4, polygon: 4, arrow: 4, guide: 5, roof: 5,
  wall: 6, reference: 9, hatch: 9, tiling: 9, slab: 9, ceiling: 9,
};

/** Whether an entity can be picked/edited under the current design mode. */
export function isSelectable(e: Entity, mode: DesignMode, planLocked: boolean): boolean {
  if (planLocked || e.locked || e.hidden) return false;
  if (mode === 'interior' && ARCHITECTURE_KINDS.includes(e.kind)) return false; // architecture is locked while furnishing
  if (mode === 'production' && e.kind !== 'model') return false;
  return true;
}

export function pickEntity(floor: Floor, p: Pt, tol: number, mode: DesignMode, planLocked = false): string | null {
  let best: { id: string; d: number; rank: number } | null = null;
  for (const e of floorEntities(floor)) {
    if (!isSelectable(e, mode, planLocked)) continue;
    if (floor.isolated && !floor.isolated.includes(e.id)) continue;
    if (!entityHit(floor, e, p, tol)) continue;
    const d = Math.round(entityDistance(floor, e, p) / Math.max(tol / 4, 1));
    const rank = RANK[e.kind] ?? 5;
    if (!best || d < best.d || (d === best.d && rank < best.rank)) best = { id: e.id, d, rank };
  }
  return best?.id ?? null;
}

export function pickInBox(floor: Floor, box: Box, crossing: boolean, mode: DesignMode, planLocked = false): string[] {
  const out: string[] = [];
  for (const e of floorEntities(floor)) {
    if (!isSelectable(e, mode, planLocked)) continue;
    if (floor.isolated && !floor.isolated.includes(e.id)) continue;
    if (e.kind === 'hatch' || e.kind === 'tiling' || e.kind === 'slab' || e.kind === 'ceiling') continue;
    if (entityInBox(floor, e, box, crossing)) out.push(e.id);
  }
  return out;
}

/** Group members are selected together. */
export function withGroups(floor: Floor, ids: string[]): string[] {
  const groups = new Set(ids.map((i) => floor.entities[i]?.group).filter(Boolean));
  if (!groups.size) return ids;
  const out = new Set(ids);
  for (const e of floorEntities(floor)) if (e.group && groups.has(e.group)) out.add(e.id);
  return [...out];
}

export { entityBounds };
