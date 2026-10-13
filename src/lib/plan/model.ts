import type { Building, Entity, Floor, PlanModel, PlanSettings } from './types';
import { newId } from './walls';

export const DEFAULT_SETTINGS: PlanSettings = {
  grid: { visible: true, spacing: 100, major: 1000 },
  snap: { grid: true, endpoint: true, midpoint: true, intersection: true, nearest: false, ortho: true, magnet: true },
  units: { display: 'mm', precision: 0 },
  selection: { mode: 'auto' },
  dynamicInput: true,
  showDimensions: true,
  showRoomLabels: true,
  showReferences: true,
  showLights: true,
  xray: false,
  wallDefaults: { thickness: 200, height: 2800, wallType: 'interior' },
};

export const DEFAULT_FLOOR_HEIGHT = 2800;

export function makeFloor(name: string, elevation: number, height = DEFAULT_FLOOR_HEIGHT): Floor {
  return { id: newId('floor'), name, elevation, height, entities: {}, order: [] };
}

export function makePlan(enabled = true): PlanModel {
  const floor = makeFloor('Ground Floor', 0);
  const building: Building = { id: newId('bld'), name: 'Building 1', floors: [floor] };
  return {
    version: 1,
    enabled,
    mode: 'architecture',
    buildings: [building],
    activeBuildingId: building.id,
    activeFloorId: floor.id,
    settings: structuredClone(DEFAULT_SETTINGS),
    components: [],
    viewpoints: [],
    presentations: [],
    gallery: [],
    branches: [],
    activeBranch: null,
    roomProps: {},
    locked: false,
    extraLighting: 1,
    prices: {},
    schedule: {},
  };
}

export const activeBuilding = (p: PlanModel): Building => p.buildings.find((b) => b.id === p.activeBuildingId) ?? p.buildings[0];
export const activeFloor = (p: PlanModel): Floor => {
  const b = activeBuilding(p);
  return b.floors.find((f) => f.id === p.activeFloorId) ?? b.floors[0];
};
export const findFloor = (p: PlanModel, id: string): Floor | undefined => p.buildings.flatMap((b) => b.floors).find((f) => f.id === id);
export const allFloors = (p: PlanModel): Floor[] => p.buildings.flatMap((b) => b.floors);

/** Returns a new plan with `fn` applied to the floor with this id. */
export function updateFloor(p: PlanModel, floorId: string, fn: (f: Floor) => Floor): PlanModel {
  return {
    ...p,
    buildings: p.buildings.map((b) => (b.floors.some((f) => f.id === floorId) ? { ...b, floors: b.floors.map((f) => (f.id === floorId ? fn(f) : f)) } : b)),
  };
}

export function addEntities(f: Floor, es: Entity[]): Floor {
  const entities = { ...f.entities };
  const order = [...f.order];
  for (const e of es) {
    entities[e.id] = e;
    if (!order.includes(e.id)) order.push(e.id);
  }
  return { ...f, entities, order };
}

export function removeEntities(f: Floor, ids: string[]): Floor {
  const drop = new Set(ids);
  // removing a wall removes its doors and windows; removing a tiled/slab target does not cascade
  for (const e of Object.values(f.entities)) if ((e.kind === 'door' || e.kind === 'window') && drop.has(e.wall)) drop.add(e.id);
  for (const e of Object.values(f.entities)) if ((e.kind === 'dimension' || e.kind === 'radial') && refsGone(e, drop)) drop.add(e.id);
  const entities: Record<string, Entity> = {};
  for (const [k, v] of Object.entries(f.entities)) if (!drop.has(k)) entities[k] = v;
  return { ...f, entities, order: f.order.filter((i) => !drop.has(i)), isolated: f.isolated?.filter((i) => !drop.has(i)) };
}

function refsGone(e: Entity, drop: Set<string>): boolean {
  if (e.kind === 'radial') return drop.has(e.target);
  if (e.kind === 'dimension') return !!((e.refA && drop.has(e.refA.id)) && (e.refB && drop.has(e.refB.id)));
  return false;
}

export function updateEntity(f: Floor, id: string, patch: Partial<Entity>): Floor {
  const e = f.entities[id];
  if (!e) return f;
  return { ...f, entities: { ...f.entities, [id]: { ...e, ...patch } as Entity } };
}

export function mmToDisplay(mm: number, s: PlanSettings): string {
  const { display, precision } = s.units;
  const f = { mm: 1, cm: 0.1, m: 0.001, in: 1 / 25.4, ft: 1 / 304.8 }[display];
  const v = mm * f;
  const p = display === 'mm' ? Math.max(0, precision) : Math.max(display === 'm' ? 2 : 1, precision);
  return `${v.toFixed(p)} ${display}`;
}

export function displayToMm(text: string, s: PlanSettings): number | null {
  const m = /^\s*(-?\d+(?:[.,]\d+)?)\s*(mm|cm|m|in|ft|"|')?\s*$/i.exec(text);
  if (!m) return null;
  const v = parseFloat(m[1].replace(',', '.'));
  const unit = (m[2] ?? s.units.display).toLowerCase();
  const f = ({ mm: 1, cm: 10, m: 1000, in: 25.4, '"': 25.4, ft: 304.8, "'": 304.8 } as Record<string, number>)[unit];
  return f ? v * f : null;
}
