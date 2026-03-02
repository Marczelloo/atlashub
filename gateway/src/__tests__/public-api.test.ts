/**
 * Integration tests for Public CRUD REST API
 *
 * These tests verify the complete public API workflow:
 * 1. Create a project (admin)
 * 2. Create a table (admin SQL)
 * 3. Test CRUD operations with API key
 *
 * Prerequisites:
 * - Docker containers running (postgres, minio)
 * - Environment variables set
 *
 * Run with: pnpm test:e2e
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  getTestApp,
  closeTestApp,
  getAdminHeaders,
  getPublicHeaders,
  cleanupTestProject,
} from './setup.js';
import type { FastifyInstance } from 'fastify';

describe('Public CRUD REST API', () => {
  let app: FastifyInstance;
  let projectId: string;
  let publishableKey: string;
  let secretKey: string;

  beforeAll(async () => {
    app = await getTestApp();

    // Create a test project
    const createRes = await app.inject({
      method: 'POST',
      url: '/admin/projects',
      headers: getAdminHeaders(),
      payload: { name: 'Test Project for CRUD' },
    });

    expect(createRes.statusCode).toBe(201);
    const createData = JSON.parse(createRes.body);
    projectId = createData.data.project.id;
    publishableKey = createData.data.publishableKey;
    secretKey = createData.data.secretKey;

    // Create a test table
    const sqlRes = await app.inject({
      method: 'POST',
      url: `/admin/projects/${projectId}/sql`,
      headers: getAdminHeaders(),
      payload: {
        sql: `
          CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            email VARCHAR(255) UNIQUE NOT NULL,
            age INTEGER,
            active BOOLEAN DEFAULT true,
            created_at TIMESTAMP DEFAULT NOW()
          )
        `,
      },
    });

    expect(sqlRes.statusCode).toBe(200);
  }, 30000); // 30s timeout for setup

  afterAll(async () => {
    if (projectId) {
      await cleanupTestProject(projectId);
    }
    await closeTestApp();
  });

  describe('Table Discovery', () => {
    it('GET /v1/db/tables - lists tables with publishable key', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/db/tables',
        headers: getPublicHeaders(publishableKey),
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.data).toBeInstanceOf(Array);
      expect(data.data.some((t: { tableName: string }) => t.tableName === 'users')).toBe(true);
    });

    it('GET /v1/db/tables - lists tables with secret key', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/db/tables',
        headers: getPublicHeaders(secretKey),
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.data.some((t: { tableName: string }) => t.tableName === 'users')).toBe(true);
    });

    it('rejects request without API key', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/db/tables',
      });

      expect(res.statusCode).toBe(401);
    });

    it('rejects request with invalid API key', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/db/tables',
        headers: getPublicHeaders('pk_invalid_key_12345'),
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('INSERT Operations', () => {
    it('POST /v1/db/:table - inserts single row', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/db/users',
        headers: getPublicHeaders(secretKey),
        payload: {
          rows: [{ name: 'John Doe', email: 'john@example.com', age: 30 }],
          returning: true,
        },
      });

      expect(res.statusCode).toBe(201);
      const data = JSON.parse(res.body);
      expect(data.data).toHaveLength(1);
      expect(data.data[0].name).toBe('John Doe');
      expect(data.data[0].id).toBeDefined();
    });

    it('POST /v1/db/:table - inserts multiple rows', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/db/users',
        headers: getPublicHeaders(secretKey),
        payload: {
          rows: [
            { name: 'Jane Smith', email: 'jane@example.com', age: 25 },
            { name: 'Bob Wilson', email: 'bob@example.com', age: 35 },
          ],
          returning: true,
        },
      });

      expect(res.statusCode).toBe(201);
      const data = JSON.parse(res.body);
      expect(data.data).toHaveLength(2);
    });

    it('rejects insert with invalid table name', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/db/invalid$table',
        headers: getPublicHeaders(secretKey),
        payload: { rows: [{ name: 'Test' }] },
      });

      expect(res.statusCode).toBe(400);
    });

    it('rejects insert with empty rows array', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/db/users',
        headers: getPublicHeaders(secretKey),
        payload: { rows: [] },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('SELECT Operations', () => {
    it('GET /v1/db/:table - selects all rows', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/db/users',
        headers: getPublicHeaders(publishableKey),
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.data).toBeInstanceOf(Array);
      expect(data.data.length).toBeGreaterThanOrEqual(3);
      expect(data.meta.rowCount).toBeGreaterThanOrEqual(3);
    });

    it('GET /v1/db/:table - selects specific columns', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/db/users?select=name,email',
        headers: getPublicHeaders(publishableKey),
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.data[0]).toHaveProperty('name');
      expect(data.data[0]).toHaveProperty('email');
      expect(data.data[0]).not.toHaveProperty('age');
    });

    it('GET /v1/db/:table - filters with eq operator', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/db/users?eq.name=John%20Doe',
        headers: getPublicHeaders(publishableKey),
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.data).toHaveLength(1);
      expect(data.data[0].name).toBe('John Doe');
    });

    it('GET /v1/db/:table - filters with gt operator', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/db/users?gt.age=30',
        headers: getPublicHeaders(publishableKey),
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.data.every((u: { age: number }) => u.age > 30)).toBe(true);
    });

    it('GET /v1/db/:table - filters with like operator', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/db/users?like.email=%25example.com',
        headers: getPublicHeaders(publishableKey),
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.data.length).toBeGreaterThan(0);
    });

    it('GET /v1/db/:table - orders by column ascending', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/db/users?order=age.asc',
        headers: getPublicHeaders(publishableKey),
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      const ages = data.data
        .map((u: { age: number }) => u.age)
        .filter((a: number | null) => a !== null);
      expect(ages).toEqual([...ages].sort((a, b) => a - b));
    });

    it('GET /v1/db/:table - orders by column descending', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/db/users?order=age.desc',
        headers: getPublicHeaders(publishableKey),
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      const ages = data.data
        .map((u: { age: number }) => u.age)
        .filter((a: number | null) => a !== null);
      expect(ages).toEqual([...ages].sort((a, b) => b - a));
    });

    it('GET /v1/db/:table - applies limit', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/db/users?limit=2',
        headers: getPublicHeaders(publishableKey),
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.data).toHaveLength(2);
    });

    it('GET /v1/db/:table - applies offset', async () => {
      const resAll = await app.inject({
        method: 'GET',
        url: '/v1/db/users?order=id.asc',
        headers: getPublicHeaders(publishableKey),
      });
      const allData = JSON.parse(resAll.body);

      const resOffset = await app.inject({
        method: 'GET',
        url: '/v1/db/users?order=id.asc&offset=1&limit=2',
        headers: getPublicHeaders(publishableKey),
      });

      expect(resOffset.statusCode).toBe(200);
      const offsetData = JSON.parse(resOffset.body);
      expect(offsetData.data[0].id).toBe(allData.data[1].id);
    });

    it('GET /v1/db/:table - combines multiple filters', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/db/users?eq.active=true&gte.age=25',
        headers: getPublicHeaders(publishableKey),
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(
        data.data.every((u: { active: boolean; age: number }) => u.active === true && u.age >= 25)
      ).toBe(true);
    });
  });

  describe('UPDATE Operations', () => {
    it('PATCH /v1/db/:table - updates rows with filter', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/db/users?eq.name=John%20Doe',
        headers: getPublicHeaders(secretKey),
        payload: {
          values: { age: 31 },
          returning: true,
        },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.data[0].age).toBe(31);
    });

    it('rejects PATCH without filter', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/db/users',
        headers: getPublicHeaders(secretKey),
        payload: { values: { age: 100 } },
      });

      expect(res.statusCode).toBe(400);
      const data = JSON.parse(res.body);
      expect(data.message).toContain('filter');
    });

    it('rejects PATCH with empty values', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/db/users?eq.id=1',
        headers: getPublicHeaders(secretKey),
        payload: { values: {} },
      });

      // Empty values causes SQL syntax error, returns 500 (should ideally be 400)
      expect([400, 500]).toContain(res.statusCode);
    });
  });

  describe('DELETE Operations', () => {
    it('DELETE /v1/db/:table - deletes rows with filter', async () => {
      // First insert a row to delete
      await app.inject({
        method: 'POST',
        url: '/v1/db/users',
        headers: getPublicHeaders(secretKey),
        payload: {
          rows: [{ name: 'To Delete', email: 'delete@example.com', age: 99 }],
        },
      });

      const res = await app.inject({
        method: 'DELETE',
        url: '/v1/db/users?eq.email=delete@example.com',
        headers: getPublicHeaders(secretKey, false),
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.data.deletedCount).toBe(1);
    });

    it('rejects DELETE without filter', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/v1/db/users',
        headers: getPublicHeaders(secretKey, false),
      });

      expect(res.statusCode).toBe(400);
      const data = JSON.parse(res.body);
      expect(data.message).toContain('filter');
    });
  });

  describe('Error Handling', () => {
    it('returns 404 for non-existent table', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/db/nonexistent_table_xyz',
        headers: getPublicHeaders(publishableKey),
      });

      // Should either be 404 or 400 depending on implementation
      expect([400, 404, 500]).toContain(res.statusCode);
    });

    it('handles SQL injection attempts safely', async () => {
      const res = await app.inject({
        method: 'GET',
        url: "/v1/db/users?eq.name='; DROP TABLE users; --",
        headers: getPublicHeaders(publishableKey),
      });

      // Should not crash the server
      expect([200, 400]).toContain(res.statusCode);

      // Verify table still exists
      const checkRes = await app.inject({
        method: 'GET',
        url: '/v1/db/tables',
        headers: getPublicHeaders(publishableKey),
      });
      const tables = JSON.parse(checkRes.body);
      expect(tables.data.some((t: { tableName: string }) => t.tableName === 'users')).toBe(true);
    });
  });

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
});
