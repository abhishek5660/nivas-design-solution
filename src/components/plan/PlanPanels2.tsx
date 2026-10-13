'use client';
import { useMemo, useState } from 'react';
import { FURNITURE, FURNITURE_CATEGORIES } from '@/lib/build/furniture';
import { addBuilding, addFloor, createBranch, deleteBranch, deleteBuilding, deleteFloor, duplicateFloor, generateLayout, renameBuilding, renameFloor, selectBuilding, setFloorLevels, switchBranch, WIZARD_MIN, type WizardRow } from '@/lib/plan/actions';
import { floorBounds } from '@/lib/plan/entities';
import { activeBuilding, activeFloor, updateFloor } from '@/lib/plan/model';
import { roomsOf } from '@/lib/plan/rooms';
import type { PlanModel } from '@/lib/plan/types';
import { useEditor } from '@/store/editor';
import * as A from '@/store/planActions';
import { activateTool, planHost, setPlan } from '@/store/planHost';
import { usePlanUi } from '@/store/planUi';
import { usePrefs } from '@/store/prefs';
import { Confirm } from '../ui';
import { createLibraryNode, LIBRARY } from '../editor/LeftPanel';
import { Hint, NumField, Section, Select, Toggle } from '../editor/fields';
import { PanelFrame } from './PlanPanels';

const ed = () => useEditor.getState();
const say = (t: string, l: 'info' | 'warn' | 'error' = 'info') => usePlanUi.getState().say(t, l);

// ---------------- furnish ----------------

