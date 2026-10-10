'use client';
import { useEffect, useRef, type ReactNode } from 'react';

export const CATEGORY_LABEL: Record<string, string> = { WARDROBE: 'Wardrobe', KITCHEN: 'Kitchen', TV_PANEL: 'TV Panel', CUSTOM: 'Custom Furniture' };
export const STATUS_LABEL: Record<string, string> = { DRAFT: 'Draft', IN_REVIEW: 'In review', APPROVED: 'Approved', IN_PRODUCTION: 'In production', COMPLETED: 'Completed' };
export const STATUS_COLOR: Record<string, string> = {
  DRAFT: 'bg-linen text-graphite',
  IN_REVIEW: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  IN_PRODUCTION: 'bg-sky-100 text-sky-800',
  COMPLETED: 'bg-stone/40 text-ink',
};

export async function api<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: init?.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers });
  } catch {
    throw new Error('Could not reach the server. Check your connection.');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = Array.isArray(body.details) ? ` ${body.details.slice(0, 3).join('; ')}` : '';
    throw new Error((body.error ?? `Request failed (${res.status})`) + d);
  }
  return body as T;
}

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <svg className="spin" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="Loading" role="status">
      <circle cx="12" cy="12" r="9" stroke="#e5ddd0" strokeWidth="3" />
      <path d="M21 12a9 9 0 00-9-9" stroke="#b8923f" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Dialog({ title, onClose, children, wide, footer }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    window.addEventListener('keydown', onKey);
    // focus the first form control (not the close button) once, when the dialog opens
    (ref.current?.querySelector<HTMLElement>('input,select,textarea') ?? ref.current?.querySelector<HTMLElement>('button:not([aria-label="Close"])'))?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`fade-up max-h-[90vh] w-full overflow-y-auto rounded-xl bg-paper shadow-2xl ${wide ? 'max-w-2xl' : 'max-w-md'}`}>
        <div className="flex items-center justify-between border-b border-sand px-5 py-3.5">
          <h2 className="font-display text-xl font-semibold">{title}</h2>
          <button className="rounded p-1 text-mute hover:bg-linen" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="p-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-sand px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Confirm({ title, message, confirmLabel = 'Delete', onConfirm, onCancel, busy }: { title: string; message: ReactNode; confirmLabel?: string; onConfirm: () => void; onCancel: () => void; busy?: boolean }) {
  return (
    <Dialog
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary !border-danger !bg-danger hover:!bg-danger/90" onClick={onConfirm} disabled={busy}>{busy ? 'Working…' : confirmLabel}</button>
        </>
      }
    >
      <div className="text-sm text-graphite">{message}</div>
    </Dialog>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-14 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-full bg-linen">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#b8923f" strokeWidth="1.6"><path d="M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10" /></svg>
      </div>
      <h3 className="font-display text-xl font-semibold">{title}</h3>
      {hint && <p className="max-w-sm text-sm text-mute">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-4xl font-semibold leading-tight">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-mute">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function timeAgo(iso: string | Date): string {
  const t = new Date(iso).getTime();
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)} d ago`;
  return new Date(t).toLocaleDateString();
}
