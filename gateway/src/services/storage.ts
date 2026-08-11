import {
  AbortMultipartUploadCommand,
  S3Client,
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  GetObjectCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { config } from '../config/env.js';
import { platformDb } from '../db/platform.js';
import { NotFoundError, BadRequestError } from '../lib/errors.js';

// S3 allows max 1000 objects per DeleteObjects request
const S3_BATCH_DELETE_SIZE = 1000;
const S3_MAX_PARTS = 10000;

/**
 * Replace internal MinIO endpoint with public URL for presigned URLs.
 * This allows external apps to access MinIO from outside Docker network.
 */
function getPublicUrl(internalUrl: string): string {
  if (!config.minio.publicUrl) {
    return internalUrl; // Fallback to internal URL if no public URL configured
  }

  const internalEndpoint = `http${config.minio.useSSL ? 's' : ''}://${config.minio.endpoint}:${config.minio.port}`;
  return internalUrl.replace(internalEndpoint, config.minio.publicUrl);
}

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

async function assertLogicalBucket(projectId: string, logicalBucket: string): Promise<void> {
  const bucketResult = await platformDb.query<{ id: string }>(
    'SELECT id FROM buckets WHERE project_id = $1 AND name = $2',
    [projectId, logicalBucket]
  );

  if (bucketResult.rows.length === 0) {
    throw new NotFoundError(`Bucket "${logicalBucket}" not found`);
  }
}

function validateMultipartObjectKey(logicalBucket: string, objectKey: string): string {
  const prefix = `${logicalBucket}/`;
  if (!objectKey.startsWith(prefix)) {
    throw new BadRequestError('Invalid multipart object key');
  }

  const path = objectKey.slice(prefix.length);
  validateObjectKey(path);
  return objectKey;
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

/**
 * Delete all objects in a bucket using batch operations.
 * This is much more efficient than deleting objects one by one.
 */
async function deleteAllObjectsInBucket(bucketName: string): Promise<void> {
  let continuationToken: string | undefined;
  let totalDeleted = 0;

  do {
    // List objects in the bucket
    const listResult = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        ContinuationToken: continuationToken,
        MaxKeys: S3_BATCH_DELETE_SIZE,
      })
    );

    if (!listResult.Contents || listResult.Contents.length === 0) {
      break;
    }

    // Collect all object keys
    const objectsToDelete = listResult.Contents
      .filter((obj) => obj.Key)
      .map((obj) => ({ Key: obj.Key! }));

    if (objectsToDelete.length > 0) {
      // Batch delete up to 1000 objects at a time
      const deleteResult = await s3Client.send(
        new DeleteObjectsCommand({
          Bucket: bucketName,
          Delete: {
            Objects: objectsToDelete,
            Quiet: false, // Get deleted objects info for logging
          },
        })
      );

      const deletedCount = deleteResult.Deleted?.length || 0;
      totalDeleted += deletedCount;

      // Log any errors from the batch delete
      if (deleteResult.Errors && deleteResult.Errors.length > 0) {
        for (const error of deleteResult.Errors) {
          console.error(`Failed to delete object ${error.Key}: ${error.Message}`);
        }
      }
    }

    continuationToken = listResult.NextContinuationToken;
  } while (continuationToken);

  console.log(`Deleted ${totalDeleted} objects from bucket ${bucketName}`);
}

