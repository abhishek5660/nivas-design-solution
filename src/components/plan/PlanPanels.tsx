'use client';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { planBoq, rawMaterials, runQc, workSchedule, type Violation } from '@/lib/plan/outputs';
import { newId } from '@/lib/plan/walls';
import { useEditor } from '@/store/editor';
import * as A from '@/store/planActions';
import { planHost, setPlan } from '@/store/planHost';
import { usePlanUi } from '@/store/planUi';
import { clearDraft } from '@/store/save';
import { Confirm } from '../ui';
import { Hint, NumField } from '../editor/fields';
import { clearPlanCaches } from './PlanMesh';

export function PanelFrame({ title, onClose, children, wide, actions }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; actions?: ReactNode }) {
  return (
    <aside className={`flex min-h-0 shrink-0 flex-col border-l border-sand bg-paper ${wide ? 'w-[28rem]' : 'w-[22rem]'} max-w-[92vw]`} aria-label={title}>
      <div className="flex items-center justify-between gap-2 border-b border-sand px-3 py-2">
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        <div className="flex items-center gap-1.5">
          {actions}
          <button className="grid h-7 w-7 place-items-center rounded hover:bg-linen" onClick={onClose} aria-label={`Close ${title}`}>✕</button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 text-sm">{children}</div>
    </aside>
  );
}

