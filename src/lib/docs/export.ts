import { jsPDF } from 'jspdf';
import { SAMPLE_HARDWARE } from '../catalog';
import type { SceneDoc } from '../types';
import { buildBoq, type Boq } from './bom';
import { buildCutList, nestCutList, type CutListResult } from './cutlist';
import { buildFloorSheet } from '../plan/sheet';
import { buildDrawing, type Drawing, type DrawingView } from './drawing';
import { allNodeParts, nodeCodes } from './resolve';

export interface ProjectMeta {
  id?: string;
  name: string;
  customer?: string;
  category?: string;
  version?: number;
  updatedAt?: string;
  author?: string;
}

const csvCell = (v: unknown): string => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (rows: unknown[][]): string => '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

export function boqCsv(doc: SceneDoc, meta: ProjectMeta, boq: Boq = buildBoq(doc)): string {
  const rows: unknown[][] = [
    ['NIVAS DESIGN SOLUTION - Bill of Quantities (ESTIMATE - not a verified market quotation)'],
    ['Project', meta.name, 'Customer', meta.customer ?? '', 'Currency', boq.currency],
    [],
    ['Section', 'Item', 'Specification', 'Unit', 'Net qty', 'Qty incl. wastage', 'Unit price', 'Price source', 'Estimate', 'Amount'],
  ];
  for (const i of boq.items) {
    rows.push([i.section, i.description, i.spec, i.unit, i.netQty, i.qty, i.unitPrice ?? 'MISSING', i.priceSource, i.estimate ? 'yes' : 'no', i.amount]);
  }
  const t = boq.totals;
  rows.push([], ['', 'Materials', '', '', '', '', '', '', '', t.materials], ['', 'Hardware & lighting', '', '', '', '', '', '', '', t.hardware], ['', 'Appliances', '', '', '', '', '', '', '', t.appliances]);
  rows.push(['', `Labour (${doc.pricing.labourPct}% of materials + hardware)`, '', '', '', '', '', '', '', t.labour], ['', 'Installation', '', '', '', '', '', '', '', t.installation], ['', 'Subtotal', '', '', '', '', '', '', '', t.subtotal]);
  rows.push(['', `Discount (${doc.pricing.discountPct}%)`, '', '', '', '', '', '', '', -t.discount], ['', `Tax (${doc.pricing.taxPct}%)`, '', '', '', '', '', '', '', t.tax], ['', 'TOTAL (estimate)', '', '', '', '', '', '', '', t.total]);
  if (boq.warnings.length) {
    rows.push([], ['Warnings']);
    boq.warnings.forEach((w) => rows.push([w]));
  }
  return toCsv(rows);
}

export function cutlistCsv(doc: SceneDoc, meta: ProjectMeta, cl: CutListResult = buildCutList(doc)): string {
  const rows: unknown[][] = [
    ['NIVAS DESIGN SOLUTION - Panel cut list'],
    ['Project', meta.name, 'Revision', meta.version ?? ''],
    [],
    ['Piece label', 'Cabinet', 'Part', 'Length (mm)', 'Width (mm)', 'Thickness (mm)', 'Material', 'Grain', 'Edge banding (L1/L2/W1/W2)', 'Edge band length (mm)', 'Operations'],
  ];
  for (const p of cl.pieces) {
    rows.push([p.label, `${p.cabinet} ${p.cabinetName}`, p.name, p.length, p.width, p.thickness, p.materialName, p.grain, p.edge.map((b) => (b ? 'Y' : '-')).join(''), p.edgeLengthMm, p.ops.join('; ')]);
  }
  return toCsv(rows);
}

export function hardwareCsv(doc: SceneDoc, meta: ProjectMeta): string {
  const boq = buildBoq(doc);
  const rows: unknown[][] = [['NIVAS DESIGN SOLUTION - Hardware list'], ['Project', meta.name], [], ['Code', 'Description', 'Specification', 'Unit', 'Quantity', 'Used in']];
  const codes = nodeCodes(doc);
  for (const i of boq.items.filter((x) => x.section === 'Hardware' || x.section === 'Lighting')) {
    rows.push([i.key.replace(/^hw:/, ''), i.description, i.spec, i.unit, i.qty, i.nodes.map((n) => codes[n]).join(' ')]);
  }
  return toCsv(rows);
}

// ---------- PDF helpers ----------

const GOLD: [number, number, number] = [160, 120, 40];
const INK: [number, number, number] = [30, 30, 33];

