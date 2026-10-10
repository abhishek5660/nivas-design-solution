import { describe, expect, it } from 'vitest';
import { addNodeToDoc, buildParts, defaultDoc, makeNode, applyKitchen } from '@/lib/scene';
import { buildBoq } from '@/lib/docs/bom';
import { buildCutList, nestCutList } from '@/lib/docs/cutlist';
import { buildDrawing } from '@/lib/docs/drawing';

describe('performance budgets (large scenes)', () => {
  it('generates, prices, nests and draws a 120-cabinet scene within budget', () => {
    let doc = defaultDoc('KITCHEN');
    for (let i = 0; i < 100; i++) doc = addNodeToDoc(doc, makeNode('cabinet', { variant: i % 3 === 0 ? 'drawer' : i % 3 === 1 ? 'base' : 'wall', position: [300 + (i % 10) * 620, i % 3 === 2 ? 1400 : 0, 300 + Math.floor(i / 10) * 700] }));
    for (let i = 0; i < 20; i++) doc = addNodeToDoc(doc, makeNode('wardrobe', { size: { w: 2400 }, position: [1200, 0, 300 + i * 650] }));
    const t0 = performance.now();
    const parts = Object.values(doc.nodes).flatMap((n) => buildParts(n));
    const t1 = performance.now();
    const boq = buildBoq(doc);
    const t2 = performance.now();
    const cl = buildCutList(doc);
    const nests = nestCutList(doc, cl);
    const t3 = performance.now();
    const d = buildDrawing(doc, 'plan');
    const t4 = performance.now();
    console.log(`parts=${parts.length} geometry=${(t1 - t0).toFixed(0)}ms boq=${(t2 - t1).toFixed(0)}ms cut+nest=${(t3 - t2).toFixed(0)}ms plan=${(t4 - t3).toFixed(0)}ms pieces=${cl.pieces.length} boards=${nests.reduce((a, n) => a + n.sheets.length, 0)}`);
    expect(parts.length).toBeGreaterThan(2000);
    expect(t1 - t0).toBeLessThan(3000);
    expect(t2 - t1).toBeLessThan(1500);
    expect(t3 - t2).toBeLessThan(3000);
    expect(t4 - t3).toBeLessThan(2000);
    expect(boq.items.length).toBeGreaterThan(5);
    expect(d.prims.length).toBeGreaterThan(100);
  });

  it('starter scenes stay small enough for smooth 3D (part counts)', () => {
    const counts = (['straight', 'l_shape', 'u_shape', 'parallel', 'island'] as const).map((l) => Object.values(applyKitchen(defaultDoc('KITCHEN'), l).nodes).reduce((a, n) => a + buildParts(n).length, 0));
    console.log('kitchen part counts', counts.join(', '));
    for (const c of counts) expect(c).toBeLessThan(2500);
  });
});
