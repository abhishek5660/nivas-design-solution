import type { Issue, Part, SceneNode, TvParams } from '../types';
import { drawerBlock, handleBlock, ledStrip } from './blocks';
import { PartBuilder, round, splitEven } from './helpers';
import { uid } from './wardrobe';

export const tvDims = (diag: number) => ({ w: diag * 25.4 * 0.8716, h: diag * 25.4 * 0.4903, t: 28 });

export function defaultTv(w = 3200, h = 2700, d = 450): { size: SceneNode['size']; params: TvParams } {
  const tv = tvDims(65);
  const sideW = 450;
  return {
    size: { w, h, d },
    params: {
      style: 'fluted',
      panelThickness: 30,
      patternSpacing: 60,
      tv: { size: 65, x: 0, bottom: 900, depth: 0, wallMount: true },
      unit: { type: 'floating', width: w - 2 * sideW - 40, height: 380, depth: 400, elevation: 250, drawers: 2, doors: 0, open: false, routerCompartment: true, cableOpening: true },
      sides: {
        left: { enabled: true, width: sideW, height: h - 400, kind: 'niche' },
        right: { enabled: true, width: sideW, height: h - 400, kind: 'closed' },
        depth: 380,
      },
      shelves: [{ id: uid('shf'), x: 0, y: 900 + tv.h + 120, w: 1200, d: 220, t: 30 }],
      soundbar: true,
      fireplace: false,
      backlit: true,
      led: { enabled: true, color: '#ffd9a0', intensity: 1, under: true, behindTv: true, niches: true },
      handle: 'profile',
    },
  };
}

export function validateTv(node: SceneNode): Issue[] {
  const p = node.params as unknown as TvParams;
  const { w, h, d } = node.size;
  const out: Issue[] = [];
  if (w < 1000 || w > 8000) out.push({ level: 'error', field: 'w', message: 'Wall/panel width must be 1000-8000 mm.' });
  if (h < 1800 || h > 3600) out.push({ level: 'error', field: 'h', message: 'Panel height must be 1800-3600 mm.' });
  if (d < 100 || d > 900) out.push({ level: 'error', field: 'd', message: 'Overall depth must be 100-900 mm.' });
  if (out.length) return out;
  if (p.panelThickness < 9 || p.panelThickness > 120) out.push({ level: 'error', field: 'panelThickness', message: 'Panel thickness must be 9-120 mm.' });
  if (p.panelThickness + 30 > d) out.push({ level: 'error', field: 'd', message: 'Depth must exceed panel thickness by at least 30 mm.' });
  if (p.tv.size < 24 || p.tv.size > 120) out.push({ level: 'error', field: 'tv.size', message: 'TV size must be 24-120 inches.' });
  if (p.patternSpacing < 20 || p.patternSpacing > 400) out.push({ level: 'error', field: 'patternSpacing', message: 'Pattern spacing must be 20-400 mm.' });
  if (out.length) return out;
  const tv = tvDims(p.tv.size);
  const sideL = p.sides.left.enabled ? p.sides.left.width : 0;
  const sideR = p.sides.right.enabled ? p.sides.right.width : 0;
  const freeL = -w / 2 + sideL;
  const freeR = w / 2 - sideR;
  if (p.tv.x - tv.w / 2 < freeL - 0.5 || p.tv.x + tv.w / 2 > freeR + 0.5) out.push({ level: 'error', field: 'tv.x', message: `A ${p.tv.size}" TV (${round(tv.w)} mm wide) does not fit between the side units at this position.` });
  if (p.tv.bottom < 0 || p.tv.bottom + tv.h > h - 50) out.push({ level: 'error', field: 'tv.bottom', message: `The TV (${round(tv.h)} mm tall) must fit within the ${h} mm panel height.` });
  if (p.unit.type !== 'none') {
    const u = p.unit;
    if (u.width < 300 || u.width > w) out.push({ level: 'error', field: 'unit.width', message: 'Unit width must be 300 mm up to the panel width.' });
    if (u.height < 150 || u.height > 1200) out.push({ level: 'error', field: 'unit.height', message: 'Unit height must be 150-1200 mm.' });
    if (u.depth < 150 || u.depth > d) out.push({ level: 'error', field: 'unit.depth', message: `Unit depth must be 150 mm up to the overall depth (${d} mm).` });
    if (u.width > freeR - freeL + 0.5) out.push({ level: 'error', field: 'unit.width', message: 'Unit is wider than the space between the side units.' });
    const bottom = u.type === 'floating' ? u.elevation : 0;
    if (bottom + u.height + 50 > p.tv.bottom && !p.fireplace) out.push({ level: 'warning', field: 'unit.height', message: 'The unit top is within 50 mm of the TV bottom. Raise the TV or lower the unit.' });
    const dr = u.drawers * 160;
    if (dr > u.height - 40) out.push({ level: 'error', field: 'unit.drawers', message: `${u.drawers} drawers need ${dr + 40} mm of unit height (have ${round(u.height)} mm).` });
    if (u.drawers > 6) out.push({ level: 'error', field: 'unit.drawers', message: 'Maximum 6 drawers.' });
    if (u.doors > 4) out.push({ level: 'error', field: 'unit.doors', message: 'Maximum 4 doors.' });
  }
  for (const s of p.shelves) {
    if (s.w < 100 || s.d < 80 || s.t < 12) out.push({ level: 'error', field: 'shelves', message: 'Shelves need width >= 100, depth >= 80 and thickness >= 12 mm.' });
    if (s.d > d) out.push({ level: 'error', field: 'shelves', message: 'A shelf is deeper than the panel envelope.' });
    if (Math.abs(s.x) + s.w / 2 > w / 2 || s.y + s.t > h) out.push({ level: 'error', field: 'shelves', message: 'A shelf lies outside the panel.' });
    if (s.y < p.tv.bottom + tv.h + 10 && s.y + s.t > p.tv.bottom - 10 && Math.abs(s.x - p.tv.x) < (s.w + tv.w) / 2) out.push({ level: 'warning', field: 'shelves', message: 'A shelf intersects the TV.' });
  }
  if (p.fireplace && p.tv.bottom < 600) out.push({ level: 'warning', field: 'fireplace', message: 'Fireplace insert needs the TV to be at least 600 mm above the floor.' });
  const lines = p.style === 'slat' || p.style === 'batten' ? Math.floor(w / p.patternSpacing) : 0;
  if (lines > 140) out.push({ level: 'warning', field: 'patternSpacing', message: `${lines} battens will be generated - increase spacing for better performance.` });
  return out;
}

