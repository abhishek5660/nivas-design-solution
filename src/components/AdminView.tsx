'use client';
import { useEffect, useState } from 'react';
import { ILLUSTRATIVE_RATES, SAMPLE_HARDWARE, SAMPLE_MATERIALS } from '@/lib/catalog';
import { api, CATEGORY_LABEL, Spinner, STATUS_LABEL, timeAgo } from './ui';
import { NumField } from './editor/fields';

type Tab = 'users' | 'projects' | 'rates' | 'catalog' | 'app';

interface U { id: string; name: string; email: string; role: string; active: boolean; createdAt: string; _count: { projects: number } }
interface P { id: string; name: string; category: string; status: string; customer: string; updatedAt: string; version: number; owner: { name: string } }
interface C { id: string; kind: string; name: string; category: string; shared: boolean; verified: boolean; owner: string; mine: boolean }

export function AdminView({ meId }: { meId: string }) {
  const [tab, setTab] = useState<Tab>('users');
  return (
    <div>
      <div className="mb-5 flex rounded-lg border border-sand bg-paper p-0.5 sm:inline-flex" role="tablist">
        {([['users', 'Users & roles'], ['projects', 'Projects & status'], ['rates', 'Pricing rules'], ['catalog', 'Catalogs & templates'], ['app', 'Application']] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`rounded-md px-3.5 py-1.5 text-sm font-medium ${tab === k ? 'bg-ink text-gold-soft' : 'text-graphite hover:bg-linen'}`}>{l}</button>
        ))}
      </div>
      {tab === 'users' && <Users meId={meId} />}
      {tab === 'projects' && <Projects />}
      {tab === 'rates' && <Rates />}
      {tab === 'catalog' && <Catalog />}
      {tab === 'app' && <AppSettings />}
    </div>
  );
}

