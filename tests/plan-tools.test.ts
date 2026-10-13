import { describe, expect, it } from 'vitest';
import { Driver } from './plan-harness';
import { TOOLS } from '@/lib/plan/tools';
import type { DoorE, WallE } from '@/lib/plan/types';
import { floorWalls } from '@/lib/plan/walls';
import { dist } from '@/lib/plan/geom';

function room(d: Driver, x0 = 0, y0 = 0, x1 = 4000, y1 = 3000) {
  d.use('wall');
  d.click([x0, y0]).click([x1, y0]).click([x1, y1]).click([x0, y1]).click([x0, y0]);
  return d;
}

describe('draw tools', () => {
  it('rectangle: two clicks give exact millimetre dimensions', () => {
    const d = new Driver().use('rect');
    d.click([1000, 1000]).click([5000, 4000]);
    const [r] = d.host.ofKind('rect');
    expect(Math.abs(r.p2[0] - r.p1[0])).toBe(4000);
    expect(Math.abs(r.p2[1] - r.p1[1])).toBe(3000);
    expect(d.host.history.length).toBe(1);
  });

  it('rectangle: typed width,height', async () => {
    const d = new Driver().use('rect');
    d.click([0, 0]);
    d.engine.pointerMove(d.ev([500, 400]));
    expect(await d.type('2500,1200')).toBe(true);
    const [r] = d.host.ofKind('rect');
    expect([Math.abs(r.p2[0] - r.p1[0]), Math.abs(r.p2[1] - r.p1[1])]).toEqual([2500, 1200]);
  });

  it('line: click-click, typed length along the cursor direction, and polar entry', async () => {
    const d = new Driver().use('line');
    d.click([0, 0]).click([3000, 0]);
    expect(d.host.ofKind('line')[0].b).toEqual([3000, 0]);
    d.click([0, 1000]);
    d.engine.pointerMove(d.ev([200, 1000]));
    await d.type('1500');
    expect(d.host.ofKind('line')[1].b).toEqual([1500, 1000]);
    d.click([0, 2000]);
    await d.type('1000<90');
    const l = d.host.ofKind('line')[2];
    expect(l.b[0]).toBeCloseTo(0, 6);
    expect(l.b[1]).toBeCloseTo(3000, 6);
  });

  it('polyline: vertices accumulate, Enter finishes, C closes', () => {
    const d = new Driver().use('polyline');
    d.click([0, 0]).click([2000, 0]).click([2000, 1000]);
    d.engine.finish();
    expect(d.host.ofKind('polyline')[0]).toMatchObject({ closed: false });
    expect(d.host.ofKind('polyline')[0].pts).toHaveLength(3);
    d.click([5000, 0]).click([7000, 0]).click([7000, 1000]);
    d.engine.key('c');
    expect(d.host.ofKind('polyline')[1].closed).toBe(true);
  });

  it('circle: centre + typed radius; polygon; arc requires a bend', async () => {
    const d = new Driver().use('circle');
    d.click([1000, 1000]);
    await d.type('450');
    expect(d.host.ofKind('circle')[0]).toMatchObject({ r: 450, c: [1000, 1000] });
    d.use('polygon');
    d.click([0, 0]).click([1000, 0]).click([500, 800]);
    d.engine.finish();
    expect(d.host.ofKind('polygon')[0].pts).toHaveLength(3);
    d.use('arc');
    d.click([0, 0]).click([1000, 0]).click([2000, 0]);
    expect(d.host.last().level).toBe('error'); // collinear
    d.click([2000, 0], {}, false);
    expect(d.host.ofKind('arc')).toHaveLength(0);
  });

  it('arc: three points make an arc', () => {
    const d = new Driver().use('arc');
    d.click([0, 0]).click([1000, 1000]).click([2000, 0]);
    expect(d.host.ofKind('arc')).toHaveLength(1);
  });

  it('construction line is created infinite and used for snapping', () => {
    const d = new Driver().use('guide');
    d.click([0, 1234], {}, false).click([100, 1234], {}, false);
    expect(d.host.ofKind('guide')[0].infinite).toBe(true);
    d.use('line');
    const e = d.ev([77000, 1240]); // far away along the guide, within snap distance of it
    expect(e.snap.kind).toBe('guide');
    expect(e.pt[1]).toBeCloseTo(1234, 3);
  });

  it('hatch needs a closed shape; room hatches follow the room', () => {
    const d = new Driver().use('hatch');
    d.click([100, 100]);
    expect(d.host.last().level).toBe('error');
    d.use('rect').click([0, 0]).click([2000, 2000]);
    d.use('hatch').click([1000, 1000]);
    expect(d.host.ofKind('hatch')[0].boundary).toMatchObject({ kind: 'ref' });
  });
});

