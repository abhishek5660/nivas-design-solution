import type { CabinetParams, CabinetVariant, Issue, Part, SceneNode } from '../types';
import { drawerBlock, handleBlock } from './blocks';
import { PartBuilder, hingesForHeight, round } from './helpers';

interface VariantDef {
  label: string;
  size: { w: number; h: number; d: number };
  elevation: number;
  params: Partial<CabinetParams>;
  limits: { w: [number, number]; h: [number, number]; d: [number, number] };
}

export const CABINET_VARIANTS: Record<CabinetVariant, VariantDef> = {
  base: { label: 'Base cabinet', size: { w: 600, h: 820, d: 600 }, elevation: 0, params: { doors: 1, shelves: 1, plinthHeight: 100 }, limits: { w: [150, 1200], h: [500, 1000], d: [300, 800] } },
  wall: { label: 'Wall cabinet', size: { w: 600, h: 720, d: 350 }, elevation: 1400, params: { doors: 1, shelves: 1, plinthHeight: 0 }, limits: { w: [150, 1200], h: [300, 1200], d: [200, 500] } },
  tall: { label: 'Tall pantry unit', size: { w: 600, h: 2100, d: 600 }, elevation: 0, params: { doors: 1, shelves: 4, plinthHeight: 100, handlePlacement: 'center' }, limits: { w: [300, 1000], h: [1500, 2600], d: [300, 800] } },
  corner: { label: 'Corner cabinet', size: { w: 900, h: 820, d: 900 }, elevation: 0, params: { doors: 1, shelves: 1, plinthHeight: 100 }, limits: { w: [700, 1200], h: [500, 1000], d: [700, 1200] } },
  drawer: { label: 'Drawer cabinet', size: { w: 600, h: 820, d: 600 }, elevation: 0, params: { doors: 0, shelves: 0, drawers: [200, 240, 280], plinthHeight: 100, handlePlacement: 'top' }, limits: { w: [300, 1200], h: [500, 1000], d: [300, 800] } },
  sink: { label: 'Sink cabinet', size: { w: 900, h: 820, d: 600 }, elevation: 0, params: { doors: 2, shelves: 0, plinthHeight: 100 }, limits: { w: [600, 1500], h: [500, 1000], d: [450, 800] } },
  open_shelf: { label: 'Open shelf', size: { w: 600, h: 720, d: 300 }, elevation: 1400, params: { doors: 0, shelves: 2, plinthHeight: 0, doorStyle: 'open' }, limits: { w: [150, 1800], h: [200, 2400], d: [150, 500] } },
  island: { label: 'Kitchen island', size: { w: 1800, h: 820, d: 1100 }, elevation: 0, params: { doors: 2, shelves: 1, plinthHeight: 100, overhang: 300, raisedBar: false, countertopThickness: 40 }, limits: { w: [600, 4000], h: [500, 1000], d: [600, 1600] } },
  bookcase: { label: 'Bookcase / display', size: { w: 800, h: 1800, d: 350 }, elevation: 0, params: { doors: 0, shelves: 4, plinthHeight: 60, doorStyle: 'open' }, limits: { w: [200, 2400], h: [400, 2600], d: [150, 600] } },
};

export function defaultCabinet(variant: CabinetVariant): { size: SceneNode['size']; params: CabinetParams; elevation: number } {
  const v = CABINET_VARIANTS[variant];
  const params: CabinetParams = {
    variant,
    thickness: 18,
    backThickness: 6,
    doorThickness: 18,
    plinthHeight: 100,
    shelves: 1,
    drawers: [],
    doors: 1,
    doorStyle: 'flat',
    hingeSide: 'left',
    sliding: false,
    handle: 'bar',
    handlePlacement: 'edge',
    gap: 2,
    wallClearance: 0,
    cornerDoorWidth: 450,
    overhang: 300,
    raisedBar: false,
    countertopThickness: 40,
    hinge: 'HG-SOFT-110',
    runner: 'RN-SOFT-500',
    barHandle: 'H-BAR-160',
    ...v.params,
  };
  return { size: { ...v.size }, params, elevation: v.elevation };
}

