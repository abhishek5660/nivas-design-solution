// Core domain types for NIVAS DESIGN SOLUTION.
// All lengths are millimetres. Rotations are degrees about the vertical (Y) axis.
// Coordinate system: X = east/width, Y = up, Z = south/depth. A node's local origin is the
// centre of its footprint at floor level; its "front" faces +Z.

export type Vec3 = [number, number, number];

import type { PlanModel } from './plan/types';

export type Category = 'WARDROBE' | 'KITCHEN' | 'TV_PANEL' | 'CUSTOM';

export type NodeType =
  | 'wardrobe'
  | 'cabinet' // all kitchen/custom cabinets, variant in params
  | 'countertop'
  | 'appliance'
  | 'tv_panel'
  | 'box' // free-form primitive for custom furniture
  | 'model' // imported GLB asset
  | 'furniture' // generic furniture (bed, sofa, table ...) from the Furnish library
  | 'group';

export type Slot =
  | 'carcass'
  | 'interior'
  | 'shutter'
  | 'handle'
  | 'top' // countertop / worktop
  | 'backsplash'
  | 'back'
  | 'glass'
  | 'mirror'
  | 'metal'
  | 'accent' // decorative panels
  | 'appliance'
  | 'led';

export const SLOTS: { slot: Slot; label: string }[] = [
  { slot: 'carcass', label: 'Carcass' },
  { slot: 'interior', label: 'Interior' },
  { slot: 'shutter', label: 'Shutters' },
  { slot: 'handle', label: 'Handles' },
  { slot: 'top', label: 'Countertop' },
  { slot: 'backsplash', label: 'Backsplash' },
  { slot: 'back', label: 'Back panel' },
  { slot: 'accent', label: 'Decor panel' },
  { slot: 'glass', label: 'Glass' },
  { slot: 'mirror', label: 'Mirror' },
  { slot: 'metal', label: 'Metal parts' },
  { slot: 'appliance', label: 'Appliance body' },
];

export type MaterialAssign = Partial<Record<Slot, string>>;

export type TextureKind =
  | 'none'
  | 'wood_oak'
  | 'wood_walnut'
  | 'wood_teak'
  | 'wood_ash'
  | 'marble'
  | 'stone'
  | 'fluted'
  | 'slat'
  | 'laminate_grain'
  | 'brushed_metal'
  | 'fabric'
  | 'image'; // uploaded image, textureUrl required

export interface MaterialDef {
  id: string;
  name: string;
  category: string;
  color: string; // base colour hex
  roughness: number; // 0..1
  metalness: number; // 0..1
  opacity?: number; // 0..1 (glass)
  texture: TextureKind;
  textureUrl?: string;
  textureScale: number; // 1 = default repeat
  emissive?: string;
  source: 'sample' | 'custom';
  verified: boolean; // manufacturer-verified? sample assets are always false
  catalogId?: string; // DB id for custom materials
  rate?: { unit: 'm2' | 'each'; price: number }; // optional indicative price
}

export interface HardwareDef {
  code: string;
  name: string;
  category: 'handle' | 'hinge' | 'runner' | 'sliding' | 'leg' | 'led' | 'support' | 'other';
  unit: 'each' | 'pair' | 'm' | 'set';
  source: 'sample' | 'custom';
  verified: boolean;
  spec: string;
}

export type PartRole =
  | 'side'
  | 'top'
  | 'bottom'
  | 'back'
  | 'partition'
  | 'shelf'
  | 'rail'
  | 'plinth'
  | 'door'
  | 'drawer_front'
  | 'drawer_part'
  | 'panel'
  | 'worktop'
  | 'backsplash'
  | 'hardware'
  | 'appliance'
  | 'led'
  | 'decor'
  | 'wall';

export interface PartAnim {
  group: string; // e.g. "door-2", "drawer-1-0"
  kind: 'hinge' | 'slide';
  /** hinge: pivot point (local), axis (usually Y) and open angle in degrees. */
  pivot?: Vec3;
  axis?: Vec3;
  angle?: number;
  /** slide: unit axis and max travel in mm */
  slide?: Vec3;
  distance?: number;
}

