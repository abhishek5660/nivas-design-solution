# NIVAS DESIGN SOLUTION

A browser-based 3D interior and modular-furniture design application for **wardrobes, modular kitchens and TV panels**.
Everything the user sees is generated from one parametric model: the interactive 3D view, 2D drawings with dimensions, bill of quantities (BOQ), cut lists, board layouts, and exports.

> Original application inspired by the *workflow* of design-to-manufacturing tools. It contains no third-party source, logos or assets.

![stack](https://img.shields.io/badge/Next.js_16-React_19-black) ![3d](https://img.shields.io/badge/three.js-R3F-blue) ![db](https://img.shields.io/badge/PostgreSQL-Prisma_6-336791)

## What you can do

| Module | Highlights |
|---|---|
| **Wardrobe designer** | Parametric carcass, 1-10 sections (long/short hanging, shelves, drawers, shoe rack, niche), per-section rods/shelves/drawer heights, hinged / sliding / open, per-door type & material, loft, plinth, LED + sensor, doors & drawers animate |
| **Kitchen designer** | Straight / L / U / parallel / island generators fitted to the room; base, wall, tall, corner, drawer, sink, island, open shelf; countertops + backsplash; fridge, oven, microwave, hob, chimney, dishwasher, sink; drag-and-drop with wall/neighbour snapping and collision prevention; editable room polygon, doors, windows, columns |
| **TV panel designer** | Full-wall panels (fluted, slat, batten, marble, stone), floating or floor unit, drawers/doors/open bays, router compartment, cable opening, side towers (closed/open/niche), wall shelves, soundbar, fireplace insert, backlit panel, LED lighting |
| **Documentation** | Top plan, front/back/left/right elevations with dimension lines (SVG, DXF, PDF) · BOQ with editable rates, wastage, labour, discount, tax (PDF, CSV) · cut list with edge banding, board-nesting layouts, hardware list, assembly notes (PDF, CSV) |
| **Rendering** | PBR materials, image-based lighting, soft shadows, tone mapping, daylight/warm/night presets · progressive supersampled stills up to 4K (PNG/JPEG) · 360° equirectangular panoramas · public read-only preview links |
| **Platform** | Accounts & roles (Admin/Designer/Viewer), server-side authorization, project sharing, version history with compare/restore, JSON import/export, personal component/material/template libraries, admin rate card |

See [`docs/FEATURE_MATRIX.md`](docs/FEATURE_MATRIX.md) for the honest implemented / partial / pending breakdown and [`docs/ROADMAP.md`](docs/ROADMAP.md) for what is next.

## Quick start (local development)

Requirements: **Node.js 20+** (tested on 22) and npm. No Docker or separately installed database is needed for development - a real PostgreSQL 17 is started for you through the `embedded-postgres` package.

```bash
npm install
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
npm run dev
```

`npm run dev` starts PostgreSQL on port 5433 (data in `./.pgdata`), applies the schema, and starts the app at <http://localhost:3000>.
Register an account - **the first account becomes the administrator**.

> npm may ask you to approve install scripts for `prisma`, `@prisma/client`, `@prisma/engines`, `esbuild` and `@embedded-postgres/windows-x64` (or the platform equivalent). Approve them: they download the database engine binaries.

### Using your own PostgreSQL instead

Set `DATABASE_URL` in `.env` to any PostgreSQL 14+ database and run the pieces yourself:

```bash
npx prisma migrate deploy   # create tables from prisma/migrations
npm run dev:next
```

A ready-made `docker-compose.yml` (PostgreSQL only) is included: `docker compose up -d db`.
*(Provided for convenience; it was not exercised in the environment this project was built in.)*

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string. Dev default: `postgresql://postgres:postgres@localhost:5433/nivas?schema=public` |
| `SESSION_SECRET` | **yes in production** | Random string ≥ 32 chars used to sign session cookies (`openssl rand -base64 48`). The app refuses to start sessions in production without it. |
| `FIRST_USER_IS_ADMIN` | no (default `true`) | Whether the first registered account becomes administrator. |
| `PORT`, `PG_PORT`, `PG_DATA_DIR` | no | Dev launcher overrides (`scripts/dev.mjs`, `scripts/db.mjs`). |

Secrets live only in server-side environment variables; nothing is read by or sent to the browser.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Local PostgreSQL + schema + Next dev server |
| `npm run build` / `npm start` | Production build / server |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit tests (geometry, constraints, snapping, BOQ, cut list/nesting, drawings, exports, validation, performance budgets) |
| `npm run test:integration` | HTTP + database tests against a **running** app (`APP_URL` to override) |
| `npm run test:e2e` | Playwright browser tests (uses installed Chrome; `PW_CHANNEL=""` + `npx playwright install chromium` to use bundled Chromium) |
| `npm run test:all` | All of the above |
| `npm run db:push` / `db:generate` | Dev schema sync / regenerate Prisma client |

Integration and e2e tests need the app running: start `npm run dev` in one terminal, then run the tests in another (`NO_WEB_SERVER=1` stops Playwright from trying to start it).

## Database & migrations

* Schema: [`prisma/schema.prisma`](prisma/schema.prisma). Models: `User`, `Project` (design stored as validated JSON), `Revision`, `ProjectShare`, `CatalogItem` (materials/themes/components/templates), `Asset` (uploaded textures and GLB models), `Setting`.
* Production: `npx prisma migrate deploy` applies `prisma/migrations/0001_init`.
* A database that was created with `db push` during development can be baselined with `npx prisma migrate resolve --applied 0001_init`.
* Future schema changes: `npx prisma migrate dev --name <change>`.

## Deployment

1. Provision PostgreSQL and set `DATABASE_URL`, `SESSION_SECRET` (and keep `NODE_ENV=production`).
2. `npm ci && npx prisma migrate deploy && npm run build`
3. `npm start` (behind HTTPS - session cookies are `Secure` in production, `HttpOnly`, `SameSite=Lax`).
4. Put the app behind a reverse proxy with a request-body limit ≥ 10 MB (design saves cap at 8 MB, uploads at 8 MB).

Notes for operators: the login/registration rate limiter is in-process memory (use a shared store if you run several instances); uploaded files are stored in PostgreSQL (`Asset.bytes`), see roadmap for S3-compatible storage.

## Project layout

```
src/lib/types.ts            domain model (SceneDoc, SceneNode, Part ...)
src/lib/build/              parametric generators: wardrobe, cabinet, tv, countertop, appliance
src/lib/scene.ts            node registry, validation, snapping, collisions, kitchen layout generator
src/lib/docs/               BOQ, cut list + nesting, 2D drawings, CSV/PDF exports
src/lib/schema.ts           zod validation of projects (save, import, load)
src/lib/three/              textures, geometry cache, render pipeline, GLB inspection
src/store/                  Zustand editor store (history, selection), autosave engine
src/components/editor/      viewport, inspector, panels, toolbars, document tabs
src/app/api/                REST route handlers (auth, projects, revisions, exports, catalog, assets, admin)
tests/ e2e/                 vitest unit/integration, Playwright
docs/                       architecture, feature matrix, QA report, roadmap
```

More detail in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Important limitations (read before relying on outputs)

* **Prices are estimates.** The starter rate card is *illustrative placeholder data*, not supplier prices. Items without a rate are flagged `MISSING PRICE` and excluded from totals. Set real rates under Administration → Pricing rules or per BOQ line.
* **Not CNC output.** Cut lists and board layouts are shop documents; no machine (CNC) file formats are generated. Verify every production document before cutting.
* **Sample materials and hardware are not manufacturer-verified.** They are labelled as such everywhere.
* Renders are rasterised with supersampling (not path-traced). Video export, section views and XLSX are not implemented (CSV opens in Excel).
