# AtlasHub API Usage Guide

This document provides complete API documentation for integrating AtlasHub with your applications.

## Base URL

All API requests should be made to your AtlasHub gateway URL:

```
https://api.yourdomain.com
```

## Authentication

All public endpoints require an API key in the `x-api-key` header:

```http
GET /v1/db/tables
x-api-key: pk_xxxxxxxxxxxxxxxxxxxxxxxx
```

### Key Types

| Key Type        | Prefix | Permissions                                              |
| --------------- | ------ | -------------------------------------------------------- |
| **Publishable** | `pk_`  | Read tables, select rows, request signed URLs            |
| **Secret**      | `sk_`  | All above + insert, update, delete, list storage objects |

### Security Rules

1. **Never expose the secret key** in client-side code
2. Store the secret key only in server-side environment variables
3. Use the publishable key for client-side operations (minimal reads only)
4. All keys should be rotated periodically through the dashboard

---

## Public Database CRUD REST API

Base path: `${ATLASHUB_API_URL}/v1/db`

### Discover Tables

Get a list of all tables and their columns in your project database.

```http
GET /v1/db/tables
x-api-key: <your-key>
```

**Response:**

```json
{
  "data": [
    {
      "tableName": "users",
      "columns": [
        { "name": "id", "type": "uuid", "nullable": false, "defaultValue": "gen_random_uuid()" },
        { "name": "email", "type": "character varying", "nullable": false, "defaultValue": null },
        { "name": "name", "type": "text", "nullable": true, "defaultValue": null },
        {
          "name": "created_at",
          "type": "timestamp with time zone",
          "nullable": false,
          "defaultValue": "now()"
        }
      ]
    }
  ]
}
```

---

### Select Rows

Read rows from a table with filtering, pagination, and ordering.

```http
GET /v1/db/:table
x-api-key: <your-key>
```

**Query Parameters:**

| Parameter | Description                                | Example           |
| --------- | ------------------------------------------ | ----------------- |
| `select`  | Columns to return (comma-separated or `*`) | `id,name,email`   |
| `order`   | Sort by column with direction              | `created_at.desc` |
| `limit`   | Maximum rows (default: 100, max: 1000)     | `50`              |
| `offset`  | Skip rows for pagination                   | `100`             |

**Filter Operators:**

Filters use the format `operator.column=value` in query params:

| Operator       | SQL Equivalent                   | Example                    |
| -------------- | -------------------------------- | -------------------------- |
| `eq.column`    | `= value`                        | `eq.id=123`                |
| `neq.column`   | `!= value`                       | `neq.status=deleted`       |
| `lt.column`    | `< value`                        | `lt.age=30`                |
| `lte.column`   | `<= value`                       | `lte.price=100`            |
| `gt.column`    | `> value`                        | `gt.created_at=2024-01-01` |
| `gte.column`   | `>= value`                       | `gte.score=80`             |
| `like.column`  | `LIKE value`                     | `like.name=%john%`         |
| `ilike.column` | `ILIKE value` (case-insensitive) | `ilike.email=%@gmail.com`  |
| `in.column`    | `IN (values)`                    | `in.status=active,pending` |

**Example Request:**

```http
GET /v1/db/users?select=id,name,email&eq.role=admin&order=created_at.desc&limit=10
x-api-key: sk_xxx
```

**Response:**

```json
{
  "data": [
    { "id": "uuid-1", "name": "Alice", "email": "alice@example.com" },
    { "id": "uuid-2", "name": "Bob", "email": "bob@example.com" }
  ],
  "meta": {
    "rowCount": 2
  }
}
```

---

### Insert Rows

Insert one or more rows into a table. **Requires secret key.**

```http
POST /v1/db/:table
Content-Type: application/json
x-api-key: <secret-key>
```

**Request Body:**

```json
{
  "rows": [
    { "name": "Alice", "email": "alice@example.com" },
    { "name": "Bob", "email": "bob@example.com" }
  ],
  "returning": true
}
```

**Parameters:**

