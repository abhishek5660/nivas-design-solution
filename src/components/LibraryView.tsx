'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { addNodeToDoc, defaultDoc, makeNode, roomBounds } from '@/lib/scene';
import { uid } from '@/lib/build/wardrobe';
import type { Category, SceneNode } from '@/lib/types';
import { LIBRARY } from './editor/LeftPanel';
import { api, CATEGORY_LABEL, Confirm, EmptyState, Spinner } from './ui';

const CAT: Record<string, Category> = { wardrobe: 'WARDROBE', cabinet: 'KITCHEN', countertop: 'KITCHEN', appliance: 'KITCHEN', tv_panel: 'TV_PANEL', box: 'CUSTOM', group: 'CUSTOM' };

interface Row { id: string; name: string; category: string; data: { node?: SceneNode }; mine: boolean }

export function LibraryView({ canCreate }: { canCreate: boolean }) {
  const router = useRouter();
  const [mine, setMine] = useState<Row[] | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [del, setDel] = useState<Row | null>(null);

  const load = () => api<{ items: Row[] }>('/api/catalog?kind=COMPONENT').then((r) => setMine(r.items)).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  async function start(key: string, name: string, node: SceneNode) {
    setBusy(key);
    setErr(null);
    try {
      const category = CAT[node.type] ?? 'CUSTOM';
      let doc = defaultDoc(category);
      const b = roomBounds(doc.room);
      node.position = [(b.minX + b.maxX) / 2, node.position[1], b.minZ + node.size.d / 2];
      doc = addNodeToDoc(doc, node);
      const { project } = await api<{ project: { id: string } }>('/api/projects', { method: 'POST', body: JSON.stringify({ name: `${name} project`, category, doc }) });
      router.push(`/projects/${project.id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(null);
    }
  }

  const groups = Array.from(new Set(LIBRARY.map((l) => l.group)));
  return (
    <div className="space-y-8">
      <input className="input max-w-sm" placeholder="Search the library" aria-label="Search the library" value={q} onChange={(e) => setQ(e.target.value)} />
      {err && <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}
      {groups.map((g) => {
        const items = LIBRARY.filter((l) => l.group === g && l.label.toLowerCase().includes(q.toLowerCase()));
        if (!items.length) return null;
        return (
          <section key={g}>
            <h2 className="mb-3 font-display text-2xl font-semibold">{g}</h2>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {items.map((it) => {
                const n = makeNode(it.type, { variant: it.variant, kind: it.kind, params: it.params, size: it.size });
                return (
                  <li key={it.id} className="card flex flex-col p-4">
                    <div className="font-display text-lg font-semibold leading-tight">{it.label}</div>
                    <div className="mt-1 text-xs text-mute">Default {Math.round(n.size.w)} × {Math.round(n.size.h)} × {Math.round(n.size.d)} mm · fully parametric</div>
                    <button className="btn btn-sm mt-3 self-start" disabled={!canCreate || busy === it.id} onClick={() => start(it.id, it.label, makeNode(it.type, { variant: it.variant, kind: it.kind, params: it.params, size: it.size }))}>
                      {busy === it.id ? 'Creating…' : 'Start a project with this'}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      <section>
        <h2 className="mb-3 font-display text-2xl font-semibold">My saved components</h2>
        {mine === null ? <Spinner /> : mine.length === 0 ? (
          <EmptyState title="No saved components yet" hint="In the workspace, select a wardrobe, cabinet or TV panel and choose “Save to my component library”. It appears here and in the workspace Library tab." />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {mine.filter((m) => m.name.toLowerCase().includes(q.toLowerCase())).map((m) => (
              <li key={m.id} className="card p-4">
                <div className="font-display text-lg font-semibold">{m.name}</div>
                <div className="text-xs text-mute">{m.data.node ? `${Math.round(m.data.node.size.w)} × ${Math.round(m.data.node.size.h)} × ${Math.round(m.data.node.size.d)} mm · ${CATEGORY_LABEL[CAT[m.data.node.type] ?? 'CUSTOM']}` : ''}</div>
                <div className="mt-3 flex gap-2">
                  <button className="btn btn-sm" disabled={!canCreate || busy === m.id || !m.data.node} onClick={() => m.data.node && start(m.id, m.name, { ...structuredClone(m.data.node), id: uid('n'), parentId: null, position: [0, m.data.node.position?.[1] ?? 0, 0] })}>Start a project</button>
                  {m.mine && <button className="btn btn-sm btn-danger" onClick={() => setDel(m)}>Delete</button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {del && <Confirm title="Delete saved component?" message={<>“{del.name}” will be removed from your library. Projects that already use it are not affected.</>} onCancel={() => setDel(null)} onConfirm={async () => { await api(`/api/catalog/${del.id}`, { method: 'DELETE' }); setDel(null); load(); }} />}
    </div>
  );
}
