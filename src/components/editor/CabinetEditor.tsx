'use client';
import { SAMPLE_HARDWARE } from '@/lib/catalog';
import { CABINET_VARIANTS } from '@/lib/build/cabinet';
import type { ApplianceParams, BoxParams, CabinetParams, CountertopParams, SceneNode } from '@/lib/types';
import { useEditor } from '@/store/editor';
import { Hint, NumField, Row, Section, Select, Toggle } from './fields';

const hw = (cat: string) => SAMPLE_HARDWARE.filter((h) => h.category === cat).map((h) => ({ value: h.code, label: h.name }));

export function CabinetEditor({ node }: { node: SceneNode }) {
  const p = node.params as unknown as CabinetParams;
  const patch = useEditor((s) => s.patchParams);
  const toggleOpen = useEditor((s) => s.toggleOpen);
  const setAllOpen = useEditor((s) => s.setAllOpen);
  const sub = useEditor((s) => s.sel.sub);
  const issues = useEditor((s) => s.issues[node.id]) ?? [];
  const setP = (x: Partial<CabinetParams>, key?: string) => patch(node.id, x as Record<string, unknown>, key);
  const v = CABINET_VARIANTS[p.variant];
  const hasDoors = !['open_shelf', 'bookcase'].includes(p.variant) && p.doorStyle !== 'open';
  const canSlide = ['wall', 'tall', 'bookcase'].includes(p.variant);
  return (
    <>
      <Section title={v.label}>
        {hasDoors && p.variant !== 'drawer' && p.variant !== 'corner' && (
          <Row cols={2}>
            <Select label="Doors" value={String(p.doors) as '0' | '1' | '2'} onChange={(x) => setP({ doors: Number(x) as 0 | 1 | 2 })} options={[{ value: '0', label: 'None (drawers/open)' }, { value: '1', label: 'Single door' }, { value: '2', label: 'Double doors' }]} />
            <Select label="Hinge side" value={p.hingeSide} onChange={(x) => setP({ hingeSide: x })} options={[{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }]} disabled={p.doors !== 1} />
          </Row>
        )}
        {p.variant === 'corner' && (
          <Row cols={2}>
            <NumField label="Door width" value={p.cornerDoorWidth} min={300} onCommit={(x) => setP({ cornerDoorWidth: x })} />
            <Select label="Hinge side" value={p.hingeSide} onChange={(x) => setP({ hingeSide: x })} options={[{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }]} />
          </Row>
        )}
        {!['open_shelf', 'bookcase'].includes(p.variant) && (
          <Select label="Shutter style" value={p.doorStyle} onChange={(x) => setP({ doorStyle: x })} options={[{ value: 'flat', label: 'Flat slab' }, { value: 'shaker', label: 'Shaker' }, { value: 'glass', label: 'Glass' }, { value: 'open', label: 'Open (no shutters)' }]} />
        )}
        {canSlide && <Toggle label="Sliding doors" checked={p.sliding} onChange={(x) => setP({ sliding: x })} />}
        {p.variant !== 'drawer' && p.variant !== 'sink' && <NumField label="Adjustable shelves" length={false} suffix="shelves" value={p.shelves} min={0} max={10} step={1} onCommit={(x) => Number.isInteger(x) && setP({ shelves: x })} />}
        {hasDoors && (
          <Row cols={2}>
            <button className="btn btn-sm" onClick={() => setAllOpen('all', true, [node.id])}>Open</button>
            <button className="btn btn-sm" onClick={() => setAllOpen('all', false, [node.id])}>Close</button>
          </Row>
        )}
      </Section>

      {!['open_shelf', 'bookcase', 'sink'].includes(p.variant) && (
        <Section title={`Drawers (${p.drawers.length})`} right={<button className="btn btn-sm" onClick={() => setP({ drawers: [...p.drawers, p.variant === 'drawer' ? 240 : 180] })}>+ Add</button>}>
          {p.drawers.length === 0 && <p className="text-xs text-mute">No drawers.</p>}
          {p.variant === 'drawer' && p.drawers.length > 0 && <p className="text-[11px] text-mute">Heights are proportional - fronts always fill the cabinet.</p>}
          <ul className="space-y-1">
            {p.drawers.map((h, k) => (
              <li key={k} className={`flex items-center gap-1.5 rounded ${sub?.kind === 'drawer' && sub.index === k ? 'bg-gold-soft/30' : ''}`}>
                <span className="w-5 text-right text-[11px] text-mute">{k + 1}</span>
                <div className="flex-1"><NumField compact value={h} min={80} onCommit={(x) => { setP({ drawers: p.drawers.map((z, m) => (m === k ? x : z)) }); }} /></div>
                <button className="btn btn-sm btn-ghost" onClick={() => toggleOpen(node.id, `drawer-${k}`)}>Open</button>
                <button className="px-1 text-danger" aria-label={`Remove drawer ${k + 1}`} onClick={() => setP({ drawers: p.drawers.filter((_, m) => m !== k) })}>✕</button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {p.variant === 'island' && (
        <Section title="Island">
          <NumField label="Breakfast overhang" value={p.overhang} min={0} onCommit={(x) => setP({ overhang: x })} />
          <Toggle label="Raised breakfast bar" checked={p.raisedBar} onChange={(x) => setP({ raisedBar: x })} />
          <NumField label="Worktop thickness" value={p.countertopThickness} min={12} max={80} onCommit={(x) => setP({ countertopThickness: x })} />
        </Section>
      )}

      <Section title="Hardware & construction" defaultOpen={false}>
        <Row cols={2}>
          <Select label="Handle" value={p.handle} onChange={(x) => setP({ handle: x })} options={[{ value: 'bar', label: 'Bar' }, { value: 'knob', label: 'Knob' }, { value: 'profile', label: 'J-profile' }, { value: 'none', label: 'None' }]} />
          <Select label="Placement" value={p.handlePlacement} onChange={(x) => setP({ handlePlacement: x })} options={[{ value: 'edge', label: 'Edge' }, { value: 'center', label: 'Centre' }, { value: 'top', label: 'Top' }]} />
          <Select label="Hinge" value={p.hinge} onChange={(x) => setP({ hinge: x })} options={hw('hinge')} />
          <Select label="Runner" value={p.runner} onChange={(x) => setP({ runner: x })} options={hw('runner')} />
        </Row>
        <Row cols={2}>
          <NumField label="Board thickness" value={p.thickness} min={12} max={40} onCommit={(x) => setP({ thickness: x })} />
          <NumField label="Door gap" value={p.gap} min={0} max={10} onCommit={(x) => setP({ gap: x })} />
          <NumField label="Plinth height" value={p.plinthHeight} min={0} max={250} onCommit={(x) => setP({ plinthHeight: x })} />
          <NumField label="Wall clearance" value={p.wallClearance} min={0} max={100} onCommit={(x) => setP({ wallClearance: x })} />
        </Row>
        <Hint>Wall clearance is an installation allowance left behind the cabinet (for pipes, uneven walls).</Hint>
      </Section>
      {issues.length > 0 && <div className="space-y-1 px-3 pb-3">{issues.map((i, k) => <Hint key={k} tone={i.level === 'error' ? 'error' : 'warn'}>{i.message}</Hint>)}</div>}
    </>
  );
}

export function CountertopEditor({ node }: { node: SceneNode }) {
  const p = node.params as unknown as CountertopParams;
  const patch = useEditor((s) => s.patchParams);
  const setP = (x: Partial<CountertopParams>) => patch(node.id, x as Record<string, unknown>);
  return (
    <Section title="Countertop">
      <NumField label="Thickness" value={p.thickness} min={12} max={80} onCommit={(x) => setP({ thickness: x })} />
      <Row cols={2}>
        <NumField label="Backsplash height" value={p.backsplashHeight} min={0} max={900} onCommit={(x) => setP({ backsplashHeight: x })} />
        <NumField label="Backsplash thickness" value={p.backsplashThickness} min={6} max={40} onCommit={(x) => setP({ backsplashThickness: x })} />
      </Row>
      <Hint>The slab length is the node width; depth is the node depth. Cut-outs for the hob and sink are marked on site.</Hint>
    </Section>
  );
}

export function ApplianceEditor({ node }: { node: SceneNode }) {
  const p = node.params as unknown as ApplianceParams;
  const patch = useEditor((s) => s.patchParams);
  const setP = (x: Partial<ApplianceParams>) => patch(node.id, x as Record<string, unknown>);
  return (
    <Section title="Appliance">
      <p className="text-xs text-mute">Set the width/height/depth above to match the model you plan to buy.</p>
      {p.kind === 'hob' && <NumField label="Burners" length={false} suffix="burners" value={p.burners} min={1} max={6} step={1} onCommit={(x) => Number.isInteger(x) && setP({ burners: x })} />}
      {p.kind === 'sink' && <NumField label="Basins" length={false} suffix="basins" value={p.basins} min={1} max={2} step={1} onCommit={(x) => Number.isInteger(x) && setP({ basins: x })} />}
      {p.kind === 'light_strip' && (
        <label className="flex items-center justify-between text-[13px]">
          Light colour
          <input type="color" value={p.lightColor} onChange={(e) => setP({ lightColor: e.target.value })} className="h-7 w-12 rounded border border-sand" />
        </label>
      )}
    </Section>
  );
}

export function BoxEditor({ node }: { node: SceneNode }) {
  const p = node.params as unknown as BoxParams;
  const patch = useEditor((s) => s.patchParams);
  return (
    <Section title="Block">
      <Select label="Shape" value={p.shape} onChange={(x) => patch(node.id, { shape: x })} options={[{ value: 'box', label: 'Box / panel' }, { value: 'cylinder', label: 'Cylinder' }]} />
    </Section>
  );
}
