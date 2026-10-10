import { describe, expect, it } from 'vitest';
import { buildParts, defaultDoc, findCollisions, generateKitchen, makeNode, resizeNode, validateNode, applyKitchen, autoCountertops, footprint, snapNode, wallEdges } from '@/lib/scene';
import type { SceneNode, WardrobeParams } from '@/lib/types';
import { adaptWardrobe, resolveSectionWidths, sectionHeight } from '@/lib/build/wardrobe';

const finite = (n: number[]) => n.every(Number.isFinite);

function checkParts(node: SceneNode) {
  const parts = buildParts(node);
  expect(parts.length).toBeGreaterThan(0);
  const ids = new Set<string>();
  for (const p of parts) {
    expect(finite(p.size) && finite(p.center)).toBe(true);
    expect(p.size.every((s) => s > 0)).toBe(true);
    expect(ids.has(p.id)).toBe(false);
    ids.add(p.id);
  }
  return parts;
}

describe('wardrobe generator', () => {
  it('generates parts from custom dimensions and keeps panels inside the envelope', () => {
    const n = makeNode('wardrobe', { size: { w: 2400, h: 2300, d: 620 } });
    expect(validateNode(n).filter((i) => i.level === 'error')).toEqual([]);
    const parts = checkParts(n);
    for (const p of parts) {
      if (p.anim || p.shape === 'cylinder') continue;
      expect(Math.abs(p.center[0]) + p.size[0] / 2).toBeLessThanOrEqual(2400 / 2 + 0.5);
      expect(p.center[1] - p.size[1] / 2).toBeGreaterThanOrEqual(-0.5);
      expect(p.center[1] + p.size[1] / 2).toBeLessThanOrEqual(2300 + 0.5);
    }
  });

  it('changing width changes the actual geometry', () => {
    const n = makeNode('wardrobe', { size: { w: 1800 } });
    const w1 = buildParts(n).find((p) => p.id.endsWith(':top'))!.size[0];
    const n2 = resizeNode(n, { ...n.size, w: 2400 });
    const w2 = buildParts(n2).find((p) => p.id.endsWith(':top'))!.size[0];
    expect(w2 - w1).toBeCloseTo(600, 3);
  });

  it('section widths + partitions fill the interior exactly', () => {
    const n = makeNode('wardrobe', { size: { w: 2000 } });
    const p = n.params as unknown as WardrobeParams;
    const inner = 2000 - 2 * p.thickness;
    const { widths, error } = resolveSectionWidths(p.sections, inner, p.thickness);
    expect(error).toBeUndefined();
    const total = widths.reduce((a, b) => a + b, 0) + (widths.length - 1) * p.thickness;
    expect(total).toBeCloseTo(inner, 6);
  });

  it('rejects impossible fixed section widths with a clear message', () => {
    const n = makeNode('wardrobe', { size: { w: 1200 } });
    const p = n.params as unknown as WardrobeParams;
    p.sections.forEach((s) => (s.width = 900));
    const issues = validateNode(n);
    expect(issues.some((i) => i.level === 'error' && /exceed/.test(i.message))).toBe(true);
  });

  it('rejects negative or zero sizes', () => {
    const n = makeNode('wardrobe');
    n.size.w = -10;
    expect(validateNode(n)[0].message).toMatch(/positive/);
  });

  it('drawers and doors animate: every door part has an animation group', () => {
    const n = makeNode('wardrobe', { size: { w: 2400 } });
    const parts = buildParts(n);
    const doors = parts.filter((p) => p.role === 'door');
    expect(doors.length).toBeGreaterThanOrEqual(2);
    expect(doors.every((d) => d.anim?.kind === 'hinge')).toBe(true);
    expect(parts.some((p) => p.role === 'drawer_front' && p.anim?.kind === 'slide')).toBe(true);
  });

  it('sliding style produces slide-animated panels and track hardware', () => {
    const n = makeNode('wardrobe', { size: { w: 2400 }, params: { style: 'sliding', doorCount: 3 } });
    const parts = checkParts(n);
    expect(parts.filter((p) => p.role === 'door').every((p) => p.anim?.kind === 'slide')).toBe(true);
    expect(parts.some((p) => p.hardware?.some((h) => h.code.startsWith('SL-TRACK')))).toBe(true);
  });

  it('loft adds loft shutters and keeps interior height positive', () => {
    const n = makeNode('wardrobe', { params: { loftHeight: 450 } });
    const p = n.params as unknown as WardrobeParams;
    expect(sectionHeight(n.size.h, p)).toBeGreaterThan(1000);
    expect(buildParts(n).filter((x) => /:loft\d+$/.test(x.id)).length).toBe(p.doorCount);
  });
});

describe('parametric adaptation', () => {
  it('adding a loft rescales shelves instead of invalidating the design', () => {
    const n = makeNode('wardrobe', { size: { w: 2400, h: 2400, d: 600 } });
    const p = n.params as unknown as WardrobeParams;
    const next = adaptWardrobe(n, { ...n, params: { ...n.params, loftHeight: 450 } });
    expect(validateNode(next).filter((i) => i.level === 'error')).toEqual([]);
    const before = Math.max(...p.sections.flatMap((s) => s.shelves));
    const after = Math.max(...(next.params as unknown as WardrobeParams).sections.flatMap((s) => s.shelves));
    expect(after).toBeLessThan(before);
  });
});

