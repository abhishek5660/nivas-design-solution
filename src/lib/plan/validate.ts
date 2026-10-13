import type { Entity, EntityKind, PlanModel } from './types';

const KINDS: EntityKind[] = ['line', 'polyline', 'arc', 'circle', 'rect', 'polygon', 'arrow', 'hatch', 'guide', 'wall', 'door', 'window', 'column', 'beam', 'slab', 'ceiling', 'tiling', 'stairs', 'railing', 'roof', 'light', 'strip', 'model', 'reference', 'dimension', 'text', 'compass', 'angle', 'xy', 'radial', 'leader'];

function finite(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(finite);
  if (v && typeof v === 'object') return Object.values(v as object).every(finite);
  return true;
}

/** Structural validation of the floor-plan data. Errors block saving/import; warnings are informational. */
export function validatePlan(plan: unknown): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const p = plan as PlanModel | undefined;
  if (!p || typeof p !== 'object') return { errors: ['Floor plan data is missing.'], warnings };
  if (p.version !== 1) errors.push('Floor plan version is not supported.');
  if (!Array.isArray(p.buildings) || !p.buildings.length) return { errors: [...errors, 'The plan has no building.'], warnings };
  const floorIds = new Set<string>();
  for (const b of p.buildings) {
    if (!Array.isArray(b.floors) || !b.floors.length) errors.push(`${b.name ?? 'A building'} has no floor.`);
    for (const f of b.floors ?? []) {
      if (floorIds.has(f.id)) errors.push(`Floor id ${f.id} is used twice.`);
      floorIds.add(f.id);
      if (!Number.isFinite(f.elevation) || !(f.height > 0)) errors.push(`Floor "${f.name}": elevation/height must be valid numbers (height > 0).`);
      const seen = new Set<string>();
      for (const id of f.order ?? []) {
        if (!f.entities?.[id]) errors.push(`Floor "${f.name}": order references missing object ${id}.`);
        if (seen.has(id)) errors.push(`Floor "${f.name}": object ${id} is listed twice.`);
        seen.add(id);
      }
      for (const [k, e] of Object.entries(f.entities ?? {}) as [string, Entity][]) {
        if (e.id !== k) errors.push(`Floor "${f.name}": object key ${k} does not match its id.`);
        if (!seen.has(k)) errors.push(`Floor "${f.name}": object ${k} is missing from the order list.`);
        if (!KINDS.includes(e.kind)) errors.push(`Floor "${f.name}": unknown object type "${(e as { kind: string }).kind}".`);
        if (!finite(e)) errors.push(`Floor "${f.name}": ${e.kind} ${k} contains an invalid number.`);
        if (e.kind === 'wall' && !(e.thickness > 0 && e.height > 0)) errors.push(`Wall ${k}: thickness and height must be positive.`);
        if ((e.kind === 'door' || e.kind === 'window') && (!(e.width > 0 && e.height > 0) || e.offset < 0)) errors.push(`${e.kind} ${k}: width/height must be positive and the offset cannot be negative.`);
        if ((e.kind === 'door' || e.kind === 'window') && f.entities[e.wall]?.kind !== 'wall') errors.push(`${e.kind} ${k} is not attached to a wall.`);
        if (e.kind === 'circle' && !(e.r > 0)) errors.push(`Circle ${k}: radius must be positive.`);
        if (e.kind === 'column' && !(e.width > 0 && e.depth > 0 && e.height > 0)) errors.push(`Column ${k}: dimensions must be positive.`);
        if (e.kind === 'stairs' && !(e.steps >= 1 && e.riser > 0 && e.tread > 0 && e.width > 0)) errors.push(`Stairs ${k}: steps, riser, tread and width must be positive.`);
        if ((e.kind === 'model' || e.kind === 'reference') && e.url && !/^\/api\/assets\/[A-Za-z0-9_-]+$/.test(e.url)) errors.push(`${e.kind} ${k}: the file must be an uploaded asset (missing asset).`);
      }
    }
  }
  if (!floorIds.has(p.activeFloorId)) errors.push('The active floor does not exist.');
  if (!p.buildings.some((b) => b.id === p.activeBuildingId)) errors.push('The active building does not exist.');
  if ((p.gallery ?? []).some((g) => !/^\/api\/assets\/[A-Za-z0-9_-]+$/.test(g.url))) errors.push('A gallery image is not an uploaded asset.');
  return { errors, warnings };
}
