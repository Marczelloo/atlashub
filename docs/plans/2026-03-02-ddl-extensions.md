# DDL Extensions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add ALTER COLUMN, CREATE/DROP INDEX, and TRUNCATE TABLE operations to the public API.

**Architecture:** Extend existing `crudService` with new DDL methods and add corresponding routes in `db.ts`. Follow existing patterns for validation, SQL generation, and cache invalidation.

**Tech Stack:** Fastify, Zod, PostgreSQL, TypeScript

---

## Task 1: Add Zod Schemas for New Operations

**Files:**
- Modify: `packages/shared/src/schemas.ts`

**Step 1: Add ALTER COLUMN schema**

```typescript
// Add to schemas.ts after existing DDL schemas

export const alterColumnSchema = z.object({
  type: z.string().min(1).max(100).optional(),
  using: z.string().max(500).optional(),
  nullable: z.boolean().optional(),
  defaultValue: z.string().max(255).optional(),
  dropDefault: z.boolean().optional(),
  addConstraint: z.object({
    name: z.string().min(1).max(63),
    type: z.enum(['check', 'unique', 'not_null']),
    expression: z.string().max(1000).optional(), // Required for check constraints
  }).optional(),
  dropConstraint: z.string().min(1).max(63).optional(),
}).refine(data => {
  // At least one modification must be specified
  return Object.keys(data).length > 0;
}, { message: 'At least one modification must be specified' });

export const createIndexSchema = z.object({
  name: z.string().min(1).max(63),
  table: z.string().min(1).max(63),
  columns: z.array(z.string().min(1).max(63)).min(1).max(10),
  unique: z.boolean().optional().default(false),
  where: z.string().max(500).optional(),
  ifNotExists: z.boolean().optional().default(false),
});

export const dropIndexSchema = z.object({
  ifExists: z.boolean().optional().default(false),
});

export const truncateTableSchema = z.object({
  restartIdentity: z.boolean().optional().default(false),
  cascade: z.boolean().optional().default(false),
});
```

**Step 2: Export new schemas**

Add to the exports at the bottom of the file:
```typescript
export type AlterColumnInput = z.infer<typeof alterColumnSchema>;
export type CreateIndexInput = z.infer<typeof createIndexSchema>;
export type DropIndexInput = z.infer<typeof dropIndexSchema>;
export type TruncateTableInput = z.infer<typeof truncateTableSchema>;
```

**Step 3: Commit**

```bash
git add packages/shared/src/schemas.ts
git commit -m "feat(shared): add Zod schemas for DDL extensions"
```

---

## Task 2: Add Service Methods to crudService

**Files:**
- Modify: `gateway/src/services/crud.ts`

**Step 1: Add alterColumn method**

Add after `renameColumn` method (around line 532):

