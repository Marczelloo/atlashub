# AtlasHub Agent Instructions

This document explains AtlasHub's architecture, API contracts, and safety constraints for AI agents and developers extending the platform.

## Overview

AtlasHub is a self-hosted backend platform providing:

- **Per-project PostgreSQL databases** (database-per-project isolation)
- **Private file storage** via MinIO (S3-compatible)
- **REST API** for CRUD operations (no raw SQL from public API)
- **Admin dashboard** with SQL editor (raw SQL allowed for admin only)
- **Scheduler** for cron jobs (HTTP webhooks and platform tasks)

## Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                     Cloudflare Tunnel                        │
├──────────────────────┬──────────────────────────────────────┤
│   admin.domain.com   │           api.domain.com             │
│   (CF Access)        │           (Public API)               │
└──────────┬───────────┴──────────────────┬───────────────────┘
           │                              │
           ▼                              ▼
┌──────────────────┐            ┌──────────────────────┐
│    Dashboard     │            │       Gateway        │
│   (Next.js)      │◄──────────►│     (Fastify)        │
└──────────────────┘            └──────────┬───────────┘
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    │                     │                     │
                    ▼                     ▼                     ▼
           ┌────────────────┐   ┌────────────────┐   ┌────────────────┐
           │   Platform DB  │   │  Project DBs   │   │     MinIO      │
           │   (postgres)   │   │  (proj_<id>)   │   │   (Storage)    │
           └───────┬────────┘   └────────────────┘   └────────────────┘
                   │
                   ▼
           ┌────────────────┐
           │   Scheduler    │
           │   (croner)     │
           └────────────────┘