describe('walls and rooms', () => {
  it('connected walls close into one room with correct clear dimensions', () => {
    const d = room(new Driver());
    expect(floorWalls(d.host.floor())).toHaveLength(4);
    const rooms = d.host.rooms();
    expect(rooms).toHaveLength(1);
    expect(rooms[0].area).toBeCloseTo((4000 - 200) * (3000 - 200), 0); // 200 mm walls
    expect(d.host.messages.some((m) => /Room closed/.test(m.text))).toBe(true);
  });

  it('typed wall lengths build a room', async () => {
    const d = new Driver().use('wall');
    d.click([0, 0]);
    d.engine.pointerMove(d.ev([200, 0]));
    await d.type('5000');
    d.engine.pointerMove(d.ev([5000, 200]));
    await d.type('4000');
    d.engine.pointerMove(d.ev([4800, 4000]));
    await d.type('5000');
    d.engine.pointerMove(d.ev([0, 3800]));
    await d.type('4000');
    expect(floorWalls(d.host.floor())).toHaveLength(4);
    expect(d.host.rooms()).toHaveLength(1);
  });

  it('a wall shorter than 10 mm is refused', () => {
    const d = new Driver().use('wall');
    d.host.plan_.settings.snap.grid = false;
    d.click([0, 0], {}, false).click([4, 0], {}, false);
    expect(floorWalls(d.host.floor())).toHaveLength(0);
    expect(d.host.last().level).toBe('warn');
  });

  it('a partition drawn into a room splits it into two rooms', () => {
    const d = room(new Driver(), 0, 0, 6000, 3000);
    d.use('wall').click([3000, 0]).click([3000, 3000]);
    d.engine.finish();
    expect(d.host.rooms()).toHaveLength(2);
  });

  it('wall thickness can be changed and the clear area follows', () => {
    const d = room(new Driver());
    const f = d.host.floor();
    for (const w of floorWalls(f)) d.host.commit('Edit', { ...d.host.floor(), entities: { ...d.host.floor().entities, [w.id]: { ...w, thickness: 300 } } });
    expect(d.host.rooms()[0].area).toBeCloseTo((4000 - 300) * (3000 - 300), 0);
  });
});

