import { ToolEngine } from '@/lib/plan/engine';
import { activeFloor, makePlan, updateFloor } from '@/lib/plan/model';
import { computeRooms } from '@/lib/plan/rooms';
import { snapPoint } from '@/lib/plan/snap';
import { TOOLS } from '@/lib/plan/tools';
import { rectCorners } from '@/lib/plan/entities';
import type { ComponentDef, Entity, Floor, PlanModel, Pt } from '@/lib/plan/types';
import type { NodeOp, PlanHost, PlanPointer, ToolId, ToolOptions } from '@/lib/plan/toolHost';

/** In-memory host used by tests: records history, messages and furniture nodes. */
export class TestHost implements PlanHost {
  plan_: PlanModel = makePlan(true);
  history: PlanModel[] = [];
  messages: { text: string; level: string }[] = [];
  sel: string[] = [];
  opts: Record<string, ToolOptions> = {};
  nodes: Record<string, { pos: Pt; w: number; d: number; rot: number }> = {};
  promptAnswer: string | null = 'Answer';
  scale = 0.1; // px per mm
  payload_: Record<string, unknown> | null = null;
  isLocked = false;
  batchDepth = 0;
  commits = 0;

  plan() { return this.plan_; }
  floor(): Floor { return activeFloor(this.plan_); }
  rooms() { return computeRooms(this.floor(), this.plan_.roomProps); }
  settings() { return this.plan_.settings; }
  options(tool: ToolId): ToolOptions { return { ...(TOOLS[tool]?.defaults ?? {}), ...(this.opts[tool] ?? {}) }; }
  setOption(tool: ToolId, key: string, value: string | number | boolean) { this.opts[tool] = { ...(this.opts[tool] ?? {}), [key]: value }; }
  commit(_label: string, floor: Floor, selectIds?: string[]) {
    if (!this.batchDepth) this.history.push(this.plan_);
    this.plan_ = updateFloor(this.plan_, this.plan_.activeFloorId, () => floor);
    this.commits++;
    if (selectIds) this.sel = selectIds;
  }
  selection() { return this.sel; }
  setSelection(ids: string[]) { this.sel = ids; }
  placeFurniture(itemId: string, at: Pt, rotation: number) {
    const id = `node_${Object.keys(this.nodes).length + 1}`;
    this.nodes[id] = { pos: at, w: 1800, d: 900, rot: rotation };
    void itemId;
    return id;
  }
  nodeAt(pt: Pt, tol: number) {
    for (const [id, n] of Object.entries(this.nodes)) if (Math.abs(pt[0] - n.pos[0]) <= n.w / 2 + tol && Math.abs(pt[1] - n.pos[1]) <= n.d / 2 + tol) return id;
    return null;
  }
  nodesInBox(box: { minX: number; minY: number; maxX: number; maxY: number }) {
    return Object.entries(this.nodes).filter(([, n]) => n.pos[0] >= box.minX && n.pos[0] <= box.maxX && n.pos[1] >= box.minY && n.pos[1] <= box.maxY).map(([id]) => id);
  }
  transformNodes(op: NodeOp, ids: string[]): string[] {
    const out: string[] = [];
    for (const id of ids) {
      const n = this.nodes[id];
      if (!n) continue;
      if (op.type === 'move') n.pos = [n.pos[0] + op.d[0], n.pos[1] + op.d[1]];
      else if (op.type === 'delete') delete this.nodes[id];
      else if (op.type === 'copy') {
        const nid = `${id}_copy${Object.keys(this.nodes).length}`;
        this.nodes[nid] = { ...n, pos: [n.pos[0] + op.d[0], n.pos[1] + op.d[1]] };
        out.push(nid);
      }
    }
    return out;
  }
  batch(_label: string, fn: () => void) {
    if (!this.batchDepth) this.history.push(this.plan_);
    this.batchDepth++;
    try { fn(); } finally { this.batchDepth--; }
  }
  nodeOutline(id: string) {
    const n = this.nodes[id];
    return n ? rectCorners([n.pos[0] - n.w / 2, n.pos[1] - n.d / 2], [n.pos[0] + n.w / 2, n.pos[1] + n.d / 2]) : null;
  }
  addComponent(def: ComponentDef) { this.plan_ = { ...this.plan_, components: [...this.plan_.components, def] }; }
  say(text: string, level: 'info' | 'warn' | 'error' = 'info') { this.messages.push({ text, level }); }
  prompt() { return Promise.resolve(this.promptAnswer); }
  setTool() { /* engine owns the active tool in tests */ }
  payload() { return this.payload_; }
  locked() { return this.isLocked; }
  tol(px: number) { return px / this.scale; }
  last() { return this.messages[this.messages.length - 1]; }
  undo() { const p = this.history.pop(); if (p) this.plan_ = p; }
  all(): Entity[] { const f = this.floor(); return f.order.map((i) => f.entities[i]); }
  ofKind<K extends Entity['kind']>(k: K): Extract<Entity, { kind: K }>[] { return this.all().filter((e): e is Extract<Entity, { kind: K }> => e.kind === k); }
}

export class Driver {
  host = new TestHost();
  engine = new ToolEngine(this.host);
  use(tool: ToolId) { this.engine.setTool(tool); return this; }
  ev(p: Pt, mods: Partial<Pick<PlanPointer, 'shift' | 'alt' | 'ctrl'>> = {}, snap = true): PlanPointer {
    const s = snapPoint(this.host.floor(), p, this.host.settings(), { ref: this.engine.ref(), tol: 12 / this.host.scale, none: !snap, forceOrtho: mods.shift, exclude: undefined });
    return { pt: s.pt, raw: p, snap: s, shift: !!mods.shift, alt: !!mods.alt, ctrl: !!mods.ctrl, scale: this.host.scale };
  }
  click(p: Pt, mods: Partial<Pick<PlanPointer, 'shift' | 'alt' | 'ctrl'>> = {}, snap = true) {
    const e = this.ev(p, mods, snap);
    this.engine.pointerMove(e);
    this.engine.pointerDown(e);
    this.engine.pointerUp(e);
    return this;
  }
  drag(a: Pt, b: Pt, mods: Partial<Pick<PlanPointer, 'shift' | 'alt' | 'ctrl'>> = {}) {
    const e1 = this.ev(a, mods);
    this.engine.pointerMove(e1);
    this.engine.pointerDown(e1);
    const e2 = this.ev(b, mods);
    this.engine.pointerMove(e2);
    this.engine.pointerUp(e2);
    return this;
  }
  type(text: string) { return this.engine.submitTyped(text); }
}
