import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { parseRateLimitOverrides, projectRateLimit } from './rate-limit-overrides.js';

const PROJECT_A = '11111111-1111-4111-8111-111111111111';
const PROJECT_B = '22222222-2222-4222-8222-222222222222';

describe('parseRateLimitOverrides', () => {
  it('parses project limits', () => {
    const result = parseRateLimitOverrides(`${PROJECT_A}=300, ${PROJECT_B}=500`);
    expect(result.invalid).toEqual([]);
    expect(projectRateLimit(result, PROJECT_A)).toBe(300);
    expect(projectRateLimit(result, PROJECT_B.toUpperCase())).toBe(500);
  });

  it('treats an empty or missing value as no overrides', () => {
    expect(parseRateLimitOverrides('').limits.size).toBe(0);
    expect(parseRateLimitOverrides(undefined).limits.size).toBe(0);
    expect(projectRateLimit(parseRateLimitOverrides(''), PROJECT_A)).toBeUndefined();
  });

  it('skips invalid entries instead of failing', () => {
    const result = parseRateLimitOverrides(
      `${PROJECT_A}=300,not-a-uuid=10,${PROJECT_B}=abc,${PROJECT_B}=0,${PROJECT_B}=1.5,${PROJECT_B}`
    );
    expect(projectRateLimit(result, PROJECT_A)).toBe(300);
    expect(projectRateLimit(result, PROJECT_B)).toBeUndefined();
    expect(result.invalid).toHaveLength(5);
  });

  it('returns undefined without a project', () => {
    expect(projectRateLimit(parseRateLimitOverrides(`${PROJECT_A}=300`), undefined)).toBeUndefined();
  });
});

/**
 * The override and the per-project key rely on the rate-limit hook running
 * after the public auth hook has set projectContext. This mirrors how app.ts
 * registers both, using the real plugin.
 */
describe('rate limit hook order', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    await app?.close();
    app = null;
  });

  async function buildTestApp(): Promise<FastifyInstance> {
    const overrides = parseRateLimitOverrides(`${PROJECT_A}=5`);
    const instance = Fastify();

    await instance.register(rateLimit, {
      max: (request) =>
        projectRateLimit(
          overrides,
          (request as unknown as { projectContext?: { projectId: string } }).projectContext?.projectId
        ) ?? 2,
      timeWindow: 60_000,
      keyGenerator: (request) =>
        (request as unknown as { projectContext?: { projectId: string } }).projectContext?.projectId ??
        request.ip,
    });

    await instance.register(
      async (child) => {
        child.addHook('onRequest', async (request) => {
          const key = request.headers['x-api-key'];
          (request as unknown as { projectContext: { projectId: string } }).projectContext = {
            projectId: key === 'a' ? PROJECT_A : PROJECT_B,
          };
        });
        child.get('/ping', async () => ({ ok: true }));
      },
      { prefix: '/v1' }
    );

    await instance.ready();
    return instance;
  }

  it('applies the project override and counts each project separately', async () => {
    app = await buildTestApp();

    const projectA = await app.inject({ method: 'GET', url: '/v1/ping', headers: { 'x-api-key': 'a' } });
    expect(projectA.headers['x-ratelimit-limit']).toBe('5');

    const projectB = await app.inject({ method: 'GET', url: '/v1/ping', headers: { 'x-api-key': 'b' } });
    expect(projectB.headers['x-ratelimit-limit']).toBe('2');
    // A separate budget: project A's request did not consume project B's.
    expect(projectB.headers['x-ratelimit-remaining']).toBe('1');

    await app.inject({ method: 'GET', url: '/v1/ping', headers: { 'x-api-key': 'b' } });
    const blocked = await app.inject({ method: 'GET', url: '/v1/ping', headers: { 'x-api-key': 'b' } });
    expect(blocked.statusCode).toBe(429);

    const stillOpen = await app.inject({ method: 'GET', url: '/v1/ping', headers: { 'x-api-key': 'a' } });
    expect(stillOpen.statusCode).toBe(200);
  });
});
