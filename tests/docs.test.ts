import { describe, expect, it } from 'vitest';
import { addNodeToDoc, applyKitchen, defaultDoc, makeNode, resizeNode } from '@/lib/scene';
import { buildBoq } from '@/lib/docs/bom';
import { buildCutList, nestPieces, nestCutList } from '@/lib/docs/cutlist';
import { buildDrawing, drawingToDXF, drawingToSVG } from '@/lib/docs/drawing';
import { boqCsv, cutlistCsv, cutlistPdf, drawingsPdf, quotationPdf } from '@/lib/docs/export';
import { exportProjectJson, parseProjectImport, validateDoc } from '@/lib/schema';
import type { SceneDoc, WardrobeParams } from '@/lib/types';

function wardrobeDoc(w = 2400): SceneDoc {
  let doc = defaultDoc('WARDROBE');
  doc = addNodeToDoc(doc, makeNode('wardrobe', { size: { w, h: 2400, d: 600 }, position: [w / 2 + 100, 0, 300] }));
  return doc;
}

describe('cut list', () => {
  it('lists every sheet part with correct dimensions and unique labels', () => {
    const doc = wardrobeDoc();
    const cl = buildCutList(doc);
    expect(cl.pieces.length).toBeGreaterThan(20);
    expect(new Set(cl.pieces.map((p) => p.label)).size).toBe(cl.pieces.length);
    const side = cl.pieces.find((p) => /Left side/.test(p.name))!;
    expect(side.length).toBe(2400);
    expect(side.thickness).toBe(18);
    expect(side.width).toBeGreaterThan(500);
    for (const p of cl.pieces) {
      expect(p.length).toBeGreaterThanOrEqual(p.width);
      expect(p.width).toBeGreaterThanOrEqual(p.thickness);
    }
  });

  it('piece count tracks the model (more doors → more pieces)', () => {
    const a = wardrobeDoc(1800);
    const b = wardrobeDoc(3600);
    expect(buildCutList(b).pieces.length).toBeGreaterThan(buildCutList(a).pieces.length);
  });

  it('nesting never overlaps, stays inside the sheet and reports utilisation', () => {
    const doc = wardrobeDoc();
    const nests = nestCutList(doc, buildCutList(doc));
    expect(nests.length).toBeGreaterThan(0);
    for (const n of nests) {
      expect(n.oversized).toEqual([]);
      for (const s of n.sheets) {
        for (const p of s.placements) {
          expect(p.x).toBeGreaterThanOrEqual(10 - 1e-6);
          expect(p.x + p.w).toBeLessThanOrEqual(n.sheet.w - 10 + 1e-6);
          expect(p.y + p.h).toBeLessThanOrEqual(n.sheet.h - 10 + 1e-6);
        }
        for (let i = 0; i < s.placements.length; i++)
          for (let j = i + 1; j < s.placements.length; j++) {
            const a = s.placements[i];
            const b = s.placements[j];
            const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
            expect(overlap).toBe(false);
          }
      }
      expect(n.utilisation).toBeGreaterThan(0.05);
      expect(n.utilisation).toBeLessThanOrEqual(1);
    }
  });

  it('flags pieces larger than the sheet', () => {
    const r = nestPieces([{ label: 'X', length: 3000, width: 500, grain: 'length' }]);
    expect(r.oversized).toEqual(['X']);
  });
});

describe('BOQ', () => {
  it('derives quantities from the saved components (area equals cut-list area x wastage)', () => {
    const doc = wardrobeDoc();
    const boq = buildBoq(doc);
    const cl = buildCutList(doc);
    const totalNet = boq.items.filter((i) => i.unit === 'm²' && i.section !== 'Glass & mirror').reduce((a, i) => a + i.netQty, 0);
    const cutArea = cl.pieces.reduce((a, p) => a + (p.length * p.width) / 1e6, 0);
    expect(totalNet).toBeCloseTo(cutArea, 1);
    const panels = boq.items.find((i) => i.unit === 'm²')!;
    expect(panels.qty).toBeCloseTo(panels.netQty * 1.1, 2);
  });

  it('hardware counts follow the geometry (hinges per door height, runners per drawer)', () => {
    const doc = wardrobeDoc();
    const boq = buildBoq(doc);
    const hinges = boq.items.find((i) => i.key === 'hw:HG-SOFT-110')!;
    const doors = (Object.values(doc.nodes)[0].params as unknown as WardrobeParams).doorCount;
    expect(hinges.qty).toBe(doors * 5); // 2300 mm high doors → 5 hinges each
    const runners = boq.items.find((i) => i.key === 'hw:RN-SOFT-500');
    expect(runners).toBeTruthy();
  });

  it('totals follow the documented formula', () => {
    const doc = wardrobeDoc();
    doc.pricing = { ...doc.pricing, labourPct: 10, installationFlat: 1000, discountPct: 5, taxPct: 18, wastagePct: 0 };
    const b = buildBoq(doc);
    const t = b.totals;
    expect(t.labour).toBeCloseTo((t.materials + t.hardware) * 0.1, 1);
    expect(t.subtotal).toBeCloseTo(t.materials + t.hardware + t.appliances + t.labour + 1000, 1);
    expect(t.discount).toBeCloseTo(t.subtotal * 0.05, 1);
    expect(t.tax).toBeCloseTo((t.subtotal - t.discount) * 0.18, 1);
    expect(t.total).toBeCloseTo(t.subtotal - t.discount + t.tax, 1);
  });

  it('price overrides apply and missing prices raise warnings', () => {
    const doc = applyKitchen(defaultDoc('KITCHEN'), 'straight');
    const before = buildBoq(doc);
    expect(before.warnings.some((w) => /No price for/.test(w))).toBe(true); // appliances have no illustrative rate
    const fridge = before.items.find((i) => i.key === 'app:fridge')!;
    expect(fridge.unitPrice).toBeNull();
    doc.pricing.overrides['app:fridge'] = { unitPrice: 45000, estimate: false };
    const after = buildBoq(doc);
    const f2 = after.items.find((i) => i.key === 'app:fridge')!;
    expect(f2.amount).toBe(45000);
    expect(f2.estimate).toBe(false);
    expect(after.totals.appliances).toBe(45000);
  });

  it('an empty design yields a warning rather than a fake quote', () => {
    const b = buildBoq(defaultDoc('WARDROBE'));
    expect(b.items).toHaveLength(0);
    expect(b.warnings.join(' ')).toMatch(/no components/);
  });
});

