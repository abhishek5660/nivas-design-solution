import type { HardwareDef, MaterialDef, Slot, TextureKind } from './types';

const m = (
  id: string,
  name: string,
  category: string,
  color: string,
  roughness: number,
  metalness: number,
  texture: TextureKind = 'none',
  extra: Partial<MaterialDef> = {},
): MaterialDef => ({
  id,
  name,
  category,
  color,
  roughness,
  metalness,
  texture,
  textureScale: 1,
  source: 'sample',
  verified: false,
  ...extra,
});

/** Built-in SAMPLE materials. None of these are manufacturer-verified products. */
export const SAMPLE_MATERIALS: MaterialDef[] = [
  m('wood-oak', 'Natural Oak', 'Natural wood', '#c9a37a', 0.55, 0, 'wood_oak'),
  m('wood-walnut', 'American Walnut', 'Natural wood', '#6b4a33', 0.5, 0, 'wood_walnut'),
  m('wood-teak', 'Burma Teak', 'Natural wood', '#a9753f', 0.55, 0, 'wood_teak'),
  m('wood-ash', 'Pale Ash', 'Natural wood', '#dccdb4', 0.6, 0, 'wood_ash'),
  m('lam-oak', 'Oak Laminate', 'Laminate', '#bf9a6f', 0.6, 0, 'laminate_grain'),
  m('lam-greywood', 'Grey Wood Laminate', 'Laminate', '#8d8982', 0.65, 0, 'laminate_grain'),
  m('lam-white-matte', 'White Matte Laminate', 'Matte', '#f1eee8', 0.85, 0),
  m('lam-white-gloss', 'White High-Gloss', 'Glossy', '#f6f4f0', 0.12, 0),
  m('lam-charcoal-matte', 'Charcoal Matte', 'Matte', '#3a3b3e', 0.8, 0),
  m('lam-charcoal-gloss', 'Charcoal Gloss', 'Glossy', '#2c2d30', 0.1, 0),
  m('sc-sage', 'Sage Green', 'Solid colour', '#8a9a7e', 0.75, 0),
  m('sc-navy', 'Midnight Navy', 'Solid colour', '#26334a', 0.7, 0),
  m('sc-beige', 'Warm Beige', 'Solid colour', '#d8c8b0', 0.8, 0),
  m('sc-terracotta', 'Terracotta', 'Solid colour', '#b4684a', 0.8, 0),
  m('sc-grey', 'Soft Grey', 'Solid colour', '#b9b9b6', 0.8, 0),
  m('sc-black', 'Jet Black', 'Solid colour', '#18181a', 0.7, 0),
  m('marble-carrara', 'Carrara Marble Look', 'Marble-look', '#ececea', 0.2, 0, 'marble'),
  m('marble-nero', 'Nero Marquina Look', 'Marble-look', '#1c1c1e', 0.18, 0, 'marble'),
  m('marble-emperador', 'Emperador Look', 'Marble-look', '#7a5a45', 0.22, 0, 'marble'),
  m('stone-granite', 'Black Galaxy Granite Look', 'Stone', '#2b2b2e', 0.3, 0, 'stone'),
  m('stone-quartz', 'Quartz Worktop', 'Stone', '#d9d6d0', 0.28, 0, 'stone'),
  m('stone-slate', 'Slate Texture', 'Stone', '#5c5f62', 0.8, 0, 'stone'),
  m('deco-fluted-oak', 'Fluted Oak Panel', 'Decorative', '#c0996c', 0.6, 0, 'fluted'),
  m('deco-fluted-walnut', 'Fluted Walnut Panel', 'Decorative', '#6b4a33', 0.55, 0, 'fluted'),
  m('deco-slat-oak', 'Oak Wood Slats', 'Decorative', '#c9a37a', 0.6, 0, 'slat'),
  m('deco-fabric-grey', 'Acoustic Fabric Grey', 'Decorative', '#8c8f94', 0.95, 0, 'fabric'),
  m('metal-brass', 'Brushed Brass', 'Metal', '#c4a15a', 0.35, 1, 'brushed_metal'),
  m('metal-steel', 'Stainless Steel', 'Metal', '#c7c9cc', 0.3, 1, 'brushed_metal'),
  m('metal-black', 'Matte Black Metal', 'Metal', '#202022', 0.45, 0.9),
  m('metal-chrome', 'Polished Chrome', 'Metal', '#e3e5e8', 0.08, 1),
  m('glass-clear', 'Clear Glass', 'Glass', '#cfe6ee', 0.03, 0, 'none', { opacity: 0.28 }),
  m('glass-smoked', 'Smoked Glass', 'Glass', '#3b4247', 0.04, 0, 'none', { opacity: 0.45 }),
  m('glass-fluted', 'Reeded Glass', 'Glass', '#dcecef', 0.12, 0, 'none', { opacity: 0.4 }),
  m('mirror', 'Mirror', 'Mirror', '#e8eef2', 0.02, 1),
  m('mirror-bronze', 'Bronze Mirror', 'Mirror', '#a38b79', 0.03, 1),
  m('floor-oak', 'Oak Parquet Floor', 'Floor', '#b58d62', 0.5, 0, 'wood_oak', { textureScale: 3 }),
  m('floor-tile', 'Porcelain Tile', 'Floor', '#d9d7d1', 0.35, 0, 'stone', { textureScale: 3 }),
  m('wall-white', 'Wall Paint White', 'Wall', '#f4f1ec', 0.95, 0),
  m('wall-greige', 'Wall Paint Greige', 'Wall', '#d3cabb', 0.95, 0),
  m('led-warm', 'LED Warm White', 'Light', '#ffd9a0', 0.4, 0, 'none', { emissive: '#ffcf8a' }),
];

