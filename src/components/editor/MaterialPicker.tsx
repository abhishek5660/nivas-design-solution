'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { materialIndex, MATERIAL_CATEGORIES, SAMPLE_MATERIALS } from '@/lib/catalog';
import type { MaterialDef } from '@/lib/types';
import { useEditor } from '@/store/editor';

export function swatchStyle(m: MaterialDef): React.CSSProperties {
  const c = m.color;
  switch (m.texture) {
    case 'wood_oak':
    case 'wood_walnut':
    case 'wood_teak':
    case 'wood_ash':
    case 'laminate_grain':
      return { background: `repeating-linear-gradient(0deg, ${c} 0 3px, color-mix(in srgb, ${c} 82%, black) 3px 4px, ${c} 4px 9px)` };
    case 'marble':
      return { background: `linear-gradient(115deg, ${c} 40%, color-mix(in srgb, ${c} 50%, #888) 44%, ${c} 47%, ${c} 70%, color-mix(in srgb, ${c} 60%, #777) 72%, ${c} 75%)` };
    case 'stone':
      return { background: `radial-gradient(circle at 20% 30%, color-mix(in srgb, ${c} 70%, white) 0 1px, transparent 2px), radial-gradient(circle at 70% 60%, color-mix(in srgb, ${c} 60%, black) 0 1px, transparent 2px), ${c}`, backgroundSize: '7px 7px, 9px 9px, auto' };
    case 'fluted':
      return { background: `repeating-linear-gradient(90deg, ${c} 0 3px, color-mix(in srgb, ${c} 65%, black) 3px 4px)` };
    case 'slat':
      return { background: `repeating-linear-gradient(90deg, ${c} 0 5px, #1b1b1b 5px 7px)` };
    case 'brushed_metal':
      return { background: `linear-gradient(90deg, ${c}, color-mix(in srgb, ${c} 70%, white), ${c})` };
    default:
      return m.opacity != null && m.opacity < 1 ? { background: `linear-gradient(135deg, ${c}aa, #ffffff66)` } : { background: c };
  }
}

export function Swatch({ m, size = 22 }: { m: MaterialDef; size?: number }) {
  return <span className="inline-block shrink-0 rounded border border-black/15" style={{ width: size, height: size, ...swatchStyle(m) }} />;
}

export function useAllMaterials(): MaterialDef[] {
  const custom = useEditor((s) => s.doc.customMaterials);
  return useMemo(() => [...SAMPLE_MATERIALS, ...custom], [custom]);
}

export function MaterialPicker({ value, onChange, inheritLabel, onClear, label }: { value: string | null; onChange: (id: string) => void; inheritLabel?: string; onClear?: () => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const all = useAllMaterials();
  const custom = useEditor((s) => s.doc.customMaterials);
  const idx = useMemo(() => materialIndex(custom), [custom]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', h);
    window.addEventListener('keydown', k);
    return () => {
      window.removeEventListener('mousedown', h);
      window.removeEventListener('keydown', k);
    };
  }, [open]);
  const cur = value ? idx.get(value) : null;
  const cats = ['Custom', ...MATERIAL_CATEGORIES];
  const list = all.filter((m) => (!cat || (cat === 'Custom' ? m.source === 'custom' : m.category === cat)) && (!q || m.name.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="relative" ref={ref}>
      <button type="button" className="input flex !items-center gap-2 !py-1 text-left" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} aria-label={label}>
        {cur ? <Swatch m={cur} /> : <span className="h-[22px] w-[22px] rounded border border-dashed border-stone" />}
        <span className="min-w-0 flex-1 truncate text-[13px]">{cur ? cur.name : inheritLabel ?? 'Default'}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="M2 3l3 4 3-4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-40 mt-1 max-h-80 overflow-y-auto rounded-lg border border-sand bg-paper p-2 shadow-xl" role="listbox" style={{ minWidth: 250 }}>
          <input className="input mb-2 !py-1" placeholder="Search materials" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <div className="mb-2 flex flex-wrap gap-1">
            <button className={`chip ${!cat ? '!bg-ink !text-ivory' : ''}`} onClick={() => setCat('')}>All</button>
            {cats.map((c) => (
              <button key={c} className={`chip ${cat === c ? '!bg-ink !text-ivory' : ''}`} onClick={() => setCat(c)}>{c}</button>
            ))}
          </div>
          {onClear && (
            <button className="mb-1 w-full rounded px-2 py-1 text-left text-xs text-mute hover:bg-linen" onClick={() => { onClear(); setOpen(false); }}>
              ↺ {inheritLabel ?? 'Use default'}
            </button>
          )}
          <ul className="grid grid-cols-2 gap-1">
            {list.map((m) => (
              <li key={m.id}>
                <button role="option" aria-selected={m.id === value} className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-linen ${m.id === value ? 'bg-gold-soft/40' : ''}`} onClick={() => { onChange(m.id); setOpen(false); }}>
                  <Swatch m={m} size={26} />
                  <span className="min-w-0 flex-1 truncate">{m.name}</span>
                </button>
              </li>
            ))}
          </ul>
          {!list.length && <p className="p-3 text-center text-xs text-mute">No materials match.</p>}
          <p className="mt-2 border-t border-sand pt-1.5 text-[10px] text-mute">Sample materials are illustrative, not manufacturer-verified.</p>
        </div>
      )}
    </div>
  );
}
