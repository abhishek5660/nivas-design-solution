# Roadmap (prioritised)

Ordered by value to a design-and-manufacture workflow and by dependency. Items marked **P0** block safe production use.

## P0 - before real customer work

1. **Replace placeholder rates and sample data with real catalogs** - import supplier price lists (CSV) into the rate card; allow user-defined hardware items with codes, prices and *verified* status.
2. **Production-grade operations** - shared rate limiting (Redis), structured logging with request IDs, error monitoring, database backups, health-check endpoint, password reset / e-mail verification, audit log of administrative actions.
3. **Object storage** - move uploaded textures/GLBs out of PostgreSQL to S3-compatible storage behind the same `/api/assets` interface; virus scanning hook.
4. **Hardware-accelerated QA** - run the e2e suite on a GPU runner and record real frame-rate budgets for 5k/10k-part scenes (current numbers are software-rendered CI figures).

## P1 - make the model more complete

5. **Section views** (cut planes) in the 2D engine, plus dimension entities in DXF (`DIMENSION` instead of lines + text).
6. **Smarter placement** - "push neighbours" when a cabinet is widened in a run, auto-reflow of a run when a cabinet is removed, gap/filler-panel generation, marquee selection and alignment guides.
7. **Kitchen specifics** - L-shaped / carousel corner units, hob/sink cut-outs in worktops, tall-unit split doors, plinth-to-floor leg systems, appliance model library with real dimensions.
8. **Wardrobe specifics** - independently editable door sizes, aluminium-framed glass/mirror doors, internal drawer-organiser kits, door/motion sensor simulation, corner wardrobes.
9. **TV panels** - recessed downlights and LED-profile geometry, curved/arched niches, cut-outs for sockets and wall boxes.
10. **Component rules engine** - user-editable construction standards (panel thickness by span, hinge rules, drilling patterns) stored per organisation.

## Floor-plan follow-ups

* Curved walls, stair landings / spiral stairs and automatic slab openings, roof thickness and dormers, door-swing animation in 3D.
* DXF/DWG **import** and PDF references; hatch/line-type libraries; layer manager.
* AI-assisted layout (only with a real model and a clear review step) - today the wizard is deliberately manual.
* Comments and review threads on the plan; real-time co-editing.
* Section views from the 3D model; interior elevations per room.

## P2 - production & manufacturing depth

11. **Optimal board nesting** (guillotine with rotation search, off-cut reuse, grain constraints), multiple stock sizes, cost-based sheet selection.
12. **Printable label sheets** (QR/barcode per panel), assembly instruction PDFs with exploded steps.
13. **Machining data**: drilling coordinates per panel, routing paths; then **validated CNC exports** (e.g. a machine-specific format) as separate, tested modules - only after units, tolerances and post-processor are verified against a real machine.
14. **XLSX export** for BOQ/cut list with formulas.

## P3 - visualisation & collaboration

15. **Ambient occlusion** (SSAO/GTAO) and planar mirror reflections for the live view; **path-traced render mode** (WebGPU or server-side) with denoising.
16. **Animated lighting transitions**, **video export** (camera path + WebCodecs/FFmpeg), richer walkthrough (collision, hotspots).
17. **Real-time collaboration** (presence, comments on the 3D model, shared cursors) and customer approval workflow on the public preview link.
18. **Mobile/touch editing** and tablet-optimised inspector; offline-capable PWA.
19. **Localisation** (languages, currencies, measurement systems beyond display units), GST/VAT invoice templates.
20. **Public API & webhooks** for ERP/CRM integration.