export const SLOT_FALLBACK: Record<Slot, string> = {
  carcass: 'lam-white-matte',
  interior: 'lam-white-matte',
  shutter: 'wood-oak',
  handle: 'metal-brass',
  top: 'stone-quartz',
  backsplash: 'marble-carrara',
  back: 'lam-white-matte',
  glass: 'glass-clear',
  mirror: 'mirror',
  metal: 'metal-steel',
  accent: 'deco-fluted-walnut',
  appliance: 'metal-steel',
  led: 'led-warm',
};

export const MATERIAL_CATEGORIES = Array.from(new Set(SAMPLE_MATERIALS.map((x) => x.category)));

export function materialIndex(extra: MaterialDef[] = []): Map<string, MaterialDef> {
  const map = new Map<string, MaterialDef>();
  for (const x of SAMPLE_MATERIALS) map.set(x.id, x);
  for (const x of extra) map.set(x.id, x);
  return map;
}

const h = (
  code: string,
  name: string,
  category: HardwareDef['category'],
  unit: HardwareDef['unit'],
  spec: string,
): HardwareDef => ({ code, name, category, unit, spec, source: 'sample', verified: false });

/** Built-in SAMPLE hardware. None are manufacturer-verified. */
export const SAMPLE_HARDWARE: HardwareDef[] = [
  h('H-BAR-160', 'Bar handle 160 mm', 'handle', 'each', 'Aluminium, 160 mm c/c'),
  h('H-BAR-320', 'Bar handle 320 mm', 'handle', 'each', 'Aluminium, 320 mm c/c'),
  h('H-KNOB-30', 'Round knob 30 mm', 'handle', 'each', 'Brass, 30 mm'),
  h('H-PROFILE-J', 'J-profile (handleless) per m', 'handle', 'm', 'Aluminium J-profile'),
  h('HG-SOFT-110', 'Soft-close hinge 110 deg', 'hinge', 'each', 'Clip-on, soft-close, 110 deg opening'),
  h('HG-LIFT', 'Lift-up stay (loft)', 'hinge', 'pair', 'Gas lift stay for loft shutters'),
  h('RN-BALL-450', 'Ball-bearing runner 450 mm', 'runner', 'pair', 'Full extension, 450 mm'),
  h('RN-SOFT-500', 'Soft-close runner 500 mm', 'runner', 'pair', 'Concealed soft-close, 500 mm'),
  h('SL-TRACK-2', 'Sliding system, 2-track', 'sliding', 'set', 'Top-hung 2 track, soft stop'),
  h('SL-TRACK-3', 'Sliding system, 3-track', 'sliding', 'set', 'Top-hung 3 track, soft stop'),
  h('SL-PROFILE', 'Sliding door frame profile', 'sliding', 'm', 'Aluminium frame profile'),
  h('LG-ADJ-100', 'Adjustable cabinet leg 100 mm', 'leg', 'each', 'ABS + steel stem, 100 mm'),
  h('LED-STRIP-WW', 'LED strip, warm white, per m', 'led', 'm', '12V, 3000K, 9.6 W/m'),
  h('LED-PROFILE', 'LED aluminium profile per m', 'led', 'm', 'Recessed profile with diffuser'),
  h('LED-SENSOR', 'Door / motion sensor switch', 'led', 'each', 'PIR sensor with driver'),
  h('LED-DRIVER', 'LED driver 12V 60W', 'led', 'each', 'Constant voltage'),
  h('SP-SHELF-5', 'Shelf support pin 5 mm', 'support', 'each', 'Steel pin'),
  h('ROD-OVAL', 'Hanging rod, oval', 'other', 'm', 'Aluminium, 30x15 mm'),
  h('ROD-BRACKET', 'Rod bracket pair', 'other', 'pair', 'Zinc alloy'),
  h('CAM-LOCK', 'Cam lock + dowel set', 'other', 'set', 'Carcass connectors'),
  h('SCREW-PACK', 'Fixing screws (pack)', 'other', 'set', 'Assorted'),
];

