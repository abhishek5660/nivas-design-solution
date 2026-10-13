import type { ToolId } from '@/lib/plan/toolHost';
import type { PlanModel } from '@/lib/plan/types';
import { saveNow } from '@/store/save';
import * as A from '@/store/planActions';
import { activateTool, planEngine, setPlan } from '@/store/planHost';
import { usePlanUi, type PanelId, type RibbonTab } from '@/store/planUi';
import { useEditor } from '@/store/editor';

export interface RibbonItem {
  id: string;
  label: string;
  /** short symbol drawn in the button */
  glyph: string;
  title?: string;
  tool?: ToolId;
  run?: () => void;
  panel?: PanelId;
  /** toggle state */
  on?: (p: PlanModel) => boolean;
  menu?: { label: string; run: () => void; on?: (p: PlanModel) => boolean }[];
  /** shown disabled with this explanation */
  unsupported?: string;
}

export interface RibbonGroup {
  label: string;
  items: RibbonItem[];
}

const t = (id: ToolId, label: string, glyph: string, title?: string): RibbonItem => ({ id, tool: id, label, glyph, title });
const panel = (id: PanelId, label: string, glyph: string, title?: string): RibbonItem => ({ id: `panel-${id}`, label, glyph, panel: id, title });
const act = (id: string, label: string, glyph: string, run: () => void, title?: string): RibbonItem => ({ id, label, glyph, run, title });
const toggleSetting = (fn: (s: PlanModel['settings']) => PlanModel['settings']) => () => setPlan((p) => ({ ...p, settings: fn(p.settings) }), 'toggle-setting');
const ui = () => usePlanUi.getState();

const alignMenu = [
  { label: 'Align left edges', run: () => A.alignSelection('left') },
  { label: 'Align centres horizontally', run: () => A.alignSelection('center') },
  { label: 'Align right edges', run: () => A.alignSelection('right') },
  { label: 'Align top edges', run: () => A.alignSelection('top') },
  { label: 'Align centres vertically', run: () => A.alignSelection('middle') },
  { label: 'Align bottom edges', run: () => A.alignSelection('bottom') },
  { label: 'Distribute horizontally', run: () => A.alignSelection('distribute-x') },
  { label: 'Distribute vertically', run: () => A.alignSelection('distribute-y') },
];

