'use client';
import { create } from 'zustand';
import { addNodeToDoc, autoCountertops, buildParts, checkPlacement, footprint, makeNode, resetNameCounters, resizeNode, snapNode, uid, validateNode, validateRoom } from '@/lib/scene';
import { validateDoc } from '@/lib/schema';
import { adaptWardrobe } from '@/lib/build/wardrobe';
import type { Issue, MaterialDef, Room, SceneDoc, SceneNode, Slot, Vec3 } from '@/lib/types';

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict' | 'readonly';
export type Tab = 'design' | 'drawings' | 'boq' | 'production' | 'history' | 'render';
export type ViewMode = 'room' | 'cabinet' | 'detail';
export type ViewRequest = { type: 'front' | 'back' | 'left' | 'right' | 'top' | 'iso' | 'fit-scene' | 'fit-selection' | 'reset'; nonce: number } | null;

export interface Toast {
  id: number;
  level: 'info' | 'warning' | 'error' | 'success';
  text: string;
}

export interface ProjectMeta {
  id: string;
  name: string;
  category: string;
  status: string;
  customer: string;
  roomNotes: string;
  updatedAt: string;
}

interface Selection {
  ids: string[];
  sub: { kind: string; index: number } | null;
}

interface Ui {
  tab: Tab;
  tool: 'select' | 'move' | 'rotate' | 'resize';
  camera: 'perspective' | 'orthographic';
  viewMode: ViewMode;
  showGrid: boolean;
  showDims: boolean;
  showWalls: boolean;
  showCeiling: boolean;
  snap: number; // mm; 0 = off
  blockOverlap: boolean;
  exploded: number; // 0..1
  walkthrough: boolean;
  presentation: boolean;
  interiorView: boolean;
  leftTab: 'library' | 'scene' | 'room';
  rightTab: 'properties' | 'materials' | 'lighting';
  compare: SceneDoc | null;
  compareMode: boolean;
  ghost: boolean;
}

const HISTORY_LIMIT = 120;

interface EditorState {
  projectId: string | null;
  meta: ProjectMeta | null;
  access: 'OWNER' | 'EDIT' | 'VIEW';
  doc: SceneDoc;
  baseVersion: number;
  saveStatus: SaveStatus;
  saveError: string | null;
  lastSavedAt: number | null;
  past: { doc: SceneDoc; key?: string; t: number }[];
  future: SceneDoc[];
  tx: { before: SceneDoc } | null;
  sel: Selection;
  hovered: string | null;
  clipboard: SceneNode[];
  toasts: Toast[];
  ui: Ui;
  /** target openness per `${nodeId}:${animGroup}` (0..1) */
  openTargets: Record<string, number>;
  viewRequest: ViewRequest;
  issues: Record<string, Issue[]>;
  dirtyAt: number;
  // actions
  load: (p: { meta: ProjectMeta; doc: SceneDoc; version: number; access: 'OWNER' | 'EDIT' | 'VIEW' }) => void;
  setUi: (patch: Partial<Ui>) => void;
  requestView: (type: NonNullable<ViewRequest>['type']) => void;
  toast: (level: Toast['level'], text: string) => void;
  dismissToast: (id: number) => void;
  select: (ids: string[], additive?: boolean) => void;
  selectSub: (sub: Selection['sub']) => void;
  setHovered: (id: string | null) => void;
  // editing
  commit: (next: SceneDoc, key?: string) => void;
  beginTx: () => void;
  preview: (fn: (doc: SceneDoc) => SceneDoc) => void;
  endTx: (opts?: { validateIds?: string[] }) => boolean;
  cancelTx: () => void;
  patchNode: (id: string, fn: (n: SceneNode) => SceneNode, opts?: { key?: string; placement?: boolean; quiet?: boolean }) => boolean;
  patchParams: (id: string, patch: Record<string, unknown>, key?: string) => boolean;
  setSize: (id: string, patch: Partial<SceneNode['size']>) => boolean;
  setPosition: (id: string, pos: Partial<{ x: number; y: number; z: number }>) => boolean;
  setRotation: (id: string, deg: number) => boolean;
  addNode: (node: SceneNode, opts?: { snap?: boolean; select?: boolean }) => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  copySelected: () => void;
  paste: () => void;
  groupSelected: () => void;
  ungroupSelected: () => void;
  align: (mode: 'left' | 'right' | 'centerX' | 'front' | 'back' | 'centerZ') => void;
  distribute: (axis: 'x' | 'z') => void;
  toggleLock: (ids?: string[]) => void;
  toggleVisible: (ids?: string[]) => void;
  setSlotMaterial: (ids: string[], slot: Slot, materialId: string | null, sub?: { kind: string; index: number } | null) => void;
  upsertMaterial: (m: MaterialDef) => void;
  removeMaterial: (id: string) => void;
  setRoom: (fn: (r: Room) => Room, key?: string) => boolean;
  setDocPart: <K extends keyof SceneDoc>(key: K, value: SceneDoc[K], coalesce?: string) => void;
  replaceDoc: (doc: SceneDoc, label?: string) => void;
  /** Changes the doc without an undo step (navigation such as the open floor). */
  softSet: (next: SceneDoc) => void;
  fixCountertops: () => void;
  undo: () => void;
  redo: () => void;
  toggleOpen: (nodeId: string, group: string) => void;
  setAllOpen: (kind: 'door' | 'drawer' | 'all', open: boolean, nodeIds?: string[]) => void;
  // persistence bookkeeping (used by the save engine)
  markSaving: () => void;
  markSaved: (version: number, updatedAt: string, docAtRequest: SceneDoc) => void;
  markSaveFailed: (status: 'error' | 'conflict', msg: string) => void;
}

