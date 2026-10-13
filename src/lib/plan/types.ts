// Floor-plan model. Lives inside SceneDoc.plan so it shares persistence, undo/redo, validation and
// the 3D renderer with the rest of the application. All lengths are millimetres.
// Plan coordinates: x east, y south (y == world z). Angles in degrees; 0 = +x, increasing clockwise on screen.

export type Pt = [number, number];

export type EntityKind =
  | 'line' | 'polyline' | 'arc' | 'circle' | 'rect' | 'polygon' | 'arrow' | 'hatch' | 'guide'
  | 'wall' | 'door' | 'window' | 'column' | 'beam' | 'slab' | 'ceiling' | 'tiling' | 'stairs' | 'railing' | 'roof'
  | 'light' | 'strip' | 'model' | 'reference'
  | 'dimension' | 'text' | 'compass' | 'angle' | 'xy' | 'radial' | 'leader';

interface Base {
  id: string;
  locked?: boolean;
  hidden?: boolean;
  /** entities that share a group id are selected and moved together (inserted components) */
  group?: string;
}

export interface LineE extends Base { kind: 'line'; a: Pt; b: Pt }
export interface PolylineE extends Base { kind: 'polyline'; pts: Pt[]; closed: boolean }
export interface ArcE extends Base { kind: 'arc'; p1: Pt; p2: Pt; p3: Pt }
export interface CircleE extends Base { kind: 'circle'; c: Pt; r: number }
export interface RectE extends Base { kind: 'rect'; p1: Pt; p2: Pt }
export interface PolygonE extends Base { kind: 'polygon'; pts: Pt[] }
export interface ArrowE extends Base { kind: 'arrow'; a: Pt; b: Pt }
export type HatchPattern = 'diagonal' | 'cross' | 'horizontal' | 'vertical' | 'dots' | 'solid';
export interface HatchE extends Base {
  kind: 'hatch';
  /** Follows another closed entity (rect, polygon, closed polyline, circle) or a room found at a point. */
  boundary: { kind: 'ref'; id: string } | { kind: 'room'; at: Pt } | { kind: 'pts'; pts: Pt[] };
  pattern: HatchPattern;
  scale: number; // spacing in mm
  angle: number;
  color: string;
}
export interface GuideE extends Base { kind: 'guide'; a: Pt; b: Pt; infinite: boolean; temporary: boolean }

export interface WallE extends Base {
  kind: 'wall';
  a: Pt;
  b: Pt;
  thickness: number;
  height: number;
  wallType: 'interior' | 'exterior';
  color?: string;
}
export interface DoorE extends Base {
  kind: 'door';
  wall: string;
  offset: number; // distance from wall.a to the door's near edge, along the wall
  width: number;
  height: number;
  swing: 'left' | 'right'; // hinge side when viewed from the open side
  opens: 'in' | 'out'; // which side of the wall the leaf swings to (relative to wall normal)
}
export interface WindowE extends Base {
  kind: 'window';
  wall: string;
  offset: number;
  width: number;
  height: number;
  sill: number;
}
export interface ColumnE extends Base { kind: 'column'; c: Pt; width: number; depth: number; shape: 'rect' | 'round'; height: number; rot: number }
export interface BeamE extends Base { kind: 'beam'; a: Pt; b: Pt; width: number; depth: number; elevation: number }
export interface SlabE extends Base { kind: 'slab'; anchor: Pt; pts?: Pt[]; thickness: number; elevation: number }
export interface CeilingE extends Base { kind: 'ceiling'; anchor: Pt; height: number; thickness: number; visible: boolean }
export type TilePattern = 'grid' | 'brick' | 'diagonal';
export interface TilingE extends Base {
  kind: 'tiling';
  target: 'floor' | 'wall';
  anchor: Pt; // room containing this point (floor tiling)
  wall?: string; // wall id (wall tiling)
  tileW: number;
  tileH: number;
  grout: number;
  pattern: TilePattern;
  rotation: number;
  color: string;
  height: number; // wall tiling height
}
export interface StairsE extends Base { kind: 'stairs'; origin: Pt; rot: number; width: number; steps: number; riser: number; tread: number }
export interface RailingE extends Base { kind: 'railing'; pts: Pt[]; height: number; spacing: number; elevation: number }
export type RoofType = 'flat' | 'gable' | 'hip' | 'shed';
export interface RoofE extends Base { kind: 'roof'; pts: Pt[]; roofType: RoofType; slope: number; overhang: number; thickness: number; elevation: number }

export type LightType = 'point' | 'ceiling' | 'spot' | 'wall';
export interface LightE extends Base { kind: 'light'; pos: Pt; elevation: number; lightType: LightType; intensity: number; color: string }
export interface StripE extends Base { kind: 'strip'; a: Pt; b: Pt; elevation: number; color: string; intensity: number }
export interface ModelE extends Base { kind: 'model'; pos: Pt; elevation: number; rot: number; size: { w: number; d: number; h: number }; url: string; fileName: string }
export interface ReferenceE extends Base { kind: 'reference'; url: string; pos: Pt; width: number; height: number; rot: number; opacity: number; fileName: string }