```typescript
async alterColumn(
  projectId: string,
  tableName: string,
  columnName: string,
  changes: {
    type?: string;
    using?: string;
    nullable?: boolean;
    defaultValue?: string;
    dropDefault?: boolean;
    addConstraint?: {
      name: string;
      type: 'check' | 'unique' | 'not_null';
      expression?: string;
    };
    dropConstraint?: string;
  }
): Promise<{ success: true; tableName: string; columnName: string }> {
  validateIdentifier(tableName, 'table');
  validateIdentifier(columnName, 'column');

  const alterStatements: string[] = [];

  // Handle type change
  if (changes.type) {
    const baseType = changes.type.toLowerCase().split('(')[0].trim();
    if (!ALLOWED_DATA_TYPES.has(baseType)) {
      throw new BadRequestError(`Invalid data type: ${changes.type}`);
    }
    let typeStmt = `ALTER COLUMN "${columnName}" TYPE ${changes.type}`;
    if (changes.using) {
      // Validate USING clause - only allow safe expressions
      if (!/^[a-zA-Z0-9_"'\s\(\)\.\:\:\+\-\*\/]+$/.test(changes.using)) {
        throw new BadRequestError('Invalid USING clause');
      }
      typeStmt += ` USING ${changes.using}`;
    }
    alterStatements.push(typeStmt);
  }

  // Handle nullable
  if (changes.nullable === true) {
    alterStatements.push(`ALTER COLUMN "${columnName}" DROP NOT NULL`);
  } else if (changes.nullable === false) {
    alterStatements.push(`ALTER COLUMN "${columnName}" SET NOT NULL`);
  }

  // Handle default value
  if (changes.dropDefault) {
    alterStatements.push(`ALTER COLUMN "${columnName}" DROP DEFAULT`);
  } else if (changes.defaultValue !== undefined) {
    const defaultVal = changes.defaultValue;
    // Validate default value
    if (
      defaultVal === 'now()' ||
      defaultVal === 'CURRENT_TIMESTAMP' ||
      defaultVal === 'gen_random_uuid()' ||
      defaultVal === 'true' ||
      defaultVal === 'false' ||
      defaultVal === 'null' ||
      /^-?\d+(\.\d+)?$/.test(defaultVal) ||
      /^'[^']*'$/.test(defaultVal)
    ) {
      alterStatements.push(`ALTER COLUMN "${columnName}" SET DEFAULT ${defaultVal}`);
    } else {
      throw new BadRequestError(`Invalid default value: ${defaultVal}`);
    }
  }

  // Handle drop constraint
  if (changes.dropConstraint) {
    validateIdentifier(changes.dropConstraint, 'column'); // Reuse for constraint name
    alterStatements.push(`DROP CONSTRAINT "${changes.dropConstraint}"`);
  }

  // Handle add constraint
  if (changes.addConstraint) {
    validateIdentifier(changes.addConstraint.name, 'column');
    const { name, type, expression } = changes.addConstraint;

    if (type === 'check') {
      if (!expression) {
        throw new BadRequestError('Expression is required for CHECK constraint');
      }
      // Validate expression - basic safety check
      if (!/^[a-zA-Z0-9_"'\s\(\)\.\:\:\+\-\*\/\<\>\=\!]+$/.test(expression)) {
        throw new BadRequestError('Invalid CHECK constraint expression');
      }
      alterStatements.push(`ADD CONSTRAINT "${name}" CHECK (${expression})`);
    } else if (type === 'unique') {
      alterStatements.push(`ADD CONSTRAINT "${name}" UNIQUE ("${columnName}")`);
    } else if (type === 'not_null') {
      alterStatements.push(`ALTER COLUMN "${columnName}" SET NOT NULL`);
    }
  }

  if (alterStatements.length === 0) {
    throw new BadRequestError('No valid alterations specified');
  }

  const sql = `ALTER TABLE "${tableName}" ${alterStatements.join(', ')}`;

  await projectDb.queryAsOwner(projectId, sql);
  this.clearCache(projectId);

  return { success: true, tableName, columnName };
},
```

**Step 2: Add createIndex method**

Add after alterColumn:

```typescript
async createIndex(
  projectId: string,
  options: {
    name: string;
    table: string;
    columns: string[];
    unique?: boolean;
    where?: string;
    ifNotExists?: boolean;
  }
): Promise<{ success: true; indexName: string; tableName: string }> {
  validateIdentifier(options.name, 'column'); // Reuse for index name
  validateIdentifier(options.table, 'table');

  for (const col of options.columns) {
    validateIdentifier(col, 'column');
  }

  // Validate WHERE clause
  if (options.where) {
    if (!/^[a-zA-Z0-9_"'\s\(\)\.\:\:\+\-\*\/\<\>\=\!]+$/.test(options.where)) {
      throw new BadRequestError('Invalid WHERE clause');
    }
  }

  const uniqueClause = options.unique ? 'UNIQUE ' : '';
  const ifNotExistsClause = options.ifNotExists ? 'IF NOT EXISTS ' : '';
  const columnsList = options.columns.map(c => `"${c}"`).join(', ');
  const whereClause = options.where ? ` WHERE ${options.where}` : '';

  const sql = `CREATE ${uniqueClause}INDEX ${ifNotExistsClause}"${options.name}" ON "${options.table}" (${columnsList})${whereClause}`;

  await projectDb.queryAsOwner(projectId, sql);

  return { success: true, indexName: options.name, tableName: options.table };
},
```

