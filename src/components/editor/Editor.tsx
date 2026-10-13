'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import * as THREE from 'three';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createLibraryNode, LIBRARY, LeftPanel } from './LeftPanel';
import { LogoMark } from '../Logo';
import { api, Dialog, Spinner, STATUS_LABEL, timeAgo } from '../ui';
import { BoqTab, DrawingsTab, HistoryTab, ProductionTab } from './DocTabs';
import { Hint } from './fields';
import { RenderDialog } from './RenderDialog';
import { RightPanel } from './RightPanel';
import { Toolbar } from './Toolbar';
import type { SceneDoc } from '@/lib/types';
import { parseProjectImport, validateDoc } from '@/lib/schema';
import { useEditor, type ProjectMeta, type Tab } from '@/store/editor';
import { clearDraft, readDraft, saveNow, useAutosave } from '@/store/save';
import { usePrefs } from '@/store/prefs';
import { PlanWorkspace } from '../plan/PlanShell';
import { roomToPlan } from '@/lib/plan/actions';
import { usePlanUi } from '@/store/planUi';
import { planEngine, planHost } from '@/store/planHost';

const Viewport = dynamic(() => import('./Viewport'), { ssr: false, loading: () => <div className="grid h-full place-items-center"><Spinner size={30} /></div> });
// bridge for drag-and-drop from the library
import { viewportApi } from './Viewport';
import { snapNode } from '@/lib/scene';

interface Props {
  meta: ProjectMeta;
  doc: SceneDoc;
  version: number;
  access: 'OWNER' | 'EDIT' | 'VIEW';
}

const TABS: [Tab, string][] = [['design', '3D Design'], ['drawings', '2D Drawings'], ['boq', 'BOQ & Quote'], ['production', 'Production'], ['history', 'History']];