- `rows` (required): Array of objects (max 1000)
- `returning` (optional): Return inserted rows if true

**Response:**

```json
{
  "data": [
    { "id": "uuid-1", "name": "Alice", "email": "alice@example.com", "created_at": "..." },
    { "id": "uuid-2", "name": "Bob", "email": "bob@example.com", "created_at": "..." }
  ]
}
```

---

### Update Rows

Update rows matching filter criteria. **Requires secret key and at least one filter.**

```http
PATCH /v1/db/:table?eq.id=<id>
Content-Type: application/json
x-api-key: <secret-key>
```

**Request Body:**

```json
{
  "values": {
    "name": "Updated Name",
    "updated_at": "2024-01-15T10:00:00Z"
  },
  "returning": true
}
```

**Example:**

```http
PATCH /v1/db/users?eq.id=uuid-1
```

⚠️ **Safety:** At least one filter is required. Updates without filters are rejected to prevent accidental full-table updates.

---

### Delete Rows

Delete rows matching filter criteria. **Requires secret key and at least one filter.**

```http
DELETE /v1/db/:table?eq.id=<id>
x-api-key: <secret-key>
```

**Response:**

```json
{
  "data": {
    "deletedCount": 1
  }
}
```

⚠️ **Safety:** At least one filter is required. Deletes without filters are rejected.

---

## Schema Management (DDL) API

Base path: `${ATLASHUB_API_URL}/v1/db/schema`

All schema management endpoints **require a secret key**. These operations modify your database structure.

### Create Table

Create a new table with specified columns.

```http
POST /v1/db/schema/tables
Content-Type: application/json
x-api-key: <secret-key>
```

**Request Body:**

```json
{
  "name": "posts",
  "columns": [
    {
      "name": "id",
      "type": "uuid",
      "nullable": false,
      "primaryKey": true,
      "defaultValue": "gen_random_uuid()"
    },
    {
      "name": "title",
      "type": "varchar(255)",
      "nullable": false
    },
    {
      "name": "content",
      "type": "text",
      "nullable": true
    },
    {
      "name": "author_id",
      "type": "uuid",
      "nullable": false,
      "references": { "table": "users", "column": "id" }
    },
    {
      "name": "created_at",
      "type": "timestamptz",
      "nullable": false,
      "defaultValue": "now()"
    }
  ],
  "ifNotExists": true
}
```

**Column Options:**

| Option         | Type    | Description                                                    |
| -------------- | ------- | -------------------------------------------------------------- |
| `name`         | string  | Column name (required)                                         |
| `type`         | string  | PostgreSQL data type (required)                                |
| `nullable`     | boolean | Allow NULL values (default: true)                              |
| `primaryKey`   | boolean | Part of primary key                                            |
| `unique`       | boolean | Add UNIQUE constraint                                          |
| `defaultValue` | string  | Default value (e.g., `now()`, `gen_random_uuid()`, `'active'`) |
| `references`   | object  | Foreign key: `{table, column}`                                 |

**Allowed Data Types:**

`text`, `varchar`, `char`, `integer`, `int`, `bigint`, `smallint`, `serial`, `bigserial`, `boolean`, `bool`, `timestamp`, `timestamptz`, `date`, `time`, `timetz`, `uuid`, `json`, `jsonb`, `numeric`, `decimal`, `real`, `double precision`, `float`, `bytea`

**Response:**

```json
{
  "data": {
    "success": true,
    "tableName": "posts"
  }
}
```

---

### Drop Table

Delete a table from the database.

```http
DELETE /v1/db/schema/tables/:table
Content-Type: application/json
x-api-key: <secret-key>
```

**Request Body (optional):**

```json
{
  "ifExists": true,
  "cascade": true
}
```

**Options:**

- `ifExists`: Don't error if table doesn't exist
- `cascade`: Drop dependent objects (foreign keys, etc.)

---

### Rename Table

Rename an existing table.

```http
PATCH /v1/db/schema/tables/:table/rename
Content-Type: application/json
x-api-key: <secret-key>
```

**Request Body:**