export function hardwareIndex(extra: HardwareDef[] = []): Map<string, HardwareDef> {
  const map = new Map<string, HardwareDef>();
  for (const x of SAMPLE_HARDWARE) map.set(x.code, x);
  for (const x of extra) map.set(x.code, x);
  return map;
}

/**
 * Illustrative starter rate card. These are PLACEHOLDER numbers for demonstration only -
 * they are not supplier prices. Users must replace them; the BOQ labels everything as an estimate.
 * Keys: `mat:<materialId>` (per m2 of sheet area), `hw:<code>` (per unit).
 */
export const ILLUSTRATIVE_RATES: Record<string, number> = {
  'mat:lam-white-matte': 2200,
  'mat:lam-white-gloss': 3200,
  'mat:lam-charcoal-matte': 2600,
  'mat:lam-charcoal-gloss': 3400,
  'mat:lam-oak': 2800,
  'mat:lam-greywood': 2800,
  'mat:wood-oak': 5200,
  'mat:wood-walnut': 6800,
  'mat:wood-teak': 6000,
  'mat:wood-ash': 4800,
  'mat:deco-fluted-oak': 5600,
  'mat:deco-fluted-walnut': 6400,
  'mat:deco-slat-oak': 5200,
  'mat:marble-carrara': 9000,
  'mat:marble-nero': 9500,
  'mat:stone-quartz': 8500,
  'mat:stone-granite': 6500,
  'mat:mirror': 2400,
  'mat:glass-clear': 2800,
  'hw:H-BAR-160': 180,
  'hw:H-BAR-320': 260,
  'hw:H-KNOB-30': 120,
  'hw:HG-SOFT-110': 140,
  'hw:RN-BALL-450': 520,
  'hw:RN-SOFT-500': 780,
  'hw:SL-TRACK-2': 5200,
  'hw:SL-TRACK-3': 7400,
  'hw:LG-ADJ-100': 60,
  'hw:LED-STRIP-WW': 650,
  'hw:LED-SENSOR': 420,
  'hw:LED-DRIVER': 900,
  'hw:ROD-OVAL': 420,
  'hw:ROD-BRACKET': 90,
  'hw:SP-SHELF-5': 4,
  'hw:CAM-LOCK': 60,
  'hw:H-PROFILE-J': 780,
  'hw:HG-LIFT': 650,
};