const money = (n: number, cur: string) => `${cur === 'INR' ? '₹' : cur + ' '}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

function csv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
}
function saveCsv(name: string, rows: (string | number)[][]) {
  A.download(new Blob(['﻿' + csv(rows)], { type: 'text/csv;charset=utf-8' }), `${(useEditor.getState().meta?.name ?? 'project').replace(/[^A-Za-z0-9._-]+/g, '_')}-${name}.csv`);
}

/** Jump to the place a finding refers to: right floor, object selected, view centred and flashed. */
export function locate(v: { floorId: string; entityId?: string; nodeId?: string; at?: [number, number] }) {
  const ui = usePlanUi.getState();
  const plan = useEditor.getState().doc.plan!;
  if (plan.activeFloorId !== v.floorId) A.switchFloor(v.floorId);
  if (ui.viewMode === '3d') ui.setViewMode('2d');
  const id = v.nodeId ?? v.entityId;
  if (id) planHost.setSelection([id]);
  if (v.at) {
    const cur = ui.views[v.floorId];
    ui.setView(v.floorId, { cx: v.at[0], cy: v.at[1], scale: Math.max(cur?.scale ?? 0.1, 0.12) });
    ui.flash(v.at);
  } else if (id) ui.requestZoom('selection');
}

// ---------------- QC / violations ----------------

export function QcPanel({ onClose, errorsOnly }: { onClose: () => void; errorsOnly?: boolean }) {
  const doc = useEditor((s) => s.doc);
  const [sev, setSev] = useState<'all' | 'error' | 'warning' | 'info'>(errorsOnly ? 'error' : 'all');
  const [stamp, setStamp] = useState(0);
  const all = useMemo(() => runQc(doc), [doc, stamp]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = all.filter((v) => sev === 'all' || v.severity === sev);
  const count = (s: Violation['severity']) => all.filter((v) => v.severity === s).length;
  const tone = { error: 'border-danger/40 bg-danger/5', warning: 'border-warn/40 bg-warn/5', info: 'border-sand bg-linen/50' } as const;
  return (
    <PanelFrame title={errorsOnly ? 'Violations' : 'Quality checks'} onClose={onClose} actions={<button className="btn btn-sm" onClick={() => setStamp((n) => n + 1)}>Re-run</button>}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5 text-xs">
          {([['all', `All ${all.length}`], ['error', `Errors ${count('error')}`], ['warning', `Warnings ${count('warning')}`], ['info', `Notes ${count('info')}`]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setSev(k)} aria-pressed={sev === k} className={`rounded-full border px-2.5 py-1 ${sev === k ? 'border-ink bg-ink text-gold-soft' : 'border-sand bg-white hover:bg-linen'}`}>{l}</button>
          ))}
        </div>
        {!all.length && <Hint>No issues found. The checks cover walls, openings, stairs, ceilings, dimensions, rooms and furniture placement.</Hint>}
        <ul className="space-y-1.5">
          {list.map((v) => (
            <li key={v.id}>
              <button className={`w-full rounded-md border px-2.5 py-2 text-left hover:shadow ${tone[v.severity]}`} onClick={() => locate(v)} title="Click to find it in the plan">
                <span className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-mute"><span>{v.severity}</span><span>{v.floorName}</span></span>
                <span className="block text-[13px] leading-snug">{v.message}</span>
                <span className="block text-[10px] text-mute">Rule: {v.rule}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </PanelFrame>
  );
}

// ---------------- BOQ / pricing / raw / schedule ----------------

export function BoqPanel({ onClose, pricing }: { onClose: () => void; pricing?: boolean }) {
  const doc = useEditor((s) => s.doc);
  const cur = doc.pricing.currency;
  const boq = useMemo(() => planBoq(doc), [doc]);
  const sections = useMemo(() => [...new Set(boq.lines.map((l) => l.section))], [boq]);
  const exportCsv = () =>
    saveCsv('boq', [['Section', 'Description', 'Specification', 'Unit', 'Quantity', `Unit price (${cur})`, `Amount (${cur})`, 'Price status'], ...boq.lines.map((l) => [l.section, l.description, l.spec, l.unit, l.qty, l.unitPrice ?? '', l.unitPrice == null ? '' : l.amount, l.source === 'cabinetry' ? 'from cabinetry pricing' : l.unitPrice == null ? 'NO PRICE ENTERED' : l.estimate ? 'estimate' : 'entered'])]);
  return (
    <PanelFrame title={pricing ? 'Pricing' : 'BOQ schedule'} onClose={onClose} wide actions={<button className="btn btn-sm" onClick={exportCsv} disabled={!boq.lines.length}>Export CSV</button>}>
      <div className="space-y-3">
        {pricing ? <Hint>Enter your own unit prices. Nothing is assumed: lines without a price are listed as unpriced and excluded from totals.</Hint> : <Hint>Quantities are measured from the drawn walls, openings, finishes and placed furniture. Change a price in Outputs → Pricing.</Hint>}
        {!boq.lines.length && <p className="text-mute">Nothing to list yet. Draw walls, add openings or place furniture.</p>}
        {boq.warnings.map((w) => <Hint key={w} tone="warn">{w}</Hint>)}
        {sections.map((s) => (
          <section key={s}>
            <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wider text-graphite">{s}</h3>
            <table className="w-full text-xs">
              <thead className="text-left text-mute"><tr><th className="py-1 font-medium">Item</th><th className="text-right font-medium">Qty</th>{pricing ? <th className="w-24 text-right font-medium">Unit price</th> : <th className="text-right font-medium">Amount</th>}</tr></thead>
              <tbody>
                {boq.lines.filter((l) => l.section === s).map((l) => (
                  <tr key={l.key} className="border-t border-sand align-top">
                    <td className="py-1 pr-2"><span className="block font-medium">{l.description}</span><span className="block text-[10px] text-mute">{l.spec}</span></td>
                    <td className="whitespace-nowrap py-1 text-right tabular-nums">{l.qty} {l.unit}</td>
                    {pricing ? (
                      <td className="py-1 text-right">
                        {l.source === 'cabinetry' ? <span className="text-[10px] text-mute">cabinetry pricing</span> : <NumField compact length={false} value={l.unitPrice ?? 0} min={0} max={1e9} suffix={cur} onCommit={(v) => { setPlan((p) => ({ ...p, prices: { ...p.prices, [l.key]: { unitPrice: v, estimate: p.prices[l.key]?.estimate ?? false } } }), `price:${l.key}`); }} />}
                        {l.source !== 'cabinetry' && (
                          <label className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-mute"><input type="checkbox" checked={!!doc.plan!.prices[l.key]?.estimate} disabled={!doc.plan!.prices[l.key]} onChange={(e) => setPlan((p) => ({ ...p, prices: { ...p.prices, [l.key]: { ...p.prices[l.key], estimate: e.target.checked } } }), `price:${l.key}`)} />estimate</label>
                        )}
                      </td>
                    ) : (
                      <td className="whitespace-nowrap py-1 text-right tabular-nums">{l.unitPrice == null ? <span className="text-warn">no price</span> : money(l.amount, cur)}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
        {boq.lines.length > 0 && (
          <div className="space-y-1 rounded-md bg-linen/70 p-3 text-sm">
            <div className="flex justify-between"><span>Floor plan items (priced)</span><b className="tabular-nums">{money(boq.planTotal, cur)}</b></div>
            <div className="flex justify-between"><span>Cabinetry (from pricing rules)</span><b className="tabular-nums">{money(boq.cabinetryTotal, cur)}</b></div>
            <div className="flex justify-between border-t border-sand pt-1"><span>Total</span><b className="tabular-nums">{money(boq.planTotal + boq.cabinetryTotal, cur)}</b></div>
            {boq.unpriced > 0 && <p className="text-xs text-warn">{boq.unpriced} line{boq.unpriced === 1 ? ' has' : 's have'} no price and {boq.unpriced === 1 ? 'is' : 'are'} not in the total. Taxes, labour and discounts are applied in the BOQ &amp; Quote tab.</p>}
          </div>
        )}
      </div>
    </PanelFrame>
  );
}

export function RawPanel({ onClose }: { onClose: () => void }) {
  const doc = useEditor((s) => s.doc);
  const rows = useMemo(() => rawMaterials(doc), [doc]);
  return (
    <PanelFrame title="Raw materials" onClose={onClose} wide actions={<button className="btn btn-sm" disabled={!rows.length} onClick={() => saveCsv('raw-materials', [['Material', 'Quantity', 'Unit', 'Used in'], ...rows.map((r) => [r.material, r.qty, r.unit, r.usedIn])])}>Export CSV</button>}>
      {!rows.length ? <p className="text-mute">No materials to list yet.</p> : (
        <table className="w-full text-xs">
          <thead className="text-left text-mute"><tr><th className="py-1 font-medium">Material</th><th className="text-right font-medium">Quantity</th><th className="pl-3 font-medium">Used in</th></tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-sand"><td className="py-1 pr-2">{r.material}</td><td className="whitespace-nowrap text-right tabular-nums">{r.qty} {r.unit}</td><td className="pl-3 text-mute">{r.usedIn}</td></tr>)}</tbody>
        </table>
      )}
    </PanelFrame>
  );
}

export function SchedulePanel({ onClose }: { onClose: () => void }) {
  const doc = useEditor((s) => s.doc);
  const ws = useMemo(() => workSchedule(doc), [doc]);
  return (
    <PanelFrame title="Work schedule" onClose={onClose} wide actions={<button className="btn btn-sm" disabled={!ws.phases.length} onClick={() => saveCsv('work-schedule', [['Phase', 'Scope', 'Quantity', 'Days'], ...ws.phases.map((p) => [p.name, p.items, p.quantity, p.days ?? '']), ['Total', '', '', ws.totalDays]])}>Export CSV</button>}>
      <div className="space-y-3">
        <Hint>The phases come from what is in your design. Durations are not guessed: enter the days your team needs for each phase.</Hint>
        {!ws.phases.length && <p className="text-mute">No work to schedule yet.</p>}
        <ul className="space-y-2">
          {ws.phases.map((p) => (
            <li key={p.id} className="rounded-md border border-sand p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div><b className="text-[13px]">{p.name}</b><span className="block text-[11px] text-mute">{p.items} · {p.quantity}</span></div>
                <div className="w-24 shrink-0"><NumField compact length={false} suffix="days" min={0} max={3650} value={p.days ?? 0} onCommit={(v) => { setPlan((pl) => ({ ...pl, schedule: { ...pl.schedule, [p.id]: { days: v } } }), `sched:${p.id}`); }} /></div>
              </div>
              {p.days == null && <p className="mt-1 text-[11px] text-warn">No duration entered</p>}
            </li>
          ))}
        </ul>
        {ws.phases.length > 0 && <p className="text-sm">Total entered: <b>{ws.totalDays} days</b>{ws.unestimated > 0 && <span className="text-warn"> · {ws.unestimated} phase{ws.unestimated === 1 ? '' : 's'} without a duration</span>}</p>}
      </div>
    </PanelFrame>
  );
}

// ---------------- cache ----------------

export function CachePanel({ onClose }: { onClose: () => void }) {
  const projectId = useEditor((s) => s.projectId)!;
  const [info, setInfo] = useState<{ draftKb: number | null; at: number | null }>({ draftKb: null, at: null });
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const read = () => {
    try {
      const raw = localStorage.getItem(`nivas:draft:${projectId}`);
      setInfo({ draftKb: raw ? Math.round(raw.length / 1024) : null, at: raw ? (JSON.parse(raw).ts as number) : null });
    } catch {
      setInfo({ draftKb: null, at: null });
    }
  };
  useEffect(read, [projectId]);
  return (
    <PanelFrame title="Cache" onClose={onClose}>
      <div className="space-y-4">
        <Hint>Your project is saved on the server. This browser also keeps a safety copy (draft) of unsaved work and some generated 3D textures. Clearing them never changes the saved project.</Hint>
        <section className="space-y-1.5">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-graphite">Browser draft</h3>
          <p>{info.draftKb == null ? 'No draft stored.' : `${info.draftKb} KB, stored ${new Date(info.at ?? 0).toLocaleString()}`}</p>
          <button className="btn btn-sm" disabled={info.draftKb == null} onClick={() => setConfirm(true)}>Clear draft</button>
        </section>
        <section className="space-y-1.5">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-graphite">3D materials &amp; tile textures</h3>
          <p className="text-mute">Rebuilt automatically when needed.</p>
          <button className="btn btn-sm" onClick={() => { const r = clearPlanCaches(); setMsg(`Cleared ${r.materials} materials and ${r.textures} tile textures.`); }}>Clear 3D cache</button>
        </section>
        {msg && <Hint>{msg}</Hint>}
      </div>
      {confirm && <Confirm title="Clear the browser draft?" message="Only the safety copy in this browser is removed. Unsaved changes made after your last save would no longer be recoverable after a crash." confirmLabel="Clear draft" onCancel={() => setConfirm(false)} onConfirm={() => { clearDraft(projectId); setConfirm(false); read(); setMsg('Draft cleared.'); }} />}
    </PanelFrame>
  );
}

// ---------------- gallery ----------------

export function GalleryPanel({ onClose }: { onClose: () => void }) {
  const plan = useEditor((s) => s.doc.plan!);
  const [open, setOpen] = useState<string | null>(null);
  const [del, setDel] = useState<string | null>(null);
  return (
    <PanelFrame title="Gallery" onClose={onClose} wide actions={<button className="btn btn-sm btn-gold" onClick={() => void A.screenshot(true)}>Screenshot</button>}>
      {!plan.gallery.length ? <Hint>No images yet. Take a screenshot, or render the 3D view (Render → Render) and add it here.</Hint> : (
        <ul className="grid grid-cols-2 gap-2">
          {plan.gallery.map((g) => (
            <li key={g.id} className="overflow-hidden rounded-md border border-sand">
              <button className="block w-full" onClick={() => setOpen(g.url)} aria-label={`Open ${g.name}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={g.url} alt={g.name} className="aspect-video w-full object-cover" loading="lazy" />
              </button>
              <div className="flex items-center justify-between gap-1 px-2 py-1 text-[11px]">
                <span className="truncate" title={g.name}>{g.kind === 'render' ? 'Render' : 'Screenshot'} · {g.width}×{g.height}</span>
                <span className="flex gap-1"><a className="underline" href={g.url} download={g.name}>Save</a><button className="text-danger" onClick={() => setDel(g.id)}>Delete</button></span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-ink/80 p-4" onClick={() => setOpen(null)} role="dialog" aria-label="Image preview">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={open} alt="Preview" className="max-h-full max-w-full rounded shadow-2xl" />
        </div>
      )}
      {del && <Confirm title="Remove this image from the gallery?" message="The image is removed from the project gallery." confirmLabel="Remove" onCancel={() => setDel(null)} onConfirm={() => { setPlan((p) => ({ ...p, gallery: p.gallery.filter((g) => g.id !== del) }), 'gallery'); setDel(null); }} />}
    </PanelFrame>
  );
}

