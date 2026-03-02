import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { webhookService, WEBHOOK_EVENTS, type WebhookEventType } from '../../services/webhook.js';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';

// Validation schemas
const createWebhookSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  url: z.string().url().max(2048),
  method: z.enum(['POST', 'PUT', 'PATCH']).optional(),
  secret: z.string().min(16).max(256),
  events: z.array(z.enum(WEBHOOK_EVENTS as [WebhookEventType, ...WebhookEventType[]])).min(1),
  tableFilter: z.array(z.string().max(255)).optional(),
  headers: z.record(z.string().max(256)).optional(),
  timeoutMs: z.number().int().min(1000).max(120000).optional(),
  enabled: z.boolean().optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
  retryBackoffMs: z.number().int().min(100).max(60000).optional(),
});

const updateWebhookSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  url: z.string().url().max(2048).optional(),
  method: z.enum(['POST', 'PUT', 'PATCH']).optional(),
  secret: z.string().min(16).max(256).optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS as [WebhookEventType, ...WebhookEventType[]])).min(1).optional(),
  tableFilter: z.array(z.string().max(255)).optional(),
  headers: z.record(z.string().max(256)).optional(),
  timeoutMs: z.number().int().min(1000).max(120000).optional(),
  enabled: z.boolean().optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
  retryBackoffMs: z.number().int().min(100).max(60000).optional(),
});

// Helper to mask sensitive webhook data
function maskWebhook(webhook: Awaited<ReturnType<typeof webhookService.getWebhook>>) {
  if (!webhook) return null;
  return {
    ...webhook,
    secretHash: undefined, // Never expose the secret hash
    hasSecret: true, // Indicate that a secret is configured
  };
}

