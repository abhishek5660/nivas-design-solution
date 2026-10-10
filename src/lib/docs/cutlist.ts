import type { SceneDoc } from '../types';
import { allNodeParts, docMaterial, nodeCodes, resolveMaterialId } from './resolve';

export interface CutPiece {
  label: string; // unique piece id e.g. BC3-007
  nodeId: string;
  cabinet: string; // node code
  cabinetName: string;
  name: string; // part name
  role: string;
  length: number;
  width: number;
  thickness: number;
  materialId: string;
  materialName: string;
  grain: 'length' | 'width' | 'none';
  /** edge banding flags on L1, L2, W1, W2 */
  edge: [boolean, boolean, boolean, boolean];
  edgeLengthMm: number;
  ops: string[];
}

export interface CutGroup {
  key: string;
  name: string;
  length: number;
  width: number;
  thickness: number;
  materialId: string;
  materialName: string;
  qty: number;
  grain: string;
  edge: string;
  labels: string[];
}

export interface CutListResult {
  pieces: CutPiece[];
  groups: CutGroup[];
  materials: { materialId: string; name: string; thickness: number; pieces: number; areaM2: number; edgeBandM: number }[];
  warnings: string[];
}

/** Standard thicknesses we expect; others are flagged so the shop can confirm availability. */
const KNOWN_THICKNESS = [3, 4, 6, 8, 9, 12, 15, 16, 18, 19, 20, 22, 25, 30, 38, 40, 50];

export function buildCutList(doc: SceneDoc): CutListResult {
  const codes = nodeCodes(doc);
  const pieces: CutPiece[] = [];
  const warnings: string[] = [];
  for (const { node, parts } of allNodeParts(doc)) {
    let seq = 0;
    const code = codes[node.id];
    for (const p of parts) {
      if (!p.sheet || p.shape !== 'box') continue;
      const dims = [...p.size].sort((a, b) => a - b);
      const [t, w, l] = dims;
      seq += 1;
      const matId = resolveMaterialId(doc, node, p);
      const mat = docMaterial(doc, matId);
      const edge = p.edge ?? [false, false, false, false];
      const edgeLen = (edge[0] ? l : 0) + (edge[1] ? l : 0) + (edge[2] ? w : 0) + (edge[3] ? w : 0);
      if (!KNOWN_THICKNESS.includes(Math.round(t))) warnings.push(`${code} ${p.label}: ${Math.round(t * 10) / 10} mm is not a standard board thickness.`);
      pieces.push({
        label: `${code}-${String(seq).padStart(3, '0')}`,
        nodeId: node.id,
        cabinet: code,
        cabinetName: node.name,
        name: p.label,
        role: p.role,
        length: Math.round(l * 10) / 10,
        width: Math.round(w * 10) / 10,
        thickness: Math.round(t * 10) / 10,
        materialId: matId,
        materialName: mat.name,
        grain: p.grain ?? 'length',
        edge: edge as [boolean, boolean, boolean, boolean],
        edgeLengthMm: edgeLen,
        ops: p.ops ?? [],
      });
    }
  }
  const map = new Map<string, CutGroup>();
  for (const pc of pieces) {
    const e = pc.edge.map((b) => (b ? '1' : '0')).join('');
    const key = [pc.name.replace(/\s*\d+(-\d+)?$/, ''), pc.length, pc.width, pc.thickness, pc.materialId, pc.grain, e].join('|');
    const g = map.get(key);
    if (g) {
      g.qty += 1;
      g.labels.push(pc.label);
    } else {
      map.set(key, {
        key,
        name: pc.name.replace(/\s*\d+(-\d+)?$/, ''),
        length: pc.length,
        width: pc.width,
        thickness: pc.thickness,
        materialId: pc.materialId,
        materialName: pc.materialName,
        qty: 1,
        grain: pc.grain,
        edge: edgeText(pc.edge),
        labels: [pc.label],
      });
    }
  }
  const mm = new Map<string, CutListResult['materials'][number]>();
  for (const pc of pieces) {
    const k = `${pc.materialId}@${pc.thickness}`;
    const m = mm.get(k) ?? { materialId: pc.materialId, name: pc.materialName, thickness: pc.thickness, pieces: 0, areaM2: 0, edgeBandM: 0 };
    m.pieces += 1;
    m.areaM2 += (pc.length * pc.width) / 1e6;
    m.edgeBandM += pc.edgeLengthMm / 1000;
    mm.set(k, m);
  }
  return {
    pieces,
    groups: [...map.values()].sort((a, b) => a.materialName.localeCompare(b.materialName) || b.length - a.length),
    materials: [...mm.values()].map((m) => ({ ...m, areaM2: Math.round(m.areaM2 * 1000) / 1000, edgeBandM: Math.round(m.edgeBandM * 100) / 100 })),
    warnings: [...new Set(warnings)],
  };
}