describe('doors and windows', () => {
  it('inserts a door and a window into a wall and stores real dimensions', () => {
    const d = room(new Driver());
    d.use('door').click([2000, 0]);
    d.use('window').click([4000, 1500]);
    const [door] = d.host.ofKind('door');
    const [win] = d.host.ofKind('window');
    expect(door.width).toBe(900);
    expect(door.height).toBe(2100);
    expect(win.sill).toBe(900);
    const wall = d.host.floor().entities[door.wall] as WallE;
    expect(door.offset).toBeGreaterThanOrEqual(50);
    expect(door.offset + door.width).toBeLessThanOrEqual(dist(wall.a, wall.b));
  });

  it('refuses an opening that does not fit or overlaps another', () => {
    const d = new Driver().use('wall');
    d.click([0, 0]).click([800, 0]);
    d.engine.finish();
    d.use('door').click([400, 0]);
    expect(d.host.ofKind('door')).toHaveLength(0);
    expect(d.host.last().level).toBe('error');
    const e = room(new Driver());
    e.use('window').click([2000, 0]);
    e.host.setOption('window', 'width', 1200);
    e.use('window').click([2100, 0]); // overlapping -> nudged to a free spot or refused
    const wins = e.host.ofKind('window');
    for (let i = 0; i < wins.length; i++) for (let j = i + 1; j < wins.length; j++) if (wins[i].wall === wins[j].wall) expect(wins[i].offset + wins[i].width <= wins[j].offset || wins[j].offset + wins[j].width <= wins[i].offset).toBe(true);
  });

  it('deleting a wall removes its doors and windows', () => {
    const d = room(new Driver());
    d.use('door').click([2000, 0]);
    const door = d.host.ofKind('door')[0] as DoorE;
    d.use('select').click([door.offset + 100, 0]);
    d.host.setSelection([door.wall]);
    d.engine.deleteSelection();
    expect(d.host.ofKind('door')).toHaveLength(0);
    expect(floorWalls(d.host.floor())).toHaveLength(3);
  });
});

describe('selection', () => {
  it('click, shift-click and window / crossing box selection', () => {
    const d = new Driver().use('line');
    d.click([0, 0]).click([1000, 0]);
    d.click([0, 1000]).click([1000, 1000]);
    d.click([3000, 0]).click([4000, 0]);
    d.use('select');
    d.click([500, 0]);
    expect(d.host.selection()).toHaveLength(1);
    d.click([500, 1000], { shift: true });
    expect(d.host.selection()).toHaveLength(2);
    d.host.setSelection([]);
    d.drag([-100, -100], [1100, 1100]); // left -> right: window
    expect(d.host.selection()).toHaveLength(2);
    d.host.setSelection([]);
    d.drag([3500, 500], [3500 - 200, -500]); // right -> left crossing: touches only the third line
    expect(d.host.selection()).toHaveLength(1);
  });

  it('Escape cancels, then deselects, then does nothing; tools return to Select', () => {
    const d = new Driver().use('line');
    d.click([0, 0]);
    expect(d.engine.escape()).toBe('cancelled');
    expect(d.host.ofKind('line')).toHaveLength(0);
    expect(d.engine.escape()).toBe('selecting');
    expect(d.engine.tool).toBe('select');
  });
});