```json
{
  "newName": "articles"
}
```

---

### Add Column

Add a new column to an existing table.

```http
POST /v1/db/schema/tables/:table/columns
Content-Type: application/json
x-api-key: <secret-key>
```

**Request Body:**

```json
{
  "name": "published_at",
  "type": "timestamptz",
  "nullable": true
}
```

---

### Drop Column

Remove a column from a table.

```http
DELETE /v1/db/schema/tables/:table/columns/:column
Content-Type: application/json
x-api-key: <secret-key>
```

**Request Body (optional):**

```json
{
  "ifExists": true,
  "cascade": true
}
```

---

### Rename Column

Rename a column in a table.

```http
PATCH /v1/db/schema/tables/:table/columns/rename
Content-Type: application/json
x-api-key: <secret-key>
```

**Request Body:**

```json
{
  "oldName": "title",
  "newName": "headline"
}
```

---

### Schema Management Examples

**Create a posts table from Next.js:**

```typescript
// app/actions.ts
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
        { name: 'id', type: 'uuid', primaryKey: true, defaultValue: 'gen_random_uuid()' },
        { name: 'title', type: 'varchar(255)', nullable: false },
        { name: 'content', type: 'text' },
        { name: 'created_at', type: 'timestamptz', defaultValue: 'now()' },
      ],
      ifNotExists: true,
    }),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.message || 'Failed to create table');
  }

  return res.json();
}
```

---

## Public Storage API (Private Buckets)

Base path: `${ATLASHUB_API_URL}/v1/storage`

All storage is private. Files are accessed via presigned URLs that expire after a configurable time (default: 1 hour).

### Get Signed Upload URL

Request a presigned URL to upload a file directly to MinIO.

```http
POST /v1/storage/signed-upload
Content-Type: application/json
x-api-key: <your-key>
```

**Request Body:**

```json
{
  "bucket": "uploads",
  "path": "images/profile-123.png",
  "contentType": "image/png",
  "maxSize": 5242880
}
```

**Parameters:**

- `bucket` (required): Logical bucket name (e.g., `uploads`, `private`)
- `path` (required): Path within the bucket
- `contentType` (required): MIME type of the file
- `maxSize` (optional): Maximum file size in bytes (default: no limit, max: 100MB)

**Response:**

```json
{
  "data": {
    "objectKey": "uploads/images/profile-123.png",
    "uploadUrl": "https://minio.../presigned-put-url...",
    "expiresIn": 3600
  }
}
```

**Then upload the file:**

```javascript
await fetch(uploadUrl, {
  method: 'PUT',
  body: file,
  headers: { 'Content-Type': file.type },
});
```

---

### Get Signed Download URL

Request a presigned URL to download a file.

```http
GET /v1/storage/signed-download?bucket=uploads&objectKey=uploads/images/profile-123.png
x-api-key: <your-key>
```

**Response:**

```json
{
  "data": {
    "downloadUrl": "https://minio.../presigned-get-url...",
    "expiresIn": 3600
  }
}
```

---

### List Objects (Secret Key Only)

List files in a bucket. Requires secret key.

```http
GET /v1/storage/list?bucket=uploads&prefix=images/&limit=100
x-api-key: <secret-key>
```

**Response:**

```json
{
  "data": {
    "objects": [
      { "key": "uploads/images/file1.png", "size": 12345, "lastModified": "2024-01-15T..." },
      { "key": "uploads/images/file2.jpg", "size": 67890, "lastModified": "2024-01-14T..." }
    ]
  }
}
```

---

### Delete Object

Delete a file from storage.

```http
DELETE /v1/storage/object?bucket=uploads&objectKey=uploads/images/profile-123.png
x-api-key: <secret-key>
```

**Response:** `204 No Content`

---

## Next.js Code Examples

### Server Action: Fetch Data