describe('2D drawings', () => {
  it('front elevation reflects the current dimensions', () => {
    const doc = wardrobeDoc(2400);
    const d = buildDrawing(doc, 'front');
    expect(d.dimensions.find((x) => x.label === 'Overall width')!.value).toBeCloseTo(2400, 0);
    expect(d.dimensions.find((x) => x.label === 'Overall height')!.value).toBeCloseTo(2400, 0);
    // change the model → drawing follows
    const id = Object.keys(doc.nodes)[0];
    const doc2: SceneDoc = { ...doc, nodes: { [id]: resizeNode(doc.nodes[id], { w: 3000, h: 2200, d: 600 }) } };
    const d2 = buildDrawing(doc2, 'front');
    expect(d2.dimensions.find((x) => x.label === 'Overall width')!.value).toBeCloseTo(3000, 0);
    expect(d2.dimensions.find((x) => x.label === 'Overall height')!.value).toBeCloseTo(2200, 0);
  });

  it('side elevation shows the depth and plan shows the room walls', () => {
    const doc = wardrobeDoc();
    const side = buildDrawing(doc, 'left');
    const depth = side.dimensions.find((x) => x.label === 'Overall width')!.value;
    expect(depth).toBeGreaterThanOrEqual(600);
    expect(depth).toBeLessThan(640); // handles protrude slightly
    const plan = buildDrawing(doc, 'plan');
    expect(plan.prims.some((p) => p.t === 'line' && p.layer === 'ROOM')).toBe(true);
  });

  it('serialises to SVG and DXF with real content', () => {
    const doc = applyKitchen(defaultDoc('KITCHEN'), 'l_shape');
    const d = buildDrawing(doc, 'plan');
    const svg = drawingToSVG(d);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('<polygon');
    const dxf = drawingToDXF(d);
    expect(dxf).toContain('SECTION');
    expect(dxf).toContain('ENTITIES');
    expect((dxf.match(/\r\nLINE\r\n/g) ?? []).length).toBeGreaterThan(50);
    expect(dxf.trim().endsWith('EOF')).toBe(true);
  });
});

describe('exports contain real project data', () => {
  const doc = wardrobeDoc();
  const meta = { name: 'Sharma Residence – Master Wardrobe', customer: 'R. Sharma', version: 3 };

  it('CSV exports include project, parts and totals', () => {
    const boq = boqCsv(doc, meta);
    expect(boq).toContain('Sharma Residence');
    expect(boq).toContain('TOTAL (estimate)');
    expect(boq).toContain('Soft-close hinge');
    const cut = cutlistCsv(doc, meta);
    expect(cut.split('\r\n').length).toBeGreaterThan(25);
    expect(cut).toContain('Left side panel');
  });

  it('PDF exports are valid PDFs', () => {
    for (const buf of [quotationPdf(doc, meta), cutlistPdf(doc, meta), drawingsPdf(doc, meta)]) {
      const head = new TextDecoder().decode(new Uint8Array(buf).slice(0, 5));
      expect(head).toBe('%PDF-');
      expect(buf.byteLength).toBeGreaterThan(2500);
    }
  });
});

describe('project validation and import/export', () => {
  it('round-trips through JSON export/import unchanged', () => {
    const doc = applyKitchen(defaultDoc('KITCHEN'), 'u_shape');
    const text = exportProjectJson({ name: 'K', category: 'KITCHEN' }, doc);
    const r = parseProjectImport(text);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.data).toEqual(JSON.parse(JSON.stringify(doc)));
  });

  it('rejects malformed, tampered and negative-dimension files', () => {
    expect(parseProjectImport('not json').ok).toBe(false);
    const doc = wardrobeDoc();
    const bad = JSON.parse(exportProjectJson({ name: 'x', category: 'WARDROBE' }, doc));
    const id = Object.keys(bad.data.nodes)[0];
    bad.data.nodes[id].size.w = -5;
    expect(parseProjectImport(JSON.stringify(bad)).ok).toBe(false);
    const bad2 = JSON.parse(exportProjectJson({ name: 'x', category: 'WARDROBE' }, doc));
    bad2.data.nodes[id].materials.carcass = 'no-such-material';
    const r = parseProjectImport(JSON.stringify(bad2));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/missing asset/);
  });

  it('detects dangling order entries', () => {
    const doc = wardrobeDoc();
    doc.order.push('ghost');
    expect(validateDoc(doc).ok).toBe(false);
  });
});
