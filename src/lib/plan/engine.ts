import { add, boundsOf, dist, sub, type Box } from './geom';
import { entityHandles, translateEntity } from './entities';
import { removeEntities } from './model';
import { applyGrip, copyEntities, expandSelection, moveEntities } from './ops';
import { pickEntity, pickInBox, withGroups } from './pick';
import { floorWalls, normalizeWalls } from './walls';
import { TOOLS, toolOptionDefaults, parseTyped } from './tools';
import type { Drawable, PlanHost, PlanPointer, PlanTool, ToolId, ToolState } from './toolHost';
import type { Entity, Pt } from './types';

export interface EngineView {
  tool: ToolId;
  hint: string;
  inputLabel: string | null;
}

/**
 * Drives the active drawing/editing tool. UI-agnostic: the canvas feeds it pointer/keyboard events and
 * renders `preview()`; every committed change goes through the host (one undo step per operation).
 */
export class ToolEngine {
  tool: ToolId = 'select';
  state: ToolState = {};
  private clipboard: Entity[] = [];
  /** last pointer position (used by numeric entry to know the cursor direction) */
  cursor: Pt = [0, 0];

  constructor(private host: PlanHost) {}

  get def(): PlanTool {
    return TOOLS[this.tool];
  }

  setHost(host: PlanHost) {
    this.host = host;
  }

  setTool(id: ToolId): boolean {
    if (!TOOLS[id]) return false;
    this.def.cancel(this.host, this.state);
    this.tool = id;
    this.state = {};
    for (const [k, v] of Object.entries(toolOptionDefaults(id))) if (this.host.options(id)[k] === undefined) this.host.setOption(id, k, v);
    this.def.start?.(this.host, this.state);
    return true;
  }

  hint(): string {
    return this.def.hint(this.state);
  }

  inputLabel(): string | null {
    return this.def.inputLabel?.(this.state) ?? null;
  }

  /** the previous point of the tool in progress (for orthogonal snapping and dynamic input) */
  ref(): Pt | null {
    if (this.tool === 'select') return this.state.mode === 'drag' ? this.state.start ?? null : null;
    return this.def.ref?.(this.state) ?? null;
  }

  // ---------- pointer ----------

  pointerDown(ev: PlanPointer) {
    this.cursor = ev.pt;
    if (this.tool === 'select') return this.selectDown(ev);
    if (this.tool === 'pan') return;
    this.def.down?.(this.host, this.state, ev);
  }

  pointerMove(ev: PlanPointer) {
    this.cursor = ev.pt;
    if (this.tool === 'select') return this.selectMove(ev);
    this.def.move?.(this.host, this.state, ev);
  }

  pointerUp(ev: PlanPointer) {
    if (this.tool === 'select') return this.selectUp(ev);
    this.def.up?.(this.host, this.state, ev);
  }

  /** Enter / right-click / double-click. */
  finish() {
    this.def.finish?.(this.host, this.state);
  }

  /** Escape / right-click: cancel the operation in progress; if idle, return to the Select tool. */
  escape(): 'cancelled' | 'selecting' | 'cleared' | 'none' {
    if (this.tool === 'select') {
      if (this.state.mode && this.state.mode !== 'idle') {
        this.state = {};
        return 'cancelled';
      }
      if (this.host.selection().length) {
        this.host.setSelection([]);
        return 'cleared';
      }
      return 'none';
    }
    if (this.def.cancel(this.host, this.state)) return 'cancelled';
    this.setTool('select');
    return 'selecting';
  }

  key(key: string): boolean {
    return this.def.key?.(this.host, this.state, key) ?? false;
  }

  /** Typed value from the dynamic input box. Returns true if the active tool accepted it. */
  async submitTyped(text: string): Promise<boolean> {
    if (!this.def.numeric) {
      this.host.say('This tool does not take typed values.', 'warn');
      return false;
    }
    if (!parseTyped(text, this.host.settings()) && this.tool !== 'scale' && this.tool !== 'offset') {
      this.host.say('Could not read that value. Examples: 3000   3000<45   @1000,500   4000,3000', 'warn');
      return false;
    }
    const ok = await this.def.numeric(this.host, this.state, text, this.cursor);
    if (!ok) this.host.say('That value is not valid at this step.', 'warn');
    return !!ok;
  }

  preview(cur: PlanPointer): Drawable[] {
    if (this.tool === 'select') return this.selectPreview(cur);
    return this.def.preview?.(this.host, this.state, cur) ?? [];
  }

