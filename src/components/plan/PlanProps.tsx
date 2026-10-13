'use client';
import { useMemo } from 'react';
import { entityLabel } from '@/lib/plan/entities';
import { activeFloor, updateFloor } from '@/lib/plan/model';
import { TOOLS } from '@/lib/plan/tools';
import type { OptionField, ToolId } from '@/lib/plan/toolHost';
import type { Entity } from '@/lib/plan/types';
import { checkOpening } from '@/lib/plan/walls';
import { useEditor } from '@/store/editor';
import * as A from '@/store/planActions';
import { planEngine as engine, planHost, setPlan } from '@/store/planHost';
import { usePlanUi } from '@/store/planUi';
import { Hint, NumField, Row, Section, Select, Toggle } from '../editor/fields';

// ---------------- viewport navigation ----------------

function Pad({ step, label }: { step: number; label: string }) {
  const b = 'grid h-7 w-7 place-items-center rounded border border-sand bg-white text-sm hover:bg-linen active:bg-gold-soft';
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-mute">{label}</span>
      <div className="grid grid-cols-3 gap-0.5">
        <span />
        <button className={b} aria-label={`Move selection up ${step} mm`} title={`Move up ${step} mm`} onClick={() => A.moveBy(0, -step)}>↑</button>
        <span />
        <button className={b} aria-label={`Move selection left ${step} mm`} title={`Move left ${step} mm`} onClick={() => A.moveBy(-step, 0)}>←</button>
        <span className="grid place-items-center text-[9px] text-mute">{step}</span>
        <button className={b} aria-label={`Move selection right ${step} mm`} title={`Move right ${step} mm`} onClick={() => A.moveBy(step, 0)}>→</button>
        <span />
        <button className={b} aria-label={`Move selection down ${step} mm`} title={`Move down ${step} mm`} onClick={() => A.moveBy(0, step)}>↓</button>
        <span />
      </div>
    </div>
  );
}

export function ViewportNavigation() {
  const btn = 'rounded border border-sand bg-white px-2 py-1 text-xs hover:bg-linen';
  return (
    <Section title="Viewport navigation">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          <button className={btn} onClick={() => A.zoom('in')} aria-label="Zoom in">＋ In</button>
          <button className={btn} onClick={() => A.zoom('out')} aria-label="Zoom out">－ Out</button>
          <button className={btn} onClick={() => A.zoom('fit')}>Fit all</button>
          <button className={btn} onClick={() => A.zoom('selection')}>Selection</button>
        </div>
        <div className="flex justify-around">
          <Pad step={1} label="1 mm" />
          <Pad step={10} label="10 mm" />
        </div>
        <p className="text-[11px] leading-snug text-mute">Arrow buttons move the selected objects. Keyboard: arrows = 1 mm, Shift+arrows = 10 mm. Scroll to zoom, hold Space or the middle mouse button to pan.</p>
      </div>
    </Section>
  );
}

// ---------------- tool options ----------------

function OptionInput({ tool, f }: { tool: ToolId; f: OptionField }) {
  const planC = useEditor((s) => s.doc.plan!.components);
  const value = usePlanUi((s) => s.toolOptions[tool]?.[f.key]) ?? TOOLS[tool].defaults?.[f.key];
  const set = (v: string | number | boolean) => usePlanUi.getState().setOption(tool, f.key, v);
  if (f.type === 'number') return <NumField label={f.label} value={Number(value)} length={f.unit === 'mm'} suffix={f.unit} min={f.min} max={f.max} step={f.step} onCommit={(v) => set(v)} />;
  if (f.type === 'bool') return <Toggle label={f.label} checked={!!value} onChange={set} />;
  if (f.type === 'color')
    return (
      <label className="flex items-center justify-between gap-2 text-[13px]">
        {f.label}
        <input type="color" value={String(value)} onChange={(e) => set(e.target.value)} className="h-7 w-12 cursor-pointer rounded border border-sand" />
      </label>
    );
  if (f.type === 'text') return <label className="block"><span className="label !mb-0.5 !text-[10px]">{f.label}</span><input className="input !py-1" value={String(value ?? '')} onChange={(e) => set(e.target.value)} /></label>;
  const options = f.key === 'componentId' ? planC.map((c) => ({ value: c.id, label: c.name })) : (f.options ?? []);
  return <Select label={f.label} value={String(value ?? options[0]?.value ?? '')} options={options.length ? options : [{ value: '', label: 'No components yet' }]} onChange={set} />;
}

export function ToolOptions() {
  const tool = usePlanUi((s) => s.tool);
  const hint = usePlanUi((s) => s.hint);
  const def = TOOLS[tool];
  if (!def) return null;
  return (
    <Section title={`Tool: ${def.label}`}>
      <div className="space-y-2">
        <Hint>{hint || def.hint({})}</Hint>
        {def.options?.map((o) => <OptionInput key={o.key} tool={tool} f={o} />)}
        {tool === 'furnish' && <p className="text-xs text-mute">Choose the item in the Furnish panel on the right.</p>}
      </div>
    </Section>
  );
}

// ---------------- selection properties ----------------

