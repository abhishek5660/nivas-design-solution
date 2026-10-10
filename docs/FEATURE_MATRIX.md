# Feature completion matrix

Legend: ✅ implemented and verified · 🟡 partial (works, with the stated limits) · ⬜ pending (not built; nothing pretends otherwise in the UI)
"Verified" = covered by an automated test or exercised in a real browser during development (see [QA_REPORT](QA_REPORT.md)).

## 4. Dashboard & project management

| Feature | Status | Notes |
|---|---|---|
| Create / open / duplicate / rename / delete (with confirmation) | ✅ | e2e `projects` |
| Search & filter (text, category, status) | ✅ | |
| Recently edited, thumbnails, customer, status, last-modified | ✅ | Thumbnails are captured from the 3D view on save |
| Room details | 🟡 | Room size at creation + notes; the room itself is a full editable model in the workspace |
| Profile & settings | ✅ | name, password, display units |
| Categories Wardrobe / Kitchen / TV Panel / Custom | ✅ | |
| Persistence of geometry, materials, components, settings | ✅ | integration `persistence`, e2e |

## 5. 3D workspace

| Feature | Status | Notes |
|---|---|---|
| Orbit / pan / zoom, 6 standard views, fit scene/selection, reset, smooth transitions | ✅ | |
| Perspective ⇄ orthographic | ✅ | |
| Selection, highlight, sub-selection (section/door/drawer) | ✅ | e2e |
| Grid, dimension labels, show/hide walls (cut-away), show/hide/lock components | ✅ | |
| Move (drag), rotate (drag tool, ±90°, numeric), resize (handles + numeric) | ✅ | e2e drag test |
| Snap-to-grid, wall snapping, neighbour snapping | ✅ | unit `snapping` |
| Align & distribute, duplicate, delete, copy/paste, group/ungroup | ✅ | |
| Multi-selection | 🟡 | Shift-click and Ctrl+A; no marquee box select |
| Undo/redo (120 steps), save/restore | ✅ | e2e |
| Validation: negative/zero sizes, out-of-range sizes, overlaps | ✅ | unit + e2e (messages shown inline and as toasts) |
| Units mm with cm/in display | ✅ | |
| Rotation of components | 🟡 | About the vertical axis only (furniture does not tilt) |

## 6. Wardrobe designer

| Feature | Status | Notes |
|---|---|---|
| Overall W/H/D, sections (1-10), doors (1-8), hinged / sliding / open | ✅ | Individual door width/height are derived from W, H and door count (not separately editable) |
| Drawers (heights, count), adjustable shelves (heights, even spacing), hanging rods, long/short hanging, shoe rack, accessory tray, partitions | ✅ | |
| Loft storage with lift-up shutters, top/side/bottom/back panels, plinth | ✅ | Back panels split into sheet-sized strips |
| Handles / knobs / handleless profile, hinge & runner & sliding-system selection | ✅ | Hardware drives the BOQ |
| Mirror / glass shutters, open niches | ✅ | Glass has no aluminium frame model |
| LED strips + sensor | 🟡 | Emissive strips with a few real lights; sensor appears as BOM hardware (no simulation) |
| Add / remove / duplicate / reorder sections, per-section width, per-door type & material, per-section material | ✅ | e2e (independent editing) |
| Open/close doors & drawers (global, per item, double-click), inspect interior | ✅ | |
| Save configuration as reusable template | ✅ | Component library (this wardrobe) and whole-design templates |
| Parametric: resize rebalances sections, loft/plinth changes rescale shelves | ✅ | unit |

## 7. Kitchen designer

| Feature | Status | Notes |
|---|---|---|
| Layouts: straight, L, U, parallel, island (fit to room) | ✅ | unit: no overlaps, inside room |
| Room: dimensions, polygon editing (drag corners), L-shaped preset, doors, windows, openings, columns, floor/wall/ceiling finish, ceiling height | ✅ | One wall thickness for all walls |
| Base, wall, tall, drawer, sink cabinets, open shelf, island, breakfast bar | ✅ | |
| Corner cabinet | 🟡 | Square blind-corner box with filler panel; no L-shaped carousel/magic-corner mechanisms |
| Countertop (+ backsplash, thickness, material), auto-fit over runs | ✅ | No cut-outs for hob/sink in the slab |
| Fridge, oven, microwave, hob, chimney, dishwasher, sink + faucet, task lights | ✅ | Dimensions editable to match purchased models |
| Per-cabinet W/H/D, shelves, drawers, door style (flat/shaker/glass/open), hinge side, sliding (wall/tall), handle style & placement, hardware, gaps, wall clearance, materials | ✅ | |
| Drag-and-drop placement from the library, snapping, rotation, collision prevention/warnings | ✅ | |
| Room / cabinet / detail views | ✅ | |