export function buildTv(node: SceneNode): Part[] {
  const p = node.params as unknown as TvParams;
  const pb = new PartBuilder(node);
  const { w: W, h: H, d: D } = node.size;
  const pt = p.panelThickness;
  const zWall = -D / 2;
  const zPanelFront = zWall + pt;
  const t = 18;
  const dims = tvDims(p.tv.size);
  const sideL = p.sides.left.enabled ? p.sides.left.width : 0;
  const sideR = p.sides.right.enabled ? p.sides.right.width : 0;

  // Backboard panel with decorative finish
  // wall panel is cut from sheets: split into columns (<=1200) and rows (<=2400)
  const cols = splitEven(W, 1200);
  const rowsH = splitEven(H, 2400);
  let px = -W / 2;
  cols.forEach((cw, ci) => {
    let py = 0;
    rowsH.forEach((rh, ri) => {
      pb.box(`panel-${ci}-${ri}`, `Wall panel ${ci + 1}.${ri + 1}`, 'decor', px + cw / 2, py + rh / 2, zWall + pt / 2, cw, rh, pt, { slot: 'accent', edge: 'all', grain: 'width', hardware: ci === 0 && ri === 0 ? [{ code: 'SCREW-PACK', qty: Math.ceil(W / 1000) }] : undefined });
      py += rh;
    });
    px += cw;
  });
  if ((p.style === 'slat' || p.style === 'batten') && p.patternSpacing > 0) {
    const pitch = p.patternSpacing;
    const bw = p.style === 'slat' ? pitch * 0.55 : Math.min(pitch * 0.35, 40);
    const n = Math.min(Math.floor((W - sideL - sideR) / pitch), 160);
    const startX = -W / 2 + sideL + ((W - sideL - sideR) - (n - 1) * pitch) / 2;
    for (let i = 0; i < n; i++) {
      pb.box(`batten${i}`, `${p.style === 'slat' ? 'Slat' : 'Batten'} ${i + 1}`, 'decor', startX + i * pitch, H / 2, zPanelFront + 10, bw, H - 100, 20, { slot: 'accent', sheet: true, edge: 'all' });
    }
  }

  // TV
  const tvZ = zPanelFront + 6 + dims.t / 2 + p.tv.depth;
  const tvY = p.tv.bottom + dims.h / 2;
  pb.box('tv-body', `${p.tv.size}" TV`, 'appliance', p.tv.x, tvY, tvZ, dims.w, dims.h, dims.t, { slot: 'appliance', materialOverride: 'metal-black', sheet: false, sub: { kind: 'tv', index: 0 } });
  pb.box('tv-screen', 'TV screen', 'appliance', p.tv.x, tvY, tvZ + dims.t / 2 + 0.5, dims.w - 20, dims.h - 20, 1, { slot: 'glass', materialOverride: 'glass-smoked', sheet: false, sub: { kind: 'tv', index: 0 } });
  if (p.soundbar) {
    const sbw = Math.min(dims.w * 0.8, 1100);
    pb.box('soundbar', 'Soundbar', 'appliance', p.tv.x, p.tv.bottom - 55, tvZ + 20, sbw, 60, 100, { slot: 'appliance', materialOverride: 'metal-black', sheet: false });
  }
  // Behind-TV halo + backlit inset
  if (p.led.enabled && p.led.behindTv) {
    const hx = dims.w / 2 + 6;
    const hy = dims.h / 2 + 6;
    const z = zPanelFront + 3;
    ledStrip(pb, 'halo-top', 'Halo LED top', p.tv.x, p.tv.bottom + dims.h + 8, z, dims.w + 20, p.led.color, p.led.intensity);
    ledStrip(pb, 'halo-bottom', 'Halo LED bottom', p.tv.x, p.tv.bottom - 8, z, dims.w + 20, p.led.color, p.led.intensity);
    ledStrip(pb, 'halo-left', 'Halo LED left', p.tv.x - hx, tvY, z, dims.h + 20, p.led.color, p.led.intensity, 'y');
    ledStrip(pb, 'halo-right', 'Halo LED right', p.tv.x + hx, tvY, z, dims.h + 20, p.led.color, p.led.intensity, 'y');
  }
  if (p.backlit) {
    pb.box('backlit', 'Backlit decorative panel', 'decor', p.tv.x, tvY, zPanelFront + 1, dims.w + 260, dims.h + 260, 2, {
      slot: 'led',
      sheet: false,
      light: { color: p.led.color, intensity: p.led.enabled ? p.led.intensity * 0.5 : 0.2 },
      hardware: [{ code: 'LED-PROFILE', qty: round(((dims.w + 260) * 2 + (dims.h + 260) * 2) / 1000, 2) }],
    });
  }

  // Fireplace insert
  if (p.fireplace) {
    const fw = Math.min(1200, W - sideL - sideR - 200);
    pb.box('fire-frame', 'Fireplace insert', 'appliance', 0, 300, zPanelFront + 60, fw, 460, 120, { slot: 'appliance', materialOverride: 'metal-black', sheet: false });
    pb.box('fire-flame', 'Flame effect', 'led', 0, 250, zPanelFront + 122, fw - 140, 260, 4, { slot: 'led', sheet: false, materialOverride: 'sc-terracotta', light: { color: '#ff8a3c', intensity: 1 } });
  }

  // Unit under the TV
  const u = p.unit;
  if (u.type !== 'none') {
    const y0 = u.type === 'floating' ? u.elevation : 0;
    const uh = u.height;
    const uw = u.width;
    const ud = Math.min(u.depth, D - pt);
    const zFront = zPanelFront + ud; // carcass front plane
    const zi = (zPanelFront + zFront - t) / 2;
    const innerD = zFront - t - zPanelFront;
    const cx0 = (sideL - sideR) / 2;
    const sub = { kind: 'section' as const, index: 0 };
    pb.box('u-top', 'Unit top', 'top', cx0, y0 + uh - t / 2, (zPanelFront + zFront) / 2, uw, t, ud, { slot: 'carcass', edge: 'front', sub });
    pb.box('u-bottom', 'Unit bottom', 'bottom', cx0, y0 + t / 2, (zPanelFront + zFront) / 2, uw, t, ud, { slot: 'carcass', edge: 'front', sub });
    for (const sgn of [-1, 1]) pb.box(`u-side${sgn}`, 'Unit side', 'side', cx0 + sgn * (uw / 2 - t / 2), y0 + uh / 2, (zPanelFront + zFront) / 2, t, uh - 2 * t, ud, { slot: 'carcass', edge: 'front', sub });
    pb.box('u-back', 'Unit back', 'back', cx0, y0 + uh / 2, zPanelFront + 3, uw - 2 * t, uh - 2 * t, 6, { slot: 'back', grain: 'none', sub });
    if (u.cableOpening) {
      pb.cyl('u-cable', 'Cable grommet', 'hardware', cx0, y0 + uh - t - 40, zPanelFront + 8, 60, 6, 'z', { slot: 'metal', materialOverride: 'metal-black', hardware: [{ code: 'SCREW-PACK', qty: 1 }] });
    }
    const bays = Math.max(1, u.doors + (u.drawers > 0 ? 1 : 0));
    const iw = uw - 2 * t;
    const bw = (iw - (bays - 1) * t) / bays;
    let bx = cx0 - iw / 2;
    const handleStyle = p.handle;
    let bayIndex = 0;
    const doorBays = u.doors;
    const addPartition = (i: number, x: number) => pb.box(`u-part${i}`, 'Unit partition', 'partition', x, y0 + uh / 2, zi, t, uh - 2 * t, innerD, { slot: 'interior', edge: 'front', sub });
    for (let b = 0; b < bays; b++) {
      const cx = bx + bw / 2;
      const isDrawerBay = u.drawers > 0 && b === bays - 1 && (doorBays === 0 || true) && (b >= doorBays);
      if (isDrawerBay) {
        const stackH = uh - 2 * t - 8;
        const dh = stackH / u.drawers;
        for (let k = 0; k < u.drawers; k++) {
          drawerBlock(pb, {
            key: `u-dr${k}`,
            label: `TV unit drawer ${k + 1}`,
            cx,
            width: bw + (bays === 1 ? 0 : 0),
            yBottom: y0 + t + 4 + k * dh,
            height: dh,
            frontZ: zFront + 20 / 2 + 0,
            frontT: 18,
            depthAvail: innerD,
            group: `drawer-${k}`,
            sub: { kind: 'drawer', index: k },
            runner: 'RN-SOFT-500',
            handle: handleStyle === 'profile' ? 'bar' : handleStyle,
            gap: 3,
          });
        }
      } else if (u.open) {
        pb.box(`u-shelf${b}`, 'Open shelf', 'shelf', cx, y0 + uh / 2, zi, bw, t, innerD - 20, { slot: 'interior', edge: 'front', sub });
      } else {
        const hingeLeft = b % 2 === 0;
        const dh = uh - 2 * t - 6;
        const anim = { group: `door-${b}`, kind: 'hinge' as const, pivot: [hingeLeft ? cx - bw / 2 : cx + bw / 2, 0, zFront + 9] as [number, number, number], axis: [0, 1, 0] as [number, number, number], angle: hingeLeft ? -105 : 105 };
        pb.box(`u-door${b}`, `TV unit door ${b + 1}`, 'door', cx, y0 + uh / 2, zFront + 9, bw - 3, dh, 18, { slot: 'shutter', edge: 'all', anim, sub: { kind: 'door', index: b }, hardware: [{ code: 'HG-SOFT-110', qty: 2 }] });
        handleBlock(pb, `u-door${b}-handle`, handleStyle, hingeLeft ? cx + bw / 2 - 30 : cx - bw / 2 + 30, y0 + uh / 2, zFront + 18, 'v', 120, anim, { kind: 'door', index: b });
      }
      bayIndex++;
      bx += bw;
      if (b < bays - 1) {
        addPartition(b, bx + t / 2);
        bx += t;
      }
    }
    void bayIndex;
    if (u.routerCompartment) {
      // vented flap at the top of the cabinet, interior compartment for router / media box
      const rx = cx0 - iw / 2 + 120;
      pb.box('u-router-shelf', 'Router compartment shelf', 'shelf', rx, y0 + uh - t - 110, zi, 220, t, innerD - 20, { slot: 'interior', edge: 'front', sub, ops: ['Drill 3 x Ø25 ventilation holes in rear', 'Provide power-strip cut-out'] });
      pb.box('u-router', 'Router / media box', 'appliance', rx, y0 + uh - t - 110 + t / 2 + 20, zi, 160, 40, 140, { slot: 'appliance', materialOverride: 'metal-black', sheet: false, sub });
    }
    if (p.led.enabled && p.led.under && u.type === 'floating') {
      ledStrip(pb, 'u-led-under', 'Underglow LED', cx0, y0 - 6, zFront - 40, uw - 60, p.led.color, p.led.intensity);
    }
  }

  // Side units
  const buildSide = (which: 'left' | 'right') => {
    const cfg = p.sides[which];
    if (!cfg.enabled) return;
    const sgn = which === 'left' ? -1 : 1;
    const cx = sgn * (W / 2 - cfg.width / 2);
    const sd = Math.min(p.sides.depth, D - pt);
    const zFront = zPanelFront + sd;
    const zc = (zPanelFront + zFront) / 2;
    const sub = { kind: 'section' as const, index: which === 'left' ? 10 : 11 };
    const sh = cfg.height;
    for (const s of [-1, 1]) pb.box(`${which}-side${s}`, `${which} unit side`, 'side', cx + s * (cfg.width / 2 - t / 2), sh / 2, zc, t, sh, sd, { slot: 'carcass', edge: 'front', sub });
    pb.box(`${which}-top`, `${which} unit top`, 'top', cx, sh - t / 2, zc, cfg.width - 2 * t, t, sd, { slot: 'carcass', edge: 'front', sub });
    pb.box(`${which}-bottom`, `${which} unit bottom`, 'bottom', cx, t / 2, zc, cfg.width - 2 * t, t, sd, { slot: 'carcass', edge: 'front', sub });
    if (cfg.kind === 'closed') {
      const dh1 = sh * 0.62;
      const dh2 = sh - dh1 - 4;
      const hingeLeft = which === 'left';
      const hx = hingeLeft ? cx - cfg.width / 2 + 1 : cx + cfg.width / 2 - 1;
      [
        { y: dh1 / 2 + 1, h: dh1 - 3, k: 0 },
        { y: dh1 + dh2 / 2 + 2, h: dh2 - 3, k: 1 },
      ].forEach(({ y, h, k }) => {
        const anim = { group: `${which}-door-${k}`, kind: 'hinge' as const, pivot: [hx, 0, zFront + 9] as [number, number, number], axis: [0, 1, 0] as [number, number, number], angle: hingeLeft ? -105 : 105 };
        pb.box(`${which}-door${k}`, `${which} unit door ${k + 1}`, 'door', cx, y, zFront + 9, cfg.width - 4, h, 18, { slot: 'shutter', edge: 'all', anim, sub: { kind: 'door', index: 20 + (which === 'left' ? 0 : 2) + k }, hardware: [{ code: 'HG-SOFT-110', qty: h > 900 ? 3 : 2 }] });
        handleBlock(pb, `${which}-door${k}-handle`, p.handle, hingeLeft ? cx + cfg.width / 2 - 30 : cx - cfg.width / 2 + 30, k === 0 ? y + h / 2 - 80 : y - h / 2 + 80, zFront + 18, 'v', 120, anim);
      });
      pb.box(`${which}-shelf-in`, `${which} unit shelf`, 'shelf', cx, sh * 0.31, zc, cfg.width - 2 * t, t, sd - 20, { slot: 'interior', edge: 'front', sub });
    } else {
      const n = cfg.kind === 'niche' ? 4 : 5;
      for (let k = 1; k < n; k++) {
        const y = (sh / n) * k;
        pb.box(`${which}-shelf${k}`, `${which} unit shelf ${k}`, 'shelf', cx, y, zc, cfg.width - 2 * t, t, sd - 10, { slot: 'interior', edge: 'front', sub: { kind: 'niche', index: k } });
        if (cfg.kind === 'niche' && p.led.enabled && p.led.niches) {
          ledStrip(pb, `${which}-niche-led${k}`, `Niche LED ${k}`, cx, y - t / 2 - 3, zFront - 30, cfg.width - 2 * t - 40, p.led.color, p.led.intensity);
        }
      }
      pb.box(`${which}-back`, `${which} unit back`, 'back', cx, sh / 2, zPanelFront + 3, cfg.width - 2 * t, sh - 2 * t, 6, { slot: 'accent', grain: 'none', sheet: true });
    }
  };
  buildSide('left');
  buildSide('right');

  // Wall-mounted shelves
  p.shelves.forEach((s, i) => {
    pb.box(`wshelf${i}`, `Wall shelf ${i + 1}`, 'shelf', s.x, s.y + s.t / 2, zPanelFront + s.d / 2, s.w, s.t, s.d, { slot: 'carcass', edge: 'front', sub: { kind: 'shelf', index: i }, hardware: [{ code: 'SP-SHELF-5', qty: 2 }] });
    if (p.led.enabled) ledStrip(pb, `wshelf${i}-led`, `Shelf LED ${i + 1}`, s.x, s.y - 4, zPanelFront + s.d - 20, s.w - 40, p.led.color, p.led.intensity);
  });
  return pb.parts;
}
