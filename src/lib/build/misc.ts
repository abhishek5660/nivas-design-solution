import type { ApplianceParams, BoxParams, CountertopParams, Issue, Part, SceneNode } from '../types';
import { PartBuilder } from './helpers';

// ---------- Countertop (+ backsplash) ----------
export function defaultCountertop(): { size: SceneNode['size']; params: CountertopParams; elevation: number } {
  return { size: { w: 1800, h: 40, d: 620 }, params: { thickness: 40, overhang: 20, backsplashHeight: 450, backsplashThickness: 12 }, elevation: 820 };
}

export function validateCountertop(node: SceneNode): Issue[] {
  const p = node.params as unknown as CountertopParams;
  const out: Issue[] = [];
  if (node.size.w < 200 || node.size.w > 4200) out.push({ level: 'error', field: 'w', message: 'Countertop length must be 200-4200 mm (single slab).' });
  if (node.size.d < 300 || node.size.d > 1400) out.push({ level: 'error', field: 'd', message: 'Countertop depth must be 300-1400 mm.' });
  if (p.thickness < 12 || p.thickness > 80) out.push({ level: 'error', field: 'thickness', message: 'Countertop thickness must be 12-80 mm.' });
  if (p.backsplashHeight < 0 || p.backsplashHeight > 900) out.push({ level: 'error', field: 'backsplashHeight', message: 'Backsplash height must be 0-900 mm.' });
  if (node.size.w > 3000) out.push({ level: 'warning', field: 'w', message: 'Slabs over 3000 mm usually need a joint.' });
  return out;
}

export function buildCountertop(node: SceneNode): Part[] {
  const p = node.params as unknown as CountertopParams;
  const pb = new PartBuilder(node);
  const { w, d } = node.size;
  const ct = p.thickness;
  pb.box('slab', 'Countertop', 'worktop', 0, ct / 2, 0, w, ct, d, { slot: 'top', edge: 'all', ops: ['Polish exposed edges', 'Cut-outs for hob/sink to be marked on site'] });
  if (p.backsplashHeight > 0) {
    pb.box('backsplash', 'Backsplash', 'backsplash', 0, ct + p.backsplashHeight / 2, -d / 2 + p.backsplashThickness / 2, w, p.backsplashHeight, p.backsplashThickness, { slot: 'backsplash', edge: 'none', grain: 'none' });
  }
  return pb.parts;
}

// ---------- Appliances ----------
export const APPLIANCE_DEFAULTS: Record<ApplianceParams['kind'], { label: string; size: SceneNode['size']; elevation: number }> = {
  fridge: { label: 'Refrigerator', size: { w: 700, h: 1800, d: 700 }, elevation: 0 },
  oven: { label: 'Built-in oven', size: { w: 595, h: 595, d: 560 }, elevation: 700 },
  microwave: { label: 'Microwave', size: { w: 500, h: 300, d: 400 }, elevation: 900 },
  hob: { label: 'Hob', size: { w: 600, h: 50, d: 520 }, elevation: 860 },
  chimney: { label: 'Chimney / hood', size: { w: 600, h: 700, d: 480 }, elevation: 1550 },
  dishwasher: { label: 'Dishwasher', size: { w: 600, h: 820, d: 580 }, elevation: 0 },
  sink: { label: 'Sink & faucet', size: { w: 800, h: 250, d: 480 }, elevation: 860 },
  light_strip: { label: 'Under-cabinet light', size: { w: 600, h: 10, d: 25 }, elevation: 1385 },
};

export function defaultAppliance(kind: ApplianceParams['kind']) {
  const d = APPLIANCE_DEFAULTS[kind];
  const params: ApplianceParams = { kind, burners: 4, basins: 1, lightColor: '#ffe2b0' };
  return { size: { ...d.size }, params, elevation: d.elevation };
}

export function validateAppliance(node: SceneNode): Issue[] {
  const { w, h, d } = node.size;
  const out: Issue[] = [];
  if (w < 100 || w > 1200) out.push({ level: 'error', field: 'w', message: 'Appliance width must be 100-1200 mm.' });
  if (h < 5 || h > 2200) out.push({ level: 'error', field: 'h', message: 'Appliance height must be 5-2200 mm.' });
  if (d < 10 || d > 900) out.push({ level: 'error', field: 'd', message: 'Appliance depth must be 10-900 mm.' });
  return out;
}

