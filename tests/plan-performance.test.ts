import { describe, expect, it } from 'vitest';
import { floor3D } from '@/lib/plan/model3d';
import { addEntities, activeFloor, makePlan, updateFloor } from '@/lib/plan/model';
import { planBoq, runQc } from '@/lib/plan/outputs';
import { computeRooms } from '@/lib/plan/rooms';
import { buildFloorSheet } from '@/lib/plan/sheet';
import { newId, normalizeWalls } from '@/lib/plan/walls';
import type { Entity, WallE } from '@/lib/plan/types';
import { defaultDoc } from '@/lib/scene';
import { validateDoc } from '@/lib/schema';

/** an N x N grid of rooms: 2(N+1) long walls that cross each other (split into 2N(N+1) pieces) */
function grid(n: number, cell = 3000): Entity[] {
  const ents: Entity[] = [];
  const L = n * cell;
  const wall = (a: [number, number], b: [number, number]): WallE => ({ id: newId('wall'), kind: 'wall', a, b, thickness: 150, height: 2800, wallType: 'interior' });
  for (let i = 0; i <= n; i++) {
    ents.push(wall([0, i * cell], [L, i * cell]));
    ents.push(wall([i * cell, 0], [i * cell, L]));
  }
  return ents;
}

describe('floor-plan performance budgets', () => {
  it('a 12 x 12 room grid (26 long walls cut into 312 wall pieces, 144 rooms) normalises, finds rooms, builds 3D, BOQ, QC and a sheet quickly', () => {
    const plan = makePlan(true);
    const t0 = performance.now();
    const f = normalizeWalls(addEntities(activeFloor(plan), grid(12)));
    const t1 = performance.now();
    const rooms = computeRooms(f);
    const t2 = performance.now();
    const doc = { ...defaultDoc('CUSTOM'), plan: updateFloor(plan, plan.activeFloorId, () => f) };
    const d3 = floor3D(f);
    const t3 = performance.now();
    const boq = planBoq(doc);
    const qc = runQc(doc);
    const t4 = performance.now();
    const sheet = buildFloorSheet(doc, f.id);
    const t5 = performance.now();
    console.log(`walls=${f.order.length} rooms=${rooms.length} normalise=${(t1 - t0).toFixed(0)}ms rooms=${(t2 - t1).toFixed(0)}ms 3D=${(t3 - t2).toFixed(0)}ms boq+qc=${(t4 - t3).toFixed(0)}ms sheet=${(t5 - t4).toFixed(0)}ms`);
    expect(rooms).toHaveLength(144);
    expect(f.order.length).toBe(312);
    expect(d3.walls.length).toBe(f.order.length);
    expect(boq.lines.length).toBeGreaterThan(0);
    expect(qc).toBeDefined();
    expect(sheet.prims.length).toBeGreaterThan(600);
    expect(t1 - t0).toBeLessThan(4000);
    expect(t2 - t1).toBeLessThan(2000);
    expect(t3 - t2).toBeLessThan(2000);
    expect(t4 - t3).toBeLessThan(3000);
    expect(t5 - t4).toBeLessThan(2000);
    expect(validateDoc(doc).ok).toBe(true);
  });
});