## 8. TV panel designer

| Feature | Status | Notes |
|---|---|---|
| Full-wall panel; fluted, slat, batten, marble-look, stone, plain | ✅ | Slats/battens are real geometry; others are textured |
| Floating / floor-standing unit, drawers, doors, open storage, router compartment, cable opening | ✅ | |
| Side towers (closed / open / niche), wall shelves, soundbar, fireplace insert, backlit panel, display niches | ✅ | |
| LED strips (under unit, halo, niches, shelves) colour & intensity | ✅ | Recessed downlights are not modelled |
| TV size/position, panel & unit dimensions, shelf positions, pattern pitch | ✅ | e2e (fit validation) |
| Drawer/door animation, front/side/perspective views | ✅ | |
| Save custom templates | ✅ | |

## 9. Parametric component system

| Feature | Status | Notes |
|---|---|---|
| IDs, types, parent/child (groups), transform, size, materials, hardware, visibility, manufacturing attributes, parameters | ✅ | |
| Component inspector, create/duplicate/delete/group/ungroup, personal library | ✅ | |
| Dependent recalculation, constraint validation with useful messages | ✅ | |
| Configurable construction rules | 🟡 | Thickness, gaps, clearances, plinth, hinge/runner choices are parameters; no user-defined rule scripting |

## 10. Materials & hardware

| Feature | Status | Notes |
|---|---|---|
| 38 sample materials across all requested categories; searchable/categorised | ✅ | |
| Sample hardware (handles, hinges, runners, sliding, legs, LED, supports) | ✅ | Read-only sample list; no user-defined hardware catalog yet (⬜) |
| Material on individual components / sub-components | ✅ | e2e |
| Colour, roughness, metallic, opacity, texture scale; image upload (validated) | ✅ | integration `assets` |
| Custom presets: create, rename, duplicate, delete; themes | ✅ | |
| Import GLB | ✅ | Validated in browser (parse, triangle limit) and server (signature/header); GLTF with external files not supported |
| Persistence across reopen; sample vs verified distinction | ✅ | Admin can mark custom materials verified |

## 11. Rendering & animation

| Feature | Status | Notes |
|---|---|---|
| PBR, ambient + directional, soft shadows, environment lighting, exposure, tone mapping, presets | ✅ | |
| Reflections | 🟡 | Environment reflections on metal/glass/mirror; no planar mirror reflections |
| Ambient occlusion | 🟡 | Contact shadows only; no SSAO post-process |
| Procedural wood / stone / marble textures, glass, metal | ✅ | |
| Camera transitions, door/drawer animation, exploded view, walkthrough, orbit presentation, before/after | ✅ | Before/after compares a snapshot wipe against the live view |
| Lighting transitions (animated) | ⬜ | Optional in the brief |
| High-resolution PNG/JPEG renders (progressive supersampled, up to 4K, progress + errors) | ✅ | e2e; rasterised, not ray-traced |
| 360° panorama | ✅ | e2e |
| Shareable previews | ✅ | Public read-only link, revocable |
| Video export | ⬜ | No reliable pipeline yet |

## 12. 2D drawings

| Feature | Status | Notes |
|---|---|---|
| Top plan, front/back/left/right elevations, overall + per-unit dimensions, labels, room dims | ✅ | Synced to the model |
| Section views | ⬜ | |
| SVG, DXF (R12 lines/text), PDF | ✅ | DXF has no dimension entities (drawn lines + text) |

## 13. BOQ & pricing

| Feature | Status | Notes |
|---|---|---|
| Items generated from saved components (boards, shutters, stone, glass/mirror, hardware, lighting, appliances) | ✅ | unit: BOQ area = cut-list area |
| Editable unit prices, estimate flag, wastage, labour, installation, discount, tax; transparent formulas | ✅ | Quantities come from the model and are not hand-editable |
| Warnings for missing prices; no invented prices | ✅ | Starter rates are labelled illustrative |
| Quotation PDF, BOQ CSV, hardware CSV | ✅ | `.xlsx` ⬜ (CSV opens in Excel) |
| Admin rate card | ✅ | |

