# Copilot / AI Agent Instructions — Personal Supabase-Lite (Fastify + Postgres + MinIO)

## Goal

Build a personal self-hosted backend platform similar to Supabase (subset):

- Admin Dashboard (Next.js) to create/manage Projects
- Each Project has its own Postgres database (db-per-project)
- File storage similar to Supabase buckets (private only) using MinIO (S3-compatible)
- Public API endpoints consumable by Next.js/T3 apps hosted on Vercel
- Admin routes protected by Cloudflare Access (only owner)
- Runs via Docker Compose on Windows dev (amd64) and Raspberry Pi 5 (arm64)
- Exposed publicly only via Cloudflare Tunnel

## Stack

- Backend: Node.js 20+ + TypeScript + Fastify
- Validation: Zod
- Postgres client: `pg`
- Storage: AWS SDK v3 for S3 + presigned URLs (MinIO)
- Dashboard: Next.js App Router + shadcn/ui + Monaco SQL editor
- Auth:
  - Admin: Cloudflare Access JWT verification (JWKS); dev fallback token
  - Public: per-project API keys (publishable + secret), store only SHA-256 hashes

## Architecture

Postgres instance contains:

1. Control-plane DB `platform` with tables:
   - projects, api_keys, project_db_creds, buckets, file_metadata, audit_logs
2. Project DBs `proj_<projectId>` created dynamically

Project DB roles:

- `proj_<id>_owner`: full privileges (admin SQL editor)
- `proj_<id>_app`: limited privileges for public CRUD API

MinIO:

- bucket per project: `proj-<projectId>`
- logical bucket = prefix: `<bucketName>/<path>`

Cloudflare:

- Tunnel routes:
  - admin.<domain> -> dashboard
  - api.<domain> -> gateway
- Access policy protects admin.<domain> and /admin routes

## Security requirements (mandatory)

### API keys

- Generate >= 32 bytes randomness, base64url.
- Store only SHA-256 hash (never plaintext).
- Constant-time compare.
- Support rotation + revocation.
- Never log keys or auth headers.

### Admin auth

- Prod: verify Cloudflare Access JWT signature (JWKS), `aud`, `iss`, and expiry.
- Dev: allow header `x-dev-admin-token: <DEV_ADMIN_TOKEN>`.

### Public auth

- Require `x-api-key`.
- Resolve project + key type (publishable/secret) from hashes.
- Apply per-project rate limiting.
- Body limits: default 1–2MB for JSON.

### SQL safety

- Admin SQL editor:
  - single statement only (reject semicolons that indicate multiple statements)
  - set `statement_timeout` (e.g. 5s) and max rows (e.g. LIMIT 5000 enforced for SELECT)
  - deny dangerous commands (COPY ... PROGRAM, DO $$, CREATE EXTENSION (optional), pg_sleep abuse)
  - execute ONLY within that project DB (never platform DB)
- Public CRUD API:
  - NEVER accept raw SQL from clients.
  - Use only whitelisted table/column names discovered from information_schema.
  - All values are parameterized.

## Performance constraints (Pi 8GB, shared host)

- Keep services minimal: postgres, minio, gateway, dashboard, cloudflared
- Small PG pool sizes (e.g. 5–10)
- Pagination everywhere
- Request timeouts
- Avoid large uploads through gateway; always use presigned URLs to MinIO

## Provisioning rules (db-per-project)

On create project:

1. Insert project in platform DB
2. Create DB `proj_<id>`
3. Create roles:
   - owner: `proj_<id>_owner` (full)
   - app: `proj_<id>_app` (limited)
4. Store encrypted connection strings in platform DB using AES-256-GCM with PLATFORM_MASTER_KEY
5. Create MinIO bucket `proj-<id>`
6. Create default logical buckets entries in platform DB (e.g. `private`, `uploads`)

## Public CRUD REST API (Decision A)

All endpoints require `x-api-key`. Base path: `/v1/db`.

### Table discovery

- GET `/v1/db/tables`
  - returns list of tables + columns (or a separate columns endpoint)

### Select (read)

- GET `/v1/db/:table`
  Query params (Supabase-like):
- `select=*|col1,col2`
- `limit=`, `offset=`, `order=col.asc|col.desc`
- filters:
  - `eq.<col>=<value>`
  - `neq.<col>=<value>`
  - `lt.<col>=<value>`
  - `lte.<col>=<value>`
  - `gt.<col>=<value>`
  - `gte.<col>=<value>`
  - `like.<col>=<value>`
  - `ilike.<col>=<value>`
  - `in.<col>=a,b,c`
    Implementation rule: parse filters into parameterized SQL, validate table/column.

### Insert

- POST `/v1/db/:table`
  Body: `{ "rows": [ { ... } ] }`
  Return inserted rows (optional, configurable).

### Update

- PATCH `/v1/db/:table`
  Query must include filter(s) to avoid full-table updates.
  Body: `{ "values": { ... } }`
  Return updated rows (optional).

### Delete

- DELETE `/v1/db/:table`
  Query must include filter(s) to avoid full-table deletes.
  Return count or deleted rows.

