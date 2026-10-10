'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Logo } from './Logo';

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const payload = Object.fromEntries(f.entries());
    try {
      const res = await fetch(`/api/auth/${mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError([body.error, ...(Array.isArray(body.details) ? body.details : [])].filter(Boolean).join(' '));
        setBusy(false);
        return;
      }
      router.replace('/dashboard');
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-ink p-12 text-ivory lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.16]"
          style={{ backgroundImage: 'repeating-linear-gradient(90deg, #e7d4a6 0 1px, transparent 1px 46px), repeating-linear-gradient(0deg, #e7d4a6 0 1px, transparent 1px 46px)' }}
        />
        <Logo light />
        <div className="relative max-w-md">
          <h1 className="font-display text-5xl font-semibold leading-[1.05]">Design it in 3D.<br />Build it from the same model.</h1>
          <p className="mt-5 text-[15px] leading-relaxed text-stone">
            Parametric wardrobes, modular kitchens and TV panels, with live dimensions, 2D drawings, BOQ and cut lists generated from what you actually designed.
          </p>
        </div>
        <p className="relative text-xs text-mute">Estimates and production documents are generated from your saved design. Always verify before manufacturing.</p>
      </section>
      <section className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="fade-up w-full max-w-sm space-y-4" aria-label={mode === 'login' ? 'Sign in' : 'Create account'}>
          <div className="lg:hidden"><Logo /></div>
          <div>
            <h2 className="font-display text-3xl font-semibold">{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
            <p className="mt-1 text-sm text-mute">{mode === 'login' ? 'Sign in to open your design projects.' : 'The first account becomes the administrator.'}</p>
          </div>
          {mode === 'register' && (
            <div>
              <label className="label" htmlFor="name">Full name</label>
              <input id="name" name="name" className="input" required maxLength={80} autoComplete="name" />
            </div>
          )}
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" name="email" type="email" className="input" required autoComplete="email" />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input id="password" name="password" type="password" className="input" required minLength={mode === 'register' ? 8 : 1} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
            {mode === 'register' && <p className="mt-1 text-xs text-mute">At least 8 characters.</p>}
          </div>
          {error && (
            <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <button className="btn btn-primary w-full py-2.5" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
          <p className="text-center text-sm text-mute">
            {mode === 'login' ? (
              <>New here? <Link className="font-medium text-wood underline" href="/register">Create an account</Link></>
            ) : (
              <>Already registered? <Link className="font-medium text-wood underline" href="/login">Sign in</Link></>
            )}
          </p>
        </form>
      </section>
    </main>
  );
}