type Field = { key: string; label: string; kind: 'num' | 'len' | 'select' | 'color' | 'text' | 'bool'; options?: [string, string][]; min?: number; max?: number };
const len = (key: string, label: string, min = 1, max = 100000): Field => ({ key, label, kind: 'len', min, max });
const deg = (key: string, label: string): Field => ({ key, label, kind: 'num', min: -360, max: 360 });
const pick = (key: string, label: string, options: [string, string][]): Field => ({ key, label, kind: 'select', options });

const FIELDS: Partial<Record<Entity['kind'], Field[]>> = {
  wall: [len('thickness', 'Thickness', 20, 2000), len('height', 'Height', 500, 12000), pick('wallType', 'Type', [['interior', 'Interior'], ['exterior', 'Exterior']]), { key: 'color', label: 'Colour', kind: 'color' }],
  door: [len('width', 'Width', 300, 4000), len('height', 'Height', 1500, 3500), len('offset', 'Offset from wall start', 0), pick('swing', 'Hinge side', [['left', 'Start of wall'], ['right', 'End of wall']]), pick('opens', 'Opens towards', [['in', 'Left of wall direction'], ['out', 'Right of wall direction']])],
  window: [len('width', 'Width', 300, 6000), len('height', 'Height', 300, 3500), len('sill', 'Sill height', 0, 3000), len('offset', 'Offset from wall start', 0)],
  column: [len('width', 'Width / diameter', 50, 3000), len('depth', 'Depth', 50, 3000), len('height', 'Height', 500, 12000), deg('rot', 'Rotation'), pick('shape', 'Profile', [['rect', 'Rectangular'], ['round', 'Circular']])],
  beam: [len('width', 'Width', 50, 2000), len('depth', 'Depth', 50, 2000), len('elevation', 'Underside elevation', 0, 20000)],
  slab: [len('thickness', 'Thickness', 20, 2000), len('elevation', 'Top elevation', -5000, 20000)],
  ceiling: [len('height', 'Height', 1500, 12000), len('thickness', 'Thickness', 5, 500), { key: 'visible', label: 'Show in 3D', kind: 'bool' }],
  tiling: [len('tileW', 'Tile width', 20, 3000), len('tileH', 'Tile height', 20, 3000), len('grout', 'Grout', 0, 50), pick('pattern', 'Pattern', [['grid', 'Straight grid'], ['brick', 'Brick'], ['diagonal', 'Diagonal 45°']]), deg('rotation', 'Rotation'), { key: 'color', label: 'Tile colour', kind: 'color' }, len('height', 'Wall tiling height', 100, 12000)],
  stairs: [len('width', 'Width', 400, 4000), { key: 'steps', label: 'Number of steps', kind: 'num', min: 2, max: 80 }, len('riser', 'Riser', 80, 300), len('tread', 'Tread', 150, 500), deg('rot', 'Rotation')],
  railing: [len('height', 'Height', 300, 2000), len('spacing', 'Post spacing', 50, 3000), len('elevation', 'Elevation', 0, 12000)],
  roof: [pick('roofType', 'Shape', [['flat', 'Flat'], ['gable', 'Gable'], ['hip', 'Hip'], ['shed', 'Shed']]), { key: 'slope', label: 'Slope °', kind: 'num', min: 0, max: 60 }, len('overhang', 'Overhang', 0, 3000), len('thickness', 'Thickness', 20, 600), len('elevation', 'Eaves elevation', 0, 20000)],
  light: [pick('lightType', 'Type', [['ceiling', 'Ceiling'], ['point', 'Point'], ['spot', 'Spot'], ['wall', 'Wall']]), len('elevation', 'Elevation', 0, 12000), { key: 'intensity', label: 'Intensity', kind: 'num', min: 0, max: 5 }, { key: 'color', label: 'Colour', kind: 'color' }],
  strip: [len('elevation', 'Elevation', 0, 12000), { key: 'intensity', label: 'Intensity', kind: 'num', min: 0, max: 5 }, { key: 'color', label: 'Colour', kind: 'color' }],
  model: [len('elevation', 'Elevation', 0, 12000), deg('rot', 'Rotation')],
  reference: [len('width', 'Width', 100, 200000), { key: 'opacity', label: 'Opacity', kind: 'num', min: 0.1, max: 1 }, deg('rot', 'Rotation')],
  text: [{ key: 'text', label: 'Text', kind: 'text' }, len('size', 'Text height', 20, 2000), deg('rot', 'Rotation')],
  leader: [{ key: 'text', label: 'Text', kind: 'text' }, len('size', 'Text height', 20, 2000)],
  circle: [len('r', 'Radius', 1)],
  dimension: [{ key: 'offset', label: 'Offset', kind: 'len', min: -20000, max: 20000 }],
  compass: [len('size', 'Size', 100, 5000), deg('north', 'North direction')],
  hatch: [pick('pattern', 'Pattern', [['diagonal', 'Diagonal'], ['cross', 'Cross-hatch'], ['horizontal', 'Horizontal'], ['vertical', 'Vertical'], ['dots', 'Dots'], ['solid', 'Solid']]), len('scale', 'Spacing', 20, 2000), deg('angle', 'Angle'), { key: 'color', label: 'Colour', kind: 'color' }],
};

