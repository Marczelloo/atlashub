# AtlasHub Quick Start Guide

AtlasHub is a self-hosted backend platform similar to Supabase. It provides per-project PostgreSQL databases and private file storage (MinIO), accessible via a REST API with API key authentication. Your apps (Next.js, T3, etc.) call AtlasHub endpoints over HTTPS.

## Prerequisites

Before integrating AtlasHub with your app, you need:

1. **AtlasHub running** with a Cloudflare Tunnel exposing the API (e.g., `https://api.yourdomain.com`)
2. **A project created** in the AtlasHub dashboard
3. **API keys** from that project (publishable and secret)

## Environment Variables

Add these to your app's `.env.local` (or equivalent):

```bash
# AtlasHub API URL (your Cloudflare Tunnel endpoint)
ATLASHUB_API_URL=https://api.yourdomain.com

# Public key - safe for client (limited permissions)
NEXT_PUBLIC_ATLASHUB_PUBLISHABLE_KEY=pk_xxxxxxxxxxxxxxxxxxxxxxxx

# Secret key - SERVER ONLY (full permissions)
ATLASHUB_SECRET_KEY=sk_xxxxxxxxxxxxxxxxxxxxxxxx
```

## Which Key to Use Where

| Context                                   | Key                                    | Why                                   |
| ----------------------------------------- | -------------------------------------- | ------------------------------------- |
| **Server Actions / API Routes / Backend** | `ATLASHUB_SECRET_KEY`                  | Full access, never exposed to clients |
| **Client components (if needed)**         | `NEXT_PUBLIC_ATLASHUB_PUBLISHABLE_KEY` | Limited access, safe for browsers     |

> **Best Practice:** Always use the secret key on the server. Only use the publishable key on the client if you need to request signed upload URLs directly from the browser.

## Quick Test: List Tables

### Server-side (Recommended)

```typescript
// app/actions.ts
'use server';

export async function listTables() {
  const res = await fetch(`${process.env.ATLASHUB_API_URL}/v1/db/tables`, {
    headers: {
      'x-api-key': process.env.ATLASHUB_SECRET_KEY!,
    },
  });

  if (!res.ok) throw new Error('Failed to fetch tables');
  return res.json();
}
```

### Client-side (if needed)

```typescript
// Only use publishable key on client
const response = await fetch(`${process.env.NEXT_PUBLIC_ATLASHUB_API_URL}/v1/db/tables`, {
  headers: {
    'x-api-key': process.env.NEXT_PUBLIC_ATLASHUB_PUBLISHABLE_KEY!,
  },
});
```

## Quick Test: Select Rows

```typescript
// app/actions.ts
'use server';

export async function getUsers() {
  const res = await fetch(
    `${process.env.ATLASHUB_API_URL}/v1/db/users?select=id,name,email&limit=10&order=created_at.desc`,
    {
      headers: {
        'x-api-key': process.env.ATLASHUB_SECRET_KEY!,
      },
    }
  );

  if (!res.ok) throw new Error('Failed to fetch users');
  const data = await res.json();
  return data.data; // array of user objects
}
```

## Quick Test: Upload a File

File uploads use a two-step process with presigned URLs:

### Step 1: Get a Signed Upload URL (Server)

```typescript
// app/api/upload-url/route.ts
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const { filename, contentType } = await request.json();

  const res = await fetch(`${process.env.ATLASHUB_API_URL}/v1/storage/signed-upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ATLASHUB_SECRET_KEY!,
    },
    body: JSON.stringify({
      bucket: 'uploads',
      path: `files/${filename}`,
      contentType,
      maxSize: 10 * 1024 * 1024, // 10MB
    }),
  });

  if (!res.ok) throw new Error('Failed to get upload URL');
  return NextResponse.json(await res.json());
}
```

### Step 2: Upload Directly to MinIO (Client)

```typescript
// components/FileUpload.tsx
'use client';

async function uploadFile(file: File) {
  // Get signed URL from your API route
  const urlRes = await fetch('/api/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type,
    }),
  });

  const { data } = await urlRes.json();

  // Upload directly to MinIO
  await fetch(data.uploadUrl, {
    method: 'PUT',
    body: file,
    headers: {
      'Content-Type': file.type,
    },
  });

  return data.objectKey; // Store this in your database
}
```

## Next Steps

- Read [USAGE.md](USAGE.md) for complete API documentation
- Create tables programmatically using the Schema API (see below)
- Set up your project tables using the SQL Editor in the dashboard
- Configure your Cloudflare Tunnel for production

## Create Tables Programmatically

Instead of using the SQL Editor, you can create tables via the Schema API (requires secret key):

```typescript
// app/setup.ts - Run once during app initialization
'use server';

export async function createPostsTable() {
  const res = await fetch(`${process.env.ATLASHUB_API_URL}/v1/db/schema/tables`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ATLASHUB_SECRET_KEY!,
    },
    body: JSON.stringify({
      name: 'posts',
      columns: [
        { name: 'id', type: 'uuid', primaryKey: true, default: 'gen_random_uuid()' },
        { name: 'title', type: 'text', nullable: false },
        { name: 'content', type: 'text' },
        { name: 'created_at', type: 'timestamptz', default: 'now()' },
      ],
    }),
  });

  if (!res.ok) throw new Error('Failed to create table');
  return res.json();
}
```

## Common Errors

| Code | Meaning                    | Solution                                |
| ---- | -------------------------- | --------------------------------------- |
| 401  | Invalid or missing API key | Check your `x-api-key` header           |
| 403  | Operation not allowed      | Use secret key instead of publishable   |
| 429  | Rate limited               | Wait and retry, or increase rate limits |
| 404  | Resource not found         | Check table/bucket name exists          |
