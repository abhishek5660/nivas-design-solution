'use client';
import { LIBRARY, createLibraryNode } from '@/components/editor/LeftPanel';
import { furnitureById } from '@/lib/build/furniture';
import { uid } from '@/lib/build/wardrobe';
import { ToolEngine } from '@/lib/plan/engine';
import { mirrorPt, rad, rotatePt, deg, norm, sub, dot, boundsOf } from '@/lib/plan/geom';
import { activeFloor, updateFloor } from '@/lib/plan/model';
import { roomsOf } from '@/lib/plan/rooms';
import { TOOLS } from '@/lib/plan/tools';
import type { NodeOp, PlanHost, ToolId, ToolOptions } from '@/lib/plan/toolHost';
import type { Floor, PlanModel, Pt, Room } from '@/lib/plan/types';
import { addNodeToDoc, checkPlacement, footprint, makeNode, snapNode } from '@/lib/scene';
import type { SceneDoc, SceneNode } from '@/lib/types';
import { descendants, useEditor } from './editor';
import { usePlanUi } from './planUi';

let batchKey: string | undefined;
let batchCounter = 0;

const doc = (): SceneDoc => useEditor.getState().doc;
const plan = (): PlanModel => {
  const p = doc().plan;
  if (!p) throw new Error('This project has no floor plan yet.');
  return p;
};

/** Furniture and cabinet nodes standing on the active floor. */
export function nodesOnActiveFloor(d: SceneDoc = doc()): SceneNode[] {
  const p = d.plan;
  if (!p) return [];
  const f = activeFloor(p);
  const first = p.buildings[0].floors[0].id;
  return Object.values(d.nodes).filter((n) => n.type !== 'group' && n.visible && (n.floorId ?? first) === f.id);
}

export function setPlan(fn: (p: PlanModel) => PlanModel, key?: string) {
  const d = doc();
  if (!d.plan) return;
  useEditor.getState().commit({ ...d, plan: fn(d.plan) }, key);
}

function commitDocParts(next: SceneDoc) {
  useEditor.getState().commit(next, batchKey);
}

const FLOOR_Y = (n: SceneNode, f: Floor) => f.elevation + (n.position[1] - 0);

