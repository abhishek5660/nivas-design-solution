# QA report

Build under test: **NIVAS DESIGN SOLUTION 0.1.0** · Node 22.17 · Next.js 16.4 (Turbopack) · React 19 · three 0.186 · PostgreSQL 17 (embedded) · Windows 11, Chrome (headless, software WebGL via SwiftShader).

## Summary

| Suite | Command | Result |
|---|---|---|
| Type check | `npm run typecheck` | ✅ clean |
| Production build | `npm run build` | ✅ compiles, type-checks and generates all routes (re-run after the floor-plan work) |
| Unit tests | `npm test` | ✅ **130 / 130** (9 files: 59 original + 71 floor-plan) |
| Integration (HTTP + PostgreSQL) | `npm run test:integration` | ✅ **9 / 9** |
| End-to-end (real Chrome, real DB) | `npm run test:e2e` | ✅ **23 / 23** (12 original + 11 floor-plan; ≈ 7 min under software rendering) |
| Fresh-database cold start | `PG_DATA_DIR=… npm run dev` on an empty directory | ✅ initialises PostgreSQL, applies schema, boots the app |
| Migrations | `prisma migrate deploy` on an empty database | ✅ `0001_init` applies cleanly |

## What the tests cover

**Unit (`tests/`)**
* *Geometry & constraints* - every cabinet variant, appliance kind, wardrobe style (hinged / sliding / loft / open) and TV panel produces finite, positive-sized, uniquely identified parts; wardrobe panels stay inside the envelope; changing width changes the real panel geometry by exactly the delta; section widths + partitions fill the interior exactly; impossible fixed widths, negative sizes and TVs that do not fit produce explicit errors; adding a loft rescales shelves instead of invalidating the design.
* *Layouts & placement* - the five kitchen layouts produce ≥ 4 cabinets, stay inside the room and never overlap; wall / neighbour snapping; overlap detection.
* *Documents* - BOQ sheet area equals cut-list area; hardware quantities follow geometry (hinges per door height); totals follow the printed formula; price overrides apply and missing prices warn; empty design does not fabricate a quote; cut-list pieces are unique and ordered L ≥ W ≥ T; nesting never overlaps or leaves the sheet, flags oversize pieces; drawings follow resize; SVG/DXF contain real content; CSV/PDF contain project data; JSON round-trip is lossless; tampered files (negative sizes, missing materials, dangling order) are rejected.
* *Performance budget* - a 120-unit, ≈ 2,800-part scene: geometry 23 ms, BOQ 61 ms, cut list + nesting 94 ms (1,488 pieces, 285 boards), plan drawing 79 ms.

**Integration (`tests/integration`)** - auth lifecycle and duplicate/short-password handling; save → reopen preserves size, material and placement; stale save returns 409; revisions list/restore; duplicate/delete; invalid designs rejected with `422` and not partially saved; exports generated from saved data (CSV, JSON, SVG, unknown type → 400); asset uploads accept only valid PNG/JPG/WEBP/GLB (extension *and* signature), reads need sign-in; catalog privacy and admin share/verify; public preview link enable → anonymous read → revoke → 404; admin role changes, self-demotion blocked, registration switch, deactivation takes effect immediately; cross-origin POST blocked.

**End-to-end (`e2e/`)** - dashboard UI create/rename/duplicate/delete (with confirm); inspector edit → autosave → reload keeps value; undo/redo; invalid width rejected with the exact message; independent section editing; door/drawer open state; material on a component and on a single door persisting across reload; real mouse drag changes stored coordinates, Ctrl+D / Delete / Ctrl+Z; overlap rejected and reverted; kitchen layout → single-cabinet edit → BOQ tab (missing prices flagged) → CSV/PDF/DXF exports contain real data → drawings render; TV panel configuration, TV-fit validation message, manual save, history entry, save-as-template appears in Templates; **failure injection**: a 500 on every save shows "Save failed", keeps the work in memory and `localStorage`, the server keeps the old value, "Retry now" then succeeds; invalid import rejected before touching the project; viewer is read-only and cannot read unshared projects, anonymous gets 401, admin page/API admin-only; a 1280×720 progressive render and a 2048×1024 panorama are produced at exactly the requested size.

**Floor-plan workspace (`tests/plan-*.test.ts`, `e2e/floorplan*.spec.ts`)**
* *Unit (71)* - room detection (rectangles, T-junctions, crossings, L-shapes, net areas); every tool driven by simulated pointer events and typed input (walls, openings with placement rules, arcs, circles, polygons, hatch, trim/extend/fillet/offset/mirror/copy/move/scale, components and instances, slabs, ceilings, tiling, stairs, columns, beams, railings, roofs, lights, dimensions linked to their walls, annotations); undo grouping of multi-step actions; 2D → 3D descriptors (wall holes, tile counts, stair heights, roof geometry); BOQ / raw materials / QC / schedule computed from geometry and never inventing prices; floors, buildings, duplicate floor with re-linked openings, align/distribute, automatic tools, branches (variants restored exactly), wizard layout, classic room → plan (clear interior preserved), DXF and printable floor sheet (+ PDF); rotate tool (typed angle and 3-click reference); performance budget on a 12 × 12 room grid (312 wall pieces, 144 rooms: normalise 6 ms, rooms 13-19 ms, 3D descriptors ≈ 65 ms, BOQ + QC ≈ 75 ms, printable sheet ≈ 90 ms).
* *E2E (11)* - draw a room with the real mouse, add door/window/furniture, undo/redo, 3D, save, reload; every Draw/edit tool through the canvas (shapes, box select, move, copy, mirror, delete, undo); typed numeric input and property editing; floors; branches; wizard + QC locate + pricing; DXF download, drawings PDF and floor-plan SVG; classic → floor-plan conversion; design modes and design lock; 3D import (valid GLB) and reference image upload; and a sweep that clicks **every ribbon button** (≈ 110, including tools that appear on more than one tab) and fails if one does nothing visible or if an unavailable one does not say so.