export function FurnishPanel({ onClose }: { onClose: () => void }) {
  const payload = usePlanUi((s) => s.payload) as { itemId?: string } | null;
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('All');
  const items = useMemo(() => {
    const list = [
      ...FURNITURE.map((f) => ({ id: f.id, label: f.label, group: f.category as string, size: { w: f.size.w, d: f.size.d } })),
      ...LIBRARY.map((l) => {
        const n = createLibraryNode(l);
        return { id: `lib:${l.id}`, label: l.label, group: l.group, size: { w: n.size.w, d: n.size.d } };
      }),
    ];
    return list.filter((i) => (cat === 'All' || i.group === cat) && i.label.toLowerCase().includes(q.trim().toLowerCase()));
  }, [q, cat]);
  const groups = ['All', ...FURNITURE_CATEGORIES, ...new Set(LIBRARY.map((l) => l.group))];
  const choose = (i: (typeof items)[number]) => {
    usePlanUi.getState().setPayload({ itemId: i.id, size: i.size });
    activateTool('furnish');
    say(`${i.label}: click in the plan to place it (R rotates 90°).`);
  };
  return (
    <PanelFrame title="Furnish" onClose={onClose}>
      <div className="space-y-3">
        <input className="input" placeholder="Search furniture and cabinets…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search furniture" />
        <div className="flex flex-wrap gap-1">
          {groups.map((g) => (
            <button key={g} onClick={() => setCat(g)} aria-pressed={cat === g} className={`rounded-full border px-2 py-0.5 text-[11px] ${cat === g ? 'border-ink bg-ink text-gold-soft' : 'border-sand bg-white hover:bg-linen'}`}>{g}</button>
          ))}
        </div>
        {!items.length && <p className="text-mute">Nothing matches.</p>}
        <ul className="grid grid-cols-2 gap-1.5">
          {items.map((i) => (
            <li key={i.id}>
              <button onClick={() => choose(i)} aria-pressed={payload?.itemId === i.id} className={`w-full rounded-md border px-2 py-2 text-left text-[12px] leading-tight hover:bg-linen ${payload?.itemId === i.id ? 'border-gold bg-gold-soft/40' : 'border-sand bg-white'}`} title={`${i.size.w} × ${i.size.d} mm`}>
                <b className="block">{i.label}</b>
                <span className="text-[10px] text-mute">{i.group} · {i.size.w}×{i.size.d}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-mute">Each placed item is a real 3D object (cabinets and wardrobes keep all their parametric options). Select it to edit size, materials and position.</p>
      </div>
    </PanelFrame>
  );
}

// ---------------- buildings & floors ----------------

export function FloorsPanel({ onClose }: { onClose: () => void }) {
  const doc = useEditor((s) => s.doc);
  const plan = doc.plan!;
  const bld = activeBuilding(plan);
  const [del, setDel] = useState<{ kind: 'floor' | 'building'; id: string } | null>(null);

  const apply = (r: { ok: true; value: PlanModel } | { ok: false; error: string }, key: string) => (r.ok ? (setPlan(() => r.value, key), true) : (say(r.error, 'warn'), false));
  function levels(id: string, elevation: number, height: number) {
    const r = setFloorLevels(plan, id, elevation, height);
    if (!r.ok) return say(r.error, 'warn'), false;
    const d = ed().doc;
    const first = plan.buildings[0].floors[0].id;
    const nodes = Object.fromEntries(Object.entries(d.nodes).map(([k, n]) => [k, (n.floorId ?? first) === id && r.value.shift ? { ...n, position: [n.position[0], n.position[1] + r.value.shift, n.position[2]] as [number, number, number] } : n]));
    ed().commit({ ...d, nodes, plan: r.value.plan }, `levels:${id}`);
    return true;
  }
  function doDelete() {
    if (!del) return;
    const d = ed().doc;
    if (del.kind === 'floor') {
      const r = deleteFloor(plan, del.id);
      if (!r.ok) say(r.error, 'warn');
      else {
        const nodes = Object.fromEntries(Object.entries(d.nodes).filter(([, n]) => n.floorId !== del.id));
        ed().commit({ ...d, nodes, order: d.order.filter((i) => nodes[i]), plan: r.value }, 'delete-floor');
      }
    } else {
      const r = deleteBuilding(plan, del.id);
      if (!r.ok) say(r.error, 'warn');
      else {
        const gone = new Set(r.value.removedFloorIds);
        const nodes = Object.fromEntries(Object.entries(d.nodes).filter(([, n]) => !n.floorId || !gone.has(n.floorId)));
        ed().commit({ ...d, nodes, order: d.order.filter((i) => nodes[i]), plan: r.value.plan }, 'delete-building');
      }
    }
    planHost.setSelection([]);
    setDel(null);
  }
  const rename = async (title: string, cur: string) => (await planHost.prompt(title, cur))?.trim() || null;
  return (
    <PanelFrame title="Buildings & floors" onClose={onClose}>
      <div className="space-y-4">
        <section className="space-y-1.5">
          <div className="flex items-center justify-between"><h3 className="text-[11px] font-bold uppercase tracking-wider text-graphite">Buildings</h3><button className="btn btn-sm" onClick={() => setPlan((p) => addBuilding(p), 'add-building')}>Add building</button></div>
          <ul className="space-y-1">
            {plan.buildings.map((b) => (
              <li key={b.id} className={`flex items-center gap-2 rounded-md border px-2 py-1.5 ${b.id === bld.id ? 'border-gold bg-gold-soft/30' : 'border-sand'}`}>
                <button className="min-w-0 flex-1 truncate text-left" onClick={() => { ed().softSet({ ...ed().doc, plan: selectBuilding(plan, b.id) }); planHost.setSelection([]); }}>{b.name} <span className="text-xs text-mute">· {b.floors.length} floor{b.floors.length === 1 ? '' : 's'}</span></button>
                <button className="text-xs underline" onClick={async () => { const n = await rename('Rename building', b.name); if (n) apply(renameBuilding(plan, b.id, n), 'rename'); }}>Rename</button>
                <button className="text-xs text-danger" onClick={() => setDel({ kind: 'building', id: b.id })}>Delete</button>
              </li>
            ))}
          </ul>
        </section>
        <section className="space-y-1.5">
          <div className="flex items-center justify-between gap-1">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-graphite">Floors of {bld.name}</h3>
            <span className="flex gap-1"><button className="btn btn-sm" onClick={() => setPlan((p) => addFloor(p, 'above'), 'add-floor')}>Add above</button><button className="btn btn-sm" onClick={() => setPlan((p) => addFloor(p, 'below'), 'add-floor')}>Add basement</button></span>
          </div>
          <ul className="space-y-2">
            {[...bld.floors].reverse().map((f) => (
              <li key={f.id} className={`space-y-1.5 rounded-md border p-2 ${f.id === plan.activeFloorId ? 'border-gold bg-gold-soft/30' : 'border-sand'}`}>
                <div className="flex items-center gap-2">
                  <button className="min-w-0 flex-1 truncate text-left font-medium" onClick={() => A.switchFloor(f.id)}>{f.name}</button>
                  <button className="text-xs underline" onClick={async () => { const n = await rename('Rename floor', f.name); if (n) apply(renameFloor(plan, f.id, n), 'rename'); }}>Rename</button>
                  <button className="text-xs underline" onClick={() => { const r = duplicateFloor(plan, f.id); if (r.ok) setPlan(() => r.value, 'dup-floor'); else say(r.error, 'warn'); }}>Duplicate</button>
                  <button className="text-xs text-danger" onClick={() => setDel({ kind: 'floor', id: f.id })}>Delete</button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <NumField label="Elevation" value={f.elevation} min={-30000} max={300000} onCommit={(v) => levels(f.id, v, f.height)} />
                  <NumField label="Storey height" value={f.height} min={1500} max={12000} onCommit={(v) => levels(f.id, f.elevation, v)} />
                </div>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-mute">Changing a floor’s elevation also lifts the furniture standing on it.</p>
        </section>
      </div>
      {del && <Confirm title={del.kind === 'floor' ? 'Delete this floor?' : 'Delete this building?'} message="All walls, rooms, openings and furniture on it are removed. You can undo this with Ctrl+Z." confirmLabel="Delete" onCancel={() => setDel(null)} onConfirm={doDelete} />}
    </PanelFrame>
  );
}

// ---------------- rooms ----------------

export function RoomsPanel({ onClose }: { onClose: () => void }) {
  const plan = useEditor((s) => s.doc.plan!);
  const f = activeFloor(plan);
  const rooms = roomsOf(f, plan.roomProps);
  return (
    <PanelFrame title={`Rooms — ${f.name}`} onClose={onClose}>
      {!rooms.length ? <Hint>No closed rooms yet. Draw walls that enclose an area and it becomes a room automatically.</Hint> : (
        <ul className="space-y-2">
          {rooms.map((r) => (
            <li key={r.key} className="space-y-1 rounded-md border border-sand p-2">
              <input className="input !py-1" value={r.name} maxLength={60} aria-label="Room name" onChange={(e) => setPlan((p) => ({ ...p, roomProps: { ...p.roomProps, [r.key]: { ...p.roomProps[r.key], name: e.target.value } } }), `room:${r.key}`)} />
              <div className="flex items-center justify-between text-xs text-mute"><span>{(r.area / 1e6).toFixed(2)} m² · perimeter {(r.perimeter / 1000).toFixed(2)} m</span><button className="underline" onClick={() => { usePlanUi.getState().requestZoom('room', r.inner); if (usePlanUi.getState().viewMode === '3d') usePlanUi.getState().setViewMode('2d'); }}>Zoom to</button></div>
            </li>
          ))}
        </ul>
      )}
    </PanelFrame>
  );
}

// ---------------- preferences / grid ----------------

function GridAndSnap({ plan }: { plan: PlanModel }) {
  const s = plan.settings;
  const set = (fn: (s: PlanModel['settings']) => PlanModel['settings']) => setPlan((p) => ({ ...p, settings: fn(p.settings) }), 'prefs');
  return (
    <>
      <Section title="Grid">
        <div className="space-y-2">
          <Toggle label="Show grid" checked={s.grid.visible} onChange={(v) => set((x) => ({ ...x, grid: { ...x.grid, visible: v } }))} />
          <div className="grid grid-cols-2 gap-2">
            <NumField label="Minor spacing" value={s.grid.spacing} min={1} max={5000} onCommit={(v) => set((x) => ({ ...x, grid: { ...x.grid, spacing: v } }))} />
            <NumField label="Major every" value={s.grid.major} min={10} max={50000} onCommit={(v) => set((x) => ({ ...x, grid: { ...x.grid, major: v } }))} />
          </div>
        </div>
      </Section>
      <Section title="Snapping">
        <div className="space-y-2">
          {([['grid', 'Grid'], ['endpoint', 'End points'], ['midpoint', 'Mid points'], ['intersection', 'Intersections'], ['nearest', 'Nearest point on line'], ['ortho', 'Horizontal / vertical / 45° guides'], ['magnet', 'Align with other objects']] as const).map(([k, l]) => (
            <Toggle key={k} label={l} checked={s.snap[k]} onChange={(v) => set((x) => ({ ...x, snap: { ...x.snap, [k]: v } }))} />
          ))}
        </div>
      </Section>
    </>
  );
}

export function GridPanel({ onClose }: { onClose: () => void }) {
  const plan = useEditor((s) => s.doc.plan!);
  return <PanelFrame title="Grid & snap" onClose={onClose}><GridAndSnap plan={plan} /></PanelFrame>;
}

export function PrefsPanel({ onClose }: { onClose: () => void }) {
  const plan = useEditor((s) => s.doc.plan!);
  const s = plan.settings;
  const unit = usePrefs((x) => x.unit);
  const set = (fn: (s: PlanModel['settings']) => PlanModel['settings']) => setPlan((p) => ({ ...p, settings: fn(p.settings) }), 'prefs');
  return (
    <PanelFrame title="Preferences" onClose={onClose}>
      <div className="-m-3">
        <Section title="Units">
          <div className="space-y-2">
            <Select label="Show lengths in" value={unit} options={[{ value: 'mm', label: 'Millimetres' }, { value: 'cm', label: 'Centimetres' }, { value: 'in', label: 'Inches' }]} onChange={(v) => { usePrefs.getState().setUnit(v); set((x) => ({ ...x, units: { ...x.units, display: v } })); }} />
            <p className="text-[11px] text-mute">Everything is stored in millimetres, so changing units never changes a drawing.</p>
          </div>
        </Section>
        <GridAndSnap plan={plan} />
        <Section title="Drawing">
          <div className="space-y-2">
            <Select label="Box selection" value={s.selection.mode} options={[{ value: 'auto', label: 'Auto (right = window, left = crossing)' }, { value: 'window', label: 'Window (fully inside)' }, { value: 'crossing', label: 'Crossing (touching)' }]} onChange={(v) => set((x) => ({ ...x, selection: { mode: v } }))} />
            <Toggle label="Dynamic input box" checked={s.dynamicInput} onChange={(v) => set((x) => ({ ...x, dynamicInput: v }))} hint="Type lengths while drawing" />
            <Toggle label="Show dimensions" checked={s.showDimensions} onChange={(v) => set((x) => ({ ...x, showDimensions: v }))} />
            <Toggle label="Show room names" checked={s.showRoomLabels} onChange={(v) => set((x) => ({ ...x, showRoomLabels: v }))} />
          </div>
        </Section>
        <Section title="New walls">
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <NumField label="Thickness" value={s.wallDefaults.thickness} min={20} max={2000} onCommit={(v) => { set((x) => ({ ...x, wallDefaults: { ...x.wallDefaults, thickness: v } })); usePlanUi.getState().setOption('wall', 'thickness', v); }} />
              <NumField label="Height" value={s.wallDefaults.height} min={500} max={12000} onCommit={(v) => { set((x) => ({ ...x, wallDefaults: { ...x.wallDefaults, height: v } })); usePlanUi.getState().setOption('wall', 'height', v); }} />
            </div>
            <Select label="Type" value={s.wallDefaults.wallType} options={[{ value: 'interior', label: 'Interior' }, { value: 'exterior', label: 'Exterior' }]} onChange={(v) => { set((x) => ({ ...x, wallDefaults: { ...x.wallDefaults, wallType: v } })); usePlanUi.getState().setOption('wall', 'wallType', v); }} />
          </div>
        </Section>
      </div>
    </PanelFrame>
  );
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const plan = useEditor((s) => s.doc.plan!);
  const floorMode = usePlanUi((s) => s.floorMode);
  return (
    <PanelFrame title="Project settings" onClose={onClose}>
      <div className="space-y-4">
        <Select label="Design mode" value={plan.mode} options={[{ value: 'architecture', label: 'Architecture — walls & structure' }, { value: 'interior', label: 'Interior — furniture (architecture locked)' }, { value: 'production', label: 'Production — imported objects only' }]} onChange={(v) => A.setMode(v)} />
        <Toggle label="Lock design" checked={plan.locked} onChange={(v) => setPlan((p) => ({ ...p, locked: v }), 'lock-design')} hint="Blocks every edit until unlocked" />
        <Select label="Floors shown in 3D" value={floorMode} options={[{ value: 'upTo', label: 'This floor and those below' }, { value: 'all', label: 'All floors' }, { value: 'active', label: 'This floor only' }]} onChange={(v) => usePlanUi.getState().setFlag('floorMode', v)} />
        <Toggle label="X-ray (see through walls)" checked={plan.settings.xray} onChange={(v) => setPlan((p) => ({ ...p, settings: { ...p.settings, xray: v } }), 'xray')} />
        <Toggle label="Show reference images" checked={plan.settings.showReferences} onChange={(v) => setPlan((p) => ({ ...p, settings: { ...p.settings, showReferences: v } }), 'refs')} />
        <Toggle label="Show lights" checked={plan.settings.showLights} onChange={(v) => setPlan((p) => ({ ...p, settings: { ...p.settings, showLights: v } }), 'lights')} />
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-sm" onClick={() => usePlanUi.getState().setPanel('floors')}>Buildings &amp; floors…</button>
          <button className="btn btn-sm" onClick={() => usePlanUi.getState().setPanel('rooms')}>Rooms…</button>
          <button className="btn btn-sm" onClick={() => void A.setThumbnail()}>Set thumbnail from this view</button>
        </div>
      </div>
    </PanelFrame>
  );
}

export function ExtraLightPanel({ onClose }: { onClose: () => void }) {
  const plan = useEditor((s) => s.doc.plan!);
  const n = plan.settings.showLights ? plan.extraLighting : 0;
  return (
    <PanelFrame title="Extra lighting" onClose={onClose}>
      <div className="space-y-3">
        <Hint>Scales the brightness of every light and strip light you placed (Insert → Light). It affects the 3D view and renders.</Hint>
        <label className="block text-sm">Brightness ×{plan.extraLighting.toFixed(1)}
          <input type="range" min={0} max={3} step={0.1} value={plan.extraLighting} className="w-full accent-gold" aria-label="Extra lighting brightness" onChange={(e) => setPlan((p) => ({ ...p, extraLighting: Number(e.target.value) }), 'extra-light')} />
        </label>
        {!plan.settings.showLights && <Hint tone="warn">Lights are hidden (View → Existing light). Turn them on to see this setting.</Hint>}
        <p className="text-xs text-mute">{n === 0 ? 'No plan light is active.' : 'The 3D view uses up to 12 plan lights at once for performance.'}</p>
      </div>
    </PanelFrame>
  );
}

// ---------------- branches ----------------

export function BranchPanel({ onClose }: { onClose: () => void }) {
  const doc = useEditor((s) => s.doc);
  const plan = doc.plan!;
  const [name, setName] = useState('');
  const [del, setDel] = useState<string | null>(null);
  const variants = plan.branches.filter((b) => b.id !== '__main__');
  function create() {
    const r = createBranch(plan, doc, name);
    if (!r.ok) return say(r.error, 'warn');
    setPlan(() => r.value, 'branch');
    setName('');
    say('Branch created from the current design. Switch to it to work on the variant.');
  }
  function go(id: string | null) {
    const r = switchBranch(doc, id);
    if (!r.ok) return say(r.error, 'warn');
    useEditor.setState({ past: [], future: [] }); // history belongs to one branch only
    ed().softSet(r.value);
    planHost.setSelection([]);
    usePlanUi.getState().requestZoom('fit');
    say(id ? 'Switched branch. Undo history was reset.' : 'Back on the main design. Undo history was reset.');
  }
  return (
    <PanelFrame title="Branches" onClose={onClose}>
      <div className="space-y-4">
        <Hint>A branch is a saved variant of the whole design (all floors and furniture). Create one before trying a different layout; switch any time. Edits on a branch never change the others.</Hint>
        <section className="space-y-1.5">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-graphite">Create from the current design</h3>
          <div className="flex gap-2"><input className="input" placeholder="e.g. Option B — open kitchen" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} aria-label="Branch name" onKeyDown={(e) => e.key === 'Enter' && create()} /><button className="btn btn-primary" onClick={create}>Create</button></div>
        </section>
        <ul className="space-y-1.5">
          <li className={`flex items-center gap-2 rounded-md border px-2 py-1.5 ${!plan.activeBranch ? 'border-gold bg-gold-soft/30' : 'border-sand'}`}>
            <span className="flex-1">Main design {!plan.activeBranch && <span className="text-xs text-ok">· open</span>}</span>
            {plan.activeBranch && <button className="btn btn-sm" onClick={() => go(null)}>Open</button>}
          </li>
          {variants.map((b) => (
            <li key={b.id} className={`flex items-center gap-2 rounded-md border px-2 py-1.5 ${plan.activeBranch === b.id ? 'border-gold bg-gold-soft/30' : 'border-sand'}`}>
              <span className="min-w-0 flex-1"><span className="block truncate">{b.name}{plan.activeBranch === b.id && <span className="text-xs text-ok"> · open</span>}</span><span className="block text-[10px] text-mute">{new Date(b.createdAt).toLocaleString()}</span></span>
              {plan.activeBranch !== b.id && <button className="btn btn-sm" onClick={() => go(b.id)}>Open</button>}
              <button className="text-xs text-danger" onClick={() => setDel(b.id)}>Delete</button>
            </li>
          ))}
        </ul>
      </div>
      {del && <Confirm title="Delete this branch?" message="The variant is removed permanently." confirmLabel="Delete" onCancel={() => setDel(null)} onConfirm={() => { const r = deleteBranch(plan, del); if (r.ok) setPlan(() => r.value, 'branch'); else say(r.error, 'warn'); setDel(null); }} />}
    </PanelFrame>
  );
}

// ---------------- floor plan wizard ----------------

export function WizardPanel({ onClose }: { onClose: () => void }) {
  const plan = useEditor((s) => s.doc.plan!);
  const [rows, setRows] = useState<WizardRow[]>([
    { depth: 3500, rooms: [{ name: 'Living room', width: 5000 }, { name: 'Kitchen', width: 3000 }] },
    { depth: 3200, rooms: [{ name: 'Bedroom', width: 4000 }, { name: 'Bathroom', width: 2200 }] },
  ]);
  const [thickness, setThickness] = useState(plan.settings.wallDefaults.thickness);
  const [doors, setDoors] = useState(true);
  const [windows, setWindows] = useState(true);
  const [entrance, setEntrance] = useState(true);
  const upd = (ri: number, fn: (r: WizardRow) => WizardRow) => setRows((rs) => rs.map((r, i) => (i === ri ? fn(r) : r)));

  function create() {
    const f = activeFloor(plan);
    const b = floorBounds(f);
    const origin: [number, number] = b ? [Math.round(b.maxX + 2000), Math.round(b.minY)] : [0, 0];
    const r = generateLayout(f, { origin, rows, thickness, height: plan.settings.wallDefaults.height, doors, windows, entrance });
    if (!r.ok) return say(r.error, 'warn');
    if (planHost.locked()) return say('The design is locked.', 'warn');
    setPlan((p) => ({ ...updateFloor(p, f.id, () => r.value.floor), roomProps: { ...p.roomProps, ...Object.fromEntries(Object.entries(r.value.roomNames).map(([k, n]) => [k, { ...p.roomProps[k], name: n }])) } }), 'wizard');
    usePlanUi.getState().setViewMode('2d');
    setTimeout(() => usePlanUi.getState().requestZoom('fit'), 50);
    say(`Created ${Object.keys(r.value.roomNames).length} rooms with walls${doors || windows || entrance ? ' and openings' : ''}. Everything is editable.`);
  }
  return (
    <PanelFrame title="Floor plan wizard" onClose={onClose} wide>
      <div className="space-y-3">
        <Hint tone="warn">AI floor-plan generation is not available in this app. This wizard builds a floor plan from the room sizes <b>you</b> enter: it draws real, editable walls, doors and windows.</Hint>
        {rows.map((row, ri) => (
          <section key={ri} className="space-y-2 rounded-md border border-sand p-2.5">
            <div className="flex items-center justify-between"><h3 className="text-[11px] font-bold uppercase tracking-wider text-graphite">Row {ri + 1}</h3>{rows.length > 1 && <button className="text-xs text-danger" onClick={() => setRows((rs) => rs.filter((_, i) => i !== ri))}>Remove row</button>}</div>
            <NumField label="Row depth (north–south)" value={row.depth} min={WIZARD_MIN} max={30000} onCommit={(v) => upd(ri, (r) => ({ ...r, depth: v }))} />
            {row.rooms.map((rm, ci) => (
              <div key={ci} className="grid grid-cols-[1fr_6.5rem_auto] items-end gap-2">
                <label className="block"><span className="label !mb-0.5 !text-[10px]">Room name</span><input className="input !py-1" value={rm.name} maxLength={40} onChange={(e) => upd(ri, (r) => ({ ...r, rooms: r.rooms.map((x, i) => (i === ci ? { ...x, name: e.target.value } : x)) }))} /></label>
                <NumField label="Width" value={rm.width} min={WIZARD_MIN} max={30000} onCommit={(v) => upd(ri, (r) => ({ ...r, rooms: r.rooms.map((x, i) => (i === ci ? { ...x, width: v } : x)) }))} />
                <button className="pb-1.5 text-xs text-danger disabled:opacity-30" disabled={row.rooms.length < 2} onClick={() => upd(ri, (r) => ({ ...r, rooms: r.rooms.filter((_, i) => i !== ci) }))} aria-label="Remove room">✕</button>
              </div>
            ))}
            <button className="btn btn-sm" onClick={() => upd(ri, (r) => ({ ...r, rooms: [...r.rooms, { name: `Room ${r.rooms.length + 1}`, width: 3000 }] }))}>Add room to row</button>
          </section>
        ))}
        <button className="btn btn-sm" onClick={() => setRows((rs) => [...rs, { depth: 3000, rooms: [{ name: `Room ${rs.length + 1}`, width: 4000 }] }])}>Add row</button>
        <div className="space-y-2 rounded-md bg-linen/60 p-2.5">
          <NumField label="Wall thickness" value={thickness} min={50} max={600} onCommit={(v) => setThickness(v)} />
          <Toggle label="Doors between rooms" checked={doors} onChange={setDoors} />
          <Toggle label="Entrance door" checked={entrance} onChange={setEntrance} />
          <Toggle label="Windows on outer walls" checked={windows} onChange={setWindows} />
        </div>
        <p className="text-[11px] text-mute">The outer rectangle is as wide as your widest row; the last room of a shorter row is stretched to close it. The layout is placed to the right of anything already drawn.</p>
        <button className="btn btn-primary w-full" onClick={create}>Create floor plan</button>
      </div>
    </PanelFrame>
  );
}

// ---------------- help ----------------

export function HelpPanel({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ['Click, click…', 'Draw with click-click (no dragging). Enter or double-click finishes; Esc cancels.'],
    ['Type a number', 'While drawing type a length (3000), an angle (3000<45), an offset (@500,0) or a point (1000,2000), then Enter.'],
    ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
    ['Ctrl+C / V / A', 'Copy / paste / select all'],
    ['Delete', 'Delete selection'],
    ['Arrows', 'Move selection 1 mm (Shift = 10 mm)'],
    ['Space + drag', 'Pan (or middle mouse). Scroll to zoom.'],
    ['Shift+Z / Shift+X', 'Zoom to everything / selection'],
    ['R', 'Rotate the object being placed by 90°'],
    ['Right-click', 'Context menu; while drawing it finishes the shape'],
    ['Alt', 'Hold to ignore snapping'],
    ['Shift', 'Hold to add to the selection (or lock orthogonal while drawing)'],
  ];
  return (
    <PanelFrame title="Shortcuts & tips" onClose={onClose}>
      <dl className="space-y-2">{rows.map(([k, v]) => <div key={k}><dt className="font-semibold">{k}</dt><dd className="text-graphite">{v}</dd></div>)}</dl>
    </PanelFrame>
  );
}

