import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config/env.js', () => ({
  config: {
    isProduction: false,
    minio: {
      endpoint: 'localhost',
      port: 9000,
      useSSL: false,
      accessKey: 'test',
      secretKey: 'test-secret',
      region: 'us-east-1',
      publicUrl: undefined,
    },
    storage: { presignedUrlExpirySeconds: 60, maxUploadSizeBytes: 10_000_000 },
  },
}));

const query = vi.fn();
vi.mock('../db/platform.js', () => ({
  platformDb: { query: (...args: unknown[]) => query(...args) },
}));

import { storageService, BUCKET_CACHE_TTL_MS } from './storage.js';

function bucketLookups(): number {
  return query.mock.calls.filter((call) => String(call[0]).includes('FROM buckets')).length;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-14T10:00:00Z'));
  query.mockReset().mockResolvedValue({ rows: [{ id: 'b1' }] });
  storageService.clearBucketCache();
});

afterEach(() => vi.useRealTimers());

describe('signed upload bucket check', () => {
  it('checks a bucket once for a series of uploads', async () => {
    for (let i = 0; i < 15; i++) {
      const result = await storageService.getSignedUploadUrl('p1', 'wardrobe', `users/u1/${i}.jpg`, 'image/jpeg', 100);
      expect(result.objectKey).toBe(`wardrobe/users/u1/${i}.jpg`);
    }
    expect(bucketLookups()).toBe(1);
  });

  it('does not cache a missing bucket, so a new one works at once', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(
      storageService.getSignedUploadUrl('p1', 'fresh', 'a.jpg', 'image/jpeg', 100)
    ).rejects.toThrow('Bucket "fresh" not found');

    await expect(
      storageService.getSignedUploadUrl('p1', 'fresh', 'a.jpg', 'image/jpeg', 100)
    ).resolves.toBeDefined();
  });

  it('keeps projects apart and clears per project', async () => {
    await storageService.getSignedUploadUrl('p1', 'wardrobe', 'a.jpg', 'image/jpeg', 100);
    await storageService.getSignedUploadUrl('p2', 'wardrobe', 'a.jpg', 'image/jpeg', 100);
    expect(bucketLookups()).toBe(2);

    storageService.clearBucketCache('p1');
    await storageService.getSignedUploadUrl('p1', 'wardrobe', 'b.jpg', 'image/jpeg', 100);
    await storageService.getSignedUploadUrl('p2', 'wardrobe', 'b.jpg', 'image/jpeg', 100);
    expect(bucketLookups()).toBe(3);
  });

  it('checks again after the TTL', async () => {
    await storageService.getSignedUploadUrl('p1', 'wardrobe', 'a.jpg', 'image/jpeg', 100);
    vi.setSystemTime(Date.now() + BUCKET_CACHE_TTL_MS + 1);
    await storageService.getSignedUploadUrl('p1', 'wardrobe', 'a.jpg', 'image/jpeg', 100);
    expect(bucketLookups()).toBe(2);
  });
});