  // ---------- select tool ----------

  private entIds(): string[] {
    const f = this.host.floor();
    return this.host.selection().filter((i) => !!f.entities[i]);
  }
  private nodeIds(): string[] {
    const f = this.host.floor();
    return this.host.selection().filter((i) => !f.entities[i] && this.host.nodeOutline(i));
  }

  private selectDown(ev: PlanPointer) {
    const h = this.host;
    const f = h.floor();
    const sel = h.selection();
    const mode = h.plan().mode;
    const tolPx = h.tol(8);
    this.state = { mode: 'idle' };
    if (h.locked()) {
      // read-only: selection still works so users can inspect; no editing gestures
    } else if (sel.length === 1 && f.entities[sel[0]] && !f.entities[sel[0]].locked) {
      const e = f.entities[sel[0]];
      for (const hd of entityHandles(f, e)) {
        if (dist(hd.p, ev.raw) <= tolPx) {
          this.state = { mode: 'grip', id: e.id, handle: hd.id, moved: false };
          return;
        }
      }
    }
    const nodeHit = mode === 'production' || mode === 'interior' || mode === 'architecture' ? h.nodeAt(ev.raw, tolPx) : null;
    const entHit = pickEntity(f, ev.raw, tolPx, mode, h.locked());
    const hit = nodeHit ?? entHit;
    if (hit) {
      const ids = withGroups(f, [hit]);
      if (ev.shift) h.setSelection(sel.includes(hit) ? sel.filter((i) => !ids.includes(i)) : [...new Set([...sel, ...ids])]);
      else if (!sel.includes(hit)) h.setSelection(ids);
      this.state = { mode: 'drag', start: ev.pt, delta: [0, 0], moved: false, startRaw: ev.raw };
      return;
    }
    if (!ev.shift) h.setSelection([]);
    this.state = { mode: 'box', start: ev.raw, end: ev.raw };
  }

  private selectMove(ev: PlanPointer) {
    const st = this.state;
    if (st.mode === 'drag') {
      st.delta = sub(ev.pt, st.start);
      if (!st.moved && dist(ev.raw, st.startRaw) > this.host.tol(4)) st.moved = true;
    } else if (st.mode === 'box') st.end = ev.raw;
    else if (st.mode === 'grip') {
      st.to = ev.pt;
      st.moved = true;
    }
  }

  private selectUp(ev: PlanPointer) {
    const st = this.state;
    const h = this.host;
    this.state = {};
    if (st.mode === 'drag' && st.moved && !h.locked()) {
      const d = sub(ev.pt, st.start);
      if (Math.hypot(d[0], d[1]) < 0.01) return;
      const ids = this.entIds().filter((i) => !h.floor().entities[i].locked);
      const nodes = this.nodeIds();
      h.batch('Move', () => {
        if (ids.length) h.commit('Move', normalizeWalls(moveEntities(h.floor(), ids, d)));
        if (nodes.length) h.transformNodes({ type: 'move', d }, nodes);
      });
    } else if (st.mode === 'grip' && st.moved && st.to) {
      const f = h.floor();
      const e = f.entities[st.id];
      if (!e) return;
      const r = applyGrip(f, e, st.handle, st.to);
      if (!r.ok) return h.say(r.error, 'error');
      h.commit('Edit', normalizeWalls(r.value));
    } else if (st.mode === 'box') {
      const a: Pt = st.start;
      const b: Pt = ev.raw;
      if (dist(a, b) < h.tol(4)) return;
      const box: Box = boundsToBox(a, b);
      const s = h.settings().selection.mode;
      const crossing = s === 'crossing' || (s === 'auto' && b[0] < a[0]);
      const ids = [...pickInBox(h.floor(), box, crossing, h.plan().mode, h.locked()), ...h.nodesInBox(box, crossing)];
      const f = h.floor();
      const all = withGroups(f, ids);
      h.setSelection(ev.shift ? [...new Set([...h.selection(), ...all])] : all);
      h.say(`${all.length} object${all.length === 1 ? '' : 's'} selected.`);
    }
  }

