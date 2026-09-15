import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

vi.mock('../../config/env.js', () => ({ config: { isProduction: false } }));

const select = vi.fn();
const insert = vi.fn();
const update = vi.fn();
const remove = vi.fn();
vi.mock('../../services/crud.js', () => ({
  crudService: {
    select: (...args: unknown[]) => select(...args),
    insert: (...args: unknown[]) => insert(...args),
    update: (...args: unknown[]) => update(...args),
    delete: (...args: unknown[]) => remove(...args),
  },
}));

const hasWebhooksFor = vi.fn();
const triggerWebhooks = vi.fn();
vi.mock('../../services/webhook.js', () => ({
  webhookService: {
    hasWebhooksFor: (...args: unknown[]) => hasWebhooksFor(...args),
    triggerWebhooks: (...args: unknown[]) => triggerWebhooks(...args),
  },
}));

import { dbRoutes, READ_BATCH_MAX_OPERATIONS } from './db.js';
import { errorHandler, NotFoundError } from '../../lib/errors.js';

let app: FastifyInstance;

beforeEach(async () => {
  select.mockReset().mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });
  insert.mockReset().mockResolvedValue([{ id: 1 }]);
  update.mockReset().mockResolvedValue([{ id: 1 }]);
  remove.mockReset().mockResolvedValue({ rowCount: 1 });
  hasWebhooksFor.mockReset().mockResolvedValue(false);
  triggerWebhooks.mockReset().mockResolvedValue(undefined);

  app = Fastify();
  app.setErrorHandler(errorHandler);
  app.addHook('onRequest', async (request) => {
    request.projectContext = { projectId: 'p1', keyType: 'secret', keyId: 'k1' };
  });
  await app.register(dbRoutes, { prefix: '/v1/db' });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('GET /v1/db/:table', () => {
  it('keeps the response unchanged without count', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/db/items?eq.user_id=u1&limit=5' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: [{ id: 1 }], meta: { rowCount: 1 } });
    const options = select.mock.calls[0][2];
    expect(options).toMatchObject({ limit: 5, count: false, countOnly: false });
    expect(options.filters).toEqual([{ column: 'user_id', operator: 'eq', value: 'u1' }]);
  });

  it('returns the matching row count with count=exact', async () => {
    select.mockResolvedValue({ rows: [], rowCount: 0, count: 42 });
    const res = await app.inject({ method: 'GET', url: '/v1/db/items?eq.user_id=u1&count=exact&limit=0' });

    expect(res.json()).toEqual({ data: [], meta: { rowCount: 0, count: 42 } });
    expect(select.mock.calls[0][2]).toMatchObject({ count: true, countOnly: true });
  });

  it('limit=0 without count keeps its old meaning', async () => {
    await app.inject({ method: 'GET', url: '/v1/db/items?limit=0' });
    expect(select.mock.calls[0][2]).toMatchObject({ limit: 0, count: false, countOnly: false });
  });
});

describe('POST /v1/db/read-batch', () => {
  it('runs several reads in one request', async () => {
    select.mockImplementation(async (_projectId: string, table: string) =>
      table === 'sessions'
        ? { rows: [{ id: 's1' }], rowCount: 1 }
        : { rows: [], rowCount: 0, count: 3 }
    );

    const res = await app.inject({
      method: 'POST',
      url: '/v1/db/read-batch',
      payload: {
        operations: [
          { table: 'sessions', query: { 'eq.token_hash': 'abc', limit: 1 } },
          { table: 'ai_usage', query: { 'eq.user_id': 'u1', 'in.kind': ['stylist', 'x'], count: 'exact', limit: 0 } },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      data: [
        { data: [{ id: 's1' }], meta: { rowCount: 1 } },
        { data: [], meta: { rowCount: 0, count: 3 } },
      ],
    });

    expect(select).toHaveBeenCalledTimes(2);
    expect(select.mock.calls[0][0]).toBe('p1');
    expect(select.mock.calls[0][2]).toMatchObject({
      limit: 1,
      filters: [{ column: 'token_hash', operator: 'eq', value: 'abc' }],
    });
    expect(select.mock.calls[1][2]).toMatchObject({
      count: true,
      countOnly: true,
      filters: [
        { column: 'user_id', operator: 'eq', value: 'u1' },
        { column: 'kind', operator: 'in', value: ['stylist', 'x'] },
      ],
    });
  });

  it('rejects more operations than allowed', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/db/read-batch',
      payload: {
        operations: Array.from({ length: READ_BATCH_MAX_OPERATIONS + 1 }, () => ({ table: 'items' })),
      },
    });
    expect(res.statusCode).toBe(400);
    expect(select).not.toHaveBeenCalled();
  });

  it('rejects an invalid table name before reading anything', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/db/read-batch',
      payload: { operations: [{ table: 'items' }, { table: 'bad-name' }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('Operation 1: Invalid table name');
    expect(select).not.toHaveBeenCalled();
  });

  it('reports which operation failed with its original status', async () => {
    select
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockRejectedValueOnce(new NotFoundError('Table "missing" not found'));

    const res = await app.inject({
      method: 'POST',
      url: '/v1/db/read-batch',
      payload: { operations: [{ table: 'items' }, { table: 'missing' }] },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().message).toBe('Operation 1: Table "missing" not found');
  });

  it('does not shadow inserts into a table', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/db/batch',
      payload: { rows: [{ name: 'x' }] },
    });
    expect(res.statusCode).toBe(201);
    expect(insert.mock.calls[0][1]).toBe('batch');
  });
});

describe('writes without webhooks', () => {
  it('update skips the webhook SELECT and triggers when nothing listens', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/db/items?eq.id=1',
      payload: { values: { is_clean: true }, returning: true },
    });

    expect(res.statusCode).toBe(200);
    expect(hasWebhooksFor).toHaveBeenCalledWith('p1', 'record.updated', 'items');
    expect(select).not.toHaveBeenCalled();
    expect(triggerWebhooks).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('update still loads old records and triggers when a webhook listens', async () => {
    hasWebhooksFor.mockResolvedValue(true);
    select.mockResolvedValue({ rows: [{ id: 1, is_clean: false }], rowCount: 1 });

    await app.inject({
      method: 'PATCH',
      url: '/v1/db/items?eq.id=1',
      payload: { values: { is_clean: true }, returning: true },
    });

    expect(select).toHaveBeenCalledTimes(1);
    expect(triggerWebhooks).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'record.updated', oldRecord: { id: 1, is_clean: false } })
    );
  });

  it('update without returning still sends the generic event when a webhook listens', async () => {
    hasWebhooksFor.mockResolvedValue(true);
    await app.inject({
      method: 'PATCH',
      url: '/v1/db/items?eq.id=1',
      payload: { values: { is_clean: true } },
    });
    expect(select).not.toHaveBeenCalled();
    expect(triggerWebhooks).toHaveBeenCalledWith(expect.objectContaining({ record: { is_clean: true } }));
  });

  it('delete skips the webhook SELECT when nothing listens', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/v1/db/items?eq.id=1' });

    expect(res.json()).toEqual({ data: { deletedCount: 1 } });
    expect(select).not.toHaveBeenCalled();
    expect(triggerWebhooks).not.toHaveBeenCalled();
  });

  it('delete loads records for webhooks when one listens', async () => {
    hasWebhooksFor.mockResolvedValue(true);
    await app.inject({ method: 'DELETE', url: '/v1/db/items?eq.id=1' });
    expect(select).toHaveBeenCalledTimes(1);
    expect(triggerWebhooks).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'record.deleted' }));
  });
});
