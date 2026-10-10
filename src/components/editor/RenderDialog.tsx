'use client';
import { useEffect, useRef, useState } from 'react';
import { renderPanorama, renderStill, RenderError } from '@/lib/three/render';
import { roomBox } from '@/lib/three/bounds';
import { useEditor } from '@/store/editor';
import { Dialog } from '../ui';
import { Hint, NumField, Select } from './fields';

const SIZES = [
  { value: '1280x720', label: 'HD 1280 × 720' },
  { value: '1920x1080', label: 'Full HD 1920 × 1080' },
  { value: '2560x1440', label: 'QHD 2560 × 1440' },
  { value: '3840x2160', label: '4K 3840 × 2160' },
];

export function RenderDialog({ onClose }: { onClose: () => void }) {
  const meta = useEditor((s) => s.meta);
  const doc = useEditor((s) => s.doc);
  const [size, setSize] = useState('1920x1080');
  const [samples, setSamples] = useState(32);
  const [format, setFormat] = useState<'png' | 'jpeg'>('png');
  const [mode, setMode] = useState<'still' | 'pano'>('still');
  const [panoW, setPanoW] = useState('4096');
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState<[number, number]>([0, 1]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; name: string; bytes: number } | null>(null);
  const ctl = useRef<AbortController | null>(null);

  useEffect(() => () => { ctl.current?.abort(); }, []);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);

  async function go() {
    setBusy(true);
    setError(null);
    setResult(null);
    ctl.current = new AbortController();
    const base = (meta?.name ?? 'render').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 40);
    try {
      let blob: Blob;
      if (mode === 'still') {
        const [w, h] = size.split('x').map(Number);
        blob = await renderStill({ width: w, height: h, samples, format, signal: ctl.current.signal, onProgress: (d, t) => setProg([d, t]) });
      } else {
        const rb = roomBox(doc);
        const eye: [number, number, number] = [((rb.min[0] + rb.max[0]) / 2) * 0.001, 1.5, ((rb.min[2] + rb.max[2]) / 2) * 0.001];
        blob = await renderPanorama({ width: Number(panoW), eye, format, signal: ctl.current.signal, onProgress: (d, t) => setProg([d, t]) });
      }
      setResult({ url: URL.createObjectURL(blob), name: `${base}-${mode === 'still' ? size : 'panorama-' + panoW}.${format === 'png' ? 'png' : 'jpg'}`, bytes: blob.size });
    } catch (e) {
      setError(e instanceof RenderError ? e.message : `Render failed: ${(e as Error).message}`);
    }
    setBusy(false);
  }

  const pct = Math.round((prog[0] / prog[1]) * 100);
  return (
    <Dialog title="Render" onClose={() => { ctl.current?.abort(); onClose(); }} wide footer={<>
      {busy ? <button className="btn" onClick={() => ctl.current?.abort()}>Cancel render</button> : <button className="btn" onClick={onClose}>Close</button>}
      {!busy && <button className="btn btn-gold" onClick={go}>{result ? 'Render again' : 'Start render'}</button>}
    </>}>
      <div className="space-y-3">
        <div className="flex gap-2" role="tablist">
          {([['still', 'Still image'], ['pano', '360° panorama']] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={mode === k} onClick={() => setMode(k)} disabled={busy} className={`rounded-md border px-3 py-1.5 text-sm ${mode === k ? 'border-gold bg-gold-soft/30 font-semibold' : 'border-sand'}`}>{l}</button>
          ))}
        </div>
        {mode === 'still' ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <Select label="Resolution" value={size} options={SIZES} onChange={setSize} disabled={busy} />
            <NumField label="Quality samples" length={false} suffix="passes" value={samples} min={4} max={128} step={4} onCommit={(v) => setSamples(Math.round(v))} disabled={busy} />
            <Select label="Format" value={format} options={[{ value: 'png', label: 'PNG (lossless)' }, { value: 'jpeg', label: 'JPEG' }]} onChange={setFormat} disabled={busy} />
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Panorama width" value={panoW} options={[{ value: '2048', label: '2048 × 1024' }, { value: '4096', label: '4096 × 2048' }, { value: '8192', label: '8192 × 4096' }]} onChange={setPanoW} disabled={busy} />
            <Select label="Format" value={format} options={[{ value: 'png', label: 'PNG (lossless)' }, { value: 'jpeg', label: 'JPEG' }]} onChange={setFormat} disabled={busy} />
          </div>
        )}
        <Hint>
          {mode === 'still'
            ? 'The image is rendered from your current camera angle. Each pass shifts the camera by a sub-pixel amount and the sun within a small cone, then the passes are averaged - this gives smooth edges and soft shadows. It is a rasterised render, not ray-traced.'
            : 'Six views from the room centre at eye height (1.5 m) are stitched into an equirectangular panorama, ready for 360° viewers.'}
        </Hint>
        {busy && (
          <div role="status" aria-live="polite">
            <div className="mb-1 flex justify-between text-xs text-mute"><span>{mode === 'still' ? `Pass ${prog[0]} of ${prog[1]}` : 'Building panorama…'}</span><span>{pct}%</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-sand"><div className="h-full bg-gold transition-all" style={{ width: `${pct}%` }} /></div>
            <p className="mt-1 text-[11px] text-mute">The 3D view is paused while rendering.</p>
          </div>
        )}
        {error && <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}
        {result && (
          <div className="space-y-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={result.url} alt="Rendered result" className="max-h-72 w-full rounded-lg border border-sand object-contain" />
            <div className="flex items-center justify-between text-sm">
              <span className="text-mute">{result.name} · {(result.bytes / 1024 / 1024).toFixed(2)} MB</span>
              <a className="btn btn-primary" href={result.url} download={result.name}>Download</a>
            </div>
          </div>
        )}
        <p className="text-[11px] text-mute">Video export is not available (no reliable in-browser rendering pipeline yet).</p>
      </div>
    </Dialog>
  );
}