/** Undo/redo must not move the user to another floor: keep the floor/building that is currently open when it still exists. */
function keepNavigation(from: SceneDoc, to: SceneDoc): SceneDoc {
  const a = from.plan;
  const b = to.plan;
  if (!a || !b || (a.activeFloorId === b.activeFloorId && a.activeBuildingId === b.activeBuildingId)) return to;
  const bld = b.buildings.find((x) => x.floors.some((f) => f.id === a.activeFloorId));
  return bld ? { ...to, plan: { ...b, activeFloorId: a.activeFloorId, activeBuildingId: bld.id } } : to;
}

const emptyDoc = (): SceneDoc => ({ schema: 1, units: 'mm', category: 'CUSTOM', room: { points: [[0, 0], [1, 0], [1, 1]], height: 2700, wallThickness: 120, openings: [], columns: [], floorMaterial: 'floor-oak', wallMaterial: 'wall-white', ceilingMaterial: 'wall-white', showWalls: true, showCeiling: false }, nodes: {}, order: [], defaults: {}, customMaterials: [], pricing: { currency: 'INR', taxPct: 18, labourPct: 12, installationFlat: 0, wastagePct: 10, discountPct: 0, overrides: {} }, lighting: { preset: 'neutral', exposure: 1, toneMapping: 'ACES', shadows: true, ao: true, roomLight: 1 }, meta: { createdWith: '', notes: '' } });

let toastId = 1;

function descendants(doc: SceneDoc, ids: string[]): string[] {
  const out = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of Object.values(doc.nodes)) {
      if (n.parentId && out.has(n.parentId) && !out.has(n.id)) {
        out.add(n.id);
        grew = true;
      }
    }
  }
  return [...out];
}

function topAncestor(doc: SceneDoc, id: string): string {
  let cur = doc.nodes[id];
  while (cur?.parentId && doc.nodes[cur.parentId]) cur = doc.nodes[cur.parentId];
  return cur?.id ?? id;
}