describe('editing', () => {
  it('nudges the selection by exactly 1 mm and 10 mm', () => {
    const d = new Driver().use('rect');
    d.click([0, 0]).click([1000, 1000]);
    const id = d.host.ofKind('rect')[0].id;
    d.host.setSelection([id]);
    d.use('select');
    d.engine.nudge(1, 0);
    expect(d.host.ofKind('rect')[0].p1).toEqual([1, 0]);
    d.engine.nudge(0, 10);
    expect(d.host.ofKind('rect')[0].p1).toEqual([1, 10]);
    d.engine.nudge(-10, 0);
    d.engine.nudge(0, -10);
    d.engine.nudge(-1, 0);
    expect(d.host.ofKind('rect')[0].p1).toEqual([-10, 0]);
  });

  it('move tool: base + destination and undo restores', () => {
    const d = new Driver().use('rect');
    d.click([0, 0]).click([1000, 1000]);
    d.host.setSelection([d.host.ofKind('rect')[0].id]);
    d.use('move').click([0, 0]).click([500, 300]);
    expect(d.host.ofKind('rect')[0].p1).toEqual([500, 300]);
    d.host.undo();
    expect(d.host.ofKind('rect')[0].p1).toEqual([0, 0]);
  });

  it('rotate tool: typed angle turns walls with their doors about the base point, undo restores', async () => {
    const d = room(new Driver());
    d.use('door').click([2000, 0]);
    d.engine.selectAll();
    d.use('rotate').click([0, 0]);
    expect(await d.type('90')).toBe(true);
    const walls = floorWalls(d.host.floor());
    expect(walls).toHaveLength(4);
    // the 4000 x 3000 room turned 90° about the origin now spans x -3000..0, y 0..4000
    const xs = walls.flatMap((w) => [w.a[0], w.b[0]]);
    const ys = walls.flatMap((w) => [w.a[1], w.b[1]]);
    expect([Math.min(...xs), Math.max(...xs)].map(Math.round)).toEqual([-3000, 0]);
    expect([Math.min(...ys), Math.max(...ys)].map(Math.round)).toEqual([0, 4000]);
    expect(d.host.ofKind('door')).toHaveLength(1);
    d.host.undo();
    expect(Math.max(...floorWalls(d.host.floor()).flatMap((w) => [w.a[0], w.b[0]]))).toBe(4000);
  });

  it('rotate tool: reference direction then new direction (3 clicks) turns by the difference', () => {
    const d = new Driver().use('rect');
    d.click([0, 0]).click([1000, 500]);
    d.host.setSelection([d.host.ofKind('rect')[0].id]);
    d.use('rotate').click([0, 0]).click([1000, 0]).click([0, 1000]); // 0° -> 90° clockwise on screen
    const r = d.host.ofKind('rect')[0];
    expect(r.p1.map(Math.round)).toEqual([0, 0]);
    expect(r.p2.map(Math.round)).toEqual([-500, 1000]);
    // 45° makes it a tilted shape that is no longer an axis-aligned rectangle
    d.host.setSelection(d.host.all().map((e) => e.id));
    d.use('rotate').click([0, 0]);
    d.engine.pointerMove(d.ev([800, 800]));
    d.click([1000, 0]).click([1000, 1000]);
    expect(d.host.all().length).toBe(1);
    expect(d.host.ofKind('rect')).toHaveLength(0);
  });

  it('drag with the select tool moves the object', () => {
    const d = new Driver().use('rect');
    d.click([0, 0]).click([1000, 1000]);
    d.use('select').drag([0, 500], [800, 500]);
    expect(d.host.ofKind('rect')[0].p1).toEqual([800, 0]);
  });

  it('copy leaves the original and creates new ids; walls bring their doors', () => {
    const d = room(new Driver());
    d.use('door').click([2000, 0]);
    d.engine.selectAll();
    d.use('copy').click([0, 0]).click([6000, 0]);
    expect(floorWalls(d.host.floor())).toHaveLength(8);
    expect(d.host.ofKind('door')).toHaveLength(2);
    expect(new Set(d.host.all().map((e) => e.id)).size).toBe(d.host.all().length);
    const ids = d.host.ofKind('door').map((x) => x.wall);
    expect(new Set(ids).size).toBe(2);
  });

  it('mirror with and without keeping the original', () => {
    const d = new Driver().use('line');
    d.click([1000, 0]).click([2000, 500]);
    d.host.setSelection([d.host.ofKind('line')[0].id]);
    d.use('mirror').click([0, -1000]).click([0, 1000]); // mirror across x = 0
    const lines = d.host.ofKind('line');
    expect(lines).toHaveLength(2);
    expect(lines.some((l) => l.a[0] === -1000 && l.b[0] === -2000)).toBe(true);
    const e = new Driver().use('line');
    e.click([1000, 0]).click([2000, 500]);
    e.host.setSelection([e.host.ofKind('line')[0].id]);
    e.host.setOption('mirror', 'keep', false);
    e.use('mirror').click([0, -1000]).click([0, 1000]);
    expect(e.host.ofKind('line')).toHaveLength(1);
    expect(e.host.ofKind('line')[0].a[0]).toBe(-1000);
  });

  it('offset creates a parallel line at the exact distance on the chosen side', () => {
    const d = new Driver().use('line');
    d.click([0, 0]).click([4000, 0]);
    d.host.setOption('offset', 'distance', 350);
    d.use('offset').click([2000, 0]).click([2000, 1000]);
    const lines = d.host.ofKind('line');
    expect(lines).toHaveLength(2);
    expect(lines[1].a).toEqual([0, 350]);
    expect(lines[1].b).toEqual([4000, 350]);
  });

  it('trim removes the part between boundaries; extend reaches the next boundary', () => {
    const d = new Driver().use('line');
    d.click([0, 0]).click([6000, 0]); // horizontal target
    d.click([2000, -1000]).click([2000, 1000]); // boundary 1
    d.click([4000, -1000]).click([4000, 1000]); // boundary 2
    d.use('trim').click([3000, 0]);
    const horizontals = d.host.ofKind('line').filter((l) => l.a[1] === 0 && l.b[1] === 0);
    expect(horizontals).toHaveLength(2);
    expect(horizontals.some((l) => l.a[0] === 0 && l.b[0] === 2000)).toBe(true);
    expect(horizontals.some((l) => l.a[0] === 4000 && l.b[0] === 6000)).toBe(true);

    const e = new Driver().use('line');
    e.click([0, 0]).click([1000, 0]);
    e.click([3000, -1000]).click([3000, 1000]);
    e.use('extend').click([900, 0]);
    expect(e.host.ofKind('line')[0].b).toEqual([3000, 0]);
    e.use('extend').click([0, 0]);
    expect(e.host.last().level).toBe('error'); // nothing to the left
  });

  it('scale by factor about a base point', async () => {
    const d = new Driver().use('rect');
    d.click([1000, 1000]).click([2000, 2000]);
    d.host.setSelection([d.host.ofKind('rect')[0].id]);
    d.use('scale').click([1000, 1000]);
    await d.type('2');
    const r = d.host.ofKind('rect')[0];
    expect(r.p2).toEqual([3000, 3000]);
  });

  it('fillet joins two walls into a corner', () => {
    const d = new Driver().use('wall');
    d.click([0, 0]).click([3000, 0]);
    d.engine.finish();
    d.click([200, 1000]).click([200, 4000]);
    d.engine.finish();
    d.use('fillet').click([1000, 0]).click([200, 3000]);
    const w = floorWalls(d.host.floor());
    expect(w.some((x) => x.a[0] === 200 && x.a[1] === 0) || w.some((x) => x.b[0] === 200 && x.b[1] === 0)).toBe(true);
  });

  it('component: create from the selection, insert a copy', async () => {
    const d = new Driver().use('rect');
    d.click([0, 0]).click([600, 400]);
    d.host.setSelection([d.host.ofKind('rect')[0].id]);
    d.use('component').click([0, 0]);
    await new Promise((r) => setTimeout(r, 0));
    expect(d.host.plan().components).toHaveLength(1);
    d.host.setOption('component', 'componentId', d.host.plan().components[0].id);
    d.click([3000, 3000]);
    expect(d.host.ofKind('rect')).toHaveLength(2);
    const [a, b] = d.host.ofKind('rect');
    expect(b.group).toBeTruthy();
    expect(b.group).not.toBe(a.group);
  });
});

