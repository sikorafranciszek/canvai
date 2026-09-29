# Design Canvas

An infinite canvas application (like Figma/Excalidraw) where users paste screenshots, images, graphics, and notes, and AI scans the board content to generate **DESIGN.md** documentation.

**Stack:** AdonisJS + Inertia.js + React + TypeScript + SQLite/PostgreSQL

## Requirements

- Node.js >= 24.0.0 (`nvm use` — wersja w `.nvmrc`; na Node 18 `node ace` się nie uruchomi)
- npm

## Installation

```bash
npm install
```

## Environment Variables

Copy `.env.example` to `.env` and adjust:

```bash
cp .env.example .env
```

| Variable         | Description                                                        |
| ---------------- | ------------------------------------------------------------------ |
| `PORT`           | HTTP server port (default: `3333`)                                 |
| `HOST`           | Server host (default: `localhost`)                                 |
| `NODE_ENV`       | `development`, `production`, or `test`                             |
| `APP_KEY`        | Application encryption key (generate with `node ace generate:key`) |
| `APP_URL`        | Public URL of the application                                      |
| `SESSION_DRIVER` | `cookie`, `memory`, or `database`                                  |
| `DB_CONNECTION`  | `sqlite` (default) or `pg` for PostgreSQL                          |
| `DB_HOST`        | PostgreSQL host                                                    |
| `DB_PORT`        | PostgreSQL port                                                    |
| `DB_USER`        | PostgreSQL user                                                    |
| `DB_PASSWORD`    | PostgreSQL password                                                |
| `DB_DATABASE`    | PostgreSQL database name                                           |
| `AI_PROVIDER`    | `mock` (default, no network) or `deepseek`                         |
| `DEEPSEEK_API_KEY` | DeepSeek API key — only in `.env`, never committed               |
| `DEEPSEEK_*_MODEL` | Model overrides (see `config/ai.ts`)                             |
| `QUEUE_INLINE_WORKER` | Run the job worker inside `node ace serve` (default `true`)   |

## Database

SQLite is used by default in development. To switch to PostgreSQL:

```bash
# Install the pg driver
npm install pg

# Update .env
DB_CONNECTION=pg
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=yourpassword
DB_DATABASE=design_canvas
```

## Migrations

```bash
node ace migration:run
```

To reset and re-run:

```bash
node ace migration:refresh
```

## Running

```bash
# Development with hot module replacement
npm run dev

# Production build
npm run build

# Start production server
npm start
```

The app will be available at `http://localhost:3333`.

## Testing

```bash
npm run test                       # all suites (unit, functional, browser)
node ace test unit functional      # fast, no browser
node ace test browser              # Playwright e2e (needs `npx playwright install chromium`)
```

All tests run on the `mock` AI provider (forced in `.env.test`) — zero network
calls, deterministic output.

## Board editor

The board editor (`/boards/:id`) is an infinite canvas (react-konva). Content
reaches the board through three paths, all persisted server-side:

- **Paste (`Ctrl+V`)** — an image from the clipboard becomes an `image` element
  (uploaded to `POST /api/boards/:id/assets`), a URL becomes a link card, plain
  text becomes a sticky note. Works when the canvas or the page is focused,
  but not inside text fields.
- **Drag & drop** — multiple files at once, positioned where they were dropped.
- **Upload button** — a fallback file picker.

Scene autosave uses `PUT /api/boards/:id/scene` with optimistic locking
(`version`); a `409` conflict reloads the fresh state and shows a message
instead of silently overwriting. The right-hand **asset panel** lists
thumbnails, size, type, an editable AI note (`PATCH /api/assets/:id`), and
deletion — clicking an item centers and selects its element on the canvas.

### `data-testid` contract (for BLA-8 e2e)

`canvas-root`, `canvas-empty-state`, `drop-overlay`, `upload-button`,
`upload-input`, `save-status`, `asset-panel`, `asset-item-<id>`,
`asset-thumb-<id>`, `asset-note-<id>`, `asset-delete-<id>`,
`generate-design-doc`, `tab-assets`, `tab-design`, `design-doc-panel`,
`design-doc-status`, `design-doc-content`, `design-doc-empty`, `design-doc-error`,
`design-doc-download`, `design-doc-copy`, `design-doc-version-select`,
`design-doc-diff-toggle`, `design-doc-diff`, `design-ref-<assetId>`.

## DESIGN.md generation (AI)