export function buildAppliance(node: SceneNode): Part[] {
  const p = node.params as unknown as ApplianceParams;
  const pb = new PartBuilder(node);
  const { w, h, d } = node.size;
  const A = { slot: 'appliance' as const, sheet: false };
  switch (p.kind) {
    case 'fridge': {
      pb.box('body', 'Fridge body', 'appliance', 0, h / 2, 0, w, h, d, A);
      pb.box('seam', 'Door split', 'appliance', 0, h * 0.35, d / 2 + 1, w - 4, 6, 2, { slot: 'metal', sheet: false });
      pb.box('handle-top', 'Handle', 'appliance', w / 2 - 50, h * 0.68, d / 2 + 18, 14, h * 0.25, 22, { slot: 'metal', sheet: false });
      pb.box('handle-bottom', 'Handle', 'appliance', w / 2 - 50, h * 0.2, d / 2 + 18, 14, h * 0.2, 22, { slot: 'metal', sheet: false });
      break;
    }
    case 'oven': {
      pb.box('body', 'Oven body', 'appliance', 0, h / 2, 0, w, h, d, A);
      pb.box('glass', 'Oven window', 'appliance', 0, h * 0.42, d / 2 + 1, w * 0.72, h * 0.5, 3, { slot: 'glass', sheet: false });
      pb.box('handle', 'Oven handle', 'appliance', 0, h * 0.82, d / 2 + 25, w * 0.7, 14, 14, { slot: 'metal', sheet: false });
      break;
    }
    case 'microwave': {
      pb.box('body', 'Microwave body', 'appliance', 0, h / 2, 0, w, h, d, A);
      pb.box('glass', 'Door glass', 'appliance', -w * 0.12, h / 2, d / 2 + 1, w * 0.6, h * 0.75, 3, { slot: 'glass', sheet: false });
      pb.box('panel', 'Control panel', 'appliance', w * 0.36, h / 2, d / 2 + 1, w * 0.2, h * 0.75, 3, { slot: 'metal', sheet: false });
      break;
    }
    case 'hob': {
      pb.box('plate', 'Hob glass', 'appliance', 0, h / 2, 0, w, h, d, { slot: 'accent', sheet: false, materialOverride: 'sc-black' });
      const n = Math.max(1, Math.min(6, p.burners));
      const cols = n <= 2 ? n : n <= 4 ? 2 : 3;
      const rows = Math.ceil(n / cols);
      for (let i = 0; i < n; i++) {
        const c = i % cols;
        const r = Math.floor(i / cols);
        const x = ((c + 0.5) / cols - 0.5) * w * 0.8;
        const z = ((r + 0.5) / rows - 0.5) * d * 0.7;
        pb.cyl(`burner${i}`, `Burner ${i + 1}`, 'appliance', x, h + 2, z, Math.min(w / cols, d / rows) * 0.55, 4, 'y', { slot: 'metal' });
      }
      break;
    }
    case 'chimney': {
      const hoodH = h * 0.35;
      pb.box('hood', 'Hood', 'appliance', 0, hoodH / 2, 0, w, hoodH, d, A);
      pb.box('glass', 'Hood glass', 'appliance', 0, hoodH + 2, d * 0.05, w * 0.9, 4, d * 0.9, { slot: 'glass', sheet: false });
      pb.box('duct', 'Duct cover', 'appliance', 0, hoodH + (h - hoodH) / 2, -d * 0.1, w * 0.4, h - hoodH, d * 0.45, A);
      break;
    }
    case 'dishwasher': {
      pb.box('body', 'Dishwasher front', 'appliance', 0, h / 2, 0, w - 2, h, d, A);
      pb.box('handle', 'Handle', 'appliance', 0, h - 80, d / 2 + 18, w * 0.6, 14, 14, { slot: 'metal', sheet: false });
      break;
    }
    case 'sink': {
      const bw = w / Math.max(1, p.basins);
      const bd = d - 60;
      pb.box('rim', 'Sink rim', 'appliance', 0, 3, 0, w, 6, d, { slot: 'metal', sheet: false });
      for (let i = 0; i < p.basins; i++) {
        const x = -w / 2 + bw * (i + 0.5);
        pb.box(`basin${i}`, `Basin ${i + 1}`, 'appliance', x, -h / 2 + 6, 0, bw - 40, h, bd, { slot: 'metal', sheet: false });
        pb.box(`basin-in${i}`, `Basin inner ${i + 1}`, 'appliance', x, 5, 0, bw - 70, 2, bd - 30, { slot: 'accent', materialOverride: 'metal-black', sheet: false });
      }
      pb.cyl('faucet-base', 'Faucet', 'appliance', 0, 120, -d / 2 + 40, 40, 240, 'y', { slot: 'metal', hardware: [{ code: 'SCREW-PACK', qty: 1 }] });
      pb.cyl('faucet-arm', 'Faucet spout', 'appliance', 0, 240, -d / 2 + 110, 24, 160, 'z', { slot: 'metal' });
      break;
    }
    case 'light_strip': {
      pb.box('strip', 'Under-cabinet LED', 'led', 0, h / 2, 0, w, h, d, { slot: 'led', sheet: false, light: { color: p.lightColor, intensity: 1 }, hardware: [{ code: 'LED-STRIP-WW', qty: w / 1000 }, { code: 'LED-DRIVER', qty: 1 }] });
      break;
    }
  }
  return pb.parts;
}

// ---------- Free-form box (custom furniture) ----------
export function defaultBox(): { size: SceneNode['size']; params: BoxParams } {
  return { size: { w: 600, h: 400, d: 400 }, params: { shape: 'box', solid: true } };
}

export function validateBox(node: SceneNode): Issue[] {
  const { w, h, d } = node.size;
  const out: Issue[] = [];
  for (const [k, v] of [['w', w], ['h', h], ['d', d]] as const) {
    if (!(v >= 5 && v <= 6000)) out.push({ level: 'error', field: k, message: 'Dimensions must be 5-6000 mm.' });
  }
  return out;
}

export function buildBox(node: SceneNode): Part[] {
  const p = node.params as unknown as BoxParams;
  const pb = new PartBuilder(node);
  const { w, h, d } = node.size;
  if (p.shape === 'cylinder') pb.cyl('body', 'Cylinder', 'panel', 0, h / 2, 0, Math.min(w, d), h, 'y', { slot: 'carcass' });
  else pb.box('body', 'Panel / block', 'panel', 0, h / 2, 0, w, h, d, { slot: 'carcass', edge: 'all', sheet: Math.min(w, h, d) <= 60 });
  return pb.parts;
}
