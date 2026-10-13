'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { parseProjectImport } from '@/lib/schema';
import { api, CATEGORY_LABEL, Confirm, Dialog, EmptyState, Spinner, STATUS_COLOR, STATUS_LABEL, timeAgo } from './ui';

export interface ProjectRow {
  id: string;
  name: string;
  category: string;
  status: string;
  customer: string;
  roomNotes: string;
  thumbnail: string | null;
  version: number;
  updatedAt: string;
  createdAt: string;
  ownerId: string;
  owner: { name: string };
}

const CATS = ['WARDROBE', 'KITCHEN', 'TV_PANEL', 'CUSTOM', 'FLOORPLAN'] as const;
const CAT_NAME: Record<string, string> = { ...CATEGORY_LABEL, FLOORPLAN: 'Floor plan (2D / 3D)' };

function Placeholder({ category }: { category: string }) {
  const paths: Record<string, string> = {
    WARDROBE: 'M30 20h100v110H30zM80 20v110M64 70v14M96 70v14',
    KITCHEN: 'M20 130V70h120v60M20 70V30h120v40M50 95h28M90 95h28',
    TV_PANEL: 'M20 30h120v70H20zM60 130h40M80 100v30M35 112h30',
    CUSTOM: 'M25 70h110v26H25zM35 96v36M125 96v36M40 70V40h80v30',
  };
  return (
    <div className="grid h-full place-items-center bg-gradient-to-br from-linen to-sand">
      <svg width="130" height="104" viewBox="0 0 160 160" fill="none" stroke="#a9794a" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round">
        <path d={paths[category] ?? paths.CUSTOM} />
      </svg>
    </div>
  );
}

