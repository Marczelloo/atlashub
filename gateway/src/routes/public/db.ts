import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { tableNameSchema, insertBodySchema, updateBodySchema } from '@atlashub/shared';
import type { ProjectContext } from '@atlashub/shared';
import { z } from 'zod';
import { crudService } from '../../services/crud.js';
import { webhookService } from '../../services/webhook.js';
import { AppError, BadRequestError, ForbiddenError } from '../../lib/errors.js';
import { parseFilters, parseOrder, parseSelect } from '../../lib/query-parser.js';

declare module 'fastify' {
  interface FastifyRequest {
    projectContext: ProjectContext;
  }
}

// Schema for column definition
const columnDefinitionSchema = z.object({
  name: z.string().min(1).max(63),
  type: z.string().min(1).max(100),
  nullable: z.boolean().optional().default(true),
  primaryKey: z.boolean().optional().default(false),
  unique: z.boolean().optional().default(false),
  defaultValue: z.string().optional(),
  references: z
    .object({
      table: z.string().min(1).max(63),
      column: z.string().min(1).max(63),
    })
    .optional(),
});

// Schema for creating a table
const createTableSchema = z.object({
  name: z.string().min(1).max(63),
  columns: z.array(columnDefinitionSchema).min(1).max(100),
  ifNotExists: z.boolean().optional().default(false),
});

// Schema for dropping a table
const dropTableSchema = z.object({
  ifExists: z.boolean().optional().default(false),
  cascade: z.boolean().optional().default(false),
});

// Schema for adding a column
const addColumnSchema = columnDefinitionSchema;

// Schema for dropping a column
const dropColumnSchema = z.object({
  ifExists: z.boolean().optional().default(false),
  cascade: z.boolean().optional().default(false),
});

// Schema for renaming
const renameTableSchema = z.object({
  newName: z.string().min(1).max(63),
});

const renameColumnSchema = z.object({
  oldName: z.string().min(1).max(63),
  newName: z.string().min(1).max(63),
});

const alterColumnBodySchema = z.object({
  type: z.string().min(1).max(100).optional(),
  using: z.string().max(500).optional(),
  nullable: z.boolean().optional(),
  defaultValue: z.string().max(255).optional(),
  dropDefault: z.boolean().optional(),
  addConstraint: z.object({
    name: z.string().min(1).max(63),
    type: z.enum(['check', 'unique', 'not_null']),
    expression: z.string().max(1000).optional(),
  }).optional(),
  dropConstraint: z.string().min(1).max(63).optional(),
});

const createIndexBodySchema = z.object({
  name: z.string().min(1).max(63),
  table: z.string().min(1).max(63),
  columns: z.array(z.string().min(1).max(63)).min(1).max(10),
  unique: z.boolean().optional().default(false),
  where: z.string().max(500).optional(),
  ifNotExists: z.boolean().optional().default(false),
});

const dropIndexBodySchema = z.object({
  ifExists: z.boolean().optional().default(false),
});

const truncateBodySchema = z.object({
  restartIdentity: z.boolean().optional().default(false),
  cascade: z.boolean().optional().default(false),
});

/** Reads allowed in one POST /v1/db/read-batch request. */
export const READ_BATCH_MAX_OPERATIONS = 10;

const readBatchBodySchema = z.object({
  operations: z
    .array(
      z.object({
        table: z.string().min(1).max(63),
        // The same parameters GET /v1/db/:table accepts in its query string:
        // select, order, limit, offset, count and operator.column filters.
        query: z
          .record(
            z.string(),
            z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))])
          )
          .optional(),
      })
    )
    .min(1)
    .max(READ_BATCH_MAX_OPERATIONS),
});

/** Read options from GET query parameters, shared by the single and batch read routes. */
function parseReadOptions(query: Record<string, string | undefined>) {
  const limit = query.limit ? parseInt(query.limit, 10) : undefined;
  // count=exact adds the number of matching rows. limit=0 used to mean "default
  // limit"; it keeps that meaning unless a count is requested, in which case it
  // means "count only, no rows".
  const count = query.count === 'exact';

  return {
    select: parseSelect(query.select),
    order: parseOrder(query.order),
    limit,
    offset: query.offset ? parseInt(query.offset, 10) : undefined,
    filters: parseFilters(query),
    count,
    countOnly: count && limit === 0,
  };
}

function readMeta(result: { rowCount: number; count?: number }) {
  return result.count === undefined
    ? { rowCount: result.rowCount }
    : { rowCount: result.rowCount, count: result.count };
}

// Helper to check if request has secret key permissions
function requireSecretKey(request: FastifyRequest): void {
  if (request.projectContext.keyType !== 'secret') {
    throw new ForbiddenError('This operation requires a secret API key');
  }
}