function header(pdf: jsPDF, title: string, meta: ProjectMeta, subtitle?: string) {
  const w = pdf.internal.pageSize.getWidth();
  pdf.setFillColor(...INK);
  pdf.rect(0, 0, w, 56, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(15);
  pdf.text('NIVAS DESIGN SOLUTION', 36, 30);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(214, 186, 120);
  pdf.text('3D interior & modular furniture design', 36, 44);
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(12);
  pdf.text(title, w - 36, 28, { align: 'right' });
  if (subtitle) {
    pdf.setFontSize(8);
    pdf.text(subtitle, w - 36, 44, { align: 'right' });
  }
  pdf.setTextColor(...INK);
  pdf.setFontSize(9);
  const line = `Project: ${meta.name}${meta.customer ? `   Customer: ${meta.customer}` : ''}${meta.version ? `   Revision: v${meta.version}` : ''}   Date: ${(meta.updatedAt ? new Date(meta.updatedAt) : new Date()).toISOString().slice(0, 10)}`;
  pdf.text(line, 36, 78);
}

function footer(pdf: jsPDF, note: string) {
  const n = pdf.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    pdf.setPage(i);
    const w = pdf.internal.pageSize.getWidth();
    const h = pdf.internal.pageSize.getHeight();
    pdf.setFontSize(7.5);
    pdf.setTextColor(120, 120, 120);
    pdf.text(note, 36, h - 20);
    pdf.text(`Page ${i} / ${n}`, w - 36, h - 20, { align: 'right' });
  }
}

