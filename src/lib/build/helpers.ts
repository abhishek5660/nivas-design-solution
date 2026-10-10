import type { Part, PartAnim, PartRole, SceneNode, Slot, Vec3 } from '../types';

export type EdgeSpec = 'none' | 'front' | 'all';

const EDGE: Record<EdgeSpec, [boolean, boolean, boolean, boolean]> = {
  none: [false, false, false, false],
  front: [true, false, false, false],
  all: [true, true, true, true],
};

export interface PanelOpts {
  slot?: Slot;
  edge?: EdgeSpec;
  hardware?: { code: string; qty: number }[];
  anim?: PartAnim;
  sub?: Part['sub'];
  rot?: Vec3;
  grain?: 'length' | 'width' | 'none';
  materialOverride?: string;
  ops?: string[];
  sheet?: boolean;
  light?: Part['light'];
}

export class PartBuilder {
  parts: Part[] = [];
  constructor(private node: SceneNode) {}

  /** Add a rectangular board / box. cx,cy,cz = centre. sx,sy,sz = size. */
  box(
    key: string,
    label: string,
    role: PartRole,
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    o: PanelOpts = {},
  ): Part {
    const sheetDefault = ['side', 'top', 'bottom', 'back', 'partition', 'shelf', 'door', 'drawer_front', 'plinth', 'panel', 'worktop', 'rail', 'backsplash', 'decor'].includes(role);
    const sheet = o.sheet ?? sheetDefault;
    const dims = [sx, sy, sz];
    const thickness = Math.min(...dims);
    const p: Part = {
      id: `${this.node.id}:${key}`,
      nodeId: this.node.id,
      label,
      role,
      shape: 'box',
      size: [round(sx), round(sy), round(sz)],
      center: [round(cx), round(cy), round(cz)],
      slot: o.slot ?? defaultSlot(role),
      sheet,
      thickness: round(thickness),
      grain: o.grain ?? 'length',
      edge: sheet ? EDGE[o.edge ?? 'none'] : undefined,
      hardware: o.hardware,
      anim: o.anim,
      sub: o.sub,
      rot: o.rot,
      materialOverride: o.materialOverride,
      ops: o.ops,
      light: o.light,
    };
    this.parts.push(p);
    return p;
  }

  /** Cylinder with its axis along local X, Y or Z. */
  cyl(
    key: string,
    label: string,
    role: PartRole,
    cx: number,
    cy: number,
    cz: number,
    diameter: number,
    length: number,
    axis: 'x' | 'y' | 'z',
    o: PanelOpts = {},
  ): Part {
    const rot: Vec3 = axis === 'x' ? [0, 0, 90] : axis === 'z' ? [90, 0, 0] : [0, 0, 0];
    const p: Part = {
      id: `${this.node.id}:${key}`,
      nodeId: this.node.id,
      label,
      role,
      shape: 'cylinder',
      size: [round(diameter), round(length), round(diameter)],
      center: [round(cx), round(cy), round(cz)],
      rot: o.rot ?? rot,
      slot: o.slot ?? defaultSlot(role),
      hardware: o.hardware,
      anim: o.anim,
      sub: o.sub,
      materialOverride: o.materialOverride,
    };
    this.parts.push(p);
    return p;
  }
}

export function defaultSlot(role: PartRole): Slot {
  switch (role) {
    case 'side':
    case 'top':
    case 'plinth':
    case 'rail':
      return 'carcass';
    case 'bottom':
    case 'partition':
    case 'shelf':
    case 'drawer_part':
      return 'interior';
    case 'back':
      return 'back';
    case 'door':
    case 'drawer_front':
      return 'shutter';
    case 'worktop':
      return 'top';
    case 'backsplash':
      return 'backsplash';
    case 'hardware':
      return 'handle';
    case 'appliance':
      return 'appliance';
    case 'led':
      return 'led';
    case 'decor':
      return 'accent';
    default:
      return 'carcass';
  }
}

export const round = (n: number, p = 1) => Math.round(n * 10 ** p) / 10 ** p;

/** Standard drawer runner lengths (mm). Picks the longest that fits the depth. */
export const RUNNER_LENGTHS = [250, 300, 350, 400, 450, 500, 550];
export function runnerFor(depth: number): number {
  let best = RUNNER_LENGTHS[0];
  for (const l of RUNNER_LENGTHS) if (l <= depth) best = l;
  return best;
}

/** Number of hinges for a door of the given height (rule of thumb used throughout). */
export function hingesForHeight(h: number): number {
  if (h <= 900) return 2;
  if (h <= 1600) return 3;
  if (h <= 2000) return 4;
  return 5;
}

/** Splits a length into the fewest equal segments no longer than `max` (sheet-size limit). */
export function splitEven(total: number, max: number): number[] {
  const n = Math.max(1, Math.ceil(total / max - 1e-9));
  return Array.from({ length: n }, () => total / n);
}
