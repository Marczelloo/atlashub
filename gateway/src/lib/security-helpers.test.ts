import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { devAdminTokenProblem, isValidDevAdminToken } from './dev-admin-token.js';
import { parseTrustProxy } from './trust-proxy.js';
import {
  MAX_OBJECT_BYTES,
  parseByteSize,
  parseUploadLimitOverrides,
  resolveUploadLimit,
} from './upload-limits.js';

const STRONG = 'x'.repeat(40);
const PROJECT = '11111111-1111-4111-8111-111111111111';

describe('dev admin token', () => {
  it('works only in development with a long, non-example token', () => {
    expect(isValidDevAdminToken(STRONG, { isDev: true, token: STRONG })).toBe(true);
    expect(isValidDevAdminToken(STRONG, { isDev: false, token: STRONG })).toBe(false);
    expect(isValidDevAdminToken('wrong', { isDev: true, token: STRONG })).toBe(false);
    expect(isValidDevAdminToken(undefined, { isDev: true, token: STRONG })).toBe(false);
  });

  it('rejects the example token from .env.example even when it matches', () => {
    const settings = { isDev: true, token: 'your-secure-dev-token' };
    expect(isValidDevAdminToken('your-secure-dev-token', settings)).toBe(false);
    expect(devAdminTokenProblem(settings)).toMatch(/example/);
  });

  it('rejects short tokens', () => {
    const settings = { isDev: true, token: 'short-but-set' };
    expect(isValidDevAdminToken('short-but-set', settings)).toBe(false);
    expect(devAdminTokenProblem(settings)).toMatch(/shorter/);
  });
});

describe('trust proxy', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    await app?.close();
    app = null;
  });

  it('parses booleans, hop counts and address lists', () => {
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('loopback, 10.0.0.0/8')).toBe('loopback, 10.0.0.0/8');

    const oneHop = parseTrustProxy('1');
    expect(typeof oneHop).toBe('function');
    expect((oneHop as (address: string, hop: number) => boolean)('10.0.0.1', 0)).toBe(true);
    expect((oneHop as (address: string, hop: number) => boolean)('6.6.6.6', 1)).toBe(false);
  });

  async function clientIp(remoteAddress: string, forwardedFor: string): Promise<string> {
    const instance = Fastify({ trustProxy: 'loopback,linklocal,uniquelocal' });
    app = instance;
    instance.get('/ip', async (request) => ({ ip: request.ip }));
    const res = await instance.inject({
      method: 'GET',
      url: '/ip',
      remoteAddress,
      headers: { 'x-forwarded-for': forwardedFor },
    });
    const ip = res.json().ip as string;
    await instance.close();
    app = null;
    return ip;
  }

  it('behind a private proxy takes the address the proxy appended, not the client-supplied one', async () => {
    // Cloudflare appends the real client address to whatever the client sent.
    expect(await clientIp('172.18.0.5', '6.6.6.6, 203.0.113.7')).toBe('203.0.113.7');
  });

  it('ignores X-Forwarded-For from a client connecting directly', async () => {
    expect(await clientIp('198.51.100.20', '6.6.6.6')).toBe('198.51.100.20');
  });
});

describe('upload limits', () => {
  it('parses sizes with units', () => {
    expect(parseByteSize('1048576')).toBe(1048576);
    expect(parseByteSize('500MB')).toBe(500 * 1024 ** 2);
    expect(parseByteSize('5 GB')).toBe(5 * 1024 ** 3);
    expect(parseByteSize('1.5gb')).toBe(1.5 * 1024 ** 3);
    expect(parseByteSize('2T')).toBe(2 * 1024 ** 4);
    expect(parseByteSize(1024)).toBe(1024);
    expect(parseByteSize('0')).toBeNull();
    expect(parseByteSize('abc')).toBeNull();
    expect(parseByteSize('5XB')).toBeNull();
  });

  it('bucket overrides win over project overrides, which win over the default', () => {
    const overrides = parseUploadLimitOverrides(`${PROJECT}=5GB, ${PROJECT}/videos=50GB`);
    expect(overrides.invalid).toEqual([]);

    expect(resolveUploadLimit(overrides, 100, PROJECT, 'videos')).toBe(50 * 1024 ** 3);
    expect(resolveUploadLimit(overrides, 100, PROJECT, 'images')).toBe(5 * 1024 ** 3);
    expect(resolveUploadLimit(overrides, 100, '22222222-2222-4222-8222-222222222222', 'videos')).toBe(100);
  });

  it('skips invalid entries instead of failing', () => {
    const overrides = parseUploadLimitOverrides(
      `not-a-project=1GB,${PROJECT}/Bad_Bucket=1GB,${PROJECT}=lots,${PROJECT}/a/b=1GB,${PROJECT}=6TB,${PROJECT}=2GB`
    );
    expect(overrides.invalid).toHaveLength(5);
    expect(resolveUploadLimit(overrides, 1, PROJECT, 'x')).toBe(2 * 1024 ** 3);
    expect(6 * 1024 ** 4).toBeGreaterThan(MAX_OBJECT_BYTES);
  });
});