  private selectPreview(cur: PlanPointer): Drawable[] {
    const st = this.state;
    const h = this.host;
    if (st.mode === 'drag' && st.moved) {
      const f = h.floor();
      const out: Drawable[] = [];
      for (const id of expandSelection(f, this.entIds())) {
        const e = f.entities[id];
        if (e && e.kind !== 'door' && e.kind !== 'window') out.push({ kind: 'entity', entity: translateEntity(e, st.delta), style: 'preview' });
      }
      for (const id of this.nodeIds()) {
        const o = h.nodeOutline(id);
        if (o) out.push({ kind: 'poly', pts: o.map((p) => add(p, st.delta)), closed: true, style: 'preview' });
      }
      return out;
    }
    if (st.mode === 'grip' && st.to) {
      const f = h.floor();
      const e = f.entities[st.id];
      if (!e) return [];
      const r = applyGrip(f, e, st.handle, st.to);
      if (!r.ok) return [{ kind: 'text', pts: [cur.pt], text: r.error, style: 'bad' }];
      const ne = r.value.entities[st.id];
      return ne ? [{ kind: 'entity', entity: ne, style: 'preview' }] : [];
    }
    if (st.mode === 'box') {
      const a: Pt = st.start;
      const b: Pt = st.end;
      const s = h.settings().selection.mode;
      const crossing = s === 'crossing' || (s === 'auto' && b[0] < a[0]);
      return [{ kind: 'rect', pts: [a, b], style: crossing ? 'ok' : 'preview' }];
    }
    return [];
  }

  // ---------- commands ----------

  deleteSelection(): number {
    const h = this.host;
    if (h.locked()) {
      h.say('The design is locked.', 'warn');
      return 0;
    }
    const f = h.floor();
    const ids = this.entIds().filter((i) => !f.entities[i].locked);
    const nodes = this.nodeIds();
    if (!ids.length && !nodes.length) return 0;
    h.batch('Delete', () => {
      if (ids.length) h.commit('Delete', removeEntities(f, expandSelection(f, ids)));
      if (nodes.length) h.transformNodes({ type: 'delete' }, nodes);
    });
    h.setSelection([]);
    return ids.length + nodes.length;
  }

  /** Move the selection by a fixed amount (View → move buttons / arrow keys). */
  nudge(dx: number, dy: number): boolean {
    const h = this.host;
    if (h.locked()) {
      h.say('The design is locked.', 'warn');
      return false;
    }
    const f = h.floor();
    const ids = this.entIds().filter((i) => !f.entities[i].locked);
    const nodes = this.nodeIds();
    if (!ids.length && !nodes.length) {
      h.say('Select an object first.', 'warn');
      return false;
    }
    h.batch('Nudge', () => {
      if (ids.length) h.commit('Move', normalizeWalls(moveEntities(f, ids, [dx, dy])));
      if (nodes.length) h.transformNodes({ type: 'move', d: [dx, dy] }, nodes);
    });
    return true;
  }

  copySelection() {
    const f = this.host.floor();
    this.clipboard = expandSelection(f, this.entIds()).map((id) => structuredClone(f.entities[id]));
    this.host.say(`${this.clipboard.length} object${this.clipboard.length === 1 ? '' : 's'} copied.`);
  }

  paste(offset: Pt = [500, 500]) {
    const h = this.host;
    if (!this.clipboard.length) return void h.say('The clipboard is empty. Select objects and copy them first (Ctrl+C).', 'warn');
    if (h.locked()) return void h.say('The design is locked.', 'warn');
    // paste as copies of the stored snapshot
    let f = h.floor();
    const tmp = { ...f, entities: { ...f.entities }, order: [...f.order] };
    for (const e of this.clipboard) {
      tmp.entities[e.id] = e;
      if (!tmp.order.includes(e.id)) tmp.order.push(e.id);
    }
    const r = copyEntities(tmp, this.clipboard.map((e) => e.id), offset);
    // drop the temporary originals again
    const entities = { ...r.floor.entities };
    const order = r.floor.order.filter((i) => !this.clipboard.some((c) => c.id === i) || f.entities[i]);
    for (const c of this.clipboard) if (!f.entities[c.id]) delete entities[c.id];
    f = { ...r.floor, entities, order };
    h.commit('Paste', normalizeWalls(f), r.newIds);
  }

  selectAll() {
    const f = this.host.floor();
    this.host.setSelection(f.order.filter((i) => f.entities[i] && !f.entities[i].hidden && !f.entities[i].locked && f.entities[i].kind !== 'hatch'));
  }
}

const boundsToBox = (a: Pt, b: Pt): Box => ({ minX: Math.min(a[0], b[0]), minY: Math.min(a[1], b[1]), maxX: Math.max(a[0], b[0]), maxY: Math.max(a[1], b[1]) });

export { boundsOf, floorWalls };
