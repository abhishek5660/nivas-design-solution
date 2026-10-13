import type { ComponentDef, Entity, Floor, PlanModel, PlanSettings, Pt, Room } from './types';
import type { SnapResult } from './snap';

export type ToolId =
  | 'select' | 'pan'
  | 'line' | 'polyline' | 'guide' | 'arc' | 'circle' | 'rect' | 'polygon' | 'arrow' | 'hatch'
  | 'trim' | 'extend' | 'mirror' | 'copy' | 'move' | 'rotate' | 'scale' | 'component' | 'offset' | 'fillet' | 'attach'
  | 'wall' | 'door' | 'window' | 'ceiling' | 'tiling' | 'stairs' | 'slab' | 'column' | 'railing' | 'beam' | 'roof'
  | 'dimension' | 'measure'
  | 'furnish' | 'light' | 'strip' | 'model' | 'reference'
  | 'text' | 'compass' | 'angle' | 'xy' | 'radial' | 'leader';

export type NodeOp =
  | { type: 'move'; d: Pt }
  | { type: 'copy'; d: Pt }
  | { type: 'rotate'; angle: number; origin: Pt }
  | { type: 'mirror'; a: Pt; b: Pt; keep: boolean }
  | { type: 'delete' };

export interface PlanPointer {
  /** snapped point (what tools should use) */
  pt: Pt;
  raw: Pt;
  snap: SnapResult;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  /** pixels per mm of the current view (for tolerances) */
  scale: number;
}

export interface OptionField {
  key: string;
  label: string;
  type: 'number' | 'select' | 'color' | 'text' | 'bool';
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  hint?: string;
}

export type ToolOptions = Record<string, string | number | boolean>;

/** What a tool may do. Implemented by the React store in the app and by a plain object in tests. */
export interface PlanHost {
  plan(): PlanModel;
  floor(): Floor;
  rooms(): Room[];
  settings(): PlanSettings;
  options(tool: ToolId): ToolOptions;
  setOption(tool: ToolId, key: string, value: string | number | boolean): void;
  /** replace the active floor (one undo step) */
  commit(label: string, floor: Floor, selectIds?: string[]): void;
  selection(): string[];
  setSelection(ids: string[]): void;
  /** furniture / cabinet nodes live in the scene document; these expose them to tools */
  placeFurniture(itemId: string, at: Pt, rotation: number): string | null;
  nodeAt(pt: Pt, tol: number): string | null;
  nodesInBox(box: { minX: number; minY: number; maxX: number; maxY: number }, crossing: boolean): string[];
  /** transform furniture/cabinet nodes; returns ids of created nodes for copy/mirror-keep */
  transformNodes(op: NodeOp, ids: string[]): string[];
  /** runs several mutations as ONE undo step */
  batch(label: string, fn: () => void): void;
  nodeOutline(id: string): Pt[] | null;
  addComponent(def: ComponentDef): void;
  /** user feedback shown in the status line / toast */
  say(message: string, level?: 'info' | 'warn' | 'error'): void;
  prompt(title: string, initial?: string): Promise<string | null>;
  setTool(tool: ToolId): void;
  /** currently active payload for place tools (furniture item id, imported model/reference info) */
  payload(): Record<string, unknown> | null;
  locked(): boolean;
  /** pointer tolerance in mm for a given pixel size */
  tol(px: number): number;
}

export interface Drawable {
  kind: 'line' | 'poly' | 'circle' | 'arc' | 'text' | 'rect' | 'point' | 'entity';
  pts?: Pt[];
  c?: Pt;
  r?: number;
  text?: string;
  closed?: boolean;
  style?: 'preview' | 'ok' | 'bad' | 'dim' | 'guide';
  entity?: Entity;
}

export interface PlanTool {
  id: ToolId;
  label: string;
  /** suggestion text for the hint bar given current state */
  hint(st: ToolState): string;
  options?: OptionField[];
  defaults?: ToolOptions;
  /** needs a selection to start */
  needsSelection?: boolean;
  start?(h: PlanHost, st: ToolState): void;
  down?(h: PlanHost, st: ToolState, ev: PlanPointer): void;
  move?(h: PlanHost, st: ToolState, ev: PlanPointer): void;
  up?(h: PlanHost, st: ToolState, ev: PlanPointer): void;
  /** typed value + Enter; returns true when consumed */
  numeric?(h: PlanHost, st: ToolState, text: string, cursor: Pt): boolean | Promise<boolean>;
  /** Enter / right-click / double-click */
  finish?(h: PlanHost, st: ToolState, close?: boolean): void;
  key?(h: PlanHost, st: ToolState, key: string): boolean;
  /** abort the operation in progress; returns true if something was cancelled */
  cancel(h: PlanHost, st: ToolState): boolean;
  /** reference point used for orthogonal snapping */
  ref?(st: ToolState): Pt | null;
  preview?(h: PlanHost, st: ToolState, cursor: PlanPointer): Drawable[];
  /** label for the dynamic input box, e.g. "Length" */
  inputLabel?(st: ToolState): string | null;
}

export type ToolState = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
