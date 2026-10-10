'use client';
import { useState } from 'react';
import { checkPlacement, findCollisions } from '@/lib/scene';
import { SLOT_FALLBACK, materialIndex } from '@/lib/catalog';
import type { SceneNode, Slot } from '@/lib/types';
import { descendants, useEditor } from '@/store/editor';
import { usePrefs } from '@/store/prefs';
import { api } from '../ui';
import { ApplianceEditor, BoxEditor, CabinetEditor, CountertopEditor } from './CabinetEditor';
import { Hint, NumField, Row, Section, Select } from './fields';
import { MaterialPicker } from './MaterialPicker';
import { TvEditor } from './TvEditor';
import { WardrobeEditor } from './WardrobeEditor';

const SLOTS_FOR: Record<string, { slot: Slot; label: string }[]> = {
  wardrobe: [
    { slot: 'carcass', label: 'Carcass (outer)' },
    { slot: 'interior', label: 'Interior' },
    { slot: 'shutter', label: 'Shutters' },
    { slot: 'back', label: 'Back panel' },
    { slot: 'handle', label: 'Handles' },
    { slot: 'metal', label: 'Rods & tracks' },
    { slot: 'mirror', label: 'Mirror' },
    { slot: 'glass', label: 'Glass' },
  ],
  cabinet: [
    { slot: 'carcass', label: 'Carcass' },
    { slot: 'interior', label: 'Interior' },
    { slot: 'shutter', label: 'Shutters & fronts' },
    { slot: 'handle', label: 'Handles' },
    { slot: 'top', label: 'Island worktop' },
    { slot: 'glass', label: 'Glass' },
  ],
  countertop: [
    { slot: 'top', label: 'Countertop' },
    { slot: 'backsplash', label: 'Backsplash' },
  ],
  appliance: [
    { slot: 'appliance', label: 'Body' },
    { slot: 'metal', label: 'Metal parts' },
  ],
  tv_panel: [
    { slot: 'accent', label: 'Wall panel finish' },
    { slot: 'carcass', label: 'Carcass' },
    { slot: 'interior', label: 'Interior' },
    { slot: 'shutter', label: 'Shutters & drawers' },
    { slot: 'handle', label: 'Handles' },
  ],
  box: [{ slot: 'carcass', label: 'Material' }],
};

const SUB_SLOTS: Record<string, Slot[]> = { section: ['interior', 'carcass'], door: ['shutter', 'mirror', 'glass'], drawer: ['shutter', 'interior'], shelf: ['interior', 'carcass'], niche: ['interior'], tv: [] };

export function Inspector() {
  const doc = useEditor((s) => s.doc);
  const sel = useEditor((s) => s.sel);
  const access = useEditor((s) => s.access);
  const issuesAll = useEditor((s) => s.issues);
  void issuesAll;
  const unit = usePrefs((s) => s.unit);
  void unit;
  const ids = sel.ids.filter((i) => doc.nodes[i]);

  if (ids.length === 0) return <SceneSummary />;
  if (ids.length > 1) return <MultiInspector ids={ids} />;
  const node = doc.nodes[ids[0]];
  return (
    <div className={access === 'VIEW' ? 'pointer-events-none opacity-70' : ''} aria-disabled={access === 'VIEW'}>
      <NodeInspector node={node} />
    </div>
  );
}

function SceneSummary() {
  const doc = useEditor((s) => s.doc);
  const cols = findCollisions(doc);
  const n = doc.order.length;
  return (
    <div className="space-y-3 p-3">
      <h3 className="font-display text-xl font-semibold">Nothing selected</h3>
      <p className="text-sm text-mute">Click a component in the 3D view, or pick one from the Scene list. Press <kbd className="rounded bg-linen px-1">Ctrl+A</kbd> to select all.</p>
      <div className="grid grid-cols-2 gap-2 text-center text-xs">
        <div className="rounded-md bg-linen p-2"><div className="text-lg font-semibold">{n}</div>components</div>
        <div className="rounded-md bg-linen p-2"><div className="text-lg font-semibold">{cols.length}</div>overlaps</div>
      </div>
      {cols.length > 0 && (
        <Hint tone="warn">
          {cols.slice(0, 4).map((c) => <span key={c.a + c.b} className="block">• {c.message}</span>)}
        </Hint>
      )}
      <Hint>Dimensions use millimetres by default. Change units under Settings.</Hint>
    </div>
  );
}

