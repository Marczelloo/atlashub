import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const GB = 1024 ** 3;

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
    storage: {
      presignedUrlExpirySeconds: 60,
      maxUploadSizeBytes: 10 * 1024 * 1024,
      uploadLimits: '11111111-1111-4111-8111-111111111111/videos=50GB',
    },
  },
}));

const query = vi.fn();
vi.mock('../db/platform.js', () => ({
  platformDb: { query: (...args: unknown[]) => query(...args) },
}));

import { S3Client } from '@aws-sdk/client-s3';
import { storageService } from './storage.js';

let declaredSize = 0;
let s3Send: ReturnType<typeof vi.fn>;

beforeEach(() => {
  storageService.clearBucketCache();
  declaredSize = 20 * 1024 * 1024;
  query.mockReset().mockImplementation(async (sql: string) => {
    if (sql.includes('FROM buckets')) return { rows: [{ id: 'b1' }] };
    if (sql.includes('SELECT size FROM file_metadata')) return { rows: [{ size: String(declaredSize) }] };
    return { rows: [], rowCount: 1 };
  });
  s3Send = vi
    .spyOn(S3Client.prototype, 'send')
    .mockImplementation(async () => ({})) as unknown as ReturnType<typeof vi.fn>;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function commandNames(): string[] {
  return s3Send.mock.calls.map((call) => (call[0] as object).constructor.name);
}

describe('signed single upload', () => {
  it('requires the exact size, so the URL cannot accept a file of any size', async () => {
    await expect(
      storageService.getSignedUploadUrl(PROJECT, 'images', 'a.jpg', 'image/jpeg')
    ).rejects.toThrow('maxSize is required');
  });

  it('signs the size as Content-Length', async () => {
    const { uploadUrl } = await storageService.getSignedUploadUrl(PROJECT, 'images', 'a.jpg', 'image/jpeg', 1234);
    expect(new URL(uploadUrl).searchParams.get('X-Amz-SignedHeaders')).toContain('content-length');
  });

  it('uses the default limit for ordinary buckets', async () => {
    const error = await storageService
      .getSignedUploadUrl(PROJECT, 'images', 'big.jpg', 'image/jpeg', 11 * 1024 * 1024)
      .catch((e: { statusCode: number; message: string }) => e);
    expect(error).toMatchObject({ statusCode: 413 });
  });

  it('a bucket override allows large files, but single PUTs stop at 5 GiB', async () => {
    await expect(
      storageService.getSignedUploadUrl(PROJECT, 'videos', 'clip.mp4', 'video/mp4', 2 * GB)
    ).resolves.toBeDefined();

    const error = await storageService
      .getSignedUploadUrl(PROJECT, 'videos', 'film.mp4', 'video/mp4', 6 * GB)
      .catch((e: { statusCode: number; message: string }) => e);
    expect(error).toMatchObject({ statusCode: 413 });
    expect((error as { message: string }).message).toContain('multipart');
  });
});

describe('multipart upload', () => {
  it('lets a video bucket start a 40 GB upload and refuses it elsewhere', async () => {
    s3Send.mockResolvedValue({ UploadId: 'up-1' });
    await expect(
      storageService.initiateMultipartUpload(PROJECT, 'videos', 'film.mp4', 'video/mp4', 40 * GB)
    ).resolves.toMatchObject({ uploadId: 'up-1' });

    const error = await storageService
      .initiateMultipartUpload(PROJECT, 'images', 'film.mp4', 'video/mp4', 40 * GB)
      .catch((e: { statusCode: number }) => e);
    expect(error).toMatchObject({ statusCode: 413 });
  });

  it('completes when the uploaded parts fit the declared size', async () => {
    s3Send.mockImplementation(async (command: unknown) =>
      (command as object).constructor.name === 'ListPartsCommand'
        ? { Parts: [{ PartNumber: 1, Size: 5 * 1024 * 1024 }, { PartNumber: 2, Size: 3 * 1024 * 1024 }] }
        : {}
    );

    await storageService.completeMultipartUpload(PROJECT, 'videos', 'videos/film.mp4', 'up-1', [
      { partNumber: 1, etag: 'a' },
      { partNumber: 2, etag: 'b' },
    ]);

    expect(commandNames()).toEqual(['ListPartsCommand', 'CompleteMultipartUploadCommand']);
  });

  it('aborts when the parts are larger than declared at initiation', async () => {
    declaredSize = 6 * 1024 * 1024;
    // Two pages of parts, 5 MB each; then the abort.
    s3Send
      .mockImplementationOnce(async () => ({
        IsTruncated: true,
        NextPartNumberMarker: '1',
        Parts: [{ PartNumber: 1, Size: 5 * 1024 * 1024 }],
      }))
      .mockImplementationOnce(async () => ({
        IsTruncated: false,
        Parts: [{ PartNumber: 2, Size: 5 * 1024 * 1024 }],
      }));

    const error = await storageService
      .completeMultipartUpload(PROJECT, 'videos', 'videos/film.mp4', 'up-1', [
        { partNumber: 1, etag: 'a' },
        { partNumber: 2, etag: 'b' },
      ])
      .catch((e: { statusCode: number }) => e);

    expect(error).toMatchObject({ statusCode: 413 });
    expect(commandNames()).toEqual(['ListPartsCommand', 'ListPartsCommand', 'AbortMultipartUploadCommand']);
    expect(query.mock.calls.some((call) => String(call[0]).startsWith('DELETE FROM file_metadata'))).toBe(true);
  });

  it('ignores uploaded parts that are not part of the completed object', async () => {
    declaredSize = 6 * 1024 * 1024;
    s3Send.mockImplementation(async (command: unknown) =>
      (command as object).constructor.name === 'ListPartsCommand'
        ? { Parts: [{ PartNumber: 1, Size: 5 * 1024 * 1024 }, { PartNumber: 9, Size: 900 * 1024 * 1024 }] }
        : {}
    );

    await storageService.completeMultipartUpload(PROJECT, 'videos', 'videos/film.mp4', 'up-1', [
      { partNumber: 1, etag: 'a' },
    ]);
    expect(commandNames()).toContain('CompleteMultipartUploadCommand');
  });
});
