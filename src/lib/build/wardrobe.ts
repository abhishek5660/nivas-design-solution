import type { DoorCfg, Issue, Part, SceneNode, SectionCfg, WardrobeParams } from '../types';
import { drawerBlock, handleBlock, ledStrip } from './blocks';
import { PartBuilder, hingesForHeight, round, splitEven } from './helpers';

let idCounter = 0;
export const uid = (prefix = 'n') =>
  `${prefix}_${Date.now().toString(36)}${(idCounter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export const WARDROBE_LIMITS = {
  w: [600, 6000],
  h: [1200, 3200],
  d: [300, 900],
  sectionMin: 150,
  sectionWarn: 1000,
  hingedDoorWarn: 600,
  hingedDoorMax: 900,
};

/** Interior height available to a section for the given overall wardrobe parameters. */
export function sectionHeight(H: number, p: WardrobeParams): number {
  const bottom = p.plinthHeight + (p.bottomPanel ? p.thickness : 0);
  const topY = H - p.loftHeight - (p.loftHeight > 0 || p.topPanel ? p.thickness : 0);
  return topY - bottom;
}

export function makeSection(kind: SectionCfg['kind'], Hs: number, width: number | null = null): SectionCfg {
  const base: SectionCfg = { id: uid('sec'), width, kind, shelves: [], rod: null, drawers: [], tray: false };
  switch (kind) {
    case 'hanging_long':
      return { ...base, rod: 60 };
    case 'hanging_short': {
      const shelfY = Math.round(Hs * 0.48);
      return { ...base, rod: 60, shelves: [shelfY], drawers: [180, 180] };
    }
    case 'shelves': {
      const n = Math.max(2, Math.floor(Hs / 380));
      const gap = Hs / (n + 1);
      return { ...base, shelves: Array.from({ length: n }, (_, i) => Math.round(gap * (i + 1))) };
    }
    case 'drawers': {
      const drawers = [200, 200, 200, 200];
      const start = drawers.reduce((a, b) => a + b, 0) + 40;
      const shelves: number[] = [];
      for (let y = start; y < Hs - 250; y += 350) shelves.push(Math.round(y));
      return { ...base, drawers, shelves, tray: false };
    }
    case 'shoe': {
      const shelves: number[] = [];
      for (let y = 170; y < Math.min(Hs - 100, 1100); y += 170) shelves.push(y);
      return { ...base, shelves };
    }
    case 'open_niche':
      return { ...base, shelves: [Math.round(Hs / 2)] };
    default:
      return base;
  }
}

export function defaultWardrobe(w = 1800, h = 2400, d = 600): { size: SceneNode['size']; params: WardrobeParams } {
  const p: WardrobeParams = {
    style: 'hinged',
    thickness: 18,
    backThickness: 6,
    doorThickness: 18,
    plinthHeight: 100,
    loftHeight: 0,
    topPanel: true,
    sidePanels: true,
    bottomPanel: true,
    backPanel: true,
    sections: [],
    doorCount: Math.max(2, Math.round(w / 500)),
    doors: [],
    handle: 'bar',
    lighting: { enabled: false, sensor: false, color: '#ffd9a0' },
    hinge: 'HG-SOFT-110',
    runner: 'RN-SOFT-500',
    slidingSystem: 'SL-TRACK-2',
    barHandle: 'H-BAR-160',
  };
  const Hs = sectionHeight(h, p);
  const n = w >= 2400 ? 4 : w >= 1500 ? 3 : w >= 900 ? 2 : 1;
  const kinds: SectionCfg['kind'][] = ['hanging_long', 'shelves', 'hanging_short', 'drawers'];
  p.sections = Array.from({ length: n }, (_, i) => makeSection(kinds[i % kinds.length], Hs));
  p.doors = Array.from({ length: p.doorCount }, () => ({ type: 'solid' }));
  return { size: { w, h, d }, params: p };
}

/** Resolves the internal width of each section; returns widths and any overflow problem. */
export function resolveSectionWidths(sections: SectionCfg[], inner: number, t: number): { widths: number[]; error?: string } {
  const n = sections.length;
  const avail = inner - (n - 1) * t;
  const fixed = sections.reduce((a, s) => a + (s.width ?? 0), 0);
  const autoCount = sections.filter((s) => s.width == null).length;
  if (fixed > avail + 0.001) {
    return { widths: sections.map((s) => s.width ?? 0), error: `Fixed section widths (${round(fixed)} mm) exceed available interior width (${round(avail)} mm).` };
  }
  if (autoCount === 0 && Math.abs(fixed - avail) > 0.5) {
    return { widths: sections.map((s) => s.width ?? 0), error: `Section widths total ${round(fixed)} mm but ${round(avail)} mm is available. Set one section to Auto.` };
  }
  const autoW = autoCount ? (avail - fixed) / autoCount : 0;
  return { widths: sections.map((s) => (s.width == null ? autoW : s.width)) };
}

export function validateWardrobe(node: SceneNode): Issue[] {
  const p = node.params as unknown as WardrobeParams;
  const { w, h, d } = node.size;
  const out: Issue[] = [];
  const L = WARDROBE_LIMITS;
  if (!(w >= L.w[0] && w <= L.w[1])) out.push({ level: 'error', field: 'w', message: `Width must be between ${L.w[0]} and ${L.w[1]} mm.` });
  if (!(h >= L.h[0] && h <= L.h[1])) out.push({ level: 'error', field: 'h', message: `Height must be between ${L.h[0]} and ${L.h[1]} mm.` });
  if (!(d >= L.d[0] && d <= L.d[1])) out.push({ level: 'error', field: 'd', message: `Depth must be between ${L.d[0]} and ${L.d[1]} mm.` });
  if (out.length) return out;
  if (p.sections.length < 1 || p.sections.length > 10) out.push({ level: 'error', field: 'sections', message: 'A wardrobe needs between 1 and 10 sections.' });
  if (p.plinthHeight < 0 || p.plinthHeight > 250) out.push({ level: 'error', field: 'plinthHeight', message: 'Plinth height must be 0-250 mm.' });
  if (p.loftHeight < 0 || p.loftHeight > Math.min(900, h / 2.5)) out.push({ level: 'error', field: 'loftHeight', message: `Loft height must be 0-${Math.round(Math.min(900, h / 2.5))} mm.` });
  if (p.thickness < 12 || p.thickness > 40) out.push({ level: 'error', field: 'thickness', message: 'Board thickness must be 12-40 mm.' });
  if (p.style !== 'open' && (p.doorCount < 1 || p.doorCount > 8)) out.push({ level: 'error', field: 'doorCount', message: 'Door count must be 1-8.' });
  if (out.some((i) => i.level === 'error')) return out;

  const side = p.sidePanels ? p.thickness : 0;
  const inner = w - 2 * side;
  const res = resolveSectionWidths(p.sections, inner, p.thickness);
  if (res.error) {
    out.push({ level: 'error', field: 'sections', message: res.error });
    return out;
  }
  const Hs = sectionHeight(h, p);
  if (Hs < 300) out.push({ level: 'error', field: 'h', message: 'Not enough interior height - reduce plinth/loft or increase height.' });
  res.widths.forEach((sw, i) => {
    const s = p.sections[i];
    if (sw < L.sectionMin) out.push({ level: 'error', field: `section-${i}`, message: `Section ${i + 1} is only ${round(sw)} mm wide (minimum ${L.sectionMin} mm).` });
    else if (sw > L.sectionWarn) out.push({ level: 'warning', field: `section-${i}`, message: `Section ${i + 1} is ${round(sw)} mm wide; shelves over ${L.sectionWarn} mm may sag - add a partition.` });
    const drawerStack = s.drawers.reduce((a, b) => a + b, 0) + (s.tray ? 110 : 0);
    if (s.drawers.some((x) => x < 80)) out.push({ level: 'error', field: `section-${i}`, message: `Section ${i + 1}: drawer heights must be at least 80 mm.` });
    if (drawerStack > Hs - 20) out.push({ level: 'error', field: `section-${i}`, message: `Section ${i + 1}: drawers (${round(drawerStack)} mm) do not fit the ${round(Hs)} mm interior.` });
    for (const y of s.shelves) {
      if (y < 0 || y > Hs - p.thickness - 20) out.push({ level: 'error', field: `section-${i}`, message: `Section ${i + 1}: shelf at ${round(y)} mm is outside the ${round(Hs)} mm interior.` });
    }
    const sorted = [...s.shelves].sort((a, b) => a - b);
    for (let k = 1; k < sorted.length; k++) if (sorted[k] - sorted[k - 1] < p.thickness + 30) out.push({ level: 'error', field: `section-${i}`, message: `Section ${i + 1}: shelves are too close together (min ${p.thickness + 30} mm).` });
    if (s.rod != null && (s.rod < 30 || s.rod > Hs - 300)) out.push({ level: 'error', field: `section-${i}`, message: `Section ${i + 1}: rod drop must be 30-${round(Hs - 300)} mm.` });
    if (s.drawers.length && s.shelves.some((y) => y < drawerStack && y > 0)) out.push({ level: 'warning', field: `section-${i}`, message: `Section ${i + 1}: a shelf overlaps the drawer stack.` });
    if (s.rod != null && s.shelves.some((y) => y > Hs - s.rod! - 20 - 20 && y < Hs - s.rod! + 20 + p.thickness)) out.push({ level: 'warning', field: `section-${i}`, message: `Section ${i + 1}: a shelf is at the hanging rod height.` });
  });
  if (p.style === 'hinged') {
    const dw = (w - (p.doorCount + 1) * 2) / p.doorCount;
    if (dw > L.hingedDoorMax) out.push({ level: 'error', field: 'doorCount', message: `Hinged doors would be ${round(dw)} mm wide (max ${L.hingedDoorMax} mm). Add doors.` });
    else if (dw > L.hingedDoorWarn) out.push({ level: 'warning', field: 'doorCount', message: `Hinged doors are ${round(dw)} mm wide - over ${L.hingedDoorWarn} mm they may sag. Consider more doors.` });
    if (dw < 200) out.push({ level: 'error', field: 'doorCount', message: `Doors would be only ${round(dw)} mm wide. Reduce the door count.` });
  }
  if (p.style === 'sliding' && w / p.doorCount > 1500) out.push({ level: 'error', field: 'doorCount', message: 'Sliding panels over 1500 mm wide are not supported.' });
  return out;
}

function slidingTracks(n: number) {
  return Math.min(Math.max(n, 1), 3);
}

export function buildWardrobe(node: SceneNode): Part[] {
  const p = node.params as unknown as WardrobeParams;
  const { w: W, h: H, d: D } = node.size;
  const pb = new PartBuilder(node);
  const t = p.thickness;
  const bt = p.backThickness;
  const dt = p.doorThickness;
  const P = p.plinthHeight;
  const loft = p.loftHeight;
  const style = p.style;
  const tracks = slidingTracks(p.doorCount);
  const doorZone = style === 'open' ? 0 : style === 'hinged' ? dt + 2 : tracks * (dt + 6) + 4;
  const zFront = D / 2 - doorZone;
  const zBack = -D / 2;
  const zb = zBack + (p.backPanel ? bt : 0);
  const side = p.sidePanels ? t : 0;
  const Wi = W - 2 * side;
  const innerDepth = zFront - zb;
  const zi = (zb + zFront) / 2;
  const carcassDepth = zFront - zBack;
  const zc = (zFront + zBack) / 2;

  const yBottom = P + (p.bottomPanel ? t : 0);
  const yTopAll = p.topPanel ? H - t : H; // underside of the top
  const yTop = loft > 0 ? H - loft - t : yTopAll; // top of the main zone
  const Hs = yTop - yBottom;

  // Outer carcass
  if (p.sidePanels) {
    for (const sgn of [-1, 1]) {
      pb.box(`side${sgn}`, sgn < 0 ? 'Left side panel' : 'Right side panel', 'side', sgn * (W / 2 - t / 2), H / 2, zc, t, H, carcassDepth, {
        edge: 'front',
        ops: [`Drill 5mm shelf-pin line (32 mm system) ${Math.round(Hs)} mm`, 'Drill 8mm dowel/cam holes for top, bottom and partitions'],
      });
    }
  }
  if (p.topPanel) pb.box('top', 'Top panel', 'top', 0, H - t / 2, (zb + zFront) / 2, Wi, t, innerDepth, { edge: 'front' });
  if (p.bottomPanel) pb.box('bottom', 'Bottom panel', 'bottom', 0, P + t / 2, zi, Wi, t, innerDepth, { edge: 'front' });
  if (p.backPanel) {
    // back panels are cut in sheet-sized strips (max 1200 mm wide)
    const segs = splitEven(W, 1200);
    let bx = -W / 2;
    segs.forEach((sw, i) => {
      pb.box(segs.length > 1 ? `back${i}` : 'back', segs.length > 1 ? `Back panel ${i + 1}` : 'Back panel', 'back', bx + sw / 2, P + (H - P) / 2, zBack + bt / 2, sw, H - P, bt, { slot: 'back', grain: 'none' });
      bx += sw;
    });
  }
  if (P > 0) {
    pb.box('plinth', 'Plinth / skirting', 'plinth', 0, P / 2, zFront - 50 - t / 2, Wi, P - 2, t, {
      slot: 'carcass',
      edge: 'front',
      hardware: [{ code: 'LG-ADJ-100', qty: Math.max(4, Math.ceil(W / 800) * 2) }],
    });
  }

  // Sections
  const { widths } = resolveSectionWidths(p.sections, Wi, t);
  let cursor = -Wi / 2;
  const n = p.sections.length;
  const ledColor = p.lighting.color;
  p.sections.forEach((sec, si) => {
    const sw = widths[si];
    const cx = cursor + sw / 2;
    const sub = { kind: 'section' as const, index: si };
    // partition to the right of this section
    if (si < n - 1) {
      const px = cursor + sw + t / 2;
      const top = loft > 0 ? yTopAll : yTop;
      pb.box(`part${si}`, `Partition ${si + 1}`, 'partition', px, yBottom + (top - yBottom) / 2, zi, t, top - yBottom, innerDepth, {
        edge: 'front',
        sub,
        hardware: [{ code: 'CAM-LOCK', qty: 4 }],
        ops: ['Drill 5mm shelf-pin holes on both faces'],
      });
    }
    if (loft > 0) {
      pb.box(`loftdiv${si}`, `Loft divider ${si + 1}`, 'shelf', cx, yTop + t / 2, zi, sw, t, innerDepth, { edge: 'front', sub });
    }
    // shelves
    sec.shelves.forEach((sy, k) => {
      const tilt = sec.kind === 'shoe';
      pb.box(`sec${si}-shelf${k}`, `Shelf S${si + 1}-${k + 1}`, 'shelf', cx, yBottom + sy + t / 2, zi - 10, sw - 2, t, innerDepth - 20, {
        edge: 'front',
        sub,
        rot: tilt ? [-8, 0, 0] : undefined,
        hardware: [{ code: 'SP-SHELF-5', qty: 4 }],
      });
    });
    // hanging rod
    if (sec.rod != null) {
      pb.cyl(`sec${si}-rod`, `Hanging rod S${si + 1}`, 'hardware', cx, yTop - sec.rod, zi, 25, sw - 2, 'x', {
        slot: 'metal',
        sub,
        hardware: [
          { code: 'ROD-OVAL', qty: round(sw / 1000, 3) },
          { code: 'ROD-BRACKET', qty: 1 },
        ],
      });
    }
    // drawers
    let dy = yBottom + 20;
    sec.drawers.forEach((dh, k) => {
      drawerBlock(pb, {
        key: `sec${si}-dr${k}`,
        label: `Drawer S${si + 1}-${k + 1}`,
        cx,
        width: sw,
        yBottom: dy,
        height: dh,
        frontZ: zFront - t / 2 - 1,
        frontT: t,
        depthAvail: innerDepth,
        group: `drawer-${si}-${k}`,
        sub: { kind: 'drawer', index: si * 100 + k },
        runner: p.runner,
        handle: p.handle === 'profile' ? 'bar' : p.handle,
        barHandle: p.barHandle,
      });
      dy += dh;
    });
    if (sec.tray) {
      drawerBlock(pb, {
        key: `sec${si}-tray`,
        label: `Accessory tray S${si + 1}`,
        cx,
        width: sw,
        yBottom: yTop - 110,
        height: 90,
        frontZ: zFront - t / 2 - 1,
        frontT: t,
        depthAvail: innerDepth,
        group: `drawer-${si}-tray`,
        sub: { kind: 'drawer', index: si * 100 + 99 },
        runner: p.runner,
        handle: p.handle === 'profile' ? 'bar' : p.handle,
        barHandle: p.barHandle,
      });
    }
    if (p.lighting.enabled) {
      ledStrip(pb, `sec${si}-led`, `LED strip S${si + 1}`, cx, yTop - 8, zFront - 25, sw - 20, ledColor, 1, 'x', sub);
    }
    cursor += sw + t;
  });
  if (p.lighting.enabled) {
    const first = pb.parts.find((x) => x.role === 'led');
    if (first) {
      first.hardware = [...(first.hardware ?? []), { code: 'LED-DRIVER', qty: 1 }, ...(p.lighting.sensor ? [{ code: 'LED-SENSOR', qty: 1 }] : [])];
    }
  }

  // Doors
  const doors: DoorCfg[] = p.doors;
  const g = 2;
  if (style === 'hinged') {
    const nd = p.doorCount;
    const dw = (W - (nd + 1) * g) / nd;
    const y0 = (P > 0 ? P : 0) + g;
    const y1 = (loft > 0 ? H - loft : H) - g;
    const dh = y1 - y0;
    for (let i = 0; i < nd; i++) {
      const cfg = doors[i] ?? { type: 'solid' };
      if (cfg.type === 'none') continue;
      const cx = -W / 2 + g + dw / 2 + i * (dw + g);
      const hingeLeft = nd === 1 ? true : nd % 2 === 0 ? i < nd / 2 : i <= Math.floor(nd / 2);
      const hingeX = hingeLeft ? cx - dw / 2 : cx + dw / 2;
      const zD = D / 2 - dt / 2;
      const anim = { group: `door-${i}`, kind: 'hinge' as const, pivot: [hingeX, 0, zD] as [number, number, number], axis: [0, 1, 0] as [number, number, number], angle: hingeLeft ? -105 : 105 };
      const sub = { kind: 'door' as const, index: i };
      const slot = cfg.type === 'mirror' ? 'mirror' : cfg.type === 'glass' ? 'glass' : 'shutter';
      pb.box(`door${i}`, `Door ${i + 1}`, 'door', cx, y0 + dh / 2, zD, dw, dh, dt, {
        slot,
        sheet: cfg.type === 'solid',
        edge: 'all',
        anim,
        sub,
        materialOverride: cfg.material,
        hardware: [{ code: p.hinge, qty: hingesForHeight(dh) }],
        ops: [`Bore ${hingesForHeight(dh)}x Ø35 mm hinge cups, 22 mm from ${hingeLeft ? 'left' : 'right'} edge`],
      });
      const hx = hingeLeft ? cx + dw / 2 - 35 : cx - dw / 2 + 35;
      handleBlock(pb, `door${i}-handle`, p.handle, p.handle === 'profile' ? (hingeLeft ? cx + dw / 2 - 7 : cx - dw / 2 + 7) : hx, y0 + Math.min(dh * 0.5, 1050), D / 2, 'v', p.handle === 'profile' ? dh : 160, anim, sub, p.barHandle);
    }
  } else if (style === 'sliding') {
    const nd = p.doorCount;
    const ov = 40;
    const pw = (Wi + (nd - 1) * ov) / nd;
    const yT = yTop - 25;
    const y0 = yBottom + 12;
    const dh = yT - y0;
    const trackZ = (k: number) => D / 2 - dt / 2 - 2 - k * (dt + 6);
    const trackDepth = tracks * (dt + 6);
    pb.box('track-top', 'Top sliding track', 'rail', 0, yTop - 12, D / 2 - trackDepth / 2 - 2, Wi, 25, trackDepth, {
      slot: 'metal',
      sheet: false,
      hardware: [{ code: p.slidingSystem, qty: 1 }, { code: 'SL-PROFILE', qty: round((nd * (pw + dh) * 2) / 1000, 2) }],
    });
    pb.box('track-bottom', 'Bottom sliding track', 'rail', 0, yBottom + 6, D / 2 - trackDepth / 2 - 2, Wi, 12, trackDepth, { slot: 'metal', sheet: false });
    for (let i = 0; i < nd; i++) {
      const cfg = doors[i] ?? { type: 'solid' };
      if (cfg.type === 'none') continue;
      const k = i % tracks;
      const cx = -Wi / 2 + pw / 2 + i * (pw - ov);
      const sign = i < nd / 2 ? 1 : -1;
      const dist = (pw - ov) * 0.95 * sign;
      const anim = { group: `door-${i}`, kind: 'slide' as const, slide: [1, 0, 0] as [number, number, number], distance: dist };
      const slot = cfg.type === 'mirror' ? 'mirror' : cfg.type === 'glass' ? 'glass' : 'shutter';
      const sub = { kind: 'door' as const, index: i };
      pb.box(`door${i}`, `Sliding panel ${i + 1}`, 'door', cx, y0 + dh / 2, trackZ(k), pw, dh, dt, {
        slot,
        sheet: cfg.type === 'solid',
        edge: 'all',
        anim,
        sub,
        materialOverride: cfg.material,
      });
      const edgeX = sign > 0 ? cx + pw / 2 - 30 : cx - pw / 2 + 30;
      handleBlock(pb, `door${i}-handle`, p.handle === 'none' ? 'none' : 'profile', edgeX, y0 + dh / 2, trackZ(k) + dt / 2 - 6, 'v', dh * 0.9, anim, sub);
    }
  }
  // loft shutters (lift-up) above hinged or sliding doors
  if (loft > 0 && style !== 'open') {
    const nd = p.doorCount;
    const dwL = (W - (nd + 1) * g) / nd;
    const ly0 = H - loft + g;
    const lh = loft - 2 * g;
    for (let i = 0; i < nd; i++) {
      const cx = -W / 2 + g + dwL / 2 + i * (dwL + g);
      const zD = D / 2 - dt / 2;
      const anim = { group: `loft-${i}`, kind: 'hinge' as const, pivot: [cx, H - g, zD] as [number, number, number], axis: [1, 0, 0] as [number, number, number], angle: -80 };
      pb.box(`loft${i}`, `Loft shutter ${i + 1}`, 'door', cx, ly0 + lh / 2, zD, dwL, lh, dt, {
        edge: 'all',
        anim,
        sub: { kind: 'door', index: 100 + i },
        hardware: [{ code: 'HG-LIFT', qty: 1 }],
      });
    }
  }
  return pb.parts;
}

/** Applies an overall resize while keeping sections valid: fixed widths scale proportionally. */
export function resizeWardrobe(node: SceneNode, size: SceneNode['size']): SceneNode {
  const p = node.params as unknown as WardrobeParams;
  const side = p.sidePanels ? p.thickness : 0;
  const oldInner = node.size.w - 2 * side;
  const newInner = size.w - 2 * side;
  const ratio = oldInner > 0 ? newInner / oldInner : 1;
  const oldHs = sectionHeight(node.size.h, p);
  const newHs = sectionHeight(size.h, p);
  const sections = p.sections.map((s) => ({
    ...s,
    width: s.width == null ? null : Math.round(s.width * ratio),
    shelves: oldHs > 0 && newHs !== oldHs ? s.shelves.map((y) => Math.max(0, Math.min(Math.round(y * (newHs / oldHs)), newHs - p.thickness - 20))) : s.shelves,
  }));
  return { ...node, size, params: { ...p, sections } as unknown as Record<string, unknown> };
}

/**
 * Keeps dependent content valid when a parameter that changes the interior height (loft, plinth,
 * board thickness, top/bottom panels) is edited: shelf heights scale with the interior, rod drops
 * are clamped. Called for inspector edits so "add a loft" just works.
 */
export function adaptWardrobe(prev: SceneNode, next: SceneNode): SceneNode {
  const a = prev.params as unknown as WardrobeParams;
  const b = next.params as unknown as WardrobeParams;
  const oldHs = sectionHeight(prev.size.h, a);
  const newHs = sectionHeight(next.size.h, b);
  if (oldHs === newHs || oldHs <= 0 || newHs <= 0) return next;
  const maxShelf = newHs - b.thickness - 20;
  const sections = b.sections.map((s) => ({
    ...s,
    shelves: s.shelves.map((y) => Math.max(0, Math.min(Math.round(y * (newHs / oldHs)), maxShelf))),
    rod: s.rod == null ? null : Math.max(30, Math.min(s.rod, newHs - 300)),
  }));
  return { ...next, params: { ...b, sections } as unknown as Record<string, unknown> };
}