export const useEditor = create<EditorState>((set, get) => {
  const touch = (next: SceneDoc, key?: string) => {
    const s = get();
    const now = Date.now();
    const last = s.past[s.past.length - 1];
    let past = s.past;
    if (key && last && last.key === key && now - last.t < 1500) {
      past = [...past.slice(0, -1), { ...last, t: now }];
    } else {
      past = [...past, { doc: s.doc, key, t: now }].slice(-HISTORY_LIMIT);
    }
    set({ doc: next, past, future: [], saveStatus: s.access === 'VIEW' ? 'readonly' : 'dirty', dirtyAt: now });
  };

  return {
    projectId: null,
    meta: null,
    access: 'OWNER',
    doc: emptyDoc(),
    baseVersion: 1,
    saveStatus: 'saved',
    saveError: null,
    lastSavedAt: null,
    past: [],
    future: [],
    tx: null,
    sel: { ids: [], sub: null },
    hovered: null,
    clipboard: [],
    toasts: [],
    openTargets: {},
    viewRequest: null,
    issues: {},
    dirtyAt: 0,
    ui: {
      tab: 'design',
      tool: 'select',
      camera: 'perspective',
      viewMode: 'room',
      showGrid: true,
      showDims: true,
      showWalls: true,
      showCeiling: false,
      snap: 10,
      blockOverlap: true,
      exploded: 0,
      walkthrough: false,
      presentation: false,
      interiorView: false,
      leftTab: 'library',
      rightTab: 'properties',
      compare: null,
      compareMode: false,
      ghost: false,
    },

    load: ({ meta, doc, version, access }) => {
      resetNameCounters(doc);
      set({
        projectId: meta.id,
        meta,
        doc,
        access,
        baseVersion: version,
        past: [],
        future: [],
        tx: null,
        sel: { ids: [], sub: null },
        saveStatus: access === 'VIEW' ? 'readonly' : 'saved',
        saveError: null,
        lastSavedAt: Date.now(),
        openTargets: {},
        ui: { ...get().ui, showWalls: doc.room.showWalls, showCeiling: doc.room.showCeiling, compare: null, compareMode: false },
      });
    },

    setUi: (patch) => set((s) => ({ ui: { ...s.ui, ...patch } })),
    requestView: (type) => set({ viewRequest: { type, nonce: Date.now() + Math.random() } }),
    toast: (level, text) => {
      const id = toastId++;
      set((s) => ({ toasts: [...s.toasts.filter((t) => t.text !== text).slice(-3), { id, level, text }] }));
      setTimeout(() => get().dismissToast(id), level === 'error' ? 7000 : 4000);
    },
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

    select: (ids, additive) =>
      set((s) => {
        const doc = s.doc;
        const tops = ids.map((i) => (doc.nodes[i] ? topAncestor(doc, i) : i)).filter((i) => doc.nodes[i]);
        const next = additive ? Array.from(new Set([...s.sel.ids, ...tops])) : tops;
        // shift-click on an already selected node deselects it
        const final = additive && ids.length === 1 && s.sel.ids.includes(tops[0]) ? s.sel.ids.filter((i) => i !== tops[0]) : next;
        return { sel: { ids: final, sub: null } };
      }),
    selectSub: (sub) => set((s) => ({ sel: { ...s.sel, sub } })),
    setHovered: (id) => set({ hovered: id }),

    commit: (next, key) => touch(next, key),
    softSet: (next) => set((s) => ({ doc: next, saveStatus: s.access === 'VIEW' ? 'readonly' : 'dirty', dirtyAt: Date.now() })),

    beginTx: () => {
      if (get().access === 'VIEW') return;
      set({ tx: { before: get().doc } });
    },
    preview: (fn) => set((s) => ({ doc: fn(s.doc) })),
    cancelTx: () => {
      const tx = get().tx;
      if (tx) set({ doc: tx.before, tx: null });
    },
    endTx: (opts) => {
      const s = get();
      if (!s.tx) return true;
      const before = s.tx.before;
      const after = s.doc;
      if (before === after) {
        set({ tx: null });
        return true;
      }
      // validate every changed node
      const ids = opts?.validateIds ?? Object.keys(after.nodes);
      for (const id of ids) {
        const n = after.nodes[id];
        if (!n || n === before.nodes[id]) continue;
        const errs = validateNode(n).filter((i) => i.level === 'error');
        if (errs.length) {
          set({ doc: before, tx: null });
          get().toast('error', `${n.name}: ${errs[0].message}`);
          return false;
        }
        if (s.ui.blockOverlap) {
          const p = checkPlacement(after, n).filter((i) => i.level === 'error');
          if (p.length) {
            set({ doc: before, tx: null });
            get().toast('error', `${p[0].message}. Move reverted - turn off "Block overlaps" to allow it.`);
            return false;
          }
        }
        const w = checkPlacement(after, n).filter((i) => i.level === 'warning');
        if (w.length) get().toast('warning', w[0].message);
      }
      set({ doc: before, tx: null });
      touch(after);
      return true;
    },

    patchNode: (id, fn, opts) => {
      const s = get();
      const cur = s.doc.nodes[id];
      if (!cur) return false;
      if (s.access === 'VIEW') {
        s.toast('warning', 'You have view-only access to this project.');
        return false;
      }
      const next = fn(cur);
      if (next === cur) return true;
      const issues = validateNode(next);
      const errs = issues.filter((i) => i.level === 'error');
      if (errs.length) {
        if (!opts?.quiet) s.toast('error', `${next.name}: ${errs[0].message}`);
        set((st) => ({ issues: { ...st.issues, [id]: issues } }));
        return false;
      }
      if (opts?.placement !== false && (next.position !== cur.position || next.size !== cur.size || next.rotationY !== cur.rotationY)) {
        const p = checkPlacement(s.doc, next);
        const hard = p.filter((i) => i.level === 'error');
        if (hard.length && s.ui.blockOverlap && next.type !== 'group') {
          if (!opts?.quiet) s.toast('error', `${hard[0].message}. Change rejected - turn off "Block overlaps" to allow it.`);
          return false;
        }
        const soft = p.filter((i) => i.level === 'warning' || (i.level === 'error' && !s.ui.blockOverlap));
        if (soft.length && !opts?.quiet) s.toast('warning', soft[0].message);
      }
      set((st) => ({ issues: { ...st.issues, [id]: issues } }));
      const doc = { ...s.doc, nodes: { ...s.doc.nodes, [id]: next } };
      if (s.tx) set({ doc });
      else touch(doc, opts?.key);
      const warn = issues.find((i) => i.level === 'warning');
      if (warn && !opts?.quiet) s.toast('warning', warn.message);
      return true;
    },

    patchParams: (id, patch, key) =>
      get().patchNode(
        id,
        (n) => {
          const next = { ...n, params: { ...n.params, ...patch } };
          return n.type === 'wardrobe' && !('sections' in patch) ? adaptWardrobe(n, next) : next;
        },
        { key: key ?? `params:${id}:${Object.keys(patch).join(',')}`, placement: false },
      ),

    setSize: (id, patch) =>
      get().patchNode(
        id,
        (n) => {
          const size = { ...n.size, ...patch };
          if (size.w === n.size.w && size.h === n.size.h && size.d === n.size.d) return n;
          return resizeNode(n, size);
        },
        { key: `size:${id}` },
      ),

    setPosition: (id, pos) =>
      get().patchNode(
        id,
        (n) => {
          const p: Vec3 = [pos.x ?? n.position[0], pos.y ?? n.position[1], pos.z ?? n.position[2]];
          if (!p.every(Number.isFinite)) return n;
          return p[0] === n.position[0] && p[1] === n.position[1] && p[2] === n.position[2] ? n : { ...n, position: p };
        },
        { key: `pos:${id}` },
      ),

    setRotation: (id, deg) => get().patchNode(id, (n) => (Number.isFinite(deg) && deg !== n.rotationY ? { ...n, rotationY: ((deg % 360) + 360) % 360 > 180 ? ((deg % 360) + 360) % 360 - 360 : ((deg % 360) + 360) % 360 } : n), { key: `rot:${id}` }),

    addNode: (node, opts) => {
      const s = get();
      if (s.access === 'VIEW') return s.toast('warning', 'You have view-only access to this project.');
      let n = node;
      if (opts?.snap) {
        const r = snapNode(s.doc, n, n.position, n.rotationY, s.ui.snap || null);
        n = { ...n, position: r.position, rotationY: r.rotationY };
      }
      const doc = addNodeToDoc(s.doc, n);
      touch(doc);
      if (opts?.select !== false) set({ sel: { ids: [n.id], sub: null } });
      const p = checkPlacement(doc, n);
      if (p.length) get().toast('warning', `${p[0].message}. Drag it to a free spot.`);
    },

    deleteSelected: () => {
      const s = get();
      const locked = s.sel.ids.filter((i) => s.doc.nodes[i]?.locked);
      const ids = descendants(s.doc, s.sel.ids.filter((i) => !s.doc.nodes[i]?.locked));
      if (locked.length) get().toast('warning', 'Locked components were not deleted.');
      if (!ids.length) return;
      const nodes = { ...s.doc.nodes };
      ids.forEach((i) => delete nodes[i]);
      touch({ ...s.doc, nodes, order: s.doc.order.filter((i) => !ids.includes(i)) });
      set({ sel: { ids: [], sub: null } });
    },

    duplicateSelected: () => {
      const s = get();
      if (!s.sel.ids.length) return;
      let doc = s.doc;
      const newIds: string[] = [];
      const idMap = new Map<string, string>();
      for (const id of descendants(doc, s.sel.ids)) {
        const n = doc.nodes[id];
        if (!n) continue;
        const nid = uid(n.type.slice(0, 3));
        idMap.set(id, nid);
      }
      for (const [oldId, nid] of idMap) {
        const n = doc.nodes[oldId];
        const copy: SceneNode = { ...structuredClone(n), id: nid, name: n.name.replace(/ copy( \d+)?$/, '') + ' copy', locked: false, parentId: n.parentId && idMap.has(n.parentId) ? idMap.get(n.parentId)! : n.parentId };
        // offset along the node's own X axis by its width so copies sit side-by-side
        const th = (n.rotationY * Math.PI) / 180;
        const off = s.sel.ids.includes(oldId) ? n.size.w + 20 : n.size.w + 20;
        copy.position = [n.position[0] + Math.cos(th) * off, n.position[1], n.position[2] - Math.sin(th) * off];
        doc = addNodeToDoc(doc, copy);
        if (s.sel.ids.includes(oldId)) newIds.push(nid);
      }
      touch(doc);
      set({ sel: { ids: newIds, sub: null } });
      const first = doc.nodes[newIds[0]];
      if (first) {
        const p = checkPlacement(doc, first).filter((i) => i.level === 'error');
        if (p.length) get().toast('warning', 'The copy overlaps a neighbour - drag it into place.');
      }
    },

    copySelected: () => {
      const s = get();
      const nodes = descendants(s.doc, s.sel.ids).map((i) => structuredClone(s.doc.nodes[i])).filter(Boolean);
      set({ clipboard: nodes });
      if (nodes.length) get().toast('info', `Copied ${s.sel.ids.length} component${s.sel.ids.length > 1 ? 's' : ''}.`);
    },

    paste: () => {
      const s = get();
      if (!s.clipboard.length) return;
      let doc = s.doc;
      const idMap = new Map(s.clipboard.map((n) => [n.id, uid(n.type.slice(0, 3))]));
      const ids: string[] = [];
      for (const n of s.clipboard) {
        const copy: SceneNode = { ...structuredClone(n), id: idMap.get(n.id)!, parentId: n.parentId && idMap.has(n.parentId) ? idMap.get(n.parentId)! : null, locked: false, name: n.name.replace(/ copy( \d+)?$/, '') + ' copy' };
        copy.position = [n.position[0] + 300, n.position[1], n.position[2] + 300];
        doc = addNodeToDoc(doc, copy);
        if (!n.parentId || !idMap.has(n.parentId)) ids.push(copy.id);
      }
      touch(doc);
      set({ sel: { ids, sub: null } });
    },

    groupSelected: () => {
      const s = get();
      const ids = s.sel.ids.filter((i) => s.doc.nodes[i] && !s.doc.nodes[i].parentId);
      if (ids.length < 2) return s.toast('warning', 'Select at least two components to group them.');
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, maxY = 0;
      for (const id of ids) {
        for (const [x, z] of footprint(s.doc.nodes[id])) {
          minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
        }
        maxY = Math.max(maxY, s.doc.nodes[id].position[1] + s.doc.nodes[id].size.h);
      }
      const g = makeNode('box', { name: `Group ${Object.values(s.doc.nodes).filter((n) => n.type === 'group').length + 1}` });
      g.type = 'group';
      g.params = {};
      g.position = [(minX + maxX) / 2, 0, (minZ + maxZ) / 2];
      g.size = { w: maxX - minX, h: maxY, d: maxZ - minZ };
      const nodes = { ...s.doc.nodes, [g.id]: g };
      ids.forEach((i) => (nodes[i] = { ...nodes[i], parentId: g.id }));
      touch({ ...s.doc, nodes, order: [...s.doc.order, g.id] });
      set({ sel: { ids: [g.id], sub: null } });
    },

    ungroupSelected: () => {
      const s = get();
      const groups = s.sel.ids.filter((i) => s.doc.nodes[i]?.type === 'group');
      if (!groups.length) return s.toast('warning', 'Select a group to ungroup it.');
      const nodes = { ...s.doc.nodes };
      const kids: string[] = [];
      for (const n of Object.values(nodes)) if (n.parentId && groups.includes(n.parentId)) { nodes[n.id] = { ...n, parentId: null }; kids.push(n.id); }
      groups.forEach((g) => delete nodes[g]);
      touch({ ...s.doc, nodes, order: s.doc.order.filter((i) => !groups.includes(i)) });
      set({ sel: { ids: kids, sub: null } });
    },

    align: (mode) => {
      const s = get();
      const ids = s.sel.ids.filter((i) => s.doc.nodes[i] && !s.doc.nodes[i].locked);
      if (ids.length < 2) return s.toast('warning', 'Select two or more components to align.');
      const boxes = ids.map((i) => {
        const f = footprint(s.doc.nodes[i]);
        const xs = f.map((p) => p[0]);
        const zs = f.map((p) => p[1]);
        return { id: i, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
      });
      const target = {
        left: Math.min(...boxes.map((b) => b.minX)),
        right: Math.max(...boxes.map((b) => b.maxX)),
        back: Math.min(...boxes.map((b) => b.minZ)),
        front: Math.max(...boxes.map((b) => b.maxZ)),
        cx: (Math.min(...boxes.map((b) => b.minX)) + Math.max(...boxes.map((b) => b.maxX))) / 2,
        cz: (Math.min(...boxes.map((b) => b.minZ)) + Math.max(...boxes.map((b) => b.maxZ))) / 2,
      };
      const nodes = { ...s.doc.nodes };
      for (const b of boxes) {
        const n = nodes[b.id];
        let dx = 0, dz = 0;
        if (mode === 'left') dx = target.left - b.minX;
        if (mode === 'right') dx = target.right - b.maxX;
        if (mode === 'centerX') dx = target.cx - (b.minX + b.maxX) / 2;
        if (mode === 'back') dz = target.back - b.minZ;
        if (mode === 'front') dz = target.front - b.maxZ;
        if (mode === 'centerZ') dz = target.cz - (b.minZ + b.maxZ) / 2;
        nodes[b.id] = { ...n, position: [n.position[0] + dx, n.position[1], n.position[2] + dz] };
      }
      touch({ ...s.doc, nodes });
    },

    distribute: (axis) => {
      const s = get();
      const ids = s.sel.ids.filter((i) => s.doc.nodes[i] && !s.doc.nodes[i].locked);
      if (ids.length < 3) return s.toast('warning', 'Select three or more components to distribute.');
      const items = ids.map((i) => {
        const n = s.doc.nodes[i];
        const f = footprint(n);
        const lo = Math.min(...f.map((p) => p[axis === 'x' ? 0 : 1]));
        const hi = Math.max(...f.map((p) => p[axis === 'x' ? 0 : 1]));
        return { id: i, lo, hi, size: hi - lo };
      }).sort((a, b) => a.lo - b.lo);
      const total = items[items.length - 1].hi - items[0].lo;
      const gap = (total - items.reduce((a, b) => a + b.size, 0)) / (items.length - 1);
      if (gap < 0) return s.toast('warning', 'The components overlap; nothing to distribute.');
      let cursor = items[0].lo;
      const nodes = { ...s.doc.nodes };
      for (const it of items) {
        const n = nodes[it.id];
        const d = cursor - it.lo;
        nodes[it.id] = { ...n, position: axis === 'x' ? [n.position[0] + d, n.position[1], n.position[2]] : [n.position[0], n.position[1], n.position[2] + d] };
        cursor += it.size + gap;
      }
      touch({ ...s.doc, nodes });
    },

    toggleLock: (ids) => {
      const s = get();
      const target = ids ?? s.sel.ids;
      if (!target.length) return;
      const lock = !target.every((i) => s.doc.nodes[i]?.locked);
      const nodes = { ...s.doc.nodes };
      target.forEach((i) => nodes[i] && (nodes[i] = { ...nodes[i], locked: lock }));
      touch({ ...s.doc, nodes });
    },

    toggleVisible: (ids) => {
      const s = get();
      const target = ids ?? s.sel.ids;
      if (!target.length) return;
      const show = !target.every((i) => s.doc.nodes[i]?.visible);
      const nodes = { ...s.doc.nodes };
      target.forEach((i) => nodes[i] && (nodes[i] = { ...nodes[i], visible: show }));
      touch({ ...s.doc, nodes });
    },

    setSlotMaterial: (ids, slot, materialId, sub) => {
      const s = get();
      if (s.access === 'VIEW') return;
      const nodes = { ...s.doc.nodes };
      for (const id of ids) {
        const n = nodes[id];
        if (!n) continue;
        if (sub) {
          const key = `${sub.kind}:${sub.index}`;
          const subMaterials = { ...(n.subMaterials ?? {}) };
          const cur = { ...(subMaterials[key] ?? {}) };
          if (materialId) cur[slot] = materialId;
          else delete cur[slot];
          if (Object.keys(cur).length) subMaterials[key] = cur;
          else delete subMaterials[key];
          nodes[id] = { ...n, subMaterials };
        } else {
          const materials = { ...n.materials };
          if (materialId) materials[slot] = materialId;
          else delete materials[slot];
          nodes[id] = { ...n, materials };
        }
      }
      touch({ ...s.doc, nodes }, `mat:${ids.join(',')}:${slot}`);
    },

    upsertMaterial: (m) => {
      const s = get();
      const list = s.doc.customMaterials.some((x) => x.id === m.id) ? s.doc.customMaterials.map((x) => (x.id === m.id ? m : x)) : [...s.doc.customMaterials, m];
      touch({ ...s.doc, customMaterials: list }, `custommat:${m.id}`);
    },

    removeMaterial: (id) => {
      const s = get();
      const inUse = Object.values(s.doc.nodes).some((n) => Object.values(n.materials).includes(id) || Object.values(n.subMaterials ?? {}).some((a) => Object.values(a).includes(id))) || Object.values(s.doc.defaults).includes(id);
      if (inUse) return s.toast('error', 'This material is still used by a component. Reassign it first.');
      touch({ ...s.doc, customMaterials: s.doc.customMaterials.filter((x) => x.id !== id) });
    },

    setRoom: (fn, key) => {
      const s = get();
      const room = fn(s.doc.room);
      const errs = validateRoom(room).filter((i) => i.level === 'error');
      if (errs.length) {
        s.toast('error', errs[0].message);
        return false;
      }
      touch({ ...s.doc, room }, key ?? 'room');
      return true;
    },

    setDocPart: (key, value, coalesce) => touch({ ...get().doc, [key]: value }, coalesce),

    replaceDoc: (doc) => {
      const rep = validateDoc(doc);
      if (!rep.ok) return get().toast('error', rep.errors[0]);
      resetNameCounters(rep.doc!);
      touch(rep.doc!);
      set({ sel: { ids: [], sub: null } });
    },

    fixCountertops: () => {
      touch(autoCountertops(get().doc));
      get().toast('success', 'Countertops regenerated over each run of base cabinets.');
    },

    undo: () => {
      const s = get();
      const last = s.past[s.past.length - 1];
      if (!last) return;
      const restored = keepNavigation(s.doc, last.doc);
      set({ doc: restored, past: s.past.slice(0, -1), future: [s.doc, ...s.future].slice(0, HISTORY_LIMIT), saveStatus: s.access === 'VIEW' ? 'readonly' : 'dirty', dirtyAt: Date.now(), sel: { ids: s.sel.ids.filter((i) => restored.nodes[i]), sub: null } });
    },

    redo: () => {
      const s = get();
      const next = s.future[0];
      if (!next) return;
      const restored = keepNavigation(s.doc, next);
      set({ doc: restored, past: [...s.past, { doc: s.doc, t: Date.now() }].slice(-HISTORY_LIMIT), future: s.future.slice(1), saveStatus: s.access === 'VIEW' ? 'readonly' : 'dirty', dirtyAt: Date.now(), sel: { ids: s.sel.ids.filter((i) => restored.nodes[i]), sub: null } });
    },

    toggleOpen: (nodeId, group) =>
      set((s) => {
        const k = `${nodeId}:${group}`;
        return { openTargets: { ...s.openTargets, [k]: s.openTargets[k] ? 0 : 1 } };
      }),

    setAllOpen: (kind, open, nodeIds) => {
      const s = get();
      const targets: Record<string, number> = { ...s.openTargets };
      const ids = nodeIds ?? s.doc.order;
      for (const id of ids) {
        const n = s.doc.nodes[id];
        if (!n) continue;
        for (const p of buildParts(n)) {
          if (!p.anim) continue;
          const isDrawer = p.anim.group.startsWith('drawer');
          if (kind === 'door' && isDrawer) continue;
          if (kind === 'drawer' && !isDrawer) continue;
          targets[`${id}:${p.anim.group}`] = open ? 1 : 0;
        }
      }
      set({ openTargets: targets });
    },

    markSaving: () => set({ saveStatus: 'saving', saveError: null }),
    markSaved: (version, updatedAt, docAtRequest) =>
      set((s) => ({
        baseVersion: version,
        lastSavedAt: Date.now(),
        saveError: null,
        // only claim "saved" if nothing changed while the request was in flight
        saveStatus: s.doc === docAtRequest && !s.tx ? 'saved' : 'dirty',
        meta: s.meta ? { ...s.meta, updatedAt } : s.meta,
      })),
    markSaveFailed: (status, msg) => set({ saveStatus: status, saveError: msg }),
  };
});

export { descendants, topAncestor };
