'use client';
import { tvDims } from '@/lib/build/tv';
import { uid } from '@/lib/build/wardrobe';
import type { SceneNode, TvParams } from '@/lib/types';
import { useEditor } from '@/store/editor';
import { Hint, NumField, Row, Section, Select, Toggle } from './fields';

const STYLE_MATERIAL: Record<TvParams['style'], string | null> = {
  plain: 'lam-oak',
  fluted: 'deco-fluted-walnut',
  slat: 'deco-slat-oak',
  marble: 'marble-carrara',
  stone: 'stone-slate',
  batten: 'wood-walnut',
};

export function TvEditor({ node }: { node: SceneNode }) {
  const p = node.params as unknown as TvParams;
  const patch = useEditor((s) => s.patchParams);
  const setSlotMaterial = useEditor((s) => s.setSlotMaterial);
  const toggleOpen = useEditor((s) => s.toggleOpen);
  const setAllOpen = useEditor((s) => s.setAllOpen);
  const issues = useEditor((s) => s.issues[node.id]) ?? [];
  const setP = (x: Partial<TvParams>, key?: string) => patch(node.id, x as Record<string, unknown>, key);
  const dims = tvDims(p.tv.size);
  const unit = (u: Partial<TvParams['unit']>) => setP({ unit: { ...p.unit, ...u } });
  const side = (w: 'left' | 'right', s: Partial<TvParams['sides']['left']>) => setP({ sides: { ...p.sides, [w]: { ...p.sides[w], ...s } } });
  const led = (l: Partial<TvParams['led']>) => setP({ led: { ...p.led, ...l } });
  const tv = (t: Partial<TvParams['tv']>) => setP({ tv: { ...p.tv, ...t } });

  return (
    <>
      <Section title="Panel finish">
        <Select
          label="Style"
          value={p.style}
          onChange={(v) => {
            setP({ style: v });
            const m = STYLE_MATERIAL[v];
            if (m) setSlotMaterial([node.id], 'accent', m);
          }}
          options={[
            { value: 'plain', label: 'Plain panel' },
            { value: 'fluted', label: 'Fluted panel' },
            { value: 'slat', label: 'Wood slat panel' },
            { value: 'batten', label: 'Vertical battens' },
            { value: 'marble', label: 'Marble-look panel' },
            { value: 'stone', label: 'Stone / textured' },
          ]}
        />
        <Row cols={2}>
          <NumField label="Panel thickness" value={p.panelThickness} min={9} max={120} onCommit={(v) => setP({ panelThickness: v })} />
          <NumField label="Pattern pitch" value={p.patternSpacing} min={20} max={400} disabled={p.style !== 'slat' && p.style !== 'batten'} onCommit={(v) => setP({ patternSpacing: v })} />
        </Row>
        <Toggle label="Backlit decorative panel" checked={p.backlit} onChange={(v) => setP({ backlit: v })} />
        <Toggle label="Fireplace-style insert" checked={p.fireplace} onChange={(v) => setP({ fireplace: v })} />
        <Select label="Handle" value={p.handle} onChange={(v) => setP({ handle: v })} options={[{ value: 'bar', label: 'Bar' }, { value: 'knob', label: 'Knob' }, { value: 'profile', label: 'Handleless' }, { value: 'none', label: 'None' }]} />
      </Section>

      <Section title="Television">
        <Row cols={2}>
          <NumField label="Screen size" length={false} suffix="inch" value={p.tv.size} min={24} max={120} step={1} onCommit={(v) => tv({ size: v })} />
          <NumField label="Offset from centre" value={p.tv.x} onCommit={(v) => tv({ x: v })} />
          <NumField label="Bottom from floor" value={p.tv.bottom} min={0} onCommit={(v) => tv({ bottom: v })} />
          <NumField label="Stand-off" value={p.tv.depth} min={0} max={200} onCommit={(v) => tv({ depth: v })} />
        </Row>
        <p className="text-[11px] text-mute">Screen: {Math.round(dims.w)} × {Math.round(dims.h)} mm</p>
        <Toggle label="Soundbar" checked={p.soundbar} onChange={(v) => setP({ soundbar: v })} />
      </Section>

      <Section title="Media unit">
        <Select label="Type" value={p.unit.type} onChange={(v) => unit({ type: v })} options={[{ value: 'floating', label: 'Floating unit' }, { value: 'floor', label: 'Floor-standing cabinet' }, { value: 'none', label: 'No unit' }]} />
        {p.unit.type !== 'none' && (
          <>
            <Row cols={2}>
              <NumField label="Width" value={p.unit.width} min={300} onCommit={(v) => unit({ width: v })} />
              <NumField label="Height" value={p.unit.height} min={150} max={1200} onCommit={(v) => unit({ height: v })} />
              <NumField label="Depth" value={p.unit.depth} min={150} onCommit={(v) => unit({ depth: v })} />
              <NumField label="Elevation" value={p.unit.elevation} min={0} disabled={p.unit.type === 'floor'} onCommit={(v) => unit({ elevation: v })} />
              <NumField label="Drawers" length={false} suffix="pcs" value={p.unit.drawers} min={0} max={6} step={1} onCommit={(v) => Number.isInteger(v) && unit({ drawers: v })} />
              <NumField label="Doors" length={false} suffix="pcs" value={p.unit.doors} min={0} max={4} step={1} onCommit={(v) => Number.isInteger(v) && unit({ doors: v })} />
            </Row>
            <Toggle label="Open storage (no shutters)" checked={p.unit.open} onChange={(v) => unit({ open: v })} />
            <Toggle label="Router / media compartment" checked={p.unit.routerCompartment} onChange={(v) => unit({ routerCompartment: v })} />
            <Toggle label="Cable-management opening" checked={p.unit.cableOpening} onChange={(v) => unit({ cableOpening: v })} />
            <Row cols={2}>
              <button className="btn btn-sm" onClick={() => setAllOpen('all', true, [node.id])}>Open all</button>
              <button className="btn btn-sm" onClick={() => setAllOpen('all', false, [node.id])}>Close all</button>
              {Array.from({ length: p.unit.drawers }).map((_, k) => (
                <button key={k} className="btn btn-sm btn-ghost" onClick={() => toggleOpen(node.id, `drawer-${k}`)}>Drawer {k + 1}</button>
              ))}
            </Row>
          </>
        )}
      </Section>

      <Section title="Side units" defaultOpen={false}>
        {(['left', 'right'] as const).map((w) => (
          <div key={w} className="space-y-2 rounded-md border border-sand p-2">
            <Toggle label={`${w === 'left' ? 'Left' : 'Right'} side unit`} checked={p.sides[w].enabled} onChange={(v) => side(w, { enabled: v })} />
            {p.sides[w].enabled && (
              <>
                <Row cols={2}>
                  <NumField label="Width" value={p.sides[w].width} min={150} onCommit={(v) => side(w, { width: v })} />
                  <NumField label="Height" value={p.sides[w].height} min={600} onCommit={(v) => side(w, { height: v })} />
                </Row>
                <Select label="Kind" value={p.sides[w].kind} onChange={(v) => side(w, { kind: v })} options={[{ value: 'closed', label: 'Closed (shutters)' }, { value: 'open', label: 'Open shelves' }, { value: 'niche', label: 'Display niches + LED' }]} />
              </>
            )}
          </div>
        ))}
        <NumField label="Side-unit depth" value={p.sides.depth} min={150} onCommit={(v) => setP({ sides: { ...p.sides, depth: v } })} />
      </Section>

      <Section title={`Wall shelves (${p.shelves.length})`} defaultOpen={false} right={<button className="btn btn-sm" onClick={() => setP({ shelves: [...p.shelves, { id: uid('shf'), x: 0, y: Math.min(node.size.h - 200, p.tv.bottom + dims.h + 150), w: 900, d: 200, t: 30 }] })}>+ Add</button>}>
        {p.shelves.map((s, i) => (
          <div key={s.id} className="rounded-md border border-sand p-2">
            <div className="mb-1 flex items-center justify-between text-xs font-semibold">Shelf {i + 1}<button className="text-danger" onClick={() => setP({ shelves: p.shelves.filter((x) => x.id !== s.id) })} aria-label={`Remove shelf ${i + 1}`}>✕</button></div>
            <Row cols={2}>
              <NumField compact label="X offset" value={s.x} onCommit={(v) => setP({ shelves: p.shelves.map((x) => (x.id === s.id ? { ...x, x: v } : x)) })} />
              <NumField compact label="Height" value={s.y} min={0} onCommit={(v) => setP({ shelves: p.shelves.map((x) => (x.id === s.id ? { ...x, y: v } : x)) })} />
              <NumField compact label="Length" value={s.w} min={100} onCommit={(v) => setP({ shelves: p.shelves.map((x) => (x.id === s.id ? { ...x, w: v } : x)) })} />
              <NumField compact label="Depth" value={s.d} min={80} onCommit={(v) => setP({ shelves: p.shelves.map((x) => (x.id === s.id ? { ...x, d: v } : x)) })} />
            </Row>
          </div>
        ))}
        {!p.shelves.length && <p className="text-xs text-mute">No wall shelves.</p>}
      </Section>

      <Section title="LED lighting" defaultOpen={false}>
        <Toggle label="LED lighting" checked={p.led.enabled} onChange={(v) => led({ enabled: v })} />
        <Toggle label="Under-unit glow" checked={p.led.under} disabled={!p.led.enabled} onChange={(v) => led({ under: v })} />
        <Toggle label="Halo behind TV" checked={p.led.behindTv} disabled={!p.led.enabled} onChange={(v) => led({ behindTv: v })} />
        <Toggle label="Inside niches / shelves" checked={p.led.niches} disabled={!p.led.enabled} onChange={(v) => led({ niches: v })} />
        <label className="flex items-center justify-between text-[13px]">
          Colour
          <input type="color" value={p.led.color} onChange={(e) => led({ color: e.target.value })} className="h-7 w-12 rounded border border-sand" />
        </label>
        <NumField label="Intensity" length={false} suffix="×" value={p.led.intensity} min={0} max={3} step={0.1} onCommit={(v) => led({ intensity: v })} />
      </Section>
      {issues.length > 0 && <div className="space-y-1 px-3 pb-3">{issues.map((i, k) => <Hint key={k} tone={i.level === 'error' ? 'error' : 'warn'}>{i.message}</Hint>)}</div>}
    </>
  );
}
