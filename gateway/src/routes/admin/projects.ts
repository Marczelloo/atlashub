import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { createProjectSchema } from '@atlashub/shared';
import { projectService } from '../../services/project.js';
import { apiKeyService } from '../../services/api-key.js';
import { importExportService } from '../../services/import-export.js';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';

const exportTableSchema = z.object({
  tableName: z.string().min(1).max(255),
  format: z.enum(['csv', 'json']),
  options: z
    .object({
      limit: z.number().int().min(1).max(100000).optional(),
      columns: z.array(z.string()).optional(),
    })
    .optional(),
});

const importTableSchema = z.object({
  tableName: z.string().min(1).max(255),
  format: z.enum(['csv', 'json']),
  data: z.string().min(1),
  options: z
    .object({
      upsertColumn: z.string().optional(),
      skipFirstRow: z.boolean().optional(),
      columnMapping: z.record(z.string()).optional(),
    })
    .optional(),
});

const getUploadUrlSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().max(100),
});

export const projectRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // List all projects
  fastify.get('/', async (_request, reply) => {
    const projects = await projectService.listProjects();
    return reply.send({ data: projects });
  });

  // Get single project
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const project = await projectService.getProject(request.params.id);
    if (!project) {
      throw new NotFoundError('Project not found');
    }
    return reply.send({ data: project });
  });

  // Create project
  fastify.post('/', async (request, reply) => {
    const parseResult = createProjectSchema.safeParse(request.body);
    if (!parseResult.success) {
      throw new BadRequestError('Invalid request body', parseResult.error.flatten().fieldErrors);
    }

    const result = await projectService.createProject(parseResult.data);
    return reply.status(201).send({ data: result });
  });

  // Delete project
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    await projectService.deleteProject(request.params.id);
    return reply.status(204).send();
  });

  // Get project API keys (without the actual key values)
  fastify.get<{ Params: { id: string } }>('/:id/keys', async (request, reply) => {
    const keys = await apiKeyService.listProjectKeys(request.params.id);
    return reply.send({ data: keys });
  });

  // Rotate API key
  fastify.post<{ Params: { id: string }; Body: { keyType: 'publishable' | 'secret' } }>(
    '/:id/keys/rotate',
    async (request, reply) => {
      const { keyType } = request.body as { keyType?: string };
      if (!keyType || (keyType !== 'publishable' && keyType !== 'secret')) {
        throw new BadRequestError('keyType must be "publishable" or "secret"');
      }

      const result = await apiKeyService.rotateKey(request.params.id, keyType);
      return reply.send({ data: result });
    }
  );

  // Revoke API key
  fastify.delete<{ Params: { id: string; keyId: string } }>(
    '/:id/keys/:keyId',
    async (request, reply) => {
      await apiKeyService.revokeKey(request.params.keyId);
      return reply.status(204).send();
    }
  );

  // ============================================================
  // Data Tools (Import/Export) - Per Project
  // ============================================================

  // List import/export jobs for this project
  fastify.get<{ Params: { id: string } }>('/:id/data-tools/jobs', async (request, reply) => {
    const jobs = await importExportService.listJobs(request.params.id);
    return reply.send({ data: jobs });
  });

  // Export table data
  fastify.post<{ Params: { id: string } }>('/:id/data-tools/export', async (request, reply) => {
    const parsed = exportTableSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new BadRequestError('Invalid request body', parsed.error.flatten().fieldErrors);
    }

    const result = await importExportService.exportTable(
      { ...parsed.data, projectId: request.params.id },
      request.user?.id
    );

    const filename = `${parsed.data.tableName}_export.${parsed.data.format}`;
    reply.header('Content-Type', result.contentType);
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    return reply.send(result.data);
  });

  // Import table data
  fastify.post<{ Params: { id: string } }>('/:id/data-tools/import', async (request, reply) => {
    const parsed = importTableSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new BadRequestError('Invalid request body', parsed.error.flatten().fieldErrors);
    }

    if (parsed.data.data.length > 2 * 1024 * 1024) {
      throw new BadRequestError('Data too large. Use file upload for imports over 2MB.');
    }

    const result = await importExportService.importTable(
      { ...parsed.data, projectId: request.params.id },
      request.user?.id
    );
    return reply.send({ data: result });
  });

  // Get signed upload URL for importing larger files
  fastify.post<{ Params: { id: string } }>('/:id/data-tools/upload-url', async (request, reply) => {
    const parsed = getUploadUrlSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new BadRequestError('Invalid request body', parsed.error.flatten().fieldErrors);
    }

    const result = await importExportService.getUploadUrl(
      request.params.id,
      parsed.data.filename,
      parsed.data.contentType
    );
    return reply.send({ data: result });
  });
};