export interface Part {
  id: string;
  nodeId: string;
  label: string;
  role: PartRole;
  shape: 'box' | 'cylinder' | 'sphere';
  /** Size along local X, Y, Z (mm). For cylinders: X = diameter, Y = length along its axis, Z = diameter. */
  size: Vec3;
  /** Centre in node-local coords. */
  center: Vec3;
  /** Local rotation (degrees) about X,Y,Z applied around the part centre (used for cylinders lying down, tilts). */
  rot?: Vec3;
  slot: Slot;
  materialOverride?: string;
  /** Sheet-good part: participates in cut list / board area. */
  sheet?: boolean;
  thickness?: number;
  grain?: 'length' | 'width' | 'none';
  /** Edge banding on [length-1, length-2, width-1, width-2] (cut-list length >= width). */
  edge?: [boolean, boolean, boolean, boolean];
  hardware?: { code: string; qty: number }[];
  anim?: PartAnim;
  sub?: { kind: 'section' | 'door' | 'drawer' | 'shelf' | 'tv' | 'niche'; index: number };
  light?: { color: string; intensity: number };
  /** Extra attributes carried into manufacturing documents (drilling, routing). */
  ops?: string[];
}

export interface SectionCfg {
  id: string;
  /** Fixed internal width in mm, or null = auto (shares leftover space). */
  width: number | null;
  kind: 'hanging_long' | 'hanging_short' | 'shelves' | 'drawers' | 'shoe' | 'open_niche' | 'custom';
  /** Shelf heights in mm above the section floor. */
  shelves: number[];
  /** Rod drop in mm below section top, or null = no rod. */
  rod: number | null;
  /** Stacked drawer front heights (mm) from the section floor. */
  drawers: number[];
  tray: boolean;
}

export interface DoorCfg {
  type: 'solid' | 'mirror' | 'glass' | 'none';
  material?: string; // per-door material override
}

export interface WardrobeParams {
  style: 'hinged' | 'sliding' | 'open';
  thickness: number; // carcass board
  backThickness: number;
  doorThickness: number;
  plinthHeight: number;
  loftHeight: number;
  topPanel: boolean;
  sidePanels: boolean;
  bottomPanel: boolean;
  backPanel: boolean;
  sections: SectionCfg[];
  doorCount: number;
  doors: DoorCfg[];
  handle: 'bar' | 'knob' | 'profile' | 'none';
  lighting: { enabled: boolean; sensor: boolean; color: string };
  /** hardware choices (codes from the hardware library) */
  hinge: string;
  runner: string;
  slidingSystem: string;
  barHandle: string;
}

export type CabinetVariant =
  | 'base'
  | 'wall'
  | 'tall'
  | 'corner'
  | 'drawer'
  | 'sink'
  | 'open_shelf'
  | 'island'
  | 'bookcase';

export interface CabinetParams {
  variant: CabinetVariant;
  thickness: number;
  backThickness: number;
  doorThickness: number;
  plinthHeight: number;
  shelves: number;
  drawers: number[]; // front heights; stacked from top for 'drawer' variant
  doors: 0 | 1 | 2;
  doorStyle: 'flat' | 'shaker' | 'glass' | 'open';
  hingeSide: 'left' | 'right';
  sliding: boolean;
  handle: 'bar' | 'knob' | 'profile' | 'none';
  handlePlacement: 'edge' | 'center' | 'top';
  gap: number; // door-to-door / door-to-carcass gap
  wallClearance: number; // installation allowance behind unit
  cornerDoorWidth: number;
  overhang: number; // island breakfast overhang
  raisedBar: boolean;
  countertopThickness: number; // for island (built-in top)
  hinge: string;
  runner: string;
  barHandle: string;
}

export interface CountertopParams {
  thickness: number;
  overhang: number;
  backsplashHeight: number; // 0 = none
  backsplashThickness: number;
}

export type ApplianceKind =
  | 'fridge'
  | 'oven'
  | 'microwave'
  | 'hob'
  | 'chimney'
  | 'dishwasher'
  | 'sink'
  | 'light_strip';

export interface ApplianceParams {
  kind: ApplianceKind;
  burners: number;
  basins: number;
  lightColor: string;
}

