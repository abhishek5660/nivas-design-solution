'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { fromDisplay, toDisplay, usePrefs } from '@/store/prefs';

/**
 * Numeric input committed on Enter/blur. `value` is always millimetres (or a plain number when
 * `length` is false). The commit handler returns false to reject the value (the field then snaps back).
 */
export function NumField({
  label,
  value,
  onCommit,
  length = true,
  min,
  max,
  step,
  suffix,
  disabled,
  title,
  compact,
}: {
  label?: string;
  value: number;
  onCommit: (v: number) => boolean | void;
  length?: boolean;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
  title?: string;
  compact?: boolean;
}) {
  const unit = usePrefs((s) => s.unit);
  const shown = length ? toDisplay(value, unit) : value;
  const [text, setText] = useState(String(shown));
  const [bad, setBad] = useState(false);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setText(String(shown));
  }, [shown]);

  function commit() {
    editing.current = false;
    const n = Number(text.replace(',', '.'));
    if (text.trim() === '' || !Number.isFinite(n)) {
      setBad(true);
      setText(String(shown));
      setTimeout(() => setBad(false), 900);
      return;
    }
    let v = length ? fromDisplay(n, unit) : n;
    if (min != null && v < min) v = min;
    if (max != null && v > max) v = max;
    if (Math.abs(v - value) < 1e-6) {
      setText(String(shown));
      return;
    }
    const ok = onCommit(Math.round(v * 1000) / 1000);
    if (ok === false) {
      setBad(true);
      setText(String(shown));
      setTimeout(() => setBad(false), 900);
    }
  }

  const input = (
    <div className="relative">
      <input
        className={`input !py-1 pr-8 text-right tabular-nums ${bad ? '!border-danger !ring-1 !ring-danger' : ''} ${compact ? '!text-xs' : ''}`}
        inputMode="decimal"
        value={text}
        disabled={disabled}
        title={title}
        aria-label={label}
        aria-invalid={bad}
        onFocus={(e) => {
          editing.current = true;
          e.currentTarget.select();
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          else if (e.key === 'Escape') {
            editing.current = false;
            setText(String(shown));
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const st = (step ?? (length ? (unit === 'mm' ? 10 : unit === 'cm' ? 1 : 0.5) : 1)) * (e.shiftKey ? 10 : 1);
            const n = Number(text) + (e.key === 'ArrowUp' ? st : -st);
            setText(String(Math.round(n * 1000) / 1000));
          }
        }}
      />
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-mute">{suffix ?? (length ? unit : '')}</span>
    </div>
  );
  if (!label) return input;
  return (
    <label className="block">
      <span className="label !mb-0.5 !text-[10px]">{label}</span>
      {input}
    </label>
  );
}

export function Section({ title, children, defaultOpen = true, right }: { title: string; children: ReactNode; defaultOpen?: boolean; right?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-sand">
      <div className="flex items-center justify-between px-3 py-2">
        <button className="flex flex-1 items-center gap-1.5 text-left text-[11px] font-bold uppercase tracking-[0.12em] text-graphite" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <svg width="10" height="10" viewBox="0 0 10 10" className={`transition ${open ? 'rotate-90' : ''}`}><path d="M3 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
          {title}
        </button>
        {right}
      </div>
      {open && <div className="space-y-2.5 px-3 pb-3">{children}</div>}
    </section>
  );
}

export function Row({ children, cols = 3 }: { children: ReactNode; cols?: 2 | 3 | 4 }) {
  return <div className={`grid gap-2 ${cols === 2 ? 'grid-cols-2' : cols === 4 ? 'grid-cols-4' : 'grid-cols-3'}`}>{children}</div>;
}

export function Select<T extends string>({ label, value, options, onChange, disabled }: { label?: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean }) {
  const el = (
    <select className="input !py-1 !text-[13px]" value={value} disabled={disabled} aria-label={label} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
  return label ? (
    <label className="block">
      <span className="label !mb-0.5 !text-[10px]">{label}</span>
      {el}
    </label>
  ) : el;
}

export function Toggle({ label, checked, onChange, disabled, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: string }) {
  return (
    <label className={`flex cursor-pointer items-center justify-between gap-2 text-[13px] ${disabled ? 'opacity-50' : ''}`} title={hint}>
      <span>{label}</span>
      <span className="relative inline-flex">
        <input type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-5 w-9 rounded-full bg-sand transition peer-checked:bg-gold peer-focus-visible:ring-2 peer-focus-visible:ring-gold" />
        <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
      </span>
    </label>
  );
}

export function IconBtn({ label, onClick, active, disabled, children, danger }: { label: string; onClick?: () => void; active?: boolean; disabled?: boolean; children: ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`grid h-8 min-w-8 place-items-center rounded-md px-1.5 text-[12px] font-semibold transition disabled:opacity-40 ${active ? 'bg-ink text-gold-soft' : danger ? 'text-danger hover:bg-danger/10' : 'text-graphite hover:bg-linen'}`}
    >
      {children}
    </button>
  );
}

export function Hint({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' | 'error' }) {
  const c = tone === 'error' ? 'border-danger/30 bg-danger/5 text-danger' : tone === 'warn' ? 'border-warn/30 bg-warn/5 text-warn' : 'border-sand bg-linen/60 text-graphite';
  return <p className={`rounded-md border px-2.5 py-1.5 text-xs leading-snug ${c}`}>{children}</p>;
}