describe('annotation, dimensions and measuring', () => {
  it('dimension links to geometry and follows it when the geometry changes', async () => {
    const d = room(new Driver());
    const w0 = d.host.ofKind('wall')[0];
    d.use('dimension').click([w0.a[0], w0.a[1]]).click([w0.b[0], w0.b[1]]).click([2000, -600]);
    const [dim] = d.host.ofKind('dimension');
    expect(dim.refA && dim.refB).toBeTruthy();
    const { resolveRef } = await import('@/lib/plan/entities');
    const f1 = d.host.floor();
    expect(resolveRef(f1, dim.refB)).toEqual(w0.b);
    // move the wall end by editing the wall through the grip tool
    d.use('select');
    d.host.setSelection([w0.id]);
    d.drag([w0.b[0], w0.b[1]], [4600, 0]);
    const f2 = d.host.floor();
    const dimNow = f2.entities[dim.id] as typeof dim;
    expect(resolveRef(f2, dimNow.refB)).toEqual([4600, 0]);
  });

  it('measure reports distance, dx, dy and room area', () => {
    const d = new Driver().use('measure');
    d.click([0, 0]).click([3000, 4000]);
    expect(d.host.last().text).toMatch(/Distance 5000 mm/);
    const r = room(new Driver());
    r.use('measure').click([2000, 1500]);
    expect(r.host.last().text).toMatch(/area 10\.640 m²/);
  });

  it('text, compass, angle, xy, radial and multileader are stored in the model', async () => {
    const d = new Driver();
    d.use('text').click([100, 100]);
    await new Promise((r) => setTimeout(r, 0));
    expect(d.host.ofKind('text')[0].text).toBe('Answer');
    d.use('compass').click([5000, 0]);
    expect(d.host.ofKind('compass')).toHaveLength(1);
    d.use('angle').click([0, 0]).click([1000, 0]).click([0, 1000]);
    expect(d.host.ofKind('angle')).toHaveLength(1);
    d.use('xy').click([700, 700], {}, false);
    expect(d.host.ofKind('xy')[0].pos).toEqual([700, 700]);
    d.use('circle').click([8000, 8000]);
    await d.type('500');
    d.use('radial').click([8500, 8000], {}, false);
    expect(d.host.ofKind('radial')[0].mode).toBe('radius');
    d.use('leader').click([0, 0]).click([500, 500]);
    d.engine.finish();
    await new Promise((r) => setTimeout(r, 0));
    expect(d.host.ofKind('leader')[0].text).toBe('Answer');
  });
});

