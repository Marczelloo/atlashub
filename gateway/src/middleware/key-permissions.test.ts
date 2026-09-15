import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

vi.mock('../config/env.js', () => ({ config: { isProduction: false } }));

vi.mock('../services/api-key.js', () => ({
  apiKeyService: {
    validateKey: vi.fn(async (key: string) =>
      key.startsWith('sk_')
        ? { projectId: 'p1', keyType: 'secret', keyId: 'k-secret' }
        : key.startsWith('pk_')
          ? { projectId: 'p1', keyType: 'publishable', keyId: 'k-public' }
          : undefined
    ),
  },
}));

vi.mock('../services/crud.js', () => ({
  crudService: {
    getTables: vi.fn().mockResolvedValue([]),
    select: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    insert: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue({ rowCount: 0 }),
  },
}));
vi.mock('../services/webhook.js', () => ({
  webhookService: { hasWebhooksFor: vi.fn().mockResolvedValue(false), triggerWebhooks: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../services/storage.js', () => ({
  storageService: {
    getSignedUploadUrl: vi.fn().mockResolvedValue({ objectKey: 'b/a', uploadUrl: 'http://u', expiresIn: 60 }),
    getSignedDownloadUrl: vi.fn().mockResolvedValue({ downloadUrl: 'http://d', expiresIn: 60 }),
    initiateMultipartUpload: vi.fn().mockResolvedValue({ objectKey: 'b/a', uploadId: 'u', expiresIn: 60 }),
    deleteObject: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('../services/buckets.js', () => ({ bucketService: { listBuckets: vi.fn(), createBucket: vi.fn() } }));

import { publicRoutes } from '../routes/public/index.js';
import { errorHandler } from '../lib/errors.js';
import { isAllowedForPublishableKey } from './key-permissions.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(publicRoutes, { prefix: '/v1' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

function call(key: string, method: string, url: string, payload?: unknown) {
  return app.inject({
    method: method as 'GET',
    url,
    headers: { 'x-api-key': key },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}

const WRITES: [string, string, unknown?][] = [
  ['POST', '/v1/db/items', { rows: [{ name: 'x' }] }],
  ['PATCH', '/v1/db/items?eq.id=1', { values: { name: 'y' } }],
  ['DELETE', '/v1/db/items?eq.id=1'],
  ['POST', '/v1/storage/signed-upload', { bucket: 'b', path: 'a.jpg', contentType: 'image/jpeg', maxSize: 10 }],
  ['POST', '/v1/storage/multipart/initiate', { bucket: 'b', path: 'a.mp4', contentType: 'video/mp4', size: 10 }],
  ['DELETE', '/v1/storage/object?bucket=b&objectKey=a.jpg'],
  ['POST', '/v1/db/schema/tables', { name: 't', columns: [{ name: 'id', type: 'uuid' }] }],
];

describe('publishable keys are read-only', () => {
  it.each(WRITES)('%s %s is refused for a publishable key', async (method, url, payload) => {
    const res = await call('pk_test', method, url, payload);
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toBe('This operation requires a secret API key');
  });

  it.each([
    ['GET', '/v1/db/tables'],
    ['GET', '/v1/db/items?limit=5'],
    ['GET', '/v1/storage/signed-download?bucket=b&objectKey=a.jpg'],
  ])('%s %s is allowed for a publishable key', async (method, url) => {
    expect((await call('pk_test', method, url)).statusCode).toBe(200);
  });

  it('allows read batches for a publishable key', async () => {
    const res = await call('pk_test', 'POST', '/v1/db/read-batch', { operations: [{ table: 'items' }] });
    expect(res.statusCode).toBe(200);
  });

  it('secret keys keep write access', async () => {
    expect((await call('sk_test', 'POST', '/v1/db/items', { rows: [{ name: 'x' }] })).statusCode).toBe(201);
    expect((await call('sk_test', 'DELETE', '/v1/db/items?eq.id=1')).statusCode).toBe(200);
  });

  it('unknown keys are still rejected before permissions', async () => {
    expect((await call('nope', 'GET', '/v1/db/tables')).statusCode).toBe(401);
  });

  it('treats HEAD like GET and unmatched routes as not allowed', () => {
    expect(isAllowedForPublishableKey('HEAD', '/v1/db/:table')).toBe(true);
    expect(isAllowedForPublishableKey('GET', undefined)).toBe(false);
  });
});
