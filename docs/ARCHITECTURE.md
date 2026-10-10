# Architecture

## Principle: one model, many outputs

```
                        ┌──────────────────────────┐
  Inspector / drag  ──▶ │  SceneDoc (JSON, mm)     │ ──▶ validateDoc() ──▶ PostgreSQL (Project.data, Revision.data)
  Library / import      │  nodes + params + room   │
                        └────────────┬─────────────┘
                                     │ buildParts(node)  (pure functions, memoised per node object)
                                     ▼
                              Part[]  (boxes/cylinders: size, centre, material slot, sheet flag,
                                       edge banding, hardware, animation, ops)
              ┌──────────────┬───────┴────────┬──────────────────┬───────────────────┐
              ▼              ▼                ▼                  ▼                   ▼
        3D view (R3F)   2D drawings       BOQ / pricing     Cut list + nesting   Exports (CSV/PDF/SVG/DXF/JSON)
```

Every document is derived from the same `Part[]`, so a dimension change in the inspector changes the 3D geometry, the drawing, the BOQ quantities and the cut list at once. There is no separately maintained "drawing model".

## Domain model (`src/lib/types.ts`)

* **Units**: millimetres everywhere; degrees about Y for rotation. cm/inch are display conversions only (`store/prefs.ts`).
* **Coordinates**: X east, Y up, Z south. A node's origin is the centre of its footprint at the bottom; its front faces +Z. Rooms are floor polygons (X,Z) with outward-extruded walls.
* **SceneNode**: `id, type, name, parentId, position, rotationY, size{w,h,d}, materials (slot → material id), subMaterials (section/door/drawer overrides), visible, locked, params (typed per node type), notes`.
* **Parametric generators** (`src/lib/build`): `wardrobe`, `cabinet` (9 variants), `countertop`, `appliance` (8 kinds), `tv_panel`, `box`, `model` (imported GLB). Each exports `default…`, `validate…`, `build…`.
* **Constraints** live next to the generators (`validate*`): dimension ranges, section widths vs interior width, shelf spacing, drawer stack height, door width limits, TV fit, etc. They return `Issue[]` (errors reject the change with an explicit message; warnings are shown but allowed). `validateNode` is also run on save, import and load (`schema.ts`).
* **Resize rules** (`resizeNode`): wardrobe resizing rescales fixed section widths and shelf heights so dependent components stay valid; TV panels keep the unit width in step.
* **Construction rules** are parameters, not magic numbers: board thickness, back-panel thickness, plinth, gaps, wall clearance, runner lengths (`runnerFor`), hinge count by door height (`hingesForHeight`), edge-banding presets (`front`/`all`), sheet-size splitting of back/wall panels (`splitEven`).

## Editor state (`src/store/editor.ts`)

Zustand store holding the document, selection (+ sub-selection: section/door/drawer), undo/redo stacks (120 entries, coalescing for repeated edits of the same field), clipboard, UI flags and transient door/drawer openness.

* Gestures (drag, rotate, resize, nudge) use `beginTx → preview → endTx`: the live view updates every frame without touching history; on release the change is validated (dimension constraints + overlap/placement rules) and either committed as one undo step or **reverted with a message**.
* `patchNode` is the single edit path for numeric/inspector edits; it validates before applying and surfaces the first error as a toast and inline message.
* Grouping uses `parentId`; transforms propagate to descendants.

## Persistence & reliability (`src/store/save.ts`, `src/app/api/projects/[id]`)

* Debounced autosave (1.5 s) plus manual save (Ctrl+S) → `PUT /api/projects/:id` with `baseVersion`.
* The server validates the whole document (`validateDoc`: schema, id/order consistency, per-node constraints, asset/material references), enforces optimistic concurrency (`409` on stale versions) and only then commits.
* The UI shows **Saved** only after the server confirms *and* nothing changed meanwhile. Failures keep the status dirty/error, keep a `localStorage` draft, retry with exponential back-off, and offer a manual retry. On reopening, a newer local draft is offered for recovery.
* Manual saves also create named **revisions** (last 60 kept); restore writes a *new* version, history is never rewritten.