function MultiInspector({ ids }: { ids: string[] }) {
  const { align, distribute, groupSelected, ungroupSelected, toggleLock, toggleVisible, setSlotMaterial, duplicateSelected, deleteSelected } = useEditor.getState();
  const doc = useEditor((s) => s.doc);
  const groupSel = ids.some((i) => doc.nodes[i].type === 'group');
  return (
    <div className="space-y-3 p-3">
      <h3 className="font-display text-xl font-semibold">{ids.length} components</h3>
      <div>
        <span className="label">Align</span>
        <div className="grid grid-cols-3 gap-1">
          {([['left', 'Left edges'], ['centerX', 'Centre X'], ['right', 'Right edges'], ['back', 'Back edges'], ['centerZ', 'Centre Z'], ['front', 'Front edges']] as const).map(([m, l]) => (
            <button key={m} className="btn btn-sm" onClick={() => align(m)}>{l}</button>
          ))}
        </div>
      </div>
      <div>
        <span className="label">Distribute evenly</span>
        <div className="grid grid-cols-2 gap-1">
          <button className="btn btn-sm" onClick={() => distribute('x')}>Horizontally</button>
          <button className="btn btn-sm" onClick={() => distribute('z')}>In depth</button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1">
        <button className="btn btn-sm" onClick={() => groupSelected()}>Group</button>
        <button className="btn btn-sm" disabled={!groupSel} onClick={() => ungroupSelected()}>Ungroup</button>
        <button className="btn btn-sm" onClick={() => toggleLock()}>Lock / unlock</button>
        <button className="btn btn-sm" onClick={() => toggleVisible()}>Show / hide</button>
        <button className="btn btn-sm" onClick={() => duplicateSelected()}>Duplicate</button>
        <button className="btn btn-sm btn-danger" onClick={() => deleteSelected()}>Delete</button>
      </div>
      <div>
        <span className="label">Apply material to all</span>
        <div className="space-y-1.5">
          {([['carcass', 'Carcass'], ['shutter', 'Shutters'], ['handle', 'Handles'], ['top', 'Countertops']] as [Slot, string][]).map(([slot, label]) => (
            <div key={slot} className="grid grid-cols-[84px_1fr] items-center gap-2 text-xs">
              {label}
              <MaterialPicker value={null} inheritLabel="Choose…" onChange={(m) => setSlotMaterial(ids, slot, m)} onClear={() => setSlotMaterial(ids, slot, null)} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function NodeInspector({ node }: { node: SceneNode }) {
  const st = useEditor.getState();
  const doc = useEditor((s) => s.doc);
  const sel = useEditor((s) => s.sel);
  const idx = materialIndex(doc.customMaterials);
  const { patchNode, setSize, setPosition, setRotation, setSlotMaterial, toggleLock, toggleVisible, duplicateSelected, deleteSelected, ungroupSelected } = st;
  const place = checkPlacement(doc, node);
  const slots = SLOTS_FOR[node.type] ?? [];
  const sub = sel.sub;
  const subSlots = sub ? SUB_SLOTS[sub.kind] ?? [] : [];
  const [saving, setSaving] = useState(false);

  async function saveToLibrary() {
    setSaving(true);
    try {
      const { id, position, parentId, ...rest } = node;
      void id; void position; void parentId;
      await api('/api/catalog', { method: 'POST', body: JSON.stringify({ kind: 'COMPONENT', name: node.name, category: node.type, data: { node: rest } }) });
      useEditor.getState().toast('success', `"${node.name}" saved to your component library.`);
    } catch (e) {
      useEditor.getState().toast('error', (e as Error).message);
    }
    setSaving(false);
  }

  const resolved = (slot: Slot) => idx.get(doc.defaults[slot] ?? SLOT_FALLBACK[slot])?.name ?? 'Default';
  const subKey = sub ? `${sub.kind}:${sub.index}` : '';
  const subName = sub ? ({ section: `Section ${sub.index + 1}`, door: sub.index >= 100 ? `Loft shutter ${sub.index - 99}` : `Door ${sub.index + 1}`, drawer: `Drawer ${sub.index >= 100 ? `S${Math.floor(sub.index / 100) + 1}-${(sub.index % 100) + 1}` : sub.index + 1}`, shelf: `Shelf ${sub.index + 1}`, niche: 'Niche', tv: 'Television' } as Record<string, string>)[sub.kind] ?? sub.kind : '';

  return (
    <div>
      <div className="border-b border-sand p-3">
        <div className="flex items-center gap-2">
          <input className="input !py-1 font-display text-lg font-semibold" value={node.name} maxLength={120} aria-label="Component name" onChange={(e) => patchNode(node.id, (n) => ({ ...n, name: e.target.value }), { key: `name:${node.id}`, placement: false })} />
          <button className={`btn btn-sm ${node.locked ? '!bg-ink !text-gold-soft' : ''}`} title={node.locked ? 'Unlock' : 'Lock'} aria-pressed={node.locked} onClick={() => toggleLock([node.id])}>{node.locked ? '🔒' : '🔓'}</button>
          <button className={`btn btn-sm ${!node.visible ? '!bg-ink !text-gold-soft' : ''}`} title={node.visible ? 'Hide' : 'Show'} aria-pressed={!node.visible} onClick={() => toggleVisible([node.id])}>{node.visible ? '👁' : '🚫'}</button>
        </div>
        <div className="mt-1 flex items-center justify-between text-[11px] text-mute">
          <span className="capitalize">{node.type.replace('_', ' ')}{node.locked ? ' · locked' : ''}</span>
          <span className="flex gap-1">
            <button className="btn btn-sm btn-ghost" onClick={() => duplicateSelected()}>Duplicate</button>
            <button className="btn btn-sm btn-ghost text-danger" onClick={() => deleteSelected()}>Delete</button>
          </span>
        </div>
        {place.map((p, i) => <Hint key={i} tone={p.level === 'error' ? 'error' : 'warn'}>{p.message}</Hint>)}
      </div>

      {sub && subSlots.length > 0 && (
        <div className="border-b border-sand bg-gold-soft/20 p-3">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wide text-wood">Material: {subName}</span>
            <button className="text-xs text-mute underline" onClick={() => useEditor.getState().selectSub(null)}>done</button>
          </div>
          <div className="space-y-1.5">
            {subSlots.map((slot) => (
              <div key={slot} className="grid grid-cols-[72px_1fr] items-center gap-2 text-xs capitalize">
                {slot}
                <MaterialPicker value={node.subMaterials?.[subKey]?.[slot] ?? null} inheritLabel="Same as component" onChange={(m) => setSlotMaterial([node.id], slot, m, sub)} onClear={() => setSlotMaterial([node.id], slot, null, sub)} />
              </div>
            ))}
          </div>
        </div>
      )}

      <Section title="Dimensions & placement">
        <Row>
          <NumField label="Width" value={node.size.w} min={1} onCommit={(v) => setSize(node.id, { w: v })} />
          <NumField label="Height" value={node.size.h} min={1} onCommit={(v) => setSize(node.id, { h: v })} />
          <NumField label="Depth" value={node.size.d} min={1} onCommit={(v) => setSize(node.id, { d: v })} />
          <NumField label="X" value={node.position[0]} onCommit={(v) => setPosition(node.id, { x: v })} />
          <NumField label="Elevation" value={node.position[1]} min={0} onCommit={(v) => setPosition(node.id, { y: v })} />
          <NumField label="Z" value={node.position[2]} onCommit={(v) => setPosition(node.id, { z: v })} />
        </Row>
        <div className="grid grid-cols-[1fr_auto] items-end gap-2">
          <NumField label="Rotation" length={false} suffix="°" value={node.rotationY} step={5} onCommit={(v) => setRotation(node.id, v)} />
          <div className="flex gap-1">
            <button className="btn btn-sm" onClick={() => setRotation(node.id, node.rotationY - 90)} title="Rotate -90°" aria-label="Rotate minus 90 degrees">↺ 90</button>
            <button className="btn btn-sm" onClick={() => setRotation(node.id, node.rotationY + 90)} title="Rotate +90°" aria-label="Rotate plus 90 degrees">↻ 90</button>
          </div>
        </div>
      </Section>

      {node.type === 'wardrobe' && <WardrobeEditor node={node} />}
      {node.type === 'cabinet' && <CabinetEditor node={node} />}
      {node.type === 'countertop' && <CountertopEditor node={node} />}
      {node.type === 'appliance' && <ApplianceEditor node={node} />}
      {node.type === 'tv_panel' && <TvEditor node={node} />}
      {node.type === 'box' && <BoxEditor node={node} />}
      {node.type === 'group' && (
        <Section title="Group">
          <p className="text-xs text-mute">Moving or rotating the group moves all of its members together.</p>
          <button className="btn btn-sm" onClick={() => ungroupSelected()}>Ungroup</button>
          <span className="hidden">{descendants(doc, [node.id]).length}</span>
        </Section>
      )}

      {slots.length > 0 && (
        <Section title="Materials">
          <div className="space-y-1.5">
            {slots.map(({ slot, label }) => (
              <div key={slot} className="grid grid-cols-[96px_1fr] items-center gap-2 text-xs">
                {label}
                <MaterialPicker value={node.materials[slot] ?? null} inheritLabel={`Project: ${resolved(slot)}`} onChange={(m) => setSlotMaterial([node.id], slot, m)} onClear={() => setSlotMaterial([node.id], slot, null)} />
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Notes & library" defaultOpen={false}>
        <textarea className="input" rows={2} placeholder="Production note for this component" value={node.notes ?? ''} maxLength={2000} onChange={(e) => patchNode(node.id, (n) => ({ ...n, notes: e.target.value }), { key: `note:${node.id}`, placement: false })} />
        <button className="btn btn-sm" disabled={saving} onClick={saveToLibrary}>{saving ? 'Saving…' : 'Save to my component library'}</button>
      </Section>
    </div>
  );
}

export { Select };
