'use client';
import { useEffect, useRef, useState } from 'react';
import { applyKitchen, makeNode, roomBounds, roomFromRect, type KitchenLayout } from '@/lib/scene';
import { uid } from '@/lib/build/wardrobe';
import { inspectGlb } from '@/lib/three/glb';
import type { ApplianceParams, CabinetVariant, Column, NodeType, Opening, SceneNode } from '@/lib/types';
import { descendants, useEditor } from '@/store/editor';
import { api, Confirm } from '../ui';
import { Hint, NumField, Row, Section, Select, Toggle } from './fields';
import { MaterialPicker } from './MaterialPicker';

interface LibItem {
  id: string;
  label: string;
  group: string;
  type: NodeType;
  variant?: CabinetVariant;
  kind?: ApplianceParams['kind'];
  params?: Record<string, unknown>;
  size?: Partial<SceneNode['size']>;
  hint?: string;
}

export const LIBRARY: LibItem[] = [
  { id: 'wd-hinged', label: 'Hinged wardrobe', group: 'Wardrobes', type: 'wardrobe', size: { w: 2100 } },
  { id: 'wd-sliding', label: 'Sliding wardrobe', group: 'Wardrobes', type: 'wardrobe', size: { w: 2400 }, params: { style: 'sliding', doorCount: 3 } },
  { id: 'wd-open', label: 'Open wardrobe', group: 'Wardrobes', type: 'wardrobe', size: { w: 1500 }, params: { style: 'open' } },
  { id: 'wd-loft', label: 'Wardrobe with loft', group: 'Wardrobes', type: 'wardrobe', size: { w: 2400, h: 2700 }, params: { loftHeight: 500 } },
  { id: 'k-base', label: 'Base cabinet', group: 'Kitchen cabinets', type: 'cabinet', variant: 'base' },
  { id: 'k-drawer', label: 'Drawer cabinet', group: 'Kitchen cabinets', type: 'cabinet', variant: 'drawer' },
  { id: 'k-sink', label: 'Sink cabinet', group: 'Kitchen cabinets', type: 'cabinet', variant: 'sink' },
  { id: 'k-corner', label: 'Corner cabinet', group: 'Kitchen cabinets', type: 'cabinet', variant: 'corner' },
  { id: 'k-wall', label: 'Wall cabinet', group: 'Kitchen cabinets', type: 'cabinet', variant: 'wall' },
  { id: 'k-tall', label: 'Tall pantry unit', group: 'Kitchen cabinets', type: 'cabinet', variant: 'tall' },
  { id: 'k-open', label: 'Open shelf', group: 'Kitchen cabinets', type: 'cabinet', variant: 'open_shelf' },
  { id: 'k-island', label: 'Island / breakfast counter', group: 'Kitchen cabinets', type: 'cabinet', variant: 'island' },
  { id: 'k-counter', label: 'Countertop + backsplash', group: 'Kitchen cabinets', type: 'countertop' },
  { id: 'a-fridge', label: 'Refrigerator', group: 'Appliances', type: 'appliance', kind: 'fridge' },
  { id: 'a-oven', label: 'Oven', group: 'Appliances', type: 'appliance', kind: 'oven' },
  { id: 'a-micro', label: 'Microwave', group: 'Appliances', type: 'appliance', kind: 'microwave' },
  { id: 'a-hob', label: 'Hob', group: 'Appliances', type: 'appliance', kind: 'hob' },
  { id: 'a-chimney', label: 'Chimney / hood', group: 'Appliances', type: 'appliance', kind: 'chimney' },
  { id: 'a-dish', label: 'Dishwasher', group: 'Appliances', type: 'appliance', kind: 'dishwasher' },
  { id: 'a-sink', label: 'Sink & faucet', group: 'Appliances', type: 'appliance', kind: 'sink' },
  { id: 'a-light', label: 'Task light', group: 'Appliances', type: 'appliance', kind: 'light_strip' },
  { id: 'tv-full', label: 'Full-wall TV panel', group: 'TV & entertainment', type: 'tv_panel' },
  { id: 'tv-float', label: 'Compact floating TV unit', group: 'TV & entertainment', type: 'tv_panel', size: { w: 2400, h: 2500 }, params: { sides: { left: { enabled: false, width: 450, height: 2000, kind: 'closed' }, right: { enabled: false, width: 450, height: 2000, kind: 'closed' }, depth: 380 }, style: 'plain' } },
  { id: 'c-book', label: 'Bookcase / display', group: 'Custom furniture', type: 'cabinet', variant: 'bookcase' },
  { id: 'c-box', label: 'Block / panel', group: 'Custom furniture', type: 'box' },
  { id: 'c-cyl', label: 'Cylinder', group: 'Custom furniture', type: 'box', params: { shape: 'cylinder' }, size: { w: 400, h: 450, d: 400 } },
];

