# AtlasHub Complete API Reference

This document provides comprehensive documentation for ALL AtlasHub API endpoints.

## Table of Contents

- [Base URLs](#base-urls)
- [Authentication](#authentication)
- [Health Endpoints](#health-endpoints)
- [Authentication Endpoints](#authentication-endpoints)
- [Public Database API](#public-database-api)
- [Public Storage API](#public-storage-api)
- [Admin API](#admin-api)
  - [Projects](#admin-projects)
  - [Data Tools (Import/Export)](#admin-data-tools)
  - [Database Administration](#admin-database)
  - [Backups](#admin-backups)
  - [Storage Management](#admin-storage)
  - [User Management](#admin-users)
  - [Invite Management](#admin-invites)
  - [Cron Jobs](#admin-cron)
  - [Settings](#admin-settings)
  - [Statistics](#admin-stats)
- [Error Responses](#error-responses)

---

## Base URLs

| Environment | Gateway URL | Dashboard URL |
|-------------|-------------|---------------|
| Development | `http://localhost:3000` | `http://localhost:3001` |
| Production | `https://api.yourdomain.com` | `https://admin.yourdomain.com` |

---

## Authentication

### API Key Authentication (Public API)

All public API endpoints require an API key in the `x-api-key` header:

```http
GET /v1/db/tables
x-api-key: pk_xxxxxxxxxxxxxxxxxxxxxxxx
```

| Key Type | Prefix | Permissions |
|----------|--------|-------------|
| **Publishable** | `pk_` | Read tables, select rows, request signed URLs |
| **Secret** | `sk_` | All operations including write, delete, schema management, list storage |

### Session Authentication (Admin API)

Admin endpoints require either:
- Cookie-based session (`atlashub_session` from login)
- Development token (`x-dev-admin-token` header in dev mode)

---

## Health Endpoints

### Check Service Status

```http
GET /health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:00:00Z"
}
```

### Check Database Connection

```http
GET /health/ready
```

**Response:**
```json
{
  "status": "ok",
  "database": "connected"
}
```

---

## Authentication Endpoints

### Login

```http
POST /auth/login
Content-Type: application/json
```

**Request Body:**
```json
{
  "email": "admin@example.com",
  "password": "your-password"
}
```

**Response:**
```json
{
  "data": {
    "id": "uuid",
    "email": "admin@example.com",
    "role": "admin"
  }
}
```

### Register (with Invite Key)

```http
POST /auth/register
Content-Type: application/json
```

**Request Body:**
```json
{
  "email": "newuser@example.com",
  "password": "password-min-8-chars",
  "inviteKey": "invite-key-uuid"
}
```

### Logout

```http
POST /auth/logout
```

### Get Current User

```http
GET /auth/me
```

**Response:**
```json
{
  "data": {
    "id": "uuid",
    "email": "admin@example.com",
    "role": "admin",
    "createdAt": "2024-01-15T10:00:00Z"
  }
}
```

### Check Setup Status

```http
GET /auth/setup-status
```

**Response:**
```json
{
  "data": {
    "setupRequired": false
  }
}
```

### Initial Admin Setup

Only available when no users exist.

```http
POST /auth/setup
Content-Type: application/json
```

**Request Body:**
```json
{
  "email": "admin@example.com",
  "password": "secure-password-min-8-chars"
}
```

---

## Public Database API

Base path: `/v1/db`

All endpoints require `x-api-key` header.

### List Tables

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
        { "name": "created_at", "type": "timestamp with time zone", "nullable": false, "defaultValue": "now()" }
      ]
    }
  ]
}
```

### Select Rows

```http
GET /v1/db/:table
x-api-key: <your-key>
```

**Query Parameters:**

| Parameter | Description | Example |
|-----------|-------------|---------|
| `select` | Columns to return (comma-separated) | `id,name,email` |
| `order` | Sort by column with direction | `created_at.desc` |
| `limit` | Maximum rows (default: 100, max: 1000) | `50` |
| `offset` | Skip rows for pagination | `100` |

**Filter Operators:**

| Operator | SQL Equivalent | Example |
|----------|---------------|---------|
| `eq.column` | `= value` | `eq.id=123` |
| `neq.column` | `!= value` | `neq.status=deleted` |
| `lt.column` | `< value` | `lt.age=30` |
| `lte.column` | `<= value` | `lte.price=100` |
| `gt.column` | `> value` | `gt.created_at=2024-01-01` |
| `gte.column` | `>= value` | `gte.score=80` |
| `like.column` | `LIKE value` | `like.name=%john%` |
| `ilike.column` | `ILIKE value` (case-insensitive) | `ilike.email=%@gmail.com` |
| `in.column` | `IN (values)` | `in.status=active,pending` |

**Example:**
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

### Insert Rows

**Requires secret key.**

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

| Parameter | Type | Description |
|-----------|------|-------------|
| `rows` | array | Array of objects to insert (max 1000) |
| `returning` | boolean | Return inserted rows if true |

**Response:**
```json
{
  "data": [
    { "id": "uuid-1", "name": "Alice", "email": "alice@example.com", "created_at": "..." }
  ]
}
```

### Update Rows

**Requires secret key and at least one filter.**

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

**Response:**
```json
{
  "data": [
    { "id": "uuid-1", "name": "Updated Name", "updated_at": "..." }
  ]
}
```

### Delete Rows

**Requires secret key and at least one filter.**

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

---

## Schema Management API

Base path: `/v1/db/schema`

All schema operations **require a secret key**.

### Create Table

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
    { "name": "id", "type": "uuid", "primaryKey": true, "defaultValue": "gen_random_uuid()" },
    { "name": "title", "type": "varchar(255)", "nullable": false },
    { "name": "content", "type": "text", "nullable": true },
    { "name": "author_id", "type": "uuid", "nullable": false, "references": { "table": "users", "column": "id" } },
    { "name": "created_at", "type": "timestamptz", "nullable": false, "defaultValue": "now()" }
  ],
  "ifNotExists": true
}
```

**Column Options:**

| Option | Type | Description |
|--------|------|-------------|
| `name` | string | Column name (required) |
| `type` | string | PostgreSQL data type (required) |
| `nullable` | boolean | Allow NULL values (default: true) |
| `primaryKey` | boolean | Part of primary key |
| `unique` | boolean | Add UNIQUE constraint |
| `defaultValue` | string | Default value (e.g., `now()`, `gen_random_uuid()`) |
| `references` | object | Foreign key: `{table, column}` |

**Allowed Data Types:**
`text`, `varchar`, `char`, `integer`, `int`, `bigint`, `smallint`, `serial`, `bigserial`, `boolean`, `bool`, `timestamp`, `timestamptz`, `date`, `time`, `timetz`, `uuid`, `json`, `jsonb`, `numeric`, `decimal`, `real`, `double precision`, `float`, `bytea`

### Drop Table

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

### Rename Table

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

### Add Column

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

### Drop Column

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

### Rename Column

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

### Alter Column

Modify column properties: type, nullable, default, and constraints.

```http
PATCH /v1/db/schema/tables/:table/columns/:column
Content-Type: application/json
x-api-key: <secret-key>
```

**Request Body:**

```json
{
  "type": "varchar(255)",
  "using": "old_column::varchar(255)",
  "nullable": true,
  "defaultValue": "'pending'",
  "dropDefault": false,
  "addConstraint": {
    "name": "email_check",
    "type": "check",
    "expression": "email ~* '^[A-Za-z0-9._%+-]+@'"
  },
  "dropConstraint": "old_constraint_name"
}
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `type` | string | New data type (validated against allowed types) |
| `using` | string | CAST expression for type conversion |
| `nullable` | boolean | `true` = DROP NOT NULL, `false` = SET NOT NULL |
| `defaultValue` | string | Set new default value |
| `dropDefault` | boolean | Drop existing default |
| `addConstraint` | object | Add constraint: `{name, type, expression?}` |
| `dropConstraint` | string | Name of constraint to drop |

**Constraint Types:**

| Type | Description |
|------|-------------|
| `check` | CHECK constraint (requires `expression`) |
| `unique` | UNIQUE constraint on this column |
| `not_null` | NOT NULL constraint |

**Example - Change type with casting:**

```http
PATCH /v1/db/schema/tables/products/columns/price
Content-Type: application/json
x-api-key: sk_xxx

{
  "type": "decimal(10,2)",
  "using": "price::decimal(10,2)"
}
```

**Example - Add validation constraint:**

```http
PATCH /v1/db/schema/tables/users/columns/email
Content-Type: application/json
x-api-key: sk_xxx

{
  "addConstraint": {
    "name": "valid_email",
    "type": "check",
    "expression": "email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$'"
  }
}
```

---

### Create Index

Create an index on one or more columns.

```http
POST /v1/db/schema/indexes
Content-Type: application/json
x-api-key: <secret-key>
```

**Request Body:**

```json
{
  "name": "idx_users_email",
  "table": "users",
  "columns": ["email"],
  "unique": false,
  "where": "deleted_at IS NULL",
  "ifNotExists": true
}
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Index name (required) |
| `table` | string | Table name (required) |
| `columns` | string[] | Column(s) to index (required, max 10) |
| `unique` | boolean | Create UNIQUE index |
| `where` | string | WHERE clause for partial index |
| `ifNotExists` | boolean | Don't error if index exists |

**Example - Composite index:**

```json
{
  "name": "idx_orders_user_date",
  "table": "orders",
  "columns": ["user_id", "created_at"]
}
```

**Example - Unique partial index:**

```json
{
  "name": "idx_active_email",
  "table": "users",
  "columns": ["email"],
  "unique": true,
  "where": "deleted_at IS NULL"
}
```

---

### Drop Index

Remove an index from the database.

```http
DELETE /v1/db/schema/indexes/:name
Content-Type: application/json
x-api-key: <secret-key>
```

**Request Body (optional):**

```json
{
  "ifExists": true
}
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `ifExists` | boolean | Don't error if index doesn't exist |

---

### Truncate Table

Quickly remove all rows from a table. Faster than DELETE and resets sequences optionally.

```http
POST /v1/db/schema/tables/:table/truncate
Content-Type: application/json
x-api-key: <secret-key>
```

**Request Body (optional):**

```json
{
  "restartIdentity": true,
  "cascade": false
}
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `restartIdentity` | boolean | Restart serial/identity sequences |
| `cascade` | boolean | Also truncate dependent tables |

**Example:**

```http
POST /v1/db/schema/tables/users/truncate
Content-Type: application/json
x-api-key: sk_xxx

{
  "restartIdentity": true
}
```

> **Warning:** TRUNCATE cannot be rolled back in most cases. All data will be permanently deleted.

---

## Public Storage API

Base path: `/v1/storage`

All storage is private. Files are accessed via presigned URLs.

### Get Signed Upload URL

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

| Parameter | Type | Description |
|-----------|------|-------------|
| `bucket` | string | Logical bucket name (required) |
| `path` | string | Path within the bucket (required) |
| `contentType` | string | MIME type of the file (required) |
| `maxSize` | number | Maximum file size in bytes (optional, max: 100MB) |

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

**Upload the file:**
```javascript
await fetch(uploadUrl, {
  method: 'PUT',
  body: file,
  headers: { 'Content-Type': file.type },
});
```

### Get Signed Download URL

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

### List Objects

**Requires secret key.**

```http
GET /v1/storage/list?bucket=uploads&prefix=images/&limit=100
x-api-key: <secret-key>
```

| Query Param | Description |
|-------------|-------------|
| `bucket` | Bucket name (required) |
| `prefix` | Filter by path prefix |
| `limit` | Maximum objects to return |

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

### Delete Object

**Requires secret key.**

```http
DELETE /v1/storage/object?bucket=uploads&objectKey=uploads/images/profile-123.png
x-api-key: <secret-key>
```

**Response:** `204 No Content`

---

## Admin API

Base path: `/admin`

All admin endpoints require admin authentication (session cookie or dev admin token).

---

### Admin: Projects {#admin-projects}

#### List All Projects

```http
GET /admin/projects
```

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "My Project",
      "description": "Project description",
      "databaseName": "proj_xxx",
      "createdAt": "2024-01-15T10:00:00Z"
    }
  ]
}
```

#### Get Project Details

```http
GET /admin/projects/:id
```

**Response:**
```json
{
  "data": {
    "id": "uuid",
    "name": "My Project",
    "description": "Project description",
    "databaseName": "proj_xxx",
    "createdAt": "2024-01-15T10:00:00Z",
    "stats": {
      "tableCount": 5,
      "totalRows": 1234,
      "storageUsed": 5242880
    }
  }
}
```

#### Create Project

```http
POST /admin/projects
Content-Type: application/json
```

**Request Body:**
```json
{
  "name": "New Project",
  "description": "Optional description"
}
```

**Response:**
```json
{
  "data": {
    "id": "uuid",
    "name": "New Project",
    "databaseName": "proj_xxx",
    "publishableKey": "pk_xxx",
    "secretKey": "sk_xxx"
  }
}
```

> **Important:** Save the `secretKey` immediately - it's only shown once!

#### Delete Project

```http
DELETE /admin/projects/:id
```

**Response:** `204 No Content`

#### List API Keys

```http
GET /admin/projects/:id/keys
```

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "keyType": "publishable",
      "prefix": "pk_",
      "createdAt": "2024-01-15T10:00:00Z",
      "lastUsedAt": "2024-01-16T10:00:00Z"
    },
    {
      "id": "uuid",
      "keyType": "secret",
      "prefix": "sk_",
      "createdAt": "2024-01-15T10:00:00Z",
      "lastUsedAt": "2024-01-16T10:00:00Z"
    }
  ]
}
```

#### Rotate API Key

```http
POST /admin/projects/:id/keys/rotate
Content-Type: application/json
```

**Request Body:**
```json
{
  "keyType": "secret"
}
```

**Response:**
```json
{
  "data": {
    "id": "uuid",
    "keyType": "secret",
    "key": "sk_newkeyxxx"
  }
}
```

#### Revoke API Key

```http
DELETE /admin/projects/:id/keys/:keyId
```

**Response:** `204 No Content`

---

### Admin: Data Tools (Import/Export) {#admin-data-tools}

#### List Import/Export Jobs

```http
GET /admin/projects/:id/data-tools/jobs
```

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "type": "export",
      "tableName": "users",
      "format": "csv",
      "status": "completed",
      "createdAt": "2024-01-15T10:00:00Z",
      "completedAt": "2024-01-15T10:01:00Z"
    }
  ]
}
```

#### Export Table Data

```http
POST /admin/projects/:id/data-tools/export
Content-Type: application/json
```

**Request Body:**
```json
{
  "tableName": "users",
  "format": "csv",
  "options": {
    "columns": ["id", "name", "email"],
    "where": "created_at > '2024-01-01'"
  }
}
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `tableName` | string | Table to export (required) |
| `format` | string | `csv` or `json` (required) |
| `options` | object | Optional export options |

**Response:**
```json
{
  "data": {
    "jobId": "uuid",
    "status": "pending"
  }
}
```

#### Import Data (Inline)

```http
POST /admin/projects/:id/data-tools/import
Content-Type: application/json
```

**Request Body:**
```json
{
  "tableName": "users",
  "format": "json",
  "data": "[{\"name\": \"Alice\", \"email\": \"alice@example.com\"}]",
  "options": {
    "mode": "insert",
    "batchSize": 100
  }
}
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `tableName` | string | Target table (required) |
| `format` | string | `csv` or `json` (required) |
| `data` | string | Data to import (required) |
| `options.mode` | string | `insert` or `upsert` |
| `options.batchSize` | number | Rows per batch |

#### Get Upload URL (Large Files)

For large file imports, get a presigned upload URL first:

```http
POST /admin/projects/:id/data-tools/upload-url
Content-Type: application/json
```

**Request Body:**
```json
{
  "filename": "large-export.csv",
  "contentType": "text/csv"
}
```

**Response:**
```json
{
  "data": {
    "uploadUrl": "https://...",
    "objectKey": "imports/xxx.csv"
  }
}
```

---

### Admin: Database Administration {#admin-database}

#### List Tables

```http
GET /admin/projects/:id/tables
```

**Response:**
```json
{
  "data": [
    {
      "name": "users",
      "rowCount": 1234,
      "sizeBytes": 524288
    }
  ]
}
```

#### Get Table Columns

```http
GET /admin/projects/:id/tables/:tableName/columns
```

**Response:**
```json
{
  "data": [
    { "name": "id", "type": "uuid", "nullable": false, "defaultValue": "gen_random_uuid()" },
    { "name": "email", "type": "varchar(255)", "nullable": false, "defaultValue": null }
  ]
}
```

#### Execute Raw SQL

**Admin only - use with caution.**

```http
POST /admin/projects/:id/sql
Content-Type: application/json
```

**Request Body:**
```json
{
  "sql": "SELECT COUNT(*) FROM users WHERE created_at > NOW() - INTERVAL '7 days'"
}
```

**Response:**
```json
{
  "data": {
    "rows": [{ "count": "42" }],
    "rowCount": 1
  }
}
```

---

### Admin: Backups {#admin-backups}

#### List Backups

```http
GET /admin/backups
```

**Query Parameters:**

| Parameter | Description |
|-----------|-------------|
| `projectId` | Filter by project ID |
| `type` | Filter by type: `platform`, `project`, `table` |

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "backupType": "project",
      "projectId": "uuid",
      "tableName": null,
      "format": "sql",
      "sizeBytes": 1048576,
      "status": "completed",
      "retentionDays": 30,
      "expiresAt": "2024-02-15T10:00:00Z",
      "createdAt": "2024-01-15T10:00:00Z"
    }
  ]
}
```

#### Get Backup Details

```http
GET /admin/backups/:id
```

#### Create Backup

```http
POST /admin/backups
Content-Type: application/json
```

**Request Body:**
```json
{
  "projectId": "uuid",
  "backupType": "project",
  "tableName": null,
  "format": "sql",
  "retentionDays": 30
}
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `projectId` | string | Project to backup (optional for platform backups) |
| `backupType` | string | `platform`, `project`, or `table` (required) |
| `tableName` | string | Table name (required if backupType is `table`) |
| `format` | string | `sql`, `csv`, or `json` |
| `retentionDays` | number | Days to keep backup (default: 30) |

#### Get Backup Download URL

```http
GET /admin/backups/:id/download
```

**Response:**
```json
{
  "data": {
    "downloadUrl": "https://...",
    "expiresIn": 3600
  }
}
```

#### Restore Backup

**Project backups only.**

```http
POST /admin/backups/:id/restore
```

**Response:**
```json
{
  "data": {
    "status": "restoring",
    "estimatedTime": 60
  }
}
```

#### Delete Backup

```http
DELETE /admin/backups/:id
```

#### Cleanup Expired Backups

```http
POST /admin/backups/cleanup
```

**Response:**
```json
{
  "data": {
    "deletedCount": 5
  }
}
```

#### Apply Retention Policy

```http
POST /admin/backups/retention
Content-Type: application/json
```

**Request Body:**
```json
{
  "projectId": "uuid"
}
```

---

### Admin: Storage Management {#admin-storage}

#### List Buckets

```http
GET /admin/projects/:id/buckets
```

**Response:**
```json
{
  "data": [
    {
      "name": "uploads",
      "objectCount": 42,
      "sizeBytes": 52428800
    }
  ]
}
```

#### List Files in Bucket

```http
GET /admin/projects/:id/buckets/:bucketName/files
```

**Query Parameters:**

| Parameter | Description |
|-----------|-------------|
| `prefix` | Filter by path prefix |
| `limit` | Maximum files to return |
| `offset` | Pagination offset |

**Response:**
```json
{
  "data": [
    {
      "key": "uploads/images/file1.png",
      "size": 12345,
      "lastModified": "2024-01-15T10:00:00Z",
      "contentType": "image/png"
    }
  ]
}
```

#### Get Signed Upload URL (Admin)

```http
POST /admin/projects/:id/signed-upload
Content-Type: application/json
```

**Request Body:**
```json
{
  "bucket": "uploads",
  "path": "admin/file.pdf",
  "contentType": "application/pdf",
  "maxSize": 10485760
}
```

#### Get Signed Download URL (Admin)

```http
GET /admin/projects/:id/buckets/:bucketName/signed-download?objectKey=uploads/file.pdf
```

#### Delete File

```http
DELETE /admin/projects/:id/buckets/:bucketName/files?objectKey=uploads/file.pdf
```

---

### Admin: User Management {#admin-users}

#### List Users

```http
GET /admin/users
```

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "email": "admin@example.com",
      "role": "admin",
      "createdAt": "2024-01-15T10:00:00Z"
    }
  ]
}
```

#### Delete User

Cannot delete yourself.

```http
DELETE /admin/users/:id
```

**Response:** `204 No Content`

---

### Admin: Invite Management {#admin-invites}

#### List Invite Keys

```http
GET /admin/invites
```

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "key": "invite-key-uuid",
      "maxUses": 5,
      "usedCount": 2,
      "expiresAt": "2024-02-15T10:00:00Z",
      "createdAt": "2024-01-15T10:00:00Z",
      "createdBy": "admin@example.com"
    }
  ]
}
```

#### Create Invite Key

```http
POST /admin/invites
Content-Type: application/json
```

**Request Body:**
```json
{
  "maxUses": 5,
  "expiresInDays": 30
}
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `maxUses` | number | Maximum uses (optional, null = unlimited) |
| `expiresInDays` | number | Days until expiration (optional, null = no expiry) |

**Response:**
```json
{
  "data": {
    "id": "uuid",
    "key": "invite-key-uuid"
  }
}
```

#### Delete Invite Key

```http
DELETE /admin/invites/:id
```

---

### Admin: Cron Jobs {#admin-cron}

#### List Cron Jobs

```http
GET /admin/cron
```

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Daily Cleanup",
      "description": "Clean up expired sessions",
      "jobType": "platform_action",
      "scheduleCron": "0 0 * * *",
      "enabled": true,
      "lastRunAt": "2024-01-15T00:00:00Z",
      "nextRunAt": "2024-01-16T00:00:00Z",
      "createdAt": "2024-01-10T10:00:00Z"
    }
  ]
}
```

#### Get Cron Job Details

```http
GET /admin/cron/:id
```

#### Create Cron Job

```http
POST /admin/cron
Content-Type: application/json
```

**Request Body:**
```json
{
  "name": "API Health Check",
  "description": "Ping external API every hour",
  "jobType": "http_request",
  "scheduleCron": "0 * * * *",
  "httpUrl": "https://api.example.com/health",
  "httpMethod": "GET",
  "httpHeaders": { "Authorization": "Bearer xxx" },
  "enabled": true,
  "timeoutMs": 30000,
  "retries": 3,
  "retryBackoffMs": 1000
}
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Job name (required) |
| `description` | string | Job description |
| `jobType` | string | `http_request` or `platform_action` (required) |
| `scheduleCron` | string | Cron expression (required) |
| `httpUrl` | string | URL for HTTP jobs |
| `httpMethod` | string | HTTP method (GET, POST, etc.) |
| `httpHeaders` | object | Headers to send |
| `httpBody` | string | Request body |
| `platformAction` | string | Action for platform jobs (e.g., `backup`) |
| `platformConfig` | object | Config for platform actions |
| `enabled` | boolean | Enable job (default: true) |
| `timeoutMs` | number | Timeout in milliseconds |
| `retries` | number | Number of retries on failure |
| `retryBackoffMs` | number | Backoff between retries |

#### Update Cron Job

```http
PATCH /admin/cron/:id
Content-Type: application/json
```

#### Delete Cron Job

```http
DELETE /admin/cron/:id
```

#### Toggle Cron Job

```http
POST /admin/cron/:id/toggle
Content-Type: application/json
```

**Request Body:**
```json
{
  "enabled": false
}
```

#### Manually Run Cron Job

```http
POST /admin/cron/:id/run
```

**Response:**
```json
{
  "data": {
    "runId": "uuid",
    "status": "running"
  }
}
```

#### List Job Runs

```http
GET /admin/cron/:id/runs
```

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "status": "completed",
      "startedAt": "2024-01-15T00:00:00Z",
      "completedAt": "2024-01-15T00:00:05Z",
      "durationMs": 5000,
      "result": { "statusCode": 200 }
    }
  ]
}
```

---

### Admin: Settings {#admin-settings}

#### Get Platform Settings

```http
GET /admin/settings
```

**Response:**
```json
{
  "data": {
    "rateLimitMax": 100,
    "rateLimitWindowMs": 60000,
    "sqlMaxRows": 1000,
    "sqlStatementTimeoutMs": 30000,
    "minioPublicUrl": "https://storage.example.com"
  }
}
```

#### Update Rate Limits

```http
PUT /admin/settings/rate-limits
Content-Type: application/json
```

**Request Body:**
```json
{
  "rateLimitMax": 200,
  "rateLimitWindowMs": 60000
}
```

#### Update Database Limits

```http
PUT /admin/settings/database-limits
Content-Type: application/json
```

**Request Body:**
```json
{
  "sqlMaxRows": 2000,
  "sqlStatementTimeoutMs": 60000
}
```

#### Update Storage Settings

```http
PUT /admin/settings/storage
Content-Type: application/json
```

**Request Body:**
```json
{
  "minioPublicUrl": "https://storage.example.com"
}
```

---

### Admin: Statistics {#admin-stats}

#### Platform Overview

```http
GET /admin/stats/overview
```

**Response:**
```json
{
  "data": {
    "totalProjects": 5,
    "totalUsers": 3,
    "totalTables": 25,
    "totalRows": 50000,
    "totalStorageBytes": 104857600,
    "activeCronJobs": 10
  }
}
```

#### All Projects Stats

```http
GET /admin/stats/projects
```

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Project 1",
      "tableCount": 5,
      "totalRows": 10000,
      "storageBytes": 20971520,
      "apiCallsToday": 1500
    }
  ]
}
```