export function NewProjectDialog({ defaultCategory, onClose }: { defaultCategory?: string; onClose: () => void }) {
  const router = useRouter();
  const [category, setCategory] = useState<string>(defaultCategory ?? 'WARDROBE');
  const [name, setName] = useState('');
  const [customer, setCustomer] = useState('');
  const [layout, setLayout] = useState('l_shape');
  const [rw, setRw] = useState(3600);
  const [rd, setRd] = useState(3200);
  const [rh, setRh] = useState(2700);
  const [empty, setEmpty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!name.trim()) return setError('Give the project a name.');
    setBusy(true);
    setError(null);
    try {
      const { project } = await api<{ project: { id: string } }>('/api/projects', {
        method: 'POST',
        body: JSON.stringify(category === 'FLOORPLAN' ? { name, category: 'CUSTOM', customer, floorPlan: true } : { name, category, customer, roomWidth: rw, roomDepth: rd, roomHeight: rh, layout: category === 'KITCHEN' ? layout : undefined, empty }),
      });
      router.push(`/projects/${project.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="New project"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={create} disabled={busy}>{busy ? 'Creating…' : 'Create & open'}</button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <span className="label">Category</span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {CATS.map((c) => (
              <button key={c} type="button" onClick={() => setCategory(c)} aria-pressed={category === c} className={`rounded-lg border p-2.5 text-left text-sm transition ${category === c ? 'border-gold bg-gold-soft/30 ring-1 ring-gold' : 'border-sand hover:bg-linen'}`}>
                <div className="font-medium">{CAT_NAME[c]}</div>
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="pn">Project name</label>
            <input id="pn" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sharma residence – master wardrobe" maxLength={160} />
          </div>
          <div>
            <label className="label" htmlFor="pc">Customer</label>
            <input id="pc" className="input" value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Customer name" maxLength={200} />
          </div>
        </div>
        {category === 'FLOORPLAN' && <p className="rounded-md bg-linen/70 px-3 py-2 text-sm text-graphite">Starts with an empty floor plan: draw walls, add doors and windows, place furniture and cabinets, and switch between the 2D plan and the 3D model. You can add floors and buildings later.</p>}
        {category !== 'FLOORPLAN' && <div>
          <span className="label">Room size (mm)</span>
          <div className="grid grid-cols-3 gap-2">
            {[
              ['Width', rw, setRw],
              ['Depth', rd, setRd],
              ['Height', rh, setRh],
            ].map(([l, v, set]) => (
              <label key={l as string} className="text-xs text-mute">
                {l as string}
                <input type="number" className="input mt-1" min={1500} max={20000} value={v as number} onChange={(e) => (set as (n: number) => void)(Number(e.target.value))} />
              </label>
            ))}
          </div>
        </div>}
        {category === 'KITCHEN' && (
          <div>
            <label className="label" htmlFor="kl">Kitchen layout</label>
            <select id="kl" className="input" value={layout} onChange={(e) => setLayout(e.target.value)}>
              <option value="straight">Straight (single wall)</option>
              <option value="l_shape">L-shaped</option>
              <option value="u_shape">U-shaped</option>
              <option value="parallel">Parallel (galley)</option>
              <option value="island">Straight with island</option>
            </select>
            <p className="mt-1 text-xs text-mute">Cabinets, appliances and worktops are generated to fit your room and can be edited individually.</p>
          </div>
        )}
        {category !== 'FLOORPLAN' && <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={empty} onChange={(e) => setEmpty(e.target.checked)} /> Start with an empty room
        </label>}
        {error && <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}

export function ProjectsView({ category, linkTab, emptyHint }: { category?: string; linkTab?: string; emptyHint?: string }) {
  const router = useRouter();
  const [rows, setRows] = useState<ProjectRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState(category ?? '');
  const [status, setStatus] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [rename, setRename] = useState<ProjectRow | null>(null);
  const [del, setDel] = useState<ProjectRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams();
      if (q) p.set('q', q);
      if (cat) p.set('category', cat);
      if (status) p.set('status', status);
      const r = await api<{ projects: ProjectRow[] }>(`/api/projects?${p}`);
      setRows(r.projects);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [q, cat, status]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  async function duplicate(p: ProjectRow) {
    setBusy(true);
    try {
      await api(`/api/projects/${p.id}/duplicate`, { method: 'POST' });
      await load();
      setMsg(`Duplicated "${p.name}".`);
    } catch (e) {
      setMsg((e as Error).message);
    }
    setBusy(false);
  }

  async function doRename(name: string) {
    if (!rename) return;
    try {
      await api(`/api/projects/${rename.id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
      setRename(null);
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function doDelete() {
    if (!del) return;
    setBusy(true);
    try {
      await api(`/api/projects/${del.id}`, { method: 'DELETE' });
      setDel(null);
      await load();
    } catch (e) {
      setMsg((e as Error).message);
      setDel(null);
    }
    setBusy(false);
  }

  async function importFile(file: File) {
    const text = await file.text();
    const parsed = parseProjectImport(text);
    if (!parsed.ok) {
      setMsg(`Import failed - nothing was changed. ${parsed.errors.slice(0, 3).join(' ')}`);
      return;
    }
    try {
      const { project } = await api<{ project: { id: string } }>('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ name: `${parsed.value.project.name} (imported)`, category: parsed.value.project.category, customer: parsed.value.project.customer, doc: parsed.value.data }),
      });
      router.push(`/projects/${project.id}`);
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  const href = (p: ProjectRow) => `/projects/${p.id}${linkTab ? `?tab=${linkTab}` : ''}`;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" placeholder="Search projects or customers" aria-label="Search projects" value={q} onChange={(e) => setQ(e.target.value)} />
        {!category && (
          <select className="input w-auto" aria-label="Filter by category" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">All categories</option>
            {CATS.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
        )}
        <select className="input w-auto" aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any status</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div className="ml-auto flex gap-2">
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ''; }} />
          <button className="btn" onClick={() => fileRef.current?.click()}>Import JSON</button>
          <button className="btn btn-gold" onClick={() => setShowNew(true)}>+ New project</button>
        </div>
      </div>
      {msg && (
        <p role="status" className="mb-4 flex items-center justify-between rounded-md border border-sand bg-paper px-3 py-2 text-sm">
          {msg}
          <button className="text-mute hover:text-ink" onClick={() => setMsg(null)} aria-label="Dismiss">✕</button>
        </p>
      )}
      {error && <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      {!rows && !error && <div className="flex justify-center py-20"><Spinner size={28} /></div>}
      {rows && rows.length === 0 && (
        <EmptyState
          title={q || status || cat ? 'No matching projects' : 'No projects yet'}
          hint={emptyHint ?? 'Create a project to start designing in 3D. Your work is saved to the database as you go.'}
          action={<button className="btn btn-gold" onClick={() => setShowNew(true)}>+ New project</button>}
        />
      )}
      {rows && rows.length > 0 && (
        <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((p) => (
            <li key={p.id} className="card group fade-up overflow-hidden transition hover:-translate-y-0.5 hover:shadow-lg">
              <Link href={href(p)} className="block">
                <div className="relative aspect-[16/10] overflow-hidden bg-linen">
                  {p.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.thumbnail} alt={`Preview of ${p.name}`} className="h-full w-full object-cover" />
                  ) : (
                    <Placeholder category={p.category} />
                  )}
                  <span className="chip absolute left-3 top-3 bg-paper/90">{CATEGORY_LABEL[p.category]}</span>
                </div>
              </Link>
              <div className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <Link href={href(p)} className="min-w-0">
                    <h3 className="truncate font-display text-xl font-semibold leading-tight hover:text-wood">{p.name}</h3>
                  </Link>
                  <span className={`chip shrink-0 ${STATUS_COLOR[p.status]}`}>{STATUS_LABEL[p.status]}</span>
                </div>
                <p className="truncate text-xs text-mute">{p.customer ? `Customer: ${p.customer}` : 'No customer set'} · v{p.version}</p>
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-mute">Edited {timeAgo(p.updatedAt)}</span>
                  <div className="flex gap-1 opacity-70 transition group-hover:opacity-100">
                    <button className="btn btn-sm btn-ghost" onClick={() => setRename(p)}>Rename</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => duplicate(p)} disabled={busy}>Duplicate</button>
                    <button className="btn btn-sm btn-ghost text-danger" onClick={() => setDel(p)}>Delete</button>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {showNew && <NewProjectDialog defaultCategory={category || cat || undefined} onClose={() => setShowNew(false)} />}
      {rename && <RenameDialog current={rename.name} onClose={() => setRename(null)} onSave={doRename} />}
      {del && (
        <Confirm
          title="Delete project?"
          message={<>"{del.name}" and all of its saved versions will be permanently deleted. This cannot be undone.</>}
          onConfirm={doDelete}
          onCancel={() => setDel(null)}
          busy={busy}
        />
      )}
    </div>
  );
}

function RenameDialog({ current, onClose, onSave }: { current: string; onClose: () => void; onSave: (n: string) => void }) {
  const [v, setV] = useState(current);
  return (
    <Dialog title="Rename project" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!v.trim()} onClick={() => onSave(v.trim())}>Save</button></>}>
      <input className="input" value={v} maxLength={160} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && v.trim() && onSave(v.trim())} aria-label="Project name" />
    </Dialog>
  );
}