describe('cabinets, appliances, countertops, tv', () => {
  it.each(['base', 'wall', 'tall', 'corner', 'drawer', 'sink', 'open_shelf', 'island', 'bookcase'] as const)('cabinet %s builds valid parts', (variant) => {
    const n = makeNode('cabinet', { variant });
    expect(validateNode(n).filter((i) => i.level === 'error')).toEqual([]);
    checkParts(n);
  });

  it.each(['fridge', 'oven', 'microwave', 'hob', 'chimney', 'dishwasher', 'sink', 'light_strip'] as const)('appliance %s builds', (kind) => {
    checkParts(makeNode('appliance', { kind }));
  });

  it('drawer cabinet fronts fill the cabinet height', () => {
    const n = makeNode('cabinet', { variant: 'drawer' });
    const fronts = buildParts(n).filter((p) => p.role === 'drawer_front');
    const sum = fronts.reduce((a, b) => a + b.size[1] + 3, 0);
    expect(sum).toBeCloseTo(n.size.h - 100 - 2 * 2 + 0, 0);
  });

  it('cabinet validation errors are explicit', () => {
    const n = makeNode('cabinet', { variant: 'base', size: { w: 20 } });
    const [issue] = validateNode(n);
    expect(issue.level).toBe('error');
    expect(issue.message).toMatch(/Width must be between/);
  });

  it('tv panel builds with default config and validates TV fit', () => {
    const n = makeNode('tv_panel');
    expect(validateNode(n).filter((i) => i.level === 'error')).toEqual([]);
    checkParts(n);
    (n.params as { tv: { size: number } }).tv.size = 120;
    expect(validateNode(n).some((i) => i.level === 'error' && /does not fit/.test(i.message))).toBe(true);
  });

  it('tv slat style generates real battens', () => {
    const n = makeNode('tv_panel', { params: { style: 'slat', patternSpacing: 100 } });
    expect(buildParts(n).filter((p) => p.id.includes(':batten')).length).toBeGreaterThan(10);
  });
});

describe('kitchen layout generation', () => {
  it.each(['straight', 'l_shape', 'u_shape', 'parallel', 'island'] as const)('%s layout creates cabinets inside the room without overlaps', (layout) => {
    let doc = defaultDoc('KITCHEN');
    doc = applyKitchen(doc, layout);
    const cabs = Object.values(doc.nodes).filter((n) => n.type === 'cabinet');
    expect(cabs.length).toBeGreaterThan(3);
    const cols = findCollisions(doc);
    expect(cols).toEqual([]);
    for (const n of Object.values(doc.nodes)) {
      for (const [x, z] of footprint(n)) {
        expect(x).toBeGreaterThanOrEqual(-2);
        expect(z).toBeGreaterThanOrEqual(-2);
        expect(x).toBeLessThanOrEqual(3602);
        expect(z).toBeLessThanOrEqual(3002);
      }
    }
  });

  it('straight layout contains base, wall cabinets, hob, sink and a countertop', () => {
    const { nodes } = generateKitchen('straight', 4200, 3000);
    const kinds = nodes.map((n) => (n.type === 'cabinet' ? (n.params as { variant: string }).variant : n.type === 'appliance' ? (n.params as { kind: string }).kind : n.type));
    for (const k of ['base', 'wall', 'sink', 'hob', 'countertop', 'fridge']) expect(kinds).toContain(k);
  });

  it('auto countertops rebuilds slabs over base runs', () => {
    let doc = applyKitchen(defaultDoc('KITCHEN'), 'straight');
    const before = Object.values(doc.nodes).filter((n) => n.type === 'countertop').length;
    doc = autoCountertops(doc);
    const after = Object.values(doc.nodes).filter((n) => n.type === 'countertop');
    expect(after.length).toBeGreaterThanOrEqual(1);
    expect(before).toBeGreaterThanOrEqual(1);
    expect(findCollisions(doc)).toEqual([]);
  });

  it('detects overlapping cabinets', () => {
    let doc = defaultDoc('KITCHEN');
    const a = makeNode('cabinet', { variant: 'base', position: [1000, 0, 300] });
    const b = makeNode('cabinet', { variant: 'base', position: [1200, 0, 300] });
    doc = { ...doc, nodes: { [a.id]: a, [b.id]: b }, order: [a.id, b.id] };
    expect(findCollisions(doc).length).toBe(1);
  });
});

describe('snapping', () => {
  it('snaps a cabinet to the back wall and faces the room', () => {
    const doc = defaultDoc('KITCHEN');
    const n = makeNode('cabinet', { variant: 'base' });
    const r = snapNode(doc, n, [1500, 0, 380], 33, null);
    expect(r.snappedWall).toBe(0);
    expect(r.rotationY).toBeCloseTo(0, 3);
    expect(r.position[2]).toBeCloseTo(n.size.d / 2, 1);
    expect(wallEdges(doc.room)[0].normal[1]).toBeCloseTo(1, 6);
  });
  it('snaps to the left wall with 90° rotation', () => {
    const doc = defaultDoc('KITCHEN');
    const n = makeNode('cabinet', { variant: 'base' });
    const r = snapNode(doc, n, [350, 0, 1500], 0, null);
    expect(r.snappedWall).toBe(3);
    expect(r.rotationY).toBeCloseTo(90, 3);
  });
});