export function Editor({ meta, doc, version, access }: Props) {
  const router = useRouter();
  const search = useSearchParams();
  const load = useEditor((s) => s.load);
  const ready = useEditor((s) => s.projectId === meta.id);
  const tab = useEditor((s) => s.ui.tab);
  const setUi = useEditor((s) => s.setUi);
  const [renderOpen, setRenderOpen] = useState(false);
  const [panel, setPanel] = useState<null | 'left' | 'right'>(null);
  const [recover, setRecover] = useState<{ doc: SceneDoc; ts: number } | null>(null);
  const [before, setBefore] = useState<{ url: string; pose: ReturnType<NonNullable<typeof viewportApi.getPose>> | null } | null>(null);
  const compareMode = useEditor((s) => s.ui.compareMode);

  useAutosave();
  useEffect(() => {
    // test hook (not exposed in production builds)
    if (process.env.NODE_ENV !== 'production') (window as unknown as { __nivas?: unknown }).__nivas = {
        store: useEditor,
        plan: { ui: usePlanUi, host: planHost, engine: planEngine },
        frames: () => viewportApi.gl?.info.render.frame ?? -1,
        /** number of meshes currently in the 3D scene (used by e2e) */
        meshes: () => { let n = 0; viewportApi.scene?.traverse((o) => { if ((o as THREE.Mesh).isMesh) n++; }); return n; },
        /** client-pixel position of a node's centre (used by e2e drag tests) */
        screenOf: (id: string) => {
          const n = useEditor.getState().doc.nodes[id];
          const cam = viewportApi.camera;
          const gl = viewportApi.gl;
          if (!n || !cam || !gl) return null;
          const v = new THREE.Vector3(n.position[0] * 0.001, (n.position[1] + n.size.h / 2) * 0.001, n.position[2] * 0.001).project(cam);
          const r = gl.domElement.getBoundingClientRect();
          return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
        },
      };
  }, []);

  useEffect(() => {
    usePrefs.getState().hydrate();
    load({ meta, doc, version, access });
    const t = search.get('tab') as Tab | null;
    if (t && TABS.some(([k]) => k === t)) setUi({ tab: t });
    // offer to recover unsaved local changes that are newer than the server copy
    const draft = readDraft(meta.id);
    if (draft && draft.baseVersion === version && JSON.stringify(draft.doc) !== JSON.stringify(doc)) {
      const rep = validateDoc(draft.doc);
      if (rep.ok) setRecover({ doc: rep.doc!, ts: draft.ts });
    } else if (draft) clearDraft(meta.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.id]);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      const st = useEditor.getState();
      if (st.ui.tab !== 'design') return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? st.redo() : st.undo(); }
      else if (mod && k === 'y') { e.preventDefault(); st.redo(); }
      else if (mod && k === 's') { e.preventDefault(); saveNow({ manual: true }); }
      else if (mod && k === 'c') { st.copySelected(); }
      else if (mod && k === 'v') { st.paste(); }
      else if (mod && k === 'd') { e.preventDefault(); st.duplicateSelected(); }
      else if (mod && k === 'g') { e.preventDefault(); e.shiftKey ? st.ungroupSelected() : st.groupSelected(); }
      else if (mod && k === 'a') { e.preventDefault(); st.select(st.doc.order.filter((i) => !st.doc.nodes[i].parentId)); }
      else if (k === 'delete' || k === 'backspace') { e.preventDefault(); st.deleteSelected(); }
      else if (k === 'escape') { st.select([]); st.setUi({ tool: 'select' }); }
      else if (k === 'f') st.requestView('fit-selection');
      else if (k === 'l' && !mod) st.toggleLock();
      else if (k === 'h' && !mod) st.toggleVisible();
      else if (k === 'r' && !mod) st.setUi({ tool: st.ui.tool === 'rotate' ? 'select' : 'rotate' });
      else if (k === 'v' && !mod) st.setUi({ tool: 'select' });
      else if (k.startsWith('arrow') && st.sel.ids.length) {
        e.preventDefault();
        const step = e.shiftKey ? 100 : e.altKey ? 1 : st.ui.snap || 10;
        const dx = k === 'arrowleft' ? -step : k === 'arrowright' ? step : 0;
        const dz = k === 'arrowup' ? -step : k === 'arrowdown' ? step : 0;
        st.beginTx();
        st.preview((d) => {
          const nodes = { ...d.nodes };
          for (const id of st.sel.ids) { const n = nodes[id]; if (n && !n.locked) nodes[id] = { ...n, position: [n.position[0] + dx, n.position[1], n.position[2] + dz] }; }
          return { ...d, nodes };
        });
        st.endTx({ validateIds: st.sel.ids });
      }
      else if (['1', '2', '3', '4', '5', '6'].includes(k) && !mod) st.requestView((['front', 'back', 'left', 'right', 'top', 'iso'] as const)[Number(k) - 1]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    const id = e.dataTransfer.getData('application/x-nivas-lib');
    if (!id) return;
    e.preventDefault();
    const item = LIBRARY.find((l) => l.id === id);
    if (!item) return;
    const pt = viewportApi.floorPoint?.(e.clientX, e.clientY) ?? undefined;
    const st = useEditor.getState();
    const node = createLibraryNode(item, pt);
    if (pt) {
      const r = snapNode(st.doc, node, node.position, 0, st.ui.snap || null);
      node.position = r.position;
      node.rotationY = r.rotationY;
    }
    st.addNode(node);
  }, []);

  function toggleCompare() {
    const st = useEditor.getState();
    if (!before) {
      const gl = viewportApi.gl;
      if (!gl || !viewportApi.scene || !viewportApi.camera) return;
      gl.render(viewportApi.scene, viewportApi.camera);
      setBefore({ url: gl.domElement.toDataURL('image/jpeg', 0.9), pose: viewportApi.getPose?.() ?? null });
      st.toast('info', '“Before” snapshot captured. Make your changes, keep the camera still, then press Compare again.');
      return;
    }
    if (!st.ui.compareMode && before.pose) viewportApi.setPose?.(before.pose.pos, before.pose.target);
    st.setUi({ compareMode: !st.ui.compareMode });
  }

  const isPlan = useEditor((s) => !!s.doc.plan?.enabled);
  if (!ready) return <div className="grid h-screen place-items-center"><Spinner size={32} /></div>;
  return (
    <div className="flex h-screen flex-col bg-ivory">
      <TopBar onBack={() => router.push('/dashboard')} />
      {recover && (
        <div className="flex items-center justify-between gap-3 border-b border-warn/40 bg-warn/10 px-4 py-2 text-sm">
          <span>Unsaved changes from {timeAgo(new Date(recover.ts))} were found in this browser (the app was closed before they were saved).</span>
          <span className="flex gap-2">
            <button className="btn btn-sm btn-gold" onClick={() => { useEditor.getState().replaceDoc(recover.doc); setRecover(null); }}>Recover them</button>
            <button className="btn btn-sm" onClick={() => { clearDraft(meta.id); setRecover(null); }}>Discard</button>
          </span>
        </div>
      )}
      <div className="relative flex min-h-0 flex-1">
        {tab === 'design' && !isPlan && <div className={`${panel === 'left' ? 'absolute inset-y-0 left-0 z-30 flex shadow-2xl' : 'hidden'} lg:static lg:flex lg:shadow-none`}><LeftPanel /></div>}
        <main className="relative min-w-0 flex-1" aria-label="Workspace">
          {tab === 'design' && isPlan ? (
            <PlanWorkspace
              viewport3d={
                <div className="absolute inset-0">
                  <Viewport />
                  <Toolbar onRender={() => usePlanUi.getState().setPanel('render')} onCompare={toggleCompare} />
                  {compareMode && before && <CompareOverlay url={before.url} onClose={() => useEditor.getState().setUi({ compareMode: false })} onReset={() => { setBefore(null); useEditor.getState().setUi({ compareMode: false }); }} />}
                </div>
              }
            />
          ) : tab === 'design' ? (
            <div className="absolute inset-0" onDragOver={(e) => e.dataTransfer.types.includes('application/x-nivas-lib') && e.preventDefault()} onDrop={onDrop}>
              <Viewport />
              <Toolbar onRender={() => setRenderOpen(true)} onCompare={toggleCompare} />
              <div className="pointer-events-auto absolute bottom-12 left-3 z-20 flex gap-2 lg:hidden">
                <button className="btn btn-sm shadow" onClick={() => setPanel((p) => (p === 'left' ? null : 'left'))} aria-expanded={panel === 'left'}>Library</button>
                <button className="btn btn-sm shadow" onClick={() => setPanel((p) => (p === 'right' ? null : 'right'))} aria-expanded={panel === 'right'}>Properties</button>
              </div>
              {compareMode && before && <CompareOverlay url={before.url} onClose={() => useEditor.getState().setUi({ compareMode: false })} onReset={() => { setBefore(null); useEditor.getState().setUi({ compareMode: false }); }} />}
              <StatusHints />
            </div>
          ) : (
            <div className="absolute inset-0 overflow-y-auto">
              {tab === 'drawings' && <DrawingsTab />}
              {tab === 'boq' && <BoqTab />}
              {tab === 'production' && <ProductionTab />}
              {tab === 'history' && <HistoryTab />}
            </div>
          )}
        </main>
        {tab === 'design' && !isPlan && <div className={`${panel === 'right' ? 'absolute inset-y-0 right-0 z-30 flex shadow-2xl' : 'hidden'} lg:static lg:flex lg:shadow-none`}><RightPanel /></div>}
      </div>
      <Toasts />
      {renderOpen && <RenderDialog onClose={() => setRenderOpen(false)} />}
    </div>
  );
}