function Users({ meId }: { meId: string }) {
  const [users, setUsers] = useState<U[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => api<{ users: U[] }>('/api/admin/users').then((r) => setUsers(r.users)).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  async function patch(id: string, p: { role?: string; active?: boolean }) {
    setErr(null);
    try {
      await api(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(p) });
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  if (!users) return <Spinner />;
  return (
    <div className="space-y-3">
      {err && <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-linen text-left text-xs uppercase tracking-wider text-mute"><tr><th className="px-3 py-2">User</th><th>Email</th><th>Role</th><th>Projects</th><th>Joined</th><th>Active</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-sand">
                <td className="px-3 py-2 font-medium">{u.name}{u.id === meId ? ' (you)' : ''}</td><td className="text-mute">{u.email}</td>
                <td><select className="input !w-auto !py-1" value={u.role} disabled={u.id === meId} aria-label={`Role for ${u.name}`} onChange={(e) => patch(u.id, { role: e.target.value })}><option value="ADMIN">Administrator</option><option value="DESIGNER">Designer</option><option value="VIEWER">Viewer</option></select></td>
                <td>{u._count.projects}</td><td className="text-mute">{new Date(u.createdAt).toLocaleDateString()}</td>
                <td><input type="checkbox" checked={u.active} disabled={u.id === meId} aria-label={`${u.name} active`} onChange={(e) => patch(u.id, { active: e.target.checked })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-mute"><b>Administrator</b>: everything, including users, rate card and shared catalog. <b>Designer</b>: create and edit own/shared projects and libraries. <b>Viewer</b>: read-only access to projects shared with them. Permissions are enforced on the server for every API call.</p>
    </div>
  );
}

function Projects() {
  const [rows, setRows] = useState<P[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => api<{ projects: P[] }>('/api/projects?all=1').then((r) => setRows(r.projects)).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  async function status(id: string, s: string) {
    try {
      await api(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ status: s }) });
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  if (!rows) return <Spinner />;
  return (
    <div className="card overflow-x-auto">
      {err && <p role="alert" className="m-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}
      <table className="w-full text-sm">
        <thead className="bg-linen text-left text-xs uppercase tracking-wider text-mute"><tr><th className="px-3 py-2">Project</th><th>Category</th><th>Owner</th><th>Customer</th><th>Status</th><th>Updated</th></tr></thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className="border-t border-sand">
              <td className="px-3 py-2"><a className="font-medium text-wood hover:underline" href={`/projects/${p.id}`}>{p.name}</a> <span className="text-xs text-mute">v{p.version}</span></td>
              <td>{CATEGORY_LABEL[p.category]}</td><td>{p.owner.name}</td><td className="text-mute">{p.customer || '-'}</td>
              <td><select className="input !w-auto !py-1" value={p.status} aria-label={`Status of ${p.name}`} onChange={(e) => status(p.id, e.target.value)}>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
              <td className="text-mute">{timeAgo(p.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="p-6 text-center text-sm text-mute">No projects.</p>}
    </div>
  );
}

function Rates() {
  const [custom, setCustom] = useState<Record<string, number> | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [newKey, setNewKey] = useState('');
  useEffect(() => { api<{ custom: Record<string, number> }>('/api/settings/rates').then((r) => setCustom(r.custom)); }, []);
  if (!custom) return <Spinner />;
  const keys = Array.from(new Set([...Object.keys(ILLUSTRATIVE_RATES), ...Object.keys(custom)])).sort();
  const label = (k: string) => (k.startsWith('mat:') ? SAMPLE_MATERIALS.find((m) => m.id === k.slice(4))?.name : k.startsWith('hw:') ? SAMPLE_HARDWARE.find((h) => h.code === k.slice(3))?.name : k.startsWith('app:') ? k.slice(4) : '') ?? '';
  async function save(next: Record<string, number>) {
    try {
      const r = await api<{ custom: Record<string, number> }>('/api/settings/rates', { method: 'PUT', body: JSON.stringify({ custom: next }) });
      setCustom(r.custom);
      setMsg('Rate card saved. New quotations use these rates.');
    } catch (e) {
      setMsg((e as Error).message);
    }
  }
  return (
    <div className="space-y-3">
      <p className="rounded-md border border-warn/40 bg-warn/5 px-3 py-2 text-sm text-warn">Rates not set here fall back to <b>illustrative placeholder values</b> - they are not supplier prices. Enter your real supplier rates: sheet goods per m², hardware per unit (or per metre), appliances per unit.</p>
      {msg && <p role="status" className="rounded-md border border-sand bg-paper px-3 py-2 text-sm">{msg}</p>}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-linen text-left text-xs uppercase tracking-wider text-mute"><tr><th className="px-3 py-2">Key</th><th>Item</th><th className="w-40 text-right">Your rate</th><th className="text-right">Starter value</th><th /></tr></thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k} className="border-t border-sand">
                <td className="px-3 py-1.5 font-mono text-xs">{k}</td><td>{label(k)}</td>
                <td className="text-right"><div className="ml-auto w-32"><NumField compact length={false} suffix="" value={custom[k] ?? ILLUSTRATIVE_RATES[k] ?? 0} min={0} onCommit={(v) => { save({ ...custom, [k]: v }); }} /></div></td>
                <td className="text-right text-xs text-mute">{ILLUSTRATIVE_RATES[k] ?? '-'}{k in custom ? <span className="ml-1 chip !bg-gold-soft/60">custom</span> : null}</td>
                <td className="px-2">{k in custom && <button className="text-xs underline" onClick={() => { const n = { ...custom }; delete n[k]; save(n); }}>reset</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex max-w-lg gap-2">
        <input className="input" placeholder="New key, e.g. app:fridge or mat:my-board" value={newKey} onChange={(e) => setNewKey(e.target.value)} aria-label="New rate key" />
        <button className="btn" disabled={!/^(mat|hw|app):[A-Za-z0-9_.-]+$/.test(newKey) || newKey in custom} onClick={() => { save({ ...custom, [newKey]: 0 }); setNewKey(''); }}>Add rate</button>
      </div>
      <p className="text-xs text-mute">Appliance keys: app:fridge, app:oven, app:microwave, app:hob, app:chimney, app:dishwasher, app:sink.</p>
    </div>
  );
}

function Catalog() {
  const [rows, setRows] = useState<C[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => api<{ items: C[] }>('/api/catalog').then((r) => setRows(r.items)).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  async function flag(id: string, p: { shared?: boolean; verified?: boolean }) {
    try {
      await api(`/api/catalog/${id}`, { method: 'PATCH', body: JSON.stringify(p) });
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  if (!rows) return <Spinner />;
  return (
    <div className="space-y-3">
      {err && <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}
      <p className="text-sm text-mute">Share catalog entries with everyone, and mark materials as <b>manufacturer-verified</b> only after checking them against the manufacturer&apos;s data.</p>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-linen text-left text-xs uppercase tracking-wider text-mute"><tr><th className="px-3 py-2">Item</th><th>Kind</th><th>Owner</th><th>Shared</th><th>Verified</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-sand">
                <td className="px-3 py-2 font-medium">{r.name}</td><td className="capitalize">{r.kind.toLowerCase()}</td><td className="text-mute">{r.owner}</td>
                <td><input type="checkbox" checked={r.shared} aria-label={`${r.name} shared`} onChange={(e) => flag(r.id, { shared: e.target.checked })} /></td>
                <td><input type="checkbox" checked={r.verified} disabled={r.kind !== 'MATERIAL'} aria-label={`${r.name} verified`} onChange={(e) => flag(r.id, { verified: e.target.checked })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-6 text-center text-sm text-mute">No catalog items yet.</p>}
      </div>
    </div>
  );
}

function AppSettings() {
  const [st, setSt] = useState<{ allowRegistration: boolean; stats: { users: number; projects: number; assets: number } } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<typeof st>('/api/settings/app').then(setSt).catch((e) => setErr(e.message)); }, []);
  if (err) return <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>;
  if (!st) return <Spinner />;
  return (
    <div className="max-w-xl space-y-4">
      <div className="grid grid-cols-3 gap-3 text-center">
        {([['Users', st.stats.users], ['Projects', st.stats.projects], ['Uploaded assets', st.stats.assets]] as const).map(([k, v]) => (
          <div key={k} className="card p-3"><div className="font-display text-3xl font-semibold">{v}</div><div className="text-xs text-mute">{k}</div></div>
        ))}
      </div>
      <label className="card flex items-center justify-between gap-4 p-4">
        <span><b className="block text-sm">Open registration</b><span className="text-xs text-mute">When off, only administrators can add people (new sign-ups are refused). The very first account is always allowed.</span></span>
        <input type="checkbox" className="h-5 w-5" checked={st.allowRegistration} onChange={async (e) => { try { setSt(await api(`/api/settings/app`, { method: 'PUT', body: JSON.stringify({ allowRegistration: e.target.checked }) })); } catch (x) { setErr((x as Error).message); } }} />
      </label>
      <p className="text-xs text-mute">Secrets (database URL, session secret) are environment variables on the server - they are never stored in the app or sent to the browser. See the README.</p>
    </div>
  );
}