export function validateCabinet(node: SceneNode): Issue[] {
  const p = node.params as unknown as CabinetParams;
  const v = CABINET_VARIANTS[p.variant];
  const { w, h, d } = node.size;
  const out: Issue[] = [];
  const chk = (val: number, [lo, hi]: [number, number], f: string, name: string) => {
    if (!(val >= lo && val <= hi)) out.push({ level: 'error', field: f, message: `${name} must be between ${lo} and ${hi} mm for a ${v.label.toLowerCase()}.` });
  };
  chk(w, v.limits.w, 'w', 'Width');
  chk(h, v.limits.h, 'h', 'Height');
  chk(d, v.limits.d, 'd', 'Depth');
  if (out.length) return out;
  const t = p.thickness;
  if (t < 12 || t > 40) out.push({ level: 'error', field: 'thickness', message: 'Board thickness must be 12-40 mm.' });
  if (p.shelves < 0 || p.shelves > 10) out.push({ level: 'error', field: 'shelves', message: 'Shelf count must be 0-10.' });
  if (p.gap < 0 || p.gap > 10) out.push({ level: 'error', field: 'gap', message: 'Gap must be 0-10 mm.' });
  if (p.wallClearance < 0 || p.wallClearance > 100) out.push({ level: 'error', field: 'wallClearance', message: 'Wall clearance must be 0-100 mm.' });
  if (out.length) return out;
  const inner = w - 2 * t;
  const frontH = h - p.plinthHeight;
  const total = p.drawers.reduce((a, b) => a + b, 0);
  const fill = p.variant === 'drawer';
  const scaled = fill && total > 0 ? p.drawers.map((x) => (x / total) * (frontH - 4)) : p.drawers;
  if (scaled.some((x) => x < 80)) out.push({ level: 'error', field: 'drawers', message: 'Drawer fronts must be at least 80 mm high.' });
  if (!fill && total > frontH - 20) out.push({ level: 'error', field: 'drawers', message: `Drawer fronts (${round(total)} mm) do not fit the ${round(frontH)} mm front.` });
  if (p.drawers.length && inner < 200) out.push({ level: 'error', field: 'drawers', message: 'Cabinet is too narrow for drawers (interior < 200 mm).' });
  if (p.doors === 2 && w / 2 < 200) out.push({ level: 'error', field: 'doors', message: 'Two doors would be narrower than 200 mm. Use one door.' });
  if (p.doors === 1 && w > 700 && p.variant !== 'corner') out.push({ level: 'warning', field: 'doors', message: `A single ${round(w)} mm door is wide - use two doors above 700 mm.` });
  if (p.doors > 0 && h - p.plinthHeight > 2200 && p.variant === 'tall') out.push({ level: 'warning', field: 'h', message: 'Very tall doors may warp; consider splitting into upper/lower doors.' });
  if (p.variant === 'corner') {
    if (p.cornerDoorWidth < 300 || p.cornerDoorWidth > w - 250) out.push({ level: 'error', field: 'cornerDoorWidth', message: `Corner door width must be 300-${round(w - 250)} mm.` });
  }
  if (p.variant === 'island' && (p.overhang < 0 || p.overhang > d - 400)) out.push({ level: 'error', field: 'overhang', message: `Overhang must be 0-${round(d - 400)} mm.` });
  if (p.variant === 'island' && p.overhang > 350 && !p.raisedBar) out.push({ level: 'warning', field: 'overhang', message: 'Worktop overhangs over 300 mm need brackets or a support panel.' });
  return out;
}

