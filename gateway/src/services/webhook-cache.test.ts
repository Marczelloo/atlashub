import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config/env.js', () => ({ config: { isProduction: false } }));

const query = vi.fn();
vi.mock('../db/platform.js', () => ({
  platformDb: { query: (...args: unknown[]) => query(...args) },
}));
vi.mock('./audit.js', () => ({ auditService: { log: vi.fn() } }));

import { webhookService, WEBHOOK_CACHE_TTL_MS } from './webhook.js';

function webhook(overrides: Record<string, unknown> = {}) {
  return {
    id: 'w1',
    project_id: 'p1',
    url: 'https://example.com/hook',
    method: 'POST',
    secret_hash: 'h',
    events: ['record.created', 'record.deleted'],
    table_filter: [],
    headers: {},
    timeout_ms: 1000,
    max_retries: 0,
    retry_backoff_ms: 1000,
    ...overrides,
  };
}

function webhookLookups(): number {
  return query.mock.calls.filter((call) => String(call[0]).includes('AND enabled = true')).length;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-14T10:00:00Z'));
  query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
  webhookService.clearWebhookCache();
});

afterEach(() => vi.useRealTimers());

describe('webhook lookup cache', () => {
  it('a project without webhooks is looked up once, not on every write', async () => {
    expect(await webhookService.hasWebhooksFor('p1', 'record.updated', 'items')).toBe(false);
    expect(await webhookService.hasWebhooksFor('p1', 'record.deleted', 'items')).toBe(false);
    await webhookService.triggerWebhooks({
      eventType: 'record.created',
      projectId: 'p1',
      tableName: 'items',
      record: { id: 1 },
      timestamp: new Date(),
    });

    expect(webhookLookups()).toBe(1);
    expect(query.mock.calls[0][1]).toEqual(['p1']);
  });

  it('matches events and table filters like the previous SQL filter did', async () => {
    query.mockResolvedValue({
      rows: [
        webhook({ id: 'all-tables' }),
        webhook({ id: 'jobs-only', table_filter: ['jobs'] }),
        webhook({ id: 'updates', events: ['record.updated'] }),
      ],
    });

    const created = await webhookService.matchingWebhooks('p1', 'record.created', 'items');
    expect(created.map((w) => w.id)).toEqual(['all-tables']);

    const createdJobs = await webhookService.matchingWebhooks('p1', 'record.created', 'jobs');
    expect(createdJobs.map((w) => w.id)).toEqual(['all-tables', 'jobs-only']);

    expect(await webhookService.hasWebhooksFor('p1', 'record.updated', 'items')).toBe(true);
  });

  it('keeps projects separate', async () => {
    query.mockImplementation(async (_sql: string, params: unknown[]) => ({
      rows: params[0] === 'p1' ? [webhook()] : [],
    }));
    expect(await webhookService.hasWebhooksFor('p1', 'record.created', 't')).toBe(true);
    expect(await webhookService.hasWebhooksFor('p2', 'record.created', 't')).toBe(false);
  });

  it('refreshes after the TTL', async () => {
    await webhookService.hasWebhooksFor('p1', 'record.created', 't');
    vi.setSystemTime(Date.now() + WEBHOOK_CACHE_TTL_MS + 1);
    await webhookService.hasWebhooksFor('p1', 'record.created', 't');
    expect(webhookLookups()).toBe(2);
  });

  it('deleting a webhook through the API takes effect immediately', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('AND enabled = true')) return { rows: [webhook()] };
      if (sql.includes('WHERE id = $1') && sql.trim().startsWith('SELECT')) {
        return {
          rows: [{
            ...webhook(), name: 'n', description: null, enabled: true, last_triggered_at: null,
            last_success_at: null, last_failure_at: null, created_by: null,
            created_at: new Date(), updated_at: new Date(),
          }],
        };
      }
      return { rows: [], rowCount: 1 };
    });
    expect(await webhookService.hasWebhooksFor('p1', 'record.created', 't')).toBe(true);

    await webhookService.deleteWebhook('w1');
    query.mockResolvedValue({ rows: [] });

    expect(await webhookService.hasWebhooksFor('p1', 'record.created', 't')).toBe(false);
  });

  it('a lookup that started before a change does not cache stale rows', async () => {
    let release!: () => void;
    query.mockImplementationOnce(
      () => new Promise((resolve) => {
        release = () => resolve({ rows: [webhook()] });
      })
    );

    const inFlight = webhookService.hasWebhooksFor('p1', 'record.created', 't');
    webhookService.clearWebhookCache('p1');
    release();
    expect(await inFlight).toBe(true);

    query.mockResolvedValue({ rows: [] });
    expect(await webhookService.hasWebhooksFor('p1', 'record.created', 't')).toBe(false);
  });

  it('assumes webhooks exist when the lookup fails, keeping the old behaviour', async () => {
    query.mockRejectedValue(new Error('relation "webhooks" does not exist'));
    expect(await webhookService.hasWebhooksFor('p1', 'record.updated', 't')).toBe(true);
    // Failures are not cached.
    query.mockResolvedValue({ rows: [] });
    expect(await webhookService.hasWebhooksFor('p1', 'record.updated', 't')).toBe(false);
  });
});
