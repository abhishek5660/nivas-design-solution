import type { Issue, MaterialAssign, Part, SceneNode } from '../types';
import { PartBuilder } from './helpers';

export interface FurnitureItem {
  id: string;
  label: string;
  category: 'Bedroom' | 'Living' | 'Dining' | 'Office' | 'Bathroom' | 'Utility' | 'Decor';
  size: { w: number; d: number; h: number };
  materials: MaterialAssign;
  build: (pb: PartBuilder, w: number, d: number, h: number) => void;
}

const WOOD: MaterialAssign = { carcass: 'wood-walnut', top: 'wood-oak', accent: 'deco-fabric-grey', metal: 'metal-black', glass: 'glass-clear', appliance: 'lam-white-gloss' };
const box = (pb: PartBuilder, key: string, label: string, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, slot: Part['slot'] = 'carcass') =>
  pb.box(key, label, 'panel', cx, cy, cz, sx, sy, sz, { slot, sheet: false });

function bed(pb: PartBuilder, w: number, d: number, h: number) {
  const legH = 120;
  box(pb, 'frame', 'Bed frame', 0, legH + 90, 0, w, 180, d, 'carcass');
  box(pb, 'mattress', 'Mattress', 0, legH + 180 + 110, 40, w - 60, 220, d - 140, 'accent');
  box(pb, 'headboard', 'Headboard', 0, legH + 450, -d / 2 + 30, w, 900 - legH, 60, 'carcass');
  const pw = Math.min(650, (w - 160) / 2);
  for (const s of [-1, 1]) box(pb, `pillow${s}`, 'Pillow', (s * (pw + 40)) / 2 + (s * pw) / 2 - (s * pw) / 2, legH + 180 + 220 + 70, -d / 2 + 260, pw, 120, 380, 'accent');
  void h;
}

function sofa(seats: number) {
  return (pb: PartBuilder, w: number, d: number, h: number) => {
    const arm = 180;
    box(pb, 'base', 'Base', 0, 190, 0, w, 220, d, 'carcass');
    box(pb, 'back', 'Back', 0, h / 2 + 100, -d / 2 + 110, w, h - 200, 220, 'accent');
    for (const s of [-1, 1]) box(pb, `arm${s}`, 'Arm', s * (w / 2 - arm / 2), 420, 0, arm, 420, d, 'accent');
    const sw = (w - 2 * arm) / seats;
    for (let i = 0; i < seats; i++) box(pb, `seat${i}`, 'Seat cushion', -w / 2 + arm + sw * (i + 0.5), 400, 70, sw - 20, 160, d - 260, 'accent');
  };
}

function table(legs = 4) {
  return (pb: PartBuilder, w: number, d: number, h: number) => {
    box(pb, 'top', 'Table top', 0, h - 20, 0, w, 40, d, 'top');
    const lw = 60;
    const pts: [number, number][] = legs === 4 ? [[-1, -1], [1, -1], [1, 1], [-1, 1]] : [];
    pts.forEach(([x, z], i) => box(pb, `leg${i}`, 'Leg', x * (w / 2 - 70), (h - 40) / 2, z * (d / 2 - 70), lw, h - 40, lw, 'carcass'));
  };
}

function chair(pb: PartBuilder, w: number, d: number, h: number) {
  const seatH = 450;
  box(pb, 'seat', 'Seat', 0, seatH, 0, w, 50, d, 'accent');
  box(pb, 'back', 'Back', 0, seatH + (h - seatH) / 2, -d / 2 + 20, w, h - seatH, 40, 'accent');
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) box(pb, `leg${x}${z}`, 'Leg', x * (w / 2 - 30), (seatH - 25) / 2, z * (d / 2 - 30), 40, seatH - 25, 40, 'carcass');
}

