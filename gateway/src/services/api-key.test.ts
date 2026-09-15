import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config/env.js', () => ({
  config: { security: { platformMasterKey: 'x'.repeat(64) } },
}));

const query = vi.fn();
const transaction = vi.fn();
vi.mock('../db/platform.js', () => ({
  platformDb: {
    query: (...args: unknown[]) => query(...args),
    transaction: (...args: unknown[]) => transaction(...args),
  },
}));
vi.mock('./audit.js', () => ({
  auditService: { log: vi.fn(), actions: { KEY_ROTATED: 'key.rotated', KEY_REVOKED: 'key.revoked' } },
}));

import { apiKeyService, KEY_CACHE_TTL_MS } from './api-key.js';
import { hashApiKey } from '../lib/crypto.js';

const KEY = 'sk_test_key';

function keyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'k1',
    project_id: 'p1',
    key_type: 'secret',
    key_hash: hashApiKey(KEY),
    expires_at: null,
    ...overrides,
  };
}

function lookups(): number {
  return query.mock.calls.filter((call) => String(call[0]).includes('WHERE key_hash = $1')).length;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-14T10:00:00Z'));
  query.mockReset().mockResolvedValue({ rows: [keyRow()], rowCount: 1 });
  transaction.mockReset().mockImplementation(async (fn: (client: { query: typeof query }) => unknown) =>
    fn({ query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) })
  );
  apiKeyService.clearKeyCache();
});

afterEach(() => vi.useRealTimers());

describe('apiKeyService.validateKey', () => {
  it('looks the key up by its hash instead of loading every key', async () => {
    const context = await apiKeyService.validateKey(KEY);

    expect(context).toEqual({ projectId: 'p1', keyType: 'secret', keyId: 'k1' });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('WHERE key_hash = $1');
    expect(query.mock.calls[0][1]).toEqual([hashApiKey(KEY)]);
  });

  it('serves repeated validations from memory', async () => {
    await apiKeyService.validateKey(KEY);
    await apiKeyService.validateKey(KEY);
    await apiKeyService.validateKey(KEY);
    expect(lookups()).toBe(1);
  });

  it('checks the database again after the cache TTL', async () => {
    await apiKeyService.validateKey(KEY);
    vi.setSystemTime(Date.now() + KEY_CACHE_TTL_MS + 1);
    await apiKeyService.validateKey(KEY);
    expect(lookups()).toBe(2);
  });

  it('rejects unknown keys and does not cache the rejection', async () => {
    query.mockResolvedValue({ rows: [], rowCount: 0 });
    expect(await apiKeyService.validateKey('sk_unknown')).toBeUndefined();

    query.mockResolvedValue({ rows: [keyRow({ key_hash: hashApiKey('sk_unknown') })], rowCount: 1 });
    expect(await apiKeyService.validateKey('sk_unknown')).toBeDefined();
  });

  it('does not keep an expiring key cached past its expiry', async () => {
    query.mockResolvedValue({
      rows: [keyRow({ expires_at: new Date(Date.now() + 5_000) })],
      rowCount: 1,
    });
    await apiKeyService.validateKey(KEY);

    vi.setSystemTime(Date.now() + 5_001);
    query.mockResolvedValue({ rows: [], rowCount: 0 });
    expect(await apiKeyService.validateKey(KEY)).toBeUndefined();
  });

  it('revoking a key stops cached validations immediately', async () => {
    await apiKeyService.validateKey(KEY);

    await apiKeyService.revokeKey('k1');
    query.mockResolvedValue({ rows: [], rowCount: 0 });

    expect(await apiKeyService.validateKey(KEY)).toBeUndefined();
  });

  it('rotating keys stops cached validations immediately', async () => {
    await apiKeyService.validateKey(KEY);

    query.mockImplementation(async (sql: string) =>
      sql.startsWith('SELECT * FROM api_keys')
        ? { rows: [{ id: 'k2', project_id: 'p1', key_type: 'secret', key_prefix: 'sk_', created_at: new Date() }] }
        : { rows: [], rowCount: 0 }
    );
    await apiKeyService.rotateKey('p1', 'secret');

    expect(await apiKeyService.validateKey(KEY)).toBeUndefined();
  });

  it('a validation that started before a revocation does not re-cache the key', async () => {
    let release!: () => void;
    query.mockImplementationOnce(
      () => new Promise((resolve) => {
        release = () => resolve({ rows: [keyRow()], rowCount: 1 });
      })
    );

    const inFlight = apiKeyService.validateKey(KEY);
    apiKeyService.clearKeyCache();
    release();
    await inFlight;

    query.mockResolvedValue({ rows: [], rowCount: 0 });
    expect(await apiKeyService.validateKey(KEY)).toBeUndefined();
  });
});