function StatusHints() {
  const ui = useEditor((s) => s.ui);
  const sel = useEditor((s) => s.sel);
  const issues = useEditor((s) => Object.values(s.issues).flat().filter((i) => i.level === 'error').length);
  void issues;
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 right-3 flex items-end justify-between text-[11px] text-graphite">
      <div className="rounded-md bg-paper/85 px-2.5 py-1.5 shadow-card backdrop-blur">
        {ui.walkthrough ? 'Walkthrough: W A S D to move, drag to look, Shift to run' : sel.ids.length ? 'Drag to move · Alt = no wall snap · R rotates · double-click a door/drawer to open · gold dots resize' : 'Click a component to select · drag to orbit · right-drag to pan · scroll to zoom'}
      </div>
      <div className="rounded-md bg-paper/85 px-2.5 py-1.5 shadow-card backdrop-blur">Units: mm · Snap {ui.snap ? `${ui.snap} mm` : 'off'}</div>
    </div>
  );
}

function CompareOverlay({ url, onClose, onReset }: { url: string; onClose: () => void; onReset: () => void }) {
  const [x, setX] = useState(50);
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const move = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    setX(Math.max(2, Math.min(98, ((clientX - r.left) / r.width) * 100)));
  };
  return (
    <div ref={ref} className="absolute inset-0 z-20" onPointerMove={(e) => dragging.current && move(e.clientX)} onPointerUp={() => (dragging.current = false)} onPointerLeave={() => (dragging.current = false)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="Before" className="absolute inset-0 h-full w-full select-none object-fill" style={{ clipPath: `inset(0 ${100 - x}% 0 0)` }} draggable={false} />
      <div className="absolute inset-y-0 w-0.5 bg-gold shadow" style={{ left: `${x}%` }} />
      <button aria-label="Drag to compare before and after" className="absolute top-1/2 grid h-10 w-10 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize place-items-center rounded-full border-2 border-gold bg-ink text-gold-soft shadow-lg" style={{ left: `${x}%` }} onPointerDown={(e) => { dragging.current = true; (e.target as Element).setPointerCapture?.(e.pointerId); }}>⇆</button>
      <span className="absolute left-3 top-16 rounded bg-ink/80 px-2 py-0.5 text-xs font-semibold text-ivory">BEFORE</span>
      <span className="absolute right-3 top-16 rounded bg-ink/80 px-2 py-0.5 text-xs font-semibold text-ivory">AFTER (live)</span>
      <div className="absolute bottom-12 left-1/2 flex -translate-x-1/2 gap-2">
        <button className="btn btn-sm" onClick={onClose}>Close comparison</button>
        <button className="btn btn-sm" onClick={onReset}>New “before” snapshot</button>
      </div>
    </div>
  );
}

