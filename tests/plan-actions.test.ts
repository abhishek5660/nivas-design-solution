import { describe, expect, it } from 'vitest';
import { addBuilding, addFloor, alignEntities, autoDimensions, autoRoomLabels, createBranch, deleteBranch, deleteBuilding, deleteFloor, duplicateFloor, generateLayout, healWalls, removeDuplicateWalls, roomToPlan, setFloorLevels, switchBranch } from '@/lib/plan/actions';
import { drawingToDXF, drawingToSVG } from '@/lib/docs/drawing';
import { drawingsPdf } from '@/lib/docs/export';
import { floorToDxf } from '@/lib/plan/exportDxf';
import { buildFloorSheet } from '@/lib/plan/sheet';
import { activeBuilding, activeFloor, addEntities, allFloors, makePlan, updateFloor } from '@/lib/plan/model';
import { polygonArea } from '@/lib/plan/geom';
import { roomsOf } from '@/lib/plan/rooms';
import { validatePlan } from '@/lib/plan/validate';
import { floorEntities, floorWalls, newId } from '@/lib/plan/walls';
import type { Entity, PlanModel, WallE } from '@/lib/plan/types';
import { addNodeToDoc, defaultDoc, makeNode } from '@/lib/scene';
import type { SceneDoc } from '@/lib/types';
import { validateDoc } from '@/lib/schema';

const wall = (a: [number, number], b: [number, number]): WallE => ({ id: newId('wall'), kind: 'wall', a, b, thickness: 200, height: 2800, wallType: 'interior' });

function boxPlan(): PlanModel {
  const p = makePlan(true);
  const ws = [wall([0, 0], [4000, 0]), wall([4000, 0], [4000, 3000]), wall([4000, 3000], [0, 3000]), wall([0, 3000], [0, 0])];
  const door: Entity = { id: newId('door'), kind: 'door', wall: ws[0].id, offset: 1000, width: 900, height: 2100, swing: 'left', opens: 'in' };
  return updateFloor(p, p.activeFloorId, (f) => addEntities(f, [...ws, door]));
}

describe('buildings and floors', () => {
  it('adds a floor above with the right elevation and makes it active', () => {
    const p = addFloor(boxPlan(), 'above');
    const floors = activeBuilding(p).floors;
    expect(floors.map((f) => f.elevation)).toEqual([0, 2800]);
    expect(activeFloor(p).name).toBe('First Floor');
    expect(activeFloor(p).order).toHaveLength(0);
  });

  it('adds a basement below at a negative elevation', () => {
    const p = addFloor(boxPlan(), 'below');
    expect(activeFloor(p).elevation).toBe(-2800);
    expect(activeBuilding(p).floors[0].id).toBe(activeFloor(p).id);
  });

  it('duplicates a floor with new ids and doors attached to the copied walls', () => {
    const p0 = boxPlan();
    const p = duplicateFloor(p0, p0.activeFloorId);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const copy = activeFloor(p.value);
    const orig = allFloors(p.value)[0];
    expect(copy.id).not.toBe(orig.id);
    expect(floorEntities(copy)).toHaveLength(floorEntities(orig).length);
    const door = floorEntities(copy).find((e) => e.kind === 'door') as Extract<Entity, { kind: 'door' }>;
    expect(copy.entities[door.wall]?.kind).toBe('wall');
    expect(orig.entities[door.wall]).toBeUndefined();
    expect(validatePlan(p.value).errors).toEqual([]);
  });

  it('refuses to delete the last floor or building, deletes others, and keeps an active floor', () => {
    const p0 = boxPlan();
    expect(deleteFloor(p0, p0.activeFloorId).ok).toBe(false);
    const p1 = addFloor(p0, 'above');
    const r = deleteFloor(p1, p1.activeFloorId);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.activeFloorId).toBe(p0.activeFloorId);
    expect(deleteBuilding(p0, p0.activeBuildingId).ok).toBe(false);
    const p2 = addBuilding(p0);
    const d = deleteBuilding(p2, p2.activeBuildingId);
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.value.plan.buildings).toHaveLength(1);
  });

  it('validates storey heights and reports the shift for furniture', () => {
    const p = boxPlan();
    expect(setFloorLevels(p, p.activeFloorId, 0, 500).ok).toBe(false);
    const r = setFloorLevels(p, p.activeFloorId, 300, 3000);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.shift).toBe(300);
      expect(activeFloor(r.value.plan).height).toBe(3000);
    }
  });
});