**Step 3: Add dropIndex method**

Add after createIndex:

```typescript
async dropIndex(
  projectId: string,
  indexName: string,
  ifExists = false
): Promise<{ success: true; indexName: string }> {
  validateIdentifier(indexName, 'column'); // Reuse for index name

  const ifExistsClause = ifExists ? 'IF EXISTS ' : '';
  const sql = `DROP INDEX ${ifExistsClause}"${indexName}"`;

  await projectDb.queryAsOwner(projectId, sql);

  return { success: true, indexName };
},
```

**Step 4: Add truncateTable method**

Add after dropIndex:

```typescript
async truncateTable(
  projectId: string,
  tableName: string,
  options: {
    restartIdentity?: boolean;
    cascade?: boolean;
  } = {}
): Promise<{ success: true; tableName: string }> {
  validateIdentifier(tableName, 'table');

  const restartClause = options.restartIdentity ? ' RESTART IDENTITY' : '';
  const cascadeClause = options.cascade ? ' CASCADE' : '';

  const sql = `TRUNCATE TABLE "${tableName}"${restartClause}${cascadeClause}`;

  await projectDb.queryAsOwner(projectId, sql);
  this.clearCache(projectId);

  return { success: true, tableName };
},
```

**Step 5: Commit**

```bash
git add gateway/src/services/crud.ts
git commit -m "feat(gateway): add DDL service methods for alter, index, truncate"
```

---

## Task 3: Add Route Handlers

**Files:**
- Modify: `gateway/src/routes/public/db.ts`

**Step 1: Add Zod import and schemas**

Add at the top of the file (after existing imports):

```typescript
// Add new schema definitions after existing ones (around line 61)
const alterColumnBodySchema = z.object({
  type: z.string().min(1).max(100).optional(),
  using: z.string().max(500).optional(),
  nullable: z.boolean().optional(),
  defaultValue: z.string().max(255).optional(),
  dropDefault: z.boolean().optional(),
  addConstraint: z.object({
    name: z.string().min(1).max(63),
    type: z.enum(['check', 'unique', 'not_null']),
    expression: z.string().max(1000).optional(),
  }).optional(),
  dropConstraint: z.string().min(1).max(63).optional(),
});

const createIndexBodySchema = z.object({
  name: z.string().min(1).max(63),
  table: z.string().min(1).max(63),
  columns: z.array(z.string().min(1).max(63)).min(1).max(10),
  unique: z.boolean().optional().default(false),
  where: z.string().max(500).optional(),
  ifNotExists: z.boolean().optional().default(false),
});

const dropIndexBodySchema = z.object({
  ifExists: z.boolean().optional().default(false),
});

const truncateBodySchema = z.object({
  restartIdentity: z.boolean().optional().default(false),
  cascade: z.boolean().optional().default(false),
});
```

**Step 2: Add ALTER COLUMN route**

Add after the renameColumn route (at the end of the file, before the closing brace):

```typescript
// Alter a column
fastify.patch<{ Params: { table: string; column: string } }>(
  '/schema/tables/:table/columns/:column',
  async (request, reply) => {
    requireSecretKey(request);

    const tableResult = tableNameSchema.safeParse(request.params.table);
    if (!tableResult.success) {
      throw new BadRequestError('Invalid table name');
    }

    const columnResult = tableNameSchema.safeParse(request.params.column);
    if (!columnResult.success) {
      throw new BadRequestError('Invalid column name');
    }

    const parsed = alterColumnBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new BadRequestError('Invalid request body', parsed.error.flatten().fieldErrors);
    }

    const result = await crudService.alterColumn(
      request.projectContext.projectId,
      request.params.table,
      request.params.column,
      parsed.data
    );

    return reply.send({ data: result });
  }
);
```