export interface TvShelf {
  id: string;
  x: number; // centre offset from panel centre
  y: number; // bottom height from floor
  w: number;
  d: number;
  t: number;
}

export interface TvParams {
  style: 'plain' | 'fluted' | 'slat' | 'marble' | 'stone' | 'batten';
  panelThickness: number;
  patternSpacing: number; // flute/slat pitch
  tv: { size: number; x: number; bottom: number; depth: number; wallMount: boolean };
  unit: {
    type: 'floating' | 'floor' | 'none';
    width: number;
    height: number;
    depth: number;
    elevation: number;
    drawers: number;
    doors: number;
    open: boolean;
    routerCompartment: boolean;
    cableOpening: boolean;
  };
  sides: {
    left: { enabled: boolean; width: number; height: number; kind: 'closed' | 'open' | 'niche' };
    right: { enabled: boolean; width: number; height: number; kind: 'closed' | 'open' | 'niche' };
    depth: number;
  };
  shelves: TvShelf[];
  soundbar: boolean;
  fireplace: boolean;
  backlit: boolean;
  led: { enabled: boolean; color: string; intensity: number; under: boolean; behindTv: boolean; niches: boolean };
  handle: 'bar' | 'knob' | 'profile' | 'none';
}

export interface ModelParams {
  url: string; // /api/assets/<id>
  fileName: string;
  triangles: number;
}

export interface FurnitureParams {
  kind: string;
}

export interface BoxParams {
  shape: 'box' | 'cylinder';
  solid: boolean;
}

export interface SceneNode {
  id: string;
  type: NodeType;
  name: string;
  parentId: string | null;
  position: Vec3; // centre-bottom of footprint
  rotationY: number;
  size: { w: number; h: number; d: number };
  materials: MaterialAssign;
  /** Per-sub-component overrides keyed `section:2`, `door:0`, `drawer:105`, ... */
  subMaterials?: Record<string, MaterialAssign>;
  visible: boolean;
  locked: boolean;
  /** floor of the floor plan this object stands on (undefined = first floor) */
  floorId?: string;
  params: Record<string, unknown>;
  /** Free-form manufacturing metadata */
  notes?: string;
}

export interface Opening {
  id: string;
  kind: 'door' | 'window' | 'opening';
  wall: number; // index of polygon edge
  offset: number; // mm along wall from its start to opening's left edge
  width: number;
  height: number;
  sill: number;
}

export interface Column {
  id: string;
  x: number;
  z: number;
  w: number;
  d: number;
}

export interface Room {
  points: [number, number][]; // polygon on the floor (x,z), clockwise or ccw
  height: number;
  wallThickness: number;
  openings: Opening[];
  columns: Column[];
  floorMaterial: string;
  wallMaterial: string;
  ceilingMaterial: string;
  showWalls: boolean;
  showCeiling: boolean;
}

export interface PricingConfig {
  currency: string;
  taxPct: number;
  labourPct: number; // % of materials+hardware
  installationFlat: number;
  wastagePct: number;
  discountPct: number;
  /** keyed by BOQ item key; user overrides */
  overrides: Record<string, { unitPrice: number; estimate: boolean }>;
  customerName?: string;
}

export interface LightingCfg {
  preset: 'daylight' | 'warm' | 'neutral' | 'night';
  exposure: number;
  toneMapping: 'ACES' | 'AgX' | 'Neutral' | 'None';
  shadows: boolean;
  ao: boolean;
  roomLight: number;
}

export interface SceneDoc {
  schema: 1;
  units: 'mm';
  category: Category;
  room: Room;
  nodes: Record<string, SceneNode>;
  order: string[]; // z-order / listing order of node ids
  defaults: MaterialAssign;
  /** Materials used by this project that are not part of the built-in sample catalog */
  customMaterials: MaterialDef[];
  pricing: PricingConfig;
  lighting: LightingCfg;
  /** Edit log for revisions in-doc (short) */
  meta: { createdWith: string; notes: string };
  /** Floor-plan workspace data: buildings, floors, walls, annotations ... (absent for classic projects) */
  plan?: PlanModel;
}

export interface Issue {
  level: 'error' | 'warning';
  field?: string;
  message: string;
}