describe('selection actions', () => {
  it('aligns objects to the left edge and distributes evenly', () => {
    let p = makePlan(true);
    const mk = (x: number, y: number): Entity => ({ id: newId('rect'), kind: 'rect', p1: [x, y], p2: [x + 500, y + 500] });
    const es = [mk(100, 0), mk(900, 1000), mk(2500, 300)];
    p = updateFloor(p, p.activeFloorId, (f) => addEntities(f, es));
    const f = activeFloor(p);
    const r = alignEntities(f, es.map((e) => e.id), 'left');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const xs = es.map((e) => (r.value.entities[e.id] as Extract<Entity, { kind: 'rect' }>).p1[0]);
    expect(xs).toEqual([100, 100, 100]);
    const d = alignEntities(f, es.map((e) => e.id), 'distribute-x');
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    const x2 = es.map((e) => (d.value.entities[e.id] as Extract<Entity, { kind: 'rect' }>).p1[0]);
    // gaps between the three 500 mm boxes become equal
    expect(x2[1] - (x2[0] + 500)).toBeCloseTo(x2[2] - (x2[1] + 500), 6);
    expect(alignEntities(f, [es[0].id], 'left').ok).toBe(false);
  });
});

describe('automatic tools', () => {
  it('dimensions every wall once and links the dimensions to the walls', () => {
    const f = activeFloor(boxPlan());
    const r = autoDimensions(f);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.added).toBe(4);
    expect(autoDimensions(r.value.floor).ok).toBe(false);
    const dims = floorEntities(r.value.floor).filter((e) => e.kind === 'dimension');
    expect(dims.every((d) => d.kind === 'dimension' && d.refA && d.refB)).toBe(true);
  });

  it('labels rooms with their real area', () => {
    const p = boxPlan();
    const r = autoRoomLabels(activeFloor(p), p);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = floorEntities(r.value.floor).find((e) => e.kind === 'text') as Extract<Entity, { kind: 'text' }>;
    expect(t.text).toContain('10.6 m²'); // (4000-200) x (3000-200)
  });

  it('joins wall ends that nearly touch and removes duplicates', () => {
    let p = makePlan(true);
    p = updateFloor(p, p.activeFloorId, (f) => addEntities(f, [wall([0, 0], [4000, 0]), wall([4030, 20], [4000, 3000]), wall([4000, 3010], [0, 3000]), wall([5, 2990], [0, 0])]));
    const r = healWalls(activeFloor(p));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(roomsOf(r.value.floor)).toHaveLength(1);
    const dup = addEntities(activeFloor(boxPlan()), [wall([0, 0], [4000, 0])]);
    const d = removeDuplicateWalls(dup);
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.value.removed).toBe(1);
    expect(removeDuplicateWalls(activeFloor(boxPlan())).ok).toBe(false);
  });
});

describe('floor plan wizard', () => {
  const spec = {
    origin: [0, 0] as [number, number],
    thickness: 200,
    height: 2800,
    doors: true,
    windows: true,
    entrance: true,
    rows: [
      { depth: 3500, rooms: [{ name: 'Living', width: 5000 }, { name: 'Kitchen', width: 3000 }] },
      { depth: 3000, rooms: [{ name: 'Bedroom', width: 4000 }, { name: 'Bath', width: 2000 }, { name: 'Study', width: 2000 }] },
    ],
  };

  it('creates one room per cell, names them, and adds real openings', () => {
    const p = makePlan(true);
    const r = generateLayout(activeFloor(p), spec);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rooms = roomsOf(r.value.floor);
    expect(rooms).toHaveLength(5);
    expect(Object.values(r.value.roomNames).sort()).toEqual(['Bath', 'Bedroom', 'Kitchen', 'Living', 'Study']);
    const ents = floorEntities(r.value.floor);
    expect(ents.filter((e) => e.kind === 'door').length).toBeGreaterThanOrEqual(5);
    expect(ents.filter((e) => e.kind === 'window').length).toBeGreaterThanOrEqual(4);
    const plan = updateFloor(p, p.activeFloorId, () => r.value.floor);
    expect(validatePlan(plan).errors).toEqual([]);
    // widest row defines the outer width: the shorter row is closed by stretching its last room
    const total = rooms.reduce((a, x) => a + x.area, 0);
    expect(total).toBeGreaterThan(30e6);
  });

  it('rejects impossible sizes with a message', () => {
    const p = makePlan(true);
    const bad = generateLayout(activeFloor(p), { ...spec, rows: [{ depth: 900, rooms: [{ name: 'x', width: 3000 }] }] });
    expect(bad.ok).toBe(false);
    expect(generateLayout(activeFloor(p), { ...spec, rows: [] }).ok).toBe(false);
  });
});

