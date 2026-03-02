import {
  S3Client,
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { config } from '../config/env.js';
import { platformDb } from '../db/platform.js';
import { NotFoundError, BadRequestError } from '../lib/errors.js';

// Path traversal prevention - validates object keys don't escape bucket scope
function validateObjectKey(key: string): void {
  // Normalize the path to prevent encoding bypasses
  const normalized = key.normalize('NFC');

  // Block path traversal patterns
  const dangerousPatterns = [
    '..',
    '\x00', // null byte
    '//',   // double slashes that could normalize
  ];

  for (const pattern of dangerousPatterns) {
    if (normalized.includes(pattern)) {
      throw new BadRequestError('Invalid object key: path traversal detected');
    }
  }

  // Block absolute paths
  if (normalized.startsWith('/') || normalized.startsWith('\\')) {
    throw new BadRequestError('Invalid object key: absolute paths not allowed');
  }

  // Block Windows drive letters
  if (/^[a-zA-Z]:/.test(normalized)) {
    throw new BadRequestError('Invalid object key: drive letters not allowed');
  }
}

const s3Client = new S3Client({
  endpoint: `http${config.minio.useSSL ? 's' : ''}://${config.minio.endpoint}:${config.minio.port}`,
  region: config.minio.region,
  credentials: {
    accessKeyId: config.minio.accessKey,
    secretAccessKey: config.minio.secretKey,
  },
  forcePathStyle: true, // Required for MinIO
});

function getPhysicalBucketName(projectId: string): string {
  return `proj-${projectId}`;
}

export const storageService = {
  async createProjectBucket(projectId: string): Promise<void> {
    const bucketName = getPhysicalBucketName(projectId);
    await s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));
  },

  async deleteProjectBucket(projectId: string): Promise<void> {
    const bucketName = getPhysicalBucketName(projectId);

    // First, delete all objects in the bucket
    let continuationToken: string | undefined;
    do {
      const listResult = await s3Client.send(
        new ListObjectsV2Command({
          Bucket: bucketName,
          ContinuationToken: continuationToken,
        })
      );

      if (listResult.Contents) {
        for (const obj of listResult.Contents) {
          if (obj.Key) {
            await s3Client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: obj.Key }));
          }
        }
      }

      continuationToken = listResult.NextContinuationToken;
    } while (continuationToken);

    // Then delete the bucket
    await s3Client.send(new DeleteBucketCommand({ Bucket: bucketName }));
  },

  async getSignedUploadUrl(
    projectId: string,
    logicalBucket: string,
    path: string,
    contentType: string,
    maxSize?: number
  ): Promise<{ objectKey: string; uploadUrl: string; expiresIn: number }> {
    // Verify logical bucket exists
    const bucketResult = await platformDb.query<{ id: string }>(
      'SELECT id FROM buckets WHERE project_id = $1 AND name = $2',
      [projectId, logicalBucket]
    );

    if (bucketResult.rows.length === 0) {
      throw new NotFoundError(`Bucket "${logicalBucket}" not found`);
    }

    if (maxSize && maxSize > config.storage.maxUploadSizeBytes) {
      throw new BadRequestError(`maxSize cannot exceed ${config.storage.maxUploadSizeBytes} bytes`);
    }

    // Validate path to prevent path traversal
    validateObjectKey(path);

    const physicalBucket = getPhysicalBucketName(projectId);
    const objectKey = `${logicalBucket}/${path}`;
    const expiresIn = config.storage.presignedUrlExpirySeconds;

    const command = new PutObjectCommand({
      Bucket: physicalBucket,
      Key: objectKey,
      ContentType: contentType,
      ...(maxSize && { ContentLength: maxSize }),
    });

    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn });

    // Store metadata
    await platformDb.query(
      `INSERT INTO file_metadata (id, project_id, bucket, object_key, content_type, size)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (project_id, object_key) DO UPDATE SET
         content_type = EXCLUDED.content_type,
         size = EXCLUDED.size,
         created_at = NOW()`,
      [randomUUID(), projectId, logicalBucket, objectKey, contentType, maxSize || 0]
    );

    return { objectKey, uploadUrl, expiresIn };
  },

  async getSignedDownloadUrl(
    projectId: string,
    logicalBucket: string,
    objectKey: string
  ): Promise<{ downloadUrl: string; expiresIn: number }> {
    const physicalBucket = getPhysicalBucketName(projectId);
    const expiresIn = config.storage.presignedUrlExpirySeconds;

    // Validate object key to prevent path traversal
    validateObjectKey(objectKey);

    // Ensure the object key starts with the logical bucket prefix
    const fullKey = objectKey.startsWith(`${logicalBucket}/`)
      ? objectKey
      : `${logicalBucket}/${objectKey}`;

    const command = new GetObjectCommand({
      Bucket: physicalBucket,
      Key: fullKey,
    });

    const downloadUrl = await getSignedUrl(s3Client, command, { expiresIn });

    return { downloadUrl, expiresIn };
  },

  async listObjects(
    projectId: string,
    logicalBucket: string,
    prefix?: string,
    limit = 100
  ): Promise<{ objects: Array<{ key: string; size: number; lastModified: Date }> }> {
    const physicalBucket = getPhysicalBucketName(projectId);

    // Validate prefix to prevent path traversal
    if (prefix) {
      validateObjectKey(prefix);
    }

    const fullPrefix = prefix ? `${logicalBucket}/${prefix}` : `${logicalBucket}/`;

    const result = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: physicalBucket,
        Prefix: fullPrefix,
        MaxKeys: Math.min(limit, 1000),
      })
    );

    const objects = (result.Contents || []).map((obj) => ({
      key: obj.Key || '',
      size: obj.Size || 0,
      lastModified: obj.LastModified || new Date(),
    }));

    return { objects };
  },

  async deleteObject(projectId: string, logicalBucket: string, objectKey: string): Promise<void> {
    const physicalBucket = getPhysicalBucketName(projectId);

    // Validate object key to prevent path traversal
    validateObjectKey(objectKey);

    const fullKey = objectKey.startsWith(`${logicalBucket}/`)
      ? objectKey
      : `${logicalBucket}/${objectKey}`;

    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: physicalBucket,
        Key: fullKey,
      })
    );

    // Remove metadata
    await platformDb.query('DELETE FROM file_metadata WHERE project_id = $1 AND object_key = $2', [
      projectId,
      fullKey,
    ]);
  },
};