// ---------------- saved views & presentations ----------------

export function ViewsPanel({ onClose }: { onClose: () => void }) {
  const plan = useEditor((s) => s.doc.plan!);
  return (
    <PanelFrame title="Saved views" onClose={onClose} actions={<button className="btn btn-sm btn-gold" onClick={() => A.saveView()}>Save current view</button>}>
      {!plan.viewpoints.length ? <Hint>Arrange the Floorplan or 3D view, then press “Save current view”. Views remember the floor and the camera/zoom.</Hint> : (
        <ul className="space-y-1.5">
          {plan.viewpoints.map((v) => (
            <li key={v.id} className="flex items-center gap-2 rounded-md border border-sand px-2 py-1.5">
              <button className="min-w-0 flex-1 text-left" onClick={() => A.applyView(v.id)}>
                <span className="block truncate text-[13px] font-medium">{v.name}</span>
                <span className="block text-[10px] uppercase tracking-wider text-mute">{v.kind === '2d' ? 'Floorplan' : '3D'}</span>
              </button>
              <button className="text-xs underline" onClick={async () => { const n = await planHost.prompt('Rename view', v.name); if (n?.trim()) setPlan((p) => ({ ...p, viewpoints: p.viewpoints.map((x) => (x.id === v.id ? { ...x, name: n.trim() } : x)) }), 'views'); }}>Rename</button>
              <button className="text-xs text-danger" onClick={() => A.deleteView(v.id)}>Delete</button>
            </li>
          ))}
        </ul>
      )}
    </PanelFrame>
  );
}