**Step 3: Add CREATE INDEX route**

```typescript
// Create an index
fastify.post('/schema/indexes', async (request, reply) => {
  requireSecretKey(request);

  const parsed = createIndexBodySchema.safeParse(request.body);
  if (!parsed.success) {
    throw new BadRequestError('Invalid request body', parsed.error.flatten().fieldErrors);
  }

  const result = await crudService.createIndex(
    request.projectContext.projectId,
    parsed.data
  );

  return reply.status(201).send({ data: result });
});
```

**Step 4: Add DROP INDEX route**

```typescript
// Drop an index
fastify.delete<{ Params: { name: string } }>(
  '/schema/indexes/:name',
  async (request, reply) => {
    requireSecretKey(request);

    const nameResult = tableNameSchema.safeParse(request.params.name);
    if (!nameResult.success) {
      throw new BadRequestError('Invalid index name');
    }

    const parsed = dropIndexBodySchema.safeParse(request.body || {});
    if (!parsed.success) {
      throw new BadRequestError('Invalid request body', parsed.error.flatten().fieldErrors);
    }

    const result = await crudService.dropIndex(
      request.projectContext.projectId,
      request.params.name,
      parsed.data.ifExists
    );

    return reply.send({ data: result });
  }
);
```

**Step 5: Add TRUNCATE TABLE route**

```typescript
// Truncate a table
fastify.post<{ Params: { table: string } }>(
  '/schema/tables/:table/truncate',
  async (request, reply) => {
    requireSecretKey(request);

    const tableResult = tableNameSchema.safeParse(request.params.table);
    if (!tableResult.success) {
      throw new BadRequestError('Invalid table name');
    }

    const parsed = truncateBodySchema.safeParse(request.body || {});
    if (!parsed.success) {
      throw new BadRequestError('Invalid request body', parsed.error.flatten().fieldErrors);
    }

    const result = await crudService.truncateTable(
      request.projectContext.projectId,
      request.params.table,
      parsed.data
    );

    return reply.send({ data: result });
  }
);
```

**Step 6: Commit**

```bash
git add gateway/src/routes/public/db.ts
git commit -m "feat(gateway): add routes for alter column, index, and truncate"
```

---

## Task 4: Add Integration Tests

**Files:**
- Modify: `gateway/src/__tests__/public-api.test.ts`

**Step 1: Add DDL Extensions test describe block**

Add after the 'Error Handling' describe block (before the closing brace of the main describe):