## Defects found and fixed during QA

| # | Defect | How found | Fix |
|---|---|---|---|
| 1 | drei `<Html>` dimension labels crashed React ("removeChild") when selection changed | Real browser console | Replaced with canvas-texture sprites (no DOM portals in the canvas) |
| 2 | Kitchen generator: hob/sink consumed run width twice and sinks widened past their slot → overlaps; wall-normal sign wrong so nothing snapped | Unit tests | Rewrote run fitting; fixed polygon orientation |
| 3 | Kitchen generator pushed countertop nodes twice (duplicate ids in `order`) | Round-trip import test | Single insert |
| 4 | Back/wall panels larger than a board could not be nested | Nesting test | Panels are cut in sheet-sized strips |
| 5 | Drawer cabinets failed validation because proportional heights equalled the front height | Unit tests | Validate scaled heights |
| 6 | Pressing Enter in any dialog field closed the dialog (dialog re-focused its close button each render) | e2e render test | Focus once on open, stable close handler |
| 7 | Adding a loft made existing shelves "outside the interior" so the edit was rejected | Visual QA script | Parametric `adaptWardrobe` rescales shelves/rods |
| 8 | Door/drawer open buttons updated state asynchronously (dynamic import) | e2e | Synchronous implementation |
| 9 | Element names were numbered across users/projects on the server (module counter) | e2e (`TV panel 4`) | Counters reset per project |
| 10 | 2D drawing strokes were sized in mm and nearly invisible on screen | Visual QA | Constant-pixel strokes (`vector-effect`) |
| 11 | Window/door fittings stayed visible when their wall was cut away | Visual QA | Fittings follow wall visibility |
| 12 | `PCFSoftShadowMap` removed in three 0.186 (warning) | Console | Use `PCFShadowMap` |
| 13 | First e2e test flaked on cold dev-server compilation | Full-suite run | Global warm-up of routes |
| 14 | `BASE_URL` collided with Vite's built-in env → integration tests silently skipped | Test run | Renamed to `APP_URL` |
| 15 | The 3D view re-rendered continuously even when idle (wasted CPU/GPU, starved the page under software WebGL and made two e2e tests time out) | Failing full-suite runs, frame counter | On-demand rendering (`frameloop="demand"`): frames are drawn only on state change, camera motion, animation, texture load; idle = 0 frames/3 s (measured) |

| 16 | Room detection returned the outer face of a wall loop (a rectangle test passed by accident; a T-junction test exposed it) | Unit tests | Keep bounded faces by orientation, inset each edge by its own half thickness |
| 17 | New plan walls hid the whole interior in 3D (no cut-away) | Screenshot review | Outer walls facing the camera are hidden (fittings follow); toggles with the existing Display menu |
| 18 | Undo/redo could jump to another floor | Design review | Navigation is kept across undo/redo; floor switching is not an undo step |
| 19 | Classic room → plan shrank the clear interior by a wall thickness | Review + unit test | Walls start half a thickness outside the old polygon; test compares clear interiors exactly |
| 20 | Undo, Redo, Select all and Paste on an empty state did nothing (dead buttons) | "No dead buttons" e2e sweep | Each explains why (“Nothing to undo”, “The clipboard is empty”…) |
| 21 | Stair label/arrow of the printable plan were placed relative to the wrong origin; overall dimensions measured wall centre lines | Visual QA + unit test | Local → plan transform; outer faces |
| 22 | The 3D viewport re-rendered on every cursor move in split view | Code review | Only selection / floor-visibility changes invalidate it |
| 23 | The public preview page carried unit prices, schedules, branches and gallery | Review | Stripped before the page is rendered |
| 24 | Cold dev-server compile of the save route made the first save of a test run take > 20 s | Failing e2e | Route warmed in `global-setup` |

## Known limitations & residual risks (honest list)

* **Floor-plan limitations** are listed in [FLOOR_PLAN.md](FLOOR_PLAN.md) (no AI floor plan, comments, face/edge selection, video, DXF/DWG import; straight walls and straight stairs; roofs over the bounding rectangle).

* **GPU performance is unmeasured.** All browser tests ran on software WebGL, which is far slower than a real GPU; the scene-generation budgets above are CPU-only. Expect 60 fps on typical hardware for starter-size rooms (≈ 1-2 k meshes after batching) but this has not been verified.
* The 3D view is **not keyboard- or screen-reader-navigable** beyond arrow-key nudging; forms, dialogs and menus are keyboard accessible. No formal WCAG audit was done.
* Touch/mobile editing is untested; tablet layout was checked visually only.
* Renders are rasterised supersampling (soft shadows by sun jitter) - no global illumination or true AO.
* The nesting heuristic is not optimal; production documents must be reviewed by a qualified person before cutting.
* Starter rate card is placeholder data. Quantities depend on the modelled construction rules (e.g. board thickness, hinge counts); they are estimates, not a substitute for a shop's own take-off.
* The in-memory rate limiter is per process; uploads live in PostgreSQL; there is no e-mail verification or password reset.
* `docker-compose.yml` is provided but was not executed in this environment (Docker could not start here); local development uses the embedded PostgreSQL.
* The dev-only test hook `window.__nivas` (store + screen projection) is disabled in production builds.
