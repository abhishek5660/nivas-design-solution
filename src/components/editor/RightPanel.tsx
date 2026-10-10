'use client';
import { useEffect, useRef, useState } from 'react';
import { SAMPLE_HARDWARE, SAMPLE_MATERIALS, materialIndex } from '@/lib/catalog';
import { uid } from '@/lib/build/wardrobe';
import type { MaterialDef, Slot, TextureKind } from '@/lib/types';
import { SLOTS } from '@/lib/types';
import { useEditor } from '@/store/editor';
import { api, Confirm, Dialog } from '../ui';
import { Hint, NumField, Row, Section, Select, Toggle } from './fields';
import { Inspector } from './Inspector';
import { MaterialPicker, Swatch, useAllMaterials } from './MaterialPicker';

export function RightPanel() {
  const tab = useEditor((s) => s.ui.rightTab);
  const setUi = useEditor((s) => s.setUi);
  const tabs = [['properties', 'Properties'], ['materials', 'Materials'], ['lighting', 'Lighting']] as const;
  return (
    <aside className="flex w-[21rem] shrink-0 flex-col border-l border-sand bg-paper" aria-label="Properties">
      <div className="flex border-b border-sand" role="tablist">
        {tabs.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setUi({ rightTab: k })} className={`flex-1 px-2 py-2.5 text-xs font-bold uppercase tracking-wider transition ${tab === k ? 'border-b-2 border-gold text-ink' : 'text-mute hover:text-ink'}`}>
            {l}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'properties' && <Inspector />}
        {tab === 'materials' && <MaterialsPanel />}
        {tab === 'lighting' && <LightingPanel />}
      </div>
    </aside>
  );
}

function LightingPanel() {
  const l = useEditor((s) => s.doc.lighting);
  const set = useEditor((s) => s.setDocPart);
  const upd = (p: Partial<typeof l>, key?: string) => set('lighting', { ...l, ...p }, key ?? 'lighting');
  return (
    <div>
      <Section title="Scene lighting">
        <Select label="Preset" value={l.preset} onChange={(v) => upd({ preset: v })} options={[{ value: 'daylight', label: 'Daylight' }, { value: 'neutral', label: 'Neutral studio' }, { value: 'warm', label: 'Warm evening light' }, { value: 'night', label: 'Night (LEDs only)' }]} />
        <NumField label="Room light level" length={false} suffix="×" value={l.roomLight} min={0} max={4} step={0.1} onCommit={(v) => upd({ roomLight: v }, 'lighting:room')} />
      </Section>
      <Section title="Camera & tone">
        <NumField label="Exposure" length={false} suffix="×" value={l.exposure} min={0.1} max={4} step={0.1} onCommit={(v) => upd({ exposure: v }, 'lighting:exp')} />
        <Select label="Tone mapping" value={l.toneMapping} onChange={(v) => upd({ toneMapping: v })} options={[{ value: 'ACES', label: 'ACES Filmic' }, { value: 'AgX', label: 'AgX' }, { value: 'Neutral', label: 'Neutral' }, { value: 'None', label: 'None (linear)' }]} />
        <Toggle label="Soft shadows" checked={l.shadows} onChange={(v) => upd({ shadows: v })} />
      </Section>
      <Section title="Quality notes" defaultOpen={false}>
        <Hint>Real-time view uses PBR materials, an image-based environment, PCF soft shadows and contact shadows. Use Render for a supersampled still with jittered soft shadows.</Hint>
        <Hint>True ambient-occlusion post-processing is not enabled in the live view (contact shadows approximate it).</Hint>
      </Section>
    </div>
  );
}

interface CatRow { id: string; kind: string; name: string; category: string; data: Record<string, unknown>; mine: boolean; shared: boolean; verified: boolean }

const TEX_OPTIONS: { value: TextureKind; label: string }[] = [
  { value: 'none', label: 'Plain colour' },
  { value: 'wood_oak', label: 'Oak grain' },
  { value: 'wood_walnut', label: 'Walnut grain' },
  { value: 'wood_teak', label: 'Teak grain' },
  { value: 'wood_ash', label: 'Ash grain' },
  { value: 'laminate_grain', label: 'Fine laminate' },
  { value: 'marble', label: 'Marble veining' },
  { value: 'stone', label: 'Stone speckle' },
  { value: 'fluted', label: 'Fluted' },
  { value: 'slat', label: 'Slats' },
  { value: 'brushed_metal', label: 'Brushed metal' },
  { value: 'fabric', label: 'Fabric' },
  { value: 'image', label: 'Uploaded image' },
];

