'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { entityBounds, entityHandles, floorBounds } from '@/lib/plan/entities';
import { boundsOf, dist, type Box } from '@/lib/plan/geom';
import { activeFloor } from '@/lib/plan/model';
import { pickEntity } from '@/lib/plan/pick';
import { roomsOf } from '@/lib/plan/rooms';
import { snapPoint, type SnapResult } from '@/lib/plan/snap';
import type { Drawable, PlanPointer } from '@/lib/plan/toolHost';
import type { Pt } from '@/lib/plan/types';
import { footprint } from '@/lib/scene';
import { useEditor } from '@/store/editor';
import { activateTool, nodesOnActiveFloor, planEngine, planHost } from '@/store/planHost';
import { usePlanUi, type View2D } from '@/store/planUi';
import { drawScene, toWorld, type DrawCtx } from './draw2d';

const DEFAULT_VIEW: View2D = { cx: 4000, cy: 3000, scale: 0.12 };
export const canvasRef: { current: HTMLCanvasElement | null } = { current: null };

export function PlanCanvas() {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const doc = useEditor((s) => s.doc);
  const access = useEditor((s) => s.access);
  const plan = doc.plan!;
  const floor = activeFloor(plan);
  const selection = usePlanUi((s) => s.selection);
  const hovered = usePlanUi((s) => s.hovered);
  const stored = usePlanUi((s) => s.views[floor.id]);
  const zoomReq = usePlanUi((s) => s.zoomRequest);
  const highlight = usePlanUi((s) => s.highlight);
  const typed = usePlanUi((s) => s.typed);
  const inputLabel = usePlanUi((s) => s.inputLabel);
  const tool = usePlanUi((s) => s.tool);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [cursorBox, setCursorBox] = useState<{ x: number; y: number } | null>(null);
  const view = stored ?? DEFAULT_VIEW;
  const st = useRef({ view, snap: null as SnapResult | null, raw: [0, 0] as Pt, pan: null as null | { x: number; y: number; cx: number; cy: number }, space: false, down: false, dirty: true, images: new Map<string, HTMLImageElement>(), lastFit: '' });
  st.current.view = view;

  const rooms = useMemo(() => roomsOf(floor, plan.roomProps), [floor, plan.roomProps]);
  const nodes = useMemo(() => nodesOnActiveFloor(doc), [doc]);

  const draw = useCallback(() => {
    const canvas = cv.current;
    if (!canvas) return;
    const g = canvas.getContext('2d');
    if (!g) return;
    const dpr = window.devicePixelRatio || 1;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const ui = usePlanUi.getState();
    const s = st.current;
    // reference images
    for (const e of Object.values(floor.entities)) {
      if (e.kind === 'reference' && !s.images.has(e.url)) {
        const img = new Image();
        img.onload = () => {
          s.dirty = true;
          requestFrame();
        };
        img.src = e.url;
        s.images.set(e.url, img);
      }
    }
    const ctx: DrawCtx = {
      g,
      w: size.w,
      h: size.h,
      view: s.view,
      plan,
      floor,
      rooms,
      nodes,
      selection: new Set(ui.selection),
      hovered: ui.hovered,
      images: s.images,
      mode: plan.mode,
      highlight: ui.highlight ? { at: ui.highlight.at, age: performance.now() - hlStart.current } : null,
    };
    const cursor: PlanPointer = { pt: s.snap?.pt ?? s.raw, raw: s.raw, snap: s.snap ?? { pt: s.raw, kind: 'none', guides: [], label: '' }, shift: false, alt: false, ctrl: false, scale: s.view.scale };
    const preview: Drawable[] = planEngine.preview(cursor);
    const grips: { p: Pt }[] = [];
    if (ui.selection.length === 1 && ui.tool === 'select' && !plan.locked) {
      const e = floor.entities[ui.selection[0]];
      if (e && !e.locked) grips.push(...entityHandles(floor, e).filter((h) => !(e.kind === 'column' && h.id !== 'c')));
    }
    drawScene(ctx, { preview, snap: ui.tool === 'select' && !(planEngine.state.mode === 'drag' || planEngine.state.mode === 'grip') ? null : s.snap, grips, cursor: s.raw });
    s.dirty = false;
    // keep animating the highlight pulse
    if (ui.highlight && performance.now() - hlStart.current < 900) requestFrame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floor, plan, rooms, nodes, size]);

  const hlStart = useRef(0);
  const frame = useRef(0);
  const requestFrame = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      draw();
    });
  }, [draw]);
  useEffect(() => {
    if (highlight) hlStart.current = performance.now();
    requestFrame();
  }, [highlight, requestFrame]);
  useEffect(() => requestFrame(), [draw, selection, hovered, view, requestFrame, typed, tool]);

  // canvas size
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const w = Math.max(100, Math.floor(r.width));
      const h = Math.max(100, Math.floor(r.height));
      const dpr = window.devicePixelRatio || 1;
      const c = cv.current!;
      c.width = Math.floor(w * dpr);
      c.height = Math.floor(h * dpr);
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
      setSize({ w, h });
    });
    ro.observe(el);
    canvasRef.current = cv.current;
    return () => ro.disconnect();
  }, []);

  const setView = useCallback((v: View2D) => {
    st.current.view = v;
    usePlanUi.getState().setView(usePlanUi.getState().views && floor.id, v);
  }, [floor.id]);

  const fit = useCallback(
    (box: Box | null, pad = 0.12) => {
      if (!box) return setView({ ...DEFAULT_VIEW });
      const w = Math.max(box.maxX - box.minX, 500);
      const h = Math.max(box.maxY - box.minY, 500);
      const scale = Math.min(size.w / (w * (1 + pad * 2)), size.h / (h * (1 + pad * 2)), 1.5);
      setView({ cx: (box.minX + box.maxX) / 2, cy: (box.minY + box.maxY) / 2, scale });
    },
    [setView, size],
  );

  // fit on first open of a floor that has content
  useEffect(() => {
    if (stored) return;
    const b = contentBox(floor, nodes);
    if (b) fit(b);
    else if (size.w > 150) fit({ minX: -1000, minY: -1000, maxX: 11000, maxY: 8000 }, 0); // empty floor: a 12 m x 9 m window
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floor.id, size.w > 150]);

  // zoom requests (View tab, room selector, outputs)
  useEffect(() => {
    if (!zoomReq) return;
    const s = st.current;
    if (zoomReq.kind === 'fit') fit(contentBox(floor, nodes));
    else if (zoomReq.kind === 'selection') {
      const sel = usePlanUi.getState().selection;
      let box: Box | null = null;
      for (const id of sel) {
        const e = floor.entities[id];
        const b = e ? entityBounds(floor, e) : doc.nodes[id] ? boundsOf(footprint(doc.nodes[id])) : null;
        if (b) box = box ? { minX: Math.min(box.minX, b.minX), minY: Math.min(box.minY, b.minY), maxX: Math.max(box.maxX, b.maxX), maxY: Math.max(box.maxY, b.maxY) } : b;
      }
      if (box) fit(box, 0.5);
      else planHost.say('Select something first (Shift+X zooms to the selection).', 'warn');
    } else if (zoomReq.kind === 'room' && zoomReq.room) fit(boundsOf(zoomReq.room), 0.3);
    else setView({ ...s.view, scale: Math.min(5, Math.max(0.004, s.view.scale * (zoomReq.kind === 'in' ? 1.25 : 0.8))) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomReq]);

  // ---------- pointer ----------
  const makePointer = useCallback(
    (e: { clientX: number; clientY: number; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }, forSnap = true): PlanPointer => {
      const r = cv.current!.getBoundingClientRect();
      const s = st.current;
      const raw = toWorld(s.view, size.w, size.h, e.clientX - r.left, e.clientY - r.top);
      const ui = usePlanUi.getState();
      const sel = new Set(ui.selection);
      const dragging = planEngine.state.mode === 'drag' || planEngine.state.mode === 'grip';
      const useSnap = forSnap && (ui.tool !== 'select' || dragging);
      const snap = useSnap
        ? snapPoint(floor, raw, plan.settings, { ref: planEngine.ref(), tol: 12 / s.view.scale, none: e.altKey, forceOrtho: e.shiftKey && !!planEngine.ref(), exclude: dragging ? sel : undefined })
        : ({ pt: raw, kind: 'none', guides: [], label: '' } as SnapResult);
      s.snap = snap;
      s.raw = raw;
      return { pt: snap.pt, raw, snap, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey, scale: s.view.scale };
    },
    [floor, plan.settings, size],
  );

  const updateHint = useCallback(() => {
    const ui = usePlanUi.getState();
    ui.setHint(planEngine.hint(), planEngine.inputLabel());
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    cv.current?.setPointerCapture(e.pointerId);
    setMenu(null);
    usePlanUi.getState().setContextMenu(null);
    const s = st.current;
    if (e.button === 1 || (e.button === 0 && (s.space || usePlanUi.getState().tool === 'pan'))) {
      s.pan = { x: e.clientX, y: e.clientY, cx: s.view.cx, cy: s.view.cy };
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    s.down = true;
    planEngine.pointerDown(makePointer(e));
    updateHint();
    requestFrame();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = st.current;
    if (s.pan) {
      const nx = s.pan.cx - (e.clientX - s.pan.x) / s.view.scale;
      const ny = s.pan.cy - (e.clientY - s.pan.y) / s.view.scale;
      setView({ ...s.view, cx: nx, cy: ny });
      return;
    }
    const p = makePointer(e);
    planEngine.pointerMove(p);
    const ui = usePlanUi.getState();
    ui.setCursor(p.pt, p.snap.label);
    setCursorBox({ x: e.clientX - cv.current!.getBoundingClientRect().left, y: e.clientY - cv.current!.getBoundingClientRect().top });
    if (ui.tool === 'select' && !s.down) {
      const id = planHost.nodeAt(p.raw, planHost.tol(8)) ?? pickEntity(floor, p.raw, planHost.tol(8), plan.mode, plan.locked);
      ui.setHovered(id);
    }
    requestFrame();
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const s = st.current;
    if (s.pan) {
      s.pan = null;
      return;
    }
    if (e.button !== 0) return;
    s.down = false;
    planEngine.pointerUp(makePointer(e));
    updateHint();
    requestFrame();
  };
  const onWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const s = st.current;
      const r = cv.current!.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      const before = toWorld(s.view, size.w, size.h, mx, my);
      const k = Math.exp(-e.deltaY * 0.0015);
      const scale = Math.min(5, Math.max(0.004, s.view.scale * k));
      // keep the world point under the cursor fixed
      const nv: View2D = { cx: before[0] - (mx - size.w / 2) / scale, cy: before[1] - (my - size.h / 2) / scale, scale };
      setView(nv);
    },
    [setView, size],
  );
  useEffect(() => {
    const c = cv.current;
    c?.addEventListener('wheel', onWheel, { passive: false });
    return () => c?.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const ui = usePlanUi.getState();
    if (ui.tool !== 'select') {
      // right-click finishes a multi-point operation, or cancels / leaves the tool
      const before = JSON.stringify(planEngine.state);
      planEngine.finish();
      if (JSON.stringify(planEngine.state) === before) {
        const r = planEngine.escape();
        if (r === 'selecting') ui.setTool('select');
      }
      updateHint();
      requestFrame();
      return;
    }
    const p = makePointer(e, false);
    const id = planHost.nodeAt(p.raw, planHost.tol(8)) ?? pickEntity(floor, p.raw, planHost.tol(8), plan.mode, plan.locked);
    if (id && !ui.selection.includes(id)) planHost.setSelection([id]);
    const r = cv.current!.getBoundingClientRect();
    setMenu({ x: e.clientX - r.left, y: e.clientY - r.top });
  };
  const onDoubleClick = () => {
    if (usePlanUi.getState().tool !== 'select') {
      planEngine.finish();
      updateHint();
      requestFrame();
    }
  };

  // ---------- keyboard ----------
  useEffect(() => {
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') st.current.space = false;
    };
    const onKey = async (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      const ui = usePlanUi.getState();
      if (ui.viewMode === '3d' || ui.prompt) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key;
      const ed = useEditor.getState();
      if (e.code === 'Space' && !ui.typed) {
        st.current.space = true;
        if (ui.tool !== 'furnish' && ui.tool !== 'door') e.preventDefault();
      }
      if (mod && k.toLowerCase() === 'z') return e.preventDefault(), void (e.shiftKey ? ed.redo() : ed.undo());
      if (mod && k.toLowerCase() === 'y') return e.preventDefault(), void ed.redo();
      if (mod && k.toLowerCase() === 'c') return e.preventDefault(), void planEngine.copySelection();
      if (mod && k.toLowerCase() === 'v') return e.preventDefault(), void (planEngine.paste(), requestFrame());
      if (mod && k.toLowerCase() === 'a') return e.preventDefault(), void planEngine.selectAll();
      if (mod && k.toLowerCase() === 's') return;
      if (k === 'Escape') {
        if (ui.typed) return void ui.setTyped('');
        const r = planEngine.escape();
        if (r === 'selecting') ui.setTool('select');
        updateHint();
        requestFrame();
        return;
      }
      if (k === 'Enter') {
        if (ui.typed) {
          const text = ui.typed;
          ui.setTyped('');
          await planEngine.submitTyped(text);
        } else planEngine.finish();
        updateHint();
        requestFrame();
        return;
      }
      if (k === 'Delete' || (k === 'Backspace' && !ui.typed && ui.tool === 'select')) {
        e.preventDefault();
        planEngine.deleteSelection();
        requestFrame();
        return;
      }
      if (k === 'Backspace' && ui.typed) return void ui.setTyped(ui.typed.slice(0, -1));
      if (k.startsWith('Arrow') && ui.tool === 'select' && ui.selection.length) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        planEngine.nudge(k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0, k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0);
        return;
      }
      if (e.shiftKey && k.toLowerCase() === 'z') return e.preventDefault(), ui.requestZoom('fit');
      if (e.shiftKey && k.toLowerCase() === 'x') return e.preventDefault(), ui.requestZoom('selection');
      // tool-specific keys (R rotate, F flip, C close ...)
      if (!mod && k.length === 1 && !ui.typed && planEngine.key(k)) {
        e.preventDefault();
        updateHint();
        requestFrame();
        return;
      }
      // typed numeric input
      if (!mod && /^[0-9.,<@;:\-xX×]$/.test(k) && planEngine.def.numeric) {
        if (/[xX×]/.test(k) && !ui.typed) return;
        e.preventDefault();
        ui.setTyped(ui.typed + (k === 'X' ? 'x' : k));
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [requestFrame, updateHint]);

  useEffect(() => {
    updateHint();
  }, [tool, updateHint]);

  const cursorStyle = access === 'VIEW' ? 'default' : tool === 'pan' || st.current.space ? 'grab' : tool === 'select' ? (hovered ? 'pointer' : 'default') : 'crosshair';
  const ref = planEngine.ref();
  const live = ref && st.current.snap ? { len: dist(ref, st.current.snap.pt) } : null;

  return (
    <div ref={wrap} className="absolute inset-0 select-none" data-testid="plan-canvas-wrap">
      <canvas ref={cv} data-testid="plan-canvas" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onContextMenu={onContextMenu} onDoubleClick={onDoubleClick} style={{ cursor: cursorStyle, touchAction: 'none', display: 'block' }} />
      {(typed || (live && plan.settings.dynamicInput && inputLabel)) && cursorBox && (
        <div className="pointer-events-none absolute z-10 rounded-md border border-gold bg-ink px-2 py-1 text-xs font-semibold text-gold-soft shadow-lg" style={{ left: Math.min(cursorBox.x + 16, size.w - 180), top: Math.min(cursorBox.y + 18, size.h - 40) }} data-testid="dynamic-input">
          {inputLabel ?? 'Value'}: {typed ? <span className="text-white">{typed}<span className="animate-pulse">|</span></span> : <span className="text-white">{live ? Math.round(live.len) : ''}</span>}
          {typed && <span className="ml-2 font-normal text-stone">Enter to apply</span>}
        </div>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
    </div>
  );
}

function contentBox(floor: ReturnType<typeof activeFloor>, nodes: ReturnType<typeof nodesOnActiveFloor>): Box | null {
  let box = floorBounds(floor);
  for (const n of nodes) {
    const b = boundsOf(footprint(n));
    box = box ? { minX: Math.min(box.minX, b.minX), minY: Math.min(box.minY, b.minY), maxX: Math.max(box.maxX, b.maxX), maxY: Math.max(box.maxY, b.maxY) } : b;
  }
  return box;
}

function ContextMenu({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const sel = usePlanUi((s) => s.selection);
  const ed = useEditor.getState();
  const items: { label: string; run: () => void; disabled?: boolean; danger?: boolean }[] = [
    { label: 'Copy', run: () => planEngine.copySelection(), disabled: !sel.length },
    { label: 'Paste', run: () => planEngine.paste() },
    { label: 'Duplicate', run: () => { planEngine.copySelection(); planEngine.paste([300, 300]); }, disabled: !sel.length },
    { label: 'Move…', run: () => activateTool('move'), disabled: !sel.length },
    { label: 'Mirror…', run: () => activateTool('mirror'), disabled: !sel.length },
    { label: 'Zoom to selection', run: () => usePlanUi.getState().requestZoom('selection'), disabled: !sel.length },
    { label: 'Delete', run: () => planEngine.deleteSelection(), disabled: !sel.length, danger: true },
    { label: 'Undo', run: () => ed.undo() },
  ];
  return (
    <ul className="absolute z-20 w-44 overflow-hidden rounded-lg border border-sand bg-paper py-1 text-sm shadow-xl" style={{ left: x, top: y }} role="menu" data-testid="context-menu">
      {items.map((i) => (
        <li key={i.label}>
          <button role="menuitem" disabled={i.disabled} className={`block w-full px-3 py-1.5 text-left hover:bg-linen disabled:opacity-40 ${i.danger ? 'text-danger' : ''}`} onClick={() => { i.run(); onClose(); }}>
            {i.label}
          </button>
        </li>
      ))}
    </ul>
  );
}
