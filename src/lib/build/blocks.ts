import type { Part, PartAnim } from '../types';
import { PartBuilder, round, runnerFor } from './helpers';

export type HandleStyle = 'bar' | 'knob' | 'profile' | 'none';

/**
 * Handle on the +Z face of a front. `faceZ` is the z of the outer face of the front.
 * `orient` h = horizontal bar (drawers), v = vertical bar (doors).
 */
export function handleBlock(
  pb: PartBuilder,
  key: string,
  style: HandleStyle,
  x: number,
  y: number,
  faceZ: number,
  orient: 'h' | 'v',
  length: number,
  anim?: PartAnim,
  sub?: Part['sub'],
  barCode = 'H-BAR-160',
) {
  if (style === 'none') return;
  if (style === 'bar') {
    const len = Math.min(Math.max(length, 96), 320);
    const code = len > 200 ? 'H-BAR-320' : barCode;
    if (orient === 'v') pb.box(key, 'Handle', 'hardware', x, y, faceZ + 12, 12, len, 12, { slot: 'handle', anim, sub, hardware: [{ code, qty: 1 }], sheet: false });
    else pb.box(key, 'Handle', 'hardware', x, y, faceZ + 12, len, 12, 12, { slot: 'handle', anim, sub, hardware: [{ code, qty: 1 }], sheet: false });
  } else if (style === 'knob') {
    pb.cyl(key, 'Knob', 'hardware', x, y, faceZ + 11, 30, 22, 'z', { slot: 'handle', anim, sub, hardware: [{ code: 'H-KNOB-30', qty: 1 }] });
  } else if (style === 'profile') {
    // J-profile: runs the full length of the free edge, handleless look
    const len = orient === 'v' ? length : length;
    if (orient === 'v') pb.box(key, 'J-profile', 'hardware', x, y, faceZ + 5, 14, len, 14, { slot: 'handle', anim, sub, hardware: [{ code: 'H-PROFILE-J', qty: len / 1000 }], sheet: false });
    else pb.box(key, 'J-profile', 'hardware', x, y, faceZ + 5, len, 14, 14, { slot: 'handle', anim, sub, hardware: [{ code: 'H-PROFILE-J', qty: len / 1000 }], sheet: false });
  }
}

export interface DrawerOpts {
  key: string; // unique prefix
  label: string;
  cx: number; // centre x of the opening
  width: number; // opening width
  yBottom: number; // bottom of the front
  height: number; // front height
  frontZ: number; // centre z of the front panel
  frontT: number; // front thickness
  depthAvail: number; // interior depth available behind the front
  group: string;
  sub?: Part['sub'];
  runner: string;
  handle: HandleStyle;
  barHandle?: string;
  gap?: number;
  frontMaterial?: string;
  external?: boolean; // front is overlay on carcass
}

/** Builds a complete drawer (front, sides, back, bottom) with slide animation and handle. */
export function drawerBlock(pb: PartBuilder, o: DrawerOpts) {
  const gap = o.gap ?? 2;
  const boxD = runnerFor(o.depthAvail - 30);
  const anim: PartAnim = { group: o.group, kind: 'slide', slide: [0, 0, 1], distance: Math.round(boxD * 0.85) };
  const fw = o.width - 2 * gap;
  const fh = o.height - gap * 1.5;
  const fy = o.yBottom + o.height / 2;
  pb.box(`${o.key}-front`, `${o.label} front`, 'drawer_front', o.cx, fy, o.frontZ, fw, fh, o.frontT, {
    edge: 'all',
    anim,
    sub: o.sub,
    hardware: [{ code: o.runner, qty: 1 }],
    materialOverride: o.frontMaterial,
    ops: ['Drill 2x Ø8 dowel holes (rear face) for box connection', 'Mount runner brackets per runner datasheet'],
  });
  const bw = Math.max(o.width - 26, 100);
  const sh = Math.max(Math.min(o.height - 40, 180), 50);
  const sy = o.yBottom + 20 + sh / 2;
  const zc = o.frontZ - o.frontT / 2 - boxD / 2;
  const st = 12;
  for (const sgn of [-1, 1]) {
    pb.box(`${o.key}-side${sgn}`, `${o.label} side`, 'drawer_part', o.cx + sgn * (bw / 2 - st / 2), sy, zc, st, sh, boxD, { anim, sub: o.sub, edge: 'none' });
  }
  pb.box(`${o.key}-back`, `${o.label} back`, 'drawer_part', o.cx, sy, zc - boxD / 2 + st / 2, bw - 2 * st, sh, st, { anim, sub: o.sub });
  pb.box(`${o.key}-base`, `${o.label} base`, 'drawer_part', o.cx, o.yBottom + 20 + 3, zc, bw - 2 * st, 6, boxD - st, { anim, sub: o.sub, grain: 'width' });
  const hl = Math.min(Math.max(fw * 0.4, 96), 320);
  handleBlock(pb, `${o.key}-handle`, o.handle, o.cx, fy + (o.handle === 'profile' ? fh / 2 - 8 : 0), o.frontZ + o.frontT / 2, 'h', o.handle === 'profile' ? fw : hl, anim, o.sub, o.barHandle);
  return { boxD };
}

export function ledStrip(
  pb: PartBuilder,
  key: string,
  label: string,
  x: number,
  y: number,
  z: number,
  length: number,
  color: string,
  intensity: number,
  axis: 'x' | 'y' = 'x',
  sub?: Part['sub'],
) {
  const sx = axis === 'x' ? length : 8;
  const sy = axis === 'x' ? 6 : length;
  pb.box(key, label, 'led', x, y, z, sx, sy, 8, {
    slot: 'led',
    sheet: false,
    sub,
    light: { color, intensity },
    hardware: [{ code: 'LED-STRIP-WW', qty: round(length / 1000, 3) }],
  });
}