### Safety constraints for CRUD API

- Max rows returned: 1000 (default 100, configurable)
- Enforce required filters for PATCH/DELETE
- Deny modifying schema from public API (no DDL)
- Optional: allow secret key to bypass some limits, but still safe

## Storage API (private only)

Base path: `/v1/storage`

- POST `/v1/storage/signed-upload` -> presigned PUT
- GET `/v1/storage/signed-download` -> presigned GET
- GET `/v1/storage/list` -> list objects for bucketName prefix (admin or secret-only)
- DELETE `/v1/storage/object` -> delete object

## Deliverables

- docker-compose for local and Pi
- gateway with admin + public routes
- platform DB migrations
- dashboard UI with Projects + Storage + DB viewer + SQL editor
- README: setup + Cloudflare Tunnel + Access policy + backups

## Usage docs (must be created and kept up to date)

Create and maintain `docs/USAGE.md` and `docs/QUICKSTART.md` that explain how to use AtlasHub from apps (Next.js/T3 on Vercel).

### docs/QUICKSTART.md must include

- What AtlasHub is (1 paragraph)
- Required env vars in an app:
  - `ATLASHUB_API_URL` (e.g. https://api.<domain>)
  - `ATLASHUB_PUBLISHABLE_KEY`
  - `ATLASHUB_SECRET_KEY` (server only)
- Which key to use where:
  - Browser / client components: publishable key only (preferably avoid direct DB writes from browser)
  - Server actions / API routes / backend: secret key
- Basic “test call” examples:
  - list tables
  - select rows
  - upload file (signed URL flow)

### docs/USAGE.md must include (precise API usage)

#### Authentication

- All public endpoints require header: `x-api-key: <key>`
- Explain publishable vs secret key permissions
- Explain common error codes (401 invalid key, 403 not allowed, 429 rate limit)

#### Public DB CRUD REST API

Base: `${ATLASHUB_API_URL}/v1/db`

1. Discover tables:

- `GET /v1/db/tables`
- Example request + example response shape

2. Select rows:

- `GET /v1/db/:table?select=*&limit=50&offset=0&order=created_at.desc&eq.id=123`
- Document supported operators:
  - `eq.<col>`, `neq.<col>`, `lt.<col>`, `lte.<col>`, `gt.<col>`, `gte.<col>`, `like.<col>`, `ilike.<col>`, `in.<col>`
- Document `select`, `limit`, `offset`, `order`
- Document pagination behavior and max rows limit

3. Insert:

- `POST /v1/db/:table`
- Body: `{ "rows": [ { ... } ] }`
- Show example

4. Update:

- `PATCH /v1/db/:table?eq.id=123`
- Body: `{ "values": { ... } }`
- Must require at least one filter
- Show example

5. Delete:

- `DELETE /v1/db/:table?eq.id=123`
- Must require at least one filter
- Show example

#### Public Storage API (private buckets)

Base: `${ATLASHUB_API_URL}/v1/storage`

1. Signed upload:

- `POST /v1/storage/signed-upload`
- Body: `{ "bucket": "uploads", "path": "notes/<uuid>.png", "contentType": "image/png", "maxSize": 5242880 }`
- Response: `{ "objectKey": "...", "uploadUrl": "...", "expiresIn": 3600 }`

2. Upload bytes directly to MinIO via `uploadUrl`:

- Example with `fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } })`

3. Signed download:

- `GET /v1/storage/signed-download?bucket=uploads&objectKey=uploads/notes/<uuid>.png`
- Response: `{ "downloadUrl": "...", "expiresIn": 3600 }`

4. Recommended pattern:

- Store `objectKey` in your app DB table (via AtlasHub DB CRUD API)
- Generate signed download URLs when needed (server-side if possible)

#### Next.js/T3 examples (must be included)

- Server Action example for DB select/insert using secret key
- Route handler example for signed upload + returning uploadUrl to client
- Client example using uploadUrl to PUT the file
- Example `.env` snippet

#### Safety guidance (must be included)

- Do NOT run arbitrary SQL from public clients
- Prefer secret key on server side for write operations
- Use publishable key only for minimal reads or requesting signed URLs if permitted

## Frontend design guidance (important)

When working on the Dashboard UI, the agent MUST leverage Claude-style frontend design strengths:

- Prioritize clean, modern UI/UX suitable for an internal admin platform
- Use shadcn/ui components consistently
- Focus on:
  - clear visual hierarchy
  - good spacing and typography
  - readable tables and forms
  - subtle but useful feedback states (loading, error, success)
- Prefer pragmatic, production-ready layouts over flashy animations
- Optimize for clarity and speed of use, not marketing visuals

### Dashboard design expectations

- Dark-mode friendly by default
- Dense but readable layouts (admin-style, not landing-page style)
- SQL editor page should feel similar to:
  - Supabase SQL editor
  - PlanetScale / Neon dashboards
- Tables should support:
  - pagination
  - column truncation
  - copy-to-clipboard
  - empty/loading states

### Tools

- Use shadcn/ui + Tailwind only
- Use Monaco Editor for SQL editor
- Avoid unnecessary animation libraries unless they improve usability

The goal is a **professional internal admin dashboard**, not a public-facing marketing site.

## New Module: Cron Jobs / Scheduler (Supabase-like scheduled functions)

### Goal

Provide scheduled tasks similar to Vercel Cron (but self-hosted), tightly integrated with AtlasHub:

- schedule cron expressions per project
- run HTTP tasks and internal platform tasks (backup, cleanup, migrations)
- store run history, status, and logs
- send notifications to Discord/email on failures and important events

### Architecture

Add a new service to docker-compose:

- `scheduler` (Node.js + TS)
  - reads enabled jobs from platform DB
  - triggers executions (HTTP calls or internal platform actions)
  - writes run results to `job_runs`
  - stores large logs to MinIO via AtlasHub storage API (optional)

### Types of jobs (MVP first)

- `HTTP_JOB` (MVP): scheduled request to a URL
  - supports method (GET/POST), headers, JSON body, timeout, retries/backoff
- `PLATFORM_JOB` (phase 2): internal actions (backup/export/import/cleanup)
  - must be allowlisted (no arbitrary shell)

### Tables (platform DB)

Add:

- `cron_jobs`:
  - id, project_id (nullable for global jobs), name, type (http|platform)
  - schedule_cron, timezone
  - http_url, http_method, http_headers_json, http_body_json (nullable)
  - enabled, timeout_ms, retries, retry_backoff_ms
  - created_at, updated_at
- `cron_job_runs`:
  - id, job_id, started_at, finished_at
  - status (success|fail|timeout)
  - http_status, duration_ms
  - error_text
  - log_object_key (optional, for storage logs)

### Security requirements

- HTTP_JOB targets must be allowlisted by default:
  - allow only internal domains you control OR explicit allowlist in config
- Secrets (tokens/headers) must be stored encrypted in platform DB using PLATFORM_MASTER_KEY.
- Never log secrets.

### Dashboard UI

Add:

- Cron Jobs page:
  - list jobs, enable/disable, run now
  - job form (cron, timezone, URL/method)
  - run history with status + view logs
- Integrate with notifications.

---

## New Module: Auth (Minimal, but production-ready)

### Admin Auth (existing)

- Keep Cloudflare Access JWT verification for admin dashboard
- Dev fallback token stays

### Public Auth (for apps using AtlasHub)

Add optional auth module for end-user login (minimal version):

- Email + password OR magic link (pick simplest first)
- Issue JWT access tokens and refresh tokens
- Store users per project (db-per-project OR platform DB with project_id)
- RBAC roles (optional initially): owner/admin/member

### Deliverable requirements

- Endpoints:
  - POST `/v1/auth/signup`
  - POST `/v1/auth/login`
  - POST `/v1/auth/refresh`
  - POST `/v1/auth/logout`
  - GET `/v1/auth/me`
- Password storage:
  - argon2 or bcrypt with strong params
- Rate limiting on login endpoints
- Audit log login events (platform DB)

Note: This auth is optional for “public apps”; admin area remains Cloudflare Access protected.

---

## Database Conveniences (MVP required)

### 1) Migrations (platform DB)

- Add a migrations system for the platform DB schema:
  - store executed migrations in `platform_migrations` table
  - migration runner command: `pnpm migrate` (or node script)
- Migrations must be idempotent and safe.

### 2) Backups

Provide backup functionality:

- Platform DB backup (and optionally per-project DB backup)
- Store backup files in MinIO (preferred) using AtlasHub storage
- Support retention policy (e.g., keep last 7 or 14)

Required capabilities:

- Manual backup trigger from Dashboard
- Scheduled backups via Cron Jobs module
- Download signed URL for backup file

### 3) Import / Export

Implement import/export at two levels:

- Export full database (platform or project DB) -> file
- Export single table -> CSV or JSON
- Import full DB (restore) OR import table (CSV/JSON) with clear warnings

Safety requirements:

- Imports must be admin-only
- Validate file size limits and content type
- For table import:
  - map columns
  - optional upsert mode (by primary key)
- For full DB restore:
  - require confirmation step + clearly documented rollback strategy

### 4) Admin UI

Add a “Database Tools” section to Dashboard:

- Migrations status
- Backup list + “Create backup”
- Import/export UI:
  - select DB (platform / proj\_<id>)
  - select table or full DB
  - format selection (CSV/JSON/SQL dump)
  - signed URL flow for upload/download

---

## Deliverables Update (additions)

In addition to existing deliverables, the agent MUST deliver:

- `scheduler` service (cron jobs MVP)
- DB migrations system
- backup/export/import endpoints and UI pages
- docs updates:
  - `docs/USAGE.md` updated with new endpoints (auth, cron, db tools)
  - `docs/QUICKSTART.md` updated with examples

Definition of Done (extended):

- Create/edit cron job + run history is visible
- Scheduled backups work (store to MinIO)
- Manual export/import works for at least one table in a project DB
- Platform migrations run cleanly on Pi and Windows dev