export function buildCabinet(node: SceneNode): Part[] {
  const p = node.params as unknown as CabinetParams;
  const { w: W, h: H } = node.size;
  const pb = new PartBuilder(node);
  const t = p.thickness;
  const bt = p.backThickness;
  const dt = p.doorThickness;
  const P = p.plinthHeight;
  const g = p.gap;
  const isIsland = p.variant === 'island';
  const isOpen = p.doorStyle === 'open' || p.variant === 'open_shelf' || p.variant === 'bookcase';
  const overhang = isIsland ? p.overhang : 0;
  const D = node.size.d - overhang; // carcass+door depth
  // For islands the carcass occupies the FRONT of the node footprint; overhang is at the back.
  const zFrontFace = node.size.d / 2; // door outer face
  const zBackLimit = isIsland ? node.size.d / 2 - D : -node.size.d / 2 + p.wallClearance;
  const doorZone = isOpen ? 0 : dt + g;
  const zFront = zFrontFace - doorZone;
  const zb = zBackLimit + bt;
  const innerDepth = zFront - zb;
  const zi = (zb + zFront) / 2;
  const carcassDepth = zFront - zBackLimit;
  const zc = (zFront + zBackLimit) / 2;
  const Wi = W - 2 * t;
  const yBottom = P + t;
  const yTop = H - t;
  const Hs = yTop - yBottom;
  const isBaseLike = ['base', 'drawer', 'sink', 'corner', 'island'].includes(p.variant);

  for (const sgn of [-1, 1]) {
    pb.box(`side${sgn}`, sgn < 0 ? 'Left side' : 'Right side', 'side', sgn * (W / 2 - t / 2), P + (H - P) / 2, zc, t, H - P, carcassDepth, { edge: 'front', ops: ['Drill 5mm shelf-pin line', 'Drill 8mm dowel holes for top/bottom rails'] });
  }
  pb.box('bottom', 'Bottom', 'bottom', 0, P + t / 2, zi, Wi, t, innerDepth, { edge: 'front' });
  if (isBaseLike) {
    // Open top with front + back rails (worktop sits on them)
    pb.box('rail-front', 'Front top rail', 'rail', 0, H - t / 2, zFront - 40, Wi, t, 80, { edge: 'front' });
    pb.box('rail-back', 'Back top rail', 'rail', 0, H - t / 2, zb + 40, Wi, t, 80, { edge: 'none' });
  } else {
    pb.box('top', 'Top', 'top', 0, H - t / 2, zi, Wi, t, innerDepth, { edge: 'front' });
  }
  pb.box('back', 'Back panel', 'back', 0, P + (H - P) / 2, zBackLimit + bt / 2, W, H - P, bt, { slot: 'back', grain: 'none' });
  if (P > 0) {
    pb.box('plinth', 'Plinth', 'plinth', 0, P / 2, zFront - 50 - t / 2, Wi, P - 2, t, { slot: 'carcass', edge: 'front', hardware: [{ code: 'LG-ADJ-100', qty: 4 }] });
  }
  if (isIsland) {
    // finished back panel facing the breakfast side
    pb.box('island-back', 'Island back panel', 'panel', 0, P + (H - P) / 2, zBackLimit - 1 + bt + 1, W, H - P, t, { slot: 'shutter', edge: 'all' });
  }

  // fixed shelves
  const frontH = H - P - 2 * g;
  const drawersTotal = p.drawers.reduce((a, b) => a + b, 0);
  const shelfZoneTop = yTop;
  const shelfZoneBottom = p.variant === 'base' && p.drawers.length ? yBottom : yBottom;
  const shelfN = isOpen ? p.shelves : p.variant === 'drawer' || p.variant === 'sink' ? 0 : p.shelves;
  for (let k = 0; k < shelfN; k++) {
    const y = shelfZoneBottom + ((shelfZoneTop - shelfZoneBottom) * (k + 1)) / (shelfN + 1);
    pb.box(`shelf${k}`, `Shelf ${k + 1}`, 'shelf', 0, y, zi - 10, Wi - 2, t, innerDepth - 20, {
      edge: 'front',
      sub: { kind: 'shelf', index: k },
      hardware: [{ code: 'SP-SHELF-5', qty: 4 }],
    });
  }

  // Drawers
  const handleStyle = p.handle;
  if (p.drawers.length) {
    let ratios = p.drawers;
    const fillAll = p.variant === 'drawer';
    let heights = ratios;
    if (fillAll) {
      const sum = ratios.reduce((a, b) => a + b, 0);
      heights = ratios.map((r) => (r / sum) * (H - P - 2 * g));
    }
    ratios = heights;
    // drawers stack from the TOP of the front downwards
    let yT = H - g;
    heights.forEach((hh, k) => {
      const yb = yT - hh;
      drawerBlock(pb, {
        key: `dr${k}`,
        label: `Drawer ${k + 1}`,
        cx: 0,
        width: W - 2 * g + 2 * g > 0 ? W : W,
        yBottom: yb,
        height: hh,
        frontZ: zFrontFace - dt / 2,
        frontT: dt,
        depthAvail: innerDepth - 10,
        group: `drawer-${k}`,
        sub: { kind: 'drawer', index: k },
        runner: p.runner,
        handle: handleStyle,
        barHandle: p.barHandle,
        gap: g,
      });
      yT = yb;
    });
    void drawersTotal;
  }

  // Doors
  const doorsTop = p.drawers.length && p.variant !== 'drawer' ? H - g - p.drawers.reduce((a, b) => a + b, 0) : H - g;
  const doorBottom = P + g;
  const dh = doorsTop - doorBottom;
  if (!isOpen && p.doors > 0 && dh > 100) {
    const zD = zFrontFace - dt / 2;
    const style = p.doorStyle;
    const slot = style === 'glass' ? 'glass' : 'shutter';
    const doorY = doorBottom + dh / 2;
    const handleY = (() => {
      if (p.handlePlacement === 'center') return doorBottom + dh / 2;
      if (p.variant === 'wall') return doorBottom + 110;
      if (p.variant === 'tall') return doorBottom + Math.min(1000, dh * 0.5);
      return doorsTop - 110;
    })();
    if (p.variant === 'corner') {
      const dw = p.cornerDoorWidth;
      const hingeLeft = p.hingeSide === 'left';
      const cx = hingeLeft ? W / 2 - g - dw / 2 : -W / 2 + g + dw / 2;
      const anim = { group: 'door-0', kind: 'hinge' as const, pivot: [hingeLeft ? cx - dw / 2 : cx + dw / 2, 0, zD] as [number, number, number], axis: [0, 1, 0] as [number, number, number], angle: hingeLeft ? -100 : 100 };
      addDoor(pb, 'door0', 'Corner door', cx, doorY, zD, dw - g, dh, dt, slot, style, anim, { kind: 'door', index: 0 }, p.hinge, hingeLeft);
      handleBlock(pb, 'door0-handle', handleStyle, hingeLeft ? cx + dw / 2 - 35 : cx - dw / 2 + 35, handleY, zFrontFace, 'v', 160, anim, { kind: 'door', index: 0 }, p.barHandle);
      // blind-side filler panel
      const bw = W - dw - 2 * g;
      const bx = hingeLeft ? -W / 2 + g + bw / 2 : W / 2 - g - bw / 2;
      pb.box('blind', 'Blind filler panel', 'door', bx, doorY, zD, bw, dh, dt, { slot: 'shutter', edge: 'all' });
    } else if (p.sliding && ['wall', 'tall', 'bookcase'].includes(p.variant)) {
      const ov = 30;
      const pw = (Wi + ov) / 2;
      for (let i = 0; i < 2; i++) {
        const cx = -Wi / 2 + pw / 2 + i * (pw - ov);
        const zz = zD - (i === 0 ? 0 : dt + 4);
        const anim = { group: `door-${i}`, kind: 'slide' as const, slide: [1, 0, 0] as [number, number, number], distance: i === 0 ? pw - ov : -(pw - ov) };
        addDoor(pb, `door${i}`, `Sliding door ${i + 1}`, cx, doorY, zz, pw, dh, dt, slot, style, anim, { kind: 'door', index: i }, 'SL-TRACK-2', true, true);
        handleBlock(pb, `door${i}-handle`, handleStyle === 'none' ? 'none' : 'profile', i === 0 ? cx + pw / 2 - 20 : cx - pw / 2 + 20, doorY, zz + dt / 2, 'v', dh * 0.8, anim, { kind: 'door', index: i });
      }
    } else if (p.doors === 1) {
      const hingeLeft = p.hingeSide === 'left';
      const dw = W - 2 * g;
      const anim = { group: 'door-0', kind: 'hinge' as const, pivot: [hingeLeft ? -dw / 2 : dw / 2, 0, zD] as [number, number, number], axis: [0, 1, 0] as [number, number, number], angle: hingeLeft ? -105 : 105 };
      addDoor(pb, 'door0', 'Door', 0, doorY, zD, dw, dh, dt, slot, style, anim, { kind: 'door', index: 0 }, p.hinge, hingeLeft);
      handleBlock(pb, 'door0-handle', handleStyle, hingeLeft ? dw / 2 - 35 : -dw / 2 + 35, handleY, zFrontFace, 'v', 160, anim, { kind: 'door', index: 0 }, p.barHandle);
    } else {
      const dw = (W - 3 * g) / 2;
      for (let i = 0; i < 2; i++) {
        const hingeLeft = i === 0;
        const cx = hingeLeft ? -W / 2 + g + dw / 2 : W / 2 - g - dw / 2;
        const anim = { group: `door-${i}`, kind: 'hinge' as const, pivot: [hingeLeft ? cx - dw / 2 : cx + dw / 2, 0, zD] as [number, number, number], axis: [0, 1, 0] as [number, number, number], angle: hingeLeft ? -105 : 105 };
        addDoor(pb, `door${i}`, `Door ${i + 1}`, cx, doorY, zD, dw, dh, dt, slot, style, anim, { kind: 'door', index: i }, p.hinge, hingeLeft);
        handleBlock(pb, `door${i}-handle`, handleStyle, hingeLeft ? cx + dw / 2 - 35 : cx - dw / 2 + 35, handleY, zFrontFace, 'v', 160, anim, { kind: 'door', index: i }, p.barHandle);
      }
    }
  }

  // Island built-in worktop
  if (isIsland) {
    const ct = p.countertopThickness;
    const topDepth = node.size.d + 20; // 20 mm front overhang
    const zCentre = -20 / 2 + 0; // front overhang extends +20; centred on node
    pb.box('worktop', 'Island worktop', 'worktop', 0, H + ct / 2, zCentre + 10 - 10, W + 20, ct, topDepth, { slot: 'top', edge: 'all', grain: 'length' });
    if (p.raisedBar && overhang > 0) {
      const barY = 1050;
      pb.box('bar-support', 'Breakfast bar support panel', 'panel', 0, (barY + H + ct) / 2 - 40, -node.size.d / 2 + overhang / 2 + 40, W, barY - H - ct, 25, { slot: 'carcass', edge: 'all' });
      pb.box('bar-top', 'Breakfast bar top', 'worktop', 0, barY + ct / 2, -node.size.d / 2 + overhang / 2 + 20, W + 20, ct, overhang + 40, { slot: 'top', edge: 'all' });
    }
  }
  return pb.parts;
}

