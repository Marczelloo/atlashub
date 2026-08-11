import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import {
  createBucketSchema,
  multipartAbortRequestSchema,
  multipartCompleteRequestSchema,
  multipartInitiateRequestSchema,
  multipartPartRequestSchema,
  signedUploadRequestSchema,
  signedDownloadRequestSchema,
} from '@atlashub/shared';
import type { ProjectContext } from '@atlashub/shared';
import { storageService } from '../../services/storage.js';
import { BadRequestError, ForbiddenError } from '../../lib/errors.js';
import { bucketService } from '../../services/buckets.js';

declare module 'fastify' {
  interface FastifyRequest {
    projectContext: ProjectContext;
  }
}

export const storageRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // List logical buckets (secret key only)
  fastify.get('/buckets', async (request, reply) => {
    const { projectContext } = request;
    if (projectContext.keyType !== 'secret') {
      throw new ForbiddenError('Secret key required to list buckets');
    }

    return reply.send({ data: await bucketService.listBuckets(projectContext.projectId) });
  });

  // Create a logical bucket (secret key only)
  fastify.post('/buckets', async (request, reply) => {
    const { projectContext } = request;
    if (projectContext.keyType !== 'secret') {
      throw new ForbiddenError('Secret key required to create buckets');
    }

    const parseResult = createBucketSchema.safeParse(request.body);
    if (!parseResult.success) {
      throw new BadRequestError('Invalid request body', parseResult.error.flatten().fieldErrors);
    }

    const bucket = await bucketService.createBucket(
      projectContext.projectId,
      parseResult.data.name
    );
    return reply.status(201).send({ data: bucket });
  });

  // Get signed upload URL
  fastify.post('/signed-upload', async (request: FastifyRequest, reply) => {
    const parseResult = signedUploadRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      throw new BadRequestError('Invalid request body', parseResult.error.flatten().fieldErrors);
    }

    const { projectContext } = request;
    const { bucket, path, contentType, maxSize } = parseResult.data;

    const result = await storageService.getSignedUploadUrl(
      projectContext.projectId,
      bucket,
      path,
      contentType,
      maxSize
    );

    return reply.send({ data: result });
  });

  // Multipart upload initiation. Parts are uploaded directly to MinIO using
  // short-lived URLs so large files can pass through Cloudflare in chunks.
  fastify.post('/multipart/initiate', async (request: FastifyRequest, reply) => {
    const parseResult = multipartInitiateRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      throw new BadRequestError('Invalid request body', parseResult.error.flatten().fieldErrors);
    }

    const { projectContext } = request;
    const { bucket, path, contentType, size } = parseResult.data;
    const result = await storageService.initiateMultipartUpload(
      projectContext.projectId,
      bucket,
      path,
      contentType,
      size
    );

    return reply.status(201).send({ data: result });
  });

  // Get a signed URL for one multipart part.
  fastify.post('/multipart/part', async (request: FastifyRequest, reply) => {
    const parseResult = multipartPartRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      throw new BadRequestError('Invalid request body', parseResult.error.flatten().fieldErrors);
    }

    const { projectContext } = request;
    const { bucket, objectKey, uploadId, partNumber } = parseResult.data;
    const result = await storageService.getSignedMultipartPartUrl(
      projectContext.projectId,
      bucket,
      objectKey,
      uploadId,
      partNumber
    );

    return reply.send({ data: result });
  });

  // Complete a multipart upload after all parts have returned their ETags.
  fastify.post('/multipart/complete', async (request: FastifyRequest, reply) => {
    const parseResult = multipartCompleteRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      throw new BadRequestError('Invalid request body', parseResult.error.flatten().fieldErrors);
    }

    const { projectContext } = request;
    const { bucket, objectKey, uploadId, parts } = parseResult.data;
    const result = await storageService.completeMultipartUpload(
      projectContext.projectId,
      bucket,
      objectKey,
      uploadId,
      parts
    );

    return reply.send({ data: result });
  });

  // Abort abandoned multipart uploads and remove their metadata.
  fastify.post('/multipart/abort', async (request: FastifyRequest, reply) => {
    const parseResult = multipartAbortRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      throw new BadRequestError('Invalid request body', parseResult.error.flatten().fieldErrors);
    }

    const { projectContext } = request;
    const { bucket, objectKey, uploadId } = parseResult.data;
    await storageService.abortMultipartUpload(
      projectContext.projectId,
      bucket,
      objectKey,
      uploadId
    );

    return reply.status(204).send();
  });

  // Get signed download URL
  fastify.get<{ Querystring: { bucket: string; objectKey: string } }>(
    '/signed-download',
    async (request, reply) => {
      const parseResult = signedDownloadRequestSchema.safeParse({
        bucket: request.query.bucket,
        objectKey: request.query.objectKey,
      });
      if (!parseResult.success) {
        throw new BadRequestError(
          'Invalid query parameters',
          parseResult.error.flatten().fieldErrors
        );
      }

      const { projectContext } = request;
      const { bucket, objectKey } = parseResult.data;

      const result = await storageService.getSignedDownloadUrl(
        projectContext.projectId,
        bucket,
        objectKey
      );

      return reply.send({ data: result });
    }
  );

  // List objects (secret key only)
  fastify.get<{ Querystring: { bucket: string; prefix?: string; limit?: string } }>(
    '/list',
    async (request, reply) => {
      const { projectContext } = request;

      if (projectContext.keyType !== 'secret') {
        throw new ForbiddenError('Secret key required to list objects');
      }

      const { bucket, prefix, limit } = request.query;
      if (!bucket) {
        throw new BadRequestError('bucket query parameter is required');
      }

      const result = await storageService.listObjects(
        projectContext.projectId,
        bucket,
        prefix,
        limit ? parseInt(limit, 10) : undefined
      );

      return reply.send({ data: result });
    }
  );

  // Delete object
  fastify.delete<{ Querystring: { bucket: string; objectKey: string } }>(
    '/object',
    async (request, reply) => {
      const { projectContext } = request;
      const { bucket, objectKey } = request.query;

      if (!bucket || !objectKey) {
        throw new BadRequestError('bucket and objectKey query parameters are required');
      }

      await storageService.deleteObject(projectContext.projectId, bucket, objectKey);
      return reply.status(204).send();
    }
  );
};
