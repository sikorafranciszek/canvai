# Design Canvas

An infinite canvas application (like Figma/Excalidraw) where users paste screenshots, images, graphics, and notes, and AI scans the board content to generate **DESIGN.md** documentation.

**Stack:** AdonisJS + Inertia.js + React + TypeScript + SQLite/PostgreSQL

## Requirements

- Node.js >= 24.0.0
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
npm run test
```

## Linting & Type Checking

```bash
npm run lint
npm run typecheck
```

## Project Structure

```
app/
  controllers/     # HTTP controllers (auth, boards)
  exceptions/      # Error handler
  middleware/      # HTTP middleware (auth, guest, inertia)
  models/          # Lucid ORM models
  validators/      # VineJS validation schemas
config/            # Framework configuration
database/
  migrations/      # Database migrations
inertia/
  layouts/         # Shared page layouts
  pages/           # Inertia page components
    auth/          # Login, signup pages
    boards/        # Board list, create, show pages
  css/             # Stylesheets
providers/         # Service providers
start/
  routes.ts        # HTTP route definitions
  kernel.ts        # Middleware registration
tests/
  functional/      # HTTP functional tests
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
