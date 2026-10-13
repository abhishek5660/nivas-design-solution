'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { activeBuilding, activeFloor } from '@/lib/plan/model';
import { roomsOf } from '@/lib/plan/rooms';
import { TOOLS } from '@/lib/plan/tools';
import { useEditor } from '@/store/editor';
import * as A from '@/store/planActions';
import { activateTool, planEngine, setPlan } from '@/store/planHost';
import { usePlanUi, type RibbonTab } from '@/store/planUi';
import { Dialog } from '../ui';
import { RightPanel } from '../editor/RightPanel';
import { PlanCanvas } from './PlanCanvas';
import { BoqPanel, CachePanel, GalleryPanel, PresentationPanel, QcPanel, RawPanel, SchedulePanel, ViewsPanel } from './PlanPanels';
import { BranchPanel, ExtraLightPanel, FloorsPanel, FurnishPanel, GridPanel, HelpPanel, PrefsPanel, RoomsPanel, SettingsPanel, WizardPanel } from './PlanPanels2';
import { SelectionProps, ToolOptions, ViewportNavigation } from './PlanProps';
import { RIBBON, TAB_LABEL, type RibbonItem } from './ribbon';
import { RenderDialog } from '../editor/RenderDialog';

const TABS: RibbonTab[] = ['home', 'view', 'insert', 'draw', 'architecture', 'annotate', 'render', 'outputs'];

// ---------------- ribbon ----------------

