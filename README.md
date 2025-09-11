# Readerly – Google Reader clone

Readerly is a functional clone of Google Reader focused on feed subscription, aggregation, reading, search, sharing, and offline access.

Features:

- Subscribe to RSS/Atom feeds
- Organize feeds into folders/tags
- Track read/unread, starred, shared
- Full-text search and saved queries
- Offline caching and sync
- Share items publicly or with friends

## Keyboard shortcuts (quick reference)

- j / ArrowDown: Next item
- k / ArrowUp: Previous item
- m: Toggle read/unread
- s: Toggle star
- h: Share/unshare
- o / Enter: Open item URL in a new tab

Tech stack

- Backend: Node.js 20, TypeScript, Express, Prisma, PostgreSQL, BullMQ (Redis), Zod, JWT
- Frontend: Next.js 14, TypeScript, Tailwind CSS, Service Worker, IndexedDB
- Infra: Docker Compose, Postgres, Redis

Repository structure

```
readerly.app/
├─ backend/                # Express API, Prisma schema, fetcher worker
├─ frontend/               # Next.js app (App Router)
├─ shared/                 # Shared types/schemas (optional)
├─ docker-compose.yml      # Local development stack
├─ .env.example            # Environment variable template
├─ .gitignore
└─ README.md
```

Getting started

1. Copy environment file:

```bash
cp .env.example .env
```

2. Start the stack (first boot will build images):

```bash
docker compose up --build
```

3. Access services:

- API (dev server): http://localhost:4000/health
- API (Docker container): http://localhost:4001/health
- Web: http://localhost:3000
- Postgres: localhost:5433 (inside network as postgres:5432)
- Redis: localhost:6380 (inside network as redis:6379)

## Local development vs Docker Compose

You can run Readerly in two modes:

