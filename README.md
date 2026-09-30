# canvai

Production: application at **https://app.canvai.dev**, product website at
**https://canvai.dev** (static Astro site in [`landing/`](landing/README.md),
deployed to Cloudflare Workers).

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

## Accounts: email verification & passwords

- **Sign-up** creates an unverified account and emails a verification link
  (valid 24 h). Until the address is confirmed the app and the API are blocked
  by the `verified` middleware (pages redirect to `/verify-email`, the API
  returns `403 E_EMAIL_NOT_VERIFIED`). The link can be re-sent (60 s cooldown).
  Accounts that existed before this feature were marked as verified.
- **Forgot password** (`/forgot-password`) emails a reset link (valid 60 min,
  single use). The response is identical whether or not the account exists.
  After a reset the user gets a “password changed” notification.
- **Settings** (`/settings`): profile name, change password (requires the
  current password; the session is regenerated and a notification is sent),
  language.
- Tokens are random 32-byte values; only their sha256 hash is stored
  (`user_tokens`). In production, links are built from `APP_URL` only.
- Mail: `MAIL_MAILER=outbox` (default) stores emails in `tmp/mail-outbox/` and
  shows them at **`/dev/mailbox`** (not available in production) — no mail
  server needed locally. For real delivery set `MAIL_MAILER=smtp` and the
  `SMTP_*` / `MAIL_FROM_*` variables (see `.env.example`). Emails are sent in
  the user's language (PL/EN).

## Languages (i18n)

The app is available in **Polish and English**. The language is resolved per
request: the language saved in the user's account → the `dc_locale` cookie →
the browser's `Accept-Language` (Polish browser → PL, **any other language →
EN**; no header → PL). The PL/EN switcher (login screen, sidebar, editor top bar,
settings) calls `POST /locale`, which sets the cookie and — for logged-in users —
saves the choice in `users.locale`, so it survives reloads, new sessions and
other devices, and is also used for that user's emails (e.g. password reset).
The cookie name is app-specific because cookies on `localhost` are shared
across ports with other local apps.

- UI strings: `inertia/i18n/messages.ts` (`pl` + `en`, TypeScript enforces the
  same keys); components use `useT()`, non-React code uses `translate()`.
  Switching the language re-renders instantly, no reload.
- Server strings (validation, API errors, DESIGN.md generation errors):
  `app/services/i18n_messages.ts`, via `t()` from `app/services/i18n.ts`. The
  locale lives in an `AsyncLocalStorage` set by `LocaleMiddleware`; queued jobs
  store the requester's locale and run in it, so background errors use the
  same language.
- Plurals use `Intl.PluralRules` (`<key>.one|few|many|other`).
- The generated DESIGN.md itself stays in English — it is written for the
  UI-building AI.

## UI & design system

The interface is Polish-language and follows one design system defined as CSS
tokens in `inertia/css/app.css` ("parchment behind clean glass"): warm paper
canvas `#faf8f5`, ink text `#27251e`, hairline warm-gray borders, and a single
accent — deep teal `#016a71` — reserved for active/selected states. Type is
Inter (400–500), components are flat with one subtle shadow. Component classes
(`.btn`, `.input`, `.card`, `.chip`, `.badge`, `.modal`, `.menu`, …) are used
everywhere instead of ad-hoc inline colors; canvas element colors live in
`inertia/lib/scene/palette.ts`.

Layouts (`inertia/layouts/default.tsx`) are picked per page: centered card for
`auth/*`, full-screen workspace for the board editor, and an app shell with a
left sidebar for everything else. Icons come from `lucide-react`.