```

## API Contract

### Authentication

| Path Pattern | Auth Method                                  | Description       |
| ------------ | -------------------------------------------- | ----------------- |
| `/admin/*`   | Cloudflare Access JWT or `x-dev-admin-token` | Admin-only routes |
| `/v1/*`      | `x-api-key` header                           | Public API routes |
| `/health/*`  | None                                         | Health checks     |

### Public API Endpoints (prefix: `/v1`)

```bash
# Database CRUD
GET  /v1/db/tables                    # List tables
GET  /v1/db/:table                    # Select rows
POST /v1/db/:table                    # Insert rows
PATCH /v1/db/:table                   # Update rows (filter required)
DELETE /v1/db/:table                  # Delete rows (filter required)

# Schema Management (DDL) - Secret key required
POST   /v1/db/schema/tables                          # Create table
DELETE /v1/db/schema/tables/:table                   # Drop table
PATCH  /v1/db/schema/tables/:table/rename            # Rename table
POST   /v1/db/schema/tables/:table/columns           # Add column
DELETE /v1/db/schema/tables/:table/columns/:column   # Drop column
PATCH  /v1/db/schema/tables/:table/columns/rename    # Rename column

# Storage
POST /v1/storage/signed-upload        # Get presigned PUT URL
GET  /v1/storage/signed-download      # Get presigned GET URL
GET  /v1/storage/list                 # List objects (secret key only)
DELETE /v1/storage/object             # Delete object
```

### Admin API Endpoints (prefix: `/admin`)

```bash
# Projects
GET    /admin/projects                # List all projects
GET    /admin/projects/:id            # Get project details
POST   /admin/projects                # Create project + keys + DB + bucket
DELETE /admin/projects/:id            # Delete project entirely

# API Keys
GET    /admin/projects/:id/keys       # List API keys
POST   /admin/projects/:id/keys/rotate # Rotate a key
DELETE /admin/projects/:id/keys/:keyId # Revoke a key

# SQL Editor
POST   /admin/projects/:id/sql        # Execute SQL (owner privileges)

# Cron Jobs (Scheduler)
GET    /admin/cron                    # List cron jobs
POST   /admin/cron                    # Create cron job
GET    /admin/cron/:id                # Get cron job details
PATCH  /admin/cron/:id                # Update cron job
DELETE /admin/cron/:id                # Delete cron job
POST   /admin/cron/:id/toggle         # Enable/disable cron job
POST   /admin/cron/:id/run            # Manually trigger cron job
GET    /admin/cron/:id/runs           # Get run history

# Backups
GET    /admin/backups                 # List backups
POST   /admin/backups                 # Create backup (platform/project/table)
GET    /admin/backups/:id             # Get backup details
DELETE /admin/backups/:id             # Delete backup
GET    /admin/backups/:id/download    # Get presigned download URL
POST   /admin/backups/cleanup         # Cleanup expired backups

# Data Tools (Import/Export) - Per Project
GET    /admin/projects/:id/data-tools/jobs        # List import/export jobs
POST   /admin/projects/:id/data-tools/export      # Export table to CSV/JSON
POST   /admin/projects/:id/data-tools/import      # Import data
POST   /admin/projects/:id/data-tools/upload-url  # Get presigned upload URL for import
```

## Safety Constraints

### Public API (Critical)

1. **NO RAW SQL ACCEPTED**
   - The public API uses parameterized queries only
   - Table and column names are validated against `information_schema`
   - All filter values are parameterized
   - Never add an endpoint that accepts arbitrary SQL from public clients

2. **REQUIRED FILTERS FOR MUTATIONS**
   - `PATCH /v1/db/:table` requires at least one filter
   - `DELETE /v1/db/:table` requires at least one filter
   - This prevents accidental full-table updates/deletes

3. **ROW LIMITS**
   - Default: 100 rows per query
   - Maximum: 1000 rows per query
   - Enforced server-side

4. **KEY TYPE PERMISSIONS**
   - Publishable (`pk_`): Read-only + storage signed URLs
   - Secret (`sk_`): Full CRUD + storage management
   - Never allow publishable keys to mutate data

### Admin SQL Editor

1. **Single statement only** - Multiple statements (`;`) are rejected
2. **Statement timeout** - Queries timeout after 5 seconds (configurable)
3. **Row limit** - SELECT queries have LIMIT added if not present
4. **Dangerous commands blocked:**
   - `COPY ... PROGRAM`
   - `DO $$ ... $$` (PL/pgSQL blocks)
   - `pg_sleep()`
   - `CREATE EXTENSION`
   - `DROP DATABASE`
   - `DROP ROLE`
   - `ALTER SYSTEM`

### Storage

1. **Private only** - No public URLs, presigned only
2. **Expiry** - Presigned URLs expire (default: 1 hour)
3. **Size limits** - Max upload size configurable (default: 100MB)
4. **Bucket isolation** - Each project has its own MinIO bucket

## Database Structure

### Platform Database (`platform`)

```sql
# Core tables
projects            # Project metadata
api_keys            # Hashed API keys (SHA-256)
project_db_creds    # Encrypted connection strings (AES-256-GCM)
buckets             # Logical bucket definitions
file_metadata       # File tracking
audit_logs          # Audit trail

# Scheduler/Cron tables
cron_jobs           # Scheduled job definitions (HTTP or platform jobs)
cron_job_runs       # Execution history for cron jobs
notification_settings  # Discord/email notification configs

# Backup tables
backups             # Backup records (platform, project, or table)
import_export_jobs  # Import/export job tracking
```

### Project Databases (`proj_<uuid>`)

Each project gets its own database with:

- **Owner role** (`proj_<id>_owner`): Full DDL/DML privileges
- **App role** (`proj_<id>_app`): SELECT/INSERT/UPDATE/DELETE only

The public API uses the `app` role. The admin SQL editor uses the `owner` role.

## Extending AtlasHub

### Adding a New Public Endpoint

1. Add the route in `gateway/src/routes/public/`
2. Validate all input with Zod schemas
3. Use `crudService` or `storageService` - never raw SQL
4. Ensure proper key type checks (`projectContext.keyType`)
5. Update `docs/USAGE.md` with the new endpoint

### Adding a New Admin Endpoint

1. Add the route in `gateway/src/routes/admin/`
2. Admin auth is already applied via `adminAuthMiddleware`
3. Log important actions to audit_logs
4. Update the dashboard UI if needed

### Modifying the Database Schema

1. Create a new migration file in `gateway/src/db/migrations/`
2. Follow the naming convention: `00X_description.sql`
3. Add the migration name to the array in `run.ts`
4. Test on a local instance before deploying

### Adding New Storage Features

1. All storage goes through presigned URLs
2. Never proxy file bytes through the gateway
3. Validate bucket/path names against patterns
4. Clean up `file_metadata` when deleting files

## Backward Compatibility

When making changes:

1. **API responses**: Add new fields, don't remove or rename existing ones
2. **Query parameters**: New parameters should have defaults
3. **Database**: Use migrations, never break existing tables
4. **API keys**: Never change key format (`pk_`/`sk_` prefix)

## Error Handling

All errors return:

```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable message",
  "statusCode": 400,
  "details": {}
}
```

Use the predefined error classes in `gateway/src/lib/errors.ts`:

- `BadRequestError` (400)
- `UnauthorizedError` (401)
- `ForbiddenError` (403)
- `NotFoundError` (404)
- `ConflictError` (409)
- `TooManyRequestsError` (429)
- `InternalError` (500)

## Configuration

All configuration is via environment variables. See `.env.example` for a complete list. Critical ones:

| Variable                                       | Purpose                         |
| ---------------------------------------------- | ------------------------------- |
| `PLATFORM_MASTER_KEY`                          | Encrypts project DB credentials |
| `POSTGRES_PASSWORD`                            | Platform database password      |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY`        | Object storage credentials      |
| `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUDIENCE` | Cloudflare Access config        |
| `DEV_ADMIN_TOKEN`                              | Dev-mode admin bypass           |

## Testing

When adding features:

1. Test locally with `pnpm dev`
2. Use the `DEV_ADMIN_TOKEN` for admin endpoints
3. Create a test project and verify CRUD operations
4. Test with both publishable and secret keys
5. Verify error cases return proper error responses

## Deployment

1. Build with `pnpm build`
2. Run `docker compose up -d` for production
3. Configure Cloudflare Tunnel to route:
   - `admin.yourdomain.com` → dashboard:3001
   - `api.yourdomain.com` → gateway:3000
4. Set up Cloudflare Access policy for admin subdomain