export const webhookRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // List all webhooks for a project
  fastify.get('/', async (request, reply) => {
    const { projectId } = request.query as { projectId?: string };

    if (!projectId) {
      throw new BadRequestError('projectId query parameter is required');
    }

    const webhooks = await webhookService.listWebhooks(projectId);
    return reply.send({
      data: webhooks.map(maskWebhook),
    });
  });

  // Get single webhook
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const webhook = await webhookService.getWebhook(request.params.id);
    if (!webhook) {
      throw new NotFoundError('Webhook not found');
    }
    return reply.send({ data: maskWebhook(webhook) });
  });

  // Create webhook
  fastify.post('/', async (request, reply) => {
    const parsed = createWebhookSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new BadRequestError('Invalid request body', parsed.error.flatten().fieldErrors);
    }

    const webhook = await webhookService.createWebhook(parsed.data, request.user?.id);
    return reply.status(201).send({ data: maskWebhook(webhook) });
  });

  // Update webhook
  fastify.patch<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const parsed = updateWebhookSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new BadRequestError('Invalid request body', parsed.error.flatten().fieldErrors);
    }

    const webhook = await webhookService.updateWebhook(request.params.id, parsed.data, request.user?.id);
    return reply.send({ data: maskWebhook(webhook) });
  });

  // Delete webhook
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    await webhookService.deleteWebhook(request.params.id, request.user?.id);
    return reply.status(204).send();
  });

  // Toggle webhook enabled/disabled
  fastify.post<{ Params: { id: string }; Body: { enabled: boolean } }>(
    '/:id/toggle',
    async (request, reply) => {
      const { enabled } = request.body as { enabled?: boolean };
      if (typeof enabled !== 'boolean') {
        throw new BadRequestError('enabled must be a boolean');
      }

      const webhook = await webhookService.toggleWebhook(request.params.id, enabled, request.user?.id);
      return reply.send({ data: maskWebhook(webhook) });
    }
  );

  // List webhook deliveries
  fastify.get<{ Params: { id: string }; Querystring: { limit?: string; status?: string } }>(
    '/:id/deliveries',
    async (request, reply) => {
      const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;
      const { status } = request.query;

      // Validate status if provided
      if (status && !['pending', 'success', 'failed', 'retrying'].includes(status)) {
        throw new BadRequestError('Invalid status filter. Must be one of: pending, success, failed, retrying');
      }

      const deliveries = await webhookService.listDeliveries(request.params.id, { limit, status });
      return reply.send({ data: deliveries });
    }
  );

  // Get single delivery
  fastify.get<{ Params: { id: string; deliveryId: string } }>(
    '/:id/deliveries/:deliveryId',
    async (request, reply) => {
      const delivery = await webhookService.getDelivery(request.params.deliveryId);
      if (!delivery) {
        throw new NotFoundError('Delivery not found');
      }
      if (delivery.webhookId !== request.params.id) {
        throw new NotFoundError('Delivery not found for this webhook');
      }
      return reply.send({ data: delivery });
    }
  );

  // Redeliver a webhook
  fastify.post<{ Params: { id: string; deliveryId: string } }>(
    '/:id/deliveries/:deliveryId/redeliver',
    async (request, reply) => {
      const delivery = await webhookService.getDelivery(request.params.deliveryId);
      if (!delivery) {
        throw new NotFoundError('Delivery not found');
      }
      if (delivery.webhookId !== request.params.id) {
        throw new NotFoundError('Delivery not found for this webhook');
      }

      const success = await webhookService.redeliver(request.params.deliveryId);
      return reply.status(202).send({
        data: {
          message: success ? 'Webhook redelivery initiated' : 'Webhook redelivery failed',
          success,
        },
      });
    }
  );

  // Test a webhook (send a test payload)
  fastify.post<{ Params: { id: string }; Body: { payload?: Record<string, unknown> } }>(
    '/:id/test',
    async (request, reply) => {
      const webhook = await webhookService.getWebhook(request.params.id);
      if (!webhook) {
        throw new NotFoundError('Webhook not found');
      }

      const testPayload = request.body?.payload ?? {
        test: true,
        message: 'This is a test webhook delivery',
        timestamp: new Date().toISOString(),
      };

      // Create a delivery record for the test
      const deliveryId = await webhookService.createDelivery({
        webhookId: webhook.id,
        eventType: 'record.created',
        projectId: webhook.projectId,
        tableName: '_test_',
        payload: {
          event: 'record.created',
          project_id: webhook.projectId,
          table: '_test_',
          data: testPayload,
          timestamp: new Date().toISOString(),
          _test: true,
        },
      });

      // Attempt delivery
      const success = await webhookService.deliverWebhook(
        deliveryId,
        {
          id: webhook.id,
          url: webhook.url,
          method: webhook.method,
          secret_hash: webhook.secretHash,
          headers: webhook.headers,
          timeout_ms: webhook.timeoutMs,
          max_retries: 0, // No retries for test
          retry_backoff_ms: webhook.retryBackoffMs,
        },
        {
          eventType: 'record.created',
          projectId: webhook.projectId,
          tableName: '_test_',
          record: testPayload,
          timestamp: new Date(),
        }
      );

      // Get the delivery result
      const delivery = await webhookService.getDelivery(deliveryId);

      return reply.send({
        data: {
          success,
          deliveryId,
          httpStatus: delivery?.httpStatus,
          durationMs: delivery?.durationMs,
          errorMessage: delivery?.errorMessage,
        },
      });
    }
  );

  // Get available event types
  fastify.get('/events', async (_request: unknown, reply) => {
    return reply.send({
      data: {
        events: WEBHOOK_EVENTS.map((event) => ({
          type: event,
          description: getEventDescription(event),
        })),
      },
    });
  });
};

// Helper function for event descriptions
function getEventDescription(event: WebhookEventType): string {
  switch (event) {
    case 'record.created':
      return 'Triggered when a new record is inserted into a table';
    case 'record.updated':
      return 'Triggered when a record is updated in a table';
    case 'record.deleted':
      return 'Triggered when a record is deleted from a table';
    default:
      return 'Unknown event type';
  }
}