function chest(doors: boolean) {
  return (pb: PartBuilder, w: number, d: number, h: number) => {
    box(pb, 'body', 'Body', 0, h / 2, 0, w, h, d, 'carcass');
    const n = doors ? 2 : 3;
    for (let i = 0; i < n; i++) {
      const fw = doors ? w / 2 - 10 : w - 30;
      const fh = doors ? h - 40 : (h - 40) / 3 - 10;
      box(pb, `front${i}`, 'Front', doors ? (i - 0.5) * (w / 2) : 0, doors ? h / 2 : 25 + fh / 2 + i * (fh + 10), d / 2 + 8, fw, fh, 16, 'top');
      pb.box(`knob${i}`, 'Handle', 'hardware', doors ? (i - 0.5) * (w / 2) + (i ? -40 : 40) : 0, doors ? h / 2 : 25 + fh / 2 + i * (fh + 10), d / 2 + 30, 16, 120, 16, { slot: 'metal', sheet: false });
    }
  };
}

const ITEMS: FurnitureItem[] = [
  { id: 'bed_double', label: 'Double bed', category: 'Bedroom', size: { w: 1600, d: 2100, h: 1000 }, materials: WOOD, build: bed },
  { id: 'bed_single', label: 'Single bed', category: 'Bedroom', size: { w: 1000, d: 2000, h: 900 }, materials: WOOD, build: bed },
  { id: 'nightstand', label: 'Bedside table', category: 'Bedroom', size: { w: 450, d: 400, h: 500 }, materials: WOOD, build: chest(false) },
  { id: 'dresser', label: 'Chest of drawers', category: 'Bedroom', size: { w: 1200, d: 480, h: 850 }, materials: WOOD, build: chest(false) },
  { id: 'sofa3', label: 'Sofa, 3-seater', category: 'Living', size: { w: 2100, d: 900, h: 850 }, materials: WOOD, build: sofa(3) },
  { id: 'sofa2', label: 'Sofa, 2-seater', category: 'Living', size: { w: 1600, d: 900, h: 850 }, materials: WOOD, build: sofa(2) },
  { id: 'armchair', label: 'Armchair', category: 'Living', size: { w: 900, d: 900, h: 850 }, materials: WOOD, build: sofa(1) },
  { id: 'coffee_table', label: 'Coffee table', category: 'Living', size: { w: 1000, d: 600, h: 400 }, materials: WOOD, build: table() },
  { id: 'tv_console', label: 'TV console', category: 'Living', size: { w: 1500, d: 400, h: 450 }, materials: WOOD, build: chest(true) },
  { id: 'dining_table', label: 'Dining table', category: 'Dining', size: { w: 1600, d: 900, h: 750 }, materials: WOOD, build: table() },
  { id: 'dining_chair', label: 'Dining chair', category: 'Dining', size: { w: 450, d: 450, h: 900 }, materials: WOOD, build: chair },
  { id: 'sideboard', label: 'Sideboard', category: 'Dining', size: { w: 1600, d: 450, h: 850 }, materials: WOOD, build: chest(true) },
  { id: 'desk', label: 'Desk', category: 'Office', size: { w: 1400, d: 700, h: 750 }, materials: WOOD, build: table() },
  {
    id: 'office_chair',
    label: 'Office chair',
    category: 'Office',
    size: { w: 600, d: 600, h: 950 },
    materials: WOOD,
    build(pb, w, d, h) {
      pb.cyl('base', 'Base', 'panel', 0, 60, 0, Math.min(w, d), 40, 'y', { slot: 'metal' });
      pb.cyl('column', 'Column', 'panel', 0, 230, 0, 60, 330, 'y', { slot: 'metal' });
      box(pb, 'seat', 'Seat', 0, 440, 0, w - 100, 80, d - 100, 'accent');
      box(pb, 'back', 'Back', 0, 700, -d / 2 + 70, w - 120, 450, 60, 'accent');
      void h;
    },
  },
  {
    id: 'bathtub',
    label: 'Bathtub',
    category: 'Bathroom',
    size: { w: 1700, d: 750, h: 550 },
    materials: WOOD,
    build(pb, w, d, h) {
      box(pb, 'shell', 'Tub', 0, h / 2, 0, w, h, d, 'appliance');
      box(pb, 'basin', 'Basin', 0, h - 4, 0, w - 160, 8, d - 160, 'metal');
    },
  },
  {
    id: 'toilet',
    label: 'Toilet',
    category: 'Bathroom',
    size: { w: 400, d: 700, h: 800 },
    materials: WOOD,
    build(pb, w, d, h) {
      box(pb, 'tank', 'Cistern', 0, h - 200, -d / 2 + 90, w, 400, 180, 'appliance');
      box(pb, 'bowl', 'Bowl', 0, 200, 60, w - 40, 400, d - 220, 'appliance');
    },
  },
  {
    id: 'basin',
    label: 'Wash basin',
    category: 'Bathroom',
    size: { w: 600, d: 450, h: 850 },
    materials: WOOD,
    build(pb, w, d, h) {
      box(pb, 'ped', 'Pedestal', 0, (h - 160) / 2, -d / 2 + 90, 160, h - 160, 160, 'appliance');
      box(pb, 'bowl', 'Basin', 0, h - 80, 0, w, 160, d, 'appliance');
    },
  },
  {
    id: 'shower',
    label: 'Shower enclosure',
    category: 'Bathroom',
    size: { w: 900, d: 900, h: 2000 },
    materials: WOOD,
    build(pb, w, d, h) {
      box(pb, 'tray', 'Tray', 0, 50, 0, w, 100, d, 'appliance');
      for (const [x, z, sx, sz] of [[0, d / 2 - 4, w, 8], [w / 2 - 4, 0, 8, d]] as [number, number, number, number][]) box(pb, `glass${x}`, 'Glass', x, h / 2 + 50, z, sx, h - 100, sz, 'glass');
    },
  },
  {
    id: 'washing_machine',
    label: 'Washing machine',
    category: 'Utility',
    size: { w: 600, d: 600, h: 850 },
    materials: WOOD,
    build(pb, w, d, h) {
      box(pb, 'body', 'Body', 0, h / 2, 0, w, h, d, 'appliance');
      pb.cyl('door', 'Door', 'appliance', 0, h * 0.5, d / 2 + 3, w * 0.55, 6, 'z', { slot: 'glass' });
    },
  },
  { id: 'rug', label: 'Rug', category: 'Decor', size: { w: 2000, d: 1400, h: 15 }, materials: WOOD, build: (pb, w, d, h) => box(pb, 'rug', 'Rug', 0, h / 2, 0, w, h, d, 'accent') },
  {
    id: 'plant',
    label: 'Potted plant',
    category: 'Decor',
    size: { w: 400, d: 400, h: 900 },
    materials: { ...WOOD, accent: 'sc-sage' },
    build(pb, w, d, h) {
      pb.cyl('pot', 'Pot', 'panel', 0, 150, 0, Math.min(w, d) * 0.8, 300, 'y', { slot: 'carcass' });
      pb.cyl('foliage', 'Foliage', 'panel', 0, 300 + (h - 300) / 2, 0, Math.min(w, d), h - 300, 'y', { slot: 'accent' });
    },
  },
];

export const FURNITURE: FurnitureItem[] = ITEMS;
export const furnitureById = (id: string) => ITEMS.find((i) => i.id === id);
export const FURNITURE_CATEGORIES = Array.from(new Set(ITEMS.map((i) => i.category)));

export function buildFurniture(node: SceneNode): Part[] {
  const kind = (node.params as { kind?: string }).kind ?? '';
  const item = furnitureById(kind);
  const pb = new PartBuilder(node);
  const { w, d, h } = node.size;
  if (item) item.build(pb, w, d, h);
  else pb.box('body', 'Furniture', 'panel', 0, h / 2, 0, w, h, d, { slot: 'carcass', sheet: false });
  return pb.parts;
}

export function validateFurniture(node: SceneNode): Issue[] {
  const { w, h, d } = node.size;
  const out: Issue[] = [];
  for (const [k, v] of [['w', w], ['h', h], ['d', d]] as const) if (!(v >= 10 && v <= 8000)) out.push({ level: 'error', field: k, message: 'Furniture dimensions must be between 10 and 8000 mm.' });
  return out;
}