export const planHost: PlanHost = {
  plan,
  floor: () => activeFloor(plan()),
  rooms: (): Room[] => roomsOf(activeFloor(plan()), plan().roomProps),
  settings: () => plan().settings,
  options(tool: ToolId): ToolOptions {
    return { ...(TOOLS[tool]?.defaults ?? {}), ...(usePlanUi.getState().toolOptions[tool] ?? {}) };
  },
  setOption: (tool, key, value) => usePlanUi.getState().setOption(tool, key, value),
  commit(_label, floor, selectIds) {
    const d = doc();
    const p = d.plan!;
    useEditor.getState().commit({ ...d, plan: updateFloor(p, p.activeFloorId, () => floor) }, batchKey);
    if (selectIds) planHost.setSelection(selectIds);
  },
  selection: () => usePlanUi.getState().selection,
  setSelection(ids) {
    usePlanUi.getState().setSelection(ids);
    const nodes = ids.filter((i) => doc().nodes[i]);
    const ed = useEditor.getState();
    if (nodes.length !== ed.sel.ids.length || nodes.some((n, i) => ed.sel.ids[i] !== n)) ed.select(nodes);
  },
  placeFurniture(itemId, at, rotation) {
    const d = doc();
    const p = d.plan!;
    const f = activeFloor(p);
    let node: SceneNode;
    if (itemId.startsWith('lib:')) {
      const item = LIBRARY.find((l) => l.id === itemId.slice(4));
      if (!item) {
        planHost.say('That item is no longer available.', 'error');
        return null;
      }
      node = createLibraryNode(item);
    } else {
      if (!furnitureById(itemId)) {
        planHost.say('Unknown furniture item.', 'error');
        return null;
      }
      node = makeNode('furniture', { params: { kind: itemId } });
    }
    node.floorId = f.id;
    const baseY = node.position[1];
    node.position = [at[0], f.elevation + baseY, at[1]];
    node.rotationY = rotation;
    const snapped = snapNode(d, node, node.position, rotation, p.settings.snap.grid ? p.settings.grid.spacing : null, true);
    node = { ...node, position: [snapped.position[0], f.elevation + baseY, snapped.position[2]], rotationY: snapped.rotationY };
    const next = addNodeToDoc(d, node);
    useEditor.getState().commit(next, batchKey);
    const issues = checkPlacement(next, node);
    if (issues.length) planHost.say(issues[0].message, 'warn');
    return node.id;
  },
  nodeAt(pt, tol) {
    let best: { id: string; a: number } | null = null;
    for (const n of nodesOnActiveFloor()) {
      const fp = footprint(n);
      const b = boundsOf(fp);
      if (pt[0] < b.minX - tol || pt[0] > b.maxX + tol || pt[1] < b.minY - tol || pt[1] > b.maxY + tol) continue;
      if (!pointInPoly(pt, fp) && !nearPoly(pt, fp, tol)) continue;
      const a = (b.maxX - b.minX) * (b.maxY - b.minY);
      if (!best || a < best.a) best = { id: n.id, a };
    }
    return best?.id ?? null;
  },
  nodesInBox(box, crossing) {
    const out: string[] = [];
    for (const n of nodesOnActiveFloor()) {
      const b = boundsOf(footprint(n));
      const inside = b.minX >= box.minX && b.maxX <= box.maxX && b.minY >= box.minY && b.maxY <= box.maxY;
      const touch = b.minX <= box.maxX && b.maxX >= box.minX && b.minY <= box.maxY && b.maxY >= box.minY;
      if (crossing ? touch : inside) out.push(n.id);
    }
    return out;
  },
  transformNodes(op: NodeOp, ids: string[]): string[] {
    const d = doc();
    const targets = new Set(descendants(d, ids));
    const nodes = { ...d.nodes };
    let order = [...d.order];
    const created: string[] = [];
    for (const id of targets) {
      const n = nodes[id];
      if (!n || n.locked) continue;
      if (op.type === 'delete') {
        delete nodes[id];
        order = order.filter((i) => i !== id);
        continue;
      }
      const at: Pt = [n.position[0], n.position[2]];
      let p2 = at;
      let rot = n.rotationY;
      if (op.type === 'move' || op.type === 'copy') p2 = [at[0] + op.d[0], at[1] + op.d[1]];
      else if (op.type === 'rotate') {
        p2 = rotatePt(at, op.angle, op.origin);
        rot = n.rotationY - op.angle; // plan angles run clockwise on screen, node rotation runs the other way
      } else if (op.type === 'mirror') {
        p2 = mirrorPt(at, op.a, op.b);
        const u = norm(sub(op.b, op.a));
        const front: Pt = [Math.sin(rad(n.rotationY)), Math.cos(rad(n.rotationY))];
        const k = 2 * dot(front, u);
        const f2: Pt = [k * u[0] - front[0], k * u[1] - front[1]];
        rot = deg(Math.atan2(f2[0], f2[1]));
      }
      const moved: SceneNode = { ...n, position: [p2[0], n.position[1], p2[1]], rotationY: ((rot % 360) + 540) % 360 - 180 };
      if (op.type === 'copy' || (op.type === 'mirror' && op.keep)) {
        const nid = uid('cp');
        const copy = { ...structuredClone(moved), id: nid, name: n.name.replace(/ copy( \d+)?$/, '') + ' copy' };
        nodes[nid] = copy;
        order.push(nid);
        created.push(nid);
      } else nodes[id] = moved;
    }
    commitDocParts({ ...d, nodes, order });
    return created;
  },
  nodeOutline(id) {
    const n = doc().nodes[id];
    return n && n.type !== 'group' ? footprint(n) : null;
  },
  addComponent(def) {
    setPlan((p) => ({ ...p, components: [...p.components, def] }), batchKey);
  },
  batch(_label, fn) {
    const prev = batchKey;
    batchKey = prev ?? `plan-batch-${batchCounter++}`;
    try {
      fn();
    } finally {
      batchKey = prev;
    }
  },
  say: (text, level = 'info') => usePlanUi.getState().say(text, level),
  prompt: (title, initial = '') => usePlanUi.getState().openPrompt(title, initial),
  setTool(tool) {
    planEngine.setTool(tool);
    usePlanUi.getState().setTool(tool);
  },
  payload: () => usePlanUi.getState().payload,
  locked: () => !!doc().plan?.locked || useEditor.getState().access === 'VIEW',
  tol(px) {
    const p = plan();
    const v = usePlanUi.getState().views[p.activeFloorId];
    return px / (v?.scale ?? 0.1);
  },
};

function pointInPoly(p: Pt, poly: Pt[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (poly[i][1] > p[1] !== poly[j][1] > p[1] && p[0] < ((poly[j][0] - poly[i][0]) * (p[1] - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) inside = !inside;
  }
  return inside;
}
function nearPoly(p: Pt, poly: Pt[], tol: number) {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ab = sub(b, a);
    const l2 = ab[0] * ab[0] + ab[1] * ab[1] || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2));
    if (Math.hypot(p[0] - (a[0] + ab[0] * t), p[1] - (a[1] + ab[1] * t)) <= tol) return true;
  }
  return false;
}

/** One engine for the whole workspace. */
export const planEngine = new ToolEngine(planHost);

export function activateTool(tool: ToolId) {
  planEngine.setTool(tool);
  usePlanUi.getState().setTool(tool);
  usePlanUi.getState().setHint(planEngine.hint(), planEngine.inputLabel());
}

export { FLOOR_Y };
