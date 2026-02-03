# AtlasHub

> **Self-hosted Backend-as-a-Service platform** — A lightweight Supabase alternative with per-project PostgreSQL databases, S3-compatible storage, and a modern admin dashboard.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![Fastify](https://img.shields.io/badge/Fastify-5-white?logo=fastify)](https://fastify.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791?logo=postgresql)](https://www.postgresql.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker)](https://www.docker.com/)

## ✨ Features

### Core Platform

- **🗄️ Database-per-Project** — Each project gets an isolated PostgreSQL database with dedicated roles
- **📦 Private Object Storage** — MinIO S3-compatible storage with presigned upload/download URLs
- **🔐 Secure API Keys** — SHA-256 hashed keys with publishable/secret key separation
- **📊 Admin Dashboard** — Modern Next.js UI with SQL editor, file browser, and real-time settings
- **⚡ REST CRUD API** — Safe, parameterized queries with Supabase-like filter syntax
- **🛠️ Schema Management API** — Create, alter, and drop tables programmatically via API

### DevOps & Automation

- **⏰ Cron Jobs / Scheduler** — Schedule HTTP tasks and platform actions with cron expressions
- **💾 Backups** — Automated and manual database backups stored in MinIO with retention policies
- **📤 Import/Export** — Export tables to CSV/JSON, import data with insert/upsert modes

### Administration

- **🎛️ Runtime Settings** — Live-editable rate limits, database limits, and storage config
- **📝 Audit Logging** — Track all administrative actions and settings changes
- **👥 User Management** — Invite system with admin/regular user roles

### Infrastructure

- **🐳 Docker-Ready** — Works on Windows (amd64) and Raspberry Pi 5 (arm64)
- **☁️ Cloudflare Integration** — Tunnel + Access for secure public exposure
- **🎮 Demo Mode** — Try the dashboard with mock data using `?demo=true`

## 🛠️ Tech Stack

| Layer              | Technology                                                   |
| ------------------ | ------------------------------------------------------------ |
| **Frontend**       | Next.js 16, React 19, Tailwind CSS, shadcn/ui, Monaco Editor |
| **Backend**        | Fastify 5, Node.js 20, TypeScript                            |
| **Database**       | PostgreSQL 16                                                |
| **Storage**        | MinIO (S3-compatible)                                        |
| **Validation**     | Zod                                                          |
| **Infrastructure** | Docker, Cloudflare Tunnel & Access                           |

## 📸 Screenshots

<details>
<summary>Dashboard Overview</summary>

_Coming soon_

</details>

<details>
<summary>SQL Editor</summary>

_Coming soon_

</details>

<details>
<summary>Storage Browser</summary>

_Coming soon_

</details>

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- Docker & Docker Compose

### Local Development

1. **Clone and install dependencies:**

   ```bash
   git clone <repo-url>
   cd atlashub
   pnpm install
   ```

2. **Set up environment:**

   ```bash
   cp .env.example .env
   # Edit .env with your secrets (generate a PLATFORM_MASTER_KEY!)
   ```

3. **Start infrastructure:**

   ```bash
   docker compose --profile dev up -d
   ```

4. **Run migrations:**

   ```bash
   pnpm --filter @atlashub/gateway db:migrate
   ```

5. **Start development servers:**

   ```bash
   pnpm dev
   ```

   - Gateway: http://localhost:3000
   - Dashboard: http://localhost:3001
   - MinIO Console: http://localhost:9001

### Development Auth Bypass

In development mode, use the header `x-dev-admin-token` with your `DEV_ADMIN_TOKEN` value:

```bash
curl http://localhost:3000/admin/projects \
  -H "x-dev-admin-token: dev-secret-token-change-me"
```

## Project Structure

```
atlashub/
├── gateway/               # Fastify API server
│   └── src/
│       ├── routes/        # API routes (admin + public)
│       ├── services/      # Business logic
│       ├── middleware/    # Auth middleware
│       ├── db/            # Database utilities + migrations
│       └── lib/           # Utilities (crypto, query builder)
├── dashboard/             # Next.js admin UI
│   ├── app/               # App router pages
│   ├── components/        # React components
│   └── lib/               # Utilities + API client
├── packages/
│   └── shared/            # Shared Zod schemas + types
├── docs/                  # Documentation
└── docker-compose.yml     # Docker configuration
```

## Deployment

### Raspberry Pi / Production

1. **Build images:**

   ```bash
   docker compose build
   ```

2. **Set production environment:**

   ```bash
   # Edit .env for production values:
   # - Strong passwords
   # - CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUDIENCE
   # - CLOUDFLARE_TUNNEL_TOKEN
   ```

3. **Start services:**
   ```bash
   docker compose up -d
   ```

### Cloudflare Tunnel Setup

1. Create a tunnel in Cloudflare Zero Trust
2. Add routes:
   - `admin.yourdomain.com` → `http://dashboard:3001`
   - `api.yourdomain.com` → `http://gateway:3000`
3. Set the tunnel token in `.env`

### Cloudflare Access Setup

1. Create an Access application for `admin.yourdomain.com`
2. Add your email to the allowed users
3. Copy the audience tag to `CF_ACCESS_AUDIENCE`
4. Set `CF_ACCESS_TEAM_DOMAIN` to your team domain

## API Documentation

See [docs/USAGE.md](docs/USAGE.md) for complete API documentation.

Quick example:

```typescript
// Fetch data from your AtlasHub project
const res = await fetch('https://api.yourdomain.com/v1/db/users?limit=10', {
  headers: {
    'x-api-key': process.env.ATLASHUB_SECRET_KEY,
  },
});
const { data } = await res.json();
```

## Security

- API keys are stored as SHA-256 hashes only
- Project database credentials are encrypted with AES-256-GCM
- Admin routes protected by Cloudflare Access
- Public API accepts no raw SQL, only parameterized CRUD
- Rate limiting per project

## Environment Variables

| Variable                  | Required | Description                            |
| ------------------------- | -------- | -------------------------------------- |
| `POSTGRES_PASSWORD`       | Yes      | Platform database password             |
| `MINIO_ACCESS_KEY`        | Yes      | MinIO access key                       |
| `MINIO_SECRET_KEY`        | Yes      | MinIO secret key                       |
| `PLATFORM_MASTER_KEY`     | Yes      | 32+ char key for credential encryption |
| `DEV_ADMIN_TOKEN`         | Dev      | Development admin bypass token         |
| `CF_ACCESS_TEAM_DOMAIN`   | Prod     | Cloudflare Access team domain          |
| `CF_ACCESS_AUDIENCE`      | Prod     | Cloudflare Access audience tag         |
| `CLOUDFLARE_TUNNEL_TOKEN` | Prod     | Cloudflare Tunnel token                |

See `.env.example` for all options.

## Backup

### Database

```bash
docker exec atlashub-postgres pg_dumpall -U postgres > backup.sql
```

### Storage

```bash
docker run --rm -v atlashub_minio_data:/data -v $(pwd):/backup \
  alpine tar czf /backup/minio-backup.tar.gz /data
```

## License

MIT
