/**
 * Integration tests for Public Storage API
 *
 * Tests the storage endpoints:
 * - POST /v1/storage/buckets
 * - GET /v1/storage/buckets
 * - POST /v1/storage/signed-upload
 * - GET /v1/storage/signed-download
 * - GET /v1/storage/list (secret key only)
 * - DELETE /v1/storage/object
 *
 * Prerequisites:
 * - Docker containers running (postgres, minio)
 * - Environment variables set
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

describe('Public Storage API', () => {
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
      payload: { name: 'Test Project for Storage' },
    });

    expect(createRes.statusCode).toBe(201);
    const createData = JSON.parse(createRes.body);
    projectId = createData.data.project.id;
    publishableKey = createData.data.publishableKey;
    secretKey = createData.data.secretKey;
  }, 30000);

  afterAll(async () => {
    if (projectId) {
      await cleanupTestProject(projectId);
    }
    await closeTestApp();
  });

  describe('Logical Buckets', () => {
    it('creates and lists a bucket with a secret key', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/storage/buckets',
        headers: getPublicHeaders(secretKey),
        payload: { name: 'drive-test' },
      });

      expect(createRes.statusCode).toBe(201);
      const created = JSON.parse(createRes.body);
      expect(created.data.name).toBe('drive-test');

      const listRes = await app.inject({
        method: 'GET',
        url: '/v1/storage/buckets',
        headers: getPublicHeaders(secretKey, false),
      });

      expect(listRes.statusCode).toBe(200);
      const listed = JSON.parse(listRes.body);
      expect(listed.data.some((bucket: { name: string }) => bucket.name === 'drive-test')).toBe(
        true
      );
    });

    it('rejects bucket management with a publishable key', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/storage/buckets',
        headers: getPublicHeaders(publishableKey),
        payload: { name: 'not-allowed' },
      });

      expect(createRes.statusCode).toBe(403);
    });
  });

  describe('Signed Upload URL', () => {
    it('POST /v1/storage/signed-upload - returns presigned URL with publishable key', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/storage/signed-upload',
        headers: getPublicHeaders(publishableKey),
        payload: {
          bucket: 'uploads',
          path: 'test/image.png',
          contentType: 'image/png',
          maxSize: 5242880, // 5MB
        },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.data.uploadUrl).toBeDefined();
      expect(data.data.objectKey).toBeDefined();
      expect(data.data.expiresIn).toBeDefined();
      expect(data.data.uploadUrl).toContain('X-Amz-Signature');
    });

    it('POST /v1/storage/signed-upload - returns presigned URL with secret key', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/storage/signed-upload',
        headers: getPublicHeaders(secretKey),
        payload: {
          bucket: 'uploads',
          path: 'test/document.pdf',
          contentType: 'application/pdf',
        },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.data.uploadUrl).toBeDefined();
    });

    it('rejects upload request without bucket', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/storage/signed-upload',
        headers: getPublicHeaders(publishableKey),
        payload: {
          path: 'test/image.png',
          contentType: 'image/png',
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('rejects upload request without path', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/storage/signed-upload',
        headers: getPublicHeaders(publishableKey),
        payload: {
          bucket: 'uploads',
          contentType: 'image/png',
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('rejects upload request without API key', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/storage/signed-upload',
        payload: {
          bucket: 'uploads',
          path: 'test/image.png',
          contentType: 'image/png',
        },
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('Signed Download URL', () => {
    it('GET /v1/storage/signed-download - returns presigned URL', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/storage/signed-download?bucket=uploads&objectKey=uploads/test/image.png',
        headers: getPublicHeaders(publishableKey),
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.data.downloadUrl).toBeDefined();
      expect(data.data.expiresIn).toBeDefined();
    });

    it('rejects download without bucket', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/storage/signed-download?objectKey=test/image.png',
        headers: getPublicHeaders(publishableKey),
      });

      expect(res.statusCode).toBe(400);
    });

    it('rejects download without objectKey', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/storage/signed-download?bucket=uploads',
        headers: getPublicHeaders(publishableKey),
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('List Objects', () => {
    it('GET /v1/storage/list - lists objects with secret key', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/storage/list?bucket=uploads',
        headers: getPublicHeaders(secretKey),
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.data.objects).toBeInstanceOf(Array);
    });

    it('rejects list with publishable key', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/storage/list?bucket=uploads',
        headers: getPublicHeaders(publishableKey),
      });

      expect(res.statusCode).toBe(403);
    });

    it('rejects list without bucket parameter', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/storage/list',
        headers: getPublicHeaders(secretKey),
      });

      expect(res.statusCode).toBe(400);
    });

    it('GET /v1/storage/list - supports prefix filter', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/storage/list?bucket=uploads&prefix=test/',
        headers: getPublicHeaders(secretKey),
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.data.objects).toBeInstanceOf(Array);
    });

    it('GET /v1/storage/list - supports limit', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/storage/list?bucket=uploads&limit=10',
        headers: getPublicHeaders(secretKey),
      });

      expect(res.statusCode).toBe(200);
    });
  });

  describe('Delete Object', () => {
    it('DELETE /v1/storage/object - deletes object', async () => {
      // This test will succeed even if object doesn't exist (S3 behavior)
      const res = await app.inject({
        method: 'DELETE',
        url: '/v1/storage/object?bucket=uploads&objectKey=uploads/test/to-delete.png',
        headers: getPublicHeaders(secretKey, false),
      });

      expect(res.statusCode).toBe(204);
    });

    it('rejects delete without bucket', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/v1/storage/object?objectKey=test/file.png',
        headers: getPublicHeaders(secretKey, false),
      });

      expect(res.statusCode).toBe(400);
    });

    it('rejects delete without objectKey', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/v1/storage/object?bucket=uploads',
        headers: getPublicHeaders(secretKey, false),
      });

      expect(res.statusCode).toBe(400);
    });
  });
});