export function PresentationPanel({ onClose }: { onClose: () => void }) {
  const plan = useEditor((s) => s.doc.plan!);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [playing, setPlaying] = useState<{ id: string; i: number } | null>(null);
  const [secs, setSecs] = useState(4);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setPlaying(null);
  };
  useEffect(() => stop, []);
  function play(id: string) {
    const pr = plan.presentations.find((p) => p.id === id);
    const views = pr?.viewpoints.filter((v) => plan.viewpoints.some((x) => x.id === v)) ?? [];
    if (!views.length) return usePlanUi.getState().say('This presentation has no saved views.', 'warn');
    stop();
    let i = 0;
    A.applyView(views[0]);
    setPlaying({ id, i: 0 });
    timer.current = setInterval(() => {
      i = (i + 1) % views.length;
      A.applyView(views[i]);
      setPlaying({ id, i });
    }, Math.max(1, secs) * 1000);
  }
  function create() {
    if (!name.trim()) return usePlanUi.getState().say('Give the presentation a name.', 'warn');
    if (!picked.length) return usePlanUi.getState().say('Pick at least one saved view.', 'warn');
    setPlan((p) => ({ ...p, presentations: [...p.presentations, { id: newId('pres'), name: name.trim(), viewpoints: picked }] }), 'presentation');
    setName('');
    setPicked([]);
  }
  return (
    <PanelFrame title="Presentations" onClose={onClose}>
      <div className="space-y-4">
        <Hint>A presentation steps through saved views, one after another. Save views first (View → Set view).</Hint>
        <section className="space-y-2">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-graphite">New presentation</h3>
          <input className="input" placeholder="Name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} aria-label="Presentation name" />
          {!plan.viewpoints.length ? <p className="text-mute">No saved views yet.</p> : (
            <ul className="space-y-1">
              {plan.viewpoints.map((v) => (
                <li key={v.id}><label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={picked.includes(v.id)} onChange={(e) => setPicked((s) => (e.target.checked ? [...s, v.id] : s.filter((x) => x !== v.id)))} />{v.name}<span className="text-[10px] uppercase text-mute">{v.kind}</span></label></li>
              ))}
            </ul>
          )}
          <button className="btn btn-sm btn-primary" onClick={create}>Create presentation</button>
        </section>
        <section className="space-y-2">
          <div className="flex items-center justify-between"><h3 className="text-[11px] font-bold uppercase tracking-wider text-graphite">Presentations</h3><div className="w-24"><NumField compact length={false} suffix="s / view" value={secs} min={1} max={60} onCommit={(v) => setSecs(v)} /></div></div>
          {!plan.presentations.length && <p className="text-mute">None yet.</p>}
          <ul className="space-y-1.5">
            {plan.presentations.map((p) => (
              <li key={p.id} className="flex items-center gap-2 rounded-md border border-sand px-2 py-1.5">
                <span className="min-w-0 flex-1 truncate">{p.name} <span className="text-xs text-mute">· {p.viewpoints.length} views</span>{playing?.id === p.id && <span className="ml-1 text-xs text-ok">▶ view {playing.i + 1}</span>}</span>
                {playing?.id === p.id ? <button className="btn btn-sm" onClick={stop}>Stop</button> : <button className="btn btn-sm btn-gold" onClick={() => play(p.id)}>Play</button>}
                <button className="text-xs text-danger" onClick={() => { if (playing?.id === p.id) stop(); setPlan((pl) => ({ ...pl, presentations: pl.presentations.filter((x) => x.id !== p.id) }), 'presentation'); }}>Delete</button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </PanelFrame>
  );
}