type Col = { title: string; width: number; align?: 'left' | 'right' };
function table(pdf: jsPDF, startY: number, cols: Col[], rows: (string | number)[][], opts: { fontSize?: number; bold?: (r: number) => boolean } = {}): number {
  const fs = opts.fontSize ?? 8;
  const pageH = pdf.internal.pageSize.getHeight();
  const left = 36;
  let y = startY;
  const drawHead = () => {
    pdf.setFillColor(238, 232, 220);
    pdf.rect(left, y - 10, cols.reduce((a, c) => a + c.width, 0), 16, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(fs);
    pdf.setTextColor(...INK);
    let x = left;
    for (const c of cols) {
      pdf.text(c.title, c.align === 'right' ? x + c.width - 4 : x + 4, y + 1, { align: c.align === 'right' ? 'right' : 'left' });
      x += c.width;
    }
    y += 16;
  };
  drawHead();
  rows.forEach((r, ri) => {
    if (y > pageH - 50) {
      pdf.addPage();
      y = 50;
      drawHead();
    }
    pdf.setFont('helvetica', opts.bold?.(ri) ? 'bold' : 'normal');
    pdf.setFontSize(fs);
    let x = left;
    cols.forEach((c, ci) => {
      let txt = String(r[ci] ?? '');
      const maxChars = Math.floor((c.width - 8) / (fs * 0.5));
      if (txt.length > maxChars) txt = txt.slice(0, Math.max(1, maxChars - 1)) + '…';
      pdf.text(txt, c.align === 'right' ? x + c.width - 4 : x + 4, y, { align: c.align === 'right' ? 'right' : 'left' });
      x += c.width;
    });
    pdf.setDrawColor(225, 220, 210);
    pdf.line(left, y + 4, left + cols.reduce((a, c) => a + c.width, 0), y + 4);
    y += 14;
  });
  return y;
}

export const money = (n: number, cur: string) => `${cur} ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function quotationPdf(doc: SceneDoc, meta: ProjectMeta, boq: Boq = buildBoq(doc)): ArrayBuffer {
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  header(pdf, 'ESTIMATE / QUOTATION', meta, 'Indicative estimate - not a verified market quotation');
  const cur = boq.currency;
  const rows = boq.items.map((i) => [i.section, i.description + (i.spec ? ` (${i.spec})` : ''), i.unit, i.qty, i.unitPrice == null ? 'MISSING' : i.unitPrice.toFixed(2), i.estimate ? 'EST' : 'FIRM', i.amount.toFixed(2)]);
  let y = table(
    pdf,
    104,
    [
      { title: 'Section', width: 92 },
      { title: 'Item', width: 190 },
      { title: 'Unit', width: 34 },
      { title: 'Qty', width: 46, align: 'right' },
      { title: 'Rate', width: 54, align: 'right' },
      { title: 'Type', width: 34 },
      { title: `Amount (${cur})`, width: 70, align: 'right' },
    ],
    rows,
    { fontSize: 7.5 },
  );
  const t = boq.totals;
  if (y > pdf.internal.pageSize.getHeight() - 190) {
    pdf.addPage();
    y = 60;
  }
  y += 14;
  const kv: [string, string, boolean?][] = [
    ['Materials', money(t.materials, cur)],
    ['Hardware & lighting', money(t.hardware, cur)],
    ['Appliances', money(t.appliances, cur)],
    [`Labour (${doc.pricing.labourPct}% of materials + hardware)`, money(t.labour, cur)],
    ['Installation', money(t.installation, cur)],
    ['Subtotal', money(t.subtotal, cur), true],
    [`Discount (${doc.pricing.discountPct}%)`, `- ${money(t.discount, cur)}`],
    [`Tax (${doc.pricing.taxPct}%)`, money(t.tax, cur)],
    ['TOTAL (estimate)', money(t.total, cur), true],
  ];
  const left = pdf.internal.pageSize.getWidth() - 36 - 260;
  for (const [k, v, bold] of kv) {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.setFontSize(bold ? 10 : 9);
    pdf.text(k, left, y);
    pdf.text(v, left + 260, y, { align: 'right' });
    y += bold ? 16 : 13;
  }
  y += 8;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.5);
  pdf.setTextColor(120, 40, 40);
  const notes = [
    'Formulae: materials = sheet area x (1 + wastage %) x rate; labour = labour % x (materials + hardware); tax applies after discount.',
    'Rates marked ILLUSTRATIVE are placeholder starter values, not supplier prices. Replace with your supplier rates before issuing to a client.',
    ...(boq.warnings.length ? ['Warnings:', ...boq.warnings.slice(0, 12).map((w) => ` - ${w}`)] : []),
  ];
  for (const n of notes) {
    if (y > pdf.internal.pageSize.getHeight() - 40) {
      pdf.addPage();
      y = 60;
    }
    pdf.text(pdf.splitTextToSize(n, 520), 36, y);
    y += 11 * (pdf.splitTextToSize(n, 520).length || 1);
  }
  footer(pdf, 'NIVAS DESIGN SOLUTION - estimate generated from the saved model. Not a verified quotation.');
  return pdf.output('arraybuffer');
}

export function cutlistPdf(doc: SceneDoc, meta: ProjectMeta): ArrayBuffer {
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
  const cl = buildCutList(doc);
  header(pdf, 'PANEL CUT LIST', meta, 'Production document');
  let y = table(
    pdf,
    104,
    [
      { title: 'Label', width: 62 },
      { title: 'Part', width: 160 },
      { title: 'L', width: 44, align: 'right' },
      { title: 'W', width: 44, align: 'right' },
      { title: 'T', width: 30, align: 'right' },
      { title: 'Material', width: 150 },
      { title: 'Grain', width: 44 },
      { title: 'Edge', width: 56 },
      { title: 'Operations', width: 200 },
    ],
    cl.pieces.map((p) => [p.label, `${p.cabinet} ${p.name}`, p.length, p.width, p.thickness, p.materialName, p.grain, p.edge.map((b) => (b ? 'Y' : '-')).join(''), p.ops[0] ?? '']),
    { fontSize: 7 },
  );
  y += 18;
  if (y > pdf.internal.pageSize.getHeight() - 120) {
    pdf.addPage();
    y = 60;
  }
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.text('Material summary', 36, y);
  y += 14;
  table(
    pdf,
    y,
    [
      { title: 'Material', width: 230 },
      { title: 'Thickness', width: 60, align: 'right' },
      { title: 'Pieces', width: 50, align: 'right' },
      { title: 'Area m²', width: 70, align: 'right' },
      { title: 'Edge band m', width: 80, align: 'right' },
    ],
    cl.materials.map((m) => [m.name, m.thickness, m.pieces, m.areaM2.toFixed(3), m.edgeBandM.toFixed(2)]),
    { fontSize: 8 },
  );
  // nesting pages
  const nests = nestCutList(doc, cl);
  for (const nr of nests) {
    nr.sheets.forEach((s) => {
      pdf.addPage();
      header(pdf, 'BOARD LAYOUT', meta, `${nr.materialName} ${nr.thickness} mm - sheet ${s.index}/${nr.sheets.length}`);
      const maxW = pdf.internal.pageSize.getWidth() - 72;
      const scale = Math.min(maxW / nr.sheet.w, (pdf.internal.pageSize.getHeight() - 160) / nr.sheet.h);
      const ox = 36;
      const oy = 100;
      pdf.setDrawColor(...INK);
      pdf.setFillColor(250, 248, 242);
      pdf.rect(ox, oy, nr.sheet.w * scale, nr.sheet.h * scale, 'FD');
      pdf.setFontSize(6.5);
      for (const p of s.placements) {
        pdf.setFillColor(232, 214, 176);
        pdf.setDrawColor(120, 90, 40);
        pdf.rect(ox + p.x * scale, oy + p.y * scale, p.w * scale, p.h * scale, 'FD');
        if (p.w * scale > 28 && p.h * scale > 9) {
          pdf.setTextColor(...INK);
          pdf.text(p.label, ox + p.x * scale + 2, oy + p.y * scale + 7);
        }
      }
      pdf.setTextColor(...INK);
      pdf.setFontSize(8);
      pdf.text(`Sheet ${nr.sheet.w} x ${nr.sheet.h} mm   Utilisation (all ${nr.materialName} sheets): ${(nr.utilisation * 100).toFixed(1)}%   Kerf 4 mm, trim 10 mm`, ox, oy + nr.sheet.h * scale + 16);
    });
  }
  footer(pdf, 'Cut list generated from the saved design. Verify against shop-floor stock before cutting. Not machine (CNC) output.');
  return pdf.output('arraybuffer');
}

export function drawingsPdf(doc: SceneDoc, meta: ProjectMeta, views: DrawingView[] = ['plan', 'front', 'left'], showInterior = false): ArrayBuffer {
  const pdf = new jsPDF({ unit: 'pt', format: 'a3', orientation: 'landscape' });
  // floor-plan projects: one sheet per floor that has content, then the elevations of the placed furniture / cabinets
  const sheets: Drawing[] = [];
  if (doc.plan?.enabled) {
    for (const f of doc.plan.buildings.flatMap((b) => b.floors)) {
      const d = buildFloorSheet(doc, f.id);
      if (d.prims.length) sheets.push(d);
    }
  }
  const classic = doc.plan?.enabled ? (doc.order.length ? views.filter((v) => v !== 'plan') : []) : views;
  const all: Drawing[] = [...sheets, ...classic.map((v) => buildDrawing(doc, v, { showInterior }))];
  if (!all.length) all.push(buildDrawing(doc, 'plan', { showInterior }));
  all.forEach((d, idx) => {
    if (idx > 0) pdf.addPage();
    header(pdf, d.title, meta, d.scaleNote);
    drawOnPdf(pdf, d, 36, 100, pdf.internal.pageSize.getWidth() - 72, pdf.internal.pageSize.getHeight() - 150);
  });
  footer(pdf, 'Drawings are generated from the saved model. Dimensions in millimetres.');
  return pdf.output('arraybuffer');
}

export function drawOnPdf(pdf: jsPDF, d: Drawing, x0: number, y0: number, w: number, h: number) {
  const { minX, minY, maxX, maxY } = d.bounds;
  const scale = Math.min(w / (maxX - minX), h / (maxY - minY));
  const tx = (x: number) => x0 + (x - minX) * scale + (w - (maxX - minX) * scale) / 2;
  const ty = (y: number) => y0 + (maxY - y) * scale;
  for (const p of d.prims) {
    if (p.t === 'poly') {
      pdf.setDrawColor(27, 27, 27);
      pdf.setLineWidth(Math.max(0.2, p.sw * scale * 0.6));
      if (p.fill) {
        const c = hexToRgb(p.fill);
        pdf.setFillColor(c[0], c[1], c[2]);
      }
      const pts = p.pts.map(([x, y]) => [tx(x), ty(y)]);
      const lines: [number, number][] = pts.slice(1).map((pt, i) => [pt[0] - pts[i][0], pt[1] - pts[i][1]]);
      lines.push([pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]]);
      pdf.lines(lines, pts[0][0], pts[0][1], [1, 1], p.fill ? 'FD' : 'S', true);
    } else if (p.t === 'line') {
      if (p.layer === 'DIMS') pdf.setDrawColor(...GOLD);
      else pdf.setDrawColor(27, 27, 27);
      pdf.setLineWidth(Math.max(0.15, p.sw * scale * 0.6));
      pdf.line(tx(p.x1), ty(p.y1), tx(p.x2), ty(p.y2));
    } else {
      if (p.layer === 'DIMS') pdf.setTextColor(...GOLD);
      else pdf.setTextColor(27, 27, 27);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(Math.max(5, p.size * scale * 0.95));
      pdf.text(p.text, tx(p.x), ty(p.y), { align: p.anchor === 'middle' ? 'center' : p.anchor === 'end' ? 'right' : 'left', angle: p.rot ?? 0 });
    }
  }
  pdf.setTextColor(...INK);
}

function hexToRgb(h: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 255, 255];
}

/** Production summary: material summary, hardware list, assembly info per cabinet. */
export function assemblyInfo(doc: SceneDoc) {
  const codes = nodeCodes(doc);
  return allNodeParts(doc).map(({ node, parts }) => {
    const sheetParts = parts.filter((p) => p.sheet);
    const hw: Record<string, number> = {};
    parts.forEach((p) => p.hardware?.forEach((h) => (hw[h.code] = (hw[h.code] ?? 0) + h.qty)));
    return {
      code: codes[node.id],
      name: node.name,
      type: node.type,
      size: `${Math.round(node.size.w)} x ${Math.round(node.size.h)} x ${Math.round(node.size.d)} mm`,
      panels: sheetParts.length,
      hardware: Object.entries(hw).map(([code, qty]) => ({ code, qty: Math.round(qty * 1000) / 1000, name: SAMPLE_HARDWARE.find((x) => x.code === code)?.name ?? code })),
      ops: Array.from(new Set(parts.flatMap((p) => p.ops ?? []))),
    };
  });
}