export const RIBBON: Record<RibbonTab, RibbonGroup[]> = {
  home: [
    {
      label: 'History',
      items: [act('undo', 'Undo', '↶', () => (useEditor.getState().past.length ? A.undo() : ui().say('Nothing to undo.')), 'Undo (Ctrl+Z)'), act('redo', 'Redo', '↷', () => (useEditor.getState().future.length ? A.redo() : ui().say('Nothing to redo.')), 'Redo (Ctrl+Y)'), act('save', 'Save', '💾', () => { ui().say('Saving…'); void saveNow({ manual: true }).then((ok) => ok && ui().say('Project saved.')); }, 'Save now (Ctrl+S)')],
    },
    {
      label: 'Select',
      items: [
        t('select', 'Select', '⌖', 'Select (V / Esc)'),
        t('pan', 'Pan', '✥', 'Pan (hold Space or middle mouse)'),
        act('selall', 'Select all', '▣', () => { planEngine.selectAll(); ui().say(ui().selection.length ? `${ui().selection.length} objects selected.` : 'Nothing to select yet.'); }, 'Select all (Ctrl+A)'),
        act('group', 'Group', '⊞', A.groupSelection, 'Group the selected objects'),
        act('ungroup', 'Ungroup', '⊟', A.ungroupSelection),
      ],
    },
    {
      label: 'Clipboard',
      items: [
        act('copyc', 'Copy', '⎘', () => planEngine.copySelection(), 'Copy to clipboard (Ctrl+C)'),
        act('paste', 'Paste', '📋', () => planEngine.paste(), 'Paste (Ctrl+V)'),
        act('delete', 'Delete', '🗑', () => { const n = planEngine.deleteSelection(); if (!n) ui().say('Select an object first.', 'warn'); }, 'Delete (Del)'),
      ],
    },
    {
      label: 'Modify',
      items: [t('move', 'Move', '✛'), t('rotate', 'Rotate', '↻'), t('copy', 'Copy tool', '⧉', 'Copy with a base point'), t('mirror', 'Mirror', '⇋'), t('scale', 'Scale', '⤢'), { id: 'align', label: 'Align', glyph: '⫢', menu: alignMenu }],
    },
    {
      label: 'Object state',
      items: [act('lock', 'Lock', '🔒', () => A.lockSelection(true)), act('unlock', 'Unlock', '🔓', () => A.lockSelection(false)), act('hide', 'Hide', '◌', A.hideSelection), act('showall', 'Show all', '◉', A.showAll)],
    },
  ],

  view: [
    {
      label: 'Navigate',
      items: [
        t('pan', 'Pan', '✥'),
        act('zin', 'Zoom in', '＋', () => A.zoom('in'), 'Zoom in (+ / scroll)'),
        act('zout', 'Zoom out', '－', () => A.zoom('out'), 'Zoom out (- / scroll)'),
        act('zfit', 'Fit all', '⛶', () => A.zoom('fit'), 'Zoom to everything (Shift+Z)'),
        act('zsel', 'Zoom selection', '⌕', () => A.zoom('selection'), 'Zoom to selection (Shift+X)'),
      ],
    },
    {
      label: 'Selection',
      items: [
        { id: 'sel-auto', label: 'Auto box', glyph: '⬚', run: () => setPlan((p) => ({ ...p, settings: { ...p.settings, selection: { mode: 'auto' } } }), 'sel'), on: (p) => p.settings.selection.mode === 'auto', title: 'Drag right = window, drag left = crossing' },
        { id: 'sel-window', label: 'Window', glyph: '▢', run: () => setPlan((p) => ({ ...p, settings: { ...p.settings, selection: { mode: 'window' } } }), 'sel'), on: (p) => p.settings.selection.mode === 'window', title: 'Select objects fully inside the box' },
        { id: 'sel-cross', label: 'Crossing', glyph: '⬓', run: () => setPlan((p) => ({ ...p, settings: { ...p.settings, selection: { mode: 'crossing' } } }), 'sel'), on: (p) => p.settings.selection.mode === 'crossing', title: 'Select objects touched by the box' },
        { id: 'sel-face', label: 'Face', glyph: '◧', unsupported: 'Face selection is not available: objects are selected as a whole.' },
        { id: 'sel-edge', label: 'Edge', glyph: '⟋', unsupported: 'Edge selection is not available: use grips to edit wall and line ends.' },
      ],
    },
    {
      label: 'Visibility',
      items: [
        { id: 'lockdesign', label: 'Lock design', glyph: '🔒', run: () => setPlan((p) => ({ ...p, locked: !p.locked }), 'lock-design'), on: (p) => p.locked, title: 'Prevents every edit until unlocked' },
        { id: 'refs', label: 'References', glyph: '🖼', run: toggleSetting((s) => ({ ...s, showReferences: !s.showReferences })), on: (p) => p.settings.showReferences, title: 'Show or hide reference images' },
        { id: 'exlight', label: 'Existing light', glyph: '💡', run: toggleSetting((s) => ({ ...s, showLights: !s.showLights })), on: (p) => p.settings.showLights, title: 'Show or hide lights in the plan and 3D view' },
        act('isolate', 'Isolate', '◎', A.isolateSelection, 'Show only the selected objects'),
        act('unhide', 'Unhide', '◉', A.showAll, 'Show everything again'),
        { id: 'xray', label: 'X-ray', glyph: '◫', run: toggleSetting((s) => ({ ...s, xray: !s.xray })), on: (p) => p.settings.xray, title: 'See through walls (plan and 3D)' },
      ],
    },
    {
      label: 'Floors shown in 3D',
      items: [
        { id: 'fl-up', label: 'Up to this floor', glyph: '▤', run: () => ui().setFlag('floorMode', 'upTo'), on: () => ui().floorMode === 'upTo' },
        { id: 'fl-all', label: 'All floors', glyph: '▥', run: () => ui().setFlag('floorMode', 'all'), on: () => ui().floorMode === 'all' },
        { id: 'fl-one', label: 'This floor only', glyph: '▭', run: () => ui().setFlag('floorMode', 'active'), on: () => ui().floorMode === 'active' },
      ],
    },
    {
      label: 'Views',
      items: [act('setview', 'Set view', '📷', () => A.saveView(), 'Save the current camera/zoom as a named view'), act('thumb', 'Set thumbnail', '🖼', () => { ui().say('Capturing the thumbnail…'); void A.setThumbnail(); }, 'Use the current view as the project thumbnail'), panel('views', 'Saved views', '☰')],
    },
  ],

  insert: [
    {
      label: 'Furniture',
      items: [{ id: 'furnish', label: 'Furnish', glyph: '🛋', run: () => { activateTool('furnish'); if (ui().panel !== 'furnish') ui().setPanel('furnish'); }, title: 'Open the furniture & cabinet library' }],
    },
    {
      label: 'Lighting',
      items: [t('light', 'Light', '💡'), t('strip', 'Strip light', '▬')],
    },
    {
      label: 'Import',
      items: [act('import3d', '3D Import', '📦', () => void A.importModel(), 'Import a .glb 3D model'), act('addref', 'Add Ref.', '🖼', () => void A.addReference(), 'Add an image as a tracing reference')],
    },
    { label: 'Reuse', items: [t('component', 'Component', '❖', 'Insert a saved component')] },
  ],

  draw: [
    {
      label: 'Lines',
      items: [t('line', 'Line', '／'), t('polyline', 'Polyline', '⌇'), t('guide', 'Construction line', '┄'), panel('grid', 'Grid', '▦', 'Grid and snap settings')],
    },
    {
      label: 'Shapes',
      items: [t('arc', '3-Point Arc', '◠'), t('circle', 'Circle', '◯'), t('rect', 'Rectangle', '▭'), t('polygon', 'Polygon', '⬠'), t('arrow', 'Arrow', '➜'), t('hatch', 'Hatch', '▨')],
    },
    {
      label: 'Modify',
      items: [t('trim', 'Trim', '✂'), t('extend', 'Extend', '⇥'), t('mirror', 'Mirror', '⇋'), t('copy', 'Copy', '⧉'), t('move', 'Move', '✛'), t('rotate', 'Rotate', '↻'), t('scale', 'Scale', '⤢'), t('offset', 'Offset', '⫽'), t('fillet', 'Fillet', '⌐')],
    },
    {
      label: 'Components',
      items: [t('component', 'Component', '❖', 'Insert a component'), act('mkcomp', 'Make component', '➕', () => void makeComponent(), 'Save the selection as a reusable component')],
    },
  ],

  architecture: [
    {
      label: 'Plan',
      items: [panel('aifloor', 'Floor plan wizard', '✦', 'Create rooms from dimensions (no AI)'), t('wall', 'Wall', '▮'), t('door', 'Door', '🚪'), t('window', 'Window', '▥')],
    },
    {
      label: 'Surfaces',
      items: [t('ceiling', 'Ceiling', '▔'), t('tiling', 'Tiling', '▦'), t('slab', 'Slab', '▬')],
    },
    {
      label: 'Structure',
      items: [t('stairs', 'Stairs', '⊿'), t('column', 'Column', '◼'), t('railing', 'Railing', '⫴'), t('beam', 'Beam', '═'), t('roof', 'Roof', '⌂')],
    },
    {
      label: 'Edit',
      items: [t('attach', 'Attach wall', '⊢', 'Join two walls'), t('trim', 'Trim', '✂'), t('extend', 'Extend', '⇥'), t('dimension', 'Dimension', '↔'), t('measure', 'Measure', '📏'), { id: 'zoom', label: 'Zoom', glyph: '⌕', menu: [{ label: 'Zoom in', run: () => A.zoom('in') }, { label: 'Zoom out', run: () => A.zoom('out') }, { label: 'Fit all', run: () => A.zoom('fit') }, { label: 'Zoom to selection', run: () => A.zoom('selection') }] }],
    },
  ],

  annotate: [
    {
      label: 'Text',
      items: [t('text', 'Text', 'T'), t('leader', 'MultiLeader', '↗'), t('compass', 'Compass', '✺')],
    },
    {
      label: 'Dimensions',
      items: [t('dimension', 'Dimension', '↔'), t('angle', 'Angle', '∠'), t('radial', 'Radial', '⌀'), t('xy', 'XY coordinate', '⊹'), t('measure', 'Measure', '📏')],
    },
    { label: 'Arrange', items: [{ id: 'align', label: 'Align', glyph: '⫢', menu: alignMenu }] },
  ],

  render: [
    {
      label: 'Render',
      items: [
        { id: 'render', label: 'Render', glyph: '🎬', run: () => openRender(), title: 'Render an image of the 3D view' },
        { id: 'render3d', label: '3D Render', glyph: '🧊', run: () => { ui().setViewMode('3d'); ui().say('3D view opened. Use Render for a high-quality still.'); } },
        panel('gallery', 'Gallery', '🗂'),
      ],
    },
    {
      label: 'Output',
      items: [
        {
          id: 'export',
          label: 'Export',
          glyph: '⭳',
          menu: [
            { label: 'Image (PNG) of this view', run: () => void A.exportPlan('png') },
            { label: 'PDF (A3) of this view', run: () => void A.exportPlan('pdf') },
            { label: 'DXF (CAD) of this floor', run: () => void A.exportPlan('dxf') },
            { label: 'Project data (JSON)', run: () => void A.exportPlan('json') },
          ],
        },
        act('shot', 'Screenshot', '📸', () => { ui().say('Capturing screenshot…'); void A.screenshot(true); }, 'Download the view and add it to the gallery'),
      ],
    },
    { label: 'Lighting', items: [panel('extralight', 'Extra lighting', '☀', 'Brightness of plan lights')] },
  ],

  outputs: [
    {
      label: 'Project',
      items: [panel('prefs', 'Preferences', '⚙'), panel('branch', 'Branch', '⑂', 'Design variants'), panel('presentation', 'Presentation(s)', '▶'), panel('settings', 'Settings', '☰')],
    },
    {
      label: 'Automatic tools',
      items: [
        {
          id: 'auto',
          label: 'Automatic tools',
          glyph: '⚡',
          menu: [
            { label: 'Dimension all walls', run: () => A.runAuto('dimensions') },
            { label: 'Label rooms (name + area)', run: () => A.runAuto('labels') },
            { label: 'Join nearly-touching walls', run: () => A.runAuto('heal') },
            { label: 'Remove duplicate walls', run: () => A.runAuto('dupes') },
          ],
        },
      ],
    },
    {
      label: 'Quality & cost',
      items: [panel('pricing', 'Pricing', '₹'), panel('qc', 'QC', '✔', 'Design quality checks'), panel('violations', 'Violations', '⚠', 'Errors that must be fixed')],
    },
    {
      label: 'Schedules',
      items: [panel('raw', 'Raw materials', '▤'), panel('boq', 'BOQ schedule', '☷'), panel('schedule', 'Work schedule', '🗓'), panel('cache', 'Cache', '🗄')],
    },
    {
      label: 'Production',
      items: [act('production', 'Production design', '🏭', () => useEditor.getState().setUi({ tab: 'production' }), 'Cut lists, nesting and machine files for the cabinetry')],
    },
  ],
};