describe('architecture objects', () => {
  it('creates ceiling, slab, tiling, column, stairs, beam, railing and roof from real geometry', () => {
    const d = room(new Driver());
    d.use('ceiling').click([2000, 1500]);
    d.use('slab').click([2000, 1500]);
    d.use('tiling').click([2000, 1500]);
    d.use('column').click([1000, 1000]);
    d.use('stairs').click([500, 500]).click([2500, 500]);
    d.use('beam').click([0, 1500]).click([4000, 1500]);
    d.use('railing').click([0, 2900]).click([2000, 2900]);
    d.engine.finish();
    d.use('roof').click([2000, 1500]);
    for (const k of ['ceiling', 'slab', 'tiling', 'column', 'stairs', 'beam', 'railing', 'roof'] as const) expect(d.host.all().some((e) => e.kind === k), k).toBe(true);
    const st = d.host.ofKind('stairs')[0];
    expect(st.steps).toBe(14);
    expect(st.riser * st.steps).toBe(2520);
  });

  it('floor-level objects refuse to be created outside a closed room', () => {
    const d = new Driver().use('ceiling');
    d.click([500, 500]);
    expect(d.host.ofKind('ceiling')).toHaveLength(0);
    expect(d.host.last().level).toBe('error');
  });

  it('locked design blocks edits with a clear message', () => {
    const d = new Driver().use('line');
    d.host.isLocked = true;
    d.click([0, 0]).click([1000, 0]);
    expect(d.host.ofKind('line')).toHaveLength(0);
    expect(d.host.last().text).toMatch(/locked/);
  });
});

describe('tool lifecycle', () => {
  it('every tool can be activated, previewed and cancelled without changing the design', () => {
    const d = new Driver();
    d.host.setSelection([]);
    for (const id of Object.keys(TOOLS) as (keyof typeof TOOLS)[]) {
      const before = d.host.commits;
      d.engine.setTool(id);
      expect(typeof d.engine.hint()).toBe('string');
      d.engine.pointerMove(d.ev([1000, 1000]));
      d.engine.preview(d.ev([1000, 1000]));
      d.engine.escape();
      d.engine.escape();
      expect(d.host.commits, `${id} changed the design while only being activated`).toBe(before);
    }
  });
});
