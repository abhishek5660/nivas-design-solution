'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useEditor } from '@/store/editor';
import { IconBtn, Toggle } from './fields';

const Sep = () => <span className="mx-0.5 h-5 w-px bg-sand" aria-hidden />;
const bar = 'pointer-events-auto flex items-center rounded-lg border border-sand bg-paper/95 p-1 shadow-card backdrop-blur';

function Pop({ label, children, width = 260 }: { label: string; children: ReactNode; width?: number }) {
  const [open, setOpen] = useState(false);
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
  return (
    <div className="relative" ref={ref}>
      <button className={`flex h-8 items-center gap-1 rounded-md px-2 text-[12px] font-semibold transition ${open ? 'bg-ink text-gold-soft' : 'text-graphite hover:bg-linen'}`} aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {label}
        <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden><path d="M2 3l3 4 3-4" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1.5 space-y-2.5 rounded-lg border border-sand bg-paper p-3 shadow-xl" style={{ width }}>
          {children}
        </div>
      )}
    </div>
  );
}

export function Toolbar({ onRender, onCompare }: { onRender: () => void; onCompare: () => void }) {
  const ui = useEditor((s) => s.ui);
  const setUi = useEditor((s) => s.setUi);
  const requestView = useEditor((s) => s.requestView);
  const sel = useEditor((s) => s.sel.ids);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const access = useEditor((s) => s.access);
  const a = useEditor.getState();
  const ro = access === 'VIEW';
  const has = sel.length > 0;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-start gap-2 p-2.5">
      <div className={bar} role="toolbar" aria-label="Edit tools">
        <IconBtn label="Undo (Ctrl+Z)" onClick={() => a.undo()} disabled={!canUndo || ro}>↶</IconBtn>
        <IconBtn label="Redo (Ctrl+Y)" onClick={() => a.redo()} disabled={!canRedo || ro}>↷</IconBtn>
        <Sep />
        <IconBtn label="Select / move (V)" active={ui.tool === 'select'} onClick={() => setUi({ tool: 'select' })}>Select</IconBtn>
        <IconBtn label="Rotate by dragging (R)" active={ui.tool === 'rotate'} onClick={() => setUi({ tool: 'rotate' })}>Rotate</IconBtn>
        <Sep />
        <IconBtn label="Duplicate (Ctrl+D)" disabled={!has || ro} onClick={() => a.duplicateSelected()}>Dup</IconBtn>
        <IconBtn label="Copy (Ctrl+C)" disabled={!has} onClick={() => a.copySelected()}>Copy</IconBtn>
        <IconBtn label="Paste (Ctrl+V)" disabled={ro} onClick={() => a.paste()}>Paste</IconBtn>
        <IconBtn label="Group (Ctrl+G)" disabled={sel.length < 2 || ro} onClick={() => a.groupSelected()}>Group</IconBtn>
        <IconBtn label="Lock / unlock (L)" disabled={!has || ro} onClick={() => a.toggleLock()}>Lock</IconBtn>
        <IconBtn label="Delete (Del)" disabled={!has || ro} danger onClick={() => a.deleteSelected()}>Del</IconBtn>
      </div>

      <div className={bar} role="toolbar" aria-label="Camera views">
        {([['front', 'Front'], ['back', 'Back'], ['left', 'Left'], ['right', 'Right'], ['top', 'Top'], ['iso', 'Iso']] as const).map(([k, l]) => (
          <IconBtn key={k} label={`${l} view`} onClick={() => requestView(k)}>{l}</IconBtn>
        ))}
        <Sep />
        <IconBtn label="Fit scene" onClick={() => requestView('fit-scene')}>Fit</IconBtn>
        <IconBtn label="Focus selected (F)" disabled={!has} onClick={() => requestView('fit-selection')}>Focus</IconBtn>
        <IconBtn label="Reset camera" onClick={() => requestView('reset')}>Reset</IconBtn>
        <Sep />
        <IconBtn label="Toggle perspective / orthographic" active={ui.camera === 'orthographic'} onClick={() => setUi({ camera: ui.camera === 'perspective' ? 'orthographic' : 'perspective' })}>{ui.camera === 'perspective' ? 'Persp' : 'Ortho'}</IconBtn>
      </div>

      <div className={bar} role="toolbar" aria-label="View menus">
        <Pop label="Display">
          <Toggle label="Grid" checked={ui.showGrid} onChange={(v) => setUi({ showGrid: v })} />
          <Toggle label="Dimension labels" checked={ui.showDims} onChange={(v) => setUi({ showDims: v })} />
          <Toggle label="Room walls" checked={ui.showWalls} onChange={(v) => setUi({ showWalls: v })} />
          <Toggle label="Highlight overlaps" checked={ui.ghost} onChange={(v) => setUi({ ghost: v })} />
          <Toggle label="Block overlapping placement" checked={ui.blockOverlap} onChange={(v) => setUi({ blockOverlap: v })} hint="When on, moves/resizes that would make components overlap are rejected" />
          <label className="flex items-center justify-between text-[13px]">
            Snap to grid
            <select className="input !w-auto !py-0.5 text-xs" value={ui.snap} onChange={(e) => setUi({ snap: Number(e.target.value) })} aria-label="Snap increment">
              <option value={0}>Off</option>
              <option value={5}>5 mm</option>
              <option value={10}>10 mm</option>
              <option value={50}>50 mm</option>
              <option value={100}>100 mm</option>
            </select>
          </label>
        </Pop>
        <Pop label="Animate">
          <label className="block text-[13px]">
            Exploded view
            <input type="range" min={0} max={1} step={0.05} value={ui.exploded} onChange={(e) => setUi({ exploded: Number(e.target.value) })} aria-label="Exploded view amount" className="mt-1 w-full accent-[#b8923f]" />
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            <button className="btn btn-sm" onClick={() => a.setAllOpen('door', true)}>Open doors</button>
            <button className="btn btn-sm" onClick={() => a.setAllOpen('drawer', true)}>Open drawers</button>
            <button className="btn btn-sm col-span-2" onClick={() => a.setAllOpen('all', false)}>Close everything</button>
          </div>
          <Toggle label="Walkthrough (WASD + drag)" checked={ui.walkthrough} onChange={(v) => setUi({ walkthrough: v, presentation: false })} />
          <Toggle label="Orbit presentation" checked={ui.presentation} onChange={(v) => setUi({ presentation: v, walkthrough: false })} />
          <button className="btn btn-sm w-full" onClick={onCompare}>{ui.compareMode ? 'Close before / after' : 'Before / after comparison'}</button>
        </Pop>
        <Pop label="Detail" width={220}>
          {([['room', 'Room view', 'Whole room with walls'], ['cabinet', 'Cabinet view', 'Walls hidden, focus on selection'], ['detail', 'Detail view', 'Opens and zooms into selection']] as const).map(([k, l, d]) => (
            <button
              key={k}
              className={`block w-full rounded-md border px-2.5 py-1.5 text-left text-sm ${ui.viewMode === k ? 'border-gold bg-gold-soft/30' : 'border-sand hover:bg-linen'}`}
              onClick={() => {
                setUi({ viewMode: k, showWalls: k === 'room' ? useEditor.getState().doc.room.showWalls : false });
                if (k === 'room') requestView('iso');
                else {
                  requestView('fit-selection');
                  if (k === 'detail') a.setAllOpen('all', true, sel.length ? sel : undefined);
                }
              }}
            >
              <div className="font-medium">{l}</div>
              <div className="text-[11px] text-mute">{d}</div>
            </button>
          ))}
        </Pop>
        <Sep />
        <button className="btn btn-sm btn-gold" onClick={onRender}>Render</button>
      </div>
    </div>
  );
}