```typescript
describe('DDL Extensions', () => {
  describe('ALTER COLUMN', () => {
    it('PATCH /v1/db/schema/tables/:table/columns/:column - changes nullable', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/db/schema/tables/users/columns/age',
        headers: getPublicHeaders(secretKey),
        payload: { nullable: true },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.data.success).toBe(true);
    });

    it('PATCH /v1/db/schema/tables/:table/columns/:column - sets default value', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/db/schema/tables/users/columns/active',
        headers: getPublicHeaders(secretKey),
        payload: { defaultValue: 'true' },
      });

      expect(res.statusCode).toBe(200);
    });

    it('PATCH /v1/db/schema/tables/:table/columns/:column - drops default', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/db/schema/tables/users/columns/active',
        headers: getPublicHeaders(secretKey),
        payload: { dropDefault: true },
      });

      expect(res.statusCode).toBe(200);
    });

    it('rejects ALTER with publishable key', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/db/schema/tables/users/columns/age',
        headers: getPublicHeaders(publishableKey),
        payload: { nullable: true },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  describe('CREATE INDEX', () => {
    it('POST /v1/db/schema/indexes - creates simple index', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/db/schema/indexes',
        headers: getPublicHeaders(secretKey),
        payload: {
          name: 'idx_users_name',
          table: 'users',
          columns: ['name'],
        },
      });

      expect(res.statusCode).toBe(201);
      const data = JSON.parse(res.body);
      expect(data.data.indexName).toBe('idx_users_name');
    });

    it('POST /v1/db/schema/indexes - creates unique index', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/db/schema/indexes',
        headers: getPublicHeaders(secretKey),
        payload: {
          name: 'idx_users_email_unique',
          table: 'users',
          columns: ['email'],
          unique: true,
          ifNotExists: true,
        },
      });

      expect(res.statusCode).toBe(201);
    });

    it('POST /v1/db/schema/indexes - creates partial index with WHERE', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/db/schema/indexes',
        headers: getPublicHeaders(secretKey),
        payload: {
          name: 'idx_active_users',
          table: 'users',
          columns: ['name'],
          where: 'active = true',
          ifNotExists: true,
        },
      });

      expect(res.statusCode).toBe(201);
    });

    it('rejects index creation with publishable key', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/db/schema/indexes',
        headers: getPublicHeaders(publishableKey),
        payload: {
          name: 'idx_test',
          table: 'users',
          columns: ['name'],
        },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  describe('DROP INDEX', () => {
    it('DELETE /v1/db/schema/indexes/:name - drops index', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/v1/db/schema/indexes/idx_users_name',
        headers: getPublicHeaders(secretKey),
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.data.indexName).toBe('idx_users_name');
    });

    it('DELETE /v1/db/schema/indexes/:name - with ifExists', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/v1/db/schema/indexes/nonexistent_idx',
        headers: getPublicHeaders(secretKey),
        payload: { ifExists: true },
      });

      // Should succeed with ifExists even if index doesn't exist
      expect(res.statusCode).toBe(200);
    });
  });

  describe('TRUNCATE TABLE', () => {
    it('POST /v1/db/schema/tables/:table/truncate - truncates table', async () => {
      // First insert some data
      await app.inject({
        method: 'POST',
        url: '/v1/db/users',
        headers: getPublicHeaders(secretKey),
        payload: {
          rows: [
            { name: 'Truncate Test 1', email: 'truncate1@test.com' },
            { name: 'Truncate Test 2', email: 'truncate2@test.com' },
          ],
        },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/db/schema/tables/users/truncate',
        headers: getPublicHeaders(secretKey),
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.data.success).toBe(true);

      // Verify table is empty
      const checkRes = await app.inject({
        method: 'GET',
        url: '/v1/db/users',
        headers: getPublicHeaders(publishableKey),
      });
      const checkData = JSON.parse(checkRes.body);
      expect(checkData.data.length).toBe(0);
    });

    it('rejects truncate with publishable key', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/db/schema/tables/users/truncate',
        headers: getPublicHeaders(publishableKey),
        payload: {},
      });

      expect(res.statusCode).toBe(403);
    });
  });
});
```

**Step 2: Commit**

```bash
git add gateway/src/__tests__/public-api.test.ts
git commit -m "test(gateway): add integration tests for DDL extensions"
```

---

## Task 5: Update API-REFERENCE.md Documentation

**Files:**
- Modify: `docs/API-REFERENCE.md`

**Step 1: Add ALTER COLUMN section**

Find the "Rename Column" section and add after it:

```markdown
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
```

**Step 2: Add INDEX section**

Add after the ALTER COLUMN section:

```markdown
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
```

**Step 3: Add TRUNCATE section**

Add after the DROP INDEX section:

```markdown
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
```

**Step 4: Commit**

```bash
git add docs/API-REFERENCE.md
git commit -m "docs: add documentation for ALTER COLUMN, INDEX, and TRUNCATE APIs"
```

---

## Task 6: Update USAGE.md Documentation

**Files:**
- Modify: `docs/USAGE.md`

**Step 1: Add new sections after "Rename Column" section**

Find the "Rename Column" section (around line 419) and add after the Schema Management Examples:

```markdown
---

### Alter Column

Modify column properties including type, nullable, default, and constraints.

```http
PATCH /v1/db/schema/tables/:table/columns/:column
Content-Type: application/json
x-api-key: <secret-key>
```

**Change column type:**

```json
{
  "type": "varchar(500)",
  "using": "description::varchar(500)"
}
```

**Set nullable and default:**

```json
{
  "nullable": true,
  "defaultValue": "'draft'"
}
```

**Add CHECK constraint:**

```json
{
  "addConstraint": {
    "name": "positive_price",
    "type": "check",
    "expression": "price >= 0"
  }
}
```

**Drop constraint:**

```json
{
  "dropConstraint": "old_check_constraint"
}
```

---

### Create Index

Create indexes for better query performance.

```http
POST /v1/db/schema/indexes
Content-Type: application/json
x-api-key: <secret-key>
```

**Simple index:**

```json
{
  "name": "idx_users_email",
  "table": "users",
  "columns": ["email"]
}
```

**Unique partial index:**

```json
{
  "name": "idx_unique_active_email",
  "table": "users",
  "columns": ["email"],
  "unique": true,
  "where": "deleted_at IS NULL",
  "ifNotExists": true
}
```

---

### Drop Index

```http
DELETE /v1/db/schema/indexes/:name
Content-Type: application/json
x-api-key: <secret-key>
```

```json
{
  "ifExists": true
}
```

---

### Truncate Table

Quickly empty a table (faster than DELETE).

```http
POST /v1/db/schema/tables/:table/truncate
Content-Type: application/json
x-api-key: <secret-key>
```

```json
{
  "restartIdentity": true,
  "cascade": false
}
```

---
```

**Step 2: Update the Schema Management section header**

Change the Schema Management intro to include new operations:

```markdown
## Schema Management (DDL) API

Base path: `${ATLASHUB_API_URL}/v1/db/schema`

All schema management endpoints **require a secret key**. These operations modify your database structure.

Available operations:
- **Tables:** Create, Drop, Rename
- **Columns:** Add, Drop, Rename, Alter
- **Indexes:** Create, Drop
- **Data:** Truncate
```

**Step 3: Commit**

```bash
git add docs/USAGE.md
git commit -m "docs: update USAGE.md with DDL extensions"
```

---

## Task 7: Update Dashboard Docs Page

**Files:**
- Modify: `dashboard/app/(dashboard)/docs/page.tsx`

**Step 1: Update sections array**

Find the sections array and update the schema section label:

```typescript
const sections = [
  { id: 'overview', label: 'Overview', icon: BookOpen },
  { id: 'api', label: 'API Reference', icon: Code },
  { id: 'database', label: 'Database', icon: Database },
  { id: 'schema', label: 'Schema (DDL)', icon: Wrench },
  { id: 'storage', label: 'Storage', icon: HardDrive },
  { id: 'admin', label: 'Admin API', icon: Wrench },
  { id: 'cron', label: 'Cron Jobs', icon: Clock },
  { id: 'backups', label: 'Backups', icon: Archive },
  { id: 'authentication', label: 'Authentication', icon: Key },
  { id: 'examples', label: 'Examples', icon: Terminal },
];
```

**Step 2: Update the schema section content**

Find the `{activeSection === 'schema' && (` block and add new endpoints after the "Rename Column" div:

```tsx
{/* Add after the rename column section */}

<div>
  <h4 className="font-semibold text-lg mb-2 text-purple-400">
    PATCH /v1/db/schema/tables/:table/columns/:column
  </h4>
  <p className="text-zinc-400 text-sm mb-2">Alter column type, nullable, default, constraints</p>
  <SyntaxHighlighter
    code={`const res = await fetch('/v1/db/schema/tables/products/columns/price', {
  method: 'PATCH',
  headers: {
    'x-api-key': secretKey,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    type: 'decimal(10,2)',
    using: 'price::decimal(10,2)',
    nullable: false,
    addConstraint: {
      name: 'positive_price',
      type: 'check',
      expression: 'price >= 0'
    }
  })
});`}
  />
</div>

<div>
  <h4 className="font-semibold text-lg mb-2 text-blue-400">
    POST /v1/db/schema/indexes
  </h4>
  <p className="text-zinc-400 text-sm mb-2">Create an index</p>
  <SyntaxHighlighter
    code={`const res = await fetch('/v1/db/schema/indexes', {
  method: 'POST',
  headers: {
    'x-api-key': secretKey,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'idx_users_email',
    table: 'users',
    columns: ['email'],
    unique: true,
    where: 'deleted_at IS NULL'  // Partial index
  })
});`}
  />
</div>

<div>
  <h4 className="font-semibold text-lg mb-2 text-red-400">
    DELETE /v1/db/schema/indexes/:name
  </h4>
  <p className="text-zinc-400 text-sm mb-2">Drop an index</p>
  <SyntaxHighlighter
    code={`const res = await fetch('/v1/db/schema/indexes/idx_old_index', {
  method: 'DELETE',
  headers: {
    'x-api-key': secretKey,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ ifExists: true })
});`}
  />
</div>

<div>
  <h4 className="font-semibold text-lg mb-2 text-red-400">
    POST /v1/db/schema/tables/:table/truncate
  </h4>
  <p className="text-zinc-400 text-sm mb-2">Empty a table quickly (irreversible!)</p>
  <SyntaxHighlighter
    code={`const res = await fetch('/v1/db/schema/tables/logs/truncate', {
  method: 'POST',
  headers: {
    'x-api-key': secretKey,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    restartIdentity: true,  // Reset sequences
    cascade: false
  })
});`}
  />
</div>
```

**Step 3: Commit**

```bash
git add dashboard/app/\(dashboard\)/docs/page.tsx
git commit -m "docs(dashboard): add DDL extensions to in-app documentation"
```

---

## Task 8: Run Tests and Verify

**Step 1: Build the project**

```bash
pnpm --filter @atlashub/gateway build
```

Expected: Build succeeds without errors

**Step 2: Run integration tests**

```bash
pnpm --filter @atlashub/gateway test:e2e
```

Expected: All tests pass, including new DDL extension tests

**Step 3: Manual API test**

Start the development server and test each endpoint:

```bash
# Test ALTER COLUMN
curl -X PATCH http://localhost:3000/v1/db/schema/tables/users/columns/name \
  -H "x-api-key: sk_xxx" \
  -H "Content-Type: application/json" \
  -d '{"nullable": true}'

# Test CREATE INDEX
curl -X POST http://localhost:3000/v1/db/schema/indexes \
  -H "x-api-key: sk_xxx" \
  -H "Content-Type: application/json" \
  -d '{"name": "test_idx", "table": "users", "columns": ["email"]}'

# Test DROP INDEX
curl -X DELETE http://localhost:3000/v1/db/schema/indexes/test_idx \
  -H "x-api-key: sk_xxx" \
  -H "Content-Type: application/json" \
  -d '{}'

# Test TRUNCATE
curl -X POST http://localhost:3000/v1/db/schema/tables/test_table/truncate \
  -H "x-api-key: sk_xxx" \
  -H "Content-Type: application/json" \
  -d '{"restartIdentity": true}'
```

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: add DDL extensions (alter column, indexes, truncate)

- Add ALTER COLUMN with type change, nullable, default, constraints
- Add CREATE INDEX with unique, partial (WHERE clause) support
- Add DROP INDEX with IF EXISTS option
- Add TRUNCATE TABLE with RESTART IDENTITY and CASCADE
- Update all documentation (API-REFERENCE.md, USAGE.md, dashboard)
- Add integration tests for all new operations"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Add Zod schemas | `packages/shared/src/schemas.ts` |
| 2 | Add service methods | `gateway/src/services/crud.ts` |
| 3 | Add route handlers | `gateway/src/routes/public/db.ts` |
| 4 | Add integration tests | `gateway/src/__tests__/public-api.test.ts` |
| 5 | Update API reference | `docs/API-REFERENCE.md` |
| 6 | Update usage guide | `docs/USAGE.md` |
| 7 | Update dashboard docs | `dashboard/app/(dashboard)/docs/page.tsx` |
| 8 | Run tests and verify | - |
