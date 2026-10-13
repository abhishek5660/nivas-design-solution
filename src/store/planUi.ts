'use client';
import { create } from 'zustand';
import type { ToolId, ToolOptions } from '@/lib/plan/toolHost';
import type { Pt } from '@/lib/plan/types';

export type RibbonTab = 'home' | 'view' | 'insert' | 'draw' | 'architecture' | 'annotate' | 'render' | 'outputs';
export type ViewMode = '2d' | '3d' | 'split';

export interface View2D {
  cx: number; // world x at canvas centre
  cy: number;
  scale: number; // pixels per mm
}

export interface StatusMsg {
  id: number;
  text: string;
  level: 'info' | 'warn' | 'error';
}

export interface PromptState {
  title: string;
  initial: string;
  resolve: (v: string | null) => void;
}

export type PanelId = null | 'furnish' | 'qc' | 'boq' | 'raw' | 'pricing' | 'schedule' | 'presentation' | 'cache' | 'settings' | 'prefs' | 'branch' | 'aifloor' | 'gallery' | 'views' | 'help' | 'grid' | 'floors' | 'share' | 'extralight' | 'units' | 'rooms' | 'render' | 'violations';

interface PlanUiState {
  tab: RibbonTab;
  tool: ToolId;
  viewMode: ViewMode;
  selection: string[];
  hovered: string | null;
  views: Record<string, View2D>;
  toolOptions: Partial<Record<ToolId, ToolOptions>>;
  payload: Record<string, unknown> | null;
  status: StatusMsg | null;
  hint: string;
  typed: string;
  inputLabel: string | null;
  prompt: PromptState | null;
  panel: PanelId;
  cursor: Pt | null;
  snapLabel: string;
  contextMenu: { x: number; y: number } | null;
  /** last measurement / extra overlays kept by tools */
  zoomRequest: { kind: 'fit' | 'selection' | 'room' | 'in' | 'out'; nonce: number; room?: Pt[] } | null;
  highlight: { at: Pt; nonce: number } | null;
  /** view flags */
  floorMode: 'all' | 'upTo' | 'active';
  selectMode: 'object' | 'face' | 'edge';
  setFlag: <K extends 'floorMode' | 'selectMode'>(k: K, v: PlanUiState[K]) => void;
  setTab: (t: RibbonTab) => void;
  setTool: (t: ToolId) => void;
  setViewMode: (m: ViewMode) => void;
  setSelection: (ids: string[]) => void;
  setHovered: (id: string | null) => void;
  setView: (floorId: string, v: View2D) => void;
  setOption: (tool: ToolId, key: string, value: string | number | boolean) => void;
  setPayload: (p: Record<string, unknown> | null) => void;
  say: (text: string, level?: StatusMsg['level']) => void;
  setHint: (h: string, label: string | null) => void;
  setTyped: (t: string) => void;
  openPrompt: (title: string, initial: string) => Promise<string | null>;
  closePrompt: (v: string | null) => void;
  setPanel: (p: PanelId) => void;
  setCursor: (p: Pt | null, snap: string) => void;
  setContextMenu: (m: { x: number; y: number } | null) => void;
  requestZoom: (kind: 'fit' | 'selection' | 'room' | 'in' | 'out', room?: Pt[]) => void;
  flash: (at: Pt) => void;
}

let statusId = 1;

export const usePlanUi = create<PlanUiState>((set, get) => ({
  tab: 'home',
  tool: 'select',
  viewMode: '2d',
  selection: [],
  hovered: null,
  views: {},
  toolOptions: {},
  payload: null,
  status: null,
  hint: '',
  typed: '',
  inputLabel: null,
  prompt: null,
  panel: null,
  cursor: null,
  snapLabel: '',
  contextMenu: null,
  zoomRequest: null,
  highlight: null,
  floorMode: 'upTo',
  selectMode: 'object',
  setFlag: (k, v) => set({ [k]: v } as Partial<PlanUiState>),
  setTab: (tab) => set({ tab }),
  setTool: (tool) => set({ tool, typed: '' }),
  setViewMode: (viewMode) => set({ viewMode }),
  setSelection: (ids) => set((s) => (s.selection.length === ids.length && s.selection.every((x, i) => x === ids[i]) ? s : { selection: ids })),
  setHovered: (hovered) => set((s) => (s.hovered === hovered ? s : { hovered })),
  setView: (floorId, v) => set((s) => ({ views: { ...s.views, [floorId]: v } })),
  setOption: (tool, key, value) => set((s) => ({ toolOptions: { ...s.toolOptions, [tool]: { ...(s.toolOptions[tool] ?? {}), [key]: value } } })),
  setPayload: (payload) => set({ payload }),
  say: (text, level = 'info') => {
    const id = statusId++;
    set({ status: { id, text, level } });
    setTimeout(() => {
      if (get().status?.id === id) set({ status: null });
    }, level === 'error' ? 9000 : 5000);
  },
  setHint: (hint, inputLabel) => set((s) => (s.hint === hint && s.inputLabel === inputLabel ? s : { hint, inputLabel })),
  setTyped: (typed) => set({ typed }),
  openPrompt: (title, initial) =>
    new Promise((resolve) => {
      get().prompt?.resolve(null);
      set({ prompt: { title, initial, resolve } });
    }),
  closePrompt: (v) => {
    const p = get().prompt;
    set({ prompt: null });
    p?.resolve(v);
  },
  setPanel: (panel) => set((s) => ({ panel: s.panel === panel ? null : panel })),
  setCursor: (cursor, snapLabel) => set({ cursor, snapLabel }),
  setContextMenu: (contextMenu) => set({ contextMenu }),
  requestZoom: (kind, room) => set({ zoomRequest: { kind, nonce: Math.random(), room } }),
  flash: (at) => set({ highlight: { at, nonce: Math.random() } }),
}));