function Toasts() {
  const toasts = useEditor((s) => s.toasts);
  const dismiss = useEditor((s) => s.dismissToast);
  const color = { info: 'border-sand bg-paper', success: 'border-ok/40 bg-emerald-50', warning: 'border-warn/50 bg-amber-50', error: 'border-danger/50 bg-red-50' } as const;
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-[60] flex w-[min(92vw,30rem)] -translate-x-1/2 flex-col gap-2" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`fade-up pointer-events-auto flex items-start gap-3 rounded-lg border px-3.5 py-2.5 text-sm shadow-lg ${color[t.level]}`}>
          <span className="flex-1">{t.text}</span>
          <button className="text-mute hover:text-ink" onClick={() => dismiss(t.id)} aria-label="Dismiss">✕</button>
        </div>
      ))}
    </div>
  );
}

function SaveBadge() {
  const status = useEditor((s) => s.saveStatus);
  const err = useEditor((s) => s.saveError);
  const last = useEditor((s) => s.lastSavedAt);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);
  const map = {
    saved: { c: 'bg-emerald-100 text-emerald-800', t: `All changes saved${last ? ` · ${timeAgo(new Date(last))}` : ''}`, d: 'bg-ok' },
    dirty: { c: 'bg-amber-100 text-amber-800', t: 'Unsaved changes…', d: 'bg-warn' },
    saving: { c: 'bg-sky-100 text-sky-800', t: 'Saving…', d: 'bg-sky-500 animate-pulse' },
    error: { c: 'bg-red-100 text-red-800', t: 'Save failed - retrying', d: 'bg-danger' },
    conflict: { c: 'bg-red-100 text-red-800', t: 'Out of date - reload', d: 'bg-danger' },
    readonly: { c: 'bg-linen text-graphite', t: 'View only', d: 'bg-stone' },
  }[status];
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${map.c}`} role="status" aria-live="polite" title={err ?? undefined}>
        <span className={`h-2 w-2 rounded-full ${map.d}`} />
        {map.t}
      </span>
      {status === 'error' && <button className="btn btn-sm" onClick={() => saveNow({ manual: true })}>Retry now</button>}
      {status === 'conflict' && <button className="btn btn-sm btn-gold" onClick={() => window.location.reload()}>Reload latest</button>}
    </div>
  );
}

function TopBar({ onBack }: { onBack: () => void }) {
  const meta = useEditor((s) => s.meta)!;
  const access = useEditor((s) => s.access);
  const tab = useEditor((s) => s.ui.tab);
  const setUi = useEditor((s) => s.setUi);
  const status = useEditor((s) => s.saveStatus);
  const isPlan = useEditor((s) => !!s.doc.plan?.enabled);
  const saveError = useEditor((s) => s.saveError);
  const [name, setName] = useState(meta.name);
  const [shareOpen, setShareOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  useEffect(() => setName(meta.name), [meta.name]);

  async function patch(p: Record<string, string>) {
    try {
      const { project } = await api<{ project: Partial<ProjectMeta> }>(`/api/projects/${meta.id}`, { method: 'PATCH', body: JSON.stringify(p) });
      useEditor.setState((s) => ({ meta: s.meta ? { ...s.meta, ...project } : s.meta }));
    } catch (e) {
      useEditor.getState().toast('error', (e as Error).message);
      setName(meta.name);
    }
  }
  void onBack;

  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-sand bg-paper px-3 py-2">
      <Link href="/dashboard" className="flex items-center gap-2" aria-label="Back to dashboard" title="Back to dashboard (unsaved work is saved first)">
        <LogoMark size={30} />
      </Link>
      <div className="min-w-0">
        <input
          className="w-56 truncate rounded border border-transparent bg-transparent px-1.5 py-0.5 font-display text-xl font-semibold hover:border-sand focus:border-gold focus:bg-white focus:outline-none"
          value={name}
          maxLength={160}
          disabled={access === 'VIEW'}
          aria-label="Project name"
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name.trim() !== meta.name ? patch({ name: name.trim() }) : setName(meta.name)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <div className="flex items-center gap-2 px-1.5 text-[11px] text-mute">
          <span>{meta.customer || 'No customer'}</span>
          <span>·</span>
          <select className="rounded bg-transparent text-[11px] hover:bg-linen" value={meta.status} disabled={access === 'VIEW'} onChange={(e) => patch({ status: e.target.value })} aria-label="Project status">
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button className="underline" onClick={() => setInfoOpen(true)}>Details</button>
        </div>
      </div>
      <nav className="flex rounded-lg bg-linen p-0.5" aria-label="Project sections">
        {TABS.map(([k, l]) => (
          <button key={k} aria-current={tab === k ? 'page' : undefined} onClick={() => setUi({ tab: k })} className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${tab === k ? 'bg-ink text-gold-soft shadow' : 'text-graphite hover:bg-white'}`}>{k === 'design' && isPlan ? 'Design' : l}</button>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-2">
        {!isPlan && access !== 'VIEW' && (
          <button
            className="btn btn-sm"
            title="Rebuild this room as editable walls, doors and windows and open the 2D floor-plan workspace (you can undo it)"
            onClick={() => {
              const st = useEditor.getState();
              st.commit({ ...st.doc, plan: roomToPlan(st.doc) });
              st.toast('success', 'Converted to a floor plan. Your cabinets and furniture are kept on the ground floor.');
            }}
          >
            Convert to floor plan
          </button>
        )}
        <SaveBadge />
        <button className="btn btn-sm btn-primary" disabled={access === 'VIEW' || status === 'saving'} onClick={() => saveNow({ manual: true })}>Save</button>
        {access === 'OWNER' && <button className="btn btn-sm" onClick={() => setShareOpen(true)}>Share</button>}
        <Link href="/dashboard" className="btn btn-sm">Close</Link>
      </div>
      {saveError && status !== 'saved' && <p className="w-full text-xs text-danger" role="alert">{saveError}</p>}
      {shareOpen && <ShareDialog id={meta.id} onClose={() => setShareOpen(false)} />}
      {infoOpen && <InfoDialog onClose={() => setInfoOpen(false)} patch={patch} />}
    </header>
  );
}

