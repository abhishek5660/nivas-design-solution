'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { usePrefs, type Unit } from '@/store/prefs';
import { api } from './ui';

export function SettingsView({ user }: { user: { name: string; email: string; role: string } }) {
  const router = useRouter();
  const unit = usePrefs((s) => s.unit);
  const setUnit = usePrefs((s) => s.setUnit);
  const [name, setName] = useState(user.name);
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => usePrefs.getState().hydrate(), []);

  async function saveName() {
    try {
      await api('/api/auth/me', { method: 'PATCH', body: JSON.stringify({ name }) });
      setMsg({ ok: true, text: 'Profile updated.' });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }
  async function changePw() {
    try {
      await api('/api/auth/password', { method: 'POST', body: JSON.stringify({ current: cur, next }) });
      setCur('');
      setNext('');
      setMsg({ ok: true, text: 'Password changed.' });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }

  return (
    <div className="grid max-w-3xl gap-5">
      {msg && <p role="status" className={`rounded-md border px-3 py-2 text-sm ${msg.ok ? 'border-ok/40 bg-emerald-50' : 'border-danger/40 bg-danger/5 text-danger'}`}>{msg.text}</p>}
      <section className="card p-5">
        <h2 className="mb-3 font-display text-2xl font-semibold">Profile</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="label">Name</span><input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
          <label className="block"><span className="label">Email</span><input className="input" value={user.email} disabled /></label>
        </div>
        <p className="mt-2 text-xs text-mute">Role: <b>{user.role.toLowerCase()}</b></p>
        <button className="btn btn-primary mt-3" disabled={!name.trim() || name === user.name} onClick={saveName}>Save profile</button>
      </section>
      <section className="card p-5">
        <h2 className="mb-3 font-display text-2xl font-semibold">Display units</h2>
        <p className="mb-3 text-sm text-mute">Designs are always stored in millimetres. This only changes how lengths are shown and typed in the workspace.</p>
        <div className="flex gap-2" role="radiogroup" aria-label="Display units">
          {(['mm', 'cm', 'in'] as Unit[]).map((u) => (
            <button key={u} role="radio" aria-checked={unit === u} onClick={() => setUnit(u)} className={`rounded-md border px-4 py-2 text-sm font-medium ${unit === u ? 'border-gold bg-gold-soft/30' : 'border-sand hover:bg-linen'}`}>{u === 'mm' ? 'Millimetres' : u === 'cm' ? 'Centimetres' : 'Inches'}</button>
          ))}
        </div>
      </section>
      <section className="card p-5">
        <h2 className="mb-3 font-display text-2xl font-semibold">Password</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="label">Current password</span><input type="password" className="input" value={cur} autoComplete="current-password" onChange={(e) => setCur(e.target.value)} /></label>
          <label className="block"><span className="label">New password</span><input type="password" className="input" value={next} autoComplete="new-password" minLength={8} onChange={(e) => setNext(e.target.value)} /></label>
        </div>
        <button className="btn btn-primary mt-3" disabled={!cur || next.length < 8} onClick={changePw}>Change password</button>
      </section>
      <section className="card p-5 text-sm text-graphite">
        <h2 className="mb-2 font-display text-2xl font-semibold">Keyboard shortcuts</h2>
        <ul className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
          {[['Ctrl+Z / Ctrl+Y', 'Undo / redo'], ['Ctrl+S', 'Save'], ['Ctrl+C / V / D', 'Copy / paste / duplicate'], ['Ctrl+G', 'Group (Shift: ungroup)'], ['Del', 'Delete selection'], ['Arrows', 'Nudge (Shift = 100 mm)'], ['R', 'Rotate tool'], ['L / H', 'Lock / hide'], ['F', 'Focus selection'], ['1-6', 'Front, back, left, right, top, iso'], ['Double-click', 'Open / close a door or drawer'], ['Alt + drag', 'Move without wall snapping']].map(([k, v]) => (
            <li key={k} className="flex justify-between border-b border-sand py-1"><kbd className="rounded bg-linen px-1.5 text-xs">{k}</kbd><span>{v}</span></li>
          ))}
        </ul>
      </section>
    </div>
  );
}