Editor UX: floating tool bar with shortcuts (V, R, O, L, P, T, S), zoom
controls (bottom-left), a contextual selection bar (stroke/fill/sticky/text
colors, stroke width, z-order, duplicate, delete — all undoable), inline board
rename, collapsible side panel, dialogs with confirmation for destructive
actions, and a DESIGN.md panel with section outline, versions and diff.

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
`design-doc-diff-toggle`, `design-doc-diff`, `design-ref-<assetId>`,
`toggle-side-panel`, `board-title`, `board-title-input`, `selection-bar`,
`props-stroke`, `props-fill`, `props-sticky`, `props-text`, `props-duplicate`,
`props-delete`, `zoom-in`, `zoom-out`, `delete-asset-dialog`,
`confirm-delete-asset`; boards list: `new-board`, `sidebar-new-board`,
`boards-search`, `board-grid`, `board-card-<id>`, `board-menu-<id>`,
`board-rename`, `board-delete`, `create-board-dialog`, `create-board-submit`,
`rename-board-dialog`, `delete-board-dialog`, `confirm-delete-board`; auth:
`login-submit`, `login-error`, `signup-submit`.

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
3. **Composition** (`generator.ts`) — one call over the structured analyses
   returns a structured `DesignSpec` (`spec.ts`): colors, type families and
   scale, spacing, radii, shadows, layout, components with states, screens and
   flows, voice, do's/don'ts, surfaces, agent prompts, open questions. It is
   schema-validated and grounding-checked: every source id must exist, items
   without sources are flagged as assumptions. Rejected output is retried with
   the list of problems.
4. **Render** (`renderer.ts`) — code (not the model) writes the markdown in a
   "Style Reference" format, in English for the UI-building AI:
   `# <Product> — Style Reference`, tagline, theme, overview, **Tokens — Colors /
   Typography / Spacing & Shapes**, **Components**, **Screens & Flows** (from
   board arrows and frames), **Voice & Microcopy**, **Do's and Don'ts**,
   **Surfaces**, **Elevation**, **Imagery**, **Layout**, **Agent Prompt Guide**,
   **Similar Brands**, **Quick Start** (`:root` CSS custom properties and a
   Tailwind v4 `@theme`, generated from the same tokens as the tables),
   **Open Questions** and **Sources** (asset → sections). Every token and
   component cites its assets as `[A<id>]`; assumed values are marked `†`.

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

## Billing: credits & plans (Lemon Squeezy)

Users pay for DESIGN.md generations with **credits** (`config/billing.ts`):

| Action | Cost |
|---|---|
| New or changed material (analysis) | 1 credit |
| Composing the document | 4 credits |
| Pro reasoning mode | ×2 |
| Cached materials / regeneration with no changes | 0 |
| Failed generation | full refund |

The estimate shown before generating is exactly what is charged: credits are
reserved when the job is queued and released in full if it fails.

Plans are derived from state: an active subscription → `pro`; any purchased
pack → `payg`; otherwise `free` (1 board, 10 materials, last 2 versions,
footer in DESIGN.md, no exports / Pro reasoning). Free users get 30 welcome
credits and 10 each month (lazily granted). Credits live in pools with an expiry
(`credit_grants`); spending takes the soonest-expiring first. Every change is
logged in `credit_transactions`.

**Lemon Squeezy setup** (merchant of record — handles VAT):

1. Create products: three single-payment packs (100 / 300 / 1000 credits) and
   a monthly subscription (Pro, 300 credits). Put their **variant IDs** in
   `LEMONSQUEEZY_VARIANT_PACK_S|M|L` and `LEMONSQUEEZY_VARIANT_PRO`.
2. `LEMONSQUEEZY_API_KEY` (Settings → API) and `LEMONSQUEEZY_STORE_ID`.
3. Webhook: `https://app.canvai.dev/webhooks/lemonsqueezy`, signing secret in
   `LEMONSQUEEZY_WEBHOOK_SECRET`, events: `order_created`, `order_refunded`,
   `subscription_created`, `subscription_updated`, `subscription_cancelled`,
   `subscription_resumed`, `subscription_expired`, `subscription_paused`,
   `subscription_unpaused`, `subscription_payment_success`,
   `subscription_payment_refunded`.

Webhooks are verified (HMAC-SHA256) and idempotent. Without the API key the
Billing page shows buy buttons as “soon” while plan limits still apply.
`BILLING_ENFORCED=false` disables limits and charging (self-hosting, tests).

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