export const storageService = {
  async createProjectBucket(projectId: string): Promise<void> {
    const bucketName = getPhysicalBucketName(projectId);
    await s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));
  },

  async deleteProjectBucket(projectId: string): Promise<void> {
    const bucketName = getPhysicalBucketName(projectId);

    // First, delete all objects in the bucket using batch operations
    await deleteAllObjectsInBucket(bucketName);

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
    await assertLogicalBucket(projectId, logicalBucket);

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

    return { objectKey, uploadUrl: getPublicUrl(uploadUrl), expiresIn };
  },

  async initiateMultipartUpload(
    projectId: string,
    logicalBucket: string,
    path: string,
    contentType: string,
    size: number
  ): Promise<{ objectKey: string; uploadId: string; expiresIn: number }> {
    await assertLogicalBucket(projectId, logicalBucket);

    if (size > config.storage.maxUploadSizeBytes) {
      throw new BadRequestError(`size cannot exceed ${config.storage.maxUploadSizeBytes} bytes`);
    }

    validateObjectKey(path);

    const physicalBucket = getPhysicalBucketName(projectId);
    const objectKey = `${logicalBucket}/${path}`;
    const result = await s3Client.send(
      new CreateMultipartUploadCommand({
        Bucket: physicalBucket,
        Key: objectKey,
        ContentType: contentType,
      })
    );

    if (!result.UploadId) {
      throw new BadRequestError('Storage did not return a multipart upload id');
    }

    await platformDb.query(
      `INSERT INTO file_metadata (id, project_id, bucket, object_key, content_type, size)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (project_id, object_key) DO UPDATE SET
         content_type = EXCLUDED.content_type,
         size = EXCLUDED.size,
         created_at = NOW()`,
      [randomUUID(), projectId, logicalBucket, objectKey, contentType, size]
    );

    return {
      objectKey,
      uploadId: result.UploadId,
      expiresIn: config.storage.presignedUrlExpirySeconds,
    };
  },

  async getSignedMultipartPartUrl(
    projectId: string,
    logicalBucket: string,
    objectKey: string,
    uploadId: string,
    partNumber: number
  ): Promise<{ uploadUrl: string; partNumber: number; expiresIn: number }> {
    await assertLogicalBucket(projectId, logicalBucket);

    if (partNumber < 1 || partNumber > S3_MAX_PARTS) {
      throw new BadRequestError(`partNumber must be between 1 and ${S3_MAX_PARTS}`);
    }

    const validatedObjectKey = validateMultipartObjectKey(logicalBucket, objectKey);
    const command = new UploadPartCommand({
      Bucket: getPhysicalBucketName(projectId),
      Key: validatedObjectKey,
      UploadId: uploadId,
      PartNumber: partNumber,
    });
    const uploadUrl = await getSignedUrl(s3Client, command, {
      expiresIn: config.storage.presignedUrlExpirySeconds,
    });

    return {
      uploadUrl: getPublicUrl(uploadUrl),
      partNumber,
      expiresIn: config.storage.presignedUrlExpirySeconds,
    };
  },

  async completeMultipartUpload(
    projectId: string,
    logicalBucket: string,
    objectKey: string,
    uploadId: string,
    parts: Array<{ partNumber: number; etag: string }>
  ): Promise<{ objectKey: string }> {
    await assertLogicalBucket(projectId, logicalBucket);

    if (parts.length === 0 || parts.length > S3_MAX_PARTS) {
      throw new BadRequestError(`parts must contain between 1 and ${S3_MAX_PARTS} entries`);
    }

    const validatedObjectKey = validateMultipartObjectKey(logicalBucket, objectKey);
    const sortedParts = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    if (sortedParts.some((part, index) => part.partNumber !== index + 1 || !part.etag.trim())) {
      throw new BadRequestError('Multipart parts must be sequential and include ETags');
    }

    await s3Client.send(
      new CompleteMultipartUploadCommand({
        Bucket: getPhysicalBucketName(projectId),
        Key: validatedObjectKey,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: sortedParts.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
        },
      })
    );

    return { objectKey: validatedObjectKey };
  },

  async abortMultipartUpload(
    projectId: string,
    logicalBucket: string,
    objectKey: string,
    uploadId: string
  ): Promise<void> {
    await assertLogicalBucket(projectId, logicalBucket);
    const validatedObjectKey = validateMultipartObjectKey(logicalBucket, objectKey);

    await s3Client.send(
      new AbortMultipartUploadCommand({
        Bucket: getPhysicalBucketName(projectId),
        Key: validatedObjectKey,
        UploadId: uploadId,
      })
    );

    await platformDb.query('DELETE FROM file_metadata WHERE project_id = $1 AND object_key = $2', [
      projectId,
      validatedObjectKey,
    ]);
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

    return { downloadUrl: getPublicUrl(downloadUrl), expiresIn };
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

  /**
   * Delete multiple objects in a single batch operation.
   * More efficient than calling deleteObject multiple times.
   */
  async deleteObjects(
    projectId: string,
    logicalBucket: string,
    objectKeys: string[]
  ): Promise<{ deleted: number; errors: Array<{ key: string; message: string }> }> {
    if (objectKeys.length === 0) {
      return { deleted: 0, errors: [] };
    }

    const physicalBucket = getPhysicalBucketName(projectId);

    // Validate all object keys
    for (const key of objectKeys) {
      validateObjectKey(key);
    }

    // Prepare keys with bucket prefix
    const keysWithPrefix = objectKeys.map((key) =>
      key.startsWith(`${logicalBucket}/`) ? key : `${logicalBucket}/${key}`
    );

    // S3 DeleteObjects supports up to 1000 objects per request
    const batchSize = S3_BATCH_DELETE_SIZE;
    let totalDeleted = 0;
    const allErrors: Array<{ key: string; message: string }> = [];

    for (let i = 0; i < keysWithPrefix.length; i += batchSize) {
      const batch = keysWithPrefix.slice(i, i + batchSize);

      const deleteResult = await s3Client.send(
        new DeleteObjectsCommand({
          Bucket: physicalBucket,
          Delete: {
            Objects: batch.map((Key) => ({ Key })),
            Quiet: false,
          },
        })
      );

      totalDeleted += deleteResult.Deleted?.length || 0;

      if (deleteResult.Errors) {
        for (const error of deleteResult.Errors) {
          allErrors.push({
            key: error.Key || 'unknown',
            message: error.Message || 'Unknown error',
          });
        }
      }
    }

    // Delete metadata for all objects in batch
    if (keysWithPrefix.length > 0) {
      const placeholders = keysWithPrefix.map((_, idx) => `$${idx + 2}`).join(', ');
      await platformDb.query(
        `DELETE FROM file_metadata WHERE project_id = $1 AND object_key IN (${placeholders})`,
        [projectId, ...keysWithPrefix]
      );
    }

    return { deleted: totalDeleted, errors: allErrors };
  },
};
