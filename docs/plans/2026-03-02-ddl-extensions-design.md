# DDL Extensions Design

**Date:** 2026-03-02
**Status:** Approved
**Author:** Claude

## Overview

Add missing DDL operations to the public API to enable full database management without requiring admin SQL access.

## Features to Add

### 1. ALTER COLUMN Operation

**Endpoint:** `PATCH /v1/db/schema/tables/:table/columns/:column`

**Request Body:**
```json
{
  "type": "varchar(255)",
  "using": "email::varchar(255)",
  "nullable": true,
  "defaultValue": "'pending'",
  "dropDefault": false,
  "addConstraint": {
    "name": "email_check",
    "type": "check",
    "expression": "email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$'"
  },
  "dropConstraint": "old_constraint_name"
}
```

**Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `type` | string | New data type (validated against ALLOWED_DATA_TYPES) |
| `using` | string | CAST expression for type conversion |
| `nullable` | boolean | Set/drop NOT NULL constraint |
| `defaultValue` | string | Set new default value |
| `dropDefault` | boolean | Drop existing default |
| `addConstraint` | object | Add constraint: `{name, type, expression}` |
| `dropConstraint` | string | Name of constraint to drop |

**Constraint types:** `check`, `unique`, `not_null`

### 2. INDEX Operations

**Create Index:** `POST /v1/db/schema/indexes`

```json
{
  "name": "idx_users_email",
  "table": "users",
  "columns": ["email"],
  "unique": false,
  "where": "email IS NOT NULL",
  "ifNotExists": true
}
```

**Drop Index:** `DELETE /v1/db/schema/indexes/:name`

```json
{
  "ifExists": true
}
```

**Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Index name (required) |
| `table` | string | Table name (required for create) |
| `columns` | string[] | Column names to index |
| `unique` | boolean | Create UNIQUE index |
| `where` | string | WHERE clause for partial index |
| `ifNotExists` | boolean | Don't error if index exists |
| `ifExists` | boolean | Don't error if index doesn't exist (drop only) |

### 3. TRUNCATE TABLE Operation

**Endpoint:** `POST /v1/db/schema/tables/:table/truncate`

```json
{
  "restartIdentity": true,
  "cascade": false
}
```

**Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `restartIdentity` | boolean | Reset sequences to start from 1 |
| `cascade` | boolean | Also truncate dependent tables |

## Implementation Details

### Service Layer

Add to `crudService` in `gateway/src/services/crud.ts`:

```typescript
async alterColumn(projectId, table, column, changes): Promise<{success, table, column}>
async createIndex(projectId, options): Promise<{success, indexName, table}>
async dropIndex(projectId, name, ifExists): Promise<{success, indexName}>
async truncateTable(projectId, table, options): Promise<{success, table}>
```

### Routes

Add to `gateway/src/routes/public/db.ts`:

```typescript
PATCH '/schema/tables/:table/columns/:column'  // alterColumn
POST '/schema/indexes'                          // createIndex
DELETE '/schema/indexes/:name'                  // dropIndex
POST '/schema/tables/:table/truncate'           // truncateTable
```

### Validation

- Use existing `validateIdentifier()` for names
- Use existing `ALLOWED_DATA_TYPES` for type changes
- Add regex validation for `using`, `where`, `expression` to prevent SQL injection
- Allowed constraint types: `check`, `unique`, `not_null`

### Security

- All operations require secret key
- Use `projectDb.queryAsOwner()` for execution
- Invalidate table cache after schema changes

### Error Handling

- `BadRequestError` for invalid inputs
- Propagate PostgreSQL errors with clear messages
- Return constraint violation details

## Files to Modify

1. `gateway/src/services/crud.ts` - Add new service methods
2. `gateway/src/routes/public/db.ts` - Add new routes
3. `docs/API-REFERENCE.md` - Document new endpoints
4. `docs/USAGE.md` - Add usage examples
5. `dashboard/app/(dashboard)/docs/page.tsx` - Update in-app docs

## Out of Scope

- CONCURRENTLY option for indexes (use admin SQL for production)
- Advanced index types (GIN, GIST, BRIN) - can add later if needed
- Index collations and NULLS ordering
- Views, functions, triggers