## 3D layer (`src/components/editor`, `src/lib/three`)

* React Three Fiber scene in **metres** (`<group scale=0.001>` around millimetre geometry).
* Static parts of a node are merged per material into one geometry (fewer draw calls) with a triangle-range table so clicks on a merged mesh still resolve to the section/door/drawer that was hit. Animated parts (hinged/sliding doors, drawers) and exploded view are individual meshes driven in `useFrame` from the store's `openTargets`.
* Procedural PBR textures (wood, marble, stone, fluted, slats, metal, fabric) are generated on canvases; uploaded images are supported. UVs are in real-world tiles with grain along each board's length.
* Lighting: procedural image-based environment (no network assets), directional sun with soft shadows, contact shadows, emissive LEDs with a few real point lights, tone mapping and exposure from the document.
* Interaction: pointer events on node groups; ground-plane ray-casting for moves with wall/neighbour snapping (`snapNode`); axis-line projection for resize handles; angle-around-centre for rotation.
* **On-demand rendering**: the canvas runs with `frameloop="demand"`; a frame is requested when the editor store changes, the camera moves or eases, a door/drawer/explode animation is in progress, or a texture finishes loading. An idle workspace draws no frames.
* Resources: geometry cache is bounded; merged geometries, bounds boxes and textures are disposed on change/unmount.
* **Render** (`lib/three/render.ts`): pauses the live loop, resizes the canvas, renders N jittered passes (sub-pixel camera offset + sun jitter) and averages them; panoramas render six 90° faces and resample to equirectangular. Errors and cancellation are surfaced in the dialog.

## Documents (`src/lib/docs`)

* `resolve.ts`: material resolution (sub-component → component → project default → fallback) and stable cabinet codes (`BC3`, `WD1` …).
* `bom.ts`: aggregates sheet area by material and section, hardware by code, appliances; applies wastage, rate card/overrides, labour, installation, discount, tax with the formulas printed in the UI/PDF. Missing prices are warned and excluded, never invented.
* `cutlist.ts`: one piece per sheet part with unique labels, finished L×W×T, grain, edge-banding flags/length, operations; grouping and material summary; shelf-based first-fit-decreasing **nesting** with kerf and trim.
* `drawing.ts`: projects every part (convex hull of its transformed box) onto plan/elevations, painter-ordered for correct occlusion, adds chained and overall dimensions, labels and room outline; serialises to SVG (constant-pixel strokes) and ASCII DXF R12.
* `export.ts`: CSV and PDF (jsPDF). Server exports are generated from the **saved** database record, so documents always match persisted data.

## Server (`src/app/api`, `src/lib/server`)

* Next.js route handlers wrapped by `handle()` (typed errors → JSON, zod issues → 400, unexpected errors logged and returned as a generic 500, cross-origin state-changing requests rejected).
* Auth: bcrypt password hashes, signed JWT in an `HttpOnly`, `SameSite=Lax` (`Secure` in production) cookie; the user row is re-read on every request so deactivation/role changes apply immediately.
* Authorization is checked per request in `loadProjectFor` (owner / admin / share with VIEW or EDIT) and role checks (`requireDesigner`, `requireAdmin`); Viewers cannot write anywhere.
* Uploads: extension **and** magic-number checks, GLB header length check, 8 MB cap; assets are readable only when signed in or through a valid public-preview token that references them.
* Public preview: unguessable token, revocable, read-only 3D, no prices/documents.

## Extending

* **New furniture type**: add a generator in `src/lib/build/` (`default`, `validate`, `build`), register it in `scene.ts` (`buildParts`, `validateNode`, `makeNode`), add an inspector in `components/editor/`, a library entry in `LeftPanel.tsx`. BOQ, cut list, drawings, exports and 3D rendering work automatically from the generated parts.
* **New construction rule**: add a parameter to the type, use it in the generator and validate it next to the generator.
* **New export**: implement it over `Part[]`/`SceneDoc` in `src/lib/docs` and add a case in `api/projects/[id]/export`.
