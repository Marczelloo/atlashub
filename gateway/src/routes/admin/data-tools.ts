import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { importExportService } from '../../services/import-export.js';
import { BadRequestError } from '../../lib/errors.js';

const exportTableSchema = z.object({
  projectId: z.string().uuid(),
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
  projectId: z.string().uuid(),
  tableName: z.string().min(1).max(255),
  format: z.enum(['csv', 'json']),
  data: z.string().min(1), // CSV or JSON string
  options: z
    .object({
      upsertColumn: z.string().optional(),
      skipFirstRow: z.boolean().optional(),
      columnMapping: z.record(z.string()).optional(),
    })
    .optional(),
});

const getUploadUrlSchema = z.object({
  projectId: z.string().uuid(),
  filename: z.string().min(1).max(255),
  contentType: z.string().max(100),
});

export const dataToolsRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // List import/export jobs for a project
  fastify.get<{ Querystring: { projectId: string } }>('/jobs', async (request, reply) => {
    const { projectId } = request.query;
    if (!projectId) {
      throw new BadRequestError('projectId is required');
    }
    const jobs = await importExportService.listJobs(projectId);
    return reply.send({ data: jobs });
  });

  // Export table data
  fastify.post('/export', async (request, reply) => {
    const parsed = exportTableSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new BadRequestError('Invalid request body', parsed.error.flatten().fieldErrors);
    }

    const result = await importExportService.exportTable(parsed.data, request.user?.id);

    // Set appropriate headers for file download
    const filename = `${parsed.data.tableName}_export.${parsed.data.format}`;
    reply.header('Content-Type', result.contentType);
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);

    return reply.send(result.data);
  });

  // Import table data
  fastify.post('/import', async (request, reply) => {
    const parsed = importTableSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new BadRequestError('Invalid request body', parsed.error.flatten().fieldErrors);
    }

    // Limit data size (2MB max for inline import)
    if (parsed.data.data.length > 2 * 1024 * 1024) {
      throw new BadRequestError('Data too large. Use file upload for imports over 2MB.');
    }

    const result = await importExportService.importTable(parsed.data, request.user?.id);
    return reply.send({ data: result });
  });

  // Get signed upload URL for importing larger files
  fastify.post('/upload-url', async (request, reply) => {
    const parsed = getUploadUrlSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new BadRequestError('Invalid request body', parsed.error.flatten().fieldErrors);
    }

    const result = await importExportService.getUploadUrl(
      parsed.data.projectId,
      parsed.data.filename,
      parsed.data.contentType
    );
    return reply.send({ data: result });
  });
};