#### Timeline Data

```http
GET /admin/stats/timeline?days=30
```

**Query Parameters:**

| Parameter | Description |
|-----------|-------------|
| `days` | Number of days (default: 30) |

**Response:**
```json
{
  "data": [
    { "date": "2024-01-15", "apiCalls": 1500, "storageUsed": 104857600 },
    { "date": "2024-01-14", "apiCalls": 1200, "storageUsed": 94371840 }
  ]
}
```

#### Recent Activity

```http
GET /admin/activity?limit=20
```

**Query Parameters:**

| Parameter | Description |
|-----------|-------------|
| `limit` | Number of activities (default: 20) |

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "action": "project.created",
      "userId": "uuid",
      "userEmail": "admin@example.com",
      "resourceType": "project",
      "resourceId": "uuid",
      "details": { "name": "New Project" },
      "createdAt": "2024-01-15T10:00:00Z"
    }
  ]
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
  "details": {}
}
```

### Common Error Codes

| Code | Status | Description |
|------|--------|-------------|
| `UNAUTHORIZED` | 401 | Missing or invalid API key |
| `FORBIDDEN` | 403 | Operation not allowed with this key |
| `NOT_FOUND` | 404 | Resource not found |
| `BAD_REQUEST` | 400 | Invalid request |
| `VALIDATION_ERROR` | 400 | Request validation failed |
| `TOO_MANY_REQUESTS` | 429 | Rate limit exceeded |
| `INTERNAL_ERROR` | 500 | Server error |

---

## Code Examples

### Next.js Server Action: CRUD Operations

```typescript
// app/actions.ts
'use server';