describe('branches', () => {
  it('stores variants and restores each one exactly, including furniture', () => {
    const base = { ...defaultDoc('CUSTOM'), plan: boxPlan() };
    const r = createBranch(base.plan!, base, 'Option B');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    let doc: SceneDoc = { ...base, plan: r.value };
    const branchId = doc.plan!.branches[0].id;
    expect(createBranch(doc.plan!, doc, 'option b').ok).toBe(false); // duplicate name
    // go to main (initial state), add a sofa there, then switch to the variant
    const sofa = makeNode('furniture', { params: { kind: 'sofa3' } });
    doc = addNodeToDoc(doc, sofa);
    const toB = switchBranch(doc, branchId);
    expect(toB.ok).toBe(true);
    if (!toB.ok) return;
    expect(Object.keys(toB.value.nodes)).not.toContain(sofa.id); // variant was copied before the sofa existed
    expect(toB.value.plan!.activeBranch).toBe(branchId);
    const back = switchBranch(toB.value, null);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(Object.keys(back.value.nodes)).toContain(sofa.id); // main design came back with its sofa
    expect(validateDoc(back.value).ok).toBe(true);
    expect(deleteBranch(toB.value.plan!, branchId).ok).toBe(false); // cannot delete the open branch
    expect(deleteBranch(back.value.plan!, branchId).ok).toBe(true);
  });
});

describe('classic room to plan', () => {
  it('turns the room polygon, doors and windows into real walls and openings', () => {
    const doc = defaultDoc('WARDROBE');
    const p = roomToPlan(doc);
    const f = activeFloor(p);
    expect(floorWalls(f).length).toBeGreaterThanOrEqual(doc.room.points.length);
    const opens = floorEntities(f).filter((e) => e.kind === 'door' || e.kind === 'window');
    expect(opens.length).toBe(doc.room.openings.length);
    expect(validatePlan(p).errors).toEqual([]);
    expect(roomsOf(f).length).toBe(1);
    // the old polygon was the clear interior: the new room's clear interior is exactly the same shape
    const legacyArea = Math.abs(polygonArea(doc.room.points as [number, number][]));
    const room = roomsOf(f)[0];
    expect(Math.abs(room.area - legacyArea)).toBeLessThan(5); // mm²
    const inner = room.inner.map((q) => [Math.round(q[0]), Math.round(q[1])]).sort();
    const old = (doc.room.points as [number, number][]).map((q) => [Math.round(q[0]), Math.round(q[1])]).sort();
    expect(inner).toEqual(old);
    // openings stay on their walls and inside them
    for (const o of opens) {
      const wl = f.entities[(o as { wall: string }).wall] as WallE;
      expect((o as { offset: number }).offset + (o as { width: number }).width).toBeLessThanOrEqual(Math.hypot(wl.b[0] - wl.a[0], wl.b[1] - wl.a[1]));
    }
  });
});

describe('DXF export', () => {
  it('writes walls, openings and annotations on their own layers', () => {
    const p = boxPlan();
    const dxf = floorToDxf(activeFloor(p), p);
    expect(dxf.startsWith('0\nSECTION')).toBe(true);
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true);
    expect(dxf).toContain('WALLS');
    expect(dxf).toContain('DOORS');
    expect(dxf).toContain('ROOMS');
    expect((dxf.match(/\nLINE\n/g) ?? []).length).toBeGreaterThan(8);
  });
});

describe('printable floor sheet', () => {
  it('draws walls with gaps for openings, rooms, furniture and overall dimensions', () => {
    let doc: SceneDoc = { ...defaultDoc('CUSTOM'), plan: boxPlan() };
    const f = activeFloor(doc.plan!);
    const sofa = makeNode('furniture', { params: { kind: 'sofa3' } });
    sofa.floorId = f.id;
    sofa.position = [2000, 0, 1500];
    doc = addNodeToDoc(doc, sofa);
    const d = buildFloorSheet(doc, f.id);
    expect(d.title).toContain('GROUND FLOOR');
    expect(d.nodeCount).toBe(1);
    const layers = new Set(d.prims.map((p) => p.layer));
    for (const l of ['WALLS', 'DOORS', 'ROOMS', 'FURNITURE', 'DIMS', 'TEXT']) expect(layers.has(l)).toBe(true);
    // the door cuts the north wall: that wall is drawn as two separate solid pieces
    const wallPolys = d.prims.filter((p) => p.t === 'poly' && p.layer === 'WALLS');
    expect(wallPolys.length).toBe(5);
    expect(d.dimensions.map((x) => x.value)).toEqual([4200, 3200]); // outer size incl. wall thickness
    const svg = drawingToSVG(d);
    expect(svg).toContain('data-layer="WALLS"');
    expect(svg).toContain('m²');
    expect(drawingToDXF(d)).toContain('WALLS');
  });

  it('is included in the drawings PDF for floor-plan projects', () => {
    const doc: SceneDoc = { ...defaultDoc('CUSTOM'), plan: boxPlan() };
    const pdf = drawingsPdf(doc, { id: 'x', name: 'Plan', customer: '', category: 'CUSTOM', version: 1, updatedAt: new Date().toISOString() });
    expect(Buffer.from(pdf).subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.byteLength).toBeGreaterThan(2000);
  });
});