```typescript
// app/actions.ts
'use server';

export async function getUsers(page = 1, pageSize = 20) {
  const offset = (page - 1) * pageSize;

  const res = await fetch(
    `${process.env.ATLASHUB_API_URL}/v1/db/users?` +
      `select=id,name,email,created_at&` +
      `order=created_at.desc&` +
      `limit=${pageSize}&` +
      `offset=${offset}`,
    {
      headers: { 'x-api-key': process.env.ATLASHUB_SECRET_KEY! },
      next: { revalidate: 60 }, // Cache for 60 seconds
    }
  );

  if (!res.ok) {
    throw new Error('Failed to fetch users');
  }

  return res.json();
}
```

### Server Action: Insert Data

```typescript
// app/actions.ts
'use server';

import { revalidatePath } from 'next/cache';

export async function createUser(data: { name: string; email: string }) {
  const res = await fetch(`${process.env.ATLASHUB_API_URL}/v1/db/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ATLASHUB_SECRET_KEY!,
    },
    body: JSON.stringify({
      rows: [data],
      returning: true,
    }),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.message || 'Failed to create user');
  }

  revalidatePath('/users');
  return res.json();
}
```

### Route Handler: Signed Upload URL

```typescript
// app/api/upload/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const { filename, contentType, folder = 'uploads' } = await request.json();

  const res = await fetch(`${process.env.ATLASHUB_API_URL}/v1/storage/signed-upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ATLASHUB_SECRET_KEY!,
    },
    body: JSON.stringify({
      bucket: 'uploads',
      path: `${folder}/${Date.now()}-${filename}`,
      contentType,
      maxSize: 10 * 1024 * 1024, // 10MB
    }),
  });

  if (!res.ok) {
    return NextResponse.json({ error: 'Failed to get upload URL' }, { status: 500 });
  }

  return NextResponse.json(await res.json());
}
```

### Client: Upload File

```typescript
// components/FileUpload.tsx
'use client';

import { useState } from 'react';

export function FileUpload({ onUpload }: { onUpload: (key: string) => void }) {
  const [uploading, setUploading] = useState(false);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      // Step 1: Get signed URL from your API
      const urlRes = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
        }),
      });
      const { data } = await urlRes.json();

      // Step 2: Upload directly to MinIO
      await fetch(data.uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      });

      onUpload(data.objectKey);
    } finally {
      setUploading(false);
    }
  }

  return (
    <input
      type="file"
      onChange={handleUpload}
      disabled={uploading}
    />
  );
}
```

---

## Error Responses

All errors follow this format:

```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable description",
  "statusCode": 400,
  "details": {} // Optional additional info
}
```

### Common Error Codes

| Code                | Status | Description                               |
| ------------------- | ------ | ----------------------------------------- |
| `UNAUTHORIZED`      | 401    | Missing or invalid API key                |
| `FORBIDDEN`         | 403    | Operation not allowed with this key       |
| `NOT_FOUND`         | 404    | Table, bucket, or resource not found      |
| `BAD_REQUEST`       | 400    | Invalid request (see message for details) |
| `VALIDATION_ERROR`  | 400    | Request body validation failed            |
| `TOO_MANY_REQUESTS` | 429    | Rate limit exceeded                       |
| `INTERNAL_ERROR`    | 500    | Server error                              |

---

## Pagination

For large datasets, use `limit` and `offset`:

```http
# Page 1 (first 50 items)
GET /v1/db/users?limit=50&offset=0

# Page 2 (next 50 items)
GET /v1/db/users?limit=50&offset=50
```

**Limits:**

- Default: 100 rows
- Maximum: 1000 rows per request

---

## Security Best Practices

1. **Secret Key Protection**
   - Never expose `sk_` keys in client-side code
   - Use environment variables, never commit keys
   - Rotate keys periodically

2. **API Design**
   - Proxy AtlasHub calls through your own API routes
   - Validate/sanitize user input before sending to AtlasHub
   - Don't expose raw AtlasHub errors to end users

3. **Storage**
   - Always request presigned URLs from your server
   - Set appropriate `maxSize` limits
   - Store `objectKey` (not full URLs) in your database

4. **Rate Limiting**
   - AtlasHub applies per-project rate limits
   - Implement your own rate limiting on top for user-facing endpoints
