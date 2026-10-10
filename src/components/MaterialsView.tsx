'use client';
import { useEffect, useMemo, useState } from 'react';
import { MATERIAL_CATEGORIES, SAMPLE_HARDWARE, SAMPLE_MATERIALS } from '@/lib/catalog';
import type { MaterialDef } from '@/lib/types';
import { MaterialEditor } from './editor/RightPanel';
import { Swatch } from './editor/MaterialPicker';
import { uid } from '@/lib/build/wardrobe';
import { api, Confirm, EmptyState, Spinner } from './ui';

interface Row { id: string; kind: string; name: string; category: string; data: Record<string, unknown>; mine: boolean; shared: boolean; verified: boolean; owner: string }

export function MaterialsView({ canCreate, isAdmin }: { canCreate: boolean; isAdmin: boolean }) {
  const [tab, setTab] = useState<'materials' | 'hardware' | 'mine'>('materials');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [edit, setEdit] = useState<{ row?: Row; m: MaterialDef } | null>(null);
  const [del, setDel] = useState<Row | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => api<{ items: Row[] }>('/api/catalog').then((r) => setRows(r.items.filter((i) => i.kind === 'MATERIAL' || i.kind === 'THEME'))).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);

  const sample = useMemo(() => SAMPLE_MATERIALS.filter((m) => (!cat || m.category === cat) && m.name.toLowerCase().includes(q.toLowerCase())), [q, cat]);
  const hw = SAMPLE_HARDWARE.filter((h) => (h.name + h.code + h.spec).toLowerCase().includes(q.toLowerCase()));

  const newMaterial = (from?: MaterialDef) =>
    setEdit({ m: { ...(from ?? { color: '#c9a37a', roughness: 0.6, metalness: 0, texture: 'none' as const, textureScale: 1, category: 'Custom' }), id: `cm_${uid('m')}`, name: from ? `${from.name} (custom)` : 'New material', source: 'custom', verified: false, category: from?.category ?? 'Custom', textureScale: from?.textureScale ?? 1, color: from?.color ?? '#c9a37a', roughness: from?.roughness ?? 0.6, metalness: from?.metalness ?? 0, texture: from?.texture ?? 'none' } });

  async function save() {
    if (!edit) return;
    try {
      if (edit.row) await api(`/api/catalog/${edit.row.id}`, { method: 'PATCH', body: JSON.stringify({ name: edit.m.name, category: edit.m.category, data: { material: edit.m } }) });
      else await api('/api/catalog', { method: 'POST', body: JSON.stringify({ kind: 'MATERIAL', name: edit.m.name, category: edit.m.category, data: { material: edit.m } }) });
      setEdit(null);
      setMsg('Saved to your catalog. It can be added to any project from the workspace Materials tab.');
      load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function adminFlag(r: Row, patch: { shared?: boolean; verified?: boolean }) {
    try {
      await api(`/api/catalog/${r.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  const mats = rows?.filter((r) => r.kind === 'MATERIAL') ?? [];
  const themes = rows?.filter((r) => r.kind === 'THEME') ?? [];
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-sand bg-paper p-0.5" role="tablist">
          {([['materials', 'Sample materials'], ['hardware', 'Hardware'], ['mine', 'My catalog']] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === k ? 'bg-ink text-gold-soft' : 'text-graphite hover:bg-linen'}`}>{l}</button>
          ))}
        </div>
        <input className="input max-w-xs" placeholder="Search" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        {tab === 'materials' && (
          <select className="input w-auto" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
            <option value="">All categories</option>
            {MATERIAL_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        )}
        {tab === 'mine' && canCreate && <button className="btn btn-gold ml-auto" onClick={() => newMaterial()}>+ New material</button>}
      </div>
      {msg && <p role="status" className="mb-4 flex justify-between rounded-md border border-sand bg-paper px-3 py-2 text-sm">{msg}<button onClick={() => setMsg(null)} aria-label="Dismiss">✕</button></p>}
      <p className="mb-4 rounded-md border border-sand bg-linen/60 px-3 py-2 text-xs text-graphite">Sample materials and hardware are <b>illustrative</b> and are <b>not manufacturer-verified</b>. Entries marked “verified” in your catalog are confirmed by an administrator.</p>

      {tab === 'materials' && (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {sample.map((m) => (
            <li key={m.id} className="card flex items-center gap-3 p-3">
              <Swatch m={m} size={46} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{m.name}</div>
                <div className="text-[11px] text-mute">{m.category} · rough {m.roughness}{m.metalness ? ` · metal ${m.metalness}` : ''}</div>
                <span className="chip mt-1">sample</span>
              </div>
              {canCreate && <button className="btn btn-sm" onClick={() => { newMaterial(m); setTab('mine'); }} title="Customise a copy">Copy</button>}
            </li>
          ))}
        </ul>
      )}

      {tab === 'hardware' && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-linen text-left text-xs uppercase tracking-wider text-mute"><tr><th className="px-3 py-2">Code</th><th>Item</th><th>Category</th><th>Specification</th><th>Unit</th><th>Status</th></tr></thead>
            <tbody>
              {hw.map((h) => (
                <tr key={h.code} className="border-t border-sand"><td className="px-3 py-1.5 font-mono text-xs">{h.code}</td><td>{h.name}</td><td className="capitalize">{h.category}</td><td className="text-mute">{h.spec}</td><td>{h.unit}</td><td><span className="chip">sample</span></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'mine' && (
        <>
          {edit && (
            <div className="card mb-5 max-w-md p-4">
              <MaterialEditor m={edit.m} onChange={(m) => setEdit({ ...edit, m })} onSave={save} onClose={() => setEdit(null)} saveLabel="Save" notify={(l, t) => setMsg(l === 'error' ? t : t)} />
            </div>
          )}
          {rows === null ? <Spinner /> : mats.length === 0 && themes.length === 0 ? (
            <EmptyState title="Your catalog is empty" hint="Create a material here, or save one from the workspace. Custom materials and themes you save stay available in every project." />
          ) : (
            <>
              <h2 className="mb-2 font-display text-2xl font-semibold">Materials</h2>
              <ul className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {mats.map((r) => {
                  const m = r.data.material as MaterialDef;
                  return (
                    <li key={r.id} className="card flex items-center gap-3 p-3">
                      {m && <Swatch m={m} size={46} />}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{r.name}</div>
                        <div className="text-[11px] text-mute">{r.owner}{r.shared ? ' · shared with everyone' : ''}</div>
                        <div className="mt-1 flex gap-1">{r.verified ? <span className="chip !bg-emerald-100 !text-emerald-800">verified</span> : <span className="chip">unverified</span>}</div>
                      </div>
                      <div className="flex flex-col gap-1">
                        {r.mine && <button className="btn btn-sm" onClick={() => setEdit({ row: r, m })}>Edit</button>}
                        {r.mine && <button className="btn btn-sm btn-danger" onClick={() => setDel(r)}>Delete</button>}
                        {isAdmin && <button className="btn btn-sm" onClick={() => adminFlag(r, { shared: !r.shared })}>{r.shared ? 'Unshare' : 'Share'}</button>}
                        {isAdmin && <button className="btn btn-sm" onClick={() => adminFlag(r, { verified: !r.verified })}>{r.verified ? 'Unverify' : 'Verify'}</button>}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {themes.length > 0 && (
                <>
                  <h2 className="mb-2 font-display text-2xl font-semibold">Themes</h2>
                  <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {themes.map((r) => (
                      <li key={r.id} className="card p-3"><div className="font-semibold">{r.name}</div><div className="text-xs text-mute">{Object.keys((r.data.defaults as object) ?? {}).length} finishes</div>{r.mine && <button className="btn btn-sm btn-danger mt-2" onClick={() => setDel(r)}>Delete</button>}</li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </>
      )}
      {del && <Confirm title="Delete from catalog?" message={<>“{del.name}” will be removed from your catalog. Projects already using it keep their copy.</>} onCancel={() => setDel(null)} onConfirm={async () => { await api(`/api/catalog/${del.id}`, { method: 'DELETE' }); setDel(null); load(); }} />}
    </div>
  );
}