export interface DimRef { id: string; handle: string }
export interface DimensionE extends Base { kind: 'dimension'; a: Pt; b: Pt; offset: number; refA?: DimRef; refB?: DimRef }
export interface TextE extends Base { kind: 'text'; pos: Pt; text: string; size: number; rot: number }
export interface CompassE extends Base { kind: 'compass'; pos: Pt; size: number; north: number }
export interface AngleE extends Base { kind: 'angle'; v: Pt; a: Pt; b: Pt }
export interface XYE extends Base { kind: 'xy'; pos: Pt }
export interface RadialE extends Base { kind: 'radial'; target: string; mode: 'radius' | 'diameter'; angle: number }
export interface LeaderE extends Base { kind: 'leader'; pts: Pt[]; text: string; size: number }

export type Entity =
  | LineE | PolylineE | ArcE | CircleE | RectE | PolygonE | ArrowE | HatchE | GuideE
  | WallE | DoorE | WindowE | ColumnE | BeamE | SlabE | CeilingE | TilingE | StairsE | RailingE | RoofE
  | LightE | StripE | ModelE | ReferenceE
  | DimensionE | TextE | CompassE | AngleE | XYE | RadialE | LeaderE;

export const ARCHITECTURE_KINDS: EntityKind[] = ['wall', 'door', 'window', 'column', 'beam', 'slab', 'ceiling', 'tiling', 'stairs', 'railing', 'roof'];
export const ANNOTATION_KINDS: EntityKind[] = ['dimension', 'text', 'compass', 'angle', 'xy', 'radial', 'leader'];

export interface Floor {
  id: string;
  name: string;
  elevation: number; // mm above building datum
  height: number; // default storey height
  entities: Record<string, Entity>;
  order: string[];
  /** ids hidden by "isolate" (not persisted as entity.hidden so unhide restores exactly) */
  isolated?: string[];
}

export interface Building {
  id: string;
  name: string;
  floors: Floor[];
}

export interface PlanSettings {
  grid: { visible: boolean; spacing: number; major: number };
  snap: { grid: boolean; endpoint: boolean; midpoint: boolean; intersection: boolean; nearest: boolean; ortho: boolean; magnet: boolean };
  units: { display: 'mm' | 'cm' | 'm' | 'in' | 'ft'; precision: number };
  selection: { mode: 'auto' | 'window' | 'crossing' };
  dynamicInput: boolean;
  showDimensions: boolean;
  showRoomLabels: boolean;
  showReferences: boolean;
  showLights: boolean;
  xray: boolean;
  wallDefaults: { thickness: number; height: number; wallType: 'interior' | 'exterior' };
}

export interface ComponentDef {
  id: string;
  name: string;
  /** entities relative to the base point (0,0) */
  entities: Entity[];
}

export interface Viewpoint {
  id: string;
  name: string;
  floorId: string;
  kind: '2d' | '3d';
  view2d?: { cx: number; cy: number; scale: number };
  view3d?: { pos: [number, number, number]; target: [number, number, number] };
}

export interface Presentation {
  id: string;
  name: string;
  viewpoints: string[];
}

export interface GalleryItem {
  id: string;
  name: string;
  url: string; // /api/assets/<id>
  createdAt: string;
  width: number;
  height: number;
  kind: 'render' | 'screenshot';
}

export interface Branch {
  id: string;
  name: string;
  createdAt: string;
  snapshot: { buildings: Building[]; nodes: Record<string, unknown>; order: string[] };
}

export interface RoomProps {
  name?: string;
  floorMaterial?: string;
}

export type DesignMode = 'architecture' | 'interior' | 'production';

export interface PlanModel {
  version: 1;
  enabled: boolean;
  mode: DesignMode;
  buildings: Building[];
  activeBuildingId: string;
  activeFloorId: string;
  settings: PlanSettings;
  components: ComponentDef[];
  viewpoints: Viewpoint[];
  presentations: Presentation[];
  gallery: GalleryItem[];
  branches: Branch[];
  activeBranch: string | null;
  roomProps: Record<string, RoomProps>; // keyed by room key (see rooms.ts)
  locked: boolean;
  extraLighting: number; // global multiplier for plan lights
  prices: Record<string, { unitPrice: number; estimate: boolean }>;
  schedule: Record<string, { days: number | null }>;
}

export interface Room {
  key: string;
  /** centre-line polygon of the surrounding walls */
  outline: Pt[];
  /** clear interior polygon (walls' half thickness removed) */
  inner: Pt[];
  area: number; // mm², inner polygon
  perimeter: number; // mm, inner polygon
  wallIds: string[];
  name: string;
  centroid: Pt;
}