const API_URL = process.env.ATLASHUB_API_URL!;
const SECRET_KEY = process.env.ATLASHUB_SECRET_KEY!;

// Fetch users with pagination
export async function getUsers(page = 1, pageSize = 20) {
  const offset = (page - 1) * pageSize;
  const res = await fetch(
    `${API_URL}/v1/db/users?select=id,name,email&order=created_at.desc&limit=${pageSize}&offset=${offset}`,
    {
      headers: { 'x-api-key': SECRET_KEY },
      next: { revalidate: 60 },
    }
  );
  if (!res.ok) throw new Error('Failed to fetch users');
  return res.json();
}

// Create user
export async function createUser(data: { name: string; email: string }) {
  const res = await fetch(`${API_URL}/v1/db/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': SECRET_KEY },
    body: JSON.stringify({ rows: [data], returning: true }),
  });
  if (!res.ok) throw new Error('Failed to create user');
  return res.json();
}

// Update user
export async function updateUser(id: string, data: { name?: string; email?: string }) {
  const res = await fetch(`${API_URL}/v1/db/users?eq.id=${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-api-key': SECRET_KEY },
    body: JSON.stringify({ values: data, returning: true }),
  });
  if (!res.ok) throw new Error('Failed to update user');
  return res.json();
}

// Delete user
export async function deleteUser(id: string) {
  const res = await fetch(`${API_URL}/v1/db/users?eq.id=${id}`, {
    method: 'DELETE',
    headers: { 'x-api-key': SECRET_KEY },
  });
  if (!res.ok) throw new Error('Failed to delete user');
  return res.json();
}
```

### File Upload Flow

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
      maxSize: 10 * 1024 * 1024,
    }),
  });

  if (!res.ok) {
    return NextResponse.json({ error: 'Failed to get upload URL' }, { status: 500 });
  }

  return NextResponse.json(await res.json());
}
```

```typescript
// components/FileUpload.tsx
'use client';

export function FileUpload() {
  async function handleUpload(file: File) {
    // Get signed URL
    const urlRes = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: file.name, contentType: file.type }),
    });
    const { data } = await urlRes.json();

    // Upload to storage
    await fetch(data.uploadUrl, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type },
    });

    return data.objectKey;
  }

  return <input type="file" onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])} />;
}
```

---

## Pagination

Use `limit` and `offset` for pagination:

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
   - Use environment variables
   - Rotate keys periodically

2. **API Design**
   - Proxy AtlasHub calls through your own API routes
   - Validate user input before sending to AtlasHub
   - Don't expose raw errors to end users

3. **Storage**
   - Always request presigned URLs from your server
   - Set appropriate `maxSize` limits
   - Store `objectKey` (not full URLs) in your database