The **✦ Generuj DESIGN.md** button on a board saves the scene, queues a job and
switches the right panel to the **DESIGN.md** tab, which shows progress, the
rendered document, version history, a diff against the previous version, and
**Pobierz** (download) / **Kopiuj** (copy).

Pipeline (`app/services/design/`):

1. **Board context** (`board_context.ts`) — images, notes, frames (shapes that
   contain other elements) and arrows resolved to the elements they connect.
   Layout is passed to the model as structure, not as a picture.
2. **Per-asset analysis** (`analyzer.ts`) — one call per asset (concurrency 4),
   cached in `asset_analyses` by content hash + model + `PROMPT_VERSION`, so
   re-generating never pays twice for unchanged assets.
3. **Composition** (`generator.ts`) — one call over the structured analyses;
   the response is schema-validated and grounding-checked (every `[A<id>]` must
   exist; key sections must cite sources). Rejected output is retried with the
   list of problems.
4. **Render** (`renderer.ts`) — 8 fixed sections; section 8 (sources) is built
   by code from the `[A<id>]` references.

Sections: 1. Przegląd produktu · 2. Ekrany i przepływy · 3. Inwentarz
komponentów · 4. Tokeny wizualne · 5. Wzorce layoutu i interakcji · 6. Treść i
mikrocopy · 7. Otwarte pytania i luki · 8. Źródła.

Board content (file names, notes, OCR text, link metadata) is untrusted: it is
fenced in `<untrusted>` blocks and the system prompt treats it as data only.

Providers (`app/services/ai/`): `mock` works offline — it derives palette from
pixels and builds a grounded document from names, notes and layout; `deepseek`
uses `deepseek-flash` (vision) for analysis and the text model for composition.
To use DeepSeek, set `AI_PROVIDER=deepseek` and `DEEPSEEK_API_KEY=...` in `.env`.
Limits (assets per job, tokens per generation, timeouts, retries) live in
`config/ai.ts` and fail loudly instead of truncating.

Queue: jobs are stored in the `jobs` table. In development the worker runs
inside `node ace serve`; for production you can run it separately:

```bash
node ace queue:work          # long-running worker
node ace queue:work --once   # process pending jobs and exit
```

API:

| Method | Path                                          | Description                                        |
| ------ | --------------------------------------------- | -------------------------------------------------- |
| POST   | `/api/boards/:id/design-doc`                  | Queue a generation (`202`); `200` if nothing changed (`{ force: true }` to override); `409` while one is running; `422` for an empty board; `503` without an API key |
| GET    | `/api/boards/:id/design-doc?version=`         | Latest (or given) version with status and markdown |
| GET    | `/api/boards/:id/design-docs`                 | Version history                                    |
| GET    | `/api/boards/:id/design-doc/download?version=`| `DESIGN.md` file                                   |
| GET    | `/api/jobs/:id`                               | Job status and progress                            |

## Linting & Type Checking

```bash
npm run lint
npm run typecheck
```

## Project Structure

```
app/
  controllers/     # HTTP controllers (auth, boards, scenes, assets, design docs)
  exceptions/      # Error handler
  middleware/      # HTTP middleware (auth, guest, inertia)
  models/          # Lucid ORM models
  services/        # assets, queue, ai/ (providers), design/ (DESIGN.md pipeline)
  validators/      # VineJS validation schemas
commands/          # Ace commands (queue:work)
config/            # Framework configuration
database/
  migrations/      # Database migrations
inertia/
  layouts/         # Shared page layouts
  components/      # canvas/ (editor), design/ (DESIGN.md panel)
  pages/           # Inertia page components
    auth/          # Login, signup pages
    boards/        # Board list, create, show pages
  css/             # Stylesheets
providers/         # Service providers
start/
  routes.ts        # HTTP route definitions
  kernel.ts        # Middleware registration
shared/            # Pure modules shared by server and client (scene, markdown, diff)
tests/
  unit/            # Pure logic tests
  functional/      # HTTP functional tests
  browser/         # Playwright e2e
```

## Data Model

| Table            | Description                                                                     |
| ---------------- | ------------------------------------------------------------------------------- |
| `users`          | User accounts (email, password)                                                 |
| `boards`         | Design canvas boards owned by users                                             |
| `board_scenes`   | Active canvas state per board (document JSON, optimistic locking via `version`) |
| `assets`         | Uploaded media items (images, PDFs, links, text, files)                         |
| `asset_analyses` | AI analysis cache per asset (keyed by sha256 + model + prompt_version)          |
| `design_docs`    | Generated DESIGN.md documents per board                                         |
| `jobs`           | Background job queue                                                            |
