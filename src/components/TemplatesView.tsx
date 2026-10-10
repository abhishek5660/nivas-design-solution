'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { starterDoc, type KitchenLayout } from '@/lib/scene';
import type { Category } from '@/lib/types';
import { api, CATEGORY_LABEL, Confirm, EmptyState, Spinner } from './ui';

interface Row { id: string; name: string; category: string; data: { doc?: unknown; category?: Category; summary?: string }; mine: boolean; shared: boolean }

const BUILT_IN: { key: string; name: string; category: Category; blurb: string; make: () => unknown }[] = [
  { key: 'wd', name: 'Hinged wardrobe 2400', category: 'WARDROBE', blurb: 'Four-section hinged wardrobe with hanging, shelves and drawers.', make: () => starterDoc('WARDROBE') },
  { key: 'wd-wide', name: 'Wide wardrobe 3600', category: 'WARDROBE', blurb: 'Large wall-to-wall wardrobe with a wide room.', make: () => starterDoc('WARDROBE', { roomWidth: 4200, width: 3600 }) },
  ...(['straight', 'l_shape', 'u_shape', 'parallel', 'island'] as KitchenLayout[]).map((l) => ({ key: `k-${l}`, name: `Kitchen - ${l.replace('_', '-')}`, category: 'KITCHEN' as Category, blurb: 'Generated cabinets, appliances and worktops sized to the room.', make: () => starterDoc('KITCHEN', { layout: l, roomWidth: l === 'parallel' ? 3600 : 4200, roomDepth: l === 'parallel' ? 3000 : l === 'island' ? 4200 : 3400 }) })),
  { key: 'tv', name: 'Fluted TV wall with side towers', category: 'TV_PANEL', blurb: 'Full-wall fluted panel, floating drawer unit, niche + closed towers, LED lighting.', make: () => starterDoc('TV_PANEL') },
];

export function TemplatesView({ canCreate }: { canCreate: boolean }) {
  const router = useRouter();
  const [mine, setMine] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [del, setDel] = useState<Row | null>(null);
  const load = () => api<{ items: Row[] }>('/api/catalog?kind=TEMPLATE').then((r) => setMine(r.items)).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  async function use(key: string, name: string, category: string, doc: unknown) {
    setBusy(key);
    setErr(null);
    try {
      const { project } = await api<{ project: { id: string } }>('/api/projects', { method: 'POST', body: JSON.stringify({ name: `${name} (new)`, category, doc }) });
      router.push(`/projects/${project.id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <div className="space-y-8">
      {err && <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}
      <section>
        <h2 className="mb-3 font-display text-2xl font-semibold">Starter templates</h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {BUILT_IN.map((t) => (
            <li key={t.key} className="card flex flex-col p-4">
              <span className="chip mb-2 self-start">{CATEGORY_LABEL[t.category]}</span>
              <div className="font-display text-lg font-semibold">{t.name}</div>
              <p className="mt-1 flex-1 text-xs text-mute">{t.blurb}</p>
              <button className="btn btn-sm mt-3 self-start" disabled={!canCreate || busy === t.key} onClick={() => use(t.key, t.name, t.category, t.make())}>{busy === t.key ? 'Creating…' : 'Use template'}</button>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="mb-3 font-display text-2xl font-semibold">My templates</h2>
        {mine === null ? <Spinner /> : mine.length === 0 ? (
          <EmptyState title="No saved templates" hint="Open a project, go to History, and choose “Save design as template”. Whole designs - dimensions, materials and configuration - become reusable here." />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {mine.map((t) => (
              <li key={t.id} className="card flex flex-col p-4">
                <span className="chip mb-2 self-start">{CATEGORY_LABEL[t.category] ?? t.category}{t.shared ? ' · shared' : ''}</span>
                <div className="font-display text-lg font-semibold">{t.name}</div>
                <p className="mt-1 flex-1 text-xs text-mute">{t.data.summary}</p>
                <div className="mt-3 flex gap-2">
                  <button className="btn btn-sm" disabled={!canCreate || busy === t.id} onClick={() => use(t.id, t.name, t.category, t.data.doc)}>{busy === t.id ? 'Creating…' : 'Use template'}</button>
                  {t.mine && <button className="btn btn-sm btn-danger" onClick={() => setDel(t)}>Delete</button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {del && <Confirm title="Delete template?" message={<>“{del.name}” will be removed. Projects created from it are not affected.</>} onCancel={() => setDel(null)} onConfirm={async () => { await api(`/api/catalog/${del.id}`, { method: 'DELETE' }); setDel(null); load(); }} />}
    </div>
  );
}
