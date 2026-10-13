# Floor-plan workspace (2D plan ⇄ 3D model)

A real, editable floor-plan workspace that shares **one model** with the 3D view, the drawings, the BOQ and the saved project. It sits next to the original wardrobe / kitchen / TV designers: those projects are untouched, and the cabinets they generate can be placed inside a floor plan.

* New project → **Floor plan (2D / 3D)** starts with an empty floor plan.
* Existing project → **Convert to floor plan** (top bar) rebuilds the room polygon, doors and windows as walls/openings. The old polygon was the clear interior, so the walls are placed half a thickness outside it and nothing already placed moves. The conversion is one undo step.

## How it works

```
 click / type / drag                        doc.plan (PlanModel, mm)  ──► validatePlan ──► PostgreSQL (same document as the 3D scene)
        │                                          │
 PlanCanvas ─► ToolEngine ─► PlanHost ─► commit ───┤  rooms (planar-face detection), openings, slabs, ceilings, tiling,
 (pointer, keys, typed input)       (editor store) │  stairs, columns, beams, railings, roofs, lights, models, annotations
                                                   ▼
   2D canvas  ·  3D (PlanMesh)  ·  floor sheet (SVG/DXF/PDF)  ·  BOQ / raw materials / QC / schedule  ·  DXF export
```

* Coordinates: plan `x` east, plan `y` south (= world `z`), millimetres, angles in degrees.
* **Walls** are straight centre lines with thickness and height. Joins, T-junctions and crossings are normalised automatically (walls are split where they meet). **Rooms** are found from closed wall loops (planar-face detection); the clear interior excludes half the wall thickness, so areas are real net areas.
* **Doors/windows** belong to a wall (offset + width); they cut the wall in 2D and 3D, move with it and are deleted with it. Placement is checked against the wall length, other openings and a 50 mm margin.
* **Furniture and cabinets** are ordinary scene nodes (so every parametric option of the original designers still works) tagged with a `floorId`; they snap to the inner faces of plan rooms.
* **Floors/buildings**: any number of floors per building with their own elevation and storey height; changing an elevation lifts the furniture on that floor with it.
* **History**: every action (including a multi-object move, a tool that edits several entities, or a furniture + wall change) is one undo step. Undo/redo never moves you to another floor.
* **Persistence**: the plan lives inside the project document; autosave, local draft recovery, revisions, duplication, JSON export/import and public preview all include it. Public preview strips prices, schedules, branches and gallery.

## Interaction

Click-click drawing (no dragging). While a tool is active you can **type**: `3000` (length in the cursor direction), `3000<45` (length and angle), `@500,0` (offset), `1000,2000` (absolute point), `w,h` for rectangles, then Enter. `Esc` cancels, `Enter`/double-click/right-click finishes, `Space`+drag or middle mouse pans, wheel zooms, `Shift+Z`/`Shift+X` fit all / selection, arrows move the selection 1 mm (Shift = 10 mm), `Alt` ignores snapping, `R` rotates the object being placed. Snapping: end points, mid points, centres, intersections, nearest, perpendicular/45° guides, alignment with other objects, grid (all switchable in Preferences).

## Requested features → what exists

Legend: ✅ works and is tested · 🟡 works with the stated limits · ⬜ not built (the button says so).

### Top bar
| Item | | Notes |
|---|---|---|
| Project/file browser | ✅ | “Files” → dashboard |
| Design name | ✅ | shown; renaming is in the page header |
| Design mode selector | ✅ | *Architecture*: everything editable · *Interior*: walls, openings, slabs, ceilings, tiling, stairs, columns, beams, railings, roofs are locked · *Production*: only imported 3D models + furniture/cabinets editable |
| Building / floor / room selectors | ✅ | add/rename/delete/duplicate floors and buildings in “Add / edit floors…”; the room selector zooms to a room, “Rename rooms…” |
| Floorplan / 3D toggle | ✅ | plus **Split** view |
| User | ✅ | account chip |
| Comments | ⬜ | disabled and labelled; no review threads exist |