export function createLibraryNode(item: LibItem, at?: [number, number]): SceneNode {
  const doc = useEditor.getState().doc;
  const b = roomBounds(doc.room);
  const n = makeNode(item.type, { variant: item.variant, kind: item.kind, params: item.params, size: item.size });
  const x = at ? at[0] : (b.minX + b.maxX) / 2;
  const z = at ? at[1] : b.minZ + n.size.d / 2 + 40;
  n.position = [x, n.position[1], z];
  if (item.type === 'tv_panel') {
    const p = n.params as { unit: { width: number }; sides: { left: { enabled: boolean; width: number }; right: { enabled: boolean; width: number } } };
    const sl = p.sides.left.enabled ? p.sides.left.width : 0;
    const sr = p.sides.right.enabled ? p.sides.right.width : 0;
    p.unit.width = Math.max(600, n.size.w - sl - sr - 40);
  }
  return n;
}

interface CatalogRow { id: string; kind: string; name: string; category: string; data: Record<string, unknown>; mine: boolean; shared: boolean }

export function LeftPanel() {
  const tab = useEditor((s) => s.ui.leftTab);
  const setUi = useEditor((s) => s.setUi);
  const tabs = [['library', 'Library'], ['scene', 'Scene'], ['room', 'Room']] as const;
  return (
    <aside className="flex w-[17.5rem] shrink-0 flex-col border-r border-sand bg-paper" aria-label="Component library and scene">
      <div className="flex border-b border-sand" role="tablist">
        {tabs.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setUi({ leftTab: k })} className={`flex-1 px-2 py-2.5 text-xs font-bold uppercase tracking-wider transition ${tab === k ? 'border-b-2 border-gold text-ink' : 'text-mute hover:text-ink'}`}>
            {l}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'library' && <LibraryTab />}
        {tab === 'scene' && <SceneTab />}
        {tab === 'room' && <RoomTab />}
      </div>
    </aside>
  );
}

