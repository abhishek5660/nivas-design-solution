import { materialIndex, SLOT_FALLBACK } from '../catalog';
import { buildParts } from '../scene';
import type { MaterialDef, Part, SceneDoc, SceneNode } from '../types';

export function resolveMaterialId(doc: SceneDoc, node: SceneNode, part: Part): string {
  const sub = part.sub ? node.subMaterials?.[`${part.sub.kind}:${part.sub.index}`]?.[part.slot] : undefined;
  return sub ?? part.materialOverride ?? node.materials[part.slot] ?? doc.defaults[part.slot] ?? SLOT_FALLBACK[part.slot];
}

export function docMaterial(doc: SceneDoc, id: string): MaterialDef {
  const idx = materialIndex(doc.customMaterials);
  return idx.get(id) ?? idx.get(SLOT_FALLBACK.carcass)!;
}

export interface NodeParts {
  node: SceneNode;
  parts: Part[];
}

export function allNodeParts(doc: SceneDoc, opts: { includeHidden?: boolean } = {}): NodeParts[] {
  return doc.order
    .map((id) => doc.nodes[id])
    .filter((n): n is SceneNode => !!n && (opts.includeHidden || n.visible))
    .map((node) => ({ node, parts: buildParts(node) }));
}

/** Short node code used in labels, e.g. "WD1", "BC3". Stable per document order. */
export function nodeCodes(doc: SceneDoc): Record<string, string> {
  const counters: Record<string, number> = {};
  const out: Record<string, string> = {};
  for (const id of doc.order) {
    const n = doc.nodes[id];
    if (!n) continue;
    const prefix = codePrefix(n);
    counters[prefix] = (counters[prefix] ?? 0) + 1;
    out[id] = `${prefix}${counters[prefix]}`;
  }
  return out;
}

function codePrefix(n: SceneNode): string {
  switch (n.type) {
    case 'wardrobe':
      return 'WD';
    case 'tv_panel':
      return 'TV';
    case 'countertop':
      return 'CT';
    case 'appliance':
      return 'AP';
    case 'box':
      return 'BX';
    case 'cabinet': {
      const v = (n.params as { variant?: string }).variant;
      return ({ base: 'BC', wall: 'WC', tall: 'TC', corner: 'CC', drawer: 'DC', sink: 'SC', open_shelf: 'OS', island: 'IS', bookcase: 'BK' } as Record<string, string>)[v ?? 'base'] ?? 'CB';
    }
    default:
      return 'GR';
  }
}

export function isApplianceNode(n: SceneNode) {
  return n.type === 'appliance';
}
