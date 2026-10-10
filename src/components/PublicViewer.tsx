'use client';
import dynamic from 'next/dynamic';
import { useEffect } from 'react';
import type { SceneDoc } from '@/lib/types';
import { useEditor } from '@/store/editor';
import { Logo } from './Logo';
import { CATEGORY_LABEL, Spinner } from './ui';

const Viewport = dynamic(() => import('./editor/Viewport'), { ssr: false, loading: () => <div className="grid h-full place-items-center"><Spinner size={30} /></div> });

export function PublicViewer({ token, name, category, doc, version, updatedAt }: { token: string; name: string; category: string; doc: SceneDoc; version: number; updatedAt: string }) {
  const ready = useEditor((s) => s.projectId === 'public');
  const ui = useEditor((s) => s.ui);
  useEffect(() => {
    (globalThis as unknown as { __nivasShare?: string }).__nivasShare = token;
    useEditor.getState().load({ meta: { id: 'public', name, category, status: 'DRAFT', customer: '', roomNotes: '', updatedAt }, doc, version, access: 'VIEW' });
    useEditor.getState().setUi({ showDims: true });
  }, [token, name, category, doc, version, updatedAt]);
  const a = useEditor.getState();
  return (
    <div className="flex h-screen flex-col bg-ivory">
      <header className="flex items-center justify-between gap-3 border-b border-sand bg-paper px-4 py-2.5">
        <Logo />
        <div className="min-w-0 text-center">
          <h1 className="truncate font-display text-xl font-semibold leading-tight">{name}</h1>
          <p className="text-[11px] text-mute">{CATEGORY_LABEL[category]} · read-only preview · v{version}</p>
        </div>
        <span className="chip">View only</span>
      </header>
      <main className="relative min-h-0 flex-1" aria-label="3D preview">
        {ready ? <Viewport /> : <div className="grid h-full place-items-center"><Spinner size={30} /></div>}
        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5 rounded-lg border border-sand bg-paper/95 p-1 shadow-card backdrop-blur" role="toolbar" aria-label="Preview controls">
          {([['iso', 'Iso'], ['front', 'Front'], ['top', 'Top'], ['left', 'Left'], ['right', 'Right']] as const).map(([k, l]) => (
            <button key={k} className="btn btn-sm btn-ghost" onClick={() => a.requestView(k)}>{l}</button>
          ))}
          <button className="btn btn-sm btn-ghost" onClick={() => a.setAllOpen('all', true)}>Open doors</button>
          <button className="btn btn-sm btn-ghost" onClick={() => a.setAllOpen('all', false)}>Close</button>
          <button className={`btn btn-sm ${ui.presentation ? '!bg-ink !text-gold-soft' : 'btn-ghost'}`} onClick={() => a.setUi({ presentation: !ui.presentation })}>Orbit</button>
          <button className={`btn btn-sm ${ui.showDims ? '!bg-ink !text-gold-soft' : 'btn-ghost'}`} onClick={() => a.setUi({ showDims: !ui.showDims })}>Dims</button>
        </div>
        <p className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-paper/85 px-2.5 py-1.5 text-[11px] text-graphite shadow-card">Drag to orbit · scroll to zoom · double-click a door or drawer to open it</p>
      </main>
    </div>
  );
}