function InfoDialog({ onClose, patch }: { onClose: () => void; patch: (p: Record<string, string>) => Promise<void> }) {
  const meta = useEditor((s) => s.meta)!;
  const [customer, setCustomer] = useState(meta.customer);
  const [notes, setNotes] = useState(meta.roomNotes);
  return (
    <Dialog title="Project details" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={async () => { await patch({ customer, roomNotes: notes }); onClose(); }}>Save</button></>}>
      <div className="space-y-3">
        <label className="block"><span className="label">Customer</span><input className="input" value={customer} maxLength={200} onChange={(e) => setCustomer(e.target.value)} /></label>
        <label className="block"><span className="label">Room notes</span><textarea className="input" rows={4} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} placeholder="Site measurements, wall condition, customer preferences…" /></label>
        <p className="text-xs text-mute">Category: {meta.category.replace('_', ' ').toLowerCase()}</p>
      </div>
    </Dialog>
  );
}

function ShareDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [access, setAccess] = useState<'VIEW' | 'EDIT'>('VIEW');
  const [shares, setShares] = useState<{ userId: string; email: string; name: string; access: string }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [pub, setPub] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const load = () => api<{ shares: typeof shares }>(`/api/projects/${id}/share`).then((r) => setShares(r.shares)).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
    api<{ path: string | null }>(`/api/projects/${id}/public`).then((r) => setPub(r.path)).catch(() => undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function togglePublic(on: boolean) {
    try {
      if (on) setPub((await api<{ path: string }>(`/api/projects/${id}/public`, { method: 'POST' })).path);
      else {
        await api(`/api/projects/${id}/public`, { method: 'DELETE' });
        setPub(null);
      }
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  async function add() {
    setErr(null);
    try {
      await api(`/api/projects/${id}/share`, { method: 'POST', body: JSON.stringify({ email, access }) });
      setEmail('');
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  return (
    <Dialog title="Share project" onClose={onClose}>
      <div className="space-y-3">
        <div className="flex gap-2">
          <input className="input" type="email" placeholder="colleague@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <select className="input w-28" value={access} onChange={(e) => setAccess(e.target.value as 'VIEW' | 'EDIT')} aria-label="Access level"><option value="VIEW">Can view</option><option value="EDIT">Can edit</option></select>
          <button className="btn btn-primary" disabled={!email} onClick={add}>Add</button>
        </div>
        {err && <Hint tone="error">{err}</Hint>}
        <ul className="divide-y divide-sand text-sm">
          {shares.map((s) => (
            <li key={s.userId} className="flex items-center justify-between py-1.5"><span>{s.name} <span className="text-mute">({s.email})</span> · {s.access.toLowerCase()}</span><button className="text-danger" onClick={() => api(`/api/projects/${id}/share?userId=${s.userId}`, { method: 'DELETE' }).then(load)}>Remove</button></li>
          ))}
          {!shares.length && <li className="py-2 text-mute">Not shared with anyone.</li>}
        </ul>
        <p className="text-xs text-mute">Shared users must already have an account. Viewers can never edit.</p>
        <div className="rounded-lg border border-sand p-3">
          <label className="flex items-center justify-between text-sm font-medium">Public preview link
            <input type="checkbox" checked={!!pub} onChange={(e) => togglePublic(e.target.checked)} aria-label="Public preview link" />
          </label>
          {pub ? (
            <div className="mt-2 flex gap-2">
              <input className="input !py-1 text-xs" readOnly value={`${typeof window !== 'undefined' ? window.location.origin : ''}${pub}`} onFocus={(e) => e.currentTarget.select()} aria-label="Preview link" />
              <button className="btn btn-sm" onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}${pub}`); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? 'Copied' : 'Copy'}</button>
            </div>
          ) : <p className="mt-1 text-xs text-mute">Anyone with the link can orbit the 3D model (read-only, no prices or documents). Turn it off to revoke the link.</p>}
        </div>
      </div>
    </Dialog>
  );
}

void parseProjectImport;
