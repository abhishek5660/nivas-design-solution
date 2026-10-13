import { describe, expect, it } from 'vitest';
import { computeRooms } from '@/lib/plan/rooms';
import { floorWalls, newId, normalizeWalls } from '@/lib/plan/walls';
import type { Floor, Pt, WallE } from '@/lib/plan/types';

export function mkFloor(): Floor {
  return { id: 'f1', name: 'Ground Floor', elevation: 0, height: 2800, entities: {}, order: [] };
}
export function addWall(f: Floor, a: Pt, b: Pt, thickness = 200): Floor {
  const w: WallE = { id: newId('wall'), kind: 'wall', a, b, thickness, height: 2800, wallType: 'interior' };
  return { ...f, entities: { ...f.entities, [w.id]: w }, order: [...f.order, w.id] };
}
export function box(f: Floor, x0: number, y0: number, x1: number, y1: number, t = 200): Floor {
  f = addWall(f, [x0, y0], [x1, y0], t);
  f = addWall(f, [x1, y0], [x1, y1], t);
  f = addWall(f, [x1, y1], [x0, y1], t);
  f = addWall(f, [x0, y1], [x0, y0], t);
  return f;
}

describe('room detection', () => {
  it('a closed rectangle of walls is one room with the clear interior dimensions', () => {
    const f = normalizeWalls(box(mkFloor(), 0, 0, 4000, 3000, 200));
    const rooms = computeRooms(f);
    expect(rooms).toHaveLength(1);
    // centre-line 4000 x 3000, walls 200 thick -> clear 3800 x 2800
    expect(rooms[0].area).toBeCloseTo(3800 * 2800, 0);
    expect(rooms[0].perimeter).toBeCloseTo(2 * (3800 + 2800), 0);
  });

  it('an open wall chain is not a room', () => {
    let f = mkFloor();
    f = addWall(f, [0, 0], [4000, 0]);
    f = addWall(f, [4000, 0], [4000, 3000]);
    f = addWall(f, [4000, 3000], [0, 3000]);
    expect(computeRooms(normalizeWalls(f))).toHaveLength(0);
  });

  it('a partition wall (T-junction) splits the walls and produces two rooms', () => {
    let f = box(mkFloor(), 0, 0, 6000, 3000, 200);
    f = addWall(f, [3000, 0], [3000, 3000], 100); // partition touching both long walls
    f = normalizeWalls(f);
    expect(floorWalls(f).length).toBe(7); // 4 outer + partition + the top and bottom walls each split in two
    const rooms = computeRooms(f);
    expect(rooms).toHaveLength(2);
    const areas = rooms.map((r) => r.area).sort((a, b) => a - b);
    // left room: x 100..2950 (2850) by y 100..2900 (2800)
    expect(areas[0]).toBeCloseTo(2850 * 2800, 0);
    expect(areas[1]).toBeCloseTo((6000 - 3050 - 100) * 2800, 0);
  });

  it('an L-shaped room has the right area', () => {
    let f = mkFloor();
    const pts: Pt[] = [[0, 0], [5000, 0], [5000, 2000], [2000, 2000], [2000, 4000], [0, 4000]];
    for (let i = 0; i < pts.length; i++) f = addWall(f, pts[i], pts[(i + 1) % pts.length], 200);
    const rooms = computeRooms(normalizeWalls(f));
    expect(rooms).toHaveLength(1);
    const centreArea = 5000 * 2000 + 2000 * 2000;
    // area shrinks by half-thickness along the perimeter (outer corner effects cancel for a simple orthogonal polygon)
    const perim = 5000 + 2000 + 3000 + 2000 + 2000 + 4000;
    expect(rooms[0].area).toBeCloseTo(centreArea - perim * 100 + 4 * 100 * 100 /* 6 convex - 2 reflex corners => +4 */, -2);
  });

  it('normalising is idempotent and splits crossing walls', () => {
    let f = mkFloor();
    f = addWall(f, [0, 0], [4000, 0]);
    f = addWall(f, [2000, -1000], [2000, 1000]);
    const once = normalizeWalls(f);
    expect(floorWalls(once).length).toBe(4);
    expect(normalizeWalls(once)).toBe(once);
  });
});