function RibbonButton({ item }: { item: RibbonItem }) {
  const tool = usePlanUi((s) => s.tool);
  const panel = usePlanUi((s) => s.panel);
  usePlanUi((s) => s.floorMode); // re-evaluate toggle state when it changes
  const plan = useEditor((s) => s.doc.plan!);
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setMenu(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);
  const active = item.tool ? tool === item.tool : item.panel ? panel === item.panel : item.on ? item.on(plan) : false;
  const disabled = !!item.unsupported;
  const click = () => {
    if (disabled) return usePlanUi.getState().say(item.unsupported!, 'warn');
    if (item.menu) return setMenu((m) => !m);
    if (item.tool) return activateTool(item.tool);
    if (item.panel) return usePlanUi.getState().setPanel(item.panel);
    item.run?.();
  };
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={click}
        aria-pressed={item.tool || item.panel || item.on ? active : undefined}
        aria-disabled={disabled || undefined}
        aria-label={item.label}
        aria-haspopup={item.menu ? 'menu' : undefined}
        title={disabled ? `Not available: ${item.unsupported}` : (item.title ?? item.label)}
        data-testid={`rb-${item.id}`}
        className={`group flex h-[3.6rem] w-[3.9rem] flex-col items-center justify-start gap-0.5 rounded-md border px-0.5 pt-1 text-center transition ${disabled ? 'cursor-not-allowed border-transparent opacity-45' : active ? 'border-gold bg-gold-soft/50 shadow-inner' : 'border-transparent hover:border-sand hover:bg-linen'}`}
      >
        <span className="text-[19px] leading-6" aria-hidden>{item.glyph}</span>
        <span className="line-clamp-2 text-[10px] font-medium leading-[1.05] text-graphite">{item.label}{item.menu ? ' ▾' : ''}</span>
        {disabled && <span className="sr-only">(not available)</span>}
      </button>
      {menu && item.menu && (
        <ul role="menu" className="absolute left-0 top-full z-40 mt-1 w-60 overflow-hidden rounded-lg border border-sand bg-paper py-1 text-sm shadow-xl">
          {item.menu.map((m) => (
            <li key={m.label}><button role="menuitem" className="block w-full px-3 py-1.5 text-left hover:bg-linen" onClick={() => { setMenu(false); m.run(); }}>{m.label}</button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Ribbon() {
  const tab = usePlanUi((s) => s.tab);
  const setTab = usePlanUi((s) => s.setTab);
  const mode = useEditor((s) => s.doc.plan!.mode);
  return (
    <div className="border-b border-sand bg-paper">
      <div role="tablist" aria-label="Ribbon" className="flex gap-0.5 overflow-x-auto px-2 pt-1">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} data-testid={`tab-${t}`} className={`whitespace-nowrap rounded-t-md px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition ${tab === t ? 'bg-linen text-ink shadow-[inset_0_-2px_0_var(--color-gold)]' : 'text-mute hover:text-ink'}`}>{TAB_LABEL[t]}</button>
        ))}
        <span className="ml-auto self-center whitespace-nowrap px-2 text-[10px] uppercase tracking-wider text-mute">{mode} mode</span>
      </div>
      <div role="tabpanel" className="flex min-h-[4.6rem] items-stretch gap-0 overflow-x-auto bg-linen/60 px-2 py-1">
        {RIBBON[tab].map((g) => (
          <div key={g.label} className="flex shrink-0 flex-col border-r border-sand px-1.5 last:border-r-0">
            <div className="flex flex-1 items-start gap-0.5">{g.items.map((i) => <RibbonButton key={i.id} item={i} />)}</div>
            <span className="text-center text-[9px] font-semibold uppercase tracking-wider text-mute">{g.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- project bar (design / building / floor / room / view) ----------------

function UserChip() {
  const [user, setUser] = useState<{ name: string; role: string } | null>(null);
  useEffect(() => {
    fetch('/api/auth/me').then((r) => r.json()).then((j) => setUser(j.user ?? null)).catch(() => undefined);
  }, []);
  if (!user) return null;
  const initials = user.name.split(/s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
  return (
    <Link href="/settings" className="flex items-center gap-1.5 rounded-full border border-sand bg-white py-0.5 pl-0.5 pr-2.5 hover:bg-linen" title={`${user.name} (${user.role.toLowerCase()}) — account settings`}>
      <span className="grid h-6 w-6 place-items-center rounded-full bg-ink text-[10px] font-bold text-gold-soft">{initials}</span>
      <span className="max-w-[7rem] truncate">{user.name}</span>
    </Link>
  );
}

function ProjectBar() {
  const doc = useEditor((s) => s.doc);
  const meta = useEditor((s) => s.meta)!;
  const plan = doc.plan!;
  const viewMode = usePlanUi((s) => s.viewMode);
  const setViewMode = usePlanUi((s) => s.setViewMode);
  const bld = activeBuilding(plan);
  const floor = activeFloor(plan);
  const rooms = useMemo(() => roomsOf(floor, plan.roomProps), [floor, plan.roomProps]);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const sel = 'rounded-md border border-sand bg-white px-2 py-1 text-xs focus:border-gold focus:outline-none';
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-sand bg-paper px-3 py-1.5 text-xs">
      <Link href="/dashboard" className="rounded-md border border-sand bg-white px-2 py-1 font-semibold hover:bg-linen" title="Project browser: all your designs">📁 Files</Link>
      <span className="max-w-[14rem] truncate font-display text-base font-semibold" title={meta.name}>{meta.name}</span>
      <label className="flex items-center gap-1.5"><span className="text-mute">Mode</span>
        <select className={sel} value={plan.mode} onChange={(e) => A.setMode(e.target.value as typeof plan.mode)} aria-label="Design mode">
          <option value="architecture">Architecture</option>
          <option value="interior">Interior</option>
          <option value="production">Production</option>
        </select>
      </label>
      <label className="flex items-center gap-1.5"><span className="text-mute">Building</span>
        <select className={sel} value={bld.id} aria-label="Building" onChange={(e) => (e.target.value === '__add' ? usePlanUi.getState().setPanel('floors') : useEditor.getState().softSet({ ...doc, plan: { ...plan, activeBuildingId: e.target.value, activeFloorId: plan.buildings.find((b) => b.id === e.target.value)!.floors[0].id } }))}>
          {plan.buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          <option value="__add">Manage buildings…</option>
        </select>
      </label>
      <label className="flex items-center gap-1.5"><span className="text-mute">Floor</span>
        <select className={sel} value={floor.id} aria-label="Floor" onChange={(e) => (e.target.value === '__manage' ? usePlanUi.getState().setPanel('floors') : A.switchFloor(e.target.value))}>
          {[...bld.floors].reverse().map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          <option value="__manage">Add / edit floors…</option>
        </select>
      </label>
      <label className="flex items-center gap-1.5"><span className="text-mute">Room</span>
        <select className={sel} value="" aria-label="Room" onChange={(e) => { const r = rooms.find((x) => x.key === e.target.value); if (e.target.value === '__rooms') usePlanUi.getState().setPanel('rooms'); else if (r) { if (usePlanUi.getState().viewMode === '3d') setViewMode('2d'); usePlanUi.getState().requestZoom('room', r.inner); } }}>
          <option value="">{rooms.length ? `${rooms.length} room${rooms.length === 1 ? '' : 's'} — go to…` : 'No rooms yet'}</option>
          {rooms.map((r) => <option key={r.key} value={r.key}>{r.name} ({(r.area / 1e6).toFixed(1)} m²)</option>)}
          {rooms.length > 0 && <option value="__rooms">Rename rooms…</option>}
        </select>
      </label>
      <div className="flex rounded-md bg-linen p-0.5" role="group" aria-label="View mode">
        {([['2d', 'Floorplan'], ['split', 'Split'], ['3d', '3D']] as const).map(([k, l]) => (
          <button key={k} aria-pressed={viewMode === k} data-testid={`view-${k}`} onClick={() => setViewMode(k)} className={`rounded px-2.5 py-1 font-semibold ${viewMode === k ? 'bg-ink text-gold-soft shadow' : 'text-graphite hover:bg-white'}`}>{l}</button>
        ))}
      </div>
      <div className="ml-auto flex items-center gap-1.5">
        <button className="rounded border border-sand bg-white px-2 py-1 hover:bg-linen disabled:opacity-40" disabled={!canUndo} onClick={A.undo} aria-label="Undo" title="Undo (Ctrl+Z)">↶</button>
        <button className="rounded border border-sand bg-white px-2 py-1 hover:bg-linen disabled:opacity-40" disabled={!canRedo} onClick={A.redo} aria-label="Redo" title="Redo (Ctrl+Y)">↷</button>
        <UserChip />
        <button className="cursor-not-allowed rounded border border-transparent px-2 py-1 text-mute opacity-60" aria-disabled title="Not available: comments and review threads are not implemented yet" onClick={() => usePlanUi.getState().say('Comments are not available yet.', 'warn')}>💬 Comments</button>
        <button className="rounded border border-sand bg-white px-2 py-1 hover:bg-linen" onClick={() => usePlanUi.getState().setPanel('help')} aria-label="Shortcuts and tips" title="Shortcuts and tips">?</button>
      </div>
    </div>
  );
}

// ---------------- status / hint bar & views bar ----------------

function StatusBar() {
  const hint = usePlanUi((s) => s.hint);
  const status = usePlanUi((s) => s.status);
  const cursor = usePlanUi((s) => s.cursor);
  const snapLabel = usePlanUi((s) => s.snapLabel);
  const tool = usePlanUi((s) => s.tool);
  const plan = useEditor((s) => s.doc.plan!);
  const s = plan.settings;
  const saveStatus = useEditor((x) => x.saveStatus);
  const tone = status?.level === 'error' ? 'bg-danger/10 text-danger' : status?.level === 'warn' ? 'bg-warn/10 text-warn' : 'bg-linen text-graphite';
  const chip = (on: boolean) => `rounded border px-1.5 py-0.5 text-[11px] font-semibold ${on ? 'border-gold bg-gold-soft/50 text-ink' : 'border-sand bg-white text-mute'}`;
  const setS = (fn: (x: typeof s) => typeof s) => setPlan((p) => ({ ...p, settings: fn(p.settings) }), 'prefs');
  return (
    <div className="border-t border-sand bg-paper text-xs">
      {status && <div className={`px-3 py-1 ${tone}`} role="status" aria-live="polite" data-testid="plan-status">{status.text}</div>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate text-graphite" data-testid="plan-hint" title={hint}><b className="mr-1.5 text-ink">{TOOLS[tool]?.label}</b>{hint}</span>
        <span className="tabular-nums text-mute" data-testid="plan-cursor">{cursor ? `X ${Math.round(cursor[0])}  Y ${Math.round(-cursor[1])} mm` : ''}{snapLabel ? ` · ${snapLabel}` : ''}</span>
        <span className="flex items-center gap-1" role="group" aria-label="Global preferences">
          <button className={chip(s.grid.visible)} aria-pressed={s.grid.visible} onClick={() => setS((x) => ({ ...x, grid: { ...x.grid, visible: !x.grid.visible } }))} title="Show or hide the grid">Grid</button>
          <button className={chip(s.snap.grid)} aria-pressed={s.snap.grid} onClick={() => setS((x) => ({ ...x, snap: { ...x.snap, grid: !x.snap.grid } }))} title="Snap to grid">Snap</button>
          <button className={chip(s.snap.ortho)} aria-pressed={s.snap.ortho} onClick={() => setS((x) => ({ ...x, snap: { ...x.snap, ortho: !x.snap.ortho } }))} title="Horizontal / vertical / 45° guides">Ortho</button>
          <button className={chip(s.showDimensions)} aria-pressed={s.showDimensions} onClick={() => setS((x) => ({ ...x, showDimensions: !x.showDimensions }))} title="Show dimensions">Dims</button>
          <button className={chip(s.xray)} aria-pressed={s.xray} onClick={() => setS((x) => ({ ...x, xray: !x.xray }))} title="X-ray">X-ray</button>
          <button className="rounded border border-sand bg-white px-1.5 py-0.5 text-[11px] font-semibold hover:bg-linen" onClick={() => usePlanUi.getState().setPanel('prefs')} title="Preferences">⚙ {s.units.display}</button>
        </span>
        <span className="text-[11px] text-mute">{saveStatus === 'saved' ? 'Saved' : saveStatus === 'saving' ? 'Saving…' : saveStatus === 'dirty' ? 'Unsaved' : saveStatus === 'readonly' ? 'View only' : saveStatus}</span>
      </div>
    </div>
  );
}

function ViewsBar() {
  const plan = useEditor((s) => s.doc.plan!);
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto border-t border-sand bg-linen/60 px-3 py-1 text-xs" aria-label="Saved views">
      <span className="shrink-0 font-semibold uppercase tracking-wider text-mute">Views</span>
      {plan.viewpoints.map((v) => (
        <button key={v.id} className="shrink-0 rounded-full border border-sand bg-white px-2.5 py-0.5 hover:bg-gold-soft/40" onClick={() => A.applyView(v.id)} title={`${v.kind === '2d' ? 'Floorplan' : '3D'} view`}>{v.kind === '2d' ? '▭' : '◧'} {v.name}</button>
      ))}
      <button className="shrink-0 rounded-full border border-dashed border-stone bg-white px-2.5 py-0.5 hover:bg-linen" onClick={() => A.saveView()} data-testid="add-view">＋ Set view</button>
      <button className="ml-auto shrink-0 text-mute underline" onClick={() => usePlanUi.getState().setPanel('views')}>Manage</button>
    </div>
  );
}

// ---------------- prompt ----------------

function PromptDialog() {
  const prompt = usePlanUi((s) => s.prompt);
  const close = usePlanUi((s) => s.closePrompt);
  const [v, setV] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (prompt) {
      setV(prompt.initial);
      setTimeout(() => input.current?.select(), 30);
    }
  }, [prompt]);
  if (!prompt) return null;
  return (
    <Dialog title={prompt.title} onClose={() => close(null)} footer={<><button className="btn" onClick={() => close(null)}>Cancel</button><button className="btn btn-primary" onClick={() => close(v)}>OK</button></>}>
      <input ref={input} className="input" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') close(v); }} aria-label={prompt.title} data-testid="prompt-input" />
    </Dialog>
  );
}

// ---------------- panels ----------------

function SidePanel() {
  const panel = usePlanUi((s) => s.panel);
  const close = () => usePlanUi.getState().setPanel(null);
  switch (panel) {
    case 'furnish': return <FurnishPanel onClose={close} />;
    case 'qc': return <QcPanel onClose={close} />;
    case 'violations': return <QcPanel onClose={close} errorsOnly />;
    case 'boq': return <BoqPanel onClose={close} />;
    case 'pricing': return <BoqPanel onClose={close} pricing />;
    case 'raw': return <RawPanel onClose={close} />;
    case 'schedule': return <SchedulePanel onClose={close} />;
    case 'presentation': return <PresentationPanel onClose={close} />;
    case 'cache': return <CachePanel onClose={close} />;
    case 'settings': return <SettingsPanel onClose={close} />;
    case 'prefs': return <PrefsPanel onClose={close} />;
    case 'grid': return <GridPanel onClose={close} />;
    case 'branch': return <BranchPanel onClose={close} />;
    case 'aifloor': return <WizardPanel onClose={close} />;
    case 'gallery': return <GalleryPanel onClose={close} />;
    case 'views': return <ViewsPanel onClose={close} />;
    case 'floors': return <FloorsPanel onClose={close} />;
    case 'rooms': return <RoomsPanel onClose={close} />;
    case 'extralight': return <ExtraLightPanel onClose={close} />;
    case 'help': return <HelpPanel onClose={close} />;
    default: return null;
  }
}

// ---------------- workspace ----------------

export function PlanWorkspace({ viewport3d }: { viewport3d: ReactNode }) {
  const viewMode = usePlanUi((s) => s.viewMode);
  const panel = usePlanUi((s) => s.panel);
  const sel = useEditor((s) => s.sel);
  const [leftOpen, setLeftOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 900);
  const nodeSelected = sel.ids.length > 0;
  const renderOpen = panel === 'render';

  // keep tool + hint in sync when the workspace opens
  useEffect(() => {
    activateTool(usePlanUi.getState().tool);
    return () => void planEngine.setTool('select');
  }, []);

  return (
    <div className="absolute inset-0 flex flex-col" data-testid="plan-workspace">
      <ProjectBar />
      <Ribbon />
      <div className="relative flex min-h-0 flex-1">
        {leftOpen ? (
          <aside className="flex w-64 shrink-0 flex-col border-r border-sand bg-paper" aria-label="Tool options and properties">
            <div className="flex items-center justify-between border-b border-sand px-3 py-1.5"><span className="text-[11px] font-bold uppercase tracking-wider text-graphite">Tools &amp; properties</span><button className="text-xs text-mute hover:text-ink" onClick={() => setLeftOpen(false)} aria-label="Hide side panel">◀</button></div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ViewportNavigation />
              <ToolOptions />
              <SelectionProps />
            </div>
          </aside>
        ) : (
          <button className="absolute left-0 top-2 z-20 rounded-r-md border border-sand bg-paper px-1.5 py-2 text-xs shadow" onClick={() => setLeftOpen(true)} aria-label="Show side panel">▶</button>
        )}
        <div className="relative flex min-w-0 flex-1">
          {(viewMode === '2d' || viewMode === 'split') && <div className={`relative ${viewMode === 'split' ? 'w-1/2 border-r border-sand' : 'w-full'} overflow-hidden bg-white`}><PlanCanvas /></div>}
          {(viewMode === '3d' || viewMode === 'split') && <div className={`relative ${viewMode === 'split' ? 'w-1/2' : 'w-full'} overflow-hidden`}>{viewport3d}</div>}
        </div>
        {panel && panel !== 'render' ? <SidePanel /> : nodeSelected ? <RightPanel /> : null}
      </div>
      <ViewsBar />
      <StatusBar />
      <PromptDialog />
      {renderOpen && <RenderDialog onClose={() => usePlanUi.getState().setPanel(null)} onGallery={(blob, name, w, h) => A.addToGallery(blob, name, w, h, 'render')} />}
    </div>
  );
}