### Ribbon (every button is exercised by an automated “no dead buttons” test)
| Tab | Tools | Status |
|---|---|---|
| **Home** | Undo, Redo, Save, Select, Pan, Select all, Group, Ungroup, Copy, Paste, Delete, Move, Rotate, Copy tool, Mirror, Scale, Align/Distribute (menu), Lock, Unlock, Hide, Show all | ✅ |
| **View** | Pan, zoom in/out/fit/selection, box-select modes (auto/window/crossing), **1 mm / 10 mm move pads**, Lock design, Reference visibility, Existing light, Isolate, Unhide, X-ray, floors shown in 3D, Set view, Set thumbnail, Saved views | ✅ · *Face* and *Edge* selection ⬜ (labelled; objects are selected whole) |
| **Insert** | Furnish (library of furniture + every cabinet/appliance), Light, Strip light, 3D Import (.glb), Add Ref. (PNG/JPG/WEBP), Component | ✅ |
| **Draw** | Line, Polyline, Construction line, Grid settings, 3-point Arc, Circle, Rectangle, Polygon, Arrow, Hatch, Trim, Extend, Mirror, Copy, Move, Rotate, Scale, Offset, Fillet, Component, Make component | ✅ |
| **Architecture** | Floor plan wizard, Wall, Door, Window, Ceiling, Tiling, Stairs, Slab, Column, Railing, Beam, Roof, Attach wall, Trim, Extend, Dimension, Measure, Zoom | ✅ · **AI floor plan** ⬜: replaced by an honest manual *Floor plan wizard* that builds walls, doors and windows from the room sizes you type |
| **Annotate** | Text, MultiLeader, Compass, Dimension, Angle, Radial, XY coordinate, Measure, Align | ✅ |
| **Render** | Render (real progressive still / 360° panorama, add to gallery), 3D Render, Gallery, Export (PNG, PDF, DXF, JSON), Screenshot, Extra lighting | ✅ · video ⬜ |
| **Outputs** | Preferences, Branch, Presentation(s), Settings, Automatic tools, Pricing, QC, Violations, Raw materials, BOQ schedule, Work schedule, Cache, Production design | ✅ |

### Behaviour worth knowing
* **QC / Violations** are real checks with a location: short/open/duplicate/too-tall walls, openings outside/overlapping/too tall, narrow doors, stair rise/going comfort and width, high ceilings, unlinked dimensions, columns inside walls, rooms without door/window/dimension or very small, furniture overlapping, inside a wall or invalid. Clicking a finding switches floor, selects the object and flashes the spot.
* **BOQ / Raw materials / Work schedule** are computed from the drawn geometry (wall area net of openings, tile area and piece count with wastage, slab volume, roof area, counts of doors/windows/lights, strip-light length, furniture). **No prices or durations are invented**: lines without a price are listed as unpriced and left out of totals; the schedule shows “No duration entered” until you enter days. Cabinetry still uses the original BOQ pricing rules.
* **Branches** snapshot the whole design (all floors and furniture). Switching stores the branch you leave first, so nothing is lost; undo history is reset on a switch.
* **Presentations** play saved views (2D or 3D camera) one after another with a delay you choose.
* **Floor sheet**: *2D Drawings → Floor plan* prints a dimensioned plan per floor (walls cut at openings, door swings, rooms with net areas, furniture, overall dimensions) as SVG / DXF / PDF; the drawings PDF contains one sheet per floor with content.
* **DXF export** (Render → Export): one layer per object type, millimetres, y flipped to CAD orientation.

## Limitations (honest list)

* No AI floor-plan generation, no comments/review, no face/edge selection, no video render, no DWG/DXF **import**, no PDF reference import (images only).
* Walls are straight. Stairs are a straight run of solid steps (no landings, spiral or stringers) and do not cut an opening in the slab above. Roofs (flat/gable/hip/shed) are generated over the bounding rectangle of the outline plus overhang; thickness is not modelled in 3D. Ceilings follow the room outline. Doors are drawn closed in 3D (the swing is shown in 2D).
* Tiling patterns: straight grid, brick, diagonal; no herringbone. Wall tiling covers a wall face to a chosen height.
* Imported GLB: ≤ 8 MB, ≤ 600 000 triangles, units assumed to be metres. Scaling is by bounding box.
* The 3D cut-away hides outer walls facing the camera; interior partitions can still hide parts of a room — orbit, use X-ray, or isolate a floor.
* Editing is single-user with version-conflict detection; there is no real-time collaboration.
* Browser tests run on software WebGL; real-GPU frame rates are unmeasured.