function MaterialsPanel() {
  const doc = useEditor((s) => s.doc);
  const upsert = useEditor((s) => s.upsertMaterial);
  const remove = useEditor((s) => s.removeMaterial);
  const setDocPart = useEditor((s) => s.setDocPart);
  const all = useAllMaterials();
  const [editId, setEditId] = useState<string | null>(null);
  const [del, setDel] = useState<MaterialDef | null>(null);
  const [mine, setMine] = useState<CatRow[]>([]);
  const [themeName, setThemeName] = useState('');
  const [showHw, setShowHw] = useState(false);
  const idx = materialIndex(doc.customMaterials);
  const editing = editId ? idx.get(editId) : null;

  const loadMine = () => api<{ items: CatRow[] }>('/api/catalog').then((r) => setMine(r.items.filter((i) => i.kind === 'MATERIAL' || i.kind === 'THEME'))).catch(() => undefined);
  useEffect(() => { loadMine(); }, []);

  const duplicate = (m: MaterialDef) => {
    const copy: MaterialDef = { ...m, id: `cm_${uid('m')}`, name: m.source === 'custom' ? `${m.name} copy` : `${m.name} (custom)`, source: 'custom', verified: false, catalogId: undefined };
    upsert(copy);
    setEditId(copy.id);
  };
  const create = () => {
    const m: MaterialDef = { id: `cm_${uid('m')}`, name: 'New material', category: 'Custom', color: '#c9a37a', roughness: 0.6, metalness: 0, texture: 'none', textureScale: 1, source: 'custom', verified: false };
    upsert(m);
    setEditId(m.id);
  };

  async function saveToCatalog(m: MaterialDef) {
    try {
      await api('/api/catalog', { method: 'POST', body: JSON.stringify({ kind: 'MATERIAL', name: m.name, category: m.category, data: { material: m } }) });
      useEditor.getState().toast('success', `"${m.name}" saved to your catalog - available in all projects.`);
      loadMine();
    } catch (e) {
      useEditor.getState().toast('error', (e as Error).message);
    }
  }
  function addFromCatalog(row: CatRow) {
    const m = row.data.material as MaterialDef | undefined;
    if (!m) return;
    if (doc.customMaterials.some((x) => x.catalogId === row.id)) return useEditor.getState().toast('info', 'Already in this project.');
    upsert({ ...m, id: `cm_${uid('m')}`, catalogId: row.id, source: 'custom', verified: false });
    useEditor.getState().toast('success', `Added "${m.name}" to this project.`);
  }
  async function saveTheme() {
    if (!themeName.trim()) return;
    try {
      await api('/api/catalog', { method: 'POST', body: JSON.stringify({ kind: 'THEME', name: themeName.trim(), category: 'Theme', data: { defaults: doc.defaults, room: { floor: doc.room.floorMaterial, wall: doc.room.wallMaterial }, materials: doc.customMaterials.filter((m) => Object.values(doc.defaults).includes(m.id)) } }) });
      setThemeName('');
      useEditor.getState().toast('success', 'Theme saved.');
      loadMine();
    } catch (e) {
      useEditor.getState().toast('error', (e as Error).message);
    }
  }
  function applyTheme(row: CatRow) {
    const d = row.data.defaults as Record<string, string> | undefined;
    const mats = (row.data.materials as MaterialDef[] | undefined) ?? [];
    if (!d) return;
    const existing = new Set(doc.customMaterials.map((m) => m.id));
    const customMaterials = [...doc.customMaterials, ...mats.filter((m) => !existing.has(m.id))];
    setDocPart('customMaterials', customMaterials);
    useEditor.getState().setDocPart('defaults', { ...doc.defaults, ...d });
    useEditor.getState().toast('success', `Theme "${row.name}" applied to project defaults.`);
  }

  const themes = mine.filter((m) => m.kind === 'THEME');
  const mats = mine.filter((m) => m.kind === 'MATERIAL');

  return (
    <div>
      <Section title="Project default finishes">
        <div className="space-y-1.5">
          {SLOTS.filter((s) => !['glass', 'mirror', 'backsplash'].includes(s.slot) || true).map(({ slot, label }) => (
            <div key={slot} className="grid grid-cols-[88px_1fr] items-center gap-2 text-xs">
              {label}
              <MaterialPicker value={doc.defaults[slot] ?? null} onChange={(m) => setDocPart('defaults', { ...doc.defaults, [slot]: m }, `def:${slot}`)} />
            </div>
          ))}
        </div>
        <Hint>Component-level and sub-component materials override these. Select a component to change just that one.</Hint>
      </Section>

      <Section title="Themes (material combinations)" defaultOpen={false}>
        <div className="flex gap-1">
          <input className="input !py-1" placeholder="Theme name" value={themeName} onChange={(e) => setThemeName(e.target.value)} />
          <button className="btn btn-sm" onClick={saveTheme} disabled={!themeName.trim()}>Save</button>
        </div>
        {themes.length === 0 && <p className="text-xs text-mute">No saved themes yet.</p>}
        {themes.map((t) => (
          <div key={t.id} className="flex items-center justify-between rounded-md border border-sand px-2 py-1 text-xs">
            {t.name}
            <span className="flex gap-1">
              <button className="btn btn-sm" onClick={() => applyTheme(t)}>Apply</button>
              {t.mine && <button className="text-danger" aria-label={`Delete theme ${t.name}`} onClick={() => api(`/api/catalog/${t.id}`, { method: 'DELETE' }).then(loadMine)}>✕</button>}
            </span>
          </div>
        ))}
      </Section>

      <Section title="Custom materials" right={<button className="btn btn-sm" onClick={create}>+ New</button>}>
        {doc.customMaterials.length === 0 && <p className="text-xs text-mute">None yet. Duplicate a sample below or create a new one.</p>}
        <ul className="space-y-1">
          {doc.customMaterials.map((m) => (
            <li key={m.id} className={`flex items-center gap-2 rounded-md border px-2 py-1 text-xs ${editId === m.id ? 'border-gold bg-gold-soft/20' : 'border-sand'}`}>
              <Swatch m={m} />
              <button className="min-w-0 flex-1 truncate text-left" onClick={() => setEditId(m.id)}>{m.name}</button>
              <button className="text-mute hover:text-ink" title="Duplicate" onClick={() => duplicate(m)}>⧉</button>
              <button className="text-danger" title="Delete" onClick={() => setDel(m)}>✕</button>
            </li>
          ))}
        </ul>
        {editing && <MaterialEditor m={editing} onChange={upsert} onSave={() => saveToCatalog(editing)} onClose={() => setEditId(null)} />}
      </Section>

      <Section title="My material catalog" defaultOpen={false}>
        {mats.length === 0 && <p className="text-xs text-mute">Save custom materials to reuse them across projects.</p>}
        {mats.map((r) => {
          const m = r.data.material as MaterialDef;
          return (
            <div key={r.id} className="flex items-center gap-2 rounded-md border border-sand px-2 py-1 text-xs">
              {m && <Swatch m={m} />}
              <span className="min-w-0 flex-1 truncate">{r.name}{r.shared ? ' · shared' : ''}</span>
              <button className="btn btn-sm" onClick={() => addFromCatalog(r)}>Add</button>
              {r.mine && <button className="text-danger" aria-label={`Delete ${r.name}`} onClick={() => api(`/api/catalog/${r.id}`, { method: 'DELETE' }).then(loadMine)}>✕</button>}
            </div>
          );
        })}
      </Section>

      <Section title={`Sample library (${SAMPLE_MATERIALS.length})`} defaultOpen={false}>
        <p className="text-[11px] text-mute">Sample materials are illustrative and not manufacturer-verified. Duplicate one to customise it.</p>
        <ul className="grid grid-cols-2 gap-1">
          {all.filter((m) => m.source === 'sample').map((m) => (
            <li key={m.id}>
              <button className="flex w-full items-center gap-1.5 rounded border border-sand px-1.5 py-1 text-left text-[11px] hover:border-gold" onClick={() => duplicate(m)} title="Duplicate into a custom material">
                <Swatch m={m} size={18} /><span className="truncate">{m.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Hardware library" defaultOpen={false} right={<button className="text-xs underline" onClick={() => setShowHw(true)}>View</button>}>
        <p className="text-xs text-mute">{SAMPLE_HARDWARE.length} sample hardware items (handles, hinges, runners, sliding systems, legs, LED, supports). Choose them in a component&apos;s Hardware settings.</p>
      </Section>
      {showHw && (
        <Dialog title="Hardware library" onClose={() => setShowHw(false)} wide>
          <p className="mb-2 text-xs text-mute">All entries are <b>sample</b> items - not manufacturer-verified products.</p>
          <table className="w-full text-xs">
            <thead><tr className="text-left text-mute"><th className="py-1">Code</th><th>Item</th><th>Spec</th><th>Unit</th><th>Status</th></tr></thead>
            <tbody>
              {SAMPLE_HARDWARE.map((h) => (
                <tr key={h.code} className="border-t border-sand"><td className="py-1 font-mono">{h.code}</td><td>{h.name}</td><td>{h.spec}</td><td>{h.unit}</td><td><span className="chip">sample</span></td></tr>
              ))}
            </tbody>
          </table>
        </Dialog>
      )}
      {del && <Confirm title="Delete material?" message={<>Delete “{del.name}” from this project? It cannot be deleted while a component uses it.</>} onCancel={() => setDel(null)} onConfirm={() => { remove(del.id); setDel(null); setEditId(null); }} />}
    </div>
  );
}

export function MaterialEditor({ m, onChange, onSave, onClose, saveLabel = 'Save to catalog', notify }: { m: MaterialDef; onChange: (m: MaterialDef) => void; onSave: () => void; onClose: () => void; saveLabel?: string; notify?: (level: 'success' | 'error', text: string) => void }) {
  const tell = notify ?? ((l: 'success' | 'error', t: string) => useEditor.getState().toast(l, t));
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const up = (p: Partial<MaterialDef>) => onChange({ ...m, ...p });
  async function upload(f: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const r = await api<{ asset: { url: string } }>('/api/assets', { method: 'POST', body: fd });
      onChange({ ...m, texture: 'image', textureUrl: r.asset.url });
      tell('success', 'Texture uploaded.');
    } catch (e) {
      tell('error', (e as Error).message);
    }
    setBusy(false);
  }
  return (
    <div className="space-y-2.5 rounded-md border border-gold/60 bg-gold-soft/10 p-2.5">
      <input className="input !py-1 font-medium" value={m.name} maxLength={120} aria-label="Material name" onChange={(e) => up({ name: e.target.value })} />
      <div className="grid grid-cols-[auto_1fr] items-center gap-2 text-xs">
        Colour <input type="color" value={m.color} onChange={(e) => up({ color: e.target.value })} className="h-7 w-full cursor-pointer rounded border border-sand" />
      </div>
      <Select label="Surface pattern" value={m.texture} onChange={(v) => up({ texture: v })} options={TEX_OPTIONS} />
      <Row cols={2}>
        <NumField label="Roughness" length={false} suffix="" value={m.roughness} min={0} max={1} step={0.05} onCommit={(v) => up({ roughness: v })} />
        <NumField label="Metallic" length={false} suffix="" value={m.metalness} min={0} max={1} step={0.05} onCommit={(v) => up({ metalness: v })} />
        <NumField label="Texture scale" length={false} suffix="×" value={m.textureScale} min={0.1} max={20} step={0.1} onCommit={(v) => up({ textureScale: v })} />
        <NumField label="Opacity" length={false} suffix="" value={m.opacity ?? 1} min={0.05} max={1} step={0.05} onCommit={(v) => up({ opacity: v === 1 ? undefined : v })} />
      </Row>
      <NumField label="Indicative rate per m² (optional)" length={false} suffix="/m²" value={m.rate?.price ?? 0} min={0} onCommit={(v) => up({ rate: v > 0 ? { unit: 'm2', price: v } : undefined })} />
      <div className="flex items-center gap-1.5">
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
        <button className="btn btn-sm" onClick={() => file.current?.click()} disabled={busy}>{busy ? 'Uploading…' : 'Upload image texture'}</button>
        <button className="btn btn-sm" onClick={onSave}>{saveLabel}</button>
        <button className="btn btn-sm btn-ghost ml-auto" onClick={onClose}>Done</button>
      </div>
      <p className="text-[10px] text-mute">Images: PNG, JPG or WEBP up to 8 MB; verified on upload.</p>
    </div>
  );
}
