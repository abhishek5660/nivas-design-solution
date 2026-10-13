import { describe, expect, it } from 'vitest';
import { Driver } from './plan-harness';
import { defaultDoc, makeNode, addNodeToDoc } from '@/lib/scene';
import { planBoq, rawMaterials, runQc, workSchedule } from '@/lib/plan/outputs';
import { validateDoc } from '@/lib/schema';
import type { SceneDoc } from '@/lib/types';

const docOf = (d: Driver): SceneDoc => ({ ...defaultDoc('CUSTOM'), plan: d.host.plan_ });
function built() {
  const d = new Driver().use('wall');
  d.click([0, 0]).click([4000, 0]).click([4000, 3000]).click([0, 3000]).click([0, 0]);
  return d;
}

describe('BOQ from the plan', () => {
  it('quantities come from real geometry', () => {
    const d = built();
    d.use('door').click([2000, 0]);
    d.use('window').click([4000, 1500]);
    d.use('tiling').click([2000, 1500]);
    const boq = planBoq(docOf(d));
    const wall = boq.lines.filter((l) => l.description === 'Interior wall');
    const area = wall.reduce((a, l) => a + l.qty, 0);
    // perimeter 14 m x 2.8 m minus door 0.9x2.1 and window 1.2x1.2
    expect(area).toBeCloseTo(14 * 2.8 - 0.9 * 2.1 - 1.2 * 1.2, 2);
    expect(boq.lines.find((l) => l.description === 'Door')!.qty).toBe(1);
    expect(boq.lines.find((l) => l.description === 'Window')!.qty).toBe(1);
    const tileArea = boq.lines.find((l) => l.key === 'tile-area:floor')!;
    expect(tileArea.qty).toBeCloseTo(3.8 * 2.8, 2);
    const pcs = boq.lines.find((l) => l.key.startsWith('tile-pcs'))!;
    expect(pcs.qty).toBe(Math.ceil((3.8 * 2.8e6) / (603 * 603) * 1.1));
  });

  it('never invents prices: unpriced lines are flagged and excluded; entered prices are used', () => {
    const d = built();
    d.use('door').click([2000, 0]);
    const doc = docOf(d);
    let boq = planBoq(doc);
    expect(boq.unpriced).toBeGreaterThan(0);
    expect(boq.planTotal).toBe(0);
    expect(boq.warnings[0]).toMatch(/no unit price/);
    doc.plan!.prices['door:900x2100'] = { unitPrice: 12500, estimate: false };
    boq = planBoq(doc);
    expect(boq.lines.find((l) => l.description === 'Door')!.amount).toBe(12500);
    expect(boq.planTotal).toBe(12500);
  });

  it('includes furniture and updates when the design changes', () => {
    const d = built();
    let doc = docOf(d);
    expect(planBoq(doc).lines.some((l) => l.section === 'Furniture')).toBe(false);
    doc = addNodeToDoc(doc, makeNode('furniture', { params: { kind: 'sofa3' }, position: [2000, 0, 1500] }));
    expect(planBoq(doc).lines.find((l) => l.section === 'Furniture')!.description).toMatch(/Sofa/);
    d.use('wall').click([5000, 0]).click([8000, 0]);
    d.engine.finish();
    const more = planBoq({ ...doc, plan: d.host.plan_ }).lines.filter((l) => l.description === 'Interior wall').reduce((a, l) => a + l.qty, 0);
    expect(more).toBeGreaterThan(14 * 2.8);
  });
});

describe('QC', () => {
  it('reports real problems and points at the objects', () => {
    const d = built();
    d.use('window').click([4000, 1500]);
    d.use('stairs').click([500, 500]).click([2500, 500]);
    d.host.setOption('stairs', 'steps', 10);
    const doc = docOf(d);
    const v = runQc(doc);
    const rules = v.map((x) => x.rule);
    expect(rules).toContain('room-no-door');
    expect(rules).toContain('stairs-rise'); // 10 steps x 180 mm = 1800 mm but the storey is 2800 mm
    expect(rules).not.toContain('room-no-window'); // the room does have a window
    const noDoor = v.find((x) => x.rule === 'room-no-door')!;
    expect(noDoor.at).toBeTruthy();
    expect(v.every((x) => x.floorName === 'Ground Floor')).toBe(true);
  });

  it('flags stairs that do not match the storey height and impossible openings', () => {
    const d = built();
    d.use('stairs').click([500, 500]).click([2500, 500]);
    expect(runQc(docOf(d)).some((x) => x.rule === 'stairs-rise')).toBe(true); // 14 x 180 = 2520 mm vs 2800 mm storey
    const fixed = docOf(d);
    const st = Object.values(fixed.plan!.buildings[0].floors[0].entities).find((e) => e.kind === 'stairs')!;
    (st as { riser: number }).riser = 200; // 14 x 200 = 2800
    expect(runQc(fixed).some((x) => x.rule === 'stairs-rise')).toBe(false);
    // an opening taller than its wall is an error
    const doc = docOf(d);
    const door = d.host.floor();
    void door;
    d.use('door');
    d.host.setOption('door', 'height', 3400);
    d.click([2000, 0]);
    expect(runQc(docOf(d)).some((x) => x.rule === 'opening-tall' && x.severity === 'error')).toBe(true);
    void doc;
  });
});

describe('raw materials and schedule', () => {
  it('derives raw materials and a schedule only from what exists; durations are entered by the user', () => {
    const d = built();
    d.use('door').click([2000, 0]);
    d.use('tiling').click([2000, 1500]);
    const doc = docOf(d);
    const raw = rawMaterials(doc);
    expect(raw.some((r) => r.usedIn === 'Walls')).toBe(true);
    expect(raw.some((r) => r.usedIn === 'Tiling')).toBe(true);
    const s = workSchedule(doc);
    expect(s.phases.map((p) => p.id)).toEqual(['structure', 'openings', 'finishes']);
    expect(s.totalDays).toBe(0);
    expect(s.unestimated).toBe(3);
    doc.plan!.schedule.structure = { days: 12 };
    expect(workSchedule(doc).totalDays).toBe(12);
  });
});

describe('persistence of the plan inside the project document', () => {
  it('the plan validates, survives a JSON round trip with ids/dimensions intact, and bad plans are rejected', () => {
    const d = built();
    d.use('door').click([2000, 0]);
    const doc = docOf(d);
    const rep = validateDoc(doc);
    expect(rep.errors).toEqual([]);
    expect(rep.ok).toBe(true);
    const back = JSON.parse(JSON.stringify(doc)) as SceneDoc;
    const again = validateDoc(back);
    expect(again.ok).toBe(true);
    expect(again.doc!.plan).toEqual(doc.plan);
    // corrupt: negative wall thickness, door pointing at a missing wall
    const bad = structuredClone(back);
    const f = bad.plan!.buildings[0].floors[0];
    const wall = Object.values(f.entities).find((e) => e.kind === 'wall')!;
    (wall as { thickness: number }).thickness = -5;
    const door = Object.values(f.entities).find((e) => e.kind === 'door')!;
    (door as { wall: string }).wall = 'missing';
    const r = validateDoc(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/thickness/);
    expect(r.errors.join(' ')).toMatch(/not attached to a wall/);
  });
});
