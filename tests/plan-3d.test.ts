import { describe, expect, it } from 'vitest';
import { Driver } from './plan-harness';
import { floor3D, wallSolids } from '@/lib/plan/model3d';
import { dist } from '@/lib/plan/geom';
import { floorWalls } from '@/lib/plan/walls';

function builtRoom() {
  const d = new Driver().use('wall');
  d.click([0, 0]).click([4000, 0]).click([4000, 3000]).click([0, 3000]).click([0, 0]);
  return d;
}

describe('2D -> 3D synchronisation', () => {
  it('a wall drawn in 2D becomes a 3D solid with the same length, height and thickness', () => {
    const d = new Driver().use('wall');
    d.host.setOption('wall', 'height', 3000);
    d.host.setOption('wall', 'thickness', 250);
    d.click([0, 0]).click([5000, 0]);
    const [w] = wallSolids(d.host.floor());
    expect(w.height).toBe(3000);
    expect(w.thickness).toBe(250);
    expect(w.end - w.start).toBe(5000);
    expect(dist(w.outline[0], w.outline[3])).toBe(250);
  });

  it('doors and windows cut real openings (size, sill) in the 3D wall', () => {
    const d = builtRoom();
    d.use('door').click([2000, 0]);
    d.use('window').click([4000, 1500]);
    const solids = wallSolids(d.host.floor());
    const holes = solids.flatMap((s) => s.holes);
    const door = holes.find((h) => h.kind === 'door')!;
    const win = holes.find((h) => h.kind === 'window')!;
    expect(door.x1 - door.x0).toBe(900);
    expect(door.y0).toBe(0);
    expect(door.y1).toBe(2100);
    expect(win.x1 - win.x0).toBe(1200);
    expect(win.y0).toBe(900);
    expect(win.y1).toBe(2100);
  });

  it('changing wall thickness updates the 3D outline; moving a wall end updates its length', () => {
    const d = builtRoom();
    const before = wallSolids(d.host.floor())[0];
    const f = d.host.floor();
    const w = floorWalls(f)[0];
    d.host.commit('t', { ...f, entities: { ...f.entities, [w.id]: { ...w, thickness: 400 } } });
    const after = wallSolids(d.host.floor()).find((s) => s.id === w.id)!;
    expect(after.thickness).toBe(400);
    expect(dist(after.outline[0], after.outline[3])).toBe(400);
    expect(dist(before.outline[0], before.outline[3])).toBe(200);
    d.use('select');
    d.host.setSelection([w.id]);
    d.drag([4000, 0], [4600, 0]);
    const moved = wallSolids(d.host.floor()).find((s) => s.id === w.id)!;
    expect(moved.end - moved.start).toBeGreaterThanOrEqual(4600);
  });

  it('floor, slab, ceiling, tiling, stairs, roof and lights all reach the 3D description', () => {
    const d = builtRoom();
    d.use('slab').click([2000, 1500]);
    d.use('ceiling').click([2000, 1500]);
    d.use('tiling').click([2000, 1500]);
    d.use('stairs').click([500, 500]).click([2500, 500]);
    d.use('roof').click([2000, 1500]);
    d.use('light').click([2000, 1500]);
    d.use('strip').click([500, 2500]).click([3000, 2500]);
    d.use('column').click([3500, 2500]);
    const p = floor3D(d.host.floor());
    expect(p.surfaces.map((s) => s.kind).sort()).toEqual(['ceiling', 'floor-finish', 'slab']);
    expect(p.surfaces.find((s) => s.kind === 'floor-finish')!.tile?.w).toBe(600);
    expect(p.surfaces.find((s) => s.kind === 'ceiling')!.y).toBe(2800);
    expect(p.stairs[0].steps).toHaveLength(14);
    expect(p.stairs[0].steps[13].top).toBe(14 * 180);
    expect(p.roofs[0].tris.length).toBeGreaterThanOrEqual(6);
    expect(p.lights[0].p[1]).toBe(2700);
    expect(p.strips).toHaveLength(1);
    expect(p.columns[0].height).toBe(2800);
  });

  it('furniture placed in the plan is a real scene node with plan footprint and 3D parts', async () => {
    const { makeNode, buildParts, footprint } = await import('@/lib/scene');
    const n = makeNode('furniture', { params: { kind: 'bed_double' }, position: [2000, 0, 1500] });
    expect(n.size).toEqual({ w: 1600, h: 1000, d: 2100 });
    expect(buildParts(n).length).toBeGreaterThan(3);
    const fp = footprint(n);
    expect(Math.max(...fp.map((p) => p[0])) - Math.min(...fp.map((p) => p[0]))).toBeCloseTo(1600, 3);
  });
});