## 14. Production documentation

| Feature | Status | Notes |
|---|---|---|
| Cut list with unique panel labels, L×W×T, grain, edge banding, material summary | ✅ | |
| Hardware list, assembly information, production notes, revision in header | ✅ | |
| Board layout / cutting optimisation | 🟡 | Shelf (guillotine) first-fit heuristic with kerf & trim; not an optimal nester |
| Drilling / routing parameters | 🟡 | Text operations per part (hinge cups, shelf-pin lines, dowel holes); no coordinates |
| Printable label sheets | ⬜ | Labels exist as IDs in lists and layouts |
| Validation of outputs against the design | ✅ | Consistency checks in the Production tab; unit tests |
| PDF + CSV | ✅ | |
| CNC formats | ⬜ | Explicitly not offered |

## 15. Administration & libraries

| Feature | Status | Notes |
|---|---|---|
| Users, roles (Admin/Designer/Viewer), activate/deactivate | ✅ | integration + e2e |
| Project access (owner, share view/edit, admin sees all), status tracking | ✅ | |
| Material / theme / component / template catalogs (share + verify) | ✅ | |
| Pricing rules, application settings (registration switch) | ✅ | |
| Revision history: list, compare (summary diff), restore | ✅ | Diff is a structural summary, not a visual diff |

## 16-18. Reliability, navigation, performance, security

| Feature | Status | Notes |
|---|---|---|
| Manual + debounced autosave, visible status, success only after server confirms | ✅ | e2e failure-injection test |
| Recovery after refresh (local draft), failed-save retry/back-off, conflict detection | ✅ | |
| JSON export/import with validation before modifying anything | ✅ | |
| Loading and empty states, confirmation of destructive actions | ✅ | |
| 14 navigation sections; switching does not lose unsaved work | ✅ | Editor tabs share state; leaving the editor flushes a save and warns on unload |
| Geometry reuse, merged batches, disposal, resize handling, large-model warning | 🟡 | CPU-merged batches rather than GPU instancing |
| Upload validation, server authorization, private data, env-based secrets, CSRF origin check, rate limiting | ✅ | Rate limiter is per-process |
| Error logging | 🟡 | Server errors go to stdout; no external log aggregation |
| Configurable object storage | ⬜ | Uploads are stored in PostgreSQL |
| Responsive layout | 🟡 | Panels become slide-over drawers below 1024 px; the editor is desktop-first and has not been tested on touch devices |
| Accessibility | 🟡 | Labelled controls, keyboard operation of forms/dialogs, focus rings; the 3D canvas itself is not keyboard-navigable except arrow-key nudging of a selection |

## Acceptance tests from the brief (§19)

| # | Requirement | Evidence |
|---|---|---|
| 1 | Create and reopen a project | e2e `projects`, integration `persistence` |
| 2 | Wardrobe from custom dimensions | unit `wardrobe generator`, e2e |
| 3 | Sections, shelves, doors, drawers edited independently | e2e `wardrobe` |
| 4 | Doors and drawers animate | unit (anim groups) + e2e (targets) + visual check |
| 5 | Kitchen with base, wall, countertops, appliances | unit layouts, e2e `kitchen` |
| 6 | TV panel with shelves, storage, finishes, lighting | e2e `TV panel` |
| 7 | Changing a dimension changes real geometry | unit (`top` panel width changes by exactly the delta) |
| 8 | Material change on the correct component | e2e (component slot + per-door override) |
| 9 | Drag, rotate, duplicate, delete | e2e (real mouse drag; Ctrl+D; Delete; undo) |
| 10 | Undo/redo | e2e |
| 11 | Save/reopen preserves dimensions, materials, placement | integration + e2e |
| 12 | 2D drawings reflect the 3D model | unit (dimensions follow resize) + e2e |
| 13 | BOQ from saved components | unit (area equality), e2e/integration exports |
| 14 | Exported documents contain real data | integration `exports`, e2e (CSV/PDF/DXF) |
| 15 | Clear errors for invalid input | unit + e2e (messages asserted) |
| 16 | Save failures do not lose work | e2e failure-injection |
| 17 | Build, test, run with documented commands | README; `npm run build` verified; all suites run |