/** Edits one property of an entity; rejects values that would make the model invalid. Returns false when rejected. */
export function setEntityProp(id: string, key: string, value: unknown): boolean {
  const d = useEditor.getState().doc;
  const p = d.plan!;
  const f = activeFloor(p);
  const e = f.entities[id];
  if (!e) return false;
  if ((e.kind === 'door' || e.kind === 'window') && (key === 'width' || key === 'offset')) {
    const width = key === 'width' ? Number(value) : e.width;
    const offset = key === 'offset' ? Number(value) : e.offset;
    const ok = checkOpening(f, e.wall, offset, width, e.id);
    if (!ok.ok) {
      usePlanUi.getState().say(ok.reason ?? 'That does not fit.', 'warn');
      return false;
    }
  }
  if (planHost.locked()) {
    usePlanUi.getState().say('The design is locked.', 'warn');
    return false;
  }
  setPlan((pl) => updateFloor(pl, f.id, (fl) => ({ ...fl, entities: { ...fl.entities, [id]: { ...e, [key]: value } as Entity } })), `prop:${id}:${key}`);
  return true;
}

function PropField({ id, e, f }: { id: string; e: Entity; f: Field }) {
  const v = (e as unknown as Record<string, unknown>)[f.key];
  if (f.kind === 'len') return <NumField label={f.label} value={Number(v)} min={f.min} max={f.max} onCommit={(n) => setEntityProp(id, f.key, n)} />;
  if (f.kind === 'num') return <NumField label={f.label} value={Number(v)} length={false} min={f.min} max={f.max} suffix={f.label.includes('°') || f.label.includes('Rotation') || f.label.includes('Angle') ? '°' : ''} onCommit={(n) => setEntityProp(id, f.key, f.key === 'steps' ? Math.round(n) : n)} />;
  if (f.kind === 'bool') return <Toggle label={f.label} checked={!!v} onChange={(b) => setEntityProp(id, f.key, b)} />;
  if (f.kind === 'color')
    return (
      <label className="flex items-center justify-between gap-2 text-[13px]">
        {f.label}
        <input type="color" value={typeof v === 'string' ? v : '#ddd3c2'} onChange={(ev) => setEntityProp(id, f.key, ev.target.value)} className="h-7 w-12 cursor-pointer rounded border border-sand" />
      </label>
    );
  if (f.kind === 'text') return <label className="block"><span className="label !mb-0.5 !text-[10px]">{f.label}</span><input className="input !py-1" value={String(v ?? '')} maxLength={500} onChange={(ev) => setEntityProp(id, f.key, ev.target.value)} /></label>;
  return <Select label={f.label} value={String(v)} options={(f.options ?? []).map(([value, label]) => ({ value, label }))} onChange={(x) => setEntityProp(id, f.key, x)} />;
}

export function SelectionProps() {
  const planEngine = () => engine;
  const doc = useEditor((s) => s.doc);
  const selection = usePlanUi((s) => s.selection);
  const plan = doc.plan!;
  const floor = activeFloor(plan);
  const ents = useMemo(() => selection.filter((i) => floor.entities[i]).map((i) => floor.entities[i]), [selection, floor]);
  const nodes = selection.filter((i) => doc.nodes[i]);
  if (!ents.length && !nodes.length) {
    return (
      <Section title="Properties">
        <p className="text-xs text-mute">Nothing selected. Click an object, or drag a box around several. Properties of the selection appear here.</p>
      </Section>
    );
  }
  if (ents.length === 1) {
    const e = ents[0];
    const fields = FIELDS[e.kind] ?? [];
    return (
      <Section title={`Properties — ${entityLabel(e)}`}>
        <div className="space-y-2">
          {fields.length ? fields.map((f) => <PropField key={f.key} id={e.id} e={e} f={f} />) : <p className="text-xs text-mute">This object has no editable numbers. Drag its grips in the plan to reshape it.</p>}
          <Row cols={2}>
            <button className="btn btn-sm" onClick={() => A.lockSelection(!e.locked)}>{e.locked ? 'Unlock' : 'Lock'}</button>
            <button className="btn btn-sm" onClick={() => planEngine().deleteSelection()}>Delete</button>
          </Row>
        </div>
      </Section>
    );
  }
  return (
    <Section title="Properties">
      <div className="space-y-2 text-sm">
        <p>{ents.length + nodes.length} objects selected{nodes.length ? ` (${nodes.length} furniture / cabinet${nodes.length === 1 ? '' : 's'}; open the Properties panel on the right to edit them)` : ''}.</p>
        <Row cols={2}>
          <button className="btn btn-sm" onClick={A.groupSelection}>Group</button>
          <button className="btn btn-sm" onClick={A.ungroupSelection}>Ungroup</button>
          <button className="btn btn-sm" onClick={() => A.lockSelection(true)}>Lock</button>
          <button className="btn btn-sm" onClick={() => planEngine().deleteSelection()}>Delete</button>
        </Row>
      </div>
    </Section>
  );
}