export function edgeText(e: [boolean, boolean, boolean, boolean]): string {
  const names = ['L1', 'L2', 'W1', 'W2'];
  const on = names.filter((_, i) => e[i]);
  return on.length ? on.join('+') : '-';
}

// ---------- Board nesting (shelf / guillotine heuristic) ----------

export interface Sheet {
  w: number;
  h: number;
}

export interface Placement {
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotated: boolean;
}

export interface NestedSheet {
  index: number;
  placements: Placement[];
  usedArea: number;
}

export interface NestResult {
  materialId: string;
  materialName: string;
  thickness: number;
  sheet: Sheet;
  sheets: NestedSheet[];
  utilisation: number; // 0..1 over used sheets
  oversized: string[];
}

/**
 * Packs pieces onto sheets with a shelf-based first-fit-decreasing heuristic.
 * kerf = saw blade width between pieces, trim = border trimmed from every sheet edge.
 * Pieces with a grain direction are never rotated (sheet grain runs along its long side).
 */
export function nestPieces(
  pieces: Pick<CutPiece, 'label' | 'length' | 'width' | 'grain'>[],
  sheet: Sheet = { w: 2440, h: 1220 },
  kerf = 4,
  trim = 10,
  canRotateGrained = false,
): { sheets: NestedSheet[]; oversized: string[] } {
  const usableW = sheet.w - 2 * trim;
  const usableH = sheet.h - 2 * trim;
  const sorted = [...pieces].sort((a, b) => b.length * b.width - a.length * a.width || b.length - a.length);
  interface Shelf {
    y: number;
    h: number;
    x: number;
  }
  const sheets: { placements: Placement[]; shelves: Shelf[]; usedY: number; used: number }[] = [];
  const oversized: string[] = [];
  const tryPlace = (s: (typeof sheets)[number], pw: number, ph: number, label: string, rotated: boolean): boolean => {
    for (const sh of s.shelves) {
      if (ph <= sh.h && sh.x + pw <= usableW) {
        s.placements.push({ label, x: trim + sh.x, y: trim + sh.y, w: pw, h: ph, rotated });
        sh.x += pw + kerf;
        s.used += pw * ph;
        return true;
      }
    }
    if (s.usedY + ph <= usableH && pw <= usableW) {
      const sh = { y: s.usedY, h: ph, x: 0 };
      s.shelves.push(sh);
      s.usedY += ph + kerf;
      s.placements.push({ label, x: trim + sh.x, y: trim + sh.y, w: pw, h: ph, rotated });
      sh.x += pw + kerf;
      s.used += pw * ph;
      return true;
    }
    return false;
  };
  for (const pc of sorted) {
    const grained = pc.grain !== 'none';
    const options: [number, number, boolean][] = [[pc.length, pc.width, false]];
    if (!grained || canRotateGrained) options.push([pc.width, pc.length, true]);
    const fits = options.filter(([w, h]) => w <= usableW && h <= usableH);
    if (!fits.length) {
      oversized.push(pc.label);
      continue;
    }
    let placed = false;
    for (const s of sheets) {
      for (const [w, h, r] of fits) {
        if (tryPlace(s, w, h, pc.label, r)) {
          placed = true;
          break;
        }
      }
      if (placed) break;
    }
    if (!placed) {
      const s = { placements: [] as Placement[], shelves: [] as Shelf[], usedY: 0, used: 0 };
      sheets.push(s);
      const [w, h, r] = fits[0];
      tryPlace(s, w, h, pc.label, r);
    }
  }
  return { sheets: sheets.map((s, i) => ({ index: i + 1, placements: s.placements, usedArea: s.used })), oversized };
}

export function nestCutList(doc: SceneDoc, cl: CutListResult, sheet: Sheet = { w: 2440, h: 1220 }, kerf = 4, trim = 10): NestResult[] {
  const out: NestResult[] = [];
  const groups = new Map<string, CutPiece[]>();
  for (const p of cl.pieces) {
    // thin back panels, glass etc. are still boards here; skip nothing that is a sheet part
    const k = `${p.materialId}@${p.thickness}`;
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  for (const [, list] of groups) {
    const { sheets, oversized } = nestPieces(list, sheet, kerf, trim);
    const used = sheets.reduce((a, s) => a + s.usedArea, 0);
    const total = sheets.length * sheet.w * sheet.h;
    out.push({
      materialId: list[0].materialId,
      materialName: list[0].materialName,
      thickness: list[0].thickness,
      sheet,
      sheets,
      utilisation: total ? used / total : 0,
      oversized,
    });
  }
  void doc;
  return out;
}
