'use client';
import { SAMPLE_HARDWARE } from '@/lib/catalog';
import { makeSection, resolveSectionWidths, sectionHeight, uid } from '@/lib/build/wardrobe';
import type { DoorCfg, SceneNode, SectionCfg, WardrobeParams } from '@/lib/types';
import { useEditor } from '@/store/editor';
import { Hint, NumField, Row, Section, Select, Toggle } from './fields';
import { MaterialPicker } from './MaterialPicker';

const hw = (cat: string) => SAMPLE_HARDWARE.filter((h) => h.category === cat).map((h) => ({ value: h.code, label: h.name }));
const SECTION_KINDS: { value: SectionCfg['kind']; label: string }[] = [
  { value: 'hanging_long', label: 'Long hanging' },
  { value: 'hanging_short', label: 'Short hanging + drawers' },
  { value: 'shelves', label: 'Shelves' },
  { value: 'drawers', label: 'Drawers + shelves' },
  { value: 'shoe', label: 'Shoe rack' },
  { value: 'open_niche', label: 'Open display niche' },
  { value: 'custom', label: 'Custom (empty)' },
];

export function WardrobeEditor({ node }: { node: SceneNode }) {
  const p = node.params as unknown as WardrobeParams;
  const patch = useEditor((s) => s.patchParams);
  const sel = useEditor((s) => s.sel);
  const selectSub = useEditor((s) => s.selectSub);
  const setAllOpen = useEditor((s) => s.setAllOpen);
  const toggleOpen = useEditor((s) => s.toggleOpen);
  const issues = useEditor((s) => s.issues[node.id]) ?? [];
  const Hs = sectionHeight(node.size.h, p);
  const side = p.sidePanels ? p.thickness : 0;
  const widths = resolveSectionWidths(p.sections, node.size.w - 2 * side, p.thickness).widths;
  const secIdx = sel.sub?.kind === 'section' && sel.sub.index < p.sections.length ? sel.sub.index : -1;
  const sec = secIdx >= 0 ? p.sections[secIdx] : null;
  const setP = (x: Partial<WardrobeParams>, key?: string) => patch(node.id, x as Record<string, unknown>, key);

  const setSections = (sections: SectionCfg[]) => setP({ sections });
  const updateSec = (i: number, fn: (s: SectionCfg) => SectionCfg, key?: string) => setP({ sections: p.sections.map((s, k) => (k === i ? fn(s) : s)) }, key ?? `sec:${node.id}:${i}`);

  const setDoorCount = (n: number) => {
    if (!Number.isInteger(n)) return false;
    const doors: DoorCfg[] = Array.from({ length: n }, (_, i) => p.doors[i] ?? { type: 'solid' });
    return setP({ doorCount: n, doors });
  };
  const setDoor = (i: number, d: Partial<DoorCfg>) => setP({ doors: p.doors.map((x, k) => (k === i ? { ...x, ...d } : x)) });

  const addSection = (dupOf?: number) => {
    const base = dupOf != null ? { ...structuredClone(p.sections[dupOf]), id: uid('sec') } : makeSection('shelves', Hs);
    const at = dupOf != null ? dupOf + 1 : p.sections.length;
    const next = [...p.sections.slice(0, at), { ...base, width: null }, ...p.sections.slice(at)];
    // keep fixed widths valid: when adding, free all widths so space is shared
    if (setSections(next.map((s) => ({ ...s, width: null })))) selectSub({ kind: 'section', index: at });
  };
  const removeSection = (i: number) => {
    if (p.sections.length <= 1) return useEditor.getState().toast('warning', 'A wardrobe needs at least one section.');
    if (setSections(p.sections.filter((_, k) => k !== i).map((s) => ({ ...s, width: null })))) selectSub(null);
  };
  const moveSection = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= p.sections.length) return;
    const a = [...p.sections];
    [a[i], a[j]] = [a[j], a[i]];
    if (setSections(a)) selectSub({ kind: 'section', index: j });
  };

  return (
    <>
      <Section title="Wardrobe configuration">
        <Select label="Shutter style" value={p.style} onChange={(v) => setP({ style: v })} options={[{ value: 'hinged', label: 'Hinged' }, { value: 'sliding', label: 'Sliding' }, { value: 'open', label: 'Open (no doors)' }]} />
        {p.style !== 'open' && <NumField label="Number of doors" length={false} value={p.doorCount} min={1} max={8} step={1} suffix="doors" onCommit={setDoorCount} />}
        <Row cols={2}>
          <Select label="Handle" value={p.handle} onChange={(v) => setP({ handle: v })} options={[{ value: 'bar', label: 'Bar' }, { value: 'knob', label: 'Knob' }, { value: 'profile', label: 'Handleless profile' }, { value: 'none', label: 'None' }]} />
          <Select label="Hinge" value={p.hinge} onChange={(v) => setP({ hinge: v })} options={hw('hinge')} disabled={p.style !== 'hinged'} />
        </Row>
        <Row cols={2}>
          <Select label="Drawer runner" value={p.runner} onChange={(v) => setP({ runner: v })} options={hw('runner')} />
          <Select label="Sliding system" value={p.slidingSystem} onChange={(v) => setP({ slidingSystem: v })} options={hw('sliding').filter((x) => x.value.startsWith('SL-TRACK'))} disabled={p.style !== 'sliding'} />
        </Row>
        <Row cols={2}>
          <button className="btn btn-sm" onClick={() => setAllOpen('door', true, [node.id])}>Open doors</button>
          <button className="btn btn-sm" onClick={() => setAllOpen('door', false, [node.id])}>Close doors</button>
          <button className="btn btn-sm" onClick={() => setAllOpen('drawer', true, [node.id])}>Open drawers</button>
          <button className="btn btn-sm" onClick={() => setAllOpen('drawer', false, [node.id])}>Close drawers</button>
        </Row>
        <p className="text-[11px] text-mute">Tip: double-click a door or drawer in the 3D view to open it.</p>
      </Section>

      <Section title="Construction" defaultOpen={false}>
        <Row cols={2}>
          <NumField label="Board thickness" value={p.thickness} min={12} max={40} onCommit={(v) => setP({ thickness: v })} />
          <NumField label="Back panel" value={p.backThickness} min={3} max={18} onCommit={(v) => setP({ backThickness: v })} />
          <NumField label="Plinth / skirting" value={p.plinthHeight} min={0} max={250} onCommit={(v) => setP({ plinthHeight: v })} />
          <NumField label="Loft height (0 = none)" value={p.loftHeight} min={0} max={900} onCommit={(v) => setP({ loftHeight: v })} />
        </Row>
        <Toggle label="Top panel" checked={p.topPanel} onChange={(v) => setP({ topPanel: v })} />
        <Toggle label="Side panels" checked={p.sidePanels} onChange={(v) => setP({ sidePanels: v })} />
        <Toggle label="Bottom panel" checked={p.bottomPanel} onChange={(v) => setP({ bottomPanel: v })} />
        <Toggle label="Back panel" checked={p.backPanel} onChange={(v) => setP({ backPanel: v })} />
      </Section>

      <Section title="Lighting" defaultOpen={false}>
        <Toggle label="Interior LED strips" checked={p.lighting.enabled} onChange={(v) => setP({ lighting: { ...p.lighting, enabled: v } })} />
        <Toggle label="Door / motion sensor" checked={p.lighting.sensor} disabled={!p.lighting.enabled} onChange={(v) => setP({ lighting: { ...p.lighting, sensor: v } })} />
        <label className="flex items-center justify-between text-[13px]">
          LED colour
          <input type="color" value={p.lighting.color} onChange={(e) => setP({ lighting: { ...p.lighting, color: e.target.value } }, `led:${node.id}`)} className="h-7 w-12 cursor-pointer rounded border border-sand" />
        </label>
      </Section>

      {p.style !== 'open' && (
        <Section title={`Shutters (${p.doorCount})`} defaultOpen={false}>
          {p.doors.slice(0, p.doorCount).map((d, i) => (
            <div key={i} className={`rounded-md border p-2 ${sel.sub?.kind === 'door' && sel.sub.index === i ? 'border-gold bg-gold-soft/20' : 'border-sand'}`}>
              <div className="mb-1 flex items-center justify-between">
                <button className="text-xs font-semibold" onClick={() => selectSub({ kind: 'door', index: i })}>Door {i + 1}</button>
                <button className="btn btn-sm btn-ghost" onClick={() => toggleOpen(node.id, `door-${i}`)}>Open / close</button>
              </div>
              <Row cols={2}>
                <Select value={d.type} onChange={(v) => setDoor(i, { type: v })} options={[{ value: 'solid', label: 'Solid' }, { value: 'mirror', label: 'Mirror' }, { value: 'glass', label: 'Glass' }, { value: 'none', label: 'Open niche' }]} />
                <MaterialPicker value={d.material ?? null} inheritLabel="Shutter default" onChange={(m) => setDoor(i, { material: m })} onClear={() => setDoor(i, { material: undefined })} />
              </Row>
            </div>
          ))}
        </Section>
      )}

      <Section
        title={`Sections (${p.sections.length})`}
        right={<button className="btn btn-sm" onClick={() => addSection()}>+ Add</button>}
      >
        <ul className="space-y-1">
          {p.sections.map((s, i) => (
            <li key={s.id}>
              <div className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${i === secIdx ? 'border-gold bg-gold-soft/30' : 'border-sand hover:bg-linen'}`}>
                <button className="min-w-0 flex-1 truncate text-left" onClick={() => selectSub({ kind: 'section', index: i })}>
                  <b>{i + 1}.</b> {SECTION_KINDS.find((k) => k.value === s.kind)?.label} · {Math.round(widths[i] ?? 0)} mm{s.width == null ? ' (auto)' : ''}
                </button>
                <button className="px-1 text-mute hover:text-ink" title="Move left" onClick={() => moveSection(i, -1)}>◀</button>
                <button className="px-1 text-mute hover:text-ink" title="Move right" onClick={() => moveSection(i, 1)}>▶</button>
                <button className="px-1 text-mute hover:text-ink" title="Duplicate section" onClick={() => addSection(i)}>⧉</button>
                <button className="px-1 text-danger" title="Remove section" onClick={() => removeSection(i)}>✕</button>
              </div>
            </li>
          ))}
        </ul>
        {sec && secIdx >= 0 && (
          <div className="space-y-2.5 rounded-md border border-gold/50 bg-gold-soft/10 p-2.5">
            <div className="text-xs font-bold uppercase tracking-wide text-wood">Section {secIdx + 1} - interior {Math.round(Hs)} mm high</div>
            <Select label="Layout preset" value={sec.kind} options={SECTION_KINDS} onChange={(k) => updateSec(secIdx, (s) => ({ ...makeSection(k, Hs, s.width), id: s.id }))} />
            <Row cols={2}>
              <Toggle label="Auto width" checked={sec.width == null} onChange={(a) => updateSec(secIdx, (s) => ({ ...s, width: a ? null : Math.round(widths[secIdx]) }))} />
              <NumField label="Width" value={sec.width ?? widths[secIdx] ?? 0} disabled={sec.width == null} min={150} onCommit={(v) => { updateSec(secIdx, (s) => ({ ...s, width: v })); return true; }} />
            </Row>
            <Toggle label="Hanging rod" checked={sec.rod != null} onChange={(on) => updateSec(secIdx, (s) => ({ ...s, rod: on ? 60 : null }))} />
            {sec.rod != null && <NumField label="Rod drop from top" value={sec.rod} min={30} onCommit={(v) => { updateSec(secIdx, (s) => ({ ...s, rod: v })); }} />}
            <Toggle label="Accessory tray (top)" checked={sec.tray} onChange={(v) => updateSec(secIdx, (s) => ({ ...s, tray: v }))} />

            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="label !mb-0">Shelf heights (from floor)</span>
                <div className="flex gap-1">
                  <button className="btn btn-sm" onClick={() => updateSec(secIdx, (s) => ({ ...s, shelves: [...s.shelves, Math.min(Hs - p.thickness - 40, (Math.max(0, ...s.shelves) || 0) + 350)] }))}>+ Shelf</button>
                  <button
                    className="btn btn-sm"
                    title="Re-space the current number of shelves evenly"
                    onClick={() => updateSec(secIdx, (s) => ({ ...s, shelves: s.shelves.length ? s.shelves.map((_, k) => Math.round(((Hs - p.thickness) / (s.shelves.length + 1)) * (k + 1))) : s.shelves }))}
                  >
                    Even spacing
                  </button>
                </div>
              </div>
              {sec.shelves.length === 0 && <p className="text-xs text-mute">No shelves.</p>}
              <ul className="space-y-1">
                {sec.shelves.map((y, k) => (
                  <li key={k} className="flex items-center gap-1.5">
                    <span className="w-5 text-right text-[11px] text-mute">{k + 1}</span>
                    <div className="flex-1"><NumField compact value={y} min={0} onCommit={(v) => { updateSec(secIdx, (s) => ({ ...s, shelves: s.shelves.map((z, m) => (m === k ? v : z)) })); }} /></div>
                    <button className="px-1 text-danger" aria-label={`Remove shelf ${k + 1}`} onClick={() => updateSec(secIdx, (s) => ({ ...s, shelves: s.shelves.filter((_, m) => m !== k) }))}>✕</button>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="label !mb-0">Drawer fronts (bottom → up)</span>
                <button className="btn btn-sm" onClick={() => updateSec(secIdx, (s) => ({ ...s, drawers: [...s.drawers, 200] }))}>+ Drawer</button>
              </div>
              {sec.drawers.length === 0 && <p className="text-xs text-mute">No drawers.</p>}
              <ul className="space-y-1">
                {sec.drawers.map((h, k) => (
                  <li key={k} className="flex items-center gap-1.5">
                    <span className="w-5 text-right text-[11px] text-mute">{k + 1}</span>
                    <div className="flex-1"><NumField compact value={h} min={80} onCommit={(v) => { updateSec(secIdx, (s) => ({ ...s, drawers: s.drawers.map((z, m) => (m === k ? v : z)) })); }} /></div>
                    <button className="btn btn-sm btn-ghost" onClick={() => toggleOpen(node.id, `drawer-${secIdx}-${k}`)}>Open</button>
                    <button className="px-1 text-danger" aria-label={`Remove drawer ${k + 1}`} onClick={() => updateSec(secIdx, (s) => ({ ...s, drawers: s.drawers.filter((_, m) => m !== k) }))}>✕</button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {!sec && <Hint>Select a section here or click inside the open wardrobe to edit its shelves, rod and drawers independently.</Hint>}
      </Section>
      {issues.length > 0 && (
        <div className="space-y-1 px-3 pb-3">
          {issues.map((i, k) => <Hint key={k} tone={i.level === 'error' ? 'error' : 'warn'}>{i.message}</Hint>)}
        </div>
      )}
    </>
  );
}