export const TAB_LABEL: Record<RibbonTab, string> = { home: 'Home', view: 'View', insert: 'Insert', draw: 'Draw', architecture: 'Architecture', annotate: 'Annotate', render: 'Render', outputs: 'Outputs' };

function openRender() {
  const u = ui();
  if (u.viewMode === '2d') u.setViewMode('3d');
  if (usePlanUi.getState().panel !== 'render') u.setPanel('render');
}

async function makeComponent() {
  const { planHost } = await import('@/store/planHost');
  const { createComponent } = await import('@/lib/plan/ops');
  const ids = planHost.selection().filter((i) => planHost.floor().entities[i]);
  if (!ids.length) return ui().say('Select the objects that make up the component first.', 'warn');
  const name = await planHost.prompt('Component name', 'Component');
  if (!name) return;
  const f = planHost.floor();
  const { entityBounds } = await import('@/lib/plan/entities');
  const boxes = ids.map((i) => entityBounds(f, f.entities[i])).filter((b): b is NonNullable<typeof b> => !!b);
  const base: [number, number] = boxes.length ? [Math.min(...boxes.map((b) => b.minX)), Math.min(...boxes.map((b) => b.minY))] : [0, 0];
  const r = createComponent(f, ids, base, name);
  if (!r.ok) return ui().say(r.error, 'warn');
  planHost.addComponent(r.value);
  ui().say(`Component “${name}” saved. Insert it with Draw → Component.`);
}