function addDoor(
  pb: PartBuilder,
  key: string,
  label: string,
  cx: number,
  cy: number,
  cz: number,
  w: number,
  h: number,
  t: number,
  slot: 'glass' | 'shutter',
  style: CabinetParams['doorStyle'],
  anim: NonNullable<Part['anim']>,
  sub: NonNullable<Part['sub']>,
  hardwareCode: string,
  hingeLeft: boolean,
  sliding = false,
) {
  const hw = sliding ? [{ code: hardwareCode, qty: 0.5 }] : [{ code: hardwareCode, qty: hingesForHeight(h) }];
  pb.box(key, label, 'door', cx, cy, cz, w, h, t, {
    slot,
    sheet: slot === 'shutter',
    edge: 'all',
    anim,
    sub,
    hardware: hw,
    ops: sliding ? undefined : [`Bore ${hingesForHeight(h)}x Ø35 mm hinge cups, 22 mm from ${hingeLeft ? 'left' : 'right'} edge`],
  });
  if (style === 'shaker' && slot === 'shutter') {
    // inset raised field = frame effect (decorative, not a cut-list item)
    pb.box(`${key}-field`, `${label} shaker field`, 'decor', cx, cy, cz + t / 2 + 1.5, Math.max(w - 100, 40), Math.max(h - 100, 40), 3, { slot: 'shutter', sheet: false, anim, sub });
  }
}
