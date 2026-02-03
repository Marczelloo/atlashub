import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { cronService } from '../../services/cron.js';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';

const createCronJobSchema = z.object({
  projectId: z.string().uuid().optional().nullable(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  jobType: z.enum(['http', 'platform']),
  scheduleCron: z.string().min(9).max(100), // Minimum valid cron: "* * * * *"
  timezone: z.string().max(50).optional(),
  httpUrl: z.string().url().max(2048).optional(),
  httpMethod: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
  httpHeaders: z.record(z.string()).optional(),
  httpBody: z.unknown().optional(),
  platformAction: z.string().max(50).optional(),
  platformConfig: z.record(z.unknown()).optional(),
  enabled: z.boolean().optional(),
  timeoutMs: z.number().int().min(1000).max(300000).optional(),
  retries: z.number().int().min(0).max(5).optional(),
  retryBackoffMs: z.number().int().min(100).max(60000).optional(),
});

const updateCronJobSchema = createCronJobSchema.partial().omit({ projectId: true, jobType: true });

export const cronRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // List all cron jobs
  fastify.get('/', async (request, reply) => {
    const { projectId } = request.query as { projectId?: string };
    const jobs = await cronService.listJobs(projectId === 'null' ? null : projectId);
    return reply.send({ data: jobs });
  });

  // Get single cron job
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const job = await cronService.getJob(request.params.id);
    if (!job) {
      throw new NotFoundError('Cron job not found');
    }
    return reply.send({ data: job });
  });

  // Create cron job
  fastify.post('/', async (request, reply) => {
    const parsed = createCronJobSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new BadRequestError('Invalid request body', parsed.error.flatten().fieldErrors);
    }

    const job = await cronService.createJob(parsed.data, request.user?.id);
    return reply.status(201).send({ data: job });
  });

  // Update cron job
  fastify.patch<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const parsed = updateCronJobSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new BadRequestError('Invalid request body', parsed.error.flatten().fieldErrors);
    }

    const job = await cronService.updateJob(request.params.id, parsed.data, request.user?.id);
    return reply.send({ data: job });
  });

  // Delete cron job
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    await cronService.deleteJob(request.params.id, request.user?.id);
    return reply.status(204).send();
  });

  // Toggle cron job enabled/disabled
  fastify.post<{ Params: { id: string }; Body: { enabled: boolean } }>(
    '/:id/toggle',
    async (request, reply) => {
      const { enabled } = request.body as { enabled?: boolean };
      if (typeof enabled !== 'boolean') {
        throw new BadRequestError('enabled must be a boolean');
      }

      const job = await cronService.toggleJob(request.params.id, enabled, request.user?.id);
      return reply.send({ data: job });
    }
  );

  // Trigger cron job manually
  fastify.post<{ Params: { id: string } }>('/:id/run', async (request, reply) => {
    const job = await cronService.getJob(request.params.id);
    if (!job) {
      throw new NotFoundError('Cron job not found');
    }

    // Create a run record
    const runId = await cronService.createRun(job.id);

    // Return immediately, job will run in background
    // In production, this would trigger the scheduler to pick up this job
    return reply.status(202).send({
      data: {
        message: 'Job triggered',
        runId,
      },
    });
  });

  // List job runs
  fastify.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/:id/runs',
    async (request, reply) => {
      const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;
      const runs = await cronService.listRuns(request.params.id, limit);
      return reply.send({ data: runs });
    }
  );
};
