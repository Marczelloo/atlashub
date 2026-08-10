import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { storageService } from '../../services/storage.js';
import { NotFoundError, BadRequestError } from '../../lib/errors.js';
import { projectService } from '../../services/project.js';
import { createBucketSchema, signedUploadRequestSchema } from '@atlashub/shared';
import { auditService } from '../../services/audit.js';
import { bucketService } from '../../services/buckets.js';

export const adminStorageRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // List buckets in project
  fastify.get<{ Params: { id: string } }>('/projects/:id/buckets', async (request, reply) => {
    const project = await projectService.getProject(request.params.id);
    if (!project) {
      throw new NotFoundError('Project not found');
    }

    const buckets = await bucketService.listBuckets(request.params.id);
    return reply.send({
      data: buckets.map(({ id, name, createdAt }) => ({ id, name, createdAt })),
    });
  });

  // Create a logical bucket in the project. Physical MinIO buckets are managed per project.
  fastify.post<{ Params: { id: string } }>('/projects/:id/buckets', async (request, reply) => {
    const project = await projectService.getProject(request.params.id);
    if (!project) {
      throw new NotFoundError('Project not found');
    }

    const parseResult = createBucketSchema.safeParse(request.body);
    if (!parseResult.success) {
      throw new BadRequestError('Invalid request body', parseResult.error.flatten().fieldErrors);
    }

    const bucket = await bucketService.createBucket(request.params.id, parseResult.data.name);

    await auditService.log({
      action: auditService.actions.BUCKET_CREATED,
      projectId: request.params.id,
      details: { bucket: bucket.name },
    });

    return reply.status(201).send({
      data: {
        id: bucket.id,
        name: bucket.name,
        createdAt: bucket.createdAt,
      },
    });
  });

  // List files in a bucket
  fastify.get<{ Params: { id: string; bucketName: string }; Querystring: { prefix?: string } }>(
    '/projects/:id/buckets/:bucketName/files',
    async (request, reply) => {
      const project = await projectService.getProject(request.params.id);
      if (!project) {
        throw new NotFoundError('Project not found');
      }

      const result = await storageService.listObjects(
        request.params.id,
        request.params.bucketName,
        request.query.prefix,
        100
      );

      return reply.send({ data: result.objects });
    }
  );

  // Get signed upload URL (admin endpoint for dashboard)
  fastify.post<{ Params: { id: string } }>(
    '/projects/:id/signed-upload',
    async (request, reply) => {
      const project = await projectService.getProject(request.params.id);
      if (!project) {
        throw new NotFoundError('Project not found');
      }

      const parseResult = signedUploadRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        throw new BadRequestError('Invalid request body');
      }

      const { bucket, path, contentType, maxSize } = parseResult.data;

      const result = await storageService.getSignedUploadUrl(
        request.params.id,
        bucket,
        path,
        contentType,
        maxSize
      );

      // Log file upload
      await auditService.log({
        action: auditService.actions.FILE_UPLOADED,
        projectId: request.params.id,
        details: { bucket, path, contentType, size: maxSize },
      });

      return reply.send(result);
    }
  );

  // Get signed download URL (admin endpoint for dashboard)
  fastify.get<{
    Params: { id: string; bucketName: string };
    Querystring: { objectKey: string };
  }>('/projects/:id/buckets/:bucketName/signed-download', async (request, reply) => {
    const project = await projectService.getProject(request.params.id);
    if (!project) {
      throw new NotFoundError('Project not found');
    }

    const { objectKey } = request.query;
    if (!objectKey) {
      throw new BadRequestError('objectKey is required');
    }

    const result = await storageService.getSignedDownloadUrl(
      request.params.id,
      request.params.bucketName,
      objectKey
    );

    return reply.send(result);
  });

  // Delete file (admin endpoint for dashboard)
  fastify.delete<{
    Params: { id: string; bucketName: string };
    Querystring: { objectKey: string };
  }>('/projects/:id/buckets/:bucketName/files', async (request, reply) => {
    const project = await projectService.getProject(request.params.id);
    if (!project) {
      throw new NotFoundError('Project not found');
    }

    const { objectKey } = request.query;
    if (!objectKey) {
      throw new BadRequestError('objectKey is required');
    }

    await storageService.deleteObject(request.params.id, request.params.bucketName, objectKey);

    // Log file deletion
    await auditService.log({
      action: auditService.actions.FILE_DELETED,
      projectId: request.params.id,
      details: { bucket: request.params.bucketName, objectKey },
    });

    return reply.send({ success: true });
  });
};