export const dbRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // Get available tables
  fastify.get('/tables', async (request: FastifyRequest, reply) => {
    const tables = await crudService.getTables(request.projectContext.projectId);
    return reply.send({ data: tables });
  });

  // SELECT rows from a table
  fastify.get<{ Params: { table: string }; Querystring: Record<string, string> }>(
    '/:table',
    async (request, reply) => {
      const tableResult = tableNameSchema.safeParse(request.params.table);
      if (!tableResult.success) {
        throw new BadRequestError('Invalid table name');
      }

      const { projectContext } = request;
      const { table } = request.params;
      const query = request.query;

      const result = await crudService.select(
        projectContext.projectId,
        table,
        parseReadOptions(query)
      );

      return reply.send({ data: result.rows, meta: readMeta(result) });
    }
  );

  // Several reads in one request. Each operation is a GET /v1/db/:table with its
  // query parameters as an object, so clients that make many small reads per
  // screen spend one request of their rate-limit budget instead of many.
  // The path contains a hyphen, which no table name can, so it cannot shadow
  // POST /v1/db/:table.
  fastify.post('/read-batch', async (request, reply) => {
    const bodyResult = readBatchBodySchema.safeParse(request.body);
    if (!bodyResult.success) {
      throw new BadRequestError('Invalid request body', bodyResult.error.flatten().fieldErrors);
    }

    const { projectContext } = request;
    const { operations } = bodyResult.data;

    for (const [index, operation] of operations.entries()) {
      if (!tableNameSchema.safeParse(operation.table).success) {
        throw new BadRequestError(`Operation ${index}: Invalid table name`);
      }
    }

    const results = await Promise.all(
      operations.map(async (operation, index) => {
        const query: Record<string, string> = {};
        for (const [key, value] of Object.entries(operation.query ?? {})) {
          query[key] = Array.isArray(value) ? value.join(',') : String(value);
        }
        try {
          const result = await crudService.select(
            projectContext.projectId,
            operation.table,
            parseReadOptions(query)
          );
          return { data: result.rows, meta: readMeta(result) };
        } catch (error) {
          if (error instanceof AppError) {
            throw new AppError(
              error.statusCode,
              error.error,
              `Operation ${index}: ${error.message}`,
              error.details
            );
          }
          throw error;
        }
      })
    );

    return reply.send({ data: results });
  });

  // INSERT rows
  fastify.post<{ Params: { table: string } }>('/:table', async (request, reply) => {
    const tableResult = tableNameSchema.safeParse(request.params.table);
    if (!tableResult.success) {
      throw new BadRequestError('Invalid table name');
    }

    const bodyResult = insertBodySchema.safeParse(request.body);
    if (!bodyResult.success) {
      throw new BadRequestError('Invalid request body', bodyResult.error.flatten().fieldErrors);
    }

    const { projectContext } = request;
    const { table } = request.params;
    const { rows, returning } = bodyResult.data;

    const result = await crudService.insert(projectContext.projectId, table, rows, returning);

    // Trigger webhooks for each inserted record
    for (const record of result.length > 0 ? result : rows) {
      webhookService.triggerWebhooks({
        eventType: 'record.created',
        projectId: projectContext.projectId,
        tableName: table,
        record: record,
        timestamp: new Date(),
      }).catch((error) => {
        // Log but don't fail the request
        request.log.error({ error, table, projectId: projectContext.projectId }, 'Webhook trigger failed');
      });
    }

    return reply.status(201).send({ data: result });
  });

  // UPDATE rows
  fastify.patch<{ Params: { table: string }; Querystring: Record<string, string> }>(
    '/:table',
    async (request, reply) => {
      const tableResult = tableNameSchema.safeParse(request.params.table);
      if (!tableResult.success) {
        throw new BadRequestError('Invalid table name');
      }

      const bodyResult = updateBodySchema.safeParse(request.body);
      if (!bodyResult.success) {
        throw new BadRequestError('Invalid request body', bodyResult.error.flatten().fieldErrors);
      }

      const { projectContext } = request;
      const { table } = request.params;
      const { values, returning } = bodyResult.data;
      const filters = parseFilters(request.query);

      if (filters.length === 0) {
        throw new BadRequestError('At least one filter is required for UPDATE');
      }

      // The extra SELECT and the triggers exist only for webhooks. Most projects
      // have none, so skip both unless an enabled webhook listens to this event.
      const notify = await webhookService.hasWebhooksFor(
        projectContext.projectId,
        'record.updated',
        table
      );

      // Fetch old records before update for webhook payload (if returning is requested)
      let oldRecords: Record<string, unknown>[] = [];
      if (returning && notify) {
        const oldResult = await crudService.select(projectContext.projectId, table, {
          filters,
          limit: 100, // Reasonable limit for webhook payloads
        });
        oldRecords = oldResult.rows;
      }

      const result = await crudService.update(
        projectContext.projectId,
        table,
        values,
        filters,
        returning
      );

      // Trigger webhooks for each updated record
      if (notify && returning && result.length > 0) {
        for (let i = 0; i < result.length; i++) {
          const newRecord = result[i];
          const oldRecord = oldRecords[i];

          webhookService.triggerWebhooks({
            eventType: 'record.updated',
            projectId: projectContext.projectId,
            tableName: table,
            record: newRecord,
            oldRecord: oldRecord,
            timestamp: new Date(),
          }).catch((error) => {
            request.log.error({ error, table, projectId: projectContext.projectId }, 'Webhook trigger failed');
          });
        }
      } else if (notify && !returning) {
        // If not returning, trigger a generic webhook without record details
        webhookService.triggerWebhooks({
          eventType: 'record.updated',
          projectId: projectContext.projectId,
          tableName: table,
          record: values,
          timestamp: new Date(),
        }).catch((error) => {
          request.log.error({ error, table, projectId: projectContext.projectId }, 'Webhook trigger failed');
        });
      }

      return reply.send({ data: result });
    }
  );

  // DELETE rows
  fastify.delete<{ Params: { table: string }; Querystring: Record<string, string> }>(
    '/:table',
    async (request, reply) => {
      const tableResult = tableNameSchema.safeParse(request.params.table);
      if (!tableResult.success) {
        throw new BadRequestError('Invalid table name');
      }

      const { projectContext } = request;
      const { table } = request.params;
      const filters = parseFilters(request.query);

      if (filters.length === 0) {
        throw new BadRequestError('At least one filter is required for DELETE');
      }

      // Fetch records before delete for webhook payload, only if a webhook listens.
      const notify = await webhookService.hasWebhooksFor(
        projectContext.projectId,
        'record.deleted',
        table
      );
      const recordsToDelete = notify
        ? await crudService.select(projectContext.projectId, table, {
          filters,
          limit: 100, // Reasonable limit for webhook payloads
        })
        : { rows: [] as Record<string, unknown>[], rowCount: 0 };

      const result = await crudService.delete(projectContext.projectId, table, filters);

      // Trigger webhooks for each deleted record
      for (const record of recordsToDelete.rows) {
        webhookService.triggerWebhooks({
          eventType: 'record.deleted',
          projectId: projectContext.projectId,
          tableName: table,
          record: record,
          timestamp: new Date(),
        }).catch((error) => {
          request.log.error({ error, table, projectId: projectContext.projectId }, 'Webhook trigger failed');
        });
      }

      return reply.send({ data: { deletedCount: result.rowCount } });
    }
  );

  // ============================================================
  // DDL (Schema) Operations - Require SECRET key
  // ============================================================

  // Create a new table
  fastify.post('/schema/tables', async (request, reply) => {
    requireSecretKey(request);

    const parsed = createTableSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new BadRequestError('Invalid request body', parsed.error.flatten().fieldErrors);
    }

    const { name, columns, ifNotExists } = parsed.data;
    const result = await crudService.createTable(
      request.projectContext.projectId,
      name,
      columns,
      ifNotExists
    );

    return reply.status(201).send({ data: result });
  });

  // Drop a table
  fastify.delete<{ Params: { table: string } }>('/schema/tables/:table', async (request, reply) => {
    requireSecretKey(request);

    const tableResult = tableNameSchema.safeParse(request.params.table);
    if (!tableResult.success) {
      throw new BadRequestError('Invalid table name');
    }

    const parsed = dropTableSchema.safeParse(request.body || {});
    if (!parsed.success) {
      throw new BadRequestError('Invalid request body', parsed.error.flatten().fieldErrors);
    }

    const result = await crudService.dropTable(
      request.projectContext.projectId,
      request.params.table,
      parsed.data.ifExists,
      parsed.data.cascade
    );

    return reply.send({ data: result });
  });

  // Rename a table
  fastify.patch<{ Params: { table: string } }>(
    '/schema/tables/:table/rename',
    async (request, reply) => {
      requireSecretKey(request);

      const tableResult = tableNameSchema.safeParse(request.params.table);
      if (!tableResult.success) {
        throw new BadRequestError('Invalid table name');
      }

      const parsed = renameTableSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new BadRequestError('Invalid request body', parsed.error.flatten().fieldErrors);
      }

      const result = await crudService.renameTable(
        request.projectContext.projectId,
        request.params.table,
        parsed.data.newName
      );

      return reply.send({ data: result });
    }
  );

  // Add a column to a table
  fastify.post<{ Params: { table: string } }>(
    '/schema/tables/:table/columns',
    async (request, reply) => {
      requireSecretKey(request);

      const tableResult = tableNameSchema.safeParse(request.params.table);
      if (!tableResult.success) {
        throw new BadRequestError('Invalid table name');
      }

      const parsed = addColumnSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new BadRequestError('Invalid request body', parsed.error.flatten().fieldErrors);
      }

      const result = await crudService.addColumn(
        request.projectContext.projectId,
        request.params.table,
        parsed.data
      );

      return reply.status(201).send({ data: result });
    }
  );

  // Drop a column from a table
  fastify.delete<{ Params: { table: string; column: string } }>(
    '/schema/tables/:table/columns/:column',
    async (request, reply) => {
      requireSecretKey(request);

      const tableResult = tableNameSchema.safeParse(request.params.table);
      if (!tableResult.success) {
        throw new BadRequestError('Invalid table name');
      }

      const columnResult = tableNameSchema.safeParse(request.params.column);
      if (!columnResult.success) {
        throw new BadRequestError('Invalid column name');
      }

      const parsed = dropColumnSchema.safeParse(request.body || {});
      if (!parsed.success) {
        throw new BadRequestError('Invalid request body', parsed.error.flatten().fieldErrors);
      }

      const result = await crudService.dropColumn(
        request.projectContext.projectId,
        request.params.table,
        request.params.column,
        parsed.data.ifExists,
        parsed.data.cascade
      );

      return reply.send({ data: result });
    }
  );

  // Rename a column
  fastify.patch<{ Params: { table: string } }>(
    '/schema/tables/:table/columns/rename',
    async (request, reply) => {
      requireSecretKey(request);

      const tableResult = tableNameSchema.safeParse(request.params.table);
      if (!tableResult.success) {
        throw new BadRequestError('Invalid table name');
      }

      const parsed = renameColumnSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new BadRequestError('Invalid request body', parsed.error.flatten().fieldErrors);
      }

      const result = await crudService.renameColumn(
        request.projectContext.projectId,
        request.params.table,
        parsed.data.oldName,
        parsed.data.newName
      );

      return reply.send({ data: result });
    }
  );

  // Alter a column
  fastify.patch<{ Params: { table: string; column: string } }>(
    '/schema/tables/:table/columns/:column',
    async (request, reply) => {
      requireSecretKey(request);

      const tableResult = tableNameSchema.safeParse(request.params.table);
      if (!tableResult.success) {
        throw new BadRequestError('Invalid table name');
      }

      const columnResult = tableNameSchema.safeParse(request.params.column);
      if (!columnResult.success) {
        throw new BadRequestError('Invalid column name');
      }

      const parsed = alterColumnBodySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new BadRequestError('Invalid request body', parsed.error.flatten().fieldErrors);
      }

      const result = await crudService.alterColumn(
        request.projectContext.projectId,
        request.params.table,
        request.params.column,
        parsed.data
      );

      return reply.send({ data: result });
    }
  );

  // Create an index
  fastify.post('/schema/indexes', async (request, reply) => {
    requireSecretKey(request);

    const parsed = createIndexBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new BadRequestError('Invalid request body', parsed.error.flatten().fieldErrors);
    }

    const result = await crudService.createIndex(
      request.projectContext.projectId,
      parsed.data
    );

    return reply.status(201).send({ data: result });
  });

  // Drop an index
  fastify.delete<{ Params: { name: string } }>(
    '/schema/indexes/:name',
    async (request, reply) => {
      requireSecretKey(request);

      const nameResult = tableNameSchema.safeParse(request.params.name);
      if (!nameResult.success) {
        throw new BadRequestError('Invalid index name');
      }

      const parsed = dropIndexBodySchema.safeParse(request.body || {});
      if (!parsed.success) {
        throw new BadRequestError('Invalid request body', parsed.error.flatten().fieldErrors);
      }

      const result = await crudService.dropIndex(
        request.projectContext.projectId,
        request.params.name,
        parsed.data.ifExists
      );

      return reply.send({ data: result });
    }
  );

  // Truncate a table
  fastify.post<{ Params: { table: string } }>(
    '/schema/tables/:table/truncate',
    async (request, reply) => {
      requireSecretKey(request);

      const tableResult = tableNameSchema.safeParse(request.params.table);
      if (!tableResult.success) {
        throw new BadRequestError('Invalid table name');
      }

      const parsed = truncateBodySchema.safeParse(request.body || {});
      if (!parsed.success) {
        throw new BadRequestError('Invalid request body', parsed.error.flatten().fieldErrors);
      }

      const result = await crudService.truncateTable(
        request.projectContext.projectId,
        request.params.table,
        parsed.data
      );

      return reply.send({ data: result });
    }
  );
};