function LibraryTab() {
  const addNode = useEditor((s) => s.addNode);
  const category = useEditor((s) => s.doc.category);
  const doc = useEditor((s) => s.doc);
  const access = useEditor((s) => s.access);
  const [q, setQ] = useState('');
  const [mine, setMine] = useState<CatalogRow[] | null>(null);
  const [layoutAsk, setLayoutAsk] = useState<KitchenLayout | null>(null);
  const glbRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const groups = Array.from(new Set(LIBRARY.map((l) => l.group)));
  const pref: Record<string, string[]> = { WARDROBE: ['Wardrobes'], KITCHEN: ['Kitchen cabinets', 'Appliances'], TV_PANEL: ['TV & entertainment'], CUSTOM: ['Custom furniture'] };
  groups.sort((a, b) => Number(!(pref[category] ?? []).includes(a)) - Number(!(pref[category] ?? []).includes(b)));

  useEffect(() => {
    api<{ items: CatalogRow[] }>('/api/catalog?kind=COMPONENT').then((r) => setMine(r.items)).catch(() => setMine([]));
  }, []);

  const add = (item: LibItem) => addNode(createLibraryNode(item), { snap: true });
  async function importGlb(f: File) {
    setImporting(true);
    try {
      const info = await inspectGlb(f); // validates structure, triangle count and size in the browser
      const fd = new FormData();
      fd.append('file', f);
      const r = await api<{ asset: { url: string; name: string } }>('/api/assets', { method: 'POST', body: fd }); // server re-validates signature/header
      const node = makeNode('model', { name: f.name.replace(/\.glb$/i, ''), size: info.size, params: { url: r.asset.url, fileName: f.name, triangles: info.triangles } });
      const b = roomBounds(doc.room);
      node.position = [(b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2];
      addNode(node, { snap: false });
      useEditor.getState().toast('success', `Imported ${f.name} (${info.triangles.toLocaleString()} triangles).`);
    } catch (e) {
      useEditor.getState().toast('error', `Import failed: ${(e as Error).message}`);
    }
    setImporting(false);
  }
  const addSaved = (row: CatalogRow) => {
    const raw = row.data.node as SceneNode | undefined;
    if (!raw) return;
    const b = roomBounds(doc.room);
    const n: SceneNode = { ...structuredClone(raw), id: uid(raw.type.slice(0, 3)), parentId: null, position: [(b.minX + b.maxX) / 2, raw.position?.[1] ?? 0, b.minZ + raw.size.d / 2 + 40] };
    addNode(n, { snap: true });
  };
  const removeSaved = async (row: CatalogRow) => {
    try {
      await api(`/api/catalog/${row.id}`, { method: 'DELETE' });
      setMine((m) => m?.filter((x) => x.id !== row.id) ?? null);
    } catch (e) {
      useEditor.getState().toast('error', (e as Error).message);
    }
  };

  return (
    <div className="p-2.5">
      <input className="input mb-2 !py-1.5" placeholder="Search components" aria-label="Search components" value={q} onChange={(e) => setQ(e.target.value)} />
      {access === 'VIEW' && <Hint tone="warn">View-only: adding components is disabled.</Hint>}
      {category === 'KITCHEN' && (
        <div className="mb-3 rounded-lg border border-sand bg-linen/50 p-2">
          <div className="label">Generate kitchen layout</div>
          <div className="grid grid-cols-3 gap-1">
            {([['straight', 'Straight'], ['l_shape', 'L-shape'], ['u_shape', 'U-shape'], ['parallel', 'Parallel'], ['island', 'Island']] as [KitchenLayout, string][]).map(([k, l]) => (
              <button key={k} className="btn btn-sm !px-1" disabled={access === 'VIEW'} onClick={() => (doc.order.length ? setLayoutAsk(k) : useEditor.getState().replaceDoc(applyKitchen(doc, k)))}>{l}</button>
            ))}
          </div>
          <button className="btn btn-sm mt-1.5 w-full" onClick={() => useEditor.getState().fixCountertops()} disabled={access === 'VIEW'}>Auto-fit countertops</button>
        </div>
      )}
      {groups.map((g) => {
        const items = LIBRARY.filter((l) => l.group === g && l.label.toLowerCase().includes(q.toLowerCase()));
        if (!items.length) return null;
        return (
          <section key={g} className="mb-3">
            <h3 className="mb-1 px-1 text-[10px] font-bold uppercase tracking-[0.16em] text-mute">{g}</h3>
            <ul className="space-y-1">
              {items.map((it) => (
                <li key={it.id}>
                  <button
                    draggable={access !== 'VIEW'}
                    onDragStart={(e) => { e.dataTransfer.setData('application/x-nivas-lib', it.id); e.dataTransfer.effectAllowed = 'copy'; }}
                    onClick={() => add(it)}
                    disabled={access === 'VIEW'}
                    className="group flex w-full items-center gap-2 rounded-md border border-sand bg-paper px-2.5 py-2 text-left text-[13px] transition hover:border-gold hover:bg-gold-soft/20 disabled:opacity-50"
                    title="Click to add, or drag into the 3D view"
                  >
                    <span className="grid h-6 w-6 place-items-center rounded bg-linen text-xs text-wood group-hover:bg-gold-soft">+</span>
                    {it.label}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <section className="mb-3">
        <h3 className="mb-1 px-1 text-[10px] font-bold uppercase tracking-[0.16em] text-mute">Imported 3D assets</h3>
        <input ref={glbRef} type="file" accept=".glb,model/gltf-binary" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importGlb(f); e.target.value = ''; }} />
        <button className="btn btn-sm w-full" disabled={access === 'VIEW' || importing} onClick={() => glbRef.current?.click()}>{importing ? 'Validating…' : 'Import GLB model…'}</button>
        <p className="mt-1 px-1 text-[10px] text-mute">GLB (glTF 2.0) up to 8 MB, 600k triangles. Units assumed metres; resize afterwards.</p>
      </section>
      <section className="mb-3">
        <h3 className="mb-1 px-1 text-[10px] font-bold uppercase tracking-[0.16em] text-mute">My saved components</h3>
        {mine === null && <p className="px-1 text-xs text-mute">Loading…</p>}
        {mine?.length === 0 && <p className="px-1 text-xs text-mute">None yet. Select a component and use “Save to my component library”.</p>}
        <ul className="space-y-1">
          {mine?.filter((m) => m.name.toLowerCase().includes(q.toLowerCase())).map((m) => (
            <li key={m.id} className="flex items-center gap-1">
              <button className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-sand px-2.5 py-2 text-left text-[13px] hover:border-gold hover:bg-gold-soft/20" onClick={() => addSaved(m)} disabled={access === 'VIEW'}>
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-linen text-xs text-wood">★</span>
                <span className="truncate">{m.name}</span>
              </button>
              {m.mine && <button className="px-1 text-xs text-danger" aria-label={`Delete ${m.name} from library`} onClick={() => removeSaved(m)}>✕</button>}
            </li>
          ))}
        </ul>
      </section>
      {layoutAsk && (
        <Confirm
          title="Replace current layout?"
          confirmLabel="Replace"
          message="This regenerates all cabinets and appliances for the new layout. You can undo it with Ctrl+Z."
          onCancel={() => setLayoutAsk(null)}
          onConfirm={() => { useEditor.getState().replaceDoc(applyKitchen(doc, layoutAsk)); setLayoutAsk(null); }}
        />
      )}
    </div>
  );
}

function SceneTab() {
  const doc = useEditor((s) => s.doc);
  const sel = useEditor((s) => s.sel);
  const select = useEditor((s) => s.select);
  const { toggleLock, toggleVisible } = useEditor.getState();
  const roots = doc.order.filter((id) => doc.nodes[id] && !doc.nodes[id].parentId);
  const render = (id: string, depth: number): React.ReactNode => {
    const n = doc.nodes[id];
    if (!n) return null;
    const kids = doc.order.filter((k) => doc.nodes[k]?.parentId === id);
    return (
      <li key={id}>
        <div className={`flex items-center gap-1 rounded px-1.5 py-1 text-[13px] ${sel.ids.includes(id) ? 'bg-gold-soft/50' : 'hover:bg-linen'}`} style={{ paddingLeft: 6 + depth * 14 }}>
          <button className={`min-w-0 flex-1 truncate text-left ${n.visible ? '' : 'text-stone line-through'}`} onClick={(e) => select([id], e.shiftKey || e.ctrlKey || e.metaKey)}>
            {n.type === 'group' ? '▸ ' : ''}{n.name}
          </button>
          <button className={`px-1 text-xs ${n.visible ? 'text-graphite' : 'text-stone'}`} title={n.visible ? 'Hide' : 'Show'} aria-label={n.visible ? `Hide ${n.name}` : `Show ${n.name}`} onClick={() => toggleVisible([id])}>{n.visible ? '👁' : '○'}</button>
          <button className={`px-1 text-xs ${n.locked ? 'text-wood' : 'text-stone'}`} title={n.locked ? 'Unlock' : 'Lock'} aria-label={n.locked ? `Unlock ${n.name}` : `Lock ${n.name}`} onClick={() => toggleLock([id])}>{n.locked ? '🔒' : '🔓'}</button>
        </div>
        {kids.length > 0 && <ul>{kids.map((k) => render(k, depth + 1))}</ul>}
      </li>
    );
  };
  return (
    <div className="p-2">
      {roots.length === 0 ? <p className="p-3 text-center text-sm text-mute">The scene is empty. Add components from the Library tab.</p> : <ul>{roots.map((r) => render(r, 0))}</ul>}
      <p className="mt-3 px-1 text-[11px] text-mute">{descendantsCount(doc.order.length)} components. Hold Shift to select several.</p>
    </div>
  );
}
const descendantsCount = (n: number) => n;
void descendants;

// ---------------- Room ----------------
function RoomTab() {
  const room = useEditor((s) => s.doc.room);
  const setRoom = useEditor((s) => s.setRoom);
  const category = useEditor((s) => s.doc.category);
  const doc = useEditor((s) => s.doc);
  const b = roomBounds(room);
  const rect = room.points.length === 4 && room.points.every(([x, z]) => (x === b.minX || x === b.maxX) && (z === b.minZ || z === b.maxZ));
  const [wall, setWall] = useState(0);
  void category;
  return (
    <div>
      <Section title="Room shape">
        <RoomPlan />
        {rect && (
          <Row>
            <NumField label="Length (X)" value={b.maxX - b.minX} min={1500} onCommit={(v) => setRoom((r) => ({ ...roomFromRect(v, b.maxZ - b.minZ, r.height), openings: r.openings.filter((o) => o.wall < 4), floorMaterial: r.floorMaterial, wallMaterial: r.wallMaterial, ceilingMaterial: r.ceilingMaterial, columns: r.columns, wallThickness: r.wallThickness, showWalls: r.showWalls, showCeiling: r.showCeiling }))} />
            <NumField label="Width (Z)" value={b.maxZ - b.minZ} min={1500} onCommit={(v) => setRoom((r) => ({ ...r, points: [[0, 0], [b.maxX - b.minX, 0], [b.maxX - b.minX, v], [0, v]] }))} />
            <NumField label="Height" value={room.height} min={2000} max={5000} onCommit={(v) => setRoom((r) => ({ ...r, height: v }))} />
          </Row>
        )}
        {!rect && <NumField label="Ceiling height" value={room.height} min={2000} max={5000} onCommit={(v) => setRoom((r) => ({ ...r, height: v }))} />}
        <Row cols={2}>
          <button className="btn btn-sm" onClick={() => setRoom((r) => ({ ...r, points: [[0, 0], [4200, 0], [4200, 2000], [2400, 2000], [2400, 3600], [0, 3600]], openings: r.openings.filter((o) => o.wall < 6) }))}>L-shaped room</button>
          <button className="btn btn-sm" onClick={() => setRoom((r) => ({ ...r, points: [[0, 0], [3600, 0], [3600, 3200], [0, 3200]] }))}>Rectangle</button>
        </Row>
      </Section>

      <Section title={`Corners (${room.points.length})`} defaultOpen={false}>
        {room.points.map(([x, z], i) => (
          <div key={i} className="grid grid-cols-[18px_1fr_1fr_18px] items-center gap-1.5">
            <span className="text-[11px] text-mute">{i + 1}</span>
            <NumField compact value={x} onCommit={(v) => setRoom((r) => ({ ...r, points: r.points.map((p, k) => (k === i ? [v, p[1]] : p)) as [number, number][] }))} />
            <NumField compact value={z} onCommit={(v) => setRoom((r) => ({ ...r, points: r.points.map((p, k) => (k === i ? [p[0], v] : p)) as [number, number][] }))} />
            <button className="text-danger" aria-label={`Remove corner ${i + 1}`} onClick={() => setRoom((r) => ({ ...r, points: r.points.filter((_, k) => k !== i), openings: r.openings.filter((o) => o.wall !== i && o.wall < r.points.length - 1) }))}>✕</button>
          </div>
        ))}
        <button
          className="btn btn-sm"
          onClick={() =>
            setRoom((r) => {
              const a = r.points[r.points.length - 1];
              const c = r.points[0];
              return { ...r, points: [...r.points, [Math.round((a[0] + c[0]) / 2), Math.round((a[1] + c[1]) / 2)]] };
            })
          }
        >
          + Add corner (splits last wall)
        </button>
      </Section>

      <Section title="Doors, windows & openings" defaultOpen={false}>
        <div className="grid grid-cols-3 gap-1">
          {(['door', 'window', 'opening'] as const).map((k) => (
            <button
              key={k}
              className="btn btn-sm"
              onClick={() => setRoom((r) => ({ ...r, openings: [...r.openings, { id: uid('op'), kind: k, wall, offset: 300, width: k === 'door' ? 900 : k === 'window' ? 1200 : 1500, height: k === 'door' ? 2100 : k === 'window' ? 1200 : 2100, sill: k === 'window' ? 900 : 0 }] }))}
            >
              + {k}
            </button>
          ))}
        </div>
        <Select label="Add on wall" value={String(wall)} onChange={(v) => setWall(Number(v))} options={room.points.map((_, i) => ({ value: String(i), label: `Wall ${i + 1}` }))} />
        {room.openings.map((o) => {
          const upd = (patch: Partial<Opening>) => setRoom((r) => ({ ...r, openings: r.openings.map((x) => (x.id === o.id ? { ...x, ...patch } : x)) }));
          return (
            <div key={o.id} className="rounded-md border border-sand p-2">
              <div className="mb-1 flex items-center justify-between text-xs font-semibold capitalize">
                {o.kind} · wall {o.wall + 1}
                <button className="text-danger" aria-label="Remove opening" onClick={() => setRoom((r) => ({ ...r, openings: r.openings.filter((x) => x.id !== o.id) }))}>✕</button>
              </div>
              <Row cols={2}>
                <Select value={String(o.wall)} onChange={(v) => upd({ wall: Number(v) })} options={room.points.map((_, i) => ({ value: String(i), label: `Wall ${i + 1}` }))} />
                <NumField compact label="Offset" value={o.offset} min={0} onCommit={(v) => setRoom((r) => ({ ...r, openings: r.openings.map((x) => (x.id === o.id ? { ...x, offset: v } : x)) }))} />
                <NumField compact label="Width" value={o.width} min={300} onCommit={(v) => setRoom((r) => ({ ...r, openings: r.openings.map((x) => (x.id === o.id ? { ...x, width: v } : x)) }))} />
                <NumField compact label="Height" value={o.height} min={300} onCommit={(v) => setRoom((r) => ({ ...r, openings: r.openings.map((x) => (x.id === o.id ? { ...x, height: v } : x)) }))} />
                <NumField compact label="Sill" value={o.sill} min={0} onCommit={(v) => setRoom((r) => ({ ...r, openings: r.openings.map((x) => (x.id === o.id ? { ...x, sill: v } : x)) }))} />
              </Row>
            </div>
          );
        })}
      </Section>

      <Section title="Columns" defaultOpen={false} right={<button className="btn btn-sm" onClick={() => setRoom((r) => ({ ...r, columns: [...r.columns, { id: uid('col'), x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2, w: 300, d: 300 }] }))}>+ Add</button>}>
        {room.columns.map((c) => {
          const upd = (patch: Partial<Column>) => setRoom((r) => ({ ...r, columns: r.columns.map((x) => (x.id === c.id ? { ...x, ...patch } : x)) }));
          return (
            <div key={c.id} className="rounded-md border border-sand p-2">
              <Row cols={4}>
                <NumField compact label="X" value={c.x} onCommit={(v) => upd({ x: v })} />
                <NumField compact label="Z" value={c.z} onCommit={(v) => upd({ z: v })} />
                <NumField compact label="W" value={c.w} min={50} onCommit={(v) => upd({ w: v })} />
                <NumField compact label="D" value={c.d} min={50} onCommit={(v) => upd({ d: v })} />
              </Row>
              <button className="mt-1 text-xs text-danger" onClick={() => setRoom((r) => ({ ...r, columns: r.columns.filter((x) => x.id !== c.id) }))}>Remove column</button>
            </div>
          );
        })}
        {!room.columns.length && <p className="text-xs text-mute">No columns.</p>}
      </Section>

      <Section title="Finishes & display" defaultOpen={false}>
        <div className="grid grid-cols-[80px_1fr] items-center gap-2 text-xs">
          Floor
          <MaterialPicker value={room.floorMaterial} onChange={(m) => setRoom((r) => ({ ...r, floorMaterial: m }))} />
          Walls
          <MaterialPicker value={room.wallMaterial} onChange={(m) => setRoom((r) => ({ ...r, wallMaterial: m }))} />
          Ceiling
          <MaterialPicker value={room.ceilingMaterial} onChange={(m) => setRoom((r) => ({ ...r, ceilingMaterial: m }))} />
        </div>
        <NumField label="Wall thickness" value={room.wallThickness} min={50} max={400} onCommit={(v) => setRoom((r) => ({ ...r, wallThickness: v }))} />
        <Toggle label="Show walls" checked={room.showWalls} onChange={(v) => { setRoom((r) => ({ ...r, showWalls: v })); useEditor.getState().setUi({ showWalls: v }); }} />
        <Toggle label="Show ceiling" checked={room.showCeiling} onChange={(v) => { setRoom((r) => ({ ...r, showCeiling: v })); useEditor.getState().setUi({ showCeiling: v }); }} />
      </Section>
      <p className="px-3 pb-3 text-[11px] text-mute">{Object.keys(doc.nodes).length} components in this room.</p>
    </div>
  );
}

/** Small SVG plan: drag a corner to reshape the room (snaps to 50 mm). */
function RoomPlan() {
  const room = useEditor((s) => s.doc.room);
  const nodes = useEditor((s) => s.doc.nodes);
  const setRoom = useEditor((s) => s.setRoom);
  const [drag, setDrag] = useState<{ i: number; pts: [number, number][] } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const pts = drag?.pts ?? room.points;
  const b = roomBounds({ ...room, points: pts });
  const pad = 300;
  const W = b.maxX - b.minX + 2 * pad;
  const H = b.maxZ - b.minZ + 2 * pad;
  const vb = `${b.minX - pad} ${b.minZ - pad} ${W} ${H}`;
  const toLocal = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left) / r.width) * W + b.minX - pad), Math.round(((e.clientY - r.top) / r.height) * H + b.minZ - pad)] as [number, number];
  };
  return (
    <svg
      ref={svg}
      viewBox={vb}
      className="w-full touch-none rounded-md border border-sand bg-linen/60"
      style={{ aspectRatio: `${W} / ${H}`, maxHeight: 220 }}
      role="img"
      aria-label="Room plan - drag the corner handles to reshape"
      onPointerMove={(e) => {
        if (!drag) return;
        const [x, z] = toLocal(e);
        const sx = Math.round(x / 50) * 50;
        const sz = Math.round(z / 50) * 50;
        setDrag({ i: drag.i, pts: drag.pts.map((p, k) => (k === drag.i ? [sx, sz] : p)) as [number, number][] });
      }}
      onPointerUp={() => {
        if (drag) {
          const next = drag.pts;
          setDrag(null);
          setRoom((r) => ({ ...r, points: next }));
        }
      }}
    >
      <polygon points={pts.map((p) => p.join(',')).join(' ')} fill="#fff" stroke="#26272b" strokeWidth={Math.max(W, H) / 120} />
      {Object.values(nodes).filter((n) => n.type !== 'group').map((n) => {
        const th = (n.rotationY * Math.PI) / 180;
        const c = Math.cos(th), s = Math.sin(th);
        const poly = [[-n.size.w / 2, -n.size.d / 2], [n.size.w / 2, -n.size.d / 2], [n.size.w / 2, n.size.d / 2], [-n.size.w / 2, n.size.d / 2]].map(([lx, lz]) => `${n.position[0] + lx * c + lz * s},${n.position[2] - lx * s + lz * c}`).join(' ');
        return <polygon key={n.id} points={poly} fill={n.type === 'appliance' ? '#d8d8d8' : '#e7d4a6'} stroke="#a9794a" strokeWidth={Math.max(W, H) / 400} />;
      })}
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p[0]} cy={p[1]} r={Math.max(W, H) / 40} fill="#b8923f" stroke="#fff" strokeWidth={Math.max(W, H) / 300} className="cursor-move" onPointerDown={(e) => { (e.currentTarget as Element).setPointerCapture?.(e.pointerId); setDrag({ i, pts: room.points.map((q) => [...q] as [number, number]) }); }} />
          <text x={p[0]} y={p[1] - Math.max(W, H) / 32} fontSize={Math.max(W, H) / 26} textAnchor="middle" fill="#26272b">{i + 1}</text>
        </g>
      ))}
    </svg>
  );
}