- Local dev (hot reload):

  - Backend: `cd backend && npm run dev` (http://localhost:4000)
  - Frontend: `cd frontend && npm run dev` (http://localhost:3000)
  - Frontend API origin: set in [frontend/.env.local](frontend/.env.local) as:
    - `NEXT_PUBLIC_API_ORIGIN=http://localhost:4000`
  - Database/Redis: you can still use Docker for Postgres/Redis via `docker compose up postgres redis`.

- Docker Compose (no local dev servers):
  - Backend: http://localhost:4001 (container maps 4001->4000)
  - Frontend: http://localhost:3000
  - Frontend API origin: Compose passes a build arg to the frontend image so the app calls `http://localhost:4001` at runtime (see docker-compose.yml).

## Seeding dev data

You can populate a sample user, folder, subscription, and a couple of items for local development.

- With Docker Compose (recommended):

  - One-off run (no long-running container):
    - docker compose run --rm --profile seed backend_seed
  - This uses the seed job defined in [docker-compose.yml](docker-compose.yml), which invokes the compiled seed script at runtime.

- Running locally (without Docker Compose):
  - In [backend](backend):
    - npm install
    - npx prisma migrate dev
    - npm run seed
  - The seed script source lives at [backend/src/scripts/seed.ts](backend/src/scripts/seed.ts).

Service responsibilities

- Backend API

  - REST endpoints: auth, feeds, subscriptions, items, search, sharing
  - Feed fetcher worker via BullMQ
  - Prisma migrations and FTS

- Frontend
  - Two-pane UI, keyboard shortcuts (j/k, space)
  - Offline support via service worker and IndexedDB

Environment variables

See .env.example for required variables. Highlights:

- POSTGRES_URL
- REDIS_URL
- JWT_SECRET
- BACKEND_PORT (default 4000) and FRONTEND_PORT (default 3000)
- APP_ORIGIN and API_ORIGIN (CORS, links)

Development workflow

- Use docker compose for db/redis and app containers.
- Hot reload via local dev servers (backend: ts-node-dev on 4000, frontend: next dev on 3000).
- Backend container publishes on 4001 to avoid conflicts with local dev server.
- Worker can be run locally: `npm run worker:dev` in backend, or via Docker: `docker compose up -d backend_worker`.
- Prisma migrations run in the backend container entrypoint (compose) or with `npx prisma migrate dev` locally.
- Note: The backend runtime image now runs `npx prisma generate` to ensure the Prisma Client is present when the container starts.
- Optional: create FTS index to speed search (recommended in dev/prod): `npm run fts:index` from the backend directory.

Roadmap

See project TODOs in this repo’s task tracker. Major milestones:

- Scaffold backend (Express + Prisma) and frontend (Next.js)
- Implement auth, feeds, subscriptions, items
- Implement fetcher worker and FTS-based search
- Implement sharing and offline support

License

MIT

## Keyboard shortcuts

- j / ArrowDown: Next item
- k / ArrowUp: Previous item
- m: Toggle read/unread
- s: Toggle star
- h: Share/unshare
- o / Enter: Open item URL in a new tab

## API endpoints (development)

Auth

- POST /auth/signup
- POST /auth/login

Health and profile

- GET /health
- GET /me (auth required)

Feeds

- GET /feeds
- POST /feeds
- GET /feeds/:id
- PATCH /feeds/:id
- DELETE /feeds/:id
- POST /feeds/:id/fetch (enqueue immediate fetch)

Folders

- GET /folders
- POST /folders
- PATCH /folders/:id
- DELETE /folders/:id

Subscriptions

- GET /subscriptions
- POST /subscriptions
- PATCH /subscriptions/:id
- DELETE /subscriptions/:id

Items

- GET /items
  - Query params:
    - page, pageSize
    - feedId, folderId, tag
    - read, starred, shared, archived (string "true"/"false")
    - dateFrom, dateTo (ISO date)
    - q (simple text match)
    - order ("asc" | "desc")
- POST /items/:id/state
  - Body: { read?: boolean, starred?: boolean, shared?: boolean, archived?: boolean }
- POST /items/mark-read-bulk
  - Body: { itemIds?: string[], feedId?: string, olderThan?: ISODate }
- POST /items/dev-create (non-production only)

Search (PostgreSQL FTS)

- GET /search
  - Query params:
    - q (required), page, pageSize, order ("relevance" | "date")
    - Advanced filters (optional): feedId, folderId, tag, read, starred, shared, archived

Saved searches

- GET /saved-searches
- POST /saved-searches
  - Body: { name: string, query: string, filters?: any }
- PATCH /saved-searches/:id
  - Body: { name?: string, query?: string, filters?: any }
- DELETE /saved-searches/:id

Sharing

- POST /sharing/items/:id/share
  - Body: { share: boolean, note?: string | null }
- GET /sharing/me (auth): current user’s shared items
- GET /sharing/:username/rss (public): RSS of a user’s shared items

OPML

- POST /opml/import
- GET /opml/export

## Sharing

- From the items list, click “Share” or press h to toggle sharing. Shared items display a “Shared” badge.
- Manage your shared items at the frontend route /sharing (lists items with an Unshare action and shows your public RSS URL).
- Public RSS feed URL pattern: http://localhost:4000/sharing/:username/rss

## Configuration tips

- Frontend uses NEXT_PUBLIC_API_ORIGIN for API calls.
  - Local dev (hot reload): set [NEXT_PUBLIC_API_ORIGIN](frontend/.env.local:1) to http://localhost:4000 and run the backend dev server on 4000.
  - Docker Compose: the frontend image is built with NEXT_PUBLIC_API_ORIGIN=http://localhost:4001 via a build arg (see [docker-compose.yml](docker-compose.yml:60)). This ensures Next.js inlines the correct API origin at build time.
- Databases and queues (default dev ports):
  - Postgres: localhost:5433 (container listens on 5432 internally)
  - Redis: localhost:6380 (container listens on 6379 internally)
- API dev server runs on 4000; backend container publishes 4001 to avoid conflicts.
- Create the FTS index for best search performance (from backend directory): npm run fts:index

## Offline mode

Readerly supports working offline:

- App shell caching: Core UI loads even without a network connection.
- Static assets: Next.js static assets are served cache-first by the service worker.
- API GETs: Network-first with fallback to cached responses (same-origin only).
- IndexedDB caching: Lists of items are cached per filter/search. If a GET fails, the UI falls back to the last cached list.
- Offline write queue: POST/PATCH/DELETE requests are queued on network errors and automatically flushed on reconnect and app start.

Tips:

- To clear offline data, remove the site’s storage (Application tab → Clear storage) and unregister the service worker.
- Service worker is registered in the frontend app automatically on load.
- The service worker file is located at [frontend/public/service-worker.js](frontend/public/service-worker.js).
- IndexedDB logic is in [frontend/lib/offlineStore.ts](frontend/lib/offlineStore.ts).
- API wrapper (with offline queue) is in [frontend/lib/api.ts](frontend/lib/api.ts).

## Theming

- Light/dark theme with a persistent toggle in the UI.
- The theme preference is stored in localStorage and applied early via a small inline script in [frontend/app/layout.tsx](frontend/app/layout.tsx).
- Tailwind is configured with dark mode class strategy in [frontend/tailwind.config.ts](frontend/tailwind.config.ts).

## Testing and coverage

Backend tests and coverage:

- Run tests (from backend directory):
  - npm run test
- Generate coverage (V8 provider) and HTML report (from backend directory):
  - npm run test:coverage
  - Open backend/coverage/index.html to view the report

Notes:

- The CI workflow runs tests with coverage headlessly and uploads the HTML report as an artifact.
- No coverage badge or external coverage service is configured.

## CI

Workflow: .github/workflows/ci.yml

- Provisions Postgres and Redis services
- Generates Prisma client and applies migrations
- Creates the PostgreSQL FTS index for search performance
- Runs Vitest with V8 coverage via npm run test:coverage
- Uploads the coverage HTML artifact located at backend/coverage

To view CI coverage locally:

- Pull the artifact from the GitHub Actions run and open backend/coverage/index.html
